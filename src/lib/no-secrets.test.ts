import { describe, expect, it } from 'vitest'
import { execSync } from 'node:child_process'
import { readFileSync } from 'node:fs'

// Regression test for Nov 17: an OpenAI key was pasted into .env.example (which IS committed),
// pushed to GitHub, and auto-revoked. Any committed file containing a secret now fails `npm test`.
const PATTERNS: [string, RegExp][] = [
  ['OpenAI key', /sk-(proj-)?[A-Za-z0-9_-]{20,}/],
  ['Anthropic key', /sk-ant-[A-Za-z0-9_-]{20,}/],
  ['Supabase secret key', /sb_secret_[A-Za-z0-9_-]{10,}/],
  ['Supabase service_role JWT', /eyJ[A-Za-z0-9_-]{10,}\.eyJ[A-Za-z0-9_-]*cm9sZSI6InNlcnZpY2Vfcm9sZS[A-Za-z0-9_-]*/],
  ['Meowtrition connector key', /mk_[A-Za-z0-9_-]{40,}/],
]

function trackedFiles(): string[] {
  try { return execSync('git ls-files', { encoding: 'utf8' }).split('\n').filter(Boolean) }
  catch { return ['.env.example', 'README.md'] }      // not a git checkout: check the obvious ones
}

describe('no secrets in files that get committed', () => {
  it('.env.example has names only, no values for keys', () => {
    const lines = readFileSync('.env.example', 'utf8').split('\n')
    const filled = lines.filter(l => /^(OPENAI_API_KEY|ANTHROPIC_API_KEY|VITE_SUPABASE_ANON_KEY|SUPABASE_ANON_KEY)=\S/.test(l))
    expect(filled).toEqual([])
  })
  it('no tracked file contains a key', () => {
    const hits: string[] = []
    for (const f of trackedFiles()) {
      if (/\.(png|jpg|jpeg|gif|ico|lock)$/.test(f) || f === 'package-lock.json') continue
      let text = ''
      try { text = readFileSync(f, 'utf8') } catch { continue }
      for (const [name, re] of PATTERNS) if (re.test(text)) hits.push(`${f}: ${name}`)
    }
    expect(hits).toEqual([])
  })
})
