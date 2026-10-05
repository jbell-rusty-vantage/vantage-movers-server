---
okf_version: "0.2"
type: Service
title: Rep Identity Links
description: RingCentral directory Users linked to Agents with temporal, account-scoped identity resolution. Since All Numbers phase B the Owner manages them from Accounts (connect, change, disconnect, suggested matches); the interim `/reps*` routes are gone.
status: active
tags: [sales-intelligence, rep-identity]
resource: src/services/salesIntelligence/repIdentity/
applies_to:
  - src/services/salesIntelligence/repIdentity/
  - src/routes/sales-intelligence-admin.routes.ts
owners: [team:main-server]
---

# Rep Identity Links (CSI-10, slimmed 2026-10, Accounts 2026-10)

Runtime: `src/services/salesIntelligence/repIdentity/` (`accounts.ts`, `commands.ts`, `propose.ts`, `reads.ts`, `resolve.ts`). Collection `rep_identity_links`; directory evidence comes from `ringcentral_directory_snapshots` ([number-activity-reads.md](./number-activity-reads.md), directory sync).

## Routes (Accounts, all-numbers CONTRACT §4.5–§4.7)

Owner-only, under `/api/v1/admin/sales-intelligence`: `GET /accounts`, `POST /accounts/:extension_id/agent`, `POST /accounts/suggest`; the full rules are in [number-activity-reads.md](./number-activity-reads.md#accounts-repidentityaccountsts). Writes use signed Owner authentication, strict schemas, the extension's transactional write fence (`lockRepExtension`), durable payload-sensitive command replay and append-only CSI audit (`rep.account_connected`, `rep.account_ended`, `rep.proposed`). Admin, scoped keys and reps get 403 `OWNER_REQUIRED`.

The interim `GET /reps`, `GET /reps/:id`, `POST /reps`, `POST /reps/propose` and `POST /reps/:id/review` were removed in All Numbers phase B with the services only they used (`listRepLinks`, `readRepLink`, `createRepLink`, `reviewRepLink`). No caller outside the old Admin screens used them (the MCP reads only the history routes).

## Connect, change, disconnect

The Owner's connection is reviewed at once: there is no separate review step. Connecting or changing an Agent creates a `reviewed` link effective now and retires the extension's current link at the same instant through the successor rule (a reviewed predecessor keeps `reviewed_at`/`reviewed_by`, so it keeps authority over its own interval; a proposal is retired unreviewed and never resolves). The successor copies the extension's contact fields: direct numbers and the SMS sender from the stored directory, the previous link's Team Messaging person and chat ids and Message channels. Disconnecting retires the current link. Every connect, change or disconnect also re-syncs the open desk subjects the old or the new Agent receives or is assigned, in the same transaction, so desk assignment (IMPL-01) follows at once ([number-activity-reads.md](./number-activity-reads.md#accounts-repidentityaccountsts)). A connect requires a stored, complete directory snapshot containing the extension as a User and an active Agent (`IDENTITY_BLOCKED` / `INVALID_INPUT` otherwise); a disconnect works for an extension that left the directory.

## Proposals

`POST /accounts/suggest` runs the directory proposal (`proposeRepLinks`) for every stored snapshot, page by page. Proposals consume stored account-scoped directory snapshots and canonical Agent `name`/`name_aliases`. Only User extensions qualify. Exact names, aliases and first tokens are evidence; all matching candidates stay visible to the decision. Proposal pages create only unique-candidate proposed links and never update existing extension history (any prior link, reviewed or retired, is preserved). Missing snapshots, inconsistent counts/duplicate ids and unverified provider completeness are explicit. No provider refresh occurs. `GET /accounts` shows a proposal, else the strongest unique name candidate, as the Account's `suggestion`.

## Temporal resolution

Intervals are half-open `[effective_from,effective_to)`. `resolveRepIdentities` is the account/extension/event-time authority (`resolveRepIdentityAt` for one event). All Numbers names the Agent of a call at read time (`numberActivity/callRep.ts`: the reviewed link effective at the call, any role but `excluded`); the Sales Outreach Desk credits only a reviewed `sales_rep` link; nudge eligibility resolves the optional reviewed link. Proposed links never resolve; reviewed retired links resolve before their end, while unreviewed retired proposals never do. Conflicting applicable authority fails closed. Non-sales roles cannot establish Sales Rep authority. One Agent can have several extensions. The unique index plus the transactional per-account/extension SyncState write fence protect concurrent commands. Reviewed history is never rewritten in place.

## What changed in the 2026-10 slimming

Review and retirement no longer enqueue a `rep_identity_reevaluate` job: that stage only re-scheduled Outreach and recording-discovery work, which were removed. Late rows of that stage are terminalized as `retired` by job recovery. A connection still applies to earlier calls only through its own interval, because attribution is resolved at read time.

Reads never write or enqueue. No new environment keys exist; `SALES_INTELLIGENCE_ENABLED` gates every route.
