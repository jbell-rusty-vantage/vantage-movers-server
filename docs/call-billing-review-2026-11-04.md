# Call billing and Form/Call parity review — November 4, 2026

The efficiency prerequisite is a reviewed local Call policy patch, supported by behavior and disposable Mongo proofs. Integration and production deployment remain separate. The completed Best Relocation import has not been reopened or rerun.

## Baseline and scope

Fetched `origin/main`; it remained `5798e8fd7142894fc68b6a9c5743ccd096494688` on `https://github.com/jbell-rusty-vantage/vantage-movers-server.git`. Work is isolated in `vantage-call-review`, branch `fix/pre-efficiency-call-review`. The clean `vantage-storage-main` checkout and the older dirty `vantage-main-server` were preserved.

Review range: `b60496d5..5798e8fd`, specifically Call policy `6febe214`, historical/admission work `11975b07`, `0e64b267`, `267b3dbe`, final admission `772f16ab`, and literal latest four `249a737f`, `5c526490`, `4a31e894`, `5798e8fd`. Inspection covered constructors, route/command denial, Granot source policy and desired state, enrichment/reconciliation, admission, reporting readers, Sheets destinations, Desk subjects/Pool and final-import evidence.

## Review ledger

| Finding | Trigger and affected path | Evidence and disposition |
| --- | --- | --- |
| P1: incomplete Form arrival propagation | More than 25 eligible Calls share company/phone; `markMatchingCallLeadsWithFormFill` stops after the first page. Older Calls can remain billable. | Fixed with bounded durable continuation. Real Form command with 62 matching Calls proves immediate 25, interrupted continuation, all 62 marked exactly once, atomic audit/outbox and unchanged replay. |
| P1: cross-entity arrival race | Separate Form and Call snapshots both see no counterpart; no shared serialization previously existed. | Reproduced with two controlled local transactions through the ingestion services. Both commit with the Call unmarked; durable work then converges, including concurrent drains. Call detection also receives its transaction session. This remains eventual convergence, not instantaneous serialized billing. |
| P1: final-result ordering | Saved 08:05 Missed; identical 08:07 does not advance the stored clock; delayed 08:06 Accepted can overwrite it. `ringcentralFinalResult.ts`. | Fixed. Newer identical evidence persists a canonical watermark only; no semantic revision/change/outbox. Persisted Mongo interleaving and simultaneous observations prove stale rejection and later correction. Equal timestamps retain the first fact. Webhook and cron both build descriptors from Call Log observations and replay through this shared persistence seam, so delayed writes are reachable. No production occurrence is asserted. |
| P2: canonical company disagreement overridden | Candidate canonical company B and legacy slug A; caller scoped to canonical A; OR fallback accepts B. `duplicateLead.service.ts`. | Predicate defect reproduced against persisted contradictory fixtures. Fallback now requires absent/null canonical identity; cross-feed same-company and legitimate legacy records still match. Normal source assignment writes coherent fields; current production scan found no unsupported saved Form Fill. No claim that ordinary current source correction alone manufactures contradictory fields. |
| P2: regex candidate cap hides exact matches | 25+ longer foreign/international numbers contain the caller digits before a valid Form. `hasFormFillForCallLead`. | Reproduced with 101 false positives followed by a valid Form. Read-only detection now scans bounded 100-record pages with exact normalized verification. |
| Documentation drift | Qualification Service and workspace glossary still describe the final import hold; glossary says no duplicate matching across feeds. | Corrected completed bounded exception, retirement, company-level Form Fill versus repeated same-type duplicate rules. Workspace glossary is outside a Git repository and is a local-only update. |

## Preserved contracts and review conclusions

- Ordinary Call constructors remain RingCentral-qualified ingestion and the protected, fenced final-import exception. Public create, Granot create-if-missing, booking placeholders and external cron ingestion remain denied/retired. Enrichment, jobs, booking status and saved Sheet rows never confer admission. Historical RingCentral qualification remains accepted without modern route fields.
- Qualification precedes overnight classification. Arrival in `[01:00,07:00)` America/New_York, exact same-call final Missed and non-conflicting unanswered evidence are required. DST, unqualified short calls, unknown results, identity conflicts and duplicate precedence retain regression coverage.
- Object decision, Mongo eligibility/billing filters and billing aggregation expression were evaluated on actual persisted BSON, including malformed admission/review evidence and all 69 historical IDs. Official Booking/Cancellation planning remains independent of unsupported Call admission.
- Custom Reporting, Insights, analytics lead cost and receiver performance read the common effective decision/filter/expression. Master/source target selection, direct facade, expected tabs, No-Sync cleanup, exception projection and drainer delivery tests preserve destination-before-stale-delete ordering and retry. Synthetic Sheets APIs are used; no live customer workbook was tested.
- Desk facts/eligibility, job-holder counting, Pool admission and EntityChange handling remain operational contracts. `form_fill` alone does not close or merge a subject. Verified Form sibling mirroring retains receiver/priority, one Form job holder and replay safety. A jobless Call waits; a jobless Form keeps approved eligibility. Overnight reporting-bad does not become canonical `bad_lead`. Existing contact/rep credit rules are unchanged.
- Latest-four review: source-review alias adoption requires exactly one prior equivalent frozen action, same run/source/hash/annotation/target/order and exact accounted revisions; unrelated concurrent revisions fail. Replay evidence is restricted to the canonical cohort. Historical financial labels do not bypass exact owner/identity/money and successful-receipt checks. Frozen tests and local final-admission/replay harness pass; no production import operation was executed.

## Production read-only inventory

The audit scanned 1,821 reporting-admitted Calls. All 110 saved Form Fill flags had a current eligible Form under the corrected company/phone rule. **Zero missing Form Fill repairs and zero newly nonbillable Calls were proposed.** This is a current non-snapshot inventory, not a reconstruction of historical invoices or previously overwritten final observations.

Restricted dry-run manifest: worktree `ops/output/call-review/form-fill-preview.json` (ignored). SHA-256 `c298b9fa42eb88ad52b1fff276af41634289f1fdb855553c92862f0db8409b54`. It records the empty affected-ID list, expected revision/audit/outbox writes, disposition changes, replay guard and limitations. There was no apply. The read-only audit disables automatic model/index initialization and does not write to Mongo or Sheets.

Re-run explicitly with configured credentials without displaying them:

```powershell
node --env-file=<operator-env> --import tsx ops/call-billing-review/audit.ts --production-read-only --output ops/output/call-review/form-fill-preview.json
```

Any later nonempty preview must be rechecked against exact IDs/revisions and current Form evidence before using the existing owner-gated `repairCallFormFillForReporting` command. Never apply a stale preview or rerun Best Relocation ingestion.

## Validation

Commands load the repository test bootstrap, never production credentials, except the explicitly read-only audit above. Replica proofs use only loopback `127.0.0.1:27119`, replica `callReportingProof`, isolated `testvantagemovers_<suffix>` databases and synthetic data. They do not contact RingCentral, Granot, SMS or Google Sheets. The general default suite's skipped integration tests are not counted as replica passes.

- Initial focused Form Fill/final-result unit tests: 21 passed, no skips. Final expanded regression selection (Call ingestion, Sheets planner/recovery/targets, Granot sibling and Desk eligibility included): 98 passed, no skips.
- `ops/call-billing-review/replica.ts`: real canonical Form creation/correction; 62-Call continuation and replay; canonical isolation and legacy fallback; false-positive paging; concurrent arrival/drains; rollback; outbox fault/deferred retry; retained positive evidence; monotonic canonical result; billing/tab parity; Desk/financial continuity journeys.
- `RUN_CALL_ADMISSION_LOCAL_TEST=1` admission suite: 8 passed, no skips, including persisted malformed evidence and all 69 historical IDs.
- Explicit `ops/best-relocation-retirement/*.test.ts`: 85 passed, no skips.
- `review.replica.ts`: 9 passed, no skips. Harness now requires an isolated database and represents later correction with a later observation timestamp.
- `bestRelocationFinalLead.replica.ts`: complete synthetic admission, Booking gate, receipt adoption, revision accounting, interruption rollback and unchanged replay proof.
- `retirement.replica.ts`: complete synthetic retirement, lease/Owner checksum fencing, rollback, preserved company and financial history proof.
- Typecheck and lint passed. Full repository test glob, run with `--test-concurrency=3`: 3,957 tests, 3,795 passed, zero failures, 162 skipped. The default unrestricted-concurrency attempt was stopped after stalling under load; the bounded run completed in 583 seconds. Skips include opt-in replicas, and are not claimed as passed.

## Remaining release work and limits

Deploy/integrate the reviewed commit before starting efficiency changes. New collection `form_fill_work` has primary task IDs plus index `{due_at:1,_id:1}`. Existing `SHEET_SYNC_MODE=queued` and authenticated five-minute Sheet Sync cron provide recovery; no new env names or cron entry are required. Verify collection/index availability, cron `formFill.remaining/deferred`, and a synthetic/disposable workbook delivery after release. Transactional work persists across interruption; failures are delayed rather than discarded.

Rollback is the prior application revision; retain pending work and its collection, and resume it after redeploying the fix. Do not clear classification or admission, remove historical inventory or delete official financial rows. Rolling back leaves the original race/ceiling/ordering defects; saved positive classifications remain compatible with old readers.

No production repair is indicated by the current Form Fill inventory. Production deployment, physical post-release Sheets membership and historical final-result reconstruction are not established by this review. Previously overwritten Call Log evidence cannot be recovered from the current watermark alone. Direct compatibility corrections that emit no EntityChange lack the new correction scheduling guarantee; supported canonical callers do schedule. Form deletion, making an eligible Form duplicate and source/phone movement do not automatically clear retained positive Form Fill; any broader clearing/merging requires a separate Owner policy and identity/cadence design. No broader Desk/Sheet Sync efficiency implementation was performed.
