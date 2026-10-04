# Sales Outreach Desk agent entry point

Start here from either vantage-main-server or vantage-admin. Business policy is finalized (October 3, 2026). The build plan was re-based on the slimmed code on **October 4, 2026**.

## Build it (cloud or local agent teams)

**Run the sprint end to end with [SPRINT-RUNBOOK.md](SPRINT-RUNBOOK.md)** (phases P1 build → P2 integrate → P3 verify → P4 PRs → P5 user-run release and pilot; local and cloud instructions).

1. Read repository AGENTS.md and this packet's [working rules](workspace/AGENTS.md).
2. Read the **[post-slimming implementation plan](IMPLEMENTATION-PLAN.md)**. It covers what changed, settled decisions IMPL-01…07, data model, API, engine, work packages and release path.
3. Read your team brief: **[SERVER-TEAM.md](workspace/SERVER-TEAM.md)** (vantage-main-server) or **[ADMIN-TEAM.md](workspace/ADMIN-TEAM.md)** (vantage-admin). Each contains a copy-paste cloud session prompt.
4. Read the business rules: [specification](SPECIFICATION.md) §§2–14 and [final policy review](FINAL-POLICY-REVIEW.md). Read the [original Owner request and screenshots](OWNER-REQUEST.md).
5. Read the details: [contracts](CONTRACTS.md) (as amended by the plan), [RingCentral capture](RINGCENTRAL-CAPTURE.md), [code map](CODE-MAP.md) and the [fixtures](contracts/README.md), which are the evaluator test vectors.
6. Run `node docs/sales-outreach-desk/validate.mjs` from the repository root. Claim work in the [ledger](workspace/LEDGER.md). Record [evidence](workspace/evidence/README.md) and use the [handoff](workspace/HANDOFF-TEMPLATE.md).

## Precedence

- **Business rules:** SPECIFICATION and FINAL-POLICY-REVIEW. They are unchanged.
- **How and where to build:** IMPLEMENTATION-PLAN and CODE-MAP. They win over older packet text about reusing `outreach_records`, "Outreach ID", legacy producer fencing, `/sales-intelligence?view=…` routes, `repScope` and the Sales Intelligence live stream. The slimming removed or changed all of those.
- **RingCentral:** RINGCENTRAL-CAPTURE wins over SPECIFICATION §15.
- [DECISIONS](DECISIONS.md), [READINESS-PREPARATION](READINESS-PREPARATION.md), [SPRINT](SPRINT.md), [DATA-READINESS](DATA-READINESS.md), [MANUAL-START](MANUAL-START.md) and [END-TO-END-RUN](END-TO-END-RUN.md) remain the policy provenance and launch runbooks. Their S5–S7 migration machinery now applies to bulk expansion cohorts, because there is no legacy history left to migrate. See plan §8.

## Packet mechanics

The server copy is canonical. The admin copy is a byte-identical mirror verified by PACKET-MANIFEST.json. Change shared files in the server copy, regenerate the manifest, then copy the packet to admin. Local ledger claims and evidence are per checkout.

No sibling directory is needed for validation, fixtures, contracts, screenshots or the glossary. An integrated browser run needs both services. Admin can start on local mock DTOs.

Branches: `feat/outreach-desk` in both repositories, with lane branches merged into it. Use no reset, clean or force-push. No production writes, deploys, provider subscriptions or customer sends happen without the user's explicit go.

History: [final handback](FINAL-HANDBACK.md) (October 3 policy finalization) and [validation report](VALIDATION-REPORT.md).
