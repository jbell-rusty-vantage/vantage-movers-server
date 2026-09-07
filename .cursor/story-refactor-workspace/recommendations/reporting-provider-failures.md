# Say What Kind Of Google Reporting Failure This Is In Canned Words — Never The Customer's Email, Never The Cell Values — Then Only Retry A Rate Limit Or A Transient Blip If We Still Have Time — operational story

- Status: recommended
- Service: `reporting` (Wave A, in-progress)
- Pass: 29 of this service — `google/providerFailures.ts`
- Remaining in this service: `google/reportingSheetsAdapter.ts`, `google/reportingDriveAdapter.ts`, remaining `live/*` harness
- Target: `src/services/reporting/google/providerFailures.ts`
- Knowledge: [`docs/knowledge/services/reporting.md`](../../../docs/knowledge/services/reporting.md) (primary code is leftover `reporting.service.ts`. Role: Owner-designed, checksum-bound reports. Happy path: preview → immutable revision → two-step confirmed run → **worker write**. Skip / fail: “Run read failures — fixed safe envelopes; provider/source details are not exposed.” Knowledge never names this file, `sanitizeReportingProviderFailure`, `decideReportingProviderRetry`, `assertProviderErrorIsPiiSafe`, `SanitizedReportingProviderFailure`, `failure_class`, `remediation`, `owner_reconnect`, `owner_repair_destination`, `operator_review`, `Retry-After`, or leftover `classifyGoogleFailure` — do not add a Reporting Service file in this rename so “the Service sentence wins”). Distinct from already-recommended leftover closed-catalog run envelope: [`reporting-run-repository.md`](reporting-run-repository.md) (`reportingFailure` / `REPORTING_FAILURE_CODES` / `assertSafeReportingFailure` — leftover persist and leftover Owner read **ask** leftover canned `PROVIDER_*` / `INTERNAL_FAILURE` sentences; leftover worker `toFailure` **asks** leftover sanitize then leftover `reportingFailure`; leftover persist never **asks** leftover sanitize). Distinct from already-recommended leftover pack / write / replay: [`reporting-delivery-engine.md`](reporting-delivery-engine.md) (`writeBoundedReportingBatch` catch **asks** leftover `sanitizeReportingProviderFailure`; not retryable rethrows the original error; retryable **asks** leftover `verifyRange` then maybe leftover `writeValuesRaw` — leftover pack never **asks** leftover `decideReportingProviderRetry`). Distinct from already-recommended leftover claim / fail: [`reporting-reporting-worker.md`](reporting-reporting-worker.md) (`toFailure` **asks** leftover sanitize after leftover named-code reuse; leftover authentication → leftover `PROVIDER_AUTHENTICATION`; leftover authorization → leftover `PROVIDER_AUTHORIZATION`; leftover `retryable` → leftover `PROVIDER_UNAVAILABLE`; else leftover `INTERNAL_FAILURE` — leftover worker never **asks** leftover `decideReportingProviderRetry` and never persists leftover `remediation`). Distinct from leftover unvisited Sheets wrap: `google/reportingSheetsAdapter.ts` (`wrapProvider` **asks** leftover sanitize onto leftover `IntegrationError` message + leftover `failure_class` / leftover `remediation` metadata — leftover `writeValuesRaw` / leftover list / leftover create / leftover hide / leftover rename / leftover delete / leftover promote / leftover read / leftover markers all **ask** leftover wrap). Distinct from leftover unvisited Drive wrap: `google/reportingDriveAdapter.ts` (leftover `create_spreadsheet` / leftover `get_file` / leftover `trash_file` **ask** the same leftover wrap; leftover `assertSafeToTrashReportingArtifact` never **asks** leftover sanitize). Distinct from leftover unvisited durable-work classify / retry: `src/services/durableWork/providerRetry.ts` (`classifyGoogleFailure` / `providerStatus` / `decideProviderRetry` — leftover Wave A `durableWork/` is **unvisited**; this file **asks** those three and does not re-classify HTTP 429 / 5xx / `ECONNRESET`). Distinct from leftover unvisited live mask: `live/piiSafeEvidence.ts` (`sanitizeLiveTestString` redacts emails / Drive urls / Bearer / file ids — leftover live never **asks** leftover canned reporting sentences). Distinct from leftover unvisited live inject: `live/transientRetryWrapper.ts` (throws leftover `status: 503` “Injected transient Google 503” — leftover sanitize is not imported there). Distinct from leftover `google/index.ts` (barrel re-exports this file). This is not Admin Analytics and not Sheet Sync. This checkout’s `CONTEXT.md` does not define Reporting / Reporting Sheets — do not invent a glossary copy. `docs/adr/` is absent here — do not invent ADR copies (knowledge cites ADR-0001 Mongo SoR).
- Callers: leftover `deliveryEngine.ts` (`writeBoundedReportingBatch` catch **asks** leftover `sanitizeReportingProviderFailure`; leftover `retryable` false rethrows the same `error`; leftover `retryable` true **asks** leftover `verifyRange` / leftover replay — leftover pack never **asks** leftover decide or leftover assert). Leftover `reportingWorker.ts` (`toFailure` **asks** leftover sanitize after leftover named-code reuse; leftover maps leftover class → leftover `reportingFailure`). Leftover `google/reportingSheetsAdapter.ts` leftover `wrapProvider` **asks** leftover sanitize. Leftover `google/reportingDriveAdapter.ts` leftover `wrapProvider` **asks** leftover sanitize. Leftover `google/index.ts` re-exports everything. Tests: leftover `reportingDelivery.test.ts` acceptance 19 **asks** leftover sanitize on leftover `{ status: 500, message: "failed for customer@example.com named Ada Lovelace", values: [["Ada", "555-0100"]] }` → leftover `summary` has no `@` and no `Ada`; leftover `assertProviderErrorIsPiiSafe(sanitized)` does not throw; leftover assert on leftover `{ message: "row values leaked", values: "a,b,c" }` throws `/PII|cell/`; leftover then **asks** leftover `reportingFailure("PROVIDER_UNAVAILABLE")` / leftover `assertSafeReportingFailure` — those leftover envelopes are leftover run-repository, not this file. Leftover `reporting.test.ts` / leftover `reportingDelivery.regressions.test.ts` do not import this file. **No runtime caller** of leftover `decideReportingProviderRetry`. **No runtime caller** of leftover `assertProviderErrorIsPiiSafe` except leftover acceptance 19.
- Seams callers need: say-what-kind-of-Google-reporting-failure-this-is (`sanitizeReportingProviderFailure`) vs decide-whether-we-still-have-time-to-retry (`decideReportingProviderRetry`) vs refuse-to-persist-a-payload-that-still-looks-like-cells (`assertProviderErrorIsPiiSafe`). The classify / canned-sentence **seam** exists because leftover durable work **asks** leftover HTTP / leftover code; this file **asks** leftover class then writes leftover reporting sentences leftover persist may keep. The sanitize / wrap **seam** exists because leftover Sheets leftover wrap and leftover Drive leftover wrap **ask** leftover sanitize; leftover `IntegrationError` stay leftover adapters. The sanitize / write-replay **seam** exists because leftover pack **asks** leftover `retryable` then leftover verify / leftover replay — leftover pack never **asks** leftover decide. The sanitize / run-envelope **seam** exists because leftover worker leftover `toFailure` **asks** leftover sanitize then leftover `reportingFailure`; leftover persist leftover `assertSafeReportingFailure` never **asks** this file. The official-canned / live-redact **seam** exists because leftover live leftover `sanitizeLiveTestString` redacts; this file replaces the message. There is no begin / complete Domain Command **seam**. There is no Google write **seam**. There is no parse **seam**. There is no Analytics **seam**. There is no Sheet Sync **seam**. There is no leftover `ZZ1` stamp **seam**. There is no leftover Drive leftover trash leftover prove **seam**.
- Split later (only if the file outgrows one sitting): this ~141-line file is one sitting if you read it as say what kind of Google reporting failure this is in canned words — never the customer's email, never the cell values — then only retry a rate limit or a transient blip if we still have time. Do **not** split into `sanitize.ts` / `retry.ts` / `assert.ts` / `create.ts` / `update.ts` / `delete.ts`. Do **not** pull leftover `classifyGoogleFailure`, leftover Sheets leftover wrap, leftover Drive leftover wrap, leftover pack leftover replay, leftover worker leftover `toFailure`, leftover `reportingFailure`, leftover live leftover mask, or leftover live leftover inject here so “one failure file owns the company.” If it later splits: `sayWhatKindOfGoogleReportingFailureThisIsInCannedWords.ts` / `decideWhetherWeStillHaveTimeToRetryThisGoogleReportingFailure.ts` / `refuseToPersistThisProviderErrorIfItStillLooksLikeCells.ts` only as later story files, never CRUD.

`sanitizeReportingProviderFailure` / `decideReportingProviderRetry` / `assertProviderErrorIsPiiSafe` are executor mechanics. The owner question is: *When Google fails a reporting write, do not keep the customer's email, the cell values, or Google's raw message. Say what kind of failure it is in a canned sentence, and say whether the owner should retry, reconnect OAuth, repair the destination, wait on capacity, or stop. Then, only if the failure is a rate limit or a transient blip, decide whether we still have time to retry. Do not classify 429 versus 401 from this file — leftover durable work already does that. Do not wrap Google from this file. Do not replay a RAW write from this file. Do not fail the run from this file. Do not persist the original error.*

Already-recommended leftover pack replay, leftover worker fail, leftover run envelope already live in other **modules**. Leftover Sheets wrap, leftover Drive wrap, leftover durable-work classify, leftover live mask stay leftover. Do not pull those in. Do not open leftover `durableWork/` this pass.

## What this file actually does

Three operations of one “say what kind of Google reporting failure this is in canned words — never the customer's email, never the cell values — then only retry a rate limit or a transient blip if we still have time” story, not “a Google helper,” and not leftover Sheets wrap or leftover run envelope:

1. **Say what kind of Google reporting failure this is in canned words** — `sanitizeReportingProviderFailure`. **Asks** leftover `classifyGoogleFailure` and leftover `providerStatus`. `retryable` is `retryable_rate_limit` or `retryable_transient` only. `remediation`: rate-limit / transient → `retry`; `authentication` → `owner_reconnect`; `authorization` / `not_found` → `owner_repair_destination`; `structural` → `capacity`; `invalid_request` → `non_retryable`; `unknown` (default) → `operator_review`. `summary` is a closed sentence plus `(HTTP ${status})` when leftover status exists — this file never copies `error.message`. Leftover Sheets wrap and leftover Drive wrap **ask** leftover `summary` onto leftover `IntegrationError`. Leftover pack catch **asks** leftover `retryable`. Leftover worker `toFailure` **asks** leftover `failure_class`.

2. **Decide whether we still have time to retry this Google reporting failure** — `decideReportingProviderRetry`. **Asks** leftover sanitize, leftover `Retry-After` seconds × 1000 (first header, array takes `[0]`, non-finite / negative → `undefined`), then leftover `decideProviderRetry` with leftover `failure_class` / attempt / now / deadline / leftover `ProviderRetryPolicy`. Leftover durable work fails a non-retryable class immediately; rate-limit / transient may `retry` / `defer` / `fail`. **No runtime caller.** Leftover pack replay **asks** leftover `retryable`, not this decide.

3. **Refuse to persist a provider error that still looks like cells or PII** — `assertProviderErrorIsPiiSafe`. **Asks** leftover sanitize. Leftover `PII_LIKE` (`/@|phone|email|address|zip|name|formula|=HYPERLINK|=IMPORT|=QUERY/i`) on leftover `summary` throws “Sanitized provider summary must remain PII-free.” Then raw `message` / `body` / `data` / `values` / `range` strings that leftover `looksLikeCellPayload` (`,` / `\n` / starts with `=`) throw “Provider error payload may contain cell/PII content and must not be persisted.” `values` **arrays** are skipped (`typeof !== "string"`). Leftover acceptance 19 **asks** this on the sanitized envelope and on `{ values: "a,b,c" }`. Leftover persist **asks** leftover `assertSafeReportingFailure`, not this assert.

`SanitizedReportingProviderFailure` is the bag leftover wrap already writes (`failure_class`, optional `provider_status`, `retryable`, `remediation`, `summary`). It is not a fourth owner operation.

## Organization

Keep one file. This is the screenplay for “say what kind of Google reporting failure this is in canned words — never the customer's email, never the cell values — then only retry a rate limit or a transient blip if we still have time.” Leftover durable-work classify, leftover Sheets wrap, leftover Drive wrap, leftover pack replay, leftover worker `toFailure`, leftover run envelope, leftover live mask already live in deeper **modules**. Do not pull those in. Do not invent a `ReportingProviderFailureService` class. Do not invent a begin / complete Domain Command **seam**. Do not invent a second leftover classify **adapter** beside leftover `classifyGoogleFailure`. Do not invent a second leftover wrap **adapter** beside leftover `wrapProvider`. Do not invent a second leftover run envelope beside leftover `reportingFailure`. Do not open leftover `durableWork/` so “the classify lives with the sentences.”

Do not split leftover sanitize / leftover decide / leftover assert into CRUD files. Leftover sanitize stays with leftover decide because leftover decide **asks** leftover sanitize first. Do not start leftover `files.create` or leftover `values.update` from this file. Do not move leftover `wrapProvider` here so “the sentence owns Google.” Do not move leftover `toFailure` here so “the class owns the run.”

**External interface** stays small (this is the test surface):

| Keep exporting | Story name | Why the seam exists |
|---|---|---|
| `sanitizeReportingProviderFailure` | `sayWhatKindOfGoogleReportingFailureThisIsInCannedWords` | leftover pack replay + leftover worker `toFailure` + leftover Sheets wrap + leftover Drive wrap + leftover acceptance 19 |
| `decideReportingProviderRetry` | `decideWhetherWeStillHaveTimeToRetryThisGoogleReportingFailure` | unused at runtime; keep until leftover pack or leftover worker migrate onto it, or drop the alias |
| `assertProviderErrorIsPiiSafe` | `refuseToPersistThisProviderErrorIfItStillLooksLikeCells` | leftover acceptance 19 only |
| `SanitizedReportingProviderFailure` | `OurCannedGoogleReportingFailure` | leftover wrap metadata bag |

Keep the old names as one-line aliases until leftover `deliveryEngine.ts`, leftover `reportingWorker.ts`, leftover `google/reportingSheetsAdapter.ts`, leftover `google/reportingDriveAdapter.ts`, leftover `google/index.ts`, and leftover `reportingDelivery.test.ts` migrate. Do not make leftover pack learn leftover `decideWhetherWeStillHaveTimeToRetryThisGoogleReportingFailure`. Do not make leftover persist **ask** leftover `refuseToPersistThisProviderErrorIfItStillLooksLikeCells` so “one PII assert owns both stories.” Do not persist a new leftover `failure_class` string in this rename.

**No class for the workflow.** The type that *does* earn a name is the canned bag leftover wrap already writes:

```ts
type OurCannedGoogleReportingFailure = {
  failure_class: ProviderFailureClass
  provider_status?: number
  retryable: boolean
  remediation:
    | "retry"
    | "owner_reconnect"
    | "owner_repair_destination"
    | "operator_review"
    | "capacity"
    | "non_retryable"
  summary: string
}
```

That is the handoff from “Google threw” to “leftover wrap / leftover pack / leftover worker may **ask** `sayWhatKindOfGoogleReportingFailureThisIsInCannedWords`.” Do **not** put leftover `REPORTING_FAILURE_CODES` `code` on this type. Do **not** put leftover `vantage_live_test` on this type. Do **not** put cell values on this type.

## The file, as a story

Parent functions stay deep. Child names are only extracted when they hide a real decision, not a one-liner.

```ts
// providerFailures.ts
// Google just failed a reporting write.
// Do not keep the customer's email, the cell values,
// or Google's raw message.
// Say what kind of failure it is in a canned sentence,
// and say whether the owner should retry, reconnect OAuth,
// repair the destination, wait on capacity, or stop.
// Then, only if the failure is a rate limit or a transient blip,
// decide whether we still have time to retry.
// Do not classify 429 versus 401 from this file.
// Do not wrap Google. Do not replay a RAW write.
// Do not fail the run. Do not persist the original error.

import {
  classifyGoogleFailure,
  decideProviderRetry,
  providerStatus,
} from "../../durableWork"

// ── 1. Say what kind of Google reporting failure this is ─

export function sayWhatKindOfGoogleReportingFailureThisIsInCannedWords(error)
  // ask leftover classifyGoogleFailure + leftover providerStatus
  // retryable = rate_limit or transient only
  // remediation: retry | owner_reconnect | owner_repair_destination
  //   | capacity | non_retryable | operator_review
  // summary is a closed sentence — never error.message
  // HTTP status rides along only when leftover providerStatus finds one

export const sanitizeReportingProviderFailure =
  sayWhatKindOfGoogleReportingFailureThisIsInCannedWords

// ── 2. Decide whether we still have time to retry ────────

export function decideWhetherWeStillHaveTimeToRetryThisGoogleReportingFailure(input)
  // ask leftover sayWhatKindOfGoogleReportingFailureThisIsInCannedWords
  // Retry-After seconds × 1000 when the header is a finite number ≥ 0
  // ask leftover decideProviderRetry
  // no runtime caller today

export const decideReportingProviderRetry =
  decideWhetherWeStillHaveTimeToRetryThisGoogleReportingFailure

// ── 3. Refuse to persist a payload that still looks like cells ─

export function refuseToPersistThisProviderErrorIfItStillLooksLikeCells(error)
  // ask leftover canned summary
  // PII_LIKE on summary (substring `name` matches authentication / unclassified)
  // string message / body / data / values / range that look like cells
  // values arrays are skipped

export const assertProviderErrorIsPiiSafe =
  refuseToPersistThisProviderErrorIfItStillLooksLikeCells
```

Read the leftover wrap path out loud: *Leftover Sheets `writeValuesRaw` catches Google and **asks** leftover `wrapProvider`. Leftover wrap **asks** leftover `sayWhatKindOfGoogleReportingFailureThisIsInCannedWords` and puts that canned sentence on leftover `IntegrationError`. Leftover Drive create / get / trash **ask** the same wrap. This file never called Google.*

Read the leftover pack replay path out loud: *Leftover `writeBoundedReportingBatch` **asks** leftover `writeValuesRaw`. The catch **asks** leftover `sayWhatKindOfGoogleReportingFailureThisIsInCannedWords` again on that error. Not retryable rethrows the same error. Retryable **asks** leftover `verifyRange` on the same write bag; a match returns `replay:<title>:<startRow>` without a second write. Leftover pack never **asks** leftover `decideWhetherWeStillHaveTimeToRetryThisGoogleReportingFailure`.*

Read the leftover worker fail path out loud: *Leftover `toFailure` reuses a named reporting code when one is already on the error. Otherwise it **asks** leftover `sayWhatKindOfGoogleReportingFailureThisIsInCannedWords`. Authentication becomes leftover `PROVIDER_AUTHENTICATION`. Authorization becomes leftover `PROVIDER_AUTHORIZATION`. Retryable becomes leftover `PROVIDER_UNAVAILABLE`. `not_found` / `invalid_request` / `structural` / `unknown` become leftover `INTERNAL_FAILURE`. Leftover `reportingFailure` writes the closed catalog sentence leftover persist may keep. `remediation` is not persisted from this file.*

That is the operation. `sanitizeReportingProviderFailure` is not.

## Precise logic I would tighten while renaming

These are the smells I would keep as comments or tickets, not silent behavior changes.

1. **`decideReportingProviderRetry` has zero callers.** Leftover pack **asks** leftover `retryable` then leftover verify / leftover replay. Leftover worker **asks** leftover class then leftover `reportingFailure`. Do not silently start leftover pack **asking** leftover decide so "the retry export is used."

2. **Double sanitize can flip unknown into retryable.** Leftover `writeValuesRaw` first wraps an unknown error as leftover `IntegrationError` `statusCode` 502 (`retryable ? 503 : 502`). Leftover pack then **asks** leftover sanitize on that wrap. Leftover `providerStatus` reads `statusCode` 502 → leftover `classifyGoogleFailure` returns `retryable_transient`. A non-retryable unknown can look retryable on the second pass. Do not silently stop wrapping or stop the second sanitize so "retryable stays honest."

3. **`Retry-After` is only read by the unused decide.** Header parse is seconds × 1000. Leftover adapters never pass it to leftover pack. Do not silently start leftover wrap copying `Retry-After` onto metadata.

4. **Worker ignores `remediation`.** Leftover wrap puts `remediation` on leftover `IntegrationError.metadata`. Leftover `toFailure` maps class → leftover `PROVIDER_*` / leftover `INTERNAL_FAILURE` and does not copy `owner_reconnect`. `not_found` / `invalid_request` / `structural` / `unknown` all become leftover `INTERNAL_FAILURE`. Do not silently start leftover worker persisting leftover remediation so "the owner sees repair."

5. **`assertProviderErrorIsPiiSafe` is test-only.** Leftover persist **asks** leftover `assertSafeReportingFailure`. Do not silently start leftover adapters **asking** this assert before leftover wrap so "PII is checked twice."

6. **The PII regex matches `name` as a substring.** The canned authentication summary is “Google OAuth authentication failed for reporting.” The unclassified summary is “Google reporting provider failed with an unclassified error.” Both contain `name`. `refuseToPersistThisProviderErrorIfItStillLooksLikeCells` on those canned sentences throws “Sanitized provider summary must remain PII-free.” Acceptance 19 uses HTTP 500 (the transient sentence has no `name`). Do not silently narrow leftover `PII_LIKE` to word boundaries so "the assert matches the sentences."

7. **A values array of cells does not trip the assert.** Leftover `looksLikeCellPayload` runs only on strings. `{ values: [["Ada", "555-0100"]] }` skips `values`. `{ values: "a,b,c" }` throws. Do not silently walk arrays so "cells are always refused."

8. **Classify stays in leftover `durableWork`.** 429 → rate-limit; 408 / 5xx / `ECONNRESET` family → transient; 401 → authentication; 403 → authorization; 404 → not_found; checksum / schema / capacity codes → structural; other 4xx → invalid_request; else unknown. Do not silently copy that table into this file so "reporting owns classify." Do not open leftover `durableWork/` this pass.

9. **Canned summaries never copy `error.message`.** A 500 with `customer@example.com` still summarizes as “Google provider returned a transient failure (HTTP 500).” Leftover wrap still keeps `cause: error` on leftover `IntegrationError`. Do not silently drop `cause` from leftover wrap so "PII cannot leak through the cause" — leftover wrap lives in leftover adapters.

10. **Leave sibling modules alone.** Leftover Sheets wrap and leftover Drive wrap stay unvisited. Leftover pack / leftover worker / leftover run envelope stay recommended. Leftover live mask / leftover live inject stay unvisited. Leftover `durableWork/` stays unvisited. Do not open leftover `google/reportingSheetsAdapter.ts` this pass.

## Testing

The **interface** is the test surface. Existing asserts: leftover acceptance 19 sanitizes HTTP 500 with email / Ada / a values array → `summary` has no `@` and no `Ada`; leftover `assertProviderErrorIsPiiSafe(sanitized)` does not throw; `{ values: "a,b,c" }` throws `/PII|cell/`; leftover `reportingFailure("PROVIDER_UNAVAILABLE")` is leftover run-repository. No 401 / 403 / 404 canned sentence is locked on this file. No leftover `decideReportingProviderRetry` proof is locked. No “unknown wrap 502 then second sanitize is retryable” proof is locked. No “this file never writes Google” proof is locked.

Add proofs at the new names (later implementer; not this Cloud pass):

- canned sentence: 429 → rate-limit + `retry` + retryable true; 500 → transient + `retry`; 401 → authentication + `owner_reconnect` + retryable false; 403 → authorization + `owner_repair_destination`; 404 → not_found + `owner_repair_destination`; checksum code → structural + `capacity`; 400 → invalid_request + `non_retryable`; `{}` → unknown + `operator_review`
- `summary` never includes `error.message` / `@` / cell values
- leftover decide (when kept): authentication → `{ action: "fail" }`; 429 inside leftover policy → `{ action: "retry" }` or `defer`; unused at runtime stays unused unless leftover pack migrates
- leftover refuse: canned transient summary passes; string `values: "a,b,c"` throws; values arrays are skipped (current behavior)
- never write Google: `files.create` / `values.update` / `trashFile` are not called from this file
- leftover `REPORTING_FAILURE_CODES` sentences are not this file

Do not add helper-unit tests for leftover `remediationFor` / leftover `summaryFor` / leftover `retryAfterMs` / leftover `looksLikeCellPayload`. Do not boot leftover live Google, leftover destination desk, leftover promote, or leftover janitor. Do not replace leftover `assertSafeReportingFailure` tests with this file so "one PII test owns both stories." Do not assert leftover `classifyGoogleFailure` categories as if they were invented here.

## What I would not do

- I would not implement this pass.
- I would not rewrite `recommendations/form-lead.md`.
- I would not edit `src/`, tests, routes, models, or `docs/knowledge/`.
- I would not invent a CONTEXT.md term or an ADR. CONTEXT.md does not define Reporting.
- I would not open Wave B (`src/routes/reporting.routes.ts`, leftover `src/models/ReportingRun.ts`).
- I would not write a whole-folder Reporting recommendation.
- I would not introduce a `ReportingProviderFailureService` class or a `create.ts` / `update.ts` / `delete.ts` / `sanitize.ts` / `retry.ts` split.
- I would not invent a second leftover classify adapter beside leftover `classifyGoogleFailure`.
- I would not invent a second leftover wrap adapter beside leftover `wrapProvider`.
- I would not invent a second leftover run envelope beside leftover `reportingFailure`.
- I would not pull leftover durable-work classify, leftover Sheets wrap, leftover Drive wrap, leftover pack replay, leftover worker `toFailure`, leftover `reportingFailure`, or leftover live mask into this file.
- I would not silently start leftover pack **asking** leftover `decideReportingProviderRetry`.
- I would not silently fix leftover double sanitize flipping unknown to retryable.
- I would not silently narrow leftover `PII_LIKE` so leftover `authentication` / leftover `unclassified` pass the assert.
- I would not open leftover `durableWork/` while Wave A `reporting` still has unchecked modules.
- I would not open leftover `google/reportingSheetsAdapter.ts` while this checklist still has unchecked modules after this row.
- I would not silently reorder ADR-known side effects.
