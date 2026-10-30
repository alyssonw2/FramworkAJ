/**
 * Service — business rules and validation.
 *
 * Services never touch HTTP. They receive plain data, validate it and throw
 * domain errors (`ValidationError`, `HttpError`) that the controller translates
 * into responses.
 */

import { HttpError, ValidationError, notFound, conflict } from '../../../../src/core/errors.js';
import { clientRepository } from '../repositories/client.repository.js';

const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/;
const PER_PAGE = 8;

export function validateClientInput(input, { existing = null } = {}) {
  const errors = {};

  const name = String(input.name ?? '').trim();
  const email = String(input.email ?? '').trim().toLowerCase();
  const phone = String(input.phone ?? '').trim();

  if (name === '') errors.name = 'Informe o nome do cliente.';
  else if (name.length < 3) errors.name = 'O nome deve ter pelo menos 3 caracteres.';
  else if (name.length > 120) errors.name = 'O nome deve ter no máximo 120 caracteres.';

  if (email === '') errors.email = 'Informe o e-mail.';
  else if (!EMAIL_RE.test(email)) errors.email = 'Informe um e-mail válido.';

  if (phone !== '' && !/^[0-9()+\-\s]{8,20}$/.test(phone)) {
    errors.phone = 'Telefone inválido.';
  }

  return { errors, value: { name, email, phone } };
}

export async function listClients({ search = '', page = 1, perPage = PER_PAGE } = {}) {
  const result = await clientRepository.list({ search, page: Number(page) || 1, perPage });
  return {
    ...result,
    search,
    hasPrev: result.page > 1,
    hasNext: result.page < result.pages
  };
}

export async function getClient(id) {
  const client = await clientRepository.findById(id);
  if (!client) throw notFound('Cliente não encontrado.');
  return client;
}

export async function createClient(input) {
  const { errors, value } = validateClientInput(input);

  if (Object.keys(errors).length === 0) {
    const existing = await clientRepository.findByEmail(value.email);
    if (existing) errors.email = 'Já existe um cliente com este e-mail.';
  }

  if (Object.keys(errors).length > 0) {
    throw new ValidationError(errors, 'Verifique os campos destacados.');
  }

  return clientRepository.create(value);
}

export async function updateClient(id, input) {
  const current = await getClient(id);
  const { errors, value } = validateClientInput(input, { existing: current });

  if (Object.keys(errors).length === 0) {
    const duplicate = await clientRepository.findByEmail(value.email);
    if (duplicate && duplicate.id !== current.id) {
      errors.email = 'Já existe um cliente com este e-mail.';
    }
  }

  if (Object.keys(errors).length > 0) {
    throw new ValidationError(errors, 'Verifique os campos destacados.');
  }

  const updated = await clientRepository.update(current.id, value);
  if (!updated) throw conflict('O cliente foi removido por outro usuário.');
  return updated;
}

export async function deleteClient(id, { user } = {}) {
  const client = await getClient(id);

  if (user && user.role !== 'admin' && client.status === 'active') {
    // Business rule example: only admins can delete active clients.
    throw new HttpError(403, 'Somente administradores podem excluir clientes ativos.');
  }

  await clientRepository.remove(client.id);
  return client;
}

export { PER_PAGE };
