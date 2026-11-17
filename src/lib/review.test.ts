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
