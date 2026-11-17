// Try the AI weekly summary on a real data snapshot, before deploying.
// Usage:  npx tsx scripts/try-ai.ts [path/to/snapshot.json]
// Reads OPENAI_API_KEY / OPENAI_MODEL (or ANTHROPIC_*) from your shell or from .env.local.
import { existsSync, readFileSync } from 'node:fs'

// Load .env.local without printing anything. Non-empty shell variables win over the file;
// an empty one (e.g. left over from an earlier `export`) is treated as unset.
if (existsSync('.env.local')) {
  const seen = new Set<string>()
  for (const raw of readFileSync('.env.local', 'utf8').split(/\r?\n/)) {
    const m = raw.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*?)\s*$/)
    if (!m) continue
    const [, name, value] = m
    if (seen.has(name)) console.warn(`⚠ .env.local defines ${name} more than once; only the first one is used. Check the names.`)
    seen.add(name)
    if (!process.env[name]) process.env[name] = value.replace(/^["']|["']$/g, '')
  }
}
const k = process.env.OPENAI_API_KEY ?? '', mdl = process.env.OPENAI_MODEL ?? ''
console.log(`config: OPENAI_API_KEY ${k ? `set (length ${k.length})` : 'NOT SET'} · OPENAI_MODEL ${mdl ? (mdl.length > 40 ? 'looks like a KEY, not a model name!' : mdl) : 'NOT SET'}`)
import { computeMetrics } from '../src/lib/metrics'
import { summarize } from '../src/lib/ai'

const file = process.argv[2] ?? 'scripts/fixtures/chestnut-2026-11-16.local.json'
const snap = JSON.parse(readFileSync(file, 'utf8'))
const metrics = computeMetrics({ ...snap, today: snap.days[snap.days.length - 1] })

const t0 = Date.now()
const s = await summarize(snap.cat, metrics, {
  apiKey: process.env.ANTHROPIC_API_KEY, model: process.env.ANTHROPIC_MODEL,
  openaiKey: process.env.OPENAI_API_KEY, openaiModel: process.env.OPENAI_MODEL,
})
const line = '─'.repeat(60)
console.log(`${line}\nai_status: ${s.ai_status}   model: ${s.model ?? '-'}   took: ${((Date.now() - t0) / 1000).toFixed(1)}s`)
if (s.ai_error) console.log(`ai_error:  ${s.ai_error}`)
console.log(`${line}\nOBSERVATIONS`)
for (const o of s.observations) console.log(`- ${o.text}${o.dates.length ? `  [${o.dates.join(', ')}]` : ''}`)
console.log(`\nQUESTIONS FOR THE VET`); s.questions_for_vet.forEach((q, i) => console.log(`${i + 1}. ${q}`))
console.log(`\nGAPS AND LIMITS`); s.limitations.forEach(l => console.log(`- ${l}`))
console.log(`\n${line}\nEMAIL DRAFT\n${line}\n${s.vet_email}\n${line}`)
if (s.ai_status !== 'ai') process.exitCode = 1
