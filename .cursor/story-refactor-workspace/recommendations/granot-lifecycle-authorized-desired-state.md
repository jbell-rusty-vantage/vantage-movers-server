# Turn What This Observation Wants Into The Only Lead Patch We May Write — operational story

- Status: recommended
- Service: `granotLifecycle` (Wave A, in-progress)
- Pass: 11 of this service — `authorizedDesiredState.ts`
- Remaining in this service: `leadContactProjection.ts` and the rest of the `granotLifecycle` checklist in TRAVERSAL.md
- Target: `src/services/granotLifecycle/authorizedDesiredState.ts`
- Knowledge: `docs/knowledge/granot-lifecycle/desired-state.md` (Command conversion paragraph). That Service file also lists `leadDesiredState.ts`, `granotTemporal.ts`, and `leadContactProjection.ts` as primary code — they are siblings, not this pass. The Service title still says “desired-state planner”; this file does not plan. Distinct from the in-memory plan: [recommendations/granot-lifecycle-lead-desired-state.md](granot-lifecycle-lead-desired-state.md). Distinct from Temporal compare / winner filter: [recommendations/granot-lifecycle-granot-temporal.md](granot-lifecycle-granot-temporal.md). Distinct from source-scoped identity: [recommendations/granot-lifecycle-identity.md](granot-lifecycle-identity.md). Distinct from Registry policy / eight gates: [recommendations/granot-lifecycle-source-policy.md](granot-lifecycle-source-policy.md). Distinct from role-safe contact display: next module `leadContactProjection.ts`. Distinct from matched-Lead `$set` / provenance stamps: `synchronizeLeadFromGranot.ts`. Distinct from create-if-missing: `createLeadFromGranot.ts` (does not import this file). Distinct from processor Decision / live invoke: `processor.ts`. This checkout’s `CONTEXT.md` does not define Granot Observation / desired state / Synchronization Decision / Ingestion Origin — do not invent a glossary copy. `docs/adr/` is absent here — do not invent ADR copies.
- Callers: `processor.ts` (`toAuthorizedLeadDesiredState` immediately before `synchronizeLeadFromGranot`; then `assertAuthorizedLeadDesiredState` again; `synchronizeLeadIdempotencyKey` + `synchronizeLeadPayloadChecksum` on the command context). `synchronizeLeadFromGranot.ts` (`assertAuthorizedLeadDesiredState` at the command door; `hashGranotContactLeaves` only when `contact_changed_paths` is nonempty, for `last_granot_contact_change` before/after). Type-only: `domainCommands/types.ts` (`GranotAuthorizedLeadDesiredState` on the `synchronizeLeadFromGranot` command). Tests: `authorizedDesiredState.test.ts` (AC-05 / AC-10 / AC-11 / AC-12 / AC-32). Sync / processor tests consume the patch without re-implementing the allowlist. Not callers: `leadDesiredState.ts` (this file reads `LeadDesiredStatePlan` only), `createLeadFromGranot.ts`, `leadContactProjection.ts`, `capture.ts`, `identity.ts`, `sourcePolicy.ts`, `granotTemporal.ts`, `normalization.ts`.
- Seams callers need: in-memory plan vs authorized patch; convert that drops leftover planner notes vs assert that throws if those notes already sit on `set`; processor fingerprint vs command contact hash
- Split later (only if the file outgrows one sitting): keep one file — this is already one sitting. If it later splits: `turnWhatThisObservationWantsIntoTheOnlyLeadPatchWeMayWrite.ts` / `refuseALeadPatchThatWouldWriteForbiddenOrLyingFields.ts` / `fingerprintThisExactLeadWrite.ts` — story files, never `convert.ts` / `assert.ts` / `hash.ts`, and never `create.ts` / `update.ts` / `delete.ts`

`toAuthorizedLeadDesiredState` / `assertAuthorizedLeadDesiredState` are executor mechanics. The owner question is: *The planner already said what this Observation wants the Lead to become. Before anyone writes, keep only the fields Granot is allowed to touch. Drop the leftover planner notes. Refuse quoted false, the wrong ZIP name for this Lead model, and anything the server must stamp itself. A WordPress snapshot is not current contact. Then fingerprint the contact leaves and this exact write so the same Observation does not apply twice. This file does not plan fields. This file does not `$set` a Lead.*

Desired-state planning, Temporal compare, identity, Registry policy, matched-Lead writes, create-if-missing, and display masking already live in other **modules**. Do not pull those in.

## What this file actually does

Three operations of one story, not “an authorized-state CRUD service,” and not the planner / the write / the display mask:

1. **Turn what this Observation wants into the only Lead patch we may write** — take a `LeadDesiredStatePlan`, the target Lead model, and the Observation that won the clock. Walk `changed_paths`. Keep a path only when it is on `GRANOT_LEAD_WRITE_PATHS`, not on `FORBIDDEN_DESIRED_STATE_METADATA_PATHS`, and present in `desired_values`. Sort the surviving keys. Split those keys into current-contact leaves vs move leaves. `granot_contact_snapshot` stays on the patch and is **not** a contact leaf. Attach `temporal_winner` as a sibling of `set`, never as a `set` path. Then refuse if the result is illegal. This function does not invent Priority, quoted, Job, or contact. It does not write a Lead.

2. **Refuse a patch that would write forbidden or lying fields** — the command-door **adapter** of the same rule. Winner `observation_id` must be 24-character ObjectId hex; `captured_at` must be a real `Date`. `set` keys unique; `changed_paths` unique and exactly the sorted keys of `set`. Any forbidden metadata path or unknown path throws. `quoted: false` throws (`quoted: true` may stay). FormLead cannot set `delivery_zip`; CallLead cannot set `destination_zip`. `contact_changed_paths` / `move_changed_paths` must match the leaf lists derived from `changed_paths`. Processor already ran this inside convert, then runs it again. `synchronizeLeadFromGranot` runs it before the transaction. Do not delete the command-door assert so “convert already checked.”

3. **Fingerprint this write so the same Observation does not apply twice** — SHA-256 of the six current-contact leaves (missing → `null`, key order fixed) so the command can stamp `last_granot_contact_change` before/after. SHA-256 of `{ lead_ref, expected_domain_revision, desired_state }` with Dates as ISO so the processor can hand the executor a payload checksum. Idempotency key is exactly `granot:synchronize-lead:${observationId}` — one Observation is one Lead-sync command. This function does not hash a display mask. It does not insert a Lead.

There is no fourth mutate operation. `canonicalizeForHash` / `sortUnique` are shared folds, not a public story. Convert and assert are two **adapters** for one allowlist. Contact hash and command checksum are two **adapters** for one “say this write again” rule.

## Organization

Keep one file. This is the screenplay for “turn what Granot wants into the only Lead patch we may write, refuse a lying one, and fingerprint the write.” Planning, Temporal order, identity, gates, `$set`, and display masking already live in deeper **modules**. Do not pull those in. Do not invent an `AuthorizedDesiredStateService` class. Do not invent a canonical-command `begin` / `complete` **seam** — this is a pure convert plus refuse plus fingerprint, not a Domain Command. Do not invent a write **seam** that has only one **adapter** here.

Do not split this ~270-line file into `convert.ts` / `assert.ts` / `hash.ts`. Those are beats of one owner question. Do not move `planLeadDesiredState` here so “knowledge lists both as primary code.” Do not move `hashGranotContactLeaves` into `synchronizeLeadFromGranot.ts` so “provenance lives with the write.” Do not move `projectRoleSafeLeadContacts` here so “every contact hash lives together.” Do not merge this file into `processor.ts` so “convert and invoke live together.”

**External interface** stays small (this is the test surface):

| Keep exporting | Story name | Why the seam exists |
|---|---|---|
| `toAuthorizedLeadDesiredState` | `turnWhatThisObservationWantsIntoTheOnlyLeadPatchWeMayWrite` | processor’s only convert, immediately before sync |
| `assertAuthorizedLeadDesiredState` | `refuseALeadPatchThatWouldWriteForbiddenOrLyingFields` | convert exit + command door |
| `hashGranotContactLeaves` | `fingerprintTheContactLeavesGranotMayChange` | command `last_granot_contact_change` before/after |
| `synchronizeLeadPayloadChecksum` | `fingerprintThisExactLeadWrite` | processor → executor payload |
| `synchronizeLeadIdempotencyKey` | `nameThisObservationAsOneLeadWrite` | processor → executor idempotency |
| `GranotAuthorizedLeadDesiredState` | `TheOnlyLeadPatchWeMayWrite` | command input; never the plan |
| `GRANOT_LEAD_WRITE_PATHS` | `FieldsGranotMayWriteOnALead` | allowlist both **adapters** share |
| `FORBIDDEN_DESIRED_STATE_METADATA_PATHS` | `FieldsTheServerMustStampItself` | drop vs throw |
| `GRANOT_CONTACT_PATHS` / `GRANOT_MOVE_PATHS` | `CurrentContactLeaves` / `QualifiedMoveLeaves` | classify, not plan |
| `AuthorizedDesiredStateError` | `ThisLeadPatchIsNotAllowed` | convert and assert |

Keep the old names as one-line aliases until `processor.ts` and `synchronizeLeadFromGranot.ts` migrate. Do not make callers learn `WRITE_PATH_SET` / `FORBIDDEN_PATH_SET` as the domain language.

**No class for the workflow.** The type that *does* earn a name is the patch both write callers consume:

```ts
type TheOnlyLeadPatchWeMayWrite = {
  set: Partial<Record<FieldsGranotMayWriteOnALead, unknown>>
  changed_paths: FieldsGranotMayWriteOnALead[]
  contact_changed_paths: CurrentContactLeaves[]
  move_changed_paths: QualifiedMoveLeaves[]
  temporal_winner: { observation_id: string; captured_at: Date }
}
```

That is the handoff from “we know what Granot wants” to “the command may `$set` only this.” Do **not** add `last_accepted_granot_observation`, contact hashes, or `receiver_agent_name_snapshot` so “the patch is already the write,” and do **not** add gate results so “the patch can fire.”

## The file, as a story

Parent functions stay deep. Child names are only extracted when they hide a real decision, not a one-liner.

```ts
// authorizedDesiredState.ts
// The planner already said what this Observation wants the Lead to become.
// Before anyone writes: keep only the fields Granot may touch.
// Drop leftover planner notes.
// Refuse quoted false, the wrong ZIP name, and anything the server must stamp itself.
// A WordPress snapshot is not current contact.
// Fingerprint the contact and this exact write so the same Observation
// does not apply twice.
// This file does not plan fields.
// This file does not $set a Lead.

// ── 1. Turn what this Observation wants into the only Lead patch we may write ──

export function turnWhatThisObservationWantsIntoTheOnlyLeadPatchWeMayWrite({
  plan,
  lead_model,
  temporal_winner,
})

function keepOnlyTheFieldsGranotMayWrite(plan)
function dropTheNotesTheServerMustStampItself(path)
  // last_granot_contact_change, last_accepted, ingestion, source, CPL, booked, move_size…
function sayWhichOfThoseFieldsAreCurrentContact(paths)   // not granot_contact_snapshot
function sayWhichOfThoseFieldsAreTheMove(paths)
function attachTheObservationThatWonTheClock(winner)     // sibling of set, never a set path
  // then refuseALeadPatchThatWouldWriteForbiddenOrLyingFields

export type TheOnlyLeadPatchWeMayWrite = { /* today's GranotAuthorizedLeadDesiredState */ }

// ── 2. Refuse a patch that would write forbidden or lying fields ──

export function refuseALeadPatchThatWouldWriteForbiddenOrLyingFields(desired, lead_model)

function theWinnerStampMustBeARealObservation(winner)
function thePathListMustBeTheSortedKeysOfThePatch(set, changed_paths)
function quotedMayBeTrueNeverFalse(set)
function aFormLeadUsesDestinationZipACallLeadUsesDeliveryZip(set, model)
function contactAndMoveListsMustMatchTheLeaves(desired)

// ── 3. Fingerprint this write so the same Observation does not apply twice ──

export function fingerprintTheContactLeavesGranotMayChange(contact)
export function fingerprintThisExactLeadWrite({ lead_ref, expected_domain_revision, desired_state })
export function nameThisObservationAsOneLeadWrite(observationId)
  // granot:synchronize-lead:${observationId}
```

Read the primary path out loud: *The processor already kept the Observation, already asked which Registry row it is, already asked which Form or Call Lead it is, already asked whether this statement is newer, and already asked what that Lead should look like if we believed Granot. Now, only if we are about to write a matched Lead, turn that wish into the only patch we may `$set`. Keep Priority, quoted true, Job, receiver, current contact, move, and the Granot snapshot. Drop `last_granot_contact_change.changed_paths` — the command will stamp provenance if current contact actually moved. Drop last-accepted, ingestion, source, CPL, booked, cancelled, Vantage move size, and money. A Form Lead may name `destination_zip`; a Call Lead may name `delivery_zip`; the other ZIP name is a lie. Quoted may become true, never false. Hang the winning Observation beside the patch, not inside it. If the leftover is illegal, throw. Fingerprint the six contact leaves and this exact `{ Lead, revision, patch }` so a replay of the same Observation is the same command. Then stop. The command `$set`s, derives hashes, and advances the winner somewhere else.*

That is the operation. `toAuthorizedLeadDesiredState` is not. `planLeadDesiredState` is not this convert.

## Precise logic I would tighten while renaming

These are real smells the story names make obvious. Do not “just rename.”

1. **Convert already refuses; the command must still refuse.** `toAuthorizedLeadDesiredState` ends with `assertAuthorizedLeadDesiredState`. `processor.ts` calls convert, then assert again, then `synchronizeLeadFromGranot`, which asserts a third time at the door. That is defense at two **adapters**, not a duplicate to delete. Do not drop the command-door assert so “convert already checked,” and do not skip convert so “the command can take a raw plan.”

2. **Convert drops leftover planner notes; assert throws if they already sit on `set`.** Planner `last_granot_contact_change.changed_paths` is a known emit (see [granot-lifecycle-lead-desired-state.md](granot-lifecycle-lead-desired-state.md) smell 6). Convert `continue`s. A handmade `GranotAuthorizedLeadDesiredState` with that path on `set` throws. Do not start throwing from convert on planner leftovers so “one refuse shape wins,” and do not teach assert to `continue` so “the planner is allowed through.”

3. **A WordPress snapshot is not current contact.** `granot_contact_snapshot` is on the write allowlist and off `GRANOT_CONTACT_PATHS`. Convert keeps it on `changed_paths` and leaves `contact_changed_paths` empty. Sync only writes `last_granot_contact_change` / `granot_contact_revision` when contact leaves moved. Do not add the snapshot to `GRANOT_CONTACT_PATHS` so “every contact field hashes,” and do not strip the snapshot from the patch so “WordPress never stores Granot.”

4. **`quoted: false` is refused; the test that says “no write path sets it false” does not say that.** `quoted` is on `GRANOT_LEAD_WRITE_PATHS`. Assert throws on `false`. The AC-05 case is `assert.ok(!GRANOT_LEAD_WRITE_PATHS.includes("quoted" as never) || true)` — always true. Do not remove `quoted` from the allowlist so “the tautology wins,” and do not let convert emit `quoted: false` and skip assert so “the planner is trusted.”

5. **Both ZIP names are allowlisted; the Lead model is the real fence.** AC-11’s title says CallLead `delivery_zip` is “required instead.” Assert only forbids the *wrong* name. An empty CallLead patch is legal. Do not require a dest ZIP on every Call patch so “the title wins,” and do not drop `destination_zip` from the shared allowlist so “one ZIP name is enough.”

6. **The checksum test claims it omits contact values and never hashed any.** AC-32 builds `synchronizeLeadPayloadChecksum` from `desired()` (`granot_priority` / `quoted` only), then asserts the hex does not contain `5550001111`. The phone never entered the input. The contact-hash case above it is the real stability lock. Do not strip `set` from the checksum so “PII cannot be hashed,” and do not put raw phone on the idempotency key so “the test can see a value.”

7. **One Observation is one Lead-sync command.** `synchronizeLeadIdempotencyKey` ignores `lead_ref`. A later rematch of the same Observation to a different Lead still collides. Do not add the Lead id so “the key names the target,” and do not let two Observations share a key so “the Job is the command.”

8. **`temporal_winner` is beside `set`, never inside it.** `last_accepted_granot_observation` is forbidden on `set`. The command copies `temporal_winner` onto that Lead field. Do not put the stamp on `set` so “CAS is in the patch,” and do not drop `temporal_winner` so “the command can re-compare.”

9. **Receiver snapshot and `set_at` stay off this patch.** Knowledge says the command derives `receiver_agent_name_snapshot` / `receiver_agent_set_at` from the loaded Agent. Those paths are not on `GRANOT_LEAD_WRITE_PATHS`. Convert will never pass them through. Do not add them to the allowlist so “the patch is complete,” and do not hash the catalog name here so “receiver is contact.”

10. **`createLeadFromGranot` does not import this file.** Eligible create-if-missing returns an empty plan. Do not convert that empty plan so “created goes through the same patch,” and do not teach create to accept `GranotAuthorizedLeadDesiredState` so “one command input wins.”

11. **Leave sibling modules alone.** Field wants stay in `leadDesiredState.ts`. Clock order stays in `granotTemporal.ts`. Display masking stays in `leadContactProjection.ts`. Lead `$set`, snapshot `observation_id` / `differs_from_ingested`, and `last_accepted` stay in `synchronizeLeadFromGranot.ts`. Form/Call insert stays in `createLeadFromGranot.ts`. Gates stay in `sourcePolicy.ts`. ObjectId construction stays in `utils/objectId.ts`.

12. **Do not treat desired-state planning, matched-Lead writes, create-if-missing, or contact display as this story.** Those say what Granot wants, `$set` a Lead, insert a Lead, or mask a phone. This file only converts, refuses, and fingerprints.

13. **Do not write a whole-folder recommendation for `granotLifecycle`.**

## Testing

The **interface** is the test surface: `turnWhatThisObservationWantsIntoTheOnlyLeadPatchWeMayWrite` (today `toAuthorizedLeadDesiredState`), `refuseALeadPatchThatWouldWriteForbiddenOrLyingFields` (today `assertAuthorizedLeadDesiredState`), `fingerprintTheContactLeavesGranotMayChange` (today `hashGranotContactLeaves`), `fingerprintThisExactLeadWrite` / `nameThisObservationAsOneLeadWrite`. `TheOnlyLeadPatchWeMayWrite` is part of that **interface**.

Today’s `authorizedDesiredState.test.ts` already locks keeplisted Priority / quoted / move, stripped `last_granot_contact_change.changed_paths`, snapshot not a contact leaf, Form `destination_zip` vs Call `delivery_zip`, forbidden metadata, unsorted `changed_paths`, and a stable contact hash. Keep those. Add the gaps that name the operation:

**Turn what this Observation wants into the only Lead patch we may write**
- Planner leftover `last_granot_contact_change.changed_paths` is dropped, not thrown (already locked).
- A path on `changed_paths` with no `desired_values` key is dropped.
- `temporal_winner` is copied beside `set` and is not a `set` key.
- Convert then refuse: `quoted: false` from a plan throws (do not “fix” by omitting `quoted` from the allowlist).
- This function does not `$set` a Lead.

**Refuse a patch that would write forbidden or lying fields**
- Handmade `set` with a forbidden path throws (already locked).
- CallLead + `destination_zip` throws; CallLead with no dest ZIP does not (the title is “wrong name,” not “ZIP required”).
- `quoted: true` is allowed; `quoted: false` is not.
- Unsorted `changed_paths` throws even when the keys match `set` (already locked).
- The command may call this after convert; do not add a test that the third assert is skipped.

**Fingerprint this write so the same Observation does not apply twice**
- Contact hash is stable under key reorder (already locked).
- Checksum changes when `expected_domain_revision` or `set.quoted` changes (add this; today’s phone-absent hex check is not a fingerprint test).
- Idempotency key is `granot:synchronize-lead:${observationId}` and does not include `lead_ref` (already locked; keep it named as one Observation).
- Contact hash is not a display mask — do not assert `***` / `abcd…wxyz`.

Do **not** add a test per helper (`keepOnlyTheFieldsGranotMayWrite`, `quotedMayBeTrueNeverFalse`). Those names exist so the parent reads. If a helper test has to change when the helper is inlined, it was testing past the **interface**.

Do **not** re-test planner WordPress fences, Temporal `$or` filters, identity ladders, eight gates, or processor Decision persist here. Do not add a test that this file reads `writeGranotSourcePolicyCache`, inserts a Form Lead, or stamps `last_accepted_granot_observation`. Do not add a test that WordPress current `name` lands on `set` because Granot sent a different one — that is the planner’s refuse, and convert will happily keep a current-contact path if the plan emitted it.

## What I would not do

- An `AuthorizedDesiredStateService` class with `create` / `update` / `convert`.
- Thirty two-line functions that only wrap `WRITE_PATH_SET.has`.
- Moving this into a CRUD folder, or into `leadDesiredState.ts` / `processor.ts` / `synchronizeLeadFromGranot.ts` “for cleanliness.”
- Deleting the command-door assert because convert already called it.
- Adding `granot_contact_snapshot` to current-contact leaves so “every contact field hashes.”
- Requiring a dest ZIP on every Call patch because the AC-11 title says “required.”
- Putting `last_accepted_granot_observation` or receiver `set_at` on `set`.
- Teaching `createLeadFromGranot` to take this patch.
- Merging `projectRoleSafeLeadContacts` into this file because both mention contact.
- Writing a whole-folder recommendation for `granotLifecycle`.
