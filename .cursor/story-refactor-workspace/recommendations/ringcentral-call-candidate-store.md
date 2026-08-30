# Fold This Party Event Onto The Existing Per-Party Candidate — Keep The First Answer Time Even If Hangup Or A Delayed Older Answered Arrives, Mark Hangup From The Six Terminal Codes, Ask Already-Recommended Evaluate Whether It Has Answered Two Minutes, Persist The Party Snapshot, Then Append A Decision Row Every Tick — Never Ingest, Never Collapse The Session, Never Create A Call Lead, Never Capture The Raw Webhook, Never Normalize The Payload, Never Resolve The Inbound Route — operational story

- Status: recommended
- Service: `ringcentral` (Wave A, in-progress)
- Pass: 2 of this service — `call-candidate-store.ts`
- Remaining in this service: `call-session-aggregator.ts`, `call-session-store.ts`, `webhook-capture.ts`, `webhook-subscriptions.ts`, `ringcentral-call-lead-ingest.service.ts`, `ringcentral-duplicate-guard.ts`, `callLeadConvergence.service.ts`, `shadow-call-leads-store.ts`, `processed-calls-store.ts`, `call-log-sync.service.ts`, `call-log-sync-state.store.ts`, `call-log-vetting.ts`, `analytics-reconcile.service.ts`, `auth.ts`
- Target: `src/services/ringcentral/call-candidate-store.ts`
- Knowledge: [`docs/knowledge/services/ringcentral-call-lead-qualification.md`](../../../docs/knowledge/services/ringcentral-call-lead-qualification.md) (section 2 / related-modules row: per-party candidate upsert + decision persistence; pipeline drawing says normalize → upsert → evaluate → aggregate → ingest when qualified + terminal; webhook candidates are operational state until leftover session is terminal + leftover ingest). Distinct from already-recommended evaluate: [recommendations/ringcentral-call-candidate-evaluator.md](ringcentral-call-candidate-evaluator.md) (pure five-status decide; this file **asks** evaluate + duration + hangup codes **after** the fold, then writes the decision onto the party). Distinct from leftover payload fold: `webhook-event-normalizer.ts` (`targetMatched` is still false there; Wave B enrich stamps route **before** this file). Distinct from leftover session collapse: `call-session-aggregator.ts` (picks a canonical party from the rows this file already persisted; **asks** already-recommended evaluate again; sets leftover `ingestEligible`). Distinct from leftover session persist: `call-session-store.ts` (**asks** this file’s find-by-session, then leftover aggregator; session decisions only on a **status transition**). Distinct from leftover raw capture: `webhook-capture.ts` (always, even when processing is off). Distinct from leftover ingest: `ringcentral-call-lead-ingest.service.ts` (the only promotion gate). Distinct from leftover Call Log vet / leftover cron / leftover analytics. Distinct from leftover seed: `call-lead-sources.ts` (runtime must not import it). Distinct from leftover `ringcentral-mongo.ts` (`getRingCentralDb` — leftover session / processed / sync / shadow **ask** it; this file inlines `connectMongo` + `useDb` three times). Distinct from leftover `ringcentral-config.ts` (collection names + `_test` suffix). Distinct from skipped `call-candidate-types.ts` (the document bags). Distinct from Wave B `POST /api/webhooks/ringcentral` (capture always; this file only when webhook processing is on **and** `MONGO_URI` is set). This checkout’s `CONTEXT.md` does not define Call Qualification / Call Lead Ingestion — the knowledge file links a parent glossary this tree does not ship. Do not invent a glossary copy. `docs/adr/` is absent here — do not invent an ADR copy. Do not add this path to knowledge in this rename.
- Callers: **Wave B webhook processing + Wave B debug reads, leftover session persist, one leftover file test.** Wave B `ringcentral-webhook.routes.ts` — `processCandidateUpdates` **asks** `upsertRingCentralCallCandidateFromEvent` then `storeRingCentralCallCandidateDecision` per enriched party; debug `GET /api/dev/ringcentral/call-candidates` / `call-candidate-decisions` / `call-candidates/:telephonySessionId` **ask** the two lists and find-by-session. Leftover `call-session-store.ts` — `processRingCentralCallSession` **asks** find-by-session, then leftover aggregator. Test: `call-candidate.test.ts` — `buildRingCentralCandidateDocument` for the delayed-Answered-after-Disconnect fold only (the rest of that file is already-recommended evaluate + leftover normalizer + leftover seed + leftover phone fold). Not this **interface**: leftover ingest, leftover aggregator, leftover capture, leftover seed, leftover Call Log vet, Wave B enrich / leftover ingest-after-session.
- Seams callers need: fold-without-Mongo vs persist-after-evaluate (tests and the comment’s offline harness **ask** the fold; Wave B persist **asks** upsert, which folds then evaluate then `$set`); append-every-tick decision vs leftover session store’s status-transition-only trail (Wave B calls both **seams** in order; this file never decides when to append); find-by-session (includes `rawLatestParty`) vs debug list (hides it); unique party key `provider + telephonySessionId + partyId`
- Split later (only if the file outgrows one sitting): this ~395-line file is one sitting if you read it as fold this party event onto the existing per-party candidate — keep the first answer time even if hangup or a delayed older Answered arrives, mark hangup from the six terminal codes, ask already-recommended evaluate whether it has answered two minutes, persist the party snapshot, then append a decision row every tick; never ingest, never collapse the session, never create a Call Lead, never capture the raw webhook, never normalize the payload, never resolve the inbound route. If it later splits: `foldThisPartyEventOntoTheExistingPerPartyCandidate.ts` / `rememberTheFoldedPartyAndStampTheQualification.ts` / `appendThisTicksDecision.ts` / `handLeftoverSessionEveryPartyOnThisTelephonySession.ts` — story files, never `create.ts` / `update.ts` / `delete.ts` / `upsert.ts` / `store.ts`, and never merge already-recommended evaluate, leftover aggregator, leftover session persist, leftover ingest, leftover capture, leftover normalizer, or Wave B enrich into this file

`upsertRingCentralCallCandidateFromEvent` / `storeRingCentralCallCandidateDecision` / `buildRingCentralCandidateDocument` are executor mechanics. The owner question is: *A normalized, route-enriched party event just arrived. Fold it onto the existing per-party candidate for this telephony session and this party — or start one. If we have already seen Answered, keep that. If a delayed older Answered arrives after hangup, still stamp answered and keep the earlier answer time, but do not rewind the hangup status. If this event is one of the six hangup codes, mark the party over. Then ask already-recommended evaluate: has this inbound party on a mapped number answered for two minutes? Persist the folded snapshot with duration and that decision. Then write an append-only decision row for this tick. Later, leftover session collapse will ask for every party on this telephony session. Do not ingest. Do not collapse the session. Do not create a Call Lead. Do not capture the raw webhook. Do not normalize the payload. Do not resolve the inbound route.*

Already-recommended evaluate, leftover normalizer, leftover session collapse, leftover session persist, leftover capture, leftover ingest, leftover Call Log vet, leftover seed, leftover mongo helper, and Wave B webhook HTTP already live in other **modules**. Do not pull those in.

## What this file actually does

Four operations of one “fold this party event onto the existing per-party candidate — keep the first answer time even if hangup or a delayed older Answered arrives, mark hangup from the six terminal codes, ask already-recommended evaluate whether it has answered two minutes, persist the party snapshot, then append a decision row every tick — never ingest, never collapse the session, never create a Call Lead, never capture the raw webhook, never normalize the payload, never resolve the inbound route” story, not “a candidate CRUD store,” and not leftover ingest / leftover session collapse:

1. **Fold this party event onto the existing per-party candidate** — `buildRingCentralCandidateDocument` / private `buildCandidateDocument`. Pure. No Mongo. No evaluate. Sequence older than `lastSequence` does **not** overwrite latest status / phones / raw party; a null sequence on either side is treated as “use this event.” `answered` is sticky (`existing.answered || status === "Answered"`). `answeredAt` is the earliest Answered observation. Hangup is leftover `isLikelyTerminalRingCentralStatus` — `terminal` is sticky; `terminalAt` is the latest hangup observation. `targetMatched` / first `sourceLabel` / first `sourceCompany` / first `routeResolution` stick. `queueCall` stays true once true. `lastSeenAt` always moves to `receivedAt`. `firstSeenAt` never moves. Duration and decision on the fold are leftovers (`existing.estimatedDurationSeconds` or null; `existing.decisionStatus` or `targetMatched ? "candidate" : "not_candidate"`). Upsert overwrites both after evaluate. This beat does **not** persist. This beat does **not** decide qualify.

2. **Remember the folded party and stamp leftover evaluate’s decision** — `upsertRingCentralCallCandidateFromEvent(event, now)`. Load the unique party (`provider + telephonySessionId + partyId`). Fold. Ask already-recommended evaluate. Stamp `estimatedDurationSeconds` from leftover `countAnsweredSecondsUntilHangupOrNow`. `$setOnInsert` identity + `firstSeenAt` / `createdAt`. `$set` the rest, including decision. Unique index on the party key. Return `{ candidate, decision }` so Wave B can append the trail and leftover session can run later. This beat does **not** insert the decision trail. This beat does **not** ingest. This beat does **not** collapse the session.

3. **Append this tick’s decision** — `storeRingCentralCallCandidateDecision(candidate, decision)`. Insert one `ringcentral_call_candidate_decisions` row every time Wave B **asks**. Not a status-transition filter — leftover session persist owns that quieter trail. This beat does **not** update the party. This beat does **not** decide whether the status changed.

4. **Hand leftover session collapse every party on this telephony session** — `findRingCentralCallCandidatesByTelephonySessionId`. Newest `updatedAt` first. Includes `rawLatestParty`. Leftover `processRingCentralCallSession` **asks** this, then leftover aggregator. Empty → leftover session persist returns null (no ingest). Debug `GET .../call-candidates/:telephonySessionId` **asks** the same **seam**.

There is no ingest operation. There is no session-collapse operation. There is no Call Lead write. There is no raw-webhook capture. There is no payload normalize. There is no inbound-route resolve. Wave B enrich stamps `targetMatched` / source / route **before** this file. Leftover `ingestRingCentralQualifiedCall` is the only promotion gate. Leftover aggregator is the file that sets `ingestEligible`.

`listRingCentralCallCandidates` / `listRingCentralCallCandidateDecisions` sit on the debug board (`GET /api/dev/ringcentral/call-candidates` hides `rawLatestParty`; decisions are newest `createdAt`). They are not extra owner operations. Do not invent a dashboard for them in this rename. `CALL_CANDIDATES_TEST_COLLECTION` / `CALL_CANDIDATE_DECISIONS_TEST_COLLECTION` are leftover config names (default `_test` suffix unless leftover config turns that suffix off). They are not owner operations. The comment’s “workflow test harness” has **no** script import of the fold in this checkout — only `call-candidate.test.ts` **asks** it.

## Organization

Keep one file as the screenplay for “fold this party event onto the existing per-party candidate — keep the first answer time even if hangup or a delayed older Answered arrives, mark hangup from the six terminal codes, ask already-recommended evaluate whether it has answered two minutes, persist the party snapshot, then append a decision row every tick — never ingest, never collapse the session, never create a Call Lead, never capture the raw webhook, never normalize the payload, never resolve the inbound route.” Already-recommended evaluate, leftover normalizer, leftover aggregator, leftover session persist, leftover capture, leftover ingest, leftover Call Log vet, leftover mongo helper, leftover config names, skipped types, and Wave B webhook HTTP already live in deeper **modules**. Do not pull those in. Do not invent a `CallCandidateStoreService` class. Do not invent a begin / complete **seam** — this file’s write is one upsert, not a command transaction. Do not invent an ingest **adapter** beside leftover `ingestRingCentralQualifiedCall`. Do not invent a session-collapse **adapter** beside leftover aggregator. Do not invent a route-resolve **adapter** beside Wave B enrich.

Do not split this into `create.ts` / `update.ts` / `delete.ts` / `upsert.ts` / `store.ts`. Those are persistence verbs, not the owner story. Do not move the fold into already-recommended evaluate so “one file owns qualify and persist.” Do not move evaluate into this file so “upsert is self-contained.” Do not move find-by-session into leftover session persist so “session can load its own parties.” Do not silently skip evaluate when the party is still `pending_buffer`. Do not silently require `terminal` before persist so “webhooks cannot remember a live party.” Do not silently append the decision trail inside upsert so “one write owns both” without a paired Wave B test that every tick still inserts.

**External interface** stays small (this is the test surface). Fold, remember-and-stamp, append-every-tick, and hand-the-session-the-parties are one story’s per-party operational state, not four CRUD verbs:

| Keep exporting | Story name | Why the seam exists |
|---|---|---|
| `buildRingCentralCandidateDocument` | `foldThisPartyEventOntoTheExistingPerPartyCandidate` | leftover file test (and the comment’s offline harness) replay without Mongo |
| `upsertRingCentralCallCandidateFromEvent` | `rememberTheFoldedPartyAndStampTheQualification` | Wave B persist after enrich |
| `storeRingCentralCallCandidateDecision` | `appendThisTicksDecision` | Wave B writes the trail **after** upsert; this file never filters transitions |
| `findRingCentralCallCandidatesByTelephonySessionId` | `handLeftoverSessionEveryPartyOnThisTelephonySession` | leftover session persist + Wave B debug session page |
| `listRingCentralCallCandidates` | `showRecentPartiesWithoutTheRawParty` | Wave B debug list |
| `listRingCentralCallCandidateDecisions` | `showRecentPartyDecisions` | Wave B debug trail |
| `CALL_CANDIDATES_TEST_COLLECTION` | `thePartyCollectionName` | leftover config snapshot at import |
| `CALL_CANDIDATE_DECISIONS_TEST_COLLECTION` | `thePartyDecisionCollectionName` | leftover config snapshot at import |
| `CandidateUpdateResult` | `FoldedPartyAndQualification` | the handoff Wave B appends, then leftover session **asks** find-by-session |

Keep the old names as one-line aliases until Wave B webhook processing, leftover session persist, and `call-candidate.test.ts` migrate. Do not make callers learn `findOne` / `updateOne` / `$setOnInsert` / `not_candidate` as the domain language.

**Principle: old exports stay as aliases.** `upsertRingCentralCallCandidateFromEvent` remains the imported name until Wave B persist migrates. `storeRingCentralCallCandidateDecision` remains the imported name until Wave B trail migrates. `findRingCentralCallCandidatesByTelephonySessionId` remains the imported name until leftover session persist migrates. `buildRingCentralCandidateDocument` remains the imported name until the leftover file test migrates.

**No class for the workflow.** The type that *does* earn a name is the bag upsert already returns:

```ts
type FoldedPartyAndQualification = {
  candidate: RingCentralCallCandidateDocument
  decision: CandidateDecision
}
```

That is the handoff from “we remembered this party and asked already-recommended evaluate” to “Wave B may append this tick, leftover session persist may later load every party on the telephony session.” Do **not** add `ingestEligible` so “this file can replace leftover aggregator,” do **not** add `callLogId` so “this file can replace leftover Call Log vet,” and do **not** add `writeMode` so “this file can replace leftover ingest.”

`listRingCentralCallCandidates` / `listRingCentralCallCandidateDecisions` stay exported because Wave B debug **asks** them. They are not extra owner operations. Do not add `evaluateRingCentralCallCandidate` as a public story **seam** on this file — already-recommended evaluate already owns that export. Do not add `processRingCentralCallSession` as a public **seam** — leftover session persist already owns that. Do not add `normalizeRingCentralWebhookPayload` as a public **seam** — leftover normalizer already owns that. Do not add `resolveRingCentralInboundRoute` as a public **seam** — Wave B enrich already owns that. Do not promote the collection-name constants to owner **seams** in this rename.

## The file, as a story

Parent functions stay deep. Child names are only extracted when they hide a real decision, not a one-liner.

```ts
// call-candidate-store.ts
// A normalized, route-enriched party event just arrived.
// Fold it onto this telephony session’s party.
// Keep the first answer time even if hangup or a delayed older Answered arrives.
// Mark hangup from the six terminal codes.
// Ask already-recommended evaluate whether it has answered two minutes.
// Persist the party. Append this tick’s decision.
// Do not ingest. Do not collapse the session. Do not create a Call Lead.

// ── 1. Fold this party event onto the existing per-party candidate ─

export function foldThisPartyEventOntoTheExistingPerPartyCandidate(
  existing,
  event,
  now = new Date(),
)

function thisEventIsOlderThanThePartyWeAlreadyHave(existing, event) // null sequence → not older
function keepAnsweredOnceWeHaveSeenIt(existing, event)
function keepTheEarliestAnswerTime(existing, event)
function markHangupFromTheSixTerminalCodes(existing, event, useEventAsLatest)
function keepTheFirstMappedRoute(existing, event)                  // target / source / route stick
function keepQueueOnceTrue(existing, event)
function leaveDurationAndDecisionForEvaluate(existing, event)      // placeholder; upsert overwrites

// ── 2. Remember the folded party and stamp leftover evaluate ──

export async function rememberTheFoldedPartyAndStampTheQualification(event, now = new Date())

async function loadTheExistingParty(event)
function askWhetherThisInboundPartyHasAnsweredLongEnough(candidate, now)
function stampAnsweredSecondsUntilHangupOrNow(candidate, now)
async function writeThePartySnapshot(candidate)

// ── 3. Append this tick’s decision ────────────────────────

export async function appendThisTicksDecision(candidate, decision)

// ── 4. Hand leftover session every party on this telephony session ─

export async function handLeftoverSessionEveryPartyOnThisTelephonySession(
  telephonySessionId,
)

export async function showRecentPartiesWithoutTheRawParty(limit)
export async function showRecentPartyDecisions(limit)
```

Read the primary path out loud: *Load the party we already have for this telephony session and this party. Fold the new event onto it — if the sequence is older, do not rewind the latest status, but if this delayed event is Answered, still keep answered and the earliest answer time. If this event is hangup, mark the party over. Ask already-recommended evaluate whether this inbound party on a mapped number has answered for two minutes. Persist the folded snapshot with those seconds and that decision. Then write this tick’s decision onto the trail. Leftover session collapse will ask for every party on this telephony session and will ingest only when that collapse says qualified and over. Do not ingest here. Do not collapse here. Do not create a Call Lead.*

That is the operation. `upsertRingCentralCallCandidateFromEvent` is not.

## Precise logic I would tighten while renaming

These are real smells the story names make obvious. Do not “just rename.”

1. **Knowledge draws evaluate after upsert. Upsert already evaluates.** The pipeline box is “upsert per-party candidate → evaluate each party.” This file folds, **asks** already-recommended evaluate, and writes `decisionStatus` in one upsert. Wave B then appends the trail. Do not split evaluate back out so “the diagram becomes true.” Do not delete the **ask** so “persist is just a fold.” Keep knowledge’s leftover-session / leftover-ingest order. Do not add this path to knowledge in this rename.

2. **`CALL_CANDIDATES_TEST_COLLECTION` lies.** Leftover config resolves `ringcentral_call_candidates` plus the `_test` suffix unless leftover config turns that suffix off. The export name says test-only. Runtime Wave B persist uses the same constant. Keep the alias. Do not silently rename the collections.

3. **The fold’s `decisionStatus` can be `not_candidate`. Evaluate never returns that.** Before upsert overwrites, a first unmatched party is stored in memory as `not_candidate`. Already-recommended evaluate would say `rejected` / `target_number_not_matched`. The persisted row always has evaluate’s five statuses (plus evaluate never writes `not_candidate`). Types still allow the sixth. Do not silently map the fold placeholder to `rejected` so “one status enum” without a paired leftover-session test.

4. **Every webhook tick appends a party decision. Leftover session persist only appends on a status change.** The leftover session-store comment names that contrast. Wave B **asks** `appendThisTicksDecision` unconditionally. Do not silently gate the party trail on `decisionStatus` change so “both trails match.” Do not move the trail insert into upsert so “one function owns both writes” without a Wave B test that a repeated `pending_buffer` still inserts.

5. **Find-then-upsert can race.** Unique `{ provider, telephonySessionId, partyId }` is created at runtime. Two concurrent events for the same party can fold from a stale read. Do not silently switch to `findOneAndUpdate` aggregation so “one write owns the fold” in this rename — the fold is JavaScript, not a Mongo pipeline. Leave the race. Do not drop the unique index.

6. **This file inlines leftover `getRingCentralDb` three times.** Leftover session / processed / sync / shadow **ask** leftover `ringcentral-mongo.ts`. Candidate persist predates that helper. Do not silently switch helpers so “one mongo accessor” without a paired collection-mode test. Indexes still bootstrap at runtime here; leftover Call Log sync state **fails closed** when its unique index is missing. Do not silently fail-closed this store so “every RingCentral store matches.”

7. **Debug list hides `rawLatestParty`. Find-by-session does not.** Leftover aggregator needs the persisted facts, not the raw party, but the find returns the whole document. Do not strip `rawLatestParty` from find-by-session so “debug and session match.”

8. **The fold duration is a leftover placeholder.** `buildCandidateDocument` copies `existing.estimatedDurationSeconds ?? null`. Upsert then stamps leftover `countAnsweredSecondsUntilHangupOrNow`. Tests **ask** the fold, not the stamp. Do not have the fold call evaluate so “the offline harness sees a decision.”

9. **`needs_review` / missing-caller-phone have no store test.** Today’s leftover file test only names delayed-Answered-after-Disconnect (sequence 13 after 20 keeps hangup status, stamps `answered` / earliest `answeredAt` / `terminalAt`). It never persists. It never **asks** upsert. Mongo / decision-trail / find-by-session have **no** file test on this **interface**.

10. **Leave sibling modules alone.** Already-recommended evaluate, leftover hangup codes, leftover aggregator’s canonical-party pick, leftover session persist, leftover ingest, leftover capture, leftover normalizer, Wave B enrich, leftover seed, and leftover Call Log vet already live at the right **depth**. This file orchestrates leftover evaluate only.

## Testing

The **interface** is the test surface: `foldThisPartyEventOntoTheExistingPerPartyCandidate`, `rememberTheFoldedPartyAndStampTheQualification`, `appendThisTicksDecision`, `handLeftoverSessionEveryPartyOnThisTelephonySession`.

Today’s `call-candidate.test.ts` already names the delayed-Answered-after-Disconnect fold, then also tests leftover normalizer, leftover seed, leftover phone fold, and already-recommended evaluate in the same file. Split the leftover tests to those modules when they get their own pass. Do not treat leftover seed `resolveRingCentralInboundSource` as this file’s proof — runtime must not import leftover seed.

Replace the mixed file with tests that name the operation:

**Fold this party event onto the existing per-party candidate**
- First Answered starts `answered` / `answeredAt` from observed event time.
- Disconnect after Answered keeps `answeredAt`, sets `terminal` / `terminalAt`, keeps latest `statusCode`.
- Delayed older Answered (lower sequence) after Disconnect keeps `lastSequence` / hangup `statusCode`, still stamps `answered` and the earliest `answeredAt`.
- Null sequence is not “older” — the incoming event is latest.
- `targetMatched` / first source / first route stick when a later event would clear them.
- `queueCall` stays true once true.
- Fold duration / decision stay placeholders (`null` / `not_candidate` or leftover existing). This beat never **asks** evaluate.

**Remember the folded party and stamp leftover evaluate**
- Wave B persist returns `{ candidate, decision }` whose `decisionStatus` is already-recommended evaluate’s, not the fold placeholder.
- Live under 120s persists `pending_buffer` and duration from leftover `now`.
- Hangup under 120s persists `rejected` / `under_120_seconds`.
- Unique party key is `provider + telephonySessionId + partyId`.
- This beat does not insert a decision-trail row.
- This beat never returns `ingestEligible`. This beat never creates a Call Lead.

**Append this tick’s decision**
- Every **ask** inserts, including a repeated `pending_buffer`.
- The row copies leftover evaluate’s `wouldCreateCallLead` / status / reason / preview plus party ids and `candidateUpdatedAt`.

**Hand leftover session every party on this telephony session**
- Newest `updatedAt` first.
- Includes `rawLatestParty`.
- Empty session → leftover session persist’s null (prove on leftover session persist, not here).
- Debug list hides `rawLatestParty`; this **seam** does not.

Do **not** add a test per helper (`thisEventIsOlderThanThePartyWeAlreadyHave`, `keepTheFirstMappedRoute`). Those names exist so the parent reads. If a helper test has to change when the helper is inlined, it was testing past the **interface**.

Do **not** add leftover ingest, leftover aggregator, leftover capture, leftover seed, leftover Call Log vet, or Wave B enrich as this file’s proof. Leftover session persist tests stay on leftover session persist — they **ask** find-by-session; they do not own the fold.

## What I would not do

- A `CallCandidateStoreService` class with `create` / `update` / `delete`.
- Thirty two-line functions that only wrap an existing call.
- Moving this into a CRUD folder (`upsert.ts` / `find.ts` / `store.ts`) “for cleanliness.”
- Breaking Wave B’s upsert-then-append **seam**, or leftover session persist’s find-then-aggregate **seam**.
- Treating leftover `ingestRingCentralQualifiedCall`, leftover `aggregateRingCentralCallSession`, leftover `captureRingCentralWebhookEvent`, or leftover `vetRingCentralCallLogRecord` as this story. Those are different **adapters**.
- Inventing an ingest **seam** that has only one **adapter** (this file never promotes a Call Lead).
- Silently merging already-recommended evaluate into this file, silently gating the party trail on status change, or silently requiring hangup before persist, while recommending a rename.
- Jumping to leftover session collapse while this service still has unchecked Wave A modules.
- Writing a whole-folder recommendation for `ringcentral`.
