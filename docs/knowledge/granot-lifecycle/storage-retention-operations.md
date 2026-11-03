# Granot storage retention

The main server owns retention. Routine completed HTTP automation checks can leave the live receipt, observation and decision collections after seven days. The historical cleanup is a separate operator-reviewed operation.

## Online processing

The drainer schedules review for completed automation actions with an already_current or stale decision and no effects. The authenticated /api/cron/granot-storage-retention job reviews up to 64 due receipts every two minutes. Only receipts both created and captured on or after the policy's new_data_from date can enter automatic expiry. Pending work and other channels keep their existing lifecycles.

The reviewer requires a valid Lead snapshot, one live no-effect decision (stale must specifically mean older than the temporal winner), a newer accepted winner, no protected references, exact historical reconstruction and a matching closed-run replay record. Its transaction checks the source documents and references again before setting purge dates. Receipts that do not pass return to review a day later. A lease limits concurrent workers. Daily counters in granot_retention_days record reviews, archive passes and actual TTL markings.

Cloud Storage holds checksummed BSON under history/granot/v1 in the private Mongo backup bucket. This prefix lies outside its daily and weekly backup expiry rules. Month catalog rows point at immutable verified objects and use compare-and-swap when more history arrives. Timeline reads merge equivalent job aliases and deduplicate IDs. Lead History limits exact-job observations after merging. Closed-run indexes preserve operation ID, kind, payload hash and underlying result after the source run has expired.

## Rollout and historical review

Run ops/granot-retention-install.ts --install-shadow using the main server environment. It first proves the sparse purge indexes have no pre-existing date to activate before converting them to TTL. Reinstallation preserves the original cutoff and mode. Shadow archives eligible future chains and records observations without issuing purge dates. Future mode stamps eligible new chains. Require archive restoration, replay/freshness parity, protected-record exclusions and shadow evidence before promotion. Keep the original cutoff fixed.

After the live deployment, backfills, history restoration and Pool comparison have been verified, the operator can arm future-only retention with `ops/granot-retention-install.ts --arm-future <existing new_data_from ISO timestamp>`. Arming preserves shadow mode. Promotion requires seven consecutive complete UTC days after both arming and working-set maturity. Each day must include at least 100 chains that passed the final reference/replay checks, three live comparisons of certified and historical Pool reads, no mismatches or failed batches, and zero TTL stamps. Every subsequent future-mode chain still passes the individual transactional checks. Missing evidence keeps the policy in shadow. The cutoff excludes the historical deletion manifest throughout. To disarm before promotion, remove only the armed_at field while mode is shadow.

The historical pilot is prepared with ops/granot-history-archive.ts, ops/granot-archive-run-closure.ts and ops/granot-targeted-deletion-dry-run.ts. The last command requires a new private JSON output file. It compares hot evidence with its archive, verifies closed-run replay, fresh production deployment ancestry, current winning Lead and references, and reports logical bytes and per-chain exclusions. A manifest represents a point in time. Recheck it immediately before any separately authorized deletion. These commands do not delete historical records.

Use ops/verify-granot-future-retention.ts with a disposable loopback replica on port 27961 to exercise shadow, future, archive, replay, TTL selection and historical cutoff behavior. This verifier also writes synthetic test archive objects. The four-year runway requires the future working set and durable growth to be measured over time. Compare daily capacity snapshots, review throughput, unresolved backlog and archive catalog growth.
