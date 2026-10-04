---
type: Service
title: Number Activity reads (Numbers list, detail, timeline, coverage, directory, rebuild, history)
description: Owner-only Numbers search, detail and timeline over canonical Call Interactions and retained attachments, Owner coverage, daily RingCentral directory snapshots, revision-CAS rebuild, and the MCP canonical history reads. Reads never mutate and read no retired collection.
tags: [sales-intelligence, ringcentral, durable-work]
status: draft
stale_after: 2027-01-31
resource: src/services/numberActivity/
applies_to:
  - src/services/numberActivity/search.ts
  - src/services/numberActivity/searchTerms.ts
  - src/services/numberActivity/contactNumbers.ts
  - src/services/numberActivity/leadContext.ts
  - src/services/numberActivity/timeline.ts
  - src/services/numberActivity/coverage.ts
  - src/services/numberActivity/directorySync.ts
  - src/services/numberActivity/rebuild.ts
  - src/services/numberActivity/dto.ts
  - src/services/salesIntelligence/ownerCoverage.ts
  - src/services/salesIntelligence/history/
  - src/routes/sales-intelligence-admin.routes.ts
  - src/routes/sales-intelligence-history.routes.ts
owners: [team:main-server]
sources:
  - id: interim-contract
    resource: docs/server-admin-slimming/evidence/S-NUM-CONTRACT.md
    title: Interim Numbers and RingCentral Accounts HTTP contract (SLIM-05)
  - id: slimming
    resource: docs/server-admin-slimming/SPECIFICATION.md
    title: Server and Admin slimming specification (§7.3–7.4)
generated:
  by: process:docs-keeper
  at: 2026-10-04T00:00:00Z
---

# Number Activity reads

**Role:** the Owner-facing read side of [Number Activity](number-activity-capture.md) for the interim `/sales-intelligence` (**Numbers** and **RingCentral Accounts** only), plus two maintenance workers: the daily RingCentral directory snapshot and the durable Number rebuild. Since the 2026-10 server/admin slimming every read works with every retired collection physically absent: no Outreach, conversation, analysis, assessment or Attention data is read or returned ([slimming specification](../../server-admin-slimming/SPECIFICATION.md) §7.4). Proof: `ops/numbers-slim.replica.ts` (`pnpm test:numbers:replica`, csi01 replica) and `numberActivity/reads.test.ts`.

**System of record read:** `contact_numbers`, `call_interactions` (canonical rows only, `merged_into_id: null`), `number_lead_attachments`, `form_leads`, `call_leads`, `booked_leads`, `cancelled_leads`, `lead_messages` (metadata only), `rep_identity_links`, `ringcentral_directory_snapshots`, `sales_intelligence_contact_restrictions` and CSI sync state. Writers: the rebuild worker and the directory sync only.

## Common rules

Prefix `/api/v1/admin/sales-intelligence` (route file `sales-intelligence-admin.routes.ts`). **Owner only**: the Admin role, scoped keys and signed reps get 403 `OWNER_REQUIRED` whatever `SALES_INTELLIGENCE_REP_ACCESS` says. `SALES_INTELLIGENCE_ENABLED` off → 404 `FEATURE_DISABLED` before any read. Scope omitted or `production`, else 403 `UNSUPPORTED_SCOPE`. Query strings are strict (unknown parameter → 400). Commands need `Idempotency-Key` and go through the CSI command ledger. Owner reads are wrapped `{ ok: true, as_of, coverage, data }` (`ownerRead`); `coverage` is `{ known_through, gaps[], capabilities: { call_log, webhook } }` with each capability `ok|unknown|unavailable`. The exact field lists are in the [interim contract](../../server-admin-slimming/evidence/S-NUM-CONTRACT.md).

## Numbers list (`GET /numbers`, `search.ts`)

- Query: `q` (≥ 10 digits = exact E.164 or suffix, 3–9 digits = suffix, else name/job/agent term prefix over `search_terms`), `classification`, `attachment` (`any`|`linked`|`unlinked`), `active_from`/`active_to`, `hygiene` (`true` lists only non-external kinds; default external only), `has_recording` (`rollups.recordings_total > 0`, provider metadata), `has_calls`, `include_form_only`, `cursor`, `limit` (1–200, default 50), `sort` (`last_activity`|`last_call`|`last_human_conversation`|`first_observed`|`first_call`|`interactions`) and `direction`. Default `last_activity`/`desc`, nulls last; the keyset cursor binds the sort. `has_outreach` was removed (400).
- `has_calls` (G7): an explicit value wins; otherwise `true` when `SALES_INTELLIGENCE_NUMBERS_HAS_CALLS_DEFAULT` is on and `include_form_only` is not `true`, else no narrowing. Form-only Numbers are those created from a Form Lead (`created_via: "form_lead"`) with no call yet.
- Item: `id, revision, e164, national_ten, kind, classification, eligibility, provider_names[], first_observed_at, last_activity_at, rollups, linked, match, attached_lead, created_via, has_calls`. Rollups: `interactions_total, inbound_total, outbound_total, human_conversations_total, last_inbound_at, last_outbound_at, last_human_conversation_at, attached_lead_count, candidate_lead_count, recordings_total`.
- `attached_lead` (`leadContext.ts`, one batched read per page: one edges read, one read per Lead collection, one Bookings read, one Cancellations read): `resolved` only through exactly one `attached` edge, with `lead_ref`, `lead_display` (`name, job_no, source_company`, or null when the Lead row is gone) and `official` (`open_lead`|`booked`|`cancelled`|`bad_lead`|`duplicate`|`no_sync`, plus `booking_id`/`cancellation_id`); several attached edges are `multiple`; candidates/ambiguous/rejected only are `none`. Official status reads the Lead flags first, then the Lead's newest exact `booked_leads` row (`lead_model` + `lead_ref`) and its `cancelled_leads` row. Facts from different Leads are never merged and no Lead is picked out of several. This replaced `attached_lead_progress` (Lead progress, Outreach state, Move assessment).

## Number detail (`GET /numbers/:id`, `contactNumbers.ts`)

The Number, its `search_terms`, `created_via`, `has_calls`, rollups, `attached_lead` (same resolver as the list, so they cannot disagree), every attachment edge (`state`, `certainty`, `lead_display`, decision fields), restrictions on this Number (`channels`, `until`, `origin: owner|intelligence`, `state`; read-only, no resolve command; `origin: "intelligence"` rows are kept as recorded history), `connections` (edge counts and a fresh canonical-interaction recount) and `allowed_actions` (`attach_lead` gated by `ENABLED` + `ATTACHMENT_REFRESH`, `rebuild_number`) with expected revisions and blocker codes. Running analysis, Outreach records, review items and restriction run/finding ids were removed.

## Timeline (`GET /numbers/:id/timeline`, `timeline.ts`)

Query `cursor`, `limit` (1–200, default 50); strict, so `kinds[]` and other former v2 parameters are 400. Order `(happened_at desc, kind asc, id desc)`. Two event kinds, merged by keyset from two sources:

- `interaction` (canonical Call Interactions): direction, provider result, connected, `contact_type`, duration, terminal, `call_log_state`, `recording_count` and `recording_ids` (provider metadata, no audio), projection revision, sources, answered/ended times, company E.164, transfer, queue fan-out, legs (bounded, with overflow count) and `rep`. `rep` is resolved at read time from the Rep Identity Link effective at the call start for the answering (else first) user party (`resolveRepIdentityAt`); only `reviewed` names an Agent.
- `lead_message`: delivery metadata of Lead Messages to this Number (status, purpose, origin, dispatch mode, sent/delivered, `lead_ref`). Never a body.

The `conversation` events, Outreach/nudge/owner-note events and the v2 story timeline (`SALES_INTELLIGENCE_TIMELINE_V2`, Outreach timeline) were removed. Reads never mutate.

## Rebuild (`POST /numbers/:id/rebuild`, `rebuild.ts`)

Body `{ command: "rebuild_number", expected_revision, reason }` → `202 { job_id, dedupe_key, number_id, replayed }`. The command enqueues a `rebuild` job (dedupe `rebuildDedupeKey`); the worker (`runRebuildJob`, drained by job recovery under `ENABLED`) reloads canonical interactions and attachments (`loadRebuildEvidence`), recomputes rollups, `first_observed_at`, `last_activity_at` and search terms (`recountNumber`), and writes only when they differ (`sameRebuiltFields`), under the Number `revision` CAS. It drops stored retired rollup fields. A second run on an unchanged Number writes nothing.

## Coverage (`GET /coverage`, `ownerCoverage.ts`, `coverage.ts`)

`{ as_of, coverage }` (not `ownerRead`-wrapped). Besides the common coverage fields: `call_log_capture` (quarantine count and oldest, Call Log Sync mode, last nightly sweep figures), `capture_health` (`ok|attention|broken`, reasons, `known_complete_through`, Call Log and webhook state including the owned subscription suffix/expiry, last receipt, receipts in the last hour, last renewal and its error from the `webhook_subscription_maintenance` sync-state row, in-progress calls, pending finalization) and `mapping_hygiene` (unmapped inbound numbers, unmapped directory Users, last directory sync). Capture coverage is projected into `sales_intelligence_coverage_projections` once a minute by job recovery (`refreshCaptureCoverage`); reads use an in-process memo bounded by `SALES_INTELLIGENCE_COVERAGE_CACHE_MS` (default 5 s). Stages, budget, analysis admission, models and backfill were removed from this read.

## Directory sync (`directorySync.ts`)

`/api/cron/sales-intelligence-directory-sync` (05:20 UTC, `SALES_INTELLIGENCE_DIRECTORY_SYNC`) fetches the account's extensions and appends a normalized snapshot to `ringcentral_directory_snapshots` only when its digest changed, keeping at most `DIRECTORY_SNAPSHOT_BOUND` (30) per account, under the `directory` sync-state lease. Rep Identity proposals, nudge eligibility and mapping hygiene read these snapshots; no read refreshes the provider.

## MCP canonical history (`sales-intelligence-history.routes.ts`, `history/`)

`GET /api/v1/internal/sales-intelligence/history/contact-number` (`phone` or `id`), `/lead-candidates` (`phone` or `contact_number_id`, optional `stated_name`, `reference`) and `/lead` (`model`, `id`). They serve the Vantage MCP general endpoint (`find_contact_number`, `find_lead_candidates`, `get_lead_history`). Gate: `ENABLED`, and the broad `x-api-secret` or a signed-in user; the Sales Intelligence scoped key, unauthenticated calls and a request signed as a rep get 403 `RUN_SCOPE_DENIED`. Validation happens before connecting. Sources are canonical records and provider metadata only (Contact Numbers with the retained rollup keys, attachments, Leads, Bookings, Cancellations, EntityChanges, Granot observations, Lead Message delivery metadata), each read bounded and indexed; every string is redacted (`history/redaction.ts`); `history/moveViews.ts` builds deterministic move views from the Lead's own fields. No transcript, analysis, assessment, Lead Message body or email is returned. Not found → 404 `NOT_FOUND`.

## Removed routes (404)

`/attention*`, `/outreach/**`, `/followups/**`, `/restrictions/:id/resolve`, `/review-items*`, `/interactions/:id/contact-type`, `/numbers/:id/open-review`, `/numbers/:id/conversations`, `/numbers/:id/reanalyze`, `/conversations/**`, `/analysis-runs/**`, `/findings/**`, `/assessments/**`, `/roster`, `/overview*`, `/backfill`, and `/api/v1/internal/sales-intelligence/runs/**`. The guard test is `src/routes/sales-intelligence-rep-access.test.ts` (`INTERIM_ADMIN_ROUTES`).
