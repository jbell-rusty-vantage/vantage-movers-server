# Router cleanup (Pass 2 partial, Pass 4 full)

Knowledge lives in OKF. Routers point. Do not paste Service invariants back into `.mdc`.

## Target graph

```text
AGENTS.md / CLAUDE.md / documentation-maintenance.mdc
        → docs/index.md
            → docs/knowledge/services/*.md
            → docs/knowledge/granot-lifecycle/*.md
            → ../docs/adr/*.md
            → ../CONTEXT.md   (glossary, not a concept dump)
.cursor/rules/*.mdc (glob)
        → 2–5 concept paths + existing globs
.cursor/agents/docs-keeper.md
        → new paths + OKF fields; drop the "do not migrate" line
.cursor/index.md
        → catalog that names docs/knowledge/ as canonical, stubs as redirects
```

## AGENTS.md

Keep it thin. Add one bullet (do not delete `CLOUD_AGENTS.md` or rules pointers):

```markdown
- **`docs/index.md`** — OKF v0.2 catalog. Start here for Service / ADR / Reference concepts. Query with `pnpm okf:query`.
```

If `CLAUDE.md` is missing, create it as:

```markdown
@AGENTS.md
```

## `.cursor/index.md`

- Keep the directory-layout section.
- Change the businesslogic table to the new `docs/knowledge/` paths.
- Note that `.cursor/businesslogic/` holds stubs for one release.
- Point the layer table's business-logic row at `docs/knowledge/`.

## Glob-scoped `.mdc` (Pass 2 + 4)

Keep `description`, `globs`, and `alwaysApply: false`. Replace encyclopedia prose with:

```markdown
# <same title>

Owner rules live in the Service concept, not in this rule.

- [ringcentral-call-lead-qualification](../../docs/knowledge/services/ringcentral-call-lead-qualification.md)
- [operations-registry](../../docs/knowledge/services/operations-registry.md)
- [call-lead](../../docs/knowledge/services/call-lead.md)

Software-only notes that are not in those files may stay below (env, ngrok, collection suffix, script names).
```

**Pass 2** thins only:

- `ringcentral-call-lead-candidates.mdc`
- `ringcentral-integration.mdc` (if it restates qualification)
- `operations-registry.mdc`

**Pass 4** thins every remaining workflow rule that still restates a Service. Keep unique software facts (env names, TEST_MODE, route mounts, script flags).

Always-apply maps stay:

- `project-organization.mdc`
- `codebase.mdc` (only if it stays a one-screen map)
- `backend-safety.mdc`

`documentation-maintenance.mdc`: retarget the business-logic row from `.cursor/businesslogic/*.service.md` to `docs/knowledge/**/*.md`, and say docs-keeper + this conversion skill own updates.

`business-logic.mdc`: become “read the matching Service under `docs/knowledge/`” plus cross-service invariants that are not already in one Service file.

## docs-keeper

Edit both `vantage-main-server/.cursor/agents/docs-keeper.md` and workspace `.cursor/agents/docs-keeper.md` if that copy is in this checkout.

1. Authority item 5 / business-logic layer → `docs/knowledge/services/` and `docs/knowledge/granot-lifecycle/`.
2. Delete “Do not migrate `.cursor/businesslogic/` unless asked.”
3. Rewrite the glob → document map to the new filenames (see [INVENTORY.md](INVENTORY.md)).
4. Teach OKF fields: when patching a concept, set `generated.by` to the keeper process, never write `human:verified`, leave `status: stable` only when a human already verified and the change is a citation/date fix; otherwise `draft`.
5. Catalog layer → `docs/index.md` (and `.cursor/index.md` as a Cursor-only map).
6. New Service file recipe → create under `docs/knowledge/`, stamp per [FRONTMATTER.md](FRONTMATTER.md), add an index row.

Do not implement the 12-hour scheduled loop in this pass. Conversion Cloud runs resume from `.cursor/okf-workspace/`, not from a single handoff markdown.

## Cross-repo

Server invariants stay in this repo's OKF files. Admin / extension / client rules may link here by repo + path (`vantage-main-server/docs/knowledge/services/form-lead.md`). Do not copy the body.
