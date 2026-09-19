---
okf_version: "0.2"
type: Service
title: Scoped Intelligence evidence and analysis intake
description: CSI-17 run-scoped evidence reads, immutable capture, and one durable analysis submission; downstream application remains CSI-13.
tags: [sales-intelligence, durable-work]
status: draft
stale_after: 2026-12-19
resource: src/services/salesIntelligence/analysis/submit.ts
applies_to:
  - src/services/salesIntelligence/analysis/contracts.ts
  - src/services/salesIntelligence/analysis/run.ts
  - src/services/salesIntelligence/analysis/lease.ts
  - src/services/salesIntelligence/analysis/reads.ts
  - src/services/salesIntelligence/analysis/operational.ts
  - src/services/salesIntelligence/analysis/capture.ts
  - src/services/salesIntelligence/analysis/submit.ts
  - src/routes/sales-intelligence-internal.routes.ts
owners: [team:main-server]
sources:
  - id: contract
    resource: docs/call-sales-intelligence/10-intelligence-agent-contract.md
  - id: handoff
    resource: docs/call-sales-intelligence/workspace/evidence/csi-17/HANDOFF.md
---

# Scoped Intelligence evidence and analysis intake — CSI-17

Main server determines authority from a stored Intelligence Run and its active leased job. The dedicated MCP endpoint in `vantage-movers-mcp` exposes bounded reads and one submission. It grants no Owner command, Lead/Booking mutation, attachment, extraction, customer message, or rep message. CSI-13 model execution, scheduling and effect application remain separate work.

## Entry points and authority

`prepareIntelligenceRun(lease, input)` in `analysis/run.ts` is a trusted orchestration seam, never an MCP tool or HTTP run-creation endpoint. It requires an existing leased `analysis` or `number_refresh` job, freezes the rendered prompt/version/schema digest, and issues the existing signed run credential. `recoverIntelligenceSubmission(runId, lease)` is the trusted worker seam when the model credential expires. `renderIntelligencePrompt` and `intelligenceSchemaDigest` expose exact pinning inputs. The schema derives from the strict `csi-envelope-v1` Zod contract.

The internal router adds these endpoints after the existing CSI boundary:

| Method and suffix under `/api/v1/internal/sales-intelligence/runs/:id` | Behavior |
| --- | --- |
| `GET /context` | Captured `get_intelligence_context`; empty arguments |
| `POST /read` | Closed `intelligenceReadSchema` discriminator and strict per-tool arguments |
| `POST /submit` | Immutable intake; `202 {run_id, submission_id, application_job_id, status:"submitted"}` |
| `GET /submission` | Pure receipt/status and pinned prompt context read |

Both the named dedicated scoped key and `x-vantage-intelligence-run-token` are required. Browser Owner, broad secret, or token alone are insufficient. `requireCsiRun` verifies signature, run/subject/tool/dataset/deployment/nonce/expiry and lease epoch. `loadAuthorizedRun` and `fenceAuthorizedLease` recheck stored authority inside capture/intake transactions. The job write fence prevents a concurrent lease loss from committing evidence or a submission under stale authority.

## Read contract

`loadReadScope(storedRun)` derives Contact Number, conversation, Outreach subject, relevant Lead edges and RingCentral account from server joins. A conversation must belong to the run's Contact Number; a supplied Outreach Record must match the number and, for nonconversation subjects, the exact subject. A validated conversation subject may include a persisted same-number Outreach pointer chosen by trusted orchestration; its actual Lead subject is included when reading Owner instructions. No supplied ObjectId establishes read authority. For conversation analysis, the CSI-12 snapshot in the analysis job's `input_refs[1]` pins transcript evidence despite a newer conversation cache.

`readIntelligenceEvidence(scope, input)` returns `ReadContent`: a strict `ReadPage`, optional immutable transcript page, Coverage, permitted followup IDs, observed Owner instruction revisions, and reviewed speaker references. `readContentSchema` is exported for capture and replay validation. The transport adds server-owned snapshot ID, content digest, tool and retrieval time.

| Read | Official source and bounds |
| --- | --- |
| Context | CSI Contact Number/attachment/restriction/instruction/Outreach/followup models; official pure `stateWithActions` derives Outreach state. At most 100 edges, instructions and followups, 50 restrictions, and 200 returned records. Oversize context fails closed instead of omitting Owner precedence. |
| Lead search/get | Dataset-scoped `form_leads` / `call_leads` projections, shared any-known-contact phone paths and `normalizePhoneNumberForMatch`; relevant Lead edges or matching full number only. Default page 20, maximum 50. User query is escaped text, never a filter document. |
| Booking search/get | `booked_leads` matching bounded relevant Lead references or their Job Numbers. Relevant-Lead expansion exceeding 100 fails closed. An arbitrary Booking ID is denied. |
| Cancellations dataset | `readCancellations` projects `cancelled_leads` through relevant Booking IDs or Lead/live snapshot references. Immutable Lead correlation snapshots preserve scoped visibility after a Booking disappears. Related Lead/Booking sets are capped at 100; foreign IDs fail closed. |
| Number activity | Official `getNumberTimeline`, including canonical interactions, messages, conversations and Outreach history. Preflight guards its attachment/Outreach joins at 100 and its recording-interaction scan at 2000; no provider refresh or domain writes. |
| Transcript | Existing immutable CSI-12 snapshot; Mongo `$slice` returns at most 100 segments. Version, source snapshot ID, nullable timing, timing source and unknown speaker survive. No STT or media access. Missing transcript is explicitly incomplete. |
| Rep Identity | Scoped canonical Call Interaction's user extensions and call time; bounded link query (100) feeds official pure `resolveRepIdentityAt`. Half-open historical intervals permit reviewed retired links before their end; proposed/conflicting/unknown links never create Agent authority. |
| Operational datasets/provider reads | `analysis/operational.ts` closed datasets and fixed scoped RingCentral read adapter. The owner-requested additions do not accept Mongo operators, collections, arbitrary URLs or provider credentials in arguments. See CSI-17 handoff/contracts for precise added tools. |

Broad official CRUD services import global models and mutation dependencies, so scoped Lead/Booking reads reuse pure normalization/search vocabulary with explicit configured-dataset projections instead of importing those services. Likewise `outreach/reads.ts` imports nudge history and performs unbounded joins: the Intelligence context uses its official state helper over explicitly bounded model reads. This adaptation does not duplicate a write invariant or invoke nudge code.

Lead/Booking cursors bind run, dataset/model and search string with an ObjectId keyset; merged Lead pages use the total order `(ObjectId, model)` so equal IDs in different collections remain reachable. Strict decoding rejects operator injection and cross-filter reuse. Activity wraps the official timeline cursor in a strict run binding. Transcript cursors bind run and immutable snapshot plus segment offset. A partial transcript page has `complete:false`, `segments_before:N` / `segments_after:N` missing ranges, and a next cursor where applicable; the final page never claims the entire transcript was returned when earlier segments are absent. Text projections redact through the existing transcript redactor and reject excessive free text rather than silently truncating it.

## Capture, replay and durable intake

`captureIntelligenceRead` captures each normalized tool+arguments response once per run. Repeated and concurrent equivalent reads converge on the immutable stored response. Each transaction increments the run revision/evidence counters and fences the job lease. Limits are 128 captured responses, 512,000 bytes per response, and 8,000,000 evidence bytes per run. Reads compute evidence before the transaction; only captured responses leave the boundary. Finalization conflicts with late writes, so no read silently enlarges a submitted manifest.

Original-evidence runs retrieve the parent's retained tool response for the exact normalized call, preserve its data/retrieval time, and append a new run-scoped snapshot. They never fall back to current reads. Missing retained response/prompt/manifest or a missing transcript source required at intake yields `ORIGINAL_EVIDENCE_UNAVAILABLE`.

`submitIntelligenceAnalysis` strictly parses one envelope and assembles authorization only from persisted snapshots: record IDs and exposed field paths, transcript versions, reviewed speaker references, observed Owner instruction revisions and followup targets. The model supplies assertions, never its own manifest. Exact quotation/timestamp/entailment checks remain deferred.

Envelope, immutable receipt, finalized run/manifest, audit and one `application` job commit atomically. An identical run/key/envelope replays the same receipt; changed key or payload conflicts. The application job is durably `paused` with `consumer_unavailable` because CSI-13 is absent. Nothing is marked applied, no fake worker succeeds, and missing application does not consume retry attempts. Receipt recovery resolves uncertain delivery without a second run or application job.

## Proof and operations

`node --import tsx --import ./scripts/test-setup.ts --test src/services/salesIntelligence/analysis/reads.test.ts` passed 4 synthetic tests. `node --import tsx scripts/test-csi-intelligence-reads.ts` passed 9 tests on the existing loopback `csi01` replica using fresh `testvantagemovers_csi17reads*` databases and guarded cleanup. The latter proves real Mongo relevance/pagination, arbitrary-ID denial, old pinned transcript pagination, null timing, historical/proposed/conflicting/unknown identity, Owner restrictions/context, official activity projection and byte-identical domain/job/original-evidence state after reads. Its fetch trap forbids network/provider calls. See [exact read checks](../../call-sales-intelligence/workspace/evidence/csi-17/READS-CHECKS.md) and the CSI-17 handoff for whole-slice transport/intake/checkpoint results; read tests alone are not whole-app approval.

Feature defaults remain off; provider reads additionally require their explicit stage flag and a cached, unexpired token through the existing store. No live model, STT, Blob, RingCentral, deployed MCP, production database or message proof is claimed. Rollback disables CSI flags/registration while retaining immutable evidence, submissions and paused application intent. No production migration, credential provisioning or configuration enablement is part of CSI-17.
