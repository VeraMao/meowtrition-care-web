// Deterministic statistics for the Care Review. The AI never computes numbers;
// it only writes about what this file returns. Shared by the browser and api/care-review.ts.
import type {
  Cat, DayValue, FeedingLog, HydrationLog, LitterLog, MedicationLog, MedStatus, Metrics, Symptom, VetVisit, WeightLog,
} from './types'
import { URGENT_SYMPTOMS } from './types'
import { addDays, localDate } from './time'

export function isUrgent(symptoms: Symptom[]): boolean {
  return symptoms.some(s => URGENT_SYMPTOMS.includes(s))
}

const round = (n: number, d = 1) => Math.round(n * 10 ** d) / 10 ** d

/** Sum values per local day, keeping only days that actually have records (missing ≠ 0). */
function sumByDay<T>(rows: T[], at: (r: T) => string, val: (r: T) => number, days: string[], tz: string): DayValue[] {
  const m = new Map<string, number>()
  for (const r of rows) {
    const d = localDate(at(r), tz)
    if (!days.includes(d)) continue
    m.set(d, (m.get(d) ?? 0) + Number(val(r)))
  }
  return days.filter(d => m.has(d)).map(d => ({ date: d, value: round(m.get(d)!, 2) }))
}

export interface MetricsInput {
  cat: Cat
  days: string[]
  tz: string
  feedings: FeedingLog[]
  hydration: HydrationLog[]
  litter: LitterLog[]
  weights: WeightLog[]
  visits: VetVisit[]
  medLogs?: MedicationLog[]
  today?: string
}

export function computeMetrics(i: MetricsInput): Metrics {
  const { cat, days, tz } = i
  const mine = <T extends { cat_id: string | null }>(rows: T[]) => rows.filter(r => r.cat_id === cat.id)

  const foodPerDay = sumByDay(mine(i.feedings), r => r.occurred_at, r => r.kcal, days, tz)
  const foodTotal = foodPerDay.reduce((a, b) => a + b.value, 0)

  const water = mine(i.hydration)
  const estimated = sumByDay(water.filter(w => w.method === 'estimated_drunk'), r => r.observed_at, r => r.volume_ml, days, tz)
  const bowl = sumByDay(water.filter(w => w.method === 'bowl_difference'), r => r.observed_at, r => r.volume_ml, days, tz)
  const waterDays = new Set([...estimated, ...bowl].map(d => d.date))

  const inWindow = (iso: string) => days.includes(localDate(iso, tz))
  const litterWindow = i.litter.filter(l => inWindow(l.cleaned_at))
  const cleanings = litterWindow
    .filter(l => l.cat_id === cat.id)
    .sort((a, b) => a.cleaned_at.localeCompare(b.cleaned_at))
    .map(l => ({
      date: localDate(l.cleaned_at, tz), at: l.cleaned_at,
      urine: l.urine_count, stool: l.stool_count, shape: l.stool_shape,
      hoursSinceLast: l.hours_since_last, symptoms: l.symptoms ?? [],
    }))
  const unknownCat = litterWindow.filter(l => l.cat_id === null)

  // Emergency rule covers this cat AND unknown-cat cleanings: in a shared box we can't rule this cat out.
  const urgent = [...cleanings.map(c => c.symptoms), ...unknownCat.map(l => l.symptoms ?? [])].some(isUrgent)

  const weightPoints = mine(i.weights)
    .filter(w => inWindow(w.measured_at))
    .sort((a, b) => a.measured_at.localeCompare(b.measured_at))
    .map(w => ({ date: localDate(w.measured_at, tz), value: Number(w.weight_kg) }))

  const visits = mine(i.visits).sort((a, b) => b.visit_date.localeCompare(a.visit_date))
  const today = i.today ?? addDays(days[days.length - 1], 1)
  const horizon = addDays(today, 30)
  const upcoming = visits
    .map(v => v.next_checkup_date)
    .filter((d): d is string => !!d && d >= today && d <= horizon)
    .sort()[0] ?? null

  // Medications: count each logged dose by status, grouped by medication (name as recorded at the time).
  const medMap = new Map<string, { name: string; dose: string | null; counts: Record<MedStatus, number> }>()
  for (const l of mine(i.medLogs ?? []).filter(l => inWindow(l.given_at)).sort((a, b) => a.given_at.localeCompare(b.given_at))) {
    const key = l.medication_id ?? `name:${l.med_name_snapshot}`
    const e = medMap.get(key) ?? { name: l.med_name_snapshot, dose: l.dose_snapshot, counts: { given: 0, missed: 0, refused: 0, partial: 0, vomited: 0 } }
    e.counts[l.status] += 1
    medMap.set(key, e)
  }

  return {
    timezone: tz,
    days,
    food: {
      perDay: foodPerDay,
      daysLogged: foodPerDay.length,
      avgPerLoggedDay: foodPerDay.length ? round(foodTotal / foodPerDay.length) : null,
      target: cat.daily_kcal_target,
    },
    water: { estimated, bowl, daysLogged: waterDays.size },
    litter: { cleanings, unknownCatCleanings: unknownCat.length },
    weight: { points: weightPoints },
    meds: [...medMap.values()],
    urgent,
    latestVisit: visits[0] ?? null,
    upcomingCheckup: upcoming,
  }
}

/** Relative change, or null when it can't be computed honestly (no baseline). */
export function pctChange(current: number, previous: number): number | null {
  if (!previous) return null
  return round(((current - previous) / previous) * 100)
}
