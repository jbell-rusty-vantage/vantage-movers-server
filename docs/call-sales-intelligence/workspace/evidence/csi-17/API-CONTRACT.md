# CSI-17 integration contract

Main server is semantic authority. MCP `/api/intelligence-mcp` is the sole model-facing provider. The broad `/api/mcp` remains separate. Contracts are `csi-intelligence-v1`, frozen `csi-envelope-v1`, prompt `sales_intelligence_analyze_v1`. Generated schema digest is SHA-256 of the server's canonical JSON, not raw artifact bytes. JSON Schema is structural; server Zod also enforces envelope cross-field refinements and persisted evidence authority.

## CSI-13 trusted orchestration

1. Enqueue/claim an `analysis` or `number_refresh` job using existing `jobs.ts`. For CSI-12 conversation work preserve `input_refs=[conversation_id, transcript_snapshot_id]`.
2. Import `prepareIntelligenceRun` from `src/services/salesIntelligence/analysis/run.ts`. Supply the actual `JobLease` and strict `{contact_number_id,conversation_id?,outreach_record_id?,mode?,parent_run_id?,input_fingerprint,model_version}`. It validates the subject joins, persists exact rendered prompt/version/schema digest, and calls existing `issueCsiRunToken`. No public/model run creation or token minting exists. `owner_correction_ids` currently must be empty; CSI-18 correction selection remains separate.
3. Connect to MCP with dedicated `x-api-secret` and `x-vantage-intelligence-run-token` headers, supplied by trusted orchestration rather than model arguments. The MCP deployment checks the dedicated key and forwards both to main server. Fetch prompt `sales_intelligence_analyze_v1` with no arguments and resource `csi://schemas/csi-envelope-v1`. Compare returned server-pinned schema digest; listing a prompt does not load it. Persist the exact rendered prompt already returned by preparation; MCP fetches that stored value without rendering user text.
4. CSI-13 must separately implement model invocation and step/token/time budgets. Reads return immutable snapshots. Submit once. A receipt means accepted, never applied.
5. For uncertain delivery, GET submission with the still-valid scoped credential. If expired/revoked, trusted orchestration reclaims the same job then calls `recoverIntelligenceSubmission(runId, lease)`. No token relaxation or second run is necessary. An already submitted run does not mint another model token.
6. Application intent is the existing job stage `application`, `input_refs=[run_id,submission_id]`, dedupe key `csi:application:run:<run_id>`, status `paused`, reason `consumer_unavailable`, zero attempts. CSI-13 owns a real consumer and explicit resume. CSI-17 never publishes findings/effects or claims work applied.

A validated conversation-subject run may include its trusted persisted Outreach pointer only when that Outreach Record has the same primary Contact Number. Context then includes the Outreach Lead's Owner-instruction subject as well as conversation/number instructions. Nonconversation runs retain exact Outreach subject matching. Tool arguments cannot choose this pointer, and a foreign-number pointer fails closed.

## Internal HTTP

Prefix `/api/v1/internal/sales-intelligence/runs/:id`. Every request needs the named scoped API key in `x-api-secret` AND the existing signed token in `x-vantage-intelligence-run-token`. Existing auth verifies run, subject, deployment/database, audience, nonce, expiry, permitted tools and active lease epoch. Global secret, Owner identity and token alone are insufficient. Query parameters and extra body fields fail closed.

| Method/path | Body | Result |
|---|---|---|
| GET `context` | none | captured context |
| POST `read` | `{tool,args}` | captured evidence |
| POST `submit` | `{idempotency_key,envelope}` | HTTP 202 receipt |
| GET `submission` | none | `{run_id,status,submission,prompt_context}`; no evidence write |

Receipt: `{run_id,submission_id,application_job_id,status:"submitted"}`. Same run/key/parsed payload returns the original receipt; a changed key or payload conflicts. Every MCP request, including discovery, revalidates via status and therefore requires submit permission as well as the requested tool permission.

## Tools

All objects are strict; IDs are validated 24-hex strings except provider call IDs. Defaults are applied server-side before read deduplication.

| Tool | Arguments |
|---|---|
| `get_intelligence_context` | `{}` |
| `get_call_transcript` | `{conversation_id,transcript_version?,cursor?,limit?}`; 1–100, default 50 |
| `list_number_activity` | `{cursor?,limit?}`; 1–50, default 20 |
| `search_leads` | `{query?,model?,cursor?,limit?}`; model FormLead/CallLead |
| `get_lead` | `{model,id}`; relevance rechecked |
| `search_bookings` | `{query?,cursor?,limit?}` |
| `get_booking` | `{id}`; relevance rechecked |
| `get_rep_identity` | `{interaction_id}`; scoped interaction, call-time reviewed intervals |
| `query_operational_records` | `{dataset,query?,cursor?,limit?}`; dataset `form_leads`, `call_leads`, `job_timeline`, `bookings`, `cancellations`, `agents`, `granot_sources`, `ringcentral_queues`, `ringcentral_users` |
| `search_ringcentral_calls` | `{from,to,cursor?,limit?}`; ISO datetime window at most 31 days, at most 20 pages |
| `get_ringcentral_call` | `{call_log_id}`; ID must be admitted by a scoped interaction alias or captured search |
| `submit_intelligence_analysis` | `{idempotency_key,envelope}` |

Non-transcript page limits are 1–50, default 20. Text queries max 120 characters. No filters, collection names, aggregation pipelines, URLs, account selection or actor/run override. Operational queries use bounded server-owned projections and domain joins; directory names never become speaker/message authority. Owner additions extend the authoritative envelope's citation enum with `contact_number`, `agent`, `granot_source`, `ringcentral_queue`, `ringcentral_user`, and `job_timeline`. The strict `csi-envelope-v1` shape is retained; schema digest pins this additive revision. These citations authorize evidence only, never cross-subject effects or speaker identity.

## Captured response and replay

`CapturedEvidence={snapshot_id,content_digest,tool,as_of,data}`. `data={page,coverage,allowed_followup_ids,instructions,speaker_refs,transcript?}`. Page is `{records,next_cursor,complete,missing_ranges}`; records are strict `{record_type,record_id,revision,fields}`. See exported Zod DTOs in `analysis/contracts.ts` and `analysis/reads.ts` for all projected fields. Free text is redacted evidence, never instructions. Followup/instruction/speaker authority is server-collected and validated on intake.

Each normalized tool/args pair returns one immutable captured response per run, including concurrent calls. Snapshot persists tool/arguments, subject/dataset, retrieval time, revisions, response, canonical digest and coverage before returning it. Maximum 128 snapshots, 512 KB per response, 8 MB per run. Oversized context fails rather than silently dropping Owner instructions. Cursors bind the run and query/source; callers must reuse them unchanged. Transcript pages retain immutable CSI-12 version, source snapshot and nullable timing. A partial page lists prior/later missing segment ranges and cannot claim whole-transcript completeness. No STT/extraction/refresh occurs.

`original_evidence` requires a finalized same-subject parent, identical subject IDs, retained manifest and supported pinned prompt/schema. It copies captured response content and retrieval time into the new run without current reads. Only original tool/argument pairs are replayable, including original returned cursors. Missing evidence or expansion fails `ORIGINAL_EVIDENCE_UNAVAILABLE`. CSI-18 correction workflows are not implemented.

Submission constructs the manifest from persisted snapshots, validates record membership/field names, transcript versions, speakers, followup targets and instruction revisions. One snapshot can contain multiple records. It atomically finalizes the manifest with the immutable envelope, audit and paused application intent. Run revision and job `evidence_fence` writes serialize reads/submission/lease changes; late reads cannot add evidence after finalization. Exact quote/timestamp/entailment checks remain deferred.

## Errors and defaults

HTTP 400 `INVALID_INPUT`/`EVIDENCE_SCOPE_INVALID`; 403 scope/authority denial; 409 submission/revision/lease conflict; 413 `EVIDENCE_LIMIT_REACHED`/`BUDGET_EXHAUSTED`; 422 `ORIGINAL_EVIDENCE_UNAVAILABLE`; 503 `PROVIDER_READ_UNAVAILABLE`. `INVALID_INPUT` may include sanitized `issues: [{path,code}]` so the model can repair envelope refinements JSON Schema cannot express. Upstream unavailable/disabled provider reads can instead return an incomplete page with a safe missing-range reason. No raw provider body, submitted evidence, quotes, or credential appears in route errors. Core `ENABLED` and additive `PROVIDER_READS` remain off unless explicitly configured; this task enabled flags only in child test processes.

Provider adapter performs fixed account Call Log GETs with already cached, unexpired credentials; no refresh, token-store writes, arbitrary host, redirects, media URLs or message endpoints. Proof uses fakes only. No nudge module or repair/send route is imported by this surface.
