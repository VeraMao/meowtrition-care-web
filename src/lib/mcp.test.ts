import { describe, expect, it } from 'vitest'
import { handleMcp, type Rpc } from './mcp'

const KEY = 'mk_testtesttesttesttesttesttesttest'
const calls: { fn: string; args: Record<string, unknown> }[] = []
const fakeRpc: Rpc = async (fn, args) => {
  calls.push({ fn, args })
  if (args.p_key !== KEY) return { data: null, error: { message: 'invalid_key' } }
  if (fn === 'skill_export') return { data: { cats: [{ name: 'Chestnut', feeding: [{ kcal: 98.6 }] }] }, error: null }
  if (fn === 'skill_save_vet_visit') return { data: { saved: true }, error: null }
  return { data: null, error: { message: 'unknown_fn' } }
}
const post = (body: unknown, key = KEY) => new Request(`https://meow.test/api/mcp?key=${key}`, {
  method: 'POST',
  headers: { 'content-type': 'application/json', accept: 'application/json, text/event-stream' },
  body: JSON.stringify(body),
})
const call = (name: string, args: unknown, key = KEY) => post({ jsonrpc: '2.0', id: 2, method: 'tools/call', params: { name, arguments: args } }, key)

describe('Meowtrition MCP connector', () => {
  it('rejects requests without a key', async () => {
    const r = await handleMcp(new Request('https://meow.test/api/mcp', { method: 'POST', body: '{}' }), fakeRpc)
    expect(r.status).toBe(401)
  })
  it('initializes and lists both tools', async () => {
    const init = await handleMcp(post({ jsonrpc: '2.0', id: 1, method: 'initialize', params: { protocolVersion: '2025-06-18', capabilities: {}, clientInfo: { name: 't', version: '1' } } }), fakeRpc)
    expect(init.status).toBe(200)
    const list = await handleMcp(post({ jsonrpc: '2.0', id: 2, method: 'tools/list', params: {} }), fakeRpc)
    const j = await list.json()
    expect(j.result.tools.map((t: { name: string }) => t.name).sort()).toEqual(['get_care_data', 'save_vet_visit'])
  })
  it('get_care_data passes the key and window to Postgres', async () => {
    calls.length = 0
    const r = await (await handleMcp(call('get_care_data', { days: 7, include_today: false }), fakeRpc)).json()
    expect(r.result.isError).toBe(false)
    expect(r.result.content[0].text).toContain('98.6')
    expect(calls[0]).toEqual({ fn: 'skill_export', args: { p_key: KEY, p_days: 7, p_include_today: false } })
  })
  it('a wrong key gets a clear error, not data', async () => {
    const r = await (await handleMcp(call('get_care_data', {}, 'mk_wrongwrongwrongwrongwrongwrong'), fakeRpc)).json()
    expect(r.result.isError).toBe(true)
    expect(r.result.content[0].text).toContain('not valid')
  })
  it('save_vet_visit refuses without owner_confirmed: true', async () => {
    calls.length = 0
    const r = await (await handleMcp(call('save_vet_visit', { cat_id: '475b2f57-ab00-46a5-af2b-a538e8b28214', visit_date: '2026-11-12', source: 'x' }), fakeRpc)).json()
    expect(r.result?.isError ?? true).toBe(true)
    expect(calls.length).toBe(0)
  })
  it('save_vet_visit with confirmation saves', async () => {
    const r = await (await handleMcp(call('save_vet_visit', { cat_id: '475b2f57-ab00-46a5-af2b-a538e8b28214', visit_date: '2026-11-12', source: 'VEG email', owner_confirmed: true }), fakeRpc)).json()
    expect(r.result.isError).toBe(false)
  })
})
