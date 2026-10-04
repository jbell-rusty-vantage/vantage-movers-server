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
