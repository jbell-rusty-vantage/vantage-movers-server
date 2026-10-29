# Stamp This Registry Change With The Card Write — Roll The Card Back If The Change Fails — Forget Named Caches Only After Commit — Call A Reused Request Id Already Processed — Never Flatten The Snapshot Here — Never Decide Who May Speak — Never List The History — Never Write An Operational Event — operational story

- Status: recommended; refreshed 2026-10-29.
- Target: `src/services/operationsRegistry/registryAudit.ts`
- Domain evidence: `docs/knowledge/services/operations-registry.md`
- Current exported operations/constants: `withRegistryMutation`, `withMultiEntityRegistryMutation`.
- Current exported types: `RegistryAuditDeps`.
- Direct import sites found (resolved relative imports): `src/services/operationsRegistry/catalogRegistry.ts`, `src/services/operationsRegistry/cplCorrections.ts`, `src/services/operationsRegistry/cplSchedule.ts`, `src/services/operationsRegistry/crmSourceOutboundSms.ts`, `src/services/operationsRegistry/granotAutomationSources.ts`, `src/services/operationsRegistry/granotCrmSources.ts`, `src/services/operationsRegistry/index.ts`, `src/services/operationsRegistry/labelMappings.ts`, `src/services/operationsRegistry/leadSourceSetup.ts`, `src/services/operationsRegistry/ownerGranotNames.ts`, `src/services/operationsRegistry/registryAudit.test.ts`, `src/services/operationsRegistry/ringCentralRegistry.ts`, `src/services/operationsRegistry/sourceRegistry.ts`, `src/services/systems/locations.ts`.
- Related tests: `src/services/operationsRegistry/registryAudit.test.ts`

## Current boundary and parity

The Registry is the live source, route and cost catalog. Preserve effective-dated assignments and the existing Registry mutation, authorization and audit boundaries. Lead creation resolves the period covering its business timestamp; duplicates cost zero. Correction jobs and stamps remain separate from live Insights pricing and Sheet Sync.

The target and its direct callers are the authority for the exact implementation. Preserve the public signatures, persisted identifiers, transaction and side-effect ordering, error shapes, and idempotency while migrating callers. Keep any existing public name as an alias until its callers move. Do not introduce an additional service class or move policy into a route.

## Remaining cleanup

Read the exported operations above in their actual order and rename only an operation whose name obscures its current outcome or scope. Keep separate operations separate where their callers own different decisions; extract a private helper only when it gives a real decision a clearer name. Migrate the direct callers together, then cover the existing success, refusal, retry and side-effect boundaries relevant to this module with targeted tests. This is a behavior-preserving naming and module-shape pass, not authorization to add effects or change business policy.

## Specific implementation checks from the original brief

2. **Call a reused request id already processed** — same function’s catch. Mongo `11000` whose `keyPattern.request_id === 1` or whose `keyValue.request_id` is a string becomes `RegistryError` / `REGISTRY_DUPLICATE_IDENTIFIER` (`This registry request was already processed.`) with remediation `Generate a new request ID before retrying a different mutation.` Any other throw, including a card-side unique on slug / key / username, stays the original error. The unique index lives on leftover `OperationsRegistryChange` (`request_id`), across every entity type — not per card. This beat does **not** look up the prior Change. This beat does **not** return the first result.

3. **Forget named caches only after commit** — after the transaction **adapter** returns. If `invalidateKeys` is present and non-empty, **ask** skipped `invalidateRegistryCaches`. Listeners (skipped Granot source cache bind, leftover Wave B `adminFacets`) run in-process. A throw from a listener cannot roll the card back — the Change already committed. Omitted or empty keys skip forget. This beat does **not** choose the key names. This beat does **not** list history.

There is no who-may-speak operation. There is no list operation. There is no flatten operation. `insertRegistryChangeAudit` is the persist beat of operation 1, barrelled and unused outside this file. `RegistryAuditDeps` is the test **adapter** (`withTransaction` / `insertAudit`), not a fourth owner story.

Do not export `isDuplicateRequestIdError` as a public **seam**. Do not export `insertRegistryChangeAudit` as domain language for “create a Change.” Do not export a standalone `forgetRegistryCachesAfterCommit` that a caller could run before commit.

1. **The live stamp path is untested at this interface.** `registryAudit.test.ts` always injects `insertAudit`. Default `OperationsRegistryChange.create` plus skipped flatten never run here. Do not silently drop the live insert so “deps are enough” without a paired replica test. Do not silently move flatten into this file so “the stamp test can redact.”

2. **A card-side unique is not a reused request id.** Operation 2 only remaps `11000` when `request_id` is the key. A slug / username / granularity-key clash must stay the card’s `DUPLICATE_IDENTIFIER` (or raw Mongo if the card forgot to map it). Do not silently remap every `11000` so “one conflict code.” Add a mutate-side unique that is **not** remapped.

5. **`insertRegistryChangeAudit` is barrelled and unused.** Grep finds the definition, the `typeof` on deps, and the barrel. No Owner command imports it. Do not silently delete the export from this rename without a paired “no caller” check. Do not silently make card writes call it beside `withRegistryMutation` so “double stamp.”

8. **This file never checks Owner.** Already-recommended card writes call `assertOwner` (or equivalent) first. A test can stamp with any `RegistryActorContext`. Do not silently refuse `admin` here so “the stamp owns auth.” Do not silently import already-recommended `requireRegistryOwnerActor`.

9. **Leave sibling modules alone.** Already-recommended `requireRegistryOwnerActor`, skipped `sanitizeRegistrySnapshot`, skipped `invalidateRegistryCaches`, leftover `listRegistryChanges`, leftover `getRegistryRuntimeTelemetry`, leftover `db.withTransaction`, and leftover `OperationsRegistryChange` are already the right **depth**. This file orchestrates stamp-with-the-card.

## Transaction boundary restored from current implementation

`withRegistryMutation` runs the mutation then sanitized audit insert in one transaction, returning only after commit and named cache invalidation. `withMultiEntityRegistryMutation` gives atomic setup a session-bound audit writer for several entities; it is already a real exported seam. Audit inserts sanitize both snapshots and metadata and carry actor/request/reason/time. Duplicate request-id 11000 maps to Registry duplicate identifier, without replaying a prior result. Neither wrapper verifies Owner; callers own authorization. Do not drop the multi-entity wrapper or claim all Registry commands write exactly one Change.
