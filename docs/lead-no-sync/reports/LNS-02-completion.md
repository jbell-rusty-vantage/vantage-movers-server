---
type: Completion report
title: LNS-02 — Owner mark / unmark via updateSourceOwnedLead
status: complete
closed: 2026-09-06
---

# LNS-02 completion

Repos: `vantage-main-server` then `vantage-admin`. Branch `lead-no-sync` on both.
No commit, no push, no deploy, no live payload.

## EntityChange + outbox evidence for both transitions

Command name stays `updateSourceOwnedLead`. `runExistingUpdateSourceOwnedLead`
parses the patch through `updateFormLeadSchema` / `updateCallLeadSchema`,
applies via `correctFormLead` / `correctCallLead`, then
`collectDocumentFieldChanges` on `FORM_LEAD_CHANGE_PATHS` /
`CALL_LEAD_CHANGE_PATHS`. When `fields.length > 0` it persists EntityChange
and sets pending `source_lead` with `form_lead.update` or `call_lead.update`.

| Transition | Path | EntityChange | Outbox |
| --- | --- | --- | --- |
| `false` / absent → `true` | `no_sync` | collected (`before: false`, `after: true`) | pending `source_lead` update |
| `true` → `false` | `no_sync` | collected (`before: true`, `after: false`) | pending `source_lead` update |
| same value | — | `[]` | no pending job |

Proof:

- `FORM and CALL CHANGE_PATHS include no_sync so a flip is not a silent no-op`
- `collectDocumentFieldChanges reports no_sync when it flips and no-ops when unchanged`
- `runExistingUpdateSourceOwnedLead still uses updateSourceOwnedLead and pending source_lead update`
- `create and update Form and Call schemas accept optional no_sync`
- `refuseIllegalCorrections does not mention no_sync`
- `refuseToMarkABookedCallAsDuplicate does not mention no_sync`
- `correctFormLead does not throw ConflictError when marking no_sync on booked, duplicate, or bad`
- `correctCallLead does not throw ConflictError when marking no_sync on booked or duplicate`

`no_sync` is also on EntityChange `STORED_PATHS` so the boolean is stored like
`duplicate` / `bad_lead`. Planner delete-not-upsert after mark true is the
existing LNS-01 suite (still passing; not rewritten).

Replica `entityChange.integration.test.ts` stays opt-in. The gate does not
depend on it.

## Admin control owner

`HideFromMasterLeadsControl` in
`vantage-admin/components/operational/hide-from-master-leads-control.tsx`.

Mounted only from `WorkflowActions` in `operational-actions.tsx` for
`form-leads` **and** `call-leads` (Call Lead has no Bad Lead control; it
still gets this one). Compact row cluster in `operational-columns.tsx`
still has only `MarkBadLeadControl`. Production `editFields` omit the flag.

PATCH helper: `updateLeadNoSync` → existing `updateProductionRecord` with
`{ no_sync: true | false }`. Confirm dialog is the same family as
`DeleteConfirmationDialog` (`role="dialog"`, overlay, confirm / cancel).
Cancel only closes. Success / failure use `FeedbackMessage` in that
Actions tab. No post-mark sheet scan.

Copy is only in `OPERATIONAL_COPY.hideFromMasterLeads`. Markup / JSX
string literals do not print `no_sync` or Hide from Sheets.

## What this issue did not do

- LNS-03: desk filter / column, Manual checkbox, contains Owner copy
- LNS-04: knowledge bodies (pointer-only: PATCH path is
  `updateSourceOwnedLead` + `no_sync`)
- New domain command
- Post-mark full-tab sheet scan
- Row Actions cluster control
- Production `editFields`
- Extra fences on booked / cancelled / Duplicate / Bad
- Commit, push, deploy, production flag, live payload
- Browser walk (spec §11). Local Admin was not running; Actions-tab
  proof is source-scan. §11 steps 1–3 and 6 stay LNS-03.

## §4 drift corrected

None. Reverify matched the issue: update Zod still rejected `no_sync`;
both CHANGE_PATHS omitted it; command name was already
`updateSourceOwnedLead`; empty field diff already no-op’d;
`MarkBadLeadControl` still Form-only; edit form already used
`updateProductionRecord`.

Same-change necessity (not §4 drift): `STORED_PATHS` now includes
`no_sync` so EntityChange stores the boolean the same way as
`duplicate` / `bad_lead`.

## Commands

| Command | Result |
| --- | --- |
| `vantage-main-server` `pnpm typecheck` | pass |
| `vantage-main-server` `pnpm test` | 2070 pass, 0 fail, 108 skipped (pre-existing replica / opt-in suite skips), `duration_ms` 311977 |
| `vantage-admin` `pnpm typecheck` | pass |
| `vantage-admin` `pnpm test` | 513 pass, 0 fail, 0 skipped, `duration_ms` 39757 |

No new test was skipped or failed. Suite grew by 7 server tests vs LNS-01
(2171 → 2178 total; 2063 → 2070 pass). Admin added 8 new tests.

Full server suite footer:

```text
ℹ tests 2178
ℹ suites 12
ℹ pass 2070
ℹ fail 0
ℹ cancelled 0
ℹ skipped 108
ℹ todo 0
ℹ duration_ms 311977.0754
```

Full Admin suite footer:

```text
ℹ tests 513
ℹ suites 0
ℹ pass 513
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 39756.5455
```

LNS-03 stays `ready`. LNS-04 stays `blocked` on LNS-03.
