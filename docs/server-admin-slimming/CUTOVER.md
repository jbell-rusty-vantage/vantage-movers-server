# Cutover runbook: slim deploy, then the physical purge

The operator follows this runbook. It covers deploying the slim server, Admin and MCP, then running the purge 15–30 minutes after the slim deploy is live (the user's decision). Every command is real and its flags were checked against the code on `slim/server-admin` (2026-10-04, lane HARDEN; old-deployment gate added by the pre-deploy audit, PREDEPLOY).

**The rule that shapes the whole runbook.** After the deploy, any path that can write to, or re-create, a retired namespace is a release blocker:

- `vantagemovershistorical`;
- the 20 main-DB targets and `admin_audit_logs`;
- Blob `conversations/`.

So the purge runs only after two read-only snapshots, taken about 10 minutes apart, show that nothing writes those namespaces any more.

**The old deployments are the writers to remove (pre-deploy audit, `evidence/PREDEPLOY-AUDIT.md`).** The slim code writes none of these namespaces. The pre-slim deployments still can:

- Every queue publisher of the pre-slim server calls the top-level `@vercel/queue` `send`, which pins the message to the deployment that sent it (`Vqs-Deployment-Id` = `VERCEL_DEPLOYMENT_ID`). Vercel delivers that message back to the **old** deployment, which runs **old** code. This covers the backlog, a failed message retried every 30 s, and delayed `call_log_refresh` wake-ups (+90 s, then +2/5/15 min, up to 45 min). It lasts for the queue's default 24 h retention. The 2026-09-25 RingCentral throttle showed this behaviour in production.
- Old code writes `operational_events` on these paths. The Granot lifecycle drain writes on every run. Sheet sync, lead messaging, Best Relocation and capture failures also write, and the incident path writes `operational_incidents` and `notification_deliveries`. The old models compile with Mongoose `autoCreate`/`autoIndex`, so the first write after the drop **re-creates** the collection and its indexes.
- An old Admin deployment, reached through its immutable URL or a skew-protected client, writes `admin_audit_logs` on login, refresh and every proxied call.
- Changing env vars cannot stop this: Vercel freezes env per deployment. The job-recovery fence (step 4) only fences retired-stage rows, and only on the new deployment.

Therefore **step 3b removes the pre-slim server and Admin deployments before the quiet window starts**, and `purge.ts` refuses to run without the old-deployment gate (`--cutover-at`, `--quiet-since`, and `--old-deployments-removed=<ids>` or `--old-deployments-kept`). The purge also aborts on any write to a target at or after `--quiet-since`. It checks at step (a) and again immediately before every drop.

**Timeline** (T0 = both aliases on the slim deployments):

| When | Step |
| --- | --- |
| T0 | 3. Verify what is live |
| T0 + 2 min | 3b. Remove the old deployments (time Tr) |
| T0 + 3 min | 4. Fence the legacy jobs |
| T0 + 4 min | 5.1 Snapshot 1 |
| ≥ Tr + 800 s and ≥ snapshot 1 + 10 min (about T0 + 17 min) | 5.2 Snapshot 2 |
| T0 + 18–20 min | 6. Manifest and dry run |
| T0 + 20–30 min | 7. Apply |

## 0. Before the day

| Item | Detail |
| --- | --- |
| Repos and branches | `slim/server-admin` in `vantage-movers-server` (server), `vantage-admin` and `vantage-movers-mcp`. All three live under the work account `jbell-rusty-vantage`; check `git remote -v`. The integrator has committed every lane change (this runbook commits nothing). Merging into `main` is the release. |
| Deploy paths | **Server and Admin:** a push to `main` runs GitHub Actions "Vercel Production". The workflows are `vantage-main-server/.github/workflows/vercel-main-server-production.yml` and `vantage-admin/.github/workflows/vercel-admin-production.yml`. Each runs typecheck, `pnpm test`, `vercel build --prod`, then `vercel deploy --prebuilt --prod`. Vercel Git integration is off (`vercel.json` `git.deploymentEnabled: false`), so the workflow is the only path. Both also accept `workflow_dispatch`. **MCP:** Vercel CLI only. A push does not deploy it (`.agents/skills/deploy-vantage-movers-mcp/SKILL.md`). |
| Production URLs | Server: `https://vantage-movers-main-server.vercel.app`. Admin: `https://vantage-admin-rho.vercel.app`. MCP: `https://vantage-movers-mcp.vercel.app`. |
| Operator workstation | A checkout of `vantage-main-server` on the merged `main`, with `node_modules` installed. Two env files must be present (values are never printed): the server `.env` with `MONGO_URI`, `MONGO_DNS_SERVERS`, `BLOB_READ_WRITE_TOKEN` and `CRON_SECRET`, and `vantage-admin/.env` with `MONGODB_URI` and `ADMIN_AUTH_DB_NAME`. The `ops/slimming` tools read only these (`docs/knowledge/environment.md`). |
| Backup directory | An absolute path **outside** `C:/Users/Pinda/Proyectos/vantage` (the purge refuses one inside), for example `C:/Users/Pinda/vantage-slimming-cutover`. Keep at least 3 GB free: the Mongo backups are gzipped canonical EJSON of about 450 MB of drop targets plus about 330 MB of cleanup selections, before compression. No Blob audio is copied (`--skip-blob-backup`, the user's decision). Below, `BK` is this directory. |
| Vercel CLI | `npx --yes vercel` (`vercel` is not on PATH). Always pass the owning team's `--scope`. The MCP project is in `vantage-4d3db9ef`. Confirm the server and Admin projects' scope with `npx --yes vercel project inspect <project> --scope <team>` before using it. |

All `ops/slimming` commands below run from `vantage-main-server` with `node --import tsx …`. They are read-only unless the step says `--apply`. `inventory.ts`, `purge.ts` (dry run) and `cutover-check.ts` go through the guarded read-only Mongo client, which exits before any non-read command is sent; their Blob access is `list` only.

## 1. Pre-deploy checks (read-only, within the hour before the merge)

1. **Duplicate Agent usernames.** On its first boot the slim server builds the unique partial index `granot_identity.username_1` on `agents` (INTEGRATION-SERVER.md, "Wave 3 fixes"; Mongoose `autoIndex`). A duplicate makes the build fail. Mongoose only logs that failure, but uniqueness then stays unenforced.

   ```
   node --import tsx ops/slimming/cutover-check.ts --agents
   ```

   This must print `duplicate usernames: 0` and exit 0. If it finds a duplicate, stop: the Registry/Granot identity owner fixes the duplicate Agents first. The 2026-10-04 check found 13 usernames and no duplicates.
2. **Baseline snapshot**, for comparison later:

   ```
   node --import tsx ops/slimming/cutover-check.ts --snapshot --out=BK/00-pre-deploy.json
   ```

   Findings are expected here: the old server is still writing.
3. **Server Vercel env (names only):** `npx --yes vercel env ls production --scope <team>` in a directory linked to `vantage-movers-main-server`.
   - `CRON_SECRET` must be present.
   - `SALES_INTELLIGENCE_ENABLED` and/or `SALES_INTELLIGENCE_CAPTURE_WEBHOOK` must be `true`. Job recovery returns `skipped: "disabled"` when both are off and no other recovery flag is on, and then the deployment stamp is never written. To read the flag values without printing secrets, use the `flags` of `GET /api/v1/admin/sales-intelligence/settings`.
   - `DEPLOYMENT_COMMIT_SHA` needs **no** project variable: the production workflow passes `--env DEPLOYMENT_COMMIT_SHA="$GITHUB_SHA"` on every deploy.
4. **Inventory of the deployments to remove in step 3b.** Confirm both project names with `npx --yes vercel project ls --scope <team>`. They are expected to be `vantage-movers-main-server` and `vantage-admin`. Then list each project's deployments:

   ```
   npx --yes vercel ls vantage-movers-main-server --scope <team> > BK/00-server-deployments.txt
   npx --yes vercel ls vantage-admin --scope <team> > BK/00-admin-deployments.txt
   ```

   For the current production deployment of each project, and for every other deployment created in the last 48 h (Production or Preview), run `npx --yes vercel inspect <url> --scope <team>`. Record its id (`dpl_…`), target and creation time. These are the **old deployments**:
   - the server's current production deployment, which the slim deploy replaces;
   - earlier server deployments in the 48 h window, which can still hold pinned messages. That window covers the 24 h queue retention plus margin;
   - any server Preview deployment in that window. A Preview has its own queue consumers, and its messages are pinned to it;
   - the Admin's current production deployment and the Admin deployments in the same window.

   Older server Previews that still show Ready are listed too. They hold no live pinned message, but any request to their URL runs the full old API. Remove them in step 3b unless the owner of a Preview objects; record any you keep.

## 2. Merge and push, in this order

The server and the Admin form a pair. **Neither may run in production without the other for longer than the minutes between their two deploys.** The reasons:

- **Slim server with the old Admin:**
  - the Health page fails on `command_conflicts_last_24h: null`;
  - old bundles sending `database_scope=historical|combined` get 400s;
  - the old Admin keeps **writing `admin_audit_logs`** on every login and proxied call, which is a retired namespace.
- **Slim Admin with the old server:** the Number page shows a load error (no `attached_lead`). The Admin also no longer blocks the Admin role on conversations/observability routes that only the slim server removes.

The MCP calls only routes that exist on both servers, so it can go before or with the server (evidence/MCP.md).

1. **Server.** Merge `slim/server-admin` into `main` and push `main`. Watch the "Vercel Production" run.
   - It must be green, through the Typecheck, Test, Build and Deploy steps. A failing Test step deploys nothing; fix forward, never bypass it.
   - The run summary prints the deployment URL. Record the run id, `github.sha` (the merge commit) and that URL.
2. **Admin.** As soon as the server run reports its deployment URL, merge `slim/server-admin` into `main` in `vantage-admin` and push. Record the run id, sha and URL.
   - Do not push the Admin before the server deploy is Ready.
   - Do not include the user's uncommitted `docs/sales-outreach-desk/**` or `SALES-OUTREACH-DESK.md` edits.
3. **MCP.** Merge `slim/server-admin` into `main` and push. The push is only the record; it does not deploy.
   - From `vantage-movers-mcp`, check `.vercel/project.json` against the deploy skill's constants.
   - Run `pnpm test`, then `pnpm typecheck`.
   - Deploy with `npx --yes vercel --prod --yes --scope vantage-4d3db9ef` and wait for **Ready**.
   - Smoke test: `tools/list` on `/api/mcp` returns the retained tool list, and `POST /api/intelligence-mcp` returns 404.

## 3. Verify what is live

Let **T0** be the moment both the server and the Admin production aliases point at the slim deployments. Record it as an ISO timestamp (UTC). It is the later of the two deploys' Ready times; when in doubt, use the time this step finishes. A later T0 is the conservative choice. `purge.ts --cutover-at` takes this value.

1. **Server.**
   - `npx --yes vercel inspect https://vantage-movers-main-server.vercel.app --scope <team>` must show the deployment URL/id from step 2.1, state **Ready**.
   - `GET https://vantage-movers-main-server.vercel.app/health` returns 200.
2. **Admin.**
   - `npx --yes vercel inspect https://vantage-admin-rho.vercel.app --scope <team>` must show the deployment from step 2.2, **Ready**.
   - Signed in as the Owner, `/sales-intelligence/outreach/x` is the not-found page and `/sales-intelligence` shows only Numbers and RingCentral Accounts.
3. **Deployment stamp.** The purge requires this. The stamp is the `sales_intelligence_sync_state` row `{ scope: "deployment" }`.
   - **What writes it:** job recovery (`src/routes/sales-intelligence-cron.routes.ts`) calls `recordDeploymentCommitOnce` (`src/services/salesIntelligence/deploymentStamp.ts`).
   - It writes only on a Vercel **production** runtime (`VERCEL=1`, `VERCEL_ENV=production`), once per process.
   - The commit comes from `VERCEL_GIT_COMMIT_SHA` or `DEPLOYMENT_COMMIT_SHA` (40 hex characters). Prebuilt CLI deploys get no git metadata at runtime, so the workflow's `--env DEPLOYMENT_COMMIT_SHA="$GITHUB_SHA"` is what sets it.
   - **A manual CLI deploy must pass `--env DEPLOYMENT_COMMIT_SHA=$(git rev-parse HEAD)`, or the stamp records `null` and the purge refuses.**
   - Step 4 triggers the cron, then read the stamp:

     ```
     node --import tsx ops/slimming/cutover-check.ts --snapshot --out=BK/01-stamp.json --skip-blob
     ```

     The first line prints `deployment={"deployment_commit":"<sha>","commit_source":"DEPLOYMENT_COMMIT_SHA","recorded_at":…,"vercel_deployment_id":"dpl_…"}`. `deployment_commit` must equal the server merge sha from step 2.1, and `vercel_deployment_id` must be the deployment `vercel inspect` showed.
   - Then `git fetch origin main` in the operator checkout. The purge verifies the stamped commit locally: it must exist, descend from `6a374fab`, and contain none of `src/models/historical/index.ts`, `OperationalEvent.ts`, `LeadConversation.ts`, `salesIntelligence/attentionArtifact.ts` or `salesIntelligence/assessment.ts`.

## 3b. Remove the pre-slim deployments (T0 + 2 min, after step 3 passed)

This is a **release blocker**: the purge never runs while a pre-slim server or Admin deployment exists, unless the 24 h 58 min wait below is taken instead. See the introduction for why.

1. Re-check that the production aliases point at the slim deployments (step 3). Never remove the deployment the stamp names (`vercel_deployment_id`) or the Admin deployment from step 2.2.
2. Remove every old deployment recorded in step 1.4, server first, then Admin:

   ```
   npx --yes vercel remove <old-deployment-url> --yes --scope <team>
   ```

   Run one command per deployment URL. Never pass a project name: that form removes far more than one deployment.
3. Run `npx --yes vercel ls <project> --scope <team>` for both projects. No old deployment may be listed any more. Record the removed ids (`dpl_…`, comma-separated) and the removal time **Tr**. The purge takes the list as `--old-deployments-removed=<ids>` and logs it.

**What removal costs.** Messages pinned to a removed deployment can no longer be delivered, and they expire with the queue retention. Each one is only a wake-up for a durable Mongo row, and the slim deployment's crons pick those rows up:

| Rows | Slim cron |
| --- | --- |
| sheet sync | `sheet-sync-drain`, every 5 min |
| lead messaging | `lead-messaging-drain`, every 5 min |
| Granot lifecycle | `granot-lifecycle-drain`, every 5 min |
| Granot automation | `granot-automation-heartbeat`, every 5 min |
| reporting | `reporting-delivery-heartbeat`, every 5 min |
| Best Relocation ingestion | `best-relocation-ingest-heartbeat`, every 6 h |
| sales-intelligence capture and refresh rows (`capture_projection`, `call_log_refresh`) | `sales-intelligence-job-recovery`, every minute; `sales-intelligence-call-log-reconcile` (every 5 min) also re-reads the provider Call Log |

Removal also ends Instant Rollback to those deployments. That rollback was already unsafe after the purge (step 11). Before the purge, a rollback is a `workflow_dispatch` of the previous `main` sha.

**Removing nothing instead.** If the old deployments cannot be removed, the purge waits until the pinned messages have expired. That is at least **24 h 58 min after T0**: 24 h queue retention, plus the 45 min `call_log_refresh` max age, plus 800 s `maxDuration`. It also waits until no sales-intelligence job created before T0 is still claimable (`pending`, `retry` or `leased`). `purge.ts --old-deployments-kept` enforces both. Pass `--cutover-at=<T0>` to `cutover-check.ts --snapshot` to list those jobs. This replaces the user's 15–30 min window, so ask the user before choosing it.

An in-flight invocation on a removed deployment is not guaranteed to stop at once. The quiet window in step 5 therefore starts after Tr and lasts beyond Tr + 800 s.

## 4. Fence the legacy jobs on the new deployment (T0 + 3 min, after step 3b)

Vercel runs `/api/cron/sales-intelligence-job-recovery` every minute on the current production deployment. Trigger it once by hand so the fence runs now. The secret is `CRON_SECRET` from the server `.env` (the same value as Vercel Production). Never echo it.

```bash
node --env-file=.env -e "fetch('https://vantage-movers-main-server.vercel.app/api/cron/sales-intelligence-job-recovery',{method:'POST',headers:{authorization:'Bearer '+process.env.CRON_SECRET}}).then(async r=>{const b=await r.json();console.log(r.status,JSON.stringify({skipped:b.skipped,reason:b.reason,retired_jobs:b.retired_jobs}))})"
```

**Expected:** `200` with `skipped: false` and a `retired_jobs` summary.

- The handler runs `retireLegacyCsiJobs` first. It terminalizes every `pending`/`retry`/`paused` row of a retired stage, and every `leased` row, as `retired` (`reason: "stage_retired"`, `lease_epoch` +1). It then writes the stamp.
- An old worker that still holds a lease gets `LEASE_LOST` when it completes, and its effect never runs (REHEARSAL.md §1).
- `skipped: "disabled"` means the flags in step 1.3 are off. Fix the flags; do not continue.

Verify zero runnable or leased retired-stage jobs:

```
node --import tsx ops/slimming/cutover-check.ts --snapshot --out=BK/02-after-fence.json --skip-blob
```

The `legacy jobs` line must show `runnable: 0`, `live_leases: 0`, `expired_leases: 0`. `by_status` may only hold `completed`, `dead_letter` and `retired`; C2 deletes those rows.

If a count is not zero:

- **The fence works in batches.** It retires at most 500 rows per call (`CSI_JOB_RETIREMENT_BATCH`), and the 2026-10-03 inventory saw about 900 runnable legacy rows. Trigger the cron again and re-check until the counts reach 0.
- **It only touches its own dataset**: rows whose `deployment`/`database` match production's `SALES_INTELLIGENCE_DEPLOYMENT_ID` and `vantagemovers`. `nonterminal_by_dataset` shows where any leftover rows sit. Rows of another dataset are never claimed by the slim server, and C2 dead-letters and deletes them. Record them as accepted only when every one of them sits outside the production dataset and none holds a live lease.
- **A live lease that will not clear** means an old worker is still running. Wait out its lease, at most `maxDuration` 800 s.

## 5. Two quiet snapshots, about 10 minutes apart

An invocation that was already running on an old deployment when it was removed may still finish (`maxDuration` 800 s ≈ 13.3 min). So a write after T0 is possible until Tr + 800 s. It is not acceptable once that window has passed. Pinned queue deliveries to the old deployments stopped at step 3b.

1. **At T0 + 4 min (after step 3b):**

   ```
   node --import tsx ops/slimming/cutover-check.ts --snapshot --out=BK/03-snap1.json --since=<T0 ISO> --cutover-at=<T0 ISO>
   ```

   It prints, per target:
   - the count;
   - the last insert (the `_id` time) and the last `updatedAt`;
   - the historical DB, per collection;
   - the legacy jobs;
   - the Blob `conversations/` count, bytes and last upload.

   `--since` lists every write at or after T0. Record them; they are allowed only if they stop. `--cutover-at` lists the sales-intelligence jobs created before T0 that are still claimable. With the old deployments removed, only the slim code can claim them, so this list is for the record.
2. **At least 10 min after snapshot 1 and after Tr + 800 s (T0 + 17 min in the normal timeline):**

   ```
   node --import tsx ops/slimming/cutover-check.ts --snapshot --out=BK/04-snap2.json --compare=BK/03-snap1.json
   ```

   This must print `no findings` and exit 0. That means:
   - every target has the same existence, UUID, count, last insert and last update;
   - legacy jobs are 0 runnable and 0 leased;
   - the Blob object count and last upload are unchanged.

   On any finding, do not continue. Identify the writer from the namespace and timestamps. Check whether an old deployment is still listed (step 3b) and read the Vercel logs. Wait 10 more minutes, then repeat this step against the newest snapshot. Two consecutive quiet snapshots are required.
3. **QUIET** is the `observed_at` (first line of the output, also in the JSON) of the **earlier** snapshot of the last clean pair. `purge.ts --quiet-since` takes this value. From that instant on, no write to a target is accepted, and the purge checks it again immediately before every drop.

## 6. Regenerate the manifest and run the dry run (T0 + 18–20 min)

```
node --import tsx ops/slimming/inventory.ts --write-manifest
```

This writes `ops/slimming/deletion-manifest.json`, `ops/slimming/conversation-blob-keys.json` and `docs/server-admin-slimming/evidence/inventory.json`, and prints `manifest_hash=<hash>`.

- It needs `BLOB_READ_WRITE_TOKEN`: a production manifest always carries the exact Blob keys.
- It refuses a manifest that differs from `policy.ts`.
- **Record the hash.** The hash covers storage bytes, so regenerate immediately before applying; never reuse an older hash.

Review the diff of `deletion-manifest.json`:

- 20 main drop targets plus `vantageadmin.admin_audit_logs`, or fewer, with the remainder in `absent_targets` (`operational_report_runs` was absent);
- `vantagemovershistorical` with its 6 collections;
- 7 cleanups, C1–C7, all `final`;
- a Blob target whose key count equals the referenced keys, with `unreferenced_count: 0`.

Let `GATE` stand for the old-deployment gate, with the values from steps 3, 3b and 5:

```
--cutover-at=<T0 ISO> --quiet-since=<QUIET ISO> --old-deployments-removed=<dpl_…,dpl_…>
```

```
node --import tsx ops/slimming/purge.ts GATE --report=BK/05-dry-run.json
```

It must print the `(a) cutover gate:` line with the removed ids and the slim deployment id, then end with `[purge] no problems: the manifest matches live state`. Any problem listed aborts an apply at step (a). The checks cover:
- cluster, UUID and count mismatches;
- the deployment stamp and live leases;
- `manifest/policy drift: …`;
- unlisted Blob objects under `conversations/` and a missing Blob target;
- a missing or inconsistent gate:
  - `--quiet-since` before `--cutover-at`;
  - a removed id that is the slim deployment;
  - `--old-deployments-kept` before T0 + 24 h 58 min;
- **any insert or `updatedAt`/`createdAt` write on a target at or after `--quiet-since`**.

Fix the cause, then return to step 3b, 5 or 6.

## 7. Apply (T0 + 20–30 min)

```
node --import tsx ops/slimming/purge.ts --apply --manifest-hash=<hash from step 6> --backup-dir=BK --i-confirm-slim-deployed GATE --skip-blob-backup --batch=500
```

| Flag | Why |
| --- | --- |
| `--apply` | Mutating mode. Without it the run is the dry run. |
| `--manifest-hash=<hash>` | Must equal the hash of the reviewed manifest. Any other value is refused. |
| `--backup-dir=BK` | Absolute and outside the workspace. The run directory is `BK/slimming-purge-<timestamp>/`. |
| `--i-confirm-slim-deployed` | Required confirmation that steps 3–5 passed. |
| `GATE` | `--cutover-at`, `--quiet-since` and `--old-deployments-removed` (or `--old-deployments-kept`, step 3b). Required. Logged in the `a.assert` step. |
| `--skip-blob-backup` | The user's decision: no copy of the conversation audio is kept. It skips only the Blob download in step (b). Step (d) still deletes only the exact manifest keys, from a fresh listing, and refuses before deleting anything if an unlisted object is under `conversations/`. |
| `--batch=500` | Cleanup page size (default 500, maximum 2,000). |

What the run does, aborting on the first mismatch:

- **(a)** assertions, as in the dry run, including the gate and the late-write check. Policy drift aborts before any connection.
- **(b)** verified backups of every drop target, every historical collection and every cleanup selection. Each file's count and sha256 are read back.
- **(c)** cleanups C1–C7, in `_id` batches. Every page is checked against the backed-up `_id`s; a document that started matching after step (b) is first written to a verified `cleanup-<id>-extra-<n>.ejson.gz`.
- **(d)** delete the exact Blob keys.
- **(e)** drop the collections. Immediately before each drop it re-asserts UUID and count, and that the collection has no insert or write at or after `--quiet-since`.
- **(f)** drop `vantagemovershistorical`, with the same late-write check on each of its collections.
- **(g)** verify that targets are absent and protected namespaces present, with before/after statistics.

It ends with `[purge] done. Backup and log: <run dir>`.

**Interrupted?** Resume with the same hash and the same run directory:

```
node --import tsx ops/slimming/purge.ts --apply --manifest-hash=<hash> --backup-dir=BK --i-confirm-slim-deployed GATE --skip-blob-backup --resume=BK/slimming-purge-<timestamp>
```

`--resume` first re-verifies every backup file of the run (count + sha256) and refuses if any fails. A drop that succeeded just before the crash counts as done only when its backup verifies. A fresh `--apply` against a consumed manifest is refused at step (a).

**Aborted with `late write found immediately before the drop`?** A writer is live. Do not resume that run: its backup of the written collection predates the late write. Instead:

1. Find and stop the writer (step 9.1).
2. Take a new clean snapshot pair (step 5).
3. Follow the re-drop procedure of step 9.2: regenerate the manifest and start a **new** run with the new `--quiet-since`.

The targets already dropped are recorded as absent. The rest are backed up again from their current state. The loopback rehearsal proved the abort (PREDEPLOY-AUDIT.md).

## 8. Post-purge verification (immediately)

1. The run log `BK/slimming-purge-<timestamp>/purge-log.json` must end with a `g.verify` step, `ok: true`. Record the run directory, the manifest hash and the before/after `dbStats` in the LEDGER.
2. Run the recreation check immediately and again 5 minutes after the purge:

   ```
   node --import tsx ops/slimming/cutover-check.ts --recreation --out=BK/10-recreation-T+0.json
   node --import tsx ops/slimming/cutover-check.ts --recreation --out=BK/10b-recreation-T+5m.json
   ```

   It must print `no findings`. It checks:
   - no retired namespace in `vantagemovers` or `vantageadmin`, including the `test_` observability aliases. The namespaces an old deployment would re-create first are `operational_events`, `operational_incidents`, `notification_deliveries` and `admin_audit_logs`; the check covers each of them by name;
   - no `vantagemovershistorical`;
   - 0 objects under `conversations/`;
   - 0 legacy-stage job rows;
   - 0 `contact_numbers` carrying a C1/C5 field and 0 `call_interactions` carrying a C7 pointer.
3. Smoke the retained surfaces as the Owner: Numbers list and detail (Calls and messages, Lead matches, Details), Recount, RingCentral Accounts, the Granot Health page, Daily Operations, Job Timeline. SI `GET /coverage` must report capture healthy.

## 9. Recreation checks at +30 min, +2 h and +1 day

The queue's default retention is 24 h, so the +1 day check is the one that closes the pinned-message window if any old deployment was missed in step 3b. Before each check, run `npx --yes vercel ls` on both projects: no pre-slim deployment may have reappeared.

```
node --import tsx ops/slimming/cutover-check.ts --recreation --out=BK/11-recreation-T+30m.json
node --import tsx ops/slimming/cutover-check.ts --recreation --out=BK/12-recreation-T+2h.json
node --import tsx ops/slimming/cutover-check.ts --recreation --out=BK/13-recreation-T+1d.json
```

Each must print `no findings` (exit 0). On a finding:

1. **Find and stop the writer first.** The output gives the namespace, count, UUID and last insert/update times. Possible writers: an old deployment's in-flight invocation (Vercel logs), a script or a client still pointed at a retired route. Never re-drop while the writer is live.
2. **Mongo re-drop (idempotent).** Repeat steps 6 and 7 with a **new** run:

   ```
   node --import tsx ops/slimming/inventory.ts --write-manifest
   node --import tsx ops/slimming/purge.ts GATE2 --report=BK/20-redo-dry-run.json
   node --import tsx ops/slimming/purge.ts --apply --manifest-hash=<new hash> --backup-dir=BK --i-confirm-slim-deployed GATE2 --skip-blob-backup
   ```

   `GATE2` keeps `--cutover-at=<T0>`. It gets the deployment ids removed since the first purge, or the original ids if no new deployment had to be removed. `--quiet-since` is the start of a new clean snapshot pair (step 5), taken after the writer was stopped.

   On a purged state the regenerated manifest lists only what came back:
   - a recreated collection, with its new UUID and count, under `drop_collections`;
   - everything else under `absent_targets`;
   - cleanups whose expected counts are the re-appeared rows/fields.

   The run backs those up and removes them. Everything already gone is asserted absent and left alone. The loopback rehearsal proved this end to end (REHEARSAL.md §8.3: manifest 2 cleaned the leftovers, manifest 3 was a no-op). For legacy-stage job rows, trigger the job-recovery cron (step 4) before regenerating.
3. **Blob objects under `conversations/` are an incident.** The purge never deletes them: an unreferenced key is a step (a) problem and aborts step (d). They mean a conversation-media writer is live. Stop it. Removing those objects then needs an explicit, reviewed key list, outside this tooling.
4. Record every finding and re-drop in the LEDGER.

## 10. Vercel env names to delete afterwards

Delete these by name, never printing values, in Production, Preview and Development: `npx --yes vercel env rm <NAME> <environment> --yes --scope <team>` from a directory linked to the project.

- **`vantage-movers-main-server`**, after the +1 day check passes: every name under "Retired by slimming" in `docs/knowledge/environment.md`:
  - the `OBSERVABILITY_*`, `EMAIL_PROVIDER`, `EMAIL_NOTIFICATIONS_*`, `SENDGRID_TO_EMAIL`, `SENDGRID_DEVELOPER_TO_EMAIL` and `ALERT_EMAIL_*` names, plus the test-only `ALLOW_*` names;
  - the server AI/media names: `AI_GATEWAY_API_KEY`, `BLOB_STORE_ID`, `BLOB_STORE_NAME`, `SALES_INTELLIGENCE_MCP_ENDPOINT`, `SALES_INTELLIGENCE_MCP_API_SECRET`, `SALES_INTELLIGENCE_RUN_TOKEN_SECRET`, `SALES_INTELLIGENCE_EXTRACTION_MODEL`, `SALES_INTELLIGENCE_STT_*`, `SALES_INTELLIGENCE_MEDIA_MAX_BYTES`, `SALES_INTELLIGENCE_ANALYSIS_*`, `SALES_INTELLIGENCE_PERSONAL_LEDGER`, `SALES_INTELLIGENCE_LEGACY_CONVERSATION_FALLBACK_DISABLED`, `SALES_INTELLIGENCE_AI_*_CEILING_CENTS` and `SALES_INTELLIGENCE_RETENTION_{AUDIO,TRANSCRIPT}_DAYS`;
  - the retired flags `SALES_INTELLIGENCE_{MEDIA_ENABLED,STT_ENABLED,EXTRACTION_ENABLED,EXACT_EVIDENCE_VERIFICATION,PROVIDER_READS,MOVE_ASSESSMENT,CITATION_HANDLES,CASE_FILE,OUTREACH_ENSURE,ATTENTION_MANIFEST,ATTENTION_V2,ATTENTION_EVOLUTION,LEAD_PROGRESS,PROGRESS_PLAN,PRIORITY5_CLOSURE,RECEIVER_ASSIGNMENT,OVERVIEW,TIMELINE_V2,LIVE_SSE}`;
  - the retired settings `SALES_INTELLIGENCE_BACKFILL_DAYS`, `SALES_INTELLIGENCE_FIRST_ACTION_DUE_STAFFED_MINUTES`, `SALES_INTELLIGENCE_MISSED_CALLBACK_DUE_STAFFED_MINUTES` and `SALES_INTELLIGENCE_GOING_COLD_STAFFED_MINUTES`;
  - **`BLOB_READ_WRITE_TOKEN`**, last, once the recreation checks no longer need a Blob listing. The local `.env` copy is what `ops/slimming` uses; remove it there too when the purge record is closed.

  **Keep:** `SENDGRID_API_KEY`, `SENDGRID_FROM_EMAIL`, `ALERT_EMAIL_REPLY_TO` (Admin invitations), `KV_REST_API_*` and `UPSTASH_*` (Daily Operations), the server's own `SALES_INTELLIGENCE_DEPLOYMENT_ID`, `CRON_SECRET`, and `SALES_INTELLIGENCE_REP_ACCESS` (still read by the boundary). `SALES_INTELLIGENCE_SCOPED_KEY_NAME` and its entry inside `VANTAGE_SCOPED_API_KEYS` wait until no caller sends that key.
- **`vantage-movers-mcp`**, after its deploy is Ready: `SALES_INTELLIGENCE_SCOPED_API_KEY`, `SALES_INTELLIGENCE_RUN_TOKEN_SECRET`, `SALES_INTELLIGENCE_DEPLOYMENT_ID`, `SALES_INTELLIGENCE_DATABASE`, `SALES_INTELLIGENCE_API_BASE_URL`. Remove them from that project only, never from the server project.
- **`vantage-admin`**: `SI_GALLERY`, if present (its gallery route is deleted).

## 11. Rollback limits

- **Before step 7 (no data touched).**
  - Code can roll back. Before step 3b: `npx --yes vercel rollback` / `promote` of the previous production deployment. After step 3b removed it: a `workflow_dispatch` of the previous `main` sha.
  - The old code would write the retired collections again, so the manifest becomes stale and the purge refuses on count growth. Re-deploy the slim code and restart from step 3.
  - Side effects that stay after a rollback:
    - legacy jobs the fence marked `retired` are not run by the old code (that status is not claimable);
    - the `granot_identity.username_1` index built by the slim server stays. The old schema's spec conflicts with it, and Mongoose only logs that.
- **After step 7.** There is no in-place rollback of data.
  - The backups in `BK/slimming-purge-<timestamp>/` are an inert handoff (gzipped canonical EJSON, with counts, sha256 and index specs). The only tooled restore is `ops/slimming/rehearsal/restore.ts`, which restores into an isolated `slimrehearsal_*` database on a **loopback** replica, to read the data or prove a match. Restoring into production is not tooled and is not part of this plan.
  - Conversation audio is gone for good (`--skip-blob-backup`). RingCentral's own provider recordings are unaffected.
  - Rolling the server or Admin code back to pre-slim builds after the purge is **not supported**. The old code would re-create empty retired collections and run its AI/Outreach paths with no history. The old Admin would call retired routes (404) and write `admin_audit_logs` again.
  - Kept human facts (restrictions, review items, Owner instructions, nudges, attachments, Rep identities) are untouched by the purge, so nothing needs restoring for them.
- **Backup retention.** Keep `BK` for the recovery window in DATA-AND-STORAGE §3 (proposed 30 days), then delete it. If the new Sales Outreach Desk wants old Outreach/follow-up history, hand it over before then (NEW-DESK-DELTA.md).
