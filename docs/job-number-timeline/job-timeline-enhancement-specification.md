---
type: Specification
title: Job Timeline Enhancement — precise owner lifecycle and evidence view
description: Production enhancement of the existing Job Number timeline into a clear, evidence-aware lifecycle story, while reserving window-wide reconciliation and notifications for the later Owner Daily Assurance system.
tags:
  - job-number
  - owner-dashboard
  - lifecycle
  - provenance
  - assurance
status: draft
stale_after: 2026-11-27
generated:
  by: codex
  at: 2026-08-27T00:00:00Z
sources:
  - id: current-prototype-spec
    resource: ../../scripts/prototypes/job-number-timeline/specs/job-number-timeline-prototype-specification.md
  - id: current-service
    resource: ../knowledge/services/job-number-timeline.md
  - id: lifecycle-assurance-proof
    resource: ../../scripts/output/lifecycle-assurance/assurance-latest.md
  - id: reduced-owner-daily
    resource: ../owner-daily-operations-and-intakes-reduced/owner-daily-reduced-specification.md
owners: [team:main-server, team:vantage-admin]
applies_to:
  - src/services/jobNumberTimeline/**
  - src/routes/job-number-timeline-admin.routes.ts
  - scripts/prototypes/job-number-timeline/**
  - vantage-admin/app/(dashboard)/job-timeline/**
  - vantage-admin/components/job-number-timeline/**
---

# Job Timeline Enhancement

**Implementation workspace:** [`README.md`](README.md) — agent protocol,
session map, and executable JTE-01–07 issues. Start there; this file
remains the contract.

## 0. Executive decision

Enhance the existing Job Number timeline into the Owner's most precise answer to:

> What happened to this Job, in what order, what is official, what is merely
> evidence of intake or processing, and what can Vantage not prove?

Keep it a **read-time projection** over the existing systems of record. Do not
persist a second event stream, revive `OperationalEvent`, or create a
`lead_lifecycle_events` collection.

The enhanced page has two simultaneous responsibilities:

1. **Story:** a human-readable lifecycle from source receipt through Lead,
   messaging, updates, Booking or Cancellation, and Sheet Sync.
2. **Proof:** expandable evidence showing why each event exists, which clock was
   used, how records were correlated, and how strong the evidence is.

This specification intentionally does **not** implement the later Owner Daily
Assurance system. A Job timeline proves one chain. Daily Assurance proves
population-wide equations, source watermarks, destination equality, freshness,
and notification state across a time window. Section 14 fixes that seam.

## 1. Relationship to current work

### 1.1 What remains authoritative

The existing
[`job-number-timeline-prototype-specification.md`](../../scripts/prototypes/job-number-timeline/specs/job-number-timeline-prototype-specification.md)
remains authoritative for:

- typed Job Number search and equivalent Job Number normalization;
- the walk-back from Job-scoped facts to Lead events that predate Job Number;
- latest Synchronization Decision attempt only;
- the distinction between reconciliation intake and official facts;
- Sheet Sync joins by entity ID rather than Job Number;
- locked event headlines, PII rules, and no invented events;
- the current eleven event kinds and stable oldest-first ordering.

This enhancement is additive. If it conflicts with the prototype on event
truth, correlation, or masking, the prototype wins until this document is
explicitly amended with migration tests.

### 1.2 What this document changes

It adds:

- a lifecycle-stage model above individual technical events;
- an explicit current outcome and contradiction handling;
- expectation-aware stage assessments instead of ambiguous “absent” chips;
- source receipt, freshness, and external-edge limitations;
- activity grouping without deleting or combining evidence rows;
- occurred-at versus recorded-at clocks;
- owner-readable evidence strength and correlation explanations;
- attention codes that can later feed Daily Assurance and notifications;
- a production module extraction and phased implementation plan.

### 1.3 Production module seam (JTE-01 complete)

JTE-01 moved the production implementation under
`src/services/jobNumberTimeline/` (`createJobNumberTimelineModule`). The HTTP
route and CLI call that module. No file under `src/` imports
`scripts/prototypes/job-number-timeline`. The prototype folder is a retained
CLI/proof adapter. The route stays thin: authorize, validate, `module.read`,
respond. Redaction is inside the module.

v2 fields are specified below; they are not shipped.

## 2. Product scope

### 2.1 In scope

- Owner-only typed Job Number retrieval at `/job-timeline?job=`.
- A precise, oldest-first lifecycle for one Job.
- Events before and after Job Number acquisition.
- Lead origin from WordPress, RingCentral, Granot, or honest `other`.
- outbound Lead Message state without body or customer contact;
- field-level Lead updates summarized for an owner;
- Granot receipt/Observation/Decision processing evidence;
- Booking intake and official Booking as separate points;
- Cancellation intake and official Cancellation as separate points;
- Sheet Sync intent, progress, completion, or failure;
- gaps, limitations, contradictions, and correlation confidence;
- deep links from Owner Daily, Lead search, Booking, Cancellation, and intake
  surfaces when those surfaces already know a Job Number.

### 2.2 Explicitly out of scope

- Time-window totals or claims that every Lead is accounted for.
- Source-wide WordPress completeness.
- RingCentral population completeness beyond displaying its known cursor bound.
- Live Google Sheet row equality.
- Event-driven email, SMS, push, or in-app notification delivery.
- Move completion until a system-of-record fact exists.
- Customer conversation transcript, call recording, or SMS body.
- A Job Number catalog, dropdown, or global distinct query.
- Automatic repair, retry, reconciliation, or any other mutation.
- Replacing the forensic Granot lifecycle screen.

## 3. Owner questions the page must answer

Without opening another screen, the Owner must be able to answer:

1. Where did this Lead originate?
2. When did Vantage first receive evidence of it?
3. When was the official Lead created?
4. Was a confirmation text attempted, and what was its latest provider state?
5. Which important Lead changes occurred, from which source, and through which
   command?
6. When did the Job Number first become known?
7. Did Granot evidence enter Vantage, and what did the latest decision do?
8. Did a Booking intake case open, refresh, or resolve?
9. Does an official Booking exist?
10. Did a Cancellation intake case open, refresh, or resolve?
11. Does an official Cancellation exist?
12. Were the associated Sheet Sync jobs requested and completed?
13. Which statements are verified changes, official records, recorded evidence,
    external acknowledgements, or limitations?
14. Are there contradictions or missing correlation links requiring attention?
15. How fresh is this answer, and which external edges were not independently
    checked?

## 4. Lifecycle language

### 4.1 Stages

Every event belongs to one owner-readable stage:

| Stage | Meaning | Current event kinds |
| --- | --- | --- |
| `origin` | External or internal evidence first entered Vantage | `source_received` (new), `lead_created` |
| `engagement` | Vantage attempted customer contact | `lead_message` |
| `qualification` | Job identity or material Lead state changed | `job_number_acquired`, `lead_updated` |
| `processing` | Granot evidence was normalized and evaluated | `granot_observation`, `synchronization_decision` |
| `booking` | Booking reconciliation work and official Booking | `booking_intake`, `official_booking` |
| `cancellation` | Release reconciliation work and official Cancellation | `cancellation_intake`, `official_cancellation` |
| `delivery` | Downstream projection work | `sheet_sync` |

`source_received` is the only new event kind required for the first enhancement.
It is emitted only when a durable source-side or Vantage ingress fact exists:

- Granot: Observation Receipt captured.
- RingCentral: processed qualified-call ledger entry.
- WordPress: no event until a durable independent form-submission receipt exists.

A stored Lead is still `lead_created`; it must never be relabelled
`source_received` merely to fill the stage.

### 4.2 Current outcome

The page derives one `current_outcome`:

```ts
type JobTimelineOutcome =
  | "lead_active"
  | "booking_intake_open"
  | "booked"
  | "cancellation_intake_open"
  | "cancelled"
  | "contradictory"
  | "unknown";
```

Precedence is not a blind last-event-wins rule:

- official Cancellation after official Booking → `cancelled`;
- open Cancellation intake with an official Booking →
  `cancellation_intake_open`;
- official Booking without official Cancellation → `booked`;
- open Booking intake without official Booking → `booking_intake_open`;
- resolved Lead with none of the above → `lead_active`;
- incompatible official facts or chronologies → `contradictory` plus attention;
- unresolved Lead and no official fact → `unknown`.

An intake case never becomes the official outcome by itself.

### 4.3 Stage assessment

Replace owner-facing “present/absent” semantics with expectation-aware states:

```ts
type StageAssessmentState =
  | "complete"
  | "active"
  | "not_started"
  | "not_applicable"
  | "attention"
  | "unverifiable";

type StageAssessment = {
  stage: JobTimelineStage;
  state: StageAssessmentState;
  label: string;
  reason_code: string;
  event_ids: string[];
};
```

Examples:

- No text because consent/policy blocked it → `not_applicable`, not failure.
- No text with no known gate decision → `not_started`, not “missing”.
- Open Booking case → `active`.
- Resolved create-missing Booking case with no official Booking → `attention`.
- No Cancellation activity on an active Booking → cancellation
  `not_started`, not a gap.
- Google row not read back → delivery `unverifiable`, even when every outbox job
  is `synced`.
- Move completion is not a stage in this version. The header shows a system
  limitation rather than a false incomplete stage.

## 5. Evidence model

### 5.1 Owner-readable evidence strength

Do not make the Owner interpret `command_backed`, `official_fact_only`, or
`evidence_only`. Preserve those internal values for compatibility and add an
owner-readable classification:

| `evidence_level` | Owner label | Meaning |
| --- | --- | --- |
| `verified_change` | Verified change | An append-only EntityChange or exact durable processing equation backs the event. |
| `official_record` | Official record | The current Mongo system-of-record document exists, even if legacy command evidence does not. |
| `recorded_evidence` | Recorded evidence | A durable receipt, Observation, Decision, case, or outbox job exists; it is not the official business outcome. |
| `external_acknowledgement` | Provider acknowledged | A provider status or cursor backs the statement, bounded by the provider integration. |
| `limitation` | Cannot verify | The current system lacks an independent edge or correlation fact. |

No `inferred` evidence level is allowed. Derivation may summarize facts, but it
must identify its inputs and must not synthesize a lifecycle event.

### 5.2 Dual clocks

Every event must preserve:

```ts
time: {
  occurred_at: string;       // best domain/provider clock
  occurred_at_field: string;
  recorded_at: string | null; // when Vantage durably stored/captured it
  recorded_at_field: string | null;
  precision: "provider" | "domain" | "capture" | "storage_fallback";
}
```

Default ordering remains `occurred_at ASC`, then stable type priority, then ID.
If `recorded_at` differs materially, evidence detail says so. The default card
shows one time; expanding it shows both. Never imply that storage order proves
the exact external occurrence order.

### 5.3 Correlation and causality

Each event exposes a safe explanation of why it belongs to the Job:

```ts
correlation: {
  method:
    | "direct_job_number"
    | "equivalent_job_number"
    | "record_link"
    | "lead_reference"
    | "booking_reference"
    | "observation_reference"
    | "entity_change_reference"
    | "sheet_entity_reference";
  confidence: "exact" | "walked_back" | "limited";
  explanation: string;
};

causality: {
  activity_id: string;
  caused_by_event_ids: string[];
  resulting_event_ids: string[];
};
```

Examples:

- WordPress Lead created before Job Number → `walked_back` through the resolved
  Lead reference.
- Sheet job → `exact` through its entity ID.
- Orphan historical Cancellation whose Booking was deleted → `limited`; do not
  attach it to a typed Job unless a durable snapshot proves the Job Number.

`activity_id` groups related rows—receipt → Observation → latest Decision →
EntityChange → Sheet job—without collapsing or deleting them. The UI may render
one activity card with expandable steps, but the response retains every event.

## 6. Enhanced response contract

Keep the current success envelope and existing fields for compatibility. Add a
schema version and the following additive fields:

```ts
type EnhancedJobTimelinePage = JobTimelinePage & {
  schema_version: "job_timeline.v2";
  assembled_at: string;
  current_outcome: JobTimelineOutcome;
  summary: {
    headline: string;
    origin_label: string;
    latest_activity_at: string | null;
    event_count: number;
    attention_count: number;
  };
  freshness: {
    mongo_read_at: string;
    consistency: "multi_query_best_effort";
    ringcentral_covered_through: string | null;
    ringcentral_cursor_lag_seconds: number | null;
    google_destination_readback: "not_performed";
  };
  stage_assessments: StageAssessment[];
  attention: TimelineAttention[];
  limitations: TimelineLimitation[];
  activities: TimelineActivity[];
  events: EnhancedJobTimelineEvent[];
};
```

Enhanced event fields:

```ts
type EnhancedJobTimelineEvent = JobTimelineEvent & {
  stage: JobTimelineStage;
  evidence_level: EvidenceLevel;
  time: TimelineEventTime;
  summary: string | null;
  status: "completed" | "active" | "pending" | "failed" | "informational";
  correlation: TimelineCorrelation;
  causality: TimelineCausality;
  evidence: Array<{
    source_kind: string;
    safe_label: string;
    ref: string; // opaque internal ref; never contact or provider payload
  }>;
};
```

The existing `event_at`, `clock_field`, `coverage`, `headline`, and safe `data`
remain during migration. The Admin client reads the v2 fields when present and
can render the current UI for a v1 fixture.

## 7. Event detail recommendations

### 7.1 Source and Lead creation

- Show `source_received` separately from `lead_created` when backed by a receipt
  or processed-call ledger.
- Show normalized source company and source granularity labels.
- For RingCentral, show qualification outcome and “covered through” time, not
  phone number, transcript, or recording.
- For Granot, connect Receipt → Observation → latest Decision.
- For WordPress, state: “Lead creation is recorded; independent WordPress
  submission receipt is unavailable.” This is a limitation, not a fake event.

### 7.2 Lead Message

- Show purpose, origin, latest provider status, attempt count, and skip reason.
- Never show message body, phone number, provider request payload, or provider
  error body.
- Distinguish `scheduled`, `sent`, `delivered`, `undelivered`, `failed`, and
  policy/consent skip.
- A skipped or not-applicable message must not render as an alert.

### 7.3 Lead updates

- Keep one event per EntityChange, not one event per changed field.
- Translate changed paths into owner groups: Contact, Move, Assignment,
  Attribution, Job identity, Booking state, and Other.
- Default summary: “Move details and assignment updated from Granot.”
- Expanded evidence lists exact safe field names and command name. Values remain
  hidden unless separately approved as safe owner data.
- Latest Decision attempt only remains mandatory.

### 7.4 Booking and Cancellation

- Intake open, refresh, resolve, and official fact remain separate events.
- An intake event uses “opened/refreshed/resolved”; it never uses “booked” or
  “cancelled” as its business outcome.
- Official facts show their authoritative document clock and whether command
  evidence exists.
- If a resolved finalizing case lacks the official fact, emit attention.
- If Booking and Cancellation facts conflict chronologically, show both and set
  `current_outcome: "contradictory"`.

### 7.5 Sheet Sync

- Display one event per durable outbox row.
- Show resource, operation, state, attempts, requested time, completed/update
  time, and safe target tab hints.
- Never show `spreadsheet_id`, cell contents, tombstone payload, or `last_error`.
- `synced` means the outbox worker completed—not that Google currently equals
  Mongo. The page must say this once in the delivery stage.
- Later Google read-back may add a separate `sheet_verified` event. It must not
  silently redefine `sheet_sync`.

## 8. Attention and limitation vocabulary

Attention is actionable for this Job. A limitation describes the system's proof
boundary and may not be actionable for this Job.

Initial attention codes:

| Code | Trigger |
| --- | --- |
| `LEAD_UNRESOLVED` | Job-scoped facts exist but no Lead can be safely resolved. |
| `BOOKING_CASE_RESOLVED_WITHOUT_FACT` | A finalizing/resolved Booking case lacks an official Booking. |
| `CANCELLATION_CASE_RESOLVED_WITHOUT_FACT` | A finalizing/resolved Cancellation case lacks an official Cancellation. |
| `ORPHAN_CANCELLATION_REFERENCE` | A Cancellation references a missing Booking and lacks a durable Job snapshot. |
| `SHEET_SYNC_PENDING_TOO_LONG` | A live job exceeds the configured age threshold. |
| `SHEET_SYNC_TERMINAL_FAILURE` | A relevant outbox job is terminally failed. |
| `CONTRADICTORY_OFFICIAL_STATE` | Official facts or their clocks cannot produce one coherent outcome. |
| `SOURCE_SCOPE_CONFLICT` | Resolved source scopes disagree. |
| `PROCESSING_EVIDENCE_GAP` | A claimed applied Decision lacks its required EntityChange. |

Initial limitations:

| Code | Meaning |
| --- | --- |
| `WORDPRESS_RECEIPT_UNAVAILABLE` | Vantage cannot independently prove the upstream submission arrived. |
| `RINGCENTRAL_CURSOR_BOUNDED` | Call completeness is valid only through the last successful provider cursor. |
| `GOOGLE_DESTINATION_UNVERIFIED` | Outbox completion is not current destination equality. |
| `MOVE_COMPLETION_UNAVAILABLE` | No move-completion system-of-record fact exists. |
| `MULTI_QUERY_READ` | The page is assembled across multiple reads, not one database snapshot. |

Every code has one evaluator in the server module. The Admin must not recreate
the conditions.

## 9. UI specification

### 9.1 Page hierarchy

The enhanced page is ordered:

1. Typed Job Number search.
2. Job identity and current outcome.
3. “What we know” stage strip.
4. Attention panel, only when actionable items exist.
5. Oldest-first lifecycle story.
6. Collapsed “Proof boundaries” panel.

### 9.2 Header

Show:

- Job Number;
- current outcome in plain language;
- origin label and source granularity;
- latest activity time;
- assembled/freshness time;
- count of actionable attention items.

Replace the current flat coverage chips with stage assessments. Chips such as
“Booking absent” and “Cancellation absent” are ambiguous; an active Lead has not
necessarily failed because it has not booked or cancelled.

Recommended labels:

- Lead recorded
- Text delivered / Text skipped / No text recorded
- Booking intake open / Booked / Not yet booked
- Cancellation intake open / Cancelled / No cancellation activity
- Sheet caught up / Sheet pending / Sheet failed / Google not verified

### 9.3 Timeline cards

Default card content:

- stage marker and distinct icon;
- locked headline;
- one owner-readable summary sentence;
- occurred time in Florida time;
- status and evidence-strength badge.

Expanded “View evidence” content:

- occurred and recorded clocks with field names;
- source and command;
- safe changed-field groups;
- correlation explanation;
- related processing steps in the same `activity_id`;
- safe evidence references and provider/outbox status.

Do not expose raw JSON. A separate forensic deep link may open the existing
Granot lifecycle page for users permitted to see it.

### 9.4 Density controls

Default filter is **Lifecycle story**. Also provide:

- `All evidence` — every technical event;
- `Attention only` — events and stages associated with attention;
- `Customer lifecycle` — Lead, message, Booking, and Cancellation facts;
- `System processing` — receipts, Observations, Decisions, changes, and sync.

Filtering hides presentation rows only. It does not change the page summary,
stage assessments, outcome, or attention evaluation.

### 9.5 Activity grouping

Group technically related events under a shared activity heading, for example:

```text
Granot updated the Lead                         Aug 27, 11:03 AM
  Observed: priority_updated
  Decided: applied / lead_state_changed
  Changed: Move details
  Delivered: Sheet Sync synced
```

The group is presentation only. Expanding it reveals each original event and
clock. Official Booking and official Cancellation always remain independently
visible, even if caused by a related intake activity.

### 9.6 Deep links

Any existing Owner surface that already knows a Job Number may link to:

```text
/job-timeline?job=<typed-or-normalized-job-number>
```

Do not add contact-based timeline search. Do not add a Job catalog. Preserve the
URL as the shareable page state.

## 10. Deep module design

### 10.1 External seam

Create one deep production module whose interface is:

```ts
type JobNumberTimelineModule = {
  read(input: {
    job_no: string;
    source_granularity_id?: string;
    source_company_id?: string;
    now?: Date;
  }): Promise<JobTimelineAssembleResult>;
};
```

The caller does not know collection names, walk-back order, sort priorities,
evidence mappings, freshness evaluation, or redaction rules. Deleting this
module would force that complexity into the route, CLI, Daily links, and tests;
that is the depth it must own.

### 10.2 Internal seams and adapters

```text
src/services/jobNumberTimeline/
  index.ts                    external interface/factory only
  types.ts                    response contract
  module.ts                   orchestration
  evidence-loader.port.ts     internal read port
  mongo-evidence-loader.ts    production adapter
  memory-evidence-loader.ts   test adapter
  projector.ts                correlation, events, activities, stages
  evidence.ts                 strength and source mappings
  outcome.ts                  current outcome + contradiction rules
  attention.ts                attention/limitation evaluators
  masking.ts                  transport-safe redaction
  clocks.ts                   dual-clock selection and ordering
```

The Mongo adapter and in-memory adapter make the loader seam real. Tests call
the same module interface as the route. Keep lower-level pure tests only for
clock ordering and Job Number equivalence where the invariant is otherwise
opaque.

### 10.3 Source posture

The loader may read:

- Form Lead and Call Lead;
- Lead Message;
- EntityChange;
- Granot Observation Receipt and Observation;
- latest Synchronization Decision per Observation;
- Granot Record Link;
- Booking and Release reconciliation cases;
- official Booking and Cancellation;
- Sheet Sync job;
- RingCentral processed-call ledger and Call Log cursor state;
- source company/granularity label snapshots.

It must not read `OperationalEvent` or perform any mutation.

## 11. Data integrity recommendations

### 11.1 Cancellation snapshots

The production proof found 48 historical Cancellations but only 11 surviving
Booking links from which Job Number can be recovered. Fix future traceability by
stamping immutable safe correlation snapshots on Cancellation creation:

```ts
job_no_snapshot: string | null;
normalized_job_no_snapshot: string | null;
lead_ref_snapshot: { model: "FormLead" | "CallLead"; id: string } | null;
booking_created_at_snapshot: Date | null;
```

This is a separate write-path migration and requires its own report-first
backfill plan. The timeline enhancement may read these fields when present but
must not silently guess them for historical rows.

### 11.2 WordPress receipt

Add a durable WordPress submission receipt before Lead creation in a later
source-assurance issue. It should have an idempotency key, received time,
processing status, and resulting Lead reference. Until then, the timeline shows
the limitation.

### 11.3 Google destination verification

Do not query Google Sheets on every timeline page load. That would make the
Owner UI slow and fragile and would confuse live operational reads with audits.

The later Assurance system should run scheduled or sampled destination
read-backs, store safe verification results, and let the timeline read the most
recent result. A manual “Verify now” command, if ever added, is a separate
owner-gated mutation with rate limits and audit evidence.

### 11.4 Move completion

Do not infer completion from move date, absence of cancellation, Sheet state, or
Granot priority. Add a durable official Move Completion fact or an explicit
state on the appropriate aggregate before adding the stage.

## 12. Performance and security

- Owner-only at server and Admin gates.
- No contact, SMS body, transcript, recording URL, provider payload, Sheet ID,
  Sheet row, or raw error body in the response.
- Prefer parallel bounded reads after the first Job-scoped hop.
- No unbounded distinct Job Number query and no `$lookup` pipeline on the hot
  route.
- Cap the response at 250 evidence events. If exceeded, return a named
  `TIMELINE_TRUNCATED` limitation and counts by stage; never silently truncate.
- Set `assembled_at` after all reads complete.
- Cache only by normalized Job Number + source scope for a short interval; never
  cache across authorization scopes.
- Recommended service objective after production measurement: warm p95 under
  750 ms and error rate below 1%. Measure before turning the target into an
  alert.

## 13. Testing and proof plan

### 13.1 Preserve current tests

All current prototype tests remain regression requirements, especially:

- WordPress pre-Job-number walk-back;
- Granot-born and RingCentral-born shapes;
- latest Decision attempt only;
- intake is not official fact;
- equivalent Job Number search;
- Sheet Sync join by entity ID;
- masking and no invented Sheet events.

### 13.2 New named tests

1. `source receipt and lead creation remain separate events`.
2. `wordpress creation reports receipt limitation without inventing receipt`.
3. `dual clocks order by occurred time and preserve recorded time`.
4. `related receipt decision change and sheet rows share activity id`.
5. `activity grouping does not remove original evidence events`.
6. `text policy skip is not applicable rather than attention`.
7. `open booking intake yields active stage and no official booking`.
8. `resolved finalizing booking case without fact yields attention`.
9. `ordinary booked job has no cancellation attention`.
10. `resolved release case without cancellation yields attention`.
11. `official cancellation determines cancelled outcome`.
12. `contradictory official chronology yields contradictory outcome`.
13. `synced sheet job still reports google destination unverified`.
14. `orphan cancellation is not attached without durable job snapshot`.
15. `cancellation snapshot restores exact job correlation`.
16. `event cap returns explicit truncation limitation`.
17. `serialized v2 page contains no forbidden fields or contact`.
18. `v1 fixture remains renderable during client migration`.

### 13.3 Live read-only proof

Before rollout, run masked reads against production and produce a report that
answers:

- each origin shape can render;
- at least one pre-Job-number Lead chain walks back correctly;
- at least one chain includes Booking intake and official Booking;
- at least one chain includes Cancellation intake;
- at least one historical chain includes official Cancellation;
- activity grouping preserves event counts;
- attention codes correspond to inspected source rows;
- no database collection count changes during the run;
- no forbidden data appears in serialized output.

## 14. Seam with Owner Daily Assurance and notifications

The Timeline module owns **one Job's evidence and stage assessment**.

The future Owner Daily Assurance module owns:

- window equations such as receipt → Observation → latest Decision → Change;
- population completeness by source;
- RingCentral cursor and scheduled-job health;
- WordPress receipt coverage;
- Sheet outbox backlog and Google destination verification;
- stale thresholds, alert deduplication, acknowledgement, and resolution;
- event-driven notification policy and delivery.

The two modules share only stable vocabulary:

- evidence levels;
- attention codes;
- source/freshness watermark shapes;
- safe entity references.

They do not share queries or make one module call the other's UI projection.
Daily Assurance may deep-link an affected Job to `/job-timeline?job=...`.

The Timeline emits attention data but sends no notification. Later, a dedicated
notification policy may decide that a repeated or unresolved attention code is
notifiable. This prevents UI rendering from becoming a notification producer.

## 15. Implementation plan

### Phase 0 — productionize the current seam

1. Move runtime assembler, loader, types, masking, and normalization into
   `src/services/jobNumberTimeline/`.
2. Introduce the Mongo and in-memory evidence-loader adapters.
3. Change the HTTP route and CLI to call the production module interface.
4. Preserve the current response byte-for-byte in regression fixtures.
5. Update the current Service document so `src/` is primary code and the
   prototype is a retained CLI/proof adapter.

**Exit:** no runtime file imports `scripts/prototypes/job-number-timeline`.
**Status:** complete (JTE-01).

### Phase 1 — v2 evidence contract

1. Add `schema_version`, stages, evidence levels, dual clocks, correlation,
   causality, freshness, limitations, and activities.
2. Add the source-receipt reads available today.
3. Implement outcome and attention evaluators in the server.
4. Keep all additions backward compatible.
5. Produce synthetic golden pages for the main origin/outcome shapes.

**Exit:** the server can answer all questions in section 3 that current data
supports, while naming every unsupported edge.

### Phase 2 — enhanced Owner UI

1. Replace coverage chips with stage assessments and current outcome.
2. Add attention and proof-boundary panels.
3. Add lifecycle/evidence/attention density filters.
4. Add expandable evidence and activity grouping.
5. Preserve locked headlines, oldest-first reading, URL search state, and the
   no-catalog rule.
6. Add responsive, keyboard, screen-reader, and visual-regression coverage.

**Exit:** an Owner can understand the story by scanning and inspect proof
without visiting the forensic screen.

### Phase 3 — correlation durability

1. Specify and implement Cancellation correlation snapshots.
2. Run report-first historical backfill analysis.
3. Backfill only rows with deterministic surviving evidence and report the
   irreducible remainder.
4. Add WordPress receipt capture as a separate source-assurance issue.

**Exit:** future Cancellations remain Job-traceable even if Booking lifecycle
retention changes; WordPress can eventually move from bounded to verified
ingress coverage.

### Phase 4 — integration and rollout

1. Add deep links from Owner Daily, Lead search, intake, Booking, and
   Cancellation screens.
2. Run live masked proof and performance measurement.
3. Roll out Owner-only behind a read capability flag if needed.
4. Observe not-found, limited-correlation, truncation, and latency metrics.
5. Remove v1 client fallback only after all deployed clients consume v2.

**Exit:** timeline is the canonical single-Job owner read and is ready to receive
deep links from the later Daily Assurance system.

## 16. Recommended issue split

Executable contracts live in [`issues/`](issues/). The four-session map
is in [`README.md`](README.md). `JTE-06` and `JTE-07` stay deferred.

| Issue | Deliverable | Depends on |
| --- | --- | --- |
| `JTE-01` | Extract deep runtime module; route and CLI use it | current timeline |
| `JTE-02` | v2 types, dual clocks, evidence/correlation/activity projection | JTE-01 |
| `JTE-03` | Outcome, stage assessment, attention, limitations, freshness | JTE-02 |
| `JTE-04` | Enhanced Owner UI and evidence expansion | JTE-03 |
| `JTE-05` | Live proof, security, accessibility, and performance certification | JTE-04 |
| `JTE-06` | Cancellation correlation snapshots and report-first backfill | JTE-02; separate write approval |
| `JTE-07` | WordPress durable receipt capture | separate source-assurance approval |

`JTE-06` and `JTE-07` improve evidence quality but do not block shipping the
honest enhanced timeline.

## 17. Acceptance criteria

- [ ] The page separates source receipt from official Lead creation.
- [ ] Every event has a stage, evidence level, dual-clock metadata, correlation
      explanation, and stable activity ID.
- [ ] No event is inferred solely to complete a visual lifecycle.
- [ ] Current outcome distinguishes intake from official fact and surfaces
      contradictions.
- [ ] Stage assessments distinguish not started, not applicable, attention, and
      unverifiable.
- [ ] WordPress receipt and Google destination limitations are explicit.
- [ ] RingCentral confidence is bounded by its displayed provider cursor.
- [ ] Sheet `synced` is never described as destination equality.
- [ ] No move-completion event appears without a new official fact.
- [ ] No contact, content, provider payload, Sheet ID, or raw error leaks.
- [ ] The server is the only evaluator of outcome, attention, and limitations.
- [ ] Runtime code no longer imports the prototype folder.
- [ ] Existing timeline tests and the new named tests pass.
- [ ] Production proof is read-only, masked, and count-stable.
- [ ] The Timeline sends no notification and performs no reconciliation write.
- [ ] Daily Assurance can link to the page without importing its query logic.

## 18. Recommendation summary

Build this enhancement before the larger Owner Daily Assurance system. It gives
the Owner a trustworthy object-level story and forces the evidence language to
stabilize. Then use those stable attention codes, evidence levels, and deep
links in Daily Assurance without turning the timeline itself into an aggregate
health engine.

The most important implementation choices are:

1. productionize the current prototype behind one deep module interface;
2. preserve read-time composition and authoritative source collections;
3. make absence expectation-aware rather than automatically alarming;
4. show causal groups while retaining every underlying event;
5. expose proof boundaries as clearly as successful events;
6. repair future Cancellation correlation with immutable snapshots;
7. keep external verification and notification policy for the later Assurance
   module.
