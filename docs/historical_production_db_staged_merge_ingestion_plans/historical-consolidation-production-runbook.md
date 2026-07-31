# Historical consolidation production runbook

Status: implementation complete; snapshot, rehearsal, approval, and production apply have not run.

This runbook is the operator checklist for the canonical commands in
`scripts/historical_production_db_staged_merge_ingestion/`. The pipeline reads
the reviewed historical Sheets and Mongo databases, but it never calls server
routes and never writes or queues writes to Master Leads, Master Booked,
Granot, messages, notifications, enrichment, or email.

## Approval boundary

Preparing a snapshot, manifest, rehearsal, backup, and evidence does not
authorize production mutation. Stop after the rehearsal evidence is complete
and present the exact immutable manifest hash and aggregate report to the user.
Only run the production command after the user approves that exact hash.

## Operator sequence

1. Check out the reviewed Git SHA, install the locked dependencies, set
   `MONGO_URI` and the read-only Google service-account configuration, and keep
   all generated artifacts in an access-controlled location because snapshots
   contain PII.
2. Run `pnpm historical:stage -- --output=<new-snapshot-path>`. Do not use
   `--write-stage` unless staging-sidecar persistence was separately intended.
3. Create a freshly signed Owner actor file and run
   `pnpm historical:plan -- --snapshot=<snapshot-path> --actor=<actor-json> --planning-timestamp=<fixed-ISO> --output=<new-manifest-path>`.
4. Review the adjacent aggregate report. Blocking conflicts must be zero.
   Decisions or mapping changes require a new manifest; never edit a manifest.
5. Restore the identified production backup into `testvantagemovers`. Stop all
   API, cron, and queue workers that could write to that database.
6. Run rehearsal preflight, apply, verification, second apply, and second
   verification exactly as shown in the scripts README. The second apply must
   report zero inserts and zero updates.
7. Dry-run and apply rollback on the rehearsal database, verify the restored
   state, restore a fresh copy again, reapply, and verify. Record the backup ID,
   restore-test evidence ID, and the three true rehearsal-evidence flags.
8. Take a fresh production backup and confirm its restore test. Re-run the
   production preflight immediately before approval. Any Sheet, database,
   mapping, decision, code, index, or cluster-fingerprint change invalidates
   the reviewed manifest and requires replanning/rehearsal.
9. Present the exact manifest hash, Git SHA, operation/count report, conflicts,
   quarantine totals, backup/restore IDs, and rehearsal evidence to the user.
   Stop and wait for explicit approval of that hash.
10. After approval, run the exact production command from the scripts README.
    Save stdout/stderr and the verification artifact. Do not start runtime
    workers until verification reports `ok: true` and prohibited side-effect
    deltas are all zero.

## Abort and rollback

Stop on any checksum, index, fencing, compare-and-swap, count, reference,
allocation, duplicate-job, or side-effect verification error. Preserve the
journal and artifacts. Do not hand-edit target records. Production rollback
requires its own exact manifest-hash and immediate confirmation phrase; it
deletes only unchanged migration-owned inserts, restores exact before-images,
deactivates referenced migration-created catalogs, and journals later-write
conflicts for human resolution.
