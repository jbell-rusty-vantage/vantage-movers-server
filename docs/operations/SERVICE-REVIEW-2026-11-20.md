# Service review, November 20

On November 20 the Owner asked for a review of the November 17–19 upgrades across Sales Outreach, Sheet Sync, Granot automation runs and Lead updates, and RingCentral. The review also had to confirm that dropping the hidden redundant indexes is safe. Four independent reviewers read the commits for each service. Each finding below was checked against the code and, where possible, against production with read-only queries.

## Outcome

| Service | Critical | Important | Status |
|---|---|---|---|
| Sales Outreach | 0 | 0 | Sound. One minor capacity regression. |
| Sheet Sync | 1, fixed in PR #237 | 3, latent in the current workbook | The fix is on `main`. One design follow-up remains. |
| Granot runs and Lead updates | 0 | 3, measured zero current impact | Fix them first in the next session. |
| RingCentral | 0 | 0 | Sound. |

## Production state at review time

The production reads ran around 04:13 UTC on November 20, which is 23:13 New York on November 19.

- **Sheet Sync:** 164,294 jobs synced and 3 cancelled. None were pending, retrying, processing or failed. The last drain ran 4 minutes before the read.
- **Sales Intelligence and Outreach jobs:** zero pending, leased, retry, paused or dead-letter jobs. 98 jobs completed in the past hour, and no Outreach refresh was waiting.
- **Granot:** 13,031 receipts completed. One receipt was in `retry_scheduled`. It is a `priority_updated` webhook with `pending_source_scoped_match`, 6 match attempts and 0 technical attempts. That is the intended retry while its Lead is not yet in MongoDB.
- **RingCentral:**
  - 34 webhook receipts arrived in the past hour.
  - The newest receipt stored its raw body, with no stored preview and no credential header. Zero exceptional fields have appeared since the November 19 release.
  - All 37,501 Call Interactions carry the single configured `provider_account_id`. The account-scoped Lead linkage therefore drops no historical session.

## Sheet Sync

**Critical, fixed: formula-stored phone cells blocked row removal.** Google stores a `USER_ENTERED` value with a leading `+`, such as an E.164 phone number, as a formula. The removal check from `62653f03` (`src/services/sheetSync/drainer/batchWriter.ts`) treated any formula cell as operator content. A removed row was therefore kept, and its formula phone cell was never cleared, leaving a phone number with no Mongo ID behind.

A read-only scan of all eight tabs found formula-stored managed cells on these rows:

| Tab | Rows with a formula-stored cell | Total rows |
|---|---:|---:|
| Calls | 1,410 | 1,677 |
| Duplicate Calls | 287 | 359 |
| Bad Call Leads | 3 | 19 |
| Forms | 1 | 8,380 |

No row with content but no Mongo ID existed yet, so nothing needs repair. The fix treats formulas in managed columns as managed values, because every upsert overwrites those columns anyway. The fixture now models formula storage, and two regression tests fail on the old code. All 90 Sheet Sync and Google Sheets unit tests pass. [PR #237](https://github.com/jbell-rusty-vantage/vantage-movers-server/pull/237)

**Fixed November 20: phone numbers stored as formulas.** The Owner reported `#ERROR!` phone cells on Bad Call Leads and Duplicate Calls. Rows are written with `USER_ENTERED`, so Sheets parsed a leading `+` as a formula. `+15555550123` showed as the number `15555550123`, and `+44 (0)20 7946 0018` showed `#ERROR!`.

**Fix.** PR #240 (`70581961`) writes Form and Call phone cells through `textCell`, which adds the same leading apostrophe the Form bad-reason cell uses.

**Repair.** `ops/capacity/repair-formula-phone-cells-2026-11-20.ts` queued the ordinary Sheet Sync re-delivery for every affected Lead, using `sheet_phone_text_repair` jobs created by `script`. The drainer rewrote each row from canonical state. Evidence is in `docs/operations/evidence/formula-phone-repair-*.json`.

| Tab | Formula phones before | After |
|---|---:|---:|
| Calls | 1,412 | 4 |
| Duplicate Calls | 287 | 1 |
| Bad Call Leads | 3 | 0 |
| Forms | 1 | 0 |

- **Throughput:** 1,711 repair jobs synced between 10:32 and 10:55 New York, in batches of 291, 500, 500 and 420.
- **Live traffic:** a live `form_lead.create` queued during the first Calls batch completed in the same drain.
- **Sheet display:** after the repair, no tab shows `#ERROR!`. International numbers display as typed.

**Owner decision needed: excluded legacy Calls on the Calls tab.** The five rows left over are not repair failures. Their Leads are excluded under the RingCentral-only rule: `getCallLeadReportingDecision` returns `excluded`, `billable: false`, reason `missing_call_reporting_admission`. They have no saved queue qualification and no preserved admission. All five are `ingestion_origin: legacy_unknown` and were created in one batch on June 9, 2026:

- Calls rows 234, 235, 246 and 247 (`top10_leads`).
- Duplicate Calls row 23 (`tbm_leads`).

A re-delivery of an excluded Lead plans no destination and removes nothing, so these historical rows stay where they are. Four of them are on the Calls billing tab, where the Owner's rule allows only qualified Calls. Server reporting and billing filters already exclude them.

The Owner should choose. Either remove these rows through the canonical delete path, or have Sheet Sync remove the rows of any Lead whose disposition is `excluded`. Also check whether other excluded Leads hold rows on any tab, because this scan only found the ones with formula phones.

**Latent in the current workbook. Revisit before an operator edits tab layouts.**

- **Protection:** a whole-tab or whole-column protected range makes every removal on that tab fail with `sheet_delete_protected_row`. The check ignores editors and warning-only protections. No tab has a protected range today.
- **Operator content:** a whole-column dropdown, or old values under columns whose header is blank, counts as operator content, so the row stays with blank managed cells. The live scan found zero validation cells and zero values beyond the header on every tab.
- **Header changes:** delivery now refuses any header row that lacks the full managed header list (`sheet_identity_header_rewrite_unsafe`). Adding a managed column in code will therefore stop delivery to that tab until someone edits the header. A release that adds a column must update the tab headers first, or add a supported migration step.

**Pre-existing, not a regression.** A worker killed outright leaves its jobs in `processing`. The claim query only selects `pending` and `retrying`, so those jobs need operator requeue. The live count was zero.

## Granot runs and Lead updates

These three findings all come from `5137f06f`, which applies scheduled Lead changes directly.

1. **Record Links:** a scheduled run no longer establishes the Record Link for a Lead that is already current. Planning marks every non-applied action `unchanged` (`estimatesIdentityPlanning.ts`). The webhook processor still links an `already_current` Lead.
2. **Form→Call sibling mirror:** the scheduled run no longer catches a Call up from its Form. `scheduledLeadChange.ts` mirrors job, priority and receiver only after an `applied` Form change. A Call Lead that qualifies after its Form already holds the job now gets the job only from a later Granot webhook or Form change. Only the webhook processor and scheduled apply call `mirrorFormLeadToCallSibling`.
   - Measured on November 20: 42 qualified, non-duplicate, jobless Call Leads arrived in the past 30 days. None has a same-source Form sibling holding a job, so nothing is waiting on this path today.
   - This weakens the Owner's October 28 sibling rule. Restore it by mirroring for `already_current` Form rows, or by mirroring when the RingCentral queue creates the Call.
3. **Post-commit retries:** a persistent failure after commit blocks the rest of the run. In the scheduled path the Lead-link wake and the sibling mirror are awaited with no time bound, and an error escapes (`scheduledLeadChange.ts`). The run then retries that action first on every pass, with no attempt cap, until the 24-hour run expiry. The webhook path bounds these steps to 2 s and never throws. Use the same bound and never-throw rule here.

**Minor.**
- When the Lead command hits a Record Link conflict, the scheduled path turns it into a skip. That aborts the transaction, so the dispute is never saved, though the run records `conflict` every hour.
- After-commit Daily Operations facts are skipped on idempotent replay. This affects both paths and predates `5137f06f`.

**Verified correct.**
- Scheduled apply re-runs identity inside the transaction, and it never creates a Lead or uses Call `create_if_missing`.
- Retries replay by deterministic ID.
- The Outreach priority refresh and the Sheet Sync intent commit in the same transaction.
- Every archive deletion follows a GCS read-back of the stored generation and SHA-256, plus reference holds.
- Closed runs cannot be recreated.
- Lookups by original ID fall back to the archive.
- Conditional GCS expiry refuses while any locator points at the object.

## Sales Outreach

**Minor.**
- Since `c4176fab`, a routine job that was retried once (`held.reason = "transient"`) no longer gets the three-day purge. It stays until the 14-day TTL. This affects capacity only.
- When the overlap fast path finds an existing job, it skips `enqueueCsiJob`'s retired-stage fence and its transaction assertion. Today that is harmless, because the stage is fixed and the pass is transactional.
- The `existingJobMatches` branch has replica coverage only.

**Verified correct.**
- **Refresh generations:** the single-update request keeps lease, claim and `requires_projection`, and a claimed generation is never lost.
- **Overlap read:** it runs in one session-bound `$in` read that checks deployment, database and payload hash. It reports conflicts and rolls back on a throw.
- **Compact receipts:**
  - Their conversion is fenced by lease, owner, epoch, raw `_id` and hash, and they keep their dedupe identity.
  - A receipt can never be claimed: a late wake returns `not_claimable` and a deleted job returns `unknown_job`.
  - Only `outreach_lead_change` keeps its result, because the admissions store reads it.
- **Retired stages:** they are rejected at enqueue, claim and dispatch.
- **Command compaction:** no Outreach reader depends on it.
- **Contact derivation:** it honours the configured account, and assignment reads are unchanged. All 54 non-replica unit tests pass.

## RingCentral

**Minor.**
- **Summary recount:** it is now skipped when the stored summary is well-formed and the call's contribution is unchanged. A summary that is wrong but well-formed would stay wrong until the next counted change. No current writer leaves one stale.
- **Account check:** it applies only when `RINGCENTRAL_ACCOUNT_ID` is set. Production sets it.

**Verified correct.**
- **Webhook verification:** the route still verifies `verification-token` on the incoming request before storage. No later reader needs a stored credential header or preview.
- **Summary contribution check:** it covers every summary input.
- **Delayed Call Log refresh:** legacy jobs are reused only within the same account, and a foreign Detailed record ends as `account_mismatch`.
- **Duplicate detection:** a capture or mailbox duplicate never returns a job with different input.
- **Final-result watermark:** it re-plans inside the transaction and never touches qualification.

All 46 focused unit tests pass.

## Redundant index drop

The 13 indexes were hidden at 03:04:35 UTC on November 20. Read-only checks at about 04:10 UTC found the following.

- **Hidden state:** all 13 were still hidden, and every covering compound was present and visible.
- **Atlas Performance Advisor:** it suggested no index for the five collections since the hide.
- **Slow-query log, 48 hours either side of the hide:**
  - No query shape got slower after the hide.
  - The `form_leads` duplicate-match shape `44B2C9EB…` was already slow, examining about 2,870 keys with the same plan family. After the hide it examined about 3,088.
  - The `lead_source_company` branch now uses its compound and examines 1,527 keys, against about 3,089 before.
  - The other entries came from the Atlas automation agent collecting `$collStats`.
- **Code:** no code hints a dropped index by name. The only name-dependent tool, `ops/best-relocation-retirement/callBackfillScan.ts`, uses the retained `call_leads.source_granularity_id_1`.

The drop is scheduled for 22:17 New York on November 20, through Windows Task Scheduler on the Owner's laptop. The `--drop` mode now refuses any target that is no longer hidden. To stop the drop, unhide the targets with `--unhide` or delete the task. The before and after evidence files land in `docs/operations/evidence/`.

## Index-phase targets found during the review

These slow shapes predate the hide and come from the Atlas slow-query log for the 48 hours before 03:04 UTC on November 20.

| Collection | Query | Plan | Evidence |
|---|---|---|---|
| `booked_leads` | Repeated scan (shape `07CED5AE…`) | COLLSCAN | 508 entries, max 604 ms |
| `call_leads` | `normalized_job_no` lookup | IXSCAN, about 1,335 keys for about 38 returned | 690 entries, max 729 ms |
| `form_leads` | `$or` on `last_accepted_granot_observation.observation_id` | COLLSCAN | 77 entries, max 527 ms |
| `form_leads` | Duplicate-match `$or` on phone and email paths, with source equality and `duplicate ≠ true` | IXSCAN on a source-granularity compound, about 3,000 keys for 0 returned | Repeated |

See the [baseline](INDEX-READ-BASELINE-2026-11-19.md) for the rest of the index-phase candidates.
