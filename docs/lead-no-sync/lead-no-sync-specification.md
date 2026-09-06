---
type: Specification
title: No-Sync Lead — keep a Lead off Master Leads
description: >-
  Persist no_sync on Form Leads and Call Leads. Default it on Vantage Admin
  Manual create. Skip and delete only Master Leads Forms and Calls. Leave
  Duplicate and Bad tabs alone. Booking Chain still writes Booked Deals and
  must not upsert Forms or Calls. Filter and Find it on the desks. Owner
  contains reports Not expected, not Missing.
tags:
  - form-lead
  - call-lead
  - sheet-sync
  - owner-dashboard
  - admin-dashboard
status: proposed-final
stale_after: 2026-12-06
owners: [team:main-server, team:vantage-admin]
applies_to:
  - src/models/FormLead.ts
  - src/models/CallLead.ts
  - src/services/leads/leadIngestionProvenance.ts
  - src/services/leads/formLead.service.ts
  - src/services/leads/callLead.service.ts
  - src/services/sheetSync/drainer/jobPlanner.ts
  - src/services/sheetSync/sheetSyncSourceLookup.ts
  - src/services/googleSheets/expectedSheetTabs.ts
  - src/services/googleSheets/sheetContains.ts
  - src/services/admin/adminBrowse.service.ts
  - src/validation/v1/admin.validation.ts
  - src/validation/v1/leads.validation.ts
  - ../vantage-admin/components/manual/create-lead-form.tsx
  - ../vantage-admin/components/operational/operational-configs.ts
  - ../vantage-admin/components/operational/operational-actions.tsx
  - ../vantage-admin/components/operational/operational-copy.ts
  - ../vantage-admin/components/operational/operational-filter-groups.ts
sources:
  - id: glossary
    resource: ../../../CONTEXT.md
    title: Platform glossary
  - id: sheet-sync
    resource: ../knowledge/services/sheet-sync.md
    title: Sheet Sync
  - id: google-sheets
    resource: ../knowledge/services/google-sheets.md
    title: Google Sheets facade
---

# No-Sync Lead — keep a Lead off Master Leads

> **Contract maturity: implementation-ready.** Product rules in this file
> win. File citations are evidence; reverify line numbers at
> implementation. Agents work from [`README.md`](README.md) →
> [`AGENT-PROTOCOL.md`](AGENT-PROTOCOL.md) → the matching issue. Do not
> start coding from chat notes.

**Prepared:** 2026-09-06
**Repos:** `vantage-main-server` (field, planner, contains, browse, create
default). `vantage-admin` (Manual checkbox, desk filter/column, mark
control, contains copy).
**Owner-facing labels:** Hide from Master Leads, Show on Master
Leads, Hidden from Master Leads, Not expected
**Canonical facts:** [No-Sync Lead](../../../CONTEXT.md),
[Lead](../../../CONTEXT.md),
[Form Lead](../../../CONTEXT.md),
[Call Lead](../../../CONTEXT.md),
[Unmatched Call Lead](../../../CONTEXT.md),
[Sheet Sync](../../../CONTEXT.md),
[Booking Chain](../../../CONTEXT.md),
[Master Sheets](../../../CONTEXT.md),
[Duplicate Lead](../../../CONTEXT.md),
[Bad Lead](../../../CONTEXT.md),
[Ingestion Origin](../../../CONTEXT.md)

---

## 0. Authority

Read in this order. Stop and report contradictions; do not silently merge.

| Order | Authority | Wins on |
| --- | --- | --- |
| 1 | **This file** | `no_sync`, Manual default, mark + delete, contains, desk filter |
| 2 | Current `jobPlanner.ts` / `expectedSheetTabs.ts` / `sheetContains.ts` | Existing unmatched skip, Bad/Duplicate tab routing this pack does not reopen |
| 3 | Workspace-root [`CONTEXT.md`](../../../CONTEXT.md) | Words. Do not invent synonyms |
| 4 | This pack's issues | Sequencing and scope only |

Where an issue and this file disagree, this file wins and the issue
author fixes the issue in the same change.

---

## 1. Objective

This is a carved-out Owner path: keep Lead → Booking provenance in
Mongo, and let the Owner choose which ordinary Leads appear on
Master Leads **Forms** and **Calls** — the two main tabs he bills
from. It is not a new Lead kind. Ingestion Origin, `lead_ref`,
Booking attach, CRM Posting, and Granot identity stay. Master Booked
stays.

Expected use is almost entirely Vantage Admin Manual create, plus
the rare later mark when the Owner wants a living Lead off those
two tabs. Both writes use the same field and the same planner.

1. Persist `no_sync` on every Form Lead and Call Lead.
2. Default it **on** for Vantage Admin Manual create so an Owner-typed
   match-anchor Lead stays in Mongo and off Forms / Calls.
3. Let the Owner mark an existing **ordinary** Lead no-sync. That
   write must find and delete the Forms or Calls row for that Lead
   ID, then refuse later Forms/Calls upserts. Duplicate and Bad
   tabs are not in this write.
4. Let the Owner clear the mark. That is the only revival. The next
   Sheet Sync writes the Lead onto the tab its current flags require.
5. Filter **Hidden from Master Leads** and Find the Lead on
   `/form-leads` and `/call-leads`. Hide / show only from the Side
   Panel Actions tab, with confirm.
6. Owner contains must say **Not expected**, never **Missing**, for a
   No-Sync Lead. Contains does not read tabs for this skip.

Master Booked is unchanged. A Booking attached to a No-Sync Lead still
upserts Booked Deals and still writes Mongo Lead ID. Booking Chain
must **not** upsert Forms or Calls for that Lead.

---

## 2. Language

| Say | Do not say |
| --- | --- |
| [No-Sync Lead](../../../CONTEXT.md) | hidden lead, silent lead, unmatched (for this flag) |
| `no_sync` | `sheet_sync_excluded`, `exclude_from_sheets` (code field is `no_sync`) |
| Hide from Master Leads | Hide from Sheets, skip sheets, Off Master Leads (action / Manual) |
| Show on Master Leads | unhide, resync, clear no_sync (action) |
| Hidden from Master Leads | no_sync, Off Master Leads (filter / column / chip) |
| [Unmatched Call Lead](../../../CONTEXT.md) | No-Sync Lead (booking stub only) |
| [Sheet Sync](../../../CONTEXT.md) | Google upsert (unqualified) |
| [Booking Chain](../../../CONTEXT.md) | booking_chain (Owner UI) |

Do not say **Hide from Sheets**. Master Booked still writes. The
Owner action hides Forms and Calls only.

“Hidden lead” is not a Lead kind. **Hidden from Master Leads** is
the desk state label for `no_sync === true`.

`no_sync` is a stored boolean on the Lead. A Lead with `no_sync === true`
**is** a No-Sync Lead.

---

## 3. Current-state evidence (repository, 2026-09-06)

Reverify at implementation. This section is the examined baseline.

### 3.1 No field exists

- `FormLead` / `CallLead` have no `no_sync`.
- Create and update Zod `.strict()` reject unknown keys.
- `FORM_LEAD_CHANGE_PATHS` / `CALL_LEAD_CHANGE_PATHS` omit it.
- Browse Zod has no `no_sync` query.
- Manual create does not send `ingestion_origin`. Server stamps
  `vantage_admin` for Admin `POST /api/v1/form-leads` and
  `POST /api/v1/call-leads`.

### 3.2 The only Master Leads skip today is Unmatched Call Lead

| Gate | File | Effect |
| --- | --- | --- |
| Queued | `planSourceLead` in `jobPlanner.ts` | `created_on_unmatched === true` → `return []` |
| Legacy | `syncSourceLead` in `sheetSyncSourceLookup.ts` | same, return before facade |
| Contains | `planExpectedSheetTabs` | `{ expected: [], skipReason: "created_on_unmatched" }` → verdict `not_expected` |

`persistSheetSyncIntent` does **not** gate. An empty plan marks the job
`synced` and **does not delete** leftover rows.

Booking Chain still writes Booked Deals, then calls `planSourceLead`.
`bookedLeadToRow` always emits Mongo Lead ID from `booking.lead_ref`.

### 3.3 Examined: Bad Lead and Duplicate Lead tab moves

**The Owner assumption is only half true. Lock the real order.**

#### Bad Lead (Form only)

Sheet Sync does **not** remove the Forms (or Duplicates) row.

`bad_lead` set → **dual upsert**: current primary tab **plus** Master
`Bad Leads`. Same `formLeadToRow` on both.

| Duplicate? | Bad? | Planned writes (queued) |
| --- | --- | --- |
| no | no | upsert `Forms` |
| yes | no | upsert `Duplicates` |
| either | yes | upsert primary, **then** upsert `Bad Leads` |

Clearing `bad_lead` deletes Master `Bad Leads` only when `sheet_sync[]`
already has `master_bad_leads` (queued). Legacy always attempts that
delete. The primary row stays.

There is no “delete Forms first, then write Bad Leads.”

#### Duplicate Lead — Call vs Form differ

**Call Lead** (same plan, two tabs):

1. **Upsert** current tab (`Calls` or `Duplicate Calls`)
2. **Delete** the stale opposite tab, even when `sheet_sync[]` is empty
   (Mongo ID lookup)

Batch writer groups by tab in first-seen order, so the new tab upserts
before the stale tab deletes.

**Form Lead:**

- **Upsert** `Duplicates` only.
- **Does not** delete a leftover `Forms` row.
- Owner contains treats a leftover Forms row as **Wrong tab**.

This pack **does not** change any of the above. It does not delete
Bad Leads, Duplicates, or Duplicate Calls rows. It does not skip
those upserts. Whether a Bad Lead or Duplicate Lead should leave
those tabs is undecided and **out of scope**.

### 3.4 Owner contains

`POST /api/v1/admin/sheet-sync/contains`. Live read. Cap 25. Does not
trust `sheet_sync[]`.

Verdicts: `found`, `missing`, `wrong_tab`, `not_expected`, `not_found`.

`skipReason` today is only `"created_on_unmatched"`. Without a skip,
a Lead that is absent from its expected tab is **Missing**.

If this pack added the planner skip and left contains unchanged, the
Owner would see Missing for a correct No-Sync Lead. That is a product
bug. Contains must ship with the skip.

### 3.5 Desk filters

`/form-leads` and `/call-leads` use `GET /api/v1/admin/{resource}`.
Tri-state Any / Yes / No already exists for `booked` and `cancelled`
(`yesNoOptions` + omit = all). Copy that for `no_sync`.

`duplicate` is a page split (`fixedListFilters`), not a desk filter.
`bad_lead`, `quoted`, and `created_on_unmatched` are not desk filters.

Find `q` already matches a 24-hex Mongo ID via `addQClause`. Contains
uses list checkboxes of those ids. No new search endpoint.

### 3.6 Marking other flags today

Owner PATCH is `updateSourceOwnedLead` on
`PATCH /api/v1/form-leads/:id` and `PATCH /api/v1/call-leads/:id`.
Form `bad_lead` uses `MarkBadLeadControl` → the same command.
Reuse that command. Do not invent a second command.

---

## 4. Locked decisions

Owner lock 2026-09-06. Product rules below win over chat notes.

1. **Persisted field name is `no_sync`.** Boolean. Missing / `false` /
   `null` means the Lead is syncable. Only `true` excludes.
2. **One skip owner.** A shared predicate used by `planSourceLead` and
   `syncSourceLead`. Booking Chain, Cancellation Chain, create, Granot
   synchronize, enrichment, and PATCH all honor it because they already
   call those two functions for the source Lead.
3. **Do not gate only `persistSheetSyncIntent`.** Booking Chain would
   still plan the Lead and could upsert Forms or Calls. That is a
   ship-blocker.
4. **`no_sync` applies only to ordinary Forms and Calls.** Those are
   the only Master Leads tabs this pack may skip or delete. Ordinary
   means `duplicate !== true` and Form `bad_lead` is unset. A Duplicate
   Lead or Bad Lead keeps today's sheet routing even when `no_sync`
   is true. Do not skip or delete Duplicates, Duplicate Calls, or
   Bad Leads in this pack. A later Duplicate or Bad flip is a
   different policy and may put a row on those exception tabs.
5. **Marking `no_sync: true` deletes only the normal tab.** Empty skip
   is not enough. For an ordinary Form Lead, find and delete `Forms`.
   For an ordinary Call Lead, find and delete `Calls`. Missing row is
   a no-op. Never delete Duplicates, Duplicate Calls, or Bad Leads
   here.
6. **Clearing `no_sync` on an ordinary Lead upserts** `Forms` or
   `Calls`. That Owner unmark is the **only** revival. No global
   kill-switch. Enrichment, Granot synchronize, and booking attach
   must not put the Lead back on Forms or Calls while the flag is
   true. If the Lead is Duplicate or Bad, today's routing runs
   unchanged (this pack does not invent a new clear path for those).
   After unmark, contains Missing-until-drain then Found is
   acceptable.
7. **Only two Owner write paths.** (a) Manual / Vantage Admin create
   defaults `no_sync: true` on the server for both Form and Call; the
   Owner may send `false` to opt into Forms / Calls. (b) Owner PATCH
   mark / unmark via `updateSourceOwnedLead`. Other Ingestion Origins
   always persist `false` and ignore a client `true`.
8. **Do not reuse `created_on_unmatched`.** Unmatched stays the booking
   stub. No-Sync Lead is an Owner (or Admin-create) reporting choice.
9. **Unmatched skip stays delete-free.** Do not change that empty-plan
   behavior.
10. **Master Booked is not excluded.** Booking Chain / booked-only jobs
    still write Booked Deals. Mongo Lead ID stays on that row.
    **Booking Chain must not upsert Forms or Calls** for an ordinary
    No-Sync Lead. Matching or attaching that Lead is not a reason to
    update those tabs. There is no Booking Chain special case — the
    same predicate in `planSourceLead` / `syncSourceLead` is the
    whole rule. Agents must not add a “booking happened, refresh the
    lead row” write.
11. **Contains `skipReason: "no_sync"` → `not_expected` only for an
    ordinary No-Sync Lead.** No tab reads. That Not expected verdict
    is the desk proof. This pack does **not** add a leftover-row
    read (row still present on Forms/Calls after skip). A Duplicate
    or Bad Lead with `no_sync` uses today's expected-tab map (not
    this skip). If a leftover Forms/Calls row still exists (delete
    not drained yet), a later contains after drain must still be
    Not expected for the ordinary case. Leftover-after-drain is a
    drain bug, not a Missing verdict.
12. **CPL and lead-cost analytics are unchanged.** Controlling which
    ordinary Leads appear on Forms / Calls is how the Owner controls
    billing display. A No-Sync Lead may still store CPL. A later
    pack may exclude it from cost. Not this pack.
13. **CRM Posting, Granot synchronize, identity, and booking attach
    are unchanged.** `no_sync` is a Sheet Sync projection flag on
    Forms and Calls. The Mongo Lead, its Ingestion Origin, and its
    Booking relationship stay.
14. **Owner-facing copy lives in existing copy modules.** Never print
    `no_sync` or `created_on_unmatched` in JSX. Locked strings are
    in §2 and §7.2.
15. **Admin proof is the lead desks.** `/form-leads` and `/call-leads`
    Find `q` (Mongo ID), **Hidden from Master Leads** Status filter /
    column, Manual **Hide from Master Leads** checkbox, Actions-tab
    hide / show with confirm, and contains. No new search endpoint.
    No global-search filter or badge in this pack. The Booked Deals
    contains check in §11.6 is the Owner-visible proof that Master
    Booked is a different workbook.
16. **Mark / unmark lives only on the Side Panel Actions tab.** Not
    on the row Actions cluster, Summary, or Production record form.
    Do not add `no_sync` to `formLeadEditFields` / `callLeadEditFields`.
    Both hide and show require an Owner confirm. Success or failure
    is a message in that tab. Do not add a post-mark full-tab sheet
    scan or date-range absence proof (§7.3).

---

## 5. Field, create, and provenance

### 5.1 Storage

On `FormLead` and `CallLead`:

```ts
no_sync: boolean; // default false
```

Mongoose default `false`. Existing documents without the field are
syncable (`!== true`).

Include `no_sync` on public/admin read DTOs so desks and detail can
render the mark.

### 5.2 Create

| Ingestion Origin | Persisted `no_sync` |
| --- | --- |
| `vantage_admin` | `input.no_sync ?? true` |
| `wordpress_form`, `ringcentral`, `granot_lead_created`, `best_relocation_sheet`, others | `false` (ignore client `true`) |

Stamp next to `formLeadCreationProvenanceFields` /
`callLeadCreationProvenanceFields` (or immediately after origin is
derived in `writeTheFormLead` / `beginCallLeadIngestion`).

`createFormLeadSchema` / `createCallLeadSchema` may accept optional
`no_sync: booleanInput`. That is the Manual opt-in. Server still
overrides per the table.

`ingestion_origin` stays server-owned.

When create persists `no_sync: true`, **do not** enqueue
`source_lead` / `form_lead.create` or `call_lead.create`. There is
nothing to project.

When create persists `no_sync: false`, today's create intent is
unchanged.

### 5.3 Update

Add `no_sync: booleanInput.optional()` to `updateFormLeadSchema` and
`updateCallLeadSchema`.

Add `no_sync` to `FORM_LEAD_CHANGE_PATHS` and `CALL_LEAD_CHANGE_PATHS`.

Command remains `updateSourceOwnedLead`. Empty diff still no-ops.

No extra fences on the stored flag: a booked, cancelled, Duplicate,
or Bad Lead may be marked or cleared. Booking attach does not depend
on the sheet row. **Sheet projection still ignores `no_sync` while
the Lead is Duplicate or Bad** (§4.4). The flag is stored for later;
this pack does not project those cases.

---

## 6. Sheet Sync planner

### 6.1 Shared predicate

```ts
function isNoSyncLead(lead: { no_sync?: boolean | null }): boolean {
  return lead.no_sync === true;
}

function noSyncAppliesToNormalTabs(lead: {
  no_sync?: boolean | null;
  duplicate?: boolean | null;
  bad_lead?: unknown;
}): boolean {
  if (lead.no_sync !== true) return false;
  if (lead.duplicate === true) return false;
  if (lead.bad_lead) return false;
  return true;
}
```

`bad_lead` is Form-only; a truthy reason excludes the Lead from this
pack's sheet skip. Call Leads have no `bad_lead`.

One module, imported by `jobPlanner.ts`, `sheetSyncSourceLookup.ts`,
and `expectedSheetTabs.ts`. Do not copy the tests.

Evaluate **`noSyncAppliesToNormalTabs`** before writing Forms or Calls.
Evaluate `created_on_unmatched` as today when this predicate is false.

### 6.2 Ordinary No-Sync Lead — skip Forms / Calls upsert

If `noSyncAppliesToNormalTabs(lead)`:

- Do not upsert `Forms` or `Calls`.
- Then run §6.3 (queued) or the legacy delete equivalent.
- **Return.** Do not fall through into new Bad/Duplicate branches —
  an ordinary Lead has none.

If `isNoSyncLead(lead)` but `noSyncAppliesToNormalTabs` is false
(Duplicate or Bad): **run today's planner unchanged.** Do not add a
`no_sync` skip or delete on Duplicates, Duplicate Calls, or Bad Leads.

### 6.3 Immediate delete (queued) — normal tab only

Emit **delete** writes for the normal tab only:

| Model | Tab to search and delete |
| --- | --- |
| Ordinary Form Lead | `Forms` |
| Ordinary Call Lead | `Calls` |

Do **not** delete `Duplicates`, `Duplicate Calls`, `Bad Leads`, or
`Bad Calls`. Do **not** delete Booked Deals or Cancelled Deals.

For each tab:

1. Prefer `sheet_sync[]` `row_number` when that cell still holds this
   Mongo ID (same as today's `upsertRow` / delete helpers).
2. Else find the row by Mongo ID.
3. Missing tab or missing row → no-op.

`WRITE_SOURCE_LEAD_SHEETS === "true"` is not the default. If that flag
is on, also delete the matching source-container **Forms** or **Calls**
tab only. Do not invent a third workbook. Do not delete source
Duplicates / Duplicate Calls / Bad Leads.

A `source_lead` job whose plan is **only** these deletes still
persists cleared / removed `sheet_sync[]` entries the same way other
deletes do. After a successful drain, the Lead should have **no**
Master Leads `sheet_sync[]` rows.

### 6.4 Legacy twin

`syncSourceLead` must delete the same **normal** tab when
`noSyncAppliesToNormalTabs`, then return without
`syncFormLeadToSheets` / `syncCallLeadToSheets`. If the Lead is
Duplicate or Bad, call today's facade unchanged.

### 6.5 Booking Chain and Cancellation Chain

Unchanged structure:

1. Write Booked Deals (and Cancelled Deals on the cancellation chain).
2. `planSourceLead` for the linked Lead.

Step 1 always runs. Mongo Lead ID stays on Booked Deals.

Step 2 honors §6.2–6.3. When the matched Lead is an ordinary
No-Sync Lead, step 2 must **not** upsert Forms or Calls. A Booking
Chain match is not a Forms/Calls update. Gating only
`persistSheetSyncIntent` fails this rule — Booking Chain would still
plan the source Lead. Test §10.1 Booking Chain + ordinary No-Sync
Call is the proof.

### 6.6 Clearing `no_sync`

`no_sync` becomes `false` → enqueue `source_lead` /
`form_lead.update` or `call_lead.update` (already the correction
refresh path). An ordinary Lead upserts `Forms` or `Calls`. A
Duplicate or Bad Lead uses today's routing (unchanged functions).

### 6.7 Unmatched Call Lead

Unchanged: empty plan, no deletes, Booked Deals still writes.

If both flags are true (should not happen on Manual create), `no_sync`
wins and §6.3 deletes run.

---

## 7. Owner mark / unmark

### 7.1 Server

`PATCH` with `{ no_sync: true | false }` through
`updateSourceOwnedLead`.

| Transition | Sheet intent |
| --- | --- |
| `false`/`absent` → `true` | Enqueue `source_lead` update so §6.3 deletes run |
| `true` → `false` | Enqueue `source_lead` update so current tabs upsert |
| no change | Existing empty-diff no-op |

Do not require a separate tombstone. The Lead document stays.

### 7.2 Admin UI — Actions tab only

On `/form-leads` and `/call-leads`, the hide / show control lives
only on the Side Panel **Actions** tab, in the same
`WorkflowActions` cluster as `MarkBadLeadControl`.

Do **not** put it on:

- the table row Actions cluster (`compact` Bad Lead style)
- Summary
- Contact / Message / Source
- the Production record edit form

Owner flow:

1. Find the Lead (desk Find `q` or **Hidden from Master Leads**
   filter).
2. Open the Side Panel → **Actions**.
3. Confirm **Hide from Master Leads** or **Show on Master Leads**.
4. PATCH. Show success or failure in that tab. Do not wait on a
   second full-tab Google read (§7.3).

| Element | Copy |
| --- | --- |
| Action when `no_sync` is not true | **Hide from Master Leads** |
| Action when `no_sync === true` | **Show on Master Leads** |
| Helper | Booked Deals still updates if this lead is booked. |
| Confirm hide title | Hide from Master Leads? |
| Confirm hide body | Hide this lead from the Forms and Calls tabs on Master Leads? The lead stays in the database. A Booking still writes Booked Deals. |
| Confirm hide button | Hide from Master Leads |
| Confirm show title | Show on Master Leads? |
| Confirm show body | Show this lead on the Forms and Calls tabs again? Sheet Sync will write it on the next drain. |
| Confirm show button | Show on Master Leads |
| Confirm cancel | Cancel |
| Success hide | Hidden from Master Leads. Sheet Sync will remove the Forms or Calls row. |
| Success show | This lead will show on Master Leads again after Sheet Sync. |
| Failure | Could not update Master Leads visibility. |

Use a confirm dialog in the same family as
`DeleteConfirmationDialog` (modal, confirm / cancel). Do not PATCH
until the Owner confirms. Confirm both directions.

Strings in `operational-copy.ts`. Do not inline. Never print
`no_sync`.

### 7.3 No extra sheet-scan proof after mark

There is no cheap Google operation that proves a Mongo ID is absent
from Forms or Calls.

- `rowNumberContainsMongoId` is cheap (one row) only when
  `sheet_sync[]` already has that row number. It cannot prove the
  id is nowhere else on the tab.
- `findRowNumberByMongoId` reads the whole tab (`A:ZZ`). The delete
  job already pays that once when the known row is stale or missing.
- Date-range slicing does not help. Rows are keyed by Mongo ID, not
  by a sorted date the Owner can seek.

Do **not** add a post-mark Owner “prove it is gone” sheet query.
Do **not** scan Forms or Calls again from the Actions tab.

The Actions-tab message is PATCH accepted or rejected. The delete
job uses today's known-row GET, then the existing Mongo ID lookup
if needed. Contains stays the policy check: **Not expected**, no
tab reads (§8).

---

## 8. Owner contains

### 8.1 Planner

Extend `SheetContainsSkipReason` with `"no_sync"`.

`SheetContainsRecordFlags` copies `no_sync` from the loaded Lead.

`planExpectedSheetTabs`:

- If `noSyncAppliesToNormalTabs(flags)` →
  `{ expected: [], siblings: [], skipReason: "no_sync" }`
- Else today's unmatched / Duplicate / Bad map (even when
  `no_sync === true` on a Duplicate or Bad Lead)

Ordinary Form and Call both skip. Unmatched remains Call-only and is
only reached when the No-Sync normal-tab skip does not apply.

### 8.2 Check

`runSheetContainsCheck` already maps any `skipReason` to
`not_expected` and **does not read tabs**. Reuse that. Do not add a
sixth verdict. Do not add a leftover-row read for `no_sync`. Not
expected is the desk proof that the Lead is not supposed to be on
Forms or Calls. Actual deletion is proven by the mark → drain →
Not expected, then unmark → drain → Found walk in §11.

### 8.3 Admin copy

When `item.reason === "no_sync"` show:

> This lead is hidden from Master Leads. Sheet Sync does not write
> it to Forms or Calls.

Keep the existing unmatched sentence for `created_on_unmatched`.

After LNS-01, checking a No-Sync Lead on `/form-leads` or
`/call-leads` (Find by Mongo ID → checkbox → Check Google Sheet
contains) must return **Not expected**, not **Missing**.

---

## 9. Desk filter, column, and Find

### 9.1 Browse — Hidden from Master Leads filter

Add a Status filter on **both** `/form-leads` and `/call-leads`,
next to Booked and Cancelled. This is required. It is how the Owner
finds No-Sync Leads on the desk. It is not the hide / show control
(that is Actions only).

| Layer | Change |
| --- | --- |
| `adminQueryBase` | `no_sync: booleanInput.optional()` |
| `adminBrowse.service.ts` | exact `{ no_sync: value }` on form-leads and call-leads boolean map (like `active`, not `presenceClause`) |
| `formLeadFilters` / `callLeadFilters` | select, `yesNoOptions`, label **Hidden from Master Leads**, after `cancelled` |
| `STATUS_FILTER_KEYS` | add `no_sync` so the control lands in the Status group |
| Columns | boolean column **Hidden from Master Leads** on both desks; chip allowed if that matches booked/cancelled treatment |

Omit / Any = no Mongo clause (shows syncable and No-Sync together).
Yes = `{ no_sync: true }` (hidden). No = `{ no_sync: false }` —
documents missing the field must still appear as No. Use
`{ no_sync: { $ne: true } }` for the No option so legacy rows without
the field count as syncable.

### 9.2 Find and global search

Find `q` already resolves Mongo ID. No new `q` path. That Find plus
the Hidden from Master Leads filter / column is the search surface.

Global `GET /api/v1/admin/search` does not get a no-sync filter or
badge in this pack.

Duplicate desks (`/duplicate-form-leads`, `/duplicate-call-leads`) may
show the column. Filter is optional there; default omit.

### 9.3 Manual create UI

On `/manual` create, both kinds:

- Checkbox **Hide from Master Leads**, default **checked**
- Unchecked → POST `{ no_sync: false }`
- Checked or omitted → server default `true` for `vantage_admin`

---

## 10. Tests (required)

### 10.1 Planner / legacy

- Ordinary No-Sync Form: no Forms upsert; delete `Forms` only. No
  writes targeting Duplicates or Bad Leads.
- Ordinary No-Sync Call: no Calls upsert; delete `Calls` only. No
  writes targeting Duplicate Calls.
- Booking Chain + ordinary No-Sync Call: Booked Deals upsert present;
  Lead plan is Calls delete-or-empty, never Calls upsert. Matching
  the Lead is not a Forms/Calls update.
- Unmatched Call without `no_sync`: still empty plan, **no** deletes.
- `no_sync` + `bad_lead`: **identical** to today's Bad dual-write
  (primary + Bad Leads). This pack adds no skip and no Bad Leads
  delete.
- `no_sync` + Call `duplicate`: **identical** to today's Call
  Duplicate plan (upsert Duplicate Calls, delete stale Calls).
- `no_sync` + Form `duplicate`: **identical** to today's Form
  Duplicate plan (upsert Duplicates; no leftover-Forms delete).
- Clear `no_sync` on an ordinary Form: upsert Forms.
- `isNoSyncLead` is false for missing / `false` / `null`.
- `noSyncAppliesToNormalTabs` is false when `duplicate` or `bad_lead`.

### 10.2 Create / update

- Admin Call create omits `no_sync` → stored `true`, no
  `call_lead.create` outbox.
- Admin Form create `{ no_sync: false }` → stored `false`, create
  outbox present.
- RingCentral / WordPress create with client `no_sync: true` → stored
  `false`.
- PATCH `no_sync: true` writes EntityChange path `no_sync` and
  enqueues `source_lead` update.
- Empty PATCH still no-ops.

### 10.3 Contains

- Ordinary Form `no_sync` → `not_expected`, `reason: "no_sync"`, no
  tab reads.
- Ordinary Call `no_sync` → same.
- Form `no_sync` + `bad_lead` → today's Bad expected tabs, **not**
  `no_sync` skip.
- Call `no_sync` + `duplicate` → today's Duplicate Calls expected
  tab, **not** `no_sync` skip.
- Unmatched without ordinary no-sync → still `created_on_unmatched`.
- Ordinary Call missing from Calls → still `missing`.

### 10.4 Browse

- `no_sync=true` returns only `no_sync === true`.
- `no_sync=false` returns missing-field and `false`, not `true`.
- Omit returns both.

### 10.5 Admin

- Manual **Hide from Master Leads** default checked; unchecked sends
  `false`.
- **Hidden from Master Leads** filter Any / Yes / No does not throw
  (`STATUS_FILTER_KEYS` includes `no_sync`).
- Hide / show control renders on the Actions tab for form-leads and
  call-leads and does not render in the row Actions cluster.
- Confirm is required before PATCH. Cancel does not PATCH.
- Success and failure messages match §7.2. Markup has no `no_sync`.
- Contains panel shows the No-Sync sentence for `reason === "no_sync"`.

---

## 11. Browser proof (local Admin)

Admin **http://localhost:3000**, API **http://localhost:3001**. Sign in
from `vantage-admin/.env` `ADMIN_SEED_*`. Do not paste secrets.

This walk is the Owner-visible proof: the Lead stays on the desk,
Forms/Calls do not expect it, and Master Booked still finds the
Booking.

1. `/manual` create a Call Lead, leave **Hide from Master Leads**
   checked. Open the row → Actions shows **Show on Master Leads**.
   Contains → **Not expected**.
2. Same Lead, Check Google Sheet contains. Must not be Missing.
3. Filter `/call-leads` **Hidden from Master Leads** = Yes. The new
   row is listed. Find `q` with its Mongo ID still resolves it.
4. Actions → **Show on Master Leads** → confirm. Success message
   from §7.2. After Sheet Sync drains (or legacy finalize),
   Contains → **Found** on Calls (unless Duplicate).
   Missing-until-drain then Found is acceptable.
5. Actions → **Hide from Master Leads** → confirm. Success message.
   After drain, Contains → **Not expected**. Do not run a second
   full-tab sheet scan from the Actions tab.
6. Book that Lead via a path that attaches it (or use an existing
   booked fixture). Booked Deals Contains for the Booking is **Found**.
   Lead Contains stays **Not expected**. This step is required — it is
   the proof that Lead → Booking provenance still exists.

Synthetic / local data only.

---

## 12. Acceptance criteria

1. `no_sync` is stored on Form Lead and Call Lead. Manual / Vantage
   Admin create defaults true. Other origins cannot mint a No-Sync
   Lead via the client body.
2. For an **ordinary** No-Sync Lead, `planSourceLead` /
   `syncSourceLead` never upsert Forms or Calls. They delete the
   existing Forms or Calls row for that Lead ID. They do not write
   or delete Duplicates, Duplicate Calls, or Bad Leads.
3. Booking Chain still writes Booked Deals and Mongo Lead ID. When
   the matched Lead is an ordinary No-Sync Lead, Booking Chain does
   **not** upsert Forms or Calls.
4. Owner PATCH flips the flag, writes EntityChange, and enqueues the
   source-lead job that deletes or upserts. The Admin control is
   Actions-tab only, with confirm, and a success or failure message.
5. `/form-leads` and `/call-leads` filter and show **Hidden from
   Master Leads** (Any / Yes / No; No includes legacy missing-field
   rows). Find `q` still resolves Mongo ID. No new search endpoint.
6. Contains of an **ordinary** No-Sync Lead is **Not expected** with
   `reason: "no_sync"`. It is never **Missing** solely because the
   Forms/Calls row is absent.
7. Bad Lead dual-write, Call Duplicate stale-delete, and Form
   Duplicate leftover-Forms are **byte-identical** to today whether
   or not `no_sync` is stored. This pack does not change those
   functions.
8. Unmatched Call Lead behavior is unchanged when `no_sync` is not
   true.
9. CPL, CRM Posting, Granot identity, and scored Form Lead Search are
   unchanged.

---

## 13. Out of scope

- Excluding No-Sync Leads from lead-cost analytics or forcing
  `applicable: false`.
- **Any change to Bad Lead or Duplicate Lead sheet routing** —
  including deleting Bad Leads / Duplicates / Duplicate Calls,
  skipping those upserts, or cleaning leftover Forms on Form
  Duplicate flip. Billable treatment of those tabs is undecided.
- Applying `no_sync` deletes or skips to any Master Leads tab other
  than Forms and Calls.
- A leftover-row contains verdict (live tab read after `no_sync`
  skip). Not expected / no tab reads is the desk proof.
- A post-mark full-tab sheet scan, date-range absence query, or
  Actions-tab “prove the row is gone” Google read. Success / failure
  of the PATCH is the mark proof.
- Global admin-search filter or badge.
- Any revival of Forms / Calls except Owner PATCH `no_sync: false`.
- Making Booking Chain update-only for ordinary Leads (Booked Deals
  still writes; only the source-lead Forms/Calls plan is skipped).
- Reusing `created_on_unmatched` on Manual create.
- Source Company Sheet default-on writes.
- Connect / intake / employee submit changes.
- Production flag, live payload, or production index apply unless
  the user asks.

---

## 14. Knowledge after ship

Pointer-only until the matching issue closes. Docs-keeper updates
bodies to match code:

- [`../knowledge/services/sheet-sync.md`](../knowledge/services/sheet-sync.md)
  — planner skip + living-lead deletes; Booking Chain still books.
- [`../knowledge/services/google-sheets.md`](../knowledge/services/google-sheets.md)
  — contains `no_sync` for ordinary Leads only; Bad/Duplicate table
  and write order unchanged.
- [`../knowledge/services/form-lead.md`](../knowledge/services/form-lead.md)
  — Manual default; PATCH path.
- [`../knowledge/services/call-lead.md`](../knowledge/services/call-lead.md)
  — same; distinct from unmatched.
- [`../knowledge/services/bookings.md`](../knowledge/services/bookings.md)
  — Booking Chain + No-Sync Lead: Booked Deals still writes; the
  matched source Lead must not upsert Forms or Calls.
- [`../knowledge/services/admin-search.md`](../knowledge/services/admin-search.md)
  — browse `no_sync` filter.
- [`../knowledge/services/domain-commands.md`](../knowledge/services/domain-commands.md)
  — `updateSourceOwnedLead` path list includes `no_sync`.
- Workspace-root `CONTEXT.md` — term **No-Sync Lead** (added with
  this pack).

Do not edit `catalog.md` (Agents / Merchants).
