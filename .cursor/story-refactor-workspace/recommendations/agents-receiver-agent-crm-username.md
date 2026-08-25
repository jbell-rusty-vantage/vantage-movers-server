# Stamp This Lead's Receiver From Granot's CRM Username — operational story

- Status: recommended
- Service: `agents` (Wave A, visited)
- Pass: 2 of this service — `receiverAgentCrmUsername.ts`
- Remaining in this service: none — `agentName.ts` and `index.ts` already skipped
- Target: `src/services/agents/receiverAgentCrmUsername.ts`
- Knowledge: `docs/knowledge/services/enrichment.md` (CSV Follow Up sync calls `applyGranotCrmUsernameReceiverMatch`; preview does not). Recon: `docs/knowledge/services/booked-call-lead-reconciliation.md` (same apply on sync; extra sheet job when the receiver changed). HTTP form planner: `docs/knowledge/services/granot-http-collector.md` (find + propose a patch; approved apply does **not** call this stamp). Lifecycle Agent assertion: `docs/knowledge/granot-lifecycle/identity.md` (**never** call `applyGranotCrmUsernameReceiverMatch`). Lifecycle fill: `docs/knowledge/granot-lifecycle/processor.md` / `desired-state.md` (`granot_username_match`, not this source). Binder stamp is the sibling file (`docs/knowledge/services/agent-allocation.md`). This checkout’s `CONTEXT.md` does not define Agent / receiver — do not invent a glossary copy. `docs/adr/` is absent here — do not invent ADR copies.
- Callers: `enrichment/callLeadEnrichment.service.ts` and `reconciliation/bookedCallLeadReconciliation.service.ts` (`apply` on sync only; persist copies the mutated snapshots onto a re-read Lead). `granotHttpCollector/formWorkflow.ts` (`find` + fold; builds its own five-field patch). `granotHttpCollector/runWorkflow.ts` (`find` + fold for `target_receiver_agent` when the Call Lead has none). Migrations import the fold. Barrel: **not** re-exported from `agents/index.ts`. Tests: `receiverAgentCrmUsername.test.ts`. Lifecycle `identity.ts` folds via Registry, not this file.
- Seams callers need: in-memory stamp vs the caller’s persist / transaction; `find` (preview / form plan / automation binding) vs `apply` (CSV sync write helper); `includeInactive` on find only; stored source stays `extension_crm_username_match`
- Split later (only if the file outgrows one sitting): keep one file — this is already one sitting. Never `create.ts` / `update.ts` / `delete.ts`

The names agree with the helper: `findAgentByGranotCrmUsername`, `applyGranotCrmUsernameReceiverMatch`. Those are executor mechanics. The owner question is: *Granot named a CRM user on this Follow Up or Booked Jobs row. If the Lead already has a receiver, leave them. If not, look up the catalog Agent that folded username belongs to and stamp that Agent as the receiver. Do not invent an Agent. Do not persist — the caller writes the Lead. Inactive Agents do not match on this path. The lifecycle processor is a different fill and stores `granot_username_match`.*

Who shares the Binder is `agentAllocation.service.ts`. Catalog create / rename is Registry. Form-lead PATCH that already has a `receiver_agent` id is not this file. Unit 14 Agent suggestion is not this file.

## What this file actually does

Two operations, not “a username helper,” and not Book This Lead’s Best Relocation receiver stamp:

1. **Find the Agent this CRM username names** — fold trim + uppercase. Blank → `undefined`. Look up `granot_identity.username` only (never the retained flat `granot_crm_username`). Active only unless `includeInactive`. Return the catalog item or `undefined`. Does **not** create, activate, or verify an Agent.
2. **Stamp this Lead’s receiver from that CRM username** — fold the raw username. Blank → `{ status: "empty", changed: false }`. Lead already has `receiver_agent` → `{ status: "already_linked" }`, no lookup, no overwrite. No active Agent → `{ status: "not_found" }` plus a message. Match → mutate the in-memory Lead (`receiver_agent`, name snapshot, source `extension_crm_username_match`, source value, `set_at`) and return `{ status: "matched", changed: true }`. Does **not** `save`.

There is no public HTTP path here. There is no command `begin` / `complete`. The **seam** is: this file decides and mutates; enrichment / recon persist inside their own transaction.

## Organization

Keep one file. This is the screenplay for “who answered in Granot, if the Lead has no receiver yet.” Binder split, catalog Registry writes, Form/Call correction by id, HTTP automation apply, and lifecycle identity / desired-state already live in deeper **modules**. Do not pull those in. Do not invent a `ReceiverAgentCrmUsernameService` class. Do not invent a persist **seam** — callers already own the write.

Do not split this 93-line file. Find and stamp are two **adapters** of one username story, not two folders. Form planner builds a patch because it must not dirty the live Lead; that is why it calls find instead of stamp.

**External interface** stays small (this is the test surface):

| Keep exporting | Story name | Why the seam exists |
|---|---|---|
| `normalizeGranotCrmUsername` | `foldThisGranotCrmUsername` | re-export of Registry fold; form planner, automation binding, and migrations already import it here |
| `findAgentByGranotCrmUsername` | `findTheAgentThisCrmUsernameNames` | preview / form plan / automation `target_receiver_agent` — lookup only |
| `applyGranotCrmUsernameReceiverMatch` | `stampThisLeadsReceiverFromThatCrmUsername` | CSV Follow Up / booked-jobs sync — mutate in memory, caller persists |
| `CRM_USERNAME_RECEIVER_SOURCE` | keep the stored enum string | `extension_crm_username_match` is what enrichment / recon / form patches write |

Keep the old names as one-line aliases until enrichment, recon, form planner, and run-workflow binding migrate. Do not make callers learn `apply` / `findAgent` as the domain language.

`findAgentByGranotCrmUsername` is already a one-line alias of Registry `resolveAgentByGranotUsername`. Keep that alias. Do not copy the `Agent.findOne` filter into this file.

**No class for the workflow.** The type that *does* earn a name is the discriminated result stamp already returns:

```ts
type ReceiverStampFromCrmUsername =
  | { status: "empty"; changed: false }
  | { status: "already_linked"; changed: false; username: string }
  | { status: "not_found"; changed: false; username: string; message: string }
  | {
      status: "matched"
      changed: true
      username: string
      agentId: string
      agentName: string
      active: boolean
      message: string
    }
```

That is the handoff from “here is a Granot user string” to “the caller may copy five fields onto a re-read Lead.” There is no after-commit bag: enrichment / recon finalize their own sheets.

The five fields a match writes should also be a named bag so form planner can propose them without mutating:

```ts
type ReceiverRememberedFromCrmUsername = {
  receiver_agent: string
  receiver_agent_name_snapshot: string
  receiver_agent_source: "extension_crm_username_match"
  receiver_agent_source_value: string
  receiver_agent_set_at: Date
}
```

## The file, as a story

Parent functions stay deep. Child names are only extracted when they hide a real decision, not a one-liner.

```ts
// receiverAgentCrmUsername.ts
// Granot named a CRM user on this row.
// If the Lead already has a receiver, leave them.
// If not, look up the catalog Agent that username belongs to.
// Do not invent an Agent.
// Do not persist — the caller writes the Lead.
// Inactive Agents do not match on this path.
// Lifecycle fill is the other source enum.

export { normalizeGranotCrmUsername as foldThisGranotCrmUsername }

export const CRM_USERNAME_RECEIVER_SOURCE = "extension_crm_username_match"

// ── 1. Find the Agent this CRM username names ─────────────

export async function findTheAgentThisCrmUsernameNames(value, options?)
  // Registry resolveAgentByGranotUsername
  // granot_identity.username only; active unless includeInactive

// ── 2. Stamp this Lead’s receiver from that CRM username ──

export async function stampThisLeadsReceiverFromThatCrmUsername(lead, rawUsername)
  // fold → empty
  // receiver already set → already_linked (no lookup)
  // find (active only) → not_found or mutate + matched

function proposeTheReceiverFields(agent, username)  // the five fields
function refuseToOverwriteAnExistingReceiver(lead)
```

Read the stamp path out loud: *Fold the username. No username, walk away. A receiver already on the Lead, walk away and say so — do not look the new name up. No active Agent for that username, warn and leave the Lead. Otherwise write the Agent id, the catalog name, “we matched a CRM username,” the folded username, and now. The caller saves.*

That is the operation. `applyGranotCrmUsernameReceiverMatch` is not.

## Precise logic I would tighten while renaming

These are real smells the story names make obvious. Do not “just rename.”

1. **Form planner copies the stamp.** `buildGranotFormPatch` folds `user || rep`, calls find, and pastes the five fields (ISO string `set_at`) when the Form Lead has no receiver. Stamp mutates a Lead and uses a `Date`. One `proposeTheReceiverFields`. Do not make the form planner dirty the live Lead so “both call apply.”

2. **Find is a pass-through.** Keep the alias. Do not reimplement `Agent.findOne` here, and do not add a second username index.

3. **Stamp folds, then find/Registry folds again.** Harmless. Do not “save a call” by skipping the Registry fold, and do not stop re-exporting the fold because stamp already imported it.

4. **Stamp never passes `includeInactive`.** The `Matched inactive Agent` clause in the message is unreachable from stamp. Find exposes the flag; no current runtime caller of this file passes it. Best Relocation inactive remember is the Binder file (`resolveAgentByName`). Do not default stamp to include inactive so a deactivated Granot user “still attributes.”

5. **Already-linked is any truthy `receiver_agent`.** Source and username are ignored. A Best Relocation stamp, a hand PATCH, or a lifecycle `granot_username_match` all block this fill. Knowledge already says `already_linked` warns and does not overwrite. Do not replace when the stored username differs “so Granot wins.”

6. **Stamp mutates the preview Lead, persist copies onto a re-read row.** Enrichment / recon call stamp **before** `canWrite` and **before** the transaction. On write they copy the five fields from `approvedLead` after identity / `updatedAt` / expected-receiver guards. Do not `save` inside stamp, and do not stamp the re-read document so “the helper owns persist.”

7. **Preview does not call stamp.** `previewCallLeadEnrichment` / `previewBookedCallLeadReconciliation` never import this file. Automation `runWorkflow` uses find only to bind `target_receiver_agent` when the Call Lead has none. Do not start stamping during preview so the preview Lead is dirty, and do not teach enrichment preview to call stamp “for symmetry.”

8. **HTTP automation apply must not call stamp.** Approved apply captures a receipt and enters `claimAndProcessOrPoll`. It must not call `syncCallLeadEnrichment`, `syncBookedCallLeadReconciliation`, or `updateFormLead`. CSV Follow Up / booked-jobs ingest is the remaining write helper that stamps. Do not route automation apply through stamp to “reuse the receiver story.”

9. **Lifecycle identity never calls stamp.** It folds via Registry, may suggest one active Agent matching `granot_identity.username` **or** compatibility `granot_crm_username`, and forbids this apply. Desired-state / `synchronizeLeadFromGranot` store `granot_username_match`. Do not call stamp from identity or the planner so “every Granot username fill is one function.”

10. **This find never reads the flat field.** Tests lock `{ "granot_identity.username": "JACOB", active: true }`. Identity still OR-matches `granot_crm_username`. Do not add the flat field to this filter so the two lookups “agree.”

11. **Stamp does not refuse Duplicate / Booked / Cancelled Leads.** Form-lead correction 409s `receiver_agent_source === "extension_crm_username_match"` on a Duplicate Form Lead. Eligibility is the caller (enrichment / recon status, form planner match). Do not hide Duplicate Leads here so “the helper matches Form PATCH.”

12. **Lookup is outside the caller’s session.** Registry `findOne` has no `session`. A deactivate between find and persist is what `expectedReceiverAgent` / `targetReceiverAgent` are for. Do not thread a Mongo session into find in this rename.

13. **Stored source string stays `extension_crm_username_match`.** The constant name says “extension.” Form planner and CSV sync still write it. Do not rename the persisted enum to `granot_username_match`, and do not write both.

14. **`user` vs `rep` is not this file.** Form planner prefers `user || rep`. Enrichment / recon pass `row.granot_crm_username` (collector maps `user` or `rep` earlier). Identity treats unequal nonempty user/rep as `agent_assertion: "conflict"` and suggests no Agent. Do not fold user/rep inside stamp so “the helper resolves Granot’s two columns.”

15. **Leave the Binder receiver stamp alone.** `receiverAttributionFromPrimaryAllocation` uses `best_relocation_sheet` and never calls this file. Do not call stamp from Book This Lead.

16. **Leave the barrel alone.** `agents/index.ts` is the allocation public surface. Callers already import this path. Do not re-export stamp from the barrel so “the folder has one door,” and do not move this file into `enrichment/` because CSV sync lives there.

## Testing

The **interface** is the test surface: `findTheAgentThisCrmUsernameNames`, `stampThisLeadsReceiverFromThatCrmUsername`. The fold is Registry’s; lock it here only as the re-export callers already use (`" mikem "` → `MIKEM`).

Today’s `receiverAgentCrmUsername.test.ts` stubs `Agent.findOne` and locks: stamp excludes inactive (`active: true` on `" mikem "`), find prefers `granot_identity.username`, find never reads the flat field, existing receiver → `already_linked` and **no** lookup. That is the right shape. Name the operations. Do not add a test per helper.

**Find the Agent this CRM username names**
- Folded username + `active: true` by default. Already locked — keep it.
- Never `{ granot_crm_username }`. Already locked — keep it.
- Blank / whitespace-only → `undefined`, **no** `findOne`.
- `includeInactive: true` omits the `active` clause (Registry behavior). No current runtime caller of this file passes it — one lock is enough. Do not re-test Registry create.

**Stamp this Lead’s receiver from that CRM username**
- Blank username → `empty`, Lead untouched, **no** lookup.
- Existing `receiver_agent` → `already_linked`, lookup skipped, snapshot untouched. Already locked — keep it.
- No active Agent → `not_found`, `changed: false`, Lead untouched. Already locked for the inactive-exclusion filter — keep it.
- Active match → mutates the five fields, `changed: true`, source `extension_crm_username_match`, `source_value` is the **folded** username, `set_at` is a `Date`. **No** `save`.
- A later different username on a Lead that now has a receiver → `already_linked` (do not overwrite).
- Does **not** insert an Agent.

Do **not** add a test per helper (`proposeTheReceiverFields`). Those names exist so the parent reads. If a helper test has to change when the helper is inlined, it was testing past the **interface**.

Do not re-test enrichment preview status, recon `$setOnInsert`, HTTP automation apply / receipt capture, lifecycle identity user/rep conflict, or Best Relocation Binder stamp.

## What I would not do

- A `ReceiverAgentCrmUsernameService` class with `create` / `update` / `delete`.
- Thirty two-line functions that only wrap `resolveAgentByGranotUsername`.
- Moving this into a CRUD folder “for cleanliness.”
- Inventing a before-commit / after-commit **seam** this helper does not own.
- Saving inside stamp, or stamping during preview so the preview Lead is dirty.
- Routing lifecycle identity / desired-state / HTTP automation apply through stamp.
- Teaching find to read `granot_crm_username`, or teaching stamp to overwrite, or defaulting stamp to inactive.
- Renaming the stored source to `granot_username_match`.
- Pulling Binder allocation, catalog Registry writes, or Form/Call PATCH-by-id into this file.
- Writing a whole-folder `agents` recommendation in this pass.
