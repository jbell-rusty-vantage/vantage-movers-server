# LCE-02 — By date default form

> **Contract maturity: implementation-ready.** Session 2. The Advanced
> desk becomes From / Through / Amount. **No JSON rebuild. No
> Current rates / Existing leads copy rewrite** (LCE-03 / LCE-04).

## 1. Authority and required reading

- **Pack specification:** [`../lead-costs-owner-editing-specification.md`](../lead-costs-owner-editing-specification.md)
  — §4.2, §4.3, §6.1, §6.2, §10.2 (form + timeline). Wins on layout
  and what the Owner never sees.
- **Pack rules:** [`../README.md`](../README.md), [`../AGENT-PROTOCOL.md`](../AGENT-PROTOCOL.md)
- **Server contract:** LCE-01 must be `complete`. Reverify the
  `set_range` body in that issue’s completion report.
- **Glossary:** workspace-root `CONTEXT.md`

## 2. Objective

An Owner opening Lead costs → By date picks a Feed, types From,
Through (or Ongoing), Amount, and saves. They never pick a command
name or paste a Period ID.

## 3. Repository, branch, and prerequisites

- **Repository:** `vantage-admin` only.
- **Prerequisite:** LCE-01 `complete`.
- **21st.dev:** allowed. Craft target: date-range form beside a
  Past / Now / Later timeline. Search first. Do not generate a
  replacement Operations Registry page.
- No commit, push, deploy, or live payload read unless asked.

## 4. Current-state evidence to verify

Observed 2026-09-02; reverify after LCE-01.

- `AdvancedCplPanel` in `components/operations-registry/cpl-manager.tsx`
  defaults `command` to `add_future`. Dropdown labels start with
  `add_future`, `split`, `correct_period`, `replace_schedule`.
- Period rows print `ID: {id}`. `periodId` text field for split /
  correct_period. `replacePeriodsText` JSON textarea.
- `AdvancedCplScheduleCommand` in `lib/api/registryCpl.ts` has no
  `set_range` variant yet (add it here).
- Feed control is labeled **Granularity**. Options use
  `granularity_key`.
- Mode tab label is still **Advanced** — you may change the visible
  label to **By date** here; LCE-03 owns URL persistence and the
  other two labels if you do not get to them.

## 5. Locked decisions and invariants at risk

- Submit `set_range` only on the default path. Do not chain
  `split` / `correct_period` in the client.
- Through omitted on the wire when Ongoing is checked.
- Hide Period IDs and command names on the default path.
- Clicking a timeline row fills From / Through or Ongoing / Amount.
- `expected_revision` stays on the wire from the loaded schedule.
- Admin role remains read-only (form hidden, timeline visible).
- Do not ship the structured rebuild editor (LCE-04). You may leave
  the old JSON tool inside a collapsed **More schedule tools**
  temporarily; LCE-04 replaces it. Prefer hiding JSON entirely if
  that is smaller than leaving a broken half-tool.

## 6. Deliverables and exact contract

1. Add `set_range` to `AdvancedCplScheduleCommand` and
   `applyAdvancedCplCommand` callers.
2. Replace the command `<select>` with the §4.2 form. Button:
   **Save lead cost**.
3. Timeline groups Past / Now / Later (rename Current / Future).
   Inclusive Through. **Ongoing** when there is no end. No `ID:` line.
   Row click fills the form.
4. One-line preview sentence from spec §4.2.
5. After-save timeline preview via a tested helper that mirrors
   `set_range` (spec §6.1 item 6). Server remains authoritative.
6. Feed select: Lead source company — Feed display name (channel).
   Label **Feed**. Honor `entity` / `feed` query for preselect.
7. Tests: default form fields; no command names in visible markup;
   no `ID:`; Ongoing omits `until_date`; click-to-fill.

## 7. Out of scope

- Mode URL writes, Current rates copy, Existing leads handoff
  (LCE-03).
- Structured rebuild rows (LCE-04).
- Server construction changes (LCE-01 already shipped).
- Language-deck test expansion if it belongs more naturally with
  LCE-03 — do the form tests here either way.
- Full browser walk (LCE-05). Smoke By date on localhost if the
  servers are up; do not block complete on a down local stack —
  record it.

## 8. Tests

Spec §10.2 rows for the default form, period list, Ongoing POST
body, and click-to-fill. Extract helpers from `cpl-manager.tsx` if
that is the only way to test without a DOM harness.

## 9. Knowledge updates after this issue ships

Do not mark the pack live in Admin CONTEXT until LCE-05.

## 10. Acceptance criteria

- [ ] Default Advanced / By date path has From, Through, Amount,
      Ongoing — no operation-name `<select>`.
- [ ] Save sends `operation: "set_range"` with `expected_revision`
      from the loaded schedule.
- [ ] Ongoing omits `until_date`.
- [ ] Period list has no Period ID.
- [ ] Clicking a period fills the form.
- [ ] Feed control is not labeled Granularity.
- [ ] Admin role cannot save.
- [ ] `pnpm test && pnpm typecheck && pnpm lint` in `vantage-admin`.
- [ ] Local smoke on By date if :3000 and :3001 are up.

## 11. Commands

```bash
cd vantage-admin && pnpm test && pnpm typecheck && pnpm lint
```

Paste output in the completion report.

## 12. Risks

- Re-implementing `set_range` wrong in the client preview helper.
- Leaving the command dropdown “for power users” on the default
  canvas.
- Showing exclusive stored ends again.

## 13. Rollback

Restore `AdvancedCplPanel` command dropdown. `set_range` can remain
on the client type union unused.

## 14. Handoff list for the completion report

- Request body actually POSTed.
- 21st.dev component id / take used, or why none.
- Whether JSON rebuild is hidden or still in a details block.
- What you did not do (LCE-03–05).

**Unblocks:** LCE-03 and LCE-04 (after this is complete).
