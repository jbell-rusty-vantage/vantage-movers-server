---
type: Service
title: Sales Intelligence recording discovery and media (CSI-11)
description: Durable account-scoped recording discovery, deterministic eligibility, bounded private immutable media and honest availability Coverage.
tags: [sales-intelligence, ringcentral, lead-conversation, durable-work]
status: draft
stale_after: 2026-12-17
resource: src/services/salesIntelligence/conversations/discover.ts
applies_to:
  - src/services/salesIntelligence/conversations/**
  - src/services/conversations/streamingMedia.ts
  - src/services/ringcentral/recordings.ts
  - src/services/numberActivity/coverage.ts
owners: [team:main-server]
sources:
  - id: specification
    resource: docs/call-sales-intelligence/03-server-pipeline-and-jobs.md
  - id: handoff
    resource: docs/call-sales-intelligence/workspace/evidence/csi-11/HANDOFF.md
---

# Recording discovery and media

Mongo `sales_intelligence_jobs`, `call_interactions`, `lead_conversations` and the CSI audit stream are authoritative. Private Blob holds immutable audio. This builds on [capture](number-activity-capture.md), [job wiring](sales-intelligence-webhook-fanout.md) and [reads](number-activity-reads.md).

- `conversations/discover.ts`: stage-filtered claim; current interaction from `input_refs[0]`; bounded merge-tombstone resolution with account/cycle checks; account recording upsert, interaction pointer, eligibility, media intent and audit in the fenced completion transaction. Post-commit queue wake-up is best effort. Missing IDs remain pending up to the documented 72-hour observation window; no fabricated conversations.
- `conversations/eligibility.ts`: event-applicable attachments only, valid Lead existence, Attached precedence, exact Call Lead identity limited to that interaction. Owner Number Review, mapped inbound and effective reviewed Sales Rep outbound qualify. Ambiguous context stays number-level. Missing CSI-05/10 inputs are named and undetermined. Internal/company/non-customer exclude automation. No duration, voicemail, Booked/Cancelled or sampling gate. Audited Owner exception is a service-only hook; no process command is implemented.
- `conversations/media.ts`: `media_fetch` claim, live eligibility admission, one metadata/content/Blob unit outside transactions, current eligibility recheck on fenced completion. 404 waits; exhausted window becomes no_recording. 403 waits 24h and projects permission_denied; 429 honors Retry-After/default 10m. Transients dead-letter after eight claims; killed eighth invocations are repaired atomically. Successful evidence is preserved on replay. Only the CSI-12 transcription hook is left.
- `ringcentral/recordings.ts` and `client.ringCentralReadResponse`: shared JWT/401 refresh, fixed account-scoped recording endpoints, response headers and streamed body, no redirect or contentUri following. Provider errors contain only status/retry header.
- `conversations/streamingMedia.ts`: byte-bounded temporary spool with SHA-256, MIME/signature verification, private streaming Blob put at `conversations/{account}/{recording}/{digest}.{extension}`, no overwrite; replay can reuse a matching existing object. Temporary bytes are removed on success/failure. The old seed upload helper is unchanged.
- `coverage.ts`: stored-state capability plus recording availability counters; seeded media cannot prove provider access. GET `/coverage` uses the existing Owner guard and never writes.

`SALES_INTELLIGENCE_MEDIA_ENABLED` defaults off and gates both workers, queue handlers, minute recovery steps and five-minute `/api/cron/sales-intelligence-media-fetch`. `SALES_INTELLIGENCE_MEDIA_MAX_BYTES` defaults 26214400. Shared `CRON_SECRET` and deployment/database job binding apply. No STT reservation, transcript, redaction, LLM, Redis, Lead write, qualification change or production provider operation.

Tests: `pnpm test:csi:media:replica` uses only a disposable loopback replica and synthetic provider/audio fixtures. Pure tests cover policy, streaming validation, provider transport and route/config registration. [Checks](../../call-sales-intelligence/workspace/evidence/csi-11/CHECKS.md) separates implementation evidence from G6: recording access was denied in the September 14 probe; no current grant or live Blob/provider compatibility is claimed.

September 18 review corrections: rediscovery after restored eligibility creates a new media revision only when the preceding intent completed as excluded; concurrent rediscovery shares that successor. Failed/exhausted provider intents do not acquire a fresh retry budget. The recording deadline also bounds waits on shared token acquisition/refresh. An already-started shared token refresh may settle in the background; the timed-out recording invocation performs no subsequent recording fetch.


## Owner media route (S4-CONV, 2026-09-23)

`GET /api/v1/admin/sales-intelligence/conversations/:id/media` (`conversations/ownerMedia.ts`, data spec §6.9) plays a stored recording for the Owner. It is a **server-side Range stream**, not a redirect (DECISIONS 2026-09-23): the blob stays `access: "private"` and its URL or pathname never appears in a DTO, header, error or log.

- Owner guard and master flag as every admin route; `assertTrustedActor(actor, "owner")` again in the service.
- 404 when the conversation is missing, `media.blob_pathname` is null, `media.purged_at` or `content_purged_at` is set, or the Number is purged / purge-pending. 416 (`Content-Range: bytes */{size}`) for an unsatisfiable single range; malformed or multi-range headers are ignored (full 200).
- An audit row `event_kind: "media_played"` (actor, conversation id, Number id, range) is inserted into `sales_intelligence_audit_events` **before** the blob is read. `semantic_key` is `media_played:{conversation}:{actor}:{5-minute window}`, so the several Range requests of one play share one row; a duplicate key streams, any other audit failure stops the read. `invalidation.kind = "number"`, `subject_key = conversation:{id}` (outside every timeline source).
- The blob is read through an injectable `BlobReader`; the default `privateBlobReader` is `@vercel/blob` `get(pathname, {access: "private"})` with the server's `BLOB_READ_WRITE_TOKEN` / `BLOB_STORE_ID` and a forwarded `Range`. Response headers are built by the service only: `Content-Type` (stored audio type, else `application/octet-stream`), `Content-Length`, `Content-Range` on 206, `Accept-Ranges: bytes`, `Cache-Control: private, no-store`, `X-Content-Type-Options: nosniff`, `Content-Disposition: inline`.
- Not verified: Range pass-through against the real private store and a signed-redirect alternative (the legacy `issueConversationAudioUrl` presign helper exists in `services/conversations/media.ts`). Both are operator checks on non-production storage.

Tests: `conversations/ownerMedia.test.ts` (fake reader: 200/206/416/404, audit-before-read, window dedupe, no path in any output); route test in `routes/sales-intelligence-admin.routes.test.ts`; replica `node --import tsx scripts/dev_ops/test-si-conversations.ts`.

## CSI-16 evidence restamp

Current local certification is recorded in [CSI-16 checks](../../call-sales-intelligence/workspace/evidence/csi-16/CHECKS.md) and the [execution matrix](../../call-sales-intelligence/workspace/ACCEPTANCE.md). CSI-15 backfill/retention/budget recovery is landed on main. Fresh synthetic and isolated browser evidence does not certify production grants or deployed revisions. G4 retains the media Retry-After clock failure; G5 remains partial and the generic conversation replay label fails integration. Exact owners are in [GAPS](../../call-sales-intelligence/workspace/evidence/csi-16/GAPS.md). [G6](../../call-sales-intelligence/workspace/evidence/csi-16/G6.md) is not probed. Owner full rollout follows separately in AFTER-16 D+E; no capability was enabled by this restamp.
