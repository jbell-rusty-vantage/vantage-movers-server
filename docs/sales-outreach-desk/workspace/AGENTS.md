# Agent team operating rules

Read local repository AGENTS.md, ../README.md, ../SPECIFICATION.md, ../CONTRACTS.md and ../SPRINT.md before work. Team task cards own files; shared interfaces require Team A handoff. Implementation uses the existing sales-intelligence branch convention; inspect branch and working tree first, preserve concurrent/local work and do not switch another agent's checkout. Use separate clones where necessary. No reset/clean/force push, production writes/migrations/backfills, deployments, customer sends, credential changes or provisioning without separately established authorization.

Claim exact local files/ticket IDs in LEDGER.md. Cross-repo shared changes go through A; never independently edit admin mirror contracts. Maintain source/config/schema version references in each handoff. Each independent cloud checkout keeps its own ledger/evidence; coordinator reconciles them using explicit task IDs rather than overwriting concurrent ledgers. Accepted means actual integrated evidence, not a screenshot or mocked pass. No agent can invent Owner policy approval. Never use environment variables for new rollout, policy or migration controls.

Do not start legacy media/AI backfills to finish cadence work. Use only approved isolated replica synthetic fixtures for apply/recovery tests. Keep credentials and real customer content out of logs/evidence. Finish with exact commands/results, changed contracts, limitations and next owner. Read local framework docs before code. Full acceptance matrix and production proof gates remain mandatory even if your slice passes.


## Current policy authority — 14-question checkpoint

P01, P02a–P02i, P03, P04a–P04d, P05a–P05h, P06a–P06f, P07a–P07g, P08a, P09a–P09c and P10a; D01 deterministic-only scope and V01/V02 visual requirements. Consume FINAL-POLICY-REVIEW.md and operative specification/contracts; all earlier open-choice notes above retain historical scope only. P06f completes substantive policy. No AI functionality in outreach; MCP separate. Final ratification is Question 15. Provider/runtime/production proofs remain unverified, controls false, migration paused.
