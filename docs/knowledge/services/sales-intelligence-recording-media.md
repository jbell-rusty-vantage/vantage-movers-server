---
type: Service
title: "Sales Intelligence recording discovery and media (CSI-11)"
description: "Retired by server-admin slimming (2026-10). Account-scoped recording discovery, private immutable media and media availability Coverage were removed with the server media pipeline."
tags: [sales-intelligence, ringcentral, lead-conversation, durable-work, retired]
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

# Sales Intelligence recording discovery and media (CSI-11) (retired)

CSI-11 discovered RingCentral recordings per account, fetched them into private Blob storage and reported media availability. The server no longer stores or plays audio (specification §7.1–7.2).

## Removed

- Job stages `recording_discovery`, `media` and `media_fetch`, the `media-fetch` cron and `SALES_INTELLIGENCE_MEDIA_ENABLED` / `SALES_INTELLIGENCE_MEDIA_MAX_BYTES`.
- The `call_interactions.recording_discovery` sub-document and the `call_interaction_discovery_state` index declaration.
- Blob credentials in the server runtime (`BLOB_STORE_ID`, `BLOB_STORE_NAME`). `BLOB_READ_WRITE_TOKEN` is read only by the one-time purge tool (`ops/slimming`).

## Still in place

- Provider recording ids and metadata on `call_interactions.recordings[]`; recording counts in the Number rollups.
- RingCentral's own recordings are never deleted by Vantage.

## Stored data

Server-owned audio objects under `conversations/` (keys referenced by `lead_conversations.media.blob_pathname` plus pending deletes recorded on completed `media_fetch` jobs) are in the Blob section of [DELETION-MANIFEST.md](../../server-admin-slimming/DELETION-MANIFEST.md). The purge unsets `recording_discovery` on retained `call_interactions`.

## Previous body

The last live version of this Service (with every invariant it described) is in git history: `git show 6a374fab:docs/knowledge/services/sales-intelligence-recording-media.md`. Read it as history only.
