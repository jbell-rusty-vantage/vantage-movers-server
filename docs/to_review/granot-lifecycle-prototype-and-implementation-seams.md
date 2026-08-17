# Granot lifecycle prototype and implementation seams

Status: executable reasoning artifact, not a production implementation. The
prototype lives at `scripts/prototypes/granot-lead-lifecycle/` and uses no live
systems or persistence.

## What this slice answers

The first slice tests whether a single deep Module can take an external Granot
Observation or authoritative Vantage lifecycle command and explain:

1. which real domain identity it concerns;
2. whether a transition is legal;
3. which current-state facts change;
4. why they changed and through which Observation Channel;
5. which durable projection, booking intake, or discrepancy work follows.

The answer is provisionally yes. The prototype interface is:

```ts
advanceLeadLifecycle(
  current: LifecycleWorld,
  action: LifecycleAction,
  catalog: PrototypeCatalog,
): LifecycleResult
```

This is deliberately one small Interface with substantial behavior behind it:
normalization, Source Scope resolution, channel-aware matching, Granot Record
Links, supported-priority policy, Booking and Cancellation invariants,
provenance, desired-state idempotency, Sheet Sync intent, and Granot Booking
Discrepancies.

The prototype is not a proposal to replace all production services with one
large file. It is a way to find the correct external seam. A production Module
may compose internal normalization, identity, policy, and persistence helpers,
but routes, queue consumers, extension endpoints, and automation workers should
cross one coherent synchronization Interface rather than select those helpers
themselves.

## Canonical naming

| Name | Precise meaning | Do not substitute |
| --- | --- | --- |
| Granot Observation | A point-in-time statement from Granot | Event as if it were an authoritative Vantage transition |
| Granot Lead Snapshot | Lead/job columns carried by an Observation | Patch or delta |
| Granot Priority | Raw Granot workflow code | Lead status, Vantage priority |
| Observation Channel | Webhook, browser extension, or HTTP automation | Actor, source system, authority |
| Source Scope | Source Company + exact Source Granularity + Lead Channel resolved from a Granot label | Free-text `source` |
| Granot Record Link | Durable Granot Job Number to Vantage Lead/Booking association | A transient match result |
| Synchronization Decision | Explainable outcome such as applied, already current, pending, ambiguous, blocked, or invalid | Generic processing status |
| Granot Booking Intake Case | Granot credibly reports booked while official owner Booking details are still missing | Granot Booking Discrepancy, Booking Lead Reconciliation Case |
| Suggested Booking Lead | Highest-ranked eligible Lead shown inside booking intake and changeable by the owner | Matched/attached Lead |
| Confirm Granot Booking | Owner command supplying official booking details and selected Lead | Accept webhook, approve match |
| Booking Intake Notification | Optional dashboard/email delivery pointing to an intake case | The case or Booking |
| Granot Booking Discrepancy | Granot conflicts with an existing Vantage Booking or established link | Expected booking intake |
| Booking Lead Reconciliation Case | A Vantage Booking already exists and needs the correct Lead attached | Granot Booking Intake Case |
| Entity Change | Append-only evidence of a committed domain change and its provenance | `last_updated_by` only |

The three owner-work cases have non-overlapping starts: booking intake has no
official Booking yet; discrepancy has a conflicting Booking/link; Booking Lead
Reconciliation starts with a valid Booking whose Lead attachment needs work.

## State model

A Lead does not have one lifecycle status. Its state is derived from durable
facts and relationships:

| Fact | Form Lead | Call Lead |
| --- | --- | --- |
| Ingested | Form Lead exists after Form Lead Ingestion | Call Lead exists after RingCentral Call Qualification and ingestion |
| Duplicate | `duplicate=true` | `duplicate=true` |
| Quoted | `quoted=true` | Not a Call Lead field |
| Enriched | Granot-derived fields present | Job/contact/location/cubic fields present |
| Booked | `booked` references a complete Booking | same |
| Cancelled | `cancelled` references a Cancellation while `booked` remains | same |

This permits legal combinations that a single enum tends to erase:

- Booked and later enriched;
- Booked and Cancelled simultaneously;
- Call Lead enriched without a quoted flag;
- Granot considers the job booked while Vantage has only a Granot Booking
  Intake Case, not a Booking;
- an unsupported Granot Priority is observed without changing Lead state.

## Granot semantics represented in the prototype

The prototype represents the current known meanings without filling gaps by
guesswork:

| Granot column/value | Meaning represented | Authorized effect |
| --- | --- | --- |
| `source` / legacy `Source` | Raw Granot source label | Resolve exact Source Scope before matching |
| `job_no` | Granot job identity | Establish/refresh Granot Record Link; enrich Call Lead when absent |
| `ref_no` on form sources | Current executable provider/Tracking Reference contract | Exact Form Lead match before contact fallback |
| `phone_number`, `email` | Contact evidence | Fallback only inside Source Scope and Lead Channel |
| `priority=0` | Default/not quoted in current operational reading | Fill-only location/receiver; never downgrade quoted/cubic |
| `priority=1` | Quoted | Form Lead quoted/cubic; Call Lead enrichment; fill-only fields |
| `priority=5` | Quoted and Granot considers booked | Same enrichment plus Granot Booking Intake Case when no Booking |
| `priority=2,3,7,8,9` | Unknown | Explicit blocked decision, raw code retained |
| `est_cf` | Estimated cubic feet | Applied only for priorities 1/5 |
| `user` / `rep` | Receiver Agent username evidence | Fill receiver once when one active Agent matches |
| `event_type=Booked` | Unverified booking-status assertion; seen with Priority `0`, `1`, and `5` | Confirm existing Booking or open booking intake; do not read `Booked` + Priority `0` as unbooked |
| `event_type=Releas...` | Unverified release-like assertion; also seen with Priority `5` | Open Granot Cancellation Intake Case when an active Booking exists; never auto-cancel |

The prototype aliases the two observed casing variants (`source`/`Source`). A
production normalizer should use versioned schemas and issue codes rather than
accumulating unrestricted aliases.

## Executable scenarios

Run:

```powershell
pnpm prototype:granot-lifecycle -- --scenarios
```

| Scenario | Result being asserted |
| --- | --- |
| F-C | `lead_created` links the existing Form Lead; Priority 1 quotes/enriches and requests Sheet Sync |
| F-P | Extension application, same-receipt replay, and later webhook converge to one Entity Change |
| Ordering | A provider `occurred_at` older than the last applied Granot change yields `stale` |
| F-E | Priority 5 enriches and opens a Granot Booking Intake Case; no Booking is fabricated |
| B-I | Owner replaces the Suggested Booking Lead, incomplete official fields fail safely, then Confirm Granot Booking creates the Booking Chain |
| Booking → Cancellation | Complete owner Booking attaches to Lead; Cancellation retains `booked` and adds `cancelled` |
| C-C | Inbound Granot job before RingCentral ingestion stays pending; no Call Lead is created |
| C-E | Priority 1 enriches Call Lead job/cubic/location without inventing `quoted` |
| Unknown priority | Priority 8 is retained and blocked |
| Unknown source | `Paid Overflow` is blocked before any global contact search |
| Booked, no Booking | `booking_status_changed` / `Booked` opens booking intake |
| Booked, already booked | `already_current`; no new owner work |
| Booked after cancel | Granot Cancellation Discrepancy; Cancellation is retained |
| Releas, active Booking | Opens Granot Cancellation Intake Case and notifications |
| C-I | Owner confirms official Refund/Cancel Date; Granot payment stays context; replay is idempotent |
| Releas already cancelled | `already_current`; evidence refresh only |
| Releas, no Booking | Explicit discrepancy; no Cancellation |
| Releas, conflicting link | Explicit discrepancy; owner-resolvable |
| Priority 0 after Booking | Booked facts are not downgraded |
| Duplicate Releas | One open intake case and one notification per channel |

The fixtures use real operational names but fake identifiers and customer data:
`Top10 Forms`, `Top10 Inbounds`, `top10_leads`,
`top10_leads_form`, `top10_leads_call`, `Mike` / `MIKEM`, and `Cardpointe`.

## Proposed production Modules

### 1. Granot Observation Processing Module

Candidate Interface:

```ts
processGranotObservation(input: {
  receipt_id: ObjectId;
  observation_channel: ObservationChannel;
  initiator?: DurableActor;
}): Promise<GranotObservationProcessingResult>
```

The caller should not supply normalized payloads, match candidates, patches,
or queue jobs. Those are implementation knowledge. Given a receipt, this Module
should own:

- normalization and schema issues;
- Source Scope resolution from Operations Registry names;
- Granot Record Link lookup/establishment;
- Lead/Booking matching and Match Decision evidence;
- event-specific Synchronization Decision;
- canonical domain-command invocation;
- terminal/retryable processing outcome.

The Interface returns safe references, decision codes, and effects for routes,
workers, analytics, and dashboard views.

### 2. Lead Lifecycle Command Module

Production Booking and Cancellation logic already exists. Deepen the existing
`domainCommands` seam rather than reimplementing those rules in the Granot
processor:

```ts
applyGranotLeadSnapshot(...)
recordBooking(...)
recordCancellation(...)
```

The Granot processor may request `applyGranotLeadSnapshot`; it must not request
`recordBooking` or `recordCancellation` until a complete command with all
required facts exists. Domain commands own transactional domain mutation,
Entity Change evidence, and Sheet Sync outbox intent.

### 3. Operations Identity Module

`operations-name-link-inventory.md` proves that names currently span Source
Company, Source Granularity, Granot CRM Source, automation source catalog,
RingCentral route assignments, Agent identities, and Merchants.

Candidate Interface:

```ts
resolveOperationalIdentity(input:
  | { kind: "granot_source"; label: string }
  | { kind: "granot_agent"; username: string }
  | { kind: "merchant"; name: string }
  | { kind: "ringcentral_target"; phone_number: string }
): Promise<ResolvedOperationalIdentity>
```

This Module should hide collection/static-map precedence and return canonical
IDs, snapshots, status, and ambiguity. It should have a Mongo adapter and an
in-memory adapter for tests; this is a real seam because two adapters exist.

## Proposed persistence models

Do not add all fields directly to `FormLead` and `CallLead`. Preserve current
state on those models and use separate evidence models.

### `GranotObservation`

- unique `receipt_id`;
- discriminated `kind`;
- normalized identity and snapshot;
- raw Granot Priority / booking status;
- schema version and structured normalization issues;
- `observed_at`, optional provider `occurred_at` and revision.

### `GranotRecordLink`

- unique active `(provider, normalized_job_no)`;
- Lead reference and optional Booking reference;
- state `active|disputed|superseded`;
- establishment Match Decision and observation references.

### `GranotMatchDecision`

- observation reference;
- Source Scope snapshot;
- outcome, method, safe candidate IDs/reasons, policy version;
- no duplicated raw customer values.

### `EntityChange`

- entity reference, command reference, changed field names;
- revision before/after;
- source system, Observation Channel, actor, receipt/observation/run/request;
- selectively redacted values only where analytics truly needs them.

### `GranotBookingIntakeCase`

- unique open normalized Granot Job Number;
- opening/latest observation and synchronization decision;
- Source Scope and compact observed booking context;
- Suggested Booking Lead with confidence/method, plus owner-selected Lead;
- optional suggested Agent evidence; Granot estimate stays display-only;
- state `open|completed|dismissed`, optimistic revision, completed Booking;
- only Confirm Granot Booking may complete it with official Book Date, Agent
  Allocations, Binder, Deposit, and Merchant.

### `BookingIntakeNotification`

- intake case, `dashboard|email` channel, delivery state, unique dedupe key;
- email failure never blocks the durable dashboard case or Booking confirmation.

### `GranotBookingDiscrepancy`

- Granot job identity and observed booking assertion;
- matched Lead and required conflicting existing Booking/link evidence;
- state `open|resolved|dismissed`;
- opening/resolution observations and owner resolution evidence;
- unique open discrepancy per Granot job + Lead.

### `GranotCancellationIntakeCase`

- unique open normalized Granot Job Number / Booking reference;
- opening/latest observation and synchronization decision;
- Linked Cancellation Booking snapshot; not owner-repointable;
- compact Granot release context, including raw `Releas`, Priority, payment,
  balance, and estimate as display-only values;
- state `open|completed|dismissed`, optimistic revision, completed Cancellation;
- only Confirm Granot Cancellation may complete it with official Refund and
  Cancel Date.

### `CancellationIntakeNotification`

- intake case, `dashboard|email` channel, delivery state, unique dedupe key;
- email failure never blocks the durable dashboard case or Cancellation
  confirmation.

### `GranotCancellationDiscrepancy`

- Granot job identity and observed release/booked assertion;
- reasons: `Releas` with no Booking, mismatched Record Link, or `Booked` after
  official Cancellation;
- state `open|resolved|dismissed`;
- never un-cancels or fabricates a Cancellation.

The existing `BookingLeadReconciliationCase` remains unchanged and may become
a downstream resolution tool only after a Vantage Booking exists.

## Routes, queue, and idempotency

### Routes

Existing webhook routes remain capture-only and fast:

```text
authenticate → capture immutable receipt → publish wake-up → 202
```

Do not expose the processing policy in three webhook route handlers. They all
call the same capture Interface with a route-derived event class.

Future read routes should expose decisions rather than raw storage internals:

- `GET /api/v1/admin/granot/observations`
- `GET /api/v1/admin/granot/observations/:id`
- `GET /api/v1/admin/granot/booking-discrepancies`
- `GET /api/v1/admin/granot-booking-intakes`
- `GET /api/v1/admin/granot-booking-intakes/:id`
- `POST /api/v1/admin/granot-booking-intakes/:id/confirm`
- `GET /api/v1/admin/leads/:model/:id/lifecycle`

Mutation routes for discrepancy resolution should use owner actor context and a
specific resolution command; do not offer generic model PATCH.

### Queue

Add one wake-up topic/consumer for Granot receipt processing. The queue message
should carry only `receipt_id` and a wake-up reason. Mongo remains the durable
work source; the queue is not the event store.

Processing needs a lease/fence or an atomic claim. Attempts should classify:

- retryable dependency failure;
- terminal invalid/unsupported schema;
- pending match with `next_attempt_at` during the ingestion race window;
- terminal ambiguous/conflict requiring owner attention;
- applied/already-current completion.

### Idempotency

Use three scopes:

1. one normalized Observation per receipt;
2. one processing claim/terminal result per receipt attempt state;
3. canonical domain-command idempotency for the domain effect.

Two different receipts with the same current snapshot are both valid evidence;
the second should usually resolve to `already_current`, not disappear through a
payload-hash dedupe.

## Analytics and dashboard projection

Functionality and evidence come first. Dashboard views should project these
facts rather than become another workflow owner.

Useful first projections:

| View | Measures / facts |
| --- | --- |
| Lead lifecycle timeline | ingestion, each Granot Observation, Entity Changes, Booking, Cancellation, channels and actors |
| Granot synchronization health | captured, normalized, pending, matched, ambiguous, blocked, applied, already current |
| Booking intake | Open cases needing official details, Suggested Booking Lead quality, age, notification state |
| Booking discrepancies | Actual Granot/Vantage Booking or Record Link conflicts |
| Source identity gaps | unresolved Granot labels such as `Paid Overflow` and `Referral` |
| Agent identity gaps | unmapped usernames such as `GEVANS` |
| Channel convergence | webhook after extension/automation resulting in already-current versus conflicting state |

The Lead lifecycle route should return a read model assembled from domain
records and evidence records. Do not embed an ever-growing lifecycle array on
Lead documents.

## What this prototype intentionally does not settle

- exact meanings of Granot priorities `2`, `3`, `7`, `8`, and `9`;
- complete booking status vocabulary behind `Booked` and truncated `Releas`;
- whether Priority 0 may ever downgrade a previously quoted Lead;
- provider ordering without event ID, occurred-at, and revision;
- final owner policy for `Paid Overflow`, `Referral`, and non-qualified Granot
  inbound jobs;
- whether bad Form Leads may still receive webhook enrichment;
- exact pending-match retry duration.

These are business decisions. The Module must make each unresolved case an
explainable blocked or pending decision rather than hide it behind a default.

Historical identity note: an earlier revision listed the `leadno` / `ref_no`
contract as unsettled. The final Granot Lead Lifecycle specification supersedes
that note: CRM Posting sends persisted `FormLead.ref_no` as `leadno`, Granot
exposes it as `ref_no`, exact `FormLead.ref_no` is primary identity, and a valid
Mongo `_id` is compatibility fallback only after exact lookup misses.

## Recommended next implementation slice

Build production normalization and shadow decisions without domain writes:

1. `GranotObservation` schema and versioned normalizer using captured fixtures;
2. Operations Identity Module with Mongo and in-memory adapters;
3. Granot Record Link + Match Decision persistence for exact matches only;
4. queue consumer with receipt claim/retry states;
5. admin read endpoint for observation/decision inspection;
6. scenario tests at the Granot Observation Processing Module Interface.

Only after shadow results are reviewed should Priority 1/5 domain commands be
enabled.
