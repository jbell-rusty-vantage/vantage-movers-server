# Sales Outreach Desk — consolidated policy for final approval

Prepared October 3, 2026. Questions 1–14 of this continuation are approved. Question 15 final ratification is pending. This is the readable business-policy review; [SPECIFICATION.md](SPECIFICATION.md) and [CONTRACTS.md](CONTRACTS.md) retain engineering detail, [DECISIONS.md](DECISIONS.md) retains approval provenance, and [OWNER-REQUEST.md](OWNER-REQUEST.md) preserves the original message and both screenshots.

Approved authority: P01, P02a–P02i, P03, P04a–P04d, P05a–P05h, P06a–P06f, P07a–P07g, P08a, P09a–P09c, P10a, D01 and V01/V02. All policy values and behavior controls are persisted, editable, audited, versioned and reloadable without deployment or environment-variable authority. The numbers below are approved starting values, not hard-coded invariants or automatic bootstrap defaults.

## Scope and workflow

Outreach is deterministic server code. It contains no LLM analysis, transcription, summaries, assessments, extracted promises or AI suggestions, including background dependencies. The Vantage MCP server stays. Future agent call-file retrieval/transcription/summarization is separate and outside this feature.

Reps use the desk to see assigned work, copy the Job Number and read activity history, then perform outreach in moving software/RingCentral. The desk does not infer conversation content or customer intent. Accepted priority facts, verified call/SMS metadata, explicit human schedules, restrictions and assignment drive its rules. Existing automated confirmation metrics stay separate from rep outreach credit.

## Calendar and New cadence

Use America/New_York dates and date-resolved DST offsets. Received date is Day 1; calendar age advances through every date, including Quoted periods, absences, restrictions and closed dates. Working hours initially run Monday–Sunday, [08:00,20:00). No automatic holidays; the Owner may explicitly close future dates.

| Lead age | Required calls per full working date | Required SMS |
| --- | --- | --- |
| Days 1–3 | Two; third optional | One each date |
| Days 4–5 | Two | None |
| Day 6 onward | One | Fixed Days 6, 9, 12, 15… |

On full dates with two calls, first is due by 12:00 and second by 20:00. Single calls and scheduled SMS are due by 20:00. Optional third calls never create misses. SMS uses fixed Days 1/2/3/6/9/12 onward; extra sends and missed sends do not move future dates.

New initial response is one call within 30 working minutes of normalized receipt. Unused working minutes carry across closing/closed dates. On the arrival date, this replaces the noon deadline. Before 18:00 arrival requires two calls; 18:00–19:30 inclusive requires one; later arrival requires zero ordinary calls that date. SMS arrival allowance ends at 19:30 inclusive. An after-19:30 waiver does not create extra next-date quota. A carried initial response can satisfy one applicable next-date ordinary call.

Examples: 10:00 arrival → first due 10:30, second by 20:00; 19:30 arrival → one call and one SMS before closing; 19:45 arrival → ordinary arrival quotas waived, initial response due next opening at 08:15; 21:00 arrival → first response next opening at 08:30.

Routine contacts start before 20:00. Explicitly closed dates waive routine channel quotas without misses, pause working-minute clocks, keep age advancing and leave the fixed SMS sequence unchanged.

## Attempts, timing and evidence

An actual outbound attempt may qualify whether answered, no answer, busy or voicemail. A provider-confirmed failed connection qualifies only if there was an actual attempt; an API error/button press alone does not. Canonical terminal external evidence, reviewed actor identity and uniquely verified eligible opportunity association are required. Duplicate receipts/legs, internal calls and in-progress calls create no completed credits; uncertain evidence is pending, not guessed.

One call supplies at most one applicable ordinary cadence credit and one outbound-goal credit. Helping-rep contacts may cover the assigned lead; outbound goal belongs solely to the initiator, including transfers. Answered inbound handled by any reviewed sales rep may supply one applicable cadence/catch-up credit, with zero outbound-goal credit. Missed inbound supplies neither and creates no automatic separate callback obligation.

Cadence-crediting call starts initially require 60 elapsed minutes of spacing on the Lead; inbound uses verified reviewed-rep answer/handling time for this purpose. Too-close actual outbound retries may earn goal credit but no additional cadence credit, and do not reset the anchor. Three unsuccessful attributable attempts in rolling 24 hours show a warning, not a hard pause. Unsuccessful means the customer was not reached, not that the rep failed the attempt requirement.

Outbound uses verified start time; answered inbound uses reviewed-rep handling time; SMS uses confirmed sent time. A 19:59 outbound ending 20:10 can fulfill that date's ordinary requirement once confirmed. Daily outbound goals cover the full New York date, including after hours: Friday 23:58 start ending Saturday belongs to Friday. Ordinary cadence requires an open requirement and permitted ordinary hours; no prepayment of future quotas. Qualifying after-hours contact can clear existing channel catch-up or an unfinished initial response. An explicit callback has its own appointment window.

The verified answered inbound that created a uniquely associated Call Lead satisfies initial response and may satisfy one applicable arrival-date call; it contributes no outbound goal. Outbound contrary to an active contact restriction remains history with zero cadence/goal credit.

Rep SMS must be deliberately initiated by a reviewed rep, including a helper or manually sent template, and confirmed sent or delivered. Queued/pending, API acceptance only, failures, unattended automation, automatic confirmations and inbound replies do not qualify. A later confirmed delivery failure revokes that message's credit and recomputes the affected SMS work. Shared-sender ambiguity stays pending. SMS never earns outbound-call goal credit.

Late/corrected evidence credits actual event time and verified historical policy/identity, with audit and bounded recomputation. It removes an apparent miss disproven by on-time contact, preserves a genuine late-contact miss, and moves a corrected initiator's single goal credit rather than duplicating it. Capture date never receives another credit.

## Priority, intake and eligibility

| Accepted Granot priority | Routine behavior |
| --- | --- |
| 0 | New |
| 1 | Quoted |
| 3 | Rep discretion; No routine cadence |
| 5 | Stop/cancel routine work as Booked in Granot; never fabricate an official Booking |
| 7 | Preserve CRM bad/unusable disposition closure |
| 8 | Preserve CRM dead-opportunity disposition closure |
| Accepted unmapped code | Stop prior routine work; No policy configured and Owner review |

Accepted canonical webhook, browser extension and HTTP automation mutations use the same server-owned mapping. Priority changes supersede prior routine requirements/debt without reporting fulfillment; retain actual missed/contact history. Repeated identical accepted priority does not restart the schedule. Stronger official/Owner closures require authorized reopening.

Fresh eligible website Form Leads, Best Relocation intake, RingCentral Call Leads and manual intake start New under a visible intake default when accepted priority is absent. This never writes/fabricates Granot Priority 0. Granot-created missing/invalid priority goes to review without guessed cadence. Existing missing/malformed/unverified updates retain the last verified policy and timeline with uncertainty displayed. Historical imports follow cutover, not fresh-intake defaults.

Duplicate Leads receive no separate cadence/duplicated credit. Existing Bad Lead, official Booking/Cancellation, CRM and Owner closures remain protected. Viable No-Sync Leads are eligible because No-Sync controls reporting. Legacy no_sync closure behavior intentionally differs; already-closed records require review and authorized reopening. Form Fill alone neither excludes nor merges a Call Lead. Unmatched Booking-anchor Call Leads and number-only records have no automatic cadence. Shared phone numbers do not establish a merge or multiply one contact across opportunities; ambiguous association stays pending.

A passed or missing move date does not stop cadence or imply closure. Show Move date passed—review or Move date unknown. Correcting the date does not restart age/history.

## Reentry and Quoted dates

New reentry from Quoted, Priority 3 or an unmapped code keeps original age. Subtract earlier qualifying same-date calls while New/Quoted was active from the ordinary age-based quota, then cap remaining calls by return time: before 18:00 up to two; 18:00–19:30 inclusive up to one; later zero. Day 6 onward still caps at one. Return-date calls are due 20:00 with spacing; no retroactive noon miss. SMS applies only on a fixed sequence date with return at/before 19:30; earlier qualifying same-date SMS satisfies it. No fresh initial-response clock or revival of superseded debt. Tomorrow uses ordinary age-based rules.

Quoted requires one call per working date from the selected follow-up date. Assigned Rep, authorized Manager and Owner may schedule/reschedule with audit. Future working dates are allowed; today is allowed through 19:30 inclusive; past/closed selections are rejected. Same-date selection opens at the later of command time/opening with no retrospective credit/miss. Selected dates open at 08:00, due 20:00, then daily. A later Owner closure retains the selected date/audit but waives that quota, resuming normal work next working date.

Without a selected date, new/reentered Quoted starts next working date strictly after entry; no extra entry-date call. Repeated Priority 1 does not restart it. Rescheduling does not erase genuine misses or stack daily quotas.

## Explicit callbacks and precedence

Assigned Rep, authorized Manager or Owner may deliberately enter a date/time, displayed in New York time. This is an approved refinement beyond the Owner's original date-selector request. One active human follow-up plan exists per Lead; explicit audited replacement prevents conflicting schedules.

A timed callback suspends unfinished routine Call requirements and Call catch-up prompts until the appointment, retaining prior genuine misses. SMS continues unless restricted. The appointment date requires one callback attempt and no additional routine calls; ordinary age-based cadence resumes next working date. Requirement opens at selected time with deadline 15 elapsed minutes later. Earlier calls do not automatically fulfill it. An otherwise qualifying actual outbound attempt within that window fulfills it even if unanswered; answered inbound within the window can fulfill it without goal credit. Late qualifying contact clears it while preserving the genuine missed deadline. Explicit after-hours appointments permit that callback; restrictions still override.

Precedence is authoritative closure → channel restriction → explicit human schedule → accepted routine priority cadence. Goal totals never override it. Closure ends callbacks/routine work; nonterminal priority changes preserve human callbacks, including Priority 3/unmapped transitions. Reassignment carries the pending callback. A genuine missed unblocked callback remains overdue while next-date routine cadence resumes; one later relevant qualifying call may clear it and one ordinary requirement with one applicable goal credit.

A restriction preventing an appointment yields Callback blocked—rescheduling needed, without a restriction-caused callback miss. Earlier genuine misses remain. An unanswered inbound never silently creates another appointment.

## Restrictions, catch-up and responsibility

Earlier routine misses coalesce into at most one actionable catch-up per channel, preserving each historical miss and oldest actionable deadline. Next qualifying channel contact can clear catch-up and satisfy one applicable ordinary requirement, never duplicate goal credit or move SMS dates. Channels cannot clear each other's work.

Genuine restrictions waive unfinished affected-channel routine requirements when taking effect, with no new misses/debt during prohibition. Preserve earlier genuine misses/catch-up history but block prohibited prompts. Ordinary quotas resume the next working date on/after release when released at/before opening; release after opening resumes ordinary quotas the following working date. Permitted contact can occur immediately after release. Unfinished initial-response working minutes pause during prohibition and resume when calling is permitted. Preserve age and fixed SMS; a call-only restriction does not block SMS.

Assignment never resets age, deadlines, completed contacts, spacing or catch-up. Unassigned deadlines continue in the Owner/Manager queue without charging a rep. New owners inherit remaining work with Inherited overdue distinguished from their own missed deadlines. Each genuine historical miss retains the responsible rep or Unassigned at that deadline; goal credit stays with the actual initiator.

## Goals and permissions

Select active goal-roster reps explicitly; include scheduled reps at zero calls. Default is 100 per scheduled working date. Owner sets base roster/goals/work schedules; Owner/Manager may enter prospective absence goal 0 or an explicit partial-day number. No automatic partial-day prorating. Team goal sums individual goals; actuals remain visible above goal with bars capped at 100%. Zero-goal days show No goal today, retain actuals and are excluded from reps-at-goal denominator. Actual totals include the selected reps' qualifying activity even on zero-goal dates. Absence does not pause lead cadence; flag work for reassignment. Historical corrections require explicit audited Owner edits.

Admin means the trusted Owner full-authority role for this feature, not automatic elevation of generic Admin accounts. Manager can read all rep/Unassigned queues and activity, assign/reassign, edit Quoted dates/callbacks, record prospective absence/partial-day overrides, and access Daily Operations. Advanced policy/base goals/roster/work schedules, lifting restrictions, overriding closures, historical responsibility/goal settings and activation/migration/rollback remain Owner-only. Rep reads only current assigned Leads. Prove exact account/capability binding and reassignment revocation.

## Desk and cutover

Default Needs contact sorts actionable overdue first, then next action due. Keep Call/SMS deadline/completion/overdue independent. Show Job Number with phone directly beneath, Copy job # and read-only history. Show missing/pending coverage honestly instead of false zero or Synced. Preserve overdue lead visibility after 100 calls.

Admin/Manager team desks look nearly identical, using the Owner screenshots' soft rounded composition, spacing, hierarchy and selected-lead panel; advanced controls depend on permissions. Rep uses the assigned-lead frame. Rendered comparison at 1186 × 742 plus responsive/focus/accessibility/live-update checks remains required. Screenshot sample counts are not policy.

Cutover uses a fixed cohort activation boundary. Preserve reliable original age; uncertain age goes to review. No new-policy preactivation misses/debt, no fresh initial-response clock for old Leads. New uses partial-day allowances and verified same-date credit. Quoted preserves verified future human dates; active schedules can owe one activation-date call through 19:30, due closing; no verified selected schedule uses next-working-date default. Preserve verified pending human callbacks/restrictions; past-due legacy callbacks go to review without automatic new-policy penalties. AI plans/summaries/suggestions never migrate into actionable work. Launch-day goals use verified calls for that date; reductions require explicit override. Reruns cannot reprice the boundary.

## Final approval and remaining engineering proofs

Questions 1–14 resolve all substantive policy choices. Question 15 ratifies this consolidated policy; it does not deploy or activate it. Until separately authorized and proven, runtime controls remain false, migration remains paused and no live migration/provider/customer-send operation is permitted by this documentation interview.

Engineering must prove provider timestamp/status/origin/initiator/handling/association and every intended SMS mailbox, historical priority/assignment/age quality, server/BFF/stream authorization, configuration reload/CAS/versioning, no legacy/AI competing producers, synthetic boundary/DST and replica/browser behavior, Daily Operations live/rebuild parity, actual latency/capacity/headroom and migration/reconciliation/rollback. Missing evidence becomes pending/review or blocks the affected release cohort, not a guessed policy. Reserve at least 40% capacity and S5–S7 for rehearsal, backfill/catch-up, reconciliation, readiness and rollback.

Packet validators establish hashes, portable links and synthetic expectations only. They do not prove deployed behavior, provider grants, visual acceptance or production readiness.
