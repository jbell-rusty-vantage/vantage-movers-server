# 14 — Call Log capture and Number search: efficiency analysis and recommendation

Status: analysis and recommendation. Not a delivery plan, not a contract change.
Authority for product rules stays with [01](01-specification.md), [03](03-server-pipeline-and-jobs.md), [04](04-server-routes.md), [10](10-intelligence-agent-contract.md).
Companion reading: [13 — Contact Number analysis surfaces](13-number-analysis-surfaces.md) (what the analysis path touches) and [workspace/ATTENTION-PROJECTION.md](workspace/ATTENTION-PROJECTION.md) (why Needs Attention is `pending_projection`).
Code of record: `src/services/numberActivity/*`, `src/services/salesIntelligence/outreach/*`, `src/services/salesIntelligence/attachment/*`, `src/services/salesIntelligence/jobs.ts`.

No customer phones appear in this document.

---

## 0. What this is

13 inventoried the analysis path. ATTENTION-PROJECTION explained one visible symptom. Neither
covered the layer underneath: **how call-log evidence gets in, how a Contact Number becomes
findable, and what each Owner read actually costs.** This document reads that layer and proposes
the work.

The short version: the capture and read paths are correct but they are **O(corpus) where the
evidence is O(subject)**. Five separate places re-derive a whole-collection answer to serve a
single-subject question. Individually each is survivable; stacked, they are why publish never
lands, why the job queue does not drain, and why every Owner page view is a multi-collection scan.

Findings are ranked by production impact, not by where they sit in the pipeline.

| # | Finding | Severity | Shape of fix |
| --- | --- | --- | --- |
| 1 | `readCaptureCoverage()` runs ~13 largely unindexed counts on **every** Owner read | Critical | Cache / index / project |
| 2 | Attention publish is ~12 Mongo reads × every Outreach Record | Critical | Batch + narrow the candidate set |
| 3 | Number → Lead attachment scans the **entire** Lead corpus per number | Critical | Reverse the lookup onto the existing phone index |
| 4 | Call Log reconcile re-fetches and re-projects a **12-hour** window every 10 min | High | Incremental window + cheap change test |
| 5 | Drain budget and publish budget together exceed the platform timeout | High | One shared deadline |
| 6 | `search_terms` cap drift (20 vs 50) silently drops Job Numbers from search | High | One cap, one writer contract |
| 7 | Job claim index does not match the claim query or its sort | Medium | Correct compound index |
| 8 | Number search sorts in memory for every term / suffix query | Medium | Compound indexes |
| 9 | Timeline `conversationSource` scans up to 2,000 interactions per page | Medium | Persist the link, drop the scan |
| 10 | Digit search is exact-only above 10 digits; no suffix fallback | Low | Widen the digit predicate |
| 11 | `assertIndexes()` issues a `listIndexes` per claim and per lead persist | Low | Process-level memo |
| 12 | Source scan laps all Contact Numbers in ~2.8 days | Low | Change-driven, not round-robin |

---

## 1. Every Owner read pays for a full-corpus coverage recount

`readCaptureCoverage()` (`src/services/numberActivity/coverage.ts:38`) issues **one job count, ten
`countDocuments` calls and one `find`** before returning. `ownerRead()` wraps that around
*every* Owner-facing payload (`coverage.ts:84`).

That means one number search, one timeline page, one Attention GET and one Outreach detail each
carry the same 13-query tax. Worse, several of those counts have no index that can serve them:

| Count | Collection | Index available | Result |
| --- | --- | --- | --- |
| `recordings: { $size: 0 }`, `terminal`, `direction $ne`, `recording_discovery.state $ne` | `call_interactions` | none — `$size` is not indexable | **COLLSCAN** |
| `merged_into_id: null, recording_discovery.state: "no_recording"` | `call_interactions` | none | **COLLSCAN** |
| `"media.blob_pathname": { $type: "string" }, "media.purged_at": null` | `lead_conversations` | none | **COLLSCAN** |
| `"analysis_eligibility.status": "undetermined"` | `lead_conversations` | none | **COLLSCAN** |
| `call_interaction_id` + `provider_account_id` + `media_digest_sha256` + `media.*` | `lead_conversations` | none | **COLLSCAN** |
| `availability_reason`, `state` | `lead_conversations` | partial (`state` prefix) | index + filter |

`CALL_INTERACTION_INDEXES` (`src/models/CallInteraction.ts:13`) and
`LEAD_CONVERSATION_INDEXES` (`src/models/LeadConversation.ts:13`) confirm none of these shapes
is covered.

So a single Owner page view scans `call_interactions` twice and `lead_conversations` three times,
end to end. The analysis path makes this much worse: `list_number_activity` calls
`getNumberTimeline`, which calls `ownerRead` — and the tool is paginated to an **80-page**
ceiling (13 §5.4). One busy number's timeline preflight can therefore trigger on the order of
**400 collection scans**.

**Recommendation.** Coverage is a *dashboard health strip*, not per-row truth. Split it:

1. Keep `known_through`, `gaps` and `capabilities` on the read path — those are two cheap
   `sales_intelligence_sync_state` documents.
2. Move the ten recording/conversation counters to a **projected counters document**, refreshed by
   the existing 5-minute media/transcribe crons and read as one document. The Owner is already
   looking at a watermark that lags; a counter that lags one cron tick is honest and costs one read.
3. Until (2) lands, memoize `readCaptureCoverage()` per request/invocation. `readAttention` and
   `toOutreachDto` already pass `coverage` down to avoid re-deriving it — generalize that.
4. Add the missing indexes regardless, so backfill and repair paths stop scanning:
   `{ merged_into_id: 1, terminal: 1, "recording_discovery.state": 1 }` on `call_interactions`, and
   `{ state: 1, "analysis_eligibility.status": 1 }` plus a partial index on `"media.blob_pathname"`
   for `lead_conversations`. Replace `recordings: { $size: 0 }` with a stored `recording_count`, or
   with `"recordings.0": { $exists: false }`, which *is* indexable — `$size` can never use an index.

This one change is worth more than the rest combined, because it is on every read on every surface.

---

## 2. Attention publish cannot finish, and the size abort is the wrong guard

ATTENTION-PROJECTION already names the per-record cost. The precise number matters for sizing the fix.

`toOutreachDto` (`src/services/salesIntelligence/outreach/reads.ts:23`) per record:

| Reads | Source |
| --- | --- |
| 2 | `resolvePolicy()` — pointer + version, **uncached** (`policy.ts:36`) |
| 5 | followups, restrictions, review items, Contact Number, 24h unsuccessful-attempt audit |
| 1 | agents by id |
| 1 | Lead (Form or Call) |
| 1 | `booked_leads` |
| 1 | `cancelled_leads` (when booked) |
| 1 | latest Call Interaction on the number |

**≈ 12 round trips per record.** At the observed 4,008 records that is roughly **48,000 round trips
inside a 40-second budget** — about 1,200 queries/second sustained, from a serverless function,
through a transaction-capable replica set. It is not a tuning problem; it is the wrong shape.

Two independent defects sit inside this:

- **`resolvePolicy()` is called per record.** Policy is one immutable version pointer. Resolve it
  once per publish and pass it in. That alone removes 8,016 reads.
- **The snapshot builds a full Owner detail DTO for a list row.** `publishAttentionSnapshot`
  (`outreach/attention.ts:28`) keeps a row only if `attention_band` is set or `review_badges` is
  non-empty — *after* paying for the complete DTO, including `related_record_links`,
  `allowed_actions` and per-followup action availability, none of which the list card renders.

**Recommendation, in order:**

1. **Hoist the invariants.** `resolvePolicy()` and `readCaptureCoverage()` once per publish.
2. **Decide band membership before building the DTO.** `derive()` needs record state, followups,
   restrictions, review items and eligibility. Load those five for a *page* of 50 records with five
   `$in` queries, run `derive()` on the batch, and only then build rows for records that actually
   earned a band or a badge. That turns 12 reads/record into ~5 reads per 50 records.
3. **Build a list row, not a detail DTO.** Introduce `toAttentionRowDto` carrying only what the desk
   renders. Detail stays live on row open — that contract (13 §5.8, ATTENTION-PROJECTION §4) is
   already correct and should not change.
4. **Narrow the candidate set at the query, not in the loop.** The publish currently pages *every*
   non-purged record. Closed records with no open review item can never produce a band; the
   `outreach_state_due` index (`models/salesIntelligence/outreach.ts:33`) can exclude them at the
   server.
5. **Treat `snapshot_size` as a product question, not a budget.** ATTENTION-PROJECTION is right that
   these are two decisions. The 12 MB abort is protecting the right invariant (no partial
   publication) against the wrong input: 2,250 historical unworked Form Leads from the repair sweep
   are not a desk. Whatever the product answer, once (1)–(4) land the size guard stops being the
   thing that fires.

There is also a read-path cost the earlier document did not cover: `readAttention`
(`attention.ts:65`) runs `z.array(attentionRowDtoSchema).parse(snapshot.rows)` over the **entire**
snapshot on every paginated GET, then slices. At the 12 MB ceiling that is a full multi-megabyte Zod
validation per page view. Validate on write — it already is — and trust the immutable row on read,
or store rows pre-bucketed by band so the common filters slice without a full parse.

---

## 3. Attaching Leads to a number scans the entire Lead corpus, per number

This is the most expensive thing in the system and it is a *search* problem wearing a worker's clothes.

When capture creates a new Contact Number, `scheduleDownstream`
(`numberActivity/persistInteraction.ts`) enqueues `attachment_refresh`. That job
(`salesIntelligence/attachment/refresh.ts:47`) resolves to an `attachment-scan:{model}:{numberId}`
subject, which does this:

```ts
const filter = refs[1] ? { _id: { $gt: new mongoose.Types.ObjectId(refs[1]) } } : {};
const leads = model === "FormLead"
  ? await getFormLeadModel().find(filter).sort({ _id: 1 }).limit(PAGE).session(session).lean()
  : await getCallLeadModel().find(filter).sort({ _id: 1 }).limit(PAGE).session(session).lean();
for (const lead of leads) count += await persistLeadAttachments(lead, model, session, lease.job_id, new Date(), first);
if (leads.length === PAGE) await enqueueNumberScan(first, row.input_revision, session, model, String(leads.at(-1)!._id));
```

That is an **unfiltered walk of every Form Lead and every Call Lead, 250 at a time, once per Contact
Number, for both models.** Each of those 250 leads then runs `persistLeadAttachments`
(`attachment/store.ts:58`), which itself does an `assertIndexes` round trip, a `phoneEvidence` pass,
and a `contact_numbers` lookup per phone.

Cost is `O(numbers × leads)`. With thousands of numbers and a Lead corpus of any realistic size,
this is the dominant workload in the queue and a very plausible primary source of the 3,633-pending
/ 7,278-completed backlog.

**It is entirely avoidable.** The join key is already indexed on both sides:

- `FormLeadSchema.index({ normalized_phone_number: 1 })` (`models/FormLead.ts:128`)
- `CallLeadSchema.index({ normalized_phone_number: 1, createdAt: -1 })` (`models/CallLead.ts:177`)
- `CallLeadSchema.index({ "ingested_contact_snapshot.normalized_phone_number": 1, … })` (`models/CallLead.ts:224`)

and `normalizePhoneNumberForMatch` (`src/utils/phone.ts:1`) produces the **ten-digit NANP form** —
which is exactly `contact_numbers.national_ten` (`numberActivity/phone.ts`, `toNationalTenDigit`).

**Recommendation.** Replace the corpus scan with a keyed lookup:

```ts
// attachment-scan for one number: ask the index, don't walk the collection
const ten = number.national_ten;
const candidates = await Leads.find({
  $or: [
    { normalized_phone_number: ten },
    { "ingested_contact_snapshot.normalized_phone_number": ten },
    { "granot_contact_snapshot.normalized_phone_number": ten },
    { "ringcentral.original_caller.normalized_phone_number": ten },
  ],
}).limit(PAGE + 1);
```

Three things to settle while doing this:

- **Index the two snapshot paths that are not indexed today.** `granot_contact_snapshot` and
  `ringcentral.original_caller` are read by `phoneEvidence` (`attachment/sources.ts:24`) but only the
  CallLead `ingested_contact_snapshot` path has an index. Without them the `$or` degrades to a scan
  and nothing is gained.
- **Keep the exact-identity path separate.** `exactEvidence` (`attachment/sources.ts:52`) joins on
  `telephony_session_id` / `session_id` / `call_log_ids`, already an indexed lookup driven from the
  Lead. That path is correct and should stay lead-driven.
- **Non-NANP numbers have a null `national_ten`.** Fall back to the full E.164 digit string for those
  rather than silently attaching nothing; the fallback set is tiny.

This is the highest-leverage throughput fix after §1. It converts the queue's dominant job from
`O(corpus)` to `O(matches)`, which is typically single digits.

---

## 4. Call Log reconcile re-reads twelve hours, every ten minutes

`callLogReconcileConfig()` (`numberActivity/reconcileCallLog.ts:69`) sets a **720-minute floor**, and
`resolveWindowStart` (`:507`) takes the **earlier** of the cursor-derived start and `now − 720 min`:

```ts
const rollingStart = new Date(windowTo.getTime() - config.rollingLookbackMinutes * 60_000);
const lastTo = state.cursor?.last_sync_to ?? null;
if (!lastTo) return rollingStart;
const cursorStart = new Date(lastTo.getTime() - config.overlapMinutes * 60_000);
return cursorStart <= rollingStart ? cursorStart : rollingStart;
```

So the cursor can only ever move the window **earlier**, never later. The window is a floor, not a
watermark. With the cron at `3-59/10` (`vercel.json`), every call-log record is fetched and
re-projected roughly **72 times** before it ages out.

Per re-projection, `applyInteractionObservation` (`persistInteraction.ts:107`) opens a **Mongo
transaction**, reads aliases, resolves canonical rows, and only then discovers nothing changed and
returns `noop: true` (`:236`). The noop is detected *inside* the transaction, after the reads.
Separately, `runWindow` calls `await renew()` **once per record** (`:333`) — a fenced
`findOneAndUpdate` per record, regardless of elapsed time.

For a 12-hour window of N records, each run costs N transactions + N lease renewals + ~3N reads, 144
times a day, to learn almost nothing.

**Recommendation:**

1. **Make the window a watermark with a bounded safety lookback.**
   `max(cursor.last_sync_to − overlap, now − safety)` with `safety` around 60–90 minutes, not 720.
   Keep the 12-hour reach available as the **gap-repair** path, which already exists and is the
   correct mechanism for catching up (`nextState`, `:512`). The honesty contract does not change:
   the cursor and `known_complete_through` still advance only on a complete window.
2. **Use the watermark that is already stored.** `provider_modified_watermark` is computed and
   persisted but explicitly "diagnostic today" (`:395`). Records whose `lastModifiedTime` is at or
   before the stored watermark, and whose id already resolves to a known alias, cannot change the
   projection — skip them before opening a transaction. A cheap pre-filter that turns most of the
   re-read into a no-op with zero writes.
3. **Renew the lease on a clock, not per record.** `if (Date.now() - lastRenew > ttl / 3) await renew()`.
   Removes N round trips per window.
4. **Re-tune the page budget with the window.** `maxPages: 20 × perPage: 250` is a 5,000-record
   ceiling sized for a 12-hour sweep. A 90-minute window needs far less, which frees provider budget
   for gap repair — the path that actually needs it.

Note the cadence interaction: the lease TTL is 5 minutes and the cron is every 10, so runs do not
overlap today. If the window shrinks, the cron can safely move to `*/5` for fresher capture at lower
total cost — better latency *and* fewer provider calls, the rare case where both move the right way.

---

## 5. The two 40-second budgets do not fit in one invocation

`runOutreachEnsureOnce` (`outreach/worker.ts:62`) runs:

- `drainOutreachEnsureJobs(100)` — its own **40-second** deadline (`:54`)
- then `publishAttentionSnapshot()` — its own **40-second** deadline (`attention.ts:21`)

Both clocks start independently. The function can therefore need **80+ seconds**, and there is **no
`maxDuration` configured anywhere** in `vercel.json` or the handlers — so the ceiling is whatever the
platform default is for the plan.

This is a second, independent reason publish never lands, and it is not covered in
ATTENTION-PROJECTION: even a publish that *could* finish in 40 seconds may start at t≈40s with only
a fraction of that left, and be killed mid-walk. A killed invocation writes nothing — which is
indistinguishable, from the Owner's side, from `snapshot_budget`.

**Recommendation:**

1. Set `maxDuration` explicitly for the cron entry point. Stop inheriting a platform default for a
   function with two 40-second internal budgets.
2. **Thread one deadline through both phases.** Compute `deadline = start + budget` once; pass it to
   the drain and to the publish. Publish must receive the *remaining* time, and must abort cleanly
   when it is too small rather than starting a walk it cannot finish.
3. **Separate the two jobs.** Drain and publish contend for the same minute and the same lease
   (`:66`). Publishing does not need the ensure lease. Give publish its own cron and its own lease so
   a drain backlog can never starve the desk — which is exactly what production shows today.
4. Once §2 lands, publish should cost seconds, and the 5-minute snapshot expiry stops being a race
   against cron reliability (ATTENTION-PROJECTION, "What 'ready' would require", item 3).

---

## 6. `search_terms` is capped at two different numbers by two different writers

Three writers maintain `contact_numbers.search_terms`, and they disagree:

| Writer | Cap | Behaviour |
| --- | --- | --- |
| `persistInteraction.ts:152` (`MAX_SEARCH_TERMS = 20`) | **20** | `while (searchTerms.length > 20) searchTerms.shift()` — FIFO drop from the front |
| `rebuild.ts:37` (`MAX_SEARCH_TERMS = 50`) | **50** | `[...terms].slice(0, 50)` |
| `attachment/store.ts` `rebuildAttachmentSearchTerms` | **50** | `[...terms].slice(0, 50)` |

`search_terms` is what makes a number findable by customer name, **Job Number** and agent name
(`buildNumberSearchFilter`, `search.ts:126`). Those terms are written by the attachment and rebuild
paths at 50.

So: a number accumulates up to 50 searchable terms from its attached Leads; then the **next inbound
or outbound call on that number** runs `applyRollupDelta` (`persistInteraction.ts:559`) and shifts
the list down to 20 — dropping the **oldest 30**, which are typically the Job Numbers and names that
matter most. The number silently stops being findable by those terms until an attachment refresh or
an Owner rebuild restores them.

This is a real, Owner-visible search regression with an intermittent trigger, which is the worst kind
to diagnose from a bug report. It is also the only finding here that is a plain defect rather than a
scaling shape.

**Recommendation:** one shared constant, one cap, and a stated contract for which writer owns the
set. `rebuildAttachmentSearchTerms` is the natural owner (it sees all edges); capture should only
*add* a provider name and must not truncate below the owner's cap. Add a regression test that runs
capture over a number with a full term set and asserts no lead-derived term is lost.

---

## 7. The job claim index does not match the claim

`claimCsiJob` (`jobs.ts:119`) issues:

```ts
findOneAndUpdate(
  { deployment, database, stage?, $expr: { $lt: ["$attempts", "$max_attempts"] },
    $or: [ { status: { $in: ["pending", "retry"] }, next_attempt_at: { $lte: now } },
           { status: "leased", leased_until: { $lte: now } } ] },
  { /* … */ },
  { sort: { priority: -1, next_attempt_at: 1, _id: 1 } },
)
```

The available index is `csi_job_due = { status: 1, next_attempt_at: 1, priority: -1 }`
(`models/salesIntelligence/infrastructure.ts:30`). It leads with `status`, the query leads with
dataset fields, and the **sort leads with `priority`**. No index can serve that sort, so every claim
performs a blocking in-memory sort over all matching pending jobs. With thousands pending and up to
150 claims a minute across the ensure drain and the job-recovery drain, this is a meaningful constant
factor on exactly the queue that is not draining.

Each claim additionally pays for an `assertIndexes` round trip (`:93`), an `exists` probe for live AI
work (`:98`) and an `updateMany` dead-letter sweep (`:104`) — three extra commands per claimed job.

**Recommendation:**

1. Add `{ deployment: 1, database: 1, stage: 1, status: 1, priority: -1, next_attempt_at: 1, _id: 1 }`
   and let the claim sort come from the index.
2. Fold the `$or` into a single predicate if possible (for example a materialized `claimable_at`), so
   one index scan serves the whole claim rather than one per branch.
3. Run the dead-letter sweep on its own cadence, not inside every claim.
4. Completed jobs are never removed — 7,278 and rising, with no TTL on `sales_intelligence_jobs`
   (the only `expireAfterSeconds` in `infrastructure.ts` is the Attention snapshot, `:270`). Add a
   retention TTL or a janitor; the audit trail lives in `sales_intelligence_audit_events`, not in
   completed queue rows.

---

## 8. Number search sorts in memory for every term and suffix query

`searchNumberActivity` (`search.ts:138`) always sorts `{ last_activity_at: -1, _id: -1 }`.
`CONTACT_NUMBER_INDEXES` (`models/ContactNumber.ts:14`) offers:

| Index | Serves |
| --- | --- |
| `{ last_activity_at: -1, _id: -1 }` | the unfiltered default listing — correctly |
| `{ digits_reversed: 1 }` | suffix match, **but not the sort** |
| `{ search_terms: 1 }` | term prefix, **but not the sort** |
| `{ classification: 1, last_activity_at: -1 }` | missing the `_id` tiebreak, so still a blocking sort |
| `{ e164: 1 }` unique | exact match — one document, fine |

So any search that is not exact-E.164 and not the bare listing selects on one index and then sorts
the entire match set in memory, against Mongo's 32 MB sort limit. A broad term prefix (a common
surname, a short agent-name fragment) is the failure case, and it fails as an **error**, not as a
slow page.

Two further gaps in the same function:

- `kind` is always in the filter (`"external"`, or `$ne: "external"` under `hygiene`) and is never an
  index prefix. The `hygiene=true` view — the smaller, rarer set — is the one that scans the most.
- `attachment: "linked"` pushes an `$or` over `rollups.attached_lead_count` /
  `rollups.candidate_lead_count` (`search.ts:106`) with no index on either.

**Recommendation.** Add compound indexes that carry the sort:
`{ search_terms: 1, last_activity_at: -1, _id: -1 }`,
`{ digits_reversed: 1, last_activity_at: -1, _id: -1 }`,
`{ kind: 1, last_activity_at: -1, _id: -1 }`,
and extend `classification_activity` with `_id: -1`. These are cheap, additive, and turn the common
Owner searches into pure index scans with no sort stage.

---

## 9. Timeline pages re-derive the conversation link by scanning 2,000 interactions

`conversationSource` (`timeline.ts:328`) resolves Lead Conversations for a number by scanning up to
`CONVERSATION_LINK_SCAN_LIMIT = 2000` recording-bearing interactions (`:339`), collecting recording
ids, and building a large `$in` — **on every timeline page**, including every page of the analysis
`list_number_activity` preflight.

The scan exists because the link is optional: `recordings[].lead_conversation_id` may be unset, in
which case the code falls back to matching `provider_recording_id` within the same
`provider_account_id`.

Meanwhile `interactionSource` (`:200`) filters on `contact_number_id` and sorts
`{ started_at: -1, _id: -1 }`, but `call_interaction_number_started`
(`models/CallInteraction.ts:30`) is `{ contact_number_id: 1, started_at: -1 }` — no `_id` — so that
source also gets a sort stage.

**Recommendation:**

1. Store `contact_number_id` on `lead_conversations` at discovery time and index
   `{ contact_number_id: 1, started_at: -1, _id: -1 }`. The timeline source becomes a direct keyset
   read and the 2,000-row scan disappears. Backfill it from the existing recording link.
2. Failing that, at minimum **backfill `recordings[].lead_conversation_id`** so the fallback branch is
   dead in steady state, and reduce the scan to the page window rather than 2,000.
3. Extend `call_interaction_number_started` with `_id: -1`.
4. `list_number_activity` runs its three `countDocuments` guards (`analysis/reads.ts:231`) on **every
   page**, not once per run. Compute them once at run preparation and carry the verdict on the run —
   the caps are a property of the subject, not of the page.

---

## 10. Smaller items worth folding into the same pass

**Digit search has no suffix fallback above ten digits.** `parseSearchTerm` (`search.ts:77`) returns
an exact `e164` match for any digit string of length ≥ 10 that normalizes, and never considers the
suffix branch. A pasted number with a wrong or extra country prefix returns zero results even though
its last ten digits are a perfect match. Recommend: for digit input, always `$or` the exact E.164
predicate with the `digits_reversed` prefix predicate. With the compound index from §8 this stays a
single indexed lookup and removes a class of "the number isn't in the system" reports that are really
search misses.

**`assertIndexes()` has no memo.** `transactions.ts:23` issues `collection.indexes()` — a server
command — on every `enqueueCsiJob`, every `claimCsiJob`, and every `persistLeadAttachments`. During
one 250-lead attachment scan page that is 250 `listIndexes` commands. The index set cannot change
inside a process lifetime; memoize per collection per process and keep the assertion's safety value.

**The source scan laps in days, not minutes.** `scanIntelligenceChanges`
(`analysis/scheduling.ts:55`) walks **5** external Contact Numbers per 5-minute cron — 1,440/day
against 4,000+ numbers, so roughly **2.8 days per lap**. Each visit calls
`scheduleNumberIntelligence`, which computes the full `intelligenceSources` fingerprint (~12
collection reads) mostly to discover nothing changed. This is a round-robin poll standing in for a
change feed. Recommend driving it from `EntityChange` / the audit stream — the same cursor pattern
the outreach ensure worker already uses (`outreach/worker.ts:69`) — and keeping the round-robin only
as a slow repair sweep. As-is, a fingerprint change that arrives through a non-publishing path waits
up to three days for synthesis.

**`readAttention`'s snapshot lookup uses a regex.** `snapshot_id: /^outreach:/` (`attention.ts:60`)
cannot use `csi_attention_snapshot_unique`, and the `sort({ as_of: -1 })` has no index. The
collection is TTL-bounded to five minutes so the cost is small today, but the regex is doing no work
the dataset filter isn't already doing — drop it and index `{ deployment: 1, database: 1, as_of: -1 }`.

---

## 11. Recommended sequencing

Three passes. Each is independently shippable and independently verifiable.

### Pass A — stop the bleeding on reads (small, high return)

| Work | Finding |
| --- | --- |
| Memoize `readCaptureCoverage()` per invocation; add the missing counter indexes; replace `$size: 0` | §1 |
| Hoist `resolvePolicy()` out of the per-record loop | §2 |
| Add the number-search compound indexes and the digit-suffix fallback | §8, §10 |
| Single shared constant for `search_terms`, plus a regression test | §6 |
| Memoize `assertIndexes` | §10 |

Acceptance: an Owner number search and a timeline page each issue a bounded, index-served query set;
no collection scan on a read path. Verify with `explain()` on the five read shapes.

### Pass B — make the workers proportional (the real fix)

| Work | Finding |
| --- | --- |
| Reverse the attachment scan onto `normalized_phone_number`; index the two snapshot paths | §3 |
| Batch Attention publish: band-decide on a page, build list rows, exclude dead-closed records | §2 |
| Reconcile watermark + `provider_modified_watermark` pre-filter + clock-based renew | §4 |
| One shared deadline; explicit `maxDuration`; publish on its own cron and lease | §5 |
| Correct job-claim compound index; move the dead-letter sweep off the claim path | §7 |

Acceptance: `outreach_ensure` pending count trends to zero over an hour; `publishAttentionSnapshot`
returns `published` at production volume; the Needs Attention tab reaches `ready` and stays there
across cron ticks.

### Pass C — timing and shape

| Work | Finding |
| --- | --- |
| Persist `contact_number_id` on `lead_conversations`; retire the 2,000-row scan | §9 |
| Hoist `list_number_activity` scope guards to run preparation | §9 |
| Drive `scanIntelligenceChanges` from the change stream; keep round-robin as repair | §10 |
| Job retention TTL / janitor | §7 |
| Coverage counters as a projected document | §1 |

Acceptance: analysis preflight for a busy number completes inside the 80-page ceiling instead of
failing `incomplete_coverage` (13 §5.4); source-change latency drops from days to minutes.

---

## 12. What this analysis deliberately does not decide

- **Whether historical unworked Form Leads belong on Needs Attention.** ATTENTION-PROJECTION is right
  that this is a product filter, not a snapshot bug. Passes A and B make publish *capable*; they do
  not answer what belongs on the desk. That decision should be made with the Owner and recorded
  against the Outreach Service card, not inferred from a performance fix.
- **Any change to the immutable-cursor contract.** GET must keep not building the list. Nothing
  proposed here moves derivation onto the read path.
- **Any loosening of the fail-closed caps** in `intelligenceSources` or `context()`. The caps in
  13 §8 are correctness guards, not performance knobs. §9 reduces *how often* they are evaluated; it
  does not raise them.
- **Retention, redaction, or the phone-handling posture.** Untouched.

---

## 13. Code map

| Concern | Path |
| --- | --- |
| Coverage recount on every read | `src/services/numberActivity/coverage.ts` |
| Number search filter and cursor | `src/services/numberActivity/search.ts` |
| Timeline k-way merge and sources | `src/services/numberActivity/timeline.ts` |
| Call Log window, cursor, gaps | `src/services/numberActivity/reconcileCallLog.ts` |
| Call Log page fetch | `src/services/numberActivity/callLogClient.ts` |
| Per-observation transaction and rollups | `src/services/numberActivity/persistInteraction.ts` |
| Rollup / search-term rebuild | `src/services/numberActivity/rebuild.ts` |
| Lead ↔ Number attachment scan | `src/services/salesIntelligence/attachment/refresh.ts` |
| Attachment evidence and phone fields | `src/services/salesIntelligence/attachment/sources.ts`, `store.ts` |
| Attention publish and read | `src/services/salesIntelligence/outreach/attention.ts` |
| Heavy per-record DTO | `src/services/salesIntelligence/outreach/reads.ts` |
| Ensure drain and repair sweeps | `src/services/salesIntelligence/outreach/worker.ts` |
| Job enqueue / claim / indexes | `src/services/salesIntelligence/jobs.ts`, `src/models/salesIntelligence/infrastructure.ts` |
| Number synthesis scheduling and source scan | `src/services/salesIntelligence/analysis/scheduling.ts` |
| MCP number-activity tool guards | `src/services/salesIntelligence/analysis/reads.ts` |
| Contact Number / Interaction / Conversation indexes | `src/models/ContactNumber.ts`, `CallInteraction.ts`, `LeadConversation.ts` |
| Lead phone indexes | `src/models/FormLead.ts`, `src/models/CallLead.ts`, `src/utils/phone.ts` |
| Cron cadences | `vercel.json` |
