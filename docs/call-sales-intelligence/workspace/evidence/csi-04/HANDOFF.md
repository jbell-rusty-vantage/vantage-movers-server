# Team handoff — CSI-04

- **Team / issue / date:** B / CSI-04 Number Activity, search, timeline, projection rebuild and directory snapshot sync / September 17, 2026.
- **Agent and repo / branch / commit:** Fable (main implementer); `vantage-main-server` `sales-intelligence`, baseline `1925c32` (CSI-02 review resolved). The CSI-04 patch is **uncommitted** and left for review together with CSI-03 (same working tree). No checkout reset, branch switch, commit or push. `vantage-admin` untouched.
- **Status:** ready for review. Independent Opus 5 review requested changes; all three must-fixes and the should-fixes in scope were resolved and a second Opus 5 review **Approved**. Implementation evidence is database-backed on the isolated replica with synthetic payloads and fakes; live provider capability (directory API, queue delivery, production cron) is not claimed.

## Concrete behavior delivered

1. **Directory snapshot sync (02 §9, 03 `directory.ts`).** `runDirectorySyncOnce` claims a fenced lease on sync-state scope `directory` under `SALES_INTELLIGENCE_DIRECTORY_SYNC`, reads account / extensions / phone numbers / call queues / queue members through the shared RingCentral client, `normalizeDirectory` (pure) → digest, appends a `RingCentralDirectorySnapshot` only when the digest changed (A→B→A advances `taken_at` on the existing digest), and prunes to the last 30 per account (raw-collection delete — the model is append-only). `DirectorySyncSummary.truncated` is set when more than 200 queues skip member fetches. Failed runs (throttle, account mismatch, page limit) write no snapshot, increment `consecutive_failures`, and release the lease. `loadDirectoryLookup` reads the latest by `taken_at`; with none, roles stay `unknown` and company classification is not guessed. Rep mapping review is Team C (CSI-10). Cron `/api/cron/sales-intelligence-directory-sync` (`20 5 * * *`) is registered in `vercel.json` and handled in the CSI-03 cron router.
2. **Contact Number reads (03 `contactNumbers.ts`).** `getContactNumberDetail` returns the number, every attachment state, connection counts (including a fresh `merged_into_id: null` interaction recount), and `allowed_actions: rebuild_number`. Non-external kinds are not filtered here (hygiene is a search concern). Reads never write.
3. **Search (03 `search.ts`, 04 `GET /numbers`).** `searchNumberActivity` over normalized digits (exact E.164), 3–9 digit suffix on `digits_reversed`, and anchored prefix terms on `search_terms` (provider/customer names, Job Number, Agent), with classification, attachment linked/unlinked, activity-range and hygiene filters. Cursor-paginated (default 50, max 200) on `(last_activity_at DESC, _id DESC)`. Completeness proven through a same-instant cluster. Returns `as_of` and Coverage.
4. **Timeline (03 `timeline.ts`, 04 `GET /numbers/:id/timeline`).** `getNumberTimeline` k-way-merges canonical Call Interactions (tombstones excluded; recordings counted per `recordings[]` entry), Lead Messages (no body) and Lead Conversations (no transcript/summary; account-scoped recording ids) in the total order `happened_at DESC, kind ASC, id DESC`. `observed_at` is preserved separately. Cursor by `(happened_at, kind, id)`. Team C plugs Outreach/nudge events through `TimelineSource` / `extraSources`.
5. **Projection rebuild (03 `rebuild.ts`, 04 `POST /numbers/:id/rebuild`).** Owner command enqueues a durable `rebuild` job through `executeCsiCommand` (`Idempotency-Key`, `expected_revision` CAS). The worker claims stage `rebuild`, recounts from stored canonical interactions + attachments + open Outreach through the CSI-02 counting rules (`toProjection` / `recountNumber`), writes rollups / `provider_names` / `search_terms` / activity bounds under revision CAS inside `completeCsiJob`, and writes `number.rebuilt` audit only when something changed. No new business facts. `enqueueRebuildAll` fans out per-number jobs (service entry point; no Owner route). Registered in `defaultStageHandlers` and in the job-recovery cron under `SALES_INTELLIGENCE_ENABLED`.
6. **Routes.** `GET /numbers`, `GET /numbers/:id`, `GET /numbers/:id/timeline`, `POST /numbers/:id/rebuild` under `/api/v1/admin/sales-intelligence`, mounted after the CSI boundary. Flag off → `404 FEATURE_DISABLED`. Owner-only (full customer numbers). Commands require `Idempotency-Key`. DTO fixtures in `NUMBER_DTO_FIXTURES` for Team E. No dashboard UI.

## Files owned and changed

Added: `src/services/numberActivity/{directorySync,rebuild,dto,coverage,contactNumbers,search,timeline}.ts` and `{directorySync,rebuild,reads}.test.ts`, `src/routes/sales-intelligence-admin.routes.ts` and `.test.ts`, `scripts/test-csi-numbers.ts` + `.replica.test.ts`, `scripts/test-csi-reads.ts` + `.replica.test.ts`, `docs/knowledge/services/number-activity-reads.md`, `docs/call-sales-intelligence/workspace/evidence/csi-04/*`.

Shared files touched (additive): `src/routes/sales-intelligence-cron.routes.ts` (directory-sync handler, rebuild drain under `ENABLED`), `api/queues/sales-intelligence-consumer.ts` (via `defaultStageHandlers` rebuild registration in `jobDispatch.ts`), `src/services/numberActivity/jobDispatch.ts` (`rebuild` stage), `src/routes/v1.routes.ts` (admin router after the CSI boundary), `src/services/salesIntelligence/jobs.ts` (`resultFrom` on `completeCsiJob`), `src/services/numberActivity/directory.ts` (comment: CSI-04 writes snapshots; CSI-10 reviews mapping), `package.json` (`test:csi:numbers:replica`, `test:csi:reads:replica`), `docs/index.md`, CONTRACTS/LEDGER. CSI-03 already registered the directory-sync cron path in `vercel.json`.

Not touched: Call Qualification services, `call-log-sync*.ts`, `ingestRingCentralQualifiedCall`, evaluator, filters, Admin UI, production data, `outreach_ensure` / `attachment_refresh` / `recording_discovery` consumers.

## Contract/version changes and consumers notified

`csi-numbers-v1` published in [CONTRACTS.md](../../CONTRACTS.md#csi-04-concrete-imports-server-relative-september-17). Additive CSI-01: `completeCsiJob` `resultFrom`. CSI-01/02/03 replica suites unchanged. This is a written handoff; no messages were sent.

## Tests/checks actually run

See [CHECKS.md](CHECKS.md): typecheck exit 0; focused suite 109/109 (14 CSI-04 unit); CSI-04 reads replica 10/10; CSI-04 numbers replica 7/7; CSI-03 replica 11/11; CSI-02 replica 12/12; CSI-01 replica 15/15; qualification suites 102 pass / 0 fail / 3 pre-existing skips; `git diff --check` clean.

## Race/idempotency/failure cases verified

Database-backed: directory lease election; digest no-op; A→B→A `taken_at` advance; bound prune; throttle/mismatch fail-closed; search completeness through a same-instant cluster; hygiene (`false` does not invert; `0`/`off` rejected); timeline canonical dedupe and cursor completeness; coverage honesty including open gaps, failing-webhook `unavailable`, and dataset-scoped AI pause; rebuild command replay/conflict; worker restores corrupted derived fields excluding tombstones and matching a fresh recount; no-op rebuild; expired-lease fencing; rebuild-all fan-out + drain + retry after a live revision bump; dispatch through the shared wake-up path; real route stack flag-off 404, Owner guard, idempotency, no-read-mutation snapshots. Fakes: directory fetcher paths, cron auth/flag/lease, admin route guard.

## Known gaps or capability blockers

- **Not live-verified:** RingCentral directory list shapes beyond the fields read, production snapshot volume (bound of 30 exercised as 3), Vercel Queue delivery of rebuild wake-ups, production cron invocation, directory paging on a live account (an advertised `nextPage` on a final page would walk to `page_limit`).
- **Team C holes (intentional):** `outreach_records` / `restrictions` / `review_items` arrays on detail are empty; connection counts are populated. Timeline `extraSources` is the hook for Outreach/nudge events. Rep Identity Link review is CSI-10; directory snapshots are participant evidence only.
- **Incremental capture vs rebuild:** CSI-02 incremental rollups do not yet increment `human_conversations_total` / `last_human_conversation_at` after create. Rebuild recounts those fields from stored `contact_type`. A number that only ever saw incremental capture of an Owner-set human conversation will show the gap until rebuilt. Not a CSI-04 defect; rebuild is the repair path. Activity bounds are repair (canonical window replaces a stale stored window); the audit records prior/current.
- **`enqueueRebuildAll`** is a service/ops entry point (`command: "rebuild_all_numbers"` on the command ledger) and is not in the Owner `csiCommandSchema` / 04 §1 catalog. It has no resume cursor: a fleet too large for one invocation restarts from `_id` ascending.
- **`lead_messages.to`** has no index (Team F migration). Timeline message reads may collection-scan until then.
- **Directory truncation** is on the run summary only; queues past the 200th store empty member lists.
- **Import boundary:** `numberActivity` still does not import qualification/ingest/Lead-write services (existing boundary test still passes). `coverage.ts` reads CSI-03 `WEBHOOK_RECEIPTS_SCOPE`.
- **Deployment inputs:** `SALES_INTELLIGENCE_ENABLED` for Owner reads and rebuild drain; `SALES_INTELLIGENCE_DIRECTORY_SYNC` for the daily cron; `SALES_INTELLIGENCE_DEPLOYMENT_ID` for job dataset identity; `CRON_SECRET` as today. Flags stay off.

## Deployment actions performed

None. Flags remain off. Local Docker replica `csi01` reused for isolated tests only.

## Next dependency and exact entry point for the receiving team

- **Team E (CSI-07/08/09):** parse `NUMBER_DTO_FIXTURES` and the schemas in `dto.ts`; call `GET /api/v1/admin/sales-intelligence/numbers`, `.../:id`, `.../:id/timeline`, `POST .../:id/rebuild` behind the existing Owner proxy. Do not invent rollup or coverage rules in the client.
- **Team C (CSI-05/06/10):** register `attachment_refresh` / `outreach_ensure` handlers as CSI-03 documented; supply Outreach/nudge `TimelineSource`s via `extraSources`; publish attachment/outreach/restriction/review mappers to fill the empty detail arrays; consume `loadDirectoryLookup` / snapshot rows for CSI-10 mapping review — do not treat `unknown` roles as users.
- **CSI-11:** recording discovery still consumes CSI-02 `recording_discovery` jobs; `recording_content` coverage stays `unknown` until that grant is proven.
- **Team F (G6):** directory sync and rebuild recovery are registered; enabling `SALES_INTELLIGENCE_DIRECTORY_SYNC` is a deployment action. Do not treat this patch as a live directory grant.

## Independent review

First Opus 5 review: Request Changes (3 must-fix, 6 should-fix, 5 nit). All must-fixes and in-scope should-fixes resolved with replica regressions. Second Opus 5 review ([Review](baa56539-c391-4e63-a852-279fb55b4e6f)): **Approve**. Findings and resolutions: [INDEPENDENT-REVIEW.md](INDEPENDENT-REVIEW.md).

## Ledger rows updated

CSI-04 → review (findings resolved). CSI-03 remains review (findings resolved). Other rows unchanged.
