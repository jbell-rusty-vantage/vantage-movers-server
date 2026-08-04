# Best Relocation Stage 4 — Implementation Handoff (WP4.8–WP4.9)

Status: **repository fixes implemented for WP4.8–WP4.9 review/security findings**; **live CI execution, Cloud setup, acceptance tests 10–19 external evidence, Picker browser E2E, canary, and signoff remain externally pending**  
Implementation source: [`best-relocation-stage-4-google-delivery-and-rollout.md`](./best-relocation-stage-4-google-delivery-and-rollout.md)

## Delivered in repository (WP4.8–WP4.9)

### WP4.8 — Automated and live Google coverage

- **Protected live Google harness** (`src/services/reporting/live/liveGoogleOrchestration.ts`, `liveGoogleHarness.ts`, `scripts/reporting/run-live-google-harness.ts`)
  - Production orchestration seam: `registerReportingStage4Foundation`, `createReportingDestination`, durable queued runs via `seedLiveTestQueuedRun`, real leased `runReportingDeliveryWorker` with owner-OAuth Google adapters
  - **Route/queue bypass (honest limitation):** the harness calls `runReportingDeliveryWorker` in-process with injected adapters. It does **not** exercise HTTP admin routes, Vercel cron dispatch, or the `reporting-delivery` queue consumer path. External workflow evidence is required to prove those entrypoints.
  - Synthetic row limitation: canonical page payloads injected only through `registerSyntheticLiveTestManifestPageAdapter` (labeled in evidence); production worker lease/checkpoint/verify/promotion path otherwise executes
  - Picker server contract suite (`livePickerContractRunner.ts`) on every trusted live workflow run; interactive Picker remains protected browser E2E
  - Failed replacement proof: second staging run forces verification failure; Google read-back asserts prior published immutable ID/title/content unchanged
  - Transient failure injection inside worker `writeBoundedReportingBatch` checkpoint path (`liveTestWorkerHooks.ts`); resume same durable run without duplicate publish
  - Container-only cleanup: trashes only positively marked `harness_container` folders (direct children of dedicated export root); nested workbooks/tabs are removed by parent folder trash
  - Failed harness cleanup sets registry status `needs_janitor` (janitor-eligible); `completed` only after confirmed Drive trash refetch
  - Cleanup before final evidence via hardened gates (`liveTestSecurity.ts`, `liveTestCleanup.ts`, persisted harness-run registry binding exact container folder IDs); harness fails if cleanup fails; `GOOGLE_DRIVE_EXPORT_FOLDER_ID` snapshotted at harness entry and restored in `finally` on every outcome
  - Denylist rejection crosses production `createReportingDestination` + `assertWorkbookNotDenylisted` with Picker-verified denylist workbook and its actual authorized parent folder (`liveTestDenylistProof.ts`); proof requires exact `OPERATIONAL_WORKBOOK` rejection (`DENYLIST_INCOMPLETE` remains fail-closed, not success); no unmarked proof folders created
  - Explicit OAuth-only adapters (`liveTestOAuthAdapters.ts`): injectable factory requires verified `OAuth2Client`; rejects all service-account env vars, local SA files, and `GOOGLE_APPLICATION_CREDENTIALS`; no `google.auth.getClient` monkeypatch
  - Recursive PII-safe evidence sanitizer with embedded Drive ID/URL/token redaction (`piiSafeEvidence.ts`)
  - Failed manual runs emit `delivery_failed` audit with `notificationCandidate: true`; routine success does not
- **Test-artifact janitor** (`src/services/reporting/live/testArtifactJanitor.ts`, cron + script)
  - Returns HTTP 200 no-op unless `REPORTING_LIVE_TEST_ENABLED=true`
  - Direct-child-of-export-root invariant; only `harness_container` folder MIME type; configured run-tag prefix enforced
  - Trashes only containers authorized by persisted harness-run registry (`liveTestHarnessRunRegistry.ts`) with pending/needs_janitor cleanup, exact `container_folder_ids` binding, plus marker/root/age/refetch gates; copied-marker siblings not registered for the run are rejected; completion refetches every registered container and marks `completed` only when all are trashed or Drive-confirmed not-found
  - Rejects service-account/ADC indicators; asserts OAuth principal before Drive calls; structured cleanup errors with masked IDs
- **Focused tests**: harness safety, janitor selection, PII-safe evidence, observability keys
- **GitHub workflows**
  - `.github/workflows/reporting-ci.yml` — typecheck + full unit suite + live safety tests
  - `.github/workflows/reporting-live-google.yml` — protected `reporting-live-google` environment, dedicated secrets only, SA rejection gate

### WP4.9 — Operations observability and rollout handoff

- **Reporting observability** (`src/services/reporting/reportingObservability.ts`) reusing existing `recordOperationalEvent` — no competing framework
  - OAuth/destination health, stuck phases, retry exhaustion, verification mismatch, promotion ambiguity, cleanup backlog, denylist unavailable, capacity divergence
  - **No routine success notification** (delivery success remains audit/info only via `recordReportingAudit`)
- **Cron coverage** (`src/routes/reporting-cron.routes.ts`, `vercel.json`)
  - `reporting-delivery-heartbeat` (existing)
  - `reporting-health-scan` — stuck runs, cleanup backlog, denylist completeness
  - `reporting-cleanup-janitor` — production incomplete-artifact janitor
  - `reporting-test-artifact-janitor` — live-test disposable root janitor
- **Worker wiring** — failure-path observability emission in `reportingWorker.ts`

## Configuration (live test identity)

| Variable | Class | Purpose |
|----------|-------|---------|
| `GOOGLE_OAUTH_CLIENT_ID` | trusted secret | Dedicated **test** OAuth client |
| `GOOGLE_OAUTH_CLIENT_SECRET` | trusted secret | Test client secret |
| `GOOGLE_OAUTH_TOKEN_ENCRYPTION_KEY` | trusted secret | Encrypt test refresh token in Mongo |
| `GOOGLE_OAUTH_TRUSTED_ADMIN_ORIGIN` | trusted secret | Admin origin for OAuth completion |
| `GOOGLE_OAUTH_OWNER_EMAIL` | trusted secret | Dedicated test Google user |
| `GOOGLE_OAUTH_REDIRECT_URI` | trusted secret | Test OAuth redirect |
| `MONGO_URI` | trusted secret | Isolated/test Mongo for OAuth connection doc |
| `REPORTING_LIVE_TEST_EXPORT_ROOT_FOLDER_ID` | trusted secret | Disposable Drive export root |
| `REPORTING_LIVE_TEST_DENYLIST_WORKBOOK_ID` | trusted secret (required when enabled) | Known denylisted workbook for live rejection proof |
| `REPORTING_LIVE_TEST_RUN_TAG_PREFIX` | config (required when enabled) | Harness/janitor run-tag prefix |
| `REPORTING_PRODUCTION_GOOGLE_OAUTH_CLIENT_ID` | config (required when enabled) | Must differ from test client ID |
| `REPORTING_PRODUCTION_GOOGLE_OAUTH_OWNER_EMAIL` | config (required when enabled) | Must differ from test owner email |
| `REPORTING_LIVE_TEST_ARTIFACT_MAX_AGE_MS` | config | Janitor minimum age (default 1h) |
| `REPORTING_LIVE_TEST_INJECT_TRANSIENT_FAILURES` | config | 0–3 injected 503s for retry proof |
| `GOOGLE_PICKER_API_KEY` / `GOOGLE_PICKER_APP_ID` | browser-safe | Picker bootstrap (production owner UI) |

**Never configure** production owner OAuth or service-account JSON in CI. GitHub environment `reporting-live-google` must use `REPORTING_LIVE_TEST_*` secret names only.

Production Vercel configuration is documented in
[`stage-4-vercel-environment-checklist.md`](./stage-4-vercel-environment-checklist.md).
`REPORTING_GOOGLE_DELIVERY_ENABLED` is implemented as a fail-closed deployment
gate: keep it `false` through dry deployment and set it `true` only for an
approved canary or owner rollout.

## Package scripts

```bash
pnpm typecheck
pnpm test                              # full suite
pnpm test:reporting-live-safety        # harness/janitor/observability focused
pnpm reporting:live-google-harness     # protected live run (requires .env)
pnpm reporting:test-artifact-janitor   # manual janitor (--dry-run supported)
```

## Interactive Picker gate

Full interactive Picker selection cannot run safely on every CI commit. The trusted live workflow runs **Picker bootstrap/nonce/reference/selection server contract tests** (`livePickerContractRunner.ts`) on every dispatch. **Protected browser E2E** (owner admin + interactive Picker + destination save) remains a manual/pre-release gate.

## Rollout checklist (operations)

### Phase 0 — Configuration and dry deployment

- [ ] Deploy models, routes, worker, crons without owner delivery enabled
- [ ] Enable Drive, Sheets, Picker APIs; verify redirect URIs and trusted admin origin
- [ ] Classify secrets (server vs browser-safe)
- [ ] Verify Stage 1 unified operational workbook registry complete in production
- [ ] Confirm migrations/indexes and reporting cron auth (`CRON_SECRET`)

### Phase 1 — Dedicated test identity

- [ ] Create GitHub environment `reporting-live-google` with dedicated secrets
- [ ] Pre-seed dedicated test user's OAuth refresh token in test Mongo (one-time owner OAuth connect against test client)
- [ ] Run `pnpm reporting:live-google-harness` locally or dispatch `Reporting Live Google` workflow
- [ ] Confirm masked evidence: workflow URL/run ID, commit SHA, OAuth path, checksum, cleanup outcome
- [ ] Run test-artifact janitor dry-run then scheduled run; confirm zero non-test artifacts touched

### Phase 2 — Production owner connection, no general delivery

- [ ] Owner connects production Google account (separate OAuth client/secrets from CI)
- [ ] Verify least-privilege scopes and health endpoints
- [ ] Create dedicated Vantage folder/destination; confirm operational workbooks denied
- [ ] Stage 3 preview only against production canonical Mongo

### Phase 3 — Canary deliveries

- [ ] Enable delivery for owner-controlled canary window
- [ ] One verified snapshot + one verified replace-tab replacement
- [ ] Rehearse worker interruption, transient retry, failed verification, cleanup
- [ ] Review audits, alerts, checksums, quota

### Phase 4 — Owner availability

- [ ] Enable manual reporting path for owner
- [ ] Monitor initial runs and cleanup backlog via observability dashboards
- [ ] Obtain owner and operations signoff (see evidence checklist)

## Rollback checklist

- [ ] Set `REPORTING_GOOGLE_DELIVERY_ENABLED=false` if optional gate adopted
- [ ] Roll back deployment; cancel queued/not-yet-writing runs
- [ ] Do not interrupt in-flight promotion blindly — inspect checkpoint
- [ ] Preserve last known-good managed tab; quarantine ambiguous artifacts
- [ ] Retry incomplete-artifact cleanup after provider health returns
- [ ] Revoke OAuth only for credential compromise or owner direction
- [ ] **Never** switch reporting to operational service account

## Evidence checklist

### Implementation / local CI (available now)

- [x] Local unit/integration safety tests: harness prerequisites, service-account rejection, PII redaction, janitor selection, security gates, worker transient hooks, observability keys (`pnpm test:reporting-live-safety`)
- [x] Typecheck (`pnpm typecheck`)
- [x] Full unit suite (`pnpm test`) — includes delivery regressions 1–19 logic in `reportingDelivery.test.ts` / related suites (local fake Google/Mongo, not live owner OAuth)

### Externally pending (unchecked until executed)

- [ ] GitHub `reporting-live-google` environment secrets provisioned
- [ ] First successful **Reporting Live Google** workflow run with masked live evidence
- [ ] Dedicated test OAuth user refresh token seeded in test Mongo
- [ ] Acceptance tests **10–19 live Google evidence** (not just local unit proofs)
- [ ] Production Cloud API / OAuth consent / redirect verification
- [ ] Canary snapshot and replace-tab run IDs, checksums, artifact links in production
- [ ] **Protected Picker browser E2E** recording
- [ ] Owner acceptance signoff
- [ ] Operations acceptance signoff (alerts, denylist health, promotion recovery, rollback rehearsal)

## Runbook pointers

| Symptom | Event key | Action |
|---------|-----------|--------|
| OAuth refresh/revocation | `reporting.oauth.health_failed` | Owner reconnect; check encryption key and scopes |
| Destination access loss | `reporting.destination.health_failed` | Re-verify folder/workbook; check `drive.file` access |
| Run stuck in phase | `reporting.run.stuck_phase` | Inspect lease; heartbeat cron; safe cancel if pre-write |
| Retry exhaustion | `reporting.run.retry_exhausted` | Check Google quota/status; resume from checkpoint |
| Checksum/verify mismatch | `reporting.delivery.verification_mismatch` | Do not promote; inspect staging tab |
| Ambiguous promotion | `reporting.delivery.promotion_ambiguous` | Preserve old tab; manual recovery per Stage 4 §16 |
| Cleanup backlog | `reporting.cleanup.backlog` | Run cleanup janitor cron; verify provider health |
| Denylist incomplete | `reporting.denylist.unavailable` | Fix operational workbook env registrations |
| Live-test artifact drift | `reporting.live_test.janitor_completed` | Review janitor evidence; adjust export root/tag prefix |

Routine delivery success is visible in run history and `reporting.delivery_complete` audits only — **no owner email on success**.

## Known limitations

- Manual-only v1 reporting; no scheduling
- Production-only canonical Mongo reads
- No historical merge or ingestion activation bundled into rollout
- Live CI uses dedicated test identity — not production owner credentials
- Synthetic manifest/page rows in live harness do not read canonical Mongo page payloads (see harness evidence `limitation`)
- Harness invokes worker in-process only — HTTP routes, cron, and queue consumer paths require separate external evidence
- Picker full UI automation deferred to protected browser E2E gate

## Related files

```text
src/config/domain/reportingLiveTest.ts
src/services/reporting/live/
src/services/reporting/reportingObservability.ts
src/routes/reporting-cron.routes.ts
scripts/reporting/
.github/workflows/reporting-ci.yml
.github/workflows/reporting-live-google.yml
docs/current_plans/best-relocation-stage-4-google-delivery-and-rollout.md
```
