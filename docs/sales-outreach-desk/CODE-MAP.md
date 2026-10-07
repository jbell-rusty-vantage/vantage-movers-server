# Code map — post-slimming (re-inspected 2026-10-04)

Server `vantage-main-server` `main@ecc76257` (jbell-rusty-vantage/vantage-movers-server). Admin `vantage-admin` `main@058adbc` (jbell-rusty-vantage/vantage-admin). Both after the server/admin slimming deploy and production purge. Re-pin your cloud checkout's SHA before work. The pre-slimming map (server `becf8de`, admin `0993e31`) is obsolete; see [IMPLEMENTATION-PLAN.md](IMPLEMENTATION-PLAN.md) §1 for what changed.

Paths are relative to the named repository.

## Server — existing code to read or extend

| Path | Use |
| --- | --- |
| `docs/server-admin-slimming/NEW-DESK-DELTA.md`, `evidence/HUMAN-FACTS.md` | What was purged and what the desk inherits (restrictions, review items, Owner instructions) |
| `docs/knowledge/environment.md`, `CLOUD_AGENTS.md`, `.cursor/scripts/start-api.sh` | Env inventory, replica runtime, how to start/verify the API |
| `src/models/FormLead.ts`, `src/models/CallLead.ts`, `src/models/granotLifecycleSchemas.ts` | Lead facts: `granot_priority`, `receiver_agent*`, closures, `job_no`, phone, `move_date`, `timestamp`, `domain_revision` |
| `src/models/EntityChange.ts`, `src/services/domainCommands/{entityChange,leadChangeEmission,index,leads}.ts` | Lead change feed (`entity_changes`) and canonical command executor; add the reassign command here |
| `src/services/granotLifecycle/{leadDesiredState,processor,normalization}.ts` | How priority and `receiver_agent` are accepted; `receiverReplaceableByGranot` protects `manual` |
| `src/models/CallInteraction.ts`, `src/models/salesIntelligence/capture.ts` | Canonical calls, aliases, sync state/windows, directory snapshots |
| `src/services/numberActivity/{capture,interactionProjection,reconcileCallLog,callLogClient,callLogRefresh,jobDispatch,timeline,staffedClock}.ts` | Capture pipeline; `timeline.ts:191-202` is today's read-time rep attribution |
| `src/services/ringcentral/{webhook-subscriptions,webhook-subscription-lifecycle,rateLimitGate,auth}.ts`, `src/routes/ringcentral-webhook.routes.ts`, `src/services/numberActivity/webhookFanout.ts` | Subscriptions, webhook receipt, fan-out, rate gate ([RINGCENTRAL-CAPTURE.md](RINGCENTRAL-CAPTURE.md)) |
| `src/models/ContactNumber.ts`, `src/models/NumberLeadAttachment.ts`, `src/services/salesIntelligence/attachment/*` | Number ↔ Lead association |
| `src/models/RepIdentityLink.ts`, `src/services/salesIntelligence/repIdentity/{resolve,reads,commands}.ts` | Reviewed effective-dated Agent ↔ RingCentral extension |
| `src/models/salesIntelligence/review.ts` | `sales_intelligence_contact_restrictions` (inert, 15 active AI-origin), review items, Owner instructions |
| `src/models/salesIntelligence/{registry,infrastructure}.ts` | `defineCsiModel`, jobs, audit events, command executions |
| `src/services/salesIntelligence/{transactions,auth,live,jobs,ownerCoverage,coverageDto}.ts` | Command/CAS/idempotency, signed actor (`requireCsiOwner`), SSE machinery, job enqueue/claim/recovery, capture coverage |
| `src/services/operationsRegistry/trustedActorCanonical.ts` | Signed actor headers; add `manager` |
| `src/config/domain/salesIntelligence.ts` | Retained/retired job stage lists, flags; register new desk stages |
| `src/routes/{sales-intelligence-admin,sales-intelligence-boundary,sales-intelligence-cron,daily-operations-admin}.routes.ts`, `src/app.ts`, `vercel.json` | Router registration patterns, cron guard, Daily Operations guard (`requireRegistryOwnerActor`) |
| `api/queues/sales-intelligence-consumer.ts` | Queue consumer → `jobDispatch` |
| `src/services/dailyOperations/{recordDomainFacts,recordGranotFacts,rebuild,snapshot,liveStream}.ts` | Daily Operations; SPECIFICATION §14 repairs |
| `src/services/durableWork/` | Generic leases/checkpoints |
| git `6a374fab:src/services/salesIntelligence/outreach/leadInstant.ts` (+ test) | **Restore** the Lead timestamp adapter into `src/services/salesOutreach/` |

## Server — new code (target)

`src/services/salesOutreach/` (`engine/`, `subjects/`, `evidence/`, `goals/`, `commands/`, `reads/`, `enrollment/`, `config/`, `jobs/`), `src/models/salesOutreach/`, `src/validation/v1/salesOutreach.ts`, `src/routes/sales-outreach.routes.ts`, `src/routes/sales-outreach-cron.routes.ts`, `src/services/ringcentral/repSms/`, `ops/sales-outreach/*`, `ops/ringcentral/prove-rep-sms-access.ts`. Collections and routes: [IMPLEMENTATION-PLAN.md](IMPLEMENTATION-PLAN.md) §4–§5.

## Server — Outreach lifecycle repair additions (deployed 2026-10-06, `main@6b585f5b`)

Built on the desk (`main@7e68a117`) in waves 0–3 plus the SMS-coverage hotfix `521d0fff`. The lifecycle overview is the server Reference doc `docs/knowledge/sales-outreach-lifecycle.md`; per-module detail is the Service doc `docs/knowledge/services/sales-outreach-desk.md`.

| Path | Use |
| --- | --- |
| `src/services/salesOutreach/config/timing.ts`, `config/fixtures/configuration-revision-5.json` | `deskTimingOf()`: the only reader of the capture tolerances and `operations.evaluate_drain_*` (code defaults in `DESK_TIMING_DEFAULTS`); the revision-5 fixture guards the R0 hash rule (A0) |
| `src/services/salesOutreach/evidence/coverage.ts` | `loadCallWatermarks`, `cadenceCallCoverage` (verdicts), `goalCallCoverage` (counts, D-A3), `smsCoverage` over the current reviewed mailboxes (A3, hotfix) |
| `src/services/salesOutreach/reads/freshness.ts` (changed) | "Calls updated" from the ISync/reconcile successes and the newest call webhook; `reason` values; `freshness.sms.pending` (A3-fresh, C7) |
| `src/services/salesOutreach/engine/**` (changed, `sod-engine-v2`) | status ladder `due` + unverified, narrowed `pending`, `coverage_wait`, quiet closed rows, seeded spacing anchor (A1, A4, A6) |
| `src/services/salesOutreach/evaluation/evaluateJob.ts` (changed) | evaluate cron coverage repair (`…:coverage:<channel>:<wait ms>:<bucket>`), existing-job skip, configured drain (A1, A5) |
| `src/services/salesOutreach/subjects/{feed,leadChangeJob,sync}.ts` (changed) | tail loop (B10), decision reconcile and `decision_fingerprint` (B2), late first period (B1), admission hold and 15-minute re-check (B8), automatic expansion admission (B6), C4 contact wakes |
| `src/services/salesOutreach/enrollment/admissions.ts` | `GET /enrollment/admissions` read over the job ledger (B8); `POST /enrollment/verify {cohort_id}` lives in the enrollment service (B6) |
| `src/services/salesOutreach/contacts/smsPending.ts`, `src/services/ringcentral/repSms/remap.ts` | SMS pending counters on `rep_sms:<extension>` rows; `rep_sms_remap` job re-mapping 7 days of SMS identity after an Accounts change (C7) |
| `src/services/salesOutreach/contacts/{derive,repDay,repDayService}.ts` (changed) | `association_reason`, both count scopes, `other_outbound` breakdown, zero-activity rows, count scope from `goals.count_scope_schedule` (C1a, C1b, C5, C8) |
| `src/services/salesOutreach/roster/{rule,store}.ts` (new, P08a-1 F1/F2) | the effective roster: `explicit` (configured list) or `desk_reps` (active Agents with a reviewed `sales_rep` link at the roster instant, joined to per-rep settings; `roster-desk-…` version digest); `findDeskRepsAt` / `isDeskRepAt` (links × `Agent.active`, the credit resolver's authority rule) |
| `reads/service.ts`, `reads/goals.ts`, `reads/store.ts`, `contacts/repDay.ts`, `contacts/repDayService.ts`, `contacts/sweep.ts`, `commands/dayOverride.ts`, `subjects/store.ts`, `commands/store.ts`, `auth.ts` (changed, P08a-1) | rows and team sums from the effective roster (+ `team.roster`, Owner `goals.other_callers`); snapshots and C5 zero rows frozen with it; day-override membership; assignment, reassignment targets and Rep access require a desk rep |
| `src/services/operationsRegistry/catalogRegistry.ts` (changed, P08a-1) | Agent activation/deactivation enqueues the desk re-sync of the Agent's open subjects (`agentWake.ts`) in the registry transaction and publishes `outreach_desk` after commit |
| `ops/sales-outreach/{install-approved-policy,recount-rep-days,roster.replica}.ts` (changed / new, P08a-1) | installer seeds desk reps only; the recount materializes each past day's own effective roster; replica proof of the join, the recount and the activation hook |
| `src/services/numberActivity/leadContactNumber.ts` (replaces `formLeadNumber.ts`) | the Lead's `lead_link` job mints its Contact Number, Call Leads included; the one phone rule for the mint, the diagnostic and `no_contact_number` (C2b, CW1) |
| `src/services/ringcentral/webhook-subscription-lifecycle.ts`, `subscriptionHealth.ts`, `src/routes/ringcentral-webhook.routes.ts` (changed) | drifted `calls` plans `update`; a `PUT` never mints a token; `replace`; refusal counter and `deliveries_refused` health (C6, CW2) |
| `ops/sales-outreach/desk-state.ts` + `ops/lib/sales-outreach-desk-state.ts` | read-only production snapshot used for every acceptance check (OPS-0) |
| `ops/sales-outreach/{settle-pre-cc04-calls,repair-late-first-periods,subjects-without-numbers,recount-rep-days,rederive-contact-events}.ts` + `ops/lib/sales-outreach-*.ts` | one-off and repeatable repairs (C3, B1, C2a, C1b/C5, C8); `pnpm outreach:*` scripts |
| `ops/numbers-v2/mint-lead-numbers.ts` + `ops/lib/numbers-mint-lead-numbers.ts`; `ops/lib/numbers-v2-desk-resync.ts` | Lead number backfill (C2b); `desk-resync --all-open` after a rule PATCH (C2c) |
| `ops/lib/ringcentral-subscription-repoint.ts` | refuses to re-point the production `calls` subscription to another address (CW0) |
| New job stage `rep_sms_remap`; new dedupe variants `sod:lead-change:…:decision:<fp16>:c<rev>`, `…:hold:<bucket>`, `…:admission:r<rev>`; `sod:evaluate:…:coverage:…` | registered in `config/domain/salesIntelligence.ts` / `jobDispatch.ts`; drained by job recovery and the desk crons |
| New indexes | `form_leads.sod_form_lead_move_date` (B7), `sales_outreach_projections.sod_projection_coverage_wait_call` / `_sms` (A1), `sales_outreach_subjects.sod_subject_cohort` (B6), `sales_outreach_contact_events.sod_contact_kind_verification_event` (C7); `pnpm outreach:indexes` |

## Admin — existing code to read or extend

| Path | Use |
| --- | --- |
| `.cursor/rules/project-organization.mdc`, `AGENTS.md` (Next 16 — read `node_modules/next/dist/docs/` first) | Structure and boundaries |
| `server/models/{adminRoles,AdminUser}.ts`, `server/users/*`, `components/operations-registry/users/*` | Roles (`owner/admin/rep`) and user create/edit — add `manager` |
| `server/auth/{authorization,routeGuard,trustedProxyHeaders,proxyForwardHeaders}.ts`, `app/api/proxy/[...path]/route.ts`, `proxy.ts` | ACL, page guard, signed headers, BFF |
| git `0993e31:server/auth/rep-routes/*` | Pattern for exact Rep method+path allowlists |
| `app/(dashboard)/layout.tsx`, `components/sales-intelligence/rep/rep-frame.tsx`, `components/layout/dashboard-nav.tsx` | Shell, Rep frame, sidebar |
| `app/(dashboard)/sales-intelligence/*`, `components/sales-intelligence/{numbers,desk,data,primitives,atoms,lib}/*`, `reps.tsx`, `message-account-panel.tsx`, `styles/sales-intelligence.css` | Today's Numbers + RingCentral Accounts (move under `/outreach-desk`); reusable primitives (eastern time, paging, live indicator) |
| `app/api/sales-intelligence-live/route.ts`, `server/sales-intelligence-live.ts`, `lib/query/salesIntelligence.ts` | Live BFF pattern for the new outreach stream |
| `app/(dashboard)/daily/page.tsx`, `components/daily/*`, `app/api/daily-operations-live/route.ts` | Daily Operations; open to Manager |
| `app/globals.css`, `components/ui/*`, `components.json` | Tokens (Tailwind v4), thin shadcn set; `recharts` available; no animation library |
| `next.config.ts` | Permanent redirects (`/sales-intelligence*` → `/outreach-desk`) |

## Admin — new code (target)

`app/(dashboard)/outreach-desk/*`, `components/outreach-desk/*` (shell, team, my, activity, settings, copy file `outreach-desk-copy.ts`), `lib/api/salesOutreach.ts`, `lib/query/salesOutreach.ts`, `app/api/outreach-desk-live/route.ts`, `server/auth/rep-routes/outreach.ts` (+ manager routes), `tests/outreach-desk/*`, `e2e/` (Playwright).

## Collections

Kept and read: `form_leads`, `call_leads`, `booked_leads`, `cancelled_leads`, `entity_changes`, `granot_observations`, `call_interactions`, `call_interaction_aliases`, `contact_numbers`, `number_lead_attachments`, `rep_identity_links`, `ringcentral_directory_snapshots`, `sales_intelligence_sync_state`, `_sync_windows`, `_jobs`, `_command_executions`, `_audit_events`, `sales_intelligence_contact_restrictions`, `ringcentral_webhook_events`, `ringcentral_webhook_subscriptions`, `ringcentral_rate_limit_gates`, `lead_messages` (automated texts; never rep credit).

Dropped (do not read, do not recreate): `outreach_records`, `outreach_followups`, `outreach_rep_days`, `outreach_band_transitions`, `lead_conversations`, `intelligence_*`, `move_assessment_artifacts`, Attention snapshots/artifacts, AI budget/reservations.

New: `sales_outreach_configuration`, `sales_outreach_subjects`, `sales_outreach_policy_periods`, `sales_outreach_followup_schedules`, `sales_outreach_contact_events`, `sales_outreach_projections`, `sales_outreach_rep_day_projections`, `sales_outreach_enrollment_runs`, `ringcentral_rep_sms_evidence`.

## D01 status

The AI/LLM/transcription/assessment/planner producers that D01 asked to fence were deleted by the slimming; retired job stages are refused. The desk adds only deterministic code and one regression test that keeps it that way (IMPLEMENTATION-PLAN SRV-T). MCP stays separate.
