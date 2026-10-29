# Classify Provider Failures and Decide Retry

- Status: reviewed starter, 2026-10-29
- Target: `src/services/durableWork/providerRetry.ts`
- Current declared exports: `classifyGoogleFailure`, `decideProviderRetry`, `providerStatus`.
- Evidence: `src/services/durableWork/providerRetry.ts`, `docs/knowledge/services/ingestion.md`, `docs/knowledge/services/reporting.md`, `.cursor/story-refactor-workspace/DIRECTIVE.md`, `src/services/granotHttpCollector/runWorkflow.ts`, `src/services/reporting/reporting.service.ts`

## Recommendation

Consider renaming `classifyGoogleFailure` to `sayWhatKindOfGoogleOrChecksumThrowThisIs` if the live callers still benefit; keep `classifyGoogleFailure` as an exact alias until callers migrate. Keep the operation in its current module and avoid a new service class or a split by CRUD verb.

Best Relocation sheet ingestion is not live. Keep this shared module: inspect its actual live callers before changing names or contracts; Granot automation, reporting, Sheet Sync, lifecycle and other services use parts of durable work. Preserve fencing, serialization, retry and error semantics where applicable.

## Parity checks

Read the target and its current callers before applying any change. Exercise the exported operation through existing tests, including success, empty or rejected input, and the relevant error and side-effect paths. Preserve response shapes and ordering; a test must fail on a changed result rather than swallow errors. Follow the matching Service document for the operation-specific invariant.

**Specific parity:** 429 is rate-limited; 408, 5xx and listed network codes are transient. Authentication, authorization and structural errors do not retry. Preserve attempt and elapsed limits, retry-after, jitter and deadline deferral.

## Source-verified implementation constraints (2026-10-29)

Keep status extraction, failure classification and retry decision independently callable. Preserve direct status/statusCode before nested response, 3-digit status strings, code normalization and classifier precedence. Retry caps include attempt and elapsed time; valid Retry-After takes precedence over jitter but is still capped by max_delay. At or beyond deadline/elapsed retry boundary defer to now + max(delay,defer_delay), rather than sleeping inline. Prove Retry-After=0, equality at deadline, exhausted attempts and nonretryable categories.
