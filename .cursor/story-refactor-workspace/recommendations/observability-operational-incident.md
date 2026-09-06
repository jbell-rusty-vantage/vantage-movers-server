# Open Or Grow The One Incident For This Failure Family — operational story

- Status: recommended
- Service: `observability` (Wave A, in-progress)
- Pass: 4 of this service — `operationalIncident.service.ts`
- Remaining in this service: `adminObservability.service.ts`, `operationalReports.service.ts`, `notificationDigest.service.ts`
- Target: `src/services/observability/operationalIncident.service.ts`
- Knowledge: none (`docs/knowledge/services/` has no Observability Service). Software map: [`.cursor/rules/observability-service.mdc`](../../../.cursor/rules/observability-service.mdc) (best-effort; never break lead / booking / cancellation / CRM / RingCentral / sheets / Granot / cron; public import is the folder barrel; models via `getObservabilityModel()` / `getOperationalIncidentModel()`; env policy in `src/config/domain/observability.ts`; this file must keep one live Incident per fingerprint, `$inc count`, refresh last-seen, escalate severity `critical > error > warn` and never downgrade; `notification_state` throttle is **not** this file — leftover policy only advances `next_notify_at` after leftover `sendNotification` `ok: true`; rollups are deferred). Distinct from already-recommended write-this-happening-down: [`observability-record-operational-event.md`](observability-record-operational-event.md) (that file **asks** this after persist on `warn` / `error` / `critical`, warns `observability.incident.upsert_failed` and **keeps** the happening if this throws, then **asks** close when `autoResolveKey` is set, then leftover policy — this file never pino-logs, never persists an Operational Event, never emails). Distinct from already-recommended leftover SendGrid row: [`observability-email-notification.md`](observability-email-notification.md). Distinct from already-recommended leftover immediate policy: [`observability-notification-policy.md`](observability-notification-policy.md) (`markIncidentNotified` / `markIncidentSuppressed` stamp `notification_state` **there**; this file never reads `next_notify_at`). Distinct from later Admin Dashboard desk: `adminObservability.service.ts` (owner `acknowledged` / `resolved` / `ignored` / reopen `auto_resolved → open`; `admin.incident.status_changed`). Distinct from later operational reports: `operationalReports.service.ts`. Distinct from later leftover digest: `notificationDigest.service.ts` (`digest_sent_at`). Distinct from leftover fingerprint / leftover identity / leftover details bound (already-skipped). Distinct from leftover `OperationalIncident` schema: `src/models/OperationalIncident.ts` (unique partial `{ fingerprint: 1 }` where status is open / acknowledged; collection key `incidents` → `operational_incidents` / `test_operational_incidents`). Distinct from leftover `INCIDENT_OPEN_STATUSES` / leftover `observabilityLevelRank`: `src/config/domain/observability.ts` (this file hardcodes `["open", "acknowledged"]` and asks leftover rank). Distinct from already-recommended Granot Section 33 catalog / leftover rollout alerts: [`granot-lifecycle-observability.md`](granot-lifecycle-observability.md) / [`granot-lifecycle-alerts.md`](granot-lifecycle-alerts.md) (those **ask** leftover record with `dedupeKey` + `autoResolveKey`; they do not import this file). Distinct from already-recommended leftover Sheet Sync drain / leftover RingCentral Call Log / leftover analytics reconcile (same pair through leftover record). This checkout’s `CONTEXT.md` names “Workflow Observational” in the intro and does not define Incident — do not invent a glossary copy. `docs/adr/` is absent here — do not invent ADR copies. Do not add an Observability Service file in this rename.
- Callers: already-recommended `recordOperationalEvent.ts` (`upsertIncidentForEvent` + `autoResolveIncidents` by path). Folder barrel `observability/index.ts` re-exports both. No domain / Wave B file imports this module — leftover Sheet Sync drain `sheet_sync.drain.partial_failure:${env}`, leftover RingCentral `ringcentral.call_log_sync.failed:${env}`, leftover analytics reconcile `ringcentral.analytics_reconcile.failed:…`, leftover Granot `granot_lifecycle.alert.*` **ask** leftover record. Later Admin status does **not** call this. Tests: **no** `operationalIncident.service.test.ts` (leftover `observability-hardening-implementation-plan.md` still lists it as to-be-created). Leftover `fingerprint.test.ts` proves leftover hash fold, not leftover upsert. Leftover `src/config/domain/observability.test.ts` covers leftover flags, not leftover count / leftover escalate / leftover auto-resolve. Leftover `observability-review-report.md` still claims leftover `$setOnInsert` only for leftover severity — **stale**; current leftover `$set` asks leftover `worseSeverity`.
- Seams callers need: open-or-grow (`upsertIncidentForEvent`: find the live fingerprint, upsert `open` on first write, `$inc count` + escalate leftover severity + refresh last-seen on later write, `isNew: !before`) vs close-matching (`autoResolveIncidents`: leftover fingerprint wins leftover `dedupe_key`; `$set status auto_resolved` + leftover `resolved_at` on leftover open / leftover acknowledged; `0` when neither key). There is no leftover email **seam**. There is no leftover `notification_state` **seam**. There is no leftover owner leftover-status **seam**. There is no begin / complete **seam**. There is no Domain Command **seam**. This file **may throw**; leftover record leftover-catches.
- Split later (only if the file outgrows one sitting): this ~165-line file is one sitting if you read it as open or grow the one Incident for this failure family, or close those Incidents when a matching success arrives — the same leftover fingerprint stays one live row, worse leftover severity wins, a clean leftover drain closes leftover `dedupe_key`, the next leftover failure opens **new** after leftover `auto_resolved`. Do **not** split leftover upsert / leftover auto-resolve / leftover severity into `create.ts` / `update.ts` / `resolve.ts`. Do **not** pull leftover record / leftover policy / leftover Admin desk / leftover fingerprint here so “Incident owns the company.” If it later splits: `openOrGrowTheIncidentForThisFailureFamily.ts` / `closeMatchingIncidentsBecauseAMatchingSuccessArrived.ts` only as later story files, never `create.ts` / `update.ts` / `delete.ts` / `resolve.ts`

`upsertIncidentForEvent` / `autoResolveIncidents` / `worseSeverity` are executor mechanics. The owner question is: *This drain failed again. Is it the same family we already have open? Grow that one Incident. Do not open a second. If a later happening of that family is worse, raise leftover severity — never lower it because a leftover warn arrived after leftover critical. If the next drain is clean, close those leftover open / leftover acknowledged Incidents as leftover `auto_resolved`. The next leftover failure of that leftover fingerprint is a **new** Incident. Never email. Never write an Operational Event. Never stamp leftover `notification_state` — leftover policy does that after leftover send leftover `ok`. If leftover Mongo throws, leftover record leftover-warns and keeps the happening.*

Later leftover write-this-happening-down, leftover immediate policy, leftover SendGrid row, leftover Admin leftover-status, leftover digest leftover `digest_sent_at`, leftover fingerprint fold, leftover env flags, leftover Granot catalog / leftover alerts, leftover Sheet Sync drain, leftover RingCentral leftover Call Log, and leftover unique leftover fingerprint leftover index already live in other **modules**. Do not pull those in.

## What this file actually does

Two adapters of one “open or grow the one Incident for this failure family” story, not “an Incident CRUD service,” and not the leftover owner leftover-status desk or leftover email:

1. **Open or grow the one Incident for this failure family** — `upsertIncidentForEvent`. `findOne` `{ fingerprint, status: { $in: ["open", "acknowledged"] } }` select `_id` + leftover `severity`. `findOneAndUpdate` the same match: `$setOnInsert` leftover `status: "open"`, leftover fingerprint / leftover `dedupe_key` / leftover `event_key` / leftover category / leftover workflow / leftover title / leftover environment / leftover service / leftover `first_event_id` / leftover `first_seen_at` / leftover `owner_visible`; leftover `$set` leftover `worseSeverity(before, incoming)` using leftover `observabilityLevelRank`, leftover summary, leftover source / leftover route / leftover entity / leftover lead leftover name / leftover phone / leftover email / leftover `run_id`, leftover `latest_event_id`, leftover `last_seen_at`, leftover `last_details`; leftover `$inc count`. Leftover `returnDocument: "after"`, leftover upsert, leftover `setDefaultsOnInsert`. Leftover `isNew: !before`. The unique leftover partial leftover index leftover-enforces one leftover live leftover fingerprint. Leftover acknowledged leftover-stays leftover acknowledged (leftover count leftover-grows; leftover status does **not** leftover-flip leftover `open`). Leftover `resolved` / leftover `ignored` / leftover `auto_resolved` do **not** leftover-match, so leftover next leftover failure leftover-inserts leftover **new**.

2. **Close matching Incidents because a matching success arrived** — `autoResolveIncidents`. Neither leftover `dedupeKey` leftover nor leftover `fingerprint`: leftover `0`. Leftover fingerprint leftover-set: leftover-match leftover `fingerprint` (leftover **ignore** leftover `dedupeKey`). Else leftover-match leftover `dedupe_key`. Leftover live leftover statuses leftover-only leftover open / leftover acknowledged. Leftover `$set status: "auto_resolved"`, leftover `resolved_at: now ?? new Date()`. Return leftover `modifiedCount`. Leftover record leftover-only leftover-passes leftover `dedupeKey: input.autoResolveKey` — leftover runtime leftover never leftover-hands leftover fingerprint. Does **not** leftover-write leftover `notification_state`, leftover `acknowledged_*`, leftover an Operational Event, leftover an email.

There is no third owner operation. Leftover `worseSeverity` is a leftover beat, not a public **seam**. Do not export leftover `worseSeverity` as a public **seam**. Do not export later leftover `updateOperationalIncidentStatus` from this file as if this story leftover-owned leftover owner leftover-ack. Do not export leftover `dispatchEventNotifications` from this file as if this story leftover-owned leftover throttle.

## Organization

Keep one file. This is the screenplay for “open or grow the one Incident for this failure family.” Leftover write-this-happening-down, leftover fingerprint fold, leftover immediate policy, leftover SendGrid row, leftover Admin leftover-status, leftover digest, leftover env flags, leftover unique leftover index, leftover Granot leftover alerts, leftover Sheet Sync leftover drain, leftover RingCentral leftover Call Log already live in deeper **modules**. Do not pull those in. Do not invent an `OperationalIncidentService` class. Do not invent a begin / complete **seam** — this is leftover after-the-fact leftover Mongo, not a Domain Command. Do not invent a second leftover Incident leftover-status **adapter** beside later leftover Admin leftover `applyIncidentStatus`. Do not invent a second leftover fingerprint **adapter** beside already-skipped leftover `computeFingerprint`.

Do not split leftover upsert vs leftover auto-resolve vs leftover severity into CRUD files. Do not leftover-move leftover `notification_state` leftover writes here so “one Incident leftover writer.” Do not leftover-move leftover `admin.incident.status_changed` here so “Incident leftover-owns leftover owner leftover-ack.”

**External interface** stays small (this is the test surface):

| Keep exporting | Story name | Why the seam exists |
|---|---|---|
| `upsertIncidentForEvent` | `openOrGrowTheIncidentForThisFailureFamily` | leftover record **asks** after leftover persist on leftover failure; leftover one leftover live leftover fingerprint |
| `autoResolveIncidents` | `closeMatchingIncidentsBecauseAMatchingSuccessArrived` | leftover record **asks** leftover caller leftover `autoResolveKey` (leftover `dedupe_key`), not leftover this happening’s leftover computed leftover hash |
| `UpsertIncidentInput` | `FailureFamilyWeAreAboutToOpenOrGrow` | leftover camelCase leftover bag leftover record leftover-builds; leftover Mongo leftover-stays leftover `snake_case` |
| `UpsertIncidentResult` | `HowTheIncidentForThisFailureFamilyEnded` | leftover document + leftover `isNew` leftover-today leftover-unused by leftover record |

Keep the old names as one-line aliases until leftover record and the folder barrel migrate. Do not make callers learn leftover `worseSeverity` / leftover `INCIDENT_OPEN_STATUSES` / leftover `isNew` as the domain language.

**No class for the workflow.** The type that *does* earn a name is the leftover handoff leftover record leftover-already leftover-uses:

```ts
type HowTheIncidentForThisFailureFamilyEnded = {
  /* today's UpsertIncidentResult — leftover incident document; leftover openedFresh is leftover isNew */
}
```

That is the handoff from “leftover record leftover-persisted a leftover failure” to “leftover stamp leftover `incident_id`, leftover maybe leftover-email.” Do **not** add leftover `persist: boolean` so “every leftover caller leftover-looks like a leftover command,” and do **not** leftover-collapse leftover Admin leftover-status leftover-into this type so “every leftover status leftover-looks like leftover upsert.”

## The file, as a story

Parent functions stay deep. Child names are only extracted when they hide a real decision, not a one-liner.

```ts
// operationalIncident.service.ts
// This failure happened again.
// Is it the same family we already have open or acknowledged?
// Grow that one Incident.
// Do not open a second.
// If this happening is worse, raise leftover severity.
// Never leftover-lower leftover severity because a leftover warn arrived later.
// If a matching success arrives, close those leftover live Incidents.
// The next leftover failure of that leftover fingerprint is a new Incident.
// Never email.
// Never write an Operational Event.
// Never stamp leftover notification_state.

// ── 1. Open or grow the one Incident for this failure family ─

export async function openOrGrowTheIncidentForThisFailureFamily(failure)
export const upsertIncidentForEvent = openOrGrowTheIncidentForThisFailureFamily

async function findTheLiveIncidentForThisFingerprint(fingerprint)
function theWorseSeverityWins(current, incoming)      // leftover critical > leftover error > leftover warn; never leftover-downgrade
async function insertOrGrowTheLiveIncident(failure, before)
function thisFamilyWasAlreadyLive(before)             // leftover isNew: !before — leftover unused by leftover record

// ── 2. Close matching Incidents because a matching success arrived ─

export async function closeMatchingIncidentsBecauseAMatchingSuccessArrived({
  dedupeKey,
  fingerprint,
  now,
})
export const autoResolveIncidents =
  closeMatchingIncidentsBecauseAMatchingSuccessArrived

function neitherFamilyKeyWasGiven(dedupeKey, fingerprint)
function matchTheLiveFamily(dedupeKey, fingerprint)   // leftover fingerprint leftover-wins leftover dedupe_key
async function markThoseLiveIncidentsAutoResolved(match, now)
```

Read the primary path out loud: *Sheet Sync leftover drain leftover-finished with leftover failed leftover jobs. Leftover record leftover-already leftover-wrote leftover `sheet_sync.drain.partial_failure` at leftover `warn` and leftover-hashed leftover `dedupeKey` leftover `sheet_sync.drain.partial_failure:${env}`. Ask this file to leftover-open or leftover-grow the Incident. Leftover find leftover the leftover live leftover fingerprint. There is leftover none. Leftover insert leftover `open`, leftover count leftover 1, leftover first-seen / leftover first leftover event, leftover title leftover-from leftover summary, leftover `owner_visible` leftover-from leftover this leftover write. Leftover return leftover `isNew: true`. Leftover record leftover-stamps leftover `incident_id`. Leftover later leftover policy leftover-may leftover-email. The leftover next leftover drain with leftover failed leftover jobs leftover-finds leftover that leftover open leftover row, leftover `$inc count`, leftover-escalates leftover severity leftover-if leftover `error` / leftover `critical` leftover-arrives, leftover-refreshes leftover last-seen / leftover last leftover details. Leftover title, leftover `event_key`, leftover workflow, leftover environment, leftover `owner_visible` leftover-stay leftover the leftover first leftover write. A leftover clean leftover `sheet_sync.drain.completed` leftover-hands leftover `autoResolveKey` leftover `sheet_sync.drain.partial_failure:${env}`. Leftover record **asks** leftover close. This file leftover `$set status auto_resolved` + leftover `resolved_at` leftover-on leftover open / leftover acknowledged leftover rows leftover-with leftover that leftover `dedupe_key`. The leftover next leftover failure leftover-of leftover that leftover fingerprint leftover-opens leftover a **new** Incident leftover-because leftover unique leftover fingerprint leftover-only leftover-covers leftover live leftover statuses. Never leftover-email. Never leftover-write leftover an Operational Event. Never leftover-stamp leftover `notification_state`. If leftover Mongo leftover-throws, leftover record leftover-warns leftover `observability.incident.upsert_failed` / leftover `observability.incident.auto_resolve_failed` leftover-and leftover-keeps leftover the happening. The leftover drain leftover-already leftover-finished.*

That is the operation. Leftover `worseSeverity` is leftover the leftover escalate leftover beat, leftover not leftover a leftover second leftover live leftover path. Leftover later leftover `updateOperationalIncidentStatus` leftover is leftover not leftover this leftover decision.

## Precise logic I would tighten while renaming

These are real smells the story names make obvious. Do not “just rename.”

1. **This file may throw. Never-throw is leftover record’s product.** The rule says Incident paths must not break lead / booking / cancellation / CRM / RingCentral / sheets / Granot / cron. Leftover record already `try`s both adapters and leftover-warns. Do not wrap every Mongo call here so “Incident never throws” unless leftover record also stops catching — two swallows hide leftover `isNew`. Do not `await` this inside a Domain Command transaction so “the Incident commits with the Booking.”

2. **Never write an Operational Event here.** Leftover record owns persist + leftover `notification.email.failed`. Later Admin owns leftover `admin.incident.status_changed`. Do not call leftover `writeThisHappeningDown` from leftover close so “auto-resolve is audited,” and do not set leftover `notificationCandidate: true` on such a happening.

3. **Never stamp leftover `notification_state` here.** Leftover policy only advances leftover `immediate_sent_at` / leftover `next_notify_at` after leftover `ok: true`, and leftover `$inc suppressed_count` when the family was just emailed. Do not clear leftover `next_notify_at` on leftover auto-resolve so “a closed family can page immediately if reopened as the same row” — leftover reopen after leftover `auto_resolved` is a **new** document anyway. Do not write leftover `digest_sent_at` here so “one leftover `notification_state` writer.”

4. **Severity already escalates.** Leftover `observability-review-report.md` still says leftover `$setOnInsert` only. Current leftover `$set` asks leftover `worseSeverity`. Leftover hardening plan already asked for that. Rename against the file, not the leftover report. Do not revert to leftover `$setOnInsert` only so “the stale leftover report is implemented.” Do not rewrite that leftover markdown in this pass.

5. **Never leftover-downgrade leftover severity.** First leftover `critical`, then same leftover fingerprint leftover `warn`, stays leftover `critical`. Later Admin leftover overview leftover-counts by leftover severity from this field. Do not leftover `$set` incoming leftover severity blindly so “last write wins.”

6. **Leftover `owner_visible` / leftover title / leftover `event_key` / leftover workflow / leftover environment are leftover `$setOnInsert` only.** A later leftover-critical happening with leftover lead leftover identity does **not** leftover-flip leftover `owner_visible`. Leftover title stays the first leftover summary clip. Do not leftover `$set` leftover `owner_visible: true` on every later write so “the leftover desk sees the leftover customer,” and do not leftover `$set` leftover title from every later leftover summary so “the leftover list tracks the latest leftover sentence.” Those first-write fields are the leftover family name until a later pass proves they should move.

7. **`isNew` is unused and can lie.** Leftover record reads `upsert.incident` only and stamps `incident_id`. `isNew: !before` is the first `findOne`, not the upsert outcome. Two concurrent first writes can both see `before: null`; the unique index fails the second with `E11000`. Do not treat `isNew` as “this row was inserted” until the upsert itself says so. Do not export `isNew` as the domain language.

8. **Find-then-upsert is two trips.** The unique partial `{ fingerprint: 1 }` where status is open / acknowledged is the fence, not the `findOne`. A concurrent first write can `E11000`. Leftover record warns `observability.incident.upsert_failed` and keeps the happening. Do not retry-hide `E11000` here so “Incident never throws” unless leftover record also stops catching.

9. **Runtime never hands fingerprint to close.** Leftover record only passes `dedupeKey: input.autoResolveKey`. Fingerprint wins when both are set, but no live caller sets it. Do not change leftover record to pass this happening’s computed hash so “close uses the same key as open” — `autoResolveKey` is the caller’s family string (`sheet_sync.drain.partial_failure:${env}`), not `computeFingerprint`. Do not drop the fingerprint param on this pass because “nothing uses it.”

10. **Auto-resolve closes acknowledged too.** The owner acked the family and a clean drain still `$set status auto_resolved`. Do not skip acknowledged so “owner ack is sacred” without a later Admin pass proving that. Do not flip acknowledged back to open on grow — grow already leaves status alone.

11. **Auto-resolve writes no event, no email, no `notification_state`.** `modifiedCount` is the only return. Later leftover policy will not see a close. Do not email “this family is healthy” from here, and do not clear `next_notify_at` so “the next failure pages immediately” — that next failure is a **new** document with empty throttle.

12. **`INCIDENT_OPEN_STATUSES` is unused here.** Config already exports `["open", "acknowledged"]`. This file hardcodes the same array twice. Do not import it in this rename as if that were the story, and do not add `resolved` to the live set so “one fingerprint forever.”

13. **The barrel exports both adapters.** Leftover record imports by path. No domain file should learn `upsertIncidentForEvent` from `observability/index.ts` and skip leftover record’s persist + `incident_id` stamp + leftover policy ask. Do not call this file from `runSheetSyncDrain` so “drain owns its Incident,” and do not remove the barrel export on this pass because “nothing else calls it.”

14. **Leave sibling modules alone.** Leftover `writeThisHappeningDown` (persist + `incident_id` + leftover policy ask), leftover `computeFingerprint`, leftover `askWhetherTheOwnerShouldHearAboutThisHappeningRightNow`, later Admin status, and later leftover digest are already the right **depth**. This file orchestrates open-or-grow + close-matching.

15. **Do not silently add rollups.** The rule says rollups are deferred. Later Admin overview counts open Incidents from this collection. Do not write a metrics row from this file so “count is cheap.”

16. **Do not treat later Admin reopen / status as this story.** `auto_resolved → open` is a new owner command on a later desk file. Do not reopen here so “close can undo itself.”

17. **Do not silently fix the stale review report.** Leftover `observability-review-report.md` still says severity is `$setOnInsert` only. Rename against the file. Do not rewrite that markdown in this pass.

## Testing

The **interface** is the test surface: `openOrGrowTheIncidentForThisFailureFamily`, `closeMatchingIncidentsBecauseAMatchingSuccessArrived`.

Today there is no `operationalIncident.service.test.ts`. Leftover fingerprint tests next door only prove leftover hash fold. That is not enough for a story this load-bearing.

Add tests that name the operation. They will need a replica / injected Incident model — do not hit leftover live SendGrid from `pnpm test`:

**Open or grow the one Incident for this failure family**
- One live fingerprint: first `warn` inserts `open`, `count` 1, `first_event_id` / `first_seen_at` / title from the summary clip, `owner_visible` from this write, `isNew: true` when `findOne` missed.
- Same live fingerprint again: `$inc count`, refresh `latest_event_id` / `last_seen_at` / `last_details` / summary / source / route / entity / lead / `run_id`. Title, `event_key`, workflow, environment, `owner_visible` stay the first write.
- Escalate, never downgrade: `warn` then `error` then `critical` raises; `critical` then `warn` stays `critical`.
- Acknowledged stays acknowledged: grow increments `count` and does **not** flip status to `open`.
- `resolved` / `ignored` / `auto_resolved` do not match: the next failure inserts a **new** row (unique partial index only covers live statuses).
- This file may throw: `E11000` / Mongo throw surfaces to leftover record. Do not swallow here.

**Close matching Incidents because a matching success arrived**
- Neither `dedupeKey` nor fingerprint: return `0`, no write.
- `dedupeKey` only (runtime path): `$set status auto_resolved` + `resolved_at` on leftover open / leftover acknowledged rows with that `dedupe_key`. Return `modifiedCount`.
- Fingerprint set: match leftover `fingerprint` and **ignore** leftover `dedupeKey`.
- Auto-resolve does **not** write `notification_state`, does **not** persist an Operational Event, does **not** email.
- A later failure of the same leftover fingerprint after leftover `auto_resolved` opens a **new** Incident.

Do **not** add a test per helper (`theWorseSeverityWins`, `neitherFamilyKeyWasGiven`, `thisFamilyWasAlreadyLive`). Those names exist so the parent reads. If a helper test has to change when the helper is inlined, it was testing past the **interface**.

Do **not** export leftover `worseSeverity` “so the test can assert leftover escalate” as a public **seam**.

## What I would not do

- An `OperationalIncidentService` class with `create` / `update` / `delete`.
- Thirty two-line functions that only wrap leftover `Incident.findOneAndUpdate` / leftover `Incident.updateMany`.
- Moving this into a CRUD folder (`create.ts` / `update.ts` / `resolve.ts`) for cleanliness.
- Breaking the may-throw **seam**. Leftover record already catches; a second swallow here hides leftover `isNew` / leftover `E11000`.
- Treating already-recommended leftover `writeThisHappeningDown` as this story. That persist + leftover `incident_id` stamp + leftover policy ask is a different origin.
- Treating already-recommended leftover `askWhetherTheOwnerShouldHearAboutThisHappeningRightNow` as this story. That throttle lives after leftover send leftover `ok`.
- Treating later leftover Admin leftover status / leftover reopen as this story. Those owner commands live on a later desk file.
- Inventing a begin / complete **seam** that has only one **adapter**.
- Inventing a second leftover Incident leftover-status **adapter** beside later leftover Admin leftover `applyIncidentStatus`.
- Silently stamping leftover `notification_state` here so “one Incident writer.”
- Silently reverting leftover severity to leftover `$setOnInsert` only so “the stale leftover review report is implemented.”
- Jumping to `reporting` while this service has unchecked modules.
- Writing a whole-folder recommendation for `observability`.

