# Unit 02 — Channel-neutral receipt model, evidence immutability, and receipt migration

> **Contract maturity: implementation-ready.** This is the first persistence increment. It evolves the existing webhook receipt envelope in place. It does not implement webhook authentication, capture response, queue publish, Observation persistence, normalization runtime, processing, or any domain effect.

## 1. Authority and required reading

- **Final specification:** Sections 1–2, 4–7, 9.1, 9.4, 34.1, 34.5, 34.7, 35–36, 37.1–37.2, and 38/S02 (first-half ownership only).
- **Original slice:** first half of S02 — Secure channel-neutral receipt capture.
- **Acceptance ownership:** AC-02 identity foundation (model/index/hash only); AC-35 for receipt/migration projections and logs. The live webhook portion of AC-02, all of AC-01, and capture-route AC-35 belong to Unit 03.
- **Canonical language:** workspace-root `CONTEXT.md`. The channel-neutral envelope is a **Granot Observation Receipt**. Avoid “Granot Webhook Receipt” except as the deprecated compatibility alias.
- **Execution rules:** `scripts/prototypes/granot-lead-lifecycle/delivery/AGENT-EXECUTION-RUNBOOK.md`.
- **Predecessor evidence:** `delivery/completion-reports/UNIT-01-COMPLETION.md` plus repository state. Re-verify; do not trust the ledger alone.
- **Optional extraction protocol:** `.cursor/agents/lead-lifecycle-spec-extractor.md`.
- **Repository guidance:** `AGENTS.md`, `CLOUD_AGENTS.md`, `.cursor/rules/lead-lifecycle-delivery.mdc`, and applicable TypeScript, testing, backend-safety, project-organization, and Form Lead CRM rules.

The final specification wins on conflict. Do not use prototype Intake names, older lifecycle specs, or `GRANOT-LIFECYCLE-PRODUCTION-SPEC.md` to fill gaps. If a required business rule is missing, fail closed under Section 40; do not invent source IDs, payload meanings, occurrence times, or authority.

## 2. Objective

Leave `vantage-main-server` with one channel-neutral `GranotObservationReceipt` application model on collection `granot_webhook_receipts`, a deprecated `getGranotWebhookReceiptModel` alias that keeps current capture/tests compiling, write-once evidence plus nested `processing` work-state validation, the five Section 9.1 indexes, shared credential-redaction/hash helpers under `src/services/granotLifecycle/`, and dry-run/report/apply/verify migration tooling for receipts and indexes.

At handoff, Unit 03 must be able to capture into this model without inventing schema, hash, or index policy. Processing remains off. No Observation, Decision, Lead, Booking, or Cancellation mutation is authorized.

## 3. Repository, branch, and prerequisites

- **Repository:** `vantage-main-server` only.
- **Required branch:** `granot-lead-lifecycle` (the existing Unit 01 branch; do not create `lead-lifecycle`).
- **Prerequisites:** Unit 01 complete and re-verified in this repository.
- **Before editing:** run `git status --short`, `git branch --show-current`, and inspect `src/models/GranotWebhookReceipt.ts`, `src/services/granotWebhooks/granotWebhookCapture.service.ts`, `src/services/granotLifecycle/types.ts`, and current capture tests.
- Do not commit, push, deploy, apply a production migration, call Granot, send external messages, or inspect current customer payloads.

## 4. Current-state evidence to verify

The issue author observed the following on 2026-08-14 after Unit 01. Recheck rather than treating this as durable proof:

- `src/services/granotLifecycle/types.ts` exports exact Section 7 unions, including `ObservationChannel`, `GranotRouteEventClass`, `ChannelOperationKind`, and `ReceiptWorkState`.
- No `src/models/GranotObservationReceipt.ts`, no `src/models/granotLifecycleSchemas.ts`, no receipt/index migration scripts, and no Section 27 flag module exist.
- `src/models/GranotWebhookReceipt.ts` persists collection `granot_webhook_receipts` with legacy fields `provider`, `event_type`, `received_at`, `schema_version`, `payload_kind`, `headers`, `payload`, `processing_status` (`received` | `processed` | `ignored` | `failed`), `processing_attempts`, optional `processed_at` / `processing_error`, `timestamps: true`, and `strict: true`.
- Current indexes are unnamed `{ event_type: 1, received_at: -1 }` and `{ processing_status: 1, received_at: 1 }`.
- `captureGranotWebhookReceipt` writes only those legacy fields (`processing_status: "received"`, `processing_attempts: 0`) through `getGranotWebhookReceiptModel().create(...)`.
- `sanitizeHeaders` is a denylist (`authorization`, `cookie`, `x-api-secret`) and still stores other headers. The Section 9.2 allowlist is Unit 03.
- `canonicalJson` already exists at `src/services/durableWork/checksum.ts`.
- `DurableActor` in `src/services/durableWork/types.ts` does not yet include `granot_lifecycle`, `ringcentral`, or `browser_extension`. Do not expand it here.
- Existing capture tests import `getGranotWebhookReceiptModel` and must keep passing.
- Unit 01 nits that are **not** this unit: missing spaced `not provided` observation fixture; Booking Action alias fixtures tagged AC-06; historical heading in `docs/form-lead-granot-matching-alignment.md`. Do not absorb those fixes unless they block compilation.

If current code no longer matches the first six observations, report the contradiction before changing behavior. Unit 02 may add required v2 fields and compatibility defaults so the existing create path still works. It must not redesign capture auth, envelopes, or queueing.

## 5. Locked decisions and invariants at risk

### Locked decisions

- `FormLead.ref_no` is posted to Granot as `leadno`; Mongo `_id` is compatibility identity only. Do not regress the Unit 01 contract.
- A Granot Observation Receipt is transport evidence, not a Lead or Synchronization Decision.
- All valid Priority values are stored later; receipts must not encode enrichment or Quoted writes.
- `Booked` and `Release` are repeatable Booking Actions, not Vantage state transitions.
- Granot never automatically creates, updates, cancels, or un-cancels a Booking.
- Physical rename of `granot_webhook_receipts` and dual-collection cutover are forbidden.

### Applicable Section 4 invariants

- **Invariant 1:** MongoDB is the System of Record. Persist receipts in the existing collection; do not add a parallel admin model.
- **Invariant 2:** A Granot Observation is evidence, not authority for official Booking or Cancellation facts. Migration never creates effects.
- **Invariant 3:** Lead Lifecycle is composed from current facts; do not store a lifecycle-status enum on the receipt.
- **Invariant 5:** Only canonical domain commands mutate Leads, Bookings, or Cancellations. This unit has no commands.
- **Invariant 8:** Source System, Observation Channel, Ingestion Origin, actor, and initiator remain separate. Persist `source_system` and `observation_channel` separately; do not collapse them into `provider` / `event_type`.
- **Invariant 9:** Immutable creation/submission evidence is never overwritten. Evidence fields are write-once; only `processing.*` mutates after insert.

Invariants 4, 6, 7, 10–12 are inherited. This unit creates no Booking uniqueness, command transactions, identity reassignment, or reconciliation cases.

## 6. Deliverables

### 6.1 Rename the application model and keep the compatibility alias

Rename `src/models/GranotWebhookReceipt.ts` to `src/models/GranotObservationReceipt.ts`.

- Collection name remains `granot_webhook_receipts`.
- Export the application model as `GranotObservationReceipt`.
- Keep `getGranotWebhookReceiptModel()` as a deprecated alias that returns the same model. Current capture and tests must keep compiling without changing their call shape.
- Keep the Mongoose registration name `GranotWebhookReceipt` for this compatibility release so `useDb` / `mongoose.models` lookups used by the existing getter do not break. The filename and TypeScript export change; the collection does not; the Mongoose model string does not.
- Preserve every current legacy field for one compatibility release. Cleanup is a later issue, not this unit.

### 6.2 Exact Section 9.1 document plus shared processing sub-schema

Add the Section 9.1 fields. Place shared Mongoose sub-schemas in `src/models/granotLifecycleSchemas.ts` (Unit 01 deferred this file; this unit is the first persistence consumer). The `processing` / `last_error` sub-schema belongs there.

Import frozen unions from `src/services/granotLifecycle/types.ts`. Do not widen them.

Required document contract (verbatim Section 9.1, plus preserved legacy fields):

```ts
type GranotObservationReceiptDocument = {
  _id: ObjectId;
  source_system: "granot";
  observation_channel: ObservationChannel;
  captured_at: Date;
  route_event_class?: GranotRouteEventClass;
  channel_operation_kind?: ChannelOperationKind;
  authentication_method:
    | "body_secret"
    | "header_secret"
    | "extension_session"
    | "automation_owner_approval"
    | "legacy_unknown";              // backfilled historical receipts only
  evidence_version: 2;
  payload_kind: "object" | "array" | "null" | "primitive";
  payload_schema_hint?: string;
  headers: Record<string, string | string[]>;
  payload: unknown;                  // credential-redacted
  payload_sha256: string;            // lowercase 64-char hex
  channel_operation_id?: string;
  initiator?: DurableActor;
  processing: {
    state: ReceiptWorkState;
    technical_attempts: number;
    match_attempt: number;
    next_attempt_at: Date;
    lease_owner?: string;
    leased_until?: Date;
    last_started_at?: Date;
    last_error?: {
      code: string;
      message: string;               // PII-safe, max 500 chars
      failed_at: Date;
    };
    completed_at?: Date;
    latest_decision_id?: ObjectId;
    manual_requeue_count: number;
  };
  // compatibility fields retained for one release
  provider: "granot";
  event_type: GranotRouteEventClass;
  received_at: Date;
  schema_version: number;
  processing_status: "received" | "processed" | "ignored" | "failed";
  processing_attempts: number;
  processed_at?: Date;
  processing_error?: unknown;
  createdAt: Date;
  updatedAt: Date;
};
```

Rules:

- `payload_schema_hint` is optional. Do not invent a hint vocabulary and do not backfill one.
- `initiator` is optional. Do not backfill it. Do not expand `DurableActor` origins in this unit.
- `last_error.message` is PII-safe and max 500 characters.
- Do not add a stored lifecycle-status enum.

### 6.3 Channel and operation-ID validation

- `granot_webhook` requires `route_event_class` and forbids `channel_operation_kind`.
- `browser_extension` and `granot_http_automation` require both `channel_operation_kind` and `channel_operation_id`. Those channels must not pretend to be webhook route deliveries.
- `channel_operation_id`, when present, is 1–300 trimmed printable characters with no control or bidirectional characters.
- Extension values must be lowercase UUID v4.
- Automation values must exactly equal `${run_id}:${action_id}`.
- Webhook receipts typically omit `channel_operation_id` and therefore stay outside the unique partial index.

### 6.4 Write-once evidence

Evidence fields are write-once after insert. A model `save` must reject changes to evidence fields.

Evidence includes at least: `source_system`, `observation_channel`, `captured_at`, `route_event_class`, `channel_operation_kind`, `authentication_method`, `evidence_version`, `payload_kind`, `payload_schema_hint`, `headers`, `payload`, `payload_sha256`, `channel_operation_id`, `initiator`, `createdAt`, and the preserved legacy evidence fields `provider`, `event_type`, `received_at`, and `schema_version`.

Processing code may use only allowlisted `$set` / `$inc` / `$unset` operations under `processing.*`. `updatedAt` may change when processing fields change. Do not implement claim/lease/retry behavior; only reserve the mutable subdocument and reject evidence mutation.

### 6.5 Indexes

Declare these five Section 9.1 indexes on the model. Do not drop the two legacy indexes.

```ts
{ observation_channel: 1, channel_operation_id: 1 }
  unique, partialFilterExpression: { channel_operation_id: { $type: "string" } }
{ "processing.state": 1, "processing.next_attempt_at": 1, captured_at: 1 }
{ "processing.leased_until": 1 }
{ route_event_class: 1, captured_at: -1 }
{ payload_sha256: 1, captured_at: -1 } // diagnostic only, never unique
```

Index **names** are not specified in Section 9.1. Fail closed: declare explicit names on the model and verify those same names plus the field/uniqueness/partial definitions above. Do not create a second name catalog in the migration script.

Required declared names (this issue’s model contract so 34.5 verify has a single source):

| Name | Definition |
| --- | --- |
| `granot_observation_receipt_channel_operation_id_unique` | unique partial `{ observation_channel: 1, channel_operation_id: 1 }` |
| `granot_observation_receipt_processing_due` | `{ "processing.state": 1, "processing.next_attempt_at": 1, captured_at: 1 }` |
| `granot_observation_receipt_leased_until` | `{ "processing.leased_until": 1 }` |
| `granot_observation_receipt_route_event_captured` | `{ route_event_class: 1, captured_at: -1 }` |
| `granot_observation_receipt_payload_sha256_diag` | `{ payload_sha256: 1, captured_at: -1 }`, never unique |

Identical webhook payloads remain distinct receipts. Never make `payload_sha256` unique.

### 6.6 Credential-redaction and canonical hash helper

Add a focused runtime helper under `src/services/granotLifecycle/` (for example `receiptEvidence.ts`). Migration scripts must call this helper; they must not reimplement hash or redaction policy.

- Reuse `canonicalJson` from `src/services/durableWork/checksum.ts`.
- Hash the canonical credential-redacted JSON payload with SHA-256.
- Store `payload_sha256` as lowercase 64-character hex.
- Before hashing or persisting, remove persisted credential keys. Specified: `x-api-secret`. Also remove keys current capture already treats as forbidden: `authorization`, `cookie`, and `set-cookie`, including case/underscore/hyphen variants.
- Report removed-key **counts** only, never values (AC-35).
- Do **not** rewrite remaining headers to the Section 9.2 allowlist. That is Unit 03.
- Do **not** create `src/services/granotLifecycle/capture.ts`.

### 6.7 Compatibility write path for current capture

Section 9.1 requires current capture/tests not to break. Current `create()` writes only legacy fields. New required v2 fields are not written by Unit 03 yet.

Fail-closed compatibility (do not invent a second capture API):

1. Keep `getGranotWebhookReceiptModel().create(...)` working with the current field set.
2. On insert of a legacy-shaped webhook row, fill only specified 34.1 translations when the v2 field is absent:
   - `source_system: "granot"`
   - `observation_channel: "granot_webhook"`
   - `captured_at` from `received_at || createdAt`
   - `route_event_class` from `event_type` when that value is a `GranotRouteEventClass`
   - `evidence_version: 2`
   - `authentication_method: "legacy_unknown"` because the historical/current capture path cannot prove `body_secret` or `header_secret`
   - credential-redacted `payload_sha256`
   - nested `processing` using the translation in §6.8
3. Do not steal Unit 03 assignment of `body_secret` / `header_secret`.
4. Do not rewrite `captureGranotWebhookReceipt` field writes, `sanitizeHeaders`, `requireGranotWebhookSecret`, or the `202` / `401` / `503` envelopes. Updating the import path after the file rename is allowed.
5. Document the Unit 02→03 window: live rows inserted through the deprecated alias may carry `legacy_unknown` until Unit 03 writes a proven method. That is compatibility, not a claim that Section 9.2 auth is implemented.

### 6.8 Historical processing-state translation (fail-closed)

Section 34.1 requires “translated processing state” but does not publish a `processing_status` → `ReceiptWorkState` table. Do not invent `processed → completed`, `failed → dead_letter`, or `ignored → …`.

This issue authorizes only the minimum translation that satisfies the required `processing` shape without claiming work occurred:

| Legacy `processing_status` | Translation |
| --- | --- |
| `received` | `processing.state = "pending"` |
| `processed`, `ignored`, `failed`, or any other value | **refuse apply**. Report counts and masked IDs. Stop. |

Required processing defaults when translating `received` (or filling a live legacy insert):

- `technical_attempts` ← `processing_attempts` when it is a nonnegative number, otherwise `0`
- `match_attempt` ← `0` (no matcher exists)
- `manual_requeue_count` ← `0`
- `next_attempt_at` ← `captured_at` (due, but processing is off so nothing claims it)
- do **not** set `lease_owner`, `leased_until`, `last_started_at`, `last_error`, `completed_at`, or `latest_decision_id`

`--report` must count every distinct legacy `processing_status` and event class. `--apply` may mutate only rows that satisfy this table. `--verify` fails if a translated row is missing required v2 fields or if a refused status was written.

If a later specified table appears in the final specification, that table wins and this compatibility default is withdrawn.

### 6.9 Receipt and index migration scripts

Add scripts under `scripts/migrations/` and exact package.json names from Section 34. Existing operations-registry scripts use `migrations:…`; this program requires `migration:granot-lifecycle:…`. Use the spec names.

```text
pnpm migration:granot-lifecycle:receipts -- --report
pnpm migration:granot-lifecycle:receipts -- --apply --confirm-production=<db>
pnpm migration:granot-lifecycle:receipts -- --verify

pnpm migration:granot-lifecycle:indexes -- --report|--verify
pnpm migration:granot-lifecycle:indexes -- --apply --confirm-production=<db>
```

Shared Section 34 rules:

- scripts are dry-run / `--report` by default;
- omitted mode means `--report`;
- reject combining `--report`, `--apply`, and `--verify`;
- reject historical/unknown databases (follow the existing operations-registry refusal of `vantagemovershistorical` and unknown names);
- `--apply --confirm-production=<database-name>` is required for mutation;
- write deterministic PII-safe JSON manifests under the gitignored `scripts/output/` directory;
- support idempotent rerun;
- verify is read-only and exits nonzero on any invariant mismatch.

**`granot-lifecycle-receipts.ts` (34.1)**

- audit legacy row counts, statuses, event classes, and forbidden credential keys;
- set channel `granot_webhook`, source system, capture time from `received_at || createdAt`, evidence version, redacted payload hash, auth method `legacy_unknown` when the historical method cannot be proven, and the §6.8 processing translation;
- remove any persisted `x-api-secret` keys before hashing/backfill; report count only, never value;
- preserve legacy fields;
- never create effects;
- record changed IDs in the manifest so additive fields can be inspected later.

**`granot-lifecycle-indexes.ts` (34.5)**

- report duplicate keys for every proposed unique/partial index;
- create non-unique indexes first;
- create unique indexes only after the collision report is zero;
- verify index names/definitions against the model contract in §6.5.

Assignment never authorizes a production `--apply`. Local tests may apply against the verified test database only.

### 6.10 Documentation

When the model lands, add a narrow note to `.cursor/rules/project-organization.mdc` that `GranotObservationReceipt` lives under `src/models/` and collection `granot_webhook_receipts` is retained. Do not rewrite owner-workflow identity docs (Unit 01). Keep `CONTEXT.md` implementation-free.

## 7. Explicitly out of scope

- Unit 03: `requireGranotWebhookSecret` rewrite; timing-safe both-secret agreement; live header allowlist (`content-type`, `content-length`, `user-agent`, `x-request-id`, `x-vercel-id`, 1,024 truncation); capture-before-202 behavior; `401 { ok:false, code:"GRANOT_WEBHOOK_UNAUTHORIZED", error:"Unauthorized" }`; `503` envelope change; queue publish `{ receipt_id }` only.
- Unit 04: `GranotObservation`, `normalization.ts`, one-Observation-per-receipt upsert.
- Units 05–08: Registry, Decision, activation, Record Link, claim/lease/drainer, queue/cron, flags module.
- Units 16–17: extension/automation apply cutover and operation-ID replay/conflict at the route.
- Automatic Booking/Cancellation create/update/un-cancel.
- Intake / dismiss / generic lifecycle enum names.
- Physical rename of `granot_webhook_receipts`, dual-collection cutover, TTL, raw-receipt purge, app-level field encryption.
- General raw-payload admin endpoint.
- Unique `payload_sha256` index.
- Enabling `GRANOT_LIFECYCLE_PROCESSING_ENABLED` or any later effect flag.
- Production `--apply`.
- Expanding `DurableActor` origins.
- Compatibility-field cleanup (later issue).

## 8. Flags and runtime posture

- **Starting flags:** none. Unit 01 introduced none. `src/config/domain/granotLifecycle.ts` does not exist.
- **Ending flags:** none introduced or changed. Do not add the Section 27 flag module.
- S02: capture remains always active; processing remains off.
- Do not disable existing webhook routes.
- Later effects remain nonexistent/false: Lead writes/creation, Booking/Release cases/commands, Referral, email, processor, queue/drainer, activation.
- Never enable a later effect to make a test pass.

## 9. Migration and indexes

Not `none`. Use the Section 34 report → reviewed apply → verify flow in §6.9. Production apply is separately approved and never implied by this assignment.

## 10. Acceptance criteria

- [ ] **AC-02 identity foundation:** unique partial `{ observation_channel, channel_operation_id }` exists; webhook rows without `channel_operation_id` are excluded; identical payload hashes do not collide because `{ payload_sha256, captured_at }` is diagnostic and never unique.
- [ ] Operation-ID validation rejects empty, over-300, control/bidi, non-lowercase-UUID-v4 extension IDs, and automation IDs that are not exactly `${run_id}:${action_id}`.
- [ ] Channel validators: webhook requires `route_event_class` and forbids `channel_operation_kind`; extension/automation require both operation kind and operation ID.
- [ ] Evidence immutability: model save rejects post-insert evidence mutation; only allowlisted `processing.*` `$set` / `$inc` / `$unset` succeed.
- [ ] `getGranotWebhookReceiptModel` deprecated alias keeps existing capture create/tests passing; collection remains `granot_webhook_receipts`.
- [ ] Deterministic canonical hash: `canonicalJson` + SHA-256 → lowercase 64-char hex after credential-key removal.
- [ ] **AC-35:** migration manifests/logs report counts and masked IDs only; `x-api-secret` and other stripped credential keys are count-only; `last_error.message` is PII-safe and ≤500 chars; no new admin raw-payload route is added.
- [ ] Historical translation: 34.1 field mapping; `legacy_unknown` when auth method is unproven; `received → pending` only; other legacy statuses refuse apply.
- [ ] Receipt migration is idempotent; second `--apply` on already-translated rows is a no-op for evidence and reports already-current counts.
- [ ] Index script reports unique/partial collisions, creates non-unique indexes first, creates the unique index only after a zero-collision report, and `--verify` matches the §6.5 model contract.
- [ ] Legacy indexes and legacy fields remain.
- [ ] No domain effects, flags, Observation model, processor, or capture-auth rewrite.

Name every AC-owned test with `[AC-02]` and/or `[AC-35]`.

## 11. Required tests and commands

Map acceptance bullets to focused tests before implementation. Follow `src/models/LeadMessage.test.ts` for `schema.indexes()` definition proof.

Minimum locations:

- `src/models/GranotObservationReceipt.test.ts` — `[AC-02]` validators, write-once evidence, index definitions, alias/collection.
- `src/services/granotLifecycle/*.test.ts` or a dedicated receipt-evidence test — `[AC-02]` `[AC-35]` hash and count-only redaction.
- `scripts/migrations/granot-lifecycle-receipts.test.ts` — `[AC-02]` `[AC-35]` translation, credential-key count, idempotent rerun, refused-status apply.
- `scripts/migrations/granot-lifecycle-indexes.test.ts` — `[AC-02]` collision report, non-unique-first, verify definitions.
- Existing `src/services/granotWebhooks/granotWebhookCapture.service.test.ts` must still pass.

Mongo uniqueness, transaction, lease, and concurrency *behavioral* claims require replica-set evidence. Index **definitions** may be proven at model level. If claiming Mongo-enforced duplicate-key rejection for the operation-ID index, add a replica-set test; otherwise do not claim runtime uniqueness beyond the schema definition.

Use redacted synthetic receipts only. Do not commit current payloads, credentials, or live database output. Scanner-style rejection cases stay in-memory.

```text
node --import tsx --import ./scripts/test-setup.ts --test "src/models/GranotObservationReceipt.test.ts" "src/services/granotLifecycle/*.test.ts" "src/services/granotWebhooks/granotWebhookCapture.service.test.ts" "scripts/migrations/granot-lifecycle-receipts.test.ts" "scripts/migrations/granot-lifecycle-indexes.test.ts"
pnpm test
pnpm typecheck
```

Adjust the focused glob only if files are split further inside the named domain. The full commands are mandatory.

## 12. Live/staging verification

No live Granot webhook and no production `--apply`.

S02’s “authorized synthetic webhook returns `202`; unauthorized creates no row” proof is **Unit 03**. This unit’s verification is local and read-only except for the verified test database:

- synthetic model inserts and validation failures;
- receipt/index `--report` and `--verify` against the test database;
- inspect stored **keys** and counts only;
- do not print payload bodies, headers, or contact values.

## 13. Rollback

S02 takes precedence: prior capture code can read compatibility fields; do not delete new evidence.

This unit has no effect flag. Narrowest rollback: revert model/migration/package-script code; keep collection `granot_webhook_receipts`; keep persisted evidence and additive fields; do not drop indexes as an evidence rollback; do not delete receipts. Unsetting additive fields requires a separately authorized 34.7 rollback script.

## 14. Required completion handoff

Use Runbook Section 13 and include, specifically:

- confirmation that the collection name is unchanged and `getGranotWebhookReceiptModel` still serves current capture;
- the declared index names and definitions;
- the exact processing-status translation used and any refused-status counts from tests;
- hash helper location and that migrations call it rather than reimplementing policy;
- flags before/after (none/none) and that processing remained off;
- focused/full command outcomes and test counts;
- confirmation of no Observation model, capture-auth rewrite, queue publish, production apply, flags module, or customer/current payload use;
- units newly unblocked for **contract refinement**: Unit 03 (implementation next), with Units 05 and 09 still refinement-only;
- final `git status --short`;
- the statement that no commit, push, deploy, production mutation, live payload exposure, or external send occurred unless separately authorized.

Do not mark Unit 02 complete if any Section 10 checkbox is unproven, a required command fails, existing capture tests break, or a later-unit effect was enabled.
