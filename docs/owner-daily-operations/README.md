---
type: Delivery Pack
title: Owner Daily Operations View — delivery index and unit ledger
description: Navigation and status ledger for the nine-unit Owner Daily Operations View sprint, which begins on a new branch after the Granot Lead Lifecycle sprint completes.
tags:
  - owner-dashboard
  - granot
  - ringcentral
  - delivery
status: draft
stale_after: 2026-11-19
owners: [team:main-server, team:vantage-admin]
applies_to:
  - src/services/ownerDaily/**
  - src/services/conversations/**
  - vantage-admin/app/(dashboard)/daily/**
---

# Owner Daily Operations View — delivery pack

Nine units delivering the Owner's daily operational dashboard. This pack follows
the conventions of the Granot Lead Lifecycle delivery pack
(`scripts/prototypes/granot-lead-lifecycle/delivery/`) — same fourteen-section
issue contract, same report-first migration discipline, same rule that
repository state is authoritative and this ledger is a navigation aid.

## Sequencing

**This sprint starts on a new branch after the Granot Lead Lifecycle sprint.**
Proposed branch name `owner-daily-operations` in both repositories; the Owner
confirms it at kickoff. Nothing here is authorized to start while
`granot-lead-lifecycle` is open.

## Authorities

Resolve paths from the `vantage-main-server` repository root.

| Order | Authority |
| --- | --- |
| 1 | [`docs/granot-lead-lifecycle/owner-daily-operations-view-specification.md`](../granot-lead-lifecycle/owner-daily-operations-view-specification.md) — **wins on every conflict** |
| 2 | Current repository code, migrations, tests, flags, and completed Granot unit reports — the actual seam each unit extends |
| 3 | `.cursor/rules/project-organization.mdc`, `.cursor/businesslogic/granotLifecycle.*.md`, `CONTEXT.md` |
| 4 | `vantage-admin/uxdocs/owner-daily-view-planned.txt` — **illustrative wireframes only**, never a contract |
| 5 | `vantage-admin/uxdocs/HANDOFF-owner-daily-view.md` — Admin-side orientation |

Where a wireframe and the specification disagree, the specification wins.

## Unit ledger

Status vocabulary matches the Granot pack: `ready`, `blocked`, `active`,
`complete`, `deferred`, `optional`.

| Unit | Title | Prerequisites | Status | Contract |
| --- | --- | --- | --- | --- |
| [A](issues/ODV-A.md) | Daily window contract, capability projection, and Overview | Granot 22–25 landed | ready | complete |
| [B](issues/ODV-B.md) | Leads, Completed Bookings, Completed Cancellations, and the detail drawer | A | blocked | complete |
| [C](issues/ODV-C.md) | Live feed cursor endpoint, `useDailyFeed`, and the live indicator | A | blocked | complete |
| [D](issues/ODV-D.md) | `LeadConversation` model, redactor, read routes, and one seeded conversation | A | blocked | complete |
| [E](issues/ODV-E.md) | Conversations tab, drawer conversation panel, and audited audio URL | D | blocked | complete |
| [F](issues/ODV-F.md) | Agent metrics | A | blocked | complete |
| [G](issues/ODV-G.md) | Booking Intake and Cancellation Intake tabs | A; Granot 26 for cancellations | blocked | complete |
| [H](issues/ODV-H.md) | Automated conversation pipeline | D, E, **Section 7 gates cleared** | **deferred** | complete |
| [I](issues/ODV-I.md) | SSE transport swap | C | optional | complete |

## Current ready queue

- **A is the only startable unit**, and only after the Granot sprint closes and
  the new branch exists. Everything else depends on A's window contract,
  capability projection, or cursor conventions.
- **B, C, D, F can run in parallel once A lands.** They touch disjoint services
  and disjoint Admin components. B and D both extend the drawer; B owns the
  drawer shell and its Details/Provenance tabs, E owns the Conversation tab.
- **G is gated twice.** The Booking Intake half is buildable immediately after A
  but renders `not_activated` until `GRANOT_LIFECYCLE_BOOKING_CASES_ENABLED` is
  turned on. The Cancellation Intake half needs Granot Unit 26 (Release
  Reconciliation) to exist at all.
- **H is deferred by Owner decision on 2026-08-19**, not by engineering
  readiness. Its gates are specification §5.0 and §7: recurring cost
  authorization, retention policy, the six RingCentral console lookups in §7.2,
  the PCI position in §7.3, and counsel answers to §7.4 questions 1–3. **Do not
  merge H forward early** — the moment a discovery cron exists, the cost and
  retention decisions have been made by default rather than by the Owner.
- **I is optional** and only justified if a measured 3-second poll proves
  insufficient. Do not build it speculatively.

## Decisions closed 2026-08-19

The three questions that blocked the build are answered. Specification §12.1
carries them; they are not open and should not be relitigated in an issue.

| Decision | Answer |
| --- | --- |
| Window shape | **Rolling** 24h/48h back from `now`. Not Florida business days. **No third mode.** |
| `/daily` vs `/` | **Its own page.** `/` stays `HomeOverview`, unchanged. New sidebar entry above Form Leads. |
| Cancellation Intakes | **Waits for Granot Unit 26.** The Daily View does not wait for it. |

The remaining open questions all gate ODV-H only — cost, retention, PCI, and
consent. They block nothing in Units A–G.

## Standing constraints for every unit

These repeat in each issue because each issue must be executable alone.

- **The Daily View is a reader.** Its only writes are `lead_conversations`
  records and the Owner commands it delegates to already-existing, already-gated
  Granot endpoints. No unit here changes how Leads, Bookings, Cancellations,
  Booking cases, or Decisions are written.
- **No lifecycle flag or activation posture changes.** Granot effect flags stay
  exactly as the lifecycle sprint left them.
- **`activity_at` binds every window**, never an Owner-typed business date.
  Specification §3.2 is the binding table.
- **Owner-only, both gates.** Every Daily View and conversation surface is
  Owner-only in the Admin BFF *and* independently on the server.
- **Redacted synthetic evidence only.** No live Granot payload, no real customer
  transcript, no unmasked contact in fixtures, logs, projections, reports, issue
  text, or subagent output.
- **Migrations are report-first.** Collision report, then explicit authorized
  apply. Issue authorship authorizes no production apply, deploy, commit, push,
  live payload read, or external send.
- After runtime TypeScript changes: `pnpm test` and `pnpm typecheck` in both
  repositories.

## What this sprint deliberately does not do

- No automated conversation discovery, transcription, or summarization
  (Unit H, deferred).
- No automatic action from a conversation summary. A detected CRM mismatch
  surfaces to the Owner; it never writes.
- No sentiment scoring, agent grading, or call-quality scoring.
- No replacement of the `/` analytics Overview page.
- No new Booking, Cancellation, Release, or Referral command.
