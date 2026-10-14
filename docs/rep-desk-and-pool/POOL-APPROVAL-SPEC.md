# Pool policy and implementation approval draft

**Status: DRAFT — policy proposal reviewable; live Pool discovery and final
admission recommendation incomplete. Pool implementation is not approved.**
October 14, 2026 UTC / October 13 New York. Branch:
`codex/pool-discovery-approval`. Authority:
[Owner overnight brief](../knowledge/overnight-rep-desk-and-pool.md).

Phase 1 shipped: server [PR #218](https://github.com/jbell-rusty-vantage/vantage-movers-server/pull/218)
merged as `beadfd11872acad0eede2774148fa11db651178c`; admin
[PR #7](https://github.com/jbell-rusty-vantage/vantage-admin/pull/7) merged as
`5fc16d9538a308e7086dc28e157b7788f6f4c107`. Production deployments are READY;
signed deployed reads/roles, date windows, queue samples and live connect/clock
were verified at `2026-10-14T03:07:37Z`. See
[Phase 1 verification](PHASE1-VERIFICATION.md),
[merge/CI evidence](evidence/phase1/merge-and-ci.json) and
[deployed-read evidence](evidence/phase1/deployed-read-verification.json).
The authenticated deployed Admin browser walk and production mutation-driven
live test were not performed; local browser and signed read evidence retain their
actual scope. Phase 2 opened only after these merges and production verification.

## Recommended direction

Reuse an eligible canonical FormLead or CallLead and represent **Pool membership
and shared work separately**. Do not create a second Lead for a known Job, clear
its receiver, or make every viewer owe a separate call. An approved active
membership grants all eligible desk Reps, Owner and Managers shared access
regardless of receiver; one canonical opportunity has one shared call slot per
New York working date. The actual provider-confirmed caller receives attribution,
independent of receiver or an advisory claim.

This recommendation fits the observed canonical corpus and existing protections.
It is provisional: canonical priority9 is not actual current-month Granot Pool
membership, and incomplete Booking coverage cannot establish safe absence of an
anchor. No candidate in the observed corpus is approved for admission by this
specification. Preserve ordinary assigned permissions/cadence, official
Booking/Cancellation gates, closed periods, manual receiver protection, accepted
fact ordering and Phase 1 money. Codes 2/3 remain Daily; priority9 remains
excluded from assigned potential dollars. Pool sharing never creates binder
allocation credit for viewers.

The implementation proposal is detailed in [canonical model/transitions](POOL-MODEL.md),
[desk/shared-call/authorization design](POOL-DESK-DESIGN.md),
[collection and Sheets design](POOL-COLLECTION-AND-SHEETS.md), the
[local read-only prototype](../../ops/pool-prototype/),
[prototype findings and 17-test proof](POOL-PROTOTYPE.md),
[guarded canonical readers and seven offline checks](POOL-READ-EVIDENCE.md) and
[independent review](POOL-REVIEW.md). The passing replay is synthetic; it does
not establish a live report.

## What is verified and what remains blocked

The coordinator performed authenticated **GET-only** canonical discovery from
`2026-10-14T03:26:37Z` to `03:27:04Z`. The tracked [redacted canonical collision evidence](evidence/phase2/canonical-priority9-collisions.json)
has provenance `canonical_priority9_read_api_inventory_not_live_granot_pool`.
The [read API/run-surface evidence](evidence/phase2/read-api-surface.json) records
the available endpoints and active applying-run limit. No production mutations
were performed.

| Measured canonical inventory | Result | Meaning and limitation |
| --- | --- | --- |
| Form ordinary and duplicate passes | 7,057 + 166 = 7,223 distinct Leads | Both passes reached observed totals; ordinary browse alone excludes duplicates |
| Call ordinary and duplicate passes | 1,556 + 290 = 1,846 distinct Leads | Both passes reached observed totals |
| Total Lead corpus | 9,069 distinct ids across all four passes | Counts/unique ids matched reported totals in every pass; offset paging is not an atomic snapshot |
| Canonical priority9 | 326 Form + 14 Call = 340 Leads and 340 exact Job keys; none missing Job | Tests canonical identity risks, not current-month Granot Pool selector/membership |
| Assignment | 339 assigned, one unassigned | Pool shared access must not depend on receiver; observed assignment does not approve changes |
| Observed identity collisions / Booking matches for these keys | Zero in observed corpus | Not proof of universal uniqueness or no Booking: anchor inventory remains partial |
| Booking anchors | 896 missing/null-cancellation browse rows + six additional attached anchors = 902 observed | Full Booked browse failed HTTP500; unlinked cancelled/legacy-false/pending/leadless anchors can be missing |
| Sheet history | Unknown; none of 340 observed rows was marked `no_sync=true` | An absent true flag does not distinguish false/missing/null or prove a prior sheet write |

The raw all-Booking browse encounters a legacy Boolean `cancelled=true` where
the API populates a CancelledLead ObjectId. The `cancelled=false` query is a
**presence filter**: it includes missing/null values and excludes both legacy
Boolean false and true as well as cancellation references. Its 896 rows are not
all semantically uncancelled Bookings. Six extra attached anchors do not close
that gap; populated Lead links can also hide dangling raw pointers. Keep the
gap explicit and hold any creation/admission conclusion that relies on absent
Booking evidence. No production data repair or unrelated API change is authorized
by this design.

Live Pool discovery is blocked on **four managed Granot credential bindings,
permitted Eagle host access, and an approved execution seam holding the existing
global account lease**. The exact bindings are `GRANOT_NETWORK_USERNAME`,
`GRANOT_NETWORK_PASSWORD`, `GRANOT_USERNAME` and `GRANOT_PASSWORD`; the host is
`eagle.hellomoving.com`, and lease scope is `granot:automation:account`. Configure
managed bindings without publishing credential values. These dependencies were requested asynchronously; no
response/approval had arrived when this draft was written. Existing deployed
Estimates APIs fix `FUSTATUS=10` ALL and redact observed Form priority statements;
mapped Call rows do not expose observed priority. They do not return actual
Pool9 form controls, report HTML/pager or full observed-priority facts. Filtering
those plans by canonical priority9 would be circular evidence.

The latest-100 run GET actually showed eight applying runs. The run list has no
complete history pagination, and a preview queue wake-up can service existing
approved work. The coordinator therefore attempted **no preview POST, worker
call, approval/apply, or Granot login**. All production discovery activity for
this phase was GET-only. Do not bypass the shared account lease, invent a proxy
endpoint, read production Mongo directly, or treat elapsed time as credential or
mutation approval.

The historical form records Pool selector9/ALL10; source inspection confirms the
ALL request and current parser. Local prototype/review tests exercise supplied
form/parser, partitions, paging totals, identity classes and lease-attestation
boundaries. They establish fixture behavior only. The independent review records
17 named focused checks passing; it does not prove current live selector, rows,
provider pagination, account-fence ownership or traffic. This draft is **not a
fully completed live discovery deliverable**.

## Exact Owner decisions

The defaults below are recommendations, not adopted policy. Approval of one row
does not waive missing live evidence or approve production effects. Record each
selected choice and effective policy version after actual discovery is reconciled.

| Decision | Recommended initial choice | Alternative and concrete scope to approve |
| --- | --- | --- |
| **P-POOL-01 Identity, unmatched rows and creation** | Reuse only one verified eligible canonical Lead after both-model/source/equivalent-Job/link/Booking checks. Hold unmatched, insufficient-identity, multiple/cross-model/cross-source, duplicate, partial-pointer and pending/official-anchor cases. Initial pilot creates no Leads. | Permit unmatched creation only after complete anchor evidence, approved Registry source/minimum-data rules, transaction-time repeat matching/idempotency and durable sheet exclusion. Never automatically merge duplicates, attach a leadless/referral Booking or mint a second Lead for a globally known Job. |
| **P-POOL-02 Membership authority and priority/source/manual/closed conflicts** | Require reconciled actual Pool form evidence plus a newer accepted canonical fact/explicit Owner membership decision. Another accepted priority, uncertain Source Scope, stale provider fact, manual override or Booking/Cancellation/bad/closed state is held; no absence-based exit. Preserve manual/source-less receiver protection; membership never assigns the caller. | Define a different authority between verified provider membership and canonical accepted priority9, with exact conflict/absence/manual override rules. Any closed-subject reopening or source change needs a separately reviewed canonical command, not discovery-side patching. |
| **P-POOL-03 Shared visibility, eligibility and human coordination** | All trusted eligible desk Reps, Owner/Managers see verified active Pool regardless of receiver; generic Admin and actors without trusted active Agent/Registry desk mapping denied; provider identity is separately required for call credit. Dedicated server membership entitlement, exact BFF allowlists and scoped DTO/history; ordinary foreign Rep records remain404. Advisory two-minute renewable own claim; qualifying nonclaimant call remains valid. Pool Rep initially gets read/claim only. | Approve Manager claim release or shared callback scheduling with specific audit/permission/restriction rules. A hard dial lock is a separate decision; no broad Lead CRUD, foreign money access or receiver reassignment follows from shared reads. |
| **P-POOL-04 Call qualification, attribution and goal money boundaries** | Reuse final provider-confirmed external actual outbound attempt and uniquely associated reviewed eligible caller; recommend qualifying reviewed answered inbound under cadence gates too. Respect event time, contact restrictions and spacing; exclude missed inbound, internal/transfer duplicates, in-progress/unconfirmed calls and SMS/click/claim. One shared completion; earliest eligible event/id tie attribution; each real outbound retains once-only individual credit under existing goal scope. | Choose outbound-only shared fulfillment if answered inbound should not qualify. Preserve `all_outbound` and `eligible_new_quoted` initially; Pool-inclusive narrowed goals require a new effective-dated scope. Priority9 potential exclusion/official allocation rules change only by separate explicit money-policy approval. |
| **P-POOL-05 Calendar, late entry, cross-mode transfer and reentry** | Use installed New York working calendar/contact hours; one shared duty due at configured ordinary close. Entry during hours owes prospective work through approved19:30 cutoff, later next working date. Approve same-date verified ordinary-call coverage transfer without relabeling the event or new goal credit. Logical key is opportunity+NY date+pool_call; exit/reentry/policy revisions never create a second same-day quota. | Select literally every calendar date instead of configured working dates; specify holiday/closed-day behavior and exact due/cutoff. Reject cross-mode transfer only with an explicit quota consequence. No retroactive discovery debt, new initial-response clock, closed-period reopening or viewer-specific duty. |
| **P-POOL-06 Misses, restriction/coverage recovery and rollover** | Keep genuine shared missed-date history attributable to Pool/team, with pending coverage when unverified. Tomorrow opens its one new duty; no duplicated debt per Rep or automatic extra rollover call. Restrictions/callback precedence remain authoritative; no restriction-caused miss. Provider correction fixes only its true original window. | Choose how verified late provider evidence, waivers and historical misses are displayed or corrected within their original windows. The current one-call-per-day mission permits no extra Pool catch-up quota; additional calls would require a separate explicit policy request. Individual absence/zero goal never resets the shared duty. |
| **P-POOL-07 Sheets creation, existing matches and transitions** | Permanent audited Pool-creation provenance excludes its Lead from all Master Leads destinations through priority exit/reentry, duplicate/bad routes, retry/requeue/repair and Booking source refresh. Recommend source-Lead mirror suppression too. Existing ordinary matched Leads retain ordinary sync/history; membership does not retroactively convert origin/delete rows. No columns added; ordinary sync unchanged. | Ratify source-mirror scope. Extending exclusion to existing synced Pool matches requires explicit row-removal target manifest, later-exit rule and cleanup/replay/rollback authority. `no_sync` or one skipped enqueue alone cannot implement permanence; official Booked/Cancelled Deals stay separate. |
| **P-POOL-08 Collection scope, traffic and freshness** | Preserve ALL yesterday/today08/13/18NY. Once-daily08 current-month Pool inventory plus one rotating ALL seven-day partition/slot. AtNYOct13: two partitions, eight report submissions/day including existing job, approximately40 base HTTP requests with current isolated-session behavior; month-sweep healthy worst-case19h and older dates explicitly uncovered. | Three full-month Pool scans/day give12 reports/60 base requests atOct13. Approve older horizon, measured page/login/redirect/retry budget and freshness target; five month partitions need up to43h ALL revisit. Open Date is not modified-since, failed/partial scans do not infer exits, month rollover preserves prior inventory. Actual measured form/pages/lease behavior is prerequisite. |
| **P-POOL-09 Pilot, release, expansion and rollback** | After evidence/policy approval: additive server schema/auth/guards first, strict mirrored DTO/BFF/live/UI, local tests and report-only shadow, then exact reviewed selected-id pilot (proposed up to20 coherent existing Leads). Pin ids/revisions/source/anchors/activation boundary; no automatic admission of all340canonical9 Leads. Separate reviewed production apply/expansion. | Owner sets cohort/observation length and any approved creation/backfill scope. Rollback stops admission/shared access/claims, preserves periods/verified events/sheet exclusion and transitions to ordinary prospectively under approved rules; no Lead/Booking deletion, history rewrite, automatic source-sync restoration or customer sends. |

These nine decisions cover policy choices. They do not authorize fixture-generated
membership or treat a general “approve design” as approval to bypass an actual
identity, source, anchor, provider, permission or rollout failure.

## Evidence and execution gates

**Gate A — complete the live discovery deliverable.** Acquire managed bindings,
permitted host and approved global lease execution; capture actual Pool9/ALL10
controls, current-month partitions/rows, each page/total/truncation state, source
routing and observed priorities. Persist only sanitized summaries and hashes,
measured collection/overall request counts and held-fence provenance. Repeat
both-model matching against actual returned rows, including other-canonical-
priority conflicts, source/manual states and complete anchor evidence or explicit
holds. Canonical9 inventory cannot substitute. If available evidence cannot close
a required gap, retain the blocker rather than claiming admission readiness.

**Gate B — record Owner policy choices.** Reconcile the nine decision rows with
actual findings, set exact eligible/read/call/calendar/transition/Sheet/collection
policy versions and approve any canonical effects. A source/identity conflict or
closed/official/pending anchor remains review, not a default enrollment. No new
environment flag or inferred priority9 meaning is the policy authority.

**Gate C — implement and rehearse locally after approval.** Prove unique shared
slot and event/CAS behavior across simultaneous callers, claims, retries, late
capture, corrections and same-day exit/reentry; server-wide filters/counts/sorts/
cursors, role denial, detail revalidation, committed invalidation and revocation/
reconnect cache eviction; restrictions/callbacks/coverage, NY/DST/year/closed-day
boundaries; both-model no-second-Lead race; unchanged ordinary2↔3 Daily, historical
closures, Phase1 money and sheet headers; durable Pool-origin exclusion on every
planner/executor/requeue/repair/transition path. No test contacts a customer.

**Gate D — approve a concrete production pilot manifest.** Report/dry-run exact
ids/revisions/source/anchor eligibility, membership boundary, indexes, sheet
policy and expected shared work; rehearse apply/replay/crash/fence/rollback on an
isolated replica. Deploy compatible readers/guards first, activate only approved
memberships through audited versioned commands, verify every role and actual
capture/live behavior, then obtain deliberate expansion authorization. Turning
off UI or rolling back code must not remove the durable sheet guard while
Pool-origin Leads exist.

Current stopping point: policy draft, local read-only prototype and canonical
GET inventory are reviewable. **Actual live Pool discovery is blocked and Pool
feature work/production reconciliation remain gated.** No creation, repriority,
reassignment, enrollment, deduplication, sync, sheet deletion, cadence/flag change,
provider subscription or customer send is performed or authorized by this file.
