# 04 — Server routes, DTOs, validators, and Admin proxy authorization

Status: implementation-ready. Pack index: [`README.md`](README.md). Pipeline: [`03-server-pipeline-and-jobs.md`](03-server-pipeline-and-jobs.md).

## 0. Conventions

- Router file: `src/routes/sales-intelligence-admin.routes.ts`, `createSalesIntelligenceAdminRouter(deps)`, mounted from `src/app.ts` **after** the `/api/v1` guard, next to `daily-operations-admin.routes.ts`.
- Every route: `await connect()` → `requireRegistryOwnerActor(req, auth(req))` (Owner-only; Admin gets `403 OWNER_REQUIRED`) → Zod parse → service → `{ ok: true, data }`. Unhandled → `500 { ok:false, error:"Internal error", request_id }` (never `error.message`).
- Feature off (`SALES_INTELLIGENCE_ENABLED=false`) → `404 { ok:false, code:"FEATURE_DISABLED" }` on every route.
- Validators in `src/validation/v1/salesIntelligence.ts`, exported through the `v1.validation.ts` barrel.
- Every read DTO carries `as_of` (ISO) and `coverage` (§6). Every list is cursor-paginated: `?cursor=&limit=` (default 50, max 200), response `{ items, next_cursor }`.
- Commands: `Idempotency-Key` header required; body carries `expected_revision` where the target has one; stale → `409 { ok:false, code:"REVISION_CONFLICT", data: <refreshed record> }`. Commands are Mongo transactions that also append the Outreach event and an `EntityChange`-style audit row where the domain command executor already exists (reuse `domainCommands` idempotency helpers; do not register these as canonical Lead commands).
- Phones in DTOs: full E.164 for the Owner (the Owner calls these customers; the Admin proxy is Owner-only for these paths). Rep DIDs full. Bodies of nudges masked to last 4 by construction.
- Timestamps ISO UTC; the Admin formats in America/New_York.

## 1. Route catalog

| Method | Path | Purpose | Kind |
| --- | --- | --- | --- |
| GET | `/api/v1/admin/sales-intelligence/overview` | Header counters, coverage, capability, queue health | read |
| GET | `/api/v1/admin/sales-intelligence/attention` | Ranked actionable rows (default view) | read |
| GET | `/api/v1/admin/sales-intelligence/numbers` | Search Contact Numbers | read |
| GET | `/api/v1/admin/sales-intelligence/numbers/:contactNumberId` | Number header + attachments + outreach + rollups | read |
| GET | `/api/v1/admin/sales-intelligence/numbers/:contactNumberId/timeline` | Number Activity entries (cursor) | read |
| POST | `/api/v1/admin/sales-intelligence/numbers/:contactNumberId/classify` | Classification + eligibility | command |
| POST | `/api/v1/admin/sales-intelligence/numbers/:contactNumberId/open-review` | Create Number Review Outreach Record | command |
| POST | `/api/v1/admin/sales-intelligence/numbers/:contactNumberId/rebuild` | Recompute rollups/search terms | command |
| GET | `/api/v1/admin/sales-intelligence/attachments?contact_number_id=&lead_model=&lead_id=` | Edges for a number or a Lead | read |
| POST | `/api/v1/admin/sales-intelligence/attachments/attach` | Owner attach | command |
| POST | `/api/v1/admin/sales-intelligence/attachments/:attachmentId/reject` | Owner reject | command |
| GET | `/api/v1/admin/sales-intelligence/outreach/:outreachRecordId` | Record + derived + followups + pending findings | read |
| GET | `/api/v1/admin/sales-intelligence/outreach/by-lead/:model/:id` | Same, addressed by Lead | read |
| POST | `/api/v1/admin/sales-intelligence/outreach/:outreachRecordId/commands` | One endpoint, `command` discriminator | command |
| POST | `/api/v1/admin/sales-intelligence/followups` | Create Follow-up | command |
| POST | `/api/v1/admin/sales-intelligence/followups/:followupId/complete` | Complete with disposition | command |
| POST | `/api/v1/admin/sales-intelligence/followups/:followupId/snooze` | Snooze | command |
| GET | `/api/v1/admin/sales-intelligence/conversations/:leadConversationId/findings` | Findings for a conversation | read |
| POST | `/api/v1/admin/sales-intelligence/findings/:findingId/accept` | Accept with bounded effect | command |
| POST | `/api/v1/admin/sales-intelligence/findings/:findingId/dismiss` | Dismiss | command |
| POST | `/api/v1/admin/sales-intelligence/conversations/:leadConversationId/process` | Owner forces media/STT/extract on a `discovered`/`unavailable` row | command |
| GET | `/api/v1/admin/sales-intelligence/reps` | Rep Identity Links + proposals + activity rollups | read |
| GET | `/api/v1/admin/sales-intelligence/reps/:linkId` | One link + 30-day activity | read |
| POST | `/api/v1/admin/sales-intelligence/reps/propose` | Recompute proposals from the latest directory snapshot | command |
| POST | `/api/v1/admin/sales-intelligence/reps/:linkId/review` | Mark reviewed / set role_kind / channels / retire | command |
| POST | `/api/v1/admin/sales-intelligence/reps` | Owner creates a link manually (agent_id + rc_extension_id) | command |
| POST | `/api/v1/admin/sales-intelligence/nudges/preview` | Preconditions + rendered body, no send | read (POST body) |
| POST | `/api/v1/admin/sales-intelligence/nudges` | Send Owner Rep Nudge | command |
| GET | `/api/v1/admin/sales-intelligence/nudges?outreach_record_id=` | Nudge history | read |
| GET | `/api/v1/admin/sales-intelligence/coverage` | Coverage Watermark, gaps, capabilities, hygiene, AI budget, queues | read |
| POST | `/api/v1/admin/sales-intelligence/backfill` | Plan backfill windows | command |
| GET | `/api/v1/admin/sales-intelligence/live` | SSE | read |
| GET | `/api/v1/admin/conversations/:id` (existing) | Now includes `contact_type`, `sales_relevance`, `transcript_segments`, `intelligence`, `findings_pending_count` | read (additive) |
| GET | `/api/v1/admin/conversations/by-number/:contactNumberId` (new, existing router) | Conversations on a number, list DTO (no transcript text) | read |

Crons (before the v1 guard, `sales-intelligence-cron.routes.ts`): listed in 03 §11; `ALL` method like the other cron routers.

## 2. Shared DTOs (`src/services/salesIntelligence/dto.ts`)

```ts
export type CoverageDto = {
  known_through: string | null;                 // Coverage Watermark ISO
  gaps: { from: string; to: string; reason: string }[];
  capabilities: Record<"call_log"|"recording_content"|"presence"|"team_messaging"|"sms"|"pager"|"ringsense", "ok"|"denied"|"unknown"|"unavailable">;
  ai_paused: boolean;
};

export type CertaintyDto = "exact" | "likely" | "unsure" | "owner_confirmed";

export type LeadChipDto = {
  attachment_id: string;
  lead_ref: { model: "FormLead"|"CallLead"; id: string };
  state: "candidate"|"ambiguous"|"attached"|"rejected";
  certainty: CertaintyDto;
  name: string | null; job_no: string | null; source_label: string | null;
  lead_at: string | null;
  booked: boolean; cancelled: boolean; duplicate: boolean; bad_lead: boolean;
  received_by: string | null;                   // receiver_agent_name_snapshot (provenance, not ownership)
  admin_href: string;                           // "/form-leads?record=…" or "/call-leads?record=…"
};

export type ContactNumberDto = {
  id: string; e164: string; display: string;    // "(757) 318-0143"
  kind: string; classification: string; classification_reason: string | null;
  eligibility: { state: string; reason: string | null; until: string | null };
  provider_names: string[];
  first_observed_at: string; last_activity_at: string;
  rollups: { interactions_total: number; inbound_total: number; outbound_total: number; human_conversations_total: number;
             last_inbound_at: string|null; last_outbound_at: string|null; last_meaningful_contact_at: string|null };
  leads: LeadChipDto[];
  outreach: OutreachSummaryDto | null;          // the open/most recent record on this number
  running_summary: { text: string; computed_at: string } | null;
};

export type DerivedDto = {
  overdue: boolean; no_owner: boolean; no_next_action: boolean; cooldown: boolean;
  age_wall_ms: number; age_staffed_ms: number;
  attention_band: 1|2|3|4|5|6|7|null; attention_rank: number | null;
  reasons: string[];                            // closed set; Admin maps to copy
  policy_version: string;
};

export type OutreachSummaryDto = {
  id: string; revision: number;
  subject: { kind: "lead"|"number_review"; lead_ref?: { model: string; id: string }; contact_number_id?: string };
  state: "unworked"|"open"|"waiting_on_customer"|"identity_review"|"closed";
  closed_reason: string | null;
  trigger_kind: string; trigger_at: string; first_action_due_at: string | null;
  first_attributable_outbound_at: string | null;
  next_action: { kind: string; due_at: string; note: string|null; followup_id: string|null } | null;
  wait_until: string | null;
  responsible_agent: { id: string; name: string } | null;
  last_meaningful_contact_at: string | null;
  derived: DerivedDto;
  pending_findings_count: number;
};

export type AttentionRowDto = OutreachSummaryDto & {
  contact_number: Pick<ContactNumberDto, "id"|"e164"|"display"|"classification"|"eligibility">;
  lead: LeadChipDto | null;                     // the subject Lead chip when kind = lead
  last_interaction: NumberActivityEntryDto | null;
  nudge_eligible: boolean; nudge_blockers: string[];   // closed set: "no_reviewed_rep_link","not_actionable","suppressed","rate_limited","feature_off"
};

export type NumberActivityEntryDto =
  | { kind: "interaction"; id: string; at: string; direction: "Inbound"|"Outbound"|"Internal"|"Unknown";
      provider_connected: boolean; contact_type: "unknown"|"voicemail"|"human_conversation";
      duration_seconds: number|null; provider_result: string|null;
      company_number: string|null; users: { extension_id: string; name: string|null; rep_link_id: string|null }[];
      queue_fanout: boolean; transfer: boolean;
      recording: { lead_conversation_id: string|null; state: string|null } | null;
      lead_hint: LeadChipDto | null; }
  | { kind: "lead_message"; id: string; at: string; status: string; purpose: string; body_masked: string; lead_ref: { model: string; id: string } }
  | { kind: "conversation"; id: string; at: string; state: string; contact_type: string; has_transcript: boolean; findings_pending: number; findings_accepted: number }
  | { kind: "outreach_event"; id: string; at: string; event_kind: string; from_state: string|null; to_state: string|null; actor: string; note: string|null }
  | { kind: "followup"; id: string; at: string; status: string; action_kind: string; due_at: string; disposition: string|null; note: string|null }
  | { kind: "nudge"; id: string; at: string; channel: string; status: string; agent_name: string; body_preview: string }
  | { kind: "lead_arrival"; id: string; at: string; lead: LeadChipDto }
  | { kind: "booking"|"cancellation"; id: string; at: string; job_no: string|null; lead_ref: { model: string; id: string } | null };

export type FindingDto = {
  id: string; lead_conversation_id: string; kind: string; claim: string;
  actor: string|null; action_status: string|null;
  resolved: { due_at: string|null; due_at_unresolved_text: string|null; amount_cents: number|null; amount_meaning: string|null } | null;
  citations: { sid: number; text: string }[];
  validation: { schema_ok: boolean; citations_exist: boolean; entailment_check: string };
  review_state: string; reviewed_by: string|null; reviewed_at: string|null;
  applied_effect: string|null;
  extraction_version: string; created_at: string;
};

export type RepLinkDto = {
  id: string; status: "proposed"|"reviewed"|"retired"; role_kind: string;
  agent: { id: string; name: string; active: boolean } | null;
  rc: { extension_id: string; extension_number: string|null; name: string|null; direct_numbers: string[]; sms_sender_number: string|null; has_direct_chat: boolean|null };
  extension_user: { id: string; email: string } | null;
  granot_username: string | null;
  nudge_channels_allowed: string[];
  proposal_basis: string | null;
  effective_from: string; effective_to: string | null;
  activity_30d: { outbound_attempts: number; unique_numbers: number; provider_connected: number; human_conversations: number|null; attributable_first_actions: number; nudges_received: number } | null;  // null when link not reviewed
};

export type NudgeDto = {
  id: string; status: string; channel: string; fallback_channel: string|null;
  agent: { id: string; name: string }; outreach_record_id: string; contact_number_id: string;
  body_as_sent: string; sent_at: string|null; error_code: string|null; created_at: string; actor_label: string;
};
```

## 3. Reads — examples

### 3.1 `GET /overview`

```json
{ "ok": true, "data": {
  "as_of": "2026-09-14T18:02:11.000Z",
  "coverage": { "known_through": "2026-09-14T17:47:00.000Z", "gaps": [], "capabilities": { "call_log":"ok","recording_content":"denied","presence":"ok","team_messaging":"ok","sms":"ok","pager":"unknown","ringsense":"unavailable" }, "ai_paused": false },
  "counts": {
    "attention_total": 41,
    "by_band": { "1": 2, "2": 16, "3": 9, "4": 6, "5": 3, "6": 4, "7": 1 },
    "unworked": 25, "overdue": 22, "identity_review": 7, "no_owner": 19,
    "numbers_observed_7d": 1336, "numbers_without_lead_7d": 382,
    "interactions_today": 412, "human_conversations_today": 58,
    "pending_findings": 12
  },
  "policy": { "version": "csi-policy-v1", "first_action_due_staffed_minutes": 30, "staffed_hours": "Mon-Sat 08:00-20:00 America/New_York" }
}}
```

### 3.2 `GET /attention?band=&state=&agent_id=&source_label=&q=&cursor=&limit=`

Query schema:

```ts
z.object({
  band: z.coerce.number().int().min(1).max(7).optional(),
  state: z.enum(["unworked","open","waiting_on_customer","identity_review"]).optional(),
  overdue: z.enum(["true","false"]).optional(),
  no_owner: z.enum(["true","false"]).optional(),
  agent_id: z.string().optional(),
  source_label: z.string().optional(),
  kind: z.enum(["lead","number_review"]).optional(),
  q: z.string().trim().max(80).optional(),      // digits → number suffix; text → name / job no
  cursor: z.string().optional(),
  limit: z.coerce.number().int().min(1).max(200).default(50),
})
```

Response `{ items: AttentionRowDto[], next_cursor, as_of, coverage }`. Sorted by `attention_rank`, then oldest. Identity Review rows are excluded unless `state=identity_review` (they live in their own rail).

Example row:

```json
{
  "id": "66e5…", "revision": 4,
  "subject": { "kind": "lead", "lead_ref": { "model": "FormLead", "id": "66e4…" } },
  "state": "unworked", "closed_reason": null,
  "trigger_kind": "lead_arrival", "trigger_at": "2026-09-14T13:05:00.000Z",
  "first_action_due_at": "2026-09-14T13:35:00.000Z", "first_attributable_outbound_at": null,
  "next_action": null, "wait_until": null, "responsible_agent": null,
  "last_meaningful_contact_at": null,
  "derived": { "overdue": true, "no_owner": true, "no_next_action": false, "cooldown": false,
               "age_wall_ms": 17820000, "age_staffed_ms": 17820000, "attention_band": 2, "attention_rank": 20017820,
               "reasons": ["first_action_overdue","no_owner"], "policy_version": "csi-policy-v1" },
  "pending_findings_count": 0,
  "contact_number": { "id": "66e3…", "e164": "+17573180143", "display": "(757) 318-0143", "classification": "customer", "eligibility": { "state": "allowed", "reason": null, "until": null } },
  "lead": { "attachment_id": "66e6…", "lead_ref": { "model": "FormLead", "id": "66e4…" }, "state": "candidate", "certainty": "likely",
            "name": "Patricia T.", "job_no": null, "source_label": "Top10 Forms", "lead_at": "2026-09-14T13:05:00.000Z",
            "booked": false, "cancelled": false, "duplicate": false, "bad_lead": false, "received_by": null, "admin_href": "/form-leads?record=66e4…" },
  "last_interaction": null,
  "nudge_eligible": true, "nudge_blockers": []
}
```

### 3.3 `GET /numbers?q=&classification=&has_lead=&activity_from=&activity_to=&sort=`

`q` handling (`numberActivity/search.ts`): strip non-digits; if ≥ 4 digits → match `digits_reversed` prefix of the reversed query (suffix search) OR `e164` prefix; if text → `search_terms` token prefix (names, job numbers, provider names). Non-`external` kinds hidden unless `include_company=true`. Sort `last_activity_at desc` default. Response `{ items: ContactNumberDto[] (without running_summary), next_cursor, as_of, coverage }`.

### 3.4 `GET /numbers/:id` and `/timeline?before=&limit=&kinds=`

Detail returns `ContactNumberDto` in full. Timeline merges the sources in 04 §2 `NumberActivityEntryDto` (interactions from `call_interactions`; Lead Messages by `to` E.164 across attached/candidate Leads; conversations by `contact_number_id`; outreach events and followups from every Outreach Record whose `primary_contact_number_id` or subject number is this number; nudges; Lead arrivals, Bookings, Cancellations from attached/candidate Leads). Newest first, cursor `before=<iso>|<kind>|<id>`.

### 3.5 `GET /outreach/:id`

`{ record: OutreachSummaryDto, contact_number: ContactNumberDto, followups: FollowupDto[], pending_findings: FindingDto[], accepted_findings: FindingDto[], nudges: NudgeDto[], conversations: ConversationListItem[] (existing DTO + contact_type), as_of, coverage }`.

### 3.6 `GET /reps`

`{ links: RepLinkDto[], unlinked_user_extensions: { extension_id, extension_number, name, direct_numbers }[], unlinked_active_agents: { id, name }[], directory_taken_at, as_of }`.

### 3.7 `GET /coverage`

The `coverage.ts` projection from 03 §13 plus `sync_state` summaries per stream (`last_run`, `consecutive_failures`) and backfill window counts.

## 4. Commands — schemas and examples

### 4.1 `POST /numbers/:id/classify`

```ts
z.object({
  classification: z.enum(["unknown","customer","company","non_customer"]).optional(),
  eligibility: z.object({ state: z.enum(["allowed","temporarily_blocked","suppressed","unknown"]), reason: z.string().trim().min(1).max(200), until: z.string().datetime().optional() }).optional(),
  reason: z.string().trim().min(1).max(200),
}).refine(b => b.classification || b.eligibility)
```

Effects: fields on the Contact Number; when `suppressed` → every open Outreach Record on the number closes `suppressed` (event, actor label). Response: `ContactNumberDto`.

### 4.2 `POST /numbers/:id/open-review`

Body `{ note?: string }`. Creates `OutreachRecord{ subject: number_review, state: unworked, trigger_kind: owner_open }` or `409 REVIEW_EXISTS`. Rejected when the number is `company` or `suppressed` (`422 NUMBER_NOT_REVIEWABLE`).

### 4.3 `POST /attachments/attach` and `/attachments/:id/reject`

```ts
// attach
z.object({ contact_number_id: z.string(), lead_ref: z.object({ model: z.enum(["FormLead","CallLead"]), id: z.string() }), reason: z.string().trim().max(200).optional() })
// reject
z.object({ reason: z.string().trim().min(1).max(200) })
```

Attach upserts the pair as `attached / owner_confirmed`, evidence `owner_attach`, marks sibling `ambiguous` edges on that number for the same time window as `candidate` again (fan-in recompute), and resolves `identity_review`. Reject sets `rejected`, recompute likewise. Response `{ attachments: LeadChipDto[], outreach: OutreachSummaryDto | null }`.

### 4.4 `POST /outreach/:id/commands`

Discriminated union, `Idempotency-Key` required, `expected_revision` required:

```ts
z.discriminatedUnion("command", [
  z.object({ command: z.literal("mark_worked"), expected_revision: z.number().int(), note: z.string().max(300).optional(), interaction_id: z.string().optional() }),
  z.object({ command: z.literal("set_next_action"), expected_revision: z.number().int(), kind: z.enum(["call","text_customer_via_lead_message","review","wait","reconcile_identity"]), due_at: z.string().datetime(), note: z.string().max(300).optional(), responsible_agent_id: z.string().optional() }),
  z.object({ command: z.literal("set_waiting"), expected_revision: z.number().int(), wait_until: z.string().datetime(), reason: z.string().trim().min(1).max(200) }),
  z.object({ command: z.literal("assign"), expected_revision: z.number().int(), responsible_agent_id: z.string().nullable(), reason: z.string().max(200).optional() }),
  z.object({ command: z.literal("close"), expected_revision: z.number().int(), reason: z.enum(["lost","not_sales","owner_dismissed","suppressed"]), note: z.string().max(300).optional() }),
  z.object({ command: z.literal("reopen"), expected_revision: z.number().int(), reason: z.string().trim().min(1).max(200) }),
  z.object({ command: z.literal("add_note"), expected_revision: z.number().int(), note: z.string().trim().min(1).max(500) }),
])
```

Transition legality per 01 §5.3; illegal → `422 { code: "ILLEGAL_TRANSITION", from, command }`. `close` with `booked|cancelled|duplicate|bad_lead|no_sync` is not accepted from the Owner (those come from official records). Response: `OutreachSummaryDto`.

Example:

```http
POST /api/v1/admin/sales-intelligence/outreach/66e5…/commands
Idempotency-Key: 9f1c…
{ "command": "set_next_action", "expected_revision": 4, "kind": "call", "due_at": "2026-09-14T20:00:00.000Z", "note": "Try after 4pm — she said she is at work", "responsible_agent_id": "64a1…" }
```

### 4.5 Follow-ups

`POST /followups` `{ outreach_record_id, expected_revision, kind, due_at, responsible_agent_id?, note? }` → also sets `next_action` when the record has none or the new due is earlier. `POST /followups/:id/complete` `{ disposition, note?, evidence_interaction_id?, next: { kind, due_at, note? } | { wait_until, reason } | { close_reason } | null }` — completing must produce a next action, a wait, a close, or an explicit `null` that surfaces `no_next_action`. `POST /followups/:id/snooze` `{ until, reason }`.

### 4.6 Findings

`POST /findings/:id/accept` `{ expected_outreach_revision, effect_choice?: "suppressed"|"temporarily_blocked"|"none" }` (choice required for `contact_restriction`). `POST /findings/:id/dismiss` `{ note? }`. Response `{ finding: FindingDto, outreach: OutreachSummaryDto | null, contact_number: ContactNumberDto | null }`.

### 4.7 Reps

`POST /reps/propose` → `{ proposed: number, unchanged: number }` (uses exact normalized full-name or alias equality; two Tylers stay unlinked). `POST /reps` `{ agent_id, rc_extension_id, role_kind, nudge_channels_allowed?, granot_username?, extension_user_id? }` (creates `reviewed`). `POST /reps/:id/review` `{ action: "review"|"retire"|"update", role_kind?, nudge_channels_allowed?, note? }`. A `review` on a `proposed` link whose extension already has a current reviewed link → `409 EXTENSION_ALREADY_LINKED`.

### 4.8 Nudges

```ts
// preview + send share the body
z.object({
  outreach_record_id: z.string(),
  rep_identity_link_id: z.string(),
  channel: z.enum(["team_messaging","sms_to_rep","pager"]),
  body_override: z.string().trim().min(1).max(1000).optional(),
  expected_outreach_revision: z.number().int(),
})
```

Preview → `{ ok: true, data: { allowed: boolean, blockers: string[], destination_kind: "direct_chat"|"rep_did"|"extension", destination_display: string, body: string, template_version: 1, rate_remaining: number } }`. Send → `201 { ok: true, data: NudgeDto }`; blockers → `422 { code: "NUDGE_BLOCKED", blockers }`; provider failure with fallback → `201` with `status: fallback_sent`; provider failure without fallback → `502 { code: "NUDGE_PROVIDER_FAILED", data: NudgeDto(status: failed) }`. `nudge_destination_is_customer` is `422` and also raises an error-level operational event.

### 4.9 `POST /conversations/:id/process`

Body `{ steps?: ("media"|"transcribe"|"extract")[] }`. Sets `next_attempt_at = now`, clears `unavailable_until` (unless `permission_denied` within 24 h → `409 CAPABILITY_DENIED`), bumps `sales_relevance` to `high` with reason `owner_requested`. Response `ConversationListItem`.

### 4.10 `POST /backfill`

Body `{ days: z.number().int().min(1).max(90) }`. Plans windows; `409 BACKFILL_ACTIVE` if planned/running windows exist. Response `{ planned: number, from, to }`.

## 5. Error codes (closed set)

`FEATURE_DISABLED`, `OWNER_REQUIRED`, `INVALID_SALES_INTELLIGENCE_QUERY`, `NOT_FOUND`, `REVISION_CONFLICT`, `ILLEGAL_TRANSITION`, `REVIEW_EXISTS`, `NUMBER_NOT_REVIEWABLE`, `EXTENSION_ALREADY_LINKED`, `NUDGE_BLOCKED`, `NUDGE_PROVIDER_FAILED`, `nudge_destination_is_customer`, `CAPABILITY_DENIED`, `BACKFILL_ACTIVE`, `IDEMPOTENCY_KEY_REQUIRED`.

## 6. Coverage on every response

`coverage` is computed once per request from `sales_intelligence_sync_state` (cached 15 s in-process) and attached by a small wrapper `withCoverage(data)`. The Admin renders the banner from it; no page invents its own "as of".

## 7. Admin proxy and authorization changes (`vantage-admin`)

- `server/auth/authorization.ts`: add `"/sales-intelligence"` to `OWNER_ONLY_PAGE_PREFIXES`; in `canProxyVantagePath`, deny non-owner for `path === "/api/v1/admin/sales-intelligence" || path.startsWith("/api/v1/admin/sales-intelligence/")` and for the new `GET /api/v1/admin/conversations/by-number/*` (already covered by the conversations prefix).
- New SSE BFF `app/api/sales-intelligence-live/route.ts` piping `GET /api/v1/admin/sales-intelligence/live` without buffering (copy `app/api/daily-operations-live/`). Owner-only.
- Proxy audit: all `POST` under the prefix are mutations; `nudges` and `attachments` bodies are audited as sent (they contain no customer full number beyond the last 4 in nudge bodies; attachment commands carry ids only).
- Commands forward `Idempotency-Key` from the browser (`lib/api/salesIntelligence.ts` generates a UUID per submit and reuses it on retry).

## 8. Tests that pin the routes

`sales-intelligence-admin.routes.test.ts`: Owner gate on every path; feature-disabled 404; Zod 400 shapes; `REVISION_CONFLICT` returns refreshed data; illegal transitions 422; nudge customer-destination guard; preview never sends; idempotent replay returns the same nudge; `500` never echoes `error.message`. `sales-intelligence-cron.routes.test.ts`: auth, disabled skip, lease-held skip, exact `vercel.json` entries.
