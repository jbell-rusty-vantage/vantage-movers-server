# Vantage Granot lifecycle — agent handoff

Created 2026-08-13. No credentials, connection strings, live payload values, or
customer data are included.

## Intended next session

Continue from executable domain reasoning toward the first production shadow
slice: normalize captured Granot webhook receipts, resolve approved operational
identities, persist explainable match/synchronization decisions, and process by
queue without enabling Lead/Booking/Cancellation mutations yet.

## Read first

- `C:/Users/Pinda/Proyectos/vantage/CONTEXT.md` — canonical platform language;
  includes Granot Observation, Granot Priority, Observation Channel, Granot
  Record Link, Synchronization Decision, Granot Booking Intake Case, Suggested
  Booking Lead, Confirm Granot Booking, and Granot Booking Discrepancy.
- `C:/Users/Pinda/Proyectos/vantage/vantage-main-server/docs/granot-lifecycle-prototype-and-implementation-seams.md`
  — prototype conclusions and proposed production Modules, models, routes,
  queue, analytics, and next slice.
- `C:/Users/Pinda/Proyectos/vantage/vantage-main-server/docs/lead-lifecycle-paths-and-projected-granot-webhooks.md`
  — complete Form Lead / Call Lead / Booking / Cancellation path catalog.
- `C:/Users/Pinda/Proyectos/vantage/vantage-main-server/docs/granot-webhook-domain-service-model.md`
  — live-data profile and initial architecture.
- `C:/Users/Pinda/Proyectos/vantage/vantage-main-server/docs/operations-name-link-inventory.md`
  — real Source Company, Source Granularity, Granot source, Agent, Merchant,
  and RingCentral naming/link inventory.
- `C:/Users/Pinda/Proyectos/vantage/vantage-main-server/scripts/prototypes/granot-lead-lifecycle/README.md`
  — disposable prototype entry point.
- `C:/Users/Pinda/Proyectos/vantage/vantage-main-server/scripts/prototypes/granot-lead-lifecycle/GRANOT-BOOKING-INTAKE-PROTOTYPE.md`
  — owner-hidden Priority 5 intake, notification, Suggested Booking Lead, and
  Confirm Granot Booking flow.
- `C:/Users/Pinda/Proyectos/vantage/vantage-main-server/scripts/prototypes/granot-lead-lifecycle/GRANOT-CANCELLATION-INTAKE-PROTOTYPE.md`
  — owner-hidden `Releas` intake, notification, Linked Cancellation Booking,
  and Confirm Granot Cancellation flow.

## Executable artifact

The prototype's only external seam is:

`advanceLeadLifecycle(current, action, catalog): LifecycleResult`

Implementation:
`scripts/prototypes/granot-lead-lifecycle/domain.ts`.

Run the executable scenario assertions:

`pnpm prototype:granot-lifecycle -- --scenarios`

Run the terminal explorer:

`pnpm prototype:granot-lifecycle`

Last verification:

- 20/20 prototype scenarios passed.
- `pnpm typecheck` passed.
- `git diff --check` passed.

The prototype uses real operational names with deliberately fake IDs/contact
values and never connects to MongoDB, Granot, RingCentral, Sheets, or queues.

## Decisions already captured

Do not reopen these casually; use the linked docs for rationale:

- Lead Lifecycle is compositional facts/relationships, not one status enum.
- Cancellation is additive: `booked` remains and `cancelled` is added.
- `lead_created` confirms/links; it does not bypass Form Lead Ingestion or
  RingCentral Call Qualification.
- Priority 1/5 may drive existing enrichment rules; Call Lead has no `quoted`.
- Priority 5 without official Vantage Booking details opens a **Granot Booking
  Intake Case**. The **Suggested Booking Lead** is changeable, and only
  **Confirm Granot Booking** creates the Booking and Booking Chain.
- A **Granot Booking Discrepancy** is reserved for conflict with an existing
  Booking or established Granot Record Link. It is not expected intake work and
  is not a **Booking Lead Reconciliation Case**.
- `booking_status_changed` / `Releas`|`Release` against an active Booking
  opens a **Granot Cancellation Intake Case**. The **Linked Cancellation
  Booking** is deterministic. The owner may **Confirm Granot Cancellation**,
  **Update Granot Booking**, or dismiss; none is required. Stay idempotent on
  Job Number. Granot payment stays context only.
- A **Granot Cancellation Discrepancy** is reserved for `Releas`/`Release`
  with no Booking, a mismatched Record Link, or Granot `Booked` after an
  official Cancellation. It never un-cancels.
- Unknown priorities and source labels produce explicit blocked decisions.
- Source system, Observation Channel, and actor are separate provenance axes.
- Different receipts containing already-reflected state are evidence and should
  normally become `already_current`, not payload-hash-deduped away.
- Provider `occurred_at`/revision may establish stale ordering; receipt time
  alone may not.
- Routes and queue consumers are adapters/projections, not policy owners.

## Production slice recommended next

1. Add versioned `GranotObservation` normalization with captured, redacted
   fixtures and structured issue codes.
2. Build an Operations Identity Module with Mongo and in-memory adapters. It
   resolves Granot source label → Source Scope and Granot username → Agent.
3. Add shadow-only `GranotRecordLink` and `GranotMatchDecision` persistence for
   exact matches; no Lead mutation.
4. Add a Mongo-durable receipt claim/attempt model and queue wake-up consumer.
   Queue messages carry receipt ID only.
5. Add admin read routes for observations/decisions and pending/ambiguous cases.
6. Test through the Granot Observation Processing Module Interface, using an
   in-memory adapter; do not test internal helper seams.
7. Review shadow counts before enabling `ApplyGranotLeadSnapshot` commands.
8. Add dashboard-only Granot Booking Intake Cases and measure Suggested Booking
   Lead quality before enabling Confirm Granot Booking or optional email.
9. Add dashboard-only Granot Cancellation Intake Cases for `Releas`/`Release`
   against an active Booking before enabling Confirm Granot Cancellation,
   Update Granot Booking, or optional cancellation email. Stay idempotent on
   Job Number.

## Business decisions still required

- Exact operational meanings of Granot priorities 2, 3, 7, 8, and 9.
- Booking-status vocabulary is confirmed: `Booked` and `Release` are CRM
  button actions; payloads truncate `Release` to `Releas`; a job can have
  many of each; stay idempotent on `job_no`. See
  `GRANOT-CANCELLATION-INTAKE-PROTOTYPE.md`.
- Whether Priority 0 may ever downgrade quoted state.
- Provider event ID, occurred-at, and monotonic revision contract.
- Ownership policy for `Paid Overflow`, `Referral`, and non-qualified inbound
  Granot jobs.
- Resolution of the documented `leadno` / `ref_no` identity contradiction.
- Whether bad Form Leads remain webhook-enrichment targets.
- Pending-match retry duration for Form/RingCentral ingestion races.

Keep these explicit as `blocked`, `pending_match`, `ambiguous`, or `conflict`;
do not convert uncertainty into fallback behavior.

## Working-tree caution

The `vantage-main-server` working tree contains intentional uncommitted docs,
the name-link inventory script, package scripts, and the lifecycle prototype.
Inspect `git status --short` and preserve all unrelated/user-owned changes.
The parent `C:/Users/Pinda/Proyectos/vantage/CONTEXT.md` is outside the nested
server repository but was intentionally updated with canonical terms.

## Suggested skills

- `domain-modeling` — keep vocabulary and lifecycle invariants canonical.
- `codebase-design` — retain a deep processing Module with a small Interface;
  distinguish Modules, Interfaces, seams, and adapters precisely.
- `tdd` — production work should be test-first at the processing Interface.
- `diagnosing-bugs` — use only if real captured fixtures expose mismatches or
  regressions during implementation.

Do not treat the disposable terminal shell as production architecture. Absorb
validated policy into production Modules, then delete the prototype when its
reasoning value is exhausted.
