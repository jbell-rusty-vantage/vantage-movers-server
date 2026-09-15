# 05 — Owner dashboard: `/sales-intelligence` UX and Admin implementation plan

Status: implementation-ready. Pack index: [`README.md`](README.md). Routes: [`04-server-routes.md`](04-server-routes.md).

## 0. Placement and identity

- **Route:** `/sales-intelligence`, Owner-only. Page title "Sales Intelligence".
- **Sidebar:** Today group, after Lead Conversations: `{ label: "Sales Intelligence", href: "/sales-intelligence", icon: Crosshair, ownerOnly: true }` in `components/layout/dashboard-nav.tsx`. Admin does not see it.
- **Views** via `?view=attention|numbers|reps|coverage` (default `attention`). **Panels** via `?record=<outreachRecordId>` (Attention detail) or `?number=<contactNumberId>` (Number detail). `?q=` is the search. `view`/`q`/filters are filter keys; `record`/`number` are panel keys, so `writeFilters` never wipes an open panel (same pattern as `GRANOT_WEBHOOK_RECEIPT_PANEL_KEY`).
- **Deep links in:** Form Lead / Call Lead detail panels get an "Open in Sales Intelligence" chip (`/sales-intelligence?view=attention&record=` resolved via `by-lead`). Overview may show one tile "Needs a call: N" linking to `?view=attention&band=2`. Daily Operations may show a count only; it does not become this page.
- **Deep links out:** Lead chips open `/form-leads?record=` / `/call-leads?record=`; Job Numbers open `/job-timeline?job=`; conversations open the existing `ConversationPanel` inside the drawer (audio play-only).
- **Not this page:** Daily Operations, Live Events, Lead Conversations tab, Analytics. It is a workspace over history and live activity, not a category board.

## 1. Owner language (copy lives in `components/sales-intelligence/sales-intelligence-copy.ts`)

The reader owns a moving company. Say what happened, then what to do. Never print a `snake_case` code, a provider status, or a model name. Every non-working state says whether anything is being lost.

Fixed vocabulary:

| Server value | Owner word |
| --- | --- |
| `unworked` | **Nobody has called yet** |
| `open` | **Being worked** |
| `waiting_on_customer` | **Waiting on the customer** |
| `identity_review` | **Which lead is this?** |
| `closed:booked` / `cancelled` / `duplicate` / `bad_lead` / `not_sales` / `suppressed` / `lost` / `no_sync` / `owner_dismissed` | Booked · Cancelled · Duplicate · Bad lead · Not a sale · Do not call · Lost · No-sync · Dismissed |
| derived `overdue` | **Overdue** chip (red) |
| derived `no_owner` | **No one owns this** chip |
| derived `no_next_action` | **No next step** chip |
| derived `cooldown` | **Tried 3× today** chip (muted) |
| certainty `exact` / `likely` / `unsure` / `owner_confirmed` | Exact · Likely · Unsure · Confirmed by you |
| contact type `voicemail` / `human_conversation` / `unknown` | Left voicemail · Spoke · Connected (unknown) |
| classification `unknown` / `customer` / `company` / `non_customer` | Not decided · Customer · Our number · Not a customer |
| eligibility `suppressed` / `temporarily_blocked` | Do not call · Paused until {date} |
| conversation `unavailable` | Audio not available yet |
| finding pending | **AI suggestion — not verified** |
| finding accepted | Confirmed by you |
| reason `first_action_overdue` | "No call yet, {age} after the form came in" |
| reason `promised_callback_overdue` | "We promised to call back by {time}" |
| reason `missed_inbound_no_callback` | "They called, we missed it, no callback seen" |
| reason `followup_due` | "Follow-up was due {time}" |
| reason `stale_contact` | "Last real conversation {age} ago" |
| coverage missing | "No observed outbound in this phone system" (never "nobody called") |

Age format: "3 h 20 m ago (2 h 10 m staffed)". Money: `$2,114`. Dates: America/New_York.

## 2. Page shell

```
┌─────────────────────────────────────────────────────────────────────────────────────────────┐
│ Sales Intelligence                                        ◉ Live · updated 14:32:07          │
│ ┌──────────────────────────────────────────────────────────────────────────────────────────┐ │
│ │ 🔎  Search a phone number, name, or job number                                      [x]  │ │
│ └──────────────────────────────────────────────────────────────────────────────────────────┘ │
│ [ Needs attention 41 ]  [ Numbers ]  [ Reps ]  [ Coverage ]                                  │
│                                                                                               │
│ ⓘ History is complete through today 2:17 PM. Recordings for other reps are not shared with   │
│   this system yet (RingCentral permission). Nothing is being lost; audio review is limited.   │
└─────────────────────────────────────────────────────────────────────────────────────────────┘
```

- Search is global: digits → number search (any suffix ≥ 4 digits); text → names and Job Numbers. Enter opens `?view=numbers&q=`; if exactly one number matches, open `?number=` directly.
- The ⓘ banner is rendered from `coverage` on every response. Green when `known_through` ≤ 20 min old and no gaps; amber when a gap exists or a capability is `denied`; red only when `known_through` > 2 h old ("Call history is behind; the sync is catching up").
- ◉ Live dot mirrors Daily Operations (`live-dot.tsx`): one `EventSource` to `/api/sales-intelligence-live`; snapshot resync every 5 min while visible, after hidden ≥ 240 s, and on reconnect.

## 3. View: Needs attention (default)

```
┌ Filters (left rail, collapsible) ────────┐ ┌ Needs attention — 41 ────────────────────────────────────┐
│ Show                                     │ │ 1  Promised callbacks overdue                          2  │
│  ( ) Everything actionable   41          │ │ ┌────────────────────────────────────────────────────────┐ │
│  ( ) Nobody has called yet   25          │ │ │ (757) 318-0143   Patricia T. · Top10 Forms   Likely     │ │
│  ( ) Being worked            14          │ │ │ We promised to call back by 1:00 PM · 1 h 32 m overdue │ │
│  ( ) Waiting on customer      2          │ │ │ Last: Spoke 12 min · Tue 4:10 PM · Joshua              │ │
│                                          │ │ │ [Overdue] [No one owns this]    (Message rep) (Open →) │ │
│ Only                                     │ │ └────────────────────────────────────────────────────────┘ │
│  [ ] Overdue                             │ │ …                                                          │
│  [ ] No one owns this                    │ │                                                            │
│  [ ] No next step                        │ │ 2  No call yet after a form                            16  │
│                                          │ │ ┌────────────────────────────────────────────────────────┐ │
│ Source                                   │ │ │ (312) 513-7838   Somu D. · Top10 Forms        Likely    │ │
│  [ Top10 Forms  ▾ ]                      │ │ │ No call yet, 4 h 57 m after the form came in (3 h 40 m │ │
│                                          │ │ │ staffed)                                               │ │
│ Rep                                      │ │ │ Form: Evanston IL → Lake Charles LA · Sep 30           │ │
│  [ Any rep ▾ ]                           │ │ │ [Overdue] [No one owns this]    (Message rep) (Open →) │ │
│                                          │ │ └────────────────────────────────────────────────────────┘ │
│ Kind                                     │ │ …                                                          │
│  [x] Leads  [x] Numbers without a lead   │ │ 3  Missed calls with no callback                        9  │
│                                          │ │ 4  Follow-ups due                                       6  │
│ (Reset)                                  │ │ 5  No next step                                         3  │
│                                          │ │ 6  No one owns this                                     4  │
│ ── Which lead is this? (7) ──            │ │ 7  Going cold                                           1  │
│  (757) 555-0199 · 2 leads  (Decide →)    │ │                                                  (Load more) │
│  …                                       │ └────────────────────────────────────────────────────────────┘
└──────────────────────────────────────────┘
```

Row anatomy (`attention-row.tsx`): number (display) · lead chip (name initial-style, source, certainty word) · reason sentence (from `derived.reasons[0]`) · last interaction line ("Left voicemail 0:41 · today 11:02 · Roy") · status chips · **Message rep** (disabled with tooltip from `nudge_blockers`, e.g. "Map this rep first in Reps") · **Open →** (sets `?record=`).

Band headers are sticky within the list; counts come from `overview.counts.by_band`. Rows animate in/out on live events like Daily Operations cards. New rows arriving via SSE get a 2-second highlight.

"Which lead is this?" is a separate rail beneath the filters; it never mixes into bands.

Empty states: "Nothing needs attention right now. History is complete through 2:17 PM." / with a gap: "Nothing needs attention in what we can see. Call history between 9:40 and 10:10 AM is still missing; it will be filled in automatically."

## 4. Panel: Outreach record (`?record=`)

Right-side `SidePanel` (the shared `components/operational` panel), tabs: **Now** · **Timeline** · **Conversations** · **Leads** · **Messages**.

```
┌ (757) 318-0143 · Patricia T. ─────────────────────────────────────────────── [x] ┐
│ Nobody has called yet · Overdue · No one owns this                                │
│ Form came in Sun 9:05 AM · Top10 Forms · Evanston IL → Lake Charles LA · Sep 30   │
│ Lead: Likely  [Open form lead →]   Received by: —                                  │
│                                                                                    │
│ ┌ What to do ───────────────────────────────────────────────────────────────────┐ │
│ │ [ Message rep ]   [ Set next step ]   [ Mark as worked ]   [ Assign to… ▾ ]     │ │
│ │ [ Waiting on customer ]   [ Close… ▾ ]   [ Add note ]                           │ │
│ └────────────────────────────────────────────────────────────────────────────────┘ │
│                                                                                    │
│ ┌ AI suggestions — not verified (2) ────────────────────────────────────────────┐ │
│ │ ● Rep promised to call back "tomorrow after 3"  → Wed 3:00 PM                  │ │
│ │   "I'll give you a ring tomorrow after three." (sentence 41)                   │ │
│ │   [ Confirm → creates a follow-up ]  [ Not right ]                             │ │
│ │ ● Customer quoted $2,364 total, $1,064 deposit                                 │ │
│ │   [ Confirm ]  [ Not right ]                                                   │ │
│ └────────────────────────────────────────────────────────────────────────────────┘ │
│                                                                                    │
│ Next step: —  (No next step)                                                       │
│ Last real conversation: never                                                      │
│ Calls: 0 out · 1 in (missed)  Texts: 1 confirmation delivered Sun 9:06 AM          │
└────────────────────────────────────────────────────────────────────────────────────┘
```

Rules: buttons render only when the server says the transition is legal (the panel computes legality from `state` using the same table as 01 §5.3; the server re-validates). All commands send `expected_revision`; on 409 the panel shows "This record changed — refreshed" and keeps unsent form values (same posture as intake forms).

### 4.1 Dialog: Message rep

```
┌ Message a rep about (757) 318-0143 ─────────────────────────────────────────┐
│ Rep      [ Joshua (ext 104) ▾ ]      only mapped sales reps appear           │
│ Send by  (•) RingCentral team chat   ( ) Text their RingCentral number       │
│          ( ) RingCentral pager                                                │
│                                                                              │
│ Message                                                                      │
│ ┌──────────────────────────────────────────────────────────────────────────┐ │
│ │ Joshua — this Form Lead has had no call for 4 h 57 m.                    │ │
│ │ Patricia T. · Evanston IL → Lake Charles LA · Sep 30                     │ │
│ │ Number ending 0143 · last contact never · Top10 Forms                    │ │
│ │ Open in Vantage: https://admin…/sales-intelligence?record=66e5…          │ │
│ │ — sent by John via Vantage                                               │ │
│ └──────────────────────────────────────────────────────────────────────────┘ │
│ Goes to: Direct chat with Joshua (RingCentral)   · 5 of 6 left this hour     │
│ This never messages the customer.                                            │
│                                     ( Cancel )   [ Send to Joshua ]          │
└──────────────────────────────────────────────────────────────────────────────┘
```

Flow: open → `POST /nudges/preview` → render; edit → re-preview on blur (debounced); Send → `POST /nudges` with the same `Idempotency-Key`; success toast "Sent to Joshua by team chat"; fallback → "Team chat was not available; sent by pager instead"; failure → inline error "RingCentral did not accept the message. Nothing was sent to the customer." Blockers show inline with the fix ("Joshua is not mapped yet → Reps"). Owner-only; Admin never sees the button.

### 4.2 Dialog: Set next step

Kind (Call · Text the customer · Review · Wait · Sort out which lead) · Due (date/time picker, default next staffed hour) · Rep (optional) · Note. "Wait" switches to the Waiting dialog (until + reason).

### 4.3 Dialog: Close

Reason (Lost · Not a sale · Do not call this number · Dismiss) · note. "Do not call" also sets number eligibility (explains: "Removes this number from every list until you allow it again"). Booked/Cancelled/Duplicate/Bad lead are never offered here ("Those come from the Booking, Cancellation, or Lead record").

### 4.4 Dialog: Which lead is this?

```
┌ Which lead is (757) 555-0199? ─────────────────────────────────────────────┐
│ Two leads share this number. Calls stay on the number until you decide.     │
│ (•) Form Lead · Maria G. · Top10 Forms · Sep 12 · Tampa → Austin            │
│ ( ) Call Lead · P5562888 · Best Relocation · Aug 2 · Booked                 │
│ ( ) Neither / a different person                                            │
│ Why: [ optional note ]                                                      │
│                                     ( Cancel )   [ Confirm ]                │
└─────────────────────────────────────────────────────────────────────────────┘
```

Confirm → `attach` for the chosen and `reject` for the others in sequence (each idempotent). "Neither" → reject all.

## 5. View: Numbers (search)

```
┌ Numbers ──────────────────────────────────────────────────────────────────────────────────┐
│ 🔎 0143            [ Customer ▾ ] [ Has lead ▾ ] [ Last 30 days ▾ ] [ Include our numbers ] │
│                                                                                            │
│ (757) 318-0143   Customer · Allowed        Patricia T. (Likely)      Last: today 11:02 out  │
│                  4 calls · 1 out · 3 in · 1 spoke                     Nobody has called yet │
│ (813) 400-0143   Not decided               No lead on file           Last: Fri 3:20 PM in  │
│                  2 calls · 0 out · 2 in (missed)                       Missed, no callback  │
│ …                                                                            (Load more)   │
└────────────────────────────────────────────────────────────────────────────────────────────┘
```

Row click → `?number=`. Numbers "without a lead" show a quiet "No lead on file" chip and an "Open a review" action inside the panel (not in the row).

## 6. Panel: Number (`?number=`)

Tabs: **Timeline** (default) · **Leads** · **Conversations** · **Outreach** · **About this number**.

```
┌ (757) 318-0143 ───────────────────────────────────────────────────────────── [x] ┐
│ Customer · Allowed · seen since Sep 4 · 4 calls · last real conversation Tue      │
│ Leads: Patricia T. (Likely) [Open →]                                              │
│ AI summary (from 2 calls, Sep 9–11): Quoted $2,364 with $1,064 deposit; customer   │
│ finalizing the Louisiana address; rep to call back after 3 PM Wednesday.          │
│ ─ AI suggestion — not verified ─                                                   │
│                                                                                    │
│ Timeline                                                       [ Calls ▾ ] [ All ] │
│ ● Today 11:02   Out · Left voicemail · 0:41 · Roy (ext 112)          [ ▶ 0:41 ]  │
│ ● Tue 4:10 PM   Out · Spoke · 12:04 · Joshua (ext 104)    ▸ 2 AI suggestions       │
│                 [ ▶ play ]  [ Read transcript ]                                    │
│ ● Sun 9:06 AM   Text · Confirmation delivered (Top10 Forms)                        │
│ ● Sun 9:05 AM   Form Lead came in · Top10 Forms · Patricia T.                       │
│ ● Sun 9:05 AM   Nobody has called yet — clock started                              │
│ ● Sep 4 2:15 PM In · Missed · rang the sales queue (3 phones) · no callback seen    │
│                                                                    (Load earlier)  │
└────────────────────────────────────────────────────────────────────────────────────┘
```

Timeline rules: one entry per Call Interaction, never per leg. Queue fan-out reads "rang the sales queue (3 phones)". Transfers read "transferred to Tyler". Internal-only sessions are hidden unless "Show internal" is on. Audio uses the existing `ConversationPanel` behavior: play-only, one-shot signed URL, never prefetched.

**About this number** tab: classification radio (Not decided · Customer · Our number · Not a customer) + eligibility (Allowed · Paused until… · Do not call) + reason, plus "Rebuild counts" (maintenance).

## 7. View: Reps

```
┌ Reps ─────────────────────────────────────────────────────────────────────────────────┐
│ Map each RingCentral phone user to an Agent so calls can be credited and reps can be   │
│ messaged. Nothing here changes commissions or bookings.                                │
│                                                                                        │
│ Mapped (6)                                                                             │
│ Joshua        ext 104 · (813) 555-0104 · team chat ✓ · SMS ✓     Reviewed   Sales rep  │
│   Last 30 days: 412 calls out · 188 numbers · 121 connected · 54 spoke · 3 nudges      │
│   [ Change… ]                                                                          │
│ …                                                                                      │
│ Suggested (4)                                                                          │
│ "Roys" ext 112 → Roy?        exact name match      [ Confirm ] [ Not this person ]     │
│ "Tyler" ext 118 → two Agents named Tyler           [ Choose… ]                          │
│ Not mapped (14 RingCentral users) · 3 active Agents without a phone user               │
│ [ Re-check suggestions ]                                                               │
└────────────────────────────────────────────────────────────────────────────────────────┘
```

Rules: activity numbers appear only on reviewed links. "Connected" and "Spoke" are separate columns with a tooltip ("Connected means the phone system connected; Spoke means a person was heard on a recording we could review"). Never a ranking table. Role kind selector (Sales rep · Service · Manager · Dialer · Shared line · Exclude).

## 8. View: Coverage

```
┌ Coverage ─────────────────────────────────────────────────────────────────────────────┐
│ Call history       Complete through today 2:17 PM · last check 2:30 PM · no gaps       │
│ Recordings         Limited — RingCentral has not granted company-wide recording access  │
│                    to this connection. 61 of 94 recordings this week were readable.     │
│ Team chat          Ready (connection can post to direct chats)                          │
│ Rep texting        Ready (one sending number)                                           │
│ Pager              Not tested                                                           │
│ Call insights (RingSense)  Not available on this plan                                   │
│ AI review budget   $12.40 of $50.00 this month · 38 calls reviewed · not paused         │
│                                                                                        │
│ Hygiene                                                                                 │
│ 61 company numbers · 5 mapped as inbound sources · 11 unmapped numbers received calls   │
│ in the last 30 days (Operations Registry →)                                             │
│ 24 phone users · 6 mapped reps · 4 suggestions waiting (Reps →)                         │
│                                                                                        │
│ Queues            Audio waiting 3 · transcribing 1 · reviewing 0 · not available 7 ·   │
│                   failed 0                                                              │
│ [ Load older history… ]   (plans a 60-day backfill; runs in the background)             │
└────────────────────────────────────────────────────────────────────────────────────────┘
```

Every line states impact in Owner terms. "Unknown" is a valid word; "0" is never shown for a denied capability.

## 9. Live behavior

- `sales-intelligence-shell.tsx` owns the single `EventSource`. Events update React Query caches in place: `interaction` → prepend to the open number timeline and bump the number row; `outreach` → replace the row in the Attention list (re-sort within band; new band → move with motion); `finding` → increment pending count and add to the open panel; `nudge` → append to the timeline; `coverage` → banner.
- Rows tween counts; entering rows highlight; exiting rows fade (reuse `use-exiting-list.ts` / `animated-number.tsx` patterns from `components/daily`).
- Snapshot resync (overview + current list) every 5 min, after hidden ≥ 240 s, and on reconnect; the client never derives Overdue itself beyond ticking the displayed age (`use-now.ts`).

## 10. Admin implementation map (`vantage-admin`)

| File | Owns |
| --- | --- |
| `app/(dashboard)/sales-intelligence/page.tsx` | Owner gate + `<SalesIntelligenceShell />` |
| `app/api/sales-intelligence-live/route.ts` | SSE BFF (copy of `daily-operations-live`) |
| `components/sales-intelligence/sales-intelligence-shell.tsx` | header, search, view tabs, coverage banner, one EventSource, panel routing (`?record=` / `?number=`) |
| `components/sales-intelligence/sales-intelligence-copy.ts` | every Owner string, reason-code → sentence map, state/chip labels |
| `components/sales-intelligence/sales-intelligence-tabs.ts` | view ids, hrefs, filter keys vs panel keys |
| `components/sales-intelligence/attention/attention-view.tsx`, `attention-filters.tsx`, `attention-band.tsx`, `attention-row.tsx`, `identity-review-rail.tsx` | Needs attention |
| `components/sales-intelligence/numbers/numbers-view.tsx`, `number-row.tsx` | Numbers search |
| `components/sales-intelligence/panels/outreach-panel.tsx` (+ `outreach-actions.tsx`, `findings-section.tsx`), `number-panel.tsx` (+ `number-timeline.tsx`, `timeline-entry.tsx`, `number-about.tsx`) | Side panels |
| `components/sales-intelligence/dialogs/message-rep-dialog.tsx`, `next-step-dialog.tsx`, `close-dialog.tsx`, `which-lead-dialog.tsx`, `classify-number-dialog.tsx` | Commands |
| `components/sales-intelligence/reps/reps-view.tsx`, `rep-link-row.tsx`, `rep-link-dialog.tsx` | Reps |
| `components/sales-intelligence/coverage/coverage-view.tsx` | Coverage |
| `lib/api/salesIntelligence.ts` | typed client for every route in 04 (`fetchOverview`, `fetchAttention`, `searchNumbers`, `fetchNumber`, `fetchNumberTimeline`, `fetchOutreach`, `fetchOutreachByLead`, `sendOutreachCommand`, `createFollowup`, `completeFollowup`, `snoozeFollowup`, `acceptFinding`, `dismissFinding`, `fetchReps`, `proposeReps`, `reviewRep`, `createRep`, `previewNudge`, `sendNudge`, `fetchNudges`, `fetchCoverage`, `planBackfill`, `processConversation`, `classifyNumber`, `openNumberReview`); idempotency key helper; DTO types copied from 04 §2 (Admin types are never the semantic authority) |
| `lib/api/salesIntelligenceLive.ts` | EventSource wrapper + typed event parsing |
| `lib/api/salesIntelligenceBoard.ts` | pure helpers: band grouping, in-place cache merge on live events, age formatting, legal-transition table for button visibility |
| `lib/query/keys.ts` | `queryKeys.salesIntelligence = { all, overview(), attention(filters), numbers(filters), number(id), timeline(id, cursor), outreach(id), outreachByLead(model,id), reps(), rep(id), nudges(recordId), coverage(), findings(conversationId) }` |
| `lib/query/salesIntelligence.ts` | `invalidateSalesIntelligenceCommandViews(queryClient, { recordId?, numberId? })` after every command (also after 409 refetch); `queryKeys.conversations` invalidated when a finding is accepted |
| `server/auth/authorization.ts` | Owner-only page prefix + proxy deny for non-owner |
| `components/layout/dashboard-nav.tsx` | nav item |
| `components/operational/operational-detail-panel.tsx` | "Open in Sales Intelligence" chip on Form/Call Lead detail (reads `fetchOutreachByLead`; hidden when 404) |

Tests: `lib/api/salesIntelligence.test.ts` (URL building, idempotency reuse), `salesIntelligenceBoard.test.ts` (band grouping, merge-on-event, legal transitions), `server/auth/authorization.test.ts` additions (page + proxy), component tests for row copy mapping (every reason code has a sentence; every state has a label — a test iterates the closed sets).

## 11. States and edge copy

| Situation | Copy |
| --- | --- |
| Feature off on server | Page shows "Sales Intelligence is not turned on yet." with no fetch loop |
| Loading | skeleton rows, no spinner text |
| SSE disconnected | live dot grey; "Reconnecting…"; lists still usable |
| Coverage `recording_content: denied` | banner + Coverage line; conversation entries show "Audio not shared with this system" instead of a play button |
| AI paused | findings section: "AI review is paused this month (budget). Calls are still recorded and listed." |
| Nudge rate-limited | button disabled: "Joshua already got 6 messages this hour" |
| Lead deleted/no-sync after record exists | row shows Closed · No-sync; timeline keeps history |
| Number is `company` | never in Attention; Numbers shows "Our number" chip; panel has no outreach actions |
