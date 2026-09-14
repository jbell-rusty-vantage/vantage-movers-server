---
type: Specification
title: Referral review Release-first owner commands
description: >-
  Release-into-intake may open a Referral review_existing_booking with
  evidence[0] = Release. Owner No Action, Update Existing Booking, and
  Confirm Granot Cancellation must revalidate live Referral policy on
  that first-evidence chain, not require Booked on evidence[0]. Create
  Referral Booking minting stays Booked-only. Admin 409 copy must name
  the actual code, not always "case revision changed."
tags:
  - granot-lifecycle
  - booking
  - referral
  - owner-dashboard
status: proposed-final
stale_after: 2026-12-14
owners: [team:main-server, team:vantage-admin]
applies_to:
  - src/services/granotLifecycle/bookingOwnerCommands.ts
  - src/services/granotLifecycle/referralBooking.ts
  - src/services/granotLifecycle/bookingIntakeLatestAction.ts
  - vantage-admin/components/granot-lifecycle/no-action-form.tsx
  - vantage-admin/components/granot-lifecycle/booking-update-form.tsx
  - vantage-admin/components/granot-lifecycle/cancellation-command-form.tsx
  - vantage-admin/components/intakes/intake-copy.ts
sources:
  - id: glossary
    resource: ../../../CONTEXT.md
    title: Platform glossary
  - id: booking-reconciliation
    resource: ../knowledge/granot-lifecycle/booking-reconciliation.md
    title: Granot Booking reconciliation Service
  - id: release-into-intake
    resource: ../knowledge/granot-lifecycle/release-into-booking-intake.md
    title: Release into booking intake pointer
  - id: spec-hub
    resource: ../knowledge/granot-lifecycle/spec-hub.md
    title: Granot lead-lifecycle spec hub
---

# Referral review Release-first owner commands

> **Contract maturity: implementation-ready.** Product rules in this
> file win. File citations are evidence; reverify line numbers at
> implementation. Agents work from [`README.md`](README.md) →
> [`AGENT-PROTOCOL.md`](AGENT-PROTOCOL.md) → the matching issue. Do
> not start coding from chat notes.

**Prepared:** 2026-09-14  
**Repos:** `vantage-main-server` (owner-command policy helper + tests).
`vantage-admin` (409 copy only).  
**Canonical facts:** [Granot Booking Reconciliation Case](../../../CONTEXT.md),
[Granot Booking Action](../../../CONTEXT.md),
[Granot Observation](../../../CONTEXT.md),
[Referral Booking](../../../CONTEXT.md),
[No Action](../../../CONTEXT.md),
[Update Existing Booking](../../../CONTEXT.md),
[Confirm Granot Cancellation](../../../CONTEXT.md),
[Synchronization Decision](../../../CONTEXT.md)

---

## 0. Authority

Read in this order. Stop and report contradictions; do not silently merge.

| Order | Authority | Wins on |
| --- | --- | --- |
| 1 | **This file** | Referral review / No Action / Update / Cancel policy gate; what `evidence[0]` may be; 409 copy |
| 2 | [`release-into-booking-intake.md`](../knowledge/granot-lifecycle/release-into-booking-intake.md) and its spec | Release upserts onto the booking case; `evidence[0]` may be Release |
| 3 | [`booking-reconciliation.md`](../knowledge/granot-lifecycle/booking-reconciliation.md) | Persist, revisions, command table, latest-action Cancel gate |
| 4 | FINAL SPEC (via [`spec-hub.md`](../knowledge/granot-lifecycle/spec-hub.md)) | One Booking per Job Number; No Action writes no official aggregate; Referral has no Lead |
| 5 | Workspace-root [`CONTEXT.md`](../../../CONTEXT.md) | Words. Do not invent synonyms |
| 6 | Pack issues | Sequencing and scope only |

FINAL SPEC §19 still describes review as starting from a Booked action
and a separate Release case. **Release-into-intake superseded that
routing.** This file does not reopen routing. It only fixes the Owner
command leftover that still treats first case-evidence as “must be
Booked.”

Where an issue and this file disagree, this file wins and the issue
author fixes the issue in the same change.

---

## 1. Decision

`assertActiveReferralPolicy` revalidates that the **first case-evidence**
Receipt → Observation → Decision chain still names this Job Number,
is post-activation, live-mode, and points at a still-live Referral
Registry source.

The first Observation’s Granot Booking Action may be **`booked` or
`release`**.

It must **not** require `booking_action.normalized === "booked"` on
`evidence[0]`. That Booked-only check belongs only to
**Create Referral Booking** minting in `referralBooking.ts`.

Confirm Granot Cancellation still requires
`selectBookingIntakeLatestAction(evidence) === "release"`. Latest
action and first evidence are different facts. Do not merge them.

---

## 2. Why the current helper fails

Observed 2026-09-14 in production `vantagemovers` and
`src/services/granotLifecycle/bookingOwnerCommands.ts`
(`assertActiveReferralPolicy`). **Reverify line numbers before coding.**

1. Release-into-intake opens `review_existing_booking` when one
   Referral Booking already exists. The opening Granot Observation
   may be Release. Persist writes that row as `evidence[0]`.
2. Later Booked / Release Observations `$push` onto the same open
   case and increment only `evidence_revision`. Slot 0 never rotates.
3. `applyNoAction`, `applyUpdate`, and `applyConfirmCancellation`
   all call `assertActiveReferralPolicy` when the case has no
   Source Scope (Referral).
4. That helper loads `evidence[0]` and fails unless
   `observation.booking_action.normalized === "booked"`. It throws
   `IDENTITY_CONFLICT` / “Referral Booking evidence no longer matches
   the case.”
5. The official Referral Booking on the prior sequence is already
   valid. No Action is supposed to close the review case without
   writing it. The helper blocks that close.
6. `assertActiveSourceScope` has no action check. Source-scoped
   Release-first review already No-Actions in production.
7. Admin `no-action-form.tsx` maps **every** HTTP 409 to “The case
   revision changed (`${error.code}`).” The Owner sees
   `GRANOT_IDENTITY_CONFLICT` labeled as a revision change. Refresh
   and resubmit hits the same helper.

This is **case evidence order**, not “the job’s first-ever Observation
must be Booked.” A prior resolved `create_referral_booking` may already
hold the minting Booked Observation. That row is not `evidence[0]` on
the later review case.

---

## 3. What this pack does not reopen

These stay exactly as shipped:

- Release-into-intake persist and classifier. Do not change
  `bookingReconciliation.ts` open/refresh or `$push` order.
- One Booking per normalized Job Number. Do not mint a second Booking
  to unstick a review case.
- No Action writes the Command and case resolution only. No
  EntityChange, no Sheet Sync, no Lead / Booking / Cancellation write.
- Create Referral Booking still requires first evidence to be an
  actual **Booked** Observation (`referralBooking.ts`). Do not mint a
  Referral Booking from a Release payload.
- Confirm Granot Cancellation still requires latest action `release`
  (`assertBookingIntakeCancelAllowed` / `selectBookingIntakeLatestAction`).
  Wrong latest action stays **409** `GRANOT_CASE_REVISION_CONFLICT`.
- `prepareOwnerCommand` still uses `evidence[0]` as the causal ID
  chain. That provenance stays. It does not require Booked.
- `assertActiveSourceScope` stays unchanged.
- Historical Granot Release Reconciliation Case commands stay
  unchanged.
- Flag names and checked-in defaults stay false in git. This pack
  does not flip production flags.
- Do not invent a case-level Referral policy snapshot, walk evidence
  for the latest Booked Decision, or share one `noAction` across
  booking / historical Release / discrepancy.

---

## 4. Current leftover (must change)

In `assertActiveReferralPolicy`
(`bookingOwnerCommands.ts`):

```ts
const first = row.evidence[0];
// load Observation + Decision from first
if (
  !observation || observation.booking_action?.normalized !== "booked" ||
  !decision || decision.execution_mode !== "live" || !activation ||
  observation.captured_at < activation.activated_at ||
  observation.identity?.normalized_job_no !== row.normalized_job_no
) {
  throw lifecycle("Referral Booking evidence no longer matches the case", "IDENTITY_CONFLICT", 409, requestId);
}
```

Replace only the action predicate. Keep every other conjunct.

Accepted first-evidence actions: `booked` | `release`.  
Rejected: missing Observation, `priority_5`, empty / unknown action.

Live Referral Registry query stays: `enabled`, `lifecycle_enabled`,
`lifecycle_disposition: "referral_booking"`,
`lead_created_policy: "observation_only"`, no Source Company, empty
routes, matching `lifecycle_policy_version`. Miss → **422**
`GRANOT_POLICY_BLOCKED` / “Reviewed Referral source policy is no
longer active.”

---

## 5. Command matrix after the fix

| Command | First evidence Booked or Release | Latest action | Official write |
| --- | --- | --- | --- |
| `resolveGranotBookingCaseNoAction` | Accept | Any | None |
| `updateBooking` | Accept | Any | Official replace on the named Booking only |
| `confirmCancellation` | Accept | Must be `release` | Official Cancellation |
| `createReferralBooking` | Must be Booked (unchanged, other file) | n/a | Mint Referral Booking |

On the live review case whose latest action is Booked: No Action and
Update become possible; Confirm Cancellation stays blocked by latest
action. That is correct.

No Action on open `create_referral_booking` whose first evidence is
Release also starts working (case-only close). Create on that same
case still 409s in `referralBooking.ts`. Intended.

---

## 6. Admin 409 copy

Do not fork server invariants into Admin. Branch on `error.code`.

Owner-visible strings live in
`vantage-admin/components/intakes/intake-copy.ts`. Wire:

- `components/granot-lifecycle/no-action-form.tsx`
- `components/granot-lifecycle/booking-update-form.tsx`
- `components/granot-lifecycle/cancellation-command-form.tsx`

| Code | Owner sentence (intent) |
| --- | --- |
| `GRANOT_CASE_REVISION_CONFLICT` | The case revision or latest-action posture changed. Facts were refreshed. Unsent fields were preserved. Review and submit again. |
| `GRANOT_IDENTITY_CONFLICT` | This intake’s identity or Referral evidence no longer matches. Facts were refreshed. This is not a revision change. Review and submit again. |
| `DOMAIN_REVISION_CONFLICT` | The Booking revision changed. Facts were refreshed. Unsent fields were preserved. Review and submit again. |
| other 409 | Keep a generic refresh sentence. Do not say “case revision changed” unless the code is `GRANOT_CASE_REVISION_CONFLICT`. |

Keep: refetch detail, preserve unsent reason / form fields, no
auto-resubmit.

---

## 7. Production unstick

A code deploy of §4 is enough. Do **not** rewrite case evidence.

At pack authoring (2026-09-14), one open Referral review case existed
in `vantagemovers`: Job Number **5558690**, mode
`review_existing_booking`, no Source Scope, `case_revision` 1,
`evidence[0].action === "release"`, later Booked/Release chatter,
deterministic Referral Booking already created on the prior sequence.
After deploy, the Owner No-Actions that case (`booking_still_valid`
or omit the reason). Do not confirm a second Referral Booking.

One-off data repair only if post-deploy the first Decision lacks
`source_policy`, the Observation is pre-activation, or the Referral
Registry row is off — those are real 422 / 409.

---

## 8. Tests

Write failing tests first. Name them with the AC ids below.

### 8.1 Unit (`bookingOwnerCommands.test.ts`)

Extract a tiny exported predicate next to the helper, for example
`isAcceptedReferralPolicyAction(normalized)`, or test through the
helper if the suite already loads cases.

- `review_existing_booking` + first action `release` → accept
- `review_existing_booking` + first action `booked` → accept
- `create_referral_booking` + first action `booked` → accept (No Action
  still uses this helper)
- first action `priority_5` / missing → reject
- Create minting Booked-only stays proven in existing
  `referralBooking` tests. Do not loosen those.

### 8.2 Replica (`bookingOwnerCommands.replica.test.ts` or
`referralBooking.replica.test.ts`)

Seed: open `review_existing_booking`, existing Referral Booking, no
`lead_ref`, no Source Scope, `evidence[0] = release`, later
Booked/Release rows, live Referral Decision `source_policy` on the
first row, both command flags on in the test harness.

| Case | Expected |
| --- | --- |
| No Action | `no_action`; Booking count 1; no EntityChange; no Sheet Sync |
| Update | `booking_updated`; still one Booking; `referral_booking.update` only |
| Cancel when latest is Booked | 409 `GRANOT_CASE_REVISION_CONFLICT`; no Cancellation |
| Cancel when latest is Release | `cancellation_created`; no Lead attach |
| Referral Registry disabled | 422 `GRANOT_POLICY_BLOCKED` |
| Job mismatch / pre-activation | 409 `GRANOT_IDENTITY_CONFLICT` |

Do not call `createReferralBooking` on the review case.

Keep existing AC-28 mint / Booked-first review seeds.

### 8.3 Admin

Unit-test the copy helper: `GRANOT_IDENTITY_CONFLICT` must not use
the revision-changed sentence; `GRANOT_CASE_REVISION_CONFLICT` may.

---

## 9. Acceptance criteria

| ID | Criterion |
| --- | --- |
| **AC-RRF-01** | Referral `review_existing_booking` with `evidence[0].action === "release"` and a live Referral Decision/policy: No Action resolves `no_action` and does not write Booking / Lead / link / EntityChange / Sheet Sync. |
| **AC-RRF-02** | Same seed: Update Existing Booking may succeed against the deterministic Booking. Booking count stays 1. |
| **AC-RRF-03** | Confirm Granot Cancellation still requires latest action `release`. Latest Booked on that review case is 409 `GRANOT_CASE_REVISION_CONFLICT`, not identity. |
| **AC-RRF-04** | Create Referral Booking still refuses first-evidence Release. |
| **AC-RRF-05** | Dead Referral Registry policy is 422 `GRANOT_POLICY_BLOCKED`. |
| **AC-RRF-06** | Evidence-only Booked/Release append does not increment `case_revision` and does not stale a No Action body keyed by that revision (existing AC-20). |
| **AC-RRF-07** | Admin 409 copy distinguishes identity vs case revision vs Booking revision. Unsent fields stay. |
| **AC-RRF-08** | After deploy, Job 5558690 can No Action without an evidence rewrite and without a second Booking. |

---

## 10. Knowledge after ship

docs-keeper restamps only:

- [`booking-reconciliation.md`](../knowledge/granot-lifecycle/booking-reconciliation.md) —
  Referral review revalidates first-evidence Decision/policy; first
  action may be Booked or Release; latest action still gates Cancel.
- This pack’s pointer
  [`../knowledge/granot-lifecycle/referral-review-release-first.md`](../knowledge/granot-lifecycle/referral-review-release-first.md)
  — mark landed.
- [`spec-hub.md`](../knowledge/granot-lifecycle/spec-hub.md) and
  [`owner-booking-intake.md`](../knowledge/granot-lifecycle/owner-booking-intake.md)
  already link here; do not copy rules into them.

Do not add a glossary synonym. Do not copy the helper into Admin
CONTEXT.

---

## 11. Forbidden

- Automatic Booking / update / Cancellation from Granot.
- Treating No Action as dismiss that writes official fields.
- Walking to latest Booked for Referral policy identity.
- Changing `assertActiveSourceScope` or persist `$push` order.
- Enabling a later effect flag to make a test pass.
- Mapping every 409 to case-revision copy after RRF-02.
- Production Mongo writes, evidence splices, or force-close of 5558690
  as the implementation of this pack.

---

## 12. Files for the implementing agent

**Edit (RRF-01):**
`src/services/granotLifecycle/bookingOwnerCommands.ts`,
`bookingOwnerCommands.test.ts`,
`bookingOwnerCommands.replica.test.ts` and/or
`referralBooking.replica.test.ts`.

**Read-only (RRF-01):**
`referralBooking.ts` (minting stays Booked-only),
`bookingReconciliation.ts`,
`bookingIntakeLatestAction.ts`,
`errors.ts`.

**Edit (RRF-02):**
`vantage-admin/components/intakes/intake-copy.ts`,
`no-action-form.tsx`,
`booking-update-form.tsx`,
`cancellation-command-form.tsx`,
matching admin tests.

**Edit (RRF-03):** knowledge pointer + `booking-reconciliation.md`
via docs-keeper after the command is green.
