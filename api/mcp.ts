// POST /api/mcp?key=mk_…  — Meowtrition connector for Claude (MCP over streamable HTTP, stateless).
// Uses only the public anon key; the personal key is verified inside Postgres.
import { createClient } from '@supabase/supabase-js'
import { handleMcp, type Rpc } from '../src/lib/mcp.js'

function rpcClient(): Rpc {
  const db = createClient(process.env.SUPABASE_URL!, process.env.SUPABASE_ANON_KEY!, { auth: { persistSession: false } })
  return async (fn, args) => {
    const { data, error } = await db.rpc(fn, args)
    return { data, error: error ? { message: error.message } : null }
  }
}

const handle = (req: Request) => handleMcp(req, rpcClient())
export const POST = handle
export const GET = handle
export const DELETE = handle
