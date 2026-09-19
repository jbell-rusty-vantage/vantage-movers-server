# CSI-07 / initial CSI-08 local handoff

## Run

From `vantage-admin`: `node scripts/csi07-local.mjs`. Requires the existing local Mongo replica PRIMARY at `mongodb://127.0.0.1:27189/?replicaSet=csi01` and installed repository dependencies. Open **http://127.0.0.1:3108/sales-intelligence**. API is http://127.0.0.1:3107. The launcher starts both processes and the existing Outreach worker; stop the launcher to stop the preview.

Observed replica container: `csi01`, image `mongo:8.0`, loopback mapping `127.0.0.1:27189→27189`. If this existing container is stopped, run `docker start csi01`; the preview refuses to seed until the replica is available. Do not replace/drop the container or its other CSI databases.

Only databases `testvantagemovers_csi07preview` and `vantage_admin_csi07_preview` are used. No production .env is used by the API. Admin's Next environment loader is marked processed so existing env values are not merged (Next may list .env in its startup inventory). API origin is server-only VANTAGE_API_BASE_URL. No secrets reach browser configuration or these artifacts.

The OS temp directory `vantage-csi07-local/session.json` contains disposable login password and generated process configuration. Local users: `owner@csi07.example.test` and `admin@csi07.example.test`. Do not commit/copy this private file into evidence. Restart rotates local credentials; sign in again. `api.log` in that directory records local server output. Three synthetic Numbers, two multi-action records and distinct synthetic Agents are seeded once; no production data/providers. Existing fixture state persists across restart. Do not point this launcher at another database.

Local preparation verifies replica identity and applies CSI index setup exclusively in the guarded fixture DB. HTTP alone does not publish Attention: launcher invokes `runOutreachEnsureOnce` serially every five seconds. Production queue/minute cron remains unchanged. Media/STT/AI/nudges/capture and external effects stay disabled. No MCP is needed.

## Proof commands

From `vantage-main-server`:

- `node --import tsx scripts/test-csi-live.ts`: real Admin login/BFF/API proof, auth/scope/idempotency and stream clock/reconnect frames. Requires running preview. Writes one synthetic Owner note.
- `node --import tsx scripts/test-csi-live.ts rename`: actual follow-up PATCH changes the selected synthetic callback description.
- `node --import tsx scripts/test-csi-live.ts clock`: actual PATCH moves its due time 45 seconds ahead. Observe the open detail lose Overdue then regain it without another command.
- Disconnect/reconnect browser network while executing `rename` from the terminal; the selected detail refetches the missed change. Reset network emulation afterward.

## Delivery and remaining scope

CSI-07: durable source SSE, authenticated unbuffered Admin BFF, reconnect/clock refetch, cleanup, Owner/current-scope and proxy trust tests. CSI-08: **partial read slice only**, first 50 Attention items → Number and plural Outreach details. Export source intact; hashes in SOURCES.md. No manifests/lockfiles replaced. No operational migration/backfill, production flags, provider calls, subscriptions, deployment or live sends.

Changed contracts: live event described in CONTRACTS; optional Outreach primary_number enables navigation; CSI BFF retains top-level as_of/coverage and forwards mutation idempotency. No overview endpoint was invented. Absence of analysis/coverage and nullable dates remain explicit.

Remaining CSI-08: real search/pagination, review-only Lead workflow, attachment resolution, timeline/official links, commands/conflicts/draft preservation, Reps and accurate server-provided row identity/outcome enrichment. Current read slice contains no editable command forms; focus stability is proved for detail controls, not unfinished editors. CSI-14 repair/dialogs, CSI-09 settings/Coverage, CSI-15 recovery/retention and CSI-18 are separate owners. Team D can proceed on CSI-18 server under revised split.

## Checks and limitations

See CHECKS.md for exact source/checkpoint distinction and browser artifacts. Production hosting/change-stream capacity and deployed credentials are unverified. One Mongo watch per connected Owner; clock frames every 15s and visible fallback every 30s. Attention latency additionally depends on snapshot worker. Cursor is advisory/full-resync, never an exactly-once event replay promise. No new indexes are required for live; rollback removes route/UI while retaining data and audit. Master feature flag remains authoritative.

