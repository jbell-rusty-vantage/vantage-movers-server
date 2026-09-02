# LCE-04 — Structured rebuild; no JSON

> **Contract maturity: implementation-ready.** Session 4. Replace the
> `replace_schedule` JSON textarea with dated rows. **Do not change
> `set_range` or the default By date form.**

## 1. Authority and required reading

- **Pack specification:** [`../lead-costs-owner-editing-specification.md`](../lead-costs-owner-editing-specification.md)
  — §6.3, §6.4, §10.2 (rebuild).
- **Pack rules:** [`../README.md`](../README.md), [`../AGENT-PROTOCOL.md`](../AGENT-PROTOCOL.md)
- **Prerequisite UI:** LCE-02 By date form.
- **Glossary:** workspace-root `CONTEXT.md`

## 2. Objective

An Owner who must rebuild a Feed’s whole CPL Schedule edits dated
rows (From, Through or Ongoing, Amount) and confirms. They never
type JSON.

## 3. Repository, branch, and prerequisites

- **Repository:** `vantage-admin` only.
- **Prerequisite:** LCE-02 `complete`. May run after or before
  LCE-03; do not edit LCE-03 copy unless it collides.
- **21st.dev:** allowed. Craft target: multi-row inclusive-date
  editor. Search first. Do not generate a new page.
- No commit, push, deploy, or live payload read unless asked.

## 4. Current-state evidence to verify

Observed 2026-09-02; reverify after LCE-02.

- Original Advanced panel has
  `replacePeriodsText` defaulting to
  `'[{"effective_from_date":"2026-01-01","amount":195}]'` and
  `JSON.parse` before `operation: "replace_schedule"`.
- LCE-02 may have hidden that textarea or left it in
  **More schedule tools**. This issue deletes the textarea either
  way.

## 5. Locked decisions and invariants at risk

- Submit still uses API `replace_schedule` with
  `{ effective_from_date, effective_until_date?, amount }`.
- Last row may omit Through (Ongoing). Earlier rows must have
  Through. Client validates that before POST.
- Confirm copy from spec §6.3.
- Do not expose `split` or `correct_period` as named tools.
- “Change several feeds from one date” is a link to Current rates,
  not a second table.

## 6. Deliverables and exact contract

1. Collapsed **More schedule tools** on By date.
2. **Rebuild the whole timeline:** add/remove rows; From; Through;
   Ongoing on the last row; Amount. Prefill from the loaded
   schedule (inclusive Through via
   `exclusiveEndToInclusiveOwnerDate`).
3. Confirm, then POST `replace_schedule`.
4. Delete the JSON textarea and any `JSON.parse` on this path.
5. Link to Current rates for bulk from-date edits.
6. Tests: structured rows → `replace_schedule` body; last row
   Ongoing omits `effective_until_date`; no textarea in the tree.

## 7. Out of scope

- Changing `replace_schedule` server validation.
- Auto-running Existing leads after a rebuild (LCE-03 owns the
  shared offer — if LCE-03 already shipped, reuse it for rebuild
  saves that touch past dates).
- Browser walk (LCE-05).

## 8. Tests

Spec §10.2 rebuild rows. Helper that maps UI rows → command body.

## 9. Knowledge updates after this issue ships

None required. LCE-05 points.

## 10. Acceptance criteria

- [ ] No JSON textarea on Lead Costs.
- [ ] Rebuild sends `replace_schedule` from structured rows.
- [ ] Last row may be Ongoing; earlier rows cannot.
- [ ] Confirm sentence warns that existing leads keep stored costs.
- [ ] `split` / `correct_period` are not Owner-visible tools.
- [ ] `pnpm test && pnpm typecheck && pnpm lint` in `vantage-admin`.

## 11. Commands

```bash
cd vantage-admin && pnpm test && pnpm typecheck && pnpm lint
```

## 12. Risks

- Prefilling exclusive stored ends as Through (off-by-one).
- Allowing two Ongoing rows.
- Putting rebuild on the default canvas instead of collapsed.

## 13. Rollback

Restore a collapsed JSON textarea only if structured rows cannot
ship. Prefer leaving rebuild unavailable over showing JSON again.

## 14. Handoff list for the completion report

- Row → API mapping examples.
- 21st.dev component id / take used, or why none.
- Whether the LCE-03 past-dated offer also fires after rebuild.
- What you did not do (LCE-05).

**Unblocks:** LCE-05 (also needs LCE-03).
