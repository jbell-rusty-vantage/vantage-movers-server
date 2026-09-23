# 21 — Owner demo backfill evidence

Date: September 21, 2026. Deliverable 2 of [19](19-system-walkthrough-and-owner-demo-backfill-task.md). Identifiers below are redacted. No phone numbers, names, or transcript text.

## Follow-up incident repair, September 21 evening UTC

This section supersedes the historical status statements below. Attention was repaired and verified through the live signed Owner API: HTTP 200, `ready`, 6,382 subjects at 21:55 UTC (3.7 seconds), and 6,394 at 22:14 UTC (3.6 seconds). The full publisher first completed 6,363 rows in 74.6 seconds inside its 90-second budget. Repeated calendar conversion was the main CPU bottleneck; bounded timezone/calendar caches and 500-record batches resolve it. Conversation-scoped reviews now resolve to their actual Number rather than crashing publication with an invalid Lead DTO.

The MCP timeout was 20 seconds, while an observed downstream authority read took 17 seconds. MCP now allows 45 seconds per downstream request and a 120-second route budget. Transient evidence failures remain retryable in the analysis runtime, rather than becoming permanent contract mismatches. Credential-free diagnostics record action, elapsed time and safe error kind. Direct CLI production MCP deployment: `dpl_5RaorrGtSuwE5BKnxoh9xNfYV57z`. The deployed prompt v2 is present; the earlier missing-v2 observation below no longer applies.

The retry exposed a second blocker: Atlas reported its 512 MB storage quota exhausted, rejecting writes with code 8000. Attention cache copies alone occupied about 76 MB. Lossless snapshot compression preserves rows, counts, ordering, cursor identities and the five-minute TTL. A real 6,394-row snapshot measures 26,761,829 JSON bytes versus 1,242,624 compressed/base64 bytes. Main-server deployment `dpl_9RahDhKBUoJ7AbWkBxqBDjze7zTy` includes the cache fix and supports older inline/chunk snapshots. No recordings, conversations or audit history were deleted. An explicit existing-TTL cleanup found zero expired documents at execution time; Atlas had already removed them.

Verification scripts: `scripts/check-csi-attention-ready.ts` and `scripts/verify-csi-five-examples.ts`. The latter checks official booked state, stored media with Blob HEAD, transcript presence, completed analysis and Running Summary without printing customer text or audio URLs. At 22:22 UTC, all five intended samples passed with real stored recordings, transcripts and completed analysis. Job 5564791 completed at 22:19:58 UTC after the cache repair; the application reported two applied effects and one review. Its evidence raised unclear-commitment reviews rather than inventing a firm follow-up. Its actual cost remains unknown because the earlier transport attempts did not report complete usage; null is not zero. Number summaries for 5564791 and 5564716 remain separate recovery work.

| Job | Official grouping | Recording seconds | Audio bytes | Completed analysis at 22:22 UTC |
| --- | --- | ---: | ---: | --- |
| 5563953 | Booked Form Lead | 249 | 344,205 | yes |
| 5564267 | Booked Form Lead | 297 | 600,237 | yes |
| 5564618 | Unbooked Form Lead | 116 | 293,229 | yes |
| 5564791 | Unbooked Call Lead | 425 | 160,749 | yes |
| 5564716 | Unbooked Call Lead | 509 | 1,566,189 | yes |

The production cron wrote compressed snapshots at 22:15, 22:17 and 22:18 UTC. The live Owner API returned `ready` with 6,400 subjects at 22:23 UTC, using the 22:22:16 snapshot. Shared-cluster latency still varies (this read took 27 seconds), so ready/count correctness is verified, but consistently low latency is not claimed. The user assigned collection pruning to another agent; this repair performed no receipt or operational-event deletions.

### Production logging release and final checks

Completed Attention repairs were recorded separately as `9b6c3d7`. The user's urgent logging-only request was committed as `4f3a205059683ac0a2f8b728c908067de06dfb38` (two middleware files and one focused regression test), pushed to `fix/outreach-attention-and-five-examples`, and released through [Vercel Production workflow 35663829180](https://github.com/jbell-rusty-vantage/vantage-movers-server/actions/runs/35663829180). It passed typecheck and 2,496 tests, with zero failures and 116 skipped. Production deployment `dpl_6jAzUjrJoX2e2HUYE5odbFbTTxsm` serves the normal main-server alias.

Between 22:50:20 and 23:01:57 UTC, fresh production traffic produced zero `auth.scoped_key.accepted` and zero `http.request.slow` Mongo Operational Events. A deliberately invalid credential returned 401 and persisted one `auth.api_secret.rejected`; other Operational Events continued (41 non-targeted events in that window). Vercel application logs retained successful scoped authentication and HTTP durations, including successful requests taking 3.7–3.9 seconds. No observability flag, collection, record or index was removed by this logging patch. The focused test also positively exercises the actual v1 `http.request.5xx` writer path.

After release, real scoped main-server and MCP initialization probes both returned 200 in about three seconds (versus a pre-release main-server status read of 38 seconds). The live Owner Attention API returned `ready`, 6,420 subjects, as-of 22:50:02 UTC. No MCP 5xx responses were found in the 22:50:20–22:53:42 observation window; this is a bounded observation, not a guarantee of future uptime.

MCP was deployed directly via CLI as requested; latest `dpl_CQGzF37PgH6DaHxfyH76FPCS4md4` also rejects unsupported SSE GET probes locally before a downstream authority read. All POST authority checks remain. Its 37 tests/typecheck passed, and a live GET returned 405/Allow: POST in 182 ms. No MCP Git deployment integration was introduced.

All five recording/transcript/completed-analysis checks passed again at 22:56–22:57 UTC. Three Numbers have Running Summaries. The separate summary for 5564716 returned a transient AI Gateway failure on its bounded retry. For 5564791, the exhausted historical v1 summary run was preserved and one explicit v2 repair was attempted through the canonical worker; it also returned `retry` / `transient`. Both summaries remain pending; neither result invalidates the five completed conversation analyses. No schema-failure counters, budget gates or lease checks were reset to force a result.

Checks: focused server regression tests and local typecheck pass; MCP 37 tests and typecheck pass. Earlier required `finish-work` checkpoint ran: its full suite passed 2,495 tests (116 skipped), lint and quality-runner tests passed. Its isolated proposed patch failed typecheck on missing imports in unrelated analysis-admission changes and was not applied. The actual working tree typecheck passes. The later official production workflow passed typecheck and the full suite (2,496 passed, 116 skipped), and its deployment is Ready.

## What happened to the earlier records

The three earlier subjects are still stored. Nothing deleted them. Job `5564662` (Call Lead) and job `5564549` (Form Lead) each have an Outreach Record closed `booked` by official closure, so they were never going to appear on Attention: a closed record does not carry a band. They show under Numbers, on a closed Work tab. `5564662` never reached analysis: the conversation is still `discovered` and `excluded`, with no transcript and no Intelligence Run, and the Number↔Lead edge is only `candidate` / `likely`. `5564549` is transcribed and eligible, but its runs are paused (`schema_exhausted` on the latest, `bounds_exhausted` on the two before it). The unbooked Call Lead is still there too: edge `attached` / `exact`, Outreach `open`, analysis run `completed`. It left the desk because Attention has no snapshot. `sales_intelligence_attention_snapshots` has zero documents, and production `GET /api/v1/admin/sales-intelligence/attention` returns `pending_projection`. The publish walk reads about 7,805 Outreach Records and takes on the order of 16 seconds per page of 50. The cron budget is 90 seconds, so the walk returns `snapshot_budget` and writes nothing. Checked with `scripts/status-csi-attention-subjects.ts` and `scripts/inspect-csi-owner-demo-candidates.ts`.

## Preconditions

Production coverage on September 21, 2026 at 19:22 UTC had `analysis_admission.status` `admitted`, estimate 18 cents, per-recording ceiling 25 cents, monthly ceiling 8000 cents with 6271 cents remaining. Flags `ENABLED`, `ATTACHMENT_REFRESH`, `OUTREACH_ENSURE`, `MEDIA_ENABLED`, `STT_ENABLED`, `EXTRACTION_ENABLED`, and `PROVIDER_READS` were on. The extraction model on the deployment is `openai/gpt-5.6-luna` (`gateway-gpt-5.6-luna-2026-09-20`). No flag and no ceiling was changed.

No booked Call Lead in the recent stored-media window met the attachment rule, so both booked subjects are Form Leads. The open pair is one Form Lead and one Call Lead.

## The four subjects

| Job | Model | Role | Certainty | Call start (UTC) | Conversation | Number | Outreach | State at selection |
|---|---|---|---|---|---|---|---|---|
| 5563953 | FormLead | booked, not cancelled | likely, auto-attached | 2026-09-21T18:50:43Z | `6ab17e…8d2a` | `6ab16b…e636` | `6ab03d…4f1c` | closed / booked |
| 5564267 | FormLead | booked, not cancelled | likely, auto-attached | 2026-09-21T18:26:04Z | `6ab178…82c3` | `6ab178…e78a` | `6ab043…69e3` | closed / booked |
| 5564618 | FormLead | not booked, not cancelled | likely, auto-attached | 2026-09-21T19:14:47Z | `6ab183…9453` | `6ab183…ba52` | `6ab04a…3c09` | open |
| 5564791 | CallLead | not booked, not cancelled | exact | 2026-09-21T17:19:05Z | `6ab169…68ec` | `6ab169…4e11` | `6ab170…c50b` | unworked |

All four already had stored audio, a complete transcript, eligibility `eligible` / scope `lead`, and a single Lead resolved for that call. Media was not fetched again.

## Hops

Workers were the existing analysis and application jobs (`runIntelligenceJob`, `runIntelligenceApplicationJob`, `scheduleNumberIntelligence`). Model `openai/gpt-5.6-luna`.

### 5563953 — booked Form Lead

| Hop | When (UTC) | Result |
|---|---|---|
| Attachment and Outreach | 19:35:47 | Edge already attached. Outreach `6ab03d…4f1c` closed `booked`, revision 3. |
| Analysis job | 19:35:47 | Existing pending job `6ab17e…8d4c`. |
| Analysis | 19:36:21 | Submitted, then completed at 19:36:26. Run `6ab17e…2236`. 16,764 input tokens, 2,407 output, 193 reasoning. Actual 1 cent. Reservation reconciled from an 18 cent estimate. |
| Application | 19:36:27 | Job `6ab187…9795` completed. Counts: 1 applied, 3 blocked, 1 review. |
| Number synthesis | 19:37:09 submitted; completed afterward | Run `6ab187…9cd6` completed. Actual 1 cent. Running Summary is populated. |
| Attention band | derived, not published | No band. Closed records are excluded. |

Effects: `set_contact_type` applied (`number_contact_evidence`). `complete_followup` blocked `outreach_binding_unavailable`. Two `create_followup` blocked `number_review_ineligible`. `open_review` needs review (`source_interaction_unresolved`). Open review items on the conversation: three `identity`, one `unclear_commitment`.

Likely is enough to attach and not enough for a finding to change Outreach, so the follow-ups stayed off the Lead. The contact-type effect and the Running Summary are what the desk can show.

### 5564267 — booked Form Lead

| Hop | When (UTC) | Result |
|---|---|---|
| Attachment and Outreach | 19:37:09 | Edge already attached. Outreach `6ab043…69e3` closed `booked`, revision 3. |
| Analysis job | 19:37:10 | Existing pending job `6ab178…8303`. |
| Analysis | 19:37:39 | Submitted, then completed at 19:37:45. Run `6ab178…217c`. 15,869 input tokens, 2,447 output, 182 reasoning. Actual 1 cent. Reservation reconciled from an 18 cent estimate. |
| Application | 19:37:46 | Job `6ab187…97c0` completed. Counts: 1 applied, 1 blocked, 2 review. |
| Number synthesis | 19:38:09 submitted; completed afterward | Run `6ab187…9cef` completed. Actual 1 cent. Running Summary is populated. |
| Attention band | derived, not published | No band. |

Effects: `set_contact_type` applied. Two `open_review` need review (`source_interaction_unresolved`). One `create_followup` blocked `number_review_ineligible`. Open review items on the conversation: one `identity`, two `unclear_commitment`.

### 5564618 — open Form Lead

| Hop | When (UTC) | Result |
|---|---|---|
| Attachment and Outreach | 19:38:09 | Edge already attached. Outreach `6ab04a…3c09` stayed `open` (revision 5). |
| Analysis job | 19:38:09 | Existing pending job `6ab183…94a4`. |
| Analysis | 19:38:36 | Submitted, then completed at 19:38:41. Run `6ab183…22b1`. 14,495 input tokens, 2,200 output, 516 reasoning. Actual 1 cent. Reservation reconciled from an 18 cent estimate. |
| Application | 19:38:42 | Job `6ab187…97e3` completed. Counts: 1 applied, 0 blocked, 1 review. |
| Number synthesis | first attempt 19:39:03 returned `retry`; retried and completed | Run `6ab187…9d02` completed. Actual cents on that run are null, so the number-synthesis cost is unknown, not zero. Running Summary is populated. |
| Attention band | derived, not published | Band 5, reasons `no_next_step` and `missing_responsibility`. |

Effects: `set_contact_type` applied. `open_review` needs review (`source_interaction_unresolved`). One open review item, cause `unclear_commitment`, on the conversation. No follow-up was created. The band comes from the open Outreach Record having no next action, not from an applied follow-up.

### 5564791 — unworked Call Lead

| Hop | When (UTC) | Result |
|---|---|---|
| Attachment and Outreach | 19:39:04 | Edge already attached, certainty exact. Outreach `6ab170…c50b` stayed `unworked`, revision 3. |
| Analysis job | 19:39:04 | Existing pending job `6ab169…68fe`. |
| Analysis | 19:39:07, then retried | Failed in a few seconds. Job left `retry` / `transient`, result `analysis_failed`. A fresh job `6ab18a…998e` and another `6ab18c…9ba1` failed the same way. Run status stayed `running` with `analysis_failed`. Actual cents 0 because the provider was not started; the reservation was released. |
| Number synthesis | 19:39:54 | Paused. Run `6ab187…9d04` is `bounds_exhausted`. A later schedule hit that same paused job (`permission_denied`) and did not start another provider call. Running Summary is not populated. |
| Attention band | derived, not published | Band 6, reason `missing_responsibility`. This is a Call Lead, so it does not get the Form Lead "no call yet" band. |

The failure message on the fresh job was `Prompt sales_intelligence_analyze_v2 not found` (`MCPClientError`). Runs created during the demo that completed are pinned to `sales_intelligence_analyze_v1`, which the deployed MCP still serves. The server constant is now `sales_intelligence_analyze_v2`, and the deployed MCP does not register that prompt. Two runs created after the switch are stuck `running` on v2. This subject was not analyzed. No flag was changed to force v1.

## Cost

Known actual cents, from `intelligence_runs.usage` and reconciled reservation rows:

| Job | Conversation analysis | Number synthesis | Notes |
|---|---|---|---|
| 5563953 | 1 | 1 | Estimate was 18 cents; reservation reconciled. |
| 5564267 | 1 | 1 | Same. |
| 5564618 | 1 | unknown | Synthesis run completed with `actual_cents` null. |
| 5564791 | 0 | none completed | Provider never started. Number synthesis paused `bounds_exhausted` with no actual cents. |

Known total is 5 cents. One completed number synthesis is unknown. Monthly budget was not raised.

## What the Owner should open

Search Numbers by job number.

- **5563953 and 5564267.** Not on Attention. Open the Number. Provenance is Likely, from automatic attach. Work is closed because the Lead booked. Running Summary is filled in. Number Analysis has the completed run. Findings did not add a follow-up: the attachment is Likely, so Lead effects were blocked. The visible applied effect is the contact type. Review items sit on the conversation (`identity`, `unclear_commitment`).
- **5564618.** Outreach is open. Once a snapshot is published, Attention band is 5 (`no_next_step`, `missing_responsibility`). Provenance is Likely. Running Summary is filled in. Number Analysis completed. Work does not have a new follow-up. There is an open review for an unclear commitment. Same Likely-attachment limit: this is not a Lead-actionable follow-up.
- **5564791.** Outreach is unworked and would be Attention band 6 (`missing_responsibility`) once a snapshot exists. Provenance is Exact, so a completed analysis could have changed Outreach. Analysis did not complete, and there is no Running Summary. Do not use this job to demonstrate findings.

## Attention

Production Attention is still `pending_projection`. A local publish with a 3 minute deadline and another with a 10 minute deadline both returned `snapshot_budget` and wrote nothing. Two sample pages took 14.5 seconds and 17.8 seconds, with 37 and 40 of 50 records belonging on the desk. At that rate the full 7,805 records take on the order of 40 minutes. The cron allows 90 seconds and then discards the walk. A snapshot, once written, expires after 5 minutes, so the every-minute cron would have to finish a walk it cannot finish.

A local publish with a 55 minute deadline was started and then killed when the editor crashed, before it could write. Attention was checked again at 20:40 UTC and was still `pending_projection`. Another 55 minute publish was started after that. If it lands, the two booked jobs stay off the list, `5564618` is band 5, and `5564791` is band 6. The snapshot expires five minutes after it is written.

## Before and after aggregates

`scripts/measure-csi-efficiency.ts --hours 24`, database `vantagemovers`. The extract cron was also draining the analysis backlog during this window, so the aggregate movement is not only these four subjects.

| | 19:34 UTC | 20:03 UTC |
|---|---|---|
| Job documents | 95,529 | 95,703 |
| Initial runs completed | 17 | 48 |
| Initial runs paused `budget_exhausted` | 368 | 327 |
| Number-refresh runs completed | 2 | 5 |
| Outreach lead/open | 153 | 153 |
| Outreach lead/unworked | 6,072 | 6,072 |
| Outreach lead/closed | 1,562 | 1,562 |

The 24 hour "created in window" count is dominated by `outreach_ensure` repair jobs (about 64,000 in the later sample) and is not a measure of this exercise. These four subjects reused pending analysis jobs and added the number-refresh and application jobs above.

## What the demo cannot show yet

- A live Attention list. The publish walk does not finish inside the cron budget, so the desk stays on `pending_projection`.
- Analysis, findings, and a Running Summary for job `5564791`. The deployed MCP does not serve `sales_intelligence_analyze_v2`. Its number synthesis is paused `bounds_exhausted`.
- A Lead follow-up on the three Form Leads. They are auto-attached at Likely, and Likely does not let a finding change Outreach. The Exact Call Lead is the one that could have, and its analysis did not run.
- Booked Call Lead pair. None in the recent stored-media window had an attached edge that resolved to exactly one Lead.
