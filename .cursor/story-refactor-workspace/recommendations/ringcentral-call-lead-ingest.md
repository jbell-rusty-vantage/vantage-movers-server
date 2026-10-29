# Ringcentral Call Lead Ingest

- Status: recommended; refreshed 2026-10-29.
- Target: `src/services/ringcentral/ringcentral-call-lead-ingest.service.ts`
- Domain evidence: `docs/knowledge/services/ringcentral-call-lead-qualification.md`
- Current exported operations/constants: `ingestRingCentralQualifiedCall`.
- Current exported types: `RingCentralQualifiedCall`, `RingCentralIngestAction`, `RingCentralIngestResult`, `RingCentralIngestDependencies`, `RingCentralIngestLogEntry`.
- Direct import sites found (resolved relative imports): `src/services/dailyOperations/recordDomainFacts.test.ts`, `src/services/ringcentral/call-log-sync.service.test.ts`, `src/services/ringcentral/call-log-sync.service.ts`, `src/services/ringcentral/call-log-vetting.ts`, `src/services/ringcentral/callLeadConvergence.replica.test.ts`, `src/services/ringcentral/callLeadConvergence.service.ts`, `src/services/ringcentral/callLeadConvergence.test.ts`, `src/services/ringcentral/ringcentral-call-lead-ingest.service.test.ts`, `src/services/ringcentral/webhook-call-log-qualification.test.ts`, `src/services/ringcentral/webhook-call-log-qualification.ts`.
- Related tests: `src/services/ringcentral/ringcentral-call-lead-ingest.service.test.ts`

## Current operation and naming boundary

Only final qualified calls from webhook Call Log confirmation or cron enter `ingestRingCentralQualifiedCall`. Check the processed ledger first; only terminal create/adopt/shadow statuses skip. Convergence precedes ordinary duplicate classification; create mode controls mutations, independently of the adoption flag. Create with adoption enabled, and create with a Call Log id but no telephony id, require both processed-ledger identity indexes. Preserve the create/shadow/dry-run priority, canonical create transaction, adoption's atomic ledger, scope-race retry and duplicate-key recovery paths. A conflict is not a technical-failure fallback: failed conflict/ledger work propagates. `dry_run` is reprocessable. Keep injectable log sink as diagnostic logging, and Daily Operations adoption-conflict fact as its own live domain effect; neither is retired Operational Events. Already-landed `beginRingCentralCallLeadIngestion`/`ingestRingCentralCallLead` names are context, not another rename request.

A cleanup preserves public signatures, stored strings, errors, ordering and idempotency. Rename only when the operation becomes clearer; keep current aliases until callers migrate. Do not add effects or change policy. This review inspected code and did not run runtime tests.
