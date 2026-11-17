import { describe, expect, it } from 'vitest'
import { readFileSync } from 'node:fs'

// Files that the Vercel serverless functions (api/*) load at runtime. Vercel runs them as native
// Node ESM, which needs explicit ".js" on relative imports; Vite hides this mistake locally.
// Regression test for the Nov 16 production crash (FUNCTION_INVOCATION_FAILED on /api/care-review).
const SERVER_FILES = ['api/care-review.ts', 'api/mcp.ts', 'src/lib/metrics.ts', 'src/lib/summary.ts', 'src/lib/ai.ts', 'src/lib/time.ts', 'src/lib/types.ts', 'src/lib/mcp.ts']

describe('server code is loadable by Node ESM', () => {
  for (const f of SERVER_FILES) {
    it(`${f}: relative imports end in .js`, () => {
      const src = readFileSync(f, 'utf8')
      const bad = [...src.matchAll(/from\s+'(\.{1,2}\/[^']+)'/g)].map(m => m[1]).filter(p => !p.endsWith('.js'))
      expect(bad).toEqual([])
    })
  }
})
