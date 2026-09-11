# Let The Signed Extension Owner Apply This Form Lead Granot Row After The Secret, Apply These Follow Up Snapshots In The Order They Sent Them, Then Apply These Booked Jobs Rows — Never Put This Desk Before The Secret, Never Admit Secret-Only Or Sales Or Leftover Employee, Never Call The Leftover CSV Writes, Never Write A Quoted Patch, Never Decide Identity, Never Publish The Webhook Queue — operational story

- Status: recommended
- Service: `routes` (Wave B, in-progress)
- Pass: 9 of this service — `extension-granot-apply.routes.ts`
- Remaining in this service: `tariff-adjustments.routes.ts`, `granot-automation.routes.ts`, `ingestion.routes.ts`, `reporting.routes.ts`, `granot-webhook.routes.ts`, `ringcentral-webhook.routes.ts`, `ringcentral-webhook-local.routes.ts`, `twilio-message-status.routes.ts`, `twilio-voice.routes.ts`, `ringcentral-cron.routes.ts`, `booking-reconciliation-cron.routes.ts`, `sheet-sync-cron.routes.ts`, `lead-messaging-cron.routes.ts`, `cpl-correction-cron.routes.ts`, `notification-cron.routes.ts`, `best-relocation-ingestion-cron.routes.ts`, `reporting-cron.routes.ts`, `granot-automation-cron.routes.ts`, `granot-lifecycle-cron.routes.ts`
- Target: `src/routes/extension-granot-apply.routes.ts`
- Knowledge: [`docs/knowledge/granot-lifecycle/extension-apply.md`](../../../docs/knowledge/granot-lifecycle/extension-apply.md) (Owner apply items on the existing v1 URLs capture a `browser_extension` receipt, enter `claimAndProcessOrPoll`, and return a PII-safe compatibility result; the extension does not decide identity; this path does **not** call leftover `syncCallLeadEnrichment`; preview URLs stay read-only; HTTP stays **200** `{ ok, data }`; missing/invalid secret is typically **401** on the parent; then leftover `requireExtensionOwnerInitiator` wants leftover `vantageAuth.kind === "user"` and leftover Owner; leftover Employee / leftover secret-only / leftover Admin / leftover unauthenticated create no receipt — **403 `GRANOT_OWNER_REQUIRED`**). Distinct from already-recommended public v1 desk: [routes-v1.md](routes-v1.md) (`router.use(createExtensionGranotApplyRouter())` on line 619, **after** leftover `createTariffAdjustmentsRouter()` and **before** leftover `PATCH /api/v1/form-leads/:id` — this file **is** that mount; leftover `buildGranotSyncExpectedFilter` still lives on that sibling and **this file does not import it**). Distinct from already-recommended unguarded login: [routes-extension-auth.md](routes-extension-auth.md) (admits the session **before** the secret — **does not import** this file). Distinct from already-recommended Owner Extension Users desk: [routes-extension-users-admin.md](routes-extension-users-admin.md) (issues / shows / corrects / revokes a login after the secret via leftover `requireRegistryOwnerActor` — **does not apply** a Granot row). Distinct from already-recommended Owner lifecycle admin: [routes-granot-lifecycle-admin.md](routes-granot-lifecycle-admin.md) (HMAC Owner intake / receipts / Booking commands — **does not import** this file). Distinct from already-recommended Wave A apply: [granot-lifecycle-extension-apply.md](granot-lifecycle-extension-apply.md) (`applyExtensionGranotItem` — this file **asks** it; it does **not** Zod-parse, does **not** filter leftover `lead_snapshot_apply` vs leftover `booking_action_apply`, does **not** compare the Owner session). Distinct from leftover Wave A CSV writes: [enrichment-call-lead-enrichment.md](enrichment-call-lead-enrichment.md) / [reconciliation-booked-call-lead.md](reconciliation-booked-call-lead.md) (`syncCallLeadEnrichment` / `syncBookedCallLeadReconciliation` — **this file must not call them**; leftover preview stays on already-recommended `v1.routes.ts`). Distinct from leftover ordinary Form Edit: leftover `PATCH /api/v1/form-leads/:id` on already-recommended `v1.routes.ts` (quoted / cubic feet — **not** Granot final-apply). Distinct from leftover HTTP automation apply: [granot-lifecycle-automation-apply.md](granot-lifecycle-automation-apply.md). Distinct from leftover webhook capture: [granot-lifecycle-capture.md](granot-lifecycle-capture.md) / next `granot-webhook.routes.ts`. Distinct from leftover Wave B Zod: `src/validation/v1/granotLifecycle.validation.ts` (`extensionGranotApplyItemSchema` / `extensionGranotApplyBatchSchema` leftover max 100 leftover unique `operation_id` — this file **asks** those; leftover credential-like keys never reach leftover `applyItem`). Distinct from leftover Wave B secret: next `requireApiSecret.ts` (already-recommended public v1 desk already ran it; leftover Sales Bearer is leftover **403 `"Forbidden"`** **before** this file). Distinct from leftover initiator fold: [durable-work-actors.md](durable-work-actors.md) (`createBrowserExtensionOwnerInitiator` — this file **asks** it after leftover `hasExtensionRole(..., "owner")`). Distinct from leftover speaking gate: [operations-registry-trusted-actor.md](operations-registry-trusted-actor.md) (**this file does not ask** leftover `requireRegistryOwnerActor`). This checkout’s `CONTEXT.md` is a pointer plus four employee-booking terms — knowledge links [Granot Observation Receipt](../../../../CONTEXT.md), [Observation Channel](../../../../CONTEXT.md), [Synchronization Decision](../../../../CONTEXT.md), [System of Record](../../../../CONTEXT.md); do not invent a glossary copy. `docs/adr/` is absent here — knowledge cites ADR-0001 on the Service; do not invent ADR copies. Project-organization names `daily-operations-admin.routes.ts`; this checkout has no such file — do not invent that mount. Do not add a Routes Service file in this rename.
- Callers: **one runtime mount plus one focused route test plus a folder mount proof plus a secret-middleware proof.** Already-recommended `v1.routes.ts` **asks** leftover `createExtensionGranotApplyRouter()` on line 619 (**after** `/api/v1` secret, after leftover Tariff, before leftover Form PATCH). Leftover `src/app.ts` mounts the public v1 desk, not this file. Tests on this **interface**: `extension-granot-apply.test.ts` (injects leftover `createExtensionGranotApplyRouter` deps; stamps leftover `vantageAuth` from leftover `x-test-role`; names leftover Owner Form apply **200** leftover `browser_extension` leftover `owner` leftover raw Priority leftover no leftover `quoted`; leftover Admin-shaped missing / leftover Employee / leftover Sales / leftover Customer Service / leftover secret-only **403 `GRANOT_OWNER_REQUIRED`** with leftover `applied.length === 0` and leftover `"MIKE"` omitted; leftover Zod unknown leftover `patch` / leftover junk UUID / leftover Booked-on-snapshot **400** and no leftover apply; leftover enrichment batch leftover input order then leftover duplicate `operation_id` **400**; leftover booked-reconciliation leftover `lead_snapshot_apply` **400** then leftover `booking_action_apply` **200**; leftover typeof leftover CSV writers still exist; leftover credential-like leftover `authorization` **400 `GRANOT_VALIDATION_FAILED`** without leftover `"secret-value"`). It does **not** name leftover `expected_target` leftover URL disagreement. It does **not** name leftover junk Form `:id`. It does **not** name leftover enrichment leftover `booking_action_apply`. It does **not** name leftover Call leftover `expected_target.model === "FormLead"`. It does **not** name leftover mid-batch leftover apply-then-throw. It does **not** name leftover `sendError` leftover rethrow. Folder `v1.routes.test.ts` only proves leftover `PATCH .../granot-sync` is mounted — it does **not** name leftover enrichment leftover `/sync` or leftover booked-reconciliation leftover `/sync` (this file’s test walks leftover `v1.routes` leftover `stack` for all three). Leftover `requireApiSecret.test.ts` names leftover Sales Bearer leftover **403 `"Forbidden"`** on leftover `PATCH .../granot-sync` and leftover `POST .../enrichment/sync` — that is the parent secret, not this desk. Already-recommended Wave A `extensionApply.test.ts` proves leftover capture / leftover claim / leftover safe sentence through the service, not this router. Operator skill lists leftover `PATCH .../granot-sync` and both leftover `/sync` writes. Not this **interface**: leftover `applyExtensionGranotItem` itself, leftover `syncCallLeadEnrichment`, leftover `syncBookedCallLeadReconciliation`, leftover `requireRegistryOwnerActor`, leftover ordinary Form PATCH, leftover preview POSTs.
- Seams callers need: after `/api/v1` secret (parent mount) vs leftover Drive / leftover extension login **before**; leftover signed Extension Owner session (`vantageAuth.kind === "user"` + leftover `hasExtensionRole(roles, "owner")`) vs leftover Admin HMAC leftover `requireRegistryOwnerActor` (**this file does not ask** the HMAC gate); leftover Form one-item vs leftover Call leftover `{ items }` leftover sequential apply; leftover enrichment leftover `lead_snapshot_apply` only vs leftover booked-reconciliation leftover `booking_action_apply` only vs leftover Form URL **no leftover kind filter**; leftover Form leftover URL `:id` vs leftover `expected_target` (Call leftover id check is leftover tautological — see Precise logic); leftover factory `createExtensionGranotApplyRouter(deps)` (test injection) vs default export (live mount); leftover `sendError` leftover `isGranotLifecycleError` → leftover `error.toHttpBody()` vs leftover `ZodError` → **400** leftover `GRANOT_VALIDATION_FAILED` leftover `"Invalid request"` leftover flattened leftover `issues` vs **anything else leftover rethrown** (no leftover 500 envelope). There is no begin / complete Domain Command **seam** in this file. There is no leftover CSV-write **seam**. There is no leftover queue-publish **seam**. There is no leftover HMAC Owner **seam**.
- Split later (only if the file outgrows one sitting): this ~201-line file is one sitting if you read it as let the signed Extension Owner apply this Form Lead Granot row after the secret, apply these Follow Up snapshots in the order they sent them, then apply these Booked Jobs rows — never put this desk before the secret, never admit secret-only or Sales or leftover Employee, never call the leftover CSV writes, never write a quoted patch, never decide identity, never publish the webhook queue. Do not split. Never `form-sync.ts` / `enrichment-sync.ts` / `booked-sync.ts`. Capture / claim / safe sentence stay already-recommended `extensionApply.ts`. Kind / UUID / leftover batch-100 stay leftover Zod plus the two Call leftover kind fences. Login stays already-recommended `extension-auth.routes.ts`. Ordinary Form Edit and leftover preview stay already-recommended `v1.routes.ts`.

`router.patch("/api/v1/form-leads/:id/granot-sync")` / `router.post("/api/v1/call-leads/enrichment/sync")` / `router.post("/api/v1/call-leads/booked-reconciliation/sync")` are HTTP verbs. The owner question is: *The Owner already signed into the Granot extension and someone already passed the API secret. On the Form they clicked apply — parse one leftover item, refuse when leftover `expected_target` disagrees with leftover FormLead plus the URL id, then ask the already-recommended apply and answer 200 with a safe sentence. On Follow Up they clicked apply on a batch — refuse anything that is not leftover `lead_snapshot_apply`, keep leftover input order, then ask apply once per leftover item. On Booked Jobs they clicked apply on a batch — refuse anything that is not leftover `booking_action_apply`. Sales, leftover Employee, leftover secret-only, and leftover unauthenticated create no receipt. Do not put this desk before the secret. Do not call leftover Follow Up CSV write. Do not write leftover `quoted`. Do not decide identity. Do not wake the webhook queue.*

Who captures the leftover `browser_extension` receipt and claims it already lives in already-recommended `extensionApply.ts`. Who admits the Granot extension without the secret already lives in already-recommended `extension-auth.routes.ts`. Who may speak as leftover HMAC Owner already lives in already-recommended `trustedActor.ts` — **this desk does not use that gate**. Who forbids leftover credential-like leftover statement keys already lives in leftover `extensionGranotApplyItemSchema`. Do not pull those in.

## What this file actually does

Three operations for the Owner extension **apply desk**, not “a granot-sync CRUD dump,” and not Apply This Owner-Approved Granot Row From The Extension itself:

1. **Apply this Owner-approved Form Lead Granot row after the secret** — `PATCH /api/v1/form-leads/:id/granot-sync`. **Ask** leftover `requireExtensionOwnerInitiator` **before** leftover `connect`. Parse leftover `:id` with leftover `mongoose.isValidObjectId`. **Ask** leftover `connect`. Parse leftover `extensionGranotApplyItemSchema`. **Ask** leftover `assertExpectedTarget(item, "FormLead", leadId)`. **Ask** leftover `applyItem` (injected, or leftover `applyExtensionGranotItem`) with leftover initiator / leftover `req.headers` / leftover `request_id`. Answer **200** `{ ok: true, data }` (one leftover answer). This beat does **not** remount leftover `requireApiSecret`. This beat does **not** filter leftover `operation_kind`. This beat does **not** write leftover `quoted`. This beat does **not** **ask** leftover `runExistingUpdateSourceOwnedLead`.

2. **Apply these Owner-approved Follow Up snapshots in the order they sent them** — `POST /api/v1/call-leads/enrichment/sync`. Same leftover initiator then leftover `connect`. Parse leftover `extensionGranotApplyBatchSchema` (leftover 1–100 leftover unique leftover `operation_id`). For each leftover item: refuse leftover `operation_kind !== "lead_snapshot_apply"` with leftover `GranotLifecycleError` leftover **400** leftover `"Call enrichment permits only lead_snapshot_apply"`; **ask** leftover `assertExpectedTarget(item, "CallLead", item.expected_target?.id)`; leftover `await applyItem` and leftover `push`. Answer **200** `{ ok: true, data }` (leftover answers in leftover input order). This beat does **not** **ask** leftover `syncCallLeadEnrichment`. This beat does **not** **ask** leftover preview. This beat does **not** roll back leftover earlier leftover items when a later leftover item throws.

3. **Apply these Owner-approved Booked Jobs rows** — `POST /api/v1/call-leads/booked-reconciliation/sync`. Same leftover initiator / leftover connect / leftover batch parse. For each leftover item: refuse leftover `operation_kind !== "booking_action_apply"` with leftover **400** leftover `"Booked reconciliation permits only booking_action_apply"`; leftover CallLead leftover `expected_target` when present; leftover sequential leftover `applyItem`. Answer **200** `{ ok: true, data }`. This beat does **not** **ask** leftover `syncBookedCallLeadReconciliation`. This beat does **not** strip leftover raw leftover `Booked` leftover evidence — leftover Zod already required leftover `event_type`.

`requireExtensionOwnerInitiator` / leftover `requireObjectIdParam` / leftover `assertExpectedTarget` / leftover `requestId` / leftover `sendError` are beats inside these operations, not extra owner stories. Leftover initiator throws leftover **403 `GRANOT_OWNER_REQUIRED`** leftover `"Extension apply requires an authenticated Owner session"` unless leftover `vantageAuth.kind === "user"` **and** leftover `hasExtensionRole(auth.roles, "owner")`, then leftover `createBrowserExtensionOwnerInitiator({ actor_id: userId, actor_label: email, request_id: requestId ?? userId })`. Leftover `requestId` prefers leftover `req.id`, else leftover `x-request-id` — it does **not** read leftover `x-vantage-admin-request-id`. Leftover `sendError` is leftover `isGranotLifecycleError` → leftover `toHttpBody()`; leftover `ZodError` → **400** `{ ok: false, code: GRANOT_VALIDATION_FAILED, error: "Invalid request", request_id, issues: [{ path, message }] }`; else leftover **`throw error`**. They are private.

There is no fourth leftover HMAC or leftover CSV operation. Three leftover HTTP **adapters** on one leftover factory over one leftover apply. Leftover Form leftover kind-free parse and leftover Call leftover kind fences are leftover URL **adapters** — do not collapse them so “one `/sync` owns every apply.”

## Organization

Keep one file. This is the screenplay for “after the secret, let a signed Extension Owner apply this Form Lead Granot row, apply these Follow Up snapshots in the order they sent them, then apply these Booked Jobs rows — never admit secret-only or Sales or leftover Employee, never call the leftover CSV writes, never write a quoted patch, never decide identity, never publish the webhook queue.” Already-recommended leftover apply / leftover capture / leftover claim / leftover login / leftover HMAC Owner / leftover CSV writes already live in deeper **modules**. Do not pull those in. Do not invent an `ExtensionGranotApplyRoutesService` class. Do not invent a begin / complete Domain Command **seam**. Do not invent a leftover CSV **adapter** so “`/enrichment/sync` can still write Follow Up.” Do not invent a leftover HMAC **adapter** so “Admin Dashboard can apply without the extension.” Do not invent a CRUD folder so `form-sync.ts` / `enrichment-sync.ts` / `booked-sync.ts` each get a file.

Do not move leftover `applyExtensionGranotItem` into this file so “the route owns the receipt.” Do not mount this router before leftover `requireApiSecret` so “it matches leftover extension login.” Do not merge this router into leftover `granot-lifecycle-admin.routes.ts` so “one file owns every Granot Owner path.” Do not merge this router into leftover `v1.routes.ts` so “one file owns leftover `granot-sync`.” Do not import leftover `buildGranotSyncExpectedFilter` so “one file owns Granot-sync.” Do not split `form-sync.ts` / `enrichment-sync.ts` / `booked-sync.ts`.

**External interface** stays small (this is the test surface):

| Keep exporting | Story name | Why the seam exists |
|---|---|---|
| `createExtensionGranotApplyRouter` | `createOwnerExtensionApplyDesk` | leftover factory injects connect / applyItem for the route test |
| `default` router | `ownerExtensionApplyDesk` | already-recommended public v1 desk mounts the zero-arg instance **after** the secret |
| `PATCH .../form-leads/:id/granot-sync` (today unexported handler) | `applyThisOwnerApprovedFormLeadGranotRowAfterTheSecretOverHttp` | Owner Form apply; leftover one item; leftover URL id vs leftover FormLead leftover `expected_target`; leftover **200** one leftover answer |
| `POST .../call-leads/enrichment/sync` (today unexported handler) | `applyTheseOwnerApprovedFollowUpSnapshotsInTheOrderTheySentThemOverHttp` | Owner Follow Up apply; leftover `lead_snapshot_apply` only; leftover sequential leftover answers |
| `POST .../call-leads/booked-reconciliation/sync` (today unexported handler) | `applyTheseOwnerApprovedBookedJobsRowsOverHttp` | Owner Booked Jobs apply; leftover `booking_action_apply` only; leftover sequential leftover answers |
| `ExtensionGranotApplyRouteDeps` | `OwnerExtensionApplyDeskDeps` | test injection bag — connect / applyItem |

Keep the default export and the factory as one-line aliases until `v1.routes.ts` and the route test migrate. Do not make callers learn `extensionGranotApplyItemSchema` / `sendError` / `requireExtensionOwnerInitiator` as the domain language. Do **not** export the handlers so “the test can unit the helper.” Do **not** export leftover Zod onto a new barrel in this rename — leave that for the validation pass. Do **not** rename leftover `applyExtensionGranotItem` here — that stays already-recommended Wave A. Do **not** add leftover `POST .../preview` so “apply can also search.” Do **not** add leftover `PATCH .../form-leads/:id` so “quoted lives on this desk.”

**No class for the workflow.** The one type that *does* earn a name is the HTTP handoff leftover batches already paint after leftover sequential leftover `applyItem`:

```ts
type OwnerExtensionApplyBatchResponse = {
  ok: true
  data: ExtensionGranotApplyResult[]
}
```

That is the handoff from “these leftover rows were asked in leftover input order” to “the extension can refresh each leftover `operation_id`.” Do **not** add leftover `error_code` onto that bag. Do **not** add leftover `quoted` onto that bag. Do **not** collapse leftover Form leftover `{ data: one }` into leftover `{ data: [one] }` so “every URL is a batch.”

A second named bag already exists for the leftover apply answer (already-recommended leftover `ExtensionApplyAnswer`). Do **not** re-declare it here. Leave leftover `applyExtensionGranotItem` on already-recommended `extensionApply.ts`. Leave leftover initiator fold on already-recommended `createBrowserExtensionOwnerInitiator`. Leave leftover UUID / leftover batch-100 / leftover credential-like keys on leftover `extensionGranotApplyItemSchema`. Leave leftover login on already-recommended `extension-auth.routes.ts`. Leave leftover HMAC Owner on already-recommended `trustedActor.ts`. Leave leftover Follow Up leftover preview / leftover ordinary Form Edit on already-recommended `v1.routes.ts`. Leave the global `/api/v1` secret on leftover `requireApiSecret` (parent mount).

## The file, as a story

Parent functions stay deep. Child names are only extracted when they hide a real decision, not a one-liner.

```ts
// extension-granot-apply.routes.ts
// Someone already passed the API secret.
// The Owner already signed into the Granot extension.
// Let them apply this Form Lead Granot row.
// Let them apply these Follow Up snapshots in the order they sent them.
// Let them apply these Booked Jobs rows.
// Do not put this desk before the secret.
// Do not admit secret-only, Sales, or leftover Employee.
// Do not call the leftover CSV writes.
// Do not write a quoted patch.
// Do not decide identity.
// Do not publish the webhook queue.

export function createOwnerExtensionApplyDesk(deps = {}) {
  const ownerExtensionApplyDesk = Router()
  const connect = deps.connect ?? connectMongo
  const applyThisApprovedRow = deps.applyItem ?? applyExtensionGranotItem

  // ── 1. Apply this Owner-approved Form Lead Granot row after the secret ─

  ownerExtensionApplyDesk.patch(
    "/api/v1/form-leads/:id/granot-sync",
    applyThisOwnerApprovedFormLeadGranotRowAfterTheSecretOverHttp,
  )

  // ── 2. Apply these Owner-approved Follow Up snapshots in the order they sent them ─

  ownerExtensionApplyDesk.post(
    "/api/v1/call-leads/enrichment/sync",
    applyTheseOwnerApprovedFollowUpSnapshotsInTheOrderTheySentThemOverHttp,
  )

  // ── 3. Apply these Owner-approved Booked Jobs rows ─

  ownerExtensionApplyDesk.post(
    "/api/v1/call-leads/booked-reconciliation/sync",
    applyTheseOwnerApprovedBookedJobsRowsOverHttp,
  )

  return ownerExtensionApplyDesk
}

async function applyThisOwnerApprovedFormLeadGranotRowAfterTheSecretOverHttp(req, res) {
  const initiator = requireTheSignedExtensionOwner(req)  // 403 before connect
  const leadId = requireTheFormLeadIdInTheUrl(req)       // mongoose.isValidObjectId
  await connect()
  const item = parseOneApprovedRow(req.body)            // leftover item Zod
  refuseWhenExpectedTargetDisagreesWithTheFormUrl(item, leadId, req)
  const data = await applyThisApprovedRow({
    item,
    initiator,
    headers: req.headers,
    request_id: requestIdOnThisApply(req),
  })
  return res.json({ ok: true, data })
}

async function applyTheseOwnerApprovedFollowUpSnapshotsInTheOrderTheySentThemOverHttp(req, res) {
  const initiator = requireTheSignedExtensionOwner(req)
  await connect()
  const parsed = parseTheApprovedBatch(req.body)        // leftover 1–100 unique ids
  const data = []
  for (const item of parsed.items) {
    refuseUnlessThisIsALeadSnapshot(item, req)          // not booking_action_apply
    refuseWhenExpectedTargetDisagreesWithCallLead(item, req)
    data.push(await applyThisApprovedRow({ item, initiator, headers: req.headers, request_id: requestIdOnThisApply(req) }))
  }
  return res.json({ ok: true, data })
}

async function applyTheseOwnerApprovedBookedJobsRowsOverHttp(req, res) {
  const initiator = requireTheSignedExtensionOwner(req)
  await connect()
  const parsed = parseTheApprovedBatch(req.body)
  const data = []
  for (const item of parsed.items) {
    refuseUnlessThisIsABookingAction(item, req)         // not lead_snapshot_apply
    refuseWhenExpectedTargetDisagreesWithCallLead(item, req)
    data.push(await applyThisApprovedRow({ item, initiator, headers: req.headers, request_id: requestIdOnThisApply(req) }))
  }
  return res.json({ ok: true, data })
}

function refuseTheDesk(res, error, requestId) {
  if (isGranotLifecycleError(error)) {
    return res.status(error.statusCode).json(error.toHttpBody())
  }
  if (error instanceof ZodError) {
    return res.status(400).json({
      ok: false,
      code: GRANOT_VALIDATION_FAILED,
      error: "Invalid request",
      request_id: requestId ?? null,
      issues: error.issues.map((issue) => ({
        path: issue.path.join("."),
        message: issue.message,
      })),
    })
  }
  throw error
}
```

Read the desk path out loud: *Someone already passed the API secret. A signed Extension Owner clicks apply. On the Form, prove Owner before connect, parse the URL id and one leftover item, refuse when leftover `expected_target` is not leftover FormLead plus that id, then ask apply and answer 200. On Follow Up, parse the leftover batch, refuse leftover Booked Jobs leftover kind, ask apply in leftover input order. On Booked Jobs, refuse leftover snapshot leftover kind. Sales, leftover Employee, leftover secret-only, and leftover unauthenticated create no receipt. Do not write leftover `quoted`. Do not call leftover CSV write.*

That is the operation. `router.post("/api/v1/call-leads/enrichment/sync")` is not.

## Precise logic I would tighten while renaming

These are real smells the story names make obvious. Do not “just rename.”

1. **This desk sits after the secret. Leftover extension login does not.** Already-recommended public v1 desk mounts this file **after** `router.use("/api/v1", requireApiSecret)`, after leftover Tariff, before leftover ordinary Form PATCH. This file therefore does **not** remount leftover `requireApiSecret`. Leftover Sales Bearer is leftover **403 `"Forbidden"`** on leftover `requireApiSecret.test.ts` **before** leftover `vantageAuth` reaches this file. The route test stamps leftover `vantageAuth` and then leftover Sales is leftover **403 `GRANOT_OWNER_REQUIRED`**. Do not silently add per-route leftover `requireApiSecret` so “it matches Drive.” Do not silently move this mount before the global guard so “the extension can apply without a secret.” Do not merge this router into already-recommended leftover `extension-auth.routes.ts` so “one Extension User file owns login and apply.”

2. **This is leftover Extension Owner session, not leftover HMAC Owner.** Sibling leftover Extension Users / leftover conversations / leftover Job Number leftover desks **ask** leftover `requireRegistryOwnerActor`. This file **asks** leftover `hasExtensionRole(auth.roles, "owner")` on leftover `vantageAuth.kind === "user"`. Knowledge still says leftover `role === "owner"` singular. The code reads leftover `roles[]`. Do not silently **ask** leftover `requireRegistryOwnerActor` so “every Owner desk matches.” Do not silently accept leftover Admin HMAC so “the Admin Dashboard can apply.” Do not silently teach leftover extension Sales Bearer to apply so “the salesperson can sync Follow Up.”

3. **Leftover Form URL does not filter leftover `operation_kind`. The two leftover Call URLs do.** Leftover Zod already allows leftover `lead_snapshot_apply` **or** leftover `booking_action_apply` on leftover one leftover item. Leftover Form apply will leftover `applyItem` a leftover `booking_action_apply` leftover Booked leftover row if leftover `expected_target` is leftover FormLead. Wave A leftover apply rec says leftover kind filters live on the route — they live on leftover enrichment / leftover booked-reconciliation only. Do not silently refuse leftover `booking_action_apply` on leftover Form so “every URL has a leftover kind fence” without a paired test. Do not silently drop leftover Call leftover kind fences so “Zod already owns leftover event_type.”

4. **Leftover Call leftover `assertExpectedTarget` leftover id is leftover tautological.** Leftover Form passes leftover URL leftover `leadId`. Leftover enrichment / leftover booked-reconciliation pass leftover `item.expected_target?.id` as leftover `id`, then leftover compare leftover `expected_target.id !== id`. Leftover model leftover `CallLead` is the only leftover Call leftover check. Do not silently invent leftover `:id` on leftover `/enrichment/sync` so “id agreement is real.” Do not silently skip leftover Form leftover URL leftover id so “every URL is leftover model-only.”

5. **Leftover `buildGranotSyncExpectedFilter` is a leftover extract leak on the sibling.** Already-recommended leftover `v1.routes.ts` still exports it; leftover folder test still asks leftover fill-only leftover `$in`. This file **does not import** it and leftover `applyItem` does **not** take leftover `{ expected }`. Do not move the leftover filter onto this file so “one file owns Granot-sync.” Do not thread it into leftover `runExistingUpdateSourceOwnedLead`. Already parked on leftover `CONTRADICTIONS.md`.

6. **Leftover sequential leftover batch can leftover apply then leftover throw.** Leftover `for` leftover `await applyItem` leftover `push`. A leftover second leftover item leftover Zod-passed leftover kind refuse or leftover apply leftover throw leaves leftover first leftover receipt already captured. Do not silently wrap leftover items in leftover `Promise.all` so “order does not matter.” Do not silently invent leftover two-phase leftover begin/complete so “the batch is a Domain Command.” Park leftover partial leftover apply.

7. **Leftover `sendError` leftover rethrows.** Sibling leftover Extension Users leftover `sendError` leftover maps leftover unhandled to leftover **500** leftover `error.message`. Leftover Job Number leftover maps leftover `"Internal error"` and leftover logs. This desk leftover `throw error` for leftover non-Granot leftover non-Zod. Leftover `CaptureUnavailableError` leftover is leftover `GranotLifecycleError` leftover **503** leftover `toHttpBody()` — that leftover path is leftover mapped. A leftover plain leftover `Error` leftover becomes leftover Express leftover unhandled. Do not silently swallow leftover throws into leftover `"Internal error"` in this rename — park the gap. Do not silently import leftover Job Number leftover `sendError` so “one refuse owns every Owner desk.”

8. **Leftover Zod leftover `"Invalid request"` leftover flattened leftover `issues`.** Leftover Extension Users leftover `"Invalid request payload"` leftover raw leftover `error.issues`. Leftover conversations leftover `"invalid_conversation_query"` leftover has **no** leftover `issues`. This desk leftover maps leftover `path.join(".")` + leftover `message` and leftover stamps leftover `GRANOT_VALIDATION_FAILED`. Leftover credential-like leftover keys leftover fail leftover Zod leftover before leftover `applyItem`; leftover route test leftover locks leftover `"secret-value"` leftover omitted. Do not silently drop leftover `issues` so “it matches leftover conversations.” Do not silently echo leftover statement leftover values so “the owner sees which leftover key.”

9. **Leftover initiator leftover runs leftover before leftover `connect`.** Leftover 403 leftover creates leftover no leftover Mongo leftover hop. Leftover Form leftover ObjectId leftover also leftover before leftover `connect`. Do not silently leftover `connect` leftover first so “every path opens Mongo.” Do not leftover persist leftover a leftover receipt leftover on leftover 403.

10. **`requestId` ignores the admin request header.** Sibling Extension Users prefers `x-vantage-admin-request-id`. This desk prefers `req.id`, then `x-request-id`. Initiator `request_id` falls back to `auth.userId` because `createBrowserExtensionOwnerInitiator` wants a string. Do not silently read the admin HMAC header so “every Owner desk matches.” Do not pass `undefined` into the actor factory.

11. **This file does not capture, does not claim, and does not write a Lead.** Already-recommended Wave A rec already names capture / claim / expected-target conflict translation as service beats. Injected `applyItem` in the route test never claims. Do not import `captureChannelOperationReceipt` so “PATCH is extra safe.” Do not import `claimAndProcessOrPoll` so “the route can skip accepted.” Do not import `syncCallLeadEnrichment` so “the `/sync` path matches the name.”

12. **Success is always 200.** Already-recommended apply may answer `processing_state: "accepted_for_processing"`. This desk does not map that onto **202**. Knowledge: HTTP stays **200**. Do not silently answer **202** so “accepted looks like webhook capture.” Do not silently answer **201** so “apply looks like issue an Extension User.”

13. **The host rule lists these three as public v1.** They live on this sibling mount. Already-recommended `routes-v1.md` already parked “do not add a second handler on `v1.routes.ts`.” Folder `v1.routes.test.ts` only locks `PATCH .../granot-sync`. Do not drop `/booked-reconciliation/sync` so “the folder test wins.” Do not edit the host rule in this rename.

14. **Leave sibling modules alone.** `applyExtensionGranotItem` / `createBrowserExtensionOwnerInitiator` / `extensionGranotApplyItemSchema` / `hasExtensionRole` are already the right **depth**. This file orchestrates the HTTP **adapters**.

15. **Do not treat HMAC lifecycle admin, Tariff, ordinary Form Edit, Follow Up preview, webhook capture, or HTTP automation as this story.** Next `tariff-adjustments.routes.ts` is Binding Estimate Fee after login. Preview POSTs stay on already-recommended `v1.routes.ts`. Do not teach this file `database_scope`.

16. **Do not silently restore a quoted patch or an identity decision.** Knowledge: the statement is the full bounded Granot row; no `quoted` Boolean; the extension does not decide identity. Do not return `{ quoted: true }` from Form apply, and do not call `resolveIdentity` so “the route can pick the Lead.”

## Testing

The **interface** is the test surface: `createOwnerExtensionApplyDesk` (mounted on already-recommended `publicV1Desk` **after** the secret) and `applyThisOwnerApprovedFormLeadGranotRowAfterTheSecretOverHttp` / `applyTheseOwnerApprovedFollowUpSnapshotsInTheOrderTheySentThemOverHttp` / `applyTheseOwnerApprovedBookedJobsRowsOverHttp`.

Today `extension-granot-apply.test.ts` already names Owner Form apply **200** `browser_extension` with no `quoted`; missing / Employee / Sales / Customer Service / secret-only **403 `GRANOT_OWNER_REQUIRED`** with no apply and no `"MIKE"`; Zod unknown `patch` / junk UUID / Booked-on-snapshot **400**; enrichment input order then duplicate **400**; booked-reconciliation kind fence; typeof CSV writers still exist; credential-like **400** without `"secret-value"`; and all three paths on the `v1.routes` stack. It misses Form `expected_target` URL disagreement, junk Form `:id`, enrichment `booking_action_apply`, Call `expected_target.model === "FormLead"`, mid-batch apply-then-throw, `sendError` rethrow, Owner on the two POSTs (auth denials are Form only), and `/enrichment/sync` plus `/booked-reconciliation/sync` mount on `v1.routes.test.ts`. Already-recommended Wave A files prove capture / claim / safe sentence through the service — not this desk.

Keep the inject-and-stamp `x-test-role` style. Add the missing operations (do not boot Mongo hop, capture, claim, CSV `--apply`, HMAC sign, or ordinary Form PATCH in the route file):

**After the secret / who may speak**
- This desk is registered on `publicV1Desk` **after** `router.use("/api/v1", requireApiSecret)` and has **no** per-route `requireApiSecret`.
- All three paths **ask** `requireTheSignedExtensionOwner`. Sales / Employee **403 `GRANOT_OWNER_REQUIRED`**. Secret-only **403**. Missing `vantageAuth` **403**. HMAC Owner is **not** a hatch.
- Parent Sales Bearer **403 `"Forbidden"`** stays on `requireApiSecret.test.ts`. Do not remap that onto `GRANOT_OWNER_REQUIRED` in this file.

**Form apply after the secret**
- Owner `PATCH .../granot-sync` **asks** `applyItem` once and does **not** **ask** `runExistingUpdateSourceOwnedLead`.
- Initiator `origin` is `"browser_extension"` and `actor_role` is `"owner"`.
- `quoted` is **not** on `item`.
- `expected_target: { model: "CallLead", id }` or id ≠ URL answers **400** `"expected_target must agree with the apply URL"` and does **not** **ask** `applyItem`.
- `not-an-id` URL answers **400** `"Form apply target id is invalid"` before `connect`.
- Omitted `expected_target` **asks** `applyItem`.
- This beat does **not** filter `operation_kind`.

**Follow Up snapshots in input order**
- Owner `POST .../enrichment/sync` **asks** `applyItem` once per item and `data[].operation_id` matches input order.
- `booking_action_apply` on enrichment answers **400** `"Call enrichment permits only lead_snapshot_apply"` and does **not** **ask** `applyItem` for that item (earlier items may already have been asked — name that partial apply).
- `expected_target.model === "FormLead"` answers **400**.
- Duplicate `operation_id` answers Zod **400** and `applied.length === 0`.
- This beat does **not** **ask** `syncCallLeadEnrichment`.

**Booked Jobs rows**
- Owner `POST .../booked-reconciliation/sync` `lead_snapshot_apply` answers **400** `"Booked reconciliation permits only booking_action_apply"`.
- `booking_action_apply` with Booked `event_type` **asks** `applyItem`.
- This beat does **not** **ask** `syncBookedCallLeadReconciliation`.

**Refuse body**
- `isGranotLifecycleError` answers `error.toHttpBody()` including `request_id`.
- `ZodError` answers `"Invalid request"` `GRANOT_VALIDATION_FAILED` flattened `issues` and omits statement values.
- Non-Granot non-Zod **rethrows** (no 500 envelope).

**Mount**
- Folder `v1.routes.test.ts` should name `PATCH .../granot-sync` **and** `POST .../enrichment/sync` **and** `POST .../booked-reconciliation/sync`, not `granot-sync` alone.

**Not this file**
- Capture / claim / safe sentence / expected-target conflict translation stay on already-recommended [granot-lifecycle-extension-apply.md](granot-lifecycle-extension-apply.md).
- Login / refresh / logout stay on already-recommended [routes-extension-auth.md](routes-extension-auth.md).
- HMAC Owner desks stay on already-recommended [routes-extension-users-admin.md](routes-extension-users-admin.md) / [routes-granot-lifecycle-admin.md](routes-granot-lifecycle-admin.md).
- UUID / batch-100 / credential-like keys stay on `granotLifecycle.validation.ts` (Wave B validation pass).
- Follow Up CSV write / Booked Jobs CSV write stay on already-recommended [enrichment-call-lead-enrichment.md](enrichment-call-lead-enrichment.md) / [reconciliation-booked-call-lead.md](reconciliation-booked-call-lead.md).
- Ordinary Form Edit / preview POSTs stay on already-recommended [routes-v1.md](routes-v1.md).

Do **not** add a test per helper (`requireTheSignedExtensionOwner`, `requireTheFormLeadIdInTheUrl`, `refuseWhenExpectedTargetDisagreesWithTheFormUrl`, `refuseTheDesk`). Those names exist so the parent reads. If a helper test has to change when the helper is inlined, it was testing past the **interface**.

Do **not** export `sendError` so “the test can unit the refuse.”

## What I would not do

- An `ExtensionGranotApplyRoutesService` class with `create` / `update` / `apply`.
- Thirty two-line functions that only wrap `res.json({ ok: true, data })`.
- Moving this into a CRUD folder (`create.ts` / `update.ts` / `delete.ts`) or splitting `form-sync.ts` / `enrichment-sync.ts` / `booked-sync.ts` “for cleanliness.”
- Breaking the after-secret **seam**: this desk stays after `/api/v1` secret; do not put Owner apply in front of `x-api-secret`.
- Breaking the leftover Zod-then-apply **seam**: do not capture or claim in this file.
- Treating leftover `applyExtensionGranotItem`, leftover `syncCallLeadEnrichment`, leftover `syncBookedCallLeadReconciliation`, leftover `requireRegistryOwnerActor`, leftover Drive / leftover extension login desks, leftover Extension Users desk, leftover Granot lifecycle admin, leftover Tariff, leftover ordinary Form PATCH, leftover preview POSTs, leftover webhook / cron routers, or leftover HTTP automation apply as this story.
- Inventing a leftover CSV / leftover HMAC / leftover queue-publish **adapter** that has only one caller in this pass.
- Silently remounting `requireApiSecret`, asking `requireRegistryOwnerActor`, pointing `/enrichment/sync` back at `syncCallLeadEnrichment`, importing `buildGranotSyncExpectedFilter`, answering **202**, writing `quoted`, deciding identity, swallowing rethrows into `"Internal error"`, or moving Zod onto a new barrel while recommending a rename.
- Jumping to `models/` / `validation/` / `config/domain/` / `middleware/` / `auth/` while this checklist has unchecked modules.
- Writing a whole-folder recommendation for `routes`.
