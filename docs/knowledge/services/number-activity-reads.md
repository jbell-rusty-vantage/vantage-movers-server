---
type: Service
title: Number Activity reads, directory sync and projection rebuild (CSI-04)
description: Owner-only Contact Number search, detail and merged timeline over stored Call Interaction evidence, the daily RingCentral directory snapshot sync the projection reads, and the durable rebuild of rollups and search terms.
tags: [sales-intelligence, ringcentral, durable-work]
status: draft
stale_after: 2026-12-17
resource: src/services/numberActivity/search.ts
applies_to:
  - src/services/numberActivity/directorySync.ts
  - src/services/numberActivity/contactNumbers.ts
  - src/services/numberActivity/search.ts
  - src/services/numberActivity/timeline.ts
  - src/services/numberActivity/coverage.ts
  - src/services/numberActivity/dto.ts
  - src/services/numberActivity/rebuild.ts
  - src/models/ContactNumber.ts
  - scripts/repair-contact-number-first-observed.ts
  - src/routes/sales-intelligence-admin.routes.ts
owners: [team:main-server]
sources:
  - id: specification
    resource: docs/call-sales-intelligence/03-server-pipeline-and-jobs.md
  - id: routes
    resource: docs/call-sales-intelligence/04-server-routes.md
  - id: handoff
    resource: docs/call-sales-intelligence/workspace/evidence/csi-04/HANDOFF.md
  - id: review
    resource: docs/call-sales-intelligence/workspace/evidence/csi-04/INDEPENDENT-REVIEW.md
---

# Number Activity reads, directory sync and rebuild

CSI-08 adds Number `attach_lead` availability alongside rebuild, gated by ENABLED and ATTACHMENT_REFRESH and carrying the Number revision for an absent pair. Existing-pair commands use the dedicated attachment revision. Number detail includes existing Outreach enrichment (Lead facts/latest call/official links), active restriction revision/availability, and review rows; reads remain side-effect free. See [CSI-08 intake](../../call-sales-intelligence/workspace/evidence/csi-08/INTAKE.md).

CSI-14 integration: the existing Outreach timeline source includes `nudge` audit invalidations as the established `nudge` event kind. It includes Outreach subjects whose primary Contact Number matches, even without a separate attachment edge. Authorization/submission/delivery events are read-only history and never count as customer work. Explicit send behavior belongs to [Owner Rep Nudges](sales-intelligence-nudges.md).

**Role:** the Owner-facing read side of [Number Activity](number-activity-capture.md) (04 §1 `/numbers` rows, §3) plus two maintenance workers: the daily directory snapshot that [capture](number-activity-capture.md) reads for party roles and company classification (02 §9), and the durable rebuild of derived Contact Number fields (03 §0 `rebuild.ts`). Reads never mutate. Sales meaning (attachments, Outreach, findings) belongs to Teams C and D; this service exposes their rows as connections and leaves hooks for their timeline events.

**System of record read:** `contact_numbers`, `call_interactions` (canonical rows only, `merged_into_id: null`), `number_lead_attachments`, `outreach_records`, `lead_messages`, `lead_conversations`, `sales_intelligence_sync_state` (`call_log_all_directions` for Coverage, `webhook_receipts`, `directory`), `sales_intelligence_jobs`. **Written:** `ringcentral_directory_snapshots` (directory sync), `contact_numbers` derived fields (rebuild worker, revision CAS), `sales_intelligence_jobs`/`sales_intelligence_command_executions`/audit (rebuild command and worker).

## Modules

| Module | Responsibility |
| --- | --- |
| `directorySync.ts` | `runDirectorySyncOnce`: fenced lease on sync-state scope `directory`; reads account, extensions, phone numbers, call queues and queue members through the shared RingCentral client; `normalizeDirectory` (pure) → digest; appends a snapshot only when the digest changed; A→B→A advances `taken_at` on the existing digest; prunes to the last 30 per account (raw collection delete — the model is append-only); `DirectorySyncSummary.truncated` when more than 200 queues skip member fetches; fenced state write with `last_run`/`consecutive_failures`. Flag `SALES_INTELLIGENCE_DIRECTORY_SYNC`; cron `/api/cron/sales-intelligence-directory-sync` (`20 5 * * *`). |
| `coverage.ts` | `readCaptureCoverage()` → slim `CoverageDto` from the `call_log_all_directions` and `webhook_receipts` sync states (`known_through`, open `gaps`), honest `capabilities` (`unavailable` on `consecutive_failures` or `last_run.error_code`; `webhook` ok only with `cursor.last_sync_to` and no failure; `call_log` ok only with a watermark and no failure; `recording_content` from CSI-11 stored media outcomes), `ai_paused` from budget-paused jobs in this dataset. `ownerRead(data, now?)` wraps with `as_of` and `coverage`. Owner GET `/coverage` uses `readOwnerCoverage()` for the CSI-09 stage/budget/hygiene/settings projection; embedded list/detail reads stay on the slim capture DTO. CSI-14 §1: the derivation is memoized per dataset for `SALES_INTELLIGENCE_COVERAGE_CACHE_MS` (default 5000, `0` disables), sharing the in-flight promise, so one page view derives it once instead of once per `ownerRead`. Outside test mode a stored projection wins: the minute job-recovery cron calls `refreshCaptureCoverage()` and upserts `sales_intelligence_coverage_projections`; `readCaptureCoverage()` loads that document and does not recount, and it does not insert when the projection is missing. Test mode still derives so a proof sees the write it just made. |
| `search.ts` | `numberSearchQuerySchema` (`hygiene` is only boolean/`"true"`/`"false"` — never `z.coerce.boolean()`), `parseSearchTerm` (≥10 digits → E.164 exact **or** the same digits as a suffix over `digits_reversed`, carried together as `{kind:"e164", e164, reversed}`; 3–9 digits → suffix; otherwise anchored prefix term over `search_terms`), `buildNumberSearchFilter` (classification, `attachment` linked/unlinked via rollups, activity range, hygiene toggle for non-external kinds), keyset cursor `(last_activity_at, _id)`, `searchNumberActivity` (default 50, max 200, complete under pagination). |
| `contactNumbers.ts` | `getContactNumberDetail(id)`: number, all attachments (every state), outreach records, fresh canonical-interaction recount, `allowed_actions` (`rebuild_number`); `toNumberSearchItem` mapper. |
| `timeline.ts` | `getNumberTimeline(id, { cursor, limit }, { sources, extraSources })`: k-way merge of `interactionSource` (canonical rows, recordings counted per entry), `leadMessageSource` (no body text) and `conversationSource` (no transcript/summary text) in the total order `happened_at DESC, kind ASC, id DESC`; `observed_at` preserved separately; cursor by `(happened_at, kind, id)`; `TimelineSource` is the hook Team C uses for outreach events and nudges. |
| `dto.ts` | B-owned Zod schemas built on the CSI-01 DTOs: `numberSearchItemDtoSchema`, `numberSearchPageDtoSchema`, `numberDetailReadDtoSchema` (superset of the frozen `numberDetailDtoSchema` data), `numberTimelineEventDtoSchema` (`timelineEventDtoSchema` + `detail`), `numberTimelinePageDtoSchema`, `NUMBER_DTO_FIXTURES` for Team E. |
| `rebuild.ts` | `enqueueNumberRebuild` (Owner command through `executeCsiCommand`, CAS on `expected_revision`, `number.rebuild_requested` audit, durable `rebuild` job); `enqueueRebuildAll` (one job that fans out dedupe-keyed per-number jobs); `recountNumber` (pure, replays stored rows through `toProjection` with the CSI-02 counting rules); `runRebuildJob` (claim stage `rebuild`, recount inside `completeCsiJob`, revision CAS, `number.rebuilt` audit only when something changed, result on the job row); `drainRebuildJobs`. Registered in `defaultStageHandlers` and in the job-recovery cron under `SALES_INTELLIGENCE_ENABLED`. |
| `routes/sales-intelligence-admin.routes.ts` | `GET /numbers`, `GET /numbers/:id`, `GET /numbers/:id/timeline`, `POST /numbers/:id/rebuild` under `/api/v1/admin/sales-intelligence`, mounted after the CSI boundary; re-checks flag, signed Owner identity and scope; `Idempotency-Key` required on the command; closed error codes with `request_id`. |

## Invariants

- Reads never write. Every read filters canonical interactions (`merged_into_id: null`); a merged tombstone is never listed or counted. Interactions count once; recordings count per `recordings[]` entry.
- Non-external kinds (`company_did`, `extension`, `service_code`, `withheld`, `malformed`) are hidden by default and visible only under `hygiene=true`. `?hygiene=false` (and boolean `false`) keeps the default; `0` / `off` / empty are rejected, not coerced.
- Search completeness: results are ordered by `(last_activity_at DESC, _id DESC)` with a keyset cursor, so every match is reachable exactly once even when many numbers share a timestamp. Each selective prefix (`digits_reversed`, `search_terms`, `classification`, `kind`) carries that order in its compound index, so the common searches are index scans rather than in-memory sorts against Mongo's 32 MB limit (CSI-14 §8). `contact_number_terms_activity` is multikey, so that one shape still keeps a sort stage on a narrowed candidate set.
- Digit input is never exact-only: the filter `$or`s the exact `e164` with the `digits_reversed` prefix of the typed digits, so a pasted number carrying a wrong or extra country prefix is a hit rather than "the number isn't in the system" (CSI-14 §10). Both arms are anchored index lookups.
- The timeline reads `lead_conversations` directly off `contact_number_id` (stamped by recording discovery). A page-window fallback still resolves legacy rows through `recordings[].lead_conversation_id`; `pnpm migration:csi:conversation-number --apply` backfills the link and makes that branch a no-op (CSI-14 §9).
- Coverage is honest: without a Call Log sync state `known_through` is null and `call_log` is `unknown`; a failing stream (`consecutive_failures` or `last_run.error_code`) is `unavailable`; open gaps are reported; `recording_content` reflects CSI-11 stored media outcomes; seed audio alone leaves it `unknown`.
- Directory snapshots are versioned by digest; identical directories add no document; reverting to a prior digest advances that row's `taken_at` so lookup is current. `loadDirectoryLookup` reads the newest by `taken_at`. Without a snapshot roles stay `unknown` and company classification is not guessed (CSI-02 behavior). Rep mapping review is Team C (CSI-10); this service supplies effective-time participant evidence only.
- Rebuild creates no business fact: `classification`, `contact_eligibility`, `last_meaningful_contact_at`, `running_summary` and Owner fields are untouched; rollups, `provider_names`, `search_terms` (from provider names and non-rejected attachment snapshots: lead name, Job Number, receiver Agent name), `first_observed_at`, `last_activity_at` are recomputed from canonical evidence (repair, not monotone widen — prior bounds are in the `number.rebuilt` audit). A no-op rebuild bumps no revision and writes no audit. Concurrent capture that bumps the revision makes the rebuild retry (transient) and recount. Rebuild-all fans out with `input_revision: 1`.
- The rebuild runs as a durable job, never inline in the request; the route returns 202 with `job_id`. Same `Idempotency-Key` + payload replays; changed payload is `IDEMPOTENCY_CONFLICT`; stale `expected_revision` is `REVISION_CONFLICT`.
- Full customer numbers appear only on these Owner-only routes; rep-facing text elsewhere uses last four digits.

CSI-11 now extends Coverage with recording availability counters and stored media capability outcomes; see [recording discovery/media](sales-intelligence-recording-media.md). `recording_content` is no longer unconditionally unknown: denied and unavailable remain explicit, verified account/interaction/digest media can establish stored success, and legacy seed audio alone cannot establish a provider grant. CSI-09 Owner GET `/coverage` reuses those stored counters and adds stage health, mapping hygiene, env flags/models, budget actual/reserved/remaining, and current settings. Denied, unavailable, unknown, and zero stay distinct. GET never writes.

## Configuration

CSI-15 replaces the Owner Coverage backfill notice with stored window counts, configured day range, a monotonic upper capture watermark and explicit gaps. Counts are null before any stored windows; running windows count as partial. Counts cover all windows, while the earliest 500-window gap view discloses truncation. A complete capture window can still await Outreach activation, which the note reports. This upper bound is never presented as gap-free history. Embedded slim capture Coverage is unchanged. Admin consumes the additive DTO; GET remains read-only. Exact contract and synthetic checks: [CSI-15 handoff](../../call-sales-intelligence/workspace/evidence/csi-15/HANDOFF.md).

`SALES_INTELLIGENCE_ENABLED` (reads, rebuild command and rebuild drain), `SALES_INTELLIGENCE_DIRECTORY_SYNC` (directory cron), `RINGCENTRAL_ACCOUNT_ID` (optional configured account check for the directory sync), `SALES_INTELLIGENCE_DEPLOYMENT_ID` (job dataset), `CRON_SECRET`.

## Tests

- `src/services/numberActivity/{reads,rebuild,directorySync}.test.ts`, `src/routes/sales-intelligence-admin.routes.test.ts`, `src/routes/sales-intelligence-cron.routes.test.ts` — pure and fake-backed.
- `pnpm test:csi:numbers:replica` (directory sync, snapshot read by the projection, rebuild command/worker/all/dispatch, real route stack) and `pnpm test:csi:reads:replica` (search completeness, matching, hygiene, timeline ordering and dedupe, coverage honesty, no-mutation snapshots) on the isolated replica. Provider directory reads are fakes; not a live capability proof.


## CSI-16 evidence restamp

Current local certification is recorded in [CSI-16 checks](../../call-sales-intelligence/workspace/evidence/csi-16/CHECKS.md) and the [execution matrix](../../call-sales-intelligence/workspace/ACCEPTANCE.md). CSI-15 backfill/retention/budget recovery is landed on main. Fresh synthetic and isolated browser evidence does not certify production grants or deployed revisions. G4 retains the media Retry-After clock failure; G5 remains partial and the generic conversation replay label fails integration. Exact owners are in [GAPS](../../call-sales-intelligence/workspace/evidence/csi-16/GAPS.md). [G6](../../call-sales-intelligence/workspace/evidence/csi-16/G6.md) is not probed. Owner full rollout follows separately in AFTER-16 D+E; no capability was enabled by this restamp.

## LP-06 Numbers time sorts, First observed repair and attached Lead progress (2026-09-22)

Lead progress spec §14.2, §7 Number card and §11.3; acceptance 25. Explain evidence: `sales-intelligence-move-assessment-workspace/evidence/LP-06-numbers-sorts.md`.

- **Query.** `GET /numbers` accepts optional `sort=last_activity|last_human_conversation|first_observed` and `direction=asc|desc`, with effective defaults `last_activity`/`desc`. The fields are `last_activity_at`, `rollups.last_human_conversation_at` and `first_observed_at`. The list stays a live keyset query, not a snapshot. It has no Lead progress sort; that sort stays on Outreach.
- **Historical path.** When neither parameter is sent, the request runs the old single query `(last_activity_at desc, _id desc)` and returns the legacy cursor `{last_activity_at, id}`, unchanged. A legacy cursor is also accepted by an explicit `last_activity desc` request, and rejected by any other sort.
- **Nulls last in both directions.** The pager reads the value segment (`field != null`, keyset `(field, _id)` in the requested direction, so `asc` is `(field asc, _id asc)`), then the null segment (`field == null`, null or missing, ordered by `_id` in the same direction). Each page makes at most two queries.
- **Cursor v2.** `{v:2, sort, direction, segment:"value"|"null", value: iso|null, id, digest}`. `digest` is a 16-hex SHA-256 over the parsed term, classification, attachment, activity range, hygiene, sort and direction. It excludes `limit` and the cursor. A cursor minted for a different sort, direction or filter set is `INVALID_INPUT` (400), and so is a tampered or garbage cursor. A v2 cursor sent without sort parameters is also rejected.
- **Narrowed searches.** When `q` is set and the sort is not Last call activity, the server counts candidates, capped at 2,001.
  - At or below `NUMBER_SORT_CANDIDATE_CAP` (2,000), the planner may sort the narrowed set in memory.
  - Above the cap, both segments are read with a `hint` on the sort's own `{kind, field, _id}` index. The order is the requested one either way, so this is decided per page, the cursor carries no plan state and the response carries no note.
  - Explain on 20,000 synthetic Numbers: the hinted plan has no SORT and examines 286 to 450 keys.
- **Indexes** (`CONTACT_NUMBER_INDEXES`, built by the idempotent `pnpm migration:csi:indexes` inventory):
  - `contact_number_kind_human_conversation` `{kind:1, "rollups.last_human_conversation_at":-1, _id:-1}`
  - `contact_number_kind_first_observed` `{kind:1, first_observed_at:-1, _id:-1}`

  Explain shows every `kind=external` value and null segment index-served with no SORT stage, in both directions. Hygiene (`kind ≠ external`) keeps a SORT stage bounded by the number of non-external Numbers.
- **Response.** `data.sort` holds the applied `{sort, direction}` (additive). Each item exposes `first_observed_at`, `last_activity_at` and `rollups.last_human_conversation_at`; the last is additive and optional in `numberRollupsDtoSchema` and is also on detail.
- **`attached_lead_progress`** (optional, additive) on every list item. It comes from one batched `loadAttachedLeadProgressForNumbers(pageIds, now)` call per page (`salesIntelligence/outreach/reads`), never one per card, and its shape is that module's `attachedLeadProgressDtoSchema`.
  - `resolved` carries `lead_ref`, `lead_progress` (null while Lead progress is off), `booking`, `outreach_state` and `lead_display`.
  - `multiple` and `none` carry no Lead fields. The mapper strips them and the Number DTO refinement rejects them, so Admin never shows a merged Priority or an any-Lead Quoted boolean.
  - A Number absent from the helper's map gets no field.
- **First observed.**
  - Capture: every upsert lowers `first_observed_at` with `earlierOf` (`persistInteraction.applyRollupDelta`), so ingesting a later call first no longer pins a late date. Creation uses the first call's `started_at`.
  - Rebuild: `recountNumber` sets `first_observed_at` to the earliest canonical interaction (`merged_into_id: null`), lowering or raising it, under the rebuild's revision CAS.
  - Repair: `scripts/repair-contact-number-first-observed.ts [--limit=500] [--after=<id>] [--apply]` (`repairFirstObservedAt`) is bounded and resumable, and a dry run by default. It prints `{scanned, changed, unchanged, no_evidence, errors, lowered, raised, next_after}`. It writes only `first_observed_at`, with a revision CAS plus a `number.first_observed_repaired` audit row in one transaction; `last_activity_at`, rollups and search terms are never touched. A concurrent capture shows up as an error on that pass, and a rerun picks it up.
- **Tests.**
  - `reads.test.ts` (pure pager over an in-memory Mongo evaluator): 3 sorts × 2 directions × page sizes 1 to 50 on 14 Numbers with ties and 5 nulls; the historical path and legacy cursor; cursor binding and tampering; the cap hint; the attached DTO rules.
  - `rebuild.test.ts`: `earlierOf`, and an out-of-order recount that lowers the value, and raises it past merged evidence.
  - `pnpm test:csi:numbers:replica`: the real route over all 6 orders with nulls last; cursor rejection; reads mutating nothing; `attached_lead_progress` resolved/multiple/none; a hinted plan on the replica; a no-SORT explain guard; and acceptance 25, where calls are ingested out of order, the stored value is forced late, then repaired (dry run, apply, no-op rerun, `--after` paging, raise past a tombstone).

## S2-NUMBERS: Numbers list sorts, Analysis filters and row rollups (2026-09-23)

Data spec §4.2 (V13, V14), final spec §9.1–§9.2, acceptance B9. Evidence: `sales-intelligence-ui-ux-workspace/evidence/S2-NUMBERS.md`.

- **Sorts.** `sort` also accepts `last_call`, `first_call` and `interactions` (with `direction=asc|desc`). The older names stay accepted.
  - `last_call` is an alias of `last_activity` (`last_activity_at` is written only from interactions, so it is the last call). `first_call` is an alias of `first_observed`. An alias uses its canonical sort's field, index, cursor and digest, so a cursor minted under `last_call` continues under `last_activity` and the other way round, and a legacy `{last_activity_at, id}` cursor continues `last_call desc`. `data.sort.sort` echoes the name the request used.
  - `interactions` orders by `rollups.interactions_total` on `contact_number_kind_interactions` `{kind:1, "rollups.interactions_total":-1, _id:-1}` with the same two segments: the value segment is `interactions_total != null` (so `0` is a value), then the null segment (null or missing) by `_id`, in both directions. q-narrowed requests follow the same candidate-cap rule and hint that index above the cap.
- **Cursor v2 value is typed.** `value` is an ISO date for the time sorts and a number for `interactions`. The cursor `sort` is the canonical name (`last_activity`, `last_human_conversation`, `first_observed`, `interactions`). A number on a time sort, a date or string on `interactions`, or a value/segment mismatch is `INVALID_INPUT`.
- **Filters (region Analysis).** `has_recording=true` narrows to `rollups.recordings_total > 0` and `has_outreach=true` to `rollups.outreach_records_total > 0`. They are query-string booleans like `hygiene`: `false` or absent does not narrow, and there is no "has none" filter. A row with the key missing (written before the rollup sweep) does not match. Both work on every sort and on the historical path. They enter the cursor digest only when true, so digests of earlier requests are unchanged.
  - Both are residual predicates on the `kind`-prefixed sort index. On a positioned page the planner could plan the keyset `$or` through `_id_` and sort in memory (seen on the replica with both filters set), so an unsearched filtered request passes a `hint` for the sort's own index (`numberFilterHint`; `contact_number_kind_activity` for `last_activity`/`last_call`). q requests keep the candidate-cap rule; unfiltered requests are unchanged.
  - The counts come from S1's rollups (`recordings_total`, `outreach_records_total`); until the production rollup sweep runs, older rows read 0 and the filters under-report.
- **Row rollups.** `rollups` on list items (and on detail, which shares `toRollupsDto`) adds `recordings_total`, `conversations_analyzed_total`, `last_analyzed_at` and `outreach_records_total`. They are always emitted, default `0`/`null` on rows that lack them, and optional in `numberRollupsDtoSchema` so older fixtures parse. Every existing field is kept.
- **Tests.** `search.test.ts` (pure pager over an in-memory evaluator: aliases, cursor crossing, the legacy cursor, interactions with ties/zeros/nulls/missing at page sizes 1 to 200, the typed cursor, filters and digest, the filter hint, the row DTO). `scripts/dev_ops/test-si-numbers.ts` (replica, B9): 130 Numbers paged at `limit=7` for `interactions`, `last_call` and `first_call` in both directions, exact order with no repeat or skip; the filters over every sort; the hinted path above the cap; explain showing `contact_number_kind_interactions` with no SORT stage.
