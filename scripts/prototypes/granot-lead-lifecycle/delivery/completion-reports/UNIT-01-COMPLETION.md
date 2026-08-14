# Unit 01 completion — contract freeze, redacted synthetic fixtures, and quality guardrails

## Status and scope

- **Status:** complete
- **Repository / branch:** `vantage-main-server` / `granot-lead-lifecycle`
- **Authoritative contract:** final specification Sections 1–2, 4–7, 10, 35–36, 37.2, and 38/S01
- **Acceptance ownership:** AC-03; normalization-fixture portions of AC-05 and AC-06; source/provider-context fixture portion of AC-29
- **Applicable invariants preserved:** 2, 3, 8, 9, and 10
- **Runtime posture:** contract, test-support, tests, and documentation only; no lifecycle processing or persistence enabled

## Files added or changed

### Frozen vocabulary and fixture guardrails

- `src/services/granotLifecycle/types.ts` — exact Section 7 shared vocabulary.
- `src/services/granotLifecycle/testSupport/normalizationFixture.ts` — strict Zod fixture schema with channel authority, raw/expected fact consistency, Priority consistency, Booking Action aliases, and webhook route/event rules.
- `src/services/granotLifecycle/testSupport/fixtures.ts` — 28 redacted synthetic normalization fixtures across all three channels.
- `src/services/granotLifecycle/testSupport/fixtureSecurity.ts` — recursive secret/PII and fixture-source inventory scanner.
- `src/services/granotLifecycle/types.test.ts` — exact compile-time union coverage.
- `src/services/granotLifecycle/normalizationFixtures.test.ts` — AC-named fixture, parity, semantic rejection, scanner, and recursive-inventory coverage.

### Existing AC-03 production boundaries

- `src/services/crm/formLeadPayload.test.ts` — AC-03 names on Tracking Reference → `leadno`, `lid` non-identity, and blank sentinel assertions.
- `src/services/granotHttpCollector/formWorkflow.test.ts` — AC-03 names on exact `FormLead.ref_no` priority and Mongo `_id` compatibility order.

### Documentation corrections

- `.cursor/rules/owner-lead-workflow.mdc`
- `.cursor/rules/business-logic.mdc`
- `.cursor/rules/project-organization.mdc`
- `.cursor/businesslogic/form-lead.service.md`
- `.cursor/businesslogic/formLeadSearch.service.md`
- `.cursor/businesslogic/adminSearch.service.md`
- `docs/showcase/owner-workflow.md`
- `docs/showcase/presentation-test-values.md`
- `docs/granot-webhook-domain-service-model.md`
- `docs/granot-lifecycle-prototype-and-implementation-seams.md`

These now describe persisted `FormLead.ref_no` → CRM `leadno` → Granot `ref_no` as the current contract, exact `FormLead.ref_no` as primary identity, and Mongo `_id` as compatibility fallback only after exact lookup misses. Valid Mongo-ID booking inputs and historical compatibility behavior remain documented.

## Exact shared exports

`ObservationChannel`, `GranotRouteEventClass`, `ChannelOperationKind`, `GranotObservationKind`, `ReceiptWorkState`, `NormalizationResult`, `NormalizationIssueCode`, `SynchronizationOutcome`, `SynchronizationReasonCode`, `ExecutionMode`, `GranotBookingAction`, `LeadModel`, `EntityRef`, `GranotLifecycleDisposition`, `GranotLeadCreatedPolicy`, and `GranotDiscrepancyReasonCode` exactly match final-spec Section 7. Type-level equality checks prevent widening and independently couple the Zod fixture vocabulary to these types.

## Synthetic fixture inventory

### `granot_webhook`

- AC-03: `synthetic_ac03_tracking_reference_round_trip`, `synthetic_ac03_blank_form_reference`
- AC-05: `synthetic_ac05_priority_zero_number`, `synthetic_ac05_priority_eight_string`, `synthetic_ac05_priority_leading_zero_five`, `synthetic_ac05_lead_parity_webhook`
- AC-06: `synthetic_ac06_missing_priority_update`, `synthetic_ac06_malformed_priority_update`, `synthetic_ac06_malformed_lead_created_priority`, `synthetic_ac06_malformed_booked_priority`, `synthetic_ac06_released_is_unsupported`, `synthetic_ac06_booking_parity_webhook`
- AC-29: `synthetic_ac29_paid_overflow_deferred`

### `browser_extension`

- AC-03: `synthetic_ac03_not_provided_form_reference`
- AC-05: `synthetic_ac05_priority_one_string`, `synthetic_ac05_priority_twelve_digit_allowed`, `synthetic_ac05_lead_parity_extension`
- AC-06: `synthetic_ac06_release_exact_alias`, `synthetic_ac06_booking_parity_extension`
- AC-29: `synthetic_ac29_auto_source_deferred`

### `granot_http_automation`

- AC-03: `synthetic_ac03_mongo_compatibility_after_exact_miss`
- AC-05: `synthetic_ac05_priority_five_number`, `synthetic_ac05_priority_all_zero_string`, `synthetic_ac05_lead_parity_automation`
- AC-06: `synthetic_ac06_malformed_release_priority`, `synthetic_ac06_booked_mixed_case_alias`, `synthetic_ac06_booking_parity_automation`
- AC-29: `synthetic_ac29_provider_type_auto_is_context_only`

Only fixture IDs, channels, and acceptance ownership were printed during the bounded inventory; payload/contact bodies were not printed.

## Scanner rules and allowlists

- Rejects normalized variants of authorization, cookies, API secrets, webhook secret/password/token, credentials, signatures, private keys, and similar credential-shaped keys.
- Rejects Bearer/Basic credentials, JWT-like strings, private-key markers, URL credentials, and long opaque values under credential-shaped keys.
- Allows email only under `example.invalid`.
- Allows phone-like values only in NANP-reserved `202-555-0100` through `202-555-0199`, including country-code normalization.
- Allows synthetic name fields only from `Synthetic`, `Customer`, `Synthetic Customer`, and `Fixture Operator`.
- Rejects realistic street-address shapes.
- Recursively inventories the full `src/services/granotLifecycle/` tree, rejects raw JSON/YAML fixture sources, rejects unvalidated alternate fixture/sample/case sources, and rejects current-payload/customer-fixture directory patterns.
- Scanner failures contain only synthetic fixture ID, safe field path, and rule code; rejection tests verify that sentinel values do not appear in errors.

In-memory bad cases prove credential, credential-key variants, opaque secret, non-reserved email, 10/11-digit phone, street address, and non-allowlisted name rejection. A bounded temporary tree proves recursive rejection of `cases.ts`, a nested alternate `fixtures.ts`, and raw observation JSON without committing prohibited examples.

## Verification

- Focused command:
  - `node --import tsx --import ./scripts/test-setup.ts --test "src/services/granotLifecycle/*.test.ts" "src/services/crm/formLeadPayload.test.ts" "src/services/granotHttpCollector/formWorkflow.test.ts"`
  - **36 passed, 0 failed**.
- Full repository command:
  - `pnpm test`
  - **935 passed, 0 failed** on the unchanged final tree.
- TypeScript:
  - `pnpm typecheck`
  - **passed**.
- `git diff --check`: **passed** (line-ending conversion warnings only).
- Independent adversarial review: final pass found no remaining UNIT-01 blocker.

Verification was local and used only committed synthetic fixtures plus in-memory or temporary synthetic rejection cases. No live/staging call, database mutation, Granot request, or current customer payload inspection occurred.

## Persistence, flags, migrations, and effects

- Models/schemas/indexes: none.
- Migrations or database commands: none.
- Starting/ending lifecycle flags: none; no later effect was enabled.
- Runtime persistence, Lead/Booking/Cancellation mutation, Sheet Sync, notifications, external sends: none.
- Transaction, concurrency, command idempotency, replay, aggregate no-op, and outbox claims: not applicable to this contract-only unit.
- Fixture parsing, scanner replay, and fixture inventory are deterministic and side-effect-free except for bounded temporary test files removed after the inventory test.

## Known risks and deferred compatibility

- Workspace ADR-0002/ADR-0003 files outside the server repository still contain older Mongo-ID-as-`leadno` wording. This server-only unit did not edit out-of-repository files. Active server guidance now points to the final specification as Granot identity authority and no longer links ADR-0003 as the identity contract.
- Production normalization, receipt persistence, matching, Registry policy, commands, cases, flags, migrations, and effects remain assigned to later units.

## Handoff

Successful Unit 01 verification unblocks contract refinement for Units 02, 05, and 09. Their current scaffold status is not implementation authorization; repository state and this report must be reverified by the next primary session.

## Final `git status --short`

```text
 M .cursor/businesslogic/adminSearch.service.md
 M .cursor/businesslogic/form-lead.service.md
 M .cursor/businesslogic/formLeadSearch.service.md
 M .cursor/rules/business-logic.mdc
 M .cursor/rules/owner-lead-workflow.mdc
 M .cursor/rules/project-organization.mdc
 M docs/granot-lifecycle-prototype-and-implementation-seams.md
 M docs/granot-webhook-domain-service-model.md
 M docs/showcase/owner-workflow.md
 M docs/showcase/presentation-test-values.md
 M src/services/crm/formLeadPayload.test.ts
 M src/services/granotHttpCollector/formWorkflow.test.ts
?? .cursor/agents/
?? scripts/prototypes/granot-lead-lifecycle/delivery/
?? src/services/granotLifecycle/
```

The untracked `.cursor/agents/` specification extractor and delivery pack were user-owned inputs present before implementation. Unit 01 added the `src/services/granotLifecycle/` tree and updated the delivery pack's status/completion report without rewriting the extractor.

No commit, push, deploy, production mutation, live payload exposure, external call, or external send occurred.
