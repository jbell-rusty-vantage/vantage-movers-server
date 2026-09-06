# Session story-reporting-destination-contract-2026-09-06T0611Z

- Date (UTC): 2026-09-06T06:11Z
- Service / module: `reporting` / `destinationContract.ts`
- Lock: taken
- Branch / PR: `docs/story-refactor` / https://github.com/jbell-rusty-vantage/vantage-movers-server/pull/195

## Stock at start

- Wave: A
- Visited / in-progress / unvisited: 27 / 1 / 10
- Recommendations on disk: 193
- Current service / next module (TRAVERSAL): `reporting` (in-progress) / `destinationContract.ts`

This checkout booted on `cursor/vantage-server-story-refactor-5c64` with a stale seed `NOW.md` (`reporting` / `timezone.ts`, 192 recs, PR #193). Disk on `docs/story-refactor` at `12e9a4b` already had 193 recommendations through `reporting-timezone.md`. `reporting` was in-progress. PR #195 was already open. Accidental #194 stays ignored.

## This pass

- opened new service?: no
- path or skip: recommended `destinationContract.ts` → [recommendations/reporting-destination-contract.md](../recommendations/reporting-destination-contract.md)
- operations named: load this destination live (`getReportingDestinationPort` / Fake default / leftover Stage-4 install); prove this cited snapshot still holds (`validateDestinationSnapshot`: checksum, id, strategy, safety, freshness, capacity); fingerprint the full snapshot versus the stable identity (`destinationSnapshotChecksum` includes health; `destinationStableIdentityChecksum` does not); cite a saved destination record without going live (`snapshotChecksumFromDestinationRecord`: null if unverified). Not leftover destination desk, not leftover lineage, not leftover worker write.
- remaining in this service: `destinationLineage.ts` next, then leftover destination / query / worker / google / live modules on the checklist

## Stock at end

- Visited / in-progress / unvisited: 27 / 1 / 10
- Current service / next module: `reporting` (in-progress) / `destinationLineage.ts`

## Messages posted

- 2026-09-06T0611Z next-run

## Ideas parked

- none

## Contradictions

- Leftover estimate / confirm do not require live checksum === frozen revision checksum; leftover lineage decides. Preview / freeze cite the draft checksum.
- Two checksums: full snapshot includes health stamps; stable identity does not. Capacity stays on the stable digest.
- `snapshotChecksumFromDestinationRecord` trusts Mongo and forces safety flags false. Leftover desk goes live then hashes.
- Process default is Fake. Missing leftover `registerReportingStage4Foundation` talks to an empty map.
- Leftover live harness stores `snapshotChecksum` in the `destinationStableIdentityChecksum` field.
- 24-hour max-age is hardcoded here. Future skew is leftover config (5 minutes).
- This checkout’s `CONTEXT.md` does not define Reporting / Reporting Sheets. `docs/adr/` is absent (knowledge cites ADR-0001).
