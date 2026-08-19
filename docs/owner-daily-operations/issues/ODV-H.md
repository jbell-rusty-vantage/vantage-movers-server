# Unit H — Automated conversation pipeline

> **Contract maturity: complete. Implementation status: DEFERRED by Owner decision, 2026-08-19.**
>
> This unit is **not** blocked on engineering. The spikes in `scripts/dev_ops/ringcentral/` prove every mechanism it needs. It is blocked on decisions that are not the engineer's to make: recurring cost authorization, retention policy, the PCI position, and recording-consent counsel answers. Specification §5.0 and §7.
>
> **Do not start this unit until §3 records every gate as cleared, with the answer written down.** The moment a discovery cron exists, the Owner's cost and retention decisions have been made by default rather than by the Owner.

## 1. Authority and required reading

- **Specification:** §5.0 (the deferral), §5.1 (what is proven), **§5.3 (match ladders), §5.4 (state machine), §5.5 (media), §5.6 (STT/summary), §5.7 (retention), §5.8 (cost), §5.9 (deferred routes)**, and **§7 in full**.
- **Predecessor contracts:** ODV-D (model, redactor, read routes, seeded record), ODV-E (UI).
- **Proven references:** `FINDINGS-form-lead-phone-matching.md` — the three hard constraints; `call-lead-transcript-handoff.md`; `transcribe-matched-booked-samples.ts`.
- **Durable-work patterns to copy, not reinvent:** `src/services/granotLifecycle/drainer.ts` (claim, lease, retry, dead letter), `src/services/ringcentral/call-log-sync-state.store.ts` (account-level lease, cursor movement only on complete success), `src/services/granotLifecycle/queuePublisher.ts` (wake-up publish).

## 2. Objective

Automate what ODV-D did by hand: discover recordings for Leads, match them deterministically, store media, transcribe, redact, summarize, and let the Owner correct a wrong match. Turn one seeded record into a continuously maintained conversation history.

## 3. Gates — every one must be cleared and recorded before starting

Copy this table into the completion report with real answers, not checkmarks.

| # | Gate | Owner / counsel decision | Spec |
| --- | --- | --- | --- |
| 1 | **Cost authorization** | Approve ~$90/month recurring at 50 conversations/day, plus a one-time ~$10–15 backfill of the ~187 existing booked call leads with RC ids. ODV-D's completion report carries the real observed per-call cost. | §5.8 |
| 2 | **RC recording mode** | Automatic or on-demand per extension? | §7.2 |
| 3 | **RC announcement config** | Enabled for **inbound**? For **outbound callbacks**? These are configured separately and outbound is the one most likely missing it. | §7.2 |
| 4 | **RC retention period** | The account's actual number, verified in console — not assumed. | §7.2 |
| 5 | **RC scope breadth** | Which app holds `ReadCallLog` / `ReadCallRecording`; is the JWT a dedicated service identity rather than a person's account? | §7.2 |
| 6 | **Excluded call types** | Which calls must **never** be transcribed — HR, internal extension-to-extension, personal lines. The account-wide log returns all of them. | §7.2 |
| 7 | **PCI position** | Are deposits still taken by reading card numbers aloud? If so, has recording pause-during-payment or a payment link been adopted? This reduces exposure that exists **today**, independently of this feature. | §7.3 |
| 8 | **Consent — inbound** | Does the current announcement satisfy Florida all-party consent for inbound? | §7.4 |
| 9 | **Consent — scope** | Does consent to *record* extend to transcription, storage outside the phone system, and third-party AI processing? | §7.4 |
| 10 | **Privacy policy** | Does it cover call recording, transcription, and the AI sub-processor? | §7.4 |
| 11 | **Retention policy** | The decided line. Specification §5.7 proposes 90 days for unbooked audio, indefinite for booked, transcripts permanent — and records the counter-position of storing **no** audio at all. ODV-E's completion report carries the Owner's reaction to playback. | §5.7 |
| 12 | **Form-lead discovery scope** | Booked form leads only, or all form leads? Recommendation: booked only. | §12.2 #10 |

If gate 11 lands on "no audio at all", **this issue changes shape**: `media.ts` streams RC → STT in memory, the blob store and janitor are dropped, and ODV-E's player is removed. Re-author §6 before starting rather than building storage that policy has already excluded.

## 4. Current-state evidence to verify

Reverify at implementation — this contract was authored 2026-08-19 and the pipeline may be starting much later:

- ODV-D landed the model with its forward-declared work fields (`state`, `attempts`, `next_attempt_at`, `claimed_by`, `claim_expires_at`, `last_error`, `cost_cents`) and the `lead_conversation_work` index, which has matched nothing until now.
- ODV-D landed `redaction.ts`, `recording.ts`, `media.ts`, `transcription.ts`, `summarization.ts`. This unit **orchestrates** them; it should not rewrite them.
- The seeded record(s) from ODV-D exist and must survive. They are `state: "complete"` and must not be reprocessed.
- `vercel.json` has no conversation cron or queue trigger. This unit adds them.
- `call-log-sync-state.store.ts` holds an account-level lease on `key: "account"` for Call Log sync at `*/30 * * * *`. **This unit's discovery must not contend with it** — verify the current cadence and lease semantics before choosing one.

## 5. Locked decisions and invariants at risk

- **Mongo is the work source; the queue is a wake-up.** Same invariant as Granot Unit 08. A lost queue message must not lose work.
- **One stage per invocation.** A 25-minute mp3 through STT plus a summary in one invocation risks the function timeout and forces a full retry of work already paid for.
- **Redaction runs before the Mongo write and before the summarizer prompt.** ODV-D's control, unchanged. The raw transcript is never persisted, logged, or written to disk.
- **`contentUri` is never stored, logged, or returned.**
- **Discovery is scoped to Leads in registered Source Granularities**, never "all recordings in the window". The account-wide log is broader than this feature's need; that constraint is a security property, not just a matching strategy.
- **Confidence is never `high` for a phone-window match.**
- **Vet before spending.** `duration_seconds < 60`, small-byte `Voicemail`, and byte/duration mismatch are refused before STT.
- **Rate limiting is mandatory.** Call Log is an RC Heavy endpoint; `429 CMN-301` is routine, and an unfiltered outbound scan sees only the newest ~300 rows.
- Summaries never mutate a Lead, Booking, or Cancellation.

## 6. Deliverables and exact contract

Implement specification §5.3–§5.7 as written. Summarised here for scope; the specification carries the detail.

### 6.1 Match ladders — §5.3

**Call Lead:** `telephony_session_id` → `call_lead_telephony_session` (high); else `call_log_id` → `call_lead_call_log_id` (high); else **no discovery** — do not fall back to a phone scan, because Granot Unit 20 adoption is the sanctioned path for attaching a physical call.

**Form Lead:** normalize phone → **10-digit national** (E.164 returns zero records — this is the single most expensive trap in the feature); window `min(lead.timestamp, booking.book_date) − 36h` to `max(...) + 36h` capped at 14 days; `direction=Outbound&type=Voice&view=Detailed&phoneNumber=<10digit>`; confirm last-10 digits against `to`/`from` in the body; keep rows with a recording and `result` in `{Accepted, Call connected}`; one candidate → `form_lead_outbound_phone_window` (medium); several → longest connected, medium, with `candidate_count` recorded; zero → terminal `no_recording`, do not widen automatically.

### 6.2 State machine — §5.4

`discovered → media_stored → transcribed → complete`, plus `no_recording` (terminal, benign), `failed` (retryable), `dead_letter`. Claim under a five-minute lease, advance exactly one stage, re-publish `{ conversation_id }`, return.

### 6.3 Triggers

| Trigger | Cadence | Scope |
| --- | --- | --- |
| `/api/cron/conversation-discovery` | `*/15 * * * *` | Call Leads, last 24h, with `call_log_id`, no conversation record |
| `/api/cron/conversation-form-discovery` | `0 */2 * * *` | Booked Form Leads, last 48h, no record. Heavy — hard cap per run. Scope per gate 12. |
| Queue `conversation-events*` | on publish | Stage advance |
| `POST /conversations/discover` | on demand | One Lead, Owner-initiated, leased |
| `/api/cron/conversation-media-janitor` | daily | Per gate 11 |

The on-demand button matters: it makes the feature useful the moment the Owner cares about a specific lead instead of making him wait for a cron.

### 6.4 Rate limiting

Shared token bucket in front of every RC Call Log call, sized well under the Heavy quota, exponential backoff on `429 CMN-301`. Discovery holds an account-level lease via `durableWork`. **Must not contend with Call Log sync.**

### 6.5 Deferred routes from §5.9, now implemented

```text
POST /api/v1/admin/conversations/discover      Owner. Idempotency-Key.
POST /api/v1/admin/conversations/:id/retry     Owner. Idempotency-Key.
POST /api/v1/admin/conversations/:id/detach    Owner. Idempotency-Key.
POST /api/v1/admin/conversations/:id/attach    Owner. Idempotency-Key.
```

Unit 24/25 contract: exactly one `Idempotency-Key`, `requireRegistryOwnerActor`, stored replay, `409` on stale revision. Detach clears `lead_ref` and keeps the record; attach sets `match_method: owner_manual_attach`.

### 6.6 Admin

Enable ODV-E's disabled `[Attach →]` and `[Retry]` controls. The tab layout does not change — ODV-E built it for this.

## 7. Explicitly out of scope

- Realtime transcription of in-progress calls.
- Sentiment, agent grading, call-quality scoring. Specification §11.
- Any automatic action from a summary. A CRM mismatch surfaces; it never writes.
- Backfill of historical booked leads — a separate authorized run, not part of the pipeline.
- Transcribing any call type excluded by gate 6.

## 8. Flags and runtime posture

Unlike the rest of this pack, this unit **requires a flag**: `CONVERSATION_PIPELINE_ENABLED` in `src/config/domain/conversations.ts`, checked-in default **false**. Discovery crons, the queue consumer, and the janitor all fail closed when it is false. Enabling it in production is a separate authorized decision recorded against gate 1.

A second flag `CONVERSATION_FORM_DISCOVERY_ENABLED`, default false, gates the heavier form-lead scan independently so the cheap Call Lead path can be enabled first.

## 9. Migration and indexes

No new index — ODV-D declared all seven, including `lead_conversation_work` which this unit is the first to use. Verify the claim query uses it via `explain()` before enabling anything.

`vercel.json` gains three cron entries and one queue trigger. Record the diff in the completion report.

## 10. Acceptance criteria

- [ ] Every gate in §3 is recorded with a real answer in the completion report.
- [ ] A Form Lead phone query uses 10-digit national; an E.164 query is proven to return zero and is never issued.
- [ ] Last-10-digit confirmation against the response body rejects a filter miss.
- [ ] Zero candidates → `no_recording`, terminal, no automatic widening.
- [ ] Several candidates → longest connected, medium confidence, `candidate_count` recorded.
- [ ] A Call Lead with neither `telephony_session_id` nor `call_log_id` triggers **no** phone scan.
- [ ] One stage advances per invocation; a lease expiry allows exactly one other worker to claim.
- [ ] Replica test: two concurrent workers produce one winner, no duplicate record, no duplicate spend.
- [ ] A lost queue message is recovered by cron — Mongo is the work source.
- [ ] `429 CMN-301` backs off and does not spin.
- [ ] Discovery does not contend with Call Log sync; proven by lease inspection.
- [ ] Vetting refuses sub-60s, small-byte `Voicemail`, and byte/duration mismatch before STT.
- [ ] Redaction runs before persistence and before the summarizer prompt; the raw transcript never reaches Mongo, a log, or disk.
- [ ] No stored document, log, or response contains a `contentUri`.
- [ ] ODV-D's seeded records are **not** reprocessed and are not modified.
- [ ] Detach clears `lead_ref` and keeps the record; attach records `owner_manual_attach`; both replay on the same `Idempotency-Key` and `409` on a stale revision.
- [ ] With both flags false, no cron does work, no queue message is consumed, and no external call is made.
- [ ] The janitor purges per gate 11 and leaves transcript text intact.
- [ ] No Lead, Booking, or Cancellation is mutated by any path in this unit.

## 11. Required tests and commands

```bash
pnpm test
pnpm typecheck
pnpm test:granot-lifecycle:replica     # extend for the conversation drainer
cd ../vantage-admin && pnpm test && pnpm typecheck && pnpm build
```

Replica tests are mandatory for the claim, lease expiry, and one-winner concurrency. Match-ladder tests use recorded synthetic RC responses — **never a live payload in a fixture.**

## 12. Live/staging verification

Enable both flags on the test environment only. Run one discovery cycle against a bounded seeded set. Verify: match methods and confidences are as expected; costs match projection; rate limiting holds; no excluded call type was touched.

**Production enablement is a separate Owner decision recorded against gate 1, not a completion criterion of this issue.**

## 13. Rollback

Set `CONVERSATION_PIPELINE_ENABLED` false — every cron and consumer fails closed immediately. Records already produced stay readable; ODV-E continues to render them. Then remove the cron and queue entries from `vercel.json`. Do not delete conversation records on rollback; they are evidence and the Owner may still want them.

## 14. Required completion handoff

Report: **the §3 gate table with real recorded answers**; files added; the `vercel.json` diff; replica concurrency proof; rate-limit and backoff evidence; confirmation that seeded records were untouched; observed cost for the verification run against the §5.8 projection; explicit confirmation that no Lead, Booking, or Cancellation was mutated.

**Unblocks:** nothing. This is the last unit of the conversation feature.
