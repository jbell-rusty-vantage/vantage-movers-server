---
type: Service
title: Granot lifecycle read projections
description: Masked Admin case, job, and lead reads. Reads never invoke mutations.
tags: [granot-lifecycle]
status: draft
stale_after: 2026-11-19
resource: src/services/granotLifecycle/projections.ts
applies_to:
  - src/services/granotLifecycle/projections.ts
  - src/services/granotLifecycle/creatingObservation.ts
  - src/services/granotLifecycle/bookingPriorityPairing.ts
  - src/routes/granot-lifecycle-admin.routes.ts
owners: [team:main-server]
sources:
  - id: primary
    resource: src/services/granotLifecycle/projections.ts
  - id: glossary
    resource: ../CONTEXT.md
    title: Platform glossary
  - id: adr-0001
    resource: ../docs/adr/0001-mongodb-system-of-record.md
generated:
  by: process:docs-keeper
  at: 2026-08-24T01:24:00Z
---
**Platform glossary:** [`../../../../CONTEXT.md`](../../../../CONTEXT.md)  
**Authority:** [Final Granot Lead Lifecycle specification](../../../scripts/prototypes/granot-lead-lifecycle/specs/FINAL-SPECIFICATION-GRANOT-LEAD-LIFECYCLE.md) Sections 28.2 and 29. Pairing DTOs: [`booking-reconciliation-booked-only-specification.md`](../../granot-lead-lifecycle/booking-reconciliation-booked-only-specification.md) §7.  
**Primary code:** `src/services/granotLifecycle/projections.ts`, `src/services/granotLifecycle/creatingObservation.ts`, `src/services/granotLifecycle/bookingPriorityPairing.ts`, `src/services/granotLifecycle/alerts.ts`, `src/routes/granot-lifecycle-admin.routes.ts`, `src/validation/v1/granotLifecycle.validation.ts`
**Domain terms used:** [Granot Observation](../../../../CONTEXT.md), [Granot Booking Reconciliation Case](../../../../CONTEXT.md), [Booking Priority Pairing](../../../../CONTEXT.md), [Job Number](../../../../CONTEXT.md), [Booking](../../../../CONTEXT.md), [Cancellation](../../../../CONTEXT.md), [Source Scope](../../../../CONTEXT.md)

# Granot lifecycle read projections

**Role:** Compose read-only, server-authoritative Booking/Release case, candidate, creating-observation, Job Number timeline, Lead timeline, and operations-health DTOs for Vantage Admin. These reads never select or attach a Lead, resolve a case, correct a Record Link, invoke a command, or mutate an official Lead, Booking, or Cancellation. Health/alert evaluation is instrumentation only.

Unit 31 masks every case-detail contact and Booking customer label before
transport and omits free-form Cancellation reason text. Admin receives masked
display values only; raw receipt payload, headers, and contact remain outside
all lifecycle list/detail/timeline/health DTOs. Two Owner-only exceptions exist:
the candidate browser, which also carries normalized owner-work contact so the
Owner can tell two leads apart before attaching one — see [Candidate browser](#candidate-browser);
and the intake creating-observation read, which returns the
credential-redacted Granot statement selected from that Booking or Release case's evidence
— see [Creating observation](#creating-observation).

## Protected read surface

- Owner/Admin (`requireRegistryReadActor`): `GET /api/v1/admin/granot-lifecycle/cases`, `.../cases/:case_id`, `.../jobs/:normalized_job_no`, `GET /api/v1/admin/leads/:lead_model/:lead_id/lifecycle`, `.../operations/health`, `.../discrepancies`, `.../discrepancies/:id`.
- Owner only: `GET .../cases/:case_id/candidates`, `GET .../cases/:case_id/creating-observation`, `GET .../receipts/live` (SSE; see [live-receipts.md](./live-receipts.md)); Owner discrepancy mutations `POST .../discrepancies/:id/{re-evaluate,correct-record-link,no-action}`.
- Default case list query: `state=open`, `sort=last_evidence_at`, `order=desc`.
- Every query is strict Zod input. Case cursors encode only the selected timestamp and ObjectId; timeline cursors encode exactly event time, type priority, and stable ID. Candidate cursors encode only Lead model/ID ordering.
- Missing cases use `GRANOT_CASE_NOT_FOUND`; a missing Lead keeps the generic v1 `Lead not found` envelope.

The default queue merges open Booking and Release cases ordered by newest evidence. `kind` filters either collection; projection-only Release mode is `release`. The selected timestamp plus ObjectId cursor is applied consistently across the merged streams, so pages neither duplicate nor omit cross-collection rows.

Booking list rows expose compact [Booking Priority Pairing](../../../../CONTEXT.md) when the case has a creating Booked Observation: `pairing` (`priority_5_then_booked` | `booked_carries_priority_5` | `booked_without_priority_5`), `creating_booked_priority_is_5`, `has_preceding_priority_5`, and current `has_later_priority_5`. Release rows and historical Priority-5-only Booking rows omit it. List may use the persisted snapshot for the first three fields; `has_later_priority_5` is always computed from one post-Booked Priority 5 query for the page's Booking jobs. Case detail adds full `priority_pairing` (including `later_priority_5`) or `null`. Pairing carries Observation IDs, times, route, and Priority only — no contact and no raw Priority Update payload.

## Projection boundaries

- Lists contain a centralized irreversible contact label and masked Booking reference only. Raw case context/evidence arrays are absent.
- Authorized detail keeps immutable Granot evidence visibly separate from live official Booking/Cancellation fields. Create-missing `official_draft` is empty and never derives defaults from Granot evidence.
- Referral list/detail derives the reviewed Registry source ID/label from immutable Decision `source_policy`, while keeping case `source_scope` absent. `create_referral_booking` exposes no suggestion/candidate search/Lead link; existing Referral review shows current official Booking values with no Lead selector.
- Submitted/ingested contact and accepted Granot contact are separately labeled. Receipt payloads/headers, credentials, addresses, arbitrary Lead documents, and CPL internals never enter list/detail/timeline/health DTOs. The Owner-only creating-observation read is the receipt-payload exception — see [Creating observation](#creating-observation).
- Booking-without-Lead detail deep-links the existing Employee Booking Lead Reconciliation work; it does not invent another matcher or selector.
- Release detail shows the deterministic live Booking and current Cancellation with `candidate_search.available=false`, no suggestion, and no employee-reconciliation substitution. `capabilities.commands` is true for an **open** Release case when `GRANOT_LIFECYCLE_RELEASE_COMMANDS_ENABLED` is true.
- Referral-shaped detail disables candidate browsing for `create_referral_booking`. Referral cases **do** open as `create_referral_booking` when Booking-case gates allow.
- Detail also exposes `capabilities.referral`, `release_cases`, and `discrepancies`.

## Timelines

Job Number is the primary timeline. Available Observations, individual Priority effects and Booked/Release actions, Decisions, case evidence/sequence events, Record Link changes, Entity Changes, and current official Booking/Cancellation facts remain individual entries. Sorting is ascending `(event_at, type_priority, id)` with the locked priorities 10 through 100. Invalid authoritative event time fails projection; request time is never substituted.

Pagination returns `{ items, next_cursor, current, capabilities }`. There is no hidden 100-row cap: `next_cursor` advertises remaining entries. Release-case and discrepancy capabilities are true when those collections exist.

## Operations health

`GET /api/v1/admin/granot-lifecycle/operations/health` projects flags, activation, Mongo due/claim/dead-letter counts, 24-hour Decision groups with execution mode, open Booking/Release cases and discrepancies, command conflicts, last queue/cron runs, RingCentral lease/cursor telemetry, and the seven rollout alerts. Counts come from current models, not process memory. Due work matches Section 26: pending/retry plus claimed only when the lease has expired. Activation IDs and source scope refs are masked. Admin must not recompute due logic, p95, rates, or alerts. See [observability.md](./observability.md).

Lead timeline first verifies the exact Lead, then follows persisted Record Links to linked Job Numbers. It never contact-matches at read time.

## Creating observation

`GET /api/v1/admin/granot-lifecycle/cases/:case_id/creating-observation` is Owner-only and scoped to a Granot Booking or Release Reconciliation Case. It is not part of the masked case-detail DTO. The route default is `getIntakeCreatingObservation`, which looks up the Booking case first (`getBookingIntakeCreatingObservation`), then the Release case (`getCancellationIntakeCreatingObservation`). Booking uses `selectCreatingObservationEvidence`: latest evidence with action `booked` (`selection: "preferred_booked"`, the `booking_status_changed` Booked Granot Observation) and falls back to the latest creating evidence (`latest_creating`). Release uses `selectReleaseCreatingObservationEvidence`: latest evidence with action `release` (`selection: "preferred_release"`) and the same `latest_creating` fallback. Missing case, empty evidence, or missing Granot Observation return `GRANOT_CASE_NOT_FOUND`. The envelope returns the projected Granot Observation (identity, contact, move, booking action), `selection`, and `granot_statement`, the credential-redacted receipt payload. Booking envelopes also include `priority_pairing` (or `null` for historical Priority-5-only cases) and optional `paired_priority_5_observation` for the preceding Priority 5 snapshot. Release envelopes return `priority_pairing: null` and do not pair Priority 5. Booked-without-5 still returns 200 with the Booked statement. Absence of Priority 5 is not `GRANOT_CASE_NOT_FOUND`. Headers, secrets, and list/detail masking stay unchanged.

## Candidate browser

The Booking reconciliation service remains the policy seam. Its canonical identity candidates retain their existing high/medium confidence and suggestion facts. Case-scoped browsing may additionally search current eligible Form/Call Leads within Source Scope or, for Owner all-scope review, across scopes. Duplicate and Bad Form Leads are excluded server-side. Job-compatible rows rank high; other browse matches rank medium. Out-of-scope rows carry `requires_override_reason=true`. This module never attaches a Lead; gated Owner confirm may consume a selected candidate when the Booking-command flag is true.

Ordering is not the raw browse order. `rankBookingCandidateProjections` pins the canonical identity matches — suggested first, then high confidence, stable within a tier — ahead of the ObjectId-ordered browse page, so the strongest match is always on the first page and never has to be paged to. An explicit `q` search owns its whole page and pins nothing; cursor pages continue the browse stream only, so a pinned row is never returned twice.

Each candidate item carries both `masked_contact_label` (unchanged) and a normalized `contact` of `name`, `phone_number`, and `email`, plus `job_no`, `normalized_job_no`, and `reference` (`ref_no`). Form items also carry `known_contacts`: `form_submitted` is live contact (not `ingested_contact_snapshot`); `granot` is present only when `granot_contact_snapshot` exists and uses the stored `differs_from_ingested` plus optional `captured_at`. The DTO never sends `observation_id`. Labels stay live Form submitted. Form `q` ORs the shared `FORM_LEAD_CONTACT_*_PATHS` plus `job_no` / `ref_no`. Call `q` stays live-only. This is the "detail/candidate may return normalized contact fields when required for explicit Owner work" allowance in Unit 23, and it is why the endpoint is Owner-only. It is normalized Lead field data, never a raw Lead document or receipt payload. List DTOs, `maskContactLabel`, `maskLifecycleContact`, `assertProjectionSafe`, and `JOB_PROJECTION_FORBIDDEN_KEYS` are unchanged.

## Posture

Reads remain available for existing cases when case creation is disabled. Case/timeline `capabilities.commands` is true when the case is open **and**:

- Booking `create_missing_booking` / `review_existing_booking` and `GRANOT_LIFECYCLE_BOOKING_COMMANDS_ENABLED`
- Booking `create_referral_booking` (or current Booking is referral) and both Booking-command **and** `GRANOT_LIFECYCLE_REFERRAL_BOOKING_ENABLED`
- Release and `GRANOT_LIFECYCLE_RELEASE_COMMANDS_ENABLED`

Checked-in lifecycle flags remain processing/shadow true and every Lead/Booking/Release/Referral/email effect false. Health displays those evaluated values and never treats historical_shadow or live_shadow Decision counts as promoted effects. Health also projects `record_links: { active, disputed }`, `command_conflicts_last_24h`, receipt `by_work_state`, and `expired_claim_count`. Open-case health `mode` values: `create_missing_booking` | `review_existing_booking` | `create_referral_booking` | `release`.
