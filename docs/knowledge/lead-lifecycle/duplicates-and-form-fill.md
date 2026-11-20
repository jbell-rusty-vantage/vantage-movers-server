---
okf_version: "0.2"
type: Reference
title: Duplicates and Form Fill
description: The Form duplicate rule, the 90-day Call repeat rule and the Form Fill rule, with how each flag routes a Lead and affects billing and CPL, at main 9955430d.
tags: [lead-lifecycle, call-lead, form-lead, duplicate, form-fill]
status: current
stale_after: 2027-01-20
resource: docs/knowledge/lead-lifecycle/
verified_at: 9955430d
applies_to:
  - src/services/ringcentral/ringcentral-duplicate-guard.ts
  - src/services/leads/duplicateLead.service.ts
  - src/services/leads/drainFormFillWork.ts
  - src/services/leads/formFillWork.ts
  - src/services/domainCommands/callFormFillBackfill.ts
  - src/services/domainCommands/entityChange.ts
  - src/services/leads/callLead.service.ts
  - src/services/leads/callLeadReportingDisposition.ts
owners: [team:main-server]
sources:
  - id: code
    resource: src/services/ringcentral/ringcentral-duplicate-guard.ts
  - id: formfill
    resource: src/services/leads/duplicateLead.service.ts
  - id: glossary
    resource: ../CONTEXT.md
    title: Platform glossary
---

# Duplicates and Form Fill

This page covers the three "this Lead is not new" rules: the Form duplicate rule, the 90-day Call repeat rule, and Form Fill. Every rule cites code at `main` `9955430d`; rules changed by Track A (PR #243) or PR #245 cite `25aecf5e`.

Related: [call-leads.md](call-leads.md), [form-leads.md](form-leads.md), [bad-leads.md](bad-leads.md), [granot-effects.md](granot-effects.md), [reporting-and-sheets.md](reporting-and-sheets.md) (full routing table), [README.md](README.md).

Locked Owner rule (2026-11-20): only RingCentral-queue-qualified Call Leads are minted and take part in the lifecycle. There is no backfill or major change on the Master Leads Calls tab; the Owner handles removals and inspection there manually.

## Form duplicate rule

A Form Lead is a [Duplicate Lead](../../../../CONTEXT.md) when an earlier, non-duplicate Form Lead in the **same exact Source Granularity** has the same phone number **or** the same email. The rule runs once, when the Form is minted. Nothing re-runs it later.

**Source:** `src/services/leads/duplicateLead.service.ts:findDuplicateFormLeadMatch` L78–L151 @ `9955430d` (cutoff constant L31). Callers: `src/services/leads/formLead.service.ts:prepareTheQuoteForIngestion` L357–L368 (paths M1–M3 in [form-leads.md](form-leads.md#minting-paths-at-a-glance)) and `src/services/employeeBookings/bookingLeadAttachment.service.ts:createAndAttachReconciliationFormLead` L149–L158 (M5). `createLeadFromGranot` (M4) does **not** call it.

| Part | Rule | Source |
|---|---|---|
| Scope | `source_granularity_id` equality only. Source Company is not compared. A missing granularity with contact present throws `"Duplicate Form Lead classification requires an exact Source Granularity"`. | L99–L103, L113 |
| Contact keys | Email: trimmed, lower-cased, exact equality. Phone: `normalizePhoneNumberForMatch` (`src/utils/phone.ts` L1–L21; 10-digit US form, `1` prefix dropped, fewer than 8 digits = no key). Mongo sieves with `buildPhoneRegex`, then each candidate is re-checked in memory. Either key matching is enough. | L86–L93, L126–L139 |
| No contact | Neither key → `duplicate: false` before any read. | L95–L97 |
| Eligible predecessor | Any Form in the granularity with `duplicate ≠ true` and a timestamp in the cohort window. **Bad, Booked, Cancelled, No-Sync and Granot-minted Forms all count.** There is no `bad_lead`, `booked`, `no_sync` or origin filter. | L111–L118 |
| Time window | No rolling window. Cohort split at `FORM_DUPLICATE_CUTOFF = 2026-04-30T04:00:00.000Z`. A Form timestamped before the cutoff compares with every earlier Form (`timestamp < event`). A Form at or after the cutoff compares only with Forms in `[cutoff, event)`. The comparison is strict, so an equal timestamp never matches. | L31, L104–L107 |
| Clock | The stored Form `timestamp`. On M1–M3 and M5 that is the NY wall clock stored as UTC (`toFloridaTimestamp`). The cutoff therefore lands at **April 30 04:00 NY wall time** for those Forms, and at April 30 00:00 NY for real-UTC Granot timestamps. Mixed clocks also skew "earlier" by 4–5 hours between a Granot-minted predecessor and a WordPress Form ([form-leads.md](form-leads.md#timestamp-clocks-differ-by-path)). | `formLead.service.ts` L356; `createLeadFromGranot.ts` L715 |
| Idempotency | The rule is a pure read in the create transaction (M1–M3 pass the session; M5 does not). The result is stored on the new Form's `duplicate` and never recomputed. Replay of the create command replays the stored result. | — |
| Output | `{ duplicate, matchedBy: "email" \| "phone" \| "both" \| null, matchedLeadIds }`. Only `duplicate` is persisted. `matchedBy` and the count are logged (`lead.form.duplicate_detected`). The matched Lead IDs are not stored. | L141–L150; `formLead.service.ts` L582–L591 |

### What a duplicate flag changes at minting

| Effect | Duplicate Form | Source |
|---|---|---|
| Sheet tab | Duplicate Forms (unless bad, which wins → Bad Form Leads) | `src/services/googleSheets/leadReportingTargets.ts:formLeadTargets` L32–L39 |
| CPL stored | Full rate, `cpl_resolution_status: resolved`. Forms never get `duplicate_zero`. Billing exclusion is a reader decision ([reporting-and-sheets.md](reporting-and-sheets.md)). | `formLead.service.ts` L374–L379; `cplCorrections.ts` L602, L1355 |
| CRM Posting | Never (`post_to_granot = requested && !duplicate`) | `formLead.service.ts:decideWhetherToPostToGranot` L412–L417 |
| Lead message | Recorded as `skipped`, reason `duplicate_lead` | `leadMessaging.service.ts:persistLeadMessageIntent` L140–L145 |
| Inline Form Fill | Not run | `formLead.service.ts` L469 |
| `form_fill_work` | Still scheduled; the drain skips a duplicate Form | `formLead.service.ts` L465; `drainFormFillWork.ts` L37–L41 |
| Daily Operations | `form_lead.duplicate`, dedupe `form_lead:<id>:duplicate` | `recordDomainFacts.ts` L181–L198 |
| Extension lookup | `GET /api/v1/form-leads/:id` returns 404 | `formLead.service.ts:findFormLeadForEnrichment` L885–L900 |
| Corrections | `quoted`, `cubic_feet`, extension receiver and any `bad_lead` patch → 409 | `refuseIllegalCorrections` L714–L750 |
| Later Forms | A duplicate never counts as a predecessor | L114 |

### Transitions after minting

| Event | What happens to `duplicate` | Sheet consequence | Source |
|---|---|---|---|
| The earlier Form is deleted | Nothing. The later Form stays a duplicate. No re-classification. | None for the later Form. The deleted Form's tombstone removes its own row from every Form tab. | `formLead.service.ts:beginFormLeadRemoval` L930–L984 |
| The earlier Form becomes Bad | Nothing. A Bad Form still counts as a predecessor for future Forms. | Only the earlier Form moves to Bad Form Leads. | L111–L118 |
| The earlier Form's phone, email or granularity is corrected | Nothing for existing duplicates. Future Forms compare against the new values. | — | `correctFormLead` L606–L670 |
| A later Form's contact or granularity is corrected | Nothing. `updateSourceOwnedLead` does not re-run the rule. | — | same |
| **Duplicate repair: Owner sends `duplicate: false`** | Flag cleared. `updateFormLeadSchema` accepts it; `omitForbiddenLeadLifecycleFields` does not strip it. | Upserts Forms and, since `25aecf5e`, removes the old Duplicate Forms row (old and new titles) after the upsert succeeds (before `25aecf5e` it stayed, because the non-bad stale keys were Bad Form Leads only). | `leads.validation.ts` L155–L164; `leadReportingTargets.ts:staleFormTargetKeys` L48–L53 @ `25aecf5e`; tests "Form that stopped being a Duplicate upserts Forms and removes old and new Duplicate Forms titles" and "Form that became a Duplicate upserts Duplicate Forms and removes its Forms row without metadata" |
| **Duplicate repair: Owner sends `duplicate: true`** | Flag set. | Upserts Duplicate Forms and, since `25aecf5e`, removes the old Forms row after the upsert succeeds (before, it stayed). | same |
| Either repair | CPL is not repriced (the patch is not source- or timestamp-affecting). `form_fill_work` is rescheduled (path `duplicate` changed). Calls already flipped to `form_fill` by this Form are not un-flipped by this path ([Form Fill](#form-fill-rule)). | — | `domainCommands/entityChange.ts` L418–L421 |

Effects of a repair: EntityChange path `duplicate` under `updateSourceOwnedLead`; Sheet Sync `source_lead` / `form_lead.update` (or booking chain when Booked); Outreach sees the change through the `sales-outreach-lead-changes` tail; no Daily Operations fact. Production on 2026-11-20 shows **zero** `duplicate` changes after creation on FormLead `entity_changes` (any command), so every current Form `duplicate` value is its minting value or pre-dates change history.

**Precedence.** Bad beats duplicate for the tab ([bad-leads.md](bad-leads.md#bad-form-leads)). Duplicate beats `no_sync` (a No-Sync duplicate still projects to Duplicate Forms, `src/services/sheetSync/noSyncLead.ts` L29). The Form duplicate flag never affects a Call's repeat `duplicate`; it only stops the Form from triggering Form Fill.

**Production reconciliation input (read 2026-11-20 12:44 NY, coordinator scan).** One non-duplicate Form sits on both Forms and Duplicate Forms. It is `legacy_unknown`, created 2026-05-28, with `sheet_sync[]` entries only for `master_forms` and `source_forms`. Its Duplicate Forms row was explained by the pre-`25aecf5e` rule: when a non-bad Form's `duplicate` flipped, the opposite primary row was never deleted. The session coordinator deleted that row at 13:15 New York on November 20, and under the current rule (PR #245) a re-delivery removes such a row. The flip predates change history (no `duplicate` EntityChange exists), so the exact writer is not recoverable from Mongo. A re-delivery today would also leave the row. Removal needs an explicit cleanup or a planner change.

### Worked example: a Form on Duplicate Forms

Read-only production trace, 2026-11-20 12:49 NY. Customer B, phone `+1555555xxxx`.

1. **2026-11-19 19:04:03 UTC.** The TBM landing page posts `POST /api/v1/form-leads`. Origin `wordpress_form`. Source `tbm_leads` / `tbm_leads_form` ("TBM Forms"). `timestamp: 2026-11-19T14:04:04.825Z` (NY wall clock). Delivery ZIP had no state → `delivery_state: not_found` → `local: local`.
2. **Duplicate check.** An earlier non-duplicate TBM Forms Form in the `[2026-04-30T04:00Z, 14:04:04Z)` cohort matched by phone or email. `createFormLead` revision 0→1 stored `duplicate: true`, `post_to_granot: false`, `no_sync: false`, `cpl: 205`, `cpl_resolution_status: resolved` (full rate).
3. **Sheet Sync.** `form_lead.create` synced at 19:05:04: `sheet_sync[0] = { target: master_duplicates, tab_name: "Duplicate Forms", row_number: 196 }`.
4. **Afterwards.** No further revisions. No CRM post, no inline Form Fill, Daily Operations `form_lead.duplicate`.

## Form Fill trigger from a new Form

This section covers only how a new Form starts Form Fill. The Form Fill rule itself, its reversal and its billing effect are in [Form Fill](#form-fill-rule).

| Trigger | When | Scope and limits | Source |
|---|---|---|---|
| Inline flip | M1–M3 and M5 create, only when the new Form is **not** a duplicate, inside the create transaction | `markMatchingCallLeadsWithFormFill`: same Source Company (`lead_source_company`, or the legacy `source_company` slug when the Call has no canonical company), reporting-eligible Calls (`reportingEligibleCallLeadFilter`), `form_fill ≠ true`, same normalized phone; **first 25 candidates by `_id`**. Each flip writes a CallLead `form_fill` EntityChange (`markCallLeadFormFill`, Form-fill detector actor) and a `call_lead.form_fill.update` Sheet job persisted with the Form. No time window, no granularity match. | `formLead.service.ts` L469–L480; `duplicateLead.service.ts` L221–L306; `bookingLeadAttachment.service.ts` L188–L198 |
| Durable work | Every new Form (duplicate or not) on M1–M3; every Form EntityChange that touches `phone_number`, `source_company`, `lead_source_company`, `source_granularity_id` or `duplicate` (so M4 and M5 too) | Upserts `form_fill_work` `FormLead:<id>` with a fresh generation and `after_id: null`; `drainFormFillWork` pages through the rest (20 pages of 25 per tick) and skips duplicate Forms. | `formFillWork.ts` L5–L9; `entityChange.ts` L418–L421; `drainFormFillWork.ts` L16–L75 |
| Not a trigger | Form deletion, `bad_lead`, `no_sync`, CPL corrections | Deletion writes a `$deleted` mutation, which skips scheduling. | `entityChange.ts` L418 |

## 90-day Call repeat rule

A **Duplicate Lead** on the Call side is a qualified Call from the same caller to the same Source Granularity as an earlier eligible Call within 90 days. It is stored as `duplicate: true`.

| Rule | Detail |
|---|---|
| **Source** | `src/services/ringcentral/ringcentral-duplicate-guard.ts:classifyRingCentralCallLeadDuplicate` L110–L175, `defaultDeps.findRecentCallLeads` L76–L107, `isUnresolvedGranotCandidate` L177–L188 @ `9955430d` |
| **Scope** | Exact `source_granularity_id` from the resolved RingCentral route (the mapped inbound number's Source Granularity). Source Company alone is never the boundary; `sourceCompany` is passed but not queried. A missing Source Granularity throws. |
| **Caller match** | `normalized_phone_number` equal to `normalizePhoneNumberForMatch(caller)`, re-verified in memory against `phone_number` (L142–L145). No caller phone → `isDuplicate: false`, reason `no_caller_phone`. |
| **Eligible predecessor** | Passes `reportingEligibleCallLeadFilter()` (RingCentral-qualified, Best Relocation historical inventory, or trusted final admission; [call-leads.md](call-leads.md#5-reporting-admission-what-is-an-admitted-call)) **and** `duplicate !== true`. Not excluded: `form_fill`, external bad review, overnight Missed, `booked`, `cancelled`, `no_sync`, `created_on_unmatched`. Excluded: the same physical call (same telephony session, session or Call Log id), the adopted Lead itself (`callLeadIdToExclude`), and a still-pending or conflicted Granot-created Call with no RingCentral identity. |
| **Window** | `timestamp ≥ t − 90 days` and `timestamp < t` (L128–L131, L89). Lower bound inclusive, current instant exclusive: earlier-only. `RINGCENTRAL_CALL_LEAD_DUPLICATE_WINDOW_DAYS = 90` is hard-coded (L8). `RINGCENTRAL_DUPLICATE_WINDOW_HOURS` (default 24) is display metadata only (`ringcentral-config.ts` L156–L158). |
| **Clock** | `t = toFloridaTimestamp(call start)`: the New York wall-clock of the call start, stored as if UTC, compared with the same-shaped stored `timestamp` of earlier Calls. 90 days are 90 × 24 h on that axis. |
| **Precedence** | Runs after the idempotency skip and after adoption, before create (ingest L277–L287). For adoption it runs again inside the transaction with the adopted Lead excluded (`callLeadConvergence.service.ts` L500–L511). Call Log sync ingests oldest-first so a same-run earlier call is seen. A later call that arrives by webhook before an earlier call reaches the cron can still miss its predecessor. |
| **Chaining** | Duplicates never serve as predecessors. The clock runs from the latest **non-duplicate** eligible Call, not from the latest call. Example: calls on day 0, 60 and 120 → day 60 is a duplicate; day 120 has no non-duplicate predecessor in [day 30, day 120) and is new and billable. |
| **Idempotency** | Pure read; the result is stored on the Call (`duplicate`) and on the processed-call ledger (`duplicate`, `duplicateReason`). |
| **Effects** | Create stores `duplicate: true`, `cpl: 0`, `cpl_resolution_status: "duplicate_zero"` (base period kept). Ledger status `lead_created_duplicate` or `lead_adopted_duplicate`. Log `ringcentral.call_lead.duplicate_created`. Daily Operations kind `call_lead.duplicate` (`recordDomainFacts.ts` L238–L243). Sheet: Duplicate Calls. Billing: not billable. |
| **Ways out** | None automatic. The guard runs once, at create or adoption; it is never re-run. PATCH `duplicate: false` (manual) clears it and reprices (`callLead.service.ts` L570–L594); PATCH `duplicate: true` sets it, except on a booked Call (L494–L508). Production: one manual `duplicate` change (`updateSourceOwnedLead`, 2026-09-03). |

Production, read 2026-11-20 17:48 UTC: 320 Calls with `duplicate: true`; the ledger shows 243 `same_source_phone_within_window` and 1,551 `unique`.

### Worked example: a 90-day repeat Call

Read-only production, 2026-11-20 17:49 UTC. Identities anonymized: Customer A, phone `+1555555xxxx`.

| Step | Call P (predecessor) | Call R (repeat) |
|---|---|---|
| Arrival (New York) | 2026-10-21 17:29 | 2026-11-10 14:18 (19.87 days later) |
| Feed | Main Site Inbounds | Main Site Inbounds (same Source Granularity) |
| Qualification | `call_log_sync`, `call_log_inbound_target_elapsed_at_least_120s` | `call_log_sync`, same reason, 591.715 s |
| Guard result | `unique` | `same_source_phone_within_window`, predecessor Call P |
| Stored | `duplicate: false`, `cpl: 0` (`resolved`; this feed's rate is zero) | `duplicate: true`, `cpl: 0`, `cpl_resolution_status: "duplicate_zero"` |
| Final result | — | `Accepted`, answered |
| EntityChange | `createCallLead` | `createCallLead` (paths include `duplicate`) |
| Sheet | Calls | Duplicate Calls (`master_duplicate_calls`, synced) |
| Billable | yes (disposition `calls`) | no (`repeat_call_duplicate`) |

A second repeat from Customer A at 10:32 New York on the same day also points at Call P, because Call R is a duplicate and cannot be a predecessor.

## Form Fill rule

A **Form Fill** Call is a qualified Call from a caller who already has a non-duplicate Form Lead under the same overarching Lead Source Company. It is stored as `form_fill: true`.

### The rule as the Owner confirmed it on November 20

- A Call Lead is created only when it qualifies through the RingCentral inbound queue (≥ 120 s elapsed and a caller phone).
- **Matching Form:** the Call gets `form_fill: true` when a non-duplicate Form Lead has the same normalized phone under the same `lead_source_company`. When the canonical company is absent, the legacy `source_company` slug is used.
- **No time window, both directions:** `hasFormFillForCallLead` runs at Call creation; `markMatchingCallLeadsWithFormFill` flips qualified Calls when a later Form arrives.
- **Tab:** a Form Fill Call routes to Duplicate Calls and is not billable.
- **Granot updates:** the Call can still receive Granot updates throughout its lifecycle and stays on Duplicate Calls.

The code matches each point. The details follow.

### Source scope (both directions)

`buildSourceMatchFilter` (`src/services/leads/duplicateLead.service.ts` L61–L76):

- With a canonical company on the scope Lead: match `lead_source_company = X` **or** (`lead_source_company` null **and** `source_company = slug`). The slug fallback applies per candidate Lead that has no canonical company.
- With no canonical company on the scope Lead: match `source_company = slug` only.
- Granularity is not part of the scope. A Form on the "Forms" feed matches a Call on the "Inbounds" feed of the same company.

### Direction 1: at Call creation (`hasFormFillForCallLead`)

| Rule | Detail |
|---|---|
| **Source** | `duplicateLead.service.ts:hasFormFillForCallLead` L178–L204; called by `callLead.service.ts:detectFormFill` L336–L345 from `beginRingCentralCallLeadIngestion` L216–L223 @ `9955430d` |
| **Match** | Form Leads in scope with `duplicate !== true` and `phone_number` matching the phone regex, re-verified by normalized equality, paged 100 at a time by `_id`. |
| **Not checked** | Form `bad_lead`, external bad review, booking, deletion state, timestamp. A Bad Form Lead still makes a Call a Form Fill (finding R2-F5). |
| **Window / clock** | None. Any Form in history counts, before or after the Call's arrival time. |
| **Idempotency** | Runs once inside the create transaction with the same session. |
| **Effects** | `form_fill` is written in the same insert; it appears in the `createCallLead` EntityChange paths. Log `lead.call.form_fill_detected` after commit. No separate command. |

**How `form_fill` is written in production.** Production `entity_changes` (read 2026-11-20 17:37 UTC) has zero `markCallLeadFormFill` and zero `repairCallFormFillForReporting` rows, yet 116 Calls have `form_fill: true`. The only commands that ever changed `form_fill` on a Call are `createCallLead` (24 of 423 creates wrote `form_fill: true`), `admitBestRelocationFinalCallV1` (Nov 4 final import, which also used `hasFormFillForCallLead`) and `createLeadFromGranot` (8 historical Granot-created Calls). The remaining Form Fill Calls are `legacy_unknown` history set before change history began. In practice every Form Fill Call so far got its flag at insert. No later Form has yet matched an eligible Call that lacked the flag.

### Direction 2: when a later Form arrives (`markMatchingCallLeadsWithFormFill`)

| Rule | Detail |
|---|---|
| **Source** | `duplicateLead.service.ts:markMatchingCallLeadsWithFormFill` L221–L306 @ `9955430d` |
| **Callers** | (1) Form create, inside its transaction, for a non-duplicate Form (`formLead.service.ts` L464–L479). (2) Reconciliation Form create during booking attachment (`employeeBookings/bookingLeadAttachment.service.ts` L188–L198). (3) The durable drain for any Form whose identity changed (below). |
| **Candidates** | Calls in scope, `reportingEligibleCallLeadFilter()`, `form_fill !== true`, `normalized_phone_number` or `phone_number` matching, re-verified by normalized equality; 25 per page by `_id`. Excluded, 90-day duplicate, `created_on_unmatched` and booked Calls are not filtered out beyond the admission filter: an admitted repeat or booked Call can gain `form_fill`. |
| **Writes** | `form_fill = true` via document save. |
| **Idempotency** | `form_fill !== true` filter; one `command_execution_id` per Form across its flips; system actor `FORM_FILL_DETECTOR_ACTOR_ID`, payload `{ form_lead_id }`. |
| **Effects** | EntityChange `markCallLeadFormFill`, path `form_fill`; Sheet `call_lead.form_fill.update` per Call (moves the row to Duplicate Calls and deletes the stale Calls row); Outreach Lead-change feed; no Daily Operations fact. |

### Durable follow-up (`drainFormFillWork.ts`)

| Rule | Detail |
|---|---|
| **Source** | `src/services/leads/formFillWork.ts:scheduleFormFillWork` L5–L9; `domainCommands/entityChange.ts` L418–L421; `src/services/leads/drainFormFillWork.ts:drainFormFillWork` L16–L76; trigger `routes/sheet-sync-cron.routes.ts` L22–L39 @ `9955430d` |
| **Schedule** | Every Form or Call EntityChange (not a delete) whose paths touch `phone_number`, `source_company`, `lead_source_company`, `source_granularity_id`, `duplicate`, `ringcentral` or `external_call_admission` upserts `form_fill_work` `_id: "<model>:<id>"` with a new `generation`, `after_id: null`, `due_at: now`, in the same transaction. Creates, Granot syncs that change the phone, adoption and PATCH all schedule it. |
| **Drain** | Runs at the start of `/api/cron/sheet-sync-drain` (every 5 min) only when `SHEET_SYNC_MODE` is `queued`. Up to 20 pages per tick. Form task: if the Form exists and is not a duplicate, `markMatchingCallLeadsWithFormFill` for one page of 25, cursor in `after_id`. Call task: if the Call exists, lacks `form_fill`, passes `hasReportingEligibleCall`, and `hasFormFillForCallLead` is true, set `form_fill` and emit `markCallLeadFormFill`. |
| **Idempotency** | Task row guarded by `{ _id, generation }`; cursor and effects commit atomically; a newer generation from a concurrent correction restarts the cursor. Failure defers the task 60 s. |
| **Effects** | As direction 2, plus `call_lead.form_fill.update` Sheet intents, finalized after commit. |
| **Production** | `form_fill_work` is empty (read 2026-11-20 17:48 UTC). |

### Owner-authorized repair (`repairCallFormFillForReporting`)

| Rule | Detail |
|---|---|
| **Source** | `src/services/domainCommands/callFormFillBackfill.ts:repairCallFormFillForReporting` L10–L49 @ `9955430d` |
| **Status** | historical-only. Its only caller is the November 1 general Call backfill library (`ops/best-relocation-retirement/callBackfill.ts:applyCallBackfill` L288–L338), whose runner was removed in `226dba24`. Zero production rows: the Nov 3 run found no Call that needed it. |
| **Preconditions** | `provenance.origin: "vantage_admin"` and an Owner/admin actor; the Call passes `hasReportingEligibleCall`; expected `domain_revision` matches; `hasFormFillForCallLead` still true. Already `form_fill` → no-op. |
| **Effects** | `form_fill = true`; EntityChange `repairCallFormFillForReporting`; Sheet `call_lead.form_fill.update`. Idempotency: the caller's canonical key (`call-backfill:form-fill:<checksum>`). |

### `markCallLeadFormFill` and `detectFormFill`

- `markCallLeadFormFill` is not a function. It is the `command_name` stamped by `markMatchingCallLeadsWithFormFill` and by the Call branch of `drainFormFillWork`. Status: current; 0 production rows.
- `detectFormFill` is the private wrapper in `callLead.service.ts` L336–L345 around `hasFormFillForCallLead`.

### When the Form goes away

`form_fill` never clears. No code path writes `form_fill: false` on a Call. Deleting the Form, marking it a duplicate, or marking it bad leaves the Call on Duplicate Calls with `form_fill: true`. The rule only ever adds the flag (finding R2-F6).

### Granot updates on a Form Fill Call

> Re-verified against the Track A merge (PR #243, `15987e9c`; `main` = `25aecf5e`) on November 20. Rules changed by Track A cite `25aecf5e`. The sibling gate is unchanged, and scheduled runs now also catch a Call up from an already-current Form (bounded, 50 promotions per plan, 6-hour Form backoff; [granot-effects.md §6](granot-effects.md#6-scheduled-estimates-runs-follow-ups-for-already-current-leads)).

A Form Fill Call keeps receiving Granot updates and stays on Duplicate Calls. There are two job paths:

1. **Granot matched the Call directly.** `synchronizeLeadFromGranot` writes the job, priority, receiver and move facts on the Call itself. The Sheet planner re-derives the disposition on each update; `form_fill` still routes it to Duplicate Calls. The reference case below took this path.
2. **Form→Call sibling mirror.** When Granot updates the customer's Form Lead, `mirrorFormLeadToCallSibling` copies the job, priority and receiver onto the qualified Call and sets `granot_form_sibling`. Its gate `eligibleSibling` (`granotLifecycle/callLeadFormSibling.ts` L121) requires `hasReportingEligibleCall`, `duplicate !== true` and `created_on_unmatched !== true`; `form_fill` is not checked. Sheet work for the mirror is enqueued only when the Call already has a synced Call row and is not excluded (`hasSyncedCallsRow`, L245–L249 @ `25aecf5e`). A Form Fill Call passes and is updated in place on Duplicate Calls. Full rule: [granot-effects.md](granot-effects.md).

## How each flag routes and bills

Owned in full by [reporting-and-sheets.md](reporting-and-sheets.md). The Call side of these flags, from `getCallLeadReportingDecision` (`leads/callLeadReportingDisposition.ts` L18–L39) and `billableCallLeadFilter` (L42–L74):

| Admitted Call with | Disposition | Billable | Stored CPL | Reason codes |
|---|---|---|---|---|
| `duplicate: true` (90-day repeat) | Duplicate Calls | no | 0 (`duplicate_zero`) | `repeat_call_duplicate` |
| `form_fill: true` | Duplicate Calls | no | full rate (not zeroed) | `form_fill` |
| trusted review `duplicate_call` | Duplicate Calls | no | as stored | `external_form_fill` or `external_duplicate` |
| any duplicate flag plus a bad reason | Duplicate Calls (duplicate wins) | no | as above | both kept |
| none of these, not bad | Calls | yes | as stored | — |

Not admitted, or `created_on_unmatched: true` → excluded from every Call tab, not billable, whatever the flags. Billing and Insights price from the disposition; a Form Fill Call's stored CPL is never charged. The Form duplicate side is in the [Form duplicate rule](#form-duplicate-rule).

Move between tabs: the planner always upserts the current disposition tab and deletes the Lead's row from the other two Call tabs (`sheetSync/drainer/jobPlanner.ts` L181–L193). A Call that gains `form_fill` moves from Calls to Duplicate Calls on its next Sheet job.

## Owner reference case: Call `6ae907f26f28ecf54e7aff42`

Read-only production trace, 2026-11-20 12:48 NY (`entity_changes` for this ID; no contact data).

| # | Applied (UTC) | Command | Changed paths | Revision |
|---|---|---|---|---|
| 1 | 2026-11-02 22:00:17.831 | `createCallLead` | 26 paths incl. `form_fill`, `duplicate`, `ringcentral`, `cpl*`, `source_*`, `no_sync`, `timestamp` | 0 → 1 |
| 2 | 2026-11-02 22:00:47.113 | `synchronizeLeadFromGranot` | `job_no`, `normalized_job_no`, `granot_priority`, `receiver_agent*`, move and location fields, `quoted`, `granot_contact_snapshot`, `last_accepted_granot_observation`, `current_move_provenance` | 1 → 2 |
| 3 | 2026-11-02 23:28:20.061 | `synchronizeLeadFromGranot` | `current_move_provenance`, `granot_contact_snapshot`, `last_accepted_granot_observation` | 2 → 3 |
| 4 | 2026-11-03 00:36:23.200 | `synchronizeLeadFromGranot` | `current_move_provenance`, `granot_priority`, `last_accepted_granot_observation` | 3 → 4 |
| 5 | 2026-11-03 14:23:29.133 | `confirmGranotBooking` | `booked` | 4 → 5 |
| 6 | 2026-11-03 22:26:10.619 | `recordRingCentralFinalCallLogResult` | `ringcentral.final_result`, `final_result_answered`, `final_result_call_log_id`, `final_result_observed_at`, `ringcentral.start_time` | 5 → 6 |

Current state: TBM Prime Inbounds, `call_log_sync`, `call_log_inbound_target_elapsed_at_least_120s`, 689.246 s, started 2026-11-02 21:37 UTC; `form_fill: true` (set at insert by `hasFormFillForCallLead`), `duplicate: false`, `created_on_unmatched: false`, `no_sync: false`; `cpl: 205` (`resolved`, not zeroed); job 5567003, Granot priority 5, receiver from `granot_username_match`, booked; final result `Accepted`, answered, observed 2026-11-03 22:10 UTC; `granot_form_sibling` absent. Sheet: one entry, `master_duplicate_calls`, synced 2026-11-20 15:35 UTC.

What it shows:

- `form_fill` came from the create transaction, not from `markCallLeadFormFill`.
- The job arrived through Granot matching the Call directly (path 1 above), not through the sibling mirror.
- Granot updates and the booking kept it on Duplicate Calls with its CPL unchanged and not billable.
- Its final result was recorded by the November 1 general backfill on Nov 3, because it was created before results were written at create.

## Tests

| Rule | Tests | Kind |
|---|---|---|
| 90-day window boundaries, scope, adopted/unresolved exclusions | `ringcentral/ringcentral-duplicate-guard.test.ts` | unit |
| Adoption before duplicate | `ringcentral/ringcentral-call-lead-ingest.service.test.ts`, `ringcentral/callLeadConvergence.test.ts` | unit |
| Form Fill flip shares one execution and session | `leads/duplicateLead.service.test.ts` | unit |
| Duplicate wins, keeps bad reasons | `leads/callLeadReportingDisposition.test.ts` | unit |
| `hasFormFillForCallLead` at create, both directions, drain, company scope | `ops/call-billing-review/replica.ts` | replica (not run) |
| `repairCallFormFillForReporting` | `ops/best-relocation-retirement/callBackfill.test.ts` (plan/apply with injected repair) | unit |
| `form_fill` never clears | GAP | — |
