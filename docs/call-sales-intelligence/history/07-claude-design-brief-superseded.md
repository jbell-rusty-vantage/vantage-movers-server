# Claude Design brief — Vantage Sales Intelligence

> Historical reference retained September 17, 2026. The completed Owner interview is in [09](09-owner-workflow-interview.md); revised [01–06](README.md) and [10](10-intelligence-agent-contract.md) supersede behavioral instructions and open-decision guidance in this file. Use [workspace](workspace/README.md) for implementation.

Prepared September 17, 2026. Design handoff, not a change to the backend specification.

## How to use this brief

Upload this file to Claude Design together with `01-specification.md`, `02-domain-models.md`, `04-server-routes.md`, and `05-owner-dashboard-ux.md` from this folder. Include `03-server-pipeline-and-jobs.md` for finding effects and live event contracts. If repository access is available, also supply the admin files listed at the end.

The instructions below address Claude Design directly. The Owner delegated visual direction: use a compact, light-theme workspace with the existing Vantage palette, scannable work rows, and contextual detail drawers. This is the chosen direction; proceed without another style questionnaire. If an attachment is missing, identify the missing contract rather than pretending to have read it.

---

## 1. Your assignment

Design and implement the **Sales Intelligence** workspace for Vantage Movers. This is a working page inside an existing Owner/admin Next.js dashboard. The primary user is the Owner of a moving company, who needs to answer:

> What needs outreach, why, how old is the last contact, which Lead it belongs to, how certain that connection is, and which Sales Rep I should message.

Produce a polished, interactive design **and reusable source code that we can integrate with our backend without rebuilding the UI**. Visual quality and engineering portability are equally important. Build all four views, their detail panels, and the action dialogs. Prioritize Needs attention and Number Activity when choosing where to spend visual refinement.

The attached pack describes a planned feature; it is not evidence that these endpoints already run. Work against its contracts using a replaceable mock adapter. Never label fixtures as live production data.

You have freedom over composition, typography, density, responsive behavior, and interaction polish. Preserve the product scope, domain distinctions, field names, routes, legal actions, and uncertainty rules. Treat the ASCII wireframes as information and workflow requirements, not pixel layouts.

Do not turn this into a generic CRM homepage, a sales pipeline Kanban, a reporting dashboard dominated by charts, or a separate application with its own login and navigation.

## 2. Design direction and references

Aim for a quiet, precise workspace that the Owner can scan repeatedly throughout the day. Make the next useful action obvious and keep the evidence one interaction away.

Borrow these specific patterns, adapting them to Vantage rather than cloning another product:

| Reference | Pattern to study | Application here |
| --- | --- | --- |
| [Attio: record pages and previews](https://attio.com/help/reference/managing-your-data/records/create-and-view-records) | Record-focused views and previews from a list | Keep search/list context while inspecting a number or Outreach Record in a drawer. |
| [Attio: views](https://attio.com/help/reference/managing-your-data/views) | Scannable tables, filtering, sorting | Clear active filters, restrained rows, consistent identity cells. Only offer sorting supported by our API. |
| [Aircall: Call Timeline](https://support.aircall.io/hc/en-gb/articles/16582448402077-Call-timeline) | Understand the steps and outcome of a telephone interaction | Clear inbound/outbound, missed, voicemail, routing, and transfer presentation. Our canonical session remains one timeline entry. |
| [HubSpot: recording and transcript review](https://knowledge.hubspot.com/calling/review-call-recordings-and-transcripts) | Audio and transcript review in CRM context | Connect an Intelligence Finding to its transcript evidence and available playback. |

These are pattern references, not permission to import their dialers, automation, deal stages, or rep scoring.

### Visual defaults

- Use Vantage's existing tokens: navy `#062b55`, primary blue `#145da0`, bright blue `#2e86de`, gold `#f4b400`, cool-white background `#f5f8fb`, white surfaces, steel text/borders. Gold is a restrained accent. Reserve red for overdue work or serious failures; distinguish amber uncertainty from urgency.
- Reuse Archivo headings and Public Sans body where available; system-font fallback is acceptable in the portable preview. Suggested dense workspace type: 13–14px supporting text, 14–16px primary record text, 22–26px page title. These are design choices, not a request to change global typography.
- Prefer thin dividers, modest radius, clear selected-row treatment, and minimal shadow. Avoid glass effects, decorative gradients, oversized cards, and large empty hero areas.
- At desktop width, prioritize searchable work rows and a useful detail drawer. The filter rail should collapse. Avoid three full-width columns competing on a laptop.
- Design at roughly 1440px and 1280px widths, then adapt for tablet and 390px mobile. On mobile, use a filter sheet and full-screen details; preserve every action and readable evidence.
- Icons supplement labels. Use consistent Lucide icons. Do not use color alone for certainty, status, or capability.
- Keep focus visible, controls labelled, dialogs keyboard operable, and focus restored to the opener. Meet WCAG AA contrast. Respect reduced motion and announce important status changes without reading every live update aloud.

## 3. Domain types and non-negotiable distinctions

Use these types from the pack. New Call & Sales Intelligence terms remain proposed glossary terms; do not rename them or silently promote them into the shared glossary.

| Type | Meaning for the design |
| --- | --- |
| Contact Number | An external phone endpoint. It may have no Lead, one candidate, or multiple Leads. It is not proof of one Customer or household. |
| Number Activity | The chronological view of interactions, Lead Messages, Lead Conversations, Follow-ups, and Owner actions on that number. |
| Call Interaction | Canonical telephony session; implementation name, not a raw model label to expose to the Owner. Multiple routing legs do not become multiple activity entries. |
| Form Lead / Call Lead | Existing distinct Lead types. Preserve `lead_ref.model` and `lead_ref.id`. Do not introduce an Opportunity object. |
| Number↔Lead Attachment | `candidate`, `ambiguous`, `attached`, `rejected`. Equal phone numbers do not authorize a merge. |
| Number Review | Work on a number without creating a Lead. |
| Outreach Record | Work state for one eligible Lead or Number Review. |
| Follow-up | Explicit next action, due time, optional responsible Agent, disposition, and evidence. |
| Intelligence Finding | A versioned, cited suggestion requiring Owner review; not an official fact or automatic write. |
| Rep Identity Link | Reviewed Agent-to-RingCentral User connection. Required for rep metrics and messages. |
| Owner Rep Nudge | Explicit internal message to a mapped Sales Rep. Never a customer message. |
| Coverage Watermark | Time through which history is known complete, together with gaps and capabilities. Separate from connection status and last fetch time. |

Keep four separate state dimensions: number classification, attachment, Outreach, and conversation processing. Overdue, No one owns this, No next step, and cooldown are derived signals, not Outreach states.

Outreach values are `unworked | open | waiting_on_customer | identity_review | closed`. Classification values are `unknown | customer | company | non_customer`. Contact eligibility is `allowed | temporarily_blocked | suppressed | unknown`.

Certainty is **Exact / Likely / Unsure / Confirmed by you**. Provider-connected is not proof that a human spoke: contact type displays **Left voicemail / Spoke / Connected (unknown)**. An inbound interaction does not prove the Form Lead received outbound outreach. `received_by` is provenance, not explicit responsibility.

Do not create or edit Leads, Bookings, Cancellations, Customers, commissions, or Agent Allocation from this workspace. Show official records as context and deep links. Call Qualification remains unchanged. No dialer, transfer control, automatic messaging, customer SMS composer, AI lead score, or rep leaderboard.

## 4. Navigation and page shell

Route: `/sales-intelligence`, Owner-only. Sidebar placement: Today group, after Lead Conversations. Reuse the host dashboard chrome; a preview may include a lightweight shell only if it is removable.

URL state:

| Key | Meaning |
| --- | --- |
| `view=attention\|numbers\|reps\|coverage` | Active view; default `attention` |
| `q` | Search text |
| `record` | Outreach detail ID |
| `number` | Contact Number detail ID |

Changing filters must preserve the open panel. Opening a different detail should replace the previous panel key so `record` and `number` do not compete. Back/forward navigation restores the view, filters, and selected record. Closing a drawer preserves list context and scroll.

The shell includes title, search, view tabs, relevant counts, a Live/Reconnecting indicator, and persistent compact coverage context. Expand detailed capability information in Coverage. A green Live dot must never imply historical completeness.

Search supports phone digits, names, and Job Numbers. Phone suffix search needs at least four digits. Enter navigates to Numbers; a unique result can open its panel. Rep filtering is separate. Do not claim global Agent text search exists without an API contract.

## 5. Required views and detail surfaces

### A. Needs attention

This is the main work queue. Use compact rows grouped into sticky bands in server order:

1. Promised callbacks overdue.
2. No observed outbound after an eligible Form Lead; first action overdue.
3. Missed inbound sales activity with no callback observed.
4. Follow-ups due.
5. No next step.
6. No one owns this.
7. Going cold.

Use server `derived.attention_band`, `attention_rank`, and reasons. Do not calculate prioritization or reassign bands in the browser. Render each record once in its server-assigned band; signal counts can overlap and must not be added into an invented total. Cooldown ordering comes from the server.

Row hierarchy: phone and Lead identity → reason it needs attention → last observed interaction and age → certainty/status → Message rep and Open. Source is visible but subordinate. Show a Number Review clearly when no Lead exists.

Keep **Which lead is this?** in a separate review rail, populated with `state=identity_review`; it never joins the actionable bands. Suppressed and company numbers do not enter the work queue.

Counts come from the overview contract, not the currently loaded cursor page. If counts are global rather than filter-specific, label that scope. Include Load more, partial-load errors, and a coverage-aware empty state.

### B. Outreach drawer

Use the existing SidePanel pattern. Tabs: **Now / Timeline / Conversations / Leads / Messages**.

Now shows the number, subject Lead/Number Review, state, derived signals, reason, last meaningful contact, next action, responsible Agent, attachment certainty, and available commands. Keep Received by separate from responsible Agent. Only display move details when a supplied contract actually includes them.

Primary actions: **Set next step**, **Message rep**, and identity review where needed. Secondary actions: mark worked, set waiting, assign responsible Agent, add note, close, reopen when legal. Command labels describe their effects. Never offer Booked or Cancelled as manual close options.

Pending Findings show claim, conversation/date context, citations, review status, and the precise effect of accepting. Use **AI suggestion — not verified** until accepted; then **Confirmed by you**. A booking claim links to official records and never creates a Booking.

Messages separates internal Owner Rep Nudges from customer Lead Messages. Neither an internal nudge nor delivered voicemail should masquerade as a conversation with the customer.

### C. Numbers

A searchable, compact list with number, classification/eligibility, Lead identity and certainty or **No lead on file**, latest activity, available interaction totals, and Outreach context. Click opens `?number=`. Keep numbers without Leads fully useful.

Number drawer tabs: **Timeline / Leads / Conversations / Outreach / About this number**.

Timeline is newest first with Load earlier, activity-type filters, and explicit date dividers. Include inbound/outbound interactions, missed activity, voicemail, conversation, Lead Message delivery, arrivals, Follow-ups, Owner actions, nudges, and official Booking/Cancellation context.

Show one session entry with expandable routing context, not one row per ringing device. Display exact queue device counts or named transfer targets only if the contract supplies them; otherwise use **Rang the sales queue** or **Transferred**. Internal activity is hidden by default. Implement its toggle only with a confirmed server filter; do not infer hidden pages from an incomplete client list.

Running summary is clearly an unverified AI synthesis; do not imply it represents only accepted Findings. Keep transcript citations and source conversations reachable where the DTO supports them.

Audio is play-only, requested on click, never prefetched. Handle unavailable, permission denied, expired, and purged audio without a misleading play control. Transcript evidence must still be readable when audio cannot play. A citation may seek audio only when its transcript segment supplies a timestamp; otherwise highlight the text.

About this number owns classification and eligibility with reasons. Explain suppression's effect across open Outreach Records. **Open a review** belongs inside the number detail and creates a Number Review, not a Lead. Keep **Rebuild counts** as a secondary maintenance action.

### D. Reps

Separate reviewed links, suggestions, and unmapped users/Agents. Show Agent, RingCentral User identity, extension, allowed channels, role, and review status. Roles: Sales rep, Service, Manager, Dialer, Shared line, Exclude.

Only reviewed links show activity metrics. Show outbound attempts, unique numbers, Connected, Spoke, attributable first actions, and nudges received when supplied. Unknown human-conversation counts remain unknown. Explain Connected versus Spoke. This is identity review and activity context, not performance ranking or commission management.

Support confirming a proposal, choosing among ambiguous identities, creating a manual link, changing channels/role, and retiring a link. Do not claim name similarity is reviewed identity. The pack has no dedicated proposal-rejection contract; see §11.

### E. Coverage

Explain history completeness and gaps, recording access, Team Messaging, rep texting, pager, RingSense availability, AI budget/paused state, queues, directory hygiene, and backfill. Each unavailable capability explains its impact in Owner terms.

Use `ok / denied / unknown / unavailable` distinctly. Unknown is not zero. History, recording access, and AI processing can have different availability simultaneously.

History banner follows the UX thresholds where defined: healthy at ≤20 minutes old with no gaps and no denied capability; amber for gaps/denied capability; red when history is >2 hours behind. Between 20 minutes and 2 hours, use an amber catching-up posture as a design default. Null `known_through` means completeness unknown, not healthy.

**Load older history** uses 1–90 days, default 60, and shows planned/running/conflict states. No invented percentage when only window counts are available.

## 6. Filter and search inventory

Only serialize supported API parameters. Additional local presentation preferences must be clearly separate from server queries.

| Surface / label | Query parameter | Control / behavior |
| --- | --- | --- |
| Attention search | `q` | Text, max 80 characters |
| Attention band | `band` | Single 1–7; omitted for all |
| Outreach state | `state` | `unworked`, `open`, `waiting_on_customer`; fetch `identity_review` separately |
| Overdue only | `overdue` | `true`/`false`, or omitted |
| No one owns this | `no_owner` | `true`/`false`, or omitted |
| Rep | `agent_id` | Agent ID, not extension or display name |
| Source | `source_label` | Supported source label; do not substitute Source Company IDs |
| Kind | `kind` | All (omit), `lead`, `number_review`; use single select or two checkboxes mapped to these three cases |
| No next step | No independent query in 04 | Use the supported band 5 shortcut, clearly labelled as that band; do not send `no_next_action=true` |
| Attention ordering | No sort parameter | Fixed server ranking |
| Numbers search | `q` | Phone suffix/prefix, names, Job Numbers |
| Number classification | `classification` | `unknown`, `customer`, `company`, `non_customer`, or omitted |
| Has Lead | `has_lead` | Tri-state; wire encoding/semantics need confirmation in final validator |
| Activity date range | `activity_from`, `activity_to` | New York date/time input serialized to API contract; boundary encoding remains to be confirmed |
| Include our numbers | `include_company=true` | Off by default |
| Numbers ordering | `sort` | Default latest activity descending; additional accepted values are not specified, so no invented options |
| Ordinary list pagination | `cursor`, `limit` | Default 50, maximum 200; no invented page totals |
| Number timeline | `before`, `limit`, `kinds` | Timeline has a special cursor; verify `kinds` encoding against implementation |
| Nudge history | `outreach_record_id` | Bound to the open Outreach Record |

Reps and Coverage have no specified server filter inventory. A clearly local search over the loaded Reps response is a design opportunity, not a new endpoint. Do not invent a global date filter across all views.

## 7. Primary flows, dialogs, and safe prefills

### Find work → inspect evidence → message a rep

1. Open a row without losing queue position.
2. Inspect reason, coverage, certainty, next action, and responsible Agent.
3. Open Message rep; show only current reviewed Sales Rep links.
4. Request `/nudges/preview` with record, selected Rep Identity Link, channel, and revision. The preview does not send.
5. Show resolved destination, exact editable message, channel, remaining allowance, and blockers. Explain **This never messages the customer**.
6. Re-preview edits; ignore stale preview responses. Send is enabled only for the latest allowed preview. Team Messaging is primary; optional channels appear only when enabled and allowed.
7. Explicit **Send to {rep}** submits once. Disable repeated submit while pending; reuse the idempotency key for retry of the same command. A new edited command requires a new key.
8. Show server-confirmed sent, pending, failed, or pager fallback outcome. Never infer success after a timeout; preserve pending/unknown delivery and reconcile with history.

Prefill record/number/revision from the current detail. Prefer the responsible Agent's eligible reviewed link only when unambiguous; otherwise require selection. Never infer ownership from the latest speaker or receiver. Message body comes from server preview, with customer number last four digits only.

### Set next step / wait / complete a Follow-up

Kind: Call, Text the customer, Review, Wait, Sort out which lead. Due time, optional responsible Agent, and note. Text the customer is a planned action via the existing Lead Message workflow, not an SMS send here. Wait opens until/reason inputs and uses `set_waiting`.

Reuse current action values when editing. A suggested next staffed hour is only a proposed prefill; require an explicit selected due time until a server/default helper contract is provided. Send ISO UTC and display America/New_York, including a visible timezone label.

Completing a Follow-up collects a disposition and either next action, waiting, closure, or explicit no next action. Show the resulting exception when none is chosen. Snooze requires until and reason. Do not claim a completed Follow-up proves contact beyond its submitted disposition/evidence.

### Resolve which Lead

Show every supplied candidate, exact type, source, date, certainty/evidence if supplied, and official status. Do not preselect the newest candidate. Owner chooses one or Neither, then confirms.

Attach the selected Lead and reject the other candidates sequentially using distinct idempotency keys. The reject route requires a reason, even though the wireframe calls its note optional: collect a reason whenever rejects will occur. Handle partial success honestly and retry only remaining commands; never claim the sequence is atomic.

### Review a Finding

Open claim → inspect cited transcript sentences → choose Accept with a described effect or Not right. Booking claims and quoted amounts stay review records, not official Booking or quote edits. Unresolved dates do not become guessed deadlines. Contact restriction requires an explicit effect choice.

### Close / reopen / classify

Close choices: Lost, Not a sale, Do not call this number, Dismiss. Booked, Cancelled, Duplicate, Bad lead, and No-sync come from official records. Explain number-wide suppression before the relevant command. Reopen requires a reason and never silently removes suppression. Refresh server state after every command.

### Deep links

Lead chips use server `admin_href`; Job Number uses `/job-timeline?job=`. Entry from a Lead resolves Outreach with `/outreach/by-lead/:model/:id`; hide the integration chip on a true missing record. Number-only work opens with number ID, without fabricated Lead data.

## 8. Blocked states and copy

| Condition | UI behavior |
| --- | --- |
| Identity review or Closed | No Message rep send; show the relevant resolution or reason |
| Suppressed | Exclude from Attention and nudge suggestions; show Do not call in number/history context |
| Company number | No Outreach actions; Our number chip |
| Rep not reviewed / wrong role | Explain mapping requirement and link to Reps |
| Nudge rate limit / disabled channel | Explain blocker from preview; never invent remaining quota |
| Revision conflict | “This record changed — refreshed”; refetch, preserve unsent form values, require review before resubmission |
| Illegal transition | Explain that the action is no longer available and refresh state |
| Existing Number Review | Open the existing record when identifiable; no duplicate creation |
| Extension already linked | Show the conflict and existing mapping if returned |
| Feature disabled | “Sales Intelligence is not turned on yet.” Stop retries/fetch loops |
| Non-owner | Access denied, including direct links; navigation hiding alone is insufficient |
| SSE disconnected | “Reconnecting…”; retain usable lists and show data age |
| Recording permission denied | “Audio not shared with this system”; no play button |
| AI budget paused | Explain that AI review is paused; distinguish that from history capture and actual recording capability |
| Empty with complete coverage | “Nothing needs attention right now” plus completeness time |
| Empty with gaps | “Nothing needs attention in what we can see” plus missing interval |
| Null metric / unknown coverage | Show Unknown or Not available with reason; never substitute 0 |

Centralize all Owner strings. Do not print enum codes, internal errors, or provider payloads. For missing outbound evidence use **“No observed outbound in this RingCentral account”** with age/context. This intentionally follows the product specification's capability-honesty rule over the wireframe's absolute “Nobody has called yet.”

Use **Last meaningful contact** for `last_meaningful_contact_at`: it can include delivered Lead Messages and must not be relabelled Last real conversation. Use Spoke/last human conversation only when that evidence is actually available. Show wall-clock and server-supplied staffed age together. Null is “Not observed” unless completeness and field semantics justify a stronger statement.

## 9. Reusable code and integration requirements

### Mandatory delivery format

**Preferred:** React + TypeScript components compatible with the existing Next.js App Router app, with scoped Tailwind/CSS styling, typed props, callbacks, query hooks, and a replaceable data adapter.

The inspected host uses Next.js 16.3.3, React 19.2.8, TypeScript 5, Tailwind 4, TanStack React Query 5, Lucide React, and existing shadcn-compatible local primitives. Match the host lockfile at integration; do not upgrade dependencies or assume a third-party UI package is installed. Consult the host's installed Next.js documentation before implementing framework-specific code.

**If your environment initially produces HTML/CSS/JavaScript:** deliver that preview **and a complete equivalent React/Next.js implementation**. Include actual `.tsx` files, imports, props/types, styles, adapter, mock data, and mounting instructions. A future conversion guide, iframe, screenshot, or one giant HTML string is not an acceptable substitute.

### Separation of responsibilities

1. Presentational components receive DTO-shaped data and callbacks. They do not fetch RingCentral, create domain records locally, or embed fixture arrays.
2. Containers/hooks own queries, loading/error state, URL state, and mutations through one typed client interface.
3. A mock adapter and an HTTP adapter implement the same interface. Switching adapter must not require rewriting visual components.
4. Real JSON requests go through the existing authenticated BFF: browser `/api/proxy/api/v1/admin/sales-intelligence/...` → backend `/api/v1/admin/sales-intelligence/...`.
5. SSE uses the separate unbuffered `/api/sales-intelligence-live` BFF. Never send API secrets, provider credentials, or database access to the browser.
6. Backend remains authoritative for identity, states, ranking, staffed-time calculations, coverage, capability, nudge eligibility, and Finding effects. Frontend may format values, group supplied bands, and tick displayed elapsed time.

Use DTOs from `04-server-routes.md §2`, not raw Mongo models from 02. For example, DTO `eligibility` differs from persistence `contact_eligibility`, and Outreach DTO `subject.lead_ref` differs from the model's `subject.model/id`. Use server IDs as strings, keep nullability, and preserve snake_case fields at the API boundary. Do not rename them into an unrelated mock CRM model.

### Component inventory and example prop boundaries

These interfaces are proposed frontend boundaries, not new backend DTOs. Import/copy the authoritative DTO definitions rather than redefining their meaning.

```ts
type AttentionRowProps = {
  row: AttentionRowDto;
  selected: boolean;
  as_of: string;
  coverage: CoverageDto;
  onOpen: (outreach_record_id: string) => void;
  onMessageRep: (row: AttentionRowDto) => void;
};

type NumberTimelineProps = {
  items: NumberActivityEntryDto[];
  hasMore: boolean;
  loadingEarlier: boolean;
  onLoadEarlier: () => void;
  onOpenLead: (lead: LeadChipDto) => void;
  onOpenConversation: (lead_conversation_id: string) => void;
};

type FindingCardProps = {
  finding: FindingDto;
  pending: boolean;
  onReview: (finding: FindingDto) => void;
  onDismiss: (finding_id: string) => void;
  onCitation: (lead_conversation_id: string, sid: number) => void;
};

type MutationContext = {
  idempotencyKey: string;
  signal?: AbortSignal;
};

// AttentionQuery and response wrappers must be implemented from 04.
// Where the pack lacks an exact DTO, name the gap instead of inventing a wire shape.
interface SalesIntelligenceClient {
  fetchAttention(query: AttentionQuery, signal?: AbortSignal): Promise<AttentionResponse>;
  fetchNumber(id: string, signal?: AbortSignal): Promise<NumberDetailResponse>;
  sendOutreachCommand(id: string, body: OutreachCommand, context: MutationContext): Promise<OutreachSummaryDto>;
  previewNudge(body: NudgeRequest, signal?: AbortSignal): Promise<NudgePreview>;
  sendNudge(body: NudgeRequest, context: MutationContext): Promise<NudgeDto>;
}
```

Extend this interface to every implemented action. No `any` escape hatches for domain data. UI-only properties such as selected/pending stay outside the DTO. Components to deliver:

| Component | Data / responsibility |
| --- | --- |
| `SalesIntelligenceShell` | Views, URL state, one live subscription, page composition |
| `CoverageBanner` | `CoverageDto`, live connection state separately |
| `AttentionFilters`, `AttentionBand`, `AttentionRow`, `IdentityReviewRail` | Query state, server counts, `AttentionRowDto[]` |
| `NumbersView`, `NumberRow` | Number-list DTOs; do not require omitted `running_summary` |
| `OutreachPanel`, `OutreachActions` | Outreach detail envelope, legal command presentation |
| `NumberPanel`, `NumberTimeline`, `TimelineEntry`, `NumberAbout` | Number detail and typed activity union |
| `FindingCard`, `FindingsSection`, conversation review integration | Findings and transcript evidence |
| `MessageRepDialog`, `NextStepDialog`, `WaitingDialog`, `CloseDialog`, `WhichLeadDialog` | Controlled forms and explicit submit callbacks |
| `RepsView`, `RepLinkRow`, `RepLinkDialog` | `RepLinkDto`, directory choices, review commands |
| `CoverageView` | Coverage detail projection, backfill action |

Reuse `components/ui/side-panel.tsx`, shared buttons/inputs/badges, and the existing conversation presentation where repository access permits. If unavailable, provide isolated compatibility primitives and a replacement map. Scope styles to this feature; do not overwrite host `body`, navigation, or global tokens.

### Queries, writes, and live updates

- Use one query-key namespace with all filters, IDs, cursor, and applicable data scope. Preserve the host's scope behavior and read-only restrictions; do not assume cross-scope writes are supported.
- Implement `{ ok: true, data }` parsing and typed errors. Ordinary list responses include `items`, `next_cursor`, `as_of`, and `coverage`; exact endpoint exceptions follow 04.
- Send `expected_revision` or `expected_outreach_revision` with the exact command that requires it. Do not indiscriminately add fields to every body.
- Keep one idempotency key for the same submitted payload across retries; never reuse it for a changed command. Prevent duplicate clicks.
- Refresh affected detail, lists, overview, timeline, and findings after commands, including conflict recovery. Never optimistically claim a message was delivered or a Finding applied.
- One EventSource belongs to the shell. Merge only fields present in an event; otherwise invalidate/refetch affected queries. Deduplicate by stable IDs; retain cursor pages and selection.
- `coverage` SSE is only `{ known_through, gaps_count }`, not a complete CoverageDto. Refetch full coverage when needed. Finding events do not supply all contextual IDs needed to patch every panel; invalidate conservatively.
- Resync overview/current list every five minutes while visible, after ≥240 seconds hidden, and on reconnect. Use abort/cancellation or request identity to prevent old search results replacing newer ones.
- Use subtle entry highlights and reduced-motion alternatives. A moving list must preserve the row being edited and not move a Send control under the pointer.
- Audio URL requests remain click-triggered, short-lived, and outside persistent/query caching. Use the existing conversation audio contract.

### Suggested export structure

```text
app/(dashboard)/sales-intelligence/page.tsx
components/sales-intelligence/
  sales-intelligence-shell.tsx
  sales-intelligence-copy.ts
  sales-intelligence-tabs.ts
  attention/  numbers/  panels/  dialogs/  reps/  coverage/
lib/api/salesIntelligence.ts
lib/api/salesIntelligenceLive.ts
lib/api/salesIntelligenceBoard.ts
lib/query/salesIntelligence.ts
demo/sales-intelligence/fixtures.ts
demo/sales-intelligence/mock-client.ts
demo/sales-intelligence/scenarios.ts
INTEGRATION.md
CONTRACT-GAPS.md
```

The BFF/Owner authorization additions, query-key registration, and sidebar entry must be included as integration patches or precise integration instructions, not replaced with a demo boolean that pretends to secure the page. Keep demo bootstrap separate from the exportable feature.

## 10. API cheat sheet

All following paths use backend prefix `/api/v1/admin/sales-intelligence`; browser requests use `/api/proxy` before that prefix. These are **planned contracts**, not verified deployed routes.

| Method | Relative path | UI use |
| --- | --- | --- |
| GET | `/overview`, `/attention`, `/numbers` | Shell, work queue, number search |
| GET | `/numbers/:id`, `/numbers/:id/timeline` | Number detail and activity |
| POST | `/numbers/:id/classify`, `/numbers/:id/open-review`, `/numbers/:id/rebuild` | Eligibility/classification, Number Review, maintenance |
| GET | `/attachments` | Number/Lead attachment edges |
| POST | `/attachments/attach`, `/attachments/:id/reject` | Owner attachment review |
| GET | `/outreach/:id`, `/outreach/by-lead/:model/:id` | Outreach detail and entry from Lead |
| POST | `/outreach/:id/commands` | `mark_worked`, `set_next_action`, `set_waiting`, `assign`, `close`, `reopen`, `add_note` |
| POST | `/followups`, `/followups/:id/complete`, `/followups/:id/snooze` | Follow-up management |
| GET | `/conversations/:id/findings` | Finding list |
| POST | `/findings/:id/accept`, `/findings/:id/dismiss` | Review Findings |
| POST | `/conversations/:id/process` | Explicit processing request |
| GET | `/reps`, `/reps/:id` | Rep links and activity |
| POST | `/reps`, `/reps/propose`, `/reps/:id/review` | Create, suggest, review/update/retire |
| POST | `/nudges/preview`, `/nudges` | Preview without send; explicit send |
| GET | `/nudges?outreach_record_id=...` | Nudge history |
| GET / POST | `/coverage` / `/backfill` | Coverage / plan older history |
| GET | `/live` | Stream through dedicated SSE BFF |

Existing conversation routes outside that prefix: `/api/v1/admin/conversations/:id` and `/:id/audio-url`. Planned additive route: `/api/v1/admin/conversations/by-number/:contactNumberId`.

Read exact payloads and validators in 04 before writing adapters. Do not infer write bodies from a screen or a persistence schema.

## 11. Contract gaps: keep visible, do not silently fix in frontend

Include these in `CONTRACT-GAPS.md`. They do not prevent the visual design. Use explicitly marked mock scenarios and conservative UI until backend contracts are reconciled.

| Gap / conflict | Design and integration posture |
| --- | --- |
| 05 says “Nobody has called yet”; 01 forbids asserting unseen activity never happened | Use the scoped observed-outbound wording above. |
| 01 transition table makes accepted rep callback waiting; 03 §7 creates a call Follow-up and keeps it open | Mock the more specific effect in 03: rep callback → Follow-up; customer will call → waiting. Mark the conflict for backend resolution; UI renders the actual returned state. |
| 01 attributable-outbound rule is broader than its voicemail exception | Never independently transition a row based on voicemail or a provider-connected event. Render server state and flag backend policy ambiguity. |
| 05 No next step filter is absent in 04 query schema | Supported band 5 shortcut only; no invented predicate across other bands. |
| Wireframes show move route/date, exact routing count/transfer target, and summary source counts that shared DTOs lack | Omit unavailable details or put them in explicitly proposed optional mock extensions. Never pass them off as current API fields. |
| `last_meaningful_contact_at` includes non-conversation contact | Do not label it Last real conversation. |
| API acceptance cannot supply a manually resolved due date or pause-until time for a Finding | Show unresolved state; use separate documented explicit commands where appropriate. A richer acceptance form needs a backend contract. |
| 05 says suppression closes other work; `/classify` explicitly guarantees this while `/commands close:suppressed` does not spell out the same effect | Use the documented number-classify eligibility command for number-wide suppression, with reason. Confirm command semantics before wiring the close shortcut. |
| 05 promises Not this person for rep suggestions, but 04 has only review/retire/update | Do not invent `/reps/reject`; confirm whether retirement is the intended persistent rejection. |
| General cursor/coverage conventions differ from abbreviated endpoint examples; `FollowupDto` is referenced but not fully defined | Copy verified definitions when available. Record missing response wrappers/fields explicitly. Timeline uses `before`, and reps uses `links`, not an invented universal list envelope. |
| Attachment persistence certainty includes `rejected`, shared CertaintyDto omits it | Display Rejected using attachment state; do not silently widen the API certainty enum. |
| Numbers query encodings, legal sort values, internal timeline toggle, and filter option sources are underspecified | Keep production adapters limited to confirmed inputs; list proposed additions separately. |
| DTOs lack a general `allowed_actions` array | Use the documented transition presentation and supplied blockers; server revalidates. Do not claim such an array exists. |
| Presence/Live does not prove complete history, and paused AI does not prove audio capture | Wording must reflect the specific known capability; avoid blanket “nothing is lost” promises without evidence. |

## 12. Prototype scenarios and definition of done

Use synthetic names, numbers, and IDs. Keep a deterministic fixture clock and consistent dates/counts across views. Provide a demo-only scenario switcher outside the product navigation; never expose implementation toggles as Owner workflows.

Demonstrate:

- Fresh eligible Form Lead with no observed outbound; inbound-only activity does not mark it worked.
- Overdue accepted promised callback, owned Follow-up, missing next action, and cooldown.
- Number with no Lead and a review; ambiguous number with two Leads requiring a decision.
- Connected voicemail versus evidenced human conversation versus unknown connection.
- Suppressed, paused, company, and closed records in appropriate surfaces.
- Pending Finding, accepted Finding, unresolved due date, booking claim without official Booking.
- Reviewed/unreviewed Rep Identity Links; blocked preview, send pending, success, failure, and allowed pager fallback.
- Healthy coverage, a gap, null completeness, denied audio, paused AI, and SSE reconnect.
- Loading, empty, search-no-results, pagination failure, command validation, 409 conflict preserving input, feature off, and non-owner access.

Deliver:

1. Interactive four-view prototype with working drawers, tabs, search/filter behavior, and all core dialogs using the mock adapter.
2. Exportable React/Next.js source, including every referenced type and local component needed to run it. No TODO-only actions or hidden platform runtime dependency.
3. Separate fixtures and HTTP client integration; exact map from actions to documented methods/routes/payloads.
4. Scoped design tokens and responsive/accessibility notes.
5. `INTEGRATION.md`: dependencies, mount point, reusable primitive mapping, mock-to-HTTP switch, auth/BFF changes, environment requirements without secrets, and commands to run.
6. `CONTRACT-GAPS.md`: unresolved contracts and any proposed fields or UI additions, clearly distinguished from the authoritative pack.
7. Validation report: typecheck/build if the environment supports them; keyboard/mobile walkthrough and demonstrated state scenarios. Report what actually ran and what remains unverified.

The result is successful when we can replace the mock client with the real backend client, mount the feature in the existing dashboard, and retain the same visual components and interactions. Do not trade away this requirement for a prettier isolated demo.

## 13. Source file index and current implementation status

Paths below are workspace-relative to the multi-repo `vantage` folder; external Claude Design sessions need these supplied as attachments or repository files.

Authoritative product sources:

- `CONTEXT.md` — shared domain language.
- `docs/adr/0001-mongodb-system-of-record.md` — system-of-record boundary.
- `vantage-main-server/docs/index.md` — identifies this pack as the build contract.
- `vantage-main-server/docs/call-sales-intelligence/README.md` — scope/status.
- `vantage-main-server/docs/call-sales-intelligence/01-specification.md` — rules, state transitions, attention ranking.
- `vantage-main-server/docs/call-sales-intelligence/02-domain-models.md` — persistence models/enums; not browser DTOs.
- `vantage-main-server/docs/call-sales-intelligence/03-server-pipeline-and-jobs.md` — accepted Finding effects, nudge gates, SSE and Coverage projections.
- `vantage-main-server/docs/call-sales-intelligence/04-server-routes.md` — HTTP contracts, DTOs, validators, errors.
- `vantage-main-server/docs/call-sales-intelligence/05-owner-dashboard-ux.md` — intended views, interactions, copy, implementation map.
- `vantage-main-server/docs/call-sales-intelligence/06-delivery-plan-and-acceptance.md` — defaults and acceptance.

Existing host references inspected for integration:

- `vantage-admin/AGENTS.md` and `.cursor/rules/project-organization.mdc` — framework and ownership conventions.
- `vantage-admin/CONTEXT.md` — current page boundaries and navigation.
- `vantage-admin/package.json` — current dependency versions.
- `vantage-admin/app/globals.css` — palette and type tokens.
- `vantage-admin/lib/api/conversations.ts` — existing BFF and play-only audio client contract.
- `vantage-admin/components/conversations/conversation-panel.tsx` — existing props-based conversation view and audio handling.

Integration destinations identified by the pack / host map, to inspect before changing:

- `vantage-admin/components/ui/side-panel.tsx`
- `vantage-admin/components/layout/dashboard-nav.tsx`
- `vantage-admin/components/operational/operational-detail-panel.tsx`
- `vantage-admin/lib/query/keys.ts`
- `vantage-admin/server/auth/authorization.ts`
- `vantage-admin/app/api/proxy/[...path]/route.ts`
- `vantage-admin/app/api/daily-operations-live/route.ts`

At preparation time, the pack says not shipped, and searches of the local server/admin runtime folders found no `salesIntelligence`, `sales-intelligence`, or `numberActivity` implementation. The above new routes/components therefore remain planned, while the host integration patterns already exist. Recheck implementation status before final wiring.
