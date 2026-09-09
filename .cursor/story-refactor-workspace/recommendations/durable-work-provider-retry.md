# Say What Kind Of Google Or Checksum Throw This Is — Then Only If It Is A Rate Limit Or A Blip, Decide Whether We Still Have Time To Try Again, Should Wait Past This Deadline, Or Must Stop — Never Sleep, Never Wrap Google, Never Write The Canned Reporting Sentence, Never Queue A Best Relocation Retry — operational story

- Status: recommended
- Service: `durableWork` (Wave A, in-progress)
- Pass: 7 of this service — `providerRetry.ts`
- Remaining in this service: `runTransitions.ts`, `testing.ts`
- Target: `src/services/durableWork/providerRetry.ts`
- Knowledge: none for this folder. Callers already have Services: [`docs/knowledge/services/ingestion.md`](../../../docs/knowledge/services/ingestion.md) (Best Relocation worker **asks** `classifyGoogleFailure` after `failRun`; rate-limit / transient **and** `trigger !== "retry"` queues one new `IngestionRun` `trigger: "retry"` then `publishIngestionWakeup` `reason: "retry"` — apply treats `invalid_request` as a row-scoped continue; knowledge never names `decideProviderRetry` / `providerStatus` / `Retry-After`), [`docs/knowledge/services/reporting.md`](../../../docs/knowledge/services/reporting.md) (Owner-designed, checksum-bound reports; knowledge never names `classifyGoogleFailure` — canned sentences and persist live on already-recommended [reporting-provider-failures.md](reporting-provider-failures.md) / [reporting-run-repository.md](reporting-run-repository.md)), [`docs/knowledge/services/google-sheets.md`](../../../docs/knowledge/services/google-sheets.md) (already-recommended [google-sheets-retry.md](google-sheets-retry.md) **sleeps** on 429 / 503 / quota-reason / “quota exceeded”; a 500 without `backenderror` is **not** a Sheets blip; that file never **asks** this one). Distinct from already-recommended [durable-work-leases.md](durable-work-leases.md) (named-scope fence; never classifies). Distinct from already-recommended [durable-work-checksum.md](durable-work-checksum.md) (`ChecksumMismatchError` `code: "CHECKSUM_MISMATCH"` / `name`; this file **matches** that name and that code). Distinct from already-recommended [durable-work-actors.md](durable-work-actors.md) (who is speaking; no throw). Distinct from already-recommended [durable-work-checkpoints.md](durable-work-checkpoints.md) (`NonMonotonicCheckpointError` `NON_MONOTONIC_CHECKPOINT` is **not** in this structural set). Distinct from already-recommended [durable-work-capability.md](durable-work-capability.md) (unused three-gate AND; reasons are not these classes). Distinct from already-recommended [durable-work-schema.md](durable-work-schema.md) (`failure.class` enum `structural | row | provider | lease | cancelled` is **not** `ProviderFailureClass`). Distinct from later `runTransitions.ts` (status graph + persist under the lease; does **not** classify a throw). Distinct from later `testing.ts` (in-memory fake; no Google). Distinct from skipped `types.ts` `ProviderFailureClass` / `ProviderRetryPolicy` / `RetryDecision` (this file **fills** those shapes; it does not name them). Distinct from already-recommended [ingestion-worker.md](ingestion-worker.md) (claim / fail / maybe queue one retry — **asks** classify, never decide). Distinct from already-recommended [ingestion-apply-plan.md](ingestion-apply-plan.md) (row-scoped continue when classify is `invalid_request`, else `ZodError` / `ValidationError` / `ConflictError` / `NotFoundError` by name). Distinct from already-recommended [reporting-provider-failures.md](reporting-provider-failures.md) (canned sentence + unused decide wrapper + PII assert — **asks** these three exports; does not re-walk HTTP 429 / 5xx / `ECONNRESET`). Distinct from already-recommended [reporting-delivery-engine.md](reporting-delivery-engine.md) (pack **asks** `retryable`, not `decideProviderRetry`). Distinct from already-recommended [reporting-reporting-worker.md](reporting-reporting-worker.md) (`toFailure` **asks** sanitize then `reportingFailure`; never decide). Distinct from already-recommended [google-sheets-retry.md](google-sheets-retry.md) (in-process sleep; different blip table). Distinct from Wave B `leadMessaging.service.ts` local `providerStatus` (Twilio string, not this export). Distinct from leftover Granot `runWorkflow.ts` (writes `failure.class` `provider` / `structural` itself and never **asks** this file). This checkout’s `CONTEXT.md` is a pointer plus four employee-booking terms — do not invent “Provider Failure Class” / “Retry Decision” copies. `docs/adr/` is absent here — do not invent ADR copies. Do not add a Durable Work Service in this rename.
- Callers: **three runtime families, plus one unused decide wrapper.** Already-recommended `reporting/google/providerFailures.ts` **asks** `classifyGoogleFailure` + `providerStatus` from `sanitizeReportingProviderFailure`; unused `decideReportingProviderRetry` **asks** `decideProviderRetry` after `Retry-After` seconds × 1000 — **no runtime caller** of decide. Already-recommended `ingestion/worker.ts` catch **asks** `classifyGoogleFailure` after `failRun`; `retryable_rate_limit` / `retryable_transient` **and** `trigger !== "retry"` creates `IngestionRun` `trigger: "retry"` `status: "applying"` when the plan is locked, else `createQueuedIngestionRun`, then `publishIngestionWakeup` `reason: "retry"`, then rethrow. Already-recommended `ingestion/applyPlan.ts` `isRowScopedCommandError` **asks** `classifyGoogleFailure === "invalid_request"` before the name list. Barrel `durableWork/index.ts` re-exports this file. Folder test `durableWork.test.ts` **asks** classify (429 / `ETIMEDOUT` / 401 / 403 / 404 / 400 / `CHECKSUM_MISMATCH`) and one decide `retry` (attempt 2, `random: () => 0.5`, `base_delay_ms: 1000` → `delay_ms: 1000`). Not this **interface**: `sanitizeReportingProviderFailure`, `decideReportingProviderRetry`, `withSheetsRetry`, `failRun`, `isRowScopedCommandError`, `reportingFailure`, Twilio `providerStatus`.
- Seams callers need: say-what-kind-of-throw vs decide-retry-defer-or-fail (ingestion classifies only; unused reporting decide **asks** both); classify vs canned reporting sentence (reporting **asks** class then writes sentences persist may keep); classify vs Sheets sleep (different blip tables; Sheets **never asks** this file); `ProviderFailureClass` vs schema `failure.class`; `providerStatus` exported separately because reporting needs HTTP on the canned bag; `Retry-After` is **not** parsed here — unused reporting decide parses seconds and passes `retry_after_ms`. There is no begin / complete Domain Command **seam**. There is no sleep **adapter**. There is no Google wrap **adapter**. There is no “queue the wakeup” **adapter**. There is no persist **adapter**.
- Split later (only if the file outgrows one sitting): this ~139-line file is one sitting if you read it as say what kind of Google or checksum throw this is — then only if it is a rate limit or a blip, decide whether we still have time to try again, should wait past this deadline, or must stop. If it later splits: `sayWhatKindOfGoogleOrChecksumThrowThisIs.ts`, `decideWhetherWeStillHaveTimeToTryAgainShouldWaitPastThisDeadlineOrMustStop.ts` — never `classify.ts` / `retry.ts` / `create.ts` / `update.ts` / `delete.ts`. Canned reporting sentences, Sheets sleep, Best Relocation queue, and persist stay siblings / other services.

`classifyGoogleFailure` / `decideProviderRetry` / `providerStatus` are executor mechanics. The owner question is: *Google or a checksum just threw. Say what kind of throw it is — a rate limit, a transient blip, a missing login, a forbidden destination, a missing artifact, a bad request, a broken seal, or we do not know. Then, only if it is a rate limit or a blip, decide whether we still have time to try again, whether the next wait would miss the deadline so we should come back later, or whether we must stop. Honor a caller-supplied wait when one is already parsed. Otherwise back off from the base delay with jitter, never past the policy cap. This file does not sleep. This file does not wrap Google. This file does not write a canned reporting sentence. This file does not queue a Best Relocation retry. This file does not persist a run failure. This file does not wait for the Source Company sheet quota window — that already lives on already-recommended `googleSheets/retry.ts`.*

Who writes canned reporting sentences, who sleeps on a 429 for the Source Company sheet, who queues `IngestionRun` `trigger: "retry"`, and who persists `failure.class` already live in other **modules**. Do not pull those in.

## What this file actually does

One “say what kind of Google or checksum throw this is — then only if it is a rate limit or a blip, decide whether we still have time to try again, should wait past this deadline, or must stop” story with three owner operations, not “a retry helper,” and not Sanitize This Reporting Failure / Wait For The Quota Window / Queue This Best Relocation Retry:

1. **Say what kind of Google or checksum throw this is** — `classifyGoogleFailure`. Read `providerStatus` then `error.code` (trim, uppercase). Order is load-bearing: HTTP `429` → `retryable_rate_limit`; `408` **or** status `>= 500` → `retryable_transient`; `ECONNABORTED` / `ECONNRESET` / `ECONNREFUSED` / `EHOSTUNREACH` / `ENETUNREACH` / `ETIMEDOUT` / `UND_ERR_CONNECT_TIMEOUT` / `UND_ERR_HEADERS_TIMEOUT` → `retryable_transient`; `401` → `authentication`; `403` → `authorization`; `404` → `not_found`; `CHECKSUM_MISMATCH` / `INVALID_SCHEMA` / `CAPACITY_EXCEEDED` / `STRUCTURAL_FAILURE` **or** `error.name === "ChecksumMismatchError"` → `structural`; other `400–499` → `invalid_request`; else `unknown`. This beat does **not** sleep. This beat does **not** decide delay. This beat does **not** copy `error.message`.

2. **Decide whether we still have time to try again, should wait past this deadline, or must stop** — `decideProviderRetry`. A class that is not `retryable_rate_limit` / `retryable_transient` → `{ action: "fail" }` immediately. `attempt >= policy.max_attempts` **or** `now - policy.started_at >= policy.max_elapsed_ms` → fail. Else delay is `min(max_delay_ms, retry_after_ms)` when `retry_after_ms` is a finite number `>= 0`; otherwise `min(max_delay_ms, floor(exponential * random))` where exponential is `min(max_delay_ms, base_delay_ms * 2^max(0, attempt - 1))` and `random` is `policy.random ?? Math.random` clamped `0…1`. `retryAt = now + delay`. If `retryAt` would miss `deadline` **or** `started_at + max_elapsed_ms` → `{ action: "defer", not_before: now + max(delay, defer_delay_ms) }`. Else `{ action: "retry", delay_ms }`. This beat does **not** parse `Retry-After`. This beat does **not** sleep. This beat does **not** persist.

3. **Read the HTTP status off this throw** — `providerStatus`. `error.status`, else `error.statusCode`, else `error.response.status`. Accept a number or a three-digit string. Integer only. This beat is exported because reporting’s canned bag needs HTTP beside class; classify already **asks** it first.

There is no fourth mutate operation. Re-export through the barrel is convenience for reporting / ingestion, not a second story.

## Organization

Keep one file. This is the screenplay for “say what kind of Google or checksum throw this is — then only if it is a rate limit or a blip, decide whether we still have time to try again, should wait past this deadline, or must stop.” `ProviderFailureClass` / `ProviderRetryPolicy` / `RetryDecision` already live on skipped `types.ts`. Canned reporting sentences already live on already-recommended `reporting/google/providerFailures.ts`. Sheets sleep already lives on already-recommended `googleSheets/retry.ts`. Best Relocation queue already lives on already-recommended `ingestion/worker.ts`. Persist already lives on later `runTransitions.ts` / leftover workers. Do not pull those in. Do not invent a `DurableProviderRetryService` class. Do not invent a begin / complete Domain Command **seam**. Do not invent a per-workflow **seam** that has only Best Relocation as an **adapter**. Do not invent a sleep **seam** beside `delay_ms`. Do not invent a CRUD folder so “classify / retry each get a file.”

Do not move `sanitizeReportingProviderFailure` here so “one file owns the canned sentence.” Do not move `withSheetsRetry` here so “one retry owns Google.” Do not move `failRun` here so “classify owns the queue.” Do not add `Retry-After` parse here so “the unused decide becomes true.” Do not split `classify.ts` / `retry.ts`.

**External interface** stays small (this is the test surface):

| Keep exporting | Story name | Why the seam exists |
|---|---|---|
| `classifyGoogleFailure` | `sayWhatKindOfGoogleOrChecksumThrowThisIs` | reporting sanitize + Best Relocation worker queue + apply row-scoped continue |
| `decideProviderRetry` | `decideWhetherWeStillHaveTimeToTryAgainShouldWaitPastThisDeadlineOrMustStop` | unused `decideReportingProviderRetry` only; pack **asks** `retryable`, not this decide |
| `providerStatus` | `readTheHttpStatusOffThisThrow` | reporting canned bag needs HTTP beside class |

Keep the old names as one-line aliases until `reporting/google/providerFailures.ts`, `ingestion/worker.ts`, `ingestion/applyPlan.ts`, and `durableWork.test.ts` migrate. Do not make reporting learn `error.response.status` / `2 ** (attempt - 1)` as the domain language. Do **not** rename `ProviderFailureClass` strings (`retryable_rate_limit`, `retryable_transient`, `authentication`, `authorization`, `not_found`, `invalid_request`, `structural`, `unknown`) — reporting wrap metadata and worker `toFailure` already branch on those names. Do **not** rename `RetryDecision.action` (`retry` / `defer` / `fail`).

**No workflow class.** The one type that *does* earn a name already lives on skipped `types.ts`:

```ts
type WhatKindOfGoogleOrChecksumThrowThisIs =
  | "retryable_rate_limit"
  | "retryable_transient"
  | "authentication"
  | "authorization"
  | "not_found"
  | "invalid_request"
  | "structural"
  | "unknown"

type WhetherWeStillHaveTimeToTryAgain =
  | { action: "retry"; delay_ms: number; failure_class: WhatKindOfGoogleOrChecksumThrowThisIs }
  | { action: "defer"; not_before: Date; failure_class: WhatKindOfGoogleOrChecksumThrowThisIs }
  | { action: "fail"; failure_class: WhatKindOfGoogleOrChecksumThrowThisIs }
```

That is today’s `ProviderFailureClass` / `RetryDecision` — the handoff from “Google or a checksum threw” to “reporting can write a canned sentence, Best Relocation can queue one retry, apply can continue the walk.” Do **not** add `remediation` here so “reporting owns the class.” Do **not** add schema `failure.class` `row | provider | lease | cancelled` here so “one enum owns every nest.” Do **not** add `Retry-After` parse here so “Sheets sleep can share a header.”

Leave `ProviderFailureClass` on skipped `types.ts`. Leave canned sentences on already-recommended `providerFailures.ts`. Leave Sheets sleep on already-recommended `googleSheets/retry.ts`. Leave Best Relocation queue on already-recommended `ingestion/worker.ts`. Leave persist on later `runTransitions.ts`.

## The file, as a story

Parent functions stay deep. Child names are only extracted when they hide a real decision, not a one-liner.

```ts
// providerRetry.ts
// Google or a checksum just threw.
// Say what kind of throw it is:
// a rate limit, a transient blip, a missing login,
// a forbidden destination, a missing artifact,
// a bad request, a broken seal, or we do not know.
// Then, only if it is a rate limit or a blip,
// decide whether we still have time to try again,
// whether the next wait would miss the deadline
// so we should come back later,
// or whether we must stop.
// Honor a caller-supplied wait when one is already parsed.
// Otherwise back off from the base delay with jitter.
// Never past the policy cap.
// Do not sleep. Do not wrap Google.
// Do not write a canned reporting sentence.
// Do not queue a Best Relocation retry.
// Do not persist a run failure.
// Do not wait for the Source Company sheet quota window.

// ── 1. Say what kind of Google or checksum throw this is ─

export function sayWhatKindOfGoogleOrChecksumThrowThisIs(error: unknown)
  // 429 → rate limit
  // 408 or status >= 500 → transient blip
  // ECONN* / ETIMEDOUT / UND_ERR_* timeouts → transient blip
  // 401 → missing login
  // 403 → forbidden destination
  // 404 → missing artifact
  // CHECKSUM_MISMATCH / INVALID_SCHEMA / CAPACITY_EXCEEDED
  //   / STRUCTURAL_FAILURE / name ChecksumMismatchError → broken seal
  // other 4xx → bad request
  // else unknown
  // HTTP status wins over a structural code when the status is
  // 429 / 408 / 5xx / 401 / 403 / 404 — a 500 + CHECKSUM_MISMATCH
  // is a blip today

export const classifyGoogleFailure =
  sayWhatKindOfGoogleOrChecksumThrowThisIs

// ── 2. Decide whether we still have time ─────────────────

export function decideWhetherWeStillHaveTimeToTryAgainShouldWaitPastThisDeadlineOrMustStop(input: {
  failure_class: WhatKindOfGoogleOrChecksumThrowThisIs
  attempt: number
  retry_after_ms?: number
  now: Date
  deadline: Date
  policy: {
    max_attempts: number
    base_delay_ms: number
    max_delay_ms: number
    max_elapsed_ms: number
    defer_delay_ms: number
    started_at: Date
    random?: () => number
  }
}): WhetherWeStillHaveTimeToTryAgain {
  // not a rate limit or blip → fail
  // attempt exhausted or already past max elapsed → fail
  // delay = min(cap, caller wait) or min(cap, floor(exponential * jitter))
  // retryAt would miss deadline or started_at + max elapsed
  //   → defer, not_before = now + max(delay, defer_delay_ms)
  // else retry with delay_ms
}

export const decideProviderRetry =
  decideWhetherWeStillHaveTimeToTryAgainShouldWaitPastThisDeadlineOrMustStop

// ── 3. Read the HTTP status off this throw ───────────────

export function readTheHttpStatusOffThisThrow(error: unknown)
  // status, else statusCode, else response.status
  // number or exactly three digits

export const providerStatus = readTheHttpStatusOffThisThrow
```

Read the reporting wrap path out loud: *Sheets `writeValuesRaw` catches Google and **asks** `wrapProvider`. Wrap **asks** `sayWhatKindOfGoogleReportingFailureThisIsInCannedWords`, which **asks** `sayWhatKindOfGoogleOrChecksumThrowThisIs` and `readTheHttpStatusOffThisThrow`. The canned sentence never copies `error.message`. Pack then **asks** `retryable` — not `decideWhetherWeStillHaveTimeToTryAgainShouldWaitPastThisDeadlineOrMustStop`. Unused `decideReportingProviderRetry` is the only runtime-shaped caller of decide, and nobody **asks** it.*

Read the Best Relocation fail path out loud: *Worker catch **asks** `failRun` `INGESTION_WORKER_FAILED`. Then **asks** `sayWhatKindOfGoogleOrChecksumThrowThisIs`. A rate-limit or blip **and** this run was not already a retry queues one new `IngestionRun` `trigger: "retry"` — a locked plan stays `applying`, else a queued inspect — then `publishIngestionWakeup` `reason: "retry"`. Worker never **asks** decide. Apply **asks** classify only to say a bad request may continue the walk.*

That is the operation. `classifyGoogleFailure` is not.

## Precise logic I would tighten while renaming

These are real smells the story names make obvious. Do not “just rename.”

1. **The name says Google; the table also matches a broken seal.** `CHECKSUM_MISMATCH` / `ChecksumMismatchError` / `INVALID_SCHEMA` / `CAPACITY_EXCEEDED` / `STRUCTURAL_FAILURE` are not HTTP. Best Relocation apply **asks** `assertChecksum` before the walk — a mismatch is structural here so apply does **not** treat it as a row-scoped continue. Do not silently drop checksum from classify so “the name is honest” — apply would start continuing on a moved seal. Do not silently rename the export to `classifyProviderFailure` in this pass without an **interface** proof that reporting wrap still maps the same eight strings.

2. **HTTP status wins over a structural code on 429 / 408 / 5xx / 401 / 403 / 404.** A `500` plus `CHECKSUM_MISMATCH` is a blip today because `status >= 500` is checked first. A `400` plus `CHECKSUM_MISMATCH` is structural because structural beats other 4xx. Do not silently check structural first so “a broken seal is never a blip” — Best Relocation would stop queueing a retry on a 500 that also carries the checksum code.

3. **Two class vocabularies.** This file writes `retryable_rate_limit | retryable_transient | authentication | authorization | not_found | invalid_request | structural | unknown`. Already-recommended `durableRunControlFields` stores `structural | row | provider | lease | cancelled`. Leftover Granot `runWorkflow.ts` writes `provider` or `structural` itself and never **asks** this file. Do not silently merge the two lists so “one class owns every refuse.” Do not silently wrap Granot writes with classify so “the unused table becomes true.”

4. **Two Google retry tables.** Already-recommended `withSheetsRetry` retries 429 / 503 / quota reasons / “quota exceeded.” A 500 without `backenderror` is **not** a Sheets blip. This file treats every `>= 500` and `408` and the `ECONN*` family as a blip. Sheets never **asks** this file. Do not silently switch `withSheetsRetry` onto classify so “one table owns Google” — Source Company writes would start sleeping on 500 / `ECONNRESET`. Do not silently narrow this file to 429 / 503 so “it matches Sheets.”

5. **`decideProviderRetry` has no live caller except unused `decideReportingProviderRetry`.** Pack **asks** `retryable` then verify / replay. Best Relocation **asks** classify then queues a new run — it never computes `delay_ms`. Do not silently start pack **asking** decide so “the retry export is used.” Do not silently start worker **asking** decide so “one clock owns Best Relocation retry” — the queued run is a new document, not a sleep.

6. **`Retry-After` is parsed only by unused reporting decide.** This file accepts `retry_after_ms` when the caller already parsed it. Sheets parses `retry-after` seconds itself and sleeps. Do not silently add header parse here so “one file owns Retry-After.”

7. **Double sanitize can flip `unknown` into `retryable_transient`.** Already-recommended reporting wrap first wraps an unknown error as `IntegrationError` `statusCode` 502 (`retryable ? 503 : 502`). Pack then **asks** sanitize on that wrap. `providerStatus` reads `statusCode` 502 → classify returns `retryable_transient`. A non-retryable unknown can look retryable on the second pass. Do not silently stop wrapping or stop the second sanitize so “retryable stays honest.” Leave that on already-recommended [reporting-provider-failures.md](reporting-provider-failures.md).

8. **`NonMonotonicCheckpointError` is not structural here.** Already-recommended checkpoints throw `NON_MONOTONIC_CHECKPOINT`. This set matches `CHECKSUM_MISMATCH` by code and `ChecksumMismatchError` by name. A cursor that went backward is `unknown` if a worker classified it. Do not silently add that code so “one structural list owns every refuse.”

9. **Folder test is one happy retry and seven classify cases.** It never proves 408, 5xx, `statusCode`, `ChecksumMismatchError` by name, `INVALID_SCHEMA` / `CAPACITY_EXCEEDED` / `STRUCTURAL_FAILURE`, fail-immediate on authentication, attempt exhausted, already-elapsed fail, defer past deadline, caller `retry_after_ms`, or `unknown`. Add **interface** proofs of this file; do not treat the one `delay_ms: 1000` assert as this **interface**.

10. **Leave sibling modules alone.** Skipped `types.ts` owns the shapes. Already-recommended reporting sanitize owns canned sentences. Already-recommended Sheets retry owns in-process sleep. Already-recommended ingestion worker owns the queued retry. Later `runTransitions.ts` owns persist. Do not open those as a second recommendation this pass.

## Testing

The **interface** is the test surface: `sayWhatKindOfGoogleOrChecksumThrowThisIs`, `decideWhetherWeStillHaveTimeToTryAgainShouldWaitPastThisDeadlineOrMustStop`, and `readTheHttpStatusOffThisThrow`.

Today’s folder test **asks** the old names once. That is not enough for a story that claims eight classes and three decide actions.

Add tests that name the operation:

**Say what kind of Google or checksum throw this is**
- `response.status` 429 → `retryable_rate_limit`.
- `status` 408 or 500 / 502 / 503 → `retryable_transient`.
- `code` `ETIMEDOUT` / `ECONNRESET` (case-insensitive after trim) → `retryable_transient`.
- `status` 401 → `authentication`; 403 → `authorization`; 404 → `not_found`; 400 → `invalid_request`.
- `code` `CHECKSUM_MISMATCH` **or** `name` `ChecksumMismatchError` → `structural`.
- `code` `INVALID_SCHEMA` / `CAPACITY_EXCEEDED` / `STRUCTURAL_FAILURE` → `structural`.
- `{}` / a string throw → `unknown`.
- `status` 500 **and** `code` `CHECKSUM_MISMATCH` → `retryable_transient` (status wins). `status` 400 **and** `code` `CHECKSUM_MISMATCH` → `structural` (structural beats other 4xx).
- The function does **not** copy `error.message`. A test that asserts the raw Google text is testing past this **interface**.

**Read the HTTP status off this throw**
- `status` number, `statusCode` number, `response.status` number, and a three-digit string all return that integer.
- `"40"` / `"4000"` / a non-integer → `undefined`.
- Reporting sanitize still sees the same status this export returns.

**Decide whether we still have time to try again, should wait past this deadline, or must stop**
- Authentication / authorization / not_found / invalid_request / structural / unknown → `{ action: "fail" }` immediately, even when attempts remain.
- Rate-limit or transient, attempt below max, inside elapsed, `retryAt` inside both clocks → `{ action: "retry", delay_ms }`.
- Attempt 2, `base_delay_ms` 1000, `random` 0.5, no `retry_after_ms` → `delay_ms` 1000 (today’s locked assert).
- Finite `retry_after_ms` skips jitter and still caps at `max_delay_ms`.
- `attempt >= max_attempts` **or** `now - started_at >= max_elapsed_ms` → fail before delay.
- `retryAt` past `deadline` **or** past `started_at + max_elapsed_ms` → `{ action: "defer", not_before: now + max(delay, defer_delay_ms) }`.
- Unused at runtime stays unused unless pack or worker migrate. Do not silently construct a reporting wrap in this test so “the unused decide becomes true.”

**Out of scope for this interface**
- This file does not import `IngestionRun` / `ReportingRun` / `GranotAutomationRun`.
- This file does not write `INGESTION_WORKER_FAILED` or queue `trigger: "retry"`.
- This file does not write a canned reporting sentence or `remediation`.
- This file does not sleep or call `values.update`.
- This file does not persist schema `failure.class`.

Do **not** add a test per network-code constant. Those names exist so the parent reads. If a helper test has to change when the helper is inlined, it was testing past the **interface**.

The three exports stay exported because classify vs decide vs status-on-the-canned-bag are the **interface**, not a test leak. There is no fourth **adapter** until pack or worker **asks** decide.

## What I would not do

- A `DurableProviderRetryService` / `DurableWorkService` class with `create` / `update` / `delete`.
- Thirty two-line functions that only wrap the same status walk.
- Moving this into a CRUD folder (`classify.ts` / `retry.ts` / `create.ts`) for cleanliness.
- Breaking the classify / decide **seam**. Ingestion classifies then queues a new run. Reporting sanitize classifies then writes a canned sentence. Neither sleeps here.
- Treating `sanitizeReportingProviderFailure`, `withSheetsRetry`, `failRun`, `isRowScopedCommandError`, `reportingFailure`, or later `transition` as this story.
- Inventing a sleep **seam** that has only `delay_ms` as an **adapter**.
- Silently merging `ProviderFailureClass` with schema `failure.class`, silently switching Sheets retry onto this table, silently starting pack **asking** decide, or silently checking structural before 5xx.
- Jumping to `runTransitions.ts` before this file is on the checklist.
- Writing a whole-folder recommendation for `durableWork`.
