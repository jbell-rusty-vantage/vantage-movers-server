# Cloud prompt — operational-story traversal (paste each run)

Follow `.cursor/skills/operational-story/SKILL.md` and `.cursor/story-refactor-workspace/`. This is one **service pass**. This is NOT implementation and NOT OKF docs work.

```
You are running one operational-story traversal pass on vantage-main-server.

Repo: vantage-movers-server (standalone GitHub checkout of vantage-main-server).
Follow `.cursor/skills/operational-story/SKILL.md` exactly.
Board: `.cursor/story-refactor-workspace/TRAVERSAL.md` (Stock + service checklists).
Also read NOW.md and open MESSAGES.md.
Template: `.cursor/skills/operational-story/RECOMMENDATION.md`.
Quality bar: `.cursor/story-refactor-workspace/recommendations/form-lead.md`.

The job is to traverse the entire vantage-main-server src/ tree, service by service.
Wave A is src/services/ (every folder, then leftover root barrels).
Wave B (routes, models, validation, config/domain, middleware, auth) stays locked until Wave A is visited.
Large services (leads, bookings, granotLifecycle, sheetSync, googleSheets, ringcentral, operationsRegistry, admin, analytics, observability, reporting, domainCommands) take many passes. One pass is one module.

## Resume — take stock first
1. Read NOW.md, open MESSAGES.md, then TRAVERSAL.md Stock + the current service row.
2. List recommendations/*.md on disk. If Stock or NOW disagrees with disk, fix them.
3. Take or steal the lock (90-minute rule in the workspace README).
4. Stay on the in-progress service. Next work is its first unchecked production module.
   If no service is in-progress, open the next unvisited service: enumerate every production .ts file onto the checklist, skip barrels/type-only, then recommend the first story-worthy module.
5. Write exactly one pass. Do not implement. Do not edit src/.
6. Do not jump to the next service while this checklist has unchecked modules.
7. Do not write a whole-folder recommendation for a large service.
8. Update the checklist + rewrite Stock. Write sessions/<session-id>.md. Rewrite NOW.md last and release the lock.

## Branch / PR
- Branch: `docs/story-refactor`.
- One PR. Update it on later runs. Do not auto-merge. Do not push main.
- Never implement product code. Never touch vantage-admin. Never start OKF optimization or docs-keeper.

## Quality
A recommendation that only renames create/update/delete and leaves a CRUD dump has failed.
Reorganization first, then story names a stakeholder can read out loud, then precise logic, then tests at the interface.
Keep old exports as aliases. No *Service class. No create.ts / update.ts / delete.ts split.
Do not break a before-commit / after-commit seam. Do not silently reorder ADR-known side effects.

## Hard no
- Do not edit src/, tests, routes, models, or docs/knowledge.
- Do not rewrite recommendations/form-lead.md.
- Do not invent CONTEXT.md or ADRs if they are absent.
- Do not open Wave B early.
- Do not open a second PR.

## Done this slice when
- Stock in TRAVERSAL.md matches disk
- This pass is on the checklist (recommended path or skipped reason)
- NOW.md names the current service + next module and lock is none
- You return the skill brief (stock counts, this pass, operations named, remaining in this service, no src/ edits)
```
