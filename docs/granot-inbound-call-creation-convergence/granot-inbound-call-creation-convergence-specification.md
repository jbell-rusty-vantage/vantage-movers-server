---
type: Specification
title: Inbound Call create_if_missing and RingCentral Call Qualification convergence
description: >-
  Implementation-ready contract so inbound Granot CRM Sources with
  create_if_missing mint a Call Lead when RingCentral Call Qualification
  never saw the call, and so the two arrival orders never create twins:
  RingCentral-first synchronize, Granot-first adopt.
tags:
  - granot-lifecycle
  - ringcentral
  - call-lead
  - source-policy
status: proposed-final
stale_after: 2026-12-02
owners: [team:main-server]
applies_to:
  - src/services/granotLifecycle/leadDesiredState.ts
  - src/services/granotLifecycle/createLeadFromGranot.ts
  - src/services/granotLifecycle/processor.ts
  - src/services/granotLifecycle/identity.ts
  - src/services/granotLifecycle/synchronizeLeadFromGranot.ts
  - src/services/ringcentral/ringcentral-call-lead-ingest.service.ts
  - src/services/ringcentral/callLeadConvergence.service.ts
  - src/services/ringcentral/ringcentral-duplicate-guard.ts
  - src/services/operationsRegistry/granotCrmSources.ts
  - src/services/granotLifecycle/sourcePolicy.ts
sources:
  - id: glossary
    resource: ../../../CONTEXT.md
    title: Platform glossary
  - id: final-spec
    resource: ../../scripts/prototypes/granot-lead-lifecycle/specs/FINAL-SPECIFICATION-GRANOT-LEAD-LIFECYCLE.md
    title: FINAL SPEC — §16 create, §17 convergence
  - id: unit-19
    resource: ../../scripts/prototypes/granot-lead-lifecycle/delivery/issues/UNIT-19.md
  - id: unit-20
    resource: ../../scripts/prototypes/granot-lead-lifecycle/delivery/issues/UNIT-20.md
  - id: activation
    resource: ../granot-lead-lifecycle/lifecycle-activation-flags-and-source-policies.md
  - id: processor
    resource: ../knowledge/granot-lifecycle/processor.md
  - id: identity
    resource: ../knowledge/granot-lifecycle/identity.md
  - id: desired-state
    resource: ../knowledge/granot-lifecycle/desired-state.md
  - id: call-lead
    resource: ../knowledge/services/call-lead.md
  - id: rc-qualification
    resource: ../knowledge/services/ringcentral-call-lead-qualification.md
  - id: source-policy
    resource: ../knowledge/granot-lifecycle/source-policy.md
---

# Inbound Call create_if_missing and RingCentral Call Qualification convergence

> **Contract maturity: implementation-ready.** Product rules in this file win
> for inbound Call Lead creation and the two RingCentral arrival orders.
> File citations are evidence; reverify line numbers at implementation.
> Agents work from [`README.md`](README.md) → [`AGENT-PROTOCOL.md`](AGENT-PROTOCOL.md)
> → the matching issue. Do not start coding from chat notes.

**Prepared:** 2026-09-02
**Repos:** `vantage-main-server`
**Canonical terms:** [Call Lead](../../../CONTEXT.md), [Call Qualification](../../../CONTEXT.md), [Call Lead Ingestion](../../../CONTEXT.md), [Caller Match Key](../../../CONTEXT.md), [Source Company](../../../CONTEXT.md), [Source Granularity](../../../CONTEXT.md), [Granot CRM Source](../../../CONTEXT.md), [Ingestion Origin](../../../CONTEXT.md), [Duplicate Lead](../../../CONTEXT.md), [RingCentral Call Adoption](../../../CONTEXT.md), [Granot Observation](../../../CONTEXT.md), [Synchronization Decision](../../../CONTEXT.md)

Employees reach inbound jobs in Granot through Ring Central channels that
[Call Qualification](../../../CONTEXT.md) never sees (unmapped number,
under 120 seconds on a mapped queue, or a transfer that never hits a
reviewed inbound assignment). Those jobs still become Booked. The Owner
then asks why there is no Call Lead. This pack makes inbound
`create_if_missing` the safety net **and** keeps the two creators from
minting twins when both fire.

---

## 0. Authority

Read in this order. Stop and report contradictions; do not silently merge.

| Order | Authority | Wins on |
| --- | --- | --- |
| 1 | **This file** | Inbound Call `create_if_missing` event class; **no new Registry policy**; both arrival orders; fence that is always on when a phone exists; Registry flip for reviewed inbound Call sources |
| 2 | FINAL SPEC §16 / §17 and shipped UNIT-19 / UNIT-20 | Canonical `createLeadFromGranot`, ingest order, exact adoption candidate, origin immutability, no fabricated telephony |
| 3 | [`identity.md`](../knowledge/granot-lifecycle/identity.md) | Call ladder rungs, conflict vs pending, Duplicate Call Leads remain readable |
| 4 | [`ringcentral-call-lead-qualification.md`](../knowledge/services/ringcentral-call-lead-qualification.md) | Call Qualification, ingest gate, processed-call ledger |
| 5 | [`lifecycle-activation-flags-and-source-policies.md`](../granot-lead-lifecycle/lifecycle-activation-flags-and-source-policies.md) | Flags, activation, Best Relocation already `create_if_missing` |
| 6 | Workspace-root [`CONTEXT.md`](../../../CONTEXT.md) | Words. Do not invent synonyms |
| 7 | Pack issues | Sequencing and scope only |

This pack **narrows the shipped UNIT-19 / planner / command rule** that
only `lead_created` may invoke `createLeadFromGranot`, and only for
**CallLead + `create_if_missing`**. FINAL SPEC §16.2’s `create_if_missing`
table has no event-class column; AC-08 and UNIT-19 made it
`lead_created`-only. Form create, `link_only`, Referral, and
`booking_status_changed` stay exactly as shipped.

**No new Registry policy.** Do not add a fourth `lead_created_policy`
value, an inbound-only mint flag, or a ninth effect gate. `create_if_missing`
remains the only “Granot may mint” knob. The missing dimension is which
Observation may invoke create.

---

## 1. Decision

### 1.1 Why policy alone is not enough

Inbound Granot traffic since activation (2026-08-20) is
`priority_updated` and `booking_status_changed`. There have been **zero**
inbound `lead_created` Observations. Planner and command both require
`route_event_class === "lead_created"` before `creation_eligibility` can
be `eligible`. Best Relocation Inbounds already has `create_if_missing`
and still expires unmatched priority clocks, then opens
`create_missing_booking` with no suggested Lead.

Flipping Main Site / 10best / TBM Prime / Top10 Inbounds to
`create_if_missing` without this event-class change would not mint Call
Leads.

### 1.2 What this pack changes

1. **Authorize Call create** on unmatched inbound Observations that
   Granot actually sends: `lead_created` **or** `priority_updated`, when
   policy is `create_if_missing` and the selected model is `CallLead`.
2. **Keep both arrival orders twin-free** when a normalized phone exists.
3. **Allow** reviewed inbound Call Granot CRM Sources to use
   `create_if_missing` through the audited Owner command. Do not invent
   a second creator outside `createLeadFromGranot` and
   `ingestRingCentralQualifiedCall`.
4. **Do not invent a new policy** for `priority_updated` minting. Per-source
   opt-in stays `link_only` vs `create_if_missing` on the existing
   Granot CRM Source row.

### 1.3 What “Source Company + phone” means here

Owner language uses [Caller Match Key](../../../CONTEXT.md) (Source
Company + phone). The reviewed catalog has **one Call Source Granularity
per inbound Source Company**. Each inbound Granot CRM Source maps to
that exact Call granularity.

**Locked match key for both races:** exact `source_granularity_id` +
normalized phone. That is the inbound stream. Do **not** widen adoption
or identity to Source Company alone. Company-only attach would invent a
second Duplicate Lead boundary and could adopt across future Call
granularities.

If a Lead’s stored `lead_source_company` disagrees with the Observation’s
resolved company, that is `source_scope_conflict`, not a match.

### 1.4 No new `lead_created_policy` value

`lead_created_policy` already answers “may this source mint at all?”
Best Relocation Inbounds already has `create_if_missing`. Other inbound
Call sources stay `link_only` until the Owner flips that same field.
A new inbound `priority_updated` policy would duplicate that knob, force
`policy_permits_effect` and SMS gates to learn a second mint value, and
leave two sources that look `create_if_missing` and behave differently.

`sourcePolicy.ts` is listed in `applies_to` as **do not change**.
`evaluateEffectGates` / `policyPermitsEffect` do not read
`route_event_class`. Once the planner marks Call `priority_updated`
eligible, `requestedEffect()` already returns `"lead_created"`. Keep
that. Do not add a ninth gate.

---

## 2. Upstream contracts this pack does not re-decide

| Contract | Remains |
| --- | --- |
| Call Qualification | Inbound, mapped RingCentral Inbound Number, answered, ≥120s, caller phone. Unqualified calls never reach ingest |
| Ingest order | Processed-call ledger → adoption → Duplicate Lead → create / shadow / dry-run |
| Ingestion Origin | Immutable. Adoption never rewrites `granot_lead_created`. Sync never rewrites `ringcentral` |
| Fabricated telephony | `createLeadFromGranot` stores no duration, session, call-log id, qualification, or target number |
| Form `create_if_missing` | Still `lead_created` only. WordPress Form Leads stay `link_only` match/enrich |
| Booked / Release | Booking-case Decision still returns before lead desired-state on that Observation |
| Duplicate Lead | Exact Source Granularity + phone, earlier-only 90-day window. Source Company alone is never the boundary |
| Eight creation gates | Unchanged names and order. `requested_effect` stays `"lead_created"` when `creation_eligibility` is `eligible`, including Call `priority_updated`. `policy_permits_effect` still requires `create_if_missing` for that effect. Do not change `sourcePolicy.ts` |
| Canonical commands | Processor is the only caller of `createLeadFromGranot`. Ingest is the only RingCentral promotion gate |
| Registry policy enum | Still `link_only` \| `create_if_missing` \| `observation_only`. No fourth value |

---

## 3. Scope

**In scope**

- Call `create_if_missing` on `lead_created` and `priority_updated`
- Identity + synchronize when a RingCentral-origin Call Lead already exists
- Always-on pre-creation phone fence (not gated on the adoption flag)
- RingCentral Call Adoption of a pending Granot-created Call Lead
- Reviewed inbound Call Granot CRM Source policy flip via audited command
- Tests and knowledge updates for the above

**Out of scope**

- Changing Call Qualification duration or direction
- Mapping new RingCentral Inbound Numbers (recommended operationally; not this pack)
- Creating on `booking_status_changed`
- Form Lead create on `priority_updated`
- GetMovers inbound lifecycle classification (not a reviewed inbound Granot CRM Source)
- Customer text / `outbound_sms` (still a separate Owner command; leaving
  `create_if_missing` still turns text off). Do not change `leadMessaging/`
- A new `lead_created_policy` value, inbound mint boolean, or ninth gate
- Booking Confirm auto-attach rules (phone remains medium;
  `call_job_no_exact` remains high)
- Admin wizard / ORS-4 UI
- Production flag enable, production Registry apply, or live payload reads
  unless the Owner separately authorizes them

---

## 4. Inbound Call create authorization

### 4.1 When create may run

`createLeadFromGranot` may mint a Call Lead when **all** of the following
are true:

1. `selected_lead_model === "CallLead"`
2. Reviewed policy `lead_created_policy === "create_if_missing"`
3. Disposition `source_scoped_lead`
4. `route_event_class` is `lead_created` **or** `priority_updated`
5. Execution mode `live`; `GRANOT_LIFECYCLE_LEAD_CREATION_ENABLED`
6. Every Unit 15/18 creation gate allowed
7. Full Call identity ladder found **no** eligible target, no candidates,
   and no conflict / ambiguity
8. `evaluateMinimumCreationData` is `eligible` (normalized Job +
   deterministic Call route). Phone is optional for minting; see §7
9. No pre-existing active Record Link for that Job
10. Phone fence in §5.2 passes (skipped only when the Observation has no
    normalized phone)

Planner (`planNoMatch`) and the command’s `route_event_class` check must
agree. **Widen** Call + `create_if_missing` onto `priority_updated`. **Do
not retarget** the existing Form `lead_created` branch.

**Command guard order.** `executeCreation` today throws `policy` at
observation load, **before** `resolveSourcePolicy` and
`selected_lead_model` exist. Allow `lead_created` for any model at that
early check (or move the check after the snapshot). Allow
`priority_updated` only after `selected_lead_model === "CallLead"` and
`lead_created_policy === "create_if_missing"`. Reject Form +
`priority_updated` as `CreateLeadFromGranotRaceError("policy")`. Do not
require `CallLead` at the observation-load line — the model is not
known yet.

Invalid `priority_updated` (malformed Priority) stays
`invalid` / `invalid_priority_update` and never creates.

**Existing Call route-assignment gate (unchanged).**
`assertSingleActiveRingCentralAssignment`: zero assignment rows is
Granot-only and create proceeds (Best Relocation Inbounds). If any
assignment rows exist, exactly one must be active and point at a valid
route; otherwise `CreateLeadFromGranotRaceError("route_assignment")` and
the processor persists `insufficient_creation_data` /
`missing_creation_route_data`. Before flipping Main Site / 10best /
TBM Prime / Top10 Inbounds, that Call granularity must have **0 or 1**
active valid RingCentral assignment.

### 4.2 What still never creates

| Observation | Policy | Result |
| --- | --- | --- |
| `lead_created`, Form, `create_if_missing` | unchanged | still eligible (regression) |
| `priority_updated`, Call, `link_only` | pending 24h then `match_window_expired` | no Lead |
| `priority_updated`, Form, `create_if_missing` | unchanged — Form create stays `lead_created` only | no Lead from this event |
| `booking_status_changed` | booking-case path returns first | no Lead on that receipt |
| `lead_created`, Call, `link_only` | pending / unmatched | no Lead |

`booking_status_changed` must stay unable to mint even if a later plan
were marked eligible: `maybeReconcileBooking` still returns first.

### 4.3 After a successful create

Exactly as UNIT-19:

- `ingestion_origin: "granot_lead_created"`
- `post_to_granot: false`
- Immutable ingested / Granot creation snapshots
- Active Granot Record Link on the normalized Job
- `ringcentral_convergence.state: "pending"` when a normalized phone exists
- `ringcentral_convergence.state: "not_applicable"` when Job-only
- Sheet Sync `call_lead.create`
- Decision `created` / `lead_created_authorized`

A later `priority_updated` or `lead_created` for the same Job **matches**
(record link / `call_job_no_exact` / phone) and **synchronizes**. It does
not mint a second Lead.

**Confirmation SMS is existing finalize, not a new feature.**
`createLeadFromGranot` already hands `pending.sms` to
`sendGranotCreatedLeadConfirmation`. Gates stay
`GRANOT_LEAD_CREATED_SMS_ENABLED`, CRM Source `outbound_sms.enabled`,
`create_if_missing`, recorded consent, and a destination. Do not change
`leadMessaging/`. Best Relocation Inbounds already has
`outbound_sms.enabled`. Shipping the event-class widen therefore lets
those inbound Call creates text when production messaging flags are on.
Other inbound families stay silent until a separate `outbound_sms`
command. Do not treat that inheritance as “enable customer text as a
side effect of the later policy flip.”

---

## 5. Arrival order A — RingCentral minted first

**Given:** Call Qualification created a Call Lead
(`ingestion_origin: "ringcentral"`) with normalized phone and the Call
Source Granularity of that inbound stream.

**When:** a later inbound Granot Observation with `create_if_missing`
arrives (`lead_created` or `priority_updated`).

**Then:** the processor **must not** create. It **must**
`synchronizeLeadFromGranot` onto that Call Lead.

### 5.1 Identity

Call ladder, in order:

1. Active Record Link by Job
2. Scoped Job (`source_granularity_id` + prefix-equivalent Job)
3. Scoped phone (`source_granularity_id` + current
   `normalized_phone_number` **or**
   `ingested_contact_snapshot.normalized_phone_number`)

RingCentral-origin rows are ordinary Call Leads. There is no origin
filter. Duplicate Call Leads remain readable. Multiple eligible rows on
the same rung are `conflict` / `multiple_eligible_matches` — never guess.

Phone evidence does **not** include `granot_contact_snapshot` (Call
ladder already shipped that way).

### 5.2 Always-on pre-creation fence

Today both Granot lock sites run only when
`RINGCENTRAL_GRANOT_ADOPTION_ENABLED` is true **and** the Observation has
a phone. That is too narrow.

| Site in `createLeadFromGranot.ts` | Role |
| --- | --- |
| `ensureRingCentralConvergenceScopeLock` (pre-transaction) | Upserts the granularity+phone lock document |
| `acquireRingCentralConvergenceScopeLock` + `findPreCreationRingCentralConvergenceCandidates` (in-transaction) | Holds the lock and refuses create if any **non-duplicate** Call Lead exists at that exact Source Granularity + phone (any Ingestion Origin) |

`acquire` requires the document that `ensure` upserted. Ungate only the
inner fence and Race A with adoption **off** throws
`RingCentralConvergenceScopeRaceError` instead of refusing create.

**This pack:** when creating a Call Lead and the Observation has a
normalized phone, **ungate both sites**. Skip both when there is no
normalized phone (Job-only create remains legal — residual hole in §7).

Fence hit → `CreateLeadFromGranotRaceError("identity")` →
`maybeCreateLead` `prepareDecision` replan →
`maybeSynchronizeMatchedLead` when exactly one eligible Lead.

The adoption flag no longer gates this Granot fence. The flag still
gates RingCentral **adoption mutations** and the **ingest-side** lock
in `ringcentral-call-lead-ingest.service.ts` (§6, §10.4). Do not ungate
the ingest lock as part of “always-on fence.”

### 5.3 What synchronize may write

On a matched RingCentral-origin Call Lead, authorized desired state may
fill missing Job Number, Priority, `quoted=true` at Priority 1/5,
qualified contact/move, empty receiver. It must **never** write
`ingestion_origin`, `ingested_contact_snapshot`, `ringcentral.*`
transport, CPL, Source Scope, or `quoted=false`.

---

## 6. Arrival order B — Granot minted first

**Given:** inbound `create_if_missing` created a Call Lead
(`ingestion_origin: "granot_lead_created"`, convergence `pending`,
immutable ingested phone, no RingCentral session/call-log identity).

**When:** a later **qualified** call (webhook or Call Log cron) resolves
to the **same** Call Source Granularity and the **same** normalized
caller phone, and Call Lead Ingestion does not already have a terminal
processed-call row for that physical call.

**Then:** ingest **must** adopt that one Call Lead and **must not**
create a RingCentral-origin twin.

### 6.1 Adoption candidate (unchanged exactness)

Exactly one row satisfying every condition:

- exact `source_granularity_id` from the qualified call’s inbound
  assignment
- exact `ingested_contact_snapshot.normalized_phone_number`
- `ingestion_origin: "granot_lead_created"`
- `ringcentral_convergence.state: "pending"`
- no nonempty `ringcentral.telephony_session_id`, `session_id`, or
  `call_log_id`
- Lead `createdAt` inclusive between call start − 12 hours and call
  start + 12 hours

Zero candidates → normal create / shadow / dry-run. Two or more →
durable `conflict` / `multiple_adoption_candidates` on every still
eligible row; the qualified call still continues (may create). Never
guess.

Job-only / `not_applicable` is never a candidate.

### 6.2 What adoption writes

Unchanged from UNIT-20: preserve `granot_lead_created` and Granot
snapshots; attach verified RingCentral identity and immutable
`ringcentral.original_caller`; set convergence `adopted`; classify
Duplicate Lead excluding the adopted Lead and unresolved pending/conflict
Granot rows; one transaction with EntityChange, `call_lead.update`
outbox, and processed-call ledger (`lead_adopted` or
`lead_adopted_duplicate`).

### 6.3 Adoption must be on before inbound create is live

`RINGCENTRAL_GRANOT_ADOPTION_ENABLED=false` plus live inbound
`create_if_missing` plus a later qualifying cron create **mints a twin**.

**Rollout lock:** do not enable inbound Call `create_if_missing` (or the
`priority_updated` create path in production) unless adoption is enabled
**and** RingCentral write mode is `create`, **or** Call Qualification is
provably unable to resolve that Source Granularity (Best Relocation
Inbounds: zero inbound assignments — Granot-only, no later adopt
expected).

---

## 7. Residual holes this pack names and does not close

| Hole | Why it remains | Owner-visible result |
| --- | --- | --- |
| Job-only Granot create (no phone) while a RingCentral Call Lead exists on phone+granularity | Call minimum data is Job-only; phone rung and the fence both require an Observation phone | Possible twin. Prefer Observations that carry phone. Do not invent a phone |
| Job-only Granot create, later qualified call | Adoption requires immutable phone | RingCentral may create a second Lead. Booking intake can still high-confidence attach via Job |
| Booked arrives with no prior Lead | Booking-case Decision returns before create | `create_missing_booking` with no suggestion. A later `priority_updated` may create or sync. Confirm may be Leadless |
| Call never qualifies and Granot never sends Job | Create stays `insufficient_creation_data` | Still no Lead — we cannot invent a Job |
| Same phone, different inbound Source Company | Correct attribution | Two Call Leads. Not a twin inside one stream |
| Unmapped RingCentral number | Call Qualification never runs | Granot create is the intended safety net |

Do **not** create on `booking_status_changed` to paper over the Booked-first
hole. That would couple Lead minting to booking evidence and skip the
identity clock on the events that actually describe the inbound job.

---

## 8. Flags, Registry, and rollout

### 8.1 Runtime flags (no silent production flip)

| Flag | Role |
| --- | --- |
| `GRANOT_LIFECYCLE_LEAD_CREATION_ENABLED` | Global create gate (already required) |
| `GRANOT_LIFECYCLE_LEAD_WRITES_ENABLED` | Matched synchronize (already required for race A) |
| `RINGCENTRAL_GRANOT_ADOPTION_ENABLED` | Race B mutations |
| `RINGCENTRAL_CREATE_CALL_LEADS` | Required for adoption writes and normal RC create |

Checked-in defaults stay fail-closed. Production enable is a separate
Owner authorization, not this pack’s implementation.

### 8.2 Reviewed inbound Call Granot CRM Sources

| Granot CRM Source | Policy today | After this pack (Owner command) |
| --- | --- | --- |
| BestRelocation Inbounds | `create_if_missing` | keep the same policy; **inherits** `priority_updated` create when the event-class code is live |
| Main Site Inbounds | `link_only` | may become `create_if_missing` |
| 10best Inbounds | `link_only` | may become `create_if_missing` |
| TBM Prime Inbounds | `link_only` | may become `create_if_missing` |
| Top10 Inbounds | `link_only` | may become `create_if_missing` |

Write only through `createOrUpdateGranotCrmSource`. Do not `updateOne` in
Compass. Do not put `create_if_missing` on Source Company or Source
Granularity documents. Do not invent a second policy field for
`priority_updated`.

GetMovers has a RingCentral Inbound Number and no reviewed inbound
Granot CRM Source. Out of scope.

Before flipping a source that has RingCentral assignments: adoption on,
write mode `create`, and **0 or 1** active valid assignment on that Call
granularity (§4.1). Best Relocation Inbounds may stay Granot-only (zero
assignments) and will inherit `priority_updated` create from the code
change alone — including the existing confirmation-SMS finalize if
messaging gates are on.

The Owner checklist for that later flip lives in
[`lifecycle-activation-flags-and-source-policies.md`](../granot-lead-lifecycle/lifecycle-activation-flags-and-source-policies.md)
§7–§8. It is not a second contract. GICC-03 does not apply production
Registry policy or flags.

### 8.3 Companion operational work (not coded here)

Expand RingCentral inbound assignments for overflow / transfer numbers
that employees actually use. That shrinks how often Granot has to mint.
This pack still ships if those numbers are unmapped.

---

## 9. Forbidden effects

- A second Call Lead for the same inbound Source Granularity + phone when
  identity or the phone fence can see the first (phone present)
- Rewriting Ingestion Origin on adopt or sync
- Adopting Job-only / `not_applicable` rows
- Guessing among multiple adoption or identity candidates
- Creating from `booking_status_changed` or from Form `priority_updated`
- Narrowing Form `lead_created` + `create_if_missing` (must stay eligible)
- Changing Call Qualification
- Adding a fourth `lead_created_policy` value, inbound mint boolean, or
  ninth gate
- Changing `sourcePolicy.ts` or `leadMessaging/`
- Enabling customer text as a side effect of a later inbound policy flip
- Ungating the RingCentral ingest lock because the Granot fence is always on
- Detaching committed RingCentral evidence on rollback (disable the
  adoption flag; leave adopted rows adopted)

---

## 10. Tests the agent must add

Synthetic data only. No live phones or Job Numbers in fixtures.

### 10.1 Planner and command (GICC-01)

- Call + `create_if_missing` + `priority_updated` + unmatched + complete
  Job → `creation_eligibility: eligible`
- Call + `create_if_missing` + `lead_created` → still eligible (regression)
- Form + `create_if_missing` + `lead_created` → still eligible (regression)
- Call + `link_only` + `priority_updated` → not eligible
- Form + `create_if_missing` + `priority_updated` → not eligible
- Call + `create_if_missing` + `booking_status_changed` → not eligible
- Command accepts `priority_updated` for Call create; rejects it for Form
- Invalid priority update still never creates
- `sourcePolicy.ts` / `evaluateEffectGates` unchanged; `requested_effect`
  stays `"lead_created"` on the Call `priority_updated` create path

### 10.2 Race A (GICC-02)

- Existing `ringcentral` Call Lead, same granularity + phone → Granot
  `priority_updated` / `lead_created` synchronizes; origin stays
  `ringcentral`; no second Lead
- Same, adoption flag **false** → fence still blocks create and replans
  to sync
- Job vs phone pointing at two Leads → `job_number_conflict`, no create
- Two phone matches → `multiple_eligible_matches`, no create

### 10.3 Race B (GICC-02)

- Pending `granot_lead_created` + later qualified call, same granularity
  + phone, ±12h, adoption on, create mode → `lead_adopted`; no second Lead
- Same with a prior non-duplicate Call Lead in the 90-day window →
  `lead_adopted_duplicate`
- Adoption off → qualified call creates a RingCentral-origin Lead
  (documented twin; this is why §6.3 exists)
- Job-only Granot Lead → not adopted; qualified call may create
- Different Source Granularity, same phone → not adopted

### 10.4 Replica / race (GICC-02)

- Concurrent Granot create and RingCentral ingest on the same
  granularity+phone, with **`RINGCENTRAL_GRANOT_ADOPTION_ENABLED=true`**
  and RingCentral write mode `create`: exactly one Call Lead; the loser
  replans or adopts
- Do **not** require concurrent one-Lead safety with adoption off. That
  would mean ungating the ingest lock, which this pack does not do.
  Race A with adoption off is sequential: the RingCentral Call Lead
  already exists, then Granot identity + fence synchronize.

---

## 11. Knowledge updates after ship

docs-keeper, matching layer only:

- [`processor.md`](../knowledge/granot-lifecycle/processor.md) — Call
  create on `priority_updated` when `create_if_missing`
- [`desired-state.md`](../knowledge/granot-lifecycle/desired-state.md) —
  `planNoMatch` event-class rule
- [`call-lead.md`](../knowledge/services/call-lead.md) — inbound Granot
  create + fences
- [`ringcentral-call-lead-qualification.md`](../knowledge/services/ringcentral-call-lead-qualification.md) —
  fence always on; adoption still flagged
- [`source-policy.md`](../knowledge/granot-lifecycle/source-policy.md) and
  [`operations-registry.md`](../knowledge/services/operations-registry.md)
  — inbound families may be `create_if_missing`; still three policy
  values; `requested_effect` stays `"lead_created"`; no ninth gate
- [`lifecycle-activation-flags-and-source-policies.md`](../granot-lead-lifecycle/lifecycle-activation-flags-and-source-policies.md)
  — event-class + adoption companion

ORCHESTRATION owner sentence (“born in Granot, not on a RingCentral
queue”) becomes: inbound `create_if_missing` is the safety net when Call
Qualification does not see the call; mapped qualifying calls stay
RingCentral-created or adopted.

No new glossary term. No new `lead_created_policy` value. Use
RingCentral Call Adoption and Caller Match Key.

---

## 12. Implementation order

| Issue | Slice |
| --- | --- |
| [GICC-01](issues/GICC-01.md) | Planner + `createLeadFromGranot` accept Call `priority_updated` |
| [GICC-02](issues/GICC-02.md) | Always-on phone fence; both arrival-order tests; replica race |
| [GICC-03](issues/GICC-03.md) | Knowledge + Registry/activation doc; Owner command checklist for the inbound policy flip |

Do not apply production Registry policy or flags in GICC-03. That is a
later Owner-authorized operations step.

---

## 13. Done when

1. Unmatched inbound Call `priority_updated` with `create_if_missing`
   mints exactly one Call Lead when identity is empty and minimum data
   passes.
2. A RingCentral-origin Call Lead at the same granularity + phone is
   synchronized, never twinned, even when the adoption flag is false.
3. A later qualified call adopts exactly one pending Granot-created Call
   Lead at that granularity + phone and does not create.
4. Form create (`lead_created` still eligible; `priority_updated` not),
   `link_only`, and `booking_status_changed` behavior is unchanged.
5. Knowledge docs match the shipped gates. No new Registry policy
   value. `sourcePolicy.ts` unchanged.

---

## 14. Current-code map (reverify)

Observed 2026-09-02.

| Seam | Today |
| --- | --- |
| `leadDesiredState.ts` `planNoMatch` | Creation branch is `route_event_class === "lead_created"` only |
| `createLeadFromGranot.ts` `executeCreation` | Throws policy race unless `lead_created`, **before** policy / `selected_lead_model` |
| `createLeadFromGranot.ts` `ensureRingCentralConvergenceScopeLock` | Pre-transaction; gated on CallLead + adoption flag |
| `createLeadFromGranot.ts` `acquire` + `findPreCreation…` | In-transaction; gated on CallLead + Observation phone + adoption flag |
| `createLeadFromGranot.ts` `assertSingleActiveRingCentralAssignment` | 0 assignment rows OK; else exactly one active valid route |
| `createLeadFromGranot.ts` finalize SMS | Always passes `pending.sms` to `sendGranotCreatedLeadConfirmation` |
| `sourcePolicy.ts` | Gates do not read `route_event_class`. **Do not change.** |
| `identity.ts` `resolveCallLadder` | Granularity + job / phone; RC origin not filtered |
| `processor.ts` `requestedEffect` | `"lead_created"` when `creation_eligibility === "eligible"` |
| `processor.ts` `maybeReconcileBooking` | Returns before `maybeCreateLead` on booked/release |
| `processor.ts` fence replan | `CreateLeadFromGranotRaceError("identity")` → `prepareDecision` |
| `ringcentral-call-lead-ingest.service.ts` lock | Still gated on adoption flag. **Leave it.** |
| `callLeadConvergence.service.ts` | Exact granularity + ingested phone + pending + ±12h |
| `ringcentral-config.ts` | `RINGCENTRAL_GRANOT_ADOPTION_ENABLED` default false |
| Reviewed inbound policies | Best Relocation Inbounds `create_if_missing` + SMS on; other inbound Call sources `link_only` |
