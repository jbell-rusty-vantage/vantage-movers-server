# Unit 29 — Booking/Release discrepancies, re-evaluation, and Record Link correction

> **Contract maturity: implementation-ready; implementation remains blocked by Units 26–27.** This is S20 only. It persists and resolves conflicting Booking/Release evidence after the normal reconciliation paths exist. A discrepancy is owner work, not authority to create/update a Booking, create/reverse a Cancellation, or reassign a Lead's Source Scope.

## 1. Authority and required reading

- **Final specification:** Sections 1–7, 12.3, 13, 18–25, 27–29, 33–41; especially Section 13 correction, Section 22, Section 23.1–23.3, Section 24.5, Section 28.2–28.4, AC-23/26/27/35/36, and Section 38/S20.
- **Acceptance ownership:** Unit 29 completes discrepancy persistence/UI/concurrency for AC-26/27/35/36 and the Record Link correction portion of AC-23. Units 24 and 26–27 retain normal Booking/Release and official-mutation ownership.
- **Approved split:** Unit 29 in `specs/lead_lifecycle_issue_breakdown_reccomendation.md`; Unit 28 Referral is not a prerequisite. Preserve the S20 exception-work boundary.
- **Execution:** `delivery/AGENT-EXECUTION-RUNBOOK.md`, server/Admin instructions and applicable rules, verified Units 22–27 completion evidence, and current code/index/flag state rather than the ledger alone.

The final specification wins. `GranotBookingDiscrepancy` and `GranotReleaseDiscrepancy` are separate durable work items. A normal missing Booking, pending/ambiguous Lead match, deferred policy, already-cancelled Release, or Booking missing its Lead is not a discrepancy.

## 2. Objective

Complete S20 end to end. Exact Booking/Release conflict routing opens or refreshes one reason-specific discrepancy with append-only evidence and a stable non-PII fingerprint. Protected list/detail/Job/Lead projections and Admin provide explicit review. An Owner may re-evaluate current facts, resolve No Action, or revision-safely replace a disputed active Record Link with a selected eligible Lead while preserving the superseded link and `EntityChange` history. Re-evaluation may atomically resolve the discrepancy and open the now-applicable normal reconciliation case. No path directly creates, updates, cancels, reverses, or reactivates a Booking/Cancellation or changes Lead Source Scope, Ingestion Origin, or CPL.

## 3. Repository, branch, and prerequisites

- **Repositories/branches:** `vantage-main-server` / `granot-lead-lifecycle` and `vantage-admin` / `granot-lead-lifecycle`. Server models, fingerprints, routing, projections, mutation results, and errors are authoritative. No extension work.
- **Prerequisites:** Units 24–27 complete; Unit 27 includes accepted Owner review of Unit 26 read-only Release cases. Reverify Unit 22 Booking discrepancy seams, Unit 26 Release reason seams, Unit 24–27 strict Owner/idempotency/CAS patterns, Unit 07/18 Record Link/Decision transaction behavior, and Unit 23/26 projection/privacy/cursor conventions.
- As of 2026-08-19, Units 24–25 are complete, Unit 26 is the current ready implementation target, and Unit 27 is blocked on Unit 26 plus Owner review. Units 26–28 have complete contracts but no completion reports. Unit 29 is therefore contract-complete but sequence-blocked.
- Runtime writes are limited to redacted synthetic fixtures under `TEST_MODE=true` on an explicitly confirmed replica set. No commit, push, deploy, production mutation/index apply, live payload read, effect enablement, or external send is authorized.

## 4. Current-state evidence to verify

Observed on 2026-08-19; date and correct these claims after Units 26–27 land:

- Shared `GranotDiscrepancyReasonCode` and the four discrepancy Decision reasons already exist. Booking reconciliation returns typed non-persisting reasons for official cancellation and identity conflicts. Unit 26 is contracted to add the equivalent Release seam. No discrepancy model/service/index or correction command exists.
- `projections.ts`, the Admin API types, and the Job timeline reserve discrepancy discriminants/capabilities, but server capabilities remain false and there are no discrepancy list/detail implementations or Admin discrepancy route/page.
- `GranotRecordLink` already has active/superseded state, `disputed`, `dispute_reason`, `domain_revision`, `superseded_by`, active-Job uniqueness, and link `EntityChange` support. Current code establishes/confirms links, but `correctGranotRecordLink` is not registered or implemented.
- The lifecycle router already owns the protected read/mutation surface, strict Owner actor construction, exactly-one `Idempotency-Key`, safe envelopes, and Section 28.4 error mapping. Extend it; do not add policy to routes or Admin.
- Booking case/index concurrency and current-cardinality patterns are implemented; Release equivalents must be consumed after Unit 26. Checked-in processing/shadow are true and every Lead/Booking/Release/Referral/email effect is false.
- Unit 23's authorized disposable `testvantagemovers` index apply/verify covered predecessor definitions only. Production index posture is unproven, and Unit 29's two discrepancy collections do not yet exist.

## 5. Locked decisions and invariants at risk

- **Invariant 1:** Mongo current Booking/Cancellation/Lead/Record Link/discrepancy/case facts govern classification and resolution; Admin state and Granot text do not.
- **Invariant 2:** conflicting Granot evidence remains evidence and never directly creates/updates/cancels/un-cancels official facts.
- **Invariant 4:** correction/re-evaluation cannot select or create a second Booking for the Job.
- **Invariants 5–6:** Record Link correction is a canonical command. The old-link transition, replacement link, discrepancy resolution/re-evaluation, Command, Changes, and revisions commit atomically with complete causal provenance.
- **Invariant 7:** refresh, re-evaluation with unchanged conflict, replay, and No Action create no Lead/Booking/Cancellation Change or Sheet work. No Action creates no `EntityChange` at all.
- **Invariants 8–10:** preserve source system/channel/origin/actor/initiator separation, immutable evidence, and every Lead's Source Company, Source Granularity, Ingestion Origin, and CPL. Correction changes association, never attribution.
- **Invariant 11:** Duplicate Form Leads are never eligible correction targets; Bad Form Leads remain ineligible for suggestion/booking/correction under the locked rules.
- **Invariant 12:** reconciliation cases already resolved stay immutable. Discrepancy resolution never reopens one; re-evaluation may open only the next normal case allowed by current state and sequence rules.

## 6. Deliverables and exact contract

### 6.1 Separate discrepancy models, reasons, evidence, and indexes

Add `src/models/GranotBookingDiscrepancy.ts` and `src/models/GranotReleaseDiscrepancy.ts`; do not create a generic reconciliation/discrepancy collection. Reuse shared case evidence, actor, state, and No Action sub-schemas where exact. Each collection implements:

```ts
type GranotDiscrepancyDocument = {
  _id: ObjectId;
  normalized_job_no: string;
  discrepancy_kind: "booking" | "release";
  reason_code: GranotDiscrepancyReasonCode;
  reason_fingerprint: string; // lowercase SHA-256, 64 hex chars
  state: "open" | "resolved";
  record_link_id?: ObjectId;
  lead_ref?: { model: "FormLead" | "CallLead"; id: ObjectId };
  booking_id?: ObjectId;
  cancellation_id?: ObjectId;
  evidence: Array<{
    observation_id: ObjectId;
    decision_id: ObjectId;
    captured_at: Date;
    action: "priority_5" | "booked" | "release";
  }>;
  evidence_revision: number;
  revision: number;
  resolution?: {
    outcome: "re_evaluated" | "record_link_corrected" | "no_action";
    command_execution_id: ObjectId;
    actor: DurableActor;
    reason_code?: NoActionReasonCode;
    reason_text?: string;
    resolved_at: Date;
  };
  opened_at: Date;
  last_evidence_at: Date;
};
```

Booking rows accept only `booked_record_link_conflict`, `booked_booking_lead_conflict`, `booked_job_number_conflict`, `booked_source_scope_conflict`, and `booked_after_official_cancellation`. Release rows accept only `release_without_vantage_booking`, `release_record_link_conflict`, `release_job_number_conflict`, and `release_source_scope_conflict`.

Declare on each collection:

```ts
{ normalized_job_no: 1, discrepancy_kind: 1, reason_fingerprint: 1 }
  unique, partialFilterExpression: { state: "open" }
{ state: 1, last_evidence_at: -1 }
```

Use deterministic names parallel to landed lifecycle indexes, register all four definitions with Section 34.5 tooling, and keep runtime `autoIndex` disabled. Resolved rows and resolution are immutable; evidence IDs are append-only/deduplicated by Observation ID; direct updates require `state:"open"`; no replace/evidence removal is allowed.

The final specification locks the hash inputs as a stable non-PII identity tuple but not its serialization. **Issue-author guidance:** centralize a versioned canonical-JSON fingerprint helper over `{ version:1, discrepancy_kind, normalized_job_no, reason_code, record_link_id:null|string, lead_ref:null|{model,id}, booking_id:null|string, cancellation_id:null|string }`, normalize ObjectIds to lowercase hex, retain all null keys, and SHA-256 the UTF-8 canonical form. Do not include contact, source labels, raw Job snapshot text, Observation/Decision IDs, timestamps, revision numbers, or mutable display fields. Pure golden-vector tests freeze this contract.

### 6.2 Exact routing, open/refresh, and transaction behavior

Add `src/services/granotLifecycle/discrepancies.ts`. The processor/Booking/Release reconciliation modules pass typed current-state conflict facts and Observation/Decision IDs; the discrepancy module independently reloads protected evidence/current state before persistence. Routes/Admin never choose a reason.

Persist only the exact Section 22 mappings. Explicitly reject discrepancy creation for normal missing Booking under Priority 5/Booked, pending/ambiguous Lead matching, deferred/blocked policy, already-cancelled Release, or a Booking merely missing its Lead. The latter continues to Booking Lead Reconciliation. Booked after official Cancellation maps only to `booked_after_official_cancellation`; Release without Booking maps only to `release_without_vantage_booking`; link/Job/source conflicts retain their exact kind-specific reason.

Creation requires `execution_mode:"live"`, valid post-activation evidence, reviewed source gates, and the applicable case flag: Booking reasons require `GRANOT_LIFECYCLE_BOOKING_CASES_ENABLED`; Release reasons require `GRANOT_LIFECYCLE_RELEASE_CASES_ENABLED`. Historical/live shadow, disabled flags, unclassified/deferred policy, invalid/unsupported actions, or absent normalized Job create no discrepancy.

Open sets both revisions to `1`, stores stable current refs, exact evidence, and timestamps. A same-fingerprint open row appends/deduplicates evidence, refreshes current refs only when still compatible with the same reason identity, updates `last_evidence_at`, and increments `evidence_revision`; exact replay is a no-op. Owner-relevant current-state change increments `revision`, never rewrites earlier evidence, and must not silently change the reason/fingerprint—another reason gets its own open discrepancy. Decision uses `outcome:"conflict"` and the exact `booking_discrepancy_opened|booking_discrepancy_refreshed|release_discrepancy_opened|release_discrepancy_refreshed` reason with `discrepancy_opened|discrepancy_refreshed` effect.

Decision and discrepancy open/refresh commit atomically in the lifecycle transaction. The open unique index is the race guard; one bounded retry rereads and converges concurrent same-fingerprint evidence into one open row. Booking and Release discrepancies and different reason fingerprints may coexist. Resolution never auto-resolves another discrepancy or case.

### 6.3 Owner inputs, commands, responses, and errors

Add the exact Section 28.3 routes:

```text
POST /api/v1/admin/granot-lifecycle/discrepancies/:id/re-evaluate
POST /api/v1/admin/granot-lifecycle/discrepancies/:id/correct-record-link
POST /api/v1/admin/granot-lifecycle/discrepancies/:id/no-action
```

All require trusted Owner auth, exactly one valid `Idempotency-Key`, strict unknown/server-owned-field rejection, server checksum, and route-owned discrepancy ID. The final specification does not publish body names for discrepancy revision guards; use this fail-closed **issue-author contract** and freeze it in Zod/route tests:

```ts
type ReEvaluateDiscrepancyBody = { expected_revision: number }; // integer >= 1
type CorrectRecordLinkBody = {
  expected_revision: number;
  expected_link_revision: number;
  selected_lead: { lead_model: LeadModel; lead_id: string };
  reason_text: string; // trimmed, 10-1000 characters
};
type DiscrepancyNoActionBody = {
  expected_revision: number;
  reason_code?: NoActionReasonCode;
  reason_text?: string; // trimmed, max 1000
};
```

Persist issue-author command names `reEvaluateGranotDiscrepancy`, final-spec `correctGranotRecordLink`, and `resolveGranotDiscrepancyNoAction`. Extend command provenance with `discrepancy_id` and the stable Receipt/Observation/Decision chain; use the authenticated Owner actor/initiator according to the landed canonical context contract.

Return `200 { ok:true,data }` for all fresh resolutions and exact replay:

```ts
type DiscrepancyOwnerCommandResult = {
  discrepancy_id: string;
  discrepancy_kind: "booking" | "release";
  state: "open" | "resolved";
  revision: number;
  evidence_revision: number;
  outcome: "still_conflicting" | "re_evaluated" | "record_link_corrected" | "no_action";
  command_execution_id: string;
  replacement_record_link_id?: string;
  opened_case_ref?: { model: "GranotBookingReconciliationCase" | "GranotReleaseReconciliationCase"; id: string };
  replayed: boolean;
};
```

Use Section 28.4 codes. Missing discrepancy is `GRANOT_DISCREPANCY_NOT_FOUND`; stale discrepancy/correction race uses published owner-work `GRANOT_CASE_REVISION_CONFLICT`; stale link uses `DOMAIN_REVISION_CONFLICT`; ineligible/changed identity uses `GRANOT_IDENTITY_CONFLICT`. Safe errors include request ID and bounded issues only.

### 6.4 Re-evaluate and No Action

Re-evaluate reloads the open discrepancy, newest accepted evidence chain, current Registry/source facts, active Record Link, eligible Lead, deterministic Booking/Cancellation, case flags, and normal Booking/Release reconciliation state. It never re-normalizes raw payload and never promotes a historical/live-shadow Decision.

- If the exact conflict remains, leave the discrepancy open, update no revisions/evidence, persist only the idempotent `reEvaluateGranotDiscrepancy` execution/result, create no Change/case/Sheet work, and return `still_conflicting`. Exact replay returns that stored result.
- If current state now yields normal reconciliation, atomically store the command, resolve `re_evaluated`, increment `revision` once, and open/refresh the correct normal Booking/Release case through its production module. Existing resolved cases stay closed and sequence rules remain authoritative.
- If current state is officially satisfied, resolve `re_evaluated` without case or aggregate mutation.
- If facts changed into another discrepancy reason, resolve the old row and atomically open/refresh the correctly fingerprinted new row; never rewrite the old reason.

No Action persists only Command plus discrepancy resolution/Owner/reason and increments `revision` once. It creates no `EntityChange`, aggregate revision, Record Link, case, Lead/Booking/Cancellation/Customer mutation, Sheet work, notification, or email. Exact replay never resolves twice.

### 6.5 Record Link correction transaction

Correction is available only for an open link/Lead/Job/Source conflict with an active disputed Granot Record Link; never for `booked_after_official_cancellation` or `release_without_vantage_booking`. Revalidate discrepancy/link revisions, provider/Job, current evidence, selected Lead eligibility, non-Duplicate/non-Bad status, and authoritative Source Scope. An out-of-old-scope Lead is allowed only with the mandatory reason. Never edit the Lead's Source Company, Source Granularity, Ingestion Origin, CPL, snapshots, or business fields.

Inside one `executeIdempotentCanonicalCommand` transaction:

1. CAS the old link by `_id`, `state:"active"`, provider/Job, and `domain_revision`;
2. set `state:"superseded"` and `superseded_by`, retain dispute/original evidence, increment/stamp revision, and append its `EntityChange`;
3. create one replacement active link with a preallocated ID, the same normalized/raw Job snapshot, selected `lead_ref`, compatible existing `booking_ref`, the selected Lead's unchanged authoritative Source Scope, `established_by_decision_id`, `established_at`, `last_observation_id`, `last_observed_at`, `disputed:false`, no dispute reason/superseder, initial revision/history stamp, and its `EntityChange`;
4. persist Command, full discrepancy provenance, and `record_link_corrected` resolution;
5. re-evaluate and, when valid, open/refresh the normal Booking/Release case atomically.

The active-Job unique index is the final race guard. Exact already-correct state may replay/already-satisfy without another link; different identity conflicts. No official aggregate or Sheet mutation is allowed. Preserve old-link history; never mutate it into the replacement or add an unbounded correction array.

### 6.6 Protected reads, Admin, timeline, and privacy

Implement:

```text
GET /api/v1/admin/granot-lifecycle/discrepancies
GET /api/v1/admin/granot-lifecycle/discrepancies/:id
```

**Issue-author query contract:** mirror case cursor/date/state/source/Job sorting, add bounded `kind?:"booking"|"release"` and exact `reason_code?`, default open newest evidence first, cursor+stable ID, and limit 1–100/default 25. Lists show Job, kind/reason, masked contact/source context, evidence count/age, and current refs—never payload/headers/unmasked contact. Detail separates immutable evidence from current link/Lead/Booking/Cancellation facts, exposes current revisions/capabilities, and reuses Unit 23 server-owned candidate eligibility.

Add Admin route `/ingestion/granot/lifecycle/discrepancies/[id]`, `discrepancy-detail.tsx`, list/filter affordances, stable query keys, and timeline/case links. Offer only server-advertised explicit review actions (`Re-evaluate`, `Correct Record Link`, `Resolve — No Action`), no bulk action, with accessible focus/labels/errors/keyboard/non-color status. A `409` refetches current facts, preserves selection/reason, explains revision change, and never auto-resubmits. Success invalidates discrepancy, Job/Lead timeline, affected case, and link-derived queries.

Timeline shows discrepancy open/refresh/resolve and old-link superseded/new-link corrected as separate events. Admin owns no routing/fingerprint/eligibility policy. BFF permits Owner mutations and Owner/Admin reads, forwards one idempotency key/trusted actor, strips authority/secrets, and audits only masked discrepancy/command/outcome refs—never Job/contact/reason/raw response.

## 7. Explicitly out of scope

- Release work (Units 26–27), Referral (28), operations/alerts (30), certification beyond owned indexes (31), optional email (32), cleanup (33), and current-payload certification (34).
- Automatic Booking/Cancellation/Lead/Customer mutation, un-cancellation/reactivation, Lead creation/enrichment/attachment, source/CPL change, or Sheet projection.
- Treating normal missing Booking, pending/ambiguous matching, deferred policy, already-cancelled Release, or Booking-without-Lead as discrepancy.
- Generic case/model, mutable lifecycle enum, unbounded correction array, Owner-selected Booking, or client/Admin classification.
- Production apply/deploy/flag change, live payload/customer inspection, raw/secret/unmasked data in output, or external send.

## 8. Flags and runtime posture

Checked-in defaults remain exactly:

```text
GRANOT_LIFECYCLE_PROCESSING_ENABLED=true
GRANOT_LIFECYCLE_SHADOW_MODE=true
GRANOT_LIFECYCLE_LEAD_WRITES_ENABLED=false
GRANOT_LIFECYCLE_LEAD_CREATION_ENABLED=false
GRANOT_LIFECYCLE_BOOKING_CASES_ENABLED=false
GRANOT_LIFECYCLE_BOOKING_COMMANDS_ENABLED=false
GRANOT_LIFECYCLE_RELEASE_CASES_ENABLED=false
GRANOT_LIFECYCLE_RELEASE_COMMANDS_ENABLED=false
GRANOT_LIFECYCLE_REFERRAL_BOOKING_ENABLED=false
GRANOT_LIFECYCLE_EMAIL_ENABLED=false
```

There is no new discrepancy flag. Matching case flags control automatic creation; trusted Owner auth plus live/current policy controls explicit actions. Tests inject only applicable live case flags. Historical shadow never opens discrepancies and live-shadow is never promoted. Disabling a case flag stops new corresponding discrepancies without deleting/hiding existing rows. Do not enable official command, Referral, or email flags.

## 9. Migration and indexes

Section 34.5 applies to four indexes across two new collections. Extend the one index catalog/report/apply/verify implementation:

```text
pnpm migration:granot-lifecycle:indexes -- --report
pnpm migration:granot-lifecycle:indexes -- --apply --confirm-production=<db>
pnpm migration:granot-lifecycle:indexes -- --verify
```

Report is deterministic/PII-safe, creates non-unique before unique definitions, and requires zero open-fingerprint collisions per collection. Omitted mode is report; modes cannot combine; verify is read-only/nonzero on drift. No historical discrepancy backfill or database apply is authorized. Runtime must not create indexes silently.

## 10. Acceptance criteria

- [ ] **AC-23:** out-of-scope eligible Lead selection requires Owner reason and atomically replaces the Record Link with supersession evidence while leaving Lead Source Scope unchanged.
- [ ] **AC-26:** Booked after official Cancellation opens/refreshes Booking Discrepancy; already-cancelled Release stays already-current with no discrepancy/reversal.
- [ ] **AC-27:** Release without Booking or conflicting link/Job/Source opens/refreshes the exact Release Discrepancy and never creates/cancels/updates anything.
- [ ] **AC-35:** raw payload/headers/credentials/addresses are absent from projections/Admin/events/logs/Changes/tests/manifests; list contact is masked and audits omit reason/contact.
- [ ] **AC-36:** real unique partial indexes hold one open row per Job/kind/fingerprint under concurrent evidence; refresh converges and resolved rows never reopen.
- [ ] Exact exclusions/fingerprints/separate models, revisions/CAS/replay, re-evaluation, link history, zero official/Sheet effect, and accessible draft-preserving Admin behavior are proven.

## 11. Required tests and commands

Name focused tests with AC-23/26/27/35/36. Require pure/model reason/fingerprint/index/immutability tests; module/processor gate/open/refresh/re-evaluate/No Action tests; route/projection ACL/body/error/cursor/masking tests; replica open/refresh/resolve/correction/CAS/unique/replay/rollback/sequence races; and before/after zero-forbidden-effect counts. Admin proves typed clients, URL filters, detail/timeline/candidates, BFF security/audit, action gating, accessibility, `409` draft preservation, and invalidations.

```text
# vantage-main-server
node --import tsx --import ./scripts/test-setup.ts --test src/models/GranotBookingDiscrepancy.test.ts src/models/GranotReleaseDiscrepancy.test.ts src/validation/v1/granotLifecycle.validation.test.ts src/routes/granot-lifecycle-admin.routes.test.ts src/services/granotLifecycle/discrepancies.test.ts src/services/granotLifecycle/projections.test.ts src/services/domainCommands/domainCommands.test.ts scripts/migrations/granot-lifecycle-indexes.test.ts
TEST_MODE=true SHEET_SYNC_MODE=queued pnpm test:granot-lifecycle:replica -- --unit=29
TEST_MODE=true pnpm migration:granot-lifecycle:indexes -- --verify
pnpm test
pnpm typecheck

# vantage-admin
pnpm test
pnpm lint
pnpm typecheck
pnpm build
```

Use landed filenames if different. Mocked/UI tests cannot replace replica index/link-transaction proof. Update lifecycle projection/Booking/Release docs and applicable rules.

## 12. Live/staging verification

Use redacted synthetic conflicts, test Registry rows, disposable replica set, queued/stubbed Sheets, and injected flags. Exercise every reason/exclusion, refresh/races, masked reads, all resolution paths, correction/replay/link race, Admin conflict recovery, and rollback. Inspect bounded IDs/revisions/reasons/fingerprint hashes/changed paths only.

S20 live proof is synthetic first: one conflict refreshes one discrepancy and correction preserves old-link history. Any production read is separately authorized/read-only and uses causal IDs/metrics, never payload/contact. Stop on wrong reason, duplicate row/link, source/CPL change, official/Sheet mutation, missing history/causal ref, lost draft, raw exposure, or later effect.

## 13. Rollback

Disable/hide `correct-record-link` first; discrepancies remain readable. If automatic creation is faulty, disable the narrow Booking- or Release-case flag while capture/processing/read projections continue. Disable re-evaluate/No Action callers without deleting work. Preserve all receipts, Observations, Decisions, activation, Registry/audits, Record Links/history, discrepancies/evidence/resolutions, cases, Commands, Changes, revisions, and official facts.

Never delete a discrepancy/replacement link, rewrite old history, decrement revisions, reopen resolved work, reverse official facts, or enqueue automatic compensation. A wrong correction requires a separately reviewed canonical correction with current revisions.

## 14. Required completion handoff

Create `delivery/completion-reports/UNIT-29-COMPLETION.md` using Runbook Section 13. Include prerequisite/Owner-review proof; both repos/branches; exact reason/fingerprint/model/index/route/body/command/link/re-evaluation contracts; invariants/ACs; index posture; flags; focused/full/replica/Admin results; masked routing/concurrency/replay/rollback/zero-effect/privacy proof; final Git statuses; and external-action statement.

Successful implementation completes S20 and unblocks Unit 30 after applicable Units 01–29 are repository-verified. It does not authorize production rollout, optional email, cleanup, or current-payload use.
