---
type: Specification
title: Daily Operations — Owner business-day board
description: >-
  Implementation-ready contract for Daily Operations: Owner-only /daily
  with a headline pulse, origin and Source Company mix, and a category
  panel grid over the America/New_York business day. Mongo is the book.
  Redis is a doorbell. After-commit Daily Operations Events are the feed.
tags:
  - daily-operations
  - owner-dashboard
  - admin-dashboard
  - granot
  - lead-messaging
status: proposed-final
stale_after: 2026-12-06
owners: [team:main-server, team:vantage-admin]
applies_to:
  - src/services/dailyOperations/**
  - src/models/DailyOperationsEvent.ts
  - src/models/DailyOperationsDay.ts
  - src/config/domain/dailyOperations.ts
  - src/routes/daily-operations-admin.routes.ts
  - src/routes/daily-operations-cron.routes.ts
  - ../vantage-admin/app/(dashboard)/daily/**
  - ../vantage-admin/components/daily/**
  - ../vantage-admin/app/api/daily-operations-live/route.ts
sources:
  - id: glossary
    resource: ../../../CONTEXT.md
    title: Platform glossary
  - id: pre-spec
    resource: ./daily-operations-pre-specification.md
    title: Pre-specification (superseded as the working contract)
  - id: workspace
    resource: ./daily-operations-workspace.md
    title: Orientation memo
  - id: lead-messaging
    resource: ../knowledge/services/lead-messaging.md
    title: Lead Messaging
  - id: live-receipts
    resource: ../knowledge/granot-lifecycle/live-receipts.md
    title: Live Events SSE
  - id: adr-0001
    resource: ../../../docs/adr/0001-mongodb-system-of-record.md
    title: MongoDB system of record
---

# Daily Operations — specification

> **Contract maturity: implementation-ready.** Product rules in this file
> win. File citations are evidence; reverify line numbers at
> implementation. Agents work from [`README.md`](README.md) →
> [`AGENT-PROTOCOL.md`](AGENT-PROTOCOL.md) → the matching issue. Do not
> start coding from chat notes, the pre-spec, or the 2026-08-19 Owner
> Daily Operations View.

**Prepared:** 2026-09-06
**Repos:** `vantage-main-server` (projection, hooks, snapshot, SSE, Redis
doorbell). `vantage-admin` (Owner `/daily` workspace).
**Owner-facing labels:** Daily Operations, Today, Leads, Form, Call,
Duplicates, Texts, Held until 8:00 AM, Granot, Intakes, Still open,
Bookings, Cancellations, Exceptions, Quiet priorities, Live
**Canonical facts:** [Daily Operations](../../../CONTEXT.md),
[Daily Operations Event](../../../CONTEXT.md),
[Daily Operations Panel](../../../CONTEXT.md),
[Lead](../../../CONTEXT.md),
[Form Lead](../../../CONTEXT.md),
[Call Lead](../../../CONTEXT.md),
[Duplicate Lead](../../../CONTEXT.md),
[Unmatched Call Lead](../../../CONTEXT.md),
[Ingestion Origin](../../../CONTEXT.md),
[Source Company](../../../CONTEXT.md),
[Lead Message](../../../CONTEXT.md),
[Granot Observation Receipt](../../../CONTEXT.md),
[Granot Booking Reconciliation Case](../../../CONTEXT.md),
[Booking](../../../CONTEXT.md),
[Cancellation](../../../CONTEXT.md),
[Job Number](../../../CONTEXT.md),
[Move Type](../../../CONTEXT.md)

**Package manager:** `pnpm@10.13.1` on the main server.

---

## 0. Authority

Read in this order. Stop and report contradictions; do not silently merge.

| Order | Authority | Wins on |
| --- | --- | --- |
| 1 | **This file** | Owner IA, panels, cards, counts, hooks, API, SSE, Redis doorbell |
| 2 | Workspace-root [`CONTEXT.md`](../../../CONTEXT.md) | Words. Do not invent synonyms |
| 3 | [`0001-mongodb-system-of-record.md`](../../../docs/adr/0001-mongodb-system-of-record.md) | Mongo remains the book |
| 4 | Current hook-point code named in §14 | Seams this pack extends; reverify before coding |
| 5 | Pack issues | Sequencing and scope only |

Where an issue and this file disagree, this file wins and the issue
author fixes the issue in the same change.

Superseded as working contracts (background only):

| File | Why it no longer wins |
| --- | --- |
| [`daily-operations-pre-specification.md`](daily-operations-pre-specification.md) | One mixed feed. This file keeps the data plane and replaces the presentation with category panels. |
| [`daily-operations-workspace.md`](daily-operations-workspace.md) | Orientation memo. Poll-only transport is obsolete. |
| [`../granot-lead-lifecycle/owner-daily-operations-view-specification.md`](../granot-lead-lifecycle/owner-daily-operations-view-specification.md) | Rolling 24h/48h tabs, conversations, agent credit, deposit. Different product. |
| [`../../../vantage-admin/uxdocs/owner-daily-view-planned.txt`](../../../vantage-admin/uxdocs/owner-daily-view-planned.txt) | Wireframes for that older product. |

Do not implement tabs, a 24h/48h window, conversations, lead cost, binder,
or deposit from those files.

---

## 1. Decision

Daily Operations is the Owner's **business-day board** at Admin `/daily`.

It answers, continuously, in `America/New_York`:

1. How is today going — counts, mix, and pace versus **yesterday at this same hour**.
2. What just happened — in the category the Owner already thinks in.
3. What needs a look — intakes Waiting for you, texts held until morning, zip that did not produce a state, failed texts, dead letters.

The Owner develops that sense by seeing **counts and changes on every category at once**, not by hunting a mixed firehose and not by flipping tabs that hide the rest of the day.

**Presentation:** one page, four bands, **one Daily Operations Panel per major category**.
**Transport:** one EventSource. One Granot stream. Client fans events into panels.

It does **not** replace:

| Desk | Stays |
| --- | --- |
| Overview (`/`) | Week pulse, all-time, short Waiting-for-you band |
| Live Events (`/live-events`) | Raw Granot receipt firehose, last 30 minutes, full payload |
| Analytics (`/analytics`) | Historical ranged business reports |
| Workflow Observational (`/observational`) | Server / integration health |
| Intakes (`/intakes`) | Confirm Granot Booking work queue |

Daily Operations **links into** intakes, leads, bookings, Job Timeline, Lead Messages, and Live Events. It does not embed Confirm Granot Booking. It does not mutate domain records.

---

## 2. Why separate panels — and why not separate pages

The question is not "one feed or many sockets." It is "how does the Owner read a day."

### 2.1 Rejected shapes

| Shape | Why it fails |
| --- | --- |
| **One mixed feed** (pre-spec) | A Cancellation or a failed text is buried under `priority_updated`. The Owner cannot see "how texts are going" without filtering away bookings. Counts live far from the facts that justify them. |
| **Tabs** (2026-08-19 ODV) | Opening Leads hides Bookings. The day is the product; a tab hides the day. Badge counts on tabs are a consolation prize. |
| **A page per category** | Fragments the New York day. Triple the chrome. The Owner cannot hold volume, work, and outcomes in one glance. |
| **A live space per Granot class** | Triple reconnect and watermark for no new information. Hides create → priority 5 → Booked on one Job Number. Locked: Granot stays **one stream**, presented as **one panel** with chips. |

### 2.2 Locked shape — category panels on one board

A **Daily Operations Panel** is a category stack on `/daily`. It is not a route and not a Live Events space.

Each panel owns:

- Today's count for that category
- Yesterday at this hour (pace)
- Session change (`+1` while the page is open)
- The last cards in that category, newest first
- The links that category actually needs

The Owner can answer, without clicking:

> 42 leads — 4 ahead of yesterday at this hour. 19 texts, 3 held until 8:00 AM. 3 intakes opened, 2 Waiting for you. 6 Bookings. 1 Cancellation. 2 zip misses.

Clicking a headline tile or a panel header **focuses** that panel (`?lane=`). Other panels collapse to a slim count rail. The day does not navigate away. `?lane=all` (default) is the command-center grid.

One socket still serves every panel. Lane and company filters apply in memory.

### 2.3 What "counts and changes" means

Every headline tile and every panel header shows the same four numbers when they exist:

| Number | Meaning |
| --- | --- |
| `today` | Running New York-day total |
| `yesterday_by_now` | Sum of yesterday's hourly buckets `0..currentNyHour` |
| `pace` | `today − yesterday_by_now` (ahead / behind / even) |
| `session_delta` | Change since this tab opened, derived from SSE `metric_touches` |

`yesterday` (closed full day) is available on hover / secondary line. Pace is the comparison the Owner uses at 2:14pm. End-of-day yesterday versus a half-finished today always looks like a miss.

v1 does **not** show lead cost, binder, or deposit. Those stay on Analytics.

---

## 3. Product surfaces

### 3.1 Admin route and chrome

- **Route:** Owner-only `/daily`
- **Nav:** Today group, after Overview, before Live Events
- **Label:** Daily Operations
- **Icon:** reuse a calendar / sun-style Lucide icon already in the set; do not add a New badge
- **Auth:** add `/daily` to `OWNER_ONLY_PAGE_PREFIXES` (`server/auth/authorization.ts`), `ownerOnlyPagePrefixes` (`dashboard-shell.tsx`), and `dashboard-nav.tsx` (`ownerOnly: true`). Do not "fix" other prefix drift in the same change.
- **Proxy:** `/api/v1/admin/daily-operations` Owner-only on every method (same dual gate as Live Events / conversations)
- **URL:** `/daily?lane=<lane>&company=<slug>&open=<kind>:<id>`
- **Timezone display:** `America/New_York` via existing `lib/floridaTime.ts`

Owner nav order after this pack:

`Overview → Daily Operations → Live Events → Lead Conversations → …`

Non-owners: no sidebar item, page blocked, live BFF 403.

### 3.2 Layout — four bands, one workspace

```
┌──────────────────────────────────────────────────────────────────┐
│ Daily Operations     Sat Sep 6 · America/New_York · ● Live       │
├──────────────────────────────────────────────────────────────────┤
│ HEADLINE — how the day is going                                  │
│  42 Leads +4    28 Form / 14 Call    4 Dup    6 Book +2          │
│  1 Cancel       19 Texts · 3 held    55 Granot    3 Intakes (2)  │
├──────────────────────────────────────────────────────────────────┤
│ ORIGINS                         │ SOURCE COMPANIES               │
│ Granot lead created  20         │ Top 10 Forms     17  +2        │
│ RingCentral          14         │ TBM Leads         9  −1        │
│ Best Relocation       6         │ Best Relocation   6   0        │
│ Vantage Admin         2         │ main site         4  +1        │
│ WordPress form        0         │ … zeros remain visible         │
├──────────────────────────────────────────────────────────────────┤
│ PANELS  [Quiet priorities]           company filter from row     │
│ ┌─ Leads 42 +4 ──┐ ┌─ Texts 19 ──┐ ┌─ Granot 55 ──┐ ┌─ Intakes ─┐│
│ │ 2:13 Call …    │ │ 2:12 Held   │ │ 2:14 Booked  │ │ 2:14 open ││
│ │ 2:11 Form …    │ │ 2:11 Sent   │ │ 2:11 minted  │ │ 1:02 open ││
│ └────────────────┘ └─────────────┘ └──────────────┘ └───────────┘│
│ ┌─ Bookings 6 ───┐ ┌─ Cancels 1 ─┐ ┌─ Exceptions 2 ─────────────┐ │
│ │ 2:10 written   │ │ 1:44 written│ │ ZIP 33101 · state not found│ │
│ └────────────────┘ └─────────────┘ └────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────┘
```

Focus (`?lane=lead`):

```
┌─ count rail: Texts 19 · Granot 55 · Intakes 3 · Book 6 · … ─┐
│ LEADS                                          42  +4 vs 2pm │
│ 2:13  Call Lead · Maria Chen · Top 10 · RingCentral  [Open]  │
│ 2:11  Form Lead · … · ZIP 33101 · state not found    [Open]  │
└──────────────────────────────────────────────────────────────┘
```

Clicking a company row sets `?company=` and filters every panel. Clicking
the row again (or Clear) removes the filter. The company table highlights
the selected row.

`?open=` is a Daily Operations alias that **maps onto desks that
already exist**. Do not fork a second drawer. Confirm work stays on
`/intakes?case=` (that route **replaces** the list — it is not a
SidePanel). Lead / Booking / Cancellation open the existing
`SidePanel` via `/form-leads?record=` (and siblings). Extend
`max-w-3xl` on that one component if a card needs it.

### 3.3 Live chrome

| State | Owner copy |
| --- | --- |
| Connected | `● Live` |
| Hidden tab | `◌ Paused` — EventSource may stay open; do not blank tiles |
| Native reconnect | `⚠ Reconnecting…` showing data from `{last good Eastern time}` |
| Failed | `○ Live off` + Retry |

A board that silently stops updating is worse than one that never claimed to.
Never blank a populated panel because a poll failed. Keep the last good
snapshot.

---

## 4. Look and feel

Daily Operations must feel like the rest of the Owner dashboard — steel,
trust-blue, navy, muted labels — and **denser** than Overview. Overview is
a weekly pulse. This page is a live day.

### 4.1 Visual language

| Token | Use |
| --- | --- |
| `text-xs font-medium uppercase tracking-wide text-muted-foreground` | Tile and panel labels (same as Overview `MetricCard`) |
| `font-semibold tabular-nums text-3xl` (tiles) / `text-2xl` (panel headers) | Today's count |
| `text-xs tabular-nums text-muted-foreground` | Eastern time on cards (`h:mm a`) |
| `bg-trust-blue` | Pace bar / company share, same as Overview agent bars |
| `text-emerald-700` / muted red | Ahead / behind chips. Even is muted, not green. |
| `bg-amber-50` + amber chip | Exceptions panel when `today > 0`; zip-miss chip; held-text chip |
| `bg-destructive/10` | Failed text, dead letter, CRM fail |
| 1.5s highlight on insert | New card only. Existing cards never reorder. |
| `session_delta` flash | `+1` on the tile and the panel header for ~2s |

Reuse `Card`, `StatusBadge` / existing chips, `FeedbackMessage`,
`floridaTime`, `SOURCE_COMPANY_LABELS`. Do not invent a second design
system. 21st.dev may craft the named shells in DOP-06 and DOP-07 only;
it must not invent endpoints or a second drawer.

### 4.2 Density

- Headline: one row on `xl`, wrap on smaller. No money.
- Panels: CSS grid `xl:grid-cols-2 2xl:grid-cols-3`. Exceptions span
  full width when focused.
- Default cards visible per panel: **8**. Focused panel: **40**, then
  "Load earlier" against `GET .../events`.
- Card title is one Owner sentence. Second line is identity + chips.
  Third line is links. No raw JSON. No Granot payload accordion
  (that is Live Events).

### 4.3 Names and contact

Show the customer **name the Owner already uses to recognize a booking**.
Mask phone to last four on the card (`••4192`). Full contact lives in
the existing SidePanel / record desk, Owner-only.

Do not store a full Granot payload or `granot_statement` on the Daily
Operations Event. `title` may include a first name the Owner already
sees on desks.

### 4.4 Copy module

Owner-visible strings live in `vantage-admin/components/daily/daily-copy.ts`.
Do not scatter "Quiet priorities" / "Held until 8:00 AM" / "state not
found" as magic strings across components.

---

## 5. Headline tiles

| Tile | Counts | Excludes |
| --- | --- | --- |
| Leads today | Non-duplicate Form Leads + non-duplicate Call Leads created on the NY day | Duplicate Leads; Unmatched Call Leads |
| Form / Call split | Same, by Lead kind | Same |
| Duplicates | Duplicate Form + Duplicate Call created today | Not in the headline Lead tile |
| Bookings today | Official Booking **writes** today | Duplicate submission ignored; `book_date` is display only |
| Cancellations today | Official Cancellation **writes** today | `cancel_date` is display only |
| Texts sent | Lead Messages in `accepted` (immediate) \| `sent` \| `delivered` | Pending / queued; skipped; failed; **quiet-hours held** (own chip) |
| Texts held | Lead Messages scheduled by quiet hours and not yet `sent`/`delivered` | Immediate sends |
| Granot receipts | Webhook-channel receipts captured today | Extension / HTTP-automation receipts |
| Intakes | Cases **opened** today, plus **Waiting for you** (live open-case query) | Refreshes (panel only) |

Each tile shows `today`, `yesterday_by_now`, pace chip, and session
delta. Clicking the tile focuses the matching panel (`?lane=`).

Granot tile secondary line: `lead_created` · `priority_updated` ·
Booked / Release. Intakes secondary line: `{opened} opened · {still_open}
Waiting for you`. Use the Overview / Intakes Owner label **Waiting for
you**, not “open” or “still open,” on the board. `still_open` remains
the snapshot field name.

---

## 6. Origins and Source Companies

### 6.1 Ingestion Origin (Lead writes only)

`wordpress_form` | `ringcentral` | `granot_lead_created` |
`best_relocation_sheet` | `vantage_admin`

Owner labels:

| Slug | Label |
| --- | --- |
| `granot_lead_created` | Granot lead created |
| `ringcentral` | RingCentral |
| `best_relocation_sheet` | Best Relocation |
| `vantage_admin` | Vantage Admin |
| `wordpress_form` | WordPress form |

`wordpress_form` may be **zero** while partner WordPress posts to Granot.
That is correct and useful. Volume then sits under `granot_lead_created`
and the Granot panel's `lead_created` chip.

### 6.2 Source Company

Every catalog slug from `SOURCE_COMPANIES` that Daily Operations counts
as a Lead attribution owner:

`tbm_leads`, `tbm_prime_leads`, `top10_leads`, `best_relocation_leads`,
`get_movers_leads`, `main_site`, `paid_overflow`, `not_provided`.

Use `SOURCE_COMPANY_LABELS` on the board (`Top 10 Forms`, `TBM Leads`,
…). Zeros remain so a silent partner is visible. Form / Call split
inside each company. Each row shows `today`, `yesterday_total`, and a
share bar.

Referral is a Booking kind, not a Lead Source Company row on this board.

---

## 7. Daily Operations Panels

Default `?lane=all` shows every **on-by-default** panel. Sheet Sync is
off until the Owner opts in (local preference + URL `lane=sheet_sync`).

| Panel | Lane | Default | Header counts |
| --- | --- | --- | --- |
| Leads | `lead` | On | Non-duplicate Form + Call; Form/Call split; duplicate chip |
| Texts | `text` | On | Sent; held until 8:00 AM; skipped; failed |
| Granot | `granot` | On | Receipts by class; minted / linked / observed |
| Intakes | `intake` | On | Opened today; Waiting for you (query) |
| Bookings | `booking` | On | Official writes; kind chips |
| Cancellations | `cancellation` | On | Official writes |
| Exceptions | `exception` | On | Zip miss, CRM fail, dead letter, adoption conflict |
| Sheet Sync | `sheet_sync` | Off | Completed / failed jobs — progress only |

### 7.1 Granot panel chips (not separate pages)

Lead created · Priority updated · Booked · Release.

**Quiet priorities:** Owner control that hides `granot.priority_updated`
cards in the Granot panel (and in focus). Counts still include them.
Persist the control in `localStorage` (`vantage-admin-daily-quiet-priorities`)
and mirror it on the URL as `quiet_priorities=1` when on. This is the
pressure valve for high-volume, low-action Priority Updates.

A `lead_created` receipt and its processor outcome are **paired** by
`parent_receipt_id`. The Granot panel groups them (receipt, then minted
/ linked / observed).

### 7.2 Intakes panel

`opened` comes from the day document. **Still open** is
`countDocuments` on Granot Booking Reconciliation Cases with
`state: "open"` (same list Overview already uses). Do not store
open/closed as a day increment.

Card action: `/intakes?case=` when `intake_link` exists. Daily
Operations does not confirm.

### 7.3 Empty and loading

| State | Copy |
| --- | --- |
| First paint | Skeleton tiles and panel bodies (Overview pattern) |
| Open day, no facts yet | Panel: `Nothing in this category yet today.` Board keeps tiles at 0. |
| Filtered empty | `No {category} for {company label} today.` |
| Missing yesterday | Pace shows `—` until the first close cron or a one-shot rebuild |

An empty Exceptions panel stays visible and reads
`No exceptions so far today.` An absent Exceptions panel reads as a bug.

---

## 8. Cards — useful facts and links

Cards are Daily Operations Events. Each card is one Owner sentence plus
the facts that make the next click obvious.

### 8.1 Shared card shell

```
{h:mm a}   {title}
           {name} · {Source Company label} · {origin or kind chip}
           {useful fact chips}
           {links}
```

Time is America/New_York via `floridaTime`. Client keys on `event_id`.
A retried SSE replaces rather than appends.

### 8.2 Card payload (stored on the event, small)

```ts
type DailyOperationsCard = {
  customer_name?: string | null;
  phone_last4?: string | null;
  job_no?: string | null;
  move?: {
    pickup_zip?: string | null;
    pickup_state?: string | null;
    delivery_zip?: string | null;
    delivery_state?: string | null;
    move_type?: "local" | "long_distance" | null;
  };
  zip_miss?: {
    pickup: boolean;
    delivery: boolean;
  };
  text?: {
    purpose?: "quote_request_confirmation" | "granot_create_confirmation" | string;
    status: string;
    deferred: boolean;
    send_at?: string | null;          // ISO of 8:00 AM Eastern when held
    skip_reason?: string | null;
  };
  granot?: {
    route_event_class?: string;
    booking_action?: "booked" | "release" | null;
    decision?: string | null;
  };
  booking_kind?: string | null;
  exception?: {
    code: string;
    detail: string;
  };
};
```

No contact PII beyond name + last four. No message body. No raw receipt.

### 8.3 Actions (reads only)

| Card | Actions |
| --- | --- |
| Form / Call Lead | Open lead SidePanel (`?open=lead:<id>`); "Open list" → `/form-leads?record=` or `/call-leads?record=` |
| Duplicate Lead | Same, on the duplicate list |
| Granot receipt | Open payload SidePanel; **"Open in Live Events"** → `/live-events` (existing stream; do not embed the accordion) |
| Booked / Release | `/intakes?case=` when `intake_link` exists |
| Job Number present | `/job-timeline?job=` |
| Booking / Cancellation | Open record SidePanel; list `?record=` |
| Lead Message | Open lead; optional `/form-leads?record=&panel=message` when the operational panel exists |
| Exception zip miss | Open the Lead |
| Dead letter | Observational or Granot Lifecycle Health — link, do not repair here |

No mutations from Daily Operations.

### 8.4 Lead Message — quiet hours (compelling detail)

Quiet hours are already implemented
(`src/services/leadMessaging/quietHours.ts`,
[`lead-messaging.md`](../knowledge/services/lead-messaging.md)):

| Fact | Value |
| --- | --- |
| Timezone | `America/New_York` |
| Hold window | 12:00:00 AM inclusive through 7:00:00 AM exclusive (midnight–6:59:59) |
| Send-at | **8:00 AM** that same Eastern calendar day |
| Gate | `LEAD_MESSAGING_QUIET_HOURS_ENABLED=true` (off unless explicit) |
| Mechanism | Twilio Message Scheduling `sendAt`. Not a cron. Not `next_attempt_at`. |
| 7:00 AM and later | Send immediately |

The times may change later (`LEAD_SMS_QUIET_HOUR_END`,
`LEAD_SMS_DEFERRED_SEND_HOUR`). Cards must render the **resolved**
`send_at`, not a hardcoded sentence that cannot survive a constant
change. Default Owner copy when `send_at` is 8:00 AM Eastern:

> Text held until 8:00 AM

When `send_at` is some other Eastern wall time:

> Text held until {h:mm a}

The Lead Message **row has no `deferred` status and no `send_at`
field.** Twilio create still happens immediately. Persist is
`status: accepted` and usually `provider_status: "scheduled"`. The
UTC send-at is available at dispatch (`buildLeadMessageTwilioSendInput`
→ `sendAt`) and on the Operational Event `lead_message.accepted`
as `scheduled_send_at`. Daily Operations must **copy `send_at` onto
the event `card`** at hook time. Do not expect to read it back from
`lead_messages`.

**Two facts, one Lead Message row:**

1. `text.deferred` — dispatch applied a quiet-hours `sendAt`.
   Increments `messages.deferred`. Does **not** increment
   `messages.successful`. Card: purpose, Source Company, name, "Held
   until {time}", link to the Lead. Phone last-four is masked in the
   card from `to` / the Lead — it is not a stored field.
2. `text.sent` — first transition into `{accepted, sent, delivered}`
   **without** a quiet-hours `sendAt`, **or** first `sent`/`delivered`
   after a deferred accept. Increments `messages.successful` once
   (`dedupe_key` `message:<id>:successful`).

A 2:14 AM confirmation therefore shows in the Texts panel as held, and
the Texts tile shows a held chip. At 8:00 AM the sent card appears.

`held_now` is a **live query** of Lead Messages still
`provider_status: "scheduled"` and `status: "accepted"` (not yet
`sent` / `delivered` / `failed` / `undelivered`). Do not query a
`sendAt` column — it does not exist. `messages.deferred` stays the
day increment (held at some point today). Source Company on a
public-form Lead Message is not stored on the row — join the Lead.

Headline "Texts sent" is successful only. Panel header:

`{successful} sent · {held_now} held until 8:00 AM · {failed} failed`

`text.skipped` and `text.failed` stay their own cards. Skipped reasons
the Owner should see: `duplicate_lead`, `messaging_disabled`, no consent
(no row today — do not invent a card), `invalid_destination`.

Do not hook `persistLeadMessageIntent` (mid-transaction).

### 8.5 Zip did not produce a state (compelling detail)

Form Lead Ingestion always persists a state. When zip lookup and the
caller-supplied state are both missing, the Lead stores
`FORM_LEAD_UNKNOWN_STATE` (`not_found`) and Observational records
`zip_state.lookup.missing`
(`src/services/leads/leadLocation.service.ts`). `deriveFormLeadLocal`
then forces **`long_distance`**. Move Type is stored and complete as
an enum; it may be **wrong** (two unknown states are not treated as
local). That is what the Owner needs to see.

Call Leads use `resolveOptionalLocation`: a zip with no state stays
**blank** (not `not_found`) and emits
`zip_state.optional_lookup.missing`. Count that as a zip miss when a
zip was present.

Granot Form mint **requires valid USPS states + 5-digit ZIPs** or the
Decision is `insufficient_creation_data` — do not expect a minted
Form Lead with `not_found`. Call Job-only mint may be sparse; only
emit `exception.zip_missing` when a zip is present and state is
missing.

Daily Operations must not hide this on Observational. There is no
Owner zip-miss chip on Form Lead detail today.

| Surface | What the Owner sees |
| --- | --- |
| Lead card | Chip `ZIP {code} · state not found` for pickup and/or delivery. Link opens the Lead. |
| Exceptions panel | `exception.zip_missing` card: which zip(s), Lead name, Source Company, Open lead. |
| Counts | Exception chip only. Do **not** exclude the Lead from the headline Lead tile. The Lead is real; the geography is incomplete. |

Maps fallback failures (`zip_state.google_maps.failed` /
`.unavailable`) stay Observational unless they caused a Form
`not_found` (or a Call blank state with a zip) on a Lead written
today — then the zip-miss card is enough.

### 8.6 Kind → panel → title (Owner sentences)

| kind | Panel | Title pattern |
| --- | --- | --- |
| `form_lead.created` | Leads | `Form Lead created` |
| `form_lead.duplicate` | Leads | `Duplicate Form Lead` |
| `call_lead.created` | Leads | `Call Lead created` |
| `call_lead.duplicate` | Leads | `Duplicate Call Lead` |
| `call_lead.unmatched` | Leads | `Unmatched Call Lead` (not in headline) |
| `granot.lead_created` | Granot | `Granot lead created` |
| `granot.priority_updated` | Granot | `Granot priority updated` |
| `granot.booked` | Granot | `Granot Booked` |
| `granot.release` | Granot | `Granot Release` |
| `granot.minted` | Granot | `Created a Lead from Granot` |
| `granot.linked` | Granot | `Linked to existing Lead` |
| `granot.observed` | Granot | `Observing only` |
| `granot.pending_match` | Granot | `Waiting to match` |
| `granot.unmatched` | Granot | `No matching Lead` |
| `intake.opened` | Intakes | `Intake opened` |
| `intake.refreshed` | Intakes | `Intake refreshed` |
| `text.deferred` | Texts | `Text held until {time}` |
| `text.sent` | Texts | `Text sent` |
| `text.skipped` | Texts | `Text skipped` |
| `text.failed` | Texts | `Text failed` |
| `booking.created` | Bookings | `Booking written` |
| `booking.employee_pending` | Bookings | `Employee Booking — pending Lead` |
| `cancellation.created` | Cancellations | `Cancellation written` |
| `sheet_sync.completed` | Sheet Sync | `Sheet Sync completed` |
| `sheet_sync.failed` | Sheet Sync | `Sheet Sync failed` |
| `exception.zip_missing` | Exceptions | `ZIP did not produce a state` |
| `exception.crm_failed` | Exceptions | `CRM Posting failed` |
| `exception.dead_letter` | Exceptions | `Granot dead letter` |
| `exception.adoption_conflict` | Exceptions | `RingCentral adoption conflict` |

---

## 9. Calendar

**Today is the America/New_York business day.**

Helpers already in `src/utils/easternTime.ts`:

| Need | Helper |
| --- | --- |
| Day key `"YYYY-MM-DD"` from an instant | `floridaCalendarDateInputValue(now)` |
| UTC-midnight Date of that NY day | `floridaCalendarToday(now)` |
| Hour 0–23 in Eastern | `easternDateTimeParts(now).hour` |

| Fact | Binds on |
| --- | --- |
| Form / Call Lead | Lead `timestamp` (already Eastern wall-clock) |
| Granot receipt | `captured_at` |
| Lead Message | Time the terminal or deferred status was applied |
| Booking / Cancellation on this board | **Write time** (`createdAt` / command `now`), not `book_date` / `cancel_date` |
| Intake opened | Case `createdAt` |
| Day document key | NY calendar of `occurred_at` |

Yesterday comparison uses the **closed** previous NY day. After New York
midnight, a cron sets `status: "closed"` and writers must not `$inc` it.
Late facts land on the open day of their `occurred_at`. If that day's
doc is closed, skip `$inc` and set `metric_touches: []` (feed still
shows the late card; tiles stay stable).

Pace: `sum(today.hourly[0..nowHour])` vs `sum(yesterday.hourly[0..nowHour])`.

Live Events remains a rolling 30-minute window. Daily Operations is a
**calendar day**.

---

## 10. Architecture

MongoDB remains the system of record
([ADR-0001](../../../docs/adr/0001-mongodb-system-of-record.md)). Redis
is a **doorbell and short replay buffer**, not the book.

```
Domain commit (Lead / receipt / Booking / …)
        │
        ▼
 recordDailyOperationsFact()     ← after-commit only, never throws
        │
        ├─ insert Daily Operations Event (unique dedupe_key)
        ├─ $inc Daily Operations Day (only if insert won)
        └─ Redis XADD (+ optional PUBLISH)   ← best-effort doorbell
                │
                ▼
 Owner EventSource ──BFF──► GET .../daily-operations/live
                │
                ├─ snapshot from Mongo (tiles + recent events)
                └─ tail Redis stream; on miss, tail Mongo
```

Vercel isolates do not share memory. The webhook handler cannot emit
into the Owner socket. That is why Live Events already polls Mongo
behind SSE. Daily Operations keeps the **browser** event-driven
(`EventSource`) and uses Redis so the open SSE isolate notices a write
without scanning four domain collections.

If Redis is unset, errors, or the test runner is active, the live route
**degrades** to Mongo-tail of `daily_operations_events` (same pattern as
`runLiveReceiptSse`). Counts still exist because they live in Mongo.

### 10.1 Why Redis is here

| Job | Store |
| --- | --- |
| Remember the fact | Mongo Daily Operations Event |
| Remember today's totals | Mongo Daily Operations Day |
| Wake the open SSE isolate | Upstash Redis Stream `XADD` |
| Catch up after reconnect | Mongo snapshot + `Last-Event-ID`; Redis stream is a short replay only |

Do **not** use Redis `INCR` as the Owner-visible total. Dual-write
counters drift. `$inc` the Mongo day document; Redis only rings the bell.

Do **not** `GET` / `XREAD` Redis once per second as a substitute for
domain queries if the stream is empty — that is the command-cost trap.
`XREAD COUNT 25` on the day stream when idle is one cheap command per
poll; that is acceptable (§11.6). Do not `XREAD BLOCK` for the full
`maxDuration` over REST.

---

## 11. Upstash Redis

### 11.1 Client

Install on **vantage-main-server** only:

```bash
pnpm add @upstash/redis
```

`Redis.fromEnv()` reads `UPSTASH_REDIS_REST_URL` and
`UPSTASH_REDIS_REST_TOKEN`. The Vercel Marketplace integration injects
the **KV_*** names already in `.env`. Construct the client so both work.

`src/config/domain/dailyOperations.ts` (call-time env, same as Twilio /
queues):

```ts
import { Redis } from "@upstash/redis";

export function getDailyOperationsRedis(): Redis | null {
  const url =
    process.env.UPSTASH_REDIS_REST_URL?.trim() ||
    process.env.KV_REST_API_URL?.trim() ||
    "";
  const token =
    process.env.UPSTASH_REDIS_REST_TOKEN?.trim() ||
    process.env.KV_REST_API_TOKEN?.trim() ||
    "";
  if (!url || !token) return null;
  return new Redis({ url, token });
}
```

| Variable | Use |
| --- | --- |
| `UPSTASH_REDIS_REST_URL` / `UPSTASH_REDIS_REST_TOKEN` | Canonical `@upstash/redis` names |
| `KV_REST_API_URL` / `KV_REST_API_TOKEN` | Vercel Marketplace aliases (already in local `.env`) |
| `KV_REST_API_READ_ONLY_TOKEN` | Do not use for publish |
| `KV_URL` / `REDIS_URL` | TCP `rediss://`. **Do not use** with `@upstash/redis` on Vercel Functions |

Never log tokens. Never commit `.env`.

### 11.2 Publish gate

Mirror queue gates (`shouldPublishGranotLifecycleQueue`):

- Test runner / `TEST_MODE=true` → **no Redis writes**
- Missing URL/token → no Redis writes (Mongo-only)
- Production Vercel and local Owner watch → Redis writes allowed when configured

Local `pnpm dev:local` **should** publish if KV_* are set, so `/daily`
can prove the doorbell. That differs from Granot Queue (prod-only).
Redis doorbell is safe on free tier; a Vercel Queue publish from a
laptop is not.

### 11.3 Keys

Prefix every key with environment so local / preview / production never
collide.

```
dailyops:{env}:stream:{day}     Redis Stream of wake envelopes
dailyops:{env}:wake             Pub/sub channel (optional, same payload)
```

`env` = `VERCEL_ENV` (`production` | `preview`) or `local`.
`day` = `YYYY-MM-DD` America/New_York.

### 11.4 Stream envelope (small)

`XADD dailyops:{env}:stream:{day} MAXLEN ~ 2000 *`

| Field | Value |
| --- | --- |
| `event_id` | Daily Operations Event `_id` hex |
| `day` | `YYYY-MM-DD` |
| `kind` | closed catalog kind |
| `lane` | lane id |
| `occurred_at` | ISO |
| `dedupe_key` | stable key |

No contact PII on the Redis payload. The SSE isolate loads the full
card from Mongo by `event_id`.

`MAXLEN ~ 2000` keeps a few hours of doorbells, not the business day
archive. Mongo is the archive.

Optional: `PUBLISH dailyops:{env}:wake` with the same JSON. Classic
Redis `SUBSCRIBE` is **not** available on the Upstash REST client. Do
not build the live route on TCP subscribe. The Stream is the contract;
PUBLISH is unused in v1.

### 11.5 Live isolate algorithm

Copy `runLiveReceiptSse`
(`src/services/granotLifecycle/liveReceiptStream.ts`): inject `write`,
`sleep`, `now`, `signal`; `maxMs = 240_000`; heartbeat 15s; abort on
`req.close`.

1. Snapshot from Mongo: today's day document + last N events (default
   80, NY day). Lane filter from query is **not** applied server-side —
   filter on the client so one socket serves all panels.
2. Remember Redis stream ID `"0-0"` or the last `XADD` id stored on the
   newest event (`redis_stream_id`) / `Last-Event-ID` decode.
3. Loop until max duration:
   - If Redis client exists: `XREAD COUNT 25 STREAMS dailyops:{env}:stream:{day} lastId`
   - For each envelope, `find` the Mongo event by `event_id` (skip if
     missing — replica lag: retry next loop)
   - Emit SSE `event` with `id: encodeDailyOpsEventId({ occurred_at, event_id })`
   - Emit SSE `metrics` when `metric_touches` is present
   - If Redis is null or throws: `listDailyOperationsEventsAfter(cursor)`
     on Mongo (same `$or` captured_at / `_id` pattern as live receipts)
   - Heartbeat
   - `sleep(1000)`

`Last-Event-ID` format: `{occurred_at_iso}:{event_id}` using
`lastIndexOf(":")` (ISO contains colons). Reconnect skips snapshot when
the header is valid — same as Live Events.

### 11.6 Cost discipline (free tier)

Upstash free: 500,000 commands / month, 256 MB.

| Pattern | Commands if Owner watches 8 hours/day × 22 days |
| --- | --- |
| `XADD` once per counted fact (~2,000 facts/month) | ~2,000 |
| Live `XREAD COUNT` once per second while tab open | ~28,800 / month / tab |
| `GET` of four Mongo collections every second | Not a Redis cost; do not do this |
| `XREAD BLOCK 240000` over REST | Avoid |

Expected bill for this doorbell: **$0 on free tier**. The failure mode
is turning Redis into a 1 Hz cache poll of large keys.

Do not give the Admin BFF Redis credentials. The BFF only pipes SSE
from the main server.

---

## 12. Mongo models

New module: `src/services/dailyOperations/`
New models: `src/models/DailyOperationsEvent.ts`,
`src/models/DailyOperationsDay.ts`

Follow the **observability factory** (`getObservabilityModel`):
`useDb(getMongoDatabaseName())`, registration `Model__${collectionName}`,
explicit collection name. Do **not** use the lead-model pattern (fixed
collection, db switch only) if we want test collections isolated.

| Key | Production | Test |
| --- | --- | --- |
| events | `daily_operations_events` | `test_daily_operations_events` |
| days | `daily_operations_days` | `test_daily_operations_days` |

Mode: reuse `TEST_MODE` / test runner, same spirit as observability.

### 12.1 Daily Operations Event

Closed Owner catalog. Not an Operational Event.

```ts
type DailyOperationsEventDocument = {
  _id: ObjectId;
  day: string;                    // YYYY-MM-DD America/New_York
  occurred_at: Date;
  lane:
    | "granot"
    | "lead"
    | "text"
    | "intake"
    | "booking"
    | "cancellation"
    | "sheet_sync"
    | "exception";
  kind: DailyOperationsKind;      // §13
  title: string;
  source_company: string | null;
  ingestion_origin: string | null;
  lead_kind: "form" | "call" | null;
  job_no: string | null;
  entity_type: string | null;
  entity_id: string | null;
  parent_receipt_id: string | null;
  links: {
    lead_id?: string;
    lead_model?: "FormLead" | "CallLead";
    booking_id?: string;
    cancellation_id?: string;
    intake_case_id?: string;
    receipt_id?: string;
    message_id?: string;
  };
  card: DailyOperationsCard;      // §8.2
  metric_touches: string[];
  dedupe_key: string;             // unique
  redis_stream_id: string | null;
  createdAt: Date;
  updatedAt: Date;
};
```

**Indexes:**

```
{ dedupe_key: 1 }                    unique
{ day: 1, occurred_at: -1, _id: -1 }
{ day: 1, lane: 1, occurred_at: -1 }
{ parent_receipt_id: 1, occurred_at: 1 }
{ entity_type: 1, entity_id: 1 }
```

### 12.2 Daily Operations Day

One document per NY calendar day.

```ts
type DailyOperationsDayDocument = {
  _id: ObjectId;
  day: string;
  timezone: "America/New_York";
  status: "open" | "closed";
  closed_at: Date | null;
  revision: number;

  leads: {
    total: number;
    form: number;
    call: number;
    duplicate_form: number;
    duplicate_call: number;
    unmatched_call: number;
  };

  origins: {
    wordpress_form: number;
    ringcentral: number;
    granot_lead_created: number;
    best_relocation_sheet: number;
    vantage_admin: number;
  };

  companies: Record<string, { form: number; call: number; total: number }>;

  webhooks: {
    lead_created: number;
    priority_updated: number;
    booking_status_changed: number;
    booked: number;
    release: number;
  };

  decisions: {
    minted: number;
    linked: number;
    observed: number;
    pending_match: number;
    unmatched: number;
  };

  messages: {
    successful: number;
    deferred: number;
    skipped: number;
    failed: number;
  };

  bookings: {
    total: number;
    granot_confirm: number;
    employee_linked: number;
    employee_pending: number;
    admin: number;
    leadless: number;
    referral: number;
  };

  cancellations: { total: number };

  intakes: { opened: number; refreshed: number };

  exceptions: {
    zip_missing: number;
    crm_failed: number;
    dead_letter: number;
    adoption_conflict: number;
  };

  hourly: Array<{
    hour: number;
    leads: number;
    bookings: number;
    cancellations: number;
    webhooks: number;
    messages: number;
  }>;

  createdAt: Date;
  updatedAt: Date;
};
```

**Indexes:** `{ day: 1 }` unique. `{ status: 1, day: -1 }`.

`hourly` is a 24-element array, pre-seeded on first upsert
(`hour: 0..23`, zeros). Increment with dotted paths, including
`hourly.{nyHour}.leads` and `revision`.

Seed known Source Company slugs on first insert so GET always includes
zeros.

Closed days: cron shortly after 00:05 America/New_York.
`updateOne({ day, status: "open" }, { $set: { status: "closed", closed_at } })`.

### 12.3 Writer: `recordDailyOperationsFact`

`src/services/dailyOperations/recordDailyOperationsFact.ts`

Behavior copied from `recordOperationalEvent`: **awaited after commit,
never throws, never changes the domain write.**

```
1. Build dedupe_key and day from occurred_at
2. insertOne event
   - duplicate key → return (no increment, no Redis)
3. upsert + $inc the open day document for those metric_touches
4. best-effort Redis XADD; store redis_stream_id if we want
5. log Redis failures via pino; do not emit Operational Incidents for doorbell misses
```

Callers pass a typed input (`kind`, identities, `card`, `metric_touches`).
They do not talk to Redis themselves.

---

## 13. Closed kind catalog

| kind | lane | Headline / day increment |
| --- | --- | --- |
| `form_lead.created` | lead | `leads.form`, `leads.total`, origin, company.form, hourly.leads |
| `form_lead.duplicate` | lead | `leads.duplicate_form` only |
| `call_lead.created` | lead | `leads.call`, `leads.total`, origin, company.call, hourly.leads |
| `call_lead.duplicate` | lead | `leads.duplicate_call` only |
| `call_lead.unmatched` | lead | `leads.unmatched_call` only (not in headline) |
| `granot.lead_created` | granot | `webhooks.lead_created`, hourly.webhooks |
| `granot.priority_updated` | granot | `webhooks.priority_updated`, hourly.webhooks |
| `granot.booked` | granot | `webhooks.booking_status_changed`, `webhooks.booked`, hourly.webhooks |
| `granot.release` | granot | `webhooks.booking_status_changed`, `webhooks.release`, hourly.webhooks |
| `granot.minted` | granot | `decisions.minted` — **not** `leads.*` |
| `granot.linked` | granot | `decisions.linked` |
| `granot.observed` | granot | `decisions.observed` |
| `granot.pending_match` | granot | `decisions.pending_match` |
| `granot.unmatched` | granot | `decisions.unmatched` |
| `intake.opened` | intake | `intakes.opened` |
| `intake.refreshed` | intake | `intakes.refreshed` |
| `text.deferred` | text | `messages.deferred` only |
| `text.sent` | text | `messages.successful`, hourly.messages |
| `text.skipped` | text | `messages.skipped` |
| `text.failed` | text | `messages.failed` |
| `booking.created` | booking | `bookings.total` + kind bucket, hourly.bookings |
| `booking.employee_pending` | booking | `bookings.total`, `bookings.employee_pending`, hourly.bookings |
| `cancellation.created` | cancellation | `cancellations.total`, hourly.cancellations |
| `sheet_sync.completed` | sheet_sync | none |
| `sheet_sync.failed` | sheet_sync | none |
| `exception.zip_missing` | exception | `exceptions.zip_missing` |
| `exception.crm_failed` | exception | `exceptions.crm_failed` |
| `exception.dead_letter` | exception | `exceptions.dead_letter` |
| `exception.adoption_conflict` | exception | `exceptions.adoption_conflict` |

**Granot mint vs Lead create:** a `create_if_missing` Decision writes a
Lead through `createLeadFromGranot` `finalize`. That finalize records
`form_lead.created` or `call_lead.created` with
`ingestion_origin: granot_lead_created`. The processor also records
`granot.minted` (decision count only). Do **not** increment `leads.*`
from `granot.minted`.

**Receipt vs outcome:** capture records `granot.lead_created` (receipt
count). Processor records `granot.minted|linked|observed|…`. Two cards,
two increments, paired by `parent_receipt_id`.

**Locked booking-status rule:** capture increments
`webhooks.lead_created` | `priority_updated` | `booking_status_changed`.
Processor increments `webhooks.booked` / `webhooks.release` and decision
/ intake kinds. One `booking_status_changed` receipt is one class count
at capture plus one Booked or Release count at process. If the raw
payload already has the action at capture, classify `granot.booked` /
`granot.release` there and **do not** increment `booked`/`release`
again at process.

---

## 14. Dedupe keys

Unique on `daily_operations_events.dedupe_key`. Insert-win is the
increment gate.

| Fact | `dedupe_key` |
| --- | --- |
| Form Lead create | `form_lead:<leadId>:created` or `:duplicate` |
| Call Lead create | `call_lead:<leadId>:created` or `:duplicate` or `:unmatched` |
| Granot receipt | `receipt:<receiptId>:<route_event_class>[:booked\|release]` |
| Granot decision | `decision:<decisionId>:<kind>` |
| Intake | `intake:<caseId>:opened` or `:refreshed:<revision>` |
| Lead Message deferred | `message:<messageId>:deferred` |
| Lead Message successful | `message:<messageId>:successful` |
| Lead Message skipped / failed | `message:<messageId>:skipped` or `:failed` |
| Booking | `booking:<bookingId>:created` |
| Cancellation | `cancellation:<cancellationId>:created` |
| Sheet Sync | `sheet_sync:<jobId>:<completed\|failed>` |
| Zip miss | `exception:zip_missing:<leadModel>:<leadId>` |
| Other exception | `exception:<stable fingerprint>` |

WordPress receipt reuse (`reusedExistingLead: true`) must **not** call
the writer.

Canonical command **replay** (`replayed === true`) must **not** call the
writer.

Employee / Admin duplicate submission
(`booking.duplicate_submission_ignored`) must **not** call the writer.

---

## 15. Hook points (after commit only)

Never inside `operation()` / `withTransaction`. Never on Granot HTTP 202
for Lead / Booking / Decision counts. Same seam as today's
`recordOperationalEvent`.

### 15.1 Form Lead

| Function | File | When |
| --- | --- | --- |
| `completeFormLeadIngestion` | `src/services/leads/formLead.service.ts` | After reused-lead early return; next to `recordWhatTheOwnerNeedsToKnow` |

Identity: `lead._id`, `source_company`, `duplicate`, `ingestion_origin`,
name/phone, zips/states. No `job_no` on WordPress create.

If pickup or delivery state is `not_found` (or empty) and the matching
zip is present, also record `exception.zip_missing`.

`runExistingCreateFormLead` finalize already calls
`completeFormLeadIngestion`. One hook covers HTTP, Admin Manual, and
Best Relocation apply.

CRM fail: existing events in complete / CRM service →
`exception.crm_failed`.

### 15.2 Call Lead

| Function | File | When |
| --- | --- | --- |
| `completeCallLeadIngestion` | `src/services/leads/callLead.service.ts` | After commit |

RingCentral also emits `ringcentral.call_lead.created` /
`.duplicate_created` in `ingestRingCentralQualifiedCall`. Increment
**once** inside `completeCallLeadIngestion`.

Adoption (`lead_adopted`) is not a create. Shadow / dry-run are not
domain writes. Adoption conflict → `exception.adoption_conflict`.

Unmatched Call Lead (`created_on_unmatched`): kind
`call_lead.unmatched`, not headline.

Zip present + state missing → `exception.zip_missing`.

### 15.3 Granot receipt (202) — receipts only

| Function | File | When |
| --- | --- | --- |
| `captureGranotLifecycleWebhookReceipt` | `src/services/granotLifecycle/capture.ts` | After persist (`create`), before 202 |

Available: `receipt_id`, `route_event_class`, `captured_at`. No Source
Company yet. Do not hook `captureChannelOperationReceipt`.

### 15.4 Granot Decision / mint / link

| Function | File | When |
| --- | --- | --- |
| `createLeadFromGranot` `finalize` | `src/services/granotLifecycle/createLeadFromGranot.ts` | After commit — Lead id, `source_company`, `ingestion_origin: granot_lead_created`, `job_no` |
| `synchronizeLeadFromGranot` return | `src/services/granotLifecycle/synchronizeLeadFromGranot.ts` | After `executeCanonicalCommandWithPostCommit`; **extend `pending`** with outcome + provenance so the writer has them |
| `logProcessingCompletion` | `src/services/granotLifecycle/processor.ts` | Observe-only / pending / unmatched when no lead finalize ran |

Prefer command `finalize` when a Lead was written.

### 15.5 Granot booking case

| Function | File | When |
| --- | --- | --- |
| `reconcilePreparedObservation` | `src/services/granotLifecycle/bookingReconciliation.ts` | After the transaction, next to `granot_lifecycle.booking_case.opened` / `.refreshed` |

Identity: `case_id`, `observation_id`, `decision_id`. Reload case for
`normalized_job_no`. No Booking id until Confirm.

### 15.6 Lead Message

| Function | File | When |
| --- | --- | --- |
| `dispatchPersistedLeadMessage` | `src/services/leadMessaging/leadMessaging.service.ts` | After Twilio accept: if `sendAt` was applied → `text.deferred`; else → `text.sent` |
| `recordStatusCallbackEvent` | same | When `applied === true` and status is `sent`/`delivered` after a deferred accept → `text.sent`; terminal fail → `text.failed` |
| `dispatchOrQueuePersistedLeadMessage` | same | After-commit skipped path → `text.skipped` |

### 15.7 Booking

| Function | File | When |
| --- | --- | --- |
| `finalizeBookedLeadCreateAfterCommit` | `src/services/bookings/bookedLead.service.ts` | After populate; skip `kind === "duplicate"` |
| `submitEmployeeBooking` | `src/services/employeeBookings/submitEmployeeBooking.service.ts` | After `finalizeSheetSync`; linked vs pending |
| `confirmBooking` | `src/services/granotLifecycle/bookingConfirmation.ts` | After `finalizeSheetSync` when `outcome === "booking_created"`; skip `replayed` |
| `runExistingCreateReferralBooking` finalize | `existingWrites.ts` | `booking.created` + `referral` |
| `runExistingCreateLeadlessBooking` finalize | `existingWrites.ts` | `booking.created` + `leadless` |

Admin `createBookedLead` / `from-source` share
`finalizeBookedLeadCreateAfterCommit` → kind `admin`.

Best Relocation apply **must not** hook `applyBestRelocationPlan`.
Canonical finalize already runs.

### 15.8 Cancellation

| Function | File | When |
| --- | --- | --- |
| `runExistingCreateCancellation` finalize | `src/services/domainCommands/existingWrites.ts` | Live API path does **not** emit `cancellation.created` today — Daily Operations records the Owner fact |
| `confirmCancellation` | `src/services/granotLifecycle/bookingOwnerCommands.ts` | After `finalizeSheetSync` when `cancellation_created`; skip replay |

### 15.9 Sheet Sync (opt-in panel)

| Function | File | When |
| --- | --- | --- |
| Drain completion | `src/services/sheetSync/drainer/runSheetSyncDrain.ts` | After run update — `sheet_sync.completed` / `.failed` |

Do **not** hook `finalizeSheetSync` (queue wakeup, not job done).

---

## 16. HTTP API

Owner-only. Mount on the Granot-lifecycle-admin style router (full
`/api/v1/admin/...` path + `requireApiSecret` +
`requireRegistryOwnerActor`).

| Method | Path | Purpose |
| --- | --- | --- |
| `GET` | `/api/v1/admin/daily-operations` | Day snapshot: tiles, origins, companies, hourly, yesterday + pace, `held_now` |
| `GET` | `/api/v1/admin/daily-operations/events` | Historical page for the day (`cursor`, `lane`, `limit`) |
| `GET` | `/api/v1/admin/daily-operations/live` | SSE |
| `POST` | `/api/v1/admin/daily-operations/rebuild` | Rebuild **open** day from domain collections (Owner / ops) |

### 16.1 Snapshot body

```json
{
  "timezone": "America/New_York",
  "today": "2026-09-06",
  "yesterday": "2026-09-05",
  "generated_at": "2026-09-06T18:14:00.000Z",
  "redis": { "configured": true, "mode": "stream" },
  "metrics": {
    "leads": {
      "today": 42,
      "yesterday": 38,
      "yesterday_by_now": 31,
      "form": 28,
      "call": 14,
      "duplicate_form": 3,
      "duplicate_call": 1
    },
    "bookings": { "today": 6, "yesterday": 5, "yesterday_by_now": 4 },
    "cancellations": { "today": 1, "yesterday": 0, "yesterday_by_now": 0 },
    "texts": {
      "today": 19,
      "yesterday": 22,
      "yesterday_by_now": 18,
      "deferred": 4,
      "held_now": 3,
      "skipped": 4,
      "failed": 1
    },
    "webhooks": {
      "lead_created": { "today": 55, "yesterday": 49 },
      "priority_updated": { "today": 120, "yesterday": 101 },
      "booking_status_changed": { "today": 8, "yesterday": 7 },
      "booked": { "today": 5, "yesterday": 4 },
      "release": { "today": 3, "yesterday": 3 }
    },
    "intakes": { "opened_today": 3, "still_open": 2 },
    "exceptions": { "zip_missing": 2, "crm_failed": 0, "dead_letter": 0, "adoption_conflict": 0 }
  },
  "origins": {
    "granot_lead_created": 20,
    "ringcentral": 14,
    "wordpress_form": 0,
    "best_relocation_sheet": 6,
    "vantage_admin": 2
  },
  "companies": [
    { "source_company": "top10_leads", "form": 12, "call": 5, "total": 17, "yesterday_total": 15 }
  ],
  "hourly": { "today": [], "yesterday": [] }
}
```

`held_now` is a live count of Lead Messages with
`provider_status: "scheduled"` and `status: "accepted"`. The Lead
Message schema has **no** `sendAt` / `scheduled_for` field.
`texts.deferred` is the day increment (held at some point today).

Missing open day → treat as zeros. Missing closed yesterday →
`yesterday` totals null and UI shows `—`.

### 16.2 SSE events

| Event | When | `id:` |
| --- | --- | --- |
| `snapshot` | First open (no Last-Event-ID) | no |
| `event` | New Daily Operations Event | yes `{occurred_at}:{event_id}` |
| `metrics` | After a wake batch that touched tiles | no |
| `heartbeat` | 15s idle | no |
| `error` | Stream failed | no |

Headers: copy Live Events (`text/event-stream`,
`Cache-Control: no-cache, no-transform`, `Connection: keep-alive`,
`X-Accel-Buffering: no`) + `flushHeaders`.

Admin BFF: `app/api/daily-operations-live/route.ts` — clone
`granot-live-receipts/route.ts` (`runtime = "nodejs"`,
`maxDuration = 300`, Owner-only, forward `last-event-id`, pipe body).

### 16.3 Rebuild

Rebuild **open** today from domain collections (NY day bounds). Rebuild
replaces the open day document and does **not** delete events. Closed
days are not rebuilt unless an explicit later Owner confirm is added.

| Counter | Source |
| --- | --- |
| Form / Call leads | `form_leads` / `call_leads` on `timestamp`; split duplicate / unmatched |
| Origins / companies | Same documents |
| Webhooks | `granot_webhook_receipts` on `captured_at`, `observation_channel: granot_webhook` |
| Booked / Release | Observations or receipts with normalized booking action |
| Decisions | `synchronization_decisions` on the day |
| Messages | `lead_messages` by status / schedule time |
| Bookings / Cancellations | `booked_leads` / `cancelled_leads` on `createdAt` |
| Intakes opened | cases `createdAt` |
| Zip miss | leads with zip present and state `not_found` / empty |

---

## 17. Admin client

| File | Role |
| --- | --- |
| `app/(dashboard)/daily/page.tsx` | Page |
| `components/daily/daily-copy.ts` | Owner strings |
| `components/daily/daily-shell.tsx` | Chrome, live state, four bands |
| `components/daily/headline-tiles.tsx` | Pulse |
| `components/daily/origins-panel.tsx` | Ingestion Origin |
| `components/daily/companies-table.tsx` | Source Company |
| `components/daily/category-panels.tsx` | Grid + focus |
| `components/daily/event-card.tsx` | Shared card + links |
| `lib/api/dailyOperations.ts` | Snapshot via `/api/proxy` |
| `lib/api/dailyOperationsLive.ts` | Types + merge (copy `granotLiveReceipts.ts`) |
| `app/api/daily-operations-live/route.ts` | SSE BFF |
| `lib/query/keys.ts` | `queryKeys.dailyOperations.snapshot` |

Client:

```ts
const source = new EventSource("/api/daily-operations-live");
```

Native reconnect. No custom backoff. `onerror` → status `reconnecting`.
Merge events by `event_id`. Apply `metrics` to the tile store. Filter
lanes / Quiet priorities / company **in memory**. Fan each event into
exactly one panel by `lane`.

Do not add a 3s HTTP poll of the snapshot while SSE is live. Optional:
one snapshot fetch on tab focus if the stream was hidden long enough to
miss `maxDuration` reconnect.

Deep links use existing desks. Confirm stays on `/intakes`.

---

## 18. Cron

| Job | When | Does |
| --- | --- | --- |
| Close yesterday | ~00:05 America/New_York | `status: closed` |
| Rebuild open day | every 10 minutes (optional v1) | Repair drift vs domain collections |

Register in `vercel.json` next to existing crons. Handler:
`ALL /api/cron/daily-operations-close` with the same cron secret
pattern as sheet-sync / RingCentral.

---

## 19. Testing

- Unit: `recordDailyOperationsFact` insert-win / duplicate-key /
  closed-day skip / Redis failure swallowed
- Unit: day key + hour around Eastern midnight
  (`2026-06-01T03:00:00.000Z` → still `2026-05-31`)
- Unit: quiet-hours card — 2:14 AM Eastern → `text.deferred` +
  `send_at` 8:00 AM; 7:00 AM → `text.sent` not deferred
- Unit: zip miss — zip present + `not_found` → exception + Lead card
  chip; Lead still increments `leads.total`
- Unit: SSE loop — snapshot, XREAD envelopes, Mongo fallback,
  Last-Event-ID skip snapshot
- Integration: Form Lead complete → event + day `$inc` + no Redis in
  test runner
- Integration: Granot capture increments webhook only;
  `createLeadFromGranot` finalize increments Lead + origin
  `granot_lead_created`
- Admin: Owner nav order; Admin role cannot open `/daily`; panel fan-out
  by lane; Quiet priorities hides priority cards but not counts
- Do **not** hit the real Upstash project from the Node test runner

---

## 20. Phasing and issues

Eight shippable issues. The specification wins; issues sequence work.

| Issue | Ships | Repos |
| --- | --- | --- |
| [DOP-01](issues/DOP-01.md) | Models, kinds, writer, Redis client | server |
| [DOP-02](issues/DOP-02.md) | Form / Call / Booking / Cancellation / Lead Message hooks (including deferred + zip miss) | server |
| [DOP-03](issues/DOP-03.md) | Granot capture, decision, intake hooks | server |
| [DOP-04](issues/DOP-04.md) | Snapshot GET, events page, rebuild, close cron | server |
| [DOP-05](issues/DOP-05.md) | SSE live + Redis doorbell | server |
| [DOP-06](issues/DOP-06.md) | Admin chrome, auth, BFF, headline, origins, companies, pace | admin |
| [DOP-07](issues/DOP-07.md) | Category panels, cards, links, Quiet priorities, exceptions | admin |
| [DOP-08](issues/DOP-08.md) | Browser proof + docs | both |

### Slice mapping

| Slice | Issues | Owner value |
| --- | --- | --- |
| Truthful board | DOP-01–06 | Tiles and mix are live; panels may still be a single column of cards if DOP-07 is not done — **do not ship `/daily` to the Owner until DOP-07** |
| Category board | DOP-07 | The command-center the Owner asked for |
| Proof | DOP-08 | Walk + knowledge pointers |

Sheet Sync panel may land in DOP-07 as opt-in or wait for a later
polish issue. v1 may ship the lane off with a working card renderer.

### Out of v1

- Lead cost / binder / deposit
- Lead Conversations
- Changing WordPress to post to Vantage
- Replacing Live Events, Overview, or Analytics
- TCP `SUBSCRIBE` / `@vercel/kv`
- Redis as counter SoR
- Confirm Granot Booking on this page
- 24h/48h rolling window
- Agent credit / talk time

---

## 21. Locked decisions

1. `/daily` is a new Owner page. Not a tab on Live Events, Overview, or Observational.
2. **Category panels on one board.** Not one mixed feed. Not tabs. Not a page per category.
3. **One Granot stream**, one EventSource. No per-class live space. Granot chips live inside the Granot panel.
4. Mongo is SoR for events and counts. Redis is a doorbell (`XADD` Stream). Degrade to Mongo tail if Redis is absent.
5. After-commit hooks only. Same seam as `recordOperationalEvent`. Never Granot 202 for Lead / Booking / Decision counts.
6. Insert-on-`dedupe_key` is the increment gate. Replays, receipt reuse, and duplicate booking submissions do not count.
7. Today is America/New_York. Pace is hourly, not raw end-of-day vs in-progress.
8. Headline Leads exclude duplicates and Unmatched Call Leads.
9. Bookings and Cancellations count write time, not `book_date` / `cancel_date`.
10. Webhook counts are receipts; Lead counts are Lead writes. `wordpress_form` may be zero.
11. Daily Operations Events are a closed Owner catalog. Operational Events stay in Observational.
12. Use `@upstash/redis` REST with `KV_REST_API_URL` + `KV_REST_API_TOKEN` (or `UPSTASH_REDIS_*`). Do not use `REDIS_URL` / `KV_URL` TCP on Vercel Functions.
13. Best Relocation apply is not a hook. Canonical finalize already runs.
14. Quiet-hours texts are first-class: held until the resolved 8:00 AM (unless constants change), then sent. Headline "Texts sent" does not include held.
15. A zip that does not produce a state is an Exception **and** a chip on the Lead card. The Lead still counts.
16. No mutations from Daily Operations. Confirm stays on `/intakes`.
17. Do not implement the 2026-08-19 Owner Daily Operations View.

---

## 22. Suggested code layout

```
vantage-main-server/src/
  config/domain/dailyOperations.ts
  models/DailyOperationsEvent.ts
  models/DailyOperationsDay.ts
  services/dailyOperations/
    recordDailyOperationsFact.ts
    dayDocument.ts
    kinds.ts
    liveStream.ts
    snapshot.ts
    rebuild.ts
    closeDay.ts
  routes/daily-operations-admin.routes.ts
  routes/daily-operations-cron.routes.ts

vantage-admin/
  app/(dashboard)/daily/page.tsx
  app/api/daily-operations-live/route.ts
  components/daily/
  lib/api/dailyOperations.ts
  lib/api/dailyOperationsLive.ts
```

---

## 23. What "done" looks like at 2:14pm

The Owner opens `/daily` and can say, without opening another tab:

> 42 leads today — 4 ahead of yesterday at this hour. 28 form / 14 call.
> Twenty minted from Granot `lead_created` (WordPress never hit us).
> Fourteen from RingCentral. Six from Best Relocation. Nineteen texts
> sent, three still held from the overnight window until 8:00 AM. Two
> Form Leads came in with a zip and no state — I can open them from
> Exceptions. Eight booking-status receipts, five Booked, two intakes
> Waiting for you. Six Bookings. One Cancellation.

The Leads panel shows the last Form and Call cards with names and
links. The Texts panel shows held versus sent. The Granot panel groups
a `lead_created` receipt with its minted outcome. A new RingCentral
Call Lead appears in the Leads panel and the Call tile ticks without a
page refresh. Live Events still has the raw Granot accordion. Analytics
is unchanged. Confirm still happens on `/intakes`.

---

## 24. What this pack deliberately does not do

- Auto-start Confirm Granot Booking
- Teach the Owner `dedupe_key`, Redis stream IDs, or Mongo collections
- Change WordPress to post to Vantage
- Merge Live Events into `/daily`
- Count unqualified RingCentral calls
- Count Operational Events
- Rewrite Overview's Waiting-for-you band (Overview keeps its short list;
  Daily Operations links to the same cases)
