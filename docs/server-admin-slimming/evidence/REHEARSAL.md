# Lane PROOF: SLIM-09 replica proofs and the purge apply rehearsal

Wave 3, 2026-10-04. Branch `slim/server-admin` at server `9007f43f` plus this lane's uncommitted changes. Every database write in this lane went to the loopback replica `csi01` (`mongodb://127.0.0.1:27189/?replicaSet=csi01`, native mongod 8.0.4). Nothing touched production Mongo, Redis, Blob, RingCentral, Granot or Vercel. `purge.ts --apply` ran only with the new `--rehearsal` mode, which refuses anything except a loopback replica. `BLOB_READ_WRITE_TOKEN` was unset and `DOTENV_CONFIG_PATH` named a missing file in every run. Heavy commands went through the shared `heavy.sh` lock.

At the start the replica held only `admin`, `config` and `local`. At the end it holds the same three: every database this lane created was dropped (§5).

## 1. Retained replica proofs

Each runner was read before it ran. Two of the three needed a fix first.

| Runner | Problem found before running | Fix |
| --- | --- | --- |
| `pnpm test:granot-lifecycle:replica` | The script ran `node --env-file=.env`, which loads the **production** `.env` (production `MONGO_URI` and every provider secret). The runner checked only the database name and the replica-set flag, so it could have connected to the production cluster's `testvantagemovers` database. | `package.json` no longer passes `--env-file`. `ops/test-granot-lifecycle-replica.ts` pins its environment before any `src/` import: `TEST_MODE=true` is required; a caller `MONGO_URI` must be loopback (default `csi01`); provider/secret variables are dropped; `DOTENV_CONFIG_PATH` points at a file that does not exist; and every replica member must be loopback. Refusals were checked: no `TEST_MODE`, an SRV URI and `TEST_MONGO_DATABASE_NAME=vantagemovers` are all refused. |
| `pnpm test:csi:fence:replica` | It targeted `mongodb://127.0.0.1:27017/?replicaSet=rs0`, which does not exist on this machine. It also did not pin dotenv. | `ops/lib/csi-enqueue-replica-target.ts` now targets the loopback `csi01:27189`, and its unit test pins that URI. The runner drops provider variables and pins `DOTENV_CONFIG_PATH` before any `src/` import. |
| `pnpm test:numbers:replica` | None. It already strips provider/Mongo variables, pins dotenv and targets loopback `csi01`. | — |

The shared helper `ops/lib/loopback-mongo.ts` (`isLoopbackMongoUri`, with a unit test) is used by the lifecycle runner and the rehearsal tooling.

### Results (final runs)

| Proof | Result |
| --- | --- |
| `pnpm test:csi:fence:replica` | **PASS.** Enqueue/claim/renew/retry/continue/complete, dataset fences, TTL unchanged, and the retired-stage fence. Pending/retry/paused rows and a lease still held by an old deployment are terminalized as `retired` (reason `stage_retired`, `lease_epoch` +1, no `completed_at`). Terminal rows are untouched. Nothing claims a retired row, by id or undirected. A late queue wake-up for a retired row is acknowledged as `{status:"retired"}` without running a handler. The old holder's completion gets `LEASE_LOST` and its effect never runs. A second sweep is a no-op. Enqueue of a retired stage is `INVALID_INPUT` and writes no row. No collection is created, and no retired collection name exists in the proof database. |
| `pnpm test:numbers:replica` | **PASS 1/1** (0 skipped). Numbers list, detail and timeline with every retired collection absent before and after; attachment identity `none`, `multiple` (never picks one), `resolved` and candidate-only (`none`); the Lead→attachment trigger nominates only `attachment_refresh`. |
| `pnpm test:granot-lifecycle:replica` (`TEST_MODE=true`) | **PASS 146/146, 0 skipped.** Pass 1 (Sheet Sync disabled): 106/106. Pass 2 (Sheet Sync queued): 40/40. |
| `src/services/granotLifecycle/healthState.replica.test.ts` (inside the sweep, and alone) | **PASS 4/4.** A Mongo-down capture failure is logged and fenced as a coverage gap. Two writers increment one minute bucket exactly under the unique fence. The latest run per trigger survives late writers. Alert transitions emit once across two simulated instances and a restart. Unknown is not zero: warm counters read `null` while the gap is inside their window. |

### Sweep failures found and fixed (tests and runner only; no `src/` change)

The first sweep run had 21 failures in 134 tests. Causes:

1. **Runner: Sheet Sync mode.** The first pass ran every file with `SHEET_SYNC_MODE=disabled`, including the queued-effect proofs that assert outbox rows. Two such files were also missing from the queued pass (`bookingOwnerCommands`, `connectBookingToLead`). Now the first pass excludes the five queued-effect files, and the second pass runs all five with `queued`.
2. **Runner: configuration that used to come from `.env`.** Synthetic `TEST_*_SHEET_ID` values are set (the planner needs a target id; `ops/test-setup.ts` blocks publication and Google delivery). `RINGCENTRAL_CREATE_CALL_LEADS=true` is set to match the deployed posture; ingest makes no provider call.
3. **`connectBookingToLead.replica.test.ts` seeds were stale against the schemas.** The Agent had no `normalized_name`, the FormLead had no `local`, and `cancelled` was set to a Date on an ObjectId ref. The seeds are fixed.
4. **`call-log-sync-lease` / `callLeadConvergence` replica tests assumed a long-lived test database.** The test-runner branch of `processed-calls-store.ts` calls `collection.indexes()`, which throws `NamespaceNotFound` on a fresh database. Both proofs now create the collection in setup.
5. **`callLeadConvergence` expected `domain_revision: 0`** for a freshly created Call Lead. Creation runs `emitLeadChange(before: null)`, so the stored revision is 1 by design. The test now asserts the stored revision is 1 and that the candidate carries the stored revision. This failure is **not a slimming regression**: the same proof, run at baseline `6a374fab` in a throwaway detached worktree (removed afterwards), fails identically.
6. **`healthState.replica.test.ts` gap proof predated the reconnect fence.** `installReconnectFence` persists the gap on the first connection. The test then ran `deleteMany({})`, which erased that fenced row before asserting. The test now waits for the fence (a `gap_at` at or after the miss) and then proves a later write keeps it and warm counters read unknown.
7. **`test-csi-enqueue-replica.ts` raced Mongoose `autoCreate`.** Importing the dispatcher registers retained models whose collections appear asynchronously (`extension_users`, `granot_automation_sources`, `sheet_sync_quota_buckets`, `wordpress_form_submission_receipts`), so "no collection created" failed on retained names. The proof now settles every registered model's `init()` before the snapshot and adds an explicit check that no retired name exists. It also settles init before the final `dropDatabase`, because each earlier run had left a residual `testvantagemovers_enqueue*` database. The last run left none.

### `src/` defects found (reported, not fixed)

- **`src/models/Agent.ts:40-47`: the index `granot_identity.username_1` is `unique + sparse + partialFilterExpression`.** Mongo 8 rejects that spec (`CannotCreateIndex` 67: "cannot mix partialFilterExpression and sparse"). Mongoose autoIndex swallows the error, so the index never exists, and Granot CRM username uniqueness on Agents is **not enforced by the database**. The spec is the same at baseline `6a374fab`. Dropping `sparse: true` is a one-line change, but on the next deploy it makes production autoIndex build a new unique index, which fails if duplicates exist. Check production for duplicate `granot_identity.username` values first. Owner: Registry / Granot identity.
- **`src/services/ringcentral/processed-calls-store.ts` (`createIndexes`, both branches): `collection.indexes()` throws `NamespaceNotFound` when the collection does not exist.** The test-runner branch fails on any fresh database (worked around in the proofs). The production branch would surface a raw `NamespaceNotFound` instead of "RingCentral processed-call indexes are not predeployed." if the collection were missing. Low impact.

## 2. No retired collection on the replica

After all suites, `listCollections` over **every** database on the replica (9 at that moment: `admin`, `config`, `local` and six test databases) found **0** collections named `lead_conversations`, `intelligence_*`, `move_assessment_artifacts`, `sales_intelligence_ai_budget`/`_ai_reservations`, `sales_intelligence_attention_*`, `outreach_records`/`_followups`/`_band_transitions`/`_rep_days`, `operational_events`/`_incidents`, `notification_deliveries`, `operational_report_runs` or `admin_audit_logs`, including the `test_` aliases.

After the rehearsal, the only matches were the three collections deliberately restored into the isolated `slimrehearsal_restore` database (§4.6). After cleanup there were 0.

## 3. Rehearsal mode for the purge tooling

Before this lane, `ops/slimming` could not point at a rehearsal safely:

- It always read the server and Admin `.env` files, including the production Blob token and the Admin Atlas URI.
- It hard-coded `vantagemovers`/`vantageadmin`.
- It wrote the manifest over the tracked `ops/slimming/deletion-manifest.json`.

There was also a general Blob skip. Without a token, or with `--skip-blob`, `inventory.ts --write-manifest` produced a manifest with `blob: null`, and `purge.ts` would then drop `lead_conversations` without ever backing up or deleting its media objects.

Changes:

| File | Change |
| --- | --- |
| `ops/slimming/lib/rehearsal.ts` (new) | `resolveSlimmingTarget(argv)`: production by default. `--rehearsal` requires `--rehearsal-main-db` and `--rehearsal-admin-db` as two distinct `slimrehearsal_<suffix>` names, and `--manifest` as an absolute path outside the workspace. The rehearsal-only flags are refused without `--rehearsal`. `loadRehearsalEnv` reads no `.env` file and refuses unless `MONGO_URI` is loopback-only (no SRV, every host `127.0.0.1`/`localhost`), `BLOB_READ_WRITE_TOKEN` is unset, and `DOTENV_CONFIG_PATH` names a file that does not exist. |
| `ops/slimming/lib/env.ts` | `loadSlimmingEnv` refuses `--rehearsal`. |
| `ops/slimming/lib/manifest.ts` | Optional `targets.rehearsal: true`, which is part of the hash; absent in production, so production hashes are unchanged. A rehearsal manifest must use `slimrehearsal_` names and have **no Blob target**. A production manifest must use the policy names. Neither may drop its own main or Admin database. |
| `ops/slimming/inventory.ts` | Uses the target's database names and manifest path; a rehearsal never calls Blob. **`--write-manifest` now refuses a skipped Blob listing in production**: no general skip. |
| `ops/slimming/purge.ts` | Executes only a manifest whose mode matches the run. A rehearsal requires a null Blob target and an empty key list. A production run with a Blob-less manifest is a step (a) problem. |
| `ops/slimming/lib/slimming.test.ts` | 5 new tests (26 total): the target defaults and refusals, the env refusals (SRV, mixed hosts, Blob token, existing dotenv file), manifest separation, and the wiring. |
| `ops/slimming/rehearsal/{guard,seed,snapshot,verify,restore}.ts` (new) | Loopback-only helpers. `seed` builds the synthetic dataset and refuses to seed over existing databases. `snapshot` and `verify` are read-only through the slimming driver guard. `restore` restores into an isolated database. |

Each of these was refused before any connection was made: a Blob token set; an SRV URI; `DOTENV_CONFIG_PATH` pointing at the real `.env`; a rehearsal manifest without `--rehearsal`; `--rehearsal` pointed at the tracked production manifest; a production database name as the rehearsal main database; re-seeding over existing databases. `git status` confirmed the tracked manifest, the Blob key list and `evidence/inventory.json` were not written.

## 4. Purge apply rehearsal (loopback `csi01`)

Reproduce from `vantage-main-server`. Set `MONGO_URI=mongodb://127.0.0.1:27189/?replicaSet=csi01` and `DOTENV_CONFIG_PATH=C:/nonexistent.env`, leave `BLOB_READ_WRITE_TOKEN` unset, and use `R="--rehearsal --rehearsal-main-db=slimrehearsal_main --rehearsal-admin-db=slimrehearsal_admin --manifest=<scratch>/deletion-manifest.json"`.

```
node --import tsx ops/slimming/rehearsal/seed.ts --main-db=slimrehearsal_main --admin-db=slimrehearsal_admin --deployment-commit=$(git rev-parse HEAD) --live-legacy-lease
node --import tsx ops/slimming/inventory.ts $R --write-manifest
node --import tsx ops/slimming/purge.ts $R                                   # dry run
node --import tsx ops/slimming/purge.ts $R --apply --manifest-hash=<hash> --backup-dir=<scratch>/purge-rehearsal-backup --i-confirm-slim-deployed --batch=2
node --import tsx ops/slimming/rehearsal/verify.ts --manifest=<m> --before=<snap> --after=<snap>
node --import tsx ops/slimming/rehearsal/restore.ts --run-dir=<run> --namespace=<db.coll> --into-db=slimrehearsal_restore --into-collection=<name>
```

### 4.1 Synthetic dataset (74 namespaces, all synthetic values)

- **`slimrehearsal_main`, 63 collections:**
  - all 20 main drop targets, with 2–4 documents each. `notification_deliveries` has a TTL index. Two `lead_conversations` rows carry `media.blob_pathname` values under `conversations/`.
  - all 41 `NEVER_DROP` collections, plus `testimonials` and the unclassified `rehearsal_unclassified_collection`.
  - `daily_operations_events` (3), `daily_operations_days` (2), `granot_webhook_receipts` (3), `entity_changes` (3).
  - **`contact_numbers` (5):** dead fields + review fields + `purged_at`; review fields + `purged_at`; dead fields only; `purged_at` only; clean. Every row has the retained `rollups.calls_total`.
  - **`sales_intelligence_jobs` (16):** legacy rows `analysis`/pending, `backfill`/pending, `transcription`/retry, `media_fetch`/paused, `outreach_ensure`/leased with an expired lease, `move_assessment`/dead_letter, `application`/completed, `rep_identity_reevaluate`/completed, `number_refresh`/retired, and `recording_discovery`/leased with a **live** lease. Retained rows: `attachment_refresh`/pending, `call_log_reconcile`/leased with a live lease, `directory`/completed, `rebuild`/retry, `nudge_repair`/paused, `capture_projection`/dead_letter.
  - **`sales_intelligence_sync_state` (24):** 8 retired scopes, 5 outreach-cursor scopes, 9 kept scopes, `rep_identity:rehearsal`, and the `deployment` stamp `deployment_commit=9007f43f…`.
  - **`sales_intelligence_audit_events` (14):** 3 retired kinds × actors `worker`/`intelligence`/`owner`/`rep`, plus a kept kind by a worker and a kept kind by the Owner.
- **`vantagemovershistorical`** (literal name, on loopback): `form_leads` 4, `call_leads` 3, `booked_leads` 2.
- **`slimrehearsal_admin`:** `admin_audit_logs` 5, `admin_users` 2, `admin_user_invites` 2, unclassified `rehearsal_admin_sessions` 1.

### 4.2 Manifest, dry run and the live-lease abort

`inventory.ts --rehearsal --write-manifest` wrote a manifest with:

- `rehearsal: true`, cluster `325a32977f41945d` / `csi01`, `blob: null`, key list `[]`;
- 21 drop collections (20 main + `admin_audit_logs`; `notification_deliveries` flagged `ttl`);
- the `vantagemovershistorical` database (3 collections);
- six cleanups: C1 2, C2 10 rows `{pending 2, retry 1, paused 1, leased 2, dead_letter 1, completed 2, retired 1}`, C3 8, C6 5, C4 6, C5 2;
- 43 protected namespaces.

The unclassified collections were not targeted.

- **Dry run:** step (a) found exactly one problem: `cleanup C2-legacy-stage-jobs: 1 legacy jobs hold a live lease (old workers still running)`. The deployment check passed for the seeded stamp `9007f43f`: it descends from `6a374fab` and none of the five retired model files exist.
- **Refusals with `--apply`:** a wrong `--manifest-hash` is refused, a missing `--i-confirm-slim-deployed` is refused, and with the correct hash and flags the run **ABORTED at step (a)** on the live lease. A before/after snapshot (count + content sha + indexes for every collection) shows the aborted run changed nothing.
- **Simulated quiesce:** the old worker's lease was set to expire, and the manifest was regenerated as the runbook requires. The new hash was `c90e0653…07f0`. The only differences were WiredTiger `storage_size`/`index_size` values after a checkpoint; namespaces, UUIDs and counts were identical. **Note for SLIM-10:** the hash covers storage bytes, so regenerate immediately before `--apply`. The dry run then reported "no problems".

### 4.3 Apply (`--batch=2`, so every cleanup paged; 3.8 s)

Run dir: `purge-rehearsal-backup/slimming-purge-2026-10-04T19-02-21-134Z` (scratchpad, outside the workspace).

- **(b) Backups:** 30 verified backups, 106 documents in all, each read back for count and sha256 before any mutation. They cover the 20 main drop targets, `admin_audit_logs`, the 3 historical collections and the 6 cleanup selections, and they record index specs (e.g. `rehearsal_ttl`, `csi_job_dedupe`, `scope_1`, `e164_1`). C2: `cleanup-C2-legacy-stage-jobs.ejson.gz`, 10 docs, sha `2c5480fa40b62b57…`.
- **(c) Cleanups:**
  - C1 unset 2;
  - **C2 terminalized 6 and deleted 10**;
  - C3 deleted 8;
  - C6 deleted 5;
  - C4 deleted 6;
  - C5 unset 2.
- **(d) Blob:** none (no Blob target; Blob never called).
- **(e)/(f):** 21 collections dropped, each with its UUID and count re-asserted right before the drop; `vantagemovershistorical` dropped.
- **(g)** verify OK.

**Non-terminal retired-stage jobs: exactly what happened.** The policy is DELETION-MANIFEST C2. Nothing was silent: every row is listed with its pre-purge state in the hashed manifest counts and in the C2 backup.

| Row (stage / status at backup) | Outcome |
| --- | --- |
| `analysis` / pending, `backfill` / pending, `transcription` / retry, `media_fetch` / paused | Set to `dead_letter`, `reason: "slimming_retired_stage"`, lease cleared, `lease_epoch` +1. Then deleted. |
| `outreach_ensure` / leased (expired), `recording_discovery` / leased (expired after quiesce) | Same: dead-lettered, epoch +1, then deleted. **While the lease was live the purge refused to start.** |
| `move_assessment` / dead_letter, `application` / completed, `rep_identity_reevaluate` / completed, `number_refresh` / retired (server fence) | Deleted. |
| 6 retained-stage rows, including a **live** lease on `call_log_reconcile` | Untouched: status, lease, `lease_epoch` 1, `updatedAt == createdAt`. A retained live lease does not block the purge. |

### 4.4 Verification: `rehearsal/verify.ts`, 132/132 checks passed

- All 21 drop targets are absent, and `vantagemovershistorical` is absent.
- Every other main/Admin collection is present. The untouched ones are **byte-identical**: same count, same content sha over canonical EJSON in `_id` order, same index names. That covers all `NEVER_DROP` names, `testimonials`, both unclassified collections, `admin_users`, `admin_user_invites`, **`daily_operations_events`/`daily_operations_days` (Daily untouched)**, `granot_webhook_receipts` and `entity_changes`.
- `contact_numbers`: no dead or review field remains; **`purged_at` kept on all 3 rows that had it**; `rollups.calls_total` kept on all 5 rows; no document deleted; indexes kept.
- `sales_intelligence_jobs`: 16 → 6. No legacy-stage row remains, and the 6 retained rows are untouched.
- `sales_intelligence_sync_state`: 24 → 11. Retired and outreach-cursor scopes are gone. The kept scopes, `rep_identity:rehearsal` and the **`deployment` stamp** remain.
- `sales_intelligence_audit_events`: 14 → 8. The 6 worker/intelligence rows of retired kinds were deleted. **The 6 Owner/Rep rows of the same kinds were kept**, as was the kept kind written by a worker.

### 4.5 Idempotency and resume

- **`--resume` of the finished run:** exit 0. It ran (a) then (g) with nothing in between, and before/after snapshots are identical.
- **Fresh `--apply` with the now-stale manifest:** refused at step (a). Exit 1, with 22 problems: 21 collections and the historical database "absent but not recorded as dropped by this run". A fresh run never re-executes a consumed manifest.
- **Crash between a drop and its log write:** simulated on a copy of the run dir. The log was rewound so the last 5 collection drops and the database drop were unrecorded, C4/C5 were not done and the run was unfinished. `--resume`:
  - reconciled the 5 drops (`e.drop_collection_reconciled`) and the database drop (`f.drop_database_reconciled`) through this run's verified backups;
  - re-ran C4 and C5 with 0 documents processed;
  - finished with 21 drops, the database dropped and 6 cleanups done.
- **The same crash with one byte of the `outreach_records` backup corrupted:** resume **refused** at step (a) ("absent but not recorded as dropped"). A drop is accepted on resume only with a backup that verifies.

### 4.6 Isolated restore: count and sha match

`rehearsal/restore.ts` verifies each backup file, restores it into the isolated `slimrehearsal_restore` database, recreates its recorded indexes, and re-dumps the result with the purge's own writer:

| Backup | Restored as | Docs (backup / restored) | Backup sha256 = re-dump sha256 | Content sha = pre-purge snapshot |
| --- | --- | --- | --- | --- |
| `slimrehearsal_main.lead_conversations` | `lead_conversations` | 3 / 3 | `595469e966fc8eb0…` ✔ | `b5863259fd805ab4…` ✔ |
| `slimrehearsal_main.notification_deliveries` (TTL index recreated) | `notification_deliveries` | 4 / 4 | `bd8b540db2267a97…` ✔ | `a087ad2e656c2338…` ✔ |
| `slimrehearsal_admin.admin_audit_logs` | `admin_audit_logs` | 5 / 5 | `fc2bca9ace0821e9…` ✔ | `2cd323828bcdcf90…` ✔ |
| `vantagemovershistorical.form_leads` | `historical_form_leads` | 4 / 4 | `96a4cba183e77253…` ✔ | `ad32249a7efd2494…` ✔ |
| `vantagemovershistorical.call_leads` | `historical_call_leads` | 3 / 3 | `d4b6fe20efd39018…` ✔ | `f8ea3004a672a814…` ✔ |
| `vantagemovershistorical.booked_leads` | `historical_booked_leads` | 2 / 2 | `4c51109fe2076378…` ✔ | `a5d73725c4332507…` ✔ |

That covers one dropped main collection, the Admin audit log and the **whole historical database**. Index names also matched the pre-purge state. Restoring over an existing collection, or into a non-`slimrehearsal_` database, is refused.

## 5. Cleanup

Dropped only databases this lane created, on loopback `csi01`:

- `slimrehearsal_main`, `slimrehearsal_admin`, `slimrehearsal_restore`;
- `testvantagemovers_baselinerc`, `testvantagemovers_lcone`, `testvantagemovers_lifecycleproof`, `testvantagemovers_lifecyclefinal`;
- three residual `testvantagemovers_enqueue*` databases.

`vantagemovershistorical` was already gone (dropped by the rehearsal purge). Final listing: `admin`, `config`, `local`; 0 retired names. The replica process was not stopped. The backups and run logs stay in the session scratchpad (`purge-rehearsal-backup/`, synthetic data only).

## 6. Checks run

- `node node_modules/typescript/bin/tsc --noEmit -p tsconfig.json` (whole server, includes `ops/**`): **0 errors**.
- `eslint --max-warnings 0` on the 4 changed `src/**/*.replica.test.ts` files: clean. `ops/` is outside the ESLint config.
- `node --test ops/slimming/lib/slimming.test.ts ops/lib/*.test.ts`: **33/33**.
- The replica proofs and the rehearsal, as above.

## 7. Open items for SLIM-10 and other lanes

- **Agent `granot_identity.username` unique index never builds** (§1). It needs an owner decision and a production duplicate check before the spec is fixed.
- **Production `--write-manifest` now requires `BLOB_READ_WRITE_TOKEN`.** That is intended: the tracked manifest already carries 3,017 keys. Regenerate it after the deploy and quiesce, immediately before `--apply`, because the hash includes storage bytes.
- **This rehearsal ran on synthetic data, not a restored production copy.** SLIM-09 also asks for a run on a restored production-shaped dataset, plus storage and latency comparisons; neither is covered here. Blob backup and delete paths were not exercised: the rehearsal never calls Blob by design, and they are covered only by unit tests.
