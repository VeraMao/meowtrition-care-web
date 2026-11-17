import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { supabase } from './supabase'
import type { Cat } from './types'
import { DEFAULT_TZ } from './time'

interface Ctx {
  session: Session | null
  loading: boolean
  catsLoaded: boolean
  cats: Cat[]
  cat: Cat | null
  timezone: string
  selectCat: (id: string) => void
  reloadCats: () => Promise<void>
}
const SessionCtx = createContext<Ctx | null>(null)

const KEY = 'meowtrition.currentCat'
const read = () => { try { return localStorage.getItem(KEY) } catch { return null } }
const write = (v: string) => { try { localStorage.setItem(KEY, v) } catch { /* storage unavailable */ } }

export function SessionProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [loading, setLoading] = useState(true)
  const [cats, setCats] = useState<Cat[]>([])
  const [catsLoaded, setCatsLoaded] = useState(false)
  const [catId, setCatId] = useState<string | null>(read())
  const [timezone, setTz] = useState(DEFAULT_TZ)

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => { setSession(data.session); setLoading(false) })
    const { data: sub } = supabase.auth.onAuthStateChange((_e, s) => setSession(s))
    return () => sub.subscription.unsubscribe()
  }, [])

  const reloadCats = useCallback(async () => {
    if (!session) { setCats([]); setCatsLoaded(false); return }
    const [{ data }, { data: p }] = await Promise.all([
      supabase.from('cats').select('*').is('archived_at', null).order('created_at'),
      supabase.from('profiles').select('timezone').eq('id', session.user.id).maybeSingle(),
    ])
    setCats((data ?? []) as Cat[])
    setCatsLoaded(true)
    if (p?.timezone) setTz(p.timezone)
  }, [session])

  useEffect(() => { reloadCats() }, [reloadCats])

  const cat = cats.find(c => c.id === catId) ?? cats[0] ?? null
  const selectCat = (id: string) => { setCatId(id); write(id) }

  return (
    <SessionCtx.Provider value={{ session, loading, catsLoaded, cats, cat, timezone, selectCat, reloadCats }}>
      {children}
    </SessionCtx.Provider>
  )
}

export function useSession() {
  const c = useContext(SessionCtx)
  if (!c) throw new Error('useSession outside SessionProvider')
  return c
}
