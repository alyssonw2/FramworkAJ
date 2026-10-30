/**
 * FLASH — view engine.
 *
 * Responsibilities:
 *  - resolve template names to files, inside the configured roots only;
 *  - parse templates and cache the AST (with mtime invalidation);
 *  - resolve layouts (`{{#content}}` blocks) and includes;
 *  - resolve server components;
 *  - report errors with file, line and column.
 */

import fs from 'node:fs/promises';
import path from 'node:path';
import { parseTemplate, TemplateError, collectCapabilities, collectConsumed } from './template.js';
import { TemplateRenderer } from './renderer.js';
import { trustedFragment } from '../shared/escaping.js';

const SAFE_NAME = /^[A-Za-z0-9][A-Za-z0-9._/-]*$/;

/**
 * Components may declare default props in a leading comment:
 *
 *   {{! defaults: {"type": "button", "variant": "default"} }}
 *
 * Defaults keep component templates readable while still allowing every caller
 * to override them.
 */
function parseComponentDefaults(ast, file) {
  for (const node of ast.children) {
    if (node.type === 'Text' && node.value.trim() === '') continue;
    if (node.type !== 'Comment') break;

    const match = /^defaults\s*:\s*(\{[\s\S]*\})$/.exec(node.value);
    if (!match) continue;

    try {
      return JSON.parse(match[1]);
    } catch (error) {
      throw new TemplateError(`Invalid JSON in component defaults: ${error.message}`, {
        file,
        line: node.line,
        column: node.column
      });
    }
  }
  return null;
}

function normalizeName(name) {
  if (typeof name !== 'string' || name.trim() === '') {
    throw new TemplateError('Template name must be a non-empty string');
  }
  const cleaned = name.trim().replace(/\\/g, '/').replace(/^\.\//, '');
  if (!SAFE_NAME.test(cleaned) || cleaned.split('/').includes('..')) {
    throw new TemplateError(`Invalid template name "${name}"`);
  }
  return cleaned.endsWith('.html') ? cleaned : `${cleaned}.html`;
}

export class ViewEngine {
  /**
   * @param {{
   *   views?: string,
   *   components?: string,
   *   strict?: boolean,
   *   maxDepth?: number,
   *   helpers?: Record<string, Function>,
   *   cache?: boolean,
   *   freeze?: boolean
   * }} options
   */
  constructor(options = {}) {
    this.viewsRoot = options.views ? path.resolve(options.views) : null;
    this.componentsRoots = options.components
      ? [].concat(options.components).map((dir) => path.resolve(dir))
      : [];
    this.componentsRoot = this.componentsRoots[0] ?? null;
    this.strict = options.strict ?? false;
    this.maxDepth = options.maxDepth ?? 32;
    this.helpers = Object.create(null);
    this.cacheEnabled = options.cache ?? true;
    this.frozen = options.freeze ?? false;
    this.cache = new Map();
    this.renderer = new TemplateRenderer(this);

    if (options.helpers) this.registerHelpers(options.helpers);
  }

  registerHelpers(helpers) {
    for (const [name, fn] of Object.entries(helpers ?? {})) {
      if (typeof fn !== 'function') {
        throw new TypeError(`Helper "${name}" must be a function`);
      }
      this.helpers[name] = fn;
    }
    return this;
  }

  clearCache() {
    this.cache.clear();
  }

  freeze(value = true) {
    this.frozen = value;
    return this;
  }

  resolveFile(root, name, kind) {
    if (!root) {
      throw new TemplateError(`No ${kind} directory configured`);
    }
    const relative = normalizeName(name);
    const file = path.resolve(root, relative);
    if (file !== root && !file.startsWith(root + path.sep)) {
      throw new TemplateError(`Template "${name}" resolves outside the ${kind} directory`);
    }
    return file;
  }

  /**
   * Loads and compiles a template, reusing the cached AST while the file is
   * unchanged. Components are searched in every configured root, in order.
   *
   * @param {'view'|'component'} kind
   * @param {string} name
   */
  async load(kind, name) {
    if (kind === 'component') {
      let missing = null;
      for (const root of this.componentsRoots) {
        try {
          return await this.loadFrom(root, kind, name, 'components');
        } catch (error) {
          if (!(error instanceof TemplateError) || !/not found/i.test(error.message)) throw error;
          missing = missing ?? error;
        }
      }
      throw missing ?? new TemplateError('No components directory configured');
    }

    return this.loadFrom(this.viewsRoot, 'view', name, 'views');
  }

  async loadFrom(root, kind, name, label) {
    const file = this.resolveFile(root, name, label);
    const cached = this.cache.get(file);

    if (cached && !this.cacheEnabled) return cached;
    if (cached && this.frozen) return cached;

    let stats;
    try {
      stats = await fs.stat(file);
    } catch {
      throw new TemplateError(
        `${kind === 'component' ? 'Component' : 'Template'} "${name}" not found`,
        { file: path.relative(root, file) }
      );
    }

    if (cached && cached.mtimeMs === stats.mtimeMs && cached.size === stats.size) {
      return cached;
    }

    const source = await fs.readFile(file, 'utf8');
    const ast = parseTemplate(source, { file });

    const entry = {
      file: path.relative(root, file).split(path.sep).join('/'),
      absoluteFile: file,
      ast,
      source,
      mtimeMs: stats.mtimeMs,
      size: stats.size,
      defaults: kind === 'component' ? parseComponentDefaults(ast, file) : null,
      consumed: kind === 'component' ? collectConsumed(ast) : null,
      capabilities: collectCapabilities(ast)
    };

    this.cache.set(file, entry);
    return entry;
  }

  buildScope(props) {
    const scope = Object.create(null);
    if (props && typeof props === 'object') {
      for (const [key, value] of Object.entries(props)) {
        scope[key] = value;
      }
    }
    return scope;
  }

  collectBlocks(ast, file) {
    const blocks = Object.create(null);

    for (const node of ast.children) {
      if (node.type !== 'Content') continue;
      if (blocks[node.name]) {
        throw new TemplateError(`Duplicate content block "${node.name}"`, {
          file,
          line: node.line,
          column: node.column
        });
      }
      blocks[node.name] = node;
    }

    return blocks;
  }

  assertNoNestedContent(nodes, file, insideBlock) {
    for (const node of nodes) {
      if (!node) continue;

      if (node.type === 'Content') {
        if (insideBlock) {
          throw new TemplateError('{{#content}} blocks must be top-level', {
            file,
            line: node.line,
            column: node.column
          });
        }
        continue;
      }

      if (node.type === 'Element') {
        this.assertNoNestedContent(node.children, file, true);
        continue;
      }

      if (node.type === 'If' || node.type === 'Each') {
        this.assertNoNestedContent(node.consequent, file, true);
        this.assertNoNestedContent(node.alternate, file, true);
      }
    }
  }

  /**
   * Renders a view with the given props.
   *
   * @param {string} name template name without extension (`clients/index`)
   * @param {Record<string, unknown>} [props]
   * @param {{strict?: boolean|'full'}} [options] overrides the engine strictness
   * @returns {Promise<string>} HTML
   */
  async render(name, props = {}, options = {}) {
    const entry = await this.load('view', name);
    const scope = this.buildScope(props);
    const blocks = await this.renderBlocks(entry, scope);

    return this.renderer.render(entry.ast, {
      scope,
      file: entry.file,
      blocks,
      depth: 0,
      strict: options.strict
    });
  }

  async renderBlocks(entry, scope) {
    this.assertNoNestedContent(entry.ast.children, entry.file, false);

    const collected = this.collectBlocks(entry.ast, entry.file);
    const blocks = Object.create(null);

    for (const [name, node] of Object.entries(collected)) {
      const html = await this.renderer.renderNodes(node.children, scope, {
        file: entry.file,
        depth: 0
      });
      blocks[name] = trustedFragment(html);
    }

    return blocks;
  }

  /** Renders an include (`{{> name}}`). */
  async renderPartial(name, context) {
    const entry = await this.load('view', name);
    return this.renderer.render(entry.ast, {
      scope: context.scope,
      file: entry.file,
      blocks: context.blocks,
      depth: context.depth ?? 1,
      strict: context.strict
    });
  }

  /**
   * Names a component template already consumes, so the caller's attributes are
   * not emitted twice through `{{ attrs }}`.
   * @param {string} name
   */
  async componentInfo(name) {
    const entry = await this.load('component', name);
    return {
      consumedProps: entry.consumed?.identifiers ?? new Set(),
      ownedAttributes: entry.consumed?.attributes ?? new Set()
    };
  }

  /** Renders a server component (`<ui:button>`). */
  async renderComponent(name, context) {
    let entry;
    try {
      entry = await this.load('component', name);
    } catch (error) {
      if (error instanceof TemplateError) {
        throw new TemplateError(
          `Component "<${context.usage ?? name}>" not found: no component template "${name}.html"`,
          { file: null, cause: error }
        );
      }
      throw error;
    }

    const scope = Object.create(null);
    if (entry.defaults) Object.assign(scope, entry.defaults);
    if (context.scope) Object.assign(scope, context.scope);

    return this.renderer.render(entry.ast, {
      scope,
      file: entry.file,
      depth: context.depth ?? 1,
      componentStack: context.componentStack,
      // Components are generic by design: props are optional and a missing prop
      // renders empty instead of failing. Pages stay strict.
      strict: false
    });
  }

  /**
   * Parses every template below the views/components roots and reports which
   * client capabilities they need. Used by `flash analyze` and by tooling that
   * decides whether to ship the browser runtime.
   */
  async analyze() {
    const result = {
      templates: [],
      components: [],
      directives: new Set(),
      componentTags: new Set()
    };

    const walk = async (root, kind, base = root) => {
      if (!root) return;
      let entries;
      try {
        entries = await fs.readdir(root, { withFileTypes: true });
      } catch {
        return;
      }
      for (const entry of entries) {
        const full = path.join(root, entry.name);
        if (entry.isDirectory()) {
          await walk(full, kind, base);
          continue;
        }
        if (!entry.name.endsWith('.html')) continue;
        const relative = path.relative(base, full).replace(/\.html$/, '').split(path.sep).join('/');
        const loaded = await this.load(kind, relative);
        const item = {
          name: relative,
          file: loaded.file,
          directives: [...loaded.capabilities.directives],
          components: [...loaded.capabilities.components],
          needsRuntime: loaded.capabilities.needsRuntime
        };
        for (const directive of item.directives) result.directives.add(directive);
        for (const component of item.components) result.componentTags.add(component);
        if (kind === 'component') result.components.push(item);
        else result.templates.push(item);
      }
    };

    await walk(this.viewsRoot, 'view');
    for (const root of this.componentsRoots) {
      await walk(root, 'component');
    }

    return {
      ...result,
      directives: [...result.directives].sort(),
      componentTags: [...result.componentTags].sort(),
      needsRuntime: result.directives.size > 0
    };
  }
}
