# Granot cadence and existing Call enrichment — live findings

Investigation evidence, November 4, 2026. The Owner subsequently accepted the direction; the [final specification](SPECIFICATION.md) and [single-session implementation plan](IMPLEMENTATION-PLAN.md) now govern the proposed change. No production record, Sheet, schedule, classification, qualification, or provider state was changed by this investigation.

## Baseline correction

The earlier investigation started from the attached checkout at `9320d597` plus older uncommitted billing work. The newer same-remote checkout `vantage-storage-main` contained the completed retirement/billing implementation. During this investigation the attached checkout advanced to `d63e512d`, containing `190be6fa` (Form Fill convergence/final-result ordering) and the final retirement work. No agent action in this chat performed that integration. Relevant admission, disposition, identity and sibling files have no diff between `190be6fa` and `d63e512d`.

**Form Fill does route admitted Calls to Duplicate Calls at zero billable cost.** The first statement that Form Fill was attribution-only described the older checkout and does not describe the integrated contract. Likewise, do not apply the earlier proposal's blanket qualification-only enrichment gate to existing historical Calls. The Owner has clarified their continuing enrichment need. This document supersedes those conclusions and the uniform-cadence recommendation.

## Read-only production inventory

Observed approximately **9:45 p.m. November 4, 2026, America/New_York** (`2026-11-05T02:45:27Z`). Mongo and Sheets reads were sequential, not a transactional cross-system snapshot.

The query lives in `scripts/audit-call-enrichment-inventory.ts`. It uses a raw Mongo client with narrow projections, bounded query times and explicit database `vantagemovers`, plus Google Sheets read-only scope. No application model/index initialization, cron invocation, live Granot/RingCentral request or mutation runs. It compares contact values in memory without printing or saving them. Output lives at `scripts/output/call-enrichment-inventory-2026-11-04/summary.json`; restricted per-ID follow-up inventory is `non-ringcentral-ids.private.json` beside it.

| Saved Call cohort | Count |
| --- | ---: |
| Supported saved RingCentral qualification | 1,715 |
| Closed approved Best Relocation historical inventory | 69 |
| Protected final Best Relocation import admission | 43 |
| Other historical Calls outside current reporting admission | 212 |
| **Total** | **2,039** |

There are **324 without supported saved RingCentral qualification**. The current object admission predicate and Mongo admission filter agree on every Call: zero mismatches. Ingestion-origin labels alone do not establish qualification.

The 112 admitted non-RingCentral Calls classify as **24 Calls, 69 Duplicate Calls, 19 Bad Call Leads**. All are Best Relocation history. The 212 others remain outside reporting admission; this does not invalidate official Bookings attached to them.

**These historical Calls are not all finished.** Among the 24 normal admitted Calls, 17 have no Job Number, 19 have no Priority, and three have an attached official Booking. Among the 21 with no attached official Booking, 17 have neither Job nor Priority. One has Priority 5 without its own attached Booking; its Job matches a Booking elsewhere, which is evidence to review, not permission to reattach it. Missing Priority is unknown, not proof an opportunity is open or closed.

Among the other 212 historical Calls outside reporting admission: 175 have no Priority, 36 have no Job and 32 have an attached official Booking. Their latest creation is September 8. The 53 creations since November 3 midnight New York comprise ten RingCentral-qualified Calls and the 43 approved final-import exceptions; no other admission path appears in that slice. There was no new import in this investigation.

## Form Fill reporting does not eliminate operational pairs

The actual live Master Leads tabs are **Forms, Calls, Duplicate Forms, Bad Form Leads, Duplicate Calls, Bad Call Leads**.

An admitted Call matching an eligible non-duplicate Form by exact normalized caller phone and overarching canonical Source Company gets `form_fill=true`. Form/Call granularities may differ. Form Fill makes it an effective reporting duplicate without rewriting the canonical repeat-call `duplicate` flag. Duplicate reporting takes precedence over bad-call reporting. Saved Form Fill is retained positive evidence; Form removal or movement does not automatically clear it.

The sibling planner and Desk consume Mongo facts, not Sheet tab membership. They deliberately distinguish Form Fill from a repeat-call duplicate. The sibling planner rejects canonical `duplicate=true` but does not reject `form_fill=true`. Desk eligibility ignores Form Fill alone and uses a verified `granot_form_sibling` to give the Form the pair's one cadence. Therefore **no future pairs** is not a logical consequence of the reporting rule.

Live proof: **42 saved sibling links; 41 classify as Duplicate Calls and one as Calls**. They comprise 39 RingCentral-qualified Calls and three final-import Calls. Current canonical-company/primary-phone comparison found 114 Call/Form overlaps, 111 on admitted Calls; all 111 classify as Duplicate Calls. This does not reconstruct when the classifications were established.

The physical Sheet is not fully converged:

| Physical tab | Rows | Comparison with current Mongo policy |
| --- | ---: | --- |
| Calls | 1,607 | 1,330 belong in Calls; **74 classify as Duplicate Calls**; 203 are outside reporting admission |
| Duplicate Calls | 352 | 346 classify as Duplicate Calls; six are outside reporting admission |
| Bad Call Leads | 19 | All classify as Bad Call Leads |

There are no unknown Mongo IDs or repeated IDs within these tabs. Cross-tab membership and missing desired rows need separate verification. These physical discrepancies do not mean the Form Fill rule is absent. No Sheet repair was performed. Increased Granot frequency alone need not fix them, because a Lead business no-op does not automatically request a Sheet write.

Owner clarification: the completed general Call reporting backfill begins November 1 New York midnight, not all history. A follow-up read at 21:55 New York found all 74 Form Fill rows retained in Calls were created before that boundary; 36 have sibling markers. All 74 lack saved original-arrival timestamps, so this is consistent with the bounded historical scope rather than proof of each exact backfill exclusion. Do not expand the completed backfill or infer a runtime date exemption from those retained physical rows.

## Contact and target identity

**Yes: Granot enrichment preserves the operational caller phone and writes different Granot contact details to `granot_contact_snapshot`.** The immutable ingested snapshot remains separate. Contact/quote enrichment follows the existing Priority 1/5 gate.

Of 2,037 comparable ingested phones, 2,036 agree with the live normalized phone; one historical exception needs provenance inspection before claiming a perfect historical invariant. Three Calls have a different Granot snapshot phone, supported behavior. All 1,715 qualified Calls have comparable intake phones; the same one mismatch and three snapshot differences occur in that cohort. This inventory does not attribute the mismatch to a writer.

Keep established Record Link/Job identity ahead of phone fallback. For an independent jobless Call, resolve its Call Source Granularity from the Granot Registry route, then require a unique normalized caller match. Source Company is the cross-channel Form Fill scope; it should not silently replace the narrower Call identity scope.

Current data has no company/phone candidate group spanning multiple Call feeds, but it has **ten multiple-candidate groups** among non-repeat-duplicate non-anchor Calls, even at feed scope. Different opportunities outside the 90-day duplicate window can legitimately share a caller. Never choose newest/first arbitrarily or overwrite a conflicting Job.

## Recommended rules to lock

1. **New creation:** only ordinary qualified RingCentral ingestion can create a new Call. Granot never creates one or manufactures admission. Retired external ingestion stays closed.
2. **Existing history:** sound Granot evidence may update an existing historical Call without a new RingCentral event. Keep source scope, unique identity, Job-conflict, manual-assignment, temporal and revision safeguards. An enrichment must not grant billing admission or restore an excluded Sheet row. The 24 normal approved historical Calls show that the bounded reporting compatibility cannot simply be removed.
3. **Form Fill:** keep the present Form-first verified sibling mechanism for this cadence change. It updates an existing Call's context while the Form owns the work; it does not create a second billable Call or second cadence. Removing new sibling mirroring would be an explicit operational change requiring a replacement for its Desk/job-holder/Booking authority, not an automatic consequence of reporting duplicates. Do not conflate effective reporting duplicates with canonical repeat-call duplicates.
4. **Business update:** accept valid newer Priority; fill a missing Job only on sound identity; resolve one active Agent under existing assignment authority. Preserve primary/ingested contacts and manual receivers. Broad contact/location/quote enrichment stays at Priority 1/5; accepted Call move dates retain their any-valid-Priority rule. Preserve exact Bad Form priority-only authority.
5. **No-op:** unchanged normalized business values create no business revision/EntityChange or new business Sheet intent, and do not restart a Desk period. A fresh accepted snapshot may advance temporal evidence and perform existing bounded Outreach repair. Exact receipt replay reuses saved results; older captured evidence cannot become fresh at apply time. Do not skip the canonical planner solely because a raw row hash repeats: Registry authority and target state can change independently.
6. **Projection repair:** keep reporting destination reconciliation separate from Lead business changes. Preview and repair known physical discrepancies through audited canonical projection paths with admission/history intact. A successful no-op cannot assert that Sheets are correct. Do not manufacture a Lead mutation just to force delivery. This investigation does not authorize deleting historical memberships.
7. **Terminalization:** use actual accepted Granot evidence and the existing policy. Priority 5 is not an official Booking. Missing qualification, age, absent Job/Priority or absence from a Follow-Up report cannot authorize closure. Older scope may require provider discovery. This query did not sign into Granot or establish every historical opportunity's true current provider state.

## Proposed cadence and next packet

Recommend **hourly 08:00 through 20:00 New York**, then **22:00, 00:00, 02:00, 04:00, 06:00** overnight: 18 slots on an ordinary day. Keep New York business-hour semantics, explicitly test DST and local slot identity, and retain the hourly UTC platform trigger. Keep the 90 inclusive Open Dates plus observed older months; an hourly changed-since filter would miss older jobs changing today.

Eighteen ALL slots mean at least 234 ALL child runs per ordinary day, six times the current base 39, before older months and enabled correlated Pool refresh. Keep 06:00 Pool discovery independent, decide Pool refresh cadence explicitly, fix the latest-slot 90-minute freshness blind spot and measure full collection plus synchronization before claiming the cadence qualified.

After agreement on these rules, the single-session packet should bind to the integrated baseline and sequence: verify current code/work; implement shared schedule/latest-slot behavior; implement freshness and required no-op protections without changing admission; run focused unit and disposable Mongo journeys; update owning Services; deliver a reviewable patch and release/rollback runbook. Include regression proof for Form Fill reporting versus pairing, existing history, phone ambiguity, no-op cadence preservation, independent Sheet repair, DST, incomplete/failed/missed slots and Pool lanes. Production cleanup, historical provider discovery and deployment need explicit scope/evidence. No runtime implementation or production qualification is claimed here.
