# Human and provider facts: disposition

Observed 2026-10-04T03:07Z with the read-only inventory ([INVENTORY.md](INVENTORY.md), [`inventory.json`](inventory.json) → `human_facts`). Authority: SPECIFICATION §7.3 and the coordinator decision recorded below.

Ground rules:

- Suppressions are never silently cleared.
- Human callbacks, Owner instructions, assignments, reviewed attachments and message uncertainty each get an explicit disposition.
- Nothing is replayed or re-sent automatically.
- Legacy AI suggestions need no transfer.

**Corrected 2026-10-04 (lane HARDEN) against the slim code** (`slim/server-admin`, server `709480d3`). The first version of this file said restriction enforcement "continues", and that the Owner could confirm or lift restrictions through review items. Both statements were wrong for the slim server. The Owner commands that did that were removed with the outreach desk: `resolve_restriction`, `resolve_review` and `set_contact_type` exist at baseline `6a374fab` (`src/validation/v1/salesIntelligence.ts`) and nowhere in the slim code.

## Coordinator decision (2026-10-04)

**Kept inert and untouched:**

- contact restrictions, including the AI-origin ones;
- review items;
- Owner instructions.

Their rows stay byte-for-byte. No purge step touches them. In the interim, no reader enforces or lifts them, and no reader applies them to anything. Nothing in the interim Sales Intelligence contacts customers. The new Sales Outreach Desk owns their review/lift workflow and imports them under its own contract.

**Retired with the legacy Outreach model:**

- open follow-ups (`outreach_followups`);
- Outreach assignments (`outreach_records.assignment`).

They are dropped by the purge. Their only copy is the pre-purge backup that `purge.ts` step (b) writes: gzipped canonical EJSON, verified for count and sha256. That backup is an **inert handoff**: nothing reads it at runtime, no tool replays it, and it is never re-imported into a live collection. This is the SPEC §7.2 drop list.

## What the slim code does with these facts (verified)

| Fact | Retained writer | Retained reader | Enforced? | Liftable in the interim? |
| --- | --- | --- | --- | --- |
| Contact restrictions | None. Only the retired intelligence worker created them. | `numberActivity/contactNumbers.ts` shows them on the Number detail (`restrictions[]`: channels, until, origin, state). `salesIntelligence/live.ts` turns their changes into the `restriction` SSE topic. Both are display only. | **No.** No retained path contacts customers from SI. Lead Messages and the Granot/Lead flows do not read this collection. Nudges go to Reps, not customers. | **No.** There is no command. |
| Review items | `salesIntelligence/review/items.ts` `openReview`, only for cause `identity`: the attachment store opens one when an automatic attach is contested. | None. | n/a | **No.** There is no resolve command; items opened in the interim stay open. |
| Owner instructions | None | None | n/a | n/a |
| Contact type | Only the capture projection (`numberActivity/interactionProjection.ts`): `voicemail` when the provider declares it, otherwise `unknown`. The Owner override (`set_contact_type`, basis `owner`) was removed, and stored `owner` values stay as written. | Number timeline (display) | n/a | No Owner override in the interim |

## Dispositions

| Fact | Where | Measured | Provenance | Disposition |
| --- | --- | --- | --- | --- |
| Contact restrictions (suppressions) | `sales_intelligence_contact_restrictions` | 16 rows; 15 `active` and unexpired | All `origin: intelligence`, `actor.kind: worker`. Each references a `finding_id` + `run_id`. All 16 findings are kind `contact_restriction`, `review_state: unreviewed`. There are 16 matching `channel_paused` audit events. | **KEEP INERT, untouched.** Nothing enforces, lifts, expires or rewrites them in the interim. The Number detail still shows them, read-only. Purging the AI provenance does not lift a suppression. Once `intelligence_findings`/`intelligence_runs` are dropped, `run_id`/`finding_id` become *retired provenance*: dangling ids whose source rows exist only in the pre-purge backup. No human decision is fabricated. The new desk decides whether each one is confirmed or lifted. |
| Number contact eligibility | `contact_numbers.contact_eligibility` | `evidence_ref` non-null on 0 rows | — | KEEP (not in any cleanup) |
| Owner instructions | `sales_intelligence_owner_instructions` | 4 rows: 2 `status`, 2 `assignment`; all `active`, `actor.kind: owner` | Human (Owner). `followup_id` and `finding_id` are null on all 4. | **KEEP INERT, untouched.** Their targets (Outreach records) are dropped. No retained code reads or re-applies them. The new desk may import them under its own contract. |
| Outreach assignments | `outreach_records.assignment` | 8,696 records: `crm_receiver` 4,875, `first_attempts` 148, `first_conversation` 89, **`owner` 2**, `rep_promise` 1, none 3,581 | `crm_receiver` is derived from the Granot receiver on the official Lead, which keeps it. The 2 `owner` assignments are also recorded in the 2 Owner `assignment` instructions (kept, inert) and in 2 Owner `assign` audit events (kept, not in C4). | **RETIRED with the legacy model.** Dropped with `outreach_records`. Their only copy is the pre-purge backup (inert handoff, never replayed). The new desk assigns from retained authorities (the Lead's Granot receiver, Rep identity) under its own contract, never from old planner state. |
| Callbacks / follow-ups | `outreach_followups` | 585: 358 open, 128 cancelled, 60 completed, 39 superseded. Origins: `rep_promise` 205, `system_default` 227, `customer_wait` 150, `customer_request` 3, **`owner` 0**. `owner_instruction_ids` non-empty on 0; 12 from findings; 38 open with a future due date | AI-extracted commitments and system defaults. No Owner-entered callback exists. | **RETIRED with the legacy model.** Dropped. The only copy is the pre-purge backup (inert handoff, never replayed). The inherited assignment on 456 follow-ups (`inherited_outreach`) disappears with them. |
| Review items | `sales_intelligence_review_items` | 12,202: 12,187 open (`unclear_commitment` 6,376, `identity` 3,922, `prior_contradiction` 1,284, `missing_date` 310, `missing_responsibility` 149, `closed_work_request` 86, `record_disputed_on_call` 35, `restriction` 16, `disposition_reopen` 9); 15 resolved by worker | Overwhelmingly AI-opened | **KEEP INERT, untouched.** Not in the manifest. In the interim, the attachment store can add new `identity` items and nothing resolves any item. The new desk owns review. Deleting AI-only causes later needs an Owner decision under the new desk's contract. |
| Rep nudges (message deliveries) | `owner_rep_nudges` | 12, all `status: sent`: `review_context` 10 (7 pager, 3 team messaging), `call_suggestion` 2 (team messaging). `unknown_delivery`/`pending`/`failed`: **0** | Owner-authorized sends | **KEEP all 12.** This is a retained capability: Accounts `review_context` sends (`POST /nudges`), history (`GET /nudges`) and the `nudge_repair` stage (see [ENDPOINTS.md](ENDPOINTS.md)). There is no delivery uncertainty to reconcile, so nothing can be retried under a new identity. 7 rows reference an `outreach_record_id` that dangles after the drop; that is recorded, not repaired. |
| Reviewed Number↔Lead attachments | `number_lead_attachments` | 6,736: attached `likely` 6,105, attached `exact` 103, attached **`owner_confirmed` 2**, candidate 273, ambiguous 253. `decided_by` non-null on 2; `auto_decision` on 6,106 | Deterministic matcher plus 2 Owner decisions | **KEEP untouched** (SPEC §7.3). Not in any cleanup. |
| Reviewed Rep identities | `rep_identity_links`, `ringcentral_directory_snapshots`, sync scopes `rep_identity:*` | 12 links, 2 snapshots, 24 scope rows | Owner review (`rep.proposed`/`rep.reviewed_or_retired` audit) | **KEEP** (retained Accounts authority) |
| Owner command replay | `sales_intelligence_command_executions` | 813, all Owner: `reanalyze` 765 (retired command) and 48 others | Human | **KEEP** (idempotency/replay authority; 0.6 MB) |
| Owner/Rep audit history | `sales_intelligence_audit_events` | Owner/Rep rows of retired kinds: `analysis.reanalysis_requested` 765, `media_played` 39. Owner `assign` 2, `start_call` 1, `end_call` 1 | Human | **KEEP.** C4 deletes only `worker`/`intelligence` rows of retired kinds. |
| Call pointers into Lead Conversations | `call_interactions.recording_discovery`, `call_interactions.recordings[].lead_conversation_id` | `recording_discovery` defaults to `null` on all 8,613 calls; the sample flagged `recordings[].lead_conversation_id` | Retired media pipeline | **UNSET by cleanup C7** (backed up first). Every call and every other recording field stays. |
| Customer messages | `lead_messages` | 3,500 | Lead Message delivery | Out of scope; retained workflow |
| Deployed tracker/contribution/goal/earnings collections | — | **None present** in production. `feat/sales-rep-tracker` is not merged or deployed | — | Nothing to migrate |

## What the purge must and must not do with these

- MUST NOT touch any of these collections; all are in `NEVER_DROP` (`ops/slimming/policy.ts`), and no cleanup targets them:
  - `sales_intelligence_contact_restrictions`
  - `sales_intelligence_owner_instructions`
  - `sales_intelligence_review_items`
  - `owner_rep_nudges`
  - `number_lead_attachments`
  - `rep_identity_links`
  - `ringcentral_directory_snapshots`
  - `sales_intelligence_command_executions`

  `manifestPolicyDrift` refuses a manifest whose protected list differs from `NEVER_DROP` or whose cleanups differ from `CLEANUP_SCOPES`.
- MUST back up `outreach_followups`, `outreach_records`, `intelligence_findings` and `intelligence_runs` in full before dropping them (purge step b, verified by read-back). Those exports are the only remaining copy of the restriction sources, the follow-ups and the assignments.
  - Retention of that backup follows DATA-AND-STORAGE §3: a proposed 30-day recovery copy, unless the Owner directs otherwise. Hand it to the new desk before it expires if the desk wants the history.
  - The backup is never restored into a live collection.
- Code consequence for the retained code and the new desk: treat restriction `run_id`/`finding_id`, nudge `outreach_record_id` and Owner-instruction subjects as opaque, possibly dangling ids. Never join them to dropped collections.
