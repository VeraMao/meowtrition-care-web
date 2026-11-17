# Meowtrition Care Agent (web)

Web app for the AI Builder Curriculum 301/401 reps. Plan: `../Meowtrition_3Day_Plan_v2.md`.
Separate from the iOS project (`~/Desktop/Meowtrition`) and the V3 prototype (`~/Desktop/meowtrition_v3`); neither was changed.

**Stack:** Vite + React + TypeScript + Tailwind · Supabase (Postgres, Auth, RLS) · Vercel (static site + one serverless function) · Motion for animation.

## What's here

| Path | What it is |
|---|---|
| `supabase/001_schema.sql` | 9 tables, RLS on every table, review-reset trigger |
| `supabase/002_rls_check.sql` | 8 isolation checks; prints `PASS` lines |
| `supabase/003_medications.sql` | Medications + dose log (applied 2026-11-16; RLS verified on the live DB) |
| `src/lib/metrics.ts` | All numbers in a report. Deterministic, no AI. Tested in `metrics.test.ts` |
| `src/lib/summary.ts` | Template summary (no AI), AI prompt, and AI output validation |
| `api/care-review.ts` | Server route: loads rows with the user's own token (RLS applies), computes metrics, optional AI, saves `needs_review` |
| `src/pages/*` | Home, Log (Food/Water/Litter/Weight), Trends, Health (reviews + vet visits), Report, Profile |

## Status (Nov 16, 2026, ~12:30 AM)

| Check | Result |
|---|---|
| `npm test` (13 metric tests: kcal sums, time zones and DST, not-logged ≠ 0, unknown cat, clumps ≠ urinations, emergency rule) | ✅ pass |
| `npm run typecheck` / `npm run build` | ✅ pass |
| Schema + RLS checks on local PostgreSQL 16 (stub `auth` schema) | ✅ 8/8 pass |
| On the real Supabase project **MeowAgent** (`dpockgdhspqavmvloryf`) | ✅ schema applied; 8/8 isolation checks + both triggers pass (test data rolled back); security advisor: 0 issues |
| App clicked through in a browser against a real database | ⏳ not done yet |
| AI summaries | ⏳ off. No `ANTHROPIC_API_KEY` until Vera approves the spend. Until then reports use the template and are labeled "Template, not AI" |
| Deploy | ⏳ Day 3 |

## Run locally

```bash
npm install
cp .env.example .env.local     # fill in VITE_SUPABASE_URL and VITE_SUPABASE_ANON_KEY
npm run dev                    # http://localhost:5173
npm test
```

`npm run dev` doesn't serve `/api`, so "Create weekly review" falls back to building the template summary in the browser (still labeled). To run the real route locally, use `npx vercel dev`.

## Supabase

Project **MeowAgent** (`dpockgdhspqavmvloryf`, us-east-1). Schema is applied. `.env.local` already holds the URL and the **publishable** key (browser-safe). Never put the `service_role`/secret key in the browser or the repo.

To do: Auth → URL Configuration → set Site URL to `http://localhost:5173` now, and to the Vercel URL on Day 3, so email-confirmation links open the app.

## Deploy (Day 3)

Vercel → import the GitHub repo → set env vars `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, `SUPABASE_URL`, `SUPABASE_ANON_KEY` (+ `ANTHROPIC_API_KEY` only if approved). Rollback = Vercel → Deployments → previous → "Promote to Production".

## Design rules kept from the full spec

Empty = not logged (never 0) · clumps per cleaning ≠ urinations · unknown-cat rows never counted toward a cat · numbers from code, AI only writes words · emergency notice is a fixed rule shown instantly, no AI · editing a log or the email resets approval · nothing is ever sent from the app.

## Claude connector (`/api/mcp`)

Each user can create a personal connector key in **Profile → Connect Claude**. Claude adds `https://<app>/api/mcp?key=mk_…` as a custom connector and gets two tools:
`get_care_data` (read-only, that user's cats only) and `save_vet_visit` (only after the owner confirms; only into that user's cats).
Only the key's SHA-256 is stored. Keys can be disconnected at any time.

### Accepted risk (documented on purpose)
Supabase's security advisor warns that `skill_export` and `skill_save_vet_visit` are `SECURITY DEFINER` functions callable by `anon`.
That is intentional: Claude never logs in, so the personal key is the credential. Both functions check the key first and only touch
that key owner's rows (verified on the live DB: wrong/revoked keys rejected, no cross-user reads or writes). The remaining risk is that
anyone holding a key can call the function directly, which is the same access as the connector. Keys are 256-bit random, so guessing is not
practical; treat a key like a password and disconnect it if it leaks.
