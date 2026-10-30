import test from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import { createFlash } from '../src/index.js';
import { session, MemoryStore } from '../src/adapters/session.js';
import { csrf } from '../src/adapters/csrf.js';
import { securityHeaders, DEFAULT_CSP } from '../src/adapters/security.js';
import { rateLimit } from '../src/adapters/rate-limit.js';

const HERE = path.dirname(fileURLToPath(import.meta.url));

function buildApp({ withCsrf = true, maxAge = 60 } = {}) {
  const flash = createFlash({
    views: path.join(HERE, 'fixtures', 'views'),
    dev: true
  });

  flash.use(securityHeaders());
  flash.use(session({ secret: 'test-secret', maxAge, secure: false }));
  if (withCsrf) flash.use(csrf());

  flash.get('/whoami', async (ctx) => ctx.json({ user: ctx.session.userId ?? null }));
  flash.get('/token', async (ctx) => ctx.render('simple', { title: ctx.csrfToken ?? '', value: 0 }));
  flash.post('/login', async (ctx) => {
    ctx.session.regenerate();
    ctx.session.userId = 'user-1';
    return ctx.redirect('/whoami');
  });
  flash.post('/logout', async (ctx) => {
    ctx.session.destroy();
    return ctx.redirect('/login');
  });
  flash.post('/write', async (ctx) => ctx.json({ ok: true }));

  return flash;
}

function setCookies(response) {
  const raw = response.headers['Set-Cookie'];
  if (!raw) return [];
  return Array.isArray(raw) ? raw : [raw];
}

const cookieValue = (response) => setCookies(response)[0]?.split(';')[0];

async function call(flash, { method = 'GET', path: route = '/', body = {}, cookie, headers = {} } = {}) {
  return flash.handle({
    method,
    path: route,
    body,
    headers: { accept: 'text/html', ...(cookie ? { cookie } : {}), ...headers }
  });
}

/** Returns a cookie + CSRF token issued in the same request. */
async function issueToken(flash) {
  const response = await call(flash, { path: '/token' });
  const token = /<h1>([^<]*)<\/h1>/.exec(response.body)?.[1] ?? '';
  return { cookie: cookieValue(response), token };
}

test('sessão grava cookie HttpOnly assinado', async () => {
  const flash = buildApp({ withCsrf: false });
  const response = await call(flash, { path: '/whoami' });
  const cookies = setCookies(response);

  assert.equal(cookies.length, 1);
  assert.match(cookies[0], /flash\.sid=[a-f0-9]{64}\.[A-Za-z0-9_-]+/);
  assert.match(cookies[0], /HttpOnly/);
  assert.match(cookies[0], /SameSite=Lax/);
  assert.match(cookies[0], /Path=\//);
  assert.match(cookies[0], /Max-Age=60/);
  assert.doesNotMatch(cookies[0], /Secure/, 'Secure só deve aparecer atrás de HTTPS');
});

test('cookie adulterado é descartado', async () => {
  const flash = buildApp({ withCsrf: false });
  const { cookie } = await issueToken(flash);
  const forged = `${cookie.split('.')[0]}.assinaturafalsa`;

  const response = await call(flash, { path: '/whoami', cookie: forged });
  assert.deepEqual(JSON.parse(response.body), { user: null });
});

test('login rotaciona a sessão e persiste o usuário', async () => {
  const flash = buildApp();
  const { cookie, token } = await issueToken(flash);
  assert.ok(token.length > 20);

  const login = await call(flash, { method: 'POST', path: '/login', cookie, body: { _csrf: token } });
  assert.equal(login.status, 303);

  const rotated = cookieValue(login);
  assert.ok(rotated);
  assert.notEqual(rotated, cookie, 'a sessão deve ser rotacionada no login');

  const after = await call(flash, { path: '/whoami', cookie: rotated });
  assert.equal(JSON.parse(after.body).user, 'user-1');
});

test('logout destrói a sessão e limpa o cookie', async () => {
  const flash = buildApp();
  const { cookie, token } = await issueToken(flash);

  const login = await call(flash, { method: 'POST', path: '/login', cookie, body: { _csrf: token } });
  const authed = cookieValue(login);

  const whoami = await call(flash, { path: '/token', cookie: authed });
  const freshToken = /<h1>([^<]*)<\/h1>/.exec(whoami.body)[1];

  const logout = await call(flash, { method: 'POST', path: '/logout', cookie: authed, body: { _csrf: freshToken } });
  assert.equal(logout.status, 303);
  assert.match(setCookies(logout).join(';'), /Max-Age=0/);

  const restored = await call(flash, { path: '/whoami', cookie: authed });
  assert.deepEqual(JSON.parse(restored.body), { user: null });
});

test('CSRF aceita token no campo e no cabeçalho', async () => {
  const flash = buildApp();
  const { cookie, token } = await issueToken(flash);

  const viaBody = await call(flash, { method: 'POST', path: '/write', cookie, body: { _csrf: token } });
  assert.equal(viaBody.status, 200);

  const viaHeader = await call(flash, {
    method: 'POST',
    path: '/write',
    cookie,
    headers: { 'x-csrf-token': token }
  });
  assert.equal(viaHeader.status, 200);
});

test('CSRF rejeita POST sem token ou com token inválido', async () => {
  const flash = buildApp();
  const { cookie } = await issueToken(flash);

  const missing = await call(flash, { method: 'POST', path: '/write', cookie, body: {} });
  assert.equal(missing.status, 403);

  const wrong = await call(flash, { method: 'POST', path: '/write', cookie, body: { _csrf: 'invalido' } });
  assert.equal(wrong.status, 403);

  const wrongHeader = await call(flash, {
    method: 'POST',
    path: '/write',
    cookie,
    headers: { 'x-csrf-token': 'invalido' }
  });
  assert.equal(wrongHeader.status, 403);
});

test('CSRF não bloqueia métodos seguros', async () => {
  const flash = buildApp();
  const response = await call(flash, { path: '/whoami' });
  assert.equal(response.status, 200);
});

test('CSRF exige o middleware de sessão', async () => {
  const flash = createFlash({ dev: true });
  flash.use(csrf());
  flash.post('/x', async (ctx) => ctx.json({ ok: true }));

  const response = await call(flash, { method: 'POST', path: '/x' });
  assert.equal(response.status, 500);
});

test('security headers aplica CSP e políticas', async () => {
  const flash = buildApp({ withCsrf: false });
  const response = await call(flash, { path: '/whoami' });

  assert.equal(response.headers['Content-Security-Policy'], DEFAULT_CSP);
  assert.equal(response.headers['X-Frame-Options'], 'DENY');
  assert.equal(response.headers['Referrer-Policy'], 'strict-origin-when-cross-origin');
  assert.equal(response.headers['Cross-Origin-Opener-Policy'], 'same-origin');
  assert.match(response.headers['Content-Security-Policy'], /script-src 'self'/);
  assert.match(response.headers['Content-Security-Policy'], /frame-ancestors 'none'/);
});

test('security headers aceita configuração', async () => {
  const flash = createFlash({ dev: true });
  flash.use(securityHeaders({ csp: false, frameOptions: 'SAMEORIGIN' }));
  flash.get('/x', async (ctx) => ctx.html('ok'));

  const response = await call(flash, { path: '/x' });
  assert.equal(response.headers['Content-Security-Policy'], undefined);
  assert.equal(response.headers['X-Frame-Options'], 'SAMEORIGIN');
});

test('rate limit bloqueia após o limite da janela', async () => {
  const flash = createFlash({ dev: true });
  const limiter = rateLimit({ windowMs: 60_000, max: 2 });
  flash.post('/limited', limiter, async (ctx) => ctx.json({ ok: true }));

  assert.equal((await call(flash, { method: 'POST', path: '/limited' })).status, 200);
  assert.equal((await call(flash, { method: 'POST', path: '/limited' })).status, 200);

  const blocked = await call(flash, { method: 'POST', path: '/limited' });
  assert.equal(blocked.status, 429);
  assert.ok(blocked.headers['Retry-After']);

  limiter.reset();
  assert.equal((await call(flash, { method: 'POST', path: '/limited' })).status, 200);
});

test('MemoryStore expira entradas', async () => {
  const store = new MemoryStore({ defaultTtl: 1 });
  await store.set('a', { value: 1 }, 0.01);
  assert.deepEqual(await store.get('a'), { value: 1 });
  await new Promise((resolve) => setTimeout(resolve, 40));
  assert.equal(await store.get('a'), null);
  store.close();
});
