/**
 * Repository — demo users.
 *
 * Passwords are hashed with scrypt and compared in constant time. A real system
 * would use a dedicated auth service; the point here is that FLASH keeps
 * authentication out of the view layer.
 */

import { randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';

function hash(password) {
  const salt = randomBytes(16).toString('hex');
  const derived = scryptSync(password, salt, 32).toString('hex');
  return `scrypt$${salt}$${derived}`;
}

function verify(password, stored) {
  const [scheme, salt, digest] = String(stored).split('$');
  if (scheme !== 'scrypt' || !salt || !digest) return false;
  const derived = scryptSync(password, salt, 32);
  const expected = Buffer.from(digest, 'hex');
  if (expected.length !== derived.length) return false;
  return timingSafeEqual(derived, expected);
}

const USERS = [
  {
    id: 'usr_admin',
    name: 'Ana Admin',
    email: 'admin@flash.dev',
    role: 'admin',
    password: hash('admin123')
  },
  {
    id: 'usr_viewer',
    name: 'Vitor Viewer',
    email: 'user@flash.dev',
    role: 'viewer',
    password: hash('user123')
  }
];

export class UserRepository {
  constructor(users = USERS) {
    this.users = users;
  }

  async findByEmail(email) {
    const target = String(email ?? '').trim().toLowerCase();
    return this.users.find((user) => user.email.toLowerCase() === target) ?? null;
  }

  async findById(id) {
    return this.users.find((user) => user.id === id) ?? null;
  }

  verifyPassword(user, password) {
    return Boolean(user) && verify(String(password ?? ''), user.password);
  }

  toPublic(user) {
    if (!user) return null;
    const { password, ...safe } = user;
    return safe;
  }
}

export const userRepository = new UserRepository();
