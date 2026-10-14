# Rep money and move-date presentation

October 14, 2026. Implements Phase 1 of the server's authoritative
`docs/knowledge/overnight-rep-desk-and-pool.md`. This document records the Admin contract;
the server owns aggregation, eligibility, assignment, authorization and cursor ordering.

My view shows **Booked binder** for the signed-in Rep, or the selected Rep for an Owner/Manager.
`GET /api/v1/admin/sales-outreach/rep-metrics?agent_id=…` returns current money regardless
of the historical goal day or queue filters. Rep requests omit the id by default; the server
rejects foreign ids. The BFF allows only GET through the existing Rep/Manager desk allowlist.
A new query key has no previous-Rep placeholder, and selecting another Rep remounts the card.

Today uses the current New York date. Last Week is the previous entire Monday–Sunday,
Last Month the previous entire calendar month, and All Time is unbounded official Booking
history. The UI renders the server's own stable-Agent allocation totals, labels their gross
basis (cancelled official Bookings remain included), and puts the exact date windows on
hover. Unknown allocation amounts/date coverage explicitly label affected figures as known
subtotals rather than complete totals.

**Potential binder on assigned leads** renders the server's known attached-Booking total,
independent of historical allocation credit. It is not earned commission or an exclusive
unbooked forecast. Eligible assignment scope includes FormLead and CallLead, beyond enrolled
subjects or a loaded page. Priorities 7/8/9 and ineligible/cancelled records contribute no
potential amount. Missing/dangling/mismatched links, missing amounts and ambiguous identities
have separate coverage wording. Genuine stored zero renders `$0.00`; all unknown amounts
render “No known linked binder amount”. Partial results explicitly identify the known subtotal.

The money hook uses the existing Outreach Desk live stream and fallback poll interval.
`outreach_rep_metrics` invalidates money reads; `outreach_desk` also invalidates them because
assignment and eligibility can change. Connect/reconnect/clock/configuration frames refetch
the entire scoped desk, including money. Offline and cached-error states show stale wording
with the last successful exact timestamp. There is no second money EventSource or Owner-only
Insights/Daily Operations money dependency.

My and Team expose Future (today and later), Past (through yesterday), and Unknown presets;
`move=upcoming` remains the backwards-compatible URL for Future. Existing Today/Next 7 days
presets stay available. Explicit `move_from`/`move_to`/`move_unknown` ranges compose with rep,
search, priority, workflow, state and pagination. Choosing a preset clears obsolete explicit
ranges. Team switches its attention list to the complete scoped queue when a move filter
is present. `sort=move_date` canonicalizes to ascending; the server sorts all records, dates
soonest first, null last, with stable subject id/cursor order. The browser never sorts a page.

Both queues and the selected-lead panel show calendar move ages and **Last interaction**.
Move dates remain date-only and CallLead display dates remain null; no raw CallLead date is
introduced. Interaction ages show just now, minutes, hours or days, with an exact timestamp
on hover; null says No interaction and a future timestamp explicitly says it is ahead of
current time. These labels advance every 15 seconds from server `as_of` using monotonic
elapsed time, preventing browser wall-clock skew from changing their basis. The existing
one-stream New York rollover timer now finds actual next local midnight, including 23/25-hour
days; clock frames and reconnect remain recovery paths. Qualification/cadence is unchanged:
confirmed outbound attempts, inbound answered/missed, sent/inbound SMS only; codes 2/3 remain Daily.

Validation covers DTO parsing and BFF roles, per-Rep cache separation, known/zero/unknown
rendering, full paged mock move ordering/filter combinations, URL round trips, NY midnight
at DST/year boundaries and interaction age/null/future labels. Server replica and real browser
verification are recorded in the consolidated Phase 1 handoff; this implementation document
does not claim deployment or merge success. No Pool feature or production write is included.
