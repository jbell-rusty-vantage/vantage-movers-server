---
type: Delivery Pack
title: Operations Registry source connections and Owner UI — delivery index and pass ledger
description: Navigation and status ledger for the four-pass delivery of typed label mappings, the Granot name Owner command, the aggregate Lead Source projection, and the Owner UI.
tags:
  - operations-registry
  - source-attribution
  - granot
  - ringcentral
  - owner-ui
  - delivery
status: ready
stale_after: 2026-11-24
owners: [team:main-server, team:vantage-admin]
applies_to:
  - src/models/LeadSourceCompany.ts
  - src/models/LeadSourceGranularity.ts
  - src/models/LeadSourceLabelMapping.ts
  - src/models/GranotCrmSource.ts
  - src/models/RingCentralInboundRoute.ts
  - src/models/RingCentralInboundRouteAssignment.ts
  - src/services/operationsRegistry/**
  - ../vantage-admin/components/operations-registry/**
---

# Operations Registry source connections and Owner UI — delivery pack

Four passes delivering
[`operations-registry-source-connections-owner-ui-specification.md`](../operations-registry-source-connections-owner-ui-specification.md).
This pack follows the conventions of the Owner Daily Operations pack
(`docs/owner-daily-operations/`): same fourteen-section issue contract, same
report-first migration discipline, same rule that **repository state is
authoritative and this ledger is a navigation aid**.

Start here → [`AGENT-PROTOCOL.md`](AGENT-PROTOCOL.md) → your pass issue →
record the result in [`PROGRESS.md`](PROGRESS.md).

## Authorities

Resolve paths from the `vantage-main-server` repository root.

| Order | Authority |
| --- | --- |
| 1 | [`docs/operations-registry-source-connections-owner-ui-specification.md`](../operations-registry-source-connections-owner-ui-specification.md) — **wins on every conflict** |
| 2 | Current repository code, migrations, tests, and flags — the actual seam each pass extends |
| 3 | `docs/knowledge/services/operations-registry.md` — the existing Service concept |
| 4 | `.cursor/rules/project-organization.mdc` — routes stay thin, logic lives in `src/services/<domain>/` |
| 5 | This pack's issues — sequencing and scope only, never new semantics |

Where this pack and the specification disagree, the specification wins and the
pass author fixes this pack in the same commit.

## The four passes

Each pass is one complete, reviewable, independently shippable increment. No
pass leaves the repository in a state where an Owner surface lies about what is
live.

| Pass | Title | Prereqs | Repos | Status |
| --- | --- | --- | --- | --- |
| [ORS-1](issues/ORS-1.md) | Typed label mappings and collection-first source resolution | none | main-server | `ready` |
| [ORS-2](issues/ORS-2.md) | Granot name Owner command, SMS invariant, and texting company context | none | main-server | `ready` |
| [ORS-3](issues/ORS-3.md) | Aggregate Lead Source projection, single-feed setup, RingCentral DTO enrichment | ORS-1, ORS-2 | main-server | `blocked` |
| [ORS-4](issues/ORS-4.md) | Owner UI, language deck, and acceptance sweep | ORS-3 | main-server, vantage-admin | `blocked` |

Status vocabulary: `ready`, `blocked`, `active`, `complete`, `deferred`.
The live values are in [`PROGRESS.md`](PROGRESS.md); the table above is the
initial state at pack creation (2026-08-24).

## Ready queue and parallelism

- **ORS-1 and ORS-2 are both startable now and touch disjoint files.** ORS-1
  owns `lead_source_label_mappings`, `sourceResolution.ts`, and the sheet/legacy
  read path. ORS-2 owns `granotCrmSources.ts`, `crmSourceOutboundSms.ts`, and
  the Granot write/`lead_created` path. Two agents can run them concurrently.
  They collide in exactly two files — `queries/health.ts` and `v1.routes.ts` —
  and each issue names the append-only seam to use there.
- **ORS-3 is gated on both.** Its projection reads the label mappings ORS-1
  creates and the Granot policy/text state ORS-2 normalizes. Starting it early
  produces a projection that must be rewritten.
- **ORS-4 is gated on ORS-3 only.** The Owner UI consumes the aggregate
  projection; building it against the current low-level list endpoints
  reconstructs exactly the join the specification is removing.

Minimum wall-clock path is therefore **three sequential steps** — `(ORS-1 ‖
ORS-2) → ORS-3 → ORS-4` — inside a four-pass budget.

## Why the removals are not in the four passes

Specification §9.7–9.8 — removing the static runtime maps, the embedded
`LeadSourceCompany.granularities[]`, and the obsolete indexes — is deliberately
**outside this budget**. Those removals are gated on a soak: compatibility reads
must stay at zero for an agreed observation window before anything is deleted.
That window is calendar time, not engineering work, and it cannot be compressed
into a pass.

The four passes deliver everything buildable, plus the instrumentation that
makes the removal safe and its readiness visible in Registry Health. ORS-4 opens
the observation window and records its start; the removal is a separately
reviewed migration afterwards.

## Standing constraints for every pass

These apply to all four issues and are not repeated as scope in each one.

- **No production mutation, SMS activation, production index apply, production
  deploy, live payload read, or external send is authorized by this pack.**
  Specification §9 closing line is binding.
- Report-first migrations: collision report, then an explicit authorized apply.
  Never implicit `autoIndex`. Follow
  `scripts/migrations/operations-registry-inventory.lib.ts`, which already has
  `assertNoApplyFlag` and `assertInventoryDatabaseAllowed`.
- Build the server contract first. Admin consumes exported, tested DTOs. Admin
  types are never the semantic authority.
- Runtime reads against a database require `TEST_MODE=true` and an explicit test
  database (`testvantagemovers`).
- Preserve unrelated and user changes in both repositories.
- Existing audited commands remain mutation authority. New read projections add
  no write path.
- Fail closed. No fuzzy matching in any runtime path; fuzzy exists only as an
  Owner-confirmed suggestion in a form.

## Verified current state at pack creation

Observed 2026-08-24. **Reverify at implementation** — each issue's §4 repeats
the subset it depends on.

- `src/services/operationsRegistry/` exists with `sourceResolution.ts`,
  `granotCrmSources.ts`, `crmSourceOutboundSms.ts`, `ringCentralRegistry.ts`,
  and `queries/health.ts`.
- `src/models/LeadSourceLabelMapping.ts` **does not exist**.
- `src/config/domain/sources.ts` is 280 lines and still holds
  `SOURCE_LABEL_TO_COMPANY`. Live importers: `services/analytics/analyticsFilters.ts`,
  `services/analytics/sourceHierarchy.ts`, `services/cpl/cplRate.service.ts`,
  `services/crm/formLeadPayload.ts`, `services/ringcentral/call-lead-sources.ts`.
- There is **no** `POST /api/v1/admin/granot-crm-sources`. `v1.routes.ts:362-375`
  mounts list, detail, update, activation, outbound-sms, and outbound-sms/recent.
  `src/routes/granot-crm-sources.routes.test.ts` exists without a sibling
  routes file — registry routes are mounted inline in `v1.routes.ts`.
- `queries/health.ts` already emits `registry.compatibility_reads_remaining`,
  `registry.source_resolution_failures`, `registry.ringcentral_assignment_inconsistent`,
  `registry.source_granularity_inactive_company`, and `registry.source_default_invalid`.
  It emits **no** Granot CRM Source semantic finding.
- `GranotCrmSource.ts` carries `lifecycle_disposition`, `lead_created_policy`,
  `lead_source_company`, `lifecycle_routes[]` (with `route_key`,
  `source_granularity_id`), the legacy CSV `source_company`, and
  `outbound_sms.daily_cap` (`default: 0`, `min: 0`).
- `daily_cap` is written by `v1.routes.ts:1171` and
  `crmSourceOutboundSms.ts:160,276`, validated in `admin.validation.ts:334`, and
  **read by no send path**.
- `scripts/migrations/operations-registry-inventory.lib.ts` (1009 lines) already
  models `STATIC_AUTHORITY_REFERENCES`, `GranularityInventoryRecord`,
  `SourceCompanyInventoryRecord`, and `collectInventoryCollisions`. Extend it;
  do not write a second inventory.
- Admin: `vantage-admin/components/operations-registry/` has
  `source-companies-manager.tsx`, `granot-crm-sources-manager.tsx`,
  `registry-health-findings.tsx`, `registry-shell.tsx`, and `ringcentral/`
  (`route-detail.tsx`, `route-editor.tsx`, `reassign-dialog.tsx`,
  `assignment-history.tsx`, `validation-status.tsx`). Single page entry:
  `app/(dashboard)/operations-registry/page.tsx`. There is **no**
  `lead-sources` surface.

## Layout

```text
docs/operations-registry-source-connections/
├── README.md            ← you are here: authorities, passes, constraints
├── AGENT-PROTOCOL.md    ← how to pick up a pass and hand it off
├── PROGRESS.md          ← live ledger; the only file every pass must update
├── issues/
│   ├── ORS-1.md … ORS-4.md
└── reports/             ← one completion report per pass
```
