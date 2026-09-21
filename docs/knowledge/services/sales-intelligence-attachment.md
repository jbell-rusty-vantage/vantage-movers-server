---
okf_version: "0.2"
type: Service
title: Number↔Lead attachment
status: active
tags: [sales-intelligence, attachment]
---

# Number↔Lead attachment — CSI-05

CSI-08 Owner integration: attachment reads expose gate-aware attach/reject/detach availability with the edge revision. Filters may combine Number and Lead to read one exact pair. Absent-pair confirmation uses the displayed Number revision; its audit prior is `{state:"unlinked"}` so required audit validation does not roll back the first attachment. Durable replay returns the original result and no official Lead phone is changed. Number detail exposes the corresponding gate-aware `attach_lead` availability for manual selection. Search itself remains read-only.

Server implementation: `src/services/salesIntelligence/attachment/`. Authoritative rules: [01 §5.2](../../call-sales-intelligence/01-specification.md#52-numberlead-attachment). [Handoff](../../call-sales-intelligence/workspace/evidence/csi-05/HANDOFF.md).

`suggest.ts` is pure. Phone equality is Likely. Form Lead windows are −36h/+14d; Call Lead windows ±12h. Mutable live/Granot evidence cannot begin before its observed change; immutable ingested/original-caller evidence retains the Lead window. Exact evidence pins provider account, alias and interaction, including RingCentral Call Adoption. Outbound caller ID never supplies advertiser attribution.

`resolveAtInteraction` selects event-applicable evidence. Exact evidence authorizes its interaction only; later phone evidence remains Likely. One applicable Attached edge outranks candidates; competing Attached edges block Lead effects. Number-level Ambiguous chips do not turn independent historical moves into a lifetime identity block.

`refresh.ts` scans at most 500 sources per cron (200 Form Leads, 200 Call Leads, 100 Contact Numbers), with `(updatedAt,_id)` checkpoints, lease `attachment_suggest`, and durable jobs committed with cursor advancement. Contact Number repair scans only enqueue for numbers without edges. New-number capture jobs use B's existing interaction reference. Number scans use 250-Lead keyset pages per model so phone normalization also works for snapshot phone formatting without creating Contact Numbers. Each worker claims only `attachment_refresh`, reloads current documents and fences completion transactionally. Queue wake-ups contain only `{job_id}`. Five-minute cron and minute recovery are registered.

Pair uniqueness and Contact Number transaction serialization prevent concurrent different-pair write skew. Refresh preserves Attached state, rejected pairs and every reviewed edge; it appends evidence/history and refreshes display snapshots only for unreviewed pairs. Duplicate refresh leaves the pair and number unchanged. Owner commands use the trusted actor, command ledger, revision checks and CSI audit. Detach retains evidence/history, suppresses prior exact/Owner authority and re-evaluates remaining phone evidence. No EntityChange origin writes, Lead/Booking writes or Outreach state writes exist here. The Outreach `lead_attachment` mirror is CSI-06's same-transaction reaction; this Service only folds the deciding edge into the committed change CSI-06 already watches.

`persistLeadAttachments` is the write path: lock the Contact Number, append evidence, run `fanInNumber`, then `autoAttachNumber`, then rebuild search terms and `onAttachmentChanged`. `autoAttachConfidence(edge, edges)` in `suggest.ts` stays pure. It returns `0.90` for one qualifying windowed `lead_phone_live` / `ringcentral_original_caller` source, `0.95` when two or more of those sources agree on the same Lead, and `null` otherwise — no third tier. An Owner `decided_at`, a rejected pair, a competing Attached edge, an exact-source edge, and anything `ambiguityFanIn` would call Ambiguous stay Candidate. `autoAttachNumber` in `store.ts` is flag-gated (`AUTO_ATTACH`, default off): it writes Attached/Likely with `decision_reason` `automatic_high_confidence` and an `auto_decision` record — not Exact and not Confirmed by you. Edge `decided_at` stays the Owner's immutable decision, so automatic attach remains revisable; `reject_attachment` and `detach_attachment` remain the reversal, and a rejected pair never resurrects.

`onAttachmentChanged` records a durable fan-out intent and invokes CSI-06's identity/official-closure reaction inside the same transaction when Outreach is enabled. Its worker schedules new revision-specific CSI-11 `recording_discovery` and CSI-06 `outreach_ensure` jobs in pages of 500. GET list/filter never refreshes snapshots or writes. E consumes certainty labels and evidence windows from the attachment DTO; D consumes event attribution, never lifetime attachment counts.

Flags: `ATTACHMENT_REFRESH` and `AUTO_ATTACH` default off; Owner commands also require `ENABLED`. Automatic attach is not enabled. No STT or media flag changes. Additive nullable evidence and scan-cursor fields require no data migration or new index; existing CSI-01 unique indexes remain mandatory. Rollback: keep attachment refresh off, preserving edges/history/jobs. Runtime accesses the existing TEST_MODE database boundary. Tests use a randomized loopback replica database and synthetic 555-01xx numbers, never live providers.

Limitations: initial number scans traverse Leads in bounded durable pages; production volume/performance and flag enablement remain rollout work. Legacy exact rows without pinned fields retain a read-only compatibility path in CSI-11; all new CSI-05 exact evidence is pinned. Reviewed display snapshots intentionally remain frozen along with reviewed evidence. Official reconciliation stays in existing workflows.
