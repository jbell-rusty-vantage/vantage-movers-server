---
name: okf-docs-optimization
description: Optimizes vantage-main-server OKF docs after conversion — deletes stubs, collapses extra catalogs, thins fat routers, and rewrites Service bodies from current code. Use when running an OKF optimization Cloud pass, retargeting okf-workspace after conversion Done, deleting .cursor/businesslogic, or creating missing Service files (lead-messaging, employee-bookings, reporting, ingestion).
---

# OKF docs optimization (vantage-main-server)

Post-conversion only. Conversion is Done. This skill owns stub removal, pointer collapse, residue cleanup, router thinning, coverage gaps, and **code-truth** rewrites of Service bodies.

Do not run conversion passes. Do not start the 12-hour maintenance loop. Do not implement product code. Do not touch `vantage-admin`.

Read [UNITS.md](UNITS.md) before choosing work. Read conversion [FRONTMATTER.md](../okf-docs-conversion/FRONTMATTER.md) and [ROUTERS.md](../okf-docs-conversion/ROUTERS.md) for YAML and router shape only.

## Session start (every Cloud run)

```
Session
- [ ] 1. Resume workspace (optimization board, not conversion progress)
- [ ] 2. Detect next unfinished unit from UNITS.md + disk
- [ ] 3. Take or steal the lock
- [ ] 4. Finish the next unfinished atomic unit (or one G cluster)
- [ ] 5. Verify with okf:query / index / listed disk checks
- [ ] 6. Write the workspace handoff
- [ ] 7. Return the optimization brief
```

1. **Resume.** Read `.cursor/okf-workspace/README.md`, `NOW.md`, open `MESSAGES.md`, then [UNITS.md](UNITS.md). **Do not treat `pnpm okf:progress` as authority.** That script is conversion-only and will say `done`. Do not run `pnpm okf:progress --write`.
2. **Detect next unit from disk**, not memory. Walk UNITS.md in order. A unit is unfinished until every **Done when** check on disk is true.
3. **Spend the session.** Finish **one** atomic unit (A–F) or **one** G cluster. If context is high and the unit is mechanical (A/B/C), you may finish the next mechanical unit in the same run. Never start G until A–F are done. Never leave a half-delete, half-thin, or half-written Service.
4. **Verify.** Run `pnpm okf:query --type Service` and `--status deprecated`. Index rows must match files on disk.
5. **Handoff last.** Session file, messages, contradictions, rewrite `NOW.md`, release the lock.
6. **Brief.** Output format at the bottom. Do not push `main`. One optimization PR. Do not auto-merge.

## Hard rules

- **Code and tests beat stale docs.** Before changing a Service body or moving an invariant out of a rule, open the `resource` / `applies_to` files and the tests that name those functions. Pluck the real order, gates, and side effects. Do not describe intended design as shipped. Known gaps stay labeled gaps.
- **One concept, one path.** After stubs die, `.cursor/businesslogic/` must not exist. Do not recreate it.
- **Routers point.** `.mdc` files keep globs, env, TEST_MODE, mounts, script names. Owner invariants live in `docs/knowledge/`.
- **Link, do not redefine.** Glossary stays in workspace-root `CONTEXT.md` (absent in the standalone GitHub checkout). Do not invent terms, Source IDs, or secrets.
- **Never write `human:verified` or `status: stable`.** New or rewritten files stay `status: draft`. Set `generated.by: process:okf-docs-optimization` and refresh `generated.at` when the body changes.
- **Do not OKF-ify** the Granot FINAL SPEC, sprint/unit docs, ODV/ODR, showcase, historical plans, or archives.
- **Do not install** `okf-gem`, kcmd, OpenWiki, or a Ruby stack.
- **Stop and record** code vs doc vs glossary vs ADR vs FINAL SPEC fights in `CONTRADICTIONS.md`.

## Code-truth bar (units D, E, G)

For each Service you touch:

1. List `resource` + `applies_to` + the public route/cron/queue that calls it.
2. Read those files. Read the matching `*.test.ts` / `*.spec.ts` (or the test that imports the function).
3. Trace one happy path and the documented failure/skip paths (duplicate, flag-off, referral-blocked, lease miss).
4. Patch the Service so a later agent can implement against the doc without rereading the module.
5. If a sentence is false vs code, fix the sentence. If a unique owner rule lives only in a `.mdc`, move it into the Service and leave a link in the rule.

A run that only renames headings or deletes stubs has not met this bar for D/E/G.

## Suggested 4-run split

| Run | Finish |
| --- | --- |
| 1 | **A** stub removal, then **B** pointer collapse |
| 2 | **C** residue, then **D** thin the four fat routers (code-read first) |
| 3 | **E** coverage-gap Services (code + tests first; skip software-only) |
| 4 | **F** ADR/glossary notes, then **G** deepen existing Service bodies (one cluster) |

If you finish early, take the next unfinished unit. If time is low, hand off after a complete unit.

## Branch / PR

- Repo is the standalone GitHub checkout (`vantage-movers-server`).
- If PR #5 is still open, **do not** pile optimization onto it unless `NOW.md` already names that PR. Prefer branch `docs/okf-optimization` from the conversion tip (`docs/okf-conversion` or merged conversion commit).
- Never removen. Never open a second conversion PR. Never open a second optimization PR — update the one in `NOW.md`.
- GitHub MCP: inspect PR #5 and the optimization PR only. Tavily / Context7: OKF fields and Cursor rule conventions only.

## Workspace

Coordination: `.cursor/okf-workspace/`. Optimization checklist: `.cursor/okf-workspace/OPTIMIZATION.md` (hand-checked; this is disk for the phase).

Session id: `opt-<unit>-<utc>` e.g. `opt-a-2026-08-21T2147Z`. Use it in the lock, the session filename, and messages.

## Output format

```markdown
# OKF optimization — <unit>

## 1. Base / PR
- Branch, PR URL, conversion PR #5 status

## 2. Units completed
- id → done | skip | leftover sentence

## 3. Search graph
- `pnpm okf:query --type Service` count
- `pnpm okf:query --type Service --status deprecated` count
- index rows added/retargeted

## 4. Code-truth
- path → what current code forced in the doc

## 5. New Service files
- path or none

## 6. Contradictions
- code vs doc vs CONTEXT vs ADR vs FINAL SPEC

## 7. Left for the next session
- Next unit id (must match NOW.md)
```
