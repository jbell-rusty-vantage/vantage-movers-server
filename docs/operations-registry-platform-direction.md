# Vantage Operational Control Plane Direction

Status: Consolidated platform direction; Operations Registry delivered; remaining modules proposed
Updated: 2026-08-03
Primary application: `vantage-main-server`
Related applications: `vantage-admin`, `granot_sync_extensions_and_services`, proposed `vantage-agent`

## Purpose

This document is the architectural index for the Vantage owner-facing operational
control plane. It records the relationship between five major capabilities:

1. the delivered Operations Registry;
2. application-owned External Data Ingestion;
3. configurable Reporting Projection;
4. a server-backed Granot CRM automation control plane; and
5. Vantage Copilot, its MCP server, agent skills, and delegated agents.

It is direction for later specifications and issues, not one implementation
specification. Detailed Operations Registry implementation records are under
`docs/current_plans/`. The detailed Copilot design is in
`docs/vantage-copilot-mcp-and-agent-skills.md`.

## Executive direction

Vantage should become the canonical operational control plane, not another
participant in a collection of independently maintained spreadsheets and tools.

- MongoDB owns canonical business records and operational configuration.
- External spreadsheets are explicitly registered as either inputs or outputs.
- Ingestion turns external rows into attributable observations and reconciles
  them with canonical records.
- Reporting definitions turn canonical records into rebuildable projections.
- Granot automation is requested and audited by the server, then executed by the
  installed extension in the owner's existing browser session.
- Vantage Copilot inspects, explains, previews, and acts through the same narrow,
  audited application commands used by trusted product workflows.

The governing agent principle is:

> The agent may inspect broadly, calculate in isolation, propose precisely, and
> act only through narrow audited commands.

## System roles and ownership

| System | Canonical role | Must not become |
| --- | --- | --- |
| `vantage-main-server` | Domain rules, canonical records, commands, queries, run state, audit | A thin proxy for spreadsheet behavior |
| `vantage-admin` | Owner control plane, previews, approvals, exceptions, health | A second implementation of domain rules |
| Granot extension | Browser-session Adapter and Granot execution worker | A second source of orchestration truth |
| MongoDB | System of Record | A cache of spreadsheet state |
| Input Google Sheets | External Data Sources | Canonical records by default |
| Output Google Sheets | Reporting Projections | Re-ingestion sources |
| RingCentral | Provider of call observations | Owner of Vantage source attribution |
| Vantage Copilot/MCP | Audited agent Interface over application capabilities | Arbitrary database, shell, or HTTP access |
| Sandboxed agents | Bounded analysis and artifact production | Holders of production credentials |

## Delivered foundation: Operations Registry

The Operations Registry is implemented and functional. It is now a delivered
platform dependency rather than the next proposed project.

### Delivered owner-managed catalogs

- Agents, including active/deactivated lifecycle, aliases, role, and verified
  Granot CRM identity fields;
- Merchants, including active/deactivated lifecycle and aliases;
- Source Companies and first-class Source Granularities for form, call, and
  other source-specific variants;
- effective-dated CPL schedules, revisions, corrections, and resolution
  snapshots;
- RingCentral Inbound Queue Numbers, provider validation, observation state,
  and effective-dated Source Company/Granularity assignments; and
- registry audit, dependency checks, overview, and health surfaces.

Moving Carriers are not part of this roadmap. Their CSV overwrite and
idempotent-addition workflow is already considered resolved.

### Delivered runtime consequences

The registry is not merely CRUD. Runtime flows now have database-backed
identities and policies that can be shared by form ingestion, RingCentral call
qualification, analytics, lead persistence, CPL attribution, and the Admin
Dashboard. Temporal CPL resolution retains the applied period and status on the
lead. RingCentral routing uses registry routes and assignments instead of a
production static-map fallback.

The Operations Registry should be treated as a deep Module with a small
Interface:

- resolve an Agent or Granot identity;
- resolve a Source Company and Granularity;
- resolve CPL for a business timestamp;
- resolve or validate an inbound RingCentral route;
- inspect dependencies and lifecycle eligibility; and
- record and query Registry Changes.

New modules should consume those operations rather than read registry
collections independently or recreate lookup rules.

### Documentation status

The original pre-implementation plan is retained as historical planning context.
The implementation specifications and delivery handoffs under
`docs/current_plans/` are the more precise record of the delivered registry.
Future registry changes should be written as incremental specifications, not as
an attempt to execute the original plan again.

## Proposed Module 1: Application-Owned External Data Ingestion

### Outcome

The owner can register external workbooks, map their structures, preview an
ingestion, run or schedule it, and resolve ambiguous or conflicting observations
without relying on a developer-operated script or local checkpoint file.

Likely inputs include:

- lead-source form workbooks;
- lead-source call workbooks;
- the separate Booked Deals workbook;
- cancellation or refund tabs;
- historical workbooks; and
- source-specific feeds such as Best Relocation.

### Module boundary

The External Data Ingestion Module owns connections, schema interpretation, run
orchestration, source-row idempotency, matching evidence, and conflicts. It does
not own Booking, Lead, Cancellation, or Registry business rules. After it has
validated and reconciled an observation, it invokes the appropriate canonical
domain command.

Suggested core records:

- `ExternalDataConnection`: workbook/provider identity and access configuration;
- `ExternalDatasetDefinition`: tab, business record type, Source Company,
  Granularity, schema profile, and schedule;
- `IngestionSchemaProfile`: versioned header aliases, parsers, transforms, and
  required fields;
- `IngestionRun`: immutable plan, status, lease, counters, checkpoints, actor,
  and timing;
- `SourceRowReceipt`: source identity, row identity, content hash, protected raw
  provenance, profile version, match result, and resulting domain IDs; and
- `IngestionConflict`: durable evidence, candidate matches, conflicting values,
  disposition, and resolution audit.

Names may change during specification, but these responsibilities should remain
inside one Module.

### Required behavior

1. Register and verify a connection without making it an active input.
2. Inspect workbooks, tabs, and headers.
3. Select the record type and Registry attribution.
4. Suggest a versioned schema profile and allow explicit corrections.
5. Produce a dry-run plan containing creates, safe updates, no-ops, invalid
   rows, ambiguous matches, and conflicts.
6. Apply an approved immutable plan with a lease, checkpoints, retries, and
   idempotency.
7. Preserve source provenance and exact resulting domain IDs.
8. Resume safely after process or provider failure.
9. Expose run health and conflict resolution in the Admin Dashboard.

### Idempotency and contention rules

Row number alone is not a durable identity because rows can move. Prefer a
provider row ID where available. Otherwise use a dataset-specific stable key and
content hash while retaining row position as provenance.

Each row outcome must be deterministic for a specific schema-profile version
and run plan. Re-reading unchanged evidence should be a no-op. Changed evidence
should create a new receipt/version or a conflict, not erase its history.

The owner's separate Booked Deals sheet is a stream of External Booking
Observations. An observation can produce:

- a Booking attached to an existing Lead;
- a Leadless Booking;
- a no-op against the same existing Booking;
- an explicitly permitted safe update;
- an ambiguous match; or
- a conflict with canonical values.

It must never silently overwrite a Booking created through the Admin Dashboard.
Financial changes should require explicit policy and, by default, owner
approval.

### Best Relocation pilot

The existing Best Relocation importer is the best tracer bullet. Its parsing,
normalization, provenance, matching, dry-run, guarded apply, and resumability
should be retained. Its orchestration should move behind the application-owned
Module so that run state, receipts, conflicts, and permissions are server-owned.

### Historical consolidation

Production and historical data should converge into one canonical database
through the same reconciliation discipline, not a raw collection copy. The
staged consolidation plans under
`docs/historical_production_db_staged_merge_ingestion_plans/` remain the
specialized source for that migration.

After consolidation, "historical" should describe date or provenance, not a
separate live database boundary. The old database should remain read-only for a
defined audit window, and the migration must verify relationships, counts, and
financial totals.

## Proposed Module 2: Configurable Reporting Projection

### Outcome

The owner can define, preview, schedule, and rebuild Google Sheets reports from
canonical data without adding source-specific code or environment variables.

### Module boundary

The Reporting Projection Module owns report definitions, destination
connections, query parameters, column contracts, run state, delivery strategy,
and artifacts. It reads canonical domain queries; it does not own the underlying
business records or make an output sheet canonical.

Suggested core records:

- `ReportingDestination`: provider, workbook, tab policy, credentials reference,
  ownership, and health;
- `ReportingDefinition`: dataset, filters, dimensions, measures, columns,
  ordering, timezone, destination, strategy, and schedule;
- `ReportingRun`: immutable definition revision, status, counters, checksum,
  lease, actor, and timing; and
- `ReportingArtifact` or `ReportingDelivery`: generated data/version, target,
  provider response, and verification result.

### Definition capabilities

A definition should be able to express:

- dataset or report type;
- explicit or rolling date range;
- Source Company and Granularity filters;
- Agent, Merchant, route, booking-status, or cancellation filters where valid;
- dimensions, measures, included columns, labels, and ordering;
- reporting timezone;
- destination workbook and tab;
- manual, scheduled, or event-triggered refresh; and
- snapshot, full-tab rebuild, or key-based row-upsert delivery.

Definitions should be revisioned. A run records the exact definition revision
used, so a later edit does not make an old report irreproducible.

### Input/output safety

External input connections and reporting destinations are separate concepts and
permissions. A workbook/tab cannot be both unless an exceptional, reviewed
configuration explicitly partitions the data. The system must detect and block
obvious feedback loops where Vantage ingests its own projection.

The existing durable Sheet Sync outbox remains appropriate for operational row
projections. Large or configurable reports will often be safer as snapshot or
full-tab rebuilds. The Reporting Projection Module may use Sheet Sync as an
Adapter, but should not force every report into one job per domain record.

### Owner workflow

1. Select a vetted dataset.
2. Configure filters, columns, destination, and schedule.
3. Preview row count, sample rows, warnings, and intended sheet changes.
4. Save a versioned definition.
5. Run now or activate the schedule.
6. Inspect delivery history, freshness, failures, and checksums.
7. Clone or revise the definition without changing previous run history.

## Proposed Module 3: Server-Backed Granot Automation Control Plane

### Outcome

The dashboard can show whether the extension is ready, request a bounded Granot
operation, monitor it, and audit its results. The extension remains the browser
execution Adapter and uses the owner's existing Granot session.

### Module boundary

The Granot Automation Module owns installations, policies, commands, leases,
runs, and results. It does not own Lead or Booking truth and does not duplicate
browser-driving logic on the server.

Suggested core records:

- `GranotAutomationInstallation`: owner/workspace identity, extension version,
  capabilities, last heartbeat, browser/session state, and revocation;
- `GranotAutomationPolicy`: allowed operations, preview/apply defaults, limits,
  schedules, and approval requirements;
- `GranotAutomationCommand`: requested operation, canonical input references,
  idempotency key, policy snapshot, state, expiry, actor, and lease;
- `GranotAutomationRun`: installation, attempt, timing, progress, and terminal
  status; and
- `GranotAutomationResult`: summary, row-level outcomes, domain references,
  evidence, and sanitized failure details.

### Command flow

1. The dashboard, a schedule, or an approved Copilot tool creates a command.
2. The server validates permissions and snapshots the active policy.
3. An authorized extension installation claims a short lease.
4. The extension opens or focuses the pinned Granot tab.
5. The owner's existing Granot browser session is reused.
6. The extension previews or applies the bounded operation.
7. It reports progress and row-level outcomes.
8. The server expires, retries, or completes the command idempotently.

Useful commands may include:

- verify installation/session health;
- synchronize eligible records;
- enrich selected Form Leads or Call Leads;
- reconcile booked calls;
- preview a background cycle;
- apply an explicitly approved background cycle; and
- retry eligible failures.

### Security direction

Do not initially collect raw Granot credentials in the dashboard, MCP server, or
sandbox. The extension should reuse the browser session and report `login
required` when that session is unavailable. Fully unattended credential-based
automation would be a separate product boundary with a credential vault,
isolated runner, and dedicated security review.

Command inputs should reference canonical IDs, not trust arbitrary payloads.
Commands need expiry, leases, idempotency keys, bounded batch sizes, sanitized
logs, and cancellation semantics. Preview and apply are distinct permissions.

## Proposed Module 4: Vantage Copilot and Maintainer System

### Product surfaces

The owner should be able to use Vantage Copilot through:

- an Agent Workspace in the Admin Dashboard; and
- Claude Desktop/Claude Code through Vantage MCP and repository agent skills.

Cursor Cloud Agents and Claude Code also form a Maintainer System for continuing
to operate the codebases after the current developer leaves. The Owner Copilot
and Maintainer System share documentation and selected read tools, but their
permissions must remain separate. Asking an operational question must never
implicitly grant repository mutation or deployment rights.

### MCP role

MCP is an agent-facing Interface over stable Vantage commands and queries. It
should expose task-oriented tools such as `preview_ingestion_run` or
`explain_call_attribution`, not mirror every raw HTTP route and never expose a
general database query, arbitrary server HTTP client, shell, or production
secret.

When the MCP runtime is in the same trusted application boundary, tools should
invoke domain Modules directly. A separately deployed MCP server may use a
dedicated `/api/v1/agent/` facade with scoped OAuth and the same command/query
contracts.

### Tool risk tiers

| Tier | Examples | Default control |
| --- | --- | --- |
| Read | registry lookup, lead search, run status | Scoped authorization and audit |
| Analyze | reconciliation plan, report preview, anomaly explanation | Bounded inputs and artifact audit |
| Reversible write | start a run from an approved definition, retry a failed command | Structured preview plus approval |
| Canonical/financial write | booking mutation, CPL correction, conflict resolution | Explicit fresh approval and narrow command |
| Infrastructure mutation | code change, deploy request, migration | Separate maintainer role and workflow |
| Destructive/high blast radius | bulk delete, secret access, arbitrary production command | Prohibited or purpose-built two-step ceremony |

Suggested OAuth scopes include:

- `vantage:operations:read`;
- `vantage:analytics:read`;
- `vantage:registry:write`;
- `vantage:bookings:write`;
- `vantage:integrations:run`;
- `vantage:code:read`; and
- `vantage:deploy:request`.

The existing `x-api-secret` must not become an owner-facing MCP credential.

### Delegated analysis

Sandboxed agents are useful for deep research, header discovery, spreadsheet
normalization, dataset production, report drafting, and codebase research. They
receive a task-scoped dataset, network allowlist, time/resource limits, and a
short-lived artifact destination. They do not receive production database,
Google, RingCentral, Granot, deployment, or broad Vantage API credentials.

Their output is an artifact or proposal. A trusted server command validates and
applies any approved canonical write.

Vercel Eve and Vercel Sandbox are promising implementation candidates, but the
Vantage MCP contracts, domain commands, authorization, and audit model should
remain provider-independent because agent frameworks evolve quickly.

See `docs/vantage-copilot-mcp-and-agent-skills.md` for the detailed architecture,
dashboard workspace, audit records, skills, hooks, sandbox roles, and delivery
phases.

## Shared platform invariants

These rules cross every proposed Module:

1. MongoDB is canonical; external rows and agent statements are evidence.
2. Every run uses an immutable snapshot of its definition, policy, or plan.
3. Preview and apply are distinct operations and permissions.
4. Every side effect has an actor, reason, idempotency key, and audit record.
5. Leases and retries cannot produce duplicate canonical mutations.
6. Historical provenance is append-oriented and never silently rewritten.
7. Runtime Modules, dashboard workflows, MCP tools, and extensions share domain
   commands rather than reimplement rules.
8. Input connections and output destinations are explicitly different.
9. Agents and sandboxes have less authority than the trusted server.
10. No automation stores or displays secrets in prompts, artifacts, or logs.

## End-to-end architectural shape

```text
Owner
  |-- Admin Dashboard
  |     |-- Registry management
  |     |-- Ingestion runs and conflicts
  |     |-- Reporting definitions and runs
  |     |-- Granot command control
  |     `-- Vantage Copilot workspace and approvals
  |
  |-- Claude Desktop / Claude Code
  |     `-- MCP + Vantage agent skills
  |
  `-- Cursor Cloud Agents
        `-- separately authorized Maintainer System

Trusted application boundary
  |-- Operations Registry Module
  |-- External Data Ingestion Module
  |-- Reporting Projection Module
  |-- Granot Automation Module
  |-- Agent command/query facade
  |-- Approval and audit records
  `-- Canonical domain Modules and MongoDB

Adapters and bounded workers
  |-- Google Sheets / Drive
  |-- RingCentral
  |-- Granot browser extension
  |-- MCP transport
  `-- sandboxed delegated agents
```

## Recommended delivery sequence from the current baseline

1. Record Operations Registry deployment and acceptance evidence; treat future
   changes as incremental work.
2. Establish the maintainability baseline: canonical architecture docs,
   runbooks, access transfer, shared safety hooks, and repository instructions.
3. Build the application-owned ingestion run, receipt, schema-profile, and
   conflict foundation.
4. Move Best Relocation onto that foundation as the pilot.
5. Complete remaining workbook ingestion and historical consolidation.
6. Build Reporting Destinations, versioned Reporting Definitions, previews, and
   deterministic runs.
7. Add the server-backed Granot installation, heartbeat, policy, command, lease,
   and result plane.
8. Release read-only MCP tools and the initial owner Copilot workspace.
9. Add preview tools, structured approvals, and narrowly scoped write commands.
10. Add sandboxed analysis agents and, only after evaluation, scheduled routines.
11. Complete the separately authorized Cursor/Claude Maintainer System and owner
    training.

Steps 3-7 can be specified independently, but they should reuse the same run,
audit, approval, and artifact vocabulary where doing so preserves clear Module
ownership.

## Specifications and issue boundaries to create next

The following are good issue-collection boundaries:

1. Application-Owned Ingestion Foundation
2. Best Relocation Ingestion Migration
3. External Booking Reconciliation Policy
4. Historical Workbook Onboarding and Consolidation
5. Reporting Definition and Destination Model
6. Reporting Preview, Run, and Sheet Delivery
7. Granot Installation, Heartbeat, and Health
8. Granot Command Queue, Leasing, Policies, and Results
9. Vantage Agent Command/Query Facade and OAuth
10. Dashboard Copilot Workspace and Approval Queue
11. Read-Only MCP Tool Set and Evaluations
12. Approval-Gated MCP Mutations
13. Sandboxed Sheet Analyst and Reporting Builder
14. Claude Code Skill Set and Canonical Documentation Router
15. Cursor/Claude Shared Safety Hooks and CI Checks
16. Access Transfer, Runbooks, Recovery Drills, and Owner Training

## Decisions to resolve during specification

### Ingestion

- Which external booking fields may update an existing canonical Booking without
  approval?
- Which source-specific identifiers are stable enough to become row identities?
- What protected raw-row retention period is required?
- Which datasets may run unattended after their first approved import?

### Reporting

- Which vetted datasets and measures are available in the first release?
- Is full-tab replacement acceptable for every initial destination?
- What freshness and reconciliation checks define a successful delivery?

### Granot automation

- Which commands are preview-only, approval-gated, or schedule-eligible?
- Is one installation bound to one owner, one browser profile, or one Granot
  workspace?
- How long may a command lease or offline installation remain eligible?

### Copilot and maintenance

- Which write tools, if any, are included in the first owner release?
- Who can approve financial, integration, and deployment actions?
- Which agent runtime hosts the first version, and what is the exit strategy?
- What monthly cost, concurrency, and artifact-retention limits apply?
- Which deployments require a human outside the owner account?

## External technology references

- [Model Context Protocol authorization](https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization)
- [MCP authorization tutorial](https://modelcontextprotocol.io/docs/tutorials/security/authorization)
- [Vercel Eve](https://vercel.com/eve)
- [Vercel Eve repository](https://github.com/vercel/eve)
- [Vercel Sandbox](https://vercel.com/docs/sandbox)
- [Claude Agent Skills overview](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/overview)
- [Cursor Cloud Agents](https://cursor.com/changelog/cloud-in-agents-window)
