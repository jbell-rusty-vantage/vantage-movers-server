# Implementation Unit 4 — Server Hardening and Compatibility Retirement (S8)

Status: Execution brief derived from the approved Operations Registry plan
Date: 2026-07-29
Repository: `vantage-main-server`
Work package: S8

## 1. Purpose and entry gate

This unit completes Registry Health, makes cache/compatibility behavior
observable, retires legacy writable authorities, verifies the integrated server
implementation, and dry-runs the migration/runbook evidence required for
cross-repository acceptance.

Begin only after S0–S7 are merged into `feature/operations-registry` and their
handoffs are available. Read all files in `docs/current_plans/`, with particular
attention to:

- S8 and cross-repository acceptance in `03-implementation-plan.md`;
- M7, testing, deployment, verification, rollback, and final evidence in
  `04-migration-testing-rollout.md`;
- acceptance criteria in `01-operations-registry-specification.md`;
- final public interfaces/errors in
  `02-data-model-api-and-runtime-contracts.md`.

Also read repository `AGENTS.md`, `CLOUD_AGENTS.md`, all relevant rules and
business-logic docs, and the S0–S7 handoffs. Do not infer a completed behavior
from a merged branch; verify it.

## 2. Scope boundary

S8 may remove/demote legacy runtime reads and writes only where the approved
cutover evidence exists. It must not:

- delete embedded Source Company granularity arrays;
- delete `granot_crm_username`, compatibility default keys, `cpl_rates`, or
  other retained legacy fields/collections in this initiative;
- import/modify historical models or connect to the historical database;
- perform a production apply, provider call, push, deploy, or merge to `main`
  without explicit owner authorization;
- weaken verified Owner mutation authorization to accommodate an old dashboard;
- add a silent static RingCentral fallback.

Emergency rollback is code deployment to a prior compatible version, not
destructive reverse migration.

## 3. Registry Health completeness

Complete typed findings and remediation metadata for at least:

- missing and ambiguous source resolution;
- exact identifier, fallback priority, and alias conflicts;
- active granularities without continuous CPL coverage;
- production Leads saved with unresolved CPL;
- CPL correction failures/stalled leases;
- RingCentral validation failures;
- active route/assignment inconsistencies;
- stale/failed registry cache refresh;
- migration/backfill conflicts and outcomes;
- remaining compatibility reads after expected cutover.

Health findings include stable type/code, severity, affected entity identity,
safe evidence, entity/remediation links, first/last observed times where
appropriate, and whether the finding is currently actionable. Do not include
secrets, raw provider payloads, or unnecessary Lead/customer data.

Registry Health does not replace Workflow Observational. Operational Events
remain the durable evidence for actionable failures/drift; health aggregates
registry-specific current findings.

Relevant patterns/files:

- `src/models/OperationalEvent.ts`
- `src/services/observability/index.ts`
- `src/services/observability/adminObservability.service.ts`
- `src/services/observability/operationalEventSanitizer.ts`
- Operations Registry overview/health queries created in S1

## 4. Cache and compatibility telemetry

Expose enough metrics/events to answer:

- when each registry snapshot was last loaded successfully;
- current age and configured maximum age;
- refresh attempts/failures and last safe error code;
- whether a bounded stale snapshot is serving;
- affected resolver (source, CPL, RingCentral);
- which compatibility path was used and by which consumer category;
- whether compatibility reads are declining to zero before retirement.

Instrumentation must have bounded cardinality. Do not use raw phone numbers,
entity IDs, actor IDs, or Lead IDs as metric labels.

Cache failure behavior must match each workflow's approved posture and produce
an explicit stale/unresolved result rather than an invisible fallback.

## 5. Compatibility retirement checklist

### CPL

Inspect and retire:

- legacy mutation behavior in `src/services/cpl/cplRate.service.ts`;
- legacy route registration in `src/routes/v1.routes.ts`;
- runtime reads from `src/models/CplRate.ts`;
- embedded `granularity.cpl` resolution in `src/config/domain/cpl.ts`.

The old update path must be absent or return an explicit retired/read-only
response. No ordinary schedule edit may call Lead `updateMany`. Retain data for
rollback/audit.

### Source attribution

Inspect:

- `src/config/domain/sources.ts`;
- source parsing/resolution consumers identified by S0/S7;
- CRM, Analytics, Sheet Sync, booking, and scoped-auth consumers.

Static maps/unions may remain as seeds/fixtures only. They must not reject or
silently remap an Owner-created active Source Company at runtime.

### Agents

Stop automatic direct reads of flat `granot_crm_username` after migration
verification and compatibility telemetry meet the documented gate. Retain the
field. Granot matching uses the registry query and active-only behavior.

### RingCentral

Inspect:

- `src/services/ringcentral/call-lead-sources.ts`;
- webhook, Call Log, subscriptions, diagnostics, reconciliation, and ingest
  imports.

No production consumer may use the static number map after M5/S7. Keep seed
fixtures only if clearly named/documented and unreachable as runtime fallback.

### Endpoints and fields

Document every retained compatibility endpoint/field with:

- current reader/writer;
- reason retained;
- telemetry proving use;
- rollback value;
- objective later-removal criteria;
- owner and earliest removal stage.

## 6. Integrated acceptance verification

Create an acceptance matrix mapping each criterion in specification §13 to:

- implementation module/interface;
- focused test(s);
- migration/operational evidence where required;
- status and unresolved blocker.

At minimum re-verify:

- owner-only signed mutations and authenticated read-only access;
- transactional Registry Changes and sanitization;
- active/inactive lifecycle and explicit Owner correction behavior;
- Granot uniqueness/immutability and active-only automatic matching;
- first-class dynamic Source Granularity resolution;
- temporal CPL boundaries, zero/missing/duplicate distinctions;
- ordinary-edit non-rewrite behavior;
- resumable/idempotent CPL corrections;
- RingCentral validation, interval resolution, and webhook/Call Log parity;
- runtime static-map removal;
- Master Leads and derived-import behavior;
- production/historical isolation.

Use tests that cross the public registry interface. Avoid tests that couple
callers to internal model adapters where the public interface can prove the
same behavior.

## 7. Migration runbook dry run

Run or reproduce in a safe environment the dry-run sequence M0–M5 with stable
manifests. Confirm:

- database guards;
- no writes in dry-run;
- idempotent unchanged reruns;
- resumability/checkpoints where applicable;
- clean required uniqueness/collision gates;
- preserved embedded IDs/default mappings;
- unchanged existing Lead CPL values;
- expected route mapping checksum from fixtures or authorized target evidence.

Live RingCentral validation and any production apply remain separate authorized
actions. Record commands without secrets and retain artifact/run IDs.

## 8. Documentation drift

Reconcile code behavior with:

- `.cursor/businesslogic/catalog.service.md`;
- Form Lead and Call Lead service docs;
- RingCentral qualification/candidate docs;
- Analytics and Sheet Sync docs;
- relevant `.cursor/rules/*.mdc`;
- root `CONTEXT.md` and ADRs only if approved domain language or architectural
  decisions changed.

Do not duplicate glossary definitions. If implementation revealed a material
departure from the approved plans, stop and obtain an owner decision before
rewriting the authority documents.

## 9. Required commands

Run focused tests while closing findings, then:

```text
pnpm typecheck
pnpm test
```

Use `TEST_MODE=true`; transaction integration tests require replica-set MongoDB.
The server has no `pnpm lint` script, so do not report a nonexistent lint gate.
Mock external systems.

Also perform static searches/assertions proving:

- no Operations Registry code imports `src/models/historical/*`;
- no runtime RingCentral consumer imports the static route authority;
- no production CPL mutation path contains the legacy Lead rewrite;
- registry routes/consumers cross the intended module interface rather than
  importing registry models directly.

## 10. S8 handoff and exit gate

The S8 handoff must include:

- acceptance-matrix result and remaining blockers;
- Registry Health finding coverage;
- cache/compatibility telemetry behavior;
- removed/disabled legacy write paths and compatibility reads retained;
- retained-field retirement table;
- typecheck/full-test commands and results;
- migration dry-run manifest IDs/checksums;
- explicit statement that no production mutation/provider call occurred unless
  separately authorized and documented;
- rollback deployment point;
- documentation updates;
- confirmation historical database/models were untouched;
- server integration branch head SHA.

S8 is complete when the integrated server satisfies the server-side acceptance
criteria and is ready for the cross-repository gate. It does not by itself
authorize merge to `main` or deployment.
