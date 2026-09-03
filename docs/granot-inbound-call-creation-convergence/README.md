---
type: Delivery Pack
title: Inbound Call create_if_missing and RingCentral convergence — delivery index
description: >-
  Navigation and status ledger for inbound Granot Call create_if_missing
  playing with RingCentral Call Qualification: priority_updated create,
  RingCentral-first synchronize, Granot-first adopt.
tags:
  - granot-lifecycle
  - ringcentral
  - call-lead
  - delivery
status: ready
stale_after: 2026-12-02
owners: [team:main-server]
applies_to:
  - src/services/granotLifecycle/**
  - src/services/ringcentral/**
---

# Inbound Call create_if_missing and RingCentral convergence

> **Reversed 2026-09-03.** Call create is `lead_created` only again. Mapped
> inbound Granot CRM Sources (Main Site / 10best / TBM Prime / Top10) return
> to `link_only`. Best Relocation Forms and Inbounds keep `create_if_missing`.
> RingCentral-first synchronize, Granot-first adoption, and the always-on
> Granot phone fence stay.

Three shippable issues. This pack follows
`docs/booking-intake-lead-attachment/`: same fourteen-section issue
contract, same rule that **repository state is authoritative and the
ledger is a navigation aid**.

Start here → [`AGENT-PROTOCOL.md`](AGENT-PROTOCOL.md) → your issue →
record the result in [`PROGRESS.md`](PROGRESS.md).

This pack does **not** change Call Qualification, create on
`booking_status_changed`, add a fourth `lead_created_policy` value,
enable production flags, or apply a production Registry policy flip.
`create_if_missing` stays the only “Granot may mint” knob.

## Authorities

Resolve paths from the `vantage-main-server` repository root.

| Order | Authority |
| --- | --- |
| 1 | [`granot-inbound-call-creation-convergence-specification.md`](granot-inbound-call-creation-convergence-specification.md) — **wins on every conflict** for this pack |
| 2 | FINAL SPEC §16 / §17 and shipped UNIT-19 / UNIT-20 — create command, ingest order, exact adoption |
| 3 | Current repository code, migrations, and tests |
| 4 | Workspace-root `CONTEXT.md` |
| 5 | This pack's issues — sequencing and scope only |

Where this pack and the specification disagree, the specification wins
and the issue author fixes this pack in the same change.

## Session map

| Session | Issue | Why this size |
| --- | --- | --- |
| **1** | [GICC-01](issues/GICC-01.md) | Event-class gate. Without it, inbound create never runs. |
| **2** | [GICC-02](issues/GICC-02.md) | Both arrival orders and the always-on phone fence. |
| **3** | [GICC-03](issues/GICC-03.md) | Knowledge + Owner checklist. No production apply. |

Do not start GICC-02 before GICC-01 is `complete`. Do not start GICC-03
before GICC-02 is `complete`.

## Language

Use workspace-root `CONTEXT.md`. Say Call Lead, Call Qualification,
Call Lead Ingestion, Caller Match Key, Source Granularity, Granot CRM
Source, Ingestion Origin, Duplicate Lead, RingCentral Call Adoption.
Do not say “upsert” in Owner-facing text — say synchronize. Do not say
company-only match when the locked key is Source Granularity + phone.
