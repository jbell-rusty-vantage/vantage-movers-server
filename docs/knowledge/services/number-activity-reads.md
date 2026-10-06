---
type: Service
title: All Numbers reads, lead link and Accounts (Owner Numbers surface, coverage, directory, history)
description: Owner-only All Numbers list/detail/lead search and the pin/unlink command, the number's lead link (candidates, automatic newest, Owner pin, exclusions, triggers), Accounts (directory Users and their Agent, connect/change/disconnect, suggested matches), Owner coverage, daily RingCentral directory snapshots and the MCP canonical history reads. Reads never mutate.
tags: [sales-intelligence, ringcentral, durable-work]
status: draft
stale_after: 2027-01-31
resource: src/services/numberActivity/
applies_to:
  - src/services/numberActivity/allNumbers.ts
  - src/services/numberActivity/leadLink.ts
  - src/services/numberActivity/leadLinkJobs.ts
  - src/services/numberActivity/leadContactNumber.ts
  - src/services/numberActivity/callRep.ts
  - src/services/numberActivity/numberSearch.ts
  - src/services/numberActivity/searchTerms.ts
  - src/services/numberActivity/coverage.ts
  - src/services/numberActivity/directorySync.ts
  - src/services/salesIntelligence/repIdentity/accounts.ts
  - src/services/salesIntelligence/ownerCoverage.ts
  - src/services/salesIntelligence/history/
  - src/validation/v1/allNumbers.ts
  - src/routes/sales-intelligence-admin.routes.ts
  - src/routes/sales-intelligence-history.routes.ts
  - ops/numbers-v2/
owners: [team:main-server]
sources:
  - id: contract
    resource: ../all-numbers/CONTRACT.md
    title: All Numbers + Accounts build contract (2026-10-05, Owner-approved)
  - id: slimming
    resource: docs/server-admin-slimming/SPECIFICATION.md
    title: Server and Admin slimming specification (§7.3–7.4)
---

# All Numbers reads, lead link and Accounts

**Role:** the Owner-facing side of [Number Activity](number-activity-capture.md): **All Numbers** (every outside number that called us or that we called, plus Form Lead numbers; who it is and who is still waiting on us) and **Accounts** (RingCentral Users and the Agent each one is connected to). The build contract is the workspace `all-numbers/CONTRACT.md`. The retired analysis (classification, eligibility, human-conversation counts, candidate/ambiguous matching, evidence, certainty) and the [Number↔Lead attachment](sales-intelligence-attachment.md) are gone. Proof: `pnpm test:numbers:replica` (`ops/numbers-v2/all-numbers.replica.test.ts`, csi01 replica) and `numberActivity/allNumbers.test.ts`.

**System of record read:** `contact_numbers`, `call_interactions` (canonical, counted calls), `form_leads`, `call_leads`, `sales_outreach_subjects` (desk subject ids only), `rep_identity_links`, `ringcentral_directory_snapshots`, active `agents`, CSI sync state. Writers: the lead-link recompute, the Owner commands, the directory sync.

## Common rules

Prefix `/api/v1/admin/sales-intelligence` (`sales-intelligence-admin.routes.ts`). **Owner only**: the Admin role, scoped keys and signed reps get 403 `OWNER_REQUIRED` whatever `SALES_INTELLIGENCE_REP_ACCESS` says. `SALES_INTELLIGENCE_ENABLED` off → 404 `FEATURE_DISABLED`. `scope` (query or body) may only be `production` (else 403 `UNSUPPORTED_SCOPE`). Query strings and bodies are strict: an unknown key is 400 `INVALID_INPUT`. Envelope `{ ok: true, as_of, data }`; errors `{ ok: false, code, message, error, request_id, issues? }` (`error` repeats `message`). A stale revision is 409 `REVISION_CONFLICT`; a cursor that does not fit the request is 409 `CURSOR_EXPIRED` (restart from page one). Commands go through the CSI command ledger: the `Idempotency-Key` header is the ledger key; without one the key is derived from the target's revision and the body, so an identical retry replays the committed result.

## Number model v2 (`contact_numbers`)

Kept: `e164` (unique), `national_ten`, `digits_reversed`, `country`, `revision`, `first_observed_at`, `last_activity_at`, `provider_names`, `search_terms`, `created_via` (`form_lead` | `call_lead` | absent = call; `call_lead` since outreach lifecycle repair C2b, served as `source: "call"` so CONTRACT §4's `source` enum is unchanged), `purged_at`. Added: `lead`, `other_leads` (≤ 10, newest first), `lead_link {source: automatic|owner, set_at, set_by, excluded[]}`, `last_call {interaction_id, at, direction, result, duration_seconds, rc_extension_id}`, `calls {inbound, outbound, missed}`, `last_inbound_at`, `last_outbound_at`, `waiting_since`, `summary_version` (1 = computed by v2 code; the migration marker). A Lead entry is `{model, id, name, job_no, receiver_agent_id, receiver_agent_name, received_at, state: open|booked|cancelled}` (`state` from the Lead's own `cancelled`/`booked` stamps). The summary fields are [capture's](number-activity-capture.md#all-numbers-call-summary).

`kind`, `classification*`, `contact_eligibility` and `rollups` left the schema in phase B. `ops/numbers-v2/cleanup.ts` unsets them; until it runs, stored rows still carry them and nothing reads or writes them (`strict: "throw"` refuses writes of undeclared paths, never reads; the cleanup therefore writes through the driver).

## Lead link (`leadLink.ts`)

- **Candidates**: the non-duplicate, non-Bad-Lead Leads whose phone is exactly the number — the indexed normalized phone paths (`leadContactPhoneIndexes.ts`: live, ingested snapshot, Granot snapshot, RingCentral original caller; joined on `national_ten`, else the E.164 digits) and the Call Lead created from a call on the number (its `ringcentral.telephony_session_id` among the number's newest 200 calls) — minus `lead_link.excluded`. At most 100 per model and lookup (newest kept). Always computed from the number's side, so every trigger converges.
- **Automatic**: `lead` = the newest candidate by `received_at` (id breaks ties); `other_leads` = the rest. `set_at` moves only when the Lead changes.
- **Owner pin**: `lead` stays the pinned Lead (any non-duplicate Lead, not only a candidate) until a candidate is received after `set_at`; then the link reverts to automatic. A pinned Lead that is gone or became a Duplicate ends the pin.
- **Snapshots** are copied from the Leads on every recompute; `search_terms` is rebuilt at the same time (caller-ID names, then name, Job Number and rep of `lead` and `other_leads`, cap 50).
- **Writes**: in the caller's transaction, only when something changed, with `revision + 1`. A change wakes the Sales Outreach Desk in the same transaction (`salesOutreach/capture/leadLinkWake.ts`: `outreach_lead_change` for subjects whose Lead entered or left the link; `outreach_contact_change` for the number's newest 200 calls and SMS when `lead` changed). The CSI live stream reports it as topic `number`.
- **Triggers** (`leadLinkJobs.ts`, job stage `lead_link`, all under `SALES_INTELLIGENCE_ENABLED`): capture enqueues `lead-link:number:<id>` when a settled call joins a number (new number, new call, re-pointed or merged call); a Lead EntityChange (create, or a phone/snapshot/RingCentral/Duplicate/Bad Lead/booked/cancelled/name/Job Number/rep path) nominates `lead-link:lead:<model>:<id>` keyed by a fingerprint of those inputs — post-commit from Form/Call Lead commands (`wakeLeadLinksAfterLeadCommand`, bounded 2 s) and Granot lifecycle applies (`wakeLeadLinksAfterChange`), and durably from the `entity_changes` cursor scan (scope `lead_link_entity_changes`, 2-minute commit-lag overlap) that job recovery runs every minute before draining the stage. A Lead job first mints the Lead's Contact Number (`leadContactNumber.ts` `ensureLeadContactNumber`: a Form Lead behind `SALES_INTELLIGENCE_FORM_LEAD_NUMBERS`; a Call Lead always, since outreach lifecycle repair C2b — a Call Lead whose phone had not called or been called since capture began had no number, so no link, desk `contact_number_ids: []` and no SMS association). The phones are the link's own four paths in mint order (outreach lifecycle repair CW1, `leadPhoneE164Candidates`, also used by the desk's `subjects-without-numbers` diagnostic and its C2c `no_contact_number` check): the live `normalized_phone_number`, for a Call Lead the caller of its creating call, then the intake and Granot snapshot phones. Duplicates, Bad Leads and Leads whose phones form no E.164 mint nothing. The phones are walked in that order (`leadNumberTarget`): the first with an existing E.164 row (purged or not) is reused untouched, our own DIDs (directory snapshot) are passed over, the first other phone is created, so the live phone is numbered whenever it is usable and a snapshot phone only when nothing before it is; only DIDs: nothing; a new row has zero calls, `created_via` `form_lead`/`call_lead`, `summary_version` 1 and the audit `contact_number_created_from_lead` (`current.lead_model`). It then recomputes every number the Lead can enter or leave (its phones' numbers, the minted one included, its creating call's number, the numbers that list it; ≤ 50), so the new link and its desk wake commit in the same job transaction.

## All Numbers list (`GET /numbers`, `allNumbers.ts`)

Query `view` (`all` default | `waiting`), `q`, `cursor`, `limit` (1–100, default 50). `all` sorts `(last_activity_at desc, _id desc)`; `waiting` keeps `waiting_since` set and sorts `(waiting_since asc, _id asc)` (index `contact_number_waiting`). `q` (`numberSearch.ts`): ≥ 10 digits = exact E.164 or suffix, 3–9 digits = suffix over `digits_reversed`, else an anchored prefix of `search_terms`. Keyset cursor bound to the view. Purged numbers are excluded. `data: { items: NumberRow[], cursor, counts: { all, waiting } }` (counts over the whole collection, ignoring `q`). A `NumberRow` carries `display` ("(555) 123-4567" for US), `caller_name` (newest caller-ID name), `source`, `lead` (LeadRef with `rep_name` and `desk_subject_id`), `lead_link` source, `last_call` (with `agent_name`: the reviewed Rep Identity Link of `rc_extension_id` effective at the call, any role but `excluded`; `callRep.ts`), `calls`, `waiting_since`, `first_seen_at`, `last_activity_at`. Batched: one page read, one subjects read, one links read.

## Number detail (`GET /numbers/:id`) and lead search (`GET /numbers/lead-search?q=`)

Detail: `{ number: NumberRow, other_leads, excluded_leads, calls (newest 100 counted calls: result, duration, agent_name, our_number = company DID, recordings count), more_calls }`; an unknown or purged id is 404. Lead search (the "Link to a lead" picker): non-duplicate Leads matching a Job Number prefix, a phone (ten digits exactly on the indexed paths, fewer anywhere in the live phone) or a name (case-insensitive, anywhere), newest first, at most 20, each with `phone`.

## Owner link command (`POST /numbers/:id/lead`)

Body `{ revision, lead: {model,id} | null, unlink?: {model,id} }`, exactly one of a non-null `lead` or `unlink`. `lead` pins (source `owner`, `set_at` now; the Lead leaves `excluded`); a Duplicate or missing Lead is 400 (`lead_duplicate` / `lead_not_found`). `unlink` adds the Lead to `excluded`; when it was the number's `lead` the link turns automatic and the next candidate (or none) takes over; unlinking another Lead keeps a pin. A stale `revision` is 409 `REVISION_CONFLICT`. Audit `number_lead_pinned` / `number_lead_unlinked` (kind `number`). Returns the detail `data`.

## Accounts (`repIdentity/accounts.ts`)

- `GET /accounts`: `{ directory_at, accounts, agents }`. One Account per User extension of each account's latest stored directory snapshot, plus a flagged (`in_directory: false`) row for a current reviewed link whose extension left the directory. `agent`, `role`, `link_id`, `link_revision` come from the extension's current **reviewed** link. `suggestion` (no Agent connected): the current proposed link's Agent, else the strongest unique name candidate (`proposeRepCandidates`: one exact full name, else one alias, else one first token). `can_message` mirrors the Message eligibility (`nudges/eligibility.ts`) without its per-send checks; `message_channels` (additive to the contract) names the channels it can use now, Team Messaging first (empty when `can_message` is false), so the Admin never guesses a channel the configuration refuses. `rc_account_id` is the User's RingCentral account (the `/nudges` command needs it). `agents`: active Agents by name.
- `POST /accounts/:extension_id/agent` `{ agent_id | null, role?, link_revision? }`: connect/change creates a **reviewed** link effective now (`role` defaults to the current role, else `sales_rep`); a reviewed current link is retired at the same instant (it keeps its review, so earlier calls keep their Agent) and a proposal is retired unreviewed. The successor takes direct numbers and the SMS sender from the directory and keeps the previous link's Team Messaging person and chat ids and Message channels (default `team_messaging`, `pager`). The same Agent and role is a no-op; `agent_id: null` retires the current link. `link_revision`, when given, must be the current reviewed link's revision. Audit `rep.account_connected` / `rep.account_ended`. Call attribution and desk credit read the effective link at use, so nothing is recomputed for them. The desk **assignment** is different: a subject is assigned to its Lead's `receiver_agent` only while that Agent has a reviewed `sales_rep` link, computed when the subject syncs. So in the same transaction every open desk subject the old or the new Agent receives or is assigned gets an `outreach_lead_change` job (`salesOutreach/subjects/agentWake.ts`; identity `sod:lead-change:<model>:<id>:account:<command id>`, which never dedupes against the Lead-revision job), and after commit the desk live stream (`outreach_desk`) is told for those subjects and Agents.
- `POST /accounts/suggest` (body `{}`): runs the directory proposal (`proposeRepLinks`) over every stored snapshot, page by page; returns the Accounts data.
- The Accounts **Message** action uses the retained `/nudges/preview` and `/nudges` ([sales-intelligence-nudges.md](sales-intelligence-nudges.md)).

## Coverage, directory sync, live

`GET /coverage` (`ownerCoverage.ts`, `coverage.ts`): capture coverage, Call Log capture, capture health and mapping hygiene; `unmapped_inbound_numbers` now counts non-purged numbers with no `lead`. The daily directory sync (`directorySync.ts`, `/api/cron/sales-intelligence-directory-sync`) appends a snapshot to `ringcentral_directory_snapshots` only when its digest changed. `GET /live` is [sales-intelligence-live.md](sales-intelligence-live.md).

## MCP canonical history (`sales-intelligence-history.routes.ts`, `history/`)

`GET /api/v1/internal/sales-intelligence/history/contact-number` (`phone` or `id`): the number's identity, `source`, caller-ID names, `calls`, `last_call`, `last_inbound_at`/`last_outbound_at`, `waiting_since`, and its `lead`, `other_leads` and `lead_link` (no classification, eligibility or rollups). `/lead-candidates`: each candidate carries `link` (`lead` | `other_lead` | `excluded` | null) for the number. `/lead`: the Lead with `contact_numbers[]` (`link: lead | other_lead`, `link_source`) instead of attachment edges. Gate, redaction and bounds are unchanged.

## Operator scripts (`ops/numbers-v2/`)

| Script | What it does |
| --- | --- |
| `pnpm numbers:migrate --target=<db> [--apply] [--limit=N] [--after=<id>] [--all] [--reseed]` | Dry run by default. Builds the three v2 indexes, then per number without `summary_version: 1` (one transaction each): seeds the link from its attachments (newest Owner-confirmed → Owner pin at `decided_at`; Owner-rejected → excluded; while `number_lead_attachments` exists), recomputes the link and the call summary, stamps `summary_version: 1`. Idempotent and resumable; `--all` re-runs stamped numbers (refreshes links, summaries and search terms). Prints counts. |
| `pnpm numbers:desk-resync --target=<db> [--apply]` | Phase B, once right after it deploys. The phase A migration wrote the links while the desk still read attachments, so nothing woke the desk. Dry run by default (counts only). Apply nominates `outreach_lead_change` for every open subject whose `contact_number_ids` differ from the link rule, and `outreach_contact_change` for every call since the earliest activation whose contact event does not credit its number's current Lead's subject (calls with no event yet are left to the contact sweep); the minute crons drain both. Identities carry `numbers-v2-switch`, so a rerun enqueues nothing new and a drained run leaves nothing to nominate. Skips when the desk configuration wants no contact evidence. `--all-open` (outreach lifecycle repair C2c): nominates `outreach_lead_change` for **every** open subject, drifted or not, so a changed subject rule (`cadence.no_contact_number_rule`) is recomputed at once; those identities carry `lane-c-review-rule-r<active configuration revision>` (a rerun under the same revision is a no-op, a later PATCH gets new ones); the summary adds `all_open`, `subjects_drifted` and `lead_change_tag`; apply is skipped with `configuration_not_active` (and `configuration_state`) when no configuration is active. The call drift check follows the active `evidence.call_association_rule` (summary `call_association_rule`): under `single_active_subject_on_link` a call credited to the single active `other_leads` subject is expected, not drift (`ops/lib/numbers-v2-desk-resync.ts`). |
| `pnpm numbers:mint-lead-numbers --target=<db> [--scope=desk\|all] [--limit=<n>] [--apply]` | Outreach lifecycle repair C2b, once after the deploy that mints Call Lead numbers (`ops/numbers-v2/mint-lead-numbers.ts`, pure parts in `ops/lib/numbers-mint-lead-numbers.ts`). `desk` (default): the Leads of every non-closed desk subject; `all`: every non-Duplicate Call Lead. Dry run by default (read-only): `leads_checked`, `numbers_reused` (the phone already has a number), `numbers_to_create` (by model), `skipped {no_phone, company_number, duplicate, bad_lead}`. `--apply` passes the production-writer guard, then one transaction per Lead: `ensureLeadContactNumber` (forced for Form Leads) and `recomputeLeadLink` for each of `numbersForLead`, whose desk wake enqueues `outreach_lead_change` / `outreach_contact_change` in that transaction; prints `applied {numbers_created, numbers_reused, links_changed, desk_subjects_nominated, failures}` and an `after` report. Idempotent: a rerun mints and links nothing. Counts only. |
| `pnpm numbers:cleanup --target=<db> [--apply]` | Dry run by default. Refuses while a non-purged number is unstamped. Drops the retired `contact_numbers` indexes, unsets the retired fields, drops `number_lead_attachments`. Idempotent. Point of no return for a phase A rollback. |

## Removed routes (404)

All Numbers phase B: `GET /numbers/:id/timeline`, `POST /numbers/:id/rebuild`, `GET /attachments`, `POST /attachments/attach`, `POST /attachments/:id/reject`, `POST /attachments/:id/detach`, `GET /reps`, `GET /reps/:id`, `POST /reps`, `POST /reps/propose`, `POST /reps/:id/review`, and the interim list's query keys (`sort`, `direction`, `classification`, `attachment`, `hygiene`, `has_recording`, `has_calls`, `include_form_only`, `active_from`, `active_to`). Earlier: `/attention*`, `/outreach/**`, `/followups/**`, `/restrictions/:id/resolve`, `/review-items*`, `/interactions/:id/contact-type`, `/numbers/:id/open-review`, `/numbers/:id/conversations`, `/numbers/:id/reanalyze`, `/conversations/**`, `/analysis-runs/**`, `/findings/**`, `/assessments/**`, `/roster`, `/overview*`, `/backfill`, `/api/v1/internal/sales-intelligence/runs/**`. The guard test is `src/routes/sales-intelligence-rep-access.test.ts` (`INTERIM_ADMIN_ROUTES`).
