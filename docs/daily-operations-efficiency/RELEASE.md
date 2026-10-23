# Daily Operations efficiency release and recovery

User authorization: implement on `main`, update documentation, push and deploy production. Historical pruning, billing changes, production synthetic events and unrelated work are excluded.

## Runtime contract

- Daily Operations does not read Redis credentials or construct a Redis client. No transport-enable flag can restore it accidentally.
- `GET /api/v1/admin/daily-operations/board`: signed Owner/Manager, private response, one shared Mongo view per New York day/schema. The UI makes one request/minute per visible tab, shared by Operations and milestone toasts; hidden/offline tabs stop and abort work.
- `/goal-summary`: signed Owner/Manager, narrow goal/coverage math without queue/cadence, SMS or Granot freshness fan-out; shared five-minute cache.
- `/lead-spend-summary`: signed Owner only, existing `{ok:true,data}` envelope and authoritative spend math; separate five-minute cache. Original Insights/Pulse `/lead-spend` and working Outreach Desk retain their existing behavior.
- `/live`: authenticated HTTP 204, no Redis and no Mongo source/tail query. The Admin BFF forwards 204 explicitly. Older toast JavaScript can still retry every 30 seconds until reloaded, but cannot start the former per-second tail. Reload/close old Owner/Manager dashboard/desk tabs after release.
- Normal core freshness is approximately 60-120 seconds; auxiliary freshness 5-6 minutes. Transient failures retain last-good values with age; authentication refusal clears protected content. A failed new-day refresh must label retained prior-day data explicitly.

## Storage and consistency

`daily_operations_read_views` (test runner/TEST_MODE: `test_daily_operations_read_views`) uses the built-in unique `_id` fence. Claim persists both lease token/generation and the next attempt deadline; a crashed owner cannot trigger a new source build every lease expiry. Publication checks token, generation and unexpired lease. Cold misses are explicitly unavailable; losers do not busy-wait. Five core source queries are bounded and responses capped at 512 KiB. Auxiliary views have separate scopes and five-minute deadlines.

Only `already_current` and `stale` Granot display facts are suppressed. Canonical Synchronization Decisions/Observation Receipts are unchanged. Required Sheet Sync completion/failure facts and existing 400-day event retention remain. No-touch events use one deduped insert. Retained counter events and the conditional open-day increment commit together; duplicate/retry/validation failure cannot leave an extra increment. Close and rebuild use revision protection; retired internal decision-display counters are not rebuilt.

## Additive index

Tool: `node --env-file=.env --import tsx ops/daily-operations-read-view-indexes.ts --apply`.

It creates only `dailyops_day_kind_order` on `daily_operations_events` with `{day:1,kind:1,occurred_at:-1,_id:-1}`. Default invocation is a dry run. It does not drop indexes or modify historical records. Applied successfully in production on 23 October 2026 at approximately 20:39 UTC before enabling the new board. No index is required beyond `_id` for the read-view collection.

## Release verification

Run server typecheck, lint, full offline suite and isolated loopback replica proofs; run Admin typecheck, lint, offline tests and production build. Keep replica opt-ins and `.env` out of the full unit run. Do not change unrelated ignored `ops/output` artifacts to make checks pass; validate a clean release snapshot instead. The GitHub production workflows repeat typecheck/tests/build from the pushed commit.

Critical proofs: duplicate writers/first-day races, actual transaction rollback, closed-day freeze, rebuild CAS, concurrent cache misses, lease expiry/fencing, persisted crash retry deadline, stale serving to concurrent readers during source failure, five-source build/zero-source cache hit, Redis credentials present but zero construction, signed-role denials, legacy 204, one UI loop, no hidden polling, auth-expiry clearing, midnight labeling, and stale recovery.

After pushing, verify both exact remote hashes and each GitHub production workflow result, then Vercel READY state/aliases/commit metadata. Safe production checks use existing authenticated GETs only and output aggregate status/revision/counts, never records or secrets. Verify server health, new board/cache reuse, legacy 204, access denial and absence of new quota failures. Do not send synthetic leads, messages, bookings or callbacks.

## Failure and rollback

The exhausted Upstash quota is not restored by this release; it no longer participates in Daily Operations. No key pruning is required.

On Mongo/cache failure, the UI keeps last-good data and backs off to 60/120/300 seconds; it never switches to Redis or a per-second tail. Cache loss is recovered on demand from durable sources under a fenced lease. No background producer runs without reader demand.

Rollback must preserve Redis-off and the retired live endpoint. Prefer the slower visible-only snapshot/events read fallback over reverting to old global streams. Revert writer changes only together with their counter/rebuild semantics; never replay suppressed historical no-op cards or purge required facts. Existing credentials and historical data are intentionally retained.

Production commit, deployment URLs, workflow results and final test counts are reported in the implementation task and can be verified through each repository's GitHub Actions production workflow and Vercel deployment metadata.
