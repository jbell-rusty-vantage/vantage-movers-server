# Seal This Historical Manifest — Replay Only Quarantine Or Preserve-Live-Scalar, Stamp Operation Ids And Sort Them, Ask The Sibling Schema Validator, Grow Quarantine, Mint The Hashes — Never Rewrite The Operation List, Never Write Mongo, Never Apply — operational story

- Status: recommended
- Service: `historicalConsolidation` (Wave A, in-progress)
- Pass: 3 of this service — `manifest.ts`
- Remaining in this service: `apply.ts`, `verify.ts`, `rollback.ts`, `migrationContext.ts`, `targetGuard.ts`, `operationalLock.ts`, `schemaValidation.ts`, `normalization.ts`, `dateParsing.ts`, `stableJson.ts`, `mongoValues.ts`
- Target: `src/services/historicalConsolidation/manifest.ts`
- Knowledge: none for this folder. The staged-merge spec is [`historical-consolidation-rules-and-staging-spec.md`](../../../docs/index.md) (Stage F: seal the immutable manifest; Conflict artifacts: separate decision file, stale-decision fail-closed, replay never mutates an approved hash; Acceptance: same inputs / rules / decisions are byte-equivalent). Already-recommended sibling: [historical-consolidation-planner.md](historical-consolidation-planner.md) (`planner.ts` — walks the frozen sheets, **asks** this file at the end, never reads `decisions.decisions`). Already-recommended [historical-consolidation-classification.md](historical-consolidation-classification.md) is **asked by the planner**, not by this file. Distinct from leftover `schemaValidation.ts` (Mongoose parity on each planned insert / update — this file **asks** it after ids are stamped). Distinct from leftover `stableJson.ts` (`sha256`, `assertArtifactHash` — this file **asks** both). Distinct from leftover `apply.ts` / `verify.ts` / `rollback.ts` (mutate / prove / undo under leftover `targetGuard.ts` + leftover `operationalLock.ts` + leftover `migrationContext.ts`). Distinct from leftover `types.ts` (`HISTORICAL_MANIFEST_SCHEMA_VERSION` `1.0.0`, `HISTORICAL_RULE_VERSION` `2026-07-31.1`, body + hash). The July spec’s `BuildHistoricalManifest(snapshot, rules, decisions)` type is the **whole pipeline**; that call now lives on already-recommended `planThisHistoricalMerge`. This file is only Stage F. `package.json` still names `pnpm historical:plan`; the staged-merge script folder is **absent** from this checkout. This checkout’s `CONTEXT.md` is a pointer plus four employee-booking terms — do not invent “Historical Manifest” copies. `docs/adr/` is absent here — do not invent ADR copies. Do not add a Historical Consolidation Service in this rename.
- Callers: **already-recommended planner, the barrel, plus one folder fixture.** Already-recommended `planner.ts` imports `buildHistoricalManifest` from this file (not the barrel) and **asks** it after unclassified-row refusal, with `decision_bundle_hash: ""` (ignored), `quarantine` = non-blocking conflicts, and `decisions: input.decisions`. Barrel `historicalConsolidation/index.ts` re-exports `buildHistoricalManifest` and `parseHistoricalManifest`. Folder test `manifest.test.ts` **asks** both exports three times (identical reviewed input → identical object; omitted `manifest_id` → identical id and hash; pretty-printed mutation of `git_sha` → hash mismatch). The same file then **asks leftover** `assertApplyAuthorized` / `assertRollbackAuthorized` and leftover `createHistoricalMigrationRunner` — those beats are **not** this **interface**. Leftover `applyHistoricalManifest` / `preflightHistoricalManifest` / `verifyHistoricalManifest` / `rollbackHistoricalManifest` take an already-built `HistoricalManifest` and **ask leftover** `assertArtifactHash`; they do **not** import this file. Scripts in this checkout do **not** import this file. Not this **interface**: leftover `planHistoricalConsolidation`, leftover `validateManifestOperations`, leftover `assertArtifactHash`, leftover `applyHistoricalManifest`, leftover `classifyHistoricalLeads`.
- Seams callers need: reviewed decision replay that may only quarantine or preserve a live scalar vs a resolution that would change the plan (must replan); already-planned operations vs minted `operation_id` + sort; **ask** leftover schema validator vs this seal; sealed body + `manifest_hash` vs leftover apply’s re-hash (no parse); bytes on disk vs `parseHistoricalManifest`. There is no begin / complete Domain Command **seam**. There is no Mongo write **adapter**. There is no filesystem **adapter**. There is no apply authorization **adapter**.
- Split later (only if the file outgrows one sitting): this ~80-line file is one sitting if you read it as seal this historical manifest. If it later splits by **story**: `replayTheseHistoricalDecisionsWithoutChangingThePlan.ts`, `stampTheseHistoricalOperationIds.ts`, `openTheseSealedHistoricalManifestBytes.ts` — never `create.ts` / `update.ts` / `delete.ts`. Leftover planner, leftover schema validator, leftover hasher, leftover apply / verify / rollback stay siblings.

`buildHistoricalManifest` is executor mechanics. The owner question is: *The planner already listed every write and every conflict. Walk the reviewed decisions. A decision may only quarantine a case or keep a live scalar. Anything that would pick a candidate or change a field is refused — that must go back through mappings and a replan. Stamp a stable operation id on each write, sort them, refuse a collision, then ask the sibling schema validator. Mark each decided case. Add quarantined cases to the quarantine set. Mint the manifest id and the two hashes. This file does not rewrite the operation list. This file does not write Mongo. This file does not apply.*

Who walks the sheets, who judges Duplicate Lead, who proves Mongoose parity, who hashes bytes, and who writes under a fence already live in leftover **modules**. Do not pull those in.

## What this file actually does

Four “seal this historical manifest” stories in one sitting, not “a hash helper,” and not Plan This Historical Merge / Apply This Approved Manifest / Prove This Live Schema:

1. **Replay reviewed decisions without changing the plan** — `validateDecisions`. Each decision must name a known `case_id` once. `expected_evidence_hash` and `rule_version` must match the conflict (stale → throw). Reviewer and rationale must be non-blank. The resolution must be in that case’s `allowed_resolutions`. Selected candidate ids must already sit on the case. Then the hard fence: only `quarantine` and the persist preserve-live-scalar resolution may replay. Any other resolution — `select_candidate`, `field_decision`, `supply_mapping`, `create_orphan`, `select_booking`, `supply_agent_tokens` — throws *even when the case listed it*, because it would change the plan and must be planted in mappings / inputs before a **replan**. This beat does **not** drop or rewrite operations. This beat does **not** clear `blocking`. This beat does **not** mark a case `stale` (throw is the stale path).

2. **Stamp operation ids, sort, refuse a collision, then ask the sibling schema validator** — `buildHistoricalManifest` after decisions pass. Each planned write gets `operation_id = sha256({ migration_key, action, collection, target_id, set, document, after })`. Sort by `order`, then `operation_id`. Two writes that hash the same id throw. Then **ask** leftover `validateManifestOperations`. This beat does **not** hash `before`, `precondition`, `order`, `model`, or `provenance` into the id. This beat does **not** assign ObjectIds. This beat does **not** write Mongo.

3. **Stamp decided cases, grow quarantine, mint identity and hashes** — still `buildHistoricalManifest`. A conflict with a decision becomes `status: "decision_supplied"`. Quarantine is the planted list plus every conflict whose decision is `quarantine`, last write wins on `case_id`. `schema_version` and `rule_version` come from leftover `types.ts` constants, never from the caller. `decision_bundle_hash` is `sha256(input.decisions)` — the caller’s `decision_bundle_hash` field is ignored. `manifest_id` is the caller’s id or `historical-` plus the first 32 hex of a hash over snapshot / clock / git / operations / conflicts / decisions. Return `{ ...body, manifest_hash: sha256(body) }`. This beat does **not** write a file. This beat does **not** strip a quarantined write from `operations`.

4. **Open sealed bytes and prove they still match** — `parseHistoricalManifest`. `JSON.parse`, then **ask** leftover `assertArtifactHash`. `schema_version` and `rule_version` must equal the leftover constants. `stableJson` must be a fixed point (the bytes are canonically serializable). Return the parsed object. This beat does **not** re-run `validateDecisions`. This beat does **not** re-ask leftover `validateManifestOperations`. This beat does **not** check `target_database`. Leftover apply never **asks** this export — it re-hashes an in-memory object.

There is no fifth mutate operation. `decisionsByCase` is a fold operations 1 and 3 **ask**. Re-export through the barrel is convenience for a missing `pnpm historical:plan` script.

## Organization

Keep one file. This is the screenplay for “seal this historical manifest.” Sheet walk and insert-or-fill already live on already-recommended `planner.ts`. Duplicate Lead judgment already lives on already-recommended `classification.ts`. Mongoose parity already lives on leftover `schemaValidation.ts`. Canonical JSON and artifact hash already live on leftover `stableJson.ts`. Apply / verify / rollback already live on leftover later modules. Do not pull those in. Do not invent a `HistoricalManifestService` class. Do not invent a begin / complete Domain Command **seam**. Do not invent a Mongo **adapter** that has only this in-memory seal. Do not invent a filesystem **adapter** so “the sealer writes the artifact.” Do not invent a CRUD folder so “build and parse each get a file.”

Do not merge this into already-recommended `planner.ts` so “one function owns plan and hash.” Do not move leftover `validateManifestOperations` here so “sealing owns the schema.” Do not move leftover `assertArtifactHash` here so “this file owns every hash.” Do not start calling leftover `applyHistoricalManifest` so “seal and apply are one sitting.” Do not split `create.ts` / `update.ts`.

**External interface** stays small (this is the test surface):

| Keep exporting | Story name | Why the seam exists |
|---|---|---|
| `buildHistoricalManifest` | `sealThisHistoricalManifest` | already-recommended planner must seal the planned writes + conflicts + decisions |
| `parseHistoricalManifest` | `openTheseSealedHistoricalManifestBytes` | disk / review bytes must prove hash, schema version, and canonical JSON |
| `BuildHistoricalManifestInput` | `ThePlannedWritesAndTheReviewedDecisions` | caller plants operations without ids, conflicts, quarantine, decisions, and the frozen checksums |

Keep the old names as one-line aliases until already-recommended `planner.ts`, the barrel, and the folder test migrate. Do not make callers learn `validateDecisions` / `decisionsByCase` as the domain language. Do **not** rename persisted field names (`manifest_hash`, `manifest_id`, `decision_bundle_hash`, `operation_id`, `schema_version`, `rule_version`, live snapshot hash, `quarantine`, `status: "decision_supplied"`). Do **not** rename persisted resolution strings (`quarantine` and the preserve-live-scalar token) — leftover apply preflight treats a blocking case as resolved only when `status === "decision_supplied"`. Do **not** rename leftover version constants (`1.0.0`, `2026-07-31.1`). Do **not** rename operation `order` bands — leftover apply walks that list.

**No workflow class.** The two types that *do* earn a name are the planted seal input and the sealed artifact:

```ts
type ThePlannedWritesAndTheReviewedDecisions = {
  operations: Array<Omit<HistoricalOperation, "operation_id">>
  conflicts: ConflictCase[]
  quarantine: ConflictCase[]
  decisions: DecisionBundle
  planning_timestamp: string
  git_sha: string
  source_snapshot_hash: string
  // plus the leftover checksum / fingerprint / expected-count fields the body already names
}

type TheSealedHistoricalManifest = HistoricalManifestBody & {
  manifest_hash: string
}
```

That is the handoff from “the planner finished the walk” to “the owner can approve a hash and leftover apply can write.” `validateDecisions` stays internal. Do **not** export it so “the script can replay one case.” Do **not** add a disk writer so “Stage F owns the artifact file.”

Leave planning on already-recommended `planner.ts`. Leave schema parity on leftover `schemaValidation.ts`. Leave apply on leftover `apply.ts`.

## The file, as a story

Parent functions stay deep. Child names are only extracted when they hide a real decision, not a one-liner.

```ts
// manifest.ts
// The planner already listed every write and every conflict.
// Replay the reviewed decisions. Only quarantine or keep a live scalar.
// Stamp ids. Sort. Ask the sibling schema validator.
// Grow quarantine. Mint the hashes.
// Do not rewrite the operation list. Do not write Mongo. Do not apply.

// ── 1. Replay decisions without changing the plan ─────────

export function sealThisHistoricalManifest(input)
function replayTheseReviewedDecisionsWithoutChangingThePlan(conflicts, bundle)
function refuseADuplicateOrUnknownOrStaleDecision(decision, conflicts)
function refuseADecisionThatWouldChangeThePlan(decision, conflict) // only quarantine | preserve-live-scalar

// ── 2. Stamp ids, sort, ask the schema validator ──────────

function stampTheseHistoricalOperationIds(operations)
function sortTheseHistoricalOperations(operations) // order, then operation_id
function refuseACollidingHistoricalOperationId(operations)
// ask leftover validateManifestOperations

// ── 3. Stamp decided cases, grow quarantine, mint hashes ──

function markTheseConflictsDecisionSupplied(conflicts, decisionsByCase)
function growTheQuarantineFromQuarantineDecisions(planted, conflicts, decisionsByCase)
function mintThisHistoricalManifestIdentity(input, operations, conflicts) // or keep caller id
function hashTheDecisionBundle(bundle)
function sealTheBodyWithTheManifestHash(body)

// ── 4. Open sealed bytes ──────────────────────────────────

export function openTheseSealedHistoricalManifestBytes(bytes)
// ask leftover assertArtifactHash
function refuseAnUnsupportedSchemaOrRuleVersion(parsed)
function refuseBytesThatAreNotCanonicallySerializable(parsed)
```

Read the primary path out loud: *Walk every reviewed decision. Refuse a duplicate, an unknown case, a stale evidence hash or rule version, a blank reviewer, or a resolution the case did not allow. Then refuse any resolution that would pick a candidate or change a field — that is a replan, not a seal. Stamp a stable id on each write, sort by order, refuse a collision, and ask the sibling whether the live schema still accepts every insert and update. Mark decided cases. Add quarantined cases to the quarantine set. Mint the id and the hashes. If the owner later hands you bytes, prove the hash, the version, and that the JSON is canonical. Do not rewrite the writes. Do not apply them.*

That is the operation. `validateDecisions` is not.

## Precise logic I would tighten while renaming

These are real smells the story names make obvious. Do not “just rename.”

1. **Replay may not change the plan.** Spec review flow is generate evidence → record decision → replay planner → approve hash. Already-recommended `planner.ts` never reads `decisions.decisions`. This file hashes the bundle and will only stamp `decision_supplied` / grow quarantine. Do not start applying `select_candidate` or `field_decision` here so “the bundle becomes true.” That would silently rewrite leftover apply’s write list.

2. **`decision_bundle_hash` on the input is a lie.** The type still asks the caller to plant it. Already-recommended planner plants `""`. This file overwrites it with `sha256(input.decisions)`. Drop the planted field from the story type. Do not start trusting the caller’s string so “the planner can pin a hash.”

3. **Operation id ignores before / precondition / order / model / provenance.** Two writes with the same `migration_key` + payload and different preconditions collide and throw. Keep the throw. Do not add those fields to the hash so “ids become more unique” without an **interface** proof that leftover apply’s registry keys still match a sealed fixture.

4. **Quarantine does not remove operations.** A `quarantine` decision only grows the quarantine set and marks the case. If a future planner ever emitted a write *and* a quarantine decision for the same row, leftover apply would still write. Do not filter `operations` here so “quarantine means skip,” and do not move that filter into leftover apply so “the sealer stays a hasher.” The planner already omits the write.

5. **`parseHistoricalManifest` does not re-seal.** Opening bytes proves hash, version, and canonical JSON. It does not re-run decision replay or leftover schema validation. A hand-rehashed object could skip those fences. Do not silently call `sealThisHistoricalManifest` from parse so “open always re-validates,” without proving leftover apply — which never **asks** parse — still has one hash **seam**. Add the re-seal as a later, tested change if the owner wants it.

6. **Leftover apply never opens bytes.** `applyHistoricalManifest` **asks leftover** `assertArtifactHash` on an in-memory object. `parseHistoricalManifest` is the disk **seam** with no leftover caller in this checkout. Do not delete the export so “no caller means dead code,” and do not route leftover apply through parse so “one function owns every hash” in this rename.

7. **The folder test files leftover later modules.** `manifest.test.ts` proves leftover `assertApplyAuthorized` / `assertRollbackAuthorized` and leftover `createHistoricalMigrationRunner`. Those are leftover `targetGuard.ts` and leftover `migrationContext.ts`. Do not keep them as this **interface**. Do not move them into this file so “the sealer owns authorization.”

8. **July spec `BuildHistoricalManifest(snapshot, rules, decisions)` is the planner.** Stage F here only seals already-planned operations. Do not pull sheet flatten / classify / booking group back into this file so “the spec type becomes true.”

9. **The staged-merge CLI is missing here.** `package.json` still names `pnpm historical:plan`; the folder it points at is not in this checkout. Do not invent the script in this rename, and do not treat leftover `ingest-historical-sheets.ts` as the caller.

10. **Leave sibling modules and live writes alone.** Leftover `validateManifestOperations`, leftover `assertArtifactHash` / `sha256` / `stableJson`, leftover `applyHistoricalManifest`, leftover `assertApplyAuthorized`, and already-recommended `planThisHistoricalMerge` are not this file. Do not inline them so “the sealer is one sitting.”

## Testing

The **interface** is the test surface: `sealThisHistoricalManifest` and `openTheseSealedHistoricalManifestBytes` (today `buildHistoricalManifest` / `parseHistoricalManifest`).

Today’s `manifest.test.ts` locks three happy paths (identical input → identical object; omitted id → identical id and hash; mutated `git_sha` → hash mismatch) and then tests leftover authorization / leftover migration context. That is not enough for a story this short, and the last two tests are the wrong **interface**.

Keep the hash lock. Move leftover target-guard / leftover runner proofs to those modules’ later passes. Add only what this **interface** still hides:

**Replay decisions without changing the plan**
- Empty bundle + empty conflicts → seal succeeds; every conflict stays `unresolved` unless planted otherwise.
- Decision for an unknown `case_id` → throw.
- Two decisions for the same `case_id` → throw.
- `expected_evidence_hash` or `rule_version` mismatch → throw (stale).
- Blank `rationale` or `decided_by` → throw.
- Resolution not in `allowed_resolutions` → throw.
- `select_candidate` (or any non-quarantine / non-preserve-live-scalar resolution) → throw *even when the case allowed it*.
- `quarantine` on a known case → that conflict is `decision_supplied` and appears in `quarantine`; `operations` are unchanged.
- Preserve-live-scalar on a known case → `decision_supplied`; quarantine set does not grow unless the planner already planted it.
- Same decisions + same operations twice → identical `manifest_hash` and `decision_bundle_hash`.

**Stamp ids, sort, ask the schema validator**
- Two operations with the same migration key + payload → throw duplicate operation ids.
- Operations planted out of `order` → sealed list is sorted by `order`, then `operation_id`.
- An insert leftover `validateManifestOperations` would reject → this export throws that sibling’s error (do not re-implement the schema test here).

**Mint identity and hashes**
- Caller omits `manifest_id` → deterministic `historical-` + 32 hex; same input twice matches (already locked).
- Caller plants `decision_bundle_hash: ""` → sealed `decision_bundle_hash` is `sha256(decisions)`, not `""`.
- Caller plants a `manifest_id` → that id is kept; `manifest_hash` still covers the body.

**Open sealed bytes**
- `JSON.stringify` of a sealed manifest parses back equal (already locked).
- Change `git_sha` and keep the old hash → throw hash mismatch (already locked).
- Supported hash but `schema_version` or `rule_version` other than the leftover constants → throw unsupported.
- Do **not** require leftover apply authorization here.

Do **not** add a test per helper (`refuseADuplicateOrUnknownOrStaleDecision`, `growTheQuarantineFromQuarantineDecisions`). Those names exist so the parent reads. If a helper test has to change when the helper is inlined, it was testing past the **interface**.

`BuildHistoricalManifestInput` may stay exported as an alias. It is not a second test surface.

## What I would not do

- A `HistoricalManifestService` class with `build` / `parse` / `create`.
- Thirty two-line functions that only wrap leftover `sha256` or `Map#get`.
- Moving this into a CRUD folder, or a `manifest/` folder that also swallows leftover `schemaValidation.ts` and leftover `apply.ts`.
- Treating leftover `planHistoricalConsolidation`, leftover `validateManifestOperations`, leftover `applyHistoricalManifest`, leftover `assertApplyAuthorized`, or leftover `ingest-historical-sheets.ts` as this story.
- Inventing a Mongo **seam** that has only this in-memory seal as an **adapter**.
- Inventing a filesystem **seam** so “Stage F writes the artifact.”
- Applying `select_candidate` / `field_decision` inside this file so “the bundle changes the plan.”
- Filtering `operations` when a case is quarantined so “quarantine means skip.”
- Merging this back into already-recommended `planner.ts` so “the July `BuildHistoricalManifest(snapshot, …)` type lives in one file.”
- Routing leftover apply through `parseHistoricalManifest` so “one function owns every hash” in this rename.
- Moving leftover target-guard tests into this story’s **interface**.
- Opening `apply.ts` in this pass, or writing a whole-folder recommendation for `historicalConsolidation`.
