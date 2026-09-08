---
type: Completion report
title: BILA-01 — Intake any-known-contact search and Form submitted vs Granot display
status: complete
closed: 2026-08-28
---

# BILA-01 completion

Repos: `vantage-main-server`, `vantage-admin`. Both desks were on `main`. No extra feature branch (trees already had unrelated pack/docs edits).

## Filter + DTO evidence (redacted)

Captured Form `$or` (synthetic `q`, via `formLeadCandidateSearchOr` and a stubbed `listGranotLifecycleCaseCandidates` Form find):

- Granot-only name includes `granot_contact_snapshot.name`
- Ingested-only email includes `ingested_contact_snapshot.email`
- Typed phone substring hits live `phone_number` / `normalized_phone_number` plus ingested and Granot phone paths. No digit-flex regex.
- `job_no` and `ref_no` still present
- Form filter still has `duplicate: { $ne: true }` and `bad_lead: null`
- Call `$or` omits `granot_contact_snapshot` and `ingested_contact_snapshot`
- Form `.select` includes both snapshots; Call `.select` does not

Fixture DTO (synthetic names only):

- Live `contact.name` / `customer_label` = Form submitted (`Form Submitted`)
- `known_contacts.granot.name` = `Granot Later`, `differs_from_ingested: true`, `captured_at` ISO
- JSON of `known_contacts` does not contain `observation_id` or `evidence_status`
- Item without a snapshot omits `known_contacts.granot`

Pin contract (`assembleCandidateEntries`): empty `q` pins ranked identity first and dedupes browse; explicit `q` or a cursor pins nothing.

Live Owner proxy (session, redacted): Form `q` for a Granot-only email that is not on live contact returned **1** item with `known_contacts.granot` and `differs_from_ingested: true`. The same Lead’s Form-submitted phone `q` returned that same **1** item. Call `lead_model` page items had no `known_contacts.granot`.

## Shared helper

`vantage-admin/components/operational/form-lead-contacts.tsx` now exports:

- `granotContactChipLabel` / `GranotContactStatusChip` (intake uses `omitEmpty` so a missing snapshot does not print `—` on the hero)
- `FormSubmittedGranotCards` (chip rules stay here; `/form-leads` still uses First/Last + “No Granot contact yet”)

Intake wires those through `components/intakes/intake-known-contacts.tsx`. Cycle and search sentences stay in `intake-copy.ts`.

## Browser notes (steps 1–4)

This desk’s Owner Admin is **http://localhost:3000** (API on **http://localhost:3001**). `LOCAL-ADMIN.md` is restamped to match.

1. Opened a waiting Booking intake whose WordPress Form Lead has a Granot snapshot that differs. Hero: Form submitted headline, **Changed in Granot**, both cards, cycle line, and “Granot later changed this contact.” Headline matched the Form submitted card, not the Granot card.
2. Opened **Find the right customer**. Search label/placeholder come from `intake-copy.ts` (website contact or later Granot contact). A Granot-only email `q` against the live candidates GET returned that one Form Lead with **Changed in Granot**. Empty-`q` browse rows already showed the same Form submitted title + chip + cards + cycle line.
3. Form submitted phone `q` returned the same one Form Lead.
4. A Call Lead intake hero has Strong match and no Form submitted card, no Granot chip, no cycle line. Call candidate GET items have no `known_contacts.granot`.

No live names, phones, or emails are repeated here.

## What this issue did not do

- BILA-02: Confirm without a required Lead, `pickBestCandidate` medium rule, Leadless follow-through
- BILA-03: Connect command, `/bookings` Connect UI
- `identity.ts`, scored `POST /form-leads/search`, Granot writes
- Admin `/form-leads` behavior (helper extracted; table/detail rules unchanged)
- Call Lead Granot chip, cancellation intake, `/bookings/reconciliation`
- New Mongo indexes, commits, push, deploy, production flags

## §4 drift corrected

- `CANDIDATE_LEAD_PROJECTION` did omit snapshots; `CandidateLeadView` already declared the snapshot fields. Projection now selects them on Form reads only.
- Local Admin for this desk is on **3000**; the pack note still said 3001 (that port is the local API).

## Commands

| Command | Result |
| --- | --- |
| `vantage-main-server` `pnpm typecheck` | pass |
| `projections.test.ts` + `projections.candidates.test.ts` | 21 pass |
| `vantage-main-server` `pnpm test` | 1696 pass, 0 fail, 87 skipped (pre-existing suite skips), `duration_ms` 306282 |
| `vantage-admin` `pnpm test` | 340 pass |
| `vantage-admin` `pnpm typecheck` | pass |

Full server suite footer:

```text
ℹ tests 1783
ℹ suites 10
ℹ pass 1696
ℹ fail 0
ℹ cancelled 0
ℹ skipped 87
ℹ todo 0
ℹ duration_ms 306282.7106
```

Knowledge docs restamped by docs-keeper after ship. BILA-02 is the next startable issue.
