# DOP-09 browser walk — Arrivals on Owner `/daily`

Date **2026-09-08**. Local Admin `http://localhost:3000`, API
`http://localhost:3001`. Already signed in as Owner — no re-login.
Quiet priorities was already on (`?quiet_priorities=1`, control
pressed). **Not complete.** No commit. §10 boxes left unchecked. No
completion report. No credentials. No live customer PII.

## Day state

The local America/New_York day was **empty** at the start of this
walk (tiles 0, Arrivals empty copy). One synthetic Form Lead was
created through Owner **Manual → Create a Lead** (name Arrivals Walk,
phone last-four 0999, pickup 33101, delivery 33009, Studio, first
listed Source Company: Best Relocation Forms). Granot send left
unchecked. Hide from Master Leads was already on and left on. Manual
returned **View lead** and reset the form.

## Band order (default `/daily`)

Five bands, top to bottom, in one `daily-shell` column:

1. Chrome — sidebar (Daily Operations current) + header (Tue, Sep 8 ·
   America/New_York, ● Live).
2. Headline tiles — **How the day is going**.
3. Origins + Source Company mix.
4. **Arrivals** — `data-band="arrivals"`, heading Arrivals. Sits
   after the mix, before the panel grid. Not under the tiles. Not
   below the panels.
5. Category panels — heading **Panels**, then Leads / Texts / Granot /
   Intakes / Bookings / Cancellations / Exceptions.

Only Arrivals carries `data-band`. Sibling order in the shell:
header → tiles section → mix grid → Arrivals section → Panels
section.

## Empty copy (before insert)

Arrivals: **Nothing has arrived yet today.**

Absent on `/daily` (body + controls):

- **Live facts** — none.
- **Confirm** — no Confirm control.
- **Daily View** — none.

## `?lane=text`

Navigated to `/daily?lane=text` (Quiet stayed on). Texts sent tile
pressed. Panel grid focused on **Texts** only. Arrivals stayed
visible between mix and Panels with the empty copy. Band was not
hidden and was not replaced by a Texts-only strip.

After the insert, a **full remount** of `?lane=text` first showed
Arrivals empty because the events query was lane-scoped. Coordinator
then changed hydration to always fetch `events("all")` / limit 80
(Load earlier stays lane-scoped). Re-walk remount
`/daily?lane=text&quiet_priorities=1`: Texts focused and empty;
Arrivals still showed **Form Lead created** / Arrivals Walk /
••0999. Tiles Leads 1. ● Live. `?lane=` no longer hides Arrivals
on remount.

## `?company=`

Before the insert, every company row was 0 and there were no cards.
Clicking **main site** on the empty board did not write `company=`
(overlay / no navigation). Direct URL
`/daily?company=main_site&quiet_priorities=1` pressed the main site
row; Arrivals stayed empty (honest — no cards to filter).

After the insert:

- `?company=best_relocation_leads` — Best Relocation row pressed;
  Arrivals kept the Form Lead card (title + last-four 0999).
- `?company=main_site` — main site pressed; Arrivals returned to
  **Nothing has arrived yet today.** Tiles still showed Leads 1.
  Company filter applied.

## Insert walk

`/daily?quiet_priorities=1` stayed open in tab 0 (● Live, EventSource
already connected). Manual Create a Lead ran in a second tab. After
submit, switched back to `/daily` **without a reload**.

Arrivals (no remount):

- Title: **Form Lead created**
- Line: **Arrivals Walk · ••0999 · Best Relocation Leads · Vantage Admin**
- Stamp: **Just now**
- Chip: local
- Links: Open lead, Open list
- Residual pale amber still on the card when the daily tab was
  selected. The 1.5s slide-in **start** was not watched — the SSE
  merge happened while this agent was on Manual. Highlight classes
  were already gone by CDP inspect.

Tiles ticked live (no refresh): Leads **1** with session **+ 1**;
Form / Call **1 / 0** with **+ 1**. Best Relocation Leads mix **1**.
Leads panel showed the same card with clock stamp **9:04 AM**.

After a later remount of `/daily`, the Arrivals card was still there
with **9:04 AM**. Hydration did **not** replay Just now or the
amber highlight.

## Confirm / Live facts

Confirm absent on `/daily` before and after the insert. "Live facts"
absent. No Daily View copy.

## Gaps

- Slide-in start (1.5s) not seen live; residual amber + Just now
  seen after tab switch. Remount does not replay highlight — honest.
- `?lane=text` remount is fixed: all-lanes hydration keeps the Lead
  card in Arrivals while Texts stays empty.
- Company row click on the empty board did not set `?company=`; URL
  navigation did.
- Next.js hydration overlay on `app\(dashboard)\layout.tsx` appeared
  on `/daily` and `/manual` (did not block create).
- No Granot flood — Cancellation-stays-visible and the 20-card cap
  were not exercised in the browser.
- One EventSource was not counted in DevTools this walk (source-scan
  is in the implementation note).
- Issue not marked complete. No DOP-10.
