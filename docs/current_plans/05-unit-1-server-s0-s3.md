# Implementation Unit 1 — Server Foundation, Catalogs, and Sources (S0–S3)

Status: Execution brief derived from the approved Operations Registry plan
Date: 2026-07-29
Repository: `vantage-main-server`
Work packages: S0, S1, S2, S3

## 1. Purpose and authority

This unit establishes the production-safe inventory, the Operations Registry
module seam, trusted dashboard actor verification, transactional audit, Agent
and Merchant lifecycle behavior, and first-class Source Granularities.

Read the following before implementation:

1. [Current plan index](./index.md)
2. [Operations Registry specification](./01-operations-registry-specification.md)
3. [Data model, API, and runtime contracts](./02-data-model-api-and-runtime-contracts.md)
4. [Implementation plan](./03-implementation-plan.md), especially S0–S3
5. [Migration, testing, rollout, and rollback](./04-migration-testing-rollout.md),
   especially M0–M3
6. Repository `AGENTS.md`, `CLOUD_AGENTS.md`, `.cursor/rules/`, and relevant
   `.cursor/businesslogic/` documents

The four earlier numbered plan documents remain authoritative. This brief adds
file-level execution context; it does not relax their invariants. If current
code conflicts with the approved contracts, implement the contract or stop for
an owner decision rather than preserving accidental behavior.

## 2. Unit outcome and sequence

Complete these packages in order:

```text
S0 inventory
  -> S1 registry foundation, trusted actor, audit
      -> S2 Agent/Merchant registry
      -> S3 first-class Source Granularities
```

S0 is read-only and produces evidence used by later migration work. S1 owns
shared interfaces and must merge before S2/S3. S3 is the schema seam required
by S4 and S6; do not start those packages from a branch that lacks merged S3.

Use the package branches from `03-implementation-plan.md`, based on the current
`feature/operations-registry` integration head. Record branch, base SHA, and
pre-existing working-tree changes before edits. Each S package receives its own
handoff and merge gate even when one agent executes the whole unit.

## 3. Shared boundaries

- Only production-domain models backed by `vantagemovers` are in scope.
- Never import or modify `src/models/historical/*`.
- Never connect an inventory or migration script to
  `vantagemovershistorical`.
- All scripts are dry-run by default. An apply mode requires the explicit
  guards in `04-migration-testing-rollout.md`; S0 itself has no apply mode.
- Keep HTTP routes thin. Registry behavior belongs behind
  `src/services/operationsRegistry/`.
- Routes, runtime consumers, and dashboard catalog reads must use exported
  registry commands/queries after their cutover, not registry models directly.
- Mongo mutations and `operations_registry_changes` inserts share a transaction.
- Cache invalidation occurs only after commit.
- Plain `x-vantage-admin-*` headers are not trusted actor proof.
- Preserve extension-facing server contracts; the Granot extension repository
  is outside this initiative.
- No hard delete is introduced.

## 4. S0 — Inventory and contract verification

### Deliverable

Add a deterministic, redacted, read-only Operations Registry inventory script
and manifest format. It must report:

- Agent names, normalized-name collisions, active state, and Granot usernames;
- Merchant records and distinct production `BookedLead` merchant snapshots;
- Source Companies, embedded granularities, defaults, IDs, labels, aliases,
  source sites, tabs, and inbound phone metadata;
- embedded CPL values and `cpl_rates`, including disagreements;
- production Form/Call Lead counts grouped by source, granularity, and CPL;
- static and embedded RingCentral numbers and assignment conflicts;
- exact/fallback alias, CRM-label, source-site, and phone collisions;
- code references where static source unions/maps act as runtime authority.

The durable output follows the manifest shape in
`04-migration-testing-rollout.md`: run identity, git SHA, database name, mode,
counts, creates/updates/no-ops/conflicts (planned values are zero for S0),
checksum, validation summary, and completion metadata.

### Existing files to inspect

- `src/models/Agent.ts`
- `src/models/Merchant.ts`
- `src/models/LeadSourceCompany.ts`
- `src/models/CplRate.ts`
- `src/models/FormLead.ts`
- `src/models/CallLead.ts`
- `src/models/BookedLead.ts`
- `src/config/domain/sources.ts`
- `src/config/domain/cplRateDefinitions.ts`
- `src/services/leadSourceCompanies/leadSourceCompany.service.ts`
- `src/services/cpl/cplRate.service.ts`
- `src/services/ringcentral/call-lead-sources.ts`
- `src/services/agents/receiverAgentCrmUsername.ts`
- `scripts/dev_ops/backfill-agent-granot-crm-usernames.ts`
- `src/services/employeeBookings/migrationApplySafety.ts`
- `src/services/employeeBookings/migrationPreflight.ts`
- `src/services/bestRelocationSheetIngest/dryRun.ts`

There is no existing `scripts/migrations/` implementation. Create an explicit
location such as `scripts/migrations/operations-registry-inventory.ts`; do not
assume paths from older handoffs exist.

### Verification and exit

- Run against test fixtures or a safe non-production copy first.
- Prove the script has no write methods and no apply flag.
- Repeated unchanged input produces stable categorized output/checksum.
- Database-name guard rejects historical and unknown targets.
- Output contains no secret, token, raw provider body, or unnecessarily
  sensitive lead/customer value.
- Categorize every collision as blocking or reviewable.
- Do not resolve production data conflicts in this package.

## 5. S1 — Registry foundation, signed actor, and audit

### Module interface

Create `src/services/operationsRegistry/` as the public domain module described
in `02-data-model-api-and-runtime-contracts.md`. Start with shared command/query
types, stable errors, actor context, transaction/audit support, sanitization,
cache invalidation interface, and overview/health/change queries. Keep internal
model adapters private to the module where practical.

Add stable registry codes to the existing error system:

- `src/services/errors/index.ts`
- `src/services/errors/errorCodes.ts`
- `src/services/v1ServiceError.ts` or the current HTTP error adapter

Add `OperationsRegistryChange` under `src/models/` with the fields/indexes in
the contract. Reuse the transaction capability in `src/db.ts`; do not open a
second connection. Audit insertion failure must abort the domain mutation.
Reuse observability sanitization ideas from:

- `src/services/observability/index.ts`
- `src/services/observability/operationalEventSanitizer.ts`

Registry Changes are authoritative mutation history. `OperationalEvent` is for
actionable failure/drift, not routine successful edits.

### Trusted actor contract

Implement canonical HMAC verification for admin ID, normalized email, role,
timestamp, request ID, HTTP method, and path using the coordinated
`VANTAGE_ADMIN_PROXY_SIGNING_SECRET`. Enforce a short replay window and
constant-time signature comparison. Registry mutations require a verified
Owner. Approved authenticated dashboard roles may read.

Relevant current behavior:

- `src/middleware/requireApiSecret.ts` proves server-to-server API access but
  does not prove the dashboard actor.
- `src/services/employeeBookings/reconciliationPolicy.ts` derives an Owner
  from unsigned headers and is not sufficient for registry mutation.
- `src/routes/v1.routes.ts` contains current admin route and owner checks.

Keep the preview compatibility flag narrowly scoped and fail closed for
production registry mutations. Coordinate header names, canonicalization,
clock window, and secret configuration with D0 before enforcement.

### HTTP and tests

Add thin routes for:

```text
GET /api/v1/admin/operations-registry/overview
GET /api/v1/admin/operations-registry/health
GET /api/v1/admin/operations-registry/changes
```

Test valid Owner mutation context, admin read-only access, wrong role, missing,
expired, tampered, replayed/mismatched method/path signatures, audit rollback,
snapshot redaction, request correlation, and post-commit invalidation.

## 6. S2 — Agent and Merchant registry

### Schema and behavior

Modify only the existing canonical models:

- `src/models/Agent.ts`
- `src/models/Merchant.ts`

Add aliases/lifecycle fields and embedded `granot_identity` exactly as specified.
Retain existing ObjectIds, Booking merchant strings, and
`granot_crm_username`. Registry writes make the embedded identity authoritative;
compatibility reads may temporarily fall back to the flat field.

Build commands/queries behind the registry interface for create/rename,
activation/deactivation, dependency preview, active-only automatic selection,
and explicit include-inactive Owner workflows.

### Existing seams and consumers

- `src/services/catalog/catalog.service.ts` and its tests: current CRUD and
  normalization behavior to migrate behind registry commands.
- `src/services/agents/agentName.ts`: shared name normalization.
- `src/services/agents/receiverAgentCrmUsername.ts`: centralize uppercase
  username normalization and switch automatic matching to active Agents only.
- `src/services/agents/agentAllocation.service.ts`: booking selection behavior.
- `src/services/enrichment/callLeadEnrichmentRows.ts`
- `src/services/reconciliation/bookedCallLeadRows.ts`
- `src/validation/v1/admin.validation.ts`
- `src/routes/v1.routes.ts`
- `.cursor/businesslogic/catalog.service.md`

Preserve current list/detail/create/update URLs and add activation/dependency
URLs from the API contract. A configured Granot username is immutable through
ordinary PATCH. Former normalized names become aliases. Duplicate normalized
canonical names and duplicate Granot usernames return stable conflicts.

The compatibility migration is idempotent and follows M2. Do not invent
verification dates or rewrite Booking snapshots.

### Exit behavior

- Automatic Granot receiver matching excludes inactive Agents.
- Explicit Owner correction/booking may retain or choose inactive catalog
  values with a warning supplied by the dashboard.
- Default list/select results are active-only; `include_inactive=true` is
  explicit.
- Deactivation reports dependencies and never hard-deletes.
- Existing extension endpoints and payloads remain compatible.

## 7. S3 — First-class Source Granularities

### Schema and migration

Add `src/models/LeadSourceGranularity.ts` and update
`src/models/LeadSourceCompany.ts` to the target contract. Preserve embedded
granularity `_id` values when valid and unique. Add ObjectId defaults while
retaining compatibility keys. Add `sheet_config.projection_mode`, defaulting to
`derived_import`.

Create an idempotent M3 seed/backfill script with dry-run default, stable
mapping manifest, database guard, collision report, and resumability. It must
not remove or rewrite embedded arrays. Once cut over, embedded arrays are
read-only compatibility data and not a second writable authority.

### Commands and resolver

Implement Source Company and first-class Source Granularity commands, lifecycle
invariants, dependency preview, source-resolution preview, and
`resolveSourceAttribution` behind the registry interface.

Exact identifiers fail on ambiguity. Fallback aliases use priority and fail on
equal-priority ambiguity while recording an Operational Event. Defaults must
belong to the same company and channel and point to active granularities.
Deactivating a default requires a same-command replacement or removal of all
automatic use for that channel.

### Existing files and compatibility consumers

- `src/services/leadSourceCompanies/leadSourceCompany.service.ts`
- `src/services/leadSourceCompanies/leadSourceCompany.service.test.ts`
- `src/services/leads/leadSourceCompany.ts`
- `src/services/leads/leadSourceCompatibility.ts`
- `src/services/leads/leadSourceCompatibility.test.ts`
- `src/config/domain/sources.ts`
- `src/services/leads/formLead.service.ts`
- `src/services/leads/callLead.service.ts`
- `src/services/bookings/bookingSourceResolver.ts`
- `src/services/crm/formLeadPayload.ts`
- `src/services/googleSheets/targets.ts`
- `src/services/googleSheets/projections/formLeadRow.ts`
- `src/services/googleSheets/projections/callLeadRow.ts`
- `src/validation/v1/admin.validation.ts`

Do not preserve the current replace-all embedded-array mutation interface as a
second authority. Add the Source Company, Source Granularity, dependency, and
resolution-preview endpoints defined in the contract.

Static `src/config/domain/sources.ts` values may remain temporarily as
seeds/fixtures, but an Owner-created company/granularity must pass registry
validation and resolve without a compile-time union rejection.

Sheet metadata storage does not enable direct source-sheet writes.
`direct_write` requires explicit complete validated mapping. Master Leads and
current derived-import behavior remain unchanged.

### Contract parity gate

- Preserve every existing source-resolution fixture outcome unless the fixture
  represents a now-blocking ambiguity.
- Test exact, default, fallback, equal-priority ambiguity, inactive records,
  defaults, key immutability, channel lock after activation/use, and dynamic
  owner-created sources.
- Verify one first-class record per embedded record and stable default mapping.
- Confirm no consumer in this package imports a new registry model directly.

## 8. Required verification

During each package, run focused tests using the project setup, for example:

```text
node --import tsx --import ./scripts/test-setup.ts --test "<focused-test>.test.ts"
pnpm typecheck
```

At the unit integration gate run:

```text
pnpm typecheck
pnpm test
```

Transaction tests require a replica-set MongoDB and `TEST_MODE=true`. Keep
Sheet Sync disabled when external credentials are irrelevant. External
providers remain mocked.

## 9. Unit completion evidence

The coordinator must have:

- separate S0, S1, S2, and S3 handoffs using the template in
  `03-implementation-plan.md`;
- S0 inventory manifest/checksum and categorized unresolved conflicts;
- signed actor contract shared with D0 without secret values;
- schema/index list and collision prerequisites;
- M2/M3 dry-run manifests and idempotency results;
- source-resolution parity results;
- focused and full verification results;
- confirmation that historical models/database and the extension repository
  were untouched;
- compatibility fields/read paths still present and their retirement owner;
- merge SHAs on the server integration branch.

Unit 1 is complete only after S3 is merged and the integration branch passes
its tests. The next eligible server work is Unit 2 (S4–S5) and, from the same
S3 integration head, Unit 3's S6 package.
