# CSI-02 independent review and resolution

Reviewer: separate Opus 5 code-reviewer agent, read-only over `src/services/numberActivity/**`, `scripts/test-csi-capture*.ts` and the CSI-02 docs, allowed to run the isolated suites. Reviewed the September 17 18:23 snapshot (commit `935fbfd` content); verdict **Request Changes**. Every finding below was confirmed by the reviewer by execution, not by reading alone. Resolutions were implemented by Fable (main implementer) and re-proven on the isolated replica; see [CHECKS.md](CHECKS.md).

The reviewer explicitly verified as correct and not to be re-litigated: per-party sequence fencing, Call-Log-first then webhook party adoption, one-canonical-row concurrency under the alias fence, single-transaction boundaries with rollback, account scoping with no phone/time merging, contact-type honesty, withheld/malformed/internal handling with fail-closed account resolution, coverage honesty (cursor and `known_complete_through` only on complete rolling windows; fenced state write), PII-free logging, and the mandated `recording_discovery:...:pending` job.

## Should-fix findings

| # | Finding (reviewer, confirmed by execution) | Resolution | Proof |
| --- | --- | --- | --- |
| 1 | `phone.ts` classified any 2–6 digit string as a company `extension` with a fabricated `extension_number`, so a garbled inbound caller id (`"12"`) became `direction: Internal`, lost its Contact Number, `outreach_ensure` **and** `recording_discovery`. | **Fixed.** A short dial is an extension only with evidence: directory `extensionByNumber`, or a provider-supplied `extensionNumber`/`extensionId` on that endpoint. Otherwise `malformed`, no fabricated `extension_number`, `extension_id` from the directory entry when known. | `interactionProjection.test.ts` "unknown short caller id is malformed…": Inbound, `malformed`, recording retained; known/labelled short dials still `extension`. Existing `"101"` assertions unchanged. |
| 2 | Webhook `Internal` was inferred from the one side the code *guessed* was external; a party event with no `direction` turned an outbound customer call into a sticky `Internal`. Root mechanism: the party's own `extension_id` was injected into whichever side was assumed to be the company side. | **Fixed.** `splitSides()` decides the company side from the provider `direction`, else the party's own `extension_id` matching `from`/`to`, else the endpoints' own classification; the party extension is never injected into an assumed side. `deriveWebhookDirection` now requires **both** sides company-side (mirrors the Call Log path); unknown direction stays `Unknown` until later evidence corrects it. | Test "party event missing `direction`…": `Unknown` then `Outbound`, `external_e164` is the customer; `internalCallDelivery` still `Internal`. |
| 3 | A stale Call Log record (older `lastModifiedTime`) regressed leg-level `result`/`duration_seconds` (`Accepted/95 → Missed/3`) while record-level facts were protected. | **Fixed.** When stale, `mergeLegs(incoming, existing)` so existing leg rows win on key collision; new leg ids still land additively. | Test "stale Call Log record never regresses leg-level result…". |
| 4 | A 429 during gap repair did not end the run; remaining repairs kept calling the throttled endpoint. | **Fixed.** The repair loop breaks when `summary.throttled_count > 0`. | Replica: rolling complete, gap repair #1 throttled, gap #2 never fetched (`fetches === 2`, `windows.length === 2`). |
| 5 | Merge re-pointed the tombstoned row's aliases and overwrote their `proof_ref` with the bridge record's ref. | **Fixed.** `Alias.updateMany` sets `interaction_id` only; the merge proof lives on the `interaction.merged` audit row. | Replica: sid-only alias keeps `proof_ref: call_log:sidonly`; merged audit `current.proof_ref` is `call_log:bridge`. |
| 6 | Audit rows minted a job-shaped `request_id` that referenced nothing and carried no `proof_ref`, so `interaction.created/updated` could not be tied back to the receipt or Call Log record. | **Fixed.** `PersistDependencies.request_id` / `ObserveDependencies.request_id` (24-hex job id supplied by CSI-03's durable job) becomes the audit actor `request_id`; the reconcile stamps one per-run id (`ReconcileSummary.request_id`). `current` now carries `proof_ref`, `input_kind`, `request_id_generated`, `aliases_added`, `merged_interaction_ids`. | Replica: supplied job id equals `actor.request_id`; `request_id_generated` true/false; webhook `proof_ref` equals the receipt uuid; reconcile rows carry the run id. |
| 7 | `provider_modified_watermark` advanced on partial runs (latent: nothing reads it yet). | **Fixed.** Advances only when every window in the run completed; otherwise the prior value is kept. | Replica: watermark unchanged after the throttled-repair run despite a record with a future `lastModifiedTime`. |
| 8 | `legs_overflow_count` was neither monotone (fewer legs later reset it) nor additive-safe (`mergeProjections` double counted). | **Fixed.** `max(existing, merged.overflow)` on records; `max(...)` across rows on merge (lower bound, documented). | Test "legs_overflow_count is monotone…". |
| 9 | `search_terms` grew unbounded (`provider_names` was capped). | **Fixed.** Capped at 20 (oldest dropped); CSI-04's rebuild owns the full term set. | Code; covered by lifecycle replica test path. |
| 10 | One directory query per session in a webhook batch. | **Fixed.** Per-account memoization for the duration of `observeRingCentralWebhookEvents`. | Code. |

## Nits

| Nit | Resolution |
| --- | --- |
| Missing Contact Number row threw retryable `REVISION_CONFLICT`, burning all attempts as `retry_exhausted`. | Fixed: throws non-retryable `InteractionPersistenceError("projection_failed")`. |
| Retries had no backoff/jitter. | Fixed: `attempt*5 + rand(0..20)` ms between retryable attempts. |
| Unchanged projection + new alias wrote an audit row whose `prior`/`current` were identical. | Fixed: `current.aliases_added` names the new identity evidence. |
| `earliestStart` accumulation was dead (`existing.started_at ?? earliestStart`). | Fixed: earliest wins unless the Call Log is authoritative for `started_at`. |
| Tombstones keep `contact_number_id` after rollup removal; recounts must filter `merged_into_id: null`. | Documented at the tombstone write and in the service card (CSI-04 obligation). |
| Webhook `proof_ref` took an arbitrary sorted-first uuid with literal `"unknown"` fallback. | Fixed: all contributing uuids (sorted, capped at 8 with `+n`), fallback `webhook:session:<id>`. |
| No-op ternary in `classify`. | Fixed. |
| `piiPolicy` not explicit on the observe-failed operational event. | Fixed: `piiPolicy: "none"`. |
| `country: "US"` hardcoded for any E.164. | **Accepted as limitation**; `national_ten` is null outside NANP and the value is a display default. Flagged for CSI-04 if non-NANP numbers appear. |
| `throttle_retry_after_ms` reported the 10-minute fallback as though observed. | Fixed: `throttle_retry_after_observed` (false when the shared client exposed no `Retry-After`). |
| Redundant `InteractionIdentity` re-export; unused `new_aliases` consumer. | Re-export removed. `ProjectionOutcome.new_aliases` kept: it is consumed by the pure tests and documents the projection's identity delta. |
| `fixtures.ts` ships under `src/`. | **Intentional**: CSI-03/04 and Team C import the builders; documented in the file and CONTRACTS. |
| Boundary test exempted `*.test.ts` by filename filter, hiding the evaluator import in the parity test. | Fixed: explicit, asserted test-only exemption list in `capture.test.ts`. |
| Replica runner never dropped its throwaway database. | Fixed: `dropDatabase()` on the `testvantagemovers_csi02*` database in the test's `finally`. |

## Not changed by the review

Alias uniqueness fence, transaction shape, job dedupe keys, cursor/gap semantics, contract table in CONTRACTS.md (extended additively with `request_id` and the new summary fields). No CSI-01 files beyond the two additive corrections already recorded.
