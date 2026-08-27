# Tell The Company This Named Transition Happened — Without Leaking People Or Secrets — operational story

- Status: recommended
- Service: `granotLifecycle` (Wave A, in-progress)
- Pass: 32 of this service — `observability.ts`
- Remaining in this service: `metrics.ts` and the rest of the `granotLifecycle` checklist in TRAVERSAL.md
- Target: `src/services/granotLifecycle/observability.ts`
- Knowledge: [`docs/knowledge/granot-lifecycle/observability.md`](../../../docs/knowledge/granot-lifecycle/observability.md) — Section 33 catalog, closed labels, rollout alerts, Owner/Admin health. Primary code also lists `metrics.ts`, `alerts.ts`, and `projections.ts` (`projectGranotLifecycleHealth`). This file is the catalog + sanitizer + emit + Owner-command watch. Distinct from process-local counters: [recommendations stay out of `metrics.ts` until that pass]. Distinct from the seven rollout alerts: `alerts.ts`. Distinct from health DTO: [recommendations/granot-lifecycle-projections.md](granot-lifecycle-projections.md). Distinct from the company-wide Operational Event write: `src/services/observability/recordOperationalEvent.ts`. Distinct from logger-safe failure folds: `safeLogging.ts`. Distinct from activation / manual-requeue audit rows: [recommendations/granot-lifecycle-operations.md](granot-lifecycle-operations.md) (`getOperationalEventModel().create`). Distinct from RingCentral adoption writes: `ringcentral-call-lead-ingest.service.ts` (`recordOperationalEvent` directly). Software map: `.cursor/rules/granot-lifecycle-capture.mdc` (`observability.ts` / `metrics.ts` / `alerts.ts` — best-effort; not business authority). This checkout’s `CONTEXT.md` does not define Operational Event / Granot lifecycle catalog — do not invent a glossary copy. `docs/adr/` is absent here — do not invent ADR copies.
- Callers: **eight emit sites + one Owner-watch site.** Emit: `routes/granot-webhook.routes.ts` (capture 503), `queuePublisher.ts` (publish failed), `processor.ts` (`processing.completed`), `drainer.ts` (claim recovered + run completed/failed), `bookingReconciliation.ts` / `releaseReconciliation.ts` / `discrepancies.ts` (underscore `reason_code` → dotted catalog via aliases), `alerts.ts` (`alert.firing` / `alert.recovered`). Owner watch: `routes/granot-lifecycle-admin.routes.ts` (`observeGranotOwnerCommandResult` after each Booking / Release / discrepancy command; `observeGranotOwnerCommandConflict` on shared `sendError`). Mask only: `operations.ts` (activation / requeue logs and audit ids). Tests: `observability.test.ts` (catalog freeze, sanitizer, unknown-key drop, apply/replay/conflict). `alerts.test.ts` reads `GRANOT_LIFECYCLE_ALERT_CODES`. Not callers: `metrics.ts` (except `incrementGranotLifecycleCommandConflicts` from the conflict watch), RingCentral ingest (same catalog keys, different write), `projections.ts` health, public Book / Cancel.
- Seams callers need: frozen Section 33 names vs supporting health/alert keys vs one-way underscore aliases; allowlist sanitizer vs sibling `sanitizeEventDetails`; this file’s `maskLifecycleId` vs `safeLogging.maskLifecycleId`; best-effort emit vs operations.ts durable audit `create`; Owner apply vs replay vs resolve; closed conflict codes vs every admin error; `recordOperationalEvent` as the persistence **adapter**
- Split later (only if the file outgrows one sitting): keep one file — this ~355-line module is one screenplay for “tell the company this named transition happened, without leaking people or secrets; when an Owner command finishes or fights, say that too.” If it later splits: `tellTheCompanyThisNamedTransitionHappened.ts` / `watchAnOwnerCommandFinish.ts` / `watchAnOwnerCommandFight.ts` — story files, never `emit.ts` / `create.ts` / `update.ts` / `delete.ts`, and never merge counters, alerts, health, or RingCentral ingest into this file

`emitGranotLifecycleEvent` / `observeGranotOwnerCommandResult` / `observeGranotOwnerCommandConflict` are executor mechanics. The owner question is: *Something already happened in Granot lifecycle — a receipt failed to store, a wake-up failed, processing finished, a case opened, an Owner command applied or fought. Tell the company using a frozen list of names. Strip people, secrets, Job Numbers, free-form reasons, money, and stacks. If we do not recognize the name, stay silent. If the teller itself fails, the business still happened. When the Owner’s command finishes, say applied or replayed. Replay is not a second resolve. When it fights, count only the closed race codes.*

Counters, rollout alerts, health projection, activation audit, RingCentral adoption, and official Book / Cancel already live in other **modules**. Do not pull those in.

## What this file actually does

Three operations of one “tell the company” story, not “an observability CRUD service,” and not the counters / alerts / health DTO:

1. **Tell the company this named transition happened, without leaking people or secrets** — accept an event key, a summary, and optional details / entity / route / timing. Fold the landed underscore aliases one-way onto the dotted catalog (`booking_case_opened` → `booking_case.opened`, `dead_letter` → `dead_letter.entered`, `ringcentral.call_lead.adopted` → `ringcentral.granot_adoption.adopted`, and the rest of `GRANOT_LIFECYCLE_EVENT_ALIASES`). Refuse any key that is not on the Section 33 catalog **or** the supporting list (queue/cron run completed/failed, claim recovered, alert firing/recovered) — return, do not throw, do not write. Allowlist details: enums, booleans, finite numbers, short strings, masked `*_id` / `scope_ref`. Drop payload, credentials, contact, Job Number, source/actor labels, reason/notes text, command body, money, stacks, provider bodies, and any unknown key. Strings longer than 80 characters disappear (they are not truncated). Mask the entity id the same way. Hand the cleaned bag to sibling `recordOperationalEvent` with `notificationCandidate: false`, `reportable: true`, `ownerVisible: false`, default `category: "admin"`, `workflow: "granot_lifecycle"`, `piiPolicy: "none"`. Swallow every throw. This function does not claim. This function does not write a Lead, Booking, case, or discrepancy. Instrumentation failure cannot change a business outcome.

2. **Watch an Owner command finish** — after the admin route already applied or replayed a Booking / Release / discrepancy command, say `owner_command.applied` or `owner_command.replayed` with the command name and kind. If this finish **applied** and the case is now resolved, also say `booking_case.resolved` or `release_case.resolved`. If this finish **applied** and the discrepancy is now resolved, also say that discrepancy resolved. If this finish **replayed**, stop after the replay event — even when the payload still says `case_resolved` / `discrepancy_resolved`. This function does not increment an applied counter. This function does not write the Command.

3. **Watch an Owner command fight** — classify the thrown error. `DomainCommandIdempotencyConflictError` is `DOMAIN_COMMAND_IDEMPOTENCY_CONFLICT`. A `GranotLifecycleError` whose `code` is in `OWNER_COMMAND_CONFLICT_CODES` (revision, case revision, identity, operation idempotency) keeps that code. Every other error, including validation and Owner-required, is not a fight. On a closed code only: increment sibling `granot_lifecycle_command_conflicts_total` and emit `owner_command.conflict` at `warn` with `{ code }`. The admin router calls this from shared `sendError`, so GET / health failures also enter and no-op.

There is no fourth mutate operation. `normalizeGranotLifecycleEventKey` / `isGranotLifecycleCatalogKey` / `sanitizeGranotLifecycleEventDetails` / `maskLifecycleId` / `ownerCommandConflictCode` are folds, not public stories. The frozen catalogs (`GRANOT_LIFECYCLE_EVENT_CATALOG`, supporting keys, aliases, `GRANOT_LIFECYCLE_ALERT_CODES`) are the dictionary the first operation and the sibling alert module read. `recordOperationalEvent` is a real **seam** because RingCentral ingest and company-wide instrumentation use it too — this file must not invent a second writer. Sibling `incrementGranotLifecycleCommandConflicts` is a real **seam** because health later reads the 24-hour conflict count from Mongo, not only this process-local counter.

## Organization

Keep one file as the screenplay for “tell the company this named transition happened, without leaking people or secrets; when an Owner command finishes or fights, say that too.” Counters, alerts, health, activation audit, and RingCentral adoption already live in deeper **modules**. Do not pull those in. Do not invent a `GranotLifecycleObservabilityService` class. Do not invent a canonical-command `begin` / `complete` **seam** here — emit is after-commit (or the failure itself); there is no before-emit persist. Do not invent a write **seam** that has only one **adapter** here.

Do not move this into `src/services/observability/` so “every Operational Event lives together.” Do not move this into `metrics.ts` so “Section 33 is one sitting.” Do not move this into `alerts.ts` so “firing can own the catalog.” Do not split `emit.ts` / `sanitize.ts` / `create.ts` / `update.ts`.

**External interface** stays small (this is the test surface):

| Keep exporting | Story name | Why the seam exists |
|---|---|---|
| `emitGranotLifecycleEvent` | `tellTheCompanyThisNamedTransitionHappened` | every lifecycle site after commit or on the failure itself |
| `observeGranotOwnerCommandResult` | `watchAnOwnerCommandFinish` | admin route after apply / replay |
| `observeGranotOwnerCommandConflict` | `watchAnOwnerCommandFight` | admin `sendError`; closed codes only |
| `GRANOT_LIFECYCLE_EVENT_CATALOG` | `TheNamesWeAreAllowedToSay` | Unit 30 freeze; tests lock the list |
| `GRANOT_LIFECYCLE_SUPPORTING_EVENT_KEYS` | `TheHealthAndAlertNames` | last-run, claim recovery, alert transitions |
| `GRANOT_LIFECYCLE_EVENT_ALIASES` | `TheOneWayLandedNames` | underscore callers → dotted catalog |
| `GRANOT_LIFECYCLE_ALERT_CODES` | `TheSevenRolloutAlertNames` | sibling `alerts.ts` freeze |
| `GranotLifecycleEmitInput` | `WhatWeMaySayAboutATransition` | allowlisted bag before sanitize |

Keep the old names as one-line aliases until the webhook route, the eight emit sites, and the admin router migrate. Do not make callers learn `FORBIDDEN_DETAIL_KEYS` / `ALLOWED_DETAIL_KEYS` / `ownerCommandConflictCode` as the domain language.

**Principle: old exports stay as aliases.** `emitGranotLifecycleEvent`, `observeGranotOwnerCommandResult`, and `observeGranotOwnerCommandConflict` remain the imported names until those callers point at the story names.

**No class for the workflow.** The type that *does* earn a name is the cleaned emit bag after the allowlist:

```ts
type ASafeLifecycleTransition = {
  eventKey: GranotLifecycleEventKey | (typeof GRANOT_LIFECYCLE_SUPPORTING_EVENT_KEYS)[number]
  summary: string
  details: Record<string, string | number | boolean>
}
```

That is the handoff from “a sibling just finished real work” to “the company may remember a name and a few codes.” Do **not** add `name` / `phone` / `email` / `job_no` so “the event can find the customer,” and do **not** add `payload` so “debug can see Granot.”

## The file, as a story

Parent functions stay deep. Child names are only extracted when they hide a real decision, not a one-liner.

```ts
// observability.ts
// Something already happened in Granot lifecycle.
// Tell the company using a frozen list of names.
// Strip people, secrets, Job Numbers, and free-form text.
// If we do not recognize the name, stay silent.
// If the teller fails, the business still happened.
// This file does not claim.
// This file does not write a Lead, Booking, case, or discrepancy.

// ── 1. Tell the company this named transition happened ───

export async function tellTheCompanyThisNamedTransitionHappened(input)
  foldTheLandedUnderscoreNameOneWay()
  ifWeDoNotRecognizeTheName, staySilent()
  keepOnlyTheAllowlistedDetails()
  maskEveryIdAndTheEntity()
  askTheCompanyWideOperationalEventAdapter()         // sibling; never throw

function foldTheLandedUnderscoreNameOneWay(eventKey)
  // booking_case_opened → booking_case.opened
  // dead_letter → dead_letter.entered
  // ringcentral.call_lead.adopted → ringcentral.granot_adoption.adopted

function keepOnlyTheAllowlistedDetails(details)
  dropPayloadCredentialsContactJobReasonMoneyStack()
  dropUnknownKeys()
  dropStringsLongerThanEightyCharacters()            // not truncate
  maskKeysThatEndIn_idAndScopeRef()

// ── 2. Watch an Owner command finish ─────────────────────

export async function watchAnOwnerCommandFinish(input)
  sayAppliedOrReplayed()
  ifReplayed, stop()                                 // not a second resolve
  ifAppliedAndTheCaseResolved, sayTheCaseResolved()
  ifAppliedAndTheDiscrepancyResolved, sayThatToo()

// ── 3. Watch an Owner command fight ──────────────────────

export async function watchAnOwnerCommandFight(error)
  classifyTheClosedRaceCodeOrIgnore()
  incrementTheCommandConflictCounter()               // sibling metrics
  tellTheCompanyTheOwnerCommandConflicted()

function classifyTheClosedRaceCodeOrIgnore(error)
  domainCommandIdempotency()
  granotRevisionCaseIdentityOrOperationIdempotency()
  everythingElseIsNotAFight()                        // validation, 403, GET
```

Read the primary path out loud: *A receipt failed to store, or processing finished, or a Booking case opened with the landed name `booking_case_opened`. We fold that name onto `booking_case.opened`. We keep channel, outcome, masked ids, and counts. We drop the payload, the phone, the Job Number, and the owner’s reason text. We ask the company-wide Operational Event writer to remember it. If that writer throws, we swallow it. The receipt, the case, and the Command already stand. When the Owner later confirms a Booking, we say applied, and if the case is now resolved we say that too. If they retry the same Idempotency-Key, we say replayed and we do not say resolved again. If two Owners race the same case revision, we count that fight and say conflict. A bad query string is not a fight.*

That is the operation. `emitGranotLifecycleEvent` is not a logger wrapper. `observeGranotOwnerCommandResult` is not.

## Precise logic I would tighten while renaming

These are real smells the story names make obvious. Do not “just rename.”

1. **Two `maskLifecycleId` functions disagree.** This file: length `<= 10` → `"***"`, else first 6 + `"..."` + last 4. `safeLogging.ts`: length `> 8` → first 4 + `"…"` + last 4, else `"…"`. Processor and queue publisher log with the logger mask, then emit through this file’s mask. `operations.ts` imports this file’s mask for activation / requeue. `projections.ts` has a third local copy. Do not unify the three in this rename so “one mask,” and do not make emit call `safeLogging.maskLifecycleId` so “logs match events” — a 24-character ObjectId becomes `aaaaaa...aaaa` here and `aaaa…aaaa` there on purpose until a test names the leak.

2. **Activation and manual requeue do not call this emit.** `operations.ts` writes `granot_lifecycle.activation.committed` and `granot_lifecycle.manual_requeue` with `getOperationalEventModel().create` after commit (try/catch), using this file only to mask ids. Knowledge still lists those keys on the catalog. Do not route those audits through `tellTheCompanyThisNamedTransitionHappened` so “one teller” — they stamp fingerprint, dedupe, route, and null lead columns in the same sitting as the Owner command. Do not delete the catalog keys so “unused.” Leave the durable audit in `operations.ts`.

3. **RingCentral adoption keys live here; RingCentral does not call this file.** `ringcentral-call-lead-ingest.service.ts` writes `ringcentral.granot_adoption.adopted` / `.conflict` through `recordOperationalEvent` with `reportable: false` and unmasked `entity.id`. This emit hardcodes `reportable: true` and masks the entity. Aliases for `ringcentral.call_lead.adopted*` exist for landed names. Do not wrap RC ingest in this emit so “the catalog owns adoption,” and do not drop the RC keys so “this file has no RC caller.” Adoption is a later `ringcentral` pass.

4. **Case and discrepancy emitters send underscore keys on purpose.** `bookingReconciliation.ts` emits `granot_lifecycle.${result.reason_code}` where `reason_code` is `booking_case_opened` / `booking_case_refreshed`. Release and discrepancy do the same. The alias table is the **seam**. Do not change those siblings to dotted keys in this rename, and do not emit both an alias and its canonical key for one transition — the header comment already forbids that.

5. **Unknown keys stay silent.** `tellTheCompanyThisNamedTransitionHappened` returns when the folded name is not on either list. Tests lock that. Do not log a warning so “we notice typos,” and do not throw so “bad keys fail closed” — instrumentation must not fail the webhook 503 path or the Owner 201.

6. **Strings longer than 80 characters are dropped, not truncated.** Sibling `sanitizeEventDetails` truncates to 500 and bounds depth. This allowlist is stricter and keyed. Do not call the sibling sanitizer so “one cleaner,” and do not raise 80 to 500 so “summaries fit” without a test that names a leaked reason.

7. **`watchAnOwnerCommandFinish` overwrites `kind` when both bags are set.** `case_kind` and `discrepancy_kind` both write `details.kind`. Today each route sets only one. Do not add a combined `{ case_kind, discrepancy_kind }` so “the shape is honest” in this rename, and do not emit two finish events.

8. **Discrepancy commands pass a URL as `command`.** Booking / Release pass `confirmGranotBooking`, `updateGranotBooking`, `createGranotReferralBooking`, `resolveGranotBookingNoAction`, `confirmGranotCancellation`, `updateGranotReleaseBooking`, `resolveGranotReleaseNoAction`. Discrepancy `discrepancyAction` passes `path` (`/api/v1/admin/granot-lifecycle/discrepancies/:id/re-evaluate`). The allowlist keeps `command` as a short string. Do not “fix” the route in this rename so “every command is camelCase” — that is a sibling edit. Do not drop `command` so “paths look like PII.”

9. **Replay with `case_resolved: true` must not say resolved.** The test names `[AC-31][AC-37]`. The finish function returns after the replay event. Do not emit resolve on replay so “the case is resolved in the payload,” and do not increment an applied effect twice.

10. **`watchAnOwnerCommandFight` sits on every admin error.** `sendError` serves list, detail, health, activation, requeue, and Owner commands. Only closed conflict codes emit. Do not split `sendError` in this rename so “GET cannot look like a fight,” and do not emit on `VALIDATION_FAILED` so “every 400 is visible.”

11. **Conflict increments a process-local counter, then emits.** Sibling `incrementGranotLifecycleCommandConflicts` drops unknown labels again. Health `command_conflicts_last_24h` is a Mongo count, not this map. Do not treat the increment as the health number, and do not skip the increment so “events are enough.”

12. **Hardcoded visibility is the product.** `notificationCandidate: false`, `ownerVisible: false`, `reportable: true`. Lifecycle events are reportable instrumentation, not Owner mail, not lead/contact columns. Do not flip `ownerVisible` so “the Owner sees capture 503s,” and do not populate `lead_name` so “ops can find the job.”

13. **Knowledge covers three files plus health.** `observability.md` Primary code includes `metrics.ts`, `alerts.ts`, and `projectGranotLifecycleHealth`. That is not permission to write a whole-folder recommendation. This pass is emit + Owner watch only.

14. **Leave sibling modules alone.** Counters stay in `metrics.ts`. Alert evaluate/persist stays in `alerts.ts`. Health stays in `projections.ts`. Activation / requeue audit stays in `operations.ts`. Logger masks stay in `safeLogging.ts`. `recordOperationalEvent` stays the persistence **adapter**.

15. **Do not treat capture, drain, Owner Book / Cancel, or RingCentral ingest as this story.** Those write receipts, cases, `BookedLead`, or Call Leads. This file only names what already happened.

16. **Do not write a whole-folder recommendation for `granotLifecycle`.**

## Testing

The **interface** is the test surface: `tellTheCompanyThisNamedTransitionHappened` (today `emitGranotLifecycleEvent`), `watchAnOwnerCommandFinish` (today `observeGranotOwnerCommandResult`), and `watchAnOwnerCommandFight` (today `observeGranotOwnerCommandConflict`). The frozen catalog export stays part of the interface because Unit 30 locks the names.

Today’s `observability.test.ts` already names the catalog freeze, one-way aliases, sanitizer drops, unknown-key silence, apply-then-resolve vs replay-without-resolve, and closed conflict codes. Keep those. Add the gaps:

**Tell the company this named transition happened**
- Underscore `granot_lifecycle.booking_case_opened` persists as `granot_lifecycle.booking_case.opened` (already locked).
- Unknown key writes nothing and does not throw (already locked).
- `payload`, `email`, `phone`, `job_number`, `reason`, `authorization` disappear; `channel` / `outcome` / masked `receipt_id` remain (already locked).
- `Receipt_ID` masks case-insensitively; `Conflict_Code` stays a bounded string (already locked).
- A 24-character entity id is masked on the Operational Event (add this; the existing test checks details, not `entity.id`).
- A detail string longer than 80 characters is omitted, not truncated (add this).
- An unknown detail key is omitted even when the value is a number (add this).
- `recordOperationalEvent` throw is swallowed; the caller is not rejected (add this).
- Emitted events have `notificationCandidate: false`, `ownerVisible: false`, `reportable: true` (add this).
- Do not add a test that this path writes a receipt, case, Lead, or Booking.

**Watch an Owner command finish**
- Apply + `case_resolved` emits `owner_command.applied` then `booking_case.resolved` (already locked).
- Replay + `case_resolved` emits only `owner_command.replayed` (already locked).
- Apply + `discrepancy_resolved` + `discrepancy_kind: "release"` emits `release_discrepancy.resolved` (add this).
- Replay + `discrepancy_resolved` emits no discrepancy resolved event (add this).
- Do not add a test that this path increment an applied counter or writes a Command.

**Watch an Owner command fight**
- `DomainCommandIdempotencyConflictError` increments `DOMAIN_COMMAND_IDEMPOTENCY_CONFLICT` and emits conflict (already locked).
- `GRANOT_CASE_REVISION_CONFLICT` increments and emits (already locked).
- `VALIDATION_FAILED` increments nothing and emits nothing (already locked).
- A plain `Error` increments nothing (add this).
- Do not add a test that this path resolves a case.

Do **not** add a test per helper (`foldTheLandedUnderscoreNameOneWay`, `keepOnlyTheAllowlistedDetails`, `classifyTheClosedRaceCodeOrIgnore`). Those names exist so the parent reads. If a helper test has to change when the helper is inlined, it was testing past the **interface**.

Do **not** re-test alert evaluate, health projection, process-local gauges, activation `create`, or RingCentral ingest here. Do not add a test that this file CRM-posts, `$set`s a Lead, or writes `BookedLead`.

## What I would not do

- A `GranotLifecycleObservabilityService` class with `emit` / `record` / `create`.
- Thirty two-line functions that only wrap `recordOperationalEvent`.
- Moving this into a CRUD folder, or into `src/services/observability/` / `metrics.ts` / `alerts.ts` “for cleanliness.”
- Splitting `emit.ts` / `sanitize.ts` / `create.ts` / `update.ts` / `delete.ts`.
- Unifying the three `maskLifecycleId` copies so “one mask.”
- Routing activation / requeue audit or RingCentral adoption through this emit so “one teller.”
- Logging or throwing on an unknown catalog key so “typos fail closed.”
- Emitting resolve on replay so “the payload says the case is resolved.”
- Counting `VALIDATION_FAILED` as a command fight.
- Adding name / phone / email / Job Number on details so “ops can find the customer.”
- Flipping `ownerVisible` or `notificationCandidate` so “the Owner is mailed.”
- Inventing a glossary or ADR copy because this checkout’s `CONTEXT.md` / `docs/adr/` are absent.
- Writing a whole-folder recommendation for `granotLifecycle`.
