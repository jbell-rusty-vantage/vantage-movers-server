---
okf_version: "0.2"
type: Service
title: Sales Intelligence live invalidations
status: active
tags: [sales-intelligence, outreach]
---

# Sales Intelligence live — CSI-07

`src/services/salesIntelligence/live.ts` watches committed CSI audit and projection collections in the runtime-selected Mongo database. The Owner router registers GET `/api/v1/admin/sales-intelligence/live`, behind the existing v1 API authentication and signed Owner verifier. Omitted/production scope only; ENABLED remains required. This needs replica-set change-stream capability. No new collection, durable queue or domain event writer is introduced.

SSE carries only `{version:1,reason,as_of,refetch:"all"}` under event `invalidation`; reason is connect/reconnect/change/clock. IDs identify a connection/sequence, not a replayable business-event ledger. Last-Event-ID is advisory: every connection requests a full authoritative refetch, so expired/unknown/missed cursors are safe. Mongo's oplog supplies committed audit/projection changes. A 15-second clock invalidation also closes the watch-start race and updates time-only DTOs. Changes coalesce for 250ms; no customer/provider bodies are sent.

The stream ends after 240 seconds so reconnect reauthorizes. Disconnect, source failure, flag disable and backpressure close the watch and timers. Response headers prevent buffering/transformation. No GET starts workers or publishes Attention. Existing `runOutreachEnsureOnce` / minute cron and recovery must run for immutable Attention snapshots; without them the read becomes pending_projection after expiry. Detail derivation is current server time. Production stream capacity/hosting remains Team F validation.

Admin uses its server-only API origin, session refresh and signed identity on a dedicated streaming BFF. Generic JSON proxy preserves CSI envelope as_of/coverage and Idempotency-Key on CSI mutations, denies Admin, rejects non-current/conflicting scope, and never accepts browser credentials as trusted identity. One EventSource invalidates active TanStack queries; reconnect, online/visibility restore and a 30-second visible fallback refetch. URL selection and stable component identity survive updates. No browser rank/clock policy exists.

CSI-08 is a partial read slice: supplied scoped export tokens and adapted Attention/follow-up/ownership presentation; native modal focus containment with host buttons. Optional additive Outreach `primary_number:{id,e164}|null` enables Number navigation (old snapshots remain readable). Missing overview is not called; pending counts stay null. CSI-09 adds the Coverage view and settings editor on the same live invalidation key. Messaging dialogs remain separate.

Local startup and evidence: [CSI-07 handoff](../../call-sales-intelligence/workspace/evidence/csi-07/HANDOFF.md).

CSI-15 preserves this SSE contract. The existing query invalidation/fallback refetch displays the updated stored Coverage backfill facts; no backfill payload or customer content is added to the stream. Capture completion and historical Outreach activation remain distinct facts. CSI-15 validation is synthetic and does not claim production stream/hosting certification; see [CSI-15 checks](../../call-sales-intelligence/workspace/evidence/csi-15/CHECKS.md).


## CSI-16 evidence restamp

Current local certification is recorded in [CSI-16 checks](../../call-sales-intelligence/workspace/evidence/csi-16/CHECKS.md) and the [execution matrix](../../call-sales-intelligence/workspace/ACCEPTANCE.md). CSI-15 backfill/retention/budget recovery is landed on main. Fresh synthetic and isolated browser evidence does not certify production grants or deployed revisions. G4 retains the media Retry-After clock failure; G5 remains partial and the generic conversation replay label fails integration. Exact owners are in [GAPS](../../call-sales-intelligence/workspace/evidence/csi-16/GAPS.md). [G6](../../call-sales-intelligence/workspace/evidence/csi-16/G6.md) is not probed. Owner full rollout follows separately in AFTER-16 D+E; no capability was enabled by this restamp.
