# BILA-01 — Intake any-known-contact search and Form submitted vs Granot display

> **Contract maturity: implementation-ready.** Session 1. Make booking-intake
> customer search find a WordPress Form Lead by any known contact, and show
> Form submitted vs Granot so the website-form → Granot-contact cycle is
> obvious. **No Confirm-without-Lead. No Connect command.**

## 1. Authority and required reading

- **Pack specification:** [`../booking-intake-lead-attachment-specification.md`](../booking-intake-lead-attachment-specification.md)
  — §1, §2, §4, §9.1, §9.4 (intake browser steps 1–4), §12.1. Wins on
  search paths, DTO, and Owner display.
- **Parent (shipped):** [`../../form-lead-contact-snapshots-display-and-search-specification.md`](../../form-lead-contact-snapshots-display-and-search-specification.md)
  — snapshot storage and `FORM_LEAD_CONTACT_*_PATHS`. Do not re-decide writes.
- **Pack rules:** [`../README.md`](../README.md), [`../AGENT-PROTOCOL.md`](../AGENT-PROTOCOL.md)
- **Glossary:** workspace-root `CONTEXT.md`
- **Patterns to reuse:** `leadBrowseShared.ts` path lists;
  `vantage-admin/components/operational/form-lead-contacts.tsx`

## 2. Objective

Booking intake **Find the right customer** finds the same WordPress Form
Lead that `/form-leads` already finds, and the matched customer plus every
search row show Form submitted beside Granot. When Granot later changed
the contact, **Changed in Granot** and the cycle sentence make that
obvious. Headline stays Form submitted.

## 3. Repository, branch, and prerequisites

- **Repositories:** `vantage-main-server` then `vantage-admin`.
- **Branch:** current Granot lifecycle branch, or `booking-intake-lead-attachment`
  if that is how this desk is isolated. See the protocol.
- **Prerequisites:** none. This is the only startable issue.
- Ordinary checks use redacted synthetic data.
- No commit, push, deploy, production flag change, or live payload read.

## 4. Current-state evidence to verify

Observed 2026-08-28; **reverify at implementation**.

- `browseCandidateLeadViews` in `src/services/granotLifecycle/projections.ts`
  matches live `name` / `first_name` / `last_name` / `email` / `phone_number`
  plus `job_no` / `ref_no` only.
- `CANDIDATE_LEAD_PROJECTION` omits `ingested_contact_snapshot` and
  `granot_contact_snapshot`.
- `FORM_LEAD_CONTACT_*_PATHS` already exist in
  `src/services/search/leadBrowseShared.ts` and are used by Admin Form
  Leads browse/typeahead.
- `identity.ts` already ORs snapshots. Do not change it.
- `MatchedLeadPanel` and `CandidateLeadFacts` print live `contact` only.
- `form-lead-contacts.tsx` already owns the chip + two-card rules for
  `/form-leads`.
- `GranotLifecycleCandidateItem` in `vantage-admin/lib/api/granotLifecycle.ts`
  has no `known_contacts`.

## 5. Locked decisions and invariants at risk

- Reuse the shared path lists. Do not copy the arrays into `projections.ts`.
- `contact` stays live headline. `known_contacts.form_submitted` is live
  fields, not `ingested_contact_snapshot`.
- `known_contacts.granot` is present only when the snapshot exists. Use
  stored `differs_from_ingested`. Do not recompute. Do not send
  `observation_id`.
- Headline / `customer_label` stay Form submitted. Never label a row with
  the Granot name.
- Call Lead rows: no Granot card, no chip, no snapshot paths on `q`.
- One helper for chip + cards. Intake copy stays in `intake-copy.ts`.
- Do not add a `contact_changed_in_granot` query key.
- Ranked identity pins (no `q`) unchanged. Explicit `q` still pins nothing.

## 6. Deliverables and exact contract

### 6.1 Server

1. Select snapshots on Form candidate reads (browse and ranked load).
2. Expand Form `q` using the three shared path lists. Keep `job_no` and
   `ref_no`. Call `q` stays live-only.
3. Add `known_contacts` to the candidate DTO as specified in pack spec §4.2.

### 6.2 Admin

1. Extract or reuse the Form Leads chip/cards helper so intake can render
   `known_contacts` without forking chip rules.
2. `MatchedLeadPanel`: cycle line, chip, two cards. Headline stays Form
   submitted. Folded “everything on this lead” reuses the same cards.
3. `LeadCandidateResults` / `CandidateLeadFacts`: same chip + compact cards
   on each Form row.
4. Search hint in `intake-copy.ts` may say the Owner can search the website
   contact or the later Granot contact.
5. Cycle line and “Granot later changed this contact.” live in
   `intake-copy.ts`.

## 7. Out of scope

- Optional Lead on Confirm, `pickBestCandidate` medium rule, Connect
  command, Bookings-tab UI.
- Scored Form Lead Search, `identity.ts`, Granot writes.
- Admin `/form-leads` behavior (already shipped).
- Call Lead Granot chip, cancellation intake, `/bookings/reconciliation`.
- New Mongo indexes.

## 8. Tests

Server and Admin cases in pack spec §9.1. Do not add scored
`searchFormLeads` cases.

## 9. Knowledge updates after this issue ships

Pointer-only until BILA-02/03 land:

- `docs/knowledge/granot-lifecycle/projections.md` — Form candidate `q`
  hits snapshot paths; DTO carries `known_contacts`.
- `vantage-admin/CONTEXT.md` — intake search/display of Form submitted vs
  Granot is no longer “do not implement.”

## 10. Acceptance criteria

- [x] Form `q` for a Granot-only name / ingested-only email / typed phone
      hits the snapshot paths. Job number and reference still hit. Call `q`
      still omits `granot_contact_snapshot`.
- [x] Empty `q` still pins ranked identity. Explicit `q` still pins nothing.
- [x] Form item with a snapshot returns `known_contacts.granot`. Live
      `contact.name` stays Form submitted when the Granot name differs.
      DTO omits `observation_id`. Item without a snapshot omits `granot`.
- [x] Duplicate and Bad Form Leads still excluded.
- [x] Hero and search rows: no snapshot → Form submitted only; matching
      snapshot → **Granot** + both cards + cycle line; differs →
      **Changed in Granot** + “Granot later changed this contact.”
- [x] Call Lead fixture has no Granot card. Markup has no forbidden field
      names. Strings come from `intake-copy.ts`.
- [x] Browser steps 1–4 in pack spec §9.4 pass on the live local Admin
      (this desk: http://localhost:3000; API on http://localhost:3001).

## 11. Commands

```bash
pnpm test
pnpm typecheck
cd ../vantage-admin && pnpm test && pnpm typecheck
```

Plus the browser walk in §10. Paste output in the completion report.

## 12. Risks

- Copying path lists into `projections.ts` so they drift from Form Leads.
- Rendering raw snapshot keys in the UI.
- Replacing the headline with the Granot name so a Granot-only search hit
  looks like a different person.

## 13. Rollback

Revert the candidate DTO and the intake cards. `/form-leads` helper must
remain intact. No production flag is involved.

## 14. Handoff list for the completion report

- Filter + DTO evidence (captured `$or` / fixture responses, redacted).
- Which helper intake now shares with `/form-leads`.
- Browser notes for steps 1–4.
- What you did not do (especially BILA-02/03).
- Any §4 drift you corrected.
