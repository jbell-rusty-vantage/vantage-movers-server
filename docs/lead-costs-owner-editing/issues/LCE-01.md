# LCE-01 — Server `set_range`

> **Contract maturity: implementation-ready.** Session 1. Add the
> date-range construction. **No Admin UI. Do not remove the four
> existing Advanced operations.**

## 1. Authority and required reading

- **Pack specification:** [`../lead-costs-owner-editing-specification.md`](../lead-costs-owner-editing-specification.md)
  — §3, §5, §10.1, §11.1, §12. Wins on construction and errors.
- **Pack rules:** [`../README.md`](../README.md), [`../AGENT-PROTOCOL.md`](../AGENT-PROTOCOL.md)
- **Invariants:** `vantage-main-server/.cursor/rules/cpl-operations.mdc`
- **Glossary:** workspace-root `CONTEXT.md`

## 2. Objective

An Owner (or the Admin client in LCE-02) can set one amount on one
Source Granularity for inclusive `[from_date, until_date]` — or from
`from_date` onward — in a single `POST .../cpl-schedule/commands`
transaction. The rest of the CPL Schedule stays intact. Leads are not
written.

## 3. Repository, branch, and prerequisites

- **Repository:** `vantage-main-server` only.
- **Branch:** current server desk branch, or `lead-costs-owner-editing`
  if that is how this desk is isolated. See the protocol.
- **Prerequisites:** none. This is the only startable issue.
- No 21st.dev in this issue.
- No commit, push, deploy, or live payload read unless asked.

## 4. Current-state evidence to verify

Observed 2026-09-02; **reverify before coding.**

- `AdvancedCplOperation` in `src/services/operationsRegistry/cplSchedule.ts`
  is `add_future | split | replace_schedule | correct_period`.
  `constructAdvancedCplSchedule` switches on those four.
- `advancedCplScheduleCommandSchema` in
  `src/validation/v1/operationsRegistry.validation.ts` is the same
  four-way union. `until_date` inclusive already exists on
  `replacementPeriodSchema` as `effective_until_date`.
- `v1.routes.ts` maps `parsed.operation` → `type` for the four
  commands around the `handleAdvancedCplScheduleCommand` path.
- `mutateAdvancedCplSchedule` already builds in memory, validates,
  increments `schedule_revision`, persists, audits. Reuse it.
- No `set_range` tests exist. Existing construction tests in
  `cplSchedule.test.ts` must stay green.

## 5. Locked decisions and invariants at risk

- Schedule edits never rewrite Leads.
- Active schedules: no gaps, no overlaps, exactly one open final
  period. `coverage_start_date` stays the first current period start.
- Inclusive Owner through date → exclusive storage via
  `ownerInclusiveEndDateToExclusive`.
- `expected_revision` + `REGISTRY_STALE_REVISION` unchanged.
- Coalesce adjacent same-amount periods **only** in `set_range`.
- Do not change Simple construction or the four existing Advanced
  constructions.

## 6. Deliverables and exact contract

1. Extend `AdvancedCplOperation` with
   `{ type: "set_range"; from_date; until_date?; amount }`.
2. Zod fifth variant: `operation: "set_range"`,
   `from_date`, optional `until_date`, `amount`, optional `reason`,
   `expected_revision`. Refine `until_date >= from_date`.
3. Route maps `operation: "set_range"` → `type: "set_range"`.
4. Implement spec §5.3 in `constructAdvancedCplSchedule`.
5. Tests in spec §10.1 (bounded, span, one-day, ongoing, no-op,
   equivalences, rejects, coalesce, DST, stale revision).
6. Keep `add_future` / `split` / `correct_period` / `replace_schedule`
   callable and tested.

## 7. Out of scope

- Any `vantage-admin` file (LCE-02).
- CPL Correction jobs.
- Simple schedule construction.
- Knowledge / `cpl-operations.mdc` prose beyond a one-line mention
  if you already touch that rule — prefer LCE-05 for the doc pass.
- Owner UI copy.

## 8. Tests

Spec §10.1. Add focused cases next to the existing
`constructAdvancedCplSchedule` tests. Do not skip the reject table.

## 9. Knowledge updates after this issue ships

Optional one-line in `cpl-operations.mdc` if you are already there.
LCE-05 / docs-keeper owns the Service pointer.

## 10. Acceptance criteria

- [ ] `set_range` bounded window inside one period keeps prefix and tail.
- [ ] Window spanning multiple periods becomes one amount across the span.
- [ ] F = T is a valid one-day window.
- [ ] Omitted `until_date` opens from F and drops later periods.
- [ ] Same amount already covering the exact window is `{ changed: false }`.
- [ ] T < F and F before coverage start are `REGISTRY_DEPENDENCY_CONFLICT`
      with the spec’s Owner-safe strings.
- [ ] Adjacent same-amount periods coalesce.
- [ ] Existing four Advanced operations still pass their tests.
- [ ] No Form Lead / Call Lead writes in the mutation path.
- [ ] Package test + typecheck for the touched schedule/validation files.

## 11. Commands

```bash
cd vantage-main-server && pnpm exec tsx --test src/services/operationsRegistry/cplSchedule.test.ts src/validation/v1/operationsRegistry.validation.test.ts
```

Plus the repo’s usual typecheck if that is how this package is
checked. Paste output in the completion report.

## 12. Risks

- Off-by-one on inclusive Through vs exclusive storage.
- Forgetting the open tail after a bounded window that sits inside
  the current open period.
- Coalescing in a shared helper and changing `split` behavior.
- Client-chaining leftover comments that invite LCE-02 to skip this
  command.

## 13. Rollback

Delete the `set_range` variant and tests. The four old operations
remain the Advanced API.

## 14. Handoff list for the completion report

- Construction cases vs spec §5.3 table.
- Exact request body example LCE-02 should send.
- Owner-safe error strings as implemented.
- What you did not do (Admin UI, docs).

**Unblocks:** LCE-02.
