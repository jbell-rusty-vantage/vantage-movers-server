# Operations Registry Data Model, API, and Runtime Contracts

Status: Target technical contract
Date: 2026-07-28

## 1. Module boundary

Create `src/services/operationsRegistry/` as the public domain boundary.
Routes, ingestion services, Analytics, CRM, Sheet Sync, and dashboard catalog
reads must use its exported commands and queries rather than importing registry
models directly.

Suggested public surface:

```ts
// Queries/resolvers
getRegistryOverview()
listRegistryAgents()
listRegistryMerchants()
listSourceCompanies()
listSourceGranularities()
resolveSourceAttribution(input)
resolveCpl(input)
loadRingCentralRouteSnapshot()
resolveRingCentralInboundRoute(snapshot, phoneNumber, callStartedAt)
resolveAgentByGranotUsername(username)
previewRegistryDependency(input)
listRegistryChanges(input)

// Owner commands
createOrUpdateAgent(command, actor)
setAgentActivation(command, actor)
createOrUpdateMerchant(command, actor)
setMerchantActivation(command, actor)
createOrUpdateSourceCompany(command, actor)
setSourceCompanyActivation(command, actor)
createOrUpdateSourceGranularity(command, actor)
setSourceGranularityActivation(command, actor)
applySimpleCplSchedule(command, actor)
mutateAdvancedCplSchedule(command, actor)
createCplCorrection(command, actor)
createOrUpdateRingCentralRoute(command, actor)
validateRingCentralRoute(command, actor)
activateRingCentralRoute(command, actor)
deactivateRingCentralRoute(command, actor)
reassignRingCentralRoute(command, actor)
```

Commands return typed domain conflicts and validation errors. HTTP routes remain
thin adapters.

## 2. Existing collection changes

### `agents`

Retain existing ObjectIds and fields. Add:

```text
name_aliases                    string[] normalized lookup aliases
archived_at                    Date optional
deactivation_reason            string optional
granot_identity
  username                     string uppercase immutable once configured
  verified                     boolean
  verified_at                  Date optional
  last_observed_at             Date optional
```

Indexes:

- unique `normalized_name`;
- sparse unique `granot_identity.username`;
- multikey lookup on `name_aliases`.

Compatibility:

- retain `granot_crm_username`;
- migration copies its normalized value into `granot_identity.username`;
- registry writes treat the subdocument as authoritative;
- compatibility reads may fall back to the flat field until every consumer is
  migrated;
- ordinary APIs cannot change or remove a configured username.

### `merchants`

Retain existing ObjectIds and add:

```text
name_aliases                    string[]
archived_at                    Date optional
deactivation_reason            string optional
```

Booking documents continue storing the existing merchant string snapshot. No
Booking reference migration is required.

### `lead_source_companies`

Retain the collection and ObjectIds. Target fields:

```text
company_slug                    immutable unique string
name
owner_label
aliases
active
archived_at
deactivation_reason             optional
default_form_granularity        ObjectId optional
default_call_granularity        ObjectId optional
default_form_granularity_key    compatibility string
default_call_granularity_key    compatibility string
sheet_config
  spreadsheet_id               optional string
  has_bad_tabs                  boolean
  projection_mode              "derived_import" | "direct_write"
created_from
```

The existing embedded `granularities[]` array remains temporarily as migration
compatibility data. It is not a permanent second authority. New registry
commands mutate first-class granularities only after cutover.

## 3. New collections

### `lead_source_granularities`

```text
_id                             preserve embedded subdocument ID when possible
source_company                  ObjectId -> LeadSourceCompany
granularity_key                 immutable globally unique string
channel                         "form" | "call"
owner_label
crm_label
aliases                         normalized fallback labels
active
activated_at                    optional Date
archived_at                     optional Date
deactivation_reason             optional string
local                           "local" | "long_distance" optional
source_sites                    normalized exact identifiers
priority                        integer
sheet_tab_name                  optional string
schedule_revision               non-negative integer
created_from
createdAt / updatedAt
```

Indexes:

- unique `granularity_key`;
- `(source_company, channel, active)`;
- normalized exact CRM-label lookup;
- normalized source-site lookup;
- `(source_company, priority)`.

Exact collision checks occur in registry activation commands because active
partial uniqueness across arrays and channel-dependent semantics cannot all be
expressed safely as simple Mongo unique indexes.

### `cpl_rate_periods`

```text
_id
source_granularity              ObjectId -> LeadSourceGranularity
amount_cents                    non-negative integer
effective_from                  UTC Date inclusive
effective_until                 UTC Date exclusive optional
effective_from_date             YYYY-MM-DD in America/New_York
effective_until_date_exclusive  YYYY-MM-DD optional
business_timezone               fixed "America/New_York"
schedule_revision               integer
supersedes                      ObjectId optional
change_reason                   optional string
archived_at                     optional Date
created_by                      actor snapshot
createdAt / updatedAt
```

Indexes:

- `(source_granularity, effective_from)`;
- `(source_granularity, effective_until)`;
- `(source_granularity, archived_at)`.

Mongo indexes do not guarantee interval non-overlap. A schedule command:

1. starts a transaction;
2. reads the granularity and expected `schedule_revision`;
3. loads all non-archived periods;
4. constructs and validates the entire resulting schedule in memory;
5. compares-and-increments `schedule_revision`;
6. writes period changes and the registry audit record;
7. commits;
8. invalidates relevant caches.

A stale revision returns HTTP `409` with the current revision and schedule.

### `ringcentral_inbound_routes`

```text
_id
provider                        fixed "ringcentral"
phone_number                    normalized string
phone_locked                    boolean after first activation
display_label
active
ever_activated
archived_at                     optional Date
deactivation_reason             optional string

ringcentral_phone_number_id     optional string
ringcentral_extension_id        optional string
ringcentral_queue_id            optional string
ringcentral_queue_name          optional string
observed_target_names           string[]

validation_status               "unvalidated" | "valid" | "invalid"
validation_code                 optional safe code
validation_message              optional sanitized message
validated_at                    optional Date
validated_by                    optional actor snapshot
last_seen_in_call_log_at        optional Date
last_seen_in_webhook_at         optional Date

created_from
created_by
createdAt / updatedAt
```

Indexes:

- unique `phone_number`;
- `(active, validation_status)`;
- sparse provider-ID indexes.

A failed draft remains editable. An ever-activated route's phone is immutable.

### `ringcentral_inbound_route_assignments`

Assignment history is separate from route identity:

```text
_id
route                           ObjectId -> RingCentralInboundRoute
source_company                  ObjectId -> LeadSourceCompany
source_granularity              ObjectId -> LeadSourceGranularity
effective_from                  Date inclusive
effective_until                 Date exclusive optional
active
created_by
change_reason                   optional
createdAt / updatedAt
```

The dashboard does not schedule future assignments. Activation/reassignment
opens an interval at command time; deactivation/reassignment closes the current
interval at the same instant.

Indexes:

- `(route, effective_from)`;
- `(route, effective_until)`;
- partial unique open assignment per route where practical;
- `(source_granularity, active)`.

The transaction enforces one open assignment per route. Globally unique route
phone identity enforces one granularity per number at an instant. Multiple
routes may point to one granularity.

### `operations_registry_changes`

```text
_id
entity_type
entity_id
action
actor_type
actor_id
actor_label
actor_role
request_id
reason                          optional
before                          sanitized snapshot
after                           sanitized snapshot
metadata                        sanitized command metadata
created_at
```

Indexes:

- `(entity_type, entity_id, created_at desc)`;
- `(actor_id, created_at desc)`;
- unique/lookup `request_id` as appropriate.

Registry mutation and audit insert share a transaction. Audit insert failure
fails the mutation.

### `cpl_correction_jobs`

```text
_id
source_granularity
window_from
window_until
target_schedule_revision
preview_hash
status                          pending | processing | completed | failed | cancelled
requested_by
reason                          optional
matched_count
changed_count
no_op_count
failed_count
cursor                          resumable lead cursor optional
leased_until                    optional
lease_owner                     optional
last_error                      sanitized optional
started_at
completed_at
createdAt / updatedAt
```

Jobs process bounded batches and compare current Lead state before writing.
Re-running a completed batch is a no-op. The preview hash prevents applying a
materially changed selection without a new preview.

## 4. Lead schema additions

Add the following to both production `FormLead` and `CallLead` only:

```text
cpl_rate_period                 ObjectId optional
cpl_resolution_status           "resolved" | "missing_rate" |
                                "duplicate_zero" | "not_applicable"
cpl_resolved_at                 Date optional
cpl_resolution_version          string optional
cpl_correction
  job_id                        ObjectId optional
  corrected_at                  Date optional
  previous_cpl                  number optional
```

Do not modify `src/models/historical/FormLead.ts` or
`src/models/historical/CallLead.ts`.

For RingCentral-created Call Leads also retain:

```text
ringcentral.route_id
ringcentral.route_assignment_id
ringcentral.target_phone_number
```

Existing company/granularity IDs and label snapshots remain.

## 5. API contract

All paths remain behind `/api/v1/admin` and the dashboard proxy.

### Overview and audit

```text
GET /api/v1/admin/operations-registry/overview
GET /api/v1/admin/operations-registry/changes
GET /api/v1/admin/operations-registry/health
```

Overview returns counts and high-level health. Health returns typed findings
with entity links and remediation actions. Audit supports entity, actor, action,
and date filters.

### Agents and Merchants

Retain existing list/detail/create/update paths but move mutations through
registry commands:

```text
GET   /api/v1/admin/agents
POST  /api/v1/admin/agents
PATCH /api/v1/admin/agents/:id
POST  /api/v1/admin/agents/:id/activation
GET   /api/v1/admin/agents/:id/dependencies

GET   /api/v1/admin/merchants
POST  /api/v1/admin/merchants
PATCH /api/v1/admin/merchants/:id
POST  /api/v1/admin/merchants/:id/activation
GET   /api/v1/admin/merchants/:id/dependencies
```

List routes support `include_inactive=true`. Owner selection APIs return active
records by default and annotate inactive records when explicitly included.

### Sources

```text
GET   /api/v1/admin/source-companies
POST  /api/v1/admin/source-companies
PATCH /api/v1/admin/source-companies/:id
POST  /api/v1/admin/source-companies/:id/activation
GET   /api/v1/admin/source-companies/:id/dependencies

GET   /api/v1/admin/source-granularities
POST  /api/v1/admin/source-granularities
PATCH /api/v1/admin/source-granularities/:id
POST  /api/v1/admin/source-granularities/:id/activation
GET   /api/v1/admin/source-granularities/:id/dependencies
POST  /api/v1/admin/source-resolution/preview
```

Activation accepts replacements for affected defaults in the same command.
Source-resolution preview reports exact match, fallback match, and conflicts.

### CPL

```text
GET  /api/v1/admin/cpl/snapshot
POST /api/v1/admin/cpl/simple-schedule

GET  /api/v1/admin/source-granularities/:id/cpl-periods
POST /api/v1/admin/source-granularities/:id/cpl-schedule/commands

POST /api/v1/admin/cpl-corrections/preview
POST /api/v1/admin/cpl-corrections
GET  /api/v1/admin/cpl-corrections/:id
POST /api/v1/admin/cpl-corrections/:id/cancel
```

Simple schedule request:

```json
{
  "effective_date": "2026-07-28",
  "expected_revisions": {
    "<granularity-id>": 4
  },
  "changes": [
    {
      "source_granularity_id": "<granularity-id>",
      "amount": 195
    }
  ]
}
```

The server ignores unchanged rows and applies changed schedules atomically.

Advanced schedule commands are explicit discriminated operations such as
`add_future`, `split`, `replace_schedule`, and `correct_period`. The browser
does not PATCH interval fields independently.

The old `/api/v1/admin/cpl-rates` endpoints remain read-only compatibility
during migration, then are removed after all consumers cut over. The old update
path must stop rewriting Leads before the new editor becomes authoritative.

### RingCentral

```text
GET   /api/v1/admin/ringcentral/inbound-routes
POST  /api/v1/admin/ringcentral/inbound-routes
PATCH /api/v1/admin/ringcentral/inbound-routes/:id
POST  /api/v1/admin/ringcentral/inbound-routes/:id/validate
POST  /api/v1/admin/ringcentral/inbound-routes/:id/activate
POST  /api/v1/admin/ringcentral/inbound-routes/:id/deactivate
POST  /api/v1/admin/ringcentral/inbound-routes/:id/reassign
GET   /api/v1/admin/ringcentral/inbound-routes/:id/dependencies
```

Validation executes outside a Mongo transaction, sanitizes provider errors,
then transactionally stores the result plus registry change. Activation
rechecks that validation is current and valid.

## 6. Error contract

Use stable codes:

```text
REGISTRY_FORBIDDEN
REGISTRY_NOT_FOUND
REGISTRY_IMMUTABLE_FIELD
REGISTRY_DUPLICATE_IDENTIFIER
REGISTRY_AMBIGUOUS_RESOLUTION
REGISTRY_DEPENDENCY_CONFLICT
REGISTRY_STALE_REVISION
CPL_SCHEDULE_GAP
CPL_SCHEDULE_OVERLAP
CPL_MISSING_RATE
CPL_PREVIEW_STALE
RINGCENTRAL_ROUTE_UNVALIDATED
RINGCENTRAL_ROUTE_INVALID
RINGCENTRAL_VALIDATION_UNAVAILABLE
```

Conflict responses include safe remediation data. Provider credentials and raw
remote bodies are never returned.

## 7. Trusted actor contract

The dashboard already forwards admin identity headers, but registry mutations
must cryptographically authenticate them.

Add a shared signing configuration, for example:

```text
VANTAGE_ADMIN_PROXY_SIGNING_SECRET
```

The dashboard signs a canonical payload containing admin ID, normalized email,
role, request timestamp, request ID, method, and path. The server:

- verifies the HMAC/signature;
- enforces a short timestamp window;
- rejects missing/invalid owner actor context on registry mutation routes;
- permits read routes according to role;
- records the verified actor snapshot.

The signing secret is server-only in both deployments and is never exposed to
browser code. Rotation/dual-secret support should be documented if needed.

## 8. Dashboard contract

Settings becomes an Operations Registry workspace with:

- Registry Overview/Health
- Source Companies
- Source Granularities
- CPL Simple Mode
- CPL Advanced Mode
- RingCentral Queue Numbers
- Agents
- Merchants
- Registry Changes

Shared UI behavior:

- active-only by default;
- explicit “Show inactive” control;
- inactive warning on explicit selection;
- dependency preview before deactivation;
- optional reason;
- no delete action;
- immutable keys rendered read-only after lock;
- server conflict details rendered inline;
- mutations invalidate registry, catalog, facets, Analytics filter, and relevant
  detail queries.

The existing source-company replace-all granularity editor must be replaced
with row/detail commands against first-class granularity IDs.

Simple CPL Mode is a table plus one effective date and one atomic Update
button. Advanced Mode is a timeline/editor with schedule revision handling.

RingCentral UI distinguishes:

- draft/unvalidated;
- invalid with actionable message;
- valid/inactive;
- valid/active.

Recent call evidence is displayed separately from validation.

## 9. Runtime consumer contract

### Source attribution

`resolveSourceAttribution` returns:

```text
company ID/slug/label snapshot
granularity ID/key/label snapshot
CRM label snapshot
match kind (exact/default/fallback)
registry revision
```

Form Lead, Call Lead, booking source resolution, CRM Posting, filters, and
Analytics use this contract or stored snapshots.

### CPL

`resolveCpl` receives a first-class granularity ID and Lead business timestamp.
It returns a discriminated result:

```ts
{ status: "resolved"; amount: number; amount_cents: number; period_id: string }
{ status: "missing_rate"; fallback_amount: 0 }
{ status: "duplicate_zero"; amount: 0; base_period_id?: string }
{ status: "not_applicable"; amount: 0 }
```

No caller queries `cpl_rates` or embedded `granularity.cpl` after cutover.

### RingCentral

`resolveRingCentralInboundRoute(snapshot, phone, at)` returns:

```text
route ID
assignment ID
normalized target number
company ID/slug/label snapshot
granularity ID/key/label snapshot
CRM label snapshot
```

Unknown/inactive-at-call-time numbers do not qualify. Webhook normalization
should preserve telephony facts first, then qualification uses the shared
resolver. Scheduled Call Log sync loads one snapshot at run start.

### Agent matching

Granot username normalization has one shared implementation. Matching queries
the embedded identity, respects active-only automatic behavior, and retains a
temporary legacy-field fallback until migration verification passes.
