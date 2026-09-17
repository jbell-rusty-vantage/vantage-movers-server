# Team handoff — CSI-02

- **Team / issue / date:** B / CSI-02 all-direction Call Interaction projection and authoritative Detailed Call Log reconciliation / September 17, 2026.
- **Agent and repo / branch / commit:** Fable (main implementer) with an independent Opus 5 code review ([INDEPENDENT-REVIEW.md](INDEPENDENT-REVIEW.md)); `vantage-main-server` `sales-intelligence`, baseline `dc70b43` (CSI-01 complete). Implementation committed as `935fbfd`; review resolutions are the follow-up commit on top of it. No checkout reset, branch switch or push. `vantage-admin` untouched (no dashboard work in this issue).
- **Status:** ready for review (review findings resolved). Implementation evidence is database-backed on an isolated replica with synthetic provider fixtures; live provider capability is not claimed (see limitations).

## Concrete behavior delivered

1. **Canonical projection (pure).** `src/services/numberActivity/interactionProjection.ts` projects webhook party events (`fromWebhookParties`) and Detailed Call Log records (`fromCallLogRecord`) into one `InteractionProjection` per provider session: direction Inbound/Outbound/Internal/Unknown, external and company endpoints, parties (role, extension, per-party sequence, connected, terminal), legs (bounded 40 with overflow count), every recording id from record and legs, provider result/connected, event times, observed time, sources. Identity is account-scoped `telephony_session_id` → `session_id` → `call_log_id`. Identical semantic input yields `changed:false`.
2. **Replay and ordering.** Per-party `last_webhook_sequence` fence (one party never suppresses another in the same delivery); `terminal`/`provider_connected` monotone; Call Log authoritative over later webhook terminal events; older `lastModifiedTime` records apply additive evidence only; delayed recording ids surface as `new_recording_ids` after terminal.
3. **Transactional persistence.** `persistInteraction.ts` runs one Mongo transaction per observation: alias reservation on the unique account-scoped fence, insert or `projection_revision` CAS update, merge-with-proof (only when one provider record names both identities: earlier row canonical, `merged_into_id` tombstone, alias re-point, rollup move, `interaction.merged` audit), Contact Number create/rollups under revision CAS, `interaction` audit invalidation, and durable `enqueueCsiJob` intent. Bounded retry on duplicate key / revision conflict. No network call inside the transaction.
4. **Independent reconcile.** `reconcileCallLog.ts` claims a fenced lease (`MongoLeaseStore` over `sales_intelligence_sync_state`, scope `call_log_all_directions`), computes `windowFrom = min(cursor − overlap, now − 12h)`, pages the account Detailed Call Log without a direction filter (250/page, ≤ 20 pages, lease renewed before each page and record), projects oldest-first, then writes cursor / `known_complete_through = windowTo − 15 min` / gaps in one fenced state write. Interruptions (throttle, provider error, page limit, projection failure, account resolution) keep the cursor and record a gap; leftover page budget repairs the oldest gaps; a lost lease writes nothing.
5. **Durable downstream scheduling.** Material changes with a Contact Number enqueue `outreach_ensure` (per revision); a new Contact Number enqueues `attachment_refresh`; terminal interactions enqueue `recording_discovery` per recording id plus a `:pending` job when no id was observed yet. Jobs stay `pending` until a consumer claims them; nothing here completes or discards them.
6. **Honest evidence.** Withheld/malformed/service-code/company endpoints keep raw provider values and `external_endpoint_kind` on the interaction, create no Contact Number and no `outreach_ensure` job; internal calls schedule nothing downstream. `contact_type` is `unknown` or provider `voicemail`; human conversation is never inferred. Provider account is never fabricated: party `accountId`, event path, record `uri`, or the configured `RINGCENTRAL_ACCOUNT_ID`; disagreement fails the observation with a bounded code.

## Files owned and changed

Added: `src/services/numberActivity/{types,phone,directory,accountIdentity,interactionProjection,persistInteraction,observeWebhookEvents,callLogClient,reconcileCallLog,fixtures}.ts`, `src/services/numberActivity/{interactionProjection,capture}.test.ts`, `scripts/test-csi-capture.ts`, `scripts/test-csi-capture.replica.test.ts`, `docs/knowledge/services/number-activity-capture.md`, `docs/call-sales-intelligence/workspace/evidence/csi-02/*`.

Shared files touched (additive, recorded in CONTRACTS): `src/models/CallInteraction.ts` (`external_endpoint_kind`), `src/models/salesIntelligence/infrastructure.ts` and `src/services/salesIntelligence/transactions.ts` (audit invalidation kind `interaction`), `package.json` (`test:csi:capture:replica`), `docs/index.md`, `docs/call-sales-intelligence/02-domain-models.md` (two rule lines), `workspace/CONTRACTS.md`, `workspace/LEDGER.md`.

Not touched: `src/services/ringcentral/**` (Call Qualification, `ingestRingCentralQualifiedCall`, `call-log-sync*`, cursor collection `ringcentral_call_log_sync_state`), `src/routes/ringcentral-webhook.routes.ts`, `vercel.json`, queues, subscriptions, Admin.

## Contract/version changes and consumers notified

`csi-capture-v1` published in [CONTRACTS.md](../../CONTRACTS.md#csi-02-concrete-imports-server-relative-september-17). CSI-01 additive corrections: `external_endpoint_kind` and audit kind `interaction` — both optional/enum-widening; CSI-01 tests pass unchanged (15/15 replica, focused suite green). This is a written handoff; no messages were sent to other teams.

## Tests/checks actually run

See [CHECKS.md](CHECKS.md) (re-run after the review fixes): typecheck exit 0; focused suite 69/69 (includes 26 CSI-02 pure tests, four added for review findings 1–3 and 8); CSI-02 replica proof 12/12 with new assertions for findings 4–7; CSI-01 replica regression 15/15; qualification suites 93 pass / 0 fail / 3 pre-existing opt-in skips; `git diff --check` clean.

## Race/idempotency/failure cases verified

Database-backed: concurrent identical deliveries (one identity), concurrent sessions on one number (exact rollups), enqueue failure rolling back interaction/alias/number/audit, semantic replay no-op, merge-with-proof with tombstone/alias/rollup/audit and resolution via the tombstoned alias, account-scoped alias collision (same session id under another account is distinct), lease contention, expired-lease worker unable to write after a successor, page failure gap open/close, 429 with no gap repair, page-limit `incomplete_before`, unresolved/mismatched account fail-closed, qualified cursor collection never written. Pure: per-party fences in one delivery, out-of-order and null-sequence events, stale Call Log additive-only, transfer legs and multiple recordings, delayed recording after terminal, voicemail/connected/unanswered contact type, internal/withheld/malformed, session-id-only bridging, no-directory unknown roles, coverage math including 50-gap coalescing.

## Known gaps or capability blockers

- **Not live-verified:** actual RingCentral webhook and Detailed Call Log shapes beyond the fields read; `Retry-After` header (the shared client does not expose response headers, so throttle waits use the documented 10-minute default and the run ends); real pagination/finalization behavior; production subscriptions (CSI-03/G6).
- **Not wired:** cron route, queue consumer, webhook route fan-out (CSI-03/A). `runCallLogReconcileOnce` and `observeRingCentralWebhookEvents` are the entry points.
- **Directory:** without a CSI-10 snapshot, party roles stay `unknown` and company-DID classification is not guessed; `connected_user_extension_ids` then includes connected extensions of unknown kind. Team C should treat `unknown` roles as unmapped, not as users.
- **Party model:** webhook party rows describe account participants (their own company-side endpoint); the customer side is the single `external` party row plus `external_e164`/`external_endpoint_kind`. Call Log legs merge as extension-keyed parties only when no webhook party already covers that extension.
- **Reconcile bounds:** a rolling window larger than 20 pages never completes in one run; it records a `page_limit` gap with `incomplete_before` and repairs oldest-first on later runs. Backfill windows (`sales_intelligence_sync_windows`) remain Team F.
- **`recording_discovery:pending`:** created for every terminal non-internal interaction without a recording id, including missed calls; CSI-11 resolves it as pending/no-recording/denied. This is intentional honesty, but it is job volume CSI-11 must expect.
- **Replica:** proofs ran on a disposable single-node Docker replica; no multi-node failover test.

## Deployment actions performed

None. Flags remain off. A local Docker MongoDB 8.0 container `csi01` on loopback 27189 was started for isolated tests only (see CHECKS.md); no production database, provider, subscription, backfill or messaging action.

## Next dependency and exact entry point for the receiving team

- **CSI-03:** call `normalizeWebhookPartyObservations(receipt.rawBody, receipt.receivedAt)` then `observeRingCentralWebhookEvents(observations)` from the durable capture-projection job; mount `runCallLogReconcileOnce()` at `/api/cron/sales-intelligence-call-log-reconcile` under `CAPTURE_CALL_LOG`. Use fixtures in `fixtures.ts` for fan-out tests.
- **CSI-04:** read `call_interactions` (follow `merged_into_id`), `contact_numbers` rollups, and sync state `known_complete_through` + `gaps` for Coverage; rebuild may replay stored evidence through the pure functions.
- **Team C (CSI-05/06):** consume `outreach_ensure` and `attachment_refresh` jobs via `claimCsiJob`; load the interaction from `input_refs`; `connected_user_extension_ids` and party roles are the effective-time participant evidence; `provider_connected` is not human contact.
- **CSI-11:** consume `recording_discovery` jobs; `recordings[].provider_recording_id` are the ids to discover; `:pending` means not yet observed.

## Independent review

A separate Opus 5 code-reviewer agent reviewed the `935fbfd` content read-only and ran the isolated suites; verdict Request Changes with ten should-fix findings and a nit list, all confirmed by execution. Three findings changed stored facts about real calls: an unknown short caller id was fabricated into a company extension (making a customer call `Internal` with no Contact Number, outreach or recording discovery); a party event with no `direction` became a sticky `Internal` because the party's extension was injected into an assumed company side; a stale Call Log record regressed leg-level result/duration. A fourth kept calling a throttled provider during gap repair. All ten and every nit except one accepted limitation (`country: "US"` default) are fixed with regression tests; see [INDEPENDENT-REVIEW.md](INDEPENDENT-REVIEW.md) for the finding-by-finding table and proof locations.

Contract-visible additions from the fixes (additive, recorded in CONTRACTS): `PersistDependencies.request_id` and `ObserveDependencies.request_id` (CSI-03 should pass its durable job id so audit rows tie back to the job); `ReconcileSummary.request_id` and `throttle_retry_after_observed`; audit `current` now carries `proof_ref`, `input_kind`, `request_id_generated`, `aliases_added`, `merged_interaction_ids`. Recount/rebuild obligation for CSI-04: filter `merged_into_id: null`.

## Ledger rows updated

CSI-02 → review. Other rows unchanged.
