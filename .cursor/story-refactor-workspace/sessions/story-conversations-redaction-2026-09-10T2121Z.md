# Session story-conversations-redaction-2026-09-10T2121Z

- Date (UTC): 2026-09-10
- Service / module: `conversations` / `redaction.ts`
- Lock: taken
- Branch / PR: `docs/story-refactor` / https://github.com/jbell-rusty-vantage/vantage-movers-server/pull/206

## Stock at start

- Wave: A
- Visited / in-progress / unvisited: 38 / 1 / 3
- Recommendations on disk: 297 (through `conversations-reads.md`)
- Current service / next module (TRAVERSAL): `conversations` (in-progress) / `redaction.ts`

## This pass

- opened new service?: no
- path or skip: recommended → `recommendations/conversations-redaction.md`
- operations named: strip the card, the CVV, the expiry, the SSN, the routing number, and the email from the spoken transcript before anyone writes Mongo (Luhn cards and labeled tokens only)
- remaining in this service: `media.ts`, `seedFromArtifacts.ts`

## Stock at end

- Visited / in-progress / unvisited: 38 / 1 / 3
- Current service / next module: `conversations` (in-progress) / `media.ts`

## Messages posted

- 2026-09-10T2121Z next

## Ideas parked

- Spec §7.3 account-number target and §7.3.4 “no verbatim transcript when redactions > 0” stay parked — do not implement in the rename
- Rows 40–42 (`extensionUsers`, `jobNumberTimeline`, `tariff`) stay unvisited until `conversations` is visited
- Disk also has unlisted `dailyOperations`; do not open it while `conversations` is in-progress

## Contradictions

- Spec §7.3 lists routing / account numbers; this file only does labeled 9-digit routing
- Email is tested and is not on the PCI list
- CVV / expiry / routing use a label, not card-span proximity; SSN requires dashes
- `luhnValid` is a leftover test leak
- `buildSeededSummary` does not **ask** this file; no live summarizer yet
- Operator seed leftover digit refuse can false-trigger on a Luhn-fail run
- Knowledge links [Lead Conversation](CONTEXT.md); this checkout’s `CONTEXT.md` does not define it; `docs/adr/` is absent
