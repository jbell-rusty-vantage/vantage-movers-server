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

## 8. Lane HARDEN: C7 and the purge-safety fixes (2026-10-04)

Branch `slim/server-admin` at server `709480d3` plus this lane's uncommitted changes. The rules are the same as above:

- every write went to the loopback replica `csi01`;
- `BLOB_READ_WRITE_TOKEN` was unset and `DOTENV_CONFIG_PATH=C:/nonexistent.env`;
- no production system was touched.

The driver scripts and logs are in the session scratchpad `harden-rehearsal/` (`run1.sh`, `run2.sh`, `*.log`; synthetic data only).

### 8.1 What changed in `ops/slimming`

**Cleanup gap (new C7).** `call_interactions` still carried `recordings[].lead_conversation_id` and the `recording_discovery` sub-document. Both point into the dropped `lead_conversations`, and the slim schema no longer declares either.

- C7 is defined in `policy.ts` (`CALL_INTERACTION_DEAD_PATHS`, `CLEANUP_STATUS`/`CLEANUP_SCOPES`). It runs `$unset recording_discovery` and `$unset recordings.$[].lead_conversation_id`.
- Each path is a separate update with its own filter (`unsetPathFilter`). The `$[]` update runs only where `recordings` is an array and some element carries the field, so it can never fail on a document.
- `assertUnsetPath` validates the paths: dotted names, with at most one inner `$[]`.
- `inventory.ts` counts and manifests C7. Backup before mutation applies as for C1–C6.
- The stale `call_interaction_discovery_state` index is left alone: the guard never sends `dropIndexes`.

**purge-safety-1: the manifest scope was not tied to the policy.** `manifestPolicyDrift(targets)` now re-derives the whole allowed scope from `policy.ts`:

- Every drop or absent target must be in `MAIN_/ADMIN_DROP_COLLECTIONS` for its own database, and every policy target must appear exactly once.
- The only database drop allowed is `vantagemovershistorical`.
- The protected list must equal `NEVER_DROP` + `ADMIN_NEVER_DROP`.
- Every `CLEANUP_SCOPES` id must appear exactly once, with the policy's status, kind, collection, fields, stages, reason, key field and filter. Sync-scope key values may be a subset of the policy list, never another value.
- `inventory.ts` refuses to write a manifest that drifts.

**purge-safety-6: drift was only printed in a dry run.** Drift is now a problem. The dry-run verdict lists it (`manifest/policy drift: …`), and `--apply` aborts on it before connecting or creating a run directory.

**purge-safety-2: a cleanup could mutate documents its backup does not hold.**

- Each cleanup loads the `_id`s of every backup file this run recorded for it (`cleanup_id` on the backup entry).
- Every page is checked before it is mutated, in the terminalize, delete and generic cleanup paths.
- An id not yet backed up is first written to a verified `cleanup-<id>-extra-<n>.ejson.gz` (count and sha256 read back) and logged as `c.cleanup_extra_backup`.
- If an id cannot be backed up and the document still exists, the run aborts.
- An interrupted step (b) restarts from an empty backup list, so no partial entry survives.

**purge-safety-5: `--resume` trusted old backups.** Before the purge client connects, `--resume` re-verifies every backup file of the run: Mongo files by count and sha256, Blob files by size and sha256 on disk (via `blob-backup.json`). The first mismatch refuses the resume (`resume refused: this run's backups no longer verify`).

**purge-safety-4: Blob delete scope with `--skip-blob-backup`.**

- Step (d) now takes a fresh listing immediately before deleting (`blobDeletePlan`).
- Any object under `conversations/` that the manifest does not list aborts step (d) before anything is deleted. A manifest key outside the prefix is also a problem.
- `del` only ever receives present manifest keys, so `--skip-blob-backup` changes step (b) only.
- Steps (a) and (g) still fail on unlisted objects.
- This path is not exercised here (a rehearsal never calls Blob); unit tests cover it.

**Tests.** `ops/slimming/lib/slimming.test.ts` has 9 new or rewritten tests:

- policy drift on cleanups, including a manifest without C7;
- policy drift on drop targets, absent targets, the database drop and the protected list;
- the C7 path filters and the refused path shapes;
- the Blob delete plan;
- backup `_id` coverage;
- resume re-verification of Mongo and Blob files;
- the `purge.ts` wiring.

**New read-only tool, `ops/slimming/cutover-check.ts`**, used by CUTOVER.md. It is guarded like `inventory.ts`, and its Blob access is `list` only. It has three modes:

- `--agents`: duplicate `granot_identity.username` check, run before the deploy;
- `--snapshot [--since] [--compare]`: per-target counts and last insert/update times, legacy jobs (with a by-dataset breakdown), the deployment stamp and the Blob prefix;
- `--recreation`: run after the purge.

A loopback run (`slimrehearsal_cmain`/`cadmin`, dropped afterwards) checked `--agents`, a `--compare` that caught a late write and `--recreation`. Two unit tests cover its findings logic.

`node --import tsx --test --test-concurrency=2 ops/slimming/lib/slimming.test.ts ops/lib/*.test.ts` passes **42/42**. Server `tsc --noEmit` reports **0 errors**.

### 8.2 Rehearsal run

Databases: `slimrehearsal_hmain` and `slimrehearsal_hadmin`, plus the literal `vantagemovershistorical`.

The seed is as in §4.1, without the live-lease row. It adds **`call_interactions` with 5 rows**:

1. `recording_discovery` plus 2 recordings, one with a `lead_conversation_id` ObjectId and one with `null`;
2. `recording_discovery: null` with `recordings: []`;
3. one recording with no pointer and no discovery (C7 must leave it alone);
4. one recording with a pointer and no discovery;
5. a call with neither (`purged_at: null` only).

It also creates the stale `call_interaction_discovery_state` index.

1. **Manifest** (`inventory.ts --rehearsal --write-manifest`), hash `bfa0e1863b837a75…cddf`:
   - 21 drop collections;
   - the historical DB (3 collections);
   - 43 protected names;
   - 7 cleanups: C1 2, C2 9 `{pending 2, retry 1, paused 1, leased 1, dead_letter 1, completed 2, retired 1}`, C3 8, C6 5, C4 6, C5 2, **C7 3** (rows 1, 2 and 4).
2. **Dry run:** `no problems`.
3. **Tampered manifest, refused.** A copy of the manifest added `testimonials` as a drop target and removed `daily_operations_days` from the protected list. It was then rehashed, so the hash check alone would have accepted it.
   - The dry run listed `manifest/policy drift: drop target slimrehearsal_hmain.testimonials is not in policy.ts MAIN_/ADMIN_DROP_COLLECTIONS` and `protected main namespaces differ from policy.ts NEVER_DROP`.
   - `--apply` with the matching hash **ABORTED** with exit 1 (`the manifest is stale against policy.ts (2 difference(s))`). This happened before connecting, and no run directory was created.
4. **Apply** (`--batch=2`): exit 0, deployed commit `709480d3`.
   - 31 verified backups, 108 documents, including `cleanup-C7-call-interactions-conversation-pointers.ejson.gz` (3 docs, sha `764da9f4915c2c86…`).
   - Cleanups: C1 2; C2 terminalized 5 and deleted 9; C3 8; C6 5; C4 6; C5 2; **C7 3**.
   - 21 collections dropped and `vantagemovershistorical` dropped. Step (g) passed.
5. **`rehearsal/verify.ts`: 138/138 checks passed.** The 6 new C7 checks:
   - no `recording_discovery` remains;
   - no `recordings.lead_conversation_id` remains;
   - all 5 calls are kept;
   - all 4 recordings are kept, in order (`r1,r2,r3,r4`);
   - every recording still has exactly `observed_at` + `provider_recording_id` + `recording_type`;
   - the unrelated `purged_at: null` is kept.

   `call_interactions` kept its indexes, including the stale one. Every untouched namespace is byte-identical: Daily Operations, receipts, entity changes and Admin auth.
6. **`--resume` of the finished run:** exit 0, `resume.backups_verified {"files":31}`. The before and after snapshots are identical.

### 8.3 Coverage, corrupted resume and idempotency

**Documents that start matching after step (b).** This simulates a crash after the backups.

- On a copy of the run directory, C7 was rewound: removed from `cleanups_done`, checkpoint removed, run marked unfinished.
- 2 new calls with pointers were then inserted. They are not in the C7 backup.
- `--resume` exited 0. It logged `resume.backups_verified` (31 files), then `c.cleanup_extra_backup {"ids":2,"documents":2}`, then C7 processed 2, then step (g) passed.
- The extra file holds both calls **before** mutation: `extra-a` with `recording_discovery`, `extra-b` with `lead_conversation_id`.
- Afterwards, 0 documents carry a pointer.

**Corrupted backup on resume.**

- The same rewind was applied to another copy, 2 more pointer calls were inserted, and one byte of the C7 backup was flipped.
- `--resume` **refused** with exit 1: `resume refused: this run's backups no longer verify: backup cleanup-C7-…ejson.gz does not verify (incorrect data check)`.
- The 2 pointer calls were still present afterwards, so no mutation ran.

**Fresh manifests on the purged state (C7 is idempotent end to end).**

- Manifest 2: 0 drop collections, 21 absent targets, 0 databases, **C7 expected 2** (the calls left by the refused resume). The dry run reported `no problems`. Apply exited 0: C7 processed 2 and step (g) passed.
- Manifest 3: **C7 expected 0**. Apply exited 0: C7 processed 0 and step (g) passed.
- 0 documents carried a pointer throughout.

### 8.4 Cleanup

Dropped on loopback `csi01`:

- `slimrehearsal_hmain` (43 collections) and `slimrehearsal_hadmin` (3), both created by this lane;
- the leftover walk databases `testvantagemovers_walk09` (59) and `testvantagemovers_walk09admin` (1).

`vantagemovershistorical` was already dropped by the rehearsal purge. The final listing is `admin`, `config` and `local`, with 0 collections under a retired name. The replica process was not stopped.

### 8.5 Still open

- The tracked `ops/slimming/deletion-manifest.json` predates wave 2 and C7, and the new drift check reports it as stale. The cutover regenerates it (CUTOVER.md); it is never applied as is.
- Blob paths (`blobDeletePlan`, Blob re-verification on resume) are covered by unit tests only.
- Index `call_interaction_discovery_state` stays in production after C7. It is harmless (every key is null) but wasted. Dropping it needs a separate, explicit operator step.
