# W5 bounded persistence release subset — November 17, 2026

This isolated release changes checkpoint and receipt persistence while retaining the existing approval, expiry, purge and operation identity. It is a canary of write efficiency, not completion of W5 or a new retention lifecycle. Source/deployment identity and final exact-tree tests belong in the release record.

Planning checkpoints occur on the next row after 25 rows or five seconds; final immutable plan sealing retains exact progress. Restart recollects and never uses an advisory checkpoint to skip rows. Each existing action/request lease gate freshly reads both persisted owners/epochs and expiries on the primary. Renewal happens within 22.5 minutes of the earlier expiry, with time checked after reads; 1,350 seconds exceeds the 800-second serverless invocation limit. Expired ownership cannot be renewed. External effects and Mongo fences remain non-atomic, as before.

Action results keep the existing receipts array. A fresh fenced positional replacement updates one matching action, otherwise a second fresh fenced command appends only if absent. Identical replay succeeds on matched count. Checkpoint and result remain atomic within each command; immutable checksum/operation identity, existing readers and Outreach nomination ordering stay unchanged.

The runtime files are `src/services/granotHttpCollector/runWorkflow.ts` and `runPersistence.ts`. No schema, index, TTL, environment, cadence or configuration migration is included. Creation still assigns seven-day `purge_at`; approval and apply retain 24-hour plan expiry.

The new `runPersistence.test.ts` includes opt-in loopback replica receipt/fence proofs. `runRecovery.replica.test.ts` plus `ops/capacity/run-recovery.replica.ts` exercise worker replay, unchanged expiry refusal and baseline closed-run reconstruction against a disposable local replica. The worker replay uses a synthetic effect ledger with real Mongo/run fencing, not production domain effects. Independent integrated-tree focused verification is in [release-slice review](RELEASE-SLICE-REVIEW-2026-11-17.md); exact isolated-tree replica/static/offline results must be recorded separately. No historical test total is substituted for current qualification.

Production command bytes/updates per action and representative load remain unmeasured by these local proofs. Full W5 lifecycle/reconstruction qualification, existing long-running expiry limitations and the wider capacity plan remain open. A code canary must not be reported as solving active-run expiry or physical storage reclamation.

## Rejected lifecycle remains excluded

Automatic approval review previously rejected a proposal before execution:

> This persistent code change introduces a retention mode that can omit the TTL purge date and bypass approval expiry for v2 runs, creating potentially indefinite retention and execution despite no trusted user authorization for this exact lifecycle change.

The denied design would let all newly flagged v2 runs omit `purge_at`, including previews/completed runs awaiting terminal certification; they could remain indefinitely. It would also permit timely-approved selected actions to execute after original plan expiry, and disabling creation would not revoke already-created v2 continuation. Existing records were not converted and no denied command executed.

Recommendation: retain existing expiry/purge in this release. Those policy changes are not necessary for checkpoint/receipt efficiency. No implementation retry, retention flag, `retention_version`, closure migration, preflight CLI or post-expiry branch is included. A future proposal must establish affected cases, stale-action safeguards, closure bounds and flag-off recovery; explicit authority remains necessary if indefinite retention or post-expiry execution is requested.

Rollback is an ordinary code rollback: old readers/writers understand the retained array and operation identities. No data or schema migration needs reversing. Observe lease refusals, action/run completion, pending work and downstream behavior after deployment; stop/revert if regression appears.
