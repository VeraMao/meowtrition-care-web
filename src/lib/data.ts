import { useCallback, useEffect, useState } from 'react'
import { supabase } from './supabase'
import type { FeedingLog, HydrationLog, LitterLog, Medication, MedicationLog, VetVisit, WeightLog } from './types'

/** Tiny fetch hook: { data, error, loading, reload }. */
export function useLoad<T>(fn: () => Promise<T>, deps: unknown[]) {
  const [data, setData] = useState<T | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const run = useCallback(fn, deps)
  const reload = useCallback(async () => {
    setLoading(true); setError(null)
    try { setData(await run()) } catch (e) { setError((e as Error).message) } finally { setLoading(false) }
  }, [run])
  useEffect(() => { reload() }, [reload])
  return { data, error, loading, reload }
}

const must = <T,>(r: { data: T | null; error: { message: string } | null }) => {
  if (r.error) throw new Error(r.error.message)
  return r.data as T
}

export interface WeekRows {
  feedings: FeedingLog[]; hydration: HydrationLog[]; litter: LitterLog[]; weights: WeightLog[]; visits: VetVisit[]
  medLogs: MedicationLog[]
  medications: Medication[]
}

/** All rows for one cat (plus unknown-cat water/litter) between two instants. */
export async function loadRows(catId: string, start: Date, end: Date): Promise<WeekRows> {
  const s = start.toISOString(), e = end.toISOString()
  const [f, h, l, w, v, m, md] = await Promise.all([
    supabase.from('feeding_logs').select('*').eq('cat_id', catId).gte('occurred_at', s).lt('occurred_at', e).order('occurred_at', { ascending: false }),
    supabase.from('hydration_logs').select('*').or(`cat_id.eq.${catId},cat_id.is.null`).gte('observed_at', s).lt('observed_at', e).order('observed_at', { ascending: false }),
    supabase.from('litter_logs').select('*').or(`cat_id.eq.${catId},cat_id.is.null`).gte('cleaned_at', s).lt('cleaned_at', e).order('cleaned_at', { ascending: false }),
    supabase.from('weight_logs').select('*').eq('cat_id', catId).gte('measured_at', s).lt('measured_at', e).order('measured_at', { ascending: false }),
    supabase.from('vet_visits').select('*').eq('cat_id', catId).order('visit_date', { ascending: false }),
    supabase.from('medication_logs').select('*').eq('cat_id', catId).gte('given_at', s).lt('given_at', e).order('given_at', { ascending: false }),
    supabase.from('medications').select('*').eq('cat_id', catId),
  ])
  return { feedings: must(f), hydration: must(h), litter: must(l), weights: must(w), visits: must(v), medLogs: must(m), medications: must(md) }
}

/** Client-side guard against double submits (the "simple idempotency" from the plan). */
export function useSubmit() {
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const submit = async (fn: () => Promise<{ error: { message: string } | null }>) => {
    if (busy) return false
    setBusy(true); setError(null)
    try {
      const r = await fn()
      if (r.error) { setError(r.error.message); return false }
      return true
    } catch (e) { setError((e as Error).message); return false } finally { setBusy(false) }
  }
  return { busy, error, submit }
}
