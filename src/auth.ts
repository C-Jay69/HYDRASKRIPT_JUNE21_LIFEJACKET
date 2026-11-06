import NextAuth from 'next-auth';
import Credentials from 'next-auth/providers/credentials';
import { authConfig } from './auth.config';
import { db } from '@/lib/db';
import { verifyPassword } from '@/lib/password';

/**
 * Node-runtime half of the NextAuth configuration.
 *
 * This module touches Prisma and bcrypt, so it must never be imported from
 * `middleware.ts` (Edge runtime). Route handlers and server components may
 * import it freely.
 */
export const { handlers, auth, signIn, signOut } = NextAuth({
  ...authConfig,
  providers: [
    Credentials({
      name: 'Email and password',
      credentials: {
        email: { label: 'Email', type: 'email' },
        password: { label: 'Password', type: 'password' },
      },
      async authorize(raw) {
        const email =
          typeof raw?.email === 'string' ? raw.email.trim().toLowerCase() : '';
        const password = typeof raw?.password === 'string' ? raw.password : '';

        if (!email || !password) return null;

        // Case-insensitive: migrated Supabase rows may not be lowercased, and
        // the unique index is case-sensitive, so findUnique would miss them.
        const profile = await db.profile.findFirst({
          where: { email: { equals: email, mode: 'insensitive' } },
        });

        // Profiles without a hash (created by Stripe webhooks or lazily by the
        // API) cannot sign in until a password is set via signup or reset.
        if (!profile?.passwordHash) return null;

        const valid = await verifyPassword(password, profile.passwordHash);
        if (!valid) return null;

        return {
          id: profile.id,
          email: profile.email,
          name: profile.name,
        };
      },
    }),
  ],
});
