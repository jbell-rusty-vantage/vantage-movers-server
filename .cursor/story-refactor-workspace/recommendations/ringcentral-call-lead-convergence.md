# Attach This Already-Qualified Inbound Call To The One Pending Granot-Created Call Lead At This Exact Source Granularity And Caller Phone Inside The Inclusive Plus-Or-Minus Twelve-Hour Creation Window, Or Mark Every Still-Eligible Candidate Conflict When More Than One Matches — Hold The Hashed Granularity-Plus-Phone Fence So Granot Create And RingCentral Create Cannot Each Write A Lead; Never Guess; Never Evaluate; Never Create A Second Lead — operational story

- Status: recommended
- Service: `ringcentral` (Wave A, in-progress)
- Pass: 9 of this service — `callLeadConvergence.service.ts`
- Remaining in this service: `shadow-call-leads-store.ts`, `processed-calls-store.ts`, `call-log-sync.service.ts`, `call-log-sync-state.store.ts`, `call-log-vetting.ts`, `analytics-reconcile.service.ts`, `auth.ts`
- Target: `src/services/ringcentral/callLeadConvergence.service.ts`
- Knowledge: [`docs/knowledge/services/ringcentral-call-lead-qualification.md`](../../../docs/knowledge/services/ringcentral-call-lead-qualification.md) (section 4 Exact Granot-created adoption candidate: this file owns candidate selection; adoptable only with valid `startTime` + normalized caller phone + exactly one row — exact `source_granularity_id`, immutable `ingested_contact_snapshot.normalized_phone_number`, `ingestion_origin:"granot_lead_created"`, `ringcentral_convergence.state:"pending"`, no nonempty RingCentral session / call-log identity, `createdAt` inclusive ±12 hours; post-load phone equality is defensive; never guess among multiple rows; Job-only / `not_applicable` has no immutable phone and is never a candidate. Exactly one candidate → `adoptRingCentralCall` after the transaction revalidates candidate, revision, active route assignment, source scope, phone, window, and count. More than one → `markRingCentralConvergenceConflict` then already-recommended promote continues. Zero / ineligible → promote continues without mutating an existing Lead. Hashed Source Granularity + normalized-phone scope fence in `ringcentral_convergence_locks` is shared with already-recommended Granot Call creation and already-recommended RingCentral default create; lock contains no raw phone. Duplicate correctness for adopt: already-recommended duplicate-guard with `callLeadIdToExclude`. Rollout: leftover `RINGCENTRAL_GRANOT_ADOPTION_ENABLED=false` is the checked-in fail-closed default; leftover shadow / leftover dry-run may evaluate the bounded outcome then continue without mutating). Related: [`docs/knowledge/services/domain-commands.md`](../../../docs/knowledge/services/domain-commands.md) (`adoptRingCentralCall` / `markRingCentralConvergenceConflict` sit on leftover `canonicalDomainCommands`; leftover executor owns the transaction; leftover sheets after commit). Related: [`docs/knowledge/services/call-lead.md`](../../../docs/knowledge/services/call-lead.md) (adopt never rewrites `granot_lead_created`; `ringcentral.original_caller` is immutable and separate from top-level contact). Distinct from already-recommended Granot create: [recommendations/granot-lifecycle-create-lead-from-granot.md](granot-lifecycle-create-lead-from-granot.md) (`createLeadFromGranot` **asks** `ensureRingCentralConvergenceScopeLock` / `acquireRingCentralConvergenceScopeLock` / `findPreCreationRingCentralConvergenceCandidates`; this file does **not** create a Granot Lead). Distinct from already-recommended promote: [recommendations/ringcentral-call-lead-ingest.md](ringcentral-call-lead-ingest.md) (`ingestRingCentralQualifiedCall` **asks** `attemptRingCentralCallLeadConvergence`, `acquireRingCentralConvergenceScopeLock`, and `selectRingCentralConvergenceCandidates` on default create). Distinct from already-recommended Duplicate Lead: [recommendations/ringcentral-duplicate-guard.md](ringcentral-duplicate-guard.md) (this file **asks** classify inside adopt with `callLeadIdToExclude`). Distinct from leftover processed-call ledger / leftover evaluate / leftover Call Log vet / leftover shadow / leftover Call Lead write / leftover config names / leftover Call Log sync / leftover analytics / leftover seed. Distinct from Wave B webhook HTTP. This checkout’s `CONTEXT.md` does not define Call Qualification / Call Lead Ingestion / Caller Match Key / Duplicate Lead — the knowledge file links a parent glossary this tree does not ship. Do not invent a glossary copy. `docs/adr/` is absent here — do not invent an ADR copy. Do not add this path to knowledge in this rename.
- Callers: already-recommended `ringcentral-call-lead-ingest.service.ts` (`deps.attemptConvergence` when leftover adoption is on; `acquireRingCentralConvergenceScopeLock` + `selectRingCentralConvergenceCandidates` inside default create; `RingCentralConvergenceScopeRaceError` retries promote); already-recommended `granotLifecycle/createLeadFromGranot.ts` (Call Lead + leftover adoption on → `ensureRingCentralConvergenceScopeLock` before the command, `acquireRingCentralConvergenceScopeLock` then `findPreCreationRingCentralConvergenceCandidates` inside create — any pre-creation hit throws `CreateLeadFromGranotRaceError("identity")`); leftover `domainCommands/index.ts` + leftover `domainCommands/types.ts` (`adoptRingCentralCall` / `markRingCentralConvergenceConflict` on leftover `canonicalDomainCommands`); leftover `domainCommands.test.ts` (command name); leftover `ingestion.test.ts` (stub handlers); this file’s `callLeadConvergence.test.ts` (seven select cases); leftover `callLeadConvergence.replica.test.ts` (adopt / conflict / races / rollback / Granot pre-creation). Already-recommended evaluate / leftover Call Log vet / leftover processed-call store / leftover shadow / leftover Call Lead write / leftover analytics / leftover seed — **do not import attempt**. Already-recommended duplicate-guard is **asked** by adopt; leftover processed-call store is **asked** by attempt / adopt.
- Seams callers need: public attempt (already-recommended ingest **asks** adopt-or-conflict-or-continue); select (ingest late re-check + adopt / conflict revalidate); ensure-before-transaction vs acquire-inside-transaction (already-recommended Granot create, already-recommended ingest default create, adopt, and conflict share the hashed fence); pre-creation lookup (already-recommended Granot create counterpart — a different query than select); adopt / conflict begin / complete (leftover `executeCanonicalCommandWithPostCommit` operation vs leftover `finalizeSheetSync`); `allowMutations` (ingest `writeMode === "create"`); race error (ingest retries the whole promote)
- Split later (only if the file outgrows one sitting): this ~1050-line file is one sitting if you read it as attach this already-qualified inbound call to the one pending Granot-created Call Lead at this exact Source Granularity and caller phone inside the inclusive plus-or-minus twelve-hour creation window, or mark every still-eligible candidate conflict when more than one matches; hold the hashed granularity-plus-phone fence so Granot create and RingCentral create cannot each write a Lead; never guess; never evaluate; never create a second Lead. If it later splits: `selectTheExactPendingGranotAdoptionCandidate.ts` / `holdTheHashedGranularityAndPhoneFence.ts` / `adoptThisQualifiedCallOntoTheOneGranotCallLead.ts` / `markEveryStillEligibleCandidateAsConflict.ts` — story files, never `create.ts` / `update.ts` / `delete.ts` / `adopt.ts` / `conflict.ts`, and never merge already-recommended ingest, leftover evaluate, leftover Call Log vet, already-recommended duplicate-guard, leftover processed-call store, leftover Call Lead write, already-recommended Granot create, leftover Call Log sync, leftover analytics, or Wave B webhook HTTP into this file

`attemptRingCentralCallLeadConvergence` / `selectRingCentralConvergenceCandidates` / `adoptRingCentralCall` / `markRingCentralConvergenceConflict` / `findPreCreationRingCentralConvergenceCandidates` are executor mechanics. The owner question is: *A webhook session or a Call Log record has already qualified. Granot may already have created a pending Call Lead for this caller at this exact Source Granularity. If exactly one pending Granot-created Lead matches the immutable snapshot phone and sits inside the inclusive plus-or-minus twelve-hour window with no RingCentral identity yet, attach this physical call to that Lead. If two or more still-eligible pending Leads match, mark every one conflict and let already-recommended promote continue — never pick. If none match, or the call has no start time or no caller phone, do not mutate an existing Lead. Hold a hashed Source Granularity plus phone fence so already-recommended Granot create and already-recommended RingCentral create cannot each write a Lead for the same caller. Do not evaluate the two-minute rule. Do not create a second Call Lead. Do not guess.*

Already-recommended promote, already-recommended Duplicate Lead, leftover processed-call ledger, leftover evaluate, leftover Call Log vet, already-recommended Granot create, leftover Call Lead write, leftover config names, leftover shadow, leftover Call Log sync, leftover analytics, leftover domain-command executor, leftover Sheet Sync, and Wave B webhook HTTP already live in other **modules**. Do not pull those in.

## What this file actually does

Five operations of one “attach this already-qualified inbound call to the one pending Granot-created Call Lead at this exact Source Granularity and caller phone inside the inclusive plus-or-minus twelve-hour creation window, or mark every still-eligible candidate conflict when more than one matches — hold the hashed granularity-plus-phone fence so Granot create and RingCentral create cannot each write a Lead; never guess; never evaluate; never create a second Lead” story, not “a convergence CRUD service,” and not already-recommended promote / leftover evaluate:

1. **Select the exact pending Granot adoption candidate** — `selectRingCentralConvergenceCandidates`. Missing `startTime` → `ineligible` / `missing_start_time`, Mongo never **asked**. No normalized caller phone → `ineligible` / `missing_caller_phone`. Else `findCandidates` at exact `source_granularity_id` + `ingestion_origin: "granot_lead_created"` + `ringcentral_convergence.state: "pending"` + empty `telephony_session_id` / `session_id` / `call_log_id` + immutable `ingested_contact_snapshot.normalized_phone_number` + `createdAt` `$gte start - 12h` `$lte start + 12h`. In-memory phone re-normalize must still match. Zero rows → `not_found`. One row → `candidate` + `domain_revision`. Two or more → `conflict`. This beat never sorts a winner among many. This beat does **not** adopt. This beat does **not** classify. This beat does **not** create.

2. **Hold the hashed Source Granularity plus phone fence** — `ensureRingCentralConvergenceScopeLock` upserts `ringcentral_convergence_locks` `_id = sha256(v1:granularity:normalizedPhone)` before the transaction (11000 retries the upsert). `acquireRingCentralConvergenceScopeLock` updates `touched_at` + `transaction_nonce` inside the transaction; `matchedCount !== 1` → `RingCentralConvergenceScopeRaceError`. The lock holds no raw phone. Already-recommended `createLeadFromGranot` **asks** ensure before the command and acquire inside Call create, then `findPreCreationRingCentralConvergenceCandidates` — any non-duplicate Call Lead at this granularity + phone (`normalized_phone_number` **or** snapshot), **not** the pending-Granot select. Already-recommended ingest default create **asks** acquire then late select; candidate or conflict throws the race so promote retries. This beat does **not** evaluate.

3. **Attempt to attach this call, or continue** — `attemptRingCentralCallLeadConvergence`. `enabled: false` → `disabled`, lock never ensured. Else ensure then select. `ineligible` returns `ineligible`. `not_found` re-reads leftover `findProcessedCall`; already `lead_adopted` / `lead_adopted_duplicate` returns adopted from the leftover ledger; else `not_found`. `allowMutations: false` maps `candidate` → `not_found` and `conflict` → `conflict` without writing. Mutations on + `conflict` → leftover `assertProcessedCallAdoptionIndexes` then `markRingCentralConvergenceConflict`; revision / idempotency race retries attempt twice. Mutations on + `candidate` → `adoptRingCentralCall`; race re-reads the leftover ledger then retries twice. Adopt committed without a terminal leftover ledger row throws. This beat does **not** create a RingCentral-origin Lead.

4. **Adopt this qualified call onto the one Granot Call Lead** — `adoptRingCentralCall` **asks** leftover `executeCanonicalCommandWithPostCommit` (`command_name: "adoptRingCentralCall"`) operation `applyAdoption` then leftover `finalizeSheetSync`. Envelope must match `ringcentral:adopt:<session|callLogId>` + checksum. Apply acquires the fence, `assertVerifiedRoute` (live active valid route + assignment + company + call granularity still effective at `startTime` + target phone), re-selects and refuses unless the same candidate + same `domain_revision`. **Asks** already-recommended `classifyRingCentralCallLeadDuplicate` with `callLeadIdToExclude`. A Duplicate Lead **asks** leftover `resolveLeadCplSnapshot({ duplicate: true })`. `findOneAndUpdate` stamps duration / times / `duplicate` / RingCentral identity / immutable `ringcentral.original_caller` / `ringcentral_convergence.state: "adopted"` while preserving `ingestion_origin: "granot_lead_created"` and the Observation id; filter requires pending + empty RingCentral identity + no `original_caller`. Leftover Entity Change then leftover `call_lead.update` outbox then leftover `upsertProcessedCall` `lead_adopted` / `lead_adopted_duplicate` in the same write. Leftover sheets after commit.

5. **Mark every still-eligible candidate as conflict** — `markRingCentralConvergenceConflict` **asks** the same leftover begin / complete **seam**. Envelope requires `multiple_adoption_candidates` + two or more ids + `ringcentral:convergence-conflict:<identity>`. Apply acquires the fence, re-selects, refuses unless the sorted candidate set still matches expected revisions. Each still-pending row stamps `conflict` + `conflict_reason` + a bounded call-identity hash. Leftover Entity Change + leftover outbox per Lead. Does **not** write the leftover processed-call ledger — already-recommended promote continues and creates a new Lead.

There is no evaluate operation. There is no RingCentral-origin create. There is no Form Fill. Already-recommended `ingestRingCentralQualifiedCall` is the promotion **adapter** that **asks** attempt. Already-recommended `createLeadFromGranot` is the Granot create **adapter** that **asks** the fence + pre-creation. Already-recommended `classifyRingCentralCallLeadDuplicate` is the Duplicate Lead **adapter**. Leftover `findProcessedCall` / leftover `upsertProcessedCall` are the same-physical-call **adapters**. Leftover `executeCanonicalCommandWithPostCommit` is the begin / complete **seam**.

`RingCentralConvergenceSelection` / `RingCentralConvergenceAttempt` / `RingCentralQualifiedCallIdentity` / `MULTIPLE_ADOPTION_CANDIDATES` / `RingCentralConvergenceScopeRaceError` sit on the attach path. They are not extra owner operations. Do not invent a dashboard for `domain_revision` in this rename. Do not export `convergenceScopeIdentity` as a public **seam**.

## Organization

Keep one file as the screenplay for “attach this already-qualified inbound call to the one pending Granot-created Call Lead at this exact Source Granularity and caller phone inside the inclusive plus-or-minus twelve-hour creation window, or mark every still-eligible candidate conflict when more than one matches; hold the hashed granularity-plus-phone fence so Granot create and RingCentral create cannot each write a Lead; never guess; never evaluate; never create a second Lead.” Already-recommended promote, already-recommended Duplicate Lead, leftover processed-call ledger, leftover evaluate, leftover Call Log vet, already-recommended Granot create, leftover Call Lead write, leftover config names, leftover shadow, leftover Call Log sync, leftover analytics, leftover domain-command executor, leftover Sheet Sync, and Wave B webhook HTTP already live in deeper **modules**. Do not pull those in. Do not invent a `RingCentralCallLeadConvergenceService` class. Do not invent an evaluate **adapter** beside leftover `evaluateRingCentralCallCandidate`. Do not invent a Duplicate Lead **adapter** beside already-recommended `classifyRingCentralCallLeadDuplicate`. Do not invent a promote **adapter** beside already-recommended `ingestRingCentralQualifiedCall`. Do not invent a Granot create **adapter** beside already-recommended `createLeadFromGranot`. Begin / complete already live on leftover `executeCanonicalCommandWithPostCommit`; this file **asks** that **seam**.

Do not split this into `create.ts` / `update.ts` / `delete.ts` / `adopt.ts` / `conflict.ts`. Those are persistence verbs, not the owner story. Do not move select into already-recommended ingest so “one file owns promote and adopt.” Do not move classify into this file so “one file owns Duplicate Lead and adopt.” Do not silently create when `allowMutations` is false so “we always persist a Lead.”

**External interface** stays small (this is the test surface). Select, fence, attempt, adopt, and conflict are one story’s attach, not five CRUD verbs:

| Keep exporting | Story name | Why the seam exists |
|---|---|---|
| `attemptRingCentralCallLeadConvergence` | `attachThisAlreadyQualifiedInboundCallToTheOnePendingGranotCallLeadOrMarkConflict` | already-recommended ingest **asks** adopt-or-conflict-or-continue |
| `selectRingCentralConvergenceCandidates` | `selectTheExactPendingGranotAdoptionCandidate` | ingest late re-check; adopt / conflict revalidate |
| `ensureRingCentralConvergenceScopeLock` | `rememberTheHashedGranularityAndPhoneFenceBeforeTheTransaction` | already-recommended Granot create + attempt + ingest default create share the fence |
| `acquireRingCentralConvergenceScopeLock` | `takeTheHashedGranularityAndPhoneFenceInsideTheTransaction` | already-recommended Granot create + ingest default create + adopt + conflict share the fence |
| `findPreCreationRingCentralConvergenceCandidates` | `lookUpAnyExistingNonDuplicateCallLeadAtThisGranularityAndPhone` | already-recommended Granot create counterpart; **not** the pending-Granot select |
| `adoptRingCentralCall` | `adoptThisQualifiedCallOntoTheOneGranotCallLead` | leftover `canonicalDomainCommands` + attempt |
| `markRingCentralConvergenceConflict` | `markEveryStillEligibleCandidateAsConflict` | leftover `canonicalDomainCommands` + attempt |
| `RingCentralConvergenceScopeRaceError` | `ThisHashedFenceOrCandidateSetChangedBeforeWeCouldWrite` | ingest retries the whole promote |
| `RingCentralConvergenceSelection` | `ZeroOneOrManyPendingGranotCandidates` | `ineligible` / `not_found` / `candidate` / `conflict` |
| `RingCentralConvergenceAttempt` | `WhetherWeAdoptedOrMustContinue` | ingest maps this onto `lead_adopted` or continue |
| `MULTIPLE_ADOPTION_CANDIDATES` | `neverGuessAmongPendingGranotLeads` | conflict reason is a closed string |

Keep the old names as one-line aliases until already-recommended ingest, already-recommended Granot create, leftover `canonicalDomainCommands`, the file tests, and the replica tests migrate. Do not make callers learn `fail_after` / `transaction_nonce` / `11000` as the domain language.

**Principle: old exports stay as aliases.** `attemptRingCentralCallLeadConvergence` remains the imported name until ingest migrates.

**No class for the workflow.** The type that *does* earn a name is the zero-one-many selection ingest and Granot create already branch on:

```ts
type ZeroOneOrManyPendingGranotCandidates =
  | { outcome: "ineligible"; reason: "missing_start_time" | "missing_caller_phone" }
  | { outcome: "not_found"; candidates: [] }
  | { outcome: "candidate"; candidate: { call_lead_id: string; domain_revision: number } }
  | { outcome: "conflict"; candidates: Array<{ call_lead_id: string; domain_revision: number }> }

type WhetherWeAdoptedOrMustContinue =
  | { outcome: "disabled" | "not_found" | "ineligible" | "conflict" }
  | { outcome: "adopted"; callLeadId: string; duplicate: boolean; duplicateReason: string | null }
```

That is the handoff from “this inbound call already qualified” to “ingest may adopt or continue.” Do **not** add `rawWebhookBody` so “this file can replace leftover evaluate,” do **not** add `writeMode` so “this file can replace already-recommended ingest,” and do **not** add `observation_id` so “this file can replace already-recommended Granot create.”

Do not add `classifyRingCentralCallLeadDuplicate` as a public story **seam** on this file — already-recommended Duplicate Lead already owns that export. Do not add `createLeadFromGranot` as a public **seam**. Do not export `convergenceScopeIdentity` as a public **seam** — it exists so the parent reads.

## The file, as a story

Parent functions stay deep. Child names are only extracted when they hide a real decision, not a one-liner.

```ts
// callLeadConvergence.service.ts
// A webhook session or a Call Log record has already qualified.
// Granot may already have created a pending Call Lead
// for this caller at this exact Source Granularity.
// If exactly one pending Granot Lead matches,
// attach this physical call to that Lead.
// If two or more still match, mark every one conflict
// and let already-recommended promote continue.
// Hold a hashed granularity-plus-phone fence
// so Granot create and RingCentral create
// cannot each write a Lead.
// Never guess. Never evaluate. Never create a second Lead.

// ── 1. Select the exact pending Granot adoption candidate ─

export async function selectTheExactPendingGranotAdoptionCandidate(
  call: AlreadyQualifiedInboundCall,
  session?: ClientSession,
  deps?: InjectablePendingGranotCandidateLookupForFileTests,
)

function refuseWithoutACallStart()
function refuseWithoutANormalizedCallerPhone()
function pickTheInclusivePlusOrMinusTwelveHourCreationWindow(startTime)
async function lookUpPendingGranotCreatedCallLeadsAtThisExactGranularityAndImmutablePhone(call, window)
function dropRowsWhoseImmutableSnapshotPhoneDrifted(rows, normalizedPhone)
function sayNotFound()
function sayTheOneCandidate(row)
function sayConflictNeverGuess(rows)

// ── 2. Hold the hashed Source Granularity plus phone fence ─

export async function rememberTheHashedGranularityAndPhoneFenceBeforeTheTransaction(scope)
export async function takeTheHashedGranularityAndPhoneFenceInsideTheTransaction(scope, session, now)
export async function lookUpAnyExistingNonDuplicateCallLeadAtThisGranularityAndPhone(scope, session)

function hashTheFenceIdentityWithoutStoringRawPhone(granularityId, phone)
function throwWhenTheFenceRowWasNotThereToTake()

// ── 3. Attempt to attach this call, or continue ───────────

export async function attachThisAlreadyQualifiedInboundCallToTheOnePendingGranotCallLeadOrMarkConflict(
  input: { call; enabled; allowMutations },
)

function returnDisabledWithoutTouchingTheFence(enabled)
async function returnAlreadyAdoptedFromTheLeftoverLedgerIfSomeoneElseWon(call)
function hideACandidateAsNotFoundWhenMutationsAreOff(selection, allowMutations)
async function retryTheWholeAttemptTwiceOnRevisionOrIdempotencyRace(input, retries)

// ── 4. Adopt this qualified call onto the one Granot Call Lead ─

export async function adoptThisQualifiedCallOntoTheOneGranotCallLead(input)
export function refuseUnlessTheAdoptionCommandEnvelopeMatchesThisPhysicalCall(input)

async function beginAdoptionInsideTheLeftoverCanonicalCommand(input, tx)
async function takeTheFenceAndRevalidateTheSameCandidateAndRevision(input, session)
async function refuseUnlessTheLiveRouteAssignmentIsStillValid(call, session)
async function askAlreadyRecommendedDuplicateLeadExcludingTheAdoptedLead(input)
async function stampRingCentralIdentityAndImmutableOriginalCallerWithoutRewritingGranotOrigin(input, duplicate)
async function rememberTheLeftoverEntityChangeAndCallLeadSheetIntent(input)
async function rememberLeftoverAdoptedOnTheProcessedCallLedger(input, duplicate)
async function completeLeftoverSheetsAfterCommit(sheetJob)

// ── 5. Mark every still-eligible candidate as conflict ────

export async function markEveryStillEligibleCandidateAsConflict(input)
export function refuseUnlessTheConflictCommandEnvelopeNamesEveryCandidate(input)

async function beginConflictInsideTheLeftoverCanonicalCommand(input, tx)
async function refuseUnlessTheLeftoverSortedCandidateSetStillMatches(input, session)
async function stampConflictAndTheBoundedCallIdentityHashOnEveryPendingLead(input)
async function rememberLeftoverEntityChangesAndSheetIntentsForEveryConflictedLead(input)
```

Read the primary path out loud: *If leftover adoption is off, return disabled and do not touch the fence. Remember the hashed Source Granularity plus phone fence before any write. Select the exact pending Granot-created Call Lead at this exact Source Granularity and immutable snapshot phone inside the inclusive plus-or-minus twelve-hour window. Missing start time or caller phone is ineligible — do not query. Zero matches: if the leftover processed-call ledger already holds adopted for this physical call, return that; otherwise continue. When mutations are off, hide a candidate as not-found and report conflict without writing. When mutations are on and two or more candidates remain, assert leftover adoption indexes, mark every still-eligible Lead conflict, then let already-recommended promote continue. When exactly one candidate remains, adopt it inside leftover’s canonical command: take the fence inside the transaction, revalidate the same candidate and revision, refuse unless the live route assignment is still valid, ask already-recommended Duplicate Lead excluding the adopted Lead, stamp RingCentral identity and immutable original caller without rewriting `granot_lead_created`, remember leftover Entity Change and leftover sheet intent, remember leftover adopted on the leftover processed-call ledger in the same write, complete leftover sheets after commit. Do not evaluate the two-minute rule. Do not create a second Call Lead. Do not guess among pending Granot Leads. Do not write the leftover ledger on conflict.*

That is the operation. `attemptRingCentralCallLeadConvergence` is not.

## Precise logic I would tighten while renaming

These are real smells the story names make obvious. Do not “just rename.”

1. **`allowMutations: false` hides a candidate as `not_found`.** Knowledge says leftover shadow / leftover dry-run may evaluate the bounded outcome then continue without mutating. Attempt maps `candidate` → `not_found` when mutations are off, so ingest cannot tell a real miss from a hidden match. Do not silently return `candidate` from attempt when mutations are off so “the name wins” without a paired ingest test. Do not silently adopt on leftover shadow so “we always persist.”

2. **Pre-creation lookup is a different query than select.** `findPreCreationRingCentralConvergenceCandidates` finds any non-duplicate Call Lead at this granularity + phone (`normalized_phone_number` **or** snapshot). It does not require `granot_lead_created`, `pending`, empty RingCentral identity, or the ±12-hour window. Already-recommended Granot create **asks** this counterpart so it will not insert when RingCentral already wrote. Do not silently reuse select for Granot create so “one lookup owns both.” Do not silently add `pending` / origin / window filters to pre-creation so “the queries match.”

3. **Knowledge leftover classify-after-adopt vs this file.** Knowledge section 4 lists classify after convergence “for adoption, exclude the adopted Lead.” Already-recommended ingest never classifies on adopt. This file classifies inside `applyAdoption`. Already parked in `CONTRADICTIONS.md` for ingest. Do not silently classify after adopt on ingest so “the knowledge outline wins.” Do not delete classify from this file so “ingest owns Duplicate Lead.”

4. **Conflict does not write the leftover processed-call ledger.** Knowledge: mark conflict, then allow the qualified call to continue through normal ingest. Already-recommended ingest then classifies and creates. Do not silently leftover-upsert on conflict so “one write owns all outcomes” — that would skip the continue path.

5. **`not_found` after select still re-reads the leftover ledger.** A raced adopt can already have written `lead_adopted`. Do not silently treat leftover ledger-hit as `not_found` so “select is the only source.” Do not move leftover `findProcessedCall` into select so “one query owns candidates and the ledger.”

6. **Adoption window is inclusive ±12 hours.** Select uses `$gte start - 12h` and `$lte start + 12h`. File tests lock both edges and one-millisecond-outside. Already-recommended Duplicate Lead is earlier-only 90 days. Do not silently make adoption earlier-only so “both windows match.” Do not silently read leftover `RINGCENTRAL_DUPLICATE_WINDOW_HOURS` so “config owns the window.”

7. **Current-contact drift cannot replace the immutable snapshot phone.** Default select queries the snapshot field; the in-memory sieve re-normalizes that same snapshot. File test AC-14 drops a drifted snapshot phone. Do not silently also match `normalized_phone_number` (the mutable top-level field) on select so “either phone works.” Pre-creation already ORs both fields — that is the Granot counterpart, not adopt.

8. **Route proof throws a generic `Error`, not `DomainRevisionConflictError`.** A stale live route is a technical failure. Race retries only catch revision / idempotency conflicts. Do not silently remap route failure to revision conflict so “every refuse retries.”

9. **Begin / complete is leftover’s executor, not a new seam.** Adopt and conflict write Entity Change + leftover outbox inside the transaction and leftover-finalize sheets after commit. Injected `fail_after` (`lead` / `changes` / `outbox` / `ledger`) proves rollback. Do not move leftover `finalizeSheetSync` inside the write so “one function owns sheets.” Do not leftover-upsert the ledger after commit so “sheets and the ledger share a clock.”

10. **Leave sibling modules alone.** Already-recommended ingest, already-recommended Duplicate Lead, leftover evaluate, leftover Call Log vet, leftover processed-call ledger, leftover shadow, leftover Call Lead write, leftover config names, leftover Call Log sync, leftover analytics, already-recommended Granot create, leftover domain-command executor already live at the right **depth**. This file orchestrates leftover select / leftover fence / leftover adopt / leftover conflict **asks**.

## Testing

The **interface** is the test surface: `attachThisAlreadyQualifiedInboundCallToTheOnePendingGranotCallLeadOrMarkConflict`, plus the fence and select **seams** already-recommended ingest and already-recommended Granot create **ask**.

Today’s `callLeadConvergence.test.ts` names one exact immutable-phone candidate, zero and multiple outcomes, inclusive ±12-hour window, exact-boundary vs one-millisecond-outside, missing start (no query), missing phone, and current-contact drift. That is the select **seam**. Leftover `callLeadConvergence.replica.test.ts` proves call-log-only adopt preserves origin, a different prior Lead still marks the adopted Lead duplicate, RingCentral-first create is reused by later Granot pre-creation, zero-candidate webhook / Call Log race creates one Lead, multiple ambiguity is durable and ingest continues, concurrent paths converge on one adopted Lead, candidate revision races re-read, concurrent Granot create and RingCentral ingest share one fence, and every injected write-stage failure rolls back. Already-recommended ingest tests prove who **asks**.

**Select the exact pending Granot adoption candidate**
- Missing `startTime` → `ineligible` / `missing_start_time`, Mongo never **asked**.
- No normalized caller phone → `ineligible` / `missing_caller_phone`.
- One exact snapshot-phone pending Granot row inside inclusive ±12 hours → `candidate`.
- Zero rows → `not_found`. Two or more → `conflict`. Never pick among many.
- Exactly −12h / +12h qualify; one millisecond outside does not.
- Drifted immutable snapshot phone is not a candidate. Mutable top-level phone is not the select key.

**Hold the hashed Source Granularity plus phone fence**
- Ensure upserts the hashed `_id` and stores no raw phone.
- Acquire with `matchedCount !== 1` → `RingCentralConvergenceScopeRaceError`.
- Already-recommended Granot create **asks** ensure then acquire then pre-creation; any existing non-duplicate Call Lead refuses Granot create.
- Pre-creation is not select: no `pending` / origin / window / empty-identity filter.

**Attempt to attach this call, or continue**
- Leftover adoption off → `disabled`, fence never ensured.
- `not_found` + leftover ledger already `lead_adopted` → return adopted from the leftover ledger.
- `allowMutations: false` + candidate → `not_found` without writing.
- `allowMutations: false` + conflict → `conflict` without writing.
- Mutations on + conflict → `markRingCentralConvergenceConflict`, leftover ledger not written.
- Mutations on + candidate → `adoptRingCentralCall`, leftover ledger written inside adopt.
- Revision / idempotency race retries attempt twice; leftover ledger-hit after race returns adopted.

**Adopt this qualified call onto the one Granot Call Lead**
- Preserves `ingestion_origin: "granot_lead_created"`.
- Stamps immutable `ringcentral.original_caller`. Later contact patch does not rewrite it.
- Classifies with `callLeadIdToExclude`. A different prior Lead → `duplicate: true`, leftover `cpl = 0`.
- Stale candidate / revision / route proof refuses. Route refuse does not retry as revision conflict.
- Leftover Entity Change + leftover outbox + leftover ledger in the same write. Leftover sheets after commit.
- Injected failure after lead / changes / outbox / ledger rolls the whole adopt back.

**Mark every still-eligible candidate as conflict**
- Two pending Granot Leads → both `conflict` / `multiple_adoption_candidates` / bounded identity hash.
- Already-recommended ingest then creates a new Lead. Leftover ledger status is `lead_created`, not `lead_adopted`.
- Candidate-set drift before persist → revision conflict, not a silent pick.

Do **not** add a test per helper (`dropRowsWhoseImmutableSnapshotPhoneDrifted`, `hashTheFenceIdentityWithoutStoringRawPhone`). Those names exist so the parent reads. If a helper test has to change when the helper is inlined, it was testing past the **interface**.

Do **not** add leftover evaluate, leftover Call Log vet, leftover Call Log sync, leftover analytics, leftover subscribe, or Wave B `ingestSessionLead` as this file’s proof. Already-recommended ingest and already-recommended Granot create stay on those **adapters** — they **ask** this interface; they do not own leftover select, leftover fence, leftover adopt, or leftover conflict.

## What I would not do

- A `RingCentralCallLeadConvergenceService` class with `create` / `update` / `delete`.
- Thirty two-line functions that only wrap `CallLead.find`.
- Moving this into a CRUD folder (`create.ts` / `adopt.ts` / `conflict.ts`) “for cleanliness,” or an `adoption/` folder that also swallows already-recommended ingest and leftover processed-call ledger.
- Breaking the leftover begin / complete **seam**, the hashed-fence **seam**, the zero-one-many select **seam**, or the conflict-then-continue **seam**.
- Treating already-recommended `ingestRingCentralQualifiedCall`, already-recommended `classifyRingCentralCallLeadDuplicate`, already-recommended `createLeadFromGranot`, leftover `findProcessedCall`, leftover `evaluateRingCentralCallCandidate`, leftover `vetRingCentralCallLogRecord`, or leftover `createRingCentralCallLeadInTransaction` as this story. Those are different **adapters**.
- Inventing a select-then-create **seam** that has only one **adapter** (this file never creates a RingCentral-origin Lead).
- Silently returning `candidate` from attempt when mutations are off, silently reusing select for Granot pre-creation, silently classifying after adopt on ingest, silently leftover-upserting the ledger on conflict, silently matching mutable top-level phone on select, or silently remapping route failure to revision conflict, while recommending a rename.
- Jumping to leftover shadow while this service still has unchecked Wave A modules.
- Writing a whole-folder recommendation for `ringcentral`.
