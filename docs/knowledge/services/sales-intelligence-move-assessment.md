---
okf_version: "0.2"
type: Service
title: Move assessment step, projection, reads and presentation
status: draft
tags: [sales-intelligence, outreach, move-assessment]
---

# Move assessment step, projection, reads and presentation — MA-01/02/04

Runtime: `src/services/salesIntelligence/assessment/` (`dto.ts`, `presentation.ts`, `reads.ts`) and the Attention score sorts in `outreach/attention.ts`. Authority: [Move assessment specification](../../../../sales-intelligence-move-assessment-workspace/SALES-INTELLIGENCE-MOVE-ASSESSMENT-SPECIFICATION.md) §8, §8.3–8.4, §11; interfaces pinned in the [MA-01 contract](../../../../sales-intelligence-move-assessment-workspace/evidence/MA-01-CONTRACT.md) §4 and §10. Generation, projection publication, refresh and retention purge are described in the next section (`contract.ts`, `views.ts`, `sources.ts`, `context.ts`, `generate.ts`, `runtime.ts`); the assessment-only backfill runner (`backfill.ts`, `scripts/backfill-csi-move-assessment.ts`) is MA-03.

## Contracts

- **Three separate contracts.** The model output (`contract.ts`), the stored artifact (`models/salesIntelligence/assessment.ts`, collection `move_assessment_artifacts`) and the Owner presentation DTO (`assessment/dto.ts`) never share a schema. Stored JSON is read leniently (unknown keys dropped) and emitted through strict Zod. A stored shape the adapter does not understand, or a `schema_version` outside `SUPPORTED_ASSESSMENT_SCHEMAS` (`move-assessment-v1`), makes **that section** `unsupported`; other sections still render.
- **Availability.** `not_assessed | pending | ready | insufficient_evidence | ambiguous_subject | not_applicable | failed | purged | unsupported | unavailable`. `not_assessed` means no settled artifact and no `pending`/`leased`/`retry` `move_assessment` job (and no in-flight `pending` artifact); it is never a fake artifact. `pending` is such a job or artifact. Content (scores, views, inventory, conflicts, evidence, model output) is served only for `ready` and `insufficient_evidence`.
- **Applicability** is derived on read, never stored: `closed` for any closed record; `not_applicable` for an accepted, un-overridden terminal CRM disposition (Priority `7`/`8`); otherwise `active`. It takes precedence over Not assessed. Historical scores stay readable in the detail section with the label `Not applicable`; cards and sort keys carry `null`.
- **Labels.** The server sends numbers or null plus availability; `ScoreDto.label` is `"<n> / 100"`, `Unknown` (assessed, null score), `Pending`, `Not assessed`, `Not applicable` or `Unavailable`. Never a percent sign.
- **Freshness** (`stale`, `stale_reason`) comes from the Outreach projection and applies only to the artifact it points at; stale scores keep their numbers.

## Reads (Owner, `CSI_ADMIN_PREFIX`, master flag only, GET-only, no model calls)

| Route | Returns |
| --- | --- |
| `GET /outreach/:id/assessment` | `{ subject, availability, current: AssessmentSection \| null, versions: AssessmentVersion[] }`. `current` is the projection's artifact, else the newest settled non-shadow artifact (`current: false`). Versions: up to 50 non-shadow settled artifacts, newest first, including `insufficient_evidence`/`failed`/`purged` with labels. |
| `GET /assessments/:artifactId` | `AssessmentSection` (both `ScoreDto`s, `views.original_ingestion` / `canonical_current` / `customer_stated`, inventory with model coverage and server `source_coverage`, conflicts, coverage counts, source manifest). |
| `GET /assessments/:artifactId/output` | `FullOutput`: `model_output` is the exact retained model object; `accepted` is the server-expanded `{scores, views, inventory, conflicts, coverage}` envelope, labelled separately; `details` carries versions and digests. |
| `GET /assessments/:artifactId/evidence` | `EvidenceSection`: each citation with `availability: retained \| purged \| missing \| partial`, summary text resolved from the retained source, and `open` (`summary_artifact`, `analysis_run`, or `record` with the same hrefs `toOutreachDto` builds). |
| `GET /analysis-runs/:id/presentation` | `{ run_id, summary_findings, evidence, full_output: FullOutputRef[] }` for legacy and structured (`csi-analysis-steps-v1`) runs. |
| `GET /analysis-runs/:id/output/:outputId` | `FullOutput` for the run's envelope (`legacy_analysis` → `model_output`; structured `findings` → `accepted`, because the minimal findings object is not retained) or one captured `conversation_summary` artifact. Added beside the §10 list so every `FullOutputRef` is fetchable. |

Shadow artifacts are not readable through these routes. Lead-only subjects without a Contact Number read normally and skip the retention probe.

## Generation, projection, refresh and retention (MA-01/02, September 23, 2026)

- **Independent logical step.** `move_assessment` is its own durable job stage, claimed by `runMoveAssessmentJob` (660 s lease; dispatch handler and cron recovery under `SALES_INTELLIGENCE_MOVE_ASSESSMENT`, default off). It depends on retained summaries and deterministic context, never on findings generation or application; an assessment failure never regenerates a summary, and a findings failure never blocks publication. Original-evidence replays do not nominate it.
- **Inputs.** `assembleAssessmentContext` freezes one immutable evidence catalog per invocation (`e1..eN`): the two Lead move views (`views.ts`: original ingestion evidence labelled only when provenance establishes it; canonical current fields; Call Lead `delivery_zip` and Form Lead `destination_zip` both normalize to the delivery ZIP), official flags, active Owner corrections, then one retained summary version per conversation in preference order (canonical `csi-summary-v1/v2` artifact → completed legacy run summary → `LeadConversation.summary`) and optional retained findings with lineage to their summary entry. No transcript, media, phone/email/name, Source Company price, CPL, rep, band or attempt counts reach the model. Skips (`skipped_no_summary`, `ambiguous_subject`, `not_applicable`, `excluded`, `evidence_limit_reached`) complete without a model call; Lead-only subjects run only when explicitly allowed (`input_mode: lead_only`, `no_conversation_evidence`).
- **Fingerprint.** `payloadHash` over the contract digests, the selected source manifest (ids + digests/versions), both move views, official flags/booking ids, the attachment mirror revision and correction revisions. Priority/Quoted, bands, follow-ups, assignment, clocks and the projection itself are excluded, so display-only changes never nominate paid work.
- **Model contract.** Five fields (`move_likelihood`, `transaction_intent`, `move_details`, `inventory`, `conflicts`); levels `unknown|none|exploring|active|strong|confirmed` mapped by the server to `null|0|25|50|75|100`; `expandAssessment` validates catalog membership, dates, ranges and the "no high intent from Lead fields alone" rule and expands ids to `EvidenceRef`s. The summary step (`csi-summary-v2`) additionally retains a compact `move_evidence` block extracted during the existing transcript-to-summary call.
- **Artifact lifecycle.** Unique key `{dataset, subject_key, input_fingerprint, schema_version, shadow}`; a `pending` row is inserted before the call and completed with one CAS write (`ready` or `insufficient_evidence`); an unchanged retry reuses the accepted artifact (`reused`, zero calls); a changed fingerprint between generation and publication records `stale_input` and nominates afresh; closure or a terminal disposition at publication fences it (`fenced`). Shadow artifacts persist cost evidence and are never published.
- **Projection.** `OutreachRecord.move_assessment` holds artifact id, status, both scores, confidences, `context_as_of`, `latest_conversation_at`, fingerprint, `stale`/`stale_reason`, `published_at` and the record revision it was fenced against; written only by `publishAssessmentProjection` under compare-and-set. Applicability is derived on read (closed / terminal CRM disposition), so official closure changes score applicability with no model call.
- **Nomination.** `structuredRuntime.ts` nominates inside the summary checkpoint (`summary:<run id>`); the entity-change scan nominates on `MOVE_TRIGGER_PATHS` changes (`nominateMoveAssessmentForChange`); the backfill nominates with `force`. Dedupe keys are `csi:move-assessment:<subject_key>:<trigger>`; the job recomputes the fingerprint at claim, so nominations are cheap no-ops when nothing changed.
- **Accounting.** One reservation per lease epoch (`steps:<job>:<epoch>:assessment:<artifact>`, step name carries the credential variable name), trailing-30-day p95 nominal estimate, every provider response booked including local repairs, uncertain outcomes kept `usage_complete: false`, reconciled in `finally`, totals on `artifact.usage`. Live work uses the company key (`AI_GATEWAY_API_KEY`); the backfill injects `PERSONAL_AI_GATEWAY_API_KEY` explicitly and never falls back. Model ids are limited to `CSI_EXTRACTION_MODELS`.
- **Retention.** `purgeContent` calls `purgeMoveAssessments` for the purged Number or conversation: artifacts are tombstoned (`purged`, content nulled), projections pointing at them lose their scores, and the dataset's current Attention snapshots are expired so no frozen row keeps purged scores.
- **Proof.** `pnpm test:csi:move-assessment:replica` (`scripts/dev_ops/test-csi-move-assessment.replica.test.ts`, 12 checks on the loopback replica with a mocked model) and the unit suites beside each module. Demo cohort for Owner UI verification: `scripts/dev_ops/seed-csi-move-assessment-demo.ts` (+ `seed-csi-move-assessment-structured-run.ts`).

## Presentation adapters

- **Legacy run** (`analysis_pipeline` null): six envelope sections, finding rows (`purged_at: null`) with review state and effects, falling back to envelope findings (`<run>:<key>`, `unreviewed`) before application; `suggested_next_step` from `next_step_suggestion`; `applied_actions` are follow-ups targeted by `applied` effects. Transcript citations keep their retained quote and open `analysis_evidence` when the snapshot is in the run manifest.
- **Structured run**: `step_artifacts.summaries` are restored (retention + digest checked). A conversation run with one captured summary uses its `analysis_summary.summary`; a Number run over several calls keeps the run's own summary. `said_on_call` lists each call's facts with `call_index`. A purged capture falls back to the run's retained summary and is labelled unavailable. Summary citations open `summary_artifact`, never a reconstructed transcript.
- **Retention.** Purged or purge-started artifacts/runs return tombstones with no content. `ContactNumber.content_purge_pending` returns `unavailable` for assessment, output, evidence and run sections.

## Attention (see [Outreach](sales-intelligence-outreach.md))

`sort=transaction_intent|move_likelihood` (default `desc`), `view=attention|all_outreach`, `freshness=fresh|all`. Rows carry `outreach.move_assessment` (compact projection with applicability) and `sort_keys.{transaction_intent, move_likelihood, assessment_status, assessment_stale}` frozen at publish.

## Tests

`assessment/presentation.test.ts`, `assessment/reads.test.ts` (in-memory `AssessmentStore`), `outreach/attention-scores.test.ts`, `outreach/attention.query.test.ts`, `routes/sales-intelligence-admin.routes.test.ts`. Fixtures: `assessment/presentation.fixtures.ts`.
