// HydraSkript - Request a password reset
// Replaces Supabase's auth.resetPasswordForEmail().
//
// Email delivery is intentionally not configured yet. Instead of silently
// dropping the reset, the link is written to the server log; `scripts/` and an
// admin can also generate one. Swap `deliverResetLink()` for Resend/SMTP when
// an email provider is available — the token flow itself does not change.

import { randomBytes, createHash } from 'node:crypto';
import { NextRequest, NextResponse } from 'next/server';
import { db } from '@/lib/db';

export const dynamic = 'force-dynamic';

const RESET_TOKEN_TTL_MS = 60 * 60 * 1000; // 1 hour

function hashToken(raw: string): string {
  return createHash('sha256').update(raw).digest('hex');
}

async function deliverResetLink(email: string, link: string): Promise<void> {
  // No email provider configured: surface the link in the server log only.
  console.log(
    `[auth] Password reset link for ${email} (valid 1 hour): ${link}`,
  );
}

export async function POST(request: NextRequest) {
  try {
    const body = await request.json().catch(() => null);
    const email =
      typeof body?.email === 'string' ? body.email.trim().toLowerCase() : '';

    if (!email) {
      return NextResponse.json(
        { success: false, error: 'Email is required.' },
        { status: 400 },
      );
    }

    const profile = await db.profile.findFirst({
      where: { email: { equals: email, mode: 'insensitive' } },
    });

    // Always answer success: revealing whether an address exists would let
    // anyone enumerate accounts.
    if (profile) {
      // Invalidate any outstanding tokens so only the newest link works.
      await db.passwordResetToken.updateMany({
        where: { profileId: profile.id, usedAt: null },
        data: { usedAt: new Date() },
      });

      const rawToken = randomBytes(32).toString('hex');
      await db.passwordResetToken.create({
        data: {
          profileId: profile.id,
          tokenHash: hashToken(rawToken),
          expiresAt: new Date(Date.now() + RESET_TOKEN_TTL_MS),
        },
      });

      const origin = new URL(request.url).origin;
      await deliverResetLink(
        email,
        `${origin}/auth/update-password?token=${rawToken}`,
      );
    } else {
      console.log(`[auth] Password reset requested for unknown email: ${email}`);
    }

    return NextResponse.json({
      success: true,
      data: {
        message:
          'If an account exists for that email, a reset link has been generated.',
      },
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : 'Unknown error';
    console.error('[API/auth/forgot-password] Failed:', message);
    return NextResponse.json(
      { success: false, error: 'Could not process the reset request.' },
      { status: 500 },
    );
  }
}
