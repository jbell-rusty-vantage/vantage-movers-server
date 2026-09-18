---
okf_version: "0.2"
type: Service
title: Outreach and follow-ups
status: active
tags: [sales-intelligence, outreach]
---

# Outreach and follow-ups — CSI-06

Runtime: `src/services/salesIntelligence/{outreach,followups,review}/`. Authority: [specification](../../call-sales-intelligence/01-specification.md), [Team C](../../call-sales-intelligence/workspace/teams/c-outreach.md), [handoff](../../call-sales-intelligence/workspace/evidence/csi-06/HANDOFF.md).

`ensure.ts` mirrors official eligibility into one Outreach Record per subject. Official closure cancels outstanding actions and queues number refresh in the same transaction. It wins over identity review. No automatic reopening, official writes or qualification imports occur. CSI-05's transactional hook invokes the identity reaction and its paged fan-out schedules revision-specific Outreach work. Event attribution uses `resolveAtInteraction`, never lifetime edge counts. A Number Review cannot escape ambiguous identity or an officially closed related Lead; rejected unrelated edges do not prevent it.

`transitions.ts` distinguishes attributable attempts, inbound human conversations, provider connection, and missed calls. Only a human conversation with reliably mapped Sales Rep evidence stamps meaningful contact. Reviewed effective-dated identities are consumed read-only; CSI-10 still owns their provisioning/review. Missed episodes retain the first deadline, including out-of-order earlier misses. Later callbacks reconcile historical missed episodes before they can become current outstanding work. Waits, estimates and callbacks remain independent actions.

`staffing.ts` implements Eastern Mon–Sat 08:00–20:00 defaults through persisted policy: 30 staffed minutes first call, 15 missed callback, 1440 Going cold. Day-only waits retain the sales-close promise and use next opening for Attention. Explicit offset timestamps and unambiguous spoken weekday/time forms honor outside-hours promises. Unsupported wording, missing AM/PM, nonexistent/repeated local DST time and nonstaffed day-only dates remain undated. Each obligation stamps policy/date resolution; changing the calendar does not rewrite it.

`followups/commands.ts` uses the trusted Owner command ledger, revision checks, same-transaction instructions/audit, and an aggregate write fence. `applyOwnerCommandInTransaction` is the immediate correction path for Team D. Notes preserve context without implying contact. Overall/action ownership are separate; Owner assignments persist. Snooze changes Attention time while preserving contractual due time; undated snooze is invalid. Close cancels, reopen does not revive obligations, and live official eligibility/permanent suppression still block reopen.

`effects.ts` owns pure planning plus transactional application. Team D supplies validated run-scoped findings and server-resolved intents, never arbitrary updates. Recheck current revisions, event identity, official closure, Owner field instructions and later calls. Source interaction identity and original source date remain separate from completion evidence and the current deadline; repeated extraction resolves the original commitment even after completion or Owner date correction. Multiple possible callback targets require completion review; an actual call cannot silently complete every independent callback. The append-only effect ledger retains outcomes across runs and returns the actual effect target. `review/restrictions.ts` serializes number-level spoken restrictions and preserves Owner resolution across replay. Restrictions block execution without rewriting Owner plans or closing Outreach.

`derive.ts` computes all reasons, the highest-priority band, per-action/record responsibility, human-contact ages, cooldown and blockers using every open action. `reads.ts` exports Owner DTOs with all actions and plural Number detail Outreach rows. Reads do not mutate. `attention.ts` builds immutable snapshots in the worker; GET cursors bind snapshot/filter/as-of and do not create snapshots. An unavailable projection is `pending_projection` with a nullable count, not a false zero. Snapshot build aborts without partial publication at 40 seconds or 12 MB; production scale remains a deployment check.

`worker.ts` registers `outreach_ensure` on the existing job dispatcher, minute cron and stage recovery. Queue payload is only `{job_id}`; current interaction comes from `input_refs`. EntityChange scanning uses `(applied_at,_id)`; bounded `_id` repair sweeps cover baseline Leads, interactions and clock boundaries. Official repair dedupes semantic flag fingerprints. All writes remain inside the CSI TEST_MODE database boundary. Flags default off. No routine call/note sends messages, invokes a model, or modifies Lead/Booking/Agent records.

`timeline.ts` registers an append-only CSI audit source with the existing Number Activity timeline merge. Owner notes retain their context; action, assignment, restriction and review events expose prior/current values. Source `happened_at` and audit `recorded_at` remain separate. GET pagination does not write history or projections.
