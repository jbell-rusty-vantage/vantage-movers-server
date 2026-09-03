# Recommendation: processed-calls-store.ts (RingCentral)

**Service:** `ringcentral`
**Module:** `src/services/ringcentral/processed-calls-store.ts`
**Date:** 2026-09-03
**Status:** recommendation only — do not implement in this pass
**OKF / CONTEXT.md / ADRs:** none in this checkout. Service: `docs/knowledge/services/ringcentral.md`. Related: `docs/knowledge/services/ringcentral-call-lead-ingest.md`. Spec: `docs/ringcentral-call-lead-ingest.md`.

## Current story (as the code tells it)

This file is the durable **processed-call ledger**: one Mongo row per physical RingCentral call so create and adopt never mint a second official Lead for the same session. Collection: `ringcentral_processed_calls`.

It answers three questions:

1. Does this physical call already have a ledger row?
2. After create, adopt, shadow, or dry-run, stamp that result.
3. Before adoption mutates a Lead, are the unique session and Call Log fences present?

`findProcessedCall` ORs `telephonySessionId`, `sessionId`, and `callLogId`. Empty keys return null. An optional Mongo `session` skips index ensure (transaction-safe).

`upsertProcessedCall` keys via `processedCallIdentityKey`: telephony session wins; else `callLogId`; neither is a no-op. Empty identity fields are stripped so sparse unique indexes ignore them. `$setOnInsert` keeps `firstProcessedAt`; `$set` writes the rest plus `updatedAt`. Session also skips index ensure.

`assertProcessedCallAdoptionIndexes` is a shape check (unique + sparse + single key). It does not create indexes. It does not require browse indexes.

Terminal statuses: `lead_created`, `lead_created_duplicate`, `lead_adopted`, `lead_adopted_duplicate`, `shadow_recorded`. `dry_run` is not terminal. The type includes `skipped`; ingest never writes `status: "skipped"` (it returns action `skipped_already_processed`). The store does not refuse overwriting a terminal row — skip lives in callers.

Index ensure: the test runner creates all four indexes on first use. Non-test runtime fail-closes if any of `RINGCENTRAL_PROCESSED_CALL_INDEXES` is missing. `assertProcessedCallAdoptionIndexes` only checks the two unique identity fences by shape, not name. Named-index ensure and the assert checker disagree (name + all four vs shape + two uniques).

Callers: `ringcentral-call-lead-ingest.service.ts` (find first and late in the default create txn; assert before convergence when create + (adoption on or call-log-only); upsert after injectable create/shadow/dry-run and inside the default create txn), `callLeadConvergence.service.ts` (find on not_found / race / post-adopt; assert before mutate; upsert inside `adoptRingCentralCall`). Wave B `src/routes/ringcentral-webhook.routes.ts` GET `/api/dev/ringcentral/processed-calls` → `listProcessedCalls`. Tests: `processed-calls-store.test.ts` (identity key, terminal adopt statuses, call-log unique index declaration — no Mongo find/upsert). Migrations import `RINGCENTRAL_PROCESSED_CALL_INDEXES`. Replica test asks assert + find after adopt.

## Owner question

This inbound call already qualified. Promote or adopt is about to act (or already acted). Look up by telephony session, session id, or Call Log id. If a terminal create, adopt, or shadow row exists, do not create a second Lead. After create, shadow, dry-run, or adopt, stamp the ledger. Prefer telephony session; else callLogId. Sparse unique ignores nulls. No identity → no row. Adoption must see both unique fences; runtime does not create indexes inside a transaction. Dry-run is not terminal.

## Current file map

| Region | Lines (approx.) | What it does today |
|---|---|---|
| Types, statuses, index names | 1–90 | Document type, five terminal statuses, four index declarations |
| `processedCallIdentityKey` | ~92–108 | Telephony session wins; else callLogId; else empty |
| Collection + `ensureProcessedCallIndexes` | ~110–160 | Get collection; test creates; non-test fail-closed |
| `findProcessedCall` | ~162–200 | `$or` on three ids; session skips ensure |
| `upsertProcessedCall` | ~202–270 | Identity key, strip empties, `$setOnInsert` / `$set` |
| `assertProcessedCallAdoptionIndexes` | ~272–320 | Shape-check two unique fences |
| `listProcessedCalls` | ~322–340 | Newest-first browse for the Wave B debug route |

## Why this is hard to change

A future agent will treat this as a generic unique-key upsert. The real story is: **same physical call, one ledger row, identity prefers session, skip is the caller, adoption is fenced by two unique indexes that runtime will not create in a transaction.**

If `find` and `upsert` are “just CRUD,” someone will `$set` null into a sparse unique key, create indexes inside `withTransaction`, or treat `dry_run` as terminal. If `assert` is folded into ensure, adoption will start creating indexes mid-transaction.

## Target story modules

Keep this file the processed-call **module**. Do not invent `create.ts` / `update.ts`. Do not introduce a `*Service` class. Reorganization first, then names an owner can read out loud.

### 1. `processedCallLedger` — look up whether this physical call already has a row

**Why it exists:** Ingest asks first. Convergence asks again on not_found, race, and after adopt. Empty keys mean “no row,” not “scan the collection.”

**Public interface (keep old export as alias):**

- `findProcessedCall(input, options?)` — today’s `$or`. Alias: same name.

**Does not:** upsert, refuse overwrite, decide skip vs create, talk to Call Log, shadow, or leads.

**Invariants:** empty identity → null. Session option skips index ensure.

### 2. `stampProcessedCall` — record the outcome after create, adopt, shadow, or dry-run

**Why it exists:** After the official or shadow path ran, write the ledger so the next webhook or Call Log row sees the same physical call.

**Public interface:**

- `upsertProcessedCall(doc, options?)` — today’s identity + `$setOnInsert` firstProcessedAt. Alias: same name.
- `processedCallIdentityKey(input)` — stay exported; ingest tests depend on it.

**Does not:** find, assert fences, create indexes, skip because status is terminal.

**Invariants:** no identity → no-op. Telephony session wins over callLogId. Strip empty identity fields. Session skips ensure.

### 3. `requireProcessedCallAdoptionFences` — refuse adoption when unique indexes are missing

**Why it exists:** Convergence and ingest must not adopt if a second session or Call Log id could insert a second row. This is a check, not a migration.

**Public interface:**

- `assertProcessedCallAdoptionIndexes()` — today’s shape check. Alias: same name.

**Does not:** create indexes, require browse indexes, upsert.

**Invariants:** unique + sparse + single key on session and on callLogId. Fail closed.

### 4. `processedCallIndexes` — declare and ensure the four indexes

**Why it exists:** Migrations and the test runner need the declared list. Runtime fail-closes when any named index is missing. Keep this next to the ledger, not inside stamp.

**Public interface:**

- `RINGCENTRAL_PROCESSED_CALL_INDEXES` — unchanged export.
- `ensureProcessedCallIndexes` — keep as today’s helper (test creates; non-test fail-closed). No runtime callers of the named export.

**Does not:** change which two fences adoption requires.

### 5. `listProcessedCallsForDebug` — newest-first browse

**Why it exists:** Only the Wave B `/api/dev/ringcentral/processed-calls` route. Not part of ingest.

**Public interface:**

- `listProcessedCalls(limit)` — alias: same name.

## Suggested file layout

```
src/services/ringcentral/processed-calls-store.ts   (barrel: aliases)
src/services/ringcentral/processedCallLedger.ts
src/services/ringcentral/stampProcessedCall.ts
src/services/ringcentral/requireProcessedCallAdoptionFences.ts
src/services/ringcentral/processedCallIndexes.ts
src/services/ringcentral/listProcessedCallsForDebug.ts
```

If the team wants fewer files, keep 1–3 as named sections in this file. Do not split by HTTP verb.

## What stays in the current file

Re-exports and types (`ProcessedCallDocument`, `ProcessedCallStatus`, `RINGCENTRAL_PROCESSED_CALL_TERMINAL_STATUSES`). Callers keep importing from `processed-calls-store.ts`.

## What must not move here

Ingest skip / create / adopt / shadow / dry-run. Convergence `adoptRingCentralCall`. Wave B webhook route. Migrations that create indexes. Call Log sync (later on this checklist).

## Naming

| Current | Story name | Why |
|---|---|---|
| `findProcessedCall` | keep + `processedCallLedger` | Owner: already processed? |
| `upsertProcessedCall` | keep + `stampProcessedCall` | Owner: write the result |
| `assertProcessedCallAdoptionIndexes` | keep + `requireProcessedCallAdoptionFences` | Check, do not create |
| `processedCallIdentityKey` | keep | Session wins |
| `ensureProcessedCallIndexes` | keep (indexes module) | Test create / runtime fail-closed |
| `listProcessedCalls` | keep + `listProcessedCallsForDebug` | Debug browse only |

No `ProcessedCallsService`. No `createProcessedCall.ts`.

## Logic that must be preserved (do not “clean up”)

1. **`$or` find** on telephonySessionId / sessionId / callLogId. Empty keys → null.
2. **Identity:** telephony session, else callLogId, else no-op.
3. **Strip empty identity** before upsert so sparse unique indexes do not store null.
4. **`$setOnInsert` `firstProcessedAt`** — never reset on later stamps.
5. **Session skips ensure** on find and upsert (transaction-safe).
6. **Test runner creates all four; non-test fail-closed** if any named index missing.
7. **Assert is shape-only** on the two unique fences. Does not create. Does not require browse indexes.
8. **Terminal set** is the five create/adopt/shadow statuses. `dry_run` is not terminal. Store does not enforce terminal.
9. **Type `skipped` vs ingest:** ingest never writes `status: "skipped"`.
10. **Ensure vs assert disagreement:** named four vs two unique shapes — do not silently unify.
11. **`listProcessedCalls`** is debug-only.

## Side-effect order (do not silently reorder)

1. Caller qualifies the call (ingest / webhook / Call Log — not this file).
2. `findProcessedCall` (no session) — already processed?
3. If creating + (adoption on or call-log-only): `assertProcessedCallAdoptionIndexes` before convergence.
4. Official create / adopt / shadow / dry-run (not this file).
5. `upsertProcessedCall` — after injectable paths; inside default create txn (session set).
6. Convergence: find on not_found / race / post-adopt; assert before mutate; upsert inside adopt.

Do not create indexes inside `withTransaction`. Do not upsert before the official write on the default create path.

## Tests to add (at the new interfaces, not inside helpers)

1. **Empty identity find → null** (do not scan).
2. **`$or` hit** when only sessionId is stored and the caller has telephonySessionId equal to that sessionId.
3. **Identity key:** session wins; callLogId fallback; neither → empty.
4. **Upsert no-op** when identity is empty.
5. **Strip empty fields** — do not `$set` null into sparse unique keys.
6. **`$setOnInsert` firstProcessedAt** survives a second stamp.
7. **Session skips ensure** — find/upsert with session do not create indexes.
8. **Non-test missing index → throw** (do not create).
9. **Assert:** missing unique or non-sparse → throw; browse-only missing is ok.
10. **Terminal list** includes the five statuses; excludes `dry_run`.
11. **`listProcessedCalls`** newest-first, respects limit.

Existing `processed-calls-store.test.ts` stays the contract for identity + terminal adopt statuses + call-log unique declaration. Replica test stays the contract that assert + find run after adopt.

## Implementation order

1. Extract `processedCallIndexes` (constants + ensure). Migrations keep importing the array.
2. Extract ledger find. Alias.
3. Extract stamp + identity key. Alias.
4. Extract assert. Alias.
5. Extract debug list last.
6. Add the interface tests above.
7. Do not change ingest or convergence in the same PR beyond import paths.

## Out of scope

Call-log-sync, auth, analytics-reconcile (later on this checklist). Wave B webhook route body. Migrations that create indexes. Changing whether `dry_run` is terminal. Unifying ensure vs assert checkers.

## Leftover in this file after the split

Types, status union, terminal list, and aliases. If 1–3 stay as sections, leftover is only the debug list sitting beside the ledger.
