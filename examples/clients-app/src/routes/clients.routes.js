/**
 * Controllers — clients.
 *
 * Every route validates on the server, checks authorization and then chooses one
 * of three responses: a complete page, an HTML fragment or a redirect. The same
 * handler serves JavaScript and non-JavaScript clients.
 */

import {
  PER_PAGE,
  createClient,
  deleteClient,
  getClient,
  listClients,
  updateClient
} from '../services/client.service.js';
import { ValidationError } from '../../../../src/core/errors.js';

function buildQuery({ search, page }) {
  const params = new URLSearchParams();
  if (search) params.set('q', search);
  if (page > 1) params.set('page', String(page));
  const query = params.toString();
  return query ? `?${query}` : '';
}

async function listViewModel(ctx) {
  const search = ctx.string('q');
  const page = ctx.number('page', 1);
  const clients = await listClients({ search, page, perPage: PER_PAGE });

  return {
    title: 'Clientes',
    // `?back=1` is set by the "Voltar" link; the page then plays the reverse
    // transition, so navigation has a sense of direction.
    transition: ctx.query.back === '1' ? 'slide-back' : 'fade',
    clients,
    search,
    page: clients.page,
    pages: clients.pages,
    total: clients.total,
    prevUrl: clients.hasPrev ? `/clients${buildQuery({ search, page: clients.page - 1 })}` : '',
    nextUrl: clients.hasNext ? `/clients${buildQuery({ search, page: clients.page + 1 })}` : ''
  };
}

function formViewModel({ title, heading, actionUrl, form, errors = {}, formError = null }) {
  return { title, heading, actionUrl, form, errors, formError };
}

export function registerClientRoutes(flash, { requireAuth }) {
  flash.get('/clients', requireAuth, async (ctx) => {
    const view = await listViewModel(ctx);

    if (ctx.wantsFragment()) {
      return ctx.fragment('clients/list', view, { target: '#results', transition: 'fade' });
    }

    return ctx.render('clients/index', view, { transition: view.transition });
  });

  flash.get('/clients/new', requireAuth, async (ctx) =>
    ctx.render(
      'clients/form',
      formViewModel({
        title: 'Novo cliente',
        heading: 'Novo cliente',
        actionUrl: '/clients',
        form: { name: '', email: '', phone: '' }
      }),
      { transition: 'slide' }
    )
  );

  flash.get('/clients/:id/edit', requireAuth, async (ctx) => {
    const client = await getClient(ctx.params.id);

    return ctx.render(
      'clients/form',
      formViewModel({
        title: `Editar ${client.name}`,
        heading: `Editar ${client.name}`,
        actionUrl: `/clients/${client.id}`,
        form: { name: client.name, email: client.email, phone: client.phone }
      }),
      { transition: 'slide' }
    );
  });

  flash.post('/clients', requireAuth, async (ctx) => {
    const form = {
      name: ctx.string('name'),
      email: ctx.string('email'),
      phone: ctx.string('phone')
    };

    try {
      await createClient(form);
    } catch (error) {
      if (error instanceof ValidationError) {
        const view = formViewModel({
          title: 'Novo cliente',
          heading: 'Novo cliente',
          actionUrl: '/clients',
          form,
          errors: error.errors,
          formError: error.message
        });

        if (ctx.wantsFragment()) return ctx.fragment('clients/form', view, { status: 422 });
        return ctx.render('clients/form', view, { status: 422, transition: 'slide' });
      }
      throw error;
    }

    return ctx.redirect('/clients');
  });

  flash.post('/clients/:id', requireAuth, async (ctx) => {
    const client = await getClient(ctx.params.id);
    const form = {
      name: ctx.string('name'),
      email: ctx.string('email'),
      phone: ctx.string('phone')
    };

    try {
      await updateClient(client.id, form);
    } catch (error) {
      if (error instanceof ValidationError) {
        const view = formViewModel({
          title: `Editar ${client.name}`,
          heading: `Editar ${client.name}`,
          actionUrl: `/clients/${client.id}`,
          form,
          errors: error.errors,
          formError: error.message
        });

        if (ctx.wantsFragment()) return ctx.fragment('clients/form', view, { status: 422 });
        return ctx.render('clients/form', view, { status: 422, transition: 'slide' });
      }
      throw error;
    }

    return ctx.redirect('/clients');
  });

  flash.post('/clients/:id/delete', requireAuth, async (ctx) => {
    const client = await deleteClient(ctx.params.id, { user: ctx.user });

    if (ctx.wantsFragment()) {
      const view = await listViewModel(ctx);
      return ctx.fragment(
        'clients/list',
        { ...view, toast: { tone: 'success', message: `Cliente "${client.name}" excluído.` } },
        { transition: 'scale' }
      );
    }

    return ctx.redirect('/clients');
  });

  // JSON endpoint: explicit integration for external clients.
  flash.get('/api/clients', requireAuth, async (ctx) => {
    const clients = await listClients({ search: ctx.string('q'), page: ctx.number('page', 1) });
    return ctx.json({ data: clients.items, meta: { total: clients.total, page: clients.page, pages: clients.pages } });
  });

  flash.delete('/api/clients/:id', requireAuth, async (ctx) => {
    const client = await deleteClient(ctx.params.id, { user: ctx.user });
    return ctx.json({ deleted: client.id });
  });
}
