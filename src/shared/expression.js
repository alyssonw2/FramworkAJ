/**
 * FLASH — restricted expression language.
 *
 * Shared by the server template engine and the browser runtime.
 * The grammar is intentionally tiny and interpreted from an AST built by a
 * hand-written parser. There is no `eval`, no `new Function`, no access to
 * globals (`window`, `document`, `process`, `globalThis`) and no method calls
 * on user data.
 *
 * Grammar (lowest to highest precedence):
 *
 *   conditional  := logicalOr ( '?' conditional ':' conditional )?
 *   logicalOr    := logicalAnd ( '||' logicalAnd )*
 *   logicalAnd   := equality ( '&&' equality )*
 *   equality     := relational ( ('==' | '!=' | '===' | '!==') relational )*
 *   relational   := additive ( ('<' | '>' | '<=' | '>=') additive )*
 *   additive     := multiplicative ( ('+' | '-') multiplicative )*
 *   multiplicative := unary ( ('*' | '/' | '%') unary )*
 *   unary        := ('!' | '-' | '+') unary | postfix
 *   postfix      := primary ( '.' identifier | '[' expression ']' | '(' args ')' )*
 *   primary      := number | string | 'true' | 'false' | 'null' | identifier | '(' expression ')'
 *
 * Supported calls: helpers registered in the scope (for example `safeHtml()`).
 */

export class ExpressionError extends Error {
  constructor(message, info = {}) {
    super(message);
    this.name = 'ExpressionError';
    this.expression = info.expression;
    this.position = info.position ?? -1;
    this.index = info.index ?? -1;
  }
}

/** Property names that would allow prototype access or injection. */
const BLOCKED_KEYS = new Set(['__proto__', 'prototype', 'constructor']);

const MAX_EXPRESSION_LENGTH = 1024;
const MAX_EVAL_DEPTH = 32;
const MAX_AST_NODES = 512;
const AST_CACHE_LIMIT = 2000;

const KEYWORDS = new Set(['true', 'false', 'null', 'undefined']);

const PUNCTUATION = [
  '===', '!==', '==', '!=', '<=', '>=', '&&', '||',
  '<', '>', '!', '+', '-', '*', '/', '%',
  '(', ')', '[', ']', '.', ',', '?', ':'
];

const ESCAPES = { n: '\n', t: '\t', r: '\r', b: '\b', f: '\f', v: '\v', 0: '\0', '\\': '\\', '"': '"', "'": "'" };

function isDigit(ch) {
  return ch >= '0' && ch <= '9';
}

function isIdentifierStart(ch) {
  return (ch >= 'a' && ch <= 'z') || (ch >= 'A' && ch <= 'Z') || ch === '_' || ch === '$';
}

function isIdentifierPart(ch) {
  return isIdentifierStart(ch) || isDigit(ch);
}

function tokenize(source) {
  const tokens = [];
  let i = 0;

  while (i < source.length) {
    const ch = source[i];

    if (ch === ' ' || ch === '\t' || ch === '\n' || ch === '\r') {
      i += 1;
      continue;
    }

    if (ch === '"' || ch === "'") {
      const quote = ch;
      const start = i;
      let value = '';
      let j = i + 1;
      let closed = false;

      while (j < source.length) {
        const c = source[j];
        if (c === '\\') {
          const next = source[j + 1];
          if (next === undefined) break;
          value += Object.hasOwn(ESCAPES, next) ? ESCAPES[next] : next;
          j += 2;
          continue;
        }
        if (c === quote) {
          closed = true;
          j += 1;
          break;
        }
        value += c;
        j += 1;
      }

      if (!closed) {
        throw new ExpressionError('Unterminated string literal', { expression: source, position: start });
      }

      tokens.push({ type: 'string', value, start, end: j });
      i = j;
      continue;
    }

    if (isDigit(ch) || (ch === '.' && isDigit(source[i + 1]))) {
      const start = i;
      let j = i;
      while (j < source.length && isDigit(source[j])) j += 1;
      if (source[j] === '.') {
        j += 1;
        while (j < source.length && isDigit(source[j])) j += 1;
      }
      if (source[j] === 'e' || source[j] === 'E') {
        let k = j + 1;
        if (source[k] === '+' || source[k] === '-') k += 1;
        if (isDigit(source[k])) {
          k += 1;
          while (k < source.length && isDigit(source[k])) k += 1;
          j = k;
        }
      }
      const raw = source.slice(start, j);
      const value = Number(raw);
      if (!Number.isFinite(value)) {
        throw new ExpressionError(`Invalid number "${raw}"`, { expression: source, position: start });
      }
      tokens.push({ type: 'number', value, start, end: j });
      i = j;
      continue;
    }

    if (isIdentifierStart(ch)) {
      const start = i;
      let j = i;
      while (j < source.length && isIdentifierPart(source[j])) j += 1;
      const name = source.slice(start, j);
      tokens.push({ type: KEYWORDS.has(name) ? 'keyword' : 'identifier', value: name, start, end: j });
      i = j;
      continue;
    }

    let matched = null;
    for (const op of PUNCTUATION) {
      if (source.startsWith(op, i)) {
        matched = op;
        break;
      }
    }

    if (!matched) {
      throw new ExpressionError(`Unexpected character "${ch}"`, { expression: source, position: i });
    }

    tokens.push({ type: 'punct', value: matched, start: i, end: i + matched.length });
    i += matched.length;
  }

  tokens.push({ type: 'eof', value: '', start: source.length, end: source.length });
  return tokens;
}

class Parser {
  constructor(source) {
    this.source = source;
    this.tokens = tokenize(source);
    this.index = 0;
    this.nodeCount = 0;
  }

  peek() {
    return this.tokens[this.index];
  }

  next() {
    const token = this.tokens[this.index];
    this.index += 1;
    return token;
  }

  isPunct(value) {
    const token = this.peek();
    return token.type === 'punct' && token.value === value;
  }

  matchPunct(value) {
    if (this.isPunct(value)) {
      this.next();
      return true;
    }
    return false;
  }

  expectPunct(value) {
    const token = this.peek();
    if (token.type === 'punct' && token.value === value) return this.next();
    throw new ExpressionError(
      `Expected "${value}" but found ${token.type === 'eof' ? 'end of expression' : `"${token.value}"`}`,
      { expression: this.source, position: token.start }
    );
  }

  enter() {
    this.parseDepth = (this.parseDepth ?? 0) + 1;
    if (this.parseDepth > MAX_EVAL_DEPTH) {
      throw new ExpressionError('Expression is nested too deeply', { expression: this.source });
    }
  }

  leave() {
    this.parseDepth -= 1;
  }

  node(node) {
    this.nodeCount += 1;
    if (this.nodeCount > MAX_AST_NODES) {
      throw new ExpressionError('Expression is too complex', { expression: this.source });
    }
    return node;
  }

  parse() {
    const node = this.parseConditional();
    const token = this.peek();
    if (token.type !== 'eof') {
      throw new ExpressionError(`Unexpected "${token.value}"`, { expression: this.source, position: token.start });
    }
    return node;
  }

  parseConditional() {
    const test = this.parseLogicalOr();
    if (!this.isPunct('?')) return test;
    this.next();
    const consequent = this.parseConditional();
    this.expectPunct(':');
    const alternate = this.parseConditional();
    return this.node({ type: 'Conditional', test, consequent, alternate });
  }

  parseBinaryLevel(operators, nextLevel) {
    let left = nextLevel.call(this);
    for (;;) {
      const token = this.peek();
      if (token.type !== 'punct' || !operators.includes(token.value)) return left;
      this.next();
      const right = nextLevel.call(this);
      left = this.node({
        type: token.value === '&&' || token.value === '||' ? 'Logical' : 'Binary',
        operator: token.value,
        left,
        right
      });
    }
  }

  parseLogicalOr() {
    return this.parseBinaryLevel(['||'], this.parseLogicalAnd);
  }

  parseLogicalAnd() {
    return this.parseBinaryLevel(['&&'], this.parseEquality);
  }

  parseEquality() {
    return this.parseBinaryLevel(['==', '!=', '===', '!=='], this.parseRelational);
  }

  parseRelational() {
    return this.parseBinaryLevel(['<', '>', '<=', '>='], this.parseAdditive);
  }

  parseAdditive() {
    return this.parseBinaryLevel(['+', '-'], this.parseMultiplicative);
  }

  parseMultiplicative() {
    return this.parseBinaryLevel(['*', '/', '%'], this.parseUnary);
  }

  parseUnary() {
    const token = this.peek();
    if (token.type === 'punct' && (token.value === '!' || token.value === '-' || token.value === '+')) {
      this.next();
      this.enter();
      try {
        return this.node({ type: 'Unary', operator: token.value, argument: this.parseUnary() });
      } finally {
        this.leave();
      }
    }
    return this.parsePostfix();
  }

  parsePostfix() {
    let node = this.parsePrimary();
    for (;;) {
      if (this.isPunct('.')) {
        this.next();
        const token = this.next();
        if (token.type !== 'identifier' && token.type !== 'keyword') {
          throw new ExpressionError('Expected a property name after "."', {
            expression: this.source,
            position: token.start
          });
        }
        this.assertSafeKey(token.value, token.start);
        node = this.node({ type: 'Member', object: node, property: token.value, computed: null });
        continue;
      }
      if (this.isPunct('[')) {
        this.next();
        const property = this.parseConditional();
        this.expectPunct(']');
        node = this.node({ type: 'Member', object: node, property: null, computed: property });
        continue;
      }
      if (this.isPunct('(')) {
        if (node.type !== 'Identifier') {
          throw new ExpressionError('Only helpers registered in the render context can be called', {
            expression: this.source,
            position: this.peek().start
          });
        }
        this.next();
        const args = [];
        if (!this.isPunct(')')) {
          for (;;) {
            args.push(this.parseConditional());
            if (this.matchPunct(',')) continue;
            break;
          }
        }
        this.expectPunct(')');
        node = this.node({ type: 'Call', name: node.name, args });
        continue;
      }
      return node;
    }
  }

  assertSafeKey(key, position) {
    if (BLOCKED_KEYS.has(key)) {
      throw new ExpressionError(`Access to "${key}" is not allowed`, {
        expression: this.source,
        position
      });
    }
  }

  parsePrimary() {
    const token = this.next();

    if (token.type === 'number' || token.type === 'string') {
      return this.node({ type: 'Literal', value: token.value });
    }

    if (token.type === 'keyword') {
      const values = { true: true, false: false, null: null, undefined };
      return this.node({ type: 'Literal', value: values[token.value] });
    }

    if (token.type === 'identifier') {
      this.assertSafeKey(token.value, token.start);
      return this.node({ type: 'Identifier', name: token.value });
    }

    if (token.type === 'punct' && token.value === '(') {
      this.enter();
      try {
        const node = this.parseConditional();
        this.expectPunct(')');
        return node;
      } finally {
        this.leave();
      }
    }

    throw new ExpressionError(
      token.type === 'eof'
        ? 'Unexpected end of expression'
        : `Unexpected "${token.value}"`,
      { expression: this.source, position: token.start }
    );
  }
}

const astCache = new Map();

/**
 * Parses an expression into an AST. Results are cached, because templates are
 * parsed once and rendered many times.
 *
 * @param {string} source
 * @returns {object} AST root
 */
export function parseExpression(source) {
  if (typeof source !== 'string') {
    throw new ExpressionError('Expression must be a string');
  }
  const trimmed = source.trim();
  if (trimmed === '') {
    throw new ExpressionError('Empty expression', { expression: source });
  }
  if (trimmed.length > MAX_EXPRESSION_LENGTH) {
    throw new ExpressionError(`Expression exceeds ${MAX_EXPRESSION_LENGTH} characters`, { expression: source });
  }

  const cached = astCache.get(trimmed);
  if (cached) return cached;

  const ast = new Parser(trimmed).parse();

  if (astCache.size >= AST_CACHE_LIMIT) {
    astCache.delete(astCache.keys().next().value);
  }
  astCache.set(trimmed, ast);
  return ast;
}

/** Clears the internal AST cache. Intended for tests and hot reload tooling. */
export function clearExpressionCache() {
  astCache.clear();
}

function readIdentifier(name, scope, strict, expression) {
  if (scope !== null && typeof scope === 'object' && Object.hasOwn(scope, name)) {
    return scope[name];
  }
  if (Object.hasOwn(globalHelpers, name)) {
    return globalHelpers[name];
  }
  if (strict) {
    throw new ExpressionError(`"${name}" is not defined in the render context`, { expression });
  }
  return undefined;
}

function readMember(object, key, strict, expression, full) {
  const name = typeof key === 'string' ? key : String(key);

  if (BLOCKED_KEYS.has(name)) {
    throw new ExpressionError(`Access to "${name}" is not allowed`, { expression });
  }

  if (object === null || object === undefined) {
    if (strict) {
      throw new ExpressionError(`Cannot read "${name}" of ${object}`, { expression });
    }
    return undefined;
  }

  const type = typeof object;

  if (type === 'string') {
    if (name === 'length') return object.length;
    if (/^\d+$/.test(name)) return object[Number(name)];
    return undefined;
  }

  if (type === 'number' || type === 'boolean' || type === 'bigint') {
    return undefined;
  }

  if (type === 'function') {
    return undefined;
  }

  if (Array.isArray(object)) {
    if (name === 'length') return object.length;
    if (/^\d+$/.test(name)) return object[Number(name)];
    return undefined;
  }

  if (object instanceof Map) {
    return object.get(name);
  }

  if (Object.hasOwn(object, name)) {
    return object[name];
  }

  if (full) {
    throw new ExpressionError(`Property "${name}" does not exist on the value being read`, { expression });
  }
  return undefined;
}

function coerceNumber(value) {
  if (typeof value === 'number') return value;
  if (typeof value === 'string' && value.trim() !== '') {
    const n = Number(value);
    return Number.isNaN(n) ? Number.NaN : n;
  }
  if (typeof value === 'boolean') return value ? 1 : 0;
  return Number.NaN;
}

function evalNode(node, scope, options, depth) {
  if (depth > MAX_EVAL_DEPTH) {
    throw new ExpressionError('Expression evaluation is too deep', { expression: options.expression });
  }

  const strict = options.strict !== false;
  const full = options.strict === 'full';
  const expression = options.expression;

  switch (node.type) {
    case 'Literal':
      return node.value;

    case 'Identifier':
      return readIdentifier(node.name, scope, strict, expression);

    case 'Member': {
      const object = evalNode(node.object, scope, options, depth + 1);
      if (node.computed) {
        const key = evalNode(node.computed, scope, options, depth + 1);
        return readMember(object, key, strict, expression, full);
      }
      return readMember(object, node.property, strict, expression, full);
    }

    case 'Unary': {
      const value = evalNode(node.argument, scope, options, depth + 1);
      if (node.operator === '!') return !value;
      if (node.operator === '-') return -coerceNumber(value);
      return +coerceNumber(value);
    }

    case 'Logical': {
      const left = evalNode(node.left, scope, options, depth + 1);
      if (node.operator === '&&') {
        return left ? evalNode(node.right, scope, options, depth + 1) : left;
      }
      return left ? left : evalNode(node.right, scope, options, depth + 1);
    }

    case 'Binary': {
      const left = evalNode(node.left, scope, options, depth + 1);
      const right = evalNode(node.right, scope, options, depth + 1);

      switch (node.operator) {
        case '==': return left == right; // eslint-disable-line eqeqeq
        case '!=': return left != right; // eslint-disable-line eqeqeq
        case '===': return left === right;
        case '!==': return left !== right;
        case '<': return left < right;
        case '>': return left > right;
        case '<=': return left <= right;
        case '>=': return left >= right;
        case '+':
          if (typeof left === 'string' || typeof right === 'string') {
            return `${toText(left)}${toText(right)}`;
          }
          return coerceNumber(left) + coerceNumber(right);
        case '-': return coerceNumber(left) - coerceNumber(right);
        case '*': return coerceNumber(left) * coerceNumber(right);
        case '/': return coerceNumber(left) / coerceNumber(right);
        case '%': return coerceNumber(left) % coerceNumber(right);
        default:
          throw new ExpressionError(`Unsupported operator "${node.operator}"`, { expression });
      }
    }

    case 'Conditional':
      return evalNode(node.test, scope, options, depth + 1)
        ? evalNode(node.consequent, scope, options, depth + 1)
        : evalNode(node.alternate, scope, options, depth + 1);

    case 'Call': {
      const helpers = options.helpers ?? {};
      const fn = Object.hasOwn(helpers, node.name)
        ? helpers[node.name]
        : Object.hasOwn(globalHelpers, node.name)
          ? globalHelpers[node.name]
          : undefined;

      if (typeof fn !== 'function') {
        throw new ExpressionError(
          `"${node.name}" is not a registered helper and cannot be called`,
          { expression }
        );
      }

      const args = node.args.map((arg) => evalNode(arg, scope, options, depth + 1));
      return fn(...args);
    }

    default:
      throw new ExpressionError(`Unsupported expression node "${node.type}"`, { expression });
  }
}

function toText(value) {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value.toISOString();
  if (typeof value === 'object') return JSON.stringify(value);
  return String(value);
}

/**
 * Helpers available to every expression without being injected in the scope.
 * Kept intentionally tiny.
 */
const globalHelpers = Object.create(null);

/**
 * Registers process-wide helpers. Prefer `flash.helpers()` which scopes helpers
 * to an application instance; this exists for the escaping primitives.
 * @param {Record<string, Function>} helpers
 */
export function registerGlobalHelpers(helpers) {
  for (const [name, fn] of Object.entries(helpers)) {
    if (typeof fn === 'function') globalHelpers[name] = fn;
  }
}

/**
 * Evaluates a parsed AST against a scope.
 *
 * `strict` levels:
 *   `false`  – missing values resolve to `undefined` (production default);
 *   `true`   – unknown identifiers and reads on null/undefined throw (dev default);
 *   `'full'` – additionally throws when a property does not exist.
 *
 * @param {object} ast
 * @param {object} scope
 * @param {{strict?: boolean|'full', helpers?: Record<string, Function>, expression?: string}} [options]
 */
export function evaluateAst(ast, scope, options = {}) {
  if (!ast) throw new ExpressionError('Cannot evaluate an empty expression');
  return evalNode(ast, scope, options, 0);
}

/**
 * Evaluates an expression against a scope, caching the parse step.
 *
 * @param {string} source
 * @param {object} scope
 * @param {{strict?: boolean, helpers?: Record<string, Function>}} [options]
 */
export function evaluateExpression(source, scope, options = {}) {
  const ast = parseExpression(source);
  return evaluateAst(ast, scope, { ...options, expression: source });
}

/**
 * Compiles an expression into a reusable evaluator.
 * @param {string} source
 */
export function compileExpression(source) {
  const ast = parseExpression(source);
  return (scope, options = {}) => evaluateAst(ast, scope, { ...options, expression: source });
}

/** True when the name is a plain identifier that the language accepts. */
export function isIdentifier(name) {
  if (typeof name !== 'string' || name === '') return false;
  if (!isIdentifierStart(name[0])) return false;
  for (let i = 1; i < name.length; i += 1) {
    if (!isIdentifierPart(name[i])) return false;
  }
  return !BLOCKED_KEYS.has(name);
}

export const EXPRESSION_LIMITS = Object.freeze({
  maxLength: MAX_EXPRESSION_LENGTH,
  maxDepth: MAX_EVAL_DEPTH,
  maxNodes: MAX_AST_NODES
});
