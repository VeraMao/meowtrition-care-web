import { useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { AnimatePresence, motion } from 'motion/react'
import { useSession } from '../lib/session'
import { supabase } from '../lib/supabase'
import { loadRows, useLoad, useSubmit } from '../lib/data'
import { isUrgent } from '../lib/metrics'
import { fmtTime, toInputValue } from '../lib/time'
import { availableUnits, fmtAmount, kcalFor, labelSummary, labelWarnings, parseNumber, perLabel, UNIT_NAMES, UNIT_WORD, type AmountUnit, type UnitName } from '../lib/food'
import type { Medication, MedicationLog, MedStatus } from '../lib/types'
import { MED_STATUS_LABELS } from '../lib/types'
import type { FeedingLog, Food, HydrationLog, LitterLog, StoolShape, Symptom, WaterMethod, WeightLog } from '../lib/types'
import { SHAPE_LABELS, SYMPTOM_LABELS } from '../lib/types'
import { Button, Card, EmergencyNotice, Empty, Field, inputCls, PageFade, Segmented, Stepper } from '../components/ui'

type Tab = 'feeding' | 'water' | 'litter' | 'weight' | 'meds'
const TABS: { value: Tab; label: string }[] = [
  { value: 'feeding', label: 'Food' }, { value: 'water', label: 'Water' },
  { value: 'litter', label: 'Litter' }, { value: 'weight', label: 'Weight' }, { value: 'meds', label: 'Meds' },
]
const fromInput = (v: string) => new Date(v).toISOString()
const toLocalInput = (iso: string) => toInputValue(new Date(iso))

export default function Log() {
  const [params, setParams] = useSearchParams()
  const tab = (params.get('tab') as Tab) || 'feeding'
  const { cat } = useSession()
  const history = useLoad(() => loadRows(cat!.id, new Date(Date.now() - 7 * 86400e3), new Date(Date.now() + 86400e3)), [cat?.id])
  const [editing, setEditing] = useState<{ tab: Tab; row: unknown } | null>(null)
  const [saved, setSaved] = useState(0)   // bump after each save so the form starts fresh

  const done = () => { setEditing(null); setSaved(n => n + 1); history.reload() }
  const edit = (t: Tab, row: unknown) => { setEditing({ tab: t, row }); window.scrollTo({ top: 0, behavior: 'smooth' }) }
  const del = async (table: string, id: string) => {
    if (!confirm('Delete this entry?')) return
    const { error } = await supabase.from(table).delete().eq('id', id)
    if (error) alert(error.message); else history.reload()
  }
  const key = editing?.tab === tab ? (editing.row as { id: string }).id : 'new'

  return (
    <PageFade>
      <Segmented label="Log type" value={tab} options={TABS} onChange={v => { setEditing(null); setParams({ tab: v }) }} />
      <AnimatePresence mode="wait">
        <motion.div key={`${tab}-${key}-${saved}`} initial={{ opacity: 0 }} animate={{ opacity: 1 }} exit={{ opacity: 0 }} transition={{ duration: 0.15 }}>
          {tab === 'feeding' && <FeedingForm onDone={done} row={editing?.tab === 'feeding' ? editing.row as FeedingLog : undefined} />}
          {tab === 'water' && <WaterForm onDone={done} row={editing?.tab === 'water' ? editing.row as HydrationLog : undefined} />}
          {tab === 'litter' && <LitterForm onDone={done} row={editing?.tab === 'litter' ? editing.row as LitterLog : undefined} />}
          {tab === 'weight' && <WeightForm onDone={done} row={editing?.tab === 'weight' ? editing.row as WeightLog : undefined} />}
          {tab === 'meds' && <MedsForm onDone={done} row={editing?.tab === 'meds' ? editing.row as MedicationLog : undefined} />}
        </motion.div>
      </AnimatePresence>

      <h2 className="pt-2 font-semibold">Last 7 days</h2>
      {history.error && <p role="alert">Couldn't load history: {history.error}</p>}
      {history.loading && !history.data ? <p className="text-muted">Loading…</p> : history.data && (
        <History tab={tab} rows={history.data} catId={cat!.id} onEdit={edit} onDelete={del} />
      )}
    </PageFade>
  )
}

function History({ tab, rows, catId, onEdit, onDelete }: {
  tab: Tab; rows: Awaited<ReturnType<typeof loadRows>>; catId: string
  onEdit: (t: Tab, r: unknown) => void; onDelete: (table: string, id: string) => void
}) {
  const { timezone } = useSession()
  const items: { id: string; when: string; text: string; table: string; row: unknown }[] =
    tab === 'feeding' ? rows.feedings.map(r => ({ id: r.id, when: r.occurred_at, text: `${r.kcal} kcal${r.amount && r.amount_unit ? ` · ${fmtAmount(Number(r.amount), r.amount_unit)}` : ''}${r.food_name_snapshot ? ` · ${r.food_name_snapshot}` : ''}`, table: 'feeding_logs', row: r }))
    : tab === 'water' ? rows.hydration.map(r => ({ id: r.id, when: r.observed_at, text: `${r.volume_ml} mL · ${r.method === 'estimated_drunk' ? 'estimated' : 'bowl difference'}${r.cat_id ? '' : ' · unknown cat'}`, table: 'hydration_logs', row: r }))
    : tab === 'litter' ? rows.litter.map(r => ({ id: r.id, when: r.cleaned_at, text: `${r.urine_count ?? '—'} clumps · ${r.stool_count ?? '—'} stool${r.stool_shape ? ` (${SHAPE_LABELS[r.stool_shape].toLowerCase()})` : ''}${r.hours_since_last != null ? ` · ${r.hours_since_last}h` : ''}${r.symptoms?.length ? ` · ${r.symptoms.map(s => SYMPTOM_LABELS[s]).join(', ')}` : ''}${r.cat_id === catId ? '' : ' · unknown cat'}`, table: 'litter_logs', row: r }))
    : tab === 'meds' ? rows.medLogs.map(r => ({ id: r.id, when: r.given_at, text: `${MED_STATUS_LABELS[r.status]} · ${r.med_name_snapshot}${r.dose_snapshot ? ` (${r.dose_snapshot})` : ''}`, table: 'medication_logs', row: r }))
    : rows.weights.map(r => ({ id: r.id, when: r.measured_at, text: `${r.weight_kg} kg`, table: 'weight_logs', row: r }))
  if (!items.length) return <Empty title="Nothing logged in the last 7 days" />
  return (
    <ul className="divide-y divide-line rounded-xl border border-line">
      {items.map(i => (
        <li key={i.id} className="flex items-center justify-between gap-2 px-4 py-3">
          <div className="min-w-0">
            <p className="text-sm text-muted num">{fmtTime(i.when, timezone)}</p>
            <p className="num truncate">{i.text}</p>
          </div>
          <div className="flex shrink-0 gap-1">
            <Button variant="ghost" className="px-3" onClick={() => onEdit(tab, i.row)}>Edit</Button>
            <Button variant="ghost" className="px-3" onClick={() => onDelete(i.table, i.id)}>Delete</Button>
          </div>
        </li>
      ))}
    </ul>
  )
}

function FormShell({ title, editing, error, busy, onSubmit, onCancel, children }: {
  title: string; editing: boolean; error: string | null; busy: boolean; onSubmit: () => void; onCancel: () => void; children: React.ReactNode
}) {
  return (
    <Card>
      <form className="space-y-4" onSubmit={e => { e.preventDefault(); onSubmit() }}>
        <h2 className="font-semibold">{editing ? `Edit ${title.toLowerCase()}` : title}</h2>
        {children}
        {error && <p role="alert" className="text-sm font-medium">⚠ Not saved: {error}</p>}
        <div className="flex gap-2">
          <Button type="submit" disabled={busy} className="flex-1">{busy ? 'Saving…' : editing ? 'Save changes' : 'Save'}</Button>
          {editing && <Button type="button" variant="secondary" onClick={onCancel}>Cancel</Button>}
        </div>
      </form>
    </Card>
  )
}

// ---------- Feeding + Food Library ----------
function foodSubtitle(f: Food) {
  return [f.brand, labelSummary(f)].filter(Boolean).join(' · ')
}

function FeedingForm({ row, onDone }: { row?: FeedingLog; onDone: () => void }) {
  const { cat } = useSession()
  const foods = useLoad(async () => {
    const [{ data, error }, { data: recent }] = await Promise.all([
      supabase.from('foods').select('*').order('name'),
      supabase.from('feeding_logs').select('food_id,occurred_at').not('food_id', 'is', null).order('occurred_at', { ascending: false }).order('created_at', { ascending: false }).limit(50),
    ])
    if (error) throw new Error(error.message)
    const order = new Map<string, number>()   // most recently used first, then alphabetical
    ;(recent ?? []).forEach((r, i) => { if (r.food_id && !order.has(r.food_id)) order.set(r.food_id, i) })
    return (data as Food[]).sort((x, y) => (order.get(x.id) ?? 999) - (order.get(y.id) ?? 999) || x.name.localeCompare(y.name))
  }, [])
  const [when, setWhen] = useState(row ? toLocalInput(row.occurred_at) : toInputValue())
  const [kcal, setKcal] = useState(row ? String(row.kcal) : '')
  const [kcalTouched, setKcalTouched] = useState(!!row)
  const [food, setFood] = useState<Food | null>(null)
  const [foodName, setFoodName] = useState(row?.food_name_snapshot ?? '')
  const [unit, setUnit] = useState<AmountUnit | null>(null)
  const [amount, setAmount] = useState(row?.amount != null ? String(row.amount) : '')
  const [query, setQuery] = useState('')
  const [foodForm, setFoodForm] = useState<Food | 'new' | null>(null)
  const [notes, setNotes] = useState(row?.notes ?? '')
  const [err, setErr] = useState<string | undefined>()
  const { busy, error, submit } = useSubmit()

  const list = useMemo(() => {
    const q = query.trim().toLowerCase()
    const all = foods.data ?? []
    return q ? all.filter(f => `${f.name} ${f.brand ?? ''}`.toLowerCase().includes(q)) : all
  }, [query, foods.data])
  const units = food ? availableUnits(food) : []

  const recalc = (f: Food | null, u: AmountUnit | null, amt: string) => {
    if (!f || !u) return
    const k = kcalFor(parseNumber(amt), u, f)
    if (!Number.isNaN(k)) { setKcal(String(k)); setKcalTouched(false) }
  }
  const pick = (f: Food) => {
    const u = availableUnits(f)[0] ?? null
    if (kcalTouched && kcal && u && !confirm(`Replace your ${kcal} kcal with a value calculated from ${f.name}?`)) {
      setFood(f); setFoodName(f.name); setUnit(u); setQuery(''); return
    }
    setFood(f); setFoodName(f.name); setQuery(''); setUnit(u)
    const start = u && u !== 'g' ? '1' : ''
    setAmount(start)
    if (start) recalc(f, u, start); else { setKcal(''); setKcalTouched(false) }
  }
  const changeAmount = (v: string) => { setAmount(v); if (!kcalTouched) recalc(food, unit, v) }
  const changeUnit = (u: AmountUnit) => { setUnit(u); const start = u === 'g' ? '' : '1'; setAmount(start); setKcalTouched(false); if (start) recalc(food, u, start); else setKcal('') }

  const save = async () => {
    const n = parseNumber(kcal)
    if (Number.isNaN(n)) { setErr('Enter the kcal actually eaten (more than 0).'); return }
    setErr(undefined)
    const a = parseNumber(amount)
    const keepOld = !food && !!foodName   // editing an old entry without re-picking the food
    const body = {
      cat_id: cat!.id, occurred_at: fromInput(when), kcal: n, notes: notes || null,
      food_id: food?.id ?? (keepOld ? row?.food_id ?? null : null), food_name_snapshot: foodName || null,
      amount: food && unit && !Number.isNaN(a) ? a : keepOld ? row?.amount ?? null : null,
      amount_unit: food && unit && !Number.isNaN(a) ? unit : keepOld ? row?.amount_unit ?? null : null,
    }
    const ok = await submit(async () => row ? supabase.from('feeding_logs').update(body).eq('id', row.id) : supabase.from('feeding_logs').insert(body))
    if (ok) onDone()
  }

  if (foodForm) return (
    <Card><FoodForm row={foodForm === 'new' ? undefined : foodForm} initialName={query.trim()}
      onCancel={() => setFoodForm(null)}
      onSaved={f => { setFoodForm(null); foods.reload(); pick(f) }} /></Card>
  )

  const warn = food ? labelWarnings(food) : []
  return (
    <FormShell title="Log food" editing={!!row} error={error} busy={busy} onSubmit={save} onCancel={onDone}>
      <div className="space-y-2">
        <p className="text-sm font-medium">Food <span className="font-normal text-muted">(optional)</span></p>
        {foodName ? (
          <div className="space-y-2">
            <div className="flex items-center justify-between gap-2 rounded-xl border border-ink px-3 py-2.5">
              <div className="min-w-0"><p className="truncate font-medium">{foodName}</p>{food && <p className="truncate text-sm text-muted num">{foodSubtitle(food) || 'No label calories saved'}</p>}</div>
              <div className="flex shrink-0 gap-3 text-sm">
                {food && <button type="button" className="underline" onClick={() => setFoodForm(food)}>edit food</button>}
                <button type="button" className="underline" onClick={() => { setFood(null); setFoodName(''); setAmount(''); setUnit(null) }}>change</button>
              </div>
            </div>
            {warn.length > 0 && <p role="alert" className="rounded-xl border border-ink p-3 text-sm">⚠ {warn[0]} <button type="button" className="underline" onClick={() => setFoodForm(food)}>Fix the label numbers</button></p>}
          </div>
        ) : (
          <>
            {(foods.data?.length ?? 0) > 5 && <input aria-label="Search foods" className={inputCls} placeholder="Search your foods" value={query} onChange={e => setQuery(e.target.value)} autoComplete="off" />}
            {foods.loading && !foods.data ? <p className="text-sm text-muted">Loading foods…</p> : (
              <ul className="max-h-72 divide-y divide-line overflow-y-auto rounded-xl border border-line" aria-label="Your foods">
                {list.map(f => (
                  <li key={f.id}><button type="button" onClick={() => pick(f)} className="flex min-h-12 w-full items-center justify-between gap-2 px-3 py-2 text-left hover:bg-soft">
                    <span className="min-w-0"><span className="block truncate">{f.name}{labelWarnings(f).length > 0 && <span className="text-sm"> ⚠ check label</span>}</span>
                      {foodSubtitle(f) && <span className="block truncate text-sm text-muted num">{foodSubtitle(f)}</span>}</span>
                    <span aria-hidden className="text-muted">›</span>
                  </button></li>
                ))}
                {list.length === 0 && <li className="px-3 py-3 text-sm text-muted">{query ? 'No match.' : 'No saved foods yet.'}</li>}
                <li><button type="button" onClick={() => setFoodForm('new')} className="flex min-h-12 w-full items-center px-3 text-left font-medium hover:bg-soft">+ Add a food{query ? ` “${query.trim()}”` : ''}</button></li>
              </ul>
            )}
            <p className="text-sm text-muted">Or skip this and just enter kcal below.</p>
          </>
        )}
      </div>

      {food && unit && (
        <div className="space-y-2">
          {units.length > 1 && <Segmented label="Measure in" value={unit} onChange={changeUnit}
            options={units.map(u => ({ value: u, label: u === 'g' ? 'Grams' : UNIT_WORD[u][1][0].toUpperCase() + UNIT_WORD[u][1].slice(1) }))} />}
          <Field label={`How much was eaten (${UNIT_WORD[unit][1]})`}>
            {id => (
              <div className="space-y-2">
                <input id={id} inputMode="decimal" className={inputCls} value={amount} onChange={e => changeAmount(e.target.value)} placeholder={unit === 'g' ? 'e.g. 30' : 'e.g. 0.5'} />
                {unit !== 'g' && <div className="flex gap-2">{['0.25', '0.5', '0.75', '1'].map(v => (
                  <button type="button" key={v} onClick={() => changeAmount(v)} aria-pressed={amount === v}
                    className={`min-h-10 flex-1 rounded-full border text-sm num ${amount === v ? 'border-ink bg-ink text-white' : 'border-line'}`}>{fmtAmount(Number(v), unit).split(' ')[0]}</button>
                ))}</div>}
              </div>
            )}
          </Field>
        </div>
      )}
      <Field label="kcal actually eaten" error={err}
        hint={food && unit && !kcalTouched && kcal && !Number.isNaN(parseNumber(amount)) ? `Calculated: ${fmtAmount(parseNumber(amount), unit)} at ${unitFigure(food, unit)}. You can change it.` : undefined}>
        {id => <input id={id} inputMode="decimal" className={inputCls} value={kcal} onChange={e => { setKcal(e.target.value); setKcalTouched(true) }} placeholder="e.g. 42.5" />}
      </Field>
      <Field label="When">{id => <input id={id} type="datetime-local" className={inputCls} value={when} onChange={e => setWhen(e.target.value)} />}</Field>
      <Field label="Notes (optional)">{id => <input id={id} className={inputCls} value={notes} onChange={e => setNotes(e.target.value)} />}</Field>
    </FormShell>
  )
}

function unitFigure(f: Food, u: AmountUnit) {
  const v = u === 'cup' ? f.kcal_per_cup : u === 'g' ? f.kcal_per_kg : f.kcal_per_unit
  return `${Number(v).toLocaleString()} ${perLabel(u)}`
}

/** Add or edit a food. Every calorie figure on the label is optional; fill in whichever ones you have. */
function FoodForm({ row, initialName, onSaved, onCancel }: { row?: Food; initialName: string; onSaved: (f: Food) => void; onCancel: () => void }) {
  const str = (v: number | null | undefined) => (v ? Number(v).toLocaleString() : '')
  const [name, setName] = useState(row?.name ?? initialName)
  const [brand, setBrand] = useState(row?.brand ?? '')
  const [perKg, setPerKg] = useState(str(row?.kcal_per_kg))
  const [perCup, setPerCup] = useState(str(row?.kcal_per_cup))
  const [perUnit, setPerUnit] = useState(str(row?.kcal_per_unit))
  const [unitName, setUnitName] = useState<UnitName>(row?.unit_name ?? 'can')
  const [err, setErr] = useState<string | null>(null)
  const [ack, setAck] = useState('')    // the warning text the user already confirmed
  const { busy, error, submit } = useSubmit()

  const parsed = () => {
    const opt = (s: string) => (s.trim() ? parseNumber(s) : null)
    return { kcal_per_kg: opt(perKg), kcal_per_cup: opt(perCup), kcal_per_unit: opt(perUnit), unit_name: perUnit.trim() ? unitName : null }
  }
  const p = parsed()
  const bad = [p.kcal_per_kg, p.kcal_per_cup, p.kcal_per_unit].some(v => v !== null && Number.isNaN(v))
  const warnings = bad ? [] : labelWarnings(p)

  const save = async () => {
    if (!name.trim()) { setErr('Name is required.'); return }
    if (bad) { setErr('Calories must be numbers, e.g. 3,850 or 412.'); return }
    const key = warnings.join('|')
    if (warnings.length && ack !== key) { setAck(key); setErr('Please check the warning above. Tap Save again if the label really says this.'); return }
    setErr(null)
    let saved: Food | null = null
    const body = { name: name.trim(), brand: brand.trim() || null, ...p, kcal_basis: null, default_kcal: null, default_serving_label: null }
    const ok = await submit(async () => {
      const r = row ? await supabase.from('foods').update(body).eq('id', row.id).select().single()
                    : await supabase.from('foods').insert(body).select().single()
      saved = r.data as Food; return r
    })
    if (ok && saved) onSaved(saved)
  }

  return (
    <div className="space-y-4">
      <h2 className="font-semibold">{row ? `Edit ${row.name}` : 'New food'}</h2>
      <Field label="Name">{id => <input id={id} className={inputCls} placeholder="e.g. c/d Multicare Chicken" value={name} onChange={e => setName(e.target.value)} />}</Field>
      <Field label="Brand (optional)">{id => <input id={id} className={inputCls} value={brand} onChange={e => setBrand(e.target.value)} />}</Field>
      <div className="space-y-3 rounded-xl bg-soft p-3">
        <div>
          <p className="font-medium">Calories from the label</p>
          <p className="text-sm text-muted">Copy what's under “Calorie content” on the bag or can. Fill in every number it shows; leave the rest empty.</p>
        </div>
        <Field label="kcal per kg" hint="Dry food is usually 3,000–4,500. Wet food is usually 700–1,300.">
          {id => <input id={id} inputMode="decimal" className={inputCls} placeholder="e.g. 3,850" value={perKg} onChange={e => setPerKg(e.target.value)} />}
        </Field>
        <Field label="kcal per cup" hint="Dry food is usually 300–550.">
          {id => <input id={id} inputMode="decimal" className={inputCls} placeholder="e.g. 412" value={perCup} onChange={e => setPerCup(e.target.value)} />}
        </Field>
        <div className="space-y-1.5">
          <p className="text-sm font-medium">kcal per can, pouch or treat</p>
          <div className="flex gap-2">
            <input aria-label="kcal per can, pouch or treat" inputMode="decimal" className={inputCls + ' min-w-0 flex-1'} placeholder="e.g. 85" value={perUnit} onChange={e => setPerUnit(e.target.value)} />
            <select aria-label="Per what" className={inputCls + ' min-w-0 flex-1'} value={unitName} onChange={e => setUnitName(e.target.value as UnitName)}>
              {UNIT_NAMES.map(u => <option key={u} value={u}>per {UNIT_WORD[u][0]}</option>)}
            </select>
          </div>
        </div>
      </div>
      {warnings.length > 0 && <div role="alert" className="space-y-1 rounded-xl border-2 border-ink p-3 text-sm">{warnings.map(w => <p key={w}>⚠ {w}</p>)}</div>}
      {(err || error) && <p role="alert" className="text-sm font-medium">{err ?? error}</p>}
      <div className="flex gap-2">
        <Button onClick={save} disabled={busy} className="flex-1">{busy ? 'Saving…' : row ? 'Save food' : 'Add food'}</Button>
        <Button variant="secondary" onClick={onCancel}>Cancel</Button>
      </div>
    </div>
  )
}

// ---------- Water ----------
function WaterForm({ row, onDone }: { row?: HydrationLog; onDone: () => void }) {
  const { cat } = useSession()
  const [ml, setMl] = useState(row ? String(row.volume_ml) : '')
  const [method, setMethod] = useState<WaterMethod>(row?.method ?? 'estimated_drunk')
  const [unknown, setUnknown] = useState(row ? row.cat_id === null : false)
  const [when, setWhen] = useState(row ? toLocalInput(row.observed_at) : toInputValue())
  const [notes, setNotes] = useState(row?.notes ?? '')
  const [err, setErr] = useState<string>()
  const { busy, error, submit } = useSubmit()
  const save = async () => {
    const n = Number(ml)
    if (ml === '' || !(n >= 0)) { setErr('Enter mL (0 or more).'); return }
    setErr(undefined)
    const body = { cat_id: unknown ? null : cat!.id, volume_ml: n, method, observed_at: fromInput(when), notes: notes || null }
    if (await submit(async () => row ? supabase.from('hydration_logs').update(body).eq('id', row.id) : supabase.from('hydration_logs').insert(body))) onDone()
  }
  return (
    <FormShell title="Log water" editing={!!row} error={error} busy={busy} onSubmit={save} onCancel={onDone}>
      <Field label="Water (mL)" error={err} hint="Only what you measured or estimated. Spills and evaporation make this approximate.">
        {id => <input id={id} inputMode="decimal" className={inputCls} value={ml} onChange={e => setMl(e.target.value)} />}
      </Field>
      <Segmented label="Water method" value={method} onChange={setMethod}
        options={[{ value: 'estimated_drunk', label: 'Estimated drunk' }, { value: 'bowl_difference', label: 'Bowl before − after' }]} />
      <label className="flex min-h-11 items-center gap-3"><input type="checkbox" className="size-5 accent-black" checked={unknown} onChange={e => setUnknown(e.target.checked)} /> Shared bowl, can't tell which cat</label>
      <Field label="When">{id => <input id={id} type="datetime-local" className={inputCls} value={when} onChange={e => setWhen(e.target.value)} />}</Field>
      <Field label="Notes (optional)">{id => <input id={id} className={inputCls} value={notes} onChange={e => setNotes(e.target.value)} />}</Field>
    </FormShell>
  )
}

// ---------- Litter ----------
const SHAPES: StoolShape[] = ['hard_pellets', 'formed', 'soft', 'watery', 'mixed', 'unknown']
const SYMPTOMS = Object.keys(SYMPTOM_LABELS) as Symptom[]

function LitterForm({ row, onDone }: { row?: LitterLog; onDone: () => void }) {
  const { cat } = useSession()
  const [urine, setUrine] = useState<number | null>(row?.urine_count ?? null)
  const [stool, setStool] = useState<number | null>(row?.stool_count ?? null)
  const [shape, setShape] = useState<StoolShape | null>(row?.stool_shape ?? null)
  const [symptoms, setSymptoms] = useState<Symptom[]>(row?.symptoms ?? [])
  const [hours, setHours] = useState(row?.hours_since_last != null ? String(row.hours_since_last) : '')
  const [unknown, setUnknown] = useState(row ? row.cat_id === null : false)
  const [when, setWhen] = useState(row ? toLocalInput(row.cleaned_at) : toInputValue())
  const [notes, setNotes] = useState(row?.notes ?? '')
  const [err, setErr] = useState<string | null>(null)
  const { busy, error, submit } = useSubmit()
  const toggle = (s: Symptom) => setSymptoms(p => p.includes(s) ? p.filter(x => x !== s) : [...p, s])
  const save = async () => {
    if (urine == null && stool == null && symptoms.length === 0) { setErr('Add at least a count or a symptom. Use 0 if you checked and saw none.'); return }
    setErr(null)
    const body = { cat_id: unknown ? null : cat!.id, urine_count: urine, stool_count: stool, stool_shape: shape, symptoms, hours_since_last: hours ? Number(hours) : null, cleaned_at: fromInput(when), notes: notes || null }
    if (await submit(async () => row ? supabase.from('litter_logs').update(body).eq('id', row.id) : supabase.from('litter_logs').insert(body))) onDone()
  }
  return (
    <FormShell title="Litter check" editing={!!row} error={err ?? error} busy={busy} onSubmit={save} onCancel={onDone}>
      {/* Shown the moment a red-flag symptom is ticked, before saving and without any AI. */}
      <AnimatePresence>{isUrgent(symptoms) && <motion.div className="overflow-hidden" initial={{ opacity: 0, height: 0 }} animate={{ opacity: 1, height: "auto" }} exit={{ opacity: 0, height: 0 }}><EmergencyNotice /></motion.div>}</AnimatePresence>
      <div className="flex items-center justify-between"><span className="text-sm font-medium">Urine clumps</span><Stepper label="urine clumps" value={urine} onChange={setUrine} /></div>
      <p className="-mt-2 text-sm text-muted">What you scooped this time, not how many times they peed.</p>
      <div className="flex items-center justify-between"><span className="text-sm font-medium">Stools</span><Stepper label="stools" value={stool} onChange={setStool} /></div>
      <div>
        <p className="mb-2 text-sm font-medium">Stool shape</p>
        <div className="flex flex-wrap gap-2">{SHAPES.map(s => (
          <button type="button" key={s} aria-pressed={shape === s} onClick={() => setShape(shape === s ? null : s)}
            className={`min-h-10 rounded-full border px-3 text-sm ${shape === s ? 'border-ink bg-ink text-white' : 'border-line'}`}>{SHAPE_LABELS[s]}</button>
        ))}</div>
      </div>
      <div>
        <p className="mb-2 text-sm font-medium">Anything unusual?</p>
        <div className="flex flex-wrap gap-2">{SYMPTOMS.map(s => (
          <button type="button" key={s} aria-pressed={symptoms.includes(s)} onClick={() => toggle(s)}
            className={`min-h-10 rounded-full border px-3 text-sm ${symptoms.includes(s) ? 'border-ink bg-ink text-white' : 'border-line'}`}>{SYMPTOM_LABELS[s]}</button>
        ))}</div>
      </div>
      <Field label="Hours since last cleaning (optional)">{id => <input id={id} inputMode="decimal" className={inputCls} value={hours} onChange={e => setHours(e.target.value)} />}</Field>
      <label className="flex min-h-11 items-center gap-3"><input type="checkbox" className="size-5 accent-black" checked={unknown} onChange={e => setUnknown(e.target.checked)} /> Shared box, can't tell which cat</label>
      <Field label="When">{id => <input id={id} type="datetime-local" className={inputCls} value={when} onChange={e => setWhen(e.target.value)} />}</Field>
      <Field label="Notes (optional)">{id => <input id={id} className={inputCls} value={notes} onChange={e => setNotes(e.target.value)} />}</Field>
    </FormShell>
  )
}

// ---------- Weight ----------
function WeightForm({ row, onDone }: { row?: WeightLog; onDone: () => void }) {
  const { cat } = useSession()
  const [kg, setKg] = useState(row ? String(row.weight_kg) : '')
  const [when, setWhen] = useState(row ? toLocalInput(row.measured_at) : toInputValue())
  const [err, setErr] = useState<string>()
  const { busy, error, submit } = useSubmit()
  const save = async () => {
    const n = Number(kg)
    if (!(n > 0)) { setErr('Enter weight in kg.'); return }
    setErr(undefined)
    const body = { cat_id: cat!.id, weight_kg: n, measured_at: fromInput(when) }
    if (await submit(async () => row ? supabase.from('weight_logs').update(body).eq('id', row.id) : supabase.from('weight_logs').insert(body))) onDone()
  }
  return (
    <FormShell title="Log weight" editing={!!row} error={error} busy={busy} onSubmit={save} onCancel={onDone}>
      <Field label="Weight (kg)" error={err}>{id => <input id={id} inputMode="decimal" className={inputCls} value={kg} onChange={e => setKg(e.target.value)} />}</Field>
      <Field label="When">{id => <input id={id} type="datetime-local" className={inputCls} value={when} onChange={e => setWhen(e.target.value)} />}</Field>
    </FormShell>
  )
}

// ---------- Medications ----------
const STATUSES: MedStatus[] = ['given', 'partial', 'missed', 'refused', 'vomited']

function MedsForm({ row, onDone }: { row?: MedicationLog; onDone: () => void }) {
  const { cat } = useSession()
  const meds = useLoad(async () => {
    const { data, error } = await supabase.from('medications').select('*').eq('cat_id', cat!.id).is('archived_at', null).order('name')
    if (error) throw new Error(error.message); return data as Medication[]
  }, [cat?.id])
  const [med, setMed] = useState<Medication | null>(null)
  const [status, setStatus] = useState<MedStatus>(row?.status ?? 'given')
  const [when, setWhen] = useState(row ? toLocalInput(row.given_at) : toInputValue())
  const [notes, setNotes] = useState(row?.notes ?? '')
  const [medForm, setMedForm] = useState<Medication | 'new' | null>(null)
  const [err, setErr] = useState<string>()
  const { busy, error, submit } = useSubmit()

  const today = new Date().toISOString().slice(0, 10)
  const save = async () => {
    if (!med && !row) { setErr('Pick a medication first.'); return }
    setErr(undefined)
    const body = {
      cat_id: cat!.id, status, given_at: fromInput(when), notes: notes || null,
      medication_id: med?.id ?? row?.medication_id ?? null,
      med_name_snapshot: med?.name ?? row!.med_name_snapshot,
      dose_snapshot: med ? med.dose_as_prescribed : row?.dose_snapshot ?? null,
    }
    if (await submit(async () => row ? supabase.from('medication_logs').update(body).eq('id', row.id) : supabase.from('medication_logs').insert(body))) onDone()
  }

  if (medForm) return <Card><MedForm row={medForm === 'new' ? undefined : medForm} onCancel={() => setMedForm(null)}
    onSaved={m => { setMedForm(null); meds.reload(); setMed(m && !m.archived_at ? m : null) }} /></Card>

  const name = med?.name ?? row?.med_name_snapshot
  return (
    <FormShell title="Log a dose" editing={!!row} error={error} busy={busy} onSubmit={save} onCancel={onDone}>
      <div className="space-y-2">
        <p className="text-sm font-medium">Medication</p>
        {name ? (
          <div className="flex items-center justify-between gap-2 rounded-xl border border-ink px-3 py-2.5">
            <div className="min-w-0"><p className="truncate font-medium">{name}</p>
              <p className="truncate text-sm text-muted">{(med?.dose_as_prescribed ?? row?.dose_snapshot) || 'No dose saved'}{med?.how_often ? ` · ${med.how_often}` : ''}</p></div>
            <div className="flex shrink-0 gap-3 text-sm">
              {med && <button type="button" className="underline" onClick={() => setMedForm(med)}>edit</button>}
              {!row && <button type="button" className="underline" onClick={() => setMed(null)}>change</button>}
            </div>
          </div>
        ) : meds.loading && !meds.data ? <p className="text-sm text-muted">Loading…</p> : (
          <ul className="divide-y divide-line rounded-xl border border-line" aria-label="Medications">
            {meds.data?.map(m => {
              const ended = m.end_date && m.end_date < today
              return (
                <li key={m.id}><button type="button" onClick={() => setMed(m)} className="flex min-h-12 w-full items-center justify-between gap-2 px-3 py-2 text-left hover:bg-soft">
                  <span className="min-w-0"><span className="block truncate">{m.name}{ended && <span className="text-sm text-muted"> · course ended {m.end_date}</span>}</span>
                    <span className="block truncate text-sm text-muted">{m.dose_as_prescribed || 'No dose saved'}{m.how_often ? ` · ${m.how_often}` : ''}</span></span>
                  <span aria-hidden className="text-muted">›</span>
                </button></li>
              )
            })}
            {meds.data?.length === 0 && <li className="px-3 py-3 text-sm text-muted">No medications saved for this cat yet.</li>}
            <li><button type="button" onClick={() => setMedForm('new')} className="flex min-h-12 w-full items-center px-3 text-left font-medium hover:bg-soft">+ Add a medication</button></li>
          </ul>
        )}
        {err && <p role="alert" className="text-sm font-medium">⚠ {err}</p>}
      </div>
      {name && <>
        <div>
          <p className="mb-2 text-sm font-medium">What happened?</p>
          <div className="flex flex-wrap gap-2">{STATUSES.map(s => (
            <button type="button" key={s} aria-pressed={status === s} onClick={() => setStatus(s)}
              className={`min-h-10 rounded-full border px-3 text-sm ${status === s ? 'border-ink bg-ink text-white' : 'border-line'}`}>{MED_STATUS_LABELS[s]}</button>
          ))}</div>
        </div>
        <Field label="When">{id => <input id={id} type="datetime-local" className={inputCls} value={when} onChange={e => setWhen(e.target.value)} />}</Field>
        <Field label="Notes (optional)" hint="e.g. hid it in a treat, gave it 2 hours late">{id => <input id={id} className={inputCls} value={notes} onChange={e => setNotes(e.target.value)} />}</Field>
        <p className="text-sm text-muted">This only records what happened. Ask your vet before changing a dose or schedule.</p>
      </>}
    </FormShell>
  )
}

function MedForm({ row, onSaved, onCancel }: { row?: Medication; onSaved: (m: Medication | null) => void; onCancel: () => void }) {
  const { cat } = useSession()
  const [f, setF] = useState({
    name: row?.name ?? '', dose_as_prescribed: row?.dose_as_prescribed ?? '', how_often: row?.how_often ?? '',
    start_date: row?.start_date ?? '', end_date: row?.end_date ?? '', notes: row?.notes ?? '',
  })
  const set = (k: keyof typeof f) => (e: React.ChangeEvent<HTMLInputElement>) => setF({ ...f, [k]: e.target.value })
  const [err, setErr] = useState<string | null>(null)
  const { busy, error, submit } = useSubmit()
  const save = async () => {
    if (!f.name.trim()) { setErr('Name is required.'); return }
    if (f.start_date && f.end_date && f.end_date < f.start_date) { setErr('End date is before the start date.'); return }
    setErr(null)
    const body = { cat_id: cat!.id, ...Object.fromEntries(Object.entries(f).map(([k, v]) => [k, v.trim() === '' ? null : v.trim()])) }
    let saved: Medication | null = null
    const ok = await submit(async () => {
      const r = row ? await supabase.from('medications').update(body).eq('id', row.id).select().single()
                    : await supabase.from('medications').insert(body).select().single()
      saved = r.data as Medication; return r
    })
    if (ok) onSaved(saved)
  }
  const remove = async () => {
    if (row && confirm(`Remove ${row.name} from the list? Doses you already logged are kept.`) &&
        await submit(async () => supabase.from('medications').update({ archived_at: new Date().toISOString() }).eq('id', row.id))) onSaved(null)
  }
  return (
    <form className="space-y-4" onSubmit={e => { e.preventDefault(); save() }}>
      <h2 className="font-semibold">{row ? `Edit ${row.name}` : 'New medication'}</h2>
      <Field label="Name">{id => <input id={id} className={inputCls} placeholder="e.g. Gabapentin" value={f.name} onChange={set('name')} />}</Field>
      <Field label="Dose, exactly as prescribed" hint="Copy it from the label or the vet's instructions, e.g. “50 mg (1 capsule) by mouth”.">
        {id => <input id={id} className={inputCls} value={f.dose_as_prescribed} onChange={set('dose_as_prescribed')} />}
      </Field>
      <Field label="How often (optional)">{id => <input id={id} className={inputCls} placeholder="e.g. twice a day with food" value={f.how_often} onChange={set('how_often')} />}</Field>
      <div className="grid grid-cols-2 gap-3">
        <Field label="Start (optional)">{id => <input id={id} type="date" className={inputCls} value={f.start_date} onChange={set('start_date')} />}</Field>
        <Field label="End (optional)">{id => <input id={id} type="date" className={inputCls} value={f.end_date} onChange={set('end_date')} />}</Field>
      </div>
      <Field label="Notes (optional)">{id => <input id={id} className={inputCls} value={f.notes} onChange={set('notes')} />}</Field>
      {(err || error) && <p role="alert" className="text-sm font-medium">⚠ {err ?? error}</p>}
      <div className="flex gap-2">
        <Button type="submit" disabled={busy} className="flex-1">{busy ? 'Saving…' : row ? 'Save' : 'Add medication'}</Button>
        <Button variant="secondary" onClick={onCancel}>Cancel</Button>
        {row && <Button variant="danger" onClick={remove}>Remove</Button>}
      </div>
    </form>
  )
}
