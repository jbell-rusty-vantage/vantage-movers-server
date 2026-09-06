# Show The Owner The Observational Desk And Work These Incidents — operational story

- Status: recommended
- Service: `observability` (Wave A, in-progress)
- Pass: 5 of this service — `adminObservability.service.ts`
- Remaining in this service: `operationalReports.service.ts`, `notificationDigest.service.ts`
- Target: `src/services/observability/adminObservability.service.ts`
- Knowledge: none (`docs/knowledge/services/` has no Observability Service). Software map: [`.cursor/rules/observability-service.mdc`](../../../.cursor/rules/observability-service.mdc) (best-effort; never break lead / booking / cancellation / CRM / RingCentral / sheets / Granot / cron; public import is the folder barrel; models via getters; env policy in `src/config/domain/observability.ts`; rollups are deferred — this overview aggregates live; Observability deletes are the explicit Admin exception). Distinct from already-recommended write-this-happening-down: [`observability-record-operational-event.md`](observability-record-operational-event.md) (this file **asks** `recordOperationalEvent` only after the owner status save, `admin.incident.status_changed`, `reportable: false`). Distinct from already-recommended leftover SendGrid row: [`observability-email-notification.md`](observability-email-notification.md) (this file lists Delivery rows; it never sends). Distinct from already-recommended leftover immediate policy: [`observability-notification-policy.md`](observability-notification-policy.md) (`next_notify_at` stays there; owner status here does **not** stamp `notification_state`). Distinct from already-recommended leftover open-or-grow: [`observability-operational-incident.md`](observability-operational-incident.md) (fingerprint upsert / auto-resolve; owner `acknowledged` / `resolved` / `ignored` / reopen `auto_resolved → open` live **here**). Distinct from later leftover reports: `operationalReports.service.ts` (Wave B report handlers **ask** that sibling; facets only copy `OPERATIONAL_REPORT_KEYS`). Distinct from later leftover digest: `notificationDigest.service.ts` (**asks** `getObservabilityOverview({})` for `purpose: "daily_digest"`). Distinct from already-recommended leftover Sheet Sync health: [`admin-sheet-sync.md`](admin-sheet-sync.md) (overview **asks** `getSheetSyncHealth`, `.catch(() => null)`). Distinct from already-recommended leftover Admin Dashboard resource desk / leftover CSV: [`admin-browse.md`](admin-browse.md) / [`admin-export.md`](admin-export.md). Distinct from leftover fingerprint / leftover identity / leftover details bound (already-skipped). Distinct from leftover Wave B `src/routes/v1.routes.ts` Observational handlers (thin parse → this file). Distinct from leftover `OperationalIncident` schema and leftover `INCIDENT_STATUSES` / leftover `INCIDENT_SEVERITIES`. Distinct from already-recommended leftover Granot Section 33 catalog: [`granot-lifecycle-observability.md`](granot-lifecycle-observability.md). This checkout’s `CONTEXT.md` names “Workflow Observational” in the intro and does not define Observational desk / owner status — do not invent a glossary copy. `docs/adr/` is absent here — do not invent ADR copies. Do not add an Observability Service file in this rename.
- Callers: Wave B `src/routes/v1.routes.ts` (`GET .../observability/{overview,facets,events,events/:id,incidents,incidents/:id,notifications}`; `PATCH .../incidents/:id/status` + `PATCH .../incidents/status`; `DELETE .../:collection/:id` + `POST .../:collection/delete`; `GET .../exports/observability/{events,incidents}.csv`). Folder barrel `observability/index.ts` re-exports the twelve desk names (not `buildEventFilter` / `buildIncidentFilter` / `compareIncidentSeverity`). Later leftover digest **asks** `getObservabilityOverview` by path. Tests: `adminObservability.service.test.ts` only proves filter helpers + `compareIncidentSeverity` rank + facets Zod coerce. No overview health test. No status transition test. No delete test. No CSV test.
- Seams callers need: healthy-this-morning (`getObservabilityOverview`: default Eastern start-of-day → now; leftover digest is the empty-query **adapter**) vs fill-the-chips (`getObservabilityFacets`) vs happenings-desk (`listOperationalEvents` / `getOperationalEventDetail` / `exportOperationalEventsCsv` share `buildEventFilter`) vs Incident-desk (`listOperationalIncidents` / `getOperationalIncidentDetail` / `exportOperationalIncidentsCsv` share `buildIncidentFilter`) vs work-this-Incident (`updateOperationalIncidentStatus` vs `updateOperationalIncidentStatuses`: same transition table + after-save `admin.incident.status_changed`) vs leftover-emails (`listNotificationDeliveries`) vs forget-leftover-rows (`deleteObservabilityRecords`; `deleteObservabilityRecord` is the one-id **adapter**). There is no begin / complete **seam**. There is no Domain Command **seam**. There is no leftover fingerprint upsert **seam**. There is no leftover email send **seam**. There is no leftover report-run **seam**.
- Split later (only if the file outgrows one sitting): this ~850-line file is one sitting if you read it as show the owner the Observational desk and work these Incidents. Do **not** split events vs Incidents vs overview into `list.ts` / `get.ts` / `update.ts` / `delete.ts`. Do **not** pull leftover record / leftover upsert / leftover reports / leftover digest here so “the desk owns the company.” If it later splits: `tellTheOwnerWhetherTheCompanyIsHealthyThisMorning.ts` / `showTheHappeningsDesk.ts` / `showTheIncidentDesk.ts` / `workThisIncident.ts` / `forgetLeftoverObservationalRows.ts` only as later story files, never `create.ts` / `update.ts` / `delete.ts` / `list.ts` / `get.ts`

`listOperationalEvents` / `updateOperationalIncidentStatus` / `deleteObservabilityRecords` are executor mechanics. The owner question is: *Open the Observational tab. Is the company healthy this morning? Let me find this customer’s happening or the one Incident we already have open. When I open the Incident, show the last happenings and the leftover emails and tell me what to do next. Let me acknowledge it, resolve it, ignore it, or reopen an auto-resolved family. Write `admin.incident.status_changed` after I save — not before. Do not open a second Incident here — leftover upsert already owns that. Do not email from this desk. If I forget leftover rows, delete them hard and do not cascade.*

Already-recommended leftover write-this-happening-down, leftover upsert, leftover policy, leftover SendGrid row, leftover Sheet Sync health, leftover Admin resource desk, later leftover reports, later leftover digest, leftover env flags, leftover Granot catalog already live in other **modules**. Do not pull those in.

## What this file actually does

Seven operations of one “show the owner the Observational desk and work these Incidents” story, not “an Observability CRUD service,” and not leftover upsert or leftover report run:

1. **Tell the owner whether the company is healthy this morning** — `getObservabilityOverview`. Default window is start of day in `America/New_York` → now (`startOfDayInTimeZone`). Event counts by level / category / workflow (workflow cap 20). Open + acknowledged Incidents group by severity → `overall_status` `critical` / `degraded` / `healthy`. Top ten open / acknowledged Incidents sort `severity_rank` then `last_seen_at`. Last ten `critical` happenings. **Asks** `getSheetSyncHealth` and swallows to `null`. RingCentral open Incident count. Delivery counts named `sent_today` / `failed_today` / `suppressed_today` but they use the **period**, not calendar today, unless the caller left the window default. Later leftover digest **asks** this with `{}`.

2. **Fill the Observational filter chips** — `getObservabilityFacets`. Distinct Event `workflow` / `event_key` / `source_company` / `entity_type` / `route` over the last 30 days (cap 200, locale sort). Static enums from config plus sibling `OPERATIONAL_REPORT_KEYS`. This file does **not** run a leftover report.

3. **Show the happenings desk** — `listOperationalEvents` / `getOperationalEventDetail` / `exportOperationalEventsCsv`. One filter (`buildEventFilter`): date on `occurred_at`; exact level / category / workflow / event_key / source / route / entity / run / request; lead name / email are case-insensitive contains; phone matches digits across formatting; `q` is `$text`. List uses `EVENT_LIST_PROJECTION` and the standard `{ items, page, limit, total, has_next_page }` page. Open one happening attaches the linked Incident when `incident_id` is set. Download walks the same filter, newest first, stops at 5_000 rows, leftover `toCsv`.

4. **Show the Incident desk** — `listOperationalIncidents` / `getOperationalIncidentDetail` / `exportOperationalIncidentsCsv`. One filter (`buildIncidentFilter`): date on `last_seen_at`; exact status / severity / category / workflow / event_key / source / entity / `owner_visible`; same lead identity; `q` is a regex `$or` on title / summary / event_key / workflow / lead_name / source_company — Incidents have no text index. Open one Incident loads the last 50 happenings and the last 50 Delivery rows, then `suggestedAction(event_key, category)` (prefix heuristics, not persisted). Download walks the same filter, 5_000 cap.

5. **Work this Incident** — `updateOperationalIncidentStatus` / `updateOperationalIncidentStatuses`. Same transition table: `open` → `acknowledged` / `resolved` / `ignored`; `acknowledged` → `resolved` / `ignored`; `ignored` / `resolved` / `auto_resolved` → `open`; same status is allowed. `applyIncidentStatus` stamps `resolved_at` / `acknowledged_at`+`acknowledged_by` / `ignored_at`+`ignored_by`; reopen to `open` only clears `resolved_at`. After **save**, **ask** leftover `recordOperationalEvent` (`admin.incident.status_changed`, `reportable: false`). One-id throws 409 on a bad transition. Batch skips `invalid_id` / `not_found` / `invalid_transition:from->to`, then save + event per row. Never **asks** leftover `upsertIncidentForEvent`. Never stamps `notification_state`.

6. **Show the leftover emails we sent** — `listNotificationDeliveries`. Date on `createdAt`. Exact status / purpose / recipient_type / provider. `incident_id` / `report_run_id` apply only when the id is a valid ObjectId — a bad id is silently dropped, not 400. `q` is case-insensitive subject contains.

7. **Forget leftover Observational rows** — `deleteObservabilityRecords` (one-id `deleteObservabilityRecord` is `{ ids: [id] }`). Events / Incidents / Delivery / report runs. Hard `deleteMany`. No Operational Event. No cascade (forgetting an Incident leaves its happenings). Invalid ids and missing ids skip.

There is no eighth leftover report-run operation. Wave B report handlers **ask** the reports sibling. Do not export `buildEventFilter` / `buildIncidentFilter` / `compareIncidentSeverity` / `suggestedAction` / `applyIncidentStatus` as a public **seam**.

## Organization

Keep one file. This is the screenplay for “show the owner the Observational desk and work these Incidents.” Leftover write-this-happening-down, leftover fingerprint upsert, leftover immediate policy, leftover SendGrid row, leftover Sheet Sync health, leftover Admin resource desk, later leftover reports, later leftover digest already live in deeper **modules**. Do not pull those in. Do not invent an `AdminObservabilityService` class. Do not invent a begin / complete **seam** — owner status is after-the-fact Mongo, not a Domain Command. Do not invent a second Incident-status **adapter** beside `applyIncidentStatus`. Do not invent a second leftover severity-rank **adapter** beside `INCIDENT_SEVERITY_RANK` / overview `$switch`.

Do not split events vs Incidents vs overview vs delete into CRUD files. Happenings list / open / download are three **adapters** of one desk. Incident list / open / download are three **adapters** of the other desk. One-id vs batch status are two **adapters** of one work-this-Incident story. One-id delete is a pass-through.

**External interface** stays small (this is the test surface):

| Keep exporting | Story name | Why the seam exists |
|---|---|---|
| `getObservabilityOverview` | `tellTheOwnerWhetherTheCompanyIsHealthyThisMorning` | Wave B overview; leftover digest **asks** with `{}` |
| `getObservabilityFacets` | `fillTheObservationalFilterChips` | one call for every dropdown |
| `listOperationalEvents` | `showTheHappeningsDesk` | Wave B event page |
| `getOperationalEventDetail` | `openOneHappening` | linked Incident when present |
| `exportOperationalEventsCsv` | `downloadTheHappeningsWindow` | same filter, 5_000 cap |
| `listOperationalIncidents` | `showTheIncidentDesk` | Wave B Incident page |
| `getOperationalIncidentDetail` | `openOneIncidentAndItsTrail` | last 50 happenings + leftover emails + suggested next step |
| `exportOperationalIncidentsCsv` | `downloadTheIncidentWindow` | same filter, 5_000 cap |
| `updateOperationalIncidentStatus` | `workThisIncident` | one-id; 409 on a bad transition |
| `updateOperationalIncidentStatuses` | `workTheseIncidents` | batch; skip instead of throw |
| `listNotificationDeliveries` | `showTheLeftoverEmailsWeSent` | leftover Delivery page |
| `deleteObservabilityRecords` | `forgetLeftoverObservationalRows` | hard delete; no cascade |
| `deleteObservabilityRecord` | leftover one-id **adapter** | `{ ids: [id] }` — keep as alias, do not teach a second story |

Keep the old names as one-line aliases until Wave B `v1.routes.ts`, the folder barrel, leftover digest, and `adminObservability.service.test.ts` migrate. Do not make callers learn `$text` / `ALLOWED_STATUS_TRANSITIONS` / `EVENT_LIST_PROJECTION` as the domain language.

**No class for the workflow.** The type that *does* earn a name is the morning card leftover digest already reads:

```ts
type ObservationalHealthThisMorning = {
  generated_at: string
  period: { from: string; to: string; timezone: "America/New_York" }
  health: {
    overall_status: "critical" | "degraded" | "healthy"
    open_critical: number
    open_error: number
    open_warn: number
  }
  // event counts, top open Incidents, recent critical, sheet_sync | null,
  // ringcentral.open_incidents, notifications.{sent,failed,suppressed}_today
}
```

That is the handoff from “we counted live open Incidents” to “paint the Observational home / write the leftover digest body.” Do **not** add `persist: boolean` so “every caller looks like a command,” and do **not** collapse owner status into this type so “every write looks like overview.”

## The file, as a story

Parent functions stay deep. Child names are only extracted when they hide a real decision, not a one-liner.

```ts
// adminObservability.service.ts
// The owner opens the Observational tab.
// Is the company healthy this morning?
// Find this customer's happening or the one Incident we already have open.
// Open the trail. Say what to do next.
// Acknowledge it, resolve it, ignore it, or reopen an auto-resolved family.
// Write admin.incident.status_changed after the save.
// Do not open a second Incident here.
// Do not email from this desk.
// If the owner forgets leftover rows, delete them hard and do not cascade.

// ── 1. Tell the owner whether the company is healthy this morning ─

export async function tellTheOwnerWhetherTheCompanyIsHealthyThisMorning(query)
export const getObservabilityOverview =
  tellTheOwnerWhetherTheCompanyIsHealthyThisMorning

function easternStartOfThisMorning(now)
async function countHappeningsByLevelCategoryAndWorkflow(from, to)
async function countOpenIncidentsBySeverity()
function decideOverallHealth(openCritical, openError)
async function listTheTenHottestOpenIncidents()
async function listTheTenLatestCriticalHappenings(from, to)
async function askSheetSyncHealthOrNull()
async function countOpenRingCentralIncidents()
async function countLeftoverEmailsInThisPeriod(from, to)

// ── 2. Fill the Observational filter chips ───────────────

export async function fillTheObservationalFilterChips(query)
export const getObservabilityFacets = fillTheObservationalFilterChips

function defaultThirtyDayWindow(query)
async function distinctEventChipValues(from, to)
function staticEnumsPlusReportKeys()

// ── 3. Show the happenings desk ──────────────────────────

export async function showTheHappeningsDesk(query)
export const listOperationalEvents = showTheHappeningsDesk

export async function openOneHappening(id)
export const getOperationalEventDetail = openOneHappening

export async function downloadTheHappeningsWindow(query)
export const exportOperationalEventsCsv = downloadTheHappeningsWindow

function matchHappeningsTheOwnerAskedFor(query)
function findThisCustomerOnTheHappening(query)
function attachTheLinkedIncidentIfAny(happening)

// ── 4. Show the Incident desk ────────────────────────────

export async function showTheIncidentDesk(query)
export const listOperationalIncidents = showTheIncidentDesk

export async function openOneIncidentAndItsTrail(id)
export const getOperationalIncidentDetail = openOneIncidentAndItsTrail

export async function downloadTheIncidentWindow(query)
export const exportOperationalIncidentsCsv = downloadTheIncidentWindow

function matchIncidentsTheOwnerAskedFor(query)
async function loadTheLastFiftyHappeningsAndEmails(incident)
function suggestWhatToDoNext(eventKey, category)

// ── 5. Work this Incident ────────────────────────────────

export async function workThisIncident(id, input)
export const updateOperationalIncidentStatus = workThisIncident

export async function workTheseIncidents(input)
export const updateOperationalIncidentStatuses = workTheseIncidents

function thisStatusChangeIsAllowed(current, next)
function stampTheOwnerStatusClock(incident, next, actor, now)
async function writeThatTheOwnerChangedStatus(incidentId, current, next, input)

// ── 6. Show the leftover emails we sent ──────────────────

export async function showTheLeftoverEmailsWeSent(query)
export const listNotificationDeliveries = showTheLeftoverEmailsWeSent

// ── 7. Forget leftover Observational rows ────────────────

export async function forgetLeftoverObservationalRows(collection, input)
export const deleteObservabilityRecords = forgetLeftoverObservationalRows
export const deleteObservabilityRecord = (collection, id) =>
  forgetLeftoverObservationalRows(collection, { ids: [id] })
```

Read the primary path out loud: *The owner opens the Observational tab. Ask whether the company is healthy this morning. Default window is Eastern midnight to now. Count happenings. Count open and acknowledged Incidents by severity. One critical Incident makes `overall_status` critical. Ask Sheet Sync health; if that desk throws, paint `null` and do not fail the morning card. Leftover digest asks the same card with `{}`. The owner pastes a phone and opens the happenings desk. Digits match across formatting. They open the linked Incident. Show the last fifty happenings, the last fifty leftover emails, and the prefix hint for what to do next. They acknowledge it. Save first. Then write `admin.incident.status_changed` with `reportable: false`. Do not call leftover upsert. Do not stamp `notification_state`. Do not email from this desk.*

That is the operation. `listOperationalEvents` is not. `updateOperationalIncidentStatus` is the owner command, not leftover fingerprint grow.

## Precise logic I would tighten while renaming

These are real smells the story names make obvious. Do not “just rename.”

1. **`deleteObservabilityRecord` is a pass-through.** It only wraps `{ ids: [id] }`. Keep it as a one-line alias. Do not teach routes a second forget story.

2. **`compareIncidentSeverity` is a test leak.** Only the test file imports it. Overview ranks with a Mongo `$switch`, not this helper. Do not export rank as a public **seam**. Do not rewrite overview to call this helper in the same rename just so “one rank lives in JS.”

3. **Today’s tests stop at the filter helpers.** They never prove healthy-this-morning, work-this-Incident, forget, or download. That is not enough for a desk this load-bearing. See Testing.

4. **`sent_today` lies when the window is not today.** The three Delivery counts use the query period. Leftover digest with `{}` is Eastern today, so the name holds there. A custom `from` / `to` still returns `sent_today`. Rename the bag to `sentInThisPeriod` (keep the old keys as aliases) or document the lie. Do not silently change the JSON keys on this pass.

5. **Reopen only clears `resolved_at`.** `auto_resolved` / `resolved` / `ignored` → `open` leaves `acknowledged_at` / `acknowledged_by` / `ignored_at` / `ignored_by` in place. Do not silently wipe those clocks so “reopen looks unused” unless a later pass proves the desk should.

6. **Same status is allowed and re-stamps.** `current === next` counts as allowed. Ack again refreshes `acknowledged_at` and writes another `admin.incident.status_changed`. Do not treat that as a no-op in this rename. Do not drop the same-status allow just because “the owner clicked twice.”

7. **Save, then write the happening.** The Incident is already persisted when leftover record is asked. If leftover record swallows, the owner still sees the new status and there is no audit happening. Do not move the happening before save so “audit can roll back the ack” — leftover record is best-effort and must not break the desk. Do not wrap the pair in a Domain Command transaction on this pass.

8. **Batch is sequential, not one transaction.** Each Incident saves, then writes its happening, then the next. A later skip does not undo an earlier ack. Do not invent a session so “all twelve acks commit together” without a later pass.

9. **Forget is hard delete with no happening and no cascade.** Forgetting an Incident leaves its happenings and leftover emails. Forgetting happenings leaves the Incident count stale. That is the explicit Admin exception. Do not emit `admin.observability.deleted` from here so “delete is audited,” and do not cascade so “the desk stays tidy.”

10. **A bad `incident_id` on leftover emails is dropped.** `listNotificationDeliveries` only applies the id when `mongoose.isValidObjectId`. A typo returns the unfiltered page, not 400. Do not silently 400 in this rename. Do not treat that as “the filter worked.”

11. **Happenings `q` is `$text`; Incident `q` is regex `$or`.** The comment already says Incidents have no text index. Do not add a text index in this rename. Do not make happenings use regex so “both desks match the same way.”

12. **`suggestedAction` is a prefix heuristic, not a stored next step.** Sheet Sync / RingCentral / CRM / auth / mongo prefixes, else a generic sentence. Do not persist it. Do not pull leftover Sheet Sync retry or leftover RingCentral cron into this file so “the hint can run the fix.”

13. **Overview swallows Sheet Sync health.** `.catch(() => null)` hides a dead leftover Sheet Sync desk behind a healthy morning card when no leftover critical Incident is open. Do not fail the overview when leftover health throws. Do not record `admin.overview.sheet_sync_failed` from here so “the swallow is visible” on this pass.

14. **Severity rank is written twice.** `INCIDENT_SEVERITY_RANK` plus the overview `$switch`. They currently agree (`critical` 3 / `error` 2 / `warn` 1). Do not “fix” one without the other. Do not import leftover `observabilityLevelRank` from config as if that were the story.

15. **Never stamp `notification_state` here.** Leftover policy only advances `next_notify_at` after leftover send `ok: true`. Owner ack / resolve / ignore / reopen must not clear the throttle so “the next failure pages immediately.” The next leftover failure after leftover auto-resolve is a **new** document anyway.

16. **Never call leftover `upsertIncidentForEvent` from owner status.** Growing a fingerprint is leftover record’s after-persist ask. This desk works the row the owner already has open.

17. **Facets copy leftover report keys and do not run leftover reports.** Wave B report handlers **ask** the reports sibling. Do not import leftover `runOperationalReport` here so “chips and run live together.”

18. **The barrel exports the whole desk.** Domain files should keep **asking** leftover record, not this file. Do not call `getObservabilityOverview` from leftover Sheet Sync drain so “drain paints its own health.”

19. **Leave sibling modules alone.** Leftover `writeThisHappeningDown`, leftover `openOrGrowTheIncidentForThisFailureFamily`, leftover `getSheetSyncHealth`, later leftover reports, later leftover digest are already the right **depth**. This file orchestrates the Observational desk.

20. **Do not silently add rollups.** The rule says rollups are deferred. Overview counts live. Do not write a metrics row from this file so “morning is cheap.”

## Testing

The **interface** is the test surface: `tellTheOwnerWhetherTheCompanyIsHealthyThisMorning`, `fillTheObservationalFilterChips`, `showTheHappeningsDesk` / `openOneHappening` / `downloadTheHappeningsWindow`, `showTheIncidentDesk` / `openOneIncidentAndItsTrail` / `downloadTheIncidentWindow`, `workThisIncident` / `workTheseIncidents`, `showTheLeftoverEmailsWeSent`, `forgetLeftoverObservationalRows`.

Today’s `adminObservability.service.test.ts` only proves `buildEventFilter` / `buildIncidentFilter` / `compareIncidentSeverity` and leftover facets Zod coerce. Keep the customer-search filter cases (they are load-bearing). Add tests that name the operations. They will need a replica / injected models — do not hit leftover live SendGrid or leftover live Sheet Sync from `pnpm test`:

**Tell the owner whether the company is healthy this morning**
- Default window is Eastern start-of-day → now when `from` / `to` are omitted.
- One open / acknowledged `critical` Incident → `overall_status: "critical"`; only `error` → `degraded`; none → `healthy`.
- Top open Incidents sort critical before error before warn, then `last_seen_at`.
- Leftover Sheet Sync throw becomes `sheet_sync: null` and the rest of the card still returns.
- Delivery counts follow the period. Leftover digest `{}` is Eastern today.
- This file does **not** persist a rollup.

**Show the happenings / Incident desks**
- Shared filter: exact fields stay exact; lead name / email contain; phone digits match across formatting.
- Happenings `q` uses `$text`. Incident `q` uses regex `$or`.
- Open one happening attaches the linked Incident when `incident_id` is set; missing happening → 404; bad id → 400.
- Open one Incident returns last 50 happenings, last 50 leftover emails, and a suggested next step. The hint is not stored.
- Download uses the same filter and stops at 5_000 rows.

**Work this Incident**
- `open` → `acknowledged` stamps `acknowledged_at` / `acknowledged_by`, then writes `admin.incident.status_changed` with `reportable: false`.
- Bad transition (one-id) → 409 and no happening.
- Batch skips `invalid_id` / `not_found` / `invalid_transition:from->to` and still saves the allowed rows.
- Reopen `auto_resolved` → `open` clears `resolved_at` only.
- Same status is allowed and re-stamps + writes another happening.
- Does **not** call leftover upsert. Does **not** stamp `notification_state`. Does **not** email.

**Forget leftover Observational rows**
- Hard delete. No happening. No cascade.
- Invalid / missing ids skip. Matched ids are the deleted set.

**Fill the chips / leftover emails**
- Distinct Event values cap at 200 and sort. Report keys come from the sibling constant, not a leftover run.
- Bad `incident_id` on leftover emails does **not** 400; the id filter is omitted.

Do **not** add a test per helper (`easternStartOfThisMorning`, `suggestWhatToDoNext`, `thisStatusChangeIsAllowed`). Those names exist so the parent reads. If a helper test has to change when the helper is inlined, it was testing past the **interface**.

Do **not** keep exporting `compareIncidentSeverity` “so the test can assert leftover rank” as a public **seam**. Move that assertion onto leftover `tellTheOwnerWhetherTheCompanyIsHealthyThisMorning` once the overview test exists.

## What I would not do

- An `AdminObservabilityService` class with `create` / `update` / `delete`.
- Thirty two-line functions that only wrap `Event.find` / `Incident.save`.
- Moving this into a CRUD folder (`list.ts` / `get.ts` / `update.ts` / `delete.ts`) for cleanliness.
- Breaking the after-save audit **seam**. The owner status commits first; leftover `admin.incident.status_changed` is best-effort.
- Treating already-recommended leftover `writeThisHappeningDown` as this story. That persist + leftover Incident upsert + leftover policy ask is a different origin.
- Treating already-recommended leftover `openOrGrowTheIncidentForThisFailureFamily` as this story. Owner ack / resolve / ignore / reopen live here.
- Treating later leftover reports or leftover digest as this story. Facets copy leftover report keys; leftover digest **asks** leftover overview with `{}`.
- Inventing a begin / complete **seam** that has only one **adapter**.
- Inventing a second leftover Incident-status **adapter** beside leftover `applyIncidentStatus`.
- Silently stamping leftover `notification_state` here so “one Incident writer.”
- Silently cascading leftover forget so “the desk stays tidy.”
- Silently adding leftover rollups so “morning is cheap.”
- Jumping to `reporting` while this service has unchecked modules.
- Writing a whole-folder recommendation for `observability`.
