# Vantage Main Server — `.cursor` Directory

Cursor agent context for this repo: rules, skills, agents, and cloud files. Not deployed with the API.

Production API: https://vantage-movers-main-server.vercel.app

Service / ADR / Reference catalog: [`docs/index.md`](../docs/index.md). Query with `pnpm okf:query`.

## Directory layout

```
.cursor/
├── index.md              ← this file (directory map only)
├── agents/               ← docs-keeper, lead-lifecycle spec extractor
├── rules/                ← glob-scoped *.mdc
├── skills/               ← hit-vantage-api, okf-docs-conversion, okf-docs-optimization, operational-story
├── okf-workspace/        ← optimization board (NOW, messages). Not knowledge
├── story-refactor-workspace/ ← operational-story traversal (NOW, TRAVERSAL). Not knowledge
├── scripts/              ← Cloud helpers (ensure-cloud-runtime, start-mongo, start-api)
├── environment.json      ← Cloud agent environment
└── Dockerfile            ← Cloud agent image
```

## `agents/`

| Agent | Use for |
| --- | --- |
| [docs-keeper](agents/docs-keeper.md) | After code or workflow changes: update `docs/index.md` plus the matching `docs/knowledge/` Service and glob-scoped rule. |
| [lead-lifecycle-spec-extractor](agents/lead-lifecycle-spec-extractor.md) | Extract locked Granot lead-lifecycle contracts before implementing a unit. |

## `skills/`

| Skill | Use for |
| --- | --- |
| [hit-vantage-api](skills/hit-vantage-api/SKILL.md) | Call this server’s HTTP API with `x-api-secret`. |
| [okf-docs-conversion](skills/okf-docs-conversion/SKILL.md) | Frozen. Conversion is Done. Do not removen. |
| [okf-docs-optimization](skills/okf-docs-optimization/SKILL.md) | Current. Stub removal, pointer collapse, residue, routers, coverage, code-truth. |
| [operational-story](skills/operational-story/SKILL.md) | Traverse `src/` service by service. Take stock, then write one recommendation pass. Does not implement. |

## `rules/`

Glob-scoped `*.mdc`. Highlights: `documentation-maintenance`, `business-logic`, `owner-lead-workflow`, `sheet-sync-process`, `project-organization`, `form-lead-granot-crm`, `granot-lifecycle-capture`, `granot-http-automation`, `ringcentral-integration`, `operations-registry`, `observability-service`, `schema-and-crud-inputs`, `backend-safety`, `testing`, `typescript`, `codebase`, `branch-test-vercel-workflow`.

New Service: stamp under `docs/knowledge/` and add a row to [`docs/index.md`](../docs/index.md) only.
