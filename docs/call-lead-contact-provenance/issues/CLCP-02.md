# CLCP-02 — Call identity: Job wins, skip competing phone

> **Contract maturity: implementation-ready.** After CLCP-01. Once a Call
> Lead is bound by Job / Record Link, a different Observation phone must
> **not** conflict with another caller in the same granularity. **No
> snapshot phone query. No Form ladder change.**

## 1. Authority and required reading

- **Pack specification:** [`../call-lead-contact-provenance-specification.md`](../call-lead-contact-provenance-specification.md)
  — §3.3, §4.4–4.5, §6, §7, §12.2–12.4.
- **Current Service:** [`../../knowledge/granot-lifecycle/identity.md`](../../knowledge/granot-lifecycle/identity.md)
- **Pack rules:** [`../README.md`](../README.md), [`../AGENT-PROTOCOL.md`](../AGENT-PROTOCOL.md)
- **Glossary:** workspace-root `CONTEXT.md`

## 2. Objective

`resolveCallLadder`: if Record Link or scoped `normalized_job_no` yields
a unique eligible Call target, return that result and **do not** emit
`job_number_conflict` because the Observation phone matches a
**different** Call Lead’s operational/ingested phone. Phone rung remains
the first-bind key when Job/link miss. Call phone query stays current +
ingested only.

## 3. Repository, branch, and prerequisites

- **Repository:** `vantage-main-server` only.
- **Prerequisites:** CLCP-01 `complete`.
- Same pack branch. Synthetic data only.

## 4. Current-state evidence to verify

Observed 2026-09-04; **reverify at implementation**.

- `identity.ts` `resolveCallLadder` (~784–844): Job/link, then phone,
  then if both targets and `id` differs → `conflict` /
  `job_number_conflict` (~826–834).
- `findCallLeadsByScopedPhone` (~273–288): `normalized_phone_number` OR
  `ingested_contact_snapshot.normalized_phone_number`. No
  `granot_contact_snapshot`.
- `identity.test.ts` `Call Job and phone pointing at different Leads is
  conflict` (~749–771) asserts two candidates and conflict.
- Form contact multi-match stays `ambiguous` (~711–730). Do not change.
- Duplicate Call Job hit stays readable (~732–747).

## 5. Locked decisions and invariants at risk

- Unique Job/link **wins**. Skip the competing phone rung (prefer skip
  the query).
- Do **not** add `granot_contact_snapshot` to the phone query.
- Do not widen to Source Company alone.
- Two eligible Jobs still `conflict` / `multiple_eligible_matches`.
- Lead Job ≠ Observation Job still `job_number_conflict` (planner
  `conflictingJob` + link evaluation). That is a **Job vs Job**
  conflict, not Job vs someone else’s ANI.
- Link `lead_ref` model/scope disagreement still hard-stops.
- First bind: no Job on Lead, phone equals operational/ingested → still
  `source_scoped_contact`.
- Booking intake uses this same ladder. After this issue, Booked-after-
  enrich suggests by Job even when Granot phone ≠ ANI. Booked-first
  still uses operational phone. Do not change `callLeadCandidateSearchOr`.

## 6. Deliverables and exact contract

1. `resolveCallLadder`: unique Job/link target → return; do not
   conflict on a different phone target.
2. Invert `identity.test.ts` ~749–771: Lead A has Job, Lead B has
   Observation phone → linked on A (`call_job_no_exact` or record
   link).
3. Keep tests: first-bind phone; two Jobs conflict; Form ambiguous
   contact; Duplicate Call Job readable.
4. Add: no Job on Lead, phone hit still works.

## 7. Out of scope

Planner (CLCP-01). CSV. Intake `q` / `known_contacts`. Form identity
snapshot OR (already shipped). Adoption query. Flag enablement.

## 8. Tests

```text
src/services/granotLifecycle/identity.test.ts
```

Add processor/booking tests only if an existing case fixture encodes
the old Job-vs-phone conflict and would now fail.

## 9. Knowledge updates after this issue ships

Note for CLCP-04: `identity.md` “Job and phone pointing at different
eligible Leads are conflict” must be rewritten for Call after unique
Job bind.

## 10. Acceptance criteria

- [ ] Unique Job + Observation phone = other Lead’s ANI → linked on Job
      Lead, not `job_number_conflict`
- [ ] No Job + matching operational/ingested phone → still phone bind
- [ ] Two eligible Call Jobs still conflict
- [ ] Call phone query still omits `granot_contact_snapshot`
- [ ] Form ladder tests unchanged
- [ ] `callLeadCandidateSearchOr` / Connect Call `q` unchanged
- [ ] Focused tests in §8 pass

## 11. Commands

```text
cd vantage-main-server
pnpm exec tsx --test src/services/granotLifecycle/identity.test.ts
pnpm typecheck
```

Record command and pass count.

## 12. Risks

- Adding snapshot phone to the query “for robustness.” Forbidden.
- Skipping the phone rung even when Job **misses** (breaks first bind).
- Treating Job-vs-**different-Job-on-same-Lead** as a win. Still conflict.
- Changing Form multi-match from `ambiguous` to `conflict` or the reverse.

## 13. Rollback

Revert `resolveCallLadder` and identity tests. No migration.

## 14. Handoff list for the completion report

- Files changed
- Test command output
- Confirmation no `granot_contact_snapshot` in Call phone `$or`
- Note for CLCP-04 identity.md sentence
- Confirmation intake Call `q` untouched
