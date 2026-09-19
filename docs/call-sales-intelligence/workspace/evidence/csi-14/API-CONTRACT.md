# CSI-14 server contract v1

Server repository `vantage-main-server`, branch `sales-intelligence`. Team C owns server behavior; Team E owns dialogs. These are browser-ready server interfaces, not a claim that CSI-08/09 UI/browser integration exists. CSI-08 was not started at baseline; CSI-06/10 server contracts were available. CSI-13 has no send tool or automatic messaging path.

## Destination addendum — September 19

Implemented. [01 §9 invariant 6](../../../01-specification.md) authorizes send to a current stored-directory User. Preview/send require `rc_account_id` + `rc_extension_id`. `rep_identity_link_id` / `expected_rep_revision` are optional and must be supplied together when the Owner names a current reviewed link. A name match, a `proposed` link, or unmatched directory evidence never invents a destination. Do not invent Team Messaging person ids. Live send remains separately gated. See [destination evidence](../csi-14-destination/HANDOFF.md).

## Imports (server-relative)

| Concern | Import |
| --- | --- |
| Preview/send | `src/services/salesIntelligence/nudges/commands.ts`: `previewNudge`, `sendNudge`, `NudgeCommandInput`, `NudgeDependencies`, `NudgePreviewDto`, `NudgeSendDto` |
| Server templates | `nudges/templates.ts`: `NUDGE_TEMPLATES`, `renderNudgeTemplate`, `validateNudgeBody`, `NudgePurpose` |
| Injectable provider | `nudges/adapters.ts`: `NudgeAdapter`, `NudgeRecipient`, `NudgeSubmission`, `NudgeReceipt`, `NudgeProviderError`, `createNudgeAdapter`, `assertDirectChat` |
| History/DTO | `nudges/reads.ts`: `listNudges`, `nudgeHistoryPage`, `toNudgeDto`, `NudgeDto`, `nudgeDtoSchema`, `nudgeHistoryQuerySchema` |
| Repair | `nudges/repair.ts`: `runNudgeRepairJob`, `recoverNudgeRepairJobs`, `drainNudgeRepairJobs` |
| Identity authority | `repIdentity/resolve.ts`: `resolveRepIdentities`; existing Owner review accepts optional `rc_team_messaging_person_id`, exposed in `repLinkDtoSchema` |
| Strict command | `src/validation/v1/salesIntelligence.ts`: `csiNudgeInputSchema`, `csiNudgeCommandSchema` |
| Configuration | `src/config/domain/salesIntelligence.ts`: `csiNudgeConfiguration`, existing `csiFlag` |

Short paths in this table are relative to `src/services/salesIntelligence/`. Repair exports cannot originate an Owner command. Do not call send from calls, notes, identity changes, intelligence, routine jobs or MCP tools.

## HTTP

All Owner paths below use `/api/v1/admin/sales-intelligence`. The existing Admin proxy must provide its signed Owner identity plus API authentication. API secret alone, Admin role, worker, and scoped service key are insufficient. Scope is omitted or `production`; no alternate dataset scope is accepted. POST requires `Idempotency-Key` (1–200 characters).

Use the same strict body for `POST /nudges/preview` and `POST /nudges`:

```json
{
  "expected_revision": 7,
  "nudge": {
    "outreach_record_id": "aaaaaaaaaaaaaaaaaaaaaaaa",
    "rc_account_id": "synthetic-account",
    "rc_extension_id": "101",
    "channel": "pager",
    "template_key": "review_context",
    "template_version": 1,
    "purpose": "review_context",
    "allow_pager_fallback": false
  }
}
```

`purpose` and `template_key` must match (`review_context` or `call_suggestion`); version is 1. Optional `body` is trimmed, 1–1,000 characters, with the same full-customer-number prohibition as the default template. Review-purpose edits cannot issue imperative customer-contact requests. Optional `followup_id` selects an open action; a call suggestion cannot select a snoozed/non-call action. Without one, an independently eligible call action or unworked initial-call state is required for a call suggestion. Optional `expected_revisions` entries may cover this record, selected link, primary number, related followups, restrictions, review items, and attachments; unrelated/unsupported targets conflict.

Successful preview is HTTP 200:

```json
{
  "ok": true,
  "as_of": "2026-09-18T18:00:00.000Z",
  "coverage": {"known_through": null, "gaps": [], "capabilities": {}, "ai_paused": false},
  "data": {
    "body": "Alex — No attributable call is recorded yet. Please review the internal context; this is not a request to contact the customer.\nTaylor M., number ending 0101.\nLast recorded human contact: none recorded; source: Synthetic source.\nhttps://vantage.example.test/sales-intelligence?record=aaaaaaaaaaaaaaaaaaaaaaaa\nOwner: synthetic-owner",
    "template_key": "review_context", "template_version": 1, "purpose": "review_context",
    "expected_revision": 7, "expected_rep_revision": null,
    "recipient": {"rc_account_id": "synthetic-account", "rc_extension_id": "101", "directory_name": "Joshua L", "agent_id": null, "agent_name": null, "rep_identity_link_id": null, "channel": "pager"},
    "allowed_channels": ["team_messaging"],
    "destination_evidence": "stored_checked", "provider_destination_verified": false,
    "send_time_revalidation_required": true, "authorizes_send": false
  }
}
```

Coverage is the existing runtime coverage DTO and may include additional established fields. Preview never creates a Direct chat, submits a message, reserves a rate-limit slot, or creates a command. It is not a send token. Fetch refreshed revisions after a conflict; never silently change the recipient or overwrite edited text.

Send is HTTP 200 (terminal) or 202 (pending), with `{ok:true,data:{operation_id,replayed,nudge:NudgeDto}}`. `operation_id` and nudge `id` remain stable on replay. Same Owner/key/normalized payload returns the existing operation and latest history status with no new submission; changed payload conflicts. Do not generate a new key as an automatic error recovery strategy.

Nudge DTO fields: `id`, `revision`, `outreach_record_id`, `rc_account_id`, `rc_extension_id`, `rep_identity_link_id` (nullable), `agent_id` (nullable), `actor_id`, `channel`, `purpose`, `template_key`, `template_version`, `body_as_sent`, `status`, `fallback_channel`, `error_code`, `created_at`, `sent_at`, `delivery_note`, `automatic_resend:false`. Destinations, raw provider receipts/responses and credentials are not exposed. `sent`/`fallback_sent` establish provider acceptance, not that a rep read it or worked the customer. Pending/failed DTO body is validated intent, not proof of submission.

`GET /nudges?outreach_record_id=aaaaaaaaaaaaaaaaaaaaaaaa&limit=20` returns `{ok:true,as_of,coverage,data:{items:NudgeDto[],next_cursor:string|null}}`. Optional filters: `rep_identity_link_id`, `scope`; `limit` 1–100, default 20. Cursor is the last returned nudge ObjectId; order is descending immutable ObjectId. No repair/enqueue/provider calls on GET. Existing `GET /outreach/:id` adds `data.nudges` with the same page shape, first 20; continue with `/nudges`. History remains available with nudge flag off while the master Owner-read flag is enabled.

## Errors and UI behavior

Errors retain `{ok:false,code,error,request_id}` with closed, redacted codes:

| HTTP | Codes / behavior |
| --- | --- |
| 400 | `INVALID_INPUT`: strict schema/template/key/version, missing Idempotency-Key |
| 403 | `OWNER_REQUIRED`, `UNSUPPORTED_SCOPE` |
| 404 | `FEATURE_DISABLED` (master, nudge, or policy capability disabled) |
| 409 | `REVISION_CONFLICT`, `IDEMPOTENCY_CONFLICT`, `IDENTITY_BLOCKED`, `CONTACT_RESTRICTED`, `NUDGE_NOT_ACTIONABLE`, `NUDGE_CONFIGURATION_UNAVAILABLE`, `NUDGE_DESTINATION_EVIDENCE_INCOMPLETE` |
| 422 | `NUDGE_DESTINATION_IS_CUSTOMER`, `NUDGE_BODY_INVALID` |
| 429 | `RATE_LIMITED` |

Failures after durable authorization are returned as a failed/unknown nudge DTO, not a fabricated successful delivery. A transport/persistence failure may return HTTP 500 while the durable operation remains pending; replay the **same** command/key or read history. `pending`: display delivery unconfirmed and allow refresh; never automatically resubmit. `unknown_delivery`: explicit uncertainty, no automatic resend/fallback. A separate new Owner command is a new decision, never implicit repair. A revision change after preview invalidates sending; a change during chat preparation terminalizes that already authorized attempt as failed before submission.

## Configuration and operations

All accessors read at call time. No `.env`/production flags were changed.

| Setting | Default / requirement |
| --- | --- |
| `SALES_INTELLIGENCE_ENABLED`, `SALES_INTELLIGENCE_NUDGE_ENABLED` | false; both required for new sends/repair |
| Persisted policy `enabled_capabilities` | must include `nudges`; default empty |
| `RINGCENTRAL_ACCOUNT_ID` | explicit configured account, compared to link and JWT account |
| `SALES_INTELLIGENCE_NUDGE_SENDER_EXTENSION_ID`, `_SENDER_PERSON_ID` | explicit authenticated JWT identity, never rep impersonation |
| `SALES_INTELLIGENCE_NUDGE_SENDER_EXTENSION_NUMBER` | required for pager/fallback; distinct from extension ID |
| `SALES_INTELLIGENCE_NUDGE_SENDER_DID` | required E.164 for optional SMS |
| `SALES_INTELLIGENCE_ADMIN_BASE_URL` | required HTTPS URL without userinfo |
| `SALES_INTELLIGENCE_NUDGE_TEAM_MESSAGING_ENABLED` | true at channel level; master/policy/review gates still required |
| `SALES_INTELLIGENCE_NUDGE_SMS_ENABLED`, `_PAGER_ENABLED` | false |
| `SALES_INTELLIGENCE_NUDGE_CHANNELS` | documented comma allowlist; defaults effectively to `team_messaging`. When present, aliases cannot add channels; explicit per-channel false may restrict it further. Explicitly listing SMS/pager opts them in. Without a list, the per-channel flags above are supported aliases. |
| `SALES_INTELLIGENCE_NUDGE_PER_REP_PER_HOUR` | documented rate key: 6; integer 1–100, rolling hour per `(rc_account_id, rc_extension_id)`; all persisted states reserve/count. Takes precedence over the supported `SALES_INTELLIGENCE_NUDGE_HOURLY_LIMIT` alias. |
| `CRON_SECRET` | existing authenticated cron mechanism |

Existing RingCentral JWT configuration is used by the production adapter. The default adapter refuses provider access in TEST_MODE; tests inject fakes. Authentication and HTTP reads/submissions are bounded; POST is never automatically replayed after 401. Official endpoint references: [Direct conversations](https://developers.ringcentral.com/guide/team-messaging/concepts/conversations), [pager](https://developers.ringcentral.com/guide/messaging/pager/sending-pager-messages).

`/api/cron/sales-intelligence-nudge-repair` runs every five minutes; queue and generic recovery use the same repair-only stage. Flags off skip work without erasing pending history. Re-enable only to reconcile; unavailable credentials or denied receipt reads cannot authorize a resend. Exact message ID plus scoped receipt is required; body/time similarity is never used. Missing/exhausted jobs are recovered in bounded pages; expired leases are fenced. Existing indexes are reused; no production migration/backfill was run. Additive fields tolerate old rows; legacy pending rows with no submission evidence fail closed.

Rollback: disable the nudge flag and optional channel flags, retain all intents/commands/audits, and keep Owner history reads. Do not delete pending rows or recycle idempotency keys. A separately authorized rollout must verify current provider grants, reviewed recipient configuration, and an Owner-approved live-send proof. Historical capability evidence is neither a current grant nor a successful send proof.

