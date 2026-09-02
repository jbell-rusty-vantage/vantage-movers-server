# GICC-02 — Both arrival orders and always-on phone fence

> **Contract maturity: implementation-ready.** Session 2. RingCentral-first
> synchronize; Granot-first adopt. The phone fence must run even when
> adoption is off. **No Registry policy flip. No production flag enable.**

## 1. Authority and required reading

- **Pack specification:** [`../granot-inbound-call-creation-convergence-specification.md`](../granot-inbound-call-creation-convergence-specification.md)
  — §2, §5, §6, §7, §9, §10.2–10.4, §13.2–13.3.
- **Upstream:** UNIT-20 / `ringcentral-call-lead-qualification.md` §4 —
  ingest order and exact adoption candidate stay.
- **Depends on:** [GICC-01](GICC-01.md) shipped (Call `priority_updated`
  can reach create).
- **Pack rules:** [`../README.md`](../README.md), [`../AGENT-PROTOCOL.md`](../AGENT-PROTOCOL.md)
- **Glossary:** workspace-root `CONTEXT.md`

## 2. Objective

When a normalized phone exists, the two creators share one Call Lead:

- RingCentral already minted → inbound `create_if_missing` finds that
  Lead (identity + fence) and synchronizes. Origin stays `ringcentral`.
- Granot already minted (`pending`) → a later qualified call adopts.
  Origin stays `granot_lead_created`.

Match key is exact Source Granularity + normalized phone. Not Source
Company alone.

## 3. Repository, branch, and prerequisites

- **Repository:** `vantage-main-server` only.
- **Branch:** same as GICC-01.
- **Prerequisites:** GICC-01 `complete`.
- Synthetic data only. Replica tests stay replica-gated.

## 4. Current-state evidence to verify

Observed 2026-09-02; **reverify at implementation**.

- Two Granot lock sites in `createLeadFromGranot.ts` are both gated on
  `isRingCentralGranotAdoptionEnabled()`:
  `ensureRingCentralConvergenceScopeLock` (pre-transaction) and
  `acquireRingCentralConvergenceScopeLock` +
  `findPreCreationRingCentralConvergenceCandidates` (in-transaction).
  `acquire` requires the document `ensure` upserted.
- RingCentral ingest lock in `ringcentral-call-lead-ingest.service.ts`
  is also gated on the adoption flag. **Leave that gate.**
- Identity Call phone query is `source_granularity_id` + current or
  ingested phone; no origin filter; no `granot_contact_snapshot`.
- Adoption query is exact granularity + ingested phone + `pending` +
  empty RC ids + ±12h.
- Duplicate guard excludes unresolved pending/conflict Granot rows.
- Scope lock hashes `v1:{granularity}:{phone}`.
- Fence refuse today throws `CreateLeadFromGranotRaceError("identity")`;
  `maybeCreateLead` replans via `prepareDecision`.

## 5. Locked decisions and invariants at risk

- Fence always on when Observation has a phone. Ungate **both** Granot
  `ensure` and `acquire` + fence. Adoption flag no longer gates those
  two sites.
- Do **not** ungate the RingCentral ingest lock. Adoption mutations
  still require the adoption flag + create write mode.
- Do not widen candidate selection to Source Company.
- Do not adopt Job-only / `not_applicable`.
- Do not rewrite Ingestion Origin.
- Do not change Call Qualification or the 90-day Duplicate Lead window.
- Multiple candidates stay `conflict`, never first-row wins.

## 6. Deliverables and exact contract

1. Remove the adoption-flag gate from **both** Granot sites:
   `ensureRingCentralConvergenceScopeLock` and
   `acquireRingCentralConvergenceScopeLock` +
   `findPreCreationRingCentralConvergenceCandidates`. Keep the
   Observation-phone gate on both (no phone → skip; Job-only create
   remains legal — residual hole in spec §7).
2. Keep identity + replan: fence hit → `CreateLeadFromGranotRaceError("identity")`
   → `maybeCreateLead` `prepareDecision` replan →
   `maybeSynchronizeMatchedLead` when exactly one eligible Lead.
3. Prove both arrival orders with tests in §8, including adoption **off**
   for race A (sequential: RC Lead already exists → fence + identity →
   sync) and adoption **on** for race B (adopt happens).
4. Replica or existing race harness: concurrent create vs ingest on the
   same granularity+phone with **adoption on** and write mode `create`
   yields one Call Lead. Do not expand this issue to ungate the ingest
   lock so concurrent-with-adoption-off also holds.

## 7. Out of scope

Registry inbound policy flip. New `lead_created_policy` value. Enabling
production adoption. Ungating the RingCentral ingest lock. Mapping new
inbound numbers. Creating on booked. Changing ±12h or 90-day windows.

## 8. Tests

See pack spec §10.2, §10.3, §10.4. Extend
`createLeadFromGranot` / processor tests, `ringcentral-call-lead-ingest.service.test.ts`,
`callLeadConvergence.test.ts` (and replica file if that is where races
live). No skipped required tests.

## 9. Knowledge updates after this issue ships

Note fence/adoption split for GICC-03. Do not rewrite Service docs here
unless a comment would be false in the same file you edit.

## 10. Acceptance criteria

- [ ] RingCentral-origin Call Lead + later Granot Call
      `priority_updated` / `lead_created` same granularity + phone →
      synchronize, origin `ringcentral`, one Lead
- [ ] Same with `RINGCENTRAL_GRANOT_ADOPTION_ENABLED=false` → both Granot
      lock sites still run; fence still blocks create and replans to sync
- [ ] Pending Granot-created Call Lead + later qualified call →
      `lead_adopted`, one Lead, origin preserved
- [ ] Adopted Lead that matches a prior eligible Call Lead →
      `lead_adopted_duplicate`
- [ ] Job-only Granot Lead is not adopted
- [ ] Different Source Granularity, same phone → not adopted / not
      identity-matched
- [ ] Concurrent race with adoption **on** + write mode `create`: one
      Call Lead
- [ ] Ingest lock remains gated on the adoption flag
- [ ] Focused tests in §8 pass

## 11. Commands

```text
cd vantage-main-server
# unit files touched in this issue, then replica if you touch a replica file:
pnpm test:granot-lifecycle:replica -- --unit=20
```

Use the repo’s actual replica invocation if it has drifted. Record output.

## 12. Risks

- Job-only twin remains if Granot sends no phone. Do not invent a phone.
- Enabling inbound create in production without adoption still twins on
  race B. Named in spec §6.3; do not “fix” by widening match.

## 13. Rollback

Restore the adoption-flag gate on both Granot `ensure` and
`acquire` + fence sites. Do not leave `ensure` flagged if `acquire` is
not. Adoption command behavior should be unchanged from UNIT-20 except
tests. No data backfill.

## 14. Handoff list for the completion report

- Files changed
- Test / replica output
- Confirmation match key stayed granularity + phone
- Confirmation both Granot lock sites were ungated and ingest lock was not
- Residual Job-only hole still named
