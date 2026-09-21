# 18 — Sales Intelligence efficiency: implementation report

Date: September 21, 2026. Branch: `feat/sales-intelligence-efficiency` in `vantage-main-server` (from `main` at `f051d02`), plus the matching Admin change in `vantage-admin`. Implements the first three steps of the [17 handoff](17-storage-throughput-and-llm-efficiency-handoff.md) order and the Owner-visible parts of steps four and five. No production data was deleted, no identity policy changed, no ceiling was raised, and the production model provider is unchanged.

The uncommitted Attention work (`infrastructure.ts` chunk fields, `attention.ts` chunked snapshots, `reads.ts` batched side data, `attention-chunks.test.ts`) is preserved on the branch untouched.

## 1. What was wrong, in one table

| Symptom in the baseline | Mechanism | Change |
|---|---|---|
| 61,900 completed `csi:outreach:repair:OutreachRecord:*` jobs in two days; 3,000–3,700 jobs/hour | The Outreach Record repair sweep keyed each job by the sweep-cycle timestamp, so every cycle inserted one completed no-op job per record | Keys are semantic. Outreach Records are keyed by their own `revision`, closed records are not swept, and the only persisted clock (wait expiry) is nominated by an indexed due query with the boundary in the key |
| 9,736 completed `attachment_refresh` jobs; two jobs per call per attachment revision | `rediscoverAttachmentPage` fanned every call on a number into a discovery job and an Outreach job | One coalesced `outreach-number:` replay job per number revision (pages of 25 calls, continuation job); rediscovery only for calls that carry a recording |
| Lead watermark jobs re-raised on any Lead edit | `attachment-lead:` keyed by `updatedAt` | Keyed by `leadAttachmentFingerprint`: phone paths and observation times, RingCentral aliases, display snapshot. `updatedAt` still orders the scan |
| 306 of 355 runs paused `budget_exhausted` while the month held $63.68 | Default limits reserved 12 steps × 128k = 1.5M input tokens per recording; at list pricing that is ~69¢ against the 25¢ default per-recording ceiling. The refusal was labelled `budget_exhausted`, so `resumeBudgetPausedJobs` re-admitted it on every drain and it failed again | `decideAnalysisAdmission` returns `no_active_period`, `per_recording_ceiling` or `monthly_budget` with the evaluated numbers, persisted on the job result and run. The per-recording refusal has its own pause reason that only a per-recording increase resumes. Default limits are 4 steps / 512k input / 32k output (≈23¢ at gpt-5-mini list pricing) |
| 56 analysis reservations still reserved after provider start | Default `elapsed_ms` was 180 s inside a 120 s function (`vercel.json` `maxDuration`) | Default `elapsed_ms` 95 s; the drain only starts an invocation it can finish. Unresolved reservations are surfaced to the Owner, never released |
| 305 pending analysis and 1,434 pending `number_refresh` jobs draining at one per five-minute cron | `drainIntelligenceJobs` ran exactly one job per invocation | Deadline-bounded loop (105 s); signals and no-ops take well under a second each |
| Model-facing Lead search scanned every Lead with an unanchored raw-phone regex | `leadRelevance` mixed normalized equality with regex alternatives | Indexed ten-digit predicates from `leadContactPhoneIndexes`, the same join the attachment worker uses |
| Owner saw "budget reached" with no way to act | Coverage exposed only `ai_paused` | `analysis_admission` on Owner coverage with status, estimate, ceiling, limits, paused counts by reason and unresolved reservations; per-recording ceiling editable in Settings; Number Analysis says whether a completed run is Lead-actionable or number-only |

## 2. Product model preserved

- Deterministic Number↔Lead identity, event-time attribution, Owner precedence, `likely` exclusion from Lead effects, restrictions and official closure are untouched. `lockNumber` / `unchangedNumber` fencing is untouched.
- Every Attention band still crosses its deadline on read: `derive()` runs with `now` inside the Attention publish cron every minute. The worker persists only wait expiry, because that is the one boundary with a stored transition (`wait_expired_at`, `waiting_on_customer → open`).
- Booking and cancellation still close Outreach through the same two paths: the EntityChange scan (live) and the Lead repair sweep keyed by official flags (repair). Both are unchanged.
- Old runs keep their pinned prompt and schema; nothing was repinned. The reservation formula is unchanged and still funds every configured step.

## 3. Files

Server (`vantage-main-server`):

- `src/services/salesIntelligence/outreach/worker.ts` — `outreachRepairNomination`, `waitExpiryNomination`, `replayNumberInteractions`, `outreach-number:` handler, non-closed sweep. Tests: `outreach/worker.test.ts`.
- `src/services/salesIntelligence/attachment/hooks.ts` — coalesced fan-out. `attachment/sources.ts` — `leadAttachmentFingerprint`. `attachment/refresh.ts` — fingerprint-keyed Lead jobs. Tests: `attachment/sources.test.ts`.
- `src/services/salesIntelligence/analysis/admission.ts` (new) — pure admission. `analysis/worker.ts` — admission wiring, distinct pause, evidence on failure, drain loop. `analysis/runtime.ts` — defaults. `analysis/reads.ts` — indexed `leadRelevance`. Tests: `analysis/admission.test.ts`, `runtime.test.ts`, `reads.test.ts`.
- `src/services/salesIntelligence/jobs.ts` — `per_recording_ceiling` pause reason. `policy.ts` — reason-specific resume. `conversations/transcribe.ts` — same reason for STT.
- `src/services/salesIntelligence/ownerCoverage.ts`, `dto.ts`, `numberActivity/coverage.ts` — `analysis_admission`, `per_recording_ceiling_cents` in settings, `ai_paused` counts both admission pauses.
- `src/routes/sales-intelligence-cron.routes.ts` — dependency type for the drain summary.
- `scripts/measure-csi-efficiency.ts` (new) — read-only aggregates reproducing the 17 baseline. `package.json` and `scripts/dev_ops/test-csi-*.ts` — replica runner paths repointed to `scripts/dev_ops/` (they referenced files that no longer exist; note that `scripts/dev_ops/**` is gitignored, so the suites live only on the development machine).
- Docs: `docs/knowledge/services/sales-intelligence-{outreach,attachment,analysis,foundation}.md`, `docs/index.md`.

Admin (`vantage-admin`): `lib/api/salesIntelligence.ts`, `components/sales-intelligence/{coverage-view,settings-form,analysis-panel}.tsx`, `sales-intelligence-copy.ts`.

## 4. Verification

| Check | Result |
|---|---|
| `pnpm typecheck` (server) | pass |
| Server `pnpm test` (2,608 tests) | pass, 0 failures |
| `pnpm typecheck` (Admin) | pass |
| Admin `pnpm test` (667 tests) | pass |
| Admin lint on changed files | one pre-existing `react-hooks/set-state-in-effect` in `settings-form.tsx` (the effect existed before; same pattern flagged in `workspace.tsx`) |
| Replica: Outreach (`test-csi-outreach`) | 24/24 pass |
| Replica: Intelligence (`test-csi-intelligence`) | 9/9 pass |
| Replica: Attachment (`test-csi-attachment`) | 10/12 on this branch; 9/12 on clean `main` with the same suite; see §4.1 |
| Replica: Budget (`test-csi15-budget`) | 13/13 (the first run failed one assertion because the drain summary `status` reported the trailing `not_claimable`; it now reports the last productive outcome) |
| Replica: Runtime (`test-csi-runtime`) | 21/23 on this branch and 21/23 on clean `main`, same subtest; see §4.1 |

### 4.1 Attribution of the remaining replica failures

The replica suites under `scripts/dev_ops/` could not have run since the files moved (both `package.json` and the runner scripts pointed at `scripts/test-csi-*.ts`), so a failure is not evidence of a regression by itself. A clean `main` snapshot (`git archive main`, same `node_modules`, same local `scripts/dev_ops` suites, placed beside `vantage-movers-mcp`) was run as the control on the same `csi01` replica set.

- Attachment: subtest "B job dispatch creates bounded scan jobs" fails with `No document found … NumberLeadAttachment` after `drainAttachmentRefreshJobs(100)` on both the branch and the control. Pre-existing. The control's third failure is the adopted-identity subtest, which this branch extended with assertions about the coalesced fan-out that `main` cannot satisfy; that subtest passes on the branch.
- Runtime: subtest "incomplete history publishes findings with review but cannot activate historical callback" finds one follow-up where it expects none, on both the branch and the control. Pre-existing; the changed code does not touch effect planning or coverage completeness.

## 5. Before/after evidence

Baseline (17, read-only, 18:04 UTC): 90,456 jobs (59.94 MiB + 11.32 MiB index); 76,720 completed `outreach_ensure`; 9,736 completed `attachment_refresh`; 3,000–3,700 new jobs/hour; 306 `budget_exhausted` runs; 56 unresolved reservations.

After deploying this branch, run `node --env-file=.env --import tsx scripts/measure-csi-efficiency.ts --hours 24` once the idle corpus has been swept at least twice (about six hours at 50 rows per source per minute) and compare:

- `jobs.families_in_window`: `outreach_ensure csi:outreach:repair:OutreachRecord:<id>:r<n>` should be bounded by the number of Outreach Record revisions in the window, not by sweep cycles. No `<ts>` family should remain.
- `jobs.per_hour`: idle hours should carry only EntityChange, capture and expired-wait work.
- `paused_jobs`: `per_recording_ceiling` rows are the ones the Owner can act on from Settings; `budget_exhausted` should be near zero while the month has headroom.
- `runs`: the `paused budget_exhausted` cohort stops growing; completed conversation runs should rise as the pending analysis queue drains at up to ~50 no-op jobs or one provider call per five-minute cron.
- `reservations`: `reserved started=true complete=true` older than one hour should stop accumulating.

Acceptance targets from 17 §11 that this branch is expected to meet, to be confirmed by the measurement: at least 90 % fewer idle Outreach repair insertions (the cycle key is gone entirely); zero repeated paid extraction for unchanged pinned evidence (unchanged mechanism); a typical resolved conversation submits within one or two steps (limits now enforce four).

## 6. Not done, and why

- **Per-run tool allowlist, schema compaction, resolved-context fast path (17 §8).** These change the MCP registration in `vantage-movers-mcp`, run preparation and the runtime together and need the frozen-evidence before/after comparison the handoff asks for. Not started; the 4-step default makes the current preloaded-evidence path the normal one.
- **Synthesis batching (17 §9).** `scheduleNumberIntelligence` already fingerprints and coalesces; the drain loop removes the throughput cap that made the 1,434-signal backlog visible. Batching bursts into one synthesis with a bounded wait remains open.
- **Shorter completed-job TTL (17 §10).** Left at 14 days. With semantic keys the retained dedupe keys are what prevent re-insertion; shortening retention would re-raise one job per row per TTL window. Revisit only with the measurement above.
- **Releasing the 56 unresolved reservations.** They are surfaced, not released: the last step of an aborted invocation can have cost that no step callback reported.
- **Backfill/verification of Lead phone normalization coverage** before relying solely on indexed predicates in `leadRelevance`. `FormLead` sets `normalized_phone_number` on save and the attachment worker already relies on the same paths, but rows written outside Mongoose are not verified here.

## 7. Deployment notes

- No migration. New job keys coexist with old ones; old cycle-keyed completed jobs expire on the existing TTL.
- `SALES_INTELLIGENCE_ANALYSIS_LIMITS_JSON` still overrides the runtime defaults. If production sets it, the Owner coverage `analysis_admission.limits` shows the effective values and the estimate they produce.
- Jobs already paused as `budget_exhausted` for a per-recording refusal are re-admitted once by `resumeBudgetPausedJobs`, evaluated with the new defaults, and either run or pause as `per_recording_ceiling` with evidence.
- The Admin `analysis_admission` field is optional in the client schema, so the desk keeps working against a server that has not deployed this branch yet.
