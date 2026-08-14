# Unit 02 completion — channel-neutral receipt model, evidence immutability, and receipt migration

## Status and scope

- **Status:** complete
- **Repository / branch:** `vantage-main-server` / `granot-lead-lifecycle`
- **Authoritative contract:** final specification Sections 1–2, 4–7, 9.1, 9.4, 34.1, 34.5, 34.7, 35–36, 37.1–37.2, and 38/S02 first half
- **Acceptance ownership:** AC-02 identity foundation (model / index / hash only); AC-35 for receipt/migration projections and logs
- **Applicable invariants preserved:** 1, 2, 3, 5, 8, and 9
- **Runtime posture:** persistence model, write-once evidence, named indexes, hash/redaction helper, and dry-run migration tooling only. Processing remains off. No Observation, Decision, Lead, Booking, or Cancellation mutation.

## Files added or changed

### Application model and shared schemas

- `src/models/GranotObservationReceipt.ts` — channel-neutral receipt model on collection `granot_webhook_receipts`; Mongoose registration name remains `GranotWebhookReceipt`; deprecated `getGranotWebhookReceiptModel` alias.
- `src/models/granotLifecycleSchemas.ts` — shared `processing` / `last_error` sub-schemas and channel/operation-ID validators.
- `src/models/GranotWebhookReceipt.ts` — removed after the rename; callers now import the alias from `GranotObservationReceipt`.

### Hash, redaction, and compatibility policy

- `src/services/granotLifecycle/receiptEvidence.ts` — `canonicalJson` + SHA-256 lowercase hex; credential-key removal with count-only reporting.
- `src/services/granotLifecycle/receiptCompatibility.ts` — 34.1 field mapping and `received → pending` translation used by both the model insert path and receipt migration.
- `src/services/granotLifecycle/receiptEvidence.test.ts` — `[AC-02]` `[AC-35]` hash, count-only redaction, and translation tests.

### Capture compatibility

- `src/services/granotWebhooks/granotWebhookCapture.service.ts` — import path only. Field writes, `sanitizeHeaders`, and envelopes are unchanged.
- `scripts/dump-operations-name-link-inventory.ts` — import path only.

### Receipt and index migrations

- `scripts/migrations/granot-lifecycle-migration.lib.ts` — `--report` / `--apply` / `--verify` mode parsing, historical/unknown DB refusal, `--confirm-production=<db>`, masked IDs, gitignored manifests.
- `scripts/migrations/granot-lifecycle-receipts.ts` + `.lib.ts` + `.test.ts`
- `scripts/migrations/granot-lifecycle-indexes.ts` + `.lib.ts` + `.test.ts`

### Wiring and docs

- `package.json` — `migration:granot-lifecycle:receipts` and `migration:granot-lifecycle:indexes`
- `.cursor/rules/project-organization.mdc` — `GranotObservationReceipt` lives under `src/models/`; collection `granot_webhook_receipts` is retained
- `src/models/GranotObservationReceipt.test.ts` — `[AC-02]` validators, write-once evidence, index definitions, alias/collection

## Collection, alias, and indexes

- Collection name is unchanged: `granot_webhook_receipts`.
- `getGranotWebhookReceiptModel()` still serves current capture `create(...)`.
- Mongoose model string remains `GranotWebhookReceipt`.

Declared Section 9.1 index names (single source: `GRANOT_OBSERVATION_RECEIPT_INDEXES`):

| Name | Definition |
| --- | --- |
| `granot_observation_receipt_channel_operation_id_unique` | unique partial `{ observation_channel: 1, channel_operation_id: 1 }` where `channel_operation_id` is a string |
| `granot_observation_receipt_processing_due` | `{ "processing.state": 1, "processing.next_attempt_at": 1, captured_at: 1 }` |
| `granot_observation_receipt_leased_until` | `{ "processing.leased_until": 1 }` |
| `granot_observation_receipt_route_event_captured` | `{ route_event_class: 1, captured_at: -1 }` |
| `granot_observation_receipt_payload_sha256_diag` | `{ payload_sha256: 1, captured_at: -1 }`, never unique |

Legacy indexes `{ event_type: 1, received_at: -1 }` and `{ processing_status: 1, received_at: 1 }` remain declared. Index `--verify` checks both the named contract and those legacy keys.

## Processing-status translation

Authorized table (final spec publishes no mapping; UNIT-02 §6.8 is the fail-closed default):

| Legacy `processing_status` | Translation |
| --- | --- |
| `received` | `processing.state = "pending"` |
| `processed`, `ignored`, `failed`, missing, or any other value | refuse apply; report counts and masked IDs; stop |

Refused-status counts in tests: explicit `processed` / `ignored` / `failed` / `invented` / missing status all refuse. No refused status was written by apply in tests.

Required defaults when translating `received`: `technical_attempts` from nonnegative `processing_attempts` else `0`; `match_attempt = 0`; `manual_requeue_count = 0`; `next_attempt_at = captured_at`. Lease/error/completion fields are not set.

Already-present v2 evidence is a no-op, including rows whose `authentication_method` is a later proven value such as `body_secret`.

## Hash helper

- Location: `src/services/granotLifecycle/receiptEvidence.ts`
- Migrations call `fillLegacyWebhookReceiptV2Fields` → `hashCredentialRedactedPayload` / `redactCredentialKeys`. They do not reimplement hash or redaction policy.
- Credential keys removed (case / underscore / hyphen variants): `x-api-secret`, `authorization`, `cookie`, `set-cookie`. Counts only; values never appear in helper output or public manifests.

## Flags, effects, and out-of-scope confirmation

- Flags before/after: none / none. `src/config/domain/granotLifecycle.ts` was not created.
- Processing remained off. No later effect flag was enabled.
- No Observation model, capture-auth rewrite, queue publish, production `--apply`, flags module, DurableActor origin expansion, or `src/services/granotLifecycle/capture.ts`.
- No customer or current Granot payload was used. Tests used redacted synthetic receipts only.
- Live webhook `202` / unauthorized-no-row proof remains Unit 03.

## Verification

- Focused command:
  - `node --import tsx --import ./scripts/test-setup.ts --test "src/models/GranotObservationReceipt.test.ts" "src/services/granotLifecycle/*.test.ts" "src/services/granotWebhooks/granotWebhookCapture.service.test.ts" "scripts/migrations/granot-lifecycle-receipts.test.ts" "scripts/migrations/granot-lifecycle-indexes.test.ts"`
  - **43 passed, 0 failed**.
- Full repository command:
  - `pnpm test`
  - **953 passed, 0 failed**.
- TypeScript:
  - `pnpm typecheck`
  - **passed**.
- `git diff --check`: **passed** (line-ending conversion warnings only).

Verification was local and used only synthetic receipts plus in-memory rejection cases. No live Granot webhook, production `--apply`, database mutation against a non-test target, or current customer payload inspection occurred.

## Persistence, migrations, and concurrency

- Models/schemas/indexes: `GranotObservationReceipt` plus five named Section 9.1 indexes and two retained legacy indexes. Index **definitions** are proven at model level. Runtime Mongo duplicate-key rejection for the operation-ID index is not claimed.
- Migration scripts exist and default to `--report`. Production apply is not authorized by this unit. Local tests exercise plan/verify/apply-guard functions only.
- Starting/ending lifecycle flags: none.
- Transaction, lease, command idempotency, replay, aggregate no-op, and outbox claims: not applicable. Receipt apply idempotency is proven on the translation planner (second apply is a no-op for evidence).

## Known risks and deferred compatibility

- Live rows inserted through the deprecated alias may carry `authentication_method: "legacy_unknown"` until Unit 03 writes a proven `body_secret` / `header_secret`. That is the specified Unit 02→03 window, not a claim that Section 9.2 auth is implemented.
- Write-once evidence is enforced on mongoose `save` and allowlisted query updates. Authorized receipt `--apply` uses the native collection to backfill absent v2 fields only; it does not rewrite present v2 evidence.
- Public manifests record masked IDs only (AC-35). A separately authorized 34.7 rollback script is still required to unset additive fields.
- `channel_operation_id` collision reports include the operation ID value because 34.5 requires a duplicate-key report; they do not include payload, headers, or contact values.
- Compatibility legacy fields remain for one release. Cleanup is a later issue.
- Unit 03 still owns live webhook authentication, header allowlist, capture-before-202, `401` / `503` envelopes, and queue publish `{ receipt_id }`.

## Handoff

Successful Unit 02 verification unblocks **contract refinement** for Unit 03, which is the next implementation target once its scaffold is refined against this repository state. Units 05 and 09 remain refinement-only and are not implementation-authorized by this handoff.

## Final `git status --short`

```text
 M .cursor/rules/project-organization.mdc
 M package.json
 M scripts/dump-operations-name-link-inventory.ts
 M scripts/prototypes/granot-lead-lifecycle/delivery/UNIT-STATUS.md
 D src/models/GranotWebhookReceipt.ts
 M src/services/granotWebhooks/granotWebhookCapture.service.ts
?? scripts/migrations/granot-lifecycle-indexes.lib.ts
?? scripts/migrations/granot-lifecycle-indexes.test.ts
?? scripts/migrations/granot-lifecycle-indexes.ts
?? scripts/migrations/granot-lifecycle-migration.lib.ts
?? scripts/migrations/granot-lifecycle-receipts.lib.ts
?? scripts/migrations/granot-lifecycle-receipts.test.ts
?? scripts/migrations/granot-lifecycle-receipts.ts
?? scripts/prototypes/granot-lead-lifecycle/delivery/completion-reports/UNIT-02-COMPLETION.md
?? src/models/GranotObservationReceipt.test.ts
?? src/models/GranotObservationReceipt.ts
?? src/models/granotLifecycleSchemas.ts
?? src/services/granotLifecycle/receiptCompatibility.ts
?? src/services/granotLifecycle/receiptEvidence.test.ts
?? src/services/granotLifecycle/receiptEvidence.ts
```

The delivery status ledger update is included with this handoff. No commit, push, deploy, production mutation, live payload exposure, external call, or external send occurred.
