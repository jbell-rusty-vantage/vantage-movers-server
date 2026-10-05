# Sales Outreach Desk — post-slimming implementation plan (sod-v1.1)

Written October 4, 2026 against server `main@ecc76257` and admin `main@058adbc`, after the server/admin slimming was deployed and the production purge ran. **This is the build plan cloud agent teams execute.** It does not change business policy.

## 0. Authority and what this file supersedes

| Question | Authority |
| --- | --- |
| Business rules (cadence, calendar, quoted, callbacks, evidence, goals, roles, eligibility, cutover) | [SPECIFICATION.md](SPECIFICATION.md) §§2–14, 18 and [FINAL-POLICY-REVIEW.md](FINAL-POLICY-REVIEW.md). Unchanged. Fixtures in [contracts/fixtures](contracts/README.md) are the evaluator's test vectors. |
| Visual target | [OWNER-REQUEST.md](OWNER-REQUEST.md) screenshots, SPECIFICATION §5 (V01/V02). The bubbly look of [`references/manager-desk.webp`](references/manager-desk.webp) (and the Rep reference) is required and deliberately differs from the existing Admin dashboard; build it as a route-scoped desk token set, not the current dashboard styling |
| Code paths, reuse, collections, routes, team file ownership, sprint shape | **This file** and [CODE-MAP.md](CODE-MAP.md) (rewritten for the slim code) |
| RingCentral capture, subscriptions, crons, rate budget | [RINGCENTRAL-CAPTURE.md](RINGCENTRAL-CAPTURE.md) (supersedes SPECIFICATION §15 where they differ) |
| Exact HTTP/DTO/config contracts | [CONTRACTS.md](CONTRACTS.md) **as amended by §4–§7 below**. Where this file and CONTRACTS disagree about a collection to reuse, a route, a role or the live transport, this file wins. |
| Cloud team prompts | [workspace/SERVER-TEAM.md](workspace/SERVER-TEAM.md), [workspace/ADMIN-TEAM.md](workspace/ADMIN-TEAM.md) |

Older packet text that says "reuse `outreach_records`", "Outreach ID", "fence `analysis/apply`/`assessment`/`ensure`/`derive`/`worker`", "`/sales-intelligence?view=team`", "`repScope.ts`" or "reuse the Sales Intelligence live stream" is **historical**. Those things no longer exist or have changed (see §1).

## 1. What the slimming changed (read before coding)

Source: `vantage-main-server/docs/server-admin-slimming/NEW-DESK-DELTA.md` and `evidence/HUMAN-FACTS.md` (in the server repo).

| Packet assumption | Reality now |
| --- | --- |
| Outreach subject = `outreach_records` (`outreach_id`) | **Dropped in production.** Also `outreach_followups`, `outreach_rep_days`, `outreach_band_transitions`. No id mapping exists. The desk creates its own subject collection (§4.1). |
| Fence legacy AI/planner producers (D01) | **Done by slimming.** `outreach/*`, `analysis/*`, `assessment/*`, `backfill/*`, `overview/repDays.ts`, `repScope.ts` are deleted; retired job stages are refused at enqueue and acked as retired on late delivery. D01 work for this sprint = one negative regression test (§8, SRV-T). |
| Old assignment (`outreach_records.assignment`) | Dropped. **Assignment = `Lead.receiver_agent`** (user decision 2026-10-04, §3). |
| Admin `/sales-intelligence/outreach/[id]`, `settings-form.tsx`, `use-attention`, `use-sales-features`, `rep-routes/*` | Deleted. Rep accounts reach **no API**; `/sales-intelligence` shows `RepUnavailable`. |
| Manager role | **Does not exist** anywhere (admin roles `owner/admin/rep`; server signed roles `owner/admin/rep`). Must be added (§3). |
| `leadInstant.ts` (Lead timestamp adapter) | Deleted with outreach. **Restore** from git `6a374fab:src/services/salesIntelligence/outreach/leadInstant.ts` (+ `.test.ts`) into the new desk service folder. |
| Legacy `officialClosure` (`transitions.ts`) | Deleted. P05h eligibility is now written fresh in the desk (no legacy consumer to preserve). |
| Contact restrictions | `sales_intelligence_contact_restrictions` kept **inert**: 16 rows, 15 active, all AI-origin; no reader enforces them, no lift command exists. The desk owns their confirm/lift (§7, P06c). Never clear one silently. |
| Review items (12,187 open), Owner instructions (4) | Kept inert. Out of scope for v1 except: the desk must not read them as cadence input. |
| Server `docs/knowledge/environment.md` "missing" | **Exists now.** Read it for env names; do not grep `process.env`. |
| Sales rep tracker (`feat/sales-rep-tracker`) | **Decommissioned 2026-10-04.** Never merged or deployed; the branch and its slice branches are deleted locally and on the remote. Nothing from it is on main. Do not build on it or recover it. |
| Daily Operations | Unchanged; Owner-only (`requireRegistryOwnerActor`). Manager access is new work (§7, SRV-9). |
| CSI policy (`sales_intelligence_policy_*`) | Retained only for staffed clock / capture / nudges / retention. The desk uses its **own** configuration (`sales_outreach_configuration`). |

## 2. Retained building blocks the desk reads

| Fact | Where (server) | Notes |
| --- | --- | --- |
| Lead identity, Job Number, phone, name, move date, received time | `form_leads`, `call_leads` (`job_no`/`normalized_job_no`, `phone_number`/`normalized_phone_number`, `move_date`, `timestamp`) | `timestamp` has mixed conventions → restored `leadInstant` adapter |
| Accepted Granot priority | `granot_priority` (string, digits) + `last_accepted_granot_observation` on the Lead | Written by `granotLifecycle/leadDesiredState.ts` from webhook / extension / HTTP-automation observations; one shared path already |
| Closure facts | Lead `booked`, `cancelled`, `duplicate`, `bad_lead`, `no_sync`; `booked_leads`, `cancelled_leads` | P05h: `no_sync` is **not** a closure for the desk |
| Assignment | Lead `receiver_agent` (+ `_name_snapshot`, `_source`, `_source_value`, `_set_at`) | `manual` source is protected from Granot latest-wins (`receiverReplaceableByGranot`) |
| **Lead change feed** | `entity_changes` (`entity`, `changed_paths`, `revision_before/after`, `applied_at`; index `changed_paths+applied_at`) | Tracks `granot_priority`, `receiver_agent*`, `booked`, `cancelled`, `duplicate`, `bad_lead`, `no_sync`, `job_no`, phone, `move_date`, `timestamp`, creation. Canonical commands + `LeadChangeRecorder` (19 writers) emit it in the same transaction as the Lead write. **The desk's single durable input for Lead changes.** |
| Calls | `call_interactions` (+ `_aliases`) | `parties[].extension_id/direction/answered_at`, `legs[]`, `started_at`, `call_log_state` (`null`/`provisional`/`settled`), `terminal`, `contact_number_id`, `transfer`, `monitoring`, `merged_into_id`, `purged_at`, `projection_revision` |
| Number ↔ Lead association | `number_lead_attachments` (`lead_ref{model,id}`, `state`, `certainty`) | Unique **attached** Lead per number at contact time = associated; `ambiguous`/`candidate`/multiple attached = pending (P05h) |
| Rep identity | `rep_identity_links` (`agent_id` ↔ `rc_account_id`+`rc_extension_id`, effective-dated, `status: reviewed`, `role_kind`) | Credit only `reviewed` + `role_kind: sales_rep` at contact time |
| Rep ↔ admin user | Admin `AdminUser.agent_id` (required for `rep`) → signed `x-vantage-admin-agent-id` | Server has no admin-user table; trusts the signed header |
| Capture coverage | `sales_intelligence_sync_state` (`call_log_all_directions`, `known_complete_through`), `_sync_windows`, `ownerCoverage.ts` | Reuse for the Calls freshness/coverage fields |
| Transactions / idempotency / audit | `executeCsiCommand`, `csiCas`, `sales_intelligence_command_executions`, `sales_intelligence_audit_events`; `services/durableWork/` | Register new command kinds; do not reuse legacy names |
| Jobs / queue / cron | `sales_intelligence_jobs` + Vercel Queue `sales-intelligence-events*` dispatched by `numberActivity/jobDispatch.ts`; crons under `/api/cron/*` with `requireCronAuth` | New desk stages are registered in `config/domain/salesIntelligence.ts` retained-stage list |
| Live transport | `services/salesIntelligence/live.ts` (topic hints, 250 ms coalescing, ~240 s lifetimes) | Reuse the machinery behind a **new scoped endpoint** (§5) |

## 3. Decisions recorded for this plan (user, 2026-10-04)

| ID | Decision | Consequence |
| --- | --- | --- |
| IMPL-01 | **Assigned rep = `Lead.receiver_agent`.** Owner/Manager reassign in the desk writes `receiver_agent` with `receiver_agent_source: "manual"` through a canonical Lead command (EntityChange + audit). | One assignment truth shared with analytics. Granot latest-wins never overrides `manual`. Unassigned = `receiver_agent` null or an Agent with no reviewed `sales_rep` link. Assignment history for P06d responsibility = `entity_changes` on `receiver_agent`. |
| IMPL-02 | **Admin route is `/outreach-desk`**, a "Lead outreach" local shell: `?view=team` (Owner/Manager default), `?view=my` (Rep default; Owner/Manager may add `agent=<id>`), `?view=activity`, `?view=settings` (Owner advanced controls; Manager sees only attendance overrides), plus Owner-only `?view=numbers` and `?view=accounts` (today's Numbers and RingCentral Accounts, moved). Selected lead = `&lead=<subject_id>`. `/sales-intelligence` (and `/sales-intelligence/legacy`) permanently redirect to `/outreach-desk`, mapping `?number=<id>` → `?view=numbers&number=<id>` and `view=reps` → `view=accounts`. | Supersedes SPECIFICATION §4/CONTRACTS "Admin composition" route names. Server API namespace stays `/api/v1/admin/sales-outreach`. |
| IMPL-03 | **New `manager` role** in admin (`ADMIN_ROLES`) and server signed actor. Manager sees only `/outreach-desk` (team/my/activity, attendance overrides) and `/daily`. Generic `admin` gets no desk access (P09c). | Admin: `adminRoles`, `authorization`, `routeGuard`, `trustedProxyHeaders`, users validation/Users tab, nav, layout. Server: trusted actor role set, desk guards, Daily Operations read/stream guard. |
| IMPL-04 | Desk subject key = canonical Lead (`lead_model`+`lead_id`), new collection `sales_outreach_subjects`. "Outreach ID" in the spec = `sales_outreach_subjects._id`. | No legacy id mapping (none exists). |
| IMPL-05 | Lead changes enter through an `entity_changes` tail (durable cursor) + an after-commit wake, with a periodic revision reconcile as the net. | No new hooks in Granot/extension/HTTP-automation write paths. |
| IMPL-06 | Call credit requires a terminal call **present in the Call Log** (`call_log_state` non-null). Webhook-only calls show as `awaiting confirmation`, never as a miss and never as confirmed credit. Settled-state corrections recompute (P07f). | Matches P07a/P07g "final verified evidence"; latency comes from the 1-minute ISync in RINGCENTRAL-CAPTURE.md. |
| IMPL-07 | Number association credits a call/SMS to a subject when the contact number has exactly **one** `attached` Lead (any certainty except `rejected`) that is an active desk subject at contact time. Anything else is `pending association`. | Revisit if `likely` auto-attaches prove noisy in shadow. |

## 4. Server data model (all in the main operational database)

Use `defineCsiModel`/index-registry conventions (`models/salesIntelligence/registry.ts`), `autoIndex: false`, explicit index build scripts (no index writes at startup or in GETs). snake_case fields, UTC instants, `YYYY-MM-DD` business dates in `America/New_York`.

### 4.1 `sales_outreach_subjects` (new)

One per enrolled canonical Lead. Unique `{lead_model, lead_id}`.

`lead_model` (`FormLead|CallLead`), `lead_id`, `enrollment {cohort_id, kind: pilot|intake|expansion, enrolled_at, activation_at, manifest_hash}`, `status` (`active|closed|review`), `review_reasons[]`, `received_at` + `received_date` + `received_quality` + `adapter_version`, `display {job_no, normalized_job_no, phone, normalized_phone, name, move_date}`, `priority {raw, accepted_at, observation_id, basis}`, `assigned_agent_id`, `assignment_revision`, `lead_revision_seen`, `contact_number_ids[]`, `revision`, `updated_at`.

Indexes: `{status, assigned_agent_id, _id}`, `{normalized_job_no}`, `{display.normalized_phone}`, `{lead_revision_seen}`.

### 4.2 `sales_outreach_policy_periods` (CONTRACTS, re-keyed)

`subject_id` replaces `outreach_id`. Otherwise as CONTRACTS: unique active period per `subject_id` (partial `ended_at: null`), unique semantic transition key `{subject_id, transition_key}`; close+open in one transaction; repeated accepted priority = no-op. Fields add `workflow` (`new|quoted|discretion|none|closed`) and `time_basis` (`accepted_observation_captured_at|entity_change_applied_at|activation_boundary`).

### 4.3 `sales_outreach_followup_schedules` (CONTRACTS, extended)

One **active human plan** per subject (P06f): `subject_id`, `period_id`, `kind` (`quoted_date|callback`), `selected_date` (quoted) or `appointment_at` (callback), `due_at`, `window_minutes`, `actor`, `effective_at`, `revision`, `status` (`active|fulfilled|missed|cancelled|replaced|blocked_reschedule`). Unique partial `{subject_id}` where `status: active`. Command/audit history in the CSI command ledger.

### 4.4 `sales_outreach_contact_events` (new; replaces "contact evidence reference")

Normalized per-subject evidence derived from canonical capture. **References**, never copies of calls/messages. Unique `{source_kind, source_id, subject_id}`.

`subject_id`, `source_kind` (`call|sms`), `source_id` (`call_interactions._id` or `ringcentral_rep_sms_evidence._id`), `channel` (`call|sms`), `direction`, `event_at` (P07g: outbound start / inbound handled / SMS sent), `business_date`, `actor_agent_id` (reviewed initiator / handler / sender), `goal_agent_id` (outbound initiator only, else null), `kind` (`outbound_attempt|inbound_answered|inbound_missed|sms_sent|sms_failed|sms_inbound|other`), `verification` (`confirmed|awaiting_confirmation|pending_identity|pending_association|excluded`), `exclusion_reason`, `restricted_at_contact` (bool), `source_revision`, `updated_at`.

Index `{subject_id, event_at}`, `{goal_agent_id, business_date}`.

### 4.5 `sales_outreach_projections` (CONTRACTS, re-keyed)

Unique `subject_id`. Current per-channel requirements (DTO shape in CONTRACTS "Common read data"), `oldest_actionable_due_at`, `next_action_due_at`, `next_evaluation_at`, `last_interaction_at`, `received_at`, `assigned_agent_id`, `workflow`, `priority_raw`, `status_flags` (`needs_contact`, `overdue`, `blocked`, `pending`, `move_date_passed`, `move_date_unknown`, `job_pending`, `advisory_cooldown`), bounded `window_history[]` (last 30 business dates; older summarized into counts), `input_fingerprint`, `configuration_version`, `computed_as_of`, `publication_revision`.

Indexes for every queue sort before paging: `{assigned_agent_id, status_flags.needs_contact, oldest_actionable_due_at, next_action_due_at, received_at, subject_id}`, `{assigned_agent_id, received_at, subject_id}`, `{assigned_agent_id, last_interaction_at, subject_id}`, `{next_evaluation_at}`.

### 4.6 `sales_outreach_rep_day_projections` (CONTRACTS)

Unique `{agent_id, business_day}`; goal snapshot (roster version, schedule, override), `actual_confirmed`, `actual_awaiting_confirmation`, `remaining`, `progress`, `goal_state` (`goal|no_goal_today|not_on_roster`), `coverage`, `input_fingerprint`, `publication_revision`. Counts **all** eligible New/Quoted outbound attempts by the rep that day (full scope, not pilot-only, MANUAL-START "Daily goals during the pilot"); calls to numbers with no eligible subject are counted separately as `unattributed` and excluded from the goal until associated.

### 4.7 `ringcentral_rep_sms_evidence` (CONTRACTS) + SMS sync state

As CONTRACTS, written by the SMS capture in RINGCENTRAL-CAPTURE.md. Per-mailbox cursor/coverage in `sales_intelligence_sync_state` scope `rep_sms:<rc_extension_id>`.

### 4.8 `sales_outreach_configuration` (CONTRACTS, unchanged) and `sales_outreach_enrollment_runs`

Configuration exactly as CONTRACTS (version/pointer CAS, fail closed, no env authority). Add to `transition`: `backfill_lookback_days` (90) and `backfill_include_upcoming_moves` (true) per FAST-01. `sales_outreach_migration_runs/checkpoints` are renamed **`sales_outreach_enrollment_runs`** (one doc per run: manifest hash, selected ids, boundary, mode `report|apply|verify`, results). There is no legacy history to migrate, so enrollment is building subjects from current Lead facts plus provider evidence from the activation date (P10a).

### 4.9 Kept collections the desk writes to

`form_leads`/`call_leads.receiver_agent` via the reassign command (IMPL-01). `sales_intelligence_contact_restrictions` via the new Owner confirm/lift/add commands. Nothing else outside `sales_outreach_*`.

## 5. Server API (amends CONTRACTS "HTTP interface")

Base `/api/v1/admin/sales-outreach`, behind `requireApiSecret`, signed actor, `scope=production`. New guard `requireOutreachActor(roles)`: `owner` (Admin/Owner per P09c), `manager`, `rep` (requires signed `agent_id` with a reviewed `sales_rep` link, else 403 `REP_NOT_LINKED`). Generic `admin` → 403.

CONTRACTS routes stand (`capabilities`, `queue`, `outreach/:id` (id = subject id), `rep-days`, `team`, `configuration` GET/PATCH, `outreach/:id/quoted-followup`, `outreach/:id/callback`, `goals/:agent_id/day-override`). Added:

| Method/path | Who | Purpose |
| --- | --- | --- |
| `PATCH /outreach/:id/assignment` | Owner, Manager | `{expected_revision, agent_id\|null}` + Idempotency-Key → canonical Lead command writing `receiver_agent` (source `manual`) |
| `GET /restrictions`, `POST /restrictions`, `POST /restrictions/:id/confirm`, `POST /restrictions/:id/lift` | Owner | Review/lift the 15 inert AI-origin suppressions and add Owner restrictions (P06c; lifting is Owner-only per P09b) |
| `GET /enrollment/candidates`, `POST /enrollment/report`, `POST /enrollment/apply`, `POST /enrollment/verify` | Owner | Pilot selection (P10b): report = zero writes; apply = selected ids + manifest hash + boundary; verify = reconciliation |
| `GET /live` | Owner, Manager, Rep | SSE, topics `outreach_desk`, `outreach_goal`, `outreach_configuration`, scoped server-side (Rep receives only its own agent's subject/rep-day ids). Reuses `salesIntelligence/live.ts` machinery; separate endpoint because the SI stream is Owner-only and unscoped. |

Daily Operations: change `daily-operations-admin.routes.ts` `GET /`, `/live`, `/events` to admit `owner` **and `manager`**; `POST /rebuild` stays Owner-only.

## 6. Engine

### 6.1 Evaluator (pure)

`src/services/salesOutreach/engine/` — no Mongo, no clock reads. `evaluateSubject(input, policy, as_of) → {requirements, window_history, next_evaluation_at, flags, fingerprint}`.

Input: subject facts, ordered policy periods, active human plan + history, restriction intervals, assignment history (from `entity_changes`), contact events, closures calendar, policy version. **Recompute the active period's whole window history from inputs on every evaluation** (a period is at most months of daily windows; this is cheap). P07f (late evidence removes apparent misses, keeps genuine ones) and P06d (responsibility at the deadline) are then automatic and deterministic. Persist only if the fingerprint changed.

Modules: `calendar.ts` (NY dates, DST-safe opening/closing, working minutes, closures), `newCadence.ts` (P01/P02d–h/P03), `quoted.ts` (P04), `callbacks.ts` (P06e/f), `restrictions.ts` (P06c), `catchup.ts` (P06a), `reentry.ts` (P05a/f), `credit.ts` (P07a–g spacing/window/attribution), `precedence.ts` (P06f), `cutover.ts` (P10a). **Every JSON in `contracts/fixtures/` is a test-vector suite**; add the END-TO-END-RUN §3 table as named tests.

### 6.2 Pipelines and jobs (new job stages in `sales_intelligence_jobs`)

| Stage | Trigger | Work |
| --- | --- | --- |
| `outreach_lead_change` | `entity_changes` tail cron (every minute) + after-commit wake from the reassign/restriction commands | For changed Leads that are subjects (or intake-admissible): update subject facts; apply the priority mapping (P05d) as a period transition; set `dirty` |
| `outreach_contact_change` | After `capture_projection` commits a call; after SMS evidence upserts; minute sweep of `call_interactions` by `projection_revision`/`updatedAt` cursor | Resolve association + rep identity → upsert `sales_outreach_contact_events`; mark subject + `(goal_agent, day)` dirty |
| `outreach_evaluate` | dirty subjects; `next_evaluation_at <= now` (minute cron, bounded pages) | Run evaluator, upsert projection if fingerprint changed, publish `outreach_desk` |
| `outreach_rep_day` | dirty `(agent, day)` incl. older days | Recount from `sales_outreach_contact_events`, upsert, publish `outreach_goal` |
| `outreach_revision_reconcile` | every 5 minutes | Active subjects whose Lead `domain_revision` ≠ `lead_revision_seen` → `outreach_lead_change` (net for any write path that skipped EntityChange) |
| `outreach_intake` | inside `outreach_lead_change` | When `transition.intake_admission_enabled` and a Lead was **created** after `intake_admission_at`: P05e/P05h eligibility → enroll once (`kind: intake`) |

All stages: config pointer read at admission and rechecked before writes (CONTRACTS load semantics); `controls.cadence_shadow_enabled` computes projections without exposing enforcement labels; `controls.cadence_enforcement_enabled` exposes overdue/miss states. Each stage is idempotent and bounded (≤ 100 subjects per page).

### 6.3 Priority mapping (P05d, desk config)

`0` New · `1` Quoted · `3` discretion (no routine cadence) · `5` closed (Booked in Granot) · `7`/`8` closed (CRM disposition) · official Booking → closed · other accepted code → `none` (No policy configured) · missing/malformed on Granot-created Lead → `review`. Native/manual/Best Relocation/RingCentral Call Lead with no accepted priority → New by intake default (P05e). Note: server `quoted` flag is sticky and is **not** cadence authority.

## 7. Work packages

Branches: `feat/outreach-desk` in **both** repos, from current `main`. One integration branch per repo; lanes work on `feat/outreach-desk-<lane>` and merge into it. Only the RELEASE agent merges to `main`, deploys and operates production, under [FAST-TRACK.md](FAST-TRACK.md).

### Server (team SERVER — see [workspace/SERVER-TEAM.md](workspace/SERVER-TEAM.md))

| WP | Lane | Depends | Deliverable | Done when |
| --- | --- | --- | --- | --- |
| SRV-0 | S1 Foundation | — | Branch, replica runtime per `CLOUD_AGENTS.md`, `node docs/sales-outreach-desk/validate.mjs` passes, LEDGER claims | Replica `/db` shows `testvantagemovers` on 127.0.0.1 |
| SRV-1 | S1 | SRV-0 | `manager` in trusted-actor roles; `requireOutreachActor`; Rep link check; Daily Operations reads/stream admit Manager | Route matrix tests: owner/manager/rep/admin/foreign-rep/unsigned |
| SRV-2 | S1 | SRV-0 | `sales_outreach_configuration` model, GET/PATCH, CAS/idempotency, fail-closed, `ops/sales-outreach/install-approved-policy.ts` (writes FINAL-01 values with `approval_ref` through the PATCH path, against a named target only) | Two-instance reload test; invalid/missing → `CONFIGURATION_UNAVAILABLE` |
| SRV-3 | S1 | SRV-1/2 | Models §4.1–4.6, index scripts, subject builder, restored `leadInstant`, eligibility (P05h), priority mapping/periods, `entity_changes` tail + revision reconcile, intake gate, enrollment report/apply/verify (+ CLI wrapper) | Fixtures p05a–h, p10a, p10b pass as tests |
| SRV-4 | S2 Engine | SRV-0 only (pure) | `engine/*` evaluator | All `contracts/fixtures/*.json` + END-TO-END-RUN §3 cases pass; DST/midnight cases |
| SRV-5 | S3 Capture | SRV-0 | RINGCENTRAL-CAPTURE.md changes: minute ISync lane, SMS subscription + mailbox sync + `ringcentral_rep_sms_evidence`, verification token, 10-year expiry cap, Light gate lane; read-only access proof script | Replica tests with provider mocks; proof script ready for the operator |
| SRV-6 | S3 | SRV-3, SRV-5 | Contact-event derivation (association, identity, P07a–g kinds, restricted-contact exclusion), rep-day projection, roster/goals (P08a) | p07a–g, p08a fixtures; transfer/duplicate-leg/monitoring cases |
| SRV-7 | S1 | SRV-3 | Commands: quoted-followup, callback, assignment, day-override, restrictions confirm/lift/add | p04*, p06e/f, p09b fixtures; idempotency replay; 409s |
| SRV-8 | S1 | SRV-3/4/6 | Reads (`capabilities`, `queue`, `outreach/:id`, `rep-days`, `team`), cursor, `GET /live` | Sort/filter over multiple pages; foreign-id 404; reassignment revocation |
| SRV-9 | S1 | SRV-1 | Daily Operations Manager access + SPECIFICATION §14 repairs (Granot-created Lead after-commit hook; overnight confirmation sent-day) | Live vs rebuild agreement tests |
| SRV-T | all | — | Negative regression: no retired job stage enqueued, no model/AI call path reachable from `salesOutreach/*` | Test in CI |

Order for parallel cloud agents: **S1 (SRV-1→2→3→7→8), S2 (SRV-4) and S3 (SRV-5→6) start at the same time.** S2 has no dependencies. S3's SRV-6 waits on SRV-3's models (merge SRV-3's model PR first, early).

### Admin (team ADMIN — see [workspace/ADMIN-TEAM.md](workspace/ADMIN-TEAM.md))

| WP | Depends | Deliverable |
| --- | --- | --- |
| ADM-1 | — | `manager` role end-to-end (roles, Users tab create/edit, routeGuard, nav, proxy signing, layout); Rep home → `/outreach-desk`; delete `RepFrame`/`RepUnavailable` use for the desk |
| ADM-2 | ADM-1 | `/outreach-desk` route + "Lead outreach" shell (sidebar per screenshot: Team overview, My work, Activity, Settings; Owner also Numbers, Accounts), header freshness, redirects from `/sales-intelligence*`, move Numbers/Accounts views unchanged. Ships the route-scoped **bubbly desk token set** from SPECIFICATION §5 (pale blue page, white rounded cards, circular icon badges, pill progress tracks, rounded blue controls, nav pill). This look differs from the existing Admin dashboard on purpose; do not inherit the dashboard's styling |
| ADM-3 | — | `lib/api/salesOutreach.ts` Zod DTOs + local synthetic fixtures (from CONTRACTS + `contracts/fixtures`), `lib/query` keys, mock mode for building before the server lands |
| ADM-4 | ADM-2/3 | My outreach (goal card, tabs New/Quoted, Needs contact/All active, search, sort, queue table, selected panel, Copy job #, quoted date + callback controls) |
| ADM-5 | ADM-2/3 | Team outreach (four cards, Daily call goals table, Leads needing attention, rep filter/Unassigned drill, assign control, compact Operations today strip linking `/daily`) |
| ADM-6 | ADM-3 | Activity view, Settings (Owner: policy/roster/schedules/closures/restrictions/enrollment & intake gate; Manager: attendance overrides) |
| ADM-7 | ADM-1/3 | BFF: Rep/Manager exact proxy allowlist for `/api/v1/admin/sales-outreach/**` (restore the `rep-routes` pattern from `0993e31`), Manager on `/daily` + `/api/daily-operations-live`, new `app/api/outreach-desk-live/route.ts` |
| ADM-8 | ADM-4/5 | Playwright (add as devDependency) visual + flow checks at 1186×742 against both references (`references/manager-desk.webp` for Team, `references/sales-rep-desk.webp` for My); a desk that reads as the existing flat Admin dashboard fails V01 even when functionally correct; keyboard/focus; 403/reassignment cache clearing |

### Verification (team VERIFY, can be the same cloud session at the end)

Integrated replica run of END-TO-END-RUN §3–§5 with provider mocks and a seeded synthetic pilot (≈20 Leads, 3 reps). Record evidence in `workspace/evidence/`.

## 8. Release path

> **Superseded by [FAST-TRACK.md](FAST-TRACK.md) (FAST-01).** Agents deploy with controls on, run the 90-day/upcoming-move backfill and fix forward. M1 Call progress ships first. The steps below are kept as the order of operations; the pilot, shadow day and observation day are dropped.


1. Merge `feat/outreach-desk` server then admin; deploy with all controls false (desk invisible to Reps until `desk_enabled`).
2. Build new indexes (script, reviewed target).
3. Operator runs the read-only RingCentral SMS access proof (RINGCENTRAL-CAPTURE §6). Enable SMS capture.
4. Install approved policy (FINAL-01) via the install script; set roster/schedules; review the 15 inert restrictions.
5. Enrollment report for ~20 selected Leads / 2–3 reps → shadow one working date → apply at 08:00 boundary → observe one full working date (MANUAL-START.md).
6. Enable intake admission; expand existing Leads in reviewed cohorts.

The packet's oplog/replication thresholds (SPECIFICATION §18.5) gate **bulk expansion cohorts**, not the 20-Lead pilot. Measure them before the first cohort larger than a few hundred subjects.

## 9. Open items to watch (not blockers to start)

- **E01 SMS mailbox access** — unproven that the JWT app user may subscribe to and sync other reps' message stores. SMS cadence cannot be enforced until proven; calls and goals do not depend on it.
- Delivered/DeliveryFailed are mostly absent for US carriers → `Sent` is the practical confirmation (P07d already credits Sent).
- `likely` auto-attachments as association (IMPL-07) — measure ambiguity in shadow.
- Generic `admin` users who should be Managers must be re-created/edited as `manager` by the Owner.
