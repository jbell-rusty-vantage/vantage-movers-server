# Granot lead lifecycle — production spec handoff

Status: settled design for a later implementation plan. This is not the
implementation plan itself. Another agent should turn this into exact
specifications, file lists, tests, and a slice order without reopening the
decisions below.

Created 2026-08-13 after the executable prototype, the naming discussion, and a
read of the live webhook / queue / cron seams. No live systems are invoked by
this document.

## How to use this document

Write an exact implementation plan that:

1. Adds production modules under the names in [Settled module names](#settled-module-names).
2. Leaves existing webhook route paths unchanged.
3. Adds new admin routes; does not rename old ones.
4. Processes Granot receipts with the [Recommended processing shape](#recommended-processing-shape).
5. Tests at each module's public interface, not past it.
6. Follows the rollout in
   [`SUGGESTED-DOMAIN-MODELS-AND-PROVENANCE.md`](./SUGGESTED-DOMAIN-MODELS-AND-PROVENANCE.md)
   (shadow evidence before domain writes; intake dashboard before Confirm).

Do not treat `advanceLeadLifecycle` as a production runtime module. Do not
process Granot webhooks inside the HTTP handler before `202`. Do not create a
Booking or Cancellation from a Granot observation.

## Read first

Canonical language:

- [`../../../../CONTEXT.md`](../../../../CONTEXT.md)
- [`../../../.cursor/rules/project-organization.mdc`](../../../.cursor/rules/project-organization.mdc)
- [`.agents/skills/codebase-design/SKILL.md`](../../../../.agents/skills/codebase-design/SKILL.md)
- [`.agents/skills/codebase-design/DEEPENING.md`](../../../../.agents/skills/codebase-design/DEEPENING.md)

Prototype and domain:

- [`README.md`](./README.md)
- [`domain.ts`](./domain.ts) — prototype wrapper `advanceLeadLifecycle`
- [`scenarios.ts`](./scenarios.ts) — executable invariants
- [`GRANOT-BOOKING-INTAKE-PROTOTYPE.md`](./GRANOT-BOOKING-INTAKE-PROTOTYPE.md)
- [`GRANOT-CANCELLATION-INTAKE-PROTOTYPE.md`](./GRANOT-CANCELLATION-INTAKE-PROTOTYPE.md)
- [`SUGGESTED-DOMAIN-MODELS-AND-PROVENANCE.md`](./SUGGESTED-DOMAIN-MODELS-AND-PROVENANCE.md)
- [`LEAD-ENRICHMENT-STATES-AND-FIELDS.md`](./LEAD-ENRICHMENT-STATES-AND-FIELDS.md)
- [`payload_shapes.md`](./payload_shapes.md)

Server docs:

- [`../../../docs/granot-webhooks.md`](../../../docs/granot-webhooks.md)
- [`../../../docs/granot-webhook-domain-service-model.md`](../../../docs/granot-webhook-domain-service-model.md)
- [`../../../docs/granot-lifecycle-prototype-and-implementation-seams.md`](../../../docs/granot-lifecycle-prototype-and-implementation-seams.md)
- [`../../../docs/lead-lifecycle-paths-and-projected-granot-webhooks.md`](../../../docs/lead-lifecycle-paths-and-projected-granot-webhooks.md)

Live code to copy, not reinvent:

- Capture: `src/routes/granot-webhook.routes.ts`,
  `src/services/granotWebhooks/granotWebhookCapture.service.ts`
- Receipt model: `src/models/GranotWebhookReceipt.ts`
- Canonical commands: `src/services/domainCommands/`
- Owner-case parallel: `src/services/employeeBookings/` +
  `src/models/BookingLeadReconciliationCase.ts`
- Queue + cron house pattern: `src/services/sheetSync/sheetSyncCoordinator.ts`,
  `src/services/sheetSync/sheetSyncQueue.service.ts`,
  `api/queues/sheet-sync-consumer.ts`,
  `src/routes/sheet-sync-cron.routes.ts`,
  `vercel.json`
- Same pattern also exists for lead-messaging, Best Relocation ingestion,
  reporting, and Granot HTTP automation.

---

## Settled decisions (do not reopen)

### Domain

- Lead Lifecycle is compositional facts, not one status enum.
- `lead_created` links; it does not mint a Form Lead or Call Lead.
- Priority `1`/`5` may enrich through existing rules. Unknown priorities are
  `blocked`. Priority is never Booked or Cancelled.
- Granot `Booked` and `Release` (`Releas` alias) are CRM button actions, not
  Vantage records. A job can have many of each. Stay idempotent on normalized
  Job Number: one Vantage Booking, never a second.
- Missing official Binder/Deposit/Refund is expected intake work, not a
  discrepancy.
- A discrepancy is two durable truths in conflict, or Release with no Booking,
  or `Booked` after an official Cancellation.
- Granot estimate/payment/balance never become Binder, Deposit, or Refund.
- Only Confirm Granot Booking creates a Booking. Only Confirm Granot
  Cancellation creates a Cancellation. Only Update Granot Booking mutates the
  existing Job Number Booking. The owner may dismiss or leave a Release intake
  open.
- Never un-cancel.
- Source system, Observation Channel, and actor are separate provenance axes.
- Different receipts of already-current state are evidence →
  `already_current`, not payload-hash-deduped away.

### Architecture

- Production has **no** `advanceLeadLifecycle`. That function stays the
  prototype/test wrapper in `domain.ts`.
- Production callers hit three named modules (below). Those modules call
  existing canonical commands. They do not call `createBookedLead` /
  `createCancelledLead` / `updateBookedLead` directly.
- Webhook routes stay capture-only and fast. Processing is a different seam.
- `granotWebhooks/` remains capture. Do not grow policy into that folder.
- One new cluster: `src/services/granotLifecycle/`.
- Factories, not service classes. Match
  `createIdempotentCanonicalCommandExecutor(deps)`.
- Classes that belong: Mongoose models and `*Error` types only.

### Name-change blast radius

Existing HTTP paths stay. Work is additive: new modules, new models, new admin
routes, one new canonical command, one new queue topic, one new cron.

Safe to rename later, not on the critical path:

- Prototype internals (`observeGranot` → `processGranotObservation`).
- Docs that still say `GranotBookingIntakeModule` (use `GranotBookingIntake`).
- Older handoff language about an “Operations Identity Module” (fold source
  scope + username resolution into the processor and record-link cluster).

Do not rename:

- `POST /api/webhooks/granot/{lead-created,priority-updated,booking-status-changed}`
- `captureGranotWebhookReceipt`
- `canonicalDomainCommands` names already in use
- `BookedLead` / `CancelledLead` / `BookingLeadReconciliationCase`
- Sheet Sync, Booking Chain, Cancellation Chain

---

## Settled module names

Folder: `src/services/granotLifecycle/`.

A service folder is the class in this codebase. Each factory returns a plain
object that satisfies the interface. Ports (Mongo, catalog, command executor)
are injected. Internals are named functions in the same folder, not `private`
methods.

### 1. `GranotObservationProcessor`

Factory: `createGranotObservationProcessor(deps)`

Callers: webhook consumer, later extension and HTTP automation. Never owner
routes.

```ts
processGranotObservation(input: {
  receipt_id: string;
  observation_channel:
    | "granot_webhook"
    | "browser_extension"
    | "granot_http_automation";
  initiator?: DurableActor;
}): Promise<{
  observation_id: string;
  decision_id: string;
  outcome:
    | "applied"
    | "linked"
    | "already_current"
    | "stale"
    | "pending_match"
    | "ambiguous"
    | "conflict"
    | "blocked"
    | "invalid";
  target?: { model: "FormLead" | "CallLead" | "BookedLead"; id: string };
}>
```

Routes and queue consumers pass a receipt ID. They do not pass snapshots,
candidate lists, or patches.

Owns: normalize receipt → `GranotObservation`, `parseGranotBookingAction`
(`Releas`/`Release` → `release`; unknown is not Release), source scope,
`resolveObservationTarget` (active Record Link first, else source-scoped
match), staleness, authorized enrichment via `updateSourceOwnedLead`,
`SynchronizationDecision`, promote to intake or discrepancy.

Does not own: Booking/Cancellation writes, owner confirm, Sheet Sync, receipt
capture.

Internal names to keep:

- `normalizeGranotObservation`
- `parseGranotBookingAction`
- `resolveSourceScopeFromGranotLabel`
- `resolveObservationTarget`
- `isStaleGranotObservation`
- `applyAuthorizedLeadEnrichment`
- `recordSynchronizationDecision`
- `promoteObservationToOwnerWork`

### 2. `GranotBookingIntake`

Factory: `createGranotBookingIntake(deps)`

Callers: processor (`openOrRefresh…`) and owner confirm/dismiss/list/get
routes.

Public:

- `openOrRefreshGranotBookingIntake`
- `confirmGranotBooking` → canonical `createBookingFromLead`
- `dismissGranotBookingIntake`
- `getGranotBookingIntake`
- `listOpenGranotBookingIntakes`

Internal:

- `rankSuggestedBookingLead`
- `revalidateSelectedBookingLead`
- `suggestAgentFromGranotUsername` (suggest only; never allocate)
- `queueBookingIntakeNotifications`
- `completeGranotBookingIntake`

Does not reimplement Booking creation, Agent allocation, customer upsert,
Entity Change, or Booking Chain.

### 3. `GranotCancellationIntake`

Factory: `createGranotCancellationIntake(deps)`

Public:

- `openOrRefreshGranotCancellationIntake` (may reopen a dismissed case)
- `confirmGranotCancellation` → canonical `createCancellation`
- `updateGranotBooking` → new canonical `updateBooking` (see below)
- `dismissGranotCancellationIntake`
- `getGranotCancellationIntake`
- `listOpenGranotCancellationIntakes`

Internal:

- `resolveLinkedCancellationBooking` (deterministic; wrong identity is a
  discrepancy, not a dropdown)
- `refreshOpenCancellationIntake`
- `queueCancellationIntakeNotifications` (own model and dedupe key)
- `completeGranotCancellationIntake`

Leaving the case open is a valid owner outcome.

### 4. Internal seams with two callers

These are real seams because two modules use them. They are not caller-facing
from routes.

`GranotRecordLinks` — `createGranotRecordLinks(deps)`

- `findActiveGranotRecordLink`
- `establishOrRefreshGranotRecordLink`
- `correctGranotRecordLink` (only from successful Confirm Granot Booking when
  the owner changed the Lead)
- `disputeGranotRecordLink` (never silently repoint)

Source-scoped matcher — plain functions, in-process, no port:

- `matchLeadWithinSourceScope`
- `rankSuggestedBookingLead`
- `leadBelongsToSource`

Never global phone search.

### 5. Canonical commands (existing seam)

Keep `src/services/domainCommands/`. Intakes and the processor invoke this
registry; they do not wrap it again.

| Intent | Command | Status |
| --- | --- | --- |
| Enrich a source-owned Lead | `updateSourceOwnedLead` | exists |
| Create first Booking from a Lead | `createBookingFromLead` | exists |
| Create a Cancellation | `createCancellation` | exists |
| Mutate the existing Job Number Booking | `updateBooking` | **missing — add** |

`updateBookedLead` is CRUD. Update Granot Booking must not call it directly, or
Entity Change and the Booking Chain become optional. The new command is the
one real rename-adjacent gap in the current command surface.

Extend `DomainCommandExecution.origin` before Granot may appear there. Today
the enum is `external_sheet_ingestion` | `vantage_admin`.

### Names to refuse

| Tempting | Use instead |
| --- | --- |
| `GranotSyncService` | `GranotObservationProcessor` |
| `LifecycleEngine` / production `advanceLeadLifecycle` | the three modules |
| `handleWebhook` as domain entry | `processGranotObservation` |
| `GranotBookingIntakeModule` | `GranotBookingIntake` (Case stays `GranotBookingIntakeCase`) |
| Generic `IntakeCase` | keep booking and cancellation cases separate |
| `createBookedLead` from intake | `createBookingFromLead` |

The `Module` suffix was used in earlier prototype docs. Drop it in code. The
server already pairs `BookingLeadReconciliationCase` with
`resolveBookingLeadReconciliation`. Same here: Case is the document; the
interface is the operation cluster.

---

## Routes

### Keep (capture only)

```text
POST /api/webhooks/granot/lead-created
POST /api/webhooks/granot/priority-updated
POST /api/webhooks/granot/booking-status-changed
```

Current behavior in `src/routes/granot-webhook.routes.ts`: authenticate →
`captureGranotWebhookReceipt` → `202` with `receipt_id`, or `503` if capture
fails so Granot can retry. `processing_status` stays `received`. That HTTP
contract stays.

The only allowed change to these handlers: after a successful capture, schedule
a **best-effort wake-up** (see processing). Do not await full processing. Do
not mutate leads here.

### Add (owner / admin)

From the intake prototypes:

```text
GET  /api/v1/admin/granot-booking-intakes?state=open
GET  /api/v1/admin/granot-booking-intakes/:case_id
POST /api/v1/admin/granot-booking-intakes/:case_id/confirm
POST /api/v1/admin/granot-booking-intakes/:case_id/dismiss

GET  /api/v1/admin/granot-cancellation-intakes?state=open
GET  /api/v1/admin/granot-cancellation-intakes/:case_id
POST /api/v1/admin/granot-cancellation-intakes/:case_id/confirm
POST /api/v1/admin/granot-cancellation-intakes/:case_id/update-booking
POST /api/v1/admin/granot-cancellation-intakes/:case_id/dismiss

GET  /api/v1/admin/leads/:lead_model/:lead_id/lifecycle
```

Confirm/update routes accept only official Vantage fields and the selected
Lead (booking intake). They do not accept Granot estimate, payment, source
scope, or a replacement Booking.

Also needed for shadow review, not owner workflow:

```text
GET /api/v1/admin/granot/observations
GET /api/v1/admin/granot/observations/:id
```

plus decision / discrepancy list-detail as specified in
[`../../../docs/granot-lifecycle-prototype-and-implementation-seams.md`](../../../docs/granot-lifecycle-prototype-and-implementation-seams.md).

Mount under existing `/api/v1/admin` + `requireApiSecret` / owner-actor gates.
Do not bypass the v1 auth guard.

---

## Webhook speed vs processing

Two different clocks:

1. **Granot HTTP.** Must stay fast. Capture is already the durable ack.
   Granot retries on `503`, not on `202`. After `202`, Vantage owns the work.
2. **Vantage processing.** Normalize, match, decide, later mutate, later open
   owner intake. This can retry. It must not sit in the webhook handler.

### Options considered

| Option | What it is | Verdict |
| --- | --- | --- |
| A. Collection + cron only | Cron drains `processing_status: received` | Acceptable for **shadow-only**. Too slow once owner intake/email is live. Typical crons here are `*/5`. |
| B. Vercel Queue wake-up + Mongo claim + cron safety net | House pattern (sheet-sync, lead-messaging, Granot automation) | **Recommended production shape.** |
| C. `waitUntil(processGranotObservation)` as the processor | Same serverless invocation stays open after `202` | **Reject as the processor.** Same trap Sheet Sync already left (`legacy` → `queued`). |

### Why not `waitUntil` as the processor

This server already uses `waitUntil` from `@vercel/functions` in
`src/services/sheetSync/sheetSyncCoordinator.ts`. In `legacy` mode it runs the
full Sheet Sync after the response. That path has no outbox, no lease, no
classified retry. Queued mode replaced it: Mongo holds the work, `waitUntil`
only enqueues/publishes, a dedicated `api/queues/*-consumer.ts` drains, cron
recovers missed wake-ups.

Granot processing has the same durability needs, plus matching, pending-match
windows, and later domain commands. After `202`, Granot will not retry. If
`waitUntil` dies, only Mongo still knows the receipt exists. Therefore Mongo
must be the work source and something other than the webhook invocation must
be able to claim it.

`waitUntil` is also bounded by the webhook function's remaining `maxDuration`.
Matching + policy + (later) a command transaction is the wrong workload to
keep on that invocation.

### Recommended processing shape

Copy sheet-sync queued mode, with Granot names:

```text
Granot POST
  → authenticate
  → captureGranotWebhookReceipt   # must finish before 202
  → waitUntil(publish wake-up)    # best-effort; must not fail the 202
  → 202 { receipt_id }

Queue consumer (dedicated function, not on Express)
  → claim due receipts
  → processGranotObservation({ receipt_id, observation_channel: "granot_webhook" })

Cron heartbeat
  → same drain/claim as the consumer
  → recovers failed publish, local/dev, and pending_match next_attempt_at
```

Invariants:

- Mongo receipt is the durable work item. The queue message carries
  `receipt_id` and a wake-up reason only. The queue is not the event store.
  Same comment already exists on `api/queues/sheet-sync-consumer.ts`.
- Publish is best-effort and must not throw into the webhook response. Same
  as `publishSheetSyncWakeup`.
- Processing needs an atomic claim/lease. Attempts classify: retryable
  dependency failure; terminal invalid/unsupported; `pending_match` with
  `next_attempt_at`; terminal ambiguous/conflict; applied / already_current.
- Do not overload `GranotWebhookReceipt.processing_status` with every stage.
  Observation, decision, application, and projection are separate. See
  [`../../../docs/granot-webhook-domain-service-model.md`](../../../docs/granot-webhook-domain-service-model.md)
  § Processing state model.
- The consumer is a **dedicated** Vercel function under `api/queues/`. Do not
  mount a `queue/v2beta` trigger on the Express app (`"/(.*)" → "/api"` would
  shadow it). Follow `vercel.json` `functions["api/queues/…"].experimentalTriggers`.
- Outside production Vercel, skip queue publish; drain via cron or a direct
  call. Follow `shouldPublishSheetSyncQueue()` guards (`VERCEL=1`,
  `VERCEL_REGION`, `VERCEL_ENV=production`, test-runner off).

Suggested names for the new plumbing (planner may adjust env keys, not the
module names above):

- Topic: `granot-observation-events` / `granot-observation-events-dev`
- Consumer: `api/queues/granot-observation-consumer.ts`
- Publish: `publishGranotObservationWakeup({ receipt_id, reason })`
- Drain: `runGranotObservationDrain("queue" | "cron")`
- Cron: `GET|POST /api/cron/granot-observation-drain` on `*/5 * * * *` or
  tighter once intake is live
- `waitUntil` use: **publish only**, after capture, never the processor body

### Staging the transport

1. **Shadow slice:** cron-only drain is enough. No owner is waiting. Prove
   normalize + match + decision against live `received` receipts without a new
   queue topic.
2. **Before dashboard intake / email:** add the queue topic and
   `waitUntil(publish)` so Priority 5 / Release become owner-visible in
   seconds, not on the next cron.
3. **Never skip the cron** once a queue exists. Publish is best-effort.

Option A is therefore a legal first slice. Option B is the shape that must
exist before owner-facing intake. Option C is not a slice.

### Channel convergence

Webhook is the first Observation Channel on this processor. Extension and HTTP
automation must later call `processGranotObservation` (or an equivalent that
still creates a receipt/observation) so provenance converges. Do not give those
channels a second policy path. Preview endpoints may remain; the server makes
the final match and policy decision
([`../../../docs/granot-webhook-domain-service-model.md`](../../../docs/granot-webhook-domain-service-model.md)
§ Service boundaries).

---

## Prototype wrapper mapping

Keep `advanceLeadLifecycle` in the prototype. When production modules exist,
scenario tests should move onto those interfaces and the prototype can be
deleted.

| Prototype today | Production |
| --- | --- |
| `advanceLeadLifecycle` | prototype-only |
| `observeGranot` | `processGranotObservation` |
| `normalizeGranotReceipt` | `normalizeGranotObservation` |
| `matchLead` | `resolveObservationTarget` |
| `handlePriorityObservation` / `handleBookingStatusObservation` | hidden inside the processor |
| `confirmGranotBooking` | same name on `GranotBookingIntake` |
| `confirmGranotCancellation` / `updateGranotBooking` / `dismissGranotCancellationIntake` | same names on `GranotCancellationIntake` |
| `recordBooking` | `createBookingFromLead` |
| `recordCancellation` | `createCancellation` |

---

## Models

Authoritative sketches:
[`SUGGESTED-DOMAIN-MODELS-AND-PROVENANCE.md`](./SUGGESTED-DOMAIN-MODELS-AND-PROVENANCE.md).

Add in `src/models/`, not in the admin app:

- `GranotObservation`
- `GranotRecordLink`
- `SynchronizationDecision`
- `EntityChange`
- `GranotBookingIntakeCase` / `BookingIntakeNotification` / `GranotBookingDiscrepancy`
- `GranotCancellationIntakeCase` / `CancellationIntakeNotification` / `GranotCancellationDiscrepancy`

Minimal edits to existing aggregates: `domain_revision`, `last_change_id`,
`last_changed_at` on Form/Call/Booked/Cancelled leads. No lifecycle `status`
enum. No `history[]` on the Lead.

`GranotWebhookReceipt` stays the immutable envelope. Separate processing claim
fields from evidence if practical. Header capture should move from denylist to
allowlist before admin surfaces expand
([`../../../docs/granot-webhooks.md`](../../../docs/granot-webhooks.md)).

---

## What the next plan must specify

These are planner deliverables, not open product questions:

- Exact files under `src/services/granotLifecycle/`, `src/models/`,
  `src/routes/`, `api/queues/`, `vercel.json`, and `src/config/domain/`.
- Feature flags: shadow processing vs enrichment writes vs intake open vs
  Confirm vs email.
- Claim/lease algorithm and `next_attempt_at` for `pending_match`.
- `updateBooking` command payload, idempotency key, and origin enum extension.
- In-memory adapters for processor tests; Mongo/PGLite only if a local
  stand-in already exists for that dependency.
- How captured production receipts are replayed in shadow without customer
  identifiers in logs or fixtures (`payload_shapes.md` is the redacted shape).
- Cron schedule and queue topic env flags, copied from sheet-sync/lead-messaging
  config style.
- Test list mapped to `scenarios.ts` names, asserted through production
  interfaces.

## Business questions still open

Keep these as `blocked` / `pending_match` / `ambiguous` / `conflict`. Do not
invent defaults that mutate.

- Meanings of Granot priorities `2`, `3`, `7`, `8`, `9`.
- Whether Priority `0` may downgrade quoted.
- Provider event ID / `occurred_at` / revision.
- `Paid Overflow`, `Referral`, non-qualified inbound ownership.
- `leadno` / `ref_no` identity contract.
- Bad Form Leads as enrichment targets.
- Pending-match retry window.
- Email immediate vs digest vs off.
- Medium-confidence Suggested Booking Lead preselected or not.
- Book Date blank vs today vs Granot move date as display-only default.
- Whether a later `Booked` after Release auto-completes the intake (prototype
  default: keep the offer open).

## Skills for the implementing agent

- `codebase-design` — deep modules, interface as test surface, two adapters
  before a port.
- `tdd` — tests at `processGranotObservation`, `confirmGranotBooking`,
  `confirmGranotCancellation`, `updateGranotBooking`.
- `domain-modeling` — keep CONTEXT.md nouns.

The prototype folder is disposable after production interfaces absorb the
scenario assertions. Do not copy `LifecycleWorld` into `src/`.
