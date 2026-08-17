---
name: write-granot-unit-issues
description: Write or refine one or more implementation-ready issue documents for the 34-unit Granot webhook and Lead Lifecycle delivery plan. Use when the user asks to complete, author, expand, or repair `delivery/issues/UNIT-XX.md` files from the final specification, issue index, delivery pack, repository state, and predecessor handoffs.
---

# Write Granot Unit Issues

Turn requested unit scaffolds into exact, independently executable implementation contracts. Preserve the approved 34-unit sequence and vertical boundaries; do not redesign the plan or implement the unit.

## Fixed authorities

Resolve paths from the `vantage-main-server` repository root. Read the relevant material directly; never rely on an index or subagent summary as the implementation contract.

Authority order:

1. `scripts/prototypes/granot-lead-lifecycle/specs/FINAL-SPECIFICATION-GRANOT-LEAD-LIFECYCLE.md` — wins on every conflict.
2. `scripts/prototypes/granot-lead-lifecycle/specs/lead_lifecycle_issue_breakdown_reccomendation.md` — approved 34-unit spine, split boundaries, dependencies, and proof.
3. `scripts/prototypes/granot-lead-lifecycle/delivery/AGENT-EXECUTION-RUNBOOK.md` — inherited execution and handoff requirements.
4. Current repository code, migrations, tests, rules, and completed predecessor handoffs — the actual seam the issue must extend.
5. `CONTEXT.md`, `AGENTS.md`, `CLOUD_AGENTS.md`, and applicable `.cursor/rules/` — domain language and repository constraints.

Navigation aids, not independent authorities:

- `specs/FINAL-SPECIFICATION-GRANOT-LEAD-LIFECYCLE-INDEX.md`
- `specs/FINAL-SPECIFICATION-TO-34-ISSUE-TRACEABILITY.md`, when present
- `delivery/README.md`
- `delivery/UNIT-STATUS.md`
- `delivery/warnings/` (review evidence only unless verified against authoritative text/code)

Do not use older/pre-final specifications or prototype vocabulary to fill a gap. If the final specification is genuinely silent, make the narrowest fail-closed issue decision, label it as issue-author guidance, and do not present it as quoted specification.

## 1. Establish requested scope

Identify every requested unit number and its target `delivery/issues/UNIT-XX.md`. Read each current document completely, plus the immediately adjacent completed/fully authored issues needed to preserve formatting and boundaries.

Read `delivery/UNIT-STATUS.md` and the approved unit-map entry for every requested unit. Distinguish:

- specification prerequisites;
- shared-branch sequencing blocks;
- contract maturity;
- implementation status.

Do not quiz the user about granularity when they have already approved the 34-unit plan. Stop only if a requested unit does not exist in the approved spine or authorities irreconcilably conflict.

Completion criterion: every requested unit, dependency, original S-slice, assigned specification section, and assigned AC is identified.

## 2. Build an extraction ledger

Use the final-spec index to locate material, then read the full authoritative sections and applicable S-slice. For each unit, record:

- exact objective and vertical boundary;
- repositories/branches and prerequisites;
- numbered invariants actually at risk and their unit-specific failure modes;
- exact types, unions, model fields, validators, indexes, commands, routes, responses, reason/outcome strings, and module ownership;
- flag values and starting/ending activation posture;
- named migration/report/apply/verify commands, or explicit `none`;
- every assigned AC's full assertion and which part this unit can truly prove;
- focused, repository-wide, replica-set, route, Admin, extension, staging, privacy, concurrency, idempotency, and forbidden-effect proof as applicable;
- rollback that preserves immutable evidence and committed official facts;
- later-unit behavior that must remain out of scope.

Read completed predecessor reports and inspect the current codebase for every production seam named by the unit. Prefer `rg`/`rg --files`. Record dated current-state evidence and contradictions the implementing agent must reverify.

For a split S-slice, allocate only this unit's portion. Do not repeat predecessor work or pull successor work forward merely because the final specification describes them together.

Completion criterion: every claim planned for the issue traces to the final specification, approved unit map, inherited runbook, or verified current repository state.

## 3. Delegate bounded research when useful

The primary agent may use subagents, especially when several units or broad codebase seams are requested. Delegate independent evidence gathering, not final authority.

Good bounded tasks:

- extract one unit's final-spec sections, S-slice, exact AC rows, flags, migration, verification, and rollback;
- inspect current code/models/tests for one unit's production seams and contradictions;
- audit neighboring issues/completion reports for inherited conventions and dependency evidence;
- perform an independent omission/overreach review after drafting.

For multiple units, prefer one research subagent per non-overlapping unit or evidence surface. Tell subagents not to edit shared issue files unless each has an exclusive target. Require file/section/line evidence and unresolved ambiguities, not a generic summary.

The primary agent must personally read every selected skill instruction and every authoritative final-spec section used in the result, reconcile subagent findings, and own all final edits. Never let a subagent silently invent contracts.

Completion criterion: delegated results are received, checked against primary sources, and either incorporated or explicitly rejected before writing.

## 4. Write the issue contract

Replace the scaffold completely. Use the established delivery-pack style and these fourteen top-level sections:

1. `Authority and required reading`
2. `Objective`
3. `Repository, branch, and prerequisites`
4. `Current-state evidence to verify`
5. `Locked decisions and invariants at risk`
6. `Deliverables and exact contract`
7. `Explicitly out of scope`
8. `Flags and runtime posture`
9. `Migration and indexes`
10. `Acceptance criteria`
11. `Required tests and commands`
12. `Live/staging verification`
13. `Rollback`
14. `Required completion handoff`

Mark the document `implementation-ready` only when it contains no unresolved refinement placeholder and another agent can execute it without rediscovering a material product/architecture decision. A complete contract may remain implementation-`blocked` by prerequisites or shared-branch sequence.

### Writing rules

- Lead with end-to-end behavior and causal proof, then give exact layer contracts where precision prevents reinterpretation.
- Retain decision-rich TypeScript/document/index/response shapes from the final specification. Do not paste large generic implementation snippets.
- Use exact canonical vocabulary, enum members, field names, error/result strings, route paths, package commands, and flags.
- Name production seams when current code makes the implementation boundary materially clearer; do not prescribe speculative filenames beyond the final file map or verified conventions.
- Convert each assigned AC into checkboxes at the interface this unit owns. Label foundation/partial ownership honestly; do not claim later live/UI behavior complete.
- State exact absence-of-forbidden-effect assertions.
- Keep migration assignment dry-run/report-first. Issue authorship never authorizes production apply, deployment, live payload access, commit, push, or external send.
- Require redacted synthetic evidence. Forbid raw payload, credential, unmasked contact, and customer data in fixtures, logs, projections, reports, issue text, and subagent output.
- Preserve MongoDB-as-System-of-Record, immutable evidence, canonical-command, transaction/outbox, identity-conflict, and reconciliation immutability rules where applicable.
- Make rollback narrow: disable the caller/effect first and preserve receipts, Observations, Decisions, activation, audits, commands, changes, cases, and committed official facts.
- End with a checkable handoff and the exact newly unblocked unit(s).

Do not leave `TODO during refinement`, scaffold warnings, vague “as applicable” requirements without a concrete decision, or copied program-wide boilerplate that does not apply to the unit.

Completion criterion: every requested document has all fourteen sections, exact unit-owned contracts and AC proof, explicit exclusions, and no unresolved placeholder.

## 5. Reconcile the delivery ledger

Update `delivery/UNIT-STATUS.md` when contract maturity changed:

- set `Contract` to `complete` for fully authored documents;
- set `Status` to `ready` only when all specification prerequisites are complete and the shared-branch sequencing policy permits implementation;
- otherwise retain `blocked` and explain the remaining implementation gate in `Current ready queue`;
- never mark implementation `complete` without a verified completion report and repository evidence;
- do not make optional Unit 32 mandatory or move Unit 34 from final position.

Completion criterion: the ledger accurately distinguishes authored contract from implementation readiness and does not contradict the issue documents.

## 6. Validate before handoff

Run deterministic documentation checks over every requested issue:

```text
rg -n "TODO during refinement|Contract maturity: scaffold|Do not implement from this scaffold" <requested issue files>
rg -n "^## (1|2|3|4|5|6|7|8|9|10|11|12|13|14)\." <requested issue files>
git diff --check
git diff --stat -- <requested issue files> delivery/UNIT-STATUS.md
```

Also verify manually:

- all assigned AC IDs appear and their assertions are not weakened;
- section/invariant/S-slice references exist;
- prerequisites match the approved unit map;
- flags, migrations, live verification, and rollback match the applicable S-slice;
- no predecessor deliverable is reimplemented and no successor effect is pulled forward;
- current-state claims match the inspected repository;
- no sensitive/current payload content entered the documents;
- unrelated user changes remain untouched.

Do not run runtime test suites for documentation-only changes unless a generated helper/script is part of the skill task. State that distinction in the final response.

Completion criterion: searches return no scaffold markers, all fourteen headings are present in every requested issue, `git diff --check` passes, and the manual traceability review has no unresolved gap.

## Final response

Link every completed local issue document and the ledger if changed. Report contract/status transitions, validation performed, and that no implementation/runtime tests ran for documentation-only edits. Mention any deliberately retained implementation block or partial AC ownership.
