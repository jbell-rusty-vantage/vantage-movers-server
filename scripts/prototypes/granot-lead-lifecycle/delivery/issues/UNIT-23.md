# Unit 23 — Booking lifecycle reads, Admin queue/detail, candidate browser, and Job/Lead timeline

> **Contract maturity: implementation-ready; implementation remains blocked by Unit 22.** This is the API/Admin half of S15. It exposes masked cursor-based Booking-case reads, server-owned candidates, complete Job/Lead lifecycle projections, and an Owner-only Admin read workflow. It deploys reads before commands; no owner mutation, Booking/Cancellation effect, or production flag enablement is authorized.

## 1. Authority and required reading

- **Final specification:** Sections 1–7, 12.3, 18–21, 27, 28.2, 29, 33–41; especially AC-18–20/35/36/39/40 and 38/S15.
- **Acceptance ownership:** read/projection/UI proof for AC-18–20; full Unit 23 AC-35; projection/non-collapse portion of AC-36; read/navigation portion of AC-39; Booking/read-compatible portion of AC-40. Unit 22 owns Booking case transactions/indexes; Unit 26 completes Release persistence/coexistence; Unit 29 completes discrepancy models; Units 24–25 own command/409 behavior.
- **Approved split:** Unit 23 in `lead_lifecycle_issue_breakdown_reccomendation.md`. Unit 22 owns schema, sequence, suggestion/candidate policy, and open/refresh. This unit owns strict read DTOs/routes, masking, cursor/filter behavior, server timeline projections, Admin navigation/list/detail/candidate browser, and stable query keys/invalidation foundation.
- **Execution:** delivery runbook; server/admin instructions and rules; verified Unit 22 completion and repository evidence; current lifecycle router/projections/masking helpers; existing Employee reconciliation cursor/candidate patterns; Admin auth/proxy/filter/query/component conventions.

The final specification wins. Server projections own source routing, matching, Priority, case-opening, candidate eligibility, masking, and timeline composition. Admin only renders them and never connects to operational Mongo.

## 2. Objective

Deliver the read-only owner workflow for Granot Booking Reconciliation. Add authenticated case list/detail and Lead lifecycle reads, complete the Job Number timeline, expose a case-scoped read-only candidate browser, and render them under `/ingestion/granot/lifecycle` with URL-backed filters. Lists are masked; details expose only normalized owner-work fields; immutable Granot evidence stays visibly separate from current official Booking/Cancellation facts. Evidence refresh updates counts/timeline without clearing local in-progress form state. No command route, official mutation, case resolution, Record Link correction, discrepancy mutation, or Release-domain persistence is added.

## 3. Repository, branch, and prerequisites

- **Repositories/branches:** `vantage-main-server` / `granot-lead-lifecycle` and `vantage-admin` / `granot-lead-lifecycle`.
- **Blocked by:** verified Unit 22 implementation/completion, including exact model/indexes, service DTOs, candidate policy, concurrent proof, flag-off ending posture, and Section 34.5 verify. Unit 22 is currently blocked by Unit 18, so this unit is not implementation-ready in sequence merely because its contract is complete.
- Verify server compatibility first, then build Admin against exported/tested DTOs. Do not let Admin types become semantic authority.
- Reverify the protected `/api/v1/admin` mount, Owner/Admin read actor, Owner-only Admin route policy, signed proxy allowlist, URL-state/filter primitives, query keys, and separate Employee Booking Lead Reconciliation UI.
- Ordinary checks use redacted synthetic data. Runtime reads require `TEST_MODE=true` and an explicit test database; external effects remain disabled. No commit, push, deploy, production flag change, mutation/index apply, live payload inspection, or external send.
- Preserve unrelated/user changes in both repositories.

## 4. Current-state evidence to verify

Observed on 2026-08-18; reverify after Unit 22:

- Server lifecycle router currently has activation/requeue mutations plus Job/health reads. It has no `/cases`, `/cases/:case_id`, Lead lifecycle, or candidate read.
- Current `projectGranotJob` returns only active Record Link, Observations, and Decisions, caps rows at 100, and declares `complete_timeline:false`, `cases:false`, `official_facts:false`. It omits case sequences, Entity Changes, individual current official facts, and deterministic stable cross-type ordering.
- Existing projection masking helpers reject forbidden keys but are tuned to the incomplete Job shape. Extend centralized server masking; do not mask full values only in the browser.
- Unit 22 model/service are absent at authorship. No Release/discrepancy lifecycle model exists; real Unit 23 data is Booking-only while projection/UI unions must remain compatible with later kinds.
- Admin `/ingestion/granot` renders only `GranotAutomationDashboard`; no lifecycle API client/components/routes exist.
- `lib/query/keys.ts` has stable filter normalization and separate Employee reconciliation/Granot automation families, but no `granotLifecycle` family. Existing URL-state helpers are page-oriented; this workflow needs opaque cursor state without translating it into offset pagination.
- Owner authorization already covers `/ingestion/granot` UI; reverify proxy ACL explicitly permits the new lifecycle GETs while preserving Owner-only navigation. Server reads remain Owner/Admin per Section 28.
- Existing Employee reconciliation uses stable date+ObjectId cursors and `{ items, next_cursor }`; reuse mechanics only, never its states, domain names, matching policy, or UI.

## 5. Locked decisions and invariants at risk

- **Invariants 1–4:** projections compose Mongo facts; do not store a lifecycle enum or present Granot evidence as a Booking/Cancellation. One deterministic Booking per Job is read-only context.
- **Invariants 5–7:** every route/component in this unit is read-only. It creates no aggregate mutation, Command, Change, revision, outbox, case resolution, selection, or notification.
- **Invariants 8–10:** label submitted/ingested versus accepted Granot contact and preserve separate source/channel/origin/actor axes. UI display/candidate browsing cannot rewrite evidence, Source Scope, origin, or CPL.
- **Invariant 11:** Bad/Duplicate Form Leads never appear as selectable candidates; the server—not Admin—enforces this.
- **Invariant 12:** resolved cases remain immutable/readable and later sequences appear separately. UI must not collapse refresh evidence or sequence rows.
- Priority and Booking Action are independent. Individual actual Booked/Release actions remain individual timeline entries. Booking and Release cases may coexist and never visually or semantically close each other.

## 6. Deliverables and exact contract

### 6.1 Exact routes and query validation

Extend `src/routes/granot-lifecycle-admin.routes.ts` under the existing protected v1 surface:

```text
GET /api/v1/admin/granot-lifecycle/jobs/:normalized_job_no
GET /api/v1/admin/granot-lifecycle/cases
GET /api/v1/admin/granot-lifecycle/cases/:case_id
GET /api/v1/admin/leads/:lead_model/:lead_id/lifecycle
```

Reads require Owner/Admin and `{ ok:true, data }`. Add strict Zod schemas in `src/validation/v1/granotLifecycle.validation.ts`. Case list query is exact:

```ts
{
  kind?: "booking" | "release";
  state?: "open" | "resolved";
  mode?: string;
  source_id?: string;
  normalized_job_no?: string;
  opened_from?: string; // ISO
  opened_to?: string;   // ISO
  sort?: "last_evidence_at" | "opened_at";
  order?: "asc" | "desc";
  cursor?: string;
  limit?: number;       // 1..100, default 25
}
```

Unknown keys, invalid IDs/models/dates/ranges/cursors/sorts/limits return safe `400 GRANOT_VALIDATION_FAILED`; missing case returns `404 GRANOT_CASE_NOT_FOUND`. A missing Lead reuses the existing generic v1 404 envelope `{ ok:false, error:"Lead not found" }` and internal `app.not_found`; this issue does not invent an unlisted Granot error code. Cursor is opaque base64url `{ sort_value, id }`, stable by selected sort plus ObjectId; query with `limit+1` and return `{ items, next_cursor }`. Never put contact/source labels in a cursor.

`mode` is trimmed, 1–64 characters, and restricted to bounded lowercase snake_case; an empty value is omitted. `source_id` means `source_scope.granot_crm_source_id` and must be an ObjectId. Date bounds are inclusive, and `opened_from > opened_to` is invalid.

Section 28.2 does not name a candidate URL. Add this narrow **issue-author read contract** required by the approved Unit 23 browser:

```text
GET /api/v1/admin/granot-lifecycle/cases/:case_id/candidates
```

Strict query: `{ scope?:"source"|"all", lead_model?:"FormLead"|"CallLead", q?:string, cursor?:string, limit?:1..100 }`, default `scope:"source"`, default limit 25. Candidate browsing is Owner-only for both scopes because it exposes normalized owner-work contact; Admin-only readers cannot call it. `q` is trimmed, 1–100 characters when present, and an empty/whitespace browser value is omitted before request. No candidate request selects/attaches/corrects anything. The route passes case/query identities to Unit 22's server service.

Discrepancy routes are Unit 29 and health completion is Unit 30. Do not implement them here even though query keys/navigation placeholders may be reserved.

### 6.2 List and detail DTOs

Define DTOs under `src/services/granotLifecycle/projections.ts` (split focused files if clearer). Routes do not assemble them.

List items contain only: case ID/kind/state/mode/sequence; normalized/display Job Number; source ID plus reviewed display label; **server-masked** customer/contact label; latest action; evidence count; `case_revision`, `evidence_revision`; deterministic Booking presence/ID as a masked ref; `opened_at`, `last_evidence_at`, optional `resolved_at`; and age derived by the client from timestamps. No raw evidence/context arrays on list.

Authorized Booking detail contains:

- case identity/state/mode/sequence/revisions/timestamps and exact source scope;
- append-only normalized evidence summaries keyed by Observation/Decision IDs, each action/capture/decision outcome, never receipt payload/headers;
- `observed_context` under a clearly titled immutable Granot-evidence section;
- separately labeled submitted/ingested contact and accepted Granot contact when available;
- current suggestion plus reason/confidence and candidate-search capabilities, without silently attaching it;
- active Record Link summary and current revision;
- deterministic current Booking snapshot read-only for review-existing mode, including only owner-work fields and current Booking revision; current Cancellation fact separately when present;
- Employee Booking Lead Reconciliation delegation ref/status/link when AC-39 applies; and
- case/Job timeline page and capability flags for later commands/referral/release/discrepancies.

Create-missing official fields are represented as blank/absent—not defaulted from Granot move date, estimate, payment, balance, contact, source, or Agent. Existing review displays live Booking values only in the official-current section. Use exact label `Granot evidence — not official Vantage values` for Granot estimate/payment/balance.

Referral-safe detail types permit no Lead/suggestion/candidate capability, but Unit 23 does not open Referral cases. This is rendering foundation for Unit 28.

### 6.3 Candidate DTO and masking

Candidate response is `{ items, next_cursor }`. Each item has Lead ref/model, masked list contact, Job/ref compatibility display, Source Company/Granularity display IDs/labels, confidence/reason/match method, `in_source_scope`, eligibility, and warning requirement. It contains no raw submission snapshot, payload, CPL internals, secret, address, or arbitrary Lead document.

Unit 22 server policy owns ranking/eligibility. High exact matches may be marked preselected; medium Source Scope contact is display-only; ambiguity yields no suggestion. Default search is Source Scope; all-scope results carry `in_source_scope:false` and `requires_override_reason:true`. Bad/Duplicate candidates are absent. Searching/browsing/refreshing never mutates case, Lead, link, or official facts.

Lists always use irreversible centralized mask helpers. Detail/candidate may return normalized contact fields only when required for explicit Owner work, never raw receipts/headers. Expand forbidden-key recursive tests over every route DTO/log.

### 6.4 Complete Job and Lead timelines

The Job Number timeline is primary. It includes every available:

- Observation and individual Priority/Booked/Release statement;
- Decision and effect;
- Booking case sequence/open/refresh/resolution evidence;
- future Release case/discrepancy entries through reserved discriminants when those models land;
- Record Link establishment/refresh/correction/supersession and Entity Change;
- current official Booking and Cancellation fact.

The final specification names the timeline contents/order dimensions but not a DTO. Use this narrow **issue-author contract** as the server-authoritative outer shape and discriminant union:

```ts
type TimelineEntry<T extends string, P extends number, D> = {
  id: string;
  type: T;
  event_at: string;
  type_priority: P;
  data: D;
};

type GranotTimelineEntry =
  | TimelineEntry<"observation", 10, {
      observation_id: string; receipt_id: string; normalization_result: NormalizationResult;
      issue_codes: NormalizationIssueCode[];
    }>
  | TimelineEntry<"priority_effect", 20, {
      observation_id: string; decision_id?: string; canonical_priority: string; changed_paths: string[];
    }>
  | TimelineEntry<"booking_action", 30, {
      observation_id: string; decision_id?: string; action: "booked" | "release";
    }>
  | TimelineEntry<"decision", 40, {
      decision_id: string; observation_id: string; execution_mode: ExecutionMode;
      outcome: SynchronizationOutcome; reason_code: SynchronizationReasonCode;
      target?: EntityRef; effects: SynchronizationEffectSummary[];
    }>
  | TimelineEntry<"case", 50, {
      case_id: string; kind: "booking" | "release"; event: "opened" | "refreshed" | "resolved";
      state: "open" | "resolved"; mode: string; sequence_number: number;
      case_revision: number; evidence_revision: number; observation_id?: string;
    }>
  | TimelineEntry<"discrepancy", 60, {
      discrepancy_id: string; kind: "booking" | "release"; state: "open" | "resolved";
      reason_code: GranotDiscrepancyReasonCode;
    }>
  | TimelineEntry<"record_link_change", 70, {
      record_link_id: string; event: "established" | "refreshed" | "corrected" | "superseded";
      domain_revision: number; lead_ref?: EntityRef; booking_ref?: string;
    }>
  | TimelineEntry<"entity_change", 80, {
      change_id: string; entity: EntityRef; command_execution_id: string;
      revision_before: number; revision_after: number; changed_paths: string[];
    }>
  | TimelineEntry<"official_booking", 90, {
      booking_id: string; normalized_job_no: string; domain_revision: number; cancellation_id?: string;
    }>
  | TimelineEntry<"official_cancellation", 100, {
      cancellation_id: string; booking_id: string; domain_revision: number;
    }>;

type GranotTimelinePage = {
  items: GranotTimelineEntry[];
  next_cursor: string | null;
  current: {
    record_link?: SafeRecordLinkProjection;
    booking?: SafeBookingProjection;
    cancellation?: SafeCancellationProjection;
  };
  capabilities: {
    booking_cases: boolean;
    release_cases: boolean;
    discrepancies: boolean;
    official_facts: true;
  };
};
```

The priority mapping follows the union order: Observation `10`, Priority effect `20`, Booking Action `30`, Decision `40`, case `50`, discrepancy `60`, Record Link change `70`, Entity Change `80`, current Booking fact `90`, and current Cancellation fact `100`. Derive required `event_at` from the authoritative event field: Observation/Priority/Action `captured_at`; Decision `decided_at`; case evidence `captured_at` (or resolution `resolved_at` for a resolution entry); discrepancy `last_evidence_at`; Record Link/Entity Change `applied_at || established_at || last_observed_at`; official facts `last_changed_at || createdAt`. A row without a valid authoritative event time fails projection safely rather than substituting request `now`.

Sort ascending by `(event_at, type_priority, id)`; reverse only as a documented whole-page presentation choice, never per type. Cursor encodes exactly `{ event_at, type_priority, id }`. Visual grouping may label related entries but never removes, merges, or replaces individual evidence. Do not silently cap at 100.

The final spec does not define pagination DTOs for timelines. Use narrow **issue-author guidance**: accept strict optional `cursor`/`limit` (default 100, max 200) on Job/Lead reads and return `GranotTimelinePage`. The exported server DTO is authoritative for the Admin client; enforce parity with a compile-time contract test rather than independently redefining ordering. Capability booleans state which later model families are actually available; absence is not falsely reported as complete data.

Lead timeline uses `lead_model` exact union plus ObjectId, returns that Lead's immutable/current Granot effects, related Record Link(s), cases through linked Job numbers, Entity Changes, and official Booking/Cancellation refs. It never performs contact matching at read time.

### 6.5 Admin navigation, API client, and components

Add the specified Unit 23 files:

```text
lib/api/granotLifecycle.ts
components/granot-lifecycle/lifecycle-dashboard.tsx
components/granot-lifecycle/case-list.tsx
components/granot-lifecycle/case-detail.tsx
components/granot-lifecycle/job-timeline.tsx
components/granot-lifecycle/lead-candidate-browser.tsx
```

Add Owner-only routes:

```text
/ingestion/granot/lifecycle
/ingestion/granot/lifecycle/jobs/[jobNo]
/ingestion/granot/lifecycle/cases/[caseId]
```

Reserve discrepancy navigation only if it is a disabled/non-linking placeholder; Unit 29 owns the page. `/ingestion/granot` keeps HTTP automation and exposes distinct `Automation`/`Lifecycle` tabs. Never mix Granot cases with `/bookings/reconciliation` Employee workflow.

Default queue shows open Booking and Release kinds newest evidence first (`state=open`, `sort=last_evidence_at`, `order=desc`); before Unit 26, real rows are Booking-only but the discriminated UI must render synthetic Release input without collapse. Filters mirror server query and remain in the URL, including opaque cursor. List shows masked customer/contact, Job, source, mode, latest action, evidence count, and age.

Detail visually separates immutable evidence from official current facts, labels contacts, shows deterministic Booking read-only, and provides candidate browsing without a submit/confirm/update/no-action button. Evidence polling/refetch updates timeline/count/detail data while preserving component-owned in-progress draft state for later forms. Referral-shaped detail renders without Lead browser.

Use existing accessible components: labeled controls, focus management, keyboard navigation, loading/empty/error summaries, non-color-only status, semantic timeline/list markup, and responsive overflow. No bulk action.

### 6.6 Query keys and invalidation foundation

Extend `lib/query/keys.ts` with a distinct stable `granotLifecycle` family for list, case detail, candidates, Job timeline, Lead timeline, discrepancies, and health. Filter keys use the existing stable normalization and never include raw contact.

Provide exported invalidation helpers for future successful commands: case list/detail, Job timeline, Lead detail/timeline, Booking/Cancellation lists, and relevant analytics. Unit 23 does not call a mutation or fake success. A future `409` handler may refetch while preserving local draft; no command-era 409 route/form is implemented now.

## 7. Explicitly out of scope

- Case opening/refresh/sequence/index/candidate business policy (Unit 22); Admin never reproduces it.
- Confirm/Create/Update Booking, No Action, case resolution/reopen, owner command envelopes, form validation, conflict submission, or any official mutation (Units 24–25).
- Release model/service/read workflow beyond compatible DTO/component discriminants (Unit 26), Release commands (Unit 27), Referral behavior (Unit 28), discrepancies/correction (Unit 29), complete health/alerts (Unit 30), email (Unit 32).
- Record Link selection/correction, background candidate attachment, global contact matching, a generic reconciliation UI/model, or parallel Admin Mongoose models.
- Raw payload/header display, client-side-only masking, live payload/customer fixtures, production enablement/deployment, or external actions.

## 8. Flags and runtime posture

- Start/end checked-in defaults remain processing true, shadow true, and all Lead/Booking/Release/Referral/email effects false.
- Read routes remain available for existing cases regardless of the Booking-case creation flag. They must not disappear during rollback. Candidate browsing remains Owner-only even though standard list/detail/timeline reads permit Owner/Admin.
- Unit 23 deploys/reviews read capability first. Only a separately authorized environment change after server/Admin deployment, index verify, Owner review, and synthetic proof may set `GRANOT_LIFECYCLE_BOOKING_CASES_ENABLED=true` one source/effect at a time.
- `GRANOT_LIFECYCLE_BOOKING_COMMANDS_ENABLED=false` and every Release/Referral/email flag remain false. No checked-in code/config default is broadened.

## 9. Migration and indexes

**None.** Unit 22 owns Booking-case persistence and the Section 34.5 index flow. Unit 23 adds read code/UI/query state only; it must not add Admin persistence, duplicate indexes, backfill timeline documents, or rewrite cases.

Before staging/read enablement, verify Unit 22's index definitions with `pnpm migration:granot-lifecycle:indexes -- --verify`. This is read-only; no apply is authorized.

## 10. Acceptance criteria

- [ ] **AC-18 (read):** create-missing Priority-5 case appears with correct mode/evidence; Priority-5 plus existing Booking produces no review-case row/UI work.
- [ ] **AC-19 (read):** actual Booked shows create-missing or review-existing according to current Booking, with one deterministic Booking read-only and no second Booking/mutation control.
- [ ] **AC-20 (read/UI):** open refresh adds individual evidence/count/timeline entries; resolved/later sequences remain distinct; evidence-only refetch never clears local draft state or falsely changes `case_revision`.
- [ ] **AC-35:** raw payload/headers and sensitive keys are absent from every list/detail/candidate/Job/Lead/Admin projection and log; list contact is server-masked.
- [ ] **AC-36 (read portion):** concurrent Unit 22 winner is projected once per case/sequence and evidence is not duplicated/collapsed; transaction/index completion remains Unit 22/26/29.
- [ ] **AC-39 (read/UI):** Booking without Lead displays/deep-links the separate existing Booking Lead Reconciliation workflow; no Granot discrepancy/duplicate matcher or Lead selector is invented.
- [ ] **AC-40 (read foundation):** Booked and Release observations/case DTOs can coexist for one Job and render separately; neither hides/closes the other. Release persistence completion remains Unit 26.
- [ ] Auth, strict filters, stable opaque cursors, exact default queue, URL state, not-found/error envelopes, and Owner-only Admin navigation are proven.
- [ ] Candidate browsing obeys server eligibility/scope/confidence, permits Owner all-scope search with warning metadata, and causes zero selection/attachment/correction/effect.
- [ ] Job/Lead timelines use stable non-collapsing order and include all available evidence/current facts without silent truncation.

## 11. Required tests and commands

Name tests with allocated AC IDs. Server proof:

- projection tests for exact DTOs, timeline ordering/tie-break/cursor, all event families/current facts, contact labels, blank official create fields, deterministic Booking, delegation, and forbidden keys;
- route tests for Owner/Admin read auth, non-authorized denial, strict query/date/ID/model/cursor/limit validation, filters/sort/pagination, safe 404/400, masking, and no raw payload;
- candidate tests for source/all scope authorization, ranking metadata, Bad/Duplicate exclusion, cursor, and zero writes;
- module/route spies plus database counts proving zero aggregate/case/link/Command/Change/outbox/notification mutation.

Admin proof:

- API client/DTO/error tests and stable query-key tests;
- component tests for default queue, every URL filter/cursor, masked rows, create/review detail, evidence/current separation, exact Granot warning label, deterministic Booking, Employee delegation, Referral/no-Lead foundation, candidate scope/warnings, evidence refresh preserving draft, both-kind non-collapse, timeline stable order, and accessibility/keyboard/error states;
- route/nav/proxy authorization tests proving Owner-only UI and distinct Automation/Lifecycle versus Employee reconciliation.

Run:

```text
# vantage-main-server
node --import tsx --import ./scripts/test-setup.ts --test src/services/granotLifecycle/projections.test.ts src/routes/granot-lifecycle-admin.routes.test.ts src/validation/v1/granotLifecycle.validation.test.ts src/services/granotLifecycle/bookingReconciliation.test.ts
pnpm migration:granot-lifecycle:indexes -- --verify
pnpm test
pnpm typecheck

# vantage-admin
pnpm test
pnpm lint
pnpm typecheck
pnpm build
```

Use landed focused filenames if different and record them. UI snapshots alone cannot prove server masking/auth/zero mutation.

## 12. Live/staging verification

With redacted synthetic staging evidence, deploy server reads before Admin and keep Booking cases/commands false. Verify list filters/cursors/default sort, create-missing/review-existing/Priority-5-existing-no-case, high/medium/ambiguous candidates, masked list/full normalized detail boundary, evidence refresh/draft preservation, separate contact labels, current Booking/Cancellation, missing-Lead Employee delegation, individual Booked/Release observations, later sequence display, stable Job/Lead timelines, and accessible navigation. Assert zero Booking/Lead/Cancellation/link/case-resolution/Command/Change/outbox/discrepancy/notification writes.

After read UI review and Unit 22 index verify, a separately approved rollout may enable Booking cases for one source/effect while commands stay false. Observe at least one interval using bounded counts/causal IDs only. Stop on raw-data exposure, wrong candidate/mode/Booking, missing evidence, collapsed actions/sequences, duplicate case display, lost draft, unauthorized access, or any official mutation.

## 13. Rollback

Set/keep `GRANOT_LIFECYCLE_BOOKING_CASES_ENABLED=false` first; existing cases remain readable through protected server list/detail/timeline routes. If the UI caller is faulty, hide/roll back the Admin caller or deploy the prior safe read implementation—never remove the only protected server read path for existing cases. Preserve case data and capture/processing evidence. Do not disable capture or delete receipts, Observations, Decisions, activation, links, cases/evidence/revisions, indexes, audits, Commands/Changes, or committed official facts.

Never resolve/reopen cases, detach suggestions/links, mutate Bookings/Cancellations/Leads, or purge timeline evidence as rollback.

## 14. Required completion handoff

Create `delivery/completion-reports/UNIT-23-COMPLETION.md` using Runbook Section 13. Include verified Unit 22 prerequisite/index proof; both repos/branches; behavior-grouped route/validation/projection/API/component/nav/query files; exact DTO/cursor/mask/timeline/candidate/auth contracts and issue-author allocations; invariants/partial AC ownership; migration `none`; flags before/after; server/Admin focused/full/lint/typecheck/build results; masked list/detail/candidate/timeline/delegation/evidence-refresh/accessibility/zero-mutation proof; deployment/enablement actions (normally none); risks; both final Git statuses; and external-action statement.

Successful implementation completes S15's deployable read capability and allows separate Owner review. Units 24–25 remain blocked until that review; Unit 26 may begin once Booking reads/identity are verified stable.
