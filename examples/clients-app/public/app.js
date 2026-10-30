/**
 * Example — client-side module.
 *
 * The server rendered everything; this file only adds local interactions. It is
 * loaded with `type="module"`, so it can import the FLASH runtime and optional UI
 * modules directly from the URLs the framework serves.
 *
 * Try disabling JavaScript: listing, searching (submit) and creating/editing
 * clients still work.
 */

import { client } from '/__flash/client/runtime.js';
import { open as openModal } from '/__flash/client/modules/modal.js';

client({
  state: {
    menu: { open: false },
    selected: { name: '', email: '', phone: '', status: '' }
  },

  actions: {
    'clients.show'({ el, state }) {
      state.selected = {
        name: el.dataset.clientName ?? '',
        email: el.dataset.clientEmail ?? '',
        phone: el.dataset.clientPhone || '—',
        status: el.dataset.clientStatus === 'active' ? 'Ativo' : 'Inativo'
      };

      openModal('client-modal');
    },

    'menu.toggle'({ state }) {
      state.menu.open = !state.menu.open;
    }
  }
});
