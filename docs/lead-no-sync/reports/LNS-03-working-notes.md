# LNS-03 working notes

Started 2026-09-06. Implementation agent. Branch `lead-no-sync` on
`vantage-main-server` and `vantage-admin`. LNS-02 already shipped, so
browser walk includes spec §11 steps 1–6.

## Pickup

PROGRESS already marks LNS-03 `active`. No extra pickup edit beyond
this file and issue-log appends as work proceeds.

## Plan

1. Reverify LNS-03 §4 against the repository.
2. Server: `adminQueryBase` + browse boolean clause for `no_sync`.
3. Server tests in spec §10.4 (form-leads and call-leads).
4. Admin: desk filter + column, STATUS_FILTER_KEYS, Manual checkbox,
   contains copy.
5. Admin tests in spec §10.5 (filter-group, desks, Manual, contains).
6. `pnpm test` + `pnpm typecheck` in both repos.
7. Browser walk §11 steps 1–6.
8. Completion report + PROGRESS close. Do not start LNS-04.

## §4 reverify

Matched the issue. No drift.

| Claim | Repository |
| --- | --- |
| `adminQueryBase` has booked/cancelled optional `booleanInput`, no `no_sync` | `admin.validation.ts` lines 58–59. No `no_sync` in the object. |
| `booleanFilters` use `presenceClause` except `active` | `adminBrowse.service.ts` ~507–511. form-leads / call-leads maps are `{ booked, cancelled }` only. |
| `STATUS_FILTER_KEYS` throws if a select key is omitted | `filterGroupForKey` throws `Unknown operational filter key has no group`. Existing test covers every FilterConfig.key. |
| Find `q` already matches 24-hex Mongo ID | `addQClause` uses `mongoose.isValidObjectId`. |
| Manual payload does not send `no_sync` | `buildManualCreateLeadPayload` has no `no_sync`. |
| Contains panel special-cases unmatched + missing_from_mongo only | `sheet-contains-panel.tsx` lines 71–76. |

Decision: keep the **Hidden from Master Leads** column visible by default (do not add `no_sync` to the booked/cancelled default-hidden set). Filter stays the find surface; column is the desk proof.

## Server browse

- `no_sync: booleanInput.optional()` on `adminQueryBase`.
- form-leads + call-leads `booleanFilters` include `no_sync`.
- Clause: omit = none; true = `{ no_sync: true }`; false = `{ no_sync: { $ne: true } }`. `active` and presence stay.

## Admin

- Status filter + boolean column **Hidden from Master Leads** on both lead desks (shared with duplicate desks).
- Column left visible by default (not in booked/cancelled hidden set).
- Manual `hide_from_master_leads` default true; payload sends `no_sync: false` only when unchecked.
- Contains panel uses `isHiddenFromMasterLeadsContainsReason` so JSX does not print `no_sync`.
- No row-status chip added. Boolean column is the desk surface.

## Commands (before browser)

- Server `pnpm test`: 2076 pass, 0 fail, 108 skipped (pre-existing), `duration_ms` 340700.
- Server `pnpm typecheck`: pass.
- Admin `pnpm test`: 520 pass, 0 fail, `duration_ms` 10585.
- Admin `pnpm typecheck`: pass.

## Browser walk (spec §11)

Synthetic Call Lead job `LNS03W01`. Hide from Master Leads left checked.
Local Sheet Sync: queued, local publish off — drain does not run.

1. Actions **Show on Master Leads**. Contains **Not expected** + §8.3 sentence.
2. Same contains: **Not expected**, not Missing.
3. Filter Hidden from Master Leads = Yes lists the row. Find by Mongo ID resolves it. Hidden = No + same Find returns 0 rows.
4. Show → confirm → §7.2 success. Contains **Missing** (pending job / drain off). Did not wait on LNS-02. No Actions-tab sheet scan.
5. Hide → confirm → §7.2 success. Contains **Not expected**. No second Actions-tab scan.
6. Book this lead created a Booking. Booked Deals contains **Missing** (Sheet Sync job still pending). Lead contains stayed **Not expected** + hidden sentence.

## Close

Completion report written. PROGRESS closed. LNS-04 set `ready`. No commit. No LNS-04 work.
