# Interim Sales Intelligence HTTP contract: Numbers and RingCentral Accounts

Lane S-NUM (SLIM-05), October 3, 2026. This is the server contract the Admin interim `/sales-intelligence` (Numbers + RingCentral Accounts) builds against. Source of truth: `src/routes/sales-intelligence-admin.routes.ts`. The route list is pinned by `src/routes/sales-intelligence-rep-access.test.ts` (`INTERIM_ADMIN_ROUTES`).

## Common rules

- Prefix: `/api/v1/admin/sales-intelligence`. Called through the Admin proxy with the API secret and the signed admin actor headers.
- Roles: **Owner only** (signed Owner actor). The Admin role, scoped keys and signed reps get `403 OWNER_REQUIRED` on every route, with `SALES_INTELLIGENCE_REP_ACCESS` on or off. A rep passes the CSI boundary when `REP_ACCESS` is on and is refused by the route itself; there is no rep scope for Numbers. The Admin proxy already blocks `admin` from these paths, and `/sales-intelligence` is an Owner-only page.
- Flags: `SALES_INTELLIGENCE_ENABLED` off gives `404 FEATURE_DISABLED` before any read. Attachment commands also need `SALES_INTELLIGENCE_ATTACHMENT_REFRESH`; message commands need `SALES_INTELLIGENCE_NUDGE_ENABLED`.
- Scope: omitted or `scope=production` only; anything else is `403 UNSUPPORTED_SCOPE`.
- Query strings are strict: unknown parameters give `400 INVALID_INPUT`.
- Commands require an `Idempotency-Key` header (`400 INVALID_INPUT` without it) and go through the CSI command ledger; a replay returns the stored response.
- Error body: `{ ok: false, code, error, request_id, issues? }`. Codes: `FEATURE_DISABLED` 404, `OWNER_REQUIRED` 403, `UNSUPPORTED_SCOPE` 403, `FORBIDDEN` 403, `INVALID_INPUT` 400, `REVISION_CONFLICT` 409, `IDEMPOTENCY_CONFLICT` 409, `ILLEGAL_TRANSITION` 409, `IDENTITY_BLOCKED` 409, `NUDGE_NOT_ACTIONABLE` 409, `NUDGE_CONFIGURATION_UNAVAILABLE` 409, `NUDGE_DESTINATION_EVIDENCE_INCOMPLETE` 409, `NUDGE_DESTINATION_IS_CUSTOMER` 422, `NUDGE_BODY_INVALID` 422, `RATE_LIMITED` 429. Missing rows answer `404 INVALID_INPUT` ("Number not found", "Rep Identity Link not found").
- Owner reads are wrapped as `{ ok: true, as_of, coverage, data }` (`ownerRead`), unless noted.
- `coverage` (every Owner read): `{ known_through: ISO|null, gaps: [{ from, to, reason }], capabilities: { call_log: "ok"|"unknown"|"unavailable", webhook: "ok"|"unknown"|"unavailable" } }`. **Removed:** `ai_paused`, `recordings{…}`, `capabilities.recording_content` and any other capability key.

## Live stream

| Method | Path | Notes |
|---|---|---|
| GET | `/live` | SSE invalidation stream (`text/event-stream`), Owner only. Frames carry `{ version: 2, reason, topics, refetch }`, never a subject. **Changed:** a rep is refused (403); no rep topic filter is applied. |

## Coverage

| Method | Path | Response `data` |
|---|---|---|
| GET | `/coverage` | `{ as_of, coverage: OwnerCoverage }` (not `ownerRead`-wrapped) |

`OwnerCoverage` = `coverage` fields plus:

- `call_log_capture`: `{ quarantined_count, oldest_quarantined_at, sync_mode: "off"|"shadow"|"on", last_sweep: { ran_at, from, to, complete, provider_records, stored_in_latest_version, applied_changes, missing_before, stale_before, provisional_after_horizon, quarantined, consecutive_drift_runs } | null }`
- `capture_health` (now always present): `{ as_of, status: "ok"|"attention"|"broken", reasons[], known_complete_through, call_log: {…, last_sweep: {…, recovered_calls} | null}, webhook: { state: "healthy"|"degraded"|"down"|"off", subscription_id_suffix, subscription_expires_at, last_receipt_at, receipts_1h, last_renewal_at, last_renewal_error }, in_progress_calls, pending_finalization }`. `last_renewal_error` is the newest daily maintenance outcome (≤ 26 h old): `subscription_missing` or a failure's error class name; it now comes from the `webhook_subscription_maintenance` sync-state row, not OperationalEvents.
- `mapping_hygiene`: `{ unmapped_inbound_numbers, unmapped_directory_users|null, last_directory_sync_at|null, directory_status: "stored"|"missing" }`

**Removed from `/coverage`:** `stages` (recording/transcription/analysis/application), `budget`, `analysis_admission`, `flags`, `models`, `settings`, `backfill`.

## Settings and backfill (unchanged here)

`GET /settings`, `PATCH /settings`, `POST /backfill` keep their pre-slimming shapes in this release; they are not Numbers/Accounts endpoints and their retirement or narrowing belongs to the LLM/Outreach removal wave. The interim Admin should not depend on them.

## Numbers

### `GET /numbers`

Query (all optional): `scope`, `q` (≤ 200; ≥ 10 digits = exact E.164 or suffix, 3–9 digits = suffix, else name/job/agent prefix), `classification` (repeatable or comma list of `unknown|customer|company|non_customer`), `attachment` (`any`*|`linked`|`unlinked`), `active_from`, `active_to` (ISO), `hygiene` (`true` lists only non-external kinds), `has_recording` (`true` = provider reported ≥ 1 recording), `has_calls`, `include_form_only` (G7 tri-states), `cursor`, `limit` (1–200, default 50), `sort` (`last_activity`|`last_call`|`last_human_conversation`|`first_observed`|`first_call`|`interactions`), `direction` (`asc`|`desc`). **Removed:** `has_outreach` (now `400`).

`data`: `{ items: NumberSearchItem[], cursor: string|null, sort: { sort, direction }, filters?: { has_calls } }`. `sort` is always present now.

`NumberSearchItem`:

```
{ id, revision, e164, national_ten|null, kind, classification, eligibility,
  provider_names[], first_observed_at, last_activity_at,
  rollups: NumberRollups, linked, match: { kind: "e164"|"suffix"|"term"|"none" },
  attached_lead: AttachedLead, created_via: "call"|"form_lead", has_calls }
```

`NumberRollups`: `{ interactions_total, inbound_total, outbound_total, human_conversations_total, last_inbound_at, last_outbound_at, last_human_conversation_at, attached_lead_count, candidate_lead_count, recordings_total }` (all present; dates ISO or null).
**Removed rollups:** `open_outreach_count`, `conversations_analyzed_total`, `last_analyzed_at`, `outreach_records_total`.

`AttachedLead` (one batched read per page):

```
{ status: "resolved", lead_ref: { model: "FormLead"|"CallLead", id },
  lead_display: { name, job_no, source_company } | null,      // null when the Lead row is gone
  official: { status: "open_lead"|"booked"|"cancelled"|"bad_lead"|"duplicate"|"no_sync",
              booking_id|null, cancellation_id|null } | null }
| { status: "multiple" } | { status: "none" }
```

`resolved` = exactly one `attached` edge; several attached edges = `multiple`; only candidate/ambiguous/rejected = `none`. `multiple`/`none` carry no Lead field. Official status: Lead flags first (cancelled, booked, duplicate, bad_lead, no_sync), then the Lead's newest exact `booked_leads` row (`lead_model` + `lead_ref`) and its `cancelled_leads` row, else `open_lead`.
**Replaces** `attached_lead_progress` (removed with `lead_progress`, `booking`, `outreach_state`, `lead_status`, `move_assessment`, `outreach_records_total`).

### `GET /numbers/:id`

`data`:

```
{ id, revision, e164, national_ten, kind, classification, eligibility, provider_names[],
  search_terms[], first_observed_at, last_activity_at, created_via, has_calls,
  rollups: NumberRollups, attached_lead: AttachedLead,
  attachments: [{ id, revision, lead_ref, state: "candidate"|"ambiguous"|"attached"|"rejected",
                  certainty: "exact"|"likely"|"unsure"|"owner_confirmed"|"rejected",
                  lead_display: { name, job_no } | null, decided_at|null, decided_by|null, decision_reason|null }],
  restrictions: [{ id, revision, channels: ("call"|"text")[], until|null, origin: "owner"|"intelligence",
                   state: "active"|"expired"|"resolved" }],
  connections: { attachments_total, attached, candidate, ambiguous, rejected, interactions_total_recount },
  allowed_actions: [{ action: "attach_lead"|"rebuild_number", enabled, blocker_codes[], target_id, expected_revision }] }
```

Restrictions are read-only in this interim (no resolve command). `origin: "intelligence"` rows are kept as recorded history.
**Removed:** `outreach_records`, `running_analysis`, `review_items`, `connections.outreach_records_total`, `connections.open_outreach`, `attached_lead_progress`, restriction `run_id`/`finding_id`/`allowed_actions`.

### `GET /numbers/:id/timeline`

Query: `scope`, `cursor`, `limit` (1–200, default 50). Strict: `kinds[]` and other v2 parameters are `400`. Served the same way whatever `SALES_INTELLIGENCE_TIMELINE_V2` says.

`data`: `{ number_id, items: TimelineEvent[], cursor|null }`, order `(happened_at desc, kind asc, id desc)`.

`TimelineEvent`: `{ id, kind: "interaction"|"lead_message", happened_at, observed_at, subject_key, description, evidence_refs[], detail }`.

- `interaction.detail`: `{ direction, provider_result, provider_connected, contact_type, duration_seconds, terminal, call_log_state: "provisional"|"settled"|null, recording_count, recording_ids[], projection_revision, sources[], answered_at, ended_at, company_e164, transfer, queue_fanout, rep, legs[], legs_overflow_count }`.
  - `rep`: `{ status: "reviewed"|"unreviewed"|"excluded_role"|"no_extension", agent_id|null, agent_name|null, extension_id|null, extension_number|null }`, resolved from the Rep Identity Link effective at the call's start for the answering (else first) user party. Only `reviewed` names an Agent.
  - `legs[]`: `{ leg_type, direction, result, start_time, duration_seconds, extension_id }`.
- `lead_message.detail`: `{ status, purpose, origin, dispatch_mode, sent_at, delivered_at, lead_ref }`. No body.

**Removed:** `conversation` events and every Outreach/nudge/owner-note timeline event; the v2 story timeline (`kind_order`, `group`, `chips`, `action`, `call.recording_state`, `call.conversation_id`, `coverage.truncated_sources`).

### `POST /numbers/:id/rebuild`

Body `{ command: "rebuild_number", expected_revision, reason }`. `202 { ok, data: { job_id, dedupe_key, number_id, replayed } }`. The worker recomputes rollups from canonical interactions and attachments only and drops stored retired rollup fields.

## Attachments

| Method | Path | Body / query | Response `data` |
|---|---|---|---|
| GET | `/attachments` | `contact_number_id` or (`lead_model` + `lead_id`), `cursor`, `limit` | `{ items: AttachmentDto[], next_cursor }` (unchanged shape: evidence, lead_snapshot, decision, history, allowed_actions) |
| POST | `/attachments/attach` | `{ command: "attach_lead", contact_number_id, lead_ref, expected_revision, expected_revisions?, reason }` | `{ response: { attachment_id, revision, state, certainty }, replayed }` |
| POST | `/attachments/:id/reject` | `{ command: "reject_attachment", expected_revision, expected_revisions?, reason }` | same |
| POST | `/attachments/:id/detach` | `{ command: "detach_attachment", expected_revision, expected_revisions?, reason }` | same |

Unchanged contract. **Changed behavior:** a command no longer nominates Outreach replay or recording rediscovery; the Number's search terms and attachment counts are updated in the same transaction.

## RingCentral Accounts: Rep Identity

| Method | Path | Notes |
|---|---|---|
| GET | `/reps` | Query `rc_account_id?`, `cursor?`, `directory_cursor?`, `limit`. Response `{ ok, as_of, coverage, data: { items, next_cursor, directory } }` (unchanged). |
| GET | `/reps/:id` | `{ ok, as_of, coverage, data: { link } }` (unchanged). |
| POST | `/reps` | Create a proposed link (unchanged). |
| POST | `/reps/propose` | Directory proposals (unchanged). |
| POST | `/reps/:id/review` | Review/retire. **Changed:** the response no longer carries `reevaluation_job_id` (`data.response` is `{ link }`); no re-evaluation job is queued, since call attribution is resolved at read time. |

## RingCentral Accounts: messages to a directory User (nudges)

| Method | Path | Notes |
|---|---|---|
| GET | `/nudges` | Query `rc_account_id?`, `rc_extension_id?`, `rep_identity_link_id?`, `cursor?`, `limit` (1–100, default 20). `ownerRead({ items: NudgeDto[], next_cursor })`. **Removed:** the `outreach_record_id` filter. |
| POST | `/nudges/preview` | Validates and renders; never sends. `ownerRead({ body, template_key, template_version, purpose, expected_rep_revision, recipient: { rc_account_id, rc_extension_id, directory_name, agent_id, agent_name, rep_identity_link_id, channel }, allowed_channels, destination_evidence: "stored_checked", provider_destination_verified: false, send_time_revalidation_required: true, authorizes_send: false })`. **Removed:** `expected_revision`. |
| POST | `/nudges` | Single-attempt send. `202` while `pending`, else `200`, `{ ok, data: { operation_id, replayed, nudge: NudgeDto } }`. |

Command body (strict):

```
{ scope?, expected_rep_revision?,                // required exactly when rep_identity_link_id is set
  nudge: { rc_account_id, rc_extension_id, rep_identity_link_id?,
           channel: "team_messaging"|"pager", template_key: "review_context", template_version: 1,
           purpose: "review_context", allow_pager_fallback?: boolean, body: string (1..1000) } }
```

**Removed:** `outreach_record_id`, `followup_id`, `expected_revision`, `expected_revisions`, purpose `call_suggestion`, channel `sms_to_rep`; `body` is now required. Messages go only to an internal destination (team-messaging person or pager extension), never a phone number, so never a customer.

`NudgeDto`: `{ id, revision, rc_account_id, rc_extension_id, rep_identity_link_id, agent_id, actor_id, channel: "team_messaging"|"sms_to_rep"|"pager", purpose: "call_suggestion"|"review_context", template_key, template_version, body_as_sent, status: "pending"|"sent"|"failed"|"unknown_delivery"|"fallback_sent", fallback_channel, error_code, created_at, sent_at, delivery_note, automatic_resend: false }`. `sms_to_rep` and `call_suggestion` only appear on rows written before this release. **Removed:** `outreach_record_id`.

Unchanged safety: one provider attempt per authorized send; an attempt that began without a definitive answer becomes `unknown_delivery` and is never retried; `nudge_repair` only reconciles a stored provider receipt.

## Routes removed from this router

Everything else is gone (404): `/attention*`, `/outreach/**` (detail, by-lead, closed-history, commands, timeline, assessment, findings), `/followups/**`, `/restrictions/:id/resolve`, `/review-items*`, `/interactions/:id/contact-type`, `/numbers/:id/open-review`, `/numbers/:id/conversations`, `/numbers/:id/reanalyze`, `/conversations/**`, `/analysis-runs/**`, `/findings/**`, `/assessments/**`, `/roster`, `/overview*`.
