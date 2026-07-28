# Operations Registry Current Plan

Status: Approved specification; ready for implementation planning handoff
Decision date: 2026-07-28
Primary repository: `vantage-main-server`
Dashboard repository: `vantage-admin`

## Purpose

This folder is the implementation authority for the production Operations
Registry initiative. It replaces unresolved recommendations in the earlier
pre-implementation documents with decisions approved during the owner
interview.

Read these documents in order:

1. [Operations Registry specification](./01-operations-registry-specification.md)
   defines scope, owner behavior, invariants, and acceptance criteria.
2. [Data model, API, and runtime contracts](./02-data-model-api-and-runtime-contracts.md)
   defines the target collections, commands, queries, resolution results, and
   dashboard behavior.
3. [Implementation plan and branch handoffs](./03-implementation-plan.md)
   defines work packages, dependencies, branch rules, merge gates, and the
   subagent handoff format.
4. [Migration, testing, rollout, and rollback](./04-migration-testing-rollout.md)
   defines production-only backfills, verification, cutover order, and safety
   checks.

Background references:

- [Pre-implementation plan](../operations-registry-pre-implementation-plan.md)
- [Platform direction](../operations-registry-platform-direction.md)
- [`Agent` model](../../src/models/Agent.ts)
- [`Merchant` model](../../src/models/Merchant.ts)
- [`LeadSourceCompany` model](../../src/models/LeadSourceCompany.ts)
- [Current CPL service](../../src/services/cpl/cplRate.service.ts)
- [Current Source Company service](../../src/services/leadSourceCompanies/leadSourceCompany.service.ts)
- [Current RingCentral static routing](../../src/services/ringcentral/call-lead-sources.ts)
- Dashboard [Settings tabs](../../../vantage-admin/components/settings/settings-tabs.tsx)

If a background document conflicts with this folder, this folder wins.

## Approved scope

The implementation covers the production `vantagemovers` database and:

- Agents with one embedded immutable Granot username
- Merchants
- Source Companies
- First-class form/call Source Granularities
- Effective-dated CPL schedules
- Production CPL correction jobs
- RingCentral inbound routes and assignment history
- Registry audit history and health
- Server runtime consumption
- Owner editing and authenticated read views in `vantage-admin`

The implementation does not read, migrate, or modify:

- `vantagemovershistorical`
- `src/models/historical/*`
- historical-dashboard scope behavior
- Moving Carriers
- External Data Ingestion
- historical database consolidation
- dynamic RingCentral qualification contracts
- future-scheduled RingCentral route changes

The existing `lead.cpl` values in both production and historical data remain
unchanged during ordinary schedule migration and editing.

## Authority and change control

- MongoDB is the Operations Registry system of record.
- Registry mutations are owner-only.
- Other authenticated dashboard roles may read registry state and health.
- Runtime services use registry query/resolver interfaces and cannot mutate
  registry configuration.
- The dashboard never hard-deletes registry records in this release.
- Any material departure from an approved invariant requires an owner decision
  and an update to these documents before implementation continues.
- New domain language or architectural decisions must also update the root
  glossary/ADR layer as required by the server repository rules.

## Branch and handoff rules

There are two approved execution modes.

### Parallel worktree mode

Use repository-specific `feature/operations-registry` integration branches.
Each subagent works in its own worktree and work-package branch. The
coordinating agent alone merges completed work into the integration branch.

### Sequential isolated-branch mode

Use one isolated work-package branch at a time. Complete its tests and handoff,
merge it into the repository integration branch, then branch the next package
from the updated integration head. This is slower and is the preferred fallback
when worktree isolation is not deliberately enabled.

For both modes:

- `vantage-main-server` and `vantage-admin` are separate Git repositories.
- Never make an Operations Registry branch in
  `granot_sync_extensions_and_services`; it is outside this implementation
  scope and may contain unrelated work.
- Start by recording `git status --short`, the current branch, and base commit.
- Preserve unrelated working-tree changes.
- One work package owns a coherent set of files; avoid overlapping branch
  ownership.
- Do not merge a branch with failing focused tests or typecheck.
- Do not push, deploy, run a production mutation, or merge to `main` without
  explicit owner authorization at that stage.
- Merge work branches into the integration branch only after the handoff is
  complete.
- Merge integration branches into each repository's `main` only after the
  cross-repository acceptance gate passes.
- The RingCentral production backfill/validation gate must run before pushing
  or deploying registry-only RingCentral consumers.

## Required handoff contents

Every work-package handoff must state:

```text
Repository:
Branch:
Base commit:
Head commit:
Work package:
Specification sections satisfied:
Files changed:
Schema/index changes:
API contract changes:
Compatibility behavior:
Commands/tests run and results:
Migration or environment requirements:
Rollback point:
Known risks or follow-up work:
Recommended next branch:
```

The receiving agent must compare the handoff against the branch diff and rerun
the package's required validation before merging.

## Definition of ready for implementation

Implementation may begin when:

- both repositories have clean or understood working trees;
- integration branches or the sequential branch strategy have been selected;
- the coordinator assigns non-overlapping package ownership;
- shared API types and migration ordering are understood;
- no agent assumes permission to contact production services;
- production database and RingCentral steps remain explicit manual gates.
