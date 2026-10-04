---
okf_version: "0.2"
type: Service
title: RingCentral Accounts messages (Owner Rep Nudges)
description: Owner's own review_context text to one current RingCentral directory User by Team Messaging or pager, single-attempt with receipt-only repair. The Outreach-scoped call suggestions and SMS were removed in the 2026-10 slimming.
status: active
tags: [sales-intelligence, rep-identity]
resource: src/services/salesIntelligence/nudges/
applies_to:
  - src/services/salesIntelligence/nudges/
  - src/routes/sales-intelligence-admin.routes.ts
owners: [team:main-server]
---

# RingCentral Accounts messages (CSI-14, slimmed 2026-10)

Runtime: `src/services/salesIntelligence/nudges/`. Collection `owner_rep_nudges`. Routes (Owner-only, `Idempotency-Key` on POST): GET `/nudges` (history), POST `/nudges/preview`, POST `/nudges` under `/api/v1/admin/sales-intelligence`.

## What a message is now

The only purpose is `review_context`: the Owner's own text (1–1,000 characters, template `review_context` version 1) to one directory User, by `team_messaging` or `pager`. It names no customer, record, follow-up or phone number and never goes to a customer. The Outreach-scoped call suggestions, customer-context reviews, SMS-to-rep and customer-destination guards were removed with Outreach ([slimming specification](../../server-admin-slimming/SPECIFICATION.md) §7.3). A body that names an Outreach record or carries an Outreach revision fence is rejected (400).

## Eligibility (`eligibility.ts`)

`SALES_INTELLIGENCE_ENABLED` and `SALES_INTELLIGENCE_NUDGE_ENABLED` on, and the policy's `enabled_capabilities` includes `nudges`. The account must equal `RINGCENTRAL_ACCOUNT_ID`. The destination is an `Enabled` User extension on the current stored directory snapshot. A current reviewed Sales Rep link is optional: when given (`rep_identity_link_id` + `expected_rep_revision`) or resolved, it can only narrow channels (`nudge_channels_allowed`) and supplies the Team Messaging person id. Team Messaging needs a stored person id; pager needs a 1–7 digit extension number and a configured sender extension number. Sender extension/person must be configured and differ from the recipient. `SALES_INTELLIGENCE_ADMIN_BASE_URL` must be an https URL. Channel switches come from `SALES_INTELLIGENCE_NUDGE_*` ([environment.md](../environment.md)).

## Send

`previewNudge` validates and renders without provider calls or a send intent. `sendNudge` repeats all checks, persists an idempotent pending intent and its `nudge_repair` job in one transaction (audit `nudge.authorized` on subject `directory:<account>:<extension>`), resolves the Direct chat, and revalidates immediately before a durable submission boundary. Rate admission counts **all** persisted attempts for that `(rc_account_id, rc_extension_id)` in the preceding rolling hour, including pending, failed and unknown delivery; default limit 6.

Provider submissions are native, bounded, single-attempt HTTP with no 401 POST replay. Only the selected User's Direct chat is accepted; cached or client chat ids are not used. Pager fallback requires `allow_pager_fallback`, an allowed pager and a definitive chat-creation rejection before submission. A mismatched recipient, timeout or uncertain submission never falls back. Only the fresh invocation may submit; replay returns the same operation and current status. Receipt id persistence precedes terminal status/audit. A timeout or missing durable evidence yields `unknown_delivery`, never a retry.

Terminal status is written under the row's revision fence with audit `nudge_sent` or `nudge.<status>` on the directory subject, and one structured log line `sales_intelligence.nudge.<status>` (no body, destination, raw response or credentials). Rows written before the slimming may still carry `outreach_record_id`; nothing reads it.

## Repair

`repair.ts` runs from `/api/cron/sales-intelligence-nudge-repair` (every five minutes, `ENABLED` and `NUDGE_ENABLED`), job recovery and the queue's `nudge_repair` dispatch. It examines pending rows older than two minutes, recovers orphan/exhausted intents, and drains a bounded number of jobs with fenced worker leases. It never calls the send command. Before-submission crashes become failed; a submission boundary without an unambiguous receipt becomes unknown. Unknown is terminal and never automatically resent. Flags off preserve pending work and skip repair; re-enablement reconciles only. Delivery-uncertain rows are protected from the purge ([DELETION-MANIFEST.md](../../server-admin-slimming/DELETION-MANIFEST.md)).
