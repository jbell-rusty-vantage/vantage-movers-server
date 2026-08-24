# Lead Ingestion Provenance — operational story

- Status: recommended
- Service: `leads` (Wave A, in-progress)
- Pass: 4 of this service — `leadIngestionProvenance.ts`
- Remaining in this service: `leadSourceCompany.ts`, `leadCplResolution.ts`, `leadLocation.service.ts`, `leadName.service.ts`, `leadPhoneMatching.ts`, `sourceLeadLookup.service.ts`, `callLeadSourceMatch.ts`, `leadSourceCompatibility.ts`
- Target: `src/services/leads/leadIngestionProvenance.ts`
- Knowledge: `docs/knowledge/services/form-lead.md` (Ingestion Origin + immutable creation evidence), `docs/knowledge/services/call-lead.md` (same + Call `quoted=false`), `docs/knowledge/services/domain-commands.md` (adapters derive origin; clients cannot supply it). No dedicated Service file for this module. This checkout’s `CONTEXT.md` does not define Ingestion Origin — do not invent a glossary copy.
- Callers: `domainCommands/existingWrites.ts` (derive), `formLead.service.ts` (stamp + strip), `callLead.service.ts` (stamp + strip), `leads/leadProvenance.replica.test.ts` (Form stamp)
- Seams callers need: assign origin from command (Form uses actor; Call accepts RingCentral) vs stamp already-decided origin; Form evidence (contact + move + Job) vs Call evidence (contact + `quoted=false`); strip on correction so origin/snapshots cannot be rewritten
- Split later (only if the file outgrows one sitting): `assignLeadIngestionOrigin.ts`, `stampLeadCreationEvidence.ts` — never `create.ts` / `update.ts` / `delete.ts`

## What this file actually does

Three operations that share one promise, not “provenance helpers”:

1. **Assign trusted Ingestion Origin** — a Form or Call create may not guess how it arrived. Map the command origin (and, for Form, the actor) onto a stampable origin, or refuse. Clients cannot supply `ingestion_origin`.
2. **Stamp immutable creation evidence** — at the trusted `now`, remember the contact (and for Form, the move and optional Job Number) and mark the evidence `captured_at_ingestion`. A Call is also forced `quoted: false`.
3. **Keep later edits from rewriting that story** — a public or admin patch is stripped of origin, snapshots, Granot/revision metadata, and `normalized_job_no` before it touches the live Lead.

`derive*` / `assert*` / `build*` / `*CreationProvenanceFields` are executor mechanics. The owner question is: *who brought this Lead, what did we know then, and can a later Form Edit change that?*

`createLeadFromGranot` is not this file. It stamps `granot_lead_created` through trusted validators. Historical `legacy_unknown` / `legacy_baseline` is a migration story, not a create path.

## Organization

Keep one file. This is the screenplay for “remember how the Lead arrived.” Phone normalization, Job Number normalize, assignable-origin lists, and forbidden-field lists already live in deeper **modules**. Do not pull `formLead.service`, `callLead.service`, `createLeadFromGranot`, or the Lead provenance migration in. Do not invent a `LeadIngestionProvenanceService` class.

If it later outgrows one sitting, split by **story** (assign vs stamp), not by Form vs Call folders.

**External interface** stays small (this is the test surface):

| Keep exporting | Story name | Why the seam exists |
|---|---|---|
| `deriveFormLeadIngestionOrigin` | `assignFormLeadIngestionOrigin` | canonical Form create needs origin from command + actor, not the client |
| `deriveCallLeadIngestionOrigin` | `assignCallLeadIngestionOrigin` | same for Call; RingCentral is a real command origin here |
| `formLeadCreationProvenanceFields` | `stampFormLeadCreationEvidence` | Form ingest writes origin + contact/move snapshots + Job in the same create |
| `callLeadCreationProvenanceFields` | `stampCallLeadCreationEvidence` | Call ingest writes origin + contact snapshot + `quoted=false` |
| `omitForbiddenLeadLifecycleFields` | `stripForbiddenLeadLifecycleFields` | correction must not rewrite origin, snapshots, or revision |

Keep the old names as one-line aliases until `existingWrites`, Form/Call ingest, and the replica test migrate. Do not make callers learn `Fields` or `omit` as the domain language.

`assertAssignableFormLeadIngestionOrigin` / `assertAssignableCallLeadIngestionOrigin` stay as children of stamp. Un-export them. Callers never imported them.

`buildIngestedContactSnapshot` / `buildIngestedMoveSnapshot` stay as children of stamp. They are not a second **interface**. Tests go through stamp.

**No class for the workflow.** The types that *do* earn names are the trusted origin and the captured-at-ingestion bags:

```ts
type TrustedFormLeadIngestionOrigin = AssignableFormLeadIngestionOrigin
type TrustedCallLeadIngestionOrigin = AssignableCallLeadIngestionOrigin
type ContactAsArrived = IngestedContactSnapshot   // evidence_status: "captured_at_ingestion"
type MoveAsArrived = IngestedMoveSnapshot
```

`legacy_unknown` and `legacy_baseline` are not these types. The model already refuses them on a new row.

## The file, as a story

Parent functions stay deep. Child names are only extracted when they hide a real decision, not a one-liner.

```ts
// leadIngestionProvenance.ts
// When a Lead is born, write down who brought it and what we knew then.
// A later Form Edit or Call Edit cannot change that story.

// ── 1. Assign trusted Ingestion Origin ────────────────────

export function assignFormLeadIngestionOrigin(command)
export function assignCallLeadIngestionOrigin(command)

function aBestRelocationSheetIsASheetOrigin()
function aGranotLifecycleCommandIsGranotCreated()
function anOwnerOrAdminActingThroughAdminIsAdmin()
function aPublicApiSecretIsStillAWordPressQuote()  // vantage_admin + system/undefined
function aMissingCommandIsAWordPressQuote()        // Form only
function aMissingCommandIsAnAdminCall()            // Call only
function aRingCentralCommandIsARingCentralCall()   // Call only; Form refuses
function refuseAnUnprovenCreatePath()

// ── 2. Stamp immutable creation evidence ──────────────────

export function stampFormLeadCreationEvidence(origin, now, contact, move, jobNo?)
export function stampCallLeadCreationEvidence(origin, now, contact)

function refuseAMigrationOnlyOrigin()              // legacy_unknown
function rememberTheContactAsArrived(contact, now) // trim, lower email, normalize phone
function rememberTheMoveAsArrived(move, now)       // Form only
function rememberTheJobNumberIfPresent(jobNo)      // Form only; normalizeJobNo
function forceTheCallUnquoted()                    // Call only

// ── 3. Keep later edits from rewriting that story ─────────

export function stripForbiddenLeadLifecycleFields(patch)
```

Read the Form path out loud: *look at how the command arrived. A Best Relocation sheet is a sheet origin. A Granot lifecycle command is Granot-created. An owner or admin acting through vantage_admin is admin. A public API secret is still a WordPress quote. If we have never proven this path — RingCentral creating a Form Lead, an employee actor, a future origin — refuse. Then remember the contact and the move at the trusted now, mark the evidence captured at ingestion, and keep the Job Number if one was already known. Later, when someone patches the Lead, strip origin, snapshots, and revision so that arrival story cannot be rewritten.*

That is the operation. `formLeadCreationProvenanceFields` is not.

## Precise logic I would tighten while renaming

These are real smells the story names make obvious. Do not “just rename.”

1. **The export names are mechanics.** `derive`, `assert`, `build`, `*Fields`, `omit` say how the file is wired, not what the owner is protecting. Rename to assign / stamp / strip.

2. **`assertAssignable*` is exported and unused outside this file.** Stamp already refuses `legacy_unknown`. Un-export. Do not add a second public refuse **seam**.

3. **`buildIngested*` are children, not an interface.** The unit test calls `buildIngestedContactSnapshot({}, now)` to prove empty evidence status. Point that assertion at stamp.

4. **Form `vantage_admin` + system/undefined actor → `wordpress_form` is a decision, not a bug.** Public WordPress create goes through `existingWrites` with `vantage_admin` provenance (API secret). Name the beat `aPublicApiSecretIsStillAWordPressQuote`. Do not “fix” it to `vantage_admin`.

5. **The empty-command defaults disagree on purpose.** Form `{}` → `wordpress_form`. Call `{}` → `vantage_admin`. Public `createFormLead` hardcodes WordPress; public `createCallLead` hardcodes admin. Do not collapse the defaults.

6. **Form refuses `ringcentral`; Call accepts it.** Name both. Do not add a Form RingCentral origin “for symmetry.”

7. **`legacy_import` is assignable on Call and unused by assign.** Stamp would accept it. Do not invent an assign branch. Historical import is not this pass.

8. **`createLeadFromGranot` does not call this file.** Trusted validators stamp `granot_lead_created` and force `post_to_granot=false`. Assign *would* map `granot_lifecycle` → `granot_lead_created`, but that adapter is unused for Granot create. Do not pull the command in. Do not silently route Granot create through `existingWrites`.

9. **RingCentral ingest hardcodes `origin: "ringcentral"`** instead of calling assign. That is the RingCentral **adapter**, not a missing derive. Leave it. Nested `ringcentral.ingestion_source` is transport provenance and is not Ingestion Origin.

10. **`job_no` is stampable on Form create; `normalized_job_no` is stripped on edit; raw `job_no` is not in the omit list.** Later Granot sync may fill a Job Number. Do not add `job_no` to the strip list “for consistency.”

11. **Form/Call service tests re-run AC-10 / AC-12.** Keep the proof on this **interface**. Ingest tests should prove they call stamp with the origin they chose, not re-implement the map.

12. **Leave sibling modules and the migration alone.** `normalizePhoneNumberForMatch`, `normalizeJobNo`, `ASSIGNABLE_*`, `PUBLIC_LEAD_FORBIDDEN_LIFECYCLE_FIELDS`, and the `legacy_unknown` / `legacy_baseline` backfill stay at their current **depth**. Do not move assignable lists into this file “for cleanliness.”

## Testing

The **interface** is the test surface: `assignFormLeadIngestionOrigin`, `assignCallLeadIngestionOrigin`, `stampFormLeadCreationEvidence`, `stampCallLeadCreationEvidence`, `stripForbiddenLeadLifecycleFields`.

Today’s `leadIngestionProvenance.test.ts` already names the ACs (trusted entry points, snapshots with trusted `now`, Call `quoted=false`, strip). Keep that style. Fill the gaps the story names make obvious:

**Assign Form origin**
- `{}` and `vantage_admin` + system/undefined actor → `wordpress_form`.
- `vantage_admin` + owner or admin → `vantage_admin`.
- `external_sheet_ingestion` → `best_relocation_sheet`.
- `granot_lifecycle` → `granot_lead_created`.
- `ringcentral` → throws (unproven Form path).
- `vantage_admin` + employee → throws (today’s code falls through to refuse; lock it).

**Assign Call origin**
- `{}` and `vantage_admin` → `vantage_admin`.
- `ringcentral` → `ringcentral`.
- `external_sheet_ingestion` → `best_relocation_sheet`.
- `granot_lifecycle` → `granot_lead_created`.
- A future/unknown command origin → throws.

**Stamp Form evidence**
- Assignable origin is copied; `legacy_unknown` throws.
- Contact: trim, lowercased email, normalized phone, `captured_at` is the trusted `now`, `evidence_status: "captured_at_ingestion"`.
- Move: same `now` / status; blank strings become absent.
- `job_no` is trimmed; `normalized_job_no` uses `normalizeJobNo`.
- Blank contact/move still stamps captured-at-ingestion bags (empty is still evidence).

**Stamp Call evidence**
- `quoted` is always `false`, even if the caller’s other fields wanted quoted.
- Contact snapshot same rules as Form. No move snapshot.
- `legacy_unknown` throws. `legacy_import` is accepted if passed (assign never produces it).

**Strip**
- `ingestion_origin`, both ingested snapshots, Granot snapshot/provenance/convergence, `normalized_job_no`, and `domain_revision` / `last_change_*` are gone.
- Ordinary patch fields (`name`, `quoted`) remain.
- `job_no` is **not** stripped (see precise logic #10).

Do **not** add a test per helper (`aPublicApiSecretIsStillAWordPressQuote`, `rememberTheContactAsArrived`). Those names exist so the parent reads. If a helper test has to change when the helper is inlined, it was testing past the **interface**.

The replica test (`leadProvenance.replica.test.ts`) already persists Form stamp through `createFormLeadInTransaction`. That is ingest proof, not a second provenance surface.

## What I would not do

- A `LeadIngestionProvenanceService` class with `derive` / `build` / `omit`.
- Thirty two-line functions that only wrap `includes` or spread a snapshot.
- Moving this into a CRUD folder, or a `provenance/` folder that also swallows Granot contact snapshots, RingCentral original-caller evidence, and the `legacy_unknown` migration.
- Treating `createLeadFromGranot` or RingCentral transport `ingestion_source` as this story.
- Collapsing Form and Call assign defaults, or inventing a Form `ringcentral` origin.
- Silently rewriting `vantage_admin` + system actor to `vantage_admin`.
- Adding `job_no` to the strip list, or allowing `legacy_unknown` / `legacy_baseline` on a new create.
- Breaking the assign **seam**: origin comes from the command (or a hardcoded public adapter), never from the client body.
