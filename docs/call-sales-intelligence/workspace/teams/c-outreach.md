# Team C — Outreach, identity and Owner commands

Own CSI-05/06/10 and server CSI-14. Read [01](../../01-specification.md), [02 §§4–5/15](../../02-domain-models.md), [04](../../04-server-routes.md), [10 §§5–7](../../10-intelligence-agent-contract.md), [RingCentral capability](../RINGCENTRAL-CAPABILITY.md) §§5–6. Consume B's events; publish command interfaces for D and DTOs for E.

## Deliver

1. Deterministic attachment suggestions and Owner attach/reject/detach. Phone equality gives Likely, ambiguity blocks Lead-specific effects, reviewed history never overwritten.
2. Outreach ensure/official closure, inbound-human/outbound-attempt transitions, multiple independent actions, nullable dates, completion/rescheduling, customer waits, clock and Attention derivation. Official closure must win during identity resolution.
3. Separate overall/action responsibility, first clear rep assignment, promising rep action ownership, Owner field precedence and append-only audit. Never mutate receiver Agent or Booking allocations.
4. Owner mark worked, date/action/assignment/wait, note, close/reopen, restriction and review-resolution commands. Immediate corrections must be callable by D's review routes; do not defer them to AI.
5. Effective-dated reviewed Rep Identity Links/backfill proposals. Explicit Owner nudge preview/send/repair only. Destination is a current account User on the stored directory snapshot; a reviewed Agent match is not required. Customer destination guards remain. E owns dialogs, C owns server behavior.
6. Read DTOs and meaningful Vantage-event fingerprints. Export the effect-planning/application primitives D uses so model submission does not become a second implementation of business rules.

## File ownership

Main-server `salesIntelligence/attachment/**`, `outreach/**`, `followups/**`, `review/**`, `repIdentity/**`, `nudges/**`, staffing/policy services, operational read services and tests. Coordinate schemas/routes through A. D owns agent orchestration and evidence storage; E owns presentation.

## Proof and handoff

Pin 30/15 staffed-minute deadlines and 2-sales-day clock; default schedule/DST/day-only/outside-hours dates. Test multi-action wait coexistence, undated action, specific completion only, Alex/Jordan/Casey ownership, Owner corrections under races, permanent suppression versus temporary channel pause, closed-work new requests and duplicate missed calls. Handoff command/derive fixtures to D/E and browser-ready endpoints to E. No routine call or note sends messages.

## Kickoff prompt

> Implement Team C's identity, Outreach and Owner-command work from the revised contract. Keep multiple and undated follow-ups first-class; honor Owner overrides and separate action/overall ownership. Export one authoritative application path for Team D and DTOs for E. Prove chronology, clock, closure and revision behavior with meaningful tests. Do not implement model reasoning or send live rep messages as a test side effect.

## September 17 codebase alignment

[Audit and required adaptations](../../11-codebase-alignment-audit.md) are part of this delivery contract. Complete the rows assigned to this team and provide integration evidence; current runtime helpers do not already satisfy the revised contracts. [Design intake](../../07-claude-design-brief.md) governs the received design export; the September 19 sprint revision records adaptation and validation still required.

## CSI-14 directory-User destinations + P2 — September 19

Server destination change and P2 are implemented on existing `sales-intelligence` HEADs. Preview/send take `rc_account_id` + `rc_extension_id`. Reviewed identity is optional metadata. Rate limit is per User extension. Edited review-context bodies fail closed on contact instructions before the provider. Smallest Admin Message-rep picker lists current directory Users, including unmatched Josh/Roy. No identity writes for Josh, Roy, Jason, either Tyler, Russell, QA, or unmatched Users. Live send stays off. [Destination handoff](../evidence/csi-14-destination/HANDOFF.md).

## CSI-10 production seed — September 19

Owner-authorized live seed on existing `sales-intelligence` HEADs. Directory snapshot stored; nine unique first-token Users reviewed as `sales_rep` with pager (and `sms_to_rep` only for a single stored DID). Sean is pager-only. Josh/Roy remain unmatched for later Owner alias or explicit create. No messages. [Seed handoff](../evidence/csi-10-seed/HANDOFF.md). September 19 spec: those unmatched Users, and every other current account User, are valid Owner send destinations without an Agent match. CSI-14 destination change and P2 are now implemented; fuller dialogs and live send remain later.

## CSI-10 delivery — September 18

CSI-14 follow-on: explicit Owner preview/send/history and delivery repair are now implemented on the server; see [CSI-14 handoff](../evidence/csi-14/HANDOFF.md) and [browser contracts](../evidence/csi-14/API-CONTRACT.md). Team E dialogs remain separate and untouched. Earlier “not started” references below describe the CSI-10 delivery baseline. No live send or provider proof was executed.

Rep Identity Link portion of deliverable 5 implemented on server `sales-intelligence` from clean `3355c6d`. [Handoff](../evidence/csi-10/HANDOFF.md), [checks](../evidence/csi-10/CHECKS.md), [concrete imports](../CONTRACTS.md#csi-10-coordinated-additions-september-18). Stored proposals remain unreviewed; Owner review/retirement preserve temporal attribution and queue bounded consumer recovery. Dashboard untouched. Owner Rep Nudges remain CSI-14 and are not started. No provider or production actions.

## CSI-06 delivery — September 18

Deliverables 2, 3, 4 and 6 are implemented on server `sales-intelligence` from `999c63d`. [Handoff](../evidence/csi-06/HANDOFF.md), [actual checks](../evidence/csi-06/CHECKS.md), and [concrete D/E contracts](../CONTRACTS.md#csi-06-concrete-imports-server-relative-september-18). Current typecheck/lint, 31 focused tests and 22 replica tests pass. CSI-05 attachment resolution is consumed. CSI-10's subsequent delivery is recorded above; CSI-14 remains not started. Dashboard untouched; no live sends or production flag enablement.

CSI-14 final server verification: typecheck/lint pass, focused 31/31, nudge replica 16/16, CSI-06/10/foundation/reads replicas 22/12/15/10, full offline 2409 pass/114 skip/0 fail. Both isolated quality checkpoints passed automated checks but failed final review on snapshot documentation contradictions; current-source corrections and the exact fingerprints/results are in [CSI-14 review](../evidence/csi-14/REVIEW.md). No independent final current-source approval is claimed. Live-send proof remains separately authorized and unexecuted; dashboard untouched.

September 19 destination + P2 close: edited review-context contact instructions fail closed before the provider. Isolated Composer 2.5 checkpoint is recorded in [destination review](../evidence/csi-14-destination/REVIEW.md); that snapshot is not independent current-source approval. CSI-17 remains Team D. Dashboard fuller dialogs and live proof remain separate.
