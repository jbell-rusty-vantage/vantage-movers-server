---
name: operational-story
description: Traverses vantage-main-server service by service, takes stock of progress, and writes one operational-story recommendation per pass. Use when recommending or applying a story-like refactor, clean-code rename, or when a Cloud run should resume `.cursor/story-refactor-workspace/` and continue the codebase traversal.
---

# Operational Story

Traverse the **entire** `vantage-main-server` `src/` tree, **service by service**. Each Cloud run **takes stock**, then finishes **one pass** of the current service. A pass is one recommendation file (or a thin-folder skip). Large services stay `in-progress` across many runs.

Do not implement. Do not split by CRUD. Do not jump to the next service while the current one has unchecked production modules.

Read [RECOMMENDATION.md](RECOMMENDATION.md) before writing. The quality bar is [../../story-refactor-workspace/recommendations/form-lead.md](../../story-refactor-workspace/recommendations/form-lead.md). The board is [../../story-refactor-workspace/TRAVERSAL.md](../../story-refactor-workspace/TRAVERSAL.md).

## Cloud session (every run)

```
Session
- [ ] 1. Take stock (TRAVERSAL + recommendations/ + NOW + open MESSAGES)
- [ ] 2. Take or steal the lock (90-minute rule)
- [ ] 3. Continue the current in-progress service, or open the next unvisited service
- [ ] 4. Write exactly one pass (one recommendation, or finish a thin folder)
- [ ] 5. Rewrite TRAVERSAL stock + the service checklist
- [ ] 6. Session file, NOW last, release the lock
- [ ] 7. Return the brief
```

**Disk wins.** `recommendations/` and the service checklists beat `NOW.md`. Fix NOW and the Stock block if they disagree.

**Hard no for Cloud:** do not edit `src/`, tests, routes, models, or knowledge docs. Do not open a second PR. Do not push `main`. Do not start implementation. Do not open Wave B while Wave A has an `unvisited` or `in-progress` service.

## 1. Take stock

Before choosing work, read `TRAVERSAL.md` (Stock + current service), list `recommendations/*.md`, and skim the latest session.

Rewrite the **Stock** block so it matches disk:

- wave, visited / in-progress / unvisited counts
- recommendation count
- current service and next unchecked module
- last session id

If a service is `in-progress` but its checklist is missing files that exist on disk, add them before you recommend. If a recommendation file exists and the checklist still says empty, mark it `recommended` and point at the file.

Completion criterion: Stock counts match folders + files on disk; next module is named.

## 2. Choose the pass

1. If a service is `in-progress`, **stay there**. Next pass = first unchecked production module.
2. If none are in progress, open the next `unvisited` service in TRAVERSAL order.
3. **Opening a service:** list every production `.ts` file in the folder (not tests, not an empty `index.ts` barrel). Write that checklist on the service row. Mark obvious barrels / type-only / one-line re-exports `skipped` with two words why. Then pick the first story-worthy module for this pass.
4. A module is story-worthy when it owns a workflow (ingest, correct, post, sync, book, cancel, reconcile, drain, claim) or its names are CRUD / executor mechanics. Thin helpers and facades skip.
5. If every module in the newly opened folder skips, the pass is the enumeration. Mark the service `visited`. Do not invent a rename list.
6. One large file may be one pass. Do not recommend two modules in one run. Do not “finish” a large service in one sitting.

Completion criterion: one target path (or a fully skipped thin folder) and its place on the checklist.

## 3. Read the operation, not the verbs

Read the whole module. Then read:

- every current caller of its exports
- matching `*.test.ts` / replica tests
- `docs/knowledge/services/` for that concept, when it exists
- workspace-root `CONTEXT.md` when present — do not invent a copy if the standalone checkout lacks it
- sibling modules the file already orchestrates (do not pull those in)

Name the **operations**, not HTTP verbs. Record load-bearing **seams**. Use **module / interface / seam / adapter / depth**. Do not say component, API, or boundary.

Completion criterion: you can list the operations, the seams callers need, and the siblings this file orchestrates.

## 4. Write the recommendation

Write `.cursor/story-refactor-workspace/recommendations/<service>-<module>.md` from [RECOMMENDATION.md](RECOMMENDATION.md). Exception: the quality bar stays `form-lead.md`.

Order of work inside the file:

1. **Reorganization** — operations; one screenplay or later split by story, never CRUD.
2. **Operational-story names** — file order is the operation. A stakeholder can read the primary path out loud.
3. **Precise logic** — duplicate implementations, lying names, pass-throughs.
4. **Testing** — the **interface** is the test surface. No helper-unit tests.
5. **Don't-do** — standing list plus any module-specific forbidden move.

Keep old exports as one-line aliases. Extract a child name only when it hides a real decision. Leave sibling **modules** alone.

Completion criterion: every required heading is present; the story block could be shown to a stakeholder; no `src/` edit.

## Standing don't-do

- A `*Service` class with `create` / `update` / `delete`.
- Thirty two-line functions that only wrap an existing call.
- Moving the module into a CRUD folder (`create.ts` / `update.ts` / `delete.ts`) for cleanliness.
- Breaking a load-bearing before-commit / after-commit **seam**.
- Treating a different origin or command as this story.
- Inventing a **seam** that has only one **adapter**.
- Silently "fixing" a known ADR / order gap while recommending a rename.
- Jumping to the next service while this one has unchecked production modules.
- Writing a “whole folder” recommendation for `granotLifecycle`, `sheetSync`, `ringcentral`, `reporting`, or any other large service.

## 5. Board and brief

On the service checklist: `recommended` + path, or `skipped` + reason. If unchecked modules remain, status stays `in-progress` and Stock names the next module. If none remain, `visited`. Rewrite Stock counts. Write `sessions/<session-id>.md`. Rewrite `NOW.md` last (`lock: none`).

Session id: `story-<service>-<module>-<utc>`.

Return:

1. Stock (visited / in-progress / unvisited, current service, next module)
2. This pass (path or skip reason)
3. Operations named
4. Remaining modules in this service
5. Confirmation: no `src/` edits
