---
type: Progress Review
title: Granot Lead Lifecycle sprint progress through Unit 25
description: Capability-by-capability review of Units 01–25, each closed with a system-fulfillment path the program can now execute when flags and activation are later authorized.
tags:
  - granot
  - lead-lifecycle
  - webhooks
  - booking-reconciliation
status: draft
stale_after: 2026-09-19
generated:
  by: cursor-grok-4.6
  at: 2026-08-19T14:54:00Z
sources:
  - id: unit-status
    resource: ../../scripts/prototypes/granot-lead-lifecycle/delivery/UNIT-STATUS.md
  - id: final-spec
    resource: ../../scripts/prototypes/granot-lead-lifecycle/specs/FINAL-SPECIFICATION-GRANOT-LEAD-LIFECYCLE.md
  - id: lifecycle-services
    resource: ../../src/services/granotLifecycle
  - id: webhook-adapter
    resource: ../../src/services/granotWebhooks
verified:
  - by: agent:progress-review
    at: 2026-08-19T14:54:00Z
owners: [team:main-server]
applies_to:
  - src/services/granotLifecycle/**
  - src/services/granotWebhooks/**
  - scripts/prototypes/granot-lead-lifecycle/delivery/**
---

# Granot Lead Lifecycle — progress through Unit 25

This is a fulfillment review, not a unit checklist. Units `01`–`25` are **code-complete** on the `granot-lead-lifecycle` branches (server and Admin; extension `0.2.8` for Unit 16). That is not the same as production live. Checked-in defaults still process in **shadow**: capture and Decisions run, Lead writes, Lead creation, Booking cases, Booking commands, Release, Referral, and email stay **false**.

Read each section as: what the program now owns in code, then one concrete path the system is built to fulfill when the matching gates are later authorized.

Authoritative navigation: [`delivery/UNIT-STATUS.md`](../../scripts/prototypes/granot-lead-lifecycle/delivery/UNIT-STATUS.md). Service invariants: [`.cursor/businesslogic/granotLifecycle.*.md`](../../.cursor/businesslogic/). Older capture-only notes in [`docs/to_review/`](../to_review/granot-webhooks.md) describe the pre-processor world and are superseded for behavior after Unit 15.

```text
authenticated webhook | approved extension apply | approved automation action
        |
        v
Granot Observation Receipt  (Units 02–03, 16–17)
        |
        v
Observation → Registry policy → identity → temporal plan → Decision
        |                         (Units 04–08, 14–15)
        +--> matched Lead sync / authorized Lead create   (Units 18–19)
        +--> RingCentral adoption of Granot-created Calls (Units 20–21)
        +--> Booking case → Owner confirm / update / No Action (Units 22–25)
```

---

## 1. Contract freeze and shared vocabulary — Unit 01

The sprint locked the names the rest of the program is not allowed to reinvent. `FormLead.ref_no` is the value posted to Granot as `leadno`; Mongo `_id` is compatibility identity only. Observation channels are `granot_webhook`, `browser_extension`, and `granot_http_automation`. Route event classes are `lead_created`, `priority_updated`, and `booking_status_changed`. Booking Actions are `booked` and `release` — repeatable Granot evidence, not Vantage state transitions. Synthetic fixtures are credential-redacted. No runtime persistence landed here; later units consume this vocabulary instead of inventing Intake or lifecycle-enum names.

**System fulfillment.** When a later unit writes a Decision, command, or Admin projection, it can only speak these locked words: a webhook is never a Booking authority, a Priority is never a stored Lead status enum, and a Form Lead is found first by the same `ref_no` Granot already received as `leadno`.

---

## 2. Receive — Units 02–03

Granot’s three server-to-server routes now commit a credential-redacted **Granot Observation Receipt** before they answer the sender.

| Route | Route event class |
| --- | --- |
| `POST /api/webhooks/granot/lead-created` | `lead_created` |
| `POST /api/webhooks/granot/priority-updated` | `priority_updated` |
| `POST /api/webhooks/granot/booking-status-changed` | `booking_status_changed` |

Authentication accepts `x-api-secret` from header and/or body against `GRANOT_WEBHOOK_SECRET` (not `VANTAGE_API_SECRET`). The secret is stripped before hashing, storage, logs, and errors. Stored headers are an allowlist. Identical deliveries are **distinct receipts**; `payload_sha256` is diagnostic, never idempotency. A `202` body is `{ ok, accepted, event_type, receipt_id }` and cannot precede Mongo commit. Capture failure is `503` so Granot can retry. After commit, a best-effort queue wake-up publishes **only** `{ receipt_id }`.

`src/services/granotWebhooks/` is a thin compatibility adapter. Capture, hashing, and insert live in `granotLifecycle/capture.ts`. Capture still does not mutate a Lead, Booking, or Cancellation.

**System fulfillment.** A Granot webhook endpoint, when it receives any of the three route classes, authenticates the dedicated secret, writes one immutable receipt with the route-derived event class, returns `202` with that `receipt_id`, and wakes the lifecycle consumer — even when processing or every effect flag is later turned off.

---

## 3. Normalize — Unit 04

One receipt becomes one **Granot Observation**. The processor upserts it; capture does not. Webhook kind comes from the route, not from payload `event_type`. `priority_updated` accepts absent, `priority_update`, or `priority_updated`. `Booked` becomes `booked`; exact `Releas` or `Release` becomes `release`; `Released` is unsupported and is never inferred by prefix. Every valid Priority is retained (`05` → `5`); this module applies no Lead effect. Malformed Priority on a Priority Update is `invalid`; the same defect on Lead Created or Booked skips Priority and continues the independent action. Source labels use the shared NFKC / trim / collapse / lowercase helper. Invalid and unsupported results persist as completed classifications.

**System fulfillment.** A `priority_updated` delivery whose payload says `priority_update` and whose Priority is `05` becomes a valid Observation with canonical Priority `5` and route class `priority_updated`, ready for Registry and matching — without anyone treating the raw string `05` or the payload event name as a second source of truth.

---

## 4. Registry — Granot CRM source to Vantage Source Company — Units 05–06

`GranotCrmSource` is the only semantic registry for a Granot source label. Exact normalized-label lookup maps that label to a Vantage **Source Company**, one or more **Source Granularity** routes, a disposition (`source_scoped_lead`, `referral_booking`, `deferred`), and a lead-created policy (`link_only`, `create_if_missing`, `observation_only`). Zero matches, multiple matches, inactive company, inactive granularity, or ambiguous Form routes fail closed. Best Relocation inbounds start as Call / `best_relocation_leads`; Forms route Local vs long-distance from origin/destination states; Referral is leadless; Paid Overflow and source Auto stay deferred. Payload `type=AUTO` is provider context only.

Admin Registry UI and automation compatibility links landed in Unit 06. Runtime policy reads stay in `sourcePolicy.ts`; writes stay in Operations Registry commands.

**System fulfillment.** A Granot job whose CRM source label normalizes to a reviewed Best Relocation inbound row is classified as a Call Lead in Source Company `best_relocation_leads` and granularity `best_relocation_leads_call`, with `link_only` until an Owner later authorizes creation — so later matching never guesses a company from phone or from payload `type`.

---

## 5. Decide, claim, and drain — Units 07–08

Unit 07 added the operational skeleton: **Synchronization Decision**, activation, safe **Granot Record Link** evidence, and execution modes `historical_shadow`, `live_shadow`, and `live`. Unit 08 made work durable: atomic claim, five-minute lease, queue consumer, five-minute cron safety net, technical retries, dead letter, and Owner requeue of dead letters only.

Queue and cron are wake-ups. Mongo `processing.*` is the work source. `pending_match` follows a fixed clock from first capture: immediate → 1m → 5m → 15m → 1h → 2h → 6h → 12h → 24h, then `unmatched`. Incomplete creation data is not retried as pending match. Pre-activation receipts stay historical shadow forever; live-shadow Decisions are never promoted into effects.

**System fulfillment.** After a receipt is stored, the queue consumer or cron claims that `receipt_id` under a lease, runs the processor once, and if the only problem is “no Lead yet” on a `link_only` source, it reschedules the same receipt on the 24-hour match clock — without creating a Lead and without losing the original evidence if a later delivery finally matches.

---

## 6. Persist foundation — Units 09–13

These units built the write machinery later Lead and Booking commands actually use.

- **Unit 09.** Aggregate `domain_revision`, compare-and-swap, revision-only backfill for Lead / Booking / Cancellation.
- **Unit 10.** Transaction-owning canonical command executor, four-origin validation, stored `applied` replay.
- **Unit 11.** Append-only `EntityChange`, queued Sheet Sync outbox atomicity, existing write adapters canonicalized.
- **Units 12–13.** Lead provenance: Ingestion Origin, immutable ingested snapshots, Form Job parity, Call `quoted` default false, trusted vs public validators, seven non-unique Lead indexes, fail-closed origin / Job / `legacy_baseline` backfill.

Invariant: every post-activation mutation records Decision → Command → EntityChange → revision transition → outbox intent in one Mongo transaction. No-op comparisons create neither Change nor Sheet work.

**System fulfillment.** When an authorized Granot command later updates a matched Form Lead, Mongo commits the Lead revision, the append-only Change, the command execution, and the Sheet Sync outbox row together — so a crash after the Lead write cannot leave Sheets or history believing a different story than the System of Record.

---

## 7. Match and plan — Units 14–15

Unit 14 is the read-only identity half. Registry policy must succeed as `source_scoped_lead` **before** any Lead query. Contact fallback is Source Company **and** Source Granularity only. Never global.

**Form ladder**

1. Active Granot Record Link by normalized Job Number.
2. Exact eligible non-duplicate `FormLead.ref_no`.
3. If that value is ObjectId-shaped, exact eligible `FormLead._id`.
4. Exact Source-scoped phone/email across current, ingested, and Granot contact snapshots.
5. Otherwise `pending_match`, `ambiguous`, `conflict`, or `unmatched`.

Exact identity that disagrees with known Source Scope is a hard **conflict**. Duplicate Form Leads are ineligible. A Bad Form Lead may be linked for Priority only; it cannot be contact-matched, enriched, or booked.

**Call ladder:** Record Link → exact `normalized_job_no` in the resolved granularity → granularity + normalized phone (current and original caller) → otherwise pending/ambiguous/conflict/unmatched.

Unit 15 is the channel-neutral processor: load receipt → Observation → execution mode → terminal normalization → Registry → identity → temporal compare (latest Vantage `captured_at`, then Observation id) → desired-state plan → gates → one Decision. Older evidence is `stale`. Only Priority `1` and `5` plan broad enrichment and `quoted = true`. Granot never plans `quoted = false`. WordPress submitted contact and move snapshots stay immutable; qualified Granot contact lives on `granot_contact_snapshot`.

Checked-in processor posture remains shadow. Historical shadow may write job-level Record Link evidence only.

**System fulfillment.** A Granot webhook endpoint, when it receives a `priority_updated` payload, authenticates and stores a receipt; the processor then normalizes the Observation, looks up the exact Granot CRM source label in the Registry, and matches a Lead only when that Registry row’s Source Company and Source Granularity agree with the Lead’s `lead_source_company` and `source_granularity_id` — first by Record Link or `ref_no`, then by source-scoped phone/email, never by a global contact search. On a unique eligible match it persists a Decision that plans `granot_priority` for every valid Priority and, when the Priority is `1` or `5`, plans enrichment and `quoted = true`. If the evidence is older than an already-accepted Observation, the Decision is `stale` and the Lead is left alone.

---

## 8. Cross-channel apply — Units 16–17

The same processor now sits behind the other two Observation Channels.

- **Unit 16 / extension 0.2.8.** Owner apply on Follow Up and Booked Jobs captures a `browser_extension` receipt with a stable operation ID, then `claimAndProcessOrPoll`. Same ID + same hash replays; different hash is `409`. `lead_snapshot_apply` cannot create-if-missing and cannot carry Booked/Release. `changed_paths` stay empty while shadow is on.
- **Unit 17.** Owner-approved HTTP automation apply captures `granot_http_automation` receipts with operation ID `${run_id}:${action_id}` and the same resumable `accepted_for_processing` outcome.

Equivalent webhook, extension, and automation evidence must produce the same desired-state plan (AC-33). Schema-v1 automation plans fail closed.

**System fulfillment.** An Owner who clicks Sync on a Granot Follow Up tab sends a `lead_snapshot_apply` item; the server stores a receipt, runs the same Registry → identity → desired-state path a `priority_updated` webhook would run for that job, and returns a PII-safe compatibility result — so extension, automation, and webhook cannot invent three different matches for one Granot row.

---

## 9. Lead sync and authorized create — Units 18–19

**Unit 18** lands `synchronizeLeadFromGranot` for a matched eligible Lead. Live + Lead-writes + all eight gates required. It fills a missing Job Number and establishes or confirms the Record Link; a Job conflict never overwrites. Source Company, Source Granularity, Ingestion Origin, and CPL never move. WordPress primary contact stays; qualified Granot contact is stored separately. A no-op accepted Observation writes neither Change nor Sheet work. Official Booking money never enters the Lead command.

**Unit 19** lands `createLeadFromGranot` for a post-activation `lead_created` Observation with policy `create_if_missing`, no eligible match, and complete minimum data. One transaction creates exactly one Form or Call Lead (`ingestion_origin: granot_lead_created`, `post_to_granot: false`), reserves the active Record Link, writes Decision + Command + Changes + outbox. Form minimum: Job, deterministic Local/long-distance route, name, phone, valid origin/destination state and ZIP. Call may be Job-only. Incomplete data is terminal `insufficient_creation_data`, not pending match. A pre-existing lead-less link is `record_link_conflict`; the command never attaches to someone else’s reservation.

Creation is enabled one reviewed Registry source at a time. Checked-in Lead writes and creation remain false. Tests inject live + writes only.

**System fulfillment.** A `lead_created` webhook for a reviewed `create_if_missing` source, when no Form Lead shares that `ref_no`, Record Link, or source-scoped contact, creates exactly one Vantage Lead, pins the Granot Job Number on a new Record Link, and queues Sheet Sync — and a second identical authorized create for the same Observation replays that result instead of minting a twin. If a WordPress Form Lead already exists for that `ref_no` and company, the same webhook never creates; it synchronizes missing Job / Priority / Granot contact onto the existing Lead.

---

## 10. RingCentral adoption and Call Log lease — Units 20–21

Granot can now create a Call Lead before RingCentral finishes ingesting the physical call. Unit 20 puts adoption **before** business duplicate classification:

```text
telephony idempotency
  → Granot-created Lead adoption
  → business duplicate classification
  → create only if adoption did not succeed
```

Adoption requires all of: exact Source Granularity, same normalized caller phone, `ingestion_origin = granot_lead_created`, no RingCentral session already attached, Lead creation within ±12 hours of call start, exactly one candidate. Success attaches verified RingCentral metadata and keeps Granot as Ingestion Origin. The adopted physical call is not a false duplicate. Zero or many candidates, or a Job-number-only Lead, do not guess; conflict is durable and the qualified call still proceeds. Flag: `RINGCENTRAL_GRANOT_ADOPTION_ENABLED` defaults false.

Unit 21 closes S14: five-minute renewable Call Log state lease on `key: "account"`, cursor movement only after complete success, locked 12-hour rolling lookback, `*/30 * * * *` cadence in `vercel.json`, and fail-closed runtime if the singleton unique index is absent. That index was applied only on the disposable test database. Call Log sync remains disabled in checked-in flags.

**System fulfillment.** A Granot `lead_created` that mints a Call Lead at 10:04, followed by the RingCentral qualified-call ingest for the same Source Granularity and caller at 10:11, adopts that Lead instead of creating a second Call Lead — so the Owner sees one call, Granot origin preserved, RingCentral session attached, and the later duplicate check ignores the physical call it just adopted.

---

## 11. Booking cases, read-only Owner workflow — Units 22–23

Granot never creates or updates a Booking. Priority `5` or an actual `booked` action opens **Granot Booking Reconciliation** work.

| Evidence | Result |
| --- | --- |
| Priority `5`, eligible Lead, no Booking | open/refresh `create_missing_booking` |
| Priority `5`, Booking already exists | no review case |
| actual Booked, no Booking | `create_missing_booking` (ambiguous Lead → no suggestion) |
| actual Booked, one active Booking | `review_existing_booking` |
| Booking without Lead | delegate to existing employee `BookingLeadReconciliationCase` |
| official Cancellation | typed discrepancy routing only (Unit 29) |

Repeated same-kind evidence on an open case refreshes evidence (`evidence_revision`) and does not stale the Owner form (`case_revision`). A resolved case is immutable; later evidence opens the next sequence. Suggestions come from Unit 14 identity: Record Link / exact ref / exact Call Job are high confidence; source-scoped contact is medium; ambiguity has none. Duplicate and Bad Form Leads are excluded.

Unit 23 shipped masked cursor-based Admin queue, case detail, candidate browser, and Job/Lead timelines. Owner review of the Preview read-only workflow was **accepted on 2026-08-19**. An authorized Atlas `testvantagemovers` apply created 42 previously missing predecessor indexes after a zero-collision report. No production apply. Booking-case flag remains false.

**System fulfillment.** A `booking_status_changed` webhook whose action is `Booked`, after Registry and identity resolve a Best Relocation job with no Vantage Booking, opens a `create_missing_booking` case with a suggested Lead when the Record Link or `ref_no` is unique; the Owner can open Admin, read the masked queue and the Job timeline, and browse in-scope candidates — and still cannot make Mongo grow a Booking until a later command flag is enabled.

---

## 12. Owner Booking commands — Units 24–25

Unit 24 completed S16’s confirm-missing half. Unit 25 completed the remaining standard paths and **closes S16**.

| Case mode | Owner command | Command name |
| --- | --- | --- |
| `create_missing_booking` | Confirm Granot Booking | `confirmGranotBooking` |
| `review_existing_booking` | Update Existing Booking | `updateBooking` |
| either standard mode | No Action | `resolveGranotBookingCaseNoAction` |

Routes (Owner-only, `Idempotency-Key` required):

```text
POST /api/v1/admin/granot-lifecycle/booking-cases/:id/confirm-booking
POST /api/v1/admin/granot-lifecycle/booking-cases/:id/update-booking
POST /api/v1/admin/granot-lifecycle/booking-cases/:id/no-action
```

Official details are Owner-typed: calendar `book_date`, 1–20 unique active Agents, integer-cents Binder allocations that equal `total_binder_amount`, nonnegative Deposit, active Merchant. Granot estimate, payment, balance, move date, contact, and suggested Agent **never prefill** those fields. Confirm-missing create-official starts blank. Review-existing initializes from the live Booking.

Confirm creates exactly one Booking, resolves the case, and sets Record Link `booking_ref` (and `lead_ref` when the Owner’s selection is permitted). Out-of-scope Lead selection requires a reason and may correct the link, never the Lead’s Source Company.

Update is a full replacement of Book Date, allocations, Binder, Deposit, and Merchant on the **one** Booking for that Job. It never creates a second Booking and never changes Lead, Job, or source identity. Same already-live official state resolves `already_satisfied` with no Change or outbox.

No Action records a Command and resolves the case with zero aggregate, Change, or Sheet effects. Optional reason code/text are metadata only.

One concurrent winner per case revision; replay returns stored `200` with `replayed: true`; loser `409` preserves the Admin draft. Checked-in `GRANOT_LIFECYCLE_BOOKING_COMMANDS_ENABLED` remains false. Referral and Release are not exposed.

**System fulfillment.** After a `Booked` webhook has opened `review_existing_booking` for Job `12345` that already has one Vantage Booking, an Owner submits Update with an `Idempotency-Key`, the expected case and Booking revisions, a book date, exact-cent allocations, and an active Merchant; the command replaces only those official fields, mirrors deposit thresholds onto the already-linked Lead, appends Booking/Lead Changes, queues one Booking-chain Sheet intent, and resolves the case — or, if the Owner instead submits No Action, the case closes with a Command row and the Booking is left untouched. A retry of the same key returns the stored result; a stale revision returns `409` without a second Booking.

---

## Current posture

| Gate | Checked-in default | Meaning through Unit 25 |
| --- | --- | --- |
| Processing | `true` | Receipts can be claimed and decided |
| Shadow | `true` | Decisions persist; live Lead/Booking effects stay suppressed |
| Lead writes | `false` | `synchronizeLeadFromGranot` is test-injected only |
| Lead creation | `false` | `createLeadFromGranot` is test-injected only |
| Booking cases | `false` | Open/refresh is test-injected only |
| Booking commands | `false` | Confirm / update / No Action are test-injected only |
| Release / Referral / email | `false` | Later units |

Unit 23 Preview review used TEST_MODE server `dpl_5iySwhe9FSS7c5MWZtC2QwRGNK5C` and Admin Preview `dpl_E1pv6Mp5SqwPp4nQoKELtWSQ7etQ`. Unit 25 completion reports both repos still on `granot-lead-lifecycle` with Unit 25 changes uncommitted at report time. No production merge, production index apply, live payload read, or effect-flag enablement is authorized by this review.

---

## What Unit 25 does not finish

| Unit | Capability | Why it is still blocked |
| --- | --- | --- |
| 26 | Release Reconciliation, read-only | Independent S17 persistence/UI |
| 27 | Release owner cancel / update / No Action | Needs Unit 26 plus Owner review |
| 28 | Referral leadless Booking | Needs Units 24–25 **and** a reviewed Referral Registry classification |
| 29 | Discrepancies and Record Link correction | Needs Booking and Release command paths |
| 30–31 | Ops health, historical-shadow certification, security audit | Needs 01–30 |
| 32 | Optional new-case email | Separate inclusion approval |
| 33–34 | Prototype retirement and current-payload certification | Needs the program, not just S16 |

Granot still never automatically creates, updates, cancels, or un-cancels a Booking. Release actions may someday sit open beside a Booking case; they do not auto-close each other.

---

## Where to go next in the repo

| Need | Start here |
| --- | --- |
| Unit ledger | [`delivery/UNIT-STATUS.md`](../../scripts/prototypes/granot-lead-lifecycle/delivery/UNIT-STATUS.md) |
| Completion evidence | [`delivery/completion-reports/`](../../scripts/prototypes/granot-lead-lifecycle/delivery/completion-reports/) |
| Processor orchestration | [`.cursor/businesslogic/granotLifecycle.processor.md`](../../.cursor/businesslogic/granotLifecycle.processor.md) |
| Identity ladders | [`.cursor/businesslogic/granotLifecycle.identity.md`](../../.cursor/businesslogic/granotLifecycle.identity.md) |
| Booking cases and Owner commands | [`.cursor/businesslogic/granotLifecycle.bookingReconciliation.md`](../../.cursor/businesslogic/granotLifecycle.bookingReconciliation.md) |
| Webhook capture | [`.cursor/businesslogic/granotLifecycle.capture.md`](../../.cursor/businesslogic/granotLifecycle.capture.md) |
| Locked specification | [`specs/FINAL-SPECIFICATION-GRANOT-LEAD-LIFECYCLE.md`](../../scripts/prototypes/granot-lead-lifecycle/specs/FINAL-SPECIFICATION-GRANOT-LEAD-LIFECYCLE.md) |
