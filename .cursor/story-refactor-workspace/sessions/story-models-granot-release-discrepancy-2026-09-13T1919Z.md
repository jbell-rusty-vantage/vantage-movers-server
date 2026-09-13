# Session story-models-granot-release-discrepancy-2026-09-13T1919Z

- Date (UTC): 2026-09-13T1919Z
- Service / module: `models` / `GranotReleaseDiscrepancy.ts`
- Lock: taken
- Branch / PR: `docs/story-refactor` / https://github.com/jbell-rusty-vantage/vantage-movers-server/pull/206

## Stock at start

- Wave: B
- Visited / in-progress / unvisited: 43 / 1 / 4
- Recommendations on disk: 366
- Current service / next module (TRAVERSAL): `models` (in-progress) / `GranotReleaseDiscrepancy.ts`

## This pass

- opened new service?: no
- path or skip: recommended → [recommendations/models-granot-release-discrepancy.md](../recommendations/models-granot-release-discrepancy.md)
- operations named: hold the Release identity-conflict desk on `granot_release_discrepancies` (four `release_*` reasons only; not a Booking case, not the leftover Release case, and not a Cancellation); bind the selected Mongo database and declare the two named indexes with partial unique open `{ normalized_job_no, discrepancy_kind, reason_fingerprint }` plus state/newest-evidence queue. No sequence unique. Live missing-Booking Release is booking intake, not this desk. Officially cancelled plus Release is already current, not this desk. Fingerprint and mongoose guards stay on leftover persist / leftover later factory.
- remaining in this service: `granotLifecycleSchemas.ts` first, then the rest of the models checklist

## Stock at end

- Visited / in-progress / unvisited: 43 / 1 / 4
- Current service / next module: `models` (in-progress) / `granotLifecycleSchemas.ts`

## Messages posted

- 2026-09-13T1919Z next

## Ideas parked

- none

## Contradictions

- Two named indexes; Booking case has six; leftover Release case has five
- Unique is open fingerprint, not `{ normalized_job_no, action_kind }`
- No sequence unique; resolved + same fingerprint may insert a new row
- Four Release reasons here; `types.ts` also unions the five Booking reasons
- No `release_booking_lead_conflict`; no `release_after_official_cancellation`
- Live missing-Booking Release is booking intake; `release_without_vantage_booking` is leftover historical
- Officially cancelled + Release is already current; officially cancelled + Booked is the Booking desk
- Processor maps this collection by `reason_code.startsWith("release_")` from `booking_discrepancy_required`
- Fingerprint hashed on leftover persist, stored here as 64 hex
- Unique is exact Job while open; Job Timeline hops prefix-equivalent Jobs
- schema-and-crud names the Booking case and omits this collection
- No mongoose delete hook; Decision / activation clock refuse delete
- Hooks live on leftover later `granotDiscrepancyModel.ts`; this unit test only refuses Booking reasons and names two index names (does not deep-equal catalog or assert `autoIndex: false`)
- Replica unique-open 11000 proof is Booking-only even though it creates this catalog’s indexes
- Leftover Owner Re-evaluate still asks `reconcileReleaseCaseAfterDiscrepancy` when `kind === "release"`
- Leftover next granotLifecycleSchemas.ts is a different row — do not copy this Release-desk catalog onto it without reading it
