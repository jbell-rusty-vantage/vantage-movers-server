---
type: Specification
title: No-Sync Lead — keep a Lead off Master Leads
description: >-
  Persist no_sync on Form Leads and Call Leads. Default it on Vantage Admin
  Manual create. Skip Master Leads Sheet Sync. When the Owner marks a Lead
  no-sync, find and delete every Master Leads row. Filter and search it on
  the desks. Owner contains reports Not expected, not Missing.
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
**Owner-facing labels:** Off Master Leads, Keep off Master Leads,
Not expected
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

1. Persist `no_sync` on every Form Lead and Call Lead.
2. Default it **on** for Vantage Admin Manual create so an Owner-typed
   match-anchor Lead stays in Mongo and off Master Leads.
3. Let the Owner mark an existing Lead no-sync. That write must find
   and delete every Master Leads row for that Lead ID, then refuse
   later Master Leads upserts.
4. Let the Owner clear the mark. The next Sheet Sync writes the Lead
   onto the tab its current flags require.
5. Filter and show the mark on `/form-leads` and `/call-leads`.
6. Owner contains must say **Not expected**, never **Missing**, for a
   No-Sync Lead.

Master Booked is unchanged. A Booking attached to a No-Sync Lead still
upserts Booked Deals and still writes Mongo Lead ID.

---

## 2. Language

| Say | Do not say |
| --- | --- |
| [No-Sync Lead](../../../CONTEXT.md) | hidden lead, silent lead, unmatched (for this flag) |
| `no_sync` | `sheet_sync_excluded`, `exclude_from_sheets` (code field is `no_sync`) |
| Off Master Leads | no_sync (in Owner UI) |
| Keep off Master Leads | skip sheets (Manual checkbox) |
| [Unmatched Call Lead](../../../CONTEXT.md) | No-Sync Lead (booking stub only) |
| [Sheet Sync](../../../CONTEXT.md) | Google upsert (unqualified) |
| [Booking Chain](../../../CONTEXT.md) | booking_chain (Owner UI) |

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

1. **Persisted field name is `no_sync`.** Boolean. Missing / `false` /
   `null` means the Lead is syncable. Only `true` excludes.
2. **One skip owner.** A shared predicate used by `planSourceLead` and
   `syncSourceLead`. Booking Chain, Cancellation Chain, create, Granot
   synchronize, enrichment, and PATCH all honor it because they already
   call those two functions for the source Lead.
3. **Do not gate only `persistSheetSyncIntent`.** Booking Chain would
   still plan the Lead.
4. **`no_sync` applies only to ordinary Forms and Calls.** Ordinary
   means `duplicate !== true` and Form `bad_lead` is unset. A Duplicate
   Lead or Bad Lead keeps today's sheet routing even when `no_sync`
   is true. Do not skip or delete Duplicates, Duplicate Calls, or
   Bad Leads in this pack.
5. **Marking `no_sync: true` deletes only the normal tab.** Empty skip
   is not enough. For an ordinary Form Lead, find and delete `Forms`.
   For an ordinary Call Lead, find and delete `Calls`. Missing row is
   a no-op. Never delete Duplicates, Duplicate Calls, or Bad Leads
   here.
6. **Clearing `no_sync` on an ordinary Lead upserts** `Forms` or
   `Calls`. If the Lead is Duplicate or Bad, today's routing runs
   unchanged (this pack does not invent a new clear path for those).
7. **Manual / Vantage Admin create defaults `no_sync: true` on the
   server** for both Form and Call. The Owner may send `false` to opt
   into Master Leads. Other Ingestion Origins always persist `false`
   and ignore a client `true`.
8. **Do not reuse `created_on_unmatched`.** Unmatched stays the booking
   stub. No-Sync Lead is an Owner (or Admin-create) reporting choice.
9. **Unmatched skip stays delete-free.** Do not change that empty-plan
   behavior.
10. **Master Booked is not excluded.** Booking Chain / booked-only jobs
    still write Booked Deals. Mongo Lead ID stays on that row.
11. **Contains `skipReason: "no_sync"` → `not_expected` only for an
    ordinary No-Sync Lead.** No tab reads. A Duplicate or Bad Lead
    with `no_sync` uses today's expected-tab map (not this skip).
    If a leftover Forms/Calls row still exists (delete not drained
    yet), a later contains after drain must still be Not expected
    for the ordinary case. Leftover-after-drain is a drain bug, not
    a Missing verdict.
12. **CPL and lead-cost analytics are unchanged.** A No-Sync Lead may
    still store CPL. A later pack may exclude it from cost. Not this
    pack.
13. **CRM Posting, Granot synchronize, identity, and booking attach
    are unchanged.** `no_sync` is a Sheet Sync projection flag.
14. **Owner-facing copy lives in existing copy modules.** Never print
    `no_sync` or `created_on_unmatched` in JSX.

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
```

One module, imported by `jobPlanner.ts` and `sheetSyncSourceLookup.ts`.
Do not copy the boolean test.

Evaluate **before** `created_on_unmatched`.

### 6.2 No-Sync Lead — never upsert Master Leads

If `isNoSyncLead(lead)`:

- Do not call `targetsToWrites` for any lead tab.
- Do not dual-write Bad Leads.
- Do not Call stale-opposite upsert.

Then run §6.3 deletes (queued) or the legacy delete equivalent.

### 6.3 Immediate delete (queued)

Emit **delete** writes for every Master Leads tab that model can occupy:

| Model | Tabs to search and delete |
| --- | --- |
| Form Lead | `Forms`, `Duplicates`, `Bad Leads` |
| Call Lead | `Calls`, `Duplicate Calls` |

Do **not** delete `Bad Calls` (no write path). Do **not** delete Booked
Deals or Cancelled Deals.

For each tab:

1. Prefer `sheet_sync[]` `row_number` when that cell still holds this
   Mongo ID (same as today's `upsertRow` / delete helpers).
2. Else find the row by Mongo ID.
3. Missing tab or missing row → no-op.

`WRITE_SOURCE_LEAD_SHEETS === "true"` is not the default. If that flag
is on, also delete the matching source-container tabs for those same
logical names. Do not invent a third workbook.

A `source_lead` job whose plan is **only** these deletes still
persists cleared / removed `sheet_sync[]` entries the same way other
deletes do. After a successful drain, the Lead should have **no**
Master Leads `sheet_sync[]` rows.

### 6.4 Legacy twin

`syncSourceLead` must delete the same tabs when `isNoSyncLead`, then
return without `syncFormLeadToSheets` / `syncCallLeadToSheets`.

### 6.5 Booking Chain and Cancellation Chain

Unchanged structure:

1. Write Booked Deals (and Cancelled Deals on the cancellation chain).
2. `planSourceLead` for the linked Lead.

Step 2 honors §6.2–6.3. Step 1 always runs.

### 6.6 Clearing `no_sync`

`no_sync` becomes `false` → enqueue `source_lead` /
`form_lead.update` or `call_lead.update` (already the correction
refresh path). Planner uses today's Duplicate / Bad routing and
upserts.

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

### 7.2 Admin UI

On Form Lead and Call Lead detail (and/or the row action cluster):

- Control label: **Off Master Leads**
- Checkbox or dedicated control in the same family as
  `MarkBadLeadControl`
- Checked = `no_sync: true`
- Saving checked triggers the PATCH immediately (no second confirm
  beyond existing edit-save patterns)
- Copy: “Stay off Master Leads. Booked Deals still updates if this
  lead is booked.”

Strings in `operational-copy.ts` (or Manual copy for the create
checkbox). Do not inline.

---

## 8. Owner contains

### 8.1 Planner

Extend `SheetContainsSkipReason` with `"no_sync"`.

`SheetContainsRecordFlags` copies `no_sync` from the loaded Lead.

`planExpectedSheetTabs`:

- If `flags.no_sync` → `{ expected: [], siblings: [], skipReason: "no_sync" }`
- Else today's unmatched / Duplicate / Bad map

Form and Call both skip. Unmatched remains Call-only and is only
reached when `no_sync` is not true.

### 8.2 Check

`runSheetContainsCheck` already maps any `skipReason` to
`not_expected` and **does not read tabs**. Reuse that. Do not add a
sixth verdict.

### 8.3 Admin copy

When `item.reason === "no_sync"` show:

> This lead is marked to stay off Master Leads. Sheet Sync does not
> write it there.

Keep the existing unmatched sentence for `created_on_unmatched`.

After LNS-01, checking a No-Sync Lead on `/form-leads` or
`/call-leads` (Find by Mongo ID → checkbox → Check Google Sheet
contains) must return **Not expected**, not **Missing**.

---

## 9. Desk filter, column, and Find

### 9.1 Browse

| Layer | Change |
| --- | --- |
| `adminQueryBase` | `no_sync: booleanInput.optional()` |
| `adminBrowse.service.ts` | exact `{ no_sync: value }` on form-leads and call-leads boolean map (like `active`, not `presenceClause`) |
| `formLeadFilters` / `callLeadFilters` | select, `yesNoOptions`, label **Off Master Leads** |
| `STATUS_FILTER_KEYS` | add `no_sync` |
| Columns | boolean column **Off Master Leads** on both desks; chip allowed if that matches booked/cancelled treatment |

Omit / Any = no Mongo clause (shows syncable and No-Sync together).
Yes = `{ no_sync: true }`. No = `{ no_sync: false }` — documents
missing the field must still appear as No. Use
`{ no_sync: { $ne: true } }` for the No option so legacy rows without
the field count as syncable.

### 9.2 Find and global search

Find `q` already resolves Mongo ID. No new `q` path.

Global `GET /api/v1/admin/search` does not need a no-sync filter.
Optional badge later; not required.

Duplicate desks (`/duplicate-form-leads`, `/duplicate-call-leads`) may
show the column. Filter is optional there; default omit.

### 9.3 Manual create UI

On `/manual` create, both kinds:

- Checkbox **Keep off Master Leads**, default **checked**
- Unchecked → POST `{ no_sync: false }`
- Checked or omitted → server default `true` for `vantage_admin`

---

## 10. Tests (required)

### 10.1 Planner / legacy

- No-Sync Form: no Forms / Duplicates / Bad Leads upserts; deletes
  those three tabs (Mongo ID / hint).
- No-Sync Call: no Calls / Duplicate Calls upserts; deletes both.
- Booking Chain + No-Sync Call: Booked Deals upsert present; Lead
  plan is deletes-or-empty, never Calls upsert.
- Unmatched Call without `no_sync`: still empty plan, **no** deletes.
- `no_sync` + `bad_lead`: no Bad Leads upsert.
- `no_sync` + Call `duplicate`: no Duplicate Calls upsert; Deletes
  both Call tabs.
- Clear `no_sync` on a non-duplicate Form: upsert Forms.
- `isNoSyncLead` is false for missing / `false` / `null`.

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

- Form `no_sync` → `not_expected`, `reason: "no_sync"`, no tab reads.
- Call `no_sync` → same.
- Unmatched without `no_sync` → still `created_on_unmatched`.
- Ordinary Call missing from Calls → still `missing`.

### 10.4 Browse

- `no_sync=true` returns only `no_sync === true`.
- `no_sync=false` returns missing-field and `false`, not `true`.
- Omit returns both.

### 10.5 Admin

- Manual checkbox default checked; unchecked sends `false`.
- Filter Any / Yes / No does not throw (`STATUS_FILTER_KEYS`).
- Contains panel shows the No-Sync sentence for `reason === "no_sync"`.

---

## 11. Browser proof (local Admin)

Admin **http://localhost:3000**, API **http://localhost:3001**. Sign in
from `vantage-admin/.env` `ADMIN_SEED_*`. Do not paste secrets.

1. `/manual` create a Call Lead, leave **Keep off Master Leads**
   checked. Detail shows Off Master Leads. Contains → **Not expected**.
2. Same Lead, Check Google Sheet contains. Must not be Missing.
3. Filter `/call-leads` Off Master Leads = Yes. The new row is listed.
4. Clear the mark on detail. After Sheet Sync drains (or legacy
   finalize), Contains → **Found** on Calls (unless Duplicate).
5. Mark Off Master Leads again. After drain, Contains → **Not expected**.
   Calls row is gone.
6. Book that Lead via a path that attaches it (or use an existing
   booked fixture). Booked Deals Contains for the Booking is **Found**.
   Lead Contains stays **Not expected**.

Synthetic / local data only.

---

## 12. Acceptance criteria

1. `no_sync` is stored on Form Lead and Call Lead. Manual / Vantage
   Admin create defaults true. Other origins cannot mint a No-Sync
   Lead via the client body.
2. `planSourceLead` / `syncSourceLead` never upsert Master Leads for
   `no_sync === true`. They delete any existing Master Leads rows for
   that Lead ID.
3. Booking Chain still writes Booked Deals and Mongo Lead ID.
4. Owner PATCH flips the flag, writes EntityChange, and enqueues the
   source-lead job that deletes or upserts.
5. `/form-leads` and `/call-leads` filter and show Off Master Leads
   (Any / Yes / No; No includes legacy missing-field rows).
6. Contains of a No-Sync Lead is **Not expected** with `reason:
   "no_sync"`. It is never **Missing** solely because the row is
   absent.
7. Bad Lead remains dual-write when `no_sync` is false. Call Duplicate
   still deletes the stale Calls tab when `no_sync` is false. This
   pack does not change those orders.
8. Unmatched Call Lead behavior is unchanged when `no_sync` is not
   true.
9. CPL, CRM Posting, Granot identity, and scored Form Lead Search are
   unchanged.

---

## 13. Out of scope

- Excluding No-Sync Leads from lead-cost analytics or forcing
  `applicable: false`.
- Changing Form Duplicate leftover-Forms cleanup (except as a
  side-effect of §6.3 when the Owner marks no-sync).
- Changing Bad Lead dual-write into “move off Forms.”
- Making Booking Chain update-only for ordinary Leads.
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
  — contains `no_sync`; Bad/Duplicate table unchanged; No-Sync never
  writes those tabs.
- [`../knowledge/services/form-lead.md`](../knowledge/services/form-lead.md)
  — Manual default; PATCH path.
- [`../knowledge/services/call-lead.md`](../knowledge/services/call-lead.md)
  — same; distinct from unmatched.
- [`../knowledge/services/bookings.md`](../knowledge/services/bookings.md)
  — Booking Chain + No-Sync Lead: Booked Deals only for the source
  row.
- [`../knowledge/services/admin-search.md`](../knowledge/services/admin-search.md)
  — browse `no_sync` filter.
- [`../knowledge/services/domain-commands.md`](../knowledge/services/domain-commands.md)
  — `updateSourceOwnedLead` path list includes `no_sync`.
- Workspace-root `CONTEXT.md` — term **No-Sync Lead** (added with
  this pack).

Do not edit `catalog.md` (Agents / Merchants).
