# Contract delta for the new Sales Outreach Desk coordinator

**For:** the Sales Outreach Desk coordinator. Record this in the desk's next packet release (SPECIFICATION §8).

**From:** the server/Admin slimming (`slim/server-admin`; server, Admin and MCP bases `6a374fab` / `adda9e1` / `fbf061f`), 2026-10-04.

**Status:** effective since 2026-10-04: the slim deploy and the purge ran (CUTOVER.md; LEDGER "Cutover"). This file does **not** edit the Admin packet: `vantage-admin/docs/sales-outreach-desk/**` and `vantage-admin/SALES-OUTREACH-DESK.md` are untouched, with their hashes intact. The coordinator folds this delta in under the packet's own process.

This request supersedes the older packet's instruction to "preserve historical AI evidence". It preserves minimal human and provider facts and closure/restriction authority. It does not preserve an AI pipeline, transcripts or Attention.

## 1. Deleted, not preserved

After the purge, the AI-derived evidence below is physically gone from production. The desk must not plan to read, migrate or display it, and must not rebuild it from old rows.

| What | Where it lived | After the cutover |
| --- | --- | --- |
| Conversation audio | Vercel Blob `conversations/` (3,017 objects, 1.69 GiB at inventory) | Deleted. The user chose no audio backup (`--skip-blob-backup`), so nothing can restore it. RingCentral's own provider recordings are unaffected; only their ids remain on calls as metadata. |
| Transcripts, conversation media state | `lead_conversations` | Dropped |
| AI runs, evidence snapshots, submissions, findings, effects, Owner assessments | `intelligence_runs`, `intelligence_evidence_snapshots`, `intelligence_submissions`, `intelligence_findings`, `intelligence_effects`, `intelligence_owner_assessments` | Dropped |
| Move assessments (summaries, engagement bands) | `move_assessment_artifacts` | Dropped |
| Attention (snapshots, artifacts, publish fences) | `sales_intelligence_attention_snapshots`, `sales_intelligence_attention_artifacts`; sync scopes `attention_*` (C3) | Dropped / deleted |
| AI budget and reservations | `sales_intelligence_ai_budget`, `sales_intelligence_ai_reservations` | Dropped |
| Legacy Outreach planner | `outreach_records`, `outreach_followups`, `outreach_band_transitions`, `outreach_rep_days`; Outreach cursors (C6) | Dropped / deleted |
| Running summary, AI schedule, Outreach/analysis rollups on Numbers | `contact_numbers` fields (C1, C5) | Unset |
| Pointers from calls into conversations | `call_interactions.recording_discovery`, `recordings[].lead_conversation_id` (C7) | Unset |
| Worker/intelligence audit rows of retired kinds | `sales_intelligence_audit_events` (C4) | Deleted. Owner/Rep rows are kept. |
| Legacy job rows (analysis, media, transcription, Outreach, assessment, …) | `sales_intelligence_jobs` (C2) | Deleted |

The pre-purge backup (gzipped canonical EJSON, kept outside the repo for the recovery window in DATA-AND-STORAGE §3, proposed 30 days) is an **inert handoff**. Nothing reads it at runtime, nothing replays it, and it is never restored into a live collection. If the desk wants any of that history, it must ask for it, in writing, before the backup expires.

The desk must not consume old Attention, assessment summaries, extracted promises or old planner timestamps as cadence authority (SPEC §8).

## 2. Old `/outreach/:id` ids are retired

- `/sales-intelligence/outreach/:id` in the Admin is a deleted route and answers the normal 404 page. Any old `?view=attention|all_outreach|closed|overview|…`, `outreach=` or `lead=` link redirects to Numbers.
- After the purge, OutreachRecord ids exist only in the backup. There is **no id mapping**, and slimming builds none.
- If the desk needs URL continuity, it builds a bounded mapping during its own migration, from the backup, under its own contract. It must never retain the old planner just to keep URLs.

## 3. Human facts kept inert

These rows stay byte-for-byte, and no purge step touches them (`NEVER_DROP`; the purge's policy-drift check refuses a manifest that would). In the interim, **no reader enforces them, lifts them or acts on them, and nothing in Sales Intelligence contacts customers.** The desk owns their review/lift workflow. Details: [HUMAN-FACTS.md](evidence/HUMAN-FACTS.md).

| Fact | Collection | At inventory | Interim behavior | The desk must |
| --- | --- | --- | --- | --- |
| Contact restrictions, including the 16 AI-origin suppressions | `sales_intelligence_contact_restrictions` | 16 rows (15 active and unexpired), all `origin: intelligence` | Shown read-only on the Number detail ("Recorded by the retired analysis (kept as history)"). There is no lift command (`resolve_restriction` was removed). | Decide each one: confirm or lift, as a human decision. It must not silently clear a suppression because its AI provenance is gone. `run_id`/`finding_id` dangle and are opaque. |
| Review items | `sales_intelligence_review_items` | 12,202 (12,187 open, almost all AI-opened) | No reader and no resolve command. The attachment store can still open `identity` items for contested automatic attaches. | Own review. Any bulk retirement of AI-only causes needs an Owner decision under the desk's contract. |
| Owner instructions | `sales_intelligence_owner_instructions` | 4 (2 `status`, 2 `assignment`), all Owner | No reader. Their Outreach targets are dropped. | Import them under its own contract, or retire them explicitly. |
| Nudges (Rep messages) | `owner_rep_nudges` | 12, all `sent`; 0 delivery-uncertain | Retained for RingCentral Accounts `review_context` sends: `POST/GET /nudges`, preview, `nudge_repair`. Outreach-specific nudge actions are gone. 7 rows carry a dangling `outreach_record_id`. | Keep the single-attempt and unknown-outcome rules. It must never retry an old send under a new identity. |

**Retired, not kept:**

- open follow-ups (`outreach_followups`: 585, including 358 open; 0 Owner-entered);
- Outreach assignments (`outreach_records.assignment`, including 2 Owner assignments, which are also kept as Owner instructions).

Their only copy is the pre-purge backup, never replayed.

## 4. Retained authorities the desk builds from

| Authority | Where | Notes |
| --- | --- | --- |
| Official Leads and accepted priority | `form_leads`, `call_leads`, Granot lifecycle (`granot_observations`, `synchronization_decisions`, `granot_record_links`), `booked_leads`, `cancelled_leads` | The original received date and quality/age are preserved. Official Booking/Cancellation and accepted Granot closure evidence stay authoritative ("Remove Closed" removed only the old browse surface). |
| Provider call metadata | `call_interactions`, `call_interaction_aliases`, `contact_numbers` (deterministic rollups), capture state (`sales_intelligence_sync_state` kept scopes, `_sync_windows`, `ringcentral_*`) | Direction, result, duration, legs, provider recording ids (metadata only, never audio), and the contact type from the provider (or stored transcript/Owner values, which are kept and never recomputed). |
| Number↔Lead attachments | `number_lead_attachments` | Revisions, provenance and Owner decisions. Identity can be none, multiple or resolved; the desk must never pick one arbitrarily. |
| Rep identity | `rep_identity_links`, `ringcentral_directory_snapshots`, `agents` | Reviewed effective-dated links. Accounts propose and review: `POST /reps`, `/reps/propose`, `/reps/:id/review` ([ENDPOINTS.md](evidence/ENDPOINTS.md)). |
| Command and audit history | `sales_intelligence_command_executions`, Owner/Rep rows of `sales_intelligence_audit_events`, `entity_changes` | Replay/idempotency authority and human history. |
| Retained CSI policy | `sales_intelligence_policy_pointers` / `_versions` (`GET/PATCH /settings`) | Only the staffed clock, the `capture`/`nudges`/`live` capabilities and Call activity retention. **The desk's own configuration uses its own authority** (SPEC §7.3), never this policy. |

The desk must not plan a bulk legacy backfill activation: the old backfill is unregistered (`POST /backfill`), and its job stage is purged.

## 5. What exists in the interim

- **Sales Intelligence = Numbers + RingCentral Accounts, Owner only.**
  - Numbers: list, filters and paging; detail with Calls and messages, Lead matches (attach/reject/detach) and Details (read-only restrictions, Recount); capture health.
  - Accounts: directory, reviewed-Agent review, `review_context` messages.
- **Rep access is unavailable.** A Rep account sees "Sales Intelligence is being rebuilt — it is not available for Rep accounts yet". Every SI API route answers `403 OWNER_REQUIRED` to a signed Rep, whatever `SALES_INTELLIGENCE_REP_ACCESS` says. There is no Rep scope for Numbers.
- **No server AI, media, transcription or Outreach work runs.** Retired job stages are fenced: enqueue is refused, and a late queue delivery is acknowledged as retired without running. The MCP's analysis/conversation/assessment/story tools and its scoped intelligence endpoint are removed; the canonical read-only tools (for example `find_contact_number`) remain (evidence/MCP.md).
- The desk's E01–E06 and the remaining Owner policy gates still apply to enforcement. Slimming certifies none of them.
