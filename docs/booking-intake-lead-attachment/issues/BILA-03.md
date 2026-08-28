# BILA-03 — Connect Booking to Lead from the Bookings tab

> **Contract maturity: implementation-ready.** Session 3. The Owner selects
> a Leadless Booking on `/bookings`, searches eligible Leads with the same
> Form submitted vs Granot story, connects one, and that command writes
> EntityChange plus Sheet Sync. **Not Booking Lead Reconciliation.**

## 1. Authority and required reading

- **Pack specification:** [`../booking-intake-lead-attachment-specification.md`](../booking-intake-lead-attachment-specification.md)
  — §6, §7 (Connect row), §8, §9.3, §9.4 (Bookings browser steps 7–11),
  §12.3. Wins on the Bookings-tab UX.
- **Command shapes:** [`../../granot-lead-lifecycle/owner-booking-intake-and-lead-attachment-specification.md`](../../granot-lead-lifecycle/owner-booking-intake-and-lead-attachment-specification.md)
  §7 — wins on eligibility, transaction steps, Sheet Sync operation name
  `booked_lead.connect_lead`.
- **Pack rules:** [`../README.md`](../README.md), [`../AGENT-PROTOCOL.md`](../AGENT-PROTOCOL.md)
- **Prerequisites:** BILA-01 `complete` (shared helper + `known_contacts`).
  BILA-02 `complete` (a Granot Leadless Booking is a legal official Booking).

## 2. Objective

Give the Owner a Bookings-tab flow: find a Leadless Booking → open it →
search Leads → connect. The server claims the Lead, clears leadless,
mirrors booked onto the Lead, writes EntityChange, and queues
`booking_chain`. The booking the Owner selected stays on screen the
whole time.

## 3. Repository, branch, and prerequisites

- **Repositories:** `vantage-main-server` then `vantage-admin`.
- **Branch:** same as BILA-01 / BILA-02.
- **Prerequisites:** BILA-01 and BILA-02 `complete`.
- Ordinary checks use redacted synthetic data.
- No commit, push, deploy, production flag change, or live payload read.

## 4. Current-state evidence to verify

Observed 2026-08-28; **reverify at implementation**.

- `POST /api/v1/admin/bookings/:bookingId/connect-lead` does not exist.
- `GET .../connect-lead-candidates` does not exist.
- Admin `canProxyVantagePath` has no Connect paths.
- `/bookings` is `OperationalResourcePage` with columns Book Date / Job /
  Customer / Phone / Source / Binder / Deposit / Merchant / Cancelled
  and a Leadless filter. No Stored-lead chip. Detail has no Connect
  section.
- `/bookings/reconciliation` uses `bookingLeadReconciliation.ts`. Do not
  mount Connect there.
- BILA-01 should have left a shared chip/cards helper and
  `known_contacts` on intake candidates. Reuse both.
- BILA-02 should have made Granot Leadless Bookings official. If update
  still rejects `is_leadless_booking`, stop and reopen BILA-02.

## 5. Locked decisions and invariants at risk

- Connect is a new Owner command, not Confirm and not
  `attach_existing`.
- Primary surface is `/bookings` detail, in place. The booking stays
  visible while the Owner searches.
- Search is any-known-contact via the shared path lists. Prefer
  empty-until-typed.
- Eligibility is server-owned (pack spec §6.4). Client never “attaches.”
- Referral never Connects. Cancelled never Connects.
- Do not rewrite official Binder, Agents, Deposit, Merchant, or book date.
- Do not rewrite CPL (`preserveExistingCpl`).
- One coalescible `booking_chain` / `booked_lead.connect_lead`.
- Owner copy never claims the sheet row is already visible.
- Same `known_contacts` shape as intake. Headline stays Form submitted.

## 6. Deliverables and exact contract

### 6.1 Server

1. `GET /api/v1/admin/bookings/:bookingId/connect-lead-candidates`
   — Owner-only. Filters to eligible unbooked Leads. Form `q` uses the
   shared path lists. Returns `known_contacts`. Booking must itself be
   a connectable Leadless Booking or the GET fails closed.
2. `POST /api/v1/admin/bookings/:bookingId/connect-lead`
   — `connectBookingToLead` as pack spec §6.3–§6.5.
3. Booking-command gate. Flag-off is 422 `POLICY_BLOCKED`.
4. `Idempotency-Key` on POST. Exact replay returns the durable result.

### 6.2 Admin

1. Proxy: Owner-only GET + POST for the new paths. Tests in
   `authorization.test.ts`.
2. `/bookings` table: **Stored lead** column / **No stored lead** chip
   per pack spec §6.6. Existing Leadless filter stays.
3. Booking detail: **Stored lead** section after Summary.
   - Attached: same Form submitted / Granot cards as intake.
   - Leadless non-referral: empty state + **Connect a lead**.
   - Referral / cancelled: no Connect.
4. In-place search + review + **Connect lead**. Booking facts stay
   visible above the search.
5. Override reason when the selected Lead is out of the Booking's
   Source Scope / source assignment.
6. Success invalidates bookings list/detail (and the connected Lead
   queries). Copy: Master Leads and Master Booked will update.
7. Optional `connect=1` (or the operational page’s existing detail
   query) may open search already expanded. No second route.

## 7. Out of scope

- `/bookings/reconciliation` changes.
- Connect on `/intakes` or Daily Completed.
- Auto-creating a Lead.
- Changing Confirm, even Binder, or scored search.
- New Mongo indexes unless candidate latency is proven.

## 8. Tests

Pack spec §9.3 plus proxy ACL tests. Browser steps 7–11 in §9.4.

## 9. Knowledge updates after this issue ships

- `docs/knowledge/services/bookings.md` — Connect Booking to Lead
- `docs/knowledge/granot-lifecycle/owner-booking-intake.md` — Bookings
  tab is the Connect surface
- `vantage-admin/CONTEXT.md` and
  `vantage-admin/.cursor/rules/project-organization.mdc`

## 10. Acceptance criteria

- [x] POST attaches one eligible unbooked Lead, clears leadless, mirrors
      booked on the Lead, writes EntityChange for Booking and Lead, and
      enqueues `booking_chain` / `booked_lead.connect_lead`.
      Evidence: `connectLead.test.ts` happy path + sheet intent; replica names in the report (skipped unless flag on).
- [x] `already_satisfied` on the exact same Lead. `IDENTITY_CONFLICT` if
      the Booking already has a different Lead or the Lead is already
      booked.
      Evidence: `connectLead.test.ts`.
- [x] Referral, cancelled, Duplicate, Bad, and `created_on_unmatched`
      Call Leads are rejected. Stale booking revision fails closed.
      Evidence: `connectLead.test.ts`.
- [x] Candidates `q` hits snapshot paths. Ineligible Leads never appear.
      Empty `q` does not dump the whole book.
      Evidence: `connectLeadCandidates.test.ts`.
- [x] Proxy: Owner can GET/POST; Admin role cannot.
      Evidence: `authorization.test.ts`.
- [x] `/bookings` shows **No stored lead** on leadless non-referral rows.
      Detail Connect flow matches pack spec §6.2. Referral and cancelled
      have no Connect.
      Evidence: browser step 7 and 9; `booking-stored-lead.test.ts`.
- [x] Search rows show Form submitted vs Granot / **Changed in Granot**.
      Headline stays Form submitted.
      Evidence: browser step 8 (job search; Form submitted + Granot + cycle line). **Changed in Granot** is wired when `differs_from_ingested` is true (`connect-lead-panel.tsx`).
- [x] Success copy does not say the sheet already updated.
      Evidence: `BOOKINGS_CONNECT_COPY.success`; browser review did not claim a sheet update.
- [x] `/bookings/reconciliation` and `/form-leads` unchanged.
      Evidence: browser steps 10–11.
- [x] Browser steps 7–11 in pack spec §9.4 pass.
      Evidence: `reports/BILA-03-completion.md` (no live Connect submit).

## 11. Commands

```bash
pnpm test
pnpm typecheck
cd ../vantage-admin && pnpm test && pnpm typecheck
```

Plus the browser walk for steps 7–11. Paste output in the report.

## 12. Risks

- Mounting Connect on the employee reconciliation page.
- Client-side attach that skips eligibility.
- Rewriting official money / agents on connect.
- Saying the sheet is already synced.

## 13. Rollback

Unmount the Bookings Connect section first (removes the affordance),
then unmount the routes. Existing connections remain valid Mongo
documents. No production enablement is part of this issue.

## 14. Handoff list for the completion report

- Command test names and results (happy, replay, rejects).
- Candidate filter evidence (snapshot path + eligibility).
- Proxy ACL evidence.
- Browser notes for steps 7–11.
- What you did not do (`/intakes` Connect, Daily, reconciliation).
- Any §4 drift you corrected.
