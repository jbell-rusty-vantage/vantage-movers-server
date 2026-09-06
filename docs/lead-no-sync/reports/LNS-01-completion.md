---
type: Completion report
title: LNS-01 — Field, Manual default, planner delete, contains Not expected
status: complete
closed: 2026-09-06
---

# LNS-01 completion

Repo: `vantage-main-server` only. Branch `lead-no-sync`. No commit, no push, no Admin UI.

## Create provenance evidence (origin × stored `no_sync` × outbox)

`noSyncOnCreate` next to provenance, then stamped on the document in `writeTheFormLead` / `beginCallLeadIngestion` / `beginRingCentralCallLeadIngestion`.

| Origin | Client body | Stored `no_sync` | Create outbox |
| --- | --- | --- | --- |
| `vantage_admin` | omit | `true` | no `form_lead.create` / `call_lead.create` |
| `vantage_admin` | `{ no_sync: false }` | `false` | today's create job is pushed |
| `wordpress_form` | `{ no_sync: true }` | `false` | today's Form create job unchanged |
| `ringcentral` | client `true` ignored | `false` | today's Call create job unchanged |

Proof:

- `noSyncOnCreate defaults true for vantage_admin and ignores other-origin client true`
- `Admin Form omit stamps no_sync true; opt-in false and WordPress client true stamp correctly`
- `Admin Call omit stamps no_sync true; RingCentral client true stamps false`
- Source scan: `writeTheFormLead` stamps `noSyncOnCreate(tx.ingestion_origin, prepared.input.no_sync)` and pushes `form_lead.create` only when `created.no_sync !== true`
- Source scan: `beginCallLeadIngestion` stamps `noSyncOnCreate(tx.ingestion_origin, input.no_sync)` and calls `rememberSheetSync` only when `created.no_sync !== true`
- Create Zod accepts optional `no_sync`; update Zod still rejects it (LNS-02)

`ingestion_origin` stays server-owned. `no_sync` is not on the public forbidden-lifecycle strip list.

## Planner write lists

Ordinary No-Sync Form (`planJobWrites` / `source_lead`):

```text
delete:master_forms:Forms
```

No Forms upsert. No Duplicates / Bad Leads writes.

Ordinary No-Sync Call:

```text
delete:master_calls:Calls
```

No Calls upsert. No Duplicate Calls writes.

Booking Chain + ordinary No-Sync Call (stubbed `BookedLead.findById` + linked Call Lead):

- Booked Deals upsert present (`upsert` / `master_booked`)
- Lead plan is `delete:master_calls:Calls` only — never a Calls upsert

Unmatched Call without `no_sync`: empty plan `[]`, no deletes.

Clear / missing `no_sync` on an ordinary Form: `upsert:master_forms:Forms`.

## Contains fixture verdicts (redacted)

| Fixture | Verdict | Reason | Tab reads |
| --- | --- | --- | --- |
| Ordinary Form `no_sync` | `not_expected` | `no_sync` | 0 |
| Ordinary Call `no_sync` | `not_expected` | `no_sync` | 0 |
| Form `no_sync` + `bad_lead` | today's Bad expected tabs (`found` + missing Bad Leads) | not `no_sync` | reads run |
| Call `no_sync` + `duplicate` | today's Duplicate Calls expected tab (`found`) | not `no_sync` | reads run |
| Unmatched Call without ordinary no-sync | `not_expected` | `created_on_unmatched` | 0 |
| Ordinary Call missing from Calls | `missing` | — | reads run |

## Bad / Duplicate planner twins

These tests prove planner output is unchanged when `no_sync` is also stored:

- `no_sync + bad_lead matches today's Bad Form dual-write` — both lists are `upsert:master_forms:Forms` then `upsert:master_bad_leads:Bad Leads`
- `no_sync + Call duplicate matches today's Duplicate Calls plan` — both lists are `upsert:master_duplicate_calls:Duplicate Calls` then `delete:master_calls:Calls`
- `no_sync + Form duplicate matches today's Form Duplicate plan` — both lists are `upsert:master_duplicates:Duplicates` (no leftover-Forms delete)

Existing `planJobWrites dual-writes bad form leads…` and `planJobWrites deletes stale Calls row…` still pass.

## Shared predicate

`src/services/sheetSync/noSyncLead.ts` is imported by `jobPlanner.ts`, `sheetSyncSourceLookup.ts`, and `expectedSheetTabs.ts`. Tests live only next to that module.

`isNoSyncLead` is false for missing / `false` / `null`. `noSyncAppliesToNormalTabs` is false when `duplicate` or `bad_lead`.

Legacy `syncSourceLead` evaluates the same predicate before unmatched, deletes ordinary Forms/Calls via `deleteRowsFromTargets`, and does not call `syncFormLeadToSheets` / `syncCallLeadToSheets` when the ordinary skip applies.

## What this issue did not do

- LNS-02: Owner PATCH, `updateSourceOwnedLead` Zod / `CHANGE_PATHS`, EntityChange path, Actions-tab control
- LNS-03: desk filter/column, Manual checkbox, contains Owner copy
- LNS-04: knowledge bodies
- CPL / analytics exclusion
- Booking Chain update-only for ordinary Leads
- Admin UI, commit, push, deploy, production flag, live payload

## §4 drift corrected

None. Reverify matched the issue: no field, unmatched empty-plan, contains skipReason only `created_on_unmatched`, Bad dual-write and Call stale-delete unchanged, create always enqueued.

Same-change necessity (not §4 drift): historical consolidation `SERVER_OWNED_REVISION_DEFAULTS` now includes `no_sync` so mongoose default `false` on insert is not treated as an unplanned sheet fact.

## Commands

| Command | Result |
| --- | --- |
| `vantage-main-server` `pnpm typecheck` | pass |
| `vantage-main-server` `pnpm test` | 2063 pass, 0 fail, 108 skipped (pre-existing replica / opt-in suite skips), `duration_ms` 303350 |

No new test was skipped or failed.

Full server suite footer:

```text
ℹ tests 2171
ℹ suites 12
ℹ pass 2063
ℹ fail 0
ℹ cancelled 0
ℹ skipped 108
ℹ todo 0
ℹ duration_ms 303349.6107
```

LNS-02 and LNS-03 are the next startable issues.
