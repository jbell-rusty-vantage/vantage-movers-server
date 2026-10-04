# Sales Outreach Desk agent entry point

Start here from either vantage-main-server or vantage-admin. This is a self-contained cloud preparation packet for the focused deterministic sales outreach desk.

1. Read repository AGENTS.md and this packet's [working rules](workspace/AGENTS.md).
2. Read the [original Owner request and screenshots](OWNER-REQUEST.md), then [specification](SPECIFICATION.md), [contracts](CONTRACTS.md), [decisions](DECISIONS.md) and [code map](CODE-MAP.md).
3. Read [sprint](SPRINT.md) and your workspace/teams assignment; claim files in [ledger](workspace/LEDGER.md) before changing implementation.
4. Run `node docs/sales-outreach-desk/validate.mjs` from the repository root. It validates packet links, hashes and synthetic contract examples without dependencies or database access.
5. Use [validation](VALIDATION.md) and [data readiness](DATA-READINESS.md). Record [evidence](workspace/evidence/README.md) and use the [handoff](workspace/HANDOFF-TEMPLATE.md).

Implementation has not started. Model/schema additions, provider capture and DTOs named here are target contracts. Code paths labelled existing in CODE-MAP.md were inspected. Safe synthetic examples explicitly carry incomplete/unapproved policy and cannot activate enforcement.

Server owns shared documents and contracts. Both repositories receive identical packet releases, verified by PACKET-MANIFEST.json. Local task claims, handoffs and evidence are separate per checkout and excluded from shared-file equality. Send shared changes to Team A; do not edit an admin mirror independently. The server's local packet contains the same imported admin references needed for API integration.

No sibling directory is required for this packet's validation, fixtures, contracts, screenshots or source glossary. An integrated browser run needs both services available in an approved isolated environment; an admin agent can begin with the local mock DTOs while server endpoints are implemented.

The existing implementation branch convention is sales-intelligence in both repositories. Inspect branch/dirty state first. This documentation preparation does not switch branches. Use separate clones for concurrent agents needing independent checkouts and coordinate integration without reset/clean/force-push.

Before launching feature agents, use the [pre-implementation readiness assessment](READINESS-PREPARATION.md) for prioritized inspections, bounded proofs, Owner decisions, parallel work and protected late-sprint gates. This follow-up is an assessment; proposed executable proofs have not run.

The capped 15-question continuation has approved Questions 1–14. Read [final policy review](FINAL-POLICY-REVIEW.md) for the consolidated business outcome; Question 15 ratification is pending. P01, P02a–P02i, P03, P04a–P04d, P05a–P05h, P06a–P06f, P07a–P07g, P08a, P09a–P09c and P10a; D01 deterministic-only scope and V01/V02 visual requirements. Earlier checkpoint scope flags retain historical provenance only. Runtime/provider/auth/configuration/migration/production proofs remain gated; no runtime activation or live work is authorized.
