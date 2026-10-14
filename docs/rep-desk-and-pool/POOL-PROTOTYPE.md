# Pool discovery and matching prototype

**Status: read-only prototype verified; actual current-month Granot Pool discovery is blocked.** Phase 1 was merged and production verification opened Phase 2 at `2026-10-14T03:07:37Z`. This work is on `codex/pool-discovery-approval`, based on the completed desk. Nothing here creates, reprioritizes, reassigns, enrolls, syncs, deduplicates or reconciles production Pool records. No Pool feature, route, configuration or effect flag was implemented.

The prototype and its checks are under [`ops/pool-prototype/`](../../ops/pool-prototype/). The model and Owner decisions are in [POOL-MODEL.md](POOL-MODEL.md), collection/Sheets design in [POOL-COLLECTION-AND-SHEETS.md](POOL-COLLECTION-AND-SHEETS.md), and combined approval brief in [POOL-APPROVAL-SPEC.md](POOL-APPROVAL-SPEC.md). Those are proposed designs, not approved reconciliation behavior.

## Three evidence sources, kept distinct

| Source | What is actually established | What remains unproved |
| --- | --- | --- |
| Historical documented Granot read, October 13 | Estimates in Process uses `STATUS=V9`, `TYPEDTE=OPEN`, priority option `FUSTATUS=9` labelled Pool, `10` labelled ALL; the new table lacks old numeric `no` | Current actual Pool option/form state, current Pool rows and pagination |
| Synthetic replay and transport fixtures | Strict parsing, control verification, partition coverage, rendered total/page checks, identity collision/anchor holds, real-scope lease ordering/loss/release interfaces | No live Granot request, real session login, or production lease was exercised by these fixtures |
| Actual authenticated canonical read API inventory | Existing canonical priority-9 identities and their flags across both Lead models | These are not observed Granot Pool rows or proof of current-month Pool membership; Booking coverage is incomplete |

Historical evidence is [granot-priorities-and-rep-desk.md](../knowledge/granot-priorities-and-rep-desk.md), particularly the form/columns section; current source behavior is [Estimates in Process](../knowledge/estimates-in-process-update.md). The synthetic output is explicitly labelled in [synthetic-pool-prototype.json](evidence/phase2/synthetic-pool-prototype.json). Actual read-only facts are [canonical-priority9-collisions.json](evidence/phase2/canonical-priority9-collisions.json) and [read-api-surface.json](evidence/phase2/read-api-surface.json).

## Actual discovery access limit

The existing Estimates collector fixes `FUSTATUS=10`; its API removes filters for this operation and its redacted run DTO does not expose the actual form, returned row priority, full HTML, transaction totals, or pager diagnostics. An ALL preview cannot prove that a Pool-9 query ran, and canonical Lead priority 9 cannot substitute for an observed Granot priority. The separate Leads & Advertising parser still requires numeric `no` and must not be used for the new Estimates table.

The managed runtime currently lacks the four Granot credential bindings, an allowed `eagle.hellomoving.com` destination, and a supplied approved runtime for the existing shared `granot:automation:account` lease. The coordinating agent requested that concrete access and lease authority; no answer had arrived at this evidence checkpoint. Existing run GETs showed eight `applying` runs. No generic worker was awakened: it can process previously approved apply work before a new preview. No direct login or local fake lease was used as a workaround.

The prototype is ready to inspect actual captures once that authority is supplied. The unresolved external-access limit must be retained in the final handoff. A current-month Pool total, source distribution, pagination result, actual matching outcome or traffic measurement is **not claimed**.

## Executable pieces and safe boundaries

| File | Purpose |
| --- | --- |
| `contracts.ts` | Strict metadata/capture schemas. Contacts and unknown canonical fields are rejected; incomplete raw Booking anchors can be represented and held. |
| `parser.ts` | Verifies `9 = Pool`, `10 = ALL` and safe fixed controls from supplied form HTML; parses only the new direct-cell results table. |
| `matching.ts` | Pure identity/anchor inventory across Form, Call, Booking and active Granot record links. Output hashes job/lead keys and never grants mutation or admission. |
| `replay.ts` | New York current-month seven-day partitions, complete rendered-page checks and redacted replay report. |
| `cli.ts` | Local JSON replay only. It has no live mode, credentials, Mongo connection, default fetch, apply flag or provider write. Invalid/incomplete input refuses success. |
| `live.ts` | Required-authority collector adapter: existing authenticated session must be supplied by an approved runtime under the existing global account lease. No default live transport or lease provider exists. |
| `fixtures.ts`, `prototype.test.ts` | Explicitly synthetic form/table/canonical facts and 17 meaningful focused tests. |

Reproduce the pure checks with:

```sh
node --import tsx ops/pool-prototype/prototype.test.ts
mkdir -p work
node --import tsx -e 'const fs=require("node:fs"); const f=require("./ops/pool-prototype/fixtures.ts"); fs.writeFileSync("work/pool-synthetic-capture.json",JSON.stringify(f.syntheticBundle(),null,2));'
node --import tsx ops/pool-prototype/cli.ts --input=work/pool-synthetic-capture.json --output=work/pool-synthetic-report.json
```

Create the scratch `work/` directory before those replay commands. Use direct execution of the test file for the reported 17 registered `node:test` cases; this environment's `--test` wrapper reported only one file-level result. The CLI returns exit 0 only when every requested rendered query is complete, exit 2 for an incomplete discovery report and exit 1 for rejected input. It suppresses arbitrary parser/provider input in error messages and never prints HTML, contacts, cookies or session-bearing URLs.

The supplied replay JSON contains provenance, `as_of`, sanitized form HTML, exact window/page HTML and canonical metadata. Live-labelled replay must attest the shared lease scope externally; the report explicitly labels that attestation as **not independently verified**. Only an approved live runtime can provide actual lease checks. Never label synthetic fixtures as a live capture.

## Request, partition and completeness rules

For October 13 New York the proposed current-month query plan is October 1–7 and October 8–13. Partitioning uses date-only calendar arithmetic; the choice of at most seven inclusive days reflects earlier observed successful windows, not a proven universal Granot limit. It covers only jobs opened in the current month through the current New York date. It cannot prove absence of older Pool jobs or detect every later change to an older Open Date.

Before building any request, form verification requires one enabled `FUSTATUS` select, exactly one option `9` labelled Pool and one `10` labelled ALL, a POST action to `estprocessret`, `STATUS=V9`, `TYPEDTE=OPEN`, real dates and the requested `USER` empty, `DEPT=ALL`, `TYPE=V1`, `SORT=V6` values. The body is explicit; it does not infer a date control from a label containing “to.” It never uses `STATUS=V15`, Booked Jobs or an invented alternate endpoint.

The parser requires exactly one recognized new table with `job_no`, `open_date`, `follow_up`, `user`, `customer`, and `source`; duplicate headers, old `no`, broken cell cardinality and multiple candidate tables are held. Nested tables are excluded from direct header/cell text. Totals lines do not become identities. Missing job identity remains visible as insufficient evidence. Row priority comes only from bounded `Prior: <digits>` in the actual row; the requested filter value is never copied into a row. Missing/ambiguous priority or a returned priority other than 9 prevents a completeness claim.

An empty result needs the recognized zero transaction total; an empty table without that evidence is ambiguous, and a missing table is schema drift. Captured row counts must equal the declared transaction total. Supported `Page n of m` summaries must cover every ordered page exactly once with consistent totals. Repeated pages, unsupported pager controls, missing/unsafe next links, missing totals, contradictory totals and rows outside the Open Date interval prevent success. The adapter follows only bounded same-session relative `estprocessret` next links and refuses cross-origin/session paths. Unsupported pagination needs actual selector investigation, never guessed parameters or a silent first-page result.

The live adapter acquires the existing account scope with the documented 45-minute lease TTL **before** the session factory calls the existing authentication routine. It checks the supplied fence before/after collection requests and canonical reads, and releases in `finally`. Lease busy/lost/authority mismatch fails closed. The default budget is 64 collection requests, with a hard configuration bound of 256; `collection_requests` excludes login, redirect and retry traffic, whose actual total is unknown unless the approved runtime instruments it. The normal two-window example would require one form GET plus two result POSTs, in addition to authentication and any actual pager/redirect/retry requests; this is a request plan, not a live measurement.

## Identity inventory and anchor holds

Matching reuses the repository's NFKC Unicode letters/numbers, punctuation-to-space, uppercase normalization. It examines raw and stored normalized Job Numbers; disagreement is a hold. Digit-core prefix compatibility is secondary and reported separately, not silently accepted as an exact match. Duplicate/bad/unmatched anchors and cancelled/closed candidates remain visible. Both Lead models are included even when an authoritative Booking resolves one canonical owner.

Reports distinguish unique exact identity, same-model ambiguity, cross-model collision, unmatched/missing identity, compatibility-only aliases, official Booking anchor, multiple official Bookings, dangling/malformed/unknown/pending Booking anchors and conflicting active Granot links. A pending-only Booking is explicitly blocked rather than called unmatched. Partial raw `lead_ref`/`lead_model` presence is never promoted to a legacy leadless Booking. An unlinked Booking can use referral/legacy-leadless classification only when an empty raw anchor is explicitly established; otherwise it remains uncertain. Canonical anchors are deduplicated by model plus stable id, including identical id strings in different models.

Every classification is **identity-only**, `admission_eligibility=not_evaluated`, `allowed_mutation=false`, with source and manual-assignment policy marked unchecked. Unique job identity does not establish source eligibility, current Pool membership, permission to create a second Lead, or authority to override a receiver. `no_sync=false` counts only the explicit flag, and prior Master Leads lineage is unknown unless separate lineage evidence is supplied. Missing linkage, partial canonical snapshots or partial Booking reads are not interpreted as proof of absence.

## Verified results

Focused direct suite: **17/17 passed**. Scoped ESLint passed using the repository's correctness rules applied to the new ops files. An isolated TypeScript project check extending the server's strict compiler options and including every prototype file passed. The coordinator's full server `tsc --noEmit --incremental` check, including the new ops files, also passed with zero errors. The pure replay CLI passed and its output includes 14 synthetic row observations over 13 distinct job identities, one repeated receiver/source snapshot, and all important collision/anchor hold classes. It performed **0 network requests and 0 production mutations**.

The actual canonical API inventory observed 9,069 distinct Lead ids across 7,057 ordinary + 166 duplicate Form Leads and 1,556 ordinary + 290 duplicate Call Leads. Among current canonical priority-9 records it found **326 Form + 14 Call = 340** unique normalized job identities, 339 with receivers and one without. It observed no duplicate/bad/cancelled/unmatched/no-sync/attached-booking/raw-normalization conflict flags in that canonical-9 subset. These are canonical-9 facts only, not live Pool observations or admission decisions.

Booking coverage is explicitly partial: 896 missing/null-cancellation browse rows plus six Lead-attached anchors, total 902. Full Booking browse failed on a legacy Boolean `true` cancellation reference; the `cancelled=false` API presence filter also excludes legacy Boolean false. Thus no observed Booking match is **not proof of no official Booking anchor**. Offset pagination and single-field sorting also do not constitute a point-in-time snapshot. Prior Sheet writes remain unknown. The actual inventory summary has no collision examples to expose because its observed canonical-9 job identities were unique; synthetic collisions establish prototype behavior only.

## Next concrete read, then Owner gate

After approved credential/host/shared-lease authority is available, supply the existing authentication session factory and real shared lease provider to `collectPoolReadOnly`, capture the actual form/control state, fetch both current-month partitions, follow verified pagers, reconcile returned totals and priorities, and read complete canonical/Booking/record-link candidates including legacy anchors. Persist only the redacted report with actual provenance, exact covered windows and residual gaps. A busy/lost lease, unexpected form, schema drift or incomplete page remains a hold; no apply worker, lifecycle receipt or Pool command is invoked.

Owner approval is still required for any Pool reconciliation or implementation strategy. This prototype does not grant that approval. Resolve the shared visibility/call, canonical reuse/transition, source/Sheets exclusion, collision handling and older-open sweep decisions in the linked approval specification before writing production membership or feature behavior.
