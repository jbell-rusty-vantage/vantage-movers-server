# Unit 03 completion — webhook authentication, secure capture, response, and queue wake-up seam

## Status and scope

- **Status:** complete
- **Repository / branch:** `vantage-main-server` / `granot-lead-lifecycle`
- **Authoritative contract:** final specification Sections 1–2, 4–7, 9.1–9.4, 33, 35–36, 37.1–37.2, and 38/S02 webhook-facing half
- **Acceptance ownership:** AC-01; webhook-delivery portion of AC-02; webhook capture/privacy portion of AC-35
- **Applicable invariants preserved:** 1, 2, 3, 5, 8, and 9
- **Runtime posture:** authenticated webhook capture writes a complete v2 `GranotObservationReceipt`, returns `202` only after commit, then attempts a best-effort `{ receipt_id }` wake-up. Processing remains off. No Observation, Decision, Lead, Booking, or Cancellation mutation.

## Files added or changed

### Authentication

- `src/middleware/requireGranotWebhookSecret.ts` — scalar header/body secret contract, dual-secret agreement, digest `timingSafeEqual`, header/body credential deletion before every downstream path, proven `body_secret` | `header_secret` request context, exact `401` / `500` envelopes.
- `src/middleware/requireGranotWebhookSecret.test.ts` — `[AC-01]` `[AC-35]` permutations, early deletion, exact unauthorized body, missing config.

### Production capture

- `src/services/granotLifecycle/capture.ts` — single implementation of allowlist, redaction/hash via Unit 02 `receiptEvidence`, and complete v2 webhook insert. Returns `{ receipt_id }` only.
- `src/services/granotLifecycle/capture.test.ts` — `[AC-01]` `[AC-02]` `[AC-35]` insert shape, route authority, allowlist/truncation, hash-after-redaction, identical deliveries, forbidden later fields.
- `src/services/granotWebhooks/granotWebhookCapture.service.ts` — narrow compatibility adapter; `sanitizeHeaders` / `classifyPayload` delegate to capture/evidence.

### Queue wake-up and metrics seam

- `src/services/granotLifecycle/queuePublisher.ts` — environment-scoped Vercel Queue publish of exactly `{ receipt_id }`; never throws; PII-safe `granot_lifecycle.queue.publish_failed`.
- `src/services/granotLifecycle/queuePublisher.test.ts` — exact payload, test-runner skip, safe failure telemetry.
- `src/services/granotLifecycle/metrics.ts` — in-process `granot_lifecycle_receipts_total{channel,event_class}` after commit, plus distinct capture/queue failure counters.
- `src/config/domain/granotWebhook.ts` — `getGranotLifecycleQueueTopic` / `shouldPublishGranotLifecycleQueue` (not a Section 27 flags module).
- `src/config/domain/granotWebhook.test.ts` — topic scoping and test/unapproved publish skip.

### Routes

- `src/routes/granot-webhook.routes.ts` — capture-before-`202`, exact envelopes, capture-failure `503` with no publish, publish-failure still `202`.
- `src/routes/granot-webhook.routes.test.ts` — `[AC-01]` `[AC-02]` `[AC-35]` HTTP envelopes and call-boundary no-row / no-publish proof.

### Docs

- `.cursor/rules/project-organization.mdc` — capture/publisher seam under `granotLifecycle/`.
- `.cursor/businesslogic/granotLifecycle.capture.md` — webhook capture behavior without claiming processing exists.
- `.cursor/index.md` — businesslogic index row.
- `docs/to_review/granot-lifecycle-prototype-and-implementation-seams.md` — current capture/`{ receipt_id }` wake-up; consumer still later.

## Auth permutations and stored-method decision

| Supplied forms | Outcome | Stored method |
| --- | --- | --- |
| header only, valid | `202` after capture | `header_secret` |
| body only, valid (JSON or form) | `202` after capture | `body_secret` |
| both valid and equal to configured secret | `202` after capture | `header_secret` (transport-preferred); body also validated |
| neither / wrong / nonscalar / mismatched dual | exact `401`, no receipt | — |
| blank/missing `GRANOT_WEBHOOK_SECRET` | `500`, neither capture nor publisher | — |

Section 9.2 does not name the dual-valid winner. UNIT-03 names deterministic `header_secret`. Tests prove the body was also compared (`validated_body: true` and mismatched dual-secret `401`).

## Credential deletion

Header and body `x-api-secret` are extracted, then deleted, before config check, `401`, `500`, capture, hash, logs, errors, and publish. Route capture fakes receive neither the body key nor the header key.

## Header allowlist

Stored names are exactly `content-type`, `content-length`, `user-agent`, `x-request-id`, and `x-vercel-id`. Values/array elements truncate to 1,024 characters. Authorization, cookies, forwarding, API secret, delivery/vendor, and arbitrary headers are omitted before insert and before hash helpers receive headers.

## Capture and publisher seams

- Capture writes the Unit 02 model directly with route authority, proven auth, `evidence_version: 2`, pending defaults, compatibility fields, and no operation ID/kind or human initiator.
- Publisher payload is exactly `{ receipt_id }`. Tests and unapproved environments skip `send`. Failure emits `granot_lifecycle.queue.publish_failed` and cannot change `202` or the receipt.
- Capture failure emits distinct `granot_lifecycle.capture.failed` (suitable for `capture 503 count > 0`) and does not publish.

## HTTP outcomes

| Outcome | Status | Body |
| --- | --- | --- |
| Committed | `202` | `{ ok: true, accepted: true, event_type, receipt_id }` |
| Unauthorized | `401` | `{ ok: false, code: "GRANOT_WEBHOOK_UNAUTHORIZED", error: "Unauthorized" }` |
| Missing config | `500` | `{ ok: false, error: "Granot webhook authentication is not configured" }` |
| Capture failure | `503` | `{ ok: false, error: "Webhook receipt could not be stored" }` |
| Publish failure after commit | `202` | same success body; receipt unchanged |

**503 code decision:** Section 9.3 locks `503` + no partial receipt. Section 28.4 names `GRANOT_CAPTURE_UNAVAILABLE`. UNIT-03 keeps the existing PII-safe body and forbids inventing a new public `503` code. This unit follows 9.3 + UNIT-03. Catalog alignment remains Unit 30.

**Identical deliveries:** two captures of the same redacted payload produce distinct `receipt_id`s and may share `payload_sha256`.

## Flags, migrations, and effects

- Flags before/after: none / none. `src/config/domain/granotLifecycle.ts` was not created.
- Migration/index change: none. Unit 02 receipt/index scripts were reverified locally; not production-applied.
- Processing, consumer, drainer, cron, Observation, Registry, and domain effects remain off/nonexistent.
- Publishing is safe with no consumer deployed.

## Verification

- Required focused command:
  - `node --import tsx --import ./scripts/test-setup.ts --test "src/middleware/requireGranotWebhookSecret.test.ts" "src/services/granotLifecycle/*.test.ts" "src/services/granotWebhooks/granotWebhookCapture.service.test.ts" "src/routes/granot-webhook.routes.test.ts" "src/models/GranotObservationReceipt.test.ts"`
  - **52 passed, 0 failed**.
- Additional local regressions:
  - `src/config/domain/granotWebhook.test.ts` included in an earlier focused run (**55 passed** with the required set).
  - `scripts/migrations/granot-lifecycle-receipts.test.ts` + `granot-lifecycle-indexes.test.ts` — **11 passed, 0 failed**.
- Full repository command:
  - `pnpm test`
  - **970 passed, 0 failed**.
- TypeScript:
  - `pnpm typecheck`
  - **passed**.
- `git diff --check`: **passed** (line-ending conversion warnings only).

Commit/no-row claims are **call-boundary** proof with injected persist/capture/publisher fakes, plus mongoose model validation from Unit 02. This session did not open a test replica set, so live Mongo insert/no-row is not claimed.

Preview/staging live verification: **not run**. No approved preview/staging synthetic DB or queue infrastructure was authorized. Publisher invocation is proven locally with a fake; default test-runner guard skips real `send`.

## Persistence, privacy, and concurrency

- Collection/alias unchanged: `granot_webhook_receipts` / `GranotWebhookReceipt` / `getGranotWebhookReceiptModel`.
- New rows must carry a proven method at insert; `legacy_unknown` remains a Unit 02 historical fill only.
- Credentials and raw payloads are absent from stored headers, hash input, HTTP bodies, queue messages, operational-event details, and test fixtures.
- Transaction/lease/consumer claims: not applicable.

## Known risks and deferred compatibility

- Section 28.4 `GRANOT_CAPTURE_UNAVAILABLE` / `request_id` on `503` is deferred to Unit 30 so this unit does not invent a new public field.
- Queue topic is named and publish-guarded; `vercel.json` consumer registration and `api/queues/granot-lifecycle-consumer.ts` remain Unit 08.
- In-process metric counters are a seam only; Unit 30 owns exported metrics/alerts.
- Compatibility adapter `granotWebhookCapture.service.ts` remains for one release.
- User-owned untracked/modified specification and later-unit issue files were preserved and are not part of this implementation.

## Handoff

Successful Unit 03 verification unblocks **Unit 04** (Observation persistence and exact normalization vocabulary). Units 05+ remain blocked for sequential shared-branch implementation unless an integration owner authorizes otherwise.

## Final `git status --short`

```text
 M .cursor/index.md
 M .cursor/rules/project-organization.mdc
 M docs/to_review/granot-lifecycle-prototype-and-implementation-seams.md
 M scripts/prototypes/granot-lead-lifecycle/delivery/UNIT-STATUS.md
 M scripts/prototypes/granot-lead-lifecycle/delivery/issues/UNIT-03.md
 M scripts/prototypes/granot-lead-lifecycle/delivery/issues/UNIT-04.md
 M scripts/prototypes/granot-lead-lifecycle/delivery/issues/UNIT-05.md
 M scripts/prototypes/granot-lead-lifecycle/delivery/issues/UNIT-06.md
 M scripts/prototypes/granot-lead-lifecycle/delivery/issues/UNIT-07.md
 M src/config/domain/granotWebhook.ts
 M src/middleware/requireGranotWebhookSecret.ts
 M src/routes/granot-webhook.routes.test.ts
 M src/routes/granot-webhook.routes.ts
 M src/services/granotWebhooks/granotWebhookCapture.service.test.ts
 M src/services/granotWebhooks/granotWebhookCapture.service.ts
?? .agents/write-granot-unit-issues/
?? .cursor/agents/docs-keeper.md
?? .cursor/businesslogic/granotLifecycle.capture.md
?? scripts/prototypes/granot-lead-lifecycle/delivery/completion-reports/UNIT-03-COMPLETION.md
?? scripts/prototypes/granot-lead-lifecycle/specs/FINAL-SPECIFICATION-TO-34-ISSUE-TRACEABILITY.md
?? src/config/domain/granotWebhook.test.ts
?? src/middleware/requireGranotWebhookSecret.test.ts
?? src/services/granotLifecycle/capture.test.ts
?? src/services/granotLifecycle/capture.ts
?? src/services/granotLifecycle/metrics.ts
?? src/services/granotLifecycle/queuePublisher.test.ts
?? src/services/granotLifecycle/queuePublisher.ts
```

User-owned specification/issue/agent files present before or during this session were preserved and were not rewritten as part of Unit 03. No commit, push, deploy, production mutation, live Granot call, current customer payload inspection, or external send occurred.
