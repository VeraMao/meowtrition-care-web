// Meowtrition as a Claude connector (MCP server). Stateless: a fresh server per HTTP request.
// Auth = the user's personal key (?key=… or Authorization: Bearer …). The key is checked inside
// Postgres (skill_export / skill_save_vet_visit), which only ever touch the key owner's rows.
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js'
import { WebStandardStreamableHTTPServerTransport } from '@modelcontextprotocol/sdk/server/webStandardStreamableHttp.js'
import { z } from 'zod'

/** Calls a Postgres function through Supabase (rpc). Injected so tests can fake it. */
export type Rpc = (fn: string, args: Record<string, unknown>) => Promise<{ data: unknown; error: { message: string } | null }>

const text = (t: string, isError = false) => ({ content: [{ type: 'text' as const, text: t }], isError })
const friendly = (m: string) =>
  m.includes('invalid_key') ? 'This connector key is not valid or was disconnected. Create a new one in Meowtrition → Profile → Connect Claude.'
  : m.includes('visit_already_exists_for_date') ? 'A vet visit for that date is already saved; nothing was changed.'
  : m.includes('cat_not_found') ? 'That cat is not in this account.'
  : `Meowtrition error: ${m}`

export function createMeowServer(key: string, rpc: Rpc) {
  const server = new McpServer({ name: 'meowtrition', version: '0.1.0' })

  server.registerTool('get_care_data', {
    title: 'Get cat care data',
    description: 'Returns the account owner\'s cats with their feeding, water, litter, weight and medication-dose logs for a recent window, plus medications and recent vet visits. ' +
      'Each row has local_date in the owner\'s time zone. Empty lists mean "not logged", never zero. Urine clumps are per cleaning, not urinations. Read-only.',
    inputSchema: {
      days: z.number().int().min(1).max(31).default(7).describe('How many local days to include (1–31).'),
      include_today: z.boolean().default(true).describe('true: window ends at the end of today (manual runs). false: ends at the end of yesterday (scheduled weekly runs).'),
    },
    annotations: { readOnlyHint: true },
  }, async ({ days, include_today }) => {
    const { data, error } = await rpc('skill_export', { p_key: key, p_days: days, p_include_today: include_today })
    return error ? text(friendly(error.message), true) : text(JSON.stringify(data, null, 2))
  })

  server.registerTool('save_vet_visit', {
    title: 'Save a vet visit (owner-confirmed only)',
    description: 'Saves ONE vet visit for one of the owner\'s cats. Call this ONLY after the owner has explicitly confirmed this exact visit (e.g. replied "save visit 1"). ' +
      'Copy wording exactly from the clinic record; leave fields empty rather than guessing. Refuses duplicates for the same date.',
    inputSchema: {
      cat_id: z.string().uuid(),
      visit_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).describe('YYYY-MM-DD'),
      reason: z.string().optional(),
      what_the_vet_said: z.string().optional(),
      medications: z.string().optional(),
      next_checkup_date: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).optional(),
      source: z.string().describe('Where it came from, e.g. "VEG Arboretum email 2026-11-13, record.pdf"'),
      owner_confirmed: z.literal(true).describe('Must be true: the owner explicitly approved saving this visit.'),
    },
  }, async (a) => {
    const { data, error } = await rpc('skill_save_vet_visit', {
      p_key: key, p_cat_id: a.cat_id, p_visit_date: a.visit_date, p_reason: a.reason ?? null,
      p_what_the_vet_said: a.what_the_vet_said ?? null, p_medications: a.medications ?? null,
      p_next_checkup_date: a.next_checkup_date ?? null, p_notes: `Source: ${a.source}`,
    })
    return error ? text(friendly(error.message), true) : text(JSON.stringify(data))
  })

  return server
}

/** Handle one HTTP request (Web standard Request/Response). */
export async function handleMcp(req: Request, rpc: Rpc): Promise<Response> {
  const url = new URL(req.url)
  const key = url.searchParams.get('key') ?? (req.headers.get('authorization') ?? '').replace(/^Bearer\s+/i, '')
  if (!key || !key.startsWith('mk_')) {
    return new Response(JSON.stringify({ error: 'missing_key', message: 'Add your connector key: …/api/mcp?key=mk_…' }), { status: 401, headers: { 'content-type': 'application/json' } })
  }
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405, headers: { allow: 'POST' } })
  const server = createMeowServer(key, rpc)
  const transport = new WebStandardStreamableHTTPServerTransport({ sessionIdGenerator: undefined, enableJsonResponse: true })
  await server.connect(transport)
  return transport.handleRequest(req)
}
