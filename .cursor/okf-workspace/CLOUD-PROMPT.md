# Cloud prompt — OKF optimization (paste each run)

Follow `.cursor/skills/okf-docs-optimization/SKILL.md` and `.cursor/okf-workspace/`. This is one 2-hour slice of a 4-run cycle. Conversion is Done. This is NOT maintenance.

```
You are running one OKF optimization Cloud slice on vantage-main-server.
This is NOT conversion and NOT maintenance.

Repo: vantage-movers-server (standalone GitHub checkout of vantage-main-server).
Follow `.cursor/skills/okf-docs-optimization/SKILL.md` exactly.
Units: `.cursor/skills/okf-docs-optimization/UNITS.md`.
Board: `.cursor/okf-workspace/` (NOW.md, OPTIMIZATION.md, MESSAGES.md).

## Resume
1. Read NOW.md, open MESSAGES.md, OPTIMIZATION.md, then the skill + UNITS.md.
2. Do not run `pnpm okf:progress --write`. Conversion progress will say done — ignore it for scheduling.
3. Disk wins: first unchecked OPTIMIZATION.md box is the unit, even if NOW disagrees. Fix NOW.
4. Take or steal the lock (90-minute rule in the workspace README).
5. Finish the next unfinished atomic unit. Suggested split:
   - Run 1: opt-a then opt-b
   - Run 2: opt-c then opt-d
   - Run 3: opt-e (code + tests for each candidate)
   - Run 4: opt-f then the first unfinished g-* cluster
   If the current unit is mechanical (A/B/C) and you finish early, take the next mechanical unit only. Never start G before A–F. Never leave a half-unit.
6. Write sessions/<session-id>.md from TEMPLATE.md. Check off OPTIMIZATION.md. Rewrite NOW.md last and release the lock.

## Branch / PR
- Never removen. Never open a second conversion PR.
- Prefer branch `docs/okf-optimization` from the conversion tip (`docs/okf-conversion` or the merged conversion commit).
- Inspect conversion PR #5 with GitHub MCP. Do not pile this work onto #5 unless NOW.md already names that PR.
- One optimization PR. Update it on later runs. Do not auto-merge. Do not push main.
- Never implement product code. Never touch vantage-admin.

## Code-truth (required for D, E, G)
Before changing a Service body or moving an invariant out of a rule:
- Open resource + applies_to + the route/cron/queue that calls it
- Open the tests that name those functions
- Trace the happy path and the documented skip/fail paths
- Patch the doc to match shipped code. Known gaps stay labeled gaps.
A run that only renames headings has not finished D/E/G.

## MCP
- GitHub: PR #5 status + the one optimization PR.
- Tavily / Context7: OKF v0.2 fields and Cursor rule / AGENTS.md conventions only. Never for domain terms, Source IDs, or Granot policy.

## Hard no
- Do not start a maintenance / 12-hour drift loop.
- Do not OKF-ify FINAL SPEC, ODV/ODR, showcase, historical plans.
- Do not write human:verified or status: stable.
- Do not install okf-gem, OpenWiki, or a Ruby stack.
- Do not silently merge code vs ADR vs FINAL SPEC. Record in CONTRADICTIONS.md.
- Do not recreate .cursor/businesslogic/ after A.

## Done this slice when
- The unit's UNITS.md Done-when checks are true on disk
- OPTIMIZATION.md box is checked
- NOW.md names the next unfinished unit and lock is none
- You return the skill brief (sections 1–7)
```
