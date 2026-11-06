/**
 * Pure routing decisions for the auth middleware.
 *
 * Deliberately free of NextAuth/Prisma/pg imports so it can be imported from
 * the Edge runtime and unit-tested in a plain Node environment.
 */

export const PROTECTED_PATHS = ['/api', '/admin', '/dashboard', '/training'];

/**
 * Paths that must stay reachable without a session.
 *
 * `/api/auth` is load-bearing: NextAuth serves its own sign-in, callback,
 * session, CSRF and sign-out endpoints there. If the gate covered it, the
 * login request itself would be answered with a 401 and nobody could ever
 * authenticate. The old Supabase setup did not need this exception because
 * auth calls went straight from the browser to Supabase.
 *
 * The queue pump is called by Vercel Cron and server-to-server self-kicks.
 * Neither caller has a browser cookie; the route checks its own shared secret.
 */
export const PUBLIC_API_PATHS = [
  '/api/auth',
  '/api/health',
  '/api/stripe/webhook',
  '/api/queue/pump',
];

/** Auth entry points that must never be redirected by the session gate. */
export const PUBLIC_AUTH_PATHS = [
  '/login',
  '/auth/forgot-password',
  '/auth/update-password',
  '/auth/auth-code-error',
];

export function isProtectedPath(pathname: string): boolean {
  return PROTECTED_PATHS.some(
    (path) => pathname === path || pathname.startsWith(`${path}/`),
  );
}

export function isPublicApiPath(pathname: string): boolean {
  return PUBLIC_API_PATHS.some(
    (path) => pathname === path || pathname.startsWith(`${path}/`),
  );
}

export function isPublicAuthPath(pathname: string): boolean {
  return PUBLIC_AUTH_PATHS.some(
    (path) => pathname === path || pathname.startsWith(`${path}/`),
  );
}

export type AuthGateDecision =
  | { action: 'next' }
  | { action: 'unauthorized-json' }
  | { action: 'redirect-login'; pathname: string };

/**
 * Decide what the middleware should do for a request.
 *
 * `authenticated` is derived from the NextAuth session (JWT verification).
 */
export function decideAuthGate(
  pathname: string,
  authenticated: boolean,
): AuthGateDecision {
  // Server-to-server endpoints never depend on a browser session.
  if (isPublicApiPath(pathname)) return { action: 'next' };

  // Public pages, assets, and auth entry points.
  if (!isProtectedPath(pathname) || isPublicAuthPath(pathname)) {
    return { action: 'next' };
  }

  if (authenticated) return { action: 'next' };

  // API callers get JSON, never an HTML redirect (apiFetch would choke on it).
  if (pathname.startsWith('/api')) return { action: 'unauthorized-json' };

  return { action: 'redirect-login', pathname };
}
