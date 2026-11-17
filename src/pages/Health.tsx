import { useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useSession } from '../lib/session'
import { supabase } from '../lib/supabase'
import { useLoad, useSubmit } from '../lib/data'
import { generateReview } from '../lib/review'
import { localDate } from '../lib/time'
import type { CareReport, VetVisit } from '../lib/types'
import { Badge, Button, Card, Empty, Field, inputCls, PageFade } from '../components/ui'

export default function Health() {
  const { cat, timezone } = useSession()
  const nav = useNavigate()
  const reports = useLoad(async () => {
    const { data, error } = await supabase.from('care_reports').select('id,period_start,period_end,status,is_mock,created_at').eq('cat_id', cat!.id).order('period_start', { ascending: false })
    if (error) throw new Error(error.message); return data as Pick<CareReport, 'id' | 'period_start' | 'period_end' | 'status' | 'is_mock' | 'created_at'>[]
  }, [cat?.id])
  const visits = useLoad(async () => {
    const { data, error } = await supabase.from('vet_visits').select('*').eq('cat_id', cat!.id).order('visit_date', { ascending: false })
    if (error) throw new Error(error.message); return data as VetVisit[]
  }, [cat?.id])
  const [gen, setGen] = useState<'idle' | 'running' | string>('idle')
  const [editing, setEditing] = useState<VetVisit | 'new' | null>(null)

  const create = async () => {
    setGen('running')
    try { const r = await generateReview(cat!, timezone); nav(`/health/report/${r.id}`) }
    catch (e) { setGen((e as Error).message) }
  }

  return (
    <PageFade>
      <h1 className="text-xl font-semibold">Health</h1>
      <Card>
        <div className="flex items-center justify-between gap-3">
          <div><h2 className="font-semibold">Weekly review</h2><p className="text-sm text-muted">Last 7 days, including today so far. You review it before anything goes to a vet. Creating it again today updates the same review.</p></div>
          <Button onClick={create} disabled={gen === 'running'}>{gen === 'running' ? 'Working…' : 'Create'}</Button>
        </div>
        {gen !== 'idle' && gen !== 'running' && <p role="alert" className="mt-2 text-sm">⚠ Couldn't create: {gen}</p>}
        {reports.data && reports.data.length > 0 && (
          <ul className="mt-3 divide-y divide-line">
            {reports.data.map(r => (
              <li key={r.id}><Link to={`/health/report/${r.id}`} className="flex min-h-12 items-center justify-between">
                <span className="num">{localDate(r.period_start, timezone)} → {localDate(new Date(new Date(r.period_end).getTime() - 1), timezone)}</span>
                <span className="flex gap-1">{r.is_mock && <Badge>Template</Badge>}<Badge>{r.status === 'approved' ? '✓ Approved' : r.status === 'stale' ? 'Out of date' : 'Needs review'}</Badge></span>
              </Link></li>
            ))}
          </ul>
        )}
      </Card>

      <div className="flex items-center justify-between pt-2">
        <h2 className="font-semibold">Vet visits</h2>
        {!editing && <Button variant="secondary" onClick={() => setEditing('new')}>+ Add visit</Button>}
      </div>
      {editing && <VisitForm row={editing === 'new' ? undefined : editing} onDone={() => { setEditing(null); visits.reload() }} />}
      {visits.data?.length === 0 && !editing && <Empty title="No vet visits yet">Add your last visit so weekly reviews can mention it.</Empty>}
      <ul className="space-y-2">
        {visits.data?.map(v => (
          <li key={v.id}><Card>
            <div className="flex items-start justify-between gap-2">
              <div className="min-w-0 space-y-1">
                <p className="font-medium num">{v.visit_date}{v.reason && ` · ${v.reason}`}</p>
                {v.diagnosis_as_written && <p className="text-sm"><span className="text-muted">Vet said:</span> {v.diagnosis_as_written}</p>}
                {v.medications && <p className="text-sm"><span className="text-muted">Medications:</span> {v.medications}</p>}
                {v.next_checkup_date && <p className="text-sm"><span className="text-muted">Next check-up:</span> {v.next_checkup_date}</p>}
              </div>
              <Button variant="ghost" className="px-3" onClick={() => setEditing(v)}>Edit</Button>
            </div>
          </Card></li>
        ))}
      </ul>
    </PageFade>
  )
}

function VisitForm({ row, onDone }: { row?: VetVisit; onDone: () => void }) {
  const { cat } = useSession()
  const [f, setF] = useState({
    visit_date: row?.visit_date ?? new Date().toISOString().slice(0, 10), reason: row?.reason ?? '',
    diagnosis_as_written: row?.diagnosis_as_written ?? '', medications: row?.medications ?? '',
    next_checkup_date: row?.next_checkup_date ?? '', notes: row?.notes ?? '',
  })
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement | HTMLTextAreaElement>) => setF({ ...f, [k]: e.target.value })
  const { busy, error, submit } = useSubmit()
  const save = async () => {
    const body = { cat_id: cat!.id, ...Object.fromEntries(Object.entries(f).map(([k, v]) => [k, v === '' ? null : v])) }
    if (await submit(async () => row ? supabase.from('vet_visits').update(body).eq('id', row.id) : supabase.from('vet_visits').insert(body))) onDone()
  }
  const remove = async () => {
    if (row && confirm('Delete this visit?') && await submit(async () => supabase.from('vet_visits').delete().eq('id', row.id))) onDone()
  }
  return (
    <Card>
      <form className="space-y-4" onSubmit={e => { e.preventDefault(); save() }}>
        <Field label="Visit date">{id => <input id={id} type="date" required className={inputCls} value={f.visit_date} onChange={set('visit_date')} />}</Field>
        <Field label="Reason for visit">{id => <input id={id} className={inputCls} value={f.reason} onChange={set('reason')} />}</Field>
        <Field label="What the vet said" hint="Write it the way the vet said or wrote it.">{id => <textarea id={id} rows={3} className={inputCls + ' py-2'} value={f.diagnosis_as_written} onChange={set('diagnosis_as_written')} />}</Field>
        <Field label="Medications" hint="Name and dose exactly as prescribed.">{id => <textarea id={id} rows={2} className={inputCls + ' py-2'} value={f.medications} onChange={set('medications')} />}</Field>
        <Field label="Next check-up (optional)">{id => <input id={id} type="date" className={inputCls} value={f.next_checkup_date} onChange={set('next_checkup_date')} />}</Field>
        <Field label="Notes (optional)">{id => <input id={id} className={inputCls} value={f.notes} onChange={set('notes')} />}</Field>
        {error && <p role="alert" className="text-sm">⚠ Not saved: {error}</p>}
        <div className="flex gap-2">
          <Button type="submit" disabled={busy} className="flex-1">{busy ? 'Saving…' : 'Save visit'}</Button>
          <Button type="button" variant="secondary" onClick={onDone}>Cancel</Button>
          {row && <Button type="button" variant="danger" onClick={remove}>Delete</Button>}
        </div>
      </form>
    </Card>
  )
}
