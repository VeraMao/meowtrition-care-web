# Meowtrition Care Agent (web)

A cat-care log with an honest weekly review for your vet. Owners log food, water, litter, weight, medication doses and vet visits; the app computes the numbers, AI writes the summary and a vet email draft, and the owner reviews it before anything leaves the app. Nothing is ever sent automatically.

Built for the AI Builder Curriculum 201–401 reps. Plan: `../Meowtrition_3Day_Plan_v2.md`.
Separate from the iOS project (`~/Desktop/Meowtrition`) and the V3 prototype (`~/Desktop/meowtrition_v3`).

**Stack:** Vite + React + TypeScript + Tailwind · Supabase (Postgres, Auth, RLS) · Vercel (static site + 2 serverless functions) · Motion · OpenAI or Anthropic for summary text · MCP for the Claude connector.

## Features

| Area | What it does |
|---|---|
| Log | Food (pick a saved food, enter the amount in cups / grams / cans, kcal is calculated from the label; or type kcal), water (two methods, never added together), litter (clumps, stools, shape, symptoms), weight, medication doses (given / partly / missed / refused / vomited). Edit and delete everything. |
| Food library | Store every calorie figure on the label (kcal/kg, kcal/cup, kcal/can…). Sanity warnings catch a number typed into the wrong box (e.g. 3,286 "kcal/cup"). |
| Medications | Medication list with the dose copied exactly as prescribed, how often, start/end. The app never suggests dose changes. |
| Trends | 7-day charts; days with no record are shown as gaps, never zero. |
| Health | Vet visits; weekly reviews with approve, edit-the-email, copy, delete. |
| Emergency rule | Straining, pain or little/no urine shows a "contact your vet now" notice immediately, without AI. |
| Weekly review | Numbers from code (`src/lib/metrics.ts`); wording from AI (`src/lib/ai.ts`); every number and date the AI writes is checked against the records, otherwise the review falls back to a fixed template and says so. |
| Review limits | A new review needs new information since the last one; max 3 per cat in any 7 days. Enforced in the database. |
| Stale reviews | If any record a review was built from is added, edited, moved or deleted, the review becomes "out of date" and must be re-created; it can't just be re-approved. |
| Claude connector | Profile → Connect Claude creates a personal key; `/api/mcp?key=…` lets Claude read that user's data (and save owner-confirmed vet visits). |

## Project layout

| Path | What it is |
|---|---|
| `src/lib/metrics.ts` | All numbers in a review. Deterministic, no AI. |
| `src/lib/summary.ts` | Facts given to the AI, the prompt, the fixed template, and validation of AI output. |
| `src/lib/ai.ts` | Calls OpenAI or Anthropic; returns `ai_status` = `ai` / `not_configured` / `failed` (+ reason). |
| `src/lib/food.ts` | Label calories → kcal eaten; sanity checks. |
| `src/lib/mcp.ts`, `api/mcp.ts` | The Claude connector (MCP over streamable HTTP, stateless). |
| `api/care-review.ts` | Server route that builds and saves a review with the user's own login (RLS applies). |
| `src/pages/*` | Home, Log, Trends, Health, Report, Profile, Login. |
| `supabase/*.sql` | Database schema, in order (see below). |
| `scripts/try-ai.ts` | Try the AI summary on a local data snapshot before deploying. |
| `tests/e2e_smoke.py` | End-to-end browser test against a fake Supabase. |

## Database (Supabase project MeowAgent, `dpockgdhspqavmvloryf`)

Run in order in the SQL Editor. All are applied to the live project as of Nov 16, 2026.

| File | Adds |
|---|---|
| `001_schema.sql` | Core tables, RLS on every table, profile on sign-up; later migrations for food label units are appended at the end |
| `002_rls_check.sql` | Isolation checks (rolled back) |
| `003_medications.sql` | Medications + dose log |
| `004_stale_reports.sql` | Reviews go stale when their data changes (old and new values, vet visits too) |
| `005_check_stale.sql` | 9 regression checks for 004 (rolled back); expect PASS1–PASS9 |
| `006_api_keys.sql` | Personal connector keys (hash only) + `skill_export` / `skill_save_vet_visit` |
| `007_report_limits.sql` | "New information" rule + 3 per 7 days, generation history, `report_quota` |
| `008_limit_fix.sql` | Closes a same-transaction loophole in 007 |

## Verification status (Nov 16, 2026)

| Check | Result |
|---|---|
| `npm test` (49 tests: metrics, time zones/DST, label calories, AI states incl. invented numbers and out-of-window dates, connector keys, MCP tools, limit messages) | ✅ |
| `npm run build` / typecheck | ✅ |
| End-to-end browser test (`tests/e2e_smoke.py`) | ✅ |
| Live DB: RLS isolation, stale reviews (9/9), connector keys (8/8), review limits | ✅ |
| Real AI call with Vera's data (OpenAI `gpt-6-luna`) | ✅ `ai_status: ai`, ~20 s |
| Deployed URL, real login on it, real user other than Vera | ⏳ next |

## Run locally

```bash
npm install
cp .env.example .env.local     # fill in the values (see .env.example)
npm run dev                    # http://localhost:5173
npm test
npx tsx scripts/try-ai.ts      # AI summary on the local snapshot; reads keys from .env.local
```

`npm run dev` doesn't serve `/api`, so "Create" builds the template version in the browser (labeled "AI not set up"). The AI path runs on the deployed server, or locally with `npx vercel dev`.

## Environment variables

| Name | Where | Notes |
|---|---|---|
| `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY` | browser | Publishable key; safe in the browser because RLS protects the data |
| `SUPABASE_URL`, `SUPABASE_ANON_KEY` | server | Same values; used by `api/*` |
| `OPENAI_API_KEY`, `OPENAI_MODEL` | server only | Or `ANTHROPIC_API_KEY` / `ANTHROPIC_MODEL` (used first if both are set). Neither set → template, labeled |

Never give an AI key a `VITE_` prefix (it would be bundled into the website). Never use the Supabase `service_role`/secret key anywhere in this app; it isn't needed.

## Deploy (Vercel)

1. Import the GitHub repo in Vercel, Framework Preset **Vite**, add the 6 environment variables, Deploy. `vercel.json` routes the SPA and gives `api/*` up to 60 s (AI takes ~20 s).
2. Supabase → Authentication → URL Configuration: Site URL = the Vercel URL; Redirect URLs also include `http://localhost:5173`.
3. Rollback: Vercel → Deployments → previous deployment → **Promote to Production**.

## Claude connector and the Skill

1. In the deployed app: Profile → Connect Claude → Create connector key → copy the address (shown once).
2. In Claude: add it as a custom connector. Tools: `get_care_data` (read-only, your cats only) and `save_vet_visit` (only after you confirm a specific visit).
3. The `meowtrition-care-review` Skill turns this data plus clinic emails in Gmail into the weekly review; a scheduled task runs it every Monday morning and stops for your review.

### Accepted risk (documented on purpose)
Supabase's security advisor warns that `skill_export` and `skill_save_vet_visit` are `SECURITY DEFINER` functions callable by `anon`. This is intentional: Claude never logs in, so the personal key is the credential. Both functions check the key first and only touch that key owner's rows (verified on the live DB: wrong/revoked keys rejected, no cross-user reads or writes). Anyone holding a key can call the functions directly, which is the same access as the connector. Keys are 256-bit random; treat one like a password and disconnect it if it leaks.

## Design rules

Empty means "not logged", never 0 · urine clumps per cleaning are not urinations · unknown-cat rows never count toward a named cat · numbers come from code, AI only writes words and every number it writes is checked · the emergency notice is a fixed rule, shown instantly · editing a record or the email resets approval · nothing is ever sent from the app · vet records are quoted as recorded (new ones in English).
