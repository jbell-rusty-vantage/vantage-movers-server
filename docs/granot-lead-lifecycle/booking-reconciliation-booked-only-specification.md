# Booking Reconciliation — Booked-only trigger and Priority pairing audit

> **Contract maturity: implementation-ready.** Delta over the locked FINAL SPEC. It supersedes Section 19’s trigger paragraph and AC-18. It does **not** rewrite [`FINAL-SPECIFICATION-GRANOT-LEAD-LIFECYCLE.md`](../../scripts/prototypes/granot-lead-lifecycle/specs/FINAL-SPECIFICATION-GRANOT-LEAD-LIFECYCLE.md). Do not edit that file unless the owner explicitly asks.

**Prepared:** 2026-08-24  
**Repos:** `vantage-main-server`, `vantage-admin`  
**Owner term in Admin copy:** booking intake. **Canonical term:** [Granot Booking Reconciliation Case](../../../CONTEXT.md).

---

## 1. Authority and required reading

Read in this order. Stop and report contradictions; do not silently merge.

1. **This file** — wins on the Booking-case **trigger** and on **Booking Priority Pairing**.
2. **FINAL SPEC** — still wins on everything this file does not change: modes, uniqueness, revisions, Owner commands, Referral, discrepancies, AC-19, AC-20, AC-06, AC-28, AC-39, AC-40.
3. **Glossary:** [`CONTEXT.md`](../../../CONTEXT.md) — Granot Booking Reconciliation Case, Suggested Booking Lead, Confirm Granot Booking, Booking Priority Pairing.
4. **Current service docs (reverify, do not copy as contract):** [`docs/knowledge/granot-lifecycle/processor.md`](../knowledge/granot-lifecycle/processor.md), [`booking-reconciliation.md`](../knowledge/granot-lifecycle/booking-reconciliation.md), [`projections.md`](../knowledge/granot-lifecycle/projections.md), [`desired-state.md`](../knowledge/granot-lifecycle/desired-state.md).
5. **Primary code to change:**
   - `src/services/granotLifecycle/processor.ts` (`maybeReconcileBooking`)
   - `src/services/granotLifecycle/bookingReconciliation.ts` (`classifyBookingReconciliation` and case persist)
   - `src/services/granotLifecycle/creatingObservation.ts`
   - `src/services/granotLifecycle/projections.ts`
   - `src/models/GranotBookingReconciliationCase.ts`
   - `vantage-admin/components/intakes/intake-copy.ts`
   - `vantage-admin/components/intakes/creating-observation-accordion.tsx`
   - `vantage-admin/lib/api/granotLifecycle.ts`

FINAL SPEC citations this delta replaces:

| Locked text | Replacement |
| --- | --- |
| §19 “Booking Reconciliation triggers from: Priority 5 on an eligible matched Lead; or an actual booked action.” | Triggers from an actual `booked` action only. |
| AC-18 “Priority 5 with no Booking opens/refreshes create-missing…” | Priority 5 never opens or refreshes a Booking case. |
| Glossary “created from a Priority 5 or Booked Granot Observation” | Created from an actual Booked Granot Observation. |

AC-19 stays: actual Booked with no Booking opens create-missing; actual Booked with one active Booking opens review-existing; never a second Booking. Priority on that Booked payload does not suppress the case (AC-06 already: Priority is independent of Booking Action).

---

## 2. Objective

1. Open or refresh a Granot Booking Reconciliation Case **only** when the Observation is an actual Booked action (`booking_action.normalized === "booked"`). Webhook shape is `route_event_class: "booking_status_changed"` and payload `event_type: "Booked"`. Extension/automation `booking_action_apply` with the same normalized action stays in scope — the processor is channel-neutral.
2. Stop treating `priority_updated` with canonical Priority `5` as booking evidence. That Observation must fall through to lead desired-state (`synchronizeLeadFromGranot` / `already_current`), not `maybeReconcileBooking`.
3. Keep **easy, first-class access** to the best-case sequence: `priority_updated` canonical `5` **then** `booking_status_changed` `event_type: Booked` on the same Job Number.
4. Keep **first-class audit** when the creating Booked Observation’s Priority is not canonical `5`, even though the case still opens.

A case is still not a Booking. Official Booking writes stay on gated Owner commands.

---

## 3. Why this change (production evidence, 2026-08-24)

Activation `2026-08-20 2:52:50 PM` ET. Post-activation through `2026-08-25T04:00Z`, `vantagemovers`:

- 29 Booked observations / 24 jobs. Every **live** Booked payload carried Priority `5`.
- 26 open cases: 25 first evidence `booked`, 1 first evidence `priority_5`.
- That one live Priority 5 case (TBM Forms, 2026-08-24 ~11:39 AM ET) opened on `priority_updated` `5` and refreshed 1.5 seconds later on Booked. Because the processor **returns after a booking-case Decision**, the Priority 5 Observation did not apply lead desired-state.
- 11 Releas receipts. Zero Release cases (Release flag still off). Three jobs did Booked → Releas → Booked; job-level open uniqueness already covers that.
- Pre-activation receipts include `event_type: Booked` with payload Priority `0` and `1`. Classifier tests already treat Booked with invalid Priority as AC-19. Live since activation has not seen Booked-without-5, but Granot has sent it.

One post-activation job had standalone Priority 5 and no Booked webhook. Under this spec that job gets **no** Booking case. That is intended.

---

## 4. Locked decisions

1. **Trigger is the Booked action, not Priority.** `maybeReconcileBooking` runs only when `observation.booking_action?.normalized === "booked"`. Drop the `priorityFive` or-branch. Release, missing Job, `invalid`, and `unsupported` still skip.
2. **Classifier emits `evidence_action: "booked"` only.** Delete the create-missing path that returns `evidence_action: "priority_5"`. Priority 5 without Booked is `kind: "none", reason: "not_booking_evidence"`. Reasons `priority_5_existing_booking` and `priority_5_ineligible_target` become unused for new traffic; keep the union members so historical tests compile until you delete those branches.
3. **Do not append `priority_5` onto case `evidence` for audit.** Evidence means “this Observation opened or refreshed this case.” New evidence rows are Booked only. Historical rows that already have `priority_5` stay immutable.
4. **Pairing is an audit projection, not a trigger.** A preceding Priority 5 never opens, refreshes, resolves, or sequences a Booking case. A later Priority 5 after Booked-without-5 is the same: lead desired-state only, plus read-time pairing.
5. **Preceding Priority 5 means `route_event_class === "priority_updated"`** with `priority.valid === true` and `priority.canonical === "5"` on the **same** `identity.normalized_job_no`, temporally **older** than the creating Booked Observation. Do not treat `lead_created` with Priority 5, a Booked payload that merely carries `5`, or any other route as the preceding pair.
6. **No time window.** Latest older Priority 5 on that job is the pair. Use `compareGranotTemporal` (`granotTemporal.ts`): `captured_at` first, then lowercase Observation ObjectId hex.
7. **Booked-without-5 still opens the case.** Missing, invalid, or non-`5` Priority on the Booked Observation is an audit class, not a gate.
8. **Pairing class (exactly one, for list pills):**
   - `booked_without_priority_5` if the creating Booked Observation is not valid canonical `5` (alert wins even if a preceding Priority 5 exists).
   - else `priority_5_then_booked` if a preceding Priority 5 exists (best case).
   - else `booked_carries_priority_5` (Booked payload has `5`, no standalone `priority_updated` `5` before it).
9. **`later_priority_5` is read-time only.** Newest `priority_updated` canonical `5` that is temporally **newer** than the creating Booked Observation. Persist nothing on that Priority Update. Owner-fix after Booked-without-5 must show up without writing the case.
10. **Job timeline does not gain a new event type.** Observations, priority effects, and booking actions remain individual timeline entries. Pairing is on the case list, case detail, and creating-observation DTOs so the owner does not have to scan the timeline.
11. **creatingObservation still prefers latest `booked` evidence.** Fallback to latest creating evidence remains only for historical cases that have no Booked evidence. New cases must have Booked evidence.
12. **No new lifecycle flag.** Reuse `GRANOT_LIFECYCLE_BOOKING_CASES_ENABLED`. No migration apply, no index, no backfill job. `priority_pairing` on the case document is optional; projections compute it when the snapshot is missing.
13. **Do not change Release, Referral-Booked, discrepancy, or Owner command contracts.** Referral already requires actual Booked.
14. **Processor early-return stays for Booked case Decisions.** Booked that opens/refreshes a case still does not also `synchronizeLeadFromGranot` on that same Observation. Priority 5, no longer a case trigger, **does** reach lead desired-state. Do not expand this issue into “Booked also writes the Lead.”
15. **Admin copy must stop saying Priority 5 opens an intake.**

---

## 5. Current-state evidence to verify

Reverify at implementation. Observed 2026-08-24.

### Server

- `processor.ts` `maybeReconcileBooking` (~616): `actualBooked || priorityFive`. Booking result returns before `maybeCreateLead` / `maybeSynchronizeMatchedLead`.
- `bookingReconciliation.ts` `classifyBookingReconciliation` (~898): Priority 5 + eligible Lead + no Booking → `create_missing_booking` / `evidence_action: "priority_5"`. Booked with `priority: { valid: false }` already opens a case (AC-19 test).
- `bookingReconciliation.test.ts` AC-18 test (~68) asserts the Priority 5 create-missing path. Replace that test; do not leave it green.
- `processor.test.ts` AC-18/AC-19 (~369) uses a Booked observation with invalid Priority and `booking_cases_enabled: true`. Keep that Booked invocation. Add a sibling test that Priority 5 **does not** call `reconcileBooking`.
- Case evidence type already allows `priority_5 | booked | release` (`GranotBookingReconciliationCase.ts`, FINAL SPEC §21.1). Do not remove `priority_5` from the stored union — historical cases have it.
- `creatingObservation.ts` `selectCreatingObservationEvidence` already prefers latest `booked`. Keep it. Add pairing onto the envelope.
- `projections.ts` `GranotLifecycleCaseListItem.latest_action` and `GranotLifecycleCaseDetail.evidence[].action` already include `priority_5`. Keep for historical rows. Add `priority_pairing` beside them.
- `normalizeBookingAction` maps exact `Booked` → `booked` and `Releas` / `Release` → `release`. `Released` is unsupported. Do not prefix-match.

### Admin

- `intake-copy.ts` `intakeWhyHere("priority_5")` is `"Granot set this lead to priority 5 (booked)"`. `intakeEmptyMessage` says Priority 5 or a booking opens the queue. Both are now false.
- `CreatingObservationView` shows Booked statement + normalized Observation. It does not show a preceding Priority 5 or a Booked-without-5 audit.
- Shared types live in `vantage-admin/lib/api/granotLifecycle.ts`. Admin types are not the semantic authority; extend them from this spec’s DTOs.

---

## 6. Deep module and persist contract

### 6.1 New module `src/services/granotLifecycle/bookingPriorityPairing.ts`

Pure. No Mongo, no flags, no Decision writes. Processor and projections both call it.

```ts
import type { GranotObservationDocument } from "../../models/GranotObservation";

export type BookingPriorityPairingClass =
  | "priority_5_then_booked"
  | "booked_carries_priority_5"
  | "booked_without_priority_5";

export type BookingPriorityPairingRef = {
  observation_id: string;
  receipt_id: string;
  captured_at: Date;
  route_event_class: "priority_updated";
  payload_event_type_raw?: string;
  priority_canonical: "5";
};

export type BookingPriorityPairing = {
  pairing: BookingPriorityPairingClass;
  creating_booked: {
    observation_id: string;
    receipt_id: string;
    captured_at: Date;
    route_event_class?: GranotObservationDocument["route_event_class"];
    payload_event_type_raw?: string;
    priority_canonical?: string;
    priority_valid: boolean;
    priority_is_5: boolean;
  };
  preceding_priority_5?: BookingPriorityPairingRef;
  later_priority_5?: BookingPriorityPairingRef;
};

export function isCanonicalPriorityFive(
  priority: GranotObservationDocument["priority"] | undefined,
): boolean;

export function projectBookingPriorityPairing(input: {
  creating_booked: GranotObservationDocument;
  job_observations: Array<
    Pick<
      GranotObservationDocument,
      | "_id"
      | "receipt_id"
      | "captured_at"
      | "route_event_class"
      | "payload_event_type_raw"
      | "priority"
      | "identity"
    >
  >;
}): BookingPriorityPairing;
```

Rules inside `projectBookingPriorityPairing`:

- Throw if `creating_booked.booking_action?.normalized !== "booked"` or `creating_booked.identity?.normalized_job_no` is missing. Pairing is undefined without a creating Booked Observation (historical Priority-5-only cases: see §6.4).
- Filter `job_observations` to the same `normalized_job_no`. Ignore other jobs.
- `preceding_priority_5` = latest job observation where `route_event_class === "priority_updated"` and `isCanonicalPriorityFive(priority)` and `compareGranotTemporal(candidate, creating_booked) === "older"`.
- `later_priority_5` = latest where the same Priority 5 test holds and `compareGranotTemporal(creating_booked, candidate) === "older"`.
- Equal temporal tuple is neither preceding nor later.
- `creating_booked.priority_is_5 === isCanonicalPriorityFive(creating_booked.priority)`.
- `pairing` uses the locked class table in §4.8.

Callers load job observations. The module does not.

### 6.2 Persist snapshot on Booked open / refresh

Add an optional field on `GranotBookingReconciliationCase`:

```ts
priority_pairing?: {
  pairing: BookingPriorityPairingClass;
  creating_booked_observation_id: ObjectId;
  creating_booked_priority_canonical?: string;
  creating_booked_priority_valid: boolean;
  creating_booked_priority_is_5: boolean;
  preceding_priority_5_observation_id?: ObjectId;
  preceding_priority_5_captured_at?: Date;
  computed_at: Date;
};
```

Write it in the same transaction that inserts or refreshes the case, from `projectBookingPriorityPairing` using the creating Booked Observation plus current same-job observations. Refresh the snapshot on every **new** Booked evidence append (latest creating Booked wins). Exact Observation replay changes nothing (existing evidence-id short-circuit stays).

Do **not** increment `case_revision` for pairing snapshot alone. If the snapshot write rides along with an evidence append, only `evidence_revision` increments, as today. `later_priority_5` is never stored.

No new unique index. Optional field. Existing documents remain valid.

`reconcileBookingCaseAfterDiscrepancy` must use the same snapshot write when it opens or refreshes from actual Booked evidence. If that path is reached with non-Booked evidence after this change, it is a bug — fail closed.

### 6.3 Processor gate (exact)

Replace the current `actualBooked || priorityFive` guard with:

```ts
const actualBooked = input.observation.booking_action?.normalized === "booked";
if (
  !actualBooked ||
  input.observation.booking_action?.normalized === "release" ||
  !input.observation.identity?.normalized_job_no ||
  input.observation.normalization_result === "invalid" ||
  input.observation.normalization_result === "unsupported"
) {
  return undefined;
}
```

Priority 5 observations continue through `maybeCreateLead` / `maybeSynchronizeMatchedLead` / Decision-only paths exactly as any other `priority_updated`.

### 6.4 Historical cases with only `priority_5` evidence

Do not invent Booked evidence. `selectCreatingObservationEvidence` keeps `latest_creating`. `priority_pairing` on those projections is `null`. List `pairing` is omitted. Admin copy for `latest_action === "priority_5"` may say this intake was opened under the retired Priority 5 trigger — not that Priority 5 still opens intakes.

---

## 7. Read projections (easy access)

Server DTOs are the authority. Masking rules in `projections.ts` do not relax. Pairing carries IDs, times, route, and Priority only — no contact, no raw receipt, no job number beyond what the parent case already exposes.

### 7.1 Shared wire shape

```ts
export type BookingPriorityPairingProjection = {
  pairing: "priority_5_then_booked" | "booked_carries_priority_5" | "booked_without_priority_5";
  creating_booked: {
    observation_id: string;
    receipt_id: string;
    captured_at: string; // ISO
    route_event_class?: string;
    payload_event_type_raw?: string;
    priority_canonical?: string;
    priority_valid: boolean;
    priority_is_5: boolean;
  };
  preceding_priority_5?: {
    observation_id: string;
    receipt_id: string;
    captured_at: string;
    route_event_class: "priority_updated";
    payload_event_type_raw?: string;
    priority_canonical: "5";
  };
  later_priority_5?: {
    observation_id: string;
    receipt_id: string;
    captured_at: string;
    route_event_class: "priority_updated";
    payload_event_type_raw?: string;
    priority_canonical: "5";
  };
};
```

ISO timestamps. IDs as 24-char hex strings.

### 7.2 Case list

Add to `GranotLifecycleCaseListItem`:

```ts
priority_pairing?: {
  pairing: BookingPriorityPairingProjection["pairing"];
  creating_booked_priority_is_5: boolean;
  has_preceding_priority_5: boolean;
  has_later_priority_5: boolean;
};
```

Omit on Release rows and on historical Booking rows with no creating Booked Observation.

List may use the persisted snapshot for `pairing` / `creating_booked_priority_is_5` / `has_preceding_priority_5`. `has_later_priority_5` is always current: for the page’s Booking jobs, load post-Booked `priority_updated` canonical `5` observations (one query, jobs `$in`). Do not `$lookup` inside a per-row loop.

### 7.3 Case detail

Add `priority_pairing: BookingPriorityPairingProjection | null` to `GranotLifecycleCaseDetail`. Compute with `projectBookingPriorityPairing` from the creating Booked Observation (same selection as `selectCreatingObservationEvidence`) plus same-job observations already loaded for the job timeline. Do not hide `later_priority_5` because the snapshot omitted it.

### 7.4 Creating observation (Owner-only)

`GET /api/v1/admin/granot-lifecycle/cases/:case_id/creating-observation` adds:

- `priority_pairing: BookingPriorityPairingProjection | null`
- `paired_priority_5_observation?: CreatingObservationSnapshot` — the preceding Priority 5 Observation, same snapshot shape as `observation`, **without** a second `granot_statement`. Raw Priority Update payload is not required for audit. The Booked `granot_statement` remains the statement that created the intake.

When `pairing === "booked_without_priority_5"`, the envelope must still return 200 and still include `granot_statement` for the Booked Observation. Absence of Priority 5 is not `GRANOT_CASE_NOT_FOUND`.

### 7.5 Job / Lead timeline

No schema change. The preceding Priority 5 and the Booked action already appear as separate entries. Case detail must link the pairing observation IDs; the existing job page (`intakeJobHref`) is the drill-down.

---

## 8. Admin copy and UI

Server-first. Admin consumes the exported DTOs.

| Surface | Change |
| --- | --- |
| `intakeWhyHere` | `booked` stays “Granot recorded a booking”. `priority_5` becomes “Opened under the retired Priority 5 trigger”. Do not imply Priority 5 still opens intakes. |
| `intakeEmptyMessage` (booking, open) | “No booking intakes waiting. When Granot records a Booked job, it will show up here.” |
| Intake list row | If `priority_pairing.pairing === "priority_5_then_booked"`, one quiet line: “Priority 5 then Booked”. If `booked_without_priority_5`, a warning line: “Booked without Priority 5”. `booked_carries_priority_5` needs no extra line. |
| `CreatingObservationView` | New “Priority pairing” section **above** Granot statement: pairing class, creating Booked Priority, preceding Priority 5 captured_at + observation id, later Priority 5 if present, link to the job timeline. Booked-without-5 uses the same warning language as the list. |
| Case detail | Same pairing block if the creating-observation accordion is collapsed; do not make the owner open JSON to see the pair. |

Do not add a new route or a new Admin page.

---

## 9. Acceptance criteria

Replace AC-18. Add pairing ACs. Keep AC-19.

| ID | Assertion |
| --- | --- |
| AC-18 | `priority_updated` with valid canonical `5`, eligible matched Lead, no Booking, live + booking-cases enabled, does **not** call Booking reconciliation and does **not** insert or refresh a Booking case. The Observation is free to apply lead desired-state when lead-write gates allow. Priority 5 with an existing Booking still opens no review case. |
| AC-19 | Unchanged: actual Booked + no Booking → `create_missing_booking`; actual Booked + one active Booking → `review_existing_booking`; never a second Booking. Booked with missing/invalid/non-`5` Priority still opens the case. |
| AC-18a | Referral Priority 5 only remains `not_booking_evidence`. Referral actual Booked still opens `create_referral_booking` / review-existing as today. |
| AC-P1 | Same job: `priority_updated` `5` then `booking_status_changed` `Booked`. Case opens on Booked only. `priority_pairing.pairing === "priority_5_then_booked"`. `preceding_priority_5.observation_id` is that Priority Update. Case `evidence` contains only the Booked row. |
| AC-P2 | Booked Observation with valid canonical `5` and no preceding `priority_updated` `5`. Case opens. `pairing === "booked_carries_priority_5"`. `preceding_priority_5` absent. |
| AC-P3 | Booked Observation whose Priority is missing, invalid, or not `5`. Case still opens. `pairing === "booked_without_priority_5"`. `creating_booked.priority_is_5 === false`. Creating-observation returns 200 with the Booked statement. |
| AC-P4 | After a Booked-without-5 case is open, a later `priority_updated` `5` does not refresh case evidence or increment `evidence_revision`. Read-time `later_priority_5` points at that Observation. |
| AC-P5 | `booking_status_changed` `event_type: Releas` still returns `opposite_action_kind` and writes no Booking case. Open `{normalized_job_no, action_kind: "booked"}` uniqueness is unchanged. A later Booked refreshes the same open case. |
| AC-P6 | Historical open case whose evidence is only `priority_5` still reads. `priority_pairing` is `null`. creatingObservation uses `latest_creating`. |
| AC-P7 | Case list, case detail, and creating-observation all expose the same pairing class for the same creating Booked Observation. No contact or raw Priority Update payload appears on pairing. |
| AC-P8 | Exact Booked Observation replay does not append evidence, does not change pairing snapshot, and returns the stored Decision. |

---

## 10. Tests the implementing agent must add or rewrite

Minimum. Names may follow repo style; assertions may not shrink.

**`bookingPriorityPairing.test.ts` (new, pure):** AC-P1, AC-P2, AC-P3, AC-P4 class/ref selection; equal temporal tuple is neither side; other jobs ignored; `lead_created` with Priority 5 is not preceding; throws without a Booked creating Observation.

**`bookingReconciliation.test.ts`:** Rewrite the AC-18 block. Add AC-18a. Keep AC-19 Booked-with-invalid-Priority. Assert classifier never returns `evidence_action: "priority_5"`.

**`processor.test.ts`:** Priority 5 live + `booking_cases_enabled` does not invoke `reconcileBooking`. Existing Booked-with-invalid-Priority invocation stays.

**`bookingReconciliation.replica.test.ts` (or equivalent):** Open on Booked, persist `priority_pairing`, replay is a no-op, second Booked refreshes evidence and snapshot, Priority 5 after open does not write the case.

**`creatingObservation.test.ts`:** Envelope includes `priority_pairing` and `paired_priority_5_observation` for AC-P1; AC-P3 has pairing and no paired snapshot; historical Priority-5-only remains `latest_creating` with `priority_pairing: null`.

**`projections` tests:** List item compact pairing; detail full pairing including `later_priority_5`; Release rows omit pairing.

**Admin:** `intake-copy` tests for new why-here / empty copy and pairing labels. `CreatingObservationView` / accordion tests render the pairing section for best-case and Booked-without-5.

No live Mongo, no production flag change, no FINAL SPEC edit.

---

## 11. Out of scope

- Enabling or disabling `GRANOT_LIFECYCLE_BOOKING_CASES_ENABLED` / `BOOKING_COMMANDS`.
- Opening Release cases, or auto-closing a Booking case on Releas.
- Making Booked also apply lead desired-state on the same Observation.
- Prefilling official Booking fields from Granot Priority or money.
- Backfilling `priority_pairing` onto existing cases (read-time compute covers them).
- New Admin page, new webhook route, new flag, new unique index.
- Rewriting `FINAL-SPECIFICATION-GRANOT-LEAD-LIFECYCLE.md`.

---

## 12. Docs the implementing agent updates after the code is green

Do not OKF-ify the locked FINAL SPEC. Update:

- [`CONTEXT.md`](../../../CONTEXT.md) — already restated in this change set; keep Booking Priority Pairing if not present.
- `docs/knowledge/granot-lifecycle/processor.md` — Booking case gate is Booked-only.
- `docs/knowledge/granot-lifecycle/booking-reconciliation.md` — trigger table; pairing snapshot.
- `docs/knowledge/granot-lifecycle/projections.md` — list/detail/creating-observation pairing.
- This hub: [`docs/knowledge/granot-lifecycle/spec-hub.md`](../knowledge/granot-lifecycle/spec-hub.md) already links here.

---

## 13. Suggested implementation order

1. Pure `bookingPriorityPairing.ts` + tests (AC-P1–P4).
2. Classifier + processor gate + rewrite AC-18 tests.
3. Persist optional `priority_pairing` on open/refresh + replica test.
4. Projections + creatingObservation DTOs + route tests.
5. Admin types, intake copy, pairing UI.
6. Knowledge docs listed in §12.

Stop when every AC in §9 has an automated test and Admin shows the two audit lines without opening raw JSON.
