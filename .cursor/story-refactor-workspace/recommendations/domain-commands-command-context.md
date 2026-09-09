# Say Whether This Speaker May Issue This Command — Refuse An Incomplete Envelope First, Then Allow Only The Four Trusted Origins: Sheet Ingestion With The Dedicated Actor Plus A Human Approver, Vantage Admin Owner/Admin Or Matching Compatibility System IDs, Granot Processor With Receipt/Observation/Decision And A Channel That Agrees With The Initiator, Or RingCentral Ingest With Server-Verified Telephony — Never Treat Browser Extension As An Origin, Never Trust A Client Boolean For Telephony, Never Connect Mongo — operational story

- Status: recommended
- Service: `domainCommands` (Wave A, in-progress)
- Pass: 2 of this service — `commandContext.ts`
- Remaining in this service: `ringcentralProvenance.ts`, `entityChange.ts`, `existingWriteContext.ts`, `existingWrites.ts`, `bookings.ts`
- Target: `src/services/domainCommands/commandContext.ts`
- Knowledge: [`docs/knowledge/services/domain-commands.md`](../../../docs/knowledge/services/domain-commands.md) section **Command origins** (`applies_to` names this file). Distinct from apply-once / replay / after-commit finalize: already-recommended [domain-commands-idempotency.md](domain-commands-idempotency.md) — that file **asks** this **interface** before `connect`. Distinct from trusted RingCentral telephony proof: later `ringcentralProvenance.ts` (this file only **asks** `verifyRingCentralTelephony`). Distinct from HTTP → trusted admin bag: later `existingWriteContext.ts`. Distinct from public Form/Call/Booking/Cancellation adapters: later `existingWrites.ts`. Distinct from exact `updateBooking` / attach: later `bookings.ts`. Distinct from append-only Entity Change: later `entityChange.ts`. Distinct from actor factories: `durableWork/actors.ts` (Wave A, still unvisited — do not open). Distinct from Owner `Idempotency-Key` printable-length: `assertOwnerCommandIdempotencyKey` on `types.ts`. Distinct from lowercase checksum: `normalizeCommandContext` on `idempotency.ts` after this refuse. Distinct from the thin registry object: `index.ts` (skipped on open; this file is **not** re-exported). Checked-in Granot Lead-write / Booking / Release / Referral effect flags stay false — do not describe those Owner paths as live. This checkout’s `CONTEXT.md` is a pointer to a parent glossary that is not in this tree — do not invent “Command Origin” / “Durable Actor” copies. `docs/adr/` is absent here — do not invent ADR-0001 copies.
- Callers: **one runtime import.** `idempotency.ts` `createIdempotentCanonicalCommandExecutor` **asks** `assertCommandContext` before `connect` / store access. Barrel `domainCommands/index.ts` does **not** re-export this file. Routes, ingestion `applyPlan.ts`, Granot Owner modules, and RingCentral adopt **build** a `CanonicalCommandContext` and enter the executor; they do not import this file. Tests: `domainCommands.test.ts` AC-21 (four origins; forged Granot actor fails; RingCentral fails when the injected verifier returns false; compatibility API-secret and scoped-key system actors pass `vantage_admin`) and AC-32 (webhook initiator + `browser_extension` channel refuses). There is no `commandContext.test.ts`. Not this **interface**: `existingWriteContextFromRequest`, `verifyTrustedRingCentralTelephonyProvenance`, `assertOwnerCommandIdempotencyKey`, `normalizeCommandContext`.
- Seams callers need: refuse-or-allow **before** Mongo connects vs apply-or-replay **after**; injected `{ verifyRingCentralTelephony }` vs the default sibling telephony proof. There is no HTTP **adapter**. There is no telephony-store **adapter**. There is no actor-factory **adapter**. There is no Decision-ID **adapter**.
- Split later (only if the file outgrows one sitting): keep one file — this is already one sitting (~267 lines). If it later splits: `refuseUnlessThisSpeakerMayIssueThisCommand.ts` — never `create.ts` / `update.ts` / `delete.ts` / `assert.ts` / one file per origin. HTTP context, telephony proof, actor factories, and apply-once stay siblings / other services.

`assertCommandContext` is executor mechanics. The owner question is: *Someone already named the command and already built a context bag. Before anyone connects Mongo, say whether this speaker may issue it. The envelope must have a nonblank command id, a nonblank idempotency key, and a SHA-256 checksum. Then exactly four origins may speak. Sheet ingestion needs the dedicated `best-relocation-ingestion` system actor, a trusted human initiator, and complete run/receipt/connection provenance. Vantage Admin needs a trusted owner/admin actor and initiator, or the two compatibility system IDs (`vantage-api-secret` and `vantage-scoped-api-key:<fingerprint>`) with the same id and request id. Granot lifecycle needs the fixed processor actor, nonblank receipt/Observation/Decision, receipt id matching the processor request id, an Observation Channel in `{granot_webhook, browser_extension, granot_http_automation}`, and an initiator that agrees with that channel — webhook system initiator only with `granot_webhook`, browser-extension Owner only with `browser_extension`, or a `vantage_admin` human after those identity checks. RingCentral needs the fixed `ringcentral-call-ingest` actor and initiator plus server-verified telephony — never a client boolean. Browser extension is a channel and a Durable Actor origin, not a Command Origin. An unsupported origin refuses. This file does not connect. This file does not apply. This file does not mint a Decision ID.*

Who builds the HTTP bag, who proves telephony, who appends Entity Change, and who applies the named command already live in other **modules**. Do not pull those in.

## What this file actually does

Two operations of one “say whether this speaker may issue this command” story, not “a context helper,” and not Apply This Named Command Once / Form Lead Ingestion / adopt a RingCentral call:

1. **Refuse an incomplete envelope** — `command_id` and `idempotency_key` must be nonblank after trim. `payload_checksum` must be 64 hex digits (case-insensitive). Fail here before the origin switch. This beat does not lowercase the checksum (sibling `normalizeCommandContext` does that after a pass). This beat does not connect.

2. **Refuse unless this origin’s speaker is trusted** — switch on `provenance.origin` and allow only the four paths below. Anything else is `INVALID_DOMAIN_COMMAND_CONTEXT` (“Unsupported command origin.”). Granot and RingCentral identities cannot be client-forged: a trusted Owner cannot stand in as the Granot processor, and a RingCentral bag with the right actor ids still fails when the telephony verifier returns false.

**Sheet ingestion (`external_sheet_ingestion`)** — actor is system `best-relocation-ingestion` with matching role and origin. Initiator is a trusted human (`owner` or `admin`) with `vantage_admin` origin. Provenance has `run_id`, `source_receipt_id`, and `source_connection_key`. Best Relocation import-guard on create/update is a later adapter, not this file.

**Vantage Admin (`vantage_admin`)** — trusted owner/admin actor **and** initiator (same `isTrustedHumanActor(..., "vantage_admin")` rule), **or** both sides are the compatibility system actor (`vantage-api-secret` or `vantage-scoped-api-key:` + 16–64 hex) with the same `actor_id` and `request_id`. Clients cannot supply context fields on the later HTTP factory; this file only judges the bag it is handed.

**Granot lifecycle (`granot_lifecycle`)** — actor is the fixed processor (`granot-lifecycle-processor` / label `Granot Lifecycle Processor` / origin `granot_lifecycle` / nonblank `request_id`). Receipt, Observation, and Decision ids are nonblank. `source_receipt_id` equals the processor `request_id`. `observation_channel` is one of the three Observation Channels. Then the initiator path: webhook system initiator (`granot-webhook`, same receipt id) only when the channel is `granot_webhook`; browser-extension Owner only when the channel is `browser_extension`; or a `vantage_admin` trusted human after those identity checks (channel already in the set — this path does **not** re-bind channel to initiator). HTTP automation has no dedicated initiator actor; the Owner who approved the run speaks as `vantage_admin` with channel `granot_http_automation`.

**RingCentral (`ringcentral`)** — actor **and** initiator are the fixed `ringcentral-call-ingest` system snapshot. Then **ask** `verifier.verifyRingCentralTelephony({ source_receipt_id, source_connection_key })`. False → refuse. The default **adapter** is later `ringcentralProvenance.ts`. Tests inject a boolean.

There is no third mutate operation. `CommandContextVerifier` is the test / replica **adapter** (inject telephony proof). `defaultVerifier` is the live **adapter**. `isTrustedHumanActor` / `isTrustedOwnerActor` / `isCompatibilitySystemActor` / `isGranotLifecycleProcessorActor` / `isGranotWebhookInitiator` / `isRingCentralCallIngestActor` / `nonblank` are folds.

## Organization

Keep one file. This is the screenplay for “may this speaker issue this command.” Apply-once already lives on already-recommended `idempotency.ts`. Telephony proof already lives on later `ringcentralProvenance.ts`. HTTP bag already lives on later `existingWriteContext.ts`. Actor factories already live on `durableWork/actors.ts`. Owner printable `Idempotency-Key` already lives on `types.ts`. Checksum lowercase already lives on `idempotency.ts`. Do not pull those in. Do not invent a `CommandContextService` class. Do not invent an HTTP **seam**. Do not invent a Decision-ID **seam**. Do not invent a fifth origin so “browser extension can speak.”

Do not move this refuse into `idempotency.ts` so “the executor owns who may speak.” Do not move `verifyTrustedRingCentralTelephonyProvenance` here so “the speaker check includes the session store.” Do not move `existingWriteContextFromRequest` here so “one file builds and judges.” Do not add this file to `index.ts` so “routes can assert.” Do not split `create.ts` / `update.ts` / `delete.ts` or one file per origin.

**External interface** stays small (this is the test surface):

| Keep exporting | Story name | Why the seam exists |
|---|---|---|
| `assertCommandContext` | `refuseUnlessThisSpeakerMayIssueThisCommand` | executor **asks** before connect; four origins, fail-closed |
| `CommandContextVerifier` | `theTelephonyProofAdapter` | tests inject; default is sibling RingCentral telephony |

Keep the old names as one-line aliases until `idempotency.ts` migrates. Do not make callers learn `assert` as the domain language.

`CanonicalCommandContext` stays on `types.ts`. Do not move the type here so “the judge owns the bag.”

**No class for the workflow.** The one type that *does* earn a name is the already-built ask this file judges:

```ts
type WhoMaySpeak = CanonicalCommandContext
```

That is today’s context bag. Do not add `forged: boolean` so “the client can attest.” Do not add `origin: "browser_extension"` so “the channel becomes an origin.”

Leave apply-once on `idempotency.ts`. Leave telephony proof on `ringcentralProvenance.ts`. Leave HTTP context on `existingWriteContext.ts`. Leave actor factories on `durableWork/actors.ts`.

## The file, as a story

Parent functions stay deep. Child names are only extracted when they hide a real decision, not a one-liner.

```ts
// commandContext.ts
// Someone already named the command and brought a context bag.
// Refuse before anyone connects Mongo.
// The envelope must be complete.
// Then exactly four origins may speak.
// Granot and RingCentral identities cannot be client-forged.
// Browser extension is a channel, not an origin.
// Telephony is a server proof, not a client boolean.

// ── 1. Refuse an incomplete envelope ──────────────────────

export async function refuseUnlessThisSpeakerMayIssueThisCommand(
  context,
  verifier = theLiveTelephonyProof, // sibling
)
  if (!theEnvelopeIsComplete(context))
    throw INVALID_DOMAIN_COMMAND_CONTEXT
  switch (context.provenance.origin)
    case "external_sheet_ingestion": return thisWasSheetIngestion(context)
    case "vantage_admin":            return thisWasAVantageAdminSpeaker(context)
    case "granot_lifecycle":         return thisWasAGranotLifecycleSpeaker(context)
    case "ringcentral":              return thisWasRingCentralTelephony(context, verifier)
    default: throw "Unsupported command origin."

function theEnvelopeIsComplete(context)
  // nonblank command_id, nonblank idempotency_key, 64-hex checksum (case-insensitive)

// ── 2. Refuse unless this origin’s speaker is trusted ─────

function thisWasSheetIngestion(context)
  // dedicated best-relocation-ingestion actor
  // trusted human initiator (vantage_admin)
  // run_id + receipt + connection

function thisWasAVantageAdminSpeaker(context)
  if (trustedHuman(actor) && trustedHuman(initiator)) return
  if (compatibilitySystemPair(actor, initiator)) return  // same id + request_id
  throw

function thisWasAGranotLifecycleSpeaker(context)
  refuseUnlessThisIsTheFixedProcessor(actor)
  refuseUnlessReceiptObservationAndDecisionArePresent(provenance)
  refuseUnlessTheReceiptMatchesTheProcessorRequestId(actor, provenance)
  refuseUnlessTheChannelIsOneOfTheThreeObservationChannels(channel)
  if (webhookInitiatorForThisReceipt(initiator, receiptId))
    return onlyWhen(channel === "granot_webhook")
  if (browserExtensionOwner(initiator))
    return onlyWhen(channel === "browser_extension")
  if (trustedHuman(initiator, "vantage_admin"))
    return                                  // Owner who approved HTTP automation lands here
  throw

async function thisWasRingCentralTelephony(context, verifier)
  refuseUnlessBothSidesAreTheFixedCallIngestActor(actor, initiator)
  const proved = await verifier.verifyRingCentralTelephony({
    source_receipt_id,
    source_connection_key,
  })
  if (!proved) throw "server-verified telephony provenance"
```

Read the refuse path out loud: *the envelope must have a command id, an idempotency key, and a SHA-256 checksum. Then look at the origin. Sheet ingestion speaks only as the dedicated ingestion actor with a human approver and complete source provenance. Vantage Admin speaks as a trusted owner or admin pair, or as the matching API-secret / scoped-key system pair. Granot speaks only as the fixed processor, with receipt, Observation, and Decision in hand, and a channel that agrees with the webhook, the browser-extension Owner, or the Owner who approved the run. RingCentral speaks only as the fixed ingest actor after the server proves telephony. Anyone else, including a forged Granot actor or a client-attested RingCentral boolean, is refused before Mongo connects.*

That is the operation. `assertCommandContext` is not.

## Precise logic I would tighten while renaming

These are real smells the story names make obvious. Do not “just rename.”

1. **The file is named commandContext.** It does not build context. It refuses a bad speaker. The HTTP factory that *builds* the admin bag is later `existingWriteContext.ts`. The file name should say the story (`refuseUnlessThisSpeakerMayIssueThisCommand` / keep the path and alias the old file name until `idempotency.ts` moves).

2. **Knowledge says “vantage_admin Owner initiator” on Granot; the fold accepts owner or admin.** `isTrustedHumanActor` is the same helper Sheet ingestion and Vantage Admin use. An `admin` type with `vantage_admin` origin passes the Granot third path. Do not silently narrow that fold to `owner` so “the sentence becomes true,” and do not rewrite the Service in this pass. Parked in `CONTRADICTIONS.md`.

3. **`granot_http_automation` has no dedicated initiator actor.** Webhook and browser extension have matching initiator+channel pairs. HTTP automation speaks as the `vantage_admin` human who approved the run (`automationApply` / `runWorkflow` `approved_by`). Do not invent a `granot-http-automation` system initiator so “each channel has a speaker.” Do not require channel===`granot_http_automation` on the admin path so “the third path agrees too” — Owner Booking / discrepancy commands reuse that path with whatever channel the receipt already has.

4. **Checksum case is judged here and lowercased next door.** This file accepts `A-F`. Sibling `normalizeCommandContext` lowercases after a pass. Do not lowercase here so “one file owns the checksum,” and do not drop the `/i` so “stored checksums must already be lower.”

5. **The barrel does not export this file.** That is load-bearing. Routes and Granot modules build a bag and enter the executor. Do not add `assertCommandContext` to `index.ts` so “every adapter can pre-check.” A second call site would duplicate the fail-closed **seam** the executor already owns.

6. **Leave sibling modules alone.** `verifyTrustedRingCentralTelephonyProvenance`, `existingWriteContextFromRequest`, `createGranotLifecycleProcessorActor` / `createGranotWebhookInitiator` / `createBrowserExtensionOwnerInitiator` / `createBestRelocationIngestionActor` / `createRingCentralCallIngestActor`, and `assertOwnerCommandIdempotencyKey` are already the right **depth**. This file **asks** the first; it does not own them.

7. **Do not silently add `browser_extension` as a Command Origin.** Knowledge already says it is an Observation Channel / Durable Actor origin. Unsupported origin refuses. Do not widen the switch so “the extension can speak without Granot.”

## Testing

The **interface** is the test surface: `refuseUnlessThisSpeakerMayIssueThisCommand` (default verifier) and the injected `theTelephonyProofAdapter`.

Today’s `domainCommands.test.ts` already names AC-21 / AC-32 **through the executor**. Keep proving the operations, not the helpers. A later implementer may **ask** this export directly so a fail-closed test does not have to stand up a store — that is still the same **interface**, not a helper-unit leak.

**Incomplete envelope**
- Blank `command_id` or `idempotency_key` (including whitespace-only) refuses **before** origin rules and **before** `connect`.
- Checksum that is not 64 hex refuses. Uppercase 64 hex passes (lowercase happens next door).

**Four origins**
- Sheet ingestion: dedicated actor + trusted human initiator + run/receipt/connection → pass. Missing any of those → refuse.
- Vantage Admin: owner/admin pair → pass. Matching API-secret or scoped-key pair (same id + request_id) → pass. Mixed human + system, or mismatched scoped-key ids → refuse.
- Granot: fixed processor + receipt/Observation/Decision + receipt===request_id + webhook initiator + `granot_webhook` → pass. Forged Owner standing in as the processor → refuse (today’s AC-21). Webhook initiator + `browser_extension` channel → refuse (today’s AC-32). Browser-extension Owner + `browser_extension` → pass. `vantage_admin` human + channel in the set → pass. Missing Decision / Observation / receipt → refuse.
- RingCentral: fixed ingest actor + initiator + verifier true → pass. Verifier false → refuse with the telephony sentence (today’s AC-21). Right ids with a client-attested boolean and no verifier **ask** must not exist.

**Do not add**
- A test per helper (`theEnvelopeIsComplete`, `isTrustedHumanActor`, `nonblank`).
- A test that the default verifier called `findRingCentralCallSession` — that is the later telephony **interface**.
- A helper-unit test that has to change when `thisWasAGranotLifecycleSpeaker` is inlined.
- A live RingCentral network test.

`CommandContextVerifier` stays exported because AC-21 memory-store tests are a second real **adapter**, not a test leak.

## What I would not do

- A `CommandContextService` / `SpeakerService` class with `create` / `update` / `delete` / `assert`.
- Thirty two-line functions that only wrap `isTrustedHumanActor`.
- Moving this into a CRUD folder (`create.ts` / `update.ts` / `delete.ts`) or `assert.ts` / `origins/granot.ts` “for cleanliness.”
- Breaking the before-connect **seam**. This refuse must stay ahead of `connect` / store access.
- Treating Apply This Named Command Once, Form Lead Ingestion, Granot create-if-missing, or RingCentral adopt as this story. Those are callers that **build** a bag.
- Inventing an HTTP **seam** or a telephony-store **seam** that has only one **adapter** inside this file.
- Silently narrowing Granot’s third path to `owner`, silently adding a `granot-http-automation` initiator, silently exporting this file from the barrel, or silently adding `browser_extension` as a Command Origin.
- Writing a whole-folder recommendation for `domainCommands`.
- Jumping to `durableWork` while this checklist still has unchecked modules.
