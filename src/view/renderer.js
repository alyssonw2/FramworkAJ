/**
 * FLASH — renderer.
 *
 * Interprets a template AST. Rendering is async because components and partials
 * are loaded from disk through the view engine.
 *
 * Invariants:
 *  - every interpolated value is escaped for the context it lands in;
 *  - only `SafeHtml` values (engine-produced fragments, `safeHtml()` output)
 *    bypass escaping;
 *  - components receive explicit props only, never the ambient page scope;
 *  - there is no code generation, so a template can never execute arbitrary JS.
 */

import { evaluateAst } from '../shared/expression.js';
import {
  escapeHtml,
  escapeAttribute,
  escapeCss,
  toText,
  isSafeHtml,
  trustedFragment,
  safeUrl
} from '../shared/escaping.js';
import { TemplateError, VOID_ELEMENTS } from './template.js';

const BOOLEAN_ATTRIBUTES = new Set([
  'allowfullscreen', 'async', 'autofocus', 'checked', 'controls', 'defer',
  'disabled', 'formnovalidate', 'hidden', 'inert', 'ismap', 'itemscope', 'loop',
  'multiple', 'muted', 'novalidate', 'open', 'playsinline', 'readonly',
  'required', 'reversed', 'selected'
]);

const URL_ATTRIBUTES = new Set([
  'action', 'cite', 'data', 'formaction', 'href', 'poster', 'src', 'xlink:href'
]);

const DIRECTIVE_PREFIX = 'f-';

function isDirectiveAttribute(name) {
  const lower = name.toLowerCase();
  return lower.startsWith(DIRECTIVE_PREFIX) || lower.startsWith('data-flash-');
}

function newScope(base, extra) {
  const scope = Object.assign(Object.create(null), base);
  for (const [key, value] of Object.entries(extra)) {
    scope[key] = value;
  }
  return scope;
}

export class TemplateRenderer {
  #engine;

  constructor(engine) {
    this.#engine = engine;
  }

  get engine() {
    return this.#engine;
  }

  errorFor(node, message, context, cause) {
    return new TemplateError(message, {
      file: context.file,
      line: node.line,
      column: node.column,
      cause
    });
  }

  /**
   * Evaluates an expression.
   *
   * `lenient` is used for conditions (`{{#if}}`, `{{#each}}`): testing whether a
   * value exists must not fail when it does not. Interpolations and attribute
   * values stay strict, so printing a missing value is reported in development.
   */
  evaluate(node, scope, context, source, { lenient = false } = {}) {
    try {
      return evaluateAst(node.ast ?? node, scope, {
        strict: lenient ? false : context.strict ?? this.#engine.strict,
        helpers: this.#engine.helpers,
        expression: source ?? node.source
      });
    } catch (error) {
      if (error instanceof TemplateError) throw error;
      throw this.errorFor(node, error.message, context, error);
    }
  }

  /**
   * Renders a parsed template.
   * @param {object} ast
   * @param {{scope: object, file?: string, blocks?: Record<string, unknown>, depth?: number, componentStack?: string[]}} context
   * @returns {Promise<string>}
   */
  async render(ast, context) {
    const depth = context.depth ?? 0;
    if (depth > this.#engine.maxDepth) {
      throw new TemplateError(
        `Template nesting exceeded ${this.#engine.maxDepth} levels (possible include cycle)`,
        { file: context.file }
      );
    }
    return this.renderNodes(ast.children, context.scope, { ...context, depth });
  }

  async renderNodes(nodes, scope, context) {
    let output = '';
    for (const node of nodes) {
      switch (node.type) {
        case 'Text':
          output += node.value;
          break;

        case 'Interpolation': {
          const value = this.evaluate(node, scope, context);
          output += node.context === 'css'
            ? escapeCss(value)
            : escapeHtml(value, { expression: node.source });
          break;
        }

        case 'Element':
          output += await this.renderElement(node, scope, context);
          break;

        case 'If':
          output += await this.renderIf(node, scope, context);
          break;

        case 'Each':
          output += await this.renderEach(node, scope, context);
          break;

        case 'Partial':
          output += await this.renderPartial(node, scope, context);
          break;

        case 'Content':
          // Blocks are collected by the view engine before rendering and are
          // exposed to layouts through the scope.
          break;

        case 'Comment':
          break;

        default:
          throw this.errorFor(node, `Unsupported node "${node.type}"`, context);
      }
    }
    return output;
  }

  async renderIf(node, scope, context) {
    let result = this.evaluate(node.test, scope, context, node.source, { lenient: true });
    if (node.negate) result = !result;
    const branch = result ? node.consequent : node.alternate;
    if (!branch || branch.length === 0) return '';
    return this.renderNodes(branch, scope, context);
  }

  async renderEach(node, scope, context) {
    const value = this.evaluate(node.iterable, scope, context, node.source, { lenient: true });
    const entries = this.toEntries(value);

    if (entries.length === 0) {
      return node.alternate?.length ? this.renderNodes(node.alternate, scope, context) : '';
    }

    let output = '';
    for (let i = 0; i < entries.length; i += 1) {
      const [key, item] = entries[i];
      const extra = { [node.item]: item };
      if (node.indexName) extra[node.indexName] = key;
      output += await this.renderNodes(node.consequent, newScope(scope, extra), context);
    }
    return output;
  }

  toEntries(value) {
    if (value === null || value === undefined || value === false) return [];
    if (Array.isArray(value)) return value.map((item, index) => [index, item]);
    if (value instanceof Map) return [...value.entries()];
    if (value instanceof Set) return [...value.values()].map((item, index) => [index, item]);
    if (typeof value === 'string') return [...value].map((item, index) => [index, item]);
    if (typeof value === 'number' || typeof value === 'boolean') return [];
    if (typeof value === 'object') {
      return Object.hasOwn(value, 'items') && Array.isArray(value.items)
        ? value.items.map((item, index) => [index, item])
        : Object.entries(value);
    }
    return [];
  }

  async renderPartial(node, scope, context) {
    const props = this.resolveProps(node.props, scope, context);
    const partialScope = newScope(scope, props);

    if (context.blocks) {
      for (const [name, value] of Object.entries(context.blocks)) {
        partialScope[name] = value;
      }
    }

    const result = await this.#engine.renderPartial(node.name, {
      scope: partialScope,
      blocks: context.blocks,
      depth: (context.depth ?? 0) + 1,
      strict: context.strict,
      from: context.file
    });

    return result;
  }

  resolveProps(propList, scope, context) {
    const props = Object.create(null);

    for (const prop of propList) {
      const parts = prop.parts;

      if (parts.length === 1 && parts[0].type === 'expression') {
        props[prop.name] = this.evaluate(parts[0], scope, context);
        continue;
      }

      if (parts.length === 1 && parts[0].type === 'literal') {
        props[prop.name] = parts[0].value;
        continue;
      }

      props[prop.name] = this.joinParts(parts, scope, context, null);
    }

    return props;
  }

  joinParts(parts, scope, context, attributeName) {
    let text = '';
    for (const part of parts) {
      if (part.type === 'literal') {
        text += part.value;
        continue;
      }
      const value = this.evaluate(part, scope, context);
      const stringValue = isSafeHtml(value) ? String(value) : toText(value, { expression: part.source });
      text += attributeName && URL_ATTRIBUTES.has(attributeName) ? safeUrl(stringValue) : stringValue;
    }
    return text;
  }

  /**
   * Value used for a component prop. Single expressions keep their original
   * type so components can receive arrays and objects.
   */
  propValue(attribute, scope, context) {
    if (attribute.parts === null) return true;
    if (attribute.parts.length === 1) {
      const part = attribute.parts[0];
      if (part.type === 'expression') return this.evaluate(part, scope, context);
      return part.value;
    }
    return this.joinParts(attribute.parts, scope, context, null);
  }

  async renderAttribute(attribute, scope, context) {
    if (attribute.splat) {
      return this.renderSplat(attribute, scope, context);
    }

    const name = attribute.name;

    if (attribute.parts === null) {
      return ` ${name}`;
    }

    if (isDirectiveAttribute(name)) {
      // Directive values are client-side expressions: never evaluate them here,
      // except for explicit `{{ }}` interpolations the author asked for.
      const raw = attribute.parts.every((part) => part.type === 'literal')
        ? attribute.parts.map((part) => part.value).join('')
        : this.joinParts(attribute.parts, scope, context, null);
      return ` ${name}="${escapeAttribute(raw)}"`;
    }

    if (attribute.parts.length === 1 && attribute.parts[0].type === 'expression') {
      const value = this.evaluate(attribute.parts[0], scope, context);

      if (BOOLEAN_ATTRIBUTES.has(name.toLowerCase()) && typeof value === 'boolean') {
        return value ? ` ${name}` : '';
      }
      if (value === false || value === null || value === undefined) return '';
      if (value === true) return ` ${name}`;

      const text = isSafeHtml(value) ? String(value) : toText(value, { expression: attribute.parts[0].source });
      const safe = URL_ATTRIBUTES.has(name.toLowerCase()) ? safeUrl(text) : text;
      return ` ${name}="${escapeAttribute(safe)}"`;
    }

    const text = this.joinParts(attribute.parts, scope, context, name.toLowerCase());
    return ` ${name}="${escapeAttribute(text)}"`;
  }

  /**
   * Renders `{{ expression }}` placed between attributes inside a tag.
   * `SafeHtml` (component `attrs`) is emitted verbatim; plain objects are
   * rendered as escaped attributes.
   */
  renderSplat(attribute, scope, context) {
    const value = this.evaluate(attribute, scope, context, attribute.source);

    if (value === null || value === undefined || value === '' || value === false) return '';
    if (isSafeHtml(value)) return String(value);
    if (typeof value === 'string') return escapeAttribute(value);

    if (typeof value === 'object') {
      let output = '';
      for (const [key, item] of Object.entries(value)) {
        if (!/^[A-Za-z_:][-A-Za-z0-9_:.]*$/.test(key)) continue;
        if (item === false || item === null || item === undefined) continue;
        if (item === true) output += ` ${key}`;
        else output += ` ${key}="${escapeAttribute(item)}"`;
      }
      return output;
    }

    return escapeAttribute(toText(value));
  }

  async renderElement(node, scope, context) {
    if (node.component) {
      return this.renderComponent(node, scope, context);
    }

    let output = `<${node.tag}`;
    for (const attribute of node.attributes) {
      output += await this.renderAttribute(attribute, scope, context);
    }

    if (node.selfClosing || VOID_ELEMENTS.has(node.tag)) {
      return `${output}>`;
    }

    output += '>';
    output += await this.renderNodes(node.children, scope, context);
    output += `</${node.tag}>`;
    return output;
  }

  async renderComponent(node, scope, context) {
    const separator = node.tag.indexOf(':');
    const namespace = node.tag.slice(0, separator);
    const name = node.tag.slice(separator + 1);

    if (name === '' || name.includes(':')) {
      throw this.errorFor(node, `Invalid component tag "<${node.tag}>"`, context);
    }

    const { consumedProps, ownedAttributes } = await this.#engine.componentInfo(name);

    const props = Object.create(null);
    let attrs = '';

    for (const attribute of node.attributes) {
      if (attribute.splat) {
        attrs += await this.renderAttribute(attribute, scope, context);
        continue;
      }

      props[attribute.name] = this.propValue(attribute, scope, context);

      // Forward only attributes the component does not handle itself, so the
      // rendered markup never contains the same attribute twice.
      const lower = attribute.name.toLowerCase();
      if (!consumedProps.has(attribute.name) && !ownedAttributes.has(lower)) {
        attrs += await this.renderAttribute(attribute, scope, context);
      }
    }

    const slot = trustedFragment(await this.renderNodes(node.children, scope, context));

    props.attrs = trustedFragment(attrs);
    props.slot = slot;

    const stack = [...(context.componentStack ?? []), name];
    if (stack.filter((entry) => entry === name).length > 1) {
      throw this.errorFor(
        node,
        `Component "<${node.tag}>" includes itself recursively`,
        context
      );
    }

    return this.#engine.renderComponent(name, {
      scope: props,
      namespace,
      depth: (context.depth ?? 0) + 1,
      componentStack: stack,
      usage: node.tag
    });
  }
}

export { BOOLEAN_ATTRIBUTES, URL_ATTRIBUTES };
