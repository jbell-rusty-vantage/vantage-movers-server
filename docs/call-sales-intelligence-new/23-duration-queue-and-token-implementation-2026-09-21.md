# 23 — Implementation of 22: invocation duration, queue-first execution, tokens per run

Date: September 21, 2026. Implements [22](22-analysis-duration-and-token-reduction-task.md) on top of
the 18 work already merged to `main` (`1d816e7`). Written before the change and completed with
measured results at the end.

## 0. Baseline measured before any change

Read-only aggregates over `csi-production` / `vantagemovers`, plus byte counts of the generated
contract artifact.

Intelligence Runs by status and reason:

| status | reason | runs | avg in | avg out |
|---|---|---:|---:|---:|
| paused | budget_exhausted | 377 | — | — |
| paused | schema_exhausted | 14 | 44,930 | 10,759 |
| paused | bounds_exhausted | 10 | 18,767 | 6,229 |
| running | analysis_failed | 12 | ~18k | ~4k |
| completed | — (0 repairs) | 6 | 15,817 | 3,195 |
| completed | — (1 repair) | 5 | 47,598 | 7,928 |
| paused | contract_mismatch | 3 | ~24k | ~9k |
| failed | analysis_failed | 2 | 113,903 | 20,327 |

Reservations: **59 analysis reservations stranded** in `reserved` with `provider_started: true`
and `actual_cents: 0`, holding **$11.10**; 17 stranded STT reservations holding $1.61. That held
reservation is why 377 analysis jobs sit `budget_exhausted` against the $80 monthly ceiling.
Nothing reconciles a reservation whose function was killed: `runIntelligenceJob`'s `finally`
only runs when the process survives.

Contract bytes (`z.toJSONSchema`, UTF-8):

| artifact | bytes |
|---|---:|
| envelope schema, inline (today) | 41,424 |
| envelope schema, `reused: "ref"` | 16,646 |
| `tools` object, all twelve (today) | 45,682 |
| — of which `submit_intelligence_analysis` | 41,605 |
| — of which the eleven read tools | 4,077 |
| prompt template | 3,207 |

The headline correction to 22 §4.1's expectation: the tool surface is not eleven read tools plus
one submit tool of comparable size. **91% of the `tools` object is the inlined envelope schema on
`submit_intelligence_analysis`.** A per-run allowlist alone removes at most ~3 KB. The compaction
in §4.2 is the lever, and it applies to the tool schema as well as the resource.

## 1. Decisions taken

1. **Function limit 800 s** (Owner confirmed Pro/Enterprise). Runtime cap 240 s maximum,
   200 s default, as 22 §2 specifies; the extra function headroom goes to the cron drain loop,
   not to a single invocation.
2. **Provider-read tools are never granted automatically to an ordinary run.** They are granted
   only on an explicit, recorded reason: an Owner-requested reanalysis, or `PROVIDER_READS` on
   *and* the captured coverage for the subject reports a gap. Rationale: pre-capture already
   supplies context, activity, leads, bookings, rep identity and the transcript; ten runs reached
   `bounds_exhausted` and none shows a provider read adding evidence. The grant reason is stored
   on the run so the choice is auditable, not guessed later.
3. **Envelope stays `csi-envelope-v1`; the JSON Schema artifact is versioned.** The Zod contract
   accepts exactly the same documents — only the rendering changes. Bumping the envelope's own
   `schema_version` literal would invalidate every stored submission and the apply path for no
   contract change. The MCP serves both artifact revisions at distinct URIs; the runtime resolves
   the URI from the run's pinned digest, so pre-change runs replay and an unknown digest is
   `contract_mismatch`, never a silent substitution.

## 2. Phases

### Phase 1 — duration, caps, lease and the stranded reservations (22 §2)

- `vercel.json`: `api/index.ts` and `api/queues/sales-intelligence-consumer.ts` both at
  `maxDuration: 800`, the consumer keeping its `experimentalTriggers`.
- `analysis/runtime.ts`: `elapsed_ms` maximum 240,000, default 200,000. Steps, context and token
  totals unchanged, so the reservation stays at 18¢ under the 25¢ ceiling.
- `analysis/worker.ts`: export `CSI_FUNCTION_MAX_DURATION_MS`; derive the drain budget from it
  minus a 15 s margin instead of a literal.
- Lease: renew the analysis lease after evidence capture, in `beforeProvider`, so the 200 s
  provider phase starts against a fresh 300 s lease instead of the remains of the claim.
- New: `recoverStrandedCsiReservations()`. A reservation still `reserved` whose job is no longer
  leased at that epoch and which is older than the recovery threshold is reconciled at its
  observed cents (or released when the provider never started). Without it, one killed function
  permanently subtracts its estimate from the monthly ceiling — which is the state production is
  in now. Runs in the extract cron's preparation.
- Tests: `runtime.test.ts` asserts against `CSI_FUNCTION_MAX_DURATION_MS` and reads `vercel.json`
  for both entries, the way `wiring.test.ts` reads the crons.

### Phase 2 — queue consumer as the analysis path, cron as recovery (22 §3)

- `publishRunnableWakeups(ids)`: best-effort `{ job_id }` per newly runnable job, same publisher
  and same gate as today.
- Every resume path returns the ids it made runnable and publishes after its transaction commits:
  `resumeBudgetPausedJobs`, `updateCsiPolicy`'s resume, `resumeApplicationIntents`,
  `recoverExhaustedIntelligenceReceipts`, `resumeTranscriptAnalysisJobs`,
  `scheduleNumberIntelligence`.
- `drainIntelligenceJobs` keeps preparation and the change scan, and runs jobs only when the queue
  is unavailable or a job is overdue past the recovery threshold — a lost wake-up.

### Phase 3 — per-run tool allowlist and prompt prefix stability (22 §4.1, §4.3)

- `analysis/tools.ts` derives `permitted_tools` from the run's mode and subject; `run.ts` stores
  it and the grant reason; `runtime.ts` requires `listTools` to equal it exactly.
- The pinned prompt becomes the static template alone. The subject binding and Owner corrections
  move into the evidence message, so every run of a prompt version shares a byte-identical prefix.
  `CSI_PROMPT_VERSION` becomes `sales_intelligence_analyze_v2`; the MCP keeps serving v1 for runs
  pinned to it.
- Cached input tokens are read from `providerMetadata` per step and recorded on the reservation.
- The citation inventory keeps every id but stops repeating identical field-path lists per record
  and collapses contiguous transcript segment ids to a range.

### Phase 4 — schema compaction with a versioned digest (22 §4.2)

- One shared generator produces both artifact revisions; `run.ts` and the MCP resource use it, so
  the digest cannot drift. The tool schemas are `$ref`-compacted by the same generator.
- `runtime.ts` passes the MCP's JSON Schema straight through to the provider instead of
  re-deriving it from Zod, because the SDK's Zod path re-inlines `$ref`s and would throw the
  saving away on the wire. Zod still validates every tool call.

### Phase 5 — fewer malformed first submissions (22 §4.4)

Nothing today records *why* a submission was rejected: the MCP returns the issue paths to the
model and the server stores nothing. `intelligence_findings.validation` is about post-application
locator and entailment checks, not first-submit shape. So the first change is to persist the
rejected paths on the run, then classify, then fix.

## 3. Results

### 3.1 Measured on frozen fixtures

`runtimeFlow.test.ts` now records the wire size of the tool definitions, the
instructions and the evidence message for every scenario it already drove
(server-invalid, sdk-invalid, exhausted, scope-error, scope-repaired,
old-prompt, repair-read, wrong-receipt, transport-error) and prints them.

| per provider step | before | after |
|---|---:|---:|
| `tools` reaching the model | 45,682 B (twelve, inlined) | **18,598 B** (three, `$ref`) |
| envelope JSON Schema | 41,424 B | **16,646 B** |
| `submit_intelligence_analysis` schema | 41,605 B | **16,827 B** |
| instructions (system prompt) | per-run, never cacheable | **3,246 B, byte-identical across runs** |
| evidence message | — | 3,536 B on the fixture |

The instructions figure is the point of §4.3: every v2 scenario reports the same
3,246 bytes, and the test asserts the run id and the subject binding are absent
from that prefix and present in the evidence message. Whether the Gateway
actually serves it from cache is not assumed — `cachedInputTokens` reads it from
`providerMetadata` per step and records it on the reservation and the run, and
records null when nothing is reported.

### 3.2 What each item changed

**Item 1.** `vercel.json` carries `maxDuration: 800` for `api/index.ts` and for
the Sales Intelligence consumer; `runtime.ts` allows 240 s and defaults to
200 s; `CSI_FUNCTION_MAX_DURATION_MS` is the one number both the drain budget
and two tests read, and one of those tests reads `vercel.json` and asserts the
two entries agree. The analysis lease is renewed to a fresh 300 s in
`beforeProvider`, after capture. `recoverStrandedCsiReservations` is new and is
the durable answer to the 59 stranded reservations: raising the limit removes
the common cause but not the case.

**Item 2.** `publishRunnableWakeups` wakes every job a resume releases, from all
six resume paths plus the policy resume, always after the transaction commits.
The extract cron now runs its loop only when there is no queue or when a job is
overdue past ten minutes. Its normal healthy outcome becomes `queue_dispatched`
with `recovery_ran: false`.

**Item 3.1.** `permitted_tools` is derived per run. The reduction is five tools,
not nine, and the reason is worth recording: **evidence capture uses the same
run token as the model**, so the token must keep every read the worker itself
makes (`list_number_activity`, `search_leads`, `search_bookings`,
`get_rep_identity`, `get_call_transcript`, `get_intelligence_context`). What the
*model* sees is narrowed separately, through `activeTools`, to the three tools
still useful after capture — and that is what removes both the wandering and the
bytes. `original_evidence` replays carry exactly their parent's tools, so a read
the parent never made is now refused by authority rather than by the evidence
check.

**Item 3.2.** `analysis/schemaArtifact.ts` is the single generator; the MCP
serves every revision at its own URI and the runtime resolves the URI from the
run's pinned digest. One detail decided the outcome: the MCP registered its
tools with a Zod type rebuilt from the artifact, and both the MCP SDK and the AI
SDK convert Zod with `reused: "inline"` — so the compaction would have been
undone twice on the way to the provider. Both sides now publish the generated
JSON Schema verbatim and keep Zod only as the validator.

**Item 3.3.** Covered above. The citation inventory also stopped repeating an
identical `field_paths` array once per record (records are grouped by type and
projection) and collapses contiguous transcript segment ids to ranges, with gaps
preserved because a gap means redaction dropped a segment.

**Item 3.4.** Partly done, and the part that is not done could not be done yet.

### 3.3 Item 3.4, honestly

22 §4.4 asks to pull the stored `validation` from paused runs and classify the
first-submit failures. That data does not exist. `intelligence_findings.validation`
is the post-application locator and entailment record, not envelope shape;
`intelligence_runs.raw_output` is declared and never written; and a rejected
submission is not stored at all — the MCP returns the issue paths to the model
and the server keeps nothing but a counter. So the classification was not
skipped, it was unanswerable.

What was done instead:

1. **The paths are now recorded.** `schema_rejections` on the run keeps the
   bounded `path:code` pairs of every definite rejection.
2. **`scripts/dev_ops/classify-csi-schema-rejections.ts`** (`pnpm
   measure:csi:rejections`) ranks them by cause, collapsing array indexes so
   `findings.3.evidence.0` and `findings.11.evidence.2` count once. Run today it
   prints "No stored rejections yet", which is the correct answer.
3. **One cause was fixable from the code alone, and it is the one §4.4 names
   first.** A citation-membership failure threw `EVIDENCE_SCOPE_INVALID` with no
   issues, the MCP forwarded a bare code, and `runtime.ts` treated any
   non-`INVALID_INPUT` code as uncertain delivery and aborted the run. So the
   single failure class most likely to be a first-submit mistake was both
   unexplained and unrepairable. `validateEnvelopeEvidence` now reports the
   offending finding and reference as paths with reasons
   (`snapshot_not_captured`, `citation_not_on_snapshot`,
   `field_path_not_exposed`, `speaker_ref_not_listed`, `followup_not_allowed`,
   `instruction_revision_not_observed`), `CsiError` carries them, the internal
   route forwards them, and the runtime treats the rejection as repairable —
   which it is, since nothing was committed. Never the submitted id: a value the
   model invented is not safe to reflect back, and the position locates it.

The second cause 22 asks for is deliberately not guessed. Re-run
`pnpm measure:csi:rejections` after a day of traffic; the ranking it prints is
the evidence the next fix should rest on.

### 3.4 Verification

- `pnpm typecheck` clean. (Two pre-existing errors in the untracked
  `scripts/inspect-csi-owner-demo-candidates.ts` and
  `scripts/run-csi-owner-demo-backfill.ts` are from the 19 owner-demo work and
  are not touched here.)
- `pnpm test`: 2,615 tests pass.
- MCP `lib/intelligence/transport.test.ts`: 11 pass; `npx tsc --noEmit` clean in
  that repo.
- Replica suites (`test:csi:runtime:replica`, `test:csi15:budget:replica`) were
  attempted on September 21 after port 27189 accepted TCP. Both failed in
  `connectMongo` with `ReplicaSetNoPrimary` (set name `csi01`, no election). A
  later direct hello timed out, and the Docker engine API did not answer, so
  `docker start csi01` could not be issued. Their assertions were updated for
  the changed return shapes (`resumeTranscriptAnalysisJobs`,
  `recoverExhaustedIntelligenceReceipts`) and for the tighter replay refusal.
  They still need a pass once the replica has a primary.

### 3.5 Before deploying

1. Confirm the Vercel project is Pro or Enterprise with Fluid compute on. 800 s
   is rejected on Hobby; if the plan is Hobby, set `CSI_FUNCTION_MAX_DURATION_MS`
   to 300,000 and `vercel.json` to 300 — the test that reads the file will hold
   them together.
2. Start the `csi01` replica and run the two replica suites.
3. After the first extract cron, check that `recoverStrandedCsiReservations`
   released the 59 stranded analysis reservations and the 17 STT ones, and that
   the 377 `budget_exhausted` jobs resumed.
4. Report p50/p95 transcript-to-submitted latency from `intelligence_runs.started_at`
   against the transcription job's `completed_at`, before and after — 22 §3 asks
   for it and it needs post-deploy data.
