# Promote This Already-Qualified Inbound Call Into A Call Lead — Skip If The Leftover Processed-Call Ledger Already Holds A Terminal Create, Adopt, Or Shadow For This Session; Adopt The One Granot Already Created When Leftover Convergence Finds Exactly One Pending Match; Otherwise Classify A Business Duplicate Lead And Create, Shadow, Or Dry-Run Per Leftover Write Mode — Never Evaluate, Never Fold Parties, Never Persist A Session, Never Subscribe — operational story

- Status: recommended
- Service: `ringcentral` (Wave A, in-progress)
- Pass: 7 of this service — `ringcentral-call-lead-ingest.service.ts`
- Remaining in this service: `ringcentral-duplicate-guard.ts`, `callLeadConvergence.service.ts`, `shadow-call-leads-store.ts`, `processed-calls-store.ts`, `call-log-sync.service.ts`, `call-log-sync-state.store.ts`, `call-log-vetting.ts`, `analytics-reconcile.service.ts`, `auth.ts`
- Target: `src/services/ringcentral/ringcentral-call-lead-ingest.service.ts`
- Knowledge: [`docs/knowledge/services/ringcentral-call-lead-qualification.md`](../../../docs/knowledge/services/ringcentral-call-lead-qualification.md) (section 4 names this file as the only RingCentral promotion gate; related-modules table names leftover duplicate-guard / leftover convergence / leftover processed-call ledger / leftover shadow / leftover config / leftover Call Log / already-recommended evaluate, not Wave B `ingestSessionLead`). Distinct from already-recommended Call Lead write: [recommendations/leads-call-lead.md](leads-call-lead.md) (`createRingCentralCallLead` / `createRingCentralCallLeadInTransaction` / `finalizeCallLeadCreateAfterCommit` — this file **asks** those; it does not price, Form-Fill, or project sheets). Distinct from leftover duplicate-guard: `classifyRingCentralCallLeadDuplicate` (90-day exact Source Granularity + phone; this file **asks** it only when leftover convergence did not adopt). Distinct from leftover convergence: `attemptRingCentralCallLeadConvergence` / `acquireRingCentralConvergenceScopeLock` / `selectRingCentralConvergenceCandidates` (exact Granot-created candidate; this file **asks** adopt-or-continue and, on default create, re-locks / re-selects inside the transaction). Distinct from leftover processed-call ledger: `findProcessedCall` / `upsertProcessedCall` / `assertProcessedCallAdoptionIndexes` (idempotency + identity fence; leftover convergence writes the ledger on adopt; this file writes it on create / shadow / dry-run). Distinct from leftover shadow: `insertShadowCallLead`. Distinct from leftover config: `resolveRingCentralLeadWriteMode` / `isRingCentralGranotAdoptionEnabled`. Distinct from already-recommended evaluate / already-recommended collapse / already-recommended session persist / already-recommended keep / already-recommended subscribe. Distinct from leftover Call Log vet (`vetRingCentralCallLogRecord`) and leftover Call Log sync (`runRingCentralCallLogSync` **asks** this file). Distinct from leftover analytics (count-level only — must not create). Distinct from Wave B `ingestSessionLead` in `ringcentral-webhook.routes.ts` (builds the descriptor when the session is leftover-ingest-eligible; this file never reads a webhook body). This checkout’s `CONTEXT.md` does not define Call Qualification / Call Lead Ingestion / Caller Match Key — the knowledge file links a parent glossary this tree does not ship. Do not invent a glossary copy. `docs/adr/` is absent here — do not invent an ADR copy. Do not add this path to knowledge in this rename.
- Callers: Wave B `src/routes/ringcentral-webhook.routes.ts` (`ingestSessionLead` → leftover `ingestRingCentralQualifiedCall`); leftover `call-log-sync.service.ts` (`ingestCall` default); this file’s `ringcentral-call-lead-ingest.service.test.ts` (five AC-14/15/16 cases); leftover `callLeadConvergence.replica.test.ts` (default-path create / race); leftover `callLeadConvergence.service.ts` and `callLeadConvergence.test.ts` import the **type** `RingCentralQualifiedCall` only. Leftover Call Log test imports `RingCentralIngestResult` only. Already-recommended keep / already-recommended subscribe / leftover evaluate / leftover duplicate-guard / leftover shadow / leftover processed-call store / leftover analytics / leftover seed — **do not import this file’s function**.
- Seams callers need: public promote (Wave B webhook and leftover Call Log both **ask** the same export with the same descriptor); leftover write mode `create` | `shadow` | `dry_run` (leftover config owns the flags; this file does not read env itself); leftover adoption on/off (`enabled` + `allowMutations: writeMode === "create"`); leftover Call Lead begin / complete (default create: `createRingCentralCallLeadInTransaction` then `finalizeCallLeadCreateAfterCommit`); injectable `createLead` (file-test **adapter** that skips the transaction, leftover scope lock, late re-check, and leftover finalize); leftover processed-call ledger skip vs write
- Split later (only if the file outgrows one sitting): this ~520-line file is one sitting if you read it as promote this already-qualified inbound call into a Call Lead — skip if the leftover processed-call ledger already holds a terminal create, adopt, or shadow for this session; adopt the one Granot already created when leftover convergence finds exactly one pending match; otherwise classify a business Duplicate Lead and create, shadow, or dry-run per leftover write mode; never evaluate, never fold parties, never persist a session, never subscribe. If it later splits: `skipWhenThisPhysicalCallIsAlreadyTerminal.ts` / `adoptTheOneGranotCallLeadOrContinue.ts` / `createShadowOrDryRunThisQualifiedCall.ts` — story files, never `create.ts` / `update.ts` / `delete.ts` / `ingest.ts`, and never merge leftover evaluate, leftover Call Log vet, leftover convergence candidates, leftover duplicate-guard, leftover processed-call store, leftover shadow, leftover Call Lead write, leftover Call Log sync, leftover analytics, or Wave B webhook HTTP into this file

`ingestRingCentralQualifiedCall` / `RingCentralIngestDependencies` / `createLead` are executor mechanics. The owner question is: *A webhook session or a Call Log record has already qualified. Promote that one physical call. If the leftover processed-call ledger already holds a terminal create, adopt, or shadow for this session or call-log id, skip. If leftover Granot adoption is on, ask leftover convergence for exactly one pending Granot-created Call Lead. Adopt that Lead and stop — do not classify, do not create a second Lead. If leftover convergence says conflict, not found, ineligible, or disabled, continue. Classify a business Duplicate Lead. Then leftover write mode decides: create a RingCentral-origin Call Lead (begin the leftover write inside a transaction, remember the leftover ledger in that same write, complete leftover sheets after commit), record leftover shadow, or record leftover dry-run on the ledger only. Do not evaluate the two-minute rule. Do not fold parties. Do not persist a session. Do not subscribe. Do not invent a second promotion gate.*

Already-recommended evaluate, already-recommended collapse, already-recommended session persist, leftover Call Log vet, leftover duplicate-guard, leftover convergence, leftover processed-call ledger, leftover shadow, leftover Call Lead write, leftover config names, leftover Call Log sync, leftover analytics, and Wave B webhook HTTP already live in other **modules**. Do not pull those in.

## What this file actually does

Four operations of one “promote this already-qualified inbound call into a Call Lead — skip if the leftover processed-call ledger already holds a terminal create, adopt, or shadow for this session; adopt the one Granot already created when leftover convergence finds exactly one pending match; otherwise classify a business Duplicate Lead and create, shadow, or dry-run per leftover write mode — never evaluate, never fold parties, never persist a session, never subscribe” story, not “a Call Lead CRUD service,” and not leftover evaluate / leftover Call Log vet:

1. **Skip if this physical call is already terminal** — leftover `findProcessedCall` by `telephonySessionId` | `sessionId` | `callLogId`. Leftover terminal statuses are `lead_created`, `lead_created_duplicate`, `lead_adopted`, `lead_adopted_duplicate`, `shadow_recorded`. Hit → leftover `skipped_already_processed` event, return that action, leftover `convergenceOutcome: null`. Never **asks** leftover convergence. Never classifies. Never writes. Leftover `dry_run` is a ledger status and is **not** terminal — a later create-mode promote will run again.

2. **Adopt the one Granot already created, or continue** — leftover write mode + leftover adoption flag. Leftover `create` plus (leftover adoption on, **or** no telephony session with a call-log id) → leftover `assertProcessedCallAdoptionIndexes` first; missing fences throw before leftover convergence. Leftover adoption on → leftover `convergence_attempted` event, then leftover `attemptRingCentralCallLeadConvergence({ enabled, allowMutations: writeMode === "create" })`. Adopted → leftover `granot_adoption.adopted` event, return `lead_adopted` / `lead_adopted_duplicate`, leftover `convergenceOutcome: "adopted"`. Never classifies. Never creates. Leftover convergence already wrote the leftover processed-call ledger in its own transaction. Conflict / not_found / ineligible → leftover event, then continue. Leftover `disabled` continues with no extra event.

3. **Classify a business Duplicate Lead only when we did not adopt** — leftover `classifyRingCentralCallLeadDuplicate` with leftover route granularity + caller phone + this session / call-log identity + `startTime ?? answeredAt ?? now`. This beat does **not** run on leftover adopt. This beat does **not** create.

4. **Write per leftover write mode** — leftover `create`: injectable `dependencies.createLead` (file-test **adapter**) writes leftover `createRingCentralCallLead` then leftover ledger **after**; default path `withTransaction` → leftover scope lock when leftover adoption is on → leftover late `findProcessedCall` / leftover late `selectRingCentralConvergenceCandidates` → leftover `RingCentralConvergenceScopeRaceError` retries the whole promote (max 2) → leftover `createRingCentralCallLeadInTransaction` + leftover ledger inside the same write → leftover `finalizeCallLeadCreateAfterCommit` after commit. Unique-key `11000` with a leftover ledger row → leftover skip. Leftover `shadow` → leftover `insertShadowCallLead` then leftover ledger. Leftover `dry_run` → leftover ledger only. Leftover created / created-duplicate events fire only for leftover `create` actions.

There is no evaluate operation. There is no party fold. There is no session persist. There is no raw-webhook capture. There is no subscribe. There is no Call Log fetch. There is no leftover analytics count. Leftover `evaluateRingCentralCallCandidate` / leftover `vetRingCentralCallLogRecord` are the qualification **adapters**. Leftover `attemptRingCentralCallLeadConvergence` is the adoption **adapter**. Leftover `classifyRingCentralCallLeadDuplicate` is the Duplicate Lead **adapter**. Already-recommended `createRingCentralCallLeadInTransaction` + `finalizeCallLeadCreateAfterCommit` are the leftover Call Lead begin / complete **seam**. This file is the only promotion gate.

`RingCentralQualifiedCall` / `RingCentralIngestResult` / `RingCentralIngestAction` / `RingCentralIngestDependencies` sit on the promote path. They are not extra owner operations. Do not invent a dashboard for leftover `convergenceOutcome` in this rename. Do not export leftover `isDuplicateKeyError` as a public **seam**.

## Organization

Keep one file as the screenplay for “promote this already-qualified inbound call into a Call Lead — skip if the leftover processed-call ledger already holds a terminal create, adopt, or shadow for this session; adopt the one Granot already created when leftover convergence finds exactly one pending match; otherwise classify a business Duplicate Lead and create, shadow, or dry-run per leftover write mode; never evaluate, never fold parties, never persist a session, never subscribe.” Already-recommended evaluate, already-recommended collapse, already-recommended session persist, leftover Call Log vet, leftover duplicate-guard, leftover convergence, leftover processed-call ledger, leftover shadow, leftover Call Lead write, leftover config names, leftover Call Log sync, leftover analytics, and Wave B webhook HTTP already live in deeper **modules**. Do not pull those in. Do not invent a `RingCentralCallLeadIngestService` class. Do not invent a begin / complete **seam** on this file — leftover Call Lead already owns begin / complete; this file **asks** that **seam** on default create. Do not invent an evaluate **adapter** beside leftover `evaluateRingCentralCallCandidate`. Do not invent an adoption **adapter** beside leftover `attemptRingCentralCallLeadConvergence`. Do not invent a Duplicate Lead **adapter** beside leftover `classifyRingCentralCallLeadDuplicate`.

Do not split this into `create.ts` / `update.ts` / `delete.ts` / `ingest.ts`. Those are persistence verbs, not the owner story. Do not move leftover evaluate or leftover Call Log vet into this file so “one file owns qualify and promote.” Do not move leftover convergence candidate selection into this file so “one file owns adopt and create.” Do not silently leftover-evaluate after skip so “one write owns qualify and promote.” Do not silently create when leftover write mode is leftover shadow so “we always persist a Lead.”

**External interface** stays small (this is the test surface). Skip, adopt-or-continue, classify, and write-per-mode are one story’s promote, not four CRUD verbs:

| Keep exporting | Story name | Why the seam exists |
|---|---|---|
| `ingestRingCentralQualifiedCall` | `promoteThisAlreadyQualifiedInboundCallIntoACallLead` | Wave B webhook and leftover Call Log both **ask** the same gate |
| `RingCentralQualifiedCall` | `AlreadyQualifiedInboundCall` | leftover collapse / leftover Call Log vet already decided; this bag is path-agnostic |
| `RingCentralIngestResult` | `WhetherWeCreatedAdoptedShadowedOrSkipped` | `{ action, duplicate, callLeadId, leftover convergenceOutcome }` |
| `RingCentralIngestAction` | `HowThisQualifiedCallEnded` | closed leftover action set including leftover skip |
| `RingCentralIngestDependencies` | `InjectablePromoteAdaptersForFileTests` | file tests replace leftover ledger / leftover convergence / leftover create |

Keep the old names as one-line aliases until Wave B `ingestSessionLead`, leftover Call Log `ingestCall`, the file test, and leftover replica tests migrate. Do not make callers learn `withTransaction` / `createLead` / `convergenceRaceRetries` / `11000` as the domain language.

**Principle: old exports stay as aliases.** `ingestRingCentralQualifiedCall` remains the imported name until Wave B and leftover Call Log migrate.

**No class for the workflow.** The type that *does* earn a name is the path-agnostic descriptor leftover webhook and leftover Call Log already build:

```ts
type AlreadyQualifiedInboundCall = {
  ingestionSource: "webhook" | "call_log_sync"
  telephonySessionId: string | null
  callLogId: string | null
  routeResolution: /* leftover registry snapshot for this inbound number */
  callerPhoneNumber: string
  // answered / terminal / start / duration / leftover qualification reason
}

type WhetherWeCreatedAdoptedShadowedOrSkipped = {
  action: HowThisQualifiedCallEnded
  duplicate: boolean
  callLeadId: string | null
  convergenceOutcome: /* leftover adoption report; null on leftover skip */
}
```

That is the handoff from “this inbound call already qualified” to “Wave B / leftover Call Log may promote it here.” Do **not** add `rawWebhookBody` so “this file can replace already-recommended keep,” do **not** add `parties[]` so “this file can replace leftover evaluate,” and do **not** add `callLogRecord` so “this file can replace leftover Call Log vet.”

Do not add `evaluateRingCentralCallCandidate` as a public story **seam** on this file — already-recommended evaluate already owns that export. Do not add `attemptRingCentralCallLeadConvergence` as a public **seam** — leftover convergence already owns that. Do not add `classifyRingCentralCallLeadDuplicate` as a public **seam** — leftover duplicate-guard already owns that. Do not export `isDuplicateKeyError` as a public **seam** — it exists so the parent reads.

## The file, as a story

Parent functions stay deep. Child names are only extracted when they hide a real decision, not a one-liner.

```ts
// ringcentral-call-lead-ingest.service.ts
// A webhook session or a Call Log record has already qualified.
// Promote that one physical call into a Call Lead.
// Skip if we already processed this session.
// Adopt the one Granot already created when leftover
// convergence finds exactly one pending match.
// Otherwise classify a business Duplicate Lead and
// create, shadow, or dry-run per leftover write mode.
// Do not evaluate. Do not fold parties.
// Do not persist a session. Do not subscribe.

// ── 1. Skip if this physical call is already terminal ─────

export async function promoteThisAlreadyQualifiedInboundCallIntoACallLead(
  call: AlreadyQualifiedInboundCall,
  now?: Date,
  dependencies?: Partial<InjectablePromoteAdaptersForFileTests>,
)

async function skipWhenTheLeftoverLedgerAlreadyHoldsATerminalResult(call)

// ── 2. Adopt the one Granot already created, or continue ──

async function refuseWhenLeftoverAdoptionIndexesAreMissing(call, writeMode)
async function askLeftoverConvergenceToAdoptOrContinue(call, writeMode)
function returnTheAdoptedLeadWithoutClassifyingOrCreating(adoption)

// ── 3. Classify a business Duplicate Lead ─────────────────

async function classifyABusinessDuplicateLeadOnlyWhenWeDidNotAdopt(call)

// ── 4. Write per leftover write mode ──────────────────────

async function beginAndCompleteLeftoverRingCentralCallLeadIngestion(call, duplicate)
async function lockTheLeftoverConvergenceScopeAndRefuseIfSomeoneElseWon(call)
async function createThroughTheInjectableTestAdapter(call, duplicate)
async function recordAShadowInsteadOfALead(call, duplicate)
function recordADryRunOnTheLedgerOnly(call, duplicate)
async function rememberThisCallOnTheLeftoverProcessedCallLedger(result)
function retryTheWholePromotionWhenLeftoverConvergenceRaced(retries)
function skipWhenTheUniqueSessionIndexAlreadyWon(error)
```

Read the primary path out loud: *If the leftover processed-call ledger already holds a terminal create, adopt, or shadow for this session or call-log id, skip. If leftover create is on and leftover adoption needs the identity fences — leftover adoption on, or a call-log-only row with no telephony session — refuse when those unique indexes are missing. Ask leftover convergence to adopt exactly one pending Granot-created Call Lead when leftover adoption is on and leftover create may mutate. If leftover convergence adopted, return that Lead. Do not classify. Do not create a second Lead. If leftover convergence said conflict, not found, ineligible, or disabled, classify a business Duplicate Lead. Then leftover write mode decides: begin leftover RingCentral Call Lead ingestion inside a transaction, remember the leftover ledger in that same write, complete leftover sheets after commit; or record leftover shadow; or record leftover dry-run on the ledger only. If leftover convergence raced inside the create write, retry the whole promote twice. If the unique session index already won, skip. Do not evaluate the two-minute rule. Do not fold parties. Do not persist a session. Do not subscribe. Do not invent a second promotion gate.*

That is the operation. `ingestRingCentralQualifiedCall` is not.

## Precise logic I would tighten while renaming

These are real smells the story names make obvious. Do not “just rename.”

1. **Two leftover create implementations.** Injectable `dependencies.createLead` (the public leftover `createRingCentralCallLead` file-test **adapter**) writes a Lead, then leftover ledger **after**, and never leftover-finalizes. Default leftover create **asks** leftover `createRingCentralCallLeadInTransaction` then leftover `finalizeCallLeadCreateAfterCommit`, and leftover-ledgers **inside** the transaction. Already parked in `CONTRADICTIONS.md`: leftover finalize emits `lead.call.created`; leftover public `createRingCentralCallLead` does not (knowledge says ingest emits `ringcentral.call_lead.created` / `duplicate_created`). Do not silently point default leftover create at leftover `createRingCentralCallLead` so “one create owns both **adapters**.” Do not silently leftover-finalize the injectable path so “file tests start projecting sheets.”

2. **Leftover adopt returns without this file writing the leftover ledger.** Knowledge step 5 says “persist the processed-call ledger result.” Leftover convergence already writes that ledger in the adoption transaction. This file returns. Do not silently leftover-upsert after leftover adopt so “this file always owns the ledger” — that would be a second write of a leftover terminal row. Do not move leftover adoption’s ledger write into this file so “one upsert owns adopt and create.”

3. **Knowledge leftover classify-after-adopt vs this file.** Knowledge section 4 says leftover classify runs after leftover convergence “for adoption, exclude the adopted Lead.” This file never leftover-classifies on leftover adopt; leftover convergence classifies inside leftover `adoptRingCentralCall`. Do not silently leftover-classify after leftover adopt so “the knowledge outline wins” without a paired leftover-convergence test. Do not delete leftover classify from leftover convergence so “this file owns Duplicate Lead.”

4. **Knowledge leftover event keys vs this file.** Knowledge table names `ringcentral.call_lead.adopted` / `adopted_duplicate`. This file writes leftover `ringcentral.granot_adoption.adopted` (plus leftover `convergence_attempted` / leftover `convergence_not_found` / leftover `convergence_ineligible` / leftover `granot_adoption.conflict`). Do not silently rename the leftover events so “knowledge matches” in this rename.

5. **Leftover `dry_run` is not leftover-terminal.** A leftover dry-run row does not leftover-skip the next leftover create-mode promote. Knowledge step 1 already lists leftover create / leftover adopt / leftover shadow only. Do not silently add leftover `dry_run` to leftover `RINGCENTRAL_PROCESSED_CALL_TERMINAL_STATUSES` so “every ledger row is final.” Do not silently skip leftover dry-run so “we never promote twice.”

6. **Leftover identity-fence fires for leftover call-log-only create even when leftover adoption is off.** File test AC-14 locks that throw **before** leftover convergence. Do not silently skip leftover `assertProcessedCallAdoptionIndexes` when leftover adoption is off so “fences are adoption-only.” Do not silently leftover-assert on leftover webhook-with-session create when leftover adoption is off so “every leftover create checks indexes.”

7. **Leftover `attemptConvergence` always runs.** Leftover adoption off → leftover convergence returns leftover `disabled` immediately. Do not silently skip the leftover **ask** so “disabled means no call” without a paired leftover-convergence test. Do not treat leftover `disabled` as leftover skip.

8. **Leftover convergence-scope race retries the whole leftover promote.** Default leftover create throws leftover `RingCentralConvergenceScopeRaceError` when a late leftover ledger row or leftover candidate appears inside the transaction. Recurse leftover `ingestRingCentralQualifiedCall` up to two times. Do not silently retry only leftover create so “skip and leftover adopt are not re-read.” Do not raise the retry cap so “races always settle.”

9. **Leftover unique-key `11000` leftover-skips only when leftover `findProcessedCall` then finds a row.** No leftover ledger row → rethrow. Do not silently leftover-return skip with a null leftover `callLeadId` so “every 11000 is leftover idempotent.”

10. **File tests never prove leftover default create.** `ringcentral-call-lead-ingest.service.test.ts` proves leftover skip, leftover adopt-before-classify, leftover not-found continue, leftover webhook/Call-Log descriptor parity, and leftover call-log-only fail-closed. Leftover `callLeadConvergence.replica.test.ts` proves leftover default create. Do not silently inject leftover `createLead` into leftover replica tests so “one **adapter** owns both proofs.”

11. **Leave sibling modules alone.** Leftover evaluate, leftover Call Log vet, leftover duplicate-guard, leftover convergence, leftover processed-call ledger, leftover shadow, leftover Call Lead write, leftover config names, leftover Call Log sync, leftover analytics, already-recommended keep, already-recommended subscribe, already-recommended collapse, and already-recommended session persist already live at the right **depth**. This file orchestrates leftover ledger / leftover convergence / leftover classify / leftover Call Lead / leftover shadow **asks**.

## Testing

The **interface** is the test surface: `promoteThisAlreadyQualifiedInboundCallIntoACallLead`.

Today’s `ringcentral-call-lead-ingest.service.test.ts` names leftover skip-before-adopt, leftover adopt-before-classify, leftover not-found continue, leftover webhook/Call-Log parity, and leftover call-log-only fail-closed. That is the leftover adoption **seam**, not leftover default create. Leftover replica tests prove leftover default create and leftover races. Add tests that name the operation. Do not treat leftover evaluate, leftover Call Log vet, leftover Call Log sync, leftover analytics, or Wave B POST as this file’s proof.

**Skip if this physical call is already terminal**
- Leftover `lead_created` / leftover `lead_adopted` / leftover `shadow_recorded` → leftover `skipped_already_processed`, leftover `convergenceOutcome: null`, leftover convergence never **asked**.
- Leftover `dry_run` ledger row is **not** leftover skip; leftover classify / leftover write still run.

**Adopt the one Granot already created, or continue**
- Leftover adoption on + leftover create + leftover adopted → leftover `lead_adopted`, leftover classify never **asked**, leftover create never **asked**, leftover ledger upsert on this file never **asked**.
- Leftover adopted + leftover duplicate → leftover `lead_adopted_duplicate`.
- Leftover not_found / leftover conflict / leftover ineligible / leftover disabled → leftover classify runs next.
- Leftover shadow / leftover dry-run pass leftover `allowMutations: false`; leftover convergence may report leftover not_found even when a leftover candidate exists.
- Leftover create + leftover call-log-only (no telephony session) + missing leftover identity fences → throw before leftover convergence, leftover adoption off or on.

**Classify a business Duplicate Lead only when we did not adopt**
- Leftover adopt never leftover-classifies.
- Leftover classify receives leftover route granularity + caller phone + this leftover session / leftover call-log identity.

**Write per leftover write mode**
- Leftover default create → leftover begin inside leftover `withTransaction`, leftover ledger in that same write, leftover finalize after commit, leftover `lead_created` / leftover `lead_created_duplicate` event.
- Injectable leftover `createLead` → leftover public `createRingCentralCallLead` **adapter**, leftover ledger **after**, no leftover finalize.
- Leftover shadow → leftover `insertShadowCallLead`, leftover ledger, no leftover Call Lead write.
- Leftover dry-run → leftover ledger only, leftover `action: "dry_run"`.
- Leftover convergence-scope race → leftover whole-promote retry, then leftover skip or leftover throw.
- Leftover `11000` + leftover ledger row → leftover skip; leftover `11000` + no leftover ledger row → throw.
- This beat never **asks** leftover evaluate. This beat never **asks** leftover Call Log vet. This beat never returns a leftover subscription id. This beat never **asks** leftover analytics.

Do **not** add a test per helper (`skipWhenTheLeftoverLedgerAlreadyHoldsATerminalResult`, `returnTheAdoptedLeadWithoutClassifyingOrCreating`). Those names exist so the parent reads. If a helper test has to change when the helper is inlined, it was testing past the **interface**.

Do **not** add leftover evaluate, leftover Call Log vet, leftover Call Log sync, leftover analytics, already-recommended keep, already-recommended session persist, leftover subscribe, or Wave B `ingestSessionLead` as this file’s proof. Wave B and leftover Call Log stay on those **adapters** — they **ask** this interface; they do not own leftover skip, leftover adopt, leftover classify, or leftover write mode.

## What I would not do

- A `RingCentralCallLeadIngestService` class with `create` / `update` / `delete`.
- Thirty two-line functions that only wrap an existing call.
- Moving this into a CRUD folder (`create.ts` / `ingest.ts` / `adopt.ts`) “for cleanliness.”
- Breaking the leftover Call Lead begin / complete **seam**, leftover processed-call ledger skip **seam**, leftover adoption-before-classify **seam**, or leftover write-mode **seam**.
- Treating leftover `evaluateRingCentralCallCandidate`, leftover `vetRingCentralCallLogRecord`, leftover `attemptRingCentralCallLeadConvergence`, leftover `classifyRingCentralCallLeadDuplicate`, leftover `runRingCentralCallLogSync`, or Wave B `ingestSessionLead` as this story. Those are different **adapters**.
- Inventing a qualify-then-promote **seam** that has only one **adapter** (this file never leftover-evaluates).
- Silently merging leftover public `createRingCentralCallLead` into leftover default create, silently leftover-classifying after leftover adopt, silently leftover-upserting the ledger after leftover adopt, silently leftover-terminalizing leftover `dry_run`, or silently leftover-evaluating after leftover skip, while recommending a rename.
- Jumping to leftover duplicate-guard while this service still has unchecked Wave A modules.
- Writing a whole-folder recommendation for `ringcentral`.
