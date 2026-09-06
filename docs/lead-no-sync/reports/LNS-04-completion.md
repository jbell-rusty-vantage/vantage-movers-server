---
type: Completion report
title: LNS-04 — Knowledge and pointer sentences
status: complete
closed: 2026-09-06
---

# LNS-04 completion

Repo: `vantage-main-server` docs (and glob-scoped rules that already own those paths).
Branch `lead-no-sync`. No runtime, no Admin UI, no commit, no push.

## Files changed and the sentence that landed

### Spec §14 Service bodies

| File | Sentence that landed |
| --- | --- |
| `docs/knowledge/services/sheet-sync.md` | Ordinary No-Sync Lead (`noSyncAppliesToNormalTabs` in `src/services/sheetSync/noSyncLead.ts`): `planSourceLead` / `syncSourceLead` skip Forms/Calls upserts and delete living Forms or Calls rows only. Duplicate Lead and Bad Lead still run today's planner — `no_sync` does not delete or skip Duplicates, Duplicate Calls, or Bad Leads. Booking Chain still writes Booked Deals (Mongo Lead ID stays); the linked ordinary source Lead uses the same predicate and must not upsert Forms or Calls. Do not gate only `persistSheetSyncIntent`. Create with `no_sync: true` does not enqueue `form_lead.create` / `call_lead.create`. Unmatched Call Lead remains the next bullet (empty plan, not a living-lead delete). |
| `docs/knowledge/services/google-sheets.md` | Contains table row: ordinary No-Sync (`noSyncAppliesToNormalTabs`) is not written (`skipReason: "no_sync"` → Not expected; no tab reads). Follow-on: that skipReason fires only when `noSyncAppliesToNormalTabs`; Bad + `no_sync` and Duplicate + `no_sync` use today's expected tabs; Unmatched skipReason stays `created_on_unmatched`. Bad dual-write and Call stale-delete tables unchanged — `no_sync` does not delete or skip those tabs. |
| `docs/knowledge/services/form-lead.md` | Manual / `vantage_admin` create defaults No-Sync Lead (`input.no_sync ?? true` via `noSyncOnCreate`). Other origins persist `false` and ignore client `true`. Create with `no_sync: true` skips the `form_lead.create` outbox. Owner PATCH `no_sync` is `updateSourceOwnedLead`. Ordinary No-Sync skips/deletes Forms only; Duplicate / Bad routing unchanged. |
| `docs/knowledge/services/call-lead.md` | Same create default / origin override. Create with `no_sync: true` skips `call_lead.create`. Ordinary No-Sync skips/deletes Calls only. Distinct from Unmatched Call Lead (`created_on_unmatched`). |
| `docs/knowledge/services/bookings.md` | Booking Chain + ordinary No-Sync Lead: Booked Deals still writes the Mongo Lead ID. The matched source Lead must not upsert Forms or Calls — same `planSourceLead` / `syncSourceLead` `noSyncAppliesToNormalTabs` predicate. Unmatched Call Lead sentence kept and marked distinct. |
| `docs/knowledge/services/admin-search.md` | Form-leads / call-leads browse accept optional `no_sync`: Yes `{ no_sync: true }`, No `{ no_sync: { $ne: true } }` (missing-field counts as No), omit no clause. Not a global-search filter or badge. Owner desk copy is Hidden from Master Leads; the API field is `no_sync`. |
| `docs/knowledge/services/domain-commands.md` | `updateSourceOwnedLead` `FORM_LEAD_CHANGE_PATHS` / `CALL_LEAD_CHANGE_PATHS` include `no_sync`; empty or same-value still no-ops. No new command. EntityChange `STORED_PATHS` includes `no_sync`. |
| `docs/index.md` | Kept. Pack authoring already added the Delivery / Reference rows. No new catalog row. |

### Pointer-only rules (already owned these paths)

| File | Sentence that landed |
| --- | --- |
| `.cursor/rules/sheet-sync-process.mdc` | Ordinary No-Sync Lead (`noSyncAppliesToNormalTabs` in `src/services/sheetSync/noSyncLead.ts`) skips/deletes Master Leads Forms and Calls only; Unmatched Call Lead stays a separate empty-plan skip (`created_on_unmatched`). |
| `.cursor/rules/form-lead-granot-crm.mdc` | Ordinary No-Sync create (`no_sync: true`) does not enqueue `form_lead.create`; Manual / `vantage_admin` defaults true (`input.no_sync ?? true`); other origins persist `false`. |
| `.cursor/rules/owner-lead-workflow.mdc` | Manual / `vantage_admin` create defaults No-Sync Lead and skips the Forms/Calls create outbox; other origins persist `false`. Owner PATCH `no_sync` is `updateSourceOwnedLead`. |
| `.cursor/rules/schema-and-crud-inputs.mdc` | Field-list only: FormLead and CallLead collection bullets now include `no_sync`. |

## okf:query output

`pnpm okf:query --type Service` from `vantage-main-server` (exit 0):

```text
count	46
```

All seven §14 Service paths still list (`sheet-sync`, `google-sheets`, `form-lead`, `call-lead`, `bookings`, `admin-search`, `domain-commands`). `catalog.md` remains in the catalog and was not edited.

## What this issue did not do

- Runtime or Admin UI changes.
- New ADR, new rule, new Service, or new `docs/index.md` row.
- Edit `catalog.md` or workspace-root `CONTEXT.md`.
- Claim CPL / analytics exclusion.
- Rewrite Bad dual-write or Call stale-delete.
- Merge No-Sync Lead into Unmatched Call Lead.
- Describe local Sheet Sync drain as always running (LNS-03 walk was Missing-until-drain).

## Spec-vs-shipped drift described honestly

Shipped and named in the bodies or this report:

- Shared predicates `isNoSyncLead` / `noSyncAppliesToNormalTabs` live in `src/services/sheetSync/noSyncLead.ts` (imported by planner, legacy `syncSourceLead`, and contains).
- Historical consolidation insert-default allowlist includes `no_sync` (mongoose default `false`). Not restated as owner policy.
- EntityChange `STORED_PATHS` includes `no_sync` (with CHANGE_PATHS).
- LNS-03 browser walk: local Sheet Sync drain was off (Missing-until-drain after unmark / Booked Deals). Knowledge describes planner/contains policy, not that a local drain always runs.
- Owner copy is Hide / Show / Hidden from Master Leads. Docs may name the field `no_sync`; Owner UI never prints it.

`CONTEXT.md` **No-Sync Lead** still matches stored field `no_sync`. No glossary edit.

## Commands

| Command | Result |
| --- | --- |
| `vantage-main-server` `pnpm okf:query --type Service` | count 46, exit 0 |

No runtime tests. Manual read of each updated body against LNS-01–03 reports.
