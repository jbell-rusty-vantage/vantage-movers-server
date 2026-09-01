---
type: Specification
title: Operational surfaces — rows, filters, and tabbed detail panel
description: >-
  Keep the shared Admin OperationalResourcePage shell. Extract configs,
  filters, and detail from the monolith. Tab the detail panel for Form
  Leads, Call Leads, Bookings, and Cancellations. Cluster row actions and
  status. Group the filter sidebar. Remove raw JSON dumps. Admin
  presentation only — no main-server invariant changes.
tags:
  - admin-dashboard
  - form-lead
  - call-lead
  - booking
  - cancellation
  - owner-dashboard
status: proposed-final
stale_after: 2026-12-01
owners: [team:vantage-admin]
applies_to:
  - ../vantage-admin/components/operational/operational-resource-page.tsx
  - ../vantage-admin/components/ui/side-panel.tsx
  - ../vantage-admin/components/data-table/table-shell.tsx
  - ../vantage-admin/components/filters/
  - ../vantage-admin/lib/api/url-state.ts
sources:
  - id: glossary
    resource: ../../CONTEXT.md
    title: Platform glossary
  - id: admin-map
    resource: ../../vantage-admin/.cursor/rules/project-organization.mdc
    title: Vantage Admin project organization
  - id: form-lead-contacts
    resource: ./../form-lead-contact-snapshots-display-and-search-specification.md
    title: Form Lead contact snapshots (shipped)
  - id: bila
    resource: ./../booking-intake-lead-attachment/README.md
    title: Booking intake robustness pack (shipped)
  - id: lead-messaging
    resource: ./../knowledge/services/lead-messaging.md
    title: Lead Message service
---

# Operational surfaces — rows, filters, and tabbed detail panel

> **Contract maturity: implementation-ready.** Product rules in §§1–10 win.
> File citations are evidence; reverify line numbers at implementation.
> This file does not change main-server invariants, Daily View, Search,
> Intakes, or Observational tables.

**Prepared:** 2026-09-01
**Repos:** `vantage-admin` (implementation). `vantage-main-server` holds this contract only.
**Owner-facing labels:** Summary, Contact, Lead Message, Actions, Production record, Source Company, Source
**Canonical facts:** [Lead](../../CONTEXT.md), [Form Lead](../../CONTEXT.md), [Call Lead](../../CONTEXT.md), [Booking](../../CONTEXT.md), [Cancellation](../../CONTEXT.md), [Bad Lead](../../CONTEXT.md), [Lead Message](../../CONTEXT.md), [Source Company](../../CONTEXT.md), [Source Granularity](../../CONTEXT.md), [Leadless Booking](../../CONTEXT.md), [Connect Booking to Lead](../../CONTEXT.md), [Form Submitted Contact](../../CONTEXT.md), [Granot Contact Snapshot](../../CONTEXT.md)

---

## 1. Decision

The eight operational list routes already share one page module:
`OperationalResourcePage`. That orchestration is correct. Do not fork a
page per entity.

The detail panel is a single vertical scroll of `DetailSection` cards that
ends in a full-record JSON dump. Form Leads also dump Lead Message JSON.
The table is too wide because Book, Bad Lead, Related, and Delete are
prepended as separate columns. The filter sidebar lists every field in one
stack.

This work does three things on that shared shell:

1. **Detail panel** — destination tabs. Remove both JSON dumps.
2. **Rows** — identity cell, status chips, one sticky Actions cluster,
   selected-row highlight.
3. **Filters** — group Find / Status / Attribution / Record fields. Same
   URL filter keys.

Extract the monolith first so the later visual work sits behind small
seams. Agents may use 21st.dev (MCP or CLI) to craft the four named
shells in §9. A 21st.dev result must not rewrite the page architecture.

---

## 2. Scope of routes

| Route | `UiResource` | In this pack? |
| --- | --- | --- |
| `/form-leads` | `form-leads` | Yes — primary |
| `/call-leads` | `call-leads` | Yes — primary |
| `/bookings` | `bookings` | Yes — primary |
| `/cancellations` | `cancellations` | Yes — primary |
| `/duplicate-form-leads` | `duplicate-form-leads` | Yes — same columns/filters; `readOnly` |
| `/duplicate-call-leads` | `duplicate-call-leads` | Yes — same columns/filters; `readOnly` |
| `/customers` | `customers` | Yes — keep on the shell; do not regress |
| `/agents` | `agents` | Yes — keep on the shell; do not regress |

Out of this pack: `/search`, `/intakes`, `/bookings/reconciliation`,
`/conversations`, `/job-timeline`, Observational tables, Owner Daily View
(`/daily`). Those surfaces may keep deep-linking with `?record=`. They
must not be rewritten here.

---

## 3. How the shell works today (do not re-decide)

Read these before coding. Reverify at implementation.

- Every listed page is a three-line wrapper:
  `return <OperationalResourcePage resource="…" />`.
- List, sort, pagination, `q`, and `database_scope` live in
  `useUrlTableState`. Selected row is `?record=<mongoId>`. Bookings
  Connect opens with `?connect=1`.
- `apiFiltersFromUrlState` strips `record` and `connect` before the list
  API. Add `panel` to that strip list. Do not send UI-only keys to the
  server.
- Detail fetch is `fetchAdminDetail`. Production PATCH is
  `updateProductionRecord`. Bad Lead is `updateFormLeadBadLead`.
- Form submitted vs Granot lives in `form-lead-contacts.tsx` (shipped).
  Booking Stored lead / Connect lives in `components/bookings/` (BILA-03
  shipped). Do not fork those helpers.
- Sheet Sync is write-behind on the server. Production save already
  PATCHes and invalidates caches. There is no Owner “Sync” button today
  and this pack does not add one.
- Historical scope is read-only. Duplicate routes are `readOnly: true`.
  Referral Bookings hide production edit.

---

## 4. Locked decisions

1. **One shell.** Keep `OperationalResourcePage({ resource })` as the
   only page interface. Extract implementation; do not add a second list
   page type.
2. **Tabs are destinations, not buttons.** Book, Start cancellation, and
   Bad Lead live together on **Actions**. Do not make a tab per button.
3. **Hide empty tabs.** If a resource has no content for a tab, omit the
   tab. Do not render a stub.
4. **Say Lead Message.** Never “text message”, “SMS log”, or “Twilio
   Message” as the Owner tab label. The section may still show provider
   delivery fields (status, SID, timestamps) as facts.
5. **Bad Lead is Form Lead only.** [Bad Call](../../CONTEXT.md) is
   planned and not implemented. Do not add a mark-bad control on Call
   Leads.
6. **No Sync button.** Do not invent a production-record “sync” action.
   Save copy may say the table and detail caches were refreshed. Do not
   claim Google equals Mongo.
7. **No raw JSON.** Remove `DetailSection title="Raw Identifiers"` and
   the Lead Message “Message data” `JSON.stringify` dump. Keep the
   structured Lead Message fields, the message body, and the
   observational messaging-events link.
8. **Not Daily View.** Do not add Details / Provenance / Conversation
   tabs. Do not embed `ConversationPanel` on Call Leads. That drawer is
   a different planned surface.
9. **No new API filter keys** unless a group would otherwise be empty.
   Reuse the existing keys in §7.
10. **Owner-visible strings** live in one operational copy module
    (`operational-copy.ts`). Do not inline Owner sentences in JSX. Do
    not print snake_case field names as labels.
11. **Connect stays on Contact.** `?connect=1` opens the Bookings panel
    on `panel=contact` and starts `BookingStoredLeadSection` as it does
    today.
12. **Customers and Agents stay on the shell.** They get the extract,
    grouped filters, and a reduced tab set. They do not get Lead
    Message, Bad Lead, or Book / Cancel.

---

## 5. Extract seams (OSE-01)

`operational-resource-page.tsx` (~2,600 lines) is the page composer. After
OSE-01 it should import, not define, the following. Names may vary; the
seam must exist.

```text
vantage-admin/components/operational/
  operational-resource-page.tsx   # compose: URL, query, table, panel, dialogs
  operational-configs.ts          # ResourceConfig, columns, filters, edit fields
  operational-columns.tsx         # formatCell, buildColumns (until OSE-03)
  operational-filter-panel.tsx    # sidebar + mobile drawer (until OSE-04)
  operational-detail-panel.tsx    # SidePanel + sections (until OSE-02)
  operational-actions.tsx         # Book / Cancel / Bad Lead / related
  mark-bad-lead-control.tsx       # existing control, extracted
  lead-message-section.tsx        # today's SmsMessageSection, extracted
  operational-copy.ts             # Owner-visible strings
```

Rules for the extract:

- Behavior is byte-equivalent except the duplicate read-only banner,
  which today always says “Duplicate form leads”. Make that banner
  resource-aware (`Duplicate Form Leads` vs `Duplicate Call Leads`).
- Do not change column order, filter keys, or section order in OSE-01.
- `form-lead-contacts.tsx` and `components/bookings/` stay where they are.
- Tests that import `OperationalResourcePage` keep working.

---

## 6. Detail panel tabs

### 6.1 Shell

`SidePanel` gains a sticky tab strip under the title. The title stays
`{Resource title}` (drop the word “Detail” if it reads as noise; do not
invent a new title scheme per entity). The subtitle may keep
`Mongo ID: {id}`. Body scrolls; tabs do not.

Tab state is URL `?panel=<tab_key>`.

| Key | Owner label |
| --- | --- |
| `summary` | Summary |
| `contact` | Contact |
| `message` | Lead Message |
| `actions` | Actions |
| `production` | Production record |
| `source` | Source Company on lead resources; Source on Bookings and Cancellations |

Default: `summary`. Unknown or hidden `panel` → `summary`. Closing the
panel clears `record`, `panel`, and `connect`. Changing the selected
record keeps `panel` when that tab is still visible; otherwise `summary`.
`?connect=1` on Bookings forces `panel=contact`.

`apiFiltersFromUrlState` and any export URL builder must strip `panel`.

### 6.2 Visibility

Pure function, tested:

`visibleDetailTabs(uiResource, record, ctx) → TabKey[]`

`ctx` includes `readOnly`, `database_scope`, `canDelete`, and whether
production edit is allowed (not a Referral Booking, not historical, not
duplicate).

| Tab | Form Lead | Duplicate Form Lead | Call Lead | Duplicate Call Lead | Booking | Cancellation | Customer | Agent |
| --- | --- | --- | --- | --- | --- | --- | --- | --- |
| Summary | yes | yes | yes | yes | yes | yes | yes | yes |
| Contact | yes | yes | yes | yes | yes | yes | yes | no |
| Lead Message | yes | yes | no | no | no | no | no | no |
| Actions | if production and not readOnly | no | if production and not readOnly | no | if production and a cancel or related action exists | related only — fold into Contact; no Actions tab | no | no |
| Production record | if editable | no | if editable | no | if editable or owner delete | if editable or owner delete | if editable | no |
| Source Company / Source | yes | yes | yes | yes | yes | yes | no | no |

Cancellations have no Book / Cancel / Bad Lead. Related “View booking”
lives on Contact. Do not keep an Actions tab that only repeats that link
if Contact already has it.

### 6.3 Tab contents

**Summary**

- Identity and the resource’s scannable facts from today’s Summary grid
  (dates, job, move, money, merchant, cancelled).
- Sales Rep on lead resources.
- Database scope.
- Fold useful Linked Context links here (booked, cancelled, Job Number
  deep link). Do not reprint snake_case keys (`lead_ref`, `booked_lead`)
  as labels — use Owner words: Booking, Cancellation, Customer, Lead.
- Exclude `stored_lead` from the Booking Summary grid; that fact belongs
  on Contact.

**Contact**

- Form / duplicate Form Leads: existing `FormLeadContactsSection`
  (Form submitted vs Granot).
- Call / duplicate Call Leads: live name, phone, email. No Granot card.
- Bookings: existing `BookingStoredLeadSection` (attached lead cards,
  Referral badge, Leadless + Connect a lead).
- Cancellations: customer name / phone and “View booking” when a Booking
  exists.
- Customers: the same contact fields already shown (name, phone, email)
  plus linked booking / cancellation counts.

**Lead Message** (Form Lead resources only)

- Today’s structured fields: sent flag, status, provider status, to,
  from, purpose, Twilio SID, accepted / sent / delivered times.
- Message body in a readable `<pre>` (plain text, not JSON).
- “View messaging events” link unchanged.
- Empty state: “No Lead Message is associated with this Form Lead.” plus
  the sent True/False fact. Do not show a JSON object.

**Actions**

- Form Leads: Book this lead, Start cancellation, Bad Lead control
  (eligibility unchanged: not duplicate, not booked, not cancelled).
- Call Leads: Book this lead, Start cancellation. No Bad Lead.
- Bookings: Cancel this booking (hidden for Referral Bookings).
- Related-record buttons that are actions (View booking / View lead)
  may live here when the Actions tab exists.
- Book / Cancel still navigate to `/bookings/new` and
  `/cancellations/new` with the existing query helpers. Do not invent
  in-panel create forms.

**Production record**

- Existing `EditForm` fields for the resource.
- Owner delete for Bookings / Cancellations at the bottom as a danger
  zone, not a separate tab. Copy stays honest: leads and customers are
  preserved; sheets update through Sheet Sync (do not say “synced now”).
- Hidden when the resource is not editable and the actor cannot delete.

**Source Company / Source**

- Leads: resolved Source Company label (today’s `formatSourceDisplay`)
  plus the snapshot / catalog facts with Owner labels, not raw keys:
  Source Granularity, Source Company label, Source Granularity label,
  Granot CRM source label. Omit empty rows.
- Bookings / Cancellations: the stored source label (and Source Company
  on cancellations when present). Edit of source label stays on
  Production record.

### 6.4 Removed

- Raw Identifiers JSON dump.
- Lead Message “Message data” JSON dump.
- Linked Context as its own card (folded).
- Workflow Actions as a scroll section (moved to the Actions tab).
- A seventh “Provenance” or “Conversation” tab.

---

## 7. Rows

Keep `DataTable` and `ColumnConfig`. Do not invent an `OperationalRow`
component type. OSE-03 changes how cells are composed.

### 7.1 Identity cell

One leading fact cell after any leftover structural columns:

| Resource | Primary | Secondary |
| --- | --- | --- |
| Form / Call / duplicates | `name` | `phone_number` |
| Bookings / Cancellations | customer name | customer phone |
| Customers | `full_name` | phone |
| Agents | `name` | role |

First / last / email stay hidden on lead tables (already hidden). They
remain available in Contact and Production record.

### 7.2 Status chips

Replace separate True/False columns where a chip cluster is clearer.
Keep Job Number, Source, money, and merchant as their own columns.

| Resource | Chips (show only when true / set) |
| --- | --- |
| Form Lead | Booked, Cancelled, Bad Lead (reason label), Lead Message sent |
| Call Lead | Booked, Cancelled |
| Booking | Cancelled; keep existing Stored lead chip in its column |
| Cancellation | none — Reason stays a column |
| Customer / Agent | none required |

Do not invent a Bad Call chip.

### 7.3 Actions cluster

One sticky-right Actions column. Stop prepending `__book`, `__mark_bad`,
`__cancel`, `__delete`, and `__related` as separate leading columns.

| Resource | Cluster contents (production, not readOnly) |
| --- | --- |
| Form Leads | Book (if not booked), Bad Lead, related links |
| Call Leads | Book (if not booked), related links |
| Bookings | Cancel (non-referral), related links, Owner delete |
| Cancellations | related links, Owner delete |
| Duplicates / historical | related links only |

Clicks on cluster controls `stopPropagation` so they do not open the
panel. Row click still opens the panel.

The floating bottom action bar may remain if it still earns its keep
after the cluster exists; do not add a third copy of Book / Cancel.
Prefer the cluster + the Actions tab.

### 7.4 Selected row

When `?record=` matches the row id, the row is visually selected
(`aria-selected="true"`). Opening / closing the panel updates that
state. `DataTable` may take an optional `isRowSelected` predicate.

### 7.5 Unchanged cells

Granot contact chip, Job Number deep link, Stored lead chip, money
formatters, and source labels stay. Do not switch these lists to Daily
View card rows.

---

## 8. Filters

Keep config-driven, URL-synced filters. `FilterBar` used by Observational
and Audit Log is a different pattern; do not merge it.

### 8.1 Groups

| Group | Always visible? | Keys |
| --- | --- | --- |
| Find | Yes | `q`, `from` / `to`, date-sort (`sort` / `direction` / `date_field`) |
| Status | Yes, compact | `booked`, `cancelled`, `leadless` (Bookings), `past_move_date` (Form Leads) |
| Attribution | Collapsed when unused | `source_granularity_key`, `source`, `source_company`, `receiver_agent`, `agent`, `merchant` |
| Record fields | Collapsed when unused | name, phone, email, `ref_no`, `job_no`, `move_size`, `local`, `reason`, `cancelled_by`, customer name/phone, agent `active` / `role` |

“Collapsed when unused” means the group header is visible; the fields
are closed unless a field in that group has an active URL value — then
the group opens.

Keep ActiveFilterChips and Reset. Keep the collapsed-rail + mobile
drawer behavior and `vantage-admin-operational-filters-collapsed`.
Reset still clears filters and `record` / `panel` / `connect`; it keeps
`database_scope`.

Historical scope still clears / hides `receiver_agent` as today.

### 8.2 No new keys

Do not add a Bad Lead filter, a Lead Message filter, or Daily View
window params. Facets (agents, merchants, Source Granularities) stay
on `useFacetOptions`.

---

## 9. 21st.dev craft targets

Agents **may** use the 21st.dev MCP (`user-21st`) or CLI when creating
these four shells. Search first. Generate or iterate only against the
named target. Do not let a generated page replace `OperationalResourcePage`.

| Target | Issue | What to search |
| --- | --- | --- |
| Tabbed sheet | OSE-02 | tabbed drawer / sheet header, sticky tabs, scroll body |
| Status chips | OSE-03 | compact status chip cluster for table cells |
| Sticky actions | OSE-03 | table row action group, sticky right |
| Grouped filter sidebar | OSE-04 | collapsible filter groups, active chips |

Reuse existing shadcn primitives (`Button`, `SidePanel`, filter inputs)
where they already fit. 21st.dev is for the four shells, not a redesign
of dashboard chrome.

---

## 10. Copy and language

Owner-facing strings in `operational-copy.ts`. Required labels:

- Tab labels in §6.1.
- Lead Message empty state in §6.3.
- Duplicate read-only banner: resource-aware.
- Production save: “Saved. The table and detail caches were refreshed.”
- Delete success may mention that sheets update through Sheet Sync.
  Never “synced” as Google-equals-Mongo.
- Source tab labels: Source Company, Source Granularity, Granot CRM
  source. Never `source_granularity_key` in the UI.

Forbidden in Owner UI: `Raw Identifiers`, `sms_message`, `lead_ref`,
`is_leadless_booking`, `wordpress_form`, “text message” as a tab,
“Bad Call”, “Sync” as a button, Daily View tab names.

---

## 11. Tests

### 11.1 Unit

- `visibleDetailTabs` — one case per resource in the §6.2 matrix,
  plus historical, duplicate, Referral Booking, and owner-delete.
- `apiFiltersFromUrlState` (or successor) strips `record`, `connect`,
  and `panel`.
- Filter group membership: every existing `FilterConfig.key` appears in
  exactly one group; unknown keys fail the test rather than vanish.
- Row action cluster: Form Lead booked row hides Book; Referral Booking
  hides Cancel; Call Lead has no Bad Lead control.

### 11.2 Admin render

- Detail panel render never includes `JSON.stringify` of the record or
  of `sms_message`.
- Form Lead with a Lead Message shows body text and hides “Message data”.
- `?record=` + `?panel=message` on a Form Lead selects Lead Message.
- `?panel=message` on a Call Lead or Booking falls back to Summary.
- `?connect=1` on a Leadless Booking opens Contact.
- Selected row sets `aria-selected` on the matching `<tr>`.

### 11.3 Browser walk (local Admin)

Sign in from `vantage-admin/.env` seed values. Do not paste them.

1. `/form-leads` — open a row. Tabs match §6.2. Summary has no JSON.
   Contact shows Form submitted vs Granot when a snapshot exists. Lead
   Message has no JSON dump. Actions can Book / Bad Lead when eligible.
   Production record still saves. Source Company is labeled in words.
2. `/call-leads` — no Lead Message tab, no Bad Lead. Contact is live
   fields only.
3. `/bookings` — Contact is Stored lead. `?connect=1` lands on Contact.
   Actions is Cancel (non-referral). No Lead Message tab.
4. `/cancellations` — Contact has View booking. No Actions tab. Production
   record still edits.
5. `/duplicate-form-leads` — same tabs as Form Lead minus Actions and
   Production record. Banner says Duplicate Form Leads.
6. Filters — set Source Company + Booked; chips appear; Attribution
   stays open; Reset clears chips and closes the panel.
7. Rows — Book / Bad Lead sit in the right cluster; clicking Book does
   not open the panel; clicking the row does; selected row is highlighted.
8. `/customers` and `/agents` still open a panel and list rows. Agents
   have Summary only.

Historical scope: mutations hidden; Actions and Production record tabs
absent.

---

## 12. Acceptance criteria

1. All eight `UiResource` routes still render through
   `OperationalResourcePage`. No fourth list-page architecture.
2. Detail panel is tabbed per §6. Both JSON dumps are gone.
3. `?panel=` is shareable, stripped from API filters, and falls back
   when the tab is hidden.
4. Rows have identity + status chips + one Actions cluster + selected
   highlight, per §7.
5. Filters are grouped per §8 with the same keys and ActiveFilterChips.
6. Form submitted vs Granot, Connect Booking to Lead, Job Number deep
   links, and Bad Lead eligibility are unchanged in meaning.
7. No Daily View tabs, no ConversationPanel embed, no Bad Call, no Sync
   button, no new main-server endpoints.
8. `pnpm test && pnpm typecheck && pnpm lint` in `vantage-admin`.
9. Browser walk §11.3 passes on the local Admin.

---

## 13. Out of scope

- Any `vantage-main-server` behavior, DTO, or index change.
- Owner Daily View (`/daily`) and its Details / Provenance / Conversation
  drawer.
- Embedding Lead Conversations on Call Leads.
- Search page rewrite (deep links with `?record=` may keep working).
- Intakes, Observational, Audit Log, Analytics tables.
- `/bookings/reconciliation`.
- New filter keys, Bad Call, Sync button, in-panel Book / Cancel forms.
- Changing Sheet Sync, Enrichment, or production PATCH contracts.

---

## 14. Knowledge updates after ship

Pointer-only. Do not copy this contract into Service knowledge bodies.

- `vantage-admin/CONTEXT.md` — operational surfaces pointer: tabbed
  panel, grouped filters, row cluster. Domain words stay in the root
  glossary.
- `vantage-admin/.cursor/rules/project-organization.mdc` —
  `components/operational/` map updated to the extracted files and tabs.
- `vantage-admin/uxdocs/index.txt` — live once OSE-02–04 ship.
- `vantage-main-server/docs/index.md` — this pack in Delivery packs.

No new root-glossary term. “Operational surfaces” is an admin-local
name for the shared list shell, not a domain entity.
