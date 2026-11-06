/**
 * NavBar - Public navbar for marketing pages
 */

'use client';

import { motion } from 'framer-motion';
import Link from 'next/link';
import { useSession } from 'next-auth/react';

export function NavBar() {
  const { status } = useSession();
  const authed = status === 'authenticated';

  return (
    <nav className="sticky top-0 z-50 w-full border-b border-white/5 bg-black/80 backdrop-blur-md px-6 py-4">
      <div className="max-w-7xl mx-auto flex items-center justify-between gap-4">
        <Link href="/" className="flex items-center gap-3 shrink-0">
          <motion.div
            animate={{ y: [0, -4, 0] }}
            transition={{ duration: 4, repeat: Infinity, ease: 'easeInOut' }}
            className="overflow-hidden rounded-xl shadow-[0_0_24px_rgba(122,252,255,0.18),0_0_48px_rgba(184,140,255,0.15)]"
          >
            <img
              src="/HYDRASKRIPT_LOGO.png"
              alt="HYDRASKRIPT"
              width={160}
              height={44}
              className="h-9 w-auto object-contain"
            />
          </motion.div>
        </Link>

        <div className="hidden lg:flex items-center gap-8">
          <Link href="/features" className="text-white text-sm hover:text-purple-300 transition-colors">
            Features
          </Link>
          <Link href="/pricing" className="text-white text-sm hover:text-purple-300 transition-colors">
            Pricing
          </Link>
          <Link href="/audiobooks" className="text-white text-sm hover:text-purple-300 transition-colors">
            Audiobooks
          </Link>
          <Link href="/story-bible" className="text-white text-sm hover:text-purple-300 transition-colors">
            Story Bible
          </Link>
        </div>

        <div className="flex items-center gap-3">
          {authed ? (
            <Link
              href="/dashboard"
              className="inline-flex items-center rounded-xl bg-gradient-to-r from-purple-500 to-cyan-500 px-4 py-2 text-sm font-bold text-white hover:opacity-90"
            >
              Open Studio
            </Link>
          ) : (
            <>
              <Link
                href="/login?next=/dashboard"
                className="text-sm text-gray-300 hover:text-white hidden sm:inline"
              >
                Sign in
              </Link>
              <Link
                href="/login?mode=signup&next=/dashboard"
                className="inline-flex items-center rounded-xl bg-gradient-to-r from-purple-500 to-cyan-500 px-4 py-2 text-sm font-bold text-white hover:opacity-90"
              >
                Start Free
              </Link>
            </>
          )}
        </div>
      </div>
    </nav>
  );
}
