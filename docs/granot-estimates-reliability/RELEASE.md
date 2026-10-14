# Estimates reliability and canonical backfill

Owner-approved October 14, 2026. Pool membership, shared Pool work and Pool rollout remain outside this release. Parsing Granot's displayed `prior: Pool` as canonical Priority 9 is part of reading all priorities correctly; it grants no new Outreach Desk entitlement or cadence.

## Delivered behavior

- Validate actual Follow-Up Estimates form controls, mandatory report columns, row alignment, explicit empty results, rendered totals and safe pagination. Use bounded date partitions and adaptively split the provider's alternate large-result rendering. Invalid single-day results fail rather than assert completeness.
- Read exact reference/Job Number, source/user, primary and secondary contact evidence, provider Open Date, move facts and cubic feet. Resolve the Registry before matching. Estimates preview uses canonical normalization, source policy and identity; the write-time transaction remains authoritative.
- Match sparse qualified Call Leads without duplicate siblings becoming false competing eligible phone matches. Protect established conflicting Jobs, Source Scope, genuine ambiguity, submitted contact and manual assignments.
- Preserve Priority 1/5 quote/contact/move authority. Automatically assigned receivers can follow a newer qualified Granot user under the existing latest-wins policy. Canonical EntityChange drives desk assignment and priority-period changes.
- Seal actual collection time and reuse it for application. Existing pending receipts retain their original time; incompatible legacy fresh actions need recollection.
- At 08:00, 13:00 and 18:00 America/New_York, schedule the trailing 90 Open Dates in deterministic runs of at most seven days, plus conservatively scanned older months with verified provider Open Dates. Persist date evidence separately from Lead identity. Unknown historical dates remain an explicit coverage limitation.
- Give fresh collection, new approved actions and eligible retries bounded fair progress. Apply resumable batches of 25 actions within a 120-second work budget.
- Owner `GET /api/v1/admin/granot-automation/runs/freshness` and the Admin Automations card distinguish full collection, pending processing, held rows, failures and late coverage.
- Queue priority display/filtering follows the current subject priority independently of the cadence period's historical basis. Accepting Priority 0 after an intake-default start, or changing 2 to 3 within Daily, does not reset periods or deadlines. Successful Estimates receipts also nominate an idempotent refresh/evaluation of existing open desk subjects, including canonical Lead no-ops; this path cannot admit or reopen a subject.

## Read-only provider proof

The local credential context already referenced by `granot:collect` was loaded without displaying its values. Live provider reads held the existing `granot:automation:account` distributed lease. The only production database operations in the provider rehearsal were lease acquire/renew/release; business inventory used signed GET APIs. Raw HTML stayed outside the checkout.

At `2026-10-14T17:12:03Z`, the new collector reconciled **7,690 transactions** from April 23 through October 14 across **26 complete result partitions**, using **32 total HTTP requests including authentication**, in **32.6 seconds** on the local machine while tests were running. Every partition's row count equalled its rendered total. One seven-day partition required adaptive splitting because Granot switched its large-result rendering. These are read/parse measurements, not planning/apply runtime claims or an atomic provider snapshot.

All rows supplied Job Number, primary phone, source, user, observed priority and Open Date. References appeared on 4,251 rows; emails on 7,687. City/state pairs were legitimately absent on some rows. No parser holds remained after verifying the live `9 = Pool` selector and recognizing its exact displayed token. Unknown or conflicting priority text still stays held.

Signed canonical inventory observed 7,090 ordinary Form Leads and 1,561 ordinary Call Leads with traversal counts matching reported totals. Their earliest observed ingestion was April 30, which is not provider Open Date. More than 3,000 records without closure flags were older than 90 days; this justified discovery/backfill beyond the recurring floor. Neither ordinary browse nor Follow-Up Estimates establishes complete Booking coverage or absence of a Booking.

Earlier-date discovery on the same day reconciled a further **404 transactions** from January 1 through April 22, using 21 HTTP requests in 6.6 seconds. A separate January 1, 2000–December 31, 2025 Follow-Up query returned an explicitly verified total of zero. Consequently the production backfill scope is **January 1–October 14, 2026**, rather than inferring Open Date from Vantage's April ingestion boundary. These observations remain report-scoped, not proof about other Granot report types or an atomic account snapshot.

## Configuration and compatibility

The existing production `SALES_INTELLIGENCE_RECEIVER_LATEST_WINS` binding is set to `true` for the next deployment. No new environment variable is required. Manual and source-less receivers remain protected. Josh's saved work schedule excludes Wednesday and is intentionally preserved; Granot assignment does not create a daily goal.

`granot_estimates_open_dates` is additive discovery evidence keyed by the existing unique `_id`; no index migration is needed. Existing run/receipt identities remain intact. Missing collection-time metadata prevents new approval/application of old fresh actions; existing receipt retries drain against their original canonical receipt. The Admin freshness read is additive and shows unavailable status against an older server.

## Operational commands

Run from the server checkout. Credentials stay in the process; manifests contain IDs, checksums, counts and field names, never contacts or monetary values. Put manifests outside every Git checkout.

```powershell
# Read/parse rehearsal: touches only the shared account lease and provider report reads.
node --env-file-if-exists=../agent_granot_credentials/.env --env-file=.env --import tsx ops/granot-estimates/provider-read.ts --run --verified --from=04/23/2026 --to=10/14/2026

# Existing canonical inventory through signed GET APIs.
node --env-file=.env --import tsx ops/granot-estimates/backfill.ts --run --mode=inventory

# Resumable complete previews, each at most seven Open Dates.
node --env-file=.env --import tsx ops/granot-estimates/backfill.ts --run --mode=preview --from=04/23/2026 --to=10/14/2026 --manifest=C:/private/estimates-backfill.json

# Apply only the exact reviewed action manifest and sealed plan checksums.
node --env-file=.env --import tsx ops/granot-estimates/backfill.ts --run --mode=apply --manifest=C:/private/estimates-backfill.json --review-checksum=<printed-checksum>

# Receipt outcome inventory; desk/Lead convergence needs the corresponding signed reads too.
node --env-file=.env --import tsx ops/granot-estimates/backfill.ts --run --mode=verify --manifest=C:/private/estimates-backfill.json
```

An interrupted HTTP response is not evidence that a mutation failed. Resume from the retained manifest and stored run state; never create replacement actions merely because a response was lost. Explicit conflicts/unmatched/source-policy holds remain review items rather than being forced into Leads. Follow-Up report absence never cancels or closes a Lead.

## Validation and rollback

Focused parser, canonical preview, identity, temporal ordering, scheduling/fairness, API/client and Admin freshness tests cover the changed behavior. Real isolated Mongo replica proofs cover sparse Call job attachment, automatic reassignment, quoted/cubic-feet enrichment, canonical EntityChange, real desk subject/period evolution, receipt replay and batched worker continuation. The release record must distinguish these local proofs from production verification.

Rollback stops new schedules/approvals and restores the previous deployed application/configuration as needed. Preserve accepted receipts, date evidence and historical desk periods. Do not restore a whole database or reverse manually reviewed assignments wholesale; erroneous accepted facts require exact reviewed compensating canonical changes. Keep the older Leads & Advertising path available for Booked Jobs and fallback coverage.
