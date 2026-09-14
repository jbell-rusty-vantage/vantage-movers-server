# Number Activity — consolidated plan

Status: proposed revision of [recommendation-specification.md](recommendation-specification.md). Date: September 14, 2026.

The Sept 11 investigation stays the evidence base. This file is the product cut: **Number Activity and outreach potential first**, assignment and conversation intelligence second. New glossary terms stay proposed until they are reviewed into `CONTEXT.md`.

## What we are building

A searchable record of what happened on a customer phone number, whether or not that number already has a Form Lead or Call Lead. The Owner should be able to answer: **what needs outreach, why, how old is last contact, which Lead (if any) it attaches to, and how sure we are.**

This is not a second CRM. A Form Lead or Call Lead remains the only paid inbound sales record. Call Qualification remains the only path that creates a Call Lead.

## Official vs inferred

**Official today:** Form Lead, Call Lead, Duplicate Lead, Bad Lead, Form Fill, Booking, Cancellation, Call Qualification, RingCentral Inbound Number, Lead Conversation, Lead Message, Agent Allocation, `receiver_agent` as stored provenance.

**Proposed official (this cut):** Contact Number, Number Activity, Call Interaction, Number↔Lead attachment edge, Follow-up, Intelligence Finding, Rep Identity Link, Sales Assignment.

**Do not make official from inference:** a new Call Lead from all-direction history, a Booking from a transcript, a Sales Assignment from `receiver_agent`, a human conversation from `Call connected`, or “nobody called” from a missing RingCentral row.

**Rename from Sept 11:** do not ship **Sales Opportunity** as a peer of Lead. Work hangs off an eligible Lead, or off a Contact Number as a Number Review when there is no Vantage Lead.

## Four orthogonal machines

Preview buckets mixed these and that is why 382 number-only rows became 356 on screen. Keep them separate.

### 1. Contact Number classification

What kind of endpoint this is.

| State | Meaning |
| --- | --- |
| Unknown | Observed; intent not decided. Default for number-only activity. |
| Customer | Reviewed or strongly evidenced household/customer phone. |
| Company | Vantage / RingCentral owned, queue, IVR, extension. |
| Non-Customer | Vendor, spam, wrong party, other. |

Sibling attribute, not a fifth machine: contact eligibility `Allowed` / `Temporarily Blocked` / `Suppressed` / `Unknown` plus reason.

### 2. Number↔Lead attachment

One edge per (Contact Number, Lead). Phone equality is evidence, not a merge.

| State | Meaning |
| --- | --- |
| Unlinked | No Vantage Lead. Number-only history is still first-class. |
| Candidate | Unique phone/time suggestion from live, Ingested Contact Snapshot, Granot Contact Snapshot, or original caller. |
| Ambiguous | Multiple Lead candidates. No newest-wins. |
| Attached | Exact Call Lead identity, RingCentral Call Adoption, or Owner attach. |
| Rejected | Owner said this number is not that Lead. |

### 3. Outreach (the important machine)

Lives on an eligible Lead, or on a reviewed Number Review. Not on the raw number.

| State | Meaning |
| --- | --- |
| Unworked | Actionable, and no attributable outreach after the trigger (form arrival or unanswered inbound). |
| Open | Outreach started; a next action and `due_at` are required. |
| Waiting on Customer | Last meaningful contact happened; ball in their court after a reviewed promise or explicit wait. |
| Identity Review | Unsafe to work until attachment is resolved. |
| Closed | Explicit reason: booked, cancelled, lost, duplicate, bad lead, suppressed, not sales. |

Derived signals, not states: `Overdue`, `No Owner`, `Offer Pending`, `Cooldown`, `LastMeaningfulContactAt`.

Attention order: overdue promised callback → overdue first action → recent unanswered inbound → due follow-up → unassigned open → older reactivation. Identity Review never jumps the dial queue.

### 4. Conversation intelligence processing

Extend `lead_conversations`. Do not invent a parallel store.

| State | Meaning |
| --- | --- |
| Discovered | Recording or session known. |
| Media Stored | Retrievable audio in hand. |
| Complete | Redacted transcript and versioned findings published. |
| No Recording | Durable absence. |
| Unavailable | Permission, throttle, or budget. Follow-up still works. |
| Failed | Terminal processing error. |

Orthogonal contact-type signal: `Provider Connected` → `Voicemail` / `Human Conversation` / `Unknown`. A voicemail must not complete first-action.

## Scenarios → states

| Scenario | Outreach | Attachment | Number class | Conversation |
| --- | --- | --- | --- | --- |
| Form Lead stored; later Call Interaction shares the phone | Unworked until first attributable action, then Open | Candidate | Customer or Unknown | optional |
| Eligible Form Lead, no post-ingestion outbound | Unworked | Candidate or Unlinked | Customer | none |
| Eligible Form Lead, inbound only after arrival | Unworked or Open; inbound is not proof we worked it | Candidate | Customer | usually none |
| Outbound connected, decent duration, form-linked | Open | Candidate or Attached | Customer | Discovered → Complete |
| Days pass; last contact ages | Open + Overdue | unchanged | unchanged | running summary is a Finding |
| Number + Lead surfaces on the dashboard | show Outreach | show edge | show class | link if any |
| Real sales-sounding activity, no Vantage Lead | none until Owner review | Unlinked | Unknown | optional, still number-only |
| Unanswered inbound, no later outbound | Unworked | any | Unknown or Customer | usually none |
| Unmapped inbound (not a Call Lead) | not a sales queue unless Owner classifies the DID | Unlinked | Unknown | none |
| Qualified inbound with no Call Lead | ingest leak, not outreach | — | — | — |
| Ambiguous multi-lead phone | Identity Review | Ambiguous | Customer | keep on the number |
| Booked or Cancelled Lead | Closed | often Attached | Customer | coverage gap, not reopen |
| Provider-connected voicemail | still Unworked or Open | unchanged | unchanged | contact-type Voicemail |
| Human conversation, unsure next step | Open or Waiting on Customer after review | unchanged | unchanged | Complete + Finding |
| Queue fan-out / transfers | do not tick Unworked per ringing extension | — | Company vs Customer | MultiHandler |
| Wrong number / blocked / opt-out | Closed or cooldown | unchanged | maybe Non-Customer | optional suppression Finding |
| Internal nudge to a Sales Rep | notify on Unworked or Overdue | — | — | not required |

## How it functions

```
RingCentral webhooks + Call Log  →  Call Interaction
                                 →  Contact Number upsert
                                 →  Number Activity timeline (searchable)

Form Lead / Call Lead phones     →  attachment edges (Candidate / Ambiguous / Attached)

Eligible Lead or Number Review   →  Outreach state + Follow-up
Recording on a sales-relevant    →  Lead Conversation + Intelligence Finding
  connected session
```

Deep-module seams:

1. `src/services/numberActivity/` — observe sessions, search timelines. Must not import `ingestRingCentralQualifiedCall`.
2. Lead attachment edges — suggest/record links. Must not set Form Fill, Duplicate, CPL, or Booking attach.
3. Outreach gap detection — read-only review queue. “No observed outbound in this account,” never “nobody called.”

Production Call Qualification (inbound, mapped, answered, ≥120s) stays closed. All-direction capture is a second worker with its own cursor and a shared provider rate budget.

## Messaging Sales Reps

Sept 14 live proof changed the Sept 11 picture. This JWT now has `SMS`, `TeamMessaging`, `A2PSMS`, `ReadMessages`, `ReadPresence`, and `RingSense` on the token. Presence list and Team Messaging chat list return 200. The JWT User extension has one `SmsSender` DID. RingSense insights and company-wide recording permission checks are still false; ACE features were not listed on `service-info`.

Customer confirmation SMS stays a Lead Message on Twilio.

Internal “this number is going cold” nudges are a separate product command. The app authenticates as **one User extension**, so it cannot send as each Sales Rep. It can list Team Messaging chats that this JWT user belongs to, and a later explicit command can POST into a Direct or Team chat. RingCentral SMS is phone-to-phone from that one SmsSender DID, not an extension inbox.

Do not send from Number Activity as a side effect. Prove send only with an Owner-chosen test chat and copy.

## Capability proof

Run the read-only probes:

```bash
node --env-file=.env ./node_modules/tsx/dist/cli.mjs \
  scripts/dev_ops/ringcentral/ringcentral-capability-proof.ts
node --env-file=.env ./node_modules/tsx/dist/cli.mjs \
  scripts/dev_ops/ringcentral/ringcentral-messaging-readiness.ts
```

They write `scripts/dev_ops/ringcentral/output/capability-proof.json`, `.md`, and `messaging-readiness.json`. They do not send messages, create subscriptions, download audio, or write Leads.

Already-proved local prototypes stay useful: qualification funnel, number hygiene, ingest health, conversation inventory, and the Sept 11 sales-intelligence window.

## First release

Ship searchable Number Activity, conservative Lead links, Outreach Unworked/Open/Overdue, and the Owner Attention page. Transcription, assignment offers, and rep nudges wait until coverage and Rep Identity Links are honest.
