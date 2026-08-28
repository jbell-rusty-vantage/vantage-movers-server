# Map The Already-Saved Form Lead Onto The Granot Wire, Encode It For The Gateway, Then Mask It For Logs — Job Number Must Not Become leadno — operational story

- Status: recommended
- Service: `crm` (Wave A, visited after this pass)
- Pass: 2 of this service — `formLeadPayload.ts`
- Remaining in this service: none (`crm.service.ts` recommended; `crmConfig.ts` / `types.ts` / `index.ts` already skipped)
- Target: `src/services/crm/formLeadPayload.ts`
- Knowledge: none as a dedicated Service file. CRM Posting owner invariants live on [`docs/knowledge/services/form-lead.md`](../../../docs/knowledge/services/form-lead.md) (payload `label` is Operations Registry `crm_label_snapshot`; payload `leadno` is persisted **Tracking Reference** / `FormLead.ref_no`, which Granot exposes as the **Granot Form Reference** in `ref_no`; `notes` may carry `lid`; additive Job Number must not replace `leadno`; a stored-absent move date emits empty `movedte` instead of inventing today). Software / wire notes: [`.cursor/rules/form-lead-granot-crm.mdc`](../../../.cursor/rules/form-lead-granot-crm.mdc) — this file plus `crm/types.ts` own wire names; `crm.service.ts` encodes/sends. Distinct from Form Lead Ingestion decide-and-finalize (skip vs post, Sheet Sync before the post, fake skip result that still calls this map): [recommendations/form-lead.md](form-lead.md). Distinct from post-the-already-saved-Form-Lead (announce / send / never-throw outcome): [recommendations/crm-crm-service.md](crm-crm-service.md). Distinct from credentialed Hello Moving URL + log redact: sibling `crmConfig.ts` (skipped this open). Distinct from stored `first_name` / `last_name` compose: [recommendations/leads-lead-name.md](leads-lead-name.md) — this file later peels `lead.name` and ignores those parts. Distinct from trusted Granot create (never CRM-posts; may persist with no `move_date`): [recommendations/granot-lifecycle-create-lead-from-granot.md](granot-lifecycle-create-lead-from-granot.md). Distinct from webhook capture / drain: [recommendations/granot-lifecycle-capture.md](granot-lifecycle-capture.md) / [recommendations/granot-lifecycle-drainer.md](granot-lifecycle-drainer.md). Distinct from leftover CSV store / apply: [recommendations/granot-crm-csv-upload.md](granot-crm-csv-upload.md) / [recommendations/granot-crm-csv-sync.md](granot-crm-csv-sync.md). Distinct from HTTP automation apply: [recommendations/granot-lifecycle-automation-apply.md](granot-lifecycle-automation-apply.md). Distinct from root compatibility barrel `src/services/crm.service.ts` (Wave A leftover-root, later). This checkout’s `CONTEXT.md` mentions “Granot CRM posting” in the one-line intro and does not define CRM Posting / Tracking Reference / Granot Form Reference — do not invent a glossary copy. `docs/adr/` is absent here — knowledge still links ADR-0002 for “CRM Posting survives downstream failures”; do not invent an ADR copy, and do not silently reorder Sheet Sync vs the post so that link “wins.”
- Callers: **two runtime import sites plus two barrels and one folder test.** After-commit post: `crm/crm.service.ts` calls `buildCrmFormLeadPayload`, `encodeCrmFormBody`, and `summarizeCrmPayloadForLog`. After-commit skip: `leads/formLead.service.ts` `finalizeFormLeadCreateAfterCommit` builds a fake `CrmSubmitResult` whose `payload` is `buildCrmFormLeadPayload(lead, crmLabel)` and does **not** encode or post. Barrel: `crm/index.ts` re-exports all five names. Root facade: `src/services/crm.service.ts` re-exports `buildCrmFormLeadPayload`, `formatCrmMoveDate`, `splitNameForCrm` — not `encodeCrmFormBody`, not `summarizeCrmPayloadForLog`. Test: `formLeadPayload.test.ts` (name peel, UTC `M/D/YYYY`, blank label default, Tracking Reference as `leadno`, Job Number must not replace `leadno`, `lid` in `notes` only, `"not provided"` → empty `leadno`, wire field map, absent date → empty `movedte`, log mask / fingerprint). Comment-only: `src/logger.ts` names `summarizeCrmPayloadForLog`. Not callers: `updateFormLead` / Form correction, `createLeadFromGranot`, webhook capture, CSV upload/sync, HTTP automation apply, `crmConfig.ts` / `types.ts` (this file imports them). `fingerprintForLog` is private.
- Seams callers need: same wire map for post vs skip (one function, two adapters); caller `companyLabel` (`crm_label_snapshot`) vs default `CRM_FORM_LEAD_LABEL`; `leadno` is Tracking Reference, never Job Number, never `lid`; `notes` may carry `lid` and is never a matching key; empty `movedte` when the stored date is absent; name peel is this adapter, not `leadName.service.ts`; encode is for the poster only; mask is for logs only, not the wire; this file vs trusted Granot create (never posts)
- Split later (only if the file outgrows one sitting): keep one file — this ~136-line module is one screenplay for “map the already-saved Form Lead onto the Granot wire, encode it for the gateway, then mask it for logs.” If it later splits: `mapTheSavedFormLeadOntoTheGranotWire.ts` / `encodeTheGranotFormLeadAsUrlencoded.ts` / `maskTheGranotPayloadForOperatorLogs.ts` — story files, never `create.ts` / `build.ts` / `encode.ts` / `update.ts` / `delete.ts`, and never merge the post, skip decide, endpoint config, or Form Lead write into this file

`buildCrmFormLeadPayload` / `encodeCrmFormBody` / `summarizeCrmPayloadForLog` are executor mechanics. The owner question is: *The Form Lead is already in Mongo. Form Lead Ingestion already decided post or skip. Turn that saved lead into the exact Granot Hello Moving body: company `label`, first and last name Granot will accept, origin and destination zip, email, phone, move size, unpadded UTC `M/D/YYYY` move date or blank, `lid` in `notes` only, Tracking Reference as `leadno`. A `"not provided"` Tracking Reference becomes empty `leadno`. Job Number must not become `leadno`. Encode that body as `application/x-www-form-urlencoded` for the poster. Fingerprint identifiers and mask customer PII so operators can see what we sent without writing raw values into Vercel logs. This file does not fetch. This file does not decide skip. This file does not write a Lead.*

The post, skip decide, credentialed URL, Form Lead write, trusted Granot create, and webhook capture already live in other **modules**. Do not pull those in.

## What this file actually does

Three beats of one “prepare the Granot Form Lead body” story, not “a CRM CRUD builder,” and not the post / skip decide:

1. **Map the already-saved Form Lead onto the Granot wire** — peel `lead.name` into Granot `firstname` / `lastname` (blank → both empty; one token → copy to both because Granot rejects a blank last name; three or more tokens → first and last only, middles dropped). Default a blank caller `companyLabel` to `CRM_FORM_LEAD_LABEL`. Send pickup / destination zip as `ozip` / `dzip`. Send email (or `""`) and `phone_number` as `phone1`. Send `move_size` (or `""`). Send `movedte` as unpadded UTC `M/D/YYYY` when a date is stored; send `""` when it is not — do not invent today. Put trimmed `lid` in `notes`. Put trimmed Tracking Reference in `leadno`, except the sentinel `"not provided"` (case-insensitive after trim) becomes `""`. This beat does not read `job_no` / `normalized_job_no`. This beat does not read stored `first_name` / `last_name`. This beat does not fetch.

2. **Encode the Granot Form Lead as urlencoded** — walk the payload object into `URLSearchParams` and return `application/x-www-form-urlencoded` text for the Hello Moving POST. This beat does not remap fields. This beat does not swap `leadno` for Job Number or `lid`. This beat is the poster **seam**; skip does not encode.

3. **Mask the Granot payload for operator logs** — keep `label`, `movesize`, and `movedte` as typed. First-letter-mask first and last name. Mask email and phone with the shared Form Lead sanitizers. Fingerprint origin zip, destination zip, `notes` (`lid`), and `leadno` as `sha256:` plus twelve hex characters. Blank fields stay blank. This beat does not change the wire body the poster sends or the skip result stores.

There is no fourth mutate operation. Name peel and UTC date fold are child decisions of the map. `fingerprintForLog` is private.

## Organization

Keep one file as the screenplay for “map the already-saved Form Lead onto the Granot wire, encode it for the gateway, then mask it for logs.” The post, skip decide, credential redact, Form Lead Ingestion, name compose, and trusted Granot create already live in deeper **modules**. Do not pull those in. Do not invent a `CrmPayloadService` class. Do not invent a canonical-command `begin` / `complete` **seam** here — this is a wire map for an after-commit side effect, not a Domain Command. Do not invent a second payload **adapter** beside this file (skip and post already share `buildCrmFormLeadPayload`). Do not invent a call-lead payload **adapter** that this folder would never send. Do not invent a second name-split **adapter** beside `leadName.service.ts` (name the peel mismatch; do not silently merge).

Do not move this into `crm.service.ts` so “the poster owns the wire.” Do not move this into `formLead.service.ts` so “ingestion owns the map.” Do not move skip decide here so “one result owns skipped.” Do not split `create.ts` / `build.ts` / `encode.ts`. Do not silently write `leadno` from Job Number so “CRM can take Job Number.” Do not silently invent `movedte` from `tx.now` so “Granot always gets a date.” Do not silently read stored `first_name` / `last_name` so “the parts match.”

**External interface** stays small (this is the test surface). Map, encode, and mask are one story’s Granot body, not three CRUD verbs:

| Keep exporting | Story name | Why the seam exists |
|---|---|---|
| `buildCrmFormLeadPayload` | `mapTheSavedFormLeadOntoTheGranotWire` | poster send + Form Lead Ingestion skip result; barrels |
| `encodeCrmFormBody` | `encodeTheGranotFormLeadAsUrlencoded` | poster `fetch` body only; folder barrel, not the root facade |
| `summarizeCrmPayloadForLog` | `maskTheGranotPayloadForOperatorLogs` | poster started log only; folder barrel, not the root facade |

Keep the old names as one-line aliases until `crm.service.ts`, `formLead.service.ts`, `crm/index.ts`, and the root `crm.service.ts` facade migrate. Do not make callers learn `splitNameForCrm` / `formatCrmMoveDate` / `fingerprintForLog` as the domain language.

`splitNameForCrm` and `formatCrmMoveDate` stay exported as aliases because the root facade already re-exports them. They are child decisions, not a second public operation. Prefer they become unexported once the facade drops them.

**Principle: old exports stay as aliases.** `buildCrmFormLeadPayload` remains the imported name until Form Lead Ingestion skip and the poster point at the story name.

**No class for the workflow.** The type that *does* earn a name is the Granot wire card this file already fills. It lives on sibling `types.ts` today — do not move the card here “so the mapper owns its type”:

```ts
type GranotFormLeadWire = {
  label: string
  firstname: string
  lastname: string
  ozip: string
  dzip: string
  email: string
  phone1: string
  movesize: string
  movedte: string
  notes: string
  leadno: string
}
```

That is the handoff from “the Form Lead is saved” to “the poster can encode it, skip can store it, operators can see a masked copy.” Do **not** add `job_no` so “CRM can take Job Number,” do **not** add `lid` onto `leadno` so “the gateway gets our Lead id,” and do **not** add `skipped: true` so “the map owns skip.”

`CrmFormLeadPayload` / `CrmSubmitResult` stay on sibling `types.ts` until that module’s skip. `companyLabel` on the map is the Form Lead Ingestion **seam** for Operations Registry `crm_label_snapshot` — it is not a second public operation.

## The file, as a story

Parent functions stay deep. Child names are only extracted when they hide a real decision, not a one-liner.

```ts
// formLeadPayload.ts
// The Form Lead is already in Mongo.
// Form Lead Ingestion already decided post or skip.
// Turn that saved lead into the exact Granot Hello Moving body.
// Company label. First and last name Granot will accept.
// Origin and destination zip. Email. Phone. Move size.
// Unpadded UTC M/D/YYYY move date, or blank.
// lid in notes only. Tracking Reference as leadno.
// "not provided" becomes empty leadno.
// Job Number must not become leadno.
// Encode that body for the poster.
// Mask it for operator logs.
// This file does not fetch.
// This file does not decide skip.
// This file does not write a Lead.

// ── 1. Map the saved Form Lead onto the Granot wire ───────

export function mapTheSavedFormLeadOntoTheGranotWire(lead, companyLabel)
export const buildCrmFormLeadPayload = mapTheSavedFormLeadOntoTheGranotWire

function peelTheCustomerNameForGranot(name)
export const splitNameForCrm = peelTheCustomerNameForGranot

function writeTheGranotMoveDateFromUtcMidnight(date)
export const formatCrmMoveDate = writeTheGranotMoveDateFromUtcMidnight

function treatNotProvidedTrackingReferenceAsBlank(refNo)

// ── 2. Encode the Granot Form Lead as urlencoded ──────────

export function encodeTheGranotFormLeadAsUrlencoded(payload)
export const encodeCrmFormBody = encodeTheGranotFormLeadAsUrlencoded

// ── 3. Mask the Granot payload for operator logs ──────────

export function maskTheGranotPayloadForOperatorLogs(payload)
export const summarizeCrmPayloadForLog = maskTheGranotPayloadForOperatorLogs

function fingerprintIdentifiersForLogs(value)
```

Read the primary path out loud: *The Form Lead is already saved. Peel the customer name so Granot gets a first and a last. Write the move date from UTC midnight, or leave it blank. Put the company label on the body. Put the Tracking Reference on `leadno`, unless it is `"not provided"`. Put `lid` in `notes` only. Never put Job Number on `leadno`. Encode that body for the poster. Mask it so operators can see what we sent. Do not fetch. Do not decide skip. Do not write a Lead.*

That is the operation. `buildCrmFormLeadPayload` is not.

## Precise logic I would tighten while renaming

These are real smells the story names make obvious. Do not “just rename.”

1. **The header comment lies about who owns `label`.** It points at `CRM_SOURCE_LABELS` / `getCrmFormLeadSourceCompanyLabel` / call-lead inbound labels. This file never calls those. Form Lead Ingestion already resolved Operations Registry `crm_label_snapshot` and passes `companyLabel`. A blank argument becomes `CRM_FORM_LEAD_LABEL`. Name `mapTheSavedFormLeadOntoTheGranotWire` so that caller **seam** is the story. Do not import the source catalog so “the mapper owns the label.” Do not add a call-lead payload here so “the comment becomes true.”

2. **Name peel ignores stored `first_name` / `last_name`.** Form ingest may persist a composed `name` and empty parts ([recommendations/leads-lead-name.md](leads-lead-name.md); already on `CONTRADICTIONS.md`). This file peels `lead.name` again: first token / last token; a single token is copied to both; middles are dropped. Keep that mismatch visible. Do not silently read the stored parts so “CRM matches Mongo.” Do not move this peel into `leadName.service.ts`.

3. **Job Number must not become `leadno`.** Tests already lock AC-03: persisted `ref_no` is `leadno`; `job_no` / `normalized_job_no` are not consulted. The map does not mention those fields. Keep it that way. Do not add `lead.job_no` as a fallback so “Granot gets something.”

4. **`lid` lives in `notes` and is never a matching key.** The same AC-03 tests prove `notes !== leadno`. Do not swap them so “Granot sees our Lead id.” Do not drop `notes` so “PII shrinks.”

5. **`"not provided"` is a sentinel, not a Tracking Reference.** Trim, lowercase, compare, then send `""`. Other strings, including a real provider ref, stay as typed. Do not teach the map to treat empty `ref_no` and the sentinel as different wire keys.

6. **Absent `move_date` must stay empty `movedte`.** Knowledge and AC-08 already say do not invent today. Form Lead Ingestion still writes `move_date: input.move_date ?? tx.now` on its own create path; trusted Granot create may persist with none. This file only reads what is stored. Do not call `tx.now` here so “Granot always gets a date.”

7. **The wire-map test builds `move_date` with a local `new Date(2026, 5, 1)`.** The date fold uses UTC components. Those disagree outside UTC. The dedicated date test already uses `Date.UTC`. Point the mapping test at UTC midnight when renaming. Do not change `formatCrmMoveDate` to local so “the local fixture passes everywhere.”

8. **Skip and post share this map. Encode is poster-only.** Form Lead Ingestion skip stores the mapped payload and never calls `encodeCrmFormBody`. Do not make skip encode so “one result owns the body string.” Do not add a skip branch here so “the mapper owns `crm.form_lead.submit.skipped`.”

9. **Do not silently fix the Sheet Sync → CRM order.** Knowledge already flags `finalizeSheetSync` before the post as reversed from ADR-0002. This file is only the wire. Reorder only as a separate, tested change on Form Lead Ingestion. `docs/adr/` is absent here — do not invent the ADR so the knowledge link has a local file.

10. **Leave sibling modules alone.** `submitFormLeadToCrm`, `CRM_FORM_LEAD_LABEL`, `CrmFormLeadPayload`, `maskEmailForLog` / `maskPhoneForLog` are already the right **depth**. This file fills the card and masks it. The post, skip decide, and credential redact stay where they are.

## Testing

The **interface** is the test surface: `mapTheSavedFormLeadOntoTheGranotWire` (today `buildCrmFormLeadPayload`), plus the two exported seams the poster already depends on (`encodeTheGranotFormLeadAsUrlencoded`, `maskTheGranotPayloadForOperatorLogs`).

Today’s `formLeadPayload.test.ts` already names the map decisions: blank / single-token / multi-token name peel, UTC unpadded `M/D/YYYY`, blank label default, Tracking Reference as `leadno`, Job Number must not replace `leadno`, `lid` in `notes` only, `"not provided"` → empty `leadno`, wire field map, absent date → empty `movedte`, log mask / fingerprint, blank PII does not throw. Keep those as the operation tests. They hydrate a Form Lead; they do not stub `fetch`.

Add tests that name the remaining owner-visible seams. Do not add a test per helper:

**Map**
- Caller `companyLabel` becomes Granot `label`; blank / whitespace falls back to `CRM_FORM_LEAD_LABEL`.
- Tracking Reference is `leadno`. Job Number / `normalized_job_no` are not `leadno`.
- `lid` is `notes` and is not `leadno`.
- `"not provided"` (any case, after trim) → empty `leadno`. A real provider ref stays as typed.
- Stored-absent `move_date` → empty `movedte`. A UTC-midnight date → unpadded `M/D/YYYY` of that calendar day.
- One-token name is copied to both Granot name fields. Middles are dropped.

**Encode / mask**
- Encode is the urlencoded body the poster already asserts in `crm.service.test.ts`. Prove field names (`leadno`, `notes`, `ozip`) here if the poster test ever stops checking the body. Do not re-test `fetch`.
- Mask keeps `label` / `movesize` / `movedte` readable, first-letter-masks names, sanitizes email / phone, fingerprints zips / `notes` / `leadno`. The wire payload is unchanged.

**Not this interface**
- Skip (`post_to_granot` false or Duplicate Lead) stays on Form Lead Ingestion. Do not add a skip test here so “the mapper owns `crm.form_lead.submit.skipped`.”
- Announce / send / never-throw outcome stays on [recommendations/crm-crm-service.md](crm-crm-service.md).
- Credential redact of `API_ID` / `MOVERREF` stays on skipped `crmConfig.ts` (`crmEndpointForLog`).
- Sheet Sync before the post stays on Form Lead Ingestion. Do not assert order from this folder.
- Stored `first_name` / `last_name` compose stays on [recommendations/leads-lead-name.md](leads-lead-name.md).

Do **not** add a test per helper (`peelTheCustomerNameForGranot`, `treatNotProvidedTrackingReferenceAsBlank`, `fingerprintIdentifiersForLogs`) once those names exist only so the parent reads. Today’s direct `splitNameForCrm` / `formatCrmMoveDate` cases may stay until the root facade drops those exports; after that, fold them into the map cases. If a helper test has to change when the helper is inlined, it was testing past the **interface**.

There is no `begin` / `complete` export. Canonical commands do not build this payload from this file.

## What I would not do

- A `CrmPayloadService` class with `create` / `update` / `delete`.
- Thirty two-line functions that only wrap `URLSearchParams` or `createHash`.
- Moving this into a CRUD folder (`create.ts` / `build.ts` / `encode.ts` / `delete.ts`) for cleanliness.
- Breaking the after-commit **seam**. The map must not sit inside the Mongo Form Lead write.
- Treating trusted Granot `createLeadFromGranot`, webhook capture, CSV apply, or HTTP automation apply as this story.
- Inventing a skip **seam** that has only one **adapter** (Form Lead Ingestion already owns skip and already calls this map).
- Inventing a call-lead payload **seam** that this folder would never send.
- Silently “fixing” the known Sheet Sync → CRM order gap while recommending a rename.
- Jumping to `leadMessaging` while this checklist still had `formLeadPayload.ts` unchecked (it does not, after this pass).
- Writing a whole-folder recommendation for `crm`.
- Teaching this file to write `leadno` from Job Number, `lid`, or Mongo `_id`.
- Teaching this file to invent `movedte` from today when the stored date is absent.
- Silently merging `splitNameForCrm` into `leadName.service.ts` so “one name module.”
- Moving `submitFormLeadToCrm` or `CRM_FORM_LEAD_ENDPOINT` into this file so “one CRM module.”
