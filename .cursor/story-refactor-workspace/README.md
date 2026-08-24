# Story-refactor workspace

Agent coordination only. **Not** knowledge. **Not** an implementation queue until a human says so.

Cloud runs **traverse** `vantage-main-server` **service by service**. Each run **takes stock**, then writes **one pass** (one recommendation, or a thin-folder skip). They do not reorganize `src/`.

Skill: `.cursor/skills/operational-story/SKILL.md`  
Board: [TRAVERSAL.md](TRAVERSAL.md)  
Quality bar: [recommendations/form-lead.md](recommendations/form-lead.md)

## Authority

| Question | Source |
| --- | --- |
| What is done / left? | **Stock** block in `TRAVERSAL.md`, then `recommendations/` on disk |
| What should this run do? | Current `in-progress` service’s next unchecked module, else the next `unvisited` service |
| Is a pass done? | Recommendation file exists with every heading in the skill’s `RECOMMENDATION.md`, or the module/folder is `skipped` on the checklist |
| What did a past run say? | `sessions/` (append-only) |
| Ideas that are not work yet | `IDEAS.md` |
| Questions / blockers | `MESSAGES.md` |
| Code vs glossary vs ADR fights | `CONTRADICTIONS.md` |

**Disk wins.** If `NOW.md` says `call-lead` but that file already exists, mark the checklist and take the next unchecked module. Rewrite Stock.

Do not put `type:` YAML on any file here. Do not copy Service invariants here.

## Resume (every Cloud run)

```
- [ ] 1. Read NOW.md
- [ ] 2. Read open MESSAGES.md
- [ ] 3. Take stock: TRAVERSAL.md (Stock + current service) + recommendations/ + latest session
- [ ] 4. Fix Stock / NOW if they disagree with disk
- [ ] 5. Take or steal the lock
- [ ] 6. Stay on the in-progress service, or open the next unvisited service (enumerate first)
- [ ] 7. Write one pass
- [ ] 8. Update the service checklist + rewrite Stock
- [ ] 9. Write sessions/<session-id>.md from TEMPLATE.md
- [ ] 10. Rewrite NOW.md last (release lock)
```

Do not open Wave B until every Wave A service is `visited`. Do not jump services while the current checklist has unchecked production modules.

## Lock

Runs can overlap. `NOW.md` holds the lock.

- `lock: none` → take it (`held`, session id, UTC timestamp).
- `lock: held` and younger than 90 minutes → post `kind: skipped`, do **not** edit recommendation files, do **not** open a second PR.
- `lock: held` and older than 90 minutes → steal it, note `kind: lock-stolen` in MESSAGES.

Release the lock in `NOW.md` before you stop. Never leave a half-written recommendation or a half-enumerated service.

## What you may write

| File | Edit? |
| --- | --- |
| `NOW.md` | Yes. Current pointer only. One screen. |
| `TRAVERSAL.md` | Yes. Stock block + the current service checklist. Do not reorder Wave A. |
| `MESSAGES.md` | Yes. Newest open item on top. |
| `IDEAS.md` | Yes. Park only. |
| `CONTRADICTIONS.md` | Yes. Do not silently merge sources. |
| `recommendations/<service>-<module>.md` | Create one per pass. Never rewrite `form-lead.md`. |
| `sessions/*.md` | Create one per run. Never edit an older session. |
| `src/**` | **No.** |

`BACKLOG.md` is retired. `TRAVERSAL.md` is the board.

## Message shape

```markdown
## <utc> | to: next-run | from: <session-id> | kind: next|blocker|question|skipped|lock-stolen
<body>
```

## Session id

`story-<service>-<module>-<utc>` e.g. `story-leads-call-lead-2026-08-24T2117Z`.

## Branch / PR

- Branch: `docs/story-refactor`
- One PR. Update it on later runs. Do not auto-merge. Do not push `main`.
- Repo on GitHub Cloud is the standalone `vantage-movers-server` checkout of this tree.
- `CONTEXT.md` / `docs/adr/` may be absent. Do not invent copies.
