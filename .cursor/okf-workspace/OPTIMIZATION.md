# OKF optimization checklist

Hand-checked. This is **disk** for the optimization phase. Do not hand-edit `PROGRESS.md` (conversion generator). Do not run `pnpm okf:progress --write`.

Skill: `.cursor/skills/okf-docs-optimization/`. Units: `.cursor/skills/okf-docs-optimization/UNITS.md`.

Mark `[x]` only when the unit's **Done when** checks are true on disk.

## Phase

- [x] Conversion Done (36/36 moved). Frozen. Do not removen.
- [x] Optimization A–F
- [ ] Optimization G (optional deepen; after A–F)

## Units

- [x] `opt-a` Stub removal — `.cursor/businesslogic/` gone; query roots `docs` only
- [x] `opt-b` Pointer collapse — AGENTS.md thin; `.cursor/index.md` one-screen map
- [x] `opt-c` Conversion residue — no `Related businesslogic` / old `.service.md` labels
- [x] `opt-d` Thin fat routers — business-logic, owner-lead-workflow, form-lead-granot-crm, sheet-sync-process
- [x] `opt-e` Coverage gaps — lead-messaging, employee-bookings, reporting, ingestion (or documented skip)
- [x] `opt-f` ADR / glossary — no invented copies; contradictions left open

## G clusters (after A–F)

- [x] `g-leads`
- [x] `g-bookings`
- [ ] `g-sheets`
- [ ] `g-search`
- [ ] `g-catalog`
- [ ] `g-granot`

## Suggested Cloud split (2-hour runs)

| Run | Finish |
| --- | --- |
| 1 | `opt-a` then `opt-b` |
| 2 | `opt-c` then `opt-d` |
| 3 | `opt-e` |
| 4 | `opt-f` then first unfinished `g-*` if time |
