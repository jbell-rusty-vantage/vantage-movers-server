# Troubleshooting

Start every investigation with `node <tool>/cli.mjs status`. Then read `~/.agent-quality/hook-errors.log`, `~/.agent-quality/worker.log`, `.git/agent-quality/triage.jsonl`, and the latest `runs/<id>/report.json`.

| Symptom | Likely cause | Fix |
| --- | --- | --- |
| No session file appears after a turn | Hooks not registered or not reloaded | Check that the tool's settings file contains `.agent-quality/hook.mjs`. Restart the Codex or Cursor session, or reload the Cursor window. Run `install` again. |
| Codex never fires the hook | Hook definition changed but is not trusted, or `config.toml` does not parse | Run `install` again (it re-trusts). Check `~/.codex/config.toml` has exactly one `# BEGIN AGENT QUALITY HOOK TRUST` block. In Codex, `/hooks` shows the trust state. |
| Cursor IDE turns are not seen | The IDE hook payload differs, or hooks are disabled | Check `hook-errors.log`. The headless `agent -p` never fires hooks, so test in the IDE. |
| Session file exists, nothing runs | A session for that repository is still `busy`, the quiet window has not passed, or the repository is not opted in or is paused | `status` shows the busy session. A crashed session counts as busy for at most 6 h. Run `resume` to clear a pause. |
| Always `trivial` | Changes below `gate.minChangedLines` | They accumulate. Lower the threshold if needed. |
| `triage-failed` | Auth, model slug or timeout | Read `runs/<id>/triage.out.stderr.log`. Common causes: Cursor `CURSOR_API_KEY` missing, an unknown slug (`agent models`), Claude not logged in, the Codex model unavailable. |
| `failed` at `clean` with "protected paths" | The model tried to edit protected files | Working as intended. If the path should be editable, it must not match `protectedGlobs` (the defaults cannot be removed). |
| `failed` at `docs` with "outside documentation ownership" | The docs stage edited code | Working as intended. Widen `docsOwnership` only for genuine doc paths. |
| `failed` at `checks` | New failures introduced | `checks/<name>.log` versus `<name>.input.log`; the report lists `introduced`. The patch is kept. |
| A check is skipped | The command's Node script is not installed in the repository | Install dependencies, or fix the `command` path. |
| `stale` | A touched file changed during the run | `apply <id>` once you have looked at the patch, or let the next turn re-trigger. |
| `stale-pending` for a long time | A session stays busy (long agent turn) | It applies at the next idle point, for up to `pendingApplyHours`. |
| Patch does not apply on Windows | Line-ending mismatch | Checkouts are LF-normalized. Make sure the tool version includes `core.autocrlf=false` in `checkoutTree`. |
| `EPERM` deleting a workspace | A lingering CLI process holds the folder | Harmless. Cleanup is best-effort and retention removes it later. |
| The first checkpoint is slow | Retention is purging a large backlog | It works in 30 s slices; `prune` speeds it up. |

## Never delete a checkout that contains a `node_modules` junction with a recursive tool

The pipeline links the repository's `node_modules` into its throwaway checkouts. Node's `fs.rmSync` (which the tool uses) unlinks junctions safely.

**`git worktree remove --force`, some `rm -rf` builds and some temp cleaners follow the junction and delete the real `node_modules`.** This happened once during development; the fix was a fresh `pnpm install` with the damaged folder moved aside.

When cleaning by hand, unlink the junction first:
- PowerShell: `(Get-Item <path>\node_modules).Delete()`.
- POSIX: `unlink <path>/node_modules`.

## Reset a repository's history

1. `node <tool>/cli.mjs pause --repo <repo>`
2. Delete `.git/agent-quality/` and `refs/agent-quality/*` (`git for-each-ref --format='%(refname)' refs/agent-quality | xargs -n1 git update-ref -d`).
3. Run `install --repo <repo>`. It sets a fresh baseline.
4. Run `resume --repo <repo>`.
