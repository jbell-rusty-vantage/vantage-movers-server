# 12 — Deployment inputs and proposed model policy

Updated September 17, 2026 from Owner-supplied infrastructure details, local code inspection and current official model documentation. Credentials were not printed, changed or tested. No deployment or paid model call was performed. Environment presence below is Owner-reported, not a live capability result.

## Existing infrastructure to reuse

| Input | Implementation direction |
| --- | --- |
| `AI_GATEWAY_API_KEY` in the main server | Use for server-side LLM intelligence and Gateway transcription. Keep it out of Admin/browser code, tool responses, fixtures and logs. Local .env presence does not prove Preview/Production configuration. |
| Deployed `vantage-movers-mcp` | Extend the existing service. Repository README documents `https://vantage-movers-mcp.vercel.app/api/mcp`; Owner confirms the service is deployed. The dedicated `/api/intelligence-mcp` endpoint and scoped authentication in 04/10 remain implementation work, not existing deployed capability. Configure the worker's endpoint per environment; no replacement MCP service required. |
| `BLOB_STORE_ID`, `BLOB_STORE_NAME`, `BLOB_READ_WRITE_TOKEN` in `vantage-main-server/.env` | Prefer the existing store. Existing conversation media code uses ID/token and private access; NAME is descriptive metadata, not a credential or substitute for ID. Verify store privacy, token/store binding and environment isolation. Owner permits creating a new store if necessary; document the concrete reason first and preserve existing media. |
| `REDIS_URL`, `KV_URL`, `KV_REST_API_URL`, `KV_REST_API_READ_ONLY_TOKEN`, `KV_REST_API_TOKEN` in server .env | Available according to Owner. Redis remains an optional live-update accelerator. Use the existing Upstash REST pattern with a matched REST URL/read-write token; socket URLs are not interchangeable with REST URLs, and the read-only token cannot publish. No additional Redis instance required by default. |

Mongo remains authoritative for jobs, leases, audit, idempotency, budget and SSE recovery. Missing/failed Redis must fall back to Mongo polling. Start with Mongo-only correctness; add the optional accelerator after the operational loop works. Reuse credential-resolution conventions from `src/config/domain/dailyOperations.ts`, with CSI-specific keys and environment/database namespaces; do not reuse Daily Operations stream names. Disable external publishing in unit tests/TEST_MODE. If isolated integration tests use Redis, use dedicated test credentials/namespaces.

## Proposed economical model configuration

Owner preference: GPT-5 nano and/or mini. Other Gateway models may be proposed, with measured cost and suitability; do not silently substitute a more expensive family. The following is the implementation starting proposal, not a claim of measured accuracy on Vantage calls.

| Role | Proposed model | Rationale / limits |
| --- | --- | --- |
| Primary tool-using intelligence agent | `openai/gpt-5-mini` | Use one bounded MCP agent run to gather context and submit the envelope. Proposed starting point for commitments, ambiguity and Owner instructions. |
| Lower-cost analysis candidate | `openai/gpt-5-nano` | Evaluate on the same representative fixtures/calls; promote for suitable runs if extraction and tool use are adequate. No mandatory nano pass before every mini run, and no model-based eligibility gate that drops otherwise eligible calls. |
| Recorded-call transcription | `openai/gpt-4o-mini-transcribe` | Proposed default through Gateway's transcription adapter, separate from the MCP reasoning loop. Full recording coverage and deterministic redaction before persistence. |
| Optional difficult-audio comparison | `openai/gpt-4o-transcribe` | Proposal for a bounded comparison or explicitly configured retry; not an automatic second transcription of every call. |

Current catalog reference prices for text: GPT-5 nano starts at $0.05 input / $0.40 output per million tokens; GPT-5 mini starts at $0.25 / $2.00. These are dated reference rates, not hardcoded billing truth. Sources: [Gateway nano](https://vercel.com/ai-gateway/models/gpt-5-nano), [Gateway mini](https://vercel.com/ai-gateway/models/gpt-5-mini).

OpenAI estimates mini transcription at $0.003/minute (about $0.18/audio hour), and the larger transcribe model at $0.006/minute. For illustration, 100 audio hours is about $18 for mini transcription alone, excluding analysis, retries and infrastructure. Verify actual Gateway route pricing before reservations; record actual usage. Sources: [OpenAI pricing](https://developers.openai.com/api/docs/pricing), [Gateway mini transcription](https://vercel.com/ai-gateway/models/gpt-4o-mini-transcribe), [Gateway larger transcription](https://vercel.com/ai-gateway/models/gpt-4o-transcribe).

Gateway's transcription page labels audio support beta and currently displays a February 26, 2027 provider retirement notice for mini transcription. Verify lifecycle/route availability at implementation and before that date; keep the adapter/model configurable. The installed `@ai-sdk/gateway` types expose `transcriptionModel` for these IDs. Catalog presence and SDK types still do not prove credentials, format limits, diarization or timestamps work on a real call.

Do not require timestamps/diarization the chosen STT route cannot return. Persist stable text segment ids with nullable start_ms/end_ms and explicit timing source (provider or unavailable). Preserve genuine provider timing; never fabricate sentence-level audio positions. Speaker remains unknown absent reliable evidence. Text evidence remains usable without precise seek positions, consistent with deferred exact-locator verification.

The $80 monthly admission budget includes STT, every agent step, retries and reruns. It is not a claim about total Blob/Redis/hosting cost. Store selected model/provider and pricing snapshot per run. Reserve enough for bounded tool-loop context and output, including billable reasoning; one transcript-token estimate is not the whole run. Schema/tool failure can use the bounded repair policy in 03, not unbounded model escalation. Model choices do not change server effect validation or Owner precedence. A modest representative integration sample is appropriate; no new mandatory citation-verification or 50–100-call gate is introduced.

## Rep mapping and RingCentral evidence

- [Possible Agent connections](backfill_assistance/agent_ring_central_account_connections_possible.md): September 15 directory snapshot and proposed Agent/Granot matches. Team C uses this as bootstrap evidence; reconcile stable account/extension/Agent ids and effective dates. Names alone never create reviewed links. Ambiguous matches require review before rep metrics or messaging.
- [RingCentral capability report](workspace/RINGCENTRAL-CAPABILITY.md): partly trusted historical probe, September 14–15. Preserve its dates, mode and evidence; it is not a fresh grant. Detailed Call Log/directory reads succeeded in that probe; recording-read user permissions were denied despite app scopes. Messaging reads did not prove delivery, and zero subscriptions visible to one app did not prove no other subscriptions exist.
- Team B implements denied/pending/unknown media states now; Team F refreshes the required capabilities at deployment. Deterministic sales tracking continues while recording access is unresolved. Do not rewrite the historical probe as a current success or repeat live operations merely to finish documentation.

## Team handoff

A wires server-only configuration and budget policy. B verifies private Blob/media and the proposed STT adapter with honest timing/speaker metadata. C imports mapping proposals as proposals. D extends the deployed MCP service, uses the server Gateway key and evaluates mini/nano within the scoped contract. E exposes honest capability and cost states. F records environment-specific evidence for Gateway, MCP, Blob, recording permissions and optional Redis, separately from code completion.
