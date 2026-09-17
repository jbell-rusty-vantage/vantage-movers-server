# 08 — Intelligence envelope grill handoff

> Historical reference retained September 17, 2026. The completed Owner interview is in [09](09-owner-workflow-interview.md); revised [01–06](README.md) and [10](10-intelligence-agent-contract.md) supersede behavioral instructions and open-decision guidance in this file. Use [workspace](workspace/README.md) for implementation.

**Status:** in progress. Not a replacement for 01–06.  
**Date:** September 17, 2026.  
**From:** grill session on Call & Sales Intelligence (LLM envelope, webhooks, auto-apply).  
**For:** the next agent continuing this conversation. The Owner may have a specific site open (Claude Design, RingCentral developer docs, or the Admin preview). This file is the specification/intelligence thread, not the visual brief in [`07-claude-design-brief.md`](07-claude-design-brief.md).

Read this, then [`01-specification.md`](01-specification.md) §§5.3–5.4, 8–9, [`02-domain-models.md`](02-domain-models.md) §§6–7, and [`03-server-pipeline-and-jobs.md`](03-server-pipeline-and-jobs.md) §§2, 4–6, 9. Do not re-derive webhook types from memory — the proof is in §2 below.

## How to continue

Follow [`.agents/skills/grilling/SKILL.md`](../../../.agents/skills/grilling/SKILL.md): one question at a time, recommended answer each time, explore the pack instead of asking what the docs already answer.

Resume at **Question 4** in §6. Questions 1–3 are closed or parked.

Do **not** rewrite 01–06 in this sitting unless the Owner asks. Capture new decisions here first. If a decision contradicts a pack invariant, say so explicitly (the contradictions are already listed in §4).

---

## 1. Operating reality (Owner correction — treat as fact)

This is not how the Sept 14 pack assumed the company works.

1. **There is no entry point today** for the Owner or a Sales Rep to create a due date, follow-up, or callback time in Vantage. Some people may use personal calendars. **This system sees none of that.**
2. **Making sense of the calls is now our job.** Promised times and next steps live in recordings until we extract them.
3. **Human review is not a gate.** The LLM envelope executes. The Owner must always be able to intervene: correct an assertion, send that correction back, and **re-run on the same snapshot** or **from scratch on current state** (the number / Lead / Outreach row may have moved).
4. Capabilities already funded: **Vercel AI SDK / AI Gateway**, **RingCentral API**. **No RingSense / ACE license.** Path is our STT + structured extract. Sept 14 capability proof: company recording read is **denied**; RingSense scope is on the token and 404s.

The Sept 14 pack’s `set_next_action` / Follow-up commands remain worth building as **Owner intervention**, not as the primary source of due dates. Band 4 is empty until extraction (or a later correction) writes a Follow-up.

---

## 2. Proof already gathered (do not re-research unless the Owner asks)

### 2.1 RingCentral webhooks

RingCentral has no generic “call finished” or “recording ready” webhook. You `POST /restapi/v1.0/subscription` with event filters and a HTTPS `WebHook` address. Token has `SubscriptionWebhook`. Sept 14: this app could list subscriptions; **0 were visible**. Subscriptions expire ~7 days. Create sends `Validation-Token`; `/api/webhooks/ringcentral` already echoes it.

**Families (official filter index):**

| Family | Filter | CSI v1? |
|---|---|---|
| Account telephony sessions | `/restapi/v1.0/account/~/telephony/sessions` | **Yes — foundation** |
| Extension telephony sessions | `/account/~/extension/{id}/telephony/sessions` | No — we want account-wide |
| Presence | `/account/~/presence`, `/extension/{id}/presence` | Later phase |
| Message store (SMS / voicemail / fax / pager) | `/extension/{id}/message-store` | No — customer SMS is Twilio; voicemail as a call result comes from telephony + Call Log |
| Team Messaging | `/team-messaging/v1/posts`, `/groups` | No — we only send nudges |
| Directory / extension changes | `/account/~/directory/entries`, `/account/~/extension` | No — daily snapshot cron |
| A2P / webinar / contact-center | various | No |

**There is no Call Log change webhook.** Detailed Call Log stays a poll. Pack already makes Call Log reconcile **authoritative** and the webhook **best-effort**.

**Telephony payload (what we actually get):** envelope `uuid`, `event`, `subscriptionId`, `ownerId`, `timestamp`. Body: `sequence`, `sessionId`, `telephonySessionId`, `eventTime`, `accountId`, `origin.type`, `parties[]` (`id`, `direction`, `from`/`to` phone+name+extensionId, `extensionId`, `queueCall`, `missedCall`, `status.code` ∈ Setup / Proceeding / Answered / Disconnected / Gone / Parked / Hold / VoiceMail / FaxReceive / VoiceMailScreening).

**Not reliably in the webhook:** recording bytes, a stable recording id at hangup, trusted duration, Call Log `result`, Lead identity. Recording ids arrive later on Detailed Call Log.

Optional query params: `direction`, `phoneNumber`, `missedCall`, `statusCode`, `withRecordings`, `sipData`. **Do not use `withRecordings=true` as the account filter** — it drops missed/unrecorded traffic Attention needs.

**Today vs CSI-03:** live code creates inbound-only (`?direction=Inbound`) via `buildRingCentralTelephonyEventFilters`. Pack adds mode `all` (same path, no direction filter). Duplicate `uuid` already fenced at capture. Fan-out into Number Activity is `SALES_INTELLIGENCE_CAPTURE_WEBHOOK`. Qualification stays inbound-only and is never imported by the new modules.

Sources: RingCentral event-filter index + Account/Extension Telephony Sessions Event; `src/services/ringcentral/webhook-subscriptions.ts`; `webhook-event-normalizer.ts`; `scripts/dev_ops/ringcentral/ringcentral-webhook-create.ts`; `scripts/dev_ops/ringcentral/output/capability-proof.md`; 03 §2.

### 2.2 Other Vantage events (already in the pack)

RingCentral is only the call-capture bus. Analysis already has other triggers (03 §§4–6):

| Event | Drives |
|---|---|
| Form Lead / Call Lead created or `updatedAt` watermark | Attachment suggest + Outreach ensure |
| `booked` / `cancelled` / `duplicate` / `bad_lead` / `no_sync` flip | Outreach → `closed` (never from a transcript) |
| Terminal Call Interaction (webhook **or** Call Log) | Outreach transitions + conversation discover |
| Attachment `ambiguous` / resolved | `identity_review` in/out |
| Recording id on the interaction | `LeadConversation` `discovered` → media → STT → extract |
| Owner `POST .../conversations/:id/process` | Force media/STT/extract |

Granot snapshots ride the Lead `updatedAt` scan. They do not get a second webhook into this module.

---

## 3. Decisions settled in this grill

### 3.1 Bands are not states

The seven Attention bands (01 §8) are a **read-time ranking** of Outreach Records. They are not “number-lead sales intelligence states.” The four machines stay orthogonal: Contact Number classification, Number↔Lead attachment, Outreach, Conversation processing.

Owner-facing band copy (unchanged intent):

1. Promised callbacks that are overdue  
2. No call yet after a form came in  
3. Missed calls with no callback  
4. Follow-ups that are due  
5. Being worked, but no next step  
6. Open work nobody owns  
7. Going cold  

### 3.2 What the LLM is for

- **Band 1** needs a transcript. There is no RingCentral field for “I will call you tomorrow after 3.” Detection is the model. **Overdue is the clock.**
- **Band 4** is not “a rep typed a time in Vantage.” In this company that time was spoken or it does not exist. Extraction (or later Owner correction) is how a Follow-up gets a `due_at`.
- Bands 2, 3, 6, 7 are knowable from Leads + Call Log without a transcript.
- Band 5: contact-type (human vs voicemail) may use a cheap model; “no next step” is `open` + `next_action = null`.

### 3.3 Envelope shape (Owner accepted)

```
{
  summary,                 // Owner prose, from validated findings — not from raw transcript
  findings[],              // atomic cited claims (promised_callback, customer_will_call, …)
  next_step_suggestion     // { kind ∈ call|text|review|wait|reconcile_identity, date_text, citations[] }
}
```

- Attachment state and Outreach **state** are **inputs** to the prompt (so the model does not contradict a Booking or `identity_review`). They are **not** model outputs.
- The model must not emit `attention_band` or `outreach_records.state`.

### 3.4 Where deterministic and LLM synthesize

**Synthesize in the fact store. Keep ranking a pure function.**

- LLM writes spoken facts (promise, next step, contact type) into stored rows.  
- Code writes clocks, eligibility, official Booking/Cancellation, attachment.  
- `derive.ts` reads those facts and returns a band. Same stored facts → same band, every time.

Do **not** let the model print a band number. That is the predictability the Owner said he will not trust if it becomes a guess.

Band 1 is already a synthesis: model wrote the promise + date text; code resolved `due_at`; clock decided overdue.  
Band 5 is already a synthesis: model/rules wrote human conversation; code wrote “no next step.”

### 3.5 Review vs intervene

Pack invariant 5 / 01 §9.4 / 03 §6.4 said findings are review-only and never write a due date without an Owner accept. **Owner overrode the gate:** the envelope **executes**. Intervention is after the fact: correct → re-run same snapshot, or re-run from scratch if the number has moved.

Verification (cite exact transcript spans, entailment) is **wanted** but **not on at full effect in the first enable**. Citation fields should exist now so the second pass can turn on later.

---

## 4. Pack contradictions this session opened

Flag these. Do not silently keep both.

| Pack (Sept 14) | This session (Sept 17) |
|---|---|
| Findings review-only; accept creates Follow-up / wait (01 §9.4, 03 §7) | Envelope executes unattended; Owner contests later |
| AI labelled “not verified” until Owner accepts (01 §10) | Still labelled, but it already wrote `next_action` / Follow-up |
| Band 4 copy: “A rep set a time” (05 / Owner language) | No due-date entry exists; the time was spoken or absent |
| Invariant 4: no Finding writes Outreach state except listed system transitions | Auto-apply will write `next_action`, Follow-up, possibly `waiting_on_customer` without an Owner command |
| CSI-13 acceptance: accept `promised_callback` creates exactly one Follow-up | Create happens at extract time; accept/dismiss becomes **correct / undo / re-run** |

06 D6 (Gateway STT + extract, no ACE) and D5 (recording grant denied) are unchanged.

---

## 5. Parked — Owner said “that sounds about right” but is not sure

**Question 3 (auto-apply blast radius) — leaning, not locked.**

Recommended auto-apply:

- `contact_type` (voicemail vs human)  
- `next_action` / Follow-up from `promised_callback` or `next_step`, only when `date_text` resolves **and** citations exist  
- `waiting_on_customer` from `customer_will_call` when the date resolves  

Never auto-apply: attachment, Booking/Cancellation, `closed`, `suppressed`, eligibility, or a band number. `booking_claim` stays a visible claim, not a Booking.

Citation-missing or unresolvable date → persist the finding, **do not** write a due date. Owner correction + re-run is how those get a clock.

Owner: *“Yes that sounds about right on the auto apply but I am not sure yet.”*

---

## 6. Resume the grill here

Ask **one** of these, in this order. Give a recommended answer each time.

### Question 4 — Re-run semantics (next)

When the Owner corrects an assertion and asks to run again:

- **Same snapshot:** reuse the redacted transcript + the same `evidence_digest`; apply the Owner note as extra instructions; supersede un-contested auto-applied writes from that digest.  
- **From scratch:** re-read current Contact Number + attachment + Outreach + later calls; new digest; do not silently revive a superseded Follow-up.

Need to settle: does a correction **replace** the auto-applied Follow-up immediately, or only after the re-run returns? Recommend: correction that retracts a promise **deletes or cancels that Follow-up immediately**; a correction that changes a date **patches `due_at` immediately** and still re-extracts so the summary matches.

### Question 5 — Verification, first enable vs later

Owner wants: after summary/findings/next-step, the agent asserts **locations of exact text** in the transcript to prove the summary is sound. Not at full effect at first.

Settle: ship `citations[{ sid, text }]` and `validation.citations_exist` now (already in 02 §7). First enable: missing citation → do not auto-apply that finding (even though review is not a gate). Later: character-offset / exact-string locate + cheap entailment (`pass|fail|unsure`) as in 03 §9.4. Entailment `fail` → do not auto-apply.

### Question 6 — Lock Question 3

Return to auto-apply blast radius once 4–5 are clear. Especially `waiting_on_customer` unattended, and whether `intent = not_sales` may never auto-close.

### Later branches (do not jump ahead)

- Production subscription ownership (06 D8): create `all` from this app; keep inbound until qualification is proven equivalent.  
- Company recording grant (06 D5): intelligence will sit `unavailable:permission_denied` until granted.  
- Prompt context: which Lead facts (initials, move cities, date, source label — no phone/email) go into extract.  
- Whether `number_summary` still recomputes from the evidence set only (03 §9.5).  
- Admin intervention UI: correct / re-run same / re-run scratch — not in 04 yet.  
- Glossary: still proposed in 01 §3; do not paste this file into `CONTEXT.md`.

---

## 7. Recommended extract contract (working draft — not in 01–03 yet)

Zod-shaped, temperature 0, no tools, transcript marked untrusted. Mirror 03 §9.3 kinds. Add the envelope wrapper the Owner accepted:

```ts
z.object({
  summary: z.string().max(800),
  findings: z.array(z.object({
    kind: z.enum([
      "contact_type", "intent", "move_fact", "objection", "quoted_amount",
      "promised_callback", "customer_will_call", "next_step",
      "booking_claim", "contact_restriction", "competitor_mention", "coaching_note",
    ]),
    claim: z.string().max(240),
    actor: z.enum(["rep", "customer", "unknown"]).nullable(),
    action_status: z.enum(["requested", "promised", "completed", "conditional"]).nullable(),
    date_text: z.string().max(60).nullable(),
    amount_text: z.string().max(40).nullable(),
    amount_meaning: z.enum(["quote_total", "deposit", "competitor_quote", "other"]).nullable(),
    citations: z.array(z.number().int().positive()).min(1).max(6),
    confidence: z.number().min(0).max(1),
  })).max(40),
  next_step_suggestion: z.object({
    kind: z.enum(["call", "text_customer_via_lead_message", "review", "wait", "reconcile_identity"]),
    date_text: z.string().max(60).nullable(),
    claim: z.string().max(240),
    citations: z.array(z.number().int().positive()).min(1).max(6),
  }).nullable(),
})
```

Code resolves `date_text` → `due_at` in America/New_York relative to `started_at`. Ambiguous → `due_at_unresolved_text`, no Follow-up write.

Prompt inputs (not outputs): attachment chips, current Outreach state, official booked/cancelled flags, direction, duration, Lead initials + move cities/date/source label.

---

## 8. What the next agent should not do

- Do not re-litigate Number Activity vs Sales Opportunity, Call Qualification closure, or nudge-never-automatic.  
- Do not ask the Owner to invent webhook types — §2 is the proof.  
- Do not treat 07 as this thread. 07 is Claude Design.  
- Do not enable RingSense.  
- Do not write exploits, live secrets, or `ADMIN_SEED_*` into this file or chat.  
- Do not commit `vantage-admin/.env`.  
- Do not implement CSI-* until the Owner asks to leave grill-and-spec and start a branch.

---

## 9. Suggested opening for the next agent

> I read `08-intelligence-envelope-handoff.md`. Envelope is summary + findings + next-step suggestion. Bands stay a pure function of stored facts. Review is not a gate; you intervene and re-run. Auto-apply blast radius is leaning (due dates and wait, never suppress/book/close) but you were not sure.  
>  
> **Question 4:** When you retract or change a promise, should that Follow-up change **immediately**, or only after the model runs again?
