import NextAuth from 'next-auth';
import { NextResponse } from 'next/server';
import { authConfig } from '@/auth.config';
import { decideAuthGate } from '@/lib/auth-gate';

/**
 * Session gate.
 *
 * Only `auth.config.ts` is imported here (no Prisma/bcrypt), because middleware
 * runs on the Edge runtime. The session is a signed JWT cookie, so verifying it
 * requires no database round trip.
 */
const { auth } = NextAuth(authConfig);

export default auth((request) => {
  const { pathname } = request.nextUrl;
  const decision = decideAuthGate(pathname, Boolean(request.auth));

  if (decision.action === 'next') return NextResponse.next();

  if (decision.action === 'unauthorized-json') {
    return NextResponse.json(
      { success: false, error: 'Authentication required' },
      { status: 401 },
    );
  }

  const loginUrl = new URL('/login', request.url);
  if (decision.pathname !== '/') loginUrl.searchParams.set('next', decision.pathname);
  return NextResponse.redirect(loginUrl);
});

export const config = {
  matcher: [
    '/((?!_next/static|_next/image|favicon.ico|.*\\.(?:svg|png|jpg|jpeg|gif|webp|ico)$).*)',
  ],
};
