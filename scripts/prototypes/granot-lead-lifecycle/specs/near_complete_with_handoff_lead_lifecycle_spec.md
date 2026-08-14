Vantage Granot lead lifecycle specification interview — handoff

Date: 2026-08-13  
Workspace: `C:/Users/Pinda/Proyectos/vantage`  
Next session objective: continue the one-question-at-a-time specification interview, resolve remaining decisions, then rewrite the production specification so it can be converted directly into sequential, independently implementable agent issues.

## Current status

The interview is incomplete, but the core identity, ingestion, synchronization, source-policy, and owner-reconciliation architecture is now substantially settled. No production implementation was performed. No repository files were edited during this session. The existing prototype/spec files are user-owned, currently uncommitted work and must be preserved.

The next agent should not restart the design from the original starter document. Several starter assumptions were explicitly superseded during this interview, especially:

- `lead_created` is no longer link-only. It may create Form or Call Leads for registry-authorized Granot sources.
- Granot priorities other than `1` and `5` are not “unknown” or blocked. Every valid priority is saved on the Lead; only `1` and `5` authorize snapshot enrichment.
- The receipt abstraction is no longer webhook-only. All Granot pathways converge through one channel-neutral receipt and processor.
- `Booked` with an existing Booking is not automatically hidden as `already_current`. It may require owner reconciliation/update/no-action.
- Release is not inherently cancellation intake. It is repeatable Granot action evidence that may mean update, cancellation, or no action.
- The narrower Booking Intake and Cancellation Intake concepts were replaced by Booking Reconciliation and Release Reconciliation cases.

## Required source material

Read these first rather than relying only on this handoff:

- `C:/Users/Pinda/Proyectos/vantage/CONTEXT.md` — canonical platform domain language.
- `C:/Users/Pinda/Proyectos/vantage/vantage-main-server/AGENTS.md`
- `C:/Users/Pinda/Proyectos/vantage/vantage-main-server/CONTEXT.md`
- `C:/Users/Pinda/Proyectos/vantage/vantage-main-server/scripts/prototypes/granot-lead-lifecycle/payload_shapes.md` — redacted webhook shapes.
- `C:/Users/Pinda/Proyectos/vantage/vantage-main-server/scripts/prototypes/granot-lead-lifecycle/GRANOT-LIFECYCLE-PRODUCTION-SPEC.md` — starter specification; useful but partially superseded by this interview.
- `C:/Users/Pinda/Proyectos/vantage/vantage-main-server/scripts/prototypes/granot-lead-lifecycle/SUGGESTED-DOMAIN-MODELS-AND-PROVENANCE.md` — detailed evidence/current-state model sketches and rollout.
- `C:/Users/Pinda/Proyectos/vantage/vantage-main-server/scripts/prototypes/granot-lead-lifecycle/scenarios.ts` — 27 executable prototype scenarios; migrate relevant invariants to tests at production interfaces.
- `C:/Users/Pinda/Proyectos/vantage/vantage-main-server/scripts/prototypes/granot-lead-lifecycle/domain.ts` — disposable prototype only; never copy `LifecycleWorld` or productionize `advanceLeadLifecycle`.
- `C:/Users/Pinda/Proyectos/vantage/vantage-main-server/docs/granot-webhook-domain-service-model.md`
- `C:/Users/Pinda/Proyectos/vantage/vantage-main-server/docs/granot-lifecycle-prototype-and-implementation-seams.md`
- `C:/Users/Pinda/Proyectos/vantage/vantage-main-server/docs/lead-lifecycle-paths-and-projected-granot-webhooks.md`
- `C:/Users/Pinda/Proyectos/vantage/vantage-main-server/docs/granot-webhooks.md`

Important live seams inspected:

- Webhook capture: `src/routes/granot-webhook.routes.ts`, `src/services/granotWebhooks/granotWebhookCapture.service.ts`, `src/models/GranotWebhookReceipt.ts`
- Lead aggregates: `src/models/FormLead.ts`, `src/models/CallLead.ts`, `src/models/BookedLead.ts`, `src/models/CancelledLead.ts`
- Current Form Granot identity/matching: `src/services/granotHttpCollector/granotFormLeadMatcher.ts`
- Current Form Granot patch logic: `src/services/granotHttpCollector/formWorkflow.ts`
- Current HTTP automation apply/idempotency: `src/services/granotHttpCollector/runWorkflow.ts`
- Current Call enrichment: `src/services/enrichment/callLeadEnrichment.service.ts`
- Canonical command seam: `src/services/domainCommands/`
- Canonical idempotency evidence: `src/models/DomainCommandExecution.ts`
- Source registry: `src/models/LeadSourceCompany.ts`, `src/models/LeadSourceGranularity.ts`, `src/services/operationsRegistry/`
- Existing overlapping Granot source catalogs: `src/models/GranotCrmSource.ts`, `src/models/GranotAutomationSource.ts`
- Existing referral path: `src/services/bookings/referralBooking.service.ts`
- Extension API pathways: `granot_sync_extensions_and_services/src/api/formLeads.ts`, `granot_sync_extensions_and_services/src/api/callLeads.ts`
- Queue/cron house pattern: `vantage-main-server/vercel.json`, Sheet Sync and other `api/queues/*-consumer.ts` implementations.

## Objective and architectural direction

Granot webhook events and their broad payload snapshots become first-class Lead Lifecycle advancement and synchronization triggers. Browser extension and Granot HTTP automation remain supported lifecycle pathways, but all three channels must converge on the same durable receipt, normalization, matching, temporal ordering, policy, idempotency, and canonical-command path.

MongoDB remains the System of Record. Granot observations are evidence and synchronization inputs. A Granot event never directly fabricates official Binder, Deposit, Merchant, Refund, Cancellation, or Booking facts. Owner reconciliation remains authoritative for Bookings and Cancellations.

Use compositional lifecycle facts, not a mutable lifecycle status enum. Preserve causal provenance:

`GranotObservationReceipt -> GranotObservation -> SynchronizationDecision -> DomainCommandExecution -> EntityChange/current aggregate/Sheet Sync`

Owner cases branch from synchronization decisions. Keep current aggregate state plus append-only evidence; do not use full event sourcing or unbounded history arrays on Leads.

## Locked decisions

### 1. Form Lead identity contract

Matching order is locked:

1. Active Granot Record Link by normalized Job Number.
2. Exact non-duplicate `FormLead.ref_no` match using Granot payload `ref_no`.
3. If the same value is a valid Mongo ObjectId, try non-duplicate `FormLead._id` compatibility.
4. Source-scoped contact fallbacks.
5. Otherwise represent `pending_match`, `ambiguous`, `conflict`, or terminal `unmatched` without mutation.

The current executable CRM Posting contract remains: Form Lead Tracking Reference is sent to Granot as `leadno`, which appears in Granot as `ref_no`. Do not migrate posting to Mongo `_id` as part of this lifecycle project. Mongo `_id` remains a compatibility possibility because Granot `ref_no` may contain it.

An exact identity whose known Source Scope conflicts with the payload must produce conflict evidence and never silently reassign/enrich the Lead. Fallback searches are always Source Company/Granularity scoped; never global.

### 2. Historical receipt backfill

Existing webhook receipts are processed strictly in shadow mode:

- Create/migrate channel-neutral receipts, normalized observations, synchronization decisions, and safe identity evidence/links.
- Do not mutate Leads.
- Do not create owner reconciliation cases, discrepancies, or notifications.
- Do not send Sheet Sync.
- Process in `received_at`/capture order and record what would have happened.
- Establish an explicit live activation timestamp; only post-activation observations may perform enabled live effects.

This is deliberate because extension/HTTP automation already applied many historical outcomes.

### 3. Granot Priority policy

Granot Priority is a first-class field on both Form and Call Leads.

- Save every valid Granot priority value on the matched Lead. Values such as `0`, `1`, `2`, `3`, `5`, `7`, `8`, and `9` are legitimate priority values, not “unknown.”
- Only priorities `1` and `5` authorize broad Lead snapshot enrichment.
- `1`/`5` set `quoted = true` where applicable.
- `5` may promote into Booking Reconciliation.
- Other priorities update `granot_priority` and temporal provenance only; they do not alter quoted/contact/location/booking facts.
- Granot never sets `quoted = false`.
- Saving a changed priority is an applied synchronization; a same priority/current authorized snapshot is `already_current`.
- Missing/malformed priority is invalid; do not call recognized but uninterpreted numeric values blocked.

### 4. Temporal ordering

Granot currently supplies no reliable provider event ID, source occurrence timestamp, or monotonic revision. Vantage will roll its own temporal state:

- Latest accepted Vantage capture time wins across webhook, browser extension, and Granot HTTP automation.
- Store winning observation ID/time on the Lead.
- Older observations are `stale` and cannot overwrite newer accepted state.
- No observation channel automatically outranks another.
- If Granot later provides occurred-at/revision semantics, the spec may evolve, but this is the initial contract.

### 5. Bad and Duplicate Form Leads

- Duplicate Form Leads remain ineligible matching/enrichment/booking targets.
- Bad Form Leads are owner-declared bad and cannot be enriched or used as Suggested Booking Leads/Booking targets.
- Strong exact identity may still associate evidence and save `granot_priority` on a Bad Lead.
- Contact fallback excludes Bad Leads.
- Granot never clears `bad_lead`.
- Priority `5` on a Bad Lead does not create Booking Reconciliation for that Lead.

### 6. Cross-channel convergence is required before live webhook mutations

Do not enable live webhook-driven Lead mutation until browser extension and Granot HTTP automation final syncs pass through the same Granot Observation Processor.

- Existing previews, approvals, UI, and endpoint shapes may remain during migration.
- Final approved synchronization creates durable channel-specific receipt evidence and invokes shared policy.
- Direct Lead-write implementations are retired only after parity tests.
- Same desired state from another channel returns `already_current`.
- Temporal and idempotency rules are shared.

### 7. Channel-neutral receipt

Replace/evolve `GranotWebhookReceipt` into `GranotObservationReceipt`, one immutable durable input envelope for all three channels.

Expected fields include:

- `source_system: "granot"`
- `observation_channel: "granot_webhook" | "browser_extension" | "granot_http_automation"`
- `captured_at`
- optional webhook route event type
- immutable raw payload
- payload kind and schema version
- channel operation ID when available
- webhook headers only for webhook channel, with a strict allowlist
- processing claim/lease fields kept conceptually separate from immutable evidence

Migrate/backfill existing webhook receipt documents without losing `_id` or raw payload. Set channel to `granot_webhook` and `captured_at = received_at`. The eventual migration mechanics (in-place collection evolution versus compatibility model/dual-read) still need exact planning.

### 8. Channel idempotency identities

- Granot provides no event ID, so each actual webhook delivery remains a distinct receipt/observation. Identical later deliveries are evidence and normally decide `already_current`.
- Browser extension uses a stable client-generated operation ID retained across retries.
- HTTP automation uses stable `run_id + action_id`.
- Unique key: `(observation_channel, channel_operation_id)` where an operation ID exists.
- Reusing an operation ID with a different payload is an idempotency conflict.
- Reprocessing one receipt reuses its one normalized observation and cannot repeat a canonical mutation.
- Different genuine receipts are never payload-hash-deduplicated away.

### 9. Pending-match window

Retry unmatched observations for 24 hours. Suggested attempts: immediate, 1 minute, 5 minutes, 15 minutes, 1 hour, 2 hours, 6 hours, 12 hours, 24 hours.

Reason: RingCentral Call Log safety-net cron currently runs every two hours and rescans a 12-hour rolling window (`vercel.json`, `src/services/ringcentral/ringcentral-config.ts`). A Granot event may precede Call Lead ingestion.

Each retry reruns the full identity ladder. On expiry, record terminal `unmatched`, not `blocked`. A later distinct observation may establish a link; historical decisions remain immutable.

For owner reconciliation candidate suggestions, background retries may refresh candidate evidence for 24 hours but may never select or attach a Lead. Owner-only Refresh/Search remains available.

### 10. Registry-authorized source lifecycle and Lead creation

The old prototype rule “`lead_created` links but never creates” is superseded.

Granot source participation is runtime-controlled through audited Operations Registry models and an authoritative Granot external-source mapping.

Initial source-scoped policies include Best Relocation Inbounds and Best Relocation Forms. The same Granot `Best Relocation Forms` label may route to two Form granularities because routing is mutually exclusive by derived Move Type:

- pickup state equals delivery state -> Best Relocation Local Forms
- different states -> Best Relocation Forms / long-distance granularity
- missing/invalid states -> no creation; unresolved/insufficient data

Best Relocation Inbounds maps to its Call granularity.

At the Vantage registry side:

- Source Company has a Granot lifecycle enabled kill switch.
- Source Granularity is active/lifecycle-enabled and has a `lead_created_policy`, initially `link_only` or `create_if_missing`.
- Both external mapping and target company/granularity gates must permit processing.
- Registry mutations are audited through `OperationsRegistryChange` and invalidate runtime caches.
- Ambiguous active routes are rejected.

### 11. Granot `lead_created` as authorized ingestion

For source/granularity policies marked `create_if_missing`, `lead_created` may create a Lead after matching/retry policy concludes no suitable Lead exists.

Configured Granot Inbounds may create a Call Lead independently of RingCentral qualification:

- Use canonical `createCallLead` with `ingestion_origin = granot_lead_created`.
- Do not fabricate RingCentral metadata or claim qualification occurred.
- Preserve normal Source Scope, duplicate, CPL, Sheet Sync, and command idempotency behavior.
- Job-Number-only Call Lead creation is allowed only for this registry-authorized Granot pathway. Normal RingCentral Call Lead creation remains phone + Source Scope based.

Configured Granot Forms may create Form Leads:

- `post_to_granot = false` because the row already exists in Granot.
- Source/granularity route must be deterministic.
- Creation is via canonical command, not direct model write.
- Minimum fields are defined below.

### 12. Later RingCentral adoption

When Granot timing creates a Call Lead first, later RingCentral ingestion should atomically adopt it instead of creating another Lead:

- Match one Granot-created Call Lead by same Source Granularity + normalized caller phone within the ingestion time window.
- Candidate must not already have RingCentral session identity.
- Exactly one candidate -> attach real RingCentral metadata and unique telephony session ID.
- None -> normal RingCentral ingestion.
- Multiple -> do not guess; use normal ingestion and record convergence conflict.
- Existing unique telephony session index is the final race/idempotency guard.
- Original `ingestion_origin = granot_lead_created` remains; RingCentral adds verified secondary provenance rather than rewriting creation history.

The expected normal path remains RingCentral creation followed by Granot validation/context. Adoption handles peculiar ordering only.

### 13. Contextual Lead validation and persistent ingestion origin

Persist server-assigned `ingestion_origin`; do not infer trusted workflow origin from request headers and do not let clients freely select it.

Initial values should cover at least:

- Form: `wordpress_form`, `granot_lead_created`, `best_relocation_sheet`, `vantage_admin`
- Call: `ringcentral`, `granot_lead_created`, plus any existing/admin/import origins needed

`FormLead.move_size` is the Vantage WordPress enum and remains required for WordPress Form Lead Ingestion. It may be absent for explicitly authorized non-WordPress creation contexts such as Granot `lead_created`.

Do not conflate:

- Vantage `move_size` enum supplied by WordPress
- Granot’s own move-size value, stored as `granot_move_size`
- Granot `service_type`, stored as `granot_service_type`
- Vantage Move Type (`local`/`long_distance`), derived from current pickup/delivery states

Store `granot_move_size` and `granot_service_type` on both Lead models. Granot values never overwrite Vantage `move_size`. `granot_service_type` never overrides derived Move Type.

Minimum Granot creation data:

- All Granot-created Leads require normalized Job Number and enabled deterministic registry mapping.
- Form Lead additionally requires at least one name field, phone, and valid pickup/delivery location data sufficient to derive Move Type and route granularity.
- Call Lead may be created from Job Number alone only in the authorized Granot pathway; store any available contact/location fields.
- Missing required creation data -> `insufficient_creation_data`, no mutation. A later complete observation may create.

### 14. Job Number on both Lead models

Add `job_no` and `normalized_job_no` to Form Lead. Call Lead already has them.

- `GranotRecordLink` remains authoritative and enforces durable Job Number association.
- Lead fields are current-state projections/search convenience.
- Fill a missing Job Number.
- Never overwrite a different existing Job Number; record conflict.
- Form/Call Lead Granot current-state fields become consistent.

### 15. Embedded WordPress submission evidence, not a new collection

Do not create a WordPress submission/ingestion-source collection in this implementation.

- Form Lead remains the first-class domain record.
- Persist `ingestion_origin = wordpress_form`.
- Embed immutable submission snapshots on Form Lead.
- Source Company/Granularity remain Operations Registry entities.
- A separate exact transport receipt can be considered later only if raw-request replay becomes a real requirement.

### 16. Contact authority and provenance

#### WordPress-created Form Leads

- WordPress contact fields are preserved as immutable submitted identity.
- Granot never overwrites submitted name, phone, or email.
- Store latest accepted Granot contact in a denormalized `granot_contact_snapshot`, for example:
  - first/last name
  - phone + normalized phone
  - email + normalized email
  - `differs_from_ingested_fields`
  - observation ID and observed time
- Historical Granot contact states remain in observations.
- Search/fallback uses both submitted contact and Granot contact snapshot.
- Booking Reconciliation displays both for owner review.

#### Call Leads

- Preserve creation contact in immutable `ingested_contact_snapshot`.
- Preserve original RingCentral caller phone and normalized value in RingCentral metadata.
- Latest accepted Granot first/last name, email, and phone become current Call Lead contact values.
- RingCentral adoption/Caller Match Key/history can still use immutable original caller phone.
- Search uses both current Granot contact and original ingestion/caller contact.
- Retain `granot_contact_revision` and a bounded `last_granot_contact_change` before/after summary on the Lead.
- Full transformation history is append-only `EntityChange`; never use an unbounded Lead history array.

#### Granot-created Form Leads

- No WordPress authority exists, so they follow the Call Lead-style policy.
- Granot supplies current contact fields.
- Creation snapshot is preserved.
- Later accepted Granot changes update current contact and record bounded latest-change + full `EntityChange` provenance.

### 17. Location/move authority

Approved model: immutable submission snapshot plus canonical current location.

For WordPress-created Form Leads:

- Preserve original submitted location/move facts in `ingested_move_snapshot` (pickup/delivery city/state/ZIP, move date, Vantage move size).
- Before qualified enrichment, standard current location fields reflect WordPress input.
- A Priority `1` or `5` makes accepted Granot pickup/delivery locations and move date canonical current operational fields.
- This does not lose/overwrite immutable WordPress submission evidence.
- Other priorities update priority only and cannot replace current location.
- Vantage Move Size remains the WordPress enum; Granot move size remains separate.
- Re-derive Move Type from canonical current states.
- Store current move provenance (`wordpress_form` or `granot`, observation ID/time).
- Actual transformations create `EntityChange`.

For Call Leads and Granot-created Form Leads, latest qualified Granot location/move-date/cubic-feet values may become current operational facts with the same provenance/change rules.

### 18. Granot developer-confirmed booking action semantics

The user supplied a direct response from the Granot developer:

- Granot has buttons to book a job and release a job from booking.
- `event_type=Booked`: a Rep booked the move with the customer. One job may have multiple booking actions, commonly after release/change cycles.
- `event_type=Release`: the Rep released the job from booked status, either to make changes or because the customer cancelled. One job may have multiple release actions.
- Captured payloads have also contained truncated `Releas`; normalize `Releas` and `Release` to the same action.

Therefore Booked/Release are repeatable actions, not durable state transitions. Priority is an independent field.

### 19. Reconciliation work-item cardinality

- Every delivery remains a distinct observation.
- At most one open reconciliation case exists per normalized Job Number and action kind (booking versus release).
- Repeated same-kind actions while the case is open attach evidence and refresh it.
- After completion/no-action, a later action opens a new sequential case for the same Lead/Booking.
- Cases store `sequence_number` and all trigger observation IDs.
- Historical cases remain attached to the same Lead/Booking.
- Booking and Release cases may both be open for one Job Number; do not auto-close one merely because the opposite Granot action arrived.

### 20. Booking triggers and `GranotBookingReconciliationCase`

Both Priority `5` and `Booked` are credible booking-reconciliation triggers:

- Priority `5` on eligible matched Lead opens/refreshes booking reconciliation.
- `Booked` opens/refreshes booking reconciliation.
- Same open job/action case dedupes owner work.
- Neither creates a Booking automatically.

Replace narrower `GranotBookingIntakeCase` with two-mode `GranotBookingReconciliationCase`:

1. `create_missing_booking`
   - Priority `5` or Booked when no Vantage Booking exists.
   - Owner actions: Confirm Granot Booking or No Action.
   - Includes Suggested Booking Lead selection/search unless Referral disposition applies.
2. `review_existing_booking`
   - Actual repeated `Booked` action when a Vantage Booking already exists.
   - Owner actions: Update Existing Booking or No Action.
   - Deterministic linked Booking, never a dropdown.
   - Never creates a second Booking.

Priority `5` alone does not open existing-booking review. A repeated actual `Booked` action does.

### 21. Release reconciliation

Replace `GranotCancellationIntakeCase` with `GranotReleaseReconciliationCase`.

For active linked Booking, owner paths are:

- Confirm Granot Cancellation
- Update Existing Booking
- No Action

Other outcomes:

- No Vantage Booking -> Granot Release Discrepancy
- Conflicting Record Link -> Granot Release Discrepancy
- Booking already officially cancelled -> `already_current`, no owner case
- Later Release after prior completed case -> new sequential case

Never auto-cancel. Never un-cancel. Granot payment/balance/estimate never become Refund/Binder/Deposit.

### 22. One no-operation resolution

Do not distinguish “dismiss” versus “confirm no changes.” Use one case resolution action, recommended name `no_action`, with optional owner reason.

- Requires durable owner actor, expected case revision, and idempotency key.
- Completes the case without domain mutation.
- No `EntityChange` is created because no entity changed.
- Case stores resolution actor/time/reason/idempotency evidence.

### 23. Booking field defaults

- `create_missing_booking`: Book Date begins blank and is required.
- Granot Move Date is display-only context and never copied to Book Date.
- `review_existing_booking`: fields begin with existing Vantage Booking values.
- Granot estimate, payment, and balance are display-only and never prefill Binder, Deposit, Merchant, or Refund.
- Confirm uses owner-supplied official Book Date, Agent Allocations, Binder, Deposit, Merchant and canonical command.

### 24. Suggested Booking Lead and owner search

- High confidence: active Record Link, exact Form ref/Mongo compatibility, or exact Call Job Number. UI may preselect, but confirm request always sends explicit Lead model + ID.
- Medium confidence: Source-scoped contact match. Display but do not preselect; explicit owner click required.
- Ambiguous: no selection; owner must search/choose.
- Automatic suggestions/fallbacks remain Source Scope-specific.
- Owner can search all eligible Leads from the case.
- Default search is resolved Source Scope.
- Out-of-scope selection is allowed with clear warning and required override reason.
- Successful owner selection may correct the Granot Record Link with owner-resolution evidence.
- Never silently change selected Lead Source Scope.

Inbound timing UX:

- Booking case may open with no Lead currently found.
- Show message similar to: “The Call Lead may not have been ingested yet. Check back later or check RingCentral for this number.”
- Provide Search Leads and Refresh Candidates.
- Background retries may refresh candidate evidence for 24 hours but never select/attach.
- Only Confirm Granot Booking attaches selected Lead/creates Booking.

### 25. Existing Booking without Lead

Use the existing `BookingLeadReconciliationCase` workflow for source-scoped Bookings whose Lead is missing/unresolved. Granot Booking Reconciliation references/displays that case and does not duplicate Lead-attachment logic.

Exception: Referral Booking without a Lead is expected and never opens Booking Lead Reconciliation.

### 26. Contact display and fallback, not editable Booking contact feature

Do not add owner-editable official contact fields to source-scoped Confirm Booking in this scope.

- Display original/submitted and current Granot contact states for review.
- Include both in Source Scope fallback searches.
- Exact identity remains higher precedence.
- Contact-only matches remain medium confidence.
- Conflicting candidates are ambiguous.
- Existing booking/customer derivation continues from the selected Lead/current canonical workflow.

Referral exception is approved: because no Lead exists, Referral Booking confirmation displays and uses the Granot-observed customer contact directly, without an additional editable contact section. Owner may choose `no_action` if identity is wrong.

### 27. Authoritative Granot source registry and Referral

The earlier company/granularity-only mapping is insufficient because valid Granot sources may intentionally have no Source Company Lead path.

Evolve `GranotCrmSource` into the authoritative external-source registry with a lifecycle classification such as:

```ts
lifecycle_disposition:
  | "source_scoped_lead"
  | "referral_booking"
  | "deferred"

source_company_id?: ObjectId
granularity_routes?: Array<{
  granularity_id: ObjectId;
  move_type?: "local" | "long_distance";
}>
lifecycle_enabled: boolean
lead_created_policy:
  | "link_only"
  | "create_if_missing"
  | "observation_only"
```

This external mapping works with, rather than replaces, active target Source Company/Granularity kill switches.

Referral policy:

- `Referral` disposition is `referral_booking`.
- No Source Company/Granularity Lead attachment.
- Priority observations remain evidence; do not create Leads.
- Referral `Booked` opens Booking Reconciliation mode `create_referral_booking`.
- Hide Lead selection entirely.
- Owner supplies official Booking facts; Granot contact is displayed/used.
- Canonicalize and invoke existing `createReferralBooking` behavior.
- Result has `is_referral_booking = true`, no Lead, and syncs to Master Booked only.
- Later Booked/Release actions reconcile against normalized Job Number normally.

`Paid Overflow` remains `deferred` until its meaning/policy is determined.

In the supplied sample, `Referral` was the source and `AUTO` was in the Granot `type` column. Do not treat `AUTO` type as Source Company; store it as provider service/type context unless a distinct Granot source label named Auto is later observed and classified.

`GranotAutomationSource` currently overlaps external Granot label cataloging. Long-term it should reference authoritative `GranotCrmSource` entries rather than own semantic source mapping. The exact consolidation/migration plan remains to be specified.

## Existing starter decisions that remain valid unless later interview changes them

- Keep webhook HTTP paths unchanged and fast/capture-only:
  - `POST /api/webhooks/granot/lead-created`
  - `POST /api/webhooks/granot/priority-updated`
  - `POST /api/webhooks/granot/booking-status-changed`
- Capture must complete before `202`; capture failure returns `503` so Granot retries.
- After capture, best-effort queue wake-up only; never process domain logic inside webhook request.
- Mongo receipt is durable work source. Queue messages only wake by receipt ID/reason.
- Dedicated queue consumer + atomic claim/lease + cron safety net. Follow Sheet Sync/lead messaging/Granot automation Vercel patterns.
- Shadow slice may begin cron-only; queue must exist before owner-facing live latency matters.
- Use factories/dependency injection and test module public interfaces.
- Production has no `advanceLeadLifecycle`/generic Lifecycle Engine.
- Keep one cluster under `src/services/granotLifecycle/`, but module names must be revised for the newly approved reconciliation concepts.
- Use canonical domain commands; never call CRUD booking/cancellation methods directly from reconciliation modules.
- Add missing canonical `updateBooking` command with transactional Booking Chain/EntityChange behavior.
- Canonicalize existing `createReferralBooking` for lifecycle usage.
- Extend `DomainCommandExecution.origin` and trusted system actor validation for Granot lifecycle commands.
- One Booking per normalized Job Number remains enforced by BookedLead unique normalized index.
- Only owner Confirm creates first Booking/Cancellation. Update Existing Booking mutates the one Booking. No action mutates nothing.
- Granot estimate/payment/balance are context only.
- Source system, observation channel, actor, and initiator are distinct provenance axes.
- Add current aggregate `domain_revision`, `last_change_id`, `last_changed_at` and append-only `EntityChange`; backfill revisions to `0`, do not fabricate predeployment history.
- Header capture should use allowlist, not current denylist.
- Admin reads should return projections, not raw Mongo documents.
- Use feature flags for shadow processing, Lead writes, creation, case opening, owner commands, and notifications.

## Models implied by the revised specification

Names are provisional where noted; the next agent should reconcile them into exact implementation-grade schemas:

- `GranotObservationReceipt` (replaces/evolves `GranotWebhookReceipt`)
- `GranotObservation`
- `GranotRecordLink`
- `SynchronizationDecision`
- `EntityChange`
- `GranotBookingReconciliationCase` (replaces Booking Intake)
- `GranotReleaseReconciliationCase` (replaces Cancellation Intake)
- Booking/Release discrepancy models, likely renamed consistently
- Notification/delivery model(s), still undecided
- Existing `BookingLeadReconciliationCase` remains in use
- `GranotCrmSource` extended as authoritative external lifecycle registry
- `FormLead`/`CallLead` additions described above
- `BookedLead`/`CancelledLead` revision/change provenance additions
- `DomainCommandExecution` origin/provenance extension

Do not create generic `IntakeCase`, generic lifecycle status, full Lead snapshots per change, or unbounded Lead histories.

## Processing result vocabulary requiring final cleanup

Starter outcomes included `applied`, `linked`, `already_current`, `stale`, `pending_match`, `ambiguous`, `conflict`, `blocked`, `invalid`, and internal `dependency_failed`.

Interview requires adding terminal `unmatched` and changing recognized non-qualifying priority behavior away from `blocked`. The final spec should define exact terminal/retryable outcomes and reason-code vocabulary. Keep transport claim status separate from normalization and synchronization outcomes.

## Granot action parsing

- Route event class and payload `event_type` are separate.
- Normalize payload `Booked` case-insensitively to booking action.
- Normalize `Releas` and `Release` to release action.
- Unknown booking action is unsupported/invalid; never assume Release by prefix beyond the explicitly approved aliases unless business confirms.
- Priority on a booking-status payload is independent snapshot context and follows normal priority rules; Priority `0` never unbooks or cancels.

## Remaining interview questions / unresolved decisions

Continue using the `grill-me`/`grilling` skill: one question at a time, give a recommended answer, inspect code instead of asking when code can answer.

High-priority remaining areas:

1. Exact `GranotCrmSource` versus `GranotAutomationSource` consolidation/migration and Operations Registry CRUD/API ownership.
2. Exact Lead field schemas, indexes, normalization, and contextual Zod validation.
3. Whether `granot_priority` accepts any normalized numeric string or an administratively configured allowed set; how malformed values behave.
4. Full field-authority matrix beyond contact/location (agent assignment, cubic feet, move date, source snapshots, booked/cancelled Leads).
5. Owner notification policy: dashboard only initially, email off/immediate/digest, dedupe behavior.
6. Exact reconciliation case states/revisions, open-case unique partial indexes, sequence allocation, evidence attachment, and race behavior.
7. Exact owner command payloads for:
   - create missing standard Booking
   - review/update existing Booking
   - create Referral Booking
   - confirm Cancellation
   - update Booking from Release
   - no action
8. Exact discrepancy vocabulary and resolution workflow under revised Booking/Release model.
9. Whether repeated Booked/Release cases should be grouped visually into one Job Number action timeline (recommended) and read API shape.
10. Granot username -> Agent rules: suggestion versus receiver-agent enrichment versus official Booking allocations.
11. Retention/encryption policy for raw receipts and PII; no TTL should be invented meanwhile.
12. Live activation cutoff mechanics and how shadow evidence is reviewed/promoted without replaying mutations.
13. Queue/cron schedules, leases, retryable dependency failures, poison receipt handling, and observability.
14. Exact migration/backfill scripts and dry-run reports for receipt evolution, Lead field additions, revision `0`, and source registry classification.
15. Dry-run testing against existing production payload receipts with PII-safe logs/fixtures.
16. Admin routes and projections under revised names; starter route list must be updated from intake terminology.
17. Whether owner case `no_action` reason should have optional free text only or also optional reason-code taxonomy.
18. Paid Overflow disposition (explicitly deferred).
19. Any actual Granot source label `Auto` (not the type column) and its eventual classification.
20. Rollout issue slicing and feature flag defaults.

## Recommended rollout direction

Preserve the starter’s shadow-first strategy, revised for new requirements:

1. Schema/config migrations only: channel-neutral receipts, source registry classification, additive Lead fields/indexes, revision defaults.
2. Backfill existing webhook receipts as shadow-only channel-neutral receipts.
3. Normalize observations and record decisions/links in shadow; expose operational review reads.
4. Implement authoritative source registry controls and dry-run source routing, including Referral/deferred classifications.
5. Implement shared processor/matcher/temporal/idempotency seams with in-memory interface tests.
6. Converge extension and HTTP automation receipt/final-apply paths; preserve previews and verify parity.
7. Enable safe priority/current-state synchronization by source flags, still without Lead creation/cases.
8. Enable configured `lead_created` creation with canonical commands and strict contextual validation.
9. Implement RingCentral adoption convergence.
10. Implement Booking Reconciliation read-only/dashboard cases and measure candidates.
11. Enable Confirm/Create/Update/No Action owner operations through canonical commands.
12. Implement Release Reconciliation read-only/dashboard cases, then enable Cancellation/Update/No Action.
13. Add Referral booking mode through canonical referral command.
14. Enable optional notifications only after dashboard/case quality is proven.
15. Delete prototype only after all relevant scenarios are asserted through production public interfaces.

The final specification must turn this into exact independently grabbable sequential issues with prerequisites, files, public interfaces, migrations, acceptance tests, feature flags, rollout checks, and rollback behavior.

## Testing expectations

- Port the 27 prototype scenario invariants from `scenarios.ts`, revising those superseded by the interview.
- Add scenarios for:
  - all priority values persisted, only `1`/`5` enrich
  - WordPress protected contact plus Granot contact snapshot search
  - Call current contact transformations with original caller preservation
  - Granot-created Form Lead origin/context validation
  - configured Best Relocation local/long-distance routing
  - Granot-created Call Lead later adopted by RingCentral
  - Referral Booked creates leadless referral reconciliation/Booking
  - Paid Overflow remains deferred
  - repeated Booked/Release actions produce sequential cases
  - same open action refreshes one case
  - Booked existing Booking offers update/no-action rather than automatic hidden no-op
  - Release offers cancel/update/no-action
  - cross-channel operation retry versus genuinely distinct receipt evidence
  - 24-hour pending/unmatched transition
  - historical receipts never cause live effects
- Test at `processGranotObservation`, reconciliation module public interfaces, and canonical commands—not internal matcher functions beyond focused pure tests.
- Dry-run against captured receipts, with customer data redacted from logs and committed fixtures.

## Suggested skills

- `grill-me` / `grilling` — continue unresolved specification decisions one at a time.
- `domain-modeling` — update canonical vocabulary/ADR only after remaining business decisions settle.
- `codebase-design` — shape deep processor/reconciliation interfaces and avoid duplicated source/receipt policies.
- `tdd` — when implementation begins, port scenarios test-first at public interfaces.
- `to-issues` — only after the final specification is complete; produce tracer-bullet sequential issues with explicit dependencies.
- `handoff` — generate another transfer if the next session ends before the final spec is written.

## Repository state warning

At inspection time `vantage-main-server` already had user-owned modified/untracked prototype and documentation files, including `scripts/prototypes/` and Granot lifecycle docs. Do not reset, delete, or overwrite unrelated work. Recheck `git status --short` before writing.

## Recommended first move for the next agent

1. Read this handoff plus the required prototype/live files above.
2. Invoke `grill-me`.
3. Briefly restate the last locked decision: Referral uses the displayed Granot contact directly for leadless Referral Booking confirmation.
4. Continue with one recommended question, preferably notification policy or the exact revised source-registry ownership, unless the user redirects.
5. When the interview finishes, rewrite `GRANOT-LIFECYCLE-PRODUCTION-SPEC.md` (or create the user-approved successor) as the authoritative specification and clearly label the old prototype assumptions superseded.
