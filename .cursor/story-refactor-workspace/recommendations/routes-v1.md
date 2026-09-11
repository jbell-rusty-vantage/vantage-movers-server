# Admit The Caller To The Public V1 Desk, Then Parse, Ask The Canonical Command, And Answer — Never Put A Data Route Before The Secret, Never Let Catalog List Steal The Agents Browse Path, Never Treat Form Lead Ingest As HandleCanonicalCreate — operational story

- Status: recommended
- Service: `routes` (Wave B, in-progress)
- Pass: 1 of this service — `v1.routes.ts`
- Remaining in this service: `extension-auth.routes.ts`, `google-drive-oauth.routes.ts`, `ringcentral-registry.routes.ts`, `granot-lifecycle-admin.routes.ts`, `job-number-timeline-admin.routes.ts`, `conversations-admin.routes.ts`, `extension-users-admin.routes.ts`, `extension-granot-apply.routes.ts`, `tariff-adjustments.routes.ts`, `granot-automation.routes.ts`, `ingestion.routes.ts`, `reporting.routes.ts`, `granot-webhook.routes.ts`, `ringcentral-webhook.routes.ts`, `ringcentral-webhook-local.routes.ts`, `twilio-message-status.routes.ts`, `twilio-voice.routes.ts`, `ringcentral-cron.routes.ts`, `booking-reconciliation-cron.routes.ts`, `sheet-sync-cron.routes.ts`, `lead-messaging-cron.routes.ts`, `cpl-correction-cron.routes.ts`, `notification-cron.routes.ts`, `best-relocation-ingestion-cron.routes.ts`, `reporting-cron.routes.ts`, `granot-automation-cron.routes.ts`, `granot-lifecycle-cron.routes.ts`
- Target: `src/routes/v1.routes.ts`
- Knowledge: no dedicated routes Service. HTTP notes live on the already-recommended domain files this desk **asks**: [`docs/knowledge/services/form-lead.md`](../../../docs/knowledge/services/form-lead.md) (`POST /api/v1/form-leads` via `runExistingCreateFormLead`; leftover public `ingestFormLead` is **not** the HTTP path; public routes still own `runSheetSyncWrite` + `finalizeSheetSync`; Manual / owner actor → [Ingestion Origin](../../../../CONTEXT.md) Vantage Admin), [`docs/knowledge/services/domain-commands.md`](../../../docs/knowledge/services/domain-commands.md) (public mutating routes derive the bag via `existingWriteContextFromRequest` then enter `runExisting*`), [`docs/knowledge/services/catalog.md`](../../../docs/knowledge/services/catalog.md) (catalog list is `GET /admin/catalog/agents`; `GET /admin/agents` is browse + metrics), plus call-lead / bookings / cancelled-lead / customer / operations-registry / admin-search. Distinct from already-recommended command apply: [domain-commands-existing-writes.md](domain-commands-existing-writes.md) (`runExisting*` — this file **asks** them; it does **not** open a session). Distinct from already-recommended HTTP bag: [domain-commands-existing-write-context.md](domain-commands-existing-write-context.md) (`existingWriteContextFromRequest` — this file **asks** it). Distinct from already-recommended Form Lead screenplay: [form-lead.md](form-lead.md) (`begin` / `complete` — leftover `ingestFormLead` is not this path). Distinct from leftover sibling extract: next `extension-granot-apply.routes.ts` (`PATCH .../form-leads/:id/granot-sync`, `POST .../call-leads/enrichment/sync` — this file **mounts** that router and does **not** import `applyExtensionGranotItem`). Distinct from leftover sibling extract: next `tariff-adjustments.routes.ts` (`POST /api/v1/tariff-adjustments` — this file **mounts** `createTariffAdjustmentsRouter()`). Distinct from leftover Wave B secret: next `requireApiSecret.ts` (`router.use("/api/v1", requireApiSecret)` after unguarded extension auth + Drive). Distinct from leftover Wave B Zod barrel: `src/validation/v1.validation.ts` (this file **asks** schemas; it does not own them). Distinct from leftover `app.ts` (mounts this default export **after** cron/webhook routers and Granot automation). This checkout’s `CONTEXT.md` is a pointer plus four employee-booking terms — knowledge links [Form Lead](../../../../CONTEXT.md), [Form Lead Ingestion](../../../../CONTEXT.md), [Ingestion Origin](../../../../CONTEXT.md), [Sheet Sync](../../../../CONTEXT.md); do not invent glossary copies. `docs/adr/` is absent here — knowledge cites ADR-0001 / ADR-0002 on the command complete path; do not invent ADR copies and do not reorder Sheet Sync vs CRM Posting in this file. Project-organization names `daily-operations-admin.routes.ts`; this checkout has no such file and no `src/services/dailyOperations/` — do not invent that mount. Do not add a Routes Service file in this rename.
- Callers: **one runtime mount plus two route tests.** Leftover `src/app.ts` **asks** the default export (`app.use(v1Routes)` after Granot automation, before ingestion / reporting). Tests on this **interface**: `v1.routes.test.ts` (registered paths; catalog `GET /admin/catalog/agents` vs browse `GET /admin/agents`; `granot-match` before `GET /form-leads/:id`; leftover `buildGranotSyncExpectedFilter` fill-only clauses; registry / CPL / employee-booking / conversations / extension-users / tariff path presence). Next `extension-granot-apply.test.ts` **asks** this default export only to prove the sibling router is mounted (`/form-leads/:id/granot-sync`, `/call-leads/enrichment/sync`). Next `tariff-adjustments.routes.test.ts` **asks** its own factory, not this file. Next `requireApiSecret.test.ts` names `/call-leads/enrichment/sync` as a Bearer path — that path lives on the sibling router this file mounts. Not this **interface**: `runExistingCreateFormLead` itself, leftover `ingestFormLead`, `applyExtensionGranotItem`, `appendTariffAdjustmentRows`, cron/webhook routers, `app.ts` health / `/db`.
- Seams callers need: unguarded extension login + Drive callback **before** `/api/v1` secret vs every data route **after**; public Form Lead ingest (logged, not `handleCanonicalCreate`) vs Call / Booking / Cancellation `handleCanonical*` vs leftover Customer `handleCreate`; catalog `GET /admin/catalog/agents` vs browse `GET /admin/agents` (Express first-match); `POST /form-leads/granot-match` before `GET /form-leads/:id`; already-extracted sibling routers vs leftover inline clusters; `sendError` leftover `{ ok: false, error: message }` vs registry `toHttpBody()` vs optional 5xx operational event; secret-only employee booking + `x-public-client-key-hash` vs Owner `requireOwnerActor` / `requireRegistryOwnerActor`; `POST /create-form-test` `withRuntimeDomainOverrides({ testMode: true, sheetSyncMode: "legacy" })` vs live `POST /form-leads`. There is no begin / complete Domain Command **seam** in this file (the command owns that). There is no webhook **seam**. There is no cron **seam**.
- Split later (only if the file outgrows one sitting): this ~3009-line file **cannot** be read in one sitting. Split by **story**, never CRUD: `admitThePublicV1Desk.ts` (mount order + shared parse / command / refuse helpers), `ingestThisFormLeadOverHttp.ts`, then later sibling routers for leftover inline clusters (registry / CPL, admin browse+export, analytics, observability, employee-booking recon, moving-carriers / testimonials / Granot CSV) the way tariff and extension-apply already left. Never `create.ts` / `update.ts` / `delete.ts`. Never a whole-folder recommendation that pretends this file is every Wave B router. Sibling extracted routers stay their own later passes.

`handleCreate` / `handleUpdate` / `handleDelete` / `handleCanonicalCreate` are executor mechanics. The owner question is: *Someone hit the public v1 desk. Admit unguarded login and the Drive callback first. Then require the secret for `/api/v1`. Parse the body. Ask the already-recommended command. Answer `{ ok, data }` or 204. If it is a website quote, log the ingest and do not hide it inside the generic create helper. If it is Agents on the dashboard, hand browse-with-metrics, not the catalog list. If the path is `/form-leads/granot-match`, do not steal it as an id. Do not put a data route before the secret. Do not treat leftover Customer writes as a command. Do not pretend Granot-sync still lives here — that extract already left, and `buildGranotSyncExpectedFilter` is a leftover test leak.*

Who applies the public write already lives in already-recommended `existingWrites.ts`. Who builds the trusted bag already lives in already-recommended `existingWriteContext.ts`. Who begins / completes Form Lead Ingestion already lives in already-recommended `formLead.service.ts`. Who applies an Owner extension snapshot already lives in already-recommended `extensionApply.ts` and will be the next sibling-router pass. Do not pull those in.

## What this file actually does

Five operations for the public v1 **desk**, not “a CRUD dump of every `/api/v1` verb,” and not Apply This Public Write / Append Onto Master / Capture A Granot Webhook:

1. **Admit the public v1 desk** — `router.use(extensionAuthRoutes)` then `router.use(googleDriveOAuthRoutes)` **before** `router.use("/api/v1", requireApiSecret)`. After the secret: RingCentral registry, Granot lifecycle admin, Job Number timeline, conversations, Extension Users, then the leftover inline registrations, then `createTariffAdjustmentsRouter()` and `createExtensionGranotApplyRouter()` between Form Lead POST and Form Lead PATCH. Leftover `app.ts` already mounted cron/webhook routers and Granot automation **before** this default export. This beat does **not** guard extension login. This beat does **not** mount ingestion / reporting (those are leftover `app.ts` after this file). This beat does **not** invent Daily Operations — that router is absent here.

2. **Ask a canonical command** — `handleCanonicalCreate` / `handleCanonicalUpdate` / `handleCanonicalDelete`: `connectMongo`, Zod parse, `existingWriteContextFromRequest({ req, command_name, payload, resource_id? })`, `runExisting*`, `201` / `200` / `204`. Call Lead ingest, Book This Lead, Book From Source, public Referral, Leadless, Cancellation, and the matching correct / remove paths use this **seam**. Persisted `command_name` strings stay `createFormLead` / `createCallLead` / `updateSourceOwnedLead` / `createBookingFromLead` / `createExistingReferralBooking` / `createLeadlessBooking` / `createCancellation` / `updateBookedLead` / `updateCancelledLead` / `delete*`. This beat does **not** connect inside the command. This beat does **not** call leftover `ingestFormLead`.

3. **Ingest a Form Lead over HTTP** — `POST /api/v1/form-leads` and `POST /api/v1/create-form-test` share `handleCreateFormLeadRequest`. Log received / body keys / sanitized preview, `connectMongo`, `createFormLeadSchema.parse`, `runExistingCreateFormLead`, log created (lead id, contact, sheet / CRM / messaging statuses), `201 { ok, data }`. The test path wraps the same beat in `withRuntimeDomainOverrides({ testMode: true, sheetSyncMode: "legacy" })`. Zod and leftover `AppError` warn; anything else errors. This beat is **not** `handleCanonicalCreate`. PATCH `/form-leads/:id` is a sibling correct: `updateFormLeadSchema` then `runExistingUpdateSourceOwnedLead({ lead_model: "FormLead" })` — also **not** `handleCanonicalUpdate`. GET `/form-leads/:id` **asks** already-recommended `findFormLeadForEnrichment` (Duplicate Lead is 404). `POST /form-leads/granot-match` **asks** leftover `resolveGranotFormLead` and must stay registered **before** `/:id`.

4. **Answer a leftover desk read or leftover non-command write** — browse / search / find-all / admin browse+export / analytics / observability / registry / CPL / testimonials / Moving Carriers / Granot CSV / lead-messages / employee-booking options+submit+recon. Registry mutations **ask** `requireRegistryOwnerActor`. Sheet-contains and employee-booking recon **ask** `requireOwnerActor`. Employee submit is secret-only plus `x-public-client-key-hash` (64 hex). Customer POST/PATCH/DELETE still **ask** leftover `handleCreate` / `handleUpdate` / `handleDelete` + `v1.service` — not `runExisting*`. Catalog `GET /admin/catalog/agents` is registered **before** the browse loop so Express first-match cannot hide metrics. This beat is the leftover inline cluster, not a second owner product. Extract later by story.

5. **Refuse and classify a failure** — `sendError`: Zod → `400` `{ error: "Invalid request payload", issues }`; Mongoose `VersionError` → `409`; leftover `AppError` / `V1ServiceError` → status + `{ error: message }` except registry errors use `toHttpBody()`; 5xx leftover `AppError` and unknown errors log and may `recordOperationalEvent` (`lead.route.failed` / `booking.route.failed` / `cancellation.route.failed` / `http.request.5xx`) when `shouldCaptureHttp5xx()`. `getValidObjectId` refuses a bad `:id` as leftover `V1ServiceError` 400 `"Invalid Mongo ObjectId"`.

`handleFindAll` / `handleFindOne` / `handleCreate` / `handleUpdate` / `handleDelete` / `buildGranotSyncExpectedFilter` are beats or leftovers inside these operations, not extra owner stories. `buildGranotSyncExpectedFilter` is exported because the folder test still asks a fill-only expected filter the sibling Granot-sync router **does not import**.

## Organization

This file cannot stay one sitting as a 3009-line verb dump. Reorganization first: keep the **desk** (admit + shared command / refuse helpers + Form Lead HTTP) in this file until later story extracts. Do not invent a `V1RoutesService` class. Do not invent a CRUD folder. Do not pull already-extracted sibling routers back in so “one file owns every path.” Do not move `runExisting*` or Zod schemas into this file so “the route owns the write.”

If it later outgrows the desk, split by **story**, not HTTP verb.

**External interface** stays small (this is the test surface):

| Keep exporting | Story name | Why the seam exists |
|---|---|---|
| `default` router | `publicV1Desk` | leftover `app.ts` mounts it after automation, before ingestion / reporting |
| `handleCreateFormLead` / `handleCreateFormLeadTest` (today unexported handlers) | `ingestThisFormLeadOverHttp` / `ingestThisFormLeadOverHttpInTestMode` | live quote vs `create-form-test` override — not `handleCanonicalCreate` |
| `handleCanonicalCreate` / `handleCanonicalUpdate` / `handleCanonicalDelete` | `askThisCanonicalCreate` / `askThisCanonicalCorrection` / `askThisCanonicalRemoval` | Call / Booking / Cancellation HTTP **seam**; persisted `command_name` stays |
| `sendError` | `refuseThisPublicV1Request` | Zod / version / leftover `AppError` / registry body / 5xx event |
| `buildGranotSyncExpectedFilter` | leftover extract leak | folder test only — sibling apply does **not** import it; unexport after the test drops it |

Keep the default export and the persisted `command_name` strings as one-line aliases until `app.ts` and the command registry migrate. Do not make callers learn `handleCreate` as the domain language. Do **not** keep `buildGranotSyncExpectedFilter` as a public **seam** after the test stops asking it. Do **not** export every `handle*` so “the test can unit the helper.” Do **not** rename persisted `createFormLead` / `updateSourceOwnedLead` / `createBookingFromLead`. Do **not** put Daily Operations onto this desk so “project-organization listed it.”

**No class for the workflow.** The one type that *does* earn a name is the pending HTTP handoff the canonical helper already builds:

```ts
type PublicV1CommandRequest = {
  parsed: unknown
  context: CanonicalCommandContext
}
```

That is the handoff from “the desk parsed the body” to “the already-recommended command applies it.” Do **not** add a Mongo `ClientSession` onto that bag so “the route owns the transaction.”

Leave sibling extracted routers on their files. Leave `requireApiSecret` on Wave B middleware. Leave Zod on Wave B validation. Leave `existingWriteContextFromRequest` / `runExisting*` on already-recommended domain-commands.

## The file, as a story

Parent functions stay deep. Child names are only extracted when they hide a real decision, not a one-liner.

```ts
// v1.routes.ts
// Someone hit the public v1 desk.
// Admit login first. Then require the secret. Then parse, ask the command, answer.

const publicV1Desk = Router()

// ── 1. Admit the public v1 desk ───────────────────────────

publicV1Desk.use(extensionAuthRoutes)          // unguarded login / refresh / me / logout
publicV1Desk.use(googleDriveOAuthRoutes)       // unguarded OAuth callback lives here
publicV1Desk.use("/api/v1", requireApiSecret)  // every data route after this
publicV1Desk.use(ringCentralRegistryRoutes)
publicV1Desk.use(granotLifecycleAdminRoutes)
publicV1Desk.use(jobNumberTimelineAdminRoutes)
publicV1Desk.use(conversationsAdminRoutes)
publicV1Desk.use(extensionUsersAdminRoutes)

registerCatalogBeforeAgentsBrowse(publicV1Desk) // GET /catalog/agents before GET /admin/agents
registerLeftoverInlineDeskReadsAndWrites(publicV1Desk)

publicV1Desk.post("/api/v1/form-leads/granot-match", matchThisGranotFormLead) // before /:id
publicV1Desk.get("/api/v1/form-leads/:id", findThisFormLeadForEnrichment)
publicV1Desk.post("/api/v1/create-form-test", ingestThisFormLeadOverHttpInTestMode)
publicV1Desk.post("/api/v1/form-leads", ingestThisFormLeadOverHttp)
publicV1Desk.use(createTariffAdjustmentsRouter())
publicV1Desk.use(createExtensionGranotApplyRouter()) // granot-sync + enrichment/sync
publicV1Desk.patch("/api/v1/form-leads/:id", correctThisSourceOwnedFormLeadOverHttp)
publicV1Desk.delete("/api/v1/form-leads/:id", askThisCanonicalRemoval("deleteFormLead", ...))

// ── 2. Ask a canonical command ────────────────────────────

function askThisCanonicalCreate(schema, commandName, create)
  // connectMongo → parse → existingWriteContextFromRequest → create → 201
function askThisCanonicalCorrection(schema, commandName, update)
function askThisCanonicalRemoval(commandName, remove)
  // cascade = query.cascade === "true"; Cancellation ignores cascade

export const handleCanonicalCreate = askThisCanonicalCreate
export const handleCanonicalUpdate = askThisCanonicalCorrection
export const handleCanonicalDelete = askThisCanonicalRemoval

// ── 3. Ingest a Form Lead over HTTP ───────────────────────

async function ingestThisFormLeadOverHttp(req, res)
async function ingestThisFormLeadOverHttpInTestMode(req, res)
  // withRuntimeDomainOverrides({ testMode: true, sheetSyncMode: "legacy" })

async function ingestThisFormLeadOverHttpRequest(req, res, logPrefix) {
  logTheQuoteArrival(req, logPrefix)
  await connectMongo()
  const parsed = createFormLeadSchema.parse(req.body)
  const data = (await runExistingCreateFormLead({
    data: parsed,
    context: existingWriteContextFromRequest({
      req,
      command_name: "createFormLead", // persisted — do not rename
      payload: parsed,
    }),
  })).data
  logTheQuoteResult(req, logPrefix, data)
  return res.status(201).json({ ok: true, data })
}

async function correctThisSourceOwnedFormLeadOverHttp(req, res)
  // updateFormLeadSchema → runExistingUpdateSourceOwnedLead({ lead_model: "FormLead" })
  // not askThisCanonicalCorrection — extra contact log only

// ── 4. Leftover desk reads / non-command writes ───────────
// extract later by story; do not dump every handle* here
function leftoverCustomerWriteStillUsesHandleCreate() // not runExisting*
function registerCatalogBeforeAgentsBrowse()

// ── 5. Refuse and classify a failure ──────────────────────

async function refuseThisPublicV1Request(req, res, error)
  // Zod 400 · VersionError 409 · AppError (+ registry toHttpBody) · 5xx event
function classifyThisRouteFailure(path)
  // booked-leads → booking.route.failed
  // cancelled-leads → cancellation.route.failed
  // form-leads | call-leads → lead.route.failed
  // else http.request.5xx

export function buildGranotSyncExpectedFilter(...) // leftover leak — unexport
export default publicV1Desk
```

Read the Form Lead ingest path out loud: *Admit the secret. Log that a quote arrived. Connect Mongo. Parse the landing-page body. Hand a trusted bag named `createFormLead` to the already-recommended command. Answer 201 with the lead, sheet status, CRM status, and messaging status. The test URL does the same story under TEST_MODE and legacy Sheet Sync. Do not hide this inside the generic create helper. Do not call leftover `ingestFormLead`. Do not run CRM or sheets in this file — the command complete already does. Do not steal `/form-leads/granot-match` as an id. Do not put this route before the secret.*

That is the operation. `handleCreateFormLeadRequest` is not.

## Precise logic I would tighten while renaming

These are real smells the story names make obvious. Do not “just rename.”

1. **Form Lead ingest is a second create adapter.** Call Lead uses `askThisCanonicalCreate`. Form Lead copies connect / parse / context / 201 and adds logging plus the test-mode override. Shared beats: connect, parse, trusted bag, `runExistingCreate*`, 201. Only the log prefix and `withRuntimeDomainOverrides` differ. Do not silently shove Form Lead into `handleCanonicalCreate` so “one helper owns every ingest” — the structured logs and test-mode wrap are load-bearing. Extract the shared ask; keep the Form Lead parent deep.

2. **Form Lead PATCH is a second correct adapter.** It is `askThisCanonicalCorrection` plus a contact log. Call Lead PATCH already uses the helper. Do not silently lose the log so “PATCH is generic.”

3. **Customer writes never entered the command.** `POST/PATCH/DELETE /customers` still **ask** leftover `createCustomer` / `updateCustomer` / `deleteCustomer` through `handleCreate` / `handleUpdate` / `handleDelete`. Do not silently wrap them in `runExisting*` so “every public write is a command.” That is a later Domain Command pass. Lock leftover `handleCreate` on Customer.

4. **`handleCreate` / `handleUpdate` / `handleDelete` survived the command migration.** After Customer is the last leftover caller, they are pass-throughs. Do not delete them in the same rename until Customer is proven the only caller. Do not teach Moving Carrier create to use `handleCanonicalCreate` so “catalog is a command.”

5. **`buildGranotSyncExpectedFilter` is a leftover extract leak.** Sibling `extension-granot-apply.routes.ts` owns `PATCH .../granot-sync` and **does not import** this function. The folder test still asks fill-only `$in` / zero-zip / null receiver clauses. Do not silently move the filter onto the sibling so “one file owns Granot-sync,” and do not delete it until the test drops. Do not thread it into `runExistingUpdateSourceOwnedLead({ expected })` — already-recommended existing-writes called that a different unused preview **seam**.

6. **Catalog vs browse first-match is load-bearing.** `GET /admin/catalog/agents` is registered before the `adminResources` loop that binds `GET /admin/agents` to browse+metrics. Express first-match. Do not silently register catalog list on `/admin/agents` so “one Agents path owns both.” The folder test already locks one browse GET and one catalog GET.

7. **`granot-match` must precede `/:id`.** Same first-match rule. Do not silently reorder so “id routes group together.”

8. **Tariff and extension-apply mount between Form POST and Form PATCH.** That is leftover insertion order, not an owner rule. Do not silently move those `router.use` calls to the top so “extracted routers live with the other mounts” unless a test proves Express matching depends on it. Sibling tests collect mounted paths from this default export.

9. **`sendError` is copied onto sibling routers.** Tariff and extension-apply each have a thinner refuse (no VersionError, no registry `toHttpBody`, no 5xx event). Do not silently invent a shared Wave B error **adapter** in this pass so “one refuse owns every router.” Leave sibling copies until those files’ passes.

10. **5xx classification is path-includes, not story.** `/booked-leads` → booking; `/cancelled-leads` → cancellation; `/form-leads` or `/call-leads` → lead; else `http.request.5xx`. Employee-booking, registry, observability, and `/create-form-test` fall through to `http`. Do not silently classify `/create-form-test` as `lead.route.failed` so “test ingest is a lead.” Lock path-includes.

11. **Cancellation delete ignores `cascade`.** `handleCanonicalDelete` still reads `query.cascade === "true"` and passes it; the Cancellation adapter’s `_cascade` drops it. Do not silently refuse `cascade=true` on Cancellation so “the query means something.”

12. **Do not silently fix ADR-0002 in this pass.** Sheet Sync finalize before CRM Posting lives on already-recommended `completeFormLeadIngestion`, not in this file. This desk only **asks** `runExistingCreateFormLead`. Rename the HTTP beats. Reorder only as a separate, tested command change.

13. **Leave sibling modules alone.** `existingWriteContextFromRequest`, `runExisting*`, `findFormLeadForEnrichment`, `requireApiSecret`, Zod schemas, and already-extracted sibling routers are already the right **depth**. This file orchestrates admit / parse / ask / answer.

## Testing

The **interface** is the test surface: the default `publicV1Desk` (registered paths + mount order) and `ingestThisFormLeadOverHttp` / `askThisCanonicalCreate` / `refuseThisPublicV1Request`.

Today’s `v1.routes.test.ts` only walks the Express stack for path presence, catalog-vs-browse first-match, `granot-match` before `/:id`, leftover `buildGranotSyncExpectedFilter` clauses, and a handful of registry / CPL / employee-booking / conversations / extension-users / tariff paths. That is not enough for a desk this long.

Replace the leftover filter unit with tests that name the operation:

**Admit**
- Extension login / Drive callback are registered on this desk **before** `/api/v1` secret (already implied by leftover unguarded list — lock the mount order, not a second secret).
- Sibling tariff and extension-apply paths are visible on this default export (already locked).
- `GET /admin/catalog/agents` and `GET /admin/agents` are each registered once (already locked).
- `POST /form-leads/granot-match` precedes `GET /form-leads/:id` (already locked).

**Ask a canonical command / ingest a Form Lead**
- `POST /form-leads` **asks** `runExistingCreateFormLead` with persisted `command_name: "createFormLead"` and answers 201 `{ ok, data }` — add a handler-level proof; do not only scan the path.
- `POST /create-form-test` wraps the same ask in `testMode: true` + `sheetSyncMode: "legacy"`.
- `POST /call-leads` uses `askThisCanonicalCreate` / `createCallLead`, not the Form Lead logger.
- `POST /customers` still **asks** leftover `createCustomer`, not `runExisting*`.
- Bad `:id` → 400 `"Invalid Mongo ObjectId"`.
- Zod fail → 400 `"Invalid request payload"` + `issues`.
- Leftover `AppError` 409 / 404 maps `{ ok: false, error: message }`.
- Registry errors use `toHttpBody()` — only if you keep a registry mutation proof on this desk.

**Not this file**
- `runExistingCreateFormLead` begin / complete / ADR-0002 order stays on already-recommended [form-lead.md](form-lead.md) / [domain-commands-existing-writes.md](domain-commands-existing-writes.md).
- `PATCH .../granot-sync` and `POST .../enrichment/sync` stay on next `extension-granot-apply.routes.ts`.
- Tariff pair / hidden spreadsheet id stay on next `tariff-adjustments.routes.ts`.
- Cron / webhook admit stay on their later route files.
- Wave B `requireApiSecret` Bearer / scoped-key / Sales 403 stay on the middleware pass.

Do **not** add a test per helper (`logTheQuoteArrival`, `classifyThisRouteFailure`, `leftoverCustomerWriteStillUsesHandleCreate`). Those names exist so the parent reads. If a helper test has to change when the helper is inlined, it was testing past the **interface**.

`buildGranotSyncExpectedFilter` stays exported only until the folder test drops it.

## What I would not do

- A `V1RoutesService` class with `create` / `update` / `delete`.
- Thirty two-line functions that only wrap `res.json({ ok: true, data })`.
- Moving this into a CRUD folder (`create.ts` / `update.ts` / `delete.ts`) or splitting one file per HTTP verb “for cleanliness.”
- Breaking the admit **seam**: unguarded extension / Drive stay before `/api/v1` secret; do not put a data route in front.
- Breaking the catalog-vs-browse first-match **seam** or the `granot-match` before `/:id` **seam**.
- Treating leftover `ingestFormLead`, sibling Granot-sync apply, tariff append, webhook capture, or a cron drain as this story.
- Inventing a shared `sendError` **adapter** that has only one caller in this pass.
- Silently wrapping Customer in `runExisting*`, shoving Form Lead into `handleCanonicalCreate`, deleting `buildGranotSyncExpectedFilter`, reordering ADR-0002, or inventing `daily-operations-admin.routes.ts` while recommending a rename.
- Jumping to `models/` / `validation/` / `config/domain/` / `middleware/` / `auth/` while this checklist has unchecked modules.
- Writing a whole-folder recommendation for `routes`.
