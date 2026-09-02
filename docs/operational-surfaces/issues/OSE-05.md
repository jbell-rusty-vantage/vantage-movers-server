# OSE-05 — Cross-route browser proof

> **Contract maturity: implementation-ready.** Session 5. Prove spec
> §11.3 and §12 on the live local Admin. No new visual inventing.

## 1. Authority and required reading

- **Pack specification:** [`../operational-surfaces-specification.md`](../operational-surfaces-specification.md)
  — §11.3, §12, §14.
- **Pack rules:** [`../README.md`](../README.md), [`../AGENT-PROTOCOL.md`](../AGENT-PROTOCOL.md)
- **Local Admin:** [`../LOCAL-ADMIN.md`](../LOCAL-ADMIN.md)
- **Glossary:** workspace-root `CONTEXT.md`

## 2. Objective

The eight shell routes, historical scope, and deep links behave as
specified. Completion report is the evidence. Fix only regressions found
in this walk that belong to already-shipped OSE-02–04 seams — do not
open new product scope.

## 3. Repository, branch, and prerequisites

- **Repository:** `vantage-admin` (fixes only if a walk step fails).
- **Prerequisites:** OSE-02, OSE-03, and OSE-04 `complete`.
- **21st.dev:** not for new shells. You may note inconsistency for a
  follow-up; do not restyle the dashboard chrome.

## 4. Current-state evidence to verify

Reverify that OSE-02–04 reports exist and their acceptance boxes are
checked. Then walk the live app. Do not trust the reports alone.

## 5. Locked decisions and invariants at risk

- Do not add Daily View tabs, ConversationPanel, Bad Call, or a Sync
  button “while you are here”.
- Do not rewrite Search or Intakes because a deep link looks dated.
- Sign in from `vantage-admin/.env`. Never paste seed passwords.
- Redact customer names and phones in the completion report.

## 6. Deliverables and exact contract

Complete the browser walk in spec §11.3:

1. Form Leads — tabs, no JSON, Contact, Lead Message, Actions, Production
   record, Source Company.
2. Call Leads — no Lead Message, no Bad Lead, live Contact only.
3. Bookings — Contact / Connect, Cancel, no Lead Message.
4. Cancellations — Contact + View booking, no Actions tab.
5. Duplicate Form Leads — banner + reduced tabs.
6. Filters — chips, group open, Reset.
7. Rows — cluster vs row click vs selected highlight.
8. Customers and Agents — panel still opens; Agents Summary only.

Also: historical scope hides Actions and Production record. Duplicate
Call Leads banner is resource-aware. `?record=` + `?panel=` share still
works after a reload.

If a step fails, fix it in the owning seam and re-walk that step.

## 7. Out of scope

- New features.
- Main-server changes.
- Production deploys.

## 8. Tests

Re-run the Admin suite after any fix. If no code changes, record that
the existing suite from OSE-04 is still the last green run and re-run
it anyway.

## 9. Knowledge updates after this issue ships

Invoke **docs-keeper** (or edit these pointers if that agent is
unavailable):

- `vantage-admin/CONTEXT.md` — operational surfaces shipped pointer.
- `vantage-admin/.cursor/rules/project-organization.mdc` —
  `components/operational/` map.
- `vantage-admin/uxdocs/index.txt` — live surface.
- `vantage-main-server/docs/index.md` — pack still listed; status may
  say shipped.

No new root-glossary term.

## 10. Acceptance criteria

- [x] Every step in spec §11.3 recorded with what was clicked and what
      was seen (redacted).
- [x] Historical scope checked.
- [x] Duplicate Call Leads banner checked.
- [x] Deep link reload keeps the same tab.
- [x] Spec §12 criteria 1–9 ticked in `PROGRESS.md` with evidence.
- [x] `pnpm test && pnpm typecheck && pnpm lint` in `vantage-admin`.
- [x] Knowledge pointers updated.

## 11. Commands

```bash
cd vantage-admin && pnpm test && pnpm typecheck && pnpm lint
```

Browser at http://localhost:3000. API on http://localhost:3001.

## 12. Risks

- Declaring complete from screenshots of first paint.
- Pasting credentials or unredacted phones into the report.

## 13. Rollback

None. This issue is proof. Revert only the regression fixes if they
make things worse.

## 14. Handoff list for the completion report

- Walk notes, redacted.
- Fixes applied (file + why).
- Pointer files updated.
- What remains out of pack (Daily View, Search, Intakes).

**Unblocks:** nothing in this pack. The pack is closed when this issue is
`complete`.
