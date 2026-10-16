# Rep performance in Team Overview

Date: October 16, 2026. Business decisions approved in a ten-question Owner interview. Architecture and detailed edge handling below are implementation recommendations unless explicitly listed as approved. No runtime changes or production execution are included.

## 1. Scope

Add one **Rep performance** block to the Owner and Manager Team Overview. Both roles see the same report. Reps receive no new performance view or endpoint access. Generic Admin receives no Desk access.

Reuse the existing call goals, schedules, overrides, reviewed rep identity, contact evidence and priority-based SMS requirements. Do not introduce a global text goal, change a priority's requirements, or modify cadence to make reporting easier. The current configured call target remains authoritative; 100 is the existing baseline, not a new hard-coded reporting target.

This release contains weekly browsing, a ranked table and expandable daily rows. Exports, scheduled delivery, monthly reports, a combined call/text score and a separate total-call rank are outside this first version.

## 2. Approved interview decisions

| Question | Decision |
| --- | --- |
| 1 | Count verified external outbound attempts, including unanswered attempts and helping another rep. Exclude inbound/internal/duplicate calls. Count successfully sent rep-authored outbound texts; exclude incoming, failed and automated texts. Repeated real attempts/sends count individually. |
| 2 | Owner correction: no global text goal. Derive required-text counts from the existing priority-based requirements; add no goals or policies. |
| 3 | Show text volume separately from on-time required-text completion. Extra texts do not offset missed requirements. No texts due is excluded from the rate. |
| 4 | Call completion rate = completed scheduled workdays at goal / eligible completed scheduled workdays. Extra calls cannot compensate for a missed day. Today enters the rate after workday close. Existing absences and partial-day goal adjustments apply. |
| 5 | Default to Monday through today in New York; retain week-by-week history with Previous / Next / This week controls. |
| 6 | Calls rank by day-goal completion rate, then weekly call volume. Texts rank by requirement completion rate, then weekly text volume. No denominator means Not ranked. Unfinished current-day work is excluded from ranking. |
| 7 | Keep total calls visible and as a tie-breaker; no separate total-call rank. |
| 8 | Text volume belongs to the actual sender. Required-text completion belongs to the rep responsible at the deadline, even when another rep helped. |
| 9 | Incomplete evidence reads Pending data, is excluded from rate denominators, and makes affected rankings Provisional. Late evidence corrects its original day. An actually late send never becomes an on-time completion. |
| 10 | Approve the compact Calls / Texts table, week navigation, completion counts/rates, weekly volume, today's volume/status and expandable Monday–Sunday daily breakdown. |

## 3. Reporting dates and closure

All report dates use `America/New_York`, matching existing Desk and binder week semantics. A week begins Monday at local midnight and ends at the following Monday's midnight, exclusive. Use local calendar operations across DST rather than adding fixed 24-hour intervals.

The current week's volume is Monday through the current instant. Past weeks cover all seven dates. Render future dates as upcoming, never as zero activity or missed work. Monday selects the new week without deleting the previous report.

Volume belongs to the existing event-time business date: outbound call start or provider-confirmed SMS send time. A call starting Sunday and settling Monday corrects Sunday. Rep goals and responsible assignment are historical facts, not recomputed from today's assignment or target.

Recommended interpretation of the approved close rule: close a call-goal day at the existing configured workday closing instant, then settle its verdict only when evidence coverage reaches the required reporting boundary. Do not invent rep-specific closing hours if the current schedule stores only working dates and goal amounts. The volume day still runs to midnight; later qualifying activity can correct the original date's goal result. During implementation, demonstrate this against the current goal resolver and capture coverage rather than changing either policy.

For text ranking, include requirements from closed dates whose deadlines have passed and whose outcomes are resolved. Exclude the entire unfinished current workday, even if some requirements already completed. Today's row can show live completed/due counts. Thus a current-day early success cannot temporarily improve rank while remaining failures are still open.

## 4. Call measures

**Volume:** one canonical eligible outbound attempt per actual initiating rep, regardless of Lead matching, priority or current assignment. Reuse existing all-outbound call-credit eligibility, including restriction exclusions and reviewed temporal identity. Transfers and additional legs never multiply credit. Pool calls count here under the existing all-outbound meaning.

**Daily goal status:** compare that date's eligible call count with its existing effective goal, respecting the frozen goal snapshot, roster, schedule, absence and partial-day override. Off-day activity remains visible but does not add a goal day.

| Condition | Display | Rate treatment |
| --- | --- | --- |
| Positive goal; day open; below target | In progress | Exclude until close |
| Positive goal; verified target reached; day open | Goal met | Exclude until close |
| Closed day; coverage resolved; actual >= target | Met | Numerator and denominator |
| Closed day; coverage resolved; actual < target | Not met | Denominator only |
| No applicable positive goal | No goal | Exclude |
| Closed day without sufficient evidence or historical goal facts | Pending data | Exclude and disclose |

`call_completion_rate = met_days / resolved_eligible_closed_days`. Return null when the denominator is zero. Show `3/4 days · 75%`. Never use weekly volume divided by weekly targets as this rate, and never average daily call-progress percentages. Actual counts may exceed the target.

## 5. Text measures

**Volume:** each distinct successfully sent rep-authored outbound logical message belongs to its actual reviewed sender, including sends without an associated Desk Lead. Mailbox copies and provider retries are deduplicated. A group message is one logical send, not one count per recipient; it earns no inferred requirement completion. Queued/API-accepted messages are pending; failed or subsequently revoked sends earn no confirmed volume. Automated confirmations in `lead_messages` earn none.

**Required texts:** use SMS obligations already generated by the existing engine, with their original period, deadline, outcome, responsible rep and fulfilling event. Count each real SMS slot once. Do not turn catch-up into an additional denominator on top of its original requirement, create SMS for priorities without it, or count an extra send as completing an unrelated slot.

Attribute requirements to the engine's `responsible_agent_id` at the deadline. An unassigned requirement stays in an Unassigned diagnostic count outside individual rankings. A helper's send can satisfy the assigned rep's requirement while increasing only the helper's volume. Later reassignment never moves the earlier responsibility.

`text_completion_rate = on_time_completed_required_texts / resolved_due_required_texts`.

Sum the requirement counts across dates; do not average daily percentages. Example: 1/1 Monday and 1/9 Tuesday means 2/10 = 20%, not 55%. Display `18/20 required · 90%` separately from `80 texts sent`.

| Existing engine outcome | Report treatment |
| --- | --- |
| Fulfilled on/before deadline with verified evidence | On-time numerator and denominator |
| Missed or fulfilled late | Denominator only; a late send still contributes volume on its send date |
| Pending evidence/identity/association | Pending count, excluded from resolved rate |
| Open/scheduled requirement on unfinished date | In progress, excluded from ranking |
| Waived restriction, suspended callback, superseded, cancelled, blocked reschedule, legacy review | Follow existing engine exemption semantics; no invented miss or successful completion |

Use the engine's outcome and deadline-miss truth together. A later waiver/priority change must not erase a genuine historical miss if the engine preserves it. A late receipt proving an on-time send can correct a miss; a late send cannot. Preserve existing inclusive deadline and exclusive credit-window boundary behavior.

Recommended daily text labels: Met when every applicable requirement is fulfilled on time, Not met when a closed resolved date has a genuine miss, In progress while unfinished, No texts due when none apply, Pending data when the verdict cannot be established. Expose unresolved counts even when part of the date is known.

## 6. Ranking and membership

Calls and Texts have independent rankings. Compare exact fractions, not rounded displayed percentages; break ties by confirmed volume for the selected week. Volume includes today's confirmed activity as approved, so tied rates can reorder during the day. Explain this in the column help.

Recommended exact-tie behavior: equal rate and volume share a competition rank (1, 1, 3); sort equal rows by stable rep identity for rendering without pretending that order is a performance distinction. Reps with no eligible denominator remain visible below ranked rows as Not ranked.

Include active Desk Reps at zero activity and historical reps with relevant membership, goals, responsibilities or attributed activity during the selected week. Removing/deactivating a rep today must not remove their past reports. A rep with 1/1 days may outrank one with 4/5; always display both numerator and denominator. No minimum-day qualification or weighting is introduced.

Pending portions are excluded rather than treated as zero. Show pending days/requirements beside the rate. If any compared rep has unresolved eligible data, mark that channel's leaderboard Provisional; also identify the affected rows. A known-zero denominator differs from an unknown denominator.

## 7. Presentation

Place a separate **Rep performance** card after Daily call goals and before Leads needing attention. Retain the existing daily operational controls. Use the Desk's rounded cards, pills, spacing and channel colors.

Header: title, selected week range, Previous / Next / This week controls, Calls / Texts tabs and a compact freshness/Provisional label. Disable navigation into future weeks. Keep report week/channel independent of queue search, priority, move-date and selected-rep filters, so the leaderboard always compares the full team. Preserve those unrelated page controls.

| Calls columns | Texts columns |
| --- | --- |
| Rank, Rep, Days at goal / eligible days and rate, Calls this week, Today calls and goal/status, Expand | Rank, Rep, Required completed / due and rate, Texts this week, Today texts and required completion/status, Expand |

For past weeks omit the Today column; the expanded dates supply the detail. Expanded rows show Monday–Sunday with daily volume, effective goal or required counts, state and pending explanation. Use words with colors, keyboard-accessible tabs and expansion, visible focus, labelled navigation and a narrow-screen scroll or stacked layout. Preserve expanded rep and focus through refresh; avoid animated row shuffling. Display load failure and retry explicitly.

Illustrative calls row: `1 | Alice | 3/4 days · 75% | 486 calls | Today 62/100 · In progress`.

Illustrative texts row: `1 | Bob | 18/20 required · 90% | 80 texts | Today 12 sent · 4/6 required`.

## 8. History and corrections

Maintain daily report facts so earlier weeks survive the queue projection's 30-date history limit and changes in the active roster. Freeze effective historical goal/policy/responsibility inputs; evidence outcomes remain correctable with revision provenance. A refresh is not permission to apply today's settings to old dates.

Backfill only facts supported by retained evidence and historical inputs. Unsupported dates show unavailable/pending with the earliest reliable report date. Never fabricate old zero-activity days or goal misses from today's roster. Prior reports remain readable after provider evidence retention; once original inputs are gone, disclose limits on further reconstruction instead of silently recalculating from less data.

No separate performance-retention deletion policy is introduced. New compact reporting facts remain until an explicit retention decision. They contain identifiers, counts and evidence references, not message bodies or call media.

## 9. Acceptance examples

1. Three closed goal days at 100, 130 and 70 against 100 produce 300 calls, 2/3 days and 66.7%; not 100% completion.
2. A 50-call partial-day override met with 50 counts as one met day. An approved absence contributes activity, if any, but no goal denominator.
3. Eighteen of twenty due texts sent on time plus sixty-two unrelated successful texts produce volume 80 and completion 90%.
4. A helper receives send volume; the responsible rep receives requirement completion. Reassignment after the deadline changes neither historical assignment nor sender.
5. A duplicate call leg or copied mailbox message changes no count. Two real attempts count twice.
6. An unassociated successful rep text increases volume, creates no requirement and satisfies none without existing authorized matching.
7. Missing capture data creates Pending data and Provisional, never a zero or fabricated failure. A historical correction updates both numerator and denominator atomically.
8. A text sent late fails on-time completion; late arrival of proof of an on-time send can restore it.
9. Monday rollover, DST, off-day volume, a Sunday-start call settled Monday, exact-rate ties and a zero denominator all retain the defined semantics.
10. Owner/Manager can read historical weeks; Rep, generic Admin and unsigned/direct unauthorized requests cannot. Previous reports survive rep deactivation and queue-history truncation.

See [EXPLORATION.md](EXPLORATION.md) for verified reuse points, gaps and implementation sequence.
