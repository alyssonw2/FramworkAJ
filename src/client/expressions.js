/**
 * FLASH client runtime — expression helpers.
 *
 * The browser uses the same restricted expression language as the server. There
 * is no `eval`: templates and directives are interpreted from an AST, and only
 * data registered in the client state can be read.
 */

import { evaluateExpression } from '../shared/expression.js';

export {
  evaluateExpression,
  parseExpression,
  ExpressionError
} from '../shared/expression.js';

/**
 * Evaluates a directive expression against the client scope. Unknown identifiers
 * resolve to `undefined` (the runtime is not strict) and a warning is printed so
 * mistakes are not silent.
 *
 * @param {string} source
 * @param {object} scope
 * @param {string} [label]
 */
export function evaluate(source, scope, label = '') {
  if (typeof source !== 'string' || source.trim() === '') return undefined;
  try {
    return evaluateExpression(source, scope, { strict: false });
  } catch (error) {
    console.warn(`[flash] expressão inválida${label ? ` em ${label}` : ''}: "${source}"`, error);
    return undefined;
  }
}

const PATH_RE = /^[A-Za-z_$][A-Za-z0-9_$]*(?:\.[A-Za-z_$][A-Za-z0-9_$]*)*$/;

/** True for `a.b.c` style paths used by `f-model`. */
export function isPath(source) {
  return PATH_RE.test(String(source ?? '').trim());
}

export function getPath(object, path, fallback = undefined) {
  if (!object || !isPath(path)) return fallback;
  let current = object;
  for (const key of path.trim().split('.')) {
    if (current === null || current === undefined) return fallback;
    if (typeof current !== 'object') return fallback;
    if (!Object.hasOwn(current, key)) return fallback;
    current = current[key];
  }
  return current;
}

export function setPath(object, path, value) {
  if (!object || !isPath(path)) return false;
  const keys = path.trim().split('.');
  let current = object;

  for (let i = 0; i < keys.length - 1; i += 1) {
    const key = keys[i];
    if (current[key] === null || typeof current[key] !== 'object') current[key] = {};
    current = current[key];
  }

  current[keys[keys.length - 1]] = value;
  return true;
}
