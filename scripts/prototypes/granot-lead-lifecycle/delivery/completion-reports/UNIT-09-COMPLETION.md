# Unit 09 completion — Aggregate revision fields and additive revision migrations

## Status and scope

- **Status:** complete
- **Repository / branch:** `vantage-main-server` / `granot-lead-lifecycle`
- **Authoritative contract:** final specification Sections 1–2, 4–7, 14.1, compare-and-swap rules in 23.2, 34.3–34.5, 35–36, 37.1–37.2, 38/S07 and the revision-only portion of S08, and 39–41
- **Acceptance ownership:** revision/race prerequisite of AC-21 and revision/causal-chain prerequisite of AC-32. Unit 09 proves tokens, the CAS primitive, and the honest history-boundary migration only. Units 10–11 own command replay, complete causal chains, no-op behavior, and live mutation races.
- **Applicable invariants preserved:** 1 (Mongo is SoR), 4 (one Booking per normalized Job; collisions block unique-index apply), 5 (this additive metadata migration is not a general mutation bypass), 6 (Decision/Command/Change/outbox chain is not claimed complete), 9 (boundary does not fabricate older history)
- **Runtime posture:** no new flag module or caller. Unit 07 defaults remain: processing true, shadow true, all eight effect flags false. Schema defaults and migration metadata create no business effect.

## Files added or changed

### Models / schema

- `src/models/granotLifecycleSchemas.ts` — shared `domain_revision` / `last_change_*` / `change_history_started_at` fields and write-once / one-sided-pair guards
- `src/models/FormLead.ts`, `CallLead.ts`, `BookedLead.ts`, `CancelledLead.ts` — identical additive fields; Booking named unique partial Job index `booked_lead_normalized_job_no_unique` (also accepts legacy `normalized_job_no_1`)
- `src/models/granotAggregateRevisions.test.ts` — model/DTO/historical-schema proofs

### CAS primitive

- `src/services/granotLifecycle/aggregateRevision.ts` + `.test.ts` + `.replica.test.ts` — `{ _id, domain_revision }` filter, single `$inc`, `DOMAIN_REVISION_CONFLICT`
- `src/services/granotLifecycle/errors.ts` — `DOMAIN_REVISION_CONFLICT` token (spec string, not `GRANOT_` prefixed)

### Migrations / indexes

- `scripts/migrations/granot-lifecycle-revisions.lib.ts` — shared reviewed-boundary persist, plan/verify/apply, Booking Job inventory with sha256 fingerprints
- `scripts/migrations/granot-lifecycle-lead-provenance.ts` + `.lib.ts` + `.test.ts` — Form/Call revision `0` + common boundary only
- `scripts/migrations/granot-lifecycle-aggregate-revisions.ts` + `.lib.ts` + `.test.ts` — Booking/Cancellation same fill + uniqueness readiness
- `scripts/migrations/granot-lifecycle-revisions.replica.test.ts` — disposable replica CAS, conditional apply, Booking uniqueness
- `scripts/migrations/granot-lifecycle-indexes.ts` / `.lib.ts` / `.test.ts` — catalog version `granot-lifecycle-indexes/6`; Booking collision/verify/create; Unit 02 guarantees remain
- `scripts/test-granot-lifecycle-replica.ts` — unit `09` registration, `--test-concurrency=1`
- `package.json` — `migration:granot-lifecycle:leads`, `migration:granot-lifecycle:revisions`

### Compatibility

- `src/services/historicalConsolidation/schemaValidation.ts` — production insert validation tolerates schema-owned `domain_revision` / `change_history_started_at` defaults without treating them as sheet-planned facts or `last_change_*` history

### Docs

- `.cursor/businesslogic/granotLifecycle.revisions.md` (new)
- `.cursor/businesslogic/form-lead.service.md`, `call-lead.service.md`, `bookings.service.md`, `cancelledLead.service.md`
- `.cursor/index.md`
- `.cursor/rules/schema-and-crud-inputs.mdc`, `project-organization.mdc`, `business-logic.mdc`

## Exact contracts landed

### Shared aggregate metadata (Section 14.1)

| Field | Rule |
| --- | --- |
| `domain_revision` | Required nonnegative integer. New documents default to `0`. Invalid (negative/fractional/non-finite/non-numeric) rejected. |
| `last_change_id` / `last_changed_at` | Optional pair. Both absent until Unit 11. One-sided pair fails validation. |
| `change_history_started_at` | Honest start-of-history boundary. New rows get trusted server `new Date()`. Clients cannot supply it. Write-once outside the reviewed migration seam. |

`__v` may remain for Mongoose compatibility and is not the lifecycle contract. Public/admin/trusted DTOs reject these fields. Historical schemas/collections are not write targets and do not gain the fields.

Revision `0` means no authoritative post-boundary lifecycle change has been recorded.

### Compare-and-swap (Section 23.2 primitive only)

```ts
filter: { _id, domain_revision: expected }
update: { $inc: { domain_revision: 1 } }
matchedCount === 0 → { ok: false, code: "DOMAIN_REVISION_CONFLICT" }
```

No fallback write without the revision filter. Units 10–11 wire this into command execution.

### Revision migrations (34.3 revision-only + 34.4)

| Command | Unit 09 scope |
| --- | --- |
| `pnpm migration:granot-lifecycle:leads` | Form/Call missing `domain_revision -> 0` and the common history boundary |
| `pnpm migration:granot-lifecycle:revisions` | Booking/Cancellation same fill, plus normalized-Job uniqueness readiness |
| `pnpm migration:granot-lifecycle:indexes` | Reconcile Booking unique partial Job index after a zero-collision report |

One reviewed UTC ISO boundary is persisted at `scripts/output/granot-lifecycle-revisions/reviewed-boundary.json` (gitignored) and reused by both apply and both verify commands. Report may generate it; apply/verify require the persisted or requested value and never advance an existing boundary.

Apply uses still-missing filters (`domain_revision: { $exists: false }` / `change_history_started_at: { $exists: false }`), batch size 100, and aborts on concurrent mismatch. Rerun never resets a positive revision or an existing boundary. Migrations never write `last_change_*`, Decisions, Commands, `EntityChange`, or Sheet Sync. Historical collections are never targeted.

Booking collisions (counts + masked IDs + key fingerprints only) block apply and unique-index readiness. No raw Job/customer/contact values appear in manifests.

## Migrations / indexes / database mode

- **Database:** `testvantagemovers` (`database_category: test`). `TEST_MODE=true` was set only in the process environment; `.env` was not edited.
- **Reviewed boundary:** `2026-08-17T20:22:37.134Z` generated by the Lead report, then reused as `persisted` by the revisions report. Unchanged on rerun.
- **Lead report** (`applied: 0`): form_leads 26/26 missing revision+boundary; call_leads 7/7 missing; 0 blockers; 0 fabricated last-change/Decision/Command/Change/Sheet work.
- **Revisions report** (`applied: 0`): booked_leads 13/13 missing; cancelled_leads 3/3 missing; Booking `unique_index_ready: true`; `collision_count: 0`.
- **Lead / revisions verify:** exit 1 as required while pre-existing rows still lack metadata (`26+7` Form/Call and `13+3` Booking/Cancellation missing revision and boundary). No apply was run against the shared test database.
- **Conditional apply / idempotent rerun / positive-revision preservation:** proven on synthetic seeded rows in the replica suite, not by mutating the full shared test DB.
- **Index report:** exit 0; `collision_count: 0`; `created_index_names: []`; Booking collisions `[]`.
- **Index verify:** exit 1 because Unit 06/07 named indexes are not yet applied on this disposable DB. **Booking index itself verified:** `booked_lead_verify.ok: true`, observed name `normalized_job_no_1` (accepted legacy contract name).
- **No production report/apply/index create.**

## Flags before / after

`.env` does not set the ten Unit 07 lifecycle flags (only `GRANOT_LIFECYCLE_REPLICA_TESTS=true`). Effective defaults, unchanged:

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

No effect was enabled to exercise revisions.

## Verification commands

### Focused (issue §11)

```text
node --import tsx --import ./scripts/test-setup.ts --test "src/models/granotAggregateRevisions.test.ts" "scripts/migrations/granot-lifecycle-lead-provenance.test.ts" "scripts/migrations/granot-lifecycle-aggregate-revisions.test.ts" "scripts/migrations/granot-lifecycle-indexes.test.ts"
```

**35 pass / 0 fail.**

Additional CAS unit file `src/services/granotLifecycle/aggregateRevision.test.ts`: **1 pass**.

### Replica-set

```text
TEST_MODE=true pnpm test:granot-lifecycle:replica -- --unit=09
```

**3 pass / 0 fail** (sequential CAS + concurrent one-winner; report writes zero / apply idempotent; Booking uniqueness/collision).

### Full repository

```text
pnpm test
```

**1122 tests; 1113 pass / 0 fail / 9 skipped.**

```text
pnpm typecheck
```

**pass** (`tsc --noEmit` exit 0).

```text
git diff --check
```

**pass** (CRLF conversion warnings only; no whitespace errors).

### Disposable CLI (test DB only)

```text
TEST_MODE=true pnpm migration:granot-lifecycle:leads -- --report     # exit 0; applied 0
TEST_MODE=true pnpm migration:granot-lifecycle:revisions -- --report # exit 0; applied 0; same boundary
TEST_MODE=true pnpm migration:granot-lifecycle:leads -- --verify     # exit 1; missing metadata
TEST_MODE=true pnpm migration:granot-lifecycle:revisions -- --verify # exit 1; missing metadata
TEST_MODE=true pnpm migration:granot-lifecycle:indexes -- --report   # exit 0; 0 collisions; 0 created
TEST_MODE=true pnpm migration:granot-lifecycle:indexes -- --verify   # exit 1; Booking Job index ok (legacy name)
```

## AC-to-proof coverage

| AC / checklist | Proof |
| --- | --- |
| AC-21 foundation (tokens + CAS) | `granotAggregateRevisions.test.ts`; `aggregateRevision.test.ts`; replica CAS one winner / loser `DOMAIN_REVISION_CONFLICT` |
| AC-21 Booking uniqueness | index tests accept named or `normalized_job_no_1`; replica duplicate Job `11000` or collision-blocked apply; no unique Lead Job index |
| AC-32 foundation (honest boundary, no fabricated history) | model write-once / server boundary tests; migration tests `last_change_writes: 0` and zero Decision/Command/Change/Sheet; replica apply does not write `last_change_*` |
| New docs default revision 0; invalid / one-sided fail; `__v` ≠ contract | `granotAggregateRevisions.test.ts` |
| New aggregate server boundary; clients cannot supply; verify rejects missing | model tests + verify CLI / unit verify failures |
| Report writes zero; apply conditional/idempotent; verify fails invariants | replica apply test; CLI report `applied: 0`; CLI verify exit 1 |
| Positive revisions / valid boundaries never reset | lead-provenance unit tests + replica positive-revision row |
| Collision fixtures block apply/index; no raw Job/contact | aggregate-revisions + indexes unit tests |
| Legacy readable; DTOs cannot set metadata | historical schema test + DTO `.strict()` tests |

## Concurrency, idempotency, privacy

- Replica-set CAS: sequential loser conflicts; concurrent pair has exactly one winner and stored revision `1`.
- Apply is still-missing-filtered and idempotent; report changes zero documents/indexes.
- Manifests use masked IDs and sha256 Job-key fingerprints. No raw customer/contact/Job/payload/credential values in output files inspected.
- Historical collections targeted: `[]`.

## Masked verification

Disposable `testvantagemovers` only. Manifest checksums: Lead report `d08b5b44eb0539bc55482cf09343f97b737c1f97721582923609997f9355ac72`; revisions report `3ca40659aac4bdc49b4d31d77ece8e0e694e2b57782774ff5015fc50806952bb`. IDs recorded as `6a17…` / `6a18…` / `6a62…` masks only. No HTTP/Admin/extension smoke. No current live payload inspection.

## Known risks and deferred work

- Full AC-21 (owner-command replay/race) and full AC-32 (Receipt → Observation → Decision → Command → Change) remain Units 10–11 and later effect units.
- Shared test-DB rows still lack revision metadata. CLI verify correctly fails until a separately authorized disposable apply. Replica tests already proved apply/verify on synthetic rows. This session did **not** apply against the full shared test database.
- Index verify is red for Unit 06/07 indexes that were never applied on this disposable DB. Booking Job uniqueness is already present under legacy name `normalized_job_no_1`.
- Historical consolidation planner still omits revision fields from sheet-derived documents; production schema defaults attach them at insert validation. Consolidation apply is not a substitute for the reviewed revision migration.
- Units 12–13 must extend `migration:granot-lifecycle:leads` without resetting or relabeling revision history or the persisted boundary.
- `EntityChange`, command executor, Lead provenance beyond revision/boundary, and unique Lead Job indexes remain later units.

## Newly unblocked

Successful verified implementation unblocks **Unit 10**. Unit 11 still waits for Unit 10. Units 12–13 must preserve this unit's revisions and history boundary.

## Final `git status --short`

### vantage-main-server (`granot-lead-lifecycle`)

Predecessor Unit 08 work remains in the tree and was not discarded. Unit 09 additions and the in-scope historical-consolidation compatibility fix:

```text
 M .cursor/businesslogic/bookings.service.md
 M .cursor/businesslogic/call-lead.service.md
 M .cursor/businesslogic/cancelledLead.service.md
 M .cursor/businesslogic/form-lead.service.md
MM .cursor/index.md
MM .cursor/rules/business-logic.mdc
MM .cursor/rules/project-organization.mdc
MM .cursor/rules/schema-and-crud-inputs.mdc
MM package.json
 M scripts/migrations/granot-lifecycle-indexes.lib.ts
 M scripts/migrations/granot-lifecycle-indexes.test.ts
 M scripts/migrations/granot-lifecycle-indexes.ts
MM scripts/prototypes/granot-lead-lifecycle/delivery/UNIT-STATUS.md
AM scripts/test-granot-lifecycle-replica.ts
 M src/models/BookedLead.ts
 M src/models/CallLead.ts
 M src/models/CancelledLead.ts
 M src/models/FormLead.ts
 M src/models/granotLifecycleSchemas.ts
MM src/services/granotLifecycle/errors.ts
 M src/services/historicalConsolidation/schemaValidation.ts
?? .cursor/businesslogic/granotLifecycle.revisions.md
?? scripts/migrations/granot-lifecycle-aggregate-revisions.lib.ts
?? scripts/migrations/granot-lifecycle-aggregate-revisions.test.ts
?? scripts/migrations/granot-lifecycle-aggregate-revisions.ts
?? scripts/migrations/granot-lifecycle-lead-provenance.lib.ts
?? scripts/migrations/granot-lifecycle-lead-provenance.test.ts
?? scripts/migrations/granot-lifecycle-lead-provenance.ts
?? scripts/migrations/granot-lifecycle-revisions.lib.ts
?? scripts/migrations/granot-lifecycle-revisions.replica.test.ts
?? scripts/prototypes/granot-lead-lifecycle/delivery/completion-reports/UNIT-09-COMPLETION.md
?? src/models/granotAggregateRevisions.test.ts
?? src/services/granotLifecycle/aggregateRevision.replica.test.ts
?? src/services/granotLifecycle/aggregateRevision.test.ts
?? src/services/granotLifecycle/aggregateRevision.ts
```

Plus the preserved uncommitted Unit 08 / user files already present on this branch.

No commit, push, deploy, production mutation, production index apply, live-payload access, Granot call, or external send occurred.
