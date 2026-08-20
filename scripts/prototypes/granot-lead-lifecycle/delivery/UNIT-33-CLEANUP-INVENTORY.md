# Unit 33 cleanup inventory

Date: 2026-08-19  
Scope: `scripts/prototypes/granot-lead-lifecycle/`  
Data policy: path/classification evidence only; no payload or contact data.

| Classification | Items | Disposition |
| --- | --- | --- |
| `remove` | `cli.ts`, `domain.ts`, `fixtures.ts`, `scenarios.ts` | Disposable executable prototype replaced by production-interface AC tests. |
| `remove` | `dry-runs/**` | Prototype planner/read/seed commands replaced by guarded `scripts/migrations/granot-lifecycle-*` report/apply/verify commands and the Unit 33 replica regression. |
| `remove` | `seed-unit23-preview-fixtures.ts` | One-unit preview fixture writer; Unit 23 completion evidence is retained, but the superseded writer is not operational. |
| `remove` | `Cancellation-flow-handoff.md`, `GRANOT-BOOKING-INTAKE-PROTOTYPE.md`, `GRANOT-CANCELLATION-INTAKE-PROTOTYPE.md`, `GRANOT-LIFECYCLE-PRODUCTION-SPEC.md`, `LEAD-ENRICHMENT-STATES-AND-FIELDS.md`, `NOTES.md`, `payload_shapes.md`, `README.md`, `SUGGESTED-DOMAIN-MODELS-AND-PROVENANCE.md`, `vantage-granot-lifecycle-handoff.md` | Superseded prototype/Intake-era authority. References are replaced by the final specification, production modules, and completion reports. |
| `retain_authority` | `specs/FINAL-SPECIFICATION-GRANOT-LEAD-LIFECYCLE.md`, `specs/FINAL-SPECIFICATION-GRANOT-LEAD-LIFECYCLE-INDEX.md`, `specs/FINAL-SPECIFICATION-TO-34-ISSUE-TRACEABILITY.md`, `specs/FINAL-PRE-SPECIFICATION-GRANOT-LEAD-LIFECYCLE.md`, `specs/lead_lifecycle_issue_breakdown_reccomendation.md` | Final contract, locked decisions referenced by it, traceability, and approved issue spine. |
| `retain_authority` | `delivery/AGENT-EXECUTION-RUNBOOK.md`, `delivery/UNIT-STATUS.md`, `delivery/README.md`, `delivery/issues/**`, `delivery/completion-reports/**`, `delivery/warnings/**` | Delivery authority/history and warning custody. Historical wording is not active runtime vocabulary. |
| `retain_operations` | `delivery/HANDOFF-2026-08-19-UNIT-23-PREVIEW*.md` | Immutable preview evidence referenced by Unit 23; no executable behavior. |
| `retain_operations` | `delivery/UNIT-33-CLEANUP-INVENTORY.md`, `delivery/UNIT-33-ACCEPTANCE-LEDGER.md`, `delivery/UNIT-33-EXTENSION-CLIENT-INVENTORY-TEMPLATE.md`, `delivery/UNIT-33-EXTENSION-CLIENT-ATTESTATION.md` | Unit 33 cleanup/release-test evidence, reusable unsigned inventory template, and accepted Owner operational-control attestation. |

Operational migration sources remain only under `scripts/migrations/`. Package commands for the prototype CLI, prototype dry-run, and prototype official-source seed are removed. `pnpm verify:granot-lifecycle:unit33-cleanup` deterministically enforces the active-source cleanup boundary; its final scan covered 1,121 non-ignored worktree paths and 1,015 active text files with 0 findings, including untracked delivery artifacts. Durable Mongo evidence and gitignored migration/certification output are not deleted.
