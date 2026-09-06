# LNS-01 — Field, Manual default, planner delete, contains Not expected

> **Contract maturity: implementation-ready.** Session 1. Persist `no_sync`,
> default it on Vantage Admin create, skip and delete Master Leads rows,
> and make contains say Not expected. **No Admin UI. No desk filter.**

## 1. Authority and required reading

- **Pack specification:** [`../lead-no-sync-specification.md`](../lead-no-sync-specification.md)
  — §3, §4, §5.1–5.2, §6, §8.1–8.2, §10.1, §10.2 (create cases), §10.3,
  §12.1–12.3, §12.6–12.8. Wins on skip, delete, and contains.
- **Pack rules:** [`../README.md`](../README.md), [`../AGENT-PROTOCOL.md`](../AGENT-PROTOCOL.md)
- **Glossary:** workspace-root `CONTEXT.md` — [No-Sync Lead](../../../../CONTEXT.md)
- **Patterns to reuse:** `created_on_unmatched` skip in `planSourceLead`
  and `planExpectedSheetTabs`; Call stale-tab deletes in `jobPlanner.ts`

## 2. Objective

A Lead can be a No-Sync Lead in Mongo. Vantage Admin create (manual) makes that
the default. For an ordinary Lead, Sheet Sync never upserts Forms or
Calls and deletes that one tab if present. Duplicate and Bad sheet
paths stay as they are. Owner contains reports **Not expected** for
the ordinary case, not **Missing**. Booked Deals still writes. When
Booking Chain matches an ordinary No-Sync Lead it must not upsert
Forms or Calls.

## 3. Repository, branch, and prerequisites

- **Repository:** `vantage-main-server` only.
- **Branch:** current server desk branch, or `lead-no-sync` if that is
  how this desk is isolated. See the protocol.
- **Prerequisites:** none. This is the only startable issue.
- Ordinary checks use redacted synthetic data.
- No commit, push, deploy, production flag change, or live payload read.

## 4. Current-state evidence to verify

Observed 2026-09-06; **reverify at implementation**.

- No `no_sync` on `FormLead` / `CallLead`.
- `planSourceLead` skips only `CallLead.created_on_unmatched === true`
  with `return []` (no deletes).
- `syncSourceLead` has the same skip before the Google facade.
- `planBookingChain` always plans Booked Deals, then `planSourceLead`.
- `planExpectedSheetTabs` skipReason is only `"created_on_unmatched"`.
- Contains maps any skipReason to `not_expected` and does not read tabs.
- Bad Form Lead dual-upserts primary + Bad Leads. Call Duplicate upserts
  the new tab then deletes the opposite. Form Duplicate does not delete
  leftover Forms.
- `deriveFormLeadIngestionOrigin` / `deriveCallLeadIngestionOrigin` stamp
  `vantage_admin` for Admin create. Create always enqueues
  `form_lead.create` / `call_lead.create` today.

## 5. Locked decisions and invariants at risk

- Shared `isNoSyncLead` predicate. `no_sync === true` only.
- Evaluate `no_sync` before unmatched.
- `no_sync` applies only to ordinary Forms and Calls. Those are the
  only Master Leads tabs this issue may skip or delete. Duplicate and
  Bad sheet routing is untouched even when the flag is stored.
- Mark true / create true on an ordinary Lead → delete `Forms` or
  `Calls` only. Missing row is a no-op. Never delete Duplicates,
  Duplicate Calls, or Bad Leads.
- Unmatched without `no_sync` stays empty-plan, no deletes.
- Vantage Admin create: `input.no_sync ?? true`. Other origins: `false`,
  ignore client `true`.
- Create with `no_sync: true` does not enqueue `source_lead` create.
- Master Booked unchanged. Booking Chain must still write Booked
  Deals and must **not** upsert Forms or Calls for an ordinary
  No-Sync Lead. Do not gate only `persistSheetSyncIntent`.
- Do not change Bad dual-write, Call stale-delete, or Form Duplicate
  leftover-Forms whether or not `no_sync` is stored.

## 6. Deliverables and exact contract

1. Add `no_sync: { type: Boolean, default: false }` on both Lead models.
   Expose it on read DTOs used by admin browse/detail.
2. Stamp create per spec §5.2 next to provenance helpers.
3. Optional `no_sync` on create Zod (server still overrides by origin).
4. Shared predicate module imported by `jobPlanner.ts` and
   `sheetSyncSourceLookup.ts`.
5. `planSourceLead`: if `noSyncAppliesToNormalTabs`, emit §6.3
   Forms-or-Calls delete only; never upsert those tabs. If Duplicate
   or Bad, run today's planner unchanged. Same split in
   `syncSourceLead`.
6. `planExpectedSheetTabs`: `skipReason: "no_sync"` only when
   `noSyncAppliesToNormalTabs`.
7. Tests in spec §10.1, create cases in §10.2, contains in §10.3.

## 7. Out of scope

- Admin mark control, desk filter, Manual checkbox, contains copy
  (LNS-02 / LNS-03).
- `updateSourceOwnedLead` Zod / CHANGE_PATHS (LNS-02) — LNS-01 may add
  the field on the document from create only; PATCH accept can wait
  unless create tests need it. Prefer adding update Zod in LNS-02.
- Knowledge bodies (LNS-04).
- CPL / analytics exclusion.
- Booking Chain update-only for ordinary Leads.

## 8. Tests

Server cases in pack spec §10.1, §10.2 (create), §10.3. Existing
unmatched, Bad dual-write, and Call stale-delete tests stay green.

## 9. Knowledge updates after this issue ships

Pointer-only until LNS-04:

- Planner and contains skip exist; Manual default is server-side.

## 10. Acceptance criteria

- [x] Admin Call/Form create omit `no_sync` → stored `true`; no create
      outbox.
- [x] Admin create `{ no_sync: false }` → stored `false`; create outbox
      present.
- [x] Non-admin origin with client `no_sync: true` → stored `false`.
- [x] Ordinary No-Sync Form/Call planner: no Forms/Calls upserts;
      deletes that one tab; missing row no-ops; no Duplicates /
      Duplicate Calls / Bad Leads writes.
- [x] Booking Chain + No-Sync: Booked Deals upsert; no Calls/Forms upsert.
      Matching the Lead is not a Forms/Calls update.
- [x] Unmatched without `no_sync`: empty plan, no deletes.
- [x] `no_sync` + `bad_lead` / Call or Form duplicate: planner matches
      today's fixtures (no new skip, no new exception-tab delete).
- [x] Contains ordinary Form and Call `no_sync` → `not_expected`,
      `reason: "no_sync"`, no tab reads.
- [x] Contains `no_sync` + Bad or Duplicate → today's expected tabs,
      not the `no_sync` skip.
- [x] Ordinary missing Call still `missing`. Unmatched still
      `created_on_unmatched`.
- [x] Existing Bad dual-write and Call stale-delete tests still pass.

## 11. Commands

```bash
pnpm test
pnpm typecheck
```

Paste output in the completion report.

## 12. Risks

- Gating only `persistSheetSyncIntent` so Booking Chain still upserts
  Forms or Calls for a matched No-Sync Lead. That is a ship-blocker.
- Empty skip without deleting Forms/Calls, leaving a stale normal
  tab row.
- Deleting Duplicates / Duplicate Calls / Bad Leads “to be thorough.”
- Forgetting contains so Owner sees Missing.
- Reusing `created_on_unmatched` on Admin create.

## 13. Rollback

Revert the field, predicate, planner branch, and contains skipReason.
Unmatched and Bad/Duplicate paths must remain intact.

## 14. Handoff list for the completion report

- Create provenance evidence (origin × stored `no_sync` × outbox).
- Planner write lists for no-sync Form, no-sync Call, Booking Chain.
- Contains fixture verdicts (redacted).
- Which tests prove Bad/Duplicate planner output is unchanged when
  `no_sync` is also stored.
- What you did not do (LNS-02/03/04).
- Any §4 drift you corrected.
