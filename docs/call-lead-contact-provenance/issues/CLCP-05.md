# CLCP-05 — Owner desk any-known-contact (required)

> **Contract maturity: implementation-ready.** After CLCP-01. Required.
> Owner desk search and Admin Call Leads behave like shipped Form
> snapshots. Processor identity still does not query Call snapshot phone.

## 1. Authority and required reading

- **Pack specification:** [`../call-lead-contact-provenance-specification.md`](../call-lead-contact-provenance-specification.md)
  — §1.8, §3.6, §7–§8, §12.8.
- **Shipped Form pattern:**
  [`../../form-lead-contact-snapshots-display-and-search-specification.md`](../../form-lead-contact-snapshots-display-and-search-specification.md)
  (file may live under `internal_hidden_docs/` — follow the Admin
  CONTEXT pointer), [`leadBrowseShared.ts`](../../../src/services/search/leadBrowseShared.ts)
  `FORM_LEAD_CONTACT_*_PATHS`,
  `vantage-admin/components/operational/form-lead-contacts.tsx`.
- **Pack rules:** [`../README.md`](../README.md), [`../AGENT-PROTOCOL.md`](../AGENT-PROTOCOL.md)

## 2. Objective

After a later Granot phone or name lands on `granot_contact_snapshot`,
the Owner can **find** that Call Lead and **see** both cards. Phone is
the path that must not miss. Headline stays **Called** (live /
ingested). Granot chip when the snapshot exists; **Changed in Granot**
when `differs_from_ingested`. This does not change processor identity
and does not auto-attach on snapshot-phone-only confidence.

## 3. Repository, branch, and prerequisites

- **Repositories:** `vantage-main-server` (search paths, DTO).
  `vantage-admin` (chip, Contact tab). Extension Search / Call browse
  use the server `GET` / `POST` paths — no second write path; no chip
  required on extension Search cards (same as Form).
- **Prerequisites:** CLCP-01 `complete`.
- Same pack branch on the server. One admin branch from current admin
  `main` if none exists for this pack (`call-lead-contact-provenance`).

## 4. Current-state evidence to verify

- `projections.ts` `callLeadCandidateSearchOr` (~1622–1631) live-only.
- `connectLeadCandidates.test.ts` (~80–96) asserts Call `q` omits
  snapshot paths.
- `projectCandidateKnownContacts` / `known_contacts` on Form items only
  (`projections.ts` ~970, ~1048).
- Admin Call browse / typeahead omit snapshots
  ([`lead-browse.md`](../../knowledge/services/lead-browse.md),
  [`admin-search.md`](../../knowledge/services/admin-search.md)).
- `POST /api/v1/call-leads/search` is an OR lookup and omits snapshots
  ([`call-lead-search.md`](../../knowledge/services/call-lead-search.md)).
  This is **not** Form-style weighted scoring.
- Admin `callLeadColumns` has no `granot_contact` column.
  `ContactTab` for Call Leads is a single live grid
  (`operational-detail-panel.tsx` ~437–444).
- Form already has `granot_contact` column + `FormLeadContactsSection`.

## 5. Locked decisions and invariants at risk

- Reuse shared path lists. Add `CALL_LEAD_CONTACT_*_PATHS` next to the
  Form lists **or** share the same arrays if field names match. Do not
  copy literals into `projections.ts`.
- Do **not** add snapshot phone to `identity.ts`.
- **Do** include snapshot phone/name/email on
  `POST /api/v1/call-leads/search` (extension Search + any OR client).
  Phone is the path that must not miss.
- Do not auto-attach on snapshot-phone-only confidence.
- Owner labels only: **Called** / **Granot** / **Changed in Granot**.
  Do not print field names.
- Name / Phone columns stay Called. Do not replace them with Granot
  values.

## 6. Deliverables and exact contract

1. Call intake + Connect `q` OR live + ingested + Granot name/email/phone
   + `job_no`.
2. Call candidate/Connect DTO `known_contacts` (headline = Called;
   `granot` when snapshot exists; omit `observation_id`).
3. Invert Connect test that forbids Call snapshot paths.
4. Admin browse `q` / `name` / `email` / `phone_number` and Admin
   typeahead Call group use the same lists.
5. Extension `GET /api/v1/call-leads` uses the same lists.
6. `POST /api/v1/call-leads/search` phone/name/email also OR snapshot
   (and ingested) paths. Keep OR semantics. Do not add scoring.
7. Admin `/call-leads` and `/duplicate-call-leads`: Granot contact chip
   column. Contact tab: Called card + Granot card. Reuse
   `form-lead-contacts.tsx` helpers with Called labels — do not fork a
   second chip component unless a label string must change.

## 7. Out of scope

Processor identity. CSV / preview (CLCP-03). Flags. Reconstructing
historical phones. Weighted Form-style search. Enabling Lead writes.

## 8. Tests

```text
src/services/granotLifecycle/connectLeadCandidates.test.ts
src/services/granotLifecycle/projections.candidates.test.ts
src/services/search/callLeadSearch.service.ts  (add a focused test file if none exists)
src/services/admin/admin.service.test.ts
```

Plus Admin component tests for the Call chip / Contact cards
(`vantage-admin/tests/form-lead-contacts.test.ts` pattern).

## 9. Knowledge updates after this issue ships

Note for CLCP-04: `lead-browse.md`, `admin-search.md`,
`call-lead-search.md`, `projections.md`, BILA §2, Admin CONTEXT
pointer. Invoke docs-keeper from CLCP-04.

## 10. Acceptance criteria

- [x] Call intake / Connect `q` hits snapshot phone (and name/email)
- [x] Call items may carry `known_contacts.granot`; headline is Called
- [x] Admin browse + typeahead Call `q` / phone hit the snapshot
- [x] Extension `GET /call-leads` `q` / phone hit the snapshot
- [x] `POST /call-leads/search` phone hits the snapshot
- [x] Admin `/call-leads` shows Granot chip; Contact tab has two cards
- [x] Identity still does not query Call `granot_contact_snapshot`
- [x] No auto-attach on snapshot-phone-only
- [x] Focused tests pass
- [ ] Browser walk of Admin `/call-leads` list + detail Contact tab
      (Called vs Granot) before close — pending coordinator (admin/server not running)

## 11. Commands

```text
cd vantage-main-server
pnpm exec tsx --test src/services/granotLifecycle/connectLeadCandidates.test.ts
pnpm exec tsx --test src/services/granotLifecycle/projections.candidates.test.ts
pnpm typecheck
```

Name the Admin and search commands actually run in the completion
report.

## 12. Risks

- Adding snapshot phone to automatic identity.
- Showing Granot name as the headline or Phone column.
- Leaving `POST /call-leads/search` live-only because an older draft
  called it “scored.”
- Treating this as required for **automatic** booking-intake match (it
  is not). It is required for Owner find/display.

## 13. Rollback

Revert search paths + DTO + Admin chips / Contact cards.

## 14. Handoff list for the completion report

- Files changed (server and Admin)
- Proof `identity.ts` phone `$or` still omits snapshot
- Browser evidence for Admin list chip + Contact tab
- Note for CLCP-04 browse / search / projections / BILA
