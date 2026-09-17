# 07 — Claude design intake and UI integration

Status: current design integration contract, September 17, 2026. The forthcoming Claude artifact does **not exist yet**. It will supply components, explanations and styling based on these specifications. No visual parity or artifact review is claimed.

## Authority

[01](01-specification.md) defines product behavior; [04](04-server-routes.md) defines server DTOs/commands; [05](05-owner-dashboard-ux.md) defines Owner interaction; [10](10-intelligence-agent-contract.md) defines model output and intervention. Design layers presentation onto those features. It does not add a second state machine, change permissions, or restore an Owner acceptance gate before AI effects.

The former brief is preserved as superseded historical evidence at `history/07-claude-design-brief-superseded.md`. Do not use its routes, fixture assumptions or behavioral instructions for implementation. [08](08-intelligence-envelope-handoff.md) is also historical.

## Required presentation coverage

- Attention, Numbers/Search, Reps and Coverage inside the existing Owner dashboard shell.
- Seven Attention categories plus Needs review, one row per subject, all secondary reasons and blocked/closed review-only cases.
- Multiple independent follow-ups, optional dates, original deadline versus snooze, overall owner versus action owner versus factual promising rep.
- Exact call outcomes, voicemail/unknown contact, attribution certainty, official record links and honest history coverage.
- Versioned assertions, typed evidence, applied/blocked effects, immediate Owner correction, confirmation without duplicate effects, and Agrees/Disagrees/Cannot determine beside each exact Owner instruction.
- Explicit preview/send to a reviewed rep, with queued/sent/failed/unknown states; no automated send.
- Budget pause at editable $80/month, recording gaps, jobs and settings, with operational work remaining available.

## Integrating the future artifact

Team E inventories supplied components against [05](05-owner-dashboard-ux.md) and records missing states in its handoff. Reuse existing dashboard components and official workflow helpers. Bind to shared server DTOs and legal-action flags; mock data is a development fixture, never a business-rule implementation. Keep the fixed Current records scope and Owner authorization from 04. Adapt latest-only conversation UI for exact historical evidence and remove demo replay copy from live views.

Record the received artifact's path/version, component-to-feature mapping, intentional presentation adjustments, accessibility/narrow-layout checks and unresolved design gaps in workspace evidence. If a design conflicts with this pack, implement the specified behavior and flag the visual mismatch. Do not mark design integration complete until the actual artifact has been received and inspected.
