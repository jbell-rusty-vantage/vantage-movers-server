# W0 forecasting release subset — November 17, 2026

This note describes the isolated W0/W5 application release. It does not qualify the full capacity plan or claim production savings. Source/deployment identity and final exact-tree verification belong in the release record.

Systems capacity exposes seven-observation recent and up-to-thirty-observation long forecasts, selecting the larger measured growth rate. Disk allocation and allocated business data use the same headroom. Resizes, allocation decreases and gaps over two days restart the segment; invalid measurements, duplicate UTC days and stale history cannot manufacture a measured forecast. After a reset, a higher available prior measured rate remains an explicitly estimated fallback. The historical approximately 4 MB/day seed remains an estimate.

Oplog allocation and configured logical maximum are separate measurements; reclaimable bytes remain unknown. The existing nullable `breakdown` is null because the current Admin renders its reclaimable field as a numeric fact. Admin parsing/rendering was inspected and supports null. New `storage_evidence` and `forecast` fields are additive; a separate Admin change is needed to render them. Missing database allocation statistics fail the live read rather than undercounting capacity; stale cached readings produce unknown without runway.

Runtime scope is `systems/capacity.ts`, `readers.ts`, `databaseForecast.ts` and `workflowCounters.ts`. The counter module and optional response contract are included; workflow producer hooks are not. Consequently the workflow list is empty and `complete=false`, which means unobserved workload, not zero. Fleet metrics, per-member collection, synthetic/live alerts and bounded census tools from the wider implementation are outside this release.

No model/index/schedule/configuration change and no business, Sheet, Outreach or Granot write is introduced by W0. Forecast scope explicitly remains `connected_member`; worst-member capacity and failover attribution require separate evidence.

Independent integrated-tree focused verification is recorded in [release-slice review](RELEASE-SLICE-REVIEW-2026-11-17.md) and its linked log. Exact isolated-tree tests and production verification must be recorded separately; those prior results do not certify deployment. Forecast tests cover short/stale/missing history, accelerating growth, allocation drops, resize, internal reuse and member divergence without claiming fleet coverage.

Rollback keeps stored snapshots compatible and requires no data restoration. Reverting must not relabel allocated oplog storage minus logical maximum as measured reclaimable bytes. Per-member baseline, sustained growth, workflow coverage and alert qualification remain open parts of W0.
