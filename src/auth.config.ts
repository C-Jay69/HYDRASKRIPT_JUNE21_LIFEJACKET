import type { NextAuthConfig } from 'next-auth';

/**
 * Edge-safe half of the NextAuth configuration.
 *
 * `middleware.ts` imports ONLY this file: it runs on the Edge runtime, which
 * cannot load `pg`/Prisma/bcrypt. The Credentials provider — and therefore all
 * database access — lives in `src/auth.ts`, which is imported only by Node
 * route handlers.
 */
export const authConfig = {
  // Vercel terminates TLS in front of the app; without this NextAuth rejects
  // the forwarded host header in some deployments.
  trustHost: true,
  pages: {
    signIn: '/login',
  },
  session: {
    // Credentials providers require JWT sessions (Auth.js cannot persist a
    // database session for them). No Session/Account tables are needed.
    strategy: 'jwt',
    maxAge: 30 * 24 * 60 * 60, // 30 days
  },
  secret: process.env.AUTH_SECRET ?? process.env.NEXTAUTH_SECRET,
  // Filled in by `src/auth.ts`. An empty list is intentional here so this
  // module stays free of Node-only imports.
  providers: [],
  callbacks: {
    jwt({ token, user }) {
      if (user) {
        token.uid = user.id;
        token.email = user.email ?? token.email;
      }
      return token;
    },
    session({ session, token }) {
      if (session.user) {
        session.user.id = String(token.uid ?? '');
        if (token.email) session.user.email = String(token.email);
      }
      return session;
    },
  },
} satisfies NextAuthConfig;
