// HydraSkript - Complete a password reset
// Replaces Supabase's auth.updateUser({ password }).

import { createHash } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';
import { hashPassword, MIN_PASSWORD_LENGTH } from '@/lib/password';

export const dynamic = 'force-dynamic';

function hashToken(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => null);
    const token = typeof body?.token === 'string' ? body.token : '';
    const password = typeof body?.password === 'string' ? body.password : '';

    if (!token) {
      return NextResponse.json(
        { success: false, error: 'Missing or invalid reset token.' },
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

    const record = await db.passwordResetToken.findUnique({
      where: { tokenHash: hashToken(token) },
    });

    if (!record || record.usedAt || record.expiresAt.getTime() < Date.now()) {
      return NextResponse.json(
        {
          success: false,
          error: 'This reset link is invalid or has expired. Request a new one.',
        },
        { status: 400 },
      );
    }

    const passwordHash = await hashPassword(password);

    await db.$transaction([
      db.profile.update({
        where: { id: record.profileId },
        data: { passwordHash },
      }),
      // Burn every outstanding token for this account, including this one.
      db.passwordResetToken.updateMany({
        where: { profileId: record.profileId, usedAt: null },
        data: { usedAt: new Date() },
      }),
    ]);

    return NextResponse.json({ success: true });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[API/auth/reset-password] Failed:', message);
    return NextResponse.json(
      { success: false, error: 'Could not reset the password.' },
      { status: 500 },
    );
  }
}
