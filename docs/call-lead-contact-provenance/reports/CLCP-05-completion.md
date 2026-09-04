# CLCP-05 completion

Closed 2026-09-04. Server repo `vantage-main-server`, branch `call-lead-contact-provenance`. Admin repo `vantage-admin`, branch `call-lead-contact-provenance`.

## Behavior

Owner desk Call search now matches any known contact: live + ingested + Granot name/email/phone, plus `job_no` (`ref_no` where that surface already had it). Phone is the path that must not miss.

Intake / Connect Call `q` uses the shared Call path lists. Call candidate items carry `known_contacts` (live bag stays `form_submitted` in the DTO; Owner UI labels it **Called**). `granot` is present when the snapshot exists. `observation_id` is omitted.

Admin browse `q` / `name` / `email` / `phone_number` and Admin typeahead Call group use the same lists. Extension `GET /api/v1/call-leads` (`callLeadBrowse`) does too. `POST /api/v1/call-leads/search` ORs ingested + snapshot paths for phone/name/email and keeps OR semantics (no scoring).

Admin `/call-leads` and `/duplicate-call-leads` show a Granot contact chip column. Name / Phone stay Called (`path: "name"` / `path: "phone_number"`). Contact tab renders Called + Granot cards via reused `form-lead-contacts.tsx` helpers (`liveTitle` defaults to `"Form submitted"` so Form tests stay green).

Processor identity is unchanged. `findCallLeadsByScopedPhone` still queries live + ingested phone only.

## Files changed

Server:

- `src/services/search/leadBrowseShared.ts` — `CALL_LEAD_CONTACT_*_PATHS` aliases of the Form lists
- `src/services/granotLifecycle/projections.ts` — Call `q` uses the shared lists; Call items get `known_contacts`; candidate projection includes both snapshots
- `src/services/granotLifecycle/connectLeadCandidates.test.ts` — inverted Call `q` omit
- `src/services/granotLifecycle/projections.candidates.test.ts` — inverted Call `q` omit; Call `known_contacts` mapping
- `src/services/admin/adminBrowse.service.ts` — Call `qFields` / name / email / phone use the shared lists
- `src/services/admin/adminSearch.service.ts` — Call typeahead fields use the shared lists
- `src/services/admin/admin.service.test.ts` — Call browse `q` / phone snapshot assertion; typeahead Call hits snapshot
- `src/services/search/callLeadBrowse.service.ts` — `q` / name / email / phone use the shared lists
- `src/services/search/callLeadBrowse.service.test.ts` — new; `q` / phone hit snapshot
- `src/services/search/callLeadSearch.service.ts` — phone/name/email OR ingested + snapshot; `buildCallLeadSearchFilter` exported
- `src/services/search/callLeadSearch.service.test.ts` — new; OR + snapshot phone
- `docs/call-lead-contact-provenance/issues/CLCP-05.md` — §10 boxes
- `docs/call-lead-contact-provenance/PROGRESS.md` — close ledger
- this report

Admin:

- `components/operational/form-lead-contacts.tsx` — `liveTitle`; `CallLeadContactsSection`
- `components/operational/operational-configs.ts` — Call `granot_contact` column
- `components/operational/operational-detail-panel.tsx` — Call Contact tab uses Called + Granot cards
- `components/intakes/intake-known-contacts.tsx` — CallLead chip + Called cards
- `components/intakes/intake-copy.ts` — Call cycle line (no “Form submitted” on Call)
- `components/granot-lifecycle/candidate-lead-facts.tsx` — Call uses the same cards
- `components/bookings/booking-stored-lead-section.tsx` — attached Call shows Called / Granot
- `components/bookings/bookings-copy.ts` — Call cycle line
- `tests/form-lead-contacts.test.ts` — inverted Call column omit; Called / Granot cards
- `tests/granot-lifecycle-components.test.ts` — Call Called / Granot
- `tests/booking-stored-lead.test.ts` — attached cards cover Call

## Proof `identity.ts` phone `$or` still omits snapshot

`findCallLeadsByScopedPhone` (`identity.ts` ~273–288) `$or` is only:

- `normalized_phone_number`
- `ingested_contact_snapshot.normalized_phone_number`

No `granot_contact_snapshot` on that query. This issue did not edit `identity.ts`.

## Browser evidence

Coordinator walk 2026-09-04: local Admin at `http://localhost:3000` booted on branch `call-lead-contact-provenance`. Login reached `/login` and submitted seed credentials. Admin `POST /api/auth/login` returned 500 after ~9s (`Unable to sign in.`) — Admin Mongo/Atlas did not complete authenticate. Did not retry. Chip + Contact cards remain proven by Admin component tests (`form-lead-contacts.test.ts`, `granot-lifecycle-components.test.ts`, 50 pass). Live list/detail walk is still blocked on Admin session.

## Note for CLCP-04

Rewrite `lead-browse.md`, `admin-search.md`, `call-lead-search.md`, and `projections.md` so Call desk `q` is any-known-contact (same lists as Form). BILA §2 “Call Lead / Granot-born Form Lead. Live fields already are the enrichment” is false after this pack; automatic suggestion still uses identity (Job, else operational phone). Admin `CONTEXT.md` pointer still says the pack is not shipped — flip it when knowledge ships. Invoke docs-keeper from CLCP-04.

## Test command output

```text
pnpm exec tsx --test src/services/granotLifecycle/connectLeadCandidates.test.ts
ℹ tests 4
ℹ pass 4
ℹ fail 0
ℹ skipped 0

pnpm exec tsx --test src/services/granotLifecycle/projections.candidates.test.ts
ℹ tests 10
ℹ pass 10
ℹ fail 0
ℹ skipped 0

pnpm exec tsx --test src/services/search/callLeadSearch.service.test.ts src/services/search/callLeadBrowse.service.test.ts
ℹ tests 6
ℹ pass 6
ℹ fail 0
ℹ skipped 0

VANTAGE_TEST_RUNNER=true pnpm exec tsx --test src/services/admin/admin.service.test.ts
ℹ tests 27
ℹ pass 27
ℹ fail 0
ℹ skipped 0

pnpm typecheck
tsc --noEmit
exit_code: 0
```

Admin:

```text
cd vantage-admin
pnpm exec tsx --test tests/form-lead-contacts.test.ts tests/granot-lifecycle-components.test.ts tests/booking-stored-lead.test.ts
ℹ tests 50
ℹ pass 50
ℹ fail 0
ℹ skipped 0

pnpm typecheck
tsc --noEmit
exit_code: 0
```

`admin.service.test.ts` uses `VANTAGE_TEST_RUNNER=true` (catalog fence). No required test failed or was skipped.

## Acceptance criteria evidence (issue §10)

| Box | Evidence |
| --- | --- |
| Call intake / Connect `q` hits snapshot phone (and name/email) | Inverted Connect + projections Call `q` tests; shared `CALL_LEAD_CONTACT_*_PATHS` |
| Call items may carry `known_contacts.granot`; headline is Called | Connect + case-candidate mapping; `contact.name` / `form_submitted.name` stay live Called |
| Admin browse + typeahead Call `q` / phone hit the snapshot | `admin call lead browse q and phone include snapshot contact paths`; inverted typeahead Call assertion |
| Extension `GET /call-leads` `q` / phone hit the snapshot | `callLeadBrowse.service.test.ts` |
| `POST /call-leads/search` phone hits the snapshot | `callLeadSearch.service.test.ts`; OR kept; no scoring |
| Admin `/call-leads` Granot chip; Contact tab two cards | `form-lead-contacts.test.ts` Call section + inverted `callLeadColumns`; live walk blocked (Admin login 500) |
| Identity still does not query Call snapshot | Grep of `findCallLeadsByScopedPhone` above |
| No auto-attach on snapshot-phone-only | BILA-02 / identity untouched |
| Focused tests pass | Commands above |
| Browser walk | Attempted: local Admin `/login` 500 after seed sign-in (Mongo). UI proven by component tests |

## What this issue did not do

CLCP-04 knowledge rewrites. Snapshot phone on `identity.ts` / `findCallLeadsByScopedPhone`. Auto-attach on snapshot-phone-only. CSV / preview (CLCP-03). Flags / `sourcePolicy.ts` / `.env`. Knowledge Service bodies. Admin `CONTEXT.md` pointer rewrite.
