# Record An Inactive Inbound Number Then Ask RingCentral If This Account Can See It — Turn It On Only With A Fresh Valid Stamp Onto A Live Call Feed And Lock The Number Forever — Move It By Closing The Open Assignment And Opening Another — Archive Never Delete — Count Call Leads And Assignments But Never Gate Archive On Them — Stamp Last-Seen From Call Log Or Webhook Without Owner — Write The Registry Change In The Same Transaction — Forget The Inbound-Route Cache Only After Commit — Never Decide Which Incoming Call Becomes A Call Lead — operational story

- Status: recommended
- Service: `operationsRegistry` (Wave A, in-progress)
- Pass: 6 of this service — `ringCentralRegistry.ts`
- Remaining in this service: `ringCentralSnapshot.ts`, `ringCentralValidation.ts`, `granotCrmSources.ts`, `crmSourceOutboundSms.ts`, `granotCrmSourceProjections.ts`, `granotAutomationSources.ts`, `trustedActor.ts`, `registryAudit.ts`, `runtimeTelemetry.ts`, `queries/overview.ts`, `queries/health.ts`, `queries/changes.ts`
- Target: `src/services/operationsRegistry/ringCentralRegistry.ts`
- Knowledge: [`docs/knowledge/services/operations-registry.md`](../../../docs/knowledge/services/operations-registry.md) (lumps this file with leftover `ringCentralValidation.ts` as “inbound-route snapshot used at Call Qualification time” — that sentence names leftover `ringCentralSnapshot.ts`, not this Owner write). Software rule: [`.cursor/rules/operations-registry.mdc`](../../../.cursor/rules/operations-registry.mdc) (mutation + Registry Change share one transaction; cache invalidation only after commit). Call Qualification **asks** leftover snapshot, not this file: [`docs/knowledge/services/ringcentral-call-lead-qualification.md`](../../../docs/knowledge/services/ringcentral-call-lead-qualification.md) and already-recommended [recommendations/ringcentral-call-lead-ingest.md](ringcentral-call-lead-ingest.md) / [recommendations/ringcentral-call-log-sync.md](ringcentral-call-log-sync.md) / [recommendations/ringcentral-webhook-capture.md](ringcentral-webhook-capture.md). Already-recommended leftover Source Feed activate: [recommendations/operations-registry-source-registry.md](operations-registry-source-registry.md) (this file **asks** leftover first-class `LeadSourceGranularity` / `LeadSourceCompany` — it does not activate a Feed). Leftover provider inventory **adapter**: leftover `ringCentralValidation.ts` (`validateRingCentralNumberAgainstAccount` / leftover `RingCentralRouteValidator`). Leftover transaction/audit: leftover `registryAudit.ts` (`withRegistryMutation`). Leftover cache key: leftover `RINGCENTRAL_ROUTE_CACHE_KEY` on leftover `ringCentralSnapshot.ts`. Leftover `queries/health.ts` / leftover `queries/overview.ts` count routes and open assignments on the models themselves — they do **not** import this file. Leftover Granot `createLeadFromGranot.ts` `assertSingleActiveRingCentralAssignment` reads the same models and refuses unless **exactly one** live assignment points at an active, valid route — it does **not** import this file. This checkout’s `CONTEXT.md` does not define inbound number / inbound route — do not invent a glossary copy. `docs/adr/` is absent here — do not invent an ADR copy. Do not add this path to knowledge in this rename.
- Callers: Wave B `ringcentral-registry.routes.ts` leftover `GET /admin/ringcentral/inbound-routes` (**asks** leftover `listRingCentralInboundRoutes`; leftover read actor), leftover `GET .../:id` (**asks** leftover `getRingCentralInboundRoute`; always history), leftover `POST` / leftover `PATCH` (**asks** leftover `createOrUpdateRingCentralRoute`; Owner), leftover `POST .../:id/validate` (**asks** leftover `validateRingCentralRoute`), leftover `POST .../:id/activate` / leftover `POST .../:id/reassign` (**asks** leftover `activateRingCentralRoute` / leftover `reassignRingCentralRoute`), leftover `POST .../:id/deactivate` (**asks** leftover `deactivateRingCentralRoute`), leftover `GET .../:id/dependencies` (**asks** leftover `previewRingCentralRouteDependencies`). Already-recommended leftover Call Log sync and leftover webhook enrich (**ask** leftover `recordRingCentralRouteObservation` — no Owner). Leftover M5 migration `scripts/migrations/operations-registry-ringcentral.ts` (**asks** leftover create / validate-with-injected-result / activate, and leftover deactivate on rollback). Barrel: `operationsRegistry/index.ts`. Tests: **none** on this **interface** — leftover `ringCentralSnapshot.test.ts` proves leftover resolve; leftover `ringCentralValidation.test.ts` proves leftover shared inventory load.
- Seams callers need: leftover POST (no id, always inactive / unlocked / unvalidated) vs leftover PATCH (id; number immutable after first activate) vs leftover `/activate` vs leftover `/reassign` vs leftover `/deactivate`; Owner actor on every write except leftover last-seen; leftover `withRegistryMutation` (card + assignment + Registry Change before commit) vs leftover `RINGCENTRAL_ROUTE_CACHE_KEY` forget after commit; leftover injectable `RingCentralRouteValidator` (Owner HTTP uses leftover account inventory; leftover M5 injects the preflight result); leftover last-seen `$max` / `$addToSet` (no audit, no cache forget)
- Split later (only if the file outgrows one sitting): this ~683-line file is one sitting if you read it as record an inactive inbound number then ask RingCentral if this account can see it — turn it on only with a fresh valid stamp onto a live call Feed and lock the number forever — move it by closing the open assignment and opening another — archive never delete — count Call Leads and assignments but never gate archive on them — stamp last-seen from Call Log or webhook without Owner — write the Registry Change in the same transaction — forget the inbound-route cache only after commit — never decide which incoming call becomes a Call Lead. If it later splits: `recordOrCorrectAnInboundNumber.ts` / `askRingCentralIfThisAccountCanSeeThisNumber.ts` / `turnTheInboundNumberOnForALiveCallFeed.ts` / `archiveTheInboundNumber.ts` / `stampLastSeenOnTheInboundNumber.ts` — story files, never `create.ts` / `update.ts` / `delete.ts`, and never merge leftover snapshot resolve, leftover account inventory, leftover `withRegistryMutation`, leftover health findings, leftover Granot “exactly one assignment,” leftover Call Qualification, or Wave B HTTP into this file

`createOrUpdateRingCentralRoute` / `validateRingCentralRoute` / `activateRingCentralRoute` / `reassignRingCentralRoute` / `deactivateRingCentralRoute` are executor mechanics. The owner question is: *A RingCentral inbound number is not a Source Company. It is a phone card that, when live, points at one call Feed. The Owner records the number inactive, unlocked, and unvalidated. They ask this RingCentral account whether it can see that number. Only a stamp that is still `valid` and younger than the configured window (default 24 hours) lets them turn it on: close any open assignment, write a new one to an active call Feed whose company is live, lock the number forever, and mark the card active. Moving the number is the same close-and-open on a card that is already live. Archiving closes the assignment and sets `archived_at`; it never deletes the card or the Call Leads that already used it. The dependency preview counts assignments and Call Leads and then says `can_deactivate: true` every time. Call Log and webhook paths may stamp last-seen without Owner and without a Registry Change. The write and one Registry Change share a transaction. The inbound-route cache forgets only after commit. This file does not decide which incoming call becomes a Call Lead — leftover snapshot does that.*

Leftover snapshot resolve, leftover account inventory, leftover `withRegistryMutation`, leftover health findings, leftover Granot “exactly one assignment,” leftover Call Qualification, leftover phone fold, leftover telemetry, and Wave B inbound-route HTTP already live in other **modules**. Do not pull those in.

## What this file actually does

Seven operations of one “record an inactive inbound number then ask RingCentral if this account can see it — turn it on only with a fresh valid stamp onto a live call Feed and lock the number forever — move it by closing the open assignment and opening another — archive never delete — count Call Leads and assignments but never gate archive on them — stamp last-seen from Call Log or webhook without Owner — write the Registry Change in the same transaction — forget the inbound-route cache only after commit — never decide which incoming call becomes a Call Lead” story, not “a RingCentral route CRUD service,” and not leftover Call Qualification:

1. **Show the Owner inbound-number cards** — `listRingCentralInboundRoutes` / `getRingCentralInboundRoute`. Default list is `{ active: true }`, sorted by display label then phone. `includeInactive` is leftover admin. List loads only open assignments unless leftover `includeHistory`. Get-by-id has **no** active filter and **always** returns `assignment_history`. Missing → `NOT_FOUND`. Returns leftover `RingCentralRouteItem` (lock, validation, last-seen, current open assignment). This beat does **not** flatten. This beat does **not** open a transaction. This beat does **not** resolve an incoming call.

2. **Record or correct the inbound number — start inactive** — `createOrUpdateRingCentralRoute`. Owner only. No id → insert (`provider: ringcentral`, `phone_locked: false`, `active: false`, `ever_activated: false`, `validation_status: unvalidated`, `observed_target_names: []`, `created_from` default `admin`). Id → load or `NOT_FOUND`. Fold the phone through leftover `normalizePhoneNumberToE164Like`. Empty fold → leftover `RINGCENTRAL_ROUTE_INVALID` (`A valid phone_number is required.`). After first activate, a different number → leftover `IMMUTABLE_FIELD` (`phone_number is immutable after first activation.`). Another card already holding that folded number → leftover `DUPLICATE_IDENTIFIER` (remediation points at the existing card). A number change on an unlocked card `$unset`s validation + RingCentral ids and returns the card to `unvalidated`. **Ask** leftover `withRegistryMutation`. Audit `action` is persisted `create` | `update` — do not rename those strings. Invalidate leftover `RINGCENTRAL_ROUTE_CACHE_KEY` **after** commit. This beat does **not** ask RingCentral. This beat does **not** write an assignment. This beat does **not** activate.

3. **Ask RingCentral if this account can see this number** — `validateRingCentralRoute`. Owner only. Load the card or `NOT_FOUND`. **Ask** leftover `validator` (default leftover `validateRingCentralNumberAgainstAccount`; leftover M5 injects the preflight result). Leftover `withRegistryMutation` reloads the card; if the phone changed while the ask was in flight → leftover `STALE_REVISION`. Stamp `validation_status` (`valid` / `invalid` / leftover `unavailable` → stored `unvalidated`), code, message, `validated_at`, `validated_by`. Valid also writes leftover RingCentral ids + leftover `observed_target_names`. Not-valid `$unset`s those ids. After commit, a not-valid result writes leftover Operational Event `ringcentral.route.validation_failed` (`unavailable` is `error` + notification candidate; `invalid` is `warn`). This beat does **not** turn the number on. This beat does **not** lock the number.

4. **Turn the number on for a live call Feed — or move it** — `activateRingCentralRoute` / `reassignRingCentralRoute` → shared leftover `mutateAssignment`. Owner only. Fresh leftover `valid` stamp required (`assertValidFreshValidation`: not `valid` → leftover `RINGCENTRAL_ROUTE_INVALID` or leftover `RINGCENTRAL_ROUTE_UNVALIDATED`; older than leftover `RINGCENTRAL_ROUTE_VALIDATION_MAX_AGE_MS`, default 24 hours → leftover `RINGCENTRAL_ROUTE_UNVALIDATED`). Target Feed must exist, be `active`, and be `channel: "call"`; its Source Company must be `active`. Activate refuses when the card is already `active` with an open assignment (`DEPENDENCY_CONFLICT` — use leftover reassign). Reassign refuses unless the card is already `active` with an open assignment. Close the open assignment (two open rows → leftover `DEPENDENCY_CONFLICT`). Insert a new open assignment (`effective_from: now`, `active: true`). `$set` `active`, `ever_activated`, `phone_locked` and `$unset` archive fields. Audit `action` is persisted `activate` | `reassign`. This beat does **not** activate the Feed. This beat does **not** invent a company. This beat does **not** decide which incoming call becomes a Call Lead.

5. **Archive the inbound number — never delete** — `deactivateRingCentralRoute`. Owner only. Close the open assignment (same two-open refuse). `$set` `active: false`, `archived_at`, optional `deactivation_reason`. The number stays locked if it was ever turned on. Wave B leftover `/deactivate` **asks** this. There is no delete export. This beat does **not** count Call Leads first. This beat does **not** unlock the phone. This beat does **not** rewrite Call Lead `ringcentral.route_id`.

6. **Count who still depends — and still allow archive** — `previewRingCentralRouteDependencies`. Read, no mutate. Missing card → `NOT_FOUND`. Counts leftover open assignments, leftover assignment history, leftover `CallLead.ringcentral.route_id`. Returns leftover `can_deactivate: true` **every time**. Wave B leftover `/dependencies` **asks** this with a read actor.

7. **Stamp last-seen from Call Log or webhook — no Owner** — `recordRingCentralRouteObservation`. Already-recommended leftover Call Log sync (even when the call later fails qualify) and leftover webhook enrich **ask** this after leftover snapshot resolve. `$max` leftover `last_seen_in_call_log_at` or leftover `last_seen_in_webhook_at`; optional leftover `$addToSet` `observed_target_names`. This beat does **not** **ask** leftover `withRegistryMutation`. This beat does **not** write a Registry Change. This beat does **not** forget leftover `RINGCENTRAL_ROUTE_CACHE_KEY`. This beat does **not** require Owner.

There is no eighth Call-Lead-create operation. There is no leftover snapshot-build operation. There is no leftover account-inventory operation. Leftover `withRegistryMutation` is the transaction **adapter**. Leftover `RingCentralRouteValidator` is the provider-ask **adapter**. Leftover `loadAssignmentTarget` is the live-Feed **adapter**. Wave B leftover `/activate` and leftover `/reassign` are two HTTP **adapters** for operation 4, not a second owner story. Leftover M5 injects a validator **adapter**; it is not a second validate story.

`assertOwner` / `toRouteItem` / `closeOpenAssignment` / `assertValidFreshValidation` sit on the write and show paths. They are not extra owner operations. Do not invent a dashboard for leftover `RingCentralRouteItem` in this rename. Do not export leftover `mutateAssignment` / leftover `closeOpenAssignment` / leftover `loadAssignmentTarget` / leftover `validationUpdate` as a public **seam**.

## Organization

Keep one file as the screenplay for “record an inactive inbound number then ask RingCentral if this account can see it, turn it on only with a fresh valid stamp onto a live call Feed and lock the number forever, move it by closing the open assignment and opening another, archive never delete, count Call Leads and assignments but never gate archive on them, stamp last-seen from Call Log or webhook without Owner, write the Registry Change in the same transaction, forget the inbound-route cache only after commit, never decide which incoming call becomes a Call Lead.” Leftover snapshot resolve, leftover account inventory, leftover `withRegistryMutation`, leftover health findings, leftover Granot “exactly one assignment,” leftover Call Qualification, leftover phone fold, leftover telemetry, and Wave B HTTP already live in deeper **modules**. Do not pull those in. Do not invent a `RingCentralRegistryService` class. Do not invent a begin / complete **seam** — leftover `withRegistryMutation` is already the before-commit / after-commit **adapter**. Do not invent a second provider-ask **adapter** beside leftover `RingCentralRouteValidator`. Do not invent a second resolve **adapter** beside leftover `resolveRingCentralInboundRoute`.

Do not split this into `create.ts` / `update.ts` / `delete.ts` / `activate.ts` as a CRUD folder. Those are persistence verbs, not the owner story. Do not move leftover snapshot resolve into this file so “one file owns inbound mapping.” Do not move leftover account inventory into this file so “validate owns RingCentral HTTP.” Do not silently start gating archive on leftover `call_lead_count` so “we protect Call Leads.” Do not silently unlock the phone on archive so “the Owner can reuse the number.” Do not silently make leftover snapshot filter `active: true` so “archive hides the card from ingest” — leftover snapshot already stops ingest by closing the assignment interval.

**External interface** stays small (this is the test surface). Show, record-or-correct, ask-RingCentral, turn-on-or-move, archive, count-dependents, and stamp-last-seen are one story’s inbound-number card, not seven CRUD verbs:

| Keep exporting | Story name | Why the seam exists |
|---|---|---|
| `listRingCentralInboundRoutes` | `showTheOwnerInboundNumbers` | Wave B leftover list; default active; optional history |
| `getRingCentralInboundRoute` | `showOneOwnerInboundNumber` | Wave B leftover detail; leftover writes re-read; always history |
| `createOrUpdateRingCentralRoute` | `recordOrCorrectAnInboundNumber` | leftover POST (no id, inactive) and PATCH (id); Owner; transaction |
| `validateRingCentralRoute` | `askRingCentralIfThisAccountCanSeeThisNumber` | leftover `/validate`; leftover M5 injects the preflight result |
| `activateRingCentralRoute` | `turnTheInboundNumberOnForALiveCallFeed` | leftover `/activate`; leftover M5 first assignment |
| `reassignRingCentralRoute` | `moveTheInboundNumberToAnotherLiveCallFeed` | leftover `/reassign`; same close-and-open on a live card |
| `deactivateRingCentralRoute` | `archiveTheInboundNumber` | leftover `/deactivate`; leftover M5 rollback; never delete |
| `previewRingCentralRouteDependencies` | `countWhoStillDependsOnThisInboundNumber` | leftover `/dependencies`; read actor; `can_deactivate` is always true |
| `recordRingCentralRouteObservation` | `stampLastSeenOnTheInboundNumber` | leftover Call Log + leftover webhook; no Owner; no Change |
| `RingCentralRouteItem` | `OwnerInboundNumberCard` | full card with lock, validation, last-seen, current assignment |

Keep the old names as one-line aliases until leftover Wave B HTTP, leftover Call Log sync, leftover webhook enrich, leftover M5, and the barrel migrate. Do not make callers learn `createOrUpdate` / `mutateAssignment` / `toRouteItem` as the domain language.

**Principle: old exports stay as aliases.** `createOrUpdateRingCentralRoute` remains the imported name until leftover POST/PATCH migrates. `activateRingCentralRoute` / `reassignRingCentralRoute` remain the imported names until leftover `/activate` / leftover `/reassign` migrate. Persisted Registry Change `action` values (`create` / `update` / `validate` / `activate` / `reassign` / `deactivate`) stay those strings — they are audit history, not story names. Stored `validation_status` values (`unvalidated` / `valid` / `invalid`) stay those strings.

**No class for the workflow.** The type that *does* earn a name is the Owner card leftover HTTP already returns and leftover writes already re-read:

```ts
type OwnerInboundNumberCard = {
  id: string
  provider: "ringcentral"
  phone_number: string
  phone_locked: boolean
  display_label: string
  active: boolean
  ever_activated: boolean
  archived_at?: Date
  deactivation_reason?: string
  validation_status: "unvalidated" | "valid" | "invalid"
  validation_code?: string
  validation_message?: string
  validated_at?: Date
  last_seen_in_call_log_at?: Date
  last_seen_in_webhook_at?: Date
  created_from: string
  current_assignment?: {
    id: string
    route_id: string
    source_company_id: string
    source_granularity_id: string
    effective_from: Date
    effective_until?: Date
    active: boolean
  }
  assignment_history?: OwnerInboundNumberCard["current_assignment"][]
}
```

That is the handoff from “the Owner inbound-number write landed” to “leftover HTTP may show it, leftover snapshot may rebuild after cache forget, leftover Call Qualification may later resolve a call against the assignment interval.” Do **not** add leftover snapshot entries so “one card owns ingest,” do **not** add leftover `can_deactivate` so “dependents live on the card,” and do **not** drop `phone_locked` so “the leftover PATCH can always change the number.”

Do not add `withRegistryMutation` as a public **seam** — leftover `registryAudit.ts` already owns that. Do not add leftover `validateRingCentralNumberAgainstAccount` as a public **seam** — leftover `ringCentralValidation.ts` already owns that. Do not add leftover `resolveRingCentralInboundRoute` as a public **seam** — leftover `ringCentralSnapshot.ts` already owns that. Do not add leftover `normalizePhoneNumberToE164Like` as a public **seam** — leftover `ringcentral/phone-normalization.ts` already owns that.

## The file, as a story

Parent functions stay deep. Child names are only extracted when they hide a real decision, not a one-liner.

```ts
// ringCentralRegistry.ts
// A RingCentral inbound number is not a Source Company.
// It is a phone card that, when live, points at one call Feed.
// The Owner records the number inactive, unlocked, and unvalidated.
// They ask this RingCentral account whether it can see that number.
// Only a stamp that is still valid and younger than the window
// lets them turn it on: close any open assignment, write a new one
// to an active call Feed whose company is live, lock the number forever,
// and mark the card active.
// Moving the number is the same close-and-open on a card that is already live.
// Archiving closes the assignment and sets archived_at;
// it never deletes the card or the Call Leads that already used it.
// The dependency preview counts and then still allows archive.
// Call Log and webhook paths may stamp last-seen without Owner.
// The write and one Registry Change share a transaction.
// The inbound-route cache forgets only after commit.
// This file does not decide which incoming call becomes a Call Lead.

// ── 1. Show the Owner inbound-number cards ────────────────

export async function showTheOwnerInboundNumbers(options)
export async function showOneOwnerInboundNumber(id)   // no active filter; always history

// ── 2. Record or correct — start inactive ─────────────────

export async function recordOrCorrectAnInboundNumber(command, actor)

async function refuseIfAnotherCardAlreadyHoldsThisNumber(phone, excludeId, session)
function wipeValidationWhenTheUnlockedNumberChanges(before, phone)

// ── 3. Ask RingCentral if this account can see it ─────────

export async function askRingCentralIfThisAccountCanSeeThisNumber(command, actor, validator?)

function stampValidOrWipeProviderIds(result, actor, at)
async function writeValidationFailedEventAfterCommit(route, result)

// ── 4. Turn on — or move — only with a fresh valid stamp ──

export async function turnTheInboundNumberOnForALiveCallFeed(command, actor)
export async function moveTheInboundNumberToAnotherLiveCallFeed(command, actor)

async function closeTheOpenAssignmentAndOpenAnother(action, command, actor)
function refuseUnlessTheValidationStampIsStillFresh(route, now)
async function loadTheLiveCallFeedAndLiveCompany(granularityId, session)
async function closeTheOpenAssignment(routeId, at, session)  // two open → conflict

// ── 5. Archive — never delete ─────────────────────────────

export async function archiveTheInboundNumber(command, actor)

// ── 6. Count dependents — still allow archive ─────────────

export async function countWhoStillDependsOnThisInboundNumber(id)

// ── 7. Stamp last-seen — no Owner ─────────────────────────

export async function stampLastSeenOnTheInboundNumber(routeId, kind, observedAt, targetName?)
```

Read the primary path out loud: *The Owner presents a phone number. Fold it. Record the card inactive, unlocked, and unvalidated. Ask this RingCentral account whether it can see that number and stamp the result. If the stamp is still `valid` and younger than the window, turn the number on for one live call Feed whose company is live: close any open assignment, write the new interval, lock the number forever. Move it later the same way. Archive by closing the interval — do not delete, do not unlock, do not rewrite Call Leads. Persist the write and one Registry Change in the same transaction. After commit, forget the inbound-route cache. Do not decide which incoming call becomes a Call Lead.*

That is the operation. `createOrUpdateRingCentralRoute` is not.

## Precise logic I would tighten while renaming

These are real smells the story names make obvious. Do not “just rename.”

1. **Activate and reassign are one close-and-open.** Leftover `mutateAssignment` already shares the write. The only fork is “already live with an open assignment?” Activate refuses yes; reassign refuses no. One story, two HTTP **adapters**. Do not split them into `create.ts` / `update.ts` so “activate is create.”

2. **`can_deactivate` is a lie.** Operation 6 counts assignments and Call Leads, then returns `true` every time. Operation 5 never reads that bag. ORS-3 / leftover Owner UI spec already name this. Do not silently refuse archive when `call_lead_count > 0` so “we protect Call Leads.” Do not drop the field so “the lie goes away” without a paired leftover `/dependencies` test.

3. **Archive does not unlock the number.** First leftover turn-on sets leftover `phone_locked` forever. Leftover archive keeps it. The Owner must record a new card for a different number. Do not silently `$unset` `phone_locked` on archive so “the same card can be reused.”

4. **Leftover snapshot does not read `active`.** Leftover `loadSnapshotFromDatabase` selects `{ ever_activated: true, validation_status: "valid" }`. Ingest stops because leftover archive **closes the assignment interval**, not because leftover `active` is false. A later leftover invalid stamp can leave a leftover-active card that leftover snapshot still loads until the assignment is closed. Leftover Owner UI spec already names this. Do not silently add `active: true` to leftover snapshot in this rename — leftover `ringCentralSnapshot.ts` is the next module.

5. **Ask-RingCentral writes the Operational Event after commit.** Leftover `withRegistryMutation` has already landed the stamp. A leftover event throw does not rewind the card. Do not silently move the event inside the transaction so “audit owns failures” — leftover knowledge reserves Operational Events for failures, and leftover `withRegistryMutation` is successful-mutation history.

6. **Leftover `unavailable` stores `unvalidated`, not `invalid`.** Leftover health then skips leftover `registry.ringcentral_validation_failed` (that finding is `validation_status === "invalid"` only). An Owner who got leftover `RINGCENTRAL_VALIDATION_UNAVAILABLE` looks unvalidated. Do not silently store `invalid` so “health lights up” without a paired leftover health + leftover `/validate` test.

7. **Missing phone and leftover invalid validation share leftover `RINGCENTRAL_ROUTE_INVALID`.** Operation 2 uses leftover `invalid()` for a fold miss. Operation 4 uses leftover `RINGCENTRAL_ROUTE_INVALID` when leftover `validation_status === "invalid"`. Same code, two stories. Do not silently swap the create code without a paired leftover POST test.

8. **Last-seen skips the Registry Change and the cache forget.** That is load-bearing: leftover snapshot does not key on leftover `last_seen_*`. Do not silently wrap leftover `stampLastSeenOnTheInboundNumber` in leftover `withRegistryMutation` so “every write is audited.” Do not silently invalidate leftover `RINGCENTRAL_ROUTE_CACHE_KEY` on last-seen so “the card looks fresher.”

9. **There is no test on this interface.** Leftover `ringCentralSnapshot.test.ts` and leftover `ringCentralValidation.test.ts` prove siblings. Leftover M5 is an apply script, not an interface test. A later implementer must add the proofs below — do not treat leftover snapshot tests as this file.

10. **Leave sibling modules alone.** Leftover `withRegistryMutation`, leftover `validateRingCentralNumberAgainstAccount`, leftover `resolveRingCentralInboundRoute`, leftover `normalizePhoneNumberToE164Like`, leftover Granot `assertSingleActiveRingCentralAssignment`, leftover health findings, and leftover Call Qualification are already the right **depth**. This file orchestrates the Owner inbound-number card.

11. **Do not silently change persisted audit `action` strings.** `create` / `update` / `validate` / `activate` / `reassign` / `deactivate` are `OperationsRegistryChange` history. Story names live on the functions. Re-label those stored values only as a separate, tested change.

12. **Knowledge’s “snapshot used at Call Qualification time” sentence is leftover snapshot.** Do not “fix” that sentence in this rename by moving leftover `buildRingCentralRouteSnapshot` here.

## Testing

The **interface** is the test surface: `recordOrCorrectAnInboundNumber`, `askRingCentralIfThisAccountCanSeeThisNumber`, `turnTheInboundNumberOnForALiveCallFeed` / `moveTheInboundNumberToAnotherLiveCallFeed`, `archiveTheInboundNumber`, `countWhoStillDependsOnThisInboundNumber`, `showTheOwnerInboundNumbers` / `showOneOwnerInboundNumber`, `stampLastSeenOnTheInboundNumber`.

Today there is **no** `ringCentralRegistry.test.ts`. Leftover snapshot / leftover validation tests prove leftover siblings, not this **interface**.

Add tests that name the operation:

**Record or correct**
- Owner records with no id → insert, `active: false`, `phone_locked: false`, `validation_status: unvalidated`, `ever_activated: false`, Registry Change `action: "create"`, leftover `RINGCENTRAL_ROUTE_CACHE_KEY` forgotten **after** commit.
- Non-owner actor → leftover `FORBIDDEN`.
- Duplicate folded number → leftover `DUPLICATE_IDENTIFIER` with leftover `entity_id` of the existing card.
- Fold miss → leftover `RINGCENTRAL_ROUTE_INVALID` (`A valid phone_number is required.`).
- Number change on an unlocked card `$unset`s leftover validation + leftover RingCentral ids. Number change after leftover `phone_locked` → leftover `IMMUTABLE_FIELD`.
- Missing id on correct → `NOT_FOUND`. Audit failure (leftover `withRegistryMutation` throw) aborts the write and does **not** invalidate leftover `RINGCENTRAL_ROUTE_CACHE_KEY`.

**Ask RingCentral**
- Injected leftover `valid` stamps leftover ids + leftover `observed_target_names` and writes Change `action: "validate"`.
- Injected leftover `invalid` `$unset`s leftover ids and writes leftover `ringcentral.route.validation_failed` **after** commit (`warn`).
- Injected leftover `unavailable` stores leftover `unvalidated` (not leftover `invalid`) and writes the event as `error` + notification candidate.
- Phone changed while the ask was in flight → leftover `STALE_REVISION`; no stamp.

**Turn on / move**
- Fresh leftover `valid` + live call Feed + live company → open assignment, `active: true`, `ever_activated: true`, `phone_locked: true`, archive fields cleared, Change `action: "activate"`.
- Already live with an open assignment → leftover `DEPENDENCY_CONFLICT` on leftover turn-on; leftover move succeeds and closes the prior interval (`effective_until: now`, `active: false`).
- Not live / no open assignment → leftover `DEPENDENCY_CONFLICT` on leftover move.
- Missing / inactive / not-call Feed, or inactive company → leftover `DEPENDENCY_CONFLICT` or leftover `NOT_FOUND`.
- Leftover `invalid` or leftover stale stamp → leftover `RINGCENTRAL_ROUTE_INVALID` / leftover `RINGCENTRAL_ROUTE_UNVALIDATED`. Default window is 24 hours.
- Two open assignments on close → leftover `DEPENDENCY_CONFLICT`.

**Archive / dependents / last-seen**
- Leftover archive sets leftover `archived_at` and closes the open assignment. Leftover `phone_locked` stays true. Change `action: "deactivate"`. There is no delete path. Call Leads that already store leftover `ringcentral.route_id` are unchanged.
- Leftover `countWhoStillDependsOnThisInboundNumber` returns leftover counts and leftover `can_deactivate: true` even when leftover `call_lead_count > 0`.
- Leftover `stampLastSeenOnTheInboundNumber` `$max`es leftover last-seen and does **not** write a Change and does **not** forget leftover `RINGCENTRAL_ROUTE_CACHE_KEY`.

Do **not** add a test per helper (`wipeValidationWhenTheUnlockedNumberChanges`, `stampValidOrWipeProviderIds`, `refuseUnlessTheValidationStampIsStillFresh`). Those names exist so the parent reads. If a helper test has to change when the helper is inlined, it was testing past the **interface**.

`turnTheInboundNumberOnForALiveCallFeed` / `moveTheInboundNumberToAnotherLiveCallFeed` stay exported because Wave B leftover `/activate` and leftover `/reassign` are two real **adapters**, not a test leak. Leftover `RingCentralRouteValidator` stays injectable because leftover M5 is a second real **adapter**. Leftover `withRegistryMutation` owns the transaction-failure proof; do **not** retest leftover sanitizer here.

## What I would not do

- A `RingCentralRegistryService` class with `create` / `update` / `delete`.
- Thirty two-line functions that only wrap leftover `withRegistryMutation` or leftover `normalizePhoneNumberToE164Like`.
- Moving this into a CRUD folder (`create.ts` / `update.ts` / `delete.ts` / `activate.ts`) for cleanliness.
- Breaking the mutation + Registry Change before-commit / cache-invalidate after-commit **seam**. A failed audit must not leave a card and must not forget leftover `RINGCENTRAL_ROUTE_CACHE_KEY`.
- Treating leftover snapshot resolve, leftover account inventory, leftover Call Qualification, leftover Granot “exactly one assignment,” leftover health findings, leftover Source Feed activate, leftover phone fold, or Wave B inbound-route HTTP as this story.
- Inventing a **seam** that has only one **adapter**.
- Silently “fixing” a known order gap while recommending a rename: do not refuse archive when Call Leads exist; do not unlock the phone on archive; do not make leftover snapshot filter `active`; do not move leftover validation events inside the transaction; do not store leftover `unavailable` as leftover `invalid`; do not wrap leftover last-seen in leftover `withRegistryMutation`; do not rename persisted Change `action` strings; do not move leftover snapshot or leftover account inventory into this file; do not swap leftover `RINGCENTRAL_ROUTE_INVALID` on a fold miss without a paired test.
- Jumping to the next service while this one has unchecked modules.
- Writing a whole-folder recommendation for `operationsRegistry`.
