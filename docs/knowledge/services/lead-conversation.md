---
type: Service
title: Lead Conversation
description: Durable telephone-conversation evidence attached to a Form Lead or Call Lead, with a private recording pointer, redacted transcript, and sectioned summary.
tags: [lead-conversation, ringcentral, owner]
status: draft
stale_after: 2026-11-27
resource: src/models/LeadConversation.ts
applies_to:
  - src/models/LeadConversation.ts
  - src/services/conversations/**
  - src/services/salesIntelligence/analysis/ownerConversations.ts
  - src/routes/conversations-admin.routes.ts
  - scripts/conversations/seed-known-conversation.ts
  - scripts/migrations/lead-conversation-indexes.ts
owners: [team:main-server]
sources:
  - id: glossary
    resource: ../CONTEXT.md
    title: Platform glossary
  - id: spec
    resource: ../../docs/granot-lead-lifecycle/owner-daily-operations-view-specification.md
generated:
  by: agent
  at: 2026-08-27T15:40:00Z
---
**Platform glossary:** [`../../../../CONTEXT.md`](../../../../CONTEXT.md)  
**Primary code:** `src/models/LeadConversation.ts`, `src/services/conversations/`  
**Domain terms used:** [Lead Conversation](../../../../CONTEXT.md), [Conversation Match](../../../../CONTEXT.md), [Call Lead](../../../../CONTEXT.md), [Form Lead](../../../../CONTEXT.md), [Booking](../../../../CONTEXT.md)

# Lead Conversation

**System of record:** MongoDB `lead_conversations`. Audio bytes live in a private Vercel Blob object. The Lead and Booking are not mutated.

A Lead Conversation is evidence of one telephone conversation matched to a Form Lead or a Call Lead. It is not a Call Lead field and not a Booking field. The join is `lead_ref`; `booking_ref` is denormalized when a Booking exists.

## Shipped now

- Model and seven indexes (`pnpm migration:conversations:indexes`).
- Deterministic redaction before persistence (`redactTranscript`).
- Owner-only reads:
  - `GET /api/v1/admin/conversations` — optional `q`, `direction`, `state`, `booked`, `has_transcript`, `limit`; no transcript or summary text
  - `GET /api/v1/admin/conversations/by-lead/:model/:id` — no transcript or summary text
  - `GET /api/v1/admin/conversations/:id` — redacted transcript + sectioned summary
  - `GET /api/v1/admin/conversations/:id/audio-url` — short-lived signed URL, audited
- Admin `/conversations` lists searchable rows. The Owner-seeded inbound Call Lead (`P5562014`) remains a seed path, not the tab chrome.

## Sales Intelligence Owner reads (S4-CONV, 2026-09-23)

`analysis/ownerConversations.ts` serves the Analysis page's Conversations section (data spec §6.7–6.8, final spec §11.7). Owner-only, GET-only, no model call.

- `GET /api/v1/admin/sales-intelligence/numbers/:id/conversations?cursor&limit=50` (max 100): keyset on `(started_at desc, _id desc)` over canonical `call_interactions` (`merged_into_id: null, purged_at: null`, `call_interaction_number_started_id`). Each call whose `recordings[].lead_conversation_id` resolves is a card; the rest of the page are `other_calls` (direction, time, duration, provider result, contact type). One read each per page: Number, calls, `lead_conversations` `$in`, step-1 summary snapshots (one `$group`/`$topN` aggregate), transcript snapshots (`$in` on `csi_evidence_transcript_unique`), Rep Identity Links. 404 for a missing, purged or purge-pending Number.
- Card: header facts with server labels (`started_at_label` in ET, `direction_label`, `contact_type_label`, rep name only when the link is reviewed at the call time); `recording_state` `available` (stored, not purged) / `audio_removed` (`media.purged_at`) / `not_recorded`; `recording_label`; `media_available` (boolean, never a URL); `transcript_available` (a retained snapshot for `latest_transcript_version`); `run_id = latest_completed_run_id`.
- Summary: the six sections `overview, customer_wanted, money_and_dates, outcome, commitments, discrepancies` with the S3-PRES labels, from the **step-1 canonical summary snapshot** (newest `source_type: "summary"` row matching the current transcript version, else the newest: the `prior.ts` selection), `summary_source: "call_summary"`. Only when no step-1 snapshot exists: `summary_source: "legacy"` from `LeadConversation.summary.sections` (`money_dates → money_and_dates`, `promised → commitments`, `mismatch → discrepancies`; a text-only legacy summary reads as the overview). `LeadConversation.summary` is otherwise never shown on the card (it is the findings step's synthesis). Content purge hides both. Every text is redacted.
- `GET /api/v1/admin/sales-intelligence/conversations/:id/transcript?offset=0&limit=100` (max 100): the Owner mirror of the worker's `get_call_transcript`: current `latest_transcript_version` snapshot, `$slice` of `segments`, redacted text, `sid` (what `Open in transcript` highlights), `speaker_label` (`Rep` / `Customer` / `Speaker unknown`), `at` = conversation `started_at` + `start_ms`, `completeness.missing_ranges` plus `segments_before:{n}` / `segments_after:{n}`. A purged-audio conversation keeps its transcript. No snapshot, content purge or retention pending → `available: false` with `transcript_unavailable` / `retention_pending`; offset past the end → 400.
- Media: [recording media](sales-intelligence-recording-media.md#owner-media-route-s4-conv-2026-09-23).

Tests: `analysis/ownerConversations.test.ts`; replica `node --import tsx scripts/dev_ops/test-si-conversations.ts` (DB `testvantagemovers_s4conv`).

## Invariants

- Unique on `{ provider, provider_account_id, provider_recording_id }` after CSI-01's verified legacy-account migration.
- Raw STT text never reaches Mongo, a log, or disk.
- RingCentral `contentUri` is never stored.
- Summaries never write back to a Lead or Booking.
- [CSI-11 discovery/media](sales-intelligence-recording-media.md) consumes Call Interaction recording IDs. [CSI-12 transcription](sales-intelligence-transcription.md) adds redacted immutable versions, transcript segments and durable analysis intent with flags off. Attachment writes and analysis execution remain downstream. Seed paths remain playable and are never overwritten. Unreported STT billing is nullable in the server read DTO rather than represented as zero or an estimate.

## Seed

```bash
pnpm ops:seed-conversation
pnpm ops:seed-conversation -- --confirm-write --confirm-production=vantagemovers
```
