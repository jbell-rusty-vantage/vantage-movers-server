# Team A — contracts and foundation

Own CSI-01 and G1. Read [01](../../01-specification.md), [02](../../02-domain-models.md), [04](../../04-server-routes.md), [10](../../10-intelligence-agent-contract.md), then [CONTRACTS](../CONTRACTS.md).

## Deliver

1. Inspect existing models, domainCommands and durableWork before introducing new infrastructure. Implement strict envelope/action/DTO schemas and closed enums with versioned contracts.
2. Implement revised models/index definitions, migration report/apply/verify, multiple nullable-due follow-ups, immutable runs/evidence/effects/instructions/reviews, full audit and job records. Unique commitments and submissions fence retries.
3. Define intelligence command actor/idempotency handling without widening official Lead command origins. Define lease epochs, durable enqueue and transaction boundaries for consuming teams.
4. Implement versioned settings and budget storage defaults: $80, staffed schedule, 30/15-minute clocks and two sales days. C owns clock evaluation; D owns provider-cost integration.
5. Publish TypeScript types and synthetic request/response fixtures for B–E; record actual module paths/version in CONTRACTS. Coordinate shared router/config/migration integration.

## File ownership

Main-server `src/models/*` for new/revised intelligence models, domain config/enums, shared validation/DTO definitions, migration script and shared durable-job/audit primitives. Other teams own feature service implementations. No Admin/MCP business-rule copies.

## Proof and handoff

Test unique subject/commitment/submission fences, null due dates, multiple open actions, revision conflicts, expired-lease rejection, scope/actor validation and test DB routing. Produce fixtures for unknown/closed/ambiguous cases, not just happy path. Handoff types plus migration report to B–E. Runtime behavior is not complete merely because schemas compile.

## Kickoff prompt

> Implement CSI-01 from this workspace. Read repository instructions and the revised specification/agent contract. Inspect existing infrastructure, claim your owned files in the ledger, implement the shared schema/model/policy/job foundation, and freeze tested interfaces for Teams B–E. Preserve unrelated work. Do not enable production or implement other teams' services. Record checks and a concrete handoff.

## September 17 codebase alignment

[Audit and required adaptations](../../11-codebase-alignment-audit.md) are part of this delivery contract. Complete the rows assigned to this team and provide integration evidence; current runtime helpers do not already satisfy the revised contracts. [Design intake](../../07-claude-design-brief.md) governs the forthcoming Claude artifact; its arrival is not assumed.
