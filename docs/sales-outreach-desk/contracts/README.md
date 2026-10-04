# Fixture authority checkpoint

Current policy: P01, P02a–P02i, P03, P04a–P04d, P05a–P05h, P06a–P06f, P07a–P07g, P08a, P09a–P09c and P10a; D01 deterministic-only scope and V01/V02 visual requirements. Historical fixture flags state each original decision's approval scope, not current open gates. Use later fixtures and the final policy review for consolidated rules. configuration-defaults.json stays intentionally disabled/null: approved policy is not an automatic bootstrap or live activation. All tests here are synthetic declaration/integrity checks, not runtime acceptance.

[P07f late-evidence fixtures](fixtures/p07f-late-evidence.json) record actual-date credit, apparent-versus-genuine miss correction, single-credit initiator reassignment and no capture-date duplicate credit. Provider timestamps/chronology remain proof gates.

[P07e SMS sender/origin fixtures](fixtures/p07e-sms-sender-origin.json) record deliberate reviewed-rep/helper/template sends, unattended automation/confirmation/inbound-reply exclusions and ambiguous shared-sender pending status. All SMS statuses still follow P07d; provider origin/identity capability remains a proof gate.

[P07d SMS-status fixtures](fixtures/p07d-sms-status-corrections.json) record confirmed sent/delivered credit, queued/API-only/send-failure exclusion, later delivery-failure revocation, replacement evidence and independent Call/goal/fixed-sequence behavior. Sender/origin/provider proof gates stay open.

[P07c inbound helping fixtures](fixtures/p07c-inbound-helping.json) record one applicable inbound cadence/catch-up credit for any reviewed sales rep, zero outbound-goal credit, no transfer inflation and unchanged assignment/access. Earlier inbound/attribution fixture scopes remain historical.

[P07b outbound attribution fixtures](fixtures/p07b-outbound-attribution.json) record helping-rep lead coverage, initiator-only goal, no transfer/duplicate-leg inflation, ambiguity handling and unchanged assignment/access. Helping-rep inbound and SMS remain separate.

[P07a call-credit fixtures](fixtures/p07a-call-credit.json) record verified outbound attempts, answered assigned-rep inbound cadence/catch-up-only credit, missed-inbound exclusion, no-call errors and duplicate/internal/in-progress exclusions. Goal credit and cadence spacing are distinct; provider mapping/attribution remains to prove.

[P06a catch-up fixtures](fixtures/p06a-bounded-catchup.json) record one actionable catch-up per channel, no stacked quotas, one-event current quota credit, preserved misses, channel independence and fixed SMS dates. Call/SMS eligibility remains P07.

[Known priority and Manager-read fixtures](fixtures/p05d-priority-map-manager-read.json) record accepted-source parity, all known code meanings/cadence effects, Priority 5 versus official Booking, and approved Manager read scope. Unknown-evidence behavior and other Manager permissions remain open.

[P05c unmapped-priority fixtures](fixtures/p05c-unmapped-priority.json) record accepted unmapped codes with no routine cadence, raw-code Owner review, supersession without fulfillment, historical preservation and no implicit closure/reopening. Missing/uncertain evidence remains separate.

[P05b Priority 3 fixtures](fixtures/p05b-priority-three.json) record no routine Call/SMS obligations, previous-period supersession, preserved misses/history/open visibility and no implicit reopening. Unknown priorities, explicit callbacks, goal eligibility and reentry remain separate gates.

[P05a return-to-New age fixtures](fixtures/p05a-return-to-new-age.json) record original received-date age continuing through Quoted/closures, no Day 1 restart and fixed New call/SMS schedules on subsequent full working dates. Transition-date allowance/credit/initial response, recovery and provider gates remain open.

# P04d continuation

[P04d no-date fixtures](fixtures/p04d-quoted-no-date.json) record the approved next-working-date default, daytime/late entry, explicit closures, already-called entry date and repeated-priority stability. Earlier fixture scopes remain historical; recovery/evidence/cutover stay gated.

# Local contract examples

Current approved behavior is consolidated in SPECIFICATION Sections 9.4/10/11/12 and the current DECISIONS table. Older partial fixtures intentionally retain approval-scope flags from their creation; they do not reopen choices approved by later decision IDs. configuration-defaults.json remains an incomplete disabled bootstrap, not an approved policy or seed. Provider/runtime proof remains unrun.

[P04c allowed-date fixtures](fixtures/p04c-quoted-allowed-dates.json) record future working dates, today through configurable 19:30, effective same-day activation, rejection of closed/past dates and later-closure waiver without silent date shifting. No-date default subsequently approved in P04d.

[P04b Quoted permission fixtures](fixtures/p04b-quoted-permissions.json) record current assigned Rep/Owner access, post-miss audit/history, former-Rep denial and revision conflict. Allowed-date/default-entry and Manager rules remain separate decisions; synthetic pass is not runtime authorization proof.

[P04a Quoted deferral fixtures](fixtures/p04a-quoted-deferral.json) record selected-date 08:00 activation/20:00 due, daily continuation and no early-call fulfillment. Permissions/date validation, no-date default, recovery and provider eligibility remain separate gates.

[P02i closure fixtures](fixtures/p02i-closures.json) record no automatic holidays, future Owner closures, waived quotas, paused working clocks and unchanged age/fixed SMS. Inputs are hypothetical, not actual closed dates. Quoted selection, catch-up and roster remain separate decisions.

[P02h SMS timing fixtures](fixtures/p02h-sms-deadline-allowance.json) record configurable 20:00 deadline, 19:30-inclusive arrival threshold and later-date waiver with no extra next-day SMS. Provider success, recovery and holidays remain separate gates.

[P03 SMS sequence fixtures](fixtures/p03-fixed-sms.json) record fixed configurable Days 1/2/3/6/9/12 onward, extra-send/miss stability and event-time evaluation. SMS deadlines/arrival allowance, recovery and provider eligibility remain separate approvals/proofs.

[P02g arrival-day fixtures](fixtures/p02g-arrival-day-calls.json) record configurable call allowances at 18:00/19:30, no retroactive noon deadline, overnight carry and once-only next-day quota credit. SMS allowance and holiday/assignment/restriction choices remain open.

[P02f daily-deadline fixtures](fixtures/p02f-new-daily-deadlines.json) record configurable full-day New deadlines 12:00/20:00 for two calls and 20:00 for one. They distinguish completed counts from historical deadline misses; arrival-day, SMS and Quoted deadlines remain unapproved.

[P02e spacing fixtures](fixtures/p02e-call-spacing.json) record initial configurable 60 elapsed-minute spacing, boundary/retry behavior and a synthetic edit example. Config edits and activation flags use persisted reloadable authority without deployment/env fallback; production reload remains an unrun proof.

[P02d first-call fixtures](fixtures/p02d-first-call-deadline.json) record 30 working minutes, seven-day overnight carry and DST cases. They do not approve full-day quotas, subsequent-call timing, SMS deadlines, holiday overrides or blocked/unassigned exemptions.

[P02c hours fixtures](fixtures/p02c-working-hours.json) record [08:00,20:00) New York daily, including Sunday and winter offsets. First-call deadlines, late-arrival quotas, holidays and outside-window credit remain unapproved.

[P02b seven-day fixtures](fixtures/p02b-working-week.json) record Monday–Sunday working days and no automatic Sunday cadence exemption. Daily hours, holidays, deadlines and partial-day quotas remain unapproved.

[P02a calendar-age fixtures](fixtures/p02a-calendar-age.json) record received-date Day 1 and New York calendar advancement, including Sunday, late-night and DST examples. They do not approve closed-day work, deadlines or partial-day quotas.

[P01 call-count fixtures](fixtures/p01-call-count.json) record the approved two-required/optional-third decision. They are partial policy examples, assume qualifying calls and resolved full-day windows, and do not authorize enforcement or settle timing/eligibility.

configuration-defaults.json is a schema design/default fixture, not database seed or active policy. It is intentionally unapproved with all new gates disabled and migration paused. synthetic.json is safe UI/contract scenario input; no real identities or provider content. Team A must implement strict Zod schemas matching CONTRACTS.md and expand full mock response fixtures as interfaces land. The current packet validator checks example arithmetic/safety/portability, not runtime feature correctness.


[P06b advisory cooldown](fixtures/p06b-advisory-cooldown.json) records Question 1 approval: rolling-three-attempt warning without hard pause, actual retry goal credit versus cadence spacing, unchanged anchor and real restriction precedence.


[P06c restriction waiver/resume](fixtures/p06c-restriction-waiver-resume.json) covers release at opening versus after opening, independent SMS, prior misses and paused initial-response minutes.


[P06d assignment responsibility](fixtures/p06d-assignment-responsibility.json) preserves unassigned deadlines, inherited catch-up, historical responsibility and initiator goal credit through reassignment.


[P06e explicit callbacks](fixtures/p06e-explicit-callback.json) records human timed appointment replacement, attempt-based fulfillment, SMS independence, late misses and deterministic-only scope D01.


[P08a roster/goals](fixtures/p08a-roster-goals.json) checks scheduled zero-call reps, explicit partial-day numbers, absence labels, summed goals and continuing Lead coverage.


[P09b Manager permissions](fixtures/p09b-manager-permissions.json) captures amended Daily Operations access and coordination permissions with Owner-only advanced controls and explicit role binding.


[P09c Admin/Owner role](fixtures/p09c-admin-owner-role.json) records feature-local terminology without generic Admin elevation.


[P05e intake/priority uncertainty](fixtures/p05e-intake-priority-uncertainty.json) distinguishes native/manual default New, Granot review, retained verified policy and accepted codes.


[P05f partial-day reentry](fixtures/p05f-partial-day-reentry.json) covers original-age quotas, return-time caps, prior active-policy contact credit and no superseded-debt revival.


[P05g move-date review](fixtures/p05g-move-date-review.json) keeps cadence through passed/unknown dates without age reset or inferred closure.


[P07g event time/windows](fixtures/p07g-event-time-windows.json) covers closing/midnight, inbound spacing, sent-time attribution, originating answered inbound and restricted outbound exclusion.


[P10a prospective cutover](fixtures/p10a-prospective-cutover.json) preserves original age, source-covered current-date credit and explicit schedules with no preactivation policy debt or AI plan migration.


[P05h Lead eligibility](fixtures/p05h-lead-eligibility.json) covers viable No-Sync, preserved closures, Form Fill and canonical association versus duplicate/multiple-credit exclusion.


[P06f precedence/collisions](fixtures/p06f-precedence-collisions.json) covers closure/restriction/schedule/priority/goal order, one explicit plan, restriction-caused rescheduling and no automatic missed-inbound obligation.


Finalization: POLICY-APPROVAL.json records FINAL-01 complete business-policy adoption and P10b manual launch under the explicit finalization instruction. Bootstrap approval_ref stays null/controls false; historical fixtures preserve original approval scope. See [P10b launch fixture](fixtures/p10b-manual-start.json) and END-TO-END-RUN.md.
