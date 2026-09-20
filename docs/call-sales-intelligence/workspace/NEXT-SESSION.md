# Next agent session — one task: CSI-15 only

This is Team F implementation. It is **not** CSI-16 certification, production backfill, flag enablement, live send, or CSI-14 dialogs.

Copy the prompt below into the next session. Subagents are allowed. Prefer Cursor Grok 4.6. Cursor quality / `finish-work` may use Grok 4.6, Auto, or Composer 2.5 only — never a GPT model.

CSI-16 has its own later prompt: [CSI-16-SESSION.md](CSI-16-SESSION.md). Do not start it here.

> One task: implement **CSI-15 only** — historical backfill windows, retention, and budget/recovery integration. Team F. Dependencies CSI-02/06/12/13 are locally on `main`. CSI-09 Coverage currently returns a non-executable backfill notice (`available: false`). Named-subject seed is done and is **not** fleet backfill: two official-closed booked Outreach rows, zero Number Activity. Packet: `docs/call-sales-intelligence/workspace/evidence/named-subjects/`.
>
> Inspect remotes and dirty files first. All three remotes must stay `jbell-rusty-vantage`: server `vantage-movers-server`, Admin `vantage-admin`, MCP `vantage-movers-mcp`. Work on local `main` (it already contains the merge). Do not create or switch to `sales-intelligence`. Expected HEADs at briefing: server `d55f6c2b1eb2bed276d0b5bc8c6d2a5bc065fd7c` (in sync with origin); Admin `d82d3de45f56800378d223e7535688f4f0660366` (1 ahead of origin — CSI-09, do not reset); MCP clean `9a8fd37bf78f8074011fb2d47ff3da3ec400b33d`. MCP stays untouched unless a contract field truly requires it; claim that first. Never force-push. Never skip hooks. Do not write `.env` or paste `ADMIN_SEED_*`. Do not point 3107/3108 at Atlas.
>
> Claim CSI-15 in `LEDGER.md` before source edits. Use [HANDOFF-TEMPLATE](HANDOFF-TEMPLATE.md). New packet: `docs/call-sales-intelligence/workspace/evidence/csi-15/{INTAKE,SOURCES,FILES,CHECKS,REVIEW,HANDOFF}.md`.
>
> **Do not** enable `NUDGE_ENABLED`, `STT_ENABLED`, `EXTRACTION_ENABLED`, `BACKFILL_DAYS`, capture/media/outreach flags in Vercel or `.env`. Do not apply `migration:csi:indexes`. Do not `POST /backfill` against production. Do not create a production subscription, send a nudge, or call paid Gateway/STT. Do not start CSI-14 fuller dialogs, CSI-16 certification/G6 probe, or live send. The CSI-10 empty-recording repair (`repIdentity/worker.ts` still gates on `call.recordings.length`) stays out unless a CSI-15 replica scenario cannot prove delayed-recording discovery without it; if you take it, claim it as that CSI-10 follow-up before editing.
>
> ## Read in this order (server-relative unless prefixed)
>
> 1. `docs/call-sales-intelligence/workspace/{SPRINT-PLAN,LEDGER,CONTRACTS}.md`
> 2. `docs/call-sales-intelligence/workspace/teams/f-integration.md`
> 3. `docs/call-sales-intelligence/workspace/evidence/named-subjects/{AUTHORIZATION,HANDOFF,CHECKS}.md`
> 4. `docs/call-sales-intelligence/06-delivery-plan-and-acceptance.md` CSI-15 row and §3 History / Budget
> 5. `docs/call-sales-intelligence/03-server-pipeline-and-jobs.md` §3.1, §11 backfill/retention crons, §12 retention, §14 backfill-complete and budget-increase rows
> 6. `docs/call-sales-intelligence/02-domain-models.md` §12 `SalesIntelligenceSyncWindow`, §13 budget
> 7. `docs/call-sales-intelligence/04-server-routes.md` `POST /backfill`, Coverage, `ORIGINAL_EVIDENCE_UNAVAILABLE`
> 8. `docs/call-sales-intelligence/01-specification.md` historical fulfillment / official closure / no revived overdue
> 9. `docs/call-sales-intelligence/05-owner-dashboard-ux.md` Coverage/budget/backfill copy
> 10. `docs/knowledge/services/{sales-intelligence-foundation,number-activity-reads,sales-intelligence-outreach,sales-intelligence-analysis,sales-intelligence-live}.md`
> 11. Shared `CONTEXT.md` and `docs/agents/domain.md`
>
> Historical documents do not authorize production backfill. `RINGCENTRAL-CAPABILITY.md` is a September 14–15 probe, not a current grant.
>
> ## Start from these seams — do not rebuild them
>
> | Concern | Start here |
> | --- | --- |
> | Window model / unique `{stream,window_from}` | `src/models/salesIntelligence/capture.ts` `SalesIntelligenceSyncWindow` |
> | Plan command schema | `src/validation/v1/salesIntelligence.ts` `csiBackfillCommandSchema` (`plan_backfill`, `from` < `to`, reason) |
> | Owner HTTP | `src/routes/sales-intelligence-admin.routes.ts` — register `POST /backfill`; Idempotency-Key; `scope=production` only |
> | Capture pages | `src/services/numberActivity/reconcileCallLog.ts` `runCallLogReconcileOnce` — source `"backfill"`; live reconcile lease wins; no qualified-call helper |
> | Outreach / no revived overdue | `src/services/salesIntelligence/outreach/**` — later fulfillment/official Booked/Cancelled reconcile before a historical promise can become current work |
> | Analysis priority | `src/services/salesIntelligence/analysis/run.ts` mode `backfill` is lower priority than current work |
> | Budget resume | `src/services/salesIntelligence/aiBudget.ts` `initializeCsiBudgetPeriod` / `reserveCsiBudget` / `reconcileCsiBudget` |
> | Purge-aware reads | CSI-18 `analysis/ownerReads.ts` / `ownerReanalysis.ts` already tombstone purged evidence |
> | Coverage honesty | `src/services/salesIntelligence/ownerCoverage.ts` — replace the hardcoded `available: false` notice with stored window/watermark facts; unknown ≠ zero |
> | Cron/queue | `src/routes/sales-intelligence-cron.routes.ts`, `vercel.json` — `/api/cron/sales-intelligence-backfill-step` `*/15` lease `backfill` when `SALES_INTELLIGENCE_BACKFILL_DAYS > 0`; `/api/cron/sales-intelligence-retention` `30 4 * * *` lease `retention` always (no-op when disabled) |
> | Job stages | already in `CSI_JOB_STAGES`: `backfill`, `retention`. Error `BACKFILL_ACTIVE` already exists. `BACKFILL_DAYS` is a day count, not a `csiFlag` boolean — do not invent `SALES_INTELLIGENCE_BACKFILL`. |
>
> ## Required behavior
>
> 1. **Backfill.** Owner `POST /backfill` plans daily windows into `sales_intelligence_sync_windows` (`planned`). Default `SALES_INTELLIGENCE_BACKFILL_DAYS=0` plans nothing. Cron steps the oldest `planned|partial` window with a per-page checkpoint. `complete` only after the last page. `known_complete_through` never moves backwards. Live capture/reconcile jobs outrank window work; do not hold the reconcile lease and a backfill page as one critical section. After a window completes, reconcile later known activity **before** activating historical Outreach obligations. A fulfilled callback or official Booked/Cancelled must not create fresh overdue first-action / missed-callback / going-cold. Timeline must not present a backfilled old promise as a promise created today. Recordings older than provider retention are `no_recording`, labelled, not zeros. Coverage.backfill is Owner-triggered, range-limited, and reports planned/partial/complete/failed plus gaps — never mock success.
> 2. **Retention.** Daily cron purges per 03 §12 / policy defaults: audio Blob 90 days (`media.purged_at`), redacted transcript/segments/findings/prompts/tool responses/summaries 365 days, activity 730 days. Leave non-content audit tombstones. Never copy a purged transcript into a later prompt or “latest” evidence view. Original-evidence rerun is `ORIGINAL_EVIDENCE_UNAVAILABLE`. Privileged raw deletes stay outside application immutability hooks. Retention values are engineering defaults, not legal advice.
> 3. **Budget and recovery.** Integrate expired lease, missing queue wake-up (Mongo job remains authoritative; cron recovers), throttled provider (`Retry-After`, no retry-budget burn), permission pause, dead-letter at the failed stage, and resume of budget-paused jobs when the ceiling rises or the period activates. Admission pause is not a generic failure. Real-time STT/analysis keeps priority over backfill-mode jobs. Raising the cap resumes the saved stage; it does not duplicate STT or effects.
>
> Admin: if Coverage/settings must display the new backfill DTO, adapt CSI-09 `coverage-view.tsx` / `ownerCoverageSchema` only. Hide or mark unavailable controls the server does not return. No new CRM. No production-backed UI walk as CSI-15 proof.
>
> ## Proof (synthetic only)
>
> Isolated replica (`csi01` / `127.0.0.1:27189`, disposable `testvantagemovers_csi15…`). Fake Call Log / Blob / budget. Required replica cases: plan is idempotent per key; live job priority; window resume after crash/lease expiry; later fulfillment/official close prevents overdue from an old promise; retention tombstones audio+transcript+prompt copies and blocks original-evidence rerun; budget exhaust pauses analysis only; ceiling increase resumes the same stage; missing wake-up recovers from Mongo; throttle/permission do not burn the eight-attempt budget. Server typecheck + focused lint + focused tests. Admin typecheck + focused tests if you touch it.
>
> Finish with the CSI-15 packet, exact files, checks, and Coverage DTO change. Stop. Do not start CSI-16. No commit or push unless the Owner asks.
