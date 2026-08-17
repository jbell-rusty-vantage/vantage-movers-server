# Unit 03 — Webhook authentication, secure capture, response, and queue wake-up seam

> **Contract maturity: implementation-ready.** This completes the webhook-facing half of S02 against the landed Unit 02 receipt model. It authenticates and durably captures webhook evidence, then emits a best-effort wake-up. It does not normalize or process the receipt.

## 1. Authority and required reading

- **Final specification:** Sections 1–2, 4–7, 9.1–9.4, 28.1, 33, 35–36, 37.1–37.2, and 38/S02.
- **Original slice:** second half of S02 — Secure channel-neutral receipt capture.
- **Acceptance ownership:** AC-01; webhook-delivery portion of AC-02; webhook capture/privacy portion of AC-35.
- **Predecessor evidence:** `delivery/completion-reports/UNIT-01-COMPLETION.md` and `delivery/completion-reports/UNIT-02-COMPLETION.md`.
- **Canonical language:** workspace-root `CONTEXT.md`.
- **Execution rules:** `scripts/prototypes/granot-lead-lifecycle/delivery/AGENT-EXECUTION-RUNBOOK.md`.
- **Repository guidance:** `AGENTS.md`, `CLOUD_AGENTS.md`, `.cursor/rules/lead-lifecycle-delivery.mdc`, and applicable API/service, backend-safety, project-organization, and testing rules.

The final specification wins on conflict. Do not infer normalization or processing behavior from the prototype or current webhook examples.

## 2. Objective

Make all three existing Granot webhook routes authenticate the header/body secret contract, erase credentials before any downstream boundary, persist a complete v2 `GranotObservationReceipt` using the Unit 02 evidence/hash contract, return the exact safe response only after commit, and attempt a receipt-ID-only queue wake-up whose failure cannot undo the accepted receipt.

At handoff, an authorized JSON or form webhook is durable before `202`; an unauthorized or misconfigured request creates no receipt; capture failure returns a retryable `503`; and a later drainer can consume the Mongo receipt whether or not queue publication succeeded.

## 3. Repository, branch, and prerequisites

- **Repository:** `vantage-main-server` only.
- **Required branch:** `granot-lead-lifecycle`.
- **Blocked by:** Units 01–02, both complete and independently reverified.
- Before editing, run `git status --short`, `git branch --show-current`, inspect Unit 02's receipt model/hash helper/migration state, and rerun its focused receipt/capture tests.
- Preserve user-owned untracked specification/traceability files.
- Do not commit, push, deploy, mutate production data, call live Granot, inspect current customer payloads, or send external messages.

## 4. Current-state evidence to verify

Observed on 2026-08-17; recheck before implementation:

- `requireGranotWebhookSecret.ts` currently chooses header before body, does not require agreement when both exist, removes the body secret only after success, attaches no proven auth method, and omits the required `401` code.
- It already hashes compared values and uses `timingSafeEqual`; retain that timing-safe shape.
- `granotWebhookCapture.service.ts` writes the legacy-shaped input through the deprecated alias. Unit 02 fills compatibility fields with `authentication_method: "legacy_unknown"`; new Unit 03 rows must carry a proven method at insert.
- Current `sanitizeHeaders` is a denylist and preserves arbitrary headers. The final contract is the exact five-header allowlist.
- `granot-webhook.routes.ts` exposes the three required paths and awaits capture before `202`; it has no queue publisher and its `503` envelope has no stable code.
- Unit 02 retained collection `granot_webhook_receipts`, Mongoose registration `GranotWebhookReceipt`, and the deprecated getter. Do not rename/remove them here.
- No lifecycle production capture module, queue publisher/consumer, drainer, cron, Observation model, or flags module exists.

Adapt to landed code without weakening Sections 9.2–9.3. Report any contradiction requiring a public URL or Unit 02 evidence-contract change.

## 5. Locked decisions and invariants at risk

### Locked decisions

- Existing routes remain:
  - `POST /api/webhooks/granot/lead-created` → `lead_created`;
  - `POST /api/webhooks/granot/priority-updated` → `priority_updated`;
  - `POST /api/webhooks/granot/booking-status-changed` → `booking_status_changed`.
- Authentication accepts scalar `x-api-secret` from header and/or body. If both are present, both must independently equal the configured secret.
- Stored headers are exactly `content-type`, `content-length`, `user-agent`, `x-request-id`, and `x-vercel-id`, each value truncated to 1,024 characters.
- Delete the body credential before capture, hashing, logging, errors, fixtures, or queue publication.
- MongoDB is durable work. Queue delivery is only a `{ receipt_id }` wake-up.
- Identical webhook payloads are distinct deliveries/receipts. `payload_sha256` is diagnostic, never idempotency.

### Applicable Section 4 invariants

- **Invariant 1:** MongoDB is the System of Record. `202` cannot precede receipt commit or depend on queue durability.
- **Invariant 2:** Granot evidence is not official Booking/Cancellation authority. Capture cannot interpret/apply payload meaning.
- **Invariant 3:** no lifecycle enum is stored.
- **Invariant 5:** only canonical commands mutate aggregates; this route creates a receipt only.
- **Invariant 8:** provenance axes remain separate; webhook auth/channel do not infer Lead origin or human actor.
- **Invariant 9:** immutable evidence is not overwritten; construct complete redacted evidence at insert.

## 6. Deliverables and exact contract

### 6.1 Authentication context

Refactor the middleware/request typing so success attaches only:

```ts
type GranotWebhookAuthenticationMethod = "body_secret" | "header_secret";
```

Required behavior:

1. Blank/missing `GRANOT_WEBHOOK_SECRET` returns `500` and calls neither capture nor publisher.
2. Accept only scalar-string header/body forms; reject ambiguous arrays and do not coerce other values.
3. Extract then immediately delete body `x-api-secret`, including invalid, mismatched, and missing-configuration paths.
4. No supplied form is unauthorized. One supplied form must validate. When both exist, both must validate and agree.
5. Compare SHA-256 digests with `timingSafeEqual`, never raw secret strings.
6. If both valid forms exist, record deterministic `header_secret` (transport-preferred); tests must prove the body was also validated.
7. Expose no secret value, digest, or credential-bearing request copy.

Exact unauthorized response:

```json
{ "ok": false, "code": "GRANOT_WEBHOOK_UNAUTHORIZED", "error": "Unauthorized" }
```

Configuration/auth failure logs and responses contain no secret, digest, request headers, or payload.

### 6.2 Production capture module

Create `src/services/granotLifecycle/capture.ts`. Keep the old service as a narrow compatibility adapter only if imports require it. There must be one implementation of stripping, header filtering, hashing, and receipt creation.

Capture receives route class, server capture time, request headers, redacted payload, and proven method. Write the Unit 02 model directly with:

- `source_system: "granot"`, `observation_channel: "granot_webhook"`;
- `captured_at` and compatibility `received_at` from the same server time;
- route-derived `route_event_class` and compatibility `event_type`, never payload authority;
- no `channel_operation_kind`, `channel_operation_id`, or human `initiator`;
- proven `authentication_method`, never `legacy_unknown`;
- `evidence_version: 2`, compatibility `schema_version: 1`, `provider: "granot"`;
- redacted `payload`, its `payload_kind`, exact filtered headers, and lowercase canonical SHA-256 via Unit 02 `receiptEvidence.ts`;
- `processing`: `pending`, attempts/requeue counts `0`, `next_attempt_at = captured_at`;
- compatibility `processing_status: "received"`, `processing_attempts: 0`.

Do not insert legacy shape and rely on compatibility middleware to infer auth. Return `{ receipt_id }` only.

### 6.3 Exact header policy

- Case-insensitive allowlist only: `content-type`, `content-length`, `user-agent`, `x-request-id`, `x-vercel-id`.
- Preserve supported string/string-array representation and truncate every stored string/array element to 1,024 characters.
- Omit undefined/non-string values.
- Never store authorization/cookies, forwarding headers, API secret, delivery/vendor, or arbitrary headers.
- Filter before insert and before any hash/log/error helper receives headers.

### 6.4 Response and error mapping

After commit return `202` with exactly:

```json
{ "ok": true, "accepted": true, "event_type": "lead_created", "receipt_id": "..." }
```

`event_type` is the invoked route class. Capture failure creates no partial receipt/publish and returns the existing PII-safe body with `503`:

```json
{ "ok": false, "error": "Webhook receipt could not be stored" }
```

Missing configuration remains `500`. Do not invent additional public fields unless the repository's API error convention independently requires them; Section 9.3 locks the status/no-partial-receipt behavior, not a new `503` code.

### 6.5 Best-effort queue wake-up

After commit, call a focused environment-scoped Vercel Queue publisher with exactly:

```json
{ "receipt_id": "..." }
```

- Never publish from tests or an unapproved environment.
- Do not expose queue internals in the HTTP response or mutate receipt evidence.
- Failure emits PII-safe `granot_lifecycle.queue.publish_failed` log/Operational Event and metric seam, then still returns `202`.
- Logs/events may contain receipt ID and safe route/channel dimensions only.
- Unit 08 owns consumer/drainer/lease/retry/dead-letter/cron. Do not fake processing or complete the receipt.

### 6.6 Observability and docs

- Increment `granot_lifecycle_receipts_total{channel,event_class}` only after commit.
- Emit a PII-safe capture-failure event suitable for the `capture 503 count > 0` alert.
- Keep capture versus queue failure distinct; never log thrown input/model documents wholesale.
- Update project-organization and Granot lifecycle behavior docs for the new capture/publisher seam, without claiming processing exists.

## 7. Explicitly out of scope

- Observation/normalization, Registry, matching, Decisions, activation, Record Links, processor/drainer/consumer/cron, retries, manual requeue, or flags.
- Any Lead/Booking/Cancellation/case/discrepancy/command/Sheet Sync/notification/extension/automation effect.
- Payload business schemas, rejecting unknown fields, deduplicating webhooks, or operation-ID semantics.
- Receipt migration apply, compatibility cleanup, collection rename, TTL, raw Admin endpoint, app field encryption, queue deployment, or live production verification.

## 8. Flags and runtime posture

- **Starting/ending flags:** none/none; do not create the Section 27 module.
- Capture remains active when routes are deployed/configured; processing is off/nonexistent.
- Publishing must be safe with no consumer deployed. All effects remain nonexistent/false.

## 9. Migration and indexes

**None.** Unit 02 owns receipt/index scripts. Reverify them locally; do not production-apply or alter receipt indexes.

## 10. Acceptance criteria

- [ ] **AC-01:** JSON body, form body, and header secrets authenticate; missing, wrong, nonscalar, and mismatched dual-secret requests return exact `401` and create no receipt.
- [ ] **AC-01:** both forms succeed only when both validate; body credential is deleted before all success/failure downstream paths.
- [ ] **AC-01 / AC-35:** credentials are absent from payload, hash input, headers, logs/events, errors, queue messages, and fixtures/tests.
- [ ] Missing config returns `500` and reaches neither capture nor publisher.
- [ ] New rows are complete v2 webhook receipts with route authority, proven auth, pending defaults, compatibility fields, and no operation ID/kind or human initiator.
- [ ] Exact five-header allowlist and 1,024-character bound hold; arbitrary/sensitive/forwarding headers are omitted.
- [ ] Unit 02 helper hashes canonical redacted payload to lowercase 64-character hex.
- [ ] **AC-02 webhook portion:** two identical deliveries produce distinct receipts/IDs and may share the diagnostic hash.
- [ ] `202` follows commit and has exact success fields; capture failure returns safe `503`, no partial row, and no publish.
- [ ] Publisher receives exactly `{ receipt_id }`; failure is safely observed and cannot change `202` or the receipt.
- [ ] **AC-35:** no new list/log/response exposes raw payload/headers.
- [ ] No Observation, processor, Registry behavior, lifecycle flag, or domain effect lands.

Name tests `[AC-01]`, `[AC-02]`, and/or `[AC-35]` as applicable.

## 11. Required tests and commands

Minimum coverage:

- middleware tests: all auth permutations, early deletion, exact unauthorized response, missing config, sensitive-output absence;
- `granotLifecycle/capture` tests: complete insert input, route authority, allowlist/truncation, hash-after-redaction, identical deliveries, forbidden later fields;
- publisher tests: exact payload, disabled/test skip, safe telemetry;
- route tests: capture-before-response, exact envelopes, unauthorized no-row, capture failure/no publish, publish failure/`202`;
- Unit 02 model/hash/migration regressions.

Use injected fakes. Actual commit/no-row claims require verified test Mongo/replica-set evidence; distinguish call-boundary proof otherwise.

```text
node --import tsx --import ./scripts/test-setup.ts --test "src/middleware/requireGranotWebhookSecret.test.ts" "src/services/granotLifecycle/*.test.ts" "src/services/granotWebhooks/granotWebhookCapture.service.test.ts" "src/routes/granot-webhook.routes.test.ts" "src/models/GranotObservationReceipt.test.ts"
pnpm test
pnpm typecheck
```

Run authorized local `vercel dev` smoke only where routing/queue behavior differs from direct Express.

## 12. Live/staging verification

No production verification. In explicitly approved preview/staging with synthetic DB/evidence:

- authorized JSON and form requests each return `202` after a new row;
- unauthorized/mismatched dual-secret requests do not change count;
- forced publish failure preserves receipt/`202`; forced capture failure yields `503`, no row, no publish;
- inspect stored keys, auth label, bounded header names/lengths, IDs, counts, and hash format only—never values.

If staging queue infrastructure is unapproved, record it not run; prove invocation locally with a fake.

## 13. Rollback

Disable the publisher/caller first while leaving capture active. If capture code rolls back, Unit 02 compatibility can still read/write retained fields, but never delete receipts/evidence/indexes, restore secret persistence, or return `202` before capture. Data-field removal needs separately authorized Section 34.7 tooling.

## 14. Required completion handoff

Use Runbook Section 13 and include:

- auth permutations and both-valid stored-method decision;
- proof of credential deletion before every boundary;
- header allowlist/truncation proof;
- capture/publisher seams and `{ receipt_id }`-only proof;
- exact `401`/`202`/`503`/publish-failure outcomes and distinct-delivery proof;
- flags none/none, no migration/index change, processing/effects off;
- focused/full command results and counts;
- masked preview/staging evidence or not-run reason;
- no Observation/effect, production mutation, live payload, commit, push, deploy, or external send;
- final `git status --short`; and successful verification unblocking Unit 04.

Do not complete Unit 03 if a checkbox is unproven, a required command fails, unauthorized input reaches capture, credentials reach a downstream boundary, or `202` can precede commit.
