# Refresh The Call Lead From A Follow Up Row — operational story

- Status: recommended
- Service: `enrichment` (Wave A, in-progress)
- Pass: 1 of this service — `callLeadEnrichment.service.ts`
- Remaining in this service: `callLeadEnrichmentRows.ts`
- Target: `src/services/enrichment/callLeadEnrichment.service.ts`
- Knowledge: `docs/knowledge/services/enrichment.md`. Distinct from booked-jobs reconciliation: `docs/knowledge/services/booked-call-lead-reconciliation.md`. Distinct from Call writes: `docs/knowledge/services/call-lead.md`. Distinct from Owner receipt apply on the same URL: `docs/knowledge/granot-lifecycle/extension-apply.md`. Distinct from HTTP automation apply: `docs/knowledge/services/granot-http-collector.md` + `docs/knowledge/granot-lifecycle/automation-apply.md`. Source-fit yes/no already recommended: `recommendations/leads-call-lead-source-match.md`. Receiver stamp already recommended: `recommendations/agents-receiver-agent-crm-username.md`. This checkout’s `CONTEXT.md` does not define Call Lead Enrichment / Call Lead / Job Number / Sheet Sync — do not invent a glossary copy. `docs/adr/` is absent here — do not invent ADR copies.
- Callers: `routes/v1.routes.ts` `POST /api/v1/call-leads/enrichment/preview` (legacy barrel `callLeadEnrichment.service.ts`). `granotCrmCsv/sync.service.ts` `processFollowUpCallRow` (dry-run → preview; `--apply` → sync, no identity options). `granotHttpCollector/runWorkflow.ts` `planCallWorkflow` and `granotHttpCollector/automation.ts` `runGranotAutomation` preview mode (preview only; apply captures a receipt). Barrel: `enrichment/index.ts`. `extension-granot-apply.test.ts` only asserts `typeof syncCallLeadEnrichment === "function"` — not a caller. `POST /api/v1/call-leads/enrichment/sync` is `applyExtensionGranotItem` and does **not** import this file.
- Seams callers need: the per-row status card (preview never writes) vs CSV apply (write + Sheet Sync); persist-intent inside the Mongo write vs finalize after commit; the `/enrichment/sync` URL is a different story
- Split later (only if the file outgrows one sitting): keep one file — showing the refresh and applying it are one sitting. Never `preview.ts` / `sync.ts`, and never `create.ts` / `update.ts` / `delete.ts`

`previewCallLeadEnrichment` / `syncCallLeadEnrichment` / `resolveEnrichmentRow` are executor mechanics. The owner question is: *someone has Granot Follow Up rows. Which existing Call Lead would each row refresh, and may CSV write those diffs? This file never creates a Call Lead or a Booking. The extension URL that still says `/enrichment/sync` is Owner receipt apply, not this write.*

Booked-jobs reconciliation, ordinary Call create/correct, RingCentral ingest, any-clue Call lookup, and Granot lifecycle apply already live in other **modules**. Do not pull those in.

## What this file actually does

One story with two adapters, not “an enrichment CRUD service,” and not booked-jobs recon:

1. **Show what this Follow Up row would refresh on a Call Lead** — parse the CRM row (sibling). Invalid when neither a normalized phone nor a Job Number remains. Find by phone first (up to 25, newest, re-check exact digits in memory). Prefer not booked and not cancelled; if that pool is empty, use the booked/cancelled hits. Keep only source-compatible or unassigned Call Leads. None compatible → `conflict`. Several compatible → newest + warning. Unassigned match warns that apply will claim the CRM source. If phone found no compatible lead, try exact `job_no` (up to 5) with the same pool rules. A stored Job Number that differs from the row → warning; apply will not overwrite it. Diff contact / lane / source / cubic feet. Booked Call Leads can still be `updateable`. This adapter never mutates Mongo and never enqueues Sheet Sync.

2. **Refresh the Call Lead from this Follow Up row** — run the same match and diff. Leftover identity / receiver drift options throw and become `failed` when a caller passes them; CSV does not. Write only when the card is `updateable` or `unchanged` **and** there is a field update or a receiver stamp. `conflict` / `no_match` / `invalid` do not write. Stamp a receiver from `granot_crm_username` only on apply, after the match, via `applyGranotCrmUsernameReceiverMatch` (`already_linked` / `not_found` warn; `matched` copies the approved snapshots onto the re-read lead). Re-price only when the update includes `local` or `source_company`. Remember Sheet Sync (`call_lead.enrichment.sync`) **before** commit; project **after**. Status becomes `updated`. This adapter does not write phone or `move_date`.

There is no third create operation. `no_match` stays `no_match`.

## Organization

Keep one file. This is the screenplay for “refresh the Call Lead from a Follow Up row.” Row parse, source-fit yes/no, receiver stamp, CPL snapshot, and Sheet Sync already live in deeper **modules**. Do not pull those in. Do not invent a `CallLeadEnrichmentService` class. Do not invent a canonical-command `begin` / `complete` **seam** — CSV apply is the write **adapter**, not a Domain Command. Do not invent a Form-shaped `found` / `ambiguous` **seam** that has only one real adapter.

Do not split this ~700-line file into `preview.ts` and `sync.ts`. The write reuses the same match. Do not split “phone pick” vs “job pick” into two files. Do not move the pick into `callLeadSourceMatch.ts` “because enrichment is the only importer.”

**External interface** stays small (this is the test surface):

| Keep exporting | Story name | Why the seam exists |
|---|---|---|
| `previewCallLeadEnrichment` | `showWhatThisFollowUpRowWouldRefreshOnTheCallLead` | public POST preview + HTTP automation plan + CSV dry-run |
| `syncCallLeadEnrichment` | `refreshTheCallLeadFromThisFollowUpRow` | Granot CSV Follow Up `--apply` only |
| `CallLeadEnrichmentResult` | `FollowUpRowRefreshCard` | every caller branches on `status`, `call_lead_id`, `changes`, `warnings` |
| `CallLeadEnrichmentStatus` | `FollowUpRowRefreshStatus` | preview: `invalid` \| `no_match` \| `conflict` \| `updateable` \| `unchanged`; apply may add `updated` \| `failed` |
| `CallLeadMatchMethod` | `HowTheFollowUpRowFoundTheCallLead` | `phone_and_job_no` \| `phone_only` \| `job_no_only` \| `none` |

Keep the old names as one-line aliases until the v1 preview handler (via the leftover barrel), CSV Follow Up, HTTP automation plan, and `enrichment/index.ts` migrate. Do not make callers learn `$or` / `limit(25)` / `canWrite` as the domain language.

**No class for the workflow.** The type that *does* earn a name is the pending refresh bag:

```ts
type FollowUpRowRefreshInProgress = {
  result: FollowUpRowRefreshCard
  lead?: HydratedDocument<CallLeadDocument>
  update?: Partial<CallLeadDocument>
}
```

That is the handoff from “we matched and diffed” to “CSV may write and remember Sheet Sync.” Preview returns only `result`. Do **not** collapse this into a Domain Command pending bag so “every write looks like Form ingest.”

## The file, as a story

Parent functions stay deep. Child names are only extracted when they hide a real decision, not a one-liner.

```ts
// callLeadEnrichment.service.ts
// Someone has Granot Follow Up rows.
// Show which existing Call Lead each row would refresh.
// CSV may then write those diffs.
// Phone first, then Job Number.
// Assigned sources that disagree stop the row.
// A stored Job Number that differs is left as-is.
// Booked Call Leads can still refresh fields.
// This file does not create a Call Lead.
// This file does not book from a booked-jobs row.
// This file is not POST /call-leads/enrichment/sync.

// ── 1. Show what this Follow Up row would refresh ─────────

export async function showWhatThisFollowUpRowWouldRefreshOnTheCallLead(batch)

async function matchAndDiffTheFollowUpRow(row)     // today's resolveEnrichmentRow
function refuseWhenNeitherPhoneNorJobRemains(parsed)
async function findTheCallLeadForThisFollowUpRow(parsed)
async function findByTheNormalizedPhoneFirst(phone) // 25 newest; re-check exact digits
async function findByTheTypedJobNumberNext(jobNo)   // exact job_no; 5 newest
function preferOpenCallLeadsThenFallBack(candidates)
function keepSourceCompatibleOrUnassigned(pool, parsed)
function pickTheNewestEligibleCallLead(compatible)
function warnWhenClaimingAnUnassignedSource(lead, parsed)
function sentenceWhenNoEligibleSourceFits(matchType, parsed)
function leaveADisagreeingJobNumberAsIs(lead, parsed)
function diffTheFollowUpFieldsOntoTheCallLead(lead, parsed)
function sayWhetherABookingIsAlreadyAttached(method, booked, changeCount)

// ── 2. Refresh the Call Lead from this Follow Up row ──────

export async function refreshTheCallLeadFromThisFollowUpRow(batch, options)

function refuseWhenTheApprovedCallLeadDrifted(lead, options) // leftover; CSV omits
async function stampAReceiverFromTheCrmUsername(lead, username) // apply only
function refuseUnlessTheCardMayWrite(card, update, receiver)
async function writeTheRefreshAndRememberSheetSync(pending, receiver, options, job)
async function repriceIfLocalOrSourceChanged(lead, update)
function copyTheApprovedReceiverSnapshots(lead, approved)
async function projectTheCallLeadOntoSheetsAfterCommit(job)
function markTheCardUpdated(card, leadId, receiver)
```

Read the primary path out loud: *parse the Follow Up row. If there is no usable phone and no Job Number, the row is invalid. Look for the Call Lead by phone first. Keep source-compatible or unassigned leads; prefer open ones; take the newest. If phone found no fit, try the typed Job Number the same way. Assigned sources that disagree are a conflict. A stored Job Number that differs stays. Diff the CRM fields. Booked Call Leads can still refresh. Preview stops there. CSV apply re-reads the lead, stamps a receiver only when the existing one is empty, prices if local or source changed, writes Mongo, remembers Sheet Sync before commit, and projects after.*

That is the operation. `resolveEnrichmentRow` is not a different story. `/enrichment/sync` is not this write.

## Precise logic I would tighten while renaming

These are real smells the story names make obvious. Do not “just rename.”

1. **`POST /call-leads/enrichment/sync` is not this file.** The route calls `applyExtensionGranotItem` with `lead_snapshot_apply` items. Knowledge already says so. HTTP automation approved apply also must not call `syncCallLeadEnrichment`. CSV Follow Up `--apply` is the remaining write helper. Do not point the URL back at this function so the path “matches the name,” and do not delete `syncCallLeadEnrichment` so the route table “wins.”

2. **Identity / receiver drift options have no current caller.** `expectedCallLeadId`, `expectedUpdatedAt`, `expectedReceiverAgent`, and `targetReceiverAgent` still throw `failed` when passed. CSV `processFollowUpCallRow` calls `syncCallLeadEnrichment(payload)` with no options. Do not delete the guards so “CSV does not need them,” and do not wire the extension URL back through them so “preview approval is enforced.”

3. **Preview never stamps a receiver.** `showWhatThisFollowUpRowWouldRefreshOnTheCallLead` does not import `applyGranotCrmUsernameReceiverMatch`. Automation `planCallWorkflow` uses find elsewhere to bind `target_receiver_agent` when the Call Lead has none. Apply stamps after the match, mutates the hydrated lead in memory, then copies those snapshots onto the re-read document inside the write. Do not start stamping during preview so the preview lead is dirty, and do not skip the in-transaction copy so “the in-memory lead is already updated.”

4. **Phone first, then Job Number.** Phone candidates with no source-fit still fall through to exact `job_no`. Do not skip the job fallback so “phone miss is the whole answer,” and do not OR phone+job into one query so this file can reuse Call lookup.

5. **Job Number here is exact stored `job_no`.** Same as Call lookup and booked-from-source find. Identity / Granot use digit-core. Call browse contains. `P5562366` does not find `5562366`. Do not add `normalized_job_no` or `jobNumbersEquivalent` so “enrichment finds the Job.”

6. **A stored Job Number that differs is a warning, not `conflict`.** Apply leaves `job_no` as-is and may still write other fields. Source-fit disagreement is `conflict` and does not write. Do not promote the job mismatch to `conflict` so “every identity disagreement stops the row.”

7. **Booked Call Leads can still refresh.** The pick prefers open leads, then falls back to booked/cancelled. A booked lead with field diffs is `updateable`. This path never creates a Booking. Do not refuse booked rows so “enrichment only touches open leads,” and do not open booked-jobs reconciliation from a Follow Up row because `has_booking` is true.

8. **The second assigned-source sentence is after a compatible pick.** `selectSourceCompatibleCallLead` already kept only yes/unassigned. `buildAssignedSourceConflict` then runs again on the winner. After a compatible pick that sentence should stay silent. Do not delete the second call so “one conflict is enough” without a test, and do not move the pick into `callLeadSourceMatch.ts` in this pass — Wave A already recommended that module as yes/no, not the newest-eligible pick.

9. **Phone sieve here has a leading boundary.** `buildPhoneRegex` is `(?:^|\\D)…(?:\\D|$)`. The leads helper omits the leading boundary on purpose. Callers still re-check `normalizePhoneNumberForMatch` in memory. CONTRADICTIONS already has the four phone meanings. Do not import the tail-only sieve so “phone helpers match,” and do not extract this regex in this pass.

10. **This file does not write phone or `move_date`.** The row carries `phone`. The diff never assigns it. Do not add those keys so “the CRM row looks complete.”

11. **CPL runs only when `local` or `source_company` is in the update.** Unrelated field refreshes keep the snapshot. Do not reprice on every apply so “every write has a current CPL.”

12. **Sheet Sync intent is before commit; finalize is after.** `persistSheetSyncIntent` sits inside the transaction. `finalizeSheetSync` sits after. Do not move finalize inside the write, and do not skip persist when the card was `unchanged` but a receiver stamped — today’s `canWrite` already requires an update or a receiver change before the transaction starts.

13. **`unchanged` plus no receiver is not a write.** `canWrite` includes `unchanged`, then the next gate still requires `update` or `receiverMatch.changed`. The card stays `unchanged`, not `updated`. Do not force `updated` so “sync always means wrote.”

14. **`no_match` does not create.** Unknown phone/job stays `no_match` with the retention-window sentence. Book-This-Lead may create an unmatched stub. Do not insert a Call Lead here so “every Follow Up row has a home.”

15. **Leave sibling modules alone.** `parseEnrichmentRow` / `validateParsedRow` stay in `callLeadEnrichmentRows.ts` (next module). `isLeadSourceCompatible` / `buildAssignedSourceConflict` stay in `callLeadSourceMatch.ts`. `applyGranotCrmUsernameReceiverMatch` stays in `agents/`. `resolveLeadCplSnapshot` and Sheet Sync stay where they are. This file orchestrates parse → phone-then-job pick → source-fit → diff → (CSV) write + Sheet Sync.

16. **Do not treat booked-jobs recon or lifecycle apply as this story.** `previewBookedCallLeadReconciliation` is the next service. `applyExtensionGranotItem` is Wave A later. Do not write a whole-folder enrichment recommendation.

## Testing

The **interface** is the test surface: `showWhatThisFollowUpRowWouldRefreshOnTheCallLead` and `refreshTheCallLeadFromThisFollowUpRow` (today `previewCallLeadEnrichment` / `syncCallLeadEnrichment`). The per-row card (`status`, `call_lead_id`, `match_method`, `changes`, `warnings`) is part of that **interface**.

Today’s `callLeadEnrichment.service.test.ts` stubs `CallLead.find` for source-compatible phone pick, assigned-source `conflict`, sync no-write on that conflict, and unassigned claim. That is not enough for a story this long.

Replace the stub style with tests that name the operation:

**Show what this Follow Up row would refresh**
- No usable phone and no Job Number → `invalid`. No `CallLead.find`.
- Source-compatible phone among mixed companies → that Call Lead, `phone_only` when stored `job_no` differs or is empty, `changes` include `job_no` when the row brings one.
- Phone hits only a different assigned Source Company → `conflict`, no `call_lead_id`, empty `changes`. The job fallback still runs when a `job_no` is present — prove today’s fall-through, do not “fix” it into phone-only.
- Unassigned (`not_provided` / empty) phone match → `updateable`, `source_company` in `changes`, “Claiming unassigned …” warning.
- Several compatible phone hits → newest eligible + “selected newest …” warning.
- Phone miss, exact `job_no` hit → `job_no_only`. `P5562366` does **not** match `5562366`.
- Stored `job_no` differs from the row → warning; `job_no` is **not** in `changes`; other diffs may still be `updateable`.
- Booked Call Lead with field diffs → `updateable` and `has_booking: true`. Booked with no diffs → `unchanged`.
- Unknown phone and job → `no_match`. No insert.
- Preview never emits `updated` or `failed`. Preview does not call receiver stamp.

**Refresh the Call Lead from this Follow Up row**
- Assigned-source `conflict` → status stays `conflict`; no save; no Sheet Sync.
- `updateable` with diffs → transaction save, `persistSheetSyncIntent` before commit, `finalizeSheetSync` after, status `updated`.
- `unchanged` and no receiver change → no write; status stays `unchanged`.
- Receiver `matched` with no field diffs → write copies the approved snapshots; `changes` include `receiver_agent`; status `updated`.
- Receiver `already_linked` / `not_found` → warning; does not overwrite.
- `local` or `source_company` in the update → `resolveLeadCplSnapshot` runs. Name-only update does not.
- Passed `expectedCallLeadId` / `expectedUpdatedAt` mismatch → `failed`. CSV’s no-options path does not take this branch.
- Phone and `move_date` are not in the assigned update.

Do **not** add a test per helper (`findByTheNormalizedPhoneFirst`, `leaveADisagreeingJobNumberAsIs`). Those names exist so the parent reads. If a helper test has to change when the helper is inlined, it was testing past the **interface**.

Do **not** re-test `parseEnrichmentRow` placeholders, `isLeadSourceCompatible`’s OR-ladder, receiver-stamp unit cases, booked-jobs recon, or `applyExtensionGranotItem` here. Do not add a test that `POST /enrichment/sync` calls this file — it must not.

## What I would not do

- A `CallLeadEnrichmentService` class with `preview` / `sync` / `apply`.
- Thirty two-line functions that only wrap `assignIfChanged`.
- Moving this into a CRUD folder, or splitting `preview.ts` / `sync.ts` “for cleanliness.”
- Pointing `POST /call-leads/enrichment/sync` at `syncCallLeadEnrichment`, or deleting the CSV write so the route table “wins.”
- Teaching HTTP automation apply to call this write, or teaching this file to capture a Granot Observation Receipt.
- Creating a Call Lead on `no_match`, or opening booked-jobs reconciliation because the matched lead is booked.
- Importing the tail-only phone sieve, switching job find to digit-core, or refusing booked rows so “enrichment matches lookup / identity / open-only.”
- Stamping a receiver during preview, or repricing on every apply.
- Breaking the persist-intent / finalize **seam**.
- Pulling row parse, source-fit, or receiver stamp into this file.
- Writing a whole-folder recommendation for `enrichment`.
