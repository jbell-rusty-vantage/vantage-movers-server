# A / SOD-A

Current approved policy: P01, P02a–P02i, P03, P04a–P04d, P05a–P05h, P06a–P06f, P07a–P07g, P08a, P09a–P09c and P10a; D01 deterministic-only scope and V01/V02 visual requirements. Read FINAL-POLICY-REVIEW.md, SPECIFICATION and DECISIONS. Questions 1–14 are integrated; final ratification is Question 15. Technical proofs remain gated.

Purpose: Own shared contracts, new isolated configuration/model/index registry, Zod DTOs, router registration, signed-actor/current-assignment permission scaffolding and shared release export. Existing transactions.ts is the command seam; no new auth system.

File ownership: src/models/salesIntelligence additions; new src/validation/v1/salesOutreach.ts and src/routes/sales-outreach.routes.ts; shared dto/config/registry/auth changes only after exact ledger claim. Admin shared lib/api DTO/authorization change handoff goes through A and E.

Dependencies, validation and acceptance: S0/S1; unblock B/C/D/E through frozen contract release. Accept latest-config reload on two instances, invalid/missing fail-closed, CAS/idempotency, generic Admin/foreign Rep denial, strict old-parser rollback compatibility. E04 config callsite inventory is mandatory.

Read [contracts](../../CONTRACTS.md), [sprint](../../SPRINT.md), [decisions](../../DECISIONS.md) and [validation](../../VALIDATION.md). Claim files in [ledger](../LEDGER.md); send A the [handoff](../HANDOFF-TEMPLATE.md). Record [evidence](../evidence/README.md). No enforcement/rollout while activation gates are unresolved.


## Final policy implementation requirements

Consume all approved policy bundles in [final policy review](../../FINAL-POLICY-REVIEW.md); DECISIONS retains historical provenance and contracts/fixtures retains synthetic examples. D01 excludes LLM analysis, transcription, summaries, assessments, extracted promises and AI suggestions from this feature; MCP remains separate. P06f establishes explicit precedence and one human follow-up plan. P05h intentionally changes viable No-Sync eligibility without silent legacy reopening. P09b/P09c grant trusted Manager coordination/Daily Operations and define Admin as Owner; generic Admin elevation is forbidden. V01/V02 require reference fidelity and nearly identical team desks.

Implement source defaults/uncertainty/reentry (P05e/P05f), passed/unknown-date review (P05g), advisory cooldown (P06b), restrictions (P06c), continuous assignment responsibility (P06d), human callbacks (P06e/P06f), event-time/window/originating-inbound rules (P07g), scheduled goals (P08a) and prospective fixed-boundary migration (P10a). Earlier approval-copy paragraphs are consolidated here; consult ledger for exact history rather than treating old pending flags as open policy.

Required verification includes permitted-role command/read/stream matrix; current-assignment revocation; historical actor/policy/assignment provenance; channel-independent requirement/goal credit; genuine versus apparent misses; restriction-caused waiver/rescheduling; no preactivation debt; config reload/CAS/immutable versions; no competing legacy/AI/missed-inbound planner writes; provider origin/status/timestamp/identity proof; migration/reconciliation/rollback/headroom and measured freshness. Synthetic packet checks alone do not establish those proofs. Preserve S5–S7 and at least 40% sprint capacity. No runtime implementation/live operation authorized by the interview.
