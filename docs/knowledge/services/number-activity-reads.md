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
