---
type: Specification
title: Granot Lifecycle surfaces — Ingestion cleanup, Health home, and webhook receipt search
description: >-
  Remove the duplicated Granot Workflow nest. Ingestion keeps HTTP
  Automation as the fallback. Job Timeline stays a Records tab. Intakes
  stay the owner Booking-intake desk. A new System tab Granot Lifecycle
  holds Health and searchable Granot Observation Receipts for the
  webhook channel.
tags:
  - granot-lifecycle
  - owner-dashboard
  - admin-dashboard
  - ingestion
status: proposed-final
stale_after: 2026-12-01
owners: [team:main-server, team:vantage-admin]
applies_to:
  - vantage-admin/components/layout/dashboard-nav.tsx
  - vantage-admin/components/ingestion/ingestion-subnav.tsx
  - vantage-admin/components/granot-lifecycle/**
  - vantage-admin/app/(dashboard)/ingestion/**
  - vantage-admin/app/(dashboard)/granot-lifecycle/**
  - src/services/granotLifecycle/**
  - src/routes/granot-lifecycle-admin.routes.ts
sources:
  - id: glossary
    resource: ../../CONTEXT.md
    title: Platform glossary
  - id: live-events
    resource: ../../vantage-admin/uxdocs/live-events-tab-specification.md
    title: Live Events tab (shipped)
  - id: live-receipts
    resource: ../knowledge/granot-lifecycle/live-receipts.md
    title: Granot live webhook receipts
  - id: observability
    resource: ../knowledge/granot-lifecycle/observability.md
    title: Granot lifecycle health projection
  - id: job-timeline
    resource: ../job-number-timeline/README.md
    title: Job Timeline enhancement pack
  - id: admin-map
    resource: ../../vantage-admin/.cursor/rules/project-organization.mdc
    title: Vantage Admin project organization
---

# Granot Lifecycle surfaces — Ingestion cleanup, Health home, and webhook receipt search

> **Contract maturity: implementation-ready.** Product rules in §§1–12 win
> except the historical list GET (see current-contract note below).
> File citations are evidence; reverify at implementation.
> This file does not change capture, normalize, processor, Intakes
> commands, Live Events SSE, or Job Timeline evaluation.

> **Current list contract (overrides §6, §7 “no raw JSON”, §10 payload/unmasking, and AC 7):**
> `GET /api/v1/admin/granot-lifecycle/receipts` returns unmasked Lead
> contact and a credential-redacted `granot_statement`. Owner Receipts
> shows stacked Name / Phone / Email and a View payload `SidePanel` on
> `?receipt=`. Authority: [`../knowledge/granot-lifecycle/live-receipts.md`](../knowledge/granot-lifecycle/live-receipts.md).
> §§6–7 below remain the original GLS-02/03 pack text.

**Prepared:** 2026-09-01
**Repos:** `vantage-admin` (IA and Receipts UI). `vantage-main-server` (historical receipt search API only).
**Owner-facing labels:** Granot Lifecycle, Receipts, Health, Granot workflow, Best Relocation, Open Job Timeline, Open Intake, Booked, Release
**Canonical facts:** [Granot Observation Receipt](../../CONTEXT.md), [Granot Observation](../../CONTEXT.md), [Granot Booking Action](../../CONTEXT.md), [Observation Channel](../../CONTEXT.md), [Synchronization Decision](../../CONTEXT.md), [Source Company](../../CONTEXT.md), [Granot CRM Source](../../CONTEXT.md), [Job Number](../../CONTEXT.md)

---

## 1. Decision

The Ingestion → Granot workflow nest currently stacks five jobs:
HTTP Automation, the lifecycle case queue, Intakes, Job Timeline, and
Health. Three of those already have a first-class sidebar home. The
lifecycle queue is the same Booking cases Intakes already shows.

Approved information architecture:

| Job | Home after this pack |
| --- | --- |
| HTTP Automation (fallback ingress) | **Ingestion → Granot workflow**, first subtab |
| Best Relocation sheet ingest | **Ingestion → Best Relocation**, second subtab; `/ingestion` stays this page |
| Owner Booking intake work | **Today → Intakes** |
| Job Number story | **Records → Job Timeline** (`/job-timeline`) |
| What just arrived | **Today → Live Events** (30-minute SSE; unchanged) |
| Pipeline flags, due work, alerts | **System → Granot Lifecycle → Health** |
| Find a historical webhook receipt | **System → Granot Lifecycle → Receipts** |

Locked placements:

- **Do not** put Job Timeline inside Granot Lifecycle. Deep-link to
  `/job-timeline?job=` with `buildJobTimelineHref`.
- **Do not** put Health in Operations Registry. Registry is the
  configuration catalog (Agents, Merchants, Sources, Granot sources,
  RingCentral, CPL). Health is a runtime projection.
- **Do not** add Health or Receipts as Observational tabs.
  Observational remains Vantage’s own events, incidents, reports,
  notifications, and Sheet Sync. Keep a deep link to Health.
- **Do not** merge Receipts into Live Events. Live Events is “what
  just arrived.” Receipts is historical find.

The new sidebar item is **Granot Lifecycle**. After Receipts ships it
is the default tab. Health is the other tab.

---

## 2. Target navigation

### 2.1 Sidebar (System)

`components/layout/dashboard-nav.tsx`, Owner-only item:

```
Observational
Operations Registry
Granot Lifecycle     ← new, href /granot-lifecycle
Ingestion
Audit Log
Settings
```

Admin role: no Granot Lifecycle sidebar item. Admin still reaches
Health through the Observational deep link (same exception Health has
today).

### 2.2 Granot Lifecycle routes

```
/granot-lifecycle              → Receipts (after GLS-03). Until then, Health.
/granot-lifecycle/receipts     → searchable Granot Observation Receipts
/granot-lifecycle/health       → existing LifecycleHealthPage, new URL
```

Subnav labels: **Receipts**, **Health**. No Job Timeline. No Intakes.
No Automation. No Lifecycle queue.

Href constants:

| Constant | Value |
| --- | --- |
| `GRANOT_LIFECYCLE_HREF` | `/granot-lifecycle` |
| `GRANOT_LIFECYCLE_RECEIPTS_HREF` | `/granot-lifecycle/receipts` |
| `GRANOT_LIFECYCLE_HEALTH_HREF` | `/granot-lifecycle/health` |

`GRANOT_LIFECYCLE_HEALTH_HREF` today is
`/ingestion/granot/lifecycle/health`. Every caller updates.

### 2.3 Ingestion

`IngestionSubnav` order, Owner sees both, Admin sees Best Relocation only:

1. **Granot workflow** → `/ingestion/granot`
2. **Best Relocation** → `/ingestion`

`/ingestion` continues to render Best Relocation so Admin landing does
not change. Do not redirect `/ingestion` to Granot workflow.

`/ingestion/granot` is HTTP Automation only
(`GranotAutomationDashboard`). The inner `GranotNavigation` (Automation /
Lifecycle / Intakes / Job timeline / Health) is removed.

Optional later rename of the subtab to **HTTP Automation** is out of
this pack. The page description may say it is the fallback to lifecycle
automation.

### 2.4 Redirects (308 or Next.js `redirect`)

Old bookmarks must not 404.

| From | To |
| --- | --- |
| `/ingestion/granot/lifecycle` | `/intakes` |
| `/ingestion/granot/lifecycle/health` | `/granot-lifecycle/health` |
| `/ingestion/granot/lifecycle/health/*` | `/granot-lifecycle/health` |
| `/ingestion/granot/lifecycle/jobs/:jobNo` | `/job-timeline?job=:jobNo` (use `buildJobTimelineHref`) |

`/ingestion/granot/live` already redirects to `/live-events`. Keep it.

Do **not** redirect:

- `/ingestion/granot/lifecycle/cases/:caseId` — Intakes already works
  via `?case=`. Leave the old case URL as an implementation path until
  a later pack retires it.
- `/ingestion/granot/lifecycle/discrepancies` and
  `.../discrepancies/:id` — no nav entry; URLs may stay.

### 2.5 Deep links that must move

| Current | After |
| --- | --- |
| Observational overview → `/ingestion/granot/lifecycle/health` | `/granot-lifecycle/health` |
| Intakes job link in `intake-copy.ts` → `/ingestion/granot/lifecycle/jobs/:jobNo` | `buildJobTimelineHref({ job })` |
| Lifecycle dashboard “Lifecycle health” / “Review discrepancies” | Health lives on the new tab. Discrepancy list stays unlinked from nav. |
| Live Events “Open job timeline” | already `/job-timeline`; leave it |

---

## 3. Auth

### 3.1 Pages

| Path | Owner | Admin |
| --- | --- | --- |
| `/granot-lifecycle`, `/granot-lifecycle/receipts` | yes | no |
| `/granot-lifecycle/health` | yes | yes |
| `/ingestion/granot` (Automation) | yes | no |
| `/ingestion` (Best Relocation) | yes | yes |

Add `/granot-lifecycle` to Owner-only page prefixes **except** the
Health exception, which moves from
`/ingestion/granot/lifecycle/health` to `/granot-lifecycle/health`.

Update every list that currently special-cases the old Health path:

- `vantage-admin/server/auth/authorization.ts` —
  `canAccessDashboardPath`
- `vantage-admin/components/layout/dashboard-shell.tsx` —
  `ownerOnlyPagePrefixes` (Health must remain reachable by Admin; do
  not add `/granot-lifecycle` as a blanket Owner prefix in the shell
  without the Health exception)
- `vantage-admin/.cursor/rules/project-organization.mdc` after ship

`/ingestion/granot` stays Owner-only. That prefix no longer needs to
carve out Health.

### 3.2 APIs

| Route | Who |
| --- | --- |
| `GET /api/v1/admin/granot-lifecycle/operations/health` | Owner and Admin (unchanged) |
| `GET /api/v1/admin/granot-lifecycle/receipts/live` | Owner only (unchanged) |
| `GET /api/v1/admin/granot-lifecycle/receipts` (new) | Owner only |

Admin `canProxyVantagePath` must 403 the new list. Do not reuse the
Health GET permission.

---

## 4. Receipt search — object and channel

The page lists **Granot Observation Receipts** whose
`observation_channel` is `granot_webhook` and whose `route_event_class`
is one of `lead_created`, `priority_updated`,
`booking_status_changed`.

Glossary: say **Granot Observation Receipt**. Do not title the page
“Granot Webhook Receipts” as if that were the channel-neutral concept.
Owner-facing tab label is **Receipts**. Page title may be
**Granot webhook receipts** (the webhook-channel slice the Owner asked
for).

Exclude browser-extension and HTTP-automation receipts. Those are
other Observation Channels.

A receipt is the row. A Granot Observation is 1:1 with a processed
receipt (`receipt_id` unique). Search **starts from receipts** and
left-joins the Observation when it exists. Pending or not-yet-normalized
receipts still appear unless a filter can only be answered from the
Observation (see §6).

Do not scan or render raw payloads in the UI. Reuse the credential-
redacted lead extract already used by Live Events
(`extractLiveWebhookLead`) only as a **pending-receipt fallback** for
identity filters. Prefer Observation fields when present.

Payload `event_type` is evidence only. It must not reroute the row.
`route_event_class` is the webhook event type.

---

## 5. Filters

All filters are optional. Combine with AND. Empty find lists newest
`captured_at` first.

| Owner control | Query param | Match |
| --- | --- | --- |
| Tracking reference | `ref_no` | Observation `identity.normalized_form_ref` when present; else Live-Events extract `leadno` / `ref_no` on the redacted payload |
| Job Number | `job_no` | Observation `identity.normalized_job_no` when present; else normalize the Live-Events extract `job_no` with the same Job Number normalizer Job Timeline uses |
| Lead name | `name` | Case-insensitive contains on Observation `contact.display_name`, `first_name`, `last_name` when present; else Live-Events extract `display_name` / `first_name` / `last_name` |
| Phone | `phone` | Observation `contact.normalized_phone` when present; else normalize the Live-Events extract phone with the existing phone normalizer |
| Email | `email` | Observation `contact.normalized_email` when present; else normalize the Live-Events extract email |
| Source Company | `source_company_id` | Reviewed Source Company via Observation `granot_crm_source_id` → Granot CRM Source → Source Company. **Not** raw Granot source text |
| Webhook event type | `route_event_class` | Receipt `route_event_class` |
| Booked or Release | `booking_action` | Observation `booking_action.normalized`: `booked` or `release` |

Also allowed (URL state, not required on first paint):

| Query param | Match |
| --- | --- |
| `captured_from`, `captured_to` | Receipt `captured_at` inclusive bounds (ISO) |
| `processing_state` | Receipt `processing.state` |
| `cursor`, `limit` | Keyset page. Default `limit` 25, max 100 |

### 5.1 Event type vs Booking Action

`booking_status_changed` is **one** `route_event_class`. Booked and
Release are two [Granot Booking Action](../../CONTEXT.md) values on
that route (`booked` / `release`). Granot may send `Releas`;
normalization already treats that as `release`.

The Owner sees:

1. Event type: Lead created / Priority updated / Booking status changed
2. When event type is Booking status changed (or is unset), a second
   control: All actions / Booked / Release

Server rules:

- `booking_action` without `route_event_class` implies
  `booking_status_changed`.
- `booking_action` with `route_event_class` other than
  `booking_status_changed` is `400`.
- `lead_created` and `priority_updated` never return a booking action.

### 5.2 Filters that require an Observation

`source_company_id` and `booking_action` match only rows that already
have a Granot Observation. Pending receipts are excluded when either
filter is set. Do not guess Source Company or Booking Action from the
raw payload.

Identity filters (`ref_no`, `job_no`, `name`, `phone`, `email`) may
use the pending-receipt Live-Events extract so an unprocessed webhook
is still findable.

### 5.3 Source Company control

Same reviewed Source Company catalog the rest of Admin uses
(`owner_label`). One exact Source Company. Do not invent a free-text
“source” box.

---

## 6. List DTO

`GET /api/v1/admin/granot-lifecycle/receipts`

Owner-only. Cursor page. Newest `captured_at`, then `_id`, descending.

```ts
type GranotWebhookReceiptListItem = {
  receipt_id: string;
  captured_at: string; // ISO
  route_event_class: "lead_created" | "priority_updated" | "booking_status_changed";
  booking_action: "booked" | "release" | null;
  processing_state: string;
  observation_id: string | null;
  decision_outcome: string | null; // Synchronization Decision outcome, or null
  ref_no: string | null;
  job_no: string | null;
  contact: {
    display_name: string | null;
    phone: string | null;  // masked
    email: string | null;  // masked
  };
  source_company: {
    id: string;
    owner_label: string;
  } | null;
  intake_case_id: string | null;
};

type GranotWebhookReceiptListPage = {
  items: GranotWebhookReceiptListItem[];
  next_cursor: string | null;
};
```

Masking matches Intakes / Live Events / Job Timeline: no full phone,
no full email, no raw payload, no credentials. `granot_statement` is
**not** on the list DTO.

`decision_outcome` is the latest Synchronization Decision on the
receipt when present. It is not a Lead, Booking, or case state.

`intake_case_id` is the open or resolved Granot Booking Reconciliation
Case for that Job Number when one exists. It is not a Booking.
Cancellation intakes are retired — do not add a cancellation-intake
link.

Do not `$lookup` in a per-row loop. Batch Observation, Registry, Decision,
and case reads for the page.

---

## 7. Admin Receipts UI

Default Granot Lifecycle tab after GLS-03.

- Filter bar for §5. URL owns filter state (shareable).
- Table or compact list of §6 fields.
- Owner labels: **Lead created**, **Priority updated**, **Booking
  status changed**, **Booked**, **Release**. Never print
  `route_event_class` or `booking_action` as the chip text.
- Row actions:
  - **Open Job Timeline** when `job_no` is present →
    `buildJobTimelineHref({ job })`
  - **Open Intake** when `intake_case_id` is present →
    `/intakes?case=`
- Empty state: “No matching Granot webhook receipts.”
- Loading and error use existing `FeedbackMessage`.
- No raw JSON. No mutation. No requeue control on this page (requeue
  stays on Health / existing operations if at all).

Copy lives in one small module next to the page
(`granot-lifecycle-copy.ts` or `receipt-search-copy.ts`). Do not
inline Owner sentences in JSX.

---

## 8. Server search implementation

New module under `src/services/granotLifecycle/` (name
`receiptSearch.ts` or similar). Route stays on
`granot-lifecycle-admin.routes.ts`.

- Authorize with `requireRegistryOwnerActor` (same as live receipts).
- Validate query with Zod in the existing granot-lifecycle validation
  file.
- Query `granot_webhook_receipts` (`GranotObservationReceipt`) first.
- Join `granot_observations` on `receipt_id`.
- Resolve Source Company through Granot CRM Source. Do not treat
  `normalized_source_label` as the Owner filter.
- Reuse existing phone / email / Job Number / form-ref normalizers.
  Do not invent a second normalizer.
- Existing index `granot_observation_receipt_route_event_captured`
  (`route_event_class`, `captured_at`) is the default find path.
- Existing Observation indexes on `identity.normalized_job_no`,
  `identity.normalized_form_ref`, and `contact.normalized_phone` are
  the identity paths when those filters are set.
- Add `granot_observation_normalized_email_captured`
  (`contact.normalized_email`, `captured_at`) if email find would
  otherwise collection-scan. Prove the need in the issue before
  adding extra indexes.
- Name contains may use a bounded case-insensitive match. Do not add
  Atlas Search in this pack.
- Live SSE (`liveReceipts.ts`, `liveReceiptStream.ts`) is untouched.

---

## 9. What does not move

- **Job Timeline** stays `/job-timeline`. The forensic
  `GranotJobTimelinePage` at
  `/ingestion/granot/lifecycle/jobs/[jobNo]` becomes a redirect only.
- **Intakes** stays `/intakes`. Do not rebuild the workbench.
- **Live Events** stays `/live-events`. Do not add historical filters
  to the SSE cards.
- **HTTP Automation** stays `/ingestion/granot`.
- **Operations Registry** is unchanged.
- **Observational** tabs are unchanged except the Health href.
- Capture, queue, processor, Owner booking commands, and health
  projection internals are unchanged. Health **page** moves; Health
  **GET** does not.

---

## 10. Out of scope

- Owner Daily View (`/daily`).
- Renaming the Ingestion subtab to HTTP Automation.
- Redirecting case detail URLs to `/intakes`.
- A discrepancies tab or queue.
- Cancellation intakes (already retired by the Release-into-intake
  contract; do not revive).
- Searching extension or HTTP-automation receipts.
- Raw payload drawer, unmasking, or credential fields.
- Receipt requeue, replay, or any write.
- Merging Live Events into Receipts.
- Putting Job Timeline, Intakes, or Automation under Granot Lifecycle.
- Operations Registry or Observational new tabs.
- Atlas Search / OpenSearch.
- Changing `CONTEXT.md` glossary terms. “Granot Webhook Receipt”
  remains the avoided synonym for the channel-neutral concept.

---

## 11. Delivery slices

| Issue | Repos | What ships |
| --- | --- | --- |
| [GLS-01](issues/GLS-01.md) | vantage-admin | IA: Ingestion order, strip Granot nest, Granot Lifecycle + Health, redirects, auth, deep links |
| [GLS-02](issues/GLS-02.md) | vantage-main-server | Owner list API, projection, filters, tests, indexes if required |
| [GLS-03](issues/GLS-03.md) | vantage-admin | Receipts tab consumes GLS-02; becomes the Granot Lifecycle default |

GLS-01 and GLS-02 may run in parallel (different repos). GLS-03
requires both.

---

## 12. Acceptance criteria

1. Owner sidebar System shows **Granot Lifecycle** after Operations
   Registry and before Ingestion. Admin does not see that item.
2. Ingestion subnav is Granot workflow, then Best Relocation.
   `/ingestion` is still Best Relocation. `/ingestion/granot` is
   HTTP Automation with no inner Lifecycle / Intakes / Job Timeline /
   Health tabs.
3. `/intakes` and `/job-timeline` remain the only nav homes for those
   jobs. Granot Workflow does not link to them.
4. Health renders at `/granot-lifecycle/health` for Owner and Admin.
   Observational still links there. Old Health URL redirects.
5. `/ingestion/granot/lifecycle` redirects to `/intakes`.
   `/ingestion/granot/lifecycle/jobs/:jobNo` redirects to Job Timeline.
6. Owner can find webhook-channel Granot Observation Receipts by
   `ref_no`, `job_no`, name, phone, email, Source Company, event type,
   and Booked vs Release. Admin cannot call the list API.
7. Receipts rows deep-link to Job Timeline and Intake when those
   identities exist. They do not dump raw payloads.
8. Live Events SSE, Intakes commands, Job Timeline evaluation, and
   HTTP Automation apply are unchanged.

---

## 13. Knowledge after ship

Invoke **docs-keeper** after each issue that changes runtime or Admin
map:

- `vantage-admin/.cursor/rules/project-organization.mdc` — routes and
  `components/granot-lifecycle/` ownership
- `vantage-admin/CONTEXT.md` — pointer status
- `docs/knowledge/granot-lifecycle/live-receipts.md` — sibling
  historical list; SSE rules stay
- `docs/knowledge/granot-lifecycle/observability.md` — Health URL only
- `docs/knowledge/granot-lifecycle/projections.md` if the list
  projection is documented there
- `docs/index.md` already lists this pack
