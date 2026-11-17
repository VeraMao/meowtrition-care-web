export const DEFAULT_TZ = 'America/Chicago'

/** Local calendar date (YYYY-MM-DD) of an instant in a given IANA time zone. */
export function localDate(iso: string | Date, tz = DEFAULT_TZ): string {
  const d = typeof iso === 'string' ? new Date(iso) : iso
  return new Intl.DateTimeFormat('en-CA', { timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit' }).format(d)
}

/** Add days to a YYYY-MM-DD string (calendar math, no time zone). */
export function addDays(date: string, n: number): string {
  const d = new Date(date + 'T12:00:00Z')
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}

/** UTC instant of local midnight at the start of `date` in `tz`. DST-safe. */
export function localMidnightUtc(date: string, tz = DEFAULT_TZ): Date {
  // start from UTC midnight, then correct by the zone's offset at that moment (twice, for DST edges)
  let guess = new Date(date + 'T00:00:00Z')
  for (let i = 0; i < 2; i++) {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit',
    }).formatToParts(guess)
    const get = (t: string) => Number(parts.find(p => p.type === t)!.value)
    const asLocal = Date.UTC(get('year'), get('month') - 1, get('day'), get('hour'), get('minute'), get('second'))
    const target = Date.UTC(+date.slice(0, 4), +date.slice(5, 7) - 1, +date.slice(8, 10))
    guess = new Date(guess.getTime() + (target - asLocal))
  }
  return guess
}

/** The last 7 full local days ending yesterday: [start, end) as UTC instants plus the 7 dates. */
export function lastSevenDays(now = new Date(), tz = DEFAULT_TZ) {
  const today = localDate(now, tz)
  const first = addDays(today, -7)
  const days = Array.from({ length: 7 }, (_, i) => addDays(first, i))
  return { days, start: localMidnightUtc(first, tz), end: localMidnightUtc(today, tz) }
}

/** The 7 local days ending TODAY (today is partial): what the app's weekly review covers. */
export function weekEndingToday(now = new Date(), tz = DEFAULT_TZ) {
  return lastSevenDays(new Date(now.getTime() + 86400e3), tz)
}

/** Value for <input type="datetime-local"> in local browser time. */
export function toInputValue(d = new Date()): string {
  const pad = (n: number) => String(n).padStart(2, '0')
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`
}

export function fmtDay(date: string): string {
  return new Date(date + 'T12:00:00Z').toLocaleDateString('en-US', { weekday: 'short', month: 'short', day: 'numeric', timeZone: 'UTC' })
}
export function fmtTime(iso: string, tz = DEFAULT_TZ): string {
  return new Date(iso).toLocaleString('en-US', { timeZone: tz, month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}
