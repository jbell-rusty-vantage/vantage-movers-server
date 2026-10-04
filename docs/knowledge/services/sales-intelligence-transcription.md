---
type: Service
title: "Sales Intelligence transcription (CSI-12)"
description: "Retired by server-admin slimming (2026-10). Budgeted private-media speech-to-text, redaction and immutable transcript versions were removed with the server AI/media pipeline."
tags: [sales-intelligence, lead-conversation, durable-work, retired]
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

# Sales Intelligence transcription (CSI-12) (retired)

CSI-12 transcribed private recordings through the AI Gateway, redacted them and kept immutable transcript versions that fed analysis. The server makes no transcription call (specification §7.1).

## Removed

- The `transcription` job stage, the `transcribe` cron, `SALES_INTELLIGENCE_STT_ENABLED`, `SALES_INTELLIGENCE_STT_MODEL`, `SALES_INTELLIGENCE_STT_CENTS_PER_SECOND` and `AI_GATEWAY_API_KEY` in the server runtime.
- Transcript and audio retention classes (`SALES_INTELLIGENCE_RETENTION_TRANSCRIPT_DAYS`, `SALES_INTELLIGENCE_RETENTION_AUDIO_DAYS`). Retention now purges only Call activity ([sales-intelligence-foundation.md](./sales-intelligence-foundation.md)).

## Still in place

- Nothing in the server transcribes. Future transcription, if any, belongs to a separate MCP/desk contract outside this work.

## Stored data

Transcripts lived on `lead_conversations`, which is in the exclusive drop manifest ([DELETION-MANIFEST.md](../../server-admin-slimming/DELETION-MANIFEST.md)).

## Previous body

The last live version of this Service (with every invariant it described) is in git history: `git show 6a374fab:docs/knowledge/services/sales-intelligence-transcription.md`. Read it as history only.
