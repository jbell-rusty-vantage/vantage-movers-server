# Lane DATA: SLIM-01 read-only inventory and SLIM-10 preparation

Wave 1. Branch `slim/server-admin` (server base `6a374fab`). No production data, object or configuration was mutated. Every production access went through the read guard, and Blob access was `list` only. `purge.ts` was run in dry-run mode only; `--apply` was never passed.

## What changed and why

New, all inside `ops/slimming/**` and this evidence folder:

| File | Purpose |
| --- | --- |
| `ops/slimming/lib/env.ts` | Parses the server/Admin `.env` into a private object (never `process.env`, never printed); computes the cluster fingerprint (sha256 of the host list) |
| `ops/slimming/lib/guarded-mongo.ts` | `ReadOnlyCluster` (reads only; `aggregate` refuses `$out`/`$merge` at any depth) and `PurgeCluster` (adds exact `update`/`delete`/`drop`/`dropDatabase`). A `commandStarted` guard exits with code 97 before any command outside the mode's allowlist reaches the wire. `insert`, `createIndexes`, `renameCollection`, `findAndModify` and admin commands are forbidden in both modes |
| `ops/slimming/lib/manifest.ts` | Manifest types, canonical JSON, `manifest_hash`, structural invariants (no forbidden DB drop, no `NEVER_DROP` name, UUID required, no cleanup on a dropped collection, `conversations/` only), TTL-aware count check |
| `ops/slimming/lib/purge-rules.ts` | Exact cleanup filters, closed-filter check for `delete_filter`, legacy-job terminalize/terminal filters, backup-dir-outside-workspace guard, deployed-commit check (descends from `6a374fab` and lacks five retired model files) |
| `ops/slimming/lib/backup.ts` | Streamed gzipped canonical EJSON backup with count + sha256; read-back verification (count, hash, every line parsed) |
| `ops/slimming/lib/blob.ts` | `list` helpers; `get`/`del` used only by purge apply, on exact keys |
| `ops/slimming/policy.ts` | Exact drop targets (SPEC §3/§4/§6/§7.2) with owners and gates, `NEVER_DROP`, full classification of all 118 main-DB collections, legacy job stages, ContactNumber dead fields, exact sync-state scopes, retired audit kinds, `CLEANUP_STATUS` |
| `ops/slimming/inventory.ts` | The read-only inventory; `--write-manifest` generates the hashed manifest |
| `ops/slimming/purge.ts` | Dry run by default; apply only with `--apply --manifest-hash --backup-dir --i-confirm-slim-deployed`. Runs steps (a)–(g) with abort on mismatch, checkpointed resume |
| `ops/slimming/deletion-manifest.json`, `ops/slimming/conversation-blob-keys.json` | Generated manifest (hash `948420886cf908482fb4e4325d1c16724759705b36471dd6d5de7e3114497143`, 2026-10-04T03:07:09Z) and 3,017 exact Blob keys |
| `ops/slimming/lib/slimming.test.ts` | 14 unit tests |
| `docs/server-admin-slimming/DELETION-MANIFEST.md`, `evidence/INVENTORY.md`, `evidence/inventory.json`, `evidence/HUMAN-FACTS.md`, this file | Docs and evidence |

`ops/slimming` imports from `src/` only `src/config/domain/runtime.ts` (retained) for the database-name check. Nothing depends on modules that other lanes are deleting. The Observability names were resolved from `observability.ts` at baseline and pinned in `policy.ts`, because that module is being removed.

No files were deleted. No shared files were edited.

## Retained behavior preserved, and how it was verified

- **Read-only by construction.** Unit tests cover the allowlists for both modes, nested `$out`/`$merge` refusal, and a child-process proof: a synthetic `commandStarted` for `insert`/`drop` in read mode, or `insert` in purge mode, exits 97 before the code that follows runs, while `find` (read mode) and `delete` (purge mode) pass. Driver source check: `mongodb@7.2.0` `lib/cmap/connection.js` `sendCommand` emits `COMMAND_STARTED` synchronously before `sendWire`.
- **Protected namespaces cannot be targeted.** `assertManifestInvariants` tests refuse `vantagemovers`/`vantageadmin`/`admin`/`local`/`config`/`testvantagemovers` as DB drops and refuse `granot_webhook_receipts`, `entity_changes`, `contact_numbers`, `sales_intelligence_jobs`, `daily_operations_events`, `customers`, `agents`, `reporting_runs` and `admin_users` as collection drops.
- **Daily Operations:** `daily_operations_events`/`_days` are `NEVER_DROP` and no cleanup touches them. No Daily file was read for editing or edited.
- **Purge gating:** the production dry run refused with the expected problems: slim server not deployed (deployed `becf8de0` still contains the retired models), wave-3 entries pending and, 15 minutes after a manifest refresh, live writer growth on 4 targets. Details are in INVENTORY.md.

## Checks run (real results)

| Command | Result |
| --- | --- |
| `npx tsc --noEmit -p tsconfig.json` (= `pnpm typecheck`; tsconfig includes `ops/**/*.ts`) | 0 errors in `ops/slimming/**`. The full run reports 227 errors, all in files other lanes are editing mid-wave (e.g. `ops/test-attention-manifest-replica.ts`) |
| `DOTENV_CONFIG_PATH=C:/nonexistent.env node --import tsx --import ./ops/test-setup.ts --test ops/slimming/lib/slimming.test.ts` | 14 pass, 0 fail |
| `node --import tsx ops/slimming/inventory.ts --write-manifest` (production, read-only) | Wrote `inventory.json` and the manifest; about 57 s |
| `node --import tsx ops/slimming/purge.ts` (production dry run, read-only) | 10 problems, all expected (6 deployment, 4 pending wave 3); exit 0 |
| `node --import tsx -e "…loadManifest().computedHash"` | `948420886c…7143`, equal to the stored hash |
| PII scan of `inventory.json`, the manifest and the key list (phone/e-mail patterns, URIs, cluster host) | 0 matches |

Not run: a replica rehearsal of `purge.ts --apply`. The local `csi01` replica (127.0.0.1:27189) accepted TCP but did not answer the handshake (`docker exec … mongosh` hung too), and I did not restart a container other lanes use. SLIM-09 must rehearse apply on an isolated restored dataset.

## Open cross-lane items

1. **S-NUM / S-OUT:** finalize C1 (the ContactNumber field list must equal the schema cut: `running_summary`, `intelligence_schedule`, `rollups.{open_outreach_count,conversations_analyzed_total,last_analyzed_at,outreach_records_total}`). Decide C5 (`content_purge_pending`, `retention_epoch`, `evidence_fence`, `purged_at`): if the slim schema still writes them, remove C5. Decide C6: whether `outreach_ensure`, `outreach_entity_changes` and `outreach_repair:{FormLead,CallLead,CallInteraction}` cursors are reused by the independent nomination path.
2. **S-AI:** confirm the C2 legacy stage list matches the dispatcher allowlist; decide the split stages (`number_refresh` has 524 dead letters and 23 paused rows; `rebuild`, `backfill`, `retention`); confirm C4's retired audit kinds have no retained reader.
3. **All readers:** treat restriction `run_id`/`finding_id`, nudge `outreach_record_id` and Owner-instruction subjects as opaque, possibly dangling ids (HUMAN-FACTS).
4. **Coordinator:** after the deploy and quiescence, finalize `CLEANUP_STATUS`, regenerate the manifest, dry-run it until it prints `no problems`, then apply with the new hash. The deployment stamp must record the slim commit; a CLI deploy without `DEPLOYMENT_COMMIT_SHA` leaves it null, and the purge refuses that.
5. **Owner decision (optional):** the five `unknown` collections (`historical_backfill_*`, `data_migration_runs`, `granot_backfill_deliveries`; 1,189 docs, ~0.5 MB) and the 12,187 open AI-generated review items are kept. Neither is in the manifest.

## DATA-MANIFEST NEEDS

- Drop exactly: the 19 `vantagemovers` collections and `vantageadmin.admin_audit_logs` listed in DELETION-MANIFEST §1, with the UUIDs given there; database `vantagemovershistorical` (6 collections, exact UUIDs).
- Assert still absent: `vantagemovers.operational_report_runs`.
- Cleanups: C2 (final), C3 (final), C1/C4/C5/C6 (wave 3), exactly as DELETION-MANIFEST §2.
- Blob: delete the 3,017 `conversations/` keys in `conversation-blob-keys.json` (1,813,126,869 bytes); never `dev-ops/` or unlisted keys.
- Must NOT remove: everything in `NEVER_DROP`/`ADMIN_NEVER_DROP`, the 5 unknown collections, `testvantagemovers*`, the `retention`/`deployment`/`directory`/`webhook_receipts`/`call_log_*`/`attachment_*`/`rep_identity:*` sync scopes, Owner/Rep-actor audit rows, all command executions, policy versions/pointer, restrictions, Owner instructions, review items, nudges, attachments.
