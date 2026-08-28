# Story implementation workspace

Tracks **implementation** of clean-code story renames.

This is not the recommendation workspace. Do not write here from a
recommendation pass. Do not write recommendations here.

| Workspace | Path | Writes | Branch |
|---|---|---|---|
| Recommendations | `.cursor/story-refactor-workspace/` | `recommendations/`, `TRAVERSAL.md`, `NOW.md`, `MESSAGES.md`, `sessions/story-*` | `docs/story-refactor` |
| Implementation (this) | `.cursor/story-implementation-workspace/` | `BOARD.md`, `NOW.md`, `MESSAGES.md`, `passes/`, `sessions/impl-*` | `refactor/<story-slug>` |

The recommendation catalog stays in `story-refactor-workspace/TRAVERSAL.md`.
This board only lists stories that have an implementation row.

Skill: `.agents/skills/story-refactor-implementation/SKILL.md`
