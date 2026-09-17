# End-to-end acceptance walkthrough

Use synthetic fixtures and an isolated test database/Preview. Each scenario records expected versus actual outcome and a screenshot or API/audit artifact. Full matrix: [06 §3](../06-delivery-plan-and-acceptance.md#3-required-acceptance-matrix). This file is a future execution checklist, not a claim these tests ran during specification editing.

1. **Lead arrival and coverage.** Create eligible Form Lead at 19:50 Saturday. It appears immediately; 30 staffed minutes expires Monday 08:20 with the accepted schedule. Show actual coverage and staffed/wall age. Missed inbound at the same time has its 15-minute deadline Monday 08:05; repeat misses do not move it.
2. **Inbound work.** Customer calls after Form Lead arrival and speaks to one mapped rep. Mark worked, stamp human contact, fill unassigned ownership. Provider-connected unknown, voicemail, and missed inbound do not pretend this happened.
3. **Full envelope.** A 20-second recording or customer voicemail contains a clear request, price and move fact. The scoped MCP agent retrieves relevant Lead/Booking context, submits typed findings and summary, and creates permitted work without Owner acceptance or an exact-locator gate.
4. **Multiple obligations.** Rep promises estimate today and callback Friday, plus check availability without a date. Three actions remain; the undated one is Needs review. Callback attempt No answer completes only the callback. Customer later confirms receipt to complete the estimate with provenance.
5. **Responsibility.** Alex owns Outreach; Jordan promises a callback. Jordan owns that action. Owner assigns that action to Casey; later model output cannot undo it. Promised by Jordan remains factual. Lead receiver and Booking allocations are unchanged.
6. **Waiting.** Clear “I'll call Friday” creates day-only customer wait with visible end-of-sales-hours default. No inbound by close returns to Attention next sales opening. Customer calling unanswered first ends wait and creates Missed call—callback needed. Other rep actions are never hidden by a customer wait.
7. **Owner control.** Correct the callback date while AI is paused and an old run is in flight. New date is immediate. Old output is blocked by revision/Owner precedence. Reanalysis records Agrees/Disagrees/Cannot determine. Confirm analysis does not duplicate a follow-up; fresh assertions are not automatically confirmed.
8. **Restrictions and closure.** “Don't call again” pauses call actions, preserves existing plan, and opens review without automatic close/texting. Owner Close cancels active actions with history. Later missed call/request opens review without reopening. Official Booking closes deterministically even during identity review.
9. **Ambiguity and missing Booking.** Two overlapping Lead candidates permit number analysis but no Lead-specific effects. Owner resolves attachment in Sales Intelligence. “We booked” with no official Booking opens review; official changes use existing Vantage workflow.
10. **No Lead.** Short mapped sales inbound and reviewed Sales Rep outbound qualify. Clear sales request opens Number Review, never a Lead. Internal/company and known non-customer traffic is excluded from automatic sales analysis.
11. **Durability.** Replay webhook/Call Log pages/submission/jobs, expire a lease, and race Owner edit against application. One interaction and one semantic obligation remain. Newer evidence invalidates obsolete effects. Queue publish failure is recovered from Mongo work.
12. **History.** Backfill an old promise after a later fulfilled callback/Booking. No new overdue work. Original-evidence rerun replays captured data; current-context run captures newer data. Partial history is visible. Retention removes source copies in prompts/snapshots and disables unavailable original-evidence rerun.
13. **Budget and unavailable audio.** Exhaust the $80 admission budget or deny recording access. Operations continue; stage/reason/backlog is visible. Raising cap resumes the saved stage, not duplicate STT or effects. No recording is not No calls.
14. **Owner message and UI.** Explicit preview/send targets reviewed rep, never customer. Retry uses same key; unknown delivery stays unknown until repaired. Default Attention shows one item/all reasons, review-only closed work, linked records, exact outcomes and distinct action/Outreach owners.

## Evidence record

For each numbered scenario: fixture/version, run id, request/response or UI artifact, audit/effect rows, commands actually run, pass/fail, gap and responsible team. Record secrets nowhere. Capability failures and untested live sends are labelled separately from passing synthetic tests.

## Codebase integration acceptance

- Dedicated scoped API key AND signed run token required; general MCP tools unavailable; expired/wrong-subject/wrong-dataset tokens denied.
- Admin denied on all CSI methods; Owner commands preserve Idempotency-Key through BFF; conflicts normalize safely and refetch without silent overwrite.
- Current-records browser scope enforced without resetting global preference; historical/combined rejected; isolated preview database and environment-scoped queues proved separately.
- Per-party sequencing, account identity aliases, transferred recordings, existing conversation migration and immutable media covered.
- SSE streams rather than buffers; reconnect/gaps refetch; Attention snapshot expiry refreshes.
- Exact run evidence survives newer analyses; purged versions show tombstones; no demo replay claim in live panel; signed audio fetched on Play.
- Snooze retains original lateness, other active reasons remain; waits expire once; repeated missed calls keep earliest unresolved deadline.
