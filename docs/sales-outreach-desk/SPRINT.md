# Sprint sequence and protected closing stages

Estimate allocation: S0–S4 consume at most 60% of sprint capacity; reserve at least 40% for S5–S7. If early work overruns, reduce activated cohort/scope or extend sprint; never skip data readiness. Schema/index contracts and migration design start at S0 because implementation depends on them, while execution/reconciliation remains protected at the end.

| Stage | Owner / dependency | Output and exit gate |
| --- | --- | --- |
| S0 bootstrap/contract freeze | A; all teams read | pinned cloud SHAs, clean/concurrent ledger, local packet verification, approved isolated services, source bundles, contract/config/schema/index registry, decision/proof ledger; zero sibling dependencies |
| S1 additive foundation | A then B/C | Owner config command/pointer, request/job reload semantics, schema/index definitions, strict-reader compatibility, scoped API skeleton, current-assignment auth; no enforcement |
| S2 deterministic domain and evidence | B/C after S1 | pure versioned evaluator; priority/closure/quoted transitions; call attribution and SMS metadata/coverage; goal corrections; producer fence plan. Owner rule approvals or disabled synthetic policy |
| S3 focused UI and Operations parity | E plus D after interface freeze; parallel with S2 | canonical shell/queue/team/detail/editor; local mocks until API; D fixes justified live/rebuild timing and race defects without reopening completed Daily Operations work |
| S4 integration and shadow | F after B/C/E | isolated replica+browser auth/live/clock/end-to-end proofs; no sends; producer negative tests; measured simulated latency; dry-run design frozen. Failures return to owners |
| S5 migration execution planning/rehearsal | D with A/F after S4 | target/schema/index inventory and explain plans; immutable dry-run manifest; safe target checks; telemetry thresholds; canary apply/replay/crash/CAS/rollback in disposable replica; zero dry-run writes. No production execution in this task |
| S6 backfill, quality and catch-up readiness | D/C/F after S5 | isolated deterministic backfill and provider mock capture; partition/count/credit reconciliation; watermarked catch-up; zero semantic changes on replay; quarantine review. Production-ready report/apply/verify runbook, no live apply here |
| S7 release readiness/rollback/operator handoff | A/F after S6 | all readiness gates signed, approved cohort, Owner/proof gaps explicit, compatible-reader and persisted-control rollback rehearsal, operator dashboards/checklists, evidence archive; blocked gates prevent production promotion |

Parallel ownership: A exclusively owns shared models/index/router/auth/config/DTO and contract changes. B owns evaluator/periods/producer fences; C owns capture/attribution/goals; D owns migration and focused Operations parity; E owns admin presentation/hooks; F validates independently. Ask A through handoffs before shared-file edits. D starts manifest design at S0, but S5–S7 are dedicated end stages. E can use local synthetic DTO fixtures before server lands. C may build provider mocks while E01 is pending; live SMS activation cannot proceed.

Critical path: config+schema+auth -> evaluator/evidence -> integration -> indexes+rehearsal -> backfill/catch-up/reconciliation -> readiness/rollback. A contract handoff records version/hash, endpoint/schema change, consumer impact, actual tests and next owner. Ledger statuses: ready, claimed, in_progress, review, blocked, accepted. Only F/coordinator accept integrated tickets with evidence; an agent cannot accept its own cross-service work.


D01 scope clarification: outreach contains no LLM analysis, transcription, summaries, assessments, extracted promises or AI suggestions. S2 producer fencing and S4 negative tests must prove their absence for this feature. Preserve deterministic provider metadata capture and authoritative human/provider restrictions. MCP remains separate; future call-analysis capabilities are outside the sprint. P06e adds explicit human timed callbacks; P10 still owns legacy callback migration.
