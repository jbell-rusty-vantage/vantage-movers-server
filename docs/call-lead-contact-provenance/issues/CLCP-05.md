# CLCP-05 — Optional Owner desk any-known-contact (deferred)

> **Deferred.** Do not pick up. Automatic booking-intake discovery does
> **not** need this. Un-defer only when the Owner asks for Granot-card
> paste in Find the right customer / Connect / Admin Call browse.

## 1. Authority and required reading

- **Pack specification:** [`../call-lead-contact-provenance-specification.md`](../call-lead-contact-provenance-specification.md)
  — §2, §3.6, §7, §8.
- **Shipped Form pattern:** [`../../booking-intake-lead-attachment/issues/BILA-01.md`](../../booking-intake-lead-attachment/issues/BILA-01.md),
  [`leadBrowseShared.ts`](../../../src/services/search/leadBrowseShared.ts)
  `FORM_LEAD_CONTACT_*_PATHS`.
- **Pack rules:** [`../README.md`](../README.md), [`../AGENT-PROTOCOL.md`](../AGENT-PROTOCOL.md)

## 2. Objective

Owner-typed Call `q` and Call candidate/browse cards behave like Form:
search live + ingested + `granot_contact_snapshot`; DTO carries
`known_contacts`; headline stays operational/ingested (the caller);
Granot chip when the snapshot exists; **Changed in Granot** when
`differs_from_ingested`.

This is desk convenience after a prior Job bind. It does not change
processor identity. It does not fix Booked-first + different phones
(no snapshot exists yet).

## 3. Repository, branch, and prerequisites

- **Repositories:** `vantage-main-server` and, for chips, `vantage-admin`.
- **Prerequisites:** CLCP-04 `complete` **and** Owner sets this issue
  to `ready` in `PROGRESS.md`.
- Do not start from `blocked` / `deferred`.

## 4. Current-state evidence to verify

- `projections.ts` `callLeadCandidateSearchOr` (~1622–1631) live-only.
- `connectLeadCandidates.test.ts` (~80–96) asserts Call `q` omits
  snapshot paths.
- `projectCandidateKnownContacts` / `known_contacts` on Form items only
  (`projections.ts` ~970, ~1048).
- Admin Call browse: [`lead-browse.md`](../../knowledge/services/lead-browse.md)
  — Call `q` has no contact snapshots.
- BILA-01 left Call chip out on purpose.

## 5. Locked decisions and invariants at risk

- Reuse shared path lists. Add `CALL_LEAD_CONTACT_*_PATHS` next to the
  Form lists **or** share the same arrays if field names match. Do not
  copy literals into `projections.ts`.
- Do not add snapshot phone to `identity.ts`.
- Do not change scored `POST /api/v1/call-leads/search`.
- Do not auto-attach on snapshot-phone-only confidence.
- Owner labels only: do not print field names.

## 6. Deliverables and exact contract

1. Call intake + Connect `q` OR live + ingested + Granot name/email/phone
   + `job_no`.
2. Call candidate/Connect DTO `known_contacts` (headline = live/ingested
   caller; `granot` when snapshot exists; omit `observation_id`).
3. Invert Connect test that forbids Call snapshot paths.
4. Optional same session: Admin / extension Call browse uses the same
   lists.
5. Admin UI chips only if this issue is explicitly expanded to
   `vantage-admin`.

## 7. Out of scope

Processor identity. CSV. Flags. Reconstructing historical phones.

## 8. Tests

```text
src/services/granotLifecycle/connectLeadCandidates.test.ts
src/services/granotLifecycle/projections.candidates.test.ts
```

Plus browse tests if browse is in scope.

## 9. Knowledge updates after this issue ships

Update `lead-browse.md`, `projections.md`, BILA §2, and pack `PROGRESS.md`.
Invoke docs-keeper.

## 10. Acceptance criteria

- [ ] Owner set status to `ready` before work started
- [ ] Call `q` hits snapshot paths on intake and Connect
- [ ] Call items may carry `known_contacts.granot`
- [ ] Identity still does not query Call `granot_contact_snapshot`
- [ ] Scored Call search unchanged
- [ ] Focused tests pass

## 11. Commands

Named after pickup. At least the Connect/candidate test files in §8.

## 12. Risks

- Treating this as required for booking-intake correctness (it is not).
- Adding snapshot phone to automatic identity.
- Showing Granot name as the headline.

## 13. Rollback

Revert search path + DTO + Admin chips.

## 14. Handoff list for the completion report

- Files changed (server and Admin)
- Proof identity.ts phone `$or` still omits snapshot
- Browser evidence if Admin chips shipped
