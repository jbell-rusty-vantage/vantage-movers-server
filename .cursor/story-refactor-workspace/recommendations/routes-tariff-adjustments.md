# After The Secret, Append This Binding Estimate Fee Pair Onto Master — Never Write Customer Or Job, Never Leak The Spreadsheet Id, Never Use Sheet Sync, Never Treat This As A Domain Command, Never Check Roles In This File — operational story

- Status: recommended
- Service: `routes` (Wave B, in-progress)
- Pass: 10 of this service — `tariff-adjustments.routes.ts`
- Remaining in this service: `granot-automation.routes.ts`, `ingestion.routes.ts`, `reporting.routes.ts`, `granot-webhook.routes.ts`, `ringcentral-webhook.routes.ts`, `ringcentral-webhook-local.routes.ts`, `twilio-message-status.routes.ts`, `twilio-voice.routes.ts`, `ringcentral-cron.routes.ts`, `booking-reconciliation-cron.routes.ts`, `sheet-sync-cron.routes.ts`, `lead-messaging-cron.routes.ts`, `cpl-correction-cron.routes.ts`, `notification-cron.routes.ts`, `best-relocation-ingestion-cron.routes.ts`, `reporting-cron.routes.ts`, `granot-automation-cron.routes.ts`, `granot-lifecycle-cron.routes.ts`
- Target: `src/routes/tariff-adjustments.routes.ts`
- Knowledge: [`docs/knowledge/services/tariff.md`](../../../docs/knowledge/services/tariff.md) (append-only [Tariff Adjustment](../../../../CONTEXT.md) rows to `TARIFF_SHEET_ID` / `Master`; Carrier is the resolved [Moving Carrier](../../../../CONTEXT.md) legal name and DOT for the [Granot Carrier Code](../../../../CONTEXT.md); **not Sheet Sync**; does not write customer name, phone, email, job number, or ref; `POST /api/v1/tariff-adjustments` accepts Owner or Customer Service Bearer, leftover Employee still allowed on this route, Sales is 403; response `data` is `{ appended, tab_name, updated_range, rows }` and never includes the spreadsheet id). Distinct from already-recommended public v1 desk: [routes-v1.md](routes-v1.md) (`router.use(createTariffAdjustmentsRouter())` on line 618, **after** leftover `POST /api/v1/form-leads` and **before** leftover `createExtensionGranotApplyRouter()` — this file **is** that mount). Distinct from already-recommended Owner apply: [routes-extension-granot-apply.md](routes-extension-granot-apply.md) (Owner session after the secret — **does not import** this file). Distinct from already-recommended unguarded login: [routes-extension-auth.md](routes-extension-auth.md) (admits the session **before** the secret — **does not import** this file). Distinct from already-recommended Owner Extension Users desk: [routes-extension-users-admin.md](routes-extension-users-admin.md) (HMAC Owner after the secret — **does not append** onto Master). Distinct from already-recommended Wave A append: [tariff-append.md](tariff-append.md) (`appendTariffAdjustmentRows` — this file **asks** it; it does **not** Zod-parse the pair, does **not** hide `spreadsheetId`, does **not** stamp omitted `effective_date`, does **not** connect Mongo). Distinct from already-recommended Wave A carrier cell: [tariff-resolve-carrier.md](tariff-resolve-carrier.md) (`resolveTariffCarrierCell` — this file **does not import** it; leftover append **asks** it after leftover `connect`). Distinct from already-recommended Moving Carrier catalog: [moving-carriers-moving-carrier.md](moving-carriers-moving-carrier.md). Distinct from already-recommended Sheet Sync: [sheet-sync-coordinator.md](sheet-sync-coordinator.md) / [sheet-sync-outbox.md](sheet-sync-outbox.md) / [sheet-sync-run-sheet-sync-drain.md](sheet-sync-run-sheet-sync-drain.md) (**this file must not enqueue** a job). Distinct from leftover Domain Command persist: [domain-commands-existing-writes.md](domain-commands-existing-writes.md) / already-recommended `handleCanonicalCreate` on leftover `v1.routes.ts` (**this file does not ask** leftover `runExisting*` / leftover `existingWriteContextFromRequest`). Distinct from leftover Wave B Zod: `src/validation/v1/tariffAdjustments.validation.ts` (`createTariffAdjustmentsSchema` — exactly two rows, one `Linehaul` and one `Additional Services`, shared date / zones / carrier, forbidden customer / job / spreadsheet keys; leftover `formatTariffEffectiveDate` — this file **asks** both). Distinct from leftover Wave B secret: next `requireApiSecret.ts` (`TARIFF_ADJUSTMENT_BEARER_ROUTE` — Owner any path; Customer Service this POST only; Sales `[]`; leftover Employee dual `sales` + `customer_service` passes because `roles.some`; secret-only `kind: "secret"` always `next()`; Sales **403 `"Forbidden"`** **before** this file). Distinct from leftover Wave B name book: `src/config/domain/tariff.ts` (`TARIFF_SHEET_ID` / `Master` / `"Rule "`). Distinct from leftover actor paint: leftover `formatTariffActorRole` on leftover `src/auth/extension/roles.ts` (log only — **not** a refuse). Distinct from leftover proof: `scripts/prove-tariff-append.ts` (**asks** leftover append with live `spreadsheetId`; **does not import** this file). Operator skill lists leftover `POST /api/v1/tariff-adjustments`. This checkout’s `CONTEXT.md` is a pointer plus four employee-booking terms — knowledge links [Tariff Adjustment](../../../../CONTEXT.md), [Tariff Adjustment Submit](../../../../CONTEXT.md), [Moving Carrier](../../../../CONTEXT.md), [Granot Carrier Code](../../../../CONTEXT.md), [Reporting Sheets](../../../../CONTEXT.md); do not invent a glossary copy. `docs/adr/` is absent here — do not invent ADR copies. Knowledge cites `docs/tariff-adjustment/tariff-adjustment-specification.md`; that folder is absent in this checkout — do not invent it. Project-organization names `daily-operations-admin.routes.ts`; this checkout has no such file — do not invent that mount. Do not add a Routes Service file in this rename.
- Callers: **one runtime mount plus one focused route test plus a folder mount proof plus a secret-middleware proof plus a Zod proof.** Already-recommended `v1.routes.ts` **asks** leftover `createTariffAdjustmentsRouter()` on line 618 (**after** `/api/v1` secret, after leftover Form POST, before leftover Owner apply). Leftover `src/app.ts` mounts the public v1 desk, not this file. Tests on this **interface**: `tariff-adjustments.routes.test.ts` (injects leftover `createTariffAdjustmentsRouter` deps `appendRows` / `now` / `connect`; stamps leftover `vantageAuth` from leftover `x-test-role`; names Owner **200** `appended: 2` `tab_name: "Master"` no `spreadsheetId` `"must-not-leak"` omitted Linehaul then Additional Services; leftover Employee dual `sales` + `customer_service` **200**; Customer Service **200**; secret-only **200**; leftover `job_no` **400** `appended.length === 0`; omitted `effective_date` stamps `"9/1/2026"` from injected `now`). It does **not** name Sales. It does **not** name missing `vantageAuth`. It does **not** name two Linehaul. It does **not** name mismatched zones. It does **not** name leftover `AppError` unknown code. It does **not** name leftover 500 `error.message`. It does **not** remount leftover `requireApiSecret`. Folder `v1.routes.test.ts` names leftover `POST /api/v1/tariff-adjustments`. Leftover `requireApiSecret.test.ts` names Owner `next()`; Customer Service `next()`; Sales-plus-Customer-Service `next()`; Sales-only **403 `"Forbidden"`** — that is the parent secret, not this desk. Leftover `tariffAdjustments.validation.test.ts` names the pair / forbidden keys / omitted date — leftover Zod, not this file. Already-recommended Wave A `tariff.service.test.ts` proves append / resolve through the service, not this router. Operator leftover `prove-tariff-append` **asks** leftover append directly. Not this **interface**: leftover `appendTariffAdjustmentRows` itself, leftover `resolveTariffCarrierCell`, leftover `runExistingCreateFormLead`, leftover `requireRegistryOwnerActor`, leftover Sheet Sync enqueue.
- Seams callers need: after `/api/v1` secret (parent mount) vs leftover Drive / leftover extension login **before**; leftover parent Bearer hatch (Owner any path; Customer Service this POST; leftover Employee dual roles pass; Sales **403 `"Forbidden"`**; secret-only `kind: "secret"` admitted) vs **this file never 401 / 403**; leftover Zod pair then stamp omitted date then `connect` then append; leftover HTTP `{ appended, tab_name, updated_range, rows }` vs leftover append receipt that includes `spreadsheetId`; leftover factory `createTariffAdjustmentsRouter(deps)` (test injection `appendRows` / `now` / `connect`) vs default zero-arg mount; leftover `sendError` leftover `ZodError` → **400** `"Invalid request payload"` raw `issues` vs leftover `AppError` → `error.statusCode` + `error.message` vs else **500** `{ error: error.message }` (**does** echo `Error.message`; non-Error `"Internal error"`). There is no begin / complete Domain Command **seam** in this file. There is no Sheet Sync **seam**. There is no leftover HMAC Owner **seam**. There is no leftover role-refuse **seam**.
- Split later (only if the file outgrows one sitting): this ~114-line file is one sitting if you read it as after the secret, append this Binding Estimate Fee pair onto Master — never write customer or job, never leak the spreadsheet id, never use Sheet Sync, never treat this as a Domain Command, never check roles in this file. Do not split. Never `create.ts` / `update.ts` / `delete.ts`. Append / resolve stay already-recommended `append.ts` / `resolveCarrier.ts`. Pair / forbidden keys stay leftover Zod. Who may speak stays leftover `requireApiSecret` (Wave B middleware pass). Login stays already-recommended `extension-auth.routes.ts`. Ordinary Form POST stays already-recommended `v1.routes.ts`.

`router.post("/api/v1/tariff-adjustments")` is an HTTP verb. The owner question is: *Someone already passed the API secret. The Granot Forms View parsed a Linehaul row and an Additional Services Binding Estimate Fee row that share date, zones, and carrier. Stamp today's date when they omitted it. Open Mongo so the already-recommended append can resolve the Granot Carrier Code. Append onto Master. Answer 200 with counts and painted cells, never the spreadsheet id. Do not write customer or job. Do not enqueue Sheet Sync. Do not wrap this in a Domain Command. Do not check Owner / Customer Service / leftover Employee / Sales in this file — the parent already did, or it did not.*

Who resolves `"{name} {dot_number}"` and `values.append` already lives in already-recommended `append.ts` / `resolveCarrier.ts`. Who refuses a bad pair / `job_no` already lives in leftover `createTariffAdjustmentsSchema`. Who admits Customer Service on this POST only already lives on leftover `requireApiSecret.ts`. Do not pull those in.

## What this file actually does

One operation for the Tariff Adjustment Submit **desk**, not “a tariff CRUD dump,” and not Append The Owner's Tariff Adjustment Rows Onto Master itself:

1. **After the secret, append this Binding Estimate Fee pair onto Master** — `POST /api/v1/tariff-adjustments`. Read leftover `vantageAuth` only for the log. Parse leftover `createTariffAdjustmentsSchema`. Stamp omitted `effective_date` from leftover `deps.now ?? new Date()` via leftover `formatTariffEffectiveDate` (local `getMonth()+1/getDate()/getFullYear()` — **not** Florida). Leftover `toServiceRows` paints camelCase leftover `TariffAdjustmentRow[]` (`carrier` is still the Granot Carrier Code). **Ask** leftover `connect` (injected, or leftover `connectMongo`) **after** leftover Zod so a 400 never opens Mongo. **Ask** leftover `appendRows` (injected, or leftover `appendTariffAdjustmentRows`) with those rows and **no** `spreadsheetId` / `sheets` / `resolveCarrier` / `now`. Answer **200** `{ ok: true, data: { appended, tab_name, updated_range, rows } }` — **omit** leftover `spreadsheetId`. Log leftover `tariff_adjustment.append.succeeded` with leftover `actor_kind` / leftover `actor_role` (`formatTariffActorRole` when leftover `kind === "user"`) / leftover `actor_email` / leftover `appended` / leftover `tab_name`. On throw log leftover `tariff_adjustment.append.failed` then leftover `sendError`. This beat does **not** remount leftover `requireApiSecret`. This beat does **not** 403 Sales / leftover Employee / secret-only. This beat does **not** **ask** leftover `runExisting*`. This beat does **not** enqueue Sheet Sync. This beat does **not** write a Mongo Tariff collection. This beat does **not** resolve the carrier cell.

`getVantageAuth` / leftover `toServiceRows` / leftover `sendError` are beats inside this operation, not extra owner stories. Leftover `sendError` is leftover `ZodError` → **400** `{ ok: false, error: "Invalid request payload", issues: error.issues }`; leftover `AppError` → leftover `{ ok: false, error: error.message }` at leftover `error.statusCode` (unknown Granot Carrier Code is leftover **400** from already-recommended resolve when live append runs); else leftover **500** `{ ok: false, error: error instanceof Error ? error.message : "Internal error" }`. Leftover `sendError` does **not** stamp leftover `request_id`. Leftover `sendError` does **not** leftover `recordOperationalEvent`. They are private.

There is no second GET / PATCH / DELETE operation. One HTTP **adapter** on one factory over one append. Leftover Zod pair and the hidden spreadsheet id are HTTP **adapters** — do not move them into leftover `append.ts` so “the service matches HTTP.”

## Organization

Keep one file. This is the screenplay for “after the secret, append this Binding Estimate Fee pair onto Master — never write customer or job, never leak the spreadsheet id, never use Sheet Sync, never treat this as a Domain Command, never check roles in this file.” Already-recommended leftover append / leftover resolve / leftover pair Zod / leftover parent Bearer hatch already live in deeper **modules**. Do not pull those in. Do not invent a `TariffAdjustmentsRoutesService` class. Do not invent a begin / complete Domain Command **seam**. Do not invent a Sheet Sync **adapter** so “tariff can drain.” Do not invent a leftover HMAC **adapter** so “Admin Dashboard can append without the extension.” Do not invent a leftover role-refuse **adapter** so “this file owns Sales 403.” Do not invent a CRUD folder so `create.ts` owns the POST.

Do not move leftover `appendTariffAdjustmentRows` into this file so “the route owns Google.” Do not mount this router before leftover `requireApiSecret` so “it matches leftover extension login.” Do not merge this router into leftover `v1.routes.ts` so “one file owns leftover Form POST and leftover Tariff.” Do not merge this router into leftover `extension-granot-apply.routes.ts` so “one file owns every extension write.” Do not split `create.ts` / `update.ts` / `delete.ts`.

**External interface** stays small (this is the test surface):

| Keep exporting | Story name | Why the seam exists |
|---|---|---|
| `createTariffAdjustmentsRouter` | `createBindingEstimateFeePairDesk` | leftover factory injects leftover append / leftover now / leftover connect for the route test |
| zero-arg `createTariffAdjustmentsRouter()` (no default export today — `v1.routes.ts` **asks** the factory) | `bindingEstimateFeePairDesk` | already-recommended public v1 desk mounts the zero-arg factory **after** the secret |
| `POST .../tariff-adjustments` (today unexported handler) | `appendThisBindingEstimateFeePairOntoMasterAfterTheSecretOverHttp` | leftover pair parse / leftover date stamp / leftover connect / leftover append / hide spreadsheet id / **200** |
| `TariffAdjustmentsRouteDeps` | `BindingEstimateFeePairDeskDeps` | test injection bag — leftover `appendRows` / leftover `now` / leftover `connect` |

Keep the factory as a one-line alias until `v1.routes.ts` and the route test migrate. Do not make callers learn `createTariffAdjustmentsSchema` / `toServiceRows` / `sendError` / `formatTariffActorRole` as the domain language. Do **not** export the handler so “the test can unit the helper.” Do **not** export leftover Zod onto a new barrel in this rename — leave that for the validation pass. Do **not** rename leftover `appendTariffAdjustmentRows` here — that stays already-recommended Wave A. Do **not** add leftover `GET .../tariff-adjustments` so “the desk can list Master.” Do **not** add leftover `spreadsheet_id` onto leftover `data` so “the desk can open the sheet.”

**No class for the workflow.** The one type that *does* earn a name is the HTTP handoff leftover `data` already paints after leftover append:

```ts
type BindingEstimateFeePairAppendedOverHttp = {
  ok: true
  data: {
    appended: number
    tab_name: string
    updated_range?: string
    rows: string[][]
  }
}
```

That is the handoff from “Master accepted the insert” to “the extension can refresh without learning `TARIFF_SHEET_ID`.” Do **not** add leftover `spreadsheet_id` onto that bag. Do **not** add leftover `customer` / leftover `job_no` onto that bag. Do **not** collapse leftover `{ appended: 2 }` into a Domain Command envelope so “every public write matches leftover `handleCanonicalCreate`.”

A second named bag already exists for the leftover append receipt (already-recommended leftover `TariffAdjustmentAppendReceipt` / leftover `AppendTariffAdjustmentRowsResult`). Do **not** re-declare leftover `spreadsheetId` here. Leave leftover `appendTariffAdjustmentRows` on already-recommended leftover `append.ts`. Leave leftover `resolveTariffCarrierCell` on already-recommended leftover `resolveCarrier.ts`. Leave leftover pair / leftover forbidden keys on leftover `createTariffAdjustmentsSchema`. Leave who may speak on leftover `requireApiSecret` (Wave B middleware). Leave leftover login on already-recommended leftover `extension-auth.routes.ts`. Leave leftover HMAC Owner on already-recommended leftover `trustedActor.ts`. Leave leftover Form POST on already-recommended leftover `v1.routes.ts`. Leave Florida Timestamp on leftover append — this desk only stamps omitted `effective_date`.

## The file, as a story

Parent functions stay deep. Child names are only extracted when they hide a real decision, not a one-liner.

```ts
// tariff-adjustments.routes.ts
// Someone already passed the API secret.
// The Granot Forms View parsed a Linehaul row
// and an Additional Services Binding Estimate Fee row.
// Append them onto Master.
// Do not write customer or job.
// Do not leak the spreadsheet id.
// Do not use Sheet Sync.
// Do not treat this as a Domain Command.
// Do not check roles in this file.

export function createBindingEstimateFeePairDesk(deps = {}) {
  const bindingEstimateFeePairDesk = Router()
  const appendThePair = deps.appendRows ?? appendTariffAdjustmentRows
  const now = deps.now ?? (() => new Date())
  const connect = deps.connect ?? connectMongo

  // ── 1. After the secret, append this Binding Estimate Fee pair onto Master ─

  bindingEstimateFeePairDesk.post(
    "/api/v1/tariff-adjustments",
    appendThisBindingEstimateFeePairOntoMasterAfterTheSecretOverHttp,
  )

  return bindingEstimateFeePairDesk
}

async function appendThisBindingEstimateFeePairOntoMasterAfterTheSecretOverHttp(req, res) {
  const auth = vantageAuthAlreadySetByTheParent(req) // log only — never 403
  try {
    const parsed = parseTheBindingEstimateFeePair(req.body) // leftover Zod pair
    const rows = stampOmittedEffectiveDateThenPaintCamelCase(parsed, now())
    await connect()
    const result = await appendThePair(rows) // no spreadsheetId, no now, no resolver
    logThatThePairAppended(auth, result)
    return res.status(200).json({
      ok: true,
      data: {
        appended: result.appended,
        tab_name: result.tabName,
        updated_range: result.updatedRange,
        rows: result.rows,
      },
    })
  } catch (error) {
    logThatThePairFailed(auth, error)
    return refuseTheDesk(res, error)
  }
}

function refuseTheDesk(res, error) {
  if (error instanceof ZodError) {
    return res.status(400).json({
      ok: false,
      error: "Invalid request payload",
      issues: error.issues,
    })
  }
  if (error instanceof AppError) {
    return res.status(error.statusCode).json({
      ok: false,
      error: error.message,
    })
  }
  return res.status(500).json({
    ok: false,
    error: error instanceof Error ? error.message : "Internal error",
  })
}
```

Read the desk path out loud: *Someone already passed the API secret. Parse the two-row pair. Stamp today's date when they omitted it. Open Mongo. Ask append. Answer 200 without the spreadsheet id. A leftover `job_no` never reaches append. Sales never reaches this file when the parent gate is mounted. This file does not check roles.*

That is the operation. `router.post("/api/v1/tariff-adjustments")` is not.

## Precise logic I would tighten while renaming

These are real smells the story names make obvious. Do not “just rename.”

1. **This desk sits after the secret. It does not remount the secret and it does not refuse anyone.** Already-recommended public v1 desk mounts this file **after** `router.use("/api/v1", requireApiSecret)`, after leftover Form POST, before leftover Owner apply. Sales Bearer is **403 `"Forbidden"`** on leftover `requireApiSecret.test.ts` **before** leftover `vantageAuth` reaches this file. Customer Service / leftover Employee dual roles / secret-only `next()`. This file leftover `getVantageAuth` only for the log. The route test stamps leftover `vantageAuth` and never 403s. A request without leftover `x-test-role` would **200** on that app because leftover `requireApiSecret` is not mounted there. Do not silently add per-route leftover `requireApiSecret` so “it matches Drive.” Do not silently 403 Sales in this file so “the knowledge sentence lives here” without a paired parent test. Do not move this mount before the global guard so “the extension can append without a secret.”

2. **Who may speak is Customer Service on this POST, leftover Employee dual-roles, Owner, secret-only — not HMAC Owner, not Sales-only.** Sibling leftover Extension Users / leftover conversations **ask** leftover `requireRegistryOwnerActor`. This file does **not**. Knowledge names Owner / Customer Service Bearer and leftover Employee still allowed; it does **not** name secret-only. The route test locks secret-only **200**. Leftover `LIMITED_EXTENSION_ROLE_ALLOWED_ROUTES.sales` is `[]`; leftover `customer_service` is this POST only; leftover `isAnyLimitedExtensionRoleAllowedRoute` leftover `roles.some`. Do not silently **ask** leftover `requireRegistryOwnerActor` so “every Owner desk matches.” Do not silently refuse secret-only so “knowledge omitted it.” Do not teach Sales-only to append so “the salesperson can submit tariff.”

3. **The pair and forbidden keys live on Zod, not here.** Leftover `createTariffAdjustmentsSchema` wants exactly two rows, one `Linehaul` and one `Additional Services`, shared `effective_date` / `pickup_zone` / `delivery_zone` / `carrier`, and refuses leftover `customer` / leftover `name` / leftover `phone` / leftover `email` / leftover `job_no` / leftover `ref_no` / leftover `ordref` / leftover `spreadsheet_id` / leftover `tab` at any depth. Already-recommended leftover append accepts any non-empty list and never sees those keys. The route test only names leftover `job_no`. Leftover two Linehaul / leftover mismatched zones live on leftover `tariffAdjustments.validation.test.ts`. Do not silently re-check leftover `rows.length === 2` in this file so “the route owns the pair.” Do not silently move leftover `TARIFF_ADJUSTMENT_FORBIDDEN_KEYS` into leftover `append.ts` so “the service matches HTTP.” Leave Zod for the Wave B validation pass.

4. **Omitted `effective_date` is local wall date, not Florida Timestamp.** Leftover `formatTariffEffectiveDate` uses leftover `getMonth()+1` / leftover `getDate()` / leftover `getFullYear()` on leftover `deps.now`. Already-recommended leftover append stamps leftover `Timestamp` with leftover `toFloridaTimestamp` then leftover `formatTimestamp` and does **not** take this desk’s leftover `now`. Leftover `toServiceRows` takes leftover `parsed.rows[0]?.effective_date ?? formatTariffEffectiveDate(stampedAt)` then each row leftover `row.effective_date ??` that default. Zod already requires both dates equal or both omitted, so the first-row fallback is leftover tautological except when both omit. Do not silently pass leftover `now` into leftover `appendTariffAdjustmentRows` so “one clock owns the row.” Do not silently switch leftover `formatTariffEffectiveDate` onto leftover Florida so “effective date matches Timestamp” without a paired test.

5. **`connect` is for leftover carrier lookup, not for a Tariff document.** Live leftover `appendTariffAdjustmentRows` leftover **asks** leftover `resolveTariffCarrierCell` which leftover `findOne`s leftover `moving_carriers`. This file leftover `connect`s **after** leftover Zod and **before** leftover append. The route test leftover no-ops leftover `connect` and leftover injects leftover `appendRows`, so leftover lookup never runs here. Do not silently leftover `connect` first so “every path opens Mongo.” Do not silently persist a Mongo Tariff row so “append has a system of record.” Knowledge: Mongo is not the record for these rows.

6. **The HTTP bag hides `spreadsheetId` and forwards painted `rows`.** Already-recommended append returns `{ spreadsheetId, tabName, appended, updatedRange, rows }`. This desk maps `tab_name` / `updated_range` and drops `spreadsheetId`. `rows` are the eight-column sheet cells (Florida Timestamp through resolved Carrier when live append ran). The route test injects painted cells whose `carrier` is still the code, then locks `"must-not-leak"` omitted. Do not add `spreadsheet_id` so “the desk can open the sheet.” Do not strip `rows` so “counts are enough.” The proof may see the spreadsheet id. This HTTP response must not.

7. **`sendError` echoes `error.message` on 500 and does not log.** Sibling Extension Users maps unhandled to **500** `error.message` and does not log. Already-recommended Job Number maps `"Internal error"` and logs. Owner apply rethrows non-Granot / non-Zod. This desk uses Zod `"Invalid request payload"` plus raw `issues` (Extension Users style), not flattened path strings (Owner apply). Do not silently import the Job Number refuse so “one refuse owns every desk.” Do not silently `recordOperationalEvent` so “tariff matches Form POST 5xx.” Park the 500 echo.

8. **`formatTariffActorRole` is paint for the log, not a refuse.** Owner wins. Dual `sales` + `customer_service` paints `sales+customer_service`. Empty roles fall through to `"sales"`. This file never uses that string to 403. Do not silently 403 from the painted role so “Sales in the log means Sales was refused.” Do not drop `actor_email` from the log in this rename — park PII-in-logs.

9. **This file is not a Domain Command and is not Sheet Sync.** Already-recommended public v1 Form / Call / Booking writes **ask** `existingWriteContextFromRequest` then `runExisting*`. This desk **asks** `appendTariffAdjustmentRows` after `connect`. It does not persist `command_name`. It does not enqueue `form_lead.create`. Do not wrap this POST in `handleCanonicalCreate` so “every public write is a command.” Do not teach `syncFormLeadToSheets` a Tariff tab.

10. **Leave sibling modules alone.** `appendTariffAdjustmentRows` / `resolveTariffCarrierCell` / `createTariffAdjustmentsSchema` / `requireApiSecret` are already the right **depth**. This file orchestrates the HTTP **adapter**.

11. **Do not treat Owner apply, ordinary Form POST, HMAC Owner desks, webhook capture, or HTTP automation as this story.** Next `granot-automation.routes.ts` is HTTP collector runs. Ordinary Form POST stays on already-recommended `v1.routes.ts`. Do not teach this file `database_scope`.

12. **Do not silently restore a customer or job column.** Knowledge: the pair never writes customer name, phone, email, job number, or ref. Zod already refuses those keys. Do not add them onto `TariffAdjustmentRow` so “the desk can find the job later.”

## Testing

The **interface** is the test surface: `createBindingEstimateFeePairDesk` (mounted on already-recommended `publicV1Desk` **after** the secret) and `appendThisBindingEstimateFeePairOntoMasterAfterTheSecretOverHttp`.

Today `tariff-adjustments.routes.test.ts` already names Owner **200** two rows Linehaul then Additional Services, hidden `spreadsheetId`, leftover Employee dual-role **200**, Customer Service **200**, secret-only **200**, `job_no` **400** with no append, and omitted `effective_date` stamped `"9/1/2026"` from injected `now`. It misses Sales (parent), missing `vantageAuth` on the isolated app, two Linehaul, mismatched zones, `AppError` unknown code, and 500 `error.message`. Folder `v1.routes.test.ts` already names `POST /api/v1/tariff-adjustments`. `requireApiSecret.test.ts` already names Owner / Customer Service / Sales-plus-Customer-Service `next()` and Sales-only **403 `"Forbidden"`**. `tariffAdjustments.validation.test.ts` already names the pair / forbidden keys. Already-recommended Wave A files prove append / resolve through the service — not this desk.

Keep the inject-and-stamp `x-test-role` style. Add the missing operations (do not boot Google, live `TARIFF_SHEET_ID`, HMAC sign, or Form POST in the route file):

**After the secret / who may speak**
- This desk is registered on `publicV1Desk` **after** `router.use("/api/v1", requireApiSecret)` and has **no** per-route `requireApiSecret`.
- This file does **not** 403 Sales / leftover Employee / secret-only / missing `vantageAuth`. Parent Sales Bearer **403 `"Forbidden"`** stays on `requireApiSecret.test.ts`.
- HMAC Owner is **not** required. `requireRegistryOwnerActor` is **not** asked.

**Append the pair after the secret**
- Owner `POST .../tariff-adjustments` **asks** `appendRows` once with two camelCase rows, Linehaul then Additional Services, `carrier` still the Granot Carrier Code.
- Response **200** `{ appended, tab_name, updated_range, rows }` and **omits** `spreadsheetId`.
- Omitted `effective_date` stamps local `M/D/YYYY` from injected `now` onto both rows.
- `job_no` on the body answers Zod **400** `"Invalid request payload"` and does **not** **ask** `appendRows` or `connect`.
- Two Linehaul / mismatched `pickup_zone` answer Zod **400** and `appended.length === 0` (Zod test already names this; the route test should name the HTTP envelope).
- Injected `AppError` 400 `"Unknown Granot Carrier Code: UNKNOWN"` answers **400** `{ error }` and does **not** include `spreadsheetId`.
- Injected throw `new Error("sheet down")` answers **500** `{ error: "sheet down" }` (name the echo).
- This beat does **not** **ask** `runExistingCreateFormLead` / `scheduleFormLeadSheetSync`.
- This beat does **not** pass `spreadsheetId` / `now` / `resolveCarrier` into `appendRows`.

**Mount**
- Folder `v1.routes.test.ts` should keep `POST /api/v1/tariff-adjustments` between Form POST and Owner apply.

**Not this file**
- Append / resolve / Florida Timestamp / `"Rule "` stay on already-recommended [tariff-append.md](tariff-append.md) / [tariff-resolve-carrier.md](tariff-resolve-carrier.md).
- Pair length / shared fields / forbidden keys stay on `tariffAdjustments.validation.ts` (Wave B validation pass).
- Owner / Customer Service / leftover Employee / Sales Bearer stay on `requireApiSecret` (Wave B middleware pass).
- Login stays on already-recommended [routes-extension-auth.md](routes-extension-auth.md).
- HMAC Owner desks stay on already-recommended [routes-extension-users-admin.md](routes-extension-users-admin.md).
- Ordinary Form POST stays on already-recommended [routes-v1.md](routes-v1.md).
- Owner apply stays on already-recommended [routes-extension-granot-apply.md](routes-extension-granot-apply.md).

Do **not** add a test per helper (`vantageAuthAlreadySetByTheParent`, `stampOmittedEffectiveDateThenPaintCamelCase`, `refuseTheDesk`). Those names exist so the parent reads. If a helper test has to change when the helper is inlined, it was testing past the **interface**.

Do **not** export `sendError` so “the test can unit the refuse.”

## What I would not do

- A `TariffAdjustmentsRoutesService` class with `create` / `update` / `delete`.
- Thirty two-line functions that only wrap `res.json({ ok: true, data })`.
- Moving this into a CRUD folder (`create.ts` / `update.ts` / `delete.ts`) “for cleanliness.”
- Breaking the after-secret **seam**: this desk stays after `/api/v1` secret; do not put Binding Estimate Fee in front of `x-api-secret`.
- Breaking the Zod-then-connect-then-append **seam**: do not resolve the carrier or `values.append` in this file.
- Treating leftover `appendTariffAdjustmentRows`, leftover `resolveTariffCarrierCell`, leftover `requireRegistryOwnerActor`, leftover Drive / leftover extension login desks, leftover Extension Users desk, leftover Granot lifecycle admin, leftover Owner apply, leftover ordinary Form POST, leftover webhook / cron routers, or leftover HTTP automation as this story.
- Inventing a leftover Sheet Sync / leftover HMAC / leftover Domain Command **adapter** that has only one caller in this pass.
- Silently remounting `requireApiSecret`, asking `requireRegistryOwnerActor`, wrapping the POST in `handleCanonicalCreate`, adding `spreadsheet_id` onto `data`, writing customer / job, switching effective date onto Florida, swallowing 500 into `"Internal error"`, or moving Zod onto a new barrel while recommending a rename.
- Jumping to `models/` / `validation/` / `config/domain/` / `middleware/` / `auth/` while this checklist has unchecked modules.
- Writing a whole-folder recommendation for `routes`.
