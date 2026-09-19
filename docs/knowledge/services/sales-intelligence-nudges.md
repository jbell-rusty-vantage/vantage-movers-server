---
okf_version: "0.2"
type: Service
title: Explicit Owner Rep Nudges
status: active
tags: [sales-intelligence, outreach, rep-identity]
---

# Explicit Owner Rep Nudges — CSI-14

Runtime: `src/services/salesIntelligence/nudges/`. Authority: [specification](../../call-sales-intelligence/01-specification.md), [pipeline §8](../../call-sales-intelligence/03-server-pipeline-and-jobs.md#8-owner-rep-nudge-nudges), [browser contract](../../call-sales-intelligence/workspace/evidence/csi-14/API-CONTRACT.md).

Only a trusted signed Owner command authorizes a send. The service uses CSI-10's account-scoped temporal resolver and additionally requires a current reviewed, open-ended Sales Rep link, active canonical Agent, stored User-extension evidence and reviewed channel metadata. Historical reviewed/retired attribution and proposal name matches are not current send authority. No Agent, Extension User, directory, allocation, official Lead or booking writes occur.

`previewNudge` validates and renders without provider calls or a send intent. `sendNudge` repeats all checks, persists an idempotent pending intent and repair job transactionally, resolves the Direct chat, and revalidates immediately before a durable submission boundary. Existing record/number/policy/extension fences serialize relevant concurrent commands; temporary fencing writes restore aggregate values in the same transaction. Rate admission counts **all** persisted attempts on that link in the preceding rolling hour, including pending, failed and unknown delivery. The default limit is six.

Outreach must be active. Future-due work and identity questions are valid internal review context. Call suggestions use CSI-06 derivation, contact eligibility, active channel restrictions and independent action snoozes; they do not require overdue status. Closed/officially ineligible work is never reopened. Sending does not complete an action, create a promise, stamp contact, assign work, or change due dates, restrictions or provenance.

Recipient protection reads the Contact Number, all attached/candidate/rejected Lead identities on that number plus the record's Lead, all stored Lead phone snapshots, and their Lead Message destinations including the legacy Form Lead reference. Malformed/missing required evidence or capped results block explicitly. Phone comparisons use canonical E.164. Only the selected reviewed rep's Direct chat (exactly rep and JWT sender) is accepted; cached chat IDs and client chat IDs are not used. Optional SMS uses the JWT sender DID and the single reviewed rep DID; optional pager uses the reviewed extension number. Team Messaging is primary. SMS and pager default off.

Templates are server-owned version 1, keyed by purpose. Names are first name plus last initial; phone numbers are last four digits. Bodies include reason/context, recorded human-contact time, source, configured Vantage link and Owner attribution. Edits are at most 1,000 characters and reject full customer numbers in supported normalized/formatted/full-width forms. Review edits reject imperative contact requests; this deterministic validation is not model reasoning. Store the validated body in `body_as_sent`; pending/failed records retain the intended body without claiming it was delivered.

Provider submissions use native, bounded, single-attempt HTTP with no 401 POST replay. JWT owner and account are verified; Direct resolution also verifies the JWT Team Messaging person. The pager fallback requires explicit `allow_pager_fallback`, configured/allowed pager, and a definitive chat-creation rejection before submission. A mismatched recipient, timeout, or uncertain submission never falls back.

Only the fresh invocation may submit; replay returns the same operation and current status. Receipt ID persistence precedes terminal status/audit. A timeout or missing durable evidence yields `unknown_delivery`, not a retry. Team Messaging receipt repair requires the returned Direct-chat ID, membership, sender and message ID to match the persisted requested scope. Exact receipt reads may establish provider acceptance, never customer work. No exactly-once provider guarantee is claimed. Legacy CSI-01 pending rows without a revision field are fenced by that field's absence and safely terminalized without migration or resend.

`repair.ts` is reachable through authenticated `/api/cron/sales-intelligence-nudge-repair` every five minutes, generic recovery, and the existing queue's `nudge_repair` dispatch. It examines pending rows older than two minutes, recovers up to 25 orphan/exhausted intents, and drains at most five jobs per invocation with a 30-second loop deadline and 60-second fenced worker leases. It never calls the send command. Before-submission crashes become failed; a submission boundary without an unambiguous receipt becomes unknown. Receipt reads denied/unavailable or credentials changed also become unknown. Unknown is terminal and never automatically resent. Master/nudge flags off preserve pending work and skip repair; re-enablement reconciles only.

Audit records authorization, submission boundary and terminal disposition with nudge invalidations. Accepted sends append `nudge_sent` on the Outreach subject. Operational events contain IDs and closed error codes, no body, destination, raw response or credentials. History GET and Outreach detail are read-only, cursor-paginated, and retain `as_of`/coverage.

Configuration and exact consumer imports: [CSI-14 contract](../../call-sales-intelligence/workspace/evidence/csi-14/API-CONTRACT.md). Verification: [checks](../../call-sales-intelligence/workspace/evidence/csi-14/CHECKS.md). A live-send proof is separately gated and was not executed by this task.
