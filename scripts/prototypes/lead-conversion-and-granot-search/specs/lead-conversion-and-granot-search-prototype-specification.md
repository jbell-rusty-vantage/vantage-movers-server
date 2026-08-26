---
type: Specification
title: Lead conversion rates and Granot observation/command search prototype
description: >-
  Read-only scripts prototype that proves two Owner questions before they
  become application reports: conversion rates for successful Lead Messages
  and receiver-agent Leads, and a Job Number + route-event search over
  Granot Observations and the Domain Commands they produced.
tags:
  - analytics
  - granot-lifecycle
  - prototype
  - search
status: draft
stale_after: 2026-11-26
owners: [team:main-server]
applies_to:
  - scripts/prototypes/lead-conversion-and-granot-search/**
sources:
  - id: glossary
    resource: ../../../../../CONTEXT.md
    title: Platform glossary
  - id: analytics
    resource: ../../../../docs/knowledge/services/analytics.md
  - id: lead-messaging
    resource: ../../../../docs/knowledge/services/lead-messaging.md
  - id: capture
    resource: ../../../../docs/knowledge/granot-lifecycle/capture.md
  - id: domain-commands
    resource: ../../../../docs/knowledge/services/domain-commands.md
  - id: timeline
    resource: ../../job-number-timeline/specs/job-number-timeline-prototype-specification.md
---

# Lead conversion and Granot search prototype

> **Contract maturity: implementation-ready.** Scripts-only, read-only
> proof. No Admin route, no new collection, no production index apply.

## 1. Why this document exists

The Owner wants two new surfaces that should sit next to the Job Number
timeline, not inside it:

1. **Conversion rates** that existing Analytics does not publish:
   - among Leads whose confirmation text successfully sent, what share
     became Booked
   - among Leads received by an agent, what share became Booked, and
     what share became Cancelled
2. **A search surface** that starts at a Job Number, then a Granot route
   event (`lead_created`, `priority_updated`, `booking_status_changed`),
   then — only for `booking_status_changed` — the Granot payload
   `event_type` of `Booked` or `Releas`. Hits return the Observation plus
   the latest Synchronization Decision and any Domain Command that
   recorded that Observation as provenance. Those IDs are the seed the
   Job Number timeline can render.

Existing receiver-agent Analytics already computes `booking_rate =
booked / received` and `cancellation_rate = cancelled / booked`. This
prototype keeps the Owner's wording: both booked and cancelled rates
use **received Leads** as the denominator.

## 2. Locked decisions

1. **Successful text** is a Lead Message whose status is `accepted`,
   `sent`, or `delivered`. That is the same set the Job Number timeline
   scores. `failed`, `undelivered`, `skipped`, and in-flight statuses
   are not successful.
2. **One Lead, one vote.** Multiple successful messages for the same
   Lead count once. Join is `lead_messages.lead_ref`, never contact.
3. **Booked / Cancelled** on a Lead are the official refs
   (`form_leads.booked` / `cancelled`, same on Call Leads). This
   prototype does not `$lookup` `booked_leads` as a second source.
4. **Received by an agent** means `receiver_agent` is set. Unassigned
   Leads are out of the cohort, even if later Booked.
5. **Search is Job Number first.** The public search function is
   `searchGranotObservationsAndCommands({ job_no, event_class?,
   booking_action_event_type? })`. There is no contact search.
6. **Route class is not payload `event_type`.** `lead_created` and
   `priority_updated` filter `route_event_class`. `Booked` / `Releas`
   filter `payload_event_type_raw` (fallback `booking_action.raw`) and
   are only legal under `booking_status_changed`.
7. **Latest Decision attempt only.** Same rule as the timeline.
8. **A command belongs to an Observation** when
   `domain_command_executions.provenance.observation_id` equals that
   Observation's hex id. Commands without that provenance do not appear.
9. **Priority 5 is not Booked. A case is not a Booking.** Search
   returns evidence; it does not invent official facts.
10. **Live reads hit `vantagemovers` only**, and only with
    `--confirm-production-db=vantagemovers`. Zero writes.

## 3. Conversion rates

```text
sms_successfully_sent_then_booked
  = distinct Leads with a successful Lead Message and booked set
    / distinct Leads with a successful Lead Message

received_by_agent_then_booked
  = assigned Leads with booked set / assigned Leads

received_by_agent_then_cancelled
  = assigned Leads with cancelled set / assigned Leads
```

Breakouts (same formulas): SMS by `origin`; receiver-agent by
`FormLead` / `CallLead`.

Honest gap the live report must keep: most official Cancellations sit
on Leads with no `receiver_agent`. The cancelled-of-received rate is
therefore a statement about **assigned** Leads, not about every
Cancellation.

## 4. Search → timeline seed

A search page is not a timeline. It is the filtered cluster the
timeline already knows how to walk:

```text
raw job_no
  -> normalizeJobNo
  -> equivalentNormalizedJobFilter on identity.normalized_job_no
  -> keep Observations whose route_event_class matches event_class
  -> if booking_action_event_type is set, keep Booked | Releas only
  -> latest Decision per Observation
  -> Domain Commands whose provenance.observation_id is in the hit set
  -> emit timeline_seed { normalized_job_no, observation_ids, command_ids }
```

`P5562924` and `5562924` must resolve to the same hit set. The stored
query key is `normalizeJobNo` of the raw input; matching uses
`jobNumbersEquivalent` / `equivalentNormalizedJobFilter`.

## 5. CLI

```text
pnpm prototype:lead-conversion-and-granot-search -- rates
  --confirm-production-db=vantagemovers

pnpm prototype:lead-conversion-and-granot-search -- search
  --job-no <raw>
  [--event lead_created|priority_updated|booking_status_changed]
  [--booking-action Booked|Releas]
  --confirm-production-db=vantagemovers
```

`--booking-action` without `--event booking_status_changed` exits `2`.
Blank / unnormalizable `--job-no` exits `2`. Output is gitignored under
`scripts/output/lead-conversion-and-granot-search/`. Job Number is kept;
contact, SMS body, and raw payloads are omitted.
