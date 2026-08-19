# Vercel Blob planned uses (`vantage-stores`)

Store: **vantage-stores** (private, iad1). Reconfigurable later.
SDK: `@vercel/blob`. Auth: `BLOB_READ_WRITE_TOKEN` (store-scoped). Optional
`BLOB_STORE_ID` / `BLOB_STORE_NAME`.

This is a plan, not a runtime contract. No product write path uses Blob yet.
The MP3 spike lives in gitignored `scripts/dev_ops/blob/`.

## 1. Granot webhook receipt payload eviction — later

**Do not implement now.** Finish the in-flight `granot_webhook_receipts`
migration first. Collection name stays `granot_webhook_receipts`
(`GranotObservationReceipt`).

As of 2026-08-18 on `vantagemovers`:

| | |
| --- | --- |
| Documents | 1,078 |
| Collection data | 3.46 MB |
| Average document | ~3.4 KB |
| Max document | ~3.5 KB |
| Routes | `priority_updated` 658, `lead_created` 345, `booking_status_changed` 75 |

The problem is unbounded growth, not today's size. Every authenticated Granot
delivery stores `payload` (+ allowlisted headers) forever. Volume will keep
climbing as capture stays on.

### Intended shape (when we do it)

Keep a thin Mongo receipt for work-state and identity:

- `_id`, channel / route / operation id
- `payload_sha256` and processing fields
- `captured_at`
- a Blob pointer (`store`, pathname, content type, bytes, uploaded_at)

Move the bulky JSON (`payload`, maybe headers) to a private blob, e.g.

`receipts/granot/{yyyy}/{mm}/{receiptId}.json`

Then, later still, evict old blobs themselves once we no longer need the raw
delivery. Do not drop the Mongo receipt while processing / replay still needs
it. Do not rename the collection.

## 2. RingCentral call recordings on Leads — this spike, then product

Call Leads already store RingCentral **metadata** (`call_log_id`,
`telephony_session_id`, duration). They do not store audio. Resolve the
recording from the Call Log, download the MP3, put it in Blob, then store a
**pointer on the Lead**.

Suggested pathname:

`ringcentral/call-leads/{callLeadId}/recordings/{recordingId}.mp3`

plus a sidecar `.json` until/unless the Lead document holds the same fields.

`put()` has no custom metadata map. Identity belongs in the pathname and on
the Lead. Keep blobs **private**. Serve through an authenticated route (or a
short-lived signed URL). Do not put public recording URLs on Leads.

Form Leads have no RingCentral ids. Attach via the matching Call Lead (phone /
same customer), or store the same pointer on both once matching exists.

The local proof uses the booked Call Lead for job `P5562344`
(`callLeadId` `6a7cb4b6046a197560a0ccca`, recording `3756263468023`).
It does **not** write Mongo.

Server-side `put()` from this Node process is fine for multi-MB recordings.
A Vercel Function that first receives the file is capped at 4.5 MB — do not
proxy large MP3s through a Function body.

## 3. Not named yet

A third Blob use was mentioned and is still open. Do not invent one.

## Reconfigure later

Store name, path prefixes, `dev-ops/` vs production prefixes, and whether
sidecars stay as blobs or move onto Mongo pointers can all change. Keep
`access: 'private'` unless a future use is actually public.
