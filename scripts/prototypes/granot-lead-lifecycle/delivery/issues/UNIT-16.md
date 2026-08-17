# Unit 16 — Browser extension receipt apply and version 0.2.8

> **Contract maturity: implementation-ready; implementation remains blocked by Units 14–15 and the shared-branch sequence.** This is S10. It replaces patch-authoritative extension final apply with durable channel-neutral receipts and the common processor, while preserving read-only previews and shadow-only parity.

## 1. Authority and required reading

- **Final specification:** Sections 1–2, 4–7, 9.1/9.4, 10–11, 25–28.1, 30, 35–37, 38/S10, and 39–41.
- **Acceptance ownership:** extension portion/completion of AC-02, extension half of AC-33, and complete AC-34; extension route/projection privacy under AC-35.
- **Approved split:** Unit 16 in `lead_lifecycle_issue_breakdown_reccomendation.md`. Units 02–04 own receipt/normalization foundations; Units 14–15 own source/identity/planning/processor. Unit 17 independently converges HTTP automation. Unit 18 owns accepted parity and live matched writes.
- **Execution:** delivery runbook; both repositories' instructions; verified predecessor reports/code/indexes; current extension parsers, preview/sync/background/storage/auth code; server v1 extension auth/routes; and actual package/WXT manifest behavior.

The server receipt/processor contract is authoritative. `expected_target`, client quote derivation, prior patch previews, and existing route IDs are never business authority.

## 2. Objective

On the existing extension final-apply URLs, accept strict full Granot statements with stable per-action UUID v4 IDs, capture/replay one `browser_extension` receipt per item, preserve the authenticated Owner initiator, enter through Unit 08's claim/process-or-poll seam, and translate processor results to a stable per-item compatibility response. Update popup/background workflows to persist bounded PII-free pending operation records across network/auth retry, remove client authoritative Lead patch/Quoted derivation from final apply, and report package/generated manifest version `0.2.8`.

## 3. Repository, branch, and prerequisites

- **Repositories/branches:** `vantage-main-server` / `granot-lead-lifecycle`; `granot_sync_extensions_and_services` / `main`.
- **Blocked by:** Units 02–04 and 14–15. Units 10–13 are indirect prerequisites through Unit 14. Server compatibility lands and is verified before the extension depends on it.
- Before edits, run branch/status/recent-change checks in both repositories and reverify the receipt operation-ID unique index, canonical hash/redaction, Owner auth actor conversion, Unit 08 `claimAndProcessOrPoll`, processor stored-result replay, Unit 15 shadow outcome, extension endpoint callers, parser row shapes, auth-refresh flow, background settings/locks/storage, and WXT build manifest.
- Preserve unrelated/user changes. No commit, push, deploy, store submission, production flag/index/data mutation, current payload inspection, or external send.

## 4. Current-state evidence to verify

Observed on 2026-08-17:

- Server `GranotObservationReceipt` already validates extension lowercase UUID v4 operation IDs and has the unique partial `{observation_channel, channel_operation_id}` index. `capture.ts` is webhook-specific; add a channel capture boundary rather than weakening webhook auth.
- Unit 08 exposes `claimAndProcessOrPoll` and returns a processed result or durable `accepted_for_processing`; final apply must use it rather than directly invoking an unfenced second processor.
- Existing v1 URLs are `PATCH /api/v1/form-leads/:id/granot-sync`, `POST /api/v1/call-leads/enrichment/sync`, and `POST /api/v1/call-leads/booked-reconciliation/sync`. They currently parse patch/row payloads and call legacy mutation services directly.
- Existing preview URLs/services are read-only and remain. Current apply routes do not yet require an `operation_id` or capture a lifecycle receipt.
- Extension `package.json` is `0.2.7`; WXT derives generated manifest version from package metadata and `.output` is not authority.
- Extension Form final apply currently builds/sends `quoted`, cubic/location, and receiver patches; Call final apply sends enrichment/reconciliation row DTOs. Background auto-sync calls the same patch-era APIs.
- Existing auto-sync history stores customer-facing row labels/details and is not the new operation ledger. The Unit 16 pending ledger must contain no raw/customer data and must not reuse history as idempotency state.

## 5. Locked decisions and invariants at risk

- **Invariant 1:** the server/Mongo processor decides identity/desired state; the extension does not.
- **Invariant 2–3:** Booked evidence is not an official Booking action by the client and creates no stored lifecycle enum.
- **Invariant 5–7:** this shadow unit invokes no canonical aggregate mutation; no Change/Sheet work may appear.
- **Invariant 8:** authenticated Owner is initiator, processor is system actor, channel is `browser_extension`, and Ingestion Origin/source remain independent.
- **Invariant 9–11:** full raw statement preserves evidence; client patches cannot overwrite snapshots/source/CPL or bypass Bad/Duplicate rules.

## 6. Deliverables and exact contract

### 6.1 Shared final-apply item

Use the exact final-spec item:

```ts
type ExtensionGranotApplyItem = {
  operation_id: string; // lowercase UUID v4, stable across retry/auth refresh
  operation_kind: "lead_snapshot_apply" | "booking_action_apply";
  granot_statement: Record<string, string | number | null>;
  expected_target?: { model: "FormLead" | "CallLead"; id: string };
};
```

- `granot_statement` is the full flat bounded statement accepted by Unit 04 normalization: source label, available Job/reference/contact/move fields, exact raw Priority, `user` and `rep` separately, and Booking Action when applicable.
- Do not pre-collapse user/rep, convert Priority to Boolean, preselect an authoritative Lead, or send a Lead patch.
- `expected_target` is optional drift evidence. If present, route/model/id syntax must agree with the URL/client row; processor identity must independently agree. Disagreement is a non-syncable conflict, never an override.
- Follow Up Form and Call enrichment use `lead_snapshot_apply`. Booked Jobs uses `booking_action_apply` and retains raw `Booked` evidence.
- Strict Zod rejects unknown outer keys, invalid IDs/kinds, nested/object statement values, unsafe/unbounded strings, credential-like keys, and a Booking action on `lead_snapshot_apply` or missing action on `booking_action_apply`. Reuse Unit 04 field aliases/bounds; do not create a second normalization policy in routes.

### 6.2 Existing URL envelopes

The final specification fixes item/result but not the legacy outer envelope; use this **issue-author compatibility allocation**:

- Form PATCH accepts exactly one `ExtensionGranotApplyItem`; `expected_target`, when present, must be `{model:"FormLead",id:req.params.id}`.
- Both Call POST routes accept `{ items: ExtensionGranotApplyItem[] }`, return one result per item in input order, enforce a bounded batch (use the existing safe batch maximum if one exists; otherwise 100), and reject duplicate operation IDs inside a request.
- Call enrichment permits only `lead_snapshot_apply`; booked reconciliation permits only `booking_action_apply` and expected model `CallLead` when a target exists.
- Preserve the normal `{ ok:true, data }` v1 envelope. Do not change preview request/response URLs in this unit.

### 6.3 Owner auth, receipt capture, and idempotency

Add a channel-neutral capture function under `src/services/granotLifecycle/` used by all three apply routes:

- Require the existing authenticated extension session and **Owner** role; map it to a durable human initiator with `origin:"browser_extension"`. Unit 10–11 durable actor vocabulary must already support this final-spec origin. Admin/non-Owner/unauthenticated requests create no receipt.
- Insert `source_system:"granot"`, `observation_channel:"browser_extension"`, `authentication_method:"extension_session"`, `channel_operation_kind`, `channel_operation_id`, `initiator`, `captured_at`, `evidence_version:2`, safe header allowlist, credential-redacted payload/hash, and pending processing defaults.
- Store the apply item as evidence after credential-key rejection/redaction. Hash the canonical evidence payload so `expected_target`, kind, and statement drift are detectable; never hash/store auth tokens/cookies.
- First operation ID + hash inserts exactly one receipt. Same channel/ID + same hash returns/reuses that receipt and its current/stored result. Same channel/ID + different hash returns `409 GRANOT_OPERATION_IDEMPOTENCY_CONFLICT` and creates no receipt/effect.
- Resolve unique-index races by reloading the winner and applying the same hash check; never run two processors.
- After capture/replay call `claimAndProcessOrPoll` with the receipt ID. A lost claim polls boundedly; completed returns stored Decision result; claimed/retry-scheduled returns durable pending.
- Preserve the receipt's Owner initiator into `processor.process({receipt_id, initiator})`; processor/canonical actor remains the fixed Granot Lifecycle Processor system actor.

### 6.4 Exact per-item response

Return:

```ts
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

- `created|applied|linked` → updated success; `already_current|stale` → unchanged.
- `pending_match|unmatched|ambiguous|conflict|policy_blocked|deferred|insufficient_creation_data|invalid|unsupported` → terminal/non-syncable review result except `pending_match` follows server receipt scheduling and is not auto-retried by the extension as a new operation.
- `accepted_for_processing` is durable pending and refreshes with the **same** operation ID. Capture failure is retryable with the same ID; post-capture technical failure belongs to server retry state.
- `changed_paths` comes only from processor effect summaries and is `[]` in Unit 16 shadow parity. Messages are fixed PII-safe mappings; never echo values/error payloads.
- Preserve current UI result vocabulary only in the client adapter; do not rewrite the server Decision outcome.

### 6.5 Extension operation ledger

Add a dedicated `browser.storage.local` ledger before every final request:

```ts
type PendingGranotOperation = {
  operation_id: string;
  row_fingerprint: string;
  operation_kind: "lead_snapshot_apply" | "booking_action_apply";
  created_at: string;
  attempt_count: number;
};
```

- Generate UUID v4 exactly once when an Owner foreground/background action is queued. Persist before network I/O and reuse across auth refresh, browser/network retry, extension restart, and pending refresh.
- Each Call batch item has its own ID. A deliberate later apply after a terminal result gets a new ID.
- Fingerprint is a one-way deterministic digest of the sanitized statement/row identity relationship; never store raw statement/contact/Job/reference/source/customer text in operation records or diagnostics.
- Remove only after a terminal server result. Keep accepted/retryable items. Increment attempts without changing ID/fingerprint.
- Prune to at most 500 entries and seven days; deterministic oldest-first expiry. Expose only a numeric diagnostic count.
- Existing auto-sync history/settings/lock remain separate. Refactor foreground and background final apply to the same operation builder/ledger/API adapter so background cannot bypass receipts.

### 6.6 Preview and patch-path removal

- Preview/search stays read-only, may calculate UI guidance, creates no receipt, and mutates nothing.
- Final apply no longer calls `updateFormLead`, `syncCallLeadEnrichment`, or booked legacy mutation services with authoritative patch DTOs. Remove/retire final-apply imports/builders that send `quoted`, cubic/location, receiver, Job, or arbitrary patch fields.
- Client may display parsed/diff guidance but must send raw Priority and full statement. It never creates an Agent, sets receiver directly, or decides Bad/Duplicate/source eligibility in final apply.
- The old server apply implementation may remain behind no reachable route only if needed for one compatibility release; tests/search must prove no extension apply path can invoke it. Unit 33 removes dead compatibility code.

### 6.7 Version and documentation

- Change extension `package.json` from `0.2.7` to `0.2.8`; update lockfile only as package tooling requires. WXT-generated Chrome/Firefox manifests must report `0.2.8`.
- Generated `.output` artifacts are not version authority and need not be committed unless existing release policy requires it.
- Update server/extension docs and rules for receipt apply, pending ledger, response mapping, preview boundary, privacy, and version.

## 7. Explicitly out of scope

- Lead writes/creation, link target mutation, Booking/Release cases or official actions, Changes/outbox, notifications, or shadow disable (Units 18+).
- HTTP automation convergence (Unit 17), source/identity/planner policy (Units 14–15), or RingCentral adoption.
- Changing preview to create receipts, automatic retry of terminal business outcomes, extension Agent creation/selection as authority, production deployment/store release, or compatibility cleanup.
- Receipt/index migration or production index apply; Unit 02 owns it.

## 8. Flags and runtime posture

Starting and ending server posture:

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

Extension apply capture is live evidence intake, but processor behavior remains historical/live shadow. Preview remains read-only.

## 9. Migration and indexes

**No new migration/index.** Reverify the existing receipt operation-ID unique index with:

```text
pnpm migration:granot-lifecycle:indexes -- --report
pnpm migration:granot-lifecycle:indexes -- --verify
```

Production apply is separately authorized and not part of this unit. If verify fails because prerequisite indexes are unapplied, retain the implementation block and report it; never bypass uniqueness in application code.

## 10. Acceptance criteria

- [ ] **AC-02 extension assertion:** same stable extension operation ID + same hash replays one receipt/result; different hash is exact 409; concurrent race has one receipt/processor owner.
- [ ] **AC-33 extension assertion:** final apply creates `browser_extension` receipt and the same normalized identity/desired-state shadow result as equivalent webhook evidence; no legacy patch path bypasses receipt processing.
- [ ] **AC-34 exact release assertion:** “Extension retains an operation ID across retry/auth refresh and reports version `0.2.8`.” Prove foreground/background/restart retention, deliberate-new ID, per-batch IDs, bounds, and generated manifests.
- [ ] **AC-35 extension privacy portion:** no raw receipt payload/headers in response/logs; pending records/diagnostics contain no customer data; messages are safe.
- [ ] Raw Priority/user/rep and full statement survive unchanged into normalization; final apply sends no `quoted` Boolean or authoritative patch.
- [ ] Accepted pending refresh uses the same ID; terminal outcome is not automatically re-applied; shadow yields zero changed paths/effects.
- [ ] Preview creates no receipt and no mutation.

## 11. Required tests and commands

Server:

- model/capture/route tests for strict envelopes, Owner-only auth, insert/replay/hash conflict, unique race, initiator, batch order, pending polling, result mapping, safe messages, and no legacy service call;
- cross-channel production Module test using equivalent redacted webhook/extension statements;
- replica-set proof for unique-ID race/one processor claim.

Extension Vitest:

- UUID generation/retention across request, auth refresh, restart, pending refresh, and retry;
- distinct deliberate/batch IDs; statement raw field fidelity; no patch/Quoted derivation; ledger privacy/500/7-day pruning; response mappings; foreground/background common adapter; package/WXT version.

Run exactly:

```text
# vantage-main-server
node --import tsx --import ./scripts/test-setup.ts --test "src/models/GranotObservationReceipt.test.ts" "src/services/granotLifecycle/extensionApply.test.ts" "src/routes/extension-granot-apply.test.ts" "src/services/granotLifecycle/crossChannel.test.ts"
pnpm test:granot-lifecycle:replica -- --unit=16
pnpm test
pnpm typecheck

# granot_sync_extensions_and_services
pnpm test
pnpm compile
pnpm build
pnpm build:firefox
```

Test filenames may follow verified route conventions; record actual paths in handoff.

## 12. Live/staging verification

- In a disposable/staging synthetic environment, submit the same redacted statement through webhook and extension; compare normalized Observation, source scope, match method, desired-state outcome/reason, and zero effect set.
- Exercise auth refresh, same-ID replay, hash conflict, accepted pending refresh, deliberate later apply, and one multi-item Call batch. Inspect only causal IDs, states, counts, versions, and masked IDs.
- Verify installed/generated Chrome and Firefox manifest version `0.2.8`. Production/customer payloads and store release remain unauthorized.

## 13. Rollback

- Disable lifecycle processing first if processor behavior is unsafe; capture/evidence remains durable. Roll back the new client caller only to a receipt-preserving server adapter.
- Restore an old endpoint adapter **only if it still captures a receipt and invokes the common processor**; never restore direct patch mutation as a bypass.
- Keep `0.2.8`, operation ledger records needed for retry, receipts, Observations, Decisions, activation, links, aggregates, and official facts. Never delete evidence or reuse IDs for different payloads.

## 14. Required completion handoff

Create `delivery/completion-reports/UNIT-16-COMPLETION.md` per Runbook Section 13, including:

- both repositories/branches and files grouped by server capture/route/idempotency, extension statement/ledger/adapters/version, tests/docs;
- Sections 9/11/25–28.1/30, invariants 1–11 applicable, S10, and AC-02/33/34/35 mapping;
- exact request/response envelopes, auth/initiator mapping, hash/replay table, pending ledger/pruning/privacy, legacy path reachability proof, and version evidence;
- flags, index report/verify, focused/full/replica/extension compile/build results, cross-channel masked comparison, final status in both repos, and external-action statement.

Successful verification completes S10 and contributes required parity evidence for **Unit 18**. Unit 17 remains independently implementable after Unit 15; neither unit enables Lead writes.
