// POST /api/care-review  { cat_id }  (Authorization: Bearer <user access token>)
// Loads the user's own rows (RLS applies, because we use the user's token, not a service key),
// computes metrics in code, writes the summary (AI if configured, else a labeled template),
// and saves the report with status needs_review.
import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import { computeMetrics } from '../src/lib/metrics.js'
import { summarize } from '../src/lib/ai.js'
import { weekEndingToday } from '../src/lib/time.js'
import type { Cat } from '../src/lib/types.js'

export default async function handler(req: VercelRequest, res: VercelResponse) {
  if (req.method !== 'POST') return res.status(405).json({ error: 'method_not_allowed' })
  const token = (req.headers.authorization ?? '').replace(/^Bearer /, '')
  const catId = (req.body as { cat_id?: string } | undefined)?.cat_id
  if (!token) return res.status(401).json({ error: 'not_signed_in' })
  if (!catId) return res.status(400).json({ error: 'cat_id_required' })

  const url = process.env.SUPABASE_URL, anon = process.env.SUPABASE_ANON_KEY
  if (!url || !anon) return res.status(500).json({ error: 'server_not_configured' })
  const db = createClient(url, anon, { global: { headers: { Authorization: `Bearer ${token}` } }, auth: { persistSession: false } })

  const { data: user } = await db.auth.getUser(token)
  if (!user.user) return res.status(401).json({ error: 'not_signed_in' })

  const { data: cat } = await db.from('cats').select('*').eq('id', catId).maybeSingle<Cat>()
  if (!cat) return res.status(404).json({ error: 'cat_not_found' })   // RLS: someone else's cat looks the same as no cat

  const { data: profile } = await db.from('profiles').select('timezone').eq('id', user.user.id).maybeSingle()
  const tz = profile?.timezone ?? 'America/Chicago'
  const w = weekEndingToday(new Date(), tz)
  const s = w.start.toISOString(), e = w.end.toISOString()

  const [feedings, hydration, litter, weights, visits, medLogs, medications] = await Promise.all([
    db.from('feeding_logs').select('*').eq('cat_id', catId).gte('occurred_at', s).lt('occurred_at', e),
    db.from('hydration_logs').select('*').or(`cat_id.eq.${catId},cat_id.is.null`).gte('observed_at', s).lt('observed_at', e),
    db.from('litter_logs').select('*').or(`cat_id.eq.${catId},cat_id.is.null`).gte('cleaned_at', s).lt('cleaned_at', e),
    db.from('weight_logs').select('*').eq('cat_id', catId).gte('measured_at', s).lt('measured_at', e),
    db.from('vet_visits').select('*').eq('cat_id', catId).order('visit_date', { ascending: false }).limit(5),
    db.from('medication_logs').select('*').eq('cat_id', catId).gte('given_at', s).lt('given_at', e),
    db.from('medications').select('*').eq('cat_id', catId),
  ])
  const failed = [feedings, hydration, litter, weights, visits, medLogs, medications].find(r => r.error)
  if (failed) return res.status(500).json({ error: 'load_failed', detail: failed.error?.message })

  const metrics = computeMetrics({
    cat, days: w.days, tz,
    feedings: feedings.data ?? [], hydration: hydration.data ?? [], litter: litter.data ?? [],
    weights: weights.data ?? [], visits: visits.data ?? [], medLogs: medLogs.data ?? [], medications: medications.data ?? [],
  })

  const { data: quota } = await db.rpc('report_quota', { p_cat_id: catId })
  const q = quota as { used: number; has_new_data: boolean; next_available_at: string | null } | null
  if (q && !q.has_new_data) return res.status(409).json({ error: 'limit', detail: 'no_new_data' })
  if (q && q.used >= 3) return res.status(409).json({ error: 'limit', detail: `weekly_limit:${q.next_available_at}` })

  const summary = await summarize(cat, metrics, {
    apiKey: process.env.ANTHROPIC_API_KEY, model: process.env.ANTHROPIC_MODEL,
    openaiKey: process.env.OPENAI_API_KEY, openaiModel: process.env.OPENAI_MODEL,
  })

  const { data: report, error } = await db.from('care_reports').upsert({
    cat_id: catId, period_start: s, period_end: e, metrics, summary,
    status: 'needs_review', approved_at: null, vet_draft_body: summary.vet_email, is_mock: summary.is_mock,
  }, { onConflict: 'owner_id,cat_id,period_start,period_end' }).select().single()
  if (error) {
    const limited = /no_new_data|weekly_limit/.test(error.message)
    return res.status(limited ? 409 : 500).json({ error: limited ? 'limit' : 'save_failed', detail: error.message })
  }
  return res.status(200).json(report)
}
