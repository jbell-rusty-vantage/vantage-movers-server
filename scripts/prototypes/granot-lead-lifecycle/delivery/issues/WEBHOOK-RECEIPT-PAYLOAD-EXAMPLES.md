# Granot webhook receipt payload examples

**Next agent — model names (do not confuse these):**

- These examples are **raw receipt envelopes** from Mongo collection `granot_webhook_receipts`. That collection was **not** renamed.
- The application model is **`GranotObservationReceipt`** (`src/models/GranotObservationReceipt.ts`) and is retrieved with `getGranotObservationReceiptModel()`. The physical collection remains `granot_webhook_receipts`.
- **`GranotObservation`** (`src/models/GranotObservation.ts`, collection `granot_observations`) is a **different** Unit 04 model: write-once normalized evidence linked by `receipt_id`. It did **not** replace receipts. Do not query `granot_observations` for these payload shapes.

Live shapes from `vantagemovers.granot_webhook_receipts` as of 2026-08-19. Contact fields are redacted. Request headers are omitted (IPs, signatures, tokens).

Granot posts to three Vantage routes. The **document** `event_type` is the route class. The **payload** `event_type` is Granot’s own token and does not always match.

| Route | Document `event_type` | Payload `event_type` | Count |
| --- | --- | --- | ---: |
| `/api/webhooks/granot/lead-created` | `lead_created` | `lead_created` | 345 |
| `/api/webhooks/granot/priority-updated` | `priority_updated` | `priority_update` (no trailing `d`) | 658 |
| `/api/webhooks/granot/booking-status-changed` | `booking_status_changed` | `Booked` | 58 |
| same | `booking_status_changed` | `Releas` (no trailing `e`/`ed`) | 13 |
| same | `booking_status_changed` | `""` empty junk | 4 |

No live `Release`, `Released`, or `priority_updated` payload tokens. Normalization accepts payload `Releas` and `Release` as release; `Released` is unsupported.

## Envelope (every receipt)

```json
{
  "provider": "granot",
  "event_type": "lead_created | priority_updated | booking_status_changed",
  "received_at": "ISO-8601",
  "schema_version": 1,
  "payload_kind": "object",
  "processing_status": "received",
  "processing_attempts": 0,
  "payload": { }
}
```

All payload scalars are strings, including money, CF, priority, and empty fields.

## 1. `lead_created`

No `priority`, `user`, `rep`, `estimate`, `payment`, or `balance`. Sources seen: Best Relocation Forms, TBM Forms, TBM Forms Prime, Top10 Forms, Main Site Forms, Paid Overflow. Service types: Local, Long Distance, INTL.

```json
{
  "event_type": "lead_created",
  "payload": {
    "event_type": "lead_created",
    "job_no": "5562771",
    "service_type": "Local",
    "source": "Best Relocation Forms",
    "ref_no": "<uuid>",
    "first_name": "<redacted>",
    "last_name": "<redacted>",
    "phone_number": "<redacted>",
    "email": "<redacted>",
    "move_date": "08/27/2026",
    "est_cf": "0",
    "from_city": "SAN ANTONIO",
    "from_state": "TX",
    "from_zip": "78228",
    "to_city": "SAN ANTONIO",
    "to_state": "TX",
    "to_zip": "78207"
  }
}
```

## 2. `priority_updated`

Payload token is `priority_update`. Always has `priority`, `user`, `rep`, `estimate`. Never has `payment` or `balance`. `user`/`rep` are often `""`. Priorities seen: `0` `1` `2` `3` `5` `7` `8` `9`. Service types also include AUTO and INTL.

```json
{
  "event_type": "priority_updated",
  "payload": {
    "event_type": "priority_update",
    "job_no": "5562769",
    "service_type": "Long Distance",
    "source": "Best Relocation Forms",
    "ref_no": "<uuid>",
    "priority": "7",
    "user": "",
    "rep": "",
    "first_name": "<redacted>",
    "last_name": "<redacted>",
    "phone_number": "<redacted>",
    "email": "<redacted>",
    "move_date": "08/21/2026",
    "est_cf": "300",
    "from_city": "DUNBAR",
    "from_state": "WV",
    "from_zip": "25064",
    "to_city": "DUNBAR",
    "to_state": "WV",
    "to_zip": "25064",
    "estimate": "1145.76"
  }
}
```

## 3. `booking_status_changed` — `Booked`

Always has `priority`, `user`, `rep`, `estimate`, `payment`, `balance`. Service types seen: Long Distance, AUTO. Priorities seen: `0` `1` `5`.

```json
{
  "event_type": "booking_status_changed",
  "payload": {
    "event_type": "Booked",
    "job_no": "5562128",
    "service_type": "Long Distance",
    "source": "Top10 Forms",
    "ref_no": "Mob_<token>",
    "priority": "5",
    "user": "<rep>",
    "rep": "<rep>",
    "first_name": "<redacted>",
    "last_name": "<redacted>",
    "phone_number": "<redacted>",
    "email": "<redacted>",
    "move_date": "08/28/2026",
    "est_cf": "335",
    "from_city": "NORTH ROYALTON",
    "from_state": "OH",
    "from_zip": "44133",
    "to_city": "MEMPHIS",
    "to_state": "TN",
    "to_zip": "38103",
    "estimate": "3295.00",
    "payment": "942.00",
    "balance": "2353.00"
  }
}
```

## 4. `booking_status_changed` — `Releas`

Same field set as Booked. Live token is `Releas`, not `Release` or `Released`. All 13 current rows are Long Distance.

```json
{
  "event_type": "booking_status_changed",
  "payload": {
    "event_type": "Releas",
    "job_no": "5562128",
    "service_type": "Long Distance",
    "source": "Top10 Forms",
    "ref_no": "Mob_<token>",
    "priority": "5",
    "user": "<rep>",
    "rep": "<rep>",
    "first_name": "<redacted>",
    "last_name": "<redacted>",
    "phone_number": "<redacted>",
    "email": "<redacted>",
    "move_date": "08/28/2026",
    "est_cf": "335",
    "from_city": "NORTH ROYALTON",
    "from_state": "OH",
    "from_zip": "44133",
    "to_city": "MEMPHIS",
    "to_state": "TN",
    "to_zip": "38103",
    "estimate": "3295.00",
    "payment": "942.00",
    "balance": "2353.00"
  }
}
```

The Booked and Releas examples above are the same Job a few minutes apart (`Releas` first, then `Booked`). Field values were identical except `payload.event_type`.

## Empty booking payload (4 rows)

Same booking field keys, all empty/`0.00`. Routed as `booking_status_changed` because of the URL, not because Granot sent a status.

```json
{
  "event_type": "booking_status_changed",
  "payload": {
    "event_type": "",
    "job_no": "",
    "service_type": "",
    "source": "",
    "ref_no": "",
    "priority": "",
    "user": "",
    "rep": "",
    "first_name": "",
    "last_name": "",
    "phone_number": "",
    "email": "",
    "move_date": "          ",
    "est_cf": "",
    "from_city": "",
    "from_state": "",
    "from_zip": "",
    "to_city": "",
    "to_state": "",
    "to_zip": "",
    "estimate": "0.00",
    "payment": "0.00",
    "balance": "0.00"
  }
}
```

## Field presence

| Payload key | lead_created | priority_updated | Booked / Releas |
| --- | :---: | :---: | :---: |
| `event_type` | yes | yes (`priority_update`) | yes |
| `job_no` `source` `ref_no` `service_type` | yes | yes | yes |
| contact + move + CF + from/to | yes | yes | yes |
| `priority` `user` `rep` | no | yes | yes |
| `estimate` | no | yes | yes |
| `payment` `balance` | no | no | yes |

`ref_no` is a UUID on form-created leads and a `Mob_…` token on some booked/released Jobs. `move_date` is `MM/DD/YYYY`. Cities are uppercase. Money is a decimal string.
