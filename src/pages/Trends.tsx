import { motion, useReducedMotion } from 'motion/react'
import { useSession } from '../lib/session'
import { loadRows, useLoad } from '../lib/data'
import { computeMetrics } from '../lib/metrics'
import { fmtDay, weekEndingToday } from '../lib/time'
import type { DayValue } from '../lib/types'
import { Card, Empty, PageFade } from '../components/ui'

/** One bar per day. Missing days are drawn as an empty dashed slot, never as a 0 bar. */
function Bars({ days, values, unit, target }: { days: string[]; values: DayValue[]; unit: string; target?: number | null }) {
  const reduce = useReducedMotion()
  const max = Math.max(1, target ?? 0, ...values.map(v => v.value))
  return (
    <div>
      <div className="flex h-32 items-end gap-1.5" role="img" aria-label={`${unit} per day`}>
        {days.map(d => {
          const v = values.find(x => x.date === d)
          return (
            <div key={d} className="flex h-full flex-1 flex-col justify-end">
              {v ? <motion.div initial={reduce ? false : { height: 0 }} animate={{ height: `${(v.value / max) * 100}%` }} transition={{ duration: 0.4 }}
                    className="rounded-t-md bg-ink" title={`${v.value} ${unit}`} />
                 : <div className="h-full rounded-md border border-dashed border-line" title="Not logged" />}
            </div>
          )
        })}
      </div>
      <div className="mt-1 flex gap-1.5 text-[11px] text-muted">{days.map(d => <span key={d} className="flex-1 text-center">{fmtDay(d).split(',')[0]}</span>)}</div>
      <table className="sr-only"><tbody>{days.map(d => <tr key={d}><td>{d}</td><td>{values.find(x => x.date === d)?.value ?? 'not logged'}</td></tr>)}</tbody></table>
    </div>
  )
}

export default function Trends() {
  const { cat, timezone } = useSession()
  const w = weekEndingToday(new Date(), timezone)
  const { data, loading, error } = useLoad(() => loadRows(cat!.id, w.start, w.end), [cat?.id])
  if (loading && !data) return <PageFade><p className="text-muted">Loading…</p></PageFade>
  if (error) return <PageFade><p role="alert">Couldn't load: {error}</p></PageFade>
  const m = computeMetrics({ cat: cat!, days: w.days, tz: timezone, ...data! })
  const waterAll: DayValue[] = w.days.flatMap(d => {
    const vals = [...m.water.estimated, ...m.water.bowl].filter(v => v.date === d)
    return vals.length ? [{ date: d, value: vals.reduce((a, b) => a + b.value, 0) }] : []
  })
  return (
    <PageFade>
      <h1 className="text-xl font-semibold">Last 7 days</h1>
      <p className="text-sm text-muted">Dashed slots = not logged (not zero).</p>
      <Card>
        <div className="mb-3 flex items-baseline justify-between"><h2 className="font-semibold">Food (kcal)</h2><span className="text-sm text-muted num">{m.food.daysLogged}/7 days logged</span></div>
        <Bars days={w.days} values={m.food.perDay} unit="kcal" target={m.food.target} />
        {m.food.avgPerLoggedDay != null && <p className="mt-2 text-sm num">Average {m.food.avgPerLoggedDay} kcal per logged day{m.food.target ? ` · target ${m.food.target}` : ''}</p>}
      </Card>
      <Card>
        <div className="mb-3 flex items-baseline justify-between"><h2 className="font-semibold">Water logged (mL)</h2><span className="text-sm text-muted num">{m.water.daysLogged}/7 days</span></div>
        <Bars days={w.days} values={waterAll} unit="mL" />
        <p className="mt-2 text-sm text-muted">Logged water only. Wet food water isn't counted.</p>
      </Card>
      <Card>
        <h2 className="mb-2 font-semibold">Litter cleanings</h2>
        {m.litter.cleanings.length === 0 ? <Empty title="No cleanings logged for this cat" /> : (
          <ul className="divide-y divide-line text-sm num">
            {m.litter.cleanings.map(c => <li key={c.at} className="flex justify-between py-2"><span>{fmtDay(c.date)}{c.hoursSinceLast != null && <span className="text-muted"> · over {c.hoursSinceLast}h</span>}</span><span>{c.urine ?? '—'} clumps · {c.stool ?? '—'} stool</span></li>)}
          </ul>
        )}
        <p className="mt-2 text-sm text-muted">Clumps per cleaning, not urinations per day.{m.litter.unknownCatCleanings ? ` ${m.litter.unknownCatCleanings} unknown-cat cleaning(s) not shown.` : ''}</p>
      </Card>
      {(m.meds?.length ?? 0) > 0 && <Card>
        <h2 className="mb-2 font-semibold">Medications</h2>
        <ul className="divide-y divide-line text-sm num">{m.meds!.map(x => (
          <li key={x.name} className="py-2"><p className="font-medium">{x.name}{x.dose && <span className="font-normal text-muted"> · {x.dose}</span>}</p>
            <p className="text-muted">{x.counts.given} given{x.counts.partial ? ` · ${x.counts.partial} partly` : ''}{x.counts.missed ? ` · ${x.counts.missed} missed` : ''}{x.counts.refused ? ` · ${x.counts.refused} refused` : ''}{x.counts.vomited ? ` · ${x.counts.vomited} vomited after` : ''}</p></li>
        ))}</ul>
      </Card>}
      <Card>
        <h2 className="mb-2 font-semibold">Weight</h2>
        {m.weight.points.length === 0 ? <p className="text-muted">Not weighed this week.</p>
          : <ul className="text-sm num">{m.weight.points.map(p => <li key={p.date}>{fmtDay(p.date)}: {p.value} kg</li>)}</ul>}
      </Card>
    </PageFade>
  )
}
