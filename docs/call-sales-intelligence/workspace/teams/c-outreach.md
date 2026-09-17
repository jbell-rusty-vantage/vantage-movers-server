# Team C — Outreach, identity and Owner commands

Own CSI-05/06/10 and server CSI-14. Read [01](../../01-specification.md), [02 §§4–5/15](../../02-domain-models.md), [04](../../04-server-routes.md), [10 §§5–7](../../10-intelligence-agent-contract.md), [RingCentral capability](../RINGCENTRAL-CAPABILITY.md) §§5–6. Consume B's events; publish command interfaces for D and DTOs for E.

## Deliver

1. Deterministic attachment suggestions and Owner attach/reject/detach. Phone equality gives Likely, ambiguity blocks Lead-specific effects, reviewed history never overwritten.
2. Outreach ensure/official closure, inbound-human/outbound-attempt transitions, multiple independent actions, nullable dates, completion/rescheduling, customer waits, clock and Attention derivation. Official closure must win during identity resolution.
3. Separate overall/action responsibility, first clear rep assignment, promising rep action ownership, Owner field precedence and append-only audit. Never mutate receiver Agent or Booking allocations.
4. Owner mark worked, date/action/assignment/wait, note, close/reopen, restriction and review-resolution commands. Immediate corrections must be callable by D's review routes; do not defer them to AI.
5. Effective-dated reviewed Rep Identity Links/backfill proposals. Explicit Owner nudge preview/send/repair only, with rep/customer destination guards. E owns dialogs, C owns server behavior.
6. Read DTOs and meaningful Vantage-event fingerprints. Export the effect-planning/application primitives D uses so model submission does not become a second implementation of business rules.

## File ownership

Main-server `salesIntelligence/attachment/**`, `outreach/**`, `followups/**`, `review/**`, `repIdentity/**`, `nudges/**`, staffing/policy services, operational read services and tests. Coordinate schemas/routes through A. D owns agent orchestration and evidence storage; E owns presentation.

## Proof and handoff

Pin 30/15 staffed-minute deadlines and 2-sales-day clock; default schedule/DST/day-only/outside-hours dates. Test multi-action wait coexistence, undated action, specific completion only, Alex/Jordan/Casey ownership, Owner corrections under races, permanent suppression versus temporary channel pause, closed-work new requests and duplicate missed calls. Handoff command/derive fixtures to D/E and browser-ready endpoints to E. No routine call or note sends messages.

## Kickoff prompt

> Implement Team C's identity, Outreach and Owner-command work from the revised contract. Keep multiple and undated follow-ups first-class; honor Owner overrides and separate action/overall ownership. Export one authoritative application path for Team D and DTOs for E. Prove chronology, clock, closure and revision behavior with meaningful tests. Do not implement model reasoning or send live rep messages as a test side effect.

## September 17 codebase alignment

[Audit and required adaptations](../../11-codebase-alignment-audit.md) are part of this delivery contract. Complete the rows assigned to this team and provide integration evidence; current runtime helpers do not already satisfy the revised contracts. [Design intake](../../07-claude-design-brief.md) governs the forthcoming Claude artifact; its arrival is not assumed.
