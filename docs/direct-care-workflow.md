# Direct care workflow

Decision: 2026-11-16. Replaces the old Notion/Sheets staging workflow.

**Daily observations stay in the app. Medical records stay at their source. The Skill reads both and returns a review for the owner.**

## Choose a medical source

| Owner's preference | How the review reads it | Recurring-run requirement |
|---|---|---|
| Gmail | Relevant clinic messages and attachments, directly through Gmail | Valid Gmail authorization and actual scheduled-tool support |
| PDF/photo upload | A file attached to the AI-host review task | The file must actually be available to each run; one-off chat attachments are not assumed persistent |
| Drive link | The specific authorized file or relevant files in the linked folder | Drive connector permission and resource access in the scheduled environment |
| No medical file | App records only, explicitly labeled missing medical context | Owner must choose this limited mode; never silently substitute it for a failed source |

No public sharing is required. A Drive URL alone grants no access. Gmail templates are optional. Notion is not required and existing Notion records are left untouched. Each person uses their own app connector and medical sources.

## What already exists

- Website: daily logs, medications, manual vet visits, on-demand reviews and owner review.
- App MCP: `get_care_data` for account-scoped reads; `save_vet_visit` for a specific owner-confirmed visit.
- Skill v0.2: app + chosen medical sources, source references, deterministic helper statistics and review stop.
- `scripts/summarize_care.py` in the Skill package: read-only calculations from the app export; no network or credentials.

## What this change does not claim

- No website upload button, Google Drive picker, Gmail OAuth integration or medical attachment store was added.
- The website's existing on-demand review still uses its database; it does not fetch mailbox/Drive content. The AI-host Skill combines the two sources.
- No weekly task was activated and no live scheduled run was verified by this change.
- Host reviews do not automatically appear in the website's report list. The existing MCP does not expose report persistence. Optional saving of a confirmed vet visit is separate.

## First run

1. In the deployed app, create an account-scoped connector key in Profile → Connect Claude. Add that connector in the chosen AI host. Treat the address as a password; do not paste it into source, reports or shared instructions.
2. Load the updated Skill package. Choose Gmail, an upload, or a specific Drive resource. Authorize the selected connector when needed.
3. Run a manual review. Verify that the actual environment can call `get_care_data`, read the selected medical source and execute the helper. Read-only inputs must succeed; unavailable sources are reported honestly.
4. Compare output numbers with logs and check every medical source. The output stops for owner review. It does not send mail or write records.

## Weekly schedule prompt

Configure this in a host only after confirming its scheduled execution supports the chosen tools. The intended recurrence is Monday 09:00 in the owner's timezone (default America/Chicago); a prompt alone is not a scheduler.

> Run the installed meowtrition-care-review Skill. Read my app account directly with get_care_data(days=7, include_today=false), using its returned local dates and timezone. Read the medical source I explicitly configured for this recurring task: Gmail clinic records or the authorized Drive file/folder specified in the task. Do not require Notion or a Gmail template. Do not search other accounts or sources. If the source selection, access, connector or code execution is missing, explain the failure and stop rather than inventing a complete report. Compute statistics with the packaged script. Cite original messages/files/pages, preserve conflicting records and missing observations, and label known demo data. Put the fixed urgent-symptom notice first when triggered. Return a weekly care review and editable vet email text, status needs_review. Do not send mail, create email drafts, save visits, change medications or write a website report. Wait for my review.

The medical source selection must be stored in the actual task or accessible context before activation. Do not put personal connector keys in the prompt.

## Evidence for Jonathan

- Manual run: app connector input + chosen medical source + correct calculated output.
- 201 connector proof: app MCP + Gmail, or app MCP + Drive. A file upload alone is not a second connector.
- Scheduled proof: actual trigger time, successful tool reads, needs_review output and owner review. Keep this separate from configuration screenshots.
- Reuse: another owner runs the workflow with their own account and source, without copying this owner's data.

## Local checks

```sh
python3 -m unittest discover -s ../meowtrition-care-review/scripts -p 'test_*.py'
npm test
npm run build
```

The helper tests use fabricated fixtures and prove arithmetic/observation handling only; they do not prove Gmail, Drive, live account authorization or scheduling.
