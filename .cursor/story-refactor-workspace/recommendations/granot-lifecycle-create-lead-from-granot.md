# Mint This Granot Customer As A Vantage Lead, And Never Post It Back — operational story

- Status: recommended
- Service: `granotLifecycle` (Wave A, in-progress)
- Pass: 21 of this service — `createLeadFromGranot.ts`
- Remaining in this service: `bookingReconciliation.ts` and the rest of the `granotLifecycle` checklist in TRAVERSAL.md
- Target: `src/services/granotLifecycle/createLeadFromGranot.ts`
- Knowledge: [`docs/knowledge/granot-lifecycle/processor.md`](../../../docs/knowledge/granot-lifecycle/processor.md) lists this file as primary code beside `processor.ts`, `synchronizeLeadFromGranot.ts`, `bookingReconciliation.ts`, `leadDesiredState.ts`, and `granotTemporal.ts` — they are siblings, not this pass. Authorized-creation section and after-commit SMS: same file. Trusted mint stamp: [`docs/knowledge/granot-lifecycle/revisions.md`](../../../docs/knowledge/granot-lifecycle/revisions.md) and [recommendations/granot-lifecycle-trusted-lead-create-validation.md](granot-lifecycle-trusted-lead-create-validation.md). Executor / `EntityChange`: [`docs/knowledge/services/domain-commands.md`](../../../docs/knowledge/services/domain-commands.md). Confirmation text: [`docs/knowledge/services/lead-messaging.md`](../../../docs/knowledge/services/lead-messaging.md). Distinct from public WordPress ingest that may CRM-post: [recommendations/form-lead.md](form-lead.md). Distinct from the write onto a matched Lead: [recommendations/granot-lifecycle-synchronize-lead-from-granot.md](granot-lifecycle-synchronize-lead-from-granot.md). Distinct from “did Granot give enough?”: [recommendations/granot-lifecycle-lead-desired-state.md](granot-lifecycle-lead-desired-state.md) (`evaluateMinimumCreationData`). Distinct from fail-closed gates: [recommendations/granot-lifecycle-source-policy.md](granot-lifecycle-source-policy.md). Distinct from the processor’s live invoke / race replan: [recommendations/granot-lifecycle-processor.md](granot-lifecycle-processor.md). Software map: `.cursor/rules/granot-lifecycle-capture.mdc` (`createLeadFromGranot.ts` row). This checkout’s `CONTEXT.md` does not define Granot Observation / Synchronization Decision / Granot Record Link / Ingestion Origin — do not invent a glossary copy. `docs/adr/` is absent here — do not invent ADR copies.
- Callers: **one live service import.** `processor.ts` (`maybeCreateLead` → `deps.createLead ?? createLeadFromGranot` after live + creation + every gate + eligible no-match; builds the no-patch envelope; identity / link races reload and replan, max 3). Registry: `domainCommands/index.ts` (`canonicalDomainCommands.createLeadFromGranot`). Type-only: `domainCommands/types.ts`. Tests: `createLeadFromGranot.test.ts` (AC-08: observation-scoped key, checksum semantics, no raw transport, envelope refuse). Replica proof: `createLeadFromGranot.replica.test.ts` (AC-07 / AC-08 / AC-09: atomic Form mint, Call phone vs Job-only, route-assignment refuse, competing identity, replay / checksum conflict, stage rollback, same-Job race, processor replan). Processor unit locks “invoke once / never invoke.” Ingestion tests stub the command name as a fixture. Not callers: `synchronizeLeadFromGranot.ts`, `formLead.service.ts`, `callLead.service.ts`, `trustedLeadCreateValidation.ts` (this file calls it), `leadDesiredState.ts`, `leadIngestionProvenance.ts`, public `/api/v1/form-leads` / `/call-leads`, `capture.ts`, `drainer.ts`.
- Seams callers need: public mint vs executor `operation` / `finalize` (sheets, missing CPL, SMS after commit); Form mint vs Call mint; no-caller-patch envelope vs WordPress ingest; establish-only Job attach vs matched-Lead attach/dispute; `CreateLeadFromGranotRaceError` vs a hard throw
- Split later (only if the file outgrows one sitting): keep one file — this ~970-line command is one screenplay. If it later splits: `mintThisGranotCustomerAsAVantageLead.ts` / `attachThisJobToTheNewLead.ts` / `tellSheetsAndMaybeTextTheCustomer.ts` — story files, never `create.ts` / `update.ts` / `delete.ts`, and never `form.ts` / `call.ts`

`createLeadFromGranot` / `executeCreation` are executor mechanics. The owner question is: *Granot already has this customer. We have no matching Vantage Lead. If we are live, creation is on, every gate allowed, and Granot gave enough: mint a Form or Call Lead from that Observation, attach the Job if it is free, remember the Decision, and after commit project the Lead onto sheets and maybe send a confirmation text. Stamp it as coming from Granot. Never CRM-post it back. Never fill an existing link. Never invent a Booking. This file does not plan `create_if_missing`. This file does not write onto a Lead that already exists.*

Planning, trusted stamp, identity, gates, matched-Lead sync, and processor Decision-only persist already live in other **modules**. Do not pull those in.

## What this file actually does

Three operations of one authorized-create story, not “a create CRUD service,” and not the planner / the trusted stamp / the matched-Lead write / public WordPress ingest:

1. **Mint this Granot customer as a Vantage Lead** — refuse extra keys, a caller patch, a bad Observation id, a missing receipt/decision provenance, or the wrong idempotency key. For a Call with a phone, take the RingCentral convergence lock before the executor so ingest cannot mint the same scope in the same window. Inside the transaction: reload the Observation and matching receipt. Refuse unless `route_event_class` is `lead_created`, processing is on, execution is `live` (not historical shadow), every creation gate is allowed, minimum data is eligible, the selected model and Source Scope still match the envelope, identity is unmatched with no candidates, and the checksum still names this mint. Price CPL from the Granotularity at Observation time. Parse the trusted Form or Call bag (`post_to_granot: false`, `ingestion_origin: "granot_lead_created"`). Persist the Lead with Granot snapshots, current provenance, and `quoted` only when Priority is `1` or `5`. Form derives `local` from accepted states (or the selected Move Type). Call Job-only is legal; `ringcentral_convergence` is `pending` when a phone exists and `not_applicable` when it does not. Fabricate no duration, session ids, or transport source. Remember `EntityChange` from empty (`revision_before: 0`) and a `created` / `lead_created_authorized` Decision. Enqueue `form_lead.create` / `call_lead.create` in the same session. This function does not CRM-post. This function does not `$set` a Lead that already exists.

2. **Attach this Job to the new Lead — establish only** — if no active Granot link exists for this normalized Job, create one that names this Lead and this Source Scope. If any active link already exists — including a historical lead-less reservation — abort as `link_duplicate`. The unique partial `{ provider, normalized_job_no }` where `state: "active"` is the reservation fence. A 11000 on insert is the same race. This function does not attach, confirm, or dispute. Those belong to the matched-Lead write.

3. **After commit, project sheets and maybe text the customer** — `finalizeSheetSync` the pending create job. If the CPL snapshot was missing, report it. Always hand `sendGranotCreatedLeadConfirmation` the pending SMS bag; that sibling owns the six gates (messaging mode, Granot SMS flag, `create_if_missing`, CRM Source outbound SMS, attested consent, destination). Swallow a thrown text so the minted Lead, link, Decision, and outbox stay. Quiet hours stay off unless that sibling’s flag is on. This function does not persist the message inside the mint transaction.

There is no fourth mutate operation. `createLead` / `reserveRecordLink` / `assertSingleActiveRingCentralAssignment` are beats, not public stories. Form and Call persist are two **adapters** of one “mint from this Observation” rule. The executor `operation` / `finalize` pair is the before-commit / after-commit **seam**, not a second public export. `fail_after` is a replica injection, not a story.

## Organization

Keep one file as the screenplay for “mint this Granot customer as a Vantage Lead, attach the Job if it is free, then tell sheets and maybe text.” Planning, trusted stamp, identity, gates, matched-Lead `$set`, and processor invoke already live in deeper **modules**. Do not pull those in. Do not invent a `CreateLeadFromGranotService` class. Do not invent a second `begin` / `complete` export — `executeCanonicalCommandWithPostCommit` already is that **seam**. Do not invent a write **seam** that has only one **adapter** here.

Do not move this into `processor.ts` so “knowledge lists both as primary code.” Do not move this into `formLead.service.ts` so “every Form create is one ingest.” Do not merge this file into `synchronizeLeadFromGranot.ts` so “one Granot Lead command.” Do not merge this file into `trustedLeadCreateValidation.ts` so “the only caller already stamps origin.” Do not split `form.ts` / `call.ts`.

**External interface** stays small (this is the test surface):

| Keep exporting | Story name | Why the seam exists |
|---|---|---|
| `createLeadFromGranot` | `mintThisGranotCustomerAsAVantageLead` | processor’s only create-if-missing write |
| `CreateLeadFromGranotInput` | `AGranotMintWeMayCommit` | no patch; Observation + model + Source Scope + provenance |
| `CreateLeadFromGranotRaceError` | `ThisGranotMintLostARace` | processor reloads and replans (max 3) |
| `createLeadFromGranotIdempotencyKey` | `theObservationMintKey` | `granot:create-lead:<observation_id>` replay fence |
| `createLeadFromGranotPayloadChecksum` | `hashWhatThisMintMeans` | same key / different meaning is an idempotency conflict |
| `CREATE_LEAD_FROM_GRANOT_COMMAND_NAME` | keep as alias | executor registry string |

Keep the old names as one-line aliases until `processor.ts` and `canonicalDomainCommands` migrate. Do not make callers learn `executeCreation` / `fail_after` / `assertCommandEnvelope` as the domain language.

**No class for the workflow.** The type that *does* earn a name is the pending bag handed across commit:

```ts
type GranotLeadMintInProgress = {
  sheetJob: {
    resource: "source_lead"
    operation: "form_lead.create" | "call_lead.create"
    leadModel: "FormLead" | "CallLead"
    leadId: string
  }
  cpl_missing?: { /* today’s missing-rate report */ }
  sms?: {
    lead_ref: { model: "FormLead" | "CallLead"; id: string }
    observation_id: string
    lead_source_company_id: string
    granot_crm_source_id: string
    destination_phone?: string
    first_name?: string
  }
}
```

That is the handoff from “the Lead and Job are saved” to “project onto sheets, report a missing rate, and maybe text.” Do **not** add a caller `patch`, `post_to_granot: true`, or official Booking fields so “the mint is complete,” and do **not** persist the SMS row inside the transaction so “the text is durable with the Lead.”

## The file, as a story

Parent functions stay deep. Child names are only extracted when they hide a real decision, not a one-liner.

```ts
// createLeadFromGranot.ts
// Granot already has this customer. We have no matching Vantage Lead.
// Mint a Form or Call Lead from that Observation.
// Attach the Job if it is free. If a link already exists, stop and let the processor replan.
// Stamp origin granot_lead_created. Never CRM-post it back.
// After commit, project onto sheets and maybe text the customer.
// This file does not plan create_if_missing.
// This file does not write onto a Lead that already exists.

// ── 1. Mint this Granot customer as a Vantage Lead ────────

export async function mintThisGranotCustomerAsAVantageLead(input)
  refuseACallerPatchOrABrokenEnvelope()
  ifCallWithPhone, holdTheRingCentralWindowBeforeWeWrite()
  // then executeCanonicalCommandWithPostCommit:
  //   beginTheGranotMint(session)
  //   completeTheGranotMintByTellingSheetsAndMaybeTexting(pending)

async function beginTheGranotMint(input, session, now)
  reloadTheCreatingObservationAndItsReceipt()
  refuseUnlessLiveCreationAndEveryGate()
  refuseUnlessGranotGaveEnoughToMint()            // evaluateMinimumCreationData
  refuseIfIdentityNowHasAMatchOrACandidate()
  refuseIfTheChecksumNoLongerNamesThisMint()
  ifCall, refuseUnlessExactlyOneActiveInboundRouteWhenAnyExist()
  priceTheLeadFromTheGranotularity()
  writeTheFormOrCallLeadFromThisObservation()
  attachThisJobToTheNewLead()                     // establish only
  rememberEntityChangesFromEmpty()
  rememberTheCreatedDecision()
  rememberSheetSyncIntent()

function writeTheFormOrCallLeadFromThisObservation(observation, source)
  acceptThisGranotStatementAsANewFormOrCallLead() // trusted parse; never post back
  stampOriginGranotCreatedAndTheSnapshots()
  ifForm, deriveLocalFromAcceptedStates()
  ifCall, markConvergencePendingOrNotApplicable()
  quotedOnlyWhenPriorityIsOneOrFive()
  saveTheLead()

// ── 2. Attach this Job to the new Lead — establish only ─

async function attachThisJobToTheNewLead(job, lead)
  ifNoActiveLink, establishANewRecordLink()
  ifAnyActiveLinkExists, loseTheLinkDuplicateRace()  // including lead-less

// ── 3. After commit, project sheets and maybe text ──────

async function completeTheGranotMintByTellingSheetsAndMaybeTexting(pending)
  projectTheLeadOntoSheets()
  ifMissingRate, reportTheMissingCpl()
  tryToTextTheCustomerAndSwallowAFailure()
```

Read the primary path out loud: *The processor already kept the Observation, already asked which Registry row it is, already asked which Form or Call Lead it is, already asked whether Granot gave enough, and already authorized a live `create_if_missing` mint. This command is live, creation is on, and every gate allowed. Reload the Observation. If a Lead appeared, or this Job is already reserved, or the route no longer qualifies, stop and let the processor replan. Mint a Form or Call Lead stamped `granot_lead_created` with `post_to_granot: false`. A Form still needs a name, a phone, two states, and two ZIPs. A Call may be Job-only. Quoted is true only for Priority `1` or `5`. Attach a new active Record Link that names this Lead. If any active link already exists, do not fill it. Remember the Decision and the Changes in the same transaction. After commit, project the Lead onto sheets. Maybe send a confirmation text; if Twilio throws, the Lead still exists. Nobody CRM-posts this Lead back to Granot. Nobody writes a Booking. Nobody `$set`s a WordPress Form that later matches — that is the other command.*

That is the operation. `createLeadFromGranot` is not a CRUD create. `executeCreation` is not.

## Precise logic I would tighten while renaming

These are real smells the story names make obvious. Do not “just rename.”

1. **Command-door gates are required; the processor already checked.** `maybeCreateLead` invokes only when live + creation + every gate + eligible no-match. This file reloads Observation, policy, gates, route, identity, and checksum. That is two **adapters**, not a duplicate to delete. Do not drop the door so “the processor already authorized,” and do not skip the processor check so “the command can take a raw mint.”

2. **No caller patch.** `assertCommandEnvelope` refuses extra keys, including `patch`. Routes and clients may not supply Job, origin, CPL, convergence, or `post_to_granot`. Do not add a patch argument so “create can also correct,” and do not start accepting WordPress fields so “one Form create.”

3. **Existing active link is a race, not an attach.** `reserveRecordLink` throws `link_duplicate` if any active row exists, including a historical lead-less reservation. The processor then replans; if still eligible it persists `conflict` / `record_link_conflict`. Do not attach or fill that row so “synchronize already knows how,” and do not dispute it here so “one link writer.” Those belong to `synchronizeLeadFromGranot`.

4. **`route` is minimum data, not a RingCentral route.** `evaluateMinimumCreationData` ineligible throws `CreateLeadFromGranotRaceError("route")`. `assertSingleActiveRingCentralAssignment` throws `"route_assignment"`. The processor special-cases only `route_assignment` → `insufficient_creation_data` / `missing_creation_route_data`. A `"route"` loser reloads and replans. Do not rename the kind to `minimum_data` without a processor test that still maps it, and do not treat `"route"` as `"route_assignment"` so “one missing-route code.”

5. **Origin is stamped twice.** Trusted parse writes `ingestion_origin: "granot_lead_created"`. Then the provenance bag reprints the same key and wins if they ever diverge. The trusted-stamp pass already named this. Do not delete the schema stamp so “the command already set it,” and do not delete the provenance key so “the schema is the authority.”

6. **`quoted` is derived here, not planned here.** Priority `1` / `5` → `quoted: true`; otherwise false. The planner has the same rule for matched writes. Do not call the planner so “quoted lives in one place,” and do not leave `quoted` off the insert so “the trusted schema does not name it.”

7. **Form `local` comes from accepted states, or from the selected Move Type.** `selected_move_type === "any"` calls `selectFormMoveType`. A pinned Local / long-distance snapshot wins. `move_date` stays absent when the Observation omits it. Do not invent a date so “Form create always has a move,” and do not call WordPress location resolution so “one locate helper.”

8. **Call writes move fields after trusted parse.** The Call schema has no pickup / delivery. This file still copies origin / destination / cubic feet when Granot sent them. Do not add move fields to the trusted Call schema so “persist matches Form,” and do not stop writing them so “the schema is the persist bag.”

9. **RingCentral lock is two-phase.** `ensureRingCentralConvergenceScopeLock` runs *before* the executor (no session). `acquireRingCentralConvergenceScopeLock` plus `findPreCreationRingCentralConvergenceCandidates` run *inside* the transaction. Candidates → `"identity"` race. Do not drop the outer lock so “the session lock is enough,” and do not move candidate search into `identity.ts` so “one ladder.”

10. **Assignment check is configured-only.** Zero assignment rows means Granot-only Call mint. One or more rows require exactly one active/effective assignment to an active, valid route; otherwise `"route_assignment"`. Do not invent an assignment when none exist, and do not skip the check so “Call Job-only never needs a phone number.”

11. **SMS always rides `pending`; gates live in the messaging sibling.** Finalize always calls `sendGranotCreatedLeadConfirmation` and swallows throws. Do not persist the message inside `beginTheGranotMint` so “the text is atomic with the Lead,” and do not pull `evaluateGranotLeadSmsGates` here so “one file owns customer notice.” Do not skip the call when phone is missing — the sibling blocks on destination.

12. **Sheet Sync and missing CPL stay after commit, in that order.** Intent is enqueued in-session. `finalizeSheetSync` then `recordMissingLeadCplRate` then SMS. Do not move CPL report inside the write so “pricing is complete,” and do not send SMS before sheets so “the customer hears first.”

13. **Checksum names the mint, not the transport.** Observation id, Job, model, Source Scope / policy version, and normalized contact / move. Raw `source_label` / issues / headers are excluded. Do not hash the webhook body so “replay sees everything,” and do not omit policy version so “same Job can change meaning.”

14. **`domain_revision` starts at 0; `EntityChange` bumps it.** The Lead insert does not `$inc`. The creation Change is `revision_before: 0`. Replica locks `domain_revision === 1` after commit. Do not `$inc` inside `createLead` so “CAS is local,” and do not skip the Change so “the insert already wrote.”

15. **Exact replay returns stored refs.** Same observation key returns the first mint. Same key / different checksum is `DOMAIN_COMMAND_IDEMPOTENCY_CONFLICT` and creates no partial state. Do not mint a second Lead on replay so “the Observation changed,” and do not treat checksum conflict as a race the processor should replan into a second insert.

16. **Knowledge lists this file under the processor.** `processor.md` Primary code is orchestration + this command + matched-Lead + Booking case + planner + temporal. This file does not open a Booking case. Do not move it into `processor.ts` so the Primary-code line “wins,” and do not start opening cases here so “create and book are one sitting.”

17. **Leave sibling modules alone.** Trusted stamp stays in `trustedLeadCreateValidation.ts`. Minimum data stays in `leadDesiredState.ts`. Gates stay in `sourcePolicy.ts`. Identity stays in `identity.ts`. Matched-Lead `$set` / attach / dispute stay in `synchronizeLeadFromGranot.ts`. Decision-only persist stays in `processor.ts`. SMS gates stay in `leadMessaging/granotCreatedLead.ts`. Executor / `EntityChange` stay in `domainCommands/`. ObjectId construction stays in `utils/objectId.ts`.

18. **Do not treat WordPress ingest, matched-Lead sync, Booking confirm, or drain as this story.** Those CRM-post a website quote, `$set` a Lead we already have, write an official Booking, or claim a receipt. This file only mints from Granot, attaches a free Job, and after commit tells sheets and maybe texts.

19. **Do not write a whole-folder recommendation for `granotLifecycle`.**

## Testing

The **interface** is the test surface: `mintThisGranotCustomerAsAVantageLead` (today `createLeadFromGranot`). `CreateLeadFromGranotRaceError`, `theObservationMintKey`, and `hashWhatThisMintMeans` are part of that **interface**. `fail_after` is a replica injection, not a public story.

Today’s `createLeadFromGranot.test.ts` locks the envelope and checksum: observation-scoped key, checksum covers Observation / model / scope / policy version / contact, checksum excludes raw transport, refuse bad id / missing provenance / wrong key / extra `patch`. That is the door, not the mint. `createLeadFromGranot.replica.test.ts` is the real proof. Keep those replica cases. Add command-level names for the gaps (replica may stay the Mongo proof):

**Mint this Granot customer as a Vantage Lead**
- Concurrent same-Observation replay commits one Form, one command, one Change pair, origin `granot_lead_created`, `post_to_granot: false` (already locked).
- Form `local` is derived from accepted states; `move_date` absent stays absent (add the absent-date case; today’s seed sends a date).
- Call with phone is `ringcentral_convergence.pending` and fabricates no telephony (already locked).
- Call Job-only is `not_applicable` and may omit phone (already locked).
- Competing scoped Call phone identity creates nothing (already locked).
- Same key / different checksum creates no partial state (already locked).
- Stage failures after lead / link / changes / decision / outbox roll back to zero (already locked).
- Live-shadow / creation-disabled / failed gate never persist a Lead (processor unit already locks “never invoke”; add a command-door race if a caller bypasses the processor).

**Attach this Job to the new Lead**
- No active link → establish + `record_link_established` (already locked).
- Any pre-existing active link, including lead-less → `link_duplicate`; processor replans to `record_link_conflict` (replica processor race already locked).
- Concurrent same-Job writers keep one Lead and one active link (already locked).
- Do not add a test that this file attaches or disputes an existing link.

**After commit, project sheets and maybe text**
- `form_lead.create` / `call_lead.create` intent is remembered before commit; `finalize` runs after (replica outbox already locked).
- Missing CPL is reported after commit, not inside the write (replica Form `missing_rate` already locked; add that `recordMissingLeadCplRate` is not called when a rate exists).
- A throwing confirmation text leaves Lead, link, Decision, and outbox unchanged (add this; today’s replica does not force the provider to throw).
- Do not add a test that SMS persist runs inside the mint transaction.

Do **not** add a test per helper (`compact`, `normalizeZip`, `sourceFacts`, `failAfter`). Those names exist so the parent reads. If a helper test has to change when the helper is inlined, it was testing past the **interface**.

Do **not** re-test trusted-schema AC-07, planner minimum-data, eight gates, or matched-Lead `$set` here. Do not add a test that this file CRM-posts, opens a Booking case, or `$set`s a WordPress Form. Do not add a test that establish-only lives in `synchronizeLeadFromGranot`.

## What I would not do

- A `CreateLeadFromGranotService` class with `create` / `update` / `delete`.
- Thirty two-line functions that only wrap `save`.
- Moving this into a CRUD folder, or into `processor.ts` / `formLead.service.ts` / `synchronizeLeadFromGranot.ts` / `trustedLeadCreateValidation.ts` “for cleanliness.”
- Splitting `form.ts` / `call.ts` / `create.ts` / `apply.ts`.
- Adding a caller `patch` or accepting `post_to_granot: true`.
- Attaching or disputing a pre-existing active link so “one link writer.”
- Persisting the confirmation text inside the mint transaction, or letting a thrown text abort the applied result.
- Calling `createFormLead` / `deriveFormLeadIngestionOrigin` so “one ingest.”
- Silently renaming `CreateLeadFromGranotRaceError("route")` to `minimum_data` without a processor mapping test.
- Writing a whole-folder recommendation for `granotLifecycle`.
