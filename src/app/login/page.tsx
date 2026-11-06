'use client';

import { useState, useEffect, Suspense } from 'react';
import { PageBackground } from '@/components/PageBackground'
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { toast } from '@/hooks/use-toast';
import { signIn, useSession } from 'next-auth/react';
import { useRouter, useSearchParams } from 'next/navigation';
import { Loader2, ArrowLeft } from 'lucide-react';

function LoginForm() {
  const router = useRouter();
  const searchParams = useSearchParams();
  const next = searchParams.get('next') || '/dashboard';
  const isSignUp = searchParams.get('mode') === 'signup';
  const [email, setEmail] = useState('');
  const [password, setPassword] = useState('');
  const [loading, setLoading] = useState(false);
  const { status } = useSession();

  const safeNext = next.startsWith('/') && !next.startsWith('//') ? next : '/dashboard';

  useEffect(() => {
    if (status === 'authenticated') router.replace(safeNext);
  }, [status, router, safeNext]);

  const handleAuth = async (e: React.FormEvent) => {
    e.preventDefault();
    setLoading(true);

    try {
      if (isSignUp) {
        const response = await fetch('/api/auth/register', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ email, password }),
        });
        const result = await response.json().catch(() => null);

        if (!response.ok || !result?.success) {
          throw new Error(result?.error || 'Could not create your account.');
        }
      }

      const result = await signIn('credentials', {
        email,
        password,
        redirect: false,
      });

      if (result?.error) {
        throw new Error(
          isSignUp
            ? 'Your account was created, but sign-in failed. Please sign in again.'
            : 'Invalid email or password.',
        );
      }

      toast({
        title: isSignUp ? 'Welcome!' : 'Welcome back!',
        description: isSignUp
          ? 'Your account has been created successfully.'
          : undefined,
      });

      router.push(safeNext);
      router.refresh();
    } catch (error) {
      console.error('[Auth] Error:', error);
      toast({
        title: 'Authentication failed',
        description:
          error instanceof Error ? error.message : 'Please check your credentials',
        variant: 'destructive',
      });
    } finally {
      setLoading(false);
    }
  };

  const toggleMode = () => {
    const params = new URLSearchParams();
    if (!isSignUp) params.set('mode', 'signup');
    if (next !== '/') params.set('next', next);
    const qs = params.toString();
    router.replace(qs ? `/login?${qs}` : '/login');
  };

  return (
<PageBackground image="/backgrounds/voice-cloning.jpg" overlay="subtle">
    <div className="min-h-screen flex items-center justify-center">
      <div className="w-full max-w-md p-8 rounded-2xl bg-[#0d0d10] border border-white/10 shadow-2xl" suppressHydrationWarning>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => router.push('/')}
          className="mb-6 text-slate-400 hover:text-white"
        >
          <ArrowLeft className="h-4 w-4 mr-2" />
          Back to Home
        </Button>

        <div className="text-center mb-8">
          <h2 className="text-2xl font-bold text-white mb-2">
            {isSignUp ? 'Create Your Free Account' : 'Welcome Back'}
          </h2>
          <p className="text-sm text-slate-400">
            {isSignUp
              ? '100 free credits on signup — no credit card required.'
              : 'Enter your credentials to access your account.'}
          </p>
        </div>

        <form onSubmit={handleAuth} className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="email" className="text-slate-300 text-xs">Email Address</Label>
            <Input
              id="email"
              type="email"
              value={email}
              onChange={(e) => setEmail(e.target.value)}
              required
              className="bg-white/5 border-white/10 text-white placeholder:text-slate-600"
              placeholder="your@email.com"
            />
          </div>

          <div className="space-y-2">
            <Label htmlFor="password" className="text-slate-300 text-xs">Password</Label>
            <Input
              id="password"
              type="password"
              value={password}
              onChange={(e) => setPassword(e.target.value)}
              required
              className="bg-white/5 border-white/10 text-white placeholder:text-slate-600"
              placeholder="••••••••"
              minLength={6}
            />
          </div>

          <Button type="submit" disabled={loading} className="btn-gradient w-full py-6">
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : isSignUp ? 'Create Account' : 'Sign In'}
          </Button>
        </form>

        <div className="mt-4 space-y-2">
          <Button
            variant="ghost"
            size="sm"
            onClick={toggleMode}
            className="text-purple-300 hover:text-purple-200 text-sm w-full"
          >
            {isSignUp
              ? 'Already have an account? Sign In'
              : 'New to HydraSkript? Create a Free Account'}
          </Button>

          {!isSignUp && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => router.push('/auth/forgot-password')}
              className="text-slate-400 hover:text-white text-sm w-full"
            >
              Forgot your password?
            </Button>
          )}
        </div>
      </div>
    </div>
    </PageBackground>
  );
}

export default function LoginPage() {
  return (
    <Suspense fallback={null}>
      <LoginForm />
    </Suspense>
  );
}
