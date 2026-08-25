# Name Who Shares This Booking's Binder — operational story

- Status: recommended
- Service: `agents` (Wave A, in-progress)
- Pass: 1 of this service — `agentAllocation.service.ts`
- Remaining in this service: `receiverAgentCrmUsername.ts`
- Target: `src/services/agents/agentAllocation.service.ts`
- Knowledge: `docs/knowledge/services/agent-allocation.md` (name resolve, even-cent Binder split, snapshot on the Booking). Booking callers are also in `docs/knowledge/services/bookings.md`. Owner-id split: `docs/granot-lead-lifecycle/owner-booking-intake-and-lead-attachment-specification.md` §5. Cancellation snapshot: `docs/knowledge/services/cancelled-lead.md`. Catalog lookup: `docs/knowledge/services/catalog.md`. This checkout’s `CONTEXT.md` does not define Agent / Binder / Agent Allocation — do not invent a glossary copy. `docs/adr/` is absent here — do not invent ADR copies.
- Callers: `bookedLead.service.ts` (`resolve` / `patch` / `agree total` / Best Relocation receiver stamp), `bookedLeadFromSource.service.ts` (form-name derive only), `referralBooking.service.ts` / `leadlessBooking.service.ts` / `employeeBookings/employeeBookingPreparation.ts` (derive then resolve), `cancelledLead.service.ts` (`primaryAgentName`), `granotLifecycle/{bookingConfirmation,bookingOwnerCommands,referralBooking,releaseOwnerCommands}.ts` and `domainCommands/bookings.ts` (Owner ids). Barrel: `agents/index.ts`. Tests: `agentAllocation.service.test.ts`.
- Seams callers need: form-name derive vs Owner-id official; catalog remember stays **outside** the Booking transaction; `includeInactive` is Best Relocation only; `officialBookingAgentIds` so Owner commands can load active catalog rows **inside** their own transaction; patch vs replace (replace lives in Book This Lead)
- Split later (only if the file outgrows one sitting): keep one file — this is already one sitting. Never `create.ts` / `update.ts` / `delete.ts`

Knowledge still titles this “Resolve agent names, split binder credit, and snapshot allocations.” The names agree: `deriveBookedLeadAgentAllocations`, `resolveAgentAllocations`, `officialBookingAllocations`. Those are executor mechanics. The owner question is: *this job is booked. Who shares the Binder, and how much does each get? A form names one Agent and maybe a split. The Owner command sends ids. Leftover cents go to the primary. Look names up in the catalog — do not invent Agents. The first Agent is the one Cancellation copies. Best Relocation may stamp that first Agent as the Lead's receiver only if the Lead has none.*

Matching a receiver by Granot CRM username is `receiverAgentCrmUsername.ts`. Catalog create/rename is `catalog` / Registry. Book This Lead, from-source, Referral, Leadless, and Owner confirm are not this file — they call these beats.

## What this file actually does

Eight operations, not “an allocation helper,” and not Book This Lead:

1. **Split this Binder evenly** — integer cents. One Agent keeps the whole Binder. Two Agents: secondary gets `floor(total_cents / 2)`; primary gets the remainder (`$100.01` → `$50.01` / `$50.00`).
2. **Name the Agents on this booked-from-source form** — trim / collapse `agent` and optional `split_agent`. Same folded name → 400. No split → one allocation for the full Binder. Split → two allocations, primary first.
3. **Name the Agents the Owner picked** — `[primary]` or `[primary, secondary]` ids, then the same even split. No catalog lookup here. No submitted-total check here.
4. **Remember each named Agent on the Booking** — trim, refuse two names that fold to the same string, `resolveAgentByName` (active unless `includeInactive`). Store catalog id, catalog `name` snapshot, Binder share. Does **not** create an Agent.
5. **Patch who still shares this Binder** — merge incoming onto existing by Agent id. Agents the request omitted survive. Replace is Book This Lead’s `agent_allocation_mode === "replace"`.
6. **Agree the total Binder** — sum the shares. Submitted total must match within `0.001` or 400. Return the submitted total when present, else the sum.
7. **Name the primary Agent for the Cancellation** — `agent_allocations[0].agent_name_snapshot` or `""`.
8. **Stamp the Best Relocation receiver from the primary allocation** — only when the Lead has no `receiver_agent` yet. Source enum is `best_relocation_sheet`.

## Organization

Keep one file. This is the screenplay for “who shares this Binder.” Book This Lead, from-source, Owner commands, catalog Registry, name fold, CRM-username receiver match, and zero-Binder warnings already live in deeper **modules**. Do not pull those in. Do not invent an `AgentAllocationService` class. Do not invent a `begin` / `complete` **seam** — this file is the beat those writers already call.

Do not split this 205-line file. Form names and Owner ids are two **adapters** of one split, not two folders.

**External interface** stays small (this is the test surface):

| Keep exporting | Story name | Why the seam exists |
|---|---|---|
| `splitBinderEvenly` | `splitThisBinderEvenly` | shared cents math; form and Owner both need it |
| `deriveBookedLeadAgentAllocations` | `nameTheAgentsOnThisBookedFromSourceForm` | from-source / Referral / Leadless / employee names |
| `officialBookingAgentIds` | `listTheOwnerPickedAgentIds` | Owner commands load active catalog rows by id in their txn |
| `officialBookingAllocations` | `nameTheAgentsTheOwnerPicked` | Owner adapter; no names, no catalog lookup here |
| `resolveAgentAllocations` | `rememberEachNamedAgentOnTheBooking` | must stay outside the Booking write; `includeInactive` is BR |
| `patchAgentAllocations` | `patchWhoStillSharesThisBinder` | update `patch`; replace lives in Book This Lead |
| `resolveTotalBinderAmount` | `agreeTheTotalBinder` | submitted total must match the sum |
| `primaryAgentName` | `nameThePrimaryAgentForTheCancellation` | Cancellation snapshot |
| `receiverAttributionFromPrimaryAllocation` | `stampTheBestRelocationReceiverFromThePrimaryAllocation` | BR only; never overwrite |

Keep the old names as one-line aliases until Book This Lead, from-source, Referral, Leadless, employee prepare, Cancellation, and the Owner commands migrate. Do not make callers learn `derive` / `resolve` as the domain language.

**No class for the workflow.** The one type that *does* earn a name is the document-ready row already stored on the Booking:

```ts
type AgentRememberedOnThisBooking = {
  agent: mongoose.Types.ObjectId
  agent_name_snapshot: string
  binder_amount: number
}
```

That is the handoff from “here is a name or an id and a Binder share” to “the Booking can persist it.” There is no after-commit bag: Book This Lead and Owner commands finalize their own sheets.

## The file, as a story

Parent functions stay deep. Child names are only extracted when they hide a real decision, not a one-liner.

```ts
// agentAllocation.service.ts
// This job is booked.
// Who shares the Binder, and how much does each get?
// A form names one Agent and maybe a split.
// The Owner command sends ids.
// Leftover cents go to the primary.
// Look names up in the catalog — do not invent Agents.
// The first Agent is the one Cancellation copies.
// Best Relocation may stamp that first Agent as
// the Lead's receiver only if the Lead has none.
// Matching a receiver by Granot CRM username is the other file.

// ── 1. Split this Binder evenly ───────────────────────────

export function splitThisBinderEvenly(total, agentCount: 1 | 2)
  // integer cents; leftover cent to the primary

// ── 2. Name the Agents on this booked-from-source form ────

export function nameTheAgentsOnThisBookedFromSourceForm(input)

function trimTheFormAgentNames(agent, splitAgent)
function refuseASplitThatIsTheSamePerson(agent, splitAgent)
  // 400: "split_agent must be different from agent"

// ── 3. Name the Agents the Owner picked ───────────────────

export function listTheOwnerPickedAgentIds(details)
export function nameTheAgentsTheOwnerPicked(details)
  // no catalog lookup; callers load active Agents by id in their txn

// ── 4. Remember each named Agent on the Booking ───────────

export async function rememberEachNamedAgentOnTheBooking(allocations, options?)

function refuseDuplicateAgentNamesInThisList(name, seen)
  // 400: `Duplicate agent allocation for "${name}"`
async function lookTheAgentUpInTheCatalog(name, options)
  // resolveAgentByName — does not create
  // includeInactive only Best Relocation

// ── 5. Patch who still shares this Binder ─────────────────

export function patchWhoStillSharesThisBinder(existing, incoming)
  // merge by agent id; omitted Agents survive

// ── 6. Agree the total Binder ─────────────────────────────

export function agreeTheTotalBinder(allocations, submitted?)
  // 400 when |sum - submitted| >= 0.001

// ── 7. Name the primary Agent for the Cancellation ────────

export function nameThePrimaryAgentForTheCancellation(booking)
  // allocations[0].agent_name_snapshot ?? ""

// ── 8. Stamp the Best Relocation receiver from the primary ─

export function stampTheBestRelocationReceiverFromThePrimaryAllocation(
  allocations, sourceValue, setAt?, existingReceiver?,
)
  // undefined if the Lead already has a receiver, or no allocations
```

Read the form path out loud: *Trim the form names. Refuse a split that is the same person. Split the Binder in cents with leftover to the primary. Then, still outside the Booking write, look each name up in the catalog — do not create an Agent — refuse two names that fold to the same string, and store the catalog id, the catalog's own name, and that Agent's Binder share. If the owner submitted a total, it must match the sum. Best Relocation may also stamp the first Agent as the Lead's receiver, but only when the Lead has none.*

Read the Owner path out loud: *The Owner sends one Binder and at most two Agent ids. List those ids so the command can load active catalog rows inside its own transaction. Split the same leftover-cent way. This file never looks the ids up and never agrees a submitted total — the command already owns the official total.*

That is the operation. `deriveBookedLeadAgentAllocations` is not.

## Precise logic I would tighten while renaming

These are real smells the story names make obvious. Do not “just rename.”

1. **This file does not upsert Agents.** Book This Lead still comments “Agent allocations upsert reference `agents`.” Knowledge already says there is no `upsertAgentByName` here: ordinary lookup 400s `Unknown or inactive agent`; Best Relocation 400s `Unknown agent`. Rename so the gap is visible. Do **not** silently teach remember to create an Agent “because the comment still says upsert.”

2. **Form names and Owner ids are two adapters, not one function.** `nameTheAgentsOnThisBookedFromSourceForm` returns `{ agent_name, binder_amount }` and needs remember. `nameTheAgentsTheOwnerPicked` returns `{ agent_id, binder_amount }` and the command loads names itself, **inside** its transaction, active only. Do not route Owner confirm through remember so “every Booking resolves the same way,” and do not move Owner catalog load into this file.

3. **Owner commands never call `agreeTheTotalBinder`.** They persist `official_booking_details.total_binder_amount` (then re-cent). Public Book This Lead does call agree. Do not add the 0.001 check to the Owner adapter so the two paths “share a total.”

4. **Duplicate check is folded name, not catalog id.** `"Alex"` and an alias that resolves to the same Agent both pass the name set and can store two rows with one id. Do **not** silently also key by id “so the list cannot double-count.” Lock the name-only rule until a separate change.

5. **Remember is sequential and stays outside the Booking write.** One catalog lookup per allocation, then Book This Lead opens `runSheetSyncWrite`. Owner load is the opposite: inside the command session. Do not `Promise.all` the loop, and do not pass the Booking session into remember, while renaming.

6. **`includeInactive` is Best Relocation only.** From-source / Leadless import pass it. Referral, employee prepare, and public `POST /booked-leads` do not. Owner id load never accepts inactive. Do not default remember to include inactive so historical rows “just book.”

7. **Patch does not replace.** `agent_allocation_mode === "replace"` is Book This Lead. This file only merges. Booking-update warnings use the **incoming** resolved list, not the merged result (`bookings-booked-lead.md`). Do not move replace or warning build here.

8. **Referral / Leadless cannot patch allocations.** Book This Lead 409s those edits before it would call patch. Do not teach patch to refuse Referral so “the fence lives with the merge.”

9. **Primary for Cancellation is snapshot[0], not a live catalog read.** Empty list → `""` (schema says the list cannot be empty). Do not look up `Agent` by id so a rename “shows on the Cancellation.”

10. **Best Relocation receiver stamp does not overwrite.** Existing `receiver_agent` → `undefined`. CRM-username match is the other file and uses `extension_crm_username_match`. Do not call that matcher from this stamp, and do not stamp receiver on non-BR Book This Lead.

11. **A second `normalizeAgentName` lives in Best Relocation sheet parsing.** Do not merge the ingest fold into `agentName.ts` so “every Agent string uses one helper.” That parser’s empty-cell `undefined` is a different **seam**.

12. **Zod already checks binder totals on HTTP create/update.** `agreeTheTotalBinder` is the service lock after resolve / patch. Do not delete it because the schema “already did that,” and do not re-test the Zod refine here.

13. **Leave sibling modules alone.** `normalizeAgentName`, `resolveAgentByName`, `buildBookedLeadWarnings`, Book This Lead, from-source, Owner confirm / update / referral / Release update, and `receiverAgentCrmUsername.ts` stay where they are. This file orchestrates the split and the name remember.

14. **Do not treat catalog admin write as this story.** `createOrUpdateAgent` is Registry, owner-gated. Historical repair scripts may still upsert on their own.

## Testing

The **interface** is the test surface: `splitThisBinderEvenly`, `nameTheAgentsOnThisBookedFromSourceForm`, `nameTheAgentsTheOwnerPicked`, `rememberEachNamedAgentOnTheBooking`, `patchWhoStillSharesThisBinder`, `agreeTheTotalBinder`, `nameThePrimaryAgentForTheCancellation`, `stampTheBestRelocationReceiverFromThePrimaryAllocation`.

Today’s `agentAllocation.service.test.ts` locks even-cent `$100.01` → `$50.01` / `$50.00` for split / derive / official, inactive remember + alias filter, and receiver stamp / no-overwrite. That is not enough for the refuse and agree stories. Add tests that name the operation. Do not add a test per helper.

**Split this Binder evenly**
- One Agent keeps the full amount (including the cent-round trip).
- Two Agents: leftover cent to the primary (`$100.01` → `$50.01` / `$50.00`). Already locked — keep it.

**Name the Agents on this booked-from-source form**
- No split → one allocation, full Binder, display casing preserved.
- Split → primary first, even cents.
- Folded `split_agent === agent` → 400 `split_agent must be different from agent`.
- Internal whitespace collapses; casing is not folded on the stored display name.

**Name the Agents the Owner picked**
- One id → one share equal to the official total.
- Two ids → same leftover-cent split. Already locked — keep it.
- This function does **not** load `Agent` or 400 inactive. Do not add a catalog stub here.

**Remember each named Agent on the Booking**
- Active name / alias → id + catalog `name` snapshot + Binder share. Already locked for inactive + alias.
- Two names that fold to the same string → 400, second lookup never runs.
- Default options 400 on inactive (`Unknown or inactive agent`). `includeInactive: true` 400 only when missing (`Unknown agent`). Stub `resolveAgentByName` / `Agent.findOne`; do not re-test Registry create.
- Does **not** insert an Agent.

**Patch who still shares this Binder**
- Incoming id replaces that row; omitted existing ids survive; new ids append (existing-first map order).

**Agree the total Binder**
- No submitted total → return the sum.
- Submitted within `0.001` → return the submitted number, not the sum.
- Disagreement ≥ `0.001` → 400 `total_binder_amount must equal the sum of agent binder amounts`.

**Name the primary Agent for the Cancellation**
- `[0].agent_name_snapshot`. Empty list → `""`.

**Stamp the Best Relocation receiver from the primary allocation**
- No existing receiver → first allocation, source `best_relocation_sheet`. Already locked — keep it.
- Existing receiver → `undefined`, Lead fields untouched. Already locked — keep it.

Do **not** add a test per helper (`refuseASplitThatIsTheSamePerson`). Those names exist so the parent reads. If a helper test has to change when the helper is inlined, it was testing past the **interface**.

Do not re-test Book This Lead ignore / rebook / insert, Owner Record Link CAS, Referral / Leadless 409 on allocation edit, or CRM-username receiver match here.

## What I would not do

- An `AgentAllocationService` class with `create` / `update` / `delete`.
- Thirty two-line functions that only wrap `splitBinderEvenly` or `resolveAgentByName`.
- Moving this into a CRUD folder “for cleanliness.”
- Inventing a before-commit / after-commit **seam** this beat does not own.
- Teaching remember to create an Agent, or teaching Owner official to go through remember, so the names “feel honest.”
- Pulling `receiverAgentCrmUsername.ts`, catalog Registry writes, Book This Lead, or Best Relocation sheet parsing into this file.
- Writing a whole-folder `agents` recommendation in this pass.
- Silently merging form-name and Owner-id adapters, or moving replace / warning build out of Book This Lead.
