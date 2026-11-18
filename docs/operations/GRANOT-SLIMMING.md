# Granot and Outreach storage cutover

November 18, 2026. Dashboard-initiated Granot runs, custom Reporting, and the custom Google Drive and Picker integration are retired. The scheduled Estimates worker accepts system-owned slot runs. The extension and the Master Leads and Master Booked Sheet Sync remain active. Existing manual work has no execution path.

## What stays in MongoDB

A true webhook receives HTTP 202 after durable capture. Queue delivery wakes the worker and a five-minute cron recovers missed work. A technical failure backs off. The tenth consecutive failure reaches a dead letter for an operator to inspect and requeue. An unmatched Lead has its own business retry window, up to 24 hours. Both paths retain their input while work is pending.

Daily Operations keeps Eastern-day webhook counts. Routine lead and job histories use business records, changes and pinned case evidence. The original transport detail is available through the archive recovery commands. Historical case pins, pairing evidence and invalid-priority capture times have resumable backfills. Deploy the reader-compatible server before running them.

Eligible scheduled runs close after their 24-hour execution window. The worker validates the plan, actions and terminal results, writes checksummed Cloud Storage objects, verifies them, then commits the replay index and compact run. A failed upload retries independently. Pending and held evidence keeps its recovery owner. Automatic receipt expiry follows the existing seven-clean-UTC-day promotion rule. Ordinary receipt cleanup and run compaction have separate controls and measurements.

Known completed subject-revision evaluations, receipt-triggered evaluations and routine Estimates refreshes receive a three-day expiry when they complete. Older jobs follow their original deadlines. Admissions, nudge/coverage/repair results and other unclassified completions keep their existing 14-day contract. Pending, leased, retry and dead-letter work keeps its recovery state. The CSI audit TTL remains 90 days.

Subject refreshes can coalesce by generation after shadow comparison. The separate shortcut that omits a receipt nomination when its transaction already requested a subject revision requires `estimates_revision_nomination_ref` on the active Outreach configuration. Record the W1 observation evidence, including the November 18 and 23 evening checkpoints, before enabling that shortcut.

## Operator checks

1. Confirm both master workbooks, the Admin scheduled freshness reader and the three extension operations. Confirm the retired manual/report endpoints and cron registrations are absent.
2. Run `ops/granot-read-facts-backfill.ts --apply`, then `ops/granot-case-evidence-backfill.ts --apply all` and `--review all`. Inspect missing or mismatched inputs before releasing their transport evidence.
3. Use `ops/granot-enroll-scheduled-archives.ts --preview <UTC cutoff> <limit>` and then `--apply` to enroll a bounded set of old completed runs. Verify exact recovery with `ops/granot-read-archived-evidence.ts`. The archive worker records its outcomes at each two-minute tick.
4. Review subject refresh parity in `sales_outreach_refresh_requests`. Use `ops/sales-outreach/refresh-rollout.ts <database> shadow <approval>`, and then `active <approval> <parity reference>` once the shadow evidence supports activation. `off <approval>` restores legacy nominations. Drain outstanding active generations before rolling the server binary back to a version without refresh support.
5. Restore the exclusive feature backup in isolation and compare every BSON record and index before dropping the manifest's namespaces. Keep the two master sheets, the mixed scheduled-run collection and shared audit ledgers. Reintroducing the retired services requires restoring the feature data and indexes before rolling binaries back.
