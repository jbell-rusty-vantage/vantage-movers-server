# Operations Registry Pre-Implementation Plan

Status: Pre-implementation; decisions and sequencing are expected to evolve  
Date: 2026-07-28  
Primary repository: `vantage-main-server`  
Related repositories: `vantage-admin`, `granot_sync_extensions_and_services`

## 1. Objective

Build an owner-controlled Operations Registry that becomes the single runtime
source for:

- Agents and Granot CRM identities
- Merchants
- Source Companies
- Source Company form/call granularities
- Effective-dated CPL schedules
- RingCentral inbound queue-number routing and validation

The registry must be safe to edit while production ingestion is running. It
must preserve historical meaning, enforce cross-record invariants, provide
auditable changes, and resolve configuration consistently for Form Lead
Ingestion, Call Lead Ingestion, booking, Granot Enrichment, CRM Posting,
Analytics, and Reporting Projection.

Moving Carriers are explicitly out of scope. Their current CSV overwrite or
idempotent-addition workflow is considered resolved for this initiative.

## 2. Desired owner capabilities

The Admin Dashboard should allow the owner to:

- Create an Agent.
- Edit an Agent's name, role, status, and Granot CRM mapping information.
- Activate or deactivate an Agent.
- See whether an Agent is referenced by leads or bookings before deactivation.
- Create, edit, activate, and deactivate Merchants.
- Create a Source Company.
- Create and edit form and call granularities within that Source Company.
- Set defaults for form and call attribution.
- Manage source aliases, CRM labels, source sites, Move Type routing, and
  precedence.
- Create scheduled CPL rate periods for each granularity.
- See current, past, and future CPL rates.
- Preview the impact of a CPL correction before rewriting lead snapshots.
- Create and edit RingCentral inbound numbers.
- Assign each active RingCentral number to one active call granularity.
- Validate a number against the RingCentral account before activation.
- See the latest validation result and recent call-observation evidence.
- Deactivate a number without changing attribution already stored on Call
  Leads.
- Review an audit trail for every registry mutation.

## 3. Non-goals

The first implementation should not:

- Delete operational catalog records that have historical references.
- Make Moving Carriers part of the Operations Registry.
- Build generic CRUD that bypasses domain-specific invariants.
- Make Google Sheets authoritative for registry configuration.
- Store RingCentral OAuth credentials in registry documents.
- Change the established RingCentral OAuth/token store.
- Allow arbitrary per-number Call Qualification logic in the first release.
- Automatically rewrite historical CPL snapshots when a current or future
  rate is edited.
- Replace the existing Sheet Sync outbox.
- Build External Data Ingestion or Reporting Projection in the same delivery,
  although the registry must be designed for those future consumers.

## 4. Terminology

The following terms are proposed for this work.

### Operations Registry

The canonical owner-editable collection of operational configuration and the
rules used to resolve it.

The registry is a module, not a generic database table browser. Its interface
includes validation, activation rules, temporal resolution, and errors that
callers must understand.

### Source Company

Use the existing domain term. A Source Company is the attribution dimension
shared by duplicate detection, CPL, CRM labels, routing, and reporting.

### Source Granularity

For pre-implementation, retain the code's existing term. It identifies one
routable and billable stream inside a Source Company, such as:

- TBM Forms
- TBM Prime Inbounds
- Best Relocation Local Forms

An owner-facing rename to "Lead Source Program" may be considered later, but
the implementation should not rename the concept until that language is
confirmed.

### RingCentral Inbound Route

Recommended canonical implementation term for the configuration the owner calls
a RingCentral Queue Number.

The phone number is the routing key used by current Call Qualification. A real
RingCentral call can contain queue, IVR, and Agent legs, and a queue name is not
a supported telephony subscription filter. Calling the model an Inbound Route
allows it to contain:

- The normalized inbound phone number
- Optional RingCentral number/extension/queue identifiers
- Observed queue metadata
- The assigned Source Granularity
- Validation and activation state

The dashboard may label the feature "RingCentral Queue Numbers."

### CPL Rate Period

One effective-dated CPL amount for one Source Granularity.

Periods use a half-open interval:

```text
[effective_from, effective_until)
```

`effective_from` is inclusive. `effective_until` is exclusive and may be absent
for the current open-ended period. This makes adjacent periods unambiguous and
avoids double-applying a rate at a shared instant.

### Applied CPL Snapshot

The amount and rate-period identity stored on a Lead when its CPL is resolved.
Changing a future or current schedule does not silently change prior snapshots.

## 5. Core invariants

### Shared lifecycle invariants

- Registry records are deactivated, not hard-deleted, once referenced.
- Deactivation affects new resolution and selection only.
- Historical Lead and Booking snapshots remain readable after deactivation.
- Stable slugs, granularity keys, and external identity keys are immutable after
  use.
- Display labels may change, but domain records preserve label snapshots.
- Every mutation records actor, reason where required, time, and before/after
  state.
- Activation is stricter than draft creation: a draft may be incomplete, but
  an active record must satisfy all runtime invariants.

### Agent invariants

- `normalized_name` remains unique among canonical Agents.
- Granot identity keys are normalized consistently.
- One active Granot identity cannot map to two active Agents in the same CRM
  origin/workspace.
- Deactivating an Agent prevents new selection and automatic receiver matching.
- Existing Agent Allocations and receiver-agent references remain intact.
- Changing an Agent display name does not rewrite old
  `agent_name_snapshot` fields automatically.

### Merchant invariants

- `normalized_name` remains unique.
- Inactive Merchants cannot be selected for new Bookings.
- Existing Bookings retain their merchant snapshot/string.
- Reactivation should restore the same canonical Merchant rather than create a
  duplicate.

### Source Company invariants

- `company_slug` is immutable and unique.
- A Source Company may be created as a draft with no active granularities.
- An active Source Company used for ingestion must have appropriate active
  defaults or require an explicit granularity key from the caller.
- A default form granularity must belong to that company, have channel `form`,
  and be active.
- A default call granularity must belong to that company, have channel `call`,
  and be active.
- Deactivating a Source Company prevents all new attribution through it.
- Deactivation does not rewrite existing Leads, Bookings, or reporting
  snapshots.

### Source Granularity invariants

- `granularity_key` is immutable and unique.
- A granularity belongs to exactly one Source Company.
- Its channel is either `form` or `call` and should become immutable after use.
- CRM label and owner label are non-empty.
- A call granularity may own zero or more RingCentral Inbound Routes.
- A form granularity may own source-site aliases.
- Priority resolves overlapping aliases only when the matching policy allows
  precedence; exact conflicting identifiers should normally be rejected.
- Deactivating a default granularity requires selecting a replacement or
  deactivating the parent Source Company in the same command.

### CPL invariants

- A CPL Rate Period belongs to exactly one Source Granularity.
- Rate periods for the same granularity cannot overlap.
- Amount is non-negative.
- Resolution uses the Lead's business timestamp, not `createdAt`.
- Duplicate Call Leads continue to receive zero CPL under current domain rules.
- Main Site may use explicit zero-dollar periods.
- An open-ended period may be the current or future final period.
- A past period can be corrected only through a command that previews affected
  Leads and records a reason.
- Routine editing does not bulk-update prior Leads.

### RingCentral invariants

- Phone numbers are stored in one normalized E.164-like form.
- One active phone number maps to one active call granularity at a time.
- The assigned granularity must be channel `call`.
- The Source Company and granularity must both be active before route
  activation.
- A route must pass local validation before live validation.
- Production activation should normally require a successful RingCentral
  account validation.
- An override, if supported, requires owner role, an explicit reason, and an
  audit entry.
- Deactivation stops future matching but does not alter prior Call Leads.
- Webhook and Call Log paths must resolve the same phone number to the same
  Source Company and granularity at the same effective instant.

## 6. Current implementation inventory

### Agent

Current model: `src/models/Agent.ts`

Current fields include:

- `name`
- `normalized_name`
- `active`
- `role`
- `created_from`
- One sparse unique `granot_crm_username`

Current consumers include:

- Booking Agent Allocation
- Form and Call Lead receiver-agent matching
- Admin catalog options and filters
- Extension sales-rep matching and creation

Primary gap: one flat username may not be enough if an Agent has multiple
Granot identities, renamed usernames, or identities that vary by CRM origin or
workspace.

### Merchant

Current model: `src/models/Merchant.ts`

The model and catalog flow already cover most initial registry behavior. The
main additions are registry-level auditability, dependency previews, and
consistent activation commands.

### Source Company and granularities

Current model: `src/models/LeadSourceCompany.ts`

Granularities are currently embedded subdocuments. They already contain:

- `granularity_key`
- `channel`
- `owner_label`
- `crm_label`
- aliases
- active/archive fields
- one current `cpl`
- optional Move Type
- source sites
- inbound phone numbers
- priority
- optional sheet tab name

The embedded design made initial editing convenient, but it becomes shallow as
relationships grow. Effective-dated rates, RingCentral routes, stable
references, independent activation, uniqueness constraints, and audit history
all need to address one granularity directly.

The current runtime also assumes a closed set of Source Companies through:

- The `SourceCompany` TypeScript union in `src/config/domain/sources.ts`
- `SOURCE_COMPANY_CONFIGS`
- `SOURCE_LABEL_TO_COMPANY`
- Static CRM label lists and source-specific switch statements
- Analytics source filters
- Google Sheets target/tab resolution

The model can store a new company while these consumers still reject, ignore,
or incompletely project it. Dynamic owner creation is not complete until these
compile-time catalogs become migration seeds or compatibility adapters rather
than runtime authority.

### CPL

Current models and implementation:

- `src/models/CplRate.ts`
- `src/services/cpl/cplRate.service.ts`
- `src/config/domain/cplRateDefinitions.ts`

There are currently two overlapping representations:

- `LeadSourceCompany.granularities[].cpl`
- Legacy `cpl_rates` documents seeded from static definitions

Updating a rate currently backfills all matching non-duplicate Leads. The new
implementation must establish one canonical temporal representation and retire
the ambiguous dual-write behavior.

### RingCentral inbound numbers

Current mapping:

`src/services/ringcentral/call-lead-sources.ts`

Current static values:

| Phone number | Source label | Source Company |
| --- | --- | --- |
| `+18883164387` | `10best Inbounds` | `tbm_leads` |
| `+18883083612` | `TBM Prime Inbounds` | `tbm_prime_leads` |
| `+18887240625` | `Top10 Inbounds` | `top10_leads` |
| `+18884779232` | `Main Site Inbounds` | `main_site` |
| `+18883971005` | `GetMovers Inbounds` | `get_movers_leads` |

Database-backed lookup currently exists as a fallback through Source Company
granularity `inbound_phone_numbers`, but static matching is still used by:

- `webhook-event-normalizer.ts`
- `call-candidate-evaluator.ts` through normalized candidate state
- `call-log-vetting.ts`
- `analytics-reconcile.service.ts`
- Per-number webhook subscription filter construction

The database model and runtime cutover must be delivered together.

## 7. Recommended target data model

### 7.1 Keep `Agent`

Retain the existing `agents` collection and ObjectIds so Booking and Lead
references remain stable.

Recommended Agent additions:

```text
active
archived_at
deactivation_reason
updated_by
```

Do not immediately remove `granot_crm_username`; use it as a compatibility
field during migration.

### 7.2 Add `AgentGranotIdentity`

Recommended collection: `agent_granot_identities`

Proposed fields:

```text
agent                         ObjectId -> Agent
crm_origin                    string
workspace_slug                string optional
granot_user_id                string optional
granot_username               string
granot_display_name           string optional
aliases                       string[]
active                        boolean
verified                      boolean
verified_at                   Date optional
last_observed_at              Date optional
created_from                  string
created_by                    actor snapshot
archived_at                   Date optional
```

Recommended unique constraints:

- `(crm_origin, workspace_slug, normalized_granot_username)` for active
  identities
- `(crm_origin, workspace_slug, granot_user_id)` when provider ID is present

Why use a separate collection:

- One Agent may need multiple Granot identities.
- Granot usernames may change.
- Identities may vary by CRM origin or workspace.
- Verification status belongs to the mapping, not to the Agent.
- The extension and CSV ingestion can match through one interface without
  learning Agent storage details.

If discovery confirms exactly one immutable Granot username per Agent across
the entire account, this collection may be deferred and the current Agent field
expanded instead. That decision must be made before schema implementation.

### 7.3 Keep `Merchant`

Retain the existing collection and ObjectIds.

Recommended additions:

```text
archived_at
deactivation_reason
updated_by
```

Avoid introducing a separate Merchant identity model unless an external
processor/account mapping requirement appears.

### 7.4 Keep `LeadSourceCompany`, extract `LeadSourceGranularity`

Recommended collection: `lead_source_granularities`

Proposed fields:

```text
source_company                ObjectId -> LeadSourceCompany
granularity_key               string immutable unique
channel                       "form" | "call"
owner_label                   string
crm_label                     string
aliases                       string[]
active                        boolean
archived_at                   Date optional
local                         "local" | "long_distance" optional
source_sites                  string[]
priority                      number
created_from                  string
created_by                    actor snapshot
```

Move these concerns out of the embedded subdocument:

- CPL into `CplRatePeriod`
- RingCentral numbers into `RingCentralInboundRoute`
- Reporting destination configuration into the future Reporting Projection
  module

Benefits of extraction:

- Stable first-class ObjectId references
- Direct detail/update routes
- Unique indexes across all companies
- Independent activation commands
- Easier temporal CPL queries
- Easier RingCentral route references
- Smaller Source Company updates
- No replacement of the entire granularities array for one edit

The Operations Registry interface should hide whether these records are stored
in one or multiple collections. Callers should resolve source attribution
through registry commands/queries rather than querying models directly.

### 7.5 Add `CplRatePeriod`

Recommended collection: `cpl_rate_periods`

Proposed fields:

```text
source_granularity            ObjectId -> LeadSourceGranularity
amount                        number
effective_from                Date
effective_until               Date optional
active                        boolean
change_reason                 string
created_by                    actor snapshot
supersedes                    ObjectId optional
archived_at                   Date optional
```

Recommended indexes:

- `(source_granularity, effective_from)`
- `(source_granularity, effective_until)`
- Partial lookup index for active/open periods

MongoDB cannot express arbitrary date-range non-overlap with a normal unique
index. The module must enforce non-overlap in a transaction and protect against
concurrent writers. Options to evaluate:

1. Transactional overlap query plus insert/update.
2. A per-granularity mutation lease.
3. Optimistic version on the granularity schedule.

The interface should return a specific conflict error containing the overlapping
periods.

Recommended Lead snapshot fields:

```text
cpl                            existing applied amount; retained
cpl_rate_period                ObjectId optional
cpl_resolved_at                Date optional
cpl_resolution_version         string optional
```

Existing Analytics may continue reading `lead.cpl`; the new reference makes the
amount explainable and auditable.

### 7.6 Add `RingCentralInboundRoute`

Recommended collection: `ringcentral_inbound_routes`

Proposed fields:

```text
provider                       "ringcentral"
phone_number                   normalized string
display_label                  string
source_company                 ObjectId -> LeadSourceCompany
source_granularity             ObjectId -> LeadSourceGranularity
active                         boolean
effective_from                 Date optional
effective_until                Date optional

ringcentral_phone_number_id    string optional
ringcentral_extension_id       string optional
ringcentral_queue_id           string optional
ringcentral_queue_name         string optional
observed_target_names          string[]

validation_status              "unvalidated" | "valid" | "invalid" | "warning"
validation_code                string optional
validation_message             string optional
validated_at                   Date optional
validated_by                   actor/system snapshot optional
last_seen_in_call_log_at       Date optional
last_seen_in_webhook_at        Date optional

created_from                   string
created_by                     actor snapshot
archived_at                    Date optional
```

Recommended indexes:

- Unique normalized `phone_number` for active/effective routes
- `(source_granularity, active)`
- `(validation_status, active)`
- Provider identifier indexes when those values are present

The initial release should use the existing global Call Qualification policy:

- Direction is inbound.
- Target maps to an active route.
- Call was answered.
- Answered duration is at least 120 seconds.
- Caller phone exists.

Do not put an owner-editable minimum duration on each route until the business
explicitly requires different qualification policies.

### 7.7 Add `OperationsRegistryChange`

Recommended collection: `operations_registry_changes`

Proposed fields:

```text
entity_type
entity_id
action
actor_type
actor_id
actor_label
request_id
reason
before
after
created_at
```

The Admin Dashboard's local audit log records proxied mutations, but a
server-owned registry change record is still valuable because:

- Scripts and migrations may change registry data.
- System validation may update RingCentral fields.
- The operational record should live beside the data it explains.
- Before/after state should not depend on another application's database.

Sensitive credentials and tokens must never appear in change snapshots.

## 8. Recommended module interface

Suggested folder:

```text
src/services/operationsRegistry/
  index.ts
  operationsRegistry.service.ts
  operationsRegistry.types.ts
  agentRegistry.ts
  merchantRegistry.ts
  sourceRegistry.ts
  cplSchedule.ts
  ringCentralRoutes.ts
  registryAudit.ts
```

`index.ts` should be the public import surface.

The external interface should remain compact. Example conceptual operations:

```ts
listRegistry(resource, query)
getRegistryRecord(resource, id)
createRegistryRecord(command, actor)
updateRegistryRecord(command, actor)
changeRegistryActivation(command, actor)

resolveLeadSource(input, at)
resolveCpl(sourceGranularityId, at)
resolveGranotAgentIdentity(input, at)
resolveRingCentralInboundRoute(phoneNumber, at)

validateRingCentralInboundRoute(id, actor)
previewCplCorrection(command)
applyCplCorrection(command, actor)
```

The exact TypeScript design should avoid one weak catch-all mutation payload.
Explicit command variants are preferable because Source Company, CPL, and
RingCentral activation have different invariants.

Runtime callers should not:

- Query `LeadSourceCompany` directly for attribution.
- Read `CplRate` directly.
- Import the static RingCentral number map.
- Match Granot usernames directly against `Agent`.
- Treat the compile-time `SourceCompany` union or `SOURCE_COMPANY_CONFIGS` as
  the authoritative list of active companies.

They should use the registry resolution queries.

## 9. RingCentral validation design

### 9.1 Local validation

Run before any remote request:

- Normalize phone number.
- Reject empty or invalid number.
- Confirm call granularity exists.
- Confirm channel is `call`.
- Confirm company/granularity relationship.
- Detect active/effective number conflicts.
- Confirm effective interval is valid.

### 9.2 Live RingCentral validation

The RingCentral adapter should use the existing authenticated client and inspect
the account's accessible phone-number/extension information.

Validation should answer:

- Does the authenticated account expose this number?
- What RingCentral object owns or routes it?
- Is it a company number, extension number, IVR number, or queue-associated
  number?
- What provider IDs and names can be persisted?
- Does the current JWT have sufficient organization-level visibility?

Do not assume the JWT has account-wide access merely because token exchange
succeeds. The existing RingCentral rule correctly requires account-level call
log behavior to prove organization-level access.

### 9.3 Evidence validation

Optionally scan a bounded recent Call Log window for the number:

- Last seen timestamp
- Observed `to.name`
- Observed leg structure
- Whether qualifying calls would be found

Absence of recent calls should be a warning, not necessarily an invalid result.

### 9.4 Activation policy

Recommended first policy:

- Draft creation is allowed without remote validation.
- Activation requires local validation.
- Production activation requires `validation_status=valid`.
- A warning may be activated with explicit owner confirmation and reason.
- Invalid routes cannot activate.

### 9.5 Periodic validation

Add a protected cron or scheduled validation later:

- Revalidate active routes.
- Detect numbers no longer accessible.
- Detect changed provider ownership/queue metadata.
- Record Operational Events for drift.
- Open an Operational Incident only after a meaningful repeated failure,
  following existing observability rules.

## 10. RingCentral runtime integration plan

### Shared resolver

Introduce one resolver:

```ts
resolveRingCentralInboundRoute(phoneNumber, at)
```

It returns:

```text
route ID
normalized number
Source Company ID/slug/snapshot
Source Granularity ID/key/label snapshot
CRM source label
```

### Performance strategy

Do not issue a Mongo query for every webhook party or Call Log leg.

Recommended adapters:

- Production adapter: cached active route snapshot with a short TTL and
  explicit invalidation after registry mutations.
- Test adapter: in-memory route set.

For a scheduled Call Log run, load the active route snapshot once at the start
and pass it through vetting. For webhook processing, use the cached resolver.

### Consumer cutover

Update these consumers:

1. `webhook-event-normalizer.ts`
   - Prefer normalization without business attribution, followed by resolver
     enrichment, or inject a preloaded route matcher.

2. `call-candidate-evaluator.ts`
   - Evaluate against registry-resolved route metadata.
   - Preserve the route/granularity identity in candidate/session state.

3. `call-log-vetting.ts`
   - Accept an injected route matcher or route snapshot.
   - Remove direct static-map imports.

4. `call-log-sync.service.ts`
   - Load one registry snapshot per run.
   - Avoid the current two-stage static vet plus database fallback.

5. `ringcentral-call-lead-ingest.service.ts`
   - Persist Source Company and granularity assignment snapshots from the
     resolved route.
   - Re-resolve only as a defensive guard when necessary.

6. `analytics-reconcile.service.ts`
   - Query active/effective routes instead of static object keys.

7. `webhook-subscriptions.ts`
   - Account-wide mode remains preferred and does not require one filter per
     route.
   - Per-number diagnostic mode should build filters from the registry.

### Rollout fallback

During rollout only:

- Seed database routes from the five static mappings.
- Resolve through the database first.
- Compare database and static outcomes in shadow diagnostics.
- Retain static fallback behind an explicit temporary compatibility flag.
- Remove fallback after production parity is demonstrated.

The permanent implementation must not silently accept stale static routing when
the owner has deactivated a database route.

## 11. CPL temporal behavior

### Resolution

At lead ingestion:

1. Resolve Source Company and Source Granularity.
2. Use the Lead business timestamp.
3. Find exactly one effective CPL Rate Period.
4. Apply its amount.
5. Apply duplicate rules where relevant.
6. Store amount, period ID, resolution time, and resolution version.

Possible outcomes:

- One period found: use it.
- No period found: fail closed, use explicit zero fallback, or create an
  Operational Incident according to a policy that must be decided before
  implementation.
- Multiple periods found: treat as a registry integrity error and do not choose
  arbitrarily.

Recommended policy: new paid-source Leads should not silently receive zero when
configuration is missing. Persisting the Lead while flagging a CPL resolution
incident may be safer than rejecting an inbound lead, but that trade-off needs
explicit approval.

### Owner editing workflow

The dashboard should show a timeline:

```text
Past period | Current period | Future period
```

Owner actions:

- Add future rate.
- Split current period at a chosen date.
- Correct a past period.
- Close an open-ended period.
- Archive an unused future period.

The server, not the browser, computes the final non-overlapping schedule.

### Date and timezone policy

Recommended owner UX:

- Owner enters business dates in `America/New_York`.
- Start date begins at local midnight and is inclusive.
- An owner-facing inclusive end date is converted to the next local midnight,
  stored as exclusive `effective_until`.
- Backend stores UTC instants.
- API responses include the business timezone or owner-facing dates to prevent
  off-by-one display errors.

This must be tested across daylight-saving transitions.

### Historical correction

A past correction is a separate workflow:

1. Preview matching Leads.
2. Show counts, date window, Source Granularity, old amounts, and new amounts.
3. Require a reason.
4. Apply in a durable job.
5. Update `cpl`, rate-period reference, and correction metadata.
6. Invalidate/recompute affected Analytics.
7. Schedule relevant Reporting Projections if required.
8. Record an audit change and Operational Event.

Routine rate creation must not call `updateMany` across all historical Leads.

## 12. Admin route plan

Continue to place HTTP handling under `/api/v1/admin` and keep routes thin.

Potential routes:

```text
GET    /api/v1/admin/operations-registry/overview

GET    /api/v1/admin/agents
POST   /api/v1/admin/agents
PATCH  /api/v1/admin/agents/:id
POST   /api/v1/admin/agents/:id/activation
GET    /api/v1/admin/agents/:id/granot-identities
POST   /api/v1/admin/agents/:id/granot-identities
PATCH  /api/v1/admin/agent-granot-identities/:id

GET    /api/v1/admin/merchants
POST   /api/v1/admin/merchants
PATCH  /api/v1/admin/merchants/:id
POST   /api/v1/admin/merchants/:id/activation

GET    /api/v1/admin/source-companies
POST   /api/v1/admin/source-companies
PATCH  /api/v1/admin/source-companies/:id
POST   /api/v1/admin/source-companies/:id/activation

GET    /api/v1/admin/source-granularities
POST   /api/v1/admin/source-granularities
PATCH  /api/v1/admin/source-granularities/:id
POST   /api/v1/admin/source-granularities/:id/activation

GET    /api/v1/admin/source-granularities/:id/cpl-periods
POST   /api/v1/admin/source-granularities/:id/cpl-periods
PATCH  /api/v1/admin/cpl-periods/:id
POST   /api/v1/admin/cpl-corrections/preview
POST   /api/v1/admin/cpl-corrections

GET    /api/v1/admin/ringcentral/inbound-routes
POST   /api/v1/admin/ringcentral/inbound-routes
PATCH  /api/v1/admin/ringcentral/inbound-routes/:id
POST   /api/v1/admin/ringcentral/inbound-routes/:id/validate
POST   /api/v1/admin/ringcentral/inbound-routes/:id/activation

GET    /api/v1/admin/operations-registry/changes
```

Exact route naming can be simplified during implementation. The important
point is that validation and activation are commands with meaningful outcomes,
not arbitrary PATCH fields.

All routes should use the existing Vantage auth guard and be consumed by
`vantage-admin` only through its authenticated local proxy.

## 13. Admin Dashboard plan

Recommended Settings sections:

### Agents

- Search and active/inactive filters
- Create/edit
- Granot identity list
- Verification/last observed state
- Usage counts
- Deactivation preview

### Merchants

- Existing create/edit/activate behavior
- Booking usage counts
- Deactivation preview

### Source Companies

- Company detail
- Separate granularity rows rather than one large replace-all form
- Defaults
- Alias conflict warnings
- Active/inactive state
- Links to CPL timeline and RingCentral routes

### CPL timeline

- Past/current/future visualization
- Add/split/correct flows
- Overlap validation
- Affected-lead preview
- Explicit correction reason

### RingCentral Queue Numbers

- Number and owner-facing label
- Assigned Source Company/granularity
- Active state
- Validation status
- RingCentral provider metadata
- Last validated/last observed
- Validate, activate, deactivate
- Warning/override flow

### Registry health

Overview warnings:

- Active source with missing default
- Active granularity with no current CPL period
- Overlapping or missing CPL coverage
- Active RingCentral route not recently validated
- Static/database routing drift during rollout
- Duplicate Granot identities
- Inactive Agent still configured for automatic CRM matching

## 14. Backfill and migration plan

### Phase A: inventory

Generate a read-only report containing:

- All Agents and `granot_crm_username` values
- Duplicate/ambiguous normalized Agent names
- All Merchants
- All Source Companies and embedded granularities
- Default granularity references
- Current granularities' CPL values
- Legacy `cpl_rates` values
- Static RingCentral mappings
- Embedded `inbound_phone_numbers`
- Conflicts between static and embedded mappings
- Lead counts by Source Company, granularity key, and CPL amount

No mutation should begin until this report is reviewed.

### Phase B: create new collections and indexes

Create:

- `agent_granot_identities` if approved
- `lead_source_granularities`
- `cpl_rate_periods`
- `ringcentral_inbound_routes`
- `operations_registry_changes`

Apply unique indexes only after collision reports are clean.

### Phase C: seed granularities

For every embedded granularity:

- Preserve its subdocument ObjectId if practical, or record a mapping from old
  subdocument ID/key to new ObjectId.
- Preserve `granularity_key`, labels, aliases, channel, Move Type, source sites,
  priority, and activation state.
- Update Source Company default references to first-class ObjectIds while
  retaining keys during compatibility.

### Phase D: seed CPL periods

Do not fabricate historical schedules from one current number.

Recommended migration:

- Preserve every existing Lead's `cpl` as its historical applied snapshot.
- Create one current open-ended period per active granularity beginning at the
  cutover instant, using the reviewed current registry value.
- Import known historical periods only when supported by owner-confirmed dates
  and amounts.
- Optionally attach old Leads to known periods through a reviewed correction
  job.

### Phase E: seed RingCentral routes

Seed from:

- The five static mappings
- Embedded granularity `inbound_phone_numbers`

For each number:

- Normalize.
- Detect conflicts.
- Link to one call granularity.
- Mark `created_from=legacy_seed`.
- Start as unvalidated or warning.
- Run live RingCentral validation.
- Activate only after parity is confirmed.

### Phase F: seed Granot identities

If the separate identity model is selected:

- Convert each Agent `granot_crm_username` into one identity.
- Use the known Granot origin/workspace where it can be proven.
- Flag missing workspace/origin as migration review, not an invented value.
- Keep the Agent compatibility field until all consumers cut over.

### Phase G: dual-resolution comparison

Before changing production outcomes:

- Resolve sources through legacy and registry paths.
- Resolve CPL through legacy and temporal paths.
- Resolve RingCentral numbers through static and registry paths.
- Resolve Granot Agent usernames through old and new paths.
- Record sanitized mismatches.

The comparison must not double-create Leads or duplicate side effects.

### Phase H: consumer cutover

Cut over one domain at a time:

1. Admin selectors
2. Agent Granot matching
3. Form Lead source/CPL resolution
4. Call Lead source/CPL resolution
5. Booking source snapshots
6. RingCentral Call Log
7. RingCentral webhook
8. Analytics reconciliation
9. Analytics filters and source facets
10. CRM label resolution
11. Reporting/Sheet projections
12. Static TypeScript source unions and configuration maps

### Phase I: remove compatibility

After a defined stable period:

- Remove static number fallback.
- Stop reading embedded granularity CPL.
- Stop reading legacy `cpl_rates`.
- Stop direct Agent username matching.
- Stop using `SOURCE_COMPANY_CONFIGS`, `SOURCE_LABEL_TO_COMPANY`, and static CRM
  label lists as runtime authority. Retain reviewed values only as migration
  seeds or fixtures.
- Remove unused compatibility fields only in a later migration if their audit
  value is no longer needed.

## 15. Testing strategy

The Operations Registry interface is the main test surface.

### Pure rule tests

- Phone normalization
- Alias matching and priority
- Default-granularity validation
- CPL interval overlap
- CPL interval boundary behavior
- Eastern-time date conversion
- Activation preconditions
- Agent Granot identity uniqueness

### Model/adapter tests

- Unique index behavior
- Transactional rate scheduling
- Concurrent rate edits
- Cache invalidation
- Registry snapshot loading
- Change-record redaction

### RingCentral tests

- Existing five numbers retain the same attribution.
- A new database-only number qualifies in both Call Log and webhook paths.
- A deactivated number qualifies in neither path.
- An unknown number is rejected consistently.
- Account-wide subscription mode remains valid.
- Per-number diagnostic filters come from the registry.
- Queue/Agent multi-leg aggregation retains correct target attribution.
- Validation records provider metadata without exposing tokens.

### CPL tests

- Rate changes exactly at `effective_from`.
- Exclusive `effective_until`.
- Adjacent periods do not overlap.
- DST start and end dates.
- Duplicate Call Lead zero-CPL override.
- Main Site zero-dollar schedule.
- Missing period outcome.
- Historical correction preview and apply.
- Routine future scheduling leaves old Leads unchanged.

### Consumer contract tests

- Form Lead create stores company, granularity, labels, CPL amount, and period
  snapshots.
- Call Lead create stores route-derived attribution and CPL snapshots.
- Booking mirrors retain source snapshots.
- Deactivated catalog values remain displayable on historical records.
- Admin options exclude inactive values for new workflows.

### Migration tests

- Re-running seed/backfill is idempotent.
- Static and registry routing parity.
- Embedded-to-first-class granularity mapping is complete.
- Counts and identifiers are stable.
- A partial migration resumes safely.
- No migration code contacts production integrations during dry-run.

## 16. Observability and operational safety

Record Operational Events for:

- Registry mutation failure
- CPL schedule integrity failure
- CPL resolution missing or ambiguous
- RingCentral route validation failure
- Static/database shadow mismatch
- Registry cache refresh failure
- Migration/backfill run summaries

Registry writes should fail clearly if their own audit record cannot be
persisted when auditability is part of the transaction. Runtime lead ingestion,
however, must have an explicitly chosen failure posture when registry resolution
is temporarily unavailable.

Recommended runtime resilience:

- Cached last-known-valid registry snapshot for RingCentral matching.
- Bounded cache age.
- Operational warning when stale fallback is used.
- No hidden fallback to compile-time mappings after final cutover.

## 17. Security considerations

- Admin mutations require existing protected admin access.
- Do not expose Vantage API secrets to browser code.
- Do not store RingCentral JWT, client secret, access token, or refresh token in
  registry documents or audit snapshots.
- Sanitize remote validation errors before returning them to the dashboard.
- Audit activation overrides.
- Treat bulk CPL correction as a high-risk action requiring preview and
  confirmation.
- Do not allow spreadsheet or extension callers to mutate registry records
  unless explicitly authorized with a narrow scope.

## 18. Suggested implementation phases for the week

### Work package 1: decisions and inventory

- Confirm Granot identity cardinality.
- Confirm CPL date UX and missing-rate posture.
- Confirm RingCentral activation override policy.
- Generate registry inventory/collision report.
- Approve target models.

Exit condition: no unresolved identity or uniqueness assumption blocks schema
work.

### Work package 2: first-class granularities and registry interface

- Add `LeadSourceGranularity`.
- Add registry interface and explicit activation commands.
- Backfill in test mode.
- Migrate Source Company reads behind the interface.
- Keep compatibility snapshots.

Exit condition: existing Source Company resolution tests pass through the new
interface with legacy parity.

### Work package 3: temporal CPL

- Add `CplRatePeriod`.
- Implement schedule validation and resolution.
- Add lead snapshot references.
- Implement dashboard timeline and future scheduling.
- Disable automatic historical bulk rewrite for normal edits.

Exit condition: a lead on either side of a rate transition receives the correct
snapshot, and prior Leads remain unchanged.

### Work package 4: RingCentral inbound routes

- Add model, routes, dashboard UI, validation adapter, and cache.
- Seed five existing numbers.
- Shadow-compare outcomes.
- Cut over Call Log, webhook, analytics, and diagnostic filters.

Exit condition: all qualification paths agree and a database-only test number
can be exercised safely without static configuration.

### Work package 5: Agent Granot identities and audit hardening

- Implement the approved mapping shape.
- Cut over extension/server matching.
- Add registry change records and usage/deactivation previews.
- Remove superseded compatibility reads after validation.

Exit condition: Agent resolution is deterministic, audited, and supports the
confirmed Granot identity model.

## 19. Acceptance criteria

The Operations Registry initiative is complete when:

- The owner can manage Agents, Merchants, Source Companies, granularities, CPL
  periods, and RingCentral Queue Numbers from the dashboard.
- Moving Carriers remain unaffected.
- Every active RingCentral number is database-backed and validated.
- Webhook and Call Log qualification use the same registry resolver.
- No production qualification path depends on the static number map.
- CPL is resolved by Lead timestamp through a non-overlapping effective
  schedule.
- Editing a current/future rate does not rewrite historical Leads.
- Historical corrections are previewable and audited.
- Granot Agent matching uses the approved mapping model.
- Deactivation prevents new use while preserving existing records.
- Registry changes have an operational audit trail.
- Backfills are idempotent and have reviewed dry-run reports.
- Focused tests, typecheck, and production shadow comparisons are clean.

## 20. Open decisions

These decisions should be resolved before or during Work Package 1:

1. Can one Agent have multiple Granot usernames?
2. Does Granot identity vary by CRM origin or workspace?
3. Is a stable Granot user ID available in DOM or CSV data?
4. Should Source Granularity remain the owner-facing label?
5. What happens when a paid-source Lead has no effective CPL period?
6. Does the owner enter an inclusive CPL end date in the dashboard?
7. Can a future RingCentral route be scheduled?
8. May the owner activate a warning-state route with an override?
9. Is the 120-second qualification threshold global for the foreseeable future?
10. Should edits to RingCentral routing affect calls by call start time,
    terminal time, or ingestion time? Recommended: call start time with stored
    route snapshots.
11. Must Agent/Merchant deactivation require a reason?
12. How long should shadow comparison run before static fallbacks are removed?
