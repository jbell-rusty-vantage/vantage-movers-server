---
okf_version: "0.2"
type: Service
title: Sales Outreach Desk
description: Deterministic New/Quoted lead-outreach cadence, rep daily call goals and the scoped desk API behind Admin /outreach-desk. Draft while the build lanes land.
status: draft
tags: [sales-outreach]
resource: src/services/salesOutreach/
applies_to:
  - src/services/salesOutreach/**
owners: [team:main-server]
---

# Sales Outreach Desk (draft, sod-v1)

Business rules: `docs/sales-outreach-desk/SPECIFICATION.md` §§2–14 and `FINAL-POLICY-REVIEW.md`. Build plan: `docs/sales-outreach-desk/IMPLEMENTATION-PLAN.md`. Each build lane owns its own section below.

## S2 — Cadence engine (`src/services/salesOutreach/engine/`)

`evaluateSubject(input, policy, as_of)` is pure: it never reads the clock, Mongo, env or a provider, and it calls no model. Callers load facts, call it and persist the result only when `fingerprint` changed. Import everything from `engine/index.ts`.

**Inputs** (`engine/types.ts`, `EvaluateSubjectInput`): subject facts (`received_at` from the restored `leadInstant` adapter, move date, `activation_at` boundary, priority-uncertainty flag, originating answered-inbound event), every policy period (`workflow` new/quoted/discretion/none/closed, `start_kind` intake/transition/activation), every human plan with its command lifecycle (Quoted dates are period-scoped, timed callbacks are subject-scoped), restriction intervals, assignment history, normalized contact events (`sales_outreach_contact_events` shape) and per-channel coverage (`complete_through`, settlement allowance already applied).

**Policy**: the `cadence` namespace of `sales_outreach_configuration`, encoded by `engine/policy.ts` (`cadenceConfigurationValueSchema`, strict, every field nullable for bootstrap). `resolveEnginePolicy` fails closed with `CONFIGURATION_UNAVAILABLE` and every reason; there is no default and no env fallback. `engine/approvedStartingValues.ts` holds the FINAL-01 install payload for the install script only.

**What it computes** — the whole requirement history of the subject, recomputed each call:

1. Obligations: New arrival date (initial response = first call deadline, 18:00/19:30 caps, SMS through 19:30), full New days by age band (12:00/20:00, then 20:00) and fixed SMS days 1/2/3/6/9…, partial start dates after a transition or activation (prior same-date calls subtracted, all due 20:00, no initial clock), Quoted days from the selected date or next-working-date default, callbacks (15-minute window), the 30-working-minute initial response (carries across closing/closed dates, pauses during call restrictions).
2. Terminations in precedence order (P06f): period end/closure (superseded/cancelled) → restriction waiver/resume or blocked callback → callback suspension of routine calls → cutover guard (nothing due before activation; pre-activation past-due callbacks → `legacy_review`).
3. A chronological walk over confirmed, unrestricted events with the P02e spacing anchor (moves only on a credited call). One event can satisfy a callback (spacing does not apply), the initial response, the period's channel catch-up and one ordinary requirement.
4. Outcomes at `as_of`: `fulfilled`, `fulfilled_late` (miss kept), `open`, `overdue`, `missed`, `pending` (coverage does not reach the deadline or unconfirmed evidence exists — never a guessed miss), and the no-miss terminations.
5. Summary: independent Call and SMS requirements (CONTRACTS channel block), bounded catch-up per channel (P06a), flags (`needs_contact`, `overdue`, `blocked`, `pending`, move-date review, advisory cooldown, inherited overdue…), responsibility at each deadline (P06d), `next_evaluation_at`, last 30 business dates of window history.

**Shared with S3** (`engine/credit.ts`): `classifyCallEvidence` / `classifySmsEvidence` (P07a–P07e, IMPL-06/07), `isCadenceQualifying`, `goalCreditAgent` / `goalCreditsByAgent` (initiator-only, start-date, never spacing- or window-dependent), `selectSpacedStarts`, `repDayGoal` / `summarizeTeamGoals` (P08a arithmetic).

**Shared with S1**: `validateQuotedSelection` (P04c command validation), `BusinessCalendar` (DST-safe New York dates via `Intl`; next day by calendar arithmetic, never +24 h), `resumeInstant` (P06c), `cadenceConfigurationValueSchema`.

Tests: one suite per contract fixture (`engine/*.test.ts`), END-TO-END-RUN §3 rows as named tests (`endToEndScenarios.test.ts`), DST/midnight and determinism cases. Evidence: `docs/sales-outreach-desk/workspace/evidence/S2.md`.
