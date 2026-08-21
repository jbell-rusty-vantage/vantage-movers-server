---
type: Reference
title: Owner Daily Operations (Reduced) — the owner-facing copy deck
description: Every word the Owner reads on /daily, written out, with the module that holds it. Includes the schema-to-owner vocabulary map, the drop-in daily-copy.ts and provenance-story.ts modules, and screen-by-screen rendered examples for each state.
tags:
  - granot
  - owner-dashboard
  - content-design
status: draft
stale_after: 2026-11-19
generated:
  by: claude-opus-5
  at: 2026-08-21T00:00:00Z
sources:
  - id: reduced-spec
    resource: ./owner-daily-reduced-specification.md
  - id: architecture
    resource: ./owner-daily-implementation-architecture.md
  - id: existing-intake-copy
    resource: ../../../vantage-admin/components/intakes/intake-copy.ts
owners: [team:vantage-admin]
applies_to:
  - vantage-admin/components/daily/daily-copy.ts
  - vantage-admin/lib/daily/provenance-story.ts
---

# Owner Daily Operations — the copy deck

## 0. How to use this

Every owner-visible string on `/daily` is in this document, and every one of them
belongs in exactly one of two modules:

| Module | Holds |
| --- | --- |
| `vantage-admin/components/daily/daily-copy.ts` | Labels, headings, empty states, capability panels, tooltips, status words |
| `vantage-admin/lib/daily/provenance-story.ts` | The translation of the Granot evidence chain into sentences |

Plus one module that already exists and is **reused unchanged**:

| Module | Holds |
| --- | --- |
| `vantage-admin/components/intakes/intake-copy.ts` | Everything said about a booking or cancellation case |

A component under `components/daily/` that contains a bare user-visible string
is a review failure. That is not fussiness — it is the only way this stays one
voice as five more surfaces get built on the same pattern.

---

## 1. Who is reading this

He owns a moving company. He is not a software engineer, not a data analyst,
and not the person who operates Granot's internals. He opens this board in the
morning to answer four questions, in this order:

1. **What is blocked on me right now?**
2. **What came in?**
3. **What did we book, and what did we lose?**
4. **Where did this particular record come from — can I trust it?**

Everything on the board serves one of those four. Anything that serves none of
them is technical detail and belongs behind a `<details>`.

### 1.1 Voice rules

1. **Say what happened, then say what to do.** Never the reverse, never only one.
2. **Never name a system he does not operate.** Banned from every owner-visible
   string: *projection, DTO, cursor, receipt, record link, entity, revision,
   flag, shadow mode, capability, case, aggregate, normalization, idempotency,
   provenance*. (Yes, "provenance" too — see §5.6.)
3. **Never print a `snake_case` identifier.** If a value has no friendly label,
   omit it rather than leak it.
4. **Every number carries its unit and its meaning.** `$14,208 in deposits`, not
   `14208`. `29% of them booked`, not `0.293`.
5. **Every non-working state says whether anything is being lost.** "Not switched
   on" is frightening until it is followed by "nothing is being lost."
6. **Empty states say what would make something appear**, and offer the one
   action that might.
7. **Never blame him, and never imply he lacks permission.** He is the Owner. If
   he cannot do something, the system is not ready — say that.
8. **Active voice, second person, no exclamation marks, no emoji** beyond the
   four status glyphs in §4.5.
9. **A sentence a moving-company owner would say out loud.** "Granot marked this
   booked" — yes. "Priority effect applied to canonical priority 5" — no.

### 1.2 The one sentence that carries the most weight

The `activity_at` rule is the single most confusing thing about this board, and
it is invisible until it surprises him. It gets stated in plain language, once,
directly under the date range, on every tab:

> **Counted by when it reached Vantage, not by the dates written on the record.
> A booking you entered this morning for a job with a book date of Aug 12 still
> shows up here.**

That sentence replaces the entire §6.4 table for him.

---

## 2. Vocabulary — schema to Owner

The left column never appears on `/daily`. The right column is the only thing
that does.

| System | Owner |
| --- | --- |
| `FormLead` | Form lead |
| `CallLead` | Call lead |
| `BookedLead` | Booking |
| `CancelledLead` | Cancellation |
| `normalized_job_no` | Job number |
| `ref_no` | Reference |
| `activity_at` / `timestamp` | **Recorded** — "when it reached Vantage" |
| `book_date` / `cancel_date` | **Book date** / **Cancel date** — "the date on the record" |
| `source_company_label_snapshot` | Came from |
| `receiver_agent_name_snapshot` | Agent |
| `agent_allocations` | Agents (and the split) |
| `total_binder_amount` | Binder |
| `deposit_amount` | Deposit |
| `cpl` | Lead cost |
| `GranotObservationReceipt` | An update from Granot |
| `SynchronizationDecision` | Vantage checked it |
| `execution_mode: shadow` | Watching only — nothing was changed |
| `GranotRecordLink` | Matched to a lead |
| `record_link_change: corrected` | Match corrected |
| `EntityChange` / revision | Vantage record updated |
| `GranotBookingReconciliationCase` | A booking waiting on you |
| `GranotReleaseReconciliationCase` | A cancellation waiting on you |
| `GranotBookingDiscrepancy` | Granot and Vantage don't match |
| `case.state: open` | Waiting for you |
| `case.state: resolved` | Finished |
| `official_booking` | Booking created in Vantage |
| `capability: not_activated` | Not switched on yet |
| `capability: not_built` | Not built yet |
| `resolvable: false` | You can review it; entering the official record isn't switched on yet |
| provenance chain | **Where this came from** |

Note the last one. "Provenance" is a word from the specification, not a word he
uses. The tab is labelled **"Where this came from"** and the heading is the same.

---

## 3. `components/daily/daily-copy.ts`

Drop-in. Types are illustrative where they reference DTOs defined in
`lib/api/ownerDaily.ts`.

```ts
import type { DailyWindowMode } from "@/lib/daily/daily-window-context";

/* ── window ────────────────────────────────────────────────────────────── */

export const WINDOW_GROUP_LABEL = "Show me the last";

export const WINDOW_OPTIONS: ReadonlyArray<{ mode: DailyWindowMode; label: string }> = [
  { mode: "12h", label: "12 hours" },
  { mode: "24h", label: "24 hours" },
  { mode: "48h", label: "48 hours" },
];

/** "the last 24 hours" — always lowercase, always used mid-sentence. */
export function windowPhrase(mode: DailyWindowMode): string {
  return mode === "12h" ? "the last 12 hours"
       : mode === "48h" ? "the last 48 hours"
       : "the last 24 hours";
}

/** The next-longer window, for every "try a wider window" action. Null at 48h. */
export function widerWindow(mode: DailyWindowMode): { mode: DailyWindowMode; label: string } | null {
  if (mode === "12h") return { mode: "24h", label: "Show the last 24 hours" };
  if (mode === "24h") return { mode: "48h", label: "Show the last 48 hours" };
  return null;
}

export const PAGE_TITLE = "Daily Operations";

export function pageSubtitle(mode: DailyWindowMode): string {
  return `Everything that reached Vantage in ${windowPhrase(mode)}, plus anything waiting on you.`;
}

export const WINDOW_RULE_NOTE =
  "Counted by when it reached Vantage, not by the dates written on the record. "
  + "A booking you entered this morning for a job with a book date of Aug 12 still shows up here.";

/* ── tabs ──────────────────────────────────────────────────────────────── */
/** URL tokens are stable and machine-facing. Labels are the Owner's. */
export const TAB_LABELS = {
  today:     "Summary",
  leads:     "Leads",
  intakes:   "Waiting on you",
  completed: "Booked & cancelled",
} as const;

/* ── needs-you band ────────────────────────────────────────────────────── */

export const NEEDS_YOU_HEADING = "Waiting on you";

export function needsYouBookings(count: number, oldestAge: string | null): string {
  const head = count === 1 ? "1 booking waiting on you" : `${count} bookings waiting on you`;
  return oldestAge ? `${head} — oldest has been waiting ${oldestAge}` : head;
}

export function needsYouCancellations(count: number, oldestAge: string | null): string {
  const head = count === 1 ? "1 cancellation waiting on you" : `${count} cancellations waiting on you`;
  return oldestAge ? `${head} — oldest has been waiting ${oldestAge}` : head;
}

export function needsYouMismatches(count: number): string {
  return count === 1
    ? "1 job where Granot and Vantage don't match"
    : `${count} jobs where Granot and Vantage don't match`;
}

export const NEEDS_YOU_ACTIONS = {
  bookings:      "Finish these",
  cancellations: "Review these",
  mismatches:    "Sort these out",
} as const;

export function needsYouClear(lastResolvedAge: string | null): string {
  return lastResolvedAge
    ? `Nothing waiting on you. You cleared the last one ${lastResolvedAge} ago.`
    : "Nothing waiting on you.";
}

/* ── totals band ───────────────────────────────────────────────────────── */

export function totalsHeading(mode: DailyWindowMode): string {
  return `In ${windowPhrase(mode)}`;
}

export const TOTALS = {
  formLeads:     { label: "Form leads",    empty: "No form leads yet" },
  callLeads:     { label: "Call leads",    empty: "No call leads yet" },
  bookings:      { label: "Bookings",      empty: "No bookings recorded" },
  cancellations: { label: "Cancellations", empty: "No cancellations recorded" },
} as const;

export function bookedFromLeads(booked: number, rate: number): string {
  const pct = `${Math.round(rate * 100)}%`;
  return booked === 1
    ? `1 turned into a booking · ${pct}`
    : `${booked} turned into bookings · ${pct}`;
}

export function depositsSummary(depositTotal: string, average: string): string {
  return `${depositTotal} in deposits · ${average} average`;
}

export function refundsSummary(refundTotal: string): string {
  return `${refundTotal} refunded`;
}

export const TOTALS_TOOLTIPS = {
  bookedRate:
    "Of the leads that came in during this window, how many are booked right now. "
    + "A lead that books next week won't count here until it does.",
  deposits:
    "The deposit amounts written on these bookings. This is what was entered in Vantage, "
    + "not what has cleared the bank.",
  binder: "The binder amounts written on these bookings.",
  refunds: "The refund amounts written on these cancellations.",
} as const;

/* ── live columns and indicator ────────────────────────────────────────── */

export const LIVE_COLUMNS = {
  leads:  { heading: "Leads coming in",     empty: "Nothing in the last 10 minutes." },
  granot: { heading: "Updates from Granot", empty: "Nothing in the last 10 minutes." },
} as const;

export const LIVE_COLUMN_FOOTER = "Nothing newer";

export function liveIndicator(
  status: "live" | "paused" | "reconnecting" | "off",
  detail: { agoLabel?: string; asOfLabel?: string },
): { glyph: string; text: string; action?: string } {
  switch (status) {
    case "live":
      return { glyph: "●", text: `Live · updated ${detail.agoLabel ?? "just now"}` };
    case "paused":
      return { glyph: "◌", text: "Paused · this tab is in the background" };
    case "reconnecting":
      return {
        glyph: "⚠",
        text: `Can't reach the server · showing what we had at ${detail.asOfLabel ?? "the last update"}`,
        action: "Try now",
      };
    case "off":
      return { glyph: "○", text: "Live updates off", action: "Turn on" };
  }
}

export const LIVE_TOGGLE_LABEL = "Live updates";

/* ── leads tab ─────────────────────────────────────────────────────────── */

export const LEADS = {
  segments: { all: "All", form: "Form", call: "Calls" },
  searchPlaceholder: "Search name, phone, job number, or reference",
  bookedFilter: { label: "Booked", any: "Any", yes: "Booked", no: "Not booked" },
  sourceFilter: { label: "Came from", any: "Any source" },
  clearFilters: "Clear filters",
  columns: {
    time:     "Time",
    kind:     "Type",
    customer: "Customer",
    source:   "Came from",
    job:      "Job / Reference",
    agent:    "Agent",
    status:   "Status",
  },
  kindLabel: { form_lead: "Form", call_lead: "Call" },
  loadMore: "Show more",
} as const;

export function leadStatusLabel(status: "open" | "booked" | "bad_lead"): string {
  return status === "booked" ? "Booked"
       : status === "bad_lead" ? "Marked bad lead"
       : "Still open";
}

export function leadsEmpty(mode: DailyWindowMode, filtered: boolean): string {
  return filtered
    ? "No leads match these filters."
    : `No leads reached Vantage in ${windowPhrase(mode)}.`;
}

/* ── booked & cancelled tab ────────────────────────────────────────────── */

export const COMPLETED = {
  segments: { bookings: "Bookings", cancellations: "Cancellations" },
  searchPlaceholder: "Search job number or customer",
  bookingColumns: {
    recorded:  "Recorded",
    bookDate:  "Book date",
    job:       "Job",
    customer:  "Customer",
    agents:    "Agents",
    binder:    "Binder",
    deposit:   "Deposit",
    merchant:  "Merchant",
  },
  cancellationColumns: {
    recorded:   "Recorded",
    cancelDate: "Cancel date",
    job:        "Job",
    customer:   "Customer",
    refund:     "Refund",
    reason:     "Reason",
    recordedBy: "Recorded by",
  },
  dateNote:
    "Recorded is when it reached Vantage. Book date is the date written on the booking. "
    + "They are often different, and only Recorded decides whether a row shows up here.",
} as const;

export function completedTotalsLabel(
  mode: DailyWindowMode,
  segment: "bookings" | "cancellations",
): string {
  return segment === "bookings"
    ? `Total for ${windowPhrase(mode)}`
    : `Total refunded in ${windowPhrase(mode)}`;
}

export function backDatedChip(days: number): string {
  return days === 1 ? "Back-dated 1 day" : `Back-dated ${days} days`;
}

export function backDatedTooltip(bookDateLabel: string): string {
  return `Entered today. The book date on this record is ${bookDateLabel}.`;
}

export function agentsLabel(names: string[]): { text: string; tooltip?: string } {
  if (names.length === 0) return { text: "—" };
  if (names.length === 1) return { text: names[0]! };
  return {
    text: `${names[0]} +${names.length - 1}`,
    tooltip: `Split between ${names.length} agents: ${names.join(", ")}. Open the row for the split.`,
  };
}

export function completedEmpty(
  mode: DailyWindowMode,
  segment: "bookings" | "cancellations",
): string {
  return segment === "bookings"
    ? `No bookings reached Vantage in ${windowPhrase(mode)}.`
    : `No cancellations reached Vantage in ${windowPhrase(mode)}.`;
}

/* ── waiting-on-you tab ────────────────────────────────────────────────── */
/* Row-level sentences come from components/intakes/intake-copy.ts. Only the
   frame lives here, so /daily and /intakes describe a case identically. */

export const INTAKES = {
  segments: { booking: "Bookings", cancellation: "Cancellations" },
  intro:
    "These came from Granot and need an official Vantage record. "
    + "Open one to finish it — the same screen you use from Intakes in the sidebar.",
  openLabel: "Open and review",
  viewOnlyNote:
    "You can open this and see everything Granot sent. "
    + "Entering the official record from here isn't switched on yet.",
  columns: {
    job:       "Job",
    why:       "Why it's here",
    has:       "What Vantage has",
    next:      "Next step",
    customer:  "Customer",
    source:    "Came from",
    age:       "Waiting",
  },
} as const;

export function intakesSummaryLine(open: number, oldestAge: string | null): string {
  if (open === 0) return "Nothing waiting.";
  const head = open === 1 ? "1 waiting" : `${open} waiting`;
  return oldestAge ? `${head} · oldest has been waiting ${oldestAge}` : head;
}

/* ── capability panels ─────────────────────────────────────────────────── */

export type DailyPane =
  | "form_leads" | "call_leads" | "completed_bookings" | "completed_cancellations"
  | "booking_intakes" | "cancellation_intakes" | "granot_events";

export const CAPABILITY_NOT_ACTIVATED: Record<DailyPane, { title: string; body: string }> = {
  booking_intakes: {
    title: "Booking intakes aren't switched on yet",
    body:
      "Nothing is being lost. Granot updates are still being recorded, "
      + "and they'll turn into items here the moment this is switched on.",
  },
  cancellation_intakes: {
    title: "Cancellation intakes aren't switched on yet",
    body:
      "Nothing is being lost. Granot cancellations are still being recorded, "
      + "and they'll turn into items here the moment this is switched on.",
  },
  granot_events: {
    title: "Granot updates aren't being processed yet",
    body:
      "Updates from Granot are still being saved, but nothing is being read from them yet, "
      + "so this column will stay empty.",
  },
  form_leads:               { title: "", body: "" },  // always available
  call_leads:               { title: "", body: "" },
  completed_bookings:       { title: "", body: "" },
  completed_cancellations:  { title: "", body: "" },
};

export const CAPABILITY_TECHNICAL_SUMMARY = "Technical detail";
export function capabilityTechnicalBody(flag: string): string {
  return `${flag} is currently off.`;
}
export const CAPABILITY_STATUS_LINK = { label: "See system status", href: "/ingestion/granot/lifecycle/health" };

export function capabilityNotBuilt(paneLabel: string): { title: string; body: string } {
  return {
    title: `${paneLabel} isn't built yet`,
    body: "This is on the roadmap. Nothing is being lost in the meantime.",
  };
}

/* ── drawer ────────────────────────────────────────────────────────────── */

export const DRAWER = {
  tabs: { details: "Details", provenance: "Where this came from" },
  close: "Close",
  sections: {
    contact:  "Contact",
    source:   "Where it came from",
    move:     "The move",
    handling: "How we handled it",
    booking:  "Booking",
    cancellation: "Cancellation",
  },
  fieldLabels: {
    name: "Name", phone: "Phone", email: "Email",
    source: "Source", granularity: "Campaign",
    pickup: "Pickup", delivery: "Delivery", cubicFeet: "Size", moveDate: "Move date",
    recorded: "Recorded", agent: "Agent", leadCost: "Lead cost",
    job: "Job number", reference: "Reference",
    bookDate: "Book date", deposit: "Deposit", binder: "Binder", merchant: "Merchant",
    cancelDate: "Cancel date", refund: "Refund", reason: "Reason", recordedBy: "Recorded by",
  },
  leadCostTooltip: "What this lead cost you, from the rate on file for that source at the time it came in.",
  openFullRecord: "Open the full record",
} as const;

/* ── whole-board states ────────────────────────────────────────────────── */

export function boardEmpty(mode: DailyWindowMode): string {
  return `Nothing has reached Vantage in ${windowPhrase(mode)}.`;
}

export const BOARD_ERROR = {
  title: "We couldn't load the board",
  body: "Your data is fine — this is a connection problem.",
  action: "Try again",
} as const;

export const LIST_ERROR = {
  body: "We couldn't load this list.",
  action: "Try again",
} as const;

export const LOADING_ANNOUNCEMENT = "Loading your daily board";
```

### 3.1 Numbers, dates, and ages

Not in `daily-copy.ts` — these already exist and must not be re-implemented:

| Need | Use |
| --- | --- |
| Money | `formatMoney` — `components/data-table/formatters.ts` |
| Timestamps | `formatDateTime` — already `America/New_York` |
| Dates | `formatDate` |
| Time zone name | `FLORIDA_TIME_ZONE` — `lib/floridaTime.ts` |
| "4h 12m" | `ageLabel` — promote the private copy at `components/intakes/intake-list.tsx:19` into `lib/daily/window.ts` |

`ageLabel` needs one upgrade for this board: it currently returns `"4h"` and
`"2d"`. The NEEDS-YOU band reads much better with minutes on the hours bucket —
`"4h 12m"` — because the difference between *4h* and *4h 55m* is the difference
between "later today" and "now". Extend it, and update `/intakes` to the same
helper so both surfaces read the same.

---

## 4. Screen by screen

### 4.1 Header

```
Daily Operations
Everything that reached Vantage in the last 24 hours, plus anything waiting on you.

Show me the last:  [ 12 hours ]  [ 24 hours ]  [ 48 hours ]          ● Live · updated 2 seconds ago

Wed Aug 19, 6:12 AM  →  Thu Aug 20, 6:12 AM · Florida time
Counted by when it reached Vantage, not by the dates written on the record.
A booking you entered this morning for a job with a book date of Aug 12 still shows up here.
```

```
[ Summary ]  [ Leads ]  [ Waiting on you ③ ]  [ Booked & cancelled ]
```

Badges appear on **"Waiting on you"** only, and only for open items. Never a
badge for "leads exist" — a badge is a claim on his attention.

### 4.2 Summary — waiting on you

```
┌─ Waiting on you ────────────────────────────────────────────────────────────┐
│  ⬤ 3 bookings waiting on you — oldest has been waiting 4h 12m               │
│    [ Finish these ]                                                          │
│  ⬤ 1 cancellation waiting on you — oldest has been waiting 40m              │
│    [ Review these ]                                                          │
│  ⚠ 2 jobs where Granot and Vantage don't match                              │
│    [ Sort these out ]                                                        │
└──────────────────────────────────────────────────────────────────────────────┘
```

Cleared:

```
┌──────────────────────────────────────────────────────────────────────────────┐
│  ● Nothing waiting on you. You cleared the last one 2h 41m ago.              │
└──────────────────────────────────────────────────────────────────────────────┘
```

Never cleared anything yet:

```
│  ● Nothing waiting on you.                                                   │
```

**The band never disappears.** A missing band reads as a bug; a green line reads
as "clear". This is a requirement, not a preference.

The mismatch line is optional scope (architecture doc C10) and reads from
`projectGranotLifecycleHealth().open_discrepancies`, which already exists. It
links to `/ingestion/granot/lifecycle/discrepancies`, which is a technical page —
so the line's copy sets the expectation honestly: *"Sort these out"*, not
*"Fix these"*.

### 4.3 Summary — totals

```
┌─ In the last 24 hours ──────────────────────────────────────────────────────┐
│   Form leads          Call leads         Bookings            Cancellations   │
│      41                   27                 9                     2         │
│   12 turned into      6 turned into     $14,208 in         $1,100 refunded   │
│   bookings · 29%      bookings · 22%    deposits ·                           │
│                                         $1,578 average                       │
└──────────────────────────────────────────────────────────────────────────────┘
```

Zeroes are words, not `0`:

```
│   Form leads          Call leads         Bookings            Cancellations   │
│      0                    27                 0                     0         │
│   No form leads yet   6 turned into     No bookings         No cancellations │
│                       bookings · 22%    recorded            recorded         │
```

Each of the three sub-lines carries the tooltip from `TOTALS_TOOLTIPS`. The
booked-rate tooltip in particular prevents a real misreading: he will otherwise
assume 29% is the campaign's true conversion, when it is *conversion so far, of
leads that arrived in the last 24 hours*.

### 4.4 Summary — live columns

```
┌─ Leads coming in ─────────────────┬─ Updates from Granot ────────────────────┐
│  6:09  Call lead                  │  6:11  Vantage checked job P5562401      │
│        Robert Martinez            │        Matched to the right lead.        │
│        Best Relocation · 8m 02s   │        Watching only — nothing changed.  │
│        ● Booked                   │                                          │
│                                   │  6:09  Granot sent an update             │
│  6:04  Form lead                  │        New lead on job P5562401.         │
│        Jenna Torres               │                                          │
│        Top10 Forms · ref 88213    │  6:04  Granot marked job P5562388 booked │
│                                   │                                          │
│  ──────── Nothing newer ───────   │  ──────── Nothing newer ───────────────  │
└───────────────────────────────────┴──────────────────────────────────────────┘
```

Full customer name, masked phone/email — the reduced spec §2.3 decision, and the
Owner's own note on the wireframe. `•••4192` appears only where there is no name.

New rows fade in over ~1.5s. Existing rows never move.

Empty column: `Nothing in the last 10 minutes.`

### 4.5 The four live states

```
● Live · updated 2 seconds ago
◌ Paused · this tab is in the background
⚠ Can't reach the server · showing what we had at 6:09 AM        [ Try now ]
○ Live updates off                                               [ Turn on ]
```

The reconnecting state says **what** it is showing and **when** it is from. A
board that goes quiet without saying so is worse than one that never claimed to
be live. The pane below it keeps its data — it is never blanked.

### 4.6 Leads

```
[ All (68) ]  [ Form (41) ]  [ Calls (27) ]

[ Search name, phone, job number, or reference ]   Booked [ Any ▾ ]   Came from [ Any source ▾ ]   Clear filters

Time    Type   Customer          Came from         Job / Reference   Agent     Status
6:09    Call   Robert Martinez   Best Relocation   P5562401          Patrick   ● Booked
6:04    Form   Jenna Torres      Top10 Forms       ref 88213         Patrick   Still open
5:52    Call   Alan Kessler      Best Relocation   P5562399          Jacob     Still open
5:12    Form   Marcy Sloan       MoveBuddha        ref 88204         —         Marked bad lead

                                                                          [ Show more ]
```

- **The name column is the full name.** He uses it to recognise a customer at a
  glance — that is the whole point of the §2.3 deviation.
- Call leads have no reference number. The cell reads the job number, or `—`.
  It never reads `ref_no: null`.
- Empty: `No leads reached Vantage in the last 24 hours.` `[ Show the last 48 hours ]`
- Filtered empty: `No leads match these filters.` `[ Clear filters ]`

### 4.7 Booked & cancelled

```
[ Bookings (9) ]  [ Cancellations (2) ]

Recorded   Book date            Job        Customer        Agents      Binder    Deposit   Merchant
6:01 AM    Aug 12  Back-dated   P5562014   Carla Hughes    Patrick     $770      $814      Stripe
           7 days
5:44 AM    Aug 19               P5562444   Chris Adler     Jacob       $1,020    $1,064    Stripe
1:15 AM    Aug 08  Back-dated   P5562344   Kim Walters     Jacob +1    $1,410    $1,502    Stripe
           12 days
─────────────────────────────────────────────────────────────────────────────────────────────
Total for the last 24 hours                                            $3,200    $3,380

Recorded is when it reached Vantage. Book date is the date written on the booking.
They are often different, and only Recorded decides whether a row shows up here.
```

The "Back-dated 12 days" chip is the moment the `activity_at` rule stops being a
specification paragraph and becomes obvious. Rows 1 and 3 are exactly the rows
that would vanish under a book-date filter — showing the gap is how he learns
that without anyone explaining it.

`Jacob +1` tooltip: *"Split between 2 agents: Jacob, Patrick. Open the row for
the split."*

Cancellations:

```
Recorded   Cancel date   Job        Customer        Refund   Reason          Recorded by
5:22 AM    Aug 19        P5562188   Tara Reyes      $600     Date changed    Jacob
3:07 AM    Aug 14        P5561902   Luis Prado      $500     Found cheaper   Patrick
──────────────────────────────────────────────────────────────────────────────────────
Total refunded in the last 24 hours                $1,100
```

### 4.8 Waiting on you

```
[ Bookings (3) ]  [ Cancellations (1) ]                  3 waiting · oldest has been waiting 4h 12m

These came from Granot and need an official Vantage record.
Open one to finish it — the same screen you use from Intakes in the sidebar.

Job        Why it's here                    What Vantage has           Next step                          Customer   Came from         Waiting
P5562401   Granot recorded a booking        No official Vantage        Open this case to choose a lead    R•••       Best Relocation   10m
           2 Granot updates on this job     booking yet                and enter official binder,                                      [ Open and review ]
                                                                       deposit, agents, and merchant.
P5562388   Granot set this lead to          No official Vantage        Open this case to choose a lead    •••7731    Top10 Forms       1h 31m
           priority 5 (booked)              booking yet                and enter official binder…                                      [ Open and review ]
```

Every sentence in the "Why it's here", "What Vantage has", and "Next step"
columns comes from the **existing** `components/intakes/intake-copy.ts`
(`intakeWhyHere`, `intakeWhatVantageHas`, `intakeNextStep`). Nothing is
re-authored. `/daily` and `/intakes` describe the same case with the same words,
because they call the same function.

Contact stays masked here — the case projection is shared with `/intakes` and its
masking is not ours to relax.

**Day one, with both command flags off**, every row shows `[ Open and review ]`
plus:

> You can open this and see everything Granot sent. Entering the official record
> from here isn't switched on yet.

No disabled button. A greyed-out `[ Finish booking ]` tells the Owner he lacks a
permission, which is false, and it is the exact wrong thing to tell the person
who owns the company.

### 4.9 Capability panel

```
┌──────────────────────────────────────────────────────────────────────────────┐
│                                                                              │
│              ⚙  Booking intakes aren't switched on yet                       │
│                                                                              │
│   Nothing is being lost. Granot updates are still being recorded, and        │
│   they'll turn into items here the moment this is switched on.               │
│                                                                              │
│                        [ See system status → ]                               │
│                                                                              │
│   ▸ Technical detail                                                         │
└──────────────────────────────────────────────────────────────────────────────┘
```

Expanded, `Technical detail` reads
`GRANOT_LIFECYCLE_BOOKING_CASES_ENABLED is currently off.` — which satisfies
ODR-35's "the pane renders the exact flag name" criterion without putting an
environment variable in front of the Owner.

### 4.10 Empty window

```
┌──────────────────────────────────────────────────────────────────────────────┐
│              Nothing has reached Vantage in the last 12 hours.               │
│                     [ Show the last 24 hours ]                              │
└──────────────────────────────────────────────────────────────────────────────┘
```

Three states that must never look alike: a genuinely empty window (this), a pane
that isn't switched on (§4.9), and a loading skeleton. Different shape,
different words, every time.

### 4.11 Drawer

```
┌────────────────────────────────────────────────────────────┐
│ Robert Martinez · P5562401                        [ ✕ ]    │
│ ( Details │ Where this came from )                         │
├────────────────────────────────────────────────────────────┤
│ Contact                                                    │
│   Name    Robert Martinez                                  │
│   Phone   (402) 215-5590                                   │
│   Email   robert@example.com                               │
│                                                            │
│ Where it came from                                         │
│   Source     Best Relocation                               │
│   Campaign   Best Relocation — calls                       │
│                                                            │
│ The move                                                   │
│   Pickup     Council Bluffs, IA 51501                      │
│   Delivery   Cypress, TX 77433                             │
│   Size       300 cu ft                                     │
│                                                            │
│ How we handled it                                          │
│   Recorded   Aug 20, 6:09 AM                               │
│   Agent      Patrick                                       │
│   Lead cost  $42.00                                        │
│                                                            │
│ ● Booking · P5562014                                       │
│   Book date  Aug 12   ← 8 days before this lead came in    │
│   Deposit    $814                                          │
│   Binder     $770                                          │
│   Merchant   Stripe                                        │
│                                                            │
│                                      [ Open the full record ]│
└────────────────────────────────────────────────────────────┘
```

Full contact appears here and only here. This is the only surface in the pack
that carries an unmasked phone or email, and it is Owner-only at three gates.

---

## 5. `lib/daily/provenance-story.ts`

The most valuable module in the pack, and the one the issues currently do not
ask for.

### 5.1 Why a translation layer exists

`components/granot-lifecycle/job-timeline.tsx` renders the chain as:

```
Observation            valid; 0 issue(s)
Decision               matched: granot_priority
Record Link change     established; revision 1
Entity Change          revision 3 → 4
6a761d3d7ceae445794c57bd
```

That is correct, and it is the right thing on
`/ingestion/granot/lifecycle/jobs/:jobNo`, which exists for whoever is debugging
the pipeline. Shown to the Owner, it answers a question he did not ask.

`toProvenanceStory()` maps the **same** `GranotTimelinePage` — same server
projection, same ordering, same cursor, no new entry type, no second endpoint —
into sentences. `JobTimeline` is then mounted **unchanged** inside a collapsed
`Technical detail` section, so a screenshot he forwards still carries everything
we need.

### 5.2 Shape

```ts
import type { GranotTimelineEntry, GranotTimelinePage } from "@/lib/api/granotLifecycle";

export type ProvenanceStep = {
  id: string;                       // entry.id — React key
  at: string;                       // ISO, rendered with formatDateTime
  headline: string;                 // "Granot marked this booked"
  detail: string | null;            // "The lead's priority changed to 5 in Granot."
  tone: "neutral" | "good" | "attention";
};

export type ProvenanceStory = {
  summary: string;                  // §5.4 — the one sentence he actually reads
  steps: ProvenanceStep[];          // chronological, oldest first
};

export function toProvenanceStory(page: GranotTimelinePage): ProvenanceStory;
```

**Oldest first.** The timeline projection is newest-first for paging; the story
is a narrative and reads forward. Reverse it in the mapper, not in the component.

### 5.3 The mapping

Every entry type. Unmapped values fall through to the row's default sentence and
**never** render a raw code.

| Entry | Headline | Detail |
| --- | --- | --- |
| `observation` | Granot sent an update | `valid` → "We read it without any problems." · `valid_with_issues` → "We read it, but some fields didn't look right." · `invalid` → "We couldn't read it. Nothing was changed." · `unsupported` → "It was a kind of update we don't handle. Nothing was changed." |
| `priority_effect` (priority 5) | Granot marked this booked | "The lead's priority changed to 5 in Granot." |
| `priority_effect` (other) | Granot changed the priority | "Priority is now {value}." |
| `booking_action` `booked` | Granot recorded a booking | "On job {job}." |
| `booking_action` `release` | Granot recorded a cancellation | "On job {job}." |
| `decision` | Vantage checked it | By outcome, then a mode note — §5.3.1 |
| `case` `opened` | Sent to your Intakes | "Waiting for you to enter the official {booking\|cancellation}." |
| `case` `refreshed` | Granot sent more on the same job | "Still waiting on you." |
| `case` `resolved` | You finished this one | "The official {booking\|cancellation} was recorded." |
| `discrepancy` `open` | Granot and Vantage don't match | "Open it to sort out which one is right." |
| `discrepancy` `resolved` | The mismatch was sorted out | *(none)* |
| `record_link_change` `established` | Matched to a lead | "Job {job} is now tied to this lead." |
| `record_link_change` `refreshed` | Match confirmed | *(none)* |
| `record_link_change` `corrected` | Match corrected | "This job was pointed at a different lead." |
| `record_link_change` `superseded` | Match replaced | "A newer match took over." |
| `entity_change` | Vantage record updated | "Changed: {friendly fields}." — §5.3.2 |
| `official_booking` | Booking created in Vantage | "Job {job}." |
| `official_cancellation` | Cancellation recorded in Vantage | *(none)* |

Tone: `good` for `official_booking`, `case:resolved`, `record_link_change:established`.
`attention` for `discrepancy:open`, `case:opened`, and `observation` with
`invalid`/`unsupported`. `neutral` for everything else.

#### 5.3.1 Decisions

```ts
const DECISION_OUTCOME: Record<string, string> = {
  matched:   "Matched to the right lead in Vantage.",
  created:   "Created a new lead in Vantage.",
  no_match:  "Couldn't find a matching lead in Vantage.",
  ambiguous: "Found more than one possible match, so nothing was changed.",
  skipped:   "Nothing needed to change.",
};
const DECISION_DEFAULT = "Reviewed and recorded.";

// Appended when the decision did not actually change anything:
const SHADOW_NOTE = "Watching only — nothing in Vantage was changed.";
// entry.data.execution_mode === "live" ? "" : SHADOW_NOTE
```

**At implementation, enumerate the real values** from
`src/services/granotLifecycle/synchronizeLeadTypes.ts` and complete the map. Any
value not in the map renders `DECISION_DEFAULT`. Never
`` `Decision: ${outcome}` ``, and never the `reason_code`.

The `SHADOW_NOTE` matters more than it looks. With every effect flag checked in
`false`, most decisions on this board **are** shadow. Without that line, the
Owner reads "Vantage checked it — matched to the right lead" and concludes his
records were updated. They were not.

#### 5.3.2 Changed fields

```ts
const FIELD_LABELS: Record<string, string> = {
  booked: "marked booked",
  cancelled: "marked cancelled",
  over_2000: "over $2,000",
  over_4000: "over $4,000",
  deposit_amount: "deposit",
  total_binder_amount: "binder",
  agent_allocations: "agents",
  merchant: "merchant",
  book_date: "book date",
  cancel_date: "cancel date",
  refund_amount: "refund",
  customer_name: "customer name",
  job_no: "job number",
  normalized_job_no: "job number",
  receiver_agent: "assigned agent",
  receiver_agent_name_snapshot: "assigned agent",
  move_date: "move date",
  cubic_feet: "cubic feet",
  quoted: "quoted",
  bad_lead: "bad lead",
  cpl: "lead cost",
};

/** Unknown paths are dropped, never printed. */
export function changedFieldsSentence(paths: string[]): string {
  const labels = [...new Set(paths.map((p) => FIELD_LABELS[p.split(".")[0]!]).filter(Boolean))];
  if (labels.length === 0) return "Some details were updated.";
  if (labels.length === 1) return `Changed: ${labels[0]}.`;
  return `Changed: ${labels.slice(0, -1).join(", ")} and ${labels.at(-1)}.`;
}
```

The `filter(Boolean)` is the rule from §1.1: dropping an unmapped path is always
better than printing `cpl_resolution_version`.

### 5.4 The summary sentence

The one line he actually reads. Built from the first and last meaningful steps:

```
Came in as a call lead from Best Relocation at 6:09 AM, matched to Granot job
P5562401 at 6:09 AM, and became a booking in Vantage at 6:14 AM.
```

Short chain:

```
Came in as a form lead from Top10 Forms at 6:04 AM. Nothing further has happened yet.
```

Shadow-only chain — the common day-one case:

```
Granot sent updates on job P5562388 starting at 4:41 AM. Vantage is watching
these but hasn't changed any records yet.
```

Booking with no prior lead:

```
Entered directly in Vantage on Aug 20 at 6:01 AM. There's no Granot history
before that.
```

### 5.5 Panel layout

```
┌── Where this came from ──────────────────────────────────────────────┐
│  Came in as a call lead from Best Relocation at 6:09 AM, matched to  │
│  Granot job P5562401 at 6:09 AM, and became a booking in Vantage at  │
│  6:14 AM.                                                            │
│                                                                      │
│  ●  6:09 AM   Granot sent an update                                  │
│  │            We read it without any problems.                       │
│  │                                                                   │
│  ●  6:09 AM   Vantage checked it                                     │
│  │            Matched to the right lead in Vantage.                  │
│  │            Watching only — nothing in Vantage was changed.        │
│  │                                                                   │
│  ●  6:09 AM   Matched to a lead                                      │
│  │            Job P5562401 is now tied to this lead.                 │
│  │                                                                   │
│  ●  6:14 AM   Vantage record updated                                 │
│  │            Changed: marked booked and over $2,000.                │
│  │                                                                   │
│  ●  6:14 AM   Booking created in Vantage                             │
│               Job P5562401.                                          │
│                                                                      │
│                       [ Show earlier ]                               │
│                                                                      │
│  ▸ Technical detail                                                  │
└──────────────────────────────────────────────────────────────────────┘
```

`Technical detail` expands to `<JobTimeline page={page} />`, unmodified.

`[ Show earlier ]` pages on the timeline's own `next_cursor`. Label is
"Show earlier", not "Load earlier" — he is not loading anything.

### 5.6 When there is nothing to show

Four codes, four sentences. Never one generic line for four different
situations, and never an empty list.

| `provenance.code` | Sentence |
| --- | --- |
| `no_job_number` | There's no Granot job number on this record, so there's no Granot history to show. |
| `referral_booking` | This is a referral booking. It was entered directly in Vantage and never came from Granot. |
| `leadless_booking` | This booking was entered without a lead attached, so there's no history before it. |
| `no_record_link` | This record was never matched to a Granot job. If it should have been, it will show up here once it is. |

All four are **normal**, and none of them is styled as an error. A leadless
booking is a legitimate way to book. If it renders in red, he will report it as
a bug every time.

---

## 6. Accessibility copy

| Element | Copy |
| --- | --- |
| Window toggle group | `aria-label="Show me the last"`, options as radio buttons with `aria-pressed` |
| Live indicator | `role="status"` `aria-live="polite"` — announces on transition only, never every 3s |
| New feed rows | Container `aria-live="polite"` `aria-relevant="additions"`; each row's accessible name starts with the time and the kind |
| Tab badges | `aria-label="3 items waiting on you"`, not the bare number |
| Back-dated chip | `title` and `aria-label` = `backDatedTooltip(...)` |
| Drawer | `role="dialog"` `aria-modal="true"`, labelled by the customer name, focus trapped, `Esc` closes, focus returns to the row |
| Sort/filter changes | `role="status"` announcing `"Showing 41 form leads"` |
| Loading | `role="status"` with `LOADING_ANNOUNCEMENT`, skeletons `aria-hidden` |

Do not announce the live poll every three seconds. Announce only when `status`
changes, or a screen reader user will hear the board talk over them all morning.

---

## 7. Review checklist

Run before ODR-36 and ODR-37 close:

- [ ] `grep -rn "Observation\|Decision\|Record Link\|revision\|receipt\|projection\|capability\|shadow" components/daily/` returns nothing outside a collapsed technical section.
- [ ] No `snake_case` string can reach the DOM — `changedFieldsSentence` drops unmapped paths; decision outcomes fall back to a sentence.
- [ ] Every empty state names what would make something appear.
- [ ] Every "not switched on" state says nothing is being lost.
- [ ] No disabled action button anywhere on the board.
- [ ] The `activity_at` note appears under the date range on every tab.
- [ ] The full customer name appears in lists; phone and email appear only in the drawer.
- [ ] The four no-provenance sentences are distinct and none is styled as an error.
- [ ] `/daily` and `/intakes` describe the same case with byte-identical sentences, because both call `intake-copy.ts`.
- [ ] Read the whole board out loud. Anything you would not say to him in his office comes out.
