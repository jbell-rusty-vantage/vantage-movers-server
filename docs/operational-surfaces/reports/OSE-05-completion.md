# OSE-05 completion

Repo: `vantage-admin`. Branch: `operational-surfaces`. Closed 2026-09-02.

Browser walk of spec §11.3 / §12 on local Admin `http://localhost:3000`. Reused existing Admin `pnpm dev`. Did not start or restart `vantage-main-server`. Signed in from `vantage-admin/.env` `ADMIN_SEED_*` (not pasted). Customer names and phones are redacted below.

## 1. Walk notes (spec §11.3)

| Step | Result | What was clicked / set | What was seen (redacted) |
| --- | --- | --- | --- |
| 1. `/form-leads` | **pass** | Opened Form Lead A (job 5563644, phone last-4 5773). Clicked Summary → Contact → Lead Message → Actions → Production record → Source Company. | Tabs: Summary, Contact, Lead Message, Actions, Production record, Source Company. Summary is identity + facts; no Raw Identifiers JSON. Contact shows Form submitted vs Granot. Lead Message has structured delivery fields + readable body + “View messaging events”; no “Message data” JSON. Actions: Book this lead, Start cancellation, Bad Lead. Production record: EditForm + Save changes (not submitted). Source Company labels in words (Source Granularity, Source Company label, Granot CRM source label). `?panel=` updated on each tab. |
| 2. `/call-leads` | **pass** | Opened Call Lead A on production scope. Contact then Actions. | Tabs: Summary, Contact, Actions, Production record, Source Company. No Lead Message tab. Contact is live name / phone / email only — no Form submitted vs Granot card. Actions: Book this lead, Start cancellation. No Bad Lead in the tab or the row cluster. |
| 3. `/bookings` | **pass** | Opened Booking A. Then Leadless Booking A via `?leadless=true&record=…&connect=1`. | Tabs: Summary, Contact, Actions, Production record, Source. No Lead Message. Contact is Stored lead (attached Form submitted vs Granot cards). Actions: Cancel this booking, View lead. `?connect=1` selected Contact and showed “This booking has no stored lead” + Connect a lead search. |
| 4. `/cancellations` | **pass** | Opened Cancellation A (synthetic, no Booking). Then Cancellation B (cluster Booking link). | Tabs: Summary, Contact, Production record, Source. **No Actions tab.** Contact on Cancellation B: name, phone last-4 redacted, Booking → View booking. Production record: Save changes + Owner delete (not submitted). |
| 5. `/duplicate-form-leads` | **pass** | Opened Duplicate Form Lead A. | Banner: “Duplicate Form Leads are read-only. Booking, cancellation, and edit actions are hidden.” Tabs: Summary, Contact, Lead Message, Source Company. No Actions, no Production record. |
| 6. Filters `/form-leads` | **pass** (after fix) | URL `?source_granularity_key=main_site_form&booked=true`. Opened a row. Clicked chips **Reset all**. | Chips: Source Company: Main Site Forms, Booked: Yes. Attribution `aria-expanded=true`. Reset left `?database_scope=production` only; chips gone; Attribution collapsed; panel closed. First Reset-all attempt before the local-state fix left the panel open — see §2. |
| 7. Rows `/form-leads` | **pass** | Confirmed Actions column. Clicked cluster **Book**. Then separately clicked a row. | Book and Bad Lead sit in the sticky-right Actions cluster. Book navigated to `/bookings/new?lead_type=FormLead&lead_id=…` and did **not** open the panel. Row click opened the panel; matching `<tr aria-selected="true">`. |
| 8. `/customers` and `/agents` | **pass** | Opened Customer A. Opened Agent A. | Customers: 50 rows; panel tabs Summary, Contact, Production record. Agents: 14 rows; panel **Summary only**. |

Also required:

| Check | Result | Observation |
| --- | --- | --- |
| Historical scope | **pass** | Header/URL `database_scope=historical` on `/form-leads`. Row cluster has no Book / Bad Lead. Tabs: Summary, Contact, Lead Message, Source Company. Actions and Production record absent. |
| Duplicate Call Leads banner | **pass** | `/duplicate-call-leads` h1 “Duplicate Call Leads”. Banner starts “Duplicate Call Leads are read-only.” (not Form Leads). |
| Deep-link reload | **pass** | `/form-leads?record=…&panel=message` reload kept Lead Message selected and `aria-selected` on the row. |

§12.6 meaning unchanged on the walk: Form submitted vs Granot still on Form Lead / attached Booking Contact; Connect a lead still on Leadless Booking Contact; Job Number remains a table deep link; Bad Lead remains Form Lead only.

§12.7: no Daily View tabs, no ConversationPanel embed, no Bad Call, no Sync button, no new main-server endpoints.

Pre-existing Next.js hydration overlay (`Date.now` / `BrandLogo`) appeared on some loads. Not this pack.

## 2. Fixes applied

Two OSE-02 / OSE-04 seam regressions found on the walk. No new product scope.

| File | Why |
| --- | --- |
| `vantage-admin/lib/api/url-state-update.ts` (new) | Pure `applyUrlStateUpdate` so consecutive URL writes merge. |
| `vantage-admin/lib/api/url-state.ts` | `update` now applies against a live query ref. Opening a row wrote `record` while the tab default wrote `panel=summary` from stale `searchParams`, which dropped `record` and `aria-selected`. |
| `vantage-admin/components/operational/operational-resource-page.tsx` | `selectRecord` writes `{ record, panel }` in one update. Filter Reset also `setSelected(null)` so chips Reset all closes the panel. |
| `vantage-admin/components/operational/operational-detail-panel.tsx` | Tab fallback writes `panel` only when a requested tab is already in the URL — stops the default-summary write from racing row open. |
| `vantage-admin/tests/url-state.test.ts` | Merge / clear coverage. |
| `vantage-admin/tests/operational-detail-tabs.test.ts` | Source contracts for the two URL writes. |
| `vantage-admin/tests/operational-filter-groups.test.ts` | Reset wrapper clears selected. |

## 3. Pointer files

docs-keeper invoked after this report so these describe what shipped (not planned):

- `vantage-admin/CONTEXT.md` — operational surfaces pointer
- `vantage-admin/.cursor/rules/project-organization.mdc` — `components/operational/` map
- `vantage-admin/uxdocs/index.txt` — pack may be marked live
- `vantage-main-server/docs/index.md` — Delivery packs status

No new root-glossary term. “Operational surfaces” stays admin-local.

## 4. What remains out of pack

- Owner Daily View (`/daily`) and Details / Provenance / Conversation
- ConversationPanel on Call Leads
- Search / Intakes / Observational / Audit Log / Analytics rewrites
- `/bookings/reconciliation`
- Bad Call, Sync button, in-panel Book / Cancel forms
- Any `vantage-main-server` runtime change
- Pre-existing full-repo lint errors in `needs-you.tsx`, `job-timeline-dashboard.tsx`, `global-search.tsx`

## 5. Commands

```
cd vantage-admin && pnpm test && pnpm typecheck && pnpm lint
```

- `pnpm test`: **436 pass**, 0 fail, 0 skipped (was 432 after OSE-04; +4 for the URL-merge / reset-close contracts).
- `pnpm typecheck`: clean.
- `pnpm lint`: exit 1 on **pre-existing** errors in `needs-you.tsx`, `job-timeline-dashboard.tsx`, `global-search.tsx`. Scoped lint on this issue’s files: **0 errors**, 1 copied `react-hooks/exhaustive-deps` warning on `buildColumns` in `operational-resource-page.tsx`.

Did not commit or push.
