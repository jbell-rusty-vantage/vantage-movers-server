# Vantage Movers Platform

Vantage Movers captures moving sales opportunities from partner source companies, tracks them through quoting and booking, and reports outcomes to the owner. This glossary is shared across all Vantage codebases.

## Language

### Leads

**Lead**:
An inbound sales opportunity before or independent of a confirmed sale. Every lead is either a Form Lead or a Call Lead.
_Avoid_: Using "lead" for a Booking or Cancellation.

**Form Lead**:
A lead created when a visitor submits the quote form on a Landing Page. Created via Form Lead Ingestion. A Form Lead is a **Duplicate Lead** when the same Source Granularity already has an eligible non-duplicate Form Lead with the same phone number or email.
_Avoid_: Website lead, form submission (when referring to the domain record), WordPress Form Submission Receipt

**Form Lead Ingestion**:
Creating a Form Lead when a landing page submits the quote form to the main server. Includes duplicate detection, move type derivation, Mongo persist, and post-save workflows (CRM Posting when enabled, Sheet Sync). Distinct from Form Lead Enrichment (Granot → MongoDB via extension).
_Avoid_: Form submit, webhook (when meaning the domain record lifecycle)

**WordPress Form Submission Receipt**:
A durable, independent WordPress form-submission ingress fact. It is not a Lead and not a Granot Observation Receipt.
_Avoid_: Form Lead, Granot Observation Receipt, WordPress receipt (when meaning Granot transport evidence)

**Call Lead**:
A lead created when a visitor calls through a source company's phone campaign. Created via Call Lead Ingestion after Call Qualification. A Call Lead is a **Duplicate Lead** when the same Source Granularity and phone number already produced an eligible non-duplicate Call Lead within the duplicate window.
_Avoid_: Phone lead, inbound call (when referring to the domain record)

**Call Qualification**:
The rules that decide whether an inbound Ring Central call becomes a Call Lead. A qualified call is inbound to a mapped source-company number, answered, at least 120 seconds, and has a caller phone. Unqualified calls are ignored for lead creation.
_Avoid_: Call vetting (implementation term), qualified call (use as adjective, not the process name)

**Call Lead Ingestion**:
Creating a Call Lead from a qualified inbound Ring Central call. Runs via webhook (real-time) or scheduled Call Log sync (polling safety net); same qualification rules and idempotent ingest. Distinct from Call Lead Enrichment (Granot → MongoDB via extension).
_Avoid_: RingCentral webhook, call log cron (implementation paths)

**Source Company**:
The company-level lead-attribution owner, usually a lead-buying partner such as Top10 or TBM. A Source Company contains one or more Source Granularities.
_Avoid_: Partner (when Main Site applies), advertiser (when referring to lead attribution)

**Source Granularity**:
The exact lead stream within a Source Company used for duplicate classification and granular attribution, such as a particular form or inbound-call stream. Duplicate Leads never match across Source Granularities.
_Avoid_: Source Company (when the specific lead stream matters), source label

**Source Label Mapping**:
An explicit reviewed connection from an external sheet or legacy source label to one exact Source Granularity and its Source Company. The external label is evidence, while the mapped Source Granularity is the canonical attribution identity.
_Avoid_: Alias (when the label's external namespace and reviewed destination matter), Source Company mapping

**Granot CRM Source**:
The exact incoming source name Granot sends to Vantage, connected to a reviewed Source Company and normally one exact Source Granularity, together with its lead-creation behavior and optional confirmation-text settings. A reviewed source may select between local and long-distance Source Granularities when Granot sends one shared name for both.
_Avoid_: Granot label (unqualified), Source Granularity CRM label

**Single-Feed Source Company**:
A Source Company whose traffic belongs to one channel and one Source Granularity, even when the Owner experiences it as a single unsplit source. Paid Overflow is the canonical example.
_Avoid_: Source Company without granularities, unscoped source

**RingCentral Inbound Number**:
A RingCentral phone number that is effective-dated to one call Source Granularity and its Source Company for inbound Call Lead attribution. Its display nickname is descriptive only and never controls attribution.
_Avoid_: RingCentral route (in Owner-facing language), display label (when meaning attribution)

**Historical Source Label**:
The exact legacy text recorded in the Booked Deals `Lead Source` field. It is source evidence that must be explicitly mapped to a Source Company and exact Source Granularity, or classified as a Referral Booking; the label alone is not a canonical catalog identity.
_Avoid_: Source Company or Source Granularity (until an explicit reviewed mapping exists)

**Main Site**:
The Source Company for Vantage's own traffic — organic search and in-house digital marketing, not a paid partner campaign. CPL is zero. A dedicated domain and Next.js site for Main Site are planned but not yet live; until then Main Site leads use the same ingestion path with `main_site` attribution.
_Avoid_: Partner landing page, main website (unqualified)

**Paid Overflow**:
The Source Company for purchased overflow leads that have no dedicated partner sheet. One Source Granularity and one Granot CRM Source share this name. Leads write only to the Master Sheets, with no Forms versus Inbounds split.
_Avoid_: PaidOverflow, overflow (unqualified)

**Duplicate Lead**:
Two leads that are effectively the same opportunity within one Source Granularity and should only be paid for once. Form Leads and Call Leads have different eligibility and time rules; duplicates are still saved and reported rather than silently dropped.
_Avoid_: Repeat lead, double lead

**Form Fill**:
A Call Lead flagged because a non-duplicate Form Lead already exists for the same Source Company and phone number — the caller had previously submitted the quote form before or after calling. Used for advertiser spend attribution so the owner can see when a phone lead also had a matching form submission. When a new non-duplicate Form Lead arrives, matching Call Leads for the same source company and phone are also marked as form fill.
_Avoid_: Duplicate (form fill is attribution overlap, not a duplicate payment flag)

**Bad Lead**:
A Form Lead the owner has disqualified as not viable, with a specific reason (disconnected number, bad contact info, auto-only move, or international move). Distinct from a Duplicate Lead — bad means the lead itself is unusable, not that it was already paid for. Cannot be marked bad if already duplicate, booked, or cancelled. See **Bad Call** for the planned call-lead equivalent.
_Avoid_: Duplicate, cancelled, bad call (when meaning the planned call-lead concept)

**Bad Call** (planned — not implemented):
The intended call-lead equivalent of Bad Lead — a Call Lead the owner would disqualify as not viable. The Reporting Sheets Bad Calls tab name exists in configuration, but there is no domain model, admin workflow, API, or complete implementation plan yet. Do not assume Bad Lead rules, reasons, or mark-bad behavior apply to call leads until this is built.
_Avoid_: Bad Lead (form leads only today), duplicate call, bad call (as if the workflow already exists)

**Move Type**:
Whether a move is a Local Move or a Long Distance Move. Derived from pickup and delivery state — same state is local, different states is long distance. On a Form Lead, if pickup or delivery state is unknown (`not_found`), Move Type is Local Move. Set at Form Lead ingestion from zip/state lookup. Drives CPL, reporting, and Granot CRM source labels. On Call Leads, move type may be unknown until CRM enrichment via the browser extension.
_Avoid_: Local type, intrastate, interstate, LD

**Local Move**:
A move where pickup and delivery are in the same state. On a Form Lead, also when either state is unknown (`not_found`).
_Avoid_: Local, intrastate

**Long Distance Move**:
A move where pickup and delivery are in different states.
_Avoid_: Long distance (unqualified — use as move type label), LD, interstate

**Unmatched Call Lead**:
A Call Lead created only to anchor a Booking when no existing call lead matched by job number or phone at booking time. Exists in the database but is excluded from call-lead sheet reporting and lead-cost analytics so the owner does not see a misleading extra row. The Booking still syncs normally. May be resolved later via browser extension enrichment or manual correction.
_Avoid_: Stub call, orphan call lead, internal call, No-Sync Lead

**No-Sync Lead**:
A Form Lead or Call Lead the Owner keeps off the Forms and Calls tabs on Master Leads. The Lead stays in Mongo, keeps Ingestion Origin, and may still attach to a Booking; Master Booked still writes. Duplicate Lead and Bad Lead sheet routing is unchanged. Stored as `no_sync`. Distinct from an Unmatched Call Lead.
_Avoid_: Unmatched Call Lead, created_on_unmatched, silent lead, hidden lead

**Enrichment**:
Updating an existing Form Lead or Call Lead with data read from a Granot CRM row via the browser extension. Distinct from initial lead ingestion (form submit or Ring Central call create) and distinct from booking. The extension runs preview then sync for each workflow.
_Avoid_: Sync (sheet sync is separate), CRM update, extension update

**Form Lead Enrichment**:
Enrichment workflow for Form Leads on Granot Follow Up Estimates pages. Updates authorized current Lead facts after matching by Granot Record Link, exact Granot Form Reference, Mongo Lead ID compatibility, or Source Scope-scoped contact evidence.
_Avoid_: Form sync, quote update

**Call Lead Enrichment**:
Enrichment workflow for Call Leads on Granot Follow Up Estimates pages. Updates job number, customer details, zips, cubic feet, and move type on a matching Call Lead. Matching uses job number first, then phone number. May run before or after booking.
_Avoid_: Call sync, CRM backfill

**Job Number**:
The Granot-assigned identifier for a move job. After Call Lead Enrichment it is the primary match key, and it stays constant across multiple Granot Booked and Release actions so Vantage keeps at most one Booking per normalized Job Number; before enrichment, Caller Match Key (source company + phone) is primary.
_Avoid_: Job no, job ID, move number

**Booked** (lead status):
A Form Lead or Call Lead that has an attached Booking. The lead remains a Form Lead or Call Lead — it is not a separate kind of record. Sale details (binder, agents, deposit) live on the Booking.
_Avoid_: Booked lead (as a noun for the source record in domain language)

**Cancelled** (lead status):
A Form Lead or Call Lead whose attached Booking has been cancelled. The lead remains a Form Lead or Call Lead. Refund and cancellation details live on the Cancellation record.
_Avoid_: Cancelled lead (as a noun for the source record in domain language)

**Lead Lifecycle**:
The state chain for a typical opportunity: a lead is ingested (Form Lead or Call Lead), may become Booked when a Booking is attached, and may become Cancelled when that booking is cancelled.
_Avoid_: Pipeline, funnel (when referring to this specific state chain)

**Ingestion Origin**:
The immutable, server-assigned workflow that first created a Lead, such as WordPress Form Ingestion, RingCentral, Granot Lead Created, Best Relocation Sheet, or Vantage Admin. Later evidence may add provenance but never rewrites the Lead's creation origin.
_Avoid_: Observation Channel, request source, client-supplied ingestion source

**Ingested Contact Snapshot**:
The immutable name, phone, and email captured when a Lead is first created. Later Granot evidence cannot overwrite it.
_Avoid_: original contact, submitted snapshot (when meaning this stored field)

**Granot Contact Snapshot**:
The latest qualified Granot name, phone, and email stored on a Lead after Priority 1 or 5 sync. On a WordPress-born Form Lead this is the only place Granot contact is written; live name, phone, and email stay as Form submitted.
_Avoid_: Granot contact (when the live fields are meant), CRM contact

**Form Submitted Contact**:
The name, phone, and email the customer typed on the Landing Page. On a WordPress-born Form Lead these stay on the live contact fields.
_Avoid_: original submission (as a field name)

**Lead Channel**:
Whether a lead arrived via form submission or inbound call within a Source Company (e.g. Top10 Forms vs Top10 Inbounds). Used with source company and move type to determine CPL.
_Avoid_: Lead type (ambiguous with Form Lead / Call Lead), source label (implementation term)

**CPL** (Cost Per Lead):
The amount paid for a Lead from one Source Granularity. The Owner sets it on a CPL Schedule. Each Lead stores a snapshot at ingestion for spend reporting. Duplicate Call Leads receive zero CPL. The Operations Registry Owner label is **Lead cost**; analytics may say lead cost. The stored field and domain term remain CPL.
_Avoid_: Partner fee (unqualified); inventing a second stored field named “lead cost”

**CPL Schedule**:
The time-ordered CPL amounts for one Source Granularity. The Owner sets an amount for inclusive New York business dates. Active schedules are continuous, non-overlapping, and end with one open-ended range. Editing the schedule never rewrites CPL already stamped on Leads.
_Avoid_: Rate card (unqualified); Legacy CPL (the read-only compatibility book)

**CPL Rate Period**:
One contiguous New York business-date range on a CPL Schedule at a single amount. Explicit zero is a valid amount. Missing coverage is not zero.
_Avoid_: Period ID as an Owner-facing identity

**CPL Correction**:
The Owner workflow that rewrites already-stamped Lead CPL snapshots so they match the current CPL Schedule for a chosen date window. Distinct from editing the schedule.
_Avoid_: Using “correction” for a schedule-only amount change

### Lead identity

**Lead ID**:
The permanent identifier for a Form Lead or Call Lead — the MongoDB `_id` assigned when the lead is first saved. The canonical key across MongoDB, reporting sheets ("Mongo ID"), admin search, and browser extension lookup. When the owner says "lead ID" or "Mongo ID," they mean this value.
_Avoid_: Ref no (without qualifying which ref — see Tracking Reference and Granot Form Reference)

**Tracking Reference**:
The source company's click identifier, passed on the landing page URL as `?ref_no=` and stored on the Form Lead. Used for partner attribution tracking and currently posted to Granot as `leadno`, where it appears as the Granot Form Reference.
_Avoid_: Lead ID, ref no (unqualified)

**Granot Form Reference**:
The value Granot exposes as `ref_no` for a Form Lead. Current CRM Posting sends the Form Lead's Tracking Reference as Granot `leadno`; legacy or externally created rows may instead contain a Mongo Lead ID, which is compatibility evidence rather than the current posting contract.
_Avoid_: CRM Lead Reference, Lead ID, ref no (unqualified)

**Caller Match Key**:
Source company + phone number. The practical identifier for finding or creating a Call Lead during Ring Central call-log ingestion, before job number or other CRM enrichment is available. Nearly as important as Lead ID for call-lead workflows.
_Avoid_: Call lead ID (when meaning Lead ID alone)

### Conversations

**Lead Conversation**:
The durable record of one telephone conversation matched to a Form Lead or a Call Lead, with its recording pointer, redacted transcript, and sectioned summary. It is evidence attached to the Lead, not a field on the Lead or the Booking.
_Avoid_: Call (when meaning this record), call summary, transcript record, conversation on the booking

**Conversation Match**:
How a Lead Conversation was attached to a Lead — telephony session, call log id, form-lead phone-and-time window, or owner attach.
_Avoid_: Call matching (ambiguous with Caller Match Key)

### Bookings

**Booking**:
A confirmed move sale — binder collected, move booked. Usually linked to the Form Lead or Call Lead that originated the opportunity; may also be recorded without a prior lead (leadless) or as a referral.
_Avoid_: Booked lead, deal, booked deal (in domain language — "BookedLead" remains the code model name)

**Employee Booking Submission**:
A simplified employee intake command that creates a Booking before asking the backend to connect it to a source Lead. Employees provide sale and familiar CRM details but do not choose a Lead kind or Mongo Lead ID.
_Avoid_: Employee booking (ambiguous with the resulting Booking), booked-lead form

**Precise Booking Form**:
The Owner `/bookings/new` command that creates a Booking from a selected Form Lead, a Call Lead Job Number, a Referral, or as a Leadless Booking.
_Avoid_: Booked-lead form (when the Owner desk is meant), Employee Booking Submission

**Exact Job Booking Attach**:
Automatic attach of a unique Form Lead or Call Lead whose Job Number equals the Booking Job Number. Phone, email, name, and LID never attach automatically on Employee Booking Submission or the Precise Booking Form.
_Avoid_: High-Confidence Booking Lead (that term is Confirm Granot Booking), phone match, channel_phone_exact

**Booking Lead Reconciliation**:
The owner workflow for connecting an already-created Booking to the correct existing or newly created source Lead when Employee Booking Submission or the Precise Booking Form could not attach one by Exact Job Booking Attach. Distinct from Connect Booking to Lead, which attaches a stored Lead to an already-official Granot Leadless Booking.
_Avoid_: Lead edit, booking approval, Granot reconciliation, Connect Booking to Lead

**Booking Lead Reconciliation Case**:
The durable owner work item created when a Booking needs Booking Lead Reconciliation. It records the submitted identity, matching evidence, current state, and resolution history while the Booking remains valid independently.
_Avoid_: Operational Incident, unmatched booking, reconciliation ticket

**Granot Booking Reconciliation Case**:
A durable owner work item created from an actual Booked or Release Granot Observation. It either supports creating a missing Booking or reviewing the one existing Booking for the Job Number; it never creates or updates a Booking without an explicit owner command. Repeated Booked and Release actions on the same Job Number append evidence to the same open case.
_Avoid_: Granot Booking Intake Case, Granot Booking Discrepancy, Booking Lead Reconciliation Case, Granot Cancellation Intake Case

**Booking Priority Pairing**:
The audit relationship on a Granot Booking Reconciliation Case between its creating Booked Observation and any Priority 5 Priority Update on the same Job Number. It never opens or refreshes the case.
_Avoid_: Priority 5 booking evidence, booking intake trigger

**Suggested Booking Lead**:
The highest-ranked eligible Form Lead or Call Lead proposed on a Granot Booking Reconciliation Case for owner convenience. The suggestion never attaches a Lead by itself; Confirm Granot Booking may attach a unique High-Confidence Booking Lead when the Owner submits without an explicit Lead.
_Avoid_: Matched Lead (suggestion is not authoritative), probable lead, auto-attached lead

**High-Confidence Booking Lead**:
A Suggested Booking Lead whose match method is Granot Record Link, exact Form identity, exact Call Job Number, or Booking-owner evidence. Source Scope contact matches are medium confidence and are never attached automatically.
_Avoid_: Matched Lead, probable lead, medium-confidence suggestion

**Confirm Granot Booking**:
The owner-authorized command that resolves a create-missing Granot Booking Reconciliation Case by supplying the official book date, Agents, Binder, Deposit, and Merchant required to create a Vantage Booking. A source Lead is attached when the Owner selects one or when a unique High-Confidence Booking Lead exists; otherwise the result is a Leadless Booking. Observed Granot estimate or payment values may be displayed as context but are never substituted for these official details.
_Avoid_: Accept webhook, approve lead, reconcile booking

**Connect Booking to Lead**:
The owner-authorized command that attaches one eligible stored Lead — a Lead that is not already part of a Booking — to an already-created Leadless Booking. It does not create a Lead or a Booking.
_Avoid_: Booking Lead Reconciliation, Confirm Granot Booking, attach existing (employee case action)

**Granot Reconciliation Notification**:
An optional delivery that points the owner to a newly opened Granot reconciliation case. The dashboard case is the work item; an email is only a deduplicated projection and is disabled by default.
_Avoid_: Granot Booking Reconciliation Case, Operational Incident, booking alert (unqualified)

**Leadless Booking**:
A Booking with no Form Lead or Call Lead attached. Used when a sale is recorded without an originating lead, including Confirm Granot Booking when the Owner does not select a Lead and no High-Confidence Booking Lead exists.
_Avoid_: Orphan booking

**Referral Booking**:
A booking flagged as originating from a referral rather than a standard source-company lead path.
_Avoid_: Referral lead

**Cancellation**:
The record of voiding a Booking. Attaches to the Booking and marks both the Booking and the source lead as cancelled. Holds refund amount, cancel date, and optional reason and notes. A booking cannot be cancelled twice.
_Avoid_: Cancelled lead (as the noun for this record in domain language)

**Binder**:
The commissionable sale amount on a Booking, allocated to one or more agents. When multiple agents are on a booking, the full binder is entered once and divided across their Agent Allocations.
_Avoid_: Deposit (binder and deposit are distinct amounts)

**Deposit**:
The customer deposit collected for the move on a Booking. Distinct from binder. Deposit thresholds drive over-2000 and over-4000 reporting flags on the booking and source lead.
_Avoid_: Binder, down payment (unless the owner uses that term consistently)

**Agent Allocation**:
The portion of a Booking's Binder assigned to one Agent. A Booking has one or more Agent Allocations; each records the Agent and that Agent's binder share.
_Avoid_: Split, commission row

**Agent**:
A salesperson on the owner's roster who can receive binder credit on bookings. Distinct from extension users and admin users — those are people who operate the tools, not necessarily agents on the roster.
_Avoid_: User, employee (when meaning sales agent on a booking)

**Active Agent**:
An agent currently eligible for selection on new bookings.
_Avoid_: Available agent, enabled agent

**Customer**:
The person or household being moved, derived and deduplicated from lead and booking contact information. Distinct from a Lead — a lead is an opportunity, a customer is the person. One customer may appear across multiple leads and bookings over time.
_Avoid_: Lead (when meaning the person), client, account

**Merchant**:
The payment processor or merchant account used to collect the customer deposit on a booking. A booking attribute, not a source company or agent.
_Avoid_: Vendor, payment method

**Active Merchant**:
A merchant currently eligible for selection on new bookings.
_Avoid_: Available merchant, enabled merchant

### Applications

**Landing Page**:
A partner-attributed Vantage quote-form page for a Source Company (Top10, TBM, etc.) — carries Tracking Reference (`?ref_no=`) and triggers Form Lead Ingestion on submit. Partner-facing URLs run on WordPress today. A Next.js client is deployed but not yet supplied to source companies as the official URL, so it is not integrated into full partner operations. Distinct from **Main Site** (Vantage's own traffic).
_Avoid_: Website (too broad), quote form (the form is on the page, not the page itself), Main Site

**Admin Dashboard**:
The internal web application (vantage-admin) where the owner and operators search leads, record bookings and cancellations, mark bad form leads, manage active agents and merchants, view analytics, and use Workflow Observational. Distinct from the Granot browser extension and from source-company landing pages.
_Avoid_: Admin (unqualified — may mean extension Owner role), back office

**Workflow Observational**:
The Admin Dashboard area for server workflow and integration health — operational events, incidents, operational reports, notification delivery, and sheet sync status. Monitoring of how the server and its integrations behave; not business analytics and not the lead/booking operational tables. Admin nav label is "Observational" (shorthand).
_Avoid_: Observational (unqualified — may include non-workflow UI later), Observability (implementation term)

**Daily Operations**:
The Owner-only Admin Dashboard workspace for the current New York business day's Lead, Granot webhook, Lead Message, intake, Booking, and Cancellation activity, plus running counts and pace versus yesterday and the day before at this hour. Shown as category panels on `/daily`, plus a complementary Arrivals rail of newest facts. Not tabs and not a mixed firehose as the only view.
_Avoid_: Daily View, Owner Daily, Live Events, Analytics, Workflow Observational, Overview

**Daily Operations Event**:
An Owner-facing fact that a counted business action occurred, shown on Daily Operations. Distinct from an Operational Event and from a Granot Observation Receipt.
_Avoid_: Operational Event, live receipt, server event, log entry

**Daily Operations Panel**:
A category stack on Daily Operations (Leads, Texts, Granot, Intakes, Bookings, Cancellations, Exceptions). One page, one live socket. Not a separate route and not a Live Events space.
_Avoid_: tab, live space, feed (when meaning the whole board), Arrivals (Arrivals is the complementary strip, not a panel)

**Arrivals**:
The complementary newest-first rail on Daily Operations of Daily Operations Events from every lane. Motion and presence on `/daily`. Not the default reading of the day and not Live Events.
_Avoid_: Live facts, event pipe, mixed feed (when meaning the whole board), live space, tab

### Services

**Sheet Sync**:
The asynchronous projection of leads, bookings, and cancellations from MongoDB into Reporting Sheets after a save or update. Sheet Sync writes directly to Master Sheets only; Source Company Sheets derive their rows from master via sheet import queries. Covers all reporting tabs and chain refreshes (forms, calls, duplicates, bad leads, booked, cancelled). MongoDB is authoritative; sheets are eventually consistent. A successful API response does not mean sheets are already updated.
_Avoid_: Google Sheets sync, sheet update (when meaning this pipeline)

**Booking Chain**:
A Sheet Sync operation that refreshes all Reporting Sheets rows tied to a Booking — the booking row plus the attached Form Lead or Call Lead on Master Booked and source tabs. Triggered when a booking is created or updated.
_Avoid_: Booking sync (ambiguous with the Booking record itself)

**Cancellation Chain**:
A Sheet Sync operation that refreshes booking, source lead, and Cancelled Deals rows when a Cancellation is recorded.
_Avoid_: Cancellation sync (ambiguous with the Cancellation record)

**Operational Event**:
A durable record that something significant happened in a server workflow — lead ingestion, CRM posting, sheet sync, Ring Central sync, Granot integration, or interaction with another external service. Browsable in Workflow Observational. Distinct from domain records (leads, bookings) and from infrastructure logs.
_Avoid_: Server event, log entry (when meaning this persisted audit stream)

**Operational Incident**:
A stateful issue record built from one or more Operational Events that needs attention — repeated CRM post failures, sheet sync backlog, Ring Central sync errors, etc. Deduped so the same failure pattern updates one open incident rather than creating many. Distinct from the underlying lead or booking.
_Avoid_: Alert (too generic), error (incidents can be warn-level groupings too)

**Analytics**:
Read-only business reporting computed from MongoDB over leads, bookings, and cancellations — lead cost, source performance, agent performance, revenue trends, etc. Served in the Admin Dashboard. MongoDB is the source; Reporting Sheets are not queried.
_Avoid_: Reports (too generic — Workflow Observational has operational reports too)

**Custom Sheet Report**:
An owner-requested Analytics view delivered as a new Google spreadsheet. The owner selects its time window, business slices, measures, detail columns, and ordering from supported choices. MongoDB is authoritative; the spreadsheet is an output, not a data source.
_Avoid_: Reporting Sheets (the continuously synchronized operational projection), CSV export (one possible file format, not the report)

**Report Definition**:
A reusable description of a Custom Sheet Report: what business facts to report, how to slice and measure them, which filters apply, and where the result should be delivered. It contains no report results.
_Avoid_: Report template (unless referring only to visual formatting), Mongo query

**Report Run**:
One resolved execution of a Report Definition for a specific time window, including its outcome and delivered spreadsheet. Later changes to the Report Definition do not change the meaning of an earlier Report Run.
_Avoid_: Sheet Sync Run (continuous Reporting Sheets projection), Operational Report Run

**Operational Report**:
A deterministic, server-defined summary of workflow and integration health — failures by workflow, sheet sync backlog, Ring Central status, notification delivery, etc. Generated and browsed in Workflow Observational. Distinct from Analytics (business metrics over leads and bookings).
_Avoid_: Report (unqualified), analytics report

**Owner Notification**:
An email to the owner (or configured recipients) about server workflow health — incident alerts, critical event notices, digests, etc. Triggered by Operational Incidents and reportable Operational Events.
_Avoid_: Alert email, notification (unqualified)

**Notification Delivery**:
The persisted record of an Owner Notification send attempt — status, recipient, purpose, provider outcome, and retries. Browsed in Workflow Observational.
_Avoid_: Email log, notification record

### Extension

**Extension User**:
A person authenticated to use the Granot browser extension, holding one or more extension roles. Access is the union of those roles. Distinct from an Agent on the sales roster and from admin dashboard operators.
_Avoid_: User (unqualified), agent (when meaning extension login)

**Owner** (extension role):
An extension role with full extension access — Enrichment, search, CSV, automation, debug, Binding Estimate Fee, and Tariff Adjustment. An Extension User who holds Owner already has every other role's access.
_Avoid_: Admin (when meaning extension role — use Owner; admin dashboard is separate)

**Sales** (extension role):
An extension role limited to Binding Estimate Fee. Cannot call the Vantage server. Cannot use Owner Enrichment, search, CSV, automation, debug, or Tariff Adjustment. May be held together with Customer Service.
_Avoid_: Employee (when meaning this role), staff user

**Customer Service** (extension role):
An extension role limited to Tariff Adjustment. May call the Vantage server only for Tariff Adjustment Submit. Cannot use Owner Enrichment, search, CSV, automation, debug, or Binding Estimate Fee. May be held together with Sales.
_Avoid_: Employee (when meaning this role), CS, support

**Employee** (retired extension role):
A leftover single role that meant Binding Estimate Fee and Tariff Adjustment together. Existing leftover Employee logins are migrated to Sales and Customer Service. Not a current role.
_Avoid_: Creating Employee logins, treating Employee as a live role

**Binding Estimate Fee**:
A client-side Granot CRM calculator in the extension. Computes binding estimate fees on the page without sending data to the Vantage server.
_Avoid_: Enrichment (enrichment updates MongoDB via the server), Tariff Adjustment Submit

**Tariff Adjustment**:
One append-only spreadsheet row for a Granot Forms View tariff change. Each submit writes the Linehaul row plus one row per filled Others or Extra line. Those rows share date, zones, and Carrier. On Others/Extra rows, Service and Rule are owner-chosen Drop Downs pairs and New Rule is the parsed amount, except Binding Estimate Fee, which is automatic. Linehaul Rule is the Drop Downs cubic-feet range for the parsed Initial Price. Carrier is the resolved Moving Carrier legal name and DOT, not the raw Granot Carrier Code. Never includes customer or job identifiers.
_Avoid_: Sheet Sync row, tariff sync

**Tariff Adjustment Submit**:
The extension action that parses a Granot Forms View and posts the printed Tariff Adjustments to the Vantage server, which appends them to the tariff spreadsheet. Distinct from Sheet Sync.
_Avoid_: Sheet Sync, tariff sync

### Carriers

**Moving Carrier**:
A registered motor carrier in the Vantage carrier collection, identified by legal name, DOT, and MC. Distinct from Agent (salesperson) and from Granot Carrier Code.
_Avoid_: Carrier (unqualified when the Granot short name is meant), trucker

**Granot Carrier Code**:
The short Agent: value on a Granot Forms View that identifies a Moving Carrier, such as C2C. Stored on the Moving Carrier so Tariff Adjustment can write the legal name and DOT.
_Avoid_: Agent (salesperson), Granot Agent (ambiguous with sales Agent), acronym (unqualified)

### Sales Intelligence

The full Sales Intelligence vocabulary (Contact Number, Outreach, Attention band, Finding, Move assessment) lives in `vantage-main-server/docs/call-sales-intelligence/01-specification.md` and the Service docs. These four words name how the Owner's desk is served (data spec `sales-intelligence-ui-ux-workspace/SALES-INTELLIGENCE-DATA-MODEL-AND-RETRIEVAL-SPECIFICATION.md`).

**Reference time**:
The one instant every state and every "how long since / until" phrase in a response is measured against: the response's `as_of`. For the Attention list it is the snapshot's publish time; for every other Owner read it is the request time. States (overdue, move date passed, newer call since assessment, recorded late) are decided on the server at that instant; the Admin only formats the distance between a server time and `as_of`, never the browser clock.
_Avoid_: now (on the client), served at, last refreshed

**Facts**:
The server-computed card facts of one Outreach record (`facts`): route and move date, last call, call / conversation / recording counts, and the state booleans and enums the card prints. Computed by one pure function at the reference time, frozen onto the Attention snapshot row and recomputed live on the Outreach detail read. Counts are null, not zero, when the record has no Contact Number.
_Avoid_: derived (that is the Attention band decision), stats, card data

**Partition**:
Which part of one Attention snapshot a row belongs to: `active` (open work, reachable through the Attention and All Outreach views) or `closed` (Outreach closed in the last 90 days with its outcome, reachable only through the Closed view). One publish writes both.
_Avoid_: tab, bucket, archive

**Work result**:
What a Finding actually did to the work, as the server states it: `applied`, `blocked`, `needs_review`, `not_applicable`, `superseded` or `retracted`, with a one-line detail. Decided from the Finding's review state, supersession and effects, ignoring the bookkeeping effects that record how it relates to an earlier Finding. The Admin never derives it from effects.
_Avoid_: effect status (one effect, not the Finding), outcome, applied state

**Case File**:
The single deterministic text the analysis model reads about one Contact Number, labelled as data: who and what, how the Lead started (as submitted), Granot now (last known value per field from accepted observations), one oldest-first timeline where every line names its source system, open work with the Commitments ledger, prior analysis, and what this run analyzes. Behind `SALES_INTELLIGENCE_CASE_FILE`; the findings step and the Move assessment both read it, and output schemas don't change. Built by `casefile/` from the Subject Story sources; never shown as a Booking or a band. (Attention-and-Case-File spec, 2026-09-23.)
Also the first tab of the full Outreach record page: a human view of the same move facts, with source comparisons, Lead and Granot provenance, and a labelled latest-analysis summary. This UI meaning does not change the model-input contract or make model output a source fact. See [Outreach Intelligence specification](outreach-intelligence-workspace/SPECIFICATION.md) §1.3 and §4.3 (2026-09-29).
_Avoid_: story (the Owner-timeline reader it reuses), prompt context, dossier

**Promised callback**:
An open `call` follow-up with exact-time precision whose origin is a rep promise, a customer request or the Owner (or a system retry successor of one). It is the only thing that puts a record in Attention band 1, and the one predicate (`isPromisedCallback`) the "callbacks kept on time" measure shares. Day-precision promises and non-call next steps are follow-ups due, band 4.
_Avoid_: callback (without the origin), promise (any commitment)

**Last activity**:
The newest of: the last meaningful contact, the last attributable outbound attempt, accepted Lead progress, and the last Owner command on the Outreach record (`last_activity_at`). Going cold measures from it; `unreached` flags a record that keeps being attempted without contact.
_Avoid_: last contact (that is `last_meaningful_contact_at`), last touched

**Default next step**:
The one system follow-up Vantage creates when accepted Lead progress reaches Quoted and the record has no open action: "Follow up on the quote", day precision, one staffed day later. It isn't a promise, never calls a model, and any rep, assessment or Owner action on the record supersedes it.
_Avoid_: auto task, reminder, promise

**Assigned rep**:
The Agent responsible for an Outreach record (`responsible_agent_id`, with `assignment.origin`). The Owner's assignment wins; otherwise it follows the Lead's Receiver agent (`crm_receiver`); otherwise the phone evidence (first conversation, a rep's promise, first attempts). An Owner assignment is written only to the Outreach record, never to the Lead. (Assignment addendum E4, E26.)
_Avoid_: receiver agent (that is the Lead's field), owner, handler

**Receiver agent**:
The Agent a Lead is attributed to (`receiver_agent`, with `receiver_agent_source` and its set time). Granot's latest rep replaces an automatic value; a manual value is protected; a Call Lead with no Granot rep can take the one reviewed rep who answered its creating call (`ringcentral_answered`, the weakest source). Analytics and receiver-agent reports read it. (Assignment addendum E3, E5, E6, E26.)
_Avoid_: assigned rep (that is the Outreach field), sales rep, booker

**In-progress call**:
A Call Interaction that telephony hasn't reported as ended (`terminal: false`); usually a webhook-only row whose Call Log record hasn't settled. Owner surfaces show it with an `In progress` chip and no result or duration; the model's Subject Story and Case File leave it out until it's final. `call_log_state: null` means final unless `terminal` is false. (Reconciliation addendum G2.)
_Avoid_: live call (that is the record-level signal), pending call, open call

**Live call**:
The server-derived "On the call" signal of one Outreach record (`live_call`): an in-progress call on the record's primary Contact Number, not a monitoring leg or an Internal call, that started in the last 4 hours, with the Vantage-side rep. It's separate from the Owner's manual `call_progress` ("Owner calling"); the row reads as live when either is set. (G3.)
_Avoid_: in-progress call (one call), call progress (the Owner's manual flag)

**Recovered call**:
A call a capture repair added or completed after the fact (`capture_recovery`: run, time, `added` / `completed`). Its timeline event reads `observed_reason: recovered`; a call first seen more than an hour after it started without a repair is `late_capture`. Band transitions caused by it are `capture_repair`, never rep activity. (G4.)
_Avoid_: late call, backfilled call, recorded late (the `late_capture` case)

**Form-created Number**:
A Contact Number that a Form Lead's submitted phone created before any call (`created_via: "form_lead"`; a missing value means `call`). With `has_calls = false` it's hidden from the Numbers list by default behind `SALES_INTELLIGENCE_NUMBERS_HAS_CALLS_DEFAULT`, and `include_form_only` shows it. (G7.)
_Avoid_: empty number, lead number, placeholder

The sales rep tracker words below come from the [sales rep tracker specification](docs/sales-rep-tracker/SPECIFICATION.md) and its [implementation design](docs/sales-rep-tracker/IMPLEMENTATION-DESIGN.md). Each area is behind its own `SALES_INTELLIGENCE_*` flag, default off.

**My Tracker**:
A work mode of My Outreach that shows only the Outreach records the assigned rep is tracking. It is a filter over the same records and the same full-page route, not a second list, tab or copy; the Owner's All Outreach still includes every tracked record.
_Avoid_: tracker list, tracker tab, my jobs

**Tracking membership**:
Whether an Outreach record is in its assigned rep's My Tracker (`tracking.mode` `tracked` or `outreach`). It is effective only while the tracking Agent is still the record's Assigned rep and the record is open, so a reassignment drops it without a write; an absent value means `outreach`. Only the assigned rep (or the Owner) can Track or Return a record.
_Avoid_: claim, pin, watchlist

**Sales attempt**:
A rep's own report that it is reaching out on one Outreach record, with a start, an end and an outcome (`answered`, `rejected`, `no_answer`, `busy`, `failed`, `abandoned`). It never places, fabricates or overwrites a call; it reads "Rep reports reaching out" until a Provider-verified call is linked to it. One active attempt per rep.
_Avoid_: call (that is a Call Interaction), call progress (the Owner's manual flag), dial

**Provider-verified call**:
A telephony Call Interaction attributed to a reviewed rep through temporal Rep identity. It counts once: when exact, unique account, rep, Number and time evidence links it to a Sales attempt, the attempt carries it and the call's own contribution is merged into the attempt's. Ambiguity stays unlinked.
_Avoid_: confirmed call, real call, live call (the record-level signal)

**Attempt needs resolution**:
The state of a Sales attempt left in progress past its stale time (four hours by default, `attempt_stale_minutes`). The rep, or the Owner, resolves it with an outcome and a reason; it never turns into a completed call on its own.
_Avoid_: timed out, abandoned (an outcome), stale call

**Sales note**:
Plain, author- and time-stamped text on an Outreach record with an audience (`all` or `owner_only`) and an edit history. It never resets Last activity, never writes an Owner instruction, never enqueues analysis and never satisfies a follow-up. The Owner's legacy `add_note` command keeps its own behaviour.
_Avoid_: comment, summary (the attempt's summary), Owner instruction

**Internal thread**:
An in-app conversation between the Owner and one rep, linked to an Outreach record or to the rep. Messages are append-only. Participation never widens Outreach scope; after a reassignment the former rep keeps only a sanitized receipt.
_Avoid_: chat, nudge (external delivery), SMS

**Sales instruction**:
An Owner-issued, actionable item for one rep with a typed completion rule (call this Lead, call N Leads in a window, complete this follow-up, refresh Granot, add a summary, or free-form), a window and its own states (`open`, `in_progress`, `fulfilled`, `cancelled`, `expired`). It is distinct from the Owner instruction ledger (`sales_intelligence_owner_instructions`), which records Owner field overrides for analysis. Reading it is not acknowledging or fulfilling it.
_Avoid_: Owner instruction (the ledger), task, nudge, message

**Recipient notification**:
One durable inbox item for one recipient (`owner` or one Agent), unique per recipient, event and kind, with a per-recipient sequence number. Read state is a watermark plus the items read above it, so an item that arrives after a mark-all-read stays unread. An actionable notification resolves when its work does. Active-call ticks never create one.
_Avoid_: alert, push, nudge, NotificationDelivery (the email log)

**Goal**:
A target for one rep over an explicit window (a New York day, a Monday-to-Sunday week, a month or a custom range): attempts, distinct Leads attempted, distinct Leads contacted, official deals, booked binder credit or earned commission. Personal goals and Owner-assigned targets use the same contribution engine; progress is a count or sum of Contribution facts (earned commission sums Earnings entries), and `remaining = max(target − progress, 0)`. Attempts counts qualifying Sales attempts and Provider-verified calls, each once, so it can differ from the rep's own reported attempt count in either direction.
_Avoid_: quota, KPI, instruction (that is a Sales instruction)

**Contribution fact**:
What the specification calls a goal contribution: one deduplicated, countable piece of a rep's work (`sales_contribution_facts`), keyed by its source (`attempt:`, `call:`, `deal:<booking>:<agent>`, `granot_refresh:`). Only active, unmerged facts count, so retries, replays and a linked call never count twice. It is the only way tracker work reaches instructions and goals.
_Avoid_: event, activity, point

**Achievement**:
The append-only record that a goal reached its target at a point in time. It fires once per transition. A later reversal or correction marks it adjusted instead of erasing it, and only a newly observed achievement animates.
_Avoid_: badge, celebration, completion (of an instruction)

**Deal credit**:
A rep's credit for an official Booking, taken from the Booking's `agent_allocations` at the credited revision, in integer minor units: one entry per Booking and Agent with a nonzero allocation, reversed on official Cancellation and adjusted on an allocation correction. A Priority 5, quote, tracked job or call result is never a deal.
_Avoid_: commission (that is an Earnings entry), sale, booking count

**Compensation policy**:
A versioned, Owner-configured rule that turns Deal credit into earnings: a percentage of the rep's binder allocation and/or a fixed amount per credited Booking, with effective dates, currency and recognition event. There is no default rate; a missing or overlapping policy reads `unconfigured` or `invalid`, never a guessed amount.
_Avoid_: commission rate (alone), payroll, pay plan

**Earnings entry**:
One append-only line of computed commission for a rep under a Compensation policy snapshot, in minor units; adjustments and reversals are their own entries. Old entries are never repriced after a rate edit. Paid commission is separate and unavailable without a payment record.
_Avoid_: paycheck, payout, paid commission

**Opportunity value**:
The observed gross value of a job, shown with its source, observation time and currency, or as unknown. The source is the verified Total Estimate from a Granot Job Page snapshot, or else the Granot report's estimate. A total counts each verified Job Number once; a record without one is counted as unidentified and never summed. It is not binder credit, not earnings and not profit, and it is never probability-weighted.
_Avoid_: pipeline value, potential earnings, revenue

**Assignment cost**:
The Owner-only distribution of Lead cost by the current Outreach Assigned rep, grouped by Source Company and Source Granularity, with Unassigned and unresolved buckets so the company total reconciles to the cent. It is separate from Receiver-attributed spend, the existing reports by the Lead's Receiver agent, which stay unchanged.
_Avoid_: rep spend, Lead spend (the Receiver-attributed report), CPL

**Assignment transfer**:
One recorded move of an Outreach record's Assigned rep, projected from the audit stream, that moves the record's Lead cost from one rep's Assignment cost to another's. It is never new company spending.
_Avoid_: reassignment spend, handoff, transferred call

**Granot Job Page snapshot**:
An immutable capture of the parsed sections of one Granot job's page, retrieved read-only through a verified navigation sequence and identity check. Each field has a state and a source, and each section has a coverage. One current head per account and job points each section at its newest complete, verified snapshot, so a failed or partial read never replaces good evidence. A login or error page is never an empty job, and a session token is never job identity.
_Avoid_: Granot report row, scrape, Granot sync

**Case File view**:
The human Case File for one Outreach record, for the rep and the Owner. It is composed on read from the Lead's facts and the Granot Job Page snapshots, with freshness, availability and Lead-versus-Granot conflicts that it never resolves by itself. The AI Case File (the model's input, `SALES_INTELLIGENCE_CASE_FILE`) stays as it is; this view never feeds a model and is not a source fact by itself.
_Avoid_: Case File (unqualified, when the AI input is meant), Granot tab, dossier

### External systems

**Granot CRM**:
The third-party CRM (HelloMoving / Eagle) where non-duplicate form leads are posted and where the owner views and edits move rows. The browser extension reads Granot rows for enrichment and writes updates back to Vantage.
_Avoid_: CRM (unqualified), Eagle (when referring to the system role)

**Granot Automation Source**:
An exact, case-sensitive source label available in Granot CRM reports and selected by the owner when starting a Granot enrichment plan. It controls which report sections are collected; it is not itself a Source Company identity.
_Avoid_: Source Company (unless referring to the attribution owner), free-text source

**Reporting Sheets**:
The Google Sheets workbooks the owner uses for lead and booking reporting. Comprises Master Sheets (written by Sheet Sync) and Source Company Sheets (derived from master via sheet import queries). Not the system of record.
_Avoid_: Sheets (unqualified), Google Sheets (acceptable but Reporting Sheets is canonical in domain language)

**Master Sheets**:
Master Leads and Master Booked — the authoritative reporting workbooks Sheet Sync writes to directly.
_Avoid_: Master workbook (acceptable), main sheets

**Source Company Sheet**:
A per-partner reporting workbook scoped to one Source Company. Rows are pulled from Master Sheets via sheet import queries; the server does not write to these workbooks directly.
_Avoid_: Partner sheet, source tab (when meaning the whole workbook)

**System of Record**:
MongoDB — the authoritative store for leads, bookings, cancellations, and related domain data. Reporting Sheets and Granot CRM follow the database; they are not sources of truth.
_Avoid_: Source of truth (acceptable synonym)

**CRM Posting**:
Sending a non-duplicate Form Lead to Granot CRM after it is saved in the database. The Form Lead Tracking Reference is sent as `leadno`; Granot stores it as `ref_no` on the row. Skipped when the lead is a duplicate or when posting is explicitly disabled. Should still be attempted when posting is enabled even if non-critical downstream steps (sheet sync, observability) fail after the lead is persisted.
_Avoid_: Granot sync (enrichment is the reverse direction)

**Granot Observation**:
A point-in-time statement received or read from Granot about a lead, job, priority, or booking. It is evidence of Granot state and does not by itself authorize a Vantage domain change.
_Avoid_: Granot update (when the statement has not yet been matched and applied)

**Granot Observation Receipt**:
The durable, credential-redacted input envelope that preserves one Granot delivery or approved synchronization operation from a webhook, browser extension, or HTTP automation channel. It is transport evidence, not a Lead or Synchronization Decision.
_Avoid_: Granot Webhook Receipt (when referring to the channel-neutral concept), Granot Observation, WordPress Form Submission Receipt

**Granot Lead Snapshot**:
A Granot Observation containing the lead and job values Granot reports at that moment. A priority webhook carries a Granot Lead Snapshot, not merely the changed priority field.
_Avoid_: Priority delta, lead patch

**Granot Lead Created Observation**:
A Granot Observation that a job/lead now exists in Granot. For a Vantage/WordPress-created Form Lead, it matches, links, and may enrich the already-ingested Lead; it does not create another Lead. It may create a Form Lead or Call Lead only for a separately reviewed source whose current Registry policy authorizes Granot creation and whose identity, route, and minimum-data checks pass.
_Avoid_: Form Lead Ingestion, unconditional create webhook

**RingCentral Call Adoption**:
Converging one already-qualified RingCentral call into exactly one pending Granot-created Call Lead in the same Source Granularity, with the same immutable phone, within the approved time window. Adoption attaches verified telephony evidence without changing the Lead's Granot creation origin; it happens before duplicate classification and is not a general same-phone merge.
_Avoid_: Call Lead Enrichment, duplicate matching, phone merge

**Granot Priority**:
The raw workflow code Granot reports for a lead. Vantage stores that code as a canonical Lead field. It is not Booked state. Quoted is a derived boolean from mapped codes only.
_Avoid_: Lead status, booking status, Vantage priority

**Quoted**:
A derived Lead boolean meaning a mapped Granot Priority has authorized quote. Granot Priority is the canonical field; Quoted is the Vantage reading of that code, not an independent source of truth.
_Avoid_: Granot Priority, booked, quote status (unqualified)

**Observation Channel**:
The mechanism through which external state reached Vantage, such as a Granot webhook, the Granot browser extension, or Granot HTTP automation. It is distinct from the source system, the human or system actor, and the reason for a domain change.
_Avoid_: Source, actor, provenance (when referring only to transport)

**Granot Record Link**:
The durable association between a Granot job identity and the Vantage Lead or Booking it represents. Once established, it is preferred over repeating contact-based matching for later Granot Observations. If an owner selects a different eligible Lead during Confirm Granot Booking, that explicit resolution may correct the link while preserving the previous association as evidence.
_Avoid_: Match result (a match result is evidence used to establish or dispute the link)

**Granot Booking Discrepancy**:
A durable work item recording that a Granot booking assertion conflicts with an existing Vantage Booking, official Cancellation, or established Granot Record Link. A missing Vantage Booking with no conflict is handled by a Granot Booking Reconciliation Case instead; the discrepancy never mutates a Booking.
_Avoid_: Granot Booking Reconciliation Case, Booking Lead Reconciliation Case, Granot Release Discrepancy, Booking

**Granot Booking Action**:
The CRM button action Granot reports on `booking_status_changed` as `Booked` or `Release`. Captured payloads truncate `Release` to `Releas`; both spellings are the same action. A job can have many Booked actions and many Release actions. It is evidence of what the Rep just did in Granot, not a Vantage Booking or Cancellation.
_Avoid_: Booking (the Vantage record), Cancellation, booking status (unqualified when meaning this button action), Granot Priority

**Granot Release Reconciliation Case**:
A retired owner work item that used to hold Release evidence when an official Booking already existed. New Release Granot Observations land on the Granot Booking Reconciliation Case. Historical rows may still exist for audit; they are not a Cancellation and never auto-cancelled.
_Avoid_: Granot Cancellation Intake Case, cancellation intake, Granot Release Discrepancy, auto-cancel, cancellation signal

**Linked Release Booking**:
The existing Booking on a Granot Booking Reconciliation Case when the latest Granot Booking Action is Release. It is deterministic owner context, not a freely changeable suggestion. A wrong link is a Granot Release Discrepancy, not a dropdown. There is at most one Vantage Booking per Job Number.
_Avoid_: Suggested Booking Lead, selected booking (when meaning this resolved identity)

**Confirm Granot Cancellation**:
The owner-authorized command that resolves a Granot Booking Reconciliation Case — when an official Booking exists and the latest Granot Booking Action is Release — by supplying the official Refund, Cancel Date, and optional Reason/Notes required to create a Vantage Cancellation. Observed Granot payment, balance, or estimate may be displayed as context but are never substituted for the official Refund.
_Avoid_: Accept webhook, auto-cancel, approve release

**Update Existing Booking**:
The owner-authorized command that resolves a Granot Booking Reconciliation Case by supplying official Book Date, Agent Allocations, Binder, Deposit, and Merchant on the existing Vantage Booking for that Job Number. It never creates a second Booking.
_Avoid_: Confirm Granot Booking (creates the first Booking), accept webhook, auto-update

**No Action**:
The owner-authorized resolution that closes a Granot reconciliation case without changing a Lead, Booking, or Cancellation. The triggering Granot Observations remain evidence, and an optional reason may be recorded.
_Avoid_: Dismiss, ignore webhook, confirm no changes

**Granot Release Discrepancy**:
A durable work item recording that a Release assertion conflicts with an established Record Link, Job Number, or Source Scope. A missing Vantage Booking with no conflict is handled by a Granot Booking Reconciliation Case instead; the discrepancy never mutates a Booking.
_Avoid_: Granot Cancellation Discrepancy, Granot Release Reconciliation Case, Cancellation, release_without_vantage_booking (retired reason for missing Booking)

**Synchronization Decision**:
The recorded outcome of comparing an external observation with Vantage state, such as applied, already current, unmatched, ambiguous, invalid, stale, or blocked by policy.
_Avoid_: Sync status (too broad), processing status (transport-oriented)

**Lead Message**:
An outbound communication sent because of a Lead workflow and durably associated with that Lead. A Lead Message preserves the exact recipient and rendered content as sent, along with provider delivery outcomes. Twilio is the current provider, but the business record is provider-independent. Public-form confirmations and Granot create-if-missing confirmations are both Lead Messages.
_Avoid_: Twilio Message (when referring to the business record), SMS log

