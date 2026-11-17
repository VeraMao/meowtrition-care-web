import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { Button, Field, inputCls } from '../components/ui'

export default function Login() {
  const [mode, setMode] = useState<'in' | 'up'>('in')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [msg, setMsg] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const go = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true); setMsg(null)
    const r = mode === 'in'
      ? await supabase.auth.signInWithPassword({ email, password })
      : await supabase.auth.signUp({ email, password })
    setBusy(false)
    if (r.error) setMsg(r.error.message)
    else if (mode === 'up' && !r.data.session) setMsg('Check your email to confirm your account, then sign in.')
  }

  return (
    <main className="mx-auto flex min-h-full max-w-sm flex-col justify-center gap-6 p-6">
      <div>
        <h1 className="text-2xl font-semibold">Meowtrition</h1>
        <p className="mt-1 text-muted">Log your cat's care and get an honest weekly summary for your vet.</p>
      </div>
      <form onSubmit={go} className="space-y-4">
        <Field label="Email">{id => <input id={id} type="email" required autoComplete="email" className={inputCls} value={email} onChange={e => setEmail(e.target.value)} />}</Field>
        <Field label="Password" hint={mode === 'up' ? 'At least 6 characters.' : undefined}>
          {id => <input id={id} type="password" required minLength={6} autoComplete={mode === 'in' ? 'current-password' : 'new-password'} className={inputCls} value={password} onChange={e => setPassword(e.target.value)} />}
        </Field>
        {msg && <p role="alert" className="text-sm">{msg}</p>}
        <Button type="submit" disabled={busy} className="w-full">{busy ? 'Please wait…' : mode === 'in' ? 'Sign in' : 'Create account'}</Button>
      </form>
      <button className="text-sm text-muted underline" onClick={() => setMode(mode === 'in' ? 'up' : 'in')}>
        {mode === 'in' ? 'New here? Create an account' : 'Already have an account? Sign in'}
      </button>
    </main>
  )
}
