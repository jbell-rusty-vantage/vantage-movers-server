# RingCentral cron idempotency — "belt & suspenders" hardening (future)

**Status:** not implemented. Current design is sound for standard RingCentral
`view=Detailed` Call Log payloads (they include `telephonySessionId`). This note
captures the optional extra hardening to add later if we ever see edge-case
double leads.

## Current idempotency (already in place)

A qualified call → `ingestRingCentralQualifiedCall`, which dedups in 3 layers:

1. **Ledger pre-check** — `ringcentral_processed_calls.findProcessedCall()` does an
   `$or` on `telephonySessionId` **and** `callLogId`; an already-processed call
   returns `skipped_already_processed`. This absorbs the cron's intentional
   15-min overlap re-scans.
2. **Ledger unique index** — unique sparse on `telephonySessionId` (write-race safety).
3. **`call_leads` unique index** — unique sparse on
   `ringcentral.telephony_session_id` (hard DB guarantee, cross-path).

Webhook and cron both set the **same** `telephonySessionId`, so whichever path
fires first wins; the other is skipped (Layer 1) or rejected by the DB (Layer 3).

## The gap this hardening closes

The cross-path guarantee depends on the Call Log record carrying a
`telephonySessionId`:

- **Present (normal):** full webhook ↔ cron idempotency works.
- **Absent but `callLogId` present:** cron↔cron dedup still works (ledger `$or`
  on `callLogId`), but it can't match a webhook-created lead (webhooks have no
  `callLogId`, and the `call_leads` unique index is *sparse* on a null session
  id, so it won't fire). In that scenario one webhook lead + one cron lead could
  be created for the same call.

## Proposed hardening (when we do it)

1. **Secondary unique sparse index on `call_leads`** for `ringcentral.call_log_id`:

   ```ts
   CallLeadSchema.index(
     { "ringcentral.call_log_id": 1 },
     { unique: true, sparse: true },
   );
   ```

   Catches a cron re-insert keyed by call-log id even when the session id is missing.

2. **Cron-side fallback dedup key** in `ringcentral-duplicate-guard` /
   `processed-calls-store` when `telephonySessionId` is null: synthesize a stable
   key from `sourceCompany + normalizedCallerPhone + normalizedTarget + startTime`
   (rounded to the second) and check it before insert. This bridges webhook↔cron
   when neither shared id is available.

3. **Ingest insert guard** — wrap `createRingCentralCallLead` so a Mongo
   duplicate-key error (code `11000`) on any of the unique indexes is caught and
   converted to a `skipped_already_processed` outcome instead of throwing, so the
   DB index becoming the actual arbiter is a clean no-op rather than an error.

## Acceptance check

- Simulate a call-log record with no `telephonySessionId` already turned into a
  lead by the webhook → cron run must `skip`, not create a second lead.
- Re-run cron over the same overlap window twice → zero new leads.
