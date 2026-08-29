# Say Whether This Inbound Party On A Mapped Number Has Answered For Two Minutes — Wait If The Call Is Still Live And Short, Reject If It Already Hung Up Short, Preview A Call Lead Only When It Qualifies — Never Create A Call Lead, Never Ingest, Never Read Call Log — operational story

- Status: recommended
- Service: `ringcentral` (Wave A, in-progress)
- Pass: 1 of this service — `call-candidate-evaluator.ts`
- Remaining in this service: `call-candidate-store.ts`, `call-session-aggregator.ts`, `call-session-store.ts`, `webhook-capture.ts`, `webhook-subscriptions.ts`, `ringcentral-call-lead-ingest.service.ts`, `ringcentral-duplicate-guard.ts`, `callLeadConvergence.service.ts`, `shadow-call-leads-store.ts`, `processed-calls-store.ts`, `call-log-sync.service.ts`, `call-log-sync-state.store.ts`, `call-log-vetting.ts`, `analytics-reconcile.service.ts`, `auth.ts`
- Target: `src/services/ringcentral/call-candidate-evaluator.ts`
- Knowledge: [`docs/knowledge/services/ringcentral-call-lead-qualification.md`](../../../docs/knowledge/services/ringcentral-call-lead-qualification.md) (section 1 is this file: pure `evaluateRingCentralCallCandidate`, five `decisionStatus` values, live-under-120s is `pending_buffer`, hangup-under-120s is `rejected`, duration is `terminalAt ?? now`, terminal statuses are the six codes, qualified preview always stamps `qualificationReason: "inbound_target_answered_over_120s"`). Distinct from leftover shared facts: `call-qualification.ts` (`qualifyRingCentralCall` + the 120s constant this file re-exports; Call Log vetting **asks** that file directly). Distinct from leftover payload fold: `webhook-event-normalizer.ts` (party events; `targetMatched` is still false here). Distinct from leftover candidate persist: `call-candidate-store.ts` (**asks** evaluate + duration + terminal-status after folding a party event; it writes the decision onto the candidate). Distinct from leftover session collapse: `call-session-aggregator.ts` (picks a canonical party, builds a synthetic candidate, **asks** evaluate; `ingestEligible = wouldCreateCallLead && terminal` — this file never sets ingest). Distinct from leftover session persist: `call-session-store.ts` (`processRingCentralCallSession` **asks** leftover aggregator, then leftover ingest). Distinct from leftover Call Log vet: `call-log-vetting.ts` (same 120s / inbound / mapped / answered / caller-phone rule on a finalized Call Log record; no `pending_buffer`, no live clock). Distinct from leftover shared ingest: `ringcentral-call-lead-ingest.service.ts` (the only promotion gate — adopt / create / shadow / dry-run). Distinct from leftover duplicate / convergence / ledger. Distinct from leftover analytics reconcile (imports only the 120s constant for a count-level Call Log filter; **must not** create Call Leads). Distinct from already-recommended Call Lead write: [recommendations/leads-call-lead.md](leads-call-lead.md) (`createRingCentralCallLead` is leftover ingest’s **adapter**, not this file). Distinct from leftover seed: `call-lead-sources.ts` (migration/test only; runtime must not import it). Distinct from Wave B `POST /api/webhooks/ringcentral` (capture always; evaluate only when webhook processing is on). This checkout’s `CONTEXT.md` does not define Call Qualification / Call Lead Ingestion / Caller Match Key — the knowledge file links a parent glossary this tree does not ship. Do not invent a glossary copy. `docs/adr/` is absent here — do not invent an ADR copy. Do not add this path to knowledge in this rename.
- Callers: **two leftover runtime imports, one leftover analytics constant import, two leftover file tests.** Leftover `call-candidate-store.ts` — `evaluateRingCentralCallCandidate` + `estimateAnsweredDurationSeconds` + `isLikelyTerminalRingCentralStatus` (terminal fold happens **before** evaluate). Leftover `call-session-aggregator.ts` — evaluate + duration on the synthetic candidate. Leftover `analytics-reconcile.service.ts` — `CALL_LEAD_MINIMUM_ANSWERED_SECONDS` only (`callDuration.minSeconds`). Tests: `call-candidate.test.ts` (evaluator statuses plus leftover normalizer / leftover seed / leftover phone fold). `call-session-aggregator.test.ts` (the 120s constant only). Not this **interface**: leftover ingest, leftover Call Log vet, leftover webhook capture, leftover seed `resolveRingCentralInboundSource`, Wave B webhook route, leftover `qualifyRingCentralCall` callers.
- Seams callers need: five-status decision (`rejected` / `candidate` / `pending_buffer` / `needs_review` / `qualified`) vs `wouldCreateCallLead` (true only on `qualified`); live-clock qualify (`…_webhook_elapsed_best_effort`) vs leftover aggregator `ingestEligible` (qualified **and** terminal); duration helper leftover store persists vs evaluate’s own duration; terminal-status helper leftover store uses to fold hangup **before** this file runs
- Split later (only if the file outgrows one sitting): this ~155-line file is one sitting if you read it as say whether this inbound party on a mapped number has answered for two minutes — wait if the call is still live and short, reject if it already hung up short, preview a Call Lead only when it qualifies; never create a Call Lead, never ingest, never read Call Log. If it later splits: `sayWhetherThisInboundPartyHasAnsweredLongEnoughToBecomeACallLead.ts` / `countAnsweredSecondsUntilHangupOrNow.ts` / `sayWhetherThisPartyStatusMeansTheCallIsOver.ts` — story files, never `create.ts` / `update.ts` / `delete.ts` / `evaluate.ts`, and never merge leftover store, leftover aggregator, leftover Call Log vet, leftover shared facts, leftover ingest, or leftover analytics into this file

`evaluateRingCentralCallCandidate` / `estimateAnsweredDurationSeconds` / `isLikelyTerminalRingCentralStatus` are executor mechanics. The owner question is: *An inbound party on one of our mapped RingCentral numbers has been ringing or talking. Has it answered for two minutes? If it is still live and under two minutes, wait for the next event. If it already hung up under two minutes, it is not a Call Lead. If it is still ringing, keep it as a candidate. If we have no caller phone, or it says answered with no answer time, send it to review. Only inbound + mapped + answered + two minutes previews a Call Lead. Do not create the Call Lead. Do not ingest. Do not open Call Log. Leftover session collapse decides whether a qualified live call is ready to ingest. Leftover Call Log vet tells the same two-minute story on a finished record.*

Leftover store, leftover aggregator, leftover shared facts, leftover Call Log vet, leftover ingest, leftover analytics, already-recommended Call Lead write, leftover seed, and Wave B webhook HTTP already live in other **modules**. Do not pull those in.

## What this file actually does

Three operations of one “say whether this inbound party on a mapped number has answered for two minutes — wait if the call is still live and short, reject if it already hung up short, preview a Call Lead only when it qualifies — never create a Call Lead, never ingest, never read Call Log” story, not “a candidate CRUD evaluator,” and not leftover ingest / leftover Call Log vet:

1. **Say whether this inbound party has answered long enough to become a Call Lead** — `evaluateRingCentralCallCandidate(candidate, now)`. Pure. No Mongo. No Call Log. No Lead write. Count answered seconds first (`answeredAt` → `terminalAt ?? now`). Outbound → `rejected` / `not_inbound`. Missing target match, source company, source label, or route → `rejected` / `target_number_not_matched`. No normalized caller phone → `needs_review` / `missing_caller_phone_number`. Not answered: hangup or `missedCall` → `rejected` / `not_answered`; still ringing → `candidate` / `inbound_target_waiting_for_answer`. `missedCall` with no `answeredAt` → `not_answered` even if `answered` is somehow true. Answered with no `answeredAt` → `needs_review` / `answered_missing_answered_at`. Under 120s and already terminal → `rejected` / `under_120_seconds`. Under 120s and still live → `pending_buffer` / `answered_but_under_120_seconds`. Then leftover `qualifyRingCentralCall` repeats inbound / route / answered / 120s / caller-phone on the same facts; a miss takes the first leftover reason. Qualified → `wouldCreateCallLead: true`, `decisionStatus: "qualified"`, reason `inbound_target_answered_over_120s` or `inbound_target_answered_over_120s_webhook_elapsed_best_effort` when `terminalAt` is missing, plus a `leadPreview` whose `qualificationReason` is always the short `inbound_target_answered_over_120s`. This beat does **not** require `terminal` for `wouldCreateCallLead`. This beat does **not** set leftover `ingestEligible`.

2. **Count answered seconds until hangup or now** — `estimateAnsweredDurationSeconds(answeredAt, terminalAt, now)`. No `answeredAt` → `0`. Else floor seconds from answer to `terminalAt ?? now`, never negative. Leftover store persists this on the party row after evaluate. Leftover aggregator feeds it onto the synthetic candidate. Evaluate **asks** the same helper before the 120s gate. This beat does **not** decide qualify.

3. **Say whether this party status means the call is over** — `isLikelyTerminalRingCentralStatus(statusCode)`. True for `Disconnected`, `Gone`, `Finished`, `Voicemail`, `Missed`, `NoCall`. Leftover store **asks** this while folding an event onto a party (hangup time and `terminal` are already on the document before evaluate runs). Evaluate does **not** call this helper; it trusts `candidate.terminal` / `missedCall` / `terminalAt`. This beat does **not** decide qualify.

There is no create-lead operation. There is no ingest operation. There is no Call Log operation. Leftover `ingestRingCentralQualifiedCall` is the only promotion gate. Leftover `vetRingCentralCallLogRecord` is the cron **adapter** of the same two-minute rule. Leftover analytics only reads the 120s constant.

`CALL_LEAD_MINIMUM_ANSWERED_SECONDS` is leftover `call-qualification.ts`’s number. This file re-exports it so leftover aggregator tests and leftover analytics keep importing the evaluator. It is not a fourth owner operation.

## Organization

Keep one file as the screenplay for “say whether this inbound party on a mapped number has answered for two minutes — wait if the call is still live and short, reject if it already hung up short, preview a Call Lead only when it qualifies — never create a Call Lead, never ingest, never read Call Log.” Leftover store, leftover aggregator, leftover shared facts, leftover Call Log vet, leftover ingest, leftover analytics, already-recommended Call Lead write, leftover seed, and Wave B webhook HTTP already live in deeper **modules**. Do not pull those in. Do not invent a `CallCandidateEvaluatorService` class. Do not invent a begin / complete **seam** — this file never writes Mongo. Do not invent a Call Log **adapter** beside leftover vetting. Do not invent an ingest **adapter** beside leftover `ingestRingCentralQualifiedCall`.

Do not split this into `create.ts` / `update.ts` / `delete.ts` / `evaluate.ts`. Those are HTTP verbs / evaluator nouns, not the owner story. Do not move the 120s gate into leftover ingest so “qualify and create live together.” Do not move live-vs-terminal under-120s into leftover aggregator so “session already owns wait.” Do not merge leftover `qualifyRingCentralCall` into this file so “one qualify function” without a paired test that leftover Call Log vet still **asks** the leftover facts file. Do not silently require `terminal` for `wouldCreateCallLead` so “webhooks cannot qualify a live call” — leftover aggregator already owns `ingestEligible = wouldCreateCallLead && terminal`. Do not silently teach leftover store to skip evaluate when the party is still `pending_buffer`.

**External interface** stays small (this is the test surface). The five-status decision, the duration fold, and the hangup codes are one story’s Call Qualification, not three CRUD verbs:

| Keep exporting | Story name | Why the seam exists |
|---|---|---|
| `evaluateRingCentralCallCandidate` | `sayWhetherThisInboundPartyHasAnsweredLongEnoughToBecomeACallLead` | leftover store stamps the party; leftover aggregator stamps the session |
| `estimateAnsweredDurationSeconds` | `countAnsweredSecondsUntilHangupOrNow` | leftover store persists duration; leftover aggregator builds the synthetic candidate; evaluate **asks** it |
| `isLikelyTerminalRingCentralStatus` | `sayWhetherThisPartyStatusMeansTheCallIsOver` | leftover store folds hangup **before** evaluate |
| `CALL_LEAD_MINIMUM_ANSWERED_SECONDS` | `twoMinutesAnswered` | leftover aggregator tests and leftover analytics; leftover facts file is the definition |

Keep the old names as one-line aliases until leftover store, leftover aggregator, leftover aggregator tests, and leftover analytics migrate. Do not make callers learn `pending_buffer` / `webhook_elapsed_best_effort` / `qualifyRingCentralCall` as the domain language.

**Principle: old exports stay as aliases.** `evaluateRingCentralCallCandidate` remains the imported name until leftover store and leftover aggregator migrate. `estimateAnsweredDurationSeconds` remains the imported name until leftover store and leftover aggregator migrate. `isLikelyTerminalRingCentralStatus` remains the imported name until leftover store migrates. `CALL_LEAD_MINIMUM_ANSWERED_SECONDS` remains the imported name until leftover analytics and leftover aggregator tests migrate (or import leftover facts directly).

**No class for the workflow.** The type that *does* earn a name is the five-status decision leftover store and leftover aggregator already persist:

```ts
type InboundPartyQualification =
  | { wouldCreateCallLead: false; decisionStatus: "rejected" | "candidate" | "pending_buffer" | "needs_review"; decisionReason: string; leadPreview: null }
  | { wouldCreateCallLead: true; decisionStatus: "qualified"; decisionReason: string; leadPreview: QualifiedCallLeadPreview }
```

That is the handoff from “we judged this inbound party” to “leftover store may stamp the party, leftover aggregator may set `ingestEligible` only when qualified and the session is over.” Do **not** add `ingestEligible` so “this file can replace leftover aggregator,” do **not** add `callLogId` so “this file can replace leftover Call Log vet,” and do **not** add `writeMode` so “this file can replace leftover ingest.”

`estimateAnsweredDurationSeconds` and `isLikelyTerminalRingCentralStatus` stay exported because leftover store **asks** them without going through evaluate. They are not extra owner operations. Do not add `qualifyRingCentralCall` as a public story **seam** on this file — leftover facts already owns that export. Do not add `reject` as a public **seam** — it is the private rejected bag.

## The file, as a story

Parent functions stay deep. Child names are only extracted when they hide a real decision, not a one-liner.

```ts
// call-candidate-evaluator.ts
// An inbound party on one of our mapped RingCentral numbers
// has been ringing or talking.
// Has it answered for two minutes?
// If it is still live and short, wait.
// If it already hung up short, it is not a Call Lead.
// Only then preview a Call Lead.
// Do not create it. Do not ingest. Do not open Call Log.

// ── 1. Say whether this inbound party has answered long enough ──

export function sayWhetherThisInboundPartyHasAnsweredLongEnoughToBecomeACallLead(
  candidate,
  now = new Date(),
)

function countHowLongThisPartyHasBeenAnswered(candidate, now)
function refuseWhenThePartyIsNotInbound(candidate)
function refuseWhenTheNumberIsNotOneOfOurs(candidate)
function sendToReviewWhenTheCallerPhoneIsMissing(candidate)
function waitOrRefuseWhenThePartyHasNotAnswered(candidate)   // ringing vs hangup / missed
function sendToReviewWhenAnsweredHasNoAnswerTime(candidate)
function waitIfLiveAndShortOrRefuseIfItAlreadyHungUpShort(candidate, answeredSeconds)
function askTheSharedTwoMinuteFacts(candidate, answeredSeconds)  // leftover qualifyRingCentralCall
function previewTheCallLead(candidate, answeredSeconds)         // live clock vs hangup reason

function rejected(reason)

// ── 2. Count answered seconds until hangup or now ─────────

export function countAnsweredSecondsUntilHangupOrNow(answeredAt, terminalAt, now)

// ── 3. Say whether this party status means the call is over ─

export function sayWhetherThisPartyStatusMeansTheCallIsOver(statusCode)

export { CALL_LEAD_MINIMUM_ANSWERED_SECONDS as twoMinutesAnswered }
```

Read the primary path out loud: *Count how long this party has been answered. Refuse outbound. Refuse a number that is not one of ours. Send a missing caller phone to review. If it has not answered, wait while it rings and refuse if it already hung up or was missed. Send “answered” with no answer time to review. If it is under two minutes, wait while the call is still live and refuse if it already hung up. Ask leftover shared facts the same inbound / mapped / answered / two-minute / caller-phone question. Only then preview a Call Lead — and if we have no hangup time, say the two minutes were best-effort on the live clock. Do not create the Call Lead. Leftover session collapse will ingest only when this preview is qualified and the session is over.*

That is the operation. `evaluateRingCentralCallCandidate` is not.

## Precise logic I would tighten while renaming

These are real smells the story names make obvious. Do not “just rename.”

1. **Leftover shared facts cannot reject after the webhook gates.** By the time evaluate **asks** `qualifyRingCentralCall`, inbound, route, answered, caller phone, `answeredAt`, and ≥ 120s have already passed. The leftover check is a late pass-through on the happy path. Keep the **ask** so leftover Call Log vet and this file still share one facts function. Do not delete it as dead code in this rename. Do not inline leftover facts into this file so “the webhook path is self-contained.”

2. **`leadPreview.qualificationReason` lies about the live clock.** Qualified-without-`terminalAt` sets `decisionReason` to `inbound_target_answered_over_120s_webhook_elapsed_best_effort` and then stamps preview `qualificationReason: "inbound_target_answered_over_120s"`. Leftover ingest copies `qualificationReason` onto the Call Lead. The live-clock story disappears at the preview **seam**. Rename the beats so both strings stay visible. Do not silently make preview copy `decisionReason`.

3. **The 120s constant does not live where knowledge and leftover analytics say it lives.** Knowledge names this file. Leftover analytics and leftover aggregator tests import this file. The definition is leftover `call-qualification.ts`. This file is a re-export. Keep the alias. Do not silently move the constant so “knowledge matches” without a paired leftover-vet import change.

4. **`wouldCreateCallLead` is not leftover `ingestEligible`.** This file may qualify a live call that has already been answered two minutes. Leftover aggregator is the file that refuses to ingest until the session is terminal. Do not silently AND `terminal` into `wouldCreateCallLead` so “webhooks cannot preview a live qualify.” That would break leftover `pending_buffer` vs live-qualified and leftover `ingestEligible`.

5. **`needs_review` has no file-test.** Today’s `call-candidate.test.ts` covers pending / live-best-effort qualify / outbound / unknown number / ringing / terminal unanswered / live-vs-terminal under 120 / terminal over 120 / missed-without-answer. It never names missing caller phone or answered-without-`answeredAt`. It also tests leftover phone fold, leftover seed source map, and leftover normalizer — those are not this **interface**.

6. **Leave sibling modules alone.** Leftover store’s hangup fold, leftover aggregator’s canonical-party pick, leftover Call Log vet, leftover ingest, leftover shared facts, leftover seed, and already-recommended Call Lead write already live at the right **depth**. This file orchestrates leftover facts only.

## Testing

The **interface** is the test surface: `sayWhetherThisInboundPartyHasAnsweredLongEnoughToBecomeACallLead`, `countAnsweredSecondsUntilHangupOrNow`, `sayWhetherThisPartyStatusMeansTheCallIsOver`.

Today’s `call-candidate.test.ts` already names most evaluate statuses, then also tests leftover normalizer, leftover seed, and leftover phone fold in the same file. Split the leftover tests to those modules when they get their own pass. Do not treat leftover seed `resolveRingCentralInboundSource` as this file’s proof — runtime must not import leftover seed.

Replace the mixed file with tests that name the operation:

**Say whether this inbound party has answered long enough**
- Still ringing on a mapped inbound number → `candidate` / `inbound_target_waiting_for_answer`, `wouldCreateCallLead: false`.
- Answered 30s and still live → `pending_buffer` / `answered_but_under_120_seconds`.
- Answered 30s and already hung up → `rejected` / `under_120_seconds`.
- Answered 121s and hung up → `qualified`, `wouldCreateCallLead: true`, preview duration 121, reason without the live-clock suffix.
- Answered 121s with no `terminalAt` → `qualified` and `inbound_target_answered_over_120s_webhook_elapsed_best_effort`. Preview `qualificationReason` stays the short string until a later, tested change.
- Outbound → `not_inbound` even when leftover store left `targetMatched` false.
- Mapped fields missing → `target_number_not_matched`.
- No normalized caller phone → `needs_review` / `missing_caller_phone_number`.
- Answered with no `answeredAt` → `needs_review` / `answered_missing_answered_at`.
- Missed / terminal unanswered → `not_answered`.
- `wouldCreateCallLead` stays false unless `decisionStatus === "qualified"`. This file never returns `ingestEligible`.

**Count answered seconds / hangup codes**
- No `answeredAt` → `0`.
- `terminalAt` wins over `now` when both exist.
- `now` wins when `terminalAt` is missing.
- The six hangup codes are terminal; `Answered` is not.

Do **not** add a test per helper (`refuseWhenThePartyIsNotInbound`, `askTheSharedTwoMinuteFacts`). Those names exist so the parent reads. If a helper test has to change when the helper is inlined, it was testing past the **interface**.

Do **not** add leftover ingest, leftover Call Log vet, leftover seed, or leftover analytics as this file’s proof. Leftover aggregator tests stay on leftover aggregator — they **ask** this interface; they do not own it.

## What I would not do

- A `CallCandidateEvaluatorService` class with `create` / `update` / `delete`.
- Thirty two-line functions that only wrap an existing call.
- Moving this into a CRUD folder (`evaluate.ts` / `duration.ts` / `terminal.ts`) “for cleanliness.”
- Breaking leftover aggregator’s qualified-vs-ingest **seam**. Live two-minute qualify must stay legal here.
- Treating leftover `ingestRingCentralQualifiedCall` or leftover `vetRingCentralCallLogRecord` as this story. Those are different **adapters** of Call Qualification / Call Lead Ingestion.
- Inventing a Call Log **seam** that has only one **adapter** (this file never reads Call Log).
- Silently merging leftover `qualifyRingCentralCall` into this file, or silently requiring hangup for `wouldCreateCallLead`, while recommending a rename.
- Jumping to leftover ingest while this service still has unchecked Wave A modules.
- Writing a whole-folder recommendation for `ringcentral`.
