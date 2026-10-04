# Manual pilot, seeding and automatic intake

Finalized October 3, 2026 under the user's instruction to finalize all additions faithfully for the end-to-end run tomorrow morning (October 4, 2026, America/New_York). This finalization adopts the consolidated business policy and manual-start design as the documentation baseline. It does not record a prior yes answer to Question 15 or claim that live deployment, activation, migration or provider operations occurred. Runtime release remains subject to implemented proof gates and deliberate Owner-controlled admission. P10b adopts this manual-start design; selection/activation are future Owner-controlled operations.

Use [FINAL-POLICY-REVIEW.md](FINAL-POLICY-REVIEW.md) for approved rules, [DATA-READINESS.md](DATA-READINESS.md) for report/apply/verify and migration safeguards, and [DECISIONS.md](DECISIONS.md) for approval history.

## What seeding means

Seeding enrolls selected existing canonical Leads into a versioned outreach cohort and builds current policy periods/projections from verified facts. It preserves Lead identity, original received date, accepted priority, current assignment, human schedules, restrictions, contact history and authoritative closures. It does not create replacement Leads, fabricate activity, reset age or impose preactivation policy debt.

The dedicated migration tooling is an implementation deliverable, not an existing executable command promised here. It must offer report/apply/verify, explicit selected-ID scope, immutable manifest hash, fixed activation boundary, reviewed target identity, checkpoints, input-revision fences, bounded batches and safe retry. The same scope must not silently grow on retry.

## Finalized launch sequence

1. **Complete the release prerequisites.** Prove policy/configuration reload, unique indexes, role/stream/command scope, provider evidence/coverage, producer fencing, migration/reconciliation/rollback and operational headroom. Confirm intended rep identities, work schedules/goals and SMS mailbox access. Final policy approval is separate from release execution authority.
2. **Manually select about 20 current Leads across two or three reps.** Choose verified New and Quoted opportunities, covering New age bands and at least one human-selected future Quoted date. Keep the initial pilot representative and small; the exact selected IDs are frozen in the manifest. Terminal/ineligible, ambiguous identity/priority/time, insufficient coverage and legacy-closed records go to the documented skip/review partitions rather than guessed enrollment. Larger-scale edge cases are proven with isolated fixtures before release.
3. **Generate a read-only preview.** For each candidate show Lead ID, Job Number/phone, source, original received date/age, accepted policy/provenance, current assigned rep, human schedule/restrictions, verified current-date contacts and coverage, proposed Call/SMS quota and first enforceable deadline. Show exclusions/reasons, fixed cohort boundary, selected IDs, policy/config/algorithm versions and expected counts. Reporting writes no operational data and nominates no jobs.
4. **Review in shadow.** After separately authorized pilot installation, allow verified evidence to update preview projections while enforcement is disabled. Reconcile the selected Leads and current-date totals for one working date, using metadata only. Customer contact remains normal human outreach, performed in moving software/RingCentral. The new feature sends no automatic calls/SMS.
5. **Activate only the reviewed cohort.** Prefer a recorded 08:00 New York working-date boundary to make the first enforceable date easy to explain. Recompute the final preview against that exact boundary and current inputs before apply. Fence all legacy/AI/competing routine producers for the enrolled cohort, then admit its deterministic cadence. Input changes are revalidated or quarantined; retries use the same recorded boundary. P10a governs age, current-date credit, Quoted schedules, human callbacks/restrictions and no preactivation penalties.
6. **Observe one full working date after activation.** Reconcile expected and actual periods, quotas, provider credits, callback/restriction behavior, assignment responsibility, queue updates, channel freshness and job recovery. Pause new admission on failures and repair/reverify the affected state under the recorded manifest; do not relabel partial capture as zero contact.
7. **Enable automatic intake after the pilot passes.** A separate Owner-controlled, persisted audited intake-admission gate enrolls newly received eligible Leads prospectively under the approved source/priority rules. Record its effective boundary and input watermark. Late-created historical records and existing unseeded Leads stay in the migration/review path rather than becoming fresh intake merely because their database record was created later. Keep already-enrolled Leads running under their original cohort boundaries.
8. **Expand existing Leads deliberately.** Add further reviewed cohorts through the same bounded report/apply/verify process. Existing unselected Leads are not silently mass-enrolled when automatic new intake starts. Live evidence and recovery take priority over historical migration work.

Pilot size and observation duration are proposed starting choices. These remain persisted editable controls, alongside selected scope, activation/admission boundaries and migration pause. Exact Owner launch UI versus operator CLI presentation is engineering work; only trusted Admin/Owner may approve cohort/admission/activation or migration/rollback. Manager coordination permissions do not include launch authority.

## Daily goals during the pilot

Lead-cadence pilot scope and the outbound daily goal have separate purposes. A 100-call card must not quietly count only calls to the 20 pilot Leads. For selected goal-roster reps, publish their full approved eligible New/Quoted outbound totals for the New York date only if verified evidence and association/identity coverage support that scope. Otherwise mark goal metrics pending/partial and label the scope; do not present a pilot-only count as complete daily performance. Include zero-call scheduled reps and retain actuals on zero-goal days under P08a. No automatic goal reduction follows from selecting a small pilot.

## What runs automatically afterward

Authorized provider capture records canonical call/SMS metadata. Accepted priority/closure/assignment changes and explicit human date/callback commands trigger deterministic reevaluation. Clock-boundary/recovery jobs identify due work, record genuine misses and maintain bounded channel catch-up. Scoped projections/SSE/refetch update the desks. Automatic intake enrolls only the authorized prospective intake scope; existing-lead expansion remains explicitly reviewed migration.

Rep contact still happens in moving software/RingCentral. No LLM analysis, transcription, summaries or AI suggestions enter this feature; MCP remains separate. Automated confirmation history/Operations metrics do not satisfy rep outreach requirements.

## Finalized launch-design decision — P10b

Adopt a manually selected approximately 20-Lead pilot, read-only report/preview, shadow comparison, fixed-boundary cohort activation and one full working-date verification; then enable prospective automatic new intake while expanding remaining existing Leads in reviewed batches. Preserve complete daily-goal scope or visibly pending coverage. Finalization records the design and starting choices; it does not claim that production steps have run. See [END-TO-END-RUN.md](END-TO-END-RUN.md) for October 4 morning preparation/rehearsal.


D01 removal scope: retire outreach LLM/transcription/summary/assessment/extracted-promise/suggestion admission and producers feature-wide, including unseeded existing Leads. A small cadence pilot does not authorize continued legacy AI processing outside the pilot. Retain existing historical evidence and deterministic provider capture/authoritative restrictions. MCP remains separate.
