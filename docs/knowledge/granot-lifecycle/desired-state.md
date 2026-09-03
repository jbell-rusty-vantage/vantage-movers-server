---
type: Service
title: "Granot desired-state planner (`granotLifecycle/leadDesiredState`)"
description: Desired-state planner and temporal compare. Plans only; no writes.
tags: [granot-lifecycle]
status: draft
stale_after: 2026-11-19
resource: src/services/granotLifecycle/leadDesiredState.ts
applies_to:
  - src/services/granotLifecycle/leadDesiredState.ts
  - src/services/granotLifecycle/granotTemporal.ts
  - src/services/granotLifecycle/authorizedDesiredState.ts
  - src/services/granotLifecycle/leadContactProjection.ts
owners: [team:main-server]
sources:
  - id: primary
    resource: src/services/granotLifecycle/leadDesiredState.ts
  - id: glossary
    resource: ../CONTEXT.md
    title: Platform glossary
  - id: adr-0001
    resource: ../docs/adr/0001-mongodb-system-of-record.md
generated:
  by: process:okf-docs-optimization
  at: 2026-09-02T18:00:00Z
---
**Platform glossary:** [`../../../../CONTEXT.md`](../../../../CONTEXT.md)

**Primary code:** `src/services/granotLifecycle/leadDesiredState.ts`, `src/services/granotLifecycle/granotTemporal.ts`, `src/services/granotLifecycle/authorizedDesiredState.ts`, `src/services/granotLifecycle/leadContactProjection.ts`

**Domain terms used:** [Granot Observation](../../../../CONTEXT.md), [Synchronization Decision](../../../../CONTEXT.md), [Ingestion Origin](../../../../CONTEXT.md), [System of Record](../../../../CONTEXT.md), [Call Lead](../../../../CONTEXT.md), [Form Lead](../../../../CONTEXT.md)

# Granot desired-state planner (`granotLifecycle/leadDesiredState`)

**Role:** Pure origin-specific planner. Given a persisted Observation, Unit 14 identity result, current Lead projection, Registry policy, and temporal order, return a deterministic `LeadDesiredStatePlan`. Routes and clients never supply this object. The plan is not persisted; Decisions keep only target/candidates, reason, gate snapshot, and allowed effect summaries.

## Temporal comparator

`compareGranotTemporal` compares `captured_at` first, then lowercase 24-character Observation ObjectId hex. Missing stored winner is `newer`. Exact same tuple is `same`. Older observations plan `stale` and do not advance the winner.

## Authority matrix

| Field group | Planned when |
| --- | --- |
| Job Number | fill missing when normalized values agree; letter prefixes on the same digit core agree; conflict never overwrites |
| `granot_priority` | every temporally accepted valid Priority |
| `receiver_agent` | empty receiver + one active Unit 14 Agent suggestion at any valid Priority |
| `quoted` | Priority `1`/`5` may set true; never false |
| Granot/current contact | Priority `1`/`5`, subject to origin |
| current location / move date / cubic feet / `local` | Priority `1`/`5`, subject to origin |
| `granot_move_size`, `granot_service_type` | Priority `1`/`5`; never Vantage `move_size` |

WordPress Form: primary name/phone/email and both ingested snapshots stay off `changed_paths`. Qualified Granot contact plans `granot_contact_snapshot` only. Granot-created and RingCentral-created qualified contact become current operational fields; `last_granot_contact_change.changed_paths` is planner metadata and is stripped before `synchronizeLeadFromGranot`. The command derives provenance, contact hashes, temporal winner, and `EntityChange` field modes. A planned `receiver_agent` fill also derives `receiver_agent_name_snapshot` from the loaded Agent catalog name and `receiver_agent_set_at`; those stamps stay off the planner.

## No-match and minimum data

- `link_only`: `pending_match` / `pending_source_scoped_match` with `next_match_attempt_at` from the Unit 08 offsets; at/after 24h `unmatched` / `match_window_expired`
- incomplete immutable creation data: `insufficient_creation_data` with `missing_creation_job_number`, `missing_creation_contact`, or `missing_creation_route_data`; never pending
- Form minimum data: normalized Job, deterministic route, name component, normalized phone, valid origin/destination state and 5-digit ZIP
- Call may be Job-only; telephony, duration, session, qualification, and RingCentral metadata are never fabricated
- `planNoMatch` event-class rule: `create_if_missing` with complete minimum data plans immediately `created` / `lead_created_authorized` and `creation_eligibility:"eligible"` when `route_event_class` is `lead_created` (any selected model, including Form and Call). `priority_updated` never plans create, including Call + `create_if_missing`. Call `link_only` + `priority_updated` stays on the pending/unmatched clock. `booking_status_changed` never plans create — booking-case Decision still returns first. The processor invokes `createLeadFromGranot` only when execution is `live`, `GRANOT_LIFECYCLE_LEAD_CREATION_ENABLED` is true, and every creation gate passes. Those gates reuse `evaluateEffectGates` with `requested_effect: "lead_created"` and `global_effect_flag: flags.lead_creation_enabled` — not a separate gate list and not a ninth gate. Shadow and gated-off live stay `shadow_effect_suppressed` / `global_effect_disabled` with no Lead, link, Command, Change, or outbox
- `observation_only` stays `creation_policy_observation_only`
- `isInvalidPriorityUpdate` is only `route_event_class === "priority_updated"` plus `invalid_priority`. Other routes with `valid_with_issues` + `invalid_priority` skip Priority fields and continue. Invalid Priority Update never creates
- Call create-if-missing acquires both Granot lock sites when the Observation has a normalized phone (always on; not gated on the adoption flag) and rejects when pre-creation candidates exist at exact Source Granularity + phone (`ensureRingCentralConvergenceScopeLock` then `acquireRingCentralConvergenceScopeLock`). Job-only Observations skip both sites

Equivalent formatting uses existing Job/phone/email/state/date normalizers and does not manufacture a change. Contact snapshots also treat US `+1` vs 10-digit phones, email case, name capitalization/whitespace, and a name-only card vs the same tokens split into first/last (`splitNameForCrm`) as the same card. `synchronizeLeadFromGranot` stamps `differs_from_ingested` with that same compare. `changed_paths` are sorted and deduplicated.

## Command conversion and role-safe projection

The processor converts a plan to `GranotAuthorizedLeadDesiredState` immediately before `synchronizeLeadFromGranot`. Extra/missing/duplicate paths, `quoted:false`, forbidden metadata, and model-inapplicable ZIP fields are rejected. Contact hashes, temporal/provenance stamps, and receiver catalog snapshot/`set_at` are server-derived.

`projectRoleSafeLeadContacts` keeps WordPress submitted contact and `granot_contact_snapshot` separately identifiable and masks phones/emails. It never reads raw receipt payload.

## Related

- Processor orchestration: [`processor.md`](./processor.md)
- Identity input: [`identity.md`](./identity.md)
