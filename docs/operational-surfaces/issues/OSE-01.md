# OSE-01 — Extract operational configs, filters, detail, and actions

> **Contract maturity: implementation-ready.** Session 1. Split the
> monolith behind the seams in spec §5. **No tabbed panel. No row
> redesign. No filter groups.** Fix the duplicate read-only banner copy.

## 1. Authority and required reading

- **Pack specification:** [`../operational-surfaces-specification.md`](../operational-surfaces-specification.md)
  — §3, §4, §5. Wins on seams and the banner fix.
- **Pack rules:** [`../README.md`](../README.md), [`../AGENT-PROTOCOL.md`](../AGENT-PROTOCOL.md)
- **Admin map:** `vantage-admin/.cursor/rules/project-organization.mdc`
- **Glossary:** workspace-root `CONTEXT.md`

## 2. Objective

`OperationalResourcePage` stays the page interface. Configs, column
builders, filter sidebar, detail panel, actions, Bad Lead, Lead Message
section, and Owner strings move to sibling modules so OSE-02–04 can
change one seam at a time.

## 3. Repository, branch, and prerequisites

- **Repository:** `vantage-admin` only.
- **Branch:** current Admin desk branch, or `operational-surfaces` if
  that is how this desk is isolated. See the protocol.
- **Prerequisites:** none. This is the only startable issue.
- No 21st.dev in this issue.
- No commit, push, deploy, or live payload read unless asked.

## 4. Current-state evidence to verify

Observed 2026-09-01; **reverified 2026-09-02** at 2615 lines with the
listed symbols inline, then extracted in this issue.

- Pre-extract: `operational-resource-page.tsx` defined `operationalConfigs`,
  `OperationalFilterPanel`, `DetailPanel`, `EditForm`, `MarkBadLeadControl`,
  `WorkflowActions`, `SmsMessageSection`, `buildColumns`, and `formatCell`.
- After extract the page composes only. Symbol homes: configs →
  `operational-configs.ts`; columns → `operational-columns.tsx`; filter
  sidebar → `operational-filter-panel.tsx`; detail →
  `operational-detail-panel.tsx`; actions/delete dialog →
  `operational-actions.tsx`; Bad Lead → `mark-bad-lead-control.tsx`;
  Lead Message (ex-`SmsMessageSection`) → `lead-message-section.tsx`;
  banner → `operational-copy.ts`. Shared non-UI helpers that would cycle
  live in `operational-helpers.tsx`.
- Pages under `app/(dashboard)/{form-leads,call-leads,bookings,
  cancellations,duplicate-form-leads,duplicate-call-leads,customers,
  agents}/page.tsx` only render `<OperationalResourcePage resource="…" />`.
- Duplicate read-only banner is resource-aware via
  `OPERATIONAL_COPY.duplicateReadOnlyBanner` (Form Leads vs Call Leads).
- `form-lead-contacts.tsx` and `components/bookings/` stayed where they
  were.

## 5. Locked decisions and invariants at risk

- Page export stays `OperationalResourcePage({ resource: UiResource })`.
- Column order, filter keys, edit fields, and detail section order stay
  the same except the banner string.
- Do not add `?panel=`.
- Do not remove the JSON dumps yet (OSE-02).
- Owner strings that you touch go into `operational-copy.ts` even if
  most copy still lives inline until later issues migrate it.
- Do not change Form submitted vs Granot or Connect Booking to Lead.

## 6. Deliverables and exact contract

Extract to (names may vary; seams must exist):

```text
components/operational/
  operational-resource-page.tsx
  operational-configs.ts
  operational-columns.tsx
  operational-filter-panel.tsx
  operational-detail-panel.tsx
  operational-actions.tsx
  mark-bad-lead-control.tsx
  lead-message-section.tsx
  operational-copy.ts
```

1. Move `ResourceConfig` and `operationalConfigs` to `operational-configs.ts`.
2. Move filter sidebar + chips + `FilterFields` to `operational-filter-panel.tsx`.
3. Move `DetailPanel` and its section composition to `operational-detail-panel.tsx`.
4. Move Book / Cancel / related / Bad Lead controls to `operational-actions.tsx`
   and `mark-bad-lead-control.tsx`.
5. Rename `SmsMessageSection` file to `lead-message-section.tsx`. The
   Owner heading may stay “SMS Message” until OSE-02 retitles it Lead
   Message — or retitle now if the string lives in `operational-copy.ts`.
6. Fix the duplicate read-only banner so Duplicate Call Leads does not
   say Duplicate Form Leads.

## 7. Out of scope

- Tabs, `?panel=`, JSON dump removal (OSE-02).
- Row identity / chips / action cluster (OSE-03).
- Filter groups (OSE-04).
- 21st.dev generation.
- Any `vantage-main-server` change.

## 8. Tests

Existing Admin tests that import the page or Bad Lead control must keep
passing. Add a focused test that the duplicate banner copy is
resource-aware if one exists or is cheap to add.

## 9. Knowledge updates after this issue ships

Pointer-only: `vantage-admin/.cursor/rules/project-organization.mdc`
`components/operational/` line may list the new files. Do not claim tabs
have shipped.

## 10. Acceptance criteria

- [x] Eight list pages still compile against `OperationalResourcePage`.
- [x] The listed extract files exist and the page file no longer defines
      `operationalConfigs` or `DetailPanel` inline.
- [x] Visual behavior is unchanged except the duplicate banner.
- [x] Duplicate Call Leads banner does not say Duplicate Form Leads.
- [x] `form-lead-contacts.tsx` and `components/bookings/` paths unchanged
      in meaning.
- [x] `pnpm test && pnpm typecheck && pnpm lint` in `vantage-admin`.
      Tests 395/395. Typecheck clean. Full `pnpm lint` still exits 1 on
      pre-existing errors in `needs-you.tsx`, `job-timeline-dashboard.tsx`,
      and `global-search.tsx` (not in this diff). Extracted files: 0 errors,
      1 pre-existing exhaustive-deps warning copied from the monolith.

## 11. Commands

```bash
cd vantage-admin && pnpm test && pnpm typecheck && pnpm lint
```

Paste output in the completion report.

## 12. Risks

- Mixing tab UI into the extract so OSE-02 cannot be reviewed alone.
- Breaking `MarkBadLeadControl` compact vs panel variants.
- Moving Form Lead contact helpers and changing their public props.

## 13. Rollback

Revert the extract. Pages still import `OperationalResourcePage`. No
feature flag.

## 14. Handoff list for the completion report

- File map (old symbol → new file).
- Banner copy before/after.
- What you did not do (especially OSE-02–04).
- Any §4 drift you corrected.

**Unblocks:** OSE-02.
