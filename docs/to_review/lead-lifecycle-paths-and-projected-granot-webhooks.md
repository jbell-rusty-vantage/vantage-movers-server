# Lead lifecycle paths: creation → booking → cancellation

> **Stale vs current.** This brief still treats webhooks as capture-only / no processor. Current fulfillment through Unit 25: [`docs/granot-lead-lifecycle/sprint-progress-through-unit-25.md`](../granot-lead-lifecycle/sprint-progress-through-unit-25.md). Current capture: [`.cursor/businesslogic/granotLifecycle.capture.md`](../../.cursor/businesslogic/granotLifecycle.capture.md). Current processor: [`.cursor/businesslogic/granotLifecycle.processor.md`](../../.cursor/businesslogic/granotLifecycle.processor.md). The path catalog below is not rewritten.

Status: architectural exploration brief for another agent. This document catalogs every operational path a Form Lead or Call Lead can take from first contact through Booking and Cancellation, and **projects** Granot webhook deliveries into those paths.

Companion documents:

- Capture-only webhook transport: [`granot-webhooks.md`](./granot-webhooks.md)
- Proposed processor / matching / provenance model: [`granot-webhook-domain-service-model.md`](./granot-webhook-domain-service-model.md)
- HTTP automation contract: [`granot-http-automation.md`](./granot-http-automation.md)
- Form identity alignment: [`form-lead-granot-matching-alignment.md`](./form-lead-granot-matching-alignment.md)

This document is **not** a decision to enable webhook-driven mutations. Webhook routes already capture receipts. Domain reaction to those receipts is unresolved and is marked as such at every insertion point.

---

## How to read this document

Three layers appear at every stage:

| Layer | Meaning |
| --- | --- |
| **Current** | What Vantage actually does today |
| **Projected Granot webhook** | A Granot delivery that already exists as a captured receipt, but has no domain processor |
| **Open decision** | What the exploring agent must recommend |

MongoDB is the system of record. Reporting Sheets are an eventually-consistent projection. Granot CRM is a conduit: employees work jobs there; Vantage learns about those jobs through Observation Channels.

A lead does not have a single `status` enum. Lifecycle is derived from fields:

| Derived state | Form Lead / Call Lead fields |
| --- | --- |
| Ingested | document exists; `duplicate` false; no `booked`; no `cancelled` |
| Duplicate | `duplicate: true` (still saved; not CRM-posted; not an enrichment target) |
| Quoted | Form Lead `quoted: true` (Call Leads have no `quoted` field) |
| Enriched | Call Lead has `job_no` and/or customer/location/cubic/move-type filled from Granot |
| Booked | `booked` → Booking `_id` |
| Cancelled | `cancelled` → Cancellation `_id`; **`booked` is retained** |
| Bad | Form Lead only: `bad_lead` reason set; blocked if already duplicate, booked, or cancelled |

---

## Systems and Observation Channels

```text
Source of contact          Vantage write path              How Vantage later learns Granot state
-----------------------    ----------------------------    ------------------------------------
WordPress quote form       Form Lead Ingestion             WordPress Granot post (outbound)
Next.js landing / site     Form Lead Ingestion             Server CRM Posting when enabled
RingCentral inbound call   Call Lead Ingestion             Employee types the job into Granot
Employee booking form      Booking (+ optional stub lead)  Job number / phone typed by employee
Owner Admin Dashboard      Booking / Cancellation          Owner copies Granot sale into Vantage
```

Observation Channels that read Granot back into Vantage:

| Channel | Actor | Gate | Mutates Mongo today? |
| --- | --- | --- | --- |
| Browser extension (Owner) | Owner on a Granot tab | Preview → Sync, or auto-sync if enabled | Yes — Form Lead PATCH / Call Lead enrichment / booked-call reconciliation |
| Granot HTTP automation | Owner in Admin → Ingestion | Plan → approve selected actions → apply | Yes — same mutation rules, durable receipts, drift checks |
| Granot CRM CSV sync | Owner / batch | Preview or apply | Yes — same enrichment / booked-reconciliation services |
| **Granot webhook** (`lead_created`, `priority_updated`, `booking_status_changed`) | Granot server-to-server | Authenticate → durable receipt → `202` | **No. Capture only.** |

These channels observe the same Granot job. They are not separate authorities. If a webhook processor is added, it must reuse the same match ladder and the same fill-only / priority rules as the extension and HTTP automation, or the three channels will fight.

---

## Shared mutation rules already in production

These rules are the current meaning of “Granot found this lead and Vantage updated it.” Any webhook processor is being compared against this baseline.

### Form Lead (extension + HTTP automation)

Match ladder (`granotFormLeadMatcher`):

1. Exact `FormLead.ref_no ===` Granot `ref_no` (exclude `duplicate: true`; multiple hits = conflict)
2. If that misses and Granot `ref_no` is ObjectId-shaped → match Form Lead `_id` (historical compatibility)
3. Fallback: phone / email / name search, hard-gated to the Granot source label’s `source_company`
4. Never match `lid` / `normalized_lid`

Field rules after a unique match:

| Granot signal | Vantage write |
| --- | --- |
| Priority `1` or `5` | `quoted = true`; `cubic_feet` from parseable `est_cf` |
| Priority `0` | Do **not** push `quoted=false` or placeholder cubic feet |
| Priority `2`, `3`, `7`, `8`, `9` | Extension parser treats as unsupported; HTTP automation does not apply quote/cubic from them |
| Origin / destination city, state, ZIP | Fill **only missing** compatible fields |
| `user` / `rep` | Set `receiver_agent` only when empty and CRM username uniquely maps to an Agent |
| `source` / `source_company` | Never overwritten |
| `booked` / `cancelled` | Never cleared by enrichment |

Enrichment **can run after booking**. The booking link is preserved. Priorities `1` and `5` matter most because those are the only values that authorize quote / cubic writes.

### Call Lead (extension + HTTP automation)

Match ladder (`findBestCallLeadMatch`):

1. Source-compatible phone match (prefer unbooked / uncancelled; newest timestamp)
2. Else exact `job_no`
3. Assigned-source mismatch → conflict, no write
4. Granot `ref_no` is **never** interpreted on the call path

Writes when fields differ: `job_no` (unless the lead already has a different one), name, email, locations, `local`, `cubic_feet`, source assignment when unassigned/compatible, receiver agent if empty.

Booked Jobs rows additionally run **booked-call reconciliation**: match Booking by `job_no`, then refresh the linked Call Lead and selected Booking fields (`source`, `local`, `book_date`).

Call Lead Enrichment also **can run after booking**.

### What neither channel does today

- Create a Form Lead or Call Lead from a Granot row
- Create a Booking (binder, deposit, merchant, agent allocations are not on a Granot list row)
- Cancel a Booking
- Write Reporting Sheets directly (they go through lead / booking / cancellation services, which enqueue Sheet Sync)

---

## Projected Granot webhook contract

Granot already delivers three event classes. Treat them as **current-state snapshots**, not deltas.

| Route | Event class | What the payload is |
| --- | --- | --- |
| `POST /api/webhooks/granot/lead-created` | `lead_created` | Granot created a job row. Snapshot includes `job_no`, `ref_no`, contact, origin/destination, `est_cf`, `service_type`, `source`. |
| `POST /api/webhooks/granot/priority-updated` | `priority_updated` | **Current state of the lead**, not “priority changed from X to Y.” Adds `priority`, `estimate`, `user`, `rep`, sometimes `payment` / `balance`. |
| `POST /api/webhooks/granot/booking-status-changed` | `booking_status_changed` | Booking-status snapshot. Observed payload `event_type` values include `Booked`, `booked`, `Releas`. Also carries priority / estimate / payment / balance / user / rep. |

Current Vantage reaction for all three:

1. Authenticate with `GRANOT_WEBHOOK_SECRET`
2. Store an immutable `granot_webhook_receipts` document (`processing_status: "received"`)
3. Return `202` with `receipt_id`
4. **Stop.** No match, no lead write, no booking, no Sheet Sync

Live-data caveats the exploring agent must not ignore:

- No provider event ID, occurred-at, or record revision
- Route event class can disagree with payload `event_type`
- Key casing has already drifted (`Source` vs `source`)
- Priorities observed: `0`, `1`, `2`, `3`, `5`, `7`, `8`, `9`
- `user` / `rep` are receiver/sales-rep identity, not proof of who changed the row
- Receipt time is Vantage transport time, not Granot event order

---

## Form Lead path

Partner traffic today is WordPress. Next.js landings exist but are unused by partners. Main site (`vantagehomemovers.com`) uses the same Form Lead Ingestion route and can ask the server to CRM-post. The skeleton below is the live partner path.

### Stage F0 — Visitor submits the WordPress quote form

**Interaction:** WordPress form POST.

**Parallel fan-out (this is the important race):**

```text
Visitor submit
    ├─► POST /api/v1/form-leads          (Vantage Form Lead Ingestion)
    └─► Granot CRM post from WordPress   (Hello Moving / Eagle gateway)
```

WordPress owns Granot posting for most partner sources. Those Mongo documents are saved with `post_to_granot: false`. The server CRM path (`submitFormLeadToCrm`) runs only when the caller sets `post_to_granot: true` (main site / explicit server post).

Granot wire fields WordPress should send:

| Granot POST field | Value | Later matching role |
| --- | --- | --- |
| `leadno` | Provider Tracking Reference (`DT_…`, `tz…`, `Mob_…`) | Becomes Granot list `ref_no`; primary Form Lead match key |
| `notes` | Optional internal `lid` | Operator context only; **never a match key** |
| `label` | CRM source label (`Top10 Forms`, `TBM Forms Prime`, …) | Maps to Source Company for fallback gating |

TBM Forms Prime rows often have **empty** Granot `ref_no` even when Mongo has a `tz…` Tracking Reference. Exact identity is then unavailable; fallback is required.

### Stage F1 — Form Lead Ingestion (`POST /api/v1/form-leads`)

**Current:**

1. Validate (pickup/destination zip, move size, phone, name)
2. Normalize name / phone; Florida timestamp
3. Zip → state lookup; derive Move Type (`local` vs long distance)
4. Resolve Source Company + Source Granularity + CPL snapshot
5. Duplicate check: same `source_granularity_id` + phone **or** email against an earlier non-duplicate Form Lead (cohort window around 2026-04-30)
6. Persist Form Lead in a Mongo transaction with Sheet Sync intent
7. If non-duplicate: mark matching Call Leads `form_fill: true`
8. If `sms_consent`: persist Lead Message intent (Twilio confirmation; messaging may be disabled)
9. After commit: drain Sheet Sync, then server CRM post if enabled

**Possible Form Lead states after this stage:**

| State | Fields | Sheets | Granot |
| --- | --- | --- | --- |
| Eligible new lead | `duplicate: false`, `quoted: false`, no `booked` | `Forms` tab queued | WordPress post in flight or already done |
| Duplicate | `duplicate: true`, `post_to_granot` forced false | `Duplicates` tab | **Not posted** — no `lead_created` expected from this submit |
| Location incomplete | states may be `not_found` | Still syncs | Granot may later fill city/state |

**Does not exist yet on a new Form Lead:** `quoted`, `cubic_feet`, `receiver_agent`, `booked`, `cancelled`, Granot `job_no` (job number lives on Booking / Call Lead, not on the Form Lead model).

### Stage F2 — Projected: `lead_created` webhook

**When it fires:** Granot accepted the WordPress (or server) post and created a job row.

**Typical arrival window:** milliseconds to minutes after F0. Because WordPress posts to Granot **in parallel** with Vantage, this webhook can arrive:

| Race | Vantage state when receipt is stored |
| --- | --- |
| Ingest won | Form Lead exists; `ref_no` should match Granot `ref_no` for Top10 / many TBM rows |
| Granot won | Receipt exists; Form Lead not found yet |
| Duplicate submit | No Granot row / no webhook, or a webhook for a different earlier job |
| Empty Granot `ref_no` (TBM hole) | Form Lead exists; exact match impossible; phone/email/source fallback only |
| Best Relocation / Paid Overflow | Live receipts often have **no** Form Lead `ref_no` candidate |

**Current:** receipt stored, `processing_status: received`. Nothing else.

**Open decision — `lead_created` on a Form Lead:**

The exploring agent must recommend one of:

1. **Reconciliation only** — match, establish a Granot Record Link, record `already_current` / unmatched / ambiguous. Do not create a second Form Lead. Do not mutate quote/cubic from this event (the snapshot is a new row, usually priority `0`).
2. **Fill-only enrichment** — same as (1), plus apply the existing fill-only location / empty-receiver rules if the snapshot has them.
3. **Create-if-missing** — rejected by current domain rules unless a new ingestion origin, duplicate rule, and CPL rule are explicitly approved. Form Lead Ingestion is the authority for form traffic.

Recommended default for exploration: (1) or (2). Never (3) for WordPress form sources.

Idempotency fixture: the same `lead_created` can be delivered twice. Two receipts, one link, no second Form Lead.

### Stage F3 — Employee works the lead in Granot

An employee opens the Granot job, quotes the move, and Granot’s `prior` column changes. Vantage does not see keystrokes. Vantage sees the result later through one or more of:

- Owner runs the browser extension on Follow Up Estimates / Booked Jobs
- Owner runs Granot HTTP automation for that source label
- Granot sends `priority_updated` (projected)
- Owner later books in Admin (sale details typed by hand)

Granot priority is **not** Vantage quoted/booked. Current understood codes:

| Granot `prior` | Operational reading used today | Vantage write authorized today |
| --- | --- | --- |
| `0` | Not quoted / default | Locations + empty receiver only |
| `1` | Quoted | `quoted=true` + cubic + fill-only locations + empty receiver |
| `5` | Quoted and treated as booked-in-Granot | Same Lead writes as `1`. **Does not create a Vantage Booking.** |
| `2`, `3`, `7`, `8`, `9` | Unknown | Store / ignore; do not invent a mapping |

A jump `0 → 5` is common. It means Granot considers the job quoted and booked. It still cannot satisfy Vantage Booking invariants (agent allocations, total binder, deposit, merchant, source/lead link).

### Stage F4 — Browser extension finds the Form Lead

**Interaction:** Owner is on a Granot Follow Up Estimates or Booked Jobs page. Popup scan, or auto-sync if enabled.

**Current:**

1. Content script parses both tables
2. Parser accepts prior `0` / `1` / `5` only
3. Preview calls `POST /api/v1/form-leads/granot-match` (server-owned ladder)
4. Owner (or auto-sync) PATCHes ` /api/v1/form-leads/:id/granot-sync` with expected snapshot (optimistic lock)
5. `updateFormLead` writes allowed fields, refreshes an attached Booking’s customer/local if present, enqueues Sheet Sync

**Possible preview states:** `will_update` | `idempotent` | `has_booking` | `found_by_fallback` | `conflict` | `not_found` | `preview_error`

**Possible Form Lead states after a successful sync:**

| Before | After (prior 1 or 5) |
| --- | --- |
| Ingested, unquoted | `quoted: true`, cubic maybe set, locations maybe filled, receiver maybe set |
| Already quoted, same cubic | No-op / idempotent; Sheet Sync may still not enqueue a meaningful change |
| Already booked | Same field updates; `booked` preserved; Sheet Sync uses `booking_chain` |
| Duplicate | Skipped (404 / quarantine) |
| Conflict / no match | Unchanged |

**Can happen after booking.** Priorities `1` and `5` are the ones that change reporting (`quoted`, cubic feet).

**Open decision:** if the extension already applied the snapshot, a later `priority_updated` webhook for the same job should be `already_current`, not a second write.

### Stage F5 — Granot HTTP automation finds the Form Lead

**Interaction:** Admin → Ingestion → Granot Automation. Owner creates a run for `form_leads` over a date window and source labels (`Top10 Forms`, `TBM Forms`, …).

**Current run lifecycle:**

```text
queued → planning (HTTP collect Booked Jobs + Follow Up Estimates)
      → preview completes
      → apply waits at awaiting_approval
      → owner approves selected action_ids + plan_checksum
      → applying → completed | completed_with_errors
```

Plan classifications: `update` | `unchanged` | `conflict` | `no_match` | `invalid`. Only `update` is approvable.

Apply re-checks the expected field snapshot. Outcomes: `applied` | `already_applied` | `drift` | `skipped` | `failed`.

**Same mutation rules as the extension.** Same “can run after booking.” Same Sheet Sync path through `updateFormLead`.

This is the owner’s way to avoid tab-hopping. It is not a different policy.

### Stage F6 — Projected: `priority_updated` webhook

**When it fires:** Granot’s priority (and the rest of the lead snapshot) changed. Payload is the **current** lead, not a delta.

**Typical Vantage states when it arrives:**

| Situation | Form Lead | Booking | What extension/automation would do |
| --- | --- | --- | --- |
| Quoted in Granot, not yet found by owner | exists, `quoted: false` | none | Prior 1/5 → set quoted + cubic |
| Extension already synced | exists, `quoted: true` | none | No-op |
| Automation already synced | same | none | No-op |
| Employee booked in Granot; owner has not booked in Vantage | exists, maybe quoted | **none** | Prior 5 → enrich lead only; still no Booking |
| Owner already booked in Admin | exists, `booked` set | exists | Enrich lead; preserve booking |
| Cancelled in Vantage, Granot still active | `booked` + `cancelled` | cancelled | Unresolved — do not un-cancel from priority |
| Unmatched (empty ref, wrong source, Paid Overflow) | missing or wrong candidate | none | Stay unmatched / conflict |

**Current:** receipt only.

**Open decision — `priority_updated` on a Form Lead:**

Compare against the existing Form Lead patch builder. Safe exploration default:

| Priority | Candidate action |
| --- | --- |
| `1` | Same as extension: quoted + cubic + fill-only locations + empty receiver; Sheet Sync via lead service |
| `5` | Same Lead enrichment **plus** a Granot Booking Intake Case when official Vantage Booking details are missing; a discrepancy is reserved for conflict with an existing Booking/link |
| `0` | Do not downgrade quoted/cubic until stale-event protection exists |
| Other | Normalize and block |

Do **not** create a Booking from this payload. Required Booking fields are absent.

### Stage F7 — Booking the Form Lead

There are several booking paths. They are not equivalent.

#### F7a — Owner Precise Booking Form (current primary)

Admin `/bookings/new?lead_type=FormLead&lead_id={mongoId}`.

Owner enters: `job_no`, book date, primary agent, optional split agent, binder, deposit, merchant. Optional customer overrides.

`POST /api/v1/booked-leads/from-source` → load Form Lead by `_id` → create/upsert Booking → `mirrorBookingToLead` (`FormLead.booked`, deposit thresholds, optional local/source/CPL) → Sheet Sync `booking_chain` (Master Booked `Booked Deals` + refresh Forms row).

**Possible states after F7a:**

| Document | State |
| --- | --- |
| Form Lead | `booked` set; `quoted` whatever it was; `cancelled` unset |
| Booking | exists; `lead_model: "FormLead"`; agent allocations; binder; deposit; merchant; `job_no` |
| Sheets | Booked Deals + Forms booked columns pending/written |

If a Booking already exists for that lead, the service **upserts** the existing Booking. It does not clear a prior `cancelled` flag.

#### F7b — Employee booking form (no lead pick)

Public `/employee-booking`. Employee enters source, agents, name, binder, deposit, merchant, phone, optional email / LID / job number.

Server auto-matches. Form rules include `form_lid_exact`, `form_contact_triple_exact`, `form_email_phone_exact`, `channel_phone_exact`. Blocked: already booked, cancelled, duplicate.

Outcomes:

| Outcome | Vantage state |
| --- | --- |
| `booked_and_linked` | Booking + `FormLead.booked` + `booking_chain` sync |
| `booked_pending_lead` | Leadless Booking + `BookingLeadReconciliationCase` (owner attaches later) |
| `duplicate_submission` | No second Booking |

#### F7c — Employee books in Granot only

Granot now has a booked job (often prior `5`). Vantage may still have an unbooked Form Lead.

**How Vantage can learn:**

- Projected `priority_updated` (prior `5`, current snapshot)
- Projected `booking_status_changed` (`Booked` / `booked`)
- Owner later does F7a by hand
- Extension / automation enrich the lead but still do not create the Booking

**Current:** owner notices in Granot or in the dashboard and performs F7a. Database + sheets update from that Admin write, not from Granot.

**Open decision:** a Granot-booked Form Lead without a Vantage Booking is a **reconciliation case**, not an auto-created Booking. The webhook snapshot does not contain binder / deposit / merchant / agent allocations.

### Stage F8 — Cancellation

#### F8a — Owner cancels in Admin (current)

Admin `/cancellations/new?booked_lead={id}` or `?lead_id={id}`.

Required: `refund_amount`. Optional: cancel date, reason, notes, cancelled_by.

`POST /api/v1/cancelled-leads`:

1. Create Cancellation snapshot
2. Set `Booking.cancelled`
3. Set `FormLead.cancelled` — **do not clear `booked`**
4. Dismiss pending reconciliation case if any
5. Sheet Sync `cancellation_chain` (Booked Deals cancelled flag + Forms row + `Cancelled Deals`)

A booking cannot be cancelled twice. Referral / leadless cancellation is rejected.

Deleting the Cancellation unsets both `cancelled` refs and refreshes sheets. There is no first-class “rebook” command.

#### F8b — Projected: `booking_status_changed`

**When it fires:** Granot booking status changed (booked, released, or an unstable string such as `Releas`).

**Typical Vantage states:**

| Granot payload | Vantage Booking | Open question |
| --- | --- | --- |
| `Booked` / `booked`, Vantage already booked | exists | Confirm link; no-op or refresh reconciliation |
| `Booked`, Vantage has no Booking | none | Reconciliation only — do not synthesize a Booking |
| `Releas` / release / cancel, Vantage booked | exists, not cancelled | Open a Granot Cancellation Intake Case; owner supplies official Refund and Cancel Date |
| Same, Vantage already cancelled | `cancelled` set | Already current; refresh evidence only |
| Unrecognized status | anything | Store raw; do not map by guess |

**Current:** receipt only. Owner still cancels in Admin (F8a) and that is what updates Mongo and sheets.

**Prototype decision:** do not auto-cancel. `Releas` against an active Booking opens a **Granot Cancellation Intake Case** and optional dashboard/email notification. Only **Confirm Granot Cancellation** may call canonical `createCancellation`. `Releas` with no Booking, a mismatched Record Link, or `Booked` after an official Cancellation is a **Granot Cancellation Discrepancy**.

**Still confused, ask Granot:** `event_type` and `priority` are not one status. Captured receipts show `Booked` and `Releas` each with Priority `0`, `1`, and `5`. Do not read `Booked` + Priority `0` as unbooked, and do not use a Lead's previous Priority `5` as cancellation authority. Competing readings and developer questions are in `scripts/prototypes/granot-lead-lifecycle/GRANOT-CANCELLATION-INTAKE-PROTOTYPE.md`.

---

## Call Lead path

A Call Lead is created from RingCentral, not from Granot. Granot learns about the caller because an employee types the job after the call. Vantage learns Granot state later through the same Observation Channels as Form Leads.

### Stage C0 — Inbound call to a mapped queue number

**Interaction:** RingCentral telephony.

Qualification (all must be true):

| Rule | Value |
| --- | --- |
| Direction | Inbound |
| Target number | Active Operations Registry inbound-queue route → Source Company + Source Granularity |
| Answered | Yes |
| Answered duration | ≥ 120 seconds |
| Caller phone | Present and normalizable |

Unqualified calls never become Call Leads.

### Stage C1 — Pending qualified call (before the Call Lead exists)

Webhook path (`POST /api/webhooks/ringcentral`) aggregates parties into a session:

| Session / candidate status | Meaning |
| --- | --- |
| `candidate` | Inbound target matched, waiting for answer |
| `pending_buffer` | Answered, still under 120s |
| `qualified` | Would create a lead |
| `rejected` | Failed a rule |
| `needs_review` | Missing caller phone or answered-at |

Ingest happens only when the session is **qualified and terminal**. Live calls still under 120s are not ingested.

These states live in `ringcentral_call_candidates` / `ringcentral_call_sessions`, not on `call_leads`.

### Stage C2 — Call Lead Ingestion

Two equivalent ingest paths; first writer wins via unique `ringcentral.telephony_session_id`:

| Path | Trigger | Notes |
| --- | --- | --- |
| RingCentral webhook | Session becomes qualified + terminal | Real-time |
| Call Log cron | `GET\|POST /api/cron/ringcentral-call-log-sync` (every 2 hours when enabled) | Safety net over Detailed Inbound Call Log; rolling lookback + overlap |

The user’s skeleton names the cron. In production both can run. The cron is the one that “finds pending qualified inbound queue calls” after the fact.

**Current ingest (`ingestRingCentralQualifiedCall`):**

1. Vet / qualify
2. Duplicate classify: same Source Granularity + phone within 90 days → still create, `duplicate: true`, CPL 0
3. Create Call Lead: phone, duration, timestamps, source assignment, RingCentral metadata
4. **`job_no` is not set.** Name, email, zips, cubic, move type are empty until enrichment
5. Sheet Sync `call_lead.create` → `Calls` or `Duplicate Calls`

**Possible Call Lead states after C2:**

| State | Fields | Sheets |
| --- | --- | --- |
| Eligible new call | phone + source + duration; no `job_no`; no `booked` | `Calls` |
| Duplicate call | `duplicate: true`, CPL 0 | `Duplicate Calls` |
| Form fill (later or already) | `form_fill: true` if a non-duplicate Form Lead shares source company + phone | Calls row flag |

Manual `POST /api/v1/call-leads` exists but is not the RingCentral path and does not set `duplicate`.

### Stage C3 — Employee writes the caller into Granot

The employee received the qualified call and created / filled a Granot job (name, zips, estimate, source label such as `Top10 Inbounds`).

Vantage still has a phone-only Call Lead (or, in the race below, does not have one yet).

### Stage C4 — Projected: `lead_created` webhook (inbound source)

**When it fires:** Granot created the inbound job the employee just typed.

**Races against Call Lead Ingestion:**

| Race | Vantage state | Match keys available |
| --- | --- | --- |
| Cron/webhook ingest already ran | Call Lead exists; **no `job_no` yet** | Source-scoped phone |
| Granot row created first | No Call Lead yet | Phone + inbound source label; must wait for C2 |
| Extension already enriched | Call Lead has `job_no` | Job number now strongest |
| Employee typed a form source label by mistake | Call Lead exists (inbounds) | Must not attach to a Form Lead just because phone matches |
| No RingCentral qualification ever | No Call Lead | **Must not** create a Call Lead from Granot alone unless a new origin is approved |

**Current:** receipt only.

**Open decision — `lead_created` on an inbound job:**

RingCentral Call Qualification remains the authority for Call Lead Ingestion. Default exploration posture:

1. Normalize and resolve source scope (Inbounds labels only)
2. If a Call Lead exists, match (phone now, job_no after enrichment) and link
3. If not, `pending_match` and retry across the cron / webhook race window
4. If still unmatched, owner-review — do not bypass qualification
5. Do not interpret Granot `ref_no` on this path

### Stage C5 — Extension or automation may run **before** the webhook

The owner can open Granot Follow Up Estimates, scan Call Leads, and enrich the Mongo Call Lead with `job_no`, customer, zips, cubic, move type, receiver — **before** `lead_created` is processed (and sometimes before it is even delivered).

After that:

- Call Lead is enriched
- Sheets refreshed (`call_lead.enrichment.sync`)
- A later `lead_created` or `priority_updated` should see already-current identity + fields

This is why webhook processing cannot assume it is the first Observation Channel.

### Stage C6 — Browser extension Call Lead workflows

Two tables, two server workflows:

| Granot table | Endpoint | Writes |
| --- | --- | --- |
| Follow Up Estimates | `/api/v1/call-leads/enrichment/preview\|sync` | Call Lead fields listed above |
| Booked Jobs | `/api/v1/call-leads/booked-reconciliation/preview\|sync` | Call Lead + Booking `source` / `local` / `book_date` + customer link |

Statuses: `updateable` | `updated` | `unchanged` | `conflict` | `no_match` | `invalid` | `failed`.

**Can run after booking.** Booked reconciliation is specifically for after booking.

### Stage C7 — Granot HTTP automation `call_leads`

Same two workflows, durable plan, owner approval, drift-checked apply. Collector never interprets Granot `ref_no`. Source catalog labels include `Top10 Inbounds`, `TBM Prime Inbounds`, `BestRelocation Inbounds`, `10best Inbounds`.

### Stage C8 — Projected: `priority_updated` webhook (inbound)

Same snapshot semantics as Form Leads. Call Leads have **no `quoted` field**, so prior `1` / `5` cannot mean “set quoted.”

**What current enrichment would do with the snapshot:** write job_no / customer / location / cubic / local / empty receiver if they differ and the match is unique.

**What it would not do:** create a Booking, even at prior `5`.

**Possible states when it arrives:**

| Situation | Call Lead | Meaning |
| --- | --- | --- |
| Phone-only lead, employee just quoted | exists, no `job_no` | First chance to attach `job_no` if match is safe |
| Extension already enriched | `job_no` set | Already current |
| Prior 5, owner has not booked | enriched or not | Granot Booking Intake Case; Suggested Booking Lead is changeable and no Booking exists until owner confirmation |
| Owner already booked | `booked` set | Refresh lead fields; do not duplicate Booking |
| Still waiting for RingCentral ingest | missing | Pending match |

**Current:** receipt only.

**Open decision:** reuse Call Lead Enrichment field rules; do not invent a `quoted` flag; treat prior `5` as “Granot booked” evidence for reconciliation, not as a Booking command.

### Stage C9 — Booking the Call Lead

#### C9a — Owner Precise Booking Form (current primary)

Admin `/bookings/new?lead_type=CallLead&call_phone_number=…` (or job number).

`POST /api/v1/booked-leads/from-source`:

1. Match by `call_job_no` (409 if multiple)
2. Else phone match
3. Else **create a stub Call Lead** with `created_on_unmatched: true` (excluded from Calls sheet / lead-cost analytics)
4. Write submitted job_no / phone back onto the lead
5. Create/upsert Booking; mirror `booked` + thresholds; `booking_chain` sync

#### C9b — Employee booking form

Same public form as Form Leads. Call auto-match rules: `call_job_no_exact`, then `channel_phone_exact`. `created_on_unmatched` stubs are blocked from auto-attach.

#### C9c — Employee books in Granot only

Same gap as F7c. Vantage learns via projected `priority_updated` / `booking_status_changed`, or the owner types the sale into Admin (C9a). Extension booked-reconciliation can refresh an **existing** Booking; it cannot create one.

### Stage C10 — Cancellation

Same as Form Leads (F8a / F8b). `CallLead.cancelled` is set; `booked` is kept; sheets use `cancellation_chain`. Projected `booking_status_changed` / `Releas` must not invent a refund; the prototype opens a Granot Cancellation Intake Case for owner confirmation.

---

## Path catalog (every interleaving that matters)

Each row is a real sequence the exploring agent should be able to simulate. “WH” = projected webhook. “Ext” = browser extension. “Auto” = HTTP automation. “Admin” = owner dashboard.

### Form Lead sequences

| ID | Sequence | Vantage end state if webhooks stay capture-only | What a processor would have to get right |
| --- | --- | --- | --- |
| F-A | WP ingest ∥ Granot post → WH `lead_created` → Ext prior 1 → Admin book → Admin cancel | Lead booked+cancelled; sheets updated by Admin/Ext only | `lead_created` links; later WH no-ops |
| F-B | Same, but Auto instead of Ext | Same | Same patch rules as Ext |
| F-C | WP ingest ∥ Granot post → WH `lead_created` → WH `priority_updated` (1) → Admin book | Lead unquoted until someone enriches or processor applies prior 1 | First mutation opportunity is the priority snapshot |
| F-D | WP ingest → Ext prior 1 → WH `priority_updated` (1) | Already quoted before WH | Processor must be `already_current` |
| F-E | WP ingest → employee books in Granot (prior 5) → WH `priority_updated` → WH `booking_status_changed` Booked → Admin book | Unbooked until Admin | Prior 5 + Booked ≠ Vantage Booking |
| F-F | Admin books first → Ext / Auto / WH prior 1 or 5 | Booked lead still enrichable | Must not clear `booked` |
| F-G | Admin books → Admin cancel → WH `booking_status_changed` Releas | Already cancelled | Must not double-cancel |
| F-H | Admin books → WH `booking_status_changed` Releas before Admin cancel | Still booked | Open cancellation intake; do not auto-cancel |
| F-I | Duplicate form submit | Duplicate saved; no Granot post; no WH expected | If a WH still arrives, do not un-quarantine |
| F-J | WH `lead_created` arrives before Mongo ingest commits | Receipt first | Retry / pending_match, then exact `ref_no` |
| F-K | TBM empty Granot `ref_no` → Ext/Auto fallback | Matched by phone/email + source gate | WH has the same weak identity |
| F-L | Paid Overflow / Best Relocation `lead_created` with no Form Lead `ref_no` | Unmatched receipt | Source-ownership policy, not global phone search |
| F-M | Employee booking form links the Form Lead | Booked without Precise Form | WH Booked should link to that Booking, not create another |
| F-N | Employee booking pending reconciliation | Booking exists, lead not attached | WH may match the Form Lead while the case is still open |
| F-O | Owner marks Form Lead bad, then Granot still quotes it | `bad_lead` set; enrichment of quoted/cubic still possible unless other guards fire | Policy: do we enrich bad leads from WH? |
| F-P | Same snapshot via Ext then Auto then WH | One Mongo state | All three must converge to no-op |

### Call Lead sequences

| ID | Sequence | Vantage end state if webhooks stay capture-only | What a processor would have to get right |
| --- | --- | --- | --- |
| C-A | RC webhook ingest → employee types Granot → WH `lead_created` → Ext enrich → Admin book → Admin cancel | Classic happy path; WH unused | Link by phone, then persist job_no from later snapshots |
| C-B | RC cron ingest (webhook missed) → same as C-A | Same | Ingest path must not matter |
| C-C | Employee types Granot → WH `lead_created` → RC cron has not ingested yet | No Call Lead | Pending match; do not create from Granot |
| C-D | Ext enrich **before** WH `lead_created` | `job_no` already on Call Lead | WH is confirmation + link |
| C-E | WH `priority_updated` before any Ext/Auto | Phone-only Call Lead | May be the first `job_no` write if match is unique |
| C-F | Prior 5 in Granot, Admin not booked | Enriched or not; no Booking | Reconciliation signal |
| C-G | Admin books by phone, creates `created_on_unmatched` stub, later Ext finds the real Call Lead | Possible duplicate Call Lead + stub | WH matching must not attach the Granot job to the stub blindly |
| C-H | Form fill: Form Lead already exists for same source+phone | Call Lead `form_fill: true` | Still a Call Lead; do not merge into the Form Lead |
| C-I | Duplicate call (90-day window) | Duplicate Call Lead | Enrichment excludes / should not treat as the live opportunity |
| C-J | Inbounds WH matched by phone to two Source Granularities | Ambiguous | No auto-link |
| C-K | Booked reconciliation Ext/Auto after Admin book | Booking + Call Lead refreshed | Later WH Booked should no-op |
| C-L | Employee booking form matches `call_job_no_exact` | Booked without Precise Form | Same as F-M |
| C-M | Qualified call never typed into Granot | Call Lead exists; no WH | Unmatched Vantage lead; not a webhook problem |
| C-N | Granot inbound job, never a qualified RC call | Receipt only | Do not create a billable Call Lead |

### Sequences that cross form and call

| ID | Sequence | Risk |
| --- | --- | --- |
| X-A | Same phone, Form Lead and Call Lead, Granot source is `Top10 Forms` | Call matcher must not steal the form job; form matcher must not write the call lead |
| X-B | Employee booking form, source granularity is call, identity looks like a form LID | Channel rules decide; wrong attach is a reconciliation case |
| X-C | WH `lead_created` source label unknown (`Paid Overflow`, `Referral`, test labels) | Unmatched source — not a global search |

---

## State snapshot checklist (use at each interaction)

When walking a path, record these facts. If a webhook processor cannot answer them, it is not ready to write.

### After Form Lead Ingestion

- `[ ]` `duplicate` true/false
- `[ ]` `ref_no` (provider Tracking Reference vs `"not provided"`)
- `[ ]` `source_company` / granularity
- `[ ]` `quoted` (almost always false)
- `[ ]` `post_to_granot` (false for WordPress-owned posts)
- `[ ]` Sheet job: `form_lead.create` → Forms or Duplicates
- `[ ]` Matching Call Leads marked `form_fill`?

### After WordPress / server Granot post

- `[ ]` Granot `ref_no` equals Mongo `ref_no`, is a Mongo `_id`, or is empty
- `[ ]` Granot `source` label
- `[ ]` Granot `job_no` now exists (this is the durable Granot identity)

### After `lead_created` receipt

- `[ ]` Receipt stored?
- `[ ]` Form Lead or Call Lead match: exact / fallback / pending / unmatched / ambiguous
- `[ ]` Channel implied by source label: form vs call vs unknown
- `[ ]` **Decision:** link only, fill-only, or create (create is out of policy by default)

### After extension or HTTP automation

- `[ ]` Match method
- `[ ]` Classification / preview status
- `[ ]` Fields actually written
- `[ ]` Drift or already-applied?
- `[ ]` `booked` still set if it was set
- `[ ]` Sheet job: `form_lead.update` / `call_lead.enrichment.sync` / `booking_chain`

### After `priority_updated` receipt

- `[ ]` Raw Granot Priority
- `[ ]` Is that priority in the supported `{0,1,5}` write set?
- `[ ]` Desired patch vs current Mongo (already current / apply / blocked / stale)
- `[ ]` If priority `5`: is there a Vantage Booking? If not, reconciliation only
- `[ ]` Did Ext/Auto already apply this snapshot?

### After Admin or employee Booking

- `[ ]` Booking required fields present (agents, binder, deposit, merchant, source)
- `[ ]` Lead `booked` set
- `[ ]` Stub Call Lead (`created_on_unmatched`)?
- `[ ]` Pending reconciliation case?
- `[ ]` Sheet job: `booking_chain`

### After `booking_status_changed` receipt

- `[ ]` Raw status string (`Booked` / `booked` / `Releas` / other)
- `[ ]` Linked Booking present?
- `[ ]` Already cancelled?
- `[ ]` **Decision:** booking intake, already current, cancellation intake, or cancellation discrepancy
- `[ ]` Refund / reason available? If not, do not auto-cancel; open Granot Cancellation Intake Case when an active Booking exists

### After Admin Cancellation

- `[ ]` `Booking.cancelled` set
- `[ ]` Lead `cancelled` set and `booked` retained
- `[ ]` Sheet job: `cancellation_chain`

---

## Booking and Cancellation invariants the webhook design cannot break

1. A Booking is a confirmed sale: binder, at least one Agent Allocation, deposit, merchant, source, and (unless referral/leadless) a lead link. Granot list snapshots do not contain that set.
2. One Booking per (`lead_ref`, `lead_model`). A second create upserts.
3. Cancellation is additive. The lead stays booked **and** cancelled.
4. Duplicate Form Leads and duplicate Call Leads are saved for reporting and are not enrichment / booking-claim targets.
5. Sheet Sync is a projection of Mongo. Webhook routes must not write Google Sheets.
6. Observation Channel is not authority. Extension, HTTP automation, CSV, and webhooks that apply the same snapshot must converge.
7. Call Lead Ingestion requires RingCentral qualification. Granot cannot mint a billable inbound lead by default.
8. Form Lead Ingestion requires the site form (or an approved alternate origin such as Best Relocation sheet). Granot cannot mint a Form Lead by default.
9. `user` / `rep` fill `receiver_agent` once. They are not the change actor.
10. Without `occurred_at` / revision, a late webhook is not proven fresher than an extension or automation write. Prefer conditional / already-current over last-received-wins.

---

## Out-of-band paths (not in the user’s skeleton, still real)

These do not replace the Form / Call lifecycles but can sit beside them:

| Path | What it is | Webhook relevance |
| --- | --- | --- |
| Next.js landing / main site Form Lead | Same ingest route; server may CRM-post | Same `lead_created` after server or site post |
| Best Relocation sheet ingest | Alternate Form Lead origin; automation currently off | May produce Form Leads Granot never sees |
| Referral Booking | No source lead | `booking_status_changed` should not invent a lead |
| Leadless Booking | Owner books without a lead | Same |
| Employee booking reconciliation | Owner attaches or creates a lead after the sale | A later WH may match the lead the case is about |
| Owner marks Form Lead bad | Disqualify; not a cancellation | WH must not silently clear `bad_lead` |
| Delete Cancellation | Reactivates booking+lead cancelled flags | A Granot release event after this is a new decision |
| Granot CRM CSV sync | Batch Observation Channel | Same snapshots, different transport |

---

## What the exploring agent should decide

Work through the path IDs, not through a green-field CRM design. For each webhook class, return a recommended Synchronization Decision per path family:

1. **`lead_created` + Form Lead** — link / fill-only / ignore. Default: do not ingest.
2. **`lead_created` + Call Lead** — pending-match window, then link. Default: do not ingest.
3. **`priority_updated` + prior `1`** — apply existing Form Lead patch; Call Lead enrichment fields only.
4. **`priority_updated` + prior `5`** — same enrichment + booking-reconciliation work item. Never auto-book.
5. **`priority_updated` + prior `0` / unsupported** — observe only until downgrade and unknown-code policy exist.
6. **`booking_status_changed` + Booked** — link or reconcile; never create a Booking from the snapshot.
7. **`booking_status_changed` + release/cancel** — open a Granot Cancellation Intake Case when an active Booking exists; owner Confirm Granot Cancellation remains the write path.
8. **Ordering** — how to treat WH vs Ext vs Auto when Granot still has no event ID or revision.
9. **Unmatched sources** — Paid Overflow, Best Relocation, Referral, test labels.
10. **Admin UX** — what the owner should see when Granot says booked/cancelled and Vantage does not.

If a recommendation would create a Lead or a Booking, it needs a new ingestion origin, duplicate/CPL rule, and Booking-invariant story. That is a product decision, not a webhook-route implementation detail.

---

## Code index for the exploring agent

| Concern | Where |
| --- | --- |
| Form Lead create/update | `src/services/leads/formLead.service.ts` |
| Form duplicate / form fill | `src/services/leads/duplicateLead.service.ts` |
| Server CRM post | `src/services/crm/formLeadPayload.ts`, `crm.service.ts` |
| Form Granot match + patch | `src/services/granotHttpCollector/granotFormLeadMatcher.ts`, `formWorkflow.ts` |
| HTTP automation run | `src/services/granotHttpCollector/runWorkflow.ts` |
| Extension form sync | `granot_sync_extensions_and_services/src/workflows/form-leads/` |
| Extension call sync | `granot_sync_extensions_and_services/src/workflows/call-leads/` |
| Call qualification / ingest | `src/services/ringcentral/call-qualification.ts`, `ringcentral-call-lead-ingest.service.ts`, `call-log-sync.service.ts` |
| Call enrichment | `src/services/enrichment/callLeadEnrichment.service.ts` |
| Booked-call reconciliation | `src/services/reconciliation/bookedCallLeadReconciliation.service.ts` |
| Admin from-source booking | `src/services/bookings/bookedLeadFromSource.service.ts` |
| Employee booking | `src/services/employeeBookings/submitEmployeeBooking.service.ts` |
| Cancellation | `src/services/cancellations/cancelledLead.service.ts` |
| Sheet Sync | `src/services/sheetSync/sheetSyncCoordinator.ts` |
| Webhook capture | `src/routes/granot-webhook.routes.ts`, `src/services/granotWebhooks/granotWebhookCapture.service.ts` |
| Admin book/cancel UI | `vantage-admin/components/forms/booking-form.tsx`, `cancellation-form.tsx` |
