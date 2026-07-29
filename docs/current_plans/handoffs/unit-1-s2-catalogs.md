## Operations Registry work-package handoff

- Repository: `vantage-main-server`
- Branch: `feature/operations-registry`
- Base SHA: `b71016dfabea28389a503d5f4fcb3f70a53e4972`
- Head SHA: uncommitted working tree; no commit requested
- Work package: S2 Agent and Merchant Registry
- Integration branch expected: `feature/operations-registry`

### Delivered

- Agent/Merchant alias and lifecycle schema fields plus embedded Agent `granot_identity`.
- Registry list/detail/create/rename/activation/dependency interfaces with transactional audit.
- Active-only default selection and alias-aware explicit inactive lookup.
- Nested Granot identity authority, immutable configured username, legacy flat-field fallback, and active-only automatic receiver matching.
- Existing Agent/Merchant URLs retained; activation/dependency URLs added.
- Idempotent M2 dry-run/apply migration with collision checks, manifest, checksum, and resume cursor.

### Files

- Modified: `src/models/Agent.ts`, `src/models/Merchant.ts`
- Added/modified: `src/services/operationsRegistry/catalogRegistry.ts` and tests
- Modified: `src/services/catalog/`, Agent receiver/allocation compatibility paths and tests
- Added: `scripts/migrations/operations-registry-agent-merchant-compatibility*`
- Intentionally untouched: Booking merchant/agent snapshots, historical models, extension repository

### Verification

- Catalog/Agent focused tests: passed.
- Migration tests: passed.
- Two `TEST_MODE=true pnpm migrations:operations-registry-agent-merchant` dry runs:
  - planned: 7 updates, 0 conflicts
  - checksum: `127f6f9a706ef095bcc486fcaf5165796e47f9c3cb4fea3d1919e9f725e597b4` both runs
  - receiver matching parity: true
  - Booking snapshots untouched: true

### Operational notes

- M2 is dry-run by default. Production apply requires `--apply`, production guards, reviewed manifest, and backup readiness.
- Compatibility fields retained: `granot_crm_username`; Booking Agent/Merchant string snapshots.
- Rollback: redeploy prior code; nested identity/aliases are additive and should not be deleted.

### Risks and next step

- Run production inventory and M2 dry-run only after Owner review.
- Flat Granot username retirement belongs to later consumer-cutover/hardening work.
