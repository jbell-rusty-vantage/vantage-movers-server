# Say Whether This Finalized Call Log Record Is An Inbound Answered Call Over Two Minutes To One Of Our Mapped Numbers — Never Create A Call Lead, Never Ingest, Never Wait For A Live Call — operational story

- Status: recommended
- Service: `ringcentral` (Wave A, in-progress)
- Pass: 14 of this service — `call-log-vetting.ts`
- Remaining in this service: `analytics-reconcile.service.ts`, `auth.ts`
- Target: `src/services/ringcentral/call-log-vetting.ts`
- Knowledge: [`docs/knowledge/services/ringcentral-call-lead-qualification.md`](../../../docs/knowledge/services/ringcentral-call-lead-qualification.md) (core-rule table: webhook evaluate vs this cron vet; section 3 step 4 is this file; invariant “never bypass evaluate / vet for the 120s rule”; related-modules row: “Call Log record qualification (cron)”). Distinct from already-recommended webhook evaluate: [recommendations/ringcentral-call-candidate-evaluator.md](ringcentral-call-candidate-evaluator.md) (`evaluateRingCentralCallCandidate` — live party, `pending_buffer`, hangup-vs-live under 120s, `answeredAt` → `terminalAt ?? now`; this file never waits and never reads a party). Distinct from leftover shared facts: `call-qualification.ts` (`qualifyRingCentralCall` + the 120s constant this file **asks**; knowledge still names the constant on already-recommended evaluate, which only re-exports it). Distinct from already-recommended sweep: [recommendations/ringcentral-call-log-sync.md](ringcentral-call-log-sync.md) (`runRingCentralCallLogSync` **asks** this file per record, then observes a matched target even when qualify fails, then **asks** already-recommended promote; this file does not fetch, lease, observe, or promote). Distinct from already-recommended lease/cursor: [recommendations/ringcentral-call-log-sync-state-store.md](ringcentral-call-log-sync-state-store.md). Distinct from already-recommended promote: [recommendations/ringcentral-call-lead-ingest.md](ringcentral-call-lead-ingest.md) (`ingestRingCentralQualifiedCall` — this file never builds `RingCentralQualifiedCall`). Distinct from leftover analytics: `analytics-reconcile.service.ts` (count-level only; imports the 120s constant from already-recommended evaluate, **not** this file; must not create). Distinct from leftover phone fold: `phone-normalization.ts` (this file **asks** `normalizePhoneNumberToE164Like`). Distinct from unvisited registry snapshot: `resolveRingCentralInboundRoute` (effective-dated; this file **asks** it only when `startTime` exists). Distinct from Wave B cron HTTP. The file comment still names `ringcentral-call-lead-api-probe.ts`; that script is **not** in this checkout and is not a caller. This checkout’s `CONTEXT.md` does not define Call Qualification / Call Log — the knowledge file links a parent glossary this tree does not ship. Do not invent a glossary copy. `docs/adr/` is absent here — do not invent an ADR copy. Do not add this path to knowledge in this rename.
- Callers: already-recommended sweep `call-log-sync.service.ts` (**asks** `vetRingCentralCallLogRecord` as the injectable `vetRecord` **adapter**). Already-recommended sweep’s `call-log-sync.service.test.ts` (type `RingCentralCallLogVetResult` only — the harness injects a fake bag and never runs this file). This file’s `call-log-vetting.test.ts` (mapped-inbound qualify, GetMovers qualify, under 120s, outbound, unmapped, missed, target-on-a-leg). Already-recommended evaluate, leftover facts, leftover analytics, already-recommended promote, Wave B cron, leftover auth, leftover seed — **do not import this file’s function**.
- Seams callers need: public vet (already-recommended sweep and a later probe, if restored, both **ask** the same export); qualify bag vs promote bag (this file never builds `RingCentralQualifiedCall`); matched-target vs qualifies (already-recommended sweep observes `matchedTargetNumber` even when `rejectionReasons` is nonempty); shared-facts **ask** (`qualifyRingCentralCall` is the one 120s gate both paths must keep)
- Split later (only if the file outgrows one sitting): this ~243-line file is one sitting if you read it as unfold the finalized Call Log record and its legs, find the mapped inbound target at call start, find the inbound caller, fold answered and the longest duration, then ask the same two-minute facts the webhook uses — never create a Call Lead, never ingest, never wait. If it later splits: `findTheMappedInboundTargetOnThisRecordOrALegAtCallStart.ts` / `findTheInboundCaller.ts` / `foldAnsweredAndTheLongestDuration.ts` / `askTheSharedTwoMinuteFactsAndHandBackQualify.ts` — story files, never `create.ts` / `update.ts` / `delete.ts` / `vet.ts`, and never merge already-recommended evaluate, leftover facts, already-recommended sweep, already-recommended promote, leftover analytics, leftover phone fold, or unvisited registry into this file

`vetRingCentralCallLogRecord` / `RingCentralCallLogVetResult` are executor mechanics. The owner question is: *A finalized Call Log record arrived from the sweep. Is this an inbound call to one of our mapped numbers that was answered for two minutes? Look at the record and its legs. Pick the first `to` that resolves in the run snapshot at call start. Pick the inbound caller. Treat Accepted / Completed / Connected / Call connected / Answered as answered on the record or any leg. Take the longest duration. Then ask the same inbound / mapped / answered / two-minute / caller-phone facts the webhook uses. If it qualifies, say so and hand identity plus route back. If the number is ours but the call was short, missed, or outbound, still say the target matched so the sweep can observe the route. Do not create a Call Lead. Do not ingest. Do not wait for a live call. Do not evaluate parties. Do not persist a session. The sweep decides whether to observe and whether to promote.*

Already-recommended evaluate, leftover shared facts, already-recommended sweep, already-recommended lease/cursor, already-recommended promote, leftover analytics, leftover phone fold, unvisited registry snapshot, leftover config names, and Wave B cron HTTP already live in other **modules**. Do not pull those in.

## What this file actually does

Four operations of one “say whether this finalized Call Log record is an inbound answered call over two minutes to one of our mapped numbers — never create a Call Lead, never ingest, never wait for a live call” story, not “a Call Log CRUD vetter,” and not already-recommended evaluate / sweep / promote:

1. **Find the mapped inbound target on this record or a leg at call start** — scan root then legs. Normalize each `to.phoneNumber`. **Ask** `resolveRingCentralInboundRoute(snapshot, phone, startTime)` only when `startTime` exists. First mapped hit wins. No mapped hit → keep the first normalized inbound `to` as `targetPhoneNumber` with `resolution: null`. Missing `startTime` cannot resolve a route (assignments are effective-dated). Default snapshot is empty and frozen — fail closed. This beat does **not** decide qualify. This beat does **not** observe a route.

2. **Find the inbound caller** — prefer `from` on parts whose `direction === "Inbound"` (record then legs). Else fall back to the record `from`. Normalize. This beat does **not** decide qualify.

3. **Fold answered and the longest duration** — answered if the record or any leg `result` is in `Accepted` / `Completed` / `Call connected` / `Connected` / `Answered`. Duration is `max` of root `duration`, `floor(durationMs / 1000)` (a zero from that path becomes “no durationMs”), and each leg `duration`. This beat does **not** wait. There is no `pending_buffer`. There is no live clock.

4. **Ask the shared two-minute facts and hand back qualify** — **ask** leftover `qualifyRingCentralCall` with direction, route, answered, duration, caller phone. `qualifies` is `rejectionReasons.length === 0`. `matchedTargetNumber` is `resolution !== null`, not `qualifies`. Return identity (`callLogId` / `sessionId` / `telephonySessionId` / `startTime`), phones, names, source snapshots, route, flags. This beat does **not** build `RingCentralQualifiedCall`. This beat does **not** **ask** already-recommended promote.

There is no evaluate-parties operation. There is no live wait. There is no session persist. There is no lease. There is no Call Log fetch. There is no Lead write. Already-recommended `evaluateRingCentralCallCandidate` is the webhook qualification **adapter**. Leftover `qualifyRingCentralCall` is the shared-facts **adapter**. Already-recommended `runRingCentralCallLogSync` is the sweep **adapter** that **asks** this file. Already-recommended `ingestRingCentralQualifiedCall` is the only promotion **adapter**. Unvisited `resolveRingCentralInboundRoute` is the route **adapter**. Wave B cron HTTP is a trigger **adapter**.

`overMinimumDuration` / `answered` / `sourceLabel` sit on the qualify bag. They are not extra owner operations. Do not invent a dashboard for `rejectionReasons` in this rename. Do not export `findTarget` / `isAnswered` / `EMPTY_ROUTE_SNAPSHOT` as a public **seam**.

## Organization

Keep one file as the screenplay for “unfold the finalized Call Log record and its legs, find the mapped inbound target at call start, find the inbound caller, fold answered and the longest duration, then ask the same two-minute facts the webhook uses — never create a Call Lead, never ingest, never wait.” Already-recommended evaluate, leftover shared facts, already-recommended sweep, already-recommended lease/cursor, already-recommended promote, leftover analytics, leftover phone fold, unvisited registry snapshot, leftover config names, and Wave B cron HTTP already live in deeper **modules**. Do not pull those in. Do not invent a `CallLogVettingService` class. Do not invent a begin / complete **seam** — this file never writes Mongo. Do not invent an evaluate **adapter** beside already-recommended `evaluateRingCentralCallCandidate`. Do not invent a facts **adapter** beside leftover `qualifyRingCentralCall`. Do not invent a promote **adapter** beside already-recommended `ingestRingCentralQualifiedCall`.

Do not split this into `create.ts` / `update.ts` / `delete.ts` / `vet.ts`. Those are persistence verbs / evaluator nouns, not the owner story. Do not move the 120s gate into already-recommended sweep so “qualify and promote live together.” Do not move this file into already-recommended evaluate so “one qualify function” without a paired test that leftover facts still has two **askers**. Do not add `pending_buffer` so “Call Log can wait.” Do not silently promote an unmatched row so “we always write a Lead.”

**External interface** stays small (this is the test surface). Find-target, find-caller, fold-answered-duration, and ask-facts are one story’s Call Log qualification, not four CRUD verbs:

| Keep exporting | Story name | Why the seam exists |
|---|---|---|
| `vetRingCentralCallLogRecord` | `sayWhetherThisFinalizedCallLogRecordQualifiesAsATwoMinuteInboundOnAMappedNumber` | already-recommended sweep **asks** it per record; a later probe, if restored, **asks** the same export |
| `RingCentralCallLogVetResult` | `WhetherThisCallLogRecordQualifiesAndWhichTargetMatched` | already-recommended sweep observes `matchedTargetNumber` even when qualify fails; file tests name the bag |

Keep the old names as one-line aliases until already-recommended sweep, the sweep file test’s type import, and this file’s test migrate. Do not make callers learn `ANSWERED_RESULTS` / `findTarget` / `EMPTY_ROUTE_SNAPSHOT` as the domain language.

**Principle: old exports stay as aliases.** `vetRingCentralCallLogRecord` remains the imported name until already-recommended sweep migrates. `RingCentralCallLogVetResult` remains the imported type until already-recommended sweep’s file test migrates.

**No class for the workflow.** The type that *does* earn a name is the qualify bag already-recommended sweep already branches on:

```ts
type WhetherThisCallLogRecordQualifiesAndWhichTargetMatched = {
  qualifies: boolean
  rejectionReasons: string[]      // leftover facts codes; may be several
  matchedTargetNumber: boolean    // resolution !== null — not qualifies
  routeResolution: RingCentralRouteResolution | null
  sourceCompany: string | null
  sourceLabel: string | null
  callerPhoneNumber: string | null
  callerName: string | null
  targetPhoneNumber: string | null  // first inbound `to` even when unmatched
  targetName: string | null
  callLogId: string | null
  sessionId: string | null
  telephonySessionId: string | null
  startTime: Date | null
  durationSeconds: number | null
  direction: string | null
  result: string | null
  answered: boolean
  overMinimumDuration: boolean
}
```

That is the handoff from “we judged this finalized Call Log record” to “already-recommended sweep may observe a matched target and may promote only when leftover facts said qualify and source / caller / route are present.” Do **not** add `wouldCreateCallLead` so “this file can replace already-recommended evaluate,” do **not** add `ingestionSource` so “this file can replace already-recommended promote,” and do **not** add `pending_buffer` so “Call Log can wait like a webhook.”

Do not add `qualifyRingCentralCall` as a public story **seam** on this file — leftover facts already owns that export. Do not add `evaluateRingCentralCallCandidate` as a public **seam** — already-recommended evaluate already owns that. Do not add `ingestRingCentralQualifiedCall` as a public **seam** — already-recommended promote already owns that. Do not export `findTarget` as a public **seam** — it exists so the parent reads.

## The file, as a story

Parent functions stay deep. Child names are only extracted when they hide a real decision, not a one-liner.

```ts
// call-log-vetting.ts
// A finalized Call Log record arrived from the sweep.
// Is this an inbound call to one of our mapped numbers
// that was answered for two minutes?
// Look at the record and its legs.
// Do not create a Call Lead. Do not ingest. Do not wait.

// ── 1. Find the mapped inbound target at call start ───────

function findTheMappedInboundTargetOnThisRecordOrALegAtCallStart(
  parts,
  snapshot,
  startTime,
)
function refuseToResolveARouteWhenCallStartIsMissing(startTime)
function keepTheFirstInboundToWhenNothingMapped(firstInboundTarget)

// ── 2. Find the inbound caller ────────────────────────────

function findTheInboundCaller(record, legs)
function preferFromOnInboundPartsThenTheRecordFrom(parts, record)

// ── 3. Fold answered and the longest duration ─────────────

function sayWhetherTheRecordOrALegWasAnswered(record, legs)
function takeTheLongestDuration(record, legs)           // duration / durationMs / legs
function neverWaitForALiveCall()

// ── 4. Ask the shared two-minute facts and hand back qualify

export function sayWhetherThisFinalizedCallLogRecordQualifiesAsATwoMinuteInboundOnAMappedNumber(
  record,
  snapshot = theEmptyFrozenSnapshot,
)

function unfoldTheRecordAndItsLegs(record)
function askTheSharedTwoMinuteFacts(direction, route, answered, duration, caller)
function matchedTargetMeansARouteResolvedNotThatTheCallQualifies(resolution)
function handBackQualifyIdentityAndRoute(facts, leftoverResult)
```

Read the primary path out loud: *Unfold the record and its legs. Find the first `to` that resolves in this run’s snapshot at call start; if none do, keep the first inbound `to` unmatched. Prefer the inbound-leg caller, then the record `from`. Treat Accepted / Completed / Connected / Call connected / Answered on the record or a leg as answered. Take the longest duration. Ask leftover shared facts the same inbound / mapped / answered / two-minute / caller-phone question. Hand back qualify, the leftover reasons, and whether a target matched. Do not create the Call Lead. Already-recommended sweep will observe a matched target even when this call does not qualify, and will promote only a qualified inbound through the same gate the webhook uses. Do not wait. Call Log is already over.*

That is the operation. `vetRingCentralCallLogRecord` is not.

## Precise logic I would tighten while renaming

These are real smells the story names make obvious. Do not “just rename.”

1. **`qualifies` is not already-recommended sweep’s promote gate.** Sweep promotes when `rejectionReasons` is empty **and** `sourceCompany`, `callerPhoneNumber`, and `routeResolution` are present. Leftover facts already require route and caller for `qualifies`. `sourceCompany` is `resolution?.company_slug`. Keep sweep’s extra checks on already-recommended sweep. Do not silently switch sweep to `if (!vet.qualifies) return` so “one flag” without a paired empty-`company_slug` test. Do not move those extra checks into this file so “vet owns promote.”

2. **`matchedTargetNumber` is not `qualifies`.** A short, missed, or outbound-shaped record can still resolve a mapped `to`. Already-recommended sweep observes that route before it looks at rejection. Do not silently set `matchedTargetNumber = qualifies` so “observation means promote.” Do not hide an unmatched first inbound `to` so “targetPhoneNumber only exists when mapped.”

3. **Missing `startTime` cannot resolve a route.** `findTarget` **asks** leftover registry only when `startTime` is a date. Effective-dated assignments need call start. Today’s file test always injects `2026-06-29`. Do not silently resolve against `new Date()` so “we still match.” That would pick the wrong assignment. Do not invent `pending_buffer` for a missing start.

4. **`durationMs` of under one second becomes “no durationMs.”** `Math.floor((durationMs ?? 0) / 1000) || null` turns `0` into `null`. Root `duration: 0` stays `0` and leftover facts reject `under_120_seconds`. Do not silently treat a null duration as `0` so “max is simpler” without a paired leftover-facts test. Do not drop the `durationMs` path so “Call Log always sends `duration`.”

5. **Answered is a Call Log result set, not already-recommended evaluate’s party flags.** `Voicemail` / `Missed` / `Gone` are not answered here even when duration is long. Already-recommended evaluate uses `answered` / `answeredAt` / hangup codes. Keep the two folds. Do not silently accept evaluate’s terminal statuses as answered so “one answered helper.” Do not merge this file into already-recommended evaluate so “one qualify function.”

6. **The empty snapshot default is fail-closed, not a convenience.** A forgotten snapshot matches nothing. Already-recommended sweep always passes the run snapshot. Do not silently load a live snapshot inside this file so “callers cannot forget.” That would invent I/O this file does not own.

7. **The probe-script comment is stale.** This checkout has no `ringcentral-call-lead-api-probe.ts`. Do not restore that script in this rename. Do not treat a gitignored probe as a second **adapter** that justifies a new public **seam**.

8. **Leave sibling modules alone.** Already-recommended `evaluateRingCentralCallCandidate` stays on already-recommended evaluate. Leftover `qualifyRingCentralCall` stays on leftover `call-qualification.ts`. Already-recommended `runRingCentralCallLogSync` stays on already-recommended sweep. Already-recommended `ingestRingCentralQualifiedCall` stays on already-recommended promote. `resolveRingCentralInboundRoute` stays on unvisited `operationsRegistry`. `normalizePhoneNumberToE164Like` stays on leftover phone fold. Leftover analytics stays on leftover analytics. Wave B cron HTTP stays in Wave B. This file orchestrates leftover facts and leftover registry resolve only.

## Testing

The **interface** is the test surface: `sayWhetherThisFinalizedCallLogRecordQualifiesAsATwoMinuteInboundOnAMappedNumber`.

Today’s `call-log-vetting.test.ts` already names mapped-inbound qualify (TBM Prime and GetMovers), under 120s, outbound (`not_inbound` + `target_number_not_matched`), unmapped, missed / `not_answered`, and target-on-a-leg. Keep those proofs. Name them as the operation when renaming. Fill the gaps the story names make obvious.

**Find the mapped inbound target**
- A mapped `to` on the root at call start → `matchedTargetNumber: true`, `sourceCompany` / `sourceLabel` from the snapshot.
- A mapped `to` only on a leg, root `to` unmapped → the leg wins; `targetPhoneNumber` is the mapped leg.
- An unmapped inbound `to` → `target_number_not_matched`, `matchedTargetNumber: false`, `targetPhoneNumber` still the first inbound `to`.
- Missing `startTime` → no route, even when the phone is mapped.
- Empty / omitted snapshot → no route.

**Find the inbound caller / fold answered and duration**
- Inbound-leg `from` wins over a missing or outbound-shaped record `from`.
- Root `Missed` and a `Completed` leg → `answered: true`.
- `Accepted` / `Call connected` / `Connected` / `Answered` qualify the same as `Completed` when the rest of leftover facts pass.
- `Voicemail` is `not_answered` even at 180s.
- Duration 120 qualifies; 119 is `under_120_seconds`.
- Longest of root `duration`, `durationMs`, and a longer leg wins.

**Ask the shared two-minute facts**
- Mapped inbound answered 180s with a caller → `qualifies: true`, `rejectionReasons: []`.
- Outbound long call to a customer number → `not_inbound` and `target_number_not_matched`.
- Mapped inbound missed → `not_answered`, `matchedTargetNumber: true` (sweep may still observe).
- Mapped inbound 45s Completed → `under_120_seconds`, `matchedTargetNumber: true`.
- Missing caller phone → `missing_caller_phone_number`.
- Several leftover reasons may be present together. `qualifies` is false unless the list is empty.
- This file never returns `wouldCreateCallLead`, `pending_buffer`, `ingestionSource`, or a Lead id.

Already-recommended sweep’s file test injects this **adapter** — it proves observe-then-promote, not this file’s folds. Do **not** add leftover ingest, leftover analytics, or already-recommended evaluate as this file’s proof.

Do **not** add a test per helper (`refuseToResolveARouteWhenCallStartIsMissing`, `takeTheLongestDuration`, `askTheSharedTwoMinuteFacts`). Those names exist so the parent reads. If a helper test has to change when the helper is inlined, it was testing past the **interface**.

## What I would not do

- A `CallLogVettingService` class with `create` / `update` / `delete`.
- Thirty two-line functions that only wrap an existing call.
- Moving this into a CRUD folder (`create.ts` / `update.ts` / `delete.ts` / `vet.ts`) for cleanliness.
- Breaking the matched-target / qualifies **seam**. A short inbound on a mapped number must still say the target matched so already-recommended sweep can observe the route without promoting.
- Treating already-recommended evaluate, leftover shared facts, already-recommended sweep, already-recommended promote, or leftover analytics as this story.
- Inventing a **seam** that has only one **adapter**.
- Silently “fixing” a known order gap while recommending a rename: do not add `pending_buffer`; do not resolve a route without `startTime`; do not merge leftover facts into this file; do not promote from this file; do not load a live snapshot here.
- Jumping to the next service while this one has unchecked modules.
- Writing a whole-folder recommendation for `ringcentral`.
