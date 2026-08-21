# ODR-40 — The text we send when a Granot webhook creates a lead

> **Contract maturity: implementation-ready, with one open business decision named in §2.1.** The Owner turns on a confirmation text per lead source, writes it, and sees what was sent. It fires only for leads that Vantage itself created from a `lead_created` webhook, only for a source he set to *create the lead if we don't have it*, and only after he has recorded on what basis Vantage is allowed to text that person. Two model changes, two report-first migrations, one new flag defaulting off.

## 1. Authority and required reading

- **Pack specification:** [`operations-registry-owner-specification.md`](../operations-registry-owner-specification.md) — §2, §4, §5, §6, §11.
- **Predecessors:** [`ODR-38.md`](./ODR-38.md) (the detail page this card mounts on, `registry-copy.ts`) and [`ODR-39.md`](./ODR-39.md) (`create_if_missing` must be authorable before this can gate on it).
- **Code you are extending:**
  - `src/services/leadMessaging/leadMessaging.service.ts` — the whole file. `persistLeadMessageIntent` (`:78`), `dispatchOrQueuePersistedLeadMessage` (`:180`), `reserveLeadMessagingCapacity` (`:794`), `classifyLeadMessagingFailure` (`:876`).
  - `src/services/granotLifecycle/createLeadFromGranot.ts:167–192` — the command envelope and its `finalize` hook.
  - `src/services/domainCommands/idempotency.ts:186` — `finalize` runs only when the command was **not** replayed.
  - `src/services/leads/formLead.service.ts:216, :296` — the only existing caller, and the shape to mirror.

## 2. Objective

Deliver the **"Text the customer"** card on a lead source, and the send path
behind it, so the Owner can turn on a confirmation text for a source like Best
Relocation whose Granot name is set to *create the lead if we don't have it*.

At the end of this issue: a `lead_created` webhook for `"Best Relocation"`
creates a lead, and the customer receives one text — once, never twice, never
during quiet hours, and never at all unless the Owner recorded why Vantage is
allowed to send it.

### 2.1 The concern, stated once, before the design

The existing SMS path texts a person who **submitted a form to Vantage** and
ticked `sms_consent` (`leadMessaging.service.ts:92`). This issue texts a person
whose phone number arrived over a CRM webhook, who may never have contacted
Vantage directly, and for whom no consent field exists anywhere in the payload.
Under US TCPA and 10DLC rules those are materially different positions, and the
difference is not something engineering can resolve by writing better code.

**This is a business decision the Owner and his counsel own, not a blocker on
this issue.** The design therefore does three things and stops:

1. it never infers consent — the absence of a consent record is a hard block;
2. it requires the Owner to select an explicit **consent basis** and records who
   attested it, when, and against which lead source, in the registry audit;
3. it puts the basis on screen every time he edits the message, so the
   attestation is a live statement rather than a one-time click.

If the answer for a given lead source is "we don't have a basis", the card is
turned off for that source and everything else in the pack still works. Build it
as specified.

## 3. Repository, branch, and prerequisites

- **Repositories/branches:** `vantage-main-server` and `vantage-admin`, both on `operations-registry-owner`.
- **Prerequisites:** ODR-38 and ODR-39 merged. This issue gates on a state only ODR-39 makes authorable.
- Ordinary checks use redacted synthetic data. Runtime checks require `TEST_MODE=true`, an explicit test database, and — for any live dispatch — a destination number the team controls.
- No commit, push, deploy, production flag change, production index apply, live payload read, or **external send to any number the team does not own**.

## 4. Current-state evidence to verify

Observed 2026-08-21; **reverify at implementation**.

- **Nothing on the Granot path sends SMS.** `persistLeadMessageIntent` and `dispatchOrQueuePersistedLeadMessage` are imported by exactly one module, `src/services/leads/formLead.service.ts`. `createLeadFromGranot` imports neither.
- **`LeadMessage.form_lead` is required and refs `FormLead`** (`LeadMessage.ts:99–104`), and is indexed (`:148`). A `CallLead` created from a Granot webhook cannot be attached to a message today.
- **`LEAD_MESSAGE_PURPOSES` has exactly one value**, `"quote_request_confirmation"` (`config/domain/leadMessaging.ts:21`), and the model enums on it (`:107`).
- **The body is built from `CreateFormLeadInput`** (`messageBuilder.ts:6`), a validation type a Granot observation does not produce.
- **Consent is a hard gate today** (`leadMessaging.service.ts:92`): `input.formInput.sms_consent !== true` returns `null` before anything is persisted.
- **The guardrails already exist and are good.** `reserveLeadMessagingCapacity` enforces destination shape, an allowed-country prefix list, an hourly cap, and a per-destination cooldown, all atomically through `LeadMessageRateLimit`. `resolveLeadSmsQuietHoursDeferral` defers into a Twilio `sendAt` window with an asserted 15-minute-to-35-day lead time. `classifyLeadMessagingFailure` already distinguishes definitely-unsent from ambiguous. **Reuse all of it. Do not write a second sender.**
- **`finalize` runs at most once and may not run at all.** `idempotency.ts:186` skips it when `outcome.replayed` is true, and it executes after the transaction commits with no retry. A crash between commit and finalize means a created lead and no text, permanently.
- **`createLeadFromGranot` already has the seam.** `executeCreation` returns a pending payload consumed by `finalize` (`createLeadFromGranot.ts:180–186`), which today does the sheet-sync flush and the missing-CPL record.
- The observation carries `contact.phone_raw`, `contact.normalized_phone`, `contact.first_name`, and `contact.display_name` (`:552–581`), which is everything the message needs.
- **The existing public-form template carries no opt-out language** (`messageBuilder.ts:13`). Note it in the handoff as a finding; **do not change it in this issue** — that template governs live traffic and is out of scope.

## 5. Locked decisions and invariants at risk

- **Six gates, all must pass, evaluated in one place and reported as one reason.** Modelled on `evaluateEffectGates` (`sourcePolicy.ts:389`) — named gates, a single first-blocking-reason, no scattered early returns. In order: global messaging mode is not `disabled`; `GRANOT_LEAD_CREATED_SMS_ENABLED` is true; the resolved Granot source's `lead_created_policy` is `create_if_missing`; the lead source's `outbound_sms.enabled` is true; `consent_basis !== "not_attested"`; the destination and capacity guard pass.
- **The policy gate is `create_if_missing` and nothing else.** A `link_only` source matched a lead Vantage already had — that customer has already been contacted through whatever brought them in. Texting on a match is a different product decision and is not authorized here.
- **Persist the intent, then dispatch. Never the reverse.** That is the existing shape (`formLead.service.ts:216` then `:296`) and it is what makes the unique index an effective double-send guard.
- **One message per observation per purpose, enforced by a unique partial index**, not by application logic. A redelivered webhook, a concurrent drain, and a retried finalize must all collide on the index. This is the highest-consequence invariant in the issue: the failure mode is a real customer receiving the same text twice.
- **At-most-once, and that is deliberate.** Because `finalize` is skipped on replay and has no retry, a crash in the window loses the text. **Do not add a retry sweep that scans for created-leads-without-messages and sends them.** A lead created three days ago whose customer suddenly receives a "we just got your request" text is worse than silence. Ship a **report** instead (§6.7) and let the Owner decide per case.
- **The Owner writes the message; the server owns the envelope.** He edits body text with an allowlisted placeholder set. The server appends the opt-out sentence, enforces the length, and renders the placeholders. He cannot remove the opt-out and he cannot introduce a placeholder that could interpolate an unintended field.
- **Quiet hours default on and the Owner cannot switch them off from this card.** `isLeadMessagingQuietHoursEnabled()` remains environment-controlled. The card states the behaviour; it does not offer it as a toggle.
- **Nothing about the lifecycle decision changes.** No gate in `evaluateEffectGates`, no route selection, no identity resolution, and no `SynchronizationDecision` field. A failed text must never fail, delay, or alter lead creation — `finalize` already runs after commit, and every path in the new code catches and records rather than throwing.
- **`form_lead` stays required until phase 2.** The migration is two runs with a verification between them, because relaxing a required field and backfilling in one step leaves no safe rollback.

## 6. Deliverables and exact contract

### 6.1 Model — `LeadSourceCompany.outbound_sms`

New optional subdocument. No existing field changes.

```ts
outbound_sms: {
  enabled:            { type: Boolean, required: true, default: false },
  trigger:            { type: String, required: true, enum: ["granot_lead_created"], default: "granot_lead_created" },
  body_template:      { type: String, trim: true, maxlength: 320 },
  template_version:   { type: Number, required: true, default: 1 },
  consent_basis:      { type: String, required: true, enum: OUTBOUND_SMS_CONSENT_BASES, default: "not_attested" },
  consent_attested_by:   { actor_type, actor_id, actor_label, actor_role },
  consent_attested_at:   { type: Date },
  daily_cap:          { type: Number, required: true, default: 0, min: 0 },   // 0 = global limits only
  activated_at:       { type: Date },
  deactivated_at:     { type: Date },
  deactivation_reason:{ type: String, trim: true },
}
```

```ts
export const OUTBOUND_SMS_CONSENT_BASES = [
  "not_attested",              // default; a hard block
  "customer_submitted_form",   // the person filled out a form that reached this source
  "existing_relationship",     // an active enquiry or prior business relationship
] as const;
```

- `template_version` increments whenever `body_template` changes, so a `LeadMessage` can be traced to the exact wording that produced it.
- `consent_basis` reverting to `not_attested` — or `body_template` changing — forces `enabled: false` in the same command. Re-enabling is a deliberate act with a fresh attestation. This is enforced server-side, not by the form.

### 6.2 Model — `LeadMessage`

```ts
lead_ref: {
  model: { type: String, enum: ["FormLead", "CallLead"] },
  id:    { type: Schema.Types.ObjectId },
},
origin:               { type: String, enum: ["public_form", "granot_lead_created"], required: true, default: "public_form" },
lead_source_company:  { type: Schema.Types.ObjectId, ref: "LeadSourceCompany" },
granot_crm_source:    { type: Schema.Types.ObjectId, ref: "GranotCrmSource" },
observation_id:       { type: Schema.Types.ObjectId, ref: "GranotObservation" },
consent_basis:        { type: String, enum: OUTBOUND_SMS_CONSENT_BASES },
source_template_version: { type: Number },
```

- `form_lead` stays required in **phase 1** and is dual-written for `FormLead` messages. It becomes optional in **phase 2** (§6.6).
- `consent_basis` and `source_template_version` are snapshotted onto the message. When someone asks in eight months on what basis a specific text was sent, the answer must be on the message, not inferred from a policy that has since changed.
- `LEAD_MESSAGE_PURPOSES` gains `"granot_lead_created_confirmation"`.
- `REGISTRY_CHANGE_ENTITY_TYPES` gains `"lead_source_sms_policy"`.

New indexes:

```text
{ observation_id: 1, purpose: 1 }  unique, partial: { observation_id: { $exists: true } }
{ "lead_ref.model": 1, "lead_ref.id": 1, createdAt: -1 }
{ lead_source_company: 1, createdAt: -1 }
```

### 6.3 `src/services/leadMessaging/granotCreatedLead.ts`

```ts
export type GranotSmsGate =
  | "messaging_mode_enabled"
  | "granot_sms_flag"
  | "source_policy_create_if_missing"
  | "lead_source_sms_enabled"
  | "consent_basis_recorded"
  | "destination_and_capacity";

export type GranotSmsEvaluation = {
  evaluated_gates: Array<{ gate: GranotSmsGate; allowed: boolean }>;
  allowed: boolean;
  blocked_reason: GranotSmsGate | null;
};

export function evaluateGranotLeadSmsGates(facts: {
  messaging_mode: LeadMessagingMode;
  granot_sms_flag: boolean;
  lead_created_policy: GranotLeadCreatedPolicy;
  outbound_sms_enabled: boolean;
  consent_basis: OutboundSmsConsentBasis;
  destination: string | null;
}): GranotSmsEvaluation;

export function renderGranotLeadSmsBody(input: {
  template: string;
  first_name?: string;
  lead_source_name: string;
}): string;

export async function sendGranotCreatedLeadConfirmation(input: {
  lead_ref: { model: "FormLead" | "CallLead"; id: string };
  observation_id: string;
  lead_source_company_id: string;
  granot_crm_source_id: string;
  destination_phone?: string;
  first_name?: string;
}): Promise<{ message_id: string | null; status: string }>;
```

Implementation constraints:

- **`evaluateGranotLeadSmsGates` is pure and takes loaded facts.** It performs no queries, so every combination is table-testable. The one thing it must never do is short-circuit before evaluating every gate — the full `evaluated_gates` array is what the Owner-facing "why did nothing send" line reads from.
- `renderGranotLeadSmsBody` accepts exactly two placeholders, `{first_name}` and `{company}`. Unknown placeholders are left literal and reported by the validator at save time, never at send time. A missing `first_name` renders `there`, matching the existing builder (`messageBuilder.ts:9–12`). The server then appends a single space and the fixed literal `Reply STOP to opt out.` — from a named constant, not inline.
- `sendGranotCreatedLeadConfirmation` **catches everything**. It returns a status; it never throws into `finalize`. A thrown error here would surface as a failed post-commit on a command whose lead is already committed.
- It calls `reserveLeadMessagingCapacity` through `persistLeadMessageIntent`'s existing dependency seam — the reservation is the same one the form path uses, so the hourly cap and per-destination cooldown are shared and not doubled.
- On a duplicate-key error against the `{observation_id, purpose}` index, it returns `{ status: "already_sent" }` and records an `info` event. That path is a success, not a failure.

**`persistLeadMessageIntent` gains a second, additive input shape.** Do not fork
it: today it takes `{ formLeadId, formInput, duplicate, testMode }` and builds
the body itself. Widen it to accept either the existing form input **or** a
pre-rendered `{ lead_ref, body, purpose, message_key, template_version, origin,
consent_basis, observation_id, lead_source_company, granot_crm_source }`, keeping
one persistence path, one rate-limit reservation, and one place where a
`LeadMessage` comes into existence.

### 6.4 Wiring into `createLeadFromGranot`

`executeCreation` returns an additional optional field on its pending payload:

```ts
sms?: {
  lead_ref: { model: "FormLead" | "CallLead"; id: string };
  observation_id: string;
  lead_source_company_id: string;
  granot_crm_source_id: string;
  destination_phone?: string;
  first_name?: string;
};
```

populated from `snapshot.granot_crm_source_id`, `company._id`, the created lead,
and `observation.contact`. `finalize` calls
`sendGranotCreatedLeadConfirmation(pending.sms)` **after** `finalizeSheetSync`
and `recordMissingLeadCplRate`, wrapped so a rejection is logged and swallowed.

**Nothing inside the transaction changes.** No new query, no new gate, no change
to `evaluateEffectGates`, no change to the decision, its effects, or the checksum
(`createLeadFromGranotPayloadChecksum`). A reviewer must be able to diff
`executeCreation` and see only the pending-payload addition.

### 6.5 Registry command and routes

`src/services/operationsRegistry/leadSourceSmsPolicy.ts`:

```ts
export type OutboundSmsCommand = {
  lead_source_company_id: string;
  enabled: boolean;
  body_template: string;
  consent_basis: OutboundSmsConsentBasis;
  daily_cap?: number;
  reason: string;             // required, 10..1000
};

export async function setLeadSourceOutboundSms(
  command: OutboundSmsCommand,
  actor: RegistryActorContext,
): Promise<OwnerOutboundSmsView>;
```

- Goes through `withRegistryMutation` with `entityType: "lead_source_sms_policy"`, `entityId` = the company id, and `invalidateKeys: ["source_companies"]`.
- `assertOwner`, as every registry command does.
- Rejects `enabled: true` with `consent_basis: "not_attested"`; rejects an empty or placeholder-invalid template; rejects `enabled: true` when the company is not active; rejects `enabled: true` when **no** Granot source pointing at this company has `lead_created_policy: "create_if_missing"` — with a remediation pointing at the Granot names tab.
- Stamps `consent_attested_by` and `consent_attested_at` from the actor whenever `consent_basis` changes to a non-`not_attested` value. The Admin never supplies them.
- Bumps `template_version` when `body_template` changes.
- **The audit `before`/`after` carry the full policy projection including the template text and the consent basis.** That audit row is the record of the attestation.

```text
PATCH /api/v1/admin/source-companies/:id/outbound-sms
GET   /api/v1/admin/source-companies/:id/outbound-sms/recent   ?limit (default 10, max 50)
```

`/recent` returns the last N messages for the company: `sent_at`, `status`,
`provider_status`, a **masked** destination via the existing `maskContactLabel`,
the purpose, and the template version. **No message body, no unmasked phone.**

### 6.6 Migrations

`scripts/migrations/lead-message-lead-ref.ts` — three modes:

- `--report` (default): counts `lead_messages`; counts those missing `lead_ref`; counts those whose `form_lead` resolves to no `FormLead`; prints the index list.
- `--backfill`: sets `lead_ref = { model: "FormLead", id: form_lead }` and `origin: "public_form"` where `lead_ref` is absent, in bounded batches, idempotently. Re-running is a no-op.
- `--verify`: asserts every document has `lead_ref`, that `lead_ref.id` equals `form_lead` on every document that has both, and that the counts match the report.

**Phase 2 — relaxing `form_lead` to optional — is a separate authorized change**
after `--verify` runs clean, and it is not in this issue's diff.

`scripts/migrations/lead-message-granot-indexes.ts` — report-first, then an
explicit authorized `--apply`, creating the three indexes in §6.2. **The unique
partial index must be created before the send path ships**, and the report must
prove no existing document would violate it.

### 6.7 The dropped-text report

`scripts/reports/granot-lead-sms-gap.ts` — read-only. Lists leads created by
`createLeadFromGranot` in a window whose lead source had `outbound_sms.enabled`
and for which no `LeadMessage` with `observation_id` exists. This is the visible
consequence of the at-most-once decision in §5. It reports; it never sends.

### 6.8 Admin — the "Text the customer" card

Mounts on `lead-source-detail.tsx` from ODR-38.

**Blocked state** — no Granot name for this lead source is set to create leads:

```text
Text the customer

  This lead source doesn't create leads from Granot yet, so there's nothing
  to text about. Set one of its Granot names to "match it, and create the
  lead if we don't have it" first.

  [ Go to Granot names → ]
```

**Setup state:**

```text
Text the customer                                                    Off

  When Granot sends us a lead under this source and Vantage creates it,
  we can text the customer once, right away.

  Why are we allowed to text these people?
    ( ) They filled out a form that reached this lead source
    ( ) We have an active enquiry or existing business with them
    (•) Not recorded yet — texting stays off

  What should it say?
    [ Hi {first_name}, this is Vantage Movers. We got your request       ]
    [ and we'll call you shortly to go over your move.                   ]

    You can use {first_name} and {company}.

    Preview                                                    142 / 320
    ┌───────────────────────────────────────────────────────────────┐
    │ Hi Maria, this is Vantage Movers. We got your request and     │
    │ we'll call you shortly to go over your move.                  │
    │ Reply STOP to opt out.                                        │
    └───────────────────────────────────────────────────────────────┘
    The last line is always added and can't be removed.

  We never text between 9pm and 8am Eastern. Anything that would land in
  that window is held until morning.

  Why are you turning this on?
    [                                                                  ]

  [ Turn it on ]
```

**On state** adds:

```text
                                                                      On
  Recent texts
    6:04 AM   (954) •••-0142   Delivered
    5:47 AM   (786) •••-8891   Delivered
    5:12 AM   (305) •••-4420   Failed — the number can't receive texts
```

- The preview renders through the **same** `renderGranotLeadSmsBody` the server uses, exported and shared. Two renderers that disagree means he approves one message and the customer receives another.
- The character count includes the appended opt-out sentence and warns above 160 that it will be billed as multiple segments.
- Changing the consent basis to "Not recorded yet", or editing the template, disables the card and requires an explicit re-enable — the UI mirrors the server rule rather than assuming it.
- The failure line translates `last_error_code` through a small map; anything unmapped renders *"Not delivered"* plus the code behind `<details>`.

## 7. Explicitly out of scope

- Any change to the public form intake path, its consent gate, or its template — including adding an opt-out sentence to it. **Reported as a finding, not fixed here.**
- Inbound SMS, `STOP`/`HELP` keyword handling, and any opt-out suppression list. **Named as a real gap in §14 for a follow-up issue** — the opt-out sentence this issue adds is only as good as the handling behind it, and Twilio's default keyword handling is the current answer.
- Email on lead creation. `GRANOT_LIFECYCLE_EMAIL_ENABLED` stays off.
- More than one template, more than one trigger, scheduling, drips, or A/B variants.
- Texting on `link_only`, on a booking, on a cancellation, or on a priority change.
- A retry sweep for dropped texts (§5).
- Phase 2 of the `form_lead` migration.
- Per-agent or per-feed templates. The policy is per lead source.

## 8. Flags and runtime posture

**One new flag: `GRANOT_LEAD_CREATED_SMS_ENABLED`, default `false`**, parsed by
the existing explicit-boolean parser so a malformed value throws rather than
defaulting on.

With it false — the shipped posture — the card is fully usable, the policy saves,
the audit records the attestation, and `evaluateGranotLeadSmsGates` returns
`blocked_reason: "granot_sms_flag"` with no message persisted and no provider
call. That is a test.

`LEAD_MESSAGING_MODE`, the hourly cap, the destination cooldown, the country
prefix list, and quiet hours are read from their existing configuration and are
not duplicated, overridden, or made per-source. `daily_cap` is an **additional**
ceiling, never a way to exceed a global one.

## 9. Migration and indexes

Three indexes, in `scripts/migrations/lead-message-granot-indexes.ts`,
report-first (§6.2, §6.6). The unique partial index on
`{ observation_id, purpose }` is a **precondition** of the send path, not a
follow-up.

The `lead_ref` backfill is phase 1 only.

`explain()` the `/recent` query and the gap report's aggregation, and record both
plans.

## 10. Acceptance criteria

- [ ] A `lead_created` webhook for a `create_if_missing` source with the flag on, messaging enabled, and a recorded consent basis produces **exactly one** `LeadMessage` with `purpose: "granot_lead_created_confirmation"`, `origin: "granot_lead_created"`, a populated `lead_ref`, `observation_id`, `consent_basis`, and `source_template_version`.
- [ ] **Redelivering the same webhook produces no second message.** Asserted at both layers independently: the command replays and skips `finalize`, **and** a forced direct second call to `sendGranotCreatedLeadConfirmation` collides on the unique index and returns `already_sent`. Message count stays 1 in both.
- [ ] With `GRANOT_LEAD_CREATED_SMS_ENABLED` false, no message is persisted, no provider call is made, and the blocked reason is `granot_sms_flag`.
- [ ] With the source's policy `link_only`, the blocked reason is `source_policy_create_if_missing`. **A `link_only` source never texts**, under any combination of the other five gates.
- [ ] With `consent_basis: "not_attested"`, the blocked reason is `consent_basis_recorded` and no message exists — including when `enabled` is somehow true in the database. The gate does not trust the stored `enabled` flag alone.
- [ ] `setLeadSourceOutboundSms` rejects `enabled: true` with `not_attested`; rejects it when no Granot source for the company is `create_if_missing`, with remediation; rejects an inactive company; and forces `enabled: false` when the basis reverts or the template changes.
- [ ] The audit row for an attestation carries the template text, the consent basis, `consent_attested_by`, and `consent_attested_at` in `after`, and the previous values in `before`.
- [ ] The server-appended opt-out sentence is present on every rendered body and cannot be removed, duplicated, or displaced by template content that already contains it.
- [ ] The Admin preview and the server render byte-identical output for a fixture set including a missing `first_name`, an unknown placeholder, a 320-character template, and a template that already contains the opt-out sentence.
- [ ] A message that would land in quiet hours is deferred through the existing `sendAt` path, and the 15-minute lead-time assertion still holds.
- [ ] A created `CallLead` can carry a message. A test creates one, attaches a message via `lead_ref`, and reads it back — proving the `form_lead` limitation is gone in practice while `form_lead` is still required for form messages.
- [ ] The `lead_ref` backfill is idempotent: `--backfill` twice, then `--verify`, all clean, with counts unchanged after the second run.
- [ ] **A failing text never affects the lead.** With the provider forced to throw, the lead, the record link, the entity changes, the decision, and the sheet-sync job are all committed and unchanged, and `createLeadFromGranot` returns `applied`.
- [ ] Nothing inside `executeCreation`'s transaction changed. `grep`/diff confirms the only edit is the pending-payload addition, and `createLeadFromGranotPayloadChecksum` produces identical output for a fixture observation before and after this issue.
- [ ] `/recent` returns masked destinations and **no message body**. Asserted against a fixture whose body contains a phone number.
- [ ] The gap report lists a synthetic created-lead-without-message and sends nothing. Asserted by message count before and after.
- [ ] **No banned word reaches the DOM**, per the pack spec §10, including `consent_basis`, `template_version`, and `observation`.
- [ ] A non-Owner admin session is refused by the server on both new endpoints and gets read-only rendering, proven independently at both gates.

## 11. Required tests and commands

```bash
pnpm test
pnpm typecheck
cd ../vantage-admin && pnpm test && pnpm typecheck && pnpm build
```

Focused tests:

- `src/services/leadMessaging/granotCreatedLead.test.ts` — the full 2⁶ gate table, or at minimum every gate as sole blocker plus the all-pass case; `evaluated_gates` always complete; the renderer fixture set; the opt-out invariant; the duplicate-key `already_sent` path; the never-throws property under an injected failure at each internal step.
- `src/services/leadMessaging/leadMessaging.service.test.ts` — extended: the widened `persistLeadMessageIntent` shape shares one rate-limit reservation with the form path and does not double-reserve.
- `src/services/granotLifecycle/createLeadFromGranot.replica.test.ts` — extended: one message on first execution, none on replay, lead unaffected by a throwing provider, checksum parity.
- `src/services/operationsRegistry/leadSourceSmsPolicy.test.ts` — every rejection; the forced-disable rules; version bumping; the audit projection contents.
- `src/routes/v1.routes.test.ts` — extended: Owner-only on both routes, `/recent` masking and body absence, unknown-key rejection.
- `scripts/migrations/lead-message-lead-ref.test.ts` — report/backfill/verify, idempotency, and a fixture with an orphaned `form_lead`.
- Admin: preview/server render parity against the shared fixture set; the blocked state; the forced-disable behaviours; the segment warning at 160; the banned-word render test.

Zero-mutation proof for `/recent` and the gap report.

## 12. Live/staging verification

Preview deploy of both repositories against `TEST_MODE` with the test database
and `GRANOT_LEAD_CREATED_SMS_ENABLED=true`.

Set up a synthetic lead source whose Granot name is `create_if_missing`, record a
consent basis, write a template, and turn the card on. Post a synthetic
`lead_created` webhook whose contact phone is **a number the team owns**. Confirm:
one text arrives; the card's recent list shows it with a masked destination and a
delivery status; posting the identical webhook again produces no second text and
no second row.

Then set the Granot name to `link_only`, post again, and confirm nothing is sent
and the card explains why.

**No production deploy, no production index apply, no live payload read, and no
send to any number the team does not own.**

## 13. Rollback

Set `GRANOT_LEAD_CREATED_SMS_ENABLED=false`. That stops every send in one
environment change while leaving the card, the policy, and the audit intact —
which is the whole reason the flag exists and is the first step in every case.

Then, if needed: revert the Admin commit; revert the `finalize` wiring in
`createLeadFromGranot`, which is a single call site. The `LeadMessage` fields and
`LeadSourceCompany.outbound_sms` are additive and optional, so leave them — no
document becomes invalid. The three indexes are additive and may stay; the unique
one is harmless with no `observation_id` documents being written. `form_lead` was
never relaxed, so no validation breaks.

## 14. Required completion handoff

Report: files added and changed; test and typecheck output for both repositories;
preview deployment ids; the migration report/backfill/verify output verbatim; the
index creation report including the pre-apply violation check; the two
`explain()` plans; the gate table test output; the render-parity fixture results;
the redelivery test proving one message at both layers; diff evidence that
`executeCreation`'s transaction body is otherwise unchanged and that the checksum
is unaffected; and the banned-word render test result.

**Findings to carry forward, explicitly, as their own issues:**

1. The public form template (`messageBuilder.ts:13`) carries no opt-out sentence while this issue's template always will. That inconsistency is now visible and should be resolved deliberately.
2. There is no `STOP`/`HELP` handling or suppression list in this repository. The opt-out sentence this issue adds is only as strong as what handles the reply.
3. `form_lead` phase 2 — relaxing it to optional — remains unrun.
</content>
