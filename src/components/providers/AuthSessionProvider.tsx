'use client';

import { SessionProvider } from 'next-auth/react';

/**
 * Client boundary for NextAuth's session context.
 *
 * `useSession()` (used by the marketing NavBar) needs this provider above it.
 * The root layout is a Server Component, so the provider lives in its own
 * client module.
 */
export function AuthSessionProvider({
  children,
}: {
  children: React.ReactNode;
}) {
  return <SessionProvider>{children}</SessionProvider>;
}
