# Unit 16 completion — Browser extension receipt apply and version 0.2.8

## Status and scope

- **Status:** complete
- **Repositories / branches:** `vantage-main-server` / `granot-lead-lifecycle`; `granot_sync_extensions_and_services` / `main`
- **Authoritative contract:** final specification Sections 1–2, 4–7, 9.1/9.4, 10–11, 25–28.1, 30, 35–37, 38/S10, and 39–41
- **Acceptance ownership:** extension portion/completion of AC-02, extension half of AC-33, complete AC-34, extension route/projection privacy under AC-35
- **Applicable invariants preserved:** 1 (Mongo is System of Record), 2–3 (Granot evidence is not official Booking/Cancellation authority and creates no lifecycle enum), 5–7 (no canonical aggregate mutation, no Change/Sheet work in this shadow unit), 8 (Owner initiator, processor system actor, `browser_extension` channel, independent Ingestion Origin/source), 9–11 (full raw statement; no client patch overwrite of snapshots/source/CPL or Bad/Duplicate bypass)
- **Runtime posture (start and end):** `PROCESSING=true`, `SHADOW=true`, all eight effect flags false. Extension apply is live evidence intake; processor behavior remains historical/live shadow.

## Files added or changed

### Server capture / route / idempotency

- `src/services/granotLifecycle/capture.ts` — channel-neutral `buildGranotChannelReceiptInsert` / `captureChannelOperationReceipt`
- `src/services/granotLifecycle/extensionApply.ts` — Owner apply → capture → `claimAndProcessOrPoll` → safe result
- `src/services/granotLifecycle/errors.ts` — `GRANOT_OPERATION_IDEMPOTENCY_CONFLICT`, `GRANOT_CAPTURE_UNAVAILABLE`
- `src/services/granotLifecycle/normalization.ts` — apply-item unwrap; exported booking-action helpers
- `src/services/granotLifecycle/drainer.ts` — claim snapshot includes `initiator`
- `src/services/durableWork/actors.ts` — `createBrowserExtensionOwnerInitiator`
- `src/validation/v1/granotLifecycle.validation.ts` — strict apply item/batch Zod
- `src/routes/extension-granot-apply.routes.ts` — Owner-only existing URLs
- `src/routes/v1.routes.ts` — mounts the apply router; legacy patch handlers are not reachable on those URLs

### Server tests

- `src/models/GranotObservationReceipt.test.ts` (existing AC-02 model)
- `src/services/granotLifecycle/capture.test.ts`
- `src/services/granotLifecycle/extensionApply.test.ts`
- `src/services/granotLifecycle/extensionApply.replica.test.ts`
- `src/routes/extension-granot-apply.test.ts`
- `src/services/granotLifecycle/crossChannel.test.ts`
- `src/validation/v1/granotLifecycle.validation.test.ts`
- `src/routes/v1.routes.test.ts` — nested-router discovery of `PATCH .../granot-sync`
- `scripts/test-granot-lifecycle-replica.ts` — `--unit=16`

### Extension statement / ledger / adapters / version

- `src/lifecycle/*` — types, UUID v4, fingerprint, statement, pending ledger, messages, shared apply adapter
- `src/api/formLeads.ts` — `applyGranotFormLead`
- `src/api/callLeads.ts` — `applyCallLeadEnrichment` / `applyBookedCallLeadReconciliation`
- `src/workflows/form-leads/sync.ts` — receipt apply; no Quoted/receiver/location patch
- `src/workflows/form-leads/types.ts`, `src/parsers/granot/form-leads.ts` — separate `userRaw` / `repRaw`
- `src/workflows/call-leads/apply.ts`, `preview.ts`, `types.ts` — raw source row + batch apply
- Popup/background callers: form-leads actions, call-leads actions/render, events, popup auto-sync, `src/auto-sync/background-runner.ts`
- `src/entrypoints/popup/workspaces/form-edit-lead/actions.ts` — remains ordinary `PATCH /form-leads/:id` (not a Granot final-apply URL)
- `package.json` — `0.2.7` → `0.2.8`

### Extension tests / docs

- `src/test/lifecycle-apply.test.ts`, `lifecycle-ledger.test.ts`, `lifecycle-statement.test.ts`, `lifecycle-version.test.ts`
- `src/test/form-leads-sync.test.ts`, `src/test/parsers.test.ts`
- `.cursor/rules/granot-form-leads-workflow.mdc`, `granot-call-leads-workflow.mdc`, `granot-auto-sync-background.mdc`, `granot-extension-architecture.mdc`

### Server docs / ledger

- `.cursor/businesslogic/granotLifecycle.capture.md`
- `.cursor/businesslogic/granotLifecycle.extensionApply.md`
- `.cursor/businesslogic/enrichment.service.md`
- `.cursor/businesslogic/bookedCallLeadReconciliation.service.md`
- `.cursor/index.md`
- `.cursor/rules/granot-lifecycle-capture.mdc`
- `.cursor/rules/project-organization.mdc`
- `.cursor/rules/business-logic.mdc`
- `scripts/prototypes/granot-lead-lifecycle/delivery/UNIT-STATUS.md`

## Exact contracts landed

### Request / response envelopes

```ts
type ExtensionGranotApplyItem = {
  operation_id: string; // lowercase UUID v4
  operation_kind: "lead_snapshot_apply" | "booking_action_apply";
  granot_statement: Record<string, string | number | null>;
  expected_target?: { model: "FormLead" | "CallLead"; id: string };
};

type ExtensionGranotApplyResult = {
  operation_id: string;
  receipt_id: string;
  processing_state: "completed" | "accepted_for_processing";
  observation_id?: string;
  decision_id?: string;
  outcome?: SynchronizationOutcome;
  target?: EntityRef;
  changed_paths: string[];
  message: string;
};
```

- Form PATCH: one item; `expected_target` if present must match `{ model: "FormLead", id: req.params.id }`.
- Call POSTs: `{ items }`, input order, batch max 100, reject duplicate IDs.
- Envelope `{ ok: true, data }`. Preview URLs unchanged.

### Auth / initiator / hash / replay

| Case | Result |
| --- | --- |
| Owner session | durable initiator `origin:"browser_extension"`, `authentication_method:"extension_session"` |
| Admin / secret / employee / unauthenticated | no receipt |
| First ID + hash | one inserted receipt |
| Same channel/ID + same hash | replay stored receipt/result |
| Same channel/ID + different hash | `409 GRANOT_OPERATION_IDEMPOTENCY_CONFLICT`, no new receipt |
| Unique-index race | reload winner + same hash check; one processor claim |

Hash covers the full apply item (kind, statement, `expected_target`). `expected_target` disagreement maps the response `outcome` to `conflict` without rewriting the stored Decision.

### Pending ledger

`PendingGranotOperation = { operation_id, row_fingerprint, operation_kind, created_at, attempt_count }`. Key: `granot-sync:pending-granot-operations-v1` via WXT `browser.storage.local` (Chrome `chrome.storage.local` adapter). Persist before `vantageFetch`. Fingerprint is a SHA-256 of sanitized identity + canonical statement; raw customer/Job/source text is not stored. Prune 500 / 7 days, oldest-first. Diagnostic count only. Auto-sync history/settings/lock remain separate.

### Legacy path reachability

`PATCH /form-leads/:id/granot-sync` and the two Call sync URLs no longer import or call `updateFormLead` / `syncCallLeadEnrichment` / `syncBookedCallLeadReconciliation`. Those services remain for CSV/HTTP automation until Unit 17 / Unit 33 cleanup. Form Edit Lead still uses ordinary `PATCH /form-leads/:id`.

### Version evidence

`package.json` is `0.2.8`. Generated Chrome MV3 and Firefox MV2 manifests report `"version": "0.2.8"`. `.output` is not committed as authority.

## Flags

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

No later effect was enabled.

## Migration / indexes

**No new index.** Reverified existing receipt operation-ID unique index.

- `pnpm migration:granot-lifecycle:indexes -- --report` — pass (exit 0). Connected without `TEST_MODE` to the development database; with `TEST_MODE=true` to `testvantagemovers`.
- `TEST_MODE=true` verify: receipt indexes **ok**, including `granot_observation_receipt_channel_operation_id_unique` (`missing: []`). Full-script verify **exit 1** because predecessor CRM-source / Decision / activation / Record Link / EntityChange / Lead S08 indexes remain unapplied on the disposable test database. Same class of gap Units 11–13 recorded. Production apply was **not** run.
- Replica `Model.syncIndexes()` plus concurrent capture proves one-receipt / 409 uniqueness on `testvantagemovers`.
- One leftover Record Link job collision (`U14 LINK MSXXM4CN`, two masked IDs) is predecessor test residue, not a Unit 16 create.

## Verification

### Focused server

```text
node --import tsx --import ./scripts/test-setup.ts --test \
  src/models/GranotObservationReceipt.test.ts \
  src/services/granotLifecycle/extensionApply.test.ts \
  src/routes/extension-granot-apply.test.ts \
  src/services/granotLifecycle/crossChannel.test.ts
```

**27 pass / 0 fail.**

Also: capture + validation + v1 route discovery tests pass in the full suite.

### Replica

```text
TEST_MODE=true SHEET_SYNC_MODE=disabled pnpm test:granot-lifecycle:replica -- --unit=16
```

**2 pass / 0 fail** on disposable replica `testvantagemovers`. Same operation ID + same hash → one receipt (1 inserted / 2 replayed). Same ID + different hash → one winner and `OperationIdempotencyConflictError`. Cleanup uses native `collection.deleteMany` so immutability hooks are not violated.

### Full server

```text
pnpm test
pnpm typecheck
```

- `pnpm test`: **1246 pass / 0 fail / 30 skipped**
- `pnpm typecheck`: pass

### Extension

```text
pnpm test
pnpm compile
pnpm build
pnpm build:firefox
```

- `pnpm test`: **146 pass / 0 fail** (18 files)
- `pnpm compile`: pass
- Chrome/Firefox builds: pass; both generated manifests `0.2.8`

### Cross-channel masked comparison

`crossChannel.test.ts` normalizes equivalent redacted webhook vs extension statements to the same identity/Priority and the same shadow processor outcome with zero `changed_paths`. No live/customer payload was inspected.

### `git diff --check`

Pass in both repositories after stripping two accidental EOF blank lines.

## AC-to-proof coverage

| AC | Proof |
| --- | --- |
| AC-02 extension | model unique index; capture replay/409; replica concurrent same-hash / different-hash |
| AC-33 extension | route Owner capture; no legacy service import; cross-channel same identity/desired-state/zero effects |
| AC-34 | ledger UUID retain across retry/auth refresh/restart/pending refresh; new ID after terminal; per-batch IDs; package + generated manifests `0.2.8` |
| AC-35 extension | Owner-only; safe messages; pending records reject customer/statement fields; validation errors omit raw values |
| Raw Priority / user / rep | statement + form/call apply tests; no `quoted` on apply items |
| Preview boundary | preview URLs/services unchanged; Form Edit Lead stays ordinary PATCH |

## Known risks / deferred work

- Full index `--verify` still fails on unapplied predecessor indexes. Do not treat that as a Unit 16 missing unique-ID index; do not apply production indexes from this unit.
- HTTP automation still mutates directly (Unit 17).
- Shadow remains on; Unit 18 still needs Unit 17 plus accepted webhook/extension/automation parity before matched-Lead writes.
- Form Edit Lead quoted override remains a regular Form Lead PATCH, not receipt apply.
- WXT uses `browser.storage.local` as the Chrome `chrome.storage.local` adapter; document that alias when reading the final spec literally.
- Staging/live synthetic webhook-vs-extension comparison was not run; required proof here is the redacted cross-channel module test plus generated manifest versions.

## Newly unblocked

- Unit 17 remains independently implementable (already ready).
- Unit 18 is **not** unblocked. It still waits for Unit 17 and designated parity approval.

## Final `git status --short`

### `vantage-main-server` / `granot-lead-lifecycle`

```text
 M .cursor/businesslogic/bookedCallLeadReconciliation.service.md
 M .cursor/businesslogic/enrichment.service.md
 M .cursor/businesslogic/granotLifecycle.capture.md
 M .cursor/index.md
 M .cursor/rules/business-logic.mdc
 M .cursor/rules/granot-lifecycle-capture.mdc
 M .cursor/rules/project-organization.mdc
 M scripts/prototypes/granot-lead-lifecycle/delivery/UNIT-STATUS.md
 M scripts/test-granot-lifecycle-replica.ts
 M src/routes/v1.routes.test.ts
 M src/routes/v1.routes.ts
 M src/services/durableWork/actors.ts
 M src/services/granotLifecycle/capture.test.ts
 M src/services/granotLifecycle/capture.ts
 M src/services/granotLifecycle/drainer.ts
 M src/services/granotLifecycle/errors.ts
 M src/services/granotLifecycle/normalization.ts
 M src/validation/v1/granotLifecycle.validation.test.ts
 M src/validation/v1/granotLifecycle.validation.ts
?? .cursor/businesslogic/granotLifecycle.extensionApply.md
?? scripts/prototypes/granot-lead-lifecycle/delivery/completion-reports/UNIT-16-COMPLETION.md
?? src/routes/extension-granot-apply.routes.ts
?? src/routes/extension-granot-apply.test.ts
?? src/services/granotLifecycle/crossChannel.test.ts
?? src/services/granotLifecycle/extensionApply.replica.test.ts
?? src/services/granotLifecycle/extensionApply.test.ts
?? src/services/granotLifecycle/extensionApply.ts
```

### `granot_sync_extensions_and_services` / `main`

```text
 M .cursor/rules/granot-auto-sync-background.mdc
 M .cursor/rules/granot-call-leads-workflow.mdc
 M .cursor/rules/granot-extension-architecture.mdc
 M .cursor/rules/granot-form-leads-workflow.mdc
 M package.json
 M src/api/callLeads.ts
 M src/api/formLeads.ts
 M src/auto-sync/background-runner.ts
 M src/entrypoints/popup/app/auto-sync.ts
 M src/entrypoints/popup/app/events.ts
 M src/entrypoints/popup/workspaces/call-leads/actions.ts
 M src/entrypoints/popup/workspaces/call-leads/render.ts
 M src/entrypoints/popup/workspaces/form-edit-lead/actions.ts
 M src/entrypoints/popup/workspaces/form-leads/actions.ts
 M src/parsers/granot/form-leads.ts
 M src/test/form-leads-sync.test.ts
 M src/test/parsers.test.ts
 M src/workflows/call-leads/preview.ts
 M src/workflows/call-leads/types.ts
 M src/workflows/form-leads/sync.ts
 M src/workflows/form-leads/types.ts
?? src/lifecycle/
?? src/test/lifecycle-apply.test.ts
?? src/test/lifecycle-ledger.test.ts
?? src/test/lifecycle-statement.test.ts
?? src/test/lifecycle-version.test.ts
?? src/workflows/call-leads/apply.ts
```

## External-action statement

No commit, push, deploy, production mutation, production index apply, live-payload access, or external send occurred.
