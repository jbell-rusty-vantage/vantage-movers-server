<INTRO CONTEXT>
We are now getting deeper into the granot lead lifecycle system sprint.  I suggest that you use subagents strategically to explore the full specification and previous implementations. I am, however, confident that the issue you are tasked to complete, issue 21, is faithfully detailed.  The granot webhook based lead , booking and cancellation lifecycle is the most important running system now. 
 </>

MISSION:
Unit 21 Issue:

You are the primary Vantage Movers implementation agent for Unit 21 of the 34-unit Granot Lead Lifecycle and owner reconciliation program.

Your mission is to implement Unit 21 end to end, verify it at the interfaces required by its acceptance criteria, update the applicable behavior documentation and delivery ledger, and leave the required completion report. Own the whole unit. Continue through implementation and verification; do not stop after reconnaissance, a plan, or partial code unless you identify a genuine blocker under the authoritative contracts.

The unit contract—not this prompt—defines repository scope. Work only in the repositories and fixed branches named by the unit. Do not assume a unit is server-only merely because earlier units were.

AUTHORITATIVE INPUTS

Delivery pack overview:
@vantage-main-server/scripts/prototypes/granot-lead-lifecycle/delivery/README.md

@vantage-main-server/scripts/prototypes/granot-lead-lifecycle/delivery/AGENT-EXECUTION-RUNBOOK.md

Dependency and readiness ledger:
@vantage-main-server/scripts/prototypes/granot-lead-lifecycle/delivery/UNIT-STATUS.md
Mission contract:
<MISSION>
@vantage-main-server/scripts/prototypes/granot-lead-lifecycle/delivery/issues/UNIT-21.md
</MISSION>

Predecessor handoffs (navigation evidence only; verify all claims against the repository):
@vantage-main-server/scripts/prototypes/granot-lead-lifecycle/delivery/completion-reports

Repository instructions and canonical language:
@vantage-main-server/AGENTS.md
@vantage-main-server/.cursor/index.md
@vantage-main-server/.cursor/rules/lead-lifecycle-delivery.mdc

The final specification cited by the mission contract is the implementation authority and wins on conflict. Read every section required by the issue and runbook in full. Do not rely on summaries, older Intake-era documents, prototypes, or completion-report prose when current specification or repository evidence is available.

EXECUTION PROTOCOL

1. Pass the readiness gate before editing.
   - Read the entire runbook, status ledger entry, and Unit 21 contract.
   - Discover and read repository-local `AGENTS.md`, `CLOUD_AGENTS.md`, and applicable `.cursor/rules/*` instructions in every repository the unit affects.
   - Confirm the ledger marks the unit ready and the contract is implementation-ready/complete.
   - Confirm every prerequisite unit is complete by inspecting its landed code, tests, migrations/index state, flags, and completion report.
   - Inspect `git status --short`, the current branch, and recent relevant changes in every affected repository. Preserve all user/predecessor work.
   - If readiness is false, the issue is still a scaffold, an authority conflict exists, or an essential rule is unspecified, do not invent behavior or implement later-unit scope. Fail closed and report the exact blocker with file/section evidence.

2. Build an evidence-backed implementation map before changing code.
   - Read the issue-cited final-spec sections, required shared sections, S-slice, invariant rows, AC rows, rollout/rollback rules, and applicable repository rules.
   - Inspect the production seams and predecessor implementation that this unit extends.
   - Map every owned AC ID and unit checklist item to a concrete test file and the interface level capable of proving it.
   - Record the starting flag/effect posture and migration/index posture. Never broaden a gate or enable a later effect to make a test pass.

3. Implement only this vertical slice.
   - Prefer tests that fail for the missing behavior, then implement the smallest production change satisfying the exact contract.
   - Keep routes and clients policy-free; lifecycle policy belongs in the production module named by the runbook/issue.
   - Preserve transaction, revision, idempotency, replay, no-op, provenance, evidence immutability, and privacy guarantees wherever applicable.
   - Do not implement future units opportunistically. Update the existing behavior docs/rules whose globs own changed paths.
   - Use only redacted synthetic fixtures unless the user separately authorizes an exact staging/live/current-payload operation.

4. Use subagents only for bounded, non-overlapping work when they materially help.
   - You may invoke `lead-lifecycle-spec-extractor` to extract exact cited contracts, but you remain responsible for reading the authoritative sections, resolving interpretation, integration design, final edits, and completion.

   - Good delegated work includes locating seams, mapping ACs to tests, isolated test investigation, or adversarial diff review.
   - Do not delegate the whole unit, authoritative interpretation, production/live access, or overlapping edits. Independently verify every subagent result.

5. Verify completion rather than merely producing code.
   - Run all focused commands required by the issue.
   - Run each affected repository's required full test, typecheck, lint, compile, and build commands from the issue/runbook.
   - Use Mongo replica-set integration tests for claims involving transactions, races, leases, uniqueness, or concurrency; do not overclaim mocked proof.
   - Run `git diff --check` and inspect the final diff for scope, forbidden effects, PII/credential leakage, unexplained overlap, and documentation drift.
   - If any required command fails, investigate and fix in-scope failures. Do not mark the unit complete with failing required checks or unsupported claims.

6. Complete the handoff.
   - Create or update:
     `vantage-main-server/scripts/prototypes/granot-lead-lifecycle/delivery/completion-reports/UNIT-{{UNIT_NUMBER}}-COMPLETION.md`
   - Follow Runbook Section 14 (Section 14 of the Agent-Execution-Runbook) exactly. Include exact commands and pass/fail counts, AC-to-proof coverage, migration/index and flag posture, masked verification, known risks/deferred compatibility, newly unblocked units, and final `git status --short` for every affected repository.
   - Update `UNIT-STATUS.md` only when repository state and all completion gates justify the new status. Do not mark downstream units ready unless all dependencies and sequencing rules are truly satisfied.

NON-NEGOTIABLE SAFETY AND SCOPE

- MongoDB remains the System of Record. Granot observations are evidence, not authority for official Booking or Cancellation facts.
- Never automatically create/update a Booking or cancel/un-cancel one from Granot evidence.
- Never expose or commit raw customer payloads, credentials, cookies, authorization values, or unmasked contact data.
- Do not commit, push, deploy, mutate production, apply production migrations/indexes, inspect current live payloads, or send external requests unless the user separately authorizes that exact action and target.
- Do not discard, overwrite, reset, or "clean up" changes you did not create.
- Do not claim completion from a completion report, passing unit test alone, or code inspection alone. Completion requires the issue's full proof and handoff gates.

FINAL RESPONSE

Lead with the outcome. State whether Unit 21 is complete or blocked, summarize the behavior delivered, list exact verification results, identify the completion report, call out remaining risks/deferred work and newly unblocked unit(s), and explicitly state whether any commit, push, deploy, production mutation, live-payload access, or external send occurred.

\*\* In the case of any vague instructions or when you need a subagent to explore the official specification and its index file.

Full Specification: C:\Users\Pinda\Proyectos\vantage\vantage-main-server\scripts\prototypes\granot-lead-lifecycle\specs\FINAL-SPECIFICATION-GRANOT-LEAD-LIFECYCLE.md

INDEX: C:\Users\Pinda\Proyectos\vantage\vantage-main-server\scripts\prototypes\granot-lead-lifecycle\specs\FINAL-SPECIFICATION-GRANOT-LEAD-LIFECYCLE-INDEX.md

Complete the Mission for Unit 21
