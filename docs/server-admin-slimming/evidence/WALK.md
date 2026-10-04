# WALK evidence: local browser walk of the slim Admin against the slim server (SLIM-09)

October 4, 2026. A Playwright (Chromium, headless) walk of the slim Admin, built with `next build` and served by `next start`, against the slim server (`ops/dev-server.ts` through `tsx`). Both ran on this machine against the loopback `csi01` replica with a synthetic dataset. Nothing pointed at production. Both servers were stopped at the end, and the `csi01` replica was left running.

## What was walked

| Repo | Revision |
| --- | --- |
| `vantage-main-server` | `slim/server-admin` HEAD `9007f43f` plus the uncommitted working tree as it was at walk time. Other lanes' uncommitted `ops/slimming/**`, `ops/lib/loopback-mongo*`, `processed-calls-store.ts`, `src/models/Agent.ts`, replica tests and `package.json` were present. `tsx` runs the source directly, so the walk exercised that tree. |
| `vantage-admin` | `slim/server-admin` HEAD `cdc9510` plus the uncommitted working tree. That tree held the in-progress Sales Intelligence route-skeleton/loading edits and the user's own docs edits. `next build` compiled the tree as it stood. |

## Isolation (how production was kept out)

- **Environment allowlist:** both processes were spawned with an allowlisted environment, from the scratchpad `walk/env.mjs`. Only OS runtime variables were inherited, and every database or URI variable was set explicitly.
  - Server:
    - Data: `TEST_MODE=true`, `TEST_MONGO_DATABASE_NAME=testvantagemovers_walk09` and `MONGO_URI=mongodb://127.0.0.1:27189/?replicaSet=csi01`.
    - `DOTENV_CONFIG_PATH` pointed at an empty file, so `dotenv/config` never read the repo `.env`.
    - Fresh random secrets were generated.
    - Everything that touches a provider or runs in the background was turned off: Sheet Sync, Lead messaging, Reporting Google delivery, Best Relocation, Granot apply, and all RingCentral and Sales Intelligence capture, sync, nudge and directory flags.
  - Admin: `MONGODB_URI` was the same loopback URI, `ADMIN_AUTH_DB_NAME=testvantagemovers_walk09admin` and `VANTAGE_API_BASE_URL=http://127.0.0.1:3191`, with fresh secrets.
- **Resolved hosts, verified before seeding and serving:**
  - Seed log: `resolved Mongo host=127.0.0.1 port=27189 db=testvantagemovers_walk09`, then `setName=csi01 primary=127.0.0.1:27189`.
  - Server `GET /db`: `{"host":"127.0.0.1","name":"testvantagemovers_walk09"}`.
  - Admin launcher: `MONGODB_URI host=127.0.0.1 authDb=testvantagemovers_walk09admin api=http://127.0.0.1:3191`.
  - The Owner and Rep accounts exist only in the walk Admin database, so a successful login also proves which auth database the Admin used.
- **Egress guard:** the server, the seed and `next start` all preloaded a no-egress guard (`walk/no-egress.mjs`). It wraps `fetch`, `http`/`https` `request`/`get` and `net.Socket.connect`, and refuses any host that is not loopback. It logged **0 refusals** in `server.log` and `admin.log`.
- **Admin build env:** `next build` printed `Environments: .env`, because Next still parses the repo `.env` at build time. `@next/env` never overrides a variable that is already set, and every variable the Admin reads was set explicitly. The build inlines only `NEXT_PUBLIC_*`, and `NEXT_PUBLIC_APP_NAME` was also set explicitly. `next start` did not print that line.
- **Data and screenshots:** all seed data is synthetic, using `*.example.test` emails, `555-0100-xx` phones and `WALK-*` job numbers. Screenshots stay in the session scratchpad (`walk/shots/`, 57 PNGs) and are not committed.

## Synthetic dataset

Seed: `walk/seed.ts`. It creates core records through the server's Mongoose models, with validation on. CSI collections and indexes come from `applyCsiMigration()`.

- **Operations Registry:**
  - Source `main_site` with granularities `main_site_form` and `main_site_call`.
  - Agents Dana Synthetic (`DANAS`) and Eli Synthetic (`ELIS`).
- **Leads:**
  - Form Leads: Jane (booked, then cancelled), Bob, and a duplicate of Bob.
  - Call Leads: Cal (booked) and a duplicate of Cal.
- **Bookings and Cancellations:** Booking `WALK-1001` (Jane, FormLead, Dana) with Customer and Cancellation, and Booking `WALK-1002` (Cal, CallLead, Eli). One Testimonial.
- **Contact Numbers**, each with a `call_interaction` that has parties, legs and a recording id:
  - **none:** no Lead attached.
  - **resolved:** Jane attached, Cal a candidate.
  - **multiple:** Bob and Cal both attached.
  - **restricted:** a candidate plus an `origin: intelligence` restriction.
- **RingCentral and rep identity:** a reviewed Rep Identity Link (Dana, ext 101) and a RingCentral directory snapshot with 2 Users and 1 company number.
- **Granot receipts:** two came through the real webhook route (`POST /api/webhooks/granot/lead-created` and `/booking-status-changed`, with a synthetic `GRANOT_WEBHOOK_SECRET`), giving 2 rows in `granot_webhook_receipts`.
- **Admin auth database:** Owner `owner@walk.example.test` and Rep `rep@walk.example.test`, whose `agent_id` is Dana.
- **Daily Operations:** no seeding was needed. The board rendered, and its Granot Receipts tile counted the 2 walk webhooks live.

## Results

### Login and sidebar (Owner)

- Owner login landed on `/`.
- The page's links are exactly these: `/`, `/daily`, `/sales-intelligence`, `/intakes`, `/manual`, `/form-leads`, `/duplicate-form-leads`, `/call-leads`, `/duplicate-call-leads`, `/bookings`, `/bookings/new`, `/cancellations`, `/cancellations/new`, `/job-timeline`, `/testimonials`, `/analytics`, `/reporting`, `/operations-registry`, `/granot-lifecycle/health`, `/ingestion` and `/extension`.
- **No retired href** (`/customers`, `/agents`, `/observational`, `/exports`, `/audit-log`, `/reports`, `/conversations`, `/live-events`, `/granot-lifecycle/receipts`) and **no retired label** appear.

### Retained destinations: all render with no error

Each page below returned 200 and showed no error boundary text. None had a browser console error or a failed `/api/**` response during the final run.

| Destination | Result |
| --- | --- |
| Overview `/` | renders: This week $400 deposits, 2 bookings, 50% cancel rate, Top Agents Dana/Eli |
| Daily `/daily` | renders live board. Granot Receipts = 2 (the walk webhooks), Live indicator |
| Sales Intelligence `/sales-intelligence` (Numbers) | two tabs only (Numbers, RingCentral Accounts). Capture health block. Rows show resolved "Jane Synthetic · Main Site · Cancelled", "More than one Lead is attached", "No Lead attached" |
| SI Number detail (`?number=<resolved>`) | Calls and messages: the call, "Rep: Dana Synthetic · ext. 101", legs, 1 provider recording. Lead matches: attached Lead with Open official Lead/Booking/Cancellation, the evidence list and the commands. Details: rollups and Recount |
| SI RingCentral Accounts (`?view=reps`) | directory table (Dana with reviewed Agent, Eli "No attached Agent"), Message buttons |
| Intakes, Manual | render |
| Form Leads, Call Leads, Duplicate Form Leads, Duplicate Call Leads | render with the seeded rows (normalized to `?page=1`) |
| Bookings, Cancellations, Job Timeline, Testimonials | render |
| Analytics | renders: revenue $800, 2 bookings, 5 leads, 1 cancellation, receiver attribution 20% |
| Reporting | renders |
| Operations Registry, and the Agents tab (`?tab=agents`) | render. Agents tab lists Dana/Eli with Granot usernames and deactivate controls |
| Granot Lifecycle Health `/granot-lifecycle/health` | renders the bounded health projection (flags, due work) |
| Ingestion, Extension | render |
| Settings `/settings` | permanent redirect to `/operations-registry?tab=moving-carriers` (unchanged behavior) |

### Retired URLs

| URL | Result |
| --- | --- |
| `/customers`, `/agents`, `/observational`, `/observational/events`, `/exports`, `/audit-log`, `/reports/agent-sales`, `/conversations`, `/live-events`, `/ingestion/granot/live` | 404, normal "This page could not be found." |
| `/granot-lifecycle/receipts?job_no=WALK-1001&page=2` | redirects to `/granot-lifecycle/health` with the query dropped |
| `/granot-lifecycle` | redirects to `/granot-lifecycle/health` |
| `/sales-intelligence/outreach/<id>` | 404 not-found |
| `/sales-intelligence?view=attention&lead=…&lead_model=FormLead` | redirects to `/sales-intelligence` (Numbers) |
| `/sales-intelligence?view=closed` | redirects to `/sales-intelligence` (Numbers) |
| `/sales-intelligence/legacy?view=numbers&number=<id>` | redirects to `/sales-intelligence?number=<id>` |

The only console errors on these pages are the browser's own "Failed to load resource: 404" lines for the not-found documents, which is expected.

### HTTP-level probes (Owner session, through the Admin proxy)

- **Retained, 200:**
  - `admin/form-leads`, `admin/booked-leads`, `admin/catalog/agents`.
  - `sales-intelligence/{numbers,coverage,reps}`.
  - `granot-lifecycle/operations/health`.
  - `exports/form-leads.csv` and `exports/analytics/summary.csv` (CSV bodies).
- **Database scope:**
  - `database_scope=historical`: **400**.
  - `database_scope=combined`: **400**.
  - `database_scope=production`: 200.
- **Retired, 404:**
  - `observability/{events,incidents}`, `granot-lifecycle/receipts`, `granot-lifecycle/receipts/live`.
  - `customers`, `conversations`.
  - `sales-intelligence/{attention,outreach,overview,closed,analysis-runs}`.
  - `reports/agent-sales`, `exports/{customers,agents}.csv`.
  - The retired Admin BFFs `/api/audit-log` and `/api/granot-live-receipts` also return 404.

### CSV export

On Form Leads, **Export CSV** downloaded `form-leads.csv`: a header plus 2 rows, including Jane Synthetic. The banner reads "CSV export downloaded.", and the page contains no "audit" text. The Admin auth database still holds **only `admin_users`** after login, proxying and CSV export, so no `admin_audit_logs` collection was recreated.

### Retained Owner commands exercised (local only)

- **Recount this Number:** submitted with a reason. It produced one `sales_intelligence_jobs` row, `stage: "rebuild"`, `status: "pending"`, `subject_key: number:<resolved>`. No worker runs locally, so the job stays pending.
- **Reject attachment:** submitted with a reason.
  - The first Reject button belonged to the *attached* Jane edge, not the Cal candidate the script had tried to select, so the command rejected Jane's attached edge.
  - The edge went `attached` → `rejected` (revision 2, history +1), and the Number then showed "No Lead attached".
  - `sales_intelligence_command_executions` and `sales_intelligence_audit_events` each gained a row.
- **Message (Accounts):** not exercised, because it needs RingCentral, and the nudge flag was off by design.

### Rep login

- The Rep login lands on `/sales-intelligence`. The page shows "Signed in as rep@walk.example.test", Sign out, and "Sales Intelligence is being rebuilt. It is not available for Rep accounts yet." There is no table and no link.
- `/`, `/form-leads` and `/daily` all redirect to `/sales-intelligence`. `/sales-intelligence?view=reps` shows the same unavailable page.
- A Rep `fetch('/api/proxy/api/v1/admin/sales-intelligence/numbers')` is refused with **403**. That probe produced the only Rep console error.

### Retired namespaces after the walk

The walk database `testvantagemovers_walk09` holds none of the 20 retired collections, checked after seeding, the walk, the commands and the probes. The 20 are:

- **Outreach:** `outreach_records`, `outreach_followups`, `outreach_band_transitions`, `outreach_rep_days`.
- **Conversations:** `lead_conversations`.
- **Analysis (`intelligence_*`):** `intelligence_runs`, `intelligence_evidence_snapshots`, `intelligence_submissions`, `intelligence_findings`, `intelligence_effects`, `intelligence_owner_assessments`.
- **Move assessment:** `move_assessment_artifacts`.
- **Attention and AI budget (`sales_intelligence_*`):** `sales_intelligence_attention_snapshots`, `sales_intelligence_attention_artifacts`, `sales_intelligence_ai_budget`, `sales_intelligence_ai_reservations`.
- **OperationalEvents:** `operational_events`, `operational_incidents`, `notification_deliveries`, `operational_report_runs`.

These retained collections exist: `granot_lifecycle_health_state`, `granot_webhook_receipts`, `test_daily_operations_*`, `sheet_sync_*` and the CSI retained set. `applyCsiMigration()` still creates `sales_intelligence_review_items`, `sales_intelligence_owner_instructions` and `sales_intelligence_policy_*`; all of them are `NEVER_DROP` in [DELETION-MANIFEST.md](../DELETION-MANIFEST.md).

## Issues found

- **No slimming defect was found.** Every retained destination renders, and every retired URL and endpoint behaves as the specification says.
- **The first run had two failures, both caused by my seed, not the product.** Both reads were verified green after reseeding with validated models.
  - `GET sales-intelligence/reps` returned 500 (TypeError in `toRepLinkDto`, `row.history.map`), because the raw-inserted `rep_identity_links` row had no `history`.
  - `GET sales-intelligence/attachments` returned 400 (ZodError on `lead_snapshot.*`), because the raw-inserted `number_lead_attachments` rows had an incomplete `lead_snapshot`.
  - Both shapes were copied from `ops/numbers-slim.replica.test.ts`, which only exercises Numbers list, detail and timeline. Anyone reusing those fixtures for reps or attachments reads must go through `getRepIdentityLinkModel()` and `getNumberLeadAttachmentModel()`.
- **Observation, pre-existing and not caused by the slimming:** with every capture flag off locally, Capture health reads "Call capture is healthy." while it also shows "Call Log sync: off" and "Webhook off". The wording comes from the server's `capture_health.status`, and the copy already existed at `adda9e1`.

## Not covered by this walk

- Daily Operations *behavior* proof: snapshot, events, SSE, close and rebuild. This walk only shows that the board renders and counts the walk's receipts. SLIM-09 requires more.
- Attach and detach commands, the Accounts message, and Admin-role (non-Owner) navigation.
- Any write path that reaches a provider.

## Reproduce

All the files are in the session scratchpad, `…/scratchpad/walk/`.

1. **Seed:** `node run.mjs seed`. It drops and recreates `testvantagemovers_walk09` and `testvantagemovers_walk09admin` on `csi01` only.
2. **Start the server:** `node run.mjs server`, on port 3191.
3. **Build the Admin:** `bash heavy.sh node run.mjs admin-build`, run with at least 3,000 MB available. On this machine 5,030 MB were free before the build, and it took about 2 minutes.
4. **Start the Admin:** `node run.mjs admin-start`, on port 3192.
5. **Walk:** `node walk.mjs` writes `walk-results.json` and `shots/`, then `node probe.mjs` writes `probe-results.json`.
6. **Stop:** stop the two listeners on 3191 and 3192.
