# Team D — scoped Vantage MCP and intelligence agent

## Current assignment after CSI-13 — September 19

Read [SPRINT-PLAN](../SPRINT-PLAN.md). CSI-13 local implementation is complete; the old combined kickoff below is historical scope, not the next session prompt. CSI-18 server can consume CSI-06/13/17 now; CSI-08 is a dependency of its UI, not its server command implementation. Freeze Owner intervention routes/DTOs and deliver immediate corrections, confirmation, original/current rerun and history proof to E. Record server-only completion separately; full CSI-18 requires E browser integration. The default next Owner session is [CSI-07 plus initial CSI-08](../NEXT-SESSION.md).

Own CSI-17/13 and server CSI-18. Work spans `vantage-movers-mcp` and `vantage-main-server`; main server is semantic authority. Read [10](../../10-intelligence-agent-contract.md) in full, [03 §14](../../03-server-pipeline-and-jobs.md), [04 §6](../../04-server-routes.md), and both repos' guidance.

## Deliver

September 19 CSI-13 local implementation (checkpoint 1789795679279-a540097e patch-ready/PASS; inspected coverage fix adopted; 21-test transport/replica proof passes): bounded ToolLoopAgent/Gateway invocation through the delivered MCP surface, existing-stage scheduling/recovery, CSI-06 application and source-grounded current number analysis. See [CSI-13 handoff](../evidence/csi-13/HANDOFF.md) and [checks](../evidence/csi-13/CHECKS.md) for validation and remaining limits. The combined kickoff below does not enlarge CSI-13: item 4's Owner controls remain CSI-18, and no live model quality/deployment is asserted.

CSI-17 implementation is present on both local `sales-intelligence` branches: dedicated twelve-tool MCP surface (including Owner additions), strict captured reads, exact pinned prompt/schema and atomic one-submission intake with a paused application job. [API contract](../evidence/csi-17/API-CONTRACT.md), [handoff](../evidence/csi-17/HANDOFF.md), [checks](../evidence/csi-17/CHECKS.md). CSI-13 model invocation/scheduling/application and CSI-18 corrections remain separate. No live model/provider proof, deployment or send is included. The proof requests below covering model quality/effects belong to those downstream issues, not CSI-17.

1. Run-scoped service credentials enforced by MCP and main-server internal endpoints. Extend MCP with scoped Lead/Booking/call/activity/rep reads, versioned prompt/schema and one submission tool. Do not expose its existing Lead mutation/general Mongo tools to this agent.
2. AI SDK ToolLoopAgent with Gateway provider, bounded tool loop, pinned prompt, exact redacted context snapshots and strict envelope. Verify installed API/model capabilities; no filesystem/Eve runtime and no mandatory exact-locator/entailment gate.
3. Durable run/submission/application protocol: capture evidence and output, idempotent submit, stable cross-run obligations, current-state revalidation, per-effect results, current number analysis and relevant-context refresh. Use C's rules rather than duplicating them in MCP.
4. Original-evidence/current-context reanalysis, confirmation of exact output without reapplication, immediate Owner correction/retraction via C, instruction-specific agreement/disagreement/unknown and immutable history.
5. Budget reservation/reconciliation across agent steps, explicit paused backlog, no duplicate expensive work on retry, meaningful-change fingerprints and coalescing. STT comes from B.

## File ownership

MCP `lib/tools/**`, scoped auth/adapters/prompts/resources and contract tests; main-server `salesIntelligence/analysis/**`, `conversations/extract.ts`, number synthesis, run review orchestration and intelligence internal router. Coordinate shared schemas/config with A, target command writes with C, and display contracts with E. General MCP tools remain available to their intended clients, not this intelligence identity.

## Proof and handoff

Demonstrate a model run gathering context with MCP and submitting a schema-valid envelope. Test forbidden tools/subjects, transcript prompt injection, duplicate/changed submission, stale snapshots, Owner edits during application, later fulfillment/Booking before backfill, bounded-loop exhaustion, source-snapshot provenance and no exact-location gate. Test all effect types and suggestions that never auto-apply. Handoff run/effect/assessment fixtures and failure states to E/F. Actual model quality evaluation is documented; do not reinstate perfect-citation acceptance as a hidden gate.

## Kickoff prompt

> Implement the Vantage MCP intelligence agent and submission/application protocol in 10. Use Vercel AI SDK with scoped remote MCP reads and a single submit tool. Keep permitted effects automatic while enforcing C's Owner/chronology/identity rules on the server. Preserve every run's evidence and model disagreement. Build original/current reanalysis and immediate correction. Do not introduce filesystem agents, general mutation tools, autonomous messages or exact-citation gates. Deliver integration evidence to E/F.

## September 17 codebase alignment

[Audit and required adaptations](../../11-codebase-alignment-audit.md) are part of this delivery contract. Complete the rows assigned to this team and provide integration evidence; current runtime helpers do not already satisfy the revised contracts. [Design intake](../../07-claude-design-brief.md) governs the received design export; see the September 19 sprint revision for adoption and contract reconciliation.
