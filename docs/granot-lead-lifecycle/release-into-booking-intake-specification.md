# Release into Booking Intake — and Live Events → intake link

> **Contract maturity: implementation-ready.** Delta over the locked FINAL SPEC and over [Booked-only](./booking-reconciliation-booked-only-specification.md) AC-P5. It does **not** rewrite [`FINAL-SPECIFICATION-GRANOT-LEAD-LIFECYCLE.md`](../../scripts/prototypes/granot-lead-lifecycle/specs/FINAL-SPECIFICATION-GRANOT-LEAD-LIFECYCLE.md). Do not edit that file unless the owner explicitly asks.

**Prepared:** 2026-09-01  
**Repos:** `vantage-main-server`, `vantage-admin`  
**Owner term in Admin copy:** booking intake. **Canonical term:** [Granot Booking Reconciliation Case](../../../CONTEXT.md).  
**Owner term retired:** cancellation intake. Do not create a new glossary noun for it.

Two features share this file because the second is only correct after the first:

1. **Part A — Release into booking intake.** `Releas` / `Release` upsert onto the same Granot Booking Reconciliation Case as `Booked`. Cancellation intakes are disbanded.
2. **Part B — Live Events → booking intake.** A Live Events row for `booking_status_changed` shows **Open booking intake** only when that receipt’s Observation is already on a booking-intake evidence row.

---

## 1. Authority and required reading

Read in this order. Stop and report contradictions; do not silently merge.

1. **This file** — wins on Release routing, booking-intake upsert for `booked` **and** `release`, owner-facing cancellation-intake retirement, Confirm Granot Cancellation on a booking case, Live Events intake linkage, and the copy in §8 / §14.
2. **[Booking Reconciliation Booked-only](./booking-reconciliation-booked-only-specification.md)** — still wins on Priority 5 never opening a case, Booking Priority Pairing, and AC-18 / AC-P1–P4 / AC-P6–P8. **AC-P5 in that file is superseded** (Releas now writes booking-case evidence).
3. **[Owner booking intake](./owner-booking-intake-and-lead-attachment-specification.md)** — still wins on even Binder, optional Lead, Confirm without Lead, and Connect Booking to Lead.
4. **FINAL SPEC** — still wins on case uniqueness per `{normalized_job_no, action_kind:"booked"}`, revisions, Referral modes, official-field blankness, and identity-conflict discrepancies. It no longer wins on §20 Release cases as an owner surface, AC-27 no-Booking → Release discrepancy, or AC-40 “both cases may stay open.”
5. **Glossary:** [`CONTEXT.md`](../../../CONTEXT.md) — Granot Booking Action, Granot Booking Reconciliation Case, Confirm Granot Cancellation, Update Existing Booking, No Action, Granot Observation Receipt.
6. **Current service docs (reverify, do not copy as contract):** [`booking-reconciliation.md`](../knowledge/granot-lifecycle/booking-reconciliation.md), [`release-reconciliation.md`](../knowledge/granot-lifecycle/release-reconciliation.md), [`processor.md`](../knowledge/granot-lifecycle/processor.md), [`projections.md`](../knowledge/granot-lifecycle/projections.md), [`live-receipts.md`](../knowledge/granot-lifecycle/live-receipts.md).

| Locked or current text | Replacement |
| --- | --- |
| Booked-only AC-P5: Releas returns `opposite_action_kind` and writes no Booking case | Releas / Release append to the open booking intake (or open one). |
| FINAL SPEC §20 / AC-27: no Booking → `release_without_vantage_booking` | no Booking → booking intake evidence. Do not open that discrepancy reason for missing Booking. |
| FINAL SPEC AC-40: Booking and Release cases may both stay open | One open booking intake per Job Number. Latest Granot Booking Action drives copy and commands. |
| FINAL SPEC §1: Cancellation Intake is replaced by Release Reconciliation | Release Reconciliation is no longer an owner surface. New Release evidence lands on the booking intake. |
| Admin `intakeKindFromCase("release") → "cancellation"` | There is no cancellation-intake tab. `kind: "release"` list rows are historical only (see §10). |
| `maybeReconcileBooking` requires `booking_action.normalized === "booked"` | Accepts `booked` **or** `release`. |
| Confirm Granot Cancellation lives only on `/release-cases/:id/confirm-cancellation` | Also (and going forward, only for new work) on `/booking-cases/:id/confirm-cancellation` when §7 allows it. |

A case is still not a Booking or a Cancellation. Official writes stay on gated Owner commands. Granot never auto-cancels.

---

## 2. Objective

1. Treat `Releas` and `Release` as the same [Granot Booking Action](../../../CONTEXT.md) (`release`). They are evidence that the Rep released the job — to edit it or because the customer cancelled — not an official Cancellation.
2. Upsert that evidence onto **one** open Granot Booking Reconciliation Case per normalized Job Number, together with Booked evidence (multi-event provenance).
3. When Vantage has **no** official Booking, the owner still finishes a booking or chooses No Action. Do not offer Confirm Cancellation. Do not open a Release discrepancy solely because the Booking is missing.
4. When Vantage **has** an official Booking and the latest action is Release, change the message and expose Update Existing Booking, Confirm Cancellation, and No Action on **that same intake**.
5. Remove Cancellation intakes from `/intakes`.
6. From Live Events, let the owner jump to that intake when the row is `booking_status_changed` **and** the receipt’s Observation is on the case evidence. No guess-by-job-number.

---

## 3. Why this change (production evidence, 2026-09-01)

Activation `2026-08-20 2:52:50 PM` ET. Queried `vantagemovers` 2026-09-01.

- `booking_status_changed` receipts: 178 Booked, 43 `Releas`, 4 `Release`, 8 empty `event_type` (no job — stay unsupported).
- `Releas` / `Release` payloads are full snapshots (job, source, contact, money, zips) — not a sparse cancel signal. Both already normalize to `booking_action.normalized === "release"`.
- Jobs with a Release observation: 11 `booked → release → booked`, 9 `release → booked`, 3 longer edit ping-pong ending Booked, **1** ending on Release. 23 of 24 later Booked again.
- 11 open `granot_release_discrepancies`, all `release_without_vantage_booking`. Six of those jobs already have an open booking intake.
- 6 open `granot_release_reconciliation_cases`, all with a live Booking and no Cancellation. Five also have a booking case on the same job.
- Admin copy today says “Granot recorded a cancellation” / “Granot cancelled the job.” That is false.

---

## 4. Locked decisions (Part A)

1. **One owner intake kind.** New owner work is a Granot Booking Reconciliation Case (`action_kind: "booked"`). Do not open a new Granot Release Reconciliation Case. Do not add a generic Intake model.
2. **Trigger is the Granot Booking Action, not Priority.** `maybeReconcileBooking` runs when `booking_action.normalized` is `booked` **or** `release`. Priority 5 still never opens or refreshes a case (Booked-only AC-18 stays).
3. **Classifier accepts Release.** Delete the `opposite_action_kind` return for `booking_action === "release"`. Evidence action on the new row is the actual action (`booked` or `release`).
4. **Mode follows Vantage Booking, not the Granot button.**
   - No official Booking + non-referral → `create_missing_booking`.
   - No official Booking + referral disposition → `create_referral_booking`.
   - One active official Booking → `review_existing_booking`.
   - Officially cancelled Booking + **Release** → `already_current` / `booking_already_cancelled`. No case, no discrepancy.
   - Officially cancelled Booking + **Booked** → keep today’s `booked_after_official_cancellation` discrepancy (AC-26).
5. **Missing Booking is not a Release discrepancy.** Retire `release_without_vantage_booking` for new traffic. Identity / Record Link / Job / Source Scope conflicts still open the matching discrepancy (`release_*` or `booked_*` reason as today). Do not invent a new reason for “Release and no Booking.”
6. **Open uniqueness unchanged:** one open `{normalized_job_no, action_kind:"booked"}` case. Repeated Booked or Release while open appends/dedupes evidence by Observation ID and increments only `evidence_revision`. After resolve, a later Booked or Release opens `max(sequence)+1`. Exact Observation replay is a no-op.
7. **Booking and Release evidence coexist on that one case.** They never auto-close each other. A later Booked after Release on an open create-missing case is a refresh, not a new case.
8. **`latest_action` is derived** from the temporally latest evidence row (`captured_at`, then Observation ObjectId hex via `compareGranotTemporal`). Historical `priority_5` evidence never wins when any `booked` or `release` row exists.
9. **Creating observation.** Prefer latest `booked` (`selection: "preferred_booked"`). If the case has only Release evidence, use latest `release` (`selection: "preferred_release"`). Do not label that statement a cancellation. Historical Priority-5-only stays `latest_creating` (Booked-only §6.4).
10. **Pairing stays Booked-only.** `projectBookingPriorityPairing` still throws without a creating Booked Observation. Release-only cases have `priority_pairing: null`. A later Booked on the same case refreshes the pairing snapshot as today.
11. **Confirm Cancellation is allowed only when** the case is open, mode is `review_existing_booking`, a deterministic official Booking is still active, and `latest_action === "release"`. `GRANOT_LIFECYCLE_BOOKING_COMMANDS_ENABLED` gates it. Do not require `GRANOT_LIFECYCLE_RELEASE_CASES_ENABLED` or `RELEASE_COMMANDS_ENABLED` for this path.
12. **No Booking ⇒ no cancel command.** `create_missing_booking` and `create_referral_booking` never expose Confirm Cancellation, even when `latest_action === "release"`.
13. **Processor early-return stays** when this Observation opens or refreshes a booking case. Do not also `synchronizeLeadFromGranot` on that same Observation. That is existing Booked behavior; apply it to Release-on-case too.
14. **`maybeReconcileRelease` must not open owner cases** once Part A is live. Either delete the live call or make it a no-op that returns `undefined`. Do not leave both modules able to open work for the same Observation.
15. **Existing Release cases are historical.** Readable for audit. Not shown on `/intakes`. New evidence does not refresh them. See §10.
16. **No new lifecycle flag.** Reuse `GRANOT_LIFECYCLE_BOOKING_CASES_ENABLED` / `BOOKING_COMMANDS_ENABLED`. Do not enable Release case/command flags to make a test pass.
17. **Copy must stop saying Granot cancelled.** See §8.
18. **Official money stays owner-entered.** Granot estimate, payment, and balance remain reference only.

---

## 5. Current-state evidence to verify

Reverify at implementation. Observed 2026-09-01.

### Server

- `processor.ts` `maybeReconcileRelease` runs **before** `maybeReconcileBooking` and opens `GranotReleaseReconciliationCase` when Release-case gates pass. `maybeReconcileBooking` skips unless `normalized === "booked"`.
- `bookingReconciliation.ts` `classifyBookingReconciliation` (~1044) returns `{ kind: "none", reason: "opposite_action_kind" }` for Release. Tests assert Releas writes no Booking case (Booked-only AC-P5).
- `releaseReconciliation.ts` `classifyReleaseReconciliation`: no Booking → `release_without_vantage_booking`; active Booking → open/refresh Release case; already cancelled → `already_current`.
- Case evidence union already allows `priority_5 | booked | release` on the **booking** case model. New Release rows must use `action: "release"`.
- `creatingObservation.ts` already has `selectReleaseCreatingObservationEvidence` for Release cases. Booking selection prefers latest `booked`. Extend the **booking** selector per §4.9; do not keep a separate cancellation-intake loader as an owner path.
- Live DTO (`liveReceipts.ts` `LiveWebhookReceipt`) has `receipt_id`, `route_event_class`, `lead.event_type`, `processing_state`. No `observation_id`, no `case_id`, no intake link. Mongo select does not join Observation or cases.
- SSE (`liveReceiptStream.ts`) emits each receipt **once** at capture. Client (`mergeLiveWebhookReceipts`) keys by `receipt_id`. Processing completion does not re-emit. That is why Part B needs `receipt_updated`.
- No GET exists for case-by-receipt or case-by-observation. `GET .../cases/:case_id/creating-observation` is the opposite direction.
- Open booking uniqueness: `{ normalized_job_no, action_kind }` partial on `state: "open"`. No index on `evidence.observation_id`.
- Admin `intakeCaseHref(caseId, { state, job })` → `/intakes?case=…`.

### Admin

- `/intakes` has Booking and Cancellation tabs (`intakes-dashboard.tsx`). `intakeKindFromCase("release")` is `"cancellation"`.
- `intake-copy.ts` maps `release` → “Granot recorded a cancellation” / “Granot cancelled the job.”
- `cancellation-intake-workbench.tsx` + `ReleaseOwnerActions` (cancel / update / no-action).
- Live Events: `live-webhooks.tsx` `LiveWebhookReceiptCard` links **Open job timeline** when `lead.job_no` is present. No intake link.
- Job timeline emits `booking_intake` and `cancellation_intake` (`assemble.ts`). No click-through to `/intakes` is required by this spec (out of scope unless it is free).

---

## 6. Deep module and persist contract (Part A)

### 6.1 Processor gate (exact)

Replace the Booked-only `actualBooked` guard with:

```ts
const action = input.observation.booking_action?.normalized;
const actualBookingAction = action === "booked" || action === "release";
if (
  !actualBookingAction ||
  !input.observation.identity?.normalized_job_no ||
  input.observation.normalization_result === "invalid" ||
  input.observation.normalization_result === "unsupported"
) {
  return undefined;
}
```

`maybeReconcileRelease` must not open or refresh a Release case after this lands. Prefer removing the call. If a shim remains, it returns `undefined` and writes no Decision of `release_case_*` / `release_discrepancy_opened` for `release_without_vantage_booking`.

### 6.2 Classifier

`classifyBookingReconciliation`:

- `booking_action === "release"` is booking evidence. Do **not** return `opposite_action_kind`.
- Mode table in §4.4. `evidence_action` is `context.booking_action` (`booked` | `release`).
- Referral: Release with no Booking opens/refreshes `create_referral_booking` the same way Booked does. Release with a referral Booking opens `review_existing_booking`. Release with a non-referral Booking when disposition is referral (or the inverse) keeps today’s conflict discrepancy — do not invent a new path.
- Leadless official Booking: Release opens/refreshes `review_existing_booking` (same as Booked). Employee Booking Lead Reconciliation delegation stays for employee-origin Bookings only; do not send Granot Release there if today’s Booked path would have opened `review_existing_booking` for a Granot Leadless Booking.
- Identity `conflict` still returns `booking_discrepancy_required` with the existing booked/release reason mapper. Missing Booking + Release is **not** a conflict.

### 6.3 Persist

Reuse `reconcileBookingCase`. New evidence tuple:

```ts
{
  observation_id: ObjectId,
  decision_id: ObjectId,
  captured_at: Date,
  action: "booked" | "release", // never invent priority_5 here
}
```

Decision reason codes stay `booking_case_opened` / `booking_case_refreshed`. Do not add `release_case_*` on this path.

`case_revision` still increments only for owner-relevant suggestion / deterministic-booking / link changes — not for evidence-only Release appends.

### 6.4 Derived latest action (pure)

Add a small pure helper next to pairing (same file or `bookingIntakeLatestAction.ts`):

```ts
export function selectBookingIntakeLatestAction(
  evidence: Array<{ action: "priority_5" | "booked" | "release"; captured_at: Date; observation_id: string }>,
): "booked" | "release" | "priority_5" | undefined;
```

Ignore `priority_5` when any `booked` or `release` exists. Tie-break with Observation id hex. Projections use this for list `latest_action`, detail posture, and command capabilities.

### 6.5 Confirm Cancellation on the booking case

Add `confirmCancellation` to the booking-case owner module (reuse the transaction/CAS body in `releaseOwnerCommands.ts`; do not fork official Cancellation rules).

```
POST /api/v1/admin/granot-lifecycle/booking-cases/:id/confirm-cancellation
```

Input equals today’s Release confirm: `expected_case_revision`, `expected_booking_revision`, official `cancel_date`, `refund_amount`, optional reason/notes/`cancelled_by`. One `Idempotency-Key`. Owner actor.

Gates inside the transaction, all required:

- case `state === "open"`
- case `mode === "review_existing_booking"`
- `selectBookingIntakeLatestAction(evidence) === "release"`
- deterministic Booking id still matches and is active (not officially cancelled)
- `GRANOT_LIFECYCLE_BOOKING_COMMANDS_ENABLED`
- existing official-field and catalog checks from the Release command

Failure modes stay typed: 422 `POLICY_BLOCKED`, 409 revision conflicts, 409 if latest action is no longer Release (treat as `CASE_REVISION_CONFLICT` or a dedicated `INTAKE_POSTURE_CONFLICT` — pick one and test it; do not 500).

Keep the Release-case HTTP routes working for **historical** open Release cases until §10 migration closes them. New UI must not create those cases.

`updateExistingBooking` and `noAction` on the booking case stay as they are. When `latest_action === "release"` and mode is review, the Admin workbench shows all three.

---

## 7. Owner command matrix

| Mode | `latest_action` | Commands |
| --- | --- | --- |
| `create_missing_booking` | `booked` or `release` | Confirm Granot Booking, No Action |
| `create_referral_booking` | `booked` or `release` | Create Referral Booking, No Action |
| `review_existing_booking` | `booked` | Update Existing Booking, No Action |
| `review_existing_booking` | `release` | Update Existing Booking, Confirm Granot Cancellation, No Action |
| any | `priority_5` (historical only) | Same as today’s review/create for that mode; do not add cancel |

`capabilities` on case detail must list these exactly. Do not show Confirm Cancellation when commands are disabled; keep the waiting-intake warning.

---

## 8. Admin copy and UI (Part A)

Server-first. Admin consumes exported DTOs.

**Remove** the Cancellation intakes tab and `CancellationIntakeWorkbench` from `/intakes`. Historical `kind: "release"` rows may remain on the technical lifecycle case page; they are not an Intakes tab.

One workbench: `BookingIntakeWorkbench`. When `latest_action === "release"` and mode is `review_existing_booking`, render the three-command block (update, cancel, no-action) **instead of** only booking update. Reuse `CancellationCommandForm` / `BookingUpdateForm` / `NoActionForm` against **booking-case** routes.

Required copy (exact sense; wording may match house style but must not say Granot cancelled):

| Surface | Copy |
| --- | --- |
| `intakeWhyHere("booked")` | Granot recorded a booking |
| `intakeWhyHere("release")` | Granot released this job |
| `intakeWhyHere("priority_5")` | Opened under the retired Priority 5 trigger |
| List / headline, no Booking, latest Release | Granot released this job. There is still no Vantage booking. File the booking if the sale is real, or choose No Action. |
| List / headline, has Booking, latest Release | Granot released this job. That may be a customer cancel or a booking edit. Review the official booking. |
| `granotStatementHeadline` for Release | Granot released job {n} … — **never** “Granot cancelled” |
| `creatingObservationTitle("preferred_release")` | Granot Release payload |
| Empty open booking queue | No booking intakes waiting. When Granot records a Booked or Release job, it will show up here. |
| `intakeActionLabel` | Finish booking (all booking intakes). Do not use “Review cancellation” as the list CTA. Review-release detail may say “Review booking or cancellation.” |

Delete `CANCELLATION_INTAKE_STORY` as an owner path, or keep the file only if tests need a tombstone that is unused.

Job timeline: new events stay `booking_intake`. Stop emitting new `cancellation_intake` events. Historical `cancellation_intake` rows still render.

---

## 9. Projections (Part A)

- Default `/intakes` list is **booking cases only** (`kind: "booking"`). Do not merge open Release cases into the Owner queue.
- `GranotLifecycleCaseListItem.latest_action` uses §6.4.
- Detail `capabilities.confirm_cancellation` (name may follow existing capability shape) is true only for the §7 review+release row.
- `getIntakeCreatingObservation` tries the booking case first. Do not fall through to a Release case for Owner Intakes. Technical `GET .../cases/:id` for a historical Release id may still return `kind: "release"`.
- Pairing omitted when there is no creating Booked Observation.

---

## 10. Historical Release cases and discrepancies

Not a production mutation of official Bookings or Cancellations.

**Open `granot_release_reconciliation_cases`:** one-shot Owner/operator script (or the implementing PR’s migrate helper) for each open Release case:

1. Find or open the `{normalized_job_no, action_kind:"booked"}` booking case.
2. Append each Release evidence Observation that is not already on the booking case (`action: "release"`).
3. If a live official Booking exists, set/keep `review_existing_booking` and `deterministic_booking_id`.
4. Resolve the Release case with a recorded `No Action` / migrate reason so it cannot sit open beside the booking intake.
5. Do not invent official Cancellation or Booking writes.

**Open `release_without_vantage_booking` discrepancies:** resolve or leave as historical. New traffic must not create this reason. If the job has or should have a booking intake, the next Booked/Release Observation opens/refreshes that intake; do not require the discrepancy row to become the intake.

Do not drop the Release collections in this issue.

---

## 11. Locked decisions (Part B — Live Events link)

1. **Achievable.** Live Events already carries `receipt_id`. Observation is 1:1 with webhook receipt (`GranotObservation.receipt_id` unique). Booking-case evidence is keyed by `observation_id`.
2. **Show the control only when all of these are true:**
   - `route_event_class === "booking_status_changed"`
   - `intake_link` is non-null (server-resolved)
3. **`intake_link` is non-null only when** a Granot Booking Reconciliation Case has `evidence.observation_id` equal to this receipt’s Observation. Booked and Release both qualify after Part A. Empty / unsupported `event_type` never qualifies.
4. **Never resolve by `job_no` alone.** Unsafe: multiple sequences, open vs resolved, discrepancy-only jobs, raw job vs normalized job, wrong observation on the same job.
5. **Link the specific case** that contains this Observation, including a **resolved** case. Owner copy: **Open booking intake**. Href: `intakeCaseHref(case_id, { state: intake_link.state, job: lead.job_no ?? undefined })`.
6. **No link** for `lead_created`, `priority_updated`, pending rows with no Observation yet, completed rows that opened a discrepancy or no case, or historical Release-only cases that were never migrated onto a booking case.
7. **Late binding is required.** Capture SSE fires before the processor opens the case. Snapshot/`receipt` may have `intake_link: null` and `processing_state: "pending" | "claimed"`. The client must replace the row when the server later says the link exists.
8. **Deep module owns the join.** Routes and React cards do not query cases by job.

---

## 12. Live Events contract

### 12.1 Wire shape

Extend `LiveWebhookReceipt` (server `liveReceipts.ts`, admin `granotLiveReceipts.ts`):

```ts
export type LiveWebhookIntakeLink = {
  case_id: string;
  kind: "booking";
  state: "open" | "resolved";
  matched_via: "evidence_observation_id";
};

export type LiveWebhookReceipt = {
  receipt_id: string;
  captured_at: string;
  route_event_class: LiveWebhookEventClass;
  observation_channel: "granot_webhook";
  processing_state: ReceiptWorkState | string;
  observation_id?: string | null;
  intake_link?: LiveWebhookIntakeLink | null;
  lead: LiveWebhookLead;
  granot_statement: unknown;
};
```

`observation_id` may be present whenever the Observation exists, including non-booking routes. `intake_link` stays null unless §11.3 holds. Omit or null — do not send a Release/cancellation kind.

### 12.2 Deep module

```ts
export function resolveLiveReceiptIntakeLink(input: {
  receipt_id: string;
}): Promise<{
  observation_id: string | null;
  intake_link: LiveWebhookIntakeLink | null;
}>;
```

Implementation (hidden from callers):

1. Load Observation by `receipt_id`. None → `{ observation_id: null, intake_link: null }`.
2. Find **one** `GranotBookingReconciliationCase` with `evidence.observation_id === observation._id`. Prefer the unique match. If two exist, that is a persist bug — fail closed (null link + operational event), do not pick by job.
3. Return `{ case_id, kind: "booking", state, matched_via: "evidence_observation_id" }`.

Add a non-unique index on `granot_booking_reconciliation_cases.evidence.observation_id` if the join is not already covered. Read-only index report first; apply in the same PR if the repo’s index process allows, otherwise file the apply step and still ship a correct (slower) find.

`projectLiveWebhookReceipt` calls this for every live row. Do not `$lookup` in a per-row loop without a batch path if snapshot size is 40 — batch Observation + case finds for the snapshot/`listAfter`/`listUpdated` page.

### 12.3 SSE late update

Extend `runLiveReceiptSse`:

| Event | When | Payload |
| --- | --- | --- |
| `snapshot` | First open | `{ receipts: LiveWebhookReceipt[] }` (already enriched) |
| `receipt` | New `captured_at` after cursor | enriched receipt |
| `receipt_updated` | A receipt **already in the 30-minute window** whose `processing_state` or `intake_link` changed | the full enriched `LiveWebhookReceipt` |
| `heartbeat` | unchanged | `{ ts }` |

Do not advance the capture cursor on `receipt_updated`. `Last-Event-ID` remains `captured_at:receipt_id` for **new** receipts only.

Admin `mergeLiveWebhookReceipts` **must replace** the existing `receipt_id` when `receipt` or `receipt_updated` arrives (incoming wins). Today incoming-first already does this if the updated object is passed as `incoming`; add a test that a later `intake_link` overwrites `null`.

Do not rebuild the stream as WebSockets. Do not emit in-process from the processor. Poll Mongo, same as today.

### 12.4 Admin UI

`LiveWebhookReceiptCard` (`live-webhooks.tsx`), beside **Open job timeline**:

- If `receipt.intake_link?.kind === "booking"`: link **Open booking intake** → `intakeCaseHref(...)`.
- Else: no intake control. Do not show a disabled button. Do not say “no intake yet.”

Do not wait for accordion expand to fetch. The stream (including `receipt_updated`) is the source. No extra Owner click.

Owner-only stays. No Live Events change for the Admin role.

---

## 13. Acceptance criteria

Keep Booked-only AC-18, AC-19, AC-P1–P4, AC-P6–P8. **Replace AC-P5.** Add:

| ID | Assertion |
| --- | --- |
| AC-P5 | `booking_status_changed` `event_type: Releas` or `Release`, live + booking-cases enabled, no official Booking, opens or refreshes the `{job, booked}` booking case with `evidence.action === "release"`. No `opposite_action_kind`. No `release_without_vantage_booking`. No Release case. |
| AC-R1 | Same job: Booked opens create-missing; later Releas appends Release evidence on the **same** open case; `evidence_revision` increments; `case_revision` does not; `latest_action === "release"`; commands stay Confirm Booking + No Action. |
| AC-R2 | Same job: Releas arrives first (no Booking). Opens `create_missing_booking` with Release evidence. Later Booked refreshes the same case; creating-observation prefers `preferred_booked`; pairing may then compute. |
| AC-R3 | Official active Booking + Releas opens/refreshes `review_existing_booking` on the booking case. Detail capabilities include Update, Confirm Cancellation, and No Action. Copy does not say Granot cancelled. |
| AC-R4 | Officially cancelled Booking + Releas → `already_current` / `booking_already_cancelled`. No new booking case, no Release case, no `release_without_vantage_booking`. |
| AC-R5 | Officially cancelled Booking + Booked still opens `booked_after_official_cancellation` (unchanged AC-26). |
| AC-R6 | Identity conflict on Release still opens a discrepancy (existing `release_*` conflict reasons). Still no booking case. |
| AC-R7 | After a booking case is resolved, a later Releas opens `sequence+1` as a new booking intake (review if Booking still active; create-missing if not). Historical Release case is not refreshed. |
| AC-R8 | Exact same Release Observation replay is a no-op (stored Decision). |
| AC-R9 | `POST .../booking-cases/:id/confirm-cancellation` succeeds only for AC-R3 posture. Create-missing + latest Release returns 409/422 and writes no Cancellation. |
| AC-R10 | `/intakes` default list contains no `kind: "release"` rows. Admin has no Cancellation intakes tab. |
| AC-R11 | `priority_updated` canonical `5` still does not open or refresh a booking case (AC-18). |
| AC-L1 | Live snapshot/receipt for `lead_created` or `priority_updated` has `intake_link` null. UI shows no intake link. |
| AC-L2 | Live `booking_status_changed` whose Observation is on a booking case evidence row has `intake_link.case_id` equal to that case (open or resolved). UI link goes to `/intakes?case=…`. |
| AC-L3 | Live `booking_status_changed` that completed with no booking case (unsupported empty event_type, or discrepancy-only) has `intake_link` null. |
| AC-L4 | A receipt first emitted with `intake_link: null` later emits `receipt_updated` with the same `receipt_id` and a non-null `intake_link` after the processor opens the case. Admin merge replaces the row; the link appears without reload. |
| AC-L5 | Two receipts on the same job, only one Observation on the case: only that receipt gets the link. Job number alone never links the other row. |

---

## 14. Tests the implementing agent must add or rewrite

Minimum. Names may follow repo style; assertions may not shrink.

**`bookingReconciliation.test.ts`:** Delete/rewrite AC-P5 opposite-action. Add AC-P5, AC-R1, AC-R2, AC-R3 classifier modes + evidence_action. Keep AC-19.

**`processor.test.ts`:** Release + booking-cases enabled invokes `reconcileBooking`, not `reconcileRelease`. Priority 5 still does not.

**`bookingReconciliation.replica.test.ts`:** AC-R1, AC-R2, AC-R7, AC-R8.

**`bookingOwnerCommands` / replica:** AC-R9. Replay idempotency on confirm-cancellation.

**`creatingObservation.test.ts`:** Release-only booking case → `preferred_release`; Booked+Release → `preferred_booked`.

**`projections` tests:** list booking-only; `latest_action`; capabilities matrix §7; pairing null on Release-only.

**`liveReceipts` / `liveReceiptStream` tests:** AC-L1–L5. Merge test: incoming `intake_link` replaces null.

**Admin:** `intake-copy` tests for Release copy (must not contain “cancelled”). Intakes dashboard has one tab. `LiveWebhookReceiptCard` renders the intake link iff `intake_link` present; job timeline link unchanged.

No live Mongo. No production flag change. No FINAL SPEC edit.

---

## 15. Out of scope

- Enabling production flags.
- Auto Booking / auto Cancellation / prefilling official money from Granot.
- Dropping `granot_release_reconciliation_cases` or Release HTTP routes in this issue.
- Slack, email, or new notification domain models.
- Linking Live Events to discrepancies, job technical case pages, or employee reconciliation.
- Job timeline click-through (nice if free; not required).
- Changing the 30-minute / 80-card Live Events window.
- Rewriting `FINAL-SPECIFICATION-GRANOT-LEAD-LIFECYCLE.md`.
- Owner Daily / BILA Connect surface.

---

## 16. Docs the implementing agent updates after the code is green

- [`CONTEXT.md`](../../../CONTEXT.md) — already restated with this change set; keep aligned.
- `docs/knowledge/granot-lifecycle/processor.md` — booking-case gate is Booked **or** Release; Release module does not open owner cases.
- `docs/knowledge/granot-lifecycle/booking-reconciliation.md` — trigger table; latest_action; cancel command on booking case.
- `docs/knowledge/granot-lifecycle/release-reconciliation.md` — owner surface retired; historical only.
- `docs/knowledge/granot-lifecycle/projections.md` — intakes list booking-only; capabilities.
- `docs/knowledge/granot-lifecycle/live-receipts.md` — `intake_link`, `receipt_updated`.
- This hub: [`docs/knowledge/granot-lifecycle/spec-hub.md`](../knowledge/granot-lifecycle/spec-hub.md).
- `vantage-admin/uxdocs/live-events-tab-specification.md` — pointer only: intake link lives in this spec; do not claim “no server change.”

---

## 17. Suggested implementation order

1. Pure `selectBookingIntakeLatestAction` + classifier rewrite + AC-P5 / AC-R1–R6 unit tests.
2. Processor: Release → `maybeReconcileBooking`; disable `maybeReconcileRelease` owner path.
3. Replica persist tests AC-R1, AC-R2, AC-R7, AC-R8.
4. Booking-case `confirmCancellation` + AC-R9.
5. Projections + creatingObservation + `/intakes` tab/copy (AC-R10).
6. Historical Release-case migrate helper (§10).
7. `resolveLiveReceiptIntakeLink` + DTO + SSE `receipt_updated` + Admin link (AC-L1–L5).
8. Knowledge docs in §16.

Stop when every AC in §13 has an automated test, `/intakes` has one queue, Releas upserts onto that queue, and Live Events shows **Open booking intake** only for receipts whose Observation is on that case.
