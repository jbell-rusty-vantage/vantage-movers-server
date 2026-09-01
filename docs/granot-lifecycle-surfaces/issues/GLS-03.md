# GLS-03 — Receipts tab on Granot Lifecycle

> **Contract maturity: implementation-ready.** Session 2 (Admin).
> Consume the GLS-02 list API. Receipts becomes the Granot Lifecycle
> default tab. **No server change unless GLS-02 left a documented
> hole — then stop and record it.**

## 1. Authority and required reading

- **Pack specification:** [`../granot-lifecycle-surfaces-specification.md`](../granot-lifecycle-surfaces-specification.md)
  — §2.2, §5, §7, §12. Wins on UI, labels, and deep links.
- **Pack rules:** [`../README.md`](../README.md), [`../AGENT-PROTOCOL.md`](../AGENT-PROTOCOL.md)
- **GLS-01 completion:** [`../reports/GLS-01-completion.md`](../reports/GLS-01-completion.md)
- **GLS-02 completion:** [`../reports/GLS-02-completion.md`](../reports/GLS-02-completion.md)
- **Job Timeline href:** `vantage-admin/lib/api/jobNumberTimeline.ts`
  `buildJobTimelineHref`
- **Glossary:** workspace-root `CONTEXT.md`

## 2. Objective

The Owner opens **Granot Lifecycle** and can find a webhook-channel
Granot Observation Receipt. Health stays the other tab. Job Timeline
and Intakes are reached by deep link only.

## 3. Repository, branch, and prerequisites

- **Repository:** `vantage-admin` only.
- **Branch:** same Admin branch as GLS-01 when possible.
- **Prerequisites:** GLS-01 `complete` and GLS-02 `complete`. Do not
  start while either is `blocked` or `active`.
- No commit, push, deploy, or live payload read unless asked.

## 4. Current-state evidence to verify

Reverify from the GLS-01 and GLS-02 reports, not only this list.

Expected after GLS-01:

- `/granot-lifecycle` and `/granot-lifecycle/health` render Health.
- Subnav is Health only.
- Sidebar Granot Lifecycle is Owner-only.
- Admin Health exception is `/granot-lifecycle/health`.

Expected after GLS-02:

- `GET /api/v1/admin/granot-lifecycle/receipts` with spec §5/§6.
- Owner 200, Admin 403.

Also verify:

- Admin proxy `canProxyVantagePath` will 403 Admin on the new GET
  (add the rule here if GLS-02 could not, because the proxy lives in
  Admin).
- `queryKeys` has a `granotLifecycle` group. Add a receipts key.
- Live Events UI (`live-webhooks.tsx`) stays on `/live-events`.

## 5. Locked decisions and invariants at risk

- Receipts is the default Granot Lifecycle tab
  (`/granot-lifecycle` and `/granot-lifecycle/receipts`).
- Health stays at `/granot-lifecycle/health`.
- No Job Timeline / Intakes / Automation subnav items.
- URL owns filters.
- Owner labels from spec §7. No raw enum chips.
- Deep links: Job Timeline via `buildJobTimelineHref`; Intake via
  `/intakes?case=`.
- No raw payload, no requeue, no writes.
- Admin has no Receipts page and cannot proxy the list.

## 6. Deliverables and exact contract

1. **Routes.**
   `app/(dashboard)/granot-lifecycle/receipts/page.tsx`.
   `/granot-lifecycle` renders Receipts (stop rendering Health as the
   index). Health remains the other tab.
2. **Subnav.** Receipts, Health. Active states do not highlight both.
3. **Client.** `lib/api/` helper + `queryKeys.granotLifecycle.receipts`.
   Proxy through the existing Admin BFF
   (`/api/proxy/v1/admin/granot-lifecycle/receipts`). Do not invent
   an SSE BFF for this list.
4. **UI.** Filter bar + list from spec §5 and §7. Copy module for
   Owner strings. `FeedbackMessage` for load/error. Empty copy:
   “No matching Granot webhook receipts.”
5. **Filters.** All spec §5 controls, including the Booked / Release
   control that appears when event type is Booking status changed or
   unset. Source Company uses the reviewed catalog control, not a
   text box.
6. **Row actions.** Open Job Timeline when `job_no` is present. Open
   Intake when `intake_case_id` is present.
7. **Auth tests.** Admin `canAccessDashboardPath` false for
   `/granot-lifecycle` and `/granot-lifecycle/receipts`; true for
   Health. `canProxyVantagePath` Admin GET list is false.
8. **Nav tests.** Default Granot Lifecycle href still
   `/granot-lifecycle`. `pageTitleForPath` stays Granot Lifecycle.

## 7. Explicitly out of scope

- Server DTO or filter changes (fix GLS-02 if the contract is short).
- Live Events card redesign.
- Raw payload drawer or unmasking.
- Receipt requeue.
- Discrepancies tab.
- Nesting Job Timeline.

## 8. Flags and runtime posture

No new flag. Owner-only page and proxy.

## 9. Migration and indexes

None.

## 10. Acceptance criteria

- [ ] Owner Granot Lifecycle default is Receipts. Health is the
      other tab and still works.
- [ ] Filters in spec §5 are on the page and in the URL.
- [ ] Booked and Release are distinct under Booking status changed.
- [ ] Rows show masked contact, event type, Booking Action when
      present, Source Company, processing / decision, `ref_no`,
      `job_no`.
- [ ] Open Job Timeline and Open Intake render only when the ids
      exist and go to the correct hrefs.
- [ ] No raw JSON / `granot_statement` on the page.
- [ ] Admin cannot open Receipts and cannot proxy the list.
- [ ] Live Events page is unchanged.
- [ ] `pnpm test && pnpm typecheck && pnpm lint` in `vantage-admin`.
- [ ] Browser: Owner find by each filter (synthetic or local seed);
      deep links; Health tab; Admin blocked. Do not paste live
      customer contact.

## 11. Required tests and commands

```bash
cd vantage-admin && pnpm test && pnpm typecheck && pnpm lint
```

Browser proof at **http://localhost:3000**
([`../LOCAL-ADMIN.md`](../LOCAL-ADMIN.md)). Local API on **3001**.

## 12. Live/staging verification

Local Admin + local API. Do not query production receipts.

## 13. Rollback

Remove the Receipts page and restore `/granot-lifecycle` → Health.
Leave GLS-01 chrome and the GLS-02 API in place unless the user asks
to revert those too.

## 14. Required completion handoff

Report: files added; filter query params; browser steps (redacted);
proxy auth evidence; confirmation Live Events and Health still work;
docs-keeper invoked. Tick specification §7 and §12.6–12.7 in
`PROGRESS.md`.

**Unblocks:** pack complete.
