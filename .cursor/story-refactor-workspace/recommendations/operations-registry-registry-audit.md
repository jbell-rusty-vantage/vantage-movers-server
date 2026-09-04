# Stamp This Registry Change With The Card Write — Roll The Card Back If The Change Fails — Forget Named Caches Only After Commit — Call A Reused Request Id Already Processed — Never Flatten The Snapshot Here — Never Decide Who May Speak — Never List The History — Never Write An Operational Event — operational story

- Status: recommended
- Service: `operationsRegistry` (Wave A, in-progress)
- Pass: 14 of this service — `registryAudit.ts`
- Remaining in this service: `runtimeTelemetry.ts`, `queries/overview.ts`, `queries/health.ts`, `queries/changes.ts`
- Target: `src/services/operationsRegistry/registryAudit.ts`
- Knowledge: [`docs/knowledge/services/operations-registry.md`](../../../docs/knowledge/services/operations-registry.md) (Authorization and audit: domain mutation and Registry Change insert commit in one transaction; cache invalidation runs after commit; Registry Changes are authoritative successful mutation history; Operational Events are reserved for failures, ambiguity, drift, and migration outcomes). Software rule: [`.cursor/rules/operations-registry.mdc`](../../../.cursor/rules/operations-registry.mdc) (mutation and `operations_registry_changes` insert share one Mongo transaction; audit failure aborts the mutation; cache invalidation occurs only after commit; audit snapshots must be bounded and redact secrets, credentials, tokens, authorization values, and provider payloads — this file **asks** skipped `sanitizeRegistrySnapshot` / `sanitizeRegistryMetadata`; it does **not** flatten). Already-recommended who-may-speak: [recommendations/operations-registry-trusted-actor.md](operations-registry-trusted-actor.md) (**does not** write a Registry Change; leftover `withRegistryMutation` is the persist this file owns). Already-recommended card writes that **ask** this file: [recommendations/operations-registry-catalog-registry.md](operations-registry-catalog-registry.md), [recommendations/operations-registry-source-registry.md](operations-registry-source-registry.md), [recommendations/operations-registry-cpl-schedule.md](operations-registry-cpl-schedule.md), [recommendations/operations-registry-cpl-corrections.md](operations-registry-cpl-corrections.md), [recommendations/operations-registry-ring-central-registry.md](operations-registry-ring-central-registry.md), [recommendations/operations-registry-granot-crm-sources.md](operations-registry-granot-crm-sources.md), [recommendations/operations-registry-crm-source-outbound-sms.md](operations-registry-crm-source-outbound-sms.md), [recommendations/operations-registry-granot-automation-sources.md](operations-registry-granot-automation-sources.md). Skipped sibling flatten: `snapshotSanitizer.ts`. Skipped sibling forget-notify: `cacheInvalidation.ts` (`invalidateRegistryCaches` / `onRegistryCacheInvalidation`). Leftover list: `queries/changes.ts` (**reads** the Change; **does not** stamp it). Leftover next: `runtimeTelemetry.ts`. This checkout’s `CONTEXT.md` does not define Registry Change / Operations Registry — do not invent a glossary copy. `docs/adr/` is absent here — do not invent an ADR copy. Do not add this path to knowledge in this rename.
- Callers: already-recommended `catalogRegistry.ts` (Agent / Merchant). Already-recommended `sourceRegistry.ts` (Source Company / Source Feed). Already-recommended `cplSchedule.ts` (`defaultRunMutation` **asks** this). Already-recommended `cplCorrections.ts` (file / cancel the prior-Lead rewrite job). Already-recommended `ringCentralRegistry.ts`. Already-recommended `granotCrmSources.ts`. Already-recommended `crmSourceOutboundSms.ts`. Already-recommended `granotAutomationSources.ts`. Barrel: `operationsRegistry/index.ts` (`withRegistryMutation` + unused `insertRegistryChangeAudit`). Tests: `registryAudit.test.ts` (audit failure rolls back and skips forget; forget only after commit; reused `request_id` is `REGISTRY_DUPLICATE_IDENTIFIER`; Granot-name audit failure same rollback). The last test in that file **asks** skipped `invalidateRegistryCaches` directly — it is not this **interface**. Leftover `queries/changes.ts` / already-recommended `trustedActor.ts` / skipped `snapshotSanitizer.ts` **do not import this file**. Wave B routes **ask** the card commands, not this file.
- Seams callers need: stamp-with-the-card (`withRegistryMutation`: `mutate` + Change insert before commit vs named-key forget after commit); injected transaction / insert (`RegistryAuditDeps`) vs default `db.withTransaction` + live `OperationsRegistryChange.create`; reused `request_id` unique → `REGISTRY_DUPLICATE_IDENTIFIER` vs any other mutate throw. There is no who-may-speak **seam**. There is no flatten **seam**. There is no list-history **seam**. There is no Operational Event **seam**.
- Split later (only if the file outgrows one sitting): this ~101-line file is one sitting if you read it as stamp this Registry Change with the card write — roll the card back if the Change fails — forget named caches only after commit — call a reused request id already processed — never flatten the snapshot here — never decide who may speak — never list the history — never write an Operational Event. Do **not** split stamp vs forget into two public exports a caller could call in the wrong order — that **is** the before-commit / after-commit **seam**. If it later splits: `stampThisRegistryChangeWithTheCardWrite.ts` only as a later story file, never `create.ts` / `update.ts` / `delete.ts` / `audit.ts`, and never merge already-recommended card writes, already-recommended who-may-speak, skipped flatten, skipped forget-notify, leftover list, leftover telemetry, or Wave B HTTP into this file

`withRegistryMutation` / `insertRegistryChangeAudit` are executor mechanics. The owner question is: *An Owner just changed a Registry card. The card write and one Registry Change must land together. If the Change cannot be written, the card write did not happen. Forget the named caches only after that commit. A request id is unique across every Registry Change — reuse means this request was already processed, not a raw Mongo duplicate. This file asks skipped flatten for before / after / metadata. This file does not decide who may speak. This file does not list the history. This file does not write an Operational Event.*

Already-recommended card writes, already-recommended who-may-speak, skipped flatten, skipped forget-notify, leftover list, leftover telemetry, and Wave B HTTP already live in other **modules**. Do not pull those in.

## What this file actually does

Three operations of one “stamp this Registry Change with the card write — roll the card back if the Change fails — forget named caches only after commit — call a reused request id already processed — never flatten the snapshot here — never decide who may speak — never list the history — never write an Operational Event” story, not “an audit CRUD helper,” and not leftover who-may-speak / leftover list:

1. **Stamp this Registry Change with the card write** — `withRegistryMutation` before-commit beat. Caller already refused who may speak and already built `{ actor, audit, mutate, invalidateKeys? }`. Default transaction **adapter** is leftover `db.withTransaction`. Inside the session: run `input.mutate(session)`, then write one `OperationsRegistryChange` (`insertRegistryChangeAudit`): `entity_type` / `entity_id` / `action` from `audit`; actor fields from `actor`; `request_id` from `actor.requestId`; `reason` trimmed or omitted; `before` / `after` **ask** skipped `sanitizeRegistrySnapshot`; `metadata` **asks** skipped `sanitizeRegistryMetadata`; `created_at` is `new Date()` here. If the insert throws, the transaction **adapter** rolls the card write back. This beat does **not** check `actor.actorRole`. This beat does **not** flatten. This beat does **not** write an Operational Event.

2. **Call a reused request id already processed** — same function’s catch. Mongo `11000` whose `keyPattern.request_id === 1` or whose `keyValue.request_id` is a string becomes `RegistryError` / `REGISTRY_DUPLICATE_IDENTIFIER` (`This registry request was already processed.`) with remediation `Generate a new request ID before retrying a different mutation.` Any other throw, including a card-side unique on slug / key / username, stays the original error. The unique index lives on leftover `OperationsRegistryChange` (`request_id`), across every entity type — not per card. This beat does **not** look up the prior Change. This beat does **not** return the first result.

3. **Forget named caches only after commit** — after the transaction **adapter** returns. If `invalidateKeys` is present and non-empty, **ask** skipped `invalidateRegistryCaches`. Listeners (skipped Granot source cache bind, leftover Wave B `adminFacets`) run in-process. A throw from a listener cannot roll the card back — the Change already committed. Omitted or empty keys skip forget. This beat does **not** choose the key names. This beat does **not** list history.

There is no who-may-speak operation. There is no list operation. There is no flatten operation. `insertRegistryChangeAudit` is the persist beat of operation 1, barrelled and unused outside this file. `RegistryAuditDeps` is the test **adapter** (`withTransaction` / `insertAudit`), not a fourth owner story.

Do not export `isDuplicateRequestIdError` as a public **seam**. Do not export `insertRegistryChangeAudit` as domain language for “create a Change.” Do not export a standalone `forgetRegistryCachesAfterCommit` that a caller could run before commit.

## Organization

Keep one file as the screenplay for “stamp this Registry Change with the card write, roll the card back if the Change fails, forget named caches only after commit, call a reused request id already processed, never flatten the snapshot here, never decide who may speak, never list the history, never write an Operational Event.” Already-recommended card writes, already-recommended who-may-speak, skipped flatten, skipped forget-notify, leftover list, leftover telemetry, leftover `db.withTransaction`, leftover `OperationsRegistryChange` model, and Wave B HTTP already live in deeper **modules**. Do not pull those in. Do not invent a `RegistryAuditService` class. Do not invent a public begin / complete **seam** — this file **is** the before-commit / after-commit **adapter** the card writes already **ask**. Do not invent a second flatten **adapter** beside skipped `sanitizeRegistrySnapshot`. Do not invent a second forget **adapter** beside skipped `invalidateRegistryCaches`. Do not invent a second who-may-speak **adapter** beside already-recommended `requireRegistryOwnerActor`.

Do not split this into `create.ts` / `update.ts` / `delete.ts` / `audit.ts`. Those are persistence verbs, not the owner story. Do not move skipped flatten into this file so “the stamp owns redact.” Do not move skipped forget-notify into this file so “the stamp owns listeners.” Do not move leftover `listRegistryChanges` into this file so “one file owns the Change.” Do not move already-recommended who-may-speak here so “the write checks Owner.” Do not silently write an Operational Event on audit failure so “failures are visible” — knowledge already reserves Events for failures elsewhere; a failed stamp leaves no card write and no Change.

**External interface** stays small (this is the test surface). Stamp / refuse-replay / forget-after-commit are one story’s persist, not three CRUD verbs:

| Keep exporting | Story name | Why the seam exists |
|---|---|---|
| `withRegistryMutation` | `stampThisRegistryChangeWithTheCardWrite` | every already-recommended Owner card write |
| `insertRegistryChangeAudit` | keep as alias only | barrelled; no Owner-command caller; do not promote |
| `RegistryAuditDeps` | `StampThisRegistryChangeWithTheCardWriteDeps` | tests inject transaction / insert |

Keep the old names as one-line aliases until already-recommended card writes, the barrel, and `registryAudit.test.ts` migrate. Do not make callers learn `withRegistryMutation` / `insertAudit` as the domain language.

**Principle: old exports stay as aliases.** `withRegistryMutation` remains the imported name until catalog / sources / CPL / RingCentral / Granot commands point at the story name. Persisted Change `action` strings (`create` / `update` / `activate` / `deactivate` / `correction` / …) and leftover `REGISTRY_DUPLICATE_IDENTIFIER` stay those strings — they are audit history and HTTP bodies, not story names.

**No class for the workflow.** The type that *does* earn a name is the leftover bag callers already pass (today `RegistryMutationInput` in skipped `types.ts`):

```ts
type StampThisRegistryChangeWithTheCardWrite = {
  actor: WhoThisRegistryCallIsSpeakingAs
  audit: {
    entityType: /* leftover RegistryChangeEntityType */
    entityId: string
    action: /* leftover RegistryChangeAction — persisted strings */
    reason?: string
    before?: Record<string, unknown> | null
    after?: Record<string, unknown> | null
    metadata?: Record<string, unknown>
  }
  mutate: (session: ClientSession) => Promise<T>
  invalidateKeys?: string[]
}
```

That is the handoff from “the Owner command decided what changed” to “this file stamps the Change with the card write and forgets caches only after commit.” Do **not** add `actorRole` checking onto this bag so “the stamp refuses Admin.” Do **not** add `operationalEvent` so “failures leave a row.” Do **not** store raw secrets in `before` / `after` and skip flatten so “the Owner can see the token.”

Do not add `sanitizeRegistrySnapshot` as a public **seam** on this file — skipped `snapshotSanitizer.ts` already owns bounded redact. Do not add `invalidateRegistryCaches` as a public **seam** on this file — skipped `cacheInvalidation.ts` already owns notify. Do not add `listRegistryChanges` as a public **seam** — leftover `queries/changes.ts` already owns the read. Do not add `requireRegistryOwnerActor` as a public **seam** — already-recommended `trustedActor.ts` already owns who may speak.

## The file, as a story

Parent functions stay deep. Child names are only extracted when they hide a real decision, not a one-liner.

```ts
// registryAudit.ts
// An Owner just changed a Registry card.
// The card write and one Registry Change must land together.
// If the Change cannot be written, the card write did not happen.
// Forget the named caches only after that commit.
// A request id is unique across every Registry Change.
// Reuse means this request was already processed.
// Ask skipped flatten for before / after / metadata.
// Do not decide who may speak.
// Do not list the history.
// Do not write an Operational Event.

// ── 1. Stamp this Registry Change with the card write ─────

export async function stampThisRegistryChangeWithTheCardWrite(input, deps)

async function writeTheSanitizedRegistryChange(session, auditAndActor)

// ── 2. Call a reused request id already processed ─────────

function thisIsAReusedRegistryRequestId(error)

// ── 3. Forget named caches only after commit ──────────────

function forgetTheNamedCachesAfterCommit(keys)
```

Read the primary path out loud: *An Owner changed a Registry card. Run the card write and stamp one sanitized Registry Change in the same transaction. If that stamp fails, the card write did not happen. If this request id already produced a Change, say this request was already processed. After commit, forget the named caches. Do not flatten here. Do not decide who may speak. Do not list the history. Do not write an Operational Event.*

That is the operation. `withRegistryMutation` is not.

## Precise logic I would tighten while renaming

These are real smells the story names make obvious. Do not “just rename.”

1. **The live stamp path is untested at this interface.** `registryAudit.test.ts` always injects `insertAudit`. Default `OperationsRegistryChange.create` plus skipped flatten never run here. Do not silently drop the live insert so “deps are enough” without a paired replica test. Do not silently move flatten into this file so “the stamp test can redact.”

2. **A card-side unique is not a reused request id.** Operation 2 only remaps `11000` when `request_id` is the key. A slug / username / granularity-key clash must stay the card’s `DUPLICATE_IDENTIFIER` (or raw Mongo if the card forgot to map it). Do not silently remap every `11000` so “one conflict code.” Add a mutate-side unique that is **not** remapped.

3. **A reused request id that arrives as `errmsg` only is not remapped today.** The detector needs `code === 11000` plus `keyPattern.request_id` or string `keyValue.request_id`. A wrapped driver shape can leak Mongo. Do not silently widen the detector so “all E11000 strings match” without a paired shape test. Do not silently look up the prior Change so “return the first result.”

4. **Forget cannot un-commit.** Operation 3 runs after the transaction **adapter** returns. A listener throw leaves the card and the Change. Do not silently move forget inside the transaction so “forget is atomic.” Do not silently swallow listener throws so “commit always looks clean” without a paired after-commit test.

5. **`insertRegistryChangeAudit` is barrelled and unused.** Grep finds the definition, the `typeof` on deps, and the barrel. No Owner command imports it. Do not silently delete the export from this rename without a paired “no caller” check. Do not silently make card writes call it beside `withRegistryMutation` so “double stamp.”

6. **The last test in this file is skipped forget-notify.** `invalidateRegistryCaches deduplicates keys` **asks** skipped `cacheInvalidation.ts`. Keep it until that sibling has its own interface test; do not treat it as this story’s surface. Do not silently move listener dedup into this file.

7. **Empty reason becomes omitted, not `""`.** `input.reason?.trim() || undefined`. Do not silently persist blank reason so “the field is always present” without a paired Change-row test.

8. **This file never checks Owner.** Already-recommended card writes call `assertOwner` (or equivalent) first. A test can stamp with any `RegistryActorContext`. Do not silently refuse `admin` here so “the stamp owns auth.” Do not silently import already-recommended `requireRegistryOwnerActor`.

9. **Leave sibling modules alone.** Already-recommended `requireRegistryOwnerActor`, skipped `sanitizeRegistrySnapshot`, skipped `invalidateRegistryCaches`, leftover `listRegistryChanges`, leftover `getRegistryRuntimeTelemetry`, leftover `db.withTransaction`, and leftover `OperationsRegistryChange` are already the right **depth**. This file orchestrates stamp-with-the-card.

10. **Do not silently change persisted Change fields or leftover error codes.** `entity_type` / `action` / unique `request_id` and `REGISTRY_DUPLICATE_IDENTIFIER` are the audit contract. Story names live on the functions.

## Testing

The **interface** is the test surface: `stampThisRegistryChangeWithTheCardWrite`. `RegistryAuditDeps` stays exported because the replica-less unit tests are a real second **adapter**, not a test leak. Do not make `insertRegistryChangeAudit` the named surface.

Today `registryAudit.test.ts` already proves audit-insert failure rolls back and skips forget, forget only after commit, reused `request_id` is `REGISTRY_DUPLICATE_IDENTIFIER`, Granot-name audit failure same rollback. Keep those. Add tests that name the operation:

**Stamp this Registry Change with the card write**
- Mutate then stamp then return the mutate result (already on disk — keep it).
- Stamp failure → mutate rolled back, forget log empty (already on disk — keep it).
- Live insert (no `insertAudit` inject) writes one Change whose `before` / `after` already went through skipped flatten (`api_secret` → `[redacted]`). Add a replica test; do not retest flatten depth here.
- Empty / whitespace `reason` is omitted on the Change, not `""`.
- Omitted `invalidateKeys` does not **ask** forget. Empty array does not **ask** forget.

**Call a reused request id already processed**
- Audit `11000` on `request_id` → `REGISTRY_DUPLICATE_IDENTIFIER` / “already processed” (already on disk — keep it).
- Mutate `11000` on a different key (`keyPattern: { company_slug: 1 }`) stays the original throw — not remapped.
- Do not add a “return the first Change” test. This file does not look it up.

**Forget named caches only after commit**
- Keys passed after a successful stamp appear once on skipped forget-notify (already on disk — keep it).
- Do not retest listener dedup here. That is skipped `cacheInvalidation.ts`.
- Do not retest leftover `listRegistryChanges` paging here.

Do **not** add a test per helper (`writeTheSanitizedRegistryChange`, `thisIsAReusedRegistryRequestId`, `forgetTheNamedCachesAfterCommit`). Those names exist so the parent reads. If a helper test has to change when the helper is inlined, it was testing past the **interface**.

Do **not** retest already-recommended Owner refuse, skipped flatten nesting, leftover Change list filters, leftover telemetry counters, or Wave B route mounts here. Those already have (or will have) their own interface tests. Card writes **ask** this stamp; prove the stamp, not the Agent card.

## What I would not do

- A `RegistryAuditService` class with `create` / `update` / `delete`.
- Thirty two-line functions that only wrap `OperationsRegistryChange.create`.
- Moving this into a CRUD folder (`create.ts` / `update.ts` / `delete.ts` / `audit.ts`) for cleanliness.
- Breaking the before-commit mutate+Change / after-commit forget **seam**. A public `forgetAfterCommit` a caller could run first is the forbidden split.
- Treating already-recommended who-may-speak, already-recommended card writes, skipped flatten, skipped forget-notify, leftover `listRegistryChanges`, leftover telemetry, leftover `db.withTransaction`, or Wave B HTTP as this story.
- Inventing a **seam** that has only one **adapter**.
- Silently "fixing" a known gap while recommending a rename: do not remap every `11000`; do not widen the replay detector without a paired shape test; do not look up and return the first Change; do not move forget inside the transaction; do not swallow listener throws; do not delete unused `insertRegistryChangeAudit` without a paired check; do not make card writes call it beside the stamp; do not refuse Admin here; do not write an Operational Event on stamp failure; do not persist blank reason; do not merge flatten or list into this file; do not rename persisted `action` / `entity_type` strings or leftover `REGISTRY_DUPLICATE_IDENTIFIER`.
- Jumping to the next service while this one has unchecked modules.
- Writing a whole-folder recommendation for `operationsRegistry`.
