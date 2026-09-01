# Owner Booking Intake — even Binder, optional Lead, and owner-readable data

> **Implementation workspace (2026-08-28):** remaining optional-Lead, high-confidence
> auto-attach, and Connect Booking to Lead work is sequenced in
> [`../booking-intake-lead-attachment/README.md`](../booking-intake-lead-attachment/README.md).
> That pack **wins on the Connect surface** — first-class on `/bookings`, not
> `/intakes`. This file still wins on command shapes, eligibility, Sheet Sync
> names, and processor Leadless follow-through. Even Binder (§5) has landed.
>
> **Contract maturity: implementation-ready.** Delta over the locked FINAL SPEC and a **prerequisite** for the Owner Daily pack. It does **not** rewrite [`FINAL-SPECIFICATION-GRANOT-LEAD-LIFECYCLE.md`](../../scripts/prototypes/granot-lead-lifecycle/specs/FINAL-SPECIFICATION-GRANOT-LEAD-LIFECYCLE.md). Do not edit that file unless the owner explicitly asks.

**Prepared:** 2026-08-24  
**Repos:** `vantage-main-server`, `vantage-admin`  
**Owner term in Admin copy:** booking intake. **Canonical term:** [Granot Booking Reconciliation Case](../../../CONTEXT.md).

This specification lands **before** Owner Daily (`/daily`). Daily Intakes, Completed, and copy must inherit this contract. They must not reintroduce a second binder input, a required Lead on Confirm, masked owner-intake contact, or an Ingestion handoff for booking work.

**Implementation status (2026-08-24):** §5 even Binder has landed (command input, server even-cent split, owner confirm/update/referral forms). Sections 6–11 (optional Lead, Connect Booking to Lead, unmasking, Intakes vs Ingestion) are **not** implemented.

---

## 1. Authority and required reading

Read in this order. Stop and report contradictions; do not silently merge.

1. **This file** — wins on owner booking-form shape, Confirm-without-Lead, High-Confidence auto-attach, Connect Booking to Lead, owner-intake contact visibility, evidence/timeline presentation, and the Intakes vs Ingestion split.
2. **[Release into booking intake](./release-into-booking-intake-specification.md)** — wins on Releas / Release upsert onto the booking case, cancellation-intake retirement, and Live Events → intake link.
3. **[Booking Reconciliation Booked-only](./booking-reconciliation-booked-only-specification.md)** — still wins on Priority 5 never opening a case and Booking Priority Pairing. AC-P5 in that file is superseded by the Release-into-intake spec.
4. **FINAL SPEC** — still wins on everything these files do not change: case uniqueness, revisions, Referral, identity-conflict discrepancies, and official-field blankness (Granot numbers are never copied into official inputs).
5. **Glossary:** [`CONTEXT.md`](../../../CONTEXT.md) — Confirm Granot Booking, Leadless Booking, High-Confidence Booking Lead, Suggested Booking Lead, Connect Booking to Lead, Binder, Agent Allocation, Booking Lead Reconciliation.
6. **Current service docs (reverify, do not copy as contract):** [`booking-reconciliation.md`](../knowledge/granot-lifecycle/booking-reconciliation.md), [`bookings.md`](../knowledge/services/bookings.md), [`agent-allocation.md`](../knowledge/services/agent-allocation.md), [`employee-bookings.md`](../knowledge/services/employee-bookings.md), [`projections.md`](../knowledge/granot-lifecycle/projections.md).

FINAL SPEC / current-code citations this delta replaces:

| Locked or current text | Replacement |
| --- | --- |
| Confirm Granot Booking requires an eligible selected Lead | Official details are required. A Lead is optional. |
| `selected_lead` is required on `confirm-booking` | `selected_lead` is optional. Server may attach a unique High-Confidence Booking Lead. |
| Official booking details send per-agent `binder_amount` (1–20 rows) | Owner sends one Binder and one or two Agent IDs. Server allocates evenly. |
| Booking without Lead delegates to Employee Booking Lead Reconciliation and fails closed if that case is missing | A Granot-created Leadless Booking is official. Later Booked observations open `review_existing_booking`. Employee cases stay on the employee path only. |
| Unit 31 / ODR-35: mask phone and email on owner intake list and case detail | Owner intake surfaces show full name, phone, and email. |
| ODR-37: Daily Intakes hands off to `/ingestion/granot/lifecycle/cases/:id` | Daily Intakes hands off to `/intakes`. Ingestion stays technical. |

A case is still not a Booking. Official Booking writes stay on gated Owner commands.

---

## 2. Objective

1. Let the Owner finish a booking intake the same way he already finishes an employee booking: **one Binder amount**, **up to two Agents**, even split.
2. Let the Owner submit Confirm Granot Booking **without attaching a Lead**. Create the official Booking, sync **Master Booked**, and leave Lead attachment for later when there is no unique High-Confidence Booking Lead.
3. Attach a Lead automatically **only** when that unique High-Confidence Booking Lead exists. Medium-confidence contact matches never auto-attach.
4. Add **Connect Booking to Lead**: a simple Owner command and route that attaches one stored, unbooked Lead to an already-created Leadless Booking and syncs **Master Leads**.
5. Put every booking-intake fact the Owner needs on **Intakes** — Granot webhook payload, full contact, evidence history, and job timeline — in language he can read. Do not split that work across Intakes and Ingestion.

This is the common case that usually has a high-confidence Lead. The Leadless path is the exception we still allow.

---

## 3. Current-state evidence (repository, 2026-08-24)

Reverify at implementation. These are the facts this spec is changing. **§3.1 is historical** — superseded by landed §5. Sections 3.2–3.4 remain current.

### 3.1 Two binder inputs on the owner form (historical)

- [`booking-command-form.tsx`](../../../vantage-admin/components/granot-lifecycle/booking-command-form.tsx), [`booking-update-form.tsx`](../../../vantage-admin/components/granot-lifecycle/booking-update-form.tsx), and [`referral-booking-form.tsx`](../../../vantage-admin/components/granot-lifecycle/referral-booking-form.tsx) each collect **Total Binder Amount** plus a **Binder Amount per agent**, and allow up to 20 agents.
- [`granotLifecycleOfficialBookingDetailsSchema`](../../src/validation/v1/granotLifecycle.validation.ts) requires `agent_allocations[]` of 1–20 `{ agent_id, binder_amount }` whose cents sum equals `total_binder_amount`.
- The employee form already matches the desired contract: one Binder, primary Agent, optional secondary Agent, even split ([`employee-booking-form.tsx`](../../../vantage-admin/components/employee-booking/employee-booking-form.tsx)).
- Server helper `deriveBookedLeadAgentAllocations` already even-splits. It currently uses floating `/ 2`, which this spec tightens to integer cents.

### 3.2 Confirm always requires a Lead

- `granotLifecycleConfirmBookingCommandSchema.selected_lead` is required.
- `bookingConfirmation.ts` always writes `is_leadless_booking: false` and fails without an eligible Lead.
- The form pre-selects the strongest candidate and blocks submit with “Select one eligible Lead.”
- Suggestion confidence is already `high` except `source_scoped_contact` (`medium`). Auto-attach does not exist; the Owner still has to confirm a pre-selected Lead, including medium-confidence ones.

### 3.3 Leadless already exists — on other paths

- Admin `POST /api/v1/leadless-bookings` and employee submit already create Leadless Bookings and sync Master Booked (`booked_lead` / `leadless_booking.create` or `employee_booking.create_pending`).
- Employee pending work uses **Booking Lead Reconciliation** (`attach_existing`). That is not this feature.
- Processor AC-28 / AC-39: “Booking without Lead” delegates to an existing employee case and **fails closed** if that case is missing. `updateExistingBooking` also rejects `is_leadless_booking`. Those rules make a Granot-created Leadless Booking unreviewable today.

### 3.4 Owner data is split and partly hidden

- `/intakes` is already the waiting room. `/ingestion/granot/lifecycle` already says cases live in Intakes and keeps the technical queue.
- The open case still lives at `/ingestion/granot/lifecycle/cases/[caseId]` as well as `?case=` on `/intakes`. Job history links to `/ingestion/granot/lifecycle/jobs/:jobNo`.
- [`CreatingObservationAccordion`](../../../vantage-admin/components/intakes/creating-observation-accordion.tsx) already exists on the intake list and on the open booking case. It leads with Observation/Receipt IDs and raw JSON, not contact.
- Intake list customer column is `masked_contact_label`. Case-detail contacts exist but sit inside the Granot-evidence accordion, which is **collapsed when the official form is showing** (`referenceOpen = !capabilities.commands`). Evidence history and job timeline collapse the same way.
- Unit 31 / [`projections.md`](../knowledge/granot-lifecycle/projections.md): case list and case detail mask contact. Owner-only exceptions today are the candidate browser and the creating-observation payload.

---

## 4. Locked decisions

1. **One Binder input. At most two Agents.** The Owner never types a per-agent binder amount on any Granot booking intake form (confirm, update, referral).
2. **Even split is server-owned.** One Agent receives the full Binder. Two Agents split integer cents; the primary Agent receives the leftover cent when the Binder is odd.
3. **A Lead is optional on Confirm Granot Booking.** Official book date, Binder, Agents, Deposit, and Merchant remain required and stay blank until the Owner types them.
4. **Auto-attach is high confidence only, unique only, and only when the Owner did not pick a Lead.** Medium-confidence Source Scope contact never auto-attaches. Ambiguity never auto-attaches.
5. **An explicit Owner Lead selection always wins.** It may be high or medium confidence, in or out of Source Scope (out-of-scope still needs the 10–500 character reason).
6. **No High-Confidence Booking Lead and no Owner selection → Leadless Booking + Master Booked.** The case resolves. The Owner connects the Lead later. This is allowed and expected to be uncommon.
7. **Connect Booking to Lead is a new Owner command**, not Employee Booking Lead Reconciliation and not Confirm Granot Booking. It attaches one stored unbooked Lead to an existing Leadless Booking and queues Master Leads Sheet Sync.
8. **A Granot-created Leadless Booking is official.** Later Booked observations open `review_existing_booking`. Update Existing Booking and Confirm Granot Cancellation must work without a Lead. Do not bounce these jobs to the employee reconciliation queue.
9. **Intakes owns owner booking work.** Ingestion/Granot lifecycle stays technical (queue, discrepancies, health). Daily Intakes hands off to `/intakes`, never to `/ingestion/granot/lifecycle/cases/:id`.
10. **Owner intake surfaces show full contact.** Name, phone, and email are visible on the intake list, the open case, and the booking form. Masking stays on processor events, non-owner reads, and non-intake Daily feed cards.
11. **Granot numbers never become official defaults.** Estimate, payment, and balance stay reference-only.
12. **One Booking per normalized Job Number** is unchanged. Connect never creates a second Booking or a second Lead.

---

## 5. Even Binder and Agent inputs

### 5.1 Owner form

Replace the current “total binder + per-agent binder + Add Agent (up to 20)” block on:

- Confirm Granot Booking
- Update Existing Booking
- Create Referral Booking

Required fields:

| Field | Rule |
| --- | --- |
| Book Date | Calendar `YYYY-MM-DD`, blank until typed |
| Deposit | Nonnegative, ≤ 2 decimals |
| Binder | One nonnegative amount, ≤ 2 decimals. Label: **Binder amount** |
| Merchant | One active Merchant dropdown |
| Primary Agent | One active Agent dropdown, required |
| Secondary Agent | Optional active Agent dropdown. Empty means one Agent. Must differ from primary |

Show the derived split as read-only text, for example: “Alex $150.00 · Sam $150.00” or “Alex $150.01 · Sam $150.00”. The Owner cannot edit those amounts.

Review-before-submit still exists. Review shows the same derived split.

### 5.2 Command input

Replace `official_booking_details.agent_allocations[]` on confirm, update, and referral with:

```ts
official_booking_details: {
  book_date: string;            // YYYY-MM-DD
  deposit_amount: number;
  total_binder_amount: number;  // the single Binder
  merchant_id: string;
  primary_agent_id: string;
  secondary_agent_id?: string;  // omit or empty = one Agent
}
```

Server derives stored `agent_allocations` and `total_binder_amount`. Client-sent per-agent amounts are rejected.

Zod: unique Agent IDs; both Agents must be active catalog Agents (same Operations Registry catalog as today); Binder and Deposit stay exact-cent money.

### 5.3 Cent split

Work in integer cents.

- One Agent: `[ { primary, binder_cents } ]`
- Two Agents: `floor(total_cents / 2)` to the secondary Agent; `total_cents - secondary` to the primary Agent

Examples: `$100.00` → `$50.00` / `$50.00`. `$100.01` → `$50.01` / `$50.00`.

Reuse `deriveBookedLeadAgentAllocations` after it is changed to this cent rule, or extract one shared helper used by employee submit, from-source, leadless, referral, and Granot owner commands. Do not keep a second split.

---

## 6. Confirm Granot Booking without a required Lead

### 6.1 Submit contract

`POST /api/v1/admin/granot-lifecycle/booking-cases/:id/confirm-booking`

Unchanged: Owner actor, `Idempotency-Key`, `expected_case_revision`, booking-command gate, first-evidence causal chain, blank official fields from the Owner.

Changed: `selected_lead` is optional.

```ts
{
  expected_case_revision: number;
  selected_lead?: { lead_model: "FormLead" | "CallLead"; lead_id: string };
  out_of_scope_override_reason?: string;  // required only when selected_lead is out of Source Scope
  official_booking_details: { /* §5.2 */ };
}
```

### 6.2 Attachment resolution (server, inside the command transaction)

Evaluate in this order. Do not attach in the Admin client.

| Condition | Result |
| --- | --- |
| Owner sent `selected_lead` | Validate eligibility and attach that Lead. Out-of-scope still requires the override reason. |
| No `selected_lead`, and the case has exactly one High-Confidence Booking Lead | Attach that Lead. |
| No `selected_lead`, and there is no unique High-Confidence Booking Lead | Create a Leadless Booking. Do not open a Booking Lead Reconciliation Case. |

**High-Confidence Booking Lead** means the current suggestion/candidate confidence is `high` and the match method is one of:

- `granot_record_link`
- `form_ref_no_exact`
- `form_mongo_id_compatibility`
- `form_job_no_exact`
- `call_job_no_exact`
- Booking-owner evidence already classified as high

`source_scoped_contact` is **medium**. It may be shown and Owner-selected. It is never auto-attached.

Unique means exactly one eligible high-confidence candidate (or the persisted suggestion when it is high and unambiguous). Zero, two, or more high-confidence candidates → Leadless.

Eligibility for an attached Lead is unchanged: not Duplicate, not Bad, not cancelled, not already booked. Claim remains compare-and-swap. A lost claim fails the command with the current conflict envelope; it does **not** silently fall through to Leadless on that same attempt.

### 6.3 Persist outcomes

**Attached (Owner-selected or high-confidence auto):**

- Same official Booking write as today, `is_leadless_booking: false`
- Mirror booked / deposit thresholds onto the Lead
- Active Granot Record Link to that Lead when the case has Source Scope
- Case resolves `booking_created` (or `already_satisfied` on exact replay)
- Sheet Sync: `booking_chain` / `booked_lead.create` — Master Booked **and** the source Lead row (Master Leads)

**Leadless:**

- Official Booking with `is_leadless_booking: true`, no `lead_ref` / `lead_model`
- Customer from observed/submitted contact already on the case — display and customer upsert only; never as official Binder/Deposit/Agents
- Booking-only Record Link is allowed (job identity without a Lead), same posture as Referral’s booking-only link
- Case resolves `booking_created`
- Sheet Sync: `booked_lead` / `granot_booking.create_leadless` (or reuse `leadless_booking.create`) — **Master Booked only**
- Response tells the Owner the Booking was created without a Lead and can be connected later

Copy the Owner can read, not an internal mode name: “Booking saved to Master Booked. No stored lead was attached. You can connect a lead later.”

### 6.4 Form behavior

Lead section title: **Matching lead (optional)**.

- If a High-Confidence Booking Lead exists, pre-fill it and say it will be attached when he submits.
- If only medium-confidence or no match exists, show an empty state: “No high-confidence lead. You can search, or save the booking now and connect a lead later.”
- Submit is enabled without a Lead once official details are valid.
- Lead search stays beside the form for the uncommon “wrong customer / no auto match” case.
- Review must state either the attached Lead (name, phone, email, job, Lead ID) or **No lead — Master Booked only**.

Do not auto-select a medium-confidence row. That is the current form’s most important foot-gun.

---

## 7. Connect Booking to Lead

### 7.1 What it is

A completed Leadless Booking already exists and is already on Master Booked. The Owner later points it at one stored Lead that is not part of a Booking.

This is **not**:

- Confirm Granot Booking (that creates the Booking)
- Booking Lead Reconciliation (employee pending cases)
- Creating a Lead
- Creating a second Booking

### 7.2 Route

```text
POST /api/v1/admin/bookings/:bookingId/connect-lead
```

Owner-only (`requireRegistryOwnerActor`). One strict `Idempotency-Key`. Mount next to the existing Granot lifecycle admin router (same `/api/v1` guard). Admin BFF proxy must allow this path for Owner mutations.

```ts
{
  expected_booking_revision: number;
  selected_lead: { lead_model: "FormLead" | "CallLead"; lead_id: string };
  out_of_scope_override_reason?: string; // 10–500 chars when the Lead is outside the Booking's Source Scope / source assignment
}
```

Command name: `connectBookingToLead`.

### 7.3 Eligibility

**Booking** must be:

- present, not cancelled
- Leadless (`is_leadless_booking === true` or missing `lead_ref`)
- **not** a Referral Booking (Referral stays no-Lead by definition)

**Lead** must be:

- present
- not booked, not cancelled, not Duplicate, not Bad
- Form Lead or Call Lead
- not a Call Lead created as `created_on_unmatched`

If the Booking already has this exact Lead, return `already_satisfied` (200) with no new Change. If it has a **different** Lead, fail closed (`IDENTITY_CONFLICT`). If another Booking already owns the Lead, fail closed.

Source-scope / source-assignment mismatch requires the override reason. Same-source attach does not.

### 7.4 Transaction

One command transaction:

1. CAS the Booking revision.
2. Claim the Lead (`claimAvailableLeadForBooking` or the Granot equivalent).
3. Set `lead_ref`, `lead_model`, `is_leadless_booking: false`. Do not rewrite official Binder, Agents, Deposit, Merchant, or book date.
4. Mirror booked + deposit thresholds onto the Lead. Do not rewrite CPL (`preserveExistingCpl`).
5. Correct or create the Granot Record Link to the selected Lead when a job link exists; keep the previous association as evidence if an Owner override changes it.
6. Persist `EntityChange` rows for Booking and Lead.
7. Queue **one** coalescible `booking_chain` intent — this is the Master Leads sync the Owner asked for, plus a Master Booked identity refresh so the booked row is no longer leadless.

Post-commit: `finalizeSheetSync`. Exact replay returns the durable result.

### 7.5 Where the Owner does this

A first-class **Connect a lead** action on:

- `/intakes` finished booking cases whose official Booking is still Leadless
- the official-facts card on an open `review_existing_booking` case whose Booking is Leadless
- later, Daily Completed booking rows that are Leadless — same command, no second implementation

The picker is the existing eligible-lead search (case-scoped when a case exists; otherwise admin lead search filtered to unbooked, non-duplicate, non-bad, non-cancelled Leads). Every row shows full contact.

---

## 8. Processor and later evidence

These follow-throughs are required. Without them a legal Leadless Booking becomes a dead end.

| Later fact | Required behavior |
| --- | --- |
| Actual Booked, one active Granot Leadless Booking | Open/refresh `review_existing_booking`. Do **not** delegate to Booking Lead Reconciliation. Do **not** fail closed. |
| Actual Booked, one active Referral Booking | Unchanged: review-existing, no Lead. |
| Employee pending Leadless Booking (`booking_origin=employee_booking`) | Unchanged: keep delegating to the employee case. |
| Update Existing Booking on a Granot Leadless Booking | Allowed. Official fields only. No Lead identity check. Sheet job is `booked_lead` update (Master Booked), not `booking_chain`. |
| Confirm Granot Cancellation on a Granot Leadless Booking | Allowed, same as Referral: no Lead mirror. Cancellation Chain / master cancelled projection only. |
| Connect Booking to Lead after review-existing is open | Allowed. Connecting does not resolve the review case by itself; the Owner still updates official fields or chooses No Action. |

`updateExistingBooking` must drop the current `is_leadless_booking` hard reject for Granot official bookings.

---

## 9. Owner surface — messaging and visible data

The Owner is the audience. Technical IDs stay available, but they are not the first thing he sees.

### 9.1 Intakes owns the work

| Surface | Owns |
| --- | --- |
| `/intakes` | Waiting and finished booking/cancellation intakes, the official forms, Granot payload accordion, full contact, evidence history, job timeline, Connect a lead |
| `/ingestion/granot/lifecycle` | Technical queue, discrepancies, health. No owner booking form. Banner already points at Intakes — keep it |
| `/ingestion/granot/lifecycle/cases/:id` | Redirect to `/intakes?case=:id` (preserve return-safe query). Do not keep a second owner case page |
| `/ingestion/granot/lifecycle/jobs/:jobNo` | Technical job debugger. Optional “Open technical history” link from Intakes, never the only timeline |
| `/daily` Intakes tab (later) | Windowed list + handoff to `/intakes?case=`. Must not hand off to Ingestion |

All booking-intake information the Owner needs to decide — why it is here, who the customer is, what Granot sent, what Vantage has, evidence, timeline, official form — is on the Intakes case. Nothing required for that decision lives only on Ingestion.

### 9.2 Granot webhook accordion (exists — make it owner-first)

Keep [`CreatingObservationAccordion`](../../../vantage-admin/components/intakes/creating-observation-accordion.tsx) on:

1. each booking row in the intake list
2. the open booking case, **immediately around the official form** (already mounted; keep it there, above or beside official fields, not buried under collapsed reference)

Change the body order:

1. **Owner summary** — “Granot recorded a booking” / route label, captured time, job number, source
2. **Full contact from that payload** — name, phone, email (never masked on this Owner read)
3. **Useful Granot facts** — move date, cubic feet, estimate, payment, balance, priority when present. Labeled **Granot numbers — reference only**
4. **Priority pairing** (already specified) in owner words
5. **Technical payload** — nested accordion with credential-redacted statement JSON, normalized Observation, Observation ID, Receipt ID

Default list accordion stays closed. Default open-case accordion stays closed on the raw JSON, but the owner summary + contact from §9.2.1–9.2.2 must also appear **outside** the accordion on the open case so he does not have to hunt.

### 9.3 Contact is not hidden

Owner-only intake list, case header, and booking form show:

- customer name
- phone
- email
- job number
- source label

Intake list replaces `masked_contact_label` as the only customer cell. A three-line stack is fine. This is an Owner-only page; Unit 31 masking does **not** apply here.

Still masked: processor/open-case operational events, non-owner actors, Daily Today feed cards that are not intake rows.

Case-detail `contacts.submitted_or_ingested`, `contacts.accepted_granot`, and observed Granot contact move **out** of the collapsed evidence accordion and sit in a visible **Customer** card next to official facts.

### 9.4 Evidence history and job timeline

On the open intake case, both sections are first-class and easy to open:

- **Evidence history** defaults **open**. Each row leads with owner language (“Granot recorded a booking”, “Granot updated priority”) and Florida time. Observation/Decision IDs are secondary mono text.
- **Job timeline** defaults **open** on the case, using the existing job timeline projection already embedded in case detail. Do not send the Owner to Ingestion to see it.
- Pairing stays a short audit line; it is not a substitute for the timeline.

When command forms are showing, do **not** collapse these sections (`referenceOpen = !capabilities.commands` is removed for evidence and timeline). The official form stays first; evidence and timeline stay one scroll away, open.

### 9.5 Owner copy

Update [`intake-copy.ts`](../../../vantage-admin/components/intakes/intake-copy.ts) so next-step and how-to-finish text match this spec:

- Create-missing: “Enter binder, up to two agents, deposit, and merchant. A high-confidence lead attaches automatically. You can save without a lead.”
- Leadless official booking: “This booking is on Master Booked without a stored lead. Connect a lead when you have one.”
- Review-existing: “Review or update the official booking. Binder is one amount, split evenly across the agents you pick.”

Do not say “choose a lead” as if it were required.

---

## 10. Sheet Sync

| Command outcome | Resource | Operation | Sheets |
| --- | --- | --- | --- |
| Confirm, Lead attached | `booking_chain` | `booked_lead.create` | Master Booked + source Lead (Master Leads) |
| Confirm, Leadless | `booked_lead` | `granot_booking.create_leadless` | Master Booked only |
| Update, Lead attached | `booking_chain` | `booked_lead.update` | Master Booked + source Lead |
| Update, Leadless or Referral | `booked_lead` | `booked_lead.update` / `referral_booking.update` | Master Booked only |
| Connect Booking to Lead | `booking_chain` | `booked_lead.connect_lead` | Master Leads (source Lead now booked) + Master Booked identity refresh |

Mongo remains the system of record. A 201/200 does not mean the sheet row is already visible.

---

## 11. Admin authorization and flags

- No new feature flag. Booking-command and Booking-case flags already gate Confirm / Update / Referral / No Action.
- Connect Booking to Lead uses the same Booking-command gate. Flag-off is **422** `POLICY_BLOCKED`.
- Add `/intakes` (already Owner) and `POST /api/v1/admin/bookings/:id/connect-lead` to `canProxyVantagePath` as Owner-only mutations.
- `/daily` later inherits `/intakes` as the resolve target.

Checked-in Granot effect flags stay false until a separately authorized enablement.

---

## 12. Explicitly out of scope

- Rewriting FINAL SPEC §19 trigger (Booked-only already owns that)
- Auto-creating a Lead from a Granot Booked payload
- Auto-attaching medium-confidence contact matches
- Employee Booking Submission and Booking Lead Reconciliation case actions
- Uneven custom binder splits
- More than two Agents on owner intake
- Using Granot estimate/payment as official Binder or Deposit
- Daily Today / Leads / Completed implementation (they consume this contract)
- Conversations, agent metrics, SSE
- Production flag enablement, production index apply, live payload reads

---

## 13. Acceptance criteria

- [ ] Confirm, update, and referral owner forms have exactly one Binder input and at most two Agent dropdowns. Per-agent binder inputs and “Add Agent” are gone.
- [ ] Two Agents on `$100.01` persist primary `$50.01` and secondary `$50.00`. One Agent persists the full Binder.
- [ ] Confirm without `selected_lead` and without a unique High-Confidence Booking Lead creates a Leadless Booking, resolves the case, and enqueues Master Booked only.
- [ ] Confirm without `selected_lead` and with exactly one High-Confidence Booking Lead attaches that Lead and enqueues `booking_chain`.
- [ ] Confirm without `selected_lead` and with only a medium-confidence `source_scoped_contact` suggestion creates a Leadless Booking. The medium Lead is not attached.
- [ ] Confirm with an explicit Owner `selected_lead` attaches that Lead even when it is medium confidence (eligibility and override rules still apply).
- [ ] The Admin form can submit with no Lead selected once official details are valid.
- [ ] `POST /api/v1/admin/bookings/:id/connect-lead` attaches one eligible unbooked Lead, clears leadless, mirrors booked on the Lead, and enqueues `booking_chain`.
- [ ] Connect rejects Referral Bookings, already-booked Leads, cancelled/duplicate/bad Leads, and a Booking that already has a different Lead.
- [ ] A later Booked Observation on a Granot Leadless Booking opens `review_existing_booking` and does not require an employee reconciliation case.
- [ ] Update Existing Booking and Confirm Granot Cancellation succeed on a Granot Leadless Booking.
- [ ] Intake list and open case show unmasked name, phone, and email for the Owner.
- [ ] Creating-observation accordion on the list and on the open form shows owner summary + full contact first; raw JSON is nested.
- [ ] Evidence history and job timeline are visible on the open Intakes case without visiting Ingestion, and they are not collapsed merely because the official form is showing.
- [ ] `/ingestion/granot/lifecycle/cases/:id` redirects to `/intakes?case=:id`.
- [ ] Daily pack issues that still say “handoff to ingestion case page” or “mask phone/email on intakes” are treated as stale against this file.

---

## 14. Required tests and commands

```bash
pnpm test
pnpm typecheck
cd ../vantage-admin && pnpm test && pnpm typecheck && pnpm build
```

Focused server tests:

- Confirm optional `selected_lead` Zod (omit allowed; unknown keys still reject)
- High-confidence unique auto-attach; medium-only → leadless; ambiguous high → leadless
- Owner-selected medium attach; out-of-scope without reason rejected
- Cent split `$100.00` and `$100.01`
- Leadless confirm sheet intent is Master Booked only
- Attached confirm sheet intent is `booking_chain`
- Connect happy path, already_satisfied replay, lead-already-booked, referral reject, stale booking revision
- Processor: Booked + existing Granot Leadless Booking → `review_existing_booking`, not employee delegate
- Update and cancel on Granot Leadless Booking

Focused admin tests:

- Official forms render one Binder and two Agent dropdowns
- Submit without a Lead is allowed
- Medium-confidence suggestion is not pre-selected
- Intake list shows phone and email
- Accordion owner summary + nested technical payload
- Evidence and timeline render open on the case while the command form is present

Ordinary checks use redacted synthetic data. Runtime reads require `TEST_MODE=true` and an explicit test database. No production deploy or flag change is authorized by this spec.

---

## 15. Relationship to Owner Daily

This file is the booking-intake contract Daily must consume.

| Daily issue (as written) | What this file changes |
| --- | --- |
| ODR-35 §5 — customer name full, phone/email masked | Masking stays off intake rows and intake case/form. Daily Today cards that are not intakes may stay masked. |
| ODR-37 — Intakes tab hands off to `/ingestion/granot/lifecycle/cases/:id` | Handoff is `/intakes?case=:id`. |
| ODR-36 — Completed provenance | A Completed Leadless Booking must offer Connect Booking to Lead through the §7 route. |

Do not implement Daily until this contract is the authority for those three points. Implementing Daily first would freeze the old required-Lead form, the two binder inputs, and the Ingestion split.

---

## 16. Rollback

If the new command or form is wrong in preview: revert Admin form components first (removes the Leadless submit affordance), then unmount `connect-lead`. Existing Leadless Bookings created in preview remain valid Mongo documents and can be connected after a fix. No production enablement is part of this spec, so production rollback is “do not turn the booking-command flag on.”
