# Pool canonical model and transition proposal

Status: **design only; provisional pending the Phase 2 discovery/collision report and Owner decisions below**. No Pool models, commands, routes, permission changes, sync changes, data migrations or production mutations are implemented by this document. Phase 1 baseline is server main `beadfd11` (PR #218), with its Rep money and move-date contracts retained.

Authority: `docs/knowledge/overnight-rep-desk-and-pool.md`, October 13 New York / October 14 UTC. The Owner authorized read-only discovery and an approval-ready recommendation. Any reconciliation of Pool rows with existing Leads requires separate Owner approval. Companion documents: [Pool desk design](POOL-DESK-DESIGN.md), discovery/prototype findings and [boundary review](POOL-REVIEW.md) in this folder; discovery links and measured findings are to be reconciled before handoff.

## Recommendation and evidence boundary

Reuse the existing **canonical FormLead or CallLead** and add a separate **Pool membership and shared daily requirement** representation. Pool is a shared work/visibility mode, not a second copy of an opportunity and not ownership of the canonical Lead. Keep `receiver_agent` and its manual/Granot provenance intact. A future Pool filter alone cannot implement shared authorization or one daily call across Reps.

This recommendation follows existing code contracts, rather than a claim that all returned Pool rows already have unique Lead matches:

- Canonical identity uses source policy, active `GranotRecordLink`, the existing Form/Call identity ladders, and Booking owner context. The models intentionally permit multiple Leads with a Job Number; only official Booking normalized Job identity has its established uniqueness fence.
- Form and Call identity ladders are source-routed and differ. A discovery audit must compare **both models**, duplicates and cross-model collisions before selecting a target. A planner's selected-model success cannot establish absence of a candidate in the other model.
- `normalizeJobNo` and `jobNumbersEquivalent` are existing authority. Letter-prefixed and bare Jobs with the same digit core can be equivalent (`P5562366` / `5562366`); preserve both exact-normalized and equivalent-only match classifications. Never replace them with phone-only deduplication or a new global unique Lead Job index.
- An attached Booking's reciprocal `lead_model`/`lead_ref` is owner evidence. A pending intake Booking or official leadless/referral Booking is a distinct anchor, not permission to mint a new Lead or attach it automatically.
- `periodPlanner.ts` preserves same-workflow periods and never reopens a closed period. Priority codes 2 and 3 remain ordinary Daily, and Phase 1 excludes priority 9 from assigned potential dollars independently of cadence.

**Actual current Granot Pool discovery evidence remains unavailable; the separate authenticated canonical-priority9 inventory is recorded below.** The selector/parser prototype must prove the actual current `FUSTATUS=9` Pool form and returned row identity/priority representation. Stored `FUSTATUS=10` ALL-preview output is useful for testing parsing/matching, but does not prove Pool membership. No production match counts or example Jobs are invented in this draft.

Current access limitation: the deployed Estimates preview fixes the ALL selector. Its safe run response removes `lifecycle_apply.granot_statement`; Form actions retain row/match/Lead metadata, while mapped Call rows do not expose the observed priority. Therefore filtering that preview by **canonical** priority9 would be circular evidence and cannot verify Granot Pool membership. Actual selector/form/row verification remains blocked until the managed Granot credentials, allowed host and existing shared account-lease execution seam are available to the read-only prototype. No guessed endpoint, unauthorized login or lease bypass is proposed.

The coordinator's actual authenticated Booking browse probe also found a separate legacy-data/read-path limit: `GET /api/v1/admin/booked-leads` failed even with `limit=1` because a stored boolean `BookedLead.cancelled=true` was passed to the `CancelledLead` ObjectId population path. No production data repair or API fix is part of this Phase 2 design. Phase 1 money reads use unpopulated lean Booking facts and are not subject to this population step; this discovery coverage limit does not invalidate their aggregation/authorization verification.

A separately measured **canonical-priority9 collision corpus** can still test identity risks through existing APIs. Label it exactly that: it is not an actual Granot Pool9 discovery result and cannot determine Pool admission or selector completeness. Its measured counts and limits are recorded below; they do not establish admission eligibility.

Required report fields before the recommendation is final: selector/control evidence; date partitions and page completeness; unique returned/equivalent Jobs; exact Form-only, Call-only and cross-model matches; duplicates/ineligible candidates; multiple matches; official attached, official leadless/referral and pending Booking anchors; unmatched/insufficient-identity rows; existing canonical priority and receiver/manual-source conflicts; stale/uncertain provider facts; examples redacted to stable hashes and policy flags. Record the read instant, observed totals and any API completeness limits.

## Measured canonical-priority9 inventory and design consequences

The coordinator captured [redacted canonical-priority9 collision evidence](evidence/phase2/canonical-priority9-collisions.json) through authenticated GET-only APIs from **2026-10-14 03:26:37.716080 UTC to 03:27:04.387627 UTC**, with `production_mutations=0`. [Read API surface evidence](evidence/phase2/read-api-surface.json) records the deployed API limits. This is an observed canonical inventory, **not actual Granot Pool selector/report discovery** and not a consistent point-in-time Mongo snapshot.

| Observed API pass | Pages | Reported total / rows / distinct ids |
| --- | ---: | ---: |
| FormLead, nonduplicate/default | 29 | 7,057 / 7,057 / 7,057 |
| FormLead, duplicate=true | 1 | 166 / 166 / 166 |
| CallLead, nonduplicate/default | 7 | 1,556 / 1,556 / 1,556 |
| CallLead, duplicate=true | 2 | 290 / 290 / 290 |
| Booking, cancellation field missing/null subset | 4 | 896 / 896 / 896 |

The four Lead passes observed **9,069 canonical Leads**. Returned rows and distinct ids equaled each pass's reported total; offset pagination and a single-field sort still cannot establish an atomic snapshot under concurrent writes.

Among these returned Leads, canonical stored priority9 appeared on **326 Form Leads and 14 Call Leads**, with **340 distinct normalized Job keys**, no missing Job and 340 unique exact Lead matches in the observed inventory. The report found zero observed cross-model/multiple exact Lead matches, equivalent-only aliases or matches to the observed Booking set for those 340 keys. This is a Lead-inventory result with explicit Booking coverage limits, not proof that all 340 are Pool Leads or globally free of Booking anchors.

**339 were assigned and one was unassigned.** Returned canonical9 flags showed zero duplicate, bad, cancelled, unmatched-creation, no_sync, attached booked, manual receiver or normalization-disagreement cases; no unusual Unicode Job strings or raw/stored-normalization conflicts were observed in the wider Lead inventory. These are returned API facts, not permission to remove those safety gates. In particular population can hide dangling references, and zero returned `booked` does not prove raw absent pointers or no independent Booking. No prior Master Leads write is established: `no_sync=false` is not write-history evidence.

The observed Booking set totals **902**: 896 missing/null-cancellation browse rows plus six additional anchors obtained from Lead-attached Booking facts. **Full Booking coverage is incomplete.** Legacy boolean true cancellation values caused full browse500; the missing/null subset also excludes legacy false and other cancelled/unlinked anchors. Consequently the corpus makes **no all-Booking absence/uniqueness claim** for any candidate, including official leadless/referral or pending intake anchors. Exact creation/admission decisions that depend on that missing negative evidence remain held.

This measured corpus strengthens the provisional design in three concrete ways:

- Both existing Lead models are relevant: a Form-only Pool representation would fail to cover the 14 observed canonical9 Call identities. Reuse canonical models rather than creating a new copy for a known Job.
- An “unassigned only” Pool filter cannot express the requested shared visibility. Most observed canonical9 identities already have a receiver; shared verified membership must be independent of that ownership. The 339 assigned records are evidence for the permission design, **not an approved count of callable Pool Leads**.
- An idempotent membership layer can reference the 340 observed existing identities if later verified/approved. The measurements do not justify new Lead creation, current-month inclusion, automatic priority changes, closed-state reopening or source/Booking/sheet-policy assumptions. Zero observed collisions is useful evidence for this corpus, not a reason to remove cross-model or official-anchor fencing from future commands.

The conditional recommendation therefore remains **existing canonical Lead reuse + explicit shared membership/work**, with actual selector/row verification, source/accepted-fact validation and full required Booking evidence still gating any live admission strategy. The collector/matching prototype must retain its synthetic/live/canonical9 evidence labels rather than presenting this census as a successful Granot Pool collection.

## Matching and disposition contract

Discovery is global **inventory**, but any later effect remains source-scoped and gated. Matching emits a recommendation and reasons; it does not create, deduplicate, relink, reprioritize, assign, enroll or sync a Lead.

| Evidence after both-model comparison | Proposed future disposition, subject to approval |
| --- | --- |
| One eligible existing Lead, coherent Source Scope, matching active link and no conflicting Booking | Reuse that exact Lead id; plan membership only after current accepted facts and source policy are verified in the command transaction. |
| One eligible Lead with a different canonical priority | Report the actual priority and temporal winner. Do not overwrite it because a Pool selector returned the row. A reviewed newer accepted fact may support a future priority/membership transition; stale/conflicting evidence is held. |
| Duplicate aliases with one established canonical link/reciprocal Booking owner | Report all aliases. Reuse only the verified canonical identity if independently eligible. Do not silently merge/delete duplicates or choose the newest Lead. |
| Form and Call candidates, multiple same-model candidates, cross-source collision or equivalent-only disagreement | Hold for explicit identity/reconciliation review. No new Lead, no membership, no shared Rep contact permission. |
| Official attached Booking or canonical cancellation/bad/closed Lead | Preserve its official/closed state. A Pool row is discrepancy evidence, not authority to reopen or add outreach. |
| Official leadless/referral Booking with no Lead | Preserve the intentional official anchor; no automatic Lead creation, attachment or Pool membership. |
| Pending Owner/employee intake Booking | Reuse the existing reconciliation workflow and report the pending anchor; do not call it official allocation credit or bypass its attachment gate. |
| Malformed residual Booking Lead pointer | Hold. Phase 1's official-leadless gate fails closed for a lone reference/model; Pool identity must do the same. |
| No existing Lead and no Booking/link anchor, sufficient identity | Remain an unmatched discovery row. A future creation strategy needs explicit Owner approval, exact Registry source routing, minimum data and durable sheet exclusion. |
| Missing Job, missing Source Scope or insufficient identity | Unresolved evidence only; no guessed contact-based/global target or placeholder Lead/Booking. |

A globally known Job is **never** treated as missing merely because the selected source model failed to find it. Canonical creation must repeat the approved identity check inside the existing transaction/locking seam, including both-model and Booking/link blockers, so a concurrent ingest cannot mint a second Lead. An idempotent operation id references the reviewed source row/run, while the durable target is the canonical Lead/opportunity; deduplication cannot rely only on “Job seen before.”

Existing `granotHttpCollector/granotFormLeadMatcher.ts` is a legacy Form-specific preview aid: it has bounded ref/contact candidates and cannot prove a complete cross-model collision audit. `granotLifecycle/identity.ts`, `sourcePolicy.ts`, `leadDesiredState.ts`, canonical domain commands and accepted-fact history remain the intended effects seam. No direct patch from a read-only prototype is approved.

## Proposed persistence

Names below are design names, not implemented collection or API contracts.

| Representation | Purpose and minimum fields |
| --- | --- |
| `PoolMembership` aggregate | Exact `{lead_model, lead_id}`, resolved `opportunity_key`, provider Job identity and Source Scope snapshots, state `review/active/ended`, revision, current membership period id, latest accepted fact tuple, discovery/run/decision references, entry/exit reasons and timestamps. No copied customer/contact record or new receiver ownership. |
| Append-only `PoolMembershipPeriod` | Effective interval `[started_at, ended_at)`, policy version, approved decision and observed priority snapshots, source/fact references, entry/exit reason. Replays and identical accepted facts preserve the existing period. |
| `PoolWorkDay` shared logical requirement | Unique `(opportunity_key, business_day, requirement_kind=pool_call)`. Required quantity one, policy/coverage snapshot, linked membership intervals, confirmed qualifying event/completer Agent id, completion time, revision and explicit unknown/partial reasons. Policy version and membership period ids are snapshots, **not uniqueness-key dimensions**. |
| Contact-event completion evidence | Reference the existing deterministic contact evidence; record its unique identity and the shared logical slot it satisfied. Keep caller attribution separate from receiver and from a temporary claim. |
| Optional advisory working lease | Short-lived `claimed_by_agent_id/expires_at` or separate lease record, scoped to membership and revision. It is an operator hint, not exclusivity for contact credit and never a `receiver_agent` write. |

Canonical `normalizeJobNo` performs NFKC, trim, converts maximal runs outside Unicode Letter/Number categories to a space, collapses whitespace, uppercase in en-US and final trim. Punctuation is replaced with a space, not deleted (`P-123` → `P 123`). Prefix equivalence applies only to ASCII `^[A-Z]*(\d+)$` with exactly equal digit cores; leading zeroes are retained. Report raw/stored-normalized disagreement. A prototype implemented in another language must verify these cases against the server normalizer, including Unicode trim/version caveats.

`opportunity_key` must be resolved from coherent canonical identity (existing active Record Link when authoritative, otherwise approved canonical Lead identity), not minted from a row number or phone. The discovery report must establish how equivalent Job spellings/collisions map before a final uniqueness design is approved. Two aliases must not receive separate daily slots. Existing Lead global Job uniqueness is **not** added as a shortcut.

Proposed reviewed indexes:

- One active membership per exact canonical Lead, via a partial unique `(lead_model, lead_id)` index for state `active`; add the equivalent opportunity fence only after collision inventory and the canonical key rule are approved.
- Membership reads `(state, current_period_id, lead_id)` and `(state, normalized_job_no)`; historical periods `(membership_id, started_at)`.
- Shared logical slot unique `(opportunity_key, business_day, requirement_kind)`; work queue `(business_day, state, due_at, opportunity_key)`.
- Event-to-shared-slot uniqueness to make provider replay and simultaneous completions converge; the existing contact-event idempotency fence remains unchanged.
- A claim TTL is housekeeping only. The service must check expiry/revision even before TTL deletion.

These are report-first migration proposals. Apply only after Owner approval, local duplicate/index rehearsals and the repository's migration review. Do not auto-create indexes from a read, use unreviewed env flags or run a production backfill during Phase 2.

## Accepted facts, assignment and entry/exit

The current lifecycle temporal comparator is `(captured_at, Observation id)`. Older facts do not advance the accepted winner; same facts/replays are semantic no-ops. Pool membership must consume an accepted canonical fact/approved decision rather than treating selector value, raw note, table row order or dashboard click as an accepted priority change. Open Date is not a modified-since cursor; discovery absence is not an exit fact unless completeness and an approved absence rule are established.

`receiver_agent` stays canonical and source-protected. Membership is shared regardless of that receiver. Manual and source-less receivers retain protection; Granot latest-wins may update only the existing approved automatic sources under `receiverFillableByGranot`. A claim, outbound call, shared completion or Pool entry never assigns the caller. Outbound self-assignment remains stopped.

Proposed transitions:

| Trigger | Proposed behavior |
| --- | --- |
| New reviewed eligible Pool fact on an open canonical opportunity | Start active Pool membership prospectively at the approved effective boundary; suppress ordinary assigned routine requirements for that membership interval through an explicit work-mode rule. Do not rewrite the canonical receiver or elapsed periods. |
| Same membership fact, receiver refresh or repeated discovery | Update only facts/revision that changed. Preserve membership period and shared logical daily slot; receiver/source changes are not a new quota. |
| Multiple Reps call concurrently | A transaction/CAS and event/slot uniqueness establish one shared completion. Every qualified caller keeps their own event attribution; the losing completion write does not create another shared duty. |
| Priority 2 ↔ 3 outside Pool | Preserve the existing same-Daily-workflow period behavior unchanged. Codes 2/3 are not Pool. |
| Accepted eligible exit fact | End membership prospectively, revoke shared reads/commands immediately at the new revision, and evaluate ordinary assigned work under current approved priority/receiver. Preserve all completed shared work and old periods. |
| Same-day exit and re-entry | Reuse the one logical `pool_call` slot for that opportunity/day. Membership episodes never multiply the daily requirement. |
| Official Booking, cancellation, bad/ineligible state or closed period | End/suspend membership and contact entitlement at the canonical boundary. Do not reopen a closed subject/period. Any proposed reopening is a separate Owner decision/workflow. |
| Partial scan, failed partition, absent row or stale conflicting fact | Preserve last verified facts; report delayed/unknown state. No inferred exit, repriority or reassignment. |
| Owner manual removal while canonical priority remains 9 | Store an explicit audited membership override if approved. Do not silently map code 9 to New/Daily or change potential dollars. |

How a call completed earlier on the **same New York day** transfers between ordinary and shared work, and whether entry late in a day owes a call immediately, are Owner decisions. Recommend a single logical shared slot, prospective intervals and explicit coverage transfer rather than retrospectively duplicating duties. The implementation must prove both ordinary→Pool and Pool→ordinary same-day cases against approved rules. It must not reopen closed periods or change existing per-Rep historical goal credit.

The proposed shared requirement is independent of viewer: one call per approved eligible working day, shared across Reps. The desk companion document specifies event-time reviewed caller identity, deterministic call qualification, individual outbound-goal attribution and claim/permission UX. Calendar/working-day policy, holidays, due time and coverage tolerances must be explicit Owner-approved policy; do not infer them from a particular Rep's roster schedule. The calendar remains America/New_York and uses calendar dates across DST.

## Source attribution and durable Master Leads exclusion

Source Company, Source Granularity, selected Lead model and Registry lifecycle policy remain authoritative. Preserve source snapshots on reused Leads; do not classify an unknown/deferred/referral source by the Pool selector or collector's chosen model. A new unmatched Pool Lead would require the same minimum-data and source gates as canonical creation, including approved handling where the current event class cannot create (`priority_updated` never mints). This proposal does not grant a new creation policy or effect flag. Preserve the current priority1/5 enrichment boundary and immutable ingested contact facts; priority9 is not a new contact/move enrichment permission. Call Lead display move date stays null even if provider/raw state carries a date.

**No Pool-created Lead may sync to Master Leads.** A one-time skipped enqueue does not meet that requirement. Proposed future Pool creation carries an immutable server-owned sheet-routing exclusion tied to its creation provenance; every Master Leads route checks it in the coordinator/planner, legacy sync, retry/rebuild, contains/repair and all source-tab routing, including Duplicate/Bad. It must survive later priority/assignment changes and exit from Pool unless the Owner approves an explicit migration.

Do not rely solely on existing `no_sync`: `noSyncAppliesToNormalTabs` deliberately does not apply to Duplicate/Bad routing. It is also ordinary reporting scope, not Pool provenance. Do not mutate unrelated existing No-Sync semantics or add a priority column to Sheets.

For a Pool row matching an **already synced ordinary Lead**, reuse the existing Lead and preserve its prior sheet history. Adding membership creates no new Lead row and no source-lead creation job. Whether ordinary canonical source-lead updates continue while it is in Pool, whether later transitions restore/suppress updates, and whether an Owner-approved permanent exclusion is necessary are explicit decisions; do not delete existing sheet rows or quietly change ordinary sync. Official Booking-sheet behavior remains a separate existing contract; Pool membership itself never creates an official Booking.

## Query, DTO, live and command boundaries

Future Pool access is an explicit service authorization path, separate from the existing assigned queue/detail/commands. Rep, Owner and Manager may read an eligible current active membership regardless of `receiver_agent`; an arbitrary subject/Lead id or `pool=true` flag cannot broaden access. Revalidate membership revision, eligibility and role/roster at each read/command and contact-evidence association. Exiting membership revokes shared access; detail selection and signed cursors resnapshot when membership scope changes. A missing/foreign/inactive membership returns the same safe refusal shape, without revealing another Rep's private assigned Lead.

Proposed Pool list/detail DTOs expose the same canonical Lead display plus `membership_id`, membership revision/state, policy version, assignment as informational provenance, shared requirement id/day, required/confirmed/remaining, coverage, last qualifying caller/time and advisory claim expiry. No raw receipts, provider credentials, false completed zero, per-viewer daily quotas or copied customer record. Unknown/partial/delayed states must remain explicit. The server computes status/sort/permission over the complete set before pagination.

Reuse the existing outreach live SSE and cache invalidation. Proposed additive scoped membership/shared-work topics refresh the Pool queue/detail for eligible desk roles on committed entry/exit, completion, eligibility and policy changes; invalidate ordinary assigned views for transition effects without exposing their private scope to other Reps. The existing connect/reconnect/clock full refetch handles lost hints and NY rollover. No second live connection, Daily Operations metric writer or Owner-only API becomes a Rep dependency.

Future mutations require existing signed actors, strict DTOs, idempotency keys, expected revisions/CAS, canonical transactions, append-only evidence and after-commit invalidation. Shared completion attribution identifies the actual caller; no receiver overwrite. Owner-only creation/reconciliation/configuration gates remain Owner-only. Phase 2 introduces none of these routes or mutations.

## Money and policy interaction

Phase 1 remains unchanged: gross booked binder is the Rep's own stable-id official allocation, cancelled Bookings retained; assigned potential is the reciprocal attached Booking total for the currently assigned eligible Lead. **Priority 9 contributes zero** to assigned potential, even if membership is active or an unmapped ordinary subject remains open. Pool sharing never allocates Booking total money to every viewer or caller, and an advisory claim never transfers historical allocation credit.

A future Pool screen may show “excluded from assigned potential at priority 9” and known linkage/coverage without adding its amount to Rep totals. Any Pool money metric, caller commission transfer, membership-with-non9 behavior or priority9 exclusion reversal needs a separately defined Owner-approved basis. No estimate/CPL/rate or placeholder Booking is introduced.

## Safe inventory APIs for the discovery matcher

The production inventory must be read through authenticated APIs; do not connect a prototype to production Mongo or print raw customer records/secrets.

| Existing route and parser | Use and limitation |
| --- | --- |
| `GET /api/v1/admin/form-leads?database_scope=production&limit=250&page=N` | Parse `{ok,data:{items,page,limit,total,has_next_page}}`. Form browse **does not apply** the accepted `job_no` query parameter and its `q` fields omit Form Job Number. Fetch complete unfiltered inventory in two passes: ordinary/default `duplicate=false`, then `duplicate=true`, paging to `has_next_page=false`; normalize client-side and retain only redacted identity/policy summaries. Never treat `?job_no=X` returning rows as exact matches. |
| `GET /api/v1/admin/call-leads?database_scope=production&job_no=X&limit=250&page=N` | `job_no` is an escaped case-insensitive substring against raw/normalized Job. Page all candidates, include a separate duplicate pass, then client-filter exact-normalized and existing prefix-equivalent digit-core identities. A full Call inventory is stronger if feasible. |
| `GET /api/v1/admin/booked-leads?database_scope=production&job_no=X&limit=250&page=N` | Same substring/filter caveat; default includes attached/leadless/referral/pending Bookings. Parse `booking_origin`, `is_referral_booking`, `is_leadless_booking`, both Lead pointer components, cancellation and allocation/total fields. Populated `lead_ref` can be an object; take `_id`, not `String(object)`. Paginate and classify with existing official gates. Do not hide pending anchors by requesting `leadless=false`. |
| `GET /api/v1/booked-leads` | Existing compatibility read populates customer/Agent only, avoiding the cancellation population path. It returns `{ok,data:[...]}` but hard-caps newest200 and accepts no pagination/filter contract. It can supply positive recent anchor evidence only; never claim complete Booking inventory. Hydrated serialization may also omit invalid legacy cancellation values; preserve cancellation uncertainty. |
| `GET /api/v1/admin/booked-leads?cancelled=false&limit=250&page=N` | Existing presence filter includes only missing/null cancellation references, not every semantically noncancelled record. It excludes nonnull legacy boolean true **and false**, and all cancellation ObjectId refs. This can obtain a bounded subset without the failing value but cannot establish absence of older/cancelled/pending/leadless anchors outside that subset. |
| `GET /api/v1/admin/{form-leads,call-leads,booked-leads}/:id?database_scope=production` | Read targeted canonical pointer/source/eligibility evidence for selected collision cases. This is detail evidence, not proof of an exhaustive Job match. |
| `GET /api/v1/admin/job-number-timeline?job_no=X` | Signed Owner timeline provides lifecycle/Booking context. Its loader chooses the first linked Lead rather than enumerating both-model candidates, so it cannot prove uniqueness or no cross-model match. |
| `GET /api/v1/admin/granot-lifecycle/jobs/:normalized_job_no?limit=...&cursor=...` | Existing authenticated lifecycle timeline/context, paginated entries. It uses exact normalized Job and one Booking, not complete equivalent/cross-model Lead inventory. |
| `GET /api/v1/admin/search?q=X&limit=25` | UI search only: capped and Form fields omit Job Number. Do not use its empty/truncated result as a creation or completeness decision. |

`granot_priority` is the raw canonical stored string; `last_accepted_granot_observation` carries its accepted-fact evidence. Existing browse has no priority/`granot_priority` filter or `fields`/`select` projection. These unsupported parameters cannot reduce a complete inventory to priority9 or prevent the server from returning other fields. Minimize immediately in memory and persist only redacted facts. `adminBrowseQuerySchema` strips unknown query fields rather than proving they were applied. In particular `normalized_job_no` is not a browse filter. No arbitrary current-month/arrival-window filter belongs on the canonical matching inventory: a current-month Granot Pool row may match an older Vantage Lead. CSV export has a 5,000-row cap and is not an exhaustive fallback.

If full Booking browse remains unavailable, combine observed unpopulated nested `Lead.booked` facts, the explicit missing/null cancellation subset, and targeted native-read timeline context as **partial positive anchor evidence**. An unlinked Lead or missing subset match is not proof of no Booking: official leadless/referral and pending intake anchors can have no reciprocal Lead mirror. Record unresolved anchor coverage prominently, hold creation/admission decisions that require its absence, and do not use the compatibility newest200 cap or timeline's selected anchor to disguise the gap. No existing complete all-Booking raw-detail/list API was established in the source review; a future reviewed read-path/data-quality remediation is separate from this design.

Browse pagination is offset-based without a consistent snapshot token or guaranteed id tie for equal timestamps. Record total per page and distinct ids, detect repeats/count movement, and re-read ambiguous/changed candidates before any approved plan. A single crawl during concurrent writes is best-effort inventory, not transactionally complete evidence. Selector/parser completeness and canonical inventory completeness are separate report dimensions.

## Implementation, migration and rollback proposal after approval

1. **Approve evidence and policy.** Finalize measured collision classifications; select reconciliation/no-create strategy, canonical opportunity key, membership authority, shared calendar/call qualification, same-day transitions, sheet permanence and existing-synced-Lead behavior. Keep ambiguous/pending/closed cases out of the initial pilot.
2. **Add versioned contracts and local-only persistence.** Design strict additive schemas, service permissions, uniqueness/index reports, idempotent command/accepted-fact adapters, durable sheet guard, shared slot/event fences and same-connection live topics. Pure and local-replica tests prove no provider/customer effects. No migration should alter ordinary Lead Job uniqueness, cadence2/3 or historical Bookings.
3. **Read-only shadow inventory.** Rehearse full partitions/pages, collision quarantine, replay and failure recovery against synthetic/local data. Report candidate/eligible/blocked counts and scope generations without membership or source mutations.
4. **Reviewed dry-run migration and selected-id pilot.** Produce immutable manifest with exact canonical ids, expected revisions, reviewed Source Scope/anchors, effective boundary and sheet policy. Local apply/replay/crash/CAS/index/rollback rehearsal precedes any separately approved production apply.
5. **Controlled release.** Deploy readers/guards first; activate only approved selected memberships through audited commands under reviewed configuration. Verify shared role access/revocation and source-sheet exclusion on durable routes before collector expansion. A new environment flag is not an approved policy mechanism.
6. **Recovery/rollback.** Stop new membership transitions/creation via the reviewed configuration/command gate; preserve durable periods, completions, accepted facts and sheet exclusions. Revoke Pool shared access and resnapshot affected ordinary scopes. Do not delete Leads/Bookings, reopen closed periods, resend provider effects, remove sheet history or restore previously suppressed source sync merely by rolling back code. Readers must tolerate additive fields before an older deployment is promoted; a code rollback that drops the durable sheet guard is unsafe while Pool-origin Leads exist.

Acceptance must include both-model exact/equivalent/cross-source collisions, known-Job no-second-Lead races, reciprocal and malformed/pending/official anchors, duplicate/bad/cancelled/unmatched/closed exclusions, priority conflicts and stale/replayed facts, manual receiver protection, one shared day slot across viewers/reentry/concurrency, event-time caller credit, revocation/cursor isolation/reconnect, weekends/holidays/midnight/DST and partial coverage, unchanged ordinary2↔3/closed periods, unchanged Phase1 money, durable no-Master-Leads on create/retry/repair/duplicate/bad/exit, no customer sends and migration/rollback compatibility.

## Owner decisions required before feature work

- Approve the measured matching/reconciliation strategy for existing Leads and Booking anchors; determine whether any unmatched Pool row may create a canonical Lead and under which exact source/event policy.
- Confirm whether verified Pool form membership, canonical accepted priority9, or an explicitly reconciled combination is authoritative; specify conflict/absence/manual override entry/exit policy.
- Approve canonical opportunity-key equivalence and collision quarantine; no automatic duplicate merge or global Lead Job uniqueness is proposed.
- Approve the shared calendar, due boundary, call qualifications, coverage/recovery and event-time caller eligibility; same-day quota transfer and late-entry behavior remain explicit.
- Approve permanent sheet exclusion for Pool-created Leads and treatment of existing synced Leads/later transitions; no sheet columns or history deletion are proposed.
- Approve selected-id migration/pilot, operator controls and rollback plan. Any change to priority9 assigned-potential exclusion or money credit is a separate decision.

Until those approvals, the executable deliverable remains discovery/matching only and this model remains a reviewable proposal.
