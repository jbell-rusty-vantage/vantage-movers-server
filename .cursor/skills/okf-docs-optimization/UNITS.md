# Optimization units

Walk in order. A unit is done only when every **Done when** check is true on disk. Finish one unit (or one G cluster) per Cloud run unless the skill says you may continue.

Do not hand-edit conversion `units.json` or `PROGRESS.md`.

## A — Stub removal

Delete the redirect catalog.

- Delete the entire `.cursor/businesslogic/` directory (all 36 stubs).
- `scripts/okf-query.mjs`: `SEARCH_ROOTS = ["docs"]` only.
- `.cursor/rules/documentation-maintenance.mdc`: drop `.cursor/businesslogic` from `globs` and the “stubs for one release” sentence.
- `docs/index.md`: remove the sentence that `.cursor/businesslogic/` holds stubs.

**Done when**

- `.cursor/businesslogic/` does not exist
- `pnpm okf:query --type Service --status deprecated` prints nothing / count 0
- `pnpm okf:query --type Service` count is 36 (or 36 + any E files already added)
- `rg businesslogic` in `docs/index.md`, `scripts/okf-query.mjs`, and `documentation-maintenance.mdc` is empty (except a historical “deleted” note if you must)

## B — Pointer collapse

One catalog: `docs/index.md`. Routers stay thin.

- `AGENTS.md`: only `docs/index.md`, `CLOUD_AGENTS.md`, `.cursor/rules/`. Remove bullets for `.cursor/index.md`, `.cursor/okf-workspace/`, and docs-keeper.
- Keep `CLAUDE.md` as `@AGENTS.md`.
- Collapse `.cursor/index.md` to a one-screen `.cursor/` directory map (rules, agents, skills, cloud files). Delete the 36-row Service table and every stub link. Prefer collapse over delete if docs-keeper still cites the file; then retarget docs-keeper catalog to `docs/index.md` only.
- Retarget `.cursor/agents/docs-keeper.md` catalog layer to `docs/index.md`. Remove stub-table instructions. If this checkout also has workspace-root `.cursor/agents/docs-keeper.md`, sync the same catalog sentence (do not invent a migration).
- Do **not** delete `.cursor/agents/docs-keeper.md` or `.cursor/okf-workspace/`.

**Done when**

- `AGENTS.md` has no `businesslogic`, no okf-workspace bullet, no `.cursor/index.md` catalog bullet
- `.cursor/index.md` has no Service table and no `businesslogic/` stub links
- docs-keeper does not tell agents to update a 36-row `.cursor/index.md` table

## C — Conversion residue

Mechanical cleanup of leftover conversion wording.

- In `docs/knowledge/**`, rename `## Related businesslogic` → `## Related services`.
- Fix link **labels** that still say `form-lead.service.md`, `sheetSync.service.md`, `granotLifecycle.*.md`, `cancelledLead.service.md`, etc. Hrefs should already be `docs/knowledge/` paths.
- Same label cleanup in `.cursor/rules/business-logic.mdc`.

**Done when**

- `rg "Related businesslogic|form-lead\\.service\\.md|sheetSync\\.service\\.md|granotLifecycle\\." docs/knowledge .cursor/rules/business-logic.mdc` is empty

## D — Thin fat routers

Read [ROUTERS.md](../okf-docs-conversion/ROUTERS.md). Then **read the matching Service + primary code** before deleting prose. If a unique owner invariant is only in the rule and current code still does it, move that sentence into the Service. Otherwise delete the duplicate.

Thin these four only:

| Rule | Keep in the rule | Owner body lives in |
| --- | --- | --- |
| `business-logic.mdc` | Cross-service invariants not already in one Service + links | matching `docs/knowledge/**` |
| `owner-lead-workflow.mdc` | Owner path outline + links. No SMS encyclopedia | `form-lead.md`, and `lead-messaging.md` if E already created it |
| `form-lead-granot-crm.mdc` | Route / env / payload software notes + link | `form-lead.md` |
| `sheet-sync-process.mdc` | Env, `TEST_` prefixes, quotas, modes + links | `sheet-sync.md`, `google-sheets.md` |

Do **not** thin `project-organization.mdc`, `codebase.mdc`, `backend-safety.mdc`, or `production-url.mdc` into Service files.

**Done when**

- Each of the four rules is a router plus software-only facts (roughly one screen, not an encyclopedia)
- Any moved invariant appears in the Service and matches current code
- `generated.by` on those Services is `process:okf-docs-optimization` if you changed the body

## E — Coverage gaps

Create a Service only if code **and** tests prove the module owns owner-facing behavior. Stamp per conversion FRONTMATTER (`type: Service`, `status: draft`, `generated.by: process:okf-docs-optimization`, omit `verified`). Add a `docs/index.md` row. Do not invent glossary terms.

Candidates, in order. Finish one file (or a documented skip) before the next:

1. `docs/knowledge/services/lead-messaging.md` — `src/services/leadMessaging/` + `src/config/domain/leadMessaging.ts` + queue/cron
2. `docs/knowledge/services/employee-bookings.md` — `src/services/employeeBookings/`
3. `docs/knowledge/services/reporting.md` — `src/services/reporting/`
4. `docs/knowledge/services/ingestion.md` — `src/services/ingestion/`

If a candidate is software-only (folder map, no owner invariants), skip and say so in the session + MESSAGES. Do not write a hollow Service.

**Done when**

- Each candidate is either a stamped Service with an index row, or an explicit skip in the latest session file
- Each created Service cites real `resource` / `applies_to` paths that exist
- `pnpm okf:query --type Service` count = 36 + created files

## F — ADR / glossary

Standalone checkout has no `../CONTEXT.md` and no `../docs/adr/`.

- Do not invent copies.
- Leave existing CONTRADICTIONS.md items open unless you closed them with a real file.
- If GitHub MCP shows those files in another Vantage repo, record the canonical path in CONTRADICTIONS.md.

**Done when**

- No new ADR/glossary files were invented in this repo
- CONTRADICTIONS.md still lists `adr-skipped-absent` and `ops-registry-authoritative-plan-absent` unless those files now exist

## G — Deepen existing Services (after A–F)

One cluster per run. Code-truth bar from the skill. Do not split a file across runs.

| Cluster | Files |
| --- | --- |
| `g-leads` | `form-lead.md`, `call-lead.md`, `enrichment.md` |
| `g-bookings` | `bookings.md`, `booked-call-lead-reconciliation.md`, `cancelled-lead.md`, `cancellation-mirror.md`, `customer.md`, `agent-allocation.md` |
| `g-sheets` | `sheet-sync.md`, `google-sheets.md`, `domain-commands.md` |
| `g-search` | `form-lead-search.md`, `call-lead-search.md`, `lead-browse.md`, `admin-search.md`, `analytics.md` |
| `g-catalog` | `catalog.md`, `testimonial.md`, `granot-http-collector.md` |
| `g-granot` | all 14 files under `docs/knowledge/granot-lifecycle/` except `spec-hub.md` (hub stays links-only) |

**Done when** (per cluster)

- Every file in the cluster was opened against its `resource` code + tests
- False sentences fixed; missing current-code invariants added
- `generated.by` / `generated.at` updated on files whose body changed
- Session lists each file → changed | already-true
