# Plant The Leftover Granot CSV Workspace Catalog, Show It, And Bind An Upload To An Existing Source Or A Disabled Review Row — Never Write Lifecycle, SMS, Or A Lead From Here — operational story

- Status: recommended
- Service: `granotCrmCsv` (Wave A, in-progress)
- Pass: 3 of this service — `registry.ts`
- Remaining in this service: `parser.ts`
- Target: `src/services/granotCrmCsv/registry.ts`
- Knowledge: none as a dedicated Service file. Software map: [`.cursor/rules/granot-crm-csv-s3-sync.mdc`](../../../.cursor/rules/granot-crm-csv-s3-sync.mdc) — this leftover catalog is how a stored CSV knows its workspace; the rule does not name seed/list/ensure. Distinct from store-the-download (history / latest / meta / ingestion row, no Lead write): [recommendations/granot-crm-csv-upload.md](granot-crm-csv-upload.md) (that file already calls `ensureSourceForUpload`). Distinct from walk-the-latest-file apply (dry-run unless asked): [recommendations/granot-crm-csv-sync.md](granot-crm-csv-sync.md). Distinct from leftover CSV parse / row identity: later `parser.ts`. Distinct from S3 key fold / put: sibling `keys.ts` / `storage.ts` (keys already import origin + slug folds from this file). Distinct from Owner Registry Granot CRM Source write / lifecycle / outbound SMS: [`docs/knowledge/services/operations-registry.md`](../../../docs/knowledge/services/operations-registry.md) + admin `/api/v1/admin/granot-crm-sources*` (`operationsRegistry/granotCrmSources.ts` `createOrUpdateGranotCrmSource`, `setGranotCrmSourceLifecycleEnabled`, `setGranotCrmSourceOutboundSms`). Schema note: `GranotCrmSource` is **both** the leftover CSV catalog and the only semantic Granot source Registry — leftover `source_company` string is not `lead_source_company`. Distinct from HTTP automation exact-label catalog (different collection, nine labels): [recommendations/granot-http-collector-source-catalog.md](granot-http-collector-source-catalog.md). Distinct from HTTP session collect / approved apply: [recommendations/granot-http-collector-index.md](granot-http-collector-index.md) / [recommendations/granot-lifecycle-automation-apply.md](granot-lifecycle-automation-apply.md). Distinct from processor fail-closed policy: [recommendations/granot-lifecycle-source-policy.md](granot-lifecycle-source-policy.md). This checkout’s `CONTEXT.md` does not define Granot CRM CSV workspace catalog / leftover seed — do not invent a glossary copy. `docs/adr/` is absent here — do not invent ADR copies.
- Callers: **three runtime import sites. No test file for this module.** Public v1 (behind `x-api-secret`, not Owner-gated): `routes/v1.routes.ts` `GET /api/v1/granot-crm/csv/sources` → Zod `listGranotCrmSourcesQuerySchema` → optional `seedGranotCrmSources(crm_origin)` when `seed` is true → `listGranotCrmSources(crm_origin)` → `{ items: leftover CSV cards }` (`csv_paths`, `last_ingestions`, `enabled`, `notes`; no lifecycle / SMS). Upload: `upload.service.ts` calls `ensureSourceForUpload` plus `normalizeCrmOrigin` / `normalizeCsvPath`. Keys: `keys.ts` calls `normalizeCrmOrigin` / `slugifyWorkspace(..., { allowSlash: true })`. Barrel: `granotCrmCsv/index.ts` re-exports `GRANOT_CRM_SOURCE_SEEDS`, `seedGranotCrmSources`, `listGranotCrmSources` — not `ensure` / `find`. Not callers: `sync.service.ts` (reads ingestions the upload already bound), admin `/api/v1/admin/granot-crm-sources*`, `operationsRegistry/granotCrmSources.ts`, HTTP automation `sourceCatalog.ts` (nine labels on a different collection), public Form/Call write. `findSourceForUpload` is exported and only called by `ensureSourceForUpload` in this file. Folder tests lock parse and S3 key folds only (`parser.test.ts`, `keys.test.ts`) — they do not import this file.
- Seams callers need: leftover CSV catalog (this file) vs Owner Registry Granot CRM Source write (not this folder); plant (`GET ?seed=true`) vs show (`GET`); find existing vs auto-create **disabled** review row (the bind write **seam**); `$setOnInsert` identity vs `$set` Follow Up / Booked paths; slugify **without** slash (find by workspace) vs **with** slash (unmapped create + S3 keys); this collection’s leftover string `source_company` vs Registry `lead_source_company`; public `/csv/sources` leftover card vs admin Registry card
- Split later (only if the file outgrows one sitting): keep one file — this ~290-line module is one screenplay for “plant the leftover Granot CSV workspace catalog, show it, and bind an upload to an existing source or a disabled review row.” If it later splits: `plantTheLeftoverGranotCsvWorkspaceCatalog.ts` / `showTheLeftoverGranotCsvWorkspaceCatalog.ts` / `bindThisGranotCsvUploadToALeftoverWorkspaceSourceOrCreateADisabledReviewRow.ts` — story files, never `seed.ts` / `list.ts` / `create.ts` / `update.ts` / `delete.ts`, and never merge S3 store, latest-file apply, Owner Registry lifecycle / SMS, HTTP automation labels, or CSV parse into this file

`seedGranotCrmSources` / `listGranotCrmSources` / `ensureSourceForUpload` are executor mechanics. The owner question is: *We keep a leftover catalog of Granot workspaces so a Follow Up or Booked CSV download knows which folder it belongs to. Plant the seventeen known slugs — insert identity once; restamp Follow Up / Booked paths only when the seed names them. Show every leftover row for an origin, including disabled and auto-created. When a download arrives, look up by workspace slug, then by CSV path, then by Granot label. If we find one, remember that path on the source. If we find none, create a disabled “needs review” row named `unmapped/filename` — do not flip `enabled`, do not write lifecycle, do not write SMS. This file does not store S3. This file does not apply rows. This file is not the Owner Registry Granot CRM Source write.*

Store, apply, parse, S3 keys/put, and Owner Registry lifecycle / SMS already live in other **modules**. Do not pull those in.

## What this file actually does

Three operations of one “leftover CSV workspace catalog” story, not “a Granot source CRUD service,” and not the Owner Registry write:

1. **Plant the leftover CSV workspace catalog** — upsert the checked-in seventeen (`GRANOT_CRM_SOURCE_SEEDS`) for one CRM origin (default `https://eagle.hellomoving.com`). `$setOnInsert` workspace slug, Granot label, default channel, leftover `source_company` string, `enabled` (true unless the seed says false), and notes. `$set` `csv_paths` only when the seed names them — today that is **TBM Prime Inbounds** only. Thirteen mapped workspaces stay enabled; four TBD rows (`auto`, `quote-runner-premium-branded`, `referral`, `regional-exclusive`) plant **disabled** with “Source mapping TBD.” This function does not rewrite an existing label, channel, company, or `enabled` when the constant later changes. This function does not write `lifecycle_*` or `outbound_sms` (model defaults stay deferred / observation-only / SMS off). This function does not attach a Registry `lead_source_company`.

2. **Show the leftover CSV workspace catalog** — find by optional folded origin, else every origin, sort by `workspace_slug`. No `enabled` filter. The GET handler projects leftover cards (`csv_paths`, `last_ingestions`, `enabled`, `notes`). This function does not hide auto-created `unmapped/…` rows. This function does not project lifecycle / SMS. This function does not read the HTTP automation nine.

3. **Bind this upload to a leftover workspace source, or create a disabled review row** — look up in order: workspace slug (folded **without** slash), then exact Follow Up / Booked `csv_paths`, then case-insensitive exact Granot label. A hit restamps `csv_paths[kind]` when the path changed and `save()`s. A miss inserts `workspace_slug` `unmapped/<csv basename>` (slash **kept**), `default_channel: "unknown"`, leftover `source_company` from `normalizeSourceCompany(label)` (usually `not_provided`), `enabled: false`, and a review note. `$set` that kind’s path. This function does not flip `enabled`. This function does not write lifecycle / SMS. This function does not store S3 and does not apply rows.

There is no fourth mutate operation. `normalizeCrmOrigin` / `normalizeCsvPath` / `slugifyWorkspace` are folds (upload and keys already import them). `csvBasenameWithoutExtension` / `escapeRegex` are private folds. `findSourceForUpload` is the lookup beat of bind — exported, unused outside this file.

## Organization

Keep one file as the screenplay for “plant the leftover Granot CSV workspace catalog, show it, and bind an upload to an existing source or a disabled review row.” Store, apply, parse, S3 keys/put, and Owner Registry lifecycle / SMS already live in deeper **modules**. Do not pull those in. Do not invent a `GranotCrmCsvRegistryService` class. Do not invent a canonical-command `begin` / `complete` **seam** here — plant / show / bind are not a Domain Command. Do not invent a second Owner-write **adapter** beside `createOrUpdateGranotCrmSource`. Do not invent a second bind **adapter** beside `ensureSourceForUpload`.

Do not move this into `upload.service.ts` so “store owns the catalog.” Do not move this into `operationsRegistry/granotCrmSources.ts` so “one Granot source writer.” Do not move this into `granotHttpCollector/sourceCatalog.ts` so “one seed list.” Do not split `seed.ts` / `list.ts` / `ensure.ts` / `create.ts`. Do not silently change `GET ?seed=true` into a POST so “writes are not on GET.” Do not silently add `{ allowSlash: true }` to find so “lookup matches unmapped create.” Do not silently `$set` identity on seed so “the constant wins over Owner edits.”

**External interface** stays small (this is the test surface). Plant, show, and bind are one story’s leftover catalog, not three CRUD verbs:

| Keep exporting | Story name | Why the seam exists |
|---|---|---|
| `seedGranotCrmSources` | `plantTheLeftoverGranotCsvWorkspaceCatalog` | `GET /api/v1/granot-crm/csv/sources?seed=true` (write on a read route) |
| `listGranotCrmSources` | `showTheLeftoverGranotCsvWorkspaceCatalog` | same GET, after optional plant |
| `ensureSourceForUpload` | `bindThisGranotCsvUploadToALeftoverWorkspaceSourceOrCreateADisabledReviewRow` | `uploadGranotCrmCsv` bind; disabled auto-create is the write **seam** |
| `findSourceForUpload` | `findTheLeftoverWorkspaceSourceForThisCsvUpload` | bind’s lookup; exported, unused outside this file |
| `GRANOT_CRM_SOURCE_SEEDS` | `TheSeventeenLeftoverCsvWorkspaceSeeds` | plant + barrel |
| `normalizeCrmOrigin` | `foldTheCrmOriginHost` | upload + keys |
| `normalizeCsvPath` | `foldTheCsvPath` | upload |
| `slugifyWorkspace` | `foldTheWorkspaceSlug` | find (no slash) vs unmapped create / S3 keys (slash kept) |

Keep the old names as one-line aliases until the v1 sources handler, upload, keys, and the barrel migrate. Do not make callers learn `$setOnInsert` / `unmapped/` / `last_ingestions` as the domain language.

**Principle: old exports stay as aliases.** `seedGranotCrmSources`, `listGranotCrmSources`, and `ensureSourceForUpload` remain the imported names until the route and upload point at the story names.

**No class for the workflow.** The type that *does* earn a name is the leftover bind we hand from lookup to stamp-or-create:

```ts
type LeftoverGranotCsvWorkspaceBind = {
  source: GranotCrmSourceDocument
  createdDisabledReviewRow: boolean
}
```

That is the handoff from “we looked up slug / path / label” to “remember the path, or plant a disabled `unmapped/…` row the owner must review.” Do **not** put `lifecycle_*` or `outbound_sms` on that object so “CSV bind can enable create-if-missing,” do **not** set `enabled: true` on auto-create so “the upload can sync,” and do **not** add `lead_source_company` so “leftover string and Registry id stay in one write.”

`GranotCrmSourceSeed` stays on sibling `types.ts` until that module’s pass. Do not move the seed type here “so the catalog owns its card.”

## The file, as a story

Parent functions stay deep. Child names are only extracted when they hide a real decision, not a one-liner.

```ts
// registry.ts
// We keep a leftover catalog of Granot workspaces
// so a Follow Up or Booked CSV download knows its folder.
// Plant the seventeen known slugs.
// Insert identity once. Restamp paths only when the seed names them.
// Show every leftover row, including disabled and auto-created.
// When a download arrives, look up slug, then path, then label.
// If we find one, remember that path.
// If we find none, create a disabled review row named unmapped/filename.
// Do not flip enabled. Do not write lifecycle. Do not write SMS.
// This file does not store S3.
// This file does not apply rows.
// This file is not the Owner Registry Granot CRM Source write.

// ── 1. Plant the leftover CSV workspace catalog ───────────

export async function plantTheLeftoverGranotCsvWorkspaceCatalog(crmOrigin?)

function identityGoesInOnlyOnInsert(seed, crmOrigin)   // $setOnInsert; do not overwrite Owner edits
function restampFollowUpAndBookedPathsWhenTheSeedNamesThem(seed)  // today TBM Prime Inbounds only
function theseFourWorkspacesStayDisabledUntilMapped()  // auto / quote-runner / referral / regional-exclusive

// ── 2. Show the leftover CSV workspace catalog ────────────

export async function showTheLeftoverGranotCsvWorkspaceCatalog(crmOrigin?)
  // optional origin; no enabled filter; leftover card, not Registry card

// ── 3. Bind this upload to a leftover source or a disabled review row

export async function bindThisGranotCsvUploadToALeftoverWorkspaceSourceOrCreateADisabledReviewRow(input)

export async function findTheLeftoverWorkspaceSourceForThisCsvUpload(input)
async function lookUpByWorkspaceSlugWithoutKeepingASlash(crmOrigin, workspaceSlug)
async function lookUpByExactFollowUpOrBookedPath(crmOrigin, csvPath)
async function lookUpByExactGranotLabelIgnoringCase(crmOrigin, granotLabel)
async function rememberThisKindPathOnTheFoundSource(source, csvKind, csvPath)
async function createADisabledUnmappedReviewRow(input)  // unmapped/<basename>; slash kept; enabled false
```

Read the primary path out loud: *Plant the seventeen leftover workspaces for this Granot origin — insert who they are once, restamp Follow Up / Booked paths only when the seed already knows them. Show the leftover catalog, including disabled TBD rows and any `unmapped/…` upload the owner has not reviewed. When a CSV download arrives, find the workspace by slug, then by path, then by label. If it exists, remember that kind’s path. If it does not, create a disabled review row named after the file. Stop. Do not enable the source. Do not write lifecycle or SMS. Do not store S3. Do not apply a Lead.*

That is the operation. `seedGranotCrmSources` / `ensureSourceForUpload` are not.

## Precise logic I would tighten while renaming

These are real smells the story names make obvious. Do not “just rename.”

1. **Plant is a write on `GET`.** `GET /api/v1/granot-crm/csv/sources?seed=true` upserts seventeen `granot_crm_sources` rows behind `x-api-secret` only — no Owner actor, no Registry audit. Admin Granot CRM Source writes go through `createOrUpdateGranotCrmSource` with a signed Owner. Do not silently move plant to a POST so “writes are not on GET,” and do not route seed through the Owner command so “one writer” — leftover plant must not start stamping lifecycle / SMS.

2. **Seed will not update an existing identity.** Changing a seed’s label, channel, leftover company, `enabled`, or notes does nothing to a row that already exists. Only named `csv_paths` `$set` on every plant. That is the “insert once” beat. Do not switch identity to `$set` so “the constant wins over Owner edits.”

3. **Find strips slashes; create keeps them.** `findTheLeftoverWorkspaceSourceForThisCsvUpload` calls `slugifyWorkspace(workspaceSlug)` with no slash. Auto-create uses `{ allowSlash: true }` so `unmapped/follow_advr1628` stays one slug. A later upload that sends that slug as `workspace_slug` looks up `unmapped-follow-advr1628`, misses, and can try to insert `unmapped/follow_advr1628` again (unique `{ crm_origin, workspace_slug }` then fails). Name the mismatch (`lookUpByWorkspaceSlugWithoutKeepingASlash` vs `createADisabledUnmappedReviewRow`). Do not add `allowSlash` to find in this rename so “lookup matches create.”

4. **Same collection, second writer.** Auto-create inserts a `GranotCrmSource` the admin Granot-names list will show, with model defaults (`lifecycle_enabled: false`, `deferred`, `observation_only`, SMS off). `save()` on a found row runs `validateGranotCrmSourceSemantics`. This file must not start writing `lifecycle_*` or `lead_source_company` so “validate passes” or “CSV bind can create-if-missing.”

5. **Auto-create leftover `source_company` is a label fold.** `normalizeSourceCompany(granotLabel)` usually yields `not_provided`. That string is not Registry `lead_source_company`. Schema/knowledge already forbid treating it as the semantic company. Do not copy the Owner command’s company id onto this insert.

6. **Two lists of `granot_crm_sources`.** This leftover list is origin-optional, includes disabled, and projects `csv_paths` / `last_ingestions`. `listRegistryGranotCrmSources` is the Owner card (lifecycle / SMS). Do not point `GET /csv/sources` at the Registry list so “one GET,” and do not add lifecycle fields to this projection so “the leftover card is complete.”

7. **Seventeen leftover slugs are not the HTTP automation nine.** This seed includes Get Movers, Paid Overflow, Main Site **Inbounds** (not Forms), and four TBD disabled rows. HTTP `sourceCatalog.ts` plants nine exact labels on a different collection (includes Main Site **Forms**, omits Get Movers). Do not plant the nine here, and do not drop Get Movers so “the catalogs match.”

8. **Only TBM Prime Inbounds plants paths.** Every other workspace waits for bind / upload to stamp `csv_paths`. Path lookup then fails until the first upload. Do not copy TBM Prime’s `/vantage/bu/…` paths onto the other seeds so “find-by-path works before upload.”

9. **`findSourceForUpload` is a public export with no outside caller.** Bind is the **interface**. Keep the find name as an alias of the lookup beat. Do not add a route that returns the raw find so “ops can preview bind.”

10. **No test imports this file.** `parser.test.ts` and `keys.test.ts` lock children. The public GET and the upload bind are untested at this **interface**. Do not treat key-path tests as catalog proof.

11. **Leave sibling modules alone.** `uploadGranotCrmCsv`, `runGranotCrmCsvSync`, `createOrUpdateGranotCrmSource`, `parseGranotCsv`, and HTTP `seedGranotAutomationSources` are already the right **depth**. This file plants, shows, and binds leftover CSV workspaces. Owner Registry write is a different story.

## Testing

The **interface** is the test surface: `plantTheLeftoverGranotCsvWorkspaceCatalog`, `showTheLeftoverGranotCsvWorkspaceCatalog`, `bindThisGranotCsvUploadToALeftoverWorkspaceSourceOrCreateADisabledReviewRow` (today `seedGranotCrmSources`, `listGranotCrmSources`, `ensureSourceForUpload`).

There is no `registry.test.ts`. Replace “we tested the S3 key strings” with tests that name the operation:

**Plant**
- First plant for default origin inserts seventeen rows; TBM Prime Inbounds has both Follow Up and Booked paths; `auto` / `quote-runner-premium-branded` / `referral` / `regional-exclusive` are `enabled: false`.
- Second plant does not change an existing `granot_label` / `enabled` / leftover `source_company` when the constant would now disagree.
- Second plant restamps TBM Prime `csv_paths` when they differ.
- Planted rows do not set `lifecycle_enabled: true` or `outbound_sms.enabled: true`.
- `GET ?seed=true` may call plant — that assertion belongs on the route test, not a helper test.

**Show**
- Origin filter folds host and returns only that origin, `workspace_slug` ascending.
- Omitted origin returns every origin.
- Disabled TBD rows and `unmapped/…` review rows are included.
- Projection used by the GET has `csv_paths` / `last_ingestions` and does **not** require lifecycle fields.

**Bind**
- Workspace slug hit restamps only that kind’s path and does not flip `enabled`.
- Path hit (no slug) returns that source.
- Label hit is case-insensitive exact, not a contains match.
- Unknown upload creates `workspace_slug` `unmapped/<basename>`, `enabled: false`, review note, leftover `source_company` from the label fold.
- Created review row does not write `lifecycle_enabled: true` or SMS on.
- A later bind that sends `workspace_slug: "unmapped/foo"` today looks up `unmapped-foo` (lock the current miss; do not “fix” slash fold in the test).
- Does not call `putGranotCrmObject`, `runGranotCrmCsvSync`, or `createOrUpdateGranotCrmSource`.

**What this file must not do**
- Does not import or call `updateFormLead`, `syncCallLeadEnrichment`, `syncBookedCallLeadReconciliation`, or `createFormLead`.
- Does not write `lead_source_company` / `lifecycle_routes` / `outbound_sms`.
- Does not plant HTTP automation labels.

Do **not** add a test per helper (`foldTheCrmOriginHost`, `escapeRegex`, `csvBasenameWithoutExtension`). Those names exist so the parent reads. If a helper test has to change when the helper is inlined, it was testing past the **interface**.

`findTheLeftoverWorkspaceSourceForThisCsvUpload` may stay exported as the lookup beat; prefer proving it through bind. Folds stay exported because upload and keys are a second real **adapter**, not a test leak.

## What I would not do

- A `GranotCrmCsvRegistryService` class with `create` / `update` / `delete`.
- Thirty two-line functions that only wrap `findOneAndUpdate`.
- Moving this into a CRUD folder (`seed.ts` / `list.ts` / `create.ts` / `ensure.ts`) for cleanliness.
- Breaking the find-then-disabled-create **seam**, or silently enabling an auto-created row so “the upload can sync.”
- Treating `uploadGranotCrmCsv`, `runGranotCrmCsvSync`, Owner Registry Granot CRM Source write, HTTP automation seed, Form Lead Ingestion, or Granot `createLeadFromGranot` as this story.
- Inventing a Domain Command `begin` / `complete` **seam** that has only one **adapter**.
- Inventing a second Owner-write **adapter** beside `createOrUpdateGranotCrmSource`.
- Merging this leftover catalog into `operationsRegistry/granotCrmSources.ts` or `granotHttpCollector/sourceCatalog.ts` so “one Granot source list.”
- Silently adding `{ allowSlash: true }` to find, or `$set`ing seed identity, so the constant / unmapped slug “wins.”
- Silently changing `GET ?seed=true` into an Owner POST so “writes match Registry.”
- Jumping to `crm` while `parser.ts` is unchecked.
- Writing a whole-folder recommendation for `granotCrmCsv`.
