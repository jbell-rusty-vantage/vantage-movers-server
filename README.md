# Vantage Main Server

The backend for **Vantage Movers**: the system of record for sales opportunities, booked moves, and cancellations, and the API that landing pages, the admin dashboard, and the Granot browser extension use to work with that data.

Vantage Movers captures moving sales opportunities from partner source companies and from its own marketing, works them through quoting, records the sale when a move is booked, and reports what happened — what a lead cost, who closed it, and whether it later cancelled.

This server is where those facts live. Other tools read and write through it. Spreadsheets and the CRM follow the database; they are not the source of truth.

## What it is for

A typical opportunity looks like this:

1. Someone requests a quote on a partner landing page, or calls a campaign number.
2. That becomes a **Form Lead** or a **Call Lead**, attributed to a source company and a specific lead stream, with cost-per-lead recorded at intake.
3. Non-duplicate form leads can be posted into **Granot CRM** so the sales team can work the job there.
4. Later evidence from Granot — via the browser extension, approved automation, or inbound notifications — can enrich the lead or ask the owner to confirm a booking or cancellation.
5. When a move is sold, a **Booking** holds binder, deposit, merchant, and agent credit. If that sale is voided, a **Cancellation** records the refund and marks the related records.
6. **Sheet Sync** projects those changes into reporting workbooks. **Analytics** answers owner questions from the database, not from the sheets.

Duplicates are kept and reported rather than dropped, so partner spend can be reconciled. A form and a later call for the same household can be linked as a form-fill overlap without treating them as the same paid lead.

## Key services

Service notes live under [`docs/knowledge/`](docs/knowledge/). The groups below are the ones that define the product.

### Lead intake

| Service | Role |
| --- | --- |
| [Form Lead](docs/knowledge/services/form-lead.md) | Creates and updates quote-form opportunities: source attribution, local vs long-distance move type, duplicate detection, CRM posting, and reporting handoff. |
| [Call Lead](docs/knowledge/services/call-lead.md) | Creates and updates phone opportunities from admin entry or qualified inbound calls, including form-fill overlap with an existing form lead. |
| [RingCentral qualification](docs/knowledge/services/ringcentral-call-lead-qualification.md) | Decides which inbound calls become call leads, then promotes them through one shared ingest path (live notifications plus a call-log safety net). |

### Sales records

| Service | Role |
| --- | --- |
| [Bookings](docs/knowledge/services/bookings.md) | Records a confirmed sale — usually attached to the originating lead, sometimes leadless or a referral — and mirrors booked state back onto that lead. |
| [Cancellations](docs/knowledge/services/cancelled-lead.md) | Voids a booking once, snapshots what mattered at cancel time, and refreshes the related lead and reporting rows. |
| [Agent allocation](docs/knowledge/services/agent-allocation.md) | Splits binder credit across sales agents and stores that split on the booking so later agent renames do not rewrite history. |
| [Customers](docs/knowledge/services/customer.md) | Deduplicates the person or household being moved, separate from the lead (the opportunity) and the booking (the sale). |

### CRM and owner configuration

| Service | Role |
| --- | --- |
| [Operations Registry](docs/knowledge/services/operations-registry.md) | Owner-managed catalog of agents, merchants, sources, cost-per-lead periods, inbound phone routes, and Granot source policy. Runtime services resolve against this; they do not invent source identity. |
| [Catalog](docs/knowledge/services/catalog.md) | Read facade for agents and merchants. Changes go through the registry so they stay audited. |
| [Enrichment](docs/knowledge/services/enrichment.md) | Applies Granot follow-up details onto an existing call lead (job number, contact, move facts) without creating a new sale. |
| [Granot lifecycle](docs/knowledge/granot-lifecycle/processor.md) | Turns a Granot observation into a recorded decision: match or create a lead when policy allows, and open owner work items when a booking or release needs an explicit confirm. Observations are evidence; they do not silently rewrite official sale or refund amounts. |

Capture, identity, desired-state planning, and drain/retry sit beside the processor in [`docs/knowledge/granot-lifecycle/`](docs/knowledge/granot-lifecycle/).

### Reporting and finding records

| Service | Role |
| --- | --- |
| [Sheet Sync](docs/knowledge/services/sheet-sync.md) | After a save, queues the projection of leads, bookings, and cancellations into master reporting sheets. A successful API response does not mean the workbook has updated yet. |
| [Google Sheets](docs/knowledge/services/google-sheets.md) | Writes those projections to the right tabs. Partner workbooks derive from master; they are not written directly. |
| [Analytics](docs/knowledge/services/analytics.md) | Read-only business reports for the admin dashboard: lead cost, source performance, agent sales, and related views, computed from the database. |
| [Search and browse](docs/knowledge/services/admin-search.md) | Lets operators and the extension find leads and related records without treating search as a second source of truth. |

## How this repo fits the rest of the platform

- **Landing pages** submit quote forms that become form leads.
- **Admin dashboard** is where operators search, book, cancel, manage the catalog, and read analytics.
- **Granot browser extension** reads CRM pages and sends authorized updates back here.
- **Reporting sheets** are an eventually consistent view for the owner, not a second database.

Shared vocabulary for those ideas lives in the platform glossary (`CONTEXT.md` at the workspace root). This README does not redefine those terms.

## Further reading

- [`docs/knowledge/`](docs/knowledge/) — service and lifecycle notes
- [`docs/index.md`](docs/index.md) — catalog of those notes
- [`docs/knowledge/granot-lifecycle/spec-hub.md`](docs/knowledge/granot-lifecycle/spec-hub.md) — pointers to the locked Granot lead-lifecycle contract
