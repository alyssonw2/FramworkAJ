/**
 * Controllers — authentication.
 */

import { authenticate, findUserById } from '../services/auth.service.js';
import { rateLimit } from '../../../../src/adapters/rate-limit.js';

const SAFE_NEXT = /^\/(?!\/)/;

function safeNext(value) {
  const next = String(value ?? '').trim();
  if (next === '' || !SAFE_NEXT.test(next)) return '';
  if (next.startsWith('/login')) return '';
  return next;
}

export function registerAuthRoutes(flash) {
  const loginLimiter = rateLimit({
    windowMs: 60_000,
    max: 10,
    message: 'Muitas tentativas de login. Aguarde um minuto.'
  });

  flash.get('/login', async (ctx) => {
    if (ctx.user) return ctx.redirect('/clients');

    return ctx.render('auth/login', {
      title: 'Entrar',
      email: '',
      error: null,
      next: safeNext(ctx.query.next)
    });
  });

  flash.post('/login', loginLimiter, async (ctx) => {
    const email = ctx.string('email');
    const password = ctx.string('password');
    const next = safeNext(ctx.string('next'));

    const user = await authenticate(email, password);

    if (!user) {
      return ctx.render(
        'auth/login',
        { title: 'Entrar', email, next, error: 'E-mail ou senha inválidos.' },
        { status: 422 }
      );
    }

    // New session id on privilege change, as recommended by the spec (14.3).
    ctx.session.regenerate();
    ctx.session.userId = user.id;
    ctx.session.role = user.role;
    ctx.locals.user = user;

    return ctx.redirect(next || '/clients');
  });

  flash.post('/logout', async (ctx) => {
    ctx.session.destroy();
    return ctx.redirect('/login');
  });

  return { loginLimiter, findUserById };
}
