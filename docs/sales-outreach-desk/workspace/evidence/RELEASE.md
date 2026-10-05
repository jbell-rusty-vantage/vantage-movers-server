# RELEASE — Sales Outreach Desk server (FAST-01), 2026-10-05

Operator: local Claude Code session (same machine as the overnight build). Authority: [FAST-TRACK.md](../../FAST-TRACK.md). Every production step below is recorded as it happened; dry runs are marked.

## 1. Pre-flight (read-only, 16:12Z)

Targets: Vercel project `vantage-movers-main-server` (production host `https://vantage-movers-main-server.vercel.app`), database `vantagemovers`, RingCentral account per `RINGCENTRAL_ACCOUNT_ID` (value never printed). Count/index snapshot: see [FOLLOW-UP-2026-10-05.md](FOLLOW-UP-2026-10-05.md) §5 (all `sales_outreach_*` collections absent before this release).

Dry runs before the deploy finished (both read-only):
- `pnpm outreach:indexes --target=vantagemovers` → 33 indexes to create across 9 collections, `exists: 0`, no conflicts, no duplicates.
- `pnpm outreach:install-policy --target=vantagemovers` → `current_state: uninitialized`, revision 0, content hash `b8a42629…`, roster `roster-2026-10-05-ac5e00dcf6` = 12 reviewed `sales_rep` Agents, all controls false, `backfill_lookback_days 90`, `backfill_include_upcoming_moves true`.

## 2. Server deploy

- `feat/outreach-desk@b1056cf6` merged into `main` as `6d1600fe` (no-ff) and pushed 16:39Z. Vercel Production workflow run **37342486847**.
- Workflow **succeeded** 16:50Z (`dpl_FMCKJJSBwSgS545uZan6MUfsekbp`); the deployed server stamped `6d1600fe` at 16:51:00Z. Smoke: `GET /health` 200 `ok`; `GET /api/v1/admin/daily-operations`, `/sales-intelligence/numbers`, `/sales-outreach/capabilities` with the API secret but no signed actor → 403 (the designed refusal; unsigned is never 401).

## 3. Indexes (16:51Z)

`pnpm outreach:indexes --target=vantagemovers --apply` → `production_writer_guard: commit_matches`; all 33 planned indexes created (`sales_outreach_configuration`, `_subjects`, `_policy_periods`, `_followup_schedules`, `_contact_events`, `_projections` incl. the five `sod_projection_q_*`, `_rep_day_projections`, `_enrollment_runs`, `_live_events` TTL, `ringcentral_rep_sms_evidence`); no conflicts, no duplicates.

## 4. RingCentral (read-only so far, 16:51Z)

- **E01 proof passed** (`ops/ringcentral/prove-rep-sms-access.ts`, exit 0): 12 reviewed mailboxes, every one `message_store_ok` + `message_sync_ok` + sync token returned, no failures; outbound SMS seen today on the active mailboxes (e.g. 15/14 and 19/18 sent-or-delivered); subscription body dry-validated with 12 filters.
- **Subscription plan (dry run, `--purpose=all`):** `rep_sms` → `create` (`subscription_missing`, 12 filters, expected). **`calls` → `create` — wrong for the live state.** The owned subscription `882f9c2b…` (created 2026-09-24, Active, expires 2036) carries the filter `/restapi/v1.0/account/62948571023/telephony/sessions` (literal account id, as RingCentral echoes it) while the planner builds `/restapi/v1.0/account/~/telephony/sessions`, so `sameFilterSet` classifies it `owned_other` and plans a new one. The daily maintenance cron has been recording `subscription_missing` for the same reason (`webhook_subscription_maintenance.last_run.error_code`, last 06:15Z today). Applying as-is would create a second telephony subscription → duplicate deliveries. **Not applied.** Fix-forward: normalise `account/<id>/` to `account/~/` when comparing filters, redeploy, then apply (the plan should become `update` with reason `verification_token_missing`, i.e. the token `PUT` the release wants).

## 5. Configuration (16:52Z)

`pnpm outreach:install-policy --target=vantagemovers --apply --enable=desk_enabled,goal_metrics_enabled` → `production_writer_guard: commit_matches`; installed revision **1**, version `sod-config-4c7152ccbcbef957a4a84c97`, content hash `3dd0fe45…`; roster `roster-2026-10-05-ac5e00dcf6` (12 reviewed `sales_rep` Agents, goal 100 on all seven days); controls `desk_enabled: true`, `goal_metrics_enabled: true`, cadence shadow/enforcement and `rep_sms_capture_enabled` false; `backfill_lookback_days 90`, `backfill_include_upcoming_moves true`. **M1 Call progress is live on the server.**

## 6. M1 observation (read-only, 16:55Z, three minutes after the install)

- Jobs created in the previous 20 minutes: `outreach_contact_change` 29 completed, `capture_projection` 261, `call_log_refresh` 23 (+3 pending), `attachment_refresh` 12; no dead letters.
- `sales_outreach_contact_events`: 9,140 rows already (the 90-day bootstrap sweep, reading Mongo only); `outreach_contact_calls` cursor at 16:54:02Z, `known_complete_through` 16:38:02Z (the reconcile's watermark); `outreach_contact_sms` cursor parked at the 2026-07-07 scope start with `known_complete_through` null (SMS not connected, as designed).
- `sales_outreach_rep_day_projections`: rows for the reviewed reps from 2026-09-22 onwards, `count_scope: all_outbound`, e.g. one rep on 2026-09-23 shows 5 confirmed + 107 awaiting confirmation (the bootstrap credits calls `awaiting_confirmation` until the ISync/reconcile confirms them).
- `webhook_subscription_health:*` rows: not present yet at 16:55Z (first `*/5` tick after the deploy pending).

## 7. Enrollment report (read-only, 16:53Z) — apply NOT run

`pnpm outreach:enrollment --target=vantagemovers --out=…` → `kind: expansion`, cohort `expansion:2026-10-05`, configuration revision 1, scope cutoff **2026-07-07** (90 days) + upcoming moves, manifest `85110a60…`, `writes: 0`.

| Partition | Count | Reasons |
| --- | --- | --- |
| **in_scope (would enroll)** | **782** | received window 775, upcoming move 7 |
| review | 2,089 | `unsupported_intake_source` 1,493 (no accepted priority and an ingestion origin outside the P05e intake defaults — the legacy-origin Owner question), `unmapped_priority` 369 (Granot codes "2" and "9" are not in the FINAL-01 map), `priority_needs_review` 227 |
| closed | 2,143 | crm_dead 1,009, official_booking 468, bad_lead 394, crm_bad 256, granot_booked 16 |
| excluded | 276 | duplicate 274, unmatched booking anchor 2 |
| not_new_or_quoted | 51 | priority "3" (Rep discretion) |

The apply (`pnpm outreach:enrollment apply --target=vantagemovers --run-key=backfill-2026-10-05`) also needs `migration.paused: false` first. Left for the user's go (see the session report): it fixes the activation boundary (P10a) and narrows M1's count scope to eligible New/Quoted from that moment.

## 8. Fix-forward deploy and RingCentral apply (17:00–17:15Z)

- `b3d19d09` (filters compared on the `~` account form) merged as `main@21ca7b92`, run **37345049057** succeeded 17:10Z, health 200. The dry run then planned `calls → update (verification_token_missing)` and `rep_sms → create`, as intended.
- `ops/ringcentral/outreach-subscriptions.ts --purpose=all --apply` (guard `commit_matches`): `calls` `882f9c2b…` **updated** (verification token now stored and `PUT`, so a `PUT` can add a token to an existing subscription — the open question from S3 is answered: yes); `rep_sms` **created** `8bcce435-fbff-4184-b9cc-9dd2bf803519` with 12 mailbox filters. No foreign subscription touched.
- Configuration revision **2** (`sod-config-188e99ec5513297fd0db22cd`): `rep_sms_capture_enabled: true` (E01 had passed). Cadence shadow/enforcement and intake admission remain off until the backfill.

## 9. Why the review list is large (read-only investigation, 17:30Z)

- Granot's `lead_created` webhook never carries a priority: all 1,519 `lead_created` observations since 2026-09-05 have `priority.valid: false`; a priority arrives only with a later `priority_updated` / `booking_status_changed`. A Lead whose priority never changed in Granot therefore has `granot_priority: null` and means "New (0)" in Granot. For native-origin Leads the P05e intake default maps that to New (correct). For `granot_lead_created` Leads (office-entered, `best_relocation_leads` / `paid_overflow` source companies) the approved P05e rule says review: 226 recent Leads (`priority_needs_review`), and the engine adapter asserts that rule, so changing it is a code + policy change, not a setting.
- `unsupported_intake_source` (1,436 Form + 398 Call Leads in scope) are all `ingestion_origin: legacy_unknown`: Leads received 2026-07-07 … 2026-08-19, before Granot observation capture (oldest observation 2026-08-12) and before origin labelling (first labelled Lead 2026-08-20). They have no accepted observation, mostly no Job Number (315 Call Leads do), and their current Granot status is unknown to the server. Enrolling them blindly would create ~1,800 New subjects aged 47–90 days, each demanding one call by 20:00 every day (FINAL-01 Day 6+ rule) and an SMS every three days — roughly 150 required calls per rep per day on top of real work. Decision left to the user/Owner (options in the session report); the packet rule keeps them on the review list, where they age out of the 90-day window by 2026-11-17.
- `unmapped_priority` 369: Granot codes "2" (73 Form + 5 Call) and "9" (276 Form + 12 Call) are not in the FINAL-01 map, so per approved P05c they get no cadence ("No policy configured", visible for Owner review). User decision 2026-10-05: leave as is for now.

## 10. Backfill applied (17:28–17:36Z)

- Installer deploy `main@805457bf` (run 37350160209, `--migration-paused`), then `pnpm outreach:install-policy --target=vantagemovers --apply --migration-paused=false` → configuration **revision 3** (`migration.paused: false`).
- `pnpm outreach:enrollment apply --target=vantagemovers --run-key=backfill-2026-10-05` → `status: completed`, selected 784 (the report's 782 plus 2 whose facts changed since), **enrolled 782**, skipped 1 closed (`crm_dead_disposition`) and 1 review (`unmapped_priority`), no pause.
- `verify` → `complete: true, consistent: true`, enrolled_by_run 782, enrolled_elsewhere 0, not_enrolled 2, no mismatches.
- Resulting state: 782 subjects, 783 policy periods (460 Quoted + 321 New opened at the activation boundary, 1 transition), activation = the apply instant (P10a: original age kept, no pre-activation misses).
- `--enable=cadence_shadow_enabled` → **revision 4**. First shadow projections within a minute: Quoted subjects without a selected date show `call.required 0 / scheduled`, `sms not_required`; New subjects (Day 46+) show one call due by 20:00 ET today and SMS `due`/`scheduled`; `exposure: shadow`. Evaluate backlog at 17:36Z: 1,264 pending `outreach_evaluate` jobs draining through the minute cron.

## 11. Controls on (18:14Z) — M2 server side live

- Installer deploy `main@705841a6` (run 37352888219, `--intake-admission-at`), then `pnpm outreach:install-policy --target=vantagemovers --apply --enable=cadence_enforcement_enabled --intake-admission-at=now` → configuration **revision 5**: `desk_enabled`, `goal_metrics_enabled`, `rep_sms_capture_enabled`, `cadence_shadow_enabled`, `cadence_enforcement_enabled` all true; `transition.intake_admission_enabled: true`, `intake_admission_at: 2026-10-05T18:14:15.820Z`; `migration.paused: false`.
- Evaluate backlog at 18:14Z: 1,522 completed, 68 pending, 782 projections (one per subject), 0 dead letters; the earlier ~12/min estimate was the first minutes only. Exposure flips from `shadow` to `enforcement` as each projection is re-evaluated (policy-fingerprint sweep + due instants).
- Today's rep-day rows still report `count_scope: all_outbound` (6 reps, 203 confirmed outbound calls); the scope narrows to `eligible_new_quoted` on the recount that follows the activation day.
- Still off/open: nothing on the server. Admin `/outreach-desk` not built; the review-list policy decisions (legacy_unknown, granot_created without priority) are the user's/Owner's.
