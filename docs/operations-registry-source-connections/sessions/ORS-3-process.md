# ORS-3 process notes

Started 2026-09-01 on branch `operations-registry-source-connections` in `vantage-main-server`. No commit authorized. `vantage-admin` is untouched. No SMS enabled, no lifecycle flag changed, no message sent, no production index apply.

## §4 reverify

Observed 2026-08-24; rechecked 2026-09-01 against the repository after ORS-1 and ORS-2.

| Claim | Status |
| --- | --- |
| `queries/overview.ts` exports only `getRegistryOverview()`; no per-Lead-Source projection | Confirmed. |
| `v1.routes.ts` mounts companies / Feeds / Granot / overview / health / changes; no `/lead-sources` | **Drift.** Line numbers moved. Companies `:345-357`, Feeds `:360-375` plus CPL `:417-421`, Granot `:378-391` (includes ORS-2 POST), label mappings `:399-407`, overview `:511`, health `:515`, changes `:519`. Still no lead-sources or lead-source-setups. |
| RingCentral routes: list, detail, create, update, validate / activate / reassign / deactivate / dependencies | Confirmed in `ringcentral-registry.routes.ts`. Activate/reassign still take `source_granularity_id` only (`.strict()`). |
| Health codes listed in the 2026-08-24 issue | Incomplete. ORS-1 and ORS-2 appended codes. Current emitted set is the authority for the translation table (see completion report). |
| Paid Overflow has a first-class `paid_overflow` Form Feed | Confirmed. Setup must not mutate it. |

Corrected in `issues/ORS-3.md` §4 in this pass.

## Decisions

- **Slug / key derivation.** `company_slug` = NFKC-irrelevant snake: trim, lowercase, non `[a-z0-9]` → `_`, trim underscores. Matches `paid_overflow`, `tbm_leads`, `best_relocation_leads`. `granularity_key` = that slug, or `${slug}_${move_type}` when a move type is supplied. Collisions are rejected by name; never suffixed.
- **One transaction.** `withMultiEntityRegistryMutation` opens one session. Company, Feed, and optional Granot persist-in-session helpers plus their audits share it. Nested `withRegistryMutation` commits are not used.
- **Inactive Feed + Granot.** Do not call `createGranotNameFromOwnerIntent` (it `loadActiveFeed`s). Extracted `assembleOwnerGranotCreateForKnownFeed` in `ownerGranotNames.ts` — same translations and one-feed route assembly, no active check. `persistGranotCrmSourceInSession` writes inside the shared session. Semantics already allow inactive company/Feed while `lifecycle_enabled` is false.
- **`assertExactIdentifiersAvailable`** exported from `sourceRegistry.ts` and used early on the setup `crm_label` / `source_sites` predicate.
- **`can_deactivate`.** Stopped returning the field. Counts remain. Deactivation already closes the open assignment; a hardcoded `true` was not a gate.
- **Preview** returns derived keys, collisions, and the readiness plan and writes nothing. Commit throws on any collision after the same validation.
- **Projection** is read-only. Joins bounded by the Lead Source's Feed `$in` set. Health builders run on already-loaded rows. Empty sections are present objects, never omitted.

## Files

See [`../reports/ORS-3-completion.md`](../reports/ORS-3-completion.md).

## What this pass did not do

- ORS-4 (Admin UI, language-deck test, review-sentence render)
- Touch label-mapping or Granot semantics
- Change RingCentral request validation, activation ordering, effective dating, or cache policy (DTO enrichment and `can_deactivate` only)
- Remove Paid Overflow's Feed
- Deprecate `/admin/source-companies` or `/admin/source-granularities`
- Enable SMS, send a message, apply production indexes, deploy, commit, or push
- Preview deploy (not authorized; no deployment ids)
- Full `pnpm test` glob

## Commands run

```text
node --import tsx --import ./scripts/test-setup.ts --test \
  src/services/operationsRegistry/ringCentralRegistry.test.ts \
  src/services/operationsRegistry/queries/findingTranslation.test.ts \
  src/services/operationsRegistry/queries/leadSourceProjection.test.ts \
  src/services/operationsRegistry/leadSourceSetup.test.ts \
  src/routes/lead-source-setups.routes.test.ts \
  src/routes/v1.routes.test.ts \
  src/services/operationsRegistry/queries/health.test.ts
# 46 pass / 0 fail / 0 skipped

pnpm typecheck
# exit 0
```

Typecheck close fixes: `findingTranslation.test.ts` reads `health.ts` via `process.cwd()` (CJS cannot use `import.meta`); RingCentral health input accepts `null` validation fields; projection Granot/CPL casts.
