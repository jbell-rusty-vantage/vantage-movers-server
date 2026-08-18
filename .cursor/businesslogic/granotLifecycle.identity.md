**Platform glossary:** [`../../../CONTEXT.md`](../../../CONTEXT.md)  
**Primary code:** `src/services/granotLifecycle/identity.ts`  
**Domain terms used:** Granot Observation, Granot Record Link, Source Company, Source Granularity, Booking Lead Reconciliation Case, Active Agent

# Granot source-scoped identity (`granotLifecycle/identity`)

**Role:** Read-only identity half of S09. After reviewed Registry policy resolves as `source_scoped_lead`, run the Form or Call ladder and return deterministic candidates, conflicts, Agent assertion, and Booking context. This module creates no Decision, desired state, Lead/Booking/Cancellation write, case, discrepancy, command, Change, outbox item, or notification.

**Stack:** callable module `identity.ts`. `sourcePolicy.ts` remains the sole Registry semantic resolver. The Unit 15 processor invokes this module after Registry policy and before desired-state planning. Capture, routes, and clients never select candidates. This module remains read-only.

## Public interface

- `resolveLeadIdentity({ observation, policy, policy_failure? }, store?)` — consume a persisted Observation projection and an already-resolved `SourcePolicySnapshot`.
- `createMongoLeadIdentityStore()` — production read store. Tests may inject a recording store.
- Result fields `target_eligibility`, Agent suggestion, and Booking wrappers are in-memory only. Persisted Decision vocabulary stays `outcome`, `reason_code`, `match_method`, `target`, and `candidates`.
- Candidates contain IDs and reason codes only. Name, phone, email, address, Job, payload, and unmasked contact values never leave the module.

## Policy before any Lead lookup

Successful `source_scoped_lead` policy with Source Company, Source Granularity, and `selected_lead_model` is required before a Lead query. Missing/invalid/inactive scope, deferred disposition, and `policy_failure` return immediately without a global or scoped Lead search. Payload `type=AUTO` / `provider_context` is ignored. Client `expected_target` is not an input. `legacy_unknown` is never reinterpreted as a match signal.

`referral_booking` returns `referral_leadless=true`, no Lead ladder, and no Lead search.

## Form Lead ladder

1. Active `GranotRecordLink` by normalized Job Number.
2. Exact eligible non-duplicate `FormLead.ref_no` from `normalized_form_ref`.
3. If that value is a 24-character ObjectId hex, exact eligible non-duplicate `FormLead._id`.
4. Exact Source Company **and** Source Granularity contact match across current, `ingested_contact_snapshot`, and `granot_contact_snapshot` phone/email.
5. Otherwise `pending_match` / `ambiguous` / `conflict` / `unmatched`.

A job-only link is evidence and the ladder continues. A link with `lead_ref` is a target only when model, existence, restrictions, Job, and Source Scope agree; disagreement is a hard conflict and does not fall through to contact. Blank/`not provided` Form references are never queried. Exact identity with missing or conflicting canonical scope is `conflict` / `source_scope_conflict`. Conflicting nonempty Jobs are `conflict` / `job_number_conflict`.

Duplicate Form Leads are ineligible (`duplicate_form_lead_ineligible`). A Bad Form Lead may be returned only from Record Link / ref / ObjectId with `priority_only` / `bad_form_lead_priority_only`. Bad Leads are excluded from contact matching, Agent suggestion, Booking suggestion, and creation. `bad_lead` is never cleared.

Same Lead found through current and immutable contact values is one candidate. Zero eligible contact candidates do not guess. More than one distinct eligible candidate is `ambiguous` / `multiple_eligible_matches`.

## Call Lead ladder

1. Active Record Link by normalized Job Number.
2. Exact `CallLead.normalized_job_no` inside the resolved Source Granularity.
3. Source Granularity plus normalized phone across current phone and immutable ingested/original caller phone.
4. Otherwise pending/ambiguous/conflict/unmatched.

Job and contact queries always include `source_granularity_id`. Duplicate Call Leads remain readable. Job and phone pointing at different eligible Leads are `conflict`; multiple same-rung candidates are `ambiguous`. Current and immutable phones are alternative evidence for one Lead.

## Agent assertion

Preserve `user_raw` and `rep_raw`. Normalize nonempty values with the Operations Registry Granot username normalizer. Equal normalized values are one assertion. Different nonempty values yield `granot_agent_identity_conflict` (`agent_assertion: "conflict"`), return no Agent, and do not block non-Agent identity. Suggest an Agent only when exactly one active row matches `granot_identity.username` or compatibility `granot_crm_username`. Never call `applyGranotCrmUsernameReceiverMatch`. Never create, activate, verify, or mutate an Agent. Existing receiver overwrite is planned by Unit 15 and applied by Unit 18.

## Booking context

Resolve the unique current Booking by shared `normalizeJobNo`. Multiple current Bookings are `conflict` / `job_number_conflict`. An existing Booking Lead is deterministic owner context; disagreement with a ladder candidate is conflict evidence, not reassignment. A Booking without a Lead sets `booking_lead_reconciliation_required=true` and delegates to existing `BookingLeadReconciliationCase` — this module does not open or duplicate that workflow. Referral Bookings are intentionally leadless.

## Flags and later work

Identity is read-only. Processing remains true, shadow remains true, and all eight effect flags stay false. Unit 15 must consume this resolver rather than reconstructing identity inside the processor.

## Related

- Policy resolution: [`granotLifecycle.sourcePolicy.md`](granotLifecycle.sourcePolicy.md)
- Decision skeleton does not select a Lead: [`granotLifecycle.processor.md`](granotLifecycle.processor.md)
- Observation identity fields: [`granotLifecycle.normalization.md`](granotLifecycle.normalization.md)
