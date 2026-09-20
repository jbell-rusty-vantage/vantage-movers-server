# 13 — Contact Number analysis: when it runs and every surface it touches

Status: as-built inventory of the implemented CSI-13/17/18 path, not a product proposal.
Authority for product rules remains [01](01-specification.md), [03](03-server-pipeline-and-jobs.md), and [10](10-intelligence-agent-contract.md).
Service cards: [analysis](../knowledge/services/sales-intelligence-analysis.md), [transcription](../knowledge/services/sales-intelligence-transcription.md), [media](../knowledge/services/sales-intelligence-recording-media.md), [fan-out](../knowledge/services/sales-intelligence-webhook-fanout.md).
Code of record: `src/services/salesIntelligence/analysis/*`.

This document exists so a refinement pass can see **exactly** when a Contact Number enters analysis and **every** Mongo collection, RingCentral endpoint, and sibling service the path reads or writes. Use the pack glossary: Contact Number, Lead Conversation, Form Lead, Call Lead, Booking, Outreach, Number Review. Do not invent a second CRM object.

---

## 1. Two analysis kinds hang off one Contact Number

A Contact Number does not have a single “analyze this number” button in the live pipeline. It accumulates work in two layers.

| Layer | Job stage | Subject | LLM? | What it is for |
| --- | --- | --- | --- | --- |
| Conversation extraction | `analysis` | `conversation:{lead_conversation_id}` | Yes | One Lead Conversation, one pinned CSI-12 transcript snapshot |
| Number synthesis | `number_refresh` | `number:{contact_number_id}` | Yes, only if ≥1 currently eligible transcript | Cross-call summary on the Contact Number |

Both use the same worker (`runIntelligenceJob`) and the same agent (`invokeIntelligenceAgent`). They differ in input selection, preflight width, and what application is allowed to write.

STT (`runTranscriptionJob`) is a **different** Gateway call. It never receives Lead/Outreach context. It only creates the conversation `analysis` job.

Application (`runIntelligenceApplicationJob`) is **not** an LLM call. Conversation application may write Outreach / Number Review / restrictions. Number synthesis **persists findings and a running summary only** — it never owns conversation effects (`apply.ts`: `if (!kind \|\| !run.conversation_id) continue`).

---

## 2. When a Contact Number is admitted at all

Number synthesis refuses the Contact Number before any budget reservation or provider work when:

- `kind !== "external"`
- `classification` is `company` or `non_customer`
- every Lead Conversation on the number is excluded, stale, or missing a current transcript snapshot → terminal `no_transcript_evidence`
- any conversation on the number is `undetermined` or `stale` while others might be eligible → the whole number input is `undetermined` (wait), not a partial synthesis
- source set overflows the fingerprint caps → paused `evidence_limit_reached` / `incomplete_coverage`, no LLM

Conversation extraction uses `decideAnalysisEligibility` on the **Call Interaction**, not on the Contact Number lifetime:

| Verdict | Meaning |
| --- | --- |
| Excluded | Internal, company DID/extension, company classification, or `non_customer`. No conversation LLM. STT may skip. |
| Undetermined | No sales reason yet, and an input is missing (`csi05_attachment_context`, `lead_reference_missing`, `csi10_reviewed_rep_mapping`). Analysis job exists but is paused. |
| Eligible | Not excluded, and at least one of: exactly one event-applicable Form Lead or Call Lead; Owner-opened Number Review; inbound with `inbound_route_id`; outbound with a reviewed CSI-10 Agent link. |

No duration, voicemail, Booked/Cancelled, contact-restriction, or sampling gate. Ambiguous attachments do not exclude; they only withhold the linked-Lead reason.

Flags that must be on for the LLM: `SALES_INTELLIGENCE_ENABLED` and `SALES_INTELLIGENCE_EXTRACTION_ENABLED`. Application also needs `SALES_INTELLIGENCE_OUTREACH_ENSURE`. Live RingCentral call-log tools additionally need `SALES_INTELLIGENCE_PROVIDER_READS` and a cached unexpired token.

Allowed analysis models (`CSI_EXTRACTION_MODELS`): `openai/gpt-5-mini`, `openai/gpt-5-nano`, and `openai/gpt-5.6-luna`.

---

## 3. How a number gets into the pipeline (events)

Nothing in analysis talks to RingCentral to *discover* a number. Capture does that first.

```text
RingCentral telephony webhook  or  Call Log reconcile
        │
        ▼
capture_projection  →  Call Interaction + Contact Number upsert
        │
        ├── outreach_ensure          (material terminal / identity change)
        ├── attachment_refresh       (new number, or backfill)
        └── recording_discovery      (terminal, non-internal)
                │
                ▼
           media_fetch  →  private Blob audio, Lead Conversation state = media_stored
                │
                ▼
           transcription (STT)  — only if eligibility.eligible === true
                │
                ▼
           analysis job on that Lead Conversation
                │
                ▼
           LLM  →  submit envelope  →  application
                │
                ▼
           scheduleNumberIntelligence(contact_number_id)
                │
                ▼
           number_refresh job (if fingerprint changed)
                │
                ▼
           LLM again (number synthesis)  →  submit  →  application (summary only)
```

Other ways `scheduleNumberIntelligence` is reached:

1. **Conversation (or number) application publish** — always called at the end of a successful apply transaction.
2. **Extract cron scan** — `scanIntelligenceChanges` walks 5 external Contact Numbers per `/api/cron/sales-intelligence-extract` (every 5 minutes) and schedules if the fingerprint changed.
3. **Outreach signals** — closing Outreach, or an Owner follow-up command, enqueues a `number_refresh` job that is **not** a model call. The worker coalesces it (`consumeNumberRefreshSignal`) into one `csi:number-analysis:{id}:{generation}` job.
4. **Owner `reanalyze`** on a number run — `original_evidence` or `current_context`. No STT.

A number-refresh job is **not** created when:

- an active `number_refresh` job is still pending/leased, or its application job is still open
- the stored `intelligence_schedule.fingerprint` equals the current source fingerprint
- the number is company / non_customer / non-external (refused later even if a job existed)

New real number-analysis jobs wait **15 seconds** so a burst of source writes can coalesce. Live AI jobs (priority 0) outrank historical backfill (priority −100) at claim time.

---

## 4. The fingerprint (what “sources changed” means)

`intelligenceSources` hashes meaning, not clocks. Generic `updatedAt` is excluded. Included:

- Contact Number `kind`, `classification`, `contact_eligibility`
- every canonical Call Interaction `_id` + `projection_revision` (cap 200)
- every Lead Conversation with a `latest_transcript_version` + media digest (cap 100)
- reviewed-rep identity fingerprint per call
- attachment edges + official Lead flags (`booked`, `cancelled`, `duplicate`, `bad_lead`, `no_sync`, Job Number)
- `booked_leads` / `cancelled_leads` projections
- published conversation finding **claims** (from each conversation’s `latest_completed_run_id`)
- Outreach state/assignment (waiting_on_customer collapsed to `open`)
- follow-up kind/description/status/due/owners/origin
- restrictions (expired collapsed to `active`)
- Owner instruction id/revision/state

Overflow of any listed cap fails closed (`EVIDENCE_LIMIT_REACHED`) and parks a visible paused overflow job. It does not silently drop older calls.

Because conversation findings are in the hash, **every successful conversation application that publishes new claims will schedule number synthesis**, unless a job is already active. Number-run findings and `running_summary` are **not** in the hash, so a number synthesis that only rewrites the summary should not immediately retrigger itself.

---

## 5. Surfaces touched, by phase

Surfaces below are what the **implemented code** reads or writes. “Preflight” is the worker calling MCP tools **before** `generate()`. The model may then call the same tools again, plus operational / RingCentral tools that preflight does **not** automatically load.

### 5.1 Upstream of any analysis LLM (per call on the number)

These are not analysis, but they are the only way a live number grows transcripts.

| Surface | Kind | What |
| --- | --- | --- |
| `ringcentral_webhook_events` | Mongo read | Receipt evidence for `capture_projection` |
| RingCentral `/restapi/v1.0/account/~/telephony/sessions` | Provider webhook in | All-direction subscription (no `withRecordings` filter) |
| RingCentral Call Log (reconcile worker) | Provider read | All-direction Detailed Call Log; own cursor/lease; not Call Qualification |
| `call_interactions`, `contact_numbers` | Mongo write | Capture projection |
| `sales_intelligence_jobs` | Mongo write | Downstream jobs |
| RingCentral recording metadata + content | Provider read | CSI-11 `media_fetch` only, account-scoped recording endpoints. No `contentUri` follow |
| Private Blob `conversations/{account}/{recording}/{digest}.{ext}` | Object write | Immutable audio |
| `lead_conversations` | Mongo write | `media_stored` then `transcribed` |
| AI Gateway STT | Provider write/read | Audio → redacted transcript. Default `openai/gpt-4o-mini-transcribe` |
| `intelligence_evidence_snapshots` | Mongo write | Immutable `source_type: "transcript"` |

Call Qualification, `ingestRingCentralQualifiedCall`, Lead creation, CRM posting, and Sheet Sync are **not** on this path.

### 5.2 Number-refresh / conversation analysis — admission (Mongo)

`conversationAnalysisInput` / `numberAnalysisInput` / `intelligenceSources` / eligibility:

| Collection / model | Access | Bound |
| --- | --- | --- |
| `contact_numbers` | read (+ retention fence increment on prepare) | 1 |
| `lead_conversations` | read | 101 / fail >100 |
| `intelligence_evidence_snapshots` | read current transcript snapshot per conversation | 1 per conversation |
| `call_interactions` | read canonical, `merged_into_id: null` | 201 / fail >200 |
| `number_lead_attachments` | read | 101 / fail >100 |
| `form_leads` / `call_leads` | read id existence + official flags via `loadLead` | 1 per edge |
| `outreach_records` | read (Lead subject or Number Review) | 101 / fail >100 |
| `outreach_followups` | read | 201 / fail >200 |
| `sales_intelligence_contact_restrictions` | read | 101 / fail >100 |
| `sales_intelligence_owner_instructions` | read | 201 / fail >200 |
| `rep_identity_links` (via `interactionRepIdentity` / `resolveRepIdentities`) | read | bounded in CSI-10 |
| `booked_leads` | read projection | 101 / fail >100 |
| `cancelled_leads` | read projection | 101 / fail >100 |
| `intelligence_findings` | read published conversation claims | 101 / fail >100 |
| `sales_intelligence_sync_windows` | read | historical capture ready? |
| `sales_intelligence_jobs` (attachment_refresh) | exists | historical attachments ready? |
| `sales_intelligence_ai_budgets` / `sales_intelligence_ai_reservations` | read/write | monthly + per-recording ceiling |
| `sales_intelligence_jobs` | claim/complete | analysis or number_refresh |
| `intelligence_runs` | create / update | one run per leased job |

Backfill-only Call Interactions (`sources` includes `backfill` and not `webhook` / `call_log_reconcile`) wait until later historical windows and attachment scans have settled.

### 5.3 Prepare run and MCP transport

| Surface | Kind | What |
| --- | --- | --- |
| `intelligence_runs` | Mongo write | Frozen `rendered_prompt`, `schema_digest`, `permitted_tools`, token nonce |
| HMAC run token | issued in-process | Bound to run, subject, tools, dataset, lease epoch; max 900s |
| MCP `https://…/api/intelligence-mcp` | HTTPS | Headers: scoped key + run token. Path must be exactly `/api/intelligence-mcp` |
| MCP `prompts/get` `sales_intelligence_analyze_v1` | remote | Must equal stored prompt |
| MCP `resources/read` `csi://schemas/csi-envelope-v1` | remote | Digest must equal stored schema |
| MCP `tools/list` | remote | Exactly the 12 `CSI_TOOLS` |

MCP (`vantage-movers-mcp`) has no Mongo, no RingCentral client, and no model. It forwards to main-server:

`GET/POST /api/v1/internal/sales-intelligence/runs/:id/{context,read,submit,submission}`

Each tool response is captured as an `intelligence_evidence_snapshots` row (128 snapshots, 512 KB each, 8 MB per run).

### 5.4 Worker preflight reads (always, before `generate()`)

Default order in `invokeIntelligenceAgent`. Each tool is paginated until `complete` or the **80-page** / **128,000 UTF-8** ceiling fails the run as `incomplete_coverage`.

| Tool | Server function | Mongo / other | Conversation run | Number run |
| --- | --- | --- | --- | --- |
| `get_intelligence_context` | `reads.ts` `context()` | Contact Number; Owner instructions; restrictions; attachments; bound Outreach + follow-ups. Number runs also load **all** Outreach on the number, **all** Lead Conversations, and findings from each `latest_completed_run_id`. Caps: 100 instructions, 50 restrictions, 100 edges, 100 Outreach, 100 follow-ups/Outreach, 200 records total. Oversize **fails closed** (does not omit Owner precedence). Also `readCaptureCoverage()`. | One Outreach pointer if Lead effects are allowed | Entire number context + prior conversation findings |
| `list_number_activity` | `getNumberTimeline` | Preflight counts: attachments ≤100, Outreach ≤100, Call Interactions with recordings ≤**2000** or fail. Then merge: `call_interactions`, `lead_messages`, `lead_conversations` (scan up to conversation-link limit), Outreach audit (`sales_intelligence_audit_events`). Coverage via `ownerRead` / `readCaptureCoverage`. Default page 50. | Full number timeline | Same |
| `search_leads` | `readLeads` | `form_leads` + `call_leads` where id is a relevant attachment **or** phone matches the Contact Number (any-known-contact paths). Limit 50. | Same number scope | Same |
| `search_bookings` | `readBookings` | First re-reads Leads (limit 100, must be complete), then `booked_leads` by `lead_ref` or Job Number | Same | Same |
| `get_rep_identity` | `reads.ts` | `call_interactions` + `rep_identity_links` at call time. Proposed/conflicting/unknown never become Agent authority. | **One** interaction | **Every** canonical call on the number (`sources.calls`, up to 200) |
| `get_call_transcript` | `reads.ts` | Immutable snapshot segments, `$slice` ≤100 per page. Conversation runs pin `input_refs[1]`. Number runs require the **current** version. | One snapshot, all pages | **Every** currently eligible conversation |

`readCaptureCoverage()` is account/sync coverage (watermarks, gaps). It is not a RingCentral refresh.

**Amplification already in the as-built worker:** a busy Contact Number’s preflight is `O(calls + transcript_pages)`, paid from an 80-page budget. A number with tens of transcribed conversations, or hundreds of calls, will typically die as `incomplete_coverage` rather than silently truncate. That is the first place this path “gets out of control” — not the webhook.

### 5.5 Optional tools the model may still call (not in preflight)

These burn the 8-step loop if used after evidence is already captured.

| Tool | Surfaces | Notes |
| --- | --- | --- |
| `get_lead` / `get_booking` | same Lead/Booking projections | Id must already be in scope or fail closed |
| `query_operational_records` `form_leads` / `call_leads` / `bookings` / `cancellations` | `form_leads`, `call_leads`, `booked_leads`, `cancelled_leads` | Same scoped wrappers |
| `query_operational_records` `agents` | Lead `receiver_agent`, last 50 calls, CSI-10 resolve, **catalog `agents`** | Up to 50 agents |
| `query_operational_records` `granot_sources` | Lead `source_granularity_id` → `granot_crm_sources` + Registry | Up to 200 |
| `query_operational_records` `job_timeline` | Job Number Timeline module, Mongo evidence loader **200 rows/query**, **5 Job Numbers** | Can touch the timeline’s underlying collections (Lead / Booking / Cancellation / Granot evidence). Ambiguous Job Number vs another Lead fails closed |
| `query_operational_records` `ringcentral_queues` / `ringcentral_users` | Latest `ringcentral_directory_snapshots` for `scope.account_id` | **Cached directory only.** Completeness marked unverified. Cap 200 rows |
| `search_ringcentral_calls` | **Live** `GET /restapi/v1.0/account/{account}/call-log?phoneNumber={e164}&view=Detailed` | Requires `PROVIDER_READS`, cached token **without refresh**, window ≤31 days, ≤20 provider pages, 1 MB body, 15s. Filtered to this E.164 |
| `get_ringcentral_call` | **Live** `GET …/call-log/{id}` | Only if the id is an alias on this number’s Call Interaction **or** already appeared in a captured page |
| `submit_intelligence_analysis` | `intelligence_submissions`, `intelligence_runs`, `sales_intelligence_jobs` (`application`) | Success = durable receipt |

Live RingCentral reads reuse `getRingCentralTokenStore().get()`. They **do not refresh** an expired token and they **do not** hit recording content endpoints. Directory sync (CSI-04) is a separate cron; analysis only reads the latest snapshot.

### 5.6 Gateway model call

| Surface | What |
| --- | --- |
| AI Gateway | `ToolLoopAgent` with pinned model. Provider retries disabled. Parallel tool calls off |
| Instructions | Stored `sales_intelligence_analyze_v1` + `subject_key` + optional Owner correction JSON |
| User prompt | Preflight pages as JSON + `idempotency_key = run_id` |
| Default ceilings | 8 steps, 6k output tokens/step, 512k input / 24k output cumulative, 120s |
| Budget | Entire loop reserved up front from the activated monthly period; conversation runs also check per-recording ceiling |

### 5.7 Application and publication (after a receipt)

| Surface | Conversation run | Number run |
| --- | --- | --- |
| `intelligence_findings` | write ≤5 per batch | write (no effects) |
| `intelligence_effects` | Outreach / restriction / Number Review / review items | none for conversation effect kinds |
| `outreach_records` / `outreach_followups` | `applyOutreachEffect`, `ensureNumberReview` | no |
| `sales_intelligence_contact_restrictions` | `applySpokenRestriction` (number-only, clear spoken) | no |
| `sales_intelligence_review_items` | identity / unclear / owner_conflict | assessments that disagree |
| `call_interactions` | unbound `contact_type` via `applyUnboundContactTypeEffect` | no |
| `lead_conversations` | `latest_completed_run_id`, `summary`, state `complete` | no |
| `contact_numbers.running_summary` | no | text + `run_id` + evidence digest |
| `intelligence_owner_assessments` | write | write |
| `sales_intelligence_audit_events` | `intelligence.published` | same |
| `scheduleNumberIntelligence` | always at publish | always at publish |

Never written from this path: official Booking / Cancellation, Form Lead / Call Lead fields, customer messages, automatic Rep Nudges, attachments.

### 5.8 Owner and Admin (not the automatic loop)

| Surface | Role |
| --- | --- |
| Admin `/sales-intelligence` and conversation panel | Read published summary / findings / review |
| Owner commands `reanalyze` / correct / retract | Queue another analysis or number_refresh job |
| Owner Coverage | Job health, budget remaining, recording counters |

---

## 6. Worked example: one eligible inbound on a new Contact Number

Assume flags on, budget present, mapped inbound, one Form Lead attached, one recording, STT non-empty.

1. Webhook receipt → `capture_projection` (Mongo receipt + Call Interaction + Contact Number).
2. `recording_discovery` + `outreach_ensure` + maybe `attachment_refresh`.
3. `media_fetch` → Blob + Lead Conversation `media_stored`.
4. Transcribe cron/queue → Gateway STT → snapshot `csi-transcript-v1:{sha256}` → `analysis` job.
5. Extract queue/cron claims `analysis`.
6. Preflight: context, timeline, Leads, Bookings, one identity, one transcript.
7. LLM submits envelope.
8. Application writes findings / permitted Outreach effects / conversation summary.
9. `scheduleNumberIntelligence` — fingerprint now includes the new transcript + published claims.
10. After 15s, `number_refresh` is claimed.
11. `numberAnalysisInput` sees one eligible transcript.
12. Preflight repeats, now including that conversation’s findings inside context, and the same single transcript.
13. LLM submits a number envelope.
14. Application writes number findings + `contact_numbers.running_summary`. No Outreach writes.
15. `scheduleNumberIntelligence` again; fingerprint usually unchanged → **stop**.

A second later call on the same number repeats 1–8 for the new Lead Conversation, then 9–15. Number synthesis now preflights **both** transcripts and **both** call identities.

---

## 7. Places this can grow without a product change

These are the as-built multipliers. They are why a refinement pass is justified.

1. **Number preflight is per-call and per-transcript.** `interaction_ids` is every canonical Call Interaction on the number, not only those with transcripts. `get_rep_identity` is invoked once per id. `get_call_transcript` is invoked once per eligible Lead Conversation, then paginated. The 80-page ceiling is the only brake; failure is a paused `incomplete_coverage` job, not a smaller automatic subset.

2. **Every published conversation analysis schedules number synthesis** when claims change the fingerprint. A chatty number with many newly transcribed calls produces one conversation LLM **plus** one number LLM after each successful apply, unless a number job is already in flight (then later fingerprint changes wait until that job finishes, then scan/apply can schedule the next).

3. **Extract cron scans five external Contact Numbers forever.** Any fingerprint drift (Outreach close, follow-up edit, restriction, Owner instruction, attachment revision, official booked/cancelled flags) can enqueue another number LLM even with **no new audio**.

4. **Outreach close / Owner follow-up commands** enqueue `number_refresh` signals. They are cheap until coalesced into a real number-analysis job after a fingerprint change.

5. **The model can still open live RingCentral Call Log and Job Number Timeline** after preflight. Those are not required for submit. They are the only live provider reads on the analysis path. They share the 8-step budget, but a single `search_ringcentral_calls` can pull up to 20 Detailed pages for a 31-day window.

6. **Context fails closed on size.** A number with >100 attachments, >100 Outreach records, >200 instructions, or >200 context records will not analyze until the set shrinks or the caps are changed. Same for fingerprint overflow (>200 calls or >100 transcribed conversations).

7. **Historical backfill** uses the same workers at priority −100. Fleet backfill (`BACKFILL_DAYS` / Owner `POST /backfill`) multiplies STT + conversation LLM + number LLM across the window. It is not implied by Saturday flag-on.

8. **Original-evidence Owner reruns** replay stored pages (no STT, no live RC) but still reserve analysis budget and invoke the model.

---

## 8. Hard caps already in the implementation

| Cap | Where |
| --- | --- |
| 8 agent steps, 2 submit attempts, 1 schema repair | `runtime.ts` |
| 80 preflight pages, 128k UTF-8 context ceiling | `runtime.ts` |
| 100 transcript segments / page | `get_call_transcript` |
| 200 calls / 100 conversations / 100 edges / 100 Outreach in fingerprint | `intelligenceSources` |
| 2000 recording-bearing interactions before timeline preflight fails | `list_number_activity` |
| 5 Contact Numbers per source scan | `scanIntelligenceChanges` |
| 5 findings applied per transaction | `apply.ts` |
| 5 Job Numbers in operational `job_timeline` | `operational.ts` |
| 20 live Call Log pages, 31-day window, 1 MB, no token refresh | `operational.ts` |
| 128 captured snapshots, 512 KB, 8 MB / run | `capture.ts` |
| Monthly AI ceiling + per-recording ceiling | policy + `reserveCsiBudget` |
| One active number-analysis job per Contact Number | `scheduleNumberIntelligence` |

Unknown ≠ zero. Incomplete coverage is a visible pause, not an empty successful analysis.

---

## 9. What this path never touches

- Call Qualification evaluator, its cursor, or Call Lead Ingestion
- Official Booking / Cancellation writes, Sheet Sync, Granot lifecycle processor
- Customer SMS / email, automatic Rep Nudge send
- RingCentral recording download (that is CSI-11, already finished before analysis)
- RingCentral token refresh from the analysis adapter
- Mongo operators or collection names supplied by the model
- Admin browser as an execution surface (Owner commands are a separate trusted actor)

---

## 10. Code map

| Concern | File |
| --- | --- |
| When number synthesis is scheduled | `src/services/salesIntelligence/analysis/scheduling.ts` |
| Eligibility + fingerprint | `analysis/sources.ts`, `conversations/eligibility.ts` |
| Claim, budget, invoke | `analysis/worker.ts` |
| Preflight + `generate()` | `analysis/runtime.ts` |
| Prompt / tools | `analysis/contracts.ts` |
| Mongo projections | `analysis/reads.ts`, `analysis/operational.ts` |
| Timeline merge | `src/services/numberActivity/timeline.ts`, `outreach/timeline.ts` |
| Capture / submit | `analysis/capture.ts`, `analysis/submit.ts` |
| Effects + summary | `analysis/apply.ts` |
| Conversation job creation | `conversations/transcribe.ts` |
| Live RC adapter | `analysis/operational.ts` `createScopedRingCentralGet` |
| MCP transport | `vantage-movers-mcp/lib/intelligence/` |
