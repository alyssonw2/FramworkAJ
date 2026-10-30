/**
 * Repository — persistence boundary.
 *
 * This example keeps data in memory so the app runs with zero setup. Swapping it
 * for SQL means rewriting only this file: the service layer only depends on the
 * methods below.
 */

import { randomUUID } from 'node:crypto';

const SEED = [
  ['Ana Beatriz Souza', 'ana.souza@example.com', '(11) 98812-3344', 'active'],
  ['Bruno Carvalho', 'bruno.carvalho@example.com', '(21) 99654-1122', 'active'],
  ['Carla Menezes', 'carla.menezes@example.com', '(31) 98123-7788', 'inactive'],
  ['Diego Fernandes', 'diego.fernandes@example.com', '(41) 99555-2211', 'active'],
  ['Eduarda Lima', 'eduarda.lima@example.com', '(51) 98222-9090', 'active'],
  ['Felipe Andrade', 'felipe.andrade@example.com', '(61) 99111-4040', 'inactive'],
  ['Gabriela Nunes', 'gabriela.nunes@example.com', '(71) 98777-1212', 'active'],
  ['Henrique Alves', 'henrique.alves@example.com', '(81) 99333-5656', 'active'],
  ['Isabela Rocha', 'isabela.rocha@example.com', '(85) 98444-7878', 'active'],
  ['João Pedro Martins', 'joao.martins@example.com', '(11) 97777-3131', 'inactive'],
  ['Larissa Prado', 'larissa.prado@example.com', '(19) 99666-2020', 'active'],
  ['Marcos Vinícius Reis', 'marcos.reis@example.com', '(27) 98555-6767', 'active']
];

function normalizeText(value) {
  return String(value ?? '').toLowerCase();
}

export class ClientRepository {
  #clients = new Map();

  constructor(seed = SEED) {
    const now = Date.now();
    seed.forEach(([name, email, phone, status], index) => {
      const id = randomUUID();
      this.#clients.set(id, {
        id,
        name,
        email,
        phone,
        status,
        createdAt: new Date(now - index * 86_400_000).toISOString()
      });
    });
  }

  async list({ search = '', page = 1, perPage = 8, status = null } = {}) {
    const term = normalizeText(search);

    const filtered = [...this.#clients.values()]
      .filter((client) => (status ? client.status === status : true))
      .filter((client) =>
        term === ''
          ? true
          : normalizeText(client.name).includes(term) ||
            normalizeText(client.email).includes(term) ||
            normalizeText(client.phone).includes(term)
      )
      .sort((a, b) => a.name.localeCompare(b.name, 'pt-BR'));

    const total = filtered.length;
    const pages = Math.max(1, Math.ceil(total / perPage));
    const safePage = Math.min(Math.max(1, page), pages);
    const start = (safePage - 1) * perPage;

    return {
      items: filtered.slice(start, start + perPage),
      total,
      page: safePage,
      pages,
      perPage
    };
  }

  async findById(id) {
    if (typeof id !== 'string') return null;
    return this.#clients.get(id) ?? null;
  }

  async findByEmail(email) {
    const target = normalizeText(email);
    for (const client of this.#clients.values()) {
      if (normalizeText(client.email) === target) return client;
    }
    return null;
  }

  async create(data) {
    const id = randomUUID();
    const client = {
      id,
      name: data.name,
      email: data.email,
      phone: data.phone ?? '',
      status: data.status ?? 'active',
      createdAt: new Date().toISOString()
    };
    this.#clients.set(id, client);
    return client;
  }

  async update(id, data) {
    const current = this.#clients.get(id);
    if (!current) return null;
    const next = { ...current, ...data, id };
    this.#clients.set(id, next);
    return next;
  }

  async remove(id) {
    return this.#clients.delete(id);
  }

  async count() {
    return this.#clients.size;
  }
}

export const clientRepository = new ClientRepository();
