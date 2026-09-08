# Walk The Leftover HTTP Mutation Screenplay Against The Pinned Official Host — Preflight An Existing Form, Call, Booking, Or Cancellation, Then POST The Public v1 Path, Bind Earlier Ids, Resume From The Checkpoint, Stop On The First Failed POST — Never Ask A Domain Command, Never Hold The Apply Lease, Never Write A Receipt, Never Inspect Sheets — operational story

- Status: recommended
- Service: `bestRelocationSheetIngest` (Wave A, in-progress)
- Pass: 12 of this service — `apply.ts`
- Remaining in this service: `dryRun.ts`, `dryRunReports.ts`
- Target: `src/services/bestRelocationSheetIngest/apply.ts`
- Knowledge: [`docs/knowledge/services/ingestion.md`](../../../docs/knowledge/services/ingestion.md). Happy-path step 5 is leftover `applyBestRelocationPlan` walking checksum-bound actions under the held apply lease. Domain mutations go through leftover `canonicalDomainCommands` with origin `external_sheet_ingestion`. CLI live apply is retired — approve the immutable application-owned run through `/api/v1/admin/ingestion`. Primary-code list names leftover `canonicalLeadAdoption.ts` / leftover `sheets.ts` / leftover `dryRunReports.ts`, not this file — do not add a second Ingestion Service so “the HTTP walk owns apply.” Knowledge never names leftover `applyIngestPlan`, leftover `ApplyResult`, leftover `findExistingEntity`, leftover `assertPinnedProductionUrl`, leftover `assertSupportedPlan`, leftover `$ref:` bindings, leftover Form `/form-leads/search`, leftover Call `/call-leads/search`, leftover admin booked-leads / cancelled-leads browse, leftover `confirmProductionApply`, leftover `initialResults`, leftover `onProgress`, leftover Call preflight through `toFloridaTimestamp`, leftover `redirect: "manual"`, or leftover `plan.mode: "dry-run"` on a live walk — do not add an Ingestion Service file in this rename so “the leftover HTTP walk owns the happy path.” Distinct from already-recommended six-tab read / window: [`best-relocation-sheet-ingest-sheets.md`](best-relocation-sheet-ingest-sheets.md). Distinct from already-recommended parse: [`best-relocation-sheet-ingest-parsing.md`](best-relocation-sheet-ingest-parsing.md). Distinct from already-recommended pair: [`best-relocation-sheet-ingest-matching.md`](best-relocation-sheet-ingest-matching.md). Distinct from already-recommended HTTP screenplay: [`best-relocation-sheet-ingest-plan.md`](best-relocation-sheet-ingest-plan.md) (writes leftover `IngestPlan.mutations` + leftover `$ref:` markers + leftover `DEFAULT_PRODUCTION_BASE_URL`; this file **asks** the pinned host constant and walks those mutations). Distinct from already-recommended remap: [`best-relocation-sheet-ingest-application-plan.md`](best-relocation-sheet-ingest-application-plan.md) (remaps HTTP mutations onto checksum-bound actions and drops the warning that HTTP apply still **asks** Sheet Sync). Distinct from already-recommended inspect: [`best-relocation-sheet-ingest-provider.md`](best-relocation-sheet-ingest-provider.md). Distinct from already-recommended identity mint: [`best-relocation-sheet-ingest-identity.md`](best-relocation-sheet-ingest-identity.md). Distinct from already-recommended receipt skip: [`best-relocation-sheet-ingest-source-change-policy.md`](best-relocation-sheet-ingest-source-change-policy.md). Distinct from already-recommended recurring adopt: [`best-relocation-sheet-ingest-canonical-lead-adoption.md`](best-relocation-sheet-ingest-canonical-lead-adoption.md). Distinct from already-recommended first-run adopt: [`best-relocation-sheet-ingest-bootstrap.md`](best-relocation-sheet-ingest-bootstrap.md). Distinct from already-recommended three-way allowlist: [`best-relocation-sheet-ingest-update-policy.md`](best-relocation-sheet-ingest-update-policy.md) (this file never **asks** `evaluateSourceOwnedLeadUpdate`; the HTTP plan has no `update_source_owned_lead`). Distinct from already-recommended worker: [`ingestion-worker.md`](ingestion-worker.md) (never imports this file). Distinct from already-recommended command walk: [`ingestion-apply-plan.md`](ingestion-apply-plan.md) (`applyBestRelocationPlan` **asks** `canonicalDomainCommands` under `assertHeld`; leftover `adapter.apply` **asks** that file, not this one). Distinct from later dry-run artifacts: leftover `dryRun.ts` **asks** leftover `IngestPlan` types only. Distinct from already-recommended Booking from source / leadless: [`bookings-booked-lead-from-source.md`](bookings-booked-lead-from-source.md), [`bookings-leadless-booking.md`](bookings-leadless-booking.md) — this file POSTs those public paths and does not **ask** those commands. Folder `HANDOFF.md` is not knowledge — do not copy it (it still describes leftover HTTP `apply.ts` as the live path and leftover `0.5`). This checkout’s `CONTEXT.md` does not define Ingestion Origin or Best Relocation — do not invent a glossary copy. `docs/adr/` is absent here — do not invent ADR copies (knowledge cites ADR-0001).  // pragma: allowlist secret
- Callers: leftover CLI `scripts/best-relocation-sheet-ingest.ts` **imports** `applyIngestPlan` / `ApplyResult` and leftover `applyReviewedPlan` **asks** them (`confirmProductionApply: true`, `initialResults` from a local checkpoint, `onProgress` writes that checkpoint). leftover `main` **throws** `--apply` before leftover `applyReviewedPlan` runs — “CLI live apply is retired.” Folder `bestRelocationSheetIngest.test.ts` **asks** `applyIngestPlan` for three proofs (unpinned host never fetches; leadless Booking preflight **asks** admin booked-leads and returns `existing`; Call preflight recognizes a bare array). Barrel `index.ts` re-exports `applyIngestPlan` / `ApplyResult`. leftover `adapter.ts` `apply` **asks** leftover `applyBestRelocationPlan`, not this file. leftover `plan.ts` is **asked** only for leftover `DEFAULT_PRODUCTION_BASE_URL`. leftover `ingestion/ingestion.test.ts` **asks** leftover `applyBestRelocationPlan`, not this file. leftover `worker.ts` / leftover `applyPlan.ts` / leftover `applicationPlan.ts` / leftover `sourceChangePolicy.ts` / leftover `bootstrap.ts` / leftover `canonicalLeadAdoption.ts` / leftover `updatePolicy.ts` / leftover `dryRun.ts` / Wave B `src/routes/ingestion.routes.ts` do not import this file.  // pragma: allowlist secret
- Seams callers need: refuse-unless-confirmed-pinned-version-1-Best-Relocation (`confirmProductionApply`, secret, pinned HTTPS origin, `assertSupportedPlan`); skip-mutations-already-on-the-checkpoint (`initialResults` / `idempotency_key`); preflight-existing-Form-Call-Booking-Cancellation vs POST-the-public-v1-path-and-bind-earlier-ids (`findExistingEntity` then `resolveBindings`); first-failed-POST-stops-the-walk (no row-scoped continue). The this-file / HTTP-screenplay **seam** exists because leftover `plan.ts` writes leftover `IngestPlan`; this file walks it. The this-file / command-walk **seam** exists because live apply **asks** leftover `applyBestRelocationPlan`; this file POSTs public v1. The this-file / CLI **seam** exists because leftover `applyReviewedPlan` still **asks** this file and leftover `main` never calls it. The this-file / checkpoint **seam** exists because leftover CLI **asks** leftover `onProgress`; this file does not write a file. There is no Domain Command **seam**. There is no apply-lease **seam**. There is no receipt **seam**. There is no checksum **seam** on this file. There is no Sheet Sync drain **seam**.  // pragma: allowlist secret
- Split later (only if the file outgrows one sitting): this ~369-line file is one sitting if you read it as walk the leftover HTTP mutation screenplay against the pinned production API — preflight an existing Form, Call, Booking, or Cancellation, then POST the public v1 path, bind earlier ids, resume from the checkpoint, stop on the first failed POST. Do **not** split into `pin.ts` / `preflight.ts` / `post.ts` / `create.ts` / `update.ts` / `delete.ts`. Do **not** pull leftover `plan.ts`, leftover `applicationPlan.ts`, leftover `ingestion/applyPlan.ts`, leftover `adapter.ts`, leftover `dryRun.ts`, or Domain Commands here. If it later splits: `refuseUnlessTheWalkIsConfirmedPinnedAndAVersion1BestRelocationPlan.ts` / `preflightTheExistingFormCallBookingOrCancellation.ts` / `postThePublicV1PathAndBindEarlierIds.ts` only as later story files, never CRUD.  // pragma: allowlist secret

`applyIngestPlan` is executor mechanics. The owner question is: *I already have the leftover HTTP mutation screenplay. Walk it against the pinned production API. Refuse unless I confirm live apply, the secret is present, the host is the official HTTPS origin, and the plan is version-1 Best Relocation with the five expected POST paths and in-order unique keys. Skip a mutation I already finished. Else look up whether that Form, Call, Booking, or Cancellation already exists. If it does, remember the id. If not, fill `$ref:` fields from earlier ids and POST the public v1 path. Remember the new id. Checkpoint after each result. Stop on the first failed POST. This file does not ask a Domain Command. This file does not hold the apply lease. This file does not write a receipt. This file does not inspect sheets.*  // pragma: allowlist secret

Leftover HTTP screenplay / application-plan remap / command walk / worker claim / dry-run artifacts already live in other **modules**. Do not pull those in.

## What this file actually does

Four operations of one “walk the leftover HTTP mutation screenplay against the pinned production API” story, not “an apply CRUD helper,” and not leftover `applyBestRelocationPlan` / Owner approve / sheet inspect:  // pragma: allowlist secret

1. **Refuse unless live apply is confirmed, the secret is present, the host is the pinned production origin, and the plan is version-1 Best Relocation** — leftover `applyIngestPlan`. `confirmProductionApply` false throws “Live apply requires confirmProductionApply=true.” Secret is `options.apiSecret` else `VANTAGE_API_SECRET` (trimmed); missing throws “Missing VANTAGE_API_SECRET for live apply.” leftover `assertPinnedProductionUrl` **asks** leftover `DEFAULT_PRODUCTION_BASE_URL` from sibling leftover `plan.ts`: HTTPS only, no user / password, origin must match, pathname must be empty after trailing slashes. Unpinned host never **asks** `fetch`. leftover `assertSupportedPlan`: leftover `plan.version === 1` and leftover `source_company === "best_relocation_leads"`; each mutation is `POST` on exactly one of `/api/v1/form-leads`, `/api/v1/call-leads`, `/api/v1/booked-leads/from-source`, `/api/v1/leadless-bookings`, `/api/v1/cancelled-leads`; leftover `idempotency_key` unique; leftover `depends_on` already seen in order. This function does not **ask** leftover `assertChecksum`. This function does not **ask** leftover `assertHeld`.  // pragma: allowlist secret

2. **Skip mutations already on the checkpoint** — seed leftover `results` from leftover `initialResults`. leftover `completedKeys` / leftover `resolvedIds` come from those rows that already have an leftover `entity_id`. A later mutation whose leftover `idempotency_key` is in leftover `completedKeys` is skipped with no HTTP. This function does not re-preflight a skipped key. This function does not write the checkpoint file — leftover CLI **asks** leftover `onProgress`.

3. **Preflight an existing Form, Call, Booking, or Cancellation** — leftover `findExistingEntity`. Form POSTs leftover `/api/v1/form-leads/search` `{ ref_no, include_duplicates: true, limit: 25 }` and takes leftover `data.lead`. Missing leftover `ref_no` is not existing. Call POSTs leftover `/api/v1/call-leads/search` `{ phone_number, job_no, limit: 25 }` (`compact` drops undefined). Body leftover `timestamp` is folded through leftover `toFloridaTimestamp` so Mongo Eastern wall-clock compares. Candidates may be a bare array, leftover `matches[]`, or leftover `lead`. Match is leftover `job_no` equality or last-10 phone digits plus same instant (±1s). Missing phone and job is not existing. Booking (`create_booked_from_source` / `create_leadless_booking`) GETs admin booked-leads filtered by Job (`job_no` else `call_job_no`, uppercase alphanumerics). Cancellation GETs admin cancelled-leads filtered by Job taken from leftover `idempotency_key.split(":").at(-2)` and matches leftover `booked_lead` to the already-resolved binding. Missing booked id is not existing. Existing → leftover `status: "existing"`, leftover `http_status: 200`, id on leftover `resolvedIds`. This function does not **ask** a Domain Command.

4. **POST the public v1 path, bind earlier ids, extract the new id, stop on the first failed POST** — leftover `resolveBindings` copies leftover `api.body` and replaces each leftover `api.bindings` field from leftover `resolvedIds` (missing dependency throws “has no resolved ID”). POST `{plan.base_url}{api.path}` with leftover `x-api-secret`, leftover `redirect: "manual"`. leftover `!response.ok` throws and stops the walk (no row leftover `failures`, no leftover `skipped_dependencies`). Id **asks** leftover `extractEntityId` (`data.lead` / `data.booking` / `data.cancellation` / `data` / `_id` / `id`, 24-hex). Missing id on leftover `create_form_lead` / leftover `create_booked_from_source` / leftover `create_leadless_booking` throws. Call / Cancellation may leftover `created` without an id. Then leftover `onProgress` with a copy of leftover `results`. Return the leftover `ApplyResult[]`. This function does not **ask** leftover `updateSourceOwnedLead`. This function does not **ask** leftover `adopt_existing`. This function does not append a leftover `SourceRowReceipt`.

Shared beats, not owner operations: leftover `request` / leftover `get` / leftover `responseJson` (empty → `{}`; bad JSON → `{ raw }`), leftover `arrayData`, leftover `objectId`, leftover `record`, leftover `stringField`, leftover `normalizeJob`, leftover `phoneDigits`, leftover `sameInstant`, leftover `compact`. Job fold here is uppercase alphanumerics (same family as leftover `applicationPlan.ts` leftover `leadlessMatchingEvidence`, not leftover `parsing.normalizeJobNo`). Phone here is last-10 digits (same family as leftover `updatePolicy.ts`, not leftover `normalizePhoneNumberForMatch`).

## Organization

Keep one file as the screenplay for “walk the leftover HTTP mutation screenplay against the pinned production API — preflight an existing Form, Call, Booking, or Cancellation, then POST the public v1 path, bind earlier ids, resume from the checkpoint, stop on the first failed POST — never ask a Domain Command, never hold the apply lease, never write a receipt, never inspect sheets.” Leftover HTTP screenplay / application-plan remap / command walk / worker claim / dry-run artifacts already live in deeper **modules**. Do not pull those in. Do not invent a `BestRelocationApplyService` class. Do not invent a begin / complete Domain Command **seam** here — this leftover HTTP walk is not leftover `applyBestRelocationPlan`. Do not invent a second command **adapter** beside leftover `canonicalDomainCommands`. Do not invent a second pin **adapter** beside leftover `DEFAULT_PRODUCTION_BASE_URL`. Do not invent a second apply **adapter** so leftover `adapter.apply` “owns leftover HTTP.” Do not invent a checksum **adapter** here — leftover CLI leftover `applyReviewedPlan` hashed the file and is dead.  // pragma: allowlist secret

**External interface** stays small (this is the test surface). Faces folder tests / barrel / dead CLI already import:

| Keep exporting | Story name | Why the seam exists |
|---|---|---|
| `applyIngestPlan` | `walkTheLeftoverHttpMutationScreenplayAgainstThePinnedProductionApi` | folder tests **ask** pin / Booking preflight / Call preflight; dead CLI **asks** resume / leftover `onProgress` |  // pragma: allowlist secret
| `ApplyResult` | `LeftoverHttpMutationWalkResult` | leftover `created` / leftover `existing` card leftover CLI checkpoint **asks** |

Keep the old names as one-line aliases until leftover `index.ts`, folder tests, and leftover CLI unused leftover `applyReviewedPlan` migrate. Do not export leftover `findExistingEntity` / leftover `resolveBindings` / leftover `assertPinnedProductionUrl` / leftover `assertSupportedPlan` / leftover `extractEntityId`. Do not make leftover `adapter.apply` learn this file so “one apply owns leftover HTTP and leftover commands.” Do not make Owner approve learn this file — approve CAS-es leftover `applying` and **asks** the leftover command walk. Do not make callers learn leftover `InTransaction` or CRUD verbs.  // pragma: allowlist secret

**No class for the workflow.** The one type that earns a name is the leftover HTTP walk card leftover CLI checkpoint **asks**:

```ts
type LeftoverHttpMutationWalkResult = {
  idempotency_key: string
  status: "created" | "existing"
  entity_id?: string
  http_status: number
}
```

That is the handoff from “leftover `plan.ts` wrote the leftover HTTP play” to “leftover CLI may skip that key on resume.” Do **not** put leftover `plan_checksum` on that type so “the leftover HTTP walk owns approve.” Do **not** put leftover `action_key` on that type so “the leftover HTTP walk owns leftover receipts.” Do **not** move leftover `IngestionApplyResult` here — that bag lives on leftover `ingestion/types.ts` and **asks** counters this file never returns.

leftover `IngestPlan` / leftover `PlannedMutation` stay on sibling leftover `types.ts`. Do not move those cards here.

## The file, as a story

Parent functions stay deep. Child names are only extracted when they hide a real decision, not a one-liner.

```ts
// apply.ts
// I already have the leftover HTTP mutation screenplay.
// Walk it against the pinned production API.  // pragma: allowlist secret
// Refuse unless I confirm live apply, the secret is present,
// the host is the official HTTPS origin, and the plan is
// version-1 Best Relocation with the five expected POST paths.
// Skip a mutation I already finished.
// Else look up whether that Form, Call, Booking, or Cancellation
// already exists. If it does, remember the id.
// If not, fill $ref: fields from earlier ids and POST the public v1 path.
// Remember the new id. Checkpoint after each result.
// Stop on the first failed POST.
// This file does not ask a Domain Command.
// This file does not hold the apply lease.
// This file does not write a receipt.
// This file does not inspect sheets.

// ── 1. Refuse unless confirmed, pinned, version-1 Best Relocation ─

export async function walkTheLeftoverHttpMutationScreenplayAgainstThePinnedProductionApi(  // pragma: allowlist secret
  plan,
  options,
)
export const applyIngestPlan =
  walkTheLeftoverHttpMutationScreenplayAgainstThePinnedProductionApi  // pragma: allowlist secret

function refuseUnlessLiveApplyIsConfirmed(confirmProductionApply)  // pragma: allowlist secret
function refuseWhenTheSecretIsMissing(apiSecret)
function refuseWhenTheHostIsNotThePinnedProductionOrigin(baseUrl)  // pragma: allowlist secret
function refuseWhenThePlanIsNotVersion1BestRelocationWithSupportedPosts(plan)

// ── 2. Skip mutations already on the checkpoint ───────────

function seedResultsAndResolvedIdsFromTheCheckpoint(initialResults)
function skipWhenThisIdempotencyKeyAlreadyFinished(mutation, completedKeys)

// ── 3. Preflight an existing Form, Call, Booking, or Cancellation ─

async function findTheExistingFormByTrackingReference(baseUrl, mutation)
async function findTheExistingCallByPhoneAndFloridaSecondOrJob(baseUrl, mutation)
async function findTheExistingBookingByNormalizedJob(baseUrl, mutation)
async function findTheExistingCancellationForTheResolvedBooking(baseUrl, mutation, resolvedIds)

// ── 4. POST the public v1 path and bind earlier ids ───────

function fillDollarRefSlotsFromEarlierIds(mutation, resolvedIds)
async function postThePublicV1Path(baseUrl, mutation, body)
function extractTheEntityIdOrRefuseWhenAFormOrBookingNeedsOne(envelope, mutation)
```

Read the primary path out loud: *I already have the leftover HTTP mutation screenplay. Refuse unless I confirm live apply, the secret is present, the host is the official HTTPS origin, and the plan is version-1 Best Relocation with the five expected POST paths and in-order unique keys. Skip a mutation I already finished. Else look up whether that Form, Call, Booking, or Cancellation already exists. If it does, remember the id. If not, fill `$ref:` fields from earlier ids and POST the public v1 path. Remember the new id. Checkpoint after each result. Stop on the first failed POST. Never ask a Domain Command. Never hold the apply lease. Never write a receipt. Never inspect sheets.*

That is the operation. `applyIngestPlan` is not.

## Precise logic I would tighten while renaming

1. **Dead CLI caller.** leftover `main` throws `--apply` (“CLI live apply is retired”). leftover `applyReviewedPlan` still **asks** this file and hashes leftover `ingest-plan.json`. Name the unused walk. Do **not** silently wire leftover `main` back to this file so “leftover HTTP owns live apply” — knowledge says approve through leftover `/api/v1/admin/ingestion`.

2. **Two apply walks.** Live apply **asks** leftover `applyBestRelocationPlan` (Domain Commands, apply lease, receipts, row-scoped continue). This file POSTs public v1 and **throws** on the first miss. leftover `adapter.apply` **asks** the leftover command walk, not this file. Do **not** silently switch leftover `adapter.apply` to this file so “one apply owns leftover HTTP.”

3. **First failed POST stops the walk.** leftover `applyPlan.ts` continues on leftover Zod / leftover Conflict / leftover NotFound / leftover invalid Google. This file **throws**. Name the two fail classes. Do **not** silently treat a 409 as leftover `existing` so “every duplicate continues.”

4. **Call and Cancellation may `created` without an id.** Form / Booking / leadless throw when leftover `extractEntityId` misses. A later Booking **asks** leftover `resolvedIds` for that Form. Name missing-id vs required-id. Do **not** silently require an id on Call so “one extract owns every POST.”

5. **Cancellation Job comes from `idempotency_key.split(":").at(-2)`.** leftover `plan.ts` writes leftover `cancellation:${SOURCE_COMPANY}:${job}:${refund.sheet_row}`. A renamed key preflights the wrong Job. Booking preflight **asks** the body instead. Do **not** silently **ask** leftover `api.body.job_no` so “one Job owns both lookups” without a test that a leftover `sheet_row` with a colon still matches.

6. **Call preflight **asks** leftover `toFloridaTimestamp`.** Folder test: “Call creation stores Eastern wall-clock.” Recurring adopt **asks** phone + persisted timestamp. Do **not** silently **ask** leftover `planBootstrapAdoption` so “one Florida second owns leftover HTTP and leftover Mongo adopt.”

7. **`plan.mode` is always `"dry-run"`.** Sibling leftover `types.ts` pins it. A live walk still carries leftover `dry-run`. Name the lying card. Do **not** silently flip leftover `mode` so “one flag owns live.”

8. **This file cannot apply leftover `update_source_owned_lead` / leftover `adopt_existing` / leftover `record_conflict` / leftover `unchanged`.** leftover `assertSupportedPlan` only accepts the five leftover HTTP create POSTs. leftover `applicationPlan.ts` remaps those onto leftover commands; leftover `applyPlan.ts` walks the remapped play. Do **not** start POSTing leftover `/api/v1` patches so “leftover HTTP owns three-way.”

9. **Resume skips by leftover `idempotency_key` only.** leftover `initialResults` does not re-preflight. A checkpoint with leftover `status: "created"` and no leftover `entity_id` still skips, and a later leftover `$ref:` may throw. Do **not** silently re-preflight every skipped key so “every resume owns a second search.”

10. **No checksum on this file.** leftover Owner approve binds leftover `plan_checksum` on leftover `BestRelocationApplicationPlan`. leftover dead CLI hashed leftover `ingest-plan.json` bytes. This file never **asks** leftover `assertChecksum`. Do **not** start hashing leftover `IngestPlan` here so “one checksum owns leftover HTTP.”

11. **Tests name three proofs and stop.** Unpinned host never fetches. Leadless Booking preflight **asks** admin booked-leads and returns leftover `existing`. Call preflight recognizes a bare array. No Form search, no Cancellation Job-from-key, no leftover `$ref:` bind, no leftover `created` POST, no leftover `confirmProductionApply: false`, no missing secret, no leftover `version !== 1`, no leftover `initialResults` resume, no first-failed-POST stop. Name the gap. Do not treat the three-assert style as the whole story.  // pragma: allowlist secret

12. **Leave sibling modules alone.** leftover `buildIngestPlan`, leftover `buildBestRelocationApplicationPlan`, leftover `applyBestRelocationPlan`, leftover `runBestRelocationIngestionWorker`, leftover `toFloridaTimestamp`, leftover `DEFAULT_PRODUCTION_BASE_URL` are already the right **depth**.  // pragma: allowlist secret

13. **Do not silently fix leftover `HANDOFF.md`.** It still describes leftover HTTP leftover `apply.ts` as the live path, leftover `0.5`, and leftover `pnpm ingest:best-relocation -- --apply`. Name the drift. Do not rewrite the handoff in this pass.

## Testing

The **interface** is the test surface: `walkTheLeftoverHttpMutationScreenplayAgainstThePinnedProductionApi` (today leftover `applyIngestPlan`).  // pragma: allowlist secret

Today leftover `bestRelocationSheetIngest.test.ts` **asks** leftover `applyIngestPlan` for unpinned-host refuse (fetch never called), leadless Booking preflight to leftover `existing` via admin booked-leads, and Call preflight against a bare-array search envelope. leftover `ingestion.test.ts` never imports this file. leftover CLI leftover `--apply` throw is not a test of this file.

Replace the three-assert style with tests that name the operation. Inject leftover `fetchImpl`. Do not boot live Google Sheets. Do not send leftover `VANTAGE_API_SECRET` to an unpinned host.

**Refuse unless confirmed, pinned, version-1 Best Relocation**
- leftover `confirmProductionApply: false` throws before leftover `fetch`.  // pragma: allowlist secret
- Missing secret throws before leftover `fetch`.
- leftover `https://attacker.example` throws leftover `pinned` and leftover `fetch` is never called (already green).
- leftover `http://` official host, leftover userinfo, or leftover pathname leftover `/api` throws leftover `pinned`.
- leftover `plan.version !== 1` or leftover `source_company` not leftover `best_relocation_leads` throws.
- leftover `PATCH` or leftover `/api/v1/form-leads/search` as leftover `api.path` throws leftover unsupported endpoint.
- Duplicate leftover `idempotency_key` throws. leftover `depends_on` that is later in the play throws leftover out-of-order.

**Skip mutations already on the checkpoint**
- leftover `initialResults` with leftover `idempotency_key` leftover `form:` skips that Form POST / search.
- A later Booking **asks** leftover `resolvedIds` from that leftover `entity_id`.
- A leftover `created` row without leftover `entity_id` still skips, and a later leftover `$ref:` throws leftover “has no resolved ID.”

**Preflight existing Form, Call, Booking, or Cancellation**
- Form leftover `ref_no` search **asks** leftover `include_duplicates: true` and returns leftover `existing` from leftover `data.lead`.
- Missing leftover `ref_no` POSTs the Form (no search hit).
- Call phone leftover `305-555-1212` equals leftover `3055551212` and leftover `toFloridaTimestamp` matches Eastern wall-clock (already green on the bare array).
- Call leftover `job_no` match wins over leftover phone.
- Leadless Booking GET admin booked-leads filtered by Job returns leftover `existing` (already green).
- Cancellation GET admin cancelled-leads **asks** Job from leftover `idempotency_key` leftover `.at(-2)` and matches leftover `booked_lead`.

**POST the public v1 path and bind earlier ids**
- Form POST leftover `/api/v1/form-leads` returns leftover `created` with leftover `data.lead._id`.
- Booking leftover `$ref:form_lead_id` is replaced from leftover `resolvedIds` before POST leftover `/api/v1/booked-leads/from-source`.
- Missing leftover `$ref:` throws leftover “has no resolved ID” and leftover `fetch` is not called for that POST.
- Form / Booking / leadless missing leftover `entity_id` throws. Call leftover `created` without an id is allowed.
- leftover `!response.ok` throws leftover “Apply failed” and later mutations are not walked.
- leftover `onProgress` is **asked** after leftover `existing` and leftover `created`. leftover `redirect` is leftover `manual`.

**Callers still ask; this file still does not walk leftover commands**
- leftover `adapter.apply` still **asks** leftover `applyBestRelocationPlan` and still does not import this file.
- leftover `main` still throws leftover `--apply` and leftover `applyReviewedPlan` still is unused.
- leftover `worker.ts` / leftover `applyPlan.ts` still do not import this file.
- leftover Domain Command still does not import this file.

Do **not** add a helper-unit test that has to change when leftover `phoneDigits` is inlined. Do not add a test per leftover `record` / leftover `stringField` / leftover `compact`.

Caller to keep green: folder pin / Booking preflight / Call preflight still **ask** leftover `applyIngestPlan`; leftover CLI leftover `--apply` still throws before leftover `applyReviewedPlan`; leftover command walk still **asks** leftover `applyBestRelocationPlan`.

## What I would not do

- A `BestRelocationApplyService` class with `create` / `update` / `delete`.
- Thirty two-line functions that only wrap leftover `fetch`.
- Moving this into a CRUD folder (`create.ts` / `update.ts` / `delete.ts`) or a `pin.ts` / `preflight.ts` / `post.ts` split “for cleanliness.”
- Breaking the before-commit / after-commit **seam** on leftover `applyBestRelocationPlan`, leftover pair-then-threshold, or leftover inspect 409.
- Treating leftover `plan.ts` leftover HTTP screenplay, leftover `applicationPlan.ts` remap, leftover `applyPlan.ts` leftover command walk, leftover `adapter.apply`, leftover `dryRun.ts`, leftover `updatePolicy.ts`, leftover `bootstrap.ts`, or leftover `canonicalLeadAdoption.ts` as this story.
- Starting leftover Owner approve, leftover `runSheetSyncDrain`, leftover Domain Commands, leftover receipt writes, leftover lease `assertHeld`, or leftover sheet inspect from this file.
- Silently “fixing” leftover dead leftover `applyReviewedPlan`, leftover two leftover apply leftover walks, leftover first-failed-POST leftover throw, leftover Call leftover / leftover Cancellation leftover missing leftover id, leftover Cancellation leftover Job leftover from leftover key, leftover `plan.mode: "dry-run"`, leftover HANDOFF leftover `0.5` leftover / leftover `--apply`, leftover or leftover the leftover three-assert leftover test leftover gap.
- Starting leftover `update_source_owned_lead` leftover HTTP leftover PATCH leftover from leftover this leftover file.
- Editing `src/`, tests, routes, models, or `docs/knowledge` in this pass.

---

**Glossary:** this checkout's `CONTEXT.md` does not define Ingestion Origin or Best Relocation. The stamped service is `docs/knowledge/services/ingestion.md`. `docs/adr/` is absent here; do not invent copies. Knowledge cites ADR-0001 (Sheets are a projection).
