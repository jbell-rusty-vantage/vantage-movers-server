# Local quality checkpoints

The server has one quality pipeline shared by Cursor and Codex. It uses real local CLI model sessions, not string replacement or a documentation template generator. Model defaults come from the selected CLI; optional overrides live in `.quality.config.json` under `models.codex` and `models.cursor`.

## When it runs

- Start, prompt and tool hooks record activity. They do not launch model reviews on every conversation turn.
- After all observed sessions have stopped, 20 minutes without new activity or file changes starts a checkpoint.
- A session-end event shortens that delay to 60 seconds, provided no other observed session is active.
- `pnpm finish-work --provider codex` or `pnpm finish-work --provider cursor` runs immediately. Run this at a completed feature/task boundary when you want results before leaving.
- `pnpm finish-work --provider codex --no-apply` retains the proposed patch without applying it.

The inactivity timer is a heuristic, not proof that a conversation is finished. An open turn stays active until a stop, interrupt or end event; it is not declared finished just because a long tool call or reasoning step is quiet. If a crash loses those events, use the explicit finish command. A later start/end for that session also restores its observed lifecycle. Hooks cannot guarantee delivery after force-kill or power loss.

The first `pnpm quality:init` captures the current files as the starting baseline. Existing work is not marked reviewed. Later checkpoints compare the complete current file contents against the last successful checkpoint, so they include staged, unstaged, untracked and committed changes since that baseline. Unchanged inputs do not re-run. A failed fingerprint is not retried automatically until files change; the explicit command can retry it.

## What the model does

1. **Review:** a fresh read-only model session examines the accumulated diff, changed file list, related callers/tests and owning documentation. It identifies concrete correctness and design findings.
2. **Fix and clean:** a fresh editing session reads that review, verifies findings, fixes substantiated bugs and performs focused cleanup. Priorities: single responsibility, dependency direction at real side-effect boundaries, and names that communicate behavior, scope and assumptions. Public API/Mongo field names and domain terminology remain stable. Speculative abstractions and unrelated rewrites are excluded.
3. **Documentation:** another editing session reads the final implementation and the cleanup report. It follows `.cursor/agents/docs-keeper.md` and updates the owning Service docs, matching rules, runbooks and catalog. Locked contracts and coordination ledgers are not rewritten. An accurate document produces a reasoned no-change result.
4. **Checks:** typecheck, correctness lint, the offline test suite, and quality-runner regression tests execute outside the model.
5. **Final review:** a fresh read-only session inspects the result, prior reports and actual check outcomes. All checks and the final review must pass before application.

Prompts are versioned in `ops/quality/prompts.mjs`. Reports include the exact input HEAD, input fingerprint and changed paths. The model can explore the snapshot but is instructed not to read secrets, invoke production services, commit/push, deploy or install dependencies. Only `CURSOR_API_KEY` is loaded from the server `.env` when not already exported; the file is never copied or included in prompts.

## Isolation and application

The worker builds a separate Git repository from a file snapshot. Its two internal snapshot commits never change the source repository's HEAD or index. Ignored files, secrets and production `.env` are excluded; local `node_modules` is linked for validation. This is checkout isolation, not a security sandbox for hostile code. Codex uses workspace-write/read-only modes; Cursor uses headless editing/read-only modes.

Review stages are checked for unexpected writes; the docs stage may only change documentation. Edits to hook tooling, CI configuration and dependency manifests are rejected. The worker never stages or commits source changes. If the source HEAD/content changes during a run, or an observed session is active before background application, it keeps the patch and reports `stale` instead of overwriting ongoing work. Validated changes use `git apply --check` followed by `git apply`; manual edits outside observed tools still have a small race window between the final check and application.

Per-worktree state lives under the Git directory's `vantage-quality/`: baseline content blobs, metadata-only activity events, worker/pipeline locks, and `runs/<id>/`. Each run contains model reports/logs, check logs, an isolated workspace and `changes.patch`. Logs can contain source code; treat them like the checkout. They are retained locally for inspection and are not committed.

The worker is a detached Node process with a hidden window on Windows. Subsequent hook events restart it if it exited. A durable baseline and queue metadata survive restart; unfinished runs can be retried. Workers spawned by this pipeline cannot recursively trigger it. Failed jobs remain visible rather than producing an unlimited fix loop.

## Setup and operation

Requirements: Node 24, Git, installed repository dependencies, authenticated `codex`, and Cursor `agent` with a valid API key. On Windows the provider adapter locates the installed Cursor Node launcher; `VANTAGE_CURSOR_BIN` and `VANTAGE_CODEX_BIN` can override executable paths.

```text
pnpm quality:install
pnpm quality:init
pnpm quality:status
pnpm finish-work --provider codex
pnpm finish-work --provider cursor
pnpm quality:pause
pnpm quality:resume
pnpm quality:test
node ops/quality/smoke.mjs codex
node ops/quality/smoke.mjs cursor
```

`quality:install` merges project/user hooks without removing unrelated handlers, backs up changed user settings, asks the local Codex app-server for exact hook hashes, and persists trust only for these Vantage definitions. Re-run it after changing hook definitions or moving the checkout. User-level dispatch also supports a task opened at the parent `vantage` multi-repo folder, while ignoring unrelated repositories. New sessions pick up the configuration; existing clients may need to reload hooks/restart.

`quality:test` is offline and exercises concurrency, deduplication, committed/untracked changes, failed gates and ownership boundaries. `smoke.mjs` is an explicit real-model test with provider usage: it creates an isolated deliberately broken fixture and runs the complete production pipeline. It does not edit application code.

Cursor IDE supports start/end hooks; Cursor Cloud lacks the same IDE lifecycle boundaries, so stop/activity plus inactivity or explicit finish are the useful boundaries there. A cloud VM still needs the chosen CLI and credentials. Codex's normal end event can be delayed until an unopened idle conversation is retired. End hooks only enqueue metadata; no model or test suite runs inside the short end-hook timeout.

## GitHub

On 2026-09-18, native Codex review was enabled for `jbell-rusty-vantage/vantage-movers-server` with **Review all PRs** and **On every push**. Personal defaults and credit overage remain disabled. This is an account-side setting, not configuration provisioned by this checkout.

`.github/workflows/quality.yml` runs typecheck, lint and offline tests independently of Vercel previews, including Cursor branches. The workflow becomes active when this change is pushed. Configure its job as a required check in repository rules before treating it as a merge gate. Native Codex GitHub review is configured separately in Codex's repository review settings; local authentication does not enable remote automatic reviews.

References: [Codex hooks](https://developers.openai.com/codex/hooks), [Cursor hooks](https://cursor.com/docs/hooks), [Cursor headless CLI](https://cursor.com/docs/cli/headless).
