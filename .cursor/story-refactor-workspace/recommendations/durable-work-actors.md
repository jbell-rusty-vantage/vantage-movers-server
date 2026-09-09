# Name Who Is Speaking And Who Started This — Map An Already-Judged Registry Human Onto A Vantage Admin Speaker; Mint The Fixed Best Relocation, Reporting, Granot Processor, Granot Webhook, Browser-Extension Owner, And RingCentral Speakers; Wrap Speaker Plus Starter Plus Optional Run Command And Receipt; Redact Secret-Shaped Keys — Refuse A Registry System Actor Here — Never Judge Who May Speak, Never Build The HTTP Compatibility Bag, Never Apply A Command — operational story

- Status: recommended
- Service: `durableWork` (Wave A, in-progress)
- Pass: 3 of this service — `actors.ts`
- Remaining in this service: `checkpoints.ts`, `capability.ts`, `schema.ts`, `providerRetry.ts`, `runTransitions.ts`, `testing.ts`
- Target: `src/services/durableWork/actors.ts`
- Knowledge: none for this folder. Callers already have Services: [`docs/knowledge/services/domain-commands.md`](../../../docs/knowledge/services/domain-commands.md) (Command origins **judge** the snapshot this file **mints**; `browser_extension` is a DurableActor origin, not a Command Origin), [`docs/knowledge/granot-lifecycle/extension-apply.md`](../../../docs/knowledge/granot-lifecycle/extension-apply.md) (Owner session maps to `origin: "browser_extension"`), [`docs/knowledge/services/ingestion.md`](../../../docs/knowledge/services/ingestion.md) (fixed `best-relocation-ingestion` speaker plus a trusted human initiator), [`docs/knowledge/services/reporting.md`](../../../docs/knowledge/services/reporting.md) (routes **ask** the Registry map; the live harness invents its own speaker). Distinct from already-recommended [durable-work-leases.md](durable-work-leases.md) (named-scope fence; never names a speaker). Distinct from already-recommended [durable-work-checksum.md](durable-work-checksum.md) (seals a bag; never names a speaker). Distinct from later `checkpoints.ts` / `capability.ts` / `schema.ts` / `providerRetry.ts` / `runTransitions.ts` / `testing.ts`. Distinct from skipped `types.ts` `DurableActor` / `DurableAuditEnvelope` (this file **fills** those shapes). Distinct from already-recommended [domain-commands-command-context.md](domain-commands-command-context.md) (**asks** the minted ids; never imports this file). Distinct from already-recommended [domain-commands-existing-write-context.md](domain-commands-existing-write-context.md) (HTTP compatibility `vantage-api-secret` / scoped-key speakers stay there). Distinct from already-recommended [operations-registry-trusted-actor.md](operations-registry-trusted-actor.md) (HMAC-judges Registry headers; this file only **maps** the already-judged bag). Distinct from already-recommended [operations-registry-registry-audit.md](operations-registry-registry-audit.md) / leftover `snapshotSanitizer.ts` (own redact). Distinct from already-recommended [granot-lifecycle-processor.md](granot-lifecycle-processor.md) (webhook fallback **asks** this file; extension / HTTP automation already carry an initiator). Distinct from already-recommended [ringcentral-call-lead-convergence.md](ringcentral-call-lead-convergence.md) (**asks** the RingCentral factory, then builds the command bag). Distinct from already-recommended [reporting-live-google-orchestration.md](reporting-live-google-orchestration.md) (inline `HARNESS_ACTOR`; never **asks** `createReportingProjectionActor`). This checkout’s `CONTEXT.md` is a pointer plus four employee-booking terms — do not invent “Durable Actor” / “Initiator” copies. `docs/adr/` is absent here — do not invent ADR copies. Do not add a Durable Work Service in this rename.
- Callers: **six runtime families, plus two factories that only the folder test touches.** Wave B `reporting.routes.ts`, `ingestion.routes.ts`, `granot-automation.routes.ts`, and `granot-lifecycle-admin.routes.ts` **ask** `durableActorFromRegistryActor` after `requireRegistryReadActor` / `requireRegistryOwnerActor`. Wave B `ingestion.routes.ts` and `best-relocation-ingestion-cron.routes.ts`, plus already-recommended `ingestion/worker.ts`, **ask** `createBestRelocationIngestionActor` (HTTP request id, `heartbeat:<iso>`, or run id). Already-recommended Granot Owner modules (`bookingConfirmation.ts`, `bookingOwnerCommands.ts`, `referralBooking.ts`, `releaseOwnerCommands.ts`, `discrepancyOwnerCommands.ts`) **ask** `createGranotLifecycleProcessorActor(receiptId)` as the speaker and pass the Owner as initiator. Already-recommended `processor.ts` **asks** `createGranotWebhookInitiator` only when `moduleContext.initiator` is missing **and** the receipt channel is `granot_webhook`. Wave B `extension-granot-apply.routes.ts` **asks** `createBrowserExtensionOwnerInitiator` after the Owner session gate. Already-recommended `callLeadConvergence.service.ts` `buildRingCentralCommandContext` **asks** `createRingCentralCallIngestActor` for **both** speaker and starter. Barrel `durableWork/index.ts` re-exports this file. Tests: `durableWork.test.ts` (BR id ≠ reporting id; one nested sanitize). `domainCommands.test.ts` / `idempotency.integration.test.ts` / Granot create-sync tests mint the fixed Granot / RingCentral / BR snapshots. `ingestion.test.ts` mints BR. `crossChannel.test.ts` mints the extension Owner. Not this **interface**: `assertCommandContext`, `existingWriteContextFromRequest`, `requireRegistryOwnerActor`, `HARNESS_ACTOR`.
- Seams callers need: already-judged Registry bag vs this snake_case + `origin: "vantage_admin"` snapshot; speaker (`actor`) vs starter (`initiator`); fixed system id that already-recommended `commandContext.ts` gates on vs a human snapshot; refuse-Registry-system vs dedicated factory. There is no begin / complete Domain Command **seam**. There is no HMAC **adapter**. There is no “may this speaker issue” **adapter**. There is no per-origin Command Origin **adapter**.
- Split later (only if the file outgrows one sitting): this ~150-line file is one sitting if you read it as name who is speaking and who started this. If it later splits: `nameThisAlreadyJudgedRegistryHumanAsAVantageAdminSpeaker.ts`, `nameTheFixedSystemSpeakers.ts` — never `create.ts` / `update.ts` / `delete.ts` / one file per factory. Compatibility API-secret speakers, the speaker-gate, HMAC, and leftover Registry redact stay siblings / other services.

`create*` / `durableActorFromRegistryActor` / `sanitizeDurableMetadata` are executor mechanics. The owner question is: *Someone already decided who is at the desk, or the company already named a fixed system worker. Write the snapshot the rest of the company will store: type, id, label, role, request, and origin. A Registry human becomes a Vantage Admin speaker — never a Registry system actor; those must use a dedicated factory. Best Relocation ingestion, Reporting projection, the Granot Lifecycle Processor, the Granot webhook, and RingCentral call ingest are fixed ids. The Owner on the browser extension is a human starter with origin `browser_extension`, not a Command Origin. Then pair speaker and starter, optionally name the run / command / receipt, and stamp when. Secret-shaped keys in leftover metadata become `[redacted]`. This file does not say whether the speaker may issue a command. This file does not verify HMAC. This file does not mint `vantage-api-secret`. This file does not apply.*

Who judges the command, who builds the HTTP compatibility bag, who HMAC-s Registry headers, and who applies already live in other **modules**. Do not pull those in.

## What this file actually does

One “name who is speaking and who started this” story with four owner operations, not “an actor factory file,” and not Say Whether This Speaker May Issue This Command / Hand This HTTP Request A Trusted Vantage Admin Bag:

1. **Name this already-judged Registry human as a Vantage Admin speaker** — `durableActorFromRegistryActor`. Copy type / id / label / role / request id. Stamp `origin: "vantage_admin"`. `actorType === "system"` → `TypeError` (“Registry system actors must use a dedicated durable system-actor factory.”). This beat does **not** HMAC. This beat does **not** read headers.

2. **Name the fixed system speaker or starter** — five dedicated factories. Each writes a closed snapshot. This beat does **not** take a caller-chosen `actor_id` except the extension Owner (already authenticated). This beat does **not** apply.
   - Best Relocation ingestion (`best-relocation-ingestion`, origin `external_sheet_ingestion`) — worker, HTTP queue, cron heartbeat.
   - Reporting projection (`reporting-projection`, origin `reporting_projection`) — **no runtime caller today**.
   - Granot Lifecycle Processor (`granot-lifecycle-processor`, origin `granot_lifecycle`, `request_id` = receipt id) — Owner commands and create/sync tests.
   - Granot webhook initiator (`granot-webhook`, same origin, `request_id` = receipt id) — processor fallback when the receipt is a webhook and no initiator was carried.
   - RingCentral call ingest (`ringcentral-call-ingest`, origin `ringcentral`) — leftover convergence bag uses the same snapshot as speaker **and** starter.
   - Browser-extension Owner initiator (`actor_type: "owner"`, origin `browser_extension`) — Wave B extension apply after the Owner session gate.

3. **Wrap speaker and starter into the audit envelope** — `createDurableAuditEnvelope`. Keep `actor` and `initiator`. Default `run_id` / `command_id` / `source_receipt_id` to null. Keep `occurred_at`. This beat does **not** persist. This beat has **no runtime caller today**.

4. **Redact secret-shaped keys from leftover metadata** — `sanitizeDurableMetadata`. Walk objects and arrays. Keys matching `authorization|cookie|credential|password|secret|token|api[_-]?key|refresh|raw[_-]?row|report[_-]?row` become `"[redacted]"`. Dates are leaves. This beat does **not** bound depth. This beat has **no runtime caller today**.

There is no fifth mutate operation. `isRecord` is the walk guard. Re-export through the barrel is convenience for callers, not a second story.

## Organization

Keep one file. This is the screenplay for “name who is speaking and who started this.” `DurableActor` / `DurableAuditEnvelope` already live on skipped `types.ts`. Who may speak already lives on already-recommended `commandContext.ts`. The HTTP compatibility bag already lives on already-recommended `existingWriteContext.ts`. HMAC already lives on already-recommended `trustedActor.ts`. Who applies already lives on already-recommended workers / Owner commands / leftover convergence. Do not pull those in. Do not invent a `DurableActorService` class. Do not invent a begin / complete Domain Command **seam**. Do not invent a “may this speaker issue” **seam** that has only the string ids as an **adapter**. Do not invent a CRUD folder so “each factory gets a file.”

Do not move `createVantageApiSecretActor` here so “every system speaker shares a folder.” Do not move `assertCommandContext` here so “mint and judge share a file.” Do not move `requireRegistryOwnerActor` here so “HMAC and map share a file.” Do not split `create.ts` / `fromRegistry.ts`.

**External interface** stays small (this is the test surface):

| Keep exporting | Story name | Why the seam exists |
|---|---|---|
| `durableActorFromRegistryActor` | `nameThisAlreadyJudgedRegistryHumanAsAVantageAdminSpeaker` | reporting / ingestion / Granot automation / Granot admin routes after Registry gates |
| `createBestRelocationIngestionActor` | `nameTheFixedBestRelocationIngestionSpeaker` | worker, HTTP queue, cron; `commandContext` gates this id |
| `createReportingProjectionActor` | `nameTheFixedReportingProjectionSpeaker` | reserved origin `reporting_projection`; no runtime caller yet |
| `createGranotLifecycleProcessorActor` | `nameTheFixedGranotLifecycleProcessorSpeaker` | Owner commands; processor request id must equal receipt id |
| `createGranotWebhookInitiator` | `nameTheGranotWebhookAsWhoStartedThisReceipt` | processor fallback; channel must stay `granot_webhook` |
| `createBrowserExtensionOwnerInitiator` | `nameThisOwnerAsWhoStartedThisFromTheBrowserExtension` | extension apply; origin is a channel, not a Command Origin |
| `createRingCentralCallIngestActor` | `nameTheFixedRingCentralCallIngestSpeaker` | leftover convergence; speaker and starter are the same snapshot |
| `createDurableAuditEnvelope` | `wrapThisSpeakerAndStarterIntoTheAuditEnvelope` | the handoff bag; unused at runtime today |
| `sanitizeDurableMetadata` | `redactSecretShapedKeysFromThisLeftoverBag` | leftover metadata walk; unused at runtime today |

Keep the old names as one-line aliases until Wave B routes, already-recommended workers / Owner commands, leftover convergence, and tests migrate. Do not make callers learn `actor_type` / `origin` field copies as the domain language. Do **not** rename persisted `actor_id` strings (`best-relocation-ingestion`, `granot-lifecycle-processor`, `granot-webhook`, `ringcentral-call-ingest`) — already-recommended `commandContext.ts` and `domainCommands/types.ts` gate on those exact ids.

**No workflow class.** The one type that *does* earn a name already lives on skipped `types.ts`:

```ts
type WhoIsSpeakingAndWhoStartedThis = {
  actor: DurableActor
  initiator: DurableActor
  run_id: string | null
  command_id: string | null
  source_receipt_id: string | null
  occurred_at: Date
}
```

That is today’s `DurableAuditEnvelope` — the handoff from “we named both sides” to “store or pass the pair.” Do **not** add `observation_channel` here so “the envelope owns the Granot gate.” Do **not** add `payload_checksum` here so “this file owns the command.” Do **not** add `secret` here so “HMAC can share the snapshot.”

Leave `DurableActor` on skipped `types.ts`. Leave the speaker-gate on already-recommended `commandContext.ts`. Leave HTTP compatibility speakers on already-recommended `existingWriteContext.ts`. Leave HMAC on already-recommended `trustedActor.ts`.

## The file, as a story

Parent functions stay deep. Child names are only extracted when they hide a real decision, not a one-liner.

```ts
// actors.ts
// Someone already decided who is at the desk,
// or the company already named a fixed system worker.
// Write the snapshot. Pair speaker and starter.
// Do not say whether they may issue a command.

// ── 1. Name this already-judged Registry human ────────────

export function nameThisAlreadyJudgedRegistryHumanAsAVantageAdminSpeaker(
  alreadyJudged: RegistryActorContext,
): DurableActor {
  if (alreadyJudged.actorType === "system") {
    throw new TypeError("Registry system actors must use a dedicated durable system-actor factory.")
  }
  return {
    actor_type: alreadyJudged.actorType,
    actor_id: alreadyJudged.actorId,
    actor_label: alreadyJudged.actorLabel,
    actor_role: alreadyJudged.actorRole,
    request_id: alreadyJudged.requestId,
    origin: "vantage_admin",
  }
}

// ── 2. Name the fixed system speaker or starter ───────────

export function nameTheFixedBestRelocationIngestionSpeaker(requestId: string): DurableActor {
  return fixedSystemSpeaker({
    actor_id: "best-relocation-ingestion",
    actor_label: "Best Relocation ingestion",
    origin: "external_sheet_ingestion",
    request_id: requestId,
  })
}

export function nameTheFixedReportingProjectionSpeaker(requestId: string): DurableActor
export function nameTheFixedGranotLifecycleProcessorSpeaker(receiptId: string): DurableActor
export function nameTheGranotWebhookAsWhoStartedThisReceipt(receiptId: string): DurableActor
export function nameTheFixedRingCentralCallIngestSpeaker(requestId: string): DurableActor

export function nameThisOwnerAsWhoStartedThisFromTheBrowserExtension(input: {
  actor_id: string
  actor_label: string
  request_id: string
}): DurableActor {
  return {
    actor_type: "owner",
    actor_id: input.actor_id,
    actor_label: input.actor_label,
    actor_role: "owner",
    request_id: input.request_id,
    origin: "browser_extension",
  }
}

// ── 3. Wrap speaker and starter ───────────────────────────

export function wrapThisSpeakerAndStarterIntoTheAuditEnvelope(input: {
  actor: DurableActor
  initiator: DurableActor
  run_id?: string | null
  command_id?: string | null
  source_receipt_id?: string | null
  occurred_at: Date
}): WhoIsSpeakingAndWhoStartedThis {
  return {
    actor: input.actor,
    initiator: input.initiator,
    run_id: input.run_id ?? null,
    command_id: input.command_id ?? null,
    source_receipt_id: input.source_receipt_id ?? null,
    occurred_at: input.occurred_at,
  }
}

// ── 4. Redact leftover metadata ───────────────────────────

export function redactSecretShapedKeysFromThisLeftoverBag(
  value: Record<string, unknown>,
): Record<string, unknown> {
  // walk objects/arrays; matching keys → "[redacted]"; Date is a leaf
}

function fixedSystemSpeaker(input): DurableActor {
  return { actor_type: "system", actor_role: "system", ...input }
}
```

Read the Granot Owner path out loud: *The Owner already signed the desk command. Name the Granot Lifecycle Processor as the speaker and stamp the receipt id as its request. Keep the Owner as who started this. Already-recommended `commandContext.ts` will later refuse unless that processor id, that receipt id, and an Observation Channel that agrees with the starter are all present. This file does not judge. This file does not apply. This file does not mint a Decision.*

That is the operation. `createGranotLifecycleProcessorActor` is not.

## Precise logic I would tighten while renaming

These are real smells the story names make obvious. Do not “just rename.”

1. **Fixed ids are copied, not shared.** This file hardcodes `best-relocation-ingestion`, `granot-lifecycle-processor`, `Granot Lifecycle Processor`, `granot-webhook`, and `ringcentral-call-ingest`. Already-recommended `domainCommands/types.ts` exports the Granot / RingCentral constants; already-recommended `commandContext.ts` also hardcodes the Best Relocation id. A typo here would pass TypeScript and fail the speaker-gate at apply time. Do not silently import the Domain Command constants so “one module owns the strings” without an **interface** proof that every live snapshot still matches. Do not move the speaker-gate here so “mint and judge share a file.”

2. **`nameTheFixedReportingProjectionSpeaker` has no runtime caller.** Live reporting routes **ask** the Registry map. Already-recommended `liveGoogleOrchestration.ts` invents inline `HARNESS_ACTOR` (`reporting-live-google-harness`, same `reporting_projection` origin). Do not silently route the harness through this factory so “one reporting speaker owns tests and prod” — that would change the stored harness id. Do not delete the factory so “nothing imports it.”

3. **`wrapThisSpeakerAndStarterIntoTheAuditEnvelope` has no runtime caller.** Every live command builds `CanonicalCommandContext` itself (speaker, starter, provenance). Do not silently replace those bags with this envelope so “one wrap owns apply” — the command bag also needs checksum, idempotency key, and Observation Channel. Do not delete the export so “the type has no constructor.”

4. **`redactSecretShapedKeysFromThisLeftoverBag` has no runtime caller and disagrees with leftover Registry redact.** This regex includes `cookie`, `refresh`, `raw_row`, and `report_row`, and walks nested objects without a depth cap. Leftover `snapshotSanitizer.ts` caps depth at 3 and uses a shorter secret pattern, then **asks** Observational `sanitizeEventDetails`. Already-recommended `redactSensitiveActorSnapshot` is shallow. Receipt evidence uses its own credential redact. Do not silently route Registry audit or receipt evidence through this walk so “one redact owns the company.” Do not silently add a depth cap here so “both walks match” without an **interface** proof.

5. **Registry system refuse is untested on the live path.** `REGISTRY_CHANGE_ACTOR_TYPES` includes `"system"`, but every runtime caller of the map is `requireRegistryReadActor` / `requireRegistryOwnerActor` (human). The `TypeError` is the only thing stopping a future system Registry bag from looking like a dedicated factory. Add an **interface** proof. Do not remove the refuse so “Registry never sends system.”

6. **The extension factory trusts the route.** It does not check Owner role or refuse Sales. Wave B `requireExtensionOwnerInitiator` already gated. Do not add a role check here so “the factory owns auth.” Do not move the route gate here so “durable work owns sessions.”

7. **Best Relocation `request_id` is three different clocks.** HTTP queue uses the request id. The worker uses the run id. Cron uses `heartbeat:<iso>`. Already-recommended `commandContext.ts` only requires the speaker id / origin / a trusted human initiator — not that `request_id` equal `run_id`. Do not silently force run id here so “one clock owns BR” without an **interface** proof of stored run rows.

8. **HTTP automation has no dedicated starter factory.** Already-recommended `commandContext.ts` accepts a `vantage_admin` human when the channel is `granot_http_automation`. Routes **ask** the Registry map. Do not invent `createGranotHttpAutomationInitiator` this pass so “every channel has a factory.”

9. **Leave sibling modules alone.** Skipped `types.ts` owns the union. Already-recommended `commandContext.ts` owns the refuse. Already-recommended `existingWriteContext.ts` owns compatibility API-secret speakers. Later `checkpoints.ts` owns cursors. Do not open those as a second recommendation this pass.

## Testing

The **interface** is the test surface: `nameThisAlreadyJudgedRegistryHumanAsAVantageAdminSpeaker`, the six named speaker / starter factories, `wrapThisSpeakerAndStarterIntoTheAuditEnvelope`, `redactSecretShapedKeysFromThisLeftoverBag`.

Today’s folder test only proves BR id ≠ reporting id and one nested `refresh_token` / `raw_row` redact. That is not enough for the refuse or the fixed snapshots the speaker-gate depends on.

Add tests that name the operation:

**Registry map**
- Owner / admin bag → same ids, `origin: "vantage_admin"`.
- `actorType: "system"` → `TypeError`. Does not mint a dedicated factory snapshot.

**Fixed speakers**
- BR / reporting / processor / webhook / RingCentral → exact `actor_id`, `actor_label`, `actor_role: "system"`, and origin.
- Processor and webhook `request_id` is the receipt id the caller passed.
- Extension Owner → `actor_type: "owner"`, `origin: "browser_extension"`, caller-supplied id / label / request.
- BR id ≠ reporting id ≠ processor id ≠ webhook id ≠ RingCentral id.

**Envelope / redact**
- Missing run / command / receipt → null, not omitted.
- Nested secret-shaped key → `"[redacted]"`; `Date` stays a `Date`; array of objects is walked.
- This file does not HMAC. This file does not persist.

**Out of scope for this interface**
- This file does not call `assertCommandContext`.
- This file does not mint `vantage-api-secret` or a scoped-key fingerprint.
- This file does not verify Registry HMAC.
- This file does not apply a Lead, Booking, plan, or revision.

Do **not** add a test per helper (`isRecord`, `fixedSystemSpeaker`). Those names exist so the parent reads. If a helper test has to change when the helper is inlined, it was testing past the **interface**.

The factories stay exported because speaker vs starter vs Registry map are a real **adapter** seam (human desk, fixed system, extension channel), not a test leak.

## What I would not do

- A `DurableActorService` / `DurableWorkService` class with `create` / `update` / `delete`.
- Thirty two-line functions that only wrap an object literal.
- Moving this into a CRUD folder (`create.ts` / `fromRegistry.ts` / one file per factory) for cleanliness.
- Breaking the Registry-system refuse **seam**. A Registry system bag must not look like a dedicated factory.
- Treating `assertCommandContext`, `existingWriteContextFromRequest`, HMAC Registry gates, or leftover `HARNESS_ACTOR` as this story.
- Inventing a Command Origin **seam** that has only `browser_extension` as an **adapter**.
- Silently importing Domain Command id constants, silently routing the live harness through `nameTheFixedReportingProjectionSpeaker`, or silently replacing `CanonicalCommandContext` with this envelope.
- Jumping to `checkpoints.ts` before this file is on the checklist.
- Writing a whole-folder recommendation for `durableWork`.
