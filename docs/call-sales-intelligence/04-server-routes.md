# 04 — Server routes, DTOs, commands, and MCP authorization

Status: build contract, not implemented. Revised September 17, 2026. [Product](01-specification.md) · [Models](02-domain-models.md) · [Agent contract](10-intelligence-agent-contract.md).

CSI-01 Step 2 implementation note: shared strict schemas and authentication middleware now exist; feature route handlers remain downstream work. See [executable imports and examples](workspace/CONTRACTS.md#csi-01-concrete-imports-server-relative-september-17). The executable `FindingDto` nests the discriminated finding in `assertion`, keeping mutable review/effect projection fields separate from immutable assertions. Earlier DTO sketches below are illustrative; use the exported schema for that representation. G1 foundation contracts are frozen after independent GPT-6 review; downstream feature handlers remain unimplemented.

## 0. Conventions

Owner routes use `src/routes/sales-intelligence-admin.routes.ts`, `createSalesIntelligenceAdminRouter(deps)`, mounted in `src/routes/v1.routes.ts` after `router.use("/api/v1", requireApiSecret)`. Connect → `requireRegistryOwnerActor(req, auth(req))` → strict Zod parse → service → `{ok:true,data}`. Admin/non-Owner gets `403 OWNER_REQUIRED`. Disabled feature returns `404 FEATURE_DISABLED`. Validators live in `src/validation/v1/salesIntelligence.ts` and its existing barrel. Do not echo provider errors, credentials or raw transcript content on failure.

All lists are cursor-paginated (default 50, max 200). All reads include `as_of` and `coverage`. Timestamps use ISO UTC; Owner display uses configured timezone. Full customer numbers are Owner-only; rep-message text uses last four digits. Commands require `Idempotency-Key`; same key/payload replays the stored response, changed payload conflicts. CAS uses `expected_revision` for the primary target and explicit expected revisions for other affected aggregates. A correction spanning action/instruction/review/audit is atomic. Provider calls never occur inside that transaction.

Reuse durable command/idempotency primitives without pretending intelligence commands are canonical Lead commands or inventing an unsupported command origin. Use the dedicated `sales_intelligence_command_executions` ledger specified in 02 §17; freeze its typed actor policy during CSI-01. Queue jobs are service principals; they cannot masquerade as Owner commands. Internal intelligence endpoints in §6 use scoped service auth, not the Owner browser gate or a broadly shared API secret.

## 1. Owner route catalog

All abbreviated paths below are under `/api/v1/admin/sales-intelligence`.

| Method | Path | Contract |
| --- | --- | --- |
| GET | `/overview` | Distinct Attention item counts, reason counts, Needs review counts, coverage and job health. |
| GET | `/attention` | One item per subject at highest-priority band, all reasons/review badges/blockers. |
| GET | `/review-items` | Open/resolved/dismissed review groups, including closed or number-only subjects. |
| POST | `/review-items/:id/resolve` | Audited no-action resolution or link to completed required command; cannot silently lift identity/restriction blockers. |
| GET | `/numbers` | Search digits/name/Job Number/Agent plus classification/attachment/activity filters. |
| GET | `/numbers/:id` | Number, all attachments and connected official record links, all relevant Outreach records, running analysis. |
| GET | `/numbers/:id/timeline` | Merged Number Activity, cursor by event time/kind/id; preserve recorded-at separately. |
| POST | `/numbers/:id/classify` | Owner classification/eligibility with reason/revision. |
| POST | `/numbers/:id/open-review` | Open eligible Number Review; existing closed record requires explicit reopen. |
| POST | `/numbers/:id/rebuild` | Durable rebuild of projections/search; no new business facts. |
| GET | `/attachments` | Filter by number or Lead. |
| POST | `/attachments/attach` | Owner-confirm attachment with evidence/audit. |
| POST | `/attachments/:id/reject` | Reject pair; do not auto-resuggest. |
| POST | `/attachments/:id/detach` | Explicit Owner removal, retained history and identity re-evaluation. |
| GET | `/outreach/:id` | Record, all actions, active restrictions, review items, analyses, Owner instructions, assessments and nudges. |
| GET | `/outreach/by-lead/:model/:id` | Same detail addressed by Lead. |
| POST | `/outreach/:id/commands` | mark_worked, assign, set_waiting, close, reopen, add_note. |
| POST | `/followups` | Add one action; optional due time. Does not replace other actions. |
| PATCH | `/followups/:id` | Owner description/date/action assignment correction; history and override instruction. |
| POST | `/followups/:id/complete` | Complete this action with outcome/evidence; optional next action; absence is allowed. |
| POST | `/followups/:id/snooze` | Explicit temporary Owner deferral with reason; preserve original date. |
| POST | `/followups/:id/cancel` | Cancel one action with reason/provenance. |
| GET | `/conversations/:id/findings` | Findings/current or specified run; source/application/review separate. |
| POST | `/interactions/:id/contact-type` | Owner correction of human_conversation/voicemail/unknown with reason and revision; preserve previous evidence and rederive affected work. Distinct from mark_worked. |
| POST | `/conversations/:id/process` | Enqueue missing media/STT/analysis stage; does not duplicate completed STT. |
| POST | `/conversations/:id/reanalyze` | Original evidence or current context; returns run/job ids. |
| POST | `/numbers/:id/reanalyze` | Refresh current overall analysis with underlying evidence. |
| GET | `/analysis-runs/:id` | Run versions, evidence manifest, exact envelope, effect outcomes and assessments; redacted, Owner-only. |
| GET | `/analysis-runs/:id/evidence` | Cursor-paginated snapshot manifest, default 50/max 200; no transcript bodies in list. |
| GET | `/analysis-runs/:id/evidence/:snapshotId` | Exact authorized version; chunk cursor for large transcript/tool responses, digest and completeness. Purged content returns a tombstone with purge time/reason, never falls back to latest content. |
| POST | `/analysis-runs/:id/confirm` | Confirm all findings in the exact displayed run; no reapplication. |
| POST | `/findings/:id/confirm` | Confirm exact finding revision; no reapplication. |
| POST | `/findings/:id/correct` | Immediate targeted Owner correction plus optional reanalysis. |
| POST | `/findings/:id/retract` | Retract assertion and undo/cancel its still-applicable effects safely. |
| POST | `/analysis-runs/:id/apply-suggestion` | Convert that version's model recommendation into an Owner-origin follow-up. |
| POST | `/restrictions/:id/resolve` | Owner confirms/edits/lifts scoped restriction; optional separate Close command. |
| GET/POST | `/reps` | List links/metrics or create an Owner-authored link. |
| GET | `/reps/:id` | Link/history and activity; unknown mapping gives unknown metrics. |
| POST | `/reps/propose` | Directory×Agent proposal/backfill; never silently reviewed. |
| POST | `/reps/:id/review` | Confirm role/identity/effective dates/channels or retire. |
| POST | `/nudges/preview` | Render/check only, no send. |
| POST | `/nudges` | Explicit Owner send to reviewed rep; idempotent delivery record. |
| GET | `/nudges` | Audited send history by subject/rep. |
| GET | `/coverage` | History/capability/recording/AI/job health plus current settings. |
| GET/PATCH | `/settings` | Read or update versioned Owner policy/settings with CAS/audit. |
| POST | `/backfill` | Plan explicit historical range; defaults off. |
| POST | `/jobs/:id/retry` | Retry failed stage, preserving prior successful stages and effects. |
| GET | `/live` | SSE invalidations, not authoritative business-event transport. |

Existing `/api/v1/admin/conversations/:id`, audio-url, and by-lead reads remain Owner-only; add `/api/v1/admin/conversations/by-number/:id`. Media signed URLs remain short-lived/audited. Do not put private Blob URLs into agent output.

## 2. Shared read contracts

Implement shared server DTOs in `src/services/salesIntelligence/dto.ts`; Admin consumes them without reproducing state/rank rules.

```ts
type ActionAvailabilityDto = {
  action:string; enabled:boolean; blocker_codes:string[];
  target_id:string; expected_revision:number;
}; // include on subjects, follow-ups and findings; recheck on command
type CoverageDto = {
  known_through: string | null;
  gaps: {from:string; to:string; reason:string}[];
  capabilities: Record<string, "ok"|"denied"|"unknown"|"unavailable">;
  ai_paused: boolean;
};
type DerivedDto = {
  overdue:boolean; no_owner:boolean; no_next_action:boolean; cooldown:boolean;
  attention_band:1|2|3|4|5|6|7|null;
  reasons:string[]; review_item_ids:string[]; call_blockers:string[];
  age_wall_ms:number; age_staffed_ms:number; policy_version:string;
};
type AssignmentDto = {
  agent:{id:string; name:string}|null;
  origin:"owner"|"first_conversation"|"rep_promise"|"inherited_outreach"|null;
  assigned_at:string|null; evidence_ref:string|null; owner_instruction_id:string|null;
};
type FollowupDto = {
  id:string; revision:number; kind:string; description:string;
  status:"open"|"completed"|"cancelled"|"superseded";
  due_at:string|null; base_attention_due_at:string|null; attention_due_at:string|null;
  snoozed_until:string|null; wait_expired_at:string|null; date_text:string|null;
  date_resolution:{precision:string; timezone:string; assumption:string|null}|null;
  assignment:AssignmentDto; promised_by:{id:string; name:string}|null;
  origin:string; provenance_refs:string[];
  disposition:string|null; completion_basis:string|null;
  paused_channels:string[]; overdue:boolean;
};
type FindingDto = {
  id:string; run_id:string; revision:number; kind:string; claim:string;
  basis:"said_on_call"|"vantage_record"|"model_inference";
  value:unknown; // serialized from strict per-kind schema, not a permissive input
  evidence:EvidenceRef[]; // 10 §3
  review_state:"unreviewed"|"confirmed"|"corrected"|"retracted";
  effects:{kind:string; status:string; target_id:string|null; reason:string|null}[];
  validation:{schema_ok:boolean; source_snapshots_valid:boolean; locator_status:string; entailment_check:string};
};
```

Outreach DTO includes state/reason, subject, revision, overall assignment, all active follow-ups (paginated detail when large), next-action projection, human-contact timestamps, DerivedDto and related record links. Number detail uses `outreach_records[]`, not one misleading singular row when multiple Leads share a number. Lead chips expose attachment certainty (Exact/Likely/Unsure/Confirmed by you), source, official flags and an existing Admin href. Do not label phone equality as confirmed identity.

Needs review rows include subject key, cause, evidence, opened/updated time, resolution state and allowed Owner actions. Assessment DTO includes instruction id/revision, run id, agrees/disagrees/cannot_determine, reason/evidence; original Owner value and current model view appear together. Timeline events include both happened-at and observed-at; no record of a backfilled old promise masquerades as a new promise today.

## 3. Attention, search, and coverage queries

`GET /attention?band=&needs_review=&state=&agent_id=&source_label=&q=&cursor=&limit=` includes closed subjects only as Needs review entries, both in the default list and when that group is selected; closed subjects never enter the seven actionable bands. Stable pagination binds cursor to as-of/policy/filter snapshot so elapsed deadlines cannot cause duplicate/omitted rows mid-page. Return distinct `total_items` separately from per-reason counts.

`GET /numbers` supports normalized phone and suffix, customer/provider names, Job Number, Agent, activity range, classification and attachment status. Lead/contact details remain Owner-only. Number timeline merges provider calls, Lead Messages, conversation versions, follow-up changes, notes, assignments, restrictions, reviews, and official context. Searches do not mutate attachment.

Coverage includes known-complete-through/gaps, denied/unknown capabilities, stage job counts and oldest age, budget actual/reserved/remaining, recording availability, mapping hygiene, active policy and flags. `$80` is the initial monthly budget; it is not a coverage guarantee.

## 4. Owner command contracts

All commands include expected target revisions and an idempotency key; examples below omit headers.

| Command | Body beyond revisions | Semantics |
| --- | --- | --- |
| mark_worked | optional note | May stand alone; no contact/completion fiction. |
| assign | Agent id or null, optional reason | Overall ownership; never receiver Agent/Booking allocation. Future non-promised actions inherit it; existing explicit action assignments remain. |
| set_waiting | until, reason | Owner-origin wait action; does not delete other follow-ups. |
| close | reason lost/not_sales/owner_dismissed/suppressed, optional note | Cancel remaining actions and close with history. Suppressed reason requires the explicit scoped eligibility command in the same transaction. Cannot claim Booked/Cancelled absent official state. |
| reopen | reason | Recheck current eligibility; do not revive cancelled commitments automatically. |
| add_note | text | Attributed context only. |
| create follow-up | kind, description, due_at nullable, responsible_agent_id optional, date note | Create independently; Owner origin. Set callback date is create or patch of a call follow-up. |
| patch follow-up | explicit changed fields, reason | Per-action Owner override; no accidental bulk replacement. |
| complete follow-up | disposition, note/evidence optional, next optional | Ends only that action. Another step is optional. |
| correct finding | corrected typed value or replacement claim, target effect/action, reason, reanalysis mode optional | Immediate Owner effect and instruction; return updated action and queued run id. |
| retract finding | reason, reanalysis mode optional | Cancel still-active associated promise; preserve later independent Owner work and audit blocked reversals. |
| confirm analysis | expected run output digest | Confirm exact immutable output; newer current version returns conflict requiring refresh. |
| reanalyze | mode original_evidence/current_context, source_run_id when original, Owner correction refs | Async 202 with run id. Missing purged source → 422 ORIGINAL_EVIDENCE_UNAVAILABLE. |
| apply suggestion | suggestion output digest, chosen date/Agent overrides optional | Explicit Owner-origin action. |
| resolve restriction | confirm/edit/lift, channels, until nullable, reason | Audited Owner resolution; cannot erase unrelated active restrictions. |

Legacy `/findings/:id/accept` and `/dismiss` from the September 14 draft are not the new contract. If runtime compatibility is needed, map accept to confirmation-only and dismiss to explicit audited retraction; never keep the old acceptance gate. There is no accepted-finding-only due query.

Settings PATCH accepts staffed weekly hours/timezone, first-action minutes, missed-call minutes, going-cold staffed minutes (default 1440), monthly AI ceiling cents and supported feature toggles. The deployment master kill switch remains authoritative. Reject nonsensical schedules/negative limits. Persist actor/version/effective time; do not retroactively move explicit promises. Return affected default-policy scope and wake budget-paused jobs if funding increased.

## 5. Rep messages and official workflow links

Preview validates reviewed active sales-rep identity and permitted channel, renders masked context, and returns blockers. Send requires an explicit Owner action, same idempotency key across retries, verified rep destination, length/rate limits and recorded body. Team Messaging primary; optional SMS-to-rep/pager only when configured. Unknown delivery is not safe to resend blindly. No model tool can call these endpoints. Preserve existing explicit messaging gates in 03; reviewers can still inspect notes and provenance while dialing is blocked.

Lead/Booking links show every connection and its certainty. Official create/update/reconcile actions navigate to the existing workflow, preserving subject context. Do not add a second official Lead/Booking mutation API to Sales Intelligence. Verify actual destination routes in Admin during implementation; do not invent URL parameters that existing forms ignore.

## 6. MCP internal endpoints and identity

Dedicated prefix `/api/v1/internal/sales-intelligence` stays behind the existing v1 guard. MCP sends a dedicated `x-api-secret` scoped key with an exact internal-route allowlist, plus `x-vantage-intelligence-run-token`. The internal middleware requires BOTH that named scoped-key principal and the signed short-lived run token; global-secret and user-JWT principals are rejected here. A run token alone cannot pass the existing guard. Bind token claims to run id, subject, permitted tools, deployment/database, audience, expiry and nonce; verify against the stored active run. Keys remain in service configuration, never prompts or tool responses. Owner browser credentials do not select the service actor. Main-server issuance/verification is part of CSI-17; the existing broad shared secret cannot substitute for scope enforcement.

| Method/path | Allowed scope |
| --- | --- |
| GET `/runs/:id/context` | Bound run subject and approved evidence view. |
| POST `/runs/:id/read` | Closed tool discriminator for transcript/activity/Lead search/get/Booking search/get/rep identity. Validated typed args, bounded results, captured response snapshot. No arbitrary URL/query. |
| POST `/runs/:id/submit` | Strict envelope from 10; one submission idempotency key bound to run, payload hash fence. |
| GET `/runs/:id/submission` | Resolve uncertain submission delivery. |

Submission returns `202 {run_id, submission_id, application_job_id, status:"submitted"}` or the durable replay result. It never promises effects have applied before the worker finishes. Authoritative effect statuses are visible in the run read. Stale run output may be stored for audit; worker revalidates before any effects. Original-evidence mode replays saved read responses and disallows fresh context expansion within that mode.

## 7. Errors, live reads, and authorization tests

Closed error set includes FEATURE_DISABLED, OWNER_REQUIRED, INVALID_INPUT, REVISION_CONFLICT, IDEMPOTENCY_CONFLICT, ILLEGAL_TRANSITION, IDENTITY_BLOCKED, CONTACT_RESTRICTED, OFFICIAL_STATE_BLOCKS_REOPEN, ORIGINAL_EVIDENCE_UNAVAILABLE, RUN_SCOPE_DENIED, SUBMISSION_CONFLICT, EVIDENCE_SCOPE_INVALID, NUDGE_DESTINATION_IS_CUSTOMER, NUDGE_NOT_ACTIONABLE, RATE_LIMITED, BACKFILL_ACTIVE. Also define UNSUPPORTED_SCOPE and ATTENTION_SNAPSHOT_EXPIRED. Responses include request id and safe explanation; never provider body. Revision conflicts cause an explicit client refetch; do not rely on refreshed payload fields surviving the generic BFF.

Admin changes: Owner-only page prefix, nav and proxy allowlist; SSE BFF streams cookies/session auth without exposing API secrets. Read routes never invoke commands. Tests pin Owner/Admin/service separation, scoped tool denial, revision conflicts, idempotency, undated/multiple actions, immediate correction before AI completion, confirmation without duplicate effects, Needs review on closed subjects, and no mutation by page load.

## 8. Verified Admin integration contract

- All Owner reads/commands accept omitted or `scope=production` only. Reject historical/combined and conflicting body/query scope with UNSUPPORTED_SCOPE. This is a logical current-record scope, independent of physical TEST_MODE isolation. Fixed Current records header on CSI preserves the user's global scope preference for other pages.
- `vantage-admin/server/auth/authorization.ts` needs explicit Owner-only CSI page and API rules for every method: its generic Admin GET default is insufficient. Existing conversation/audio Owner gates remain in force.
- `app/api/proxy/[...path]/route.ts` must forward Idempotency-Key for CSI commands. Its current allowlist only forwards selected Granot commands. Preserve the same key on uncertain retries.
- Normalize BFF `registry_code`/server code to the typed CSI client's `code`; preserve request id. On 409 refetch the affected DTO and show changed values before a new explicit command. Never silently retry a stale Owner edit with a new revision.
- Implement dedicated `app/api/sales-intelligence-live/route.ts` using the existing Daily Operations streaming pattern, signed trusted Owner actor, Last-Event-ID and disconnect cleanup. The generic proxy buffers and cannot serve SSE correctly.
- Official links use existing `components/observational/entity-link.ts` and `related-record-nav.ts`: `/form-leads?record=`, `/call-leads?record=`, `/bookings?record=`, `/cancellations?record=` with production scope. Existing booking prefill accepts FormLead `lead_type/lead_id`, or CallLead `lead_type/call_phone_number/call_job_no`. Reuse operational-actions helpers. Leadless attachment uses the existing Booking panel or `/manual?tab=attach`. Verify destination behavior, not merely generated URLs; global search on CSI is also current-record scoped.
