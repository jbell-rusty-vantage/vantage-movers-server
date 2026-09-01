# OSE-02 — Tabbed detail panel; remove JSON dumps

> **Contract maturity: implementation-ready.** Session 2. Destination
> tabs on the shared detail panel. Remove both JSON dumps. **No row
> redesign. No filter groups.**

## 1. Authority and required reading

- **Pack specification:** [`../operational-surfaces-specification.md`](../operational-surfaces-specification.md)
  — §4, §6, §9 (tabbed sheet), §10, §11.1–11.2. Wins on tab keys, hide
  rules, and copy.
- **Pack rules:** [`../README.md`](../README.md), [`../AGENT-PROTOCOL.md`](../AGENT-PROTOCOL.md)
- **Shipped helpers:** `form-lead-contacts.tsx`, `components/bookings/`
- **Glossary:** workspace-root `CONTEXT.md`

## 2. Objective

An Owner opening a Form Lead, Call Lead, Booking, or Cancellation can
jump to Summary, Contact, Lead Message, Actions, Production record, and
Source Company (or Source) without scrolling past JSON. Hidden tabs stay
hidden. `?panel=` is shareable.

## 3. Repository, branch, and prerequisites

- **Repository:** `vantage-admin` only.
- **Prerequisite:** OSE-01 `complete`.
- **21st.dev:** allowed. Craft target: tabbed sheet / sticky tabs over a
  scrolling drawer body. Search first. Do not generate a replacement page.

## 4. Current-state evidence to verify

Observed 2026-09-01; reverify after OSE-01.

- `SidePanel` (`components/ui/side-panel.tsx`) has title, description,
  close, and a scrolling body. No tab slot.
- `DetailPanel` is a vertical stack ending in Raw Identifiers
  `JSON.stringify(record)`. `lead-message-section` (ex-SmsMessageSection)
  still dumps message JSON.
- URL keys: `record`, `connect`. `apiFiltersFromUrlState` does not strip
  `panel`.
- `?connect=1` starts `BookingStoredLeadSection` with `startOpen`.

## 5. Locked decisions and invariants at risk

- Tabs are destinations. Book / Cancel / Bad Lead are Actions, not tabs.
- Hide empty tabs (spec §6.2 matrix). Test `visibleDetailTabs`.
- Lead Message, not text message. Form Lead resources only.
- No Bad Call. No Sync button. No Provenance / Conversation tabs.
- `?connect=1` forces `panel=contact`.
- Strip `panel` from API filters and export URLs.
- Close clears `record`, `panel`, and `connect`.
- Fold Linked Context into Summary / Contact. Do not keep that card.
- Reuse `FormLeadContactsSection` and `BookingStoredLeadSection`.

## 6. Deliverables and exact contract

1. `SidePanel` accepts a sticky tab strip (or a header slot the detail
   panel fills). Body still scrolls.
2. Implement `visibleDetailTabs` and the §6.2 matrix.
3. Compose each tab from spec §6.3. Production record includes the
   Owner delete danger zone.
4. Remove Raw Identifiers and Lead Message “Message data” JSON.
5. Add `?panel=` with keys `summary | contact | message | actions |
   production | source`. Default and fallback: `summary`.
6. Owner labels and empty states in `operational-copy.ts`.
7. Source tab uses Owner words, not raw keys.

## 7. Out of scope

- Row identity / chips / cluster (OSE-03).
- Filter groups (OSE-04).
- Cross-route browser proof (OSE-05) — do a Form Lead + Booking smoke
  check here; OSE-05 owns the full walk.
- Daily View drawer. ConversationPanel. Main-server changes.

## 8. Tests

Spec §11.1 (`visibleDetailTabs`, filter strip) and §11.2 (no
`JSON.stringify` of record or `sms_message`; panel fallback; connect
lands on Contact).

## 9. Knowledge updates after this issue ships

Do not mark the pack live in `uxdocs/index.txt` until OSE-04 also ships.
OSE-05 / docs-keeper will point.

## 10. Acceptance criteria

- [ ] Form Lead panel shows the six tabs in §6.2 when eligible.
- [ ] Call Lead has no Lead Message tab and no Bad Lead on Actions.
- [ ] Booking Contact owns Stored lead; `?connect=1` opens Contact.
- [ ] Cancellation has no Actions tab; View booking is on Contact.
- [ ] Both JSON dumps are gone from the render.
- [ ] `?panel=message` on a Booking falls back to Summary.
- [ ] `panel` is not sent to the list API.
- [ ] `pnpm test && pnpm typecheck && pnpm lint` in `vantage-admin`.
- [ ] Browser smoke: `/form-leads` and `/bookings` tab jump works.

## 11. Commands

```bash
cd vantage-admin && pnpm test && pnpm typecheck && pnpm lint
```

Plus the smoke walk. Paste output in the completion report.

## 12. Risks

- Rendering empty stub tabs “for consistency”.
- Leaving Linked Context snake_case labels in Summary.
- Forgetting to strip `panel` from export URLs.

## 13. Rollback

Restore the vertical `DetailSection` stack. `?panel=` can be ignored.
JSON dumps may stay deleted if the structured sections remain.

## 14. Handoff list for the completion report

- Tab visibility table vs implementation.
- 21st.dev component id / take used, or why none.
- Proof that JSON dumps are gone.
- What you did not do (OSE-03–05).

**Unblocks:** OSE-03 (after this is complete; OSE-03 also needs OSE-01).
