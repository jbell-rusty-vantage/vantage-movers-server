# November 3 release evidence

## Final source reconciliation complete

The Owner-return run is complete in production through November 3 at 7:49:27 p.m. New York. [Final report](FINAL-RECONCILIATION-2026-11-03.md) records 315 exception creates, zero new normal Leads, 495 correct unique Lead memberships, ten preserved official Bookings ($11,352 Binder / $13,219.24 deposits), independent physical money-cell checks and unchanged same-plan replay. Run `6aea79aa80506078c37279fe` now records completed final reconciliation. Recurring ingestion and Granot creation remain closed; the Source Company remains active for separate Owner deactivation.

Qualified runtime: `4a31e894148b8ddf782143ff23c940043f223cf6`, deployment `dpl_FkmiMuQYTwKpGQ1jBKdB9gQPmeyp`, [Actions 41753543016](https://github.com/jbell-rusty-vantage/vantage-movers-server/actions/runs/41753543016). Resume and replay retained the exact released source checksum. Final local checks included 85 focused operator tests and the equivalent-review transaction proof. The sections below retain the earlier implementation, interruption and held-session history; their pending statements are superseded by the final report.

## Owner-return implementation, November 3 evening

The Owner confirmed the next-session rules and requested completion. The new manual planner uses a deterministic Booking graph, treats normal unbooked source rows as explicit non-mutating exclusions, preserves financial identities independently of Lead attachment, and binds normal create matches into the frozen plan. Bad Forms carry their protected review before initial save/outbox; all new final Forms/Calls require the released outer checksum. Literal international phone values behind source parse errors are captured as supplemental cell evidence without source writes; copied bad Form identities retain both original annotations while producing one canonical identity.

Local verification: typecheck; 3,956 full-suite tests (3,794 pass, 162 explicit skips, zero failures); 81 focused operator tests; and disposable loopback transaction proof for atomic exception routing, allowed/refused normal creates, stale-lease rollback/resume and unchanged replay. Independent source/create reviews passed. No schema migration or environment changes are required. Rollback stops the bounded operator; any imported facts require expected-revision canonical corrections rather than deleting provenance or reopening ingestion.

These are implementation and local/read-only preparation results. Production deployment, exact final capture/checksum release, canonical source application, physical delivery, financial preservation and same-plan replay must be recorded below before final reconciliation is described as complete. The Source Company remains active and the independent November 1 general backfill is not repeated.

The first live apply completed all canonical actions, including the 315 approved exception creates, with zero canonical failures/conflicts. It stopped during review reconciliation when two approved Local Form identities resolved to one existing Lead: the first identical bad annotation advanced the revision, so the second frozen expected revision correctly failed. No concurrent Owner edit caused this stop. The operator correction adopts the second row as explicit equivalent-review source evidence, retaining the first protected stamp and one canonical projection. The frozen source selection and checksum remain unchanged. Completion is still pending resume, delivery and replay proof; no direct approval-field or aggregate patch is used to bypass the revision fence.

The current phase finishes reporting behavior, tab migration, the independent November 1 Call backfill, and shutdown of Best Relocation external ingestion and Granot creation policies. The Owner explicitly deferred **all final Best Relocation source ingestion**, including selective bad/duplicate rows. No source apply, source admission, new source Lead, checker reconciliation or financial import has run. The Source Company remains active.

## Released code and checks

- Initial server implementation: `6febe2149277c10dc13947f588c133f21a644c9e`, [Actions 41716889924](https://github.com/jbell-rusty-vantage/vantage-movers-server/actions/runs/41716889924).
- Timestamp-convention correction: `11975b07878ffd5f22f4af16451d4a285ae1d659`, [Actions 41720805194](https://github.com/jbell-rusty-vantage/vantage-movers-server/actions/runs/41720805194).
- Owner clarification, exclusive Bad Forms, protected final-source admission, deferred shutdown and independent general-backfill tooling: `0e64b2671581f50ef177a56862dc47b8764ba697`, [Actions 41728400113](https://github.com/jbell-rusty-vantage/vantage-movers-server/actions/runs/41728400113). Typecheck, 3,948 tests (3,787 pass, 161 explicit skips, zero failures), build and production deploy passed. Production deployment: `dpl_4RY2v5K3WdzbPthcZ2JPki4baUHx`.
- Admin: `d6a91f6664b7499cdd4ecfdf8b0ba2727f821069`, [Actions 41718887667](https://github.com/jbell-rusty-vantage/vantage-admin/actions/runs/41718887667). Typecheck, tests, build and deployment passed. Local browser proof passed four scenarios using an isolated Owner account and databases; no live Owner browser session was available.
- Sol review found and closed two concrete defects: scalar-versus-array imported-review query parity, and admission through an unsuccessful historical receipt. Real loopback replica checks also proved admission immutability, lease rollback, replay, preserved original qualification and financial fields, and deferred shutdown. Their disposable databases were removed.

The prerequisite optimization release and qualified purge handoff remain documented in [README](README.md). No retention policy, historical database scope or permanent index was changed here.

## Historical Best Relocation reporting preservation

The final compatibility change accompanies this release record. Holding the final source import must not suppress already saved Best Relocation history through the earlier mistaken universal RingCentral gate. The shared object/query/expression policy therefore recognizes a closed native pre-cutover inventory of exactly 69 existing Call IDs, with the exact Best Relocation company and Call feed bindings. It does not grant eligibility by Source Company label alone or admit unknown future IDs.

Manifest: `best-relocation-legacy-reporting-v1`, captured November 3 at 4:43:54 p.m. New York; SHA-256 of the sorted opaque IDs: `8ddf4d0e2e120bad4562a4cc93dd4961557bd8c53153dcf973b21a8d3648d990`. The full native manifest remains restricted; the code includes only opaque IDs and policy metadata. Original duplicate, Form Fill, unmatched and No-Sync rules remain. No RingCentral evidence, admission stamp, checker fact, source receipt, revision, Lead or sheet row is created by this read compatibility rule.

Fifty focused tests and independent 77-fixture loopback proof established exact object/Mongo/billing-expression parity, closed-ID/source bindings and routing transport through facade, contains, queued planning and No-Sync. The independent general backfill's 16 Calls do not intersect this inventory and retain identical decisions. Production read-only verification compares the same canonical inventory before and after deployment; its deployed SHA and results are retained in the restricted compatibility proof and release chat.

## Tab migration and projections

Both writer leases were held and renewed through the 805-second old-invocation window. Master Leads retained its existing numeric IDs:

| Tab | Numeric ID |
| --- | ---: |
| Forms | 0 |
| Calls | 641721911 |
| Duplicate Forms | 1511761596 |
| Bad Form Leads | 751467040 |
| Duplicate Calls | 1878779543 |
| Bad Call Leads, newly created | 1878650713 |

The two Form titles were renamed in place. Six reporting workbooks had 16 numeric tab renames and eight formula edits. Of 22 inventoried formulas, 21 referenced Master Leads or changed; the remaining unrelated formula stayed untouched. Effective-value verification passed with zero errors. Readback on November 3 at 5:33:40 p.m. New York confirmed all original Master numeric IDs, canonical headers and all 21 relevant derivative formulas. Source-sheet writing retained its existing setting; the external tracker was never written.

Bad Forms now have the exclusive Bad Form Leads destination, including canonical duplicates and booked/cancelled Forms. Destination success precedes stale primary deletion. Domain duplicate and lifecycle flags are preserved. Source checker facts themselves remain unapplied under the hold.

## Production shutdown, source company preserved

Shutdown ID: `best-relocation-shutdown-20261103-0e64b267`. Applied November 3 at 5:25:07 p.m. New York, without a source apply.

| Registry source | Before | After |
| --- | --- | --- |
| `6a8546291ff601e1d4ab962d`, Best Relocation Forms, including Local/Long Distance routes | `create_if_missing` | `link_only` |
| `6a8546291ff601e1d4ab9630`, BestRelocation Inbounds | `link_only` | `link_only` |

Both source entries remain enabled with the same lifecycle routes and lifecycle processing. New-lead confirmation SMS is disabled. The Source Company remains `active: true`; only its Granot creation retirement marker was set. The connection has `application_enabled: false`, `next_due_at: null`, a durable deferred-ingestion hold and `pending_owner_review`. Final ingestion run references remain empty. A later bounded manual run requires an exact-checksum Owner release; recurring ingestion stays closed.

Two old failed August 4 runs were skipped and their existing **null** checkpoints preserved. Readbacks at 5:25 and 5:32 p.m. New York reported no new source runs, source receipts, source commands or external/Granot-minted Best Relocation Leads after shutdown.

Production signed probes returned `410 BEST_RELOCATION_RETIRED` for activation, inspect, preview, run, retry and conflict-resolution mutations. The old heartbeat returned a retired no-op. Matching-build controlled checks proved that the worker, publisher and enabled-env override cannot start work, and Vercel configuration contains no Best Relocation heartbeat or queue consumer registration. These are controlled stale-path checks, not a claim that an actual delayed production queue message was delivered. The later readback followed a routine cron cycle; no observation at the former six-hour Best Relocation due time is claimed.

The Vercel production environment inventory showed zero obsolete ingestion-only names, zero hidden production entries, and the historical `BEST_RELOCATION_LEADS_SHEET_ID` reporting derivative preserved. Shared credentials and Master IDs were not changed.

## Independent general Call backfill

Run: `general-call-reporting-20261103-v1`. Ledger scope: `lead-reporting:general-call-backfill:general-call-reporting-20261103-v1`. This is independent of Best Relocation ingestion and never marks it complete.

- Fixed range: November 1, 2026 midnight New York (`2026-11-01T04:00:00.000Z`) through November 3 at 5:10:27 p.m. New York (`2026-11-03T22:10:27.414Z`).
- Plan SHA-256: `57af35641a393ef3a22ff503692851765d315134b75db62e86cb98d139ebfa7b`.
- Six source/null scopes, 12 bounded pages and the installed timestamp/source indexes covered 19 initial candidates: 16 in range and three verified October 31 exclusions. There were no held Best Relocation candidates, unresolved provider results or unpriced rows.
- Twelve missing original start times and twelve final result observations were recovered; all recovered final results were Accepted. Original qualification, transport, duration, provider identity, route and existing timing fields were preserved. Twelve revisions advanced once; four did not change. The two canonical Form Fill flags already existed.
- Physical membership changed from 16 Calls / zero Duplicate Calls to 14 Calls / two Duplicate Calls / zero Bad Call Leads. Exactly two IDs moved. Both first and replay drains synced 16 jobs with zero failures or deferrals.
- Independent first and replay verification both passed: 16 planned, 16 observed, zero mismatches, zero unresolved results and exactly one correct physical membership per included ID.
- Exact-plan replay changed no captured entity fact, revision or physical membership. Entity SHA-256 before/after replay: `c203f6ae2feea6e7c1169d57e064f12ba8ce4a60baeed9dfec82929c6eeca552`; membership SHA-256: `fc35c33fa6c7af04c6cc8139cf40e47ced4d41ae299e0fdea5ee2b49511250c6`; combined replay proof: `eba42baa06f2a8f5579280ff2481d14a8fc7f2584043d9fcb5268e412169a1f1`.
- All 1,006 baseline Booked Deal IDs and 47 Cancellation IDs retained their exact physical counts from before the initial apply through replay. No official financial rows were created or lost by this backfill.

Legacy billing would count 16 Calls at $3,220; the shared current policy counts 14 at $2,810. The $410 difference is a legacy comparison. Current-policy spend was already $2,810 before this data backfill and did not drop again. Already issued invoices and exported files were not rewritten.

## Deferred source work and private evidence

The final source snapshot is frozen at November 3, 4:07:40 p.m. New York, hash `9c8e5b756ed016bb7c93318f85ae1f90909d16e8dded9b4ceae0d2c0ffd1ace9`, with an April 30 midnight New York lower bound. Its corrected read-only held plan is `13d084ccca104ad96b83ccb54fe0bca1e1e50aa5767ebe39b7babddfc8f44100`. All 125 held normal-Call source-row identities exactly match the Owner's private HTML/CSV review list.

The preview resolves 22 existing originals and 44 separately bound duplicate aliases; it proposes 39 exception Call creates and holds 125 normal Call creates plus five additional uncertain Call identities. **None of those actions ran.** The preview also retains six duplicated Local Form source rows, two protected `over_2000` changes and seven uncertain Booking-to-Lead links for review. Source rows and auxiliary alias actions are distinct: 21 source duplicate-checker requests plus two alias requests produce the aggregate duplicate-request counter of 23.

Raw snapshots, contacts, checker notes, plans, native inventories and per-ID memberships remain restricted and gitignored in the original server's `scripts/output/best-relocation-retirement/`. The `final/`, `general-final/`, `general-before/`, `general-first/` and `general-replay/` subdirectories hold the corresponding evidence. No raw source notes or contacts are committed.

Return to the manual source ingestion only with the Owner's next guidance, reviewed identities and a checksum-bound plan. The final source reconciliation, its financial/membership proof and its source-run replay remain deferred; shutdown is not a successful final ingestion.
