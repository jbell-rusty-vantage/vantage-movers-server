## Operations Registry work-package handoff

- Repository: `vantage-main-server`
- Branch: `feature/operations-registry`
- Base SHA: `b71016dfabea28389a503d5f4fcb3f70a53e4972`
- Head SHA: uncommitted working tree; no commit requested
- Work package: S3 First-class Source Granularities
- Integration branch expected: `feature/operations-registry`

### Delivered

- First-class `LeadSourceGranularity` model and Source Company ObjectId defaults/lifecycle/projection mode.
- Source Company and Source Granularity query, create/update, activation, dependency, and resolution-preview interfaces/routes.
- Immutable stable keys, channel lock after activation, default lifecycle checks, exact ambiguity, priority fallback, and active-only automatic resolution.
- Dynamic owner-created sources resolve without compile-time source unions.
- Embedded granularity/default-key writes rejected; embedded arrays and compatibility keys remain readable.
- Source health findings for invalid lifecycle/defaults and exact/fallback conflicts.
- Idempotent M3 migration with embedded-ID preservation, stable mappings/checksum, default mapping, collision checks, and resume cursor.

### Files

- Added: `src/models/LeadSourceGranularity.ts`
- Modified: `src/models/LeadSourceCompany.ts`
- Added: `src/services/operationsRegistry/{sourceRegistry,sourceResolution}.ts` and tests
- Modified: source admin routes/validation and compatibility service behavior
- Added: `scripts/migrations/operations-registry-source-granularities*`
- Intentionally untouched: embedded array contents, Master Leads projection behavior, historical models/database

### Verification

- Source schema/resolution/health/validation and legacy compatibility focused tests: passed.
- Migration tests: passed.
- `pnpm test`: 524 passed, 0 failed.
- `pnpm typecheck`: no Unit 1 diagnostics; command remains blocked by pre-existing unrelated `scripts/dev_ops/*` errors.
- Two `TEST_MODE=true pnpm migrations:operations-registry-source-granularities` dry runs:
  - planned: 13 creates, 6 company default updates, 0 conflicts
  - mappings: 13
  - checksum: `2375468e9126c4054cb43cc28477b699f77376dc7a8c4df55b562c2679c82511` both runs
  - embedded arrays untouched: true
  - one mapped record per embedded record: true
  - defaults resolve to mapped IDs: true

### Operational notes

- Projection mode defaults to `derived_import`; metadata storage does not enable direct source-sheet writes.
- M3 is dry-run by default and production guarded.
- Rollback: redeploy prior resolver; retain first-class records and embedded compatibility data.

### Risks and next step

- Production M3 requires reviewed inventory and dry-run manifests.
- Runtime-wide source consumer cutover remains S7; this package establishes the registry interface and admin route authority.
