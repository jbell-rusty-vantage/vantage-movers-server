# OKF workspace

Agent coordination only. **Not** an OKF bundle. **Not** knowledge.

`docs/index.md` is the concept catalog. This folder is the **session board**: what the last run finished, what the next run must do, open messages, parked ideas, and standing contradictions.

Do not put `type:` YAML on any file here. Do not copy Service invariants here.

## Phase

**Optimization** is live. Conversion is Done and frozen.

| Phase | Skill | Disk checklist |
| --- | --- | --- |
| Conversion (frozen) | `.cursor/skills/okf-docs-conversion/` | `PROGRESS.md` via `pnpm okf:progress` — do **not** rerun `--write` |
| **Optimization (current)** | `.cursor/skills/okf-docs-optimization/` | `OPTIMIZATION.md` (hand-checked) + `UNITS.md` in the skill |
| Maintenance (later) | docs-keeper + a later skill | Do not start |

## Authority

| Question | Source |
| --- | --- |
| What should the next run do? | `NOW.md`, then the first unchecked box in `OPTIMIZATION.md` if they disagree |
| Is a unit actually done? | Skill `UNITS.md` **Done when** checks on disk |
| What did a past run say? | `sessions/` (append-only) |
| Ideas that are not work yet | `IDEAS.md` |
| Questions / blockers | `MESSAGES.md` |
| Code vs doc vs glossary vs spec fights | `CONTRADICTIONS.md` |
| Conversion inventory (historical) | `units.json` + conversion `INVENTORY.md` |

**Disk wins.** If `NOW.md` says `opt-d` but `.cursor/businesslogic/` still exists, the next unit is `opt-a`. Rewrite `NOW.md`. Do not invent progress.

`pnpm okf:progress` will keep saying conversion `done`. Ignore it for scheduling. Use `pnpm okf:query` to count Services.

Cursor Memories, if enabled, may store only: current unit id, open PR URL. They must not replace this folder.

## Resume (every Cloud run)

```
- [ ] 1. Read NOW.md
- [ ] 2. Read open section of MESSAGES.md
- [ ] 3. Read OPTIMIZATION.md and the skill UNITS.md
- [ ] 4. If OPTIMIZATION unchecked ≠ NOW.next, believe disk and fix NOW
- [ ] 5. Take or steal the lock (see below)
- [ ] 6. Do the next unfinished atomic unit (skill)
- [ ] 7. Write sessions/<utc>.md from TEMPLATE.md
- [ ] 8. Resolve or add messages; park ideas; update contradictions
- [ ] 9. Check off finished units in OPTIMIZATION.md
- [ ] 10. Rewrite NOW.md last (release lock)
```

Do **not** run `pnpm okf:progress --write`.

## Lock

Two-hour runs can overlap. `NOW.md` holds the lock.

- `lock: none` → take it (`held`, session id, UTC timestamp).
- `lock: held` and younger than 90 minutes → post a message `kind: skipped`, do **not** edit knowledge files, do **not** open a second PR.
- `lock: held` and older than 90 minutes → steal it, note `kind: lock-stolen` in MESSAGES.

Release the lock in `NOW.md` before you stop. Never leave a half-delete, half-thin, or half-written Service.

## What you may write

| File | Edit? |
| --- | --- |
| `NOW.md` | Yes. Current pointer only. One screen. |
| `MESSAGES.md` | Yes. Open + resolved. Newest open item on top. |
| `IDEAS.md` | Yes. Park only. Never execute an idea mid-unit unless `NOW.md` says to. |
| `CONTRADICTIONS.md` | Yes. Standing list. Do not silently merge sources. |
| `OPTIMIZATION.md` | Yes. Check boxes only when Done-when is true. |
| `sessions/*.md` | Create one per run. Never edit an older session. |
| `PROGRESS.md` | **No.** Conversion artifact. |
| `units.json` | **No.** Conversion inventory. Frozen. |

## Message shape

```markdown
## <utc> | to: next-run | from: <session-id> | kind: next|blocker|question|idea-ref|skipped|lock-stolen
<body>
```

`to:` is `next-run` or `human`. Move resolved items under `## Resolved` (keep for one week, then delete).

## Session id

`opt-<unit>-<utc>` e.g. `opt-a-2026-08-21T2147Z`. Use it in the lock, the session filename, and messages.
