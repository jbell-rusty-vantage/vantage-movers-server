# LCE-05 — Browser proof and docs

> **Contract maturity: implementation-ready.** Session 5. Walk the
> Owner path. Point knowledge and Admin maps at what shipped. **No
> new features.**

## 1. Authority and required reading

- **Pack specification:** [`../lead-costs-owner-editing-specification.md`](../lead-costs-owner-editing-specification.md)
  — §10.3, §11, §13.
- **Pack rules:** [`../README.md`](../README.md), [`../AGENT-PROTOCOL.md`](../AGENT-PROTOCOL.md),
  [`../LOCAL-ADMIN.md`](../LOCAL-ADMIN.md)
- **Prerequisites:** LCE-02, LCE-03, and LCE-04 `complete`.
- **Glossary:** workspace-root `CONTEXT.md`

## 2. Objective

A reviewer can open local Admin, set a lead cost by date without
seeing command names or Period IDs, and the repo pointers describe
that UI — not the pre-pack Advanced dropdown.

## 3. Repository, branch, and prerequisites

- **Repositories:** `vantage-admin` (browser + CONTEXT / map
  pointers) and pack docs in `vantage-main-server`.
- **Prerequisites:** LCE-02, LCE-03, LCE-04 `complete`.
- Invoke **docs-keeper** after the walk for the matching layers
  only.
- No commit, push, deploy, or live payload read unless asked.

## 4. Current-state evidence to verify

Reverify the shipped LCE-02–04 UI. Do not trust this pack’s
2026-09-02 “current state” for the Advanced dropdown — that should
already be gone.

## 5. Locked decisions and invariants at risk

- Do not add features to pass the walk. If something required by
  §11 is missing, send it back to the owning issue.
- Do not paste seed passwords.
- Do not mark a criterion checked from a screenshot of a loading
  spinner.

## 6. Deliverables and exact contract

1. Browser walk in spec §10.3. Record URL, role, and what you saw
   for each step.
2. Invoke docs-keeper:
   - `docs/knowledge/services/operations-registry.md` — `set_range`
   - `.cursor/rules/cpl-operations.mdc` — date-range bullet
   - `vantage-admin/CONTEXT.md` Operations Registry pointer
   - `vantage-admin/.cursor/rules/project-organization.mdc`
     Operations Registry row
   - `vantage-main-server/docs/index.md` if LCE-01–04 did not
     already add this pack
3. Tick specification coverage and §11 in `PROGRESS.md`.

## 7. Out of scope

- New commands, new tabs, Analytics, Legacy CPL.
- Production applies.

## 8. Tests

Re-run Admin `pnpm test && pnpm typecheck && pnpm lint` if you
touch pointers that tests read. Server tests only if docs-keeper
does not apply.

## 9. Knowledge updates after this issue ships

This issue **is** the knowledge update. Do not leave “planned”
language in Admin CONTEXT once the walk passes.

## 10. Acceptance criteria

- [ ] Current rates shows the later-rates warning.
- [ ] By date: bounded From / Through / Amount save updates the
      timeline; no ID, JSON, or command names on the default path.
- [ ] Ongoing path works.
- [ ] Click a Past row and retint.
- [ ] Rebuild is structured rows, collapsed.
- [ ] Past-dated save offers Existing leads with pre-filled window.
- [ ] Admin role is read-only.
- [ ] Docs-keeper pointers match shipped code.
- [ ] `PROGRESS.md` §11 rows ticked with evidence.

## 11. Commands

```bash
cd vantage-admin && pnpm test && pnpm typecheck && pnpm lint
```

Plus the browser walk. Paste results in
`reports/LCE-05-completion.md`.

## 12. Risks

- Walking a stale bundle that still has the command dropdown.
- Writing knowledge as if `set_range` were Owner-visible.

## 13. Rollback

Docs pointers can revert. UI rollback is the earlier issues.

## 14. Handoff list for the completion report

- Walk table (step → URL → result).
- Docs-keeper files touched.
- Any §11 criterion sent back to an earlier issue.
- What you did not do.

**Unblocks:** nothing. Pack is complete when this issue is.
