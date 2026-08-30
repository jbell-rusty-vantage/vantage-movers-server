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
  - `GET /api/v1/admin/conversations`
  - `GET /api/v1/admin/conversations/by-lead/:model/:id` — no transcript or summary text
  - `GET /api/v1/admin/conversations/:id` — redacted transcript + sectioned summary
  - `GET /api/v1/admin/conversations/:id/audio-url` — short-lived signed URL, audited
- One Owner-seeded inbound Call Lead (`P5562014` / Chris Hughes) replayed from existing artifacts. No new STT or summary call.

## Invariants

- Unique on `{ provider, provider_recording_id }`.
- Raw STT text never reaches Mongo, a log, or disk.
- RingCentral `contentUri` is never stored.
- Summaries never write back to a Lead or Booking.
- Automated discovery, form-lead phone-window matching, and attach/detach remain deferred.

## Seed

```bash
pnpm ops:seed-conversation
pnpm ops:seed-conversation -- --confirm-write --confirm-production=vantagemovers
```
