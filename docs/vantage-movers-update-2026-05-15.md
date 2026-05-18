# Vantage Movers Server — Status Update

**Date:** 15 May 2026  
**Scope:** Deployed platform, integrations, and planned work

---

## Summary

The Vantage Movers server is **deployed and operational**. It supports CRUD for form leads, call leads, booked leads, and cancelled leads, plus **sheet synchronization** and **CRM lead posting**. Companion pieces—a **Google Forms–driven** booking and cancellation workflow and a **browser extension** for Granot CRM table operations—are in place for owner use, with extension install targeted for the owner’s machine on Monday.

Until handoff, **Vercel, spreadsheets, Forms, and extension distribution** largely sit on **the developer’s accounts**. When the remaining work below is complete, a **full transfer and setup on the owner’s side** is required (see [Full owner transfer and setup](#5-full-owner-transfer-and-setup)).

---

## What Is Live Today

### API and data

- **Form leads, call leads, booked leads, cancelled leads:** Full CRUD is available through the server.
- **Sheet synchronization:** The system keeps master and company-specific sheets aligned with lead lifecycle changes (including paths from master leads → company leads → master booked, as flows complete).

### CRM posting (server-side, not WordPress webhooks)

- **CRM posting runs inside the API**, not via an advertiser-specific WordPress webhook.
- The **MongoDB document id** for the lead is sent as **`leadno`** in the integration payload. Granot maps that to their **`ref_no`** column on the row.
- **Important distinction — two different meanings of “ref” in the pipeline:**
  - **Form lead `ref_no` (advertiser):** This is the **GCLID** (or equivalent reference) supplied by the advertiser when a form lead is created. It is **not** the same as the CRM row identifier below.
  - **CRM `ref_no` (Granot column):** In Granot’s mapping, the request body’s **`leadno`** becomes the row’s **`ref_no`**, and **`ref_no`** ties to their internal **`row_no`**. For our posting flow, that value is now the **Mongo id of the lead** whose quoted field must be updated after the row exists.
- This end-to-end behavior is **facilitated by the browser extension** (table scan, row resolution, quoted-field updates, and calls into the API routes).

### Google Forms (booking and cancellation)

- **Dedicated Google Forms** exist for the **owner** for both **booking** and **cancellation** flows.
- Forms live in the configured account and are **functional**: they drive updates from a lead → **booked lead**, and from a booked lead → **cancelled lead**, and then propagate updates across sheets (**master leads → company-specific leads → master booked**), consistent with the intended sheet topology.

### Browser extension

- The extension **initiates a table scan** to locate a row and resolve **`ref_no` → Mongo id**.
- It **updates the lead’s quoted value** as required and **calls the appropriate server route**.
- The extension **runs locally** in **Chrome** and **Firefox**, has been **downloaded**, and is **ready for installation on the owner’s computer on Monday**.

---

## Work Remaining

### 1. Metrics, analytics, and dashboard

Use the **owner’s metrics and analytics requirements** to define **on-demand aggregations** over **dedicated collections**, **views**, or **both**. Then expose results either through:

- a **custom dashboard**, or  
- **Google Sheets / value insertion** into **Google Looker Studio (Data Studio)** or an equivalent viewer,

so the owner can inspect KPIs without ad-hoc queries.

### 2. Historical backfill (2025 onward)

- Perform a **complete backfill** of **all leads, booked leads, and cancelled leads** from the **start of 2025** forward.
- This needs a **robust mapping and validation** script (identity resolution, duplicate handling, sheet row alignment, and reconciliation with Mongo).
- Output must **sync cleanly to the new sheet structure** so production sheets and the database stay authoritative and consistent.

### 3. Google Sheets → system sync and integrity

- **Inbound sync from Google Sheets** is **rare** in practice but **possible**; define behavior when sheet edits occur outside the API.
- Evaluate **cron-driven periodic sheet updates** and **integrity scans** (drift detection, orphan rows, mismatched `ref_no` / ids, quoted fields vs server state).
- Document conflict rules (sheet wins, server wins, or manual queue).

### 4. API quality and load testing

- Build a **full Postman (or equivalent) collection** covering the public API surface.
- Run **edge cases**, **stress tests**, and **full end-to-end flows** against **local** and **production** environments, with results recorded for regression baseline.

### 5. Full owner transfer and setup

When the program above is **complete and stable**, execute a **full transfer and onboarding** so the owner owns every runtime dependency. Today these assets are tied to **current developer accounts**; the owner needs their own copies, access, and runbooks.

Planned handoff checklist:

- **Vercel:** Transfer or recreate the **Vercel project** (and team/org if used), **deployment configuration**, **environment variables**, **domains**, and **CI** so the owner can deploy and rotate secrets without developer-only access.
- **Spreadsheets:** Move or duplicate **Google Sheets** (masters, company tabs, booked views) into the **owner’s Google account** (or a dedicated org), re-wire **service accounts / Apps Script / API credentials** used by the server and forms, and verify **IDs and permissions** end-to-end.
- **Google Forms:** Recreate or **transfer ownership** of **booking** and **cancellation** forms so they live under the **owner’s account**, with **linked sheets** and triggers updated to the new spreadsheet destinations.
- **Browser extension:** Provide a repeatable **download / install / update** path for the owner (packaged build, store listing, or signed artifacts plus **Chrome** and **Firefox** install steps), and document **which API base URL** and auth the extension uses in production.

Treat this as a **single cutover or phased migration** with a rollback note (e.g. keep old sheets read-only until the owner signs off).

---

## Notes for Readers

- When reading **“ref_no”** in code or CRM docs, confirm **which system** defines it: **advertiser GCLID** on form ingestion vs **Granot column** populated from our **`leadno`** (Mongo id) for CRM row correlation and quote updates.

---

*This document reflects the state of the program as of the date above; implementation details may evolve in the repository and deployment configuration.*
