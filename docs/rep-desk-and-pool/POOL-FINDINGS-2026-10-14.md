# Priority Pool inspection — October 14, 2026

**Read-only discovery and local prototype completed. Production Pool feature remains unimplemented and unapproved.** This record supersedes the earlier cloud-access blockers and month-only recommendations in this folder. Current decision contract: [approval proposal](POOL-APPROVAL-2026-10-14.md). Runnable prototype: [instructions](../../ops/pool-prototype/README.md).

Server baseline `ac1520d5e910c94d3c1c0de57196e01d6084eeba`; Admin baseline `897c7da61a52327babd769339de8c3621f9b79ad`. Both fetched October 14 and matched origin/main. Remotes identify `jbell-rusty-vantage/vantage-movers-server` and `jbell-rusty-vantage/vantage-admin`. Work is local on `codex/priority-pool-prototype-2026-10-14`. Existing server `.quality.config.json` modification and `SALES-OUTREACH-DESK.md` deletion, and Admin `.quality.config.json` modification, are preserved. No production runtime file, deployment, cron, configuration, Lead, assignment, lifecycle receipt, sheet, Booking or admission was changed. The live Granot reads acquired/renewed/released the existing shared account lease; those coordination writes are the sole production writes.

## Actual provider evidence

The [year-to-date capture](evidence/phase2/live-pool-2026-10-14.json) ran 15:58:11–16:01:01 New York. The [extended capture](evidence/phase2/live-pool-extended-2026-10-14.json) ran 16:03:18–16:06:16 New York. The latter is the final discovery inventory.

Both used actual authenticated Estimates in Process, `STATUS=V9`, `TYPEDTE=OPEN`, **`FUSTATUS=9`**, empty `USER`, `DEPT=ALL`, `TYPE=V1`, `SORT=V6`. The actual form was checked using the shipped `verifyEstimatesForm`, including enabled **9=Pool and 10=ALL**. The local session wrapper substitutes 9 only on the fixed Estimates report POST. Production ALL code is unchanged. Actual row priority is parsed separately; every returned row normalized to 9, including the provider's `Prior: Pool` text. Request parameters are not copied into returned row evidence.

The corrected `collectVerifiedEstimates` handles primary Job/email values before `<br>` annotations, start/end move dates, required columns, totals, adaptive splitting, explicit empty results and same-session pagination. The old replay parser was also corrected for primary Job values, Pool labels, timestamped Open Dates and the real scripted form action.

| Observed scope | Pool rows | Coverage |
| --- | ---: | --- |
| October 1–14, 2026 | 20 | Two seven-day partitions; both totals equal rendered rows |
| January 1–October 14, 2026 | 839 | 41 seven-day partitions; all totals reconciled |
| January 1, 2020–October 14, 2026 | **843** | 80 bounded 31-day partitions; every partition one page; every total reconciled, including explicit zeroes |
| Before October 2026 | **823** | A month-only scan misses 97.6% of this inventory |
| Before July 17, 2026, the 90-day inclusive cutoff | **227** | A fixed 90-day Pool scan also misses material work |

Earliest observed Open Date: **May 23, 2025**. Latest: October 13, 2026. Open-month counts: 2025-05=1, 2025-11=1, 2025-12=2; 2026-01=2, 02=5, 03=15, 04=9, 05=38, 06=83, 07=218, 08=232, 09=217, 10=20. No Pool rows were returned for earlier queried partitions. Dates before January 1, 2020 were not inspected; this is a declared survey floor, not a proven Granot retention boundary.

The first run used **49 actual HTTP requests**, including authentication and the repeated current-month comparison. The extended run used **88**, including authentication, two form GETs and 82 report POSTs. Provider coverage counts only form/report requests; the transport counter includes authentication. Every login happened after acquiring `granot:automation:account`, with a real Mongo fence, 45-minute TTL, renewal around requests and successful release. No fake lease or worker wake-up was used. Whole-run elapsed time includes canonical planning and cannot be quoted as provider-only latency.

## Canonical identity, sources and stored state

The extended run read **7,265 Form Leads, 1,856 Call Leads, 911 raw Bookings and 9,201 active Record Links**. The raw driver avoided population and all cancellation filters, so the previous legacy-Boolean Booking browse failure no longer limits this inventory. Both Lead models include duplicates. These are sequential reads, not an atomic snapshot; apply must repeat all checks.

| Classification | Count | Meaning |
| --- | ---: | --- |
| Canonical preview uniquely resolves an existing Lead | **602** | 592 Form + 10 Call; all through `granot_record_link`; all already stored priority9; all desired-state previews `already_current` |
| Canonical preview holds | **241** | No admission or mutation authorized |
| Job/link inventory: active Lead anchor | 603 | One additional anchored row fails full canonical validation; identity alone is insufficient |
| Job/link inventory: official Booking anchor | 1 | Linked Lead stored priority5; observed Job differs from the anchored Lead's Job; held |
| Job/link inventory: no unique Job anchor | 239 | Contact/source checks still needed; not proof a Lead should be created |

The 241 preview holds reconcile exactly: `pending_source_scoped_match` 192; `source_unclassified` 21; `missing_creation_route_data` 8; `multiple_eligible_matches` 1; `job_number_conflict` 12; `invalid_normalized_snapshot` 2; `source_scope_conflict` 1; `creation_policy_observation_only` 4. No held row was patched or resolved. The previously documented competing-Job backfill exceptions remain untouched; these 12 conflicts are report outcomes, not a claimed recount of the eight historical exception groups.

The single observed other-priority anchor is the priority5/Booking conflict above. The 602 valid canonical matches have no stored-priority disagreement. Unmatched and invalid rows retain unknown verdicts rather than being called synchronized.

Provider source counts: Top10 Forms 231; Paid Overflow 210; TBM Forms 188; Best Relocation Forms 142; TBM Forms Prime 18; Main Site Forms 9; Get Movers 8; 10best Inbounds 9; Top10 Inbounds 8; Quote Runner - Premium Branded 8; Referral 4; VQR Forms 2; voicelocal, QR RAW, Main Site Inbounds, PM - Duals, TBM Prime Inbounds and BestRelocation Inbounds one each.

The **602 matched** Leads come from normal existing Source Companies and exact Source Granularities: TBM 175 (171 Form, four Call), Top10 220 (214 Form, six Call), Best Relocation 70 (37 local Form, 33 long-distance Form), Main Site eight Form, Paid Overflow 116 Form, TBM Prime 13 Form. This supports reusing normal Leads, not a new Pool Lead model.

Ingestion Origin: `wordpress_form` **141**, `ringcentral` **5**, `granot_lead_created` **177**, `legacy_unknown` **279**. Only the first 146 have explicit native form/call acquisition provenance. Granot-created records remain ordinary Leads; 279 unknown origins must not be retroactively called proven website/call ingestion.

Of 602 matches, **510 are assigned and 92 unassigned**. Assignment provenance: `extension_crm_username_match` 191, `granot_username_match` 239, `ringcentral_rep_call` 80. Nothing clears or invents a receiver. The provider username could not resolve for 226 preview rows; priority-only matching does not establish a callable Rep identity. Existing quoted/CF facts: 61 quoted with CF, 173 unquoted with CF, 368 unquoted without CF. Priority9 must not authorize quote/CF/contact enrichment to fill those gaps.

## History, closures and Sheets

The [canonical anchor follow-up](evidence/phase2/pool-anchor-followup-2026-10-14.json) joins the **604 observed anchored identities**, including the two beyond the 602 valid preview targets, to raw Lead flags, Desk subjects, priority changes and sheet lineage.

- One anchored priority9 Desk subject is **closed** despite no current Booking/Cancellation pointer. Do not reopen it automatically. 137 subjects are active; the remaining 466 anchored Leads have no observed subject. Existing subject presence cannot be the only Pool sharing prerequisite.
- No anchored candidates were flagged duplicate, bad, unmatched or cancelled. One has an official Booking reference. `no_sync` is explicitly false on 200 and missing on 404; missing is not an explicit false.
- The 602 valid matched Leads all record `synced` Master lineage with a timestamp: **592 `master_forms`, 10 `master_calls`**. This is durable sync evidence, not a fresh Google Sheet row-presence check. The first capture's lineage helper looked for the wrong target prefix; use the corrected extended capture and follow-up for lineage, never its zero helper count as absence evidence.
- Corrected EntityChange history proves **72 committed non9→9 changes across 71 observed anchored Leads**: prior0=16, prior1=28, prior2=15, prior3=1, prior7=4, prior8=8. All 72 have a completed receipt, causal Observation, latest `applied` Decision, `lead_updated` and `sheet_sync_requested` effects. Channels are 58 `priority_updated` webhooks and 14 HTTP automation operations. Entity-associated Sheet Sync jobs are `synced`; coalesced jobs are not a one-job-per-change causal proof. This proves recorded Vantage transitions, not the exact original Granot change time. The initial live join used ObjectIds against string EntityChange IDs; its incorrect zero/false history claims were removed and superseded by the corrected follow-up. **The hypothesis that every Pool Lead was acquired normally and later became Pool remains unproven.** The remainder has unknown transition history.

## Runnable prototype and verification

`pnpm prototype:pool` starts the interactive terminal model. `pnpm prototype:pool:ui` serves [the local UI](http://127.0.0.1:4179); it is running for review. `pnpm prototype:pool:replay` prints the [saved synthetic scenario](evidence/phase2/shared-duty-replay-2026-10-14.json).

The New / Quoted / Other / Pool filters retain private assigned scope outside Pool. A and B share P1, assignment stays B, A's confirmed call clears both views, B's assigned fulfillment increases and only A's outbound count increases. Same-call replay adds no event/credit. A distinct simultaneous B call preserves one requirement and both real calls. Next NY date creates one fresh requirement. Same-day exit/reentry retains completion, Booked/Cancelled exit, unassigned work, an off-goal assigned Rep, answered inbound, late entry, closed dates and advisory claims are surfaced. All records are synthetic and in memory.

Browser checks verified A completion, B's identical completed view, replay, distinct simultaneous calls, next-day due and inactive-reader denial. [Review image](evidence/phase2/pool-prototype-complete.png). The toy reducer serializes commands; it **does not prove database race safety, production permissions, provider corrections, SSE delivery or production server integration**. Those implementation requirements are explicit in the proposal.

The existing 17 focused parser/matching/lease/replay checks pass, including corrected provider-shaped Job/Pool/Open Date parsing. Server `tsc --noEmit --incremental` passes. No production feature tests were claimed and no customer was contacted.

## Reproduce the read-only inspection

From the server checkout (credentials already bound; never print values):

```powershell
node --env-file-if-exists=../agent_granot_credentials/.env --env-file=.env --import tsx ops/pool-prototype/inspect-live.ts --run --from=01/01/2020 --chunk-days=31 --out=docs/rep-desk-and-pool/evidence/phase2/live-pool-extended-2026-10-14.json
node --env-file=.env --import tsx ops/pool-prototype/inspect-anchors.ts --run --input=docs/rep-desk-and-pool/evidence/phase2/live-pool-extended-2026-10-14.json --out=docs/rep-desk-and-pool/evidence/phase2/pool-anchor-followup-2026-10-14.json
node --import tsx ops/pool-prototype/prototype.test.ts
pnpm prototype:pool:replay
```

These commands are discovery only. They never call capture/apply, create an automation run, change cadence or enqueue Sheet Sync. Raw provider HTML/contact data, cookies, credentials, session-bearing URLs and actual Agent/customer identities are not saved to tracked evidence. Live domain data can change between runs; the captures are timestamped facts, not a permanently eligible migration manifest.
