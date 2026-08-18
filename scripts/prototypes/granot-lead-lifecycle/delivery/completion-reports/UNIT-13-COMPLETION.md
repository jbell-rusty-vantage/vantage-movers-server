# Unit 13 completion — Lead provenance and index migration suite

## Status and scope

- **Status:** complete
- **Repository / branch:** `vantage-main-server` / `granot-lead-lifecycle`
- **Authoritative contract:** final specification Sections 1–2, 4–7, 10.1, 14.1–14.4, 15, 27, 34.3, 34.5, 34.7, 35–37, 38/S08, and 39–41
- **Acceptance ownership:** migration foundation/partial proof for AC-10, AC-11, and AC-12. Runtime/current-state/display proof remains Units 12/15/18.
- **Applicable invariants preserved:** 1 (Mongo is SoR), 5 (this metadata migration is not a business-write bypass), 6 (no Decision/Command/Change/revision increment/Sheet work), 8 (origin is not inferred from channel/label/transport), 9 (`captured_at_ingestion` survives byte-for-byte), 10 (origin/source/CPL never reassigned by guess), 11 (Duplicate/Bad values untouched)
- **Runtime posture:** no flag, caller, or later Section 23.4 command enabled. Unit 07 defaults remain: processing true, shadow true, all eight effect flags false.

## Files added or changed

### Lead provenance migration

- `scripts/migrations/granot-lifecycle-lead-provenance.ts` — extends the Unit 09 Lead command with origin/Job/snapshot report → apply → verify and two gitignored artifacts
- `scripts/migrations/granot-lifecycle-lead-provenance.lib.ts` — fail-closed origin classification, Job normalize-from-`job_no` only, `legacy_baseline` builders, collision inventory, reviewed `baseline_captured_at`, apply predicates, PII scan
- `scripts/migrations/granot-lifecycle-lead-provenance.test.ts` — Unit 09 revision proofs retained plus Unit 13 AC-named foundation/partial tests
- `scripts/migrations/granot-lifecycle-lead-provenance.replica.test.ts` — disposable replica report/apply/rerun/verify/index proofs

### Indexes

- `scripts/migrations/granot-lifecycle-indexes.ts` / `.lib.ts` / `.test.ts` — catalog version `granot-lifecycle-indexes/8`; seven non-unique Lead S08 indexes; predecessor checks preserved
- `src/models/FormLead.ts` / `CallLead.ts` — named S08 index catalog (`FORM_LEAD_S08_INDEXES`, `CALL_LEAD_S08_INDEXES`); keys unchanged
- `src/models/FormLead.test.ts` / `CallLead.test.ts` — named catalog witnesses
- `scripts/test-granot-lifecycle-replica.ts` — unit `13` registration

### Docs

- `.cursor/businesslogic/granotLifecycle.revisions.md`, `form-lead.service.md`, `call-lead.service.md`
- `.cursor/rules/schema-and-crud-inputs.mdc`, `project-organization.mdc`, `business-logic.mdc`

## Exact contracts landed

### Origin decision table

| Evidence | Result |
| --- | --- |
| Existing valid Form/Call union member | preserve; never overwrite |
| Missing / blank origin | `legacy_unknown` |
| Value outside the Unit 12 union | contradiction blocker; no silent repair |
| Nested `ringcentral.ingestion_source`, source labels, actor, `ref_no`, `lid` | ignored for origin |
| `legacy_import` | never invented; only preserved if already stored |

### Snapshots and Job

- Missing contact snapshot → `legacy_baseline` from current allowed contact fields only, and only when at least one value exists.
- Missing Form move snapshot → same rule from current Form move fields.
- Existing `captured_at_ingestion` / `legacy_baseline` snapshots are never rewritten.
- `normalized_job_no = normalizeJobNo(job_no)` when a Job value exists. Form Job parity never uses `ref_no`, `lid`, Booking, Sheet, or Granot.
- Normalization collisions are inventory (fingerprints + masked IDs) only.

### Indexes

```text
form_lead_normalized_job_no
form_lead_source_granularity_normalized_job_no
form_lead_source_granularity_normalized_phone_duplicate
form_lead_ref_no_duplicate
call_lead_source_granularity_normalized_job_no
call_lead_source_granularity_normalized_phone_created
call_lead_origin_source_ingested_phone_created
```

All seven are non-unique. Verify also accepts Mongo default names for the same keys. No globally unique Lead Job index. Compatibility indexes are not removed.

## Migrations / indexes / database mode

- **Database:** `testvantagemovers` (`database_category: test`). `TEST_MODE=true` and `SHEET_SYNC_MODE=disabled` were set only in the process environment; `.env` was not edited.
- **Reviewed history boundary (Unit 09, reused, not advanced):** `2026-08-17T20:22:37.134Z`
- **Reviewed `baseline_captured_at` (Unit 13, separate file):** `2026-08-17T23:42:53.843Z`
- **Lead report** (`applied: 0`): form_leads 28/28 planned (`legacy_unknown` 28, deterministic 0, contradictions 0, missing Job 28, snapshots absent 28, duplicate 2); call_leads 7/7 planned (`legacy_unknown` 7, raw Job present 7, normalized already present, snapshots absent 7, missing source-scope 7). Collision groups `[]`. Fabricated Change/Command/Decision/Sheet `0`. Historical collections targeted `[]`.
- **Protected apply-manifest checksum:** `079901defc374c4837a58f5f0b58814e4faa28be3592e8df45e91e131871ff89`
- **Lead / index verify:** exit 1 as required while shared test-DB rows still lack metadata and the seven Lead indexes are not left applied on the shared DB. Replica suite already proved apply/verify/idempotency on synthetic rows.
- **Index report:** exit 0; `collision_count: 0`; `created_index_names: []`; `global_unique_lead_job_index: false`.
- **No production report/apply/index create.** No full shared-test-DB Lead apply.

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

No effect was enabled to validate metadata.

## Verification commands

### Focused (issue §11)

```text
node --import tsx --import ./scripts/test-setup.ts --test "scripts/migrations/granot-lifecycle-lead-provenance.test.ts" "scripts/migrations/granot-lifecycle-indexes.test.ts" "src/models/FormLead.test.ts" "src/models/CallLead.test.ts"
```

**43 pass / 0 fail / 0 skipped.**

### Replica-set

```text
TEST_MODE=true SHEET_SYNC_MODE=disabled pnpm test:granot-lifecycle:replica -- --unit=13
```

**4 pass / 0 fail** on disposable replica-set `testvantagemovers`:

- Seeded missing/captured/duplicate rows: report plans only additive metadata; apply writes origin/`normalized_job_no`/`legacy_baseline`; captured snapshots and all listed business/revision fields stay equal; rerun updates `0`; verify ok; `entity_changes` and `domain_command_executions` counts unchanged
- Concurrent origin write aborts instead of overwriting
- Injected invalid origin makes verify fail
- Seven Lead indexes create non-unique, verify exact definitions, and leave no global unique Lead Job index (created names dropped after the test)

Masked synthetic phones `5550100140`–`5550100144`. Marker `_u13_marker`. No Booking/Cancellation rows. Lifecycle effect flags remained false.

### Full repository

```text
pnpm test
```

**1183 tests; 1162 pass / 0 fail / 21 skipped.**

```text
pnpm typecheck
```

**pass** (`tsc --noEmit` exit 0).

```text
git diff --check
```

**pass** (no whitespace errors).

### Disposable CLI (test DB only)

```text
TEST_MODE=true pnpm migration:granot-lifecycle:leads -- --report     # exit 0; applied 0
TEST_MODE=true pnpm migration:granot-lifecycle:indexes -- --report   # exit 0; 0 created
TEST_MODE=true pnpm migration:granot-lifecycle:leads -- --verify     # exit 1; remaining planned + missing revision/origin
TEST_MODE=true pnpm migration:granot-lifecycle:indexes -- --verify   # exit 1; predecessor + Lead S08 indexes not left applied
```

## AC-to-proof coverage

| AC / checklist | Proof |
| --- | --- |
| AC-10 foundation/partial (primary contact + captured snapshot unchanged; missing evidence labeled `legacy_baseline`) | provenance unit tests; replica before/after business-field equality; captured snapshot deep-equal |
| AC-11 foundation/partial (move snapshot honest baseline; zero current move rewrite) | baseline builder copies only present move fields; replica Form move snapshot + unchanged `pickup_zip` / `destination_zip` / `move_size` |
| AC-12 foundation/partial (no fabricated current/Change history) | replica Change/Command counts unchanged; apply writes no revision increment; planner `fabricated_entity_changes: 0` |
| Report writes zero; apply conditional/idempotent; verify fails injected mismatch | CLI report `applied: 0` / `created_index_names: []`; replica apply/rerun/verify |
| Unknown origin is `legacy_unknown`; no deterministic guess | origin classifier + CLI origin counts |
| Manifest/collision output PII-safe | review projection uses masked IDs; apply manifest has IDs + field flags only; privacy scan green |
| Seven non-unique Lead indexes; no global unique Lead Job; predecessor catalog still tested | index unit tests + replica index create/verify |

## Concurrency, idempotency, privacy

- Apply uses still-missing filters and re-plans each row; concurrent origin write is `concurrent_mismatch`.
- Rerun after a successful apply updates `0`.
- Review projection contains counts, masked IDs (`6a17…`, `6a83…`), key fingerprints, and the protected checksum. No raw Job, name, phone, email, address, source/customer value, payload, or credential appears in the review artifact.
- Historical collections targeted: `[]`.

## Masked verification

Disposable `testvantagemovers` only. External effects disabled. Synthetic Form/Call rows through native collection writes (to bypass new-row `legacy_unknown` guards). Masked ids `6a17…` / `6a83…`. No HTTP/Admin/extension smoke. No current live payload inspection. No production apply.

## Known risks and deferred work

- Full AC-10/11 display and later Granot current-state mutation remain Units 15/18.
- Full AC-12 Entity Change / current-contact mutation remains Units 12/15/18.
- Shared test-DB rows still lack provenance and most Unit 09 revision metadata. CLI verify correctly fails until a separately authorized disposable apply. Replica tests already proved apply/verify on synthetic rows. This session did **not** apply against the full shared test database.
- Index verify is red for Unit 06/07 indexes that were never applied on this disposable DB, and for the seven Lead indexes after the replica test dropped the names it created.
- Historical origin evidence remains fail-closed to `legacy_unknown`. Unit 14 must consume these fields read-only and must not reinterpret `legacy_unknown` or `legacy_baseline`.
- Compatibility Lead indexes are inventoried, not removed.
- `legacy_import` is never assigned by this migration.

## Newly unblocked

Successful verified implementation completes **S08** and unblocks **Unit 14**.

## Final `git status --short`

### vantage-main-server (`granot-lead-lifecycle`)

```text
 M .cursor/businesslogic/call-lead.service.md
 M .cursor/businesslogic/form-lead.service.md
 M .cursor/businesslogic/granotLifecycle.revisions.md
 M .cursor/rules/business-logic.mdc
 M .cursor/rules/project-organization.mdc
 M .cursor/rules/schema-and-crud-inputs.mdc
 M scripts/migrations/granot-lifecycle-indexes.lib.ts
 M scripts/migrations/granot-lifecycle-indexes.test.ts
 M scripts/migrations/granot-lifecycle-indexes.ts
 M scripts/migrations/granot-lifecycle-lead-provenance.lib.ts
 M scripts/migrations/granot-lifecycle-lead-provenance.test.ts
 M scripts/migrations/granot-lifecycle-lead-provenance.ts
 M scripts/prototypes/granot-lead-lifecycle/delivery/UNIT-STATUS.md
 M scripts/test-granot-lifecycle-replica.ts
 M src/models/CallLead.test.ts
 M src/models/CallLead.ts
 M src/models/FormLead.test.ts
 M src/models/FormLead.ts
?? scripts/migrations/granot-lifecycle-lead-provenance.replica.test.ts
?? scripts/prototypes/granot-lead-lifecycle/delivery/completion-reports/UNIT-13-COMPLETION.md
```

No other repository was in scope.

No commit, push, deploy, production mutation, production index apply, live-payload access, Granot call, or external send occurred.
