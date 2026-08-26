# Say What This Granot Receipt Observed — operational story

- Status: recommended
- Service: `granotLifecycle` (Wave A, in-progress)
- Pass: 6 of this service — `normalization.ts`
- Remaining in this service: `sourcePolicy.ts`, `identity.ts`, and the rest of the `granotLifecycle` checklist in TRAVERSAL.md
- Target: `src/services/granotLifecycle/normalization.ts`
- Knowledge: `docs/knowledge/granot-lifecycle/normalization.md`. Distinct from receipt insert: `recommendations/granot-lifecycle-capture.md` + `docs/knowledge/granot-lifecycle/capture.md`. Distinct from the webhook queue wake-up: `recommendations/granot-lifecycle-queue-publisher.md`. Distinct from Owner extension apply: `recommendations/granot-lifecycle-extension-apply.md`. Distinct from HTTP automation apply / readiness: `recommendations/granot-lifecycle-automation-apply.md`, `recommendations/granot-lifecycle-automation-compatibility.md`. Distinct from fail-closed Registry policy: next module `sourcePolicy.ts` + `docs/knowledge/granot-lifecycle/source-policy.md`. Distinct from source-scoped identity / desired-state / processor / drain: `docs/knowledge/granot-lifecycle/identity.md`, `desired-state.md`, `processor.md`, `drainer.md`. Distinct from source-label fold: sibling `sourceLabel.ts`. Distinct from apply-item hint names: sibling `applyItem.ts`. Distinct from Follow Up / Booked Jobs CSV write: `recommendations/enrichment-call-lead-enrichment.md` / `recommendations/reconciliation-booked-call-lead.md`. Distinct from historical-sheet `historicalConsolidation/normalization.ts`. This checkout’s `CONTEXT.md` does not define Granot Observation / Granot Observation Receipt / Granot Priority / Granot Booking Action / Observation Channel — do not invent a glossary copy. `docs/adr/` is absent here — do not invent ADR copies.
- Callers: `processor.ts` `defaultUpsertObservation` (`upsertGranotObservation({ receipt_id })` only; injected processor deps usually skip this file). `validation/v1/granotLifecycle.validation.ts` (extension apply Zod: `NORMALIZATION_FIELD_BOUNDS` string max + `isSupportedGranotBookingAction` on `event_type`). Tests: `normalization.test.ts` (Unit 01 fixtures + Section 10 rules), `normalization.persistence.test.ts` (one-row upsert + integrity), `crossChannel.test.ts` (`extractNormalizationStatement` + webhook/extension/automation parity), `normalizationFixtures.test.ts` (fixture schema, not the fold). Script: `scripts/granot-lifecycle-unit34/current-shapes.test.ts` (sanitized family → `normalizeGranotReceipt`). Not callers: `capture.ts`, `extensionApply.ts`, `automationApply.ts`, `sourcePolicy.ts`, `identity.ts`, `leadDesiredState.ts`, `createLeadFromGranot.ts`, webhook routes.
- Seams callers need: pure candidate vs persist; load-by-`receipt_id` vs already-read receipt; injected `ObservationStore`; Booking-action fold + field bounds for Zod; same-meaning reuse vs `ObservationIntegrityError`
- Split later (only if the file outgrows one sitting): `sayWhatThisGranotReceiptObserved.ts` / `keepTheObservationForThisReceipt.ts` — story files, never `identity.ts` / `contact.ts` / `move.ts`, and never `create.ts` / `update.ts` / `delete.ts`

`normalizeGranotReceipt` / `upsertGranotObservation` / `persistObservationCandidate` are executor mechanics. The owner question is: *Granot just sent a statement — webhook, extension row, or HTTP automation action. What did it observe? Fold the receipt into one Granot Observation: kind, identity, contact, move, Priority, Booking Action, display money. Invalid and unsupported still persist — they are finished classifications, not thrown parse failures. If we already kept an Observation for this receipt and the meaning changed, refuse. Never match a Lead. Never resolve Registry policy. Never write a Booking.*

Capture, claim/drain, source policy, identity, desired-state, Lead create/sync, Booking/Release cases, and CSV Follow Up / Booked Jobs writes already live in other **modules**. Do not pull those in.

## What this file actually does

Two operations of one story, not “a normalization CRUD service,” and not capture / policy / match:

1. **Say what this Granot receipt observed** — take a typed receipt envelope plus payload. Refuse a malformed envelope (`assertReceiptChannelShape`: webhook missing `route_event_class`, extension/automation missing `channel_operation_kind`). If the payload is not a plain object, the result is `invalid` + `payload_not_object` with empty facts. If the payload looks like an apply-item envelope (`granot_statement` plus `operation_kind` / `operation_id`), unwrap it when the hint is recognized or absent and the kind/id match the receipt; otherwise keep the outer object. Kind comes from the **channel**, never from payload `event_type`: webhook `lead_created` / `priority_updated` → `lead_snapshot`; webhook `booking_status_changed` → `booking_action_snapshot`; channel `lead_snapshot_apply` → `lead_snapshot`; channel `booking_action_apply` → `booking_action_snapshot`. Payload `event_type` may only confirm or conflict. Fold source label (`label` or `source` through `normalizeGranotSourceLabel`), Job Number (`normalizeJobNo`), form ref (sentinels `not provided` / `not_provided` / blank become absent), contact, move (strict `MM/DD/YYYY` in `America/New_York`), Priority, display money, raw `user` / `rep`, and `type` only at `provider_context.type_raw`. Result precedence: route/event conflict or non-object stays `invalid`; unsupported Booking Action stays `unsupported`; Priority Update missing/malformed Priority → `invalid`; other malformed scalars → `valid_with_issues`; no issues → `valid`. This function does not load Mongo. It does not set `quoted`. It does not write `granot_crm_source_id`. It does not emit `missing_job_number` or `granot_agent_identity_conflict`.

2. **Keep that Observation for this receipt** — load the receipt by id, or take an already-read typed receipt. Build the candidate. Find the existing Observation by `receipt_id`. Same meaning → reuse (`created: false`). Missing row → insert. Duplicate-key race → reload and compare. Different meaning → `ObservationIntegrityError` and **no overwrite**. Invalid and unsupported candidates persist. Technical insert failure creates no second row. Unique index is `receipt_id` only. The Observation holds no processing state, source policy, desired state, or effect.

There is no third mutate operation. `extractNormalizationStatement` is the envelope unwrap for operation 1. `normalizeBookingAction` / `isSupportedGranotBookingAction` are the Booking-action fold Zod already needs. `observationMeaningEquals` is the integrity compare for operation 2. Webhook vs extension vs automation are three envelopes on one fold, not three stories in this file.

## Organization

Keep one file. This is the screenplay for “say what this Granot receipt observed, then keep that Observation.” The file is long because Section 10 field rules live here; the persist adapter is short. Capture, claim, policy, identity, and desired-state already live in deeper **modules**. Do not pull those in. Do not invent a `NormalizationService` class. Do not invent a canonical-command `begin` / `complete` **seam** — persist is one-row evidence, not a Domain Command. Do not invent a Form-shaped found / ambiguous **seam** that has only one real adapter here.

Do not split this ~1,000-line file into `identity.ts` / `contact.ts` / `move.ts`. Those are beats of one fold. Do not move the source-label fold into `sourceLabel.ts` beyond the helper this file already calls. Do not move persist into `processor.ts` “because the processor upserts.” Do not merge this file into `historicalConsolidation/normalization.ts` so “every normalize lives together.” Do not move `calendarDateInBusinessTimezone` into later `granotTemporal.ts` so “every date lives together.”

**External interface** stays small (this is the test surface):

| Keep exporting | Story name | Why the seam exists |
|---|---|---|
| `normalizeGranotReceipt` | `sayWhatThisGranotReceiptObserved` | fixtures, cross-channel parity, Unit 34 shapes, persist builds this first |
| `upsertGranotObservation` | `keepTheObservationForThisReceipt` | processor default; already-read receipt **adapter** |
| `persistObservationCandidate` | `keepThisObservationCandidate` | tests inject the store without re-loading a receipt |
| `observationMeaningEquals` | `thisObservationStillMeansTheSameThing` | reuse vs integrity refuse |
| `extractNormalizationStatement` | `unwrapTheApplyItemEnvelope` | cross-channel tests lock unwrap without a second policy |
| `normalizeBookingAction` | `readTheGranotBookingAction` | exact Booked / Releas / Release; never prefix-match |
| `isSupportedGranotBookingAction` | `isThisASupportedGranotBookingAction` | extension apply Zod; Call ≠ Form is not this fold |
| `calendarDateInBusinessTimezone` | `calendarDateInVantageBusinessTimezone` | move-date proof; `America/New_York` |
| `ObservationIntegrityError` | `ObservationMeaningChangedError` | persist fail-closed |
| `NORMALIZATION_FIELD_BOUNDS` | `ObservationFieldBounds` | Zod statement string max |
| `PRIORITY_BROAD_ENRICHMENT_CANONICALS` | `PrioritiesThatLaterAuthorizeBroadEnrichment` | contract only — this file applies neither effect |
| `VANTAGE_BUSINESS_TIMEZONE` | `VantageBusinessTimezone` | move-date timezone decision |
| `NormalizedObservationCandidate` | `WhatThisReceiptObserved` | the handoff the persist **adapter** keeps |
| `ObservationStore` | `ObservationKeepStore` | test **seam**: find-by-receipt / insert |

Keep the old names as one-line aliases until `processor.ts` and the extension Zod migrate. Do not make callers learn `schema_version` / `11000` / `stableJson` as the domain language.

`ObservationStore` stays a test **seam**. It is not a third public operation. Default remains Mongo `findOne({ receipt_id })` / `create`.

**No class for the workflow.** The type that *does* earn a name is the candidate persist will keep or refuse:

```ts
type WhatThisReceiptObserved = {
  schema_version: 1
  kind: "lead_snapshot" | "booking_action_snapshot"
  normalization_result: "valid" | "valid_with_issues" | "invalid" | "unsupported"
  captured_at: Date
  identity: { /* job / form ref raw + normalized */ }
  contact: { /* names, phone, email */ }
  move: { /* date, size, cubic feet, origin / destination */ }
  priority: { raw?: unknown; canonical?: string; valid: boolean }
  booking_action: { raw?: string; normalized?: "booked" | "release" }
  display_money: { estimate?: { raw: string; canonical?: string }; payment?: …; balance?: … }
  issues: Array<{ code: NormalizationIssueCode; path?: string; severity: "warning" | "error" }>
  /* source label, agent raw, provider type raw — evidence only */
}
```

That is the handoff from “we folded the receipt” to “Mongo may keep one row.” Do **not** add `quoted` / `granot_crm_source_id` / `source_policy` so “the Observation looks like a Decision,” and do **not** add processing state so “the Observation can be claimed.”

## The file, as a story

Parent functions stay deep. Child names are only extracted when they hide a real decision, not a one-liner.

```ts
// normalization.ts
// Granot sent a statement.
// What did it observe?
// Fold the receipt into one Granot Observation.
// Invalid and unsupported still persist — they are finished classifications.
// If we already kept an Observation for this receipt and the meaning changed, refuse.
// This file does not match a Lead.
// This file does not resolve Registry policy.
// This file does not write a Booking.
// This file does not set quoted.

// ── 1. Say what this Granot receipt observed ──────────────

export function sayWhatThisGranotReceiptObserved(receipt)

function refuseAMalformedReceiptEnvelope(receipt)   // assertReceiptChannelShape
function thePayloadIsNotAnObject(payload)
export function unwrapTheApplyItemEnvelope(payload, receipt?)
  // granot_statement + matching kind/id; refuse unrecognized hints
function theChannelDecidesTheKind(receipt)          // never payload event_type
function thePayloadEventConfirmsOrConflicts(receipt, payload)
export function readTheGranotBookingAction(raw)
  // booked | releas/release → release; Released / prefix → unsupported
export function isThisASupportedGranotBookingAction(raw)
function foldTheSourceLabel(payload)                // label or source; sourceLabel helper
function foldTheJobAndFormReference(payload)        // Job omit has no issue code
function foldTheContact(payload)
function foldTheMove(payload)                       // MM/DD/YYYY in America/New_York
function foldThePriority(payload)
function foldTheDisplayMoney(payload, field)
function decideTheResult(authority, issues, priorityUpdate)

export const ObservationFieldBounds = { /* today's NORMALIZATION_FIELD_BOUNDS */ }
export const PrioritiesThatLaterAuthorizeBroadEnrichment = ["1", "5"] as const
export const VantageBusinessTimezone = "America/New_York"
export function calendarDateInVantageBusinessTimezone(year, month, day)

// ── 2. Keep that Observation for this receipt ─────────────

export async function keepTheObservationForThisReceipt(input, store?)
export async function keepThisObservationCandidate({ receipt_id, candidate }, store)
export function thisObservationStillMeansTheSameThing(left, right)
export class ObservationMeaningChangedError

async function loadTheReceiptIfWeOnlyHaveAnId(input)
function reuseTheRowWhenMeaningMatches(existing, candidate)
async function insertTheCandidate(candidate, receipt_id, store)
async function recoverADuplicateKeyRace(receipt_id, candidate, store)
```

Read the primary path out loud: *The processor claimed a receipt — or a test handed us one. The envelope is already typed. If the body is an apply-item wrapper, unwrap the statement; if it is a webhook body, the statement is the body. Kind comes from the route or the approved operation, not from Granot’s event_type. Fold the label, Job, phone, move date, Priority, and money. A Priority Update without a real Priority is invalid. A Lead Created or Booked row with a bad Priority is still a finished Observation with issues. Released is unsupported and stays unsupported even when Priority is 1. Keep one Observation per receipt. If we already have that row and it still means the same thing, reuse it. If the meaning changed, refuse — never overwrite evidence. Do not set quoted. Do not look up a Lead. Do not ask the Registry who this source is.*

That is the operation. `persistObservationCandidate` is not a different story. `resolveSourcePolicy` is not this fold.

## Precise logic I would tighten while renaming

These are real smells the story names make obvious. Do not “just rename.”

1. **`upsertGranotObservation` drops `payload_schema_hint`.** Both the `receipt_id` load and the already-read receipt rebuild omit the hint. `unwrapTheApplyItemEnvelope` uses that hint to refuse unrecognized apply-item envelopes. Without it, an envelope-shaped payload whose kind/id match still unwraps. Processor live path is `keepTheObservationForThisReceipt({ receipt_id })`. Do not silently start passing the hint in this rename. If a later change passes it through, that is a tested contract, not a cleanup.

2. **`PRIORITY_BROAD_ENRICHMENT_CANONICALS` is a contract this file does not apply.** Tests lock `["1", "5"]` and `"quoted" in actual === false`. `leadDesiredState.ts` and `createLeadFromGranot.ts` hard-code the same `1` / `5` check and set `quoted`. Do not start setting `quoted` here so “the constant wins,” and do not delete the constant so “this file never heard of enrichment.” Leave those siblings alone.

3. **Schema lists issue codes this fold never emits.** `NormalizationIssueCode` includes `missing_job_number` and `granot_agent_identity_conflict`. Knowledge already says this module never emits them (Agent conflict is later identity policy). Over-bound / non-scalar Job Number is omitted with **no** issue code. Tests lock the silent Job omit and the absent Agent-conflict issue. Do not start emitting those codes so “the union is honest.”

4. **`hasControlOrBidi` and `normalizeLookupLabel` are one-line pass-throughs.** They wrap `hasControlOrBidiCharacters` and `normalizeGranotSourceLabel`. Inline them. Do not grow a third label folder.

5. **Mongo insert `try/catch` rethrows.** `mongooseObservationStore.insert` catches and throws the same error. Delete the wrapper. Duplicate-key recovery already lives in `keepThisObservationCandidate`.

6. **Channel decides kind; payload cannot reroute it.** A `lead_snapshot_apply` with `event_type: "Booked"` is `invalid` + `route_payload_event_conflict` and stays `lead_snapshot`. A booking webhook with `Released` is `unsupported`, not `invalid`, and Priority cannot change that. Do not let payload `event_type` win so “Granot said Booked.”

7. **`type=AUTO` is provider context, not a source.** It never supplies `normalized_source_label`, Registry id, route, or disposition. Do not treat `AUTO` as a label so “auto sources classify themselves.”

8. **Display money is evidence only.** No binder / deposit / refund. Do not feed these canonicals into a Domain Command from this file.

9. **`user` / `rep` stay raw.** Agent lookup and `granot_agent_identity_conflict` are later identity policy. Do not call `findAgentByGranotCrmUsername` here.

10. **Leave sibling modules alone.** `normalizeGranotSourceLabel` stays in `sourceLabel.ts`. Apply-item hint names stay in `applyItem.ts`. Receipt insert stays in `capture.ts`. Claim stays in `drainer.ts`. Registry policy stays the next `sourcePolicy.ts` pass. Identity / desired-state / processor consume the Observation; they do not fold it.

11. **Do not treat capture `202`, Owner extension apply, HTTP automation apply, Follow Up CSV write, or `createLeadFromGranot` as this story.** Those keep a receipt, claim, or write a Lead. This file only says what the receipt observed and keeps that Observation.

12. **Do not write a whole-folder recommendation for `granotLifecycle`.**

## Testing

The **interface** is the test surface: `sayWhatThisGranotReceiptObserved` (today `normalizeGranotReceipt`) and `keepTheObservationForThisReceipt` (today `upsertGranotObservation` / `persistObservationCandidate`). `WhatThisReceiptObserved` is part of that **interface**. `isThisASupportedGranotBookingAction` stays exported because extension Zod is a second real **adapter**, not a test leak. `ObservationStore` stays exported because persist tests inject it.

Today’s `normalization.test.ts` already locks the Unit 01 fixture table, Priority canonical forms, Priority Update vs Lead Created / Booked Priority rules, Booked / Releas / Release vs Released / prefix, `type=AUTO`, cross-channel parity fixtures, NFKC / bounds / impossible dates, omitted `service_type` / unused `cubic_rate`, and display-money-is-not-a-command. `normalization.persistence.test.ts` already locks one-row reuse, concurrent same-candidate collapse, differing-candidate refuse, invalid persist, and technical insert creating no row. Keep those. Add the gaps that name the operation:

**Say what this Granot receipt observed**
- Apply-item envelope unwraps to the statement when kind/id match (already in `crossChannel.test.ts` — keep it here as the unwrap **interface**, not a second policy).
- Unrecognized `payload_schema_hint` on an envelope-shaped payload does **not** unwrap when the hint is passed through. Today’s upsert drops the hint — do not add a “fix” test that requires the drop to change.
- Malformed webhook envelope (missing `route_event_class`) throws before a candidate exists.
- `granot_crm_source_id` and `quoted` stay absent on the candidate.

**Keep that Observation for this receipt**
- `keepTheObservationForThisReceipt({ receipt_id })` loads the receipt, folds it, and inserts one row (replica / persistence).
- Same candidate after insert → `created: false`, same `_id`.
- Different Priority on the same `receipt_id` → `ObservationMeaningChangedError`, stored canonical unchanged.
- Invalid / unsupported results persist.
- This file does not write a Lead, a Decision, or `quoted`.

Do **not** add a test per helper (`theChannelDecidesTheKind`, `foldTheContact`, `foldTheDisplayMoney`). Those names exist so the parent reads. If a helper test has to change when the helper is inlined, it was testing past the **interface**.

Do **not** re-test `resolveSourcePolicy`, identity ladders, desired-state `quoted`, or `createLeadFromGranot` 1/5 writes here. Do not re-test webhook `202` or channel capture replay. Do not add a test that this file sets `quoted` for Priority `1` / `5`. Do not add a test that Job Number omit emits `missing_job_number`.

## What I would not do

- A `NormalizationService` class with `create` / `update` / `normalize`.
- Thirty two-line functions that only wrap `readStringScalar`.
- Moving this into a CRUD folder, or into `identity.ts` / `contact.ts` / `move.ts` “for cleanliness.”
- Breaking the one-row-per-receipt **seam**, or overwriting a stored Observation when meaning drifts.
- Setting `quoted` or writing `granot_crm_source_id` so “the Observation is ready for sync.”
- Emitting `missing_job_number` or `granot_agent_identity_conflict` so the type union “wins.”
- Letting payload `event_type` reroute kind, or prefix-matching `Released` as `release`.
- Merging this file with `historicalConsolidation/normalization.ts`, `granotTemporal.ts`, or `processor.ts`.
- Treating capture, apply, source policy, or Lead create as this story.
- Writing a whole-folder recommendation for `granotLifecycle`.
