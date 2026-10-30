/**
 * FLASH example — application bootstrap.
 *
 *   node examples/clients-app/src/app.js
 *   → http://localhost:3000
 *
 * Demonstrates: SSR, layouts and blocks, includes, server components, sessions,
 * CSRF, security headers, rate limiting, classic forms and partial HTML updates.
 */

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import express from 'express';

import { createFlash } from '../../../src/index.js';
import { expressAdapter } from '../../../src/adapters/express.js';
import { session } from '../../../src/adapters/session.js';
import { csrf } from '../../../src/adapters/csrf.js';
import { securityHeaders } from '../../../src/adapters/security.js';
// Os caminhos dos componentes do framework vêm do pacote: funcionam rodando do
// repositório e também de node_modules/flash depois do `flash_deploy`.
import { componentsDir } from '../../../src/paths.js';

import { registerAuthRoutes } from './routes/auth.routes.js';
import { registerClientRoutes } from './routes/clients.routes.js';
import { findUserById } from './services/auth.service.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');

// Flags: --dev (padrão) ativa o painel em /__flash/dev; --prod desliga o modo dev.
const argv = new Set(process.argv.slice(2));
const isProduction = argv.has('--prod') || process.env.NODE_ENV === 'production';
const dev = argv.has('--dev') || !isProduction;

const flash = createFlash({
  views: path.join(HERE, 'views'),
  components: [componentsDir, path.join(HERE, 'components')],
  publicDir: path.join(ROOT, 'public'),
  publicPrefix: '/assets',
  dev,
  requestId: true,
  helpers: {
    formatDate(value) {
      if (!value) return '';
      const date = value instanceof Date ? value : new Date(value);
      if (Number.isNaN(date.getTime())) return '';
      return new Intl.DateTimeFormat('pt-BR', { dateStyle: 'short' }).format(date);
    },
    initials(name) {
      return String(name ?? '')
        .split(/\s+/)
        .filter(Boolean)
        .slice(0, 2)
        .map((part) => part[0]?.toUpperCase() ?? '')
        .join('');
    }
  }
});

// Em produção os assets recebem hash no nome (flash_deploy), então podem ser
// cacheados por um ano sem revalidação.
if (isProduction) {
  flash.assets(path.join(ROOT, 'public'), { prefix: '/assets', immutable: true });
}

flash.use(securityHeaders({ hsts: isProduction && { maxAge: 15552000 } }));

flash.use(
  session({
    secret: process.env.SESSION_SECRET ?? 'flash-example-development-secret',
    maxAge: 8 * 60 * 60,
    secure: isProduction,
    sameSite: 'Lax',
    logger: console
  })
);

flash.use(csrf());

// Runs after the session so `ctx.user` is available, and before the CSRF check
// so error pages still have the values the layout needs.
flash.use(async (ctx) => {
  if (ctx.session.userId) {
    const user = await findUserById(ctx.session.userId);
    if (user) ctx.user = user;
    else delete ctx.session.userId;
  }

  ctx.locals.currentPath = ctx.path;
  ctx.locals.appName = 'FLASH Admin';
  return undefined;
});

const requireAuth = async (ctx) => {
  if (ctx.user) return undefined;
  return ctx.redirect(`/login?next=${encodeURIComponent(ctx.path)}`);
};

flash.get('/', async (ctx) => ctx.redirect(ctx.user ? '/clients' : '/login'));

flash.get('/health', async (ctx) => ctx.json({ ok: true, uptime: Math.round(process.uptime()) }));

registerAuthRoutes(flash);
registerClientRoutes(flash, { requireAuth });

const app = express();
app.disable('x-powered-by');
app.use(expressAdapter(flash, { bodyLimit: '256kb', logger: console }));

const port = Number(process.env.PORT ?? 3000);
const host = process.env.HOST ?? '127.0.0.1';

const server = app.listen(port, host, () => {
  const base = `http://${host}:${port}`;
  console.log(`\n  FLASH example → ${base}`);
  console.log(`  modo: ${dev ? 'desenvolvimento' : 'produção'}`);

  if (dev) {
    console.log(`  devtools: Alt+Shift+D no navegador ou ${base}/__flash/dev/stats.json`);
  }

  console.log('  login: admin@flash.dev / admin123\n');
});

for (const signal of ['SIGINT', 'SIGTERM']) {
  process.on(signal, () => {
    server.close(() => process.exit(0));
  });
}

export { app, server, flash };
