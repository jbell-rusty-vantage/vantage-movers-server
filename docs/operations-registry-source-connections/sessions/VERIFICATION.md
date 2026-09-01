# Browser verification — 2026-09-01

Parent orchestrator, after ORS-4 close. Local admin at `http://localhost:3001` signed in as the seed Owner. Database scope: Production. Admin `VANTAGE_API_BASE_URL` points at the production API, so new server routes are not on that host yet.

## Walked

- Overview: tabs are Lead sources, Granot names, Inbound numbers, Lead costs. Registry Health shows the old-static-list observation window opened 1 Sept 2026.
- Lead sources: **New lead source** opens the wizard. Step 1 copy is “Who sends you these leads?” with the Vantage Movers helper. Continue stays disabled until a name is entered.
- Granot names: existing names list; editor says one name lands in one lead source and one feed; texts say Vantage Movers; destination is a Lead source + Feed pick, not a raw id.
- Inbound numbers: five live routes. Nickname helper says it does not decide filing. Connection card is “Calls to this number are filed under {Lead source} → {Feed}”.

## Fix during verification

Production RingCentral DTOs do not yet carry `lead_source_name` / `feed_display_name`. The first paint showed “Not filed yet” and a raw company ObjectId.

Admin now joins those labels from the already-loaded Lead source and Feed catalogs. ObjectIds are never shown as names. The Lead source is taken from the feed’s parent when the stored assignment company disagrees.

On production data, `+18883164387` (nickname “10best Inbounds”) files under **TBM Leads → 10best Inbounds**. That is the stored Feed parent, not the nickname.

HTML 404 bodies from missing new routes are stripped in `formatRegistryError` so the Owner does not see a dumped error page.

## Not exercised against production

- `GET /api/v1/admin/operations-registry/lead-sources` — 404 on the connected server. The new list and **Save as draft** need this branch deployed or admin pointed at a local server running it.
- Setup preview/commit, readiness checklist mutations, and Owner Granot create POST.

## Honest remainder

- §9.7 observation window is open (started 2026-09-01), not closed.
- §9.8 removals stay out of pack.
- Wizard is single-feed. Extra feeds still come after the draft.
- No commit authorized.
