# Mask The Live-Test Folder Id And The Long Run Tag, Drop Any Key That Looks Like A Customer Or A Secret, Then Hand The Owner A Bag They Can Log — Never The Email, Never The Token, Never The Full Drive Url — operational story

- Status: recommended
- Service: `reporting` (Wave A, in-progress)
- Pass: 44 of this service — `live/piiSafeEvidence.ts`
- Remaining in this service: `live/testArtifactJanitor.ts`, then leftover later evaluate
- Target: `src/services/reporting/live/piiSafeEvidence.ts`
- Knowledge: [`docs/knowledge/services/reporting.md`](../../../docs/knowledge/services/reporting.md) (primary code is `reporting.service.ts`. Role: Owner-designed, checksum-bound reports. Happy path: preview → immutable revision → two-step confirmed run → **worker write**. Skip / fail: “Run read failures — fixed safe envelopes; provider/source details are not exposed.” Cron table names `/api/cron/reporting-delivery-heartbeat` (+ health-scan, cleanup, test-artifact janitor). Knowledge never names this file, `buildMaskedLiveTestEvidence`, `buildStructuredCleanupError`, `sanitizeLiveTestLogDetail`, `sanitizeLiveTestString`, `maskGoogleFileId`, `maskRunTag`, `MaskedLiveTestEvidence`, `LiveTestCleanupError`, or `artifact_ids_masked` — do not add a Reporting Service file in this rename so “the Service sentence wins”). Distinct from already-recommended leftover canned Google sentence: [`reporting-provider-failures.md`](reporting-provider-failures.md) (`sanitizeReportingProviderFailure` **replaces** `error.message` with a `failure_class` sentence leftover persist may keep; this file keeps the sentence and redacts tokens / Drive URLs / file ids — official write never **asks** this file). Distinct from already-recommended leftover closed-catalog run envelope: [`reporting-run-repository.md`](reporting-run-repository.md) (`reportingFailure` / `assertSafeReportingFailure` — Owner read never **asks** this file). Distinct from already-recommended leftover unused desk mask: [`reporting-destination-identity.md`](reporting-destination-identity.md) (unused `maskGoogleFileId` fold is `length <= 8` → `"********"`; this file’s fold is `length <= 10` → `"***"` then `first4…last4`; leftover janitor and leftover live tests **ask** this copy only). Distinct from already-recommended leftover live orchestration: [`reporting-live-google-orchestration.md`](reporting-live-google-orchestration.md) (happy / failure / skip **ask** `buildMaskedLiveTestEvidence`; cleanup step **asks** `sanitizeLiveTestLogDetail`; `formatHarnessEvidenceForLog` **asks** `sanitizeLiveTestLogDetail` **again** on the already-masked bag). Distinct from already-recommended leftover stamp / leftover trash-the-set: [`reporting-live-test-cleanup.md`](reporting-live-test-cleanup.md) (**asks** `buildStructuredCleanupError` for `nested_artifact_outside_container` and `container_trash_failed`; this file never `files.update`). Distinct from already-recommended leftover inject wrap: [`reporting-transient-retry-wrapper.md`](reporting-transient-retry-wrapper.md) (never **asks** this file). Distinct from leftover unvisited later janitor: `live/testArtifactJanitor.ts` (**asks** `buildMaskedLiveTestEvidence` / `maskGoogleFileId` / `sanitizeLiveTestLogDetail`; Wave B `/api/cron/reporting-test-artifact-janitor` **asks** leftover later janitor, not this file directly). Distinct from leftover unvisited later evaluate: `live/janitorCompletion.ts`. Distinct from Wave B `scripts/reporting/run-live-google-harness.ts` (**asks** leftover facade `formatHarnessEvidenceForLog`; never imports this file). This is not Admin Analytics and not Sheet Sync. This checkout’s `CONTEXT.md` does not define Reporting / Reporting Sheets — do not invent a glossary copy. `docs/adr/` is absent here — do not invent ADR copies (knowledge cites ADR-0001 Mongo SoR).
- Callers: already-recommended leftover `live/liveGoogleOrchestration.ts` (**asks** `buildMaskedLiveTestEvidence` on happy / `buildFailureResult` / `skippedResult`; cleanup step **asks** `sanitizeLiveTestLogDetail`; `formatHarnessEvidenceForLog` **asks** `sanitizeLiveTestLogDetail` again). Already-recommended leftover `live/liveTestCleanup.ts` (**asks** `buildStructuredCleanupError` twice — nested refuse has no `fileId`; container trash fail passes `fileId`). Unvisited leftover `live/testArtifactJanitor.ts` (**asks** `buildMaskedLiveTestEvidence` on disabled / prereq fail / finished scan; scan step **asks** `sanitizeLiveTestLogDetail` + `maskGoogleFileId` for `export_root_masked`). No `src/` import of `sanitizeLiveTestString` or `maskRunTag` outside this file (tests only, plus internal **asks**). Leftover `destinationIdentity.ts` `maskGoogleFileId` is a **different export** — no live caller **asks** it. Tests: leftover `live/liveGoogleHarness.test.ts` **asks** `maskGoogleFileId("1AbCdEfGhIjKlMnOpQrStUv") === "1AbC…StUv"` / `maskRunTag` ellipsis / `sanitizeLiveTestLogDetail` drops `customer_name` / `lead_email` / nested `phone` and masks `file_id`; `formatHarnessEvidenceForLog` only asserts the log has no `customer_name|lead_email|phone` — it does **not** assert leftover step `name` survives. Leftover `live/liveTestSecurity.test.ts` **asks** recursive drop / `sanitizeLiveTestString` Drive URL → `[redacted_url]` / Bearer → `[redacted_token]` / embedded file id mask / `buildStructuredCleanupError` masks message + `artifact_id_masked`. Leftover `reporting.test.ts` / leftover `reportingDelivery.test.ts` do not import this file. Owner HTTP never **asks** this file. Queue consumer never **asks** this file. **No HTTP route** mounts this file.
- Seams callers need: mask-this-Google-file-id (`maskGoogleFileId`) vs mask-this-long-run-tag (`maskRunTag`) vs redact-this-string-we-might-log (`sanitizeLiveTestString`) vs drop-keys-that-look-like-a-customer-or-a-secret (`sanitizeLiveTestLogDetail`) vs build-a-structured-cleanup-error (`buildStructuredCleanupError`) vs build-the-masked-live-test-evidence-bag (`buildMaskedLiveTestEvidence`). The leftover mask / leftover unused desk mask **seam** exists because leftover destination identity ships a different unused fold; leftover janitor **asks** this copy. The leftover redact / leftover canned Google sentence **seam** exists because leftover official leftover `sanitizeReportingProviderFailure` replaces the message; this file redacts in place. The leftover bag / leftover stringify-again **seam** exists because leftover `buildMaskedLiveTestEvidence` already **asks** leftover drop-keys; leftover `formatHarnessEvidenceForLog` **asks** leftover drop-keys again. The leftover drop-keys / leftover step-name **seam** exists because leftover `SENSITIVE_KEY` matches leftover `name`, so leftover `buildMaskedLiveTestEvidence` drops leftover step names the leftover type still claims to keep. The leftover file-id / leftover checksum **seam** exists because leftover `looksLikeGoogleFileId` treats a 20+ hex that starts with a digit as a Drive id. The leftover phone / leftover GitHub run id **seam** exists because leftover `SENSITIVE_VALUE` matches 9+ digit strings so leftover `workflow_run_id` becomes `[redacted]`. There is no begin / complete Domain Command **seam**. There is no Google write **seam**. There is no leftover trash leftover prove **seam**. There is no HTTP **seam**. There is no Analytics **seam**. There is no Sheet Sync **seam**.
- Split later (only if the file outgrows one sitting): this ~113-line file is one sitting if you read it as mask the live-test folder id and the long run tag, drop any key that looks like a customer or a secret, then hand the owner a bag they can log — never the email, never the token, never the full Drive URL. Do **not** split into `mask.ts` / `sanitize.ts` / `evidence.ts` / `create.ts` / `update.ts` / `delete.ts`. Do **not** pull leftover orchestration, leftover cleanup, leftover later janitor, leftover canned Google sentence, leftover unused desk mask, or leftover run envelope here so “one PII file owns the company.” If it later splits: `maskThisGoogleFileIdSoWeCanStillMatchTheFolder.ts` / `redactThisStringWeMightLog.ts` / `dropKeysThatLookLikeACustomerOrASecret.ts` / `buildTheMaskedLiveTestEvidenceBag.ts` only as later story files, never CRUD.

`maskGoogleFileId` / `sanitizeLiveTestLogDetail` / `buildMaskedLiveTestEvidence` are executor mechanics. The owner question is: *Before anyone logs live-test evidence or a cleanup error, strip the customer's email, the phone, the token, the Drive URL, and the full Google file id. Keep a short mask so the owner can still match the folder. Drop any object key that looks like a customer or a secret. Then hand the bag to the harness log and the later janitor. Do not replace the sentence with a canned reporting failure. Do not start leftover trash from this file. Do not hit HTTP. Do not sync the Master Sheet.*

Already-recommended leftover orchestration, leftover cleanup, leftover canned Google sentence, leftover unused desk mask already live in other **modules**. Leftover later janitor and leftover later evaluate stay sibling **modules**. Do not pull those in.
## What this file actually does

Five operations of one “mask the live-test folder id and the long run tag, drop any key that looks like a customer or a secret, then hand the owner a bag they can log” story, not “a PII CRUD helper,” and not leftover official leftover canned Google sentence:

1. **Mask this Google file id so we can still match the folder** — `maskGoogleFileId`. Trim. Length `<= 10` → `"***"`. Else `first4…last4`. Leftover later janitor **asks** this for leftover `export_root_masked`. Leftover bag and leftover cleanup error **ask** this too. Leftover unused desk copy is not this fold.

2. **Mask this long run tag** — `maskRunTag`. Trim. Length `<= 16` stays raw (`janitor-noop`, `janitor-run`). Else `first8…last4`. Leftover bag **asks** this before leftover drop-keys. No `src/` caller **asks** this export directly.

3. **Redact this string we might log** — `sanitizeLiveTestString`. Replace Drive / Docs URLs with `[redacted_url]`. Replace `ya29.` / `Bearer` with `[redacted_token]`. Replace 20+ tokens `looksLikeGoogleFileId` accepts with `maskGoogleFileId`. If an email or a 9+ digit phone-like pattern remains, return `[redacted]` for the **whole** string. `looksLikeGoogleFileId` refuses all-lowercase snake that starts with a letter (`form_lead_…`, hex that starts with `a-f`). Hex that starts with a digit is treated as a Drive id.

4. **Drop keys that look like a customer or a secret** — `sanitizeLiveTestLogDetail`. Null / undefined / number / boolean pass. Strings **ask** leftover redact. Arrays map. Objects skip keys matching `SENSITIVE_KEY` (`email|phone|name|customer|lead|address|ssn|token|secret|refresh|authorization` as a whole segment). `name` matches. `lead_id` matches. `file_id` does not — its value is redacted instead. Other types become `[redacted]`.

5. **Hand the owner a bag they can log** — `buildStructuredCleanupError` plus `buildMaskedLiveTestEvidence`. Cleanup error keeps `code`, redacts `message`, masks `fileId` as `artifact_id_masked` when present. Evidence bag masks `run_tag`, slices `commit_sha` to 12, maps `artifactIds` through `maskGoogleFileId`, then **asks** drop-keys on the whole bag and casts to `MaskedLiveTestEvidence`. `oauth_path` is always `owner_oauth` from callers.
## Organization

Keep one file. This is the screenplay for “mask the live-test folder id and the long run tag, then hand the owner a bag they can log.” Leftover orchestration, leftover cleanup, leftover canned Google sentence, leftover unused desk mask already live in deeper **modules**. Do not pull those in. Do not invent a `PiiSafeEvidenceService` class. Do not invent a begin / complete Domain Command **seam**. Do not invent a second leftover mask **adapter** beside leftover unused desk copy in this rename — name the two folds. Do not invent a second leftover canned sentence beside leftover `sanitizeReportingProviderFailure`.

Do not split leftover mask / leftover redact / leftover bag into CRUD files. Leftover bag stays with leftover drop-keys because leftover bag **asks** leftover drop-keys last. Do not start leftover `files.update` from this file. Do not start leftover official leftover janitor from this file.

**External interface** stays small (this is the test surface):

| Keep exporting | Story name | Why the seam exists |
|---|---|---|
| `maskGoogleFileId` | `maskThisGoogleFileIdSoWeCanStillMatchTheFolder` | leftover later janitor `export_root_masked` + leftover bag + leftover cleanup error |
| `maskRunTag` | `maskThisLongRunTag` | leftover bag only; tests **ask** this directly |
| `sanitizeLiveTestString` | `redactThisStringWeMightLog` | leftover drop-keys + leftover cleanup error; tests **ask** this directly |
| `sanitizeLiveTestLogDetail` | `dropKeysThatLookLikeACustomerOrASecret` | leftover orchestration cleanup step + leftover `formatHarnessEvidenceForLog` + leftover later janitor scan step |
| `buildStructuredCleanupError` | `buildAStructuredCleanupErrorTheOwnerCanLog` | leftover trash-the-set nested refuse + leftover container trash fail |
| `buildMaskedLiveTestEvidence` | `buildTheMaskedLiveTestEvidenceBag` | leftover orchestration happy / fail / skip + leftover later janitor |

Keep leftover `MaskedLiveTestEvidence` / leftover `LiveTestCleanupError` until leftover orchestration and leftover later janitor migrate. Keep the old names as one-line aliases until leftover `liveGoogleOrchestration.ts` / leftover `liveTestCleanup.ts` / leftover `testArtifactJanitor.ts` / leftover harness tests migrate. Do not make leftover Wave B leftover test-artifact leftover cron learn leftover `buildTheMaskedLiveTestEvidenceBag`. Do not persist a new leftover harness leftover marker leftover version in this rename.

**No class for the workflow.** The type that *does* earn a name is the leftover bag leftover orchestration already returns:

```ts
type MaskedLiveTestEvidenceTheOwnerCanLog = {
  run_tag: string
  oauth_path: "owner_oauth"
  artifact_ids_masked: string[]
  cleanup_outcome: "pending" | "completed" | "partial" | "failed" | "skipped"
  steps: Array<{ name: string; outcome: "passed" | "failed" | "skipped"; detail?: string }>
}
```

That is the handoff from “orchestration already tagged and trashed the folders” to “the script can print this without a customer email or a raw Drive id.” Do **not** put `refresh_token` on this type. Do **not** put official `ReportingDelivery.status` on this type. Do **not** put a raw `fileId` on this type.
## The file, as a story

Parent functions stay deep. Child names are only extracted when they hide a real decision, not a one-liner.

```ts
// piiSafeEvidence.ts
// Before anyone logs live-test evidence or a cleanup error,
// strip the customer's email, the phone, the token,
// the Drive URL, and the full Google file id.
// Keep a short mask so the owner can still match the folder.
// Drop any object key that looks like a customer or a secret.
// Then hand the bag to the harness log and the later janitor.
// Do not replace the sentence with a canned reporting failure.
// Do not start leftover trash from this file.
// Do not hit HTTP.

// -- 1. Mask this Google file id so we can still match the folder --

export function maskThisGoogleFileIdSoWeCanStillMatchTheFolder(fileId)
  // trim; length <= 10 -> "***"; else first4…last4
export const maskGoogleFileId = maskThisGoogleFileIdSoWeCanStillMatchTheFolder

export function maskThisLongRunTag(runTag)
  // trim; length <= 16 stays raw; else first8…last4
export const maskRunTag = maskThisLongRunTag

// -- 2. Redact this string we might log --

function thisLooksLikeAGoogleFileId(value)
  // 20+ [A-Za-z0-9_-]; refuse all-lowercase snake that starts with a letter

export function redactThisStringWeMightLog(value)
  // Drive/Docs URL -> [redacted_url]
  // ya29. / Bearer -> [redacted_token]
  // embedded file id -> mask
  // leftover email or leftover 9+ digit phone-like -> whole string [redacted]
export const sanitizeLiveTestString = redactThisStringWeMightLog

// -- 3. Drop keys that look like a customer or a secret --

export function dropKeysThatLookLikeACustomerOrASecret(value)
  // skip keys matching email|phone|name|customer|lead|address|ssn|token|secret|refresh|authorization
  // leftover `name` matches — leftover step names vanish
export const sanitizeLiveTestLogDetail = dropKeysThatLookLikeACustomerOrASecret

// -- 4. Hand the owner a bag they can log --

export function buildAStructuredCleanupErrorTheOwnerCanLog(input)
  // code stays; message redacted; fileId -> artifact_id_masked
export const buildStructuredCleanupError = buildAStructuredCleanupErrorTheOwnerCanLog

export function buildTheMaskedLiveTestEvidenceBag(input)
  // mask run_tag; slice commit_sha to 12; map artifactIds through mask
  // then drop-keys the whole bag and cast
export const buildMaskedLiveTestEvidence = buildTheMaskedLiveTestEvidenceBag
```

Read the bag path out loud: *Mask the run tag. Mask every folder id. Slice the commit sha. Then walk the bag and drop any key that looks like a customer or a secret. If a sentence still has an email or a phone, redact the whole sentence. Hand that bag to the harness log. Do not print the raw Drive id. Do not print the token. Today the walk also drops step `name`, so the owner can no longer tell which step failed from the bag alone.*

That is the operation. `sanitizeLiveTestLogDetail` is not.
## Precise logic I would tighten while renaming

These are real smells the story names make obvious. Do not “just rename.”

1. **`SENSITIVE_KEY` eats leftover step `name`.** The regex matches leftover `name` as a whole segment. Leftover `buildMaskedLiveTestEvidence` **asks** leftover drop-keys on `{ steps: [{ name, outcome, detail }] }`. Step names vanish while the type still lists `name`. The `formatHarnessEvidenceForLog` test does not assert `oauth_health` survives. Name the lying type. Do **not** silently change leftover `SENSITIVE_KEY` in this rename so “step names stay.”
2. **Double sanitize.** `buildMaskedLiveTestEvidence` already asks drop-keys. `formatHarnessEvidenceForLog` asks drop-keys again. Orchestration cleanup step and later janitor scan step ask drop-keys before the bag walks them again. Name the double walk. Do **not** silently delete `formatHarnessEvidenceForLog` in this rename.

3. **Two `maskGoogleFileId` folds.** Destination identity unused export is length <= 8 then `"********"`. This file is length <= 10 then `"***"` then first4…last4. Later janitor asks this copy. Do **not** silently merge the folds so “one mask owns the company.”

4. **Checksum starting with a digit looks like a Drive id.** `looksLikeGoogleFileId` refuses all-lowercase snake that starts with a letter. Hex that starts with `0-9` is masked. A replace-run checksum can lose its middle. Name first-digit-wins. Do **not** silently wrap checksums in a skip list in this rename.

5. **`workflow_run_id` looks like a phone.** `SENSITIVE_VALUE` matches 9+ digit strings. GitHub `GITHUB_RUN_ID` becomes `[redacted]`. Name the digit fold. Do **not** silently special-case workflow ids in this rename.

6. **Whole-string redact after a useful mask.** If a sentence still has an email after the file-id mask, the whole sentence becomes `[redacted]`, The owner loses the masked folder id. Name last-wins. Do **not** silently keep the rest of the sentence in this rename.

7. **Leave sibling modules alone.** Orchestration stays `liveGoogleOrchestration.ts`. Cleanup stays `liveTestCleanup.ts`. Canned Google sentence stays `providerFailures.ts`. Unused desk mask stays `destinationIdentity.ts`. Do not open unvisited `live/testArtifactJanitor.ts` this pass.
## Testing

The **interface** is the test surface: `buildTheMaskedLiveTestEvidenceBag` (today `buildMaskedLiveTestEvidence`) and `buildAStructuredCleanupErrorTheOwnerCanLog` (today `buildStructuredCleanupError`).

Today `live/liveGoogleHarness.test.ts` asks `maskGoogleFileId` / `maskRunTag` / drop-keys on a nested object, and `formatHarnessEvidenceForLog` only asserts no `customer_name|lead_email|phone`. Today `live/liveTestSecurity.test.ts` asks recursive drop / string redact / structured cleanup error. That is helper-unit style. It never asks the bag to keep step `name`.

Replace the helper style with tests that name the operation. Use `TEST_MODE`. Do not boot live Google.

**Bag**
- `buildMaskedLiveTestEvidence` with `artifactIds: ["longId]` returns `artifact_ids_masked: ["1AbC…StUv]` and never the raw id.
- Steps `[{ name: "cleanup", outcome: "passed" }]` keep `name: "cleanup"` after the bag walk. Today they do not. Name that gap.
- `run_tag` longer than 16 becomes `first8…last4`. `janitor-run` stays raw.
- `commit_sha` is sliced to 12.

**Cleanup error**
- `buildStructuredCleanupError({ code, message with raw id, fileId })` masks the message and sets `artifact_id_masked`. JSON of the error never contains the raw id.

**Redact**
- Drive URL becomes `[redacted_url]`.
- `Bearer ya29.…` becomes `[redacted_token]`.
- Nested `{ customer_name, lead_email, phone }` keys are dropped.
- A 9+ digit `workflow_run_id` is `[redacted]` today. Name that gap.
- A 64-char hex checksum that starts with a digit is masked as a file id today. Name that gap.

Do **not** add a test per `looksLikeGoogleFileId` helper. Those names exist so the parent reads. If a helper test has to change when the helper is inlined, it was testing past the **interface**.

Do **not** boot official janitor, worker write, queue publish, Analytics, or Sheet Sync inside these tests. Live Google stays `pnpm reporting:live-google-harness`. Later janitor stays `testArtifactJanitor.test.ts`.
## What I would not do

- I would not implement this pass.
- I would not rewrite recommendations/form-lead.md.
- I would not edit src/, tests, routes, models, or docs/knowledge/.
- I would not invent a CONTEXT.md term or an ADR. CONTEXT.md does not define Reporting or Reporting Sheets.
- I would not open Wave B (`src/routes/reporting.routes.ts`, `src/config/domain/reportingLiveTest.ts`, `scripts/reporting/run-live-google-harness.ts`).
- I would not write a whole-folder Reporting recommendation.
- I would not introduce a `PiiSafeEvidenceService` class or a `mask.ts` / `sanitize.ts` / `create.ts` / `update.ts` / `delete.ts` split.
- I would not silently change `SENSITIVE_KEY` so step `name` survives.
- I would not silently merge this file’s `maskGoogleFileId` with destination identity’s unused fold.
- I would not silently delete `formatHarnessEvidenceForLog` or stop asking drop-keys twice.
- I would not silently special-case checksums or GitHub run ids.
- I would not silently replace live-test redaction with leftover canned Google sentences.
- I would not start leftover trash or leftover later janitor from this file.
- I would not open leftover `live/testArtifactJanitor.ts` while this checklist still has unchecked modules after this row.
- I would not silently reorder ADR-known side effects.
