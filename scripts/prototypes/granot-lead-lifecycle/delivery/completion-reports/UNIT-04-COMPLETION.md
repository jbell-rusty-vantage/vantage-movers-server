# Unit 04 completion — Observation persistence and exact normalization vocabulary

## Status and scope

- **Status:** complete
- **Repository / branch:** `vantage-main-server` / `granot-lead-lifecycle`
- **Authoritative contract:** final specification Sections 1–2, 4–7, 9.1, 10, 27, 35–36, 37.1–37.2, and 38/S03
- **Acceptance ownership:** AC-05; AC-06; Booking Action alias portion of AC-25; provider/source-separation portion of AC-29
- **Applicable invariants preserved:** 1, 2, 3, 5, 8, 9, and 10
- **Runtime posture:** callable `normalizeGranotReceipt` / `upsertGranotObservation` persist one Observation per receipt. Capture does not invoke normalization. No processor, flags, Registry resolution, matching, Decision, or Lead/Booking/Cancellation mutation.

## Files added or changed

### Model and shared enums

- `src/models/GranotObservation.ts` — Section 10 document, write-once evidence, six named indexes, collection `granot_observations`.
- `src/models/GranotObservation.test.ts` — `[AC-05]` `[AC-06]` `[AC-25]` `[AC-29]` shape, frozen enums, unique `receipt_id` only, forbidden widening/effects.
- `src/models/granotLifecycleSchemas.ts` — Observation kind/result/issue/action enums coupled to frozen Unit 01 types.

### Normalization module

- `src/services/granotLifecycle/normalization.ts` — owns every Section 10 rule; pure candidate + one-per-receipt upsert.
- `src/services/granotLifecycle/normalization.test.ts` — complete field/rule matrix and every Unit 01 fixture.
- `src/services/granotLifecycle/normalization.persistence.test.ts` — sequential/concurrent reuse, differing-candidate integrity, invalid persist, technical-failure no second row.

### Indexes

- `scripts/migrations/granot-lifecycle-indexes.ts` / `.lib.ts` / `.test.ts` — Observation catalog, `receipt_id` collision report, non-unique-then-unique apply order, verify names/definitions. Script version `granot-lifecycle-indexes/2`.

### Docs

- `.cursor/businesslogic/granotLifecycle.normalization.md`
- `.cursor/businesslogic/granotLifecycle.capture.md`
- `.cursor/index.md`
- `.cursor/rules/project-organization.mdc`
- `.cursor/rules/granot-lifecycle-capture.mdc`
- `.cursor/rules/schema-and-crud-inputs.mdc`
- `.cursor/rules/owner-lead-workflow.mdc`
- `.cursor/rules/business-logic.mdc`
- `docs/to_review/granot-lifecycle-prototype-and-implementation-seams.md`
- `docs/to_review/granot-webhook-domain-service-model.md`

## Normalization interface and decisions

Public seam:

- `normalizeGranotReceipt(receipt)` — already-read typed receipt for pure tests.
- `upsertGranotObservation({ receipt_id } | { receipt })` — load (if needed), normalize, persist.
- `persistObservationCandidate` — upsert algorithm used by tests and the mongoose store.

Result precedence: non-object / route-event conflict stays `invalid`; unsupported Booking Action stays `unsupported`; Priority cannot change those outcomes. Priority Update missing/malformed → `invalid` + `invalid_priority`. Otherwise-supported events with issues → `valid_with_issues`; none → `valid`.

**Timezone decision:** `America/New_York` as the Vantage business timezone (existing reporting default). Move dates are strict `MM/DD/YYYY` stored as that calendar day's start in this zone.

**String bounds** (`NORMALIZATION_FIELD_BOUNDS`): source 200, job 64, form ref 128, names 100, phone 32, email 254, city 100, state raw 16, zip 16, service/move size 64, cubic/money 32, agent 100, event type 64, provider type 32, move date 16. Over-bound input emits the applicable issue and does not manufacture a valid identity.

**Raw preservation:** Priority keeps the exact JSON-safe raw value. Other `*_raw` strings keep the bounded scalar, not credentials or whole subobjects. Payload `type` is only `provider_context.type_raw`.

**Collection name decision:** `granot_observations` (final spec does not name the collection; this follows existing snake_case plural model convention).

## Indexes

| Name | Definition |
| --- | --- |
| `granot_observation_receipt_id_unique` | unique `{ receipt_id: 1 }` |
| `granot_observation_kind_captured` | `{ kind: 1, captured_at: -1 }` |
| `granot_observation_normalized_job_no_captured` | `{ "identity.normalized_job_no": 1, captured_at: -1 }` |
| `granot_observation_source_route_captured` | `{ normalized_source_label: 1, route_event_class: 1, captured_at: -1 }` |
| `granot_observation_normalized_form_ref_captured` | `{ "identity.normalized_form_ref": 1, captured_at: -1 }` |
| `granot_observation_normalized_phone_captured` | `{ "contact.normalized_phone": 1, captured_at: -1 }` |

Report/verify functions exist and are unit-tested. Production `--apply` was **not** run. Local tests did not apply indexes to a database.

## Flags, migrations, and effects

- Flags before/after: none / none. `src/config/domain/granotLifecycle.ts` was not created.
- Data migration: none. Historical receipts were not backfilled.
- All effect flags remain nonexistent/false.
- Zero Lead / Booking / Cancellation / Decision / case / discrepancy / Sheet Sync / notification writes.

## AC-to-proof coverage

| AC | Proof |
| --- | --- |
| AC-05 | `normalization.test.ts` Priority matrix + fixture loop + parity; model indexes/shape; persistence one-per-receipt |
| AC-06 | missing/malformed Priority Update vs independent events; non-object/conflict/unsupported precedence; fixtures |
| AC-25 alias | exact `Booked` / `Releas` / `Release` vs `Released`/prefix; no official action fields |
| AC-29 portion | `type=AUTO` provider-only; Paid Overflow / Auto labels evidence-only |

Every owned Unit 04 test name includes `[AC-05]`, `[AC-06]`, `[AC-25]`, and/or `[AC-29]`. All 28 Unit 01 fixtures run through production `normalizeGranotReceipt`. Failure messages print fixture IDs, not values.

## Verification

- Required focused command:
  - `node --import tsx --import ./scripts/test-setup.ts --test "src/services/granotLifecycle/*.test.ts" "src/models/GranotObservation.test.ts" "src/models/GranotObservationReceipt.test.ts" "scripts/migrations/granot-lifecycle-indexes.test.ts"`
  - **67 passed, 0 failed**.
- Full repository command:
  - `pnpm test`
  - **993 passed, 0 failed**.
- TypeScript:
  - `pnpm typecheck`
  - **passed**.
- `git diff --check`: **passed** (line-ending conversion warnings only).

## Persistence, concurrency, and privacy

- One-per-receipt sequential reuse and duplicate-key race reuse are proven through an injectable store that simulates Mongo `11000`.
- Differing-candidate reprocess throws `ObservationIntegrityError` and does not overwrite the stored row.
- Invalid/unsupported candidates persist as completed classifications.
- Technical insert failure leaves zero rows.
- Local Mongo on `127.0.0.1:27017` was **closed**. Replica-set insert/uniqueness is therefore **not claimed**. The upsert algorithm is proven at the store interface, not against a live replica set.
- Synthetic fixtures only. No raw payload/contact values were printed.

Preview/staging live verification: **not run**. No approved staging synthetic DB was authorized.

## Known risks and deferred compatibility

- Collection name `granot_observations` is a Unit 04 decision; the final specification does not name it.
- IANA timezone `America/New_York` is a Unit 04 decision for “Vantage business timezone.”
- Numeric string maximums are documented conservative bounds, not spec-named constants.
- `missing_job_number` is not emitted for an absent Job Number (Section 10 treats empty as absent).
- Case-insensitive `lead_created` follows UNIT-04; `priority_update` / `priority_updated` also accept case-folded tokens because fixture validation lowercases event types.
- Live Mongo unique-index rejection and replica-set races remain unverified until a test replica set is available.
- Capture still does not call normalization. Processor/activation remain later units.
- User-owned untracked/modified Unit 08–10 issue files were preserved and were not rewritten.

## Handoff

Successful Unit 04 verification unblocks **Unit 05** as the next sequential shared-branch implementation target. Unit 07 still also requires Units 05–06. Unit 08 still also requires Unit 07. Units 16–17 still also require later identity/processor units.

## Final `git status --short`

```text
 M .cursor/businesslogic/granotLifecycle.capture.md
 M .cursor/index.md
 M .cursor/rules/business-logic.mdc
 M .cursor/rules/granot-lifecycle-capture.mdc
 M .cursor/rules/owner-lead-workflow.mdc
 M .cursor/rules/project-organization.mdc
 M .cursor/rules/schema-and-crud-inputs.mdc
 M docs/to_review/granot-lifecycle-prototype-and-implementation-seams.md
 M docs/to_review/granot-webhook-domain-service-model.md
 M scripts/migrations/granot-lifecycle-indexes.lib.ts
 M scripts/migrations/granot-lifecycle-indexes.test.ts
 M scripts/migrations/granot-lifecycle-indexes.ts
 M scripts/prototypes/granot-lead-lifecycle/delivery/UNIT-STATUS.md
 M scripts/prototypes/granot-lead-lifecycle/delivery/issues/UNIT-08.md
 M scripts/prototypes/granot-lead-lifecycle/delivery/issues/UNIT-09.md
 M scripts/prototypes/granot-lead-lifecycle/delivery/issues/UNIT-10.md
 M src/models/granotLifecycleSchemas.ts
?? .cursor/businesslogic/granotLifecycle.normalization.md
?? scripts/prototypes/granot-lead-lifecycle/delivery/completion-reports/UNIT-04-COMPLETION.md
?? src/models/GranotObservation.test.ts
?? src/models/GranotObservation.ts
?? src/services/granotLifecycle/normalization.persistence.test.ts
?? src/services/granotLifecycle/normalization.test.ts
?? src/services/granotLifecycle/normalization.ts
```

User-owned Unit 08–10 issue and contract-ledger edits present before this session were preserved. No commit, push, deploy, production mutation, live Granot call, current customer payload inspection, or external send occurred.
