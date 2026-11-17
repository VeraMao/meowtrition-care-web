// Calories as printed on pet food labels, and the amount-eaten math.
// A food can carry several label figures (dry bags usually print both kcal/kg and kcal/cup).
// The feeding log always saves kcal; amount + unit are kept only as a helpful note.

export type UnitName = 'can' | 'pouch' | 'piece' | 'serving'
export type AmountUnit = 'cup' | 'g' | UnitName
export type KcalBasis = 'cup' | 'can' | 'pouch' | 'kg' | '100g' | 'piece' | 'serving'   // legacy column

export interface FoodKcal {
  kcal_per_kg: number | null
  kcal_per_cup: number | null
  kcal_per_unit: number | null
  unit_name: UnitName | null
}

export const UNIT_WORD: Record<AmountUnit, [string, string]> = {
  cup: ['cup', 'cups'], g: ['g', 'g'], can: ['can', 'cans'], pouch: ['pouch', 'pouches'],
  piece: ['treat', 'treats'], serving: ['serving', 'servings'],
}
export const UNIT_NAMES: UnitName[] = ['can', 'pouch', 'piece', 'serving']

/** Units you can log this food in, in the order shown. */
export function availableUnits(f: FoodKcal): AmountUnit[] {
  const u: AmountUnit[] = []
  if (f.kcal_per_cup) u.push('cup')
  if (f.kcal_per_kg) u.push('g')
  if (f.kcal_per_unit && f.unit_name) u.push(f.unit_name)
  return u
}

/** kcal eaten, rounded to 0.1. Returns NaN if the food has no figure for that unit. */
export function kcalFor(amount: number, unit: AmountUnit, f: FoodKcal): number {
  const per = unit === 'cup' ? f.kcal_per_cup : unit === 'g' ? (f.kcal_per_kg ? Number(f.kcal_per_kg) / 1000 : null)
    : f.unit_name === unit ? f.kcal_per_unit : null
  if (!per) return NaN
  return Math.round(amount * Number(per) * 10) / 10
}

export function perLabel(unit: AmountUnit): string {
  return unit === 'g' ? 'kcal/kg' : `kcal/${UNIT_WORD[unit][0]}`
}

export function labelSummary(f: FoodKcal): string {
  const parts: string[] = []
  if (f.kcal_per_kg) parts.push(`${Number(f.kcal_per_kg).toLocaleString()} kcal/kg`)
  if (f.kcal_per_cup) parts.push(`${Number(f.kcal_per_cup).toLocaleString()} kcal/cup`)
  if (f.kcal_per_unit && f.unit_name) parts.push(`${Number(f.kcal_per_unit).toLocaleString()} kcal/${UNIT_WORD[f.unit_name][0]}`)
  return parts.join(' · ')
}

/**
 * Sanity checks against typical cat food labels, to catch a number typed into the wrong box.
 * Typical: dry ≈ 3,000–4,500 kcal/kg and 300–550 kcal/cup; wet ≈ 700–1,300 kcal/kg, 70–200 kcal/can.
 */
export function labelWarnings(f: FoodKcal): string[] {
  const w: string[] = []
  const cup = f.kcal_per_cup ? Number(f.kcal_per_cup) : null
  const kg = f.kcal_per_kg ? Number(f.kcal_per_kg) : null
  const unit = f.kcal_per_unit ? Number(f.kcal_per_unit) : null
  if (cup != null && cup > 1000) w.push(`${cup.toLocaleString()} kcal per cup is far above normal (usually 300–550). This looks like a kcal per kg number.`)
  if (cup != null && cup < 100) w.push(`${cup} kcal per cup is unusually low (usually 300–550). Please double-check the label.`)
  if (kg != null && kg < 400) w.push(`${kg} kcal per kg is unusually low (usually 700–4,500). This might be a per cup or per can number.`)
  if (kg != null && kg > 6000) w.push(`${kg.toLocaleString()} kcal per kg is unusually high (usually 700–4,500). Please double-check the label.`)
  if (unit != null && unit > 1000) w.push(`${unit.toLocaleString()} kcal per ${f.unit_name} is very high. This might be a per kg number.`)
  if (cup != null && kg != null && (kg / cup < 5 || kg / cup > 20)) w.push('The kcal/kg and kcal/cup numbers don\'t look like they belong to the same food (a cup of dry food usually weighs 80–130 g).')
  return w
}

/** Parse label numbers like "3,850" or "412.5". Returns NaN when not a positive number. */
export function parseNumber(s: string): number {
  const n = Number(String(s).replace(/,/g, '').trim())
  return String(s).trim() !== '' && Number.isFinite(n) && n > 0 ? n : NaN
}

const FRACTIONS: Record<string, string> = { '0.25': '¼', '0.5': '½', '0.75': '¾', '0.333': '⅓', '0.667': '⅔' }
export function fmtAmount(amount: number, unit: AmountUnit): string {
  if (!Number.isFinite(amount)) return ''
  if (unit === 'g') return `${+amount.toFixed(1)} g`
  const whole = Math.floor(amount), frac = +(amount - whole).toFixed(3)
  const f = FRACTIONS[String(frac)]
  const num = f ? `${whole ? whole : ''}${f}` : String(+amount.toFixed(2))
  return `${num} ${UNIT_WORD[unit][amount > 1 ? 1 : 0]}`
}
