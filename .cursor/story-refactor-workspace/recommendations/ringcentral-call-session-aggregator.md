# Collapse Every Party On This Telephony Session Into One Synthetic Candidate — Pick The Inbound Mapped Queue As The Call, Trust The Answered Agent's Hangup When The Queue Disconnects Early, Ask Already-Recommended Evaluate Whether The Session Has Answered Two Minutes, Then Stamp Leftover Ingest Only When Qualified And The Call Is Over — Never Persist, Never Ingest, Never Create A Call Lead, Never Fold A Party Event, Never Capture The Raw Webhook, Never Read Call Log — operational story

- Status: recommended
- Service: `ringcentral` (Wave A, in-progress)
- Pass: 3 of this service — `call-session-aggregator.ts`
- Remaining in this service: `call-session-store.ts`, `webhook-capture.ts`, `webhook-subscriptions.ts`, `ringcentral-call-lead-ingest.service.ts`, `ringcentral-duplicate-guard.ts`, `callLeadConvergence.service.ts`, `shadow-call-leads-store.ts`, `processed-calls-store.ts`, `call-log-sync.service.ts`, `call-log-sync-state.store.ts`, `call-log-vetting.ts`, `analytics-reconcile.service.ts`, `auth.ts`
- Target: `src/services/ringcentral/call-session-aggregator.ts`
- Knowledge: [`docs/knowledge/services/ringcentral-call-lead-qualification.md`](../../../docs/knowledge/services/ringcentral-call-lead-qualification.md) (section 2: collapse multi-party sessions into one synthetic candidate, then run the shared evaluator; canonical priority inbound + target-matched → `queueCall` → answered → longest duration → most recently updated; lifecycle timing prefers the answered party because the queue can hang up as soon as an agent answers; `ingestEligible = wouldCreateCallLead && terminal` — webhooks do not ingest a live call still in `pending_buffer` or a live two-minute qualify). Distinct from already-recommended evaluate: [recommendations/ringcentral-call-candidate-evaluator.md](ringcentral-call-candidate-evaluator.md) (pure five-status decide on **one** party; this file **asks** evaluate + duration on the **synthetic** session candidate; evaluate never sets leftover `ingestEligible`). Distinct from already-recommended party persist: [recommendations/ringcentral-call-candidate-store.md](ringcentral-call-candidate-store.md) (folds one party event, **asks** evaluate per party, hands leftover session every party on this telephony session). Distinct from leftover session persist: `call-session-store.ts` (`processRingCentralCallSession` **asks** already-recommended find-by-session, then **asks** this file, then upserts the session and appends a decision only on a **status transition**; Wave B ingest **asks** leftover persist’s `document.ingestEligible`). Distinct from leftover ingest: `ringcentral-call-lead-ingest.service.ts` (the only promotion gate — Wave B `ingestSessionLead` builds `RingCentralQualifiedCall` with `ingestionSource: "webhook"`, `callLogId: null` from this file’s `leadPreview`). Distinct from leftover Call Log vet / leftover cron / leftover analytics. Distinct from leftover capture / leftover normalizer / leftover seed. Distinct from skipped `call-session-types.ts` (the session bag + `ingestEligible`). Distinct from Wave B `POST /api/webhooks/ringcentral` (capture always; leftover persist + leftover ingest only when webhook processing is on **and** `MONGO_URI` is set). This checkout’s `CONTEXT.md` does not define Call Qualification / Call Lead Ingestion / Caller Match Key — the knowledge file links a parent glossary this tree does not ship. Do not invent a glossary copy. `docs/adr/` is absent here — do not invent an ADR copy. Do not add this path to knowledge in this rename.
- Callers: **one leftover runtime import, one leftover file test.** Leftover `call-session-store.ts` — `aggregateRingCentralCallSession(parties, now)` then persists `document` (ignores returned `decision`; copies `ingestEligible` onto the session and the quieter trail). Wave B `ringcentral-webhook.routes.ts` never imports this file — it **asks** leftover persist, then leftover ingest when `document.ingestEligible`. Test: `call-session-aggregator.test.ts` (five named collapses; imports already-recommended `CALL_LEAD_MINIMUM_ANSWERED_SECONDS` only for the live-qualify clock). Not this **interface**: leftover ingest, already-recommended evaluate, already-recommended party persist, leftover capture, leftover seed, leftover Call Log vet, Wave B `ingestSessionLead`.
- Seams callers need: collapsed session document vs leftover evaluate’s unused `decision` bag (leftover persist **asks** `document` only); `wouldCreateCallLead` (evaluate, live two-minute qualify is legal) vs `ingestEligible` (this file, qualified **and** the session is over); canonical identity vs lifecycle timing (queue can be the call while the agent owns hangup); empty-parties throw (leftover persist returns null **before** this file)
- Split later (only if the file outgrows one sitting): this ~250-line file is one sitting if you read it as collapse every party on this telephony session into one synthetic candidate — pick the inbound mapped queue as the call, trust the answered agent’s hangup when the queue disconnects early, ask already-recommended evaluate whether the session has answered two minutes, then stamp leftover ingest only when qualified and the call is over; never persist, never ingest, never create a Call Lead, never fold a party event, never capture the raw webhook, never read Call Log. If it later splits: `collapseEveryPartyOnThisTelephonySessionIntoOneSyntheticCandidate.ts` / `pickWhichPartyIsThisCall.ts` / `pickWhichPartysAnswerAndHangupWeTrust.ts` — story files, never `create.ts` / `update.ts` / `delete.ts` / `aggregate.ts`, and never merge already-recommended evaluate, already-recommended party persist, leftover session persist, leftover ingest, leftover Call Log vet, or Wave B ingest into this file

`aggregateRingCentralCallSession` is executor mechanics. The owner question is: *Several parties just rang on this one inbound call — the queue, the agent, maybe a transfer. Pick which party is the call we care about (the inbound mapped queue wins over an unmatched agent). Pick which party’s answer and hangup we trust (the queue can disconnect as soon as an agent answers, so timing prefers the answered leg and only then “every party hung up”). Build one synthetic candidate from those facts. Ask already-recommended evaluate: has this inbound session on a mapped number answered for two minutes? Then say whether leftover ingest may run: only when evaluate says qualified AND the session is over. A live two-minute qualify is still a qualify — do not ingest it yet. Do not persist. Do not ingest. Do not create a Call Lead. Do not fold a party event. Do not capture the raw webhook. Do not open Call Log.*

Already-recommended evaluate, already-recommended party persist, leftover session persist, leftover ingest, leftover Call Log vet, leftover capture, leftover seed, and Wave B webhook HTTP already live in other **modules**. Do not pull those in.

## What this file actually does

Three operations of one “collapse every party on this telephony session into one synthetic candidate — pick the inbound mapped queue as the call, trust the answered agent’s hangup when the queue disconnects early, ask already-recommended evaluate whether the session has answered two minutes, then stamp leftover ingest only when qualified and the call is over — never persist, never ingest, never create a Call Lead, never fold a party event, never capture the raw webhook, never read Call Log” story, not “a session CRUD aggregator,” and not leftover ingest / leftover persist:

1. **Collapse every party on this telephony session into one synthetic candidate, ask leftover evaluate, then stamp leftover ingest only when qualified and over** — `aggregateRingCentralCallSession(parties, now)`. Pure. No Mongo. No Call Log. No Lead write. Empty `parties` throws. `telephonySessionId` is `parties[0]`. Session `answered` is any party answered. Session `answeredAt` is the earliest answered time among the lifecycle party and every answered party. Session is over when the lifecycle party is terminal **or** every party is terminal; hangup time / hangup code then come from the lifecycle party, else the latest hangup among terminal parties. `targetMatched` is any-party. Source / route come from the first party that is both matched and has a source company, else the canonical party. `queueCall` is true if any party is the queue. `missedCall` is true only if every party is missed. Phones / names prefer the canonical party and fall back to the mapped party. `callStartedAt` is the earliest start. Duration is leftover `countAnsweredSecondsUntilHangupOrNow` on the **merged** clock. Then leftover evaluate runs on that synthetic candidate. `ingestEligible = decision.wouldCreateCallLead && terminal`. Return `{ document, decision }`. This beat does **not** persist. This beat does **not** ingest.

2. **Pick which party is this call** — `selectCanonicalParty` / `canonicalScore`. Additive, not a lexicographic sort: inbound +1_000_000, matched-with-source +500_000, queue +100_000, answered +50_000, leftover party `estimatedDurationSeconds` capped at 40_000, recency capped at 9_000. The comment says “inbound AND matched” is first; the score treats inbound and matched as two additives, so an inbound unmatched party beats a matched outbound party. Recency is `updatedAt.getTime() / 1_000_000` then `min(…, 9_000)` — every 2026 date saturates, so “most recently updated” never fires on live data. This beat does **not** decide qualify. This beat does **not** decide hangup.

3. **Pick which party’s answer and hangup we trust** — `selectLifecycleParty` / `lifecycleScore`. If any party answered, score only those; else score everyone. Additive: answered +1_000_000, terminal +500_000, queue +100_000, leftover party duration, same dead recency cap. The owner reason is in the file comment: queue legs can disconnect as soon as an agent answers, so timing prefers the answered party and only falls back to every-party terminal state. This beat does **not** pick source / route. This beat does **not** set `ingestEligible`.

There is no persist operation. There is no ingest operation. There is no Call Lead write. There is no party-event fold. There is no raw-webhook capture. There is no Call Log read. Leftover `processRingCentralCallSession` is the persist **adapter**. Leftover `ingestRingCentralQualifiedCall` is the only promotion gate. Wave B `ingestSessionLead` is the webhook **adapter** that reads `ingestEligible`.

`earliestDate` / `latestDate` are private clock folds. They are not extra owner operations.

## Organization

Keep one file as the screenplay for “collapse every party on this telephony session into one synthetic candidate — pick the inbound mapped queue as the call, trust the answered agent’s hangup when the queue disconnects early, ask already-recommended evaluate whether the session has answered two minutes, then stamp leftover ingest only when qualified and the call is over — never persist, never ingest, never create a Call Lead, never fold a party event, never capture the raw webhook, never read Call Log.” Already-recommended evaluate, already-recommended party persist, leftover session persist, leftover ingest, leftover Call Log vet, leftover capture, leftover seed, skipped types, and Wave B webhook HTTP already live in deeper **modules**. Do not pull those in. Do not invent a `CallSessionAggregatorService` class. Do not invent a begin / complete **seam** — this file never writes Mongo. Do not invent an ingest **adapter** beside leftover `ingestRingCentralQualifiedCall`. Do not invent a persist **adapter** beside leftover `processRingCentralCallSession`. Do not invent a Call Log **adapter** beside leftover vetting.

Do not split this into `create.ts` / `update.ts` / `delete.ts` / `aggregate.ts`. Those are evaluator / persistence nouns, not the owner story. Do not move the collapse into leftover persist so “session can load and decide in one file.” Do not move leftover `ingestEligible` into already-recommended evaluate so “one function owns qualify and ingest.” Do not move canonical pick into already-recommended party persist so “the party row already knows it is the call.” Do not silently AND `terminal` into `wouldCreateCallLead` so “webhooks cannot preview a live qualify.” Do not silently ingest a live two-minute qualify so “the owner does not wait for hangup.”

**External interface** stays small (this is the test surface). Collapse, pick-the-call, and pick-the-clock are one story’s session Call Qualification, not three CRUD verbs:

| Keep exporting | Story name | Why the seam exists |
|---|---|---|
| `aggregateRingCentralCallSession` | `collapseEveryPartyOnThisTelephonySessionIntoOneSyntheticCandidateAndSayWhetherLeftoverIngestMayRun` | leftover persist **asks** this after already-recommended find-by-session; Wave B ingest **asks** `document.ingestEligible` |

Keep the old name as a one-line alias until leftover session persist and `call-session-aggregator.test.ts` migrate. Do not make callers learn `canonicalScore` / `lifecycleScore` / `syntheticCandidate` as the domain language.

**Principle: old exports stay as aliases.** `aggregateRingCentralCallSession` remains the imported name until leftover persist migrates.

**No class for the workflow.** The type that *does* earn a name is the bag this file already returns, plus the one flag leftover persist and Wave B ingest already treat as the handoff:

```ts
type CollapsedSessionAndQualification = {
  document: RingCentralCallSessionDocument  // includes ingestEligible
  decision: CandidateDecision               // leftover evaluate; leftover persist ignores this bag
}

type SessionMayBeIngested = {
  wouldCreateCallLead: boolean  // leftover evaluate; live two-minute qualify is legal
  terminal: boolean             // lifecycle hung up, or every party hung up
  ingestEligible: boolean       // wouldCreateCallLead && terminal
}
```

That is the handoff from “we collapsed this telephony session and asked already-recommended evaluate” to “leftover persist may write the session, Wave B may ingest only when `ingestEligible`.” Do **not** add `callLogId` so “this file can replace leftover Call Log vet,” do **not** add `writeMode` so “this file can replace leftover ingest,” and do **not** add `upsert` so “this file can replace leftover persist.”

Do not add `evaluateRingCentralCallCandidate` as a public story **seam** on this file — already-recommended evaluate already owns that export. Do not add `processRingCentralCallSession` as a public **seam** — leftover persist already owns that. Do not add `ingestRingCentralQualifiedCall` as a public **seam** — leftover ingest already owns that. Do not export `selectCanonicalParty` / `selectLifecycleParty` as public **seams** — they exist so the parent reads.

## The file, as a story

Parent functions stay deep. Child names are only extracted when they hide a real decision, not a one-liner.

```ts
// call-session-aggregator.ts
// Several parties just rang on this one inbound call —
// the queue, the agent, maybe a transfer.
// Pick which party is the call.
// Pick which party's answer and hangup we trust
// (the queue can hang up as soon as an agent answers).
// Ask already-recommended evaluate whether the session
// has answered for two minutes.
// Leftover ingest may run only when that is qualified
// and the session is over.
// Do not persist. Do not ingest. Do not create a Call Lead.

// ── 1. Collapse every party, ask leftover evaluate, stamp leftover ingest ─

export function collapseEveryPartyOnThisTelephonySessionIntoOneSyntheticCandidateAndSayWhetherLeftoverIngestMayRun(
  parties,
  now = new Date(),
)

function refuseAnEmptySession(parties)                 // leftover persist returns null first
function takeTheTelephonySessionIdFromTheFirstParty(parties)
function sayWhetherAnyoneAnswered(parties)
function takeTheEarliestAnswerTime(lifecycleParty, answeredParties)
function sayWhetherTheSessionIsOver(lifecycleParty, parties)  // lifecycle hung up, or every party
function takeHangupTimeAndCodeOnceOver(lifecycleParty, parties)
function takeTheMappedRouteFromTheFirstMatchedSource(parties, canonical)
function keepQueueIfAnyPartyIsTheQueue(parties, canonical)
function keepMissedOnlyIfEveryPartyIsMissed(parties, canonical)
function fillPhonesFromTheCanonicalPartyOrTheMappedParty(canonical, mapped)
function takeTheEarliestCallStart(parties)
function countAnsweredSecondsOnTheMergedClock(answeredAt, terminalAt, now)
function askWhetherThisInboundSessionHasAnsweredLongEnough(synthetic, now)
function stampLeftoverIngestOnlyWhenQualifiedAndOver(decision, terminal)

// ── 2. Pick which party is this call ──────────────────────

function pickWhichPartyIsThisCall(parties)

function scoreInboundThenMappedThenQueueThenAnsweredThenDuration(party)
// inbound 1_000_000, matched+source 500_000, queue 100_000,
// answered 50_000, leftover party duration cap 40_000,
// recency cap 9_000 (dead on live dates)

// ── 3. Pick which party's answer and hangup we trust ──────

function pickWhichPartysAnswerAndHangupWeTrust(parties)

function preferAnsweredPartiesOtherwiseEveryone(parties)
function scoreAnsweredThenHangupThenQueueThenDuration(party)
```

Read the primary path out loud: *Refuse an empty session. Take the telephony session id from the first party. Pick which party is this call — inbound, then mapped with a source, then the queue, then answered. Pick which party’s answer and hangup we trust — the answered agent beats a queue that already hung up. The session is over when that lifecycle party hung up, or when every party hung up. Fill the mapped route from the first matched source. Build one synthetic candidate on the merged clock. Ask already-recommended evaluate whether this inbound session on a mapped number has answered for two minutes. Stamp leftover ingest only when that decision is qualified and the session is over. A live two-minute qualify stays a qualify and is not ingest-eligible. Do not persist. Do not ingest. Do not create a Call Lead.*

That is the operation. `aggregateRingCentralCallSession` is not.

## Precise logic I would tighten while renaming

These are real smells the story names make obvious. Do not “just rename.”

1. **Knowledge draws evaluate per-party after upsert, then aggregate. This file re-asks evaluate on a synthetic candidate.** Already-recommended party persist already stamped each party. Session evaluate can differ because answered / hangup / phones / route are merged across parties. Do not delete the second **ask** so “we already judged each party.” Do not move evaluate into this file so “session is self-contained.” Keep knowledge’s leftover-persist / leftover-ingest order. Do not add this path to knowledge in this rename.

2. **The comment says “inbound AND matched” is first. The score treats them as two additives.** Inbound is +1_000_000. Matched-with-source is +500_000. An inbound unmatched party beats a matched outbound party. Knowledge’s “inbound + target-matched → queueCall → …” is the intended lexicographic order, not the code. Do not silently switch to a comparator chain so “the comment becomes true” without a paired inbound-unmatched vs outbound-matched test.

3. **“Most recently updated” never fires on live dates.** Recency is `updatedAt.getTime() / 1_000_000` then `min(…, 9_000)`. 9_000 × 1e6 ms is ~104 days after epoch. Every 2026 party scores 9_000. Canonical and lifecycle both use it. Do not silently change the divisor so “recency works” without a paired same-score multi-party test.

4. **`wouldCreateCallLead` is not leftover `ingestEligible`.** Already-recommended evaluate may qualify a live call that has already been answered two minutes. This file is the file that refuses leftover ingest until the session is over. The leftover file test already names that: live 125s → `wouldCreateCallLead: true`, `terminal: false`, `ingestEligible: false`. Do not silently AND `terminal` into evaluate so “webhooks cannot preview a live qualify.”

5. **Session `answeredAt` is the earliest answered party. Hangup is the lifecycle party. Duration can span two legs.** If the queue answered at T0 and the agent (lifecycle) hung up at T0+181s, leftover `countAnsweredSecondsUntilHangupOrNow` counts from T0. Knowledge says “answered parties drive `answeredAt`.” Do not silently use only `lifecycleParty.answeredAt` so “one party owns the clock” without a paired split-clock test.

6. **Canonical pick uses each party’s leftover `estimatedDurationSeconds`.** Those are already-recommended party persist’s stamps (often `null` on the fold placeholder). This file then recomputes session duration on the merged clock and does **not** feed it back into the pick. Do not score the merged duration so “one clock owns identity.”

7. **`telephonySessionId` is `parties[0]`, not “every party agrees.”** Mixed ids would silently take the first array element. Leftover persist loads by one id, so runtime rows match. Do not silently assert a single id so “a bad fixture throws” without a paired leftover-persist test.

8. **Leftover persist ignores returned `decision`.** The document already copies leftover evaluate’s status / reason / preview / `wouldCreateCallLead`. Keep the bag as the leftover type until leftover persist migrates. Do not drop `decision` so “one object owns the handoff” without a paired leftover-persist compile.

9. **Empty parties throw here. Leftover persist returns null first.** Wave B never **asks** this file with `[]`. Do not return a rejected document so “empty is just not a lead.”

10. **`queueCall` is any-party. `missedCall` is every-party.** Asymmetric on purpose (a queue + agent session is still a queue call; one missed party does not make the session missed). Do not unify so “both flags use the same fold.”

11. **Leave sibling modules alone.** Already-recommended evaluate, already-recommended party persist’s find-by-session, leftover persist, leftover ingest, leftover Call Log vet, leftover capture, leftover seed, and Wave B `ingestSessionLead` already live at the right **depth**. This file orchestrates leftover evaluate only.

## Testing

The **interface** is the test surface: `collapseEveryPartyOnThisTelephonySessionIntoOneSyntheticCandidateAndSayWhetherLeftoverIngestMayRun`.

Today’s `call-session-aggregator.test.ts` already names the five owner collapses. Keep those names. Add the missing clocks. Do not treat leftover persist, leftover ingest, or already-recommended evaluate as this file’s proof.

**Collapse every party, ask leftover evaluate, stamp leftover ingest**
- Queue + unmatched agent, both hung up at 121s → canonical is the queue, `qualified`, `ingestEligible: true`, source stays the queue’s company, duration 121.
- Queue disconnects at 10s unanswered; answered agent hangs up at 181s → canonical is still the queue (identity / source), `terminalAt` is the agent’s, duration 181, `qualified`, `ingestEligible: true`.
- One party hung up at 30s → `rejected` / `under_120_seconds`, `ingestEligible: false`.
- Live (non-terminal) answered 125s → `wouldCreateCallLead: true`, `terminal: false`, `ingestEligible: false`.
- Outbound-only → `rejected` / `not_inbound`.
- Empty `parties` throws. Leftover persist’s null is leftover persist’s proof.
- `queueCall` is true when any party is the queue. `missedCall` is true only when every party is missed.
- `targetMatched` is true when any party matched; source / route still come from the first matched-with-source party.
- This beat never persists. This beat never returns a Call Lead id. This beat never **asks** leftover ingest.

**Pick which party is this call / which clock we trust**
- Inbound unmatched beats matched outbound (today’s additive score). Do not “fix” this to the comment’s AND without changing the test.
- Recency does not change the winner among otherwise equal 2026 parties.
- Split answer times: earliest answered party vs lifecycle hangup — prove today’s merged duration, then leave a reorder as a later change.

Do **not** add a test per helper (`scoreInboundThenMappedThenQueueThenAnsweredThenDuration`, `keepMissedOnlyIfEveryPartyIsMissed`). Those names exist so the parent reads. If a helper test has to change when the helper is inlined, it was testing past the **interface**.

Do **not** add leftover ingest, leftover persist, leftover capture, leftover seed, leftover Call Log vet, or Wave B `ingestSessionLead` as this file’s proof. Leftover persist tests stay on leftover persist — they **ask** this interface; they do not own the collapse.

## What I would not do

- A `CallSessionAggregatorService` class with `create` / `update` / `delete`.
- Thirty two-line functions that only wrap an existing call.
- Moving this into a CRUD folder (`aggregate.ts` / `select.ts` / `score.ts`) “for cleanliness.”
- Breaking leftover persist’s find-then-collapse **seam**, or Wave B’s `ingestEligible`-then-leftover-ingest **seam**.
- Treating leftover `ingestRingCentralQualifiedCall`, leftover `processRingCentralCallSession`, already-recommended `evaluateRingCentralCallCandidate`, or leftover `vetRingCentralCallLogRecord` as this story. Those are different **adapters**.
- Inventing an ingest **seam** that has only one **adapter** (this file never promotes a Call Lead).
- Silently merging already-recommended evaluate into this file, silently ANDing `terminal` into `wouldCreateCallLead`, silently switching the score to a lexicographic AND, or silently fixing the dead recency term, while recommending a rename.
- Jumping to leftover session persist while this service still has unchecked Wave A modules.
- Writing a whole-folder recommendation for `ringcentral`.
