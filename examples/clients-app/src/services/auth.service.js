/**
 * Service — authentication.
 */

import { userRepository } from '../repositories/user.repository.js';

export async function authenticate(email, password) {
  const user = await userRepository.findByEmail(email);
  if (!user) return null;
  if (!userRepository.verifyPassword(user, password)) return null;
  return userRepository.toPublic(user);
}

export async function findUserById(id) {
  const user = await userRepository.findById(id);
  return userRepository.toPublic(user);
}
