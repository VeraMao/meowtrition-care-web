// Mirrors supabase/001_schema.sql. Keep the two in sync.

export type Sex = 'male' | 'female' | 'unknown'
export type WaterMethod = 'estimated_drunk' | 'bowl_difference'
export type StoolShape = 'hard_pellets' | 'formed' | 'soft' | 'watery' | 'mixed' | 'unknown'
export type Symptom =
  | 'frequent_visits' | 'straining' | 'no_or_drops_urine' | 'pain'
  | 'visible_blood' | 'vomiting' | 'lethargy' | 'other'
export type ReportStatus = 'needs_review' | 'approved' | 'stale'

export interface Cat {
  id: string; owner_id: string; name: string
  birth_date: string | null; estimated_age_months: number | null
  sex: Sex; neutered: boolean | null; daily_kcal_target: number | null
  is_demo: boolean; archived_at: string | null
}
export interface Food {
  id: string; name: string; brand: string | null
  default_serving_label: string | null; default_kcal: number | null
  kcal_basis?: import('./food').KcalBasis | null   // legacy single-figure columns; use the kcal_per_* fields
  kcal_per_kg: number | null; kcal_per_cup: number | null
  kcal_per_unit: number | null; unit_name: import('./food').UnitName | null
  created_at?: string
}
export interface FeedingLog {
  id: string; cat_id: string; occurred_at: string; kcal: number
  food_id: string | null; food_name_snapshot: string | null; notes: string | null
  amount?: number | null; amount_unit?: import('./food').AmountUnit | null
}
export interface HydrationLog {
  id: string; cat_id: string | null; observed_at: string; volume_ml: number
  method: WaterMethod; notes: string | null
}
export interface LitterLog {
  id: string; cat_id: string | null; cleaned_at: string; hours_since_last: number | null
  urine_count: number | null; stool_count: number | null; stool_shape: StoolShape | null
  symptoms: Symptom[]; notes: string | null
}
export interface WeightLog { id: string; cat_id: string; measured_at: string; weight_kg: number }
export interface VetVisit {
  id: string; cat_id: string; visit_date: string; reason: string | null
  diagnosis_as_written: string | null; medications: string | null
  next_checkup_date: string | null; notes: string | null
}
export type MedStatus = 'given' | 'missed' | 'refused' | 'partial' | 'vomited'
export interface Medication {
  id: string; cat_id: string; name: string; dose_as_prescribed: string | null; how_often: string | null
  start_date: string | null; end_date: string | null; notes: string | null; archived_at: string | null
}
export interface MedicationLog {
  id: string; cat_id: string; medication_id: string | null; given_at: string; status: MedStatus
  med_name_snapshot: string; dose_snapshot: string | null; notes: string | null
}
export const MED_STATUS_LABELS: Record<MedStatus, string> = {
  given: 'Given', missed: 'Missed', refused: 'Refused / spat out', partial: 'Partly taken', vomited: 'Vomited after',
}

export interface CareReport {
  id: string; cat_id: string; period_start: string; period_end: string
  metrics: Metrics; summary: ReportSummary; status: ReportStatus
  approved_at: string | null; vet_draft_body: string | null; is_mock: boolean; created_at: string
}

// ----- report content -----
export interface DayValue { date: string; value: number }
export interface Metrics {
  timezone: string
  days: string[]                       // the 7 local dates in the window
  food: { perDay: DayValue[]; daysLogged: number; avgPerLoggedDay: number | null; target: number | null }
  water: { estimated: DayValue[]; bowl: DayValue[]; daysLogged: number }
  litter: {
    cleanings: {
      date: string; at: string; urine: number | null; stool: number | null
      shape: StoolShape | null; hoursSinceLast: number | null; symptoms: Symptom[]
    }[]
    unknownCatCleanings: number
  }
  weight: { points: DayValue[] }
  meds?: { name: string; dose: string | null; counts: Record<MedStatus, number> }[]
  urgent: boolean                      // fixed rule, no AI
  latestVisit: VetVisit | null
  upcomingCheckup: string | null
}
export interface ReportSummary {
  observations: { text: string; dates: string[] }[]
  questions_for_vet: string[]
  limitations: string[]
  vet_email: string
  is_mock: boolean          // true whenever the text came from the fixed template, not AI
  model: string | null
  /** ai = written by AI and passed validation; not_configured = no AI key; failed = AI was tried and rejected/errored */
  ai_status?: 'ai' | 'not_configured' | 'failed'
  ai_error?: string | null
}

export const SYMPTOM_LABELS: Record<Symptom, string> = {
  frequent_visits: 'Frequent visits',
  straining: 'Straining',
  no_or_drops_urine: 'No urine or only drops',
  pain: 'Pain',
  visible_blood: 'Visible blood',
  vomiting: 'Vomiting',
  lethargy: 'Lethargy',
  other: 'Other',
}
export const URGENT_SYMPTOMS: Symptom[] = ['no_or_drops_urine', 'straining', 'pain']
export const SHAPE_LABELS: Record<StoolShape, string> = {
  hard_pellets: 'Hard pellets', formed: 'Formed', soft: 'Soft',
  watery: 'Watery', mixed: 'Mixed', unknown: 'Unknown',
}
