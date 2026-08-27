# PROGRESS — Job Timeline Enhancement

**This is the live ledger. Every issue updates it — on pickup and on close.**
It is a navigation aid, not an authority. Where it disagrees with the
repository, the repository is right and the next agent fixes this file.

Pack created 2026-08-27. Protocol: [`AGENT-PROTOCOL.md`](AGENT-PROTOCOL.md).

## Issue status

| Issue | Title | Prereqs | Status | Owner / agent | Started | Closed | Report |
| --- | --- | --- | --- | --- | --- | --- | --- |
| [JTE-01](issues/JTE-01.md) | Extract deep runtime module; route and CLI use it | current timeline | `ready` | — | — | — | — |
| [JTE-02](issues/JTE-02.md) | v2 types, dual clocks, evidence/correlation/activity | JTE-01 | `blocked` | — | — | — | — |
| [JTE-03](issues/JTE-03.md) | Outcome, stage assessment, attention, limitations, freshness | JTE-02 | `blocked` | — | — | — | — |
| [JTE-04](issues/JTE-04.md) | Enhanced Owner UI and evidence expansion | JTE-03 | `blocked` | — | — | — | — |
| [JTE-05](issues/JTE-05.md) | Live proof, security, accessibility, performance, deep links | JTE-04 | `blocked` | — | — | — | — |
| [JTE-06](issues/JTE-06.md) | Cancellation correlation snapshots and report-first backfill | JTE-02; write approval | `deferred` | — | — | — | — |
| [JTE-07](issues/JTE-07.md) | WordPress durable receipt capture | source-assurance approval | `deferred` | — | — | — | — |

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
| §1.3, §10, §15 Phase 0 | Production module; no runtime import of the prototype | JTE-01 | ☐ | |
| §4.1 `source_received`, §5, §6 event fields, §7 | v2 events, dual clocks, correlation, activities | JTE-02 | ☐ | |
| §4.2–4.3, §6 page fields, §8 | Outcome, stages, attention, limitations, freshness | JTE-03 | ☐ | |
| §9 | Enhanced Owner UI | JTE-04 | ☐ | |
| §12, §13.3, §15 Phase 4 | Proof, security, a11y, performance, deep links | JTE-05 | ☐ | |
| §11.1 | Cancellation snapshots | JTE-06 | ☐ | deferred |
| §11.2 | WordPress receipt | JTE-07 | ☐ | deferred |
| §11.3–11.4, §14 | Google read-back, move completion, Daily Assurance | **out of pack** | — | later Assurance |

## Acceptance criteria (specification §17)

Final sweep is JTE-05's job, but any issue that satisfies one ticks it
early with evidence.

| # | Criterion | Issue | Done |
| --- | --- | --- | --- |
| 1 | Page separates source receipt from official Lead creation | JTE-02 | ☐ |
| 2 | Every event has stage, evidence level, dual clocks, correlation, activity ID | JTE-02 | ☐ |
| 3 | No event is inferred solely to complete a visual lifecycle | JTE-02, JTE-03 | ☐ |
| 4 | Current outcome distinguishes intake from official fact and surfaces contradictions | JTE-03 | ☐ |
| 5 | Stage assessments distinguish not started, not applicable, attention, unverifiable | JTE-03 | ☐ |
| 6 | WordPress receipt and Google destination limitations are explicit | JTE-03 | ☐ |
| 7 | RingCentral confidence is bounded by its displayed provider cursor | JTE-03 | ☐ |
| 8 | Sheet `synced` is never described as destination equality | JTE-03, JTE-04 | ☐ |
| 9 | No move-completion event appears without a new official fact | JTE-02 | ☐ |
| 10 | No contact, content, provider payload, Sheet ID, or raw error leaks | JTE-01, JTE-05 | ☐ |
| 11 | The server is the only evaluator of outcome, attention, and limitations | JTE-03, JTE-04 | ☐ |
| 12 | Runtime code no longer imports the prototype folder | JTE-01 | ☐ |
| 13 | Existing timeline tests and the new named tests pass | JTE-01–05 | ☐ |
| 14 | Production proof is read-only, masked, and count-stable | JTE-05 | ☐ |
| 15 | The Timeline sends no notification and performs no reconciliation write | all | ☐ |
| 16 | Daily Assurance can link to the page without importing its query logic | JTE-05 | ☐ |

## Cross-issue findings

Work discovered in one issue that belongs to another. Do not fix it in
place — record it here and in the target issue.

| Found in | Belongs to | Finding | Recorded in issue |
| --- | --- | --- | --- |
| pack 2026-08-27 | JTE-02 | Loader does not read Observation Receipts, `ringcentral_processed_calls`, or the Call Log cursor. Those reads are JTE-02, not JTE-01. | JTE-02 §4 |
| pack 2026-08-27 | JTE-04 | Admin `JobTimelinePage` is a duplicated v1 type in `lib/api/jobNumberTimeline.ts`. Keep it renderable for v1 fixtures until JTE-04 consumes v2 additively. | JTE-04 §4 |
| pack 2026-08-27 | JTE-05 | `/intakes` reference drawers still mount forensic `JobTimeline`, not `/job-timeline?job=`. Deep-link work is JTE-05. | JTE-05 §6 |

## Open questions for the Owner

Anything an issue could not decide from the specification. An issue that
hits one sets itself `blocked` and adds a row.

| Raised by | Date | Question | Answer | Answered |
| --- | --- | --- | --- | --- |
| — | — | — | — | — |

## Issue log

Append-only. Newest last. One entry per pickup, block, and close.

```text
2026-08-27 · pack created · JTE-01 ready; JTE-02–05 blocked on prerequisites;
             JTE-06 and JTE-07 deferred pending separate write / source-assurance
             approval. No runtime code changed.
```
