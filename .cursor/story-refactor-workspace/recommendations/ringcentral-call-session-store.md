# Load Every Party On This Telephony Session, Ask Already-Recommended Collapse To Stamp Leftover Ingest Only When Qualified And Over, Persist That Session, Then Append A Quieter Trail Only When The Decision Status Changed — Never Ingest, Never Collapse, Never Fold A Party Event, Never Create A Call Lead, Never Capture The Raw Webhook, Never Read Call Log — operational story

- Status: recommended
- Service: `ringcentral` (Wave A, in-progress)
- Pass: 4 of this service — `call-session-store.ts`
- Remaining in this service: `webhook-capture.ts`, `webhook-subscriptions.ts`, `ringcentral-call-lead-ingest.service.ts`, `ringcentral-duplicate-guard.ts`, `callLeadConvergence.service.ts`, `shadow-call-leads-store.ts`, `processed-calls-store.ts`, `call-log-sync.service.ts`, `call-log-sync-state.store.ts`, `call-log-vetting.ts`, `analytics-reconcile.service.ts`, `auth.ts`
- Target: `src/services/ringcentral/call-session-store.ts`
- Knowledge: [`docs/knowledge/services/ringcentral-call-lead-qualification.md`](../../../docs/knowledge/services/ringcentral-call-lead-qualification.md) (section 2 step 3: for each touched `telephonySessionId` — `processRingCentralCallSession` → already-recommended `aggregateRingCentralCallSession`; webhook ingest requires **qualified + terminal**; related-modules row: “session aggregate persistence + `processRingCentralCallSession`”; pipeline drawing skips this file as its own box and jumps collapse → leftover ingest). Distinct from already-recommended collapse: [recommendations/ringcentral-call-session-aggregator.md](ringcentral-call-session-aggregator.md) (pure; this file **asks** it after already-recommended find-by-session, persists `document`, ignores returned `decision`). Distinct from already-recommended party persist: [recommendations/ringcentral-call-candidate-store.md](ringcentral-call-candidate-store.md) (folds one party, appends a decision **every tick**; this file **asks** find-by-session, then appends a quieter trail only on a **status transition**). Distinct from already-recommended evaluate: [recommendations/ringcentral-call-candidate-evaluator.md](ringcentral-call-candidate-evaluator.md) (this file never **asks** evaluate; already-recommended collapse does). Distinct from leftover ingest: `ringcentral-call-lead-ingest.service.ts` (the only promotion gate — Wave B `ingestSessionLead` **asks** leftover ingest when this file’s `document.ingestEligible`). Distinct from leftover capture / leftover subscriptions / leftover Call Log vet / leftover cron / leftover analytics / leftover seed. Distinct from leftover `ringcentral-mongo.ts` (`getRingCentralDb` — this file **asks** it; already-recommended party persist still inlines). Distinct from leftover `ringcentral-config.ts` (`ringcentral_call_sessions` / `ringcentral_call_session_decisions` plus the `_test` suffix unless leftover config turns that suffix off). Distinct from skipped `call-session-types.ts` (the session bag + quieter-trail bag + `ingestEligible`). Distinct from leftover `domainCommands/ringcentralProvenance.ts` (**asks** `findRingCentralCallSession` only for the webhook connection key; Call Log provenance never **asks** this file). Distinct from Wave B `POST /api/webhooks/ringcentral` (capture always; this file only when webhook processing is on **and** `MONGO_URI` is set). This checkout’s `CONTEXT.md` does not define Call Qualification / Call Lead Ingestion / Caller Match Key — the knowledge file links a parent glossary this tree does not ship. Do not invent a glossary copy. `docs/adr/` is absent here — do not invent an ADR copy. Do not add this path to knowledge in this rename.
- Callers: **Wave B webhook processing + Wave B debug reads, leftover provenance, no file test.** Wave B `ringcentral-webhook.routes.ts` — `processSessionsAndIngest` **asks** `processRingCentralCallSession` then leftover ingest when `document.ingestEligible`; debug `GET /api/dev/ringcentral/call-sessions` / `call-session-decisions` **ask** the two lists; debug `GET .../call-candidates/:telephonySessionId` **asks** find. Leftover `domainCommands/ringcentralProvenance.ts` — `verifyTrustedRingCentralTelephonyProvenance` **asks** find only when the connection is `ringcentral:webhook:${id}` (Call Log `ringcentral:call_log_sync:${id}` returns true without this file). Leftover `callLeadConvergence.replica.test.ts` writes the sessions collection directly — not this **interface**. Not this **interface**: leftover ingest, already-recommended collapse, already-recommended party persist, leftover capture, leftover seed, leftover Call Log vet, Wave B `ingestSessionLead`.
- Seams callers need: find-parties-then-collapse-then-persist (empty parties return null **before** already-recommended collapse, which would throw); quieter trail only on `decisionStatus` change vs already-recommended party persist’s every-tick trail; `document.ingestEligible` vs leftover ingest (this file never promotes); find-for-webhook-provenance vs Call Log connection key (no session lookup); debug list hides `leadPreview` vs find returns the whole document
- Split later (only if the file outgrows one sitting): this ~195-line file is one sitting if you read it as load every party on this telephony session, ask already-recommended collapse to stamp leftover ingest only when qualified and over, persist that session, then append a quieter trail only when the decision status changed; never ingest, never collapse, never fold a party event, never create a Call Lead, never capture the raw webhook, never read Call Log. If it later splits: `loadEveryPartyThenAskAlreadyRecommendedCollapseAndPersistTheSession.ts` / `appendAQuieterTrailOnlyWhenTheDecisionStatusChanged.ts` / `handWaveBAndLeftoverProvenanceThePersistedSession.ts` — story files, never `create.ts` / `update.ts` / `delete.ts` / `process.ts` / `store.ts`, and never merge already-recommended collapse, already-recommended party persist, leftover ingest, leftover capture, leftover Call Log vet, leftover provenance, or Wave B `ingestSessionLead` into this file

`processRingCentralCallSession` / `recordSessionDecision` / `findRingCentralCallSession` are executor mechanics. The owner question is: *Every party on this inbound call has already been folded and stamped. Load those parties. If there are none, stop — do not invent a session, do not ingest. Ask already-recommended collapse: pick which party is the call, trust the answered agent’s hangup when the queue disconnects early, and say whether leftover ingest may run (qualified AND the session is over). Persist that collapsed session. If the decision status changed — candidate to pending_buffer to qualified, or a reject — append one quieter trail row. Hand Wave B the document so leftover ingest may run only when `ingestEligible`. A live two-minute qualify that later hangs up stays `qualified`; the trail does not fire again, but the document now says leftover ingest may run. Do not ingest. Do not collapse. Do not fold a party. Do not create a Call Lead. Do not capture the raw webhook. Do not open Call Log.*

Already-recommended collapse, already-recommended party persist, already-recommended evaluate, leftover ingest, leftover capture, leftover Call Log vet, leftover provenance, leftover mongo helper, leftover config names, skipped types, and Wave B webhook HTTP already live in other **modules**. Do not pull those in.

## What this file actually does

Three operations of one “load every party on this telephony session, ask already-recommended collapse to stamp leftover ingest only when qualified and over, persist that session, then append a quieter trail only when the decision status changed — never ingest, never collapse, never fold a party event, never create a Call Lead, never capture the raw webhook, never read Call Log” story, not “a session CRUD store,” and not leftover ingest / already-recommended collapse:

1. **Load every party, ask already-recommended collapse, persist the collapsed session** — `processRingCentralCallSession(telephonySessionId, now)`. **Asks** already-recommended `findRingCentralCallCandidatesByTelephonySessionId`. Empty → `null` (Wave B continues; leftover ingest never runs). **Asks** already-recommended `aggregateRingCentralCallSession(parties, now)` and keeps `document` only — returned `decision` is discarded because the document already copies leftover evaluate’s status / reason / preview / `wouldCreateCallLead` plus already-recommended collapse’s `ingestEligible`. Load the previous session by unique `{ provider: "ringcentral", telephonySessionId }`. `$setOnInsert` identity + `createdAt`. `$set` the rest, including `firstSeenAt`, clocks, route, `ingestEligible`, and `leadPreview`. Unique index on that key. Return `{ document, previousStatus, statusChanged }` so Wave B can leftover-ingest when `document.ingestEligible`. This beat does **not** insert the quieter trail. This beat does **not** ingest. This beat does **not** collapse.

2. **Append a quieter trail only when the decision status changed** — private `recordSessionDecision`. Insert one `ringcentral_call_session_decisions` row only when `previousStatus !== document.decisionStatus` (first persist counts: `previousStatus` is `null`). Copies status / reason / `wouldCreateCallLead` / `ingestEligible` / duration / canonical party plus `previousDecisionStatus`. Not every webhook tick — already-recommended party persist owns that louder trail. This beat does **not** update the session. This beat does **not** compare `ingestEligible`.

3. **Hand Wave B leftover ingest and leftover provenance the persisted session** — the return of process (Wave B leftover ingest **asks** `document.ingestEligible`, not `statusChanged`) plus `findRingCentralCallSession`. Leftover provenance **asks** find only for `ringcentral:webhook:${id}` and requires the stored `telephonySessionId` to match. Call Log `ringcentral:call_log_sync:${id}` never **asks** this file.

There is no ingest operation. There is no collapse operation. There is no party-event fold. There is no Call Lead write. There is no raw-webhook capture. There is no Call Log read. Wave B `ingestSessionLead` is the webhook **adapter** that reads `ingestEligible`. Leftover `ingestRingCentralQualifiedCall` is the only promotion gate. Already-recommended collapse is the file that stamps `ingestEligible`.

`listRingCentralCallSessions` / `listRingCentralCallSessionDecisions` sit on the debug board (`GET /api/dev/ringcentral/call-sessions` hides `leadPreview`; decisions are newest `createdAt`). They are not extra owner operations. Do not invent a dashboard for them in this rename. Collection names come from leftover config (`callSessions` / `callSessionDecisions`) at call time, not a snapshot constant.

## Organization

Keep one file as the screenplay for “load every party on this telephony session, ask already-recommended collapse to stamp leftover ingest only when qualified and over, persist that session, then append a quieter trail only when the decision status changed — never ingest, never collapse, never fold a party event, never create a Call Lead, never capture the raw webhook, never read Call Log.” Already-recommended collapse, already-recommended party persist, leftover ingest, leftover capture, leftover Call Log vet, leftover provenance, leftover mongo helper, leftover config names, skipped types, and Wave B webhook HTTP already live in deeper **modules**. Do not pull those in. Do not invent a `CallSessionStoreService` class. Do not invent a begin / complete **seam** — this file’s write is one upsert plus an optional trail insert, not a command transaction. Do not invent an ingest **adapter** beside leftover `ingestRingCentralQualifiedCall`. Do not invent a collapse **adapter** beside already-recommended `aggregateRingCentralCallSession`. Do not invent a Call Log **adapter** beside leftover vetting.

Do not split this into `create.ts` / `update.ts` / `delete.ts` / `process.ts` / `store.ts`. Those are persistence verbs, not the owner story. Do not move collapse into this file so “session can load and decide in one file.” Do not move leftover `ingestEligible` into already-recommended evaluate so “one function owns qualify and ingest.” Do not move find-by-session into this file so “session can load its own parties.” Do not silently leftover-ingest inside process so “one write owns persist and promote.” Do not silently append the quieter trail on every tick so “both trails match.” Do not silently trail `ingestEligible` so “the trail names every leftover ingest” without a paired Wave B test.

**External interface** stays small (this is the test surface). Load-and-persist, quieter-trail, and hand-the-session are one story’s session operational state, not three CRUD verbs:

| Keep exporting | Story name | Why the seam exists |
|---|---|---|
| `processRingCentralCallSession` | `loadEveryPartyThenAskAlreadyRecommendedCollapseAndPersistTheSession` | Wave B persist after already-recommended party persist; empty parties return null **before** collapse |
| `findRingCentralCallSession` | `handWaveBAndLeftoverProvenanceThePersistedSession` | Wave B debug session page + leftover webhook provenance |
| `listRingCentralCallSessions` | `showRecentSessionsWithoutTheLeadPreview` | Wave B debug list |
| `listRingCentralCallSessionDecisions` | `showRecentSessionStatusChanges` | Wave B debug quieter trail |
| `ProcessRingCentralSessionResult` | `PersistedSessionAndWhetherTheStatusChanged` | the handoff Wave B leftover-ingests from `document.ingestEligible` |

Keep the old names as one-line aliases until Wave B webhook processing, leftover provenance, and any later file test migrate. Do not make callers learn `findOne` / `updateOne` / `$setOnInsert` / `statusChanged` as the domain language.

**Principle: old exports stay as aliases.** `processRingCentralCallSession` remains the imported name until Wave B persist migrates. `findRingCentralCallSession` remains the imported name until leftover provenance and Wave B debug migrate.

**No class for the workflow.** The type that *does* earn a name is the bag process already returns, plus the quieter-trail rule the file comment already names:

```ts
type PersistedSessionAndWhetherTheStatusChanged = {
  document: RingCentralCallSessionDocument  // includes ingestEligible
  previousStatus: RingCentralDecisionStatus | null
  statusChanged: boolean                    // decisionStatus only; not ingestEligible
}

type QuieterTrailOnlyOnStatusChange = {
  previousStatus: RingCentralDecisionStatus | null
  nextStatus: RingCentralDecisionStatus
  append: boolean  // previousStatus !== nextStatus
}
```

That is the handoff from “we persisted this collapsed session” to “Wave B may leftover-ingest only when `document.ingestEligible`; leftover provenance may verify the webhook session exists.” Do **not** add `callLogId` so “this file can replace leftover Call Log vet,” do **not** add `writeMode` so “this file can replace leftover ingest,” and do **not** add `upsertParty` so “this file can replace already-recommended party persist.”

Do not add `aggregateRingCentralCallSession` as a public story **seam** on this file — already-recommended collapse already owns that export. Do not add `findRingCentralCallCandidatesByTelephonySessionId` as a public **seam** — already-recommended party persist already owns that. Do not add `ingestRingCentralQualifiedCall` as a public **seam** — leftover ingest already owns that. Do not export `recordSessionDecision` as a public **seam** — it exists so the parent reads. Do not promote leftover config collection keys to owner **seams** in this rename.

## The file, as a story

Parent functions stay deep. Child names are only extracted when they hide a real decision, not a one-liner.

```ts
// call-session-store.ts
// Every party on this inbound call has already been folded and stamped.
// Load those parties. Ask already-recommended collapse
// whether leftover ingest may run (qualified AND over).
// Persist that collapsed session.
// Append a quieter trail only when the decision status changed.
// A live two-minute qualify that later hangs up stays qualified —
// the trail stays quiet; the document now says leftover ingest may run.
// Do not ingest. Do not collapse. Do not fold a party. Do not create a Call Lead.

// ── 1. Load every party, ask already-recommended collapse, persist ─

export async function loadEveryPartyThenAskAlreadyRecommendedCollapseAndPersistTheSession(
  telephonySessionId,
  now = new Date(),
)

async function loadEveryPartyOnThisTelephonySession(telephonySessionId)
function stopIfThereAreNoParties(parties)              // null; collapse would throw
function askAlreadyRecommendedCollapse(parties, now)   // keep document; ignore decision
async function loadTheSessionWeAlreadyHave(telephonySessionId)
function sayWhetherTheDecisionStatusChanged(previous, document)
async function writeTheCollapsedSession(document)      // $setOnInsert identity + createdAt

// ── 2. Append a quieter trail only when the decision status changed ─

async function appendAQuieterTrailOnlyWhenTheDecisionStatusChanged(
  document,
  previousStatus,
)

function thisIsNotEveryTick(previousStatus, nextStatus)  // first persist counts (null)

// ── 3. Hand Wave B leftover ingest and leftover provenance the session ─

export async function handWaveBAndLeftoverProvenanceThePersistedSession(
  telephonySessionId,
)

export async function showRecentSessionsWithoutTheLeadPreview(limit)
export async function showRecentSessionStatusChanges(limit)
```

Read the primary path out loud: *Load every party already-recommended party persist has for this telephony session. If there are none, stop. Ask already-recommended collapse to pick which party is the call, trust the answered agent’s hangup, and stamp leftover ingest only when qualified and over. Persist that collapsed session. If the decision status changed, append one quieter trail row. Hand Wave B the document — leftover ingest may run only when `ingestEligible`. A live two-minute qualify stays a qualify and is not ingest-eligible until hangup; hangup that keeps `qualified` does not append another trail row. Do not ingest here. Do not collapse here. Do not fold a party. Do not create a Call Lead.*

That is the operation. `processRingCentralCallSession` is not.

## Precise logic I would tighten while renaming

These are real smells the story names make obvious. Do not “just rename.”

1. **Knowledge draws process → aggregate, then leftover ingest. Persist and the quieter trail are this file.** The pipeline box is “aggregate → ingest when qualified + terminal.” Wave B **asks** this file, then leftover ingest when `document.ingestEligible`. Do not delete persist so “the diagram becomes true.” Do not leftover-ingest here so “one function owns persist and promote.” Keep knowledge’s leftover-ingest order. Do not add this path to knowledge in this rename.

2. **This file ignores already-recommended collapse’s returned `decision`.** The document already copies leftover evaluate’s status / reason / preview / `wouldCreateCallLead`. Keep the bag as the leftover type until leftover persist migrates. Do not drop `decision` at the collapse **seam** so “one object owns the handoff” without a paired compile of this file.

3. **The quieter trail is `decisionStatus` only. Live `qualified` → hung-up `qualified` does not append.** Already-recommended collapse may qualify a live call (`wouldCreateCallLead: true`, `terminal: false`, `ingestEligible: false`). Hangup keeps `qualified` and flips `ingestEligible`. `statusChanged` is false. Wave B leftover-ingests from the document anyway. The file comment says the trail is compact and meaningful. Do not silently trail `ingestEligible` so “every leftover ingest has a row” without a paired Wave B test. Do not silently leftover-ingest only when `statusChanged` so “the trail owns the gate.”

4. **Already-recommended party persist appends every tick. This file does not.** The leftover party-store comment names that contrast. Do not silently gate the party trail on status change so “both trails match.” Do not move this quieter insert into already-recommended party persist so “one store owns both trails.”

5. **Empty parties return null here. Already-recommended collapse throws.** Wave B never **asks** collapse with `[]`. Do not call collapse on empty so “one error owns missing.” Do not persist a rejected document so “empty is just not a lead.”

6. **Find-then-upsert can race.** Unique `{ provider, telephonySessionId }` is created at runtime. Two concurrent webhooks for the same session can each load a stale `previousStatus` and both append a quieter row, or both think the status changed. Do not silently switch to `findOneAndUpdate` so “one write owns the trail” in this rename — collapse is JavaScript, not a Mongo pipeline. Leave the race. Do not drop the unique index.

7. **Indexes bootstrap at runtime.** Leftover Call Log sync state **fails closed** when its unique index is missing. This file creates session + quieter-trail indexes on first use. Do not silently fail-closed this store so “every RingCentral store matches.”

8. **`createdAt` is `$setOnInsert`. `firstSeenAt` is `$set`.** Already-recommended collapse recomputes `firstSeenAt` as the earliest party each time, so a late-arriving older party can move `firstSeenAt` earlier on a later persist. `createdAt` stays the first insert. Do not silently `$setOnInsert` `firstSeenAt` so “first persist owns the clock” without a paired late-party test.

9. **Debug list hides `leadPreview`. Find does not.** Leftover provenance and Wave B debug session page need the whole document. Do not strip `leadPreview` from find so “debug and provenance match.”

10. **Leftover provenance **asks** this file only for the webhook connection key.** Call Log `ringcentral:call_log_sync:${id}` returns true without a session row — leftover ingest’s Call Log path never writes one. Do not silently require a session for Call Log provenance so “one lookup owns both origins.” Prove leftover provenance on leftover `domainCommands`; this **seam** only has to return the webhook session.

11. **This file **asks** leftover `getRingCentralDb`. Already-recommended party persist still inlines.** Do not silently switch the party store so “one mongo accessor” without a paired collection-mode test. Do not snapshot collection names at import the way the party store’s lying `*_TEST_COLLECTION` constants do.

12. **`statusChanged` is Wave B log / response only.** Leftover ingest’s gate is `document.ingestEligible`. Do not make Wave B wait for `statusChanged` so “we ingest only on a transition.”

13. **There is no file test on this interface.** Already-recommended collapse’s five named collapses prove collapse, not persist. Leftover convergence replica writes the sessions collection directly. Mongo / quieter-trail / empty-parties / live-qualify-then-hangup have **no** proof on this **interface**.

14. **Leave sibling modules alone.** Already-recommended collapse, already-recommended party persist’s find-by-session, leftover ingest, leftover capture, leftover Call Log vet, leftover provenance, leftover seed, and Wave B `ingestSessionLead` already live at the right **depth**. This file orchestrates already-recommended find-by-session and already-recommended collapse only.

## Testing

The **interface** is the test surface: `loadEveryPartyThenAskAlreadyRecommendedCollapseAndPersistTheSession`, `handWaveBAndLeftoverProvenanceThePersistedSession`.

There is no `call-session-store.test.ts`. Already-recommended `call-session-aggregator.test.ts` names the five owner collapses and must stay on that file. Do not treat leftover ingest, leftover capture, leftover provenance, or already-recommended collapse as this file’s proof.

Add tests that name the operation:

**Load every party, ask already-recommended collapse, persist the collapsed session**
- Parties present → persist `document` whose `ingestEligible` is already-recommended collapse’s (`wouldCreateCallLead && terminal`).
- Empty parties → `null`. No session row. No quieter-trail row. This beat never **asks** collapse.
- First persist: `previousStatus` is `null`, `statusChanged` is true, unique key is `provider + telephonySessionId`.
- Repeated same `decisionStatus` → upsert, `statusChanged` false, no quieter-trail insert.
- `createdAt` stays the first insert. `firstSeenAt` follows already-recommended collapse’s earliest party (today’s `$set`).
- This beat never returns a Call Lead id. This beat never **asks** leftover ingest.
- Returned `decision` from collapse is not part of this **interface**.

**Append a quieter trail only when the decision status changed**
- `candidate` → `pending_buffer` → `qualified` each insert one quieter row with `previousDecisionStatus`.
- Live `qualified` (`ingestEligible: false`) then hangup still `qualified` (`ingestEligible: true`) → **no** quieter row, `statusChanged: false`, document now `ingestEligible: true`.
- First persist from `null` inserts one row.
- The row copies `ingestEligible` / duration / canonical party as a snapshot, not as the append gate.

**Hand Wave B leftover ingest and leftover provenance the persisted session**
- Find returns the whole document including `leadPreview`.
- Debug list hides `leadPreview`; this **seam** does not.
- Missing session → `null` (leftover webhook provenance then fails; prove leftover provenance on leftover `domainCommands`).
- Call Log connection key must not appear as this file’s proof.

Do **not** add a test per helper (`stopIfThereAreNoParties`, `thisIsNotEveryTick`). Those names exist so the parent reads. If a helper test has to change when the helper is inlined, it was testing past the **interface**.

Do **not** add leftover ingest, already-recommended collapse, leftover capture, leftover seed, leftover Call Log vet, leftover provenance, or Wave B `ingestSessionLead` as this file’s proof. Already-recommended collapse tests stay on already-recommended collapse — they do not own persist. Wave B leftover ingest tests stay on leftover ingest — they **ask** `ingestEligible`; they do not own the quieter trail.

## What I would not do

- A `CallSessionStoreService` class with `create` / `update` / `delete`.
- Thirty two-line functions that only wrap an existing call.
- Moving this into a CRUD folder (`process.ts` / `find.ts` / `store.ts`) “for cleanliness.”
- Breaking Wave B’s persist-then-`ingestEligible` **seam**, already-recommended collapse’s find-then-collapse **seam**, or leftover provenance’s webhook-session **seam**.
- Treating leftover `ingestRingCentralQualifiedCall`, already-recommended `aggregateRingCentralCallSession`, leftover `captureRingCentralWebhookEvent`, or leftover `vetRingCentralCallLogRecord` as this story. Those are different **adapters**.
- Inventing an ingest **seam** that has only one **adapter** (this file never promotes a Call Lead).
- Silently leftover-ingesting inside process, silently appending the quieter trail on every tick, silently trailing `ingestEligible`, or silently requiring a session for Call Log provenance, while recommending a rename.
- Jumping to leftover capture while this service still has unchecked Wave A modules.
- Writing a whole-folder recommendation for `ringcentral`.
