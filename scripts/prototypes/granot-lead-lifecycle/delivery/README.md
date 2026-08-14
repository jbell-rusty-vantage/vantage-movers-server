# Granot Lead Lifecycle delivery pack

This directory converts the approved final specification and 34-unit delivery map into contracts that can be handed to one primary implementation-agent session at a time.

## Main goal

Build a production-safe Granot Lead Lifecycle that accepts Granot evidence from authenticated webhooks, approved browser-extension applies, and approved HTTP-automation actions; resolves source policy and Lead identity consistently; applies only authorized Lead creation or enrichment; and feeds repeatable `Booked` and `Release` observations into precise, explicit owner workflows for Booking Reconciliation and Release Reconciliation.

Those owner workflows are the canonical replacement for what older drafts called Booking Intake and Cancellation Intake. Granot evidence never by itself creates or updates a Booking and never cancels or un-cancels one. Official Booking and Cancellation facts change only through explicit, idempotent canonical domain commands with revision, causal, transaction, and outbox proof.

## How to use this pack

1. Start with [`AGENT-EXECUTION-RUNBOOK.md`](AGENT-EXECUTION-RUNBOOK.md).
2. Select only a `ready` unit whose prerequisites are verified in [`UNIT-STATUS.md`](UNIT-STATUS.md).
3. Give one primary implementation session the matching file under [`issues/`](issues/).
4. The agent reads the cited final-spec sections, applicable S-slice, AC rows, repository guidance, and predecessor handoffs before editing.
5. The agent leaves the required completion report. The next session verifies the repository and tests rather than trusting that report by itself.
6. Refine the next three to five scaffolded contracts against the repository state that actually landed. Do not reinterpret locked specification decisions.

## Authorities

- [`../specs/FINAL-SPECIFICATION-GRANOT-LEAD-LIFECYCLE.md`](../specs/FINAL-SPECIFICATION-GRANOT-LEAD-LIFECYCLE.md) — implementation contract; wins on conflict.
- [`../specs/lead_lifecycle_issue_breakdown_reccomendation.md`](../specs/lead_lifecycle_issue_breakdown_reccomendation.md) — approved unit spine, dependencies, and handoff rules.
- [`../../../../../CONTEXT.md`](../../../../../CONTEXT.md) — canonical domain language.
- [`../../../../.cursor/rules/lead-lifecycle-delivery.mdc`](../../../../.cursor/rules/lead-lifecycle-delivery.mdc) — repository and branch contract.
- [`../../../../AGENTS.md`](../../../../AGENTS.md) and [`../../../../CLOUD_AGENTS.md`](../../../../CLOUD_AGENTS.md) — server-agent and runtime guidance.
- [`../../../../.cursor/agents/lead-lifecycle-spec-extractor.md`](../../../../.cursor/agents/lead-lifecycle-spec-extractor.md) — optional bounded contract-extraction protocol.

## Contents

- `AGENT-EXECUTION-RUNBOOK.md` — rules inherited by all unit sessions.
- `UNIT-STATUS.md` — dependency-aware delivery ledger.
- `issues/UNIT-01.md` through `issues/UNIT-34.md` — one contract per primary implementation session.

Unit 32 is optional and requires separate Owner acceptance. Unit 34 is mandatory, remains final, and certifies completed behavior with current Granot webhook payload shapes under the isolation and privacy rules in the approved handoff.
