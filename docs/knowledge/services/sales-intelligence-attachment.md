---
okf_version: "0.2"
type: Service
title: Number↔Lead attachment
status: active
tags: [sales-intelligence, attachment]
---

# Number↔Lead attachment — CSI-05

Server implementation: `src/services/salesIntelligence/attachment/`. Authoritative rules: [01 §5.2](../../call-sales-intelligence/01-specification.md#52-numberlead-attachment). [Handoff](../../call-sales-intelligence/workspace/evidence/csi-05/HANDOFF.md).

`suggest.ts` is pure. Phone equality is Likely. Form Lead windows are −36h/+14d; Call Lead windows ±12h. Mutable live/Granot evidence cannot begin before its observed change; immutable ingested/original-caller evidence retains the Lead window. Exact evidence pins provider account, alias and interaction, including RingCentral Call Adoption. Outbound caller ID never supplies advertiser attribution.

`resolveAtInteraction` selects event-applicable evidence. Exact evidence authorizes its interaction only; later phone evidence remains Likely. One applicable Attached edge outranks candidates; competing Attached edges block Lead effects. Number-level Ambiguous chips do not turn independent historical moves into a lifetime identity block.

`refresh.ts` scans at most 500 sources per cron (200 Form Leads, 200 Call Leads, 100 Contact Numbers), with `(updatedAt,_id)` checkpoints, lease `attachment_suggest`, and durable jobs committed with cursor advancement. Contact Number repair scans only enqueue for numbers without edges. New-number capture jobs use B's existing interaction reference. Number scans use 250-Lead keyset pages per model so phone normalization also works for snapshot phone formatting without creating Contact Numbers. Each worker claims only `attachment_refresh`, reloads current documents and fences completion transactionally. Queue wake-ups contain only `{job_id}`. Five-minute cron and minute recovery are registered.

Pair uniqueness and Contact Number transaction serialization prevent concurrent different-pair write skew. Refresh preserves Attached state, rejected pairs and every reviewed edge; it appends evidence/history and refreshes display snapshots only for unreviewed pairs. Duplicate refresh leaves the pair and number unchanged. Owner commands use the trusted actor, command ledger, revision checks and CSI audit. Detach retains evidence/history, suppresses prior exact/Owner authority and re-evaluates remaining phone evidence. No EntityChange origin writes, Lead/Booking writes or Outreach state writes exist here.

`onAttachmentChanged` records a durable fan-out intent. Its worker schedules new revision-specific CSI-11 `recording_discovery` jobs in pages of 500. CSI-06 owns any future Outreach change consumer. GET list/filter never refreshes snapshots or writes. E consumes certainty labels and evidence windows from the attachment DTO; D consumes event attribution, never lifetime attachment counts.

Flags: `ATTACHMENT_REFRESH` defaults off; Owner commands also require `ENABLED`. No STT or media flag changes. Additive nullable evidence and scan-cursor fields require no data migration or new index; existing CSI-01 unique indexes remain mandatory. Rollback: keep attachment refresh off, preserving edges/history/jobs. Runtime accesses the existing TEST_MODE database boundary. Tests use a randomized loopback replica database and synthetic 555-01xx numbers, never live providers.

Limitations: initial number scans traverse Leads in bounded durable pages; production volume/performance and flag enablement remain rollout work. Legacy exact rows without pinned fields retain a read-only compatibility path in CSI-11; all new CSI-05 exact evidence is pinned. Reviewed display snapshots intentionally remain frozen along with reviewed evidence. Official reconciliation stays in existing workflows.
