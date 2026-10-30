/**
 * FLASH — caminhos do framework.
 *
 * `import { componentsDir, frameworkRoot } from 'flash/paths'`
 *
 * Existe para que aplicações não precisem montar caminhos relativos até o
 * código do framework (`../../node_modules/flash/src/ui`). Isso quebrava quando
 * o projeto era empacotado para deploy; com este módulo o mesmo código funciona
 * rodando do repositório e rodando de `node_modules/flash`.
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));

/** Raiz do pacote do framework (contém o `package.json`). */
export const frameworkRoot = path.resolve(HERE, '..');

/** Diretório `src/` do framework. */
export const srcDir = HERE;

/** Componentes server-side prontos (`ui:button`, `ui:field`, ...). */
export const componentsDir = path.join(HERE, 'ui');

/** Runtime e módulos do navegador. */
export const clientDir = path.join(HERE, 'client');

/** Painel de desenvolvimento. */
export const devDir = path.join(HERE, 'dev');

/** Código compartilhado entre servidor e navegador. */
export const sharedDir = path.join(HERE, 'shared');

/** Adaptadores (Express, node:http, sessão, CSRF...). */
export const adaptersDir = path.join(HERE, 'adapters');

/**
 * Resolve um caminho dentro do pacote do framework.
 * @param {...string} segments
 */
export function resolve(...segments) {
  return path.join(HERE, ...segments);
}
