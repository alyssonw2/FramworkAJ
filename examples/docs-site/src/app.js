/**
 * FLASH documentation site.
 *
 * The site is built with FLASH itself: Markdown is rendered on the server and
 * served as HTML, with a small client script for search, the table of contents
 * and copy buttons.
 *
 *   npm run docs   →  http://localhost:4000
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';

import { createFlash } from '../../../src/index.js';
import { expressAdapter } from '../../../src/adapters/express.js';
import { securityHeaders } from '../../../src/adapters/security.js';
import { loadDocs } from './content.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const DOCS_DIR = path.resolve(HERE, '..', '..', '..', 'docs');
const FRAMEWORK_UI = path.resolve(HERE, '..', '..', '..', 'src', 'ui');

const flash = createFlash({
  views: path.join(ROOT, 'views'),
  components: [FRAMEWORK_UI, path.join(ROOT, 'components')],
  publicDir: path.join(ROOT, 'public'),
  publicPrefix: '/assets',
  dev: process.env.NODE_ENV !== 'production',
  helpers: {
    pad(value, length = 2) {
      return String(value ?? '').padStart(length, '0');
    }
  }
});

flash.use(
  securityHeaders({
    // The docs site is static and self-contained; the default CSP already fits.
    frameOptions: 'SAMEORIGIN'
  })
);

flash.use(async (ctx) => {
  ctx.locals.siteName = 'FLASH';
  ctx.locals.currentPath = ctx.path;
  return undefined;
});

flash.get('/', async (ctx) => {
  const { docs, sections } = await loadDocs(DOCS_DIR);
  const first = docs[0];

  return ctx.render('docs/home', {
    title: 'FLASH — framework HTML-first',
    description:
      'FLASH é um framework full-stack HTML-first: o servidor entrega HTML pronto e o navegador recebe só o JavaScript necessário.',
    sections,
    total: docs.length,
    firstSlug: first?.slug ?? 'introducao'
  });
});

flash.get('/docs', async (ctx) => ctx.redirect('/docs/introducao'));

flash.get('/docs/:slug', async (ctx) => {
  const { bySlug, sections } = await loadDocs(DOCS_DIR);
  const doc = bySlug.get(ctx.params.slug);

  if (!doc) return ctx.notFound(`Documento "${ctx.params.slug}" não encontrado`);

  return ctx.render('docs/page', {
    title: `${doc.title} · FLASH docs`,
    description: doc.description || `${doc.title} — documentação do framework FLASH.`,
    doc,
    sections,
    toc: doc.toc,
    prev: doc.prev,
    next: doc.next
  });
});

flash.get('/api/search.json', async (ctx) => {
  const { searchIndex } = await loadDocs(DOCS_DIR);

  return ctx.json(
    { pages: searchIndex },
    { headers: { 'Cache-Control': 'public, max-age=60' } }
  );
});

flash.get('/api/menu.json', async (ctx) => {
  const { sections } = await loadDocs(DOCS_DIR);
  return ctx.json({ sections });
});

flash.get('/health', async (ctx) => ctx.json({ ok: true }));

const app = express();
app.disable('x-powered-by');
app.use(expressAdapter(flash));

const port = Number(process.env.DOCS_PORT ?? 4000);
const host = process.env.HOST ?? '127.0.0.1';

const server = app.listen(port, host, () => {
  console.log(`\n  FLASH docs → http://${host}:${port}\n`);
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => server.close(() => process.exit(0)));
}

export { app, server, flash };
