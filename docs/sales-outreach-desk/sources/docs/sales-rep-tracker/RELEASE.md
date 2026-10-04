# Sales rep tracker: release runbook

Slice 7, written 30 September 2026. It covers the order to deploy, build indexes, backfill and switch on the seven tracker flags, with a smoke check and a rollback for each step, and it lists the release gates that are still open.

Sources: [SPECIFICATION.md](SPECIFICATION.md) §11, [IMPLEMENTATION-DESIGN.md](IMPLEMENTATION-DESIGN.md) §8, §12 and §14. Evidence: [acceptance matrix](evidence/ACCEPTANCE.md), [walk](evidence/WALK.md) and [load proof](evidence/PERFORMANCE.md).

**Nothing in this document has run against production.** Every proof so far used the local `csi01` replica, synthetic data and synthetic secrets. The branch is committed locally, not pushed and not deployed. "Proved locally" is not production verification.

## 0. What is being released

| Repo | Branch | Base | State on 30 Sep 2026 |
|---|---|---|---|
| `vantage-main-server` | `feat/sales-rep-tracker` | `bf460e3c` (origin/main) | S1–S6 merged at `4ae5678b`; Slice 7 at `76237954` (integration and load proofs, index extras, the polish fixes); hardening at `d33a8ecd` (shared live change stream, live just-assigned work, Granot refresh joiners and the digit-core estimate read); provider-driven updates at `adbc8b45` (design §14a). Not pushed. |
| `vantage-admin` | `feat/sales-rep-tracker` | `692d8ce` (origin/main) | S1–S6 merged at `20e7501`; Slice 7 at `a4a04e1` (composition and polish); hardening at `dc0607b` (the Just assigned group, tab bars, attempt wording, the Rep route for `/tracker/just-assigned`); provider-driven updates at `05a998b` (the upcoming-moves list default, the `provider` resolution role). Not pushed. |

Checks on the integrated trees, after the hardening:

| Check | Result |
|---|---|
| Server `pnpm typecheck`, `pnpm lint` | pass (re-run on the final tree) |
| Server pinned unit tests, changed areas (final tree) | 64 / 64: `live`, `tracker/justAssigned`, the tracker and case file routes, `contributions/facts`, the index plan, `caseFileView`, `outreach/attention.query`, the rep-access matrix and `foundation` |
| Server pinned unit suite, full | 3,465 tests: 3,331 pass, **1 fail**, 133 skipped, on the combined tree before the last review fixes. The failure (`outreach/numberReads.test.ts` D2, `30 !== 31`) fails the same way on origin/main. |
| Server `pnpm test:granot` | 48 / 48 |
| Server replica suite (`pnpm test:sales-tracker:replica`) | Suffix `final2`, final tree: 84 tests, 83 pass, 1 skipped (the opt-in load proof). 84 / 84 with `SALES_TRACKER_LOAD=true` (suffix `load`, before the last review fixes). |
| Admin `tsc --noEmit` | exit 0 (final tree) |
| Admin `pnpm lint` | 26 problems (18 errors, 8 warnings), the same set as origin/main; none in a changed file |
| Admin `pnpm test` | Final tree: 1,428 tests, 1,244 pass, 0 fail, 184 skipped (the known fixture-gated tests) |

Checks after the provider-driven updates (server `adbc8b45`, admin `05a998b`):

| Check | Result |
|---|---|
| Server pinned unit suite, full | 3,340 pass, **3 fail**, all pre-existing: `numberReads.test.ts` D2 and the OI-C p95 performance check, which is flaky under CPU load |
| Admin `pnpm test`, full | 0 fail |
| Server replica suite (`pnpm test:sales-tracker:replica`) | Green except `new_leads_today`: the run was at 02:13 New York time, inside the G4 window. Not a regression. |
| Browser walk of the new behaviour | **Not run** ([ACCEPTANCE.md](evidence/ACCEPTANCE.md) P1–P5) |

The pinned server unit command also needs `DOTENV_CONFIG_PATH=<a path that does not exist>`. Without it `src/services/crm/crmConfig.ts` (`import "dotenv/config"`) loads the production `.env` into the test process. See the checklist's baseline traps.

Before merging, the server's `AGENTS.md` requires `pnpm finish-work --provider codex` for meaningful server work. It has not been run on the integrated branch.

## 1. Deploy order

### 1.1 Server first, every tracker flag off

1. Confirm none of the seven flags is set in the server environment: `SALES_INTELLIGENCE_TRACKER`, `_INBOX`, `_GOALS`, `_COMPENSATION`, `_CASE_FILE_VIEW`, `_GRANOT_ACQUISITION` and `_ASSIGNMENT_COST`. All seven default off. `GRANOT_JOB_PAGE_ACCOUNT_KEY` and `GRANOT_JOB_PAGE_CURRENCY` stay unset.
2. Deploy the server. With the flags off the change is additive: 19 new collections (created on first write), an optional `tracking` field, two optional policy fields, and new routes that answer 404 `FEATURE_DISABLED`. The recovery steps skip themselves.
3. **These server changes are live without a flag.** Smoke them right after the deploy:
   - A Rep's `GET /outreach/:id` no longer carries `outreach.lead_cost`.
   - A published Attention row no longer stores `outreach.tracking` (the list reads membership live), so a snapshot this build publishes stays readable by the older build after a rollback.
   - Two S7 changes the older admin cannot take are **not** live yet: the Rep Overview cost redaction waits for `ASSIGNMENT_COST` (§2.4) and the live responsibility recheck on a Rep's `GET /attention` waits for `TRACKER` (§2.1). A Rep's `GET /overview` still carries its spend fields and a Rep's list cursor carries no `released` digest.
   - Tracker audit kinds are excluded from the Subject Story (`story/catalog.ts`).
   - **The live stream runs one shared change stream per process** (G3, `live.ts` `csiLiveHub`), not one per SSE connection. It has no flag: the wire format, frames, coalescing, the 240 s renewal and the topic rules are unchanged, and with every tracker flag off it watches the pre-tracker collection set. A source failure restarts it from its resume token and sends each connection a `reconnect` frame (a full resync); after 6 failures in a row every connection is closed and EventSource reconnects. Each failure logs `sales_intelligence.live.source_failed`.
4. Smoke with the flags off:
   - `GET /attention/capabilities` shows `data.features` with all seven `false`, and `capabilities.work_mode: false`.
   - Any area route, for example `GET /overview/tracker`, answers 404 `FEATURE_DISABLED`.
   - The Owner's live stream still connects, and a Rep's still receives only Rep topics. Open the Owner and one Rep in two tabs each: a change reaches every tab, and the logs show no `sales_intelligence.live.source_failed`.
   - The one-minute job-recovery cron still completes. The sales area steps report `disabled`.

### 1.2 Indexes

Run from `vantage-main-server` with the operator's production environment:

```
node --import tsx ops/sales-rep-tracker-indexes.ts --report
node --import tsx ops/sales-rep-tracker-indexes.ts --apply --confirm-production=vantagemovers
node --import tsx ops/sales-rep-tracker-indexes.ts --report
```

- `--report` is read-only. It lists present, missing and conflicting indexes for every `sales_*` collection other than `sales_intelligence_*`, every `granot_job_*` and `granot_case_file_*` collection (including the hardening's `granot_job_heads.granot_head_job_core`, which the Job Page estimate read uses), and six named extras on existing collections:
  - `outreach_records.outreach_tracking` (S2);
  - `outreach_records.outreach_call_in_progress` (S7 load proof: the Owner panel's count of Owner calls);
  - `booked_leads.sales_credit_booked_updated` and `cancelled_leads.sales_credit_cancelled_updated` (S4 credit cursors);
  - `form_leads.sales_lead_timestamp` and `call_leads.sales_lead_timestamp` (S7 load proof: the Lead cost cohort and today's Leads).
- `--apply` creates only the missing indexes. It refuses while a conflict exists, and the production-writer guard must pass. An index with the same key and options under another name counts as present.
- **Build them before any writer flag is on.** The unique fences fail closed with `INDEX_REQUIRED` until they exist.
- The two Lead indexes are built on large collections. Schedule the `--apply` for a quiet hour. `autoIndex` is off in production, so some of the Lead schemas' own indexes (for example `duplicate_1`) may be missing there. Without `sales_lead_timestamp` the cost cohort read could be a real collection scan.
- The tracker's provider-call reconcile reads `call_interactions` through the existing `call_interaction_updated` index. The index script does not manage it. The 29 September storage snapshot lists it in production; confirm with a read-only `db.call_interactions.getIndexes()`.
- The final `--report` must show zero missing and zero conflicts. Keep its output with the release notes.

### 1.3 Admin after the server

- Deploy the admin only after the server it consumes is live. Every area slot renders nothing until `useSalesFeatures()` reports its flag on, so the admin is safe with all flags off.
- An older admin tolerates the newer server: a topic it does not know triggers a full resync, and `features` is optional in its schema.
- **These admin changes are live without a flag:**
  - the Rep frame's own viewer (the inbox button and active-attempt banner use the Rep viewer);
  - a live region per open sheet;
  - `attempt`, `note` and `inbox` frames refetch at once instead of after the 300 ms batch;
  - no Lead spend block on a Rep's Overview (this follows the server redaction);
  - the polish fixes: the phone `tel:` link, the tooltip anchor and contrast fixes, and heading levels;
  - the hardening's tab bars (P3-15): at phone width the desk tabs wrap onto a second row instead of scrolling, and a record's four tabs sit two by two at 480 px and below, with the Analysis "Jump to" bar offset below them. A tab bar that still scrolls fades its edges and keeps a focused tab clear of the fade;
  - the record skeleton uses the same tab layout.
- **Behind flags on the server:** the **Just assigned to you** group appears only when a Rep's list carries `just_assigned` (`TRACKER` on). The Rep route `GET /tracker/just-assigned` is in the admin's Rep allowlist; with `TRACKER` off the server answers it 404. The attempts-versus-goal wording and the quick-start button name show only on tracker and goal surfaces.
- Smoke: the Owner and one Rep load Sales Intelligence. There is no work-mode control, inbox button, day strip or Case File Granot block. axe shows nothing new on the desk and the record page.

### 1.4 Later server merges

After any later server change that declares a new tracker index, re-run `--report`, and then `--apply` if something is missing (design §14.2).

## 2. Flag enable order

Every flag also needs `SALES_INTELLIGENCE_ENABLED`, and every Rep surface needs `SALES_INTELLIGENCE_REP_ACCESS`. The walk also ran with `OVERVIEW`, `LIVE_SSE`, `ATTENTION_V2`, `TIMELINE_V2` and `OUTREACH_ENSURE` on; confirm each is on in production before step 1.

Turn the flags on one at a time, in this order. Wait for each smoke to pass before the next flag.

| # | Flag | Prerequisites | Gate status |
|---|---|---|---|
| 1 | `SALES_INTELLIGENCE_TRACKER` | S1 and S2 indexes, `outreach_call_in_progress`, both `sales_lead_timestamp` | Ready once indexed. Each serving instance now holds one shared change stream however many tabs are live; deployed latency is still G3. |
| 2 | `SALES_INTELLIGENCE_INBOX` | S3 indexes; `TRACKER` on, because the call rules count attempt facts | Ready once indexed |
| 3 | `SALES_INTELLIGENCE_GOALS` | S4 indexes, including both credit cursor extras; the credit backfill dry-run reviewed, then applied (§3.2) | Ready once backfilled. The deal window basis needs the Owner's acknowledgement (G1). |
| 4 | `SALES_INTELLIGENCE_ASSIGNMENT_COST` | `sales_assignment_transfers` indexes and both `sales_lead_timestamp`; the invariant report clean for day, week and month | Ready once indexed. The day strip inherits G4. |
| 5 | `SALES_INTELLIGENCE_CASE_FILE_VIEW` | S5 indexes | Ready. With acquisition off, every record reads `not_retrieved` or `unavailable`. |
| 6 | `SALES_INTELLIGENCE_COMPENSATION` | Owner-confirmed rates and recognition model (G1); `GOALS` on | **Gated** |
| 7 | `SALES_INTELLIGENCE_GRANOT_ACQUISITION` | The spec §8 retrieval proof (G2); `GRANOT_JOB_PAGE_ACCOUNT_KEY` and `GRANOT_JOB_PAGE_CURRENCY` set in the same change; `CASE_FILE_VIEW` on | **Gated** |

### 2.1 `TRACKER`

- **Turns on:**
  - the tracker routes;
  - the `work_mode` filter (`capabilities.work_mode`);
  - the recovery steps `tracker_attempt_stale`, `tracker_attempt_match` and `tracker_activity_reconcile`;
  - the kernel's `sales_progress_evaluate`;
  - writes of the `attempt_stale_minutes`, `attempt_match_tolerance_seconds`, `inbound_call_min_seconds` and `attempt_auto_finish_minutes` policy fields (the last two: provider-driven updates, design §14a);
  - the per-call `sales_call_reconcile` jobs capture enqueues on every hang-up and settle, their drain (`tracker_call_reconcile`) and the auto-finish sweep (`tracker_attempt_auto_finish`); with the flag off capture enqueues none and the drains skip themselves;
  - the `record_closed` event to a Rep whose My Tracker record closed (`tracker_record_closure`, from the `outreach_closed` audit stream, closures of the last 24 h);
  - a Rep's live responsibility recheck on `GET /attention` (`tracker/trackedSet.ts` `releasedSubjectKeys`, two indexed reads on the entries the snapshot gives the Rep): a record reassigned away from the Rep drops at once instead of at the next publish, and a change between pages answers `ATTENTION_SNAPSHOT_EXPIRED`, which only the new admin restarts on;
  - the reverse, live (G5, `tracker/justAssigned.ts`): a Rep's first `/attention` page carries `data.just_assigned`, the records assigned to the Rep since the snapshot (at most 20 rows; the rest counted in `more`), and `GET /tracker/just-assigned` reads it alone. The admin shows them as **Just assigned to you** above the list; they join the snapshot rows at the next publish. The Owner's lists, `total_items`, tallies and cursors are unchanged.
- **Smoke:**
  - Capabilities: `features.tracker` and `capabilities.work_mode` are true.
  - The Owner's `GET /overview/tracker` answers rows for the active roster.
  - At the next real reassignment to a Rep who has My Outreach open, the record shows under **Just assigned to you** within about a second, once, and joins the list at the next publish. Do not reassign a record only to test this.
  - One Rep tracks one of its own records, sees it once in My Tracker, and presses Undo. The record `revision` does not move, and the timeline shows the change.
  - Do not start a test attempt in production. A finished attempt is a real contribution fact that counts toward goals and instructions. Watch a Rep's first real attempt instead: the Owner's row shows "Rep reports reaching out".
  - The provider-fact cursor advances (§3.3).
- **Rollback:** set the flag off.
  - The routes answer 404, the workers stop and the admin slots hide.
  - Data is kept. An attempt left `in_progress` is swept to `needs_resolution` when the flag returns.
  - The just-assigned overlay stops: a record newly assigned to a Rep again waits for the next publish.
  - While `GOALS` or `INBOX` stays on, attempt-based goals and instructions stop moving.
  - Before a **server code** rollback, see §5.2 on the stored policy fields.

### 2.2 `INBOX`

- **Turns on:** threads, instructions, notifications and mark-read; the sweep `inbox_instruction_sweep`; the overlay's `instructions` field and the rep rows' instruction counts.
- **Smoke:**
  - The Owner's and a Rep's `GET /notifications` answer 200 with an honest unread count.
  - Agree with one Rep on a real free-form instruction ("Reply here when you see this"). The Rep completes it with a note. The Owner gets one unread `instruction_fulfilled`.
- **Rollback:** set the flag off.
  - The routes answer 404 and the sweep stops. Rows are kept.
  - An instruction whose window ends while the flag is off expires on the first sweep after it returns. Evidence inside the window still wins.
  - `assignment` notifications from the transfer projector (`ASSIGNMENT_COST`) are still written, and appear when `INBOX` returns.

### 2.3 `GOALS`

- **Before:** run the credit backfill (§3.2).
- **Turns on:**
  - goals and earnings reads;
  - the recovery steps `goals_credit_projector` (incremental cursors plus the nightly 400-day reconcile) and `goals_window_sweep`;
  - the goal progress hook;
  - the Owner rows' `goals`.
- **Smoke:**
  - `GET /earnings` answers `status: not_activated` with the credit totals. Compare `booked_binder_credit_minor` for one Rep and one recent week against the Bookings' allocations, using the Booking **creation** day (G1).
  - A Rep creates and cancels one personal goal.
  - The credit projector cursors reach the present.
- **Rollback:** set the flag off.
  - The routes answer 404, the projector and the sweep stop, and the ledger is kept.
  - On return, the cursors resume from their stored positions and the nightly reconcile catches up. Goals whose windows ended meanwhile are closed as met or missed.

### 2.4 `ASSIGNMENT_COST`

- **Turns on:**
  - the four Owner routes `/overview/assignment-cost`, `/leads`, `/overview/assignment-transfers` and `/overview/day`;
  - the `economics_transfer_projector` recovery step;
  - the `new_leads_today` and Owner-only `cost` rep-row fields (the economics count replaces the tracker's `trigger_at` count, so the count and the cost cover the same Leads);
  - the Rep Overview cost redaction: a Rep's `GET /overview` omits `spend`, `by_source`, `cost_per_booking` and the spend medians, and carries `cost: "owner_only"` (design §15.3, decided in S6). The Owner's responses are unchanged. The older admin requires those fields, which is why this waits for the flag;
  - the card overlay's `opportunity`;
  - live watching of `form_leads`, `call_leads` and `sales_assignment_transfers` (the Owner-only `cost` topic).
- **Smoke:**
  - `GET /overview/assignment-cost?period=today`, `this_week` and `this_month` each answer `reconciliation.ok: true`, and the company total equals the receiver report's total for the same period to the cent.
  - `transfers.projected_through` advances toward now (§3.4).
  - The day strip's Leads today equals `/daily` for today. See G4 before 04:00 New York time.
- **Rollback:** set the flag off.
  - The routes answer 404, the projector stops and the cost collections are no longer watched. The transfer rows are kept.
  - To rebuild the transfers from scratch, delete the `sales_intelligence_sync_state` row with scope `sales-tracker:economics_transfer_projector` while the flag is off, then turn the flag on.

### 2.5 `CASE_FILE_VIEW`

- **Turns on:** `GET /outreach/:id/case-file` and its history and refresh reads, and the card's `granot` field.
- **Smoke:**
  - An Owner read and a Rep read of an in-scope record answer `availability: not_retrieved` (or `unavailable` while no account key is set).
  - The `refresh` action is blocked with `GRANOT_ACQUISITION_UNAVAILABLE`.
  - A Rep read of a record outside its scope is 404.
- **Rollback:** set the flag off. The reads answer 404. Nothing is written by reads.

### 2.6 `COMPENSATION` (gated: G1)

- **Turns on:** policy activation (`activate {confirm_rates: true}`) and the earnings projector (inline and `goals_earnings_projector`).
- **Procedure:**
  1. The Owner creates a draft with the confirmed rates.
  2. Turn the flag on.
  3. The Owner activates the draft with `effective_from` of today or later. Backdating is refused.
- **Smoke:**
  - `GET /compensation-policies` shows `activation: activated`.
  - `GET /earnings` for a covered Rep reads `status: active`, and `earned_commission_minor` matches a hand calculation for one Booking.
  - Bookings created before `effective_from` earn nothing.
- **Rollback:** set the flag off. Earnings read `not_activated`, the projector stops and activation is refused. Entries are kept and never repriced. The walk rehearsed this on and off locally (s9b / s9d).

### 2.7 `GRANOT_ACQUISITION` (gated: G2)

- **Turns on:** `POST /outreach/:id/case-file/refresh` and the `granot_case_file_refresh` worker. The worker shares the `granot:automation:account` lease with the report collector. A request from another Outreach bound to the same job joins the active refresh and is recorded in its `joiners`; at verified publication each joined record's responsible Agent gets its own `granot_refresh:<refreshId>:<outreachId>` fact, so that Rep's `refresh_granot` instruction is fulfilled too.
- **Procedure:** set `GRANOT_JOB_PAGE_ACCOUNT_KEY` and `GRANOT_JOB_PAGE_CURRENCY=USD` in the same change as the flag. With either missing, a refresh answers 409 `SETUP_REQUIRED`.
- **Smoke:**
  - The Owner runs one `known_job` refresh on an authorized job. It moves through `queued → … → succeeded` or `partial`.
  - The sections read `complete_for_page` where expected, and the identity is verified.
  - Logs show no `GranotNavigationDenied` for an allowed path, and no request other than the login and `QSEARCH` actions.
- **Rollback:** set the flag off. The refresh answers 503 and the worker stops (the S5 replica proves both). Evidence is kept. Unset the two settings.

## 3. Backfills

| What | Action | Notes |
|---|---|---|
| Tracking | **None** | An absent `tracking` is outreach mode. |
| Attempts, instructions, read receipts, earnings | **Never** | Nothing from before activation is invented. |
| Deal credit | `ops/backfill-sales-credit.ts`: dry run, review, then apply | Before `GOALS` (§3.2) |
| Assignment transfers | Automatic: the projector starts at the beginning of the audit stream | Bounded batches (§3.4) |
| Provider-call facts | Automatic: the cursor starts at `now − 35 days` | Bounded batches (§3.3) |

### 3.1 Tracking

No backfill. A record with no `tracking` is in outreach mode, and the index covers only records that have one.

### 3.2 Credit (before `GOALS`)

```
node --import tsx ops/backfill-sales-credit.ts --since=YYYY-MM-DD [--limit=N]
node --import tsx ops/backfill-sales-credit.ts --since=YYYY-MM-DD --apply --confirm-production=vantagemovers
```

- **The dry run** (the default) only reads. It reports the planned recognized, reversed and adjusted steps, and the net credited share per Agent in minor units.
  - Review it against a known month of Bookings, split Bookings included.
  - Look for malformed allocations, which the projector logs as `credit_projection_failed` and skips.
- **`--apply`** runs the projector on each Booking. It is idempotent: a rerun appends nothing.
- **Earnings.** It prices nothing unless `COMPENSATION` is on and an activated policy covers the Booking's creation day.
- **Choosing `--since`.** The nightly reconcile covers Bookings created in the last 400 days anyway. Use a `--since` that covers the earliest goal window the Owner cares about, so the first day's numbers are complete instead of waiting for the reconcile.

### 3.3 Provider-call facts (automatic with `TRACKER`)

- **Where.** `tracker_activity_reconcile` keeps its cursor in `SalesIntelligenceSyncState`, scope `sales_activity_reconcile`, with `cursor.entity_change_applied_at` and `entity_change_id`.
- **Start.** The first run starts at `now − 35 days`, over `call_interactions` `(updatedAt, _id)`, plus a 10-minute overlap pass. A second cursor, `sales_activity_reconcile:links`, reprocesses calls when a Rep identity link changes.
- **Pace.** Each run is bounded (20 s, 200 items), once a minute. Each written fact enqueues a coalesced `sales_progress_evaluate` for its Agent.
- **Check.** Read the scope row and watch `entity_change_applied_at` approach now. Until it does, `provider_verified` counts in goals and the day strip are low.
- **Rebuild.** Delete that row while `TRACKER` is off. Facts are idempotent by `call:<id>`.

### 3.4 Assignment transfers (automatic with `ASSIGNMENT_COST`)

- **Where.** `economics_transfer_projector` follows `csi_audit_stream` `(recorded_at, _id)` from its cursor in `sales_intelligence_sync_state`, scope `sales-tracker:economics_transfer_projector`. The same row is its lease.
- **Pace.** The first run starts at the beginning of the stream. Each run writes at most 200 transfers, reads audit pages of 500, and stops after 20 s.
- **Notifications.** A backfilled transfer older than 24 h writes no `assignment` notification.
- **Check.** `transfers.projected_through` on the cost view approaches now. The tail of the last 10 minutes is always re-read (settle window).

## 4. Verification after all ready flags are on

These are the first production observations, not proofs. Record each one with time and result.

1. **Latency (spec §10, G3).**
   - With two real sessions (the Owner and one Rep), time 10 Reaching-out clicks until the Owner's row reads "Rep reports reaching out". Target: p95 ≤ 2 s.
   - Time one reassignment until the cost view changes. Target: ≤ 5 s.
   - Time one real reassignment until the record shows in the new Rep's **Just assigned to you** group (G5). Target: p95 ≤ 2 s.
   - Local results: 0.86 s p95 (polish walk) and 1.36 s p95 on the shared stream (hardening re-walk; nine of ten trials 0.84–0.87 s); cost 1.95 s; just assigned 1.02 s p95.
2. **Capacity (G3).** From the logs, count the concurrent SSE connections per serving instance at the busiest hour. Each instance should hold **one** change stream whatever the connection count; read latency on an instance with many connections should match one with few (locally, 8 live pages left the API's reads at p95 10 ms). Look for `sales_intelligence.live.source_failed`: an occasional restart is expected, repeated ones are not.
3. **Reconciliation.** Assignment cost `reconciliation.ok` for today, this week and this month. No `sales_intelligence.assignment_cost.reconciliation_failed` log.
4. **Recovery health.** Every sales area recovery step completes inside its 20 s budget. `sales_progress_evaluate` has no backlog older than one pass.
5. **Scope.** One Rep tries another Rep's record id, attempt id, instruction id and goal id by URL. Each answers 404 or 403 exactly like a missing record.
6. **Day strip.** Leads today, texts and Bookings equal `/daily` for the same day. After 04:00 New York time, also check the day's first Leads (G4).
7. **Provider-driven updates (design §14a).** Use the first real calls of the day, or one call the Owner and a Rep agree on. Any call from a Rep's extension is real work and counts toward goals, so do not place a call only to test this.
   - **Per-call job.** Within a minute of the hang-up, `sales_intelligence_jobs` holds a `sales_call_reconcile` row with `subject_key: interaction:<id>` and `status: completed`. A second one completes after the Call Log settles (about 90 s later). A row left `pending` or `retry` for more than a minute, or any `dead_letter`, is a finding.
   - **Recovery steps.** The response of `/api/cron/sales-intelligence-job-recovery` lists `tracker_call_reconcile` and `tracker_attempt_auto_finish` as completed, each inside its 20 s budget.
   - **Timeline and goals.** For a call with no Rep report, the record's timeline shows "Call placed · counted · <outcome>" (or "Inbound call answered · counted · <outcome>" for an answered inbound call of 30 s or more), and the Rep's call goal moves by exactly one. For a Reaching out the Rep left open, the attempt reads "Attempt ended from the phone record · <outcome>" about 3 minutes after the call ended, and the goal still moves by one, not two. A call whose outcome is `unknown` leaves the attempt open.
   - **Lists.** The Owner's All Outreach and a Rep's My Outreach open with the Move date "today onward" chip, earliest Move date first. Removing the chip shows every record, including those with no Move date. An Overview count link still opens exactly the records it counted.

## 5. Rollback

### 5.1 Per flag

Turning a flag off takes effect at once: routes answer 404 (the refresh route answers 503), workers stop and slots hide. New collections, snapshots, ledgers, audit rows and indexes are kept. §2 lists the side effects of each flag. Turn flags off in the reverse of the enable order, when more than one must go.

### 5.2 Per deploy

1. Turn every tracker flag off.
2. Roll back the admin. An older admin does not render any tracker surface and tolerates the new topics.
3. **Before rolling back the server code, check the stored CSI policy.**
   - The older build's strict `csiPolicySchema` rejects a stored policy that contains `attempt_stale_minutes`, `attempt_match_tolerance_seconds`, `inbound_call_min_seconds` or `attempt_auto_finish_minutes`, and then every policy read fails.
   - The fields can be stored only while `TRACKER` was on (`assertTrackerPolicyWritable`).
   - If either is present, save the settings without them first. This works with the flag off.
4. Roll back the server.
   - The optional `tracking` field is ignored by older builds, which never write it.
   - Published Attention rows never store `tracking`, so the older build reads the last snapshot the new build published.
   - The unflagged server changes (§1.1 step 3) revert with the code: Reps would see `lead_cost` again, and each SSE connection would hold its own change stream again, so an instance with 5 or more live tabs would slow every read by about 0.75 s. The Overview redaction and the live list recheck already stopped at step 1 with their flags.
5. Keep the indexes. Dropping them gains nothing, and rebuilding them is slow.

**Rehearsal status.** Locally rehearsed: `COMPENSATION` on → off (walk s9b / s9d), and `GRANOT_ACQUISITION` off answering 503 with the worker stopped (the S5 replica). Not rehearsed: turning every flag off in sequence, the admin rollback, the server code rollback, and the policy-field check above.

## 6. Outstanding release gates

| # | Gate | Blocks | Owner of the next step |
|---|---|---|---|
| G1 | **Compensation rates and recognition model.** The Owner must supply the percentage and/or fixed amount, confirm recognition at official Booking **creation** (not `book_date`, which existing sales reports use), and confirm that there is no backdating before activation. | `COMPENSATION` | Owner |
| G2 | **Granot retrieval proof** (spec §8). Live retrieval is proven for one job (P5565230, [GRANOT-TEST-EVIDENCE.md](GRANOT-TEST-EVIDENCE.md)). Still needed: second-job isolation in one session, reopening the first job in another session, account and Record Link verification, and fixtures for more templates and sections. **The two code items are fixed** (server `d33a8ecd`, case file replica): a refresh joined from another Outreach now records its joiners and credits each joined record's responsible Agent at verified publication only, so the joining Rep's `refresh_granot` instruction is fulfilled; and Job Page estimates read heads with one indexed `$in` on `job_digit_core` (`granot_head_job_core`) instead of one regex per open Job, with the same answers. Build `granot_head_job_core` with the index script before this flag (§1.2). | `GRANOT_ACQUISITION` | Operator with authorized jobs |
| G3 | **Deployed stream latency at load.** End to end (command commit → change stream → SSE frame → admin refetch) was measured only locally: p95 0.86 s (polish walk) and 1.36 s on the shared stream (hardening re-walk, one slow trial of ten); cost 1.95 s. **The capacity defect is fixed** (server `d33a8ecd`): each process runs one shared change stream fanned out to every SSE connection (`live.ts` `csiLiveHub`), instead of one per connection, which starved the pool of 5 from the 5th stream on (reads about 750 ms). Replica: 8 subscribers hold 1 server cursor and a read issued meanwhile stays at p95 2–4 ms. Browser re-walk with 8 live pages: 1 cursor, the API's reads p95 10 ms, one write reached all 8 pages in 144–194 ms. **Still unmeasured:** latency and per-instance capacity on Vercel and Atlas with the flags on (§4 items 1 and 2). | The 2 s claim on deployed infrastructure | Operator, after deploy |
| G4 | **Daily Operations early-morning Lead day.** Live Lead facts pass `lead.timestamp` (New York wall-clock time stored as UTC) as an instant (`dailyOperations/recordDomainFacts.ts:190`, `recordDailyOperationsFact.ts:248`), so Leads created 00:00–03:59 New York time land on the previous day. The day strip's Leads today reuses that source and inherits the bug. Not exercised by the walk: all seeded Leads were after 04:00. Fix it in Daily Operations separately, or accept it and say so in the tile's help. | Spec §12 scenario 17 for Leads today | Owner decision; Daily Operations |
| G5 | **Resolved locally** (server `d33a8ecd`, admin `dc0607b`; `TRACKER` on). Newly assigned work used to reach the new Rep's list only at the next Attention publish (140 s measured). A Rep's list now carries it live as **Just assigned to you** (§2.1). Replica: the Rep's next list read carries the record 44–52 ms after the assign commits. Browser re-walk, 10 reassignments with the Rep's list open: p50 0.94 s, p95 1.02 s, each record on the page once, focus never moved, nothing moved under the pointer, and no duplicate after the next publish. The re-walk found and fixed a missing admin Rep allowlist entry for `/tracker/just-assigned` (403). The later review fixes (a bottom "waiting" pill, touch holding arrivals until **Show**, one announcement per assignment) are covered by admin tests, not re-walked. Deployed timing is part of G3. | — | Done locally; deployed check in §4 |
| G6 | **Rollback rehearsal of the full sequence** (§5.2), including the stored policy-field check. | Release sign-off | Operator, on the replica |
| G7 | **Push, CI and `finish-work`.** Slice 7 and the hardening are committed on `feat/sales-rep-tracker` in both repos (server `76237954`, `d33a8ecd`; admin `a4a04e1`, `dc0607b`) and not pushed. Run the server's `pnpm finish-work --provider codex` and CI on the pull requests. One pre-existing unit failure remains (`numberReads.test.ts` D2, also on origin/main). `requestTelemetry.test.ts` had its child timeout raised to 180 s because the larger suite pushed it past 60 s. | Merge | Commit stage |
| G8 | **Production verification of every acceptance scenario.** Each one is proved locally at best ([ACCEPTANCE.md](evidence/ACCEPTANCE.md)). Scenario 4 in particular depends on real RingCentral identity data. | "Shipped" claims | Operator, after flags |
| G9 | **Provider-driven defaults** (design §14a). The Owner confirms, or saves other values for, `inbound_call_min_seconds` (default 30 s of talk time before an answered inbound call counts) and `attempt_auto_finish_minutes` (default 3 minutes before a matched call ends an open Reaching out), and the Outreach list default (upcoming moves, earliest first, records with no Move date outside the default view). The defaults apply while the policy fields are absent, so nothing technical is blocked. See `SALES-REP-TRACKER-OWNER-DECISIONS.md` (workspace root). | Telling Reps that calls count on their own; the first week of use | Owner |

**Residual defects that do not block a flag:**

- Fixed by the hardening (admin `dc0607b`, checked in the re-walk at 390 px): the attempts-versus-goal wording ("Rep-reported attempts"; a goal "can be lower or higher"), the distinct quick-start button name ("Reaching out to … (quick start)"), and P3-15 (desk tabs wrap, record tabs sit two by two, no bar scrolls).
- The "Updated list" notice that appears after a publish pushes the list down (66 px measured) even while the reader is in it. It predates G5 (UI-1).
- The just-assigned `more` count is taken before the list's filters (filtering past the 20-row bound would need more row builds). The admin copy says those assignments haven't been checked against this list yet.
- The browser p95 at 8 live pages on one `next dev` (430 ms, against 72 ms with none) came from the dev server and 8 dev-mode pages in one browser; the API's own times stayed at p95 10 ms. Not a product defect, but a production build was not measured.
- `claimCsiJob` lists the jobs collection's indexes on every claim: one extra round trip per job on Atlas.
- Design §15.4: deal credit and deal goals use Booking `createdAt`, while existing sales reports use `book_date`. The two will differ near period edges. This is part of G1.
