---
okf_version: "0.2"
type: Service
title: Sales Outreach Desk
description: Deterministic Lead outreach desk (sod-v1) — desk roles and guard, persisted versioned configuration, desk collections and their index build, and the pure cadence engine. Built in lanes; this doc grows per lane.
status: draft
stale_after: 2026-11-04
tags: [sales-outreach-desk, sales-intelligence]
resource: src/services/salesOutreach/
applies_to:
  - src/services/salesOutreach/**
  - src/models/salesOutreach/**
  - src/routes/sales-outreach.routes.ts
  - src/validation/v1/salesOutreach.ts
  - src/config/domain/salesOutreach.ts
  - ops/sales-outreach/**
owners: [team:main-server]
---

# Sales Outreach Desk (sod-v1, draft)

The build contract is the packet in [`docs/sales-outreach-desk/`](../../sales-outreach-desk/README.md): start at [IMPLEMENTATION-PLAN.md](../../sales-outreach-desk/IMPLEMENTATION-PLAN.md). Business rules are SPECIFICATION §§2–14 and FINAL-POLICY-REVIEW; this doc describes only what is built. The desk is deterministic code: no LLM, transcription, summaries or AI suggestions (D01).

## S1 — foundation (phase 1: roles, configuration, models)

### Roles and the guard (SRV-1)

- The admin proxy may sign `owner`, `admin`, `manager` and `rep` (`TRUSTED_ADMIN_ACTOR_ROLES`). `manager` uses the seven-line payload; `rep` adds its Agent line. Signing a role grants nothing by itself: the registry still admits only `owner`/`admin`.
- `requireOutreachActor(roles)` (`src/services/salesOutreach/auth.ts`) resolves the desk actor from the signed headers only:
  - `owner` — the signed Owner, verified like every Owner surface (P09c: "Admin" in this feature means the Owner);
  - `manager` — a signed manager (`requireCsiManager`);
  - `rep` — a signed rep whose Agent has a `reviewed` `sales_rep` `rep_identity_links` row effective at the request instant; otherwise **403 `REP_NOT_LINKED`**;
  - generic `admin`, unsigned, forged, tampered, stale or unknown roles — **403 `FORBIDDEN`**.
- Routes declare a capability (`permissions.ts`); the guard admits the roles that hold it. Manager holds exactly the P09b coordination set; Owner-only controls (policy, roster, base goals, restriction lift, activation, migration, rollback, full configuration) stay Owner-only. A Rep holds only its own assigned reads and Quoted date / callback commands (current-assignment checks are service work).
- Desk commands from a manager run through `executeCsiCommand` in their own idempotency scope `manager:<admin id>`; the strict CSI `actor` schema accepts kind `manager`.
- Daily Operations `GET /api/v1/admin/daily-operations`, `/live` and `/events` admit the Owner **and a signed Manager**; `POST /rebuild` stays Owner-only; Rep and generic Admin stay 403.

### Configuration (SRV-2)

`sales_outreach_configuration` is the desk's only policy authority. No env variable, startup default or GET initializes or overrides it.

- Two document kinds: immutable `version` documents (`key: version:<v>`, full value, content hash, approval ref, actor) and one `pointer` (`key: active`, version, content hash, revision). Version documents are insert-only (query guards refuse updates/deletes that do not target `kind: "pointer"`; bulk writes are refused).
- Strict value schema `salesOutreachConfigurationValueSchema` (`src/validation/v1/salesOutreach.ts`): namespaces `controls`, `transition` (incl. FAST-01 `backfill_lookback_days`, `backfill_include_upcoming_moves`), `cadence`, `evidence`, `migration`, `goals`. Missing keys take the CONTRACTS bootstrap defaults (controls false, migration paused, everything else null). Unknown keys are rejected; "rule" fields are closed enums. Turning on `cadence_shadow_enabled`/`cadence_enforcement_enabled` requires complete cadence, evidence and roster; `goal_metrics_enabled` requires the roster/goals; `intake_admission_enabled` requires `intake_admission_at`.
- Load semantics (`config/load.ts`): the pointer is read from the primary on every request and job admission; only immutable versions are cached (by version + hash), so a committed PATCH is seen by every instance on its next read. No pointer → `uninitialized` (everything off). Dangling pointer, hash mismatch or invalid stored value → `unavailable`; desk reads/writes then fail with **503 `CONFIGURATION_UNAVAILABLE`**. A database failure propagates (no stale value served).
- `GET /api/v1/admin/sales-outreach/configuration` (Owner): `{ ok, data: { contract_version: "sod-v1", as_of, timezone, configuration_state, revision, version, content_hash, approval_ref, updated_at, updated_by, unavailable_reason, value, activation_blockers } }`. `uninitialized` shows the bootstrap defaults at revision 0; `unavailable` keeps the revision visible with `value: null` so the Owner can repair it.
- `PATCH /api/v1/admin/sales-outreach/configuration` (Owner): body `{ expected_revision, value }` (full replacement), header `Idempotency-Key` (400 `IDEMPOTENCY_KEY_REQUIRED` without it). `expected_revision: 0` is the explicit first initialization (creates revision 1). The version, pointer CAS, audit event (`kind: policy`, subject `sales_outreach_configuration:active`) and command ledger row (command `sales_outreach_configuration_update`) commit in one transaction. Replay returns the committed result; same key + different payload → 409 `IDEMPOTENCY_CONFLICT`; stale revision → 409 `REVISION_CONFLICT`; identical content → `changed: false` with no new version. Response `{ ok, data: { contract_version, revision, version, content_hash, changed, replayed } }`.
- Manager has no configuration access (CONTRACTS); safe effective booleans for other roles come with `GET /capabilities` (later phase).

Errors use the CSI envelope `{ ok: false, code, error, request_id, issues? }` with sod-v1 statuses (400 invalid input, 403 forbidden / `REP_NOT_LINKED`, 404, 409 conflicts / `CURSOR_EXPIRED`, 503 `CONFIGURATION_UNAVAILABLE` / `PROJECTION_PENDING`).

### Desk collections (SRV-3 models)

Models in `src/models/salesOutreach/` use `defineCsiModel` (strict, `autoIndex`/`autoCreate` off, unique-fence check before writes) and are listed in `SALES_OUTREACH_MODEL_REGISTRY` (also spread into `CSI_MODEL_REGISTRY`):

| Collection | Key fences / indexes |
| --- | --- |
| `sales_outreach_configuration` | unique `key` |
| `sales_outreach_subjects` | unique `{lead_model, lead_id}`; `{status, assigned_agent_id, _id}`, `display.normalized_job_no`, `display.normalized_phone`, `lead_revision_seen` |
| `sales_outreach_policy_periods` | unique active `{subject_id}` where `ended_at: null`; unique `{subject_id, transition_key}` |
| `sales_outreach_followup_schedules` | unique active `{subject_id}` where `status: "active"` |
| `sales_outreach_contact_events` | unique `{source_kind, source_id, subject_id}`; `{subject_id, event_at}`, `{goal_agent_id, business_date}` |
| `sales_outreach_projections` | unique `subject_id`; queue indexes for urgency / received / last interaction, `next_evaluation_at` |
| `sales_outreach_rep_day_projections` | unique `{agent_id, business_day}`; `{business_day, agent_id}`; `count_scope` records `all_outbound` (M1) vs `eligible_new_quoted` (M2) |
| `sales_outreach_enrollment_runs` | unique `run_key`; `{manifest_hash, mode, partition}`, `{cohort_id, started_at}` |

`ringcentral_rep_sms_evidence` is added to the registry by lane S3.

### Operator scripts

| Script | What it does |
| --- | --- |
| `pnpm outreach:indexes --target=<db> [--apply]` | Plans (default, read-only) or builds the desk indexes. Refuses a target that is not the resolved database, refuses same-name/same-key mismatches and probes unique indexes for duplicates before building; identical indexes are skipped. Production `--apply` passes the production-writer guard. |
| `pnpm outreach:install-policy --target=<db> [--apply] [--enable=desk_enabled,goal_metrics_enabled]` | Dry run by default. Installs FINAL-01 cadence/evidence (`approval_ref owner-session-2026-10-03-FINAL-01`), the FAST-01 backfill scope (90 days + upcoming moves) and the M1 roster (every reviewed `sales_rep` link effective now, all seven days, default goal 100) through the PATCH service path; carries controls/migration/intake fields over; no-op when the same content is active; verifies after writing. |
| `pnpm test:outreach:replica` | Replica proof of the configuration path on the local `csi01` loopback replica only. |

## S2 — Cadence engine (`src/services/salesOutreach/engine/`)

`evaluateSubject(input, policy, as_of)` is pure: it never reads the clock, Mongo, env or a provider, and it calls no model. Callers load facts, call it and persist the result only when `fingerprint` changed. Import everything from `engine/index.ts`.

**Inputs** (`engine/types.ts`, `EvaluateSubjectInput`): subject facts (`received_at` from the restored `leadInstant` adapter, move date, `activation_at` boundary, priority-uncertainty flag, originating answered-inbound event), every policy period (`workflow` new/quoted/discretion/none/closed, `start_kind` intake/transition/activation), every human plan with its command lifecycle (Quoted dates are period-scoped, timed callbacks are subject-scoped), restriction intervals, assignment history, normalized contact events (`sales_outreach_contact_events` shape) and per-channel coverage (`complete_through`, settlement allowance already applied).

**Policy**: the `cadence` namespace of `sales_outreach_configuration`, encoded by `engine/policy.ts` (`cadenceConfigurationValueSchema`, strict, every field nullable for bootstrap). `resolveEnginePolicy` fails closed with `CONFIGURATION_UNAVAILABLE` and every reason; there is no default and no env fallback. `engine/approvedStartingValues.ts` holds the FINAL-01 install payload for the install script only.

**What it computes** — the whole requirement history of the subject, recomputed each call:

1. Obligations: New arrival date (initial response = first call deadline, 18:00/19:30 caps, SMS through 19:30), full New days by age band (12:00/20:00, then 20:00) and fixed SMS days 1/2/3/6/9…, partial start dates after a transition or activation (prior same-date calls subtracted, all due 20:00, no initial clock), Quoted days from the selected date or next-working-date default, callbacks (15-minute window), the 30-working-minute initial response (carries across closing/closed dates, pauses during call restrictions).
2. Terminations in precedence order (P06f): period end/closure (superseded/cancelled) → restriction waiver/resume or blocked callback → callback suspension of routine calls → cutover guard (nothing due before activation; pre-activation past-due callbacks → `legacy_review`).
3. A chronological walk over confirmed, unrestricted events with the P02e spacing anchor (moves only on a credited call). One event can satisfy a callback (spacing does not apply), the initial response, the period's channel catch-up and one ordinary requirement.
4. Outcomes at `as_of`: `fulfilled`, `fulfilled_late` (miss kept), `open`, `overdue`, `missed`, `pending` (coverage does not reach the deadline or unconfirmed evidence exists — never a guessed miss), and the no-miss terminations.
5. Summary: independent Call and SMS requirements (CONTRACTS channel block), bounded catch-up per channel (P06a), flags (`needs_contact`, `overdue`, `blocked`, `pending`, move-date review, advisory cooldown, inherited overdue…), responsibility at each deadline (P06d), `next_evaluation_at`, last 30 business dates of window history.

**Shared with S3** (`engine/credit.ts`): `classifyCallEvidence` / `classifySmsEvidence` (P07a–P07e, IMPL-06/07), `isCadenceQualifying`, `goalCreditAgent` / `goalCreditsByAgent` (initiator-only, start-date, never spacing- or window-dependent), `selectSpacedStarts`, `repDayGoal` / `summarizeTeamGoals` (P08a arithmetic).

**Shared with S1**: `validateQuotedSelection` (P04c command validation), `BusinessCalendar` (DST-safe New York dates via `Intl`; next day by calendar arithmetic, never +24 h), `resumeInstant` (P06c), `cadenceConfigurationValueSchema`.

Tests: one suite per contract fixture (`engine/*.test.ts`), END-TO-END-RUN §3 rows as named tests (`endToEndScenarios.test.ts`), DST/midnight and determinism cases. Evidence: `docs/sales-outreach-desk/workspace/evidence/S2.md`.
