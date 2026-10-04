---
okf_version: "0.2"
type: Service
title: Sales Intelligence live invalidations
description: Owner-only SSE of committed Numbers and RingCentral Accounts changes, from a Mongo change stream. Topics only; no customer content.
status: active
tags: [sales-intelligence]
resource: src/services/salesIntelligence/live.ts
applies_to:
  - src/services/salesIntelligence/live.ts
  - src/routes/sales-intelligence-admin.routes.ts
owners: [team:main-server]
---

# Sales Intelligence live (CSI-07, slimmed 2026-10)

`src/services/salesIntelligence/live.ts` watches committed changes to the retained Sales Intelligence collections in the runtime-selected Mongo database: `contact_numbers`, `call_interactions`, `number_lead_attachments`, `sales_intelligence_contact_restrictions`, `rep_identity_links`, `owner_rep_nudges`, `sales_intelligence_audit_events`, `sales_intelligence_sync_state` and the two policy collections. It needs replica-set change streams. No new collection, durable queue or domain event writer is introduced, and there is no Redis dependency.

`GET /api/v1/admin/sales-intelligence/live` is Owner-only (`ENABLED`, signed Owner, omitted or `production` scope). The Admin role, a scoped key and a signed rep get 403 `OWNER_REQUIRED`. The `SALES_INTELLIGENCE_LIVE_SSE` flag and the rep topic filter were removed in the 2026-10 slimming.

SSE carries only `{version:2,reason,as_of,refetch:"all",topics:[]}` under event `invalidation`; reason is connect/reconnect/change/clock. `topics` are slugs derived from the changed collection alone (`csiLiveTopic` reads only `ns.coll`): `number` (`contact_numbers`, `call_interactions`), `attachment`, `restriction`, `rep`, `nudge`, and `other` for any other watched collection. Never a document id, phone number or provider body. A connect, reconnect or clock frame carries no topics, so the client resyncs everything. Last-Event-ID is advisory: every connection requests a full authoritative refetch. A 15-second clock invalidation closes the watch-start race and updates time-only DTOs. Changes coalesce for 250 ms.

The stream ends after 240 seconds so reconnect reauthorizes. Disconnect, source failure, flag disable and backpressure close the watch and timers. Response headers prevent buffering/transformation. No GET starts workers.

Admin opens one `EventSource` through its streaming BFF; a version-2 change frame invalidates only the query keys its topics can change, and connect/reconnect/clock/`other` resync the Numbers and Accounts tree. The old Attention, Outreach and analysis topics no longer exist ([slimming specification](../../server-admin-slimming/SPECIFICATION.md) §7).
