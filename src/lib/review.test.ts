import { describe, expect, it } from 'vitest'
import { friendlyReviewError } from './review'

describe('review limit messages', () => {
  it('explains "no new data"', () => expect(friendlyReviewError('no_new_data')).toContain('Nothing new has been logged'))
  it('explains the weekly limit with the next time', () => {
    const m = friendlyReviewError('weekly_limit:2026-11-24T00:27:39Z')
    expect(m).toContain('all 3 reviews'); expect(m).toContain('Nov')
  })
  it('passes other errors through', () => expect(friendlyReviewError('boom')).toBe('boom'))
})

describe('generateReview on the deployed site never fakes a review', async () => {
  const { generateReview } = await import('./review')
  const cat = { id: 'c1', owner_id: 'u', name: 'Chestnut', birth_date: null, estimated_age_months: null, sex: 'female' as const, neutered: null, daily_kcal_target: null, is_demo: false, archived_at: null }
  const withFetch = async (impl: typeof fetch, isDev: boolean) => {
    const orig = globalThis.fetch; globalThis.fetch = impl
    try { return await generateReview(cat, 'America/Chicago', { isDev }) } finally { globalThis.fetch = orig }
  }
  it('server crash (500, HTML) → clear error, nothing saved', async () => {
    const crash = (async () => new Response('A server error has occurred', { status: 500, headers: { 'content-type': 'text/plain' } })) as unknown as typeof fetch
    await expect(withFetch(crash, false)).rejects.toThrow('error 500')
  })
  it('route missing on the deployed site (404) → error, not a template', async () => {
    const missing = (async () => new Response('nope', { status: 404 })) as unknown as typeof fetch
    await expect(withFetch(missing, false)).rejects.toThrow('error 404')
  })
  it('network failure → clear error', async () => {
    const down = (async () => { throw new TypeError('fetch failed') }) as unknown as typeof fetch
    await expect(withFetch(down, false)).rejects.toThrow("Couldn't reach the server")
  })
  it('limit reached (409 JSON) → friendly limit message', async () => {
    const limited = (async () => new Response(JSON.stringify({ error: 'limit', detail: 'no_new_data' }), { status: 409, headers: { 'content-type': 'application/json' } })) as unknown as typeof fetch
    await expect(withFetch(limited, false)).rejects.toThrow('Nothing new has been logged')
  })
})
