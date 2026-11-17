import { useEffect, useState } from 'react'
import { Link, useNavigate, useParams } from 'react-router-dom'
import { supabase } from '../lib/supabase'
import { useLoad, useSubmit } from '../lib/data'
import { friendlyReviewError, generateReview } from '../lib/review'
import { useSession } from '../lib/session'
import { fmtDay } from '../lib/time'
import type { CareReport } from '../lib/types'
import { Badge, Button, Card, EmergencyNotice, PageFade, inputCls } from '../components/ui'

export default function Report() {
  const { id } = useParams()
  const { timezone, cats } = useSession()
  const nav = useNavigate()
  const [regen, setRegen] = useState<string | null>(null)
  const r = useLoad(async () => {
    const { data, error } = await supabase.from('care_reports').select('*').eq('id', id!).maybeSingle()
    if (error) throw new Error(error.message); return data as CareReport | null
  }, [id])
  const [draft, setDraft] = useState('')
  const [copied, setCopied] = useState(false)
  const { busy, error, submit } = useSubmit()
  useEffect(() => { if (r.data) setDraft(r.data.vet_draft_body ?? r.data.summary.vet_email) }, [r.data])

  if (r.loading && !r.data) return <PageFade><p className="text-muted">Loading…</p></PageFade>
  if (!r.data) return <PageFade><p>Report not found. <Link className="underline" to="/health">Back</Link></p></PageFade>
  const rep = r.data, m = rep.metrics, s = rep.summary
  const dirty = draft !== (rep.vet_draft_body ?? s.vet_email)

  // Editing the email after approval clears the approval: you approve exactly what you'll send.
  const saveDraft = async () => { if (await submit(async () => supabase.from('care_reports').update({ vet_draft_body: draft, status: 'needs_review', approved_at: null }).eq('id', rep.id))) r.reload() }
  const approve = async () => { if (await submit(async () => supabase.from('care_reports').update({ status: 'approved', approved_at: new Date().toISOString() }).eq('id', rep.id))) r.reload() }
  const remove = async () => { if (confirm('Delete this weekly review? Your logs are not affected.') && await submit(async () => supabase.from('care_reports').delete().eq('id', rep.id))) nav('/health') }
  const copy = async () => { try { await navigator.clipboard.writeText(draft); setCopied(true); setTimeout(() => setCopied(false), 1500) } catch { alert('Copy failed. Select the text and copy it manually.') } }

  return (
    <PageFade>
      <Link to="/health" className="text-sm text-muted underline">← Health</Link>
      <div className="flex flex-wrap items-center gap-2">
        <h1 className="text-xl font-semibold">Week of {fmtDay(m.days[0])}</h1>
        <Badge>{rep.status === 'approved' ? `✓ Approved ${new Date(rep.approved_at!).toLocaleDateString('en-US', { timeZone: timezone })}` : rep.status === 'stale' ? 'Out of date' : 'Needs review'}</Badge>
        <Badge>{aiLabel(s)}</Badge>
      </div>
      <p className="text-sm text-muted">{aiExplain(s)}</p>
      {rep.status === 'stale' && (
        <div role="alert" className="space-y-2 rounded-xl border-2 border-ink p-3">
          <p className="font-medium">Your records changed after this review was made.</p>
          <p className="text-sm">It may no longer match your logs, so it can't be approved. Create it again to use the latest data.</p>
          <Button disabled={regen === 'running'} onClick={async () => {
            const cat = cats.find(c => c.id === rep.cat_id); if (!cat) return
            setRegen('running')
            try { const n = await generateReview(cat, timezone); setRegen(null); if (n.id === rep.id) r.reload(); else nav(`/health/report/${n.id}`) }
            catch (e) { setRegen(friendlyReviewError((e as Error).message)) }
          }}>{regen === 'running' ? 'Working…' : 'Create it again'}</Button>
          {regen && regen !== 'running' && <p className="text-sm">⚠ {regen}</p>}
        </div>
      )}
      {m.urgent && <EmergencyNotice />}

      <Card>
        <h2 className="mb-2 font-semibold">Coverage</h2>
        <p className="text-sm num">Food {m.food.daysLogged}/7 days · Water {m.water.daysLogged}/7 · Litter {m.litter.cleanings.length} cleanings · Weight {m.weight.points.length} weigh-ins</p>
      </Card>
      <Card>
        <h2 className="mb-2 font-semibold">This week</h2>
        <ul className="list-disc space-y-1.5 pl-5 text-[15px]">{s.observations.map((o, i) => <li key={i}>{o.text}{o.dates.length > 0 && <span className="text-sm text-muted"> ({o.dates.map(fmtDay).join(', ')})</span>}</li>)}</ul>
      </Card>
      {s.questions_for_vet.length > 0 && <Card><h2 className="mb-2 font-semibold">Questions for the vet</h2><ol className="list-decimal space-y-1 pl-5">{s.questions_for_vet.map((q, i) => <li key={i}>{q}</li>)}</ol></Card>}
      {s.limitations.length > 0 && <Card><h2 className="mb-2 font-semibold">Gaps and limits</h2><ul className="list-disc space-y-1 pl-5 text-sm">{s.limitations.map((q, i) => <li key={i}>{q}</li>)}</ul></Card>}

      <Card>
        <h2 className="mb-2 font-semibold">Email draft to your vet</h2>
        <textarea aria-label="Vet email draft" rows={14} className={inputCls + ' py-2 font-mono text-sm'} value={draft} onChange={e => setDraft(e.target.value)} />
        <p className="mt-2 text-sm text-muted">Nothing is sent from this app. Copy it into your own email when you're ready.</p>
        {error && <p role="alert" className="mt-2 text-sm">⚠ {error}</p>}
        <div className="mt-3 flex flex-wrap gap-2">
          {dirty && <Button onClick={saveDraft} disabled={busy}>Save edits</Button>}
          {!dirty && rep.status === 'needs_review' && <Button onClick={approve} disabled={busy}>I checked it, approve</Button>}
          <Button variant="secondary" onClick={copy}>{copied ? 'Copied ✓' : 'Copy email'}</Button>
        </div>
        {rep.status === 'needs_review' && <p className="mt-2 text-xs text-muted">Before approving: right cat and dates · numbers match your log · nothing you didn't record · email facts correct.</p>}
      </Card>
      <div className="flex justify-end"><Button variant="ghost" onClick={remove} disabled={busy}>Delete this review</Button></div>
    </PageFade>
  )
}

function aiLabel(s: CareReport['summary']) {
  const st = s.ai_status ?? (s.is_mock ? 'not_configured' : 'ai')
  return st === 'ai' ? 'AI summary' : st === 'failed' ? 'Template · AI failed' : 'Template · AI not set up'
}
function aiExplain(s: CareReport['summary']) {
  const st = s.ai_status ?? (s.is_mock ? 'not_configured' : 'ai')
  if (st === 'ai') return `Written by AI (${s.model}) from numbers computed by the app. Every number and date was checked against your logs before it was shown.`
  if (st === 'failed') return `AI was tried but its answer was rejected (${s.ai_error ?? 'unknown error'}), so this is the fixed template. The numbers are computed from your logs.`
  return `Written from a fixed template${s.ai_error ? ` (${s.ai_error})` : ' because AI is not set up'}. The numbers are computed from your logs.`
}
