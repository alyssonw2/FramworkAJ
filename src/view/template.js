/**
 * FLASH — template parser.
 *
 * Turns a `.html` template into an AST. The parser understands plain HTML plus a
 * small, explicit set of mustache-like blocks:
 *
 *   {{ expression }}                 escaped interpolation
 *   {{#if expression}} ... {{else}} ... {{/if}}
 *   {{#each list as item, index}} ... {{else}} ... {{/each}}
 *   {{#content "body"}} ... {{/content}}   (layout block)
 *   {{> partial name=expression}}          (include or layout)
 *   {{! comment }}
 *
 * Elements whose tag contains a namespace separator (`<ui:button>`) are
 * components rendered on the server.
 *
 * No `eval` is involved: expressions are validated and stored as ASTs at parse
 * time, and the renderer interprets those ASTs.
 */

import { parseExpression, ExpressionError } from '../shared/expression.js';

export class TemplateError extends Error {
  constructor(message, info = {}) {
    const location = info.file
      ? `${info.file}${info.line != null ? `:${info.line}:${info.column}` : ''}`
      : info.line != null
        ? `line ${info.line}:${info.column}`
        : '';
    super(location ? `${message} (${location})` : message);
    this.name = 'TemplateError';
    this.file = info.file;
    this.line = info.line;
    this.column = info.column;
    this.snippet = info.snippet;
    if (info.cause) this.cause = info.cause;
  }
}

export const VOID_ELEMENTS = new Set([
  'area', 'base', 'br', 'col', 'embed', 'hr', 'img', 'input',
  'link', 'meta', 'param', 'source', 'track', 'wbr'
]);

const RAW_TEXT_ELEMENTS = new Set(['script', 'style']);

const TEXT_ONLY_ELEMENTS = new Set(['textarea', 'title']);

/**
 * Minimal implicit end-tag table, mirroring the most common HTML rules.
 * Explicit closing tags are always recommended and produce better diagnostics.
 */
const IMPLICIT_CLOSE = {
  li: ['li'],
  dt: ['dt', 'dd'],
  dd: ['dt', 'dd'],
  option: ['option'],
  optgroup: ['optgroup', 'option'],
  tr: ['tr', 'td', 'th'],
  td: ['td', 'th'],
  th: ['td', 'th'],
  tbody: ['thead', 'tbody', 'tfoot', 'tr', 'td', 'th'],
  thead: ['tbody', 'tfoot', 'tr', 'td', 'th'],
  tfoot: ['tbody', 'thead', 'tr', 'td', 'th'],
  p: ['p'],
  div: ['p'],
  section: ['p'],
  article: ['p'],
  header: ['p'],
  footer: ['p'],
  main: ['p'],
  nav: ['p'],
  aside: ['p'],
  form: ['p'],
  fieldset: ['p'],
  ul: ['p'],
  ol: ['p'],
  table: ['p'],
  h1: ['p'],
  h2: ['p'],
  h3: ['p'],
  h4: ['p'],
  h5: ['p'],
  h6: ['p']
};

const ATTRIBUTE_NAME_RE = /[^\s"'>/=]+/y;
const TAG_NAME_RE = /[a-zA-Z][a-zA-Z0-9:._-]*/y;

function isWhitespace(ch) {
  return ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r' || ch === '\f';
}

/** True when the element name must be resolved as a server component. */
export function isComponentTag(tag) {
  return tag.includes(':');
}

/**
 * Splits an attribute value into literal and expression parts.
 * `class="btn btn-{{ variant }}"` becomes
 * `[{literal:'btn btn-'}, {expression:'variant'}]`.
 */
function splitValueParts(raw, pushError) {
  const parts = [];
  let index = 0;

  while (index < raw.length) {
    const open = raw.indexOf('{{', index);
    if (open === -1) {
      if (index < raw.length) parts.push({ type: 'literal', value: raw.slice(index) });
      break;
    }
    if (open > index) parts.push({ type: 'literal', value: raw.slice(index, open) });

    const close = findMustacheEnd(raw, open);
    if (close === -1) {
      pushError('Unclosed "{{" in attribute value', open);
      break;
    }

    const inner = raw.slice(open + 2, close).trim();
    if (inner.startsWith('{')) {
      pushError('Triple braces are not supported; use the safeHtml() helper for trusted HTML', open);
    } else if (inner === '') {
      pushError('Empty interpolation', open);
    } else {
      parts.push({ type: 'expression', source: inner, ast: null, offset: open });
    }
    index = close + 2;
  }

  if (parts.length === 0) parts.push({ type: 'literal', value: '' });
  return parts;
}

/** Finds the index of the `}}` that closes a mustache opened at `start`. */
function findMustacheEnd(source, start) {
  let i = start + 2;
  let quote = null;
  while (i < source.length) {
    const ch = source[i];
    if (quote) {
      if (ch === '\\') {
        i += 2;
        continue;
      }
      if (ch === quote) quote = null;
      i += 1;
      continue;
    }
    if (ch === '"' || ch === "'") {
      quote = ch;
      i += 1;
      continue;
    }
    if (ch === '}' && source[i + 1] === '}') return i;
    i += 1;
  }
  return -1;
}

class TemplateParser {
  /**
   * @param {string} source
   * @param {string|null} file
   * @param {{inline?: boolean, css?: boolean, lineOffset?: number}} [options]
   *   `inline` parses a fragment that may not contain tags (used inside
   *   `<style>`), `css` marks interpolations as CSS values.
   */
  constructor(source, file, options = {}) {
    this.source = source;
    this.file = file;
    this.inline = options.inline === true;
    this.css = options.css === true;
    this.lineOffset = options.lineOffset ?? 0;
    this.pos = 0;
    this.lineStarts = [0];

    for (let i = 0; i < source.length; i += 1) {
      if (source[i] === '\n') this.lineStarts.push(i + 1);
    }

    this.root = { type: 'Root', children: [] };
    this.frames = [{ kind: 'root', node: this.root, list: this.root.children }];
  }

  get current() {
    return this.frames[this.frames.length - 1];
  }

  lineColAt(index) {
    let low = 0;
    let high = this.lineStarts.length - 1;
    while (low < high) {
      const mid = (low + high + 1) >> 1;
      if (this.lineStarts[mid] <= index) low = mid;
      else high = mid - 1;
    }
    return { line: low + 1, column: index - this.lineStarts[low] + 1 };
  }

  snippetAt(index) {
    const start = this.lineStarts[Math.max(0, this.lineColAt(index).line - 1)] ?? 0;
    const end = this.source.indexOf('\n', start);
    const text = this.source.slice(start, end === -1 ? this.source.length : end);
    return text.length > 160 ? `${text.slice(0, 157)}...` : text;
  }

  error(message, index = this.pos, cause) {
    const { line, column } = this.lineColAt(Math.min(index, this.source.length));
    return new TemplateError(message, {
      file: this.file,
      line: line + this.lineOffset,
      column,
      snippet: this.snippetAt(index),
      cause
    });
  }

  append(node) {
    if (node.index != null && node.line == null) {
      const { line, column } = this.lineColAt(node.index);
      node.line = line + this.lineOffset;
      node.column = column;
    }
    this.current.list.push(node);
    return node;
  }

  parse() {
    while (this.pos < this.source.length) {
      if (this.source.startsWith('{{', this.pos)) {
        this.parseMustache();
        continue;
      }

      if (this.inline) {
        this.parseInlineText();
        continue;
      }

      const ch = this.source[this.pos];
      if (ch === '<') {
        if (this.source.startsWith('<!--', this.pos)) {
          this.parseComment();
          continue;
        }
        const next = this.source[this.pos + 1] ?? '';
        if (next === '/' || /[a-zA-Z]/.test(next)) {
          this.parseElement();
          continue;
        }
      }

      this.parseText();
    }

    if (this.frames.length > 1) {
      const frame = this.current;
      const openedAt = frame.openedAt ?? 0;
      const { line, column } = this.lineColAt(openedAt);
      const label = frame.kind === 'element' ? `<${frame.name}>` : `{{#${frame.kind}}}`;
      throw this.error(`Unclosed ${label} opened at line ${line}:${column}`, openedAt);
    }

    return this.root;
  }

  /** Text inside `<style>`: only `{{` ends a run, `<` is just a character. */
  parseInlineText() {
    const start = this.pos;
    let i = this.pos;

    while (i < this.source.length && !this.source.startsWith('{{', i)) i += 1;

    if (i === start) i += 1;
    this.current.list.push({ type: 'Text', value: this.source.slice(start, i) });
    this.pos = i;
  }

  parseText() {
    const start = this.pos;
    let i = this.pos;

    while (i < this.source.length) {
      if (this.source.startsWith('{{', i)) break;
      if (this.source[i] === '<') {
        const next = this.source[i + 1] ?? '';
        if (next === '/' || next === '!' || /[a-zA-Z]/.test(next)) break;
      }
      i += 1;
    }

    if (i === start) {
      // A stray "<" that is not a tag: keep it as text so prose like "a < b" works.
      i += 1;
    }

    this.current.list.push({ type: 'Text', value: this.source.slice(start, i) });
    this.pos = i;
  }

  parseComment() {
    const end = this.source.indexOf('-->', this.pos + 4);
    if (end === -1) throw this.error('Unclosed HTML comment');
    this.pos = end + 3;
  }

  parseMustache() {
    const start = this.pos;
    const close = findMustacheEnd(this.source, start);
    if (close === -1) throw this.error('Unclosed "{{"', start);

    const inner = this.source.slice(start + 2, close).trim();
    this.pos = close + 2;

    if (inner.startsWith('{')) {
      throw this.error(
        'Triple braces are not supported; use the safeHtml() helper for trusted HTML',
        start
      );
    }

    if (inner === '') throw this.error('Empty interpolation', start);
    if (inner.startsWith('!')) {
      this.append({ type: 'Comment', value: inner.slice(1).trim(), index: start });
      return;
    }

    if (inner.startsWith('#')) {
      this.openBlock(inner.slice(1).trim(), start);
      return;
    }

    if (inner.startsWith('/')) {
      this.closeBlock(inner.slice(1).trim(), start);
      return;
    }

    if (inner.startsWith('>')) {
      this.append(this.parsePartial(inner.slice(1).trim(), start));
      return;
    }

    if (inner === 'else' || inner.startsWith('else ')) {
      this.openElse(inner, start);
      return;
    }

    this.append({
      type: 'Interpolation',
      source: inner,
      ast: this.compileExpression(inner, start),
      context: this.css ? 'css' : 'text',
      index: start
    });
  }

  compileExpression(source, index) {
    try {
      return parseExpression(source);
    } catch (error) {
      if (error instanceof ExpressionError) {
        throw this.error(`Invalid expression "${source}": ${error.message}`, index, error);
      }
      throw error;
    }
  }

  openBlock(header, start) {
    const match = /^([a-zA-Z_][a-zA-Z0-9_-]*)\s*([\s\S]*)$/.exec(header);
    if (!match) throw this.error(`Invalid block syntax "{{#${header}}}"`, start);

    const [, keyword, rest] = match;

    if (keyword === 'if' || keyword === 'unless') {
      if (rest.trim() === '') throw this.error(`{{#${keyword}}} requires an expression`, start);
      const node = {
        type: 'If',
        test: this.compileExpression(rest.trim(), start),
        source: rest.trim(),
        negate: keyword === 'unless',
        consequent: [],
        alternate: [],
        hasElse: false,
        index: start
      };
      this.append(node);
      this.frames.push({
        kind: 'if',
        closeKeyword: keyword,
        node,
        active: node,
        list: node.consequent,
        hasElse: false,
        openedAt: start
      });
      return;
    }

    if (keyword === 'each') {
      const parsed = this.parseEachHeader(rest.trim(), start);
      const node = {
        type: 'Each',
        iterable: this.compileExpression(parsed.iterable, start),
        source: parsed.iterable,
        item: parsed.item,
        indexName: parsed.indexName,
        consequent: [],
        alternate: [],
        hasElse: false,
        index: start
      };
      this.append(node);
      this.frames.push({ kind: 'each', node, list: node.consequent, hasElse: false, openedAt: start });
      return;
    }

    if (keyword === 'content') {
      const name = this.parseBlockName(rest.trim(), start);
      const node = { type: 'Content', name, children: [], index: start };
      this.append(node);
      this.frames.push({ kind: 'content', node, list: node.children, openedAt: start });
      return;
    }

    throw this.error(
      `Unknown block "{{#${keyword}}}". Supported blocks: if, unless, each, content`,
      start
    );
  }

  parseEachHeader(header, start) {
    const match = /^([\s\S]+?)\s+as\s+([A-Za-z_$][A-Za-z0-9_$]*)(?:\s*,\s*([A-Za-z_$][A-Za-z0-9_$]*))?$/.exec(
      header
    );
    if (!match) {
      throw this.error(
        'Invalid each header. Expected {{#each list as item}} or {{#each list as item, index}}',
        start
      );
    }
    const [, iterable, item, indexName] = match;
    if (item === indexName) {
      throw this.error('In {{#each}} the item and index names must differ', start);
    }
    return { iterable: iterable.trim(), item, indexName: indexName ?? null };
  }

  parseBlockName(raw, start) {
    if (raw === '') throw this.error('{{#content}} requires a block name', start);
    if (raw.startsWith('"') || raw.startsWith("'")) {
      const quote = raw[0];
      const end = raw.indexOf(quote, 1);
      if (end === -1) throw this.error('Unterminated block name', start);
      return raw.slice(1, end);
    }
    if (!/^[A-Za-z0-9_-]+$/.test(raw)) {
      throw this.error(`Invalid block name "${raw}"`, start);
    }
    return raw;
  }

  closeBlock(keyword, start) {
    const frame = this.current;
    if (frame.kind === 'root' || frame.kind === 'element') {
      throw this.error(`Unexpected closing tag "{{/${keyword}}}"`, start);
    }
    const expected = frame.closeKeyword ?? frame.kind;
    if (expected !== keyword) {
      throw this.error(
        `Mismatched closing tag "{{/${keyword}}}"; expected "{{/${expected}}}"`,
        start
      );
    }
    this.frames.pop();
  }

  openElse(header, start) {
    const frame = this.current;
    if (frame.kind !== 'if' && frame.kind !== 'each') {
      throw this.error('"{{else}}" must be inside an {{#if}} or {{#each}} block', start);
    }
    if (frame.hasElse) throw this.error('Duplicate "{{else}}" in the same block', start);

    const rest = header.slice(4).trim();
    const target = frame.kind === 'if' ? frame.active : frame.node;

    if (rest !== '') {
      if (frame.kind !== 'if') {
        throw this.error('"{{else if}}" is only valid inside an {{#if}} block', start);
      }
      const elseIf = /^if\s+([\s\S]+)$/.exec(rest);
      if (!elseIf) throw this.error('Expected "{{else if expression}}"', start);
      const testSource = elseIf[1].trim();
      const nested = {
        type: 'If',
        test: this.compileExpression(testSource, start),
        source: testSource,
        negate: false,
        consequent: [],
        alternate: [],
        hasElse: false,
        index: start
      };
      target.alternate.push(nested);
      frame.active = nested;
      frame.list = nested.consequent;
      return;
    }

    frame.list = target.alternate;
    frame.hasElse = true;
  }

  parsePartial(body, start) {
    const scanner = new PartialScanner(body, start);
    const name = scanner.readName();
    if (!name) throw this.error('"{{>" requires a partial name', start);

    const props = [];
    while (!scanner.done()) {
      const propName = scanner.readPropName();
      if (!propName) break;
      const value = scanner.readValue();
      if (value === null) {
        props.push({ name: propName, parts: [{ type: 'literal', value: 'true' }] });
        continue;
      }
      const parts = value.quoted && !value.text.includes('{{')
        ? [{ type: 'literal', value: value.text }]
        : value.text.includes('{{')
          ? splitValueParts(value.text, (message) => {
              throw this.error(message, start);
            })
          : [{ type: 'expression', source: value.text, ast: null }];
      for (const part of parts) {
        if (part.type === 'expression') {
          part.ast = this.compileExpression(part.source, start);
        }
      }
      props.push({ name: propName, parts });
    }

    return { type: 'Partial', name, props, index: start };
  }

  parseElement() {
    const start = this.pos;

    if (this.source[this.pos + 1] === '/') {
      this.closeElement(start);
      return;
    }

    this.pos += 1;
    TAG_NAME_RE.lastIndex = this.pos;
    const tagMatch = TAG_NAME_RE.exec(this.source);
    if (!tagMatch) throw this.error('Invalid tag name', start);

    const tag = tagMatch[0].toLowerCase();
    this.pos = TAG_NAME_RE.lastIndex;

    const attributes = [];
    let selfClosing = false;

    for (;;) {
      while (this.pos < this.source.length && isWhitespace(this.source[this.pos])) this.pos += 1;
      if (this.pos >= this.source.length) throw this.error(`Unclosed <${tag}> tag`, start);

      if (this.source[this.pos] === '>') {
        this.pos += 1;
        break;
      }

      if (this.source.startsWith('/>', this.pos)) {
        this.pos += 2;
        selfClosing = true;
        break;
      }

      if (this.source.startsWith('{{', this.pos)) {
        const close = findMustacheEnd(this.source, this.pos);
        if (close === -1) throw this.error('Unclosed "{{" inside a tag', this.pos);
        const inner = this.source.slice(this.pos + 2, close).trim();
        const attrStart = this.pos;
        this.pos = close + 2;

        if (inner === '' || /^[#/>!]/.test(inner) || inner.startsWith('else')) {
          throw this.error(
            `Only expressions are allowed between attributes inside a tag; found "{{${inner}}}"`,
            attrStart
          );
        }

        attributes.push({
          name: null,
          splat: true,
          source: inner,
          ast: this.compileExpression(inner, attrStart),
          parts: null,
          index: attrStart
        });
        continue;
      }

      ATTRIBUTE_NAME_RE.lastIndex = this.pos;
      const attrMatch = ATTRIBUTE_NAME_RE.exec(this.source);
      if (!attrMatch) {
        throw this.error(`Invalid attribute in <${tag}>`, this.pos);
      }

      const attrStart = this.pos;
      const name = attrMatch[0];
      this.pos = ATTRIBUTE_NAME_RE.lastIndex;

      while (this.pos < this.source.length && isWhitespace(this.source[this.pos])) this.pos += 1;

      let parts = null;
      if (this.source[this.pos] === '=') {
        this.pos += 1;
        while (this.pos < this.source.length && isWhitespace(this.source[this.pos])) this.pos += 1;
        const quote = this.source[this.pos];

        if (quote === '"' || quote === "'") {
          const end = this.source.indexOf(quote, this.pos + 1);
          if (end === -1) throw this.error(`Unterminated value for attribute "${name}"`, this.pos);
          const raw = this.source.slice(this.pos + 1, end);
          this.pos = end + 1;
          parts = splitValueParts(raw, (message, offset) => {
            throw this.error(message, this.pos - raw.length - 1 + offset);
          });
        } else {
          const valueStart = this.pos;
          while (
            this.pos < this.source.length &&
            !isWhitespace(this.source[this.pos]) &&
            this.source[this.pos] !== '>' &&
            !this.source.startsWith('/>', this.pos)
          ) {
            this.pos += 1;
          }
          const raw = this.source.slice(valueStart, this.pos);
          if (raw === '') throw this.error(`Missing value for attribute "${name}"`, valueStart);
          parts = splitValueParts(raw, (message, offset) => {
            throw this.error(message, valueStart + offset);
          });
        }
      }

      if (parts) {
        for (const part of parts) {
          if (part.type === 'expression') {
            part.ast = this.compileExpression(part.source, attrStart);
          }
        }
      }

      if (attributes.some((attr) => attr.name && attr.name.toLowerCase() === name.toLowerCase())) {
        throw this.error(`Duplicate attribute "${name}" in <${tag}>`, attrStart);
      }

      attributes.push({ name, parts, index: attrStart });
    }

    const node = {
      type: 'Element',
      tag,
      component: isComponentTag(tag),
      attributes,
      children: [],
      selfClosing,
      index: start
    };
    this.append(node);

    if (VOID_ELEMENTS.has(tag) || selfClosing) return;

    if (tag === 'style') {
      node.children.push(...this.readStyleContent(start));
      return;
    }

    if (RAW_TEXT_ELEMENTS.has(tag)) {
      node.children.push({ type: 'Text', value: this.readRawText(tag, start), raw: true });
      return;
    }

    if (TEXT_ONLY_ELEMENTS.has(tag)) {
      this.readTextOnly(tag, start, node);
      return;
    }

    this.applyImplicitClose(tag, start);
    this.frames.push({ kind: 'element', node, list: node.children, name: tag, openedAt: start });
  }

  applyImplicitClose(tag, start) {
    const closable = IMPLICIT_CLOSE[tag];
    if (!closable) return;
    for (;;) {
      const frame = this.current;
      if (frame.kind !== 'element' || !closable.includes(frame.name)) return;
      this.frames.pop();
    }
  }

  /**
   * `<style>` accepts text, interpolation and blocks, because generated CSS
   * (staggered view transitions, dynamic tokens) is a first-class use case.
   * Interpolated values are escaped for CSS. `<script>` never interpolates.
   */
  readStyleContent(start) {
    const closeIndex = this.source.toLowerCase().indexOf('</style', this.pos);
    if (closeIndex === -1) throw this.error('Unclosed <style> tag', start);

    const inner = this.source.slice(this.pos, closeIndex);
    const { line } = this.lineColAt(this.pos);
    const sub = new TemplateParser(inner, this.file, {
      inline: true,
      css: true,
      lineOffset: this.lineOffset + line - 1
    });
    const nodes = sub.parse().children;

    const afterClose = this.source.indexOf('>', closeIndex);
    this.pos = afterClose === -1 ? this.source.length : afterClose + 1;
    return nodes;
  }

  readRawText(tag, start) {
    const closeIndex = this.source.toLowerCase().indexOf(`</${tag}`, this.pos);
    if (closeIndex === -1) throw this.error(`Unclosed <${tag}> tag`, start);
    const text = this.source.slice(this.pos, closeIndex);
    const afterClose = this.source.indexOf('>', closeIndex);
    if (afterClose === -1) throw this.error(`Unclosed </${tag}> tag`, closeIndex);
    this.pos = afterClose + 1;
    return text;
  }

  readTextOnly(tag, start, node) {
    const closeIndex = this.source.toLowerCase().indexOf(`</${tag}`, this.pos);
    if (closeIndex === -1) throw this.error(`Unclosed <${tag}> tag`, start);
    const text = this.source.slice(this.pos, closeIndex);
    this.pos = closeIndex;

    let index = 0;
    while (index < text.length) {
      const open = text.indexOf('{{', index);
      if (open === -1) {
        if (index < text.length) node.children.push({ type: 'Text', value: text.slice(index) });
        break;
      }
      if (open > index) node.children.push({ type: 'Text', value: text.slice(index, open) });
      const close = findMustacheEnd(text, open);
      if (close === -1) throw this.error(`Unclosed "{{" inside <${tag}>`, this.pos + open);
      const inner = text.slice(open + 2, close).trim();
      if (inner !== '' && !inner.startsWith('#')) {
        node.children.push({
          type: 'Interpolation',
          source: inner,
          ast: this.compileExpression(inner, this.pos + open),
          index: this.pos + open
        });
      } else if (inner !== '') {
        throw this.error(`Blocks are not supported inside <${tag}>`, this.pos + open);
      }
      index = close + 2;
    }

    this.pos = this.source.indexOf('>', closeIndex) + 1;
  }

  closeElement(start) {
    this.pos += 2;
    TAG_NAME_RE.lastIndex = this.pos;
    const tagMatch = TAG_NAME_RE.exec(this.source);
    if (!tagMatch) throw this.error('Invalid closing tag', start);
    const tag = tagMatch[0].toLowerCase();
    this.pos = TAG_NAME_RE.lastIndex;

    while (this.pos < this.source.length && isWhitespace(this.source[this.pos])) this.pos += 1;
    if (this.source[this.pos] !== '>') throw this.error(`Malformed closing tag </${tag}>`, start);
    this.pos += 1;

    const frame = this.current;
    if (frame.kind !== 'element') {
      throw this.error(`Unexpected closing tag </${tag}>`, start);
    }
    if (frame.name !== tag) {
      const { line, column } = this.lineColAt(frame.openedAt ?? 0);
      throw this.error(
        `Mismatched closing tag </${tag}>; <${frame.name}> opened at line ${line}:${column} is still open`,
        start
      );
    }
    this.frames.pop();
  }
}

class PartialScanner {
  constructor(text, offset) {
    this.text = text;
    this.pos = 0;
    this.offset = offset;
  }

  done() {
    this.skipSpace();
    return this.pos >= this.text.length;
  }

  skipSpace() {
    while (this.pos < this.text.length && isWhitespace(this.text[this.pos])) this.pos += 1;
  }

  readName() {
    this.skipSpace();
    const start = this.pos;
    if (this.text[this.pos] === '"' || this.text[this.pos] === "'") {
      const quote = this.text[this.pos];
      const end = this.text.indexOf(quote, this.pos + 1);
      if (end === -1) throw new TemplateError('Unterminated partial name', { line: null, column: null });
      this.pos = end + 1;
      return this.text.slice(start + 1, end);
    }
    while (this.pos < this.text.length && !isWhitespace(this.text[this.pos])) {
      if (this.text[this.pos] === '=') break;
      this.pos += 1;
    }
    return this.text.slice(start, this.pos);
  }

  readPropName() {
    this.skipSpace();
    const start = this.pos;
    while (this.pos < this.text.length && !isWhitespace(this.text[this.pos])) {
      const ch = this.text[this.pos];
      if (ch === '=') break;
      this.pos += 1;
    }
    return this.text.slice(start, this.pos);
  }

  readValue() {
    if (this.text[this.pos] !== '=') return null;
    this.pos += 1;
    this.skipSpace();

    const quote = this.text[this.pos];
    if (quote === '"' || quote === "'") {
      const end = this.text.indexOf(quote, this.pos + 1);
      if (end === -1) throw new TemplateError('Unterminated partial property value');
      const text = this.text.slice(this.pos + 1, end);
      this.pos = end + 1;
      return { text, quoted: true };
    }

    const start = this.pos;
    let depth = 0;
    while (this.pos < this.text.length) {
      const ch = this.text[this.pos];
      if (ch === '(' || ch === '[') depth += 1;
      else if (ch === ')' || ch === ']') depth -= 1;
      else if (isWhitespace(ch) && depth <= 0) break;
      this.pos += 1;
    }
    return { text: this.text.slice(start, this.pos), quoted: false };
  }
}

/**
 * Parses a template source into an AST.
 * @param {string} source
 * @param {{file?: string}} [options]
 */
export function parseTemplate(source, options = {}) {
  if (typeof source !== 'string') throw new TypeError('Template source must be a string');
  return new TemplateParser(source, options.file ?? null).parse();
}

/**
 * Collects the names a component template consumes: expression identifiers and
 * the attribute names it writes itself. Everything else can be forwarded to the
 * `{{ attrs }}` splat without producing duplicated attributes.
 */
export function collectConsumed(ast) {
  const identifiers = new Set();
  const attributes = new Set();

  const fromExpression = (node) => {
    collectIdentifiers(node, identifiers);
  };

  const visit = (node) => {
    if (!node || typeof node !== 'object') return;

    if (node.type === 'Element') {
      for (const attribute of node.attributes) {
        if (attribute.splat) {
          fromExpression(attribute.ast);
          continue;
        }
        attributes.add(attribute.name.toLowerCase());
        for (const part of attribute.parts ?? []) {
          if (part.type === 'expression') fromExpression(part.ast);
        }
      }
      for (const child of node.children) visit(child);
      return;
    }

    if (node.type === 'Interpolation') {
      fromExpression(node.ast);
      return;
    }

    if (node.type === 'If') fromExpression(node.test);
    if (node.type === 'Each') fromExpression(node.iterable);
    if (node.type === 'Partial') {
      for (const prop of node.props) {
        for (const part of prop.parts) {
          if (part.type === 'expression') fromExpression(part.ast);
        }
      }
    }

    for (const group of [node.consequent, node.alternate, node.children]) {
      if (Array.isArray(group)) for (const child of group) visit(child);
    }
  };

  visit(ast);
  return { identifiers, attributes };
}

function collectIdentifiers(node, target) {
  if (!node || typeof node !== 'object') return target;

  switch (node.type) {
    case 'Identifier':
      target.add(node.name);
      break;
    case 'Member':
      collectIdentifiers(node.object, target);
      collectIdentifiers(node.computed, target);
      break;
    case 'Unary':
      collectIdentifiers(node.argument, target);
      break;
    case 'Binary':
    case 'Logical':
      collectIdentifiers(node.left, target);
      collectIdentifiers(node.right, target);
      break;
    case 'Conditional':
      collectIdentifiers(node.test, target);
      collectIdentifiers(node.consequent, target);
      collectIdentifiers(node.alternate, target);
      break;
    case 'Call':
      for (const arg of node.args) collectIdentifiers(arg, target);
      break;
    default:
      break;
  }

  return target;
}

/**
 * Walks an AST and returns the set of client capabilities the template needs:
 * `f-*` directives and component tags. Used by the build analyzer and by the
 * server to decide whether the runtime must be loaded.
 *
 * @param {object} ast
 * @returns {{directives: Set<string>, components: Set<string>, needsRuntime: boolean}}
 */
export function collectCapabilities(ast) {
  const directives = new Set();
  const components = new Set();

  const visit = (node) => {
    if (!node || typeof node !== 'object') return;

    if (node.type === 'Element') {
      if (node.component) components.add(node.tag);
      for (const attr of node.attributes) {
        if (attr.splat) continue;
        if (attr.name.startsWith('f-')) {
          directives.add(attr.name);
        }
      }
      for (const child of node.children) visit(child);
      return;
    }

    if (node.consequent) for (const child of node.consequent) visit(child);
    if (node.alternate) for (const child of node.alternate) visit(child);
    if (node.children) for (const child of node.children) visit(child);
  };

  visit(ast);

  return {
    directives,
    components,
    needsRuntime: directives.size > 0
  };
}
