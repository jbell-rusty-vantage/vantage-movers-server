# Skip A Best Relocation Row We Already Applied When The Sheet Still Matches The Last Successful Receipt — If It Vanished And Came Back, Adopt The Same Lead — If Only Source-Owned Fields Changed, Ask The Three-Way Update — Otherwise Open A Conflict — Never Write A Lead, Never Delete, Never Run On Bootstrap — operational story

- Status: recommended
- Service: `bestRelocationSheetIngest` (Wave A, in-progress)
- Pass: 8 of this service — `sourceChangePolicy.ts`
- Remaining in this service: `canonicalLeadAdoption.ts`, `bootstrap.ts`, `updatePolicy.ts`, `apply.ts`, `dryRun.ts`, `dryRunReports.ts`
- Target: `src/services/bestRelocationSheetIngest/sourceChangePolicy.ts`
- Knowledge: [`docs/knowledge/services/ingestion.md`](../../../docs/knowledge/services/ingestion.md). Recurring preview / manual / schedule planning applies receipt skip (`applySourceChangePolicy`) then **adopt-before-create**. Bootstrap remaps creates to receipt-only `adopt_existing` and **does not** run this file. Skip/fail: missing source on a later plan preserves canonical refs and **never deletes** — that emit is `detectMissingSourceActions` **after** this file, not here. CLI dry-run applies receipt skip when the connection exists, then `applyCanonicalAdoptionPolicy`. Primary-code list names `canonicalLeadAdoption.ts` / `sheets.ts` / `dryRunReports.ts`, not this file — do not add a second Ingestion Service so “receipt skip owns the happy path.” Distinct from already-recommended six-tab read / window: [`best-relocation-sheet-ingest-sheets.md`](best-relocation-sheet-ingest-sheets.md). Distinct from already-recommended parse: [`best-relocation-sheet-ingest-parsing.md`](best-relocation-sheet-ingest-parsing.md). Distinct from already-recommended pair: [`best-relocation-sheet-ingest-matching.md`](best-relocation-sheet-ingest-matching.md). Distinct from already-recommended HTTP screenplay: [`best-relocation-sheet-ingest-plan.md`](best-relocation-sheet-ingest-plan.md). Distinct from already-recommended remap: [`best-relocation-sheet-ingest-application-plan.md`](best-relocation-sheet-ingest-application-plan.md) (emits `create_*` / `record_conflict`; type lists `unchanged` / `adopt_existing` / `update_source_owned_lead`; this file is the first rewrite). Distinct from already-recommended inspect: [`best-relocation-sheet-ingest-provider.md`](best-relocation-sheet-ingest-provider.md). Distinct from already-recommended identity mint: [`best-relocation-sheet-ingest-identity.md`](best-relocation-sheet-ingest-identity.md) (this file **compares** `action.content_hash`; it does not mint). Distinct from already-recommended worker skip layer: [`ingestion-worker.md`](ingestion-worker.md) (`evidenceKeysForConnection` remaps present + matching hash to `unchanged` **before** this file; bootstrap **asks** `planBootstrapAdoption` on the **unmapped** snapshot and never **asks** this file). Distinct from already-recommended present-evidence scan: [`ingestion-repository.md`](ingestion-repository.md) (`evidenceKeysForConnection` / `detectMissingSourceActions` / `appendSourceReceipt` — this file **reads** receipts and state; it does not write them). Distinct from already-recommended canonical walk: [`ingestion-apply-plan.md`](ingestion-apply-plan.md) (**asks** `updateSourceOwnedLead` / `adopt_existing` receipt-only; this file never walks). Distinct from later Mongo adopt: `canonicalLeadAdoption.ts` (worker **asks** it **after** this file; already-adopted / `unchanged` stay). Distinct from later bootstrap adopt: `bootstrap.ts`. Distinct from later three-way allowlist: `updatePolicy.ts` (this file **asks** `evaluateSourceOwnedLeadUpdate`; it does not own the paths). Distinct from later HTTP apply: `apply.ts`. Folder `HANDOFF.md` is not knowledge — do not copy it (it still describes HTTP `apply.ts` as the live path and never names receipts). This checkout’s `CONTEXT.md` does not define Ingestion Origin or Best Relocation — do not invent a glossary copy. `docs/adr/` is absent here — do not invent ADR copies (knowledge cites ADR-0001).
- Callers: `ingestion/worker.ts` **asks** `applySourceChangePolicy` on `withEvidence` when trigger is not `bootstrap`. CLI `scripts/best-relocation-sheet-ingest.ts` **asks** it when `ExternalDataConnection` `best_relocation` exists (no `evidenceKeysForConnection` remap, no missing-source append). `ingestion/ingestion.test.ts` **asks** `classifyKnownEvidence` only (changed / unchanged / reappeared — “a conflict observing B must not replace this successfully applied A”). Folder `bestRelocationSheetIngest.test.ts` does **not** import this file. No test **asks** `applySourceChangePolicy`. Barrel `index.ts` `export *`. `adapter.ts` does not import this file. Wave B `src/routes/ingestion.routes.ts` does not import this file.
- Seams callers need: this-file / last-successful-receipt classify (`classifyKnownEvidence` — only `applied` / `already_applied` / `adopted`); this-file / worker present-hash remap (two skip layers; do not unify); this-file / bootstrap (bootstrap never **asks** this file); this-file / three-way allowlist (`updatePolicy.evaluateSourceOwnedLeadUpdate`); this-file / identity hash (compare only); this-file / later Mongo adopt (this file’s `adopt_existing` / `unchanged` stay); this-file / later missing-source (never delete); this-file / apply idempotency (`action_key` becomes `:revision:${hash.slice(0, 16)}`). There is no sheet-write **seam**. There is no receipt-write **seam**. There is no Domain Command **seam**. There is no delete **seam**.
- Split later (only if the file outgrows one sitting): this ~237-line file is one sitting if you read it as skip a Best Relocation row we already applied when the sheet still matches the last successful receipt. Do **not** split into `classify.ts` / `skip.ts` / `adopt.ts` / `update.ts` / `create.ts` / `delete.ts`. Do **not** pull `updatePolicy.ts`, `canonicalLeadAdoption.ts`, `bootstrap.ts`, `identity.ts`, `worker.ts`, or `applyPlan.ts` here. If it later splits: `classifyTheLastSuccessfulReceiptAgainstThisRow.ts` / `receiptSkipOrReadoptTheSameCanonical.ts` / `askTheThreeWayUpdateInsteadOfASecondLead.ts` only as later story files, never CRUD.

`applySourceChangePolicy` / `classifyKnownEvidence` are executor mechanics. The owner question is: *We already applied this Best Relocation row. If the sheet still checksums the same, do not create it again. If the row vanished and came back with the same checksum, adopt the same Lead. If only source-owned contact or move fields changed, ask the three-way update. If a Booking, Refund, or protected field changed, open a conflict. A later conflict receipt must not replace the last successful apply. This file does not write a Lead. This file does not delete. This file does not run on bootstrap.*

Worker present-hash remap, identity mint, three-way allowlist, Mongo adopt, missing-source, bootstrap adopt, and canonical walk already live in other **modules**. Do not pull those in.

## What this file actually does

Five operations of one “skip a Best Relocation row we already applied when the sheet still matches the last successful receipt” story, not “a source-change CRUD helper,” and not inspect / remap / Mongo adopt / apply.

1. **Classify the last successful receipt against this row** — `classifyKnownEvidence`. No previous applied hash → `new`. Incoming hash ≠ previous → `changed`. Same hash + `SourceRowState.source_state === "source_missing"` → `reappeared`. Same hash otherwise → `unchanged`. `applySourceChangePolicy` loads the newest `SourceRowReceipt` with `outcome` in `applied` / `already_applied` / `adopted` (conflict receipts are not the baseline), plus current `SourceRowState` for this `schema_version`. `unchanged` / `record_conflict` / `adopt_existing` already on the plan pass through. No previous receipt → keep the action (`new`). This function does not write a receipt.

2. **Receipt-skip the same sheet, or re-adopt a vanished-then-returned row** — same hash: rewrite `action_key` to `${action_key}:revision:${hash.slice(0, 16)}`, drop `command_payload`. `unchanged` → `command: "unchanged"`. `reappeared` → `adopt_existing` with `adopted_entity_refs` from `resulting_canonical_ids`. Extra path after classify says `changed`: if state is still `source_missing` and `canonicalJson(last_applied_source_values)` equals `canonicalJson(source_owned_values ?? command_payload ?? {})`, adopt the same ids anyway. This function does not emit `missing_source_row`. This function does not delete.

3. **Ask the three-way update instead of minting a second Lead** — only `create_form_lead` / `create_call_lead` with a previous canonical id and `last_applied_source_values`. Load `FormLead` / `CallLead` by that id. Missing document → `record_conflict` `canonical_divergence`. Else **ask** `evaluateSourceOwnedLeadUpdate` (`originated_from_best_relocation: true`, current bag `source_owned_values ?? command_payload`). `safe_update` → `update_source_owned_lead` with `{ lead_model, lead_id, patch }`. Policy `unchanged` → adopt if state is `source_missing`, else `unchanged`. Policy conflict → `changed_protected_field` if any conflict has that type, else `canonical_divergence`. This function does not patch the Lead.

4. **Refuse every other change as a protected-field conflict** — a Booking, Refund, leadless Booking, or any other remaining command that already has a successful receipt and did not take the three-way door → `record_conflict` `changed_protected_field` `blocking`. This function does not invent a Cancellation. This function does not update a Booking.

5. **Rewrite depends_on onto revision keys and recount** — any action whose key moved to `:revision:` has dependents remapped (`keyChanges.get(dependency) ?? dependency`). Counters are rebuilt from `classification`. The locked play is returned; checksum stays with the worker / CLI.

Shared beats, not owner operations: `withoutCommandPayload` (skip / adopt drop the create body), `asConflict` (keeps the original action spread, including `command_payload`), unused `SourceRowState` select of `latest_content_hash` / `latest_outcome` (only `source_state` is read).

## Organization

Keep one file as the screenplay for “skip a Best Relocation row we already applied when the sheet still matches the last successful receipt — if it vanished and came back, adopt the same Lead — if only source-owned fields changed, ask the three-way update — otherwise open a conflict — never write a Lead, never delete, never run on bootstrap.” Identity mint, worker present-hash remap, three-way allowlist, Mongo adopt, missing-source, bootstrap adopt, and canonical walk already live in deeper **modules**. Do not pull those in. Do not invent a `BestRelocationSourceChangeService` class. Do not invent a begin / complete **seam** here — receipt skip is not a Domain Command. Do not invent a second three-way **adapter** beside `updatePolicy.ts`. Do not invent a second hash **adapter** beside `identity.sourceOwnedContentHash`. Do not invent a receipt-write **adapter** here — `appendSourceReceipt` already owns apply-time persist. Do not invent a second skip **adapter** that replaces `evidenceKeysForConnection` — name the two layers.

**External interface** stays small (this is the test surface). Faces `worker.ts` / CLI / `ingestion.test.ts` already import:

| Keep exporting | Story name | Why the seam exists |
|---|---|---|
| `applySourceChangePolicy` | `skipOrReviseActionsFromTheLastSuccessfulReceipt` | worker recurring plan; CLI dry-run when the connection exists |
| `classifyKnownEvidence` | `classifyTheLastSuccessfulReceiptAgainstThisRow` | worker-adjacent test; conflict receipts must not become the baseline |

Keep the old names as one-line aliases until `worker.ts`, the CLI, the barrel, and `ingestion.test.ts` migrate. Do not export `withoutCommandPayload` / `asConflict`. Do not make callers learn `InTransaction` or CRUD verbs. Do not make bootstrap learn this file.

**No class for the workflow.** The one type that earns a name is the evidence this file is allowed to trust:

```ts
type LastSuccessfulSourceReceipt = {
  content_hash: string
  resulting_canonical_model?: string | null
  resulting_canonical_ids: string[]
  last_applied_source_values?: Record<string, unknown> | null
}
```

That is the handoff from “apply already wrote a successful receipt” to “this plan may skip, adopt, patch source-owned fields, or conflict.” Do not put a conflict receipt on that type so “the latest observation wins.” Do not put `latest_content_hash` on that type so “state owns classify.” Do not put `plan_checksum` on the return so “receipt skip owns approve.”

`BestRelocationApplicationPlan` / `BestRelocationPlanAction` stay on sibling `applicationPlan.ts`. Do not move those cards here.

## The file, as a story

Parent functions stay deep. Child names are only extracted when they hide a real decision, not a one-liner.

```ts
// sourceChangePolicy.ts
// We already applied this Best Relocation row.
// If the sheet still checksums the same, do not create it again.
// If the row vanished and came back with the same checksum, adopt the same Lead.
// If only source-owned fields changed, ask the three-way update.
// A Booking, Refund, or protected field change is a conflict.
// A later conflict receipt must not replace the last successful apply.
// This file does not write a Lead.
// This file does not delete.
// This file does not run on bootstrap.

// ── 1. Classify the last successful receipt ───────────────

export function classifyTheLastSuccessfulReceiptAgainstThisRow(input)
async function loadTheLastSuccessfulReceiptAndCurrentRowState(connectionId, action)

// ── 2. Receipt-skip or re-adopt ───────────────────────────

export async function skipOrReviseActionsFromTheLastSuccessfulReceipt(input)
function receiptSkipTheSameSheet(action, revisionKey)
function readoptTheSameCanonicalIds(action, revisionKey, previous)
function lastAppliedValuesStillMatchTheIncomingSheet(previous, action)

// ── 3. Ask the three-way update instead of a second Lead ──

async function askTheThreeWayUpdateInsteadOfMintingASecondLead(action, previous, currentState)
function theCanonicalLeadIsMissing(leadModel, id)          // conflict

// ── 4. Refuse every other change ──────────────────────────

function openAProtectedFieldConflict(action, revisionKey)

// ── 5. Rewrite depends_on and recount ─────────────────────

function rewriteDependsOnOntoRevisionKeys(actions, keyChanges)
function recountClassifications(actions)
```

Read the primary path out loud: *Load the last successful receipt for this connection, dataset, and stable row. A conflict receipt is not the baseline. Same checksum and the row is still present — skip. Same checksum after the row was marked missing — adopt the same Lead. Checksum changed but the row is missing and last-applied values still match — adopt anyway. A Form or Call create that already minted a Lead — ask the three-way update; patch only source-owned fields; missing Lead or protected change is a conflict. A Booking or Refund change is a conflict. Rewrite dependents onto the revision key. Do not write a Lead. Do not delete. Do not run on bootstrap.*

That is the operation. `applySourceChangePolicy` is not.

## Precise logic I would tighten while renaming

1. **Two skip layers.** Worker remaps present + `latest === last_applied` to `unchanged` **before** this file. This file still classifies receipts for CLI (no remap), for missing / mismatched state, and for `source_missing` reappear. Do not delete this file’s `unchanged` path so “worker already skipped.” Do not start **asking** `evidenceKeysForConnection` from this file so “one skip owns both.”

2. **Bootstrap never enters.** Worker **asks** `planBootstrapAdoption(initialPlanSnapshot)` — the unmapped plan — and never this file. Do not start calling this from bootstrap so “one adopt owns first run.”

3. **`latest_content_hash` / `latest_outcome` are selected and unused.** Classify uses the receipt hash and `source_state` only. Do not start comparing `latest_content_hash` here so “state owns classify.”

4. **Missing-source adopt after `changed`.** Hash differs, state is `source_missing`, and `canonicalJson` of last-applied equals the incoming bag → adopt. Identity’s hash is not `canonicalJson`. Do not silently require the hashes to match so “one compare owns skip.” Name the two compares.

5. **Three-way is Form/Call create only.** Booking / Refund / leadless fall through to `changed_protected_field`. Do not start patching a Booking here so “every tab has a safe update.” Leave `updatePolicy.ts` on the allowlist.

6. **Revision key is the later idempotency key.** Apply **asks** `action.action_key`. Skip / adopt / update rewrite it to `:revision:`. Worker’s earlier `unchanged` remap does **not** rewrite the key. Do not start rewriting keys in `evidenceKeysForConnection` so “one key owns skip.”

7. **This file reads Form Lead / Call Lead and does not write.** Apply **asks** `updateSourceOwnedLead`. Do not start a Domain Command here so “receipt skip owns the patch.”

8. **This file does not emit missing-source and does not delete.** `detectMissingSourceActions` runs after. Do not start appending `missing_source_row` here so “one policy owns absent rows.”

9. **CLI has no present-hash remap and no missing-source append.** Name the drift. Do not add those calls in this rename so “CLI matches worker.”

10. **Leave sibling modules alone.** `identity.ts` hash, `updatePolicy.ts` allowlist, `canonicalLeadAdoption.ts` Mongo adopt, `bootstrap.ts` first-run adopt, `worker.ts` present-hash remap + missing-source, `applyPlan.ts` walk are already the right **depth**.

## Testing

The **interface** is the test surface: `skipOrReviseActionsFromTheLastSuccessfulReceipt`, `classifyTheLastSuccessfulReceiptAgainstThisRow`.

Today’s `ingestion.test.ts` already **asks** `classifyKnownEvidence` for changed / unchanged / reappeared and names that a conflict observing B must not replace applied A. Folder `bestRelocationSheetIngest.test.ts` never imports this file. No test **asks** `applySourceChangePolicy`. That is close on classify, and it does not name the receipt-skip / re-adopt / three-way / refuse operations.

Replace the helper-only classify style with tests that name the operation:

**Classify the last successful receipt**
- No previous hash → `new`.
- Same hash + present (or missing state) → `unchanged`.
- Same hash + `source_missing` → `reappeared`.
- Different hash → `changed`.
- A later `outcome: "conflict"` receipt is not loaded as `previous` — prove the query, not a comment.

**Receipt-skip or re-adopt**
- Same hash, present → `unchanged`, payload dropped, `action_key` has `:revision:`.
- Same hash, `source_missing` → `adopt_existing` with previous canonical ids.
- Hash changed, `source_missing`, last-applied `canonicalJson` equals incoming bag → `adopt_existing`.
- Hash changed, `source_missing`, values differ → not this adopt (three-way or conflict).
- Already `unchanged` / `record_conflict` / `adopt_existing` on the plan → pass through, no receipt read.
- No previous successful receipt → keep the create.

**Ask the three-way update instead of a second Lead**
- `create_form_lead` + existing Form Lead + allowlisted phone change → `update_source_owned_lead` with that `lead_id` and patch.
- Same create + policy `unchanged` + present → `unchanged`.
- Same create + policy `unchanged` + `source_missing` → `adopt_existing`.
- Missing Form Lead → `canonical_divergence`.
- Protected / financial path → `changed_protected_field`.
- Canonical already drifted from last-applied → `canonical_divergence`.
- `create_booked_from_source` / `create_cancelled_lead` with a previous receipt and a new hash → `changed_protected_field`, not a patch.

**Rewrite depends_on and recount**
- A Booking `depends_on` a Form create whose key moved to `:revision:` follows the new key.
- Counters match the rewritten classifications.

Do **not** add a helper-unit test that has to change when `withoutCommandPayload` is inlined. Do not add a test per receipt `outcome` string if the parent already proves conflict is excluded.

Caller to keep green: worker still **asks** this file only when trigger is not `bootstrap`, and still remaps `evidenceKeysForConnection` first; CLI still **asks** this file only when the connection exists; `classifyKnownEvidence` still returns `reappeared` for same hash + `source_missing`; later `applyCanonicalAdoptionPolicy` still sees this file’s `adopt_existing` / `unchanged` and leaves them; `applyPlan.ts` still **asks** `updateSourceOwnedLead` from the rewritten action.

## What I would not do

- A `BestRelocationSourceChangeService` class with `create` / `update` / `delete`.
- Thirty two-line functions that only wrap `findOne`.
- Moving this into a CRUD folder (`create.ts` / `update.ts` / `delete.ts`) or a `classify.ts` / `skip.ts` / `adopt.ts` split “for cleanliness.”
- Breaking the before-commit / after-commit **seam** on a later apply, or pair-then-threshold, or inspect 409.
- Treating `worker.ts` present-hash remap, `canonicalLeadAdoption.ts` Mongo adopt, `bootstrap.ts` first-run adopt, `updatePolicy.ts` allowlist, `detectMissingSourceActions`, or `applyPlan.ts` walk as this story.
- Starting this file from bootstrap, writing a Lead, deleting a canonical, or appending a receipt.
- Silently “fixing” the two skip layers, unused `latest_content_hash`, the two compares (`content_hash` vs `canonicalJson`), CLI missing the present-hash remap, or `HANDOFF.md`.
- Starting Owner approve, Sheets write, or `runSheetSyncDrain` from this file.
- Editing `src/`, tests, routes, models, or `docs/knowledge` in this pass.

---

**Glossary:** this checkout's `CONTEXT.md` does not define Ingestion Origin or Best Relocation. The stamped service is `docs/knowledge/services/ingestion.md`. `docs/adr/` is absent here; do not invent copies. Knowledge cites ADR-0001 (Sheets are a projection).
