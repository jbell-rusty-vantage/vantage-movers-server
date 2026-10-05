# Overnight summary — Sales Outreach Desk server build (local run, 2026-10-04 → 05)

**Bottom line:** all three server lanes (S1, S2, S3) are built, merged into `feat/outreach-desk` and pushed to origin. Every merge passed typecheck, full lint and the full unit suite, with one known environmental failure (below). Nothing was pushed to `main`, deployed or run against production.

Still owed:
- **Replica proofs:** the csi01 replica was down all night.
- **One Daily Operations behaviour change to review before release:** see "Review before release" §1.
- **A handful of Owner questions.**

Branch: `origin/feat/outreach-desk`, last code merge **`e0f1733e`**; the commit carrying this summary is on top (started at `c4209ad2` = `main`).

Detail lives in:
- per-lane evidence: [S1.md](S1.md), [S2.md](S2.md), [S3.md](S3.md);
- the run log at the bottom of [LEDGER.md](../LEDGER.md);
- the Service doc `docs/knowledge/services/sales-outreach-desk.md`.

## 1. What merged

| Order | Lane / phase | Work packages | Lane head → merge commit |
| --- | --- | --- | --- |
| 1 | S1 models (early, for S3) | SRV-3 models: 8 `sales_outreach_*` collections, index build script | `3603fde1` → `f5934d25` |
| 2 | S1 phase 1 | SRV-1 `manager` signed role, `requireOutreachActor`, Manager on Daily Operations reads; SRV-2 configuration GET/PATCH (versioned pointer CAS, fail closed), FINAL-01 install script | `0b0de567` → `3c4c8030` |
| 3 | S2 | SRV-4 pure cadence engine (`src/services/salesOutreach/engine/`), 264 tests from fixtures p01–p10a + END-TO-END-RUN §3 + DST | `fac2535c` → `c8e380d3` |
| 4 | S1 phase 2 (**M1**) | SRV-8 M1 reads `GET /capabilities`, `/rep-days`, `/team` (goal parts), Zod DTOs + examples | `7dc60851` → `6cdd0486` |
| 5 | S3 M1 piece (**M1**) | SRV-5 minute Call Log ISync lane (staffed hours), narrowed `call_log_refresh`, desk wake seam, job stages | `8374bc2b` → `8a517c91` |
| 6 | S1 phase 3 | Rest of SRV-3: `leadInstant` restored, P05h eligibility, P05d/P05e priority periods, `entity_changes` tail + revision reconcile, intake gate, enrollment report/apply/verify + CLI | `7b446e99` → `c77276da` |
| 7 | S3 phase A | Rest of SRV-5: Light lane, `calls`/`rep_sms` subscriptions with verification tokens, rep SMS capture, E01 proof script | `4ae42042` → `3de145df` |
| 8 | S1 phase 4a | `outreach_evaluate` consumer + evaluate cron; SRV-7 commands (Quoted date, callback, assignment, day override, restrictions) | `cf482cd2` → `e1ac8c18` |
| 9 | S3 phase B (**M1** core) | SRV-6 contact events from calls/SMS, `outreach_contact_change` consumer + sweep, `outreach_rep_day` projection | `febdef43` → `1a2d808f` |
| 10 | S1 phase 4b | Rest of SRV-8 (`GET /queue`, `/outreach/:id`, team cadence cards, `GET /live`), SRV-9 Daily Operations §14 repairs, SRV-T regression | `7e605464` → `e0f1733e` |

**M1 Call progress, server side, is complete on the branch:**
- `manager` role;
- configuration and the FINAL-01 installer;
- minute ISync confirmation;
- contact events and rep-day projections from `call_interactions`;
- the `capabilities` / `rep-days` / `team` reads.

**M2 server pieces are also built:** subjects, enrollment, engine wiring, queue/detail, commands, SMS capture, restrictions and live stream.

Merge conflicts I resolved by keeping both sides:
- the Service doc (each lane's section kept);
- the retained job-stage list;
- `jobDispatch.ts` and its consumer test (all desk handlers kept).

## 2. Test results (exact commands)

Every gate ran on the merged `feat/outreach-desk` in the main checkout. They ran serially through a machine-wide lock, with `--test-concurrency=2`.

```text
pnpm typecheck
pnpm lint
node --import tsx --import ./ops/test-setup.ts --test --test-concurrency=2 "src/**/*.test.ts" "api/queues/**/*.test.ts" "ops/lib/*.test.ts"
```

| Gate (after merge) | typecheck | lint | tests | pass | fail | skipped |
| --- | --- | --- | --- | --- | --- | --- |
| Baseline `c4209ad2` (before any lane) | green | — | 2599 | 2460 | 1 | 138 |
| S1 phase 1 | green | lane-verified | 2632 | 2493 | 1 | 138 |
| S2 | green | lane-verified | 2896 | 2757 | 1 | 138 |
| S1 phase 2 | green | green | 2918 | 2779 | 1 | 138 |
| S3 M1 piece | green | green | 2939 | 2800 | 1 | 138 |
| S1 phase 3 | green | green | 3044 | 2905 | 1 | 138 |
| S3 phase A | green | green | 3091 | 2952 | 1 | 138 |
| S1 phase 4a | green | green | 3128 | 2989 | 1 | 138 |
| S3 phase B | green | green | 3207 | 3068 | 1 | 138 |
| **S1 phase 4b (final)** | green | green | **3242** | **3103** | 1 | 138 |

**The one failure is pre-existing and environmental:** `src/services/salesIntelligence/attachment/wiring.test.ts` ("Owner attachment routes and cron recovery…"). It times out buffering `sales_intelligence_jobs.find()` because no Mongo is running. It fails identically on the untouched baseline.

Lane-level targeted runs are recorded in each evidence file (for example, S2 engine 264/264). They also cover touched-directory suites.

`node docs/sales-outreach-desk/validate.mjs`:
- **passes** in the main checkout;
- **fails** in every fresh worktree (see §3).

**Not run (replica owed):** `pnpm test:outreach:replica`, which now runs 6 proofs:
- `configuration.replica.ts`
- `subjects.replica.ts`
- the commands/evaluator proof
- `reads.replica.ts`
- `contact-events.replica.ts`
- `rep-sms-capture.replica.ts`

Also owed: the rate-gate replica block, the existing `test:*:replica` runners, and the SRV-0 `/db` check.

## 3. Blocked or owed, and why

| Item | Why | What unblocks it |
| --- | --- | --- |
| All replica runs (list above) | Docker container `csi01` (127.0.0.1:27189) was `Exited (255)` at start. Per instructions, Docker was not restarted and the container was not started. | Start `csi01` (or a native `mongod` replica on 27189), then run `pnpm test:outreach:replica` and the existing `test:*:replica` runners on `feat/outreach-desk`. |
| `validate.mjs` fails on clean checkouts | `PACKET-MANIFEST.json` hashed this Windows checkout's CRLF working files, but the committed blobs are LF. Every fresh LF checkout (cloud, CI, worktree) reports 15 "Hash differs: sources/…" lines. This is a packet defect from `c4209ad2`, not from this sprint's code. | Regenerate the manifest from committed LF bytes, or pin `eol` for the packet in `.gitattributes`. Then copy the packet to admin per the runbook. I did not edit the packet unattended. |
| Enrollment backfill | It is gated by `migration.paused` (default `true`, per CONTRACTS): `apply` returns 503 `migration_paused`. | RELEASE PATCHes `migration.paused: false` before the FAST-01 backfill. |
| SMS cadence | The E01 proof must run against production: `ops/ringcentral/prove-rep-sms-access.ts` (read-only). | Run E01 first. Then run `ops/ringcentral/outreach-subscriptions.ts --apply` and turn on `rep_sms_capture_enabled`. |
| RingCentral: token on the existing `calls` subscription | The docs do not say whether a PUT can add `verificationToken` to an existing subscription. | Try it during RELEASE. If PUT cannot, the fallback is repairing (re-creating) the `calls` subscription, which now generates a token. |
| Quality checkpoints paused | A turn-end run failed on `git stash pop`. The worker uses the stash stack shared by every worktree and runs a typecheck, which was unsafe with two lane agents on this memory-limited machine. Nothing was applied. | `pnpm quality:resume` in `vantage-main-server`, `-s1` and `-s3`. |

### Review before release

1. **Daily Operations hour/day shift (SRV-9, `2b249dcf`).** The §14 repair puts live and rebuild on one time rule: the New York day/hour of `leadInstant(lead)`. The lane reports that the live board was reading ordinary Form/Call Leads' wall-clock `timestamp` as UTC. As a result:
   - hourly buckets were 4–5 h early;
   - Leads from 00:00–03:59 ET landed on the previous day.

   **Live Daily Operations numbers will move after deploy.** The lane believes they move towards correct, but this is an existing-feature behaviour change that nobody has checked against production. Spot-check one day's board against known Leads before or right after the server deploy. If it is wrong, revert `2b249dcf` alone; the desk does not depend on it.
2. **Projection index names changed** (`sod_projection_queue_*` → `sod_projection_q_*`). They had never been built anywhere. RELEASE builds them with `pnpm outreach:indexes`.
3. **New collection** `sales_outreach_live_events` (TTL one day). `GET /live` uses a change stream, which needs a replica set; production Atlas has one.

### Owner questions (recorded, not invented)

- **Manual unassign vs Granot.** After an Owner/Manager *unassigns* a Lead (`receiver_agent` → null), the next Granot update can refill it, because `receiverReplaceableByGranot` treats an empty receiver as fillable. A non-empty manual assignment is protected. Not changed.
- **Legacy-origin Leads with no accepted priority** (`legacy_import` / `legacy_unknown`). There is no approved intake default, so they go to the review list and are never enrolled.
- **Telemetry migration limits** (oplog / replication-lag) are null and not enforced. They need an answer before very large enrollment cohorts.
- **Two engineering choices to confirm:**
  - "ambiguous identity" means another non-duplicate Lead shares the Job Number;
  - "unreliable received time" means after the reference instant or before 2010.
- **Provider outcome mappings** are engineering choices, not proven: which Call Log results count as "no actual attempt", and how voicemail counts.
- **Late number attachment.** An attachment created after a call does not re-derive that call. M1 counts are unaffected. M2 subject credit for such a call waits until the call row changes. A `number_lead_attachments` sweep would fix it.
- **Daily Operations texts.** Failed texts by failure time, and texts split by purpose, are not named by §14 and were left unchanged.

## 4. DTO handoff for the admin team (A1/A2)

The authoritative table is in [S1.md → "Admin DTO handoff"](S1.md#admin-dto-handoff-consolidated-all-s1-endpoints). Zod schemas live in the server:
- `src/validation/v1/salesOutreachReads.ts` (capabilities, rep-days, team, queue, outreach detail, live frames);
- `src/validation/v1/salesOutreachCommands.ts`;
- `src/validation/v1/salesOutreachEnrollment.ts`;
- `src/validation/v1/salesOutreach.ts` (configuration value).

Example payloads (generated from the real services and kept in sync by a test) are in [`dto-examples/`](dto-examples/) and `dto-examples/commands/`. Regenerate them with `node --import tsx ops/sales-outreach/write-dto-examples.ts`.

**Transport.**
- Base: `/api/v1/admin/sales-outreach`, with `x-api-secret` plus a signed actor:
  - Owner: standard payload;
  - **Manager:** a seven-line payload, role `manager`, no Agent header;
  - Rep: role `rep` plus `x-vantage-admin-agent-id` with a reviewed `sales_rep` link, otherwise 403 `REP_NOT_LINKED`.
- Generic `admin` → 403. Unsigned → 403 (not 401), so the BFF does not read a refusal as an expired session.
- Envelope `{ok, data}`; errors `{ok:false, code, error, request_id, issues?}`.
- Every write needs an `Idempotency-Key`.

**BFF allowlist (exact method + path):**
- **Rep:**
  - `GET capabilities`, `GET rep-days` (self only), `GET queue` (own assignment), `GET outreach/:id`, `GET live`;
  - `PATCH outreach/:id/quoted-followup`, `PATCH outreach/:id/callback`.
- **Manager:**
  - the Rep set;
  - `GET team`, `PATCH outreach/:id/assignment`, `PATCH goals/:agent_id/day-override` (prospective only);
  - Daily Operations `GET /`, `/live`, `/events`.
- **Owner:** everything, including:
  - `GET/PATCH configuration`;
  - restrictions list/add/confirm/lift;
  - enrollment candidates/report/apply/verify.

**M1 surface (goal cards + Daily call goals) needs only:** `GET capabilities`, `GET rep-days`, `GET team`.
- The label is **"Outbound calls"** (`count_scope: all_outbound`).
- "Other outbound" (`unattributed`) is shown separately.
- After the first enrollment apply, a day counts `eligible_new_quoted`. Say which scope applies on screen.

**Rendering rules:**
- A `null` count is **pending**, never 0.
- `not_available_in_m1`, `cadence_shadow` and `cadence_disabled` mean "unavailable".
- 108/100 shows a capped bar and 0 remaining.
- Zero-goal reps say "No goal today" and are excluded from the team denominator.
- Never compute overdue or ordering in the browser.

**Revisions and errors:**
- Send `plan.plan_revision` as `expected_revision` for Quoted/callback, and `assignment.assignment_revision` for assignment.
- On 409 `CURSOR_EXPIRED`, drop the cursor and reload page one.
- On 403/404, clear the selected Lead and its cached rows.

**Desk gating:**
- With `desk_enabled` false, reads return 503 `CONFIGURATION_UNAVAILABLE`, but `GET capabilities` always answers 200, so the Owner keeps the settings path.
- With both cadence controls off, the queue returns 503 `PROJECTION_PENDING` (`cadence_disabled`), while `outreach/:id` still answers 200 with `projection_state`.

**Live stream** — one EventSource per mounted desk through the new BFF route `app/api/outreach-desk-live/route.ts` (ADM-7). Topics:
- `outreach_desk` (subject ids + Agents);
- `outreach_goal` (Agent + business day);
- `outreach_configuration` (revision).

A full scoped refetch happens on `connect`/`reconnect`, on `clock` frames (every 30 s) and on `refetch: "all"`. The stream closes itself after about 240 s; reconnect, and treat 503/403 as "desk unavailable".

**Daily Operations:** show `metrics.texts.unreconstructable_sent_day` as a label when it is above 0.

## 5. RELEASE checklist additions (from the lanes)

- **Scripts** (named target, dry run by default):
  - `pnpm outreach:indexes --target=<db> [--apply]`
  - `pnpm outreach:install-policy --target=<db> [--apply] [--enable=desk_enabled,goal_metrics_enabled]` — the roster is filled from reviewed `sales_rep` links at install time; re-run it, or edit as Owner, when a rep is newly reviewed.
  - `pnpm outreach:enrollment --target=<db> [report|apply|verify]`
  - `ops/ringcentral/prove-rep-sms-access.ts`
  - `ops/ringcentral/outreach-subscriptions.ts`
- **New crons** in `vercel.json`:
  - `/api/cron/sales-intelligence-call-log-isync` (every minute, NY 07:45–20:30 gate in the handler);
  - `/api/cron/sales-intelligence-rep-sms-poll`;
  - `/api/cron/sales-outreach-lead-changes` (every minute);
  - `/api/cron/sales-outreach-revision-reconcile` (every 5 minutes);
  - `/api/cron/sales-outreach-evaluate` (every minute);
  - `/api/cron/sales-outreach-contact-events` (every minute).
- **New job stages:** `outreach_contact_change`, `rep_sms_sync`, `outreach_lead_change`, `outreach_evaluate`, `outreach_rep_day`.
- **No new env names.** The queue cursor HMAC key derives from the existing `VANTAGE_ADMIN_PROXY_SIGNING_SECRET`.
- **First contact-event sweep:** with `backfill_lookback_days = 90` it bootstraps about 90k calls, which takes several minutes of passes. Watch the Heavy gate: the sweep reads Mongo only, but the minute ISync shares the Heavy budget.

## 6. Machine and checkout state

- Worktrees `../vantage-main-server-s1`, `-s2` and `-s3` are kept on their lane branches. Each has a real `node_modules`, not a junction, so `git worktree remove` is safe; there is no junction to `rmdir`.
- The lane branches are local only. Everything they contain is already merged into `feat/outreach-desk`.
- Quality checkpoints are paused in all three server checkouts that ran tonight (main, `-s1`, `-s3`).
- No processes were killed, Docker was not touched, and no `.env` was read or copied into a worktree.
