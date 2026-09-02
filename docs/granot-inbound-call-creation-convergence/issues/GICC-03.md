# GICC-03 — Knowledge and Owner rollout checklist

> **Contract maturity: implementation-ready.** Session 3. Docs and the
> Owner checklist for flipping inbound Call Granot CRM Sources. **No
> production Registry apply. No production flag enable.**

## 1. Authority and required reading

- **Pack specification:** [`../granot-inbound-call-creation-convergence-specification.md`](../granot-inbound-call-creation-convergence-specification.md)
  — §1.4, §4.3, §7, §8, §9, §11, §13.5.
- **Depends on:** [GICC-01](GICC-01.md) and [GICC-02](GICC-02.md) `complete`.
- **Pack rules:** [`../README.md`](../README.md), [`../AGENT-PROTOCOL.md`](../AGENT-PROTOCOL.md)
- **docs-keeper:** matching knowledge layer + owning glob rule only.

## 2. Objective

Service docs and the activation/policy note describe what shipped:
Call `create_if_missing` on `priority_updated` (no new policy value),
always-on phone fence, both arrival orders, residual holes, Best
Relocation Inbounds SMS inheritance, and the Owner sequence for a later
inbound `link_only` → `create_if_missing` flip.

## 3. Repository, branch, and prerequisites

- **Repository:** `vantage-main-server` only.
- **Branch:** same as GICC-02.
- **Prerequisites:** GICC-02 `complete`.
- Invoke docs-keeper after the runtime files exist. Do not invent domain
  terms.

## 4. Current-state evidence to verify

Observed 2026-09-02; **reverify against shipped GICC-01/02**.

- `processor.md` / `desired-state.md` say only `lead_created` creates.
- `ringcentral-call-lead-qualification.md` says the pre-creation fence
  rides with the adoption flag.
- `operations-registry.md` and
  `lifecycle-activation-flags-and-source-policies.md` say Main Site /
  TBM / Top10 / 10best inbound stay `link_only`.
- ORCHESTRATION owner sentence says `create_if_missing` is for leads
  born in Granot, not on a RingCentral queue.

## 5. Locked decisions and invariants at risk

- Docs describe shipped code. If GICC-01/02 drifted, fix the docs to
  the repository, then note spec drift in `PROGRESS.md`.
- Do not apply `createOrUpdateGranotCrmSource` against production.
- Do not invent a fourth `lead_created_policy` value in docs.
- Do not enable SMS by documenting a later inbound policy flip.
- Name Best Relocation Inbounds inheritance: that row already has
  `create_if_missing` and `outbound_sms.enabled`; the event-class code
  change is what turns inbound `priority_updated` create (and existing
  confirmation SMS) on for that source.
- Match key remains Source Granularity + phone in every sentence that
  could be read as Caller Match Key alone.

## 6. Deliverables and exact contract

1. Update the knowledge files listed in pack spec §11.
2. Add an Owner checklist (in the activation doc or a short subsection
   of this pack’s spec §8 — do not create a second contract) covering:
   - GICC-01/02 shipped and tests green
   - No new Registry policy — flip is still `link_only` →
     `create_if_missing` on the existing Granot CRM Source field
   - `RINGCENTRAL_GRANOT_ADOPTION_ENABLED=true` and create write mode
     **before** flipping any inbound source that has a RingCentral
     assignment
   - That Call granularity has **0 or 1** active valid RingCentral
     assignment (`assertSingleActiveRingCentralAssignment`)
   - Best Relocation Inbounds stays Granot-only (zero assignments) and
     **already inherits** `priority_updated` create from the shipped
     code; it does not need a second policy flip
   - Best Relocation Inbounds confirmation SMS uses the existing
     `sendGranotCreatedLeadConfirmation` finalize if messaging gates
     are on. Other inbound families stay silent until a separate
     `outbound_sms` command
   - Audited `createOrUpdateGranotCrmSource` per inbound Call source
     that is still `link_only`
   - Customer text stays a separate command
   - Expand unmapped inbound numbers as companion operations
3. Tick pack spec coverage rows in `PROGRESS.md`.

## 7. Out of scope

Production apply. Admin UI. GetMovers classification. New inbound
queue rows. Code changes unless a comment in a shipped file is false.

## 8. Tests

None required unless a doc example is executable. Do not skip GICC-01/02
tests as a substitute.

## 9. Knowledge updates after this issue ships

This issue **is** the knowledge update.

## 10. Acceptance criteria

- [ ] `processor.md` and `desired-state.md` state Call `create_if_missing`
      may create on `priority_updated`
- [ ] `call-lead.md` and `ringcentral-call-lead-qualification.md` state
      the phone fence is always on; adoption remains flagged
- [ ] Registry / activation docs name inbound families as eligible for
      `create_if_missing` after an Owner command, with the adoption
      companion; still three policy values; no ninth gate
- [ ] Best Relocation Inbounds inheritance (event-class + existing SMS)
      and the 0-or-1 assignment check are written
- [ ] Residual holes (Job-only, Booked-first, unmapped numbers) are
      written, not implied
- [ ] No production mutation ran

## 11. Commands

```text
# docs-keeper for the matching layer after the edits
# no production migration
```

Record what docs-keeper changed.

## 12. Risks

- Owner reads “eligible for create_if_missing” as “already flipped”.
  The checklist must say command + flags, not “done”, except Best
  Relocation Inbounds, which already has the policy and inherits the
  event class from the code.
- Owner is surprised that Best Relocation inbound creates can text.
  The checklist must say existing finalize, not a new SMS feature.

## 13. Rollback

Revert the doc files. No data.

## 14. Handoff list for the completion report

- Files changed
- docs-keeper summary
- Explicit “production not applied” line
- Confirmation docs still have three `lead_created_policy` values
- Next Owner operations step (flags + 0-or-1 assignment, then Registry
  command for still-`link_only` inbound sources, then inbound number
  coverage; Best Relocation Inbounds already inherits)
