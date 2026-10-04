# Fast track — operate it live (decision FAST-01, October 4, 2026)

The user and the Owner are the only users of the dashboard and server. They want call progress tracked as soon as possible. Their decision: **deploy with flags on, run the backfill, turn everything on, and fix problems forward.** This file overrides the slower launch mechanics in MANUAL-START.md, DATA-READINESS.md, END-TO-END-RUN.md §6, SPRINT.md S5–S7, SPRINT-RUNBOOK.md P5 and IMPLEMENTATION-PLAN.md §8. Business rules (SPECIFICATION §§2–14, FINAL-POLICY-REVIEW) are unchanged.

## What agents are authorized to do (durable, for this sprint)

- Merge `feat/outreach-desk` into `main` in both repos. Pushing to `main` deploys to production through the Vercel Production workflows. Deploy the server first, then admin.
- Build the new indexes on the production database.
- Run the RingCentral access proof with production credentials.
- Create or update the app-owned `rep_sms` subscription, and add `verificationToken` to the `calls` subscription.
- Install the approved policy (FINAL-01), roster and goals.
- Turn on every control: `desk_enabled`, `cadence_shadow_enabled`, `cadence_enforcement_enabled`, `rep_sms_capture_enabled`, `goal_metrics_enabled`, `intake_admission_enabled`.
- Run the enrollment backfill and SMS history capture.
- Fix defects and redeploy without asking again.

## Still not allowed

- Contacting customers. The desk never calls or texts anyone.
- Deleting or rewriting existing production data. Leads, calls, Numbers, attachments, restrictions, review items and Owner instructions are not touched, except `receiver_agent` through the audited reassign command.
- Silently clearing the 15 inert contact restrictions. They stay **active and blocking** until the Owner confirms or lifts each one in Settings.
- Touching Granot or RingCentral configuration other than the two app-owned subscriptions.
- Force-pushing or rewriting shared history.
- Handling production secrets carelessly. Never print them in logs, evidence or commits.

## Milestones (ship value early)

| Milestone | Contents | Ships when |
| --- | --- | --- |
| **M1 Call progress (target: first deploy)** | `manager` role. `/outreach-desk` shell with Team and My views showing **goal cards and the Daily call goals table only**. Rep-day projections from `call_interactions` and reviewed rep identity. Minute Call Log ISync (RINGCENTRAL-CAPTURE §4). Roster = every reviewed `sales_rep` link, goal 100 on all seven working days. Freshness chips. | As soon as SRV-1, SRV-2, SRV-6 (calls part), SRV-5 (ISync part), ADM-1, ADM-2 and ADM-5 (goal parts) pass their tests. Do not wait for the cadence engine. |
| **M2 Full desk** | Subjects, enrollment backfill, cadence engine, queues, detail, commands, SMS capture, restrictions review, live stream, Daily Operations for Managers | As soon as the lanes pass integration on the replica |
| **M3 Hardening** | Anything VERIFY or real use turns up; SPECIFICATION §14 Daily Operations repairs; latency measurements | Continuous |

**M1 goal scope:** the label is "Outbound calls". It counts verified outbound external attempts by reviewed sales reps (P07a/P07b initiator rule, one credit per call, transfers and duplicate legs excluded). When M2 enrollment lands, the count narrows to eligible New/Quoted Leads per P07a. Calls to numbers with no eligible Lead then appear separately as "Other outbound". Say so on screen; never present one scope as the other.

## Backfill scope (user decision, October 4, 2026)

Enroll every eligible Form/Call Lead (P05h) whose accepted priority maps to New or Quoted, or whose intake default is New (P05e), **and** that meets either condition:
- it was received in the last **90 days** (New York dates, using the restored `leadInstant` adapter); or
- its move date is today or later.

Store this rule as the editable `transition.backfill_lookback_days = 90` plus `transition.backfill_include_upcoming_moves = true`. Eligible Leads outside the scope are listed on the Owner Settings page as "Not enrolled — older" with a one-click Enroll. Missing or unreliable received time, ambiguous identity, and unsupported priority go to the review list, never to a guessed enrollment.

The cutover follows P10a:
- the activation boundary is the moment of apply;
- original age is kept;
- there are no misses or catch-up debt before activation;
- calls already verified today are subtracted from today's quota;
- no fresh 30-minute first-response clock starts for an existing Lead.

**SMS history:** run a per-rep mailbox FSync for the last 7 days so Last interaction and today's SMS credit are right.

## Operating sequence (agents run it end to end)

1. **Pre-flight.**
   - Confirm the production targets: Vercel projects, the database name `vantagemovers` and the RingCentral account. Use the existing env inventory (`docs/knowledge/environment.md`) and the Vercel CLI.
   - Take an index and count snapshot of the collections the desk reads. Record it in `workspace/evidence/RELEASE.md`.
2. **Server.**
   - Merge to `main` and wait for the Production workflow to pass.
   - Smoke-test the existing API: Numbers, health and Daily Operations.
   - Build the new indexes.
3. **Admin.** Merge to `main`, wait for the workflow, and smoke-test `/outreach-desk?view=numbers` (Numbers must still work) and `/daily`.
4. **RingCentral.**
   - Run the read-only proof (RINGCENTRAL-CAPTURE §6).
   - If it passes, create/update `rep_sms` and set the `calls` verification token.
   - If it fails, keep `rep_sms_capture_enabled` false, show "SMS not connected", and continue. Calls do not depend on SMS.
5. **Configuration.**
   - Install the approved policy.
   - Set the roster to all reviewed `sales_rep` links.
   - Turn on `goal_metrics_enabled` and `desk_enabled`. **M1 is now live.** Reconcile one rep's count for today against the RingCentral Call Log.
6. **Backfill.**
   - Run enrollment `report`; log counts per partition.
   - Run `apply` in bounded batches: 25 per batch, single writer, checkpointed. Then run `verify`.
   - Run the SMS 7-day history.
   - Turn on `cadence_shadow_enabled`, check a sample of 10 Leads against the rules, then turn on `cadence_enforcement_enabled` and `intake_admission_enabled`.
7. **Watch.**
   - For the next working hours, check job backlog, Heavy/Light rate-gate usage, webhook health, freshness, and any `review` growth.
   - Fix and redeploy whatever breaks. Write each fix in `workspace/evidence/RELEASE.md`.

## Fix-forward rules

- **If a deploy breaks an existing feature** (lead ingestion, Granot lifecycle, Numbers, Daily Operations, bookings): revert that merge commit on `main` immediately to redeploy the last good build, then fix on the branch.
- **If a desk-only defect appears:** fix it on `feat/outreach-desk` and redeploy. Turning the relevant control off in Settings is the quick mute.
- **If a backfill batch fails:** checkpoints mean a re-run continues where it stopped. Re-running apply is idempotent. A semantically wrong projection is fixed by fixing the evaluator and re-running `outreach_evaluate`. Projections are derived data, so there's nothing to migrate back.
- **If RingCentral returns a 429:** the gate backs off by itself. If the Heavy usage chart sits above 80%, widen the ISync interval in config before doing anything else.
