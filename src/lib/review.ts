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
export async function generateReview(cat: Cat, timezone: string, opts: { isDev?: boolean } = {}): Promise<CareReport> {
  const isDev = opts.isDev ?? import.meta.env.DEV
  const { data: s } = await supabase.auth.getSession()
  let r: Response
  try {
    r = await fetch('/api/care-review', {
      method: 'POST',
      headers: { 'content-type': 'application/json', authorization: `Bearer ${s.session?.access_token ?? ''}` },
      body: JSON.stringify({ cat_id: cat.id }),
    })
  } catch {
    throw new Error("Couldn't reach the server. Check your connection and try again.")
  }
  const isJson = r.headers.get('content-type')?.includes('json')
  if (r.ok && isJson) return await r.json()
  if (isJson) {
    const j = await r.json(); throw new Error(friendlyReviewError(j.detail ?? j.error ?? `HTTP ${r.status}`))
  }
  // Only local dev (`npm run dev`, which has no /api) may fall back to the browser template.
  // On the deployed site a missing or crashing route is a real error: say so, don't fake a review.
  if (!(isDev && r.status === 404)) {
    throw new Error(`The server had a problem creating the review (error ${r.status}). Nothing was saved; please try again in a minute.`)
  }
  // Local dev has no /api: build the template version in the browser (same DB limits apply).
  const w = weekEndingToday(new Date(), timezone)
  const rows = await loadRows(cat.id, w.start, w.end)
  const metrics = computeMetrics({ cat, days: w.days, tz: timezone, ...rows })
  const summary = { ...templateSummary(cat, metrics), ai_status: 'not_configured' as const, ai_error: 'AI runs only on the deployed server, not in local dev' }
  const { data, error } = await supabase.from('care_reports').upsert({
    cat_id: cat.id, period_start: w.start.toISOString(), period_end: w.end.toISOString(), metrics, summary,
    status: 'needs_review', approved_at: null, vet_draft_body: summary.vet_email, is_mock: true,
  }, { onConflict: 'owner_id,cat_id,period_start,period_end' }).select().single()
  if (error) throw new Error(friendlyReviewError(error.message))
  return data as CareReport
}

export interface ReportQuota { used: number; limit: number; next_available_at: string | null; last_generated_at: string | null; has_new_data: boolean }

export async function loadQuota(catId: string): Promise<ReportQuota | null> {
  const { data, error } = await supabase.rpc('report_quota', { p_cat_id: catId })
  return error ? null : (data as ReportQuota)
}

/** Turn the database's limit errors into plain sentences. */
export function friendlyReviewError(message: string): string {
  if (message.includes('no_new_data')) return 'Nothing new has been logged, changed or deleted since your last review, so a new one would be the same. Log something first.'
  const m = message.match(/weekly_limit:(\S+)/)
  if (m) return `You've used all 3 reviews for this cat in the last 7 days. Next one available ${new Date(m[1]).toLocaleString('en-US', { weekday: 'short', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}.`
  return message
}
