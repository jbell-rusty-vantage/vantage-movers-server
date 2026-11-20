---
okf_version: "0.2"
type: Reference
title: Bad Leads
description: Every path that makes a Form or Call bad, how it reaches Bad Form Leads or Bad Call Leads, and how a bad flag is reversed, at main 9955430d.
tags: [lead-lifecycle, call-lead, form-lead, bad-lead, sheet-sync]
status: current
stale_after: 2027-01-20
resource: docs/knowledge/lead-lifecycle/
verified_at: 9955430d
applies_to:
  - src/services/leads/callLeadReportingDisposition.ts
  - src/services/leads/externalSheetReview.ts
  - src/models/externalSheetReviewSchema.ts
  - src/services/domainCommands/ringcentralFinalResult.ts
  - src/services/sheetSync/drainer/jobPlanner.ts
owners: [team:main-server]
sources:
  - id: code
    resource: src/services/leads/callLeadReportingDisposition.ts
  - id: review
    resource: src/services/leads/externalSheetReview.ts
  - id: glossary
    resource: ../CONTEXT.md
    title: Platform glossary
---

# Bad Leads

A **Bad Lead** is a Lead that arrived but is not a real moving opportunity. Bad Forms go to Bad Form Leads. Bad Calls go to Bad Call Leads. Neither is billable. Every rule cites code at `main` `9955430d`.

Related: [form-leads.md](form-leads.md), [call-leads.md](call-leads.md), [duplicates-and-form-fill.md](duplicates-and-form-fill.md), [reporting-and-sheets.md](reporting-and-sheets.md) (routing table), [README.md](README.md).

Locked Owner rules: only RingCentral-queue-qualified Call Leads are minted and take part in the lifecycle (2026-11-03, restated 2026-11-20). Bad Forms from the Best Relocation reconciliation move exclusively to Bad Form Leads (2026-11-03). There is no backfill or major change on the Master Leads Calls tab; the Owner handles removals and inspection there manually (2026-11-20).

## Bad Form Leads

A Form is a [Bad Lead](../../../../CONTEXT.md) when it has a canonical `bad_lead` reason **or** a trusted Best Relocation checker review of kind `bad_form`. Either one routes the Form exclusively to Bad Form Leads. The bad mark never changes `duplicate`, `booked`, `cancelled`, CPL or `no_sync`.

**Projection predicate.** `src/services/googleSheets/leadReportingTargets.ts:hasFormBadProjection` L25–L27 @ `9955430d`: `Boolean(lead.bad_lead) || hasTrustedExternalSheetReview(lead.external_sheet_review, ["bad_form"])`. The trust check is a full Zod parse of the fixed review contract (`src/services/leads/externalSheetReview.ts:externalSheetReviewSchema` L7–L24, `hasTrustedExternalSheetReview` L28–L31): policy `best-relocation-retirement-v1`, the Best Relocation tracker workbook ID, tab and sheet ID that agree with the kind, a 64-hex content hash, run and receipt IDs. A malformed or partial review is ignored.

### Paths that make a Form bad

| # | Path | Status | Source | Restrictions |
|---|---|---|---|---|
| B1 | **Canonical mark-bad:** `PATCH /api/v1/form-leads/:id` with `bad_lead: <reason>` → `updateSourceOwnedLead` → `correctFormLead` | Current. The only live writer of `bad_lead`. 242 production revisions, Aug 20 – Nov 8, 2026. | `src/routes/v1.routes.ts:handleUpdateFormLead` L2279–L2313; `src/services/domainCommands/existingWrites.ts:runExistingUpdateSourceOwnedLead` L179–L265; `src/services/leads/formLead.service.ts:refuseIllegalCorrections` L714–L750, `applyTheAllowedPatch` L752–L766 | Reason must be one of `FORM_LEAD_BAD_LEAD_REASONS` (`src/config/domain/sheets.ts` L77–L83): `disconnected_number`, `bad_phone_email_name`, `auto_only`, `international_move`, `legacy_bad_tab` (`src/validation/v1/leads.validation.ts:updateFormLeadSchema` L159). A Form that is a duplicate, Booked or Cancelled → 409 `"Cannot mark a duplicate, booked, or cancelled form lead as bad"`. The guard fires on the **presence** of the key, so `bad_lead: null` is refused too. Actor: extension owner, or API secret with Owner/Admin headers, or bare API secret (system). Scoped keys are limited to exact method + path entries (`src/middleware/requireApiSecret.ts:isRouteAllowed` L369–L376), so an `/:id` route is not reachable with one in practice. |
| B2 | `legacy_bad_tab` reason | Migration-only meaning. Production 2026-11-20: **0** Forms carry it. | enum above | Not derived from cell colour. Nothing in `src/` assigns it at `9955430d`. B1 would accept it from a client. |
| B3 | **Trusted checker review at creation** (exception Forms) | Historical only, Nov 3–4, 2026. Code deleted in `226dba24`. | `226dba24^:src/services/domainCommands/bestRelocationFinalLead.ts:finalFormCreateAuthorization`; `226dba24^:src/services/leads/formLead.service.ts` (`external_sheet_review` on insert) | The released frozen plan's `Bad Lead Checker` cell went through `classifyExternalReview` (`externalSheetReview.ts` L34–L47, still in code): string, trimmed length **> 2**, not an error or header cell, ≤ 4,000 characters. Result `kind: "bad_form"`, `reason_code: "external_bad_form"`, raw and NFKC-normalized text. Production: 270 `best_relocation_sheet` Forms carry it (212 non-duplicate, 58 duplicate). |
| B4 | **`reconcileExternalSheetReviewV1`** on existing Best Relocation Leads | Historical only. 168 FormLead and 3 CallLead revisions, 2026-11-04 01:04–01:43 UTC. Code deleted in `226dba24`. | `226dba24^:src/services/domainCommands/externalSheetReview.ts:reconcileExternalSheetReview` L44–L99; runner `226dba24^:ops/best-relocation-retirement/run.ts` L232–L253 | Context had to be `external_sheet_ingestion` with `source_connection_key: best_relocation` and a fixed payload checksum (L26–L34, L46–L47). Inside the transaction: the `ingestion:best_relocation:apply` lease held, the `best_relocation` connection not retired, target `source_company === "best_relocation_leads"`, `domain_revision === expected_revision` (L65–L90). Same classification as B3. An identical fact was a no-op (`sameReview`, L35–L41, L79). A blank cell cleared the fact only as an explicit correction with the previous hash and the same source namespace (L80–L83, L88). **It never wrote or cleared `bad_lead` or `duplicate`**, and it applied to duplicate, Booked and Cancelled Forms without the B1 guard. Effects: `$set`/`$unset external_sheet_review`, one EntityChange path `external_sheet_review`, Sheet Sync `source_lead` / `form_lead.update` in the transaction, finalized after commit. Idempotency key `retirement-review:<checksum>`. Production review holders from B4: 122 `granot_lead_created`, 45 `legacy_unknown`, 1 other (168 total). |

No other path writes `bad_lead` or `external_sheet_review` on a Form at `9955430d`. `external_sheet_review` is in `PUBLIC_LEAD_FORBIDDEN_LIFECYCLE_FIELDS` (`src/models/granotLifecycleSchemas.ts` L380–L397) and is stripped from every public patch. New `external_sheet_ingestion` commands throw `"External sheet ingestion is permanently retired"` (`src/services/domainCommands/idempotency.ts` L86–L88); stored results can still replay. Granot sync, RingCentral, Form Fill, CPL corrections, bookings and Sheet Sync never set either field.

Production state, read 2026-11-20 12:49 NY: 598 Forms have `bad_lead` (429 `bad_phone_email_name`, 162 `disconnected_number`, 6 `auto_only`, 1 `international_move`); none is duplicate, Booked or Cancelled, so the B1 guard has held. 438 Forms carry a trusted `bad_form` review; 1 has both. Expected Bad Form Leads membership = 598 + 438 − 1 = 1,035, matching the coordinator's 12:44 NY count of 1,035 matched IDs.

### How a bad Form reaches Bad Form Leads

| Step | Rule | Source |
|---|---|---|
| Intent | B1 persists `source_lead` / `form_lead.update` (a booking-chain job when Booked) in the command transaction; B4 persisted `form_lead.update`; B3 persisted `form_lead.create`. | `formLead.service.ts:persistTheCorrectionAndRefreshTheBookingChain` L672–L685 |
| Destination | Bad beats duplicate and `no_sync`: upsert **Bad Form Leads** only. | `leadReportingTargets.ts:formLeadTargets` L32–L39; `src/services/sheetSync/noSyncLead.ts` L30 |
| Stale rows | Delete the Mongo ID from Forms and Duplicate Forms, including the transitional title "Duplicates". Targets come from the fallback list **and** every recorded `sheet_sync[]` entry with a stale key, so a missing `sheet_sync` entry does not block cleanup. | `staleFormTargetKeys` L42–L46, `staleFormTargets` L48–L51; `src/services/googleSheets/targets.ts:getDeleteTargets` L51–L81; `src/services/sheetSync/drainer/jobPlanner.ts:planSourceLead` L174–L182 |
| Order | Deletes for a document run only after all its upserts are `synced`; otherwise they are deferred with `destination_upsert_pending` and the retry re-plans from Mongo. | `src/services/sheetSync/drainer/batchWriter.ts:writeBatchedTargets` L58–L79 |
| Tab title | The tab was renamed from "Bad Leads" to "Bad Form Leads" on Nov 3 (`6febe214`). `resolveCompatibleSheetTitle` (`googleSheets/tabs.ts` L37–L51) writes to whichever of the two titles exists, and throws `sheet_title_conflict` when both exist; old `sheet_sync[].tab_name: "Bad Leads"` metadata still resolves. | `googleSheets/tabs.ts` L30–L33 (`RENAMED_FORM_TABS`) |
| Bad Lead cell | A trusted review prints its raw note, prefixed with `'` so it cannot run as a formula. Otherwise the canonical reason's label (`D/C number`, `Bad Phone-Email-Name`, `Auto Only`, `International Move`, `Legacy Bad Tab`). **The imported note wins when both exist.** | `src/services/googleSheets/projections/formLeadRow.ts:formBadReasonCell` L55–L63; `sheets.ts:FORM_LEAD_BAD_LEAD_SHEET_LABELS` L87–L93 |

**Effects of B1.** Sheet Sync as above. EntityChange path `bad_lead` under `updateSourceOwnedLead`. Outreach: the change reaches the `sales-outreach-lead-changes` tail ([downstream-consumers.md](downstream-consumers.md) owns what a bad Form means to the Desk). Daily Operations: none. CPL: unchanged; the stored CPL stays the full rate. Form Fill: not rescheduled (`bad_lead` is not a scheduling path, `domainCommands/entityChange.ts` L418–L421), and a Bad Form still counts as an eligible predecessor for the Form duplicate rule and as a non-duplicate Form for Form Fill (`duplicateLead.service.ts` L111–L118, L191–L196). **Precedence:** the B1 guard applies only to canonical `bad_lead`; the trusted review (B3, B4) routes duplicate, Booked and Cancelled Forms to Bad Form Leads while keeping their duplicate, Booking and Cancellation facts. **Time window:** none. **Clock:** command `now`. **Idempotency:** `request:updateSourceOwnedLead:<request id>`; a patch that changes nothing writes nothing.

### Reversing a bad flag

| Bad source | How it is reversed | Sheet consequence | Source |
|---|---|---|---|
| Canonical `bad_lead` on a Form that is not duplicate, Booked or Cancelled | `PATCH` with `bad_lead: null` (B1) | Upsert Forms (or Duplicate Forms); delete Bad Form Leads and "Bad Leads" by fallback target and recorded entries. | `staleFormTargetKeys` L45 |
| Canonical `bad_lead` on a Form that later became Booked or Cancelled | **No server path.** The B1 guard refuses clearing too. A Booked bad Form cannot exist today through B1, because the mark is refused once Booked, but a Form marked bad first and booked later keeps the mark. Granot booking confirmation skips Forms with `bad_lead` (`granotLifecycle/bookingConfirmation.ts` L326, `connectBookingToLead.ts` L241), so that state needs another booking path. | — | `refuseIllegalCorrections` L733–L749 |
| Trusted review (B3, B4) | **No current path.** Only B4's blank correction could clear it, and B4 is retired. | — | `226dba24` |

### Why rows were on the wrong tabs on November 20

Before `6febe214` (November 3), a bad Form was written **additively**: to its primary tab (Forms or Duplicates) **and** to "Bad Leads" (`6febe214^:src/services/sheetSync/drainer/jobPlanner.ts` L201–L229; `6febe214^:src/services/googleSheets/googleSheets.service.ts` L50–L75). Clearing the mark deleted the Bad Leads row only when `sheet_sync[]` had recorded it (`knownRowFor(…, "master_bad_leads")`). From November 3 the bad destination is exclusive and stale primaries are removed, but **only when a new Sheet Sync intent runs for that Lead**. No backfill re-delivered the Forms marked earlier.

| Coordinator finding (12:44 NY) | Explanation from code | Evidence |
|---|---|---|
| 592 bad Forms also on Forms | Marked bad before November 3 under the additive rule. Each had `sheet_sync[]` entries for `master_forms` / "Forms" and `master_bad_leads` / "Bad Leads", last synced by October 30. None had any EntityChange or Sheet job after November 3, so the exclusive rule never ran for them. Granot `already_current` observations update `last_accepted_granot_observation` without an EntityChange or Sheet job. 232 of the 592 have a B1 `bad_lead` change (Aug 20 – Oct 30). The other 360 have none: they were marked before change history began (365 of the 592 are `legacy_unknown`). | Read-only reads 2026-11-20 12:50 NY: `entity_changes` after 2026-11-03T20:54Z for these IDs = 0; `sheet_sync` shape `[master_forms:Forms, master_bad_leads:Bad Leads]` on 572 IDs (20 already re-delivered by then). |
| **Resolved 2026-11-20, 12:48–13:01 NY** | The coordinator, on Owner direction, queued the ordinary re-delivery (`source_lead` jobs, operation `bad_form_primary_cleanup`, `created_by: script`) for all 592. The current planner upserted Bad Form Leads and then removed the Forms row. Forms went from 8,406 to 7,814 rows, and each Lead is on Bad Form Leads once. Detail: [reporting-and-sheets.md](reporting-and-sheets.md). | Coordinator evidence `vantage-main-server/.tmp/bad-form-cleanup-2026-11-20/` |
| 5 non-bad Forms on Bad Form Leads | **Not produced by server code.** None of the five ever had a `bad_lead` or review EntityChange (three have no change history at all, one only a September CPL/`local` correction, one only create and Granot syncs). None has a `master_bad_leads` entry in `sheet_sync[]`. The server writes a Bad Form Leads row only for a bad projection and always records it. The rows were most likely moved or copied by an operator in the workbook. Under current code any re-delivery heals them: it upserts Forms and deletes every Bad Form Leads title by fallback target. | 3 `legacy_unknown` (only on Bad Form Leads), 1 `legacy_unknown` and 1 `wordpress_form` (on Forms and Bad Form Leads). |
| 2 non-bad Forms on no tab, `sheet_sync` says Forms synced | Same class: the last server write recorded a synced Forms row; the row is gone with no server delete (no tombstone, no stale-target delete for a non-bad, non-duplicate, non-No-Sync Form). A manual row deletion is the code-consistent explanation. A re-delivery would append the row again. | `wordpress_form`, created Oct 22 and Nov 11. |

### Worked examples

**Bad Form Leads (current exclusive rule).** Read-only production trace, 2026-11-20 12:50 NY. Customer C, phone `+1555555xxxx`.

1. **2026-11-08 00:38:26 UTC.** The Top10 landing page posts the form. `createFormLead`: origin `wordpress_form`, `top10_leads` / `top10_leads_form`, `timestamp: 2026-11-07T19:38:26Z` (NY wall clock), `duplicate: false`, `cpl: 190`, `resolved`. `form_lead.create` put it on Forms.
2. **2026-11-08 16:19:47 UTC.** The Owner marks it bad from Admin: `updateSourceOwnedLead`, path `bad_lead` → `disconnected_number`.
3. **16:20:01 UTC.** The `form_lead.update` job upserted Bad Form Leads row 1042, then deleted the Forms row. `sheet_sync[]` now holds only `{ target: master_bad_leads, tab_name: "Bad Form Leads", row_number: 1042 }`. The Bad Lead cell reads "D/C number". CPL stays 190.

**Bad Form on two tabs (pre-November 3 additive rule).** Customer D, TBM Prime Forms, `wordpress_form`, created 2026-08-25 02:48 UTC, `cpl: 205`. Granot linked job and receiver on Aug 25. On 2026-08-28 23:11 UTC `updateSourceOwnedLead` set `bad_lead: bad_phone_email_name`. The old planner wrote it to both Forms row 4573 and "Bad Leads" row 410 (both synced 23:12:59). Later Granot observations (latest Nov 19, `already_current`) queued no Sheet job, so the Forms row stayed until the November 20 cleanup.

## Bad Calls

A Call Lead has no `bad_lead` field (`src/models/CallLead.ts` L81–L190; production: 0 Calls carry one, read 2026-11-20 17:48 UTC). A Call is bad only by derivation in `getCallLeadReportingDecision` (`src/services/leads/callLeadReportingDisposition.ts` L18–L39). Two reasons exist: `external_bad_call` and `overnight_missed_call`.

| Step in `getCallLeadReportingDecision` | Effect |
|---|---|
| 1. Not admitted (`hasReportingEligibleCall` false) or `created_on_unmatched` | `excluded`, not billable. Bad reasons are never computed. |
| 2. Collect duplicate reasons | `repeat_call_duplicate`, `form_fill`, trusted review `external_form_fill` / `external_duplicate` |
| 3. Collect bad reasons | trusted review `external_bad_call`; `overnight_missed_call`; diagnostic `conflicting_final_result` (not bad) |
| 4. Route | any duplicate reason → Duplicate Calls; else any bad reason → Bad Call Leads; else Calls. Billable only on Calls. |

**Precedence: effective duplicate wins over bad.** A Call that is both a duplicate and bad goes to Duplicate Calls and keeps both reasons in `reason_codes` (L36–L38). The Mongo twin `billableCallLeadFilter` (L42–L74) and `billableCallLeadExpression` (L80–L100) apply the same rule before aggregation.

### Trusted imported bad-call review

| Rule | Detail |
|---|---|
| **Source** | `src/services/leads/externalSheetReview.ts:externalSheetReviewSchema` L7–L24, `hasTrustedExternalSheetReview` L28–L31, `classifyExternalReview` L34–L47; model `src/models/externalSheetReviewSchema.ts` L4–L19; reader `callLeadReportingDisposition.ts` L26–L28 @ `9955430d` |
| **Fact** | `external_sheet_review` with `kind: "bad_call"`, `reason_code: "external_bad_call"`, `policy_version: "best-relocation-retirement-v1"`, the Best Relocation tracker workbook, `source_tab: "Calls"` with sheet id 1191420872, non-blank `raw_value` / `normalized_value` (≤ 4,000), stable row id, 64-hex content hash, run and receipt ids, `applied_at` date. A partial or malformed fact is ignored by reporting. |
| **Classification at import** | A non-blank checker note on the tracker's Calls tab that is not `form fill`, `duplicate` or `duplicate call` became `bad_call`; those three became `duplicate_call`. Formula errors and header words were refused. |
| **Writers** | Historical-only. `reconcileExternalSheetReviewV1` (3 Call rows) and `admitBestRelocationFinalCallV1` (42 Call rows with review paths) wrote it on 2026-11-04 01:02–01:43 UTC. Both were removed in `226dba24` (2026-11-18). No code at `9955430d` writes `external_sheet_review`; it is a forbidden public patch field (`models/granotLifecycleSchemas.ts` L380–L384). |
| **Time window / clock** | None after import. |
| **Idempotency** | Was the import's checksum-bound command key. Nothing replays now. |
| **Effects** | Sheet: Bad Call Leads, unless a duplicate reason wins. Billing: not billable. Outreach and Daily Operations: see [downstream-consumers.md](downstream-consumers.md). |
| **Production** | 22 Calls with a `bad_call` review, all `best_relocation_sheet` with a final-import admission: 19 on Bad Call Leads, 3 on Duplicate Calls because they are also 90-day repeats. Most common normalized notes: "current customer" 6, "dead air" 5, "international number" 5. The coordinator's Sheet scan found 19 Mongo-ID rows on Bad Call Leads, all correctly placed. |

### Overnight missed call

| Rule | Detail |
|---|---|
| **Source** | `callLeadReportingDisposition.ts:isOvernightCallArrival` L9–L16 and `getCallLeadReportingDecision` L29–L35; Mongo twin L66–L72 @ `9955430d` |
| **Condition** | All of: `ringcentral.final_result` trimmed and lower-cased equals `missed`; `ringcentral.final_result_observed_at` is a Date; `ringcentral.final_result_call_log_id` is non-blank and equals `ringcentral.call_log_id`; the call arrival is overnight; and `ringcentral.final_result_answered === false`. |
| **Clock** | `ringcentral.start_time` (a BSON Date, the true call start) converted to the America/New_York hour; overnight is hour ≥ 1 and < 7, i.e. **[01:00, 07:00) New York**. DST is handled by the time zone. There is no fallback to `createdAt`, `timestamp` or any wall-clock string: a Call without `ringcentral.start_time` is never overnight. |
| **Conflict** | Same Missed evidence with `final_result_answered === true` adds `conflicting_final_result`, which is not a bad reason: the Call stays on Calls and stays billable. |
| **Not matched** | `Voicemail`, `Accepted`, unknown or absent results; a Missed result from a different Call Log id; arrivals at 07:00 or later. |
| **Where the facts come from** | The final Detailed Call Log record at create, or a later `recordRingCentralFinalCallLogResult` ([call-leads.md](call-leads.md#4-final-result-and-the-watermark-ringcentralfinal_result)). |
| **Precedence** | A duplicate reason wins (Duplicate Calls). |
| **Idempotency** | Pure derivation, recomputed on every read and Sheet job. |
| **Effects** | Sheet: Bad Call Leads on the next Sheet job for the Call (the create job, or the `call_lead.update` from the final-result command). Billing: not billable. The stored CPL is not zeroed. Daily Operations: no special fact. |
| **Production** | None today. Read 2026-11-20 17:50 UTC: 106 Calls carry `ringcentral.start_time`; only one arrived in [01:00, 07:00) New York and its result is `Accepted`. Three Calls have `Missed` / not answered, all arriving after 07:00 New York (07:27, 07:51, 09:06), so they stay on Calls. 1,693 qualified Calls (mostly before 2026-11-03) have no `start_time` and can never match. See findings R2-F3 and R2-F7. |

### Manual or Admin path

None. `updateCallLeadSchema` has no bad field and is strict (`validation/v1/leads.validation.ts` L256–L282, L297–L304). `external_sheet_review` and `ringcentral` are stripped from any patch (`omitForbiddenLeadLifecycleFields`, `leads/leadIngestionProvenance.ts` L222–L232). No Admin route writes either. The only manual bad or duplicate move for a Call is PATCH `duplicate` (to Duplicate Calls, which also wins over bad). Two other PATCH effects move rows: `no_sync: true` deletes the rows of a Call that is not `duplicate: true` and does not route to Duplicate Calls or Bad Call Leads from all three Call tabs (`sheetSync/noSyncLead.ts` L13–L34, `jobPlanner.ts` L141–L166), and a phone or source change schedules Form Fill work (`domainCommands/entityChange.ts` L418–L421), which can move the Call to Duplicate Calls.

### Reversing a Bad Call

| Bad reason | How it ends |
|---|---|
| `external_bad_call` | No current writer can remove or change the review. A Call leaves Bad Call Leads only if it gains a duplicate reason (PATCH `duplicate: true`, or `form_fill` from a later Form), which moves it to Duplicate Calls. Deleting the Call removes all its rows. |
| `overnight_missed_call` | A later final-result observation with different facts (for example `Accepted`, or `answered: true`) through `recordRingCentralFinalCallLogResult` changes the derivation; its `call_lead.update` job moves the row to Calls. A duplicate reason moves it to Duplicate Calls. Deletion removes it. |

### Sheet consequences

The planner always writes the current disposition tab and deletes the Lead's row from the other two Call tabs in the same job (`sheetSync/drainer/jobPlanner.ts` L181–L193). An excluded Call plans no write at all (L171), so an excluded Call never reaches Bad Call Leads. Delete tombstones expand to Calls, Duplicate Calls and Bad Call Leads (L288–L308). No-Sync never hides Bad Call Leads: `noSyncAppliesToNormalTabs` returns false for `bad_call_leads` and `duplicate_calls` (`sheetSync/noSyncLead.ts` L13–L34).

### Worked example: overnight missed Call

Production has no overnight missed Call (see above), so this example uses a real Call's field values with only the arrival hour changed. The changed value is marked. Anonymized: Customer B, phone `+1555555xxxx`.

| Field | Real value (Call created 2026-11-17 13:00 UTC) | Overnight case |
|---|---|---|
| Feed | 10best Inbounds | same |
| `ringcentral.ingestion_source` / reason | `call_log_sync` / `call_log_inbound_target_elapsed_at_least_120s` | same |
| `ringcentral.duration_seconds` | 1,183.932 (caller waited in queue, never answered) | same |
| `ringcentral.start_time` (New York) | 2026-11-17 07:27:02 | **2026-11-17 06:27:02 (changed)** |
| `ringcentral.final_result` / `final_result_answered` | `Missed` / `false` | same |
| `final_result_call_log_id` equals `call_log_id` | yes | same |
| `final_result_observed_at` | 2026-11-18 00:00:17 UTC (written at insert 13:00 UTC, then advanced watermark-only by later 30-minute rescans inside the 12-hour floor) | same |
| `duplicate` / `form_fill` / review | `false` / `false` / none | same |
| `cpl` / status | 205 / `resolved` | same (not zeroed) |
| Decision | `calls`, billable, no reasons (hour 7 is outside the window) | `bad_call_leads`, not billable, `["overnight_missed_call"]` |
| EntityChange | `createCallLead` | same |
| Sheet row | Calls (`master_calls`, synced) | Bad Call Leads (`master_bad_calls`) |

If Customer B had called the same feed within the previous 90 days, the overnight Call would instead land on Duplicate Calls with reasons `["repeat_call_duplicate", "overnight_missed_call"]`.

## Tests

| Rule | Tests | Kind |
|---|---|---|
| Overnight window in New York, DST, summer | `leads/callLeadReportingDisposition.test.ts` ("overnight uses New York arrival…") | unit |
| Admission first; duplicate keeps bad reasons; No-Sync does not change billing | `leads/callLeadReportingDisposition.test.ts` | unit |
| Checker-note classification | `leads/callLeadReportingDisposition.test.ts` ("checker mapping is exact…") | unit |
| Final-result facts feeding overnight | `domainCommands/ringcentralFinalResult.test.ts` | unit |
| Planner moves rows between Call tabs | `sheetSync/drainer/jobPlanner.test.ts` | unit |
| Bad Call reversal by a later final result | GAP | — |
