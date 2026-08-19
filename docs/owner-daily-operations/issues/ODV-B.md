# Unit B — Leads, Completed Bookings, Completed Cancellations, and the detail drawer

> **Contract maturity: implementation-ready.** Implementation-blocked until ODV-A lands. This unit delivers the three browse tabs and the detail drawer, including the provenance chain. It reuses the existing Granot timeline projection rather than building a second evidence chain.

## 1. Authority and required reading

- **Specification:** challenge 0.6, §3.2, §3.3, §3.5, §6.4, §6.6, §6.8, §8. The specification wins on every conflict.
- **Wireframes (illustrative only):** `owner-daily-view-planned.txt` §3, §4, §4a, §6, §7.
- **Must read before writing a line of the drawer:** `src/services/granotLifecycle/projections.ts` lines 87–180 — `GranotTimelineEntry`, `GranotTimelinePage`, `paginateTimeline`, `compareTimelineEntries`. This unit renders that projection; it does not replace it.
- **Existing seam:** `projectGranotLeadTimeline(lead_model, lead_id, query)` and the route `GET /api/v1/admin/leads/:lead_model/:lead_id/lifecycle` already exist and already work.
- **Admin conventions:** `components/ui/side-panel.tsx`, `components/granot-lifecycle/job-timeline.tsx`, `lib/api/filters.ts`, `lib/api/url-state.ts`.

## 2. Objective

Deliver the Leads tab (segmented Form/Call), the Completed Bookings tab, the Completed Cancellations tab, and the right-side detail drawer with its Details and Provenance tabs. Establish the drawer shell that Unit E extends with a Conversation tab. Prove that the provenance chain the Owner asked for is the existing `GranotTimelinePage`, rendered — not a new construct.

## 3. Repository, branch, and prerequisites

- **Repositories/branches:** `vantage-main-server` and `vantage-admin` on the sprint branch.
- **Prerequisite:** ODV-A complete — window contract, capability projection, cursor convention, shell, and `queryKeys.ownerDaily`.
- Reverify the four window indexes from ODV-A exist on the test database before performance work.
- Redacted synthetic data only. `TEST_MODE=true`. No commit, push, deploy, production apply, live payload read, or external send.

## 4. Current-state evidence to verify

Observed 2026-08-19; reverify at implementation:

- `projectGranotLeadTimeline` exists and returns `GranotTimelinePage` with `items`, `next_cursor`, `current`, and `capabilities`. It is already masked and already cursor-paginated.
- `GranotTimelineEntry` is a discriminated union with `type_priority` values 10, 20, 30, 40, 50, 60, 70, 80, 90, 100. **Priorities 15 and 85 are unused and reserved by the specification for Units D/E.** Do not consume them here.
- `SafeBookingProjection` and `SafeCancellationProjection` already exist in `projections.ts` and are already safe to return.
- `components/ui/side-panel.tsx` is a fixed-inset overlay with `max-w-3xl`, no resize, no deep-link support.
- `FormLead` carries `ref_no`, `bad_lead`, `duplicate`, `quoted`, `receiver_agent*`. `CallLead` carries `ringcentral.*`, `duration`, `receiver_agent*`. `BookedLead` carries `book_date`, `agent_allocations`, `deposit_amount`, `total_binder_amount`. `CancelledLead` carries `booked_lead`, `cancel_date`, `refund_amount`, `reason`.
- Existing operational list views use `page`/`limit`; this pack uses the opaque cursor from ODV-A. Do not mix the two.

## 5. Locked decisions and invariants at risk

- **One provenance chain.** The drawer renders `GranotTimelinePage`. Building a second chain, a parallel event list, or a client-side merge of raw collections is forbidden.
- **`activity_at` binds; business date is displayed.** Completed Bookings shows `Recorded` (bound) and `Book date` (displayed) as two columns, always. Same for Cancellations.
- **Masked in lists, full in the drawer, Owner only.** `maskContactLabel` in every list payload. Full contact appears only in a drawer response to an Owner.
- **Overlay drawer, not a split pane.** Specification §6.8 records the reasoning. Deep-linked via `?open=<kind>:<id>` so it survives refresh.
- Timeline entries carry **no** transcript text, **no** summary text, and **no** unmasked phone. `assertProjectionSafe` enforces it.
- Read-only. No Command, Change, revision, outbox, or case effect.

## 6. Deliverables and exact contract

### 6.1 Routes

```text
GET /api/v1/admin/owner-daily/leads
      ?window=24h|48h &kind=form|call &q &booked=true|false
      &source_id &cursor &limit
GET /api/v1/admin/owner-daily/completed-bookings
      ?window &q &agent_id &merchant_id &cursor &limit
GET /api/v1/admin/owner-daily/completed-cancellations
      ?window &q &reason &cursor &limit
GET /api/v1/admin/owner-daily/detail/:kind/:id ?window
```

`:kind` is exactly `form_lead | call_lead | booking | cancellation`. All Owner-only. `limit` is 1–100, default 50. Unknown query keys reject with the ODV-A error envelope.

### 6.2 List item shapes

```ts
export type DailyLeadListItem = {
  id: string;
  kind: "form_lead" | "call_lead";
  activity_at: string;
  masked_label: string;
  source_company_label: string | null;
  source_granularity_label: string | null;
  job_no: string | null;
  ref_no: string | null;
  status: "open" | "booked" | "cancelled" | "bad_lead" | "duplicate";
  booking_ref: string | null;
  conversation: {                 // null until ODV-D writes records
    state: "complete" | "in_flight" | "failed" | "none";
    duration_seconds: number | null;
    conversation_id: string | null;
  };
};

export type DailyBookingListItem = {
  id: string;
  activity_at: string;            // BookedLead.timestamp — the bound
  book_date: string;              // displayed, never the bound
  job_no: string | null;
  masked_customer_label: string;
  agents: Array<{ name: string; binder_amount: number }>;
  total_binder_amount: number;
  deposit_amount: number;
  merchant_label: string | null;
  cancelled: boolean;
};

export type DailyCancellationListItem = {
  id: string;
  activity_at: string;            // CancelledLead.createdAt — the bound
  cancel_date: string;            // displayed, never the bound
  booking_id: string;
  job_no: string | null;
  masked_customer_label: string;
  refund_amount: number;
  reason: string | null;
  cancelled_by: string | null;
};
```

Every list response carries `{ items, next_cursor, window }` and a window-scoped totals footer where the wireframes show one.

The `conversation` field ships in this unit as a constant `{ state: "none", ... }`. Unit D populates it. Declaring it now avoids reshaping the list contract and the table column later.

### 6.3 Detail payload

```ts
export type DailyDetailResponse = {
  kind: "form_lead" | "call_lead" | "booking" | "cancellation";
  id: string;
  window: DailyWindowEcho;
  entity: Record<string, unknown>;   // explicitly projected, never $$ROOT
  contact: { name: string | null; phone_number: string | null; email: string | null };
  related: {
    booking?: SafeBookingProjection;
    cancellation?: SafeCancellationProjection;
    lead_ref?: { model: "FormLead" | "CallLead"; id: string };
  };
  timeline: GranotTimelinePage;      // from projectGranotLeadTimeline / projectGranotJob
  conversations: [];                 // ODV-E populates; empty array here
};
```

`entity` is an explicitly enumerated projection per kind. Reuse `projectGranotLeadTimeline` for lead kinds and `projectGranotJob` for booking/cancellation kinds keyed by `normalized_job_no`. **Do not write new timeline composition logic.**

### 6.4 Admin

| Path | Deliverable |
| --- | --- |
| `components/daily/leads-tab.tsx` | Segmented All/Form/Call, server search, filters as URL state, `useInfiniteQuery` |
| `components/daily/completed-bookings-tab.tsx` | Two-date table, window totals footer |
| `components/daily/completed-cancellations-tab.tsx` | Two-date table, window totals footer |
| `components/daily/detail-drawer.tsx` | Overlay shell, tab strip, deep-link via `?open=`, resize persisted to local storage |
| `components/daily/detail-details-tab.tsx` | Formatted entity state |
| `components/daily/detail-provenance-tab.tsx` | Renders `GranotTimelinePage` — **shared component, reused by ODV-G** |
| `lib/api/ownerDaily.ts` | Extend with the four fetchers |

Extend `components/ui/side-panel.tsx` to `max-w-4xl` with an optional drag handle rather than forking it. Other consumers must keep their current behaviour.

Search is debounced and server-side. Filters and the open drawer are URL state so the view is shareable and refresh-stable.

## 7. Explicitly out of scope

- The Conversation drawer tab and any transcript, summary, or audio rendering — ODV-E.
- Populating `conversation` on list items — ODV-D.
- Timeline entry types 15 and 85 — ODV-D and ODV-E own them.
- Live updating of these lists — ODV-C.
- Intake tabs — ODV-G. Agent metrics — ODV-F.
- Any mutation, including bad-lead marking. The drawer links to the existing full record page for edits.

## 8. Flags and runtime posture

No new flag. Granot flags read-only and unchanged. All three tabs render correctly with every Granot effect flag false — the timeline simply contains fewer entry types.

## 9. Migration and indexes

**No new index.** This unit consumes the four ODV-A window indexes plus existing lead, booking, and cancellation indexes. If profiling shows a filter combination that is unserved, report it in the completion handoff as a follow-up rather than adding an index under this issue.

## 10. Acceptance criteria

- [ ] Completed Bookings displays `Recorded` and `Book date` as separate columns, and a Booking with `book_date` 14 days ago and `timestamp` 1 hour ago appears in the 24h pane.
- [ ] Completed Cancellations displays `Recorded` and `Cancel date` as separate columns with the same rule.
- [ ] The Provenance tab is rendered from `GranotTimelinePage`. Grep proves no second timeline composition exists in `ownerDaily` or in Admin.
- [ ] Timeline entries in every response pass `assertProjectionSafe`.
- [ ] List payloads contain **no** unmasked phone, email, or full name. Drawer responses contain full contact and are Owner-only.
- [ ] `?open=call_lead:<id>` deep-links to an open drawer after a hard refresh; closing it clears the parameter.
- [ ] Cursor pagination is stable across a page boundary when two records share an `activity_at` — the `_id` tiebreak is proven by a fixture with identical timestamps.
- [ ] Changing a filter resets pagination to the first page.
- [ ] The Leads tab `Conv.` column renders `—` for every row, with no runtime error from the constant `conversation` shape.
- [ ] Extending `side-panel.tsx` does not change the rendered width or behaviour of its existing consumers.
- [ ] No Command, Change, revision, outbox row, case, or notification is produced by any request in this unit.

## 11. Required tests and commands

```bash
pnpm test
pnpm typecheck
cd ../vantage-admin && pnpm test && pnpm typecheck && pnpm build
```

Focused tests:

- `leads.service.test.ts`, `completed.service.test.ts` — window binding, the two-date acceptance case as a named test, filter combinations, cursor stability with duplicate timestamps.
- `detail.service.test.ts` — each of the four kinds returns its projection and a timeline; `assertProjectionSafe` passes.
- Masking test: assert list payloads contain no value matching a phone or email pattern.
- Route tests: Owner-only gating, unknown-key rejection, `:kind` enum rejection.
- Admin: drawer deep-link round-trip, filter reset, infinite-scroll append.

Zero-mutation proof as in ODV-A.

## 12. Live/staging verification

Preview deploy both repositories. Verify against seeded test data: the two-date columns; a drawer opened by deep link; the provenance chain rendering real timeline entries; infinite scroll across a page boundary. Capture deployment ids.

**No production deploy, no live payload read.**

## 13. Rollback

Remove the three tab components from the shell tab list — the routes become unreachable while the drawer and shell survive. Then unmount the four routes. `side-panel.tsx` changes are additive and can stay. No data was written.

## 14. Required completion handoff

Report: files added; test and typecheck output for both repositories; the grep proving one timeline implementation; the masking assertion output; preview deployment ids; explicit confirmation of zero mutation.

**Unblocks:** the drawer shell that ODV-E extends, and the shared provenance component ODV-G reuses.
