# Shared contracts and integration handoffs

Status: specified; runtime types have not been implemented/frozen. Team A records the actual module paths and version once implemented. Tables below are coordination interfaces, not permission to duplicate business logic.

| Contract | Authority | Producer → consumer | Required handoff |
| --- | --- | --- | --- |
| Call identity and evidence | 02 §§1–3; 03 capture | B → C/D/E | Canonical id, projection revision, event/observed time, external number, participants, recording/coverage; duplicate and transfer fixtures. |
| Attachment attribution | 01 §5.2/§6 | C → B/D/E | Exact/Likely/Unsure, scoped subject, blocked reason; no model-selected Lead authority. |
| Transcript version | 02 §6; 10 evidence | B → D/E | Immutable redacted segments/digest, speaker evidence/unknown, complete coverage and media state. |
| Outreach/action commands | 01 §§5–8; 04 | C → D/E | Multiple nullable-due actions, assignments, Owner instruction scopes/revisions, clocks/review/restriction behavior. |
| Envelope schema | 10 §3 | A/D → all | Strict discriminated union, schema version, example input/output fixtures, zero operational-state output fields. |
| Scoped MCP protocol | 10 §2; 04 §6 | D → agent worker | Tool allowlist, credential claims, run subject enforcement, paginated read schemas and snapshot capture. |
| Submission and effects | 10 §§5–8 | D + C → E/F | Idempotent receipt, stable obligation identity, application/review status separation, CAS failure and partial outcomes. |
| Owner interventions | 10 §7; 04 §4 | C/D → E | Immediate correction before reanalysis, original/current mode, exact confirmation target, versioned assessment. |
| Policy and derivation | 01 §8 | A/C → all | Versioned settings, effective schedule, stamped default deadlines, pure derive DTO and clock fixtures. |
| Jobs and audit | 02 §15; 03 §14 | A → B/C/D/F | Dedupe/lease epoch/recovery, submit→apply atomic scheduling, immutable history and evidence retention. |
| Owner DTOs/live | 04; 05 | B/C/D → E | Stable subject keys, one Attention row/all reasons, full action list, review-only closed rows, invalidation types. |

## Minimum cross-team fixture set

- 20-second Form Lead call with clear Friday promise; full analysis and follow-up despite short duration.
- Voicemail containing a callback request; no human-contact stamp.
- Inbound human conversation on a Form Lead; clears No call yet.
- Alex owns Outreach; Jordan promises a callback; Owner separately assigns the callback to Casey.
- Call Friday + send estimate today + an undated availability check on one record.
- Owner corrects date while a prior-snapshot run is applying; Owner wins with model disagreement visible.
- Same run delivered twice and a later run repeating the same promise; one obligation, full run history.
- Old promise followed by fulfilled callback and Booking, ingested out of order; no revived overdue action.
- Contact restriction conflicts with an Owner callback; plan preserved but calling paused.
- No recording/AI budget exhausted while missed-call and Owner commands continue.

## Interface changes

Changing a field/enum/route requires updating its canonical source document, typed schema, example fixture, consumers and acceptance test in one coordinated handoff. A contract change is not complete because one repo compiles. Never retain an old acceptance-gated API behind a new label.

## Readiness checkpoints

| Gate | Evidence | Current status |
| --- | --- | --- |
| G1 Contracts frozen | Types/migrations/DTO fixtures accepted by B–E | Not started |
| G2 Operational loop | Capture → attribution → clocks/actions → Owner UI without AI | Not started |
| G3 Intelligence loop | Transcript → scoped MCP reads → submit → auto-apply → intervention | Not started |
| G4 Resilience | Dedupe/races/history/budget/permission/retry/retention proofs | Not started |
| G5 Owner walkthrough | Acceptance scenarios with real UI and test backend | Not started |
| G6 Production capability/rollout | Fresh grants/subscription/credentials/model checks and separate deployment evidence | Not started |

## September 17 codebase alignment

[Audit and required adaptations](../11-codebase-alignment-audit.md) are part of this delivery contract. Complete the rows assigned to this team and provide integration evidence; current runtime helpers do not already satisfy the revised contracts. [Design intake](../07-claude-design-brief.md) governs the forthcoming Claude artifact; its arrival is not assumed.
