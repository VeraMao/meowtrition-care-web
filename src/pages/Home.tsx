import { Link } from 'react-router-dom'
import { useSession } from '../lib/session'
import { loadRows, useLoad } from '../lib/data'
import { supabase } from '../lib/supabase'
import { isUrgent } from '../lib/metrics'
import { fmtTime, localDate, localMidnightUtc } from '../lib/time'
import { AnimatedNumber, Badge, Card, EmergencyNotice, PageFade } from '../components/ui'
import type { CareReport } from '../lib/types'
import { SHAPE_LABELS } from '../lib/types'

export default function Home() {
  const { cat, timezone } = useSession()
  const today = localDate(new Date(), timezone)
  const { data, loading, error } = useLoad(async () => {
    const start = new Date(Date.now() - 48 * 3600e3)
    const rows = await loadRows(cat!.id, start, new Date(Date.now() + 60e3))
    const { data: r } = await supabase.from('care_reports').select('*').eq('cat_id', cat!.id).order('created_at', { ascending: false }).limit(1)
    return { rows, report: (r?.[0] ?? null) as CareReport | null }
  }, [cat?.id])

  if (!cat) return null
  const sinceMidnight = localMidnightUtc(today, timezone).toISOString()
  const todayFeed = data?.rows.feedings.filter(f => f.occurred_at >= sinceMidnight) ?? []
  const kcal = todayFeed.reduce((a, f) => a + Number(f.kcal), 0)
  const todayWater = data?.rows.hydration.filter(h => h.observed_at >= sinceMidnight && h.cat_id === cat.id) ?? []
  const lastLitter = data?.rows.litter[0]
  const urgent = data?.rows.litter.some(l => isUrgent(l.symptoms ?? []))
  const target = cat.daily_kcal_target

  return (
    <PageFade>
      <h1 className="text-xl font-semibold">{cat.name} today {cat.is_demo && <Badge>Demo data</Badge>}</h1>
      {error && <p role="alert">Couldn't load: {error}</p>}
      {urgent && <EmergencyNotice />}

      <Card>
        <p className="text-sm text-muted">Food eaten today</p>
        {loading ? <p className="text-muted">Loading…</p> : todayFeed.length === 0 ? <p className="mt-1 text-lg">Not logged yet</p> : (
          <>
            <p className="mt-1 text-3xl font-semibold"><AnimatedNumber value={kcal} decimals={kcal % 1 ? 1 : 0} /> <span className="text-base font-normal text-muted">kcal</span></p>
            {target ? <>
              <div className="mt-3 h-2 rounded-full bg-soft" aria-hidden>
                <div className="h-2 rounded-full bg-ink transition-[width] duration-500" style={{ width: `${Math.min(100, (kcal / target) * 100)}%` }} />
              </div>
              <p className="mt-1 text-sm text-muted num">
                {kcal <= target ? `${(target - kcal).toFixed(0)} kcal left of ${target}` : `${(kcal - target).toFixed(0)} kcal over the ${target} target`}
              </p>
            </> : <p className="mt-1 text-sm text-muted">No daily target set.</p>}
          </>
        )}
      </Card>

      <div className="grid grid-cols-2 gap-4">
        <Card>
          <p className="text-sm text-muted">Water logged today</p>
          <p className="mt-1 text-lg num">{todayWater.length ? `${todayWater.reduce((a, w) => a + Number(w.volume_ml), 0)} mL` : 'Not logged'}</p>
        </Card>
        <Card>
          <p className="text-sm text-muted">Last litter check</p>
          {lastLitter ? <p className="mt-1 text-sm num">{fmtTime(lastLitter.cleaned_at, timezone)}<br />
            {lastLitter.urine_count ?? '—'} clumps · {lastLitter.stool_count ?? '—'} stool{lastLitter.stool_shape ? ` (${SHAPE_LABELS[lastLitter.stool_shape].toLowerCase()})` : ''}</p>
            : <p className="mt-1 text-lg">None in 48h</p>}
        </Card>
      </div>

      <div className="grid grid-cols-3 gap-2">
        <Link to="/log?tab=feeding" className="flex min-h-12 items-center justify-center rounded-xl bg-ink text-sm font-medium text-white">+ Food</Link>
        <Link to="/log?tab=water" className="flex min-h-12 items-center justify-center rounded-xl border border-line text-sm font-medium">+ Water</Link>
        <Link to="/log?tab=litter" className="flex min-h-12 items-center justify-center rounded-xl border border-line text-sm font-medium">+ Litter</Link>
      </div>

      <Card>
        <p className="text-sm text-muted">Latest weekly review</p>
        {data?.report ? (
          <Link to={`/health/report/${data.report.id}`} className="mt-1 flex items-center justify-between">
            <span>{localDate(data.report.period_start, timezone)} → week</span>
            <Badge>{data.report.status === 'approved' ? '✓ Approved' : data.report.status === 'stale' ? 'Out of date' : 'Needs review'}</Badge>
          </Link>
        ) : <p className="mt-1">No review yet. <Link to="/health" className="underline">Create one</Link></p>}
      </Card>
    </PageFade>
  )
}
