'use client'

import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { Button } from '@/components/ui/button'
import { Input } from '@/components/ui/input'
import { Label } from '@/components/ui/label'
import { toast } from '@/hooks/use-toast'
import { Loader2, ArrowLeft } from 'lucide-react'

export default function ForgotPasswordPage() {
  const router = useRouter()
  const [email, setEmail] = useState('')
  const [loading, setLoading] = useState(false)

  const handleForgotPassword = async (e: React.FormEvent) => {
    e.preventDefault()
    setLoading(true)

    try {
      const response = await fetch('/api/auth/forgot-password', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ email }),
      })

      const result = await response.json().catch(() => null)

      if (!response.ok || !result?.success) {
        throw new Error(result?.error || 'Please try again.')
      }

      toast({
        title: 'Check your email!',
        description:
          'If an account exists for that address, a reset link has been generated.',
      })

      router.push('/login?reset=sent')
    } catch (error) {
      console.error('Forgot password error:', error)
      toast({
        title: 'Failed to process reset request',
        description:
          error instanceof Error ? error.message : 'Please try again.',
        variant: 'destructive',
      })
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen flex items-center justify-center bg-[#09090b]">
      <div className="w-full max-w-md p-8 rounded-2xl bg-[#0d0d10] border border-white/10 shadow-2xl" suppressHydrationWarning>
        <Button
          variant="ghost"
          size="sm"
          onClick={() => router.push('/login')}
          className="mb-6 text-slate-400 hover:text-white"
        >
          <ArrowLeft className="h-4 w-4 mr-2" />
          Back to Login
        </Button>

        <div className="text-center mb-8">
          <h2 className="text-2xl font-bold text-white mb-2">Forgot Password?</h2>
          <p className="text-sm text-slate-400">
            Enter your email and we&apos;ll send you a link to reset your password.
          </p>
        </div>

        <form onSubmit={handleForgotPassword} className="space-y-4">
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

          <Button
            type="submit"
            disabled={loading}
            className="btn-gradient w-full py-6"
          >
            {loading ? <Loader2 className="h-4 w-4 animate-spin" /> : 'Send Reset Link'}
          </Button>
        </form>
      </div>
    </div>
  )
}
