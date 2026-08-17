# Vantage Copilot, MCP Server, and Agent Skills Direction

Status: Conversation synthesis and pre-specification architecture
Date: 2026-08-03
Related platform direction: `docs/operations-registry-platform-direction.md`

## Purpose

This document preserves the design conversation for the Vantage owner Copilot,
its MCP server, delegated sandbox agents, Claude Code skills, and the Cursor
Cloud Agent/Claude Code Maintainer System. It is intentionally detailed enough
to become product specifications and implementation issues later.

The goal is not simply to add chat. The goal is to give the owner a safe,
auditable way to understand and operate Vantage while also leaving behind a
maintainable codebase environment after the current developer departs.

## Product vision

Vantage becomes a modern operational control plane with two related agent
products:

### Vantage Owner Copilot

An operations agent available in the Admin Dashboard and through MCP-enabled
desktop clients. It can answer questions, explain system state, prepare plans,
preview changes, request approval, execute narrow commands, and monitor runs.

### Vantage Maintainer System

A codebase agent environment built around Claude Code, Cursor Cloud Agents,
canonical repository documentation, skills, hooks, evaluations, and runbooks. It
can diagnose, propose, test, and, with separate authorization, change or deploy
the applications.

These products may share documentation, read-only tools, and evaluation
fixtures. They must not share implicit authority. Operational access does not
grant code mutation or deployment access, and repository access does not grant
unrestricted production data access.

## Intended owner experiences

### Admin Dashboard Agent Workspace

The owner can ask questions such as:

- Why did this RingCentral call not become a qualified Call Lead?
- Which CPL period was applied to this lead and why?
- Preview today's Best Relocation ingestion.
- Show the conflicts in the separate Booked Deals sheet.
- Draft a weekly report for TBM Forms grouped by Agent.
- Is the Granot extension online, and what failed in its last cycle?
- Prepare a safe retry of the failed Granot records.

The workspace should show more than prose. It should have:

- conversation and cited records;
- proposed actions with inputs, predicted effects, and warnings;
- a structured approval queue;
- delegated-job progress;
- generated artifacts and downloads;
- recent activity and audit history;
- saved routines and schedules;
- effective permissions and connected installations; and
- token, runtime, and sandbox cost visibility.

### Claude Desktop and Claude Code

The owner can connect to the same Vantage MCP server and use repository skills
that explain which workflow is appropriate. Claude Code additionally has local
codebase context, tests, documentation, and carefully guarded maintenance
commands.

### Cursor Cloud Agents

The owner can delegate bounded codebase tasks in a reproducible cloud
environment. Repository rules and hooks protect secrets, production operations,
destructive Git actions, unreviewed migrations, and documentation drift. CI
remains the authoritative enforcement layer.

## Architecture

```text
Admin Dashboard Agent Workspace
Claude Desktop / Claude Code
Cursor Cloud Agents (maintainer role)
              |
              v
      Vantage Agent Runtime
        |-- conversation/orchestration
        |-- identity and scopes
        |-- approval workflow
        |-- artifacts and evaluations
        `-- MCP transport
              |
              v
      Agent Command/Query Facade
        |-- Operations Registry
        |-- canonical Leads/Bookings
        |-- External Data Ingestion
        |-- Reporting Projection
        |-- Granot Automation
        `-- health/analytics/audit
              |
              +--> MongoDB and trusted Adapters
              |
              `--> bounded sandbox agents
                    `-- artifacts/proposals only
```

The agent runtime may initially be a separate `vantage-agent` Vercel project:

```text
vantage-agent/
  agent/
    instructions.md
    agent.ts
    tools/
    skills/
    subagents/
    channels/
    schedules/
  mcp/
  evals/
```

Vercel Eve is a promising candidate because its direction includes durable
workflows, approvals, skills, subagents, schedules, channels, and sandbox use.
It should remain an Adapter choice. Vantage domain commands, MCP schemas,
authorization, approvals, and audit records must not depend on Eve-specific
types so that the runtime can be replaced.

## MCP server design

### Purpose

The MCP server is the narrow agent-facing Interface to Vantage. It translates
authenticated tool calls into stable application commands and queries and
returns structured, attributable results.

It is not:

- a mirror of every existing Express route;
- arbitrary HTTP access to the main server;
- arbitrary MongoDB query or mutation access;
- a remote shell;
- a secret retrieval mechanism; or
- direct control of an owner's browser.

### Command/query facade

Create a conceptual `/api/v1/agent/` facade when the MCP runtime is separately
deployed. It should expose versioned command/query contracts designed for agent
use. If the agent runtime is hosted in the same trusted process, invoke domain
Modules directly instead of making loopback HTTP requests.

Good tool contracts are task-oriented:

- `get_registry_health`
- `resolve_source_attribution`
- `explain_cpl_resolution`
- `explain_call_qualification`
- `search_operational_records`
- `preview_ingestion_run`
- `get_ingestion_run`
- `list_ingestion_conflicts`
- `draft_reporting_definition`
- `preview_reporting_run`
- `get_granot_installation_health`
- `preview_granot_sync`
- `request_granot_command`

Avoid tools such as `call_api_route`, `query_collection`, `execute_javascript`,
or `update_any_record`.

### Structured tool results

Every result should include, where applicable:

- stable record IDs and human-readable labels;
- the data timestamp and reporting timezone;
- filters and assumptions used;
- provenance or cited source records;
- warnings, ambiguity, and confidence;
- current authorization and required approval;
- an immutable preview/plan ID for a later apply command; and
- a trace/session ID for audit.

The model should not be responsible for re-creating a mutation payload from
prose. An apply tool should accept an immutable server-generated plan ID plus a
fresh approval reference.

### Risk tiers

#### Tier 1: Read

Registry lookup, analytics, record search, run state, health, and audit queries.
These require scoped authorization, redaction, rate limits, and invocation audit
but normally no per-call approval.

#### Tier 2: Analyze and preview

Reconciliation planning, ingestion preview, report preview, anomaly analysis,
and artifact production. These are non-canonical operations but still require
bounded datasets and cost/resource limits.

#### Tier 3: Reversible operational write

Starting an approved run, retrying an eligible failure, or activating a saved
definition. Require a structured preview, explicit confirmation, idempotency,
and a narrow command.

#### Tier 4: Canonical or financial write

Booking changes, CPL corrections, Registry Changes, conflict dispositions, and
other financially meaningful mutations. Require fresh explicit approval, exact
before/after values, dependency checks, a reason, and durable audit.

#### Tier 5: Infrastructure mutation

Repository changes, deployment requests, migrations, backfills, or environment
configuration. These belong to the separately authorized Maintainer System.

#### Prohibited or exceptional actions

Bulk deletion, unrestricted production commands, secret extraction, bypassing
approvals, disabling audit, or direct sandbox-to-production writes should be
prohibited. A genuinely necessary high-blast-radius action requires a dedicated
two-step administrative workflow outside general-purpose chat tools.

## Authentication, authorization, and tenancy

Use a remote-MCP authorization design consistent with OAuth 2.1 and MCP
authorization guidance. Do not expose the existing `x-api-secret` to the owner,
desktop clients, browser code, prompts, or sandboxes.

Suggested scopes:

- `vantage:operations:read`
- `vantage:analytics:read`
- `vantage:registry:write`
- `vantage:bookings:write`
- `vantage:integrations:run`
- `vantage:code:read`
- `vantage:deploy:request`

Scopes are only the first gate. Each tool also enforces record-level policy,
action limits, environment, approval requirements, and current installation or
connection ownership.

Tokens should be short-lived. Refresh-token, client, and session revocation must
be visible to the owner. Production and non-production audiences should be
distinct. Tool responses and artifacts must redact secrets and minimize
personally identifiable information.

## Approval model

An approval is a server record, not a conversational phrase.

Suggested records:

- `AgentSession`: actor, client, environment, scopes, start/end, and summary;
- `AgentToolInvocation`: tool/version, sanitized input, result summary, timing,
  cost, trace, and outcome;
- `AgentApproval`: approver, exact plan/action hash, risk tier, before/after
  summary, expiry, status, and use count;
- `AgentArtifact`: type, storage reference, checksum, classification, retention,
  and producer; and
- `AgentDelegatedRun`: sandbox role, task, bounded inputs, limits, progress,
  artifact IDs, and terminal result.

Approval requirements:

1. The server creates an immutable preview or action plan.
2. The UI shows exact affected records, material value changes, warnings, and
   estimated scope.
3. The owner approves that plan hash, not a general class of future actions.
4. Approval expires and is single-use unless the policy explicitly says
   otherwise.
5. Apply revalidates permissions, plan freshness, dependencies, and current
   record versions.
6. The invocation and resulting domain changes reference the approval.

Scheduled routines require a separately approved policy envelope: tool,
definition, maximum row/financial scope, schedule, expiry, and stop conditions.

## Sandboxed delegated agents

### Why delegate

Some tasks are too large or unstructured for an ordinary MCP call: exploring a
novel workbook, normalizing inconsistent headers, generating a derived dataset,
researching an incident across many artifacts, or studying a codebase. A
sandbox can isolate that computation and produce an inspectable artifact.

### Proposed roles

#### Sheet Analyst

Receives bounded workbook exports or files. Profiles headers and values,
proposes mappings, detects duplicates/anomalies, and produces normalized sample
datasets and mapping artifacts. It has no Google or production database
credentials.

#### Operational Investigator

Receives selected records, events, and sanitized logs. Builds a causal timeline
and produces an evidence-linked diagnosis. It cannot mutate operational state.

#### Reporting Builder

Receives approved dataset schemas and business intent. Drafts a Reporting
Definition, column contract, sample output, and validation checks. Saving or
activating the definition remains a trusted, approved server command.

#### Codebase Researcher

Receives a repository snapshot and task. Produces findings, a proposed plan,
patch, or pull-request artifact. It receives no production secrets and cannot
deploy.

### Sandbox contract

Each delegated run receives only:

- a task-specific dataset or repository snapshot;
- a short-lived input/output capability;
- an explicit network allowlist;
- CPU, memory, time, and token limits;
- artifact type and schema expectations; and
- a data classification and retention policy.

It never receives production DB credentials, `x-api-secret`, Google refresh
tokens, RingCentral secrets, Granot credentials, or deployment credentials.

The sandbox returns an artifact or proposal. The trusted application parses,
validates, previews, and, if necessary, obtains approval before any canonical
write. Treat sandbox output as untrusted input even when it was produced by the
same model provider.

## Granot and browser automation

The Copilot should not remotely drive an arbitrary owner browser through a
sandbox. It should request a server-backed command:

```text
request_granot_sync
  -> validated GranotAutomationCommand
  -> authorized extension claims lease
  -> extension uses existing browser session
  -> extension reports progress/results
  -> server reconciles and audits outcome
```

This creates a clear Seam between agent intent and browser execution. The owner
can see the installation, session state, command preview, approval, progress,
and result in the dashboard. Login remains direct between the owner and Granot.

## Claude Code agent skills

Skills should be small routing and procedure packages grounded in canonical
repository documentation. They should not duplicate changing schemas or
business rules in many prompt files.

Suggested initial skill set under `.claude/skills/`:

- `vantage-router`: identifies the correct Vantage Module, skill, runbook, and
  safety level for a request;
- `vantage-owner-operations`: explains owner workflows and how to use safe MCP
  tools;
- `vantage-incident-triage`: gathers evidence, builds a timeline, separates
  diagnosis from mutation, and links runbooks;
- `vantage-sheet-ingestion`: profiles inputs, works with schema profiles,
  previews runs, and handles conflicts;
- `vantage-reporting-projection`: drafts and validates Reporting Definitions;
- `vantage-ringcentral`: explains route validation, assignment, qualification,
  and call attribution;
- `vantage-granot-extension`: diagnoses installation/session state and operates
  the server command plane;
- `vantage-safe-maintenance`: performs bounded code changes, focused checks, and
  risk review;
- `vantage-release`: prepares a release, validates migrations/configuration,
  deploys only with authority, and verifies rollback/health.

Every skill should state:

- when it applies and when it does not;
- canonical documents to read;
- allowed tools and required scopes;
- preconditions and safety checks;
- step-by-step workflow;
- stop/approval conditions;
- expected artifacts; and
- verification and handoff requirements.

`vantage-router` should link to specialized skills. It should not become a giant
copy of all their instructions.

## Repository continuity for Cursor and Claude Code

Suggested shared structure:

```text
AGENTS.md
CLAUDE.md
.cursor/
  environment.json
  rules/
  hooks.json
  hooks/
.claude/
  settings.json
  skills/
.mcp.json
docs/
  architecture/
  runbooks/
  ownership/
```

### Canonical instructions

`AGENTS.md` should contain cross-agent repository rules, commands, boundaries,
and a documentation map. `CLAUDE.md` should remain a thin Claude-specific entry
point that references canonical rules. Cursor rules and skills should link to
the same architecture, domain, testing, and runbook sources.

### Reproducible environment

The Cursor Cloud environment should install pinned dependencies, expose safe
test/build commands, and use clearly separated non-production resources. It
must not bootstrap production secrets by default. The same repository commands
should work locally, in Claude Code, in Cursor, and in CI where practical.

### Shared safety hooks

Implement guard logic as versioned repository scripts invoked by both Cursor and
Claude configurations where their hook systems permit.

Before command execution, check for:

- secret-file access or output;
- production database or credential use;
- destructive Git or filesystem commands;
- deployment, migration, or backfill commands;
- unbounded data export; and
- actions requiring owner approval.

After edits, run or suggest:

- formatting and type checks for affected packages;
- focused tests selected from changed paths;
- model/route/dashboard contract checks;
- generated-file or schema drift checks; and
- documentation drift checks when commands, models, routes, environment, or
  owner workflows changed.

Before completion, require:

- a clean understanding of the diff, including pre-existing user changes;
- relevant verification results;
- migration/configuration notes;
- side-effect and rollback review; and
- updated canonical documentation or an explicit reason it was unnecessary.

Hooks are defense in depth, not the trust boundary. Developers and agents can
misconfigure or bypass local hooks. CI, server-side permissions, protected
environments, and provider access controls remain authoritative.

## Documentation-drift strategy

Documentation should have explicit owners and machine-checkable links to change
surfaces:

- domain models and invariants;
- HTTP and MCP contracts;
- environment variables and external connections;
- migrations and backfills;
- dashboard owner workflows;
- extension commands/capabilities; and
- deployment, incident, recovery, and credential-rotation runbooks.

A changed public contract should either update its canonical document or include
an explicit reviewed exemption. Avoid copying the same model fields into many
skills. Prefer a generated schema or one canonical reference.

## Evaluation strategy

Agent quality and safety require repeatable evaluations before write authority
expands.

Initial evaluation groups:

- Registry explanation: correct identity, lifecycle, CPL period, and route
  assignment;
- ingestion: correct header profile, row outcomes, idempotency, and booking
  conflict handling;
- reporting: definition correctness, timezone, totals, feedback-loop safety,
  and reproducibility;
- Granot: installation health, preview/apply distinction, command expiry, and
  retry behavior;
- authorization: scope denial, approval expiry, plan mutation, secret
  redaction, and environment isolation;
- maintenance: focused diagnosis, preservation of unrelated changes, test
  selection, documentation updates, and refusal of unauthorized deploys.

Every write tool needs positive, denial, stale-plan, duplicate-call,
partial-failure, and audit-linkage tests.

## Operational ownership transfer

The final deliverable should include more than configuration files. The owner
needs:

- an access and account inventory with named owners;
- environment and deployment maps;
- credential rotation and revocation procedures;
- restore, rollback, and disaster-recovery runbooks;
- common incident playbooks;
- data ingestion and reporting recovery procedures;
- Granot extension reinstall/reconnect instructions;
- MCP client setup and revocation instructions;
- cost limits and alerting;
- recorded acceptance exercises; and
- a list of actions that still require an outside engineer.

Run at least one supervised exercise for a failed ingestion, stale report,
offline Granot extension, revoked MCP session, bad deployment, and database
restore/rollback decision. Documentation that has not been exercised is not yet
an operational handoff.

## Proposed delivery phases

### Phase 1: Maintainability baseline

Canonical architecture/domain docs, repository instructions, environment setup,
shared safety scripts, CI enforcement, access inventory, and critical runbooks.

### Phase 2: Read-only MCP

OAuth/scopes, MCP transport, agent sessions/invocations, Registry and operational
queries, redaction, rate limits, and read-only evaluations.

### Phase 3: Dashboard Copilot

Agent Workspace, citations, structured results, activity history, permissions,
and artifact display. Still read/analyze only.

### Phase 4: Preview tools

Ingestion preview, reporting draft/preview, Granot preview, reconciliation plans,
immutable plan IDs, and cost/resource controls.

### Phase 5: Approval-gated writes

Approval records and UI, reversible commands first, idempotency, stale-plan
checks, canonical audit linking, and write-tool evaluations.

### Phase 6: Sandboxes and delegated agents

Sheet Analyst and Reporting Builder first, artifact pipeline, isolation tests,
resource limits, and trusted validation of outputs.

### Phase 7: Extension command plane

Installation identity, heartbeat, policies, command queue, leasing, progress,
results, preview/apply permission split, and dashboard health.

### Phase 8: Maintainer System

Codebase Researcher, Cursor Cloud environment, Claude maintenance/release
skills, deployment-request workflow, expanded CI, recovery drills, and owner
training.

Do not begin with autonomous production writes or deployments. Each phase earns
the authority required by the next through evaluations and operational evidence.

## Suggested first implementation issues

1. Define the versioned Agent Command/Query Interface.
2. Define OAuth clients, scopes, token audiences, and revocation.
3. Add Agent Session and Tool Invocation audit records.
4. Implement read-only Registry health and resolution tools.
5. Implement operational record search with field-level redaction.
6. Add the Dashboard Agent Workspace read-only shell.
7. Build citations and structured action-preview UI.
8. Define immutable plans and approval records.
9. Add ingestion preview and run-status tools.
10. Add reporting draft and preview tools.
11. Add Granot health and preview tools.
12. Build the Sheet Analyst sandbox and artifact validator.
13. Create the initial Claude Code skills and documentation router.
14. Add shared command guards and focused-check selection.
15. Add agent/MCP security and behavioral evaluations.
16. Complete owner access transfer and recovery exercises.

## Open decisions

- Will the first Agent Runtime be embedded in the dashboard stack or deployed as
  a separate Vercel project?
- Is Vercel Eve mature enough for the first production release, or should it be
  limited to an experimental Adapter?
- Which desktop MCP clients must be supported at launch?
- Which read datasets need field-level or row-level restrictions?
- Which reversible write is safe enough to be the first approved mutation?
- Who besides the owner, if anyone, can approve financial or deployment actions?
- What task/runtime/token budgets apply to delegated agents?
- How long are prompts, invocation payloads, and generated artifacts retained?
- Which codebase tasks may create a branch or pull request automatically?
- Which production deployments must always require an external engineer?

## External references

- [Model Context Protocol authorization](https://modelcontextprotocol.io/specification/2025-11-25/basic/authorization)
- [MCP authorization tutorial](https://modelcontextprotocol.io/docs/tutorials/security/authorization)
- [Vercel Eve](https://vercel.com/eve)
- [Vercel Eve repository](https://github.com/vercel/eve)
- [Vercel Sandbox](https://vercel.com/docs/sandbox)
- [Claude Agent Skills overview](https://platform.claude.com/docs/en/agents-and-tools/agent-skills/overview)
- [Cursor Cloud Agents](https://cursor.com/changelog/cloud-in-agents-window)
