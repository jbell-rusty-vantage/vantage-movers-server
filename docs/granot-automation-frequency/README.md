# Granot update cadence and Outreach convergence

Owner-approved direction, November 4, 2026. Status: server patch implemented and locally tested; uncommitted, not deployed or capacity-qualified. Broad-suite limitations are recorded in the ledger.

1. [SPECIFICATION.md](SPECIFICATION.md) — accepted behavior, schedules, channel parity, no-op and Outreach contracts, timing limits and acceptance journeys.
2. [IMPLEMENTATION-PLAN.md](IMPLEMENTATION-PLAN.md) — bounded work for one agent session, exact module ownership, checks, deliverables and release handoff.
3. [LIVE-FINDINGS-2026-11-04.md](LIVE-FINDINGS-2026-11-04.md) — read-only inventory and the correction from the older checkout. Investigation evidence, not the implementation authority.
4. [IMPLEMENTATION-LEDGER.md](IMPLEMENTATION-LEDGER.md) — acceptance evidence, Mongo no-op protections, retained write volume and validation exceptions.
5. [RELEASE-HANDOFF.md](RELEASE-HANDOFF.md) — review identity, compatibility, live qualification and rollback.

Goal: shorten the delay between an observed Granot change and correct existing Lead/Desk state, without creating Calls, double billing Form/Call pairs, restarting unchanged cadence, or judging missing RingCentral evidence prematurely. The patch closes schedule/freshness defects and two verified pair-propagation seams. Deployment and measured live convergence/storage capacity remain the next proof. It does not rerun the completed November 1 reporting backfill or final Best Relocation import.

The packet is based on integrated server `d63e512d`, including the Call policy/convergence work in `190be6fa`. Reverify HEAD and existing work before implementation; production deployment is a separate fact. Both earlier checkouts use `jbell-rusty-vantage/vantage-movers-server`.
