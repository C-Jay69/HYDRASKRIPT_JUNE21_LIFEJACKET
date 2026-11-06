import { NextResponse } from 'next/server';

export const dynamic = 'force-dynamic';

// TEMPORARY diagnostic: reports only whether auth secrets are present and how
// long they are. Never returns a value. Delete after use.
export async function GET() {
  const report = (name: string) => {
    const raw = process.env[name];
    return {
      name,
      defined: typeof raw === 'string',
      empty: raw === '',
      length: typeof raw === 'string' ? raw.length : 0,
    };
  };

  return NextResponse.json({
    VERCEL_ENV: process.env.VERCEL_ENV ?? null,
    keys: ['AUTH_SECRET', 'NEXTAUTH_SECRET', 'NEXTAUTH_URL'].map(report),
  });
}
