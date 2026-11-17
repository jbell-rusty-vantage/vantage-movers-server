# Backup recovery blocker: November 17 OOM confirmed

**Outcome still needed:** a fresh successful backup and isolated restore proof before index maintenance, retention deletion or compaction. Read-only Cloud Run system logs now establish **out-of-memory events on both November 17 attempts**, replacing the earlier unknown-cause assessment for those attempts. No job was triggered, configuration changed, permission granted, backup downloaded or restore performed.

## Evidence

Target: Cloud Run job **`vantage-mongodb-backup`**, project **`vantage-sheets-496816`**, region **`us-east1`**, execution **`vantage-mongodb-backup-dvt6f`**. Current job generation 2: **1 vCPU, 1 GiB memory, 1 retry, 1,200-second timeout**, no separately configured volume/mount returned by the targeted configuration read.

| UTC time, November 17 | Evidence |
|---|---|
| 07:15:24.991 | First `backup.started` |
| 07:19:16.160 | Cloud Run system log: **“Out-of-memory event detected in container”** |
| 07:19:16.217 | `backup.failed`: `mongodump failed with exit 1: no output` |
| 07:19:16.411 | System log: `Container called exit(1).` |
| 07:19:26.411 | Retry `backup.started` |
| 07:22:22.523 | Cloud Run system log: **“Out-of-memory event detected in container”** |
| 07:22:22.575 | Same `mongodump` failure |
| 07:22:22.774 | System log: `Container called exit(1).` |

The bounded Cloud Monitoring read for `run.googleapis.com/container/memory/utilizations`, 07:14–07:24 UTC, returned one series with nine minute points, no pagination. Recorded distribution means rose from **41.68% → 60.97% → 83.48% → 99.47%** during the first attempt, and **51.18% → 75.69% → 97.11%** around the retry. Two points lacked a returned mean and remain unknown, not asserted zero. Minute samples do not measure the instantaneous failure peak, but corroborate the explicit system OOM events.

The prior execution inventory establishes eight daily job failures November 10–17. This follow-up examined **November 17 only**; it does not independently prove the cause of every earlier failure. No storage/network/authentication error was found in this bounded latest-execution evidence, which does not establish that such errors are universally absent.

## Mechanism and diagnostic loss

`ops/cloud/mongodb-backup/backup.mjs` writes the full compressed dump to `os.tmpdir()` **before** computing SHA-256 and uploading it. Cloud Run's writable filesystem consumes instance memory, shared with Node, `mongodump` and other process allocations. The existing November 8 archive is already **741,165,628 bytes**; that is historical archive size, not today's expected dump size or the precise memory used at failure. Google documents both filesystem memory accounting and the need to include files in job memory sizing. [Cloud Run runtime filesystem contract](https://docs.cloud.google.com/run/docs/container-contract#file_system), [Cloud Run job memory limits](https://docs.cloud.google.com/run/docs/configuring/jobs/memory-limits)

The launcher currently handles `child.on("close", (code) => ...)` and stores `code ?? 1`, discarding the signal argument. With `--quiet`, the resulting error can be indistinguishable from an ordinary exit 1. **The OOM is directly established; exact child signal and file-versus-process byte attribution were not retained.** Do not claim that the application logs recorded SIGKILL or that file size alone was measured as the cause.

## Concrete next repair proposal — not executed

1. **Bounded recovery canary:** after explicit approval for this Cloud Run resource change, raise only this job's memory from **1 GiB to 2 GiB**, keeping its existing 1 vCPU, identity, secrets, database, immutable GCS destinations, schedule, timeout and retry settings. Two GiB is a proposed canary setting, **not a demonstrated sufficient limit**. Google supports up to 4 GiB at 1 vCPU; no CPU increase is proposed. Memory allocation changes billed resource usage, so this is outside the application-only Vercel release.
2. Approve and run **one normal backup execution** in a monitored low-business-load window, with at most the existing one retry: **two attempts, each capped at 1,200 seconds**, approximately 40 minutes total task runtime plus platform startup/scheduling overhead. No second manual execution is included. At 2 GiB/1 vCPU, that bounds task-runtime allocation to approximately **4,800 GiB-seconds and 2,400 vCPU-seconds** if both attempts exhaust their limit; these are resource bounds, not an invoice estimate. Monitor instance memory, Atlas disk/CPU/replication and application error/latency. Stop further attempts/cancel this authorized execution if memory again approaches/exceeds **90%**, another OOM occurs, an integrity/verification failure appears, member lag exceeds **30 seconds**, or representative business p95 exceeds **2× baseline for five minutes**. Do not silently escalate memory or repeatedly trigger full dumps. Retain the execution identity and exact resulting artifact generation/checksum.
3. Success requires **dump completion, upload completion, metadata verification, success manifest and actual isolated restore** of that exact generation. Verify collection/index counts and representative Sheet Timeline, Outreach admissions/replay and Granot closure data. A successful Cloud Run status alone is not restore readiness. Restore must not target production or use production `--drop`.
4. Independently review a small launcher fix to preserve exit code **and signal**, emit bounded non-sensitive failure-stage/archive-size/memory diagnostics and cap captured child stderr/stdout. Prove credential redaction and failure handling in local tests. This proposal does not authorize printing Mongo configuration or customer content.
5. For sustainable growth, replace full-archive in-memory staging with a reviewed streaming or disk-backed design. Preserve gzip archive format, byte checksum, immutable generation naming, upload preconditions, terminal-success-only manifests and restoration compatibility. Stream failures may leave incomplete/orphan objects; never publish a success manifest for them or add deletion permissions as a shortcut. Prove interruption, upload failure, retry, checksum and restore behavior before changing the production backup implementation.

The immediate configuration rollback is restoring **1 GiB**, but that reinstates the known failure risk and is not an acceptable recovery outcome. Preserve already-successful immutable archives through any rollback. No retention/lifecycle policy, object deletion permission or backup destination should change as part of this repair.

**Decision to request:** authorize the single job's **1 GiB → 2 GiB** configuration change and one bounded execution described above, followed by download/checksum verification and restore of that new archive to an explicitly verified, disposable **local loopback MongoDB** database `restore_probe_backup20261117` (empty target, no production connection, no production `--drop`). If that local target cannot be safely verified or lacks capacity, stop before restoring and present the actual alternative target/cost. The observed workload requires more than the current 1 GiB limit at failure; **the complete-run requirement remains unknown**, so 2 GiB is a measured-pressure-informed canary choice rather than a guarantee. The alternative is to defer another dump and separately authorize a streaming/disk-backed implementation; neither option is implemented by this report.

## Saved sanitized evidence

- [Current resource configuration](evidence/backup-final-configuration-2026-11-17.json)
- [System messages proving both OOM events](evidence/backup-final-system-messages-2026-11-17.json)
- [Bounded log inventory and stages](evidence/backup-final-diagnosis-logs-2026-11-17.json)
- [Minute memory-utilization measurements](evidence/backup-final-memory-metrics-2026-11-17.json)

Raw bounded logs were processed privately; only selected system text and allowlisted metadata were saved in the repository. Credentials stayed in-process. This document changes diagnosis and the next repair decision; it does not claim the backup is repaired or current cleanup gates have passed.
