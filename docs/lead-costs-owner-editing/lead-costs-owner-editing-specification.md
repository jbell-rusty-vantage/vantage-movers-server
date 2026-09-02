---
type: Specification
title: Operations Registry Lead Costs — Owner date-range editing
description: >-
  Make Lead Costs editable the way the Owner thinks: pick a Feed, from
  date, through date, set the lead cost. Add a server set_range command
  so Advanced no longer asks for period IDs, JSON, or command names.
  Schedule edits still never rewrite stamped Lead CPL. Corrections stay
  the backfill.
tags:
  - operations-registry
  - cpl
  - admin-dashboard
  - owner-dashboard
status: proposed-final
stale_after: 2026-12-02
owners: [team:main-server, team:vantage-admin]
applies_to:
  - src/services/operationsRegistry/cplSchedule.ts
  - src/validation/v1/operationsRegistry.validation.ts
  - src/routes/v1.routes.ts
  - .cursor/rules/cpl-operations.mdc
  - ../vantage-admin/components/operations-registry/cpl-manager.tsx
  - ../vantage-admin/lib/api/registryCpl.ts
  - ../vantage-admin/lib/api/registryEntityLinks.ts
  - ../vantage-admin/lib/operations-registry/ownerLanguageDeck.ts
sources:
  - id: glossary
    resource: ../../../CONTEXT.md
    title: Platform glossary
  - id: cpl-rule
    resource: ../../.cursor/rules/cpl-operations.mdc
    title: Temporal CPL operations
  - id: registry-service
    resource: ../knowledge/services/operations-registry.md
    title: Operations Registry service
  - id: owner-language
    resource: ../../src/services/operationsRegistry/ownerLanguageDeck.ts
    title: Owner language deck
  - id: source-connections
    resource: ../operations-registry-source-connections-owner-ui-specification.md
    title: Source connections Owner UI (Lead source / Feed)
---

# Operations Registry Lead Costs — Owner date-range editing

> **Contract maturity: implementation-ready.** Product rules in this file
> win. File citations are evidence; reverify line numbers at
> implementation. Agents work from [`README.md`](README.md) →
> [`AGENT-PROTOCOL.md`](AGENT-PROTOCOL.md) → the matching issue. Do not
> start coding from chat notes.

**Prepared:** 2026-09-02
**Repos:** `vantage-main-server` (new `set_range` command + schedule
construction). `vantage-admin` (Lead Costs Owner UI).
**Owner-facing labels:** Lead costs, Current rates, By date, Existing
leads, Lead source, Feed, From, Through, Ongoing, Amount, Lead cost
**Canonical facts:** [CPL](../../../CONTEXT.md),
[CPL Schedule](../../../CONTEXT.md),
[CPL Rate Period](../../../CONTEXT.md),
[CPL Correction](../../../CONTEXT.md),
[Source Company](../../../CONTEXT.md),
[Source Granularity](../../../CONTEXT.md),
[Lead](../../../CONTEXT.md),
[Form Lead](../../../CONTEXT.md),
[Call Lead](../../../CONTEXT.md)

---

## 0. Authority

Read in this order. Stop and report contradictions; do not silently merge.

| Order | Authority | Wins on |
| --- | --- | --- |
| 1 | **This file** | Owner Lead Costs IA; `set_range`; what the Owner never sees |
| 2 | [`cpl-operations.mdc`](../../.cursor/rules/cpl-operations.mdc) | Continuity, exclusive storage, cents, revision, schedule-never-rewrites-Leads |
| 3 | Current `cplSchedule.ts` / `cplCorrections.ts` | Existing command and correction semantics this pack does not reopen |
| 4 | Workspace-root [`CONTEXT.md`](../../../CONTEXT.md) | Words. Do not invent synonyms |
| 5 | Owner language deck (Lead source / Feed) | Owner-visible strings on Operations Registry |
| 6 | Pack issues | Sequencing and scope only |

Where an issue and this file disagree, this file wins and the issue
author fixes the issue in the same change.

---

## 1. Decision

The Owner does not think in `correct_period`, `replace_schedule`,
period IDs, or JSON. They think:

> For this Feed, from this date through that date, the lead cost is $X.

That is the default Advanced action. The server grows one new
construction, `set_range`, so the dashboard can submit that intent in
one transaction. The four existing Advanced commands stay on the API
for compatibility. The Owner never sees their names.

**Simple** stays the bulk “change several Feeds from one date onward”
desk. **Corrections** stay the only way to rewrite CPL already stamped
on Leads. This pack does not merge those jobs.

---

## 2. Why the current Advanced tab fails

Observed 2026-09-02 in
`vantage-admin/components/operations-registry/cpl-manager.tsx`.

1. Default command is `add_future` — one date, open-ended only. No
   through date.
2. `correct_period` requires a pasted Period ID and only changes the
   amount on an *existing* slice. It cannot set a new window.
3. `replace_schedule` is a JSON textarea. The Owner cannot rebuild a
   timeline without writing
   `{ effective_from_date, effective_until_date?, amount }`.
4. `split` is timeline surgery. It is how a bounded window is faked
   today — two splits plus a period-amount fix, each bumping
   `schedule_revision`.
5. Copy says “Granularity”, “CPL”, “correct_period”, and shows raw
   Mongo IDs. The Owner language deck bans `granularity` and flags
   24-character hex IDs.
6. Schedule edit and CPL Correction share the word “correction”. The
   Owner cannot tell which one changes existing Leads.

There is **no** server operation that overlays an amount onto an
inclusive `[from, through]` window and leaves the rest of the CPL
Schedule intact. Composing `split` + `correct_period` in the browser
is rejected: each step needs a fresh period identity and revision.

---

## 3. What this pack does not reopen

These stay exactly as shipped:

- `cpl_rate_periods` is the writable CPL authority. Legacy `cpl_rates`
  and the Legacy CPL tab stay read-only compatibility.
- Owner dates are `America/New_York` calendar dates. Storage is
  inclusive start + next-local-midnight exclusive end, plus the date
  strings. Money is non-negative integer cents.
- Active CPL Schedules are continuous, non-overlapping, and end with
  exactly one open-ended CPL Rate Period. Explicit zero is a valid
  amount. Missing coverage is not zero.
- `schedule_revision` optimistic locking. Writes build the full result
  in memory, then persist periods + revision + Registry Change in one
  transaction.
- Schedule edits never rewrite prior Leads. CPL Correction is the
  separate preview / apply job (`CPL_PREVIEW_STALE`, leases, 366-day
  window, 250 reviewed leads).
- Resolve Lead CPL from the Lead business `timestamp`, not `createdAt`.
- Owner-only mutations. Admin is read-only on Lead Costs.
- Simple schedule semantics: from `effective_date` onward, one new
  open period per changed Source Granularity; later periods after that
  date are replaced. This pack only changes Simple *copy*, not the
  construction.

---

## 4. Owner mental model

### 4.1 Three desks

URL ids stay `simple | advanced | corrections` so existing
`cpl_mode` deep links keep working. Owner labels change.

| URL id | Owner label | Job |
| --- | --- | --- |
| `simple` | **Current rates** | Change today’s amount on one or many Feeds, from one effective date onward |
| `advanced` | **By date** | Set the lead cost for one Feed between two dates (or onward) |
| `corrections` | **Existing leads** | Backfill CPL already stored on Form Leads and Call Leads |

Default when `cpl_mode` is absent remains **Current rates** (`simple`).
Deep links that already open `cpl_mode=advanced` land on **By date**,
and the date-range form is what they see — not a command dropdown.

### 4.2 The sentence the Owner is writing

On **By date**:

1. Pick the **Feed** (Source Granularity). Show Lead source company +
   Feed display name + channel. Never label the control “Granularity”.
2. **From** — inclusive NY business date. Default today.
3. **Through** — inclusive NY business date, **or** **Ongoing**
   (no through date; the new amount continues).
4. **Amount** — dollars, including explicit $0.00.
5. Optional **Reason**.
6. Read a one-line preview, glance at the after-save timeline, **Save**.

Example preview:

> $185.00 from 2026-03-01 through 2026-06-30 for Top10 Inbounds.

Ongoing preview:

> $185.00 from 2026-03-01 onward for Top10 Inbounds. Any later
> scheduled rates after this date will be replaced.

Through is required unless Ongoing is checked. Do not default Through
to today (that would silently close the current open period on today).

### 4.3 One Feed, not the whole Source Company

By date edits one Source Granularity. If the Owner wants the same
amount on every Feed of a Source Company from one date onward, they
use Current rates and edit those rows together. Do not invent a
company-wide Advanced overlay in this pack.

---

## 5. Server — `set_range`

### 5.1 Why a new command

`add_future` only splits the open tail. `correct_period` only retints
an existing slice. `split` cuts once. `replace_schedule` throws the
timeline away. None of them is “set $X from F through T, keep the
rest.” The construction must be one in-memory rebuild + one
revision increment. The Admin client must not chain commands.

### 5.2 API

Same route as the other Advanced commands:

`POST /api/v1/admin/source-granularities/:id/cpl-schedule/commands`

Add a fifth discriminated `operation`:

```ts
{
  operation: "set_range";
  expected_revision: number;
  from_date: string;          // YYYY-MM-DD, NY business
  until_date?: string;        // inclusive YYYY-MM-DD; omit = Ongoing
  amount: number;             // non-negative, max 2 decimals
  reason?: string;
}
```

`until_date` uses the same inclusive Owner meaning as
`replace_schedule`’s `effective_until_date` and Corrections
`window_until`. Storage still converts with
`ownerInclusiveEndDateToExclusive`.

The four existing operations remain valid. Zod: extend
`advancedCplScheduleCommandSchema`. Route mapping: add
`type: "set_range"` next to the existing `operation` → `type` switch
in `v1.routes.ts`.

`constructAdvancedCplSchedule` gains a `set_range` case. Persist,
audit, cache invalidation, and `REGISTRY_STALE_REVISION` stay on
`mutateAdvancedCplSchedule`. Audit metadata `operation` is
`set_range`.

### 5.3 Construction

Inputs: current active periods (unarchived), `from_date` F, optional
inclusive `until_date` T, `amount` X.

**Reject before construction** (`REGISTRY_DEPENDENCY_CONFLICT` unless
noted):

| Condition | Owner-safe error (server `error` string) |
| --- | --- |
| Invalid / non-NY date | Existing business-date validation |
| T present and T < F | `Through date must be on or after the from date.` |
| Active Feed with a non-empty schedule and F is before the first period’s `effective_from_date` | `Lead cost history for this feed starts on {first}. Choose a from date on or after that day.` |
| Active Feed with an empty schedule and T is present | `A new feed needs an ongoing rate first. Leave Through empty, or set the first rate under Current rates.` |
| Amount invalid | Existing money validation |

**Build:**

1. Convert X to cents. Convert F to the start instant. If T is
   present, `rangeEndExclusive` is the exclusive instant of T
   (local midnight on T+1). If T is omitted, there is no range end.
2. **Keep** every period whose exclusive end is at or before F
   (`effective_until <= start(F)`).
3. **Prefix.** If a period starts before F and still covers F, keep a
   truncated copy that ends at F (exclusive date string = F,
   `supersedes` the original).
4. **New slice.** Insert one period: start F, amount X, end T
   (inclusive) or open if T is omitted.
5. **Tail (T present only).** If a period covers the first instant on
   or after `rangeEndExclusive`, keep a copy that starts on T+1
   (`effective_from_date` = exclusive date of T) with that period’s
   original amount and original end (or open). Then keep every later
   period that starts at or after `rangeEndExclusive`. Drop the
   interiors that sat inside `[F, T]`.
6. **Tail (T omitted).** Drop every period that starts at or after F.
   The new slice is the open final period. This matches Simple /
   `add_future` “from this date onward.”
7. **Coalesce** adjacent periods that share `amount_cents` into one
   period spanning the union. Lineage: the surviving row
   `supersedes` the first archived id in the merge when one exists.
   Coalesce belongs to `set_range` only. Do not change
   `add_future` / `split` / `correct_period` / `replace_schedule`.
8. `validateCplSchedule` with `coverage_start_date` = the first
   current period’s start (same as other Advanced mutations).
9. If the constructed dates + amounts equal the current schedule,
   return `{ changed: false }` and do not bump the revision.

Active Feeds still require exactly one open final period. A bounded
`set_range` that lands inside an open tail must therefore emit the
open tail after T at the amount that previously covered T+1.

### 5.4 Equivalence (do not teach these to the Owner)

| Owner action | Existing command it replaces |
| --- | --- |
| From F, Ongoing, new amount | Simple (one Feed) or `add_future` when F is after the open period’s start |
| From and Through equal one existing period, new amount | `correct_period` |
| From F through T inside one period | two `split`s + `correct_period` |
| From F through T across several periods | a chain of splits and amount fixes |

Tests must prove those equivalences for representative fixtures,
including a one-day window (F = T), a window that hits the open tail,
a window entirely in the past, and a no-op when X already applies.

### 5.5 Leads

`set_range` never writes Form Lead or Call Lead documents. If F is
on or before today (NY), the Admin UI offers Existing leads with the
window pre-filled. That is presentation. The server command does not
start a CPL Correction job.

---

## 6. By date — Owner UI

Primary implementation:
`vantage-admin/components/operations-registry/cpl-manager.tsx`.

### 6.1 Layout (top to bottom)

1. Shared Lead Costs banner (rewritten — §8).
2. Mode tabs with the §4.1 Owner labels.
3. **Feed** select. Options: `{Lead source company} — {Feed display
   name} ({channel})`. Prefer `owner_label` for the Feed name. Deep
   link `entity` / `feed` pre-selects that Source Granularity.
4. Timeline of the loaded CPL Schedule, three groups: **Past**,
   **Now**, **Later**. Each row: amount + inclusive From + Through
   (or **Ongoing**). **No Period ID.** Clicking a row fills From,
   Through (or Ongoing), and Amount so the Owner can retint that
   slice or widen it.
5. The date-range form (§4.2).
6. **After you save** — the constructed timeline the server will
   persist, computed by a client helper that mirrors §5.3, or by
   showing the current timeline plus a plain-language diff when a
   client preview helper is enough. The helper is tested. If the
   client preview and the server ever disagree, the server wins; the
   next save error must be Owner-readable.
7. **Save lead cost** (not “Run command”).
8. Collapsed **More schedule tools** (§6.3). Hidden until opened.
   Admin role: form and tools hidden; timeline remains visible.

### 6.2 What the Owner never sees on By date

- `add_future`, `split`, `correct_period`, `replace_schedule`,
  `set_range`
- Period IDs, `expected_revision`, `schedule_revision`
- JSON, exclusive end dates, `amount_cents`, `supersedes`
- The word **Granularity**
- Raw 24-character hex ids in ordinary copy (deep-link fallback may
  keep the id in a developer `details` only, not in the default
  sentence)

`expected_revision` still travels on the wire from the loaded
schedule. Stale: existing `REGISTRY_STALE_REVISION` handling —
refresh the timeline and say **Someone else changed this feed.
Refresh and try again.**

### 6.3 More schedule tools

One collapsed block. Two tools only.

**Rebuild the whole timeline.** Structured rows, not a textarea.
Each row: From, Through (last row may be Ongoing), Amount. Add / remove
row. Submit as today’s `replace_schedule` body. Client maps inclusive
Through → `effective_until_date`. Confirm copy:

> This replaces the entire lead-cost timeline for this feed. Existing
> leads keep their stored costs until you update them under Existing
> leads.

**Change several feeds from one date.** Link that switches to
Current rates. Do not duplicate the Simple table here.

Do not expose `split` or `correct_period` as named tools. `set_range`
covers them.

### 6.4 Client types

`AdvancedCplScheduleCommand` in `registryCpl.ts` gains the
`set_range` variant. The default By date submit uses only that
variant. Rebuild uses `replace_schedule`. Keep the other variants in
the type union so old tests and any remaining callers compile; the
Owner form does not send them.

---

## 7. Current rates and Existing leads

### 7.1 Current rates (Simple)

Keep the snapshot table and one shared effective date. Change the
card title to **Current lead costs**. Description:

> Edit today’s amount for any feed. Saving sets that amount from the
> effective date onward. Later scheduled rates after that date are
> replaced. Existing leads keep the cost they already have.

When the Owner has typed a new amount and the effective date is in
the past, show the same Existing-leads offer as §8.2.

Missing vs $0.00 stays as shipped (`Missing` is not `$0.00`).

### 7.2 Existing leads (Corrections)

Keep preview → confirm → job poll. Change the card title to
**Update existing leads**. Description:

> After you change a lead-cost schedule, leads that already arrived
> still hold their old cost. Preview a feed and date window, then
> confirm to rewrite those stored costs.

Delete the sentence that names `correct_period`. Typical-flow copy:

> First save the schedule under Current rates or By date, then
> preview here.

Window fields stay **From** / **Through** (not “Window from”).
Feed select uses the same Owner option string as By date.

Caps (366 inclusive days, 250 reviewed leads) stay. Say them in
Owner language, not `window_until`.

---

## 8. Shared copy and handoff

### 8.1 Banner (all three desks)

Replace the current CPL / “ordinary schedule edits” banner:

> Changing a lead-cost schedule does not change leads that already
> arrived. Use Existing leads when you also need those stored costs
> updated.

### 8.2 Offer after a past-dated save

After a successful Current rates or By date save whose affected
dates include today or earlier (NY):

> Saved. Existing leads in that date range still have their old
> cost. Update existing leads?

The button opens Existing leads with Feed + From + Through filled
from the save (Through = min(T, today) when T is present; today when
Ongoing). It does not auto-preview.

Future-only saves (F > today) do not show this offer.

### 8.3 Owner language

| Implementation | Owner |
| --- | --- |
| CPL | Lead cost |
| Source Granularity | Feed |
| Source Company | Lead source |
| `effective_until_date_exclusive` | Through (inclusive) or Ongoing |
| `cpl_mode=simple` | Current rates |
| `cpl_mode=advanced` | By date |
| `cpl_mode=corrections` | Existing leads |
| `correct_period` | (do not say) |
| Period ID | (do not show) |

`CplManager` Owner markup must pass `findOwnerMarkupLeaks`. Extend
`language-deck.test.ts` to include this surface. `details` blocks
may hold implementation names for a developer; the deck already
strips `details`.

---

## 9. URL and deep links

| Param | Meaning | This pack |
| --- | --- | --- |
| `tab=lead-costs` | Registry tab | unchanged |
| `cpl_mode` | `simple \| advanced \| corrections` | persist when the Owner clicks a mode tab (today the click does not write the URL) |
| `entity` | Source Granularity id on By date; correction job id on Existing leads | keep; By date also accepts `feed=` as an alias for the same id |
| Lead-source readiness `open_lead_costs` | today `?tab=lead-costs` only | become `?tab=lead-costs&cpl_mode=simple&feed={id}` when a Feed id is known |

`registry-shell` currently strips every query key except `tab` when
the Owner changes registry tabs. This pack: when entering
`lead-costs`, keep `cpl_mode`, `entity`, and `feed`. When leaving
`lead-costs`, they may drop. Do not send those keys to any list API.

`registryEntityLinks` `cpl_schedule` stays
`cpl_mode=advanced` (By date). Labels: **Open lead cost schedule**
may become **Set lead cost by date**.

---

## 10. Tests

### 10.1 Server (`cplSchedule.test.ts` + validation tests)

- `set_range` bounded window inside one period → prefix + new + tail.
- Window spanning two or more periods → one new amount across the
  span; sides kept.
- F = T (one day).
- T omitted → open from F; later periods dropped.
- F = first day of the open period, T omitted, same amount → no-op.
- Equivalent to `correct_period` when `[F, T]` matches one period.
- Equivalent to `add_future` when T is omitted and F is after the
  open start.
- Reject T < F; reject F before coverage start on a non-empty active
  schedule; reject bounded range on an empty active schedule.
- Adjacent same-amount coalesce.
- DST around a March/November F or T (reuse existing NY helpers).
- `REGISTRY_STALE_REVISION` still 409.
- Existing `add_future` / `split` / `correct_period` /
  `replace_schedule` tests stay green.

### 10.2 Admin

- Default By date form has From, Through, Amount, Ongoing — no
  command `<select>` with operation names.
- Period list has no `ID:` line.
- Click period fills the form.
- Ongoing omits `until_date` on the POST body.
- Rebuild tool sends `replace_schedule` from structured rows, not
  `JSON.parse` of a textarea.
- Mode tab click writes `cpl_mode`.
- `findOwnerMarkupLeaks` on Lead Costs markup: no `granularity`, no
  raw command names in visible text, no default-path ObjectIds.
- Simple diff / revision helpers in `registryCpl.simple.test.ts`
  stay.
- Update `registryEntityLinks.test.ts` if href labels or `feed=`
  change.

### 10.3 Browser (LCE-05)

Local Admin **http://localhost:3000/operations-registry?tab=lead-costs**.
API **http://localhost:3001**. Sign in from `vantage-admin/.env`
`ADMIN_SEED_EMAIL` / `ADMIN_SEED_PASSWORD`. Do not paste them.

Walk: Current rates copy; By date set a bounded window; timeline
updates; no ID / JSON / command names; Ongoing path; click a Past
row and retint; Rebuild rows (do not have to persist a wipe on a
real feed if a dry preview is enough — prefer a local unused Feed);
Existing leads offer after a past-dated save; Admin role is
read-only.

---

## 11. Acceptance

1. The Owner can set a lead cost for one Feed with From + Through +
   Amount in one save. The server does that in one `set_range`
   transaction.
2. By date is the default Advanced desk. No command dropdown, no
   Period ID, no JSON on the default path.
3. Ongoing is explicit. It replaces later scheduled rates after From.
4. Schedule saves do not write Lead documents. Existing leads remains
   the backfill, with a handoff after past-dated saves.
5. Owner labels: Lead cost, Feed, Lead source, Current rates, By
   date, Existing leads. No `granularity` in Owner markup.
6. The four old Advanced operations still work on the API.
7. Legacy CPL, Analytics, lead ingestion snapshots, and correction
   worker rules are unchanged.
8. `pnpm test && pnpm typecheck && pnpm lint` in each repo an issue
   touches.

---

## 12. Out of scope

- Legacy CPL book and `GET /api/v1/admin/cpl-rates`.
- Changing Simple’s construction (including that it drops later
  periods).
- Changing CPL Correction caps, leases, or hash freeze.
- Company-wide By date overlay.
- Rewriting Analytics or sheet spend reports.
- Auto-starting a correction job from a schedule save.
- Owner Daily View, operational list pages, Granot Lifecycle.
- Teaching the Owner exclusive ends or `schedule_revision`.

---

## 13. Knowledge after ship

- [`operations-registry.md`](../knowledge/services/operations-registry.md)
  — mention `set_range` next to the other Advanced constructions.
- [`cpl-operations.mdc`](../../.cursor/rules/cpl-operations.mdc) — one
  bullet that Owner date-range edits are `set_range`.
- `vantage-admin` CONTEXT pointer and
  `.cursor/rules/project-organization.mdc` Operations Registry row —
  Lead Costs desks are Current rates / By date / Existing leads.
- Workspace-root `CONTEXT.md` already names CPL Schedule, CPL Rate
  Period, and CPL Correction. Do not fork those sentences into Admin.

Invoke **docs-keeper** after the issue that lands the matching layer.
Do not invent new domain words.

---

## 14. File map

| Area | Path |
| --- | --- |
| Construction | `src/services/operationsRegistry/cplSchedule.ts` — `constructAdvancedCplSchedule`, `AdvancedCplOperation` |
| HTTP | `src/validation/v1/operationsRegistry.validation.ts`, `src/routes/v1.routes.ts` |
| UI | `vantage-admin/components/operations-registry/cpl-manager.tsx` |
| Client | `vantage-admin/lib/api/registryCpl.ts` |
| Links | `vantage-admin/lib/api/registryEntityLinks.ts` |
| Language | `ownerLanguageDeck.ts` (both repos) |
