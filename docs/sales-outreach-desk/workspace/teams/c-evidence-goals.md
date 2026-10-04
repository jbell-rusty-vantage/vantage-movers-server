# C / SOD-C

Purpose: Build minimal durable rep SMS metadata capture, mailbox cursors/gap-aware coverage, coalesced hints/sync/status correction and measured rate admission. Implement eligible initiating-rep outbound goal recomputation and corrections using canonical calls and historical reviewed identity/association.

File ownership: New SMS adapter/evidence and goal services; existing RingCentral subscription/rate gate and capture fanout changes claimed specifically. Shared models/jobs/validation negotiated with A. No message send or model/media pipeline.

Dependencies, validation and acceptance: Depends A; E01/P07/P08 block live activation. Prove distinct call/logical message credit, transfers/duplicate receipts, failed/queued/status corrections, shared sender ambiguity, reassignment/contact-time attribution and gap != zero. 108/100 correct. Handoff coverage+dirty-day contracts to D/E/F.

Read [contracts](../../CONTRACTS.md), [sprint](../../SPRINT.md), [decisions](../../DECISIONS.md) and [validation](../../VALIDATION.md). Claim files in [ledger](../LEDGER.md); send A the [handoff](../HANDOFF-TEMPLATE.md). Record [evidence](../evidence/README.md). No enforcement/rollout while activation gates are unresolved.


## Final policy implementation requirements

Consume all approved policy bundles in [final policy review](../../FINAL-POLICY-REVIEW.md); DECISIONS retains historical provenance and contracts/fixtures retains synthetic examples. D01 excludes LLM analysis, transcription, summaries, assessments, extracted promises and AI suggestions from this feature; MCP remains separate. P06f establishes explicit precedence and one human follow-up plan. P05h intentionally changes viable No-Sync eligibility without silent legacy reopening. P09b/P09c grant trusted Manager coordination/Daily Operations and define Admin as Owner; generic Admin elevation is forbidden. V01/V02 require reference fidelity and nearly identical team desks.

Implement source defaults/uncertainty/reentry (P05e/P05f), passed/unknown-date review (P05g), advisory cooldown (P06b), restrictions (P06c), continuous assignment responsibility (P06d), human callbacks (P06e/P06f), event-time/window/originating-inbound rules (P07g), scheduled goals (P08a) and prospective fixed-boundary migration (P10a). Earlier approval-copy paragraphs are consolidated here; consult ledger for exact history rather than treating old pending flags as open policy.

Required verification includes permitted-role command/read/stream matrix; current-assignment revocation; historical actor/policy/assignment provenance; channel-independent requirement/goal credit; genuine versus apparent misses; restriction-caused waiver/rescheduling; no preactivation debt; config reload/CAS/immutable versions; no competing legacy/AI/missed-inbound planner writes; provider origin/status/timestamp/identity proof; migration/reconciliation/rollback/headroom and measured freshness. Synthetic packet checks alone do not establish those proofs. Preserve S5–S7 and at least 40% sprint capacity. No runtime implementation/live operation authorized by the interview.
