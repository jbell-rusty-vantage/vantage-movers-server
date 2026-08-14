# Lead enrichment states and model fields

This prototype folder is named `granot-lead-lifecycle`. The real chain is:

```text
WordPress quote form  ──►  Vantage Form Lead   ──►  Granot job  ──►  Vantage enrichment
RingCentral inbound   ──►  Vantage Call Lead   ──►  Granot job  ──►  Vantage enrichment
```

Employees work the job in Granot. Vantage later copies Granot facts onto the existing Lead. Bookings and Cancellations are separate records that **link to** that Lead. They are not enrichment.

Granot webhooks already arrive and are stored as receipts. They are **not yet** part of this lifecycle. They do not match, enrich, book, or cancel. This document still records the payload values so the later processor has a field contract.

Related:

- [`README.md`](./README.md)
- [`NOTES.md`](./NOTES.md)
- [`SUGGESTED-DOMAIN-MODELS-AND-PROVENANCE.md`](./SUGGESTED-DOMAIN-MODELS-AND-PROVENANCE.md)
- [`../../../docs/lead-lifecycle-paths-and-projected-granot-webhooks.md`](../../../docs/lead-lifecycle-paths-and-projected-granot-webhooks.md)

---

## What “enrichment state” means

A Lead does not have one status enum for this. Enrichment state is **which fields are known**, and **which system filled them**.

| State | Meaning |
| --- | --- |
| Ingested | Vantage created the Lead from WordPress or RingCentral. Contact/source facts from that channel are present. Granot job facts are not. |
| Granot-enriched | An Observation Channel copied Granot job facts onto that same Lead. Identity is unchanged. |
| Booked | A Booking record exists and `Lead.booked` points at it. Enrichment may still run. |
| Cancelled | A Cancellation record exists and `Lead.cancelled` points at it. `Lead.booked` stays set. |

Quoted, cubic feet, cities, and receiver agent are enrichment facts. Booked and Cancelled are linked-record facts. Granot Priority `5` is not a Vantage Booking.

---

## Canonical Granot Priority vs derived Quoted

Granot Priority is the raw workflow code on the Granot row (`0`, `1`, `5`, `7`, …). Quoted is a Vantage boolean used for reporting.

**Store Granot Priority as a real canonical field on the Lead.** Quoted is the derivative statement, not the source of truth.

| Field | Owner | Role |
| --- | --- | --- |
| `granot_priority` | Granot | Canonical. Store the string Granot sent. Do not coerce it into a 0–5 enum. |
| `quoted` | Vantage | Derivative. `true` only when a mapped priority authorizes quote. |

Current understood mapping (extension / HTTP automation today):

| Granot Priority | Store on Lead | Set `quoted` | Create Booking |
| --- | --- | --- | --- |
| `0` | yes | no; do not push `quoted` back to false | no |
| `1` | yes | `true` | no |
| `5` | yes | `true` | **no** — Granot thinks booked; Vantage Booking still needs binder, deposit, merchant, agents |
| `2`, `3`, `7`, `8`, `9` | yes | do not invent a mapping yet | no |

Production today:

- Form Lead has `quoted`. It does **not** have `granot_priority`.
- Call Lead has neither `quoted` nor `granot_priority`. Reporting treats call quoted as not applicable.

Intended: both Lead kinds store `granot_priority`. Both may derive `quoted` from the mapped codes above. Until codes `2` / `3` / `7` / `8` / `9` are explained, keep the raw value and leave `quoted` unchanged.

---

## Opaque Granot money fields

Webhook snapshots also carry `estimate`, `payment`, and `balance`. Store them as Granot’s values. Do not treat them as Vantage binder, deposit, or refund until that mapping is decided.

| Granot field | Example | Vantage meaning now |
| --- | --- | --- |
| `estimate` | `"2400.00"` | Granot estimate. Store. Do not reason. |
| `payment` | `"646.40"` | Granot payment. Store. Do not reason. |
| `balance` | `"1753.60"` | Granot balance. Store. Do not reason. |
| `priority` | `"5"` | Canonical Granot Priority. Store. Derive `quoted` only from mapped codes. |

These belong on the Granot Observation (and the raw receipt). Copying them onto the Lead as opaque current-state fields is allowed; interpreting them as Booking money is not.

---

## Path 1 — WordPress form → Form Lead → Granot enrichment

WordPress posts to Vantage and to Granot in parallel. Vantage Form Lead Ingestion is the authority for creating the Form Lead. Granot later fills job facts. Match key is `ref_no` (the WordPress tracking reference Granot stores as `ref_no`). `lid` is operator context, never a match key.

Form Lead has no `job_no`. Granot `job_no` lives on the Booking (and on Call Leads). Form identity is `ref_no`.

### At ingest (WordPress form)

| Vantage field | From the form | Notes |
| --- | --- | --- |
| `first_name` | yes | |
| `last_name` | yes | |
| `name` | yes | Combined from first/last |
| `phone_number` | yes | |
| `email` | yes | |
| `source_company` | yes | Attribution; never overwritten by Granot |
| `move_date` | yes | |
| `pickup_zip` | yes | Required |
| `destination_zip` | yes | Required. Form model name is `destination_zip`, not `delivery_zip` |
| `pickup_state` | if zip lookup finds it | Else `not_found` |
| `delivery_state` | if zip lookup finds it | Else `not_found` |
| `move_size` | yes | Form-only. Granot later sends cubic feet, not move size |
| `ref_no` | yes | **Primary later match key.** More important than `lid` |
| `lid` | yes | Stored. Never used to match Granot |

Not present yet:

| Field | Why empty |
| --- | --- |
| `quoted` | Default `false`. Granot has not quoted |
| `granot_priority` | Not on the model today; not known at ingest |
| `pickup_city` | Form does not send city |
| `delivery_city` | Form does not send city |
| `cubic_feet` | Form sends move size, not cubic feet |
| `receiver_agent` | Unknown until Granot `user` / `rep` maps to an Agent |
| `booked` | No Booking yet |
| `cancelled` | No Cancellation yet |

### After Granot enrichment

Channels that can fill these today: browser extension, Granot HTTP automation, CRM CSV. Webhooks capture the same snapshot but do not write yet.

| Vantage field | Granot source | Rule |
| --- | --- | --- |
| `granot_priority` | `priority` | Canonical. Add this field. |
| `quoted` | derived from `priority` | `true` for mapped `1` / `5` only |
| `pickup_city` | `from_city` | Fill if missing |
| `pickup_state` | `from_state` | Fill if missing / `not_found` |
| `cubic_feet` | `est_cf` | When priority mapping authorizes quote/cubic |
| `receiver_agent` | `user` / `rep` | Only when empty and CRM username uniquely maps to an Agent |

Fill-only location rules in production also cover delivery city / state / zip when those Form Lead fields are still empty. Source company, `ref_no`, `booked`, and `cancelled` are never overwritten by enrichment.

```text
Form Lead after Granot enrichment
  ingest facts     : name, phone, email, source, move date, zips, move size, ref_no, lid
  granot facts     : granot_priority, quoted, pickup city/state, cubic_feet, receiver_agent
  still not a sale : booked unset unless a Booking record was created in Vantage
```

---

## Path 2 — RingCentral call → Call Lead → Granot enrichment

RingCentral Call Qualification creates the Call Lead. The employee then types the job into Granot. Vantage later matches the Call Lead (phone + source, then `job_no`) and copies Granot facts onto it.

Granot `ref_no` is **never** interpreted on the call path. Inbound jobs often have empty `ref_no`.

### At ingest (RingCentral)

| Vantage field | From RingCentral | Notes |
| --- | --- | --- |
| `phone_number` | yes | Required identity with source |
| `source_company` | yes | From the inbound-queue route, not from Granot |
| `ringcentral.*` | yes | Session / duration / route metadata |
| `timestamp` / duration | yes | Call times |

Not present yet:

| Field | Why empty |
| --- | --- |
| `name` / `first_name` / `last_name` | RingCentral does not supply the customer name |
| `email` | Not on the call |
| `job_no` | Granot assigns this when the employee creates the job |
| `granot_priority` | Unknown |
| `quoted` | Not on Call Lead today; unknown until Granot |
| `cubic_feet` | Unknown |
| `pickup_zip` / `delivery_zip` | Unknown |
| `pickup_state` / `delivery_state` | Unknown |
| `pickup_city` / `delivery_city` | Unknown |
| `receiver_agent` | Unknown |
| `booked` / `cancelled` | No linked sale records yet |

A qualified Call Lead is a phone + source-company opportunity. It is not a move yet.

### After Granot enrichment

| Vantage field | Granot source | Rule |
| --- | --- | --- |
| `job_no` | `job_no` | First durable Granot identity on a Call Lead |
| `name` / `first_name` / `last_name` | `first_name` + `last_name` | Write when they differ |
| `email` | `email` | Write when they differ |
| `granot_priority` | `priority` | Canonical. Add this field. |
| `quoted` | derived from `priority` | Intended derivative, same mapping as Form Lead |
| `cubic_feet` | `est_cf` | Write when parseable |
| `pickup_zip` | `from_zip` | |
| `delivery_zip` | `to_zip` | Call model name is `delivery_zip` |
| `pickup_state` | `from_state` | |
| `delivery_state` | `to_state` | |
| `pickup_city` | `from_city` | |
| `delivery_city` | `to_city` | |
| `receiver_agent` | `user` / `rep` | Only when empty and uniquely mapped |
| `local` | `service_type` | Move type when Granot reports Local vs Long Distance |

```text
Call Lead after Granot enrichment
  ingest facts     : phone, source company, RingCentral metadata
  granot facts     : job_no, name, email, granot_priority, quoted, cubic_feet,
                     pickup/delivery city/state/zip, receiver, move type
  still not a sale : booked unset unless a Booking record was created in Vantage
```

---

## Bookings and Cancellations link to Leads

Enrichment updates the Lead. Sale and refund facts live on other documents.

```text
FormLead ──booked──► BookedLead ──cancelled──► CancelledLead
CallLead ──booked──► BookedLead ──cancelled──► CancelledLead
```

| Record | How it attaches | What it holds |
| --- | --- | --- |
| Booking (`BookedLead`) | `Lead.booked` → Booking `_id`; Booking `lead_ref` + `lead_model` back to the Lead | `job_no`, book date, agents, binder, deposit, merchant, source |
| Cancellation (`CancelledLead`) | `Lead.cancelled` → Cancellation `_id`; Booking `cancelled` also set | refund, cancel date, reason. **Does not clear `Lead.booked`** |

A Granot webhook that says `Booked` or Priority `5` is evidence that Granot considers the job sold. It does not create a Vantage Booking. Missing official Vantage sale facts become a Granot Booking Intake Case, not an auto-Booking. Granot Booking Discrepancy is reserved for conflict with an existing Booking or established Granot Record Link.

---

## Granot webhooks — captured, not in the lifecycle yet

Routes already authenticate, store `granot_webhook_receipts`, and return `202`. `processing_status` stays `received`. No match. No Lead write. No Booking. No Sheet Sync.

Treat every payload as a **current-state snapshot**, not a delta. The route event class and payload `event_type` are different fields and can disagree.

Wire name notes:

| Transport | Payload `event_type` seen | Receipt `event_type` (route) |
| --- | --- | --- |
| Lead created | `"lead_created"` | `lead_created` |
| Priority snapshot | `"priority_update"` | `priority_updated` |
| Booking snapshot | `"Booked"` / `"booked"` / `"Releas"` / `"Release"` | `booking_status_changed` |

---

### `lead_created`

Granot created a job row. Usually no priority, estimate, payment, balance, user, or rep.

```text
event_type     lead_created
job_no         PROTO-5562371
service_type   Local
source         TBM Forms
ref_no         stfd3b35b7424a45fc98225bf7ee35ad40
first_name     Alex
last_name      Example
phone_number   +15550102371
email          alex.prototype@example.test
move_date      08/20/2026
est_cf         0
from_city      SNOHOMISH
from_state     WA
from_zip       98290
to_city        MINERAL
to_state       WA
to_zip         98355
```

What this snapshot can confirm later: Granot Record Link (`job_no` ↔ Form Lead `ref_no` or Call Lead phone/source). It does not ingest a Lead. `est_cf: "0"` is not a quote.

---

### `priority_update`

Current lead/job state, including Granot Priority. Not “priority changed from X to Y.”

```text
event_type     priority_update
job_no         PROTO-5562372
service_type   Long Distance
source         BestRelocation Inbounds
ref_no         (empty)
priority       5
user           ROY
rep            ROY
first_name     Sara
last_name      Example
phone_number   (555) 010-2372
email          sara.booking@example.test
move_date      08/28/2026
est_cf         390
from_city      Owens Cross Roads
from_state     AL
from_zip       35763
to_city        Walnut Creek
to_state       CA
to_zip         94597
estimate       2400.00
```

Empty `ref_no` plus an Inbounds source is the Call Lead path. Match by source-compatible phone, then `job_no`.

If this were applied today: store `priority` `5`, set `quoted` true, write cubic/location/name/email/receiver. Do not create a Booking.

---

### `Booked` (`booking_status_changed`)

Booking-status snapshot. Same lead fields, plus money fields. Priority may already have moved.

```text
event_type     Booked
job_no         PROTO-5562372
service_type   Long Distance
source         BestRelocation Inbounds
ref_no         (empty)
priority       0
user           ROY
rep            ROY
first_name     Sara
last_name      Example
phone_number   (555) 010-2372
email          sara.booking@example.test
move_date      08/28/2026
est_cf         390
from_city      Owens Cross Roads
from_state     AL
from_zip       35763
to_city        Walnut Creek
to_state       CA
to_zip         94597
estimate       2400.00
payment        646.40
balance        1753.60
```

Store `event_type`, `priority`, `estimate`, `payment`, and `balance` as Granot’s statement. `priority` `0` on a `Booked` payload is exactly why Priority is not Vantage Booking state. Do not auto-book. Do not treat `Booked` + `priority` `0` as unbooked. Stay idempotent on `job_no`: a later `Booked` for an existing Vantage Booking does not mint a second Booking. Do not auto-cancel from `Releas` / `Release`. A Release snapshot against an active Vantage Booking opens a Granot Cancellation Intake Case; the owner may confirm a Cancellation, update the existing Booking, or dismiss.

### `Releas` / `Release` (`booking_status_changed`)

Same snapshot shape as `Booked`. Granot names the CRM button `Release`.
Captured payloads truncate it to `Releas`. Keep both spellings as aliases.
Release means the Rep released the job from booked status — either to make
changes or because the customer cancelled. A job can have many Release
actions. Captured receipts show Release with Priority `5`, `1`, and `0`, so
Release is not “Priority left 5.”

```text
event_type     Releas
job_no         PROTO-5562372
priority       5
estimate       2400.00
payment        646.40
balance        1753.60
```

`event_type` and `priority` are separate fields. They can disagree. Comparing
this snapshot to a Lead's last stored Granot Priority is owner context only;
it is not proof the job was unbooked. Granot confirmed the button vocabulary
on 2026-08-13; see
[`GRANOT-CANCELLATION-INTAKE-PROTOTYPE.md`](./GRANOT-CANCELLATION-INTAKE-PROTOTYPE.md).

---

## Field map — Granot snapshot → Vantage Lead

| Granot payload | Form Lead | Call Lead |
| --- | --- | --- |
| `job_no` | Not stored on Form Lead. Used to link a Booking later | `job_no` |
| `ref_no` | `ref_no` — primary match key | ignored |
| `source` | never overwrite `source_company` | never overwrite `source_company` |
| `first_name` / `last_name` | fill/update name fields | fill/update name fields |
| `phone_number` | already present from form | already present from RingCentral; match key |
| `email` | already present from form | fill |
| `move_date` | already present | Call Lead has no `move_date` today |
| `est_cf` | `cubic_feet` | `cubic_feet` |
| `from_city` / `from_state` / `from_zip` | `pickup_city` / `pickup_state` / `pickup_zip` | same |
| `to_city` / `to_state` / `to_zip` | `delivery_city` / `delivery_state` / `destination_zip` | `delivery_city` / `delivery_state` / `delivery_zip` |
| `service_type` | informs `local` | informs `local` |
| `priority` | canonical `granot_priority`; derive `quoted` | same (fields to add) |
| `user` / `rep` | empty-only `receiver_agent` | empty-only `receiver_agent` |
| `estimate` / `payment` / `balance` | store, do not reason | store, do not reason |
| `event_type` | observation kind, not a Lead field | same |

---

## Side-by-side occupancy

Blank means the field is not known at that stage. `—` means the model does not carry it.

| Field | Form ingest | Form after Granot | Call ingest | Call after Granot |
| --- | --- | --- | --- | --- |
| first / last / name | yes | yes | | yes |
| phone | yes | yes | yes | yes |
| email | yes | yes | | yes |
| source company | yes | yes (unchanged) | yes | yes (unchanged) |
| move date | yes | yes | — | — |
| move size | yes | yes (unchanged) | — | — |
| pickup zip | yes | yes | | yes |
| delivery zip | yes (`destination_zip`) | yes | | yes (`delivery_zip`) |
| pickup / delivery state | if found | filled from Granot | | yes |
| pickup / delivery city | | yes | | yes |
| `ref_no` | **yes** | yes | — | ignored |
| `lid` | yes | yes | — | — |
| `job_no` | — | — (on Booking) | | yes |
| `granot_priority` | | canonical (to add) | | canonical (to add) |
| `quoted` | `false` | derived | — today | derived (to add) |
| `cubic_feet` | | yes | | yes |
| `receiver_agent` | | if mapped | | if mapped |
| `booked` | | only if Booking exists | | only if Booking exists |
| `cancelled` | | only if Cancellation exists | | only if Cancellation exists |

---

## Schema additions this document is asking for

These are not implemented by this prototype. They are the field contract the production slice should add when Lead writes from Granot become real.

On **Form Lead** and **Call Lead**:

- `granot_priority` — string, optional, canonical Granot code
- opaque current Granot money if we want them on the Lead: `granot_estimate`, `granot_payment`, `granot_balance` (strings or decimal-as-received, not Vantage Booking money)

On **Call Lead** only:

- `quoted` — boolean derivative, same mapping as Form Lead, once Granot Priority is stored

Until webhooks are wired into the processor, keep writing these facts through the existing extension / HTTP automation enrichment paths, and keep storing the webhook snapshots untouched on `granot_webhook_receipts`.
