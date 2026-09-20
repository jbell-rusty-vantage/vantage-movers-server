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
