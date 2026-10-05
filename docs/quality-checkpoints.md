# Local quality checkpoints

One quality pipeline serves **Claude Code, Cursor and Codex** on this machine. When a coding session finishes a turn, a background worker uses git to see what changed since the last reviewed point. A deterministic gate skips insignificant changes. Otherwise one read-only model call (triage) decides whether a **clean-code** pass, a **documentation** pass, both or neither should run. The chosen passes run in an isolated checkout and are checked. The result is applied to the working tree automatically, with no approval step.

The model comes from the tool you were using. Defaults live in `.quality.config.json` → `models`:

| Tool | Triage model | Editing model | Runner |
| --- | --- | --- | --- |
| Claude Code | `claude-sonnet-5-5` | `claude-sonnet-5-5` | `claude -p` (subscription login) |
| Cursor | `grok-4.7-medium` | `grok-4.7-high` | Cursor `agent -p` (`CURSOR_API_KEY`) |
| Codex | `gpt-5.6-terra` | `gpt-5.6-terra` | `codex exec` (ChatGPT login) |

There are no cost limits. Timeouts exist only to stop hung processes: triage 10 min, each stage 45 min, each check 15 min.

The design and its evidence are in the workspace-root plan `quality-hooks/PLAN.md`.

## When it runs

| Hook (per tool) | Effect |
| --- | --- |
| Prompt submitted (`UserPromptSubmit` / `beforeSubmitPrompt`) | The session is marked **busy**. Nothing runs while any session touching the repository is busy. |
| Turn ended (`Stop` / `stop`) | The session is marked idle. A check runs after **120 s** of quiet. |
| Session ended (`SessionEnd` / `sessionEnd`) | A check runs after **20 s**. |
| Session start / prompt submit | Prints a one-line notice of results the session has not seen. (Cursor IDE: only if it honours `additional_context`.) |

Hooks are registered at user level (`~/.claude/settings.json`, `~/.cursor/hooks.json`, `~/.codex/hooks.json`). They call the stable shim `~/.agent-quality/hook.mjs`, which loads `hook.mjs` from the tool folder (`toolDir`) recorded in `~/.agent-quality/config.json`. Installing from this checkout makes that folder `vantage-main-server/ops/quality/`. The same code is packaged as the `quality-checkpoints` agent skill for other codebases. Whichever install ran last serves every opted-in repository on the machine. The hook does no git work, calls no model and returns in milliseconds; it only writes one per-session state file and starts the detached worker.

Sessions opened at the `vantage/` workspace root count for every opted-in repository under it. A repository opts in by containing `.quality.config.json`.

## The gates

1. **Gate 0 (no model).**
   - The worker snapshots the working tree as a git tree object, built with a temporary index; your index and HEAD are never touched.
   - It diffs that tree against the **reviewed point**, the ref `refs/agent-quality/reviewed/<worktree>/<branch>`.
   - **Skipped and the point advances:**
     - nothing changed;
     - only noise changed: lockfiles, logs, `evidence/`, `.codex/`;
     - only whitespace changed;
     - only documentation changed (the author was already writing docs).
   - **Skipped and the point does not advance** (the edits accumulate until they cross the threshold):
     - fewer than 15 changed lines across at most 2 files, with no added or deleted source file.
   - **Oversized:** more than 80 files or 4,000 lines. Triage still runs, but receives only the diffstat and must pick at most 15 focus files.
2. **Triage (one read-only model call).**
   - **Input:** a brief (`runs/<id>/triage-brief.md`) with:
     - branch, upstream and `git status`;
     - commits since the reviewed point;
     - per-file line counts and categories;
     - the diff, source files first;
     - documents that mention the changed paths;
     - the last three decisions.
   - **Output:** `{significance, clean_code: {run, focus_files, concerns}, docs: {run, focus_docs, reason}, reason}`.
     - Claude uses `--json-schema`.
     - Codex uses `--output-schema`.
     - Cursor's reply is parsed and validated.
   - An invalid or missing decision is a skip (fail closed).
3. **Actions**, in an isolated checkout under `%LOCALAPPDATA%\agent-quality\runs\<repo>\<id>\workspace`:
   - **Where:** outside the vantage tree, so no parent `AGENTS.md` or `.claude/settings.json` applies. Hook, MCP and Claude config files are removed from the copy. Files are in git's normalized LF form.
   - **Clean-code stage:** fixes substantiated bugs, does focused SRP and naming cleanup, and adds regression tests. It may not edit protected paths: hooks, quality tooling, CI, `package.json`, lockfiles, TS/ESLint config and `.env*`.
   - **Docs stage:** follows the documentation contract (`docsContract` → copied to `.quality/docs-contract.md`; here `.cursor/agents/docs-keeper.md`, which Admin shares). It may edit only `docsOwnership` paths, and may not introduce new broken relative links.
4. **Checks**, outside the model, from the `checks` list in `.quality.config.json`:
   - `tsc --noEmit`
   - ESLint on the edited files
   - the tests related to the edited files: sibling `*.test.ts` and test files that import an edited module (server tests load `ops/test-setup.ts`)
   - **No worse than input:** a failing check is re-run on the unedited input. It passes when it introduced no new failure, so pre-existing failures never block.
5. **Auto-apply.**
   - If every file the patch touches still has its triaged content and no session is busy, the worker runs `git apply --check` and then `git apply`. That changes the working tree only: nothing is staged or committed.
   - The reviewed point then moves past the applied edits, so the worker never re-reviews its own work.
   - If a session is busy, the status is `stale-pending` and the apply is retried at idle points for up to 2 hours.
   - If one of the touched files changed meanwhile, the status is `stale` and the patch is kept for `pnpm quality:apply <id>`.

**The reviewed point advances after every triage decision,** including failures. A failed run is reported and never retried automatically on the same input. This keeps a failure from turning into a loop over an ever-growing diff.

**Model sessions never recurse.**
- Claude children run with `--settings {"disableAllHooks":true}`, `--strict-mcp-config` and `--permission-mode dontAsk` with a tool allowlist.
- Codex children run with `--disable hooks`.
- The headless Cursor CLI does not fire hooks (verified 2026-10-04).
- Every child also has `AGENT_QUALITY_CHILD=1`, which makes the hook a no-op.

**What children receive:** an allowlisted environment plus the repository's `childEnv`. Here that is `TEST_MODE=true` and `SHEET_SYNC_MODE=disabled`. Children get no server secrets, and no `ANTHROPIC_API_KEY`, which would override the Claude subscription. `CURSOR_API_KEY` goes to Cursor alone; when it is not exported, it is read from the first `secretsEnvFiles` entry that has it (server `.env`; Admin falls back to the server's).

Cursor also runs Claude Code hooks from `~/.claude/settings.json`. Inside Cursor, the Claude registration recognizes the Cursor payload and does nothing.

## State and retention

| Store | Lifecycle |
| --- | --- |
| `~/.agent-quality/sessions/<tool>-<id>.json` | One file per session, overwritten on each event. Deleted after 24 h of silence. A `busy` marker older than 6 h is treated as a crashed session. |
| `~/.agent-quality/notices/` | One per finished run. Shown once per session, deleted after 24 h. |
| `~/.agent-quality/worker.log`, `hook-errors.log` | Rotated at 5 MB. |
| `.git/agent-quality/triage.jsonl` | One line per gate or triage decision. Rotated at 5 MB. |
| `.git/agent-quality/runs/<id>/` | Report, brief, stage reports, check logs and `changes.patch`. Kept 14 days, at most 50 runs. Pending applies are never purged. |
| `%LOCALAPPDATA%\agent-quality\runs\…\workspace` | Deleted once a run is applied or skipped. Failed or stale runs keep theirs for 3 days. |
| `refs/agent-quality/reviewed/*` | Deleted when the branch or worktree is gone. |

The worker purges these at start and then hourly; `pnpm quality:prune [--dry-run]` purges on demand. It also removes the retired pipeline's `events/`, `blobs/` and `baseline.json`. Logs and patches contain source code, so treat them like the checkout.

## Commands

Run these from `vantage-main-server`. Commands that act on one repository take `--repo <path>`; the default is the current checkout.

```text
pnpm quality:install                 # (re)install user hooks for all three tools, trust Codex hooks, register opted-in repos
pnpm quality:status                  # worker, sessions, last triage decisions, latest run, storage
pnpm finish-work [--provider claude|cursor|codex] [--actions clean,docs] [--dry-run]
pnpm quality:apply <run-id>          # apply a kept (stale) patch
pnpm quality:pause | quality:resume  # per repository
pnpm quality:prune [--dry-run]
pnpm quality:test                    # offline suite; never calls a model
pnpm quality:smoke claude|cursor|codex   # real-model end-to-end run on a throwaway repository
```

- **`finish-work`** runs immediately. It skips Gate 0, and with `--actions` it also skips triage. The provider is detected from the environment when `--provider` is omitted.
- **`quality:install`** needs re-running after moving the checkout or changing hook definitions. It backs up each changed settings file as `*.vantage-backup-<ms>`, keeps unrelated hooks, and removes the retired project-level `.cursor/hooks.json` and `.codex/hooks.json`. It registers every opted-in repository it can find: previously configured ones, `--repo` arguments, the current one, and opted-in siblings. It also sets each repository's reviewed point to its current tree, and migrates the first installation's `~/.vantage-quality` and `refs/vantage-quality`.

## Configuration reference (`.quality.config.json`)

Unset keys take the defaults in `ops/quality/config.mjs`; objects merge one level deep.

| Key | Meaning |
| --- | --- |
| `enabled`, `mode` (`act` / `dry-run`), `autoApply`, `verify` | Switches. `dry-run` records triage only. `verify` adds a final read-only model review. |
| `models.<tool>.triage` / `.edit` | Model per tool and role |
| `quietSeconds.idle` / `.end` | Debounce after a turn end or session end |
| `gate` | `minChangedLines`, `maxTrivialFiles`, `maxFiles`, `maxLines`, `triageDocsOnly`, `noiseGlobs`, `testGlobs`, `sourceGlobs` |
| `docsOwnership` | The only paths the docs stage may edit |
| `protectedGlobs` | Paths no stage may edit. Adds to the defaults; cannot remove them. |
| `instructions` | Files the stages read first (`.quality/docs-contract.md` is the copied contract) |
| `docsContract`, `glossary` | Repository-relative files copied into the checkout. Paths may point outside the repository. |
| `childEnv`, `secretsEnvFiles` | Extra child environment; files from which only `CURSOR_API_KEY` is read |
| `checks[]` | `{ name, command, files: none \| edited \| related-tests, extensions?, parser?: tsc \| eslint \| node-test \| lines }`. `command[0] = "node"` uses this Node binary. A check whose Node script is missing is skipped. |
| `relatedTests` | Sibling `patterns` (`{dir}`, `{name}`, `{ext}`), `importSearch` (JS/TS importers), `maxFiles` |
| `timeouts`, `pendingApplyHours`, `retention` | Hang protection, the stale-pending window, purge rules |

## Requirements and known behaviour

- **Requirements:**
  - Node 24, Git and installed dependencies.
  - `claude` logged in with a subscription.
  - The Codex desktop app or CLI logged in. The binary is found under `%LOCALAPPDATA%\OpenAI\Codex\bin\<hash>\codex.exe`; it is not on PATH.
  - The Cursor `agent` CLI with `CURSOR_API_KEY`.
  - `AGENT_QUALITY_CLAUDE_BIN`, `AGENT_QUALITY_CURSOR_BIN` and `AGENT_QUALITY_CODEX_BIN` override the executables.
- **The Cursor CLI** takes 60–130 s to start a headless session on this machine, before the model is called. Cursor checkpoints are slower for that reason.
- **Read-only Cursor (`--mode ask`)** rejects shell commands, so the triage brief carries the diff.
- **Cursor IDE hook payloads** are handled defensively: `cursor_version`, `workspace_roots` and `conversation_id`. Confirm the notice injection in the IDE with `pnpm quality:status`.
- **Codex `SessionEnd`** has a 1 s default timeout (3 s maximum). The hook only writes a file and spawns the worker. Codex skips changed hook definitions until they are trusted again; `quality:install` does that through `codex app-server`.
- **What hooks cannot guarantee:** delivery after a force-kill or power loss. If no turn-end event arrives, run `finish-work`.

## GitHub

On 2026-09-18, native Codex review was enabled for `jbell-rusty-vantage/vantage-movers-server` with **Review all PRs** and **On every push**. This is an account-side setting, not configuration in this checkout.

`.github/workflows/quality.yml` runs typecheck, lint, the offline tests and `pnpm quality:test`.

References: [Claude Code hooks](https://code.claude.com/docs/en/hooks), [Claude Code headless](https://code.claude.com/docs/en/headless), [Cursor hooks](https://cursor.com/docs/hooks), [Cursor headless CLI](https://cursor.com/docs/cli/headless), [Codex hooks](https://developers.openai.com/codex/hooks).
