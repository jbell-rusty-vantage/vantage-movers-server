# Unit 04 — Observation persistence and exact normalization vocabulary

> **Contract maturity: implementation-ready once Unit 03 is complete.** This is S03. It converts one immutable receipt into one immutable-in-meaning normalized Observation and proves the complete normalization/result vocabulary. It performs no matching, policy evaluation, Decision, or aggregate mutation.

## 1. Authority and required reading

- **Final specification:** Sections 1–2, 4–7, 9.1, 10, 27, 35–36, 37.1–37.2, and 38/S03.
- **Acceptance ownership:** AC-05 and AC-06 normalization; Booking Action alias portion of AC-25; provider/source-separation portion of AC-29.
- **Fixture contract:** Unit 01 shared types, `testSupport/normalizationFixture.ts`, and all redacted synthetic lifecycle fixtures.
- **Predecessor evidence:** Unit 01–03 completion reports and landed repository state.
- **Canonical language/execution:** workspace `CONTEXT.md` and delivery runbook.

The final specification wins. Frozen Unit 01 unions must not be widened. Do not copy prototype outcomes or Intake/lifecycle-status vocabulary.

## 2. Objective

Add `GranotObservation` persistence and one production `normalization.ts` module that deterministically normalizes receipts from webhook, browser extension, and HTTP automation into the exact Section 10 document/result/issue vocabulary. Reprocessing a receipt reuses its one Observation. Invalid and unsupported evidence completes normalization explicitly and safely; it is not treated as a technical retry.

## 3. Repository, branch, and prerequisites

- **Repository:** `vantage-main-server`; branch `granot-lead-lifecycle`.
- **Blocked by:** Units 01–03.
- Reverify receipt channel/operation validators, credential-redacted evidence, current Unit 01 fixtures/scanner, and Unit 03 capture behavior before editing.
- No commit, push, deploy, production mutation/apply, live payload inspection, Granot call, or external send.

## 4. Current-state evidence to verify

Observed on 2026-08-17:

- Frozen unions exist at `src/services/granotLifecycle/types.ts`; fixture schemas/builders live under `testSupport/` and already cover priority, action aliases, source/provider separation, and channel parity.
- No production `src/models/GranotObservation.ts` or `src/services/granotLifecycle/normalization.ts` exists.
- Unit 02 receipt model supplies channel, route/operation authority, `captured_at`, redacted payload/hash, and unique operation-ID behavior.
- Existing canonical helpers are `src/services/bookings/bookingIdentity.ts#normalizeJobNo` and `src/utils/phone.ts#normalizePhoneNumberForMatch`; reuse them.
- No lifecycle processor/activation/flags exist. Unit 04 must expose a callable normalization/upsert service for later orchestration, not create its own worker.

If fixtures have evolved, production behavior must satisfy the authoritative Section 10 contract and keep fixture expectations/schema aligned in the same change.

## 5. Invariants at risk

- **Invariant 1:** MongoDB is System of Record; the durable Observation references its receipt.
- **Invariant 2:** Observation is evidence, never official Booking/Cancellation authority. Normalized `booked`/`release` cannot trigger official changes.
- **Invariant 3:** do not add a lifecycle enum.
- **Invariant 5:** normalization invokes no aggregate write/canonical command.
- **Invariant 8:** source system/channel/provider context remain separate; payload `type` cannot become source classification.
- **Invariant 9:** preserve raw point-in-time evidence fields; later evidence does not overwrite earlier Observations.
- **Invariant 10:** normalization never assigns/reassigns Source Company, Source Granularity, Ingestion Origin, or CPL.

## 6. Deliverables and exact contract

### 6.1 `GranotObservation` model

Add `src/models/GranotObservation.ts` with the exact Section 10 shape:

```ts
type GranotObservationDocument = {
  _id: ObjectId;
  receipt_id: ObjectId;
  schema_version: 1;
  kind: GranotObservationKind;
  normalization_result: NormalizationResult;
  route_event_class?: GranotRouteEventClass;
  payload_event_type_raw?: string;
  source_label_raw?: string;
  normalized_source_label?: string;
  granot_crm_source_id?: ObjectId;
  captured_at: Date;
  identity: { job_no_raw?: string; normalized_job_no?: string; form_ref_raw?: string; normalized_form_ref?: string };
  contact: { first_name?: string; last_name?: string; display_name?: string; phone_raw?: string; normalized_phone?: string; email_raw?: string; normalized_email?: string };
  move: { move_date_raw?: string; move_date?: Date; service_type_raw?: string; granot_move_size_raw?: string; estimated_cubic_feet_raw?: string; estimated_cubic_feet?: number; origin?: { city?: string; state?: string; zip?: string }; destination?: { city?: string; state?: string; zip?: string } };
  priority: { raw?: unknown; canonical?: string; valid: boolean };
  booking_action: { raw?: string; normalized?: GranotBookingAction };
  display_money: { estimate?: { raw: string; canonical?: string }; payment?: { raw: string; canonical?: string }; balance?: { raw: string; canonical?: string } };
  agent_identity: { user_raw?: string; rep_raw?: string };
  provider_context: { type_raw?: string };
  issues: Array<{ code: NormalizationIssueCode; path?: string; severity: "warning" | "error" }>;
  createdAt: Date;
  updatedAt: Date;
};
```

Indexes:

```ts
{ receipt_id: 1 } unique
{ kind: 1, captured_at: -1 }
{ "identity.normalized_job_no": 1, captured_at: -1 }
{ normalized_source_label: 1, route_event_class: 1, captured_at: -1 }
{ "identity.normalized_form_ref": 1, captured_at: -1 }
{ "contact.normalized_phone": 1, captured_at: -1 }
```

Declare explicit stable index names and add them to the existing lifecycle index report/apply/verify contract. `receipt_id` is the only unique Observation index. Do not add TTL or unique identity/contact/source indexes.

`granot_crm_source_id` is optional future linkage; Unit 04 does not resolve or populate it. Observation rows contain no processing state, target, source policy, desired state, or effect.

### 6.2 Deep normalization interface and one-per-receipt upsert

`src/services/granotLifecycle/normalization.ts` owns every rule. Expose a narrow interface accepting a receipt ID (or an already-read typed receipt for pure testing) and returning the persisted Observation/result. Routes and later consumers must not normalize fields themselves.

- Read immutable receipt evidence; validate channel authority before payload interpretation.
- Produce exactly one deterministic Observation candidate.
- Persist with an upsert keyed by `receipt_id`; concurrent/repeated calls return/re-read the single row.
- Reprocessing must not create a second Observation or reinterpret an already-persisted Observation under changed code. If a concurrent candidate differs from the stored row, fail safely and surface a technical integrity error; do not overwrite evidence silently.
- Invalid/unsupported normalization persists the Observation with exact result/issues and is a completed business classification, not a thrown retryable parsing failure.
- Technical database/dependency failures throw and create no partial second row.

### 6.3 Scalar and bounded-string rules

- Only scalar values participate in scalar normalization. Arrays/objects are invalid for the applicable field and never stringify to `[object Object]`.
- Strings are Unicode NFKC, trimmed, and bounded. Choose/document conservative field-specific maximums and emit the applicable issue rather than retaining unbounded input; do not truncate in a way that manufactures a valid identity.
- Preserve the exact JSON-safe raw Priority value. For other `*_raw` strings preserve the bounded raw scalar required by Section 10, not credentials or whole subobjects.
- Source label: preserve `source_label_raw`; normalized lookup label is NFKC + trim + collapsed internal whitespace + lowercase. Empty/control/bidi/invalid values add `invalid_source_label`.
- Job Number: use existing `normalizeJobNo` (NFKC, trim, non-letter/digit runs to one space, collapsed whitespace, uppercase); empty is absent.
- Form reference: trim; blank, `not provided`, and `not_provided` case-insensitively become absent and are never exact identities. Preserve bounded raw evidence and add `invalid_form_reference` when malformed.
- Phone: use `normalizePhoneNumberForMatch`; email: trim/lowercase with validity issue on malformed input.
- Preserve raw `user` and `rep`; do not look up Agents here. Differing identities are evaluated by policy later, not assigned here.

### 6.4 Move and display normalization

- State is uppercase two-letter code or absent; invalid present state adds `invalid_state`.
- Move date accepts strict `MM/DD/YYYY` in the Vantage business timezone and stores the corresponding Date. Reject impossible/calendar-invalid dates with `invalid_move_date`; do not use permissive JS parsing or UTC date drift.
- Cubic feet accepts a nonnegative finite integer. Preserve raw scalar; invalid is omitted and adds `invalid_cubic_feet`.
- Estimate/payment/balance accept a nonnegative decimal with at most two fractional digits, preserve raw string, and store canonical decimal string. Invalid adds `invalid_money`.
- Display money is evidence/display only and never a domain command input.
- Normalize origin/destination city/state/zip independently and do not infer move type or Registry route in this unit.

### 6.5 Channel authority and event classification

- Non-object payload/statement → `invalid` with `payload_not_object`.
- Webhook derives Observation kind from `route_event_class`; payload cannot reroute it.
- Extension/automation derive authority from `channel_operation_kind`:
  - `lead_snapshot_apply` → `lead_snapshot`, never create-if-missing authority, and a Booked/Release payload event is `invalid` with route/event conflict;
  - `booking_action_apply` → `booking_action_snapshot` and requires supported Booking Action.
- `lead_created` route accepts absent or case-insensitive exact `lead_created`; absence is warning `missing_payload_event_type`; incompatible nonempty is `invalid` + `route_payload_event_conflict`.
- `priority_updated` accepts absent, `priority_update`, or `priority_updated`; absence is the same warning; incompatible nonempty is invalid conflict.
- `booking_status_changed` requires a supported action in payload `event_type`.
- Case-insensitive exact `Booked` → `booked`.
- Case-insensitive exact `Releas` or `Release` → `release`.
- Every other well-formed value, including `Released`, is `unsupported` + `unsupported_booking_action`; never prefix-match.
- `booked`/`release` are repeatable evidence, not lifecycle transitions or official facts (AC-25 alias portion only).

### 6.6 Priority rules and result precedence

Priority accepts a JSON nonnegative safe integer or trimmed string matching `^[0-9]{1,12}$`. Canonical strips leading zeroes (`05 → 5`, all-zero → `0`). Exact raw remains evidence.

- Every valid canonical value is retained and later eligible for `granot_priority`.
- Only `1`/`5` later authorize broad enrichment and `quoted = true`; none sets false. Unit 04 applies neither effect.
- Priority Update missing/malformed Priority → `invalid`, `invalid_priority`, no independent action.
- Lead Created/Booked/Release missing or malformed Priority: omit Priority effect but preserve independent event as `valid_with_issues` + `invalid_priority`.
- An event-class conflict/non-object payload remains `invalid`; unsupported Booking Action remains `unsupported`. Do not let Priority downgrade/upgrade those primary outcomes.
- A supported otherwise-valid event with only warnings/issues is `valid_with_issues`; no issues is `valid`.

### 6.7 Source/provider separation

- Preserve provider `type` only at `provider_context.type_raw`.
- `type=AUTO` never supplies/changes source label, normalized source label, Registry ID, route, disposition, or scope.
- Paid Overflow and a future actual source label Auto normalize as labels/evidence; their deferred classification belongs to Registry policy (Units 05–06).

### 6.8 Documentation

Document the production normalization boundary, exact result semantics, channel authority, Priority/action rules, and one-Observation-per-receipt behavior under `.cursor/businesslogic/`. Update project organization for the model/module. Do not claim matching/effects exist.

## 7. Explicitly out of scope

- Registry resolution/population of `granot_crm_source_id`, Source Scope, Best Relocation routing, matching, temporal winner, Decisions, activation, links, desired state, flags, processor/drainer/retries.
- Any Lead/Booking/Cancellation/case/discrepancy/command/Sheet Sync/notification mutation.
- Extension/automation route cutover or operation-ID replay handling.
- Historical receipt batch processing/backfill, raw Admin reads, migration of payloads, current payload sampling, or production apply.
- Adding issue/outcome strings beyond frozen Section 7 vocabulary.

## 8. Flags and runtime posture

- **Starting/ending flags:** none/none; no Section 27 config module yet.
- S03 permits processing only in shadow, but no processor/activation exists in this unit. Normalization runs only through focused tests/direct module invocation.
- All effect flags remain nonexistent/false.

## 9. Migration and indexes

- **Data migration:** none. Do not backfill historical receipts in Unit 04.
- **Indexes:** extend `migration:granot-lifecycle:indexes` and its shared model index catalog for the six Observation indexes. Default/report is read-only; report collisions for unique `receipt_id`; apply requires the existing explicit production confirmation and separate authorization; verify matches model names/definitions.
- Local tests may apply only to verified test DB. Assignment never authorizes production apply.

## 10. Acceptance criteria

- [ ] Exact model shape, frozen enums, six named indexes, and unique `receipt_id` are proven at model level.
- [ ] One receipt produces one Observation; sequential/concurrent reprocessing returns one stored row and never overwrites differing evidence.
- [ ] Non-object and invalid/unsupported inputs persist exact terminal normalization vocabulary without a technical retry.
- [ ] Webhook route class and extension/automation operation kind are the sole event authorities; conflicting payload event cannot reroute.
- [ ] Exact scalar/source/identity/contact/move/money/Agent/provider rules are covered, including NFKC/control/bidi/bounds and impossible dates.
- [ ] **AC-05:** `0`, `1`, `5`, `8`, `05`, all-zero, and a 12-digit allowed Priority retain exact raw/canonical/valid values; Unit 04 performs no enrichment/Quoted effect.
- [ ] **AC-06:** missing/malformed Priority invalidates Priority Update but yields `valid_with_issues` for otherwise-supported Lead Created/Booked/Release.
- [ ] **AC-25 alias portion:** exact case-insensitive `Booked`, `Releas`, and `Release` normalize correctly; `Released` and every other action are unsupported, never prefix-inferred, and cause no official action.
- [ ] **AC-29 portion:** `type=AUTO` remains provider context; Paid Overflow/Auto labels do not gain source classification/effects.
- [ ] Webhook/extension/automation parity fixtures produce equal normalized business fields where their channel contracts permit.
- [ ] Invalid money remains display-only evidence with issue; no display money becomes domain input.
- [ ] Index report/verify includes Observation indexes and refuses unique creation on receipt collisions.
- [ ] No Registry resolution, target matching, Decision, processing worker, flag, or aggregate effect lands.

Every owned test includes `[AC-05]`, `[AC-06]`, `[AC-25]`, and/or `[AC-29]`.

## 11. Required tests and commands

Minimum locations:

- `src/services/granotLifecycle/normalization.test.ts` — pure complete field/rule matrix and every Unit 01 fixture;
- `src/models/GranotObservation.test.ts` — paths/validators/index definitions and forbidden widening;
- normalization persistence/module integration test — one-per-receipt upsert, repeat/concurrency/different-candidate safety;
- lifecycle index migration tests — collision/report/apply-order/verify;
- Unit 01 fixture schema/security and Unit 02 receipt regressions.

Mongo uniqueness/concurrency claims require replica-set integration evidence. Use redacted synthetic fixtures only; failure output prints fixture ID/path, not values.

```text
node --import tsx --import ./scripts/test-setup.ts --test "src/services/granotLifecycle/*.test.ts" "src/models/GranotObservation.test.ts" "src/models/GranotObservationReceipt.test.ts" "scripts/migrations/granot-lifecycle-indexes.test.ts"
pnpm test
pnpm typecheck
```

## 12. Live/staging verification

No production/current-payload verification. Local or explicitly approved staging only:

- normalize redacted synthetic receipts for each route and operation kind;
- invoke the same receipt twice and inspect Observation count/ID/result/issues only;
- inspect stored keys and masked/bounded diagnostics, never raw payload/contact values;
- prove zero Lead/Booking/Cancellation/Decision/case/discrepancy/Sheet Sync/notification deltas.

## 13. Rollback

Disable/remove the normalization caller first; captured receipts remain durable. Revert module/model code if needed but preserve committed Observations and receipts. Do not drop indexes or delete/overwrite evidence as rollback. Index removal/additive-field cleanup requires separately authorized Section 34.7 tooling.

## 14. Required completion handoff

Use Runbook Section 13 and include:

- exact model/index names and whether report/apply/verify ran;
- normalization interface, result precedence, string bounds/timezone decision, and raw-preservation policy;
- fixture IDs/ACs and focused/full test counts;
- one-per-receipt concurrency/idempotency proof;
- flags none/none and zero forbidden-effect assertions;
- masked staging evidence or not-run reason;
- no production apply/current payload/external action;
- final `git status --short`; and
- newly unblocked contract/implementation dependencies (Unit 07 still also requires Units 05–06).

Do not complete Unit 04 with a failed command, uncovered fixture/rule, duplicate/overwritten Observation, widened vocabulary, or any aggregate effect.
