# Architecture and design decisions

## Modules (`tool/`)

| File | Responsibility |
| --- | --- |
| `hook.mjs`, `hook-core.mjs` | Hook entry for all three tools. It detects the provider and the host, applies guards, overwrites one session file, starts the worker, and prints the notice. It makes no git call and no model call. |
| `worker.mjs` | One per machine (lock in `~/.agent-quality/worker.lock`). It resolves which repositories a session touches, debounces (quiet window plus 20 s of tree stability), waits while any session is busy, retries pending applies, runs time-boxed retention, and exits after 10 idle minutes. |
| `git-snapshot.mjs` | Takes a snapshot tree via a temporary index (a copy of the real index, so the stat cache is reused), keeps reviewed-point refs, parses diffs (`-w` line counts), and greps for document hints. |
| `gate.mjs` | Gate 0. Pure functions. |
| `triage.mjs`, `prompts.mjs` | Brief builder, the triage schema, fenced-JSON extraction (Cursor), validation that fails closed, and the stage prompts. |
| `providers.mjs` | `claude`, `cursor` and `codex` adapters, binary discovery, the allowlisted child environment, and `runProcess` with tree-kill on timeout. |
| `pipeline.mjs` | Workspace preparation, stages, ownership and protection, checks, auto-apply, stale-pending retry, notices, reports. |
| `checks.mjs` | Configured checks, related-test discovery, failure signatures, and the "no worse than input" comparison (stash and re-run). |
| `retention.mjs` | Purge rules, including migration from the first installation's names. |
| `install.mjs` | User-level hook merge for the three tools, the shim, Codex trust blocks, repository discovery, baselines, uninstall. |
| `cli.mjs` | `status`, `run`, `apply`, `pause`/`resume`, `prune`, `install`, `uninstall`, `worker`. |
| `quality.test.mjs`, `smoke.mjs` | Offline suite (CRLF fixtures, fake models); real-model end-to-end test. |

## Provider invocations

| Role | Claude Code | Cursor | Codex |
| --- | --- | --- | --- |
| Triage (read-only) | `claude -p --model M --output-format json --json-schema S --permission-mode dontAsk --allowedTools Read,Grep,Glob --strict-mcp-config --settings {"disableAllHooks":true} --setting-sources project --no-session-persistence --effort medium --add-dir <run>` (prompt on stdin; result in `structured_output`) | `agent -p --trust --output-format json --workspace <repo> --model M --mode ask --add-dir <run> "<prompt pointing at the brief file>"`. `ask` mode rejects shell commands, so the brief carries the diff. | `codex exec --ephemeral --disable hooks -c approval_policy="never" -s read-only -C <repo> -m M --output-schema S.json -o out.json -` |
| Edit | Same, with Edit/Write/limited Bash allowed and `--effort high`; cwd = the isolated checkout | `--force` instead of `--mode ask` | `-s workspace-write` |

## Decisions and why

- **Trigger on turn end, not session end.**
  - Sessions stay open for hours, and Claude's `SessionEnd` fires only on exit or `/clear`. The deterministic gate makes the extra firings free.
  - Session end only shortens the wait.
- **Git is the evidence; the session file is liveness.**
  - The first version logged every tool call (16k files) and used an inactivity timer.
  - The current design stores one overwritten file per session plus a git tree comparison.
- **The reviewed point is a ref to a commit wrapping a tree.**
  - The ref keeps the tree from being garbage-collected and supports one key per worktree and branch.
  - It advances after every triage decision, including failures. The first version advanced only on success and re-reviewed a growing diff, failing five 30-minute runs in a row.
  - Trivial changes do not advance it, so they accumulate.
- **The user's existing work is the baseline at install.** First sighting of a later branch uses HEAD, so uncommitted work on that branch is reviewed.
- **Checkouts live outside the repository** (`%LOCALAPPDATA%`/tmp). Children then inherit no parent `AGENTS.md`/`CLAUDE.md`/settings (for example a parent `bypassPermissions` default).
  - Hook, MCP and Claude configs are removed from the copy.
  - `node_modules` is linked as a junction or symlink.
- **Checkouts use LF-normalized content** (`checkout-index -c core.autocrlf=false`, then `core.autocrlf=input`). With `core.autocrlf=true`, `git apply` compares against normalized content, so CRLF checkouts produced patches that would not apply.
- **Stale detection is per file.**
  - Before applying, each touched file's working blob (after clean filters) must equal its triaged blob.
  - The user editing *other* files does not block the apply.
- **"No worse than input" instead of "all green".** Pre-existing failures would otherwise block forever; a full test suite that times out is replaced by related tests.
- **Two stages behind one triage, with permissions enforced mechanically.** Clean-code may not touch protected paths. Docs may touch only `docsOwnership`, and may not add broken relative links.
- **No final model review by default.** The deterministic gates replace it; `verify: true` re-enables it.
- **Recursion guards.**
  - Claude children: `disableAllHooks`.
  - Codex children: `--disable hooks`.
  - The headless Cursor CLI fires no hooks (verified).
  - Every child gets `AGENT_QUALITY_CHILD=1`, which the hook honours.
  - Cursor also runs `~/.claude/settings.json` hooks (third-party configs), so the Claude registration is a no-op when the payload or environment shows Cursor.
- **Children never get `ANTHROPIC_API_KEY`;** it would override the Claude subscription login. `--bare` is not used for the same reason.
- **Codex trust.** Hooks are skipped until their exact definition is trusted by hash. The installer asks `codex app-server` → `hooks/list` for hashes and writes one `# BEGIN AGENT QUALITY HOOK TRUST` block. Two blocks would declare duplicate TOML tables and make the config unparseable, so every earlier block is removed first.
- **Retention is time-boxed** (30 s slices every 10 min). A large backlog would otherwise delay the first checkpoint.

## Measured on Windows 11 (2026-10-04)

| Measurement | Result |
| --- | --- |
| Hook body | 3–5 ms (plus Node startup) |
| Claude end-to-end on a fixture | about 50–70 s |
| Codex end-to-end | about 4 min |
| Cursor end-to-end | about 10 min, mostly CLI startup |
| Cursor CLI startup before the model call | 60–130 s (not caused by MCP config) |
