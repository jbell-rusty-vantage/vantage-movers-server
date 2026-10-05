# AGENTS.md

This file is intentionally thin. See the following for the real guidance:

- **`docs/index.md`** — OKF v0.2 catalog. Start here for Service / ADR / Reference concepts. Query with `pnpm okf:query`.
- **`CLOUD_AGENTS.md`** — Cursor Cloud dev environment setup and non-obvious runtime caveats
  (`.env` requirement, API-secret header, `SHEET_SYNC_MODE`, the MongoDB replica-set
  requirement, how to start/verify the API, and how to run tests/typecheck).
- **`.cursor/rules/`** — workspace rules (`*.mdc`) covering project organization, API/service
  boundaries, schema/CRUD contracts, the form-lead → Granot CRM flow, the Google Sheets sync
  process, RingCentral integration, and the branch/test/Vercel workflow.

## Quality checkpoints

See `docs/quality-checkpoints.md`. User-level hooks for Claude Code, Cursor and Codex start a
background checkpoint after a turn ends:
- a git-based gate skips insignificant changes;
- a model triage (Sonnet 5.5, Grok 4.7 or Codex, matching the tool in use) chooses a clean-code
  pass, a documentation pass, both or neither;
- the result is checked and auto-applied to the working tree (never staged or committed).

Nothing needs to be run per turn. If a prompt carries a "Quality worker … applied edits" notice,
re-read those files before editing them. `pnpm finish-work` forces a checkpoint now.
If `AGENT_QUALITY_CHILD=1`, you are inside the checkpoint worker: follow your stage prompt
and never invoke finish-work or start another quality worker.

## Code Review Rules

- Report concrete regressions with a triggering scenario and affected path. Review the changed
  behavior and necessary callers, not unrelated formatting or speculative improvements.
- Preserve trusted owner gates, Zod contracts, Mongo/TEST_MODE boundaries, idempotency,
  and side-effect ordering. Keep business policy in services rather than transport handlers.
- Inspect SRP, dependency direction at external boundaries and names that reveal assumptions,
  account/source scope, units and side effects. Avoid unnecessary abstraction layers.
- Check the matching Service document and glob-scoped rule for drift. Do not rewrite locked
  lifecycle or sales-intelligence contracts to make an implementation appear compliant.
