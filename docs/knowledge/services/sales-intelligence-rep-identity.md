---
okf_version: "0.2"
type: Service
title: Rep Identity Links
description: Owner review of RingCentral directory Users as Sales Reps with temporal, account-scoped identity resolution. Retained by the 2026-10 slimming for the RingCentral Accounts tab.
status: active
tags: [sales-intelligence, rep-identity]
resource: src/services/salesIntelligence/repIdentity/
applies_to:
  - src/services/salesIntelligence/repIdentity/
  - src/routes/sales-intelligence-admin.routes.ts
owners: [team:main-server]
---

# Rep Identity Links (CSI-10, slimmed 2026-10)

Runtime: `src/services/salesIntelligence/repIdentity/` (`commands.ts`, `propose.ts`, `reads.ts`, `resolve.ts`). Collection `rep_identity_links`; directory evidence comes from `ringcentral_directory_snapshots` ([number-activity-reads.md](./number-activity-reads.md), directory sync).

## Routes

Owner-only, under `/api/v1/admin/sales-intelligence`: GET `/reps`, GET `/reps/:id`, POST `/reps` (create, stays proposed), POST `/reps/propose`, POST `/reps/:id/review`. Writes use signed Owner authentication, strict schemas, expected revisions, durable payload-sensitive command replay (`Idempotency-Key`), transactions and append-only CSI audit. Admin, scoped keys and reps get 403 `OWNER_REQUIRED`. The read-only `/roster` and the Overview reads that used it were removed with Outreach in the 2026-10 slimming.

## Proposals

GET never runs the matcher: directory proposal results (including ambiguous/unmatched Users) are read from the durable `propose_reps` command responses for the current snapshot. Users with no stored proposal evidence are `not_proposed`. POST `/reps/propose` is the only proposal-generation path. `rc_account_id` is optional on list: omitted queries return the latest stored snapshot per RingCentral account, current directory Users, and a reviewed attached Agent when one exists.

Proposals consume stored account-scoped directory snapshots and canonical Agent `name`/`name_aliases`. Only User extensions qualify. Exact names, aliases and first tokens are evidence; no match implies review. All matching candidates remain visible. Proposal pages create only unique-candidate proposed links and never update existing extension history. Missing snapshots, inconsistent counts/duplicate ids and unverified provider completeness are explicit. No provider refresh occurs.

GET link DTOs expose stored `rc_direct_numbers` copied from the current directory snapshot so Owner review can set channels; propose writes empty `nudge_channels_allowed`. Review validates the current stored User directory and canonical active Agent. The Agent's username comes from `granot_identity.username`, falling back to `granot_crm_username`; no Agent or Extension User writes occur.

## Temporal resolution

Intervals are half-open `[effective_from,effective_to)`. `resolveRepIdentities` is the account/extension/event-time authority (`resolveRepIdentityAt` for one event). The Number timeline resolves each call leg's rep at read time (`numberActivity/timeline.ts`) and nudge eligibility resolves the optional reviewed link. Proposed links never resolve; reviewed retired links resolve before their end, while unreviewed retired proposals never do. Conflicting applicable authority fails closed. Non-sales roles cannot establish Sales Rep authority. One Agent can have several extensions. The unique index plus a transactional per-account/extension SyncState write fence protect concurrent commands. Reviewed edits create successor intervals and retire the predecessor atomically; in-place rewrites of reviewed history are rejected.

## What changed in the 2026-10 slimming

Review and retirement no longer enqueue a `rep_identity_reevaluate` job: that stage only re-scheduled Outreach and recording-discovery work, which were removed. `repIdentity/worker.ts` and `scheduling.ts` are deleted, and late rows of that stage are terminalized as `retired` by job recovery. A review still applies to earlier calls, because the Number timeline resolves rep attribution at read time.

Reads never write or enqueue. No new environment keys exist; `SALES_INTELLIGENCE_ENABLED` gates every route.
