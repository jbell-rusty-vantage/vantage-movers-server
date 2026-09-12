# Remember The Agent Row, Keep One Catalog Person Per Folded Name And At Most One Per Granot Username, And Register Inverse Virtuals For Form And Call Leads Received — Never Resolve Binder Or Stamp A Receiver Here, Never Invent A Selected-Database Getter, Never Copy Booking AutoIndex-False Onto This Catalog Row Without A Migration — operational story

- Status: recommended
- Service: `models` (Wave B, in-progress)
- Pass: 6 of this service — `Agent.ts`
- Remaining in this service: `LeadSourceCompany.ts` and the rest of the `models` checklist in TRAVERSAL.md
- Target: `src/models/Agent.ts`
- Knowledge: [`docs/knowledge/services/catalog.md`](../../../docs/knowledge/services/catalog.md) (System of Record is Operations Registry catalog collection `agents`. Mutations go through leftover `createOrUpdateAgent` / activation. Lookup is `$or: [{ normalized_name }, { name_aliases }]`. Granot username already assigned is Registry `DUPLICATE_IDENTIFIER`. Knowledge resource list names the catalog facade and this file — do not add a Models Service file in this rename so “the Service sentence wins”). Binder remember: [`docs/knowledge/services/agent-allocation.md`](../../../docs/knowledge/services/agent-allocation.md) (`rememberEachNamedAgentOnTheBooking` — **this file never resolves Binder**, never inserts an Agent on a Booking path). Receiver stamp: already-recommended [agents-receiver-agent-crm-username.md](agents-receiver-agent-crm-username.md) (`findTheAgentThisCrmUsernameNames` queries leftover Registry `granot_identity.username` only — **this file never stamps a receiver**). Lifecycle assertion: [`docs/knowledge/granot-lifecycle/identity.md`](../../../docs/knowledge/granot-lifecycle/identity.md) (suggest an Agent only when exactly one active row matches nested **or** flat username — **never** `applyGranotCrmUsernameReceiverMatch`). Distinct from already-recommended leftover catalog facade: [catalog-catalog.md](catalog-catalog.md) (flattened leftover card — **this file never lists**). Distinct from already-recommended Customer row: [models-customer.md](models-customer.md) (phone / folded name / email browse-indexed and **never unique** — **do not copy that “never unique” onto Agent** so “every support row matches Customer”). Distinct from already-recommended Form / Call rows: [models-form-lead.md](models-form-lead.md), [models-call-lead.md](models-call-lead.md) (those files have selected-database getters — **do not invent `getAgentModel` so “Agent matches Form”**). Distinct from already-recommended Booking / Cancellation rows: [models-booked-lead.md](models-booked-lead.md), [models-cancelled-lead.md](models-cancelled-lead.md) (those files set `autoIndex: false` and named catalogs — **do not copy that fence here**). Distinct from leftover next Merchant row: `Merchant.ts` (unique folded name, **no** Granot username uniques, **no** inverse Lead virtuals, `created_from` default `"admin"`). Distinct from leftover Extension User login: `ExtensionUser.ts` (email login — **not an Agent**). Distinct from leftover historical relax: `historical/Agent.ts` (`registerHistoricalAgent` on `vantagemovershistorical`; `name` not required; `normalized_name` indexed and **not unique**; **no** aliases, Granot fields, or inverse virtuals). Distinct from leftover Sheet Sync register: `sheetSync/drainer/jobPlanner.ts` (side-effect `import "../../../models/Agent"` so leftover `populate("agent_allocations.agent")` can resolve — **this file never projects a sheet**). Distinct from leftover CONTRADICTIONS: leftover identity `$or`s both username paths; leftover receiver / Registry `resolveAgentByGranotUsername` query only the nested field. Do not silently merge. This checkout’s `CONTEXT.md` is a pointer plus four employee-booking terms — knowledge links [Agent](../../../../CONTEXT.md), [Active Agent](../../../../CONTEXT.md); this checkout does **not** define Agent — do not invent a glossary copy. `docs/adr/` is absent here — knowledge cites ADR-0001 on the Service; do not invent ADR copies. Project-organization names Daily Operations models; this checkout has no `DailyOperationsDay` / `DailyOperationsEvent` and no `src/services/dailyOperations/` — do not invent those rows. Wave A visited `granotLifecycle` without enumerating `connectBookingToLead.ts` — do not reopen Wave A in this models pass.
- Callers: **default-connection model only — there is no `getAgentModel`.** Leftover `operationsRegistry/catalogRegistry.ts` **asks** default `Agent` for list / get / `$or` name-or-alias resolve / nested-username resolve / `createOrUpdate` / activation / leftover `assertCatalogNameAvailable` / leftover `assertGranotUsernameAvailable` (`$or` nested **or** flat). Already-recommended leftover catalog facade and leftover allocation **ask** leftover Registry, not this file. Already-recommended leftover receiver stamp **asks** leftover `resolveAgentByGranotUsername` (nested only). Already-recommended leftover `granotLifecycle/identity.ts` **asks** default `Agent.find` `$or` nested **or** flat. Already-recommended leftover `createLeadFromGranot.ts` / `synchronizeLeadFromGranot.ts` / Owner Booking commands / leftover `domainCommands/bookings.ts` **ask** default `Agent.find` / `findById` for an **active** row. Leftover `admin/adminScope.service.ts` **asks** default `Agent` for the non-historical scope and leftover `registerHistoricalAgent` for historical. Leftover `historicalConsolidation/schemaValidation.ts` **asks** default `Agent` to `validateSync` a planned insert. Leftover `operationsRegistry/queries/{overview,health}.ts` **ask** default `Agent.countDocuments`. Leftover `sheetSync/drainer/jobPlanner.ts` **asks** the side-effect import so `mongoose.models.Agent` exists before leftover Booking `populate("agent_allocations.agent")`. Leftover `catalogRegistry.test.ts`, leftover `catalog.service.test.ts`, leftover `agentAllocation.service.test.ts`, leftover `receiverAgentCrmUsername.test.ts`, leftover `admin.service.test.ts`, leftover identity / Owner Booking replica tests stub `Agent.find` / `findOne` / `findById`. `jobPlanner.test.ts` **asks** `mongoose.models.Agent` after the planner module loads. There is no `Agent.test.ts`. Not this **interface**: leftover `createOrUpdateAgent` itself, leftover `rememberEachNamedAgentOnTheBooking` itself, leftover `findTheAgentThisCrmUsernameNames` itself, leftover identity assertion itself, leftover `registerHistoricalAgent` itself, leftover preview `countDocuments` on Booking / Form / Call collections.
- Seams callers need: default `Agent` (first-registered connection — **including leftover Registry write, leftover identity `$or`, leftover Owner active-id load, leftover admin non-historical scope, leftover historical-consolidation validate**) vs leftover `registerHistoricalAgent` (second **adapter** on `vantagemovershistorical` — that file, not a getter on this one); field-level unique `{ normalized_name: 1 }` vs leftover Registry `$or` name-or-alias availability (aliases are **not** unique on this schema); two unique sparse username indexes (nested partial `granot_identity.username` + flat `granot_crm_username`) vs leftover receiver / Registry resolve that reads **only** the nested path vs leftover identity / leftover Registry username-available that `$or` both; schema `lowercase` + `trim` on `normalized_name` **when that path is set** vs leftover `normalizeAgentName` that also collapses whitespace; schema `uppercase` + `trim` on both username paths vs leftover `normalizeGranotCrmUsername`; inverse virtuals (`form_leads_received`, `call_leads_received`) vs leftover `previewRegistryDependency` that counts Form / Call / Booking collections itself; Mongoose default `autoIndex` (this file does **not** set `autoIndex: false`) vs Form / Call / Booking / Cancellation named-catalog fence. There is no begin / complete Domain Command **seam**. There is no HTTP **seam**. There is no Sheet Sync **seam**. There is no Binder **seam**. There is no selected-database getter **seam**.
- Split later (only if the file outgrows one sitting): this ~72-line file is one sitting if you read it as remember the Agent row, keep one catalog person per folded name and at most one per Granot username, and register inverse virtuals for Form and Call Leads received — never resolve Binder or stamp a receiver here, never invent a selected-database getter, never copy Booking autoIndex-false onto this catalog row without a migration. Do not split. Never `create.ts` / `update.ts` / `delete.ts` / `schema.ts` / `indexes.ts` / `normalize.ts` / `virtuals.ts`. Catalog write stays leftover `catalogRegistry.ts`. Binder remember stays already-recommended `agentAllocation.service.ts`. Receiver stamp stays already-recommended `receiverAgentCrmUsername.ts`. Historical relax stays leftover `historical/Agent.ts`. Leftover next Merchant row stays leftover `Merchant.ts`.

`Agent` is a Mongoose model name. The owner question is: *Owner just named this salesperson in the catalog — or a leftover Booking is about to remember their display name. Hold the row on `agents`. Keep folded name unique so leftover Registry rename elects one person, and keep Granot username unique (sparse) so leftover receiver stamp and leftover identity assertion elect at most one Agent. Register two inverse virtuals so a populate can walk Form Leads and Call Leads this Agent received. If this process selected a different Mongo database, today’s live callers still use the default connection — do not invent a getter in this rename. Do not resolve Binder. Do not stamp a receiver. Do not upsert. Do not stamp folded name on validate. Do not copy Booking’s `autoIndex: false` here without a reviewed index migration.*

Who record / rename / activate already lives in leftover `catalogRegistry.ts`. Who share this Booking’s Binder already lives in already-recommended `agentAllocation.service.ts`. Who stamp this Lead’s receiver from a Granot username already lives in already-recommended `receiverAgentCrmUsername.ts`. Do not pull those in.

## What this file actually does

Three operations of one “remember the Agent row, keep one catalog person per folded name and at most one per Granot username, and register inverse virtuals” story, not “an Agent model CRUD dump,” and not Record A Leftover Catalog Card / Name Who Shares This Booking’s Binder themselves:

1. **Hold the Agent as the catalog System of Record row** — collection `agents`, timestamps, `toJSON` / `toObject` virtuals. **No** `autoIndex: false`. **No** `optimisticConcurrency`. **No** revision catalog. **No** `sheet_sync[]`. **No** Ingestion Origin. Declares required `name` (trim), required `normalized_name` (trim, schema `lowercase`, **unique**), required `active` (default `true`), required `role` (trim, default `"agent"`), required `created_from` (trim, default `"booked_lead"`), `name_aliases[]` (default `[]`), optional `archived_at` / `deactivation_reason`, optional nested `granot_identity` (`username` trim + schema `uppercase`, `verified` default `false`, `verified_at`, `last_observed_at`), optional flat `granot_crm_username` (trim, schema `uppercase`, sparse unique). This beat does **not** invent `normalized_name` from `name`. This beat does **not** collapse whitespace. This beat does **not** verify a Granot username. A leftover Booking may still refuse when leftover Registry find misses.

2. **Keep one Agent per folded name and at most one per Granot username** — field-level unique `{ normalized_name: 1 }`. Non-unique `{ name_aliases: 1 }` browse index. Unique sparse partial `{ "granot_identity.username": 1 }` where the nested path is a string. Unique sparse `{ granot_crm_username: 1 }`. None are named catalogs. None have a leftover `pnpm migration:*` apply path. Because this schema does not set `autoIndex: false`, Mongoose’s default will create those indexes on boot — that is today’s contract, not a missing Booking copy. Leftover Registry availability **also** refuses a folded name that already lives on another Agent’s `name_aliases`. This schema’s unique does **not** cover aliases. Leftover receiver / leftover `resolveAgentByGranotUsername` read **only** the nested username. Leftover identity and leftover `assertGranotUsernameAvailable` `$or` both username paths. This beat does **not** drop the flat unique so “one username index matches receiver find.”

3. **Register inverse virtuals for Form Leads and Call Leads received** — `form_leads_received` (`FormLead.receiver_agent`), `call_leads_received` (`CallLead.receiver_agent`). Two virtuals, not one `leads_received`, because leftover Mongoose virtual populate cannot span two collections. Leftover Sheet Sync populate walks the **forward** Booking → `agent_allocations.agent` pointer and needs this model registered. Leftover `previewRegistryDependency` does **not** populate these virtuals — it `countDocuments`s Booking allocations plus Form / Call `receiver_agent` and paints keys with the same names. Leftover historical Agent has **no** inverse virtuals. This beat does **not** count Bookings. This beat does **not** cascade deactivate Leads.

`AgentDocument` is the inferred row type. There is no selected-database getter. There is no unknown-state sentinel here. There is no named index export.

There is no record-this-Agent-in-the-catalog operation. Leftover `catalogRegistry.ts` elects that. There is no historical-relax operation. Leftover `historical/Agent.ts` elects that.

## Organization

Keep one file. This is the screenplay for “remember the Agent row, keep one catalog person per folded name and at most one per Granot username, and register inverse virtuals for Form and Call Leads received — never resolve Binder or stamp a receiver here, never invent a selected-database getter, never copy Booking autoIndex-false onto this catalog row without a migration.” Leftover Registry write / leftover Binder remember / leftover receiver stamp / leftover identity assertion already live in deeper **modules**. Leftover historical relax already lives in a sibling **module**. Do not pull those in. Do not invent an `AgentModelService` class. Do not invent a begin / complete Domain Command **seam**. Do not invent a `getAgentModel` **adapter** so “Agent matches Form” without a paired proof that leftover Registry write, leftover identity `$or`, leftover Owner active-id load, leftover admin non-historical scope, and leftover historical-consolidation validate still read the same `agents`. Do not invent an `autoIndex: false` **adapter** so “Agent matches Booking” without a reviewed index migration. Do not invent a unique `{ name_aliases: 1 }` **adapter** so “alias uniqueness lives on the schema.” Do not invent a `pre("validate")` that stamps `normalized_name` so “hand insert matches Registry” — leftover catalog already stamps via `normalizeAgentName`. Do not invent a CRUD folder so `schema.ts` / `indexes.ts` / `virtuals.ts` / `normalize.ts` each get a file.

Do not move leftover `normalizeAgentName` into this file so “the row owns the fold.” Do not merge this file into leftover `historical/Agent.ts` so “one schema owns the live row and the historical relax.” Do not merge this file into leftover next `Merchant.ts` so “one catalog schema owns people and payees.” Do not merge this file into leftover `ExtensionUser.ts` so “one login owns the salesperson.” Do not split `create.ts` / `update.ts` / `delete.ts`.

**External interface** stays small (this is the test surface):

| Keep exporting | Story name | Why the seam exists |
|---|---|---|
| `Agent` | `agentOnTheDefaultConnection` | leftover Registry write, leftover identity `$or`, leftover Owner active-id load, leftover admin non-historical scope still import the default model |
| `AgentDocument` | `AgentRow` | inferred document + `_id` |

Keep the old names as one-line aliases until leftover `catalogRegistry.ts`, leftover identity, leftover Owner Booking commands, leftover admin scope, leftover jobPlanner register, and leftover historical-consolidation validate migrate. Do not make callers learn `normalized_name` / `granot_identity.username` as the domain language. Do **not** add `getAgentModel` so “every aggregate has a getter” — live writes already share one default **adapter**; historical is leftover `registerHistoricalAgent` on a different file. Do **not** delete the default `Agent` export so “everyone must call a getter that does not exist.” Do **not** export a named unique-name catalog that this schema does not name.

**No class for the workflow.** The one type that *does* earn a name is the pending catalog-identity contract:

```ts
type AgentCatalogIdentityUniques = {
  normalized_name: { unique: true }
  granot_identity_username: { unique: true; sparse: true; partial: "string" }
  granot_crm_username: { unique: true; sparse: true }
}
```

That is the handoff from “this process remembered a salesperson” to “leftover Registry rename and leftover Granot username lookup elect at most one row.” Do **not** add `name_aliases` onto that type as `{ unique: true }` so “alias uniqueness lives on the schema.” Do **not** drop `granot_crm_username` from that type so “one username index matches receiver find.”

Leave leftover `registerHistoricalAgent` on leftover `historical/Agent.ts`. Leave leftover next `Merchant.ts` on that file. Leave leftover `ExtensionUser.ts` on that file.

## The file, as a story

Parent functions stay deep. Child names are only extracted when they hide a real decision, not a one-liner.

```ts
// Agent.ts
// Owner just named this salesperson in the catalog —
// or a leftover Booking is about to remember their display name.
// Hold the row on agents.
// Keep folded name unique so leftover Registry rename elects one person,
// and keep Granot username unique (sparse)
// so leftover receiver stamp and leftover identity assertion
// elect at most one Agent.
// Register two inverse virtuals so a populate can walk
// Form Leads and Call Leads this Agent received.
// Today's live callers still use the default connection —
// do not invent a selected-database getter in this rename.
// Do not resolve Binder.
// Do not stamp a receiver.
// Do not upsert.
// Do not stamp folded name on validate.
// Do not copy Booking's autoIndex: false here
// without a reviewed index migration.

export const agentOnTheDefaultConnection =
  mongoose.models.Agent ?? mongoose.model("Agent", agentSchema)

export { agentOnTheDefaultConnection as Agent }

// ── 1. Hold the Agent as the catalog System of Record row ─

const agentSchema = rememberTheAgentRow() // collection agents; default autoIndex; no revision

function rememberTheAgentRow() {
  const schema = new Schema(
    {
      name: requiredTrimmedDisplayName(),
      normalized_name: requiredFoldedName(),          // lowercase + trim when set; not invented from name
      active: requiredActiveDefaultTrue(),
      role: requiredRoleDefaultAgent(),
      created_from: requiredOriginDefaultBookedLead(), // leftover catalog create still stamps "admin"
      name_aliases: optionalFoldedAliasList(),
      archived_at: optionalArchivedAt(),
      deactivation_reason: optionalDeactivationReason(),
      granot_identity: optionalNestedGranotIdentity(), // username uppercase when set; verified default false
      granot_crm_username: optionalFlatGranotUsername(), // uppercase when set; sparse unique
    },
    { collection: "agents", timestamps: true },
  )
  keepOneAgentPerFoldedNameAndAtMostOnePerGranotUsername(schema)
  registerInverseFormAndCallLeadsReceivedVirtuals(schema)
  return schema
}

// ── 2. Catalog identity uniques ───────────────────────────

function keepOneAgentPerFoldedNameAndAtMostOnePerGranotUsername(schema) {
  // today's field-level unique normalized_name
  // today's non-unique name_aliases browse index
  // today's unique sparse partial granot_identity.username
  // today's unique sparse granot_crm_username
  // no named catalog, no leftover migration export
}

// ── 3. Inverse virtuals ───────────────────────────────────

function registerInverseFormAndCallLeadsReceivedVirtuals(schema) {
  schema.virtual("form_leads_received", { ref: "FormLead", localField: "_id", foreignField: "receiver_agent" })
  schema.virtual("call_leads_received", { ref: "CallLead", localField: "_id", foreignField: "receiver_agent" })
  // two virtuals — leftover Mongoose cannot populate two collections in one virtual
}
```

Read the primary path out loud: *hold the Agent on `agents` with a required display name, a required folded name, and an optional Granot username. Do not invent the folded name on validate. Keep folded name unique and keep both username paths unique-sparse so leftover Registry rename elects one person and leftover Granot lookup elects at most one Agent. Index aliases for lookup without making them unique on this schema. Register two inverse virtuals so leftover Booking populate can resolve this model and a later desk can walk Form / Call receivers. If this process already sits on the first-registered connection, that is the model leftover Registry and leftover identity already import. Historical is the other file. Do not resolve Binder. Do not stamp a receiver. Do not make aliases unique here.*

That is the operation. An unnamed schema dump is not.

## Precise logic I would tighten while renaming

These are real smells the story names make obvious. Do not “just rename.”

1. **There is no validate hook — and that is today’s contract, not a missing Form-Lead copy.** Leftover Registry `createOrUpdateAgent` stamps `normalized_name` via leftover `normalizeAgentName` (trim, collapse whitespace, lowercase) and stamps both username paths via leftover `normalizeGranotCrmUsername`. Schema `lowercase` / `uppercase` / `trim` only fold the path when a caller set it, and they do **not** collapse whitespace. Do not add `pre("validate")` `stampTheFoldedNameFromDisplay` so “hand insert matches Registry” — a silent stamp would change who a later leftover `$or` name-or-alias find returns. Do not copy Form Lead’s lid / phone / Job fold onto this hook.

2. **There is no selected-database getter — and that is today’s contract.** Leftover Registry write, leftover identity `$or`, leftover Owner active-id load, leftover admin non-historical scope, leftover historical-consolidation validate **ask** default `Agent`. Historical **asks** leftover `registerHistoricalAgent`. Do not silently add `getAgentModel` in this rename so “every aggregate matches Form” without a paired proof that `TEST_MODE` still misses the live `vantagemovers` database **and** that leftover Registry still finds the same rows. Do not move leftover historical-consolidation’s `Agent` validate onto a new getter in the same pass as this rename.

3. **Folded name is unique. Aliases are not.** Leftover `assertCatalogNameAvailable` refuses a folded string that already lives on another Agent’s `normalized_name` **or** `name_aliases`. This schema’s unique covers only `normalized_name`. Do not flip `{ unique: true }` on `name_aliases` so “alias uniqueness lives on the schema” without a paired proof that two Agents may not share an alias string today **and** that leftover rename `mergeAlias` still keeps the old folded name resolvable. Do not drop the unique on `normalized_name` so “Agent matches Customer’s never-unique browse.”

4. **Two username uniques are today’s contract, not a leftover duplicate to delete.** Leftover catalog write sets nested `granot_identity.username` **and** flat `granot_crm_username` together and resets `verified` when the username changes. Leftover receiver / leftover `resolveAgentByGranotUsername` query **only** the nested path (already test-locked). Leftover identity and leftover `assertGranotUsernameAvailable` `$or` both. Do not drop the flat unique so “one username index matches receiver find.” Do not add the flat field onto leftover receiver find so “find matches identity.” Do not pick the first of two active rows so “identity `agent_assertion: single` always suggests.”

5. **`created_from` default `"booked_lead"` is leftover of when a Booking could insert an Agent.** Leftover knowledge and already-recommended allocation say standard booking paths never insert catalog rows. Leftover catalog create stamps `"admin"` (or the command). Leftover next Merchant default is already `"admin"`. Do not change this default so “Agent matches Merchant” — a silent default change would rewrite who a bare `Agent.create` blames.

6. **Inverse virtuals are not leftover dependency preview.** Leftover `previewRegistryDependency` counts Booking allocations plus Form / Call `receiver_agent` and names those counts `form_leads_received` / `call_leads_received`. It never `populate`s the virtuals. Do not change leftover preview to use the virtuals so “the key names become populate.” Do not delete the virtuals so “nobody populates them” — leftover Booking `populate("agent_allocations.agent")` still needs this model registered, and a later owner desk may walk the inverse. Do not invent one `leads_received` virtual so “one populate owns Form and Call.”

7. **Default `autoIndex` is today’s contract.** Form / Call / Booking / Cancellation set `autoIndex: false` and ship named catalogs through reviewed leftover migrations. This file does neither. Do not silently set `autoIndex: false` so “Agent matches Booking” without a paired report that boot still creates the unique name / unique username / alias browse indexes **or** that a leftover migration will. Do not invent `AGENT_NORMALIZED_NAME_UNIQUE` so “every catalog row has a named catalog.”

8. **No revision, no `__v` optimistic concurrency, no `sheet_sync`.** An Agent is not a Lead and not a Booking. Do not spread leftover `aggregateRevisionSchemaFields` so “every SoR row matches Form.” Do not enable `optimisticConcurrency` so “Agent matches Booking.” Do not add `sheet_sync[]` so “Agent can project” — there is no agent Sheet Sync row.

9. **Leave sibling modules alone.** Leftover Registry write, leftover Binder remember, leftover receiver stamp, leftover identity assertion, leftover Owner active-id load, leftover admin related-booking metrics, leftover historical relax, leftover jobPlanner register, and the leftover next Merchant row are already the right **depth**. This file holds the Agent row.

## Testing

The **interface** is the test surface: `Agent` validate, the unique folded name, the two unique-sparse username indexes.

There is no `Agent.test.ts`. Today’s proofs sit on leftover callers: leftover `catalog.service.test.ts` stubs `Agent.findOne` for leftover `$or` name-or-alias plus leftover `includeInactive`; leftover `catalogRegistry.test.ts` stubs `Agent.find` for leftover active list; leftover `receiverAgentCrmUsername.test.ts` proves nested-only username find; leftover identity replica tests prove `$or` both username paths and “exactly one active row suggests”; leftover `jobPlanner.test.ts` names `mongoose.models.Agent` after the planner loads. Keep those as the operation proofs on those **interfaces**.

Add (or keep, if a later implementer finds them missing) only interface proofs on this file:

**Hold the row**
- A new Agent requires `name` and `normalized_name`.
- A row with no `granot_crm_username` and no `granot_identity.username` still validates.
- Validate does **not** invent `normalized_name` from `name`.
- Validate does **not** collapse internal whitespace on `normalized_name`.
- `created_from` defaults to `"booked_lead"`.
- There is no `getAgentModel` export.
- `schema.options.optimisticConcurrency` is not true.
- `schema.options.autoIndex` is not `false`.

**Catalog identity uniques**
- `normalized_name` is unique.
- `name_aliases` is indexed and **not** unique.
- `granot_crm_username` is unique and sparse.
- `granot_identity.username` is unique, sparse, and partial on `$type: "string"`.
- There is no named unique-name catalog export.

**Inverse virtuals**
- `form_leads_received` and `call_leads_received` are virtuals on the live schema.
- Leftover historical Agent still has neither virtual (prove that on leftover `historical/Agent.ts`, not by merging the files).

Do **not** add a test per helper (`requiredFoldedName`, `optionalFlatGranotUsername`). Those names exist so the parent reads. Do **not** HTTP leftover catalog create from this file’s tests. Do **not** resolve Binder from this file’s tests. Do **not** `syncIndexes` in the unit file so “the test creates the unique indexes.” Do **not** open a Booking or stamp a receiver from this file’s tests.

There is no named index export to keep for a second leftover migration **adapter** — this file has none.

## What I would not do

- An `AgentModelService` / `AgentService` class with `create` / `update` / `delete`.
- Thirty two-line functions that only wrap `Schema.virtual`.
- Moving this into a CRUD folder (`create.ts` / `update.ts` / `delete.ts`) or a `schema.ts` / `indexes.ts` / `virtuals.ts` / `normalize.ts` split for cleanliness.
- Breaking the default-connection **seam** by inventing `getAgentModel` without a paired proof. Leftover Registry must not write live `agents` while `TEST_MODE` selected `testvantagemovers` — and today’s write already uses the default, not a getter.
- Treating leftover `createOrUpdateAgent` / leftover activation as this story. Those functions own the Owner transaction and the Change row.
- Treating already-recommended `rememberEachNamedAgentOnTheBooking` as this story. That function owns Binder split and stays outside the Booking write.
- Treating already-recommended `findTheAgentThisCrmUsernameNames` / `stampThisLeadsReceiverFromThatCrmUsername` as this story. Those functions own nested-only lookup and the in-memory Lead stamp.
- Treating already-recommended leftover identity Agent assertion as this story. That store `$or`s both username paths and suggests only when exactly one active row matches.
- Treating leftover `historical/Agent.ts` as this story. That row does not require `name`, does not unique-index folded name, and has no Granot fields or inverse virtuals.
- Treating leftover next `Merchant.ts` as this story.
- Treating leftover `ExtensionUser.ts` as this story. That login is not an Agent.
- Inventing a unique-alias **seam** so “alias uniqueness lives on the schema.”
- Inventing an `autoIndex: false` **adapter** that has only “matches Booking” as its second home.
- Inventing a selected-database **seam** that has only one live **adapter**.
- Silently stamping `normalized_name` on validate so “hand insert matches Registry.”
- Silently dropping the flat username unique so “one username index matches receiver find.”
- Silently adding the flat field onto leftover receiver find so “find matches identity.”
- Silently changing `created_from` default to `"admin"` so “Agent matches Merchant.”
- Silently enabling `optimisticConcurrency` or leftover revision fields so “Agent matches Booking.”
- Silently “fixing” ADR-0001 while recommending a rename. `docs/adr/` is absent here; do not invent copies.
- Jumping to `validation/` while this checklist has unchecked modules.
- Writing a whole-folder recommendation for `models`.
