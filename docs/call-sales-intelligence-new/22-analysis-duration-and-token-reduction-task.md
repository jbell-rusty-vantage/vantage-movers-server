# 22 — Task specification: analysis invocation duration, queue-first execution, and tokens per run

Date: September 21, 2026. For the next agent session, to reason over first and then implement. Builds on the [18 implementation](18-efficiency-implementation-2026-09-21.md) and the analysis the user requested afterwards (§1 below). Depends on branch `feat/sales-intelligence-efficiency` being the base.

Three items, in order. Items 1 and 2 are small and remove the timeout risk for the single-generation case. Item 3 is the cost and latency lever and is the larger change.

## 1. Evidence this task rests on

- **The 120-second limit is ours, not Vercel's.** Vercel's duration docs (updated 2026-08-24, [source](https://vercel.com/docs/functions/configuring-functions/duration)): with Fluid compute, which is enabled by default, Hobby defaults to and maxes at 300 s; Pro and Enterprise default to 300 s with an 800 s maximum and a 1,800 s per-function beta. `vercel.json` sets `maxDuration: 120` on `api/index.ts`. The queue consumer files under `api/queues/` set nothing and therefore inherit the project default.
- **A second cap lives in code.** `analysis/runtime.ts` `runtimeLimitsSchema` refuses `elapsed_ms` above 180,000; the default on the branch is 95,000. `runtime.test.ts` asserts `elapsed_ms + 10_000 <= 120_000`.
- **The long pole is one generation, not retrieval.** Evidence pages are captured before the model loop (`invokeIntelligenceAgent` → `readPages`), the loop is capped at four steps, and measured completed runs used about 49k input / 6k output tokens (gpt-5.6-luna) and 26k / 7k (gpt-5-mini). Schema-exhausted runs used about 44k input and 12k output, roughly four times the cost of a clean run.
- **What is sent every step.** The MCP `tools` object is 45,682 bytes and the generated envelope schema is 41,424 bytes (17 §8). The prompt order today is `instructions` (pinned prompt) then a user message built by `renderIntelligenceEvidencePrompt` that includes the citation inventory and all captured pages.
- **Budget is enforced atomically** (`reserveCsiBudget`); actual cost per reconciled analysis was about 1.8¢ and per transcription about 1.1¢. The stranded reservations (56, $10.56) came from the 180 s runtime inside the 120 s function, which 18 fixed by lowering the runtime. This task raises both limits together so the runtime no longer has to be squeezed.

Verify before starting: in the Vercel project settings, Fluid compute is on and the plan tier; the deployed revision includes branch 18.

## 2. Item 1 — raise the function limit and the runtime cap

Config-only. Removes the timeout worry for the single-generation case on every plan.

Changes:

- `vercel.json` → `functions["api/index.ts"].maxDuration: 300`. Add an explicit entry for `api/queues/sales-intelligence-consumer.ts` with `maxDuration: 300` (keep its `experimentalTriggers`). On Pro, 800 is available; decide with the user, default 300.
- `analysis/runtime.ts` → `runtimeLimitsSchema.elapsed_ms` maximum 240,000; `DEFAULT_RUNTIME_LIMITS.elapsed_ms` 200,000. Leave steps, context and token totals as 18 set them; they are what keeps the reservation at 18¢ under the 25¢ ceiling at production pricing (20 / 120 ¢ per million).
- `analysis/worker.ts` → derive `INTELLIGENCE_DRAIN_BUDGET_MS` from the function limit rather than a literal: export a `CSI_FUNCTION_MAX_DURATION_MS = 300_000` constant (or read `vercel.json` in a test that pins them equal) and set the drain budget to that minus a 15 s margin. Keep the rule that an invocation starts only if `elapsed_ms + 5 s` fits.
- `runtime.test.ts` → change the assertion to `elapsed_ms + 10_000 <= CSI_FUNCTION_MAX_DURATION_MS` and add a test that reads `vercel.json` and asserts both the API and consumer entries carry that value, the way `wiring.test.ts` already reads the crons.
- Job lease: `claimCsiJob` leases analysis jobs for 300 s and `renewCsiJob` exists. With a 200 s runtime plus preparation, a run can approach the lease. Either renew the lease after evidence capture (before `beforeProvider`) or claim analysis and number_refresh with a 600 s TTL (the schema allows up to 900 s). Prefer the renewal; it keeps recovery fast for crashed claims.
- STT is unaffected: `transcribe.ts` aborts the provider at 90 s and its cron runs inside the same function.

Acceptance: typecheck and unit tests pass; `pnpm test:csi:runtime:replica` and `pnpm test:csi15:budget:replica` pass (the Docker `csi01` replica on 27189, see 18 §4); a deployed extract cron invocation with one real provider call finishes without a killed function and with a reconciled reservation.

## 3. Item 2 — queue consumer as the analysis path, cron as recovery

Today both paths run the same worker. The queue consumer (`api/queues/sales-intelligence-consumer.ts` → `dispatchCsiWakeup` → `defaultStageHandlers().analysis` → `runIntelligenceJob(jobId, "analysis")`) receives one message per job and has its own duration. The extract cron (`drainIntelligenceJobs`) resumes paused work, recovers receipts, scans changes, and then also runs jobs in a loop.

Changes:

- **Publish a wake-up for every job that becomes runnable, not only for newly enqueued ones.** Today `publishCaptureProjectionWakeup` is called after transcription enqueues `analysis`, after discovery enqueues media, and after a submission enqueues application. Jobs that become runnable by *resume* get no wake-up: `resumeBudgetPausedJobs`, `updateCsiPolicy`'s resume, `resumeApplicationIntents`, `recoverExhaustedIntelligenceReceipts`, `resumeTranscriptAnalysisJobs`, and `scheduleNumberIntelligence` (which enqueues `number_refresh` with a 15 s delay and never publishes). Add a small `publishRunnableWakeups(session?)` helper that, after any of these commit, publishes `{ job_id }` for each affected id, best-effort, exactly as the existing publisher does. Delivery loss is already covered by cron recovery, so duplicates and drops are safe.
- **Note `shouldPublishSalesIntelligenceQueue`:** it publishes only when `VERCEL === "1"` and `VERCEL_REGION` is set, never in test mode or on a local worker. Keep that gate; a local worker (18 §6 and the user's stated preference for filesystem agents) claims jobs directly and does not need messages.
- **Cron becomes recovery.** In `drainIntelligenceJobs`, keep the preparation steps and the change scan, then run the loop only when the queue is not available (`!shouldPublishSalesIntelligenceQueue()`) or for jobs whose `next_attempt_at` is older than a recovery threshold (for example ten minutes), which means a wake-up was lost. When the queue is available, the cron's normal outcome is "nothing overdue". Keep `max` and the deadline so a lost-message backlog still drains.
- **Consumer duration.** With Item 1 the consumer runs one job within 300 s. Keep the claim in `dispatchCsiWakeup` (a stale or duplicate message hits the claim fence and returns `not_claimable`).
- **Ordering guard already exists:** `claimCsiJob` refuses to let a specific historical job id jump ahead of due live AI work; keep it.

Acceptance: a transcription completing in production leads to an analysis run without waiting for the five-minute cron; a job resumed by a policy change starts within a minute; killing the queue (simulate `shouldPublish` false in a replica test) still drains everything through the cron; `wiring.test.ts` and the replica budget suite pass. Report p50/p95 transcript-to-submitted latency before and after from `intelligence_runs.started_at` versus the transcription job's `completed_at`.

## 4. Item 3 — cut tokens per run

Goal from 17 §8: a typical resolved conversation submits in one step, with the model receiving the relevant evidence once and no more tool surface than the run can use. Three sub-items, each measured on frozen fixtures before and after (`analysis/runtimeFlow.test.ts` already drives the real MCP handler and a mock model; extend it to record the byte size of `tools`, the schema, the instructions and the evidence prompt per scenario).

### 4.1 Per-run tool allowlist

Today `run.ts` stores `permitted_tools: [...CSI_TOOLS]` on every run, the run token carries the same list (`auth.ts` `tools` claim, verified by `lease.ts` and by the MCP's `auth.ts`), the MCP registers all twelve tools statically (`vantage-movers-mcp/lib/intelligence/registration.ts`), and `runtime.ts` fails `contract_mismatch` unless `listTools` returns exactly `CSI_TOOLS.length` tools.

Change all four together:

- `run.ts`: derive `permitted_tools` from the run. A conversation run with a pinned transcript and a resolved subject needs `submit_intelligence_analysis` plus at most `get_call_transcript` (for a paging cursor) and `get_intelligence_context`. Number synthesis needs the transcript and activity tools. Grant `search_ringcentral_calls`, `get_ringcentral_call` and `query_operational_records` only when a run is prepared with an explicit reason (`PROVIDER_READS` on and the subject has a coverage gap), and record that reason on the run. `submit_intelligence_analysis` is always present; the MCP already refuses a token without it.
- Token: unchanged shape; it already carries the list.
- MCP `registration.ts`: register only the tools named in the verified token's claims for that request, or keep static registration but have `listTools` filter by the token. The MCP `auth.ts` already freezes `claims.tools`; use it. Every tool call must still be checked against the claim (it is, in `lease.ts` and the MCP auth).
- `runtime.ts`: replace the equality check with "the listed tools are exactly the run's `permitted_tools`" (pass the list into `InvocationInput`). Keep `contract_mismatch` for any extra or missing tool.
- `prepareStep` `activeTools` stays a presentation control only.

Expected effect: the `tools` object drops from ~45 KB to roughly a fifth for the common conversation run; the model has fewer ways to wander into `bounds_exhausted`.

### 4.2 Schema compaction with a versioned digest

`intelligenceSchemaDigest()` hashes `z.toJSONSchema(intelligenceEnvelopeSchema)` and the MCP serves the same generated schema as the `csi://schemas/csi-envelope-v1` resource; runs pin the digest and `original_evidence` reruns require the parent's digest to match.

- Generate the schema with `$defs`/`$ref` reuse for repeated sub-objects (evidence references, citations, nullable date resolution) and drop descriptions that duplicate the prompt. Do this in one shared generator used by both `run.ts` and the MCP resource so the digest cannot drift.
- Bump `schema_version` to `csi-envelope-v2` (or keep v1 and version the digest) and keep the v1 generator available so old runs replay against their pinned digest. Do not repin historical runs; `original_evidence` reruns of v1 runs must either use the v1 schema or surface `ORIGINAL_EVIDENCE_UNAVAILABLE`, never silently use v2.
- Keep every server-side refinement in `intelligenceEnvelope.validation.ts`; compaction changes the JSON Schema artifact, not the Zod contract.
- Test through both adapters: `z.fromJSONSchema` in `runtime.ts` (used to build SDK tool input schemas from MCP definitions) and the provider path, on the existing `runtimeFlow.test.ts` scenarios (server-invalid, sdk-invalid, exhausted, repair-read, wrong-receipt, transport-error).

### 4.3 Prompt prefix stability for caching, and evidence ordering

- Put everything static first and identical across runs of the same prompt version: instructions, then the tool definitions, then the schema reference; put per-run material (subject binding, Owner corrections, evidence prompt) after. Today the subject binding is appended to the instructions (`renderIntelligencePrompt`), which breaks the shared prefix across runs; move it into the evidence message. Pinned prompts of existing runs are unaffected (they keep their rendered text).
- For OpenAI models through the AI Gateway, prefix caching is automatic once the identical prefix is long enough; verify by reading cached-token counts from `providerMetadata` in `onStep` and record them on the reservation next to `input_tokens`. If the Gateway or model does not report them, say so in the report; do not assume savings.
- Measure the evidence prompt: the citation inventory repeats every record id and field path already present in the captured pages. Keep it (it is what makes citations locatable) but drop `field_paths` for record types the schema cannot cite, and cap the transcript segment id list to a range when segments are contiguous.

### 4.4 Fewer malformed first submissions

Schema-exhausted runs are the expensive failure. Before changing prompts, pull the stored `validation` on findings from the paused runs (`intelligence_findings.validation`, `intelligence_submissions` rejections) and classify the first-submit failures: missing nullable fields, citation membership, field path spelling, summary reference keys. Fix the top two causes in the prompt or by relaxing a server refinement that is stricter than the contract requires, with a test per cause. Target from 17 §11: first-submit validity high enough that a typical run needs at most one repair.

Acceptance for Item 3: on the frozen fixtures, bytes of `tools` and schema per step down by the measured amount; on production after deploy, `intelligence_runs.usage.input_tokens` per completed conversation run down, cached tokens reported when available, `schema_exhausted` share down, no regression in the replica runtime suite's attribution and effect outcomes, and reruns of pre-change runs still work or fail loudly.

## 5. Sequencing and decisions for the user

1. Item 1 first, deploy, watch one day: stranded reservations stop, admission stays `admitted`.
2. Item 2, deploy: latency from transcript to submitted drops from minutes-to-hours to seconds.
3. Item 3.1 and 3.3 together (they touch the same runtime file), then 3.2, then 3.4 driven by the failure classification.

Decisions to confirm before implementing: function limit 300 versus 800 (plan-dependent); whether provider-read tools are ever granted automatically or only on an Owner request; whether to bump to `csi-envelope-v2` or version the digest under v1.

Out of scope here: moving analysis to a worker outside Vercel (18 §6, still the escape hatch if runs ever need more than the function allows), Vercel Workflows, and any provider change.
