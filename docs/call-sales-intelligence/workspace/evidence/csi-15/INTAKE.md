# CSI-15 intake — September 19, 2026

Historical backfill windows, retention, and budget/recovery integration. Team F. Not CSI-16, not production backfill, not flag enablement, not live send, not CSI-14 dialogs, not the CSI-10 empty-recording repair.

| Contract | Executable starting state | Required work |
| --- | --- | --- |
| Window model | `SalesIntelligenceSyncWindow` unique `{stream,window_from}`; statuses planned\|running\|complete\|partial\|failed | Owner plan writes daily `planned` windows. Cron steps oldest `planned\|partial` with per-page checkpoint. `complete` only after last page. |
| Plan command | `csiBackfillCommandSchema` (`from` < `to`, reason, expected_revision) | Owner `POST /backfill`, Idempotency-Key, `scope=production`. `SALES_INTELLIGENCE_BACKFILL_DAYS=0` plans nothing. |
| Capture pages | `runCallLogReconcileOnce` + `applyInteractionObservation` source `"backfill"` | Do not hold live reconcile lease and a backfill page together. Live lease wins. Never move `known_complete_through` backwards. No qualified-call helper. |
| Coverage | CSI-09 hardcoded `backfill.available: false` | Stored window/watermark facts: planned/partial/complete/failed plus gaps. Unknown ≠ zero. Never mock success. |
| Outreach | CSI-06 `ensureLead` / `ensureInteraction` / official close / `fulfilledByCall` | After a window completes, reconcile later known activity before activating historical obligations. No revived overdue first-action / missed-callback / going-cold. Timeline `happened_at` stays source time. |
| Analysis | `mode: backfill` already on runs; `claimCsiJob` sorts `priority DESC` | Backfill-mode jobs lower priority than current STT/analysis. Raising the cap resumes the saved stage. |
| Retention | Policy defaults 90/365/730; CSI-18 already tombstones purged reads | Daily cron lease `retention` (always registered, no-op when ENABLED off). Purge audio Blob + redacted copies; leave non-content audit tombstones; original-evidence rerun is `ORIGINAL_EVIDENCE_UNAVAILABLE`. Privileged raw collection writes, not application immutability hooks. |
| Budget/recovery | `failCsiJob` already pauses permission/budget/throttle without burning attempts; period init and ceiling increase resume paused jobs; minute recovery drains Mongo jobs | Integrate expired lease, missing queue wake-up, throttle Retry-After, permission pause, dead-letter at the failed stage, resume of budget-paused analysis. Admission pause is not a generic failure. |

Verified remotes `jbell-rusty-vantage`. Work on local `main` HEAD `d55f6c2b1eb2bed276d0b5bc8c6d2a5bc065fd7c`. Isolated replica `csi01` / `127.0.0.1:27189`, disposable `testvantagemovers_csi15…`. Fake Call Log / Blob / budget only.

Implementation clarification: capture completion and activation completion are separate stored facts. Historical attachment scans and later planned capture must finish before activation; all complete capture windows can still await activation. Coverage exposes that distinction in its note. The six-file packet records final scope and validation without changing the pre-existing next-session/sprint/Team F/CSI-16 documents. [FILES](FILES.md) identifies preserved external changes. Local `main` is required by this mission despite the older handoff template's branch wording.
