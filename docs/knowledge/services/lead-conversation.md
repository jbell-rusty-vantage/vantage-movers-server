---
type: Service
title: "Lead Conversation"
description: "Retired by server-admin slimming (2026-10). Durable telephone-conversation evidence (private recording pointer, redacted transcript, sectioned summary) was removed with the server AI/media pipeline."
tags: [lead-conversation, ringcentral, owner, retired]
status: retired
retired_on: 2026-10-04
resource: docs/server-admin-slimming/SPECIFICATION.md
applies_to: []
owners: [team:main-server]
sources:
  - id: retirement
    resource: docs/server-admin-slimming/SPECIFICATION.md
    title: Server and Admin slimming specification
  - id: ledger
    resource: docs/server-admin-slimming/LEDGER.md
    title: Slimming execution ledger
generated:
  by: process:docs-keeper
  at: 2026-10-04T00:00:00Z
---

**Status: retired.** Retired by server-admin slimming (2026-10). Contract: [slimming specification](../../server-admin-slimming/SPECIFICATION.md). Execution record: [ledger](../../server-admin-slimming/LEDGER.md). Do not build on this capability; nothing in `src/` implements it any more.

# Lead Conversation (retired)

A Lead Conversation stored a private copy of a call recording, a redacted transcript and a sectioned summary against a Form Lead or Call Lead. The Owner removed the conversation surface and every server-owned AI/media step (specification §7.1–7.2).

## Removed

- Model `LeadConversation` (`lead_conversations`), `src/services/conversations/**`, `src/services/salesIntelligence/conversations/**` and `src/config/domain/conversations.ts`.
- Owner routes `/api/v1/admin/conversations*` (playback, audio URLs, transcripts); they return 404. The Admin `/conversations` page is gone.
- Server-owned audio in Vercel Blob under `conversations/` and the `ops:seed-conversation` / `ops:blob-upload-mp3` / `ops:transcribe-*` scripts.
- `call_interactions.recordings[].lead_conversation_id` (the pointer into the dropped collection).

## Still in place

- Provider recording metadata on `call_interactions.recordings[]` (id, uri, duration). RingCentral keeps its own recordings; the server never downloads them.
- Number Activity reads and timelines ([number-activity-reads.md](./number-activity-reads.md)) show calls without transcript, summary or playback.

## Stored data

`lead_conversations` and the `conversations/` Blob objects are in the exclusive drop manifest ([DELETION-MANIFEST.md](../../server-admin-slimming/DELETION-MANIFEST.md)). They are deleted once, after the slim server is deployed and quiesced, from a verified backup.

## Previous body

The last live version of this Service (with every invariant it described) is in git history: `git show 6a374fab:docs/knowledge/services/lead-conversation.md`. Read it as history only.
