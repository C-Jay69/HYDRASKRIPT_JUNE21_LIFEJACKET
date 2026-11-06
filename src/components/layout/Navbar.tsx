'use client';

import Image from 'next/image';
import { useRouter } from 'next/navigation';
import { Menu, X, LogOut, Zap } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { useAppStore } from '@/lib/store';
import { signOut } from 'next-auth/react';

export default function Navbar() {
  const router = useRouter();
  const { currentView, setCurrentView, sidebarOpen, setSidebarOpen, profile } = useAppStore();
  const email = profile?.email || '';

  const handleSignOut = async () => {
    try {
      await signOut({ redirect: false });
    } catch (error) {
      console.error('[Navbar] signOut failed:', error);
    } finally {
      useAppStore.getState().setProfile(null);
      setCurrentView('landing');
      router.push('/');
    }
  };

  if (currentView === 'landing') return null;

  return (
    <header className="sticky top-0 z-50 w-full border-b border-[#312839] bg-[#09090b]/80 backdrop-blur-md">
      <div className="flex h-16 items-center justify-between px-4 md:px-6">
        {/* Left: hamburger + logo */}
        <div className="flex items-center gap-3">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setSidebarOpen(!sidebarOpen)}
            className="text-gray-400 hover:text-white hover:bg-white/5 shrink-0"
          >
            {sidebarOpen ? <X className="h-5 w-5" /> : <Menu className="h-5 w-5" />}
          </Button>

          <button
            onClick={() => setCurrentView('dashboard')}
            className="flex items-center gap-2.5 hover:opacity-80 transition-opacity"
          >
            <div className="overflow-hidden rounded-xl shadow-[0_0_24px_rgba(122,252,255,0.18),0_0_48px_rgba(184,140,255,0.15)]">
              <Image
                src="/HYDRASKRIPT_LOGO.png"
                alt="HYDRASKRIPT"
                width={160}
                height={44}
                className="h-9 w-auto object-contain"
                priority
              />
            </div>
          </button>
        </div>

        {/* Right: credits + email + sign out */}
        <div className="flex items-center gap-3">
          {profile && (
            <div className="flex items-center gap-2 px-3 py-1.5 bg-cyan-500/10 rounded-xl border border-cyan-500/30">
              <Zap className="h-4 w-4 text-cyan-400" />
              <span className="text-sm font-bold text-cyan-400">{profile.credits.toLocaleString()} Credits</span>
            </div>
          )}

          <span className="text-xs text-gray-500 hidden md:inline max-w-[160px] truncate">{email}</span>

          <div className="w-px h-6 bg-[#312839] hidden sm:block" />

          <Button
            variant="ghost"
            size="icon"
            onClick={handleSignOut}
            className="text-gray-400 hover:text-red-400 hover:bg-white/5"
            title="Sign out"
          >
            <LogOut className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </header>
  );
}
