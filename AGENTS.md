# AGENTS.md

Start with a task and a verified target:

- **[Optimization sequence and progress](docs/operations/SERVICE-OPTIMIZATION-ROADMAP.md)** — canonical service-by-service ledger. [Next-session prompt](docs/operations/NEXT-SESSION.md) names the current bounded work; update both at session close.

- **[Operate the server](docs/operations/README.md)** — workflow map, supported commands and remaining proof.
- **[Local/Cloud setup](CLOUD_AGENTS.md)** — clean checkout, safe local API launch and real replica tests. No private `.env` is required. Use `pnpm dev` and verify `pnpm dev:identity` before any scoped local write.
- **[Granot operator runbook](docs/operations/granot.md)** — trace one sealed action on a verified local replica.
- **[Sheet Sync runbook](docs/operations/sheet-sync.md)** — the first supported service CLI slice. Help works offline: `pnpm vantage -- help`. Diagnostics never authorize repair or production access.
- **[Shared vocabulary snapshot](docs/operations/shared-glossary.md)** — exact canonical workspace glossary for standalone clones; [provenance](docs/operations/shared-glossary.provenance.json). Internal relative links retain workspace semantics; use the task guide for executable navigation.

For deeper domain guidance:

- **`docs/index.md`** — OKF v0.2 catalog. Start here for Service / ADR / Reference concepts. Query with `pnpm okf:query`.
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
