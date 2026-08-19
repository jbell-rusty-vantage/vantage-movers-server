# Unit 23 — Booking lifecycle reads, Admin queue/detail, candidate browser, and Job/Lead timeline

**Status:** Blocked at delivery gate; implementation and functional verification complete  
**Repositories / branches:** `vantage-main-server` / `granot-lead-lifecycle` (`8b507a4` base) and `vantage-admin` / `granot-lead-lifecycle` (`a109d08` base)

## Authority and prerequisite result

Implemented final-spec Sections 1–7, 12.3, 18–21, 27, 28.2, 29, and 33–41 plus S15's read half and Unit 23's issue-author DTO/cursor contracts. This unit owns the read/UI portions of AC-18–20, all Unit 23 AC-35 proof, the projection/non-collapse portion of AC-36, the navigation/delegation portion of AC-39, and Booking/read-compatible AC-40 foundations.

Unit 22 was reverified from landed code at `8b507a4`, not from the ledger alone. Its exact Booking-case model, five named indexes, open/refresh service, candidate policy, processor integration, false effect flags, and tests are present. Current replica proof passed 3/3 for race convergence, replay/sequence behavior, revision splitting, and transaction rollback. The implementation prerequisite is satisfied.

Delivery is nevertheless **blocked** by the contract-required aggregate read-only index command. The shared disposable test database reports 20 missing predecessor index definitions. None of the five Unit 22 Booking-case indexes is missing or mismatched, but the required command is not green and Runbook Section 14 forbids a completion claim. No index apply was attempted.

## Behavior delivered

### Server read authority

- Strict Zod schemas cover exact case filters/defaults, ObjectId/model/date/range validation, bounded snake-case mode, opaque base64url cursors, timeline limits, and Owner candidate queries.
- Protected routes expose case list/detail, case candidates, Job timeline, and Lead timeline. Owner/Admin may read standard lifecycle projections; candidates are Owner-only. Missing cases use `GRANOT_CASE_NOT_FOUND`; missing Leads retain the generic v1 envelope.
- Projection DTOs are allowlisted and recursively forbidden-key checked. Lists expose irreversible masked contact and masked Booking refs; detail separates submitted/accepted contact, immutable evidence, and live official facts under the exact warning `Granot evidence — not official Vantage values`.
- Case list pagination is stable by selected timestamp plus ObjectId. Timeline order is stable ascending `(event_at,type_priority,id)` and its cursor encodes exactly those fields. Available observations, individual Priority/Booking Action facts, Decisions, case evidence/sequences/resolution, Record Link changes, Entity Changes, Booking, and Cancellation facts remain distinct. Pagination advertises remaining rows rather than silently capping at 100.
- Lead timelines follow persisted Record Links and never contact-match at read time. Capability flags remain false for Release cases/discrepancies until their models land.
- Candidate browsing remains in the Booking reconciliation policy seam. It preserves canonical high/medium confidence, excludes Bad/Duplicate Form Leads, supports Source Scope and warned Owner all-scope review, and exposes no selection/attachment/correction writer.

### Admin read workflow

- A typed browser API client mirrors the exported server list/detail/candidate/timeline DTOs, URL-encodes identifiers, serializes all filters/cursors, omits blank candidate search, and returns safe typed errors.
- A distinct `queryKeys.granotLifecycle` family covers queue, detail, candidates, Job/Lead timelines, discrepancy reservation, and health. Future command invalidation helpers exist but Unit 23 never calls them.
- Owner-only pages under `/ingestion/granot/lifecycle` render URL-backed queue filters, case detail, read-only candidates, and Job timelines. Automation and Lifecycle remain distinct tabs; Employee Booking reconciliation remains a separate workflow.
- Detail presentation preserves Granot evidence versus official facts, deterministic Booking, Employee reconciliation delegation, separate Booking/Release discriminants, exact warnings, and local draft state across evidence refetch. Referral-shaped input exposes no candidate browser. No command, bulk action, or fake-success control exists.
- Proxy ACL explicitly permits standard lifecycle GETs for Admin/Owner, denies Admin candidates and all Admin lifecycle writes, and permits Owner candidates. Server authorization remains authoritative even when UI navigation is hidden.

## Files added or changed

### Main server

- `src/services/granotLifecycle/projections.ts` and `.test.ts` — masked DTOs, case reads, candidates, stable complete available-fact timelines, forbidden-key proof.
- `src/services/granotLifecycle/projections.replica.test.ts` — real Mongo read workflow plus before/after counts for every mutation-sensitive collection family.
- `src/routes/granot-lifecycle-admin.routes.ts` and `.test.ts` — protected thin read routes, role/error/default coverage.
- `src/validation/v1/granotLifecycle.validation.ts` and `.test.ts` — strict query/path/cursor validation.
- `src/services/granotLifecycle/bookingReconciliation.ts` and `.test.ts` — server-owned candidate browser projection policy.
- `src/services/granotLifecycle/errors.ts` — safe case-not-found code.
- `.cursor/businesslogic/granotLifecycle.projections.md`, `.cursor/businesslogic/granotLifecycle.bookingReconciliation.md`, `.cursor/index.md`, and applicable organization/schema/capture rules — runtime ownership and posture documentation.

### Admin

- `lib/api/granotLifecycle.ts` and `.test.ts` — DTO/client/error boundary.
- `lib/query/keys.ts`, `lib/query/granotLifecycle.ts`, and tests — isolated stable keys and future invalidation foundation.
- `components/granot-lifecycle/*` — queue, detail, timeline, candidates, dashboard, navigation.
- `app/(dashboard)/ingestion/granot/layout.tsx` and `lifecycle/**` — Owner-gated pages.
- `server/auth/authorization.ts` and `.test.ts` — explicit proxy role matrix.
- `tests/granot-lifecycle-components.test.ts` — presentation, accessibility, URL, non-collapse, delegation, and draft-refetch proof.
- `.cursor/rules/project-organization.mdc` — additive ownership map.

## AC and invariant proof

| Acceptance / invariant | Proof |
| --- | --- |
| AC-18/19 | Projection/component tests cover create-missing/review-existing and deterministic Booking read-only presentation; the Unit 22 service proof covers Priority-5-existing-Booking no case. |
| AC-20 | Server timeline/cursor tests keep evidence and sequences individual; Admin proof preserves local draft state across evidence refresh. |
| AC-35 | Actual DTO forbidden-key assertions, masked list/detail/candidate tests, and browser rendering tests exclude receipt payloads, headers, credentials, addresses, and raw list contacts. |
| AC-36 | Stable case/sequence projection and non-collapse tests complement current 3/3 replica race/rollback proof. |
| AC-39 | Detail/UI exposes the existing Employee Booking reconciliation ref/link and invents no matcher or selector. |
| AC-40 | DTO/UI discriminants render Booking and synthetic future Release rows separately; capability flags do not claim unlanded Release persistence. |
| Invariants 1–12 | Reads compose current facts without lifecycle-state storage; evidence remains evidence; source/contact axes stay labeled; bad/duplicate candidates are excluded; no read route exposes a domain command or resolution writer. |

## Migration, indexes, and flags

Unit 23 adds **no migration, model, index, or Admin persistence**. Read-only verification ran against the explicit disposable test database with `TEST_MODE=true` and `SHEET_SYNC_MODE=disabled`:

```text
pnpm migration:granot-lifecycle:indexes -- --verify
```

Result: exit 1, 20 missing predecessor indexes, zero mismatches. The missing set covers earlier CRM source, Decision, activation, Entity Change, Lead S08, and Call Log definitions. None of the five Booking-case index names is missing. No `--apply` ran; production index presence and rollout are not claimed.

Checked-in defaults began and end unchanged: processing/shadow `true/true`; Lead write/creation, Booking cases/commands, Release cases/commands, Referral Booking, and email effects all `false`. Existing reads are not gated by case creation.

## Verification

Main server:

```text
node --import tsx --import ./scripts/test-setup.ts --test src/services/granotLifecycle/projections.test.ts src/routes/granot-lifecycle-admin.routes.test.ts src/validation/v1/granotLifecycle.validation.test.ts src/services/granotLifecycle/bookingReconciliation.test.ts
pnpm test:granot-lifecycle:replica -- --unit=22
pnpm test:granot-lifecycle:replica -- --unit=23
pnpm test
pnpm typecheck
git diff --check
```

- Focused: 33/33 passed.
- Unit 22 replica prerequisite: 3/3 passed.
- Unit 23 replica zero-mutation proof: 1/1 passed.
- Full: 1,435 tests; 1,378 passed, 0 failed, 57 skipped (the Unit 23 replica proof is opt-in in the ordinary suite).
- Typecheck passed. Diff check passed with CRLF advisories only.

Admin:

```text
pnpm test
pnpm lint
pnpm typecheck
pnpm build
git diff --check
```

- Full: 200/200 passed.
- Lint, typecheck, build, and diff check passed. Next generated all three lifecycle routes.

No live/staging payload verification or deployment occurred. Tests use synthetic/redacted values. Route/module construction and UI/API surfaces expose reads only; no selection, attachment, correction, resolution, aggregate command, Entity Change, outbox, notification, or email call is reachable. The Unit 23 replica test snapshots and compares real collection counts around queue/detail/candidate/Job/Lead reads for Form/Call Leads, Bookings, Cancellations, cases, links, Commands, Changes, Sheet outbox, operational events, and notifications.

## Risks, blocker, and next units

- Exact blocker: reconcile the 20 predecessor indexes through a separately reviewed/authorized process, then rerun the aggregate `--verify` command successfully. Production must separately verify all exact definitions before any Booking-case enablement.
- Release persistence/discrepancy timelines remain capability-false until Units 26/29. Units 24–25 remain blocked on delivery completion plus Owner review; Unit 26 remains blocked on Unit 23 completion.
- No unit is newly unblocked while the delivery gate is red.
- Existing/concurrent unrelated server changes were preserved: AI transcription dependency/script edits, two deletions, and separate planning/example documents.

## Repository state and external actions

Final server `git status --short`:

```text
 M .cursor/businesslogic/granotLifecycle.bookingReconciliation.md
 M .cursor/index.md
 D .cursor/ringcentral_cron_review.md
 M .cursor/rules/granot-lifecycle-capture.mdc
 M .cursor/rules/project-organization.mdc
 M .cursor/rules/schema-and-crud-inputs.mdc
 D claude_prompts/unit_21_instructions.md
 M package.json
 M pnpm-lock.yaml
 M scripts/prototypes/granot-lead-lifecycle/delivery/UNIT-STATUS.md
 M scripts/prototypes/granot-lead-lifecycle/delivery/issues/UNIT-23.md
 M scripts/test-granot-lifecycle-replica.ts
 M src/routes/granot-lifecycle-admin.routes.test.ts
 M src/routes/granot-lifecycle-admin.routes.ts
 M src/services/granotLifecycle/bookingReconciliation.test.ts
 M src/services/granotLifecycle/bookingReconciliation.ts
 M src/services/granotLifecycle/errors.ts
 M src/services/granotLifecycle/projections.test.ts
 M src/services/granotLifecycle/projections.ts
 M src/validation/v1/granotLifecycle.validation.test.ts
 M src/validation/v1/granotLifecycle.validation.ts
?? .cursor/businesslogic/granotLifecycle.projections.md
?? docs/to_review/vercel-blob-planned-uses.md
?? scripts/prototypes/granot-lead-lifecycle/delivery/completion-reports/UNIT-23-COMPLETION.md
?? scripts/prototypes/granot-lead-lifecycle/delivery/issues/WEBHOOK-RECEIPT-PAYLOAD-EXAMPLES.md
?? src/services/granotLifecycle/projections.replica.test.ts
```

Final Admin `git status --short`:

```text
 M .cursor/rules/project-organization.mdc
 M lib/query/keys.test.ts
 M lib/query/keys.ts
 M server/auth/authorization.test.ts
 M server/auth/authorization.ts
?? app/(dashboard)/ingestion/granot/layout.tsx
?? app/(dashboard)/ingestion/granot/lifecycle/
?? components/granot-lifecycle/
?? lib/api/granotLifecycle.test.ts
?? lib/api/granotLifecycle.ts
?? lib/query/granotLifecycle.test.ts
?? lib/query/granotLifecycle.ts
?? tests/granot-lifecycle-components.test.ts
```

Both worktrees remain uncommitted. The server dependency edits, two deletions, and unrelated planning/example documents are concurrent/user changes and were preserved.

**No commit, push, deploy, production mutation, production/live payload read, production migration/index apply, Registry change, provider request, external Sheet/CRM send, notification, email, or flag enablement occurred.** Only synthetic disposable replica-set test data was written and cleaned by the test harness.
