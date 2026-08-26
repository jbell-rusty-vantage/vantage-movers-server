---
type: Specification
title: Job Number timeline — typed search, owner-facing chain, and new Admin tab
description: >-
  Prove that a typed Job Number walks back to the best-case owner-facing
  chain (create with Ingestion Origin, Lead Message, later updates, Granot
  Observations, latest Synchronization Decisions, Booking and Cancellation
  intake, official facts, Sheet Sync) including events before the Lead had
  a Job Number. Retrieval and how the timeline looks are the product.
  A follow-on Admin agent ships a new dashboard tab (New badge) whose
  components are written with the 21st.dev MCP and CLI.
tags:
  - granot-lifecycle
  - prototype
  - timeline
  - job-number
status: draft
stale_after: 2026-11-26
owners: [team:main-server]
applies_to:
  - scripts/prototypes/job-number-timeline/**
  - vantage-admin/components/job-number-timeline/**
  - vantage-admin/components/layout/dashboard-nav.tsx
  - vantage-admin/components/granot-lifecycle/granot-navigation.tsx
sources:
  - id: glossary
    resource: ../../../../../CONTEXT.md
    title: Platform glossary
  - id: processor
    resource: ../../../../docs/knowledge/granot-lifecycle/processor.md
  - id: projections
    resource: ../../../../docs/knowledge/granot-lifecycle/projections.md
  - id: lead-messaging
    resource: ../../../../docs/knowledge/services/lead-messaging.md
  - id: domain-commands
    resource: ../../../../docs/knowledge/services/domain-commands.md
  - id: sheet-sync
    resource: ../../../../docs/knowledge/services/sheet-sync.md
---

# Job Number timeline

> **Contract maturity: implementation-ready** for retrieval and the
> event/look contract. Admin components are a **follow-on** that must
> consume this page DTO — they do not invent a second assembler.
>
> Two layers, one document:
>
> 1. **Retrieval** (this repo, scripts first). A typed Job Number is
>    normalized and searched through the first-hop walk-back. There is
>    **no catalog** and **no dropdown of every Job Number**. If the Owner
>    typed it, we must find it (including P-prefix / digit-core
>    equivalents and the create/SMS window before the Lead had a Job
>    Number).
> 2. **Look + Admin tab** (`vantage-admin`). A **new** dashboard tab,
>    marked as a new feature the same way Intakes is (`isNew: true` +
>    `NewFeatureBadge`). The agent who builds that tab and the timeline
>    components **must Write new UI with the 21st.dev MCP and CLI**. Do
>    not restyle `components/granot-lifecycle/job-timeline.tsx` — that
>    renderer is the forensic Lifecycle dump, not the Owner chain.
>
> This prototype does not add a Mongo collection, does not extend
> `GranotTimelineEntry`, and does not change
> `src/services/granotLifecycle/projections.ts`. The scripts assembler
> is the semantic authority for the new chain.

## 1. Why this document exists

The production Job timeline starts at `identity.normalized_job_no` and
emits a forensic dump of Observations, Decisions, cases, Record Links,
Entity Changes, and current official facts. That dump is the right
**cluster**. It is not yet the Owner-facing chain:

| Wanted on the chain | In `projectGranotJob` today |
| --- | --- |
| Lead created, with Ingestion Origin | Only if a Record Link exists **and** a create EntityChange is loaded via the Booking's lead_ref. WordPress / RingCentral create before Job Number is easy to miss. |
| Text message sent | Never. `lead_messages` is not in the projection. |
| Update occurred | Partially, as `entity_change` / `decision` rows, not as a named update. |
| Booking intake occurred | Yes, as `case` `kind:"booking"`. |
| Cancellation intake occurred | Yes, as `case` `kind:"release"`. |
| Granot Observations | Yes. |
| Synchronization Decisions | Yes, but the current assembler takes **first** attempt, not latest. |
| Sheet Sync | Never. `sheet_sync_jobs` is not in the projection. `sheet_sync_requested` on a Decision is an effect summary, not the outbox row. |

The other binding fact: **a Lead often has no Job Number at create.**
WordPress Form Ingestion and many RingCentral Call Leads are created
with phone / `ref_no` only. The Job Number arrives later from Granot
(`synchronizeLeadFromGranot` fills `job_no` / `normalized_job_no`, or
`createLeadFromGranot` is born with one). A Job Number search that
only looks at `form_leads.normalized_job_no` will miss the beginning
of the cycle.

This prototype proves the walk-back: start at the Job Number, resolve
the Lead, then load events that never carried a Job Number.

## 2. Authority and required reading

- Workspace glossary: [`CONTEXT.md`](../../../../../CONTEXT.md) — **Lead**,
  **Job Number**, **Ingestion Origin**, **Granot Observation**,
  **Synchronization Decision**, **Granot Record Link**, **Granot Booking
  Reconciliation Case**, **Granot Release Reconciliation Case**,
  **Lead Message**, **Sheet Sync**, **Booking Chain**, **Cancellation
  Chain**, **Booking**, **Cancellation**, **Source Granularity**.
- Processor and desired-state: [`processor.md`](../../../../docs/knowledge/granot-lifecycle/processor.md),
  [`desired-state.md`](../../../../docs/knowledge/granot-lifecycle/desired-state.md).
- Existing timeline: [`projections.md`](../../../../docs/knowledge/granot-lifecycle/projections.md)
  and `src/services/granotLifecycle/projections.ts` (`buildTimelineForJob`).
- Lead Messages: [`lead-messaging.md`](../../../../docs/knowledge/services/lead-messaging.md).
- Commands / Entity Change: [`domain-commands.md`](../../../../docs/knowledge/services/domain-commands.md).
- Sheet Sync outbox: [`sheet-sync.md`](../../../../docs/knowledge/services/sheet-sync.md)
  and `src/models/SheetSyncJob.ts`. Mongo is the System of Record; sheets
  are eventually consistent. A successful domain write does not mean
  sheets are already updated.
- Job Number normalizer: `src/services/bookings/bookingIdentity.ts`
  (`normalizeJobNo`, `equivalentNormalizedJobFilter`).
- Prior data-level recommendation: two axes — official spine vs Granot
  cluster. This prototype implements the **cluster keyed by Job Number**,
  plus the walk-back onto create / SMS. It does not invent a persisted
  event store.

The glossary wins on names. A case is not a Booking. Priority 5 is not
Booked. A Decision is not a Lead write unless `outcome` is `applied` or
`created`.

## 3. Objective

Leave `vantage-main-server` with one read-only prototype module that,
given a raw Job Number (and optionally a Source Granularity), prints a
single oldest-first chain containing every best-case event we can
honestly prove from Mongo:

```text
lead_created          ingestion_origin + how the Lead was minted
lead_message          outbound SMS, status, purpose
job_number_acquired   first time this Lead became findable by Job Number
lead_updated          later authorized Lead mutations
granot_observation    each Observation on the Job
synchronization_decision  latest Decision per Observation
booking_intake        Booking Reconciliation Case opened / refreshed / resolved
cancellation_intake   Release Reconciliation Case opened / refreshed / resolved
official_booking      current official Booking fact, if one exists
official_cancellation current official Cancellation fact, if one exists
sheet_sync            outbox job for that Lead / Booking / Cancellation
```

The only search entry is a **typed raw Job Number**. Normalize it,
apply `equivalentNormalizedJobFilter`, walk back (section 7), and
render the chain. Do not pre-load Job Numbers for selection.

A second CLI mode **discovers** the richest jobs (optionally scoped to a
Source Company or Source Granularity) so we can find proof-shape
examples without guessing. Discover is an ops helper, not a picker
the Owner uses.

At handoff we can point at a gitignored report and say: this typed Job
Number produced create-with-origin, a text, an update, a Booking
intake, and (when present) a Cancellation intake, plus every
Observation, latest Decision, and Sheet Sync job on that Job — and
the chain reads as that story, not as a forensic dump.

## 4. Repository, branch, and posture

- **Retrieval lives in** `vantage-main-server` at
  `scripts/prototypes/job-number-timeline/`.
- **Look lives in** `vantage-admin` as a **new** feature tab and new
  timeline components (section 10). That work is a follow-on agent; it
  must not start until the assembler DTO and headlines in section 9
  exist.
- The scripts work adds **no** HTTP route, flag, or index apply, and
  does **not** change `projections.ts`.
- Ordinary assembler tests use redacted synthetic documents in memory.
  They do not require Mongo.
- A live read requires an explicit database name and, for production,
  `--confirm-production-db=vantagemovers` (same gate as
  `scripts/export-granot-priority-booking-examples.ts`).
- Default live target is the `TEST_MODE` database. The script refuses
  `vantagemovers` without the confirm flag.
- **Zero writes.** The script may not insert, update, delete, or create
  indexes. Prove this with a test that the assembler is a pure function
  over injected rows, and with an acceptance check that
  `domain_command_executions` / `entity_changes` / case /
  `sheet_sync_jobs` counts are unchanged after a live read.
- Output is gitignored under `scripts/output/job-number-timeline/`.
- Mask names, phones, emails, SMS `body`, and raw receipt payloads.
  **Keep the Job Number** — it is the query key and the Owner lookup
  key, matching the existing owner-briefing script. Do not print
  Observation contact or Lead Message destination.

## 5. Current-state evidence (reverify at implementation)

Observed 2026-08-26 in `vantagemovers`. Reverify; do not treat as
durable proof.

| Fact | Count | Meaning for this prototype |
| --- | ---: | --- |
| Official Bookings | 602 | Most sales have no Granot Record Link (13 do). Job-first still finds a Booking by `normalized_job_no`. |
| Bookings with EntityChange | 15 | Official Booking node is usually `official_fact_only`. |
| `confirmGranotBooking` commands | 13 | Best Booking-intake → official Booking examples. |
| Booking cases (`booking_case_opened` latest Decisions) | 40 | Intake can exist without an official Booking. |
| Open Release cases | 3 | Cancellation intake exists. `createCancellation` commands: 0. |
| Official Cancellations | 48 | 0 Cancellation EntityChanges. Only 11 still have a living Booking. |
| `createLeadFromGranot` | 127 | Granot-born Leads **have** a Job Number at create. |
| `createFormLead` EntityChanges | 145 | WordPress-born Leads usually **do not** have a Job Number at create. |
| `lead_messages` delivered, `granot_lead_created` | 109 | Join by `lead_ref` and optional `observation_id`. |
| `lead_messages` delivered, `public_form` | 1,306 | Join by `lead_ref` / `form_lead` only. No Job Number on the message. |
| Form Leads `ingestion_origin=legacy_unknown` | 4,511 | Create node is honest `official_fact_only`. Do not invent a command. |
| `sheet_sync_jobs` `form_lead.create` synced | 4,976 | WordPress create already wrote an outbox row **before** Job Number existed. Join by Lead ID after walk-back. |
| `sheet_sync_jobs` `form_lead.update` synced | 6,119 | Later Granot / owner updates request another source-lead job. |
| `sheet_sync_jobs` `booking_chain` / `booked_lead.create` synced | 584 | Official Booking writes a Booking Chain job. Join by Booking ID, never by Job Number. |
| `sheet_sync_jobs` `cancellation_chain` / `cancelled_lead.create` synced | 47 | Official Cancellation writes a Cancellation Chain job. Join by Cancellation ID. |
| Unique Form / Call Lead `normalized_job_no` | 402 / 819 | **Do not search these first.** A typed Job Number that only exists on a Lead, with no Observation / link / Booking / case, is `not_found`. |
| Official Cancellations with `normalized_job_no` | 0 of 48 | Cancellation joins by `booked_lead`. Typed search finds them through the Booking. |
| First-hop P-prefix / digit-core equivalent groups | 9 | Typed `P5562924` and `5562924` must assemble the same page. |

The existing assembler in `buildTimelineForJob` (`projections.ts` ~895)
loads Observations / Decisions / cases / links / Booking / Cancellation
/ Entity Changes for the Job. It does **not** load `lead_messages`. It
does **not** load `sheet_sync_jobs`. It does **not** walk back to a
WordPress create that predates `lead.normalized_job_no`. It takes
`decisionsByObservation[id].sort(attempt)[0]` — first attempt, not
latest.

## 6. Locked decisions

1. **Job Number is the operating key.** The prototype is
   `assembleJobNumberTimeline(rawJobNo, filters)`. There is no
   lead-first public interface in this prototype. Lead ID is an
   *internal* walk-back result.
2. **Do not query `form_leads.normalized_job_no` as the first hop.**
   That field is empty at WordPress create. First hop is always
   Observations + Record Links + Booking + cases on the normalized Job
   Number. The Lead is resolved *from those*, then create / SMS / Lead
   Entity Changes / source-lead Sheet Sync jobs are loaded by Lead ID.
3. **Latest Decision attempt only.** Sort `attempt` descending and keep
   one Decision per Observation. Pending-match retries must not appear
   as separate service decisions.
4. **A case is not a Booking. Priority 5 is not Booked. `quoted` is not
   Booked.** Those appear as Observation / Decision / intake events.
   `official_booking` appears only when a `BookedLead` exists for the
   Job.
5. **Do not contact-match at read time.** No phone / email search to
   invent a Lead. If the Job has no Record Link, no Booking `lead_ref`,
   and no Decision `target` that is a Lead, the create / SMS / Lead-update
   nodes are omitted and `coverage.lead` is `unresolved`.
6. **Do not persist a new event store** and do not extend
   `GranotTimelineEntry`. The prototype DTO is local to
   `scripts/prototypes/job-number-timeline/`.
7. **Do not call `projectGranotJob` as the assembler.** Reuse
   `normalizeJobNo`, `equivalentNormalizedJobFilter`, and the same
   contact-masking *rules* (never relax `assertProjectionSafe` in
   production code). The prototype owns its own walk-back.
8. **Source Granularity is a filter, not a second key.** A Job Number
   is globally unique for an active Record Link. Granularity decides
   whether this Job is in the requested stream after the Lead / Decision
   / link scope is known.
9. **Clocks are recorded time, never the business date the Owner typed.**
   Booking uses `timestamp` (fallback `createdAt`), never `book_date`.
   Cancellation uses `createdAt`, never `cancel_date`.
10. **Honest gaps are success.** Missing SMS, missing Cancellation
    intake, missing Sheet Sync, or `legacy_unknown` origin must appear
    as named coverage flags, not as invented events.
11. **Sheet Sync is a projection, not a state transition.** A
    `sheet_sync` event never means the Lead became Booked or Cancelled.
    A Decision effect `sheet_sync_requested` is a plan summary; the
    outbox row in `sheet_sync_jobs` is the event. Do not invent a
    `sheet_sync` event from the effect alone. Do not emit events from
    the embedded `sheet_sync[]` target snapshots on the aggregate
    (spreadsheet / tab / row). Those are current projection hints, not
    the outbox history.
12. **Typed Job Number is the only search entry.** The Owner types a
    raw Job Number. The CLI takes `--job-no`. There is no catalog
    mode, no distinct-all load, and no selectable list of every Job
    Number. Search is `normalizeJobNo` + `equivalentNormalizedJobFilter`
    on the first-hop collections (section 7), then walk-back. Blank or
    invalid input fails closed. A typed Job that first-hop cannot see
    is `not_found`, not an empty Lead search.
13. **The Owner-facing timeline is a new Admin feature, written with
    21st.dev.** The follow-on agent adds a new dashboard tab marked
    `isNew: true` with `NewFeatureBadge` (same pattern as Intakes).
    Components are generated through the 21st.dev MCP **Write**
    (`generate`) and the 21st CLI — not by restyling
    `JobTimeline`. Section 10 is binding for that agent.

## 7. The walk-back (this is the prototype)

This is the entire reason the work lives in scripts first.

```text
raw job_no
  -> normalizeJobNo
  -> equivalentNormalizedJobFilter   (P-prefix / digit-core equivalents)
  -> load, in parallel:
       granot_observations.identity.normalized_job_no
       granot_record_links.normalized_job_no
       booked_leads.normalized_job_no
       granot_booking_reconciliation_cases.normalized_job_no
       granot_release_reconciliation_cases.normalized_job_no
       granot_booking_discrepancies / granot_release_discrepancies
  -> decisions for those observation_ids (keep max attempt)
  -> resolve lead_ref = first present of:
       active Record Link.lead_ref
       BookedLead.lead_ref + lead_model
       latest created/applied Decision.target if model is FormLead|CallLead
     (never a case suggestion)
  -> if lead_ref:
       load the Lead
       load entity_changes where entity = that Lead
       load lead_messages where lead_ref.id = Lead _id
         (also form_lead = Lead _id when model is FormLead)
  -> load sheet_sync_jobs where entity_id is the string form of
       resolved Lead _id and/or Booking _id and/or Cancellation _id
       (never query sheet_sync_jobs by Job Number — the outbox has none)
  -> apply Source Granularity filter (section 8)
  -> emit events (section 9), sort (event_at, type_priority, id)
```

### 7.3 Sheet Sync join (same walk-back as SMS)

`sheet_sync_jobs.entity_id` is the Mongo id of a Form Lead, Call Lead,
Booking, or Cancellation. WordPress `form_lead.create` jobs exist
**before** the Lead has a Job Number. Booking Chain and Cancellation
Chain jobs exist only after an official fact. Therefore:

| Job `resource` | Load after | `entity_id` is |
| --- | --- | --- |
| `source_lead` | Lead resolved | Lead `_id` |
| `booked_lead` / `booking_chain` | Booking found for the Job | Booking `_id` |
| `cancellation_chain` | Cancellation found | Cancellation `_id` |
| `delete_*` | Same as the surviving or tombstoned aggregate | that aggregate `_id` |

If the Lead is unresolved, source-lead jobs are omitted (`coverage.sheet_sync`
still reports `absent` for that hop). Do not phone-match a job onto a
Lead. Do not join `entity_id` to a Decision id or a case id — those
are not outbox entities. A No Action command writes no Sheet Sync job;
that is correct and must stay empty.

Coalescing: only `pending` / `retrying` rows collapse. A later write
after `synced` creates a **new** job. Emit **one timeline event per
outbox row**. Do not collapse history in the assembler.

### 7.1 How Job Number is acquired (must be a visible event)

Emit `job_number_acquired` from the earliest honest proof, in this
priority:

1. Lead EntityChange whose `changed_paths` includes `job_no` or
   `normalized_job_no` — clock `applied_at`, command
   `synchronizeLeadFromGranot` or `createLeadFromGranot`.
2. Else `createLeadFromGranot` EntityChange on the Lead (Granot-born:
   Job Number existed at create). Clock `applied_at`. Mark
   `acquired_at_create: true`.
3. Else Record Link `established_at` when the link carries `lead_ref`.
4. Else first Observation `captured_at` on this Job.

If (1) exists and a WordPress / RingCentral `lead_created` event is
**earlier**, the report must show create **before** `job_number_acquired`.
That is the proof that the beginning of the cycle had no Job Number.

### 7.2 Two named proof shapes

The discover mode must try to surface both. If production has no row
for a shape, the report says so — it does not invent one.

| Shape | How the Lead starts | What the chain must show |
| --- | --- | --- |
| **Granot-born** | `createLeadFromGranot`, `ingestion_origin: granot_lead_created` | `lead_created` already has a Job Number (`acquired_at_create: true`), optional `lead_message` (`origin: granot_lead_created`, joinable by `observation_id`), later Observations / Decisions, Booking intake if present, `sheet_sync` on the Lead (and Booking / Cancellation when those facts exist). |
| **WordPress-born** | `createFormLead`, `ingestion_origin: wordpress_form` | `lead_created` **without** Job Number, `lead_message` (`origin: public_form`, join by `lead_ref` / `form_lead` only), `sheet_sync` `form_lead.create` joined by Lead ID (no Job Number on the job), then `job_number_acquired` from a later Granot sync / link, then updates / intakes / later `form_lead.update` Sheet Sync. |

RingCentral-born (`ingestion_origin: ringcentral`) is a third shape if
found: create may be Job-only or phone-only; do not fabricate telephony
fields. `legacy_unknown` is not a proof shape; it may still appear on a
rendered Job as `official_fact_only`.

## 8. Filters

### 8.1 CLI

```text
pnpm prototype:job-number-timeline -- render --job-no <raw>
  [--source-granularity-id <ObjectId hex>]
  [--source-company-id <ObjectId hex>]
  [--confirm-production-db=vantagemovers]

pnpm prototype:job-number-timeline -- discover
  [--source-granularity-id <ObjectId hex>]
  [--source-company-id <ObjectId hex>]
  [--limit 20]
  [--min-score 4]
  [--confirm-production-db=vantagemovers]
```

Unknown flags fail closed. There is no `list` mode.

`--job-no` is required for `render`. Raw input is trimmed and passed
through `normalizeJobNo`. Invalid / blank Job Number exits `2` with a
PII-safe message (`invalid_job_number`). After normalize, search uses
`equivalentNormalizedJobFilter` so a typed letter prefix matches a
digit-core Observation (and the reverse). If first-hop collections
return nothing, `render` prints `not_found` for that normalized key
and writes no event list — it does **not** fall through to
`form_leads.normalized_job_no` or a contact search.

`--source-company-id` expands to the Source Granularities of that
Source Company (from `lead_source_granularities`). If both company and
granularity are supplied, the granularity must belong to the company
or the run exits `2`.

### 8.2 When a Job is in scope

A Job passes the granularity filter when **any** of these resolved
scopes equals the requested granularity (or is in the company
expansion):

- Lead `source_granularity_id`
- Active Record Link `source_scope.source_granularity_id`
- Latest Decision `source_scope.source_granularity_id`
- Observation `granot_crm_source_id` → current reviewed
  `GranotCrmSource` route `source_granularity_id` (read-only Registry
  join; do not re-plan policy)

If the filter is set and none of those scopes match, `render` prints
`filtered_out` with the resolved scopes (IDs and `owner_label` /
label snapshots only) and writes no event list. It does not fall back
to source label string match.

### 8.3 Discover ranking

Score a Job after walk-back (not before — WordPress create / SMS are
invisible until the Lead is resolved):

| Signal | Points |
| --- | ---: |
| `lead_created` present | 1 |
| `lead_message` in `{accepted, sent, delivered}` | 1 |
| `lead_updated` or `job_number_acquired` after create | 1 |
| ≥1 `granot_observation` | 1 |
| ≥1 latest `synchronization_decision` | 1 |
| `booking_intake` opened or resolved | 1 |
| `cancellation_intake` opened or resolved | 1 |
| WordPress-born walk-back proved (`lead_created.event_at` < `job_number_acquired.event_at`) | +2 bonus |
| Official Booking present | +1 bonus |
| Official Cancellation present | +1 bonus |
| ≥1 `sheet_sync` with `status: synced` | +1 bonus |

Default `--min-score` is 4. Default `--limit` is 20. Discover prints
one row per Job: masked job (or full job — Job Number is kept),
granularity label, score, present kinds, proof shape
(`granot_born` | `wordpress_born` | `ringcentral_born` | `other`).

Discover must not print contact. Discover is not a substitute for
typed search on the Admin tab.

## 9. Event contract

Local TypeScript types in `src/types.ts` inside the prototype folder.
Do not import `GranotTimelineEntry`.

```ts
export type JobTimelineEventKind =
  | "lead_created"
  | "lead_message"
  | "job_number_acquired"
  | "lead_updated"
  | "granot_observation"
  | "synchronization_decision"
  | "booking_intake"
  | "cancellation_intake"
  | "official_booking"
  | "official_cancellation"
  | "sheet_sync";

export type JobTimelineEvent = {
  id: string;
  kind: JobTimelineEventKind;
  event_at: string;          // ISO
  clock_field: string;       // self-describing: "lead.timestamp", "entity_change.applied_at", …
  type_priority: number;     // locked table below
  coverage: "command_backed" | "official_fact_only" | "evidence_only";
  headline: string;          // PII-safe, one line
  data: Record<string, unknown>; // kind-specific, no contact, no SMS body, no payload
};

export type JobTimelinePage = {
  normalized_job_no: string;
  job_no_snapshot: string | null;
  proof_shape: "granot_born" | "wordpress_born" | "ringcentral_born" | "other";
  source: {
    source_company_id: string | null;
    source_company_label: string | null;
    source_granularity_id: string | null;
    source_granularity_label: string | null;
  };
  coverage: {
    lead: "resolved" | "unresolved";
    lead_message: "present" | "absent";
    job_number_at_create: boolean;
    booking_intake: "absent" | "open" | "resolved";
    cancellation_intake: "absent" | "open" | "resolved";
    official_booking: boolean;
    official_cancellation: boolean;
    sheet_sync: "absent" | "pending" | "synced" | "failed" | "mixed";
  };
  current: {
    lead_ref?: { model: "FormLead" | "CallLead"; id: string };
    ingestion_origin?: string;
    record_link_id?: string;
    booking_id?: string;
    cancellation_id?: string;
  };
  events: JobTimelineEvent[];
};
```

### 9.1 Type priorities (stable sort)

Same idea as the production timeline: `(event_at, type_priority, id)`.

| Priority | Kind |
| ---: | --- |
| 10 | `lead_created` |
| 20 | `lead_message` |
| 30 | `job_number_acquired` |
| 40 | `lead_updated` |
| 50 | `granot_observation` |
| 60 | `synchronization_decision` |
| 70 | `booking_intake` |
| 80 | `cancellation_intake` |
| 90 | `official_booking` |
| 100 | `official_cancellation` |
| 110 | `sheet_sync` |

Same millisecond: create before SMS before Job-acquired before update
before Observation before Decision before intake before official fact
before Sheet Sync. A Sheet Sync job is requested in the same
transaction as the domain write (or shortly after, with a 3s debounce).
Priority 110 keeps it after the official fact when clocks collide. The
job's own `createdAt` / `updatedAt` usually already sorts it later.

### 9.2 Kind rules

**`lead_created`**

- Prefer EntityChange `command_name` in
  `createFormLead` | `createCallLead` | `createLeadFromGranot`.
  Clock `applied_at`. Coverage `command_backed`.
- Else Lead `timestamp` (fallback `createdAt` /
  `change_history_started_at`). Coverage `official_fact_only`.
- `data` must include `ingestion_origin`, `command_name` (or null),
  `lead_model`. No name / phone / email.

**`lead_message`**

- One event per `lead_messages` row for the resolved Lead.
- Clock: `delivered_at` ?? `sent_at` ?? `accepted_at` ?? `createdAt`.
- `data`: `origin`, `purpose`, `status`, `skip_reason`,
  `observation_id` if present, `consent_basis`. Never `to`, `from`,
  `body`, Twilio SID.
- Coverage `command_backed` when the row exists (the message *is* the
  fact). Skipped / failed rows still emit — headline says the status.
  Discover scoring only counts `accepted` | `sent` | `delivered`.

**`job_number_acquired`**

- Section 7.1. `data.acquired_at_create` boolean.
- Omit this event only when there is no Observation, no link, and no
  Lead Job field — i.e. the Job key itself could not be proven. That
  should not happen on a successful `render`.

**`lead_updated`**

- One event per Lead EntityChange whose `command_name` is
  `synchronizeLeadFromGranot` or `updateSourceOwnedLead`, **excluding**
  the create Change and excluding the Change already used as
  `job_number_acquired` if that Change's *only* new fact was Job
  Number. If that same Change also wrote `granot_priority` / `quoted`
  / move fields, emit **both** `job_number_acquired` and `lead_updated`
  at the same `applied_at` (priorities 30 then 40).
- `data.changed_paths` as stored (already sorted). No field before/after
  values for contact/address paths.

**`granot_observation`**

- One per Observation on the Job.
- Clock `captured_at`. Coverage `evidence_only`.
- `data`: `observation_id`, `receipt_id`, `route_event_class`,
  `normalization_result`, `priority.canonical` if valid,
  `booking_action.normalized` if present, `issue_codes`.
  No contact, no `display_money` customer labels, no raw payload.

**`synchronization_decision`**

- Latest attempt only.
- Clock `decided_at`. Coverage `evidence_only`.
- `data`: `decision_id`, `observation_id`, `attempt`, `execution_mode`,
  `outcome`, `reason_code`, `match_method`, effect kinds (not refs'
  contact), `evaluated_gates` allowed/denied names only.

**`booking_intake` / `cancellation_intake`**

- One `opened` (first evidence), one `refreshed` per later evidence
  Observation, one `resolved` if `resolved_at` exists.
- Clock: evidence `captured_at` or case `resolved_at`.
- `data`: `case_id`, `kind`, `event`, `state`, `mode` (booking) or
  `mode: "release"`, `sequence_number`, `case_revision`,
  `evidence_revision`, `observation_id` on open/refresh.
- Coverage `evidence_only`. Headline must say "intake" / "reconciliation
  case", never "Booking created" / "Cancelled".

**`official_booking` / `official_cancellation`**

- Current official document for the Job, if present.
- Booking clock: `last_changed_at` ?? `timestamp` ?? `createdAt`.
- Cancellation clock: `last_changed_at` ?? `createdAt`.
- Coverage `command_backed` when an EntityChange exists for that
  aggregate; else `official_fact_only`.
- Cancellation is found by `CancelledLead.booked_lead = Booking._id`.
  If a Cancellation exists and the Booking does not, still emit
  `official_cancellation` and set `coverage.official_booking: false`.
  Do not drop orphaned Cancellations.

**`sheet_sync`**

- One event per `sheet_sync_jobs` row whose `entity_id` is the string
  form of the resolved Lead, Booking, or Cancellation `_id`.
- Clock: if `status` is `synced` | `failed` | `cancelled`, use
  `updatedAt` (`clock_field: "sheet_sync_job.updatedAt"`). Otherwise
  use `createdAt` (`clock_field: "sheet_sync_job.createdAt"`). Always
  put `requested_at` = `createdAt` in `data`.
- Coverage `command_backed` when the outbox row exists (the job *is*
  the fact).
- `data`: `job_id`, `resource`, `operation`, `entity_model`,
  `entity_id`, `status`, `attempts`, `created_by`, `requested_at`,
  `target_hints` (tab names only). Never `last_error` (may contain
  row text), never `tombstone` field values beyond the already-known
  aggregate ids, never `spreadsheet_id`, never sheet cell contents.
- `coverage.sheet_sync` on the page: `absent` if no jobs;
  `pending` if every job is `pending` | `retrying` | `processing`;
  `synced` if every job is `synced`; `failed` if any job is `failed`
  and none are live; `mixed` otherwise (includes `cancelled` alongside
  `synced`).
- A Decision `effects[]` entry `kind: "sheet_sync_requested"` must
  **not** emit a `sheet_sync` event by itself. If the matching outbox
  row is missing, that is an honest gap on the Decision row only.
- Embedded aggregate `sheet_sync[]` is not a timeline source.

### 9.3 Headlines (locked verbs)

| Kind | Headline pattern |
| --- | --- |
| `lead_created` | `Lead created ({ingestion_origin})` |
| `lead_message` | `Text {status} ({purpose})` |
| `job_number_acquired` | `Job Number acquired` or `Job Number present at create` |
| `lead_updated` | `Lead updated ({command_name}: {changed_paths joined})` |
| `granot_observation` | `Granot {route_event_class}` + optional ` priority {n}` / ` {booked\|release}` |
| `synchronization_decision` | `Decision {outcome} / {reason_code}` |
| `booking_intake` | `Booking intake {opened\|refreshed\|resolved} ({mode})` |
| `cancellation_intake` | `Cancellation intake {opened\|refreshed\|resolved}` |
| `official_booking` | `Official Booking recorded` |
| `official_cancellation` | `Official Cancellation recorded` |
| `sheet_sync` | `Sheet Sync {status} ({resource} / {operation})` |

No customer name in any headline.

### 9.4 How the timeline looks (this is the product)

Retrieval without this look is a failed handoff. The Owner must be
able to **read the cycle** from the chain: created → text → Job
Number arrived (when it arrived late) → updates → Granot saw it →
we decided → intake → official fact → sheet caught up.

Visual contract, same story in CLI markdown and in Admin:

| Surface | Required |
| --- | --- |
| Search | One text field. Placeholder like `Job number`. Submit searches. No typeahead of every Job, no combobox fed by distincts. |
| Empty / invalid | Honest. Blank or non-normalizable input does not search. |
| `not_found` | "No Job matches that number" — not an empty timeline that looks like a loaded Job with no events. |
| `filtered_out` | Named scopes only (section 8.2). |
| Header | Job Number (kept), proof shape in owner words, source company / granularity labels, coverage chips (`lead`, `text`, `intake`, `booking`, `cancellation`, `sheet`). |
| Chain | Oldest first. Vertical. One row per `JobTimelineEvent`. Kind is visible without reading `data`. Headline is the locked verb from 9.3. Clock is human-readable Florida time in Admin, ISO in the script report. |
| Kind distinct | Create, text, Job-acquired, update, Observation, Decision, Booking intake, Cancellation intake, official Booking, official Cancellation, Sheet Sync must not look interchangeable. Color / icon / rail mark may differ; the **headline text** stays locked. |
| Gaps | Missing text, missing Cancellation intake, `legacy_unknown` origin, unresolved Lead — coverage chips, not invented rows. |
| Not this | The forensic `JobTimeline` look: raw Mongo ids as the primary line, `revision 3 → 4`, `sequence 2`, `Observation` / `Entity Change` as the title. Those stay on `/ingestion/granot/lifecycle/jobs/:jobNo`. |

CLI stdout is a markdown table of `event_at`, `kind`, `headline` in
that order. That table is the look-contract fixture the Admin
timeline must still tell.

## 10. Admin tab and 21st.dev (binding on the UI agent)

This section is for the agent who builds the **actual** timeline
components and the **new dashboard tab**. It is not optional
decoration. The scripts assembler is the data. This section is the
surface.

### 10.1 New feature tab

Treat this as a **new feature**, the same way Intakes shipped:

- Add a new Owner-only tab. Do **not** hide the chain inside the
  existing Lifecycle job page or reuse `GranotJobTimelinePage`.
- Mark it new: `isNew: true` and render `<NewFeatureBadge />` from
  `vantage-admin/components/ui/new-badge.tsx` (gold uppercase
  `New`). Sidebar: `dashboard-nav.tsx`, same `isNew` pattern as the
  Intakes item. If the tab also sits on the Granot strip, add it to
  `granot-navigation.tsx` with `isNew: true` the same way Intakes
  does.
- Suggested label: **Job timeline**. Route is a first-class Owner
  page (for example `/job-timeline`) so a typed Job Number can live
  in the URL (`?job=`). Do **not** add a fifth tab to the unbuilt
  Daily shell (`Today / Leads / Intakes / Completed`) without a
  separate Daily-spec amendment.
- Home overview may link it the way `OverviewIntakesLink` links
  Intakes — new feature card, not a buried Lifecycle deep-link.
- New query-key namespace. New folder
  `vantage-admin/components/job-number-timeline/`. Do not add these
  components under `components/granot-lifecycle/`.

The tab body is: typed Job Number field → submit → render the
section 9 page. Source Granularity remains an optional filter, not
the search key.

### 10.2 21st.dev is required (Pro account)

The workspace has a signed-in **21st.dev Pro** account. The UI agent
**must** use it. Hand-rolling the tab chrome and the timeline visual
from scratch, or restyling `job-timeline.tsx`, is a review failure.

**MCP** (Cursor namespace `user-21st`):

1. `search` / `get_inspiration` — look at vertical timelines, search
   fields, and activity feeds. Metadata only; do not stop here.
2. **Write new** — `generate` in `code` mode for (a) the tab shell +
   typed Job Number search and (b) the owner-facing timeline. This
   is the 21st **Write** path. Share the generation URL. Use
   `variantCount` / `directions` so there is more than one take.
   `sketch` is only for a throwaway direction, not the ship surface.
3. `iterate_generation` — refine the chosen take against section 9.4
   and Vantage tokens (`navy`, `trust-blue`, `gold`, `steel`,
   `pale-gold`).
4. `get_take` / `get_component` — pull the chosen code. Adapt it
   into `vantage-admin` (shadcn primitives already in
   `components/ui/`, TanStack Query, `/api/proxy/...` BFF). Never
   open operational Mongo from Admin.

**CLI:** use the 21st.dev CLI the Pro account already uses to
install or retrieve the chosen registry component into
`vantage-admin`. Do not paste a one-off sandbox file that bypasses
the design system. After CLI install, the agent still owns the
adaptation: locked headlines, no SMS body, no contact on event
rows, Job Number kept, `NewFeatureBadge` on the tab.

If a 21st call returns a paywall or quota error, stop and say so.
Do not silently fall back to inventing the visual.

The generation prompt **must** include: oldest-first vertical
chain; one row per event kind from section 9; locked headlines
from 9.3; typed Job Number search only; coverage chips; Vantage
Admin is an owner dashboard (not a consumer SaaS marketing page);
do not show customer contact on the event row.

### 10.3 What the UI agent must not do

- Do not mount `<JobTimeline page={…} />` as the Owner chain. That
  component renders `GranotTimelineEntry`. This tab renders
  `JobTimelinePage` from this spec.
- Do not load every Job Number for a select.
- Do not invent events, collapse latest-Decision attempts, or
  re-derive coverage in the client. The server/script page is
  authoritative. Until a main-server HTTP route exists, the Admin
  tab may be wired to a later read that **returns this DTO**.
  Wiring a different shape is out of scope for that agent unless
  a follow-on server issue lands first.
- Do not relax masking in `projections.ts` to feed this tab.

## 11. Module layout

```text
scripts/prototypes/job-number-timeline/
  README.md
  specs/job-number-timeline-prototype-specification.md   ← this file
  src/types.ts                 DTO only
  src/normalize.ts             wraps normalizeJobNo / equivalent filter
  src/masking.ts               PII redaction for report rows
  src/assemble.ts              assembleJobNumberTimeline(input) — pure
  src/discover.ts              score + rank — pure over assembled pages
  src/load.ts                  Mongo reads, injected db handle
  src/cli.ts                   argv, confirm gate, write report
  src/assemble.test.ts
  src/discover.test.ts
  src/masking.test.ts
```

**Deep module:** callers (CLI + tests) see `assembleJobNumberTimeline`
and `discoverJobNumberTimelines`. Walk-back, latest-attempt,
equivalent Job matching, typed-search normalize, and coverage flags
stay inside `assemble.ts`.

`load.ts` is the only file that imports Mongoose models. Tests never
import it. CLI is the only file that reads `process.argv` or writes
disk.

`package.json` script:

```text
"prototype:job-number-timeline": "node --env-file=.env ./node_modules/tsx/dist/cli.mjs scripts/prototypes/job-number-timeline/src/cli.ts"
```

Report files:

```text
scripts/output/job-number-timeline/discover-<ISO>.json
scripts/output/job-number-timeline/discover-latest.json
scripts/output/job-number-timeline/render-<normalized_job_no>-<ISO>.json
scripts/output/job-number-timeline/render-latest.json
```

JSON only for the machine report. CLI also prints a short markdown
table to stdout (kinds, clocks, headlines). Both are PII-safe.

## 12. Required tests (synthetic, no Mongo)

Named tests, not buried fixtures:

1. **WordPress walk-back.** Lead created at T0 with no `job_no`; SMS at
   T1; Observation + `synchronizeLeadFromGranot` fills `job_no` at T2;
   Booking case opens at T3. `render` of that Job shows four+ events in
   that order, `proof_shape: wordpress_born`,
   `coverage.job_number_at_create: false`. When a `form_lead.create`
   Sheet Sync job is also in the fixture, it appears on the same page
   (see test 11).
2. **Granot-born.** `createLeadFromGranot` at T0 with Job Number; SMS
   with `observation_id`; later `priority_updated` Decision `applied`.
   `proof_shape: granot_born`, `job_number_acquired.acquired_at_create: true`.
3. **Latest attempt only.** Observation with `pending_match` attempt 1
   and `applied` attempt 2 emits **one** Decision (`applied`).
4. **Granularity filter.** Same Job, Decision scope A, filter B →
   `filtered_out`, zero events.
5. **No contact match.** Observations on the Job, no link / Booking
   lead_ref / Decision target → `coverage.lead: unresolved`, no
   `lead_created`, no `lead_message`.
6. **Priority 5 is not Booked.** `priority_updated` canonical `5` with
   no Booking and no Booked action → no `official_booking`, no
   `booking_intake`.
7. **Case is not a Booking.** `booking_case_opened` Decision + open
   case, no `BookedLead` → `booking_intake` present,
   `official_booking` absent.
8. **Masking.** Fixture Lead name / phone / SMS body / Observation
   contact never appear in `JSON.stringify(page)`.
9. **Equivalent Job Number.** Observation stored as digit-core, query
   with letter prefix (or the reverse) still assembles, using
   `equivalentNormalizedJobFilter`.
10. **Discover score.** WordPress walk-back fixture outranks a
    Granot-only Observation+Decision Job.
11. **Sheet Sync walk-back.** WordPress create at T0 with a
    `source_lead` / `form_lead.create` job whose `entity_id` is the
    Lead id; Job Number arrives at T2. `render` shows `sheet_sync`
    after `lead_created` and **before** `job_number_acquired` when
    `createdAt` is earlier. The job is found without querying
    `sheet_sync_jobs` by Job Number.
12. **Sheet Sync after official Booking.** Booking +
    `booking_chain` / `booked_lead.create` job on the Booking id emits
    `sheet_sync` after `official_booking` when clocks are equal
    (priority 110). A Decision `sheet_sync_requested` with **no**
    outbox row emits no `sheet_sync` event.
13. **Unresolved Lead has no source-lead Sheet Sync.** Observations
    only, no `lead_ref` → no `sheet_sync` even if a fixture job exists
    for some other Lead id.
14. **Typed search `not_found`.** A normalized Job Number with no
    Observation, link, Booking, case, or discrepancy returns
    `not_found` and zero events. A Lead-only `job_no` in the fixture
    does not change that.
15. **Typed equivalent search.** Digit-core stored, letter-prefix
    typed (and the reverse) assembles the same page — same assertion
    as test 9, named as the search contract.

## 13. Live proof (optional, gated)

After synthetic tests pass, a human may run discover against
`vantagemovers` with the confirm flag.

The completion report must include, **masked**:

- How many Jobs scored ≥ 4.
- Whether a `wordpress_born` Job exists (create before Job Number).
- Whether a `granot_born` Job exists with a delivered/sent/accepted
  Lead Message.
- Whether any Job has both Booking intake **and** Cancellation intake.
- Whether any Job has official Booking and official Cancellation.
- Whether the highest-scoring Job has a `sheet_sync` event, and which
  `resource` / `operation` / `status` values appeared.
- One rendered chain for the highest-scoring Job, printed as the
  headline list only (no IDs that are not already in the DTO).

If Cancellation intake never coexists with the WordPress walk-back on
the same Job, that is a named leftover, not a failed prototype. The
prototype still has to *look* for it.

## 14. Explicitly out of scope

- A catalog / dropdown / typeahead of every Job Number.
- Restyling `components/granot-lifecycle/job-timeline.tsx` as the
  Owner chain.
- A fifth tab on the unbuilt Daily shell unless Daily's spec is
  amended separately.
- `GET /api/v1/admin/...` in the **scripts** prototype. The Admin
  tab's HTTP read is a later server issue that must return this
  DTO; inventing a second page shape is out of scope.
- Extending `GranotTimelineEntry` or changing `projections.ts`.
- Writing EntityChange for historical Bookings / Cancellations.
- Writing, retrying, or draining Sheet Sync jobs. This prototype
  **reads** `sheet_sync_jobs` only.
- Email, RingCentral transcript / audio.
- Contact-based Lead search.
- Persisting `lead_lifecycle_events` or any new collection.
- Production index apply, flag changes, commits, or deploys
  (unless the user later asks).

## 15. Acceptance criteria

- [ ] `assembleJobNumberTimeline` is a pure function. Tests inject
      documents; they do not connect Mongo.
- [ ] WordPress walk-back test proves `lead_created` occurs before
      `job_number_acquired` and SMS is attached by Lead ID, not Job
      Number.
- [ ] Granot-born test proves SMS can attach via `observation_id`
      and `lead_ref`.
- [ ] Latest-attempt-only test is named.
- [ ] Granularity filter test is named.
- [ ] No phone, email, name, or SMS body appears in any serialized
      page from the masking test.
- [ ] CLI refuses `vantagemovers` without
      `--confirm-production-db=vantagemovers`.
- [ ] CLI creates no documents (zero-mutation). Source scan of
      `src/load.ts` / `src/cli.ts` contains no `insert`, `update`,
      `delete`, `createIndex`, or `save(`.
- [ ] `grep -n "projectGranotJob\\|GranotTimelineEntry" scripts/prototypes/job-number-timeline` is empty.
- [ ] `pnpm test -- scripts/prototypes/job-number-timeline` and
      `pnpm typecheck` pass.
- [ ] Discover can be filtered by `--source-granularity-id` and by
      `--source-company-id`.
- [ ] A rendered page includes `ingestion_origin` on `lead_created`
      when a Lead was resolved.
- [ ] Sheet Sync walk-back test proves a `form_lead.create` job is
      attached by Lead ID before Job Number exists.
- [ ] A Decision `sheet_sync_requested` effect without an outbox row
      does not invent a `sheet_sync` event.
- [ ] Serialized pages never contain `spreadsheet_id`, `last_error`,
      or SMS `body`.
- [ ] Typed `not_found` test is named. A Lead-only `job_no` does not
      assemble a page.
- [ ] Typed equivalent search (prefix ↔ digit-core) assembles the
      same page.
- [ ] There is no `list` CLI mode and no `src/list.ts`.
- [ ] Follow-on Admin tab (when built): `isNew` + `NewFeatureBadge`;
      components live under `components/job-number-timeline/`; 21st.dev
      Write (`generate`) + CLI were used; `<JobTimeline>` is not the
      Owner renderer.

## 16. Rollback

**Scripts:** delete the prototype folder and the `package.json`
script. No schema, flag, or production document is touched.
Gitignored reports stay local.

**Admin tab (if already added):** remove the nav / Granot-strip
entries, the `/job-timeline` page, and
`vantage-admin/components/job-number-timeline/`. Leave
`JobTimeline` and `projections.ts` untouched.

## 17. Completion handoff

**Assembler:** files added; test names and results; whether a live
`render` / discover was run (database name only); that typed
equivalent search worked; the two proof shapes found or the named
gap; the highest-scoring Job's **headline list** (this is the look
fixture); confirmation that no write occurred and `projections.ts`
was not modified.

**Admin tab (follow-on):** 21st.dev generation URL(s); which take
shipped; confirmation `isNew` + `NewFeatureBadge` are on the tab;
confirmation `<JobTimeline>` is not mounted; confirmation there is
no Job Number catalog.

**Unblocks:** a later server read that returns this `JobTimelinePage`
to the new Admin tab. That HTTP route is a separate specification.
