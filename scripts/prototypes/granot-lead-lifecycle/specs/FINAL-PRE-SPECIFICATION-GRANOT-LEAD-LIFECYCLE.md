# Final pre-specification: Granot Lead Lifecycle

Date: 2026-08-14  
Status: interview complete; ready for conversion into the official specification  
Workspace: `C:/Users/Pinda/Proyectos/vantage`  
Primary implementation repository: `vantage-main-server`

## Purpose

This document is the final decision handoff for the official Granot Lead
Lifecycle specification. It consolidates the prior prototypes, architecture
notes, live code inspection, and the final one-question-at-a-time owner
interview. A fresh agent should use this document to write the official
implementation specification and should not restart the product interview.

The official specification must be issue-ready: exact schemas, migrations,
Module interfaces, files, feature flags, prerequisites, acceptance tests,
rollout checks, and rollback behavior. After approval, use that specification
to create sequential tracer-bullet issues.

No production implementation is part of this document.

## Authority and supersession

This document supersedes contrary assumptions in older prototype documents.
In particular:

- `lead_created` is a source-policy-controlled ingestion pathway, not always
  link-only.
- A matched-existing `lead_created` event performs identity linking plus the
  shared Priority and temporal synchronization policy.
- Every valid Granot Priority is stored; only `1` and `5` authorize broad Lead
  enrichment.
- Granot Booked and Release are repeatable CRM actions, not Vantage state
  transitions.
- Booking Intake is replaced by Booking Reconciliation.
- Cancellation Intake is replaced by Release Reconciliation.
- An actual Booked action against an existing Booking creates review work; it
  is not automatically hidden as already current.
- Release may mean cancellation, a Booking edit cycle, or no Vantage change.
- `FormLead.ref_no`, not Mongo `_id`, is the value currently posted to Granot
  as `leadno`; Mongo `_id` is compatibility identity only.
- RingCentral Call Log synchronization moves from every two hours to every
  thirty minutes with a lease.

If this document and disposable prototype code disagree, this document wins.
If this document and current production behavior disagree, the official spec
must call out the migration explicitly rather than silently assuming the new
behavior already exists.

## Outcome in one sentence

All Granot webhook, browser-extension, and HTTP-automation observations pass
through one durable, channel-neutral processor that preserves evidence,
resolves identity and source policy, applies only authorized Lead changes via
canonical commands, and promotes Booked/Release evidence into explicit,
idempotent owner reconciliation without fabricating Booking or Cancellation
facts.

## Non-negotiable domain invariants

1. MongoDB remains the System of Record.
2. A Granot Observation is evidence, not authority to create official Booking
   or Cancellation facts.
3. Lead Lifecycle is a composition of facts, not a mutable lifecycle status
   enum.
4. There is at most one Vantage Booking per normalized Job Number.
5. Granot never automatically books, updates a Booking, cancels, or un-cancels.
6. Only canonical domain commands mutate Leads, Bookings, or Cancellations.
7. Every committed domain change has causal provenance:

   ```text
   GranotObservationReceipt
     -> GranotObservation
     -> SynchronizationDecision
     -> DomainCommandExecution
     -> EntityChange/current aggregate/Sheet Sync
   ```

8. Current aggregates plus compact append-only evidence are required. Do not
   implement full event sourcing, full Lead snapshots per change, or unbounded
   history arrays on Leads.
9. Source System, Observation Channel, Ingestion Origin, actor, and command
   initiator are separate provenance axes.
10. A later external statement never erases immutable creation/submission
    evidence.

## Canonical terminology

- **Granot Observation Receipt**: credential-redacted durable input envelope
  for one webhook delivery or approved extension/automation operation.
- **Granot Observation**: normalized point-in-time provider statement.
- **Synchronization Decision**: explainable comparison of an Observation,
  Vantage state, temporal ordering, identity evidence, and policy.
- **Granot Record Link**: durable normalized Job Number association to a
  Vantage Lead and its Booking context.
- **Granot Booking Action**: repeatable `Booked` or `Release` CRM action.
- **Granot Booking Reconciliation Case**: owner work for creating a missing
  Booking or reviewing the one existing Booking.
- **Granot Release Reconciliation Case**: owner work offering Cancellation,
  Booking update, or No Action for an active Booking.
- **No Action**: owner resolution with no domain mutation.
- **Ingestion Origin**: immutable server-assigned workflow that first created
  a Lead.

The canonical glossary is `C:/Users/Pinda/Proyectos/vantage/CONTEXT.md` and was
updated during the final interview to remove the stale CRM Lead Reference and
Intake terminology.

## External-source registry

### Authoritative ownership

`GranotCrmSource` becomes the only authoritative semantic registry for Granot
source labels. It is owned by the audited Operations Registry.

It must own at least:

```ts
type GranotLifecycleDisposition =
  | "source_scoped_lead"
  | "referral_booking"
  | "deferred";

type GranotLeadCreatedPolicy =
  | "link_only"
  | "create_if_missing"
  | "observation_only";
```

Required lifecycle configuration includes normalized external label,
disposition, lifecycle enabled flag, Lead-created policy, optional Source
Company, and zero or more deterministic Source Granularity routes. Move Type
may select mutually exclusive Form routes.

`GranotAutomationSource` becomes a temporary automation-selection record that
references `GranotCrmSource`. It may retain automation-only fields such as
active state and supported operations, but it must not own source semantics.
Existing APIs receive a compatibility adapter and are retired only after all
callers migrate.

All semantic mutations:

- use trusted Operations Registry commands;
- create `OperationsRegistryChange` audit evidence;
- invalidate registry caches after commit;
- fail closed on ambiguous active routes.

### Layered gates

An effect is permitted only when all applicable gates agree:

1. Global lifecycle/effect feature flag.
2. Post-activation/live execution mode.
3. Active `GranotCrmSource` classification and lifecycle flag.
4. Active target Source Company.
5. Active target Source Granularity.
6. The configured Lead-created policy or reconciliation policy.

Granot never silently reassigns a Lead's Source Company, Source Granularity,
Ingestion Origin, or CPL.

### Initial classifications

- Best Relocation Inbounds: source-scoped Call path; exact Call Granularity.
- Best Relocation Forms: source-scoped Form path with deterministic Move Type
  routing:
  - same valid pickup/delivery state -> Best Relocation Local Forms;
  - different valid states -> long-distance Best Relocation Forms;
  - missing/invalid states -> insufficient creation data.
- Referral: `referral_booking`; no Lead creation or Lead selection.
- Paid Overflow: `deferred`; evidence only.
- `AUTO` in the observed `type` column: provider context, not a source.
- A future actual source label named Auto: unclassified/evidence-only until an
  explicit Registry classification is approved.

Migration joins the two existing catalogs by exact normalized label. Ambiguous
or unmatched records are disabled/deferred and reported; never guess.

## Channel-neutral receipt and security contract

### In-place evolution

Rename the application model to `GranotObservationReceipt` while initially
retaining the physical `granot_webhook_receipts` collection. Do not perform a
dual-collection cutover in this project.

The immutable evidence portion includes:

- `source_system: "granot"`;
- `observation_channel: "granot_webhook" | "browser_extension" |
  "granot_http_automation"`;
- `captured_at`;
- optional webhook route event class;
- credential-redacted provider payload;
- payload kind and schema/evidence version;
- SHA-256 payload hash after credential removal;
- optional channel operation ID;
- strict-allowlist webhook headers;
- an authentication-method marker without credential material.

Mutable claim/lease/retry state belongs in an explicitly named processing
subdocument and is not immutable evidence.

### Active webhook authentication

The active Granot integration sends `x-api-secret` inside the JSON or
form-encoded request body. Preserve this compatibility.

- Accept the body field and also the header form for future migration.
- Scope the secret only to the three Granot webhook routes.
- Authenticate before capture with timing-safe comparison.
- Delete the body credential before hashing, persistence, normalization,
  logging, errors, or fixtures.
- Store only `body_secret` or `header_secret` as the authentication method.
- Unauthorized requests return `401` and create no receipt.

### Retention and access

- No TTL or automatic raw-receipt deletion in the first release.
- Raw payloads never appear in lifecycle list/detail projections.
- Do not add a general raw-receipt admin endpoint initially.
- Use database-platform encryption at rest; application field encryption is a
  separate security project unless compliance requires it.
- Never log complete customer contact, address, payload, or secret values.
- Preserve normalized causal evidence independently so future audited raw-data
  purges do not erase what the system decided.

## Granot Observation normalization

One receipt produces exactly one normalized Observation. Reprocessing the
receipt reuses it.

Required normalized concepts include:

- route event class separate from payload `event_type`;
- normalized source label and source registry reference;
- Job Number and normalized Job Number;
- raw and normalized Form reference;
- normalized contact and location values;
- raw and canonical Granot Priority;
- Granot move size and service type;
- raw booking action and normalized action;
- display-only estimate, payment, and balance;
- raw `user` and `rep` usernames;
- normalization issues and schema version.

Normalize `Booked` case-insensitively to Booked. Normalize only the explicitly
approved `Releas` and `Release` aliases to Release. Other well-formed booking
action values are unsupported; do not infer by prefix.

### Priority contract

- Accept a JSON number or trimmed string containing only a non-negative base-10
  integer within a small transport-safety length limit.
- Canonical storage is a normalized string; `5` and `"05"` become `"5"`.
- Preserve the exact raw value in receipt/Observation evidence.
- Do not use an administratively configured allowed-value enum.
- Store every valid canonical value on the matched Lead.
- Only `"1"` and `"5"` authorize broad enrichment and set `quoted = true`.
- Every other valid code changes Priority only.
- Granot never sets `quoted = false`.
- Missing/malformed Priority on Priority Update is invalid with no Lead
  mutation.
- Malformed Priority on Lead Created, Booked, or Release skips Priority effects
  but does not suppress the independent action.

## Temporal ordering and cross-channel idempotency

Granot supplies no reliable provider event ID, source occurrence timestamp, or
monotonic revision. Initial ordering is therefore:

- latest accepted Vantage `captured_at` wins across all three channels;
- store winning Observation ID/time on the Lead;
- older observations are stale and cannot overwrite newer accepted state;
- no channel automatically outranks another.

Idempotency identities:

- Webhook: every authenticated delivery is a distinct receipt and Observation,
  even if payloads are identical.
- Browser extension: stable client-generated operation ID retained across
  retries.
- HTTP automation: stable `run_id + action_id`.
- Partial unique key: `(observation_channel, channel_operation_id)` when an
  operation ID exists.
- Reusing an operation ID with a different payload hash is an idempotency
  conflict.
- Different receipts are never payload-hash-deduplicated away.
- Desired-state idempotency may yield `already_current` while preserving the
  later Observation.

Live Lead mutation from webhooks cannot be enabled until the extension and
HTTP automation final-apply paths create channel-neutral receipts and invoke
the same processor. Existing preview/approval user interfaces may remain.

## Identity and matching

Resolve source policy before contact fallback. Exact identity that conflicts
with known Source Scope is a hard conflict, not a warning and never a silent
reassignment.

### Form Lead ladder

1. Active Granot Record Link by normalized Job Number.
2. Exact eligible non-duplicate `FormLead.ref_no` using Granot payload
   `ref_no`.
3. If that same value is a valid ObjectId, exact eligible non-duplicate
   `FormLead._id` compatibility lookup.
4. Exact Source Scope-scoped contact fallback using submitted and accepted
   Granot contact states.
5. Otherwise pending, ambiguous, conflict, or unmatched.

The current executable posting contract remains: `FormLead.ref_no` is the
Tracking Reference posted as Granot `leadno`. Do not change posting to Mongo
`_id` in this project. Contract tests must cover payload generation and
round-trip matching.

Duplicate Form Leads are ineligible targets. Bad Form Leads are excluded from
contact fallback, enrichment, Booking suggestion, and Booking creation. Strong
exact identity may still associate evidence and store Granot Priority on a Bad
Lead; Granot never clears `bad_lead`.

### Call Lead ladder

1. Active Record Link by normalized Job Number.
2. Exact eligible Call Lead normalized Job Number.
3. Exact Source Granularity and normalized phone using current and immutable
   original caller/ingestion contact.
4. Otherwise pending, ambiguous, conflict, or unmatched.

Never use global contact matching across Source Scope.

### Booking identity

Resolve the one Booking through normalized Job Number and established Record
Link. An existing Booking's Lead is deterministic owner context. A missing
Booking Lead uses the existing `BookingLeadReconciliationCase`; Granot does not
duplicate that workflow. Referral Bookings are intentionally leadless.

## Lead Created behavior

### Matched-existing path

When WordPress or RingCentral already created the Lead, Lead Created:

1. Persists receipt, Observation, and Decision.
2. Resolves source and identity.
3. Establishes or confirms the Record Link.
4. Fills a missing Lead Job Number projection; conflicting Job Number is a
   conflict and is never overwritten.
5. Applies shared temporal and Priority policy.
6. May fill an empty receiver Agent under the Agent rules below.
7. Requests Sheet Sync only if reportable Lead state changed.
8. Returns `linked`, `applied`, `already_current`, `stale`, `ambiguous`, or
   `conflict` as appropriate.

It never creates a second Lead after a match. Lead Created participates in the
same Priority policy as every other snapshot, including Priority 1/5
enrichment and Priority 5 Booking Reconciliation.

### Creation timing by source policy

- `create_if_missing`: run the complete identity ladder once. If none matches,
  routing is deterministic, gates permit creation, and minimum data is present,
  create immediately through a canonical command. Do not wait 24 hours.
- `link_only`: retry matching for 24 hours; never create; terminal result is
  unmatched.
- `observation_only`, deferred, or disabled: evidence only.
- Missing immutable creation data: `insufficient_creation_data`; do not retry
  the same incomplete payload expecting new fields. A later complete
  Observation may create.
- Transient dependency failure is retryable and is not insufficient data.

Creation atomically reserves normalized Job Number through Record Link and
command idempotency constraints.

### Minimum creation data

All Granot-created Leads require normalized Job Number and enabled,
deterministic Registry routing.

Form Lead additionally requires:

- at least one name field;
- normalized phone;
- valid pickup and delivery data sufficient to derive Move Type and exact Form
  Granularity.

Set `post_to_granot = false` because the Granot row already exists. Vantage
WordPress `move_size` may be absent in this explicitly authorized context.

Call Lead may be created from Job Number alone only through this authorized
Granot pathway. Store all available contact/location facts without fabricating
RingCentral metadata or qualification.

## Persistent Ingestion Origin

Add immutable, server-assigned top-level `ingestion_origin` to both Lead kinds.
Clients cannot freely set it and headers do not establish it.

Initial values include:

- Form: `wordpress_form`, `granot_lead_created`,
  `best_relocation_sheet`, `vantage_admin`;
- Call: `ringcentral`, `granot_lead_created`, `best_relocation_sheet`,
  `vantage_admin`, plus explicit existing import origins required by live code.

Keep nested `ringcentral.ingestion_source = webhook | call_log_sync | manual`
as transport provenance. Existing trusted DTO fields named `ingestion_source`
may remain during compatibility migration, but canonical commands translate
them to the top-level origin.

Later RingCentral adoption adds verified secondary provenance; it never
rewrites `ingestion_origin = granot_lead_created`.

## Lead field authority and state management

### Shared authority matrix

| Field group | Authority |
| --- | --- |
| Job Number | Granot may fill missing and establish Record Link; conflict never overwrites |
| `granot_priority` | Every accepted valid Priority |
| `receiver_agent` | Any accepted Observation may fill empty through unambiguous active Agent identity |
| `quoted` | Priority 1/5 may set true; never false |
| Granot/current contact | Priority 1/5 under origin-specific rules below |
| Current location, move date, cubic feet | Priority 1/5 under origin-specific rules below |
| `granot_move_size`, `granot_service_type` | Priority 1/5; never overwrite Vantage move size/type |
| Source attribution, origin, CPL | Never reassigned by Granot after creation |
| Booking/Cancellation refs | Canonical owner commands only |
| Binder, Deposit, Merchant, Refund, allocations, official dates | Owner-command authority only |
| Granot estimate/payment/balance | Observation and case display context only; not Lead fields |

An accepted Observation with no authorized state change creates no
`EntityChange` and no Sheet Sync.

### WordPress-created Form Leads

- Preserve submitted name, phone, and email in immutable
  `ingested_contact_snapshot`.
- Submitted contact remains in the primary Form Lead contact fields.
- Granot never overwrites those primary submitted contact fields.
- Priority 1/5 stores latest accepted Granot contact in
  `granot_contact_snapshot`, including normalized values, difference flag,
  Observation ID, and captured time.
- Matching/search and Booking Reconciliation use and display both states.
- Preserve submitted pickup/delivery city/state/ZIP, move date, and Vantage
  move size in immutable `ingested_move_snapshot`.
- Before qualified enrichment, current operational location reflects
  WordPress.
- Priority 1/5 Granot location and move date may become current operational
  fields while the immutable submission remains unchanged.
- Re-derive Move Type from accepted current states.
- Store current move provenance: origin, Observation ID, and time.

Do not create a separate WordPress submission collection in this project.

### RingCentral-created Call Leads

- Preserve creation contact in immutable `ingested_contact_snapshot`.
- Preserve original caller phone and normalized phone in RingCentral metadata.
- Priority 1/5 Granot name, phone, email, location, move date, and cubic feet
  become current operational fields.
- Matching and search use current and immutable original contact.
- Maintain `granot_contact_revision` and bounded
  `last_granot_contact_change` before/after summary.
- Full history is `EntityChange`, not an array on the Lead.

### Granot-created Form Leads

No WordPress contact authority exists. Preserve creation snapshots, then apply
the Call Lead current-state policy for later qualified Granot changes.

### Agent identity

- Preserve raw Granot `user` and `rep`.
- Same normalized values are one assertion.
- Different nonempty values produce `granot_agent_identity_conflict` and no
  automatic assignment.
- A single normalized username may fill `receiver_agent` regardless of
  Priority if the Lead has none and exactly one active Agent matches.
- Never overwrite a receiver and never auto-create an Agent.
- Use channel-neutral provenance such as `granot_username_match`; retire the
  misleading `extension_crm_username_match` for new writes.
- Granot username is display-only as a suggested Booking Agent. Official Agent
  Allocations always require owner confirmation.

## Call Lead convergence and duplicate safety

The same physical inbound call must not become two Leads or be misclassified
as a business duplicate merely because Granot created a Lead first.

### Granot pre-creation checks

For RingCentral-facilitated inbound sources:

- Registry mapping must resolve the exact Call Granularity and an active
  RingCentral route assignment.
- Search locally by exact Granularity and normalized phone before creation.
- Exactly one eligible match is linked.
- Multiple matches create a convergence conflict; never guess.
- No match permits canonical Granot creation.

Granot-created Call Leads store convergence state `pending` or
`not_applicable`.

### RingCentral ingestion order

Change the shared qualified-call ingestion order to:

```text
telephony idempotency
  -> Granot-created Lead adoption attempt
  -> business duplicate classification
  -> create only if adoption did not succeed
```

Adoption requires:

- exact Source Granularity;
- same normalized caller phone;
- `ingestion_origin = granot_lead_created`;
- no RingCentral session identity already attached;
- creation within the approved 12-hour convergence window around the call;
- exactly one candidate.

Successful adoption atomically attaches complete verified RingCentral
metadata, original caller evidence, qualification facts, and processed-call
ledger identity; sets convergence state to adopted; retains original Ingestion
Origin; and does not treat the same physical call as duplicate.

Business duplicate classification excludes the adopted Lead itself. It may
still classify the Lead duplicate if a different genuine qualifying Call Lead
exists under the normal exact-Granularity, phone, and 90-day rule.

Multiple adoption candidates produce `ringcentral_convergence_conflict`.
Normal RingCentral ingestion preserves the qualified call, but unresolved
Granot-created candidates cannot alone cause a false duplicate classification.
Job-Number-only Granot Leads cannot be adopted by source/time alone.

Do not synchronously call RingCentral during Granot processing. The Call Log
cron runs every 30 minutes, keeps the 12-hour rolling lookback, and adds an
atomic execution lease plus rate/runtime/adoption telemetry.

## Booking and Release semantics

Provider-confirmed meaning:

- Booked: a Rep performed the Granot Book action.
- Release: a Rep released the job to make changes or because the customer
  cancelled.
- One Job Number may have many Booked and many Release actions.
- Priority is independent. Booked with Priority 0 is still a Booked action;
  Release with Priority 5 is still a Release action.

At most one open reconciliation case exists per normalized Job Number and
action kind. Repeated same-kind actions while open append evidence and refresh
the case. After resolution, a later action opens the next sequence-numbered
case. Booking and Release cases may both be open and do not auto-close each
other.

## Granot Booking Reconciliation Case

Triggers:

- Priority 5 on an eligible matched Lead;
- actual Booked action.

Modes:

1. `create_missing_booking`
   - No Vantage Booking exists.
   - Owner: Confirm Granot Booking or No Action.
   - Includes Lead candidate/search flow unless Referral.
2. `review_existing_booking`
   - Actual Booked action and one Vantage Booking exists.
   - Owner: Update Existing Booking or No Action.
   - Booking is deterministic; never a dropdown and never a second Booking.
   - Priority 5 alone does not open this mode.
3. `create_referral_booking`
   - Referral Booked action and no Booking.
   - No Lead selector.
   - Uses displayed accepted Granot contact.
   - Canonical referral creation produces `is_referral_booking = true` and
     syncs only the appropriate Master Booked projection.

Suggested Lead rules:

- High confidence (Record Link, exact Form reference/ObjectId compatibility,
  exact Call Job Number): may be preselected, but command sends explicit Lead.
- Medium confidence (Source Scope contact): display, do not preselect.
- Ambiguous: no selection.
- Default owner search is Source Scope; all eligible Leads may be searched.
- Out-of-scope selection requires warning and override reason.
- Successful explicit selection may correct the Record Link with owner
  evidence; it never changes the Lead's Source Scope.
- Background candidate refresh may run for 24 hours but never attaches/selects.

Create-missing official fields start blank. Granot move date, estimate,
payment, and balance never prefill Book Date, Binder, Deposit, Merchant, or
Refund. Existing-booking review starts from current Vantage Booking values.

## Granot Release Reconciliation Case

For a matching active Booking, owner paths are:

- Confirm Granot Cancellation;
- Update Existing Booking;
- No Action.

No Booking produces a Release Discrepancy. Conflicting identity/source produces
a Release Discrepancy. An already officially cancelled Booking returns
`already_current` without a case. Granot never auto-cancels or un-cancels.

## Reconciliation case state and concurrency

Both case models follow these invariants:

- state is `open | resolved`;
- resolution is separate, including `booking_created`, `booking_updated`,
  `referral_booking_created`, `cancellation_created`, `no_action`,
  `already_satisfied`, or `superseded_by_current_state` as applicable;
- partial unique index enforces one open case per Job Number/action kind;
- `(normalized_job_no, action_kind, sequence_number)` is unique;
- resolved cases are immutable and never reopened;
- later actions create the next sequence;
- trigger Observation IDs remain append-only evidence;
- `evidence_revision` changes for evidence refresh without invalidating an
  owner form;
- `case_revision` protects owner-relevant state and resolution;
- every owner command revalidates live Lead, Booking, Cancellation, Record
  Link, Registry policy, case revision, and aggregate revision;
- one concurrent command wins; another conflicts;
- replaying the winning idempotency key returns the original result;
- already-satisfied live state resolves without a second mutation.

## Discrepancies

Keep separate `GranotBookingDiscrepancy` and
`GranotReleaseDiscrepancy` models.

Booking Discrepancy examples:

- Booked conflicts with Record Link, Booking Lead, Job Number, or Source Scope;
- Booked after official Cancellation.

Release Discrepancy examples:

- Release with no Vantage Booking;
- Release conflicts with Record Link, Job Number, or Source Scope.

Do not create discrepancies for missing Booking under Priority 5/Booked,
pending/ambiguous Lead matching, deferred policy, an already cancelled Release,
or a Booking missing its Lead.

At most one open discrepancy exists per Job Number, discrepancy kind, and
reason fingerprint. Repeated evidence refreshes it. Owner may re-evaluate,
explicitly correct a Record Link with required reason, or resolve No Action.
Discrepancies never directly create/update/cancel/resurrect a Booking.
Successful re-evaluation may resolve one and open normal reconciliation.

## No Action reasons

Both optional `reason_code` and optional `reason_text` are supported. Neither
is required. Initial additive codes:

```text
already_handled_elsewhere
granot_action_not_authoritative
wrong_customer_or_job
duplicate_granot_action
booking_still_valid
granot_change_only
insufficient_information
legacy_data
other
```

Reasons are analytics/presentation metadata and never domain decision logic.

## Owner command interfaces

Every command requires case ID, expected case revision, idempotency key, and
server-authenticated durable owner actor. Existing aggregate mutations also
require expected `domain_revision`.

### Create missing standard Booking

- Explicit selected Lead model/ID.
- Required override reason for out-of-scope Lead.
- Required official Book Date.
- At least one Agent Allocation.
- Total Binder must equal allocation sum.
- Nonnegative Deposit.
- Active Merchant.
- Job Number/source loaded from case, not editable.

### Update existing Booking

- Deterministic Booking loaded from case.
- Full replacement of Book Date, allocations, Binder, Deposit, and Merchant.
- UI starts from current Vantage values.
- Expected Booking revision prevents lost updates.
- Never creates a second Booking.

### Create Referral Booking

- No Lead selector or Source Scope override.
- Same official Booking fields.
- Contact and Job Number loaded from accepted case evidence.

### Confirm Cancellation

- Deterministic Booking loaded from case.
- Required Cancel Date and nonnegative Refund.
- Optional business reason, notes, and `cancelled_by`.
- Durable command actor remains separate from `cancelled_by`.

### No Action

- Optional reason code/text.
- Resolves only the case.
- No `EntityChange` and no Sheet Sync.

No command accepts Granot estimate, payment, balance, move date, source,
contact, or suggested Agent as authoritative owner input.

## Persistence models and required existing-model additions

New/evolved models:

- `GranotObservationReceipt`;
- `GranotObservation`;
- `GranotRecordLink`;
- `SynchronizationDecision`;
- `EntityChange`;
- `GranotLifecycleActivation`;
- `GranotBookingReconciliationCase`;
- `GranotReleaseReconciliationCase`;
- `GranotBookingDiscrepancy`;
- `GranotReleaseDiscrepancy`.

Extend:

- `GranotCrmSource` for authoritative lifecycle semantics;
- `GranotAutomationSource` with authoritative source reference during
  compatibility migration;
- `DomainCommandExecution` origin/actor/provenance vocabulary;
- Form/Call Leads with Ingestion Origin, Job Number parity, Granot Priority,
  contact/move snapshots, current provenance, Granot move/service fields,
  temporal winner, and domain revision metadata;
- Call Lead with RingCentral convergence state/evidence;
- Booked/Cancelled aggregates with `domain_revision`, `last_change_id`, and
  `last_changed_at`.

`EntityChange` stores compact allowlisted before/after values, aggregate
revision transition, actor, causal refs, and changed field paths. Backfill
current aggregates to revision 0 and label history availability; never invent
predeployment changes.

Important indexes include:

- unique/partial channel operation identity on receipts;
- receipt work state and next-attempt time;
- one Observation per receipt;
- active unique normalized Job Number Record Link;
- decision outcome/time/entity refs;
- Lead normalized Job Number and Source Granularity/contact search paths;
- one open case per Job/action kind;
- unique Job/action sequence;
- one open discrepancy per Job/kind/reason fingerprint;
- existing unique RingCentral telephony session identity;
- existing one-Booking-per-normalized-Job constraint.

Do not create generic Intake Case, generic lifecycle status, generic Lifecycle
Engine, or parallel admin-app Mongoose models.

## Deep Module interfaces

Keep the public interfaces small. Routes and consumers pass identities, not
normalized payloads, candidate lists, or patches.

```ts
interface GranotObservationProcessor {
  process(input: { receipt_id: string; initiator?: DurableActor }): Promise<{
    observation_id: string;
    decision_id: string;
    outcome: SynchronizationOutcome;
    effects: SynchronizationEffectSummary[];
    target?: EntityRef;
  }>;
}
```

The processor hides normalization, source routing, identity ladders, temporal
ordering, policy, desired-state comparison, persistence, idempotency, and
canonical command invocation.

```ts
interface GranotBookingReconciliation {
  reconcileObservation(input: {
    observation_id: string;
    decision_id: string;
  }): Promise<CaseEffectResult>;

  confirmBooking(input: ConfirmBookingCommand): Promise<OwnerCommandResult>;
  updateExistingBooking(input: UpdateBookingCommand): Promise<OwnerCommandResult>;
  createReferralBooking(input: ReferralBookingCommand): Promise<OwnerCommandResult>;
  noAction(input: NoActionCommand): Promise<OwnerCommandResult>;
}

interface GranotReleaseReconciliation {
  reconcileObservation(input: {
    observation_id: string;
    decision_id: string;
  }): Promise<CaseEffectResult>;

  confirmCancellation(input: ConfirmCancellationCommand): Promise<OwnerCommandResult>;
  updateExistingBooking(input: UpdateBookingCommand): Promise<OwnerCommandResult>;
  noAction(input: NoActionCommand): Promise<OwnerCommandResult>;
}
```

Canonical commands remain the only mutation seam. Add the missing canonical
`updateBooking` behavior and canonicalize existing Referral Booking behavior.
Call convergence belongs behind one shared internal seam used by Granot
creation and RingCentral qualified-call ingestion; it must not be duplicated
inside routes.

## Layered result vocabulary

Receipt work state:

```text
pending | claimed | retry_scheduled | completed | dead_letter
```

Normalization result:

```text
valid | valid_with_issues | invalid | unsupported
```

Synchronization outcome:

```text
created | applied | linked | already_current | stale | pending_match |
unmatched | ambiguous | conflict | deferred | policy_blocked |
insufficient_creation_data | invalid | unsupported
```

Decisions additionally record explicit effect summaries. Technical dependency
failures are processing-attempt failures, not business Decisions.

Only `pending_match` uses the business matching retry schedule. Invalid,
unsupported, deferred, policy-blocked, and insufficient-data outcomes complete
the receipt. Dead letter means bounded technical retries exhausted.

## Queue, leases, and retries

- Capture commits before `202`; capture failure returns `503`.
- Best-effort queue publish happens after capture and carries only receipt ID.
- Mongo is the durable work source.
- Dedicated queue consumer and five-minute cron use the same drainer.
- Atomic five-minute claim lease with renewal and expiry recovery.
- Initial batch size 20 with bounded concurrency.
- Technical failures use exponential backoff with jitter.
- Ten technical failures move a receipt to dead letter.
- Authenticated manual requeue requires reason and audit evidence.
- Pending matching schedule:

  ```text
  immediate -> 1m -> 5m -> 15m -> 1h -> 2h -> 6h -> 12h -> 24h
  ```

- Final failed match becomes terminal unmatched.
- Metrics: queue age, due count, claim recovery, retries, dead letters, outcome
  counts, capture-to-decision latency, and effect latency.

RingCentral Call Log cron is separate: every 30 minutes, atomic account lease,
12-hour rolling lookback, cursor advance only after complete success, and
provider throttling/runtime/adoption telemetry.

## Historical shadow and activation

Persist a write-once audited `GranotLifecycleActivation` with activation time,
actor, reason, and processor version.

- `captured_at < activated_at` is permanently `historical_shadow`.
- Historical shadow may normalize, decide, and create safe identity/link
  evidence only.
- It may never mutate/create Leads, open cases/discrepancies, notify, Sheet
  Sync, or invoke business commands.
- Reprocessing never promotes historical receipts.
- Post-cutoff receipts are live-eligible but still effect-gated.
- System shadow produces `live_shadow` decisions.
- Shadow decisions are never replay-promoted; new live Observations authorize
  live effects.
- Rollback disables effects and never rewrites activation history.

## Notification policy

Initial owner-facing behavior is dashboard-only. Email is independently
feature-gated and disabled.

If enabled later:

- send only for a newly opened sequential case;
- never send merely because an open case refreshed;
- dedupe by case ID, sequence number, channel, and purpose;
- no digest initially;
- extend the existing generic Notification Delivery model with case references
  and purposes rather than creating Booking/Release notification domain models.

## Admin projections

Required server-owned projections:

```text
GET /api/v1/admin/granot-lifecycle/jobs/:normalized_job_no
GET /api/v1/admin/granot-lifecycle/cases
GET /api/v1/admin/granot-lifecycle/cases/:case_id
GET /api/v1/admin/leads/:lead_model/:lead_id/lifecycle
```

The Job Number timeline is primary and includes every Observation, Priority,
Booked/Release action, sequential case, discrepancy, Record Link change,
canonical change, and current Booking/Cancellation fact. Group visually but do
not collapse evidence. Order by capture time plus stable ID tie-breaker.

List projections are masked and filterable. Authorized details return only
normalized owner-work fields. Lead views include linked Job Numbers. Referral
works without a Lead. The admin app renders projections and does not recreate
domain rules.

## Feature flags and safe defaults

```text
GRANOT_LIFECYCLE_PROCESSING_ENABLED
GRANOT_LIFECYCLE_SHADOW_MODE
GRANOT_LIFECYCLE_LEAD_WRITES_ENABLED
GRANOT_LIFECYCLE_LEAD_CREATION_ENABLED
GRANOT_LIFECYCLE_BOOKING_CASES_ENABLED
GRANOT_LIFECYCLE_BOOKING_COMMANDS_ENABLED
GRANOT_LIFECYCLE_RELEASE_CASES_ENABLED
GRANOT_LIFECYCLE_RELEASE_COMMANDS_ENABLED
GRANOT_LIFECYCLE_REFERRAL_BOOKING_ENABLED
GRANOT_LIFECYCLE_EMAIL_ENABLED
```

Capture stays active. Processing begins enabled in shadow. Every mutation,
case, command, Referral, and email flag begins disabled. Disabling effects
preserves receipts/evidence/open cases. Case reads precede owner writes.
Booking precedes Release. Email is last.

## Migration and rollout order

1. Correct glossary/contracts and freeze redacted fixtures.
2. Add in-place receipt fields, credential stripping, hashes, and compatibility
   reads/writes.
3. Backfill receipt channel/capture/evidence fields idempotently; report before
   applying.
4. Add Observation, Decision, Record Link, Activation, and operational reads.
5. Extend authoritative source registry and migrate automation references with
   ambiguity report.
6. Add additive Lead fields/indexes and contextual validators; backfill
   immutable Ingestion Origin where deterministically knowable and explicitly
   report unknown legacy origins.
7. Add aggregate revision/change evidence; backfill revision 0 without
   fabricated history.
8. Implement processor and production identity/temporal/idempotency adapters in
   shadow.
9. Dry-run all existing receipts in historical shadow with PII-safe reports.
10. Converge extension and HTTP automation final apply through receipts and
    processor; prove parity.
11. Enable source-scoped safe Lead writes without creation/cases.
12. Implement immediate authorized Lead Created creation and RingCentral
    adoption; enable narrowly by Registry source.
13. Change RingCentral cron to 30 minutes only after lease and adoption/duplicate
    tests pass.
14. Add Booking Reconciliation dashboard/read-only and measure candidate
    quality.
15. Enable Booking owner commands through canonical commands.
16. Add Release Reconciliation dashboard/read-only.
17. Enable Release owner commands.
18. Add Referral mode.
19. Add discrepancies and explicit identity correction.
20. Enable email only after separate owner acceptance.
21. Delete disposable prototype only after all relevant scenarios exist at
    production Module interfaces.

Each rollout issue must state prerequisites, flags, migration dry-run, live
verification, and rollback/disable behavior.

## Acceptance-test obligations

Port and revise the 27 prototype scenario invariants. Test through Module
interfaces and canonical commands, not a generic lifecycle engine.

At minimum cover:

- credential in JSON body/form body/header and proof it is never persisted;
- channel operation idempotency conflict versus distinct webhook evidence;
- Form Tracking Reference round trip and Mongo ID compatibility;
- source conflict on exact identity;
- all valid Priority values stored and only 1/5 broadly enrich;
- malformed Priority behavior by event class;
- matched-existing Lead Created never creates a second Lead;
- immediate authorized creation and insufficient data;
- Best Relocation local/long-distance routing;
- WordPress protected contact plus separate Granot contact snapshot;
- WordPress immutable move snapshot plus qualified current location;
- Call/Granot-created Form current contact transformations and bounded history;
- receiver assignment at non-1/5 Priority and conflicting `user`/`rep`;
- Granot-created Call Lead adopted by RingCentral;
- adopted same call is not a false duplicate;
- a genuinely different prior Call Lead still causes duplicate classification;
- multiple/no-phone adoption conflicts;
- RingCentral cron lease and overlapping execution;
- Priority 5 and Booked case triggers;
- existing Booking review and no second Booking;
- repeated same-kind action refresh, later action new sequence;
- evidence revision does not stale an owner form;
- concurrent owner command single-winner behavior;
- Release cancel/update/no-action;
- already cancelled Release already-current;
- Booked after Cancellation discrepancy;
- Referral leadless Booking;
- Paid Overflow and Auto evidence-only behavior;
- 24-hour pending-to-unmatched;
- historical receipts never produce live effects;
- shadow decisions are never promoted;
- no-op creates neither Entity Change nor Sheet Sync;
- every mutation has causal refs and desired-state replay safety.

Dry-run against captured receipts, but never commit customer PII in fixtures or
logs.

## Curated architectural references

These are the most descriptive sources. Older documents contain useful detail
but must be read through this pre-specification's supersession rules.

1. `C:/Users/Pinda/Proyectos/vantage/CONTEXT.md` — canonical domain language.
2. `vantage-main-server/scripts/prototypes/granot-lead-lifecycle/specs/near_complete_with_handoff_lead_lifecycle_spec.md`
   — comprehensive prior interview handoff.
3. `vantage-main-server/scripts/prototypes/granot-lead-lifecycle/GRANOT-LIFECYCLE-PRODUCTION-SPEC.md`
   — starter Module/route/queue handoff; partially superseded.
4. `vantage-main-server/scripts/prototypes/granot-lead-lifecycle/LEAD-ENRICHMENT-STATES-AND-FIELDS.md`
   — contact/location/Priority field-state explanation.
5. `vantage-main-server/scripts/prototypes/granot-lead-lifecycle/SUGGESTED-DOMAIN-MODELS-AND-PROVENANCE.md`
   — detailed provenance shapes; Intake names are superseded.
6. `vantage-main-server/docs/granot-webhook-domain-service-model.md` — verified
   receipt/matching/service evidence; original link-only assumption superseded.
7. `vantage-main-server/docs/granot-lifecycle-prototype-and-implementation-seams.md`
   — prototype seams and scenario map; Module names superseded where noted.
8. `vantage-main-server/docs/lead-lifecycle-paths-and-projected-granot-webhooks.md`
   — current lifecycle interleavings.
9. `vantage-main-server/scripts/prototypes/granot-lead-lifecycle/payload_shapes.md`
   — redacted live payload shapes.
10. `vantage-main-server/scripts/prototypes/granot-lead-lifecycle/scenarios.ts`
    — disposable executable assertions to absorb, not production architecture.

## Curated live-code references

Webhook capture and authentication:

- `src/routes/granot-webhook.routes.ts`
- `src/middleware/requireGranotWebhookSecret.ts`
- `src/services/granotWebhooks/granotWebhookCapture.service.ts`
- `src/models/GranotWebhookReceipt.ts`

Lead identity/state and CRM behavior:

- `src/models/FormLead.ts`
- `src/models/CallLead.ts`
- `src/services/crm/formLeadPayload.ts`
- `src/services/granotHttpCollector/granotFormLeadMatcher.ts`
- `src/services/granotHttpCollector/formWorkflow.ts`
- `src/services/enrichment/callLeadEnrichment.service.ts`
- `src/services/agents/receiverAgentCrmUsername.ts`

Canonical mutation/provenance:

- `src/services/domainCommands/`
- `src/models/DomainCommandExecution.ts`
- `src/services/bookings/bookedLead.service.ts`
- `src/services/bookings/referralBooking.service.ts`
- `src/services/cancellations/cancelledLead.service.ts`

Registry ownership:

- `src/models/GranotCrmSource.ts`
- `src/models/GranotAutomationSource.ts`
- `src/models/LeadSourceCompany.ts`
- `src/models/LeadSourceGranularity.ts`
- `src/models/OperationsRegistryChange.ts`
- `src/services/operationsRegistry/`

RingCentral convergence:

- `src/services/ringcentral/ringcentral-call-lead-ingest.service.ts`
- `src/services/ringcentral/ringcentral-duplicate-guard.ts`
- `src/services/ringcentral/call-log-sync.service.ts`
- `src/services/ringcentral/call-log-sync-state.store.ts`
- `src/services/ringcentral/ringcentral-config.ts`
- `vercel.json`

Notifications/read patterns:

- `src/models/NotificationDelivery.ts`
- `src/services/observability/emailNotification.service.ts`
- `src/models/BookingLeadReconciliationCase.ts`

## Deliberately deferred, not unresolved

- Paid Overflow business ownership and lifecycle effects.
- Any actual Auto source-label classification.
- Application-level encryption beyond database encryption at rest.
- Automatic raw-receipt purge/retention period.
- Physical Mongo collection rename from `granot_webhook_receipts`.
- Targeted asynchronous RingCentral lookup after Granot creation; adopt only if
  30-minute cron latency proves operationally unacceptable.
- New provider occurrence/revision semantics until Granot supplies them.

These items must fail closed and remain visible as evidence. They do not block
the official specification or the approved first release.

## Instructions for the fresh specification agent

1. Treat every approved decision in this document as locked.
2. Inspect the curated live files before naming exact edit locations.
3. Write the official specification as an implementation contract, not another
   exploration or interview handoff.
4. Define exact TypeScript/Zod/Mongoose shapes, partial indexes, transactional
   filters, reason codes, error mappings, and migration commands.
5. Map each acceptance scenario to one or more sequential implementation
   slices.
6. Preserve current capture and user-owned repository changes.
7. Explicitly label old Intake/link-only/glossary assumptions superseded.
8. Do not create issues until the official specification is reviewed.

