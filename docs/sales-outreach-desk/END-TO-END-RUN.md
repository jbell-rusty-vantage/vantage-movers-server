# October 4 morning — end-to-end implementation and verification run

Requested by the user during finalization on October 3, 2026. Dates and business clocks use America/New_York. No exact morning time was specified, no automation was scheduled, and no run has been performed by this documentation session.

The business-policy specification is finalized. This checklist does not claim the target models, APIs, UI, migration CLI or provider capabilities have already been implemented or accepted. Implement missing targets under [CONTRACTS.md](CONTRACTS.md), then record actual evidence against this checklist. [POLICY-APPROVAL.json](POLICY-APPROVAL.json) records policy approval separately from disabled bootstrap/runtime controls.

Read [SPECIFICATION.md](SPECIFICATION.md), [FINAL-POLICY-REVIEW.md](FINAL-POLICY-REVIEW.md), [MANUAL-START.md](MANUAL-START.md), [DATA-READINESS.md](DATA-READINESS.md), [READINESS-PREPARATION.md](READINESS-PREPARATION.md), [CODE-MAP.md](CODE-MAP.md) and [SPRINT.md](SPRINT.md). Preserve existing/concurrent work; confirm the current Git revisions, repository instructions, runtime targets and file ownership before implementation.

## 1. Establish the run target and evidence

- Distinguish isolated synthetic/replica/browser testing, authorized read-only provider capability checks and production execution. Record exact target identities, versions, policy/configuration revision and actual commands/results. No guessed DB/provider target, undocumented apply flag or automatic startup index/backfill.
- Supply the required isolated replica/API/admin, mocked external side effects and dependency/test tooling. Follow repository setup and secret inventories rather than inventing environment-variable names.
- Inventory required strict models/indexes, policy/goal/intake parsers, signed actor/BFF permissions, callback/day-override routes, assignment seam, jobs/producer fences and UI capabilities. Missing target contracts become implementation work, not a pretend passing test.
- Keep capture/provider grants and production headroom unverified until measured. A successful packet validator is not runtime acceptance.

## 2. Install the approved starting policy deliberately

- Bootstrap missing/invalid configuration fails closed. All controls default false; migration defaults paused; prospective intake gate defaults false/null boundary/watermark. No GET or server startup initializes policy.
- Install approved values through the audited immutable-version/CAS configuration path, referencing FINAL-01 and individual decision IDs. Verify two independent API/job instances reload the pointer, reject stale commands and fence mutations after pause/config changes.
- Configure trusted Admin/Owner and Manager capabilities explicitly, reviewed rep identity, roster/work schedules, 100 default goals and effective overrides. Bind source intake defaults separately from accepted Granot priority facts.
- Use fixed reference and event clocks for deterministic tests, including nonworking/closed dates and DST. Advancing a synthetic clock can test multiple business dates in one run; it does not prove elapsed production observation.

## 3. Verify deterministic behavior from capture to browser

| Scenario | Required result |
| --- | --- |
| New received 10:00, actual no-answer call 10:10 | First response satisfied by 10:30 deadline; one ordinary call credit and initiating-rep goal credit |
| Actual retry 10:20, next call 11:10 | Retry earns goal only; no anchor reset. 11:10 may satisfy second ordinary call; independent SMS still owed |
| New Day 1/3/4/5/6 and SMS Day 6/9 | Approved age-based quotas/deadlines; fixed SMS dates unaffected by extra/missed sends |
| Receipt/return at 18:00, 19:30, 19:31 | Approved inclusive arrival/reentry caps; no manufactured earlier miss |
| Closing/midnight crossing | Outbound start/NY goal date, inbound handling time and confirmed SMS sent time govern; no future quota prepayment |
| Originating answered inbound Call Lead | Proven association/rep handling satisfies initial response and at most one applicable arrival call; zero outbound goal |
| Helpers/transfers/duplicate receipts | One canonical credit, initiator-only outbound goal, no role/assignment widening |
| SMS sent/delivered then confirmed failure | Single logical-message credit; failure revokes it with historical bounded recomputation; no Call/goal change |
| Unverified identity/origin/association or capture gap | Pending/partial coverage, no guessed credit or false zero/failure. Amended 2026-10-06 (decision D-A1b, engine `sod-engine-v2`): unverified identity/origin/association keeps the channel `pending`; a capture gap past a deadline keeps the obligation outcome `pending` (no guessed failure) while the channel reads `due` with `verification.state: unverified` ("Due — not yet verified", `flags.pending` false, the Lead stays in Needs contact) until coverage proves the deadline |
| Blank/malformed priority update and valid change | Retain existing verified policy with uncertainty; accepted changes use shared mapping and supersede routine work once |
| Quoted date/no-date/reentry | Approved working-date selection/default, original-age reentry, same-date active-policy credit and no restarted initial clock |
| Three unsuccessful attempts | Advisory warning only; actual restrictions still block and restricted outbound earns zero credit |
| Restriction starts/releases | Affected-channel routine waiver, no prohibited-interval debt, preserved earlier misses, paused initial working minutes and approved release-date quota rule |
| Human callback and collision | One explicit plan/revision; 15-minute appointment deadline; no-answer attempt fulfills it; restriction causes rescheduling-needed rather than fabricated miss; nonterminal priority preserves it |
| Missed inbound | History only; no automatic second callback obligation |
| Unassigned/late assignment/reassignment | Deadlines/age/credit remain; genuine miss responsibility retained; new rep sees inherited overdue; prior rep loses scope |
| Passed/unknown move date; viable No-Sync | Cadence continues with appropriate labels; no silent legacy closed-record reopening |
| Duplicate/Form Fill/unmatched/shared phone | Approved eligibility; no phone-based merge, multiplied credit or guessed number-only cadence |
| Goals 100/100/100/50/0 with actuals 100/0/120/25/10 | Team goal 350, visible actual 255, positive-goal denominator 4 and reps at goal 2; zero-goal row retains 10 with No goal today |
| 108 outbound and overdue Leads | Actual 108/100, capped bar, no hidden overdue work |
| Late/corrected evidence | Actual historical date/policy/actor credit; disproven apparent miss removed, genuine miss retained, corrected initiator moves one credit |
| Admin/Owner, Manager, Rep direct API/BFF/stream | Approved permissions including Manager Daily Operations; Owner-only advanced controls; generic Admin/foreign Rep denial |
| UI/SSE/reconnect/reassignment | Correct filters/order/independent channel counts, safe resnapshot and authorized cache retention; fresh configuration and corrected activity appear |
| Legacy/AI producers | No LLM/transcription/summary/assessment/extracted-promise/suggestion/competing cadence work for the feature, including background paths |

Record event identity/time, accepted policy and assignment revisions, expected versus actual requirement/goal effects and browser-visible state. Use actual provider-mapping proofs rather than inferring human answer or sender identity from coarse connected/phone ownership fields.

## 4. Rehearse manual seeding and prospective intake

- Select exact existing synthetic canonical Lead IDs, approximately 20 across two or three reps, using all required age/schedule cases. Produce report/preview with expected facts/counts and zero operational writes.
- Persist fixed cohort/activation boundary, approved manifest hash, policy/algorithm version, source revisions/watermarks, exclusions and expected outputs. Apply only bounded reviewed scope in the authorized isolated target.
- Verify no replacement Leads, age reset, preactivation policy misses/debt or fresh old-lead initial-response clocks. Preserve verified human schedules/restrictions; past legacy callbacks/uncertain history remain review. No AI plan activation.
- Reapply the same manifest: zero semantic duplication and unchanged boundary/scope. Crash before/after checkpoint, expire lease, race priority/closure/assignment/config and catch up dirty records without overwriting newer facts.
- Enable prospective intake in the isolated fixture through its distinct Owner gate. New eligible received intake enrolls once. Existing unselected or late-created historical records are not silently enrolled as fresh. Pause migration/intake independently; existing enrolled live recovery retains its recorded cohort rules.
- Goal metrics cover full approved eligible daily activity for selected roster reps, or clearly show pending/partial scope; pilot-only counts never masquerade as complete 100-call performance.

## 5. Verify Operations, visual fidelity and runtime quality

- Daily Operations live/rebuild parity uses approved metric units/event times, including delayed Granot creation and overnight confirmation sends. Trusted Manager reads/streams work; Rep remains denied. Preserve independent refresh cadence and one mounted board stream.
- Compare Admin/Manager/Rep frames against both bundled Owner screenshots at 1186 × 742. Admin/Manager share composition except advanced permitted controls. Test responsive layouts, keyboard/focus, countdowns and updates without assuming screenshot sample counts/labels are policy.
- Run required repository quality checkpoints after meaningful implementation, including `pnpm finish-work --provider codex` under the repository's quality-worker guard. Record actual tests/typecheck/lint/review results; skipped required tests are unresolved evidence.
- Measure actual capture/projection/browser freshness, rate admission, DB/oplog/consumer headroom, rollback reader compatibility and pause/recovery. Do not certify runtime/production properties with documentation/synthetic declarations alone.

## 6. Production pilot and expansion decision

Follow the actual report/apply/verify tooling and [manual-start sequence](MANUAL-START.md) only once implemented, proven and deliberately admitted by trusted Admin/Owner. Prefer the recorded 08:00 working-date boundary. Production shadow comparison requires one working date and post-activation verification requires one full working date before expanding to automatic intake. October 4 morning can begin the run; a morning-only test does not establish those full-day observations. Do not silently shorten them to satisfy a calendar promise.

After the pilot reconciles, admit prospective new intake; expand remaining existing Leads in reviewed bounded cohorts. Source-quality failures quarantine affected records/credits or block the affected release path. Missing telemetry/admission evidence pauses migration. Preserve S5–S7 and at least 40% sprint capacity for rehearsal/backfill/catch-up/reconciliation/readiness/rollback.

## Handback

Report what was implemented, exact commands/targets/configuration and manifest hashes, expected/actual cohort and goal reconciliation, accepted screenshots, provider capability proofs, measured freshness/headroom, unproven gates, allowed cohort and rollback/pause procedure. No completed evidence is claimed until it exists.

The available packet-only checks are:

```powershell
node docs/sales-outreach-desk/validate.mjs
```

Run that command from each repository root. It checks portable links, shared release hashes, approval/disabled-control consistency and synthetic declarations. The migration CLI, feature tests and actual runtime entrypoints are target deliverables; discover and verify their implemented interfaces before execution.


D01 removal scope: retire outreach LLM/transcription/summary/assessment/extracted-promise/suggestion admission and producers feature-wide, including unseeded existing Leads. A small cadence pilot does not authorize continued legacy AI processing outside the pilot. Retain existing historical evidence and deterministic provider capture/authoritative restrictions. MCP remains separate.
