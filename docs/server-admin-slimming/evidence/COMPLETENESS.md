# Completeness review (SLIM-09 critic)

2026-10-04. Reviewer: completeness critic, read-only (no code edited). Inputs: [SPECIFICATION](../SPECIFICATION.md) §9, [IMPLEMENTATION-PLAN](../IMPLEMENTATION-PLAN.md) SLIM-01…11 and §5, the [ledger](../LEDGER.md), [manifest](../DELETION-MANIFEST.md), [runbook](../DATA-AND-STORAGE.md), every file in this folder, and the code on `slim/server-admin`:

| Repo | Committed | Not yet committed |
| --- | --- | --- |
| server | `6a374fab..9007f43f` | wave-3 work: rehearsal tooling (`ops/slimming/lib/rehearsal.ts`, `ops/slimming/rehearsal/**`, `ops/lib/loopback-mongo*`), the Agent index and processed-calls fixes, replica-test fixes, `docs/knowledge/environment.md`, the Service-doc pass, REHEARSAL.md, WALK.md |
| Admin | `adda9e1..cdc9510` | the wave-3 UX fixes (SI dialog CSS, Rep skeleton, stale-cursor replace) and CONTEXT/rules docs. The user's `docs/sales-outreach-desk/**` and `SALES-OUTREACH-DESK.md` edits are not ours. |
| MCP | `fbf061f..97bd755` | `README.md` |

Rule applied: a claim without evidence is **not met**. "Deferred-to-deploy" is used only for steps that need the deployed slim code or production access (SLIM-10/11 and the release sequence).

## Independent re-runs by this review

| Command (from the repo, through `heavy.sh`) | Result |
| --- | --- |
| Server, `node --import tsx --import ./ops/test-setup.ts --test --test-concurrency=2` on `src/services/dailyOperations/*.test.ts`, `admin/noHistoricalDb`, `history/aiRetirement`, `jobs.retire`, `api/queues/sales-intelligence-consumer`, `granotLifecycle/healthState`, `v1-admin-database-scope.routes`, `sales-intelligence-admin.routes`, `sales-intelligence-history.routes`, `granot-lifecycle-admin.routes`, `v1.routes` (`DOTENV_CONFIG_PATH=C:/nonexistent.env`) | **162/162 pass** |
| Server, `node --import tsx ops/numbers-slim.replica.ts` (loopback `csi01`) | **1/1 pass** |
| Server, `node --import tsx ops/test-csi-enqueue-replica.ts` (loopback `csi01`) | **PASS**, including the retired-stage fence |
| Admin, `node --import tsx --test` on `tests/retired-destinations`, `tests/retired-database-scope`, `server/auth/authorization`, `tests/sales-intelligence/{numbers,desk}` | **61/61 pass** |
| `git diff 6a374fab -- src/services/dailyOperations src/models/DailyOperations* src/models/dailyOperationsModelFactory.ts src/config/domain/dailyOperations.ts` | empty (server Daily code byte-identical) |
| `git diff adda9e1` (Admin) Daily files | `lib/api/dailyOperationsBoard.ts`, `components/daily/daily-copy.ts` and their tests: link removal only (Live Events, Observational). No fact, colour, count or timing change. |
| `rg` over the extension and clients repositories for retired routes | 0 callers |
| Replica database listing after these runs | `admin`, `config`, `local`, plus `testvantagemovers_walk09` and `testvantagemovers_walk09admin`, left behind by the WALK lane (not by this review) |

## A. SPECIFICATION §9 completion criteria

| # | Criterion | Verdict | Evidence | What is missing |
| --- | --- | --- | --- | --- |
| 1 | Removed destinations and exclusive server endpoints are unreachable | **met-with-limits** | WALK.md (retired URLs 404 or redirect; HTTP probes 404); `retired-destinations.test.ts`; `v1.routes.test.ts`; `sales-intelligence-admin.routes.test.ts` (re-run green) | Proven locally only; production is deferred to deploy. Server SI endpoints that no kept client calls remain mounted: `GET/PATCH /settings` (its only UI, the SI settings form, was deleted), `GET /nudges`, `POST /nudges/preview`, `POST /reps`, `POST /reps/propose`, `GET /reps/:id` (INTEGRATION-ADMIN wave-2 issue 5). They have not been classified as kept or removed. **Resolved (HARDEN, 2026-10-04):** all six are kept as retained Owner/ops API ([ENDPOINTS.md](ENDPOINTS.md)). |
| 2 | Numbers/Accounts do zero reads/writes against retired collections | **met** | `ops/numbers-slim.replica.ts` with every retired collection absent before and after (REHEARSAL §1; re-run green); `live.ts` watches only retained collections; `aiRetirement.test.ts` scans for dropped collection names | Accounts reads (`/reps`, nudges) are covered by the static scan, not by a replica run. |
| 3 | No server LLM/media/transcription producer, worker or credential dependency remains | **met-with-limits** | S-AI.md; `aiRetirement.test.ts` (re-run green); `ai`, `openai`, `@ai-sdk/*` absent from `package.json`, the lockfile and `node_modules`; 8 AI/media crons gone from `vercel.json` | Credentials (`AI_GATEWAY_API_KEY`, the `SALES_INTELLIGENCE_*` model/STT names) remain in Vercel until deploy. Six gitignored vendor scripts remain in `scripts/dev_ops/ringcentral/` (`transcribe-*`, `sales-intelligence-{ai,text-ai,extract-v2}`), plus `scripts/dev_ops/blob/upload-ringcentral-mp3.ts`. They cannot load now that the packages are gone, but they still exist. |
| 4 | Old queue deliveries cannot resurrect data | **met** (code) / **deferred-to-deploy** (old isolates) | `test:csi:fence:replica` PASS (REHEARSAL §1; re-run green); consumer test 7/7 | Draining old deployments and preview isolates is a release step (plan §3.3–3.4). |
| 5 | Granot Health is truthful through failures and restarts with OperationalEvents absent | **met-with-limits** | `healthState.replica.test.ts` 4/4 and the lifecycle sweep 146/146 (REHEARSAL §1); S-GRANOT.md (unseeded method chosen); Admin "Unknown — warming up" | INTEGRATION-SERVER wave-1 issue 4: a process that misses a write while Mongo is down and is recycled before it reconnects loses its gap marker. 24-hour windows read as unknown for 24 h after cutover. The cutover instant is not recorded yet (deploy). |
| 6 | All retained workflows pass representative end-to-end and invariant regression checks | **met-with-limits** | Full server suite 2599 tests, 0 failures (INTEGRATION-SERVER wave 3); Admin 708 tests, 0 failures, `next build` OK (INTEGRATION-ADMIN wave 3); lifecycle replica 146/146; WALK.md | See §C. No run on a production-shaped dataset. The Admin-role walk, attach/detach, the Accounts message, Reporting delivery and the rep-identity/nudges replica suites were not exercised (local runners not ported). Daily behavior proof is missing. |
| 7 | Daily Operations behavior and collections are untouched | **met-with-limits** | Server Daily code byte-identical (this review's diff); Daily unit tests green; rehearsal verify shows `daily_operations_events/_days` byte-identical through the purge (REHEARSAL §4.4) | The Admin Daily card links were edited (coordinator decision, links only). No before/after behavior proof of snapshot, events, SSE, Arrivals, close or NY rollover. |
| 8 | Historical DB, exclusive namespaces and feature-owned objects are physically absent | **deferred-to-deploy** | Tooling rehearsed (REHEARSAL §4); DELETION-MANIFEST | Checked-in manifest is stale (7 policy drifts; `--apply` refuses it). `testvantagemovers` (48 collections) and `testvantagemovers_dlc01` (38) were never enumerated by name, so possible test aliases of retired collections are unclassified (DATA-AND-STORAGE §1.1 last row). The Blob backup/delete path was never exercised outside unit tests. |
| 9 | Retained storage has measured budgets, bounded retention/arrays/jobs and monitored capacity | **deferred-to-deploy** (nothing built yet) | DATA-AND-STORAGE §5–6 (proposals only) | No 3-year forecast, no tier choice, no capacity alerts or dashboard, no new retention janitors. Granot Health alerts only write log lines; nothing replaces the deleted owner alert e-mail. |
| 10 | Updated source documentation identifies retired capabilities | **met-with-limits** | 7 `status: retired` Service docs; `docs/knowledge/environment.md` "Retired by slimming"; rules files updated | All of it is uncommitted. LEDGER.md still shows waves 2–3 as `pending`, although the README names the ledger as authoritative. Admin `scripts/csi07-local.mjs` (tracked) still sets `SALES_INTELLIGENCE_OUTREACH_ENSURE`, `OBSERVABILITY_*` and `EMAIL_NOTIFICATIONS_*`. The MCP deploy skill is updated (workspace `.agents`). |

## B. Work-package acceptance

| Package | Verdict | Evidence | What is missing |
| --- | --- | --- | --- |
| SLIM-01 inventory | **met** | INVENTORY.md / `inventory.json` (118 main collections classified), HUMAN-FACTS.md, DATA.md, MCP/extension/clients caller checks (S-HIST §45, MCP.md, this review) | Collection names inside the two `testvantagemovers*` databases are not recorded. |
| SLIM-01 baseline fixtures | **not-met** | BASELINE.md holds only typecheck and test counts | No captured retained-workflow fixtures, Health DTO, Daily board snapshot/events or trusted-role baseline. The plan's "Baseline proves the Daily Operations … boundary and captures trusted role behavior" has no artifact. |
| SLIM-02 destinations | **met-with-limits** | WALK.md (Owner and Rep), A-DEST.md, INTEGRATION-ADMIN, tests re-run | No Admin-role walk ("retained navigation works for Owner/Admin"). Exhausted Sheet Sync jobs can no longer be retried from the dashboard (coordinator decision). Owner acceptance of that decision is not recorded. |
| SLIM-03 historical | **met-with-limits** | `noHistoricalDb.test.ts` driver spy, `v1-admin-database-scope.routes.test.ts` (re-run green), WALK probes 400/400/200, Admin `retired-database-scope.test.ts` | "Pagination, duplicate filters, contact search, source granularity and Analytics reconciliation match the production baseline" rests on unit tests, with no baseline-vs-slim output comparison. Deployed historical import jobs: deferred to deploy. |
| SLIM-04 health and OperationalEvents | **met-with-limits** | S-GRANOT.md, S-OBS.md, INTEGRATION-SERVER wave 2 (subsystem deleted, 0 `recordOperationalEvent`), healthState replica 4/4, lifecycle sweep 146/146 including the queued Sheet Sync pass | Reporting delivery, failure scan and invitations were checked by unit tests only, not with the OperationalEvents family absent on a replica. Daily before/after timing proof is missing. Gap-marker residual (A5). |
| SLIM-05 Numbers/Accounts | **met-with-limits** | S-NUM.md, S-NUM-CONTRACT.md, `numbers-slim.replica` PASS (re-run), WALK (none/multiple/resolved/restricted, Recount, Reject) | Restrictions and review items lost their only Owner commands: `POST /restrictions/:id/resolve`, `/review-items/:id/resolve`, `/interactions/:id/contact-type` and `/numbers/:id/open-review` are 404 (S-NUM-CONTRACT line 91 and 159). That contradicts SPEC §7.3 ("ambiguous restriction authority remains … reviewable") and HUMAN-FACTS.md, which says the 16 restriction review items "stay as the Owner's way to confirm or lift each one". Attach, detach, the Accounts message, call-direction variants and the Granot-apply wake were not exercised end to end. |
| SLIM-06 AI/media removal | **met-with-limits** | S-AI.md, S-OUT.md, fence replica PASS, consumer tests, `aiRetirement.test.ts`, history/boundary route tests (run submit 404, scoped key 403) | The enqueue matrix is proven structurally (`enqueueCsiJob` refuses every retired stage), not per producer. There is no "stub vendors and count zero calls under a full kept-workflow run"; a static import scan plus package removal stands in for it. Vendor env removal is deferred to deploy. |
| SLIM-07 legacy model purge (code) | **met** | S-OUT.md (102 files, models, routes, crons deleted); `rg` sweeps in INTEGRATION-SERVER wave 2 | — |
| SLIM-07 human facts | **met-with-limits** | HUMAN-FACTS.md, C4 keeps Owner/Rep rows, rehearsal §4.4 | 358 open follow-ups and 8,696 Outreach assignments survive only in the purge backup ("inert handoff", proposed 30-day expiry). No user or Owner decision accepting their expiry is recorded in LEDGER. Restriction reviewability: see SLIM-05. 12,187 open AI review items remain with no reader and no route. |
| SLIM-07 new-desk coordinator delta | **not-met** | — | SPEC §8 and the plan require the contract delta (AI evidence no longer preserved; old `/outreach/:id` ids unmapped, 404) to go into the new-desk coordinator's next packet release. No such note exists in either repo. The A-SI decision is recorded only in A-SI.md. |
| SLIM-08 Admin audit | **met-with-limits** | A-DEST.md (writers removed, `mongoStore.replica` 5/5), WALK (CSV OK, no "audit" text, only `admin_users` in the auth DB afterwards) | Admin-role login and the refresh/revoke/expired-token paths were not walked (unit tests only). Collection drop: deferred to deploy. |
| SLIM-09 restored isolated dataset | **not-met** | REHEARSAL.md §7: "ran on synthetic data, not a restored production copy" | No run on a restored production-shaped dataset. |
| SLIM-09 retained-workflow + negative tests | **met-with-limits** | §C below; fence and late-queue proof PASS | See §C. |
| SLIM-09 storage and latency/write-rate comparison | **not-met** | REHEARSAL §7 states it was not covered | No measurement. |
| SLIM-09 source/deployment diff review | **met-with-limits** | INTEGRATION-* sweeps | Deployed-revision diff deferred to deploy. Wave-3 work uncommitted. |
| SLIM-09 retained whitelist and drop manifest | **met-with-limits** | DELETION-MANIFEST.md, `policy.ts` `NEVER_DROP` | The JSON manifest is stale (7 drifts) and must be regenerated. `granot_lifecycle_health_state` is protected only by omission. `call_interactions.recordings[].lead_conversation_id` and the `recording_discovery` sub-document (S-AI cross-lane request) are in no cleanup, so pointers into the dropped `lead_conversations` remain. **Resolved (HARDEN, 2026-10-04):** cleanup C7 unsets both, and the purge now refuses a manifest whose scope differs from `policy.ts` ([REHEARSAL.md](REHEARSAL.md) §8). |
| SLIM-09 `pnpm finish-work --provider codex` | **not-met** | no evidence anywhere | Required by the plan for meaningful implementation; never run or reported as skipped. |
| SLIM-09 Admin typecheck/lint/test/build | **met-with-limits** | INTEGRATION-ADMIN wave 3: tsc 0, 708/0 fail, build OK | Lint exits 1 with 18 problems, all baseline. |
| SLIM-09 retired collections stay absent during synthetic cron/queue replay | **met-with-limits** | Fence proof ("no collection created"); WALK post-walk namespace check; rehearsal verify | No cron/queue replay was run against the post-purge rehearsal database. The WALK ran with background flags off. |
| SLIM-09 Daily behavior proof | **not-met** | WALK.md "Not covered: Daily Operations behavior proof" | The plan says "Daily Operations behavior proof is required, not a sidebar screenshot". |
| SLIM-09 manifest backup restore demonstrated | **met** (synthetic) | REHEARSAL §4.6 (count and sha match for a main collection, the Admin audit log and the whole historical DB) | Blob restore not exercised (Blob backup skipped by user decision). |
| SLIM-09 compatibility deployment | **deferred-to-deploy** | LEDGER user decisions | — |
| SLIM-10 physical deletion | **deferred-to-deploy** | Tooling, guards, resume and restore rehearsed (REHEARSAL §3–4) | Regenerate the manifest after quiesce. Production Blob list/delete exercised only by unit tests. `testvantagemovers*` aliases unclassified. Five `unknown` historical-import collections (`historical_backfill_*`, `historical_api_backfill_checkpoints`, `data_migration_runs`, `granot_backfill_deliveries`) await a decision. |
| SLIM-11 storage budgets | **deferred-to-deploy** | — | No deliverable exists: forecast, tier, alerts, dashboard, janitors, maintenance/restore owner. |

## C. Retained-workflow acceptance matrix (plan §5)

| Scenario | Verdict | Evidence | Gap |
| --- | --- | --- | --- |
| Public Form Lead, duplicate, bad lead | met-with-limits | full unit suite; lifecycle sweep pass 2 (Sheet Sync queued) | No end-to-end run through the public route with CRM, Sheet Sync and SMS ordering on a replica. |
| Qualified inbound Call Lead + polling fallback | met-with-limits | `callLead.service.test`, `callLeadConvergence.replica` in the sweep | The convergence replica test needed seed fixes; no polling end-to-end run. |
| Granot webhook + extension + HTTP Automation | met | lifecycle sweep 146/146; WALK posted 2 real webhooks | — |
| Intake finalization, Release review, requeue, No Action | met | lifecycle sweep (operations, drainer requeue provenance, release) | — |
| Manual create, exact-job Booking, Leadless connect | met-with-limits | `connectBookingToLead.replica`, `bookingOwnerCommands` queued pass | Seeds were stale and fixed; no UI end-to-end run. |
| Booking update/delete, Cancellation create/delete | met-with-limits | unit suite | No replica or end-to-end proof. |
| Daily snapshot/events/live/Arrivals/solo lane/close | **not-met** | unit tests; code unchanged | No same-counts/metrics/colours behavior proof, reconnect/backfill or NY rollover. |
| Job Timeline | met-with-limits | WALK renders; unit tests | No link audit beyond tests. |
| Analytics/Overview | met-with-limits | WALK totals render; historical/combined 400 | No production-baseline totals comparison. |
| Reporting/Registry/Ingestion/Extension | met-with-limits | unit suite; WALK renders; catalog/agents 200 | Reporting delivery/retry was not run. |
| Numbers/Accounts | met-with-limits | numbers-slim replica (re-run); WALK | See SLIM-05. |
| Auth/CSV/invitations | met-with-limits | WALK CSV; no audit collection; `mongoStore.replica` | Admin role not walked; invitation e-mail only by unit tests. |
| Legacy cron/job/queue/run submission | met | fence replica PASS (re-run); run submit 404, scoped key 403; retired crons gone from `vercel.json` | — |

## D. Still present that the specification says to remove or resolve

1. **Server endpoints with no kept caller:** `GET/PATCH /sales-intelligence/settings`, `GET /nudges`, `POST /nudges/preview`, `POST /reps`, `POST /reps/propose`, `GET /reps/:id`. They need an explicit keep-or-remove decision. *Resolved: all kept ([ENDPOINTS.md](ENDPOINTS.md)).*
2. **Dangling pointers into dropped collections that no cleanup covers:**
   - `call_interactions.recordings[].lead_conversation_id` and the `recording_discovery` sub-document (S-AI asked for both to be unset; C1–C6 do not include them). *Resolved: cleanup C7.*
   - `owner_rep_nudges.outreach_record_id` (7 rows) and the schema fields `outreach_record_id`, `expected_outreach_revision`, `outreach_state`, purpose `call_suggestion`.
   - `sales_intelligence_review_items.evidence_ids` on 12,187 open AI-generated items, with AI-only `cause_kind` values still in the enum.
3. **Restriction and review authority:** no Owner command can resolve a restriction or review item. Either restore a minimal resolve command or amend HUMAN-FACTS and SPEC §7.3 with an explicit decision.
4. **Gitignored local scripts:** 55 files import deleted modules. Six AI vendor scripts and one Blob audio uploader remain. None is tracked or loadable, but they are not removed.
5. **Admin `scripts/csi07-local.mjs`** (tracked) still sets retired env names.
6. **Vercel environment names** listed in `docs/knowledge/environment.md` "Retired by slimming" (deploy step), and `SALES_INTELLIGENCE_SCOPED_KEY_NAME` with its `VANTAGE_SCOPED_API_KEYS` entry once no caller sends the key.
7. **Transitional code with removal conditions:** `@vercel/blob` and `BLOB_READ_WRITE_TOKEN` (purge only, reclassify after SLIM-10); `CSI_RETIRED_POLICY_FIELDS` carry-forward; Admin `lib/state/database-scope.tsx` cleanup; `/sales-intelligence/legacy` and `/granot-lifecycle/receipts` redirects. These are intended, but each needs a recorded removal condition in LEDGER.
8. **Replica hygiene:** `testvantagemovers_walk09` and `testvantagemovers_walk09admin` are still on `csi01`.

## E. Release blockers this review would hold

- Commit the wave-3 working-tree changes in server, Admin and MCP. Leave the user's sales-outreach-desk edits out.
- Run `pnpm finish-work --provider codex`, or record why it is skipped.
- Decide restriction and review-item reviewability (D3).
- Record the new-desk coordinator delta (SLIM-07).
- Produce the Daily behavior proof, the production-shaped rehearsal, and the storage and latency comparison, or obtain an explicit user waiver for each.
- Update LEDGER.md wave 2 and wave 3 status.
