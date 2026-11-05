# Release handoff — Granot cadence

**Owner authorized release on November 5.** See [release review](RELEASE-REVIEW-2026-11-05.md) for the additional Priority-only Sheet suppression, fresh validation, production no-op baseline and release status. Sustained live capacity remains unqualified. See [implementation evidence](IMPLEMENTATION-LEDGER.md) for the original test limitations and write budget.

## Review identity

Base `d63e512d0f1c157648b10dda41abe61742e3aadd`, remote `jbell-rusty-vantage/vantage-movers-server`, review branch `codex/granot-frequency-efficiency`. [File checksums](PATCH-FILES.sha256) identify the original November 4 handoff, not the subsequent review fixes; the integration commit is the authoritative final patch. The November 5 Owner instruction authorizes commit/push to main and the resulting release.

Runtime changes are confined to `GranotEstimatesScheduleSlot`, the automation cron route, collector schedule/Pool/run workflow, shared Form sibling mirror, Outreach feed and Lead-change consumer. Tests include disposable joined pair and collector runners, contact convergence, and updated existing fixtures. The packet, owning docs and `.cursor/rules/granot-http-automation.mdc` are updated. No Admin, extension, other repository, `vercel.json`, RC schedule, staffed window, reservation, settlement allowance, contact goal or cadence map changed.

Validation: 1,530 targeted tests passed (121 opt-in skips), 17 scoped replica tests passed without skips, and joined pair, subject and contact replica harnesses passed. Lint and tracked-source typecheck passed. Full-suite and ignored-artifact typecheck exceptions are detailed in the ledger.

## Compatibility and release

- No new environment name, collection, index build or production migration. Existing feature/credential/queue gates remain authoritative.
- Optional immutable manifest `scheduled_at` is set on new inserts. Old manifests decode their existing local slot key in memory; no backfill or read-time mutation.
- Run/action identity, frozen date coverage, account lease, 120-second work budget and 25-action bound remain intact. Existing pending runs resume without recapture.
- Freshness preserves existing fields and adds enabled/expected/grace-elapsed/collected/synchronized timing and unapplied diagnostics. Admin's existing non-strict Zod object accepts additive fields and nullable `latest_expected_slot`; no parser edit is required. Its old schedule explanatory copy remains a separate cosmetic follow-up, not an API blocker.
- Related Form jobs use the existing stage/collection and explicit `[formId, callId]` refs; consumer checks the live marker and refreshes existing open subjects only. Deployment should contain feed and consumer together.
- Unit/replica evidence and broad-suite failures are in the ledger. Resolve or explicitly account for those failures in release review; do not present a clean whole-repository test gate.

## Required live qualification after authorized deployment

1. Record deployed SHA and active gates. Observe representative daytime and overnight ALL slots and the 06:00 ALL/refresh/discovery overlap. Check declared windows and old-date coverage rather than only run status.
2. Separate collected coverage, applied effects, suppressed/held/failed receipts and oldest pending work. Verify sustained misses remain late across subsequent hourly triggers and that disabled Pool has no expected-lane overdue warning.
3. Verify an existing held Form clears after the committed marker job and a previously delivered exception Call receives its current exported Job/receiver in its exclusive destination. Do not run a historical bulk repair or import.
4. Measure slot duration, account lease busy/expiry, pending automation/Lead-change/contact/evaluation age, accepted Lead→subject→projection latency and RC capture/derivation coverage. Recurring work must clear within the new interval with headroom.
5. Measure Mongo write latency/throughput, decisions and observations per slot, collection/index growth and projected retained bytes/day. Business no-ops do not remove immutable fresh-observation evidence. The 39→234 base ALL scans/day calculation excludes Pool and older dates. Do not call this storage-efficient enough for production without these measurements.

No recurring monitor was created. Live qualification may span real boundaries beyond this engineering session.

## Rollback

Restore schedule admission to 08/13/18 New York in the shared hour list while keeping the new compatible readers, recovery and consumer. Do not revert the whole binary blindly after related jobs or new-hour manifests exist. Preserve manifests, child/action identities, jobs, receipts, accepted temporal evidence, marker relations, reporting admission, periods and financial history. Retain independent daily 06:00 discovery. Do not purge evidence, reset periods, reopen closed subjects, delete Leads, broaden the November backfill or rerun Best Relocation ingestion.
