# Turn Confirmation Texts On Or Off For This Granot Name After A Matching Observation Becomes A Lead — Refuse Until The Name Creates Leads If Missing, A Consent Basis Is Recorded, And The Name Is Operationally On — Saving A New Message Or Reverting Consent Turns Texting Off — Write The Sms-Policy Registry Change In The Same Transaction — Forget Policy List And Health Caches Only After Commit — Show Recent Texts With The Number Masked And Never The Body — Never Send The Text — operational story

- Status: recommended
- Service: `operationsRegistry` (Wave A, in-progress)
- Pass: 10 of this service — `crmSourceOutboundSms.ts`
- Remaining in this service: `granotCrmSourceProjections.ts`, `granotAutomationSources.ts`, `trustedActor.ts`, `registryAudit.ts`, `runtimeTelemetry.ts`, `queries/overview.ts`, `queries/health.ts`, `queries/changes.ts`
- Target: `src/services/operationsRegistry/crmSourceOutboundSms.ts`
- Knowledge: [`docs/knowledge/services/operations-registry.md`](../../../docs/knowledge/services/operations-registry.md) (Owner-only `GranotCrmSource.outbound_sms` command; enabling requires `lead_created_policy=create_if_missing` and a recorded consent basis; “template or consent-basis changes force the text off” — **code forces off only on template change or revert to `not_attested`**, not when consent moves `customer_submitted_form` ↔ `existing_relationship`; audit `entityType` is `granot_crm_source_sms_policy`; sending is a post-commit Lead Message side effect, not a Registry write; `create_if_missing` does not send texts; default backfill `pnpm migration:granot-crm-source-outbound-sms`; Best Relocation enable `pnpm migration:granot-crm-source-sms-best-relocation`; Paid Overflow create + SMS enable `pnpm migration:paid-overflow-source`). Software rule: [`.cursor/rules/operations-registry.mdc`](../../../.cursor/rules/operations-registry.mdc) (Owner enable/disable is `setGranotCrmSourceOutboundSms`; “no `daily_cap` on the Owner command; stored field is copied through” — **code + Zod + Wave B PATCH still accept `daily_cap`**; “Leaving `create_if_missing` also turns `outbound_sms.enabled` off in the same `createOrUpdateGranotCrmSource` mutation” — **sibling `granotCrmSources.ts` does not write `outbound_sms`**). Send path: [`docs/knowledge/services/lead-messaging.md`](../../../docs/knowledge/services/lead-messaging.md) + already-recommended [recommendations/lead-messaging-granot-created-lead.md](lead-messaging-granot-created-lead.md) (six gates after mint finalize; this file does not walk them). Already-recommended Granot name cards: [recommendations/operations-registry-granot-crm-sources.md](operations-registry-granot-crm-sources.md) (**asks** `toSmsView` on list/get attach; does **not** write SMS; does **not** turn SMS off when leaving `create_if_missing`). Owner UI spec §4.2 / §4.3: [`docs/operations-registry-source-connections-owner-ui-specification.md`](../../../docs/operations-registry-source-connections-owner-ui-specification.md) (same save cannot turn texting on and edit the template; `{company}` is leftover, Owner copy offers `{first_name}` only; `daily_cap` is persisted and returned but is not consulted by the send path; leaving `create_if_missing` must turn SMS off on the other write path — that is sibling work, not this file). Transaction/audit: `registryAudit.ts` (`withRegistryMutation`). Cache keys: `granotCrmSourceCache.ts` (`GRANOT_LIFECYCLE_SOURCE_CACHE_KEYS`). Placeholder refuse + default template: `leadMessaging/granotCreatedLead.ts` (`unknownOutboundSmsPlaceholders`, `DEFAULT_GRANOT_LEAD_CREATED_SMS_TEMPLATE`). Destination mask: `granotLifecycle/projections.ts` (`maskContactLabel`). This checkout’s `CONTEXT.md` does not define confirmation text / Lead Message / consent basis — do not invent a glossary copy. `docs/adr/` is absent here — do not invent an ADR copy. Do not add this path to knowledge in this rename.
- Callers: Wave B `PATCH /api/v1/admin/granot-crm-sources/:id/outbound-sms` (**asks** `setGranotCrmSourceOutboundSms` and **returns this file’s view** — unlike sibling policy PATCH, which re-reads projection). Wave B `GET .../:id/outbound-sms/recent` **asks** `listRecentGranotCrmSourceSms` (`requireRegistryReadActor`; Admin may read). Already-recommended `granotCrmSources.ts` **asks** `toSmsView` only. Best Relocation enable `scripts/migrations/granot-crm-source-outbound-sms-best-relocation.ts` **asks** `setGranotCrmSourceOutboundSms` + `toSmsView`. Paid Overflow `scripts/migrations/paid-overflow-source-registry.ts` **asks** both after sibling create. Default backfill `scripts/migrations/granot-crm-source-outbound-sms.ts` `$set`s defaults and **does not import this file**. Barrel: `operationsRegistry/index.ts` (set + list; `toSmsView` is **not** barrelled). Tests: `crmSourceOutboundSms.test.ts` (`toSmsView` defaults off / `not_attested` / default template / version 1 / `daily_cap` 0; non-owner / `not_attested` enable / `{job_no}` placeholder reject before Mongo; list only proves a bad ObjectId). Already-recommended send tests live in `granotCreatedLead.test.ts` — do not retest the six gates here. `sourcePolicy.ts` / mint finalize / Twilio **do not import this file**.
- Seams callers need: Owner PATCH (`id` on the path, Owner, reason, returns this view) vs migration enable (Best Relocation / Paid Overflow **ask** the same command) vs sibling card attach (`toSmsView` only); Owner actor on every write; `withRegistryMutation` (sms policy + one `granot_crm_source_sms_policy` Registry Change before commit vs `granot_lifecycle_source_policy` / `granot_lifecycle_source_list` / `granot_lifecycle_source_health` forget after commit); HTTP recent is a read **adapter** (Admin ok)
- Split later (only if the file outgrows one sitting): this ~300-line file is one sitting if you read it as turn confirmation texts on or off for this Granot name after a matching observation becomes a Lead — refuse until the name creates leads if missing, a consent basis is recorded, and the name is operationally on — saving a new message or reverting consent turns texting off — write the sms-policy Registry Change in the same transaction — forget policy list and health caches only after commit — show recent texts with the number masked and never the body — never send the text. If it later splits: `recordOrCorrectThisGranotNameConfirmationTextPolicy.ts` / `showRecentConfirmationTextsForThisGranotName.ts` — story files, never `create.ts` / `update.ts` / `delete.ts` / `enable.ts` / `sms.ts`, and never merge sibling Granot name write, send gates, mint finalize, `withRegistryMutation`, cache keys, placeholder fold, destination mask, default backfill `$set`, Admin projection, automation-source link, or Wave B HTTP into this file

`setGranotCrmSourceOutboundSms` / `listRecentGranotCrmSourceSms` / `toSmsView` are executor mechanics. The owner question is: *After a matching Granot observation becomes a Lead because this name creates the Lead if we do not have it, the Owner may turn a confirmation text on or off for that name. Refuse unless they are Owner and named a reason of 10 to 1000 characters. Refuse an empty or over-320-character template. Refuse any placeholder except `{first_name}` and leftover `{company}`. Texting stays off until a consent basis is recorded. An inactive Granot name cannot send texts. A name that does not create missing Leads has nothing to text about. Saving a new message increments the template version and leaves texting off. Reverting consent to not attested leaves texting off. Changing consent from one attested basis to the other does not, by itself, turn texting off. The write and one `granot_crm_source_sms_policy` Registry Change share a transaction. Policy, list, and health caches forget only after commit. The Owner may see recent texts for this name with the destination masked and never the body. This file does not send a text. This file does not mint a Lead. This file does not walk the six send gates. This file does not turn texting off when sibling leaves `create_if_missing`.*

Sibling Granot name write, send gates, mint finalize, `withRegistryMutation`, cache keys, placeholder fold, destination mask, default backfill, Admin projection, automation-source link, Twilio, and Wave B HTTP already live in other **modules**. Do not pull those in.

## What this file actually does

Two operations of one “turn confirmation texts on or off for this Granot name after a matching observation becomes a Lead — refuse until the name creates leads if missing, a consent basis is recorded, and the name is operationally on — saving a new message or reverting consent turns texting off — write the sms-policy Registry Change in the same transaction — forget policy list and health caches only after commit — show recent texts with the number masked and never the body — never send the text” story, not “an outbound SMS CRUD service,” and not send / mint / sibling Granot name write:

1. **Record or correct this Granot name’s confirmation-text policy** — `setGranotCrmSourceOutboundSms`. Owner only (`actorRole !== "owner"` → `FORBIDDEN` / `Registry mutations require an Owner actor.`). Reason trimmed 10–1000 (`An explicit reason of 10 to 1000 characters is required.`). `granot_crm_source_id` must be an ObjectId. Template trimmed cannot be empty or exceed 320. **Asks** `unknownOutboundSmsPlaceholders` (`The template can only use {first_name} and {company}.`). `enabled` + `consent_basis === "not_attested"` → `Texting stays off until a consent basis is recorded.` — this refuse is **before** Mongo. **Asks** `withRegistryMutation`. Audit `entityType: "granot_crm_source_sms_policy"`; `action` is `activate` when `command.enabled` else `update` — **not** the computed `enabled`. Invalidate `GRANOT_LIFECYCLE_SOURCE_CACHE_KEYS` **after** commit. Inside the transaction: load the card or `NOT_FOUND` (`Granot CRM source not found.`). `command.enabled` + `lead_created_policy !== "create_if_missing"` → `DEPENDENCY_CONFLICT` 400 (`This Granot name does not create leads yet, so there is nothing to text about.` / `open_granot_names`). `command.enabled` + operational `enabled === false` → `An inactive Granot name cannot send texts.` Previous view **asks** `toSmsView`. Computed `enabled = command.enabled && !templateChanged && !basisReverted`. `templateChanged` increments `template_version` and stamps `deactivation_reason: "template_changed"`. `basisReverted` (`not_attested` from a recorded basis) stamps `consent_basis_reverted`. Else-off stamps `owner_disabled`. `basisChanged` (a new attested basis) restamps `consent_attested_by` / `consent_attested_at`; moving one attested basis to the other does **not** force off. `daily_cap` is `command.daily_cap ?? previous.daily_cap`. `activated_at` keeps the first on-stamp when still on; `deactivated_at` is `now` whenever off. `$set`s the whole `outbound_sms` document. Trigger is always `granot_lead_created`. Wave B PATCH returns this view. Best Relocation / Paid Overflow **ask** this same command. This beat does **not** send a text. This beat does **not** write `lead_created_policy`. This beat does **not** walk send gates.

2. **Show recent confirmation texts for this Granot name** — `listRecentGranotCrmSourceSms`. ObjectId or 400. Limit 1–50, default 10. Loads `LeadMessage` rows where `granot_crm_source` matches, newest `createdAt` first. Maps `sent_at` ← `sent_at` else `accepted_at` else `createdAt` else `null`. Destination is `maskContactLabel({ phone_number: row.to })`. Never selects or returns a body. `template_version` is `source_template_version ?? template_version ?? null`. Wave B GET **asks** this after a read actor. This beat does **not** open a transaction. This beat does **not** send a text. This beat does **not** retry a failed message.

There is no third send operation. There is no mint operation. `toSmsView` is the stored-policy **adapter** sibling cards and migrations already **ask**. `withRegistryMutation` is the transaction **adapter**. `unknownOutboundSmsPlaceholders` is the save-time placeholder **adapter**. `maskContactLabel` is the destination-mask **adapter**. Wave B PATCH / GET recent are second write/read **adapters**, not second owner stories. Default backfill `$set`s defaults and never **asks** this file.

`invalid` / `stringValue` sit on the write and view paths. They are not extra owner operations. Do not export `invalid` as a public **seam**. Do not export `toSmsView` as domain language for “send” — it never sends.

## Organization

Keep one file as the screenplay for “turn confirmation texts on or off for this Granot name after a matching observation becomes a Lead, refuse until the name creates leads if missing, a consent basis is recorded, and the name is operationally on, saving a new message or reverting consent turns texting off, write the sms-policy Registry Change in the same transaction, forget policy list and health caches only after commit, show recent texts with the number masked and never the body, never send the text.” Sibling Granot name write, send gates, mint finalize, `withRegistryMutation`, cache keys, placeholder fold, destination mask, default backfill, Admin projection, automation-source link, Twilio, and Wave B HTTP already live in deeper **modules**. Do not pull those in. Do not invent an `OutboundSmsService` class. Do not invent a begin / complete **seam** — `withRegistryMutation` is already the before-commit / after-commit **adapter**. Do not invent a second placeholder **adapter** beside `unknownOutboundSmsPlaceholders`. Do not invent a second send **adapter** beside already-recommended `sendGranotCreatedLeadConfirmation`.

Do not split this into `create.ts` / `update.ts` / `delete.ts` / `enable.ts` / `sms.ts` as a CRUD folder. Those are persistence verbs, and “enable” is not what a template-change save does. Do not move `sendGranotCreatedLeadConfirmation` into this file so “one file owns SMS.” Do not move `createOrUpdateGranotCrmSource` into this file so “the card owns texting.” Do not silently start sending here so “the write stays hot.”

**External interface** stays small (this is the test surface). Record-or-correct and show-recent are one story’s confirmation-text policy, not two CRUD verbs:

| Keep exporting | Story name | Why the seam exists |
|---|---|---|
| `setGranotCrmSourceOutboundSms` | `recordOrCorrectThisGranotNameConfirmationTextPolicy` | Owner PATCH; Best Relocation enable; Paid Overflow enable |
| `listRecentGranotCrmSourceSms` | `showRecentConfirmationTextsForThisGranotName` | Owner/Admin GET recent |
| `toSmsView` | `showTheStoredConfirmationTextPolicy` | sibling card attach; migration inventory |
| `OutboundSmsCommand` | `RecordOrCorrectThisGranotNameConfirmationTextPolicy` | Owner write + reason |
| `OwnerOutboundSmsView` | `ThisGranotNameConfirmationTextPolicy` | PATCH return; sibling `outbound_sms` attach |
| `RecentOutboundSmsRow` | `AMaskedRecentConfirmationText` | GET recent row; never a body |

Keep the old names as one-line aliases until Wave B PATCH / GET recent, sibling card attach, Best Relocation, Paid Overflow, the barrel, and `crmSourceOutboundSms.test.ts` migrate. Do not make callers learn `setGranotCrmSourceOutboundSms` / `toSmsView` as the domain language.

**Principle: old exports stay as aliases.** `setGranotCrmSourceOutboundSms` remains the imported name until Owner PATCH / Best Relocation / Paid Overflow migrate. Persisted Registry Change `action` values (`activate` / `update`) and `deactivation_reason` strings (`template_changed` / `consent_basis_reverted` / `owner_disabled`) stay those strings — they are audit history, not story names.

**No class for the workflow.** The type that *does* earn a name is the Owner confirmation-text policy sibling cards already attach and PATCH already returns:

```ts
type ThisGranotNameConfirmationTextPolicy = {
  granot_crm_source_id: string
  enabled: boolean
  trigger: "granot_lead_created"
  body_template: string
  template_version: number
  consent_basis: "not_attested" | "customer_submitted_form" | "existing_relationship"
  consent_attested_by?: {
    actor_type?: string
    actor_id?: string
    actor_label?: string
    actor_role?: string
  }
  consent_attested_at?: string
  daily_cap: number
  activated_at?: string
  deactivated_at?: string
  deactivation_reason?: string
}
```

That is the handoff from “the Owner recorded whether this Granot name may text after a create-if-missing Lead” to “mint finalize may walk the six gates, sibling cards may attach the view.” Do **not** add `sent_count` so “recent lives on the policy.” Do **not** drop `daily_cap` from today’s view in this rename without a paired interface + Zod + HTTP test — the field is stored and returned even though send ignores it. Do **not** add `lead_created_policy` so “the SMS command owns create-if-missing.”

Do not add `withRegistryMutation` as a public **seam** — `registryAudit.ts` already owns that. Do not add `unknownOutboundSmsPlaceholders` as a public **seam** from this file — `leadMessaging/granotCreatedLead.ts` already owns that. Do not add `sendGranotCreatedLeadConfirmation` as a public **seam** — that is already-recommended send. Do not add `createOrUpdateGranotCrmSource` as a public **seam** — sibling cards already own that. Do not add `maskContactLabel` as a public **seam** from this file — `granotLifecycle/projections.ts` already owns that.

## The file, as a story

Parent functions stay deep. Child names are only extracted when they hide a real decision, not a one-liner.

```ts
// crmSourceOutboundSms.ts
// After a matching Granot observation becomes a Lead because this name
// creates the Lead if we do not have it, the Owner may turn a confirmation
// text on or off for that name.
// Refuse unless they are Owner and named a reason.
// Refuse an empty or over-320-character template.
// Refuse any placeholder except {first_name} and leftover {company}.
// Texting stays off until a consent basis is recorded.
// An inactive Granot name cannot send texts.
// A name that does not create missing Leads has nothing to text about.
// Saving a new message increments the template version and leaves texting off.
// Reverting consent to not attested leaves texting off.
// The write and one granot_crm_source_sms_policy Registry Change share a transaction.
// Policy, list, and health caches forget only after commit.
// The Owner may see recent texts with the destination masked and never the body.
// This file does not send a text.
// This file does not mint a Lead.
// This file does not walk the six send gates.

// ── 1. Record or correct the confirmation-text policy ─────

export async function recordOrCorrectThisGranotNameConfirmationTextPolicy(command, actor)

function refuseUnlessTheActorIsOwner(actor)
function requireAnExplicitReason(reason)
function refuseAnEmptyOrOverlongTemplate(template)
function refuseUnknownPlaceholders(template)            // leftover unknownOutboundSmsPlaceholders
function refuseEnableUntilConsentIsRecorded(command)
async function loadTheCardInsideTheTransactionOrRefuseMissing(id, session)
function refuseWhenThisNameDoesNotCreateMissingLeads(card)
function refuseWhenThisNameIsOperationallyOff(card)
function decideWhetherTextingStaysOnAfterThisSave(command, previous)
function bumpTheTemplateVersionWhenTheMessageChanged(previous, template)
function restampConsentOnlyWhenANewAttestedBasisIsRecorded(command, previous, actor, now)
function stampWhyTextingIsOff(enabled, basisReverted, templateChanged)
async function writeTheSmsPolicyAndOneSmsPolicyChange(command, actor, session)

// ── 2. Show recent confirmation texts ─────────────────────

export async function showRecentConfirmationTextsForThisGranotName(input)

function maskTheDestinationAndNeverReturnTheBody(row)   // leftover maskContactLabel
function pickASentAtThatMayBeAcceptedOrCreated(row)

// ── stored-policy adapter (sibling cards + migrations) ────

export function showTheStoredConfirmationTextPolicy(sourceId, value)
```

Read the primary path out loud: *The Owner presents a Granot name and says whether a confirmation text may go out after that name creates a missing Lead. Refuse unless they are Owner and named a reason. Refuse an empty or over-320-character template. Refuse any placeholder except `{first_name}` and leftover `{company}`. Texting stays off until a consent basis is recorded. Load the card inside the transaction. A name that does not create missing Leads has nothing to text about. An inactive name cannot send texts. Saving a new message increments the template version and leaves texting off. Reverting consent to not attested leaves texting off. Write the sms policy and one `granot_crm_source_sms_policy` Registry Change in the same transaction. Forget policy, list, and health caches only after commit. Do not send the text. Do not mint a Lead. Do not walk the six send gates.*

That is the operation. `setGranotCrmSourceOutboundSms` is not.

## Precise logic I would tighten while renaming

These are real smells the story names make obvious. Do not "just rename."

1. **Audit `action` follows the request, not the landing.** `action` is `activate` when `command.enabled` is true, even if `templateChanged` or `basisReverted` force stored `enabled` false and stamp `template_changed` / `consent_basis_reverted`. A successful “turn it on and change the message” save can audit `activate` with `after.enabled === false`. Do not silently stamp `update` so “the action matches the landing” without a paired audit + Owner UI test. Do not silently add `deactivate` so “off looks like Source Feed archive.”

2. **Knowledge overstates the consent-off rule.** Knowledge says “template or consent-basis changes force the text off.” Code forces off on template change or revert to `not_attested` only. Moving `customer_submitted_form` → `existing_relationship` restamps attestation and leaves texting on if the Owner asked for on. Do not silently force off on every consent change so “knowledge wins” without a paired interface test.

3. **`daily_cap` is on the Owner command even though the rule says it is not.** Zod accepts 0–10_000. Wave B PATCH forwards it. The write stores `command.daily_cap ?? previous.daily_cap`. Send never consults it. Owner UI spec §4.2 / ORS-2 say do not expose it as a working safety control. Do not silently drop `daily_cap` from the command / view / Zod in this rename without a paired HTTP + migration inventory test. Do not silently start enforcing a per-source day limiter so “the field wins.”

4. **Sibling does not turn SMS off when leaving `create_if_missing`.** The mdc and Owner UI spec §4.2 say `createOrUpdateGranotCrmSource` must. `granotCrmSources.ts` never writes `outbound_sms`. A stored source can finish that sibling write with SMS still enabled under `link_only` or `observation_only`. This file then refuses a later enable, but it does not close the other path. Do not silently add that turn-off here so “one file owns the invariant.” Do not silently add it to sibling in this rename.

5. **A first custom template on a never-configured source looks like a change.** `toSmsView` defaults a missing / blank template to `DEFAULT_GRANOT_LEAD_CREATED_SMS_TEMPLATE`. `templateChanged` compares against that view. A first custom save increments version from 1 to 2 and leaves texting off even though nothing was stored. Do not silently treat “missing equals empty” so “first custom can enable” without a paired interface test.

6. **`sent_at` on recent rows can be a never-sent time.** The field falls back `sent_at` → `accepted_at` → `createdAt`. A queued or failed row can show a timestamp that is not a send. The test named “never returns a message body” only proves a bad ObjectId. Do not silently rename the field so “the label wins” without a paired GET recent test.

7. **HTTP PATCH returns this view; sibling policy PATCH re-reads projection.** Do not silently return a projected card from outbound-sms PATCH so “one DTO is enough” without checking Wave B. Do not silently hide `daily_cap` / `deactivation_reason` from the PATCH body so “the UI should not see leftovers.”

8. **`invalid()` uses `DEPENDENCY_CONFLICT` for empty template, short reason, and bad ObjectId.** A missing reason is not a dependency. Do not silently swap the code in this rename without a paired interface test.

9. **Leave sibling modules alone.** `withRegistryMutation`, `unknownOutboundSmsPlaceholders`, `maskContactLabel`, `toSmsView` callers on sibling cards, `sendGranotCreatedLeadConfirmation`, and `createOrUpdateGranotCrmSource` are already the right depth. This file orchestrates the Owner confirmation-text policy.

10. **Do not silently change persisted audit `action` or `deactivation_reason` strings.** `activate` / `update` and `template_changed` / `consent_basis_reverted` / `owner_disabled` are `OperationsRegistryChange` history. Story names live on the functions. Re-label those stored values only as a separate, tested change.

## Testing

The **interface** is the test surface: `recordOrCorrectThisGranotNameConfirmationTextPolicy`, `showRecentConfirmationTextsForThisGranotName`, `showTheStoredConfirmationTextPolicy`.

Today `crmSourceOutboundSms.test.ts` already proves default view (off, `not_attested`, default template, version 1, `daily_cap` 0), non-owner refuse, `not_attested` enable refuse, unknown `{job_no}` refuse, and recent-list bad ObjectId. Keep those. Add tests that name the operation:

**Record or correct**
- Owner enable on `create_if_missing` + recorded consent + operationally on → stored `enabled: true`, Registry Change `entityType: "granot_crm_source_sms_policy"`, `action: "activate"`, caches `granot_lifecycle_source_policy` / `granot_lifecycle_source_list` / `granot_lifecycle_source_health` forgotten **after** commit.
- Non-owner actor → `FORBIDDEN`. Missing / short / overlong reason → 400 with the 10-to-1000 message (already partly on disk — keep it).
- Enable while `lead_created_policy` is `link_only` or `observation_only` → 400 `DEPENDENCY_CONFLICT`, no write, no audit.
- Enable while the Granot name is operationally off → 400, no write.
- Same-save enable + new template → request succeeds, `template_version` increments, stored `enabled` is false, `deactivation_reason: "template_changed"`, audit `action` stays `activate` today. Keep that action until a paired change.
- Revert consent to `not_attested` → stored off, `consent_basis_reverted`, even if `command.enabled` was true.
- Move `customer_submitted_form` → `existing_relationship` with `enabled: true` and the same template → texting stays on; attestation restamps. Keep that until a paired change.
- Audit failure aborts the write and does **not** invalidate caches.
- `daily_cap` omitted copies the previous stored cap (or 0 from the default view). Keep that pass-through until a paired Zod + HTTP change.

**Show recent**
- Rows never include a body or raw `to`. Destination is masked.
- Limit defaults to 10 and caps at 50.
- `sent_at` may be `accepted_at` or `createdAt` today. Keep that fallback until a paired GET recent change.

**Stored view**
- Missing / blank policy → off, `not_attested`, default template, version 1, `daily_cap` 0 (already on disk — keep it).
- Sibling card list attaches this view. Do not retest sibling create/update here.

Do **not** add a test per helper (`refuseUnlessTheActorIsOwner`, `decideWhetherTextingStaysOnAfterThisSave`, `stampWhyTextingIsOff`). Those names exist so the parent reads. If a helper test has to change when the helper is inlined, it was testing past the **interface**.

`toSmsView` stays exported because sibling cards and migrations are a second real **adapter**, not a test leak. Do **not** retest leftover `evaluateGranotLeadSmsGates` tables or leftover `createOrUpdateGranotCrmSource` semantics here.

## What I would not do

- An `OutboundSmsService` class with `create` / `update` / `delete`.
- Thirty two-line functions that only wrap `withRegistryMutation` or `unknownOutboundSmsPlaceholders`.
- Moving this into a CRUD folder (`create.ts` / `update.ts` / `delete.ts` / `enable.ts` / `sms.ts`) for cleanliness.
- Breaking the mutation + Registry Change before-commit / cache-invalidate after-commit **seam**. A failed audit must not leave a policy and must not forget caches.
- Treating leftover send gates, leftover mint finalize, leftover sibling Granot name write, leftover default backfill `$set`, leftover Admin projection, leftover automation-source link, leftover Twilio, leftover public-form confirmation, or Wave B HTTP as this story.
- Inventing a **seam** that has only one **adapter**.
- Silently "fixing" a known gap while recommending a rename: do not stamp audit `action` from the computed `enabled` without a paired audit test; do not force off on every consent-basis change so knowledge wins; do not drop `daily_cap` without a paired HTTP + inventory test; do not start enforcing a day limiter; do not turn SMS off from this file when sibling leaves `create_if_missing`; do not treat a first custom template as “no change”; do not rename recent `sent_at` without a paired GET recent test; do not return a projected card from outbound-sms PATCH; do not swap `DEPENDENCY_CONFLICT` on a short reason without a paired test; do not move `sendGranotCreatedLeadConfirmation` into this file; do not rename persisted Change `action` / `deactivation_reason` strings.
- Jumping to the next service while this one has unchecked modules.
- Writing a whole-folder recommendation for `operationsRegistry`.
