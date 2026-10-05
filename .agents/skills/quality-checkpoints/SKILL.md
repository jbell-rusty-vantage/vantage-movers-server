---
name: quality-checkpoints
description: Set up, operate and maintain automatic turn-end quality checkpoints for Claude Code, Cursor and Codex in any git repository. After each agent turn, a git-gated model triage decides whether to run a clean-code pass, a documentation pass, both or neither; it runs them in an isolated checkout, checks the result and auto-applies it to the working tree. Use when the user asks to add quality hooks / clean-code or docs automation / "review after every session" to a codebase, to opt a new repository in, to tune or debug the checkpoints, to update models, or to uninstall.
---

# Quality checkpoints

A local, tool-agnostic quality loop. When a coding session (Claude Code, Cursor or Codex) finishes a turn:

1. **Hook.** A user-level hook records the session as idle and starts a background worker. The hook makes no git or model call and returns in milliseconds.
2. **Gate 0 (no model).**
   - After a quiet window, the worker snapshots the working tree as a git tree, using a temporary index; the user's index and HEAD are never touched.
   - It diffs that tree against the repository's *reviewed point*.
   - **Skipped:** noise, whitespace-only and docs-only changes.
   - **Trivial (< 15 lines across ≤ 2 files, with no added or deleted source file):** skipped, but the edits accumulate until they cross the threshold.
3. **Triage.**
   - One read-only model call receives a brief: git status, commits, per-file line counts, the diff, and the documents that mention changed paths.
   - It returns `{clean_code.run, docs.run, focus files, concerns}`.
   - The model belongs to the tool in use: Claude → Sonnet, Cursor → Grok, Codex → its configured model.
4. **Actions.**
   - A clean-code stage, then a docs stage, each a fresh model session in an LF-normalized checkout outside the repository.
   - Protected paths and documentation ownership are enforced mechanically.
   - Configured checks (typecheck, lint on edited files, related tests) must be **no worse than the input**.
5. **Auto-apply.**
   - `git apply` runs when every touched file still has its triaged content and no session for the repository is busy. Nothing is staged or committed.
   - Otherwise the run is `stale-pending` and is retried at the next idle point for up to 2 h, or kept as a patch.
   - The reviewed point moves past the applied edits, so the worker never re-reviews its own work. A failure is reported once and never retried on the same input.
6. **Notice.** The next session in that repository gets a one-line notice ("Quality worker … applied edits to …"), delivered through SessionStart/UserPromptSubmit `additionalContext`.

The tool is in `tool/` (Node ≥ 22, no dependencies, Windows/macOS/Linux). Design notes and the evidence behind each decision are in [`references/architecture.md`](references/architecture.md). Operating problems are covered in [`references/troubleshooting.md`](references/troubleshooting.md).

---

## Setup in a new codebase

Do these in order. Ask the user only about real choices (which tools they use, models, what is protected). Everything else has defaults.

### 1. Prerequisites (check, don't assume)

```bash
node --version          # >= 22 (tested on 24)
git --version
claude --version        # Claude Code: logged in (subscription); never pass ANTHROPIC_API_KEY to children
```

- **Cursor CLI:**
  - Windows: `%LOCALAPPDATA%\cursor-agent\versions\<ver>\` (spawned as `node.exe index.js`). Elsewhere: `agent`.
  - Needs `CURSOR_API_KEY`, either exported or in a file listed in `secretsEnvFiles`.
  - List the models with `agent models`. Slugs carry an effort suffix, for example `grok-4.7-medium`; there is no bare `grok-4.7`.
- **Codex:**
  - Windows desktop app: `%LOCALAPPDATA%\OpenAI\Codex\bin\<hash>\codex.exe` (not on PATH). Elsewhere: `codex`.
  - Must be logged in.
- **Overrides:** `AGENT_QUALITY_CLAUDE_BIN`, `AGENT_QUALITY_CURSOR_BIN` and `AGENT_QUALITY_CODEX_BIN` replace discovery.

Only the tools the user actually uses need to work. A provider that is never used is never called.

### 2. Choose where the tool runs from

- **From this skill (default).** Nothing is added to the repository except `.quality.config.json`. Install with `node <skill>/tool/cli.mjs install`.
- **Vendored into the repository** (the team shares and reviews it):
  1. Copy `tool/` to e.g. `ops/quality/` and commit it.
  2. Add scripts:

     ```json
     "quality:install": "node ops/quality/cli.mjs install",
     "quality:uninstall": "node ops/quality/cli.mjs uninstall",
     "quality:status": "node ops/quality/cli.mjs status",
     "quality:prune": "node ops/quality/cli.mjs prune",
     "quality:apply": "node ops/quality/cli.mjs apply",
     "quality:test": "node --test ops/quality/quality.test.mjs",
     "finish-work": "node ops/quality/cli.mjs run"
     ```

   `ops/quality/**` is already protected from edits.

**One install is active per machine.** `~/.agent-quality/config.json` records one `toolDir`, and every opted-in repository on the machine uses it. The last `install` wins, so keep vendored copies in sync with this skill (see Maintenance).

### 3. Opt the repository in: `.quality.config.json`

Start from a template in `templates/`: `node-typescript.json`, `python.json` or `minimal.json`. Then adjust:

- **`checks`:** real commands for the repository. Each check is `{ name, command, files: none|edited|related-tests, extensions?, parser?: tsc|eslint|node-test|lines }`.
  - `command[0] === "node"` means the current Node binary.
  - On Windows, non-`.exe` tools need `["cmd", "/c", "pnpm", …]`.
  - A check whose Node script is missing is skipped. Verify each command runs from the repository root.
- **`docsOwnership`:** the only paths the docs stage may edit.
- **`protectedGlobs`:** add locked specifications, contracts, ledgers, generated packets, migrations, and anything else no model may touch. This list *adds to* the defaults (CI, hooks, manifests, lockfiles, `.env*`); it cannot remove them.
- **`docsContract`:** the repository's documentation rules file (a docs-keeper agent, CONTRIBUTING section, etc.). Without it, `tool/docs-contract.md` is used.
- **`glossary`:** the repository's terminology file, if one exists.
- **`instructions`:** what stages read first. Usually `AGENTS.md`/`CLAUDE.md` plus `.quality/docs-contract.md`.
- **`childEnv`:** environment that makes checks safe offline, e.g. `{"TEST_MODE": "true"}`.
- **`models`:** per tool and role (`triage`, `edit`).
- **`mode`:** start with `"dry-run"` when the user wants to watch decisions before allowing edits. Use `"act"` for auto-apply.

Every key and its default is in `tool/config.mjs` (`DEFAULTS`).

### 4. Install

```bash
node <tool>/cli.mjs install --repo <path-to-repo>      # add more --repo flags for more repositories
```

This does five things:

1. Writes `~/.agent-quality/{hook.mjs,config.json}`.
2. Merges hooks into `~/.claude/settings.json`, `~/.cursor/hooks.json` and `~/.codex/hooks.json`. Each changed file gets a `*.vantage-backup-<ms>` copy, and unrelated hooks are kept.
3. Trusts the Codex hooks by hash.
4. Removes project-level registrations of older versions.
5. Sets each repository's reviewed point to its current tree. Existing uncommitted work is the baseline and is not reviewed.

**Session reloads:**
- Claude Code reloads settings in running sessions.
- Restart Codex and Cursor sessions, or reload the Cursor window.

**Repository discovery:** opted-in sibling folders of the given repositories are registered too, which suits multi-repo workspace folders. Sessions opened at a parent folder count for every opted-in repository under it.

### 5. Verify

```bash
node --test <tool>/quality.test.mjs                        # offline, ~30 s, no model calls
node <tool>/cli.mjs status                                 # worker, sessions, last decisions, latest run
node <tool>/cli.mjs run --repo <repo> --dry-run            # one triage now (needs a change since the baseline)
node <tool>/smoke.mjs claude --modules <dir with typescript+tsx>   # optional: real-model end-to-end on a throwaway repo
```

**Live check:**
1. In a real session, change at least 15 lines of source and let the turn end.
2. Within about 2–3 min, `status` shows the session, and `.git/agent-quality/triage.jsonl` gains a line.
3. `latest.md` shows the run.

**Headless sessions:** `claude -p` and `codex exec` fire hooks. The Cursor CLI in `-p` mode does not, so check Cursor in the IDE.

### 6. Tell the repository's agents

Add to `AGENTS.md` (or `CLAUDE.md` / a Cursor rule):

```markdown
## Quality checkpoints
After a turn ends, a background checkpoint may auto-apply clean-code and documentation edits (never staged or committed).
If a prompt carries a "Quality worker … applied edits" notice, re-read those files before editing them.
If `AGENT_QUALITY_CHILD=1`, you are inside the checkpoint: follow the stage prompt and never start another worker.
```

---

## Maintenance

### Routine

- **`cli.mjs status`** shows whether the worker is running, sessions by state, each repository's last 10 decisions, the latest run and storage.
- **`.git/agent-quality/triage.jsonl`** holds every decision.
  - Many `trivial` results mean the threshold fits; `act` on tiny changes means raise `gate.minChangedLines`.
  - `docs-only` skips are expected.
- **`.git/agent-quality/runs/<id>/`** holds:
  - `triage-brief.md`: what the model saw;
  - `triage.out*`;
  - `clean.md` and `docs.md`;
  - `checks/*.log` (`*.input.log` is the baseline re-run);
  - `changes.patch`;
  - `report.json`.
- **Commands:**
  - `cli.mjs apply <id>` applies a kept `stale` patch.
  - `cli.mjs pause` / `resume` act per repository.
  - `cli.mjs run [--provider p] [--actions clean,docs]` forces a checkpoint.

### Tuning

| Symptom | Change |
| --- | --- |
| Too many runs on small edits | Raise `gate.minChangedLines` / `maxTrivialFiles`; add to `gate.noiseGlobs` |
| Real work skipped as docs-only | `gate.triageDocsOnly: true` |
| Checks too slow | Narrow `checks` (e.g. drop the whole-project typecheck, keep lint on edited files and related tests) |
| A file got edited that must not be | Add it to `protectedGlobs`; it is enforced for every stage |
| Docs edits in the wrong place | Narrow `docsOwnership`; point `docsContract` at the repository's rules |
| Applies keep going `stale` | Raise `quietSeconds.idle`, or accept a manual `apply` |

### Updating models

- **Cursor:** `agent models` lists the slugs.
- **Claude:** IDs such as `claude-sonnet-5-5`.
- **Codex:** the model names the account offers.

Edit `models` in each `.quality.config.json`; no reinstall is needed. Confirm with `smoke.mjs <provider>` or one `run --dry-run`.

### After changing the tool, moving it, or upgrading a tool CLI

- **Re-run `install`.** This rewrites the shim target and **re-trusts Codex hooks**; Codex silently skips changed hook definitions until they are trusted.
- **Keep copies identical.** The skill's `tool/` and any vendored copy must match:

  ```bash
  node <skill>/scripts/sync-tool.mjs <source-dir> <target-dir>
  ```

  Run the test suite in the target afterwards.
- **Codex desktop updates** change the binary's hash folder. Discovery picks the newest by date, so nothing needs doing unless `AGENT_QUALITY_CODEX_BIN` pins an old path.

### Storage and retention (automatic)

The worker purges in 30-second slices every 10 minutes:

| What | Rule |
| --- | --- |
| Session files | 24 h of silence (`busy` older than 6 h counts as a crash) |
| Notices | 24 h |
| Logs | Rotated at 5 MB |
| Runs | 14 days or more than 50 |
| Checkouts | Deleted after apply; failed or stale ones kept 3 days |
| Reviewed refs | Deleted when their branch or worktree is gone |

`cli.mjs prune [--dry-run]` runs the same on demand. All limits are in `retention`.

### Uninstall

```bash
node <tool>/cli.mjs uninstall
```

This removes our hooks from all three tools and the Codex trust block, with backups, stops the worker and deletes `~/.agent-quality`. Repositories keep `.quality.config.json`; delete it to opt out. To remove the state, delete `.git/agent-quality/` and `git for-each-ref refs/agent-quality | xargs -n1 git update-ref -d`.

---

## Rules for the agent operating this skill

- **Never run destructive steps without showing what they touch.** That covers editing user-level settings, uninstalling, and pruning (`prune --dry-run` first).
- **Auto-apply changes the user's working tree.** When enabling `mode: "act"` in a repository with uncommitted work, tell the user the install baseline protects existing work.
- **Do not weaken protections to make a run pass:** `protectedGlobs`, docs ownership, the "no worse than input" rule. Fix the configuration or report.
- **When debugging, read the run's files before re-running models:** `report.json`, `triage-brief.md`, `*.stderr.log`. Model runs cost time.
- **Inside a checkpoint (`AGENT_QUALITY_CHILD=1`), never install, run or start the tool.**
