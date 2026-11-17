import { describe, expect, it } from 'vitest'
import { computeMetrics, isUrgent, pctChange } from './metrics'
import { lastSevenDays, localMidnightUtc } from './time'
import type { Cat } from './types'

const cat: Cat = {
  id: 'c1', owner_id: 'u1', name: 'Mochi', birth_date: null, estimated_age_months: null,
  sex: 'unknown', neutered: null, daily_kcal_target: 200, is_demo: false, archived_at: null,
}
const days = ['2026-11-09', '2026-11-10', '2026-11-11', '2026-11-12', '2026-11-13', '2026-11-14', '2026-11-15']
const base = { cat, days, tz: 'America/Chicago', feedings: [], hydration: [], litter: [], weights: [], visits: [] }
const f = (at: string, kcal: number) => ({ id: at + kcal, cat_id: 'c1', occurred_at: at, kcal, food_id: null, food_name_snapshot: null, notes: null })

describe('food (F01)', () => {
  it('sums actual kcal per local day: 42.5 + 20 = 62.5', () => {
    const m = computeMetrics({ ...base, feedings: [f('2026-11-10T14:00:00Z', 42.5), f('2026-11-10T20:00:00Z', 20)] })
    expect(m.food.perDay).toEqual([{ date: '2026-11-10', value: 62.5 }])
    expect(m.food.avgPerLoggedDay).toBe(62.5)
  })
  it('uses the cat time zone: 11pm Chicago on Nov 10 is Nov 10, not Nov 11 UTC', () => {
    const m = computeMetrics({ ...base, feedings: [f('2026-11-11T05:00:00Z', 50)] })
    expect(m.food.perDay[0].date).toBe('2026-11-10')
  })
  it('ignores other cats', () => {
    const m = computeMetrics({ ...base, feedings: [{ ...f('2026-11-10T14:00:00Z', 50), cat_id: 'other' }] })
    expect(m.food.daysLogged).toBe(0)
    expect(m.food.avgPerLoggedDay).toBeNull()
  })
})

describe('water (H01, H02)', () => {
  it('3 logged days out of 7: missing days are not 0', () => {
    const w = (d: string) => ({ id: d, cat_id: 'c1', observed_at: d + 'T18:00:00Z', volume_ml: 100, method: 'estimated_drunk' as const, notes: null })
    const m = computeMetrics({ ...base, hydration: [w('2026-11-09'), w('2026-11-11'), w('2026-11-13')] })
    expect(m.water.daysLogged).toBe(3)
    expect(m.water.estimated).toHaveLength(3)
  })
  it('unknown-cat water is not counted toward the cat', () => {
    const m = computeMetrics({ ...base, hydration: [{ id: 'x', cat_id: null, observed_at: '2026-11-10T18:00:00Z', volume_ml: 100, method: 'bowl_difference', notes: null }] })
    expect(m.water.daysLogged).toBe(0)
  })
})

describe('litter (L01, L02, S01)', () => {
  const l = (o: object) => ({ id: Math.random().toString(), cat_id: 'c1', cleaned_at: '2026-11-12T15:00:00Z', hours_since_last: 48, urine_count: 6, stool_count: 1, stool_shape: 'formed' as const, symptoms: [], notes: null, ...o })
  it('keeps clump count with its interval, never converts to urinations', () => {
    const m = computeMetrics({ ...base, litter: [l({})] })
    expect(m.litter.cleanings[0]).toMatchObject({ urine: 6, hoursSinceLast: 48 })
  })
  it('keeps null as not logged', () => {
    const m = computeMetrics({ ...base, litter: [l({ stool_count: null, stool_shape: null })] })
    expect(m.litter.cleanings[0].stool).toBeNull()
  })
  it('unknown-cat cleanings are counted separately', () => {
    const m = computeMetrics({ ...base, litter: [l({ cat_id: null })] })
    expect(m.litter.cleanings).toHaveLength(0)
    expect(m.litter.unknownCatCleanings).toBe(1)
  })
  it('straining triggers the urgent flag, even from an unknown-cat cleaning', () => {
    expect(computeMetrics({ ...base, litter: [l({ cat_id: null, symptoms: ['straining'] })] }).urgent).toBe(true)
    expect(isUrgent(['vomiting'])).toBe(false)
    expect(isUrgent(['no_or_drops_urine'])).toBe(true)
  })
})

describe('time windows (R03)', () => {
  it('local midnight is DST-correct', () => {
    expect(localMidnightUtc('2026-11-01', 'America/Chicago').toISOString()).toBe('2026-11-01T05:00:00.000Z') // CDT
    expect(localMidnightUtc('2026-11-02', 'America/Chicago').toISOString()).toBe('2026-11-02T06:00:00.000Z') // CST
  })
  it('last seven days ends at today local midnight', () => {
    const w = lastSevenDays(new Date('2026-11-16T15:00:00Z'))
    expect(w.days[0]).toBe('2026-11-09')
    expect(w.days[6]).toBe('2026-11-15')
    expect(w.end.toISOString()).toBe('2026-11-16T06:00:00.000Z')
  })
  it('no divide by zero', () => {
    expect(pctChange(10, 0)).toBeNull()
    expect(pctChange(110, 100)).toBe(10)
  })
})

describe('vet visits', () => {
  it('finds latest visit and an upcoming check-up within 30 days', () => {
    const v = (d: string, next: string | null) => ({ id: d, cat_id: 'c1', visit_date: d, reason: null, diagnosis_as_written: null, medications: null, next_checkup_date: next, notes: null })
    const m = computeMetrics({ ...base, visits: [v('2026-09-01', '2026-10-01'), v('2026-10-20', '2026-12-01')], today: '2026-11-16' })
    expect(m.latestVisit?.visit_date).toBe('2026-10-20')
    expect(m.upcomingCheckup).toBe('2026-12-01')
  })
})

describe('weekly window includes today (bug 3)', () => {
  it('ends at tomorrow local midnight, last day = today', async () => {
    const { weekEndingToday } = await import('./time')
    const w = weekEndingToday(new Date('2026-11-16T16:09:00Z'))   // 10:09 AM Chicago
    expect(w.days[6]).toBe('2026-11-16')
    expect(w.days[0]).toBe('2026-11-10')
    expect(w.end.toISOString()).toBe('2026-11-17T06:00:00.000Z')
    expect(new Date('2026-11-16T16:09:00Z') < w.end).toBe(true)
  })
})

describe('medications', () => {
  it('counts doses by status per medication, only this cat, only this week', () => {
    const d = (o: object) => ({ id: Math.random().toString(), cat_id: 'c1', medication_id: 'm1', given_at: '2026-11-12T14:00:00Z', status: 'given' as const, med_name_snapshot: 'Gabapentin', dose_snapshot: '50 mg by mouth', notes: null, ...o })
    const m = computeMetrics({ ...base, medLogs: [d({}), d({}), d({ status: 'missed' }), d({ cat_id: 'other' }), d({ given_at: '2026-10-01T14:00:00Z' })] })
    expect(m.meds).toEqual([{ name: 'Gabapentin', dose: '50 mg by mouth', counts: { given: 2, missed: 1, refused: 0, partial: 0, vomited: 0 } }])
  })
})
