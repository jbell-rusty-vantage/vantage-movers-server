# Pool collection and Sheets design

> **October 14 local continuation:** live Pool discovery and the shared-duty prototype are now complete. Use [current findings](POOL-FINDINGS-2026-10-14.md) and [current approval proposal](POOL-APPROVAL-2026-10-14.md). They supersede the historical access blockers, collection scope and unresolved code9 meaning below. Production Pool implementation remains gated.

Design only, October 14, 2026 UTC / October 13 New York. Phase 1 is merged and
production-verified; this Phase 2 branch starts at server `beadfd11` with admin
`5fc16d9`. Authority: [Owner overnight brief](../knowledge/overnight-rep-desk-and-pool.md).
No collector behavior, production Lead, cadence configuration, sheet row or
outbox job is changed by this document. Every Pool reconciliation/creation
strategy below awaits Owner approval.

## Observed code and evidence boundary

The deployed [Estimates collector](../../src/services/granotHttpCollector/estimatesInProcess.ts)
opens `wc.dll?mv~estprocesswc~<session>` then submits to
`wc.dll?mv~estprocessret~<session>` using `STATUS=V9`, `TYPEDTE=OPEN`,
`DATE1/DATE2`, `FUSTATUS=10`, empty `USER`, `DEPT=ALL`, `TYPE=V1`, `SORT=V6`.
The current code fixes ALL; it does not collect Pool specifically. Historical
[form evidence](../knowledge/granot-priorities-and-rep-desk.md) identifies
`FUSTATUS=9` as Pool and `10` as ALL. The current actual form/Pool results must
be confirmed by the read-only prototype before accepting that selector or any
completeness claim. This is a selector change on the existing form, not evidence
for a new endpoint or permission to change the deployed collector.

The [cron](../../src/services/granotHttpCollector/estimatesCron.ts) runs at
08:00/13:00/18:00 America/New_York with Open Date yesterday through today,
including through midnight/year/DST transitions. Preserve that ALL job and its
accepted-priority processing; codes 2/3 remain Daily. The current parser recognizes
a table with Job Number and Customer headers, adapts numeric `Prior: <digits>`
from Follow Up, groups by source label, and has no pagination traversal. A
recognized table is evidence of a parsed page, not proof of a complete inventory.
Unknown source routing/identity remains unresolved rather than guessed.

The Owner brief records seven-day partitions succeeding historically while
90/45/15-day requests had no recognized Follow-Up table. That is a starting
partition assumption, not a proven provider hard limit. Fresh live form, row,
pagination and overlap checks are pending the prototype findings. Do not equate
schema drift, login failure, timeout, response-size rejection, an unexplored next
page or suspicious cap with an empty successful partition.

## Discovery scope and request arithmetic

For the requested initial inventory, fix a reference New York date and scan
**the current calendar month through that date**, inclusive, with Pool selected.
At New York October 13 the range is October 1–13: 13 calendar dates, split into
October 1–7 and October 8–13. This requires **two result submissions** if each
partition has one complete page. The formula is `P = ceil(day_of_month / 7)`;
late October needs five partitions. Use date-only boundaries, not rolling hours.
Do not mutate records or advance production collection watermarks during this
read-only discovery.

| Collection option at October 13 | Pool result submissions/day | Existing recent ALL/day | Rotating ALL/day | Total result submissions/day |
| --- | ---: | ---: | ---: | ---: |
| Initial one-time Pool inventory only | 2 total | unchanged | none added | 2 incremental, once |
| Recommended bounded proposal: full current-month Pool inventory once daily at 08:00; one ALL sweep partition each existing slot | 2 | 3 | 3 | 8 |
| Faster alternative: full current-month Pool inventory at all three slots plus one ALL sweep partition each slot | 6 | 3 | 3 | 12 |

These are report POST counts, **not total HTTP traffic**. Current
[authentication](../../src/services/granotHttpCollector/index.ts) uses a login
GET, network-login POST and user-login POST; each isolated collector invocation
then has a form GET and result POST: five application requests before redirects,
pagination or retries. With current independent-session behavior the recommended
8 reports/day imply **40 base HTTP requests/day**, versus existing 15; the faster
12-report alternative implies 60. The two-report prototype implies 10 base
requests. At five month partitions the respective daily report counts become
11 and 21, or 55 and 105 base HTTP requests. A reviewed future batch could reuse
one authenticated session/form under the shared lease; no such optimization is
implemented or assumed in these numbers.

If partition i needs `p_i` pages, report POST totals are at least `sum(p_i)`;
actual next-page request method/form behavior must be measured. Redirects and
login/session retries add traffic. Existing collector permits one fresh-session
retry on invalid session; a second full attempt can double one invocation's
five-request baseline. An overlapping date adds repeat rows, not an additional
request when it stays in the same partition. Record actual request count,
response bytes, durations, row counts and retries before choosing a budget.

## Priority-change freshness and bounded rotating sweep

Open Date is **not established as modified-since**. A Lead opened October 2 can
change receiver or priority October 13 and remain outside yesterday/today's
query. Repeated recent ALL scans and active webhooks complement one another but
cannot prove all older changes were seen. Pool-only discovery also cannot prove
that a previously Pool Lead left Pool when it disappears from the response.

Proposed future schedule, pending provider measurements and approval:

1. Keep the current recent ALL scan at 08:00/13:00/18:00, yesterday through today.
   Its overlap repairs short outages and same-day races, but the overnight gap
   means recent-row observation can lag up to 14 hours in healthy operation.
2. Run the complete current-month Pool inventory once at 08:00; this bounds
   discovery of still-visible current-month Pool rows to approximately 24 hours
   in healthy operation. The three-slot alternative reduces the maximum healthy
   inter-slot gap to 14 hours at the added traffic above.
3. At each existing slot, scan **one** current-month seven-day ALL partition,
   oldest least-recently-successful first. ALL reobserves outgoing as well as
   incoming Pool priorities, current receiver and other accepted facts. Advance
   the partition cursor only after complete successful collection/validation.
   Keep per-partition last successful observation and coverage rather than one
   misleading global modified-since timestamp.

At October 13 there are two ALL partitions. Cycling one per slot refreshes each
within at most **19 hours** after a change just missed that partition, assuming
successful complete scans and no queue delay. With slots separated by 5, 5 and
14 hours, for N partitions the maximum healthy revisit interval is
`24 * floor(N/3) + remainder_gap`, where remainder gaps for `N % 3` are 0, 14,
19 hours. Five partitions therefore need up to **43 hours**. This is a schedule
bound, not observed provider latency or a freshness guarantee during outages.
Report queued/failed/partial/late sweeps honestly and keep successful partitions'
previous coverage until replaced.

This month-only sweep leaves older Open Dates outside its coverage. It cannot
support a claim that all historical Pool membership or arbitrary older priority
changes are current. The Owner must select a bounded older horizon or an explicit
known-job refresh capability proven by actual form evidence. For a reviewed H-day
horizon, `N = ceil(H/7)` partitions give the same N-slot bound and three sweep
reports/day; 90 dates would be 13 partitions and up to 110 healthy hours. These
numbers are planning arithmetic, not approval to collect 90 days or proof that
seven-day requests/pagination are complete. Month rollover must preserve the
previous inventory and unfinished coverage manifests; it must not infer Pool exit
or delete membership because a job aged outside the new current-month window.

## Lease, recovery and safe repeated observations

Use the existing [automation account lease](../../src/services/granotHttpCollector/runWorkflow.ts)
(`granot:automation:account`, fenced epoch, currently 45-minute TTL) for **every**
login and collection, including read-only prototypes. The low-level session
helper does not itself acquire that lease; calling it directly requires the
caller to join this protocol. Never run a second independent Pool login against
the same account concurrently with ordinary Estimates or Leads & Advertising.
Prioritize the deployed ordinary job, bound Pool/sweep work by reports, bytes and
time per slot, renew under ownership where supported, and yield with a persisted
partition checkpoint. Lease busy is defer/stale, not empty success.

Use a durable future inventory/run manifest keyed by account, selector, inclusive
Open Date partition, parser/source-policy version and reference date/slot. Retain
successful partitions, retry only failed/incomplete partitions, and bound retry
attempts/backoff per slot; do not launch catch-up bursts after an outage. Treat
429/provider failure with backoff, session failure with the existing one-session
retry, and schema/pagination uncertainty as review/partial. A partition checkpoint
and completion marker must be fenced against lease loss. A lost lease cannot
publish a fresh completed inventory.

Deduplicate overlap by canonical source/account/job identity and semantic fact
fingerprint, not returned row offset. Skip exact replay effects, but **never skip
because the job number or priority was previously seen**: receiver, assignment
provenance, source, contact/route facts and accepted observation ordering can
change. Compare all relevant current facts through existing canonical identity,
source-policy, temporal-winner and protected-field seams. A later collection time
alone is not proof that stale provider content should defeat newer webhook facts.
Preserve manual receiver protection, existing accepted-fact ordering, prospective
history, same-period 2↔3 Daily transitions and closed/no-reopen behavior. Absence
from a filtered report is not an accepted closure, reassignment or priority change.

## Durable Sheets exclusion proposal

Current [No-Sync predicates](../../src/services/sheetSync/noSyncLead.ts) exclude
only exact `no_sync === true`; missing/false/null remain syncable. The normal-tab
predicate deliberately stops applying to duplicate/bad Leads. The
[source-lead executor](../../src/services/sheetSync/sheetSyncSourceLookup.ts)
checks that predicate and deletes existing ordinary Master/source Forms or Calls
rows; it does not establish an all-tab Pool-origin rule. [Expected-tab planning](../../src/services/googleSheets/expectedSheetTabs.ts)
and Contains use the same normal-tab behavior. Setting `no_sync` or skipping one
enqueue is therefore insufficient for **always** excluding a Pool-created Lead
through later priority, duplicate/bad, source or assignment transitions.

Recommend an immutable, audited **Pool-creation provenance plus explicit sheet
exclusion policy**, stored on canonical Lead creation (field/schema name remains
to be finalized in the shared model design). Pool membership is mutable; the
creation provenance/exclusion is not derived from today's priority and never
clears automatically on Pool exit. No new sheet column is needed. The future
invariant is: a Lead created through approved Pool discovery never writes a row
to any Master Leads tab, including ordinary and duplicate/bad destinations, on
creation, retries, manual requeue, historical repair, later reclassification or
linked Booking-triggered source-lead refresh. Recommend suppressing corresponding
source-Lead mirrors too; Owner must ratify that scope. Official Booked/Cancelled
Deals remain separate facts and are not erased or suppressed by this Lead rule.

Apply this exclusion in the future central target planner **and immediately
before external execution**, with authoritative current provenance fetched by
outbox consumers. Reuse the existing
[transactional coordinator](../../src/services/sheetSync/sheetSyncCoordinator.ts):
canonical writes and durable outbox intent commit together in queued mode;
[coalesced jobs](../../src/services/sheetSync/sheetSyncOutbox.service.ts) then reload
current facts. The same guard must cover legacy/manual/rebuild/Contains paths,
not just the Pool producer. Emit a terminal audited skipped outcome, not endless
retry. Retry after transition still suppresses the Lead row. No production
cleanup/delete is implied by designing this guard; unexpected existing rows need
a separately approved target manifest and delete/replay verification.

| Identity outcome | Recommended treatment, awaiting Owner decision |
| --- | --- |
| Unmatched eligible Pool row after approved canonical creation | Persist Pool-origin exclusion atomically; never export its Lead to Master Leads, including after Pool exit |
| Exact match to an ordinary already-synced Lead | Reuse canonical identity; Pool membership alone does not reclassify its creation origin or silently remove an existing row. Recommend preserving ordinary sync pending an explicit Owner choice |
| Exact match to an existing Pool-origin Lead | Preserve original exclusion through membership/priority/source/receiver updates |
| Multiple/cross-model/duplicate/Booking-anchor conflict | Quarantine for identity review; no second Lead, merge, reprioritization, receiver change, export or row deletion |

The matched ordinary-Lead choice is a material Owner decision: preserving its
existing row retains ordinary sync; excluding/deleting it would broaden the
Pool-origin rule to membership and require an approved cleanup strategy. Either
choice must state what happens on later Pool exit. No automatic deletion,
`no_sync` flip or retroactive provenance conversion occurs before approval.

The [sheet headers](../../src/config/domain/sheets.ts) already export Sales Rep;
[Form](../../src/services/googleSheets/projections/formLeadRow.ts) and
[Call](../../src/services/googleSheets/projections/callLeadRow.ts) projections use
the receiver name snapshot. They have no Granot priority column. Continue
ordinary canonical updates and existing receiver/manual protection; do not add
columns or change ordinary sync to complete this design. Administrative CSV
[exports](../../src/services/admin/adminExport.service.ts) are a different surface:
they use browse scope/filters and do not automatically inherit sheet exclusion.
This proposal changes neither CSV availability nor Owner/Manager/Rep permissions.

## Required acceptance evidence before implementation approval

Prove current form controls and parsed Pool priorities, source resolution, count
and page completeness for each partition; overlap equality or explain legitimate
changes; distinguish empty from drift/truncation; measure budgets and account
lease contention without touching production facts. Simulate failures, lease
loss, partial pages, resume, duplicate rows, rollover and an old Open Date whose
priority/receiver changes. The accepted observation must preserve newer evidence,
manual receiver and existing 2/3 Daily periods. Inventory must expose its exact
coverage horizon and unresolved older rows.

After Owner approval, isolated tests must prove Pool-created exclusions through
priority exit/reentry, duplicate/bad reclassification, retries/manual requeue,
linked Booking source refresh and source changes; unchanged ordinary sync and
no new headers; and the approved matched already-synced policy. Migration/cleanup
needs an exact reviewed target manifest and idempotent replay/rollback proof.
None of these proposed production changes has been run.

Approval decisions: selector/completeness based on actual prototype findings;
once-daily versus three-slot Pool inventory and a measured request budget;
current-month versus older sweep horizon/freshness; durable exclusion provenance
and source-mirror scope; matched already-synced Lead behavior and cleanup authority.
Shared visibility, one daily call, model transitions, potential-money interaction
and auth rollout belong to the accompanying Pool model/approval specification.
