---
type: Service
title: Sales Intelligence transcription (CSI-12)
description: Budgeted private-media STT, deterministic redaction, immutable transcript versions and durable analysis intent.
tags: [sales-intelligence, lead-conversation, durable-work]
status: draft
stale_after: 2026-12-18
resource: src/services/salesIntelligence/conversations/transcribe.ts
applies_to:
  - src/services/salesIntelligence/conversations/transcribe.ts
  - src/services/salesIntelligence/conversations/transcriptionScheduling.ts
  - src/services/salesIntelligence/conversations/transcript.ts
  - src/services/conversations/transcriptionProvider.ts
  - src/services/conversations/redaction.ts
owners: [team:main-server]
sources:
  - id: specification
    resource: docs/call-sales-intelligence/03-server-pipeline-and-jobs.md
  - id: handoff
    resource: docs/call-sales-intelligence/workspace/evidence/csi-12/HANDOFF.md
---

# Sales Intelligence transcription

Mongo jobs and immutable `IntelligenceEvidenceSnapshot` rows are authoritative. This consumes [CSI-11 stored media](sales-intelligence-recording-media.md), preserving seed audio and account-scoped recording uniqueness. All writes remain in the server; qualification, Lead/Booking writes and analysis execution are outside this service.

`scheduleTranscriptionJobs` scans at most five due `media_stored` conversations with a digest and private media metadata and rechecks authoritative eligibility, including cached undetermined/excluded rows. Unresolved rows move ten minutes forward so they cannot starve later media. Eligible rows commit the job and `transcription_job_digest` marker together. The immutable media digest is pinned in the dedupe key; `input_refs[0]` is the conversation ObjectId. Changed media may create a new version; model changes and analysis retries do not automatically repeat STT.

A pre-STT exclusion completes its job without provider work and refunds that claim, preserving prior transient attempts. It clears the scheduling marker and retains media for future eligibility rechecks. Only this explicit completed `excluded` result may reopen the same digest/job when eligibility returns; successful, stale/seed skips and dead-lettered work never receive a fresh attempt allowance.

`runTranscriptionJob` uses the shared transcription-stage claim and epoch/expiry fence. It checks current eligibility, reserves duration × explicitly configured rate against an existing active monthly period and per-recording cap, then reads bounded private Blob audio and verifies byte length/SHA-256 before one Gateway call. Network work runs outside transactions, with a 90-second abort signal inside the five-minute lease. No RingCentral content URI, local transcript file, warning dump, automatic SDK retry or standalone reasoning call is used.

`prepareTranscript` masks card/CVV/expiry using existing rules plus runs of at least seven spoken digits. Detection spans provider boundaries; each overlapping segment is masked and every sentence is redacted before persistence. Provider timing is retained only when valid; text-only results have null milliseconds and `timing_source: unavailable`. Speaker remains unknown unless the injected provider actually supplies a supported role. Gateway's installed adapter exposes no diarized role, so it returns unknown.

Completion atomically inserts one immutable version `csi-transcript-v1:<media sha256>`, caches redacted text/segments/model/character and redaction counts, reconciles reported cost, marks the job complete, and creates analysis intent. The analysis job has conversation and snapshot ObjectIds in `input_refs`; its snapshot holds the version, media digest, pricing and redacted content. CSI-13 must validate live eligibility/staleness before analysis. Exclusion during STT suppresses analysis; undetermined eligibility creates paused `analysis/eligibility_pending` work. `resumeTranscriptAnalysisJobs` rechecks at most five such waits during recovery without performing STT or analysis.

Eligibility recovery pins both snapshot version and media digest. A later exclusion closes the waiting analysis intent and clears its pending stage; restored eligibility reopens only that excluded intent while its transcript is current. Stale intents close without touching newer conversation state. Empty/whitespace provider output is terminal `empty_transcription` after one paid call: reported cost is retained/reconciled, unknown cost remains reserved, and no transcript snapshot or analysis job is created. A concurrent successful transcript is protected from empty-result cache updates.

Budget and capability pauses retain the job/stage without consuming transient attempts. Owner policy increases (monthly or per-recording cap) and period activation resume budget-paused jobs. Eight transient claims dead-letter; recovery projects a killed eighth claim without a ninth provider call. Only known unused reservations (pre-dispatch failure or explicit permission/throttle rejection) are released. Ambiguous dispatched failures retain their reservations for reconciliation. Successful evidence is never overwritten on replay.

The shared budget stores integer cents: admission and Gateway-reported USD actual are rounded upward to a cent per request. Estimates never become actual usage. Missing reported cost preserves the redacted successful version, leaves the reservation outstanding, and exposes `cost_cents.stt: null` plus `stt_cost_unreported`. Cost recovery belongs to the existing reservation ledger/Team F; replay must not repeat STT. A process killed after provider success but before durable completion can still require another call; no provider idempotency or exactly-once network guarantee is claimed. Its unresolved reservation remains visible.

Configuration: `SALES_INTELLIGENCE_STT_ENABLED` defaults false; `SALES_INTELLIGENCE_STT_MODEL` defaults to the proposed `openai/gpt-4o-mini-transcribe`; `SALES_INTELLIGENCE_STT_CENTS_PER_SECOND` must be explicitly set to a verified positive rate. Missing duration/rate waits rather than guessing cost. Reuses private `BLOB_STORE_ID`, `BLOB_READ_WRITE_TOKEN`, `AI_GATEWAY_API_KEY`, dataset binding, existing budget policy and `CRON_SECRET`. `/api/cron/sales-intelligence-transcribe` runs every five minutes; default queue and minute recovery use the same worker. Each drain schedules at most five jobs and performs at most one recording STT unit.

No new indexes or data migration beyond CSI-01's prerequisites. `transcript_segments` and scheduling marker are additive; seeded records remain readable. STT cost in the server read DTO is nullable when billing is unreported. Rollback keeps flags off and preserves additive snapshots/jobs/reservations; never delete successful evidence to replay an earlier worker.

Proof uses synthetic Gateway/Blob adapters and a random `testvantagemovers_csi12*` database on the disposable loopback replica. No live grant, production Blob/Gateway request, deployment or flag enablement is claimed. [Checks](../../call-sales-intelligence/workspace/evidence/csi-12/CHECKS.md).
