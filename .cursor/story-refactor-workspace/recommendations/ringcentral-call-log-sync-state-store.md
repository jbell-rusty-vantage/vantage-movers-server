# Call Log Sync State — operational story

- Status: recommended
- Service: `ringcentral` (Wave A, in-progress)
- Pass: 13 of this service — `call-log-sync-state.store.ts`
- Remaining in this service: `call-log-vetting.ts`, `analytics-reconcile.service.ts`, `auth.ts`
- Target: `src/services/ringcentral/call-log-sync-state.store.ts`
- Knowledge: [`docs/knowledge/services/ringcentral-call-lead-qualification.md`](../../../docs/knowledge/services/ringcentral-call-lead-qualification.md) (section 3 lease/cursor table: one `key: "account"` row; five-minute renewable lease; cursor advances only in the fenced full-success update; unique `{ key: 1 }` index `ringcentral_call_log_sync_state_key_unique`; runtime never creates it and fails closed when it is absent; related-modules row: “Singleton cursor + five-minute renewable run lease with owner-fenced writes”). Distinct from already-recommended sweep: [recommendations/ringcentral-call-log-sync.md](ringcentral-call-log-sync.md) (`runRingCentralCallLogSync` **asks** claim / renew / success / error / assert / mint / mask; this file does not open the twelve-hour window, page Call Log, vet, observe a route, or promote). Distinct from later-checklist Call Log vet: `call-log-vetting.ts`. Distinct from already-recommended promote: [recommendations/ringcentral-call-lead-ingest.md](ringcentral-call-lead-ingest.md). Distinct from later-checklist analytics: `analytics-reconcile.service.ts` (count-level only — must not create). Distinct from skipped config / metrics / mongo helper (`getRingCentralCollectionName("callLogSyncState")` / `getRingCentralDb` — this file **asks** those). Distinct from Wave B `src/routes/ringcentral-cron.routes.ts` (trigger and mapper only — maps `lease_held` to `{ ok: true, skipped: true }`; never talks to this file). Distinct from `scripts/migrations/granot-lifecycle-indexes.ts` (deploys the unique key; this file only **declares** `RINGCENTRAL_CALL_LOG_SYNC_STATE_KEY_INDEX`). Distinct from already-recommended Granot lifecycle projections: `granotLifecycle/projections.ts` **asks** `getCallLogSyncState` for health — it does not elect a winner. This checkout’s `CONTEXT.md` does not define Call Qualification / Call Log — the knowledge file links a parent glossary this tree does not ship. Do not invent a glossary copy. `docs/adr/` is absent here — do not invent an ADR copy. Do not add this path to knowledge in this rename.
- Callers: already-recommended sweep `call-log-sync.service.ts` (**asks** `assertCallLogSyncStateSingletonIndex`, `createCallLogSyncLeaseOwner`, `maskLeaseOwner`, `acquireCallLogSyncLease`, `renewCallLogSyncLease`, `recordCallLogSyncSuccess`, `recordCallLogSyncError`; **wires** `releaseCallLogSyncLease` on the injectable bag and never **asks** it). Already-recommended Granot lifecycle projections `granotLifecycle/projections.ts` (`projectRingCentralHealth` **asks** `getCallLogSyncState` only). Migrations `scripts/migrations/granot-lifecycle-indexes.ts` + `.lib.ts` import the index declaration. This file’s `call-log-sync-state.store.test.ts` (AC-17; Mongo proofs replica-gated). `call-log-sync-lease.replica.test.ts` **asks** `getCallLogSyncState` / mint / key / index to observe after a real sweep. Already-recommended sweep’s file test injects the lease **adapters** and only imports the document type. Wave B cron, Call Log vet, already-recommended promote, analytics, auth, seed — **do not import this file’s functions**.
- Seams callers need: claim-or-skip vs held (`lease_held` means no provider, no promote, no cursor write); fenced renew / success / error / release (zero-document match means the former owner writes nothing); cursor-only-on-full-success vs error-leaves-cursor; index-assert vs migration-create (runtime never creates); health-read vs elect (`getCallLogSyncState` must not claim); mint / mask (events and reports never carry the raw owner)
- Split later (only if the file outgrows one sitting): this ~367-line file is one sitting if you read it as elect one sweeper on the account, keep the lease alive only while that owner still holds it, advance the high-water cursor only after a complete sweep that owner still owns, stamp a bounded failure without moving the cursor, and let a stale owner write nothing. If it later splits: `refuseWhenTheSingletonUniqueIndexIsMissing.ts` / `claimTheAccountLeaseOrSkip.ts` / `keepTheLeaseAliveOnlyWhileThisOwnerStillHoldsIt.ts` / `advanceTheCursorOnlyAfterACompleteSweepThisOwnerStillOwns.ts` / `stampABoundedFailureWithoutMovingTheCursor.ts` — story files, never `create.ts` / `update.ts` / `delete.ts` / `store.ts`, and never merge already-recommended sweep, Call Log vet, already-recommended promote, analytics, HTTP client, config, migrations, or Wave B cron HTTP into this file

`acquireCallLogSyncLease` / `recordCallLogSyncSuccess` / `RingCentralCallLogSyncStateDocument` are executor mechanics. The owner question is: *Only one Call Log sweep may own the account. Mint an opaque owner. Fail closed if the unique key index is missing — do not create it. Claim the singleton row when the lease is free or expired. If another sweep still holds it, say `lease_held` and do nothing else. Never wait. Never spin. While you own it, renew the five-minute lease; a miss means you lost it — stop and write nothing as the former owner. After every page and every qualified record finished, move `lastSyncFrom` / `lastSyncTo` and clear the lease. If fetch, throttle, or promote failed, stamp a bounded error code, leave the cursor where the last success left it, and clear the lease. A stale owner cannot renew, finalize, error-stamp, or release a successor. Health may read the row; it must not elect a winner. Do not fetch Call Log. Do not vet. Do not promote. Do not open the twelve-hour window.*

Already-recommended sweep, later Call Log vet, already-recommended promote, leftover analytics, leftover config names, leftover mongo helper, leftover metrics, leftover migrations, leftover Granot lifecycle health, and Wave B cron HTTP already live in other **modules**. Do not pull those in.

## What this file actually does

Five operations of one “elect one sweeper on the account — keep the lease alive only while that owner still holds it — advance the high-water cursor only after a complete sweep that owner still owns — on failure stamp a bounded error and leave the cursor where it was — a stale owner writes nothing — never create the unique index — never wait” story, not “a sync-state CRUD store,” and not already-recommended sweep / Call Log vet / promote:

1. **Refuse when the singleton unique index is missing** — `assertCallLogSyncStateSingletonIndex`. Shape-check unique `{ key: 1 }` only. Runtime never creates the index. Missing → throw. This beat does **not** claim. This beat does **not** deploy the index.

2. **Elect the one sweeper** — mint `createCallLogSyncLeaseOwner` (`rcls_` + 32 hex). `acquireCallLogSyncLease` on `key: "account"` when `leased_until` is missing, null, or `<= now` (`$not: { $gt: now }`). Winner of an existing row gets `returnDocument: "before"` as `state` (the predecessor’s committed cursor). `recovered` is true only when that predecessor still had `lease_owner` and an expired `leased_until`. First run inserts the singleton; unique-key `11000` is `lease_held`, not a second row. A live holder is also `lease_held`. Never waits. Never spins. This beat does **not** fetch Call Log. This beat does **not** move the cursor.

3. **Keep the lease alive only while this owner still holds it** — `renewCallLogSyncLease`. Fence `{ key, lease_owner, leased_until: { $gt: now } }`. Match → `now + 5m`. Zero-document match → `renewed: false`. The caller must stop new work and must not write terminal state as the former owner. This beat does **not** clear the lease. This beat does **not** stamp success or error.

4. **Advance the cursor only after a complete sweep this owner still owns** — `recordCallLogSyncSuccess`. The only place `lastSyncFrom` / `lastSyncTo` move. Same owner fence. Writes counts + telemetry (nonnegative floor), `lastRunStatus: "success"`, clears `lastError`, `$unset`s the lease. Fence miss → `false` and nothing written. This beat does **not** rewind a prior cursor. This beat does **not** fetch or promote.

5. **Stamp a bounded failure without moving the cursor** — `recordCallLogSyncError`. Closed set only (`route_snapshot_failed` / `provider_request_failed` / `provider_throttled` / `ingest_failed` / `state_write_failed` / `lease_lost` / `unknown_error`); anything else becomes `unknown_error`. Same owner fence. Leaves `lastSyncFrom` / `lastSyncTo` exactly as the last success left them. `$unset`s the lease. Fence miss → `false`. `releaseCallLogSyncLease` is the same fence with no terminal fact — already-recommended sweep **wires** it and never **asks** it, because success / error already clear the lease, and a lease-lost former owner must not clear a successor.

There is no window-open operation. There is no Call Log fetch. There is no vet. There is no promote. There is no Lead write. Already-recommended `runRingCentralCallLogSync` is the sweep **adapter** that **asks** this file. Later `vetRingCentralCallLogRecord` is the Call Log qualification **adapter**. Already-recommended `ingestRingCentralQualifiedCall` is the only promotion **adapter**. Wave B cron HTTP is a trigger **adapter**. Migration apply is the index-deploy **adapter**.

`getCallLogSyncState` / `maskLeaseOwner` / `RINGCENTRAL_CALL_LOG_SYNC_STATE_KEY_INDEX` sit on the elect / health / deploy path. They are not extra owner operations. Do not invent a dashboard for `last_adopted_count` in this rename. Do not export `ownerFence` or `isDuplicateKeyError` as a public **seam**.

## Organization

Keep one file as the screenplay for “elect one sweeper on the account, keep the lease alive only while that owner still holds it, advance the high-water cursor only after a complete sweep that owner still owns, stamp a bounded failure without moving the cursor, and let a stale owner write nothing.” Already-recommended sweep, later Call Log vet, already-recommended promote, leftover analytics, leftover config names, leftover mongo helper, leftover metrics, leftover migrations, leftover Granot lifecycle health, and Wave B cron HTTP already live in deeper **modules**. Do not pull those in. Do not invent a `CallLogSyncStateStoreService` class. Do not invent a begin / complete **seam** — already-recommended sweep already owns the run; this file owns the fenced row. Do not invent a sweep **adapter** beside already-recommended `runRingCentralCallLogSync`. Do not invent a vet **adapter** beside later `vetRingCentralCallLogRecord`. Do not invent a promote **adapter** beside already-recommended `ingestRingCentralQualifiedCall`.

Do not split this into `create.ts` / `update.ts` / `delete.ts` / `store.ts`. Those are persistence verbs, not the owner story. Do not move claim into already-recommended sweep so “one file owns elect and persist.” Do not move the unique index create into this file so “runtime can self-heal.” Do not silently advance the cursor on error so “we make progress.” Do not silently release on lease-lost so “every path clears.”

**External interface** stays small (this is the test surface). Refuse-index, elect, renew, success, and bounded-error are one story’s singleton coordination, not five CRUD verbs:

| Keep exporting | Story name | Why the seam exists |
|---|---|---|
| `assertCallLogSyncStateSingletonIndex` | `refuseWhenTheSingletonUniqueIndexIsMissing` | already-recommended sweep’s first beat; runtime never creates |
| `acquireCallLogSyncLease` | `claimTheAccountLeaseOrSkip` | already-recommended sweep elects; loser is `lease_held` |
| `renewCallLogSyncLease` | `keepTheLeaseAliveOnlyWhileThisOwnerStillHoldsIt` | already-recommended sweep renews before the long fetch and while work remains |
| `recordCallLogSyncSuccess` | `advanceTheCursorOnlyAfterACompleteSweepThisOwnerStillOwns` | the only cursor move; fenced |
| `recordCallLogSyncError` | `stampABoundedFailureWithoutMovingTheCursor` | already-recommended sweep’s failure path; cursor stays |
| `releaseCallLogSyncLease` | `clearTheLeaseWithoutChangingTheCursor` | fenced no-fact clear; sweep never **asks**; tests prove a stale owner cannot clear a successor |
| `getCallLogSyncState` | `showTheCurrentCursorAndLease` | leftover Granot lifecycle health + replica observe; the sweep uses `claim.state`, not this |
| `createCallLogSyncLeaseOwner` | `mintAnOpaqueSweeperIdentity` | already-recommended sweep mints before claim |
| `maskLeaseOwner` | `hideTheOwnerInLogsAndEvents` | already-recommended sweep events; never the raw owner |
| `RINGCENTRAL_CALL_LOG_SYNC_STATE_KEY_INDEX` | `theSingletonUniqueKeyIndex` | leftover migrations deploy; this file only declares |
| `RINGCENTRAL_CALL_LOG_SYNC_ERROR_CODES` | `theBoundedFailureCodes` | closed set; never a provider body |
| `RingCentralCallLogLeaseClaim` | `WhetherThisSweeperWonOrMustSkip` | winner carries predecessor `state`; loser is `lease_held` |

Keep the old names as one-line aliases until already-recommended sweep, leftover Granot lifecycle health, leftover migrations, the file test, and replica tests migrate. Do not make callers learn `findOneAndUpdate` / `ownerFence` / `$unset` / `11000` as the domain language.

**Principle: old exports stay as aliases.** `acquireCallLogSyncLease` remains the imported name until already-recommended sweep migrates. `recordCallLogSyncSuccess` remains the imported name until already-recommended sweep migrates. `getCallLogSyncState` remains the imported name until leftover Granot lifecycle health migrates.

**No class for the workflow.** The type that *does* earn a name is the claim already-recommended sweep already branches on:

```ts
type WhetherThisSweeperWonOrMustSkip =
  | {
      acquired: true
      owner: string
      leaseAcquiredAt: Date
      leasedUntil: Date
      recovered: boolean          // expired predecessor only — not a clean unset
      state: TheAccountCursorAndLease | null
    }
  | { acquired: false; reason: "lease_held" }

type TheAccountCursorAndLease = {
  lastSyncFrom: Date | null
  lastSyncTo: Date | null
  lastRunStatus: "success" | "error" | null
  lastError: BoundedFailureCode | null
  lease_owner?: string
  leased_until?: Date
}
```

That is the handoff from “a cron tick arrived” to “already-recommended sweep may skip, open the window from `state`, or stop when a later fence misses.” Do **not** add `records[]` so “the state row can replace Call Log vet,” do **not** add `callerPhoneNumber` so “the owner can see who called,” and do **not** add `windowFrom` so “this file can replace `resolveWindowStart`.”

Do not add `runRingCentralCallLogSync` as a public story **seam** on this file — already-recommended sweep already owns that export. Do not add `vetRingCentralCallLogRecord` as a public **seam** — later Call Log vet already owns that. Do not add `ingestRingCentralQualifiedCall` as a public **seam** — already-recommended promote already owns that. Do not export `ownerFence` as a public **seam** — it exists so the parent reads.

## The file, as a story

Parent functions stay deep. Child names are only extracted when they hide a real decision, not a one-liner.

```ts
// call-log-sync-state.store.ts
// Only one Call Log sweep may own the account.
// Mint an opaque owner.
// Fail closed if the unique key index is missing. Do not create it.
// Claim when the lease is free or expired.
// If another sweep still holds it, say lease_held. Never wait.
// Renew only while this owner still holds the fence.
// Move the cursor only after a complete sweep this owner still owns.
// On failure, stamp a bounded code and leave the cursor where it was.
// A stale owner writes nothing.

// ── 1. Refuse when the singleton unique index is missing ──

export async function refuseWhenTheSingletonUniqueIndexIsMissing()
function theUniqueKeyIndexIsPresent(indexes)

// ── 2. Elect the one sweeper ──────────────────────────────

export function mintAnOpaqueSweeperIdentity()
export function hideTheOwnerInLogsAndEvents(owner)
export async function claimTheAccountLeaseOrSkip({ owner, now })
function theLeaseIsFreeOrExpired(now)                 // leased_until missing, null, or <= now
function thisClaimTookOverAnExpiredPredecessor(previous)
async function insertTheFirstAccountRowOrTreatADuplicateAsHeld(leaseSet)
function neverWaitOrSpin()

// ── 3. Keep the lease alive only while this owner still holds it

export async function keepTheLeaseAliveOnlyWhileThisOwnerStillHoldsIt({ owner, now })
function theOwnerFence(owner, now)                    // key + owner + leased_until > now
function aMissMeansStopAndWriteNothingAsTheFormerOwner()

// ── 4. Advance the cursor only after a complete sweep ─────

export async function advanceTheCursorOnlyAfterACompleteSweepThisOwnerStillOwns(params)
function moveLastSyncFromAndLastSyncToOnlyHere(syncFrom, syncTo)
function stampNonnegativeTelemetry(telemetry)
function clearTheLeaseOnTheSameFencedWrite()

// ── 5. Stamp a bounded failure without moving the cursor ──

export async function stampABoundedFailureWithoutMovingTheCursor(params)
function persistOnlyAClosedErrorCode(errorCode)
function leaveTheCursorExactlyWhereTheLastSuccessLeftIt()
export async function clearTheLeaseWithoutChangingTheCursor({ owner, now })
export async function showTheCurrentCursorAndLease()   // health / observe — never elects
```

Read the primary path out loud: *Assert the unique key index. Mint an opaque owner. Claim the account lease. If another sweep holds it, return `lease_held`. Do not fetch. Do not promote. Do not move the cursor. If we won an existing row, hand the predecessor’s committed cursor back as `state`. Mark `recovered` only when that predecessor still had an expired lease. If the row does not exist yet, insert it; a duplicate key is `lease_held`, not a second singleton. Renew only while the fence still matches. A miss means stop and write nothing as the former owner. After the whole sweep finished, move `lastSyncFrom` / `lastSyncTo` on the same fenced write that clears the lease. If the sweep failed, stamp a bounded code, leave the cursor, and clear the lease. A stale owner cannot renew, finalize, error-stamp, or release a successor. Health may read the row. Do not create the index. Do not wait. Do not open the twelve-hour window. Do not vet. Do not promote.*

That is the operation. `acquireCallLogSyncLease` is not.

## Precise logic I would tighten while renaming

These are real smells the story names make obvious. Do not “just rename.”

1. **`releaseCallLogSyncLease` is exported, tested, and never asked by the sweep.** Already-recommended sweep wires it on the injectable bag. `recordCallLogSyncSuccess` and `recordCallLogSyncError` already `$unset` the lease. Mid-run lease-lost must not release as the former owner — a successor may already own the row. Do not silently call `releaseCallLogSyncLease` after success so “we clean up.” Do not silently release on lease-lost so “every path clears.” Do not delete the export so “dead code” — the file test proves a stale owner cannot clear a successor.

2. **`$not: { $gt: now }` is the claim filter on purpose.** It is “missing OR null OR `<= now`.” `$exists: false` would leave an explicit null permanently unclaimable. Do not silently switch the claim filter to `$exists: false` so “absent means free.” Do not `$set` `leased_until: null` on clear — `$unset` is what makes the next claim a clean win (`recovered: false`), not a takeover.

3. **`recovered` is not “any second claim.”** It is true only when the predecessor still had `lease_owner` and `leased_until <= now`. A cleanly released or success-cleared row is `recovered: false` and still hands back `state.lastSyncTo`. Do not silently set `recovered: true` on every existing row so “we always warn.”

4. **First-run is find-then-insert, not upsert.** `findOneAndUpdate` on a missing row returns null. `insertOne` plus the unique key turns a first-run race into `lease_held`. Do not silently `upsert` without the unique index so “we always get a row.” Do not create the index at runtime so “the assert can pass.” Leftover migrations own deploy (`pnpm migration:granot-lifecycle:indexes`).

5. **The cursor moves in exactly one function.** `recordCallLogSyncSuccess` is the only writer of `lastSyncFrom` / `lastSyncTo`. Error leaves them. Lease-lost writes nothing. Do not silently move the cursor on `provider_throttled` so “we make progress.” Do not rewind a successful cursor without a reviewed recovery plan — knowledge already forbids that.

6. **A stale owner writes nothing.** Renew / success / error / release all use the same fence. After a successor claims, the former owner’s success with a huge `syncTo` returns `false` and the stored cursor stays. Do not silently stamp `failed` on lease-lost so “every miss notifies.” Already-recommended sweep degrades a fenced error-write miss to `lease_lost` and never `failed`.

7. **Unknown codes become `unknown_error`.** The closed set is seven codes. Never persist a provider body, caller value, or free-form message. Do not silently widen the set so “we can debug the 429 body.”

8. **`getCallLogSyncState` does not open the window.** Already-recommended sweep opens `windowFrom` from `claim.state` at win time. Leftover Granot lifecycle health **asks** the read for `cursor_to` / lease age. Do not silently have the sweep re-read after claim so “we get a fresher cursor” — that can see a successor. Do not have health **ask** `acquireCallLogSyncLease` so “the dashboard is live.”

9. **Leave sibling modules alone.** Already-recommended `runRingCentralCallLogSync` stays on already-recommended sweep. Later `vetRingCentralCallLogRecord` stays on later `call-log-vetting.ts`. Already-recommended `ingestRingCentralQualifiedCall` stays on already-recommended promote. `resolveWindowStart` stays on already-recommended sweep. `getRingCentralDb` stays on skipped `ringcentral-mongo.ts`. Collection names stay on skipped `ringcentral-config.ts`. Wave B cron HTTP stays in Wave B. Leftover migrations stay in leftover migrations. This file is the fenced row they **ask**.

## Testing

The **interface** is the test surface: `refuseWhenTheSingletonUniqueIndexIsMissing`, `claimTheAccountLeaseOrSkip`, `keepTheLeaseAliveOnlyWhileThisOwnerStillHoldsIt`, `advanceTheCursorOnlyAfterACompleteSweepThisOwnerStillOwns`, `stampABoundedFailureWithoutMovingTheCursor`, `clearTheLeaseWithoutChangingTheCursor`, `showTheCurrentCursorAndLease`, `mintAnOpaqueSweeperIdentity`, `hideTheOwnerInLogsAndEvents`.

Today’s `call-log-sync-state.store.test.ts` already names AC-17 at this **interface**. Pure contract tests always run (mint / mask / index declaration / bounded codes). Mongo proofs are replica-gated (`pnpm test:granot-lifecycle:replica -- --unit=21`). Keep those proofs. Name them as the operation when renaming.

**Refuse-index**
- The declared index is exactly unique `{ key: 1 }` named `ringcentral_call_log_sync_state_key_unique`.
- Once the leftover test database has that index, assert does not throw.
- Runtime never creates the index (the leftover test `before` creates it on the disposable database; leftover migrations own every other deploy).

**Elect**
- First claim inserts one `key: "account"` row, wins, `recovered: false`, `state: null`, cursor still null.
- Simultaneous first-run claimers yield exactly one winner; losers are `lease_held`; still one row.
- Simultaneous claims over an existing row yield exactly one winner.
- A held lease blocks takeover until exact expiry (`LEASE_MS - 1` loses; `LEASE_MS` wins and `recovered: true`).
- A unique-key insert of a second singleton row is `11000`.

**Renew**
- Renewal extends `leased_until` and blocks a claim at the old expiry.
- After a successor claims, the stale owner’s renew returns `renewed: false`.

**Cursor**
- Full success writes `lastSyncFrom` / `lastSyncTo`, floors telemetry, clears `lastError`, `$unset`s the lease fields.
- Terminal error keeps the prior cursor, stores a bounded code, `$unset`s the lease.
- Takeover after a clean success preserves `lastSyncTo` and is `recovered: false`.
- After a successor claims, the stale owner’s success / error / release all return `false` and move nothing.

**Release / observe**
- Safe release clears only lease fields and leaves `lastSyncTo` / `lastRunStatus`.
- `showTheCurrentCursorAndLease` is a read. It does not claim.
- Minted owners are `rcls_` + 32 hex, unique per call, length ≤ 64.
- Mask is a stable 12-hex digest and never a substring of the owner. Null in → null out.
- Failure codes are the closed seven-code set.

`call-log-sync-lease.replica.test.ts` is the Mongo proof that already-recommended sweep **asks** this file for overlap, expiry takeover, cursor immobility on failure, and rescan idempotency. Already-recommended sweep’s file test injects these **adapters** — it does not replace this file’s fence proofs. Wave B `ringcentral-cron.routes.test.ts` proves auth, disabled skip, `lease_held` skip, and a safe 500 — not this file’s fence.

Do **not** add a test per helper (`theLeaseIsFreeOrExpired`, `thisClaimTookOverAnExpiredPredecessor`, `theOwnerFence`). Those names exist so the parent reads. If a helper test has to change when the helper is inlined, it was testing past the **interface**.

## What I would not do

- A `CallLogSyncStateStoreService` class with `create` / `update` / `delete`.
- Thirty two-line functions that only wrap an existing call.
- Moving this into a CRUD folder (`create.ts` / `update.ts` / `delete.ts` / `store.ts`) for cleanliness.
- Breaking the claim-or-skip / cursor-only-on-full-success / stale-owner-writes-nothing **seam**. A held lease must not fetch, promote, or move the cursor. Error and lease-lost must leave `lastSyncTo` where the last success left it.
- Treating already-recommended sweep, later Call Log vet, already-recommended promote, leftover analytics, leftover migrations, or leftover Granot lifecycle health as this story.
- Inventing a **seam** that has only one **adapter**.
- Silently “fixing” a known order gap while recommending a rename: do not start creating the unique index at runtime; do not rewind a successful cursor; do not move the cursor on throttle; do not release on lease-lost; do not persist a free-form error message.
- Jumping to the next service while this one has unchecked modules.
- Writing a whole-folder recommendation for `ringcentral`.
