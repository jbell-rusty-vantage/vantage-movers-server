# Walk The Six Gates, Write The CRM Source Confirmation With STOP, Then Remember And Send — Never Fail The Minted Lead — operational story

- Status: recommended
- Service: `leadMessaging` (Wave A, in-progress)
- Pass: 2 of this service — `granotCreatedLead.ts`
- Remaining in this service: `leadMessagingQueue.service.ts`, `twilioAdapter.ts` (`quietHours.ts` / `messageBuilder.ts` / `twilioVoice.ts` / `index.ts` skipped on open)
- Target: `src/services/leadMessaging/granotCreatedLead.ts`
- Knowledge: [`docs/knowledge/services/lead-messaging.md`](../../../docs/knowledge/services/lead-messaging.md) (Granot create-if-missing happy path). After-commit invoke: [`docs/knowledge/granot-lifecycle/processor.md`](../../../docs/knowledge/granot-lifecycle/processor.md). Distinct from remember / send-or-wake / claim-and-send / drain / callback / owner retry: [recommendations/lead-messaging-lead-messaging.md](lead-messaging-lead-messaging.md). Distinct from mint-this-Granot-customer (always hands the SMS bag; swallows throws; does not persist inside the mint write): [recommendations/granot-lifecycle-create-lead-from-granot.md](granot-lifecycle-create-lead-from-granot.md). Distinct from public-form consent + server-owned template v2: skipped `messageBuilder.ts` and Form Lead Ingestion [recommendations/form-lead.md](form-lead.md). Distinct from Owner CRM Source `outbound_sms` write: later Wave A `operationsRegistry` (`crmSourceOutboundSms.ts` already imports this file’s default template and unknown-placeholder fold). Distinct from queue publish env gate: later `leadMessagingQueue.service.ts`. Distinct from Twilio REST / webhook signature: later `twilioAdapter.ts`. Distinct from Eastern midnight–7 / 8:00 AM wall clock: skipped `quietHours.ts`. Distinct from voice TwiML: skipped `twilioVoice.ts`. Distinct from Analytics `sms-successfully-sent-then-booked`. This checkout’s `CONTEXT.md` does not define Lead Message / confirmation SMS / quiet hours — do not invent a glossary copy. `docs/adr/` is absent here — do not invent an ADR copy.
- Callers: **two runtime import sites plus three migrations, one sibling test, and one folder test.** After-commit mint: `granotLifecycle/createLeadFromGranot.ts` `finalize` always calls `sendGranotCreatedLeadConfirmation(pending.sms)` after Sheet Sync (and missing-CPL report) and swallows throws so the minted Lead, link, Decision, and outbox stay. Owner save: `operationsRegistry/crmSourceOutboundSms.ts` `setGranotCrmSourceOutboundSms` refuses unknown placeholders via `unknownOutboundSmsPlaceholders` and defaults a blank stored template to `DEFAULT_GRANOT_LEAD_CREATED_SMS_TEMPLATE`. Same default: `scripts/migrations/granot-crm-source-outbound-sms.lib.ts`, `granot-crm-source-outbound-sms-best-relocation.ts`, `paid-overflow-source-registry.ts`. Tests: `granotCreatedLead.test.ts` (six-gate table, `link_only`, `not_attested`, renderer + one STOP, `already_sent`, invalid refs); `crmSourceOutboundSms.test.ts` (default template). Not callers: `leadMessaging/index.ts` (does not re-export this file), `formLead.service.ts` (persist + dispatch, no gates), `synchronizeLeadFromGranot.ts`, public `/api/v1/form-leads`, voice routes, admin retry, queue / cron drain. `evaluateGranotLeadSmsGates` / `renderGranotLeadSmsBody` have no runtime caller besides `sendGranotCreatedLeadConfirmation`.
- Seams callers need: mint finalize vs this never-throw send; six-gate evaluation vs remember/send; Owner save-time placeholder refuse vs send-time leave-literal; CRM Source template + always-append STOP vs public-form template v2; persist / dispatch stay on the sibling (two remember shapes, one capacity reservation); `already_sent` is the `{observation_id, purpose}` unique index, not a second send
- Split later (only if the file outgrows one sitting): keep one file — this ~249-line module is one screenplay. If it later splits: `walkTheSixGranotCreatedLeadSmsGates.ts` / `writeTheCrmSourceConfirmationWithStop.ts` / `rememberAndSendTheGranotCreatedLeadConfirmation.ts` — story files, never `create.ts` / `send.ts` / `update.ts` / `delete.ts`, and never merge remember/send, queue publish, Twilio REST, Eastern clock, public-form template v2, voice TwiML, or the mint command into this file

`sendGranotCreatedLeadConfirmation` / `evaluateGranotLeadSmsGates` are executor mechanics. The owner question is: *We just minted a Vantage Lead from Granot because we had no match. Only text that person if every gate says yes: messaging is on, the Granot SMS flag is an explicit true, this CRM Source actually creates missing Leads, the Owner turned texting on for that source, a consent basis is recorded, and we have a phone. Write the CRM Source’s own template (`{first_name}` and `{company}` only) and always add `Reply STOP to opt out.` Remember the Lead Message through the same persist the public form uses, then send it or wake the drain. If this Observation already got that confirmation, say `already_sent`. If the refs are junk, say `blocked:invalid_refs` and write nothing. If anything throws, return `failed`. Never fail the minted Lead. This file does not decide `create_if_missing`. This file does not talk to Twilio itself.*

Remember/send, the mint command, Owner Registry writes, queue publish, Twilio REST, Eastern clock, public-form copy, and voice already live in other **modules**. Do not pull those in.

## What this file actually does

Four operations of one “may we text this minted Granot Lead?” story, not “a Granot SMS CRUD helper,” and not remember/send / the mint / Owner Registry writes:

1. **Walk the six gates** — pure. No queries. Evaluate every named gate and keep the full `evaluated_gates` array; the first failure is `blocked_reason`. Order: messaging mode is not `disabled`; `GRANOT_LEAD_CREATED_SMS_ENABLED` is an explicit boolean `true`; CRM Source `lead_created_policy === create_if_missing` (`link_only` and `observation_only` never text); `outbound_sms.enabled === true`; `consent_basis !== "not_attested"`; destination phone is present after trim. Capacity, E.164, country, and cooldown are **not** this function — they still run inside sibling persist. This beat does not write a Lead Message.

2. **Write the CRM Source confirmation with STOP** — substitute allowlisted `{first_name}` (blank → `there`) and `{company}` (Lead Source Company name / owner label, else `Vantage Movers`). Strip any existing `Reply STOP to opt out.` then append exactly one copy from the named constant. Unknown placeholders stay literal. This beat does not validate at send time.

3. **Refuse unknown placeholders when the Owner saves the template** — `{first_name}` and `{company}` only. `unknownOutboundSmsPlaceholders` is the save-time **seam** for `setGranotCrmSourceOutboundSms`. Send never calls it. This beat does not persist a CRM Source.

4. **Remember and send the Granot create-if-missing confirmation — never throw** — refuse non-ObjectId refs (`blocked:invalid_refs`, no persist). Load the CRM Source + Lead Source Company (or the injected context). Missing CRM Source becomes the same defaults as an observation-only, unattested, disabled source — gates then block. If a gate fails, log `lead_messaging.granot_created.blocked` and return `blocked:<first_gate>` with no row. Otherwise render, persist through the sibling Granot remember shape (`origin=granot_lead_created`, caller body, no form consent, `form_lead` only when the Lead is a Form Lead), then dispatch through the sibling send-or-wake. Mongo `11000` on `{observation_id, purpose}` → `already_sent` (success, not failure). Any other throw → `failed`. `testMode` is hardcoded `false`. This function does not persist inside the mint transaction. This function does not CRM-post.

There is no fifth mutate operation. `loadSendContext` and `isDuplicateKeyError` are child decisions of remember-and-send.

## Organization

Keep one file as the screenplay for “walk the six gates, write the CRM Source confirmation with STOP, then remember and send — never fail the minted Lead.” Remember/send, the mint, Owner Registry writes, queue publish, Twilio REST, Eastern clock, public-form copy, and voice already live in deeper **modules**. Do not pull those in. Do not invent a `GranotCreatedLeadService` class. Do not invent a canonical-command `begin` / `complete` **seam** here — `createLeadFromGranot` already owns the mint transaction; this file is the after-commit text. Do not invent a second persist **adapter** beside `persistLeadMessageIntent`. Do not invent a second renderer for Owner preview — ODR-40 already says preview must call this same function; do not write a second copy in `operationsRegistry`.

Do not move the six gates into `leadMessaging.service.ts` so “one persist owns every skip.” Do not move persist/dispatch here so “Granot owns remember.” Do not persist inside `createLeadFromGranot` so “the text is atomic with the Lead.” Do not split `create.ts` / `send.ts` / `gate.ts`. Do not silently treat `link_only` as textable when the Owner enabled `outbound_sms`. Do not silently skip the call when phone is missing — the mint always hands the bag; this file blocks on destination.

**External interface** stays small (this is the test surface). Gates, render, save-time placeholder refuse, and never-throw send are one story’s Granot confirmation, not four CRUD verbs:

| Keep exporting | Story name | Why the seam exists |
|---|---|---|
| `evaluateGranotLeadSmsGates` | `walkTheSixGranotCreatedLeadSmsGates` | send + folder table tests; Owner “why blocked” facts |
| `renderGranotLeadSmsBody` | `writeTheCrmSourceConfirmationWithStop` | send + folder fixtures; future Owner preview must share this |
| `unknownOutboundSmsPlaceholders` | `listUnknownOutboundSmsPlaceholders` | Owner save refuse; not send |
| `sendGranotCreatedLeadConfirmation` | `rememberAndSendTheGranotCreatedLeadConfirmation` | mint finalize; never throw |
| `DEFAULT_GRANOT_LEAD_CREATED_SMS_TEMPLATE` | keep | Owner save default + migrations |
| `GRANOT_LEAD_CREATED_SMS_OPT_OUT` | keep | renderer + tests |
| `GRANOT_LEAD_CREATED_SMS_MESSAGE_KEY` | keep | persist `message_key` |

Keep the old names as one-line aliases until `createLeadFromGranot` and `setGranotCrmSourceOutboundSms` migrate. Do not make callers learn `loadSendContext` / `isDuplicateKeyError` / `testMode: false` as the domain language.

**Principle: old exports stay as aliases.** `sendGranotCreatedLeadConfirmation` remains the imported name until the mint finalize points at the story name.

**No class for the workflow.** The type that *does* earn a name is the never-throw handoff the mint already stores on `pending.sms` and reads back as `{ message_id, status }`:

```ts
type GranotCreatedLeadSmsOutcome = {
  message_id: string | null
  status: string
}
```

That is the handoff from “the Lead is already minted” to “finalize can ignore a blocked / already-sent / failed text.” Do **not** add `evaluated_gates` so “the mint owns the Owner line,” do **not** add `body` so “finalize can log the text,” and do **not** add `job_no` so “the text can take Job Number.”

`GranotCreatedLeadSmsInput` stays the mint **adapter**. It is not a second public operation. The six gates are not this bag.

## The file, as a story

Parent functions stay deep. Child names are only extracted when they hide a real decision, not a one-liner.

```ts
// granotCreatedLead.ts
// We just minted a Vantage Lead from Granot.
// Only text that person if every gate says yes.
// Write the CRM Source's own confirmation and always add STOP.
// Remember it through the same persist the public form uses.
// Then send it or wake the drain.
// If this Observation already got that text, say already_sent.
// If anything throws, return failed.
// Never fail the minted Lead.
// This file does not talk to Twilio.
// This file does not decide create_if_missing.

// ── 1. Walk the six gates ─────────────────────────────────

export function walkTheSixGranotCreatedLeadSmsGates(facts)
export const evaluateGranotLeadSmsGates = walkTheSixGranotCreatedLeadSmsGates

function messagingIsTurnedOff(mode)
function theGranotSmsFlagIsNotAnExplicitTrue(flag)
function thisSourceDoesNotCreateMissingLeads(policy)
function theOwnerHasNotTurnedTextingOn(enabled)
function noConsentBasisIsRecorded(basis)
function thereIsNoDestinationPhone(destination)

// ── 2. Write the CRM Source confirmation with STOP ────────

export function writeTheCrmSourceConfirmationWithStop(input)
export const renderGranotLeadSmsBody = writeTheCrmSourceConfirmationWithStop

function nameTheCustomerOrSayThere(firstName)
function stripAnyExistingStopLine(body)

export const GRANOT_LEAD_CREATED_SMS_OPT_OUT = "Reply STOP to opt out."
export const DEFAULT_GRANOT_LEAD_CREATED_SMS_TEMPLATE =
  "Hi {first_name}, this is Vantage Movers. We got your request and we'll call you shortly to go over your move."

// ── 3. Refuse unknown placeholders when the Owner saves ───

export function listUnknownOutboundSmsPlaceholders(template)
export const unknownOutboundSmsPlaceholders = listUnknownOutboundSmsPlaceholders

// ── 4. Remember and send — never throw ────────────────────

export async function rememberAndSendTheGranotCreatedLeadConfirmation(input, dependencies)
export const sendGranotCreatedLeadConfirmation = rememberAndSendTheGranotCreatedLeadConfirmation

function refuseJunkObjectIds(input)
async function loadTheCrmSourceAndCompany(input)
function treatAMissingCrmSourceAsObservationOnly(loaded)
function remapConsentForPersist(basis)
async function rememberThroughTheSiblingPersist(input, body, outbound)
async function sendOrWakeThroughTheSiblingDispatch(message)
function thisObservationAlreadyGotThatConfirmation(error)

export const GRANOT_LEAD_CREATED_SMS_MESSAGE_KEY = "granot_lead_created_confirmation"
```

Read the primary path out loud: *The mint already committed. Sheet Sync already finalized. Walk the six gates on loaded facts — messaging on, Granot SMS flag explicit true, this source creates missing Leads, Owner texting on, consent attested, phone present. If the first gate fails, return `blocked:<gate>` and write nothing. Write the CRM Source template: first name or `there`, company name or Vantage Movers, exactly one STOP. Remember the Lead Message through sibling persist (no form consent; `lead_ref` Form or Call). Send it or wake the drain. If Mongo says this Observation already has that purpose, return `already_sent`. If anything else throws, return `failed`. The minted Lead stays.*

That is the operation. `sendGranotCreatedLeadConfirmation` is not.

## Precise logic I would tighten while renaming

These are real smells the story names make obvious. Do not “just rename.”

1. **Gate 6 is named `destination_and_capacity` and only checks trim.** Knowledge already says capacity still runs inside persist (E.164, country, hourly, cooldown). Name the gate as destination-present. Do not silently pull `reserveLeadMessagingCapacity` into the pure evaluator so “the name becomes true,” and do not drop persist capacity so “the gate owns it.”

2. **`evaluated_gates` is computed and thrown away.** Send returns `blocked:<first_gate>` only. ODR-40 said the full array is the Owner “why did nothing send” line. Do not silently return `evaluated_gates` on the mint outcome so “the Owner UI can read it,” and do not drop the unused array so “send is thinner.” Keep evaluating every gate.

3. **A missing CRM Source looks like `source_policy_create_if_missing`.** `loadSendContext` returns `null`; send then defaults `observation_only` / `not_attested` / enabled false. First blocker after mode + flag is the policy gate, not `source_missing`. Do not add a seventh gate so “missing source is honest” in this rename.

4. **`testMode: false` is hardcoded.** Sibling persist only skips TEST_MODE when the caller passes `testMode: true`. Granot remember therefore writes a row under `TEST_MODE`; sibling dispatch still returns `disabled` and leaves that row (already on CONTRADICTIONS via lead-messaging). Do not silently pass `isTestMode()` so “Granot matches public form,” and do not teach persist to ignore the flag.

5. **`dependencies.now` is accepted and never read.** Quiet hours / schedule live on sibling claim-and-send. Do not start using `now` here so “Granot owns overnight.”

6. **Consent remap at persist.** The gate allows any basis except `not_attested`. Persist then remaps anything that is not `customer_submitted_form` or `existing_relationship` to `existing_relationship`. A future third attested basis would pass then get rewritten. Name `remapConsentForPersist`. Do not silently persist the raw basis so “the gate wins.”

7. **The default template hardcodes “Vantage Movers”, not `{company}`.** Renderer will still substitute `{company}` when the Owner writes it. Do not silently change the default so “the brand is the Source Company.”

8. **Company name is Lead Source Company `name` / `owner_label`, not the CRM Source label.** Spec already notes the default brand is hardcoded. Do not silently read `normalized_granot_label` so “the text names Granot.”

9. **Mint finalize’s `try/catch` is a belt around a function that already never throws.** Leave both. Do not delete the mint catch so “one never-throw wins.”

10. **Unknown placeholders stay literal at send.** Owner save already refuses them. Do not refuse at send so “one validator,” and do not start substituting `{job_no}` so “the text can take Job Number.”

11. **Leave sibling modules alone.** `persistLeadMessageIntent` and `dispatchOrQueuePersistedLeadMessage` are already the right **depth**. This file orchestrates them after the gates. `setGranotCrmSourceOutboundSms` is the save **adapter**, not this story.

12. **Do not silently persist inside the mint transaction** so “the text is atomic with the Lead.” After-commit + unique `{observation_id, purpose}` is the redeliver fence.

13. **Do not silently skip the mint’s `pending.sms` call when phone is missing.** The mint always attaches the bag; this file blocks on destination.

## Testing

The **interface** is the test surface: `walkTheSixGranotCreatedLeadSmsGates`, `writeTheCrmSourceConfirmationWithStop`, `listUnknownOutboundSmsPlaceholders`, `rememberAndSendTheGranotCreatedLeadConfirmation`.

Today’s `granotCreatedLead.test.ts` already names the six-gate table (every gate as sole blocker plus all-pass), `link_only` never texts, `not_attested` blocks even when enabled, renderer substitutions + one STOP + unknown-left-literal, `already_sent` on 11000, and invalid refs without persist. That is a strong start and still not the whole send story. Do not add a test per helper.

**Gates**
- All six evaluated; first blocker wins; `evaluated_gates.length === 6` even when one fails.
- `link_only` / `observation_only` → `source_policy_create_if_missing` even when every other fact passes.
- `not_attested` blocks even when `outbound_sms.enabled` is true.
- Blank / whitespace destination → `destination_and_capacity` (today’s name) without calling persist.

**Render / placeholders**
- Default template + first name + STOP once.
- Missing first name → `there`. `{company}` → Lead Source name.
- Existing STOP line stripped; exactly one appended.
- `{job_no}` left literal at send; `listUnknownOutboundSmsPlaceholders` reports it for Owner save.

**Remember and send**
- Invalid ObjectIds → `blocked:invalid_refs`; persist not called.
- First failing gate → `blocked:<gate>`; persist not called.
- Missing CRM Source (null context) → blocked via defaults; persist not called.
- Happy path persist is the Granot remember shape: caller body, no form consent, `origin=granot_lead_created`, `message_key=granot_lead_created_confirmation`, `form_lead` only for Form Leads, `lead_ref` always, `testMode: false`.
- Dispatch is sibling send-or-wake; skipped persist rows are never sent.
- Duplicate key → `already_sent`, not `failed`.
- Any other throw → `{ message_id: null, status: "failed" }`; never throws into finalize.

**Not this interface**
- Remember / send-or-wake / claim / drain / callback / retry stay on [recommendations/lead-messaging-lead-messaging.md](lead-messaging-lead-messaging.md).
- Mint transaction / Sheet Sync finalize / swallow stay on [recommendations/granot-lifecycle-create-lead-from-granot.md](granot-lifecycle-create-lead-from-granot.md).
- Owner `outbound_sms` write / enable-requires-create_if_missing stay on later `operationsRegistry`.
- Queue publish env gate stays on later `leadMessagingQueue.service.ts`.
- Webhook signature stays on later `twilioAdapter.ts`.
- Public-form template v2 stays on skipped `messageBuilder.ts`.
- Voice forward / hangup stay on skipped `twilioVoice.ts`.

Do **not** add a test per helper (`thisSourceDoesNotCreateMissingLeads`, `stripAnyExistingStopLine`). Those names exist so the parent reads. If a helper test has to change when the helper is inlined, it was testing past the **interface**.

`walkTheSixGranotCreatedLeadSmsGates` stays exported because the folder table and a later Owner “why blocked” line are a second real **adapter**, not a test leak. `listUnknownOutboundSmsPlaceholders` stays exported because Owner save is a second real **adapter**.

## What I would not do

- A `GranotCreatedLeadService` class with `create` / `update` / `delete` / `send`.
- Thirty two-line functions that only wrap `persistLeadMessageIntent` or `dispatchOrQueuePersistedLeadMessage`.
- Moving this into a CRUD folder (`create.ts` / `send.ts` / `gate.ts` / `update.ts`) for cleanliness.
- Breaking the mint after-commit **seam**. Persist stays out of `executeCreation`. Twilio stays on the sibling.
- Treating public-form `persistLeadMessageIntent`, voice TwiML, Owner Registry writes, Sheet Sync drain, or Analytics cohort as this story.
- Inventing a second renderer **seam** that has only one **adapter** (Owner preview must call this same write).
- Inventing a second persist **seam** besides `persistLeadMessageIntent`.
- Silently “fixing” gate 6 into a capacity check, or `testMode: false` into `isTestMode()`, while recommending a rename.
- Jumping to `sheetSync` while `leadMessagingQueue.service.ts` is unchecked.
- Writing a whole-folder recommendation for `leadMessaging`.
- Teaching this file public-form consent, template v2, or voice TwiML.
- Failing the minted Lead because Twilio threw.
- Texting `link_only` because the Owner enabled `outbound_sms`.
