# Agent-team working instructions

Read the repository guidance and [workspace README](README.md). The work is the September 17 Call & Sales Intelligence contract, not the superseded September 14 extraction design.

- Read your team assignment before editing. Claim exact issues/files in [LEDGER.md](LEDGER.md); do not claim other teams' implementation is complete without evidence.
- Keep business invariants in `vantage-main-server`. MCP wraps scoped endpoints; Admin consumes server DTOs. Do not create competing definitions of deadlines, ownership, or AI effects.
- Freeze [CONTRACTS.md](CONTRACTS.md) interfaces before parallel implementation. A owns shared model/index/config and router-registration edits; submit requested changes through a handoff rather than overwriting concurrent work.
- Owner-required branch: agents must perform all Call & Sales Intelligence implementation work on `sales-intelligence` in both `vantage-main-server` (server) and `vantage-admin` (dashboard). Inspect the current branch and working tree before edits; use the existing branch or create that exact branch if absent, preserving uncommitted work. Do not implement on the default branch or substitute a differently named team branch. Record repository, branch and owned files in the workspace ledger and handoff. Coordinate agents sharing a checkout; Git cannot check out the same branch in multiple worktrees of one repository, so use separate clones when independent checkouts are necessary, and coordinate integration to avoid divergent pushes. This documentation update does not itself create or switch branches.
- Preserve uncommitted changes. Do not reset, clean, force-push, change another team's branch, or overwrite another team's files. Coordinate shared checkout access and file ownership.
- Maintain the accepted boundaries: no qualification changes, no official-record writes by AI, no automatic rep/customer messages, Owner corrections immediate, multiple/undated actions valid, exact citation verification deferred, $80 budget default.
- Use the durable job/lease/application protocol, not in-memory events as truth. Include duplicate delivery, stale evidence and concurrent Owner edits in meaningful tests.
- Fixtures may use synthetic data; credentials/provider bodies/raw transcript data do not belong in artifacts or logs. Do not run production migrations/backfills or live sends merely to complete a test.
- Record actual commands and results, not generic “tests passed.” Follow each affected repo's available scripts. Distinguish blocked capability proof from failed implementation tests.
- A team handoff must include changed contracts, artifacts, checks, limitations and the exact next dependency. Use [HANDOFF-TEMPLATE.md](HANDOFF-TEMPLATE.md).
- Escalate real unresolved product contradictions with a concrete example. Do not reopen accepted interview decisions just because historical files disagree.
