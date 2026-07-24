# Best Relocation Sheet Ingest — Handoff

## Why this module exists

Best Relocation leads do not enter Vantage through the normal website or
RingCentral pipelines. Their source of truth is the Best Relocation lead
tracker, while bookings and refunds are recorded in the Booked Deal Form
Responses workbook.

This module closes that gap by reading those workbooks and preparing the
following records for the normal Vantage HTTP API:

- Every `Forms` row and every `Local Forms` row as a `FormLead`
- Every `Calls` row as a `CallLead`
- Every Best Relocation `Booked Deals` row as a `BookedLead`
- Every Best Relocation `Refunds` row as a `CancelledLead`

`Local Calls` remains intentionally out of scope.

The current implementation is a pre-service: it has production-capable parsing,
matching, planning, dry-run, and guarded apply behavior, but it is not yet
registered as an application cron job.

## Current module

The public interface is exported from `index.ts`.

| File | Responsibility |
| --- | --- |
| `types.ts` | Parsed row, match, collapsed booking, mutation, and ingest-plan types |
| `sheets.ts` | Read-only Google Sheets adapter for the required tabs |
| `parsing.ts` | Sheet row parsing, normalization, provenance, and BR source filtering |
| `matching.ts` | Lead-to-booking and refund-to-booking matching |
| `plan.ts` | Threshold filtering, booking collapse, payload mapping, and ordered plan construction |
| `dryRun.ts` | JSON and Markdown dry-run artifact generation |
| `apply.ts` | Guarded, resumable HTTP application through the production Vantage API |
| `bestRelocationSheetIngest.test.ts` | Parser, normalization, collapse, planning, and apply-safety tests |

The thin operator CLI is:

```text
scripts/best-relocation-sheet-ingest.ts
```

The package command is:

```bash
pnpm ingest:best-relocation
```

## Workbook scope

### Best Relocation lead tracker

| Tab | Behavior |
| --- | --- |
| `Forms` | Ingest every non-formula row as a long-distance `FormLead` |
| `Local Forms` | Ingest every non-formula row as a local `FormLead` |
| `Calls` | Ingest every row as a `CallLead` |
| `Local Calls` | Deferred; not read or ingested |
| `Key` | Ignored |

### Booked Deal Form Responses

| Tab | Behavior |
| --- | --- |
| `Booked Deals` | Keep only Best Relocation Forms, Inbounds, and Locals |
| `Refunds` | Keep only Best Relocation Forms, Inbounds, and Locals |
| `LID_BestRelo` | Read as supporting booking-membership evidence |
| Other tabs | Ignored |

The canonical source-company slug is:

```text
best_relocation_leads
```

## Parsing and normalization

Every parsed row carries provenance:

```text
{workbookId}:{tab}:{sheetRow}
```

The full workbook ID, workbook title, tab, row number, and raw row are retained
in the dry-run plan for auditability.

Important normalization behavior:

- Formula sentinel rows are skipped.
- Phone numbers use the application's phone matching normalization.
- Job numbers are uppercased and stripped to alphanumeric characters.
- Form move sizes are mapped into the canonical `MOVE_SIZES` enum.
- ZIP cells that lost leading zeroes through Google formatted values are padded
  back to five digits.
- Sheet UUIDs are accepted as lead IDs and retained as `ref_no`.
- Local Forms explicitly use the guarded Best Relocation import override so the
  server does not incorrectly classify them from ZIP-derived state data.
- Form creates use `post_to_granot: false`.
- Qualification flags are preserved on imported form and call leads.

Malformed required values fail plan construction. They are not silently
discarded, because silently skipping a lead would violate the ingest contract.

## Matching behavior

The lead matcher ports the exploration rules and stable method names:

1. `lid_exact`
2. `ref_no_exact`
3. `name_date_window`
4. `name_token_date_window`
5. `name_fuzzy_date_window`
6. `phone_form_bridge`
7. `call_same_day_unique`
8. `call_same_day_amount_tier`
9. `call_date_window_unique`
10. `lid_best_relo_only`

The default confidence threshold is `0.5`. A match is accepted when its
confidence is greater than or equal to the threshold. A booking below the
threshold is still stored, but through the leadless booking path.

The threshold can be supplied by:

```text
BR_MATCH_CONFIDENCE_THRESHOLD
```

or overridden for an operator run with `--threshold=<number>`.

The refund matcher uses, in order:

1. `job_no_agent`
2. `job_no_unique`
3. `job_no_customer`
4. `job_no_amounts`
5. `lid_exact`
6. `customer_book_date`

The verified exploration baseline is:

- 108 Best Relocation booking rows
- 91 matched booking rows
- 17 unmatched booking rows
- 12 of 12 refunds matched

After duplicate job numbers are collapsed, the current plan contains 104
booking documents: 88 attached to source leads and 16 leadless. The difference
between 91 matched rows and 88 attached booking documents is expected because
multiple split-agent rows can represent one job.

## Duplicate booking collapse

`normalized_job_no` is unique in MongoDB. Multiple sheet rows for the same job
therefore become one booking mutation.

The collapse:

- retains all source-row provenance;
- creates one or two agent allocations from the sheet agents;
- sums allocation binder amounts into `total_binder_amount`; and
- does not double a deposit repeated across split-agent rows.

The current production booking endpoints support one primary agent and one
split agent. Plan construction fails if a future job contains more than two
distinct agents, forcing an explicit product decision instead of losing an
allocation.

## Ordered ingest plan

`buildIngestPlan` creates mutations in dependency order:

1. Form leads
2. Call leads
3. Attached or leadless bookings
4. Cancellations

Each mutation includes:

- action;
- idempotency key;
- API method, path, and body;
- confidence and match method where relevant;
- dependency bindings for IDs created earlier in the run; and
- sheet provenance.

Form booking payloads and cancellation payloads contain readable `$ref:...`
markers in the artifact. Immediately before the HTTP request, `apply.ts`
replaces those markers with the Mongo IDs returned by earlier create or
preflight requests.

## Idempotency and apply safety

The current apply adapter does not write directly to MongoDB. It sends requests
to:

```text
https://vantage-movers-main-server.vercel.app
```

using:

```http
x-api-secret: process.env.VANTAGE_API_SECRET
```

Live apply is deliberately guarded:

- Dry-run is the default.
- The API secret is read only for live apply.
- The target is pinned to the official HTTPS production origin.
- Redirects are not followed.
- Only the five expected ingest endpoints are accepted.
- The reviewed plan file must match an explicitly supplied SHA-256 hash.
- The production hostname must be typed as the confirmation token.
- Existing forms and calls are searched before creation.
- Existing bookings and cancellations use filtered admin lookups rather than
  capped list endpoints.
- Booking job uniqueness remains the final database guard.
- Progress is checkpointed after every completed mutation.
- A failed run can resume from the checkpoint without replaying completed
  mutations.

The importer uses plan-level natural keys:

| Entity | Idempotency identity |
| --- | --- |
| Form lead | source company + sheet UUID/ref number |
| Call lead | source company + normalized phone + call date/time |
| Booking | normalized job number |
| Cancellation | source company + normalized booking job + refund row |

This is strong migration safety, but the future cron should move the same
idempotency guarantees into a durable application-run record or dedicated
server-side upsert interface so correctness does not depend on a local
checkpoint file.

## Related server contract changes

The implementation includes narrowly guarded support required by this import:

- Form lead creation accepts UUID LIDs.
- Form and call creates accept imported qualification flags.
- Local Form override requires `ingestion_source: "best_relocation_sheet"`.
- Leadless booking creation can preserve the exact sheet source label.
- Leadless cancellation is allowed only when the cancellation carries
  `ingestion_source: "best_relocation_sheet"`.

Normal callers do not receive a general local override or general leadless
cancellation policy.

## How to run the current dry run

From `vantage-main-server`:

```bash
pnpm ingest:best-relocation -- --dry-run
```

Optional controls:

```bash
pnpm ingest:best-relocation -- --dry-run --threshold=0.5
pnpm ingest:best-relocation -- --dry-run --limit-bookings=10
```

The command reads Google Sheets and does not send mutation requests.

Artifacts are written under:

```text
scripts/dev_ops/google_sheets/exports/best-relocation-booked-exploration/
```

The important files are:

```text
ingest-plan.json
ingest-plan-summary.md
ingest-plan.sha256
```

`ingest-plan.json` contains customer PII and raw sheet provenance. It is
gitignored, written with restricted file permissions where supported, and
must not be pasted into tickets, logs, or chat.

## Validation checklist

Before considering a production apply:

1. Run the focused tests:

   ```bash
   node --import tsx --import ./scripts/test-setup.ts --test \
     "src/services/bestRelocationSheetIngest/*.test.ts" \
     "src/services/cancellations/cancellationResolver.test.ts" \
     "src/validation/v1.validation.test.ts"
   ```

2. Generate a fresh dry run.
3. Confirm source counts against the workbook.
4. Confirm matcher parity:
   - 91 matched booking rows;
   - 17 unmatched booking rows;
   - 12 matched refunds.
5. Confirm the collapsed booking count and inspect every duplicate-job group.
6. Review all low-confidence matches, especially methods at `0.5`–`0.64`.
7. Review all leadless bookings.
8. Confirm all refunds point to the intended normalized job.
9. Validate every planned body against its production Zod schema.
10. Record the exact `ingest-plan.sha256` value used for approval.

The repository-wide `pnpm typecheck` currently reports unrelated pre-existing
errors in historical/dev-ops scripts. The Best Relocation focused tests and
payload validation must still be clean before approval.

## How to perform a reviewed one-time apply

Do not regenerate the workbook plan during apply. Apply the exact file that was
reviewed:

```bash
pnpm ingest:best-relocation -- \
  --apply \
  --plan=scripts/dev_ops/google_sheets/exports/best-relocation-booked-exploration/ingest-plan.json \
  --plan-sha256=<reviewed-64-character-hash> \
  --confirm-production=vantage-movers-main-server.vercel.app
```

The default checkpoint is:

```text
ingest-plan.json.apply-progress.json
```

If the process stops, rerun the same command with the same plan and hash. It
will validate the checkpoint and resume after completed mutations.

Do not run live apply until the server code containing the required validation
and cancellation behavior has been deployed to the production URL.

## Official workbook environment variables

The scheduled application service must use these official variables:

```dotenv
BEST_RELOCATION_SYNC_SHEET_ID=
BOOKED_DEALS_FORM_RESPONSES_SYNC_SHEET_ID=
```

These names replace the temporary backfill-oriented names used by the current
reader:

```text
BACKFILL_BEST_RELOCATION_SHEET_ID
BACKFILL_BOOKED_SHEET_ID
```

The cron implementation must not rely on hard-coded workbook IDs. During the
next phase, `sheets.ts` should require the official variables in application
runtimes. Temporary aliases may be retained only for the operator CLI during a
short migration period, with an explicit deprecation note.

## Next part of the plan: recurring 4- or 6-hour cron ingest

The next phase is to turn this pre-service into an application-owned,
idempotent synchronization job.

Recommended rollout:

1. **Deploy and review the one-time import path first.**
   - Deploy the current server contract changes.
   - Generate and manually review a fresh plan.
   - Run one guarded production apply.
   - Verify Mongo records, source-lead links, bookings, cancellations, and
     sheet-sync side effects.

2. **Switch workbook configuration to the official variables.**
   - Require `BEST_RELOCATION_SYNC_SHEET_ID`.
   - Require `BOOKED_DEALS_FORM_RESPONSES_SYNC_SHEET_ID`.
   - Remove hard-coded production workbook fallbacks from the application path.

3. **Extract an application sync façade.**
   - Keep the current parse, match, collapse, and planning modules.
   - Add one small interface such as `runBestRelocationSheetSync(options)`.
   - Return a run summary instead of printing or writing local files.
   - Accept Sheets, persistence/idempotency, logging, and clock dependencies so
     the run can be tested without production services.

4. **Add durable sync-run and mutation state.**
   - Record run ID, start/end time, workbook IDs, row counts, threshold,
     outcome, and errors.
   - Persist each source-row key/idempotency key and resulting Mongo ID.
   - Resume incomplete runs safely.
   - Prevent overlapping cron executions with a durable lease/lock.
   - Preserve exact source-row provenance and last-seen timestamps.

5. **Use server-side idempotent upserts.**
   - Form: source company + sheet UUID/ref number.
   - Call: source company + normalized phone + exact call timestamp.
   - Booking: normalized job number.
   - Cancellation: booking + stable refund source-row key.
   - Treat unchanged rows as no-ops and changed rows as explicit updates,
     never duplicate creates.

6. **Register a protected cron route.**
   - Follow the repository's existing cron-route conventions.
   - Authenticate the scheduler separately from `VANTAGE_API_SECRET`.
   - Keep the route thin: acquire lock, invoke the sync façade, return summary.
   - Add timeout, bounded retries, structured logs, and operational events.

7. **Start at a 6-hour interval.**
   - Recommended initial schedule: `0 */6 * * *`.
   - Six hours limits production churn while the new sync is observed.
   - After several clean runs, change to four hours (`0 */4 * * *`) if the
     business needs faster booking/refund visibility.

8. **Add monitoring and alerting.**
   - Alert on failed or overlapping runs.
   - Alert when parsed counts unexpectedly drop to zero.
   - Alert on unmatched refunds, new parser failures, duplicate-job conflicts,
     or a sharp rise in leadless bookings.
   - Expose the latest run and mutation summary through the existing
     observability/admin patterns.

9. **Test cron behavior before enabling it.**
   - Two identical runs create no additional records.
   - A newly appended lead creates exactly one lead.
   - A newly appended booking attaches exactly once.
   - A new refund creates exactly one cancellation.
   - A failed partial run resumes without duplication.
   - Concurrent triggers result in only one active run.
   - Workbook edits and malformed rows produce auditable errors.

The cron must continue to ingest only Best Relocation data. Its purpose is to
compensate for the absence of RingCentral and website ingestion for this source,
not to become a generic Booked Deal workbook importer.
