# Stage This Already-Qualified Inbound Call As A Non-Billable Observation So The Deployment Can Be Watched End-To-End Without Producing A Call Lead — Swallow A Replay Of The Same Telephony Session; Never Create A Call Lead; Never Write The Leftover Ledger; Never Evaluate; Never Adopt; Never Classify; Never Price; Never Project Sheets — operational story

- Status: recommended
- Service: `ringcentral` (Wave A, in-progress)
- Pass: 10 of this service — `shadow-call-leads-store.ts`
- Remaining in this service: `processed-calls-store.ts`, `call-log-sync.service.ts`, `call-log-sync-state.store.ts`, `call-log-vetting.ts`, `analytics-reconcile.service.ts`, `auth.ts`
- Target: `src/services/ringcentral/shadow-call-leads-store.ts`
- Knowledge: [`docs/knowledge/services/ringcentral-call-lead-qualification.md`](../../../docs/knowledge/services/ringcentral-call-lead-qualification.md) (section 4 write modes: leftover `create` > leftover `shadow` > leftover `dry_run`; leftover shadow is `RINGCENTRAL_SHADOW_CALL_LEADS=true` with leftover create off → `insertShadowCallLead` staging collection; leftover ingest action `shadow_recorded`; leftover shadow / leftover dry-run may leftover-evaluate leftover convergence’s bounded outcome then continue without mutating a Lead; related-modules row: “Shadow-mode staging”). Distinct from already-recommended promote: [recommendations/ringcentral-call-lead-ingest.md](ringcentral-call-lead-ingest.md) (the only promotion gate — leftover write mode leftover `shadow` **asks** this file, then leftover ledger; this file never reads leftover write mode). Distinct from leftover processed-call ledger: `processed-calls-store.ts` (idempotency + sparse unique `telephonySessionId` **and** sparse unique `callLogId`; leftover `shadow_recorded` is leftover-terminal — this file has **no** unique `callLogId` and never writes that ledger). Distinct from already-recommended Call Lead write: [recommendations/leads-call-lead.md](leads-call-lead.md) (`createRingCentralCallLead` — leftover create **asks** that; leftover shadow must not). Distinct from already-recommended adopt: [recommendations/ringcentral-call-lead-convergence.md](ringcentral-call-lead-convergence.md) (`allowMutations` is leftover `writeMode === "create"` — leftover shadow never adopts). Distinct from already-recommended Duplicate Lead: [recommendations/ringcentral-duplicate-guard.md](ringcentral-duplicate-guard.md) (already-recommended promote leftover-classifies **before** this file; this file copies `duplicate`). Distinct from leftover evaluate / leftover Call Log vet / leftover Call Log sync / leftover analytics / leftover seed / leftover config names (`shadowCallLeads` → `ringcentral_shadow_call_leads` plus the `_test` suffix unless leftover config turns that suffix off). Distinct from leftover `ringcentral-mongo.ts` (`getRingCentralDb` — this file **asks** it). Distinct from Wave B webhook HTTP (Wave B leftover-ingests; this file only when leftover write mode is leftover shadow). This checkout’s `CONTEXT.md` does not define Call Qualification / Call Lead Ingestion — the knowledge file links a parent glossary this tree does not ship. Do not invent a glossary copy. `docs/adr/` is absent here — do not invent an ADR copy. Do not add this path to knowledge in this rename.
- Callers: **already-recommended promote only. No file test. No Wave B debug route. No script.** Already-recommended `ringcentral-call-lead-ingest.service.ts` — default `deps.insertShadow` **asks** `insertShadowCallLead`; leftover write mode leftover `shadow` **asks** it then leftover ledger. Already-recommended ingest’s file test never **asks** leftover shadow (leftover `dry_run` only). Leftover `call-log-sync.service.ts` leftover-counts leftover `shadow_recorded` on leftover ingest’s return — not this **interface**. Leftover processed-call ledger names leftover `shadow_recorded` — not a caller. Leftover config names the collection — not a caller. Not this **interface**: leftover evaluate, leftover Call Log vet, leftover adopt, leftover Call Lead write, leftover analytics, leftover seed, Wave B `ingestSessionLead`.
- Seams callers need: stage-without-a-Call-Lead vs leftover create (already-recommended promote picks leftover write mode; this file never reads leftover flags); swallow-same-telephony-session (`11000` → `null`) vs leftover ledger’s leftover-terminal skip (already-recommended promote leftover-skips **before** this file when leftover `shadow_recorded` already exists); this file’s unique sparse `telephonySessionId` vs leftover ledger’s unique sparse `callLogId` (Call Log-only rows are **not** unique here); inserted id vs leftover `null` (already-recommended promote ignores the return and leftover-records leftover `shadow_recorded` either way)
- Split later (only if the file outgrows one sitting): this ~87-line file is one sitting if you read it as stage this already-qualified inbound call as a non-billable observation so the deployment can be watched end-to-end without producing a Call Lead; swallow a replay of the same telephony session; never create a Call Lead; never write the leftover ledger; never evaluate; never adopt; never classify; never price; never project sheets. If it later splits: `stageThisAlreadyQualifiedCallAsANonBillableObservation.ts` / `swallowAReplayOfTheSameTelephonySession.ts` — story files, never `create.ts` / `insert.ts` / `update.ts` / `delete.ts` / `store.ts`, and never merge already-recommended promote, leftover processed-call ledger, leftover Call Lead write, leftover evaluate, leftover Call Log vet, leftover adopt, leftover classify, leftover config names, or Wave B webhook HTTP into this file

`insertShadowCallLead` is executor mechanics. The owner question is: *This inbound call already qualified. Already-recommended promote decided leftover write mode is leftover shadow — leftover create is off, leftover shadow is on. Remember what would have become a Call Lead: caller, target, duration, leftover Duplicate Lead flag, leftover qualification reason, webhook or Call Log origin. Do not write `call_leads`. Do not price. Do not project sheets. Do not write the leftover processed-call ledger — already-recommended promote leftover-writes that after. If this telephony session was already staged, return null and do not throw. A Call Log record with no telephony session is not unique here — leftover ledger owns leftover Call Log idempotency. Do not evaluate the two-minute rule. Do not adopt. Do not classify. Do not invent a second leftover write mode.*

Already-recommended promote, leftover processed-call ledger, leftover Call Lead write, leftover evaluate, leftover Call Log vet, leftover adopt, leftover classify, leftover config names, leftover mongo helper, leftover Call Log sync, leftover analytics, and Wave B webhook HTTP already live in other **modules**. Do not pull those in.

## What this file actually does

Two operations of one “stage this already-qualified inbound call as a non-billable observation so the deployment can be watched end-to-end without producing a Call Lead — swallow a replay of the same telephony session; never create a Call Lead; never write the leftover ledger; never evaluate; never adopt; never classify; never price; never project sheets” story, not “a shadow CRUD store,” and not already-recommended promote / leftover Call Lead write:

1. **Stage this already-qualified call as a non-billable observation** — `insertShadowCallLead`. Stamp leftover `provider: "ringcentral"` and leftover `createdAt` (`now` or `new Date()`). Insert one leftover `ringcentral_shadow_call_leads` row: leftover telephony session / leftover session / leftover call-log id, leftover `ingestionSource` (`webhook` | `call_log_sync`), leftover Source Company / leftover source label, leftover caller / leftover target / leftover duration / leftover answered / leftover hangup, leftover Duplicate Lead flag, leftover qualification reason. Unique sparse leftover `{ telephonySessionId: 1 }`. Browse leftover `{ sourceCompany: 1, createdAt: -1 }` exists; this file never leftover-lists. Return the inserted leftover id. This beat does **not** leftover-write leftover `call_leads`. This beat does **not** leftover-write leftover processed-call ledger. This beat does **not** leftover-read leftover write mode.

2. **Swallow a replay of the same telephony session** — leftover `11000` → leftover `null`. Any other leftover error leftover-throws. Sparse unique leftover-ignores leftover `telephonySessionId: null`, so leftover Call Log-only rows leftover-do not collide here. This beat does **not** leftover-upsert. This beat does **not** leftover-compare leftover `callLogId`.

There is no leftover create operation. There is no leftover ledger operation. There is no leftover evaluate operation. There is no leftover adopt operation. There is no leftover classify operation. There is no leftover price / leftover sheet operation. Already-recommended `ingestRingCentralQualifiedCall` is the leftover promotion **adapter** that leftover-asks this file only when leftover write mode is leftover `shadow`. Leftover `upsertProcessedCall` is the leftover idempotency **adapter**. Already-recommended `createRingCentralCallLead` is the leftover Call Lead **adapter**. Leftover `resolveRingCentralLeadWriteMode` is the leftover write-mode **adapter**.

`RingCentralShadowCallLeadDocument` sits on the leftover stage path. It is not an extra owner operation. Do not invent a leftover dashboard for leftover `sourceCompany + createdAt` in this rename. Collection leftover names come from leftover config (`shadowCallLeads`) at leftover call time, not a leftover snapshot constant.

## Organization

Keep one file as the screenplay for “stage this already-qualified inbound call as a non-billable observation so the deployment can be watched end-to-end without producing a Call Lead; swallow a replay of the same telephony session; never create a Call Lead; never write the leftover ledger; never evaluate; never adopt; never classify; never price; never project sheets.” Already-recommended promote, leftover processed-call ledger, leftover Call Lead write, leftover evaluate, leftover Call Log vet, leftover adopt, leftover classify, leftover config names, leftover mongo helper, leftover Call Log sync, leftover analytics, and Wave B webhook HTTP already live in deeper **modules**. Do not pull those in. Do not invent a `ShadowCallLeadStoreService` class. Do not invent a leftover begin / complete **seam** — this leftover write is one leftover insert, not a leftover command transaction. Do not invent a leftover promote **adapter** beside already-recommended `ingestRingCentralQualifiedCall`. Do not invent a leftover Call Lead **adapter** beside already-recommended `createRingCentralCallLead`. Do not invent a leftover ledger **adapter** beside leftover `upsertProcessedCall`. Do not invent a leftover write-mode **adapter** beside leftover `resolveRingCentralLeadWriteMode`.

Do not split this into `create.ts` / `insert.ts` / `update.ts` / `delete.ts` / `store.ts`. Those are leftover persistence verbs, not the owner story. Do not move leftover stage into already-recommended promote so “one file owns leftover shadow and leftover ledger.” Do not move leftover ledger into this file so “one leftover write owns leftover observe and leftover skip.” Do not silently leftover-create a leftover Call Lead so “leftover shadow still leftover-bills.” Do not silently leftover-unique leftover `callLogId` so “leftover shadow leftover-matches leftover ledger” without a paired leftover Call Log-only test.

**External interface** stays small (this is the test surface). Stage and swallow-replay are one story’s leftover non-billable observation, not two leftover CRUD verbs:

| Keep exporting | Story name | Why the seam exists |
|---|---|---|
| `insertShadowCallLead` | `stageThisAlreadyQualifiedCallAsANonBillableObservation` | already-recommended promote leftover-asks leftover observe when leftover write mode is leftover shadow |
| `RingCentralShadowCallLeadDocument` | `NonBillableObservationOfAQualifiedCall` | leftover caller / leftover target / leftover Duplicate Lead flag / leftover origin — not a leftover Call Lead |

Keep the old names as one-line aliases until already-recommended promote leftover-migrates. Do not make leftover callers leftover-learn leftover `insertOne` / leftover `11000` / leftover `$setOnInsert` as the leftover domain language.

**Principle: old exports stay as aliases.** `insertShadowCallLead` remains the imported name until already-recommended promote leftover-migrates.

**No class for the leftover workflow.** The type that earns a name is the observation bag already-recommended promote leftover-builds:

```ts
type NonBillableObservationOfAQualifiedCall = {
  telephonySessionId: string | null
  callLogId: string | null
  ingestionSource: "webhook" | "call_log_sync"
  callerPhoneNumber: string
  targetPhoneNumber: string
  duplicate: boolean            // leftover classify already decided
  qualificationReason: string | null
}

type WhetherThisTelephonySessionWasAlreadyStaged = string | null
// leftover id on leftover first leftover insert; leftover null on leftover same leftover session
```

That is the handoff from “already-recommended promote leftover-chose leftover shadow” to “the leftover deployment can watch what would have become a leftover Call Lead.” Do **not** leftover-add leftover `callLeadId` so “this file can leftover-replace leftover create,” do **not** leftover-add leftover `writeMode` so “this file can leftover-replace leftover config,” and do **not** leftover-add leftover `status: "shadow_recorded"` so “this file can leftover-replace leftover ledger.”

Do not leftover-add leftover `upsertProcessedCall` as a public story **seam** on this file — leftover processed-call leftover ledger already leftover-owns that export. Do not leftover-add leftover `createRingCentralCallLead` as a public **seam** — leftover Call Lead leftover write already leftover-owns that. Do not leftover-export leftover `isDuplicateKeyError` as a public **seam** — it leftover-exists so the leftover parent leftover-reads. Do not leftover-promote leftover config leftover collection leftover keys to leftover owner leftover **seams** in this leftover rename.

## The file, as a story

Parent functions stay deep. Child names are only extracted when they hide a real decision, not a one-liner.

```ts
// shadow-call-leads-store.ts
// This inbound call already qualified.
// Already-recommended promote decided leftover write mode is leftover shadow.
// Remember what would have become a Call Lead.
// Do not write call_leads. Do not price. Do not project sheets.
// Do not write the leftover processed-call ledger.
// If this telephony session was already staged, return null.
// A Call Log record with no telephony session is not unique here.

// ── 1. Stage this already-qualified call as a non-billable observation ─

export async function stageThisAlreadyQualifiedCallAsANonBillableObservation(
  observation,
)

function stampTheObservationAsRingCentral(observation, now)
async function writeTheNonBillableObservation(document)

// ── 2. Swallow a replay of the same telephony session ─

function swallowAReplayOfTheSameTelephonySession(error)
  // 11000 -> null; anything else throws
  // sparse unique ignores a null telephony session
```

Read the primary path out loud: *This inbound call already qualified. Already-recommended promote chose leftover shadow. Stamp provider RingCentral and createdAt. Insert one non-billable observation of the caller, target, duration, leftover Duplicate Lead flag, leftover qualification reason, webhook or Call Log origin. Hand back the inserted id. If this telephony session was already staged, return null and do not throw. Already-recommended promote then writes the leftover processed-call ledger as leftover shadow_recorded either way. Do not create a Call Lead here. Do not write the leftover ledger here. Do not evaluate. Do not adopt. Do not classify.*

That is the operation. `insertShadowCallLead` is not.

## Precise logic I would tighten while renaming

These are real smells the story names make obvious. Do not "just rename."

1. **Knowledge draws leftover ingest then leftover create / leftover shadow / leftover dry-run. Stage is this file. The leftover ledger is leftover `processed-calls-store.ts`.** Already-recommended promote **asks** this file, then leftover ledger. Do not delete this insert so "leftover shadow is just leftover ledger." Do not write leftover ledger here so "one write owns observe and skip." Keep knowledge leftover-ingest order. Do not add this path to knowledge in this rename.

2. **Already-recommended promote ignores the return.** First insert returns an id. Replay returns `null`. Both become leftover `shadow_recorded` plus leftover ledger write. Do not make leftover promote skip leftover ledger when null so "replay owns skip" without a paired leftover ingest test. Leftover-terminal skip already lives before this file.

3. **This file has no unique `callLogId`.** Leftover processed-call ledger has sparse unique `telephonySessionId` and sparse unique `callLogId`. Call Log-only rows (`telephonySessionId: null`) do not collide here. Two inserts of the same leftover call-log id can stage twice if leftover ledger check is skipped or fails after the first insert. Do not silently add unique `callLogId` so "leftover shadow matches leftover ledger" without a paired leftover Call Log-only test.

4. **Indexes bootstrap at runtime.** Leftover Call Log sync state fails closed when its unique index is missing. This file creates session plus browse indexes on first use. Do not silently fail-closed this store so "every RingCentral store matches."

5. **`sourceCompany + createdAt` has no reader.** This file never leftover-lists. No Wave B debug route leftover-asks it. No script leftover-asks it. Do not invent a leftover dashboard so "the browse index earns an export." Do not drop the index so "unused means delete" without a paired leftover observer.

6. **`isDuplicateKeyError` is copied.** Already-recommended promote has its own leftover `11000` helper for leftover create. This file has a second copy for leftover shadow. Do not silently share one helper so "one 11000 owns both writes" without a paired leftover compile of leftover ingest.

7. **This file never leftover-reads leftover write mode.** Already-recommended promote leftover-asks this file only on leftover `shadow`. Do not silently leftover-refuse leftover insert unless leftover shadow is on so "the store owns leftover write mode." Prove leftover write mode on leftover config / leftover ingest.

8. **Leftover `duplicate` is a copy.** Already-recommended promote leftover-classifies first. This file stores the flag. Do not leftover-classify here so "one file owns Duplicate Lead and leftover shadow."

9. **There is no file test on this interface.** Already-recommended ingest file test leftover-stubs leftover `dry_run` and never leftover-asks leftover shadow. Leftover Call Log leftover-counts leftover `shadow_recorded` on leftover ingest return. Mongo / leftover 11000 / leftover null leftover session / leftover Call Log-only leftover have **no** proof on this **interface**.

10. **Leave sibling modules alone.** Already-recommended promote, leftover processed-call ledger, leftover Call Lead write, leftover evaluate, leftover Call Log vet, leftover adopt, leftover classify, leftover config names, leftover seed, and Wave B `ingestSessionLead` already live at the right **depth**. This file leftover-asks leftover mongo helper and leftover config leftover names only.

## Testing

The **interface** is the test surface: `stageThisAlreadyQualifiedCallAsANonBillableObservation`.

There is no `shadow-call-leads-store.test.ts`. Already-recommended `ringcentral-call-lead-ingest.service.test.ts` names leftover skip / leftover adopt / leftover dry-run and must stay on that file. Do not treat leftover ingest, leftover ledger, leftover Call Lead write, leftover evaluate, leftover Call Log vet, leftover adopt, leftover classify, or Wave B `ingestSessionLead` as this file proof.

Add tests that name the operation:

**Stage this already-qualified call as a non-billable observation**
- Insert returns an id. Document stamps leftover `provider: "ringcentral"` and leftover `createdAt`.
- Unique key is leftover `telephonySessionId` when present. Leftover `callLogId` is not unique here.
- Leftover `duplicate` and leftover `qualificationReason` are stored as given. This beat never leftover-classifies and never leftover-evaluates.
- This beat never returns a Call Lead id that exists on leftover `call_leads`. This beat never leftover-asks leftover ledger.

**Swallow a replay of the same telephony session**
- Second insert of the same leftover `telephonySessionId` returns `null`. Other errors throw.
- Call Log-only (`telephonySessionId: null`, leftover `callLogId` set) inserts twice without throwing on this file. Idempotency for that path lives on leftover ledger.
- First persist from a null leftover session is not a replay.

Do **not** add a test per helper (`stampTheObservationAsRingCentral`, `swallowAReplayOfTheSameTelephonySession`). Those names exist so the parent reads. If a helper test has to change when the helper is inlined, it was testing past the **interface**.

Do **not** add leftover ingest, leftover ledger, leftover Call Lead write, leftover evaluate, leftover Call Log vet, leftover adopt, leftover classify, leftover seed, leftover analytics, or Wave B `ingestSessionLead` as this file proof. Already-recommended leftover ingest tests stay on leftover ingest. They leftover-ask leftover write mode. They do not own leftover stage.

## What I would not do

- A `ShadowCallLeadStoreService` class with `create` / `update` / `delete`.
- Thirty two-line functions that only wrap an existing call.
- Moving this into a CRUD folder (`insert.ts` / `store.ts` / `create.ts`) for cleanliness.
- Breaking leftover ingest leftover-shadow-then-leftover-ledger **seam**, leftover ledger leftover-terminal skip **seam**, or leftover write-mode leftover `create` > leftover `shadow` > leftover `dry_run` **seam**.
- Treating leftover `ingestRingCentralQualifiedCall`, leftover `upsertProcessedCall`, leftover `createRingCentralCallLead`, leftover `evaluateRingCentralCallCandidate`, leftover `vetRingCentralCallLogRecord`, leftover `attemptRingCentralCallLeadConvergence`, leftover `classifyRingCentralCallLeadDuplicate`, leftover `runRingCentralCallLogSync`, leftover `resolveRingCentralLeadWriteMode`, or Wave B `ingestSessionLead` as this story. Those are different **adapters**.
- Inventing a leftover promote **seam** that has only one **adapter** (this file never leftover-creates a leftover Call Lead).
- Silently leftover-creating a leftover Call Lead inside leftover stage while recommending a rename.
- Silently leftover-writing leftover ledger here while recommending a rename.
- Silently leftover-adding unique leftover `callLogId` while recommending a rename.
- Jumping to leftover processed-calls-store while this service still has unchecked Wave A modules.
- Writing a whole-folder recommendation for `ringcentral`.
