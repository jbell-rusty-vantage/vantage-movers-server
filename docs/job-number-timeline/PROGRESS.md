# PROGRESS — Job Timeline Enhancement

**This is the live ledger. Every issue updates it — on pickup and on close.**
It is a navigation aid, not an authority. Where it disagrees with the
repository, the repository is right and the next agent fixes this file.

Pack created 2026-08-27. Protocol: [`AGENT-PROTOCOL.md`](AGENT-PROTOCOL.md).

## Issue status

| Issue | Title | Prereqs | Status | Owner / agent | Started | Closed | Report |
| --- | --- | --- | --- | --- | --- | --- | --- |
| [JTE-01](issues/JTE-01.md) | Extract deep runtime module; route and CLI use it | current timeline | `complete` | agent | 2026-08-27 | 2026-08-27 | [reports/JTE-01-completion.md](reports/JTE-01-completion.md) |
| [JTE-02](issues/JTE-02.md) | v2 types, dual clocks, evidence/correlation/activity | JTE-01 | `complete` | agent | 2026-08-27 | 2026-08-27 | [reports/JTE-02-completion.md](reports/JTE-02-completion.md) |
| [JTE-03](issues/JTE-03.md) | Outcome, stage assessment, attention, limitations, freshness | JTE-02 | `complete` | agent | 2026-08-27 | 2026-08-27 | [reports/JTE-03-completion.md](reports/JTE-03-completion.md) |
| [JTE-04](issues/JTE-04.md) | Enhanced Owner UI and evidence expansion | JTE-03 | `complete` | agent | 2026-08-27 | 2026-08-27 | [reports/JTE-04-completion.md](reports/JTE-04-completion.md) |
| [JTE-05](issues/JTE-05.md) | Live proof, security, accessibility, performance, deep links | JTE-04 | `complete` | agent | 2026-08-27 | 2026-08-27 | [reports/JTE-05-completion.md](reports/JTE-05-completion.md) |
| [JTE-06](issues/JTE-06.md) | Cancellation correlation snapshots and report-first backfill | JTE-02; write approval | `complete` | agent | 2026-08-27 | 2026-08-27 | [reports/JTE-06-completion.md](reports/JTE-06-completion.md) |
| [JTE-07](issues/JTE-07.md) | WordPress durable receipt capture | source-assurance approval | `complete` | agent | 2026-08-27 | 2026-08-27 | [reports/JTE-07-completion.md](reports/JTE-07-completion.md) |

Status vocabulary: `ready` · `active` · `blocked` · `complete` · `deferred`.

## Session plan

| Session | Issues | Notes |
| --- | --- | --- |
| 1 | JTE-01 | Only startable work. |
| 2 | JTE-02 → JTE-03 | Same module; do not parallelize. |
| 3 | JTE-04 | Admin only. |
| 4 | JTE-05 | Certification. Fold into session 3 if the UI lands clean. |

## Specification coverage

One row per enhancement-spec section that this pack owns. A row is ticked
by the issue that closes it, with the evidence named.

| Spec § | Subject | Issue | Done | Evidence |
| --- | --- | --- | --- | --- |
| §1.3, §10, §15 Phase 0 | Production module; no runtime import of the prototype | JTE-01 | ☑ | `rg` empty under `src/`; `createJobNumberTimelineModule`; report JTE-01 |
| §4.1 `source_received`, §5, §6 event fields, §7 | v2 events, dual clocks, correlation, activities | JTE-02 | ☑ | `source_received` priority 5; named tests in `v2.test.ts`; report JTE-02 |
| §4.2–4.3, §6 page fields, §8 | Outcome, stages, attention, limitations, freshness | JTE-03 | ☑ | `outcome.ts` / `attention.ts`; named tests in `evaluators.test.ts`; report JTE-03 |
| §9 | Enhanced Owner UI | JTE-04 | ☑ | Stage strip / attention / clustered spine; named v1 fixture test; report JTE-04 |
| §12, §13.3, §15 Phase 4 | Proof, security, a11y, performance, deep links | JTE-05 | ☑ | Deep links + `reports/JTE-05-live-proof.md`; warm p95 471 ms; report JTE-05 |
| §11.1 | Cancellation snapshots | JTE-06 | ☑ | report JTE-06; test apply 4/25; production 48/11 unchanged |
| §11.2 | WordPress receipt | JTE-07 | ☑ | report JTE-07; test-path write + unique index on testvantagemovers; no-receipt golden kept |
| §11.3–11.4, §14 | Google read-back, move completion, Daily Assurance | **out of pack** | — | later Assurance |

## Acceptance criteria (specification §17)

Final sweep is JTE-05's job, but any issue that satisfies one ticks it
early with evidence.

| # | Criterion | Issue | Done |
| --- | --- | --- | --- |
| 1 | Page separates source receipt from official Lead creation | JTE-02 | ☑ | Named test `source receipt and lead creation remain separate events` |
| 2 | Every event has stage, evidence level, dual clocks, correlation, activity ID | JTE-02 | ☑ | `v1 fields remain populated on enhanced events` |
| 3 | No event is inferred solely to complete a visual lifecycle | JTE-02, JTE-03 | ☑ | No `inferred` level; WordPress invents no receipt. Missing edges are limitations, not invented events. |
| 4 | Current outcome distinguishes intake from official fact and surfaces contradictions | JTE-03 | ☑ | Named tests for intake / cancelled / contradictory; intake never official |
| 5 | Stage assessments distinguish not started, not applicable, attention, unverifiable | JTE-03 | ☑ | Policy skip `not_applicable`; booked cancellation `not_started`; delivery `unverifiable` |
| 6 | WordPress receipt and Google destination limitations are explicit | JTE-03 | ☑ | `WORDPRESS_RECEIPT_UNAVAILABLE`; `GOOGLE_DESTINATION_UNVERIFIED` |
| 7 | RingCentral confidence is bounded by its displayed provider cursor | JTE-03 | ☑ | `ringcentral_covered_through` + `ringcentral_cursor_lag_seconds` + `RINGCENTRAL_CURSOR_BOUNDED` |
| 8 | Sheet `synced` is never described as destination equality | JTE-03, JTE-04 | ☑ | JTE-03 emits `GOOGLE_DESTINATION_UNVERIFIED`. JTE-04 quotes that label in Proof boundaries; never “Sheet verified”. |
| 9 | No move-completion event appears without a new official fact | JTE-02 | ☑ | No move-completion kind added |
| 10 | No contact, content, provider payload, Sheet ID, or raw error leaks | JTE-01, JTE-05 | ☑ | JTE-01 masking + module redaction. JTE-05 goldens + live forbidden-field scan (`reports/JTE-05-live-proof.md`). |
| 11 | The server is the only evaluator of outcome, attention, and limitations | JTE-03, JTE-04 | ☑ | JTE-03 evaluators. JTE-04 renders `current_outcome`, `stage_assessments`, `attention`, `limitations` as given. |
| 12 | Runtime code no longer imports the prototype folder | JTE-01 | ☑ | `rg "scripts/prototypes/job-number-timeline" src` empty |
| 13 | Existing timeline tests and the new named tests pass | JTE-01–05 | ☑ | Server 1715/1628 pass; Admin 325 pass; named forbidden-field + a11y tests |
| 14 | Production proof is read-only, masked, and count-stable | JTE-05 | ☑ | `reports/JTE-05-live-proof.md` on testvantagemovers; production not authorized |
| 15 | The Timeline sends no notification and performs no reconciliation write | all | ☑ | No write or notify path added; CLI/proof stay zero-mutation |
| 16 | Daily Assurance can link to the page without importing its query logic | JTE-05 | ☑ | URL-only `buildJobTimelineHref({ job })`; `/daily` not created |

## Cross-issue findings

Work discovered in one issue that belongs to another. Do not fix it in
place — record it here and in the target issue.

| Found in | Belongs to | Finding | Recorded in issue |
| --- | --- | --- | --- |
| pack 2026-08-27 | JTE-02 | Loader does not read Observation Receipts, `ringcentral_processed_calls`, or the Call Log cursor. Those reads are JTE-02, not JTE-01. | JTE-02 §4 |
| pack 2026-08-27 | JTE-04 | Admin `JobTimelinePage` is a duplicated v1 type in `lib/api/jobNumberTimeline.ts`. Keep it renderable for v1 fixtures until JTE-04 consumes v2 additively. | JTE-04 §4 |
| pack 2026-08-27 | JTE-05 | `/intakes` reference drawers still mount forensic `JobTimeline`, not `/job-timeline?job=`. Deep-link work is JTE-05. | JTE-05 §6 |
| JTE-01 2026-08-27 | JTE-04 | Recommended Owner story UI is an activity-clustered vertical spine (time → rail → expandable cards; `activity_id` clusters as nested connectors). 21st generation: https://21st.dev/ai/dba79914-d479-4a56-9612-f47dea6cfda5. Catalog timelines are marketing-shaped; do not treat nyxbui Timeline 1074 as the v2 story. | JTE-04 |
| JTE-02 2026-08-27 | JTE-03 | `current_outcome`, stage assessments, attention, limitation catalog, and cursor-lag freshness are typed stubs. Do not treat them as shipped. Golden pages are in `src/services/jobNumberTimeline/golden-pages.ts`. | JTE-03 §4 |
| JTE-02 2026-08-27 | JTE-06 | Mongo loader does not query orphan Cancellations by snapshot (no field, no index). After JTE-06 writes + index, add that hop. | JTE-06 §4 |

## Open questions for the Owner

Anything an issue could not decide from the specification. An issue that
hits one sets itself `blocked` and adds a row.

| Raised by | Date | Question | Answer | Answered |
| --- | --- | --- | --- | --- |
| JTE-06 | 2026-08-27 | Write-path + report-first backfill authorization for Cancellation snapshots? | Owner authorized JTE-06 write-path + report-first backfill on the **test database only** (`testvantagemovers`). Production apply, production index apply, and any backfill of `vantagemovers` remain unauthorized until a later explicit Owner approval plus the existing CLI confirm flag. | 2026-08-27 |
| JTE-07 | 2026-08-27 | Source-assurance authorization for WordPress durable receipt capture? | Owner authorized a **new WordPress receipt write path on the test form path / `testvantagemovers` only**. Unique idempotency index is report-first; apply on the test DB only if the write is unusable without it. Production form injection, production index apply, and backfilling receipts onto historical WordPress Leads remain unauthorized. | 2026-08-27 |

## Issue log

Append-only. Newest last. One entry per pickup, block, and close.

```text
2026-08-27 · pack created · JTE-01 ready; JTE-02–05 blocked on prerequisites;
             JTE-06 and JTE-07 deferred pending separate write / source-assurance
             approval. No runtime code changed.
2026-08-27 · JTE-01 picked up · status active · repos: vantage-main-server ·
             branch: job-timeline-enhancement (created from clean main).
2026-08-27 · JTE-01 closed · complete · src/services/jobNumberTimeline/ is the
             runtime seam; src/ has no prototype imports; JTE-02 is ready.
             See reports/JTE-01-completion.md.
2026-08-27 · JTE-02 picked up · status active · repos: vantage-main-server ·
             branch: job-timeline-enhancement (existing; no new branch).
2026-08-27 · JTE-02 closed · complete · ok pages are job_timeline.v2 with
             source_received, dual clocks, correlation, activities; JTE-03 is
             ready. Outcome/attention/limitations are not shipped.
             See reports/JTE-02-completion.md.
2026-08-27 · JTE-03 picked up · status active · repos: vantage-main-server ·
             branch: job-timeline-enhancement (existing; no new branch).
2026-08-27 · JTE-03 closed · complete · evaluators fill outcome, stages,
             attention, limitations, freshness; JTE-04 is ready. Admin UI
             is not shipped. See reports/JTE-03-completion.md.
2026-08-27 · JTE-04 picked up · status active · repos: vantage-admin
             (implementation) + vantage-main-server (docs ledger + JTE-03
             goldens/types read-only) · branch: job-timeline-enhancement
             (created from clean vantage-admin main; server branch already
             existed). No extra feature branches. Not pushed.
2026-08-27 · JTE-04 closed · complete · Admin renders server v2 hierarchy
             (stage strip, attention, clustered spine, proof boundaries);
             v1 fixtures remain renderable. JTE-05 is ready. Live proof
             and deep links were not done. See reports/JTE-04-completion.md.
2026-08-27 · JTE-05 picked up · status active · repos: vantage-admin
             (deep links, a11y) + vantage-main-server (live proof, security
             serialization, Owner vs Admin 403) · branch:
             job-timeline-enhancement (existing pack branch in both repos;
             no extra feature branches). Not pushed.
2026-08-27 · JTE-05 closed · complete · Owner deep links, live masked
             proof, forbidden-field scan, a11y names, warm p95 471 ms.
             JTE-06/07 stay leftover. See reports/JTE-05-completion.md
             and reports/JTE-05-live-proof.md.
2026-08-27 · JTE-06 picked up · status active · repos: vantage-main-server ·
             branch: job-timeline-enhancement (existing pack branch;
             no extra feature branches). Not pushed. Owner authorized
             write-path + report-first backfill on testvantagemovers only.
             Production apply / index / vantagemovers backfill remain
             unauthorized. JTE-07 stays leftover.
2026-08-27 · JTE-06 closed · complete · four immutable snapshots on official
             Cancellation create; report-first inventory (prod 48/11, test
             25/4); test-DB index + 4-row backfill only; Mongo hop by
             indexed normalized_job_no_snapshot. JTE-07 stays leftover.
             See reports/JTE-06-completion.md.
2026-08-27 · JTE-07 picked up · status active · repos: vantage-main-server
             (implementation; vantage-movers-clients participation to
             confirm). branch: job-timeline-enhancement (existing pack
             branch; no extra feature branches). Not pushed. Owner
             authorized WordPress receipt write on the test form path /
             testvantagemovers only. Unique idempotency index is
             report-first. Production form injection / index apply /
             historical backfill remain unauthorized. Schema to be
             authored in JTE-07.md before any runtime edit.
2026-08-27 · JTE-07 closed · complete · WordPress receipt on authorized
             test form path / testvantagemovers; unique + lead-ref
             indexes applied on test DB only; timeline emits wordpress
             source_received only when the receipt exists; no-receipt
             golden kept. vantage-movers-clients did not participate.
             See reports/JTE-07-completion.md. Pack ready to ship.
2026-08-27 · review follow-up · Owner approved four warnings from the
             Job Timeline Enhancement Review. Snapshot-only Cancellation
             is a found cancelled page plus OFFICIAL_BOOKING_UNAVAILABLE;
             WordPress attach is fail-closed and forces a transaction;
             timeline admin 500 no longer echoes error.message.
```
