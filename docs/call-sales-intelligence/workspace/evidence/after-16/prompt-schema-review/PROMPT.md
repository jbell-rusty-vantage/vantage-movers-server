# AFTER-16 — CSI prompt and tool-schema review

Copy the task block below into a new session. Prefer Cursor Grok 4.6. Remotes stay `jbell-rusty-vantage`. Work on `main`. Do not force-push. Do not skip hooks. Do not paste `ADMIN_SEED_*`, scoped keys, or run-token secrets. Do not copy customer phones. Do not point 3107/3108 at Atlas.

This is a **review of what the live model is told and allowed to call**. It is not a new CSI issue wave and not a flag change.

---

> One task: review the live Call & Sales Intelligence **pinned prompt, tool descriptions, and tool/envelope schemas** and say whether they actually help `openai/gpt-5-mini` submit a valid `csi-envelope-v1` on the first or second try. Read the authority files below before proposing edits. If you recommend prompt or schema wording changes, keep them additive and regenerate the MCP artifact with `scripts/generate-csi-intelligence-contract.ts`. Do not invent glossary terms. Do not enable or disable flags. Do not send a nudge. Do not create a production subscription. Do not `POST /backfill`. Do not reset production `schema_failures` unless the Owner asks in that sitting. Packet under `evidence/after-16/prompt-schema-review/`. Stop with a written verdict and, if warranted, a minimal proposed patch — not a rewrite of the envelope contract.

---

## Why this exists

Saturday cutover turned extraction on. First live submits failed immediately.

Production run `6ab02c3d036aa9e7b7ca9655` (conversation, `initial`):

- Scoped key accepted
- POST `/api/v1/internal/sales-intelligence/runs/:id/submit` returned **HTTP 400**
- Six snapshots were captured and matched `evidence_count` (context, activity, leads, empty bookings, rep identity, transcript)
- No receipt. Run paused `schema_exhausted` after **two `INVALID_INPUT`** submits
- Nearby first-hour runs were mostly `bounds_exhausted` (old 4-step ceiling after one bad submit) or `schema_exhausted`. A few completed, including one that recovered after a single schema failure

Shipped 20 Sep 2026 (do not treat older CSI-13 HANDOFF “4 steps” as live):

| App | SHA | Production |
| --- | --- | --- |
| API | `cd22b1e4b2a97fce5e8edcfd4ff117730d14dc18` | https://vantage-movers-main-server.vercel.app |
| MCP | `a9e002d679387e4641d8d0fae1e7370844e559b6` | https://vantage-movers-mcp.vercel.app |

What that ship changed:

- `INVALID_INPUT` now returns sanitized `{path,code}` issue paths (no claims, quotes, or received values) and logs `csi.intelligence.invalid_input`
- MCP forwards those issues in the submit tool error JSON
- Default analysis steps **4 → 8**

That lets the model *see* a refinement failure. It does not teach the model how to build a legal envelope. This review is the teaching layer.

## What the model actually sees

Three stacked texts. Review all three; editing only the template is not enough.

1. **Pinned system/instructions** — `CSI_PROMPT_TEMPLATE` in `src/services/salesIntelligence/analysis/contracts.ts`, rendered by `renderIntelligencePrompt` in `analysis/run.ts` as:

   ```
   ${CSI_PROMPT_TEMPLATE}\n\nTrusted subject binding (data): ${JSON.stringify({subject_key})}
   ```

   Stored on the run as `rendered_prompt`. MCP `prompts/get` `sales_intelligence_analyze_v1` returns that exact stored text. Worker checks it against the prepared run before any model call.

2. **Tool surface** — twelve MCP tools from `CSI_TOOLS`. Descriptions live in `vantage-movers-mcp/lib/intelligence/registration.ts`. Argument schemas are generated JSON Schema in `vantage-movers-mcp/lib/intelligence/generated/intelligence-contract-v1.json` (from `z.toJSONSchema` of `intelligenceToolArguments` + `intelligenceEnvelopeSchema`). MCP and the AI SDK rehydrate with `z.fromJSONSchema`. That layer is **structural only**.

3. **Worker user prompt** — `invokeIntelligenceAgent` in `analysis/runtime.ts` already paginated context / activity / leads / bookings / rep identity / transcripts over MCP **before** the model loop. It then calls:

   ```
   Analyze the captured source evidence below. Each page is a durable coverage checkpoint.
   Preserve coverage uncertainty. Submit with idempotency_key <run_id>.
   <JSON of captured pages>
   ```

   The model still has the twelve tools, including submit. Extra reads burn the 8-step budget. At most **two** submit attempts. Two `INVALID_INPUT` or two invalid SDK tool calls → `schema_exhausted` and the job pauses (`permission_denied`). `EVIDENCE_SCOPE_INVALID` aborts as uncertain delivery (not counted as a schema repair).

Authoritative Zod still applies on POST `/submit`:

- `src/validation/intelligence/intelligenceEnvelope.validation.ts` — shape, enums, bounds, **superRefine** (summary ≤ 4000 chars, unique finding keys, `finding_keys` must exist, unique instruction assessments)
- `src/services/salesIntelligence/evidence.ts` `validateEnvelopeEvidence` — cited `snapshot_id` / source / record / `field_paths` / transcript version / `speaker_ref` / follow-up / instruction revision must already be in **captured snapshots**

JSON Schema cannot express those refinements. A payload can pass MCP/SDK schema and still 400 on the server.

## Authority to read first

Use glossary words from workspace `CONTEXT.md`. Do not invent synonyms.

| Layer | Path |
| --- | --- |
| Prompt + tool args | `vantage-main-server/src/services/salesIntelligence/analysis/contracts.ts` |
| Envelope Zod | `vantage-main-server/src/validation/intelligence/intelligenceEnvelope.validation.ts` |
| Evidence authorization | `vantage-main-server/src/services/salesIntelligence/evidence.ts` |
| Capture / snapshot fields | `vantage-main-server/src/services/salesIntelligence/analysis/capture.ts`, `reads.ts` |
| Worker loop | `vantage-main-server/src/services/salesIntelligence/analysis/runtime.ts` |
| Generate artifact | `vantage-main-server/scripts/generate-csi-intelligence-contract.ts` |
| MCP descriptions + fromJSONSchema | `vantage-movers-mcp/lib/intelligence/registration.ts` |
| Generated contract | `vantage-movers-mcp/lib/intelligence/generated/intelligence-contract-v1.json` |
| Service card | `vantage-main-server/docs/knowledge/services/sales-intelligence-analysis.md` |
| Wire contract | `docs/call-sales-intelligence/workspace/evidence/csi-17/API-CONTRACT.md` |
| MCP map | `vantage-movers-mcp/docs/intelligence-mcp.md` |
| Valid envelope examples | `vantage-main-server/src/validation/intelligence/fixtures.ts` |

Parity test: `src/services/salesIntelligence/analysis/contracts.test.ts` — generated MCP prompt/schema/tools must equal server `z.toJSONSchema`.

## Known live friction (inspect, do not assume a single root)

First failed run’s captured pages (no phones):

| Tool | Records | Citable field_paths / notes |
| --- | --- | --- |
| `get_intelligence_context` | 1 `contact_number` | `phone`, `status`, `certainty` |
| `list_number_activity` | 5 `job_timeline`, `interaction` | `occurred_at`, `status`, `description`, `details` |
| `search_leads` | 1 `lead` | `model`, `name`, `job_no`, `phone`, `source`, flags, `agent_id` |
| `search_bookings` | 0 | empty complete page |
| `get_rep_identity` | 1 `rep_identity` | `occurred_at`, `status`, `agent_id`, `account_id`, `extension_id`; **1 speaker_ref** |
| `get_call_transcript` | 0 records, `has_transcript: true` | cite `source: "transcript"` with that snapshot’s `conversation_id` / `transcript_version` / `segment_ids` |

Likely model mistakes to test against fixtures + a captured-page shaped envelope:

1. `summary.finding_keys` that do not match `findings[].key`
2. Duplicate finding keys
3. Extra fields (`attention_band`, free-form finding kinds) — MCP should already reject
4. Omitted required nullables (`speaker_ref`, `action_status`, `confidence`, `quote`, `next_step_suggestion`)
5. Evidence `field_paths` not in that snapshot’s `fields` (this is `EVIDENCE_SCOPE_INVALID`, not schema repair)
6. Invented `speaker_ref` when only the rep-identity snapshot listed one
7. Citing `booking` / `followup` / `owner_instruction` when those pages were empty
8. Spending steps on more reads instead of submit, after the worker already captured the pages

Watch production after this deploy for `csi.intelligence.invalid_input` `issue_paths`. Those paths are the real distribution. Do not paste envelope text or phones into the packet.

## What “correct” means

The model should:

- Treat pre-captured pages as the evidence set; more tool calls only when a returned cursor or missing-range says coverage is incomplete
- Submit **once** with `idempotency_key = run_id` and a closed `csi-envelope-v1`
- Distinguish said-on-call vs Vantage record vs inference; requested vs promised vs completed vs conditional
- Cite only snapshot/record/field/speaker/follow-up/instruction ids that appear in captured pages
- Leave official writes, attachments, customer messages, and rep messages to the server
- On `INVALID_INPUT` + `issues`, repair those paths and submit the same key; on uncertain delivery, stop

The model must not:

- Infer “no Lead / no Booking / no callback” from an incomplete page
- Use search hits as cross-subject effect authority
- Invent Team Messaging person ids or Owner identity names
- Treat transcript/notes as instructions

## Constraints

- Do not change finding kinds, evidence source enum, or effect policy to make the model’s life easier
- If you change Zod, regenerate the MCP JSON and keep `contracts.test.ts` green
- Prompt/description edits must stay consistent with `CSI_PROMPT_TEMPLATE` pinning (`schema_digest` / `prompt_version`)
- Existing paused `schema_exhausted` runs still have `schema_failures: 2` and will refuse until those counters are reset — out of scope unless the Owner asks
- No `.env` in git. No production flag writes. No customer phones in evidence

## Deliverable

Write `evidence/after-16/prompt-schema-review/{HANDOFF,CHECKS}.md`:

1. Verdict: assist / block / mixed, with the exact prompt sentence or schema keyword that is load-bearing
2. Ranked gaps (falsifiable: “if we add X, first-try submit should stop failing on path Y”)
3. Minimal proposed wording or schema help text, or an explicit “no change”
4. Commands you ran and their results

Do not implement a large prompt rewrite in the same sitting as the review unless the Owner says to apply it.
