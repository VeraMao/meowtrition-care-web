import { useState } from 'react'
import { supabase } from '../lib/supabase'
import { Button, Field, inputCls } from '../components/ui'

/** Google is the main way in. Email + password stays available for people without a Google account. */
export default function Login() {
  const [showEmail, setShowEmail] = useState(false)
  const [mode, setMode] = useState<'in' | 'up'>('in')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [msg, setMsg] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const google = async () => {
    setBusy(true); setMsg(null)
    const { error } = await supabase.auth.signInWithOAuth({
      provider: 'google',
      options: { redirectTo: window.location.origin },   // back to this site (Vercel or localhost)
    })
    if (error) { setBusy(false); setMsg(error.message) }  // on success the browser leaves for Google
  }

  const go = async (e: React.FormEvent) => {
    e.preventDefault(); setBusy(true); setMsg(null)
    const r = mode === 'in'
      ? await supabase.auth.signInWithPassword({ email, password })
      : await supabase.auth.signUp({ email, password, options: { emailRedirectTo: window.location.origin } })
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

      <Button onClick={google} disabled={busy} className="flex w-full items-center justify-center gap-3">
        <svg aria-hidden width="18" height="18" viewBox="0 0 48 48">
          <path fill="#FFC107" d="M43.6 20.5H42V20H24v8h11.3C33.7 32.7 29.2 36 24 36c-6.6 0-12-5.4-12-12s5.4-12 12-12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34.1 6.1 29.3 4 24 4 12.9 4 4 12.9 4 24s8.9 20 20 20 20-8.9 20-20c0-1.3-.1-2.4-.4-3.5z"/>
          <path fill="#FF3D00" d="M6.3 14.7l6.6 4.8C14.7 15.1 19 12 24 12c3.1 0 5.9 1.2 8 3.1l5.7-5.7C34.1 6.1 29.3 4 24 4 16.3 4 9.7 8.3 6.3 14.7z"/>
          <path fill="#4CAF50" d="M24 44c5.2 0 9.9-2 13.4-5.2l-6.2-5.2C29.2 35.1 26.7 36 24 36c-5.2 0-9.6-3.3-11.3-8l-6.5 5C9.5 39.6 16.2 44 24 44z"/>
          <path fill="#1976D2" d="M43.6 20.5H42V20H24v8h11.3c-.8 2.2-2.2 4.2-4.1 5.6l6.2 5.2C37 39.2 44 34 44 24c0-1.3-.1-2.4-.4-3.5z"/>
        </svg>
        {busy && !showEmail ? 'Opening Google…' : 'Continue with Google'}
      </Button>
      {msg && !showEmail && <p role="alert" className="text-sm">{msg}</p>}

      {!showEmail ? (
        <button type="button" className="text-sm text-muted underline" onClick={() => { setShowEmail(true); setMsg(null) }}>
          No Google account? Use email instead
        </button>
      ) : (
        <>
          <form onSubmit={go} className="space-y-4 border-t border-line pt-6">
            <Field label="Email">{id => <input id={id} type="email" required autoComplete="email" className={inputCls} value={email} onChange={e => setEmail(e.target.value)} />}</Field>
            <Field label="Password" hint={mode === 'up' ? 'At least 6 characters.' : undefined}>
              {id => <input id={id} type="password" required minLength={6} autoComplete={mode === 'in' ? 'current-password' : 'new-password'} className={inputCls} value={password} onChange={e => setPassword(e.target.value)} />}
            </Field>
            {msg && <p role="alert" className="text-sm">{msg}</p>}
            <Button type="submit" variant="secondary" disabled={busy} className="w-full">{busy ? 'Please wait…' : mode === 'in' ? 'Sign in with email' : 'Create account'}</Button>
          </form>
          <button type="button" className="text-sm text-muted underline" onClick={() => setMode(mode === 'in' ? 'up' : 'in')}>
            {mode === 'in' ? 'New here? Create an account with email' : 'Already have an account? Sign in'}
          </button>
        </>
      )}
    </main>
  )
}
