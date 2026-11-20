---
okf_version: "0.2"
type: Reference
title: Form Lead minting and lifecycle
description: Every path that mints, prices, routes, updates or deletes a Form Lead, with the Form duplicate and Bad Lead entry points, at main 9955430d.
tags: [lead-lifecycle, form-lead, sheet-sync, cpl]
status: current
stale_after: 2027-01-20
resource: docs/knowledge/lead-lifecycle/
verified_at: 9955430d
applies_to:
  - src/services/leads/formLead.service.ts
  - src/services/leads/duplicateLead.service.ts
  - src/services/leads/leadIngestionProvenance.ts
  - src/services/leads/leadCplResolution.ts
  - src/services/leads/leadLocation.service.ts
  - src/services/leads/leadSourceCompany.ts
  - src/services/leads/wordpressFormSubmissionReceipt.ts
  - src/services/leads/externalSheetReview.ts
  - src/services/domainCommands/existingWrites.ts
  - src/services/domainCommands/existingWriteContext.ts
  - src/services/domainCommands/leads.ts
  - src/services/granotLifecycle/createLeadFromGranot.ts
  - src/services/employeeBookings/bookingLeadAttachment.service.ts
  - src/services/operationsRegistry/cplSchedule.ts
  - src/services/operationsRegistry/cplCorrections.ts
  - src/services/googleSheets/leadReportingTargets.ts
  - src/services/sheetSync/drainer/jobPlanner.ts
  - src/services/sheetSync/noSyncLead.ts
  - src/routes/v1.routes.ts
  - src/validation/v1/leads.validation.ts
  - src/models/FormLead.ts
owners: [team:main-server]
sources:
  - id: code
    resource: src/services/leads/formLead.service.ts
  - id: glossary
    resource: ../CONTEXT.md
    title: Platform glossary
  - id: service-doc
    resource: docs/knowledge/services/form-lead.md
    title: Form Lead Service (corrected against this pack)
---

# Form Lead minting and lifecycle

This page covers how a [Form Lead](../../../../CONTEXT.md) is minted, normalized, attributed, priced, routed to a Master Leads tab, corrected and deleted. Every rule cites code at `main` `9955430d`. The pack index is [README.md](README.md). The duplicate rule is in [duplicates-and-form-fill.md](duplicates-and-form-fill.md#form-duplicate-rule). Bad Forms are in [bad-leads.md](bad-leads.md#bad-form-leads). What Granot does to a Form after minting is in [granot-effects.md](granot-effects.md). The full tab and billing table is in [reporting-and-sheets.md](reporting-and-sheets.md).

Paths below are relative to the server repository root. "NY" means America/New_York.

## Minting paths at a glance

| # | Path | Entry point | Command name on `entity_changes` | Ingestion Origin | Status |
|---|---|---|---|---|---|
| M1 | Landing page / WordPress quote form | `POST /api/v1/form-leads` with the API secret or a source-scoped key, no Admin headers | `createFormLead` | `wordpress_form` | Current. 2,454 production create revisions (Aug 20 – Nov 20). |
| M2 | Admin Manual create | `POST /api/v1/form-leads` with an owner or admin actor | `createFormLead` | `vantage_admin` | Current. 1 production Form. |
| M3 | Test create | `POST /api/v1/create-form-test` | `createFormLead` | `wordpress_form` | Test mode and legacy Sheet mode forced per request. |
| M4 | Granot `lead_created` | Granot lifecycle processor (`granot-lifecycle-drain` cron / queue consumer) → `createLeadFromGranot` | `createLeadFromGranot` | `granot_lead_created` | Current. 2,078 production Forms. |
| M5 | Booking reconciliation "create and attach" | `POST /api/v1/admin/booking-lead-reconciliations/:id/resolve` with `action: "create_and_attach"` | `resolveBookingLeadReconciliation` (Lead change recorder) | **none set** (see M5) | Current code. Zero production Forms carry this command. |
| M6 | Best Relocation final reconciliation exception Forms | Retired operator run `ops/best-relocation-retirement/run.ts` (deleted in `226dba24`) → `createFormLead` with `external_sheet_ingestion` origin | `createFormLead` | `best_relocation_sheet` | Historical only: Nov 3–4, 2026. 272 production Forms. New writes are refused. |

Production counts were read on 2026-11-20 at 12:49 NY (`form_leads` total 9,044: 4,511 `legacy_unknown`, 2,182 `wordpress_form`, 2,078 `granot_lead_created`, 272 `best_relocation_sheet`, 1 `vantage_admin`). `legacy_unknown` comes only from the Lead provenance migration, never from a live path (`src/models/granotLifecycleSchemas.ts:applyLeadProvenanceGuards` L566–L602 rejects it on insert).

No Form is minted by RingCentral, by a Call, by Sheet Sync, by Form Fill, or by the Granot browser extension. The exported compatibility aliases `ingestFormLead`, `createFormLead` (service), `removeFormLead` and `updateFormLead` in `formLead.service.ts` have no production caller at `9955430d`.

## M1–M3: `createFormLead`

### Route and command envelope

| Rule | Source | Detail |
|---|---|---|
| Route | `src/routes/v1.routes.ts` L534 (`router.post("/api/v1/form-leads", handleCreateFormLead)`), `handleCreateFormLeadRequest` L2163–L2277 | Parses `createFormLeadSchema`, builds the context with `existingWriteContextFromRequest`, calls `runExistingCreateFormLead`, returns 201. `/api/v1/create-form-test` (L533, `handleCreateFormLeadTest` L2153–L2161) runs the same handler under `{ testMode: true, sheetSyncMode: "legacy" }`. |
| Payload contract | `src/validation/v1/leads.validation.ts:createFormLeadSchema` L129–L153 | Strict. `source_company` defaults to `not_provided`; `post_to_granot` defaults `false`; `crm_company_label` defaults `"Main Site Forms"` (logged only). `local` is refused unless `ingestion_source === "best_relocation_sheet"`. Requires a name, first name or last name. Clients cannot send `duplicate`, `bad_lead`, `ingestion_origin`, `external_sheet_review`, `cpl` or any snapshot. |
| Actor | `src/services/domainCommands/existingWriteContext.ts:compatibilityActorFromAuth` L86–L142 | Extension user with the owner role → owner. API secret plus `x-vantage-admin-role: owner|admin`, user ID and email headers → owner/admin. Scoped key → system actor `scoped-key:<fingerprint>`. Bare API secret → system actor. Anything else throws. |
| Provenance origin | same file L21–L49 | Always `vantage_admin` for this route. |
| Idempotency key | same file L31–L35, L144–L150 | `existing:createFormLead:<submission_id>` when the body has `submission_id`; Form bodies never do (strict schema), so the key is `request:createFormLead:<request id>`. A client retry with a new request ID is a new command. Replay of the same key with the same payload checksum returns the stored result (`src/services/domainCommands/idempotency.ts` L60–L100). |
| Strip | `src/services/domainCommands/existingWrites.ts:runExistingCreateFormLead` L119 | `ingestion_source` is forced to `undefined`. The Best Relocation `local` override therefore never reaches the service on this path. |
| Ingestion Origin | `src/services/leads/leadIngestionProvenance.ts:deriveFormLeadIngestionOrigin` L89–L114 | `vantage_admin` origin + owner/admin actor → `vantage_admin`; + system or no actor → `wordpress_form`. `granot_lifecycle` → `granot_lead_created`; `external_sheet_ingestion` → `best_relocation_sheet` (unreachable for new writes, see M6). Any other origin throws `ValidationError`. |

**Precedence.** The derived origin wins over anything in the payload; `ingestion_origin` is never accepted from a client. **Time window:** none. **Clock:** the executor's `now` (UTC instant).

### Transaction steps (`beginFormLeadIngestion` → `writeTheFormLead`)

All steps run inside the canonical command transaction (`existingWrites.ts` L122–L152). Lines are in `src/services/leads/formLead.service.ts` unless stated.

| Step | Source | What is written or decided |
|---|---|---|
| 1. Normalize name | `normalizeTheCustomer` L400–L406 → `leadName.service.ts:normalizeLeadName` | Builds `name` / `first_name` / `last_name`. |
| 2. Normalize phone | L402–L404 → `src/utils/phone.ts:normalizePhoneNumberForStorage` L23–L45 | 11 digits starting `1` → last 10 digits; 10 digits kept; `+` and ≥ 8 digits → `+<digits>`; otherwise the digits. The model's pre-validate hook sets `normalized_phone_number = normalizePhoneNumberForMatch(phone_number)` (`src/models/FormLead.ts` L199–L204). |
| 3. Email | `src/models/FormLead.ts` L68 | Trimmed and lower-cased by the schema. Validation is loose (`looseEmailString`). |
| 4. Location and states | `locateTheMove` L408–L410 → `leadLocation.service.ts:resolveRequiredLocation` L27–L52 | The state looked up from each ZIP **wins** over a supplied state. A missing state becomes `not_found` (`FORM_LEAD_UNKNOWN_STATE`). Both ZIPs are required by the model (L56, L58). |
| 5. Move Type (`local`) | `prepareTheQuoteForIngestion` L341–L345 → `deriveFormLeadLocal` (`leadLocation.service.ts` L118–L124) | Either state `not_found` → `local`. Same state → `local`. Different → `long_distance`. The `best_relocation_sheet` override at L342 is dead on M1–M3 (step "Strip" above). |
| 6. Source Company and Source Granularity | L346–L355 → `leadSourceCompany.ts:resolveLeadSourceAssignment` L14–L87 → `operationsRegistry/sourceResolution.ts:previewSourceAttribution` | Company slug = `company_slug`, else `source_company`, else `main_site` when blank or `not_provided`. Granularity, in order: exact `granularity_key` → exact CRM label (the `source_company` value when no explicit slug) → `source_company_site` → the granularity whose `local` equals the derived Move Type → alias fallback by priority → company default. Only active companies and active `form` granularities are candidates. Not found or ambiguous → `ValidationError` on `source_company` (HTTP 4xx, no Lead). Writes `source_company`, `lead_source_company`, `source_granularity_id`, `source_granularity_key` and the three label snapshots. |
| 7. Timestamp | L356 → `src/utils/easternTime.ts:toFloridaTimestamp` L175–L188 | `timestamp` = the NY wall-clock parts of the client `timestamp` (or now), stored as if they were UTC. A form submitted at 12:42 NY is stored as `…T12:42:…Z`. |
| 8. Duplicate classification | L357–L368 → `duplicateLead.service.ts:findDuplicateFormLeadMatch` L78–L151 | Exact `source_granularity_id`, phone **or** email, earlier non-duplicate Form in the cohort. Full rule: [duplicates-and-form-fill.md](duplicates-and-form-fill.md#form-duplicate-rule). |
| 9. CRM Posting decision | `decideWhetherToPostToGranot` L412–L417 | `post_to_granot = requested && !duplicate`. |
| 10. CPL snapshot | L374–L379 → [CPL at creation](#cpl-at-creation) | Called without `duplicate`, so a Duplicate Form gets the full rate. |
| 11. Lead ID text | `giveTheLeadAnIdentity` L419–L421 | `lid` = trimmed client `lid` or `generateLeadId()`. |
| 12. WordPress receipt | `beginFormLeadIngestion` L175–L232 → `wordpressFormSubmissionReceipt.ts:captureWordpressReceiptThenCreateLead` L244+ | Writes a receipt only when origin is `wordpress_form`, `TEST_MODE` is on and the database name matches `^testvantagemovers…` (`wordpressReceiptWriteAuthorized` L53–L61). **In production no receipt is written and there is no submission-key dedupe.** On the test path a reused key returns the existing Lead with `reusedExistingLead: true`: no EntityChange, no Sheet job, no CRM post, no message. |
| 13. Insert | `writeTheFormLead` L423–L464 | See the field table below. |
| 14. Form Fill work | L465 → `formFillWork.ts:scheduleFormFillWork` L5–L9 | Upserts `form_fill_work` `_id: "FormLead:<id>"` for every new Form, duplicate or not. |
| 15. Inline Form Fill | L469–L480 → `duplicateLead.service.ts:markMatchingCallLeadsWithFormFill` L221–L306 | Only when the new Form is not a duplicate. First page of 25 candidate Calls. Rule owned by [duplicates-and-form-fill.md](duplicates-and-form-fill.md#form-fill-rule). |
| 16. Sheet Sync intents | L481–L492 | Every `call_lead.form_fill.update` job from step 15, then `source_lead` / `form_lead.create` unless `no_sync === true`. Persisted in the same transaction (`persistSheetSyncIntent`). |
| 17. Lead message intent | L493–L500 → `leadMessaging.service.ts:persistLeadMessageIntent` L120+ | Only when `sms_consent === true`. A Duplicate Form records a `skipped` message with reason `duplicate_lead`. |
| 18. EntityChange | `existingWrites.ts` L133–L147 | One FormLead create mutation (`revision_before: 0`) over `FORM_LEAD_CHANGE_PATHS` plus `external_sheet_review`. `persistEntityChangeMutations` stamps `domain_revision: 1` and `last_change_*`. |

Fields written at insert (`writeTheFormLead` L428–L463):

| Field | Value |
|---|---|
| contact, move, ZIP, state fields | normalized input and step 4 |
| `local` | step 5 |
| source fields and snapshots | step 6 |
| `ref_no` | trimmed client `ref_no`, else `"not provided"` ([Tracking Reference](../../../../CONTEXT.md)) |
| `timestamp` | step 7 |
| `move_date` | client `move_date`, else the transaction `now` |
| `cpl`, `cpl_rate_period`, `cpl_resolution_status`, `cpl_resolved_at`, `cpl_resolution_version` | step 10 |
| `duplicate` | step 8 |
| `post_to_granot` | step 9 |
| `outreach_automation_suppressed` | `true` only for `best_relocation_sheet`; immutable (`FormLead.ts` L94) |
| `ingestion_origin`, `job_no` (absent), `normalized_job_no`, `ingested_contact_snapshot`, `ingested_move_snapshot` | `leadIngestionProvenance.ts:formLeadCreationProvenanceFields` L181–L203. Snapshots carry `captured_at = now` and `evidence_status: "captured_at_ingestion"`. They are the immutable [Ingested Contact Snapshot](../../../../CONTEXT.md); `ingested_*`, `ingestion_origin` and the other `PUBLIC_LEAD_FORBIDDEN_LIFECYCLE_FIELDS` can never be patched. |
| `no_sync` | `leadIngestionProvenance.ts:noSyncOnCreate` L171–L179: `vantage_admin` → client value, default **`true`**; every other origin → `false` (a client `true` is ignored). |
| `bad_lead`, `booked`, `cancelled`, `receiver_agent*`, `granot_*`, `form_fill` | not set |

### After commit (`completeFormLeadIngestion` L235–L324)

| Order | Effect | Source |
|---|---|---|
| 1 | `lead.cpl.missing_rate` error log when the snapshot status is `missing_rate` | `reportAMissingCplRate` L516–L531 |
| 2 | Lead message dispatch or queue (never throws) | L276 |
| 3 | `finalizeSheetSync` for every job from step 16 (in queued mode this wakes the drain) | L280–L282 |
| 4 | CRM Posting: `submitFormLeadToCrm` when `post_to_granot`; otherwise log `crm.form_lead.submit.skipped` | `postTheLeadToGranotWhenDue` L533–L559 |
| 5 | Structured logs `lead.form.created`, `lead.form.duplicate_detected`, `lead.form.call_leads_marked_form_fill` | `logWhatTheOwnerNeedsToKnow` L561–L602 |
| 6 | Daily Operations fact `form_lead.created` or `form_lead.duplicate`, dedupe key `form_lead:<id>:created|duplicate` | `dailyOperations/recordDomainFacts.ts:recordFormLeadDailyOperationsFact` L173–L215 |
| 7 | Contact Number `lead_link` wake (bounded, never throws) | `existingWrites.ts` L156–L163 |

**Effects summary for `createFormLead`.** Sheet Sync: `form_lead.create` (tab chosen by the planner, [below](#sheet-sync-for-a-form)) plus a `call_lead.form_fill.update` per flipped Call. Outreach: the create EntityChange is read by the `sales-outreach-lead-changes` tail loop (`src/routes/sales-outreach-cron.routes.ts` L17–L20); admission rules are in [downstream-consumers.md](downstream-consumers.md). Daily Operations: one fact as above. EntityChange paths: all `FORM_LEAD_CHANGE_PATHS` present on the new document, plus one CallLead `form_fill` change per flipped Call (command `markCallLeadFormFill`).

## M4: `createLeadFromGranot` (Form mint only)

Identity, Record Link and policy gates belong to [granot-effects.md](granot-effects.md). This section covers only what the minted Form looks like. Source: `src/services/granotLifecycle/createLeadFromGranot.ts`.

| Rule | Source | Detail |
|---|---|---|
| Forms only | `createLeadFromGranot` L158–L163, `snapshotAllowsCreateRouteEventClass` L109–L115, `executeCreation` L323–L331 | A `CallLead` request throws `policy`. Only `route_event_class === "lead_created"` with a Form source policy mints. |
| Granularity | L354–L373 | The policy snapshot's company and granularity must be active, related, and the granularity `channel === "form"`. No `resolveLeadSourceAssignment` call. |
| Duplicate | `createGranotFormLead` L581–L739 | **No duplicate classification.** `duplicate` takes the model default `false`. Minting requires identity outcome `unmatched` or `pending_match` with no candidate (L342–L352). |
| `timestamp` | L715 (`timestamp: observation.captured_at`) | The real UTC capture instant, **not** NY wall clock. See [Timestamp clocks differ by path](#timestamp-clocks-differ-by-path). |
| `local` | L416–L424 | The policy's `selected_move_type`, or, when it is `any`, `selectFormMoveType` from the observed origin and destination states. |
| `move_date` | L708 | The observed move date; absent when Granot sent none (no `now` default). |
| CPL | L390–L393 | `resolveLeadCplSnapshot({ sourceGranularityId, storedBusinessTimestamp: observation.captured_at })`, no `duplicate`. |
| Provenance | L642–L681 | `ingestion_origin: "granot_lead_created"`, `job_no`, `normalized_job_no`, `granot_priority` (when valid), `ingested_contact_snapshot` from the observation, `granot_contact_snapshot`, `last_accepted_granot_observation`, and the receiver from a Granot username match (`receiver_agent_source: "granot_username_match"`). |
| `quoted` | L723–L726 | `true` when the observed priority is 1 or 5. |
| `post_to_granot` | L709 | `false`; a Granot-minted Form is never CRM-posted. |
| `no_sync`, `bad_lead`, `ref_no` | L718 | `no_sync` model default `false`; `bad_lead` unset; `ref_no` = the observation's normalized Granot Form Reference. |
| Sheet Sync | L508–L514 | `source_lead` / `form_lead.create`, enqueued in the transaction, finalized after commit (L178). |
| Form Fill | `domainCommands/entityChange.ts` L418–L421 | No inline flip. The create EntityChange touches `phone_number`, so `persistEntityChangeMutations` schedules `form_fill_work` and the drain flips matching Calls later. |
| Message | L182–L192, L534–L544 | Granot confirmation SMS after commit, failures logged only. |
| Daily Operations | L193–L204 | `granot.minted` fact plus the same `form_lead.created` fact as M1. |
| Idempotency | `createLeadFromGranotIdempotencyKey` L99–L101, checksum L117–L156 | `granot:create-lead:<observation id>`; payload checksum over the observation semantics and source scope must match (L381–L388). |

## M5: `createAndAttachReconciliationFormLead`

Source: `src/services/employeeBookings/bookingLeadAttachment.service.ts` L118–L210, called from `bookingLeadReconciliation.service.ts:persistBookingLeadReconciliationResolveInTransaction` L488–L511 inside the Owner resolve transaction (`resolveBookingLeadReconciliation`, L355–L380, Lead change recorder command `resolveBookingLeadReconciliation`).

| Rule | Detail |
|---|---|
| Inputs | Owner-supplied `lead_fields` (name, email, phone, ZIPs, move size and date, `lid`) and the case's prepared submission source. |
| Normalization | Same name and phone normalization, same `resolveRequiredLocation` and `deriveFormLeadLocal`, same `resolveLeadSourceAssignment` (`channel: "form"`). |
| Timestamp | `toFloridaTimestamp(new Date())` (NY wall clock as UTC). |
| Duplicate | `findDuplicateFormLeadMatch` with the same rule as M1, but **outside the session** (no `session` argument, L149–L158). |
| CPL | `resolveLeadCplSnapshot` without `duplicate` (L159–L164). |
| Insert | `new FormLead({ …normalized, …location, …source, local, timestamp, …cpl, duplicate, post_to_granot: false })` (L165–L175). **No `ingestion_origin`, no Ingested Contact Snapshot or move snapshot, no `move_date` default, `ref_no` model default.** `no_sync` model default `false`. |
| Form Fill | Inline `markMatchingCallLeadsWithFormFill` when not duplicate (L188–L198); the recorder's EntityChange also schedules `form_fill_work`. |
| Attach | `attachLeadToEmployeeBooking` attaches the new Form to the Booking and returns a `booking_chain` job; the Form's row comes from that chain job (`jobPlanner.ts:planBookingChain` L216–L245), not from a `form_lead.create` job. |
| Effects | Sheet Sync: `booking_chain` / `booking_reconciliation.create_and_attach` plus Form Fill jobs. EntityChange: one FormLead create change under `resolveBookingLeadReconciliation`. No CRM post, no Lead message, no Daily Operations Form fact. |

Production on 2026-11-20 shows zero Forms without `ingestion_origin`, so this path has not minted in production. A Form minted here would break the glossary rule that every Lead has a server-assigned Ingestion Origin; this is an open finding for the Owner.

## M6: Best Relocation exception Forms (historical, November 3–4)

The Owner-return final reconciliation (`FINAL-RECONCILIATION-2026-11-03.md`) created 272 exception Forms. The code that did it was deleted in `226dba24` (November 18). What it did, from `git show 226dba24^`:

| Rule | Historical source (`226dba24^`) | Detail |
|---|---|---|
| Runner | `ops/best-relocation-retirement/run.ts` | Applied the released plan through `canonicalDomainCommands` with actor `best-relocation-ingestion`, origin `external_sheet_ingestion`, Owner initiator, run and receipt provenance. |
| Create | `src/services/domainCommands/existingWrites.ts:runExistingCreateFormLead` (old L116–L195) | Forced `ingestion_source: "best_relocation_sheet"`, `post_to_granot: false`, `sms_consent: false`; required source `best_relocation_leads`; loaded the frozen-plan authorization. |
| Authorization | `src/services/domainCommands/bestRelocationFinalLead.ts:finalFormCreateAuthorization` | The Form had to be literally present in the Owner-released plan checksum and inside the source window. A Form with no checker review and not a duplicate also needed a definite Booking match. |
| Checker review at create | same function | The row's `Bad Lead Checker` cell went through `classifyExternalReview`: a value longer than two trimmed characters became `external_sheet_review` (`kind: "bad_form"`, `reason_code: "external_bad_form"`) written on insert. |
| Fields | `formLead.service.ts` (old) | `ingestion_origin: "best_relocation_sheet"`, `outreach_automation_suppressed: true`, `local` from the tab ("Local Forms" → `local`), normal duplicate classification and CPL. |

Today `deriveFormLeadIngestionOrigin` still maps `external_sheet_ingestion` to `best_relocation_sheet`, and `beginFormLeadIngestion` still has two `best_relocation_sheet` branches (`formLead.service.ts` L172, L440). They are unreachable: the executor throws `"External sheet ingestion is permanently retired"` for any new command with that origin (`src/services/domainCommands/idempotency.ts` L86–L88); only replay of a stored result is allowed. Production: 272 `best_relocation_sheet` Forms; 270 of them carry a trusted `bad_form` review (212 non-duplicate, 58 duplicate) and route to Bad Form Leads ([bad-leads.md](bad-leads.md#bad-form-leads)).

## CPL at creation

| Rule | Source | Detail |
|---|---|---|
| Resolver | `src/services/leads/leadCplResolution.ts:resolveLeadCplSnapshot` L27–L67 → `src/services/operationsRegistry/cplSchedule.ts:resolveCpl` L514–L537, `resolveCplFromPeriods` L481–L512 | No granularity → `not_applicable`, `cpl: 0`. `duplicate: true` → `duplicate_zero`, `cpl: 0`. Exactly one covering CPL Rate Period → `resolved` with its amount and `cpl_rate_period`. Zero or several → `missing_rate`, `cpl: 0`. |
| Business date | `cplSchedule.ts:storedLeadTimestampToCplInstant` L236–L242 | Takes the stored `timestamp`'s UTC calendar day as the NY business date, then NY midnight of that day. Correct for NY-wall-clock timestamps (M1–M3, M5). |
| Forms never pass `duplicate` | `formLead.service.ts` L374–L379, L831–L836; `createLeadFromGranot.ts` L390–L393; `bookingLeadAttachment.service.ts` L159–L164 | A Duplicate Form stores the full `resolved` CPL. `duplicate_zero` is only for Calls. Production: 176 duplicate Forms are `resolved` at their normal rate; 88 have no status (legacy). Billing exclusion of Duplicate Forms is a reader decision ([reporting-and-sheets.md](reporting-and-sheets.md)). |
| Missing rate | `recordMissingLeadCplRate` L69–L86 | Error log `lead.cpl.missing_rate` after commit; nothing else. |
| Repricing on update | `formLead.service.ts:repriceIfTheCostBasisChanged` L819–L838 | Only when the source was re-resolved or `timestamp` was patched. |
| CPL Corrections | `operationsRegistry/cplCorrections.ts` preview L590–L640, apply L1352–L1380, `updateLeadCorrection` L1627–L1700; drain `/api/cron/cpl-corrections-drain` every 5 minutes (`vercel.json` L94–L95) | Owner-created job rewrites `cpl*` fields with a compare-and-set filter on the reviewed values, `duplicate: lead_model === "CallLead" && duplicate` (Forms keep full rate), and records `cpl_lead_corrections`. **No EntityChange, no `domain_revision` bump, no Sheet Sync** (CPL is not a Sheet column). |

## Sheet Sync for a Form

The planner reloads the Lead and computes membership from current Mongo state (`src/services/sheetSync/drainer/jobPlanner.ts:planSourceLead` L128–L194). Routing reader functions (`src/services/googleSheets/leadReportingTargets.ts`):

| Lead state | Upsert | Stale rows deleted | Source |
|---|---|---|---|
| `no_sync: true`, not duplicate, not bad | none | every Form destination, including the transitional titles "Duplicates" and "Bad Leads" | `noSyncLead.ts:noSyncAppliesToNormalTabs` L13–L34, `jobPlanner.ts` L141–L166 |
| Bad (`bad_lead` set, or trusted `external_sheet_review.kind === "bad_form"`) | Bad Form Leads | Forms and Duplicate Forms (old and new titles) | `hasFormBadProjection` L25–L27, `formLeadTargets` L32–L39, `staleFormTargetKeys` L42–L46 |
| Not bad, `duplicate: true` | Duplicate Forms | Bad Form Leads only | same |
| Not bad, not duplicate | Forms | Bad Form Leads only | same |

- **Deletes wait for upserts.** `batchWriter.ts:writeBatchedTargets` (L58–L79) runs every upsert first and defers a document's deletes while any of its upserts is not `synced` (`destination_upsert_pending`).
- **A non-bad Form never loses its opposite primary row.** When `duplicate` flips, the old Forms or Duplicate Forms row stays (`staleFormTargetKeys` returns only the Bad Form Leads keys; test "Form Duplicate upserts Duplicates and does not delete leftover Forms" in `jobPlanner.test.ts`).
- **Stale targets come from two sources.** `getDeleteTargets` (`googleSheets/targets.ts` L51–L81) deletes from the fallback target list and from every recorded `sheet_sync[]` entry whose target key is stale. So a missing `sheet_sync` entry does not block cleanup.
- **Deletion.** `delete_source_lead` tombstone. `planTombstone` (`jobPlanner.ts` L277–L337) deletes the Mongo ID from every Form tab, old and new titles.

Precedence: `no_sync` loses to bad and duplicate (they still project); bad beats duplicate. The complete table, with Calls, is in [reporting-and-sheets.md](reporting-and-sheets.md).

## `updateSourceOwnedLead` (Form side)

Route `PATCH /api/v1/form-leads/:id` (`v1.routes.ts` L537, `handleUpdateFormLead` L2279–L2313) → `existingWrites.ts:runExistingUpdateSourceOwnedLead` L179–L265 → `formLead.service.ts:correctFormLead` L606–L670.

| Rule | Source | Detail |
|---|---|---|
| Patch contract | `leads.validation.ts:updateFormLeadSchema` L155–L164 | Form fields plus `duplicate`, `bad_lead` (reason enum or `null`) and `no_sync`. At least one field. |
| Idempotency | `existingWriteContext.ts` L31–L35 | `request:updateSourceOwnedLead:<request id>`. Optional `expected` filter → `preview_drift` conflict on a miss or a Mongoose `VersionError` (L687–L712, L644–L653). |
| Refusals | `refuseIllegalCorrections` L714–L750 | Duplicate Form: `quoted`, `cubic_feet` or extension receiver source → 409. Any `bad_lead` key (setting **or clearing**) on a duplicate, Booked or Cancelled Form → 409. |
| Forbidden fields | `applyTheAllowedPatch` L752–L766 → `omitForbiddenLeadLifecycleFields` (`leadIngestionProvenance.ts` L222–L232) | Silently drops `ingestion_origin`, `external_sheet_review`, snapshots, `granot_*`, `normalized_job_no`, revision fields. `duplicate`, `bad_lead` and `no_sync` are **not** forbidden and are assigned as sent. Phone is re-normalized; `timestamp` is re-converted with `toFloridaTimestamp`. |
| Location | `relocateTheMoveIfAddressesChanged` L768–L798 | Only when a ZIP or state is in the patch. On update an explicit valid two-letter state **wins** over the ZIP lookup (the opposite of create). `local` is re-derived. |
| Source | `reassignTheSourceIfAttributionChanged` L800–L817 | Re-resolves when a source, site, ZIP or state field is in the patch, or the Form has no `lead_source_company`. |
| CPL | L819–L838 | As [above](#cpl-at-creation). |
| Receiver | `assignTheReceiverAgent` L840–L859 | Registry agent lookup; `receiver_agent_source` defaults `manual`; missing agent → 404. |
| No re-classification | — | Changing phone, email, granularity or timestamp **does not** re-run the duplicate rule. `duplicate` changes only when the patch sends it. |
| Persist | `persistTheCorrectionAndRefreshTheBookingChain` L672–L685 | Save, then `refreshAttachedBookingFromLead` (`bookings/bookingMirror.service.ts`) returns a `source_lead` / `form_lead.update` job, or a booking-chain job when the Form is Booked; the intent is persisted in the transaction. |
| EntityChange | `existingWrites.ts` L216–L236 | Changed `FORM_LEAD_CHANGE_PATHS` only; no change → no EntityChange, no Sheet job, no wake. |
| Form Fill rescan | `entityChange.ts` L418–L421 | A change to `phone_number`, `source_company`, `lead_source_company`, `source_granularity_id` or `duplicate` schedules `form_fill_work` for the Form. |
| After commit | `existingWrites.ts` L255–L262 | `finalizeSheetSync`, then the Lead link wake. |

**Call side.** `PATCH /api/v1/call-leads/:id` (`v1.routes.ts` L555–L570) uses the same command name with `updateCallLeadSchema` (`leads.validation.ts`, includes `duplicate` and `no_sync`, no `bad_lead`) and `callLead.service.ts:correctCallLead`. Its rules are in [call-leads.md](call-leads.md). Production: 305 Form and 8 Call `updateSourceOwnedLead` revisions; the last Call one was September 6.

**Owner marks.** The Admin dashboard's Hide / Show from Master Leads, Mark bad and duplicate repair all use this one route. There is no other server write path for `no_sync`, `bad_lead` or Form `duplicate` at `9955430d`.

## `deleteFormLead`

Route `DELETE /api/v1/form-leads/:id?cascade=true|false` (`v1.routes.ts` L538–L543) → `existingWrites.ts:runExistingDeleteFormLead` L679–L708 → `formLead.service.ts:beginFormLeadRemoval` L930–L984.

| Rule | Detail |
|---|---|
| Booked guard | A Booked Form without `cascade=true` → 409 (`refuseRemovalIfBookedWithoutCascade` L986–L1003). |
| Cascade | With `cascade=true`, `deleteBookedLeadInTransaction` deletes the Booking (and its chain) in the same transaction; its mutations join the command. |
| Tombstone | Queued mode: `delete_source_lead` / `delete_form_lead` with `previous_targets` from `sheet_sync[]`, `source_company` and `duplicate` (`tombstoneSheetSync` L1005–L1029). The planner adds every Form tab title anyway. |
| EntityChange | `$deleted` mutation on the Form, plus the cascade's mutations. Deletion does **not** schedule `form_fill_work`. |
| Idempotency | `request:deleteFormLead:<request id>`; payload `{ id, cascade }`. |
| Not touched | Calls already flagged `form_fill` because of this Form keep the flag. Later Forms classified `duplicate` against it stay duplicates. Granot Record Links and lead messages are not removed here. |
| Production | Zero `deleteFormLead` revisions on production `entity_changes` (read 2026-11-20 17:37 UTC). |

## Timestamp clocks differ by path

| Path | Stored `timestamp` | Sheet "Timestamp" cell (`projections/cells.ts:formatTimestamp` L25–L32, UTC parts) |
|---|---|---|
| M1–M3, M5 | NY wall clock stored as UTC | NY time |
| M4 Granot | real UTC instant | UTC time (4–5 h ahead of NY) |

The duplicate cohort (`timestamp < eventTimestamp`) and the CPL business date compare these values directly. Production samples on 2026-11-20: a WordPress Form created 17:42:56 UTC stores `12:42:56Z`; a Granot Form created 04:49:26 UTC stores `04:49:26Z`. The mixed clocks are an open finding for the Owner.

## Worked example: a Form on Forms

Read-only production trace, 2026-11-20 12:49 NY. Customer A, phone `+1555555xxxx`.

1. **17:42:56 UTC.** The TBM landing page posts `POST /api/v1/form-leads` with the API secret. The system actor gives origin `wordpress_form`. `createFormLead` revision 0→1: `source_company: tbm_leads`, `source_granularity_key: tbm_leads_form` ("TBM Forms"), `timestamp: 2026-11-20T12:42:56.676Z` (NY wall clock), pickup IL to delivery TX → `local: long_distance`, `duplicate: false`, `no_sync: false`, `post_to_granot: false`, `cpl: 205`, `cpl_resolution_status: resolved`, `outreach_automation_suppressed: false`.
2. **17:42:56 UTC.** The transaction persisted `source_lead` / `form_lead.create` (created by `api`). The drain synced it: `sheet_sync[0] = { target: master_forms, tab_name: "Forms", row_number: 8407, status: synced, last_synced_at: 17:44:41 }`.
3. **17:45:46 UTC.** Granot matched the Form (`synchronizeLeadFromGranot`, revision 1→2, `job_no` set). That enqueued `form_lead.update`, which was still pending at the read.

The visible row is Forms row 8407. Mongo ID column = the Lead ID; Source Company column = "TBM Forms"; Bad Lead column empty.

The Duplicate Forms and Bad Form Leads examples are in [duplicates-and-form-fill.md](duplicates-and-form-fill.md#worked-example-a-form-on-duplicate-forms) and [bad-leads.md](bad-leads.md#worked-examples).
