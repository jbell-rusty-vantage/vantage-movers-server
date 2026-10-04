# F / SOD-F

Current approved policy: P01, P02a–P02i, P03, P04a–P04d, P05a–P05h, P06a–P06f, P07a–P07g, P08a, P09a–P09c and P10a; D01 deterministic-only scope and V01/V02 visual requirements. Read FINAL-POLICY-REVIEW.md, SPECIFICATION and DECISIONS. Questions 1–14 are integrated; final ratification is Question 15. Technical proofs remain gated.

Purpose: Independent contract/interface/replica/browser/data readiness verifier. Own acceptance matrix execution, two-instance config reload, authorizations, no side effects, latency and migration crash/replay/races, rollback rehearsal and final operational handoff evidence.

File ownership: New focused tests/evidence fixtures only with task owners informed. Do not rewrite implementation to make a test pass or approve your own unreviewed contract change. Report concrete failures with trigger/path; return fixes to owner.

Dependencies, validation and acceptance: Plan from S0; S4 after B/C/E; S5/S6 with D; final S7 release signoff with A. All SPECIFICATION Section21/VALIDATION/DATA-READINESS cases; required skipped tests block. Production access/latency/telemetry proofs labelled unverified until measured. Final report explains allowed cohort and blockers; no deploy or live sends.

Read [contracts](../../CONTRACTS.md), [sprint](../../SPRINT.md), [decisions](../../DECISIONS.md) and [validation](../../VALIDATION.md). Claim files in [ledger](../LEDGER.md); send A the [handoff](../HANDOFF-TEMPLATE.md). Record [evidence](../evidence/README.md). No enforcement/rollout while activation gates are unresolved.


## Final policy implementation requirements

Consume all approved policy bundles in [final policy review](../../FINAL-POLICY-REVIEW.md); DECISIONS retains historical provenance and contracts/fixtures retains synthetic examples. D01 excludes LLM analysis, transcription, summaries, assessments, extracted promises and AI suggestions from this feature; MCP remains separate. P06f establishes explicit precedence and one human follow-up plan. P05h intentionally changes viable No-Sync eligibility without silent legacy reopening. P09b/P09c grant trusted Manager coordination/Daily Operations and define Admin as Owner; generic Admin elevation is forbidden. V01/V02 require reference fidelity and nearly identical team desks.

Implement source defaults/uncertainty/reentry (P05e/P05f), passed/unknown-date review (P05g), advisory cooldown (P06b), restrictions (P06c), continuous assignment responsibility (P06d), human callbacks (P06e/P06f), event-time/window/originating-inbound rules (P07g), scheduled goals (P08a) and prospective fixed-boundary migration (P10a). Earlier approval-copy paragraphs are consolidated here; consult ledger for exact history rather than treating old pending flags as open policy.

Required verification includes permitted-role command/read/stream matrix; current-assignment revocation; historical actor/policy/assignment provenance; channel-independent requirement/goal credit; genuine versus apparent misses; restriction-caused waiver/rescheduling; no preactivation debt; config reload/CAS/immutable versions; no competing legacy/AI/missed-inbound planner writes; provider origin/status/timestamp/identity proof; migration/reconciliation/rollback/headroom and measured freshness. Synthetic packet checks alone do not establish those proofs. Preserve S5–S7 and at least 40% sprint capacity. No runtime implementation/live operation authorized by the interview.
