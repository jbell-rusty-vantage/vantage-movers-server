# Write This Happening Down Without Breaking The Work — operational story

- Status: recommended
- Service: `observability` (Wave A, in-progress)
- Pass: 1 of this service — `recordOperationalEvent.ts`
- Remaining in this service: `emailNotification.service.ts`, `notificationPolicy.ts`, `operationalIncident.service.ts`, `adminObservability.service.ts`, `operationalReports.service.ts`, `notificationDigest.service.ts`
- Target: `src/services/observability/recordOperationalEvent.ts`
- Knowledge: none (`docs/knowledge/services/` has no Observability Service). Software map: [`.cursor/rules/observability-service.mdc`](../../../.cursor/rules/observability-service.mdc) (best-effort; never break lead / booking / cancellation / CRM / RingCentral / sheets / Granot / cron; public import is the folder barrel; models via `getObservabilityModel()`; env policy in `src/config/domain/observability.ts`; rollups are deferred). Distinct from already-recommended Granot Section 33 catalog: [`granot-lifecycle-observability.md`](granot-lifecycle-observability.md) + [`docs/knowledge/granot-lifecycle/observability.md`](../../../docs/knowledge/granot-lifecycle/observability.md) (`granotLifecycle/observability.ts` **asks** this after it allowlists and redacts). Distinct from leftover Wave B HTTP capture: `src/middleware/httpLogger.ts` / `requireApiSecret.ts` / `src/app.ts` (they **ask** this; they do not persist). Distinct from later Incident upsert: `operationalIncident.service.ts`. Distinct from later immediate email policy: `notificationPolicy.ts`. Distinct from later SendGrid delivery: `emailNotification.service.ts`. Distinct from later Admin Dashboard desk / reports / digest. Distinct from leftover test sink: `testObservabilitySink.ts`. Distinct from leftover fingerprint / identity / request fold / details bound. This checkout’s `CONTEXT.md` names “Workflow Observational” in the intro and does not define Operational Event / Incident — do not invent a glossary copy. `docs/adr/` is absent here — do not invent ADR copies. Do not add an Observability Service file in this rename.
- Callers: folder barrel `observability/index.ts` (the public instrumentation **interface**). Wave B: `src/app.ts` (`http.body.parse_failed`), `src/middleware/httpLogger.ts` (`http.request.slow` / 5xx), `src/middleware/requireApiSecret.ts`. Domain: already-recommended `leads/formLead.service.ts` / `callLead.service.ts` / `bookings/bookedLead.service.ts` / `cancellations/cancelledLead.service.ts`. Integrations: already-recommended Sheet Sync drain / queue, Reporting `reportingObservability.ts`, Operations Registry, employee-booking submit / rematch / recon, `granotLifecycle/drainer.ts` / `liveReceipts.ts`, already-recommended `granotLifecycle/observability.ts` (`emitGranotLifecycleEvent`). Sibling `adminObservability.service.ts` **asks** this for `admin.incident.status_changed`. Many more `void recordOperationalEvent({…})` sites — do not dump them. Tests: **no** `recordOperationalEvent.test.ts`. Domain / route tests **ask** leftover `getCapturedOperationalEvents` (`callLead.service.test.ts`, `cplCorrections.test.ts`, `granot-webhook.routes.test.ts`, `queuePublisher.test.ts`, `granotLifecycle/observability.test.ts`, `call-log-sync.service.test.ts`, `adminSheetSync.service.test.ts`) — those prove a caller emitted a key into the leftover test sink, not that this file persisted, opened an Incident, or emailed. Leftover `src/config/domain/observability.test.ts` covers flags, not this file. `recordOperationalEventsBulk` has **no** runtime caller besides the barrel re-export.
- Seams callers need: write-this-happening-down (`recordOperationalEvent`: always pino; then leftover test sink **or** leftover disabled **or** leftover `log_only` **or** persist + maybe Incident + maybe email) vs write-these-happenings-down-in-bulk (`recordOperationalEventsBulk`: leftover script insert; no Incident; no email). There is no begin / complete **seam**. There is no Domain Command **seam**. There is no Granot catalog **seam**. There is no Admin desk **seam**.
- Split later (only if the file outgrows one sitting): this ~390-line file is one sitting if you read it as write this happening down without breaking the work — pino first, never throw, leftover test sink swallows, leftover `log_only` stops after pino, a failure may grow an Incident, a matching success may close Incidents, then maybe email, and an email failure writes a second happening that must not email. Do **not** split persist / Incident / email into `create.ts` / `update.ts` / `notify.ts`. Do **not** pull later Incident / policy / SendGrid here so “record owns the company.” If it later splits: `writeThisHappeningDown.ts` / `writeTheseHappeningsDownInBulk.ts` only as later story files, never `create.ts` / `update.ts` / `delete.ts` / `list.ts`

`recordOperationalEvent` / `recordOperationalEventsBulk` / `mirrorToPino` are executor mechanics. The owner question is: *Something just happened — a Form Lead was saved, Sheet Sync failed, a body would not parse. Write that down. Do not throw. Do not change the Form, the Booking, or the drain. If it was a failure, open or grow one Incident. If a matching success arrives, close those Incidents. Then maybe email. If the email fails, write that down too — but never email about the email.*

Later Incident upsert, immediate email policy, SendGrid delivery, leftover fingerprint / identity / request fold / details bound, leftover test sink, leftover env flags, Granot Section 33 catalog, and the Admin Dashboard desk already live in other **modules**. Do not pull those in.

## What this file actually does

Two adapters of one “write this happening down without breaking the work” story, not “an observability CRUD service,” and not the Incident desk or the email:

1. **Write this happening down** — `recordOperationalEvent`. Always leftover-pino first (`eventKey` is the log `msg`; Vercel search and Mongo share keys). Leftover test sink active (Vantage test runner **or** leftover `installTestObservabilitySink`): capture the input in memory, return `null`, no Mongo. Leftover `OBSERVABILITY_ENABLED=false` or leftover write mode `disabled`: return `null`. Leftover `log_only`: pino already happened; return `null`. Otherwise connect Mongo. Fold leftover request context, leftover lead identity, leftover fingerprint / leftover dedupe. Default leftover `notificationCandidate` is error / critical. Default leftover `ownerVisible` is “has leftover identity **or** critical.” Leftover persist-level gate (`shouldPersistEventLevel`) may drop the row **after** that connect — owner-visible `info` uses leftover `OBSERVABILITY_CAPTURE_OWNER_EVENTS`; other `info` uses leftover `OBSERVABILITY_CAPTURE_INFO_EVENTS`. Persist one `operational_events` row (leftover details bound, leftover `service: "vantage-main-server"`). Failure levels (`warn` / `error` / `critical`): **ask** later `upsertIncidentForEvent`, then stamp `incident_id` on the event. Incident upsert failure: leftover-warn, keep the event, do not throw. Leftover `autoResolveKey`: **ask** later `autoResolveIncidents` for that **caller** key (not this event’s computed leftover dedupe). Then **ask** later `dispatchEventNotifications`. Send failed and not leftover-skipped: write `notification.email.failed` with leftover `category: "notification"` and leftover `notificationCandidate: false` so policy cannot loop. Outer catch: leftover-error, return `null`. Never throws.

2. **Write these happenings down in bulk** — `recordOperationalEventsBulk`. Comment says scripts / backfills, not request handlers. Leftover test sink: capture each input, return `0`. Leftover collections off or empty list: return `0`. Unordered leftover `bulkWrite` in leftover batch size. **No** leftover-pino. **No** leftover persist-level gate. **No** Express leftover request fold. **No** Incident. **No** leftover auto-resolve. **No** email. Leftover `piiPolicy` defaults to `"none"` even when leftover identity is present. Leftover `notificationCandidate` defaults to `false`. Barrel re-exports it. Nothing in `src/` calls it.

There is no third owner operation. Leftover `stringifyRequestId` / leftover `resolveEnvironment` / leftover `logLevelForEvent` are leftover beats, not public **seams**. Do not export leftover `mirrorToPino` as a public **seam**. Do not export later `upsertIncidentForEvent` from this file as if this story owned the Incident. Do not export later `dispatchEventNotifications` from this file as if this story owned the email.

## Organization

Keep one file. This is the screenplay for “write this happening down without breaking the work.” Fingerprint, identity fold, request fold, details bound, Incident upsert, immediate email policy, SendGrid, leftover test sink, leftover env flags, and Granot Section 33 already live in deeper **modules**. Do not pull those in. Do not invent an `ObservabilityService` class. Do not invent a begin / complete **seam** — this is after-the-fact best-effort, not a Domain Command. Do not invent a second email **adapter** beside later `dispatchEventNotifications`. Do not invent a second Incident **adapter** beside later `upsertIncidentForEvent`.

Do not split persist vs Incident vs email into CRUD files. Do not move leftover-pino into `logger.ts` so “one log folder.” Do not move the notification-failure re-record into later `notificationPolicy.ts` so “policy owns every email outcome” — that is the cycle and the loop this file exists to prevent. Do not store leftover `origin` / leftover `user_agent_family` just because leftover `buildRequestEventContext` already computed them.

**External interface** stays small (this is the test surface):

| Keep exporting | Story name | Why the seam exists |
|---|---|---|
| `recordOperationalEvent` | `writeThisHappeningDown` | every domain / Wave B / Granot catalog site; never throws |
| `recordOperationalEventsBulk` | `writeTheseHappeningsDownInBulk` | leftover script insert; no Incident; no email; unused at runtime |
| `RecordOperationalEventInput` | `HappeningWeAreAboutToWriteDown` | camelCase caller bag; Mongo fields stay `snake_case` |

Keep the old names as one-line aliases until the folder barrel, Wave B HTTP sites, domain instrumentation, already-recommended `emitGranotLifecycleEvent`, and sibling Admin Incident-status write migrate. Do not make callers learn leftover `FAILURE_LEVELS` / leftover `shouldPersistEventLevel` / leftover `VERCEL_REGION` as the domain language.

**No class for the workflow.** The type that *does* earn a name is the caller bag this file already exports:

```ts
type HappeningWeAreAboutToWriteDown = {
  /* today's RecordOperationalEventInput — level, eventKey, category, workflow, summary */
}
```

That is the handoff from “a domain file decided something happened” to “pino, maybe Mongo, maybe an Incident, maybe an email.” Do **not** add a `persist: boolean` field so “every caller looks like a command,” and do **not** collapse the bulk adapter into this type so “every write looks like the live path.”

## The file, as a story

Parent functions stay deep. Child names are only extracted when they hide a real decision, not a one-liner.

```ts
// recordOperationalEvent.ts
// Something happened. Write it down.
// Do not throw. Do not change the work that just finished.
// A failure may grow one Incident.
// A matching success may close Incidents.
// Then maybe email.
// If the email fails, write that down too — never email about the email.

// ── 1. Write this happening down ──────────────────────────

export async function writeThisHappeningDown(happening)

function tellPinoFirst(happening)                     // always; even when Mongo is off
function theTestSinkIsSwallowingThis()                // leftover test runner or leftover install
function observabilityIsOff()                         // leftover enabled / leftover write mode
function weAreOnlyMirroringToPino()                   // leftover log_only
async function persistTheHappeningOrStayQuiet(happening)
function foldTheSafeRequestAndTheLeadIdentity(happening)
function nameTheFingerprintFamily(happening)          // leftover sibling hash
function thisInfoIsOwnerVisible(happening, identity)  // leftover identity or critical
function thisLevelIsAllowedToPersist(happening)       // leftover owner-events vs leftover info-events
async function writeTheOperationalEvent(prepared)
async function growOrOpenTheIncidentWhenThisFailed(event, happening)  // later sibling; keep the event if this throws
async function closeMatchingIncidentsWhenTold(autoResolveKey)         // caller key, not computed leftover dedupe
async function maybeEmailThenWriteDownAnEmailFailure(event, incident) // later policy; category notification cannot loop

// ── 2. Write these happenings down in bulk ────────────────

export async function writeTheseHappeningsDownInBulk(happenings)

function thisIsAScriptInsertNotALiveHandler()
async function insertSanitizedDocsWithoutIncidentsOrEmail(batch)
```

Read the primary path out loud: *A Form Lead was saved. Tell pino the key `lead.form.created` before anything else. If this is a unit test, keep the bag in memory and stop. If observability is off, stop. If we are only logging, stop after pino. Connect Mongo. Fold the safe route and the leftover lead name / phone / email. Hash the leftover fingerprint family. Because the lead has leftover identity, treat this `info` as owner-visible and honor the leftover owner-events flag. Write the Operational Event. This was not a failure, so do not open an Incident. If the caller handed an leftover `autoResolveKey`, close matching open Incidents. Ask later policy whether to email. If that email fails, write `notification.email.failed` with leftover category `notification` so we never email about the email. If Mongo throws, leftover-error and return null. The Form Lead is already saved.*

That is the operation. `recordOperationalEventsBulk` is the leftover script adapter, not a second live path. `emitGranotLifecycleEvent` is not this write.

## Precise logic I would tighten while renaming

These are real smells the story names make obvious. Do not “just rename.”

1. **Never throw is the product.** The rule and the comment say instrumentation must not break lead / booking / cancellation / CRM / RingCentral / sheets / Granot / cron. Domain callers already `await` or `void` this and ignore `null`. Do not start throwing so “the caller can retry,” and do not `await` this inside a Domain Command transaction so “the event commits with the Lead.”

2. **Pino is first, always.** Leftover test sink, leftover disabled, and leftover `log_only` all run leftover `mirrorToPino` first. Bulk does **not**. Do not skip pino on the leftover test sink so “tests stay quiet,” do not skip pino on leftover `log_only` so “Mongo is the only log,” and do not add leftover-pino to bulk so “every adapter looks the same” unless a later pass proves scripts need Vercel search.

3. **Unit tests never see persist / Incident / email.** Leftover `isVantageTestRunner()` makes the leftover test sink active **and** leftover `isObservabilityEnabled()` false (`allowTestObservabilityWrites` is hardcoded `false`). Domain tests only prove a key landed in memory. Do not flip that hardcoded fence so “we can assert Mongo from `pnpm test`,” and do not treat leftover `getCapturedOperationalEvents` as proof this file opened an Incident.

4. **The leftover persist-level gate runs after `connectMongo`.** A dropped leftover `info` still paid for a connection. Rename so that order is visible. Do not silently move the gate before connect in the same pass without an **interface** test, and do not drop owner-visible leftover `info` when leftover `OBSERVABILITY_CAPTURE_INFO_EVENTS` is false — leftover `shouldCaptureOwnerEvents` is the other flag.

5. **Bulk is unused and not the live path.** No `src/` caller. No leftover-pino, no leftover persist-level gate, no leftover request fold, no Incident, no email, leftover `piiPolicy` `"none"` even with leftover identity. Keep it as a leftover script adapter. Do not call it from `httpLogger` so “slow requests batch,” do not grow Incidents from bulk so “backfills are complete,” and do not delete the export on this pass because “nothing calls it.”

6. **Leftover `autoResolveKey` is the caller’s family, not this event’s leftover dedupe.** A clean leftover `sheet_sync.drain.completed` may close yesterday’s leftover drain-failed Incidents. Do not auto-resolve from the computed leftover fingerprint so “every success closes its own hash,” and do not ignore leftover `autoResolveKey` on leftover `info` so “only failures resolve.”

7. **Incident upsert failure keeps the event.** Leftover-warn, no `incident_id`, then leftover notify still runs with `incident: null` (no leftover throttle). Do not delete the event so “an Incident-less row is dishonest,” and do not skip email because upsert failed.

8. **Email failure writes a second happening that must not email.** Leftover `category: "notification"` plus leftover `notification.*` key is the loop fence in later policy. This file owns that re-record so later policy stays free of an import cycle. Do not move the re-record into later `notificationPolicy.ts`, do not set leftover `notificationCandidate: true` on that second happening, and do not skip the re-record when leftover `dispatchResult.skipped` is true.

9. **Leftover `buildRequestEventContext` computes leftover `origin` and leftover `user_agent_family`; this file never stores them.** Leftover `httpLogger` already redacts raw headers. Do not persist leftover UA so “we already extracted it,” and do not drop leftover `request` so “the unused fields prove the fold is dead” — leftover `request_id` / leftover route / leftover method are used.

10. **Owner-visible leftover `info` is a different capture flag.** Form create with leftover identity defaults leftover `ownerVisible` true. Already-recommended `emitGranotLifecycleEvent` forces leftover `ownerVisible: false` and leftover `piiPolicy: "none"`. Do not flip the default so “every leftover `info` is owner-visible,” and do not start writing leftover Granot contact columns here so “one event shape.”

11. **Leave sibling modules alone.** Leftover `computeFingerprint`, leftover `normalizeLeadIdentity`, leftover `sanitizeEventDetails`, later `upsertIncidentForEvent`, later `dispatchEventNotifications`, leftover `captureOperationalEventForTest` are already the right **depth**. This file orchestrates them.

12. **Do not silently add rollups.** The rule says rollups are deferred. Overview / reports aggregate from events, Incidents, deliveries, and report runs. Do not write a leftover metrics row from this file so “the home card is cheap.”

## Testing

The **interface** is the test surface: `writeThisHappeningDown`, `writeTheseHappeningsDownInBulk`.

Today there is no `recordOperationalEvent.test.ts`. Leftover sink tests in other folders only prove a caller emitted a key. Leftover flag tests live next door in `src/config/domain/observability.test.ts`. That is not enough for a story this load-bearing.

Add tests that name the operation. They will need a replica / injected persist **or** a focused test that is not the leftover in-memory sink — today’s leftover test runner cannot persist:

**Write this happening down**
- Never throws when Mongo, Incident upsert, leftover auto-resolve, or leftover email throws; leftover-error / leftover-warn and return `null`.
- Leftover-pino runs even when leftover disabled, leftover `log_only`, and leftover test sink swallow.
- Leftover test sink captures the caller bag and returns `null` (no Mongo, no Incident, no email).
- Leftover `log_only` / leftover disabled: no collection write.
- Owner-visible leftover `info` honors leftover `OBSERVABILITY_CAPTURE_OWNER_EVENTS`; other leftover `info` honors leftover `OBSERVABILITY_CAPTURE_INFO_EVENTS`.
- Failure leftover `warn` / leftover `error` / leftover `critical`: one event, later Incident upsert, `incident_id` stamped.
- Incident upsert throws: event remains searchable, no throw, leftover email may still run with `incident: null`.
- Leftover `autoResolveKey` closes leftover open / leftover acknowledged Incidents for **that** key.
- Leftover email failed and not leftover-skipped: a second happening `notification.email.failed` with leftover `category: "notification"` and leftover `notificationCandidate: false`. That second happening does not email.

**Write these happenings down in bulk**
- Leftover test sink captures and returns `0`.
- Inserts sanitized docs; does **not** upsert Incidents; does **not** email; does **not** leftover-pino (today).
- Empty list or leftover collections off: `0`.

Do **not** add a test per helper (`tellPinoFirst`, `thisInfoIsOwnerVisible`, `nameTheFingerprintFamily`). Those names exist so the parent reads. If a helper test has to change when the helper is inlined, it was testing past the **interface**.

Do **not** export leftover `mirrorToPino` “so the test can assert logs” as a public **seam**.

## What I would not do

- An `ObservabilityService` class with `create` / `update` / `delete`.
- Thirty two-line functions that only wrap leftover `Event.create` / later `upsertIncidentForEvent` / later `dispatchEventNotifications`.
- Moving this into a CRUD folder (`create.ts` / `update.ts` / `notify.ts`) for cleanliness.
- Breaking the never-throw **seam**. Persist, Incident, and email must not sit inside a Domain Command write.
- Treating already-recommended `emitGranotLifecycleEvent` as this story. That catalog is a different origin and never writes leftover lead contact columns.
- Inventing a begin / complete **seam** that has only one **adapter**.
- Silently enabling leftover Mongo writes from `pnpm test` so “the story is easier to prove.”
- Jumping to `reporting` while this service has unchecked modules.
- Writing a whole-folder recommendation for `observability`.
