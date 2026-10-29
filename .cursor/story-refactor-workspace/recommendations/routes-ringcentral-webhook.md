# Capture RingCentral deliveries and wake final Call Log qualification

- Status: recommended; source-verified 2026-10-29.
- Target: `src/routes/ringcentral-webhook.routes.ts`
- Domain: `docs/knowledge/services/ringcentral-call-lead-qualification.md`, `docs/knowledge/services/sales-intelligence-webhook-fanout.md`.
- Evidence: `src/services/ringcentral/webhook-verification.ts`, `src/services/ringcentral/webhook-call-log-qualification.ts`, `src/services/ringcentral/call-log-vetting.ts`, `src/app.ts`.

## Current operations and important seams

`app.ts` mounts this router before v1. GET `/api/webhooks/ringcentral` reports readiness. POST echoes Validation-Token when present, but delivery verification is separate: a stored subscription token must match Verification-Token. Refused delivery records a bounded refusal and returns 403 `verification_failed` before receipt storage/fan-out. Lookup failure currently accepts using no_token_on_record; do not silently change that posture in a rename.

Accepted POST captures the receipt and awaits Number Activity capture-projection fan-out; durable message-store receipts may also fan out rep-SMS intent. These effects occur independently of the RingCentral qualification flag. Flag-off acknowledges 200 after capture/fan-out and skips candidate/session work. Capture's non-durable result is not an Operational Events write and must keep its receiptId semantics.

When enabled, normalize/enrich parties with call-start route attribution, upsert candidates, rebuild each touched telephony session and record decision transitions. A mapped session whose age is at least 120 seconds and whose incoming events include Disconnected/Gone/Finished/Voicemail/Missed/NoCall wakes `qualifyWebhookCallFromCallLog`. This does not require diagnostic `ingestEligible`, and never calls shared ingest directly. The qualifier queries exact session Detailed Call Log, refuses incomplete pagination or anything except exactly one qualified finished parent, then calls the shared gate. Party status and age are wake criteria; final parent completion and precise duration are authority. There is no optional validation bypass.

`ingestSessionLead` catches qualifier failure, logs `ringcentral.webhook.ingest_failed` and returns the ingest_failed diagnostic action. Outer processing failure acknowledges 200 with `storedRawEvent: false` and warning even if receipt capture had succeeded; preserve that existing response discrepancy until a separate behavior decision. Candidate/session persistence skips absent Mongo configuration, while enrichment can still attempt Registry reads.

## Operator reads and remaining cleanup

Debug GETs expose receipts, candidate/decision/session/processed evidence and config. `requireRingCentralDebugAccess` opens non-production hosts; production requires x-debug-token and hides refusal as 404 “Not found”. Keep list clamping and safe projections. Debug reads, subscription delivery verification, capture, preview projection and final Call Log wake are distinct adapter seams; use names that reveal those operations without merging qualification policy into the router.

Preserve the existing default Router export, response statuses, subscription-token handling and lookup-failure behavior. Keep candidate/session previews diagnostic, current receipt/fan-out effects and final shared-vetter refusal. The focused final-record suite is `src/services/ringcentral/webhook-call-log-qualification.test.ts`; source inspection is not HTTP/provider execution proof. This review ran no runtime tests or provider calls.
