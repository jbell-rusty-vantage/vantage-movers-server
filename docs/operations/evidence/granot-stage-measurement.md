# Sealed Estimates run cost on the disposable replica

The worker needs the claimed run ID and status to choose its next step. A projection on the existing atomic claim returns those two fields. The subsequent primary-fenced planning or apply read still loads the state it owns. Apply validates the full plan checksum, approval checksum, selected actions, original deadlines and closed-run fence. The queue filter, sort, lease update and attempt increment are unchanged.

## Matched workloads

Each fresh workload used a one-row Estimates report, an existing Form Lead and Record Link, and an open Outreach subject. Synthetic HTTP responses went through both logins, form validation, report parsing, canonical identity planning and immutable plan lock. Owner approval used the sealed checksum. Queue delivery was disabled and the harness invoked the ordinary workers directly. The real canonical command, Mongo transactions, outbox planning and Outreach nomination ran on the dedicated single-member replica.

| Workload | Mongo commands, both | Returned document BSON before → after | Submitted update-expression BSON, both | Submitted insert BSON, both |
|---|---:|---:|---:|---:|
| Genuine change | 104 | 33,496 → 28,920 | 10,192 | 7,166 |
| Fresh unchanged | 92 | 31,297 → 26,754 | 9,104 | 4,244 |
| Older report approved last | 76 | 26,630 → 22,099 | 7,620 | 4,231 |
| Recapture original terminal operation | 4 | 2,431 → 2,431 | 272 | 1,488 |

Each planning claim returned 868 → 41 bytes. The applying claim returned 3,792 → 43 on the genuine change, 3,759 → 43 on unchanged and 3,747 → 43 on stale. Every other stage had identical command counts, returned BSON and submitted mutation BSON. Replay entered the action with the original operation and provider capture time, without supplying an embedded run result. Duplicate capture and the terminal receipt returned the original receipt, Observation and Decision IDs. Replay timing reflects this action-level re-entry. The paired fixture had already checkpointed the original run.

[Before measurements and per-stage commands](granot-measurement-before.json) · [After measurements, approvals and temporal traces](granot-measurement-after.json)

An independent candidate run reproduced every stage count and byte total. A fourth sealed report then made a genuine priority change. After the canonical transaction and receipt completion, the fixture changed the local worker's lease epoch before its first checkpoint. The old worker's write failed its fence. The next worker reused the exact operation, receipt, Observation, Decision and unchanged Lead revision 6, checkpointed once and completed the original approval before expiry. It repeated zero canonical effects. That separate run used production implementations of capture, lifecycle execution and worker recovery with the same fake HTTP boundary. [Repeated measurements and actual crash chain](granot-measurement-repeat.json)

## Effects that remained

| Workload | Durable Lead and lifecycle effects |
|---|---|
| Genuine change | The matched Form changed from priority 0 to 5 and became quoted. Revision advanced from 4 to 5. The command, one EntityChange, one queued Sheet intent and one existing-subject Outreach refresh survived commit. |
| Fresh unchanged | A new receipt, Observation and Decision advanced the accepted observation. Revision stayed 5. The existing subject received a new receipt-specific refresh. |
| Stale | The provider row was collected and sealed first. Its Owner approved it after both newer observations. Its receipt, Observation and stale Decision remained. Revision and accepted observation stayed fixed. |
| Replay | All measured collection counts and retained BSON sizes stayed fixed. Receipt/Observation/Decision IDs matched the original genuine change. The later accepted observation remained the winner. |

The genuine, unchanged and stale workloads retained respectively 4,484, 3,855 and 3,750 BSON bytes across their receipt, Observation and Decision. The underlying data files also report command, EntityChange, pending Sheet and Outreach job BSON. One Form Lead existed throughout. The fixture created zero Call Leads, official Bookings or Cancellations. Independent databases allocate their own IDs and clock values. Within each run the proof checked the exact operation-to-receipt linkage, every Decision pointer, original plan and approval, and expiry and purge timestamps.

The read-only operator trace reached each real canonical Lead. It reported the current temporal tuple for genuine and unchanged and an older observation for stale. The harness blocked provider delivery, so the durable evidence ends at Sheet intent and Outreach nomination.

## Fixture calibration

The first end-to-end attempt stopped at `INDEX_REQUIRED` after committing a real local Lead effect. The empty fixture database lacked the existing CSI job deduplication index required for open-subject nomination. The launcher removed that generated database. The successful pair and repeat provisioned the same declared deduplication index before measurement. Each JSON records the base Git commit and the working `runWorkflow.ts` SHA-256. Both sides included the in-batch expiry check, so the measured difference isolates the claim projection.

## Reproduce and interpret

With the dedicated single writable member `capacityp1` at `127.0.0.1:27216`, run this from the server root with an unused output path.

```powershell
node --import tsx ops/capacity/granot-phase-two.replica.ts "$env:TEMP/granot-measurement-$([guid]::NewGuid()).json"
```

Each invocation uses an empty random test database. The launcher verifies every advertised replica member, removes inherited service settings, uses a fresh credential profile and drops its own database on exit. It supplies synthetic Sheet container IDs and installs the repository's test queue/Daily Operations protections. Fixture, trace, inventory, local index setup and cleanup reads sit outside the measured stages.

The Mongo driver counts commands and the BSON size of returned cursor documents or a find-and-modify value. It also sizes each submitted insert document and update expression, including no-match fences and an attempted duplicate insert on replay. These metrics exclude acknowledgement envelopes, command filters, network protocol and compression, index pages, storage-engine writes and oplog bytes. Retained collection BSON is measured independently. Single-row warm local measurements establish neither fleet throughput nor production benefit. Reverting the projection restores the larger response with the same stored run and lifecycle records.
