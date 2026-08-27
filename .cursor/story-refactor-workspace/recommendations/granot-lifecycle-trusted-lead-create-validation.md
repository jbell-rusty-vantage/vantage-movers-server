# Stamp This New Lead As Coming From Granot, And Never Post It Back — operational story

- Status: recommended
- Service: `granotLifecycle` (Wave A, in-progress)
- Pass: 19 of this service — `trustedLeadCreateValidation.ts`
- Remaining in this service: `synchronizeLeadFromGranot.ts` and the rest of the `granotLifecycle` checklist in TRAVERSAL.md
- Target: `src/services/granotLifecycle/trustedLeadCreateValidation.ts`
- Knowledge: [`docs/knowledge/granot-lifecycle/revisions.md`](../../../docs/knowledge/granot-lifecycle/revisions.md) lists this file as primary code beside `aggregateRevision.ts`, `granotLifecycleSchemas.ts`, and the Lead-provenance / aggregate-revision migrations — they are siblings, not this pass. Distinct from the revision CAS primitive: [recommendations/granot-lifecycle-aggregate-revision.md](granot-lifecycle-aggregate-revision.md). Distinct from assigning WordPress / Admin / RingCentral / sheet origin: [recommendations/leads-ingestion-provenance.md](leads-ingestion-provenance.md). Distinct from public WordPress Zod: `src/validation/v1/leads.validation.ts` (`createFormLeadSchema` / `createCallLeadSchema`). Distinct from “did Granot give enough to create?”: [recommendations/granot-lifecycle-lead-desired-state.md](granot-lifecycle-lead-desired-state.md) (`evaluateMinimumCreationData`). Distinct from the write command that is the only live caller: next-but-later `createLeadFromGranot.ts`. Distinct from matched-Lead sync: next module `synchronizeLeadFromGranot.ts`. Distinct from Form ingest that may CRM-post: [recommendations/form-lead.md](form-lead.md). Software map: `.cursor/rules/granot-lifecycle-capture.mdc` (`trustedLeadCreateValidation.ts` row). Also named on [`docs/knowledge/services/form-lead.md`](../../../docs/knowledge/services/form-lead.md), [`docs/knowledge/services/call-lead.md`](../../../docs/knowledge/services/call-lead.md), [`docs/knowledge/services/domain-commands.md`](../../../docs/knowledge/services/domain-commands.md). This checkout’s `CONTEXT.md` does not define Form Lead / Call Lead / Ingestion Origin / Job Number — do not invent a glossary copy. `docs/adr/` is absent here — do not invent ADR copies.
- Callers: **one live service import.** `createLeadFromGranot.ts` (`trustedGranotFormLeadCreateSchema.parse` then `trustedGranotCallLeadCreateSchema.parse`; always sends `post_to_granot: false`, then spreads the parsed bag under a provenance bag that reprints `ingestion_origin: "granot_lead_created"`). Tests: `trustedLeadCreateValidation.test.ts` (AC-07: Form may omit `move_size` and stamps origin / never-post; Form refuses `post_to_granot: true`; Call allows Job without phone; both refuse public lifecycle keys). UNIT-12 named this file as capability-only with no live caller — that sentence is stale. Not callers: `processor.ts` (calls the create command, not this schema), `formLead.service.ts`, `callLead.service.ts`, `leadIngestionProvenance.ts`, `leads.validation.ts`, public `/api/v1/form-leads` / `/call-leads`, `aggregateRevision.ts`, `authorizedDesiredState.ts`.
- Seams callers need: Form mint vs Call mint (same origin / never-post stamp; different required facts); trusted parse vs public WordPress Zod; refuse `post_to_granot: true` vs transform-force `false`; caller cannot supply `ingestion_origin`
- Split later (only if the file outgrows one sitting): keep one file — this ~115-line gate is one sitting. Never `form.ts` / `call.ts` / `create.ts` / `update.ts` / `delete.ts`

`trustedGranotFormLeadCreateSchema` / `trustedGranotCallLeadCreateSchema` are executor mechanics. The owner question is: *Granot already has this customer. We are minting a Vantage Lead from that evidence. Stamp it `granot_lead_created` so nobody later treats it as a website quote. Force `post_to_granot=false` so we never CRM-post it back and loop. A Form mint still needs a name, a phone that normalizes, a Job Number, and two 5-digit ZIPs. A Call mint may be Job-only. Public WordPress Zod is not this gate. This file does not write the Lead. This file does not plan `create_if_missing`. This file does not increment `domain_revision`.*

Public create Zod, origin derivation, minimum-creation planning, and the create command already live in other **modules**. Do not pull those in.

## What this file actually does

Two adapters of one Granot-mint story, not “a create-validation CRUD service,” and not the create command / the planner / public WordPress Zod:

1. **Accept this Granot statement as a new Form Lead** — strict object. Job Number must be present and `normalizeJobNo`. Phone must be present and `normalizePhoneNumberForMatch`. Display name, first name, or last name must be present. Pickup and destination ZIPs must be 5 digits (same `zipSchema` as public Form fields). `move_size` may be omitted. `move_date` may be omitted. `post_to_granot: true` is refused. Unknown keys — including `ingestion_origin` and RingCentral / revision metadata — are refused. On success the transform stamps `post_to_granot: false` and `ingestion_origin: "granot_lead_created"`. This function does not save Mongo. This function does not CRM-post.

2. **Accept this Granot statement as a new Call Lead** — same never-post stamp, thinner facts. Job Number must be present and `normalizeJobNo`. Phone may be omitted. Name may be omitted. There are no move fields on this schema. `post_to_granot: true` is refused. Unknown keys are refused. The same transform stamps `post_to_granot: false` and `ingestion_origin: "granot_lead_created"`. This function does not write Call pickup / delivery — the create command adds those after parse. This function does not invent RingCentral session metadata.

There is no third mutate operation. `hasLeadName` is a Form refine beat, not a public story. The two inferred input types are the stamped handoff, not a second persistence.

## Organization

Keep one file as the screenplay for “stamp this new Lead as coming from Granot, and never post it back.” Public Zod, origin derivation, minimum-creation planning, revision CAS, and the create command already live in deeper **modules**. Do not pull those in. Do not invent a `TrustedLeadCreateService` class. Do not invent a canonical-command `begin` / `complete` **seam** here — the sibling create command owns that **seam**. The Form/Call **seam** is two **adapters** of one stamp, not two folders.

Do not move this into `leads.validation.ts` so “every Lead create is one Zod file.” Do not move this into `leadIngestionProvenance.ts` so “origin lives together.” Do not move this into `aggregateRevision.ts` so the revisions.md Primary-code line “wins.” Do not merge this file into `createLeadFromGranot.ts` so “the only caller already stamps origin.” Do not merge this file into `leadDesiredState.ts` so “minimum data is the write-gate.”

**External interface** stays small (this is the test surface):

| Keep exporting | Story name | Why the seam exists |
|---|---|---|
| `trustedGranotFormLeadCreateSchema` | `acceptThisGranotStatementAsANewFormLead` | Form mint: name + normalizable phone + Job + two ZIPs; never post back |
| `trustedGranotCallLeadCreateSchema` | `acceptThisGranotStatementAsANewCallLead` | Call mint: Job is enough; never post back |
| `TrustedGranotFormLeadCreateInput` | `AGranotMintedFormLead` | stamped bag the create command spreads |
| `TrustedGranotCallLeadCreateInput` | `AGranotMintedCallLead` | same stamp; thinner facts |

Keep the old names as one-line aliases until `createLeadFromGranot` and AC-07 migrate. Do not make callers learn `.strict()` / `.superRefine` / `.transform` as the domain language.

**No class for the workflow.** The type that *does* earn a name is the stamped bag after refuse:

```ts
type AGranotMintedLead = {
  post_to_granot: false
  ingestion_origin: "granot_lead_created"
  job_no: string
  // Form also: a name component, a phone that normalizes, two 5-digit ZIPs
}
```

That is the handoff from “Granot said enough” to “the create command may write.” Do **not** add `domain_revision` so “knowledge lists this under revisions,” and do **not** add `quoted` so “Priority 1 / 5 lives on the schema.”

## The file, as a story

Parent functions stay deep. Child names are only extracted when they hide a real decision, not a one-liner.

```ts
// trustedLeadCreateValidation.ts
// Granot already has this customer. We are minting a Vantage Lead from that evidence.
// Stamp origin granot_lead_created so nobody later treats it as a website quote.
// Force post_to_granot=false so we never CRM-post it back and loop.
// A Form mint still needs a name, a phone that normalizes, a Job Number, and two ZIPs.
// A Call mint may be Job-only.
// Public WordPress Zod is not this gate.
// This file does not write the Lead.
// This file does not plan create_if_missing.
// This file does not increment domain_revision.

// ── 1. Accept this Granot statement as a new Form Lead ─

export function acceptThisGranotStatementAsANewFormLead(input)
  refuseUnknownKeys()                              // ingestion_origin, ringcentral_convergence, …
  refuseAMissingName()                             // name or first_name or last_name
  refuseAPhoneThatWillNotNormalize()
  refuseAJobNumberThatWillNotNormalize()
  refuseAnAskedCrmRepost()                         // post_to_granot === true
  // pickup_zip / destination_zip must be 5 digits when the object is built
  // move_size may be omitted — public WordPress Zod still requires it
  stampOriginGranotCreatedAndNeverPostBack()

// ── 2. Accept this Granot statement as a new Call Lead ─

export function acceptThisGranotStatementAsANewCallLead(input)
  refuseUnknownKeys()
  refuseAJobNumberThatWillNotNormalize()
  refuseAnAskedCrmRepost()
  // phone optional; name optional; no move fields
  stampOriginGranotCreatedAndNeverPostBack()
```

Read the primary path out loud: *The processor authorized a live `create_if_missing` Form mint. The create command already decided Granot gave a Job, a name, a phone, and a route. This file parses that bag. A missing name, a phone that will not normalize, a Job Number that will not normalize, or `post_to_granot: true` stops the write. Extra keys such as `ingestion_origin: "wordpress_form"` also stop it. On success the Lead is stamped `granot_lead_created` and `post_to_granot: false` before Mongo sees it. A Call mint with only `job_no` takes the same stamp. Nobody CRM-posts this Lead back to Granot. This file never increments `domain_revision`. This file never writes the Record Link.*

That is the operation. `trustedGranotFormLeadCreateSchema` is not a CRUD create.

## Precise logic I would tighten while renaming

These are real smells the story names make obvious. Do not “just rename.”

1. **Knowledge lists this file under aggregate revisions.** `revisions.md` Primary code is CAS + schema defaults + this validator + two migrations. This file does not touch `domain_revision`. Do not move it into `aggregateRevision.ts` so the Primary-code line “wins,” and do not add a revision field to the transform so “the mint starts at 0 here.”

2. **UNIT-12 said no live caller. That is stale.** The software map and `createLeadFromGranot.ts` now parse both schemas. Do not invent a second live caller so “the validator is shared,” and do not delete the schemas so “the command already stamps origin.”

3. **Form and Call reprint the refuse-true + stamp-false + stamp-origin transform.** One shared beat (`stampOriginGranotCreatedAndNeverPostBack` / `refuseAnAskedCrmRepost`). Do not split `form.ts` / `call.ts` so each copy “owns” the stamp.

4. **The create command stamps origin twice.** Trusted parse writes `ingestion_origin`. Then `createLeadFromGranot` spreads `...trusted` under a `provenance` bag that reprints the same origin. Provenance wins if they ever diverge. Do not delete the schema stamp so “the command already set it,” and do not delete the provenance key so “the schema is the authority.” Leave the command alone this pass.

5. **The live caller always sends `post_to_granot: false`.** The refuse-`true` refine is the AC-07 / future-caller **seam**. Do not drop the refuse so “the command never asks,” and do not make public WordPress Zod refuse `true` so “every create never posts.”

6. **Planner eligibility and this write-gate are two layers.** `evaluateMinimumCreationData` requires Form name + `contact.normalized_phone` + origin/destination US states + two ZIPs + `selectFormMoveType`. This schema requires a name component, a phone that `normalizePhoneNumberForMatch` accepts, a Job Number, and two 5-digit ZIPs. It does not require states or Move Type. The create command passes `phone_raw ?? normalized_phone`. A junk raw with a good normalized phone fails here after the planner said eligible. Do not switch this refine to `normalized_phone` so “the planner wins,” and do not move minimum-data into this file so “one gate.”

7. **Call may be Job-only. Form may not.** Public Call Zod needs phone **or** Job. Trusted Call needs Job and allows no phone. Do not require Call phone or name so “every Granot Lead has a contact.” Do not drop Form phone so “Call and Form match.”

8. **`move_size` is optional here. Public WordPress Zod requires it.** AC-07 locks the omit. Do not add required `move_size` so “Form create is one schema.”

9. **Public `createFormLeadSchema` rejects `job_no`. This schema requires it.** Job Number is the Granot mint identity, not a landing-page field. Do not merge the schemas so “one Form create.” Do not start accepting `job_no` on WordPress Zod so “the trusted fields win.”

10. **Call schema has no move fields.** `createLeadFromGranot` writes pickup / delivery / cubic feet onto the Call Lead after parse. Do not add move fields here so “Call persist matches Form,” and do not stop the command from writing them so “the schema is the persist bag.”

11. **`leadIngestionProvenance.derive*` is a different assign path.** WordPress / Admin / RingCentral / sheet origin stay there. This file hard-codes `granot_lead_created`. Do not call `deriveFormLeadIngestionOrigin` here so “one origin helper,” and do not add a `granot_lead_created` branch that clients can send.

12. **Leave sibling modules alone.** Public Zod stays in `leads.validation.ts`. Origin derivation stays in `leadIngestionProvenance.ts`. Minimum data stays in `leadDesiredState.ts`. CAS stays in `aggregateRevision.ts`. The write stays in `createLeadFromGranot.ts`. This file owns only the trusted mint stamp.

13. **Do not treat match, sync, confirm, cancel, or drain as this story.** Those write official facts or claim a receipt. This file only refuses a bad mint bag and stamps never-post.

14. **Do not write a whole-folder recommendation for `granotLifecycle`.**

## Testing

The **interface** is the test surface: `acceptThisGranotStatementAsANewFormLead` and `acceptThisGranotStatementAsANewCallLead` (today the two Zod schemas).

Today’s `trustedLeadCreateValidation.test.ts` already locks AC-07: Form may omit `move_size` and comes out `post_to_granot: false` / `ingestion_origin: "granot_lead_created"`; Form refuses `post_to_granot: true`; Call accepts Job without phone and takes the same stamp; both refuse `ingestion_origin` / `ringcentral_convergence`. Keep those. Add the gaps that name the operation:

**Accept this Granot statement as a new Form Lead**
- Missing name / first / last still refuses (add this; today’s unit always sends `name`).
- First or last without `name` still accepts (public WordPress Zod already locks this; trusted does not).
- A phone that will not normalize refuses (add this).
- A Job Number that will not normalize refuses (add this).
- Missing 5-digit ZIP refuses (schema-required; no unit today).
- `move_size` omitted still accepts (already locked).
- Extra lifecycle keys still refuse (already locked for origin).

**Accept this Granot statement as a new Call Lead**
- Job-only still accepts (already locked).
- `post_to_granot: true` refuses (add this; today’s refuse-true is Form-only).
- Extra lifecycle keys still refuse (already locked).
- This function does not require phone or name — do not add a test that Call must look like Form.

Do **not** add a test per `hasLeadName` / transform helper. Those names exist so the parent reads. If a helper test has to change when the refine is inlined, it was testing past the **interface**.

Do **not** re-test `createLeadFromGranot` persistence, Sheet Sync, Record Link, or confirmation SMS here. Do not rewrite `createFormLeadSchema` tests as if they covered this file. Do not add a test that this file `$set`s a Lead, increments `domain_revision`, or CRM-posts.

## What I would not do

- A `TrustedLeadCreateService` class with `create` / `validate` / `parse`.
- Thirty two-line functions that only wrap `.parse`.
- Moving this into a CRUD folder, or into `leads.validation.ts` / `leadIngestionProvenance.ts` / `aggregateRevision.ts` / `createLeadFromGranot.ts` / `leadDesiredState.ts` “for cleanliness.”
- Splitting `form.ts` / `call.ts` so each mint owns a file.
- Merging this with public WordPress Zod so “one Form create.”
- Requiring Call phone or `move_size` so “every Granot Lead looks like a website quote.”
- Calling `deriveFormLeadIngestionOrigin` so “one origin helper.”
- Adding `domain_revision` or `quoted` to the transform so revisions.md / Priority “win.”
- Silently switching the Form phone refine to `normalized_phone` so the planner “wins.”
- Treating `createLeadFromGranot` or `synchronizeLeadFromGranot` as this story.
- Writing a whole-folder recommendation for `granotLifecycle`.
