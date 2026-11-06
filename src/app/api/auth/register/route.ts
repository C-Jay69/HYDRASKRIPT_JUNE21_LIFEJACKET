// HydraSkript - Email/password signup
// Replaces Supabase's auth.signUp(). Creates the Profile (with the same free
// signup credits the lazy getOrCreateProfile() path grants) and stores a bcrypt
// hash that NextAuth's Credentials provider can verify.

import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { getOrCreateProfile } from '@/lib/utils/bookHelpers';
import {
  hashPassword,
  isValidEmail,
  MIN_PASSWORD_LENGTH,
} from '@/lib/password';

export const dynamic = 'force-dynamic';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => null);
    const rawEmail = typeof body?.email === 'string' ? body.email : '';
    const password = typeof body?.password === 'string' ? body.password : '';
    const name = typeof body?.name === 'string' ? body.name.trim() : undefined;

    const email = rawEmail.trim().toLowerCase();

    if (!isValidEmail(email)) {
      return NextResponse.json(
        { success: false, error: 'Please enter a valid email address.' },
        { status: 400 },
      );
    }

    if (password.length < MIN_PASSWORD_LENGTH) {
      return NextResponse.json(
        {
          success: false,
          error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters.`,
        },
        { status: 400 },
      );
    }

    const existing = await db.profile.findFirst({
      where: { email: { equals: email, mode: 'insensitive' } },
    });

    if (existing?.passwordHash) {
      return NextResponse.json(
        { success: false, error: 'An account with this email already exists.' },
        { status: 409 },
      );
    }

    const passwordHash = await hashPassword(password);

    let profile;
    if (existing) {
      // Profile was created earlier (Stripe webhook, lazy API access, or a
      // migrated Supabase account) but has no password yet. Attach one without
      // re-granting credits.
      profile = await db.profile.update({
        where: { id: existing.id },
        data: { passwordHash, ...(name ? { name } : {}) },
      });
    } else {
      const created = await getOrCreateProfile(email, name);
      profile = await db.profile.update({
        where: { id: created.id },
        data: { passwordHash },
      });
    }

    return NextResponse.json({
      success: true,
      data: { id: profile.id, email: profile.email },
    });
  } catch (error) {
    // Unique-violation race: two signups for the same address at once.
    if (
      typeof error === 'object' &&
      error !== null &&
      (error as { code?: string }).code === 'P2002'
    ) {
      return NextResponse.json(
        { success: false, error: 'An account with this email already exists.' },
        { status: 409 },
      );
    }

    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[API/auth/register] Failed:', message);
    return NextResponse.json(
      { success: false, error: 'Could not create the account.' },
      { status: 500 },
    );
  }
}
