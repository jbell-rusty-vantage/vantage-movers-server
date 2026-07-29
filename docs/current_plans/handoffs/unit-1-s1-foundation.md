## Operations Registry work-package handoff

- Repository: `vantage-main-server`
- Branch: `feature/operations-registry`
- Base SHA: `b71016dfabea28389a503d5f4fcb3f70a53e4972`
- Head SHA: uncommitted working tree; no commit requested
- Work package: S1 Registry foundation, trusted actor, and audit
- Integration branch expected: `feature/operations-registry`

### Delivered

- Public `src/services/operationsRegistry/` module and stable Registry errors.
- Canonical HMAC actor signing/verification with bounded timestamp window, method/path binding, constant-time comparison, approved read roles, and Owner-only mutations.
- Narrow unsigned preview compatibility that is always disabled for production mutations.
- Transactional Registry Change model/helper, replay conflict handling, snapshot redaction, and post-commit cache invalidation.
- Overview, Health, and Registry Changes routes with signed actor reads.

### Files

- Added: `src/models/OperationsRegistryChange.ts`
- Added: `src/services/operationsRegistry/{config,errors,trustedActor,trustedActorCanonical,types,registryAudit,snapshotSanitizer,cacheInvalidation}.ts`
- Added: `src/services/operationsRegistry/queries/{overview,health,changes}.ts`
- Added: focused tests and `src/validation/v1/operationsRegistry.validation.ts`
- Modified: `src/routes/v1.routes.ts`, error barrels/codes, validation barrel
- Intentionally untouched: historical models/database and external providers

### Verification

- Registry focused tests: passed, including valid Owner, admin read-only, wrong role, missing/expired/tampered/method/path signatures, replay conflict, audit rollback, redaction, and post-commit invalidation.
- IDE lint diagnostics: none.
- `pnpm typecheck`: no Unit 1 errors; repository command remains non-zero on pre-existing unrelated `scripts/dev_ops/*` errors.

### Operational notes

- Environment/config:
  - required for signed traffic: `VANTAGE_ADMIN_PROXY_SIGNING_SECRET`
  - optional bounded override: `VANTAGE_ADMIN_PROXY_SIGNATURE_MAX_AGE_MS`
  - preview only: `OPERATIONS_REGISTRY_ALLOW_UNSIGNED_PREVIEW`
- Dashboard D0 must use the header names and canonical payload exported by `trustedActorCanonical.ts`.
- Rollback: old code ignores the additive audit collection; redeploy prior code without dropping audit data.

### Risks and next step

- Dashboard signing must be deployed before strict signed registry traffic is exposed.
- No secret values are stored in code or handoff.
