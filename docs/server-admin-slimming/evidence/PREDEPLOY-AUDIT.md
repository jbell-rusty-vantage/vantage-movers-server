# Pre-deploy audit: no writer, no re-creation (PREDEPLOY, 2026-10-04)

The user decided to run the physical purge 15–30 minutes after the slim deploy goes live (LEDGER, "User decisions"). That makes any path that can **write to or re-create** a retired namespace after the deploy a release blocker:

- the database `vantagemovershistorical`;
- the 20 main-DB targets;
- `vantageadmin.admin_audit_logs`;
- Blob `conversations/`.

This file records:

- what the audit searched;
- every finding, with its votes and disposition;
- the old-deployment risk analysis;
- the mitigations now in [`CUTOVER.md`](../CUTOVER.md) and `ops/slimming`;
- the final lock across the three repos.

Bases: server `6a374fab`, Admin `adda9e1`, MCP `fbf061f`. Branch `slim/server-admin` in all three. Workflow run `wf_1934d4ac-26c`.

## 1. Audit angles and what each searched

Each candidate finding went to three independent skeptics, who tried to refute it from code and docs (read-only). A finding is **confirmed** when at least two of the three could not refute it.

| Angle | What it searched |
| --- | --- |
| **raw-driver** | Every way the slim **and** the base code reach a retired namespace without a slim model:<br>• raw `collection(...)` writes and `db.model` registrations;<br>• Mongoose `autoCreate`/`autoIndex` on first model use;<br>• `useDb` and `test_` aliases;<br>• deployment-pinned queue sends that bring base code back to life. |
| **producers-schedules** | Every producer and schedule that can trigger work after T0:<br>• queue publishers (`@vercel/queue` `send`) and the consumers in `vercel.json`;<br>• crons;<br>• delayed and retry wake-ups (`call_log_refresh`, the Granot lifecycle, sheet sync, lead messaging, Best Relocation);<br>• the job-recovery fence (`retireLegacyCsiJobs`);<br>• the purge's own gates (`deploymentProblems`, live leases, count growth). |
| **old-deployments** | What the pre-slim server, Admin and Preview deployments can still do after the aliases move:<br>• queue pinning and retention (`@vercel/queue` 0.2.1);<br>• `maxDuration`;<br>• env frozen per deployment;<br>• skew protection and immutable URLs;<br>• Admin audit writes;<br>• whether the purge's gates can detect a live but idle old deployment. |

The integrator also re-ran its own search of the slim code. No retired collection name appears in the slim server's `src/`/`api/` outside tests and docs:

- the 20 main targets;
- `vantagemovershistorical`;
- the dynamic `operational_…`/`test_` alias helper.

No `admin_audit_logs`/`AdminAuditLog` appears in Admin `server/`, `lib/` or `app/`. No `conversations/` Blob path appears in the server. The slim code itself has no writer, which matches the auditors.

## 2. Findings, votes and dispositions

### Confirmed (3 of 3 votes each)

| Id | Severity | Claim, as re-verified by the integrator | Disposition |
| --- | --- | --- | --- |
| **raw-driver-1** | blocker | The **old** production server still runs after cutover, and its code writes `operational_events`, plus incidents and notifications through `upsertIncidentForEvent`.<br>• Every base publisher imports the top-level `send` from `@vercel/queue`: sheetSync, leadMessaging, granotLifecycle, granotHttpCollector, reporting, ingestion, webhookFanout, callLogRefresh.<br>• In the installed `@vercel/queue` 0.2.1 (`dist/index.js:1590-1595, 1635, 1746`), that `send` pins every message to `VERCEL_DEPLOYMENT_ID` through the `Vqs-Deployment-Id` header. Only `deploymentId: null` unpins it, and no base code passes it.<br>• `vercel.json` sets `retryAfterSeconds: 30` and no `retentionSeconds`, so the 24 h default applies (README: default 86,400 s).<br>• `callLogRefresh.ts` retries at 2/5/15 min (`:61`) up to a 45 min max age (`:71`). It re-publishes delayed wake-ups (`:233-235`) and calls `warn(recordEvent, …)` (`:418`, `:438`, `:516-523`). | **Fixed (deploy + code).** CUTOVER step 3b removes the old deployments. The purge gate refuses to run without that, or without the 24 h 58 min wait, and aborts on any late write (§4). |
| **producers-schedules-1** | blocker | The same mechanism, across all old consumers:<br>• the Granot lifecycle `emitDrainRunEvent` writes on every run (`drainer.ts:743`);<br>• the old `processor.ts:300-307` enqueues `outreach_ensure` and immediately publishes a pinned wake-up to the old SI consumer, which writes `outreach_*`;<br>• the old SI pipeline's next-stage wake-ups (media to Blob `conversations/`, analysis, application);<br>• the `call_log_refresh` self-re-publishing;<br>• Best Relocation `lease_busy` redelivery;<br>• lead-messaging retries.<br>No purge gate saw a live but idle old deployment, and the 10-minute zero-growth sample is shorter than a 15-minute refresh retry gap. | **Fixed.** As for raw-driver-1. The fix also adds the gate the finding asked for: no drop target may carry a write newer than a recorded instant (`--quiet-since`), checked at step (a) and immediately before each drop. CUTOVER step 9 adds the old-deployment listing to every recreation check and keeps the re-drops. |
| **producers-schedules-2** | high | The job-recovery fence and the purge's lease gate cover only **retired** stages. Rows of retained stages that the old code created before cutover can still be claimed by the old consumer when their pinned delayed message arrives. Those are `call_log_refresh` (one per hang-up) and `capture_projection`.<br>Verified: `claimCsiJob` claims pending/retry rows when due, or leased rows whose lease expired (`jobs.ts:133-170`). `retireLegacyCsiJobs` filters `CSI_RETIRED_JOB_STAGES` only (`jobs.ts:189-197`). | **Fixed (different means than proposed).** With the old deployments removed (step 3b), only slim code can claim those rows, so they need no expiry. Expiring them would also drop real capture work that the slim deployment completes. When the old deployments are kept, `purge.ts --old-deployments-kept` refuses while any job created before `--cutover-at` is still `pending`/`retry`/`leased`. `cutover-check.ts --snapshot --cutover-at` lists those jobs by stage and status. |
| **old-deployments-1** | blocker | As raw-driver-1, with the creation detail: the old observability models compile through `db.model(...)` with Mongoose 9 defaults (`observabilityModelFactory.ts`; base `mongoose ^9.6.2`), so the first use in an old isolate creates the collection and its indexes. Env changes cannot stop this, because env is frozen per deployment. | **Fixed.** Step 3b lists every READY deployment (1.4) and removes them. The finding's other steps are in CUTOVER:<br>• (3) the newest-write check at each drop, per target: newest `_id` time and the newest of `updatedAt`, `createdAt`, `updated_at`, `created_at`;<br>• (4) recreation checks at +0, +5 min, +30 min, +2 h and +1 day, with the +1 day check closing the 24 h retention window. |

### Unconfirmed (for awareness; the integrator re-checked each)

| Id | Votes | Claim (short) | Integrator's check and disposition |
| --- | --- | --- | --- |
| old-deployments-2 | 1 of 3 | Pinned wake-ups for **retired** stages (outreach_ensure, analysis, transcription, media) reach the old SI consumer, which still has handlers for them. | Real only while an old deployment exists. The fence makes those rows `retired`, which no claim matches, but an old consumer can win the race on a fresh row. Covered by step 3b; no separate action. |
| old-deployments-3 | 1 of 3 | Invocations already running on the old deployment (`maxDuration` 800 s) do not stop at the alias switch. | True, and already in CUTOVER §5. It is now explicit: snapshot 2 must be at or after Tr + 800 s, because removal is not guaranteed to stop an in-flight invocation. |
| old-deployments-4 | 0 of 3 | `deploymentProblems` proves the new code is live, not that the old code stopped. | The skeptics refuted it as a separate defect, but the gap it names is real and is now closed. The purge requires `--old-deployments-removed` (and refuses the stamped slim id) or the 24 h 58 min wait, plus the late-write check. |
| old-deployments-5 | 1 of 3 | The old Admin `admin_audit_logs` model uses default `autoCreate`/`autoIndex` and is written by login, refresh and every proxied mutation. Any request to an old Admin deployment re-creates it. | Plausible: the base model has `timestamps`, and it is the only Admin writer. Covered: step 3b removes the old **Admin** deployments too. The late-write check covers `vantageadmin.admin_audit_logs`, and the rehearsal used exactly this scenario (§5). |
| old-deployments-6 | 1 of 3 | Older Preview deployments stay alive and run the full old API on request. | Step 1.4 lists them. Step 3b removes every server Preview of the last 48 h, and older Ready ones unless their owner objects, with any kept one recorded. A request to a kept old Preview pointed at production would show up in the recreation checks. |

## 3. Old-deployment risk analysis

**Mechanism.** At T0 the production aliases move to the slim deployments. Crons follow the alias, so the retired schedules stop. Queue messages do not:

- every message the old server published is pinned to it;
- Vercel delivers each one back to the old deployment until it succeeds or reaches the 24 h retention;
- a handler that throws is retried every 30 s;
- delayed sends wait up to their delay;
- several old handlers publish their own successors (the refresh retries, the lifecycle `outreach_ensure` wake-up, the SI next-stage wake-ups, the Best Relocation self-publish), and those are pinned again.

The old code they run writes `operational_events` on success paths (the Granot lifecycle drain run event, the sheet-sync drain event) and on failure paths (refresh `warn`, sheet sync, lead messaging, ingestion). Through the incident path it also writes `operational_incidents` and `notification_deliveries`. The old SI consumer writes `outreach_*` and intelligence collections, and media uploads under `conversations/`. The old Admin writes `admin_audit_logs` on any request it still serves.

**Why the earlier gates missed it.** Each earlier gate proves something else:

| Gate | What it proves |
| --- | --- |
| deployment stamp | the slim code is live |
| retired-stage fence | retired-stage rows are terminal |
| count-growth snapshots | nothing wrote during a 10-minute sample |

None of them proves that no old deployment can be woken later. One refresh retry gap is 15 min, and the queue retention is 24 h.

**Likelihood.** The write is conditional. The commonest path is a failed lifecycle, sheet-sync or lead-messaging message retried against the old deployment; a success-path drain run event then writes on every delivery. The 2026-09-25 RingCentral throttle already showed old deployments claiming pinned work after a fix shipped. With a 15–30 min purge window, the risk is therefore real, not theoretical.

**Mitigation chosen: remove the old deployments, then prove quiet.**

1. **CUTOVER 1.4:** list every server and Admin deployment of the last 48 h (Production and Preview) and older Ready Previews. Record their ids.
2. **CUTOVER 3b (T0 + 2 min):** `vercel remove <url>` for each one, never the stamped slim deployment. Record the ids and Tr. A pinned message for a removed deployment cannot be delivered and expires. Each such message is only a wake-up for a durable row, and the slim crons drain those rows (table in 3b). Removal also ends Instant Rollback, which was already forbidden after the purge; before the purge, rollback is a `workflow_dispatch` of the previous sha.
3. **CUTOVER 5:** snapshot 2 is taken at least 10 min after snapshot 1 and at or after Tr + 800 s, so any in-flight old invocation has ended. QUIET is the earlier snapshot's `observed_at`.
4. **`purge.ts` gate** (`ops/slimming/lib/write-gate.ts`), required for every production run:
   - `--cutover-at=<T0>`;
   - `--quiet-since=<QUIET>` (≥ T0, not in the future);
   - exactly one of:
     - `--old-deployments-removed=dpl_…` (ids only; must not name the stamp's `vercel_deployment_id`);
     - `--old-deployments-kept`, which is allowed only at or after T0 + 24 h 58 min (24 h retention + 45 min refresh max age + 800 s) and with zero `pending`/`retry`/`leased` jobs created before T0.
   - The run aborts when any live drop target or historical collection has an insert (`_id` time, whole-second precision) or a `updatedAt`/`createdAt`/`updated_at`/`created_at` value at or after `--quiet-since`.
   - The check runs at step (a) and **again immediately before each collection drop and before the database drop**, after the backup and cleanups.
   - The gate, the removed ids and the per-target newest writes are logged in `a.assert`.
5. **CUTOVER 8–9:** recreation checks at +0, +5 min, +30 min, +2 h and +1 day. They name `operational_events`, `operational_incidents`, `notification_deliveries` and `admin_audit_logs` explicitly, and re-list the deployments before each check. The re-drop runs with a fresh manifest, a new quiet pair and the gate.
6. **Alternative (removing nothing):** `--old-deployments-kept` after T0 + 24 h 58 min. This replaces the user's 15–30 min window, so the runbook says to ask the user first.

## 4. Code changes

| File | Change |
| --- | --- |
| `ops/slimming/lib/write-gate.ts` (new) | `readCutoverGate`, `cutoverGateProblems`, `OLD_DEPLOYMENT_DRAIN_MS`, `claimableBeforeFilter`, `writesAfterProblems`, `newestWritePipeline` (one read-only `$group`, date-typed fields only), `newestWrite`. |
| `ops/slimming/purge.ts` | Reads the gate; it is required unless `--rehearsal` (where it is checked when given). It reads the stamp's `vercel_deployment_id`, counts claimable pre-T0 jobs, and adds gate and late-write problems to step (a). It calls `assertQuietBeforeDrop` before `dropCollectionExact` and before `dropDatabaseExact`. It logs the gate in `a.assert` and prints it in the dry run. Usage header updated. |
| `ops/slimming/cutover-check.ts` | `--snapshot --cutover-at=<T0>` lists the claimable jobs created before T0, by `stage/status`. Read-only. |
| `ops/slimming/rehearsal/seed.ts` | Optional `--vercel-deployment-id=dpl_…` for the stamp (loopback only). |
| `ops/slimming/lib/slimming.test.ts` | 8 new tests: gate pass, required flags, refusals, the kept path's wait and pre-T0 jobs, the claimable filter, the late-write rule at second precision, the pipeline passing the read guard, and the wiring into `purge.ts` (both drop sites, the log). |
| `vantage-admin/scripts/csi07-local.mjs` | HARDEN open item. The launcher spawned the server's `scripts/csi07-local.ts`, which no longer exists. It now spawns `ops/dev-server.ts` with `PORT=3107` and `DOTENV_CONFIG_PATH` set to a path that does not exist, so no `.env` is read. Smoke-tested: `GET /health` returned 200 on 3107 with that env on the loopback replica; the process was stopped afterwards. |
| `docs/server-admin-slimming/CUTOVER.md` | Intro on old deployments and a timeline; step 1.4 (deployment inventory); step 3 (record T0); new step 3b (removal, its cost, the kept alternative); step 5 (timing after Tr + 800 s, QUIET, `--cutover-at`); steps 6–7 (`GATE` in the dry run, apply and resume; drop-time check); guidance after a late-write abort (new run, not resume); steps 8–9 (+5 min, explicit observability/Admin names, deployment re-listing, `GATE2` for re-drops); step 11 (rollback after 3b). |

## 5. Loopback rehearsal of the gate (`csi01`, 127.0.0.1:27189)

Runner scripts are in the session scratchpad (`predeploy-rehearsal/run3.sh`, `run4.sh`). Synthetic data only: databases `slimrehearsal_gmain`/`slimrehearsal_gadmin`, plus the loopback seed's `vantagemovershistorical`. The seed stamp carries `vercel_deployment_id: dpl_rehearsalSlim`. T0 and QUIET were taken after seeding.

| Case | Result |
| --- | --- |
| Dry run, rehearsal, no gate flags | `no problems` (the gate is optional in a rehearsal) |
| Dry run with `--cutover-at --quiet-since --old-deployments-removed=dpl_rehearsalOldServer,dpl_rehearsalOldAdmin` | Prints the `(a) cutover gate:` line, including 7 claimable pre-T0 jobs listed for the record; then `no problems` |
| Removed list naming `dpl_rehearsalSlim` | `--old-deployments-removed names dpl_rehearsalSlim, the slim deployment that wrote the stamp` |
| `--old-deployments-kept` right after T0 | Two problems: delivery possible until T0 + 24 h 58 min 20 s, and 7 claimable pre-T0 jobs |
| `--quiet-since` before `--cutover-at` | Refused |
| Late `admin_audit_logs` write after QUIET (`updatedAt` = now, count unchanged) | Dry-run problem. `--apply` exits 1 at step (a): `step (a) assertions failed: … admin_audit_logs: updatedAt … at or after --quiet-since`. The run directory holds only `purge-log.json` and the manifest copy: no backup and no mutation. |
| Late `admin_audit_logs` write landing **after `a.assert`**, during the backup and cleanups (`--batch=1`) | The 20 main drops ran, then the run aborted at the Admin drop: `late write found immediately before the drop: … admin_audit_logs: updatedAt 2026-10-04T20:59:18.714Z, at or after --quiet-since 2026-10-04T20:59:12.893Z`. Exit 1; the collection was not dropped. |
| Writer stopped (synthetic timestamp restored), `--resume` of that run | Exit 0: `resume.backups_verified` (31 files), the `admin_audit_logs` drop, the `vantagemovershistorical` drop, `g.verify ok`. The `a.assert` log carries the gate (removed ids, quiet_since, claimable jobs, 24 namespaces checked). |
| `rehearsal/verify.ts` against the before/after snapshots | **138/138** checks passed |
| `cutover-check.ts --recreation` on the purged state | `no findings` |
| `cutover-check.ts --snapshot --cutover-at=<T0>` | `claimable jobs created before T0 {"rebuild/retry":1,"attachment_refresh/pending":1,"call_log_reconcile/leased":1}` (retained stages only, after C2) |

The resume here was safe only because the synthetic write was reverted exactly. In production, CUTOVER says to start a **new** run after a late-write abort, because the old run's backup of that collection predates the late write.

Cleanup: the rehearsal dropped only the databases it created: `slimrehearsal_gmain`, `slimrehearsal_gadmin` and the loopback `vantagemovershistorical`. The csi07 smoke check created no database. The replica holds `admin`, `config` and `local`, and it was not stopped. Nothing touched production.

## 6. Final lock

Run serially through the shared `heavy.sh` lock with `NODE_OPTIONS=--max-old-space-size=6144`. Server tests used `DOTENV_CONFIG_PATH=C:/nonexistent.env`.

| Repo | Command | Result |
| --- | --- | --- |
| server | `tsc --noEmit -p tsconfig.json` (includes `ops/**`) | **0 errors**, exit 0 (73 s) |
| server | full unit suite: `node --import tsx --import ./ops/test-setup.ts --test --test-concurrency=2 "src/**/*.test.ts" "api/queues/**/*.test.ts" "ops/lib/*.test.ts"` | **2,599 tests: 2,461 pass, 0 fail, 0 cancelled, 138 skipped** (replica/env-gated), exit 0 (673 s) |
| server | `ops/slimming/lib/slimming.test.ts` (not in the `pnpm test` glob) | **43/43 pass**. Together with `ops/lib/*.test.ts`: **50/50** (HARDEN 42 + 8 new) |
| server | `eslint src api ops/quality --max-warnings 0` | **clean**, exit 0 |
| Admin | `tsc --noEmit` | **0 errors** |
| Admin | `node --import tsx --test --test-concurrency=2 "{lib,server,tests}/**/*.test.ts"` | **708 tests: 693 pass, 0 fail, 15 skipped** (same total as wave 3) |
| Admin | `eslint` | 18 problems (11 errors, 7 warnings), all pre-existing. The baseline had 26. **No file is over its baseline count; no new problem** |
| MCP | `tsc --noEmit` | **0 errors** |
| MCP | `node --import tsx --test "lib/**/*.test.ts"` | **33/33 pass** |
| Admin | `node --check scripts/csi07-local.mjs` | syntax ok |

## 7. Residual risks and operator notes

- **Vercel facts not provable from the repo.** These come from the auditors and the 2026-09-25 incident note, not from a test:
  - a pinned message for a removed deployment is not re-routed to another deployment;
  - `vercel remove` on a deployment with an in-flight invocation may not stop that invocation at once.

  The runbook is written so that both are safe: the quiet window starts after Tr + 800 s, and the late-write check runs again at every drop.
- **The late-write check sees documents only.** It cannot see a collection that an old model's first use re-creates **empty** after its drop (`autoCreate`/`autoIndex` with no insert). The existence checks in step (g) and the recreation checks (CUTOVER 8–9) do see it. Removing the old deployments is what prevents it.
- **Server and Admin scope.** `<team>` for the server and Admin projects is still to be confirmed with `vercel project ls/inspect` (HARDEN open item). The project names `vantage-movers-main-server` and `vantage-admin` are confirmed the same way in step 1.4.
- **The tracked `ops/slimming/deletion-manifest.json` is stale** (pre-wave 2, no C7). CUTOVER step 6 regenerates it, and it is never applied as is.
