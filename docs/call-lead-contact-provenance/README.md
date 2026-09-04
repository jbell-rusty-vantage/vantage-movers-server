---
type: Delivery Pack
title: Call Lead contact provenance — delivery index and session ledger
description: >-
  Navigation and status ledger so implementer agents lock Call Lead
  operational phone to the ingested caller, coalesce Granot contact on
  granot_contact_snapshot by Job Number, and skip competing phone identity
  after Job bind.
tags:
  - call-lead
  - granot-lifecycle
  - enrichment
  - delivery
status: ready
stale_after: 2026-12-04
owners: [team:main-server]
applies_to:
  - src/services/granotLifecycle/**
  - src/services/enrichment/callLeadEnrichment.service.ts
  - docs/knowledge/granot-lifecycle/**
  - docs/knowledge/services/call-lead.md
---

# Call Lead contact provenance — delivery pack

Four required issues plus one deferred Owner-desk issue. This pack follows
`docs/booking-intake-lead-attachment/` and
`docs/granot-inbound-call-creation-convergence/`: same fourteen-section
issue contract, same rule that **repository state is authoritative and
this ledger is a navigation aid**.

Start here → [`AGENT-PROTOCOL.md`](AGENT-PROTOCOL.md) → your issue →
record the result in [`PROGRESS.md`](PROGRESS.md).

This pack does **not** mint on `priority_updated` or
`booking_status_changed`, enable Lead-write flags, add Call snapshot
phone to processor identity, or require booking-intake Call snapshot
search.

## Authorities

Resolve paths from the `vantage-main-server` repository root.

| Order | Authority |
| --- | --- |
| 1 | [`call-lead-contact-provenance-specification.md`](call-lead-contact-provenance-specification.md) — **wins on every conflict** |
| 2 | Current repository code, migrations, and tests |
| 3 | Workspace-root `CONTEXT.md` |
| 4 | This pack's issues — sequencing and scope only |

Where this pack and the specification disagree, the specification wins
and the issue author fixes this pack in the same change.

## Session map

| Session | Issue | Why this size |
| --- | --- | --- |
| **1** | [CLCP-01](issues/CLCP-01.md) | Stop overwriting live contact. Snapshot coalesce. |
| **1 or 2** | [CLCP-02](issues/CLCP-02.md) | Job-wins identity. Needed so later Granot phones do not conflict. |
| **2** | [CLCP-03](issues/CLCP-03.md) | CSV/preview must not undo CLCP-01. |
| **3** | [CLCP-04](issues/CLCP-04.md) | Knowledge. No [REDACTED] apply. |
| — | [CLCP-05](issues/CLCP-05.md) | Deferred. Owner desk search/display only. |

Do not start CLCP-02 before CLCP-01 is `complete`. Do not start CLCP-03
before CLCP-01 is `complete`. Do not start CLCP-04 before CLCP-02 and
CLCP-03 are `complete`. Do not start CLCP-05 unless `PROGRESS.md` marks
it `ready`.

## Language

Use workspace-root `CONTEXT.md`. Say Call Lead, Caller Match Key, Source
Granularity, Ingestion Origin, Job Number, Granot Contact Snapshot.
Operational phone is the ingested caller. Do not say “upsert” — say
synchronize. Do not say company-only match when the locked key is Source
Granularity + phone.

## Unit ledger

Status vocabulary: `ready`, `blocked`, `active`, `complete`, `deferred`.
Live values live in [`PROGRESS.md`](PROGRESS.md).

| Issue | Title | Prerequisites | Status | Contract |
| --- | --- | --- | --- | --- |
| [CLCP-01](issues/CLCP-01.md) | Planner + synchronize: snapshot-only Call contact | spec | ready | ready |
| [CLCP-02](issues/CLCP-02.md) | Call identity: Job wins, skip competing phone | CLCP-01 | blocked | ready |
| [CLCP-03](issues/CLCP-03.md) | CSV / preview: no live name/email | CLCP-01 | blocked | ready |
| [CLCP-04](issues/CLCP-04.md) | Knowledge and BILA pointer | CLCP-02, CLCP-03 | blocked | ready |
| [CLCP-05](issues/CLCP-05.md) | Optional Owner desk any-known-contact | Owner un-defer | deferred | ready |

## Standing constraints for every issue

- **No mint** on `priority_updated` or `booking_status_changed`.
- **No** Call `granot_contact_snapshot` query in processor identity.
- **No** effect-flag enablement. Do not change `sourcePolicy.ts`.
- **No** Source Company-only match.
- **No** booking-intake Call `q` change in CLCP-01–04.
- Synthetic data only. No commit/push/deploy unless the user asks
  (Cloud Agent runs that already have a PR workflow follow that
  workflow; still no live-cluster apply).
- Glossary words only. Owner-facing UI (if CLCP-05) uses `Called`
  / `Granot` / `Changed in Granot` — never snapshot field names.
