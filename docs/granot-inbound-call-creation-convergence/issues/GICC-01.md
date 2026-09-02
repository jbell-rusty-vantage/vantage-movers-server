# GICC-01 — Call create_if_missing on priority_updated

> **Contract maturity: implementation-ready.** Session 1. Let inbound Call
> `create_if_missing` mint on the event Granot actually sends. **No
> adoption-flag change. No Registry policy flip. No booking-status create.**

## 1. Authority and required reading

- **Pack specification:** [`../granot-inbound-call-creation-convergence-specification.md`](../granot-inbound-call-creation-convergence-specification.md)
  — §0, §1, §1.4, §4, §9, §10.1, §13.1, §13.4. Wins on event class.
- **Upstream:** UNIT-19 / shipped planner — still the only create command;
  this issue only widens `route_event_class` for Call + `create_if_missing`.
  Do not add a Registry policy value.
- **Pack rules:** [`../README.md`](../README.md), [`../AGENT-PROTOCOL.md`](../AGENT-PROTOCOL.md)
- **Glossary:** workspace-root `CONTEXT.md`

## 2. Objective

An unmatched inbound Call Observation with reviewed `create_if_missing`,
complete Call minimum data, and `route_event_class` of `lead_created`
**or** `priority_updated` plans `created` / `lead_created_authorized` and
the command accepts that Observation. Form `lead_created` +
`create_if_missing` stays eligible. Form `priority_updated`, `link_only`,
invalid priority, and `booking_status_changed` stay unable to mint. No
new Registry policy.

## 3. Repository, branch, and prerequisites

- **Repository:** `vantage-main-server` only.
- **Branch:** current desk branch, or `granot-inbound-call-creation-convergence`
  if isolating. See the protocol.
- **Prerequisites:** none. This is the only startable issue.
- Synthetic data only. No commit, push, deploy, production flag, or live
  payload unless the user asks.

## 4. Current-state evidence to verify

Observed 2026-09-02; **reverify at implementation**.

- `leadDesiredState.ts` `planNoMatch` creation branch is
  `route_event_class === "lead_created"` only (~210).
- `createLeadFromGranot.ts` `executeCreation` throws policy race unless
  `lead_created` (~241), **before** `resolveSourcePolicy` /
  `selected_lead_model`.
- `evaluateMinimumCreationData` already treats Call as Job-only eligible.
- `processor.ts` `maybeCreateLead` does not itself check route class; it
  trusts the plan + command. `requestedEffect()` already returns
  `"lead_created"` when `creation_eligibility === "eligible"`.
- `sourcePolicy.ts` `evaluateEffectGates` / `policyPermitsEffect` do not
  read `route_event_class`. **Do not change that file.**
- `maybeReconcileBooking` still returns before create on booked/release.

## 5. Locked decisions and invariants at risk

- **Widen** Call + `create_if_missing` onto `priority_updated`. **Do not
  retarget** Form `lead_created` + `create_if_missing` (must stay eligible).
- Do not open Form `priority_updated` create.
- Do not create on `booking_status_changed`.
- Do not add a fourth `lead_created_policy` value, inbound mint boolean,
  or ninth gate. Do not change `sourcePolicy.ts` or `leadMessaging/`.
- `requested_effect` stays `"lead_created"` on this path.
- Identity must still run first. Eligible match → no create (GICC-02
  owns the fence tests; do not weaken the identity re-read).
- Idempotency key stays `granot:create-lead:<observation_id>`.
- Do not fabricate RingCentral metadata.
- Do not flip Registry rows or flags.

## 6. Deliverables and exact contract

1. `planNoMatch`: keep the existing `lead_created` creation branch for
   **any** `selected_lead_model` + `create_if_missing`. **Also** run
   `evaluateMinimumCreationData` and set `creation_eligibility:
   "eligible"` when `priority_updated` + `create_if_missing` +
   `selected_lead_model === "CallLead"` and minimum data is complete.
   Form + `priority_updated` must not enter that branch.
2. `createLeadFromGranot` `executeCreation`: the early observation-load
   check must not require `CallLead` (model is unknown there). Allow
   `lead_created` for any model at that line, or move the event-class
   check until after the snapshot. After `selected_lead_model` and
   policy are known, accept `priority_updated` only for CallLead +
   `create_if_missing`. Reject Form + `priority_updated` as
   `CreateLeadFromGranotRaceError("policy")`.
3. Tests in §8. Knowledge notes for GICC-03 if comments in those two
   files would otherwise lie. Do not edit `sourcePolicy.ts`.

## 7. Out of scope

Always-on phone fence (GICC-02). Adoption flag. Registry inbound policy
flip. New `lead_created_policy` value. Booking-case create. Admin UI.
Production apply. `sourcePolicy.ts`. `leadMessaging/`.

## 8. Tests

See pack spec §10.1. Add or extend `leadDesiredState.test.ts` and
`createLeadFromGranot` unit tests (and processor create tests if that is
where the command is asserted). No skipped required tests.

## 9. Knowledge updates after this issue ships

Leave a one-line note in `PROGRESS.md` Cross-issue findings if the two
source files’ comments still say “lead_created only”. GICC-03 writes the
Service docs.

## 10. Acceptance criteria

- [ ] Call + `create_if_missing` + `priority_updated` + unmatched + Job
      → eligible / command accepts
- [ ] Call + `create_if_missing` + `lead_created` still eligible
- [ ] Form + `create_if_missing` + `lead_created` still eligible
- [ ] Call + `link_only` + `priority_updated` not eligible
- [ ] Form + `create_if_missing` + `priority_updated` not eligible
- [ ] Call + `create_if_missing` + `booking_status_changed` not eligible
- [ ] Invalid priority update never creates
- [ ] `sourcePolicy.ts` unchanged
- [ ] Focused tests in §8 pass

## 11. Commands

```text
cd vantage-main-server
pnpm exec tsx --test src/services/granotLifecycle/leadDesiredState.test.ts
# plus the createLeadFromGranot / processor create test file(s) you touch
```

Record the command and pass count in the completion report.

## 12. Risks

- Opening Form `priority_updated` create, or **closing** Form
  `lead_created` create, if the route-class check is rewritten as
  Call-only for both event classes.
- Requiring `CallLead` at the observation-load guard before policy
  resolve.
- Booked observations never hit this path; do not “fix” that here.
- Best Relocation Inbounds already `create_if_missing` will inherit
  this path (and existing confirmation SMS) when creation is live.
  Do not add a second policy to delay that. Note it for GICC-03.

## 13. Rollback

Revert the planner and command route-class widening. No data migration.

## 14. Handoff list for the completion report

- Files changed
- Test command output
- What still says “lead_created only” in comments
- Confirmation that no Registry, flag, `sourcePolicy.ts`, or
  `leadMessaging/` changed
- Note for GICC-03: Best Relocation Inbounds inherits `priority_updated`
  create and existing confirmation SMS
