import { describe, expect, it } from 'vitest'
import { summarize } from './ai'
import { computeMetrics } from './metrics'
import { validateSummary } from './summary'
import type { Cat } from './types'

const cat: Cat = { id: 'c1', owner_id: 'u', name: 'Chestnut', birth_date: null, estimated_age_months: null, sex: 'female', neutered: true, daily_kcal_target: 200, is_demo: false, archived_at: null }
const days = ['2026-11-10', '2026-11-11', '2026-11-12', '2026-11-13', '2026-11-14', '2026-11-15', '2026-11-16']
const m = computeMetrics({ cat, days, tz: 'America/Chicago', hydration: [], litter: [], weights: [], visits: [],
  feedings: [{ id: 'f', cat_id: 'c1', occurred_at: '2026-11-16T17:35:00Z', kcal: 98.6, food_id: null, food_name_snapshot: 'C/D', notes: null }] })

const good = {
  observations: [{ text: 'Chestnut ate 98.6 kcal on Nov 16, 1 of 7 days logged.', dates: ['2026-11-16'] }],
  questions_for_vet: ['Is 98.6 kcal on Nov 16 enough to worry about?'],
  limitations: ['Only 1 day logged.'],
  vet_email: 'Hi Dr. X, Chestnut ate 98.6 kcal on Nov 16 (target 200 kcal).',
}
const reply = (body: unknown, status = 200) => (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch
const aiText = (obj: unknown) => reply({ content: [{ type: 'text', text: 'Here you go:\n' + JSON.stringify(obj) }] })

describe('AI states are never mixed up', () => {
  it('no key → template, ai_status not_configured', async () => {
    const s = await summarize(cat, m, {})
    expect(s.ai_status).toBe('not_configured'); expect(s.is_mock).toBe(true)
  })
  it('valid AI answer → ai_status ai, not labeled as template', async () => {
    const s = await summarize(cat, m, { apiKey: 'k', model: 'test-model', fetchImpl: aiText(good) })
    expect(s.ai_status).toBe('ai'); expect(s.is_mock).toBe(false); expect(s.model).toBe('test-model')
    expect(s.observations[0].text).toContain('98.6')
  })
  it('HTTP error → template, ai_status failed with reason', async () => {
    const s = await summarize(cat, m, { apiKey: 'k', fetchImpl: reply({ error: 'x' }, 500) })
    expect(s.ai_status).toBe('failed'); expect(s.ai_error).toBe('ai_http_500'); expect(s.is_mock).toBe(true)
    expect(s.limitations.join(' ')).toContain('template version')
  })
  it('network error → failed, never throws', async () => {
    const boom = (async () => { throw new TypeError('network down') }) as unknown as typeof fetch
    const s = await summarize(cat, m, { apiKey: 'k', fetchImpl: boom })
    expect(s.ai_status).toBe('failed'); expect(s.ai_error).toBe('network down')
  })
  it('AI invents a number → rejected', async () => {
    const bad = { ...good, observations: [{ text: 'Chestnut ate 250 kcal on Nov 16.', dates: ['2026-11-16'] }] }
    const s = await summarize(cat, m, { apiKey: 'k', fetchImpl: aiText(bad) })
    expect(s.ai_status).toBe('failed'); expect(s.ai_error).toBe('unsupported_number:250')
  })
  it('AI cites a date outside the window → rejected', async () => {
    const bad = { ...good, observations: [{ text: 'Ate well.', dates: ['2026-11-01'] }] }
    const s = await summarize(cat, m, { apiKey: 'k', fetchImpl: aiText(bad) })
    expect(s.ai_status).toBe('failed'); expect(s.ai_error).toBe('date_out_of_window')
  })
  it('AI returns prose instead of JSON → rejected', async () => {
    const s = await summarize(cat, m, { apiKey: 'k', fetchImpl: reply({ content: [{ type: 'text', text: 'Sorry, I cannot.' }] }) })
    expect(s.ai_status).toBe('failed'); expect(s.ai_error).toBe('ai_no_json')
  })
  it('number check also covers the vet email', () => {
    expect(() => validateSummary({ ...good, vet_email: 'She weighs 7.4 kg.' }, m, cat)).toThrow('unsupported_number:7.4')
  })

  it('OpenAI key → uses OpenAI, same validation, labeled with its model', async () => {
    let url = ''
    const oa = (async (u: string) => { url = u; return new Response(JSON.stringify({ choices: [{ message: { content: JSON.stringify(good) } }] })) }) as unknown as typeof fetch
    const s = await summarize(cat, m, { openaiKey: 'sk-x', openaiModel: 'my-model', fetchImpl: oa })
    expect(url).toContain('api.openai.com'); expect(s.ai_status).toBe('ai'); expect(s.model).toBe('my-model')
  })
  it('OpenAI answer with an invented number is rejected the same way', async () => {
    const bad = { ...good, vet_email: 'She ate 300 kcal.' }
    const oa = reply({ choices: [{ message: { content: JSON.stringify(bad) } }] })
    const s = await summarize(cat, m, { openaiKey: 'sk-x', openaiModel: 'my-model', fetchImpl: oa })
    expect(s.ai_status).toBe('failed'); expect(s.ai_error).toBe('unsupported_number:300')
  })
  it('OpenAI key without a model name → failed with a clear reason, not a guess', async () => {
    const s = await summarize(cat, m, { openaiKey: 'sk-x', fetchImpl: reply({}) })
    expect(s.ai_status).toBe('failed'); expect(s.ai_error).toBe('openai_model_not_set')
  })

  it('facts given to the AI carry units and dose dates', async () => {
    const { factLines } = await import('./summary')
    const mm = computeMetrics({ cat, days, tz: 'America/Chicago', litter: [], weights: [], visits: [], feedings: [],
      hydration: [{ id: 'h', cat_id: 'c1', observed_at: '2026-11-16T16:00:00Z', volume_ml: 100, method: 'estimated_drunk', notes: null }],
      medLogs: [{ id: 'd', cat_id: 'c1', medication_id: 'x', given_at: '2026-11-16T17:00:00Z', status: 'refused', med_name_snapshot: 'Gabapentin', dose_snapshot: '50 mg', notes: null }],
      medications: [{ id: 'x', cat_id: 'c1', name: 'Gabapentin', dose_as_prescribed: '50 mg', how_often: 'once daily', start_date: '2026-11-16', end_date: '2026-11-23', notes: null, archived_at: null }] })
    const f = factLines(cat, mm).join(' ')
    expect(f).toContain('100 mL'); expect(f).toContain('Nov 16 refused'); expect(f).toContain('Nov 16 to Mon, Nov 23')
  })
})
