# Granot storage retention

## Releasing a production archive generation

The bucket deletes Granot objects under `history/granot/v1/vantagemovers/` and `history/granot/released/vantagemovers/` after 30 days measured from the object's release marker (`customTime`). Unmarked generations stay available. Bucket soft deletion adds seven days of recovery after lifecycle deletion.

For a content-addressed production archive, first establish that its last reader, replay and backup obligations have ended. Include historical catalog exports, standalone rollback packs and daily and weekly backups. Check that every external publisher has finished or uses the release-aware writer. A missing current MongoDB pointer alone cannot establish this.

Record the exact `hash` and string `generation` in a JSON file with evidence references in `reader_clearance`, `backup_clearance`, `rollback_clearance` and `external_writer_clearance`. Run the following from the server root against the verified production deployment.

```sh
node --env-file=.env --import tsx ops/granot-release-archive-generation.ts begin evidence.json
# Allow at least 800 seconds for any publication already in flight to drain.
node --env-file=.env --import tsx ops/granot-release-archive-generation.ts release evidence.json
```

Both commands check live MongoDB references. The release checks the original evidence digest and review hold before updating the exact GCS generation and metageneration. Reuse invalidates the review or holds a released generation before publishing a new pointer. A later review starts a fresh recovery window once those obligations end.

The main server owns retention. Terminal scheduled Estimates plans can move to Cloud Storage after their original action deadline. Superseded completed Lead snapshots enter archive review after one day. Historical cleanup uses a separate operator-reviewed manifest.

## Online processing

The authenticated `/api/cron/granot-storage-retention` job reviews up to 64 due receipts and four scheduled runs every two minutes. Receipt review requires completion, capture and decision times all older than 24 hours. Only receipts both created and captured on or after the original policy cutover enter automatic expiry. Active leases, pending matches, dead letters, booking actions, unresolved or ambiguous outcomes, Priority 5 and invalid priorities remain available to their operators. Each declined candidate has another review date.

The reviewer requires a valid Lead snapshot, one live terminal decision, a newer accepted winner, no protected holders and exact historical reconstruction. A stale result must identify an older temporal winner. An HTTP action also needs a matching closed-run replay record. A true webhook must have the transactional day-count acknowledgment and a materialized or finalized Daily Operations day. A browser extension operation must have the exact terminal result for its unique operation key. The publication transaction rereads current sources, holders, day evidence and the newer winner. Future mode stamps the established routine HTTP cohort for TTL. It retires qualifying webhook and effect-bearing detail within the transaction. Extension receipts keep a compact unique key, kind, payload hash, original result and archive pointer for redelivery and conflict detection. Daily counters separately report verified chains, direct retirements and TTL stamps.

Cloud Storage holds checksummed BSON under `history/granot/v1` in the private Mongo backup bucket. This prefix lies outside the daily and weekly backup expiry rules. Month catalog rows point at immutable verified objects and use compare-and-swap when more history arrives. Diagnostic readers verify stored contents against their hash and use the recorded generation when present. Closed-run indexes preserve operation ID, kind, payload hash and original result after the hot run expires.

## Scheduled run closure and recovery

New scheduled runs carry no purge date until closure. At the original action expiry the reviewer compares every approvable action, sealed checksum, committed result, payload hash and downstream refresh marker. It also verifies an empty operation namespace for a zero-action plan. Held or skipped rows survive in the original plan. Before replacing the plan and action results with a summary, the worker restores and compares the exact original run BSON and the replay object, then rereads the source and operation set inside a transaction. The summary retains slot coverage, freshness tallies and unapplied counts through the dispatch window. The closed-run index continues to fence deterministic child creation after the summary expires.

The cron returns `scheduled_runs.oldest_due_at`, held and failure counts. A held source records its status, reason, last check and next review time. Terminal errors and unproven rows have no purge date and remain visible until dispositioned. Storage or verification failures return HTTP 503 and retry in 30 minutes. Held rows retry after a day. Archive retries do not reclaim or apply a business operation.

Install the sparse scheduled-review index with the idempotent `ops/granot-retention-install.ts --install-shadow`. For an existing completed scheduled run with a legacy TTL, use `ops/granot-enroll-scheduled-archives.ts --preview <past UTC cutoff> [page size]`, then `--apply` with the same arguments. Enrollment schedules review and clears the legacy TTL on one bounded page. The worker still checks each run before compaction. With the server environment loaded, execute these commands with `node --import tsx`.

For an on-demand restore, run `ops/granot-read-archived-evidence.ts --run <run ID> <new private BSON file>` for the original run. Use `--receipt <receipt ID> <new private BSON file>` for a retired webhook, extension operation or effect-bearing HTTP receipt. Routine HTTP history is indexed by job and month. Its original operation result is indexed by run/action.

Enroll the legacy tail with `ops/granot-enroll-scheduled-archives.ts --migrate <production alias cutover UTC> [pages] [page size]`. Each invocation processes at most 128 pages of 500 IDs. The migration checkpoints examined and enrolled totals transactionally at each page. Scheduled system runs in all statuses keep their original action deadline. One fixed-range pass can begin immediately. A final pass catches old invocations that overlapped the cutover, once the server's 800-second maximum invocation lifetime has elapsed. A first invocation after that interval can finish in a single pass. Repeat with the same cutover until `--migration-status` reports `complete`. Later calls return the existing checkpoint.

## Rollout and historical review

Run ops/granot-retention-install.ts --install-shadow using the main server environment. It first proves the sparse purge indexes have no pre-existing date to activate before converting them to TTL. Reinstallation preserves the original cutoff and mode. Shadow archives eligible future chains and records observations without issuing purge dates. Future mode stamps eligible new chains. Require archive restoration, replay/freshness parity, protected-record exclusions and shadow evidence before promotion. Keep the original cutoff fixed.

After the live deployment, backfills, history restoration and Pool comparison have been verified, the operator can arm future-only retention with `ops/granot-retention-install.ts --arm-future <existing new_data_from ISO timestamp>`. Arming preserves shadow mode. Promotion requires seven consecutive complete UTC days after both arming and working-set maturity. Each day must include at least 100 chains that passed the final reference/replay checks, three live comparisons of certified and historical Pool reads, no mismatches or failed batches, and zero TTL stamps. Every subsequent future-mode chain still passes the individual transactional checks. Missing evidence keeps the policy in shadow. The cutoff excludes the historical deletion manifest throughout. To disarm before promotion, remove only the armed_at field while mode is shadow.

The historical pilot is prepared with ops/granot-history-archive.ts, ops/granot-archive-run-closure.ts and ops/granot-targeted-deletion-dry-run.ts. The last command requires a new private JSON output file. It compares hot evidence with its archive, verifies closed-run replay, fresh production deployment ancestry, current winning Lead and references, and reports logical bytes and per-chain exclusions. A manifest represents a point in time. Recheck it immediately before any separately authorized deletion. These commands do not delete historical records.

Use ops/verify-granot-future-retention.ts with a disposable loopback replica on port 27961 to exercise shadow, future, archive, replay, TTL selection and historical cutoff behavior. This verifier also writes synthetic test archive objects. The four-year runway requires the future working set and durable growth to be measured over time. Compare daily capacity snapshots, review throughput, unresolved backlog and archive catalog growth.

### Routine HTTP replay and archive publication

A completed effect-free HTTP automation result for an already-current or stale Form Lead or Call Lead stores the decision, observation and target IDs as BSON ObjectIds in its replay cache. The reader expands either cache format into the original result, including the empty effects array, and falls back to the latest Synchronization Decision when the cache belongs to an earlier decision. Other outcomes retain the full result. Reverting the writer should preserve the mixed-format reader so a compact receipt can still replay during a TTL deletion interval. Archived history and closed runs use their existing format. New history pages and run closures decode the same Cloud Storage bytes that passed checksum verification before publishing a Mongo pointer.
