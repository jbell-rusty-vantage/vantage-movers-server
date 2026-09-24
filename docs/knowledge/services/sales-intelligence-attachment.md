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

`refresh.ts` scans at most 500 sources per cron (200 Form Leads, 200 Call Leads, 100 Contact Numbers), with `(updatedAt,_id)` checkpoints, lease `attachment_suggest`, and durable jobs committed with cursor advancement. The watermark only orders the scan: since September 21, 2026 the `attachment-lead:` job key is `leadAttachmentFingerprint(lead)` (`sources.ts`), a hash of every input `persistLeadAttachments` can turn into a write — the phone paths `phoneEvidence` reads with their observation times, the RingCentral aliases `exactEvidence` joins on, and the display snapshot — never `updatedAt`. A Lead edit that touches none of those (a note, a CPL correction, a sheet-sync stamp) raises no job; a phone, snapshot, alias or official-flag change still does ([17 §7](../../call-sales-intelligence-new/17-storage-throughput-and-llm-efficiency-handoff.md)). Contact Number repair scans only enqueue for numbers without edges. New-number capture jobs use B's existing interaction reference. Number scans use 250-Lead keyset pages per model so phone normalization also works for snapshot phone formatting without creating Contact Numbers. Each worker claims only `attachment_refresh`, reloads current documents and fences completion transactionally. Queue wake-ups contain only `{job_id}`. Five-minute cron and minute recovery are registered.

Pair uniqueness and Contact Number transaction serialization prevent concurrent different-pair write skew. Refresh preserves Attached state, rejected pairs and every reviewed edge; it appends evidence/history and refreshes display snapshots only for unreviewed pairs. Duplicate refresh leaves the pair and number unchanged. Owner commands use the trusted actor, command ledger, revision checks and CSI audit. Detach retains evidence/history, suppresses prior exact/Owner authority and re-evaluates remaining phone evidence. No EntityChange origin writes, Lead/Booking writes or Outreach state writes exist here. The Outreach `lead_attachment` mirror is CSI-06's same-transaction reaction; this Service only folds the deciding edge into the committed change CSI-06 already watches.

`persistLeadAttachments` is the write path: lock the Contact Number, append evidence, run `fanInNumber`, then `autoAttachNumber`, then rebuild search terms and `onAttachmentChanged`. *(The automatic rule in the rest of this paragraph is superseded by [H5](#h5-september-22-sole-match-automatic-attach) below; `autoAttachConfidence` was removed.)* `autoAttachConfidence(edge, edges)` in `suggest.ts` stays pure. It returns `0.90` for one qualifying windowed `lead_phone_live` / `ringcentral_original_caller` source, `0.95` when two or more of those sources agree on the same Lead, and `null` otherwise — no third tier. An Owner `decided_at`, a rejected pair, a competing Attached edge, an exact-source edge, and anything `ambiguityFanIn` would call Ambiguous stay Candidate. `autoAttachNumber` in `store.ts` is flag-gated (`AUTO_ATTACH`, default off): it writes Attached/Likely with `decision_reason` `automatic_high_confidence` and an `auto_decision` record — not Exact and not Confirmed by you. Edge `decided_at` stays the Owner's immutable decision, so automatic attach remains revisable; `reject_attachment` and `detach_attachment` remain the reversal, and a rejected pair never resurrects.

`onAttachmentChanged` records a durable fan-out intent and invokes CSI-06's identity/official-closure reaction inside the same transaction when Outreach is enabled. Its worker (`rediscoverAttachmentPage`) schedules one coalesced CSI-06 `outreach-number:` replay job per number revision, and new revision-specific CSI-11 `recording_discovery` jobs in pages of 500 for calls that already carry a recording only: a call without a recording has nothing whose eligibility or Lead binding an attachment can change, and capture raises its own discovery when a recording arrives. Before September 21, 2026 every call on the number received both a discovery and an Outreach job per revision. GET list/filter never refreshes snapshots or writes. E consumes certainty labels and evidence windows from the attachment DTO; D consumes event attribution, never lifetime attachment counts.

Flags: `ATTACHMENT_REFRESH` and `AUTO_ATTACH` default off; Owner commands also require `ENABLED`. Automatic attach is not enabled. No STT or media flag changes. Additive nullable evidence and scan-cursor fields require no data migration or new index; existing CSI-01 unique indexes remain mandatory. Rollback: keep attachment refresh off, preserving edges/history/jobs. Runtime accesses the existing TEST_MODE database boundary. Tests use a randomized loopback replica database and synthetic 555-01xx numbers, never live providers.

Limitations: initial number scans traverse Leads in bounded durable pages; production volume/performance and flag enablement remain rollout work. Legacy exact rows without pinned fields retain a read-only compatibility path in CSI-11; all new CSI-05 exact evidence is pinned. Reviewed display snapshots intentionally remain frozen along with reviewed evidence. Official reconciliation stays in existing workflows.

## H5 (September 22): sole-match automatic attach

Controlling rule: [Lead progress specification §5 and §13.3 H5](../../../../sales-intelligence-move-assessment-workspace/SALES-INTELLIGENCE-LEAD-PROGRESS-SPECIFICATION.md). Policy version `sole-match-v1`. Still behind `AUTO_ATTACH` (default off).

**Match set.** `matchSet.ts` `completeNormalizedMatchSet(number, session)` runs inside the caller's transaction. It searches Form Leads and Call Leads together with `leadPhoneMatchClauses` over the four indexed normalized paths: live phone, ingested snapshot, Granot snapshot and RingCentral original caller. It searches across every Source Company, including Leads with no edge, and pages at 250 per model. Candidates are deduplicated by `{model,id}`: several fields on one Lead make one candidate, while one Form Lead plus one Call Lead make two (§13.4; no pairing rule). `duplicate: true` Leads are excluded as both targets and competitors. Bad Lead and No-Sync Leads are competitors but never targets. Booked/Cancelled Leads may be targets; their Outreach stays officially closed. An Owner-rejected Lead still counts as a competitor.

**Unknown, never a match**:
- no lookup digits;
- more than 250 Leads for either model (`page_exceeded`);
- `unindexed_evidence`: an edge on the number carries evidence from raw `granot_contact_snapshot.phone_number`/`phone` for a non-duplicate Lead that the indexed lookup did not return, and that Lead's raw phone still equals the number.

Limitation: a raw-only Granot Lead that has never been through `persistLeadAttachments` has no edge. The number-side lookup cannot see it, so the set can look complete. The Lead's own `attachment-lead:` evaluation then contests it. No corpus scan is added.

**Decision.** `planSoleMatch` is pure. `autoAttachNumber` in `store.ts` applies it. Attach requires all of these:
- a complete set with exactly one candidate, and that candidate is eligible;
- the candidate's pair edge exists, has phone evidence from any of the four sources, is not rejected and has no Owner `decided_at`;
- no other Attached edge for a different Lead remains (Exact, Owner-confirmed or non-automatic).

The write is Attached / Likely with `decision_reason` and `auto_decision.reason` set to `sole_non_duplicate_match`. `auto_decision.confidence` is `1`. It records the deterministic rule and is **not a measured probability**. `decided_at` is untouched. The `attachment_auto_attached` audit records the inspected source fields, candidate count, candidates (up to 10), match status and policy version. `AUTO_ATTACH_REASON` is now `sole_non_duplicate_match`, and `isAutoAttachReason` still recognises the pre-H5 `automatic_high_confidence`.

**Contest.** A known non-duplicate competitor is two or more candidates or a page overflow. It demotes **only** automatic Attached/Likely edges (never Owner-decided, Exact or Owner-confirmed ones) to Ambiguous/Unsure. The demotion does the following:
- clears `auto_decision`;
- pushes history `auto_attach_contested` and writes audit `attachment_auto_contested`;
- opens one `identity` review (`number:<id>`, cause key `auto_attach_contested:<id>`).

Fan-in leaves a contested edge Ambiguous. History and applied effects are preserved. If the competitor leaves the set and no Owner decision blocks the pair, a later evaluation may attach it again. The review stays for the Owner. An automatic edge whose Lead leaves a *complete* set, for example after a phone change or a duplicate mark, is withdrawn to Candidate (`auto_attach_withdrawn`). It no longer blocks a new sole target.

**Concurrency.** Every evaluation holds `lockNumber`, so two evaluations of one number serialize through a write conflict and a transaction retry. A Lead inserted or re-phoned after an evaluation's snapshot is caught by its own `attachment-lead:` evaluation, which contests the edge. Replica tests cover both races, and replay writes no second edge, audit or review.

**Triggers and keys.** Evaluation runs on these paths:
- the Lead-side `attachment-lead:` job, raised from the Outreach entity-change scan (H2), with the 5-minute watermark kept as backstop;
- the capture `number:` / `attachment-scan:` jobs;
- Owner attachment commands.

`leadAttachmentJobInput` (`sources.ts`) is the single `attachment-lead:` key: `csi:attachment-lead:sole-match-v1:<model>:<id>:<fingerprint>`. Scan keys also carry `sole-match-v1`, so completed old-rule jobs never fence new evaluation. The fingerprint now includes `no_sync`.

## H6 (September 24): Form Lead Contact Numbers

Before this, only call capture created a Contact Number, so a Form Lead whose phone never called had no number, no edge and a card reading "No Lead attached". Now the Form Lead's own `attachment-lead:` job creates the number. That is the job the Lead's EntityChange raises on create and on every phone change, with the watermark as backstop. The quote form never waits on it, and a failure retries the job without touching the Lead. Behind `FORM_LEAD_NUMBERS` (default off).

`ensureFormLeadContactNumber` (`formLeadNumber.ts`) runs in the job transaction before `persistLeadAttachments`:
- `duplicate: true` and any `bad_lead` never create a number. Neither can be a sole-match target, and the original Lead creates the number for a duplicate's phone.
- The E.164 is `toE164(normalized_phone_number)`, the live phone only.
- An existing row with that E.164 (any kind, classification, restriction or purge) is reused untouched. A company DID in the latest RingCentral directory snapshot is skipped.
- A new row has capture's shape: external, `unknown`, eligibility allowed, revision 1, zero rollups, `first_observed_at` = `last_activity_at` = Lead `timestamp`. The form is not a call, so the first real call starts the counts. Audit `contact_number_created_from_form_lead`. The row carries `created_via: "form_lead"` (G7), set on create only; a reused row is never changed, and capture never writes the field (absent = `call`). Numbers created before G7 are stamped from that audit by `scripts/dev_ops/stamp-form-created-numbers.ts` (S10 step 1).
- A created number enqueues the same `attachment-scan:` jobs capture raises, so every Lead on that phone gets its edge. Sole-match, fan-in, identity review and the Outreach mirror/primary number are unchanged code, reached earlier.

There is no move-date gate. A Contact Number is an endpoint, and Outreach decides work. Two Leads racing on one new phone hit `contact_number_e164_unique`; the losing job retries and reuses the row.

Historical backfill: `scripts/dev_ops/backfill-form-lead-contact-numbers.ts`. It applies the same rule, creates one number per phone from the earliest Lead, and runs `attachLeadsOnNumber` (`refresh.ts`, the scan jobs' work inline) in one transaction per number. The dry run executes that transaction and rolls it back.
