import bcrypt from 'bcryptjs';

/**
 * Password hashing for the local Postgres auth backend.
 *
 * bcrypt (not scrypt/argon2) on purpose: Supabase Auth stores email/password
 * users as bcrypt (`$2a$` / `$2b$`) in `auth.users.encrypted_password`. Those
 * hashes can be copied straight into `profiles."passwordHash"` and verified
 * here without forcing every existing user to reset their password.
 */

const ROUNDS = 12;

export async function hashPassword(plain: string): Promise<string> {
  return bcrypt.hash(plain, ROUNDS);
}

/**
 * Constant-time-ish comparison handled by bcrypt itself. Returns false instead
 * of throwing on a malformed hash so a corrupt row cannot 500 the login route.
 */
export async function verifyPassword(plain: string, hash: string): Promise<boolean> {
  try {
    return await bcrypt.compare(plain, hash);
  } catch {
    return false;
  }
}

/** Minimum accepted password length. Kept in sync with the signup/reset UI. */
export const MIN_PASSWORD_LENGTH = 6;

export function isValidEmail(email: string): boolean {
  return /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email);
}
