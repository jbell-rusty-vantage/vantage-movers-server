# OSE-01 completion

Repo: `vantage-admin`. Branch: `operational-surfaces`. Closed 2026-09-02.

## 1. File map (old symbol → new file)

| Old symbol | New file |
| --- | --- |
| `FieldType`, `ColumnConfig`, `FilterConfig`, `EditFieldConfig`, `DateSortConfig`, `ResourceConfig`, `DeleteTarget`, `DeleteDialogCopy` | `operational-configs.ts` |
| `formLeadColumns` / `Filters` / `EditFields`, `callLead*`, `operationalConfigs` | `operational-configs.ts` |
| `withFacetOptions` | `operational-configs.ts` |
| `getValue`, `stringValue`, `formatDate`, `formatMoney`, `formatPlain`, `isReferralBooking`, `isLeadResource`, `supportsRelatedNav`, `relatedNavLinksFor`, `isDeleteResource`, `hasAttachedCancellation`, `invalidateOperationalMutations`, `isLeadRecordWithSourceMetadata` | `operational-helpers.tsx` |
| `formatCell`, `buildColumns`, `relationCount` | `operational-columns.tsx` |
| `FilterInput`, `FilterFields`, `DateSortSelect`, `ActiveFilterChips`, `OperationalFilterPanel` | `operational-filter-panel.tsx` |
| `DetailPanel`, `EditForm`, `buildUpdatePayload`, `CustomerTestimonialsSection` | `operational-detail-panel.tsx` |
| `RelatedNavLinkButton`, `RelatedRecordsActions`, `WorkflowActions`, `DeleteConfirmationDialog`, `getBookingQuery`, `getCancellationQuery` | `operational-actions.tsx` |
| `MarkBadLeadControl`, `formatBadLead` | `mark-bad-lead-control.tsx` |
| `SmsMessageSection` | `lead-message-section.tsx` as `LeadMessageSection` (heading still “SMS Message”) |
| Duplicate read-only banner | `operational-copy.ts` |
| `apiFiltersFromUrlState`, `filtersSidebarStorageKey`, `InfiniteTableFooter`, `BackToTopButton`, `OperationalResourcePage` | stayed on `operational-resource-page.tsx` |

`form-lead-contacts.tsx` and `components/bookings/` were not moved.

## 2. Banner copy

**Before:** hardcoded on every `config.readOnly` route:

`Duplicate form leads are read-only. Booking, cancellation, and edit actions are hidden.`

**After:** `duplicateReadOnlyBannerCopy(resource)` from `OPERATIONAL_COPY`:

- Duplicate Form Leads: `Duplicate Form Leads are read-only. Booking, cancellation, and edit actions are hidden.`
- Duplicate Call Leads: `Duplicate Call Leads are read-only. Booking, cancellation, and edit actions are hidden.`

## 3. §4 drift corrected

- OSE-01 §4: reverified 2615-line monolith on 2026-09-02, then recorded post-extract homes.
- Spec `applies_to`: listed the extracted admin files.
- OSE-02 §4: pointed at `operational-detail-panel.tsx` / `lead-message-section.tsx`; confirmed `apiFiltersFromUrlState` still strips only `record` and `connect`.

## 4. Source-scan tests retargeted

- `tests/form-lead-contacts.test.ts` → `operational-configs.ts`
- `tests/filter-catalog-adapter.test.ts` → configs + filter panel + detail (`buildUpdatePayload` / `EditForm`)
- `tests/job-timeline-deep-link.test.ts` → `operational-columns.tsx` + `operational-configs.ts`
- `tests/booking-stored-lead.test.ts` → `operational-detail-panel.tsx` (+ page for `startConnect`)
- Added `tests/operational-copy.test.ts` (pure copy + page uses the module)

## 5. Commands

```
cd vantage-admin && pnpm test && pnpm typecheck && pnpm lint
```

- `pnpm test`: 395 pass, 0 fail, 0 skipped
- `pnpm typecheck`: clean
- `pnpm lint`: exit 1 on **pre-existing** errors in `needs-you.tsx`, `job-timeline-dashboard.tsx`, `global-search.tsx` (not in this diff). Extracted files: 0 errors; 1 copied `react-hooks/exhaustive-deps` warning on `buildColumns` `useMemo`.

## 6. What this issue did not do

No tabs, no `?panel=`, no JSON dump removal, no Lead Message retitle, no row cluster / identity / chips, no filter groups, no 21st.dev, no main-server runtime change, no commit/push.

## 7. Leftover risk for OSE-02

- `DetailPanel` props are unchanged (`startConnect`, `readOnly`, no `panel`).
- Both JSON dumps remain (`Raw Identifiers` + Lead Message `JSON.stringify`).
- `operational-helpers.tsx` exists only to break cycles (`getValue` / `formatDate` / `formatPlain` / nav helpers). Detail imports columns (`formatCell`) and actions; columns import actions + Bad Lead. No page ← module cycle.
- Page still strips only `record` and `connect`. OSE-02 must add `panel`.
