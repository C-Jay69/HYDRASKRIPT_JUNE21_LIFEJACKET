import { NextRequest } from 'next/server';

/**
 * The middleware runs on the Edge runtime, so tests exercise it with NextAuth
 * replaced by a pass-through wrapper: `auth(handler)` returns the handler
 * unchanged. That keeps the routing decisions under test (which is what the
 * gate actually decides) without booting the auth stack.
 */
jest.mock('next-auth', () => ({
  __esModule: true,
  default: jest.fn(() => ({ auth: (handler: unknown) => handler })),
}));

import middleware from '@/middleware';

function request(path: string, authenticated = false) {
  const req = new NextRequest(`http://localhost${path}`);
  // NextAuth attaches `auth` to the request before invoking the handler.
  (req as unknown as { auth: unknown }).auth = authenticated
    ? { user: { email: 'author@example.com' } }
    : null;
  return req;
}

describe('middleware auth gate', () => {
  it('lets the queue pump reach its route-level secret check without a session', async () => {
    const response = await middleware(request('/api/queue/pump?stats=1'));

    expect(response.status).toBe(200);
  });

  it('keeps the NextAuth endpoints public (otherwise sign-in is impossible)', async () => {
    for (const path of [
      '/api/auth/callback/credentials',
      '/api/auth/session',
      '/api/auth/csrf',
      '/api/auth/signout',
    ]) {
      const response = await middleware(request(path));
      expect(response.status).toBe(200);
    }
  });

  it('keeps the auth entry pages public', async () => {
    for (const path of ['/login', '/auth/forgot-password', '/auth/update-password']) {
      const response = await middleware(request(path));
      expect(response.status).toBe(200);
    }
  });

  it('returns JSON 401 for ordinary API routes without a session', async () => {
    const response = await middleware(request('/api/jobs/job-1'));

    expect(response.status).toBe(401);
    expect(await response.json()).toEqual({
      success: false,
      error: 'Authentication required',
    });
  });

  it('redirects unauthenticated page requests to /login with a next parameter', async () => {
    const response = await middleware(request('/dashboard/books'));

    expect(response.status).toBe(307);
    const location = response.headers.get('location') ?? '';
    expect(location).toContain('/login');
    expect(location).toContain('next=%2Fdashboard%2Fbooks');
  });

  it('allows an authenticated user through a protected page', async () => {
    const response = await middleware(request('/dashboard', true));

    expect(response.status).toBe(200);
  });

  it('allows public marketing pages without a session', async () => {
    const response = await middleware(request('/'));

    expect(response.status).toBe(200);
  });
});
