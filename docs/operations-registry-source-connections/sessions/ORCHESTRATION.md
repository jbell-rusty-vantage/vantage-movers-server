# Orchestration session — Operations Registry source connections

Started 2026-09-01 on branch `operations-registry-source-connections` in `vantage-main-server`. Admin work waits until ORS-4.

## Owner emphasis (does not add spec semantics)

The specification already says Lead Source + Granot name are one flow. The Owner asked the implementers to keep that front and center:

- A Granot CRM Source is what lets the browser extension and automation know which source companies exist.
- `create_if_missing` is the ingest path for partners whose leads are born in Granot, not on a WordPress form or a RingCentral queue. That is also the only policy that may text the customer.
- The Lead Source / Feed connection on the Granot name is how create-if-missing writes `lead_source_company` and `source_granularity_id` on the new Lead. Do not make the Owner invent that join.
- Reduce Owner complexity: one wizard, two commit points, skippable Granot step, go-live as a persistent checklist.
- RingCentral inbound queue numbers: validate the number, but make the Lead Source → Feed filing target obvious. Nickname never decides attribution.

ORS-1 and ORS-2 stay in their issue scopes. This emphasis lands in ORS-3 (atomic setup + projection) and ORS-4 (wizard + inbound editor).

## Sequence

1. ORS-1 — complete. Report: `reports/ORS-1-completion.md`
2. ORS-2 — complete. Report: `reports/ORS-2-completion.md`
3. ORS-3 — complete. Report: `reports/ORS-3-completion.md`
4. ORS-4 — complete. Report: `reports/ORS-4-completion.md`
5. docs-keeper — Service + owning rules updated 2026-09-01

Closed on both `operations-registry-source-connections` branches. Browser verification: `sessions/VERIFICATION.md`. No commit authorized. §9.8 removals remain out of pack. Observation window opened 2026-09-01.

Each pass writes `sessions/ORS-n-process.md` (running notes) and `reports/ORS-n-completion.md` (handoff). `PROGRESS.md` is the ledger.

## Standing rules

- Specification wins on every conflict.
- No commit, push, production deploy, SMS activation, live payload read, or external send.
- Do not delete static maps, embedded `granularities[]`, or indexes.
- Database terms stay `source_company` / `source_granularity`. Owner surfaces say Lead source / Feed.
- Never write "Granot label" unqualified.
