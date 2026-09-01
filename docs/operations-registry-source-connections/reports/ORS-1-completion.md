# ORS-1 completion

Closed 2026-09-01. Branch `operations-registry-source-connections`. No commit, push, or deploy.

## Files added

- `src/models/LeadSourceLabelMapping.ts`
- `src/services/operationsRegistry/sourceLabelNormalize.ts`
- `src/services/operationsRegistry/labelMappings.ts`
- `src/services/operationsRegistry/labelMappings.test.ts`
- `src/validation/v1/sourceLabelMappings.validation.ts`
- `src/routes/source-label-mappings.routes.test.ts`
- `scripts/migrations/operations-registry-label-mappings.ts`
- `scripts/migrations/operations-registry-label-mappings.test.ts`
- `docs/operations-registry-source-connections/sessions/ORS-1-process.md`
- `docs/operations-registry-source-connections/reports/ORS-1-completion.md`

## Files changed

- `src/models/OperationsRegistryChange.ts` — `source_label_mapping` entity type
- `src/services/operationsRegistry/index.ts` — public exports
- `src/services/operationsRegistry/runtimeTelemetry.ts` — `sheet_legacy_resolution` consumer
- `src/services/operationsRegistry/queries/health.ts` — appended label-mapping findings; compatibility merger accepts the new consumer
- `src/services/operationsRegistry/queries/health.test.ts`
- `src/services/operationsRegistry/sourceResolution.test.ts` — sheet-seam tests
- `src/routes/v1.routes.ts` — one contiguous route block after source-resolution preview
- `src/validation/v1.validation.ts`
- `scripts/migrations/operations-registry-inventory.lib.ts` — proposals, checksum primitive, inventory label collection, §9.2 report
- `package.json` — `migrations:operations-registry-label-mappings`
- `docs/operations-registry-source-connections/issues/ORS-1.md` — §4 reverify drift
- `docs/operations-registry-source-connections/PROGRESS.md`

`src/config/domain/sources.ts` was not modified. Nothing was removed from it.

## Indexes

| Index | Kind | Definition |
| --- | --- | --- |
| `lead_source_label_mappings_active_namespace_normalized_label_unique` | unique partial `active: true` | `{ namespace: 1, normalized_label: 1 }` |
| (unnamed) | non-unique | `{ source_granularity: 1, active: 1 }` |
| (unnamed) | non-unique | `{ source_company: 1, active: 1 }` |

Schema-index proof and service-collision reject are separate tests. Live unique-index apply on production was not authorized.

## `--report` classification counts (verbatim)

Database: `testvantagemovers`. `TEST_MODE=true`. No production payloads read. Distinct Lead snapshot *strings* only.

```json
"classification_counts": {
  "ok": 1,
  "zero_match": 26,
  "multiple_match": 0,
  "cross_company": 3
}
```

```json
"origin_counts": {
  "static_map": 22,
  "feed_crm_label": 4,
  "feed_alias": 0,
  "lead_snapshot": 4
}
```

No manifest was emitted. Exit code 1 is the stop-on-blocking rule.

Named `cross_company` labels (test-fixture Feeds sharing a `crm_label`):

- `U19 Call`
- `U19 Form Local`
- `U19 Form Long`

The single `ok` proposal is `Unit 21 Synthetic Calls`. It is not written because blocking labels remain.

The `--report` fixture test with one `cross_company` label (`Best Relocation Forms`) also exits without a manifest and names that label.

`10Best Inbounds` and `10best Inbounds` collapse to one static-map key after `normalizeSourceLabel`, which is why `static_map` is 22 against 23 `SOURCE_LABEL_TO_COMPANY` keys.

## §9.2 embedded `granularities[]`

Indexes (still present, nothing dropped):

- `granularities.granularity_key`
- `granularities.crm_label`
- `granularities.inbound_phone_numbers`

Live / retained readers:

- `src/models/LeadSourceCompany.ts` — schema + the three indexes
- `src/services/leadSourceCompanies/leadSourceCompany.service.ts` — seed / list / legacy resolve
- `src/services/operationsRegistry/sourceRegistry.ts` — `toCompanyItem` still maps `doc.granularities`
- `src/services/cpl/cplRate.service.ts` — admin CPL list
- `src/services/operationsRegistry/sourceModels.test.ts` — schema fixture write
- `scripts/migrations/operations-registry-inventory.lib.ts` — inventory evidence

`removed_in_this_pass: false`.

## Remaining static-map consumers (deliberately not migrated)

| Consumer | Why left |
| --- | --- |
| `src/services/analytics/analyticsFilters.ts` | Reporting. Still iterates `SOURCE_LABEL_TO_COMPANY`. |
| `src/services/analytics/sourceHierarchy.ts` | Reporting tree. Uses `SOURCE_COMPANY_CONFIGS`, not the label map. |
| `src/services/cpl/cplRate.service.ts` | Pricing. Type-only import; compatibility telemetry is `legacy_cpl_rates`. |
| `src/services/leadSourceCompanies/leadSourceCompany.service.ts` | Seed aliases from the static map. |
| `src/services/ringcentral/call-lead-sources.ts` | M5 / fixture seed re-export. Not runtime routing. |
| `src/services/granotHttpCollector/granotFormLeadMatcher.ts` | Granot HTTP matching via `resolveSourceCompanyFromLabel`. |
| `src/services/reconciliation/bookedCallLeadRows.ts` | Reconciliation company slug from a source label. |
| `resolveSourceCompany()` in `sources.ts` | Company-slug resolution still consults the label map first. Form/admin path is `previewSourceAttribution` and was not changed. |

`formLeadPayload.ts` is not a live importer (comment-only mention of CRM labels).

## Sheet/legacy seam

There was no existing Feed-addressed sheet write path. `SOURCE_LABEL_TO_COMPANY` only yields a company slug. The official seam is `resolveSheetOrLegacyLabel(namespace, rawLabel)`:

1. `resolveLabelToFeed`
2. `not_found` only → `consultStaticSourceLabelMap` + one `recordDurableCompatibilityRead` (`SOURCE_LABEL_TO_COMPANY` / `sheet_legacy_resolution`)
3. `ambiguous` or `inactive_destination` fail closed; no static fallback; raise `operations_registry.source_resolution_*` (feeds `registry.source_resolution_failures`)

`previewSourceAttribution` is unchanged.

`LabelResolution` includes a fourth status, `inactive_destination`, so a found mapping pointed at an inactive Feed cannot be mistaken for `not_found` and fall back. Spec sketch named three statuses; this is the fail-closed case.

## `RegistryActorContext` vs `RegistryActorSnapshot`

Persisted and audited as `RegistryActorContext` (real type). Spec §3.3 sketch still says `RegistryActorSnapshot`. Snake_case on the document (`actor_type`, `actor_id`, `actor_label`, `actor_role`, `request_id`).

## Tests and typecheck

Focused (46/46 pass):

```text
node --import tsx --import ./scripts/test-setup.ts --test \
  src/services/operationsRegistry/labelMappings.test.ts \
  src/services/operationsRegistry/sourceResolution.test.ts \
  src/services/operationsRegistry/queries/health.test.ts \
  src/routes/source-label-mappings.routes.test.ts \
  scripts/migrations/operations-registry-label-mappings.test.ts

ℹ tests 46
ℹ pass 46
ℹ fail 0
```

Also run after checksum extraction: `scripts/migrations/operations-registry-inventory.test.ts` and `src/services/operationsRegistry/runtimeTelemetry.test.ts` — 12/12 pass.

`pnpm typecheck` — pass.

Full `pnpm test` was not run as one command (`pnpm test -- files` still expands the package.json glob). All new and changed test files above were run.

`TEST_MODE=true pnpm migrations:operations-registry-label-mappings` — report mode, exit 1 (blocking `zero_match` and `cross_company`), counts above.

## Preview deployment ids

None. This pass is not authorized to deploy.

## Acceptance criteria (§10)

| Criterion | Evidence |
| --- | --- |
| One `normalizeSourceLabel` on write and read; NFKC / collapse / trim / lowercase / full-width / NBSP named tests | `sourceLabelNormalize.ts`; six named tests in `labelMappings.test.ts` |
| Second active mapping rejected by service **and** unique index, separately | service collision test + schema index definition test |
| Feed/Lead Source mismatch rejected; error names both | create validation-order test |
| Client `normalized_label` rejected | Zod `.strict()` + service check |
| `change_reason` 10–1000 | Zod + service |
| No in-place destination edit; deactivate + create; archived row survives | service + schema immutability tests |
| Collection hit does not read the static map | named test `resolves without touching the static map` asserts consult count 0 |
| Empty collection falls back + exactly one compatibility-read | `sourceResolution.test.ts` |
| Inactive-Feed mapping fails closed, no fallback | named test |
| Invalid destination finding in Health | `health.test.ts` |
| `--report` cross_company fixture exits without manifest and names the label | fixture test + live `testvantagemovers` names U19 labels |
| `--apply` refuses checksum mismatch | migration test |
| §9.2 reader list; nothing removed | `reportEmbeddedGranularitiesUsage` |
| Mutations audited with actor + reason | create/deactivate audit tests |
| Health renders with empty mappings collection | `buildLabelMappingHealthFindings([], [], [])` |

## What was not done

- No deletion from `config/domain/sources.ts`
- No removal of embedded `granularities[]` or its indexes
- No Granot / SMS / `daily_cap` work (ORS-2)
- No aggregate projection / lead-source-setups / RingCentral DTO work (ORS-3)
- No Admin UI (ORS-4)
- No feature flag
- No commit, push, production index apply, SMS enable, or live production payload read
- ORS-3 left `blocked` (ORS-2 is not complete)
