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
