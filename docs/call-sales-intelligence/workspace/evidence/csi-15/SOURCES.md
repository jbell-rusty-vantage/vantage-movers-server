# CSI-15 sources

Authority is the Owner's [NEXT-SESSION mission](../../NEXT-SESSION.md), which explicitly supersedes the handoff template's older `sales-intelligence` branch instruction: this work stays on local `main`.

- [Specification](../../../01-specification.md): historical fulfillment, official Booked/Cancelled closure, original event time and no revived overdue.
- [Models](../../../02-domain-models.md), §12–13: daily Sync Windows and budget authority.
- [Pipeline](../../../03-server-pipeline-and-jobs.md), §3.1/11/12/14: capture checkpoints, crons, retention, recovery and budget admission.
- [Routes](../../../04-server-routes.md): Owner `POST /backfill`, Coverage and `ORIGINAL_EVIDENCE_UNAVAILABLE`.
- [Owner UX](../../../05-owner-dashboard-ux.md) and [delivery acceptance](../../../06-delivery-plan-and-acceptance.md): Coverage honesty and CSI-15 acceptance.
- [Contracts](../../CONTRACTS.md), [ledger](../../LEDGER.md), [sprint](../../SPRINT-PLAN.md), [Team F](../../teams/f-integration.md): existing seams and ownership; historical status sections are not production authorization.
- [Named-subject authorization](../named-subjects/AUTHORIZATION.md), [checks](../named-subjects/CHECKS.md), [handoff](../named-subjects/HANDOFF.md): earlier narrow seed scope, not fleet backfill evidence.
- Canonical Services: [foundation](../../../../knowledge/services/sales-intelligence-foundation.md), [analysis](../../../../knowledge/services/sales-intelligence-analysis.md), [Outreach](../../../../knowledge/services/sales-intelligence-outreach.md), [Number Activity reads](../../../../knowledge/services/number-activity-reads.md), [live invalidations](../../../../knowledge/services/sales-intelligence-live.md).
- Workspace `CONTEXT.md` and `docs/agents/domain.md`: shared vocabulary and domain ownership. Server behavior remains in `vantage-main-server`.

Runtime evidence comes from the changed source and disposable loopback replica tests listed in [CHECKS](CHECKS.md). No historical capability probe is treated as a current provider grant; no production-backed browser or provider check is part of this packet.
