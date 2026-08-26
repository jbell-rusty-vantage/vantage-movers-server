# Show The Landing-Page Contact And The Granot Contact As Two Masked Cards — operational story

- Status: recommended
- Service: `granotLifecycle` (Wave A, in-progress)
- Pass: 12 of this service — `leadContactProjection.ts`
- Remaining in this service: `processor.ts` and the rest of the `granotLifecycle` checklist in TRAVERSAL.md
- Target: `src/services/granotLifecycle/leadContactProjection.ts`
- Knowledge: `docs/knowledge/granot-lifecycle/desired-state.md` (Command conversion and role-safe projection paragraph). That Service file also lists `leadDesiredState.ts`, `granotTemporal.ts`, and `authorizedDesiredState.ts` as primary code — they are siblings, not this pass. The Service title still says “desired-state planner”; this file does not plan. Distinct from the in-memory plan: [recommendations/granot-lifecycle-lead-desired-state.md](granot-lifecycle-lead-desired-state.md). Distinct from Temporal compare / winner filter: [recommendations/granot-lifecycle-granot-temporal.md](granot-lifecycle-granot-temporal.md). Distinct from the allowlisted write patch / contact hash: [recommendations/granot-lifecycle-authorized-desired-state.md](granot-lifecycle-authorized-desired-state.md). Distinct from matched-Lead `$set` / snapshot stamps: `synchronizeLeadFromGranot.ts`. Distinct from create-if-missing: `createLeadFromGranot.ts`. Distinct from processor Decision / live invoke: `processor.ts`. Distinct from the Admin case / Job / Lead DTO that actually ships contact: next-but-one `projections.ts` (`projectOwnerVisibleContact`, `projectLeadContacts`, `maskContactLabel`). Unit 18 / AC-10: WordPress primary contact stays put, qualified Granot contact is stored separately and displayed; this file is the unused display half. This checkout’s `CONTEXT.md` does not define Granot Observation / Ingestion Origin / desired state — do not invent a glossary copy. `docs/adr/` is absent here — do not invent ADR copies.
- Callers: **none outside tests.** Tests only: `leadContactProjection.test.ts` (AC-10 WordPress pair + mask). `synchronizeLead.replica.test.ts` (after a live WordPress sync, asserts submitted name still “Submitted Name”, Granot card present, raw phone absent). Knowledge names `projectRoleSafeLeadContacts`. UNIT-18 said later case UI would consume this projection. Case UI never imported it. Not callers: `projections.ts`, `processor.ts`, `leadDesiredState.ts`, `authorizedDesiredState.ts`, `synchronizeLeadFromGranot.ts`, `createLeadFromGranot.ts`, `capture.ts`, `identity.ts`, `sourcePolicy.ts`, `granotTemporal.ts`, `normalization.ts`, admin routes.
- Seams callers need: two labeled cards vs one mixed contact; masked display vs owner-visible intake; this display vs the write-path contact hash
- Split later (only if the file outgrows one sitting): keep one file — this is already one sitting. If it later splits: `showTheLandingPageContactAndTheGranotContactAsTwoMaskedCards.ts` — still one story file, never `mask.ts` / `wordpress.ts` / `display.ts`, and never `create.ts` / `update.ts` / `delete.ts`

`projectRoleSafeLeadContacts` is executor mechanics. The owner question is: *When someone looks at this Lead, show the contact that arrived with it and the contact Granot last stated as two labeled cards. Mask the phone and the email. Never mix the cards. Never read the raw receipt. A WordPress snapshot is not the landing-page name. This file does not decide what Granot may write. This file does not `$set` a Lead. This file does not take a role.*

Desired-state planning, Temporal compare, allowlisted convert, matched-Lead writes, create-if-missing, and the Admin DTO that actually ships contact already live in other **modules**. Do not pull those in.

## What this file actually does

One operation of one story, not “a contact CRUD service,” and not the planner / the write / the Admin DTO:

1. **Show the landing-page contact and the Granot contact as two masked cards** — take a Lead-shaped bag (`ingestion_origin`, current `name` / `first_name` / `last_name` / `phone_number` / `email`, optional `granot_contact_snapshot`). Copy current name parts through unmasked. Mask phone with `maskPhoneForLog` (`***1111`). Mask email with `maskEmailForLog` (`a***@example.test`). If a snapshot exists, build a second card the same way and attach `differs_from_ingested`, `observation_id` as a string, and `captured_at` as ISO when it is a real `Date`. Omit empty cards. The `wordpress_form` branch and the leftover branch return the same object. This function does not read `ingested_contact_snapshot`. It does not read a receipt. It does not take a role. It does not write a Lead.

There is no second mutate operation. `maskContact` is a shared fold, not a public story. WordPress vs other origin was meant to be two **adapters** for one “keep the cards apart” rule. Today they are one function with a dead `if`.

## Organization

Keep one file. This is the screenplay for “show the landing-page contact and the Granot contact as two masked cards.” Planning, convert, `$set`, and Admin DTOs already live in deeper **modules**. Do not pull those in. Do not invent a `LeadContactProjectionService` class. Do not invent a canonical-command `begin` / `complete` **seam** — this is a pure display fold, not a Domain Command. Do not invent a role **seam** that has only one **adapter** here. Do not invent a WordPress **seam** until the two branches actually differ.

Do not split this ~95-line file into `mask.ts` / `wordpress.ts`. Those would be beats of one owner question, and the WordPress beat is currently a no-op. Do not move `projectRoleSafeLeadContacts` into `authorizedDesiredState.ts` so “every contact hash lives together.” Do not move it into `leadDesiredState.ts` so “knowledge lists both as primary code.” Do not move it into `projections.ts` so “every contact card lives together.” Do not merge `hashGranotContactLeaves` here so “every contact digest lives together.” Do not delete the file so “nobody calls it.”

**External interface** stays small (this is the test surface):

| Keep exporting | Story name | Why the seam exists |
|---|---|---|
| `projectRoleSafeLeadContacts` | `showTheLandingPageContactAndTheGranotContactAsTwoMaskedCards` | intended AC-10 display; tests + knowledge only today |
| `LeadContactDisplaySource` | `ALeadWeMayShowContactFor` | current fields + optional Granot snapshot; not a receipt |
| `MaskedLeadContact` | `MaskedReachableContact` | name unmasked; phone/email masked |
| `RoleSafeLeadContactProjection` | `TwoLabeledMaskedContactCards` | `submitted_contact` and `granot_contact` stay separate |

Keep the old names as one-line aliases until a real runtime caller appears. Do not make that future caller learn `role` or `wordpress_form` as the domain language until the function actually branches on them.

**No class for the workflow.** The type that *does* earn a name is the pair of cards:

```ts
type TwoLabeledMaskedContactCards = {
  submitted_contact?: MaskedReachableContact
  granot_contact?: MaskedReachableContact & {
    differs_from_ingested?: boolean
    observation_id?: string
    captured_at?: string
  }
}
```

That is the handoff from “the Lead already has current contact and an optional Granot snapshot” to “a reader may see two labeled, masked cards.” Do **not** add `ingested_contact_snapshot` onto the return so “the card is already the Admin DTO,” and do **not** add a `role` so “the name is honest,” until a second **adapter** exists.

## The file, as a story

Parent functions stay deep. Child names are only extracted when they hide a real decision, not a one-liner.

```ts
// leadContactProjection.ts
// When someone looks at this Lead, show two cards:
// the contact that arrived with it, and the contact Granot last stated.
// Mask the phone and the email.
// Never mix the cards.
// Never read the raw receipt.
// A WordPress snapshot is not the landing-page name.
// This file does not plan fields.
// This file does not $set a Lead.
// This file does not take a role.

// ── 1. Show the landing-page contact and the Granot contact as two masked cards ──

export function showTheLandingPageContactAndTheGranotContactAsTwoMaskedCards(lead)

function copyTheNameUnmasked(contact)                 // name / first / last
function maskThePhoneTheLogWay(phone)                 // ***1111 — sibling sanitizeFormLeadForLog
function maskTheEmailTheLogWay(email)                 // a***@example.test
function buildTheGranotCardIfASnapshotExists(snapshot)
  // same mask; attach differs_from_ingested / observation_id / captured_at ISO
function doNotMixTheCards(submitted, granot)
  // today's wordpress_form branch returns the same object as the leftover

export type TwoLabeledMaskedContactCards = { /* today's RoleSafeLeadContactProjection */ }
```

Read the primary path out loud: *The processor already kept the Observation, already asked which Registry row it is, already asked which Form or Call Lead it is, already asked whether this statement is newer, already asked what that Lead should look like, and — if we wrote — already `$set` current contact and a separate Granot snapshot. Now, if someone is allowed to look, show two cards. The first card is the contact that arrived with the Lead. The second card is the contact Granot last stated, with whether it differs from ingested and which Observation it came from. Mask the phone and the email on both. Leave the names readable. Do not open the receipt. Do not put Granot’s name on the landing-page card. Then stop. Admin intake that must phone the customer is a different story, in a different file, and it does not mask.*

That is the operation. `projectRoleSafeLeadContacts` is not. `projectOwnerVisibleContact` is not this mask.

## Precise logic I would tighten while renaming

These are real smells the story names make obvious. Do not “just rename.”

1. **No runtime caller imports this file.** `projectRoleSafeLeadContacts` is imported by its unit test and by `synchronizeLead.replica.test.ts` after a WordPress sync. `projections.ts`, routes, and the processor do not import it. UNIT-18 said later case UI would consume this projection. Case UI built `projectLeadContacts` instead. Do not wire this file into `projections.ts` so “the planner Service lists this as primary code,” and do not delete it so “nobody calls it.”

2. **The WordPress branch is a no-op.** `ingestion_origin === "wordpress_form"` and the leftover both return `{ submitted_contact, granot_contact? }`. AC-10 only exercises WordPress. Do not add a second WordPress return so “the `if` earns its keep,” and do not delete the `if` as a silent cleanup in this rename — the origin split is the owner rule, and it is currently invisible.

3. **`submitted_contact` is live current fields, not the ingested snapshot.** For a WordPress Lead the planner keeps current name/phone/email off `changed_paths`, so the live fields still *are* the landing page — until someone patches them in Admin. `projections.ts` `projectLeadContacts` labels `submitted_or_ingested` from `ingested_contact_snapshot`. This file never reads that snapshot. Do not start reading `ingested_contact_snapshot` here so “the Admin DTO wins,” and do not teach Admin to read live `name` so “this file wins.”

4. **There is no role.** The export says `RoleSafe`. The argument has no role. Owner intake in `projections.ts` sends the whole contact (`projectOwnerVisibleContact`, `customerLabel`) because the Owner phones the customer. Discrepancy / SMS logging still uses `maskContactLabel`. This file always masks phone/email and never asks who is looking. Do not add a `role` argument so “the name is honest,” and do not unmask here so “Owner intake can reuse this file.”

5. **Two mask alphabets.** This file uses log helpers: phone `***1111`, email `a***@example.test`, names in the clear. `maskContactLabel` uses `A•••` / `•••1234` / `s•••@domain`. Do not switch this file to bullets so “one mask wins,” and do not switch the discrepancy label to `maskPhoneForLog` so “one helper wins.”

6. **A WordPress snapshot is not the landing-page name — and this file already keeps the cards apart when both exist.** The replica test locks current `name` still “Submitted Name” and `granot_contact_snapshot.name` “Granot Name.” Convert keeps `granot_contact_snapshot` off current-contact leaves. Do not copy snapshot name onto `submitted_contact` so “one card is enough,” and do not drop the Granot card so “WordPress never shows Granot.”

7. **`captured_at` that is not a `Date` disappears.** `observation_id` stringifies any truthy value. A non-Date `captured_at` is omitted. Do not `new Date(String(captured_at))` here so “ISO always appears” — that throw-or-guess belongs to `projections.ts` `iso`, which fails closed.

8. **Empty phone/email/name are omitted, not masked.** `if (contact.phone_number)` skips blank. A Lead with no phone does not get `[redacted]`. Do not emit `[redacted]` for missing fields so “the log helper is always used.”

9. **Leave sibling modules alone.** Field wants stay in `leadDesiredState.ts`. Allowlisted `set` / `hashGranotContactLeaves` stay in `authorizedDesiredState.ts`. Lead `$set`, snapshot `observation_id` / `differs_from_ingested`, and `last_accepted` stay in `synchronizeLeadFromGranot.ts`. Owner-visible vs discrepancy masking stay in `projections.ts`. Log helpers stay in `sanitizeFormLeadForLog`. ObjectId construction stays in `utils/objectId.ts`.

10. **Do not treat desired-state planning, authorized convert, matched-Lead writes, create-if-missing, or Admin intake DTOs as this story.** Those say what Granot wants, refuse a lying patch, `$set` a Lead, insert a Lead, or show the Owner a phone number they can dial. This file only builds two masked cards.

11. **Do not write a whole-folder recommendation for `granotLifecycle`.**

## Testing

The **interface** is the test surface: `showTheLandingPageContactAndTheGranotContactAsTwoMaskedCards` (today `projectRoleSafeLeadContacts`). `TwoLabeledMaskedContactCards` is part of that **interface**.

Today’s `leadContactProjection.test.ts` already locks a WordPress pair: submitted name in the clear, Granot name in the clear, phones `***1111` / `***2222`, email masked, `differs_from_ingested`, `observation_id` string, raw phone/email absent from `JSON.stringify`. The replica test locks the same split after a live WordPress `$set`. Keep those. Add the gaps that name the operation:

**Show the landing-page contact and the Granot contact as two masked cards**
- WordPress submitted name stays on `submitted_contact` and Granot name stays on `granot_contact` (already locked).
- A Lead with no snapshot returns only `submitted_contact`.
- A non-`wordpress_form` origin currently returns the same shape (lock the today’s no-op; do not invent a second card rule in the test).
- Missing phone/email are omitted, not `[redacted]`.
- Non-Date `captured_at` is omitted; truthy `observation_id` is `String(...)`.
- This function does not read a receipt and does not `$set` a Lead.
- Raw digits do not appear in `JSON.stringify` (already locked).

Do **not** add a test per helper (`copyTheNameUnmasked`, `doNotMixTheCards`). Those names exist so the parent reads. If a helper test has to change when the helper is inlined, it was testing past the **interface**.

Do **not** re-test planner WordPress fences, Temporal `$or` filters, allowlisted convert, or processor Decision persist here. Do not add a test that this file reads `ingested_contact_snapshot`, `writeGranotSourcePolicyCache`, or `projectOwnerVisibleContact`. Do not add a test that Owner intake stays unmasked — that belongs to `projections.ts`. Do not add a test that `hashGranotContactLeaves` equals `***1111`.

## What I would not do

- A `LeadContactProjectionService` class with `create` / `update` / `project`.
- Thirty two-line functions that only wrap `maskPhoneForLog`.
- Moving this into a CRUD folder, or into `leadDesiredState.ts` / `authorizedDesiredState.ts` / `projections.ts` “for cleanliness.”
- Wiring this file into Admin case detail because UNIT-18 said the UI would consume it.
- Deleting the file because nobody calls it.
- Adding a `role` argument so the current name looks honest.
- Unmasking phone here so Owner intake can reuse it.
- Reading `ingested_contact_snapshot` so “submitted means ingested.”
- Copying Granot’s name onto the landing-page card.
- Switching `***` to `•••` so one mask alphabet wins.
- Writing a whole-folder recommendation for `granotLifecycle`.
