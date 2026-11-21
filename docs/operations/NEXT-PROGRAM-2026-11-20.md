# Next program: round out the upgrade (Owner directive, November 20)

The Owner set this program on November 20, at the end of the service-optimization and MongoDB storage session. It was always part of the upgrade. It starts after the open items in the [current handoff](NEXT-SESSION.md) close.

> "We are going to need a google cloud storage service after this. We are going to need further reviews after this. We are going to need a clean code clean up and claude code hooks that run after major commits so they aren't tethered to claude code lifecycle hooks but to the git history of the codebase and we are going to need precise 'agent profiles set ups / cli runners for the major tech stacks and services in our code' … For example if an agent needs to go into the google sheets and the sheet sync service it should be completely clear how to test, how to interact etc. … We have done considerable work on service optimizations and mongo storage and I want this all rounded out completely."

The program has five workstreams. Run them in the order below. Each one ends with a verifiable deliverable, not a summary.

## State at hand-off

The current state and the carry-overs to close first are in [NEXT-SESSION "Start here"](NEXT-SESSION.md#start-here--next-session-owner-november-20). At close on November 20, `main` `9c0cc421` serves production with PRs #243–#248 and #250–#252.

## What November 20 adds to each workstream

1. **GCS.**
   - The retention fast path still scans in most batches. Measure whether a GCS-backed closed-run index removes that need.
   - The Granot receipt retention backlog in the handoff remains the first storage candidate.
2. **Reviews.**
   - The #252 shadow would-reject review and the enforce decision.
   - Cross-path job matching: `P 5556759` against `P5556759` outside Pool.
   - The 40 job groups whose Record Links name more than one Lead.
   - The open Owner decisions in NEXT-SESSION carry-over 5.
   - An audit of every `*.replica.test.ts` and replica runner for a loopback assertion. The August 19–20 fixtures reached production without one.
3. **Clean code.**
   - `legacyBookingJobFilter` is already gone (#252).
   - Promote or delete the November 20 operator scripts: bad-Form cleanup, the two-way Sheet placement check, the orphan-row check and the fixture purge. They are untracked in the main checkout's `.tmp/bad-form-cleanup-2026-11-20/`.
   - Remove the `ops`, `ops2`, `ops3`, `tracka`, `booking-jobno` and `lifecycle` worktrees once their work is merged. They have real installs, so nothing needs unlinking.
4. **Git-triggered quality checks.** The November 20 CRLF and worktree collisions show the trigger must run per commit SHA, in its own worktree, never on a shared checkout.
5. **Profiles and CLI runners.**
   - The first Sheet Sync runner command to build is `pnpm vantage -- sheet-sync reconcile`: a two-way placement check that every Lead is on exactly its expected tab and every tab row resolves to a Lead. The prototype is `missing-rows.ts` in the evidence folder above.
   - The "Working rules learned on November 20" in NEXT-SESSION become part of every profile.

## 1. Google Cloud Storage service

**Goal.** One deep module owns every Google Cloud Storage interaction: authentication, write, verified read-back (generation plus SHA-256), conditional delete, lifecycle and retention, and locator holds. Each service then calls one contract instead of carrying its own client code. MongoDB keeps only what a live reader, recovery path or reporting contract needs. Verified history moves to GCS by the measured rules from the storage sessions.

**Current state.** Each GCS caller is built independently:
- Granot history archive: `src/services/granotHistory/archiveObjects.ts`, `archiveReads.ts`, `monthArchive.ts`, `publishArchiveChunk.ts`, `scheduledRunArchive.ts`.
- Sales Intelligence packs: `src/services/salesIntelligence/jobs.ts`.
- Shared Google service-account auth: `src/services/googleAuth/serviceAccount.ts`.
- MongoDB backup job: `ops/cloud/mongodb-backup/`.

Proven rules already in production:
- Delete only after a read-back of the stored generation and SHA-256.
- Reference holds.
- Conditional expiry that refuses while any locator points at the object.
- Original-ID lookups fall back to the archive.

These rules are documented in [Granot automation apply](../knowledge/granot-lifecycle/automation-apply.md), [capture](../knowledge/granot-lifecycle/capture.md) and the [hot-storage study](GRANOT-HOT-STORAGE-2026-11-18.md).

**Deliverables.**
1. **Contract.** A provider-neutral interface: `put` returns generation and hash, `readVerified`, `deleteIfGeneration`, `hold`/`release`, `list`, and lifecycle policy. Bucket, prefix and retention come from runtime configuration in Mongo, not environment variables. Credentials stay in env. See the Owner rule in [runtime configuration](../knowledge/environment.md).
2. **Migration.** Move each existing caller onto the module, one service per PR, with byte-identical objects and unchanged locators. Callers: Granot history, Sales Intelligence packs, Granot receipt retirement, and the backup job if it fits.
3. **Next storage candidates.** Take them from the measured backlog in the [handoff](NEXT-SESSION.md#granot-receipt-retention): Granot receipt retention, then any collection whose cold history has a verified-replay reader. Each needs measured bytes, daily arrivals and removals, the readers that still need the body, and a rollback.
4. **Tests.** Unit tests against a fake bucket. One integration proof against a disposable test bucket covers write, read-back, hold, conditional delete and generation mismatch.
5. **Docs.** A Service doc `docs/knowledge/services/cloud-storage.md` with the contract, holds, retention, cost, env names, and an operator runbook in `docs/operations/`.

**Acceptance.**
- Every GCS call in `src/` goes through the module.
- Existing archive replay and original-ID reads still pass.
- No object is deleted without a verified generation.
- Capacity numbers are reported per the Owner's November 17 directive: measurement window, units, assumptions and the business behavior preserved.

## 2. Further reviews

**Goal.** An independent review of every service that changed in November, against its Owner directives, the [Lead lifecycle pack](../knowledge/lead-lifecycle/README.md) and capacity. This follows the model of the [November 20 review](SERVICE-REVIEW-2026-11-20.md).

**Scope, in order.**
1. **Granot scheduled runs after #243.** Follow-up counters, post-commit outcomes, Record Link backlog drain (310 jobless-linked Calls), Decision volume per day.
2. **Sheet Sync after #245.** Identity-check failures by code, retries, quota, and Forms/Duplicate Forms exclusivity on live flips.
3. **Owner-directive conflicts in the pack's [COVERAGE](../knowledge/lead-lifecycle/COVERAGE.md):**
   - `POST /booked-leads/from-source` still accepts the retired Best Relocation sheet source.
   - `confirmGranotBooking` does not prefer the Form Lead.
   - The Desk, the Daily Operations rebuild and legacy Analytics do not check Call admission.
   - Legacy Analytics sums the stamped CPL.
   - Some Forms lack an ingestion origin.
4. **How replica-test fixtures reached production on August 19–20.** The sources are `releaseOwnerCommands.replica.test.ts` (U27) and `discrepancies.replica.test.ts` (REEVALUATE). Prove that every replica runner refuses a non-loopback target, and add the guard where it is missing.
5. **Capacity watch.** The open clocks in the [handoff](NEXT-SESSION.md), the seven-day index series, and Atlas disk and oplog.

**Method.** One reviewer per service, given code rather than conclusions. Every finding is verified against code and read-only production before it is reported. Fixes ship as bounded PRs with their own review.

## 3. Clean-code cleanup

**Goal.** Reduce code that no longer serves a live contract, without changing behavior.

**Targets, measured first.**
- **Retired paths:** Best Relocation external ingestion (`ops/best-relocation-retirement/`), retired Granot Call creation, and pre-queued Sheet Sync direct writers (`upsertRow`, `deleteSheetRowsByNumbers`; legacy and disabled modes, inactive in production).
- **Duplicate helpers:** the per-service GCS clients (workstream 1), exact-link finders and Sheet target builders.
- **Dead flags:** runtime configuration keys with no reader, and environment names the [inventory](../knowledge/environment.md) marks obsolete.
- **Untracked operator scripts** that became permanent tools. Promote them under `ops/` with tests, or delete them.

**Rules.**
- Each removal cites a measured zero-reader proof: `git grep`, plus a production read where a stored record could still need it.
- One concern per PR. Tests and typecheck stay green.
- Service docs are updated in the same PR.
- Never remove a reader of historical evidence that a locked Owner rule preserves, such as saved RingCentral qualification or Best Relocation history.

## 4. Git-triggered quality checkpoints

**Goal.** Quality passes (documentation upkeep and clean-code review) run after major commits and merges in the repository's git history. They no longer depend on Claude Code, Cursor or Codex lifecycle hooks, so they run the same way whoever or whatever made the commit.

**Current state.**
- The tooling is in `ops/quality/` (`cli.mjs`, `gate.mjs`, `git-snapshot.mjs`, `triage.mjs`, `worker.mjs`, `pipeline.mjs`), configured by `.quality.config.json`.
- It is installed as agent lifecycle hooks: `Stop`, `SessionEnd`, `UserPromptSubmit`.
- The v2 plan in the workspace's `internal/quality-hooks/PLAN-V2.md` (accepted October 6, not started) keeps those triggers. Claude hooks were removed on October 6, and both repositories are paused in `.quality.config.json`.

**Deliverables.**
1. **Triggers from git, not agents.** Possible triggers: a versioned `post-merge` and `post-commit` hook installed by `pnpm quality:install` with `core.hooksPath`, and a CI job on pushes to `main`. The gate decides "major": a diff-size or path threshold, release merges and Service-doc-relevant paths. Minor commits only record evidence.
2. **Same gate, new trigger.** Reuse `gate.mjs`, `git-snapshot.mjs` and the docs contract. The worker runs detached with its budget caps (PLAN-V2 D4). Each run must be idempotent per commit SHA, so a rebase or replay never runs twice.
3. **Safety.**
   - Never block the commit.
   - Never push, and never commit on `main`. Output is a branch plus a PR, or a local staged patch, per the Owner's choice.
   - Respect `protectedGlobs`.
   - Run with `TEST_MODE=true` and `SHEET_SYNC_MODE=disabled` (`childEnv`).
4. **Retire the agent-lifecycle registration** once the git trigger is proven. Update `docs/quality-checkpoints.md` and the `quality-checkpoints` skill, and amend PLAN-V2.

**Acceptance.**
- A dry-run week of commits from Claude Code, Cursor, Codex and plain `git`, with one evidence record per qualifying SHA and no duplicate runs.
- Budget respected.
- Zero writes outside the allowed outputs.

## 5. Agent profiles and CLI runners per stack and service

**Goal.** An agent entering any major service knows, without discovery, how to set it up, test it, run it locally, read production safely, and what it must never do. The Owner's example is Google Sheets and Sheet Sync.

**Current state to build on.**
- **`pnpm vantage` CLI** (`ops/vantage/`): `help`, `doctor`, `services`, `test sheet-sync --suite fast`, `sheet-replica`, `granot-trace`, `granot-rehearsal`, `granot-runbook`.
- **Setup and runbooks:** [CLOUD_AGENTS.md](../../CLOUD_AGENTS.md) for local setup and replicas, the [operator task guide](README.md), and the [Sheet Sync](sheet-sync.md) and [Granot](granot.md) runbooks.
- **One agent profile:** the workspace's `.codex/agents/storage_capacity_analyst.toml`.
- **Skills:** the MongoDB skills in the workspace's `.agents/skills/`.
- **Gaps:** no Claude Code agent profiles (`.claude/agents/`) exist in either the workspace or the server. Most services have no CLI runner.

This session also lost time to several traps:
- Replica suites need per-suite databases or ports (`TEST_MONGO_DATABASE_NAME` suffixes, the `poolcollector` database, `capacityp1`, ports 27129 and 27961).
- The main checkout gets shared between agents, so each agent should take its own worktree with a real `pnpm install`.
- Git Bash's `TZ=America/New_York` returns UTC on this machine; use PowerShell `ConvertTimeBySystemTimeZoneId`.
- Every push to `main` deploys production, with no path filter.

**Deliverables.**
1. **One profile per service and stack.** Ship each as a Claude Code agent (`.claude/agents/<name>.md`) and a Codex agent (`.codex/agents/<name>.toml`) with identical content. Each profile states:
   - scope and owning Service docs;
   - locked Owner rules;
   - local setup and fixtures;
   - the exact offline and replica test commands, with their database and port;
   - read-only production access (which credentials, which collections, which Sheets API calls are allowed);
   - canonical repair commands, and when they are allowed;
   - forbidden actions.

   Start with these services:
   - Google Sheets and Sheet Sync
   - Granot lifecycle and scheduled runs
   - RingCentral capture and Call qualification
   - Form and Call Leads (lifecycle pack)
   - Bookings and Cancellations
   - Sales Outreach and the Desk
   - Daily Operations
   - MongoDB capacity (extend `storage_capacity_analyst`)
   - GCS (workstream 1)
   - Vercel deploys and the release path
   - the Admin dashboard (`vantage-admin`)
   - the Granot extension
2. **CLI runners.** Extend `pnpm vantage` so each service has `doctor`, `test --suite fast|replica` and `inspect`. Runners take their own fixture database and port, strip inherited credentials, and refuse non-loopback targets for anything that writes. Read-only production reads use one audited helper. The ad-hoc `prodread` and Sheets scripts written this session are the template: find, aggregate, `values.get` and `spreadsheets.get` only.
3. **Sheet Sync first,** as the Owner's example. Cover:
   - workbook and tab identities;
   - the managed versus operator columns;
   - how to trace one Lead from Mongo to its row (`sheet_sync[]`, jobs, tombstones);
   - how to queue an ordinary re-delivery (`enqueueSheetSyncJob`, `createdBy: "script"`), and when that is allowed;
   - how to verify placement in both directions;
   - the identity-check failure codes from #245;
   - the Owner's Calls-tab rule.
4. **Verification.** For each profile, a fresh agent with only that profile completes a scripted task (for example "trace Lead X to its Sheet row and explain any difference") without asking for setup help. Record the result.

## Constraints for the whole program

- Locked Owner rules stay locked:
  - RingCentral-only Call minting and qualification.
  - Preserved historical qualification and the Best Relocation final reconciliation.
  - The Form/Call sibling rules.
  - Official Bookings and Cancellations stay reportable.
  - No Calls-tab backfill or major change: the Owner handles that tab manually.
- Every push to `main` deploys production. Any merge, index, TTL, deletion, data write or deploy action needs explicit Owner approval for its scope.
- Runtime flags and configuration live in Mongo configuration, not environment variables. Env holds only secrets and wiring.
- Use the glossary in the workspace `CONTEXT.md`. Report against the Owner's nearest goal. Distinguish implemented, tested, integrated (merged or deployed) and qualified (observed in production).
