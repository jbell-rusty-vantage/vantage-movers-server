# Validation and acceptance evidence

Packet-only check (no dependency install, DB, credentials or external I/O): `node docs/sales-outreach-desk/validate.mjs` from either repo. It validates local operative links, release hashes, fixtures and safety defaults. Sources are historical snapshots; their original internal links are not asserted portable entry points.

Preparation did not alter runtime code, so feature/replica/browser tests are future implementation gates, not claimed passed. Each team records exact command, target, exit/result, fixture version, skipped tests and artifact. Required skipped tests block acceptance; legacy FIXTURES_UNAVAILABLE is not a pass. Do not run migration/replica scripts just because they exist.

Server implementation checks: `pnpm typecheck`, `pnpm lint`, `pnpm test`. Focus changes on outreach/outreachIntelligence, Granot outreach wake, rep scope/auth/transactions/settings and provider capture tests. Add meaningful interface tests for approved calendar slots, New/Quoted transition/late corrections, versioned controls, current-assignment denial and deterministic replay. Run `pnpm finish-work --provider codex` at meaningful implementation boundaries as repository guidance requires; record exact status and any missing CLI/auth prerequisites. Documentation-only packet preparation uses its own checker and independent review; it does not launch an editing quality pipeline over concurrent code.

Admin implementation checks: `pnpm typecheck`, `pnpm lint`, `pnpm test`, `pnpm build`. Focus server/auth authorization/repDenyByDefault/proxy signing, live, URL state, rep scope, contract and outreach-shell tests. Read installed Next docs before Next code edits. Local Zod schemas/mock response fixtures must correspond to CONTRACTS.md sod-v1.

Cloud runtime: follow server CLOUD_AGENTS.md; use `.cursor/scripts/start-api.sh` and approved local replica set, not raw pnpm dev with injected Atlas environment. Verify /db host 127.0.0.1 and name testvantagemovers before synthetic operations; ensure provider/sheet writes off. Use cloud secret mechanism for actual bootstrap credentials, never packet files. Set DOTENV_CONFIG_PATH to an approved nonexistent local path for pinned isolated tests when crmConfig dotenv import would load real .env. These existing isolation/bootstrap settings are not outreach operational controls. Admin connects only to approved isolated API and synthetic sessions.

Required integrated matrix is SPECIFICATION.md Section 21 plus:

- two server instances observe latest config after reload, missed SSE invalidation/refetch, invalid/dangling config and pause during batch.
- former Rep direct detail/activity and live stream denied after reassignment; historic involvement/shared phone not scope; generic Admin denied; BFF and server agree on new prefix.
- goal excludes inbound/SMS/unassociated/other-workflow calls; initiating rep once; counts can decrease after corrected identity/status; 108/100 remains visible.
- independently missing Call/SMS, mailbox gaps, late send/status correction, fixed SMS extra-event behavior, calendar/DST/midnight and partial cutover.
- old planners/AI/media disabled or fenced while capture/restriction/closure recovery continues; no sends as a consequence of GET/migration/evaluation.
- scoped paging/sorts over >100 synthetic rows, cursor invalidation, unknown values, focus/keyboard/mobile and last-good authorized data behavior.
- Daily Operations live/rebuild parity and revision-race correction; existing board refresh contract preserved.
- S5/S6 all replay/crash/CAS/partition/credit/catch-up/readiness gates and S7 rollback rehearsal.

Latency objectives remain provisional: evidence commit-to-browser p95 <=10s; hangup-to-confirmed goal p95 <=3min (provider settlement); available SMS notification-to-visible p95 <=60s; missed webhook recovery <=10min under admitted capacity. Record p50/p95/max, source availability/quota waits and source/projection revisions. Synthetic timing cannot certify production access/latency.
