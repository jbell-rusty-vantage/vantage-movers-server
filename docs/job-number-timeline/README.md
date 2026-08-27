---
type: Delivery Pack
title: Job Timeline Enhancement — delivery index and session ledger
description: Navigation and status ledger for the four-session production enhancement of the Owner Job Number timeline. Window-wide Daily Assurance and notifications stay out of this pack.
tags:
  - job-number
  - owner-dashboard
  - lifecycle
  - provenance
  - delivery
status: ready
stale_after: 2026-11-27
owners: [team:main-server, team:vantage-admin]
applies_to:
  - src/services/jobNumberTimeline/**
  - src/routes/job-number-timeline-admin.routes.ts
  - scripts/prototypes/job-number-timeline/**
  - vantage-admin/app/(dashboard)/job-timeline/**
  - vantage-admin/components/job-number-timeline/**
---

# Job Timeline Enhancement — delivery pack

Four shippable sessions that turn the existing typed Job Number timeline into
the Owner's precise, evidence-aware lifecycle story. This pack follows the
conventions of `docs/operations-registry-source-connections/` and
`docs/owner-daily-operations/`: same fourteen-section issue contract, same
rule that **repository state is authoritative and this ledger is a navigation
aid**.

Start here → [`AGENT-PROTOCOL.md`](AGENT-PROTOCOL.md) → your issue → record
the result in [`PROGRESS.md`](PROGRESS.md).

This pack ships the honest enhanced timeline. It does **not** start Owner
Daily, Daily Assurance, or notifications.

## Authorities

Resolve paths from the `vantage-main-server` repository root.

| Order | Authority |
| --- | --- |
| 1 | [`job-timeline-enhancement-specification.md`](job-timeline-enhancement-specification.md) — **wins on every conflict** for additive enhancement behavior |
| 2 | [`scripts/prototypes/job-number-timeline/specs/job-number-timeline-prototype-specification.md`](../../scripts/prototypes/job-number-timeline/specs/job-number-timeline-prototype-specification.md) — **wins on event truth, correlation, and masking** until this enhancement spec is explicitly amended with migration tests |
| 3 | Current repository code, migrations, and tests — the actual seam each session extends |
| 4 | [`docs/knowledge/services/job-number-timeline.md`](../knowledge/services/job-number-timeline.md) — current Service concept (`src/services/jobNumberTimeline/` is primary; the prototype folder is a retained CLI/proof adapter) |
| 5 | `.cursor/rules/project-organization.mdc` and `.cursor/rules/job-number-timeline.mdc` |
| 6 | `vantage-admin/uxdocs/HANDOFF-job-timeline-enhancement.md` — Admin-side orientation |
| 7 | This pack's issues — sequencing and scope only, never new semantics |

Where this pack and the enhancement specification disagree, the specification
wins and the issue author fixes this pack in the same change.

## Session map (3–4 quality sessions)

| Session | Issues | Repos | Why this size |
| --- | --- | --- | --- |
| **1** | [JTE-01](issues/JTE-01.md) | main-server | Mechanical extract. Byte-for-byte v1. Highest risk if mixed with new behavior. |
| **2** | [JTE-02](issues/JTE-02.md) then [JTE-03](issues/JTE-03.md) | main-server | One server session: v2 contract, then evaluators on that contract. |
| **3** | [JTE-04](issues/JTE-04.md) | vantage-admin | Owner UI over the already-tested v2 page. |
| **4** | [JTE-05](issues/JTE-05.md) | both | Proof, a11y, performance, deep links. Short if session 3 is clean. |

If session 2 finishes JTE-02 with time and a green suite, start JTE-03 in the
same session. If session 3 is clean, start JTE-05 immediately. Do not start
JTE-02 in session 1, and do not start Admin work before JTE-03 has golden
pages.

[JTE-06](issues/JTE-06.md) and [JTE-07](issues/JTE-07.md) improve evidence
quality. They are **not** in the four-session ship path.

## Unit ledger

Status vocabulary: `ready`, `blocked`, `active`, `complete`, `deferred`.
Live values live in [`PROGRESS.md`](PROGRESS.md).

| Issue | Title | Prerequisites | Status | Contract |
| --- | --- | --- | --- | --- |
| [JTE-01](issues/JTE-01.md) | Extract deep runtime module; route and CLI use it | current timeline | complete | complete |
| [JTE-02](issues/JTE-02.md) | v2 types, dual clocks, evidence/correlation/activity, source receipt | JTE-01 | ready | complete |
| [JTE-03](issues/JTE-03.md) | Outcome, stage assessment, attention, limitations, freshness | JTE-02 | blocked | complete |
| [JTE-04](issues/JTE-04.md) | Enhanced Owner UI and evidence expansion | JTE-03 | blocked | complete |
| [JTE-05](issues/JTE-05.md) | Live proof, security, accessibility, performance, deep links | JTE-04 | blocked | complete |
| [JTE-06](issues/JTE-06.md) | Cancellation correlation snapshots and report-first backfill | JTE-02; separate write approval | deferred | complete |
| [JTE-07](issues/JTE-07.md) | WordPress durable receipt capture | separate source-assurance approval | deferred | complete |

## Ready queue

- **JTE-01 is complete.** The production module seam exists at
  `src/services/jobNumberTimeline/`.
- **JTE-02 is the only startable issue.** JTE-03 stays blocked until JTE-02
  closes. Do not parallelize them. JTE-03 consumes the v2 event fields
  JTE-02 adds.
- **JTE-04 is Admin-only** once JTE-03 has exported, tested golden pages.
  Admin types are never the semantic authority.
- **JTE-05 does not invent new semantics.** It certifies and links.
- **JTE-06 and JTE-07 stay deferred** until the Owner authorizes a write-path
  change. The honest timeline ships without them.

## Standing constraints for every issue

These apply to all issues and are not repeated as scope in each one.

- **Read-time projection only.** No second event stream, no `OperationalEvent`,
  no `lead_lifecycle_events` collection, no mutation of Leads, Bookings,
  Cancellations, cases, Decisions, or Sheet Sync jobs.
- **The Timeline sends no notification** and performs no reconciliation write.
- **Owner-only at both gates** — server `requireRegistryOwnerActor` and Admin
  `canProxyVantagePath` / `OWNER_ONLY_PAGE_PREFIXES`.
- **No contact, SMS body, transcript, recording URL, provider payload, Sheet
  ID, Sheet row, or raw error body** in any response, fixture, log, report, or
  issue text.
- **No inferred events.** Derivation may summarize facts; it must name its
  inputs. No `inferred` evidence level.
- **Intake is never the official outcome.** Official Booking and official
  Cancellation stay independently visible.
- **Latest Synchronization Decision attempt only.** Sheet Sync joins by entity
  ID, never Job Number. Equivalent Job Number search stays as the prototype
  specified.
- **No Job Number catalog**, dropdown, or unbounded distinct query. No
  `$lookup` on the hot route.
- **Daily Assurance is a later module.** Do not add window totals, source-wide
  completeness, Google destination read-back, or notification policy here.
- Build the server contract first. Admin consumes exported, tested DTOs.
- Runtime reads against a database require `TEST_MODE=true` and
  `testvantagemovers`. Production reads require the existing CLI confirm flag.
- No commit, push, deploy, production flag change, live payload read, or
  external send unless the user explicitly asks.
- After runtime TypeScript changes: `pnpm test` and `pnpm typecheck` in the
  repos you touched.

## What this pack deliberately does not do

- Owner Daily View (`/daily`) or Owner Daily Assurance.
- Event-driven email, SMS, push, or in-app notification delivery.
- Move completion as a stage.
- Replacing the forensic Granot lifecycle screen.
- Automatic repair, retry, or reconciliation.
- Customer conversation transcript or call recording.

## Verified current state

Observed at pack creation 2026-08-27; **reverified after JTE-01** the same
day. Each issue's §4 repeats the subset it depends on.

- Production HTTP route `src/routes/job-number-timeline-admin.routes.ts` is
  authorize → validate → `createJobNumberTimelineModule({ loader }).read` →
  respond. Redaction is inside the module. Primary code:
  `src/services/jobNumberTimeline/`. No file under `src/` imports
  `scripts/prototypes/job-number-timeline`. The prototype folder is a
  retained CLI/proof adapter (`cli.ts` `render` / `discover` call the
  module; `discover.ts` is ranking only; `load.ts` is DB-name /
  production-confirm helpers only).
- Route is Owner-only, mounted after the `/api/v1` guard in `v1.routes.ts`.
  Envelope `{ ok: true, data: JobTimelineAssembleResult }`. Success HTTP is
  always `200`, including `not_found` / `filtered_out` / `invalid_job_number`.
  v1 response contract is unchanged.
- Eleven event kinds. No `source_received`. Coverage chips are
  present/absent. No `schema_version`, stages, dual clocks, activities,
  attention, or limitations.
- Loader reads observations, latest decisions, record links, bookings,
  cancellations, booking/release cases, discrepancies, leads, entity changes,
  lead messages, sheet sync jobs, Granot CRM sources, and granularities. It
  does **not** load Observation Receipts as first-class rows, RingCentral
  `ringcentral_processed_calls`, or `ringcentral_call_log_sync_state`.
- CLI: `pnpm prototype:job-number-timeline` modes `render` and `discover`
  only. Tests: `pnpm test:prototype:job-number-timeline`.
- Admin `/job-timeline` exists and renders v1 `JobTimelinePage` via
  `lib/api/jobNumberTimeline.ts`. Coverage chips live in
  `coverage-chips.tsx`. Headlines are locked. There is no catalog.

## Layout

```text
docs/job-number-timeline/
├── job-timeline-enhancement-specification.md   ← the contract
├── README.md                                   ← you are here
├── AGENT-PROTOCOL.md
├── PROGRESS.md
├── issues/
│   ├── JTE-01.md … JTE-07.md
└── reports/                                    ← one completion report per issue
```
