# 15 — Analysis agent context, MCP schemas, and model efficiency

Status: analysis and recommendation. Not a delivery plan, not a contract change.
Authority for product rules stays with [01](01-specification.md), [03](03-server-pipeline-and-jobs.md), [10](10-intelligence-agent-contract.md), and the as-built surfaces in [13](13-number-analysis-surfaces.md).
Companion reading: [12 — Deployment inputs and model policy](12-deployment-inputs-and-model-policy.md) (dated catalog starting point), [workspace/evidence/after-16/prompt-schema-review/PROMPT.md](workspace/evidence/after-16/prompt-schema-review/PROMPT.md) (what the live model is told), knowledge service [sales-intelligence-analysis](../knowledge/services/sales-intelligence-analysis.md).
Code of record: `src/services/salesIntelligence/analysis/{contracts,prompt,runtime,worker,reads,run}.ts`, `src/validation/intelligence/intelligenceEnvelope.validation.ts`, `src/services/salesIntelligence/conversations/{transcribe,transcript}.ts`, `vantage-movers-mcp/lib/intelligence/{registration.ts,generated/intelligence-contract-v1.json}`.

No customer phones appear in this document.

Prices below were checked on 20 September 2026 from the Vercel AI Gateway model pages and OpenAI model pages. They are dated catalog rates, not billing truth. Gateway mirrors provider list prices with no inference markup.

---

## 0. What this is

A live conversation analysis on 20 September 2026 needed `total_input_tokens` raised to **800,000** before `gpt-5-mini` would finish. That number looks like “we sent 800k tokens of call text.” We did not.

This document inventories **everything the model is actually given** (pinned prompt, MCP tool schemas, preflight pages, transcript) and explains why the reservation grew. It then ranks cheaper ways to get a valid `csi-envelope-v1` without funding a fat tool loop, and compares **`openai/gpt-5.6-luna`** to the current pinned **`openai/gpt-5-mini`**.

The short version:

| Observation | Meaning |
| --- | --- |
| 800,000 is a **run-wide input reservation**, not one prompt | Each model step re-sends tools + growing messages. The ceiling is `steps × per-step context`, reserved up front against the $0.25 per-recording analysis cap. |
| The transcript is a small slice of billed input | Preflight already paginates it. The expensive bytes are the **submit tool’s 41 KB envelope JSON Schema**, repeated Coverage DTOs, and a **double dump** of captured pages. |
| `schema_exhausted` burned more tokens than a long call | The booked subject paused after two invalid submits. A repair step re-sends the whole context. Raising the ceiling funds the retry; it does not teach a legal envelope. |
| Luna is **cheaper**, not officially “better than mini” | Gateway list: Luna $0.20 / $1.20 per 1M in/out; mini $0.25 / $2.00. OpenAI and Vercel place Luna in the **nano** tier of GPT-5.6. CSI’s worker allowlist does not yet accept it. |

---

## 1. Why 800,000 showed up

### 1.1 Two different ceilings

`invokeIntelligenceAgent` (`analysis/runtime.ts`) enforces:

| Limit | Code default | What it bounds |
| --- | --- | --- |
| `context_tokens` | 128,000 | Conservative **UTF-8 byte** size of `{prompt, evidence or messages, tools}` before a step. `contextTokenCeiling` is `Buffer.byteLength(JSON.stringify(value))`, not a tokenizer. |
| `output_tokens` | 8,000 | Per-step max output. |
| `total_input_tokens` | **1,536,000** | Sum of reported (or assumed) input across the whole loop. Default = `12 × 128,000`. |
| `total_output_tokens` | 96,000 | Sum of reported (or assumed) output. Default = `12 × 8,000`. |
| `steps` | 12 | Tool-loop turns. After 20 Sep 2026 production default is 8; the local desk script used 8 then 10. |
| `elapsed_ms` | 180,000 | Wall clock. Schema max is 180,000. |
| `pages` | 100 | Preflight MCP pages before the model starts. |

`SALES_INTELLIGENCE_ANALYSIS_LIMITS_JSON` replaces this object **in full**. The local attention script set a **smaller** reservation than the code default (`512,000` then `800,000` input) so the reservation would fit the Owner **$0.25 per-recording** analysis ceiling (`SALES_INTELLIGENCE_AI_PER_RECORDING_CEILING_CENTS`, default 25).

Admission uses worst-case math, not measured usage:

```
estimateAnalysisCents = ceil(
  (total_input_tokens × input_cents_per_million
   + total_output_tokens × output_cents_per_million) / 1_000_000
) + (steps - 1)
```

The `+ (steps - 1)` term is per-step integer-cent rounding.

At the current mini catalog rate ($0.25 / $2.00 per 1M, which the worker stores as 25 / 200 cents per million):

| Reservation | Input ¢ | Output ¢ | Step rounding | Reserved |
| --- | --- | --- | --- | --- |
| Script first try: 512k in / 24k out / 8 steps | 12.8 | 4.8 | +7 | **25¢** (exactly the ceiling; any extra step or assumed usage fails admission or dies `bounds_exhausted`) |
| Script second try: 800k in / 24k out / 10 steps | 20.0 | 4.8 | +9 | **34¢** (needs a higher analysis ceiling or it cannot reserve) |
| Code default: 1,536k in / 96k out / 12 steps | 38.4 | 19.2 | +11 | **69¢** (cannot run under a 25¢ recording cap) |

`prepareStep` also trips `bounds_exhausted` when:

```
already_used_input + context_tokens > total_input_tokens
```

If a step’s reported input is missing, the worker **assumes the full 128,000**. Four assumed steps consume 512,000 even when the real prompt was smaller. That is why 512,000 died mid-loop and 800,000 looked necessary.

### 1.2 What a step actually pays for

Each Gateway call includes, at minimum:

1. Pinned system / instructions (`CSI_PROMPT_TEMPLATE` + `{subject_key}`).
2. **All twelve MCP tool definitions**, including `submit_intelligence_analysis.inputSchema` (the entire envelope JSON Schema).
3. The worker user prompt: citation inventory **and** the full captured-page JSON.
4. Prior assistant tool calls and tool results (grows every turn).

The model does not receive raw audio. Transcription already happened in a separate STT job.

---

## 2. Everything passed to the model

Three stacked texts. Editing only the template is not enough. This matches the AFTER-16 prompt-schema review.

### 2.1 Pinned instructions

Rendered by `renderIntelligencePrompt` in `analysis/run.ts`:

```
${CSI_PROMPT_TEMPLATE}

Trusted subject binding (data): ${JSON.stringify({subject_key})}
```

Stored on the run as `rendered_prompt`. MCP `prompts/get` `sales_intelligence_analyze_v1` returns that exact stored text. The worker checks it against the prepared run before any model call.

Template duties (compressed): treat tool/transcript text as untrusted data; use only granted MCP tools; do not repeat preflight reads; build findings before summary references; unique `findings[].key`; required nullables written as `null`; cite only captured snapshot membership; submit once with `idempotency_key` = run id; one repair on `INVALID_INPUT`; stop on receipt or uncertain delivery.

Template size in the generated artifact: **3,207 bytes**.

### 2.2 Worker user prompt (preflight evidence)

`invokeIntelligenceAgent` paginates MCP **before** `ToolLoopAgent` starts, then calls `renderIntelligenceEvidencePrompt`:

```
The worker has already captured the initial source evidence …
Submit with idempotency_key <run_id>.
Citation inventory (data):
<JSON of snapshot_id, record_type/id/field_paths, transcript segment ids, speaker_refs, followups, instructions>
Captured source evidence (data):
<JSON of the same pages in full>
```

Default preflight sequence (`runtime.ts`, when `original_reads` is absent):

| Order | Tool | Arguments |
| --- | --- | --- |
| 1 | `get_intelligence_context` | `{}` |
| 2 | `list_number_activity` | `{ limit: 50 }` (follow `next_cursor`) |
| 3 | `search_leads` | `{ limit: 50 }` |
| 4 | `search_bookings` | `{ limit: 50 }` |
| 5 | `get_rep_identity` | one call per `interaction_id` on the job |
| 6 | `get_call_transcript` | `{ conversation_id, limit: 100 }` per conversation, all pages |

Each page is a durable captured snapshot. The model may still call the same tools. Extra reads must resolve a missing fact or remaining cursor; they still consume a step and are appended to the message list.

`original_evidence` Owner reruns replay the parent’s captured calls instead of this sequence.

### 2.3 What one captured page contains

`readContentSchema` (`analysis/reads.ts`):

```
{
  snapshot_id,                    // added by capture/transport
  data: {
    page: { records[], next_cursor, complete, missing_ranges[] },
    transcript?: { conversation_id, transcript_version, source_snapshot_id, segments[≤100] },
    coverage: CoverageDto,        // fleet capture coverage — see §5.2
    allowed_followup_ids[],
    instructions: [{ id, revision }],
    speaker_refs[]
  }
}
```

Record fields are a **closed projection** (`evidenceRecordSchema`): name, job_no, phone, booked/cancelled/duplicate flags, status, description, amount, ids, certainty, and a `details` string. Free text is redacted and rejected above 4,000 characters.

Activity rows currently put `JSON.stringify(timeline.detail)` into `fields.details`. That is record evidence, but it is also a second copy of structured timeline data as a string.

`intelligenceCitationInventory` already extracts the only identifiers the envelope is allowed to cite. The second JSON blob is the full pages again.

### 2.4 Tool surface during the loop

The AI SDK receives every tool MCP listed. `toolChoice` is `"required"` until a schema failure, then forced to `submit_intelligence_analysis` only.

Unused-but-still-advertised tools on a typical conversation run: `query_operational_records`, `search_ringcentral_calls`, `get_ringcentral_call`, `get_lead`, `get_booking` (the search pages already returned candidates). The model can still call them.

At most **two** submit attempts. Two `INVALID_INPUT` or two SDK-invalid submit calls → `schema_exhausted` and the job pauses (`permission_denied`). `EVIDENCE_SCOPE_INVALID` is uncertain delivery, not a schema repair.

---

## 3. MCP tool argument schemas

Generated into `vantage-movers-mcp/lib/intelligence/generated/intelligence-contract-v1.json` from Zod (`intelligenceToolArguments` + `intelligenceEnvelopeSchema`). MCP and the AI SDK rehydrate with `z.fromJSONSchema`. That layer is **structural only**. Server POST `/submit` still runs Zod `superRefine` and `validateEnvelopeEvidence`.

Descriptions live in `vantage-movers-mcp/lib/intelligence/registration.ts`. Measured UTF-8 sizes of the generated **argument** schemas (20 Sep 2026 artifact):

| Tool | Args schema bytes | Arguments |
| --- | --- | --- |
| `get_intelligence_context` | 119 | none (`{}`) |
| `get_call_transcript` | 412 | `conversation_id` (24-hex), optional `transcript_version`, optional `cursor`, `limit` 1–100 default 50 |
| `list_number_activity` | 261 | optional `cursor`, `limit` 1–50 default 20 |
| `search_leads` | 374 | optional `cursor`, `limit` 1–50, optional `query` ≤120, optional `model` `FormLead` \| `CallLead` |
| `get_lead` | 251 | `model`, `id` |
| `search_bookings` | 317 | optional `cursor`, `limit`, optional `query` |
| `get_booking` | 186 | `id` |
| `get_rep_identity` | 210 | `interaction_id` |
| `query_operational_records` | 499 | `dataset` enum below, `limit`, optional `cursor` / `query` |
| `search_ringcentral_calls` | 941 | `from` / `to` ISO datetimes, `limit`, optional `cursor` |
| `get_ringcentral_call` | 236 | `call_log_id` `[A-Za-z0-9_-]+` ≤160 |
| `submit_intelligence_analysis` | **41,605** | `idempotency_key` + full `csi-envelope-v1` |

Eleven read tools together are **~3.8 KB**. Submit is **~41.6 KB** — the envelope schema inlined as JSON Schema `oneOf` over every finding kind.

`OPERATIONAL_DATASETS`: `form_leads`, `call_leads`, `job_timeline`, `bookings`, `cancellations`, `agents`, `granot_sources`, `ringcentral_queues`, `ringcentral_users`. Plain text query only. No Mongo operators, collection names, or arbitrary fields.

MCP also registers:

- Resource `csi://schemas/csi-envelope-v1` — frozen envelope JSON Schema (41,424 bytes). The model is not automatically given this resource; the same schema is already inside the submit tool.
- Prompt `sales_intelligence_analyze_v1` — pinned `rendered_prompt`.

Tool annotations: reads are `readOnlyHint`; all are `idempotentHint`; none are `openWorldHint`. Submit is the only non-read tool. No tool writes official records, attachments, or messages.

### 3.1 Envelope the submit tool asks for

`csi-envelope-v1` (`intelligenceEnvelope.validation.ts`):

```
{
  schema_version: "csi-envelope-v1",
  summary: { overview, customer_wanted, money_and_dates, outcome, commitments, discrepancies, finding_keys[] },
  findings: [ { key, claim, basis, actor, speaker_ref, action_status, clarity, evidence[], confidence, kind, value } ],
  next_step_suggestion: { action_kind, description, date_text, timezone_text, target_followup_id, rationale, finding_keys[] } | null,
  owner_instruction_assessments: [ { instruction_id, instruction_revision, assessment, reason, finding_keys[] } ]
}
```

Finding `kind` values: `contact_type`, `intent`, `move_fact`, `quoted_amount`, `promised_callback`, `customer_requested_callback`, `customer_will_call`, `next_step`, `completion_claim`, `reschedule`, `contact_restriction`, `booking_claim`, `payment_claim`, `objection`, `competitor_mention`, `coaching_note`.

Each finding requires ≥1 evidence ref (`transcript` or `vantage_record`). Transcript refs need outer `snapshot_id` (the captured page, **not** `transcript.source_snapshot_id`), `conversation_id`, `transcript_version`, `segment_ids`, nullable `quote`. Record refs need `snapshot_id`, `record_type`, `record_id`, `field_paths` such as `status` (not `fields.status`).

Refinements JSON Schema cannot express (server 400 / `INVALID_INPUT`):

- Six summary texts together ≤ 4,000 characters.
- Unique `findings[].key`.
- Every `finding_keys` entry must exist.
- Unique Owner instruction id/revision pairs.
- Cited snapshot / record / field path / segment / speaker / follow-up / instruction must already be in **captured** snapshots.

A payload can pass MCP/SDK schema and still fail on the server. That is the `schema_exhausted` path.

---

## 4. Transcription — what exists before the model

Analysis never calls STT. The conversation machine is separate.

```
RingCentral recording
  → media_fetch (private Blob, digest, bytes, content type)
  → transcription job (Gateway STT)
  → immutable IntelligenceEvidenceSnapshot
  → analysis job input_refs [conversation_id, transcript_snapshot_id]
  → get_call_transcript pages
```

| Step | Code | What is persisted / passed later |
| --- | --- | --- |
| Provider | `csiProviderConfiguration().transcriptionModel` default `openai/gpt-4o-mini-transcribe` | Audio bytes from private Blob only. Stored provider URLs are never followed. |
| Redaction | `prepareTranscript` | Phone/PII masks applied across segment boundaries, then sentence-split. Empty result is `empty_transcription`. |
| Segments | `TranscriptSegment` | Stable `sid` from 1. `start_ms` / `end_ms` nullable. `timing_source`: `provider` or `unavailable`. `speaker` defaults to `unknown` unless STT supplied one. |
| Version | `csi-transcript-v1:{media_digest_sha256}` | One snapshot per digest. Replay does not re-call STT. |
| Model read | `get_call_transcript` | Mongo `$slice` ≤100 segments/page. Partial pages set `complete: false` and `missing_ranges` `segments_before:N` / `segments_after:N`. Missing snapshot → `transcript_unavailable`. |

The model sees **redacted segment text**, version, sids, and nullable timing. It does not see audio, Blob paths, or private recording URLs.

STT is billed separately (Owner policy: minutes × `SALES_INTELLIGENCE_STT_CENTS_PER_SECOND`). Document 12’s dated OpenAI estimate for mini transcribe is $0.003/minute. That cost is not part of the 800,000 analysis-token reservation.

---

## 5. Ranked waste (why the loop is expensive)

Findings are ranked by billed tokens and failed runs, not by file location.

| # | Finding | Severity | Why it costs |
| --- | --- | --- | --- |
| 1 | Submit tool inlines the full envelope JSON Schema (~41.6 KB) on **every** step | Critical | Eleven read tools are 3.8 KB. Submit is 10× that. The SDK sends it with every turn. The conservative byte ceiling counts it again in `contextTokenCeiling`. The model already has a construction checklist in the pinned prompt. |
| 2 | Preflight dumps captured pages **twice** (inventory + full JSON) | Critical | Inventory is the citation authority. The second blob repeats every record, every coverage object, and every transcript segment. |
| 3 | `readCaptureCoverage()` is attached to **every** read page | High | Fleet watermarks, gaps, and job counts (document 14 finding 1) are recomputed per tool call and then serialized into the prompt N times. The model needs subject coverage, not a fleet dashboard on the transcript page. |
| 4 | Reservation assumes worst-case tokens and missing usage = full 128k | High | Funds retries of a fat prompt. The $0.25 cap cannot admit the code default (69¢). Local 800k was a workaround, not a measured prompt size. |
| 5 | After preflight, all twelve tools stay advertised and `toolChoice` is `required` | High | The model is invited to re-read pages it already has. Each extra read is a full context replay. Repair correctly locks to submit; the first pass does not. |
| 6 | Activity `fields.details` is `JSON.stringify(timeline.detail)` | Medium | Structured timeline already has typed fields. The string copy is redacted free text up to 4,000 characters per row. |
| 7 | `schema_exhausted` after two invalid submits | Medium (quality) | Booked live-desk run paused here. A second submit re-sends the entire context. Token budget hid a teaching/schema problem. |

---

## 6. Recommended shape (same contract, less context)

Do not invent a second envelope. Do not disable snapshot membership. Sequence so each pass can ship alone.

### Pass A — Stop paying for the schema twice

1. Keep Zod + generated artifact as server/MCP authority.
2. Give the **model** a slim submit tool: `idempotency_key` + `envelope` as an object whose JSON Schema is a short `$ref` or a compact required-field sketch, not a 41 KB `oneOf` expansion. Point at resource `csi://schemas/csi-envelope-v1` if the SDK must see a schema.
3. Alternatively (narrower, no MCP artifact change): after preflight, `activeTools: ["submit_intelligence_analysis"]` and `toolChoice` submit, the way repair already works. Reads stay available only when a captured page has `next_cursor` or `missing_ranges` other than empty.

Expected effect: tens of thousands of bytes off **every** step; first-pass submits become the default.

### Pass B — Send evidence once, compactly

1. Put **citation inventory + transcript segment text + closed record projections** in the user prompt. Drop the second full-page JSON, or keep full pages only for the transcript tool’s current page.
2. Attach `CoverageDto` only on `get_intelligence_context`, and prefer the number’s own coverage fields already on that page. Stop calling `readCaptureCoverage()` inside every `readIntelligenceEvidence` (it is also the O(corpus) Owner-read cost in document 14).
3. Stop stuffing `JSON.stringify(detail)` into activity `details` unless a named field is missing. Keep `description`, `status`, `occurred_at`.

Expected effect: preflight prompt shrinks toward “this call + this Lead/Booking + this Outreach,” which is the actual analysis question.

### Pass C — Reserve from observed usage

1. Keep a hard per-step byte/token cap.
2. Reserve from p50/p95 of completed runs (input, output, steps), plus one repair, not `12 × 128k`.
3. Do not treat missing `usage.inputTokens` as 128,000. Fail closed or use the measured `contextTokenCeiling` for that step.
4. Leave the $0.25 recording ceiling alone until Pass A/B land. Raising `total_input_tokens` without shrinking the prompt just spends the monthly $80 cap faster.

### Pass D — Teach one legal envelope (quality)

The AFTER-16 prompt-schema review is the right packet. Add one compact valid-envelope skeleton (keys, nullables, citation shape) to the pinned template or a tiny fixture in the user prompt. Do not add few-shot customer transcripts.

This is what unblocks the booked subject that already has a transcript and died `schema_exhausted`.

---

## 7. `gpt-5.6-luna` vs `gpt-5-mini`

### 7.1 List price (20 September 2026)

| Model | Gateway ID | Input / 1M | Cached in / 1M | Output / 1M | Context |
| --- | --- | --- | --- | --- | --- |
| GPT-5 mini (current CSI default) | `openai/gpt-5-mini` | $0.25 | $0.025 | $2.00 | 400k |
| GPT-5.6 Luna | `openai/gpt-5.6-luna` | **$0.20** | $0.02 | **$1.20** | 1.05M |
| GPT-5 nano (already allowlisted, unused) | `openai/gpt-5-nano` | $0.05 (doc 12 dated) | — | $0.40 | see Gateway |
| GPT-5.6 Terra (family mid) | `openai/gpt-5.6-terra` | $2.00 | — | $12.00 | 1.05M |

Sources: [Gateway Luna](https://vercel.com/ai-gateway/models/gpt-5.6-luna), [Gateway mini](https://vercel.com/ai-gateway/models/gpt-5-mini), [OpenAI Luna](https://developers.openai.com/api/docs/models/gpt-5.6-luna), [OpenAI mini](https://developers.openai.com/api/docs/models/gpt-5-mini), [Gateway 30 Jul 2026 price cut](https://vercel.com/changelog/ai-gateway-gpt-5-6-pricing-speed-updates).

Same 800k / 24k reservation at Luna list rates: **~28¢** vs mini **~34¢**. Still above a 25¢ recording cap unless Pass C shrinks the reservation. Per-token, Luna is about **20% cheaper on input and 40% cheaper on output** than mini — same order of magnitude, not a different cost class.

OpenAI long-context rule for Luna: prompts **>272k input tokens** bill **2× input and 1.5× output for the full request**. Our per-step `context_tokens` cap is 128,000 **bytes**, so a single step should stay under that surcharge if Pass A/B hold. A bloated replay that crosses 272k real tokens would erase the list-price advantage.

### 7.2 Capability — do not treat Luna as “mini but better”

Official placement:

- OpenAI: Luna “roughly corresponds to the **nano** model tier used in earlier GPT-5 families.”
- Vercel: Luna is the **fast, low-cost** end of GPT-5.6; “classification, extraction, routing, and short generation” fit; “**multi-step agentic runs** … belong on GPT-5.6 Terra or GPT-5.6 Sol.”
- Vercel on mini: the **cost-performance** GPT-5 tier for production agentic workflows.

GPT-5.6 as a **generation** is newer and advertised as more token-efficient than GPT-5. That is not the same claim as “Luna outperforms `gpt-5-mini` on `csi-envelope-v1`.” CSI’s failure mode is schema/citation repair under a two-submit cap — closer to Vercel’s “hard structured agent step” than to high-volume classification.

Worker allowlist (`CSI_EXTRACTION_MODELS` in `src/config/domain/salesIntelligence.ts`):

```
["openai/gpt-5-mini", "openai/gpt-5-nano", "openai/gpt-5.6-luna"]
```

Set `SALES_INTELLIGENCE_EXTRACTION_MODEL=openai/gpt-5.6-luna` and matching `SALES_INTELLIGENCE_ANALYSIS_*_CENTS_PER_MILLION` (20 / 120 at the 20 Sep 2026 Luna list rate). A running run cannot silently swap models; a prepared run keeps its pinned `model_version`.

### 7.3 Recommendation

| Goal | Model | Note |
| --- | --- | --- |
| Stay near current spend, try the new family | `openai/gpt-5.6-luna` | Price is **around the same as mini, slightly cheaper**. Treat as an A/B on the same three desk subjects after Pass A/D, not a silent default swap. |
| Same family, more headroom for schema repair | `openai/gpt-5.6-terra` | ~8× mini input, 6× output. Does not fit the $0.25 recording cap unless Pass B makes runs tiny. |
| Cheapest already-legal option | `openai/gpt-5-nano` | Already allowlisted. Doc 12 asked for a fixture bake-off. Use it only if envelope success rate holds. |
| Keep shipping today | `openai/gpt-5-mini` | Still the code default when `SALES_INTELLIGENCE_EXTRACTION_MODEL` is unset. |

**Do not switch models to paper over a 41 KB tool schema.** A cheaper model still pays for every replayed byte.

---

## 8. Suggested next implementation slice

If the Owner wants one code change next, do **Pass A item 3** (lock tools to submit after successful preflight) plus **Pass D** (one legal envelope skeleton in the pinned template). That is a worker/prompt change, no envelope-contract rewrite, and it attacks both `bounds_exhausted` and `schema_exhausted`.

Regenerate the MCP artifact only if Pass A item 2 (slim submit JSON Schema) is chosen: `scripts/dev_ops/generate-csi-intelligence-contract.ts`.

A Luna allowlist + pricing-env change is a **separate** Owner-authorized config slice after those two land, with the same redacted conversation fixtures and a recorded first-submit / repair / pause count.

---

## 9. What this document does not change

- Snapshot membership, subject scope, and server-side effect application stay mandatory.
- Call Qualification stays closed.
- STT remains a separate Gateway call on stored audio.
- The $80 monthly AI cap and $0.25 per-recording ceiling stay Owner policy until the Owner changes them.
- No production flag, model, or budget change is implied by this file.
