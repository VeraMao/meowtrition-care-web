import { describe, expect, it } from 'vitest'
import { createHash } from 'node:crypto'
import { connectorUrl, generateKey, sha256Hex } from './keys'

describe('personal keys', () => {
  it('are long, random and URL-safe', () => {
    const a = generateKey(), b = generateKey()
    expect(a).not.toBe(b)
    expect(a).toMatch(/^mk_[A-Za-z0-9_-]{43}$/)
  })
  it('hash the same way Postgres does (sha256 hex of UTF-8)', async () => {
    const k = 'mk_aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa'
    expect(await sha256Hex(k)).toBe(createHash('sha256').update(k, 'utf8').digest('hex'))
  })
  it('build the connector URL', () => {
    expect(connectorUrl('mk_x', 'https://meow.example')).toBe('https://meow.example/api/mcp?key=mk_x')
  })
})
