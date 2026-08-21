---
name: okf-docs-conversion
description: Converts vantage-main-server business-logic docs to OKF v0.2 — stamps searchable frontmatter, moves files into docs/knowledge, and rewires AGENTS.md, Cursor rules, and docs-keeper so the graph stays linked. Use when converting docs to OKF, running a docs-conversion Cloud automation, stamping frontmatter, moving .cursor/businesslogic files, updating docs/index.md, or stopping documentation drift in vantage-main-server.
---

# OKF docs conversion (vantage-main-server)

Conversion-phase skill. A later maintenance skill will own the 12-hour drift loop. Do not invent that loop here.

Work only in `vantage-main-server` unless a path in this skill is explicitly outside it (`../CONTEXT.md`, `../docs/adr/`). Do not implement product code. Do not open `vantage-admin` conversion.

Read [FRONTMATTER.md](FRONTMATTER.md) before writing any YAML. Read [INVENTORY.md](INVENTORY.md) before choosing a file. Read [ROUTERS.md](ROUTERS.md) before editing `AGENTS.md`, `.mdc`, or docs-keeper.

## Session start (every Cloud run)

Copy this checklist and complete it in order:

```
Session
- [ ] 1. Resume
- [ ] 2. Detect pass
- [ ] 3. Do the next unfinished atomic units
- [ ] 4. Verify with okf:query / index
- [ ] 5. Write docs/okf-conversion-handoff.md
- [ ] 6. Return the conversion brief
```

1. **Resume.** Read `docs/okf-conversion-handoff.md` if it exists. Trust the filesystem over the handoff when they disagree.
2. **Detect pass** from facts, not memory:

   | Fact | Pass |
   | --- | --- |
   | Missing `docs/index.md` or `scripts/okf-query.mjs` or `okf:query` in `package.json` | **0 — contract** |
   | Any inventory Service/ADR file has no YAML `type:` | **1 — stamp** |
   | RingCentral qualification or Operations Registry still lives only under `.cursor/businesslogic/` | **2 — two-slice move** |
   | Any inventory file still has a real body under `.cursor/businesslogic/` (not a stub) | **3 — remaining moves** |
   | `AGENTS.md` / docs-keeper / glob `.mdc` files still hold unique business sentences or omit `docs/index.md` | **4 — routers** |
   | All inventory files live under `docs/knowledge/` or stamped `../docs/adr/`, stubs only at old paths, routers point at the index | **Done.** Stop. Do not start maintenance automation. |

3. **Spend the session.** Finish the current pass if it is mechanical. On Pass 3, finish whole **clusters**, not stray files. Never leave a move half-done.
4. **Verify.** After Pass 0 exists, run `pnpm okf:query` (add `--type Service` / `--stale` as needed). Index rows must match files on disk.
5. **Handoff last.** Always write `docs/okf-conversion-handoff.md` before stopping, even if the session ran out of context mid-cluster (then undo the partial file so the tree is consistent).
6. **Brief.** Return the output format below. Do not push `main`. A Cloud automation may open or update one docs PR; do not auto-merge.

## Hard rules

- **Stamp, do not rewrite.** YAML on top. Keep the prose. Do not split a long Service (form-lead stays one file).
- **One concept, one path.** Path is identity. After a move, old path is a stub only.
- **Link, do not redefine.** Glossary terms stay in workspace-root `CONTEXT.md`. ADRs stay in workspace `docs/adr/`. Do not explode the glossary into concept files.
- **Code and tests beat stale docs.** When you already have a file open, fix a sentence that current code contradicts. Do not describe intended design as shipped. Known gaps stay labeled gaps.
- **Never write `human:` verified.** First stamp is `status: draft`, `generated.by: process:okf-docs-conversion`, `verified` omitted.
- **Never invent glossary terms, Source IDs, or secrets.** Missing language → list it for `/domain-modeling`.
- **Do not OKF-ify** the Granot FINAL SPEC, sprint/unit docs, ODV issues, showcase, historical plans, or archives. One Reference hub may link to them.
- **Do not install** `okf-gem`, kcmd, OpenWiki, or a Ruby stack. Search is `docs/index.md` + `pnpm okf:query`.
- **Do not treat docs-keeper as the migrator.** That agent currently forbids this move. This skill is the explicit conversion exception. Update docs-keeper in Pass 4 so it stops forbidding the new paths.

## Navigation (index → query → open → cite)

1. Open `docs/index.md`.
2. Run `pnpm okf:query --type Service --tag <tag>` (or `--stale`). It prints paths, not bodies.
3. Open 1–3 files. Cite those paths plus `resource` / `sources`.

`rg '^type: Service'` is a fast filter only. It cannot do tag, status, or `stale_after`.

## Pass 0 — contract + query

Stop when an agent can list types without opening every file.

Create, in this order:

1. Copy [scripts/okf-query.mjs](scripts/okf-query.mjs) to `scripts/okf-query.mjs`. Do not regenerate it.
2. Add to `package.json`: `"okf:query": "node scripts/okf-query.mjs"`.
3. Write `docs/index.md` with `okf_version: "0.2"`. Type-grouped list, one-line descriptions, current paths from [INVENTORY.md](INVENTORY.md). No service bodies.
4. Add one bullet to `AGENTS.md` pointing at `docs/index.md`. Do not rewrite `CLOUD_AGENTS.md`.
5. Write the Granot Reference hub: `docs/knowledge/granot-lifecycle/spec-hub.md` (see inventory). Link the FINAL SPEC and owner runbooks. Do not copy spec text.
6. Write the first `docs/okf-conversion-handoff.md`.

## Pass 1 — stamp in place

Stop when `pnpm okf:query --type Service` returns 36 rows and all 3 ADRs have `type: ADR`. Files do not move.

For each unstamped inventory file:

1. Read the existing header (`Primary code`, `Domain terms used`, glossary/ADR links) and the first body sentence.
2. Prepend the YAML from [FRONTMATTER.md](FRONTMATTER.md). Keep the existing Markdown header block under it.
3. Turn domain-term names into Markdown links to `CONTEXT.md` **only if** they are not already links. Do not add definitions.
4. If `Primary code` paths are gone or an invariant is false vs current code, fix that sentence and note it in the brief.
5. Update the matching `docs/index.md` row if the title/description changed.

Do ADRs at `../docs/adr/0001-*.md` … `0003-*.md`. Stamp only. Do not rewrite the decision.

## Pass 2 — two-slice move

Move only:

- `.cursor/businesslogic/ringcentral-call-lead-qualification.service.md` → `docs/knowledge/services/ringcentral-call-lead-qualification.md`
- `.cursor/businesslogic/operationsRegistry.service.md` → `docs/knowledge/services/operations-registry.md`

For each file, apply **Move unit** below, then thin the two matching `.mdc` files per [ROUTERS.md](ROUTERS.md). Stop when `pnpm okf:query` hits the new paths and both stubs resolve.

## Pass 3 — remaining moves

Process [INVENTORY.md](INVENTORY.md) clusters in this order: `leads` → `bookings` → `sheets` → `search` → `catalog` → `granot-lifecycle`. Skip files already moved.

Finish a cluster (every file moved, stubbed, links fixed, index updated) before starting the next. If context is low, hand off after a complete cluster.

## Pass 4 — routers

Apply [ROUTERS.md](ROUTERS.md) in full. Stop when no unique business sentence lives only in a `.mdc`, and `AGENTS.md`, `CLAUDE.md` (create as `@AGENTS.md` if missing), `documentation-maintenance.mdc`, `.cursor/index.md`, and docs-keeper all point at `docs/index.md` plus the new knowledge paths.

## Move unit (atomic)

Do all of these for one file before touching the next:

1. `git mv` (or write + delete) to the target path in [INVENTORY.md](INVENTORY.md). Drop `.service` from the filename. Granot files drop the `granotLifecycle.` prefix.
2. Rewrite relative links for the new depth. See [FRONTMATTER.md](FRONTMATTER.md) link table.
3. Leave a stub at the old path (deprecated Service, one link, no invariants).
4. Point `docs/index.md` at the new path.
5. Fix inbound links from already-converted siblings and from `.cursor/index.md`.

## Handoff file

Write `docs/okf-conversion-handoff.md` as Markdown (not an OKF concept — no `type:`):

```markdown
# OKF conversion handoff
- Date (UTC):
- Pass completed / pass in progress:
- Files stamped this session:
- Files moved this session:
- Clusters finished:
- Next atomic unit:
- Index / okf:query check:
- Factual updates (path → sentence-level change):
- Contradictions left open:
- Do not touch next:
```

## Output format

```markdown
# OKF conversion — <pass>

## 1. Detected start state
- Handoff present: yes/no
- Pass started: 0–4 / done

## 2. Atomic units completed
- path → stamp | move | router | skip

## 3. Search graph
- `pnpm okf:query --type Service` count
- index rows added/retargeted

## 4. Factual updates
- path → what current code forced

## 5. Left for the next session
- Next pass and first file/cluster

## 6. Contradictions
- code vs doc vs CONTEXT vs ADR vs FINAL SPEC
```

Write `none` when a section does not apply.
