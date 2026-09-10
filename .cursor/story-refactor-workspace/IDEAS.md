# Ideas

Park only. Never execute mid-run unless `NOW.md` says to.

- Implementation passes are a later human request against a named `recommendations/<id>.md`. Do not invent that loop in this workspace.
- Wave B (`routes/`, `models/`, `validation/`, `config/domain/`, `middleware/`, `auth/`) starts only after every Wave A service is `visited`.
- Wave A tour rows 1–38 are `visited` (including leftover-root skip). Row 39 `conversations` is in-progress (`reads.ts` + `redaction.ts` recommended; next `media.ts`). Rows 40–42 (`extensionUsers`, `jobNumberTimeline`, `tariff`) stay unvisited until `conversations` is visited. Do not jump an in-progress checklist.
- Search, browse, and facet folders are on the tour. Enumerate them; skip when they are already thin. Do not pull them forward ahead of the domain order.
