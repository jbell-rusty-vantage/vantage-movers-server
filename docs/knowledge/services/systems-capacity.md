---
type: Service
title: Systems (locations and capacity)
description: The Owner-only Systems tab. "Where things live" is a runtime configuration document the Owner edits (recorded in Change history); Capacity reads disk use, Master Sheet size and the Sheet Sync queue live and projects "time until full" from one snapshot a day.
tags: [systems, capacity, sheet-sync, owner-dashboard]
status: draft
stale_after: 2027-01-07
resource: src/services/systems/
applies_to:
  - src/services/systems/**
  - src/routes/systems-admin.routes.ts
  - src/routes/capacity-snapshot-cron.routes.ts
  - src/models/SystemsLocations.ts
  - src/models/CapacitySnapshot.ts
  - src/validation/v1/systems.validation.ts
  - vantage-admin/lib/api/systems.ts
  - vantage-admin/components/systems/**
  - vantage-admin/app/(dashboard)/systems/**
owners: [team:main-server, team:vantage-admin]
sources:
  - id: primary
    resource: src/services/systems/
  - id: design
    resource: ../dashboard-redesign-proposal/11b-systems-and-health-reduced.md
    title: Systems & health, reduced (workspace root)
  - id: sheet-capacity
    resource: ../dashboard-redesign-proposal/12-master-sheet-capacity.md
    title: Master Sheet capacity (colour rules, 40,000 rows)
  - id: database-capacity
    resource: ../dashboard-redesign-proposal/13-database-capacity-and-backups.md
    title: Database capacity (colour rules)
  - id: glossary
    resource: ../CONTEXT.md
    title: Platform glossary
generated:
  by: agent:claude-code
  at: 2026-10-07T18:00:00Z
---
**Platform glossary:** [`../../../../CONTEXT.md`](../../../../CONTEXT.md)
**Design:** workspace `dashboard-redesign-proposal/11b-systems-and-health-reduced.md` (Owner request 2026-10-07; its
own sidebar tab at `/systems`, not a Setup section).
**Related:** [sheet-sync.md](./sheet-sync.md) (the queue whose stuck jobs turn a sheet card red),
[google-sheets.md](./google-sheets.md) (Master workbooks; column A holds the Mongo id).

# Systems (locations and capacity)

Owner-only. Every route verifies the signed dashboard Owner actor (`requireRegistryOwnerActor`), like the Operations
Registry; anyone else gets 403 `Systems is for the Owner only.` No new environment names: the server already holds the
Mongo user, the Sheets service account and the two Master sheet ids.

## Where things live (`GET` / `PATCH /api/v1/admin/systems/locations`)

- One document in `systems_locations` (`key: "locations"`, `revision`, `entries`). It is **seeded on the first read**
  with 11b's table (race-safe upsert) and never comes from env, so a domain cut-over is an Owner edit, not a redeploy.
- The key set is fixed and ordered: `extension`, `main_site`, `partner_pages`, `wordpress`, `dashboard`, `server`,
  `mcp`. Each row's button is fixed too (`install` for the extension, `copy` for the MCP, `open` otherwise).
- The PATCH (`systemsLocationsPatchSchema`) changes only `label`, `url`, `note`, `paths` (partner path chips),
  `code_url`, `code_note`, `host_url`, `logs_url`. Every link must be `https://`; an empty optional link or note clears
  it. Unknown keys, the Master Sheet keys and the button are refused with a 400 whose `error` is one Owner sentence.
- It carries the `revision` it was read at. A stale revision is 409 `REGISTRY_STALE_REVISION` (checked before and
  inside the transaction). The write and one `operations_registry_changes` row (`entity_type: "systems_locations"`,
  `action: "update"`, before/after of the changed rows only, `metadata.changed_keys`) commit together through
  `withRegistryMutation`, so the edit shows in Setup › Change history. A patch that changes nothing writes nothing.
- `master_leads` and `master_booked` rows are appended at read time from `MASTER_LEADS_SHEET_ID` /
  `MASTER_BOOKED_SHEET_ID` (`https://docs.google.com/spreadsheets/d/<id>`); they are not stored or editable. An unset id
  gives an empty link and the note "The sheet id is not set on the server."

## Capacity (`GET /api/v1/admin/systems/capacity[?refresh=1]`)

Returns `{ database, sheets: [master_leads, master_booked], generated_at, refreshed }`.

**Readers** (`readers.ts`, injected everywhere so unit tests never call Mongo stats or Sheets):

| Reading | Source | Cache |
| --- | --- | --- |
| Disk | `db.stats` on every database (`fsUsedSize`, `fsTotalSize`; `storageSize + indexSize` summed over every database except `local`) and `collStats` on `local.oplog.rs` (`storageSize`, `maxSize`) | 10 min |
| Sheets | `spreadsheets.get` grid sizes for every tab, plus the last non-empty cell of column A (one `values.batchGet`) — **only** on Master Leads and Master Booked, where column A is the Mongo id | 1 h |
| Sync line | `sheet_sync_jobs` by resource and status; newest `sheet_sync_runs` that synced at least one job | live |
| Last cancellation | newest `cancelled_leads.createdAt` (Master Booked card only) | live |

`refresh=1` skips both caches at most once a minute (`refreshed: false` inside that minute). A failed read keeps the
last good reading; with none, the card is `unknown` with a sentence and an `error`, and the page still renders.

**Sync line per workbook.** Master Leads owns `source_lead` and `delete_source_lead` jobs; Master Booked owns the
rest. `pending` counts `pending` and `retrying`; a job is **stuck** when `processing` with `updatedAt` more than
15 minutes old; the card shows the count and the oldest such date.

**Runway** (`runway.ts`, `projectRunway(points, limit, now, { seedRatePerDay, capYears, current })`, pure):
least-squares slope over the newest 30 snapshots; fewer than 7 snapshots uses the seed rate with `basis: "estimate"`
and `points: N` (the admin shows "estimate · N of 7 days measured"); a slope ≤ 0 is "not growing"; beyond `capYears`
(5 for the disk, 15 for sheets) is "more than N years"; otherwise "about 2 years 2 months (≈ Nov 2028)".

- **Database:** time until 90% and until full. The rate is the **larger** of the `fs_used_bytes` slope and the
  `data_bytes` slope (projected against the same remaining room), because WiredTiger reuses space freed by the
  2026-10-07 disk trim before the files grow. Seed ≈ 4 MB/day. The breakdown is business data (`data_bytes`),
  replication log (`oplog_storage_bytes`, reclaimable = storage − max) and system (the rest of `fs_used_bytes`).
- **Master Sheets:** the biggest tab by filled rows against 40,000; grid cells against Google's 10,000,000. "Time until a
  new workbook is needed" is the earlier of the biggest tab reaching 40,000 rows and the workbook reaching 5,000,000
  cells (`trigger: rows | cells`). Seeds per month: Master Leads +1,300 rows / +45,000 cells; Master Booked +185 rows /
  +4,440 cells (its row rate × 24 columns; 11b gives no cell seed).

**Colour** (first matching rule wins; the reason is one sentence the admin shows beside the colour):

| Card | Red | Amber | Green |
| --- | --- | --- | --- |
| Database | over 85% used, or 90% within 30 days | 75% used or more, or 90% within 90 days | otherwise |
| Master Sheet | any stuck job, any failed job, biggest tab ≥ 40,000 rows, or ≥ 5,000,000 cells | ≥ 30,000 rows, ≥ 3,000,000 cells, or a new workbook needed within 6 months | otherwise |

Master Leads is red from day one: three `source_lead` jobs have been `processing` since 2026-07-29 / 2026-08-31.
That is intended; clearing them is a separate task and the card must not hide them.

## Daily snapshot (`ALL /api/cron/capacity-snapshot`, `45 8 * * *`)

Behind `requireCronAuth` (`CRON_SECRET`). Writes one `capacity_snapshots` row per **New York** day:
`{ day, taken_at, database: { fs_used_bytes, fs_total_bytes, data_bytes, oplog_storage_bytes, oplog_max_bytes },
sheets: [{ workbook, grid_cells, tabs: [{ name, filled_rows, grid_cells }] }] }`. Unique on `day`: a second call the
same day answers `{ ok: true, written: false, reason: "already_exists" }`, and the unique index settles a race. When one
reader fails the row still records the other (`partial` in the response; `database: null` or `sheets: []`); both
failing writes nothing so a later call can retry. No TTL (about 30 KB a year).

## Deliberately not here

Backups, reachability probes, uptime, deploy state, Atlas tier, workbook rotation: 11b "Deliberately left out".
Partner health stays on Setup › Connections & health.
