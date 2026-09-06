---
type: Completion report
title: LNS-03 — Desk filter, column, Manual checkbox, contains copy
status: complete
closed: 2026-09-06
---

# LNS-03 completion

Repos: `vantage-main-server` then `vantage-admin`. Branch `lead-no-sync` on both.
No commit, no push, no deploy, no live customer payload.

## Browse query evidence (redacted)

`adminQueryBase` accepts optional `no_sync`. form-leads and call-leads
`booleanFilters` include `no_sync`. The clause builder is
`booleanFilterClause`:

| Query | Mongo clause | Not |
| --- | --- | --- |
| omit / Any | no `no_sync` key | — |
| Yes (`true`) | `{ no_sync: true }` | not `presenceClause` / `$exists` |
| No (`false`) | `{ no_sync: { $ne: true } }` | not `{ $exists: false }` |

`active` stays `{ field: value }`. booked / cancelled stay `presenceClause`.

Stub proof (`stubFind` + `inspect(capture.filter)`), both desks:

- `admin form lead browse no_sync true is exact true, not presence`
- `admin form lead browse no_sync false uses $ne true so missing-field rows count`
- `admin form lead browse omit does not mention no_sync`
- same three names for call-leads

Local desk counts (synthetic Call Lead job `LNS03W01`, Mongo
`6a9df2ba470e12fa5676df71`):

| Desk query | Rows for that Find |
| --- | --- |
| Hidden from Master Leads = Yes + Find Mongo ID | 1 (the synthetic row) |
| Hidden from Master Leads = No + same Find | 0 |
| Find Mongo ID, filter omitted | 1 |

Chip on Yes: **Hidden from Master Leads : Yes**. Chip on No:
**Hidden from Master Leads : No**.

## Manual payload cases

Draft field is `hide_from_master_leads` (Owner name). Default `true` in
`emptyManualCreateLeadDraft` for Form and Call. Checkbox on both kinds.
Copy from `MANUAL_COPY.hideFromMasterLeads` / hint. JSX does not print
`no_sync`.

| Draft | Payload |
| --- | --- |
| default / checked | omits `no_sync` (does not send `true`) |
| unchecked (`hide_from_master_leads: false`) | `{ no_sync: false }` |

Proof: `Hide from Master Leads defaults checked and only sends no_sync when unchecked`.

Browser create left the checkbox checked. Success: “Call Lead created.
Master Leads will update.”

## Browser notes (spec §11)

Local Admin `http://localhost:3000`, API `http://localhost:3001`.
Signed in from `ADMIN_SEED_*` in `vantage-admin/.env` (not pasted).
`MONGO_DNS_SERVERS` already set. API started with `PORT=3001`. Admin
started with `VANTAGE_API_BASE_URL=http://localhost:3001` so the desk
does not follow the production URL in `.env`.

Sheet Sync locally: queued, local publish off. Drain does not run.
Do not invent a leftover-row tab read.

Synthetic Call Lead only. Job `LNS03W01`. Lead Mongo
`6a9df2ba470e12fa5676df71`. Booking Mongo `6a9df358470e12fa5676df80`.
No live names, phones, emails, or seed credentials.

| Step | Result |
| --- | --- |
| 1 | `/manual` Call Lead, **Hide from Master Leads** left checked. Actions shows **Show on Master Leads**. Contains → **Not expected** + “This lead is hidden from Master Leads. Sheet Sync does not write it to Forms or Calls.” |
| 2 | Same Check Google Sheet contains. **Not expected**, not Missing. |
| 3 | `/call-leads` Hidden from Master Leads = Yes lists the row. Find `q` with the Mongo ID still resolves it. |
| 4 | Actions → **Show on Master Leads** → confirm. Success: “This lead will show on Master Leads again after Sheet Sync.” Contains after unmark → **Missing** (Sheet Sync job still pending). Missing-until-drain is acceptable. Did **not** wait on LNS-02 (already shipped). No post-mark full-tab sheet scan from Actions. |
| 5 | Actions → **Hide from Master Leads** → confirm. Success: “Hidden from Master Leads. Sheet Sync will remove the Forms or Calls row.” Contains → **Not expected** + hidden sentence. No second Actions-tab sheet scan. |
| 6 | Book this lead created a Booking (job `LNS03W01`). Booked Deals contains → **Missing** from Booked Deals, “Sheet Sync job still open: pending.” Lead contains after attach → **Not expected** + hidden sentence (not Missing). Booking attach succeeded; Found-after-drain did not run because local drain is off. |

Steps 4–5 did **not** wait on LNS-02.

## What this issue did not do

- Planner / contains skipReason (LNS-01).
- Mark control except labels already in `OPERATIONAL_COPY` (LNS-02).
- Knowledge bodies (LNS-04). docs-keeper not invoked; LNS-04 owns the sentences.
- Global-search filter or badge.
- Leftover-row contains verdict.
- Row-status chip.
- Default-hiding the new column (left visible, unlike booked/cancelled).
- Duplicate-desk filter (shared `formLeadFilters` / `callLeadFilters` is OK).
- Commit, push, deploy, production flag, live payload.
- Starting LNS-04.

## §4 drift

None. Reverify matched the issue: `adminQueryBase` had booked/cancelled
only; browse used `presenceClause` except `active`; `STATUS_FILTER_KEYS`
still threw; Find `q` already matched 24-hex IDs; Manual payload omitted
`no_sync`; contains panel special-cased unmatched + `missing_from_mongo`
only.

Decision (not drift): keep the **Hidden from Master Leads** column
visible by default.

## Commands

| Command | Result |
| --- | --- |
| `vantage-main-server` `pnpm typecheck` | pass |
| `vantage-main-server` `pnpm test` | 2076 pass, 0 fail, 108 skipped (pre-existing replica / opt-in), `duration_ms` 340700 |
| `vantage-admin` `pnpm typecheck` | pass |
| `vantage-admin` `pnpm test` | 520 pass, 0 fail, 0 skipped, `duration_ms` 10585 |

No new test failed or skipped. Server suite grew +6 vs LNS-02 (2070 → 2076 pass; 2178 → 2184 total). Admin grew +7 vs LNS-02 (513 → 520).

Full server suite footer:

```text
ℹ tests 2184
ℹ suites 12
ℹ pass 2076
ℹ fail 0
ℹ cancelled 0
ℹ skipped 108
ℹ todo 0
ℹ duration_ms 340700.4229
```

Full Admin suite footer:

```text
ℹ tests 520
ℹ suites 0
ℹ pass 520
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 10585.1692
```
