# Hand The Signed Owner At Most Three Recent Official Booking Job Numbers After The Secret, Then Tell The Owner-Facing Chain For The Job Number They Typed — Never Put This Desk Before The Secret, Never Assemble Here, Never Call The Forensic Granot Job Page, Never Catalog, Never Mutate, Never Echo An Unhandled Throw — operational story

- Status: recommended
- Service: `routes` (Wave B, in-progress)
- Pass: 6 of this service — `job-number-timeline-admin.routes.ts`
- Remaining in this service: `conversations-admin.routes.ts`, `extension-users-admin.routes.ts`, `extension-granot-apply.routes.ts`, `tariff-adjustments.routes.ts`, `granot-automation.routes.ts`, `ingestion.routes.ts`, `reporting.routes.ts`, `granot-webhook.routes.ts`, `ringcentral-webhook.routes.ts`, `ringcentral-webhook-local.routes.ts`, `twilio-message-status.routes.ts`, `twilio-voice.routes.ts`, `ringcentral-cron.routes.ts`, `booking-reconciliation-cron.routes.ts`, `sheet-sync-cron.routes.ts`, `lead-messaging-cron.routes.ts`, `cpl-correction-cron.routes.ts`, `notification-cron.routes.ts`, `best-relocation-ingestion-cron.routes.ts`, `reporting-cron.routes.ts`, `granot-automation-cron.routes.ts`, `granot-lifecycle-cron.routes.ts`
- Target: `src/routes/job-number-timeline-admin.routes.ts`
- Knowledge: no dedicated routes Service. Closest: [`docs/knowledge/services/job-number-timeline.md`](../../../docs/knowledge/services/job-number-timeline.md) (Owner-only typed [Job Number](../../../../CONTEXT.md) chain; `GET /api/v1/admin/job-number-timeline` authorize → validate → leftover `module.read` → respond; success envelope always `{ ok: true, data: JobTimelineAssembleResult }` including assembler `not_found` / `filtered_out` / `invalid_job_number`; Zod miss → `400` `{ ok: false, error: "invalid_job_number" }`; unhandled → `500` `{ ok: false, error: "Internal error" }` and does **not** echo `error.message`; leftover `GET .../recent-official-bookings` is registered **first** on the same router — at most three official Booking Job Numbers, **not** leftover `module.read`, **not** a catalog; not `GET /api/v1/admin/granot-lifecycle/jobs/:normalized_job_no`). Distinct from already-recommended public v1 desk: [routes-v1.md](routes-v1.md) (`router.use(jobNumberTimelineAdminRoutes)` on line 293, **after** `/api/v1` secret — this file **is** that mount). Distinct from already-recommended Granot lifecycle desk: [routes-granot-lifecycle-admin.md](routes-granot-lifecycle-admin.md) (sibling after the secret; leftover `GET .../jobs/:normalized_job_no` **asks** leftover `projectGranotJob`, not leftover `module.read`). Distinct from already-recommended unguarded desks: [routes-extension-auth.md](routes-extension-auth.md) and [routes-google-drive-oauth.md](routes-google-drive-oauth.md) (those sit **before** the secret). Distinct from already-recommended inbound-number desk: [routes-ringcentral-registry.md](routes-ringcentral-registry.md) (sibling after the secret; this file never files a phone). Distinct from already-recommended typed-job HTTP/CLI facade: leftover `src/services/jobNumberTimeline/module.ts` (`createJobNumberTimelineModule({ loader }).read` — this file **asks** that on the typed path; CLI `render` / `discover` / `proof` **ask** the same leftover `module.read` and never this router). Distinct from already-recommended v1 emit: [job-number-timeline-assemble.md](job-number-timeline-assemble.md) (`assembleJobNumberTimeline` — this file **must not** import it; leftover `module.read` redacts after assemble). Distinct from already-recommended Mongo hop: [job-number-timeline-mongo-evidence-loader.md](job-number-timeline-mongo-evidence-loader.md) (`createMongoEvidenceLoader` — leftover `defaultRead` **asks** it; this file does not hop). Distinct from already-recommended Owner sample: [job-number-timeline-recent-official-bookings.md](job-number-timeline-recent-official-bookings.md) (`listRecentOfficialBookingExamples` + leftover `createMongoRecentOfficialBookingLister` — leftover `defaultListRecentOfficialBookings` **asks** those; this file does not paint `booked_at`). Distinct from leftover v2 wrap / clocks / evidence / outcome / attention: [job-number-timeline-projector.md](job-number-timeline-projector.md), [job-number-timeline-clocks.md](job-number-timeline-clocks.md), [job-number-timeline-evidence.md](job-number-timeline-evidence.md), [job-number-timeline-outcome.md](job-number-timeline-outcome.md), [job-number-timeline-attention.md](job-number-timeline-attention.md) (those run inside leftover `module.read` on `ok`). Distinct from leftover forensic Granot job page: [granot-lifecycle-projections.md](granot-lifecycle-projections.md) (`GranotTimelineEntry` — **does not import** this file; this file **must not** import `projections.ts`). Distinct from already-recommended speaking gate: [operations-registry-trusted-actor.md](operations-registry-trusted-actor.md) (`requireRegistryOwnerActor` — this file **asks** it; signed Admin is **403**; an extension Owner Bearer may **not** read these paths). Distinct from leftover Wave B Zod barrel: `src/validation/v1/` has **no** Job Number timeline schema — leftover `querySchema` lives in this file. Distinct from leftover Wave B secret: next `requireApiSecret.ts` (already-recommended public v1 desk already ran it). Distinct from leftover CLI: `scripts/prototypes/job-number-timeline` (same leftover `module.read`; not this desk). This checkout’s `CONTEXT.md` is a pointer plus four employee-booking terms — knowledge links [Job Number](../../../../CONTEXT.md), [Booking](../../../../CONTEXT.md), [Form Lead](../../../../CONTEXT.md), [Call Lead](../../../../CONTEXT.md), [Sheet Sync](../../../../CONTEXT.md), [Granot Observation Receipt](../../../../CONTEXT.md), [WordPress Form Submission Receipt](../../../../CONTEXT.md); do not invent a glossary copy. `docs/adr/` is absent here — knowledge cites ADR-0001 on the Service; do not invent ADR copies. Knowledge cites an enhancement pack at `docs/job-number-timeline/`; that folder is absent in this checkout — do not invent it. Project-organization names `daily-operations-admin.routes.ts`; this checkout has no such file and no `src/services/dailyOperations/` — do not invent that mount. Do not add a Routes Service file in this rename.
- Callers: **one runtime mount plus one focused route test.** Already-recommended `v1.routes.ts` **asks** the default export (`router.use(jobNumberTimelineAdminRoutes)` on line 293, **after** `router.use("/api/v1", requireApiSecret)` and after leftover Granot lifecycle admin). Leftover `src/app.ts` mounts the public v1 desk, not this file. Tests on this **interface**: `job-number-timeline-admin.routes.test.ts` (injects leftover `createJobNumberTimelineAdminRouter` deps; signs leftover HMAC; names Owner typed `200` assembler DTO, Admin **403** on typed, typed miss `200` leftover `not_found` without `page`, Owner recent examples Job Numbers only, Admin **403** on recent, unhandled leftover `500` `"Internal error"` that does **not** echo `error.message`). It does **not** name leftover Zod `400` `"invalid_job_number"`. It does **not** name leftover assembler `invalid_job_number` or leftover `filtered_out` as HTTP `200`. It does **not** prove leftover `source_granularity_id` / leftover `source_company_id` are forwarded. It does **not** name unsigned / missing-HMAC refuse body. Folder `v1.routes.test.ts` never lists this desk. Operator skill `.cursor/skills/hit-vantage-api/SKILL.md` lists leftover `GET /api/v1/admin/job-number-timeline` and **misses** leftover `GET .../recent-official-bookings`. Already-recommended Wave A `assemble.test.ts` / `module.test.ts` / `recent-official-bookings.test.ts` prove leftover emit / redact / sample through the service, not this router. Already-recommended `trustedActor.test.ts` never hits `/admin/job-number-timeline*`. CLI does **not** import this file. Not this **interface**: leftover `createJobNumberTimelineModule` itself, leftover `assembleJobNumberTimeline`, leftover `listRecentOfficialBookingExamples`, leftover `loadJobNumberTimelineRows`, leftover `projectGranotJob`, leftover CLI `render`.
- Seams callers need: after `/api/v1` secret (parent mount) vs Drive / extension desks **before**; leftover `GET .../recent-official-bookings` **before** leftover `GET .../job-number-timeline` (knowledge first-match; two HTTP **adapters** on one factory); leftover `requireRegistryOwnerActor` on **both** paths (no leftover read-actor hatch — signed Admin is **403**); leftover Zod miss `400` `"invalid_job_number"` vs leftover assembler closed statuses **always HTTP `200`** `{ ok: true, data }`; leftover factory `createJobNumberTimelineAdminRouter(deps)` (test injection) vs default export (live mount); leftover `defaultRead` binds leftover `createMongoEvidenceLoader` + leftover `module.read` vs leftover `defaultListRecentOfficialBookings` binds leftover `createMongoRecentOfficialBookingLister` + leftover `listRecentOfficialBookingExamples`; leftover `sendError` leftover `isRegistryError` → `{ ok: false, code: registryCode, error: message, request_id }` vs leftover `ZodError` → `400` `"invalid_job_number"` (no leftover `issues`) vs unhandled → log leftover `job-number-timeline.admin.unhandled` + `500` `"Internal error"` (never leftover `error.message`). There is no begin / complete Domain Command **seam** in this file. There is no redact **seam** (leftover `module.read` redacts). There is no assemble **seam**. There is no forensic Granot **seam**. There is no catalog **seam**. There is no write **seam**.
- Split later (only if the file outgrows one sitting): this ~134-line file is one sitting if you read it as hand the signed Owner at most three recent official Booking Job Numbers after the secret, then tell the owner-facing chain for the Job Number they typed — never put this desk before the secret, never assemble here, never call the forensic Granot job page, never catalog, never mutate, never echo an unhandled throw. Do not split. Never `create.ts` / `update.ts` / `delete.ts` / `list.ts` / `timeline.ts`. Typed-job emit stays already-recommended `assemble.ts`. Redact stays leftover `module.ts`. Sample paint stays already-recommended `recent-official-bookings.ts`. Forensic job page stays already-recommended `projections.ts`.

`router.get("/api/v1/admin/job-number-timeline/recent-official-bookings")` / `router.get("/api/v1/admin/job-number-timeline")` are HTTP verbs. The owner question is: *The Owner opened the Job Number timeline desk. Someone already passed the API secret. First hand them at most three official Booking Job Numbers they can type — newest book date first — and the booked-at clock for each. Then, when they type a Job Number, authorize, validate, ask leftover `module.read`, and hand back the assembler bag. If the typed value is blank, say invalid at the desk. If the assembler says not found, filtered out, or invalid, still answer HTTP 200 with that status inside `data`. If something throws, say Internal error and keep the real message on the server log. Do not put this desk before the secret. Do not assemble the chain here. Do not hop Mongo here. Do not call leftover `projectGranotJob`. Do not paginate. Do not invent an official Booking. Do not echo `error.message`.*

Who assembles and redacts already lives in leftover `module.ts`. Who paints three Booking examples already lives in already-recommended `recent-official-bookings.ts`. Who hops Mongo already lives in already-recommended `mongo-evidence-loader.ts`. Who may speak already lives in already-recommended `trustedActor.ts`. Who paints the forensic Granot job page already lives in already-recommended `projections.ts`. Do not pull those in.

## What this file actually does

Two operations for the Job Number timeline **desk**, not “a timeline CRUD dump,” and not Assemble The Owner-Facing Chain / Hand Three Official Booking Job Numbers themselves:

1. **Hand at most three recent official Booking Job Numbers** — `GET /api/v1/admin/job-number-timeline/recent-official-bookings`. Registered **first**. `connectMongo`. **Ask** leftover `requireRegistryOwnerActor(req, auth(req))`. **Ask** leftover `listRecentOfficialBookings` (injected, or leftover `defaultListRecentOfficialBookings` → leftover `listRecentOfficialBookingExamples(createMongoRecentOfficialBookingLister(db))`). Answer **200** `{ ok: true, data: { bookings } }`. This beat does **not** parse a query. This beat does **not** **ask** leftover `module.read`. This beat does **not** page. This beat does **not** copy contact. This beat does **not** remount leftover `requireApiSecret`.

2. **Tell the owner-facing chain for the typed Job Number** — `GET /api/v1/admin/job-number-timeline`. Same connect + leftover Owner gate. Parse leftover `querySchema` (`job_no` trim min 1; optional leftover `source_granularity_id` / leftover `source_company_id` trim min 1). **Ask** leftover `read` (injected, or leftover `defaultRead` → leftover `createJobNumberTimelineModule({ loader: createMongoEvidenceLoader({ db }) }).read(query)`). Answer **200** `{ ok: true, data }` for leftover `ok` / leftover `not_found` / leftover `filtered_out` / leftover assembler `invalid_job_number`. This beat does **not** import leftover `assembleJobNumberTimeline`. This beat does **not** redact (leftover `module.read` already did). This beat does **not** evaluate leftover `current_outcome`. This beat does **not** **ask** leftover `projectGranotJob`.

`auth` / `requestId` / leftover `sendError` / leftover `defaultRead` / leftover `defaultListRecentOfficialBookings` are beats inside these operations, not extra owner stories. `auth` reads leftover `req.vantageAuth` that leftover `requireApiSecret` already set. `requestId` prefers leftover `x-vantage-admin-request-id`, else leftover `x-request-id`. Leftover `sendError` is leftover `isRegistryError` → leftover `error.statusCode` + leftover `code: registryCode` + leftover `request_id`; leftover `ZodError` → **400** `{ ok: false, error: "invalid_job_number", request_id }` with **no** leftover `issues`; else leftover `logger.error` (`job-number-timeline.admin.unhandled`) + **500** `{ ok: false, error: "Internal error", request_id }`. They are private.

There is no third assemble operation. There is no leftover forensic Granot operation. There is no leftover catalog operation. Leftover recent and leftover typed are two HTTP **adapters** on one factory. Leftover Zod `400` `"invalid_job_number"` and leftover assembler `invalid_job_number` (HTTP `200`) are two refuse **adapters** for a bad typed value — do not collapse them so “one invalid owns the desk.”

## Organization

Keep one file. This is the screenplay for “after the secret, let a signed Owner see three official Booking Job Numbers they can type, then tell the owner-facing chain for the Job Number they typed — never assemble here, never call the forensic Granot job page, never catalog, never mutate.” Already-recommended leftover `module.read` / leftover sample paint / leftover Mongo hop / leftover speaking gate / leftover forensic job page already live in deeper **modules**. Do not pull those in. Do not invent a `JobNumberTimelineAdminRoutesService` class. Do not invent a begin / complete Domain Command **seam**. Do not invent an assemble HTTP **adapter** so “the desk can skip redact.” Do not invent a catalog **adapter** so “the desk can page every Job Number.” Do not invent a CRUD folder so `list.ts` / `timeline.ts` each get a file.

Do not move leftover `assembleJobNumberTimeline` into this file so “the route owns the chain.” Do not mount this router before leftover `requireApiSecret` so “it matches Drive.” Do not merge this router into `v1.routes.ts` so “one file owns every admin path.” Do not merge leftover `GET .../job-number-timeline` into leftover `GET .../granot-lifecycle/jobs/:normalized_job_no` so “one Job path owns every story.” Do not split `create.ts` / `update.ts` / `delete.ts` / `list.ts`.

**External interface** stays small (this is the test surface):

| Keep exporting | Story name | Why the seam exists |
|---|---|---|
| `createJobNumberTimelineAdminRouter` | `createOwnerJobNumberTimelineDesk` | leftover factory injects connect / leftover `module.read` / leftover sample for the route test |
| `default` router | `ownerJobNumberTimelineDesk` | already-recommended public v1 desk mounts the zero-arg instance **after** the secret |
| `GET .../recent-official-bookings` (today unexported handler) | `handAtMostThreeRecentOfficialBookingJobNumbersOverHttp` | Owner sample; registered first; never leftover `module.read` |
| `GET .../job-number-timeline` (today unexported handler) | `tellTheOwnerFacingJobNumberChainOverHttp` | Owner typed; leftover Zod then leftover `module.read`; closed statuses stay HTTP `200` |
| `JobNumberTimelineAdminDeps` | `OwnerJobNumberTimelineDeskDeps` | test injection bag — connect / read / listRecentOfficialBookings |

Keep the default export and the factory as one-line aliases until `v1.routes.ts` and the route test migrate. Do not make callers learn `defaultRead` / `defaultListRecentOfficialBookings` / `querySchema` / `sendError` / `auth` as the domain language. Do **not** export the handlers so “the test can unit the helper.” Do **not** export leftover Zod onto a new barrel in this rename — leave that for the validation pass. Do **not** rename leftover service exports (`createJobNumberTimelineModule` / `listRecentOfficialBookingExamples` / `assembleJobNumberTimeline`) here — those stay already-recommended Wave A or leftover `module.ts`. Do **not** add `POST` / `PATCH` / `DELETE` so “the desk can write a Job Number.” Do **not** add a cursor or leftover `limit` so “recent is a catalog.”

**No class for the workflow.** The one type that *does* earn a name is the HTTP handoff leftover typed path already paints after leftover `module.read` returns:

```ts
type OwnerJobNumberTimelineResponse = {
  ok: true
  data: JobTimelineAssembleResult // leftover ok | not_found | filtered_out | invalid_job_number
}
```

That is the handoff from “leftover `module.read` already assembled and redacted” to “the Admin Dashboard may paint the page without recomputing leftover `current_outcome`.” Do **not** add leftover `page` onto leftover `not_found`. Do **not** add leftover contact, SMS body, Sheet id, or leftover `error.message` onto that bag. Do **not** add a Mongo `ClientSession` so “the route owns the hop.”

A second named bag already exists for the sample:

```ts
type OwnerOfficialBookingExamplesResponse = {
  ok: true
  data: { bookings: Array<{ job_no: string; booked_at: string }> }
}
```

That is the handoff from “already-recommended sample paint landed” to “the owner can type one of these Job Numbers.” Do **not** add leftover `customer_name`. Do **not** raise leftover `RECENT_OFFICIAL_BOOKING_EXAMPLE_LIMIT` from this file.

Leave leftover `module.read` on leftover `module.ts`. Leave leftover sample paint on already-recommended `recent-official-bookings.ts`. Leave leftover Mongo hop on already-recommended `mongo-evidence-loader.ts`. Leave leftover speaking gate on already-recommended `trustedActor.ts`. Leave leftover forensic job page on already-recommended `projections.ts`. Leave the global `/api/v1` secret on leftover `requireApiSecret` (parent mount).

## The file, as a story

Parent functions stay deep. Child names are only extracted when they hide a real decision, not a one-liner.

```ts
// job-number-timeline-admin.routes.ts
// Someone already passed the API secret.
// Let a signed Owner see three official Booking Job Numbers they can type.
// Then tell the owner-facing chain for the Job Number they typed.

export function createOwnerJobNumberTimelineDesk(deps = {}) {
  const ownerJobNumberTimelineDesk = Router()
  const connect = deps.connect ?? connectMongo
  const readTheTypedJobNumber = deps.read ?? askModuleReadThroughTheConnectedMongo
  const listRecentOfficialBookings =
    deps.listRecentOfficialBookings ?? askTheOfficialBookingSampleThroughTheConnectedMongo

  // ── 1. Hand at most three recent official Booking Job Numbers ─

  ownerJobNumberTimelineDesk.get(
    "/api/v1/admin/job-number-timeline/recent-official-bookings",
    handAtMostThreeRecentOfficialBookingJobNumbersOverHttp,
    // Owner; registered first; never module.read
  )

  // ── 2. Tell the owner-facing chain for the typed Job Number ─

  ownerJobNumberTimelineDesk.get(
    "/api/v1/admin/job-number-timeline",
    tellTheOwnerFacingJobNumberChainOverHttp,
    // Owner; Zod then module.read; closed statuses stay HTTP 200
  )

  return ownerJobNumberTimelineDesk
}

async function handAtMostThreeRecentOfficialBookingJobNumbersOverHttp(req, res) {
  await connect()
  requireRegistryOwnerActor(req, whoTheSecretAlreadyAdmitted(req))
  const bookings = await listRecentOfficialBookings()
  return res.status(200).json({ ok: true, data: { bookings } })
}

async function tellTheOwnerFacingJobNumberChainOverHttp(req, res) {
  await connect()
  requireRegistryOwnerActor(req, whoTheSecretAlreadyAdmitted(req))
  const query = parseTheTypedJobNumberQuery(req.query) // Zod; blank → 400 invalid_job_number
  const data = await readTheTypedJobNumber(query)      // module.read; never assemble.ts
  return res.status(200).json({ ok: true, data })
}

async function askModuleReadThroughTheConnectedMongo(input) {
  const db = mongoose.connection.db
  if (!db) throw new Error("Mongo is not connected")
  return createJobNumberTimelineModule({
    loader: createMongoEvidenceLoader({ db }),
  }).read(input)
}

async function askTheOfficialBookingSampleThroughTheConnectedMongo() {
  const db = mongoose.connection.db
  if (!db) throw new Error("Mongo is not connected")
  return listRecentOfficialBookingExamples(createMongoRecentOfficialBookingLister(db))
}

function refuseTheDesk(res, error, requestId) {
  if (isRegistryError(error)) {
    return res.status(error.statusCode).json({
      ok: false,
      code: error.registryCode,
      error: error.message,
      request_id: requestId ?? null,
    })
  }
  if (error instanceof z.ZodError) {
    return res.status(400).json({
      ok: false,
      error: "invalid_job_number",
      request_id: requestId ?? null,
    })
  }
  logger.error({ err: error, request_id: requestId ?? null, msg: "job-number-timeline.admin.unhandled" })
  return res.status(500).json({
    ok: false,
    error: "Internal error",
    request_id: requestId ?? null,
  })
}
```

Read the sample-then-typed path out loud: *Someone already passed the API secret. A signed Owner opens the desk. First hand at most three official Booking Job Numbers they can type. Then they type a Job Number. Gate. Parse. Ask leftover `module.read`. Answer 200 with the assembler bag — even when the status is not found. Do not assemble here. Do not call the forensic Granot job page. Do not echo the throw.*

That is the operation. `router.get("/api/v1/admin/job-number-timeline")` is not.

## Precise logic I would tighten while renaming

These are real smells the story names make obvious. Do not “just rename.”

1. **This desk sits after the secret. Drive and extension login do not.** Already-recommended public v1 desk mounts this file **after** `router.use("/api/v1", requireApiSecret)`. This file therefore does **not** remount leftover `requireApiSecret`. Leftover `auth(req)` only exists because the parent already set leftover `vantageAuth`. Do not silently add per-route leftover `requireApiSecret` so “it matches Drive.” Do not silently move this mount before the global guard so “Owner timeline can run without a secret.”

2. **Recent must stay registered first.** Knowledge already names that order. Today both paths are exact strings, so Express would not steal `recent-official-bookings` as a query on leftover `/job-number-timeline`. Keep the registered-first order anyway. Do not silently swap them so “typed is the primary path.” Do not silently merge leftover recent onto leftover `GET .../job-number-timeline?examples=1` so “one Job path owns sample and chain.”

3. **Zod `400` `"invalid_job_number"` is not assembler `invalid_job_number`.** Leftover blank / missing leftover `job_no` never reaches leftover `module.read`. Leftover `"???"` that does not normalize **does** reach leftover `module.read` and comes back HTTP `200` `{ data: { status: "invalid_job_number", normalized_job_no: null } }`. Knowledge already names both. Do not silently map leftover assembler `invalid_job_number` onto leftover `400` so “one invalid owns the desk.” Do not silently map leftover `not_found` onto leftover `404` so “REST wins.”

4. **Every leftover `ZodError` becomes `"invalid_job_number"`.** Leftover recent path has no Zod today, so the lie is latent. A later leftover `limit` on the sample would still answer leftover `"invalid_job_number"`. Do not silently add leftover `issues` so “it matches leftover v1 `Invalid request payload`” without a paired test. Do not move leftover `querySchema` onto leftover `src/validation/v1/` in this rename.

5. **`sendError` is a third refuse shape.** Already-recommended public v1 desk uses leftover `toHttpBody()` (`registry_code`). Already-recommended Granot lifecycle desk remaps leftover registry 403 / leftover `ACTOR_*` to leftover `OWNER_REQUIRED` and leftover Zod to leftover `"Invalid request"` + leftover `GRANOT_VALIDATION_FAILED`. This desk keeps leftover `code: registryCode` plus leftover `request_id` and does **not** remap. Admin **403** tests only lock the status. Do not silently import leftover Granot leftover `sendError` so “one refuse owns every Owner desk.” Do not silently swallow a leftover Mongo throw into `{ ok: false, error: error.message }` so “the desk can debug.”

6. **Unhandled 500 must not echo `error.message`.** The route test already locks leftover `"mongo connection string leaked"` stays off the body. Leftover `defaultRead` / leftover `defaultListRecentOfficialBookings` throw leftover `"Mongo is not connected"` when leftover `mongoose.connection.db` is missing after leftover `connect()`. That string would become leftover `"Internal error"` too. Do not silently answer leftover `503` so “not-connected looks finished” without a paired test.

7. **Default live path must keep asking leftover `module.read`, not leftover `assembleJobNumberTimeline`.** Leftover `module.read` normalizes, may leftover `filtered_out` with empty leftover `scopes` before load, hops, assembles, then redacts. Importing leftover `assemble.ts` from this file would skip redact and skip leftover company-granularity mismatch. Do not silently short-circuit so “the desk can unit assemble.” Do not silently **ask** leftover `projectGranotJob` so “one Job Number owns every story.”

8. **Default sample path must keep asking leftover `listRecentOfficialBookingExamples`, not leftover `module.read`.** Already-recommended Wave A rec already says this. Do not silently hop receipts so “the sample can preview the chain.” Do not raise leftover `RECENT_OFFICIAL_BOOKING_EXAMPLE_LIMIT` from the route.

9. **Operator skill and folder `v1.routes.test.ts` miss the sample path.** Leftover `.cursor/skills/hit-vantage-api/SKILL.md` lists leftover `GET /api/v1/admin/job-number-timeline` only. Folder `v1.routes.test.ts` lists none of this desk. Do not drop leftover `GET .../recent-official-bookings` so “the skill list wins.” Do not treat the skill as this desk’s **interface**.

10. **Admin is not a reader here.** Sibling leftover Granot cases **ask** leftover `requireRegistryReadActor` (signed Admin may see the intake queue). This desk **asks** leftover Owner on **both** paths. Do not silently switch leftover recent to leftover read-actor so “Admin can pick a Job Number.” Do not teach leftover extension Owner Bearer to read these paths so “the extension can open the desk.”

11. **Leave sibling modules alone.** Leftover `createJobNumberTimelineModule` / leftover `listRecentOfficialBookingExamples` / leftover `createMongoEvidenceLoader` / leftover `requireRegistryOwnerActor` are already the right **depth**. This file orchestrates the HTTP **adapters**.

## Testing

The **interface** is the test surface: leftover `createOwnerJobNumberTimelineDesk` (mounted on already-recommended `publicV1Desk` **after** the secret) and `handAtMostThreeRecentOfficialBookingJobNumbersOverHttp` / `tellTheOwnerFacingJobNumberChainOverHttp`.

Today `job-number-timeline-admin.routes.test.ts` already names Owner typed `200`, Admin **403**, leftover `not_found` without `page`, Owner recent Job Numbers only, Admin recent **403**, and leftover `500` `"Internal error"` without leftover `error.message`. It misses leftover Zod `400`, leftover assembler `invalid_job_number` / leftover `filtered_out` as HTTP `200`, leftover filter forward, and unsigned refuse body. Folder `v1.routes.test.ts` never lists this desk. Already-recommended Wave A files prove leftover emit / redact / sample through the service — not this desk.

Keep the inject-and-sign style. Add the missing operations (do not boot leftover Mongo hop, leftover assemble, or leftover RingCentral in the route file):

**After the secret / who may speak**
- This desk is registered on `publicV1Desk` **after** `router.use("/api/v1", requireApiSecret)` and has **no** per-route leftover `requireApiSecret`.
- Both paths **ask** leftover `requireRegistryOwnerActor`. Signed Admin **403**. Sales / Employee leftover `FORBIDDEN`. Extension Owner Bearer leftover `FORBIDDEN` (not leftover Agent catalog).
- Unsigned / missing HMAC is leftover `isRegistryError` with leftover `code` + leftover `request_id` (not leftover Granot `OWNER_REQUIRED` remap, not leftover v1 `registry_code`).

**Sample**
- Leftover `GET .../recent-official-bookings` is registered **before** leftover `GET .../job-number-timeline`.
- Owner **200** `{ ok: true, data: { bookings } }` with leftover `job_no` + leftover `booked_at` only.
- This beat does **not** **ask** leftover `read`.
- Admin **403** and does **not** list Bookings.

**Typed chain**
- Owner leftover `job_no=P5562924` **asks** leftover `read` and answers **200** leftover `status: "ok"` with leftover `page`.
- Leftover `source_granularity_id` / leftover `source_company_id` are forwarded on leftover `read(input)`.
- Leftover `job_no=missing` answers **200** leftover `not_found` and leftover `page` is absent.
- Injected leftover `invalid_job_number` answers **200** `{ data: { status: "invalid_job_number" } }` — not leftover `400`.
- Injected leftover `filtered_out` answers **200** with leftover `scopes`.
- Missing / blank leftover `job_no` answers **400** `{ error: "invalid_job_number" }` and does **not** **ask** leftover `read`.
- Unhandled throw answers **500** `{ error: "Internal error" }` and does **not** echo leftover `error.message`.

**Not this file**
- First-hop miss / snapshot-only cancel / WordPress `source_received` stay on already-recommended [job-number-timeline-assemble.md](job-number-timeline-assemble.md) / leftover `module.ts`.
- Redact stays on leftover `module.ts`.
- Sample cap / newest `book_date` / no contact stay on already-recommended [job-number-timeline-recent-official-bookings.md](job-number-timeline-recent-official-bookings.md).
- Mongo hop / safe projection stay on already-recommended [job-number-timeline-mongo-evidence-loader.md](job-number-timeline-mongo-evidence-loader.md).
- Outcome / attention / 250-cap stay on already-recommended [job-number-timeline-outcome.md](job-number-timeline-outcome.md) / [job-number-timeline-attention.md](job-number-timeline-attention.md) / [job-number-timeline-projector.md](job-number-timeline-projector.md).
- Forensic leftover `projectGranotJob` stays on already-recommended [granot-lifecycle-projections.md](granot-lifecycle-projections.md) and already-recommended [routes-granot-lifecycle-admin.md](routes-granot-lifecycle-admin.md).
- HMAC / preview hatch stay on already-recommended [operations-registry-trusted-actor.md](operations-registry-trusted-actor.md).
- Unguarded login / Drive callback stay on already-recommended [routes-extension-auth.md](routes-extension-auth.md) / [routes-google-drive-oauth.md](routes-google-drive-oauth.md).

Do **not** add a test per helper (`whoTheSecretAlreadyAdmitted`, `askModuleReadThroughTheConnectedMongo`, `refuseTheDesk`). Those names exist so the parent reads. If a helper test has to change when the helper is inlined, it was testing past the **interface**.

Do **not** export `sendError` so “the test can unit the refuse.”

## What I would not do

- A `JobNumberTimelineAdminRoutesService` class with `create` / `update` / `delete` / `list`.
- Thirty two-line functions that only wrap `res.json({ ok: true, data })`.
- Moving this into a CRUD folder (`create.ts` / `update.ts` / `delete.ts`) or splitting `list.ts` / `timeline.ts` “for cleanliness.”
- Breaking the after-secret **seam**: this desk stays after `/api/v1` secret; do not put Owner Job Number reads in front of `x-api-secret`.
- Breaking the recent-first **seam**: do not let leftover typed registration hide leftover `recent-official-bookings`.
- Treating leftover `assembleJobNumberTimeline`, leftover `projectGranotJob`, leftover CLI `render`, leftover Drive / extension desks, leftover inbound-number desk, or leftover webhook / cron routers as this story.
- Inventing an assemble, catalog, or forensic Granot **adapter** that has only one caller in this pass.
- Silently remounting leftover `requireApiSecret`, mapping leftover assembler `not_found` onto leftover `404`, importing leftover `assemble.ts` so “the desk can skip redact,” merging leftover `/job-number-timeline` into leftover `/granot-lifecycle/jobs/:normalized_job_no`, echoing leftover `error.message`, or moving Zod onto a new barrel while recommending a rename.
- Jumping to `models/` / `validation/` / `config/domain/` / `middleware/` / `auth/` while this checklist has unchecked modules.
- Writing a whole-folder recommendation for `routes`.
