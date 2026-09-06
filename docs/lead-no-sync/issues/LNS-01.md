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

A Lead can be a No-Sync Lead in Mongo. Vantage Admin create makes that
the default. Sheet Sync never upserts that Lead onto Master Leads and
deletes any row already there. Owner contains reports **Not expected**,
not **Missing**. Booked Deals still writes.

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
- `no_sync` wins over Duplicate and Bad for Master Leads writes.
- Mark true / create true → delete all model-appropriate Master Leads
  tabs by Mongo ID (and `sheet_sync[]` hints). Missing row is a no-op.
- Unmatched without `no_sync` stays empty-plan, no deletes.
- Vantage Admin create: `input.no_sync ?? true`. Other origins: `false`,
  ignore client `true`.
- Create with `no_sync: true` does not enqueue `source_lead` create.
- Master Booked unchanged.
- Do not change Bad dual-write or Call stale-delete when `no_sync`
  is false.

## 6. Deliverables and exact contract

1. Add `no_sync: { type: Boolean, default: false }` on both Lead models.
   Expose it on read DTOs used by admin browse/detail.
2. Stamp create per spec §5.2 next to provenance helpers.
3. Optional `no_sync` on create Zod (server still overrides by origin).
4. Shared predicate module imported by `jobPlanner.ts` and
   `sheetSyncSourceLookup.ts`.
5. `planSourceLead`: if no-sync, emit §6.3 deletes only; never upsert.
   Same for `syncSourceLead` (legacy deletes then return).
6. `planExpectedSheetTabs` + record flags: `skipReason: "no_sync"`.
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

- [ ] Admin Call/Form create omit `no_sync` → stored `true`; no create
      outbox.
- [ ] Admin create `{ no_sync: false }` → stored `false`; create outbox
      present.
- [ ] Non-admin origin with client `no_sync: true` → stored `false`.
- [ ] No-Sync Form/Call planner: no Master Leads upserts; deletes the
      specified tabs; missing row no-ops.
- [ ] Booking Chain + No-Sync: Booked Deals upsert; no Calls/Forms upsert.
- [ ] Unmatched without `no_sync`: empty plan, no deletes.
- [ ] `no_sync` + `bad_lead` / Call duplicate: no extra-tab upserts.
- [ ] Contains Form and Call `no_sync` → `not_expected`,
      `reason: "no_sync"`, no tab reads.
- [ ] Ordinary missing Call still `missing`. Unmatched still
      `created_on_unmatched`.
- [ ] Existing Bad dual-write and Call stale-delete tests still pass.

## 11. Commands

```bash
pnpm test
pnpm typecheck
```

Paste output in the completion report.

## 12. Risks

- Gating only `persistSheetSyncIntent` so Booking Chain still upserts
  Calls.
- Empty skip without deletes, leaving stale Forms/Calls rows.
- Forgetting contains so Owner sees Missing.
- Reusing `created_on_unmatched` on Admin create.

## 13. Rollback

Revert the field, predicate, planner branch, and contains skipReason.
Unmatched and Bad/Duplicate paths must remain intact.

## 14. Handoff list for the completion report

- Create provenance evidence (origin × stored `no_sync` × outbox).
- Planner write lists for no-sync Form, no-sync Call, Booking Chain.
- Contains fixture verdicts (redacted).
- Which tests prove Bad/Duplicate unchanged when syncable.
- What you did not do (LNS-02/03/04).
- Any §4 drift you corrected.
