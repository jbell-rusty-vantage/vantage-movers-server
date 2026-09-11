# Let The Signed Owner Watch Live Webhook Receipts After The Secret, Search Historical Receipts, See The Intake Queue, Resolve A Discrepancy, Confirm Or Cancel Or Connect A Lead, Then Start The Clock Or Requeue A Dead Letter — Never Put This Desk Before The Secret, Never Capture A Webhook Here, Never Drain Here, Never Mint An Official Booking Without An Owner Command — operational story

- Status: recommended
- Service: `routes` (Wave B, in-progress)
- Pass: 5 of this service — `granot-lifecycle-admin.routes.ts`
- Remaining in this service: `job-number-timeline-admin.routes.ts`, `conversations-admin.routes.ts`, `extension-users-admin.routes.ts`, `extension-granot-apply.routes.ts`, `tariff-adjustments.routes.ts`, `granot-automation.routes.ts`, `ingestion.routes.ts`, `reporting.routes.ts`, `granot-webhook.routes.ts`, `ringcentral-webhook.routes.ts`, `ringcentral-webhook-local.routes.ts`, `twilio-message-status.routes.ts`, `twilio-voice.routes.ts`, `ringcentral-cron.routes.ts`, `booking-reconciliation-cron.routes.ts`, `sheet-sync-cron.routes.ts`, `lead-messaging-cron.routes.ts`, `cpl-correction-cron.routes.ts`, `notification-cron.routes.ts`, `best-relocation-ingestion-cron.routes.ts`, `reporting-cron.routes.ts`, `granot-automation-cron.routes.ts`, `granot-lifecycle-cron.routes.ts`
- Target: `src/routes/granot-lifecycle-admin.routes.ts`
- Knowledge: no dedicated routes Service. Closest: [`docs/knowledge/granot-lifecycle/live-receipts.md`](../../../docs/knowledge/granot-lifecycle/live-receipts.md) (Owner `GET .../receipts/live` SSE + sibling `GET .../receipts`; unmasked contact; credential-redacted `granot_statement`; `/receipts/live` **before** `/receipts` and `/receipts/:id/requeue`; unsigned isolated calls are **403 `OWNER_REQUIRED`**, not 401). [`docs/knowledge/granot-lifecycle/projections.md`](../../../docs/knowledge/granot-lifecycle/projections.md) (Owner/Admin case / job / lead / health / discrepancy reads; Owner-only candidates + creating-observation; default case list is **booking-only**; missing case is `GRANOT_CASE_NOT_FOUND`; missing Lead keeps generic `"Lead not found"`). That file also lists discrepancy **mutations** under “Protected read surface” — they are not reads. [`docs/knowledge/granot-lifecycle/booking-reconciliation.md`](../../../docs/knowledge/granot-lifecycle/booking-reconciliation.md) (Owner Booking-case confirm / update / referral / Confirm Granot Cancellation / No Action; a case is **not** a Booking). [`docs/knowledge/granot-lifecycle/release-reconciliation.md`](../../../docs/knowledge/granot-lifecycle/release-reconciliation.md) (leftover historical Release-case HTTP; processor no longer opens those rows). [`docs/knowledge/services/bookings.md`](../../../docs/knowledge/services/bookings.md) (Owner Connect Booking to Lead from `/bookings` or `/manual`, **not** `/bookings/reconciliation`). Activation / requeue: already-recommended [granot-lifecycle-operations.md](granot-lifecycle-operations.md) (no dedicated `operations.md`; requeue is listed on [`drainer.md`](../../../docs/knowledge/granot-lifecycle/drainer.md)). Distinct from already-recommended public v1 desk: [routes-v1.md](routes-v1.md) (`router.use(granotLifecycleAdminRoutes)` **after** `/api/v1` secret — this file **is** that mount). Distinct from already-recommended inbound-number desk: [routes-ringcentral-registry.md](routes-ringcentral-registry.md) (sibling after the secret; this file never files a phone). Distinct from already-recommended unguarded desks: [routes-extension-auth.md](routes-extension-auth.md) and [routes-google-drive-oauth.md](routes-google-drive-oauth.md) (those sit **before** the secret). Distinct from next Wave B Job Number timeline desk: leftover `job-number-timeline-admin.routes.ts` (`GET /api/v1/admin/job-number-timeline` — this file’s `GET .../jobs/:normalized_job_no` **asks** leftover `projectGranotJob`, not leftover `module.read`). Distinct from already-recommended capture / drain / processor: [granot-lifecycle-capture.md](granot-lifecycle-capture.md), [granot-lifecycle-drainer.md](granot-lifecycle-drainer.md), [granot-lifecycle-processor.md](granot-lifecycle-processor.md) (this desk never inserts a receipt, never claims, never classifies). Distinct from already-recommended clock / requeue write: [granot-lifecycle-operations.md](granot-lifecycle-operations.md) (this file **asks** leftover `activateGranotLifecycle` / leftover `requeueDeadLetterReceipt`). Distinct from already-recommended queue / case / candidates / job / lead / health: [granot-lifecycle-projections.md](granot-lifecycle-projections.md). Distinct from already-recommended creating statement: [granot-lifecycle-creating-observation.md](granot-lifecycle-creating-observation.md). Distinct from already-recommended Owner Booking / Release / discrepancy commands: [granot-lifecycle-booking-confirmation.md](granot-lifecycle-booking-confirmation.md), [granot-lifecycle-booking-owner-commands.md](granot-lifecycle-booking-owner-commands.md), [granot-lifecycle-referral-booking.md](granot-lifecycle-referral-booking.md), [granot-lifecycle-release-owner-commands.md](granot-lifecycle-release-owner-commands.md), [granot-lifecycle-discrepancy-owner-commands.md](granot-lifecycle-discrepancy-owner-commands.md). Distinct from leftover Connect Booking to Lead: `src/services/granotLifecycle/connectBookingToLead.ts` (Wave A visited `granotLifecycle` **without** enumerating that file — do not reopen Wave A here). Distinct from already-recommended speaking gate: [operations-registry-trusted-actor.md](operations-registry-trusted-actor.md) (`requireRegistryReadActor` / `requireRegistryOwnerActor` — this file **asks** those; an extension Owner Bearer may **not** mutate these paths). Distinct from leftover Wave B Zod: `src/validation/v1/granotLifecycle.validation.ts`. Distinct from leftover Wave B secret: next `requireApiSecret.ts` (already-recommended public v1 desk already ran it). Distinct from leftover Wave B webhook / cron: next `granot-webhook.routes.ts` / `granot-lifecycle-cron.routes.ts` (those **ask** leftover capture / leftover drain; this file never does). Distinct from leftover employee-booking recon on already-recommended `v1.routes.ts`. Distinct from leftover extension apply: next `extension-granot-apply.routes.ts`. This checkout’s `CONTEXT.md` is a pointer plus four employee-booking terms — knowledge links Granot Observation Receipt / Booking Reconciliation Case / Job Number; do not invent a glossary copy. `docs/adr/` is absent here — do not invent ADR copies. Do not add a Routes Service file in this rename.
- Callers: **one runtime mount plus one focused route test.** Already-recommended `v1.routes.ts` **asks** the default export (`router.use(granotLifecycleAdminRoutes)` on line 292, **after** `router.use("/api/v1", requireApiSecret)`). Leftover `src/app.ts` mounts the public v1 desk, not this file. Tests on this **interface**: `granot-lifecycle-admin.routes.test.ts` (injects leftover `createGranotLifecycleAdminRouter` deps; signs leftover HMAC; names Owner requeue, case defaults, Release discriminants, unsigned 403, creating-observation Owner-only, candidates Owner-only, Lead `"Lead not found"`, Job limit 200, discrepancy reads + Owner commands, Booking confirm **201** / missing Idempotency-Key **400** / Admin **403**, update **200**, Referral **201**, No Action, booking-case confirm-cancellation **201** plus stubbed 409, leftover Release-case trio, Owner receipt search unmasked contact, `booking_action` imply / reject, Owner live SSE `text/event-stream`, Owner+Admin health). It does **not** name leftover `POST .../activation`. It does **not** name leftover `GET/POST .../bookings/:bookingId/connect-lead*`. Folder `v1.routes.test.ts` never lists this desk. Operator skill `.cursor/skills/hit-vantage-api/SKILL.md` lists health / cases / candidates / creating-observation / job / lead / discrepancies / four Booking-case posts / three Release-case posts / activation / requeue — it **misses** `GET .../receipts/live`, `GET .../receipts`, `POST .../booking-cases/:id/confirm-cancellation`, and both connect-lead paths. Already-recommended Wave A replica files prove leftover confirm / update / referral / Release / discrepancy / connect **through the service**, not this router. Already-recommended `trustedActor.test.ts` never hits `/admin/granot-lifecycle/*`. Not this **interface**: leftover `activateGranotLifecycle` itself, leftover `runLiveReceiptSse`, leftover `confirmBooking`, leftover `connectBookingToLead`, leftover `claimAndProcessOrPoll`, leftover webhook capture, leftover Job Number `module.read`.
- Seams callers need: after `/api/v1` secret (parent mount) vs Drive / extension desks **before**; leftover `requireRegistryReadActor` (cases / job / lead / health / discrepancy reads) vs leftover `requireRegistryOwnerActor` (live SSE / historical receipts / creating-observation / candidates / connect-lead / Owner commands / activate / requeue); leftover `/receipts/live` **before** leftover `GET /receipts` **before** leftover `POST /receipts/:id/requeue` (Express first-match); leftover Owner command **exactly one** `Idempotency-Key` from leftover `rawHeaders` vs leftover activate / requeue **without** that header; leftover confirm / referral / booking-cancel / Release-cancel **201** unless leftover `replayed` or leftover `already_satisfied` (**200**) vs leftover update / No Action / discrepancy **always 200** vs leftover activate **always 201**; leftover factory `createGranotLifecycleAdminRouter(deps)` (test injection) vs default export (live mount); leftover `sendError` remaps leftover registry **403** / leftover `ACTOR_*` to leftover `OWNER_REQUIRED` (not leftover `toHttpBody()`, not leftover v1 `"Invalid request payload"`); leftover case miss `GRANOT_CASE_NOT_FOUND` vs leftover Lead miss generic `{ ok: false, error: "Lead not found" }`; leftover SSE gate **before** `flushHeaders` (JSON refuse) vs leftover stream error **after** flush (`event: error`, never JSON). There is no begin / complete Domain Command **seam** in this file. There is no webhook-capture **seam**. There is no drain **seam**. There is no Job Number timeline **seam**.
- Split later (only if the file outgrows one sitting): this ~820-line file is one sitting if you read it as let the signed Owner watch live webhook receipts after the secret, search historical receipts, see the intake queue, resolve a discrepancy, confirm or cancel or connect a Lead, then start the clock or requeue a dead letter — never put this desk before the secret, never capture a webhook here, never drain here, never mint an official Booking without an Owner command. If it later splits, split by **story**, never CRUD: `watchLiveWebhookReceiptsOverHttp.ts`, `askAnOwnerBookingCaseCommandOverHttp.ts`, `connectThisOfficialBookingToALeadOverHttp.ts`. Never `create.ts` / `update.ts` / `delete.ts` / `activate.ts`. Clock / requeue stay already-recommended `operations.ts`. Queue / case / job / lead / health stay already-recommended `projections.ts`. Live SSE stay leftover `liveReceiptStream.ts`. Official mint stay already-recommended Booking / Release / discrepancy commands.

`router.get("/receipts/live")` / `router.post("/booking-cases/:id/confirm-booking")` / `router.post("/activation")` are HTTP verbs. The owner question is: *Granot already sent evidence. Someone already passed the API secret. Let a signed Admin or Owner see the intake queue, one case, the Job story, the Lead story, discrepancies, and whether the machine is alive. Let only a signed Owner watch the live webhook stream, search historical receipts with the real phone, read the Granot statement that opened the intake, browse attachable Leads, resolve a discrepancy, confirm or replace or refer or cancel or take No Action on a Booking case, do the same on leftover historical Release rows, connect an official Booking to a Lead, start the write-once clock, or put a dead letter back on the due list. Do not put this desk before the secret. Do not capture a webhook here. Do not drain here. Do not mint an official Booking because a receipt arrived. Do not treat `GET .../jobs/:normalized_job_no` as the Job Number timeline desk.*

Who watches Mongo and paints the SSE already lives in leftover `liveReceiptStream.ts`. Who searches historical receipts already lives in leftover `receiptSearch.ts`. Who composes the queue already lives in already-recommended `projections.ts`. Who starts the clock already lives in already-recommended `operations.ts`. Who mints the official Booking already lives in already-recommended `bookingConfirmation.ts`. Who may speak already lives in already-recommended `trustedActor.ts`. Do not pull those in.

## What this file actually does

Eight operations for the Granot lifecycle **desk**, not “a Granot admin CRUD dump,” and not Capture A Granot Webhook / Drain Due Work / Confirm This Granot Job themselves:

1. **Watch live webhook receipts** — `GET /api/v1/admin/granot-lifecycle/receipts/live`. `connectMongo`. **Ask** leftover `requireRegistryOwnerActor` **before** leftover `flushHeaders`. Then `text/event-stream`, no-cache, `X-Accel-Buffering: no`. **Ask** leftover `runLiveReceiptSse` with leftover snapshot / after / updated, leftover `Last-Event-ID`, and an abort when the client closes. After headers are flushed, a throw writes leftover `event: error` (`"Live stream failed"`) and ends — never leftover `sendError` JSON. This beat does **not** emit in-process. This beat does **not** include extension or HTTP-automation receipts. This beat does **not** remount leftover `requireApiSecret`.

2. **Search historical webhook receipts** — `GET /api/v1/admin/granot-lifecycle/receipts`. Same Owner gate. Parse leftover `granotLifecycleReceiptSearchQuerySchema`. **Ask** leftover `searchReceipts`. Answer `{ ok: true, data }` with unmasked contact and credential-redacted `granot_statement`. Leftover `booking_action` without leftover `route_event_class` implies `booking_status_changed` (Zod, not this file). Admin is **403 `OWNER_REQUIRED`**. This beat is **not** SSE. This beat does **not** requeue.

3. **Show the intake queue and the supporting cards** — `GET .../cases` and `GET .../cases/:case_id` **ask** leftover `requireRegistryReadActor` then leftover `listGranotLifecycleCases` / leftover `getGranotLifecycleCaseDetail`. List fills leftover defaults `state=open`, `sort=last_evidence_at`, `order=desc` (it does **not** default leftover `kind` — omitted kind stays booking-only inside the projector). Missing case throws leftover `GRANOT_CASE_NOT_FOUND`. `GET .../cases/:case_id/creating-observation` and `GET .../candidates` **ask** leftover Owner, then leftover `getIntakeCreatingObservation` / leftover `listGranotLifecycleCaseCandidates` (null → same 404). `GET .../jobs/:normalized_job_no` **asks** leftover read actor + leftover `projectGranotJob` (non-string path → leftover `VALIDATION_FAILED`). `GET /api/v1/admin/leads/:lead_model/:lead_id/lifecycle` **asks** leftover `projectGranotLeadTimeline`; null is generic `{ ok: false, error: "Lead not found" }` — **not** leftover `sendError`. `GET .../operations/health` **asks** leftover `projectGranotLifecycleHealth`. These beats do **not** attach a Lead. These beats do **not** confirm a Booking.

4. **Show and resolve discrepancies** — `GET .../discrepancies` and `GET .../:id` are leftover read-actor. Mutations share leftover `discrepancyAction`: Owner → leftover `durableActorFromRegistryActor` → leftover `Idempotency-Key` → leftover re-evaluate / correct-record-link / no-action → leftover `void observeGranotOwnerCommandResult` → **200**. The route owns leftover `discrepancy_id`; a body that repeats it is leftover Zod refuse. This beat does **not** write `BookedLead`. This beat does **not** project sheets.

5. **Connect an official Booking to a Lead** — `GET /api/v1/admin/bookings/:bookingId/connect-lead-candidates` (Owner; leftover `listConnectLeadCandidates`) and `POST .../connect-lead` (Owner + leftover `Idempotency-Key`; leftover `connectBookingToLead`; **201**, or **200** on leftover `replayed` / leftover `already_satisfied`). This beat does **not** call leftover `observeGranotOwnerCommandResult`. This beat does **not** open leftover employee-booking recon. This beat is **not** leftover `POST /bookings/reconciliation`.

6. **Ask an Owner Booking-case command** — five posts on leftover `/booking-cases/:id/*`. Same Owner + leftover `Idempotency-Key` + leftover `request_id`. Confirm / referral / confirm-cancellation answer **201** unless leftover `replayed` or leftover `already_satisfied` (**200**). Update and No Action answer **200**. After the return, leftover `void observeGranotOwnerCommandResult` (`case_kind: "booking"`). This beat does **not** open the case. This beat does **not** CRM-post.

7. **Ask a leftover historical Release-case command** — three posts on leftover `/release-cases/:id/*`. Same Owner + leftover `Idempotency-Key`. Confirm-cancellation **201**/200; update / No Action **200**. Observe with leftover `case_kind: "release"`. New Release evidence does **not** open these rows. This beat does **not** merge into leftover `/booking-cases/:id/confirm-cancellation` so “one cancel owns every case.”

8. **Start the write-once clock, or put a dead letter back** — `POST .../activation` (Owner; **no** leftover `Idempotency-Key`; leftover `activateGranotLifecycle`; **201**) and `POST .../receipts/:id/requeue` (Owner; leftover `:id` is `String(req.params.id)`, not leftover Zod ObjectId; leftover `requeueDeadLetterReceipt`; **200**). This beat does **not** flip effect flags. This beat does **not** claim the receipt.

`auth` / `requestId` / `readSingleIdempotencyKey` / leftover `discrepancyAction` / leftover `sendError` are beats inside these operations, not extra owner stories. `auth` reads leftover `req.vantageAuth` that leftover `requireApiSecret` already set. `requestId` prefers leftover `x-vantage-admin-request-id`, else leftover `x-request-id`. `readSingleIdempotencyKey` walks leftover `rawHeaders` and refuses anything except exactly one leftover `Idempotency-Key`. `sendError` first leftover `void observeGranotOwnerCommandConflict`, then leftover `GranotLifecycleError.toHttpBody()`, leftover registry 403/`ACTOR_*` → leftover `OWNER_REQUIRED`, leftover `ZodError` → `400` `"Invalid request"` + leftover `GRANOT_VALIDATION_FAILED` + flattened leftover `issues`, leftover `DomainCommandIdempotencyConflictError` → **409**, leftover `DomainCommandContextError` → **400**, else **rethrow**. They are private except leftover `readSingleIdempotencyKey` (exported today; do not make callers learn it).

There is no ninth capture operation. There is no leftover drain operation. There is no leftover Job Number timeline operation. Leftover `discrepancyAction` is one HTTP helper for three Owner stories. Leftover Booking-case and leftover Release-case confirm-cancellation are two HTTP **adapters** that share leftover Zod, not one command.

## Organization

Keep one file. This is the screenplay for “after the secret, let a signed reader see the intake queue; let only a signed Owner watch live receipts, search history, resolve a fight, write an official fact, start the clock, or requeue.” Already-recommended clock / queue / creating-statement / Owner commands / leftover live stream already live in deeper **modules**. Do not pull those in. Do not invent a `GranotLifecycleAdminRoutesService` class. Do not invent a begin / complete Domain Command **seam**. Do not invent a webhook HTTP **adapter** so “the desk can prove Granot posted.” Do not invent a drain HTTP **adapter** so “requeue runs the processor.” Do not invent a CRUD folder so `create.ts` / `update.ts` / `activate.ts` each get a file.

Do not move leftover `confirmBooking` into this file so “the route owns the mint.” Do not mount this router before leftover `requireApiSecret` so “it matches Drive.” Do not merge this router into `v1.routes.ts` so “one file owns every admin path.” Do not merge leftover `GET .../jobs/:normalized_job_no` into next `job-number-timeline-admin.routes.ts` so “one Job path owns every story.” Do not split `create.ts` / `update.ts` / `delete.ts`.

**External interface** stays small (this is the test surface):

| Keep exporting | Story name | Why the seam exists |
|---|---|---|
| `createGranotLifecycleAdminRouter` | `createOwnerGranotLifecycleDesk` | leftover factory injects connect / project / command / SSE clocks for the route test |
| `default` router | `ownerGranotLifecycleDesk` | already-recommended public v1 desk mounts the zero-arg instance **after** the secret |
| `GET .../receipts/live` (today unexported handler) | `watchLiveWebhookReceiptsOverHttp` | Owner SSE; gate before flush |
| `GET .../receipts` (today unexported handler) | `searchHistoricalWebhookReceiptsOverHttp` | Owner JSON; unmasked contact |
| `GET .../cases` / `GET .../cases/:case_id` (today unexported) | `showTheIntakeQueueOverHttp` / `showOneIntakeCaseOverHttp` | signed read; booking-only default inside the projector |
| `GET .../creating-observation` / `GET .../candidates` (today unexported) | `handTheOwnerTheCreatingGranotStatementOverHttp` / `letTheOwnerBrowseAttachableLeadsOverHttp` | Owner reads; never attach |
| `GET .../jobs/:normalized_job_no` / `GET .../leads/.../lifecycle` / `GET .../operations/health` (today unexported) | `tellThisJobsLifecycleStoryOverHttp` / `tellThisLeadsLifecycleStoryOverHttp` / `showWhetherTheLifecycleIsAliveOverHttp` | signed read; Job path is **not** leftover `/job-number-timeline` |
| `GET/POST .../discrepancies*` (today unexported) | `showTheDiscrepancyQueueOverHttp` / `askTheOwnerToResolveThisDiscrepancyOverHttp` | read actor vs Owner + leftover `Idempotency-Key` |
| `GET/POST .../bookings/:bookingId/connect-lead*` (today unexported) | `showConnectLeadCandidatesOverHttp` / `connectThisOfficialBookingToALeadOverHttp` | Owner; not employee recon |
| `POST .../booking-cases/:id/*` (today unexported) | `askThisOwnerBookingCaseCommandOverHttp` | Owner; 201 vs 200 replay |
| `POST .../release-cases/:id/*` (today unexported) | `askThisLeftoverReleaseCaseCommandOverHttp` | historical HTTP only |
| `POST .../activation` / `POST .../receipts/:id/requeue` (today unexported) | `startTheWriteOnceClockOverHttp` / `putThisDeadLetterBackOnTheDueListOverHttp` | Owner; no leftover `Idempotency-Key` |
| `readSingleIdempotencyKey` | leftover header fold | exported today; unexport after callers stop asking it |

Keep the default export and the factory as one-line aliases until `v1.routes.ts` and the route test migrate. Do not make callers learn `discrepancyAction` / `sendError` / `auth` as the domain language. Do **not** export the handlers so “the test can unit the helper.” Do **not** export leftover Zod onto a new barrel in this rename — leave that for the validation pass. Do **not** rename leftover service exports (`confirmBooking` / `activateGranotLifecycle` / `projectGranotJob`) here — those stay already-recommended Wave A or leftover. Do **not** add `DELETE .../cases/:id` so “resolve is REST.” Do **not** add `POST .../receipts` so “the desk can capture.”

**No class for the workflow.** The one type that *does* earn a name is the HTTP handoff leftover Owner commands already paint after leftover `durableActorFromRegistryActor` + leftover `Idempotency-Key`:

```ts
type OwnerGranotCommandEnvelope = {
  idempotency_key: string
  owner: DurableActor
  request_id?: string
}
```

That is the handoff from “the desk proved one Owner is speaking and sent exactly one key” to “already-recommended confirm / update / referral / cancel / No Action / discrepancy / connect may run.” Do **not** add a Mongo `ClientSession` onto that bag so “the route owns the transaction.” Do **not** put leftover `expected_case_revision` on the envelope — that stays on the command body. Leftover `EnvelopeForRoute` today is discrepancy-only (`discrepancy_id` baked in); widen the name, do not invent a second bag per verb.

Leave clock / requeue on already-recommended `operations.ts`. Leave the queue on already-recommended `projections.ts`. Leave live SSE on leftover `liveReceiptStream.ts`. Leave official mint on already-recommended Booking / Release / discrepancy modules. Leave leftover Connect on leftover `connectBookingToLead.ts`. Leave the speaking gate on already-recommended `trustedActor.ts`. Leave the global `/api/v1` secret on leftover `requireApiSecret` (parent mount).

## The file, as a story

Parent functions stay deep. Child names are only extracted when they hide a real decision, not a one-liner.

```ts
// granot-lifecycle-admin.routes.ts
// Someone already passed the API secret.
// Let a signed reader see the intake queue.
// Let only a signed Owner watch live receipts, search history,
// resolve a fight, write an official fact, start the clock, or requeue.

export function createOwnerGranotLifecycleDesk(deps = {}) {
  const ownerGranotLifecycleDesk = Router()

  // ── 1. Watch live webhook receipts ──────────────────────

  ownerGranotLifecycleDesk.get(
    "/api/v1/admin/granot-lifecycle/receipts/live",
    watchLiveWebhookReceiptsOverHttp,          // Owner; gate before flush
  )

  // ── 2. Search historical webhook receipts ───────────────

  ownerGranotLifecycleDesk.get(
    "/api/v1/admin/granot-lifecycle/receipts",
    searchHistoricalWebhookReceiptsOverHttp,   // Owner JSON; unmasked contact
  )

  // ── 3. Show the intake queue and supporting cards ───────

  ownerGranotLifecycleDesk.get(
    "/api/v1/admin/granot-lifecycle/cases",
    showTheIntakeQueueOverHttp,                // read actor; booking-only default
  )
  ownerGranotLifecycleDesk.get(
    "/api/v1/admin/granot-lifecycle/cases/:case_id",
    showOneIntakeCaseOverHttp,                 // CASE_NOT_FOUND
  )
  ownerGranotLifecycleDesk.get(
    "/api/v1/admin/granot-lifecycle/cases/:case_id/creating-observation",
    handTheOwnerTheCreatingGranotStatementOverHttp,
  )
  ownerGranotLifecycleDesk.get(
    "/api/v1/admin/granot-lifecycle/cases/:case_id/candidates",
    letTheOwnerBrowseAttachableLeadsOverHttp,  // never attach
  )
  ownerGranotLifecycleDesk.get(
    "/api/v1/admin/granot-lifecycle/jobs/:normalized_job_no",
    tellThisJobsLifecycleStoryOverHttp,        // not /job-number-timeline
  )
  ownerGranotLifecycleDesk.get(
    "/api/v1/admin/leads/:lead_model/:lead_id/lifecycle",
    tellThisLeadsLifecycleStoryOverHttp,       // generic Lead not found
  )
  ownerGranotLifecycleDesk.get(
    "/api/v1/admin/granot-lifecycle/operations/health",
    showWhetherTheLifecycleIsAliveOverHttp,
  )

  // ── 4. Show and resolve discrepancies ───────────────────

  ownerGranotLifecycleDesk.get(
    "/api/v1/admin/granot-lifecycle/discrepancies",
    showTheDiscrepancyQueueOverHttp,
  )
  ownerGranotLifecycleDesk.post(
    "/api/v1/admin/granot-lifecycle/discrepancies/:id/re-evaluate",
    askAgainWhetherThisJobStillFightsOverHttp,
  )
  ownerGranotLifecycleDesk.post(
    "/api/v1/admin/granot-lifecycle/discrepancies/:id/correct-record-link",
    pointThisJobAtTheLeadTheOwnerChoseOverHttp,
  )
  ownerGranotLifecycleDesk.post(
    "/api/v1/admin/granot-lifecycle/discrepancies/:id/no-action",
    closeThisDiscrepancyWithoutWritingOfficialFactsOverHttp,
  )

  // ── 5. Connect an official Booking to a Lead ────────────

  ownerGranotLifecycleDesk.get(
    "/api/v1/admin/bookings/:bookingId/connect-lead-candidates",
    showConnectLeadCandidatesOverHttp,
  )
  ownerGranotLifecycleDesk.post(
    "/api/v1/admin/bookings/:bookingId/connect-lead",
    connectThisOfficialBookingToALeadOverHttp, // no observeGranotOwnerCommandResult
  )

  // ── 6. Ask an Owner Booking-case command ────────────────

  ownerGranotLifecycleDesk.post(
    "/api/v1/admin/granot-lifecycle/booking-cases/:id/confirm-booking",
    confirmThisGranotJobAsAnOfficialBookingOverHttp, // 201 / 200 replay
  )
  ownerGranotLifecycleDesk.post(
    "/api/v1/admin/granot-lifecycle/booking-cases/:id/update-booking",
    replaceTheOfficialBookingTheOwnerReviewedOverHttp,
  )
  ownerGranotLifecycleDesk.post(
    "/api/v1/admin/granot-lifecycle/booking-cases/:id/create-referral-booking",
    mintTheReferralBookingWithNoLeadOverHttp,
  )
  ownerGranotLifecycleDesk.post(
    "/api/v1/admin/granot-lifecycle/booking-cases/:id/confirm-cancellation",
    confirmThisGranotCancellationOnTheBookingCaseOverHttp,
  )
  ownerGranotLifecycleDesk.post(
    "/api/v1/admin/granot-lifecycle/booking-cases/:id/no-action",
    closeThisBookingCaseWithNoOfficialWriteOverHttp,
  )

  // ── 7. Leftover historical Release-case commands ────────

  ownerGranotLifecycleDesk.post(
    "/api/v1/admin/granot-lifecycle/release-cases/:id/confirm-cancellation",
    confirmThisLeftoverReleaseCancellationOverHttp,
  )
  ownerGranotLifecycleDesk.post(
    "/api/v1/admin/granot-lifecycle/release-cases/:id/update-booking",
    replaceTheOfficialBookingFromALeftoverReleaseCaseOverHttp,
  )
  ownerGranotLifecycleDesk.post(
    "/api/v1/admin/granot-lifecycle/release-cases/:id/no-action",
    closeThisLeftoverReleaseCaseWithNoOfficialWriteOverHttp,
  )

  // ── 8. Start the clock, or put a dead letter back ───────

  ownerGranotLifecycleDesk.post(
    "/api/v1/admin/granot-lifecycle/activation",
    startTheWriteOnceClockOverHttp,            // no Idempotency-Key; 201
  )
  ownerGranotLifecycleDesk.post(
    "/api/v1/admin/granot-lifecycle/receipts/:id/requeue",
    putThisDeadLetterBackOnTheDueListOverHttp, // after /receipts/live
  )

  return ownerGranotLifecycleDesk
}

export default createOwnerGranotLifecycleDesk()

async function watchLiveWebhookReceiptsOverHttp(req, res) {
  await connectMongo()
  refuseThisRegistryMutationUnlessASignedOwnerIsSpeaking(
    req,
    whoTheSecretAlreadyAdmitted(req),
  )
  openTheLiveReceiptEventStream(res)           // flush after the gate
  await runLiveReceiptSse(/* snapshot / after / updated; Last-Event-ID */)
}

async function confirmThisGranotJobAsAnOfficialBookingOverHttp(req, res) {
  await connectMongo()
  const owner = durableActorFromRegistryActor(
    refuseThisRegistryMutationUnlessASignedOwnerIsSpeaking(
      req,
      whoTheSecretAlreadyAdmitted(req),
    ),
  )
  const { case_id } = granotLifecycleCaseParamsSchema.parse({ case_id: req.params.id })
  const command = granotLifecycleConfirmBookingCommandSchema.parse(req.body)
  const data = await confirmThisGranotJobAsAnOfficialBooking({
    case_id,
    ...command,
    ...readTheOwnerCommandEnvelope(req, owner),
  })
  void observeGranotOwnerCommandResult({
    replayed: data.replayed,
    command: "confirmGranotBooking",
    case_kind: "booking",
    case_resolved: data.case_state === "resolved",
  })
  return res
    .status(data.replayed || data.outcome === "already_satisfied" ? 200 : 201)
    .json({ ok: true, data })
}

function readExactlyOneIdempotencyKey(req) {
  const matches = []
  for (let i = 0; i < req.rawHeaders.length; i += 2) {
    if (req.rawHeaders[i]?.toLowerCase() === "idempotency-key") {
      matches.push(req.rawHeaders[i + 1] ?? "")
    }
  }
  if (matches.length !== 1) {
    throw new GranotLifecycleError(
      "Exactly one Idempotency-Key header is required",
      GRANOT_LIFECYCLE_ERROR_CODES.VALIDATION_FAILED,
      400,
      requestId(req),
    )
  }
  return matches[0]
}

function refuseThisGranotLifecycleRequest(res, error, requestIdValue) {
  void observeGranotOwnerCommandConflict(error)
  if (isGranotLifecycleError(error)) return res.status(error.statusCode).json(error.toHttpBody())
  if (isRegistryError(error) && (error.statusCode === 403 || String(error.registryCode).includes("ACTOR_"))) {
    return res.status(403).json({
      ok: false,
      code: GRANOT_LIFECYCLE_ERROR_CODES.OWNER_REQUIRED,
      error: "Owner authority is required",
      request_id: requestIdValue ?? null,
    })
  }
  if (error instanceof ZodError) {
    return res.status(400).json({
      ok: false,
      code: GRANOT_LIFECYCLE_ERROR_CODES.VALIDATION_FAILED,
      error: "Invalid request",                 // not leftover v1 "Invalid request payload"
      request_id: requestIdValue ?? null,
      issues: error.issues.map((issue) => ({ path: issue.path.join("."), message: issue.message })),
    })
  }
  throw error                                   // no 500 JSON after unknown
}
```

Read the watch-then-confirm path out loud: *Someone already passed the API secret. A signed Owner opens the live stream. Gate first. Flush SSE headers. Ask leftover Mongo-polled snapshot. Then they search historical receipts and see the real phone. Then they open the intake queue — signed Admin may do that part. Then they post confirm-booking with exactly one Idempotency-Key, a case revision, a Lead, and official details. Ask already-recommended confirm. Answer 201. Do not capture the webhook here. Do not drain here. Do not mint because the receipt arrived.*

That is the operation. `router.post("/booking-cases/:id/confirm-booking")` is not.

## Precise logic I would tighten while renaming

These are real smells the story names make obvious. Do not “just rename.”

1. **This desk sits after the secret. Drive and extension login do not.** Already-recommended public v1 desk mounts this file **after** `router.use("/api/v1", requireApiSecret)`. This file therefore does **not** remount leftover `requireApiSecret`. Leftover `auth(req)` only exists because the parent already set leftover `vantageAuth`. Do not silently add per-route leftover `requireApiSecret` so “it matches Drive.” Do not silently move this mount before the global guard so “Owner work can run without a secret.”

2. **`/receipts/live` must stay registered before `/receipts` and `/receipts/:id/requeue`.** Knowledge already names that order. Express first-match would otherwise steal `live` as an id. Do not silently reorder so “requeue sits with activate.” Do not silently merge live SSE into leftover `GET /receipts?live=1` so “one receipts path owns stream and search.”

3. **`discrepancyAction` hides three owner stories behind a helper.** Already-recommended leftover re-evaluate / correct / no-action already share the durable envelope. One leftover helper, three HTTP **adapters**. Do not split them into `re-evaluate.ts` / `correct.ts` / `no-action.ts` so “each verb owns a file.” Do not collapse them to one `POST .../discrepancies/:id` so “resolve is REST.”

4. **Booking-case and leftover Release-case confirm-cancellation share Zod and not a command.** Both parse leftover `granotLifecycleConfirmCancellationCommandSchema`. They **ask** leftover `confirmGranotBookingCancellation` vs leftover `confirmGranotCancellation`. Observe labels leftover `case_kind` `"booking"` vs `"release"`. Do not silently point both mounts at one leftover function so “one cancel owns every case.” Do not drop leftover `/release-cases/*` so “the processor no longer opens them.”

5. **Connect-lead does not observe, and the route test does not name it.** Leftover confirm / update / referral / cancel / discrepancy leftover `void observeGranotOwnerCommandResult`. Leftover `connectBookingToLead` does not. Leftover activate / requeue also do not (already-recommended `operations.ts` audits after commit). Wave A never enumerated leftover `connectBookingToLead.ts`. Do not silently add leftover observe so “every Owner write ticks the same counter” without a paired route test. Do not reopen Wave A in this pass.

6. **Activation has no route test.** Already-recommended `operations.test.ts` proves write-once / Admin refuse through the service. This desk’s leftover `POST .../activation` is **201** and skips leftover `Idempotency-Key`. Do not silently add leftover `Idempotency-Key` so “every Owner POST matches confirm.” Do not drop the path so “the route test wins.”

7. **Operator skill misses four live Owner paths plus booking-case cancel.** Leftover `.cursor/skills/hit-vantage-api/SKILL.md` lists health / cases / four Booking-case posts / Release trio / activation / requeue. It misses leftover `GET .../receipts/live`, leftover `GET .../receipts`, leftover `POST .../booking-cases/:id/confirm-cancellation`, and both connect-lead paths. Folder `v1.routes.test.ts` lists none of this desk. Do not drop those paths so “the skill list wins.” Do not treat the skill as this desk’s **interface**.

8. **`sendError` remaps every leftover registry 403 to `OWNER_REQUIRED`.** Unsigned leftover `GET .../cases` (a read-actor path Admin may use) still becomes leftover `OWNER_REQUIRED`. Owner-only leftover receipt search does the same, and knowledge already names that. Do not silently import leftover RingCentral `toHttpBody()` so “one refuse owns every router.” Do not silently invent leftover `READER_REQUIRED` so “unsigned cases look finished” without a paired test. Do not silently swallow a leftover Mongo throw into `{ ok: false }` so “the desk never 500s.”

9. **Lead miss is not case miss.** Leftover `GET .../leads/:lead_model/:lead_id/lifecycle` answers `{ ok: false, error: "Lead not found" }` and **skips** leftover `sendError` (no leftover `code`, no leftover `request_id`). Leftover missing case / creating-observation / candidates throw leftover `GRANOT_CASE_NOT_FOUND`. Knowledge already names both. Do not silently wrap the Lead miss in leftover `GranotLifecycleError` so “one 404 owns every card.”

10. **Exactly one `Idempotency-Key` walks `rawHeaders`.** Leftover `req.header("Idempotency-Key")` would collapse duplicates. Two headers are leftover `VALIDATION_FAILED`. Activate / requeue never read the header. Do not silently switch to leftover `req.header` so “Express already folded it.” Do not silently require the header on leftover activate so “every Owner POST is idempotent here.”

11. **This GET Job path is not the Job Number timeline desk.** Leftover `GET .../granot-lifecycle/jobs/:normalized_job_no` **asks** leftover `projectGranotJob`. Next leftover `GET /api/v1/admin/job-number-timeline` **asks** leftover `module.read`. Do not silently merge them so “one Job Number owns every story.” Do not move leftover `projectGranotJob` onto the next router so “knowledge listed both Jobs together.”

12. **Wave A projections rec still says the default queue merges Booking and Release.** Current leftover `projections.md` and leftover `includeReleaseCasesInList` say omitted kind is **booking-only**. This desk forwards leftover `kind` when present and does not default it. The route test locks leftover `state` / `sort` / `order` and a separate Release-discriminant forward. Do not silently default leftover `kind=booking` in the route so “the Wave A sentence becomes true,” and do not rewrite that Wave A file in this pass.

13. **Knowledge lists discrepancy mutations under “Protected read surface.”** They are Owner writes. Do not move leftover `POST .../discrepancies/:id/*` onto leftover `GET` so “the heading becomes true.” Do not edit that Service file in this rename.

14. **SSE errors after flush are not JSON.** Leftover gate failures use leftover `sendError`. Leftover `runLiveReceiptSse` throws after leftover `flushHeaders` write leftover `event: error`. Do not silently call leftover `sendError` after flush so “one refuse owns the stream.” Do not silently keep the socket open on leftover `req.close` without leftover `abort`.

15. **Leave sibling modules alone.** Already-recommended leftover `confirmBooking` / leftover `activateGranotLifecycle` / leftover `listGranotLifecycleCases` / leftover `runLiveReceiptSse` / leftover `requireRegistryOwnerActor` are already the right **depth**. This file orchestrates the HTTP **adapters**.

## Testing

The **interface** is the test surface: leftover `createOwnerGranotLifecycleDesk` (mounted on already-recommended `publicV1Desk` **after** the secret) and `watchLiveWebhookReceiptsOverHttp` / `searchHistoricalWebhookReceiptsOverHttp` / `showTheIntakeQueueOverHttp` / `askThisOwnerBookingCaseCommandOverHttp` / `connectThisOfficialBookingToALeadOverHttp` / `startTheWriteOnceClockOverHttp` / `putThisDeadLetterBackOnTheDueListOverHttp`.

Today `granot-lifecycle-admin.routes.test.ts` already names most Owner reads and Booking / Release / discrepancy / requeue / SSE / receipt-search beats through leftover injected deps. It misses leftover activation and leftover connect-lead. Folder `v1.routes.test.ts` never lists this desk. Already-recommended Wave A replica files prove leftover mint / replay / checksum through the service — not this desk.

Keep the inject-and-sign style. Add the missing operations (do not boot leftover Mongo claim, leftover confirm transaction, or leftover RingCentral in the route file):

**After the secret / who may speak**
- This desk is registered on `publicV1Desk` **after** `router.use("/api/v1", requireApiSecret)` and has **no** per-route leftover `requireApiSecret`.
- Cases / job / lead / health / discrepancy reads **ask** leftover `requireRegistryReadActor`. Signed Admin **200**. Sales / Employee leftover `FORBIDDEN` remapped to leftover `OWNER_REQUIRED`.
- Live SSE / historical receipts / creating-observation / candidates / connect-lead / Owner commands / activate / requeue **ask** leftover `requireRegistryOwnerActor`. Signed Admin leftover `OWNER_REQUIRED`. Extension Owner Bearer leftover `OWNER_REQUIRED` (not leftover Agent catalog).

**Watch / search / queue**
- Live SSE **asks** leftover Owner **before** leftover `flushHeaders`. Answer `text/event-stream`. Admin **403** and does **not** open the stream.
- Historical search **asks** leftover `searchReceipts`. Unmasked phone / email present. `booking_action` without leftover `route_event_class` implies `booking_status_changed`; leftover `lead_created` pairing is **400**.
- Case list forwards leftover defaults `state=open` / `sort=last_evidence_at` / `order=desc` and does **not** invent leftover `kind`.
- Creating-observation / candidates are Owner-only. Missing case is leftover `GRANOT_CASE_NOT_FOUND`.
- Lead miss is `{ ok: false, error: "Lead not found" }` with no leftover `code`.
- Job leftover `limit=201` is leftover `VALIDATION_FAILED`.

**Owner writes**
- Confirm **asks** leftover `confirmBooking` with leftover `Idempotency-Key` and answers **201**. Missing header **400**. Two leftover `Idempotency-Key` headers **400**. Admin **403**.
- Update / No Action **200**. Referral / booking-cancel **201** unless leftover `replayed` / leftover `already_satisfied`.
- Discrepancy trio **asks** leftover handler with route-owned leftover `discrepancy_id` and leftover `void observeGranotOwnerCommandResult`.
- Connect-lead GET/POST are Owner-only. POST **asks** leftover `connectBookingToLead` and does **not** leftover observe.
- Activate **asks** leftover `activateGranotLifecycle` without leftover `Idempotency-Key` and answers **201**.
- Requeue **asks** leftover `requeueDeadLetterReceipt` with leftover `String(req.params.id)`.
- Leftover `GranotLifecycleError` → leftover `toHttpBody()`. Leftover `DomainCommandIdempotencyConflictError` → **409**. Leftover `ZodError` → `400` `"Invalid request"` + leftover `GRANOT_VALIDATION_FAILED` (not leftover `"Invalid request payload"`).

**Not this file**
- Write-once clock / dead-letter eligibility stay on already-recommended [granot-lifecycle-operations.md](granot-lifecycle-operations.md).
- Queue / case / candidates / job / lead / health stay on already-recommended [granot-lifecycle-projections.md](granot-lifecycle-projections.md).
- Creating statement stays on already-recommended [granot-lifecycle-creating-observation.md](granot-lifecycle-creating-observation.md).
- Confirm / update / referral / Release / discrepancy mint stay on already-recommended Wave A command files.
- Connect eligibility / already-satisfied stay on leftover `connectBookingToLead.ts`.
- SSE poll / `intake_link` join stay on leftover `liveReceipts.ts` / leftover `liveReceiptStream.ts`.
- Capture / drain / processor stay on already-recommended [granot-lifecycle-capture.md](granot-lifecycle-capture.md) / [granot-lifecycle-drainer.md](granot-lifecycle-drainer.md) / [granot-lifecycle-processor.md](granot-lifecycle-processor.md).
- Job Number timeline stays on next leftover `job-number-timeline-admin.routes.ts`.
- HMAC / preview hatch stay on already-recommended [operations-registry-trusted-actor.md](operations-registry-trusted-actor.md).
- Unguarded login / Drive callback stay on already-recommended [routes-extension-auth.md](routes-extension-auth.md) / [routes-google-drive-oauth.md](routes-google-drive-oauth.md).

Do **not** add a test per helper (`whoTheSecretAlreadyAdmitted`, `readExactlyOneIdempotencyKey`, `openTheLiveReceiptEventStream`). Those names exist so the parent reads. If a helper test has to change when the helper is inlined, it was testing past the **interface**.

Do **not** export `sendError` so “the test can unit the refuse.”

## What I would not do

- A `GranotLifecycleAdminRoutesService` class with `create` / `update` / `delete` / `activate`.
- Thirty two-line functions that only wrap `res.json({ ok: true, data })`.
- Moving this into a CRUD folder (`create.ts` / `update.ts` / `delete.ts`) or splitting `activate.ts` / `requeue.ts` / `confirm.ts` “for cleanliness.”
- Breaking the after-secret **seam**: this desk stays after `/api/v1` secret; do not put Owner lifecycle writes in front of `x-api-secret`.
- Breaking the live-before-requeue **seam**: do not let leftover `:id` steal leftover `live`.
- Treating leftover `captureChannelOperationReceipt`, leftover `claimAndProcessOrPoll`, leftover `confirmBooking`, leftover `module.read`, leftover employee-booking recon, leftover Drive / extension desks, or leftover webhook / cron routers as this story.
- Inventing a capture, drain, or Job Number timeline **adapter** that has only one caller in this pass.
- Silently remounting leftover `requireApiSecret`, requiring leftover `Idempotency-Key` on activate, merging leftover `/jobs/:normalized_job_no` into leftover `/job-number-timeline`, wrapping Lead miss in leftover `GRANOT_CASE_NOT_FOUND`, or moving Zod onto a new barrel while recommending a rename.
- Reopening Wave A to enumerate leftover `connectBookingToLead.ts` in this pass.
- Jumping to `models/` / `validation/` / `config/domain/` / `middleware/` / `auth/` while this checklist has unchecked modules.
- Writing a whole-folder recommendation for `routes`.
