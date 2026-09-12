# Ideas

Park only. Never execute mid-run unless `NOW.md` says to.

- Do not copy Sheet Sync’s queued-only route fence onto `lead-messaging-cron.routes.ts`. Leftover inline `pending` and `retry_scheduled` still must drain. Disabled is Wave A `{ claimed: 0, outcomes: { disabled: 1 } }`, not HTTP `{ skipped: true }`.
- Extracting shared `requireCronAuth` across cron routers is a later pass with HTTP proofs on every sibling — not this rename.
- Snapshot cron HTTP proofs (flag-off / 200 / throw-letter) belong on `acceptThisRingCentralCronDesk`, not Wave A snapshot.
- Implementation passes are a later human request against a named `recommendations/<id>.md`. Do not invent that loop in this workspace.
- Wave B `routes/` is `visited` after `routes-granot-lifecycle-cron.md`. Next Wave B folder is `models/` — enumerate first. Do not open `validation/` while `models` is unvisited or in-progress.
- Wave B (`routes/`, `models/`, `validation/`, `config/domain/`, `middleware/`, `auth/`) starts only after every Wave A service is `visited`.
- Wave A tour rows 1–41 are `visited` (including leftover-root skip, `conversations`, `extensionUsers`, and `jobNumberTimeline`). Row 42 `tariff` is **unvisited** — enumerate first. Disk also has unlisted `dailyOperations` — do not open it while listed row 42 remains. Wave B stays locked.
- Search, browse, and facet folders are on the tour. Enumerate them; skip when they are already thin. Do not pull them forward ahead of the domain order.
