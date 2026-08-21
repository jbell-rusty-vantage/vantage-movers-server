# AGENTS.md

This file is intentionally thin. See the following for the real guidance:

- **`CLOUD_AGENTS.md`** — Cursor Cloud dev environment setup and non-obvious runtime caveats
  (`.env` requirement, API-secret header, `SHEET_SYNC_MODE`, the MongoDB replica-set
  requirement, how to start/verify the API, and how to run tests/typecheck).
- **`.cursor/index.md`** — catalog of business-logic docs and glob-scoped rules.
- **`.cursor/okf-workspace/`** — conversion agent board (NOW, messages, ideas, progress). Not knowledge. Resume with `pnpm okf:progress`.
- **`.cursor/agents/docs-keeper.md`** — keep those docs current after code changes; match the
  rule whose `globs` already own the path. Do not invent glossary terms (use `/domain-modeling`).
- **`.cursor/rules/`** — workspace rules (`*.mdc`) covering project organization, API/service
  boundaries, schema/CRUD contracts, the form-lead → Granot CRM flow, the Google Sheets sync
  process, RingCentral integration, and the branch/test/Vercel workflow.
