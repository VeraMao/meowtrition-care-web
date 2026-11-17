import { supabase } from './supabase'
import { loadRows } from './data'
import { computeMetrics } from './metrics'
import { templateSummary } from './summary'
import { weekEndingToday } from './time'
import type { Cat, CareReport } from './types'

/**
 * Generate this week's review. Prefers the server route (which can call the AI with a secret key).
 * When that route isn't available (local `npm run dev` has no /api), builds the template summary
 * in the browser instead. Both paths save status needs_review; the template path is labeled is_mock.
 */
export async function generateReview(cat: Cat, timezone: string): Promise<CareReport> {
  const { data: s } = await supabase.auth.getSession()
  try {
    const r = await fetch('/api/care-review', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${s.session?.access_token ?? ''}` },
      body: JSON.stringify({ cat_id: cat.id }),
    })
    if (r.ok && r.headers.get('content-type')?.includes('json')) return await r.json()
    if (r.status !== 404 && r.headers.get('content-type')?.includes('json')) {
      const j = await r.json(); throw new Error(j.detail ?? j.error ?? `HTTP ${r.status}`)
    }
  } catch (e) {
    if (!(e instanceof TypeError)) throw e   // real server error: surface it; network error: fall back
  }
  const w = weekEndingToday(new Date(), timezone)
  const rows = await loadRows(cat.id, w.start, w.end)
  const metrics = computeMetrics({ cat, days: w.days, tz: timezone, ...rows })
  const summary = { ...templateSummary(cat, metrics), ai_status: 'not_configured' as const, ai_error: 'AI runs only on the deployed server, not in local dev' }
  const { data, error } = await supabase.from('care_reports').upsert({
    cat_id: cat.id, period_start: w.start.toISOString(), period_end: w.end.toISOString(), metrics, summary,
    status: 'needs_review', approved_at: null, vet_draft_body: summary.vet_email, is_mock: true,
  }, { onConflict: 'owner_id,cat_id,period_start,period_end' }).select().single()
  if (error) throw new Error(error.message)
  return data as CareReport
}
