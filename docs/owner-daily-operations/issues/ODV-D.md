# Unit D — `LeadConversation` model, redactor, read routes, and one seeded conversation

> **Contract maturity: implementation-ready.** Implementation-blocked until ODV-A lands. This is the **entire shipped scope of the conversation feature**. The automated pipeline is deferred to ODV-H by Owner decision on 2026-08-19. This unit writes exactly one record, by hand, from a known booked Lead — enough for the Owner to judge the product before authorizing recurring cost.

## 1. Authority and required reading

- **Specification:** **§5.0 (the deferral and why), §5.1, §5.2 (the shipped scope), §5.5, §5.6, §5.9**, and **§7 in full — read every subsection before writing code that touches audio or transcript text.** Also §2.1, §2.3, challenge 0.9.
- **Wireframes (illustrative only):** `owner-daily-view-planned.txt` §9 (deferred state).
- **Proven reference implementations, to port not to reinvent:**
  - `scripts/dev_ops/ringcentral/transcribe-matched-booked-samples.ts` — STT + summary prompt, models, output shape
  - `scripts/dev_ops/blob/upload-ringcentral-mp3.ts` — private blob put, pathname convention, sidecar
  - `scripts/dev_ops/ringcentral/FINDINGS-form-lead-phone-matching.md` — the recording resolution path and its traps
  - `scripts/dev_ops/ringcentral/BOOKED-LEAD-TRANSCRIPT-SAMPLES.md` — verified booked leads with confirmed recordings, for choosing the seed
- **Existing seam:** `src/services/ringcentral/client.ts`, `mongo-token-store.ts`, `ringcentral-config.ts`.

## 2. Objective

Land the `LeadConversation` aggregate and its indexes; land the deterministic redactor; land the Owner-only read routes; and produce **one real conversation record** — mp3 in the private blob, redacted transcript, sectioned summary — for a named booked Call Lead, via an operator script. Populate the `conversation` field on Daily View lead list items. Flip `capabilities.conversations` to `available`.

## 3. Repository, branch, and prerequisites

- **Repository/branch:** `vantage-main-server` on the sprint branch. No `vantage-admin` change in this unit.
- **Prerequisite:** ODV-A complete.
- **Credential prerequisites:** `OPENAI_API_KEY`, `BLOB_READ_WRITE_TOKEN`, and RingCentral scopes `ReadCallLog` and `ReadCallRecording`. See §8 on which account.
- **Standing constraint:** this unit performs a real, authorized, single-record write against real customer audio. That is the point of it, and it is the **only** live-data action any issue in this pack authorizes. It requires explicit Owner go-ahead at execution time, recorded in the completion report.
- No commit, push, deploy, production apply beyond the authorized index apply, batch processing, or external send beyond the two single-call API requests the seed makes.

## 4. Current-state evidence to verify

Observed 2026-08-19; reverify at implementation:

- No `LeadConversation` model, `lead_conversations` collection, or `src/services/conversations/` exists.
- `openai` and `@vercel/blob` are present. `openai` and `ai`/`@ai-sdk/gateway` are currently in **`devDependencies`** — `openai` and `@vercel/blob` must move to or already be in `dependencies` for any runtime read path. Verify before assuming.
- The spikes ran on a **personal** OpenAI key (`call-lead-transcript-handoff.md`). §8 requires this to change.
- `CallLead.ringcentral` carries `call_log_id`, `telephony_session_id`, `duration_seconds`, `start_time`, and an immutable `original_caller`. `FormLead` carries **no** RingCentral ids.
- Recording resolution is `GET /restapi/v1.0/account/~/call-log/{id}?view=Detailed` → `recording.id` + `recording.contentUri`. `contentUri` is credential-bearing.
- The RC account-wide call log reaches **every extension**, not just the JWT user's.
- `scripts/dev_ops/**` is gitignored. The seeding script is a new committed operator tool and must live at a **non-ignored** path — verify the ignore rules before choosing it.
- `ringcentral-recording-samples/` is gitignored and must stay so.

## 5. Locked decisions and invariants at risk

- **The pipeline is deferred.** No cron, no queue consumer, no discovery, no scanning, no batch. Specification §5.0. Adding any of them under this issue makes the Owner's cost and retention decisions by default.
- **The conversation is evidence, not a Lead field.** No field is added to `FormLead`, `CallLead`, `BookedLead`, or `CancelledLead`. The join is `LeadConversation.lead_ref`, by index. This keeps the Unit 09/12 aggregate-revision and immutability guards untouched.
- **Redaction is a control, not a prompt.** The deterministic pass runs before the Mongo write **and** before the summarizer prompt. A model instruction is defence in depth only.
- **The raw transcript is never persisted, never logged, never written to disk.** Only the redacted text exists after step 7.
- **`contentUri` is never stored, logged, or returned.** Persist `call_log_id` and re-resolve.
- **Owner-only on every method**, in the Admin BFF and independently on the server.
- **Issuing an audio URL is audited.** "Who listened to which customer call, when" must be answerable from the first record.
- Summaries never mutate a Lead, Booking, or Cancellation. The conversation code has no domain-command dependency.

## 6. Deliverables and exact contract

### 6.1 Model

`src/models/LeadConversation.ts`, collection `lead_conversations`. The full document shape is specification §2.1 — implement it exactly, including the forward-declared pipeline fields (`state`, `attempts`, `next_attempt_at`, `claimed_by`, `claim_expires_at`, `last_error`, `cost_cents`, `media.purged_at`). §2.1 records why they land now.

Seven indexes, exactly as §2.1 tabulates. `lead_conversation_recording_unique` on `{ provider, provider_recording_id }` is the idempotency key and is the only unique index.

### 6.2 `src/services/conversations/redaction.ts`

```ts
export type RedactionResult = { text: string; redactions: number };
export function redactTranscript(raw: string): RedactionResult;
```

Targets, all deterministic:

| Target | Rule |
| --- | --- |
| Card number | 13–19 digits, **Luhn-validated**, including digits spoken in groups and separated by spaces, hyphens, or filler words |
| CVV | 3–4 digits in proximity to card context |
| Expiry | month/year-shaped pairs in card context |
| SSN | standard patterns |
| Bank routing / account | standard patterns |

Replacement is a stable token such as `[REDACTED:CARD]` so the summary can still reference "the card ending" without carrying the value. `redactions` is the count and is stored on the record.

**Luhn validation matters:** an unvalidated 16-digit rule will redact job numbers, phone sequences, and cubic-feet figures spoken together. Test both directions.

### 6.3 `src/services/conversations/` supporting modules

| File | Owns |
| --- | --- |
| `recording.ts` | `call_log_id` → RC detailed call log → `{ recording_id, content_uri, direction, result, started_at, duration_seconds, bytes }`. Never returns `content_uri` to a caller outside `media.ts`. |
| `media.ts` | Vetting (§5.5), download, private blob `put`, pathname `conversations/{provider_recording_id}.mp3` |
| `transcription.ts` | STT call, returns raw text to the caller and nothing else |
| `summarization.ts` | CRM context block + six-section prompt + `prompt_version` |
| `reads.ts` | The four read projections behind §6.4 |
| `index.ts` | Barrel |
| `config` | Model ids live in `src/config/domain/conversations.ts`, never inline |

Vetting rules (§5.5), enforced in `media.ts` before any spend: refuse `duration_seconds < 60`; refuse `result === "Voicemail"` with implausibly small bytes; refuse bytes inconsistent with stated duration.

Summary prompt sections, exactly six, in this order: Conversation overview; What the customer wanted; Quote / money / dates discussed; Outcome and next steps; Anything the agent promised or still needs; **Mismatch vs CRM** — only when the transcript contradicts the record.

Data minimisation (§7.5): the prompt carries job, source, agent, route, cubic feet, dates, and money. It does **not** carry the customer's full name, email, or phone.

### 6.4 Read routes

New router `src/routes/conversations-admin.routes.ts`, mounted after the `/api/v1` guard. Separate from `owner-daily-admin.routes.ts` because it serves transcript text.

```text
GET /api/v1/admin/conversations                       ?window &state &has_summary &cursor &limit
GET /api/v1/admin/conversations/:id                   full record incl. redacted transcript + summary
GET /api/v1/admin/conversations/by-lead/:model/:id    list for a Lead — NO transcript text
GET /api/v1/admin/conversations/:id/audio-url         short-lived signed blob URL — AUDITED
```

All four Owner-only via `requireRegistryOwnerActor`. `audio-url` returns a URL valid for minutes, not hours, and writes an audit row on **every** issue.

`canProxyVantagePath` gains `/api/v1/admin/conversations` as Owner-only for all methods.

**Deferred to ODV-H, not implemented here:** `POST /conversations/discover`, `/:id/retry`, `/:id/detach`, `/:id/attach`.

### 6.5 The seeding script

`scripts/conversations/seed-known-conversation.ts` (a **committed, non-gitignored** path — verify), run as `pnpm ops:seed-conversation`. Implement specification §5.2 exactly: explicit `--lead-model`, `--lead-id`, `--call-log-id`; the ten steps; and every guard.

Guards, all mandatory:

- `--confirm-write` required. Without it, perform steps 1–3 and print what would happen, spending nothing.
- `--max-cost-cents` ceiling, default 50, checked before step 6.
- **One lead per invocation. No `--all`, no `--limit`, no batch mode.** Adding one is how a deferred cost decision gets made accidentally.
- Print the resolved database name and refuse if `TEST_MODE` disagrees with the intent.
- Writes nothing to the Lead, the Booking, or any lifecycle collection.

Print on completion: document id, blob pathname, redaction count, real cost in cents.

**Seed choice:** an **inbound Call Lead** from `BOOKED-LEAD-TRANSCRIPT-SAMPLES.md` — the match is unambiguous, so the seed demonstrates the product rather than the matching problem. A second optional Form Lead seed is worth one run because it is the medium-confidence case the Owner will find least intuitive; take its `call_log_id` from the findings doc rather than discovering it.

### 6.6 Integration back into the Daily View

- `capabilities.conversations` → `available` (ODV-A's `capabilities.ts`).
- Populate `DailyLeadListItem.conversation` from `lead_conversations` by `lead_ref`, via one bounded `$in` per list page. **Not** a `$lookup`.
- Add the `conversation` timeline entry type at `type_priority` 85 and `ringcentral_call` at 15 to `GranotTimelineEntry` (specification §2.3), and extend `JOB_PROJECTION_FORBIDDEN_KEYS` / `assertProjectionSafe` so a timeline entry carrying transcript text, summary text, or an unmasked phone **fails**.

## 7. Explicitly out of scope

- **Every part of the automated pipeline — ODV-H.** No discovery cron, no form-lead phone-window scanner, no RC rate limiter, no queue consumer, no state machine transitions beyond the seed setting `complete`, no media janitor.
- The Conversations tab and the drawer Conversation panel — ODV-E.
- Attach, detach, retry, and discover mutations — ODV-H.
- Any backfill of the ~187 existing booked call leads with RC ids.

## 8. Flags and runtime posture

- **No feature flag.** The absence of a pipeline is the gate.
- **Credential posture is a deliverable, not a prerequisite to hand-wave:**
  - The OpenAI key **must** be a company organization account, not the personal key the spikes used. Record the DPA and training-opt-out status in the completion report.
  - Confirm Zero Data Retention eligibility **specifically for the audio transcription endpoint** — endpoint eligibility varies — and record the answer.
  - Record the provider path chosen (direct OpenAI or Vercel AI Gateway).
  - RC token uses `mongo-token-store.ts`. `RC_TOKEN_STORE=file` is a local spike affordance and must not reach a runtime path.
  - Blob objects are `access: "private"`. A public blob URL for a customer call is unrecoverable once indexed.
- Granot flags read-only and unchanged.

## 9. Migration and indexes

New `scripts/migrations/lead-conversation-indexes.ts`, run as `pnpm migration:conversations:indexes`. Report-first, following `granot-lifecycle-indexes.ts`: collision report, then explicit authorized apply. The seven index definitions are specification §2.1.

`lead_conversation_work` is declared and will match nothing until ODV-H. That is expected and is not a defect.

Apply to the test database only unless the Owner separately authorizes a production apply for the seeded record.

## 10. Acceptance criteria

- [ ] `redactTranscript` redacts a Luhn-valid card number spoken as digit groups, its CVV, its expiry, an SSN, and a routing number; `redactions` counts each.
- [ ] `redactTranscript` **does not** redact a job number, a phone number spoken conversationally, or a cubic-feet figure. Luhn validation is proven by a negative test.
- [ ] The raw transcript never reaches Mongo, a log line, or disk. Proven by inspecting the write path and by a test asserting the persisted text differs from the STT return when the fixture contains a card number.
- [ ] No stored document, log line, or API response contains an RC `contentUri`.
- [ ] `GET /conversations/:id/audio-url` writes an audit row on every call, and the URL expires in minutes.
- [ ] `GET /conversations/by-lead/...` returns **no** transcript or summary text.
- [ ] A non-Owner admin session is refused transcript text by the server **and** by `canProxyVantagePath`, proven independently.
- [ ] Running the seeding script **without** `--confirm-write` spends nothing, writes nothing, and prints the intended actions.
- [ ] Running the seeding script twice on the same recording produces **one** document, updated — proven by the unique index.
- [ ] The script aborts before STT when the estimated cost exceeds `--max-cost-cents`.
- [ ] The script has no batch mode. `grep` for `--all` and `--limit` in the script returns nothing.
- [ ] Vetting refuses a sub-60-second call and a small-byte `Voicemail` before any spend.
- [ ] **One real seeded record exists**, with a redacted transcript, a six-section summary, a private blob mp3, and a real `cost_cents`.
- [ ] `assertProjectionSafe` **rejects** a timeline entry containing transcript text, summary text, or an unmasked phone.
- [ ] `capabilities.conversations` is `available`, and the Daily View Leads tab shows `🎧` for the seeded lead and `—` for others.
- [ ] No cron, queue trigger, or scheduled job was added. `vercel.json` is unchanged.
- [ ] No field was added to `FormLead`, `CallLead`, `BookedLead`, or `CancelledLead`.
- [ ] No Command, `EntityChange`, revision transition, or outbox row was produced.

## 11. Required tests and commands

```bash
pnpm test
pnpm typecheck
pnpm migration:conversations:indexes            # report mode
pnpm ops:seed-conversation --lead-model CallLead --lead-id <id> --call-log-id <id>   # dry run, no --confirm-write
```

Focused tests:

- `redaction.test.ts` — the positive and negative cases above, with **synthetic** card numbers only. Never a real PAN in a fixture.
- `recording.test.ts`, `media.test.ts` — vetting rules, `contentUri` containment, blob pathname.
- `summarization.test.ts` — six sections present, `prompt_version` recorded, no direct identifier in the prompt.
- `LeadConversation.test.ts` — unique index behaviour, forward-declared field defaults.
- `conversations-admin.routes.test.ts` — Owner-only on all four, transcript absent from the by-lead projection, audit row on `audio-url`.
- Projection safety test extending the existing `assertProjectionSafe` suite.

## 12. Live/staging verification

**This is the one live-data step in the pack.** With explicit Owner go-ahead recorded:

1. Dry run first, no `--confirm-write`. Review the printed plan.
2. Run with `--confirm-write` against the intended database for a single named booked Call Lead.
3. Verify: the blob object is private; the stored transcript is redacted; the summary has six sections; `cost_cents` is populated.
4. Open the record through `GET /conversations/:id` as Owner and confirm the audit row for `audio-url`.

**No batch run. No production deploy. No second lead without a separate decision.**

## 13. Rollback

Delete the seeded `lead_conversations` document and its blob object — that removes the only customer data this unit created. Flip `capabilities.conversations` back to `not_built`. Unmount `conversations-admin.routes.ts`. The seven indexes are additive; leave them. The two new timeline entry types are additive union members and produce no entries once the records are gone.

## 14. Required completion handoff

Report: files added; the seven index definitions and collision-report output; **the credential posture answers from §8 in full** — org account, DPA, training opt-out, ZDR eligibility for the audio endpoint, provider path; the redaction positive and negative test output; the real per-call cost printed by the seed; the audit row proving `audio-url` is tracked; explicit confirmation that no cron, queue, or batch path was added and `vercel.json` is unchanged.

**Also report, for the Owner's ODV-H decision:** the observed per-call cost, the observed redaction count, and any judgement on whether the summary's Mismatch section produced something useful on real data.

**Unblocks:** ODV-E. **Does not unblock ODV-H** — that needs the specification §7 gates cleared, which is an Owner and counsel matter, not a completion criterion.
