# Unit 09 — Aggregate revision fields and additive revision migrations

> **Contract maturity: scaffold.** This preserves the approved issue spine but is not implementation-ready until every **TODO during refinement** item is resolved against the current repository and authoritative specification. Do not implement from this scaffold alone.

## 1. Authority

- **Final specification:** 'scripts/prototypes/granot-lead-lifecycle/specs/FINAL-SPECIFICATION-GRANOT-LEAD-LIFECYCLE.md'
- **Original slice:** first foundation of S07 plus revision portions of S08.
- **Specification and AC references:** Sections 14.1, 23.2 compare-and-swap requirements, 34.3–34.5; AC-21/32 prerequisites.
- **Shared execution rules:** 'scripts/prototypes/granot-lead-lifecycle/delivery/AGENT-EXECUTION-RUNBOOK.md'
- **Approved unit map:** 'scripts/prototypes/granot-lead-lifecycle/specs/lead_lifecycle_issue_breakdown_reccomendation.md'
- **Optional extraction protocol:** '.cursor/agents/lead-lifecycle-spec-extractor.md'

The final specification wins on conflict. The primary agent must read the cited sections, final-spec Sections 1–2 and 4–7, the assigned Section 36 AC rows, the applicable Section 38 slice, and Sections 39–41 when this unit enables effects.

## 2. Objective

revision/history-boundary fields on Form Lead, Call Lead, Booking, and Cancellation; report/apply/verify migrations; index collision reporting; no fabricated historical changes.

## 3. Repositories and fixed branches

- **Affected repositories:** server.
- Server work uses 'vantage-main-server' branch 'granot-lead-lifecycle'.
- Admin work uses 'vantage-admin' branch 'granot-lead-lifecycle'.
- Extension work uses 'granot_sync_extensions_and_services' branch 'main' and the final specified version posture.
- No per-unit branches. No commit, push, deploy, production mutation, live payload inspection, or external send without separate authorization.

## 4. Blocked by

Unit 01.

Before editing, verify predecessor evidence against repository state, migrations/indexes, flags, and test output. Do not rely only on prose handoffs or the status ledger.

## 5. Approved unit spine

- No additional unit-map qualifiers beyond the objective, proof, and boundary below.

## 6. In scope

- Deliver the objective as one independently verifiable vertical increment through every production-facing boundary named by the specification.
- Preserve the proof obligations below and all inherited S-slice migration, verification, live-verification, and rollback requirements.
- Update behavior documentation/rules in this unit when behavior changes.

## 7. Explicitly out of scope

- do not yet route every write through the new executor; legacy compatibility must remain readable.
- Automatic Booking creation/update or Cancellation/un-cancellation from Granot evidence.
- Later-unit effects, compatibility removal, rollout, production mutation, or source-policy assumptions not explicitly owned here.
- Raw payload, credential, or unmasked contact data in projections, logs, issue/handoff text, fixtures, reports, or agent/subagent output.
- **TODO during refinement:** enumerate the precise later-unit models, commands, flags, UI, migrations, and cleanup excluded by this boundary.

## 8. Invariants at risk

**TODO during refinement:** quote only the applicable numbered invariants from final-spec Section 4 and explain the failure mode this unit must test.

Program-wide minimum: MongoDB remains System of Record; Granot Observation remains evidence rather than Booking/Cancellation authority; only canonical commands mutate aggregates; immutable evidence and provenance axes remain separate; identity conflicts never reassign source ownership/CPL; resolved cases never reopen.

## 9. Exact contracts and production seam

**TODO during refinement**, using the extractor protocol or equivalent direct reading:

- exact TypeScript unions, outcome/reason/issue strings, schemas, indexes, commands, and response contracts;
- production module interface and existing boundary to extend;
- causal chain and current-state versus append-only persistence responsibilities;
- route/Admin/extension behavior that must remain policy-free;
- contradictions with current code that require compatibility treatment rather than reinterpretation.

Runtime lifecycle policy belongs under 'src/services/granotLifecycle/'. Routes and consumers pass identities and validated commands rather than owning normalization, matching, desired state, or patch construction.

## 10. Flags and activation posture

**TODO during refinement:** copy the exact starting and ending flag values from final-spec Sections 27 and 38. State which later effects remain false and whether processing is off, historical shadow, live shadow, or narrowly live.

Never enable a later effect to make this unit’s tests pass.

## 11. Migration and indexes

**TODO during refinement:** state 'none' or copy the exact final-spec Section 34 report → reviewed apply → verify contract. Assignment never authorizes a production apply.

## 12. Acceptance criteria

- Preserve every AC referenced by the Authority section without weakening its final-spec Section 36 assertion.
- Map each AC to a concrete pure/model/replica-set/module/route/Admin/extension test location before implementation.
- Name AC-owned tests with their 'AC-xx' identifiers.
- **Approved unit-specific proof:** model/migration tests for defaults, monotonic nonnegative revisions, deterministic idempotent backfill, history boundary semantics, and failure on one-Booking-per-normalized-Job collisions.
- **TODO during refinement:** copy the exact assigned AC sentences and convert the proof into checkboxes at the required interface level.

## 13. Verification

- Run focused tests capable of proving the unit-specific behavior.
- Server: 'pnpm test' and 'pnpm typecheck'.
- Admin when affected: configured tests, lint, typecheck, and build as appropriate.
- Extension when affected: 'pnpm test', 'pnpm compile', and 'pnpm build'.
- Mongo uniqueness, transaction, lease, and concurrency claims require replica-set integration evidence.
- **TODO during refinement:** list focused commands, synthetic fixtures, safe smoke checks, and exact absence-of-forbidden-effect assertions.

## 14. Live/staging verification

**TODO during refinement:** copy the applicable Section 38 live-verification requirement. Use redacted synthetic evidence first. Production remains read-only unless separately approved; inspect bounded causal IDs and metrics, never raw payload/contact values.

## 15. Rollback

TODO during refinement: copy the narrowest rollback from the applicable S-slice. Disable the narrowest caller/flag first and preserve evidence and committed official facts.

## 16. Required completion handoff

Use Runbook Section 13 in full. The report must include repositories/branches, behavior-grouped files, sections/invariants/ACs, migrations/index status, flags before/after, exact test outcomes, masked verification, concurrency/idempotency/no-op/privacy proof, risks/deferred compatibility, newly unblocked units, final Git status, and an explicit external-action statement.

The next agent must independently verify this evidence. “Code written” is not a completion condition.

