# Best Relocation final reconciliation — November 3, 2026

The Owner-directed final source reconciliation is complete in production. Canonical application, physical delivery, financial readback, independent verification and unchanged same-plan replay passed. The connection now records `retirement_reconciliation_status: complete` and the final run reference. Recurring external ingestion and Granot creation remain closed. **The Source Company remains active for the Owner to deactivate separately.**

The frozen scope is April 30, 2026 midnight New York through **November 3, 2026, 7:49:27 p.m. New York** (`2026-11-04T00:49:27.955Z`). Later source changes are outside this completed run.

## Result

There were 1,982 in-scope physical source rows: 566 Forms, 1,214 Local Forms, 191 Calls and 11 Booked Deal responses. All ten distinct Bookings were accounted for independently of Lead attachment. There were no scoped refund responses. The run intentionally left 1,480 unbooked normal physical source rows untouched. Source copies and historical aliases have separate action accounting; action counters are not physical row counts.

**315 exception Leads were created: 272 Forms and 43 Calls. No new normal Form or Call was created.** The old preview of 125 proposed normal Calls was never applied. The fresh inventory's 126 normal Call identities lacked definite Booking matches and remained excluded.

| Destination | New Leads | Existing selected Leads | Unique selected total |
| --- | ---: | ---: | ---: |
| Forms | 0 | 3 | 3 |
| Calls | 0 | 2 | 2 |
| Duplicate Forms | 2 | 0 | 2 |
| Bad Form Leads | 270 | 168 | 438 |
| Duplicate Calls | 24 | 7 | 31 |
| Bad Call Leads | 19 | 0 | 19 |
| **Total** | **315** | **180** | **495** |

Every selected Lead has exactly one correct physical destination across the six Master Leads tabs. Genuine bad Form annotations, including `Duplicate Form`, route exclusively to Bad Form Leads without automatically changing canonical duplicate flags. Effective duplicate/Form Fill classification takes precedence over bad annotations for Calls.

The 496 review actions resolve to 495 unique Leads. A copied same-durable-ID bad Form pair is collapsed with both source rows retained. Separately, two distinct Local Form source identities resolve to one existing Form with identical protected bad annotations; the second has an explicit adopted source receipt referencing the first review. The protected primary stamp and revision are preserved. All 440 physical bad Form source rows are accounted for, yielding 438 unique Bad Form Leads.

## Financial and billing proof

All ten scoped Bookings already existed; no additional Booking or Cancellation was created. Existing attachments remain **five leadless, three Form-linked and two Call-linked**. Candidate graph matches did not overwrite saved attachments. Three historical Local Forms Booking holders retain their existing long-distance feed assignments and fees.

| Official values for the ten Bookings | Frozen source | Canonical records | Physical Master Booked |
| --- | ---: | ---: | ---: |
| Binder | $11,352.00 | $11,352.00 | $11,352.00 |
| Deposit | $13,219.24 | $13,219.24 | $13,219.24 |

Independent verification read all 20 Binder/Deposit cells and their ten same-row canonical IDs directly from Master Booked. There were zero discrepancies. All 1,008 baseline Bookings and 51 baseline Cancellations retain their recorded financial fields and links; physical counts outside the selected identities remain unchanged. Existing unrelated missing/duplicate global reporting rows were outside this reconciliation.

Lead billing follows the agreed live feed pricing contract, separately from official Booking amounts. Of the 272 new Forms, 60 canonical duplicates cost zero and **212 nonduplicate bad Forms remain billable**: 55 long-distance at $195 plus 157 local at $40, totaling **$17,005 current live Lead spend**. Forty-seven of those nonduplicate bad annotations contain “duplicate”; the text does not set the canonical duplicate flag. All 43 new Calls are effective duplicate/bad exceptions and cost **$0**. No new Lead is unpriced. Stored CPL snapshots were not summed or rewritten.

## Execution, recovery and replay

Run ID: `6aea79aa80506078c37279fe`.

- Released plan SHA-256: `5a7a3c3f82268fbaaf28beafc8186b35f89ae5741534e141f8e58cbad6f6c7b9`.
- Frozen snapshot SHA-256: `16d0f3a23985a71d1da356c9820f1eac98476d5ed1f0f36f54c04670f15c2021`.
- Qualified runtime commit: `4a31e894148b8ddf782143ff23c940043f223cf6`; production deployment `dpl_FkmiMuQYTwKpGQ1jBKdB9gQPmeyp`. [CI, build and production deployment](https://github.com/jbell-rusty-vantage/vantage-movers-server/actions/runs/41753543016) passed.

The Owner confirmed the precise rules and requested completion. The operator bound that authorization to the independently reviewed fresh frozen checksum; this does not claim the Owner personally typed the checksum or released the old preview.

The initial canonical phase succeeded, then a frozen review revision fence stopped the equivalent-source Form case described above. A narrow operator correction added receipt-only equivalent-review adoption with exact primary receipt, source, target, annotation and own-run revision checks. The same immutable plan resumed successfully. No direct approval-field patch, source-plan edit or revision bypass was used. Historical recognized Best Relocation financial display labels were verified without rewriting saved source fields.

The complete same-plan replay processed all 2,024 canonical units and 496 review actions with **zero new canonical applications, conflicts, failures or skipped dependencies**. The replay drain synced 400 claimed jobs with zero failures or deferrals. Verification and independent readback then passed with unchanged scoped entities, revisions, money and physical memberships. Counts remained **819 commands and 954 receipts**.

- Replay entity SHA-256: `9e01179f0612de1e21541ca30c44c4f886b9ce786492cead5d9fc0f28b4c5424`.
- Replay membership SHA-256: `aaacd908282d509958c09f6751891993a56afeac05edc5393438f2d2f5d38c12`.

The closed 69-ID historical Call compatibility inventory remains unchanged. No RingCentral evidence was fabricated. New imports suppress CRM posting, confirmations and automatic Outreach; independent verification found no dispatched SMS. Existing official lifecycle records remain preserved. The independent November 1 general Call backfill was not repeated.

Local qualification included typecheck, source lint, 3,956 full-suite tests (3,794 passed, 162 existing explicit skips, zero failures), 85 focused operator tests and disposable Mongo replica proofs covering transaction fences, allowed/refused normal creation, atomic bad Form routing, interruption/resume and equivalent-review replay. No schema migration or environment changes were required. Any later correction must use audited canonical commands with expected revisions and preserve receipts and official financial history; ingestion must remain retired.

## Evidence and final state

Restricted raw source/contact evidence, frozen plans, authorization binding and per-ID proofs remain gitignored under the original credential-owning checkout's `scripts/output/best-relocation-retirement/owner-final-20261103/`. Key directories are `final-capture/`, `final-plan/`, `apply/`, `resume/`, `first/`, `replay/`, `finalized/` and `independent-audit/`. Independent final proof is `replay-post-apply-review-private.json`; billing proof is `BILLING-CONTRACT-CHECK.json`.

After unchanged replay and fresh verification, `finalize-source` recorded final reconciliation complete at November 3, 9:13:50 p.m. New York without cancelling any additional runs. The 9:14:33 p.m. readback confirmed the final run reference, `complete`, deferred hold cleared, scheduling disabled and no next due time. Both inventoried Granot sources remain `link_only` with source confirmation SMS disabled. The Source Company remains active.

The final 9:17:58 p.m. Mongo readback confirmed the exact-checksum run is `completed` and there are zero pending, retrying, processing or failed Sheet Sync jobs for the captured Best Relocation Lead inventory and selected official financial identities.

A fresh source read at 9:16:30 p.m. compared the full workbook/tab contents, identity sidecar and supplemental cell evidence against the frozen capture: all were unchanged. The extra read initially hit a transient Sheets read quota; its later bounded retry succeeded without source writes. This later observation does not extend the applied watermark. Owner deactivation is the only remaining retirement action and is outside this run.
