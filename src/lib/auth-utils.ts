import type { NextRequest } from 'next/server';
import { auth } from '@/auth';

/**
 * Returns the authenticated user's email from the NextAuth session, or null.
 *
 * The `request` argument is retained so existing callers (and `auth-helpers`)
 * keep their signatures; the session itself is read from cookies by `auth()`.
 */
export async function getAuthenticatedUserEmail(
  _request?: NextRequest,
): Promise<string | null> {
  try {
    const session = await auth();
    return session?.user?.email ?? null;
  } catch (error) {
    console.error('[Auth Utils] Failed to read session:', error);
    return null;
  }
}
