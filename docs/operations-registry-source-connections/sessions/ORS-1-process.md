# ORS-1 process notes

Started 2026-09-01 on branch `operations-registry-source-connections` in `vantage-main-server`. No commit authorized. `vantage-admin` is untouched.

## §4 reverify

Observed 2026-08-24; rechecked 2026-09-01 against the repository (before and after this pass).

| Claim | Status |
| --- | --- |
| `src/models/LeadSourceLabelMapping.ts` does not exist | Confirmed at start. Added this pass. |
| `src/config/domain/sources.ts` exports `SOURCE_COMPANIES`, `CRM_SOURCE_LABELS`, `SOURCE_LABEL_TO_COMPANY` (label → company) and reads no `process.env` | Confirmed. File is 280 lines. Untouched. |
| `sourceResolution.ts` private `normalize()` is trim+lowercase only | Confirmed (~line 283). Not reused for mapping keys. |
| `queries/health.ts` already emits `registry.compatibility_reads_remaining` and `registry.source_resolution_failures` | Confirmed. Reused. Label-mapping findings appended at end of assembly. |
| Actor type is `RegistryActorContext` in `types.ts` | Confirmed. Spec §3.3 sketch still says `RegistryActorSnapshot`. |
| Inventory lib already has checksum / collision / apply-guard helpers | Confirmed. `pnpm migrations:operations-registry-inventory` exists. Extended; no second inventory. |

### Importer drift (corrected in ORS-1.md)

ORS-1 §4 listed these as live `SOURCE_LABEL_TO_COMPANY` importers:

- `analyticsFilters.ts` — still a live reporting consumer. Left on the static map.
- `sourceHierarchy.ts` — **drift.** Imports `SOURCE_COMPANY_CONFIGS` only, not `SOURCE_LABEL_TO_COMPANY`.
- `cplRate.service.ts` — **drift.** Imports the `SourceCompany` type only. Compatibility telemetry here is `legacy_cpl_rates`, not the label map.
- `formLeadPayload.ts` — **drift.** Mentions `CRM_SOURCE_LABELS` in a comment. Does not import the static map. Builds outbound Granot payloads.
- `call-lead-sources.ts` — **drift.** Re-exports the map for M5 migration / fixture seeds. Comment already says production routing must use the Registry snapshot. Not a runtime attribution write path.

Additional live / seed importers not listed in the 2026-08-24 snapshot:

- `src/services/leadSourceCompanies/leadSourceCompany.service.ts` — seed aliases from the static map. Not the sheet/legacy write path.
- `src/services/granotHttpCollector/granotFormLeadMatcher.ts` — `resolveSourceCompanyFromLabel` for Granot HTTP matching (ORS-2 / reporting-adjacent; not rewired).
- `src/services/reconciliation/bookedCallLeadRows.ts` — legacy company slug from a source label (reporting/recon; left).
- `src/config/domain/sources.ts` `resolveSourceCompany()` itself consults `resolveSourceCompanyFromLabel` first. That is company-slug resolution for form/admin/bookings, not Feed-addressed sheet attribution.

Script importers from §4 remain: dump/audit/inventory scripts.

## Decisions

- **Type home:** `LeadSourceLabelMapping` lives in `src/models/LeadSourceLabelMapping.ts` following `LeadSourceGranularity` (`getLeadSourceLabelMappingModel()` + `getMongoDatabaseName()`). Actor snapshot is persisted snake_case and mapped to `RegistryActorContext`.
- **Normalizer home:** `normalizeSourceLabel` is implemented once in `src/services/operationsRegistry/sourceLabelNormalize.ts` and re-exported from `labelMappings.ts`. The model validator imports that module so it cannot drift from the service, and so the model does not cycle through the service's Mongo helpers.
- **Service home:** `src/services/operationsRegistry/labelMappings.ts` owns create / activation / list / `resolveLabelToFeed` / `resolveSheetOrLegacyLabel`.
- **Sheet/legacy seam:** There is no existing Feed-addressed sheet write path. `SOURCE_LABEL_TO_COMPANY` / `resolveSourceCompanyFromLabel` only produce a company slug. Best Relocation ingest hardcodes `best_relocation_leads`. Form/admin create uses `previewSourceAttribution` (spec §2.3) and was not changed. The official seam is `resolveSheetOrLegacyLabel(namespace, rawLabel)`.
- **Static-map instrument:** `consultStaticSourceLabelMap` is the only function that reads `SOURCE_LABEL_TO_COMPANY` from this pass. Tests assert consult count, not a buried fixture.
- **Compatibility consumer:** added `sheet_legacy_resolution` to the existing telemetry union and health merger. Path is `SOURCE_LABEL_TO_COMPANY`. No parallel counter.
- **Routes:** mounted as one contiguous block in `v1.routes.ts` immediately after `/api/v1/admin/source-resolution/preview`. Schema-level route tests, matching Granot.
- **Health:** new findings appended at the end of assembly. Existing finding order is unchanged.
- **Inventory:** proposal / classify / checksum / embedded-`granularities[]` report helpers extend `operations-registry-inventory.lib.ts`. One inventory.
- **Inventory label sources:** `--report` now collects static map keys, first-class Feed `crm_label`/aliases, and distinct stored Lead snapshot strings (`crm_source_label_snapshot`, `source_company_label_snapshot`) from the allowed database. Live Google Sheet payloads are not read. Dedup is namespace + `normalizeSourceLabel`, preferring static_map → feed_crm_label → feed_alias → lead_snapshot.
- **Checksum reuse:** `computeInventoryChecksum` and the label-mapping manifest share `hashInventoryValue` (the same `stableStringify` + sha256 primitive). `computeInventoryChecksum` stays typed to `InventorySnapshot`; the mapping manifest cannot pass that shape.
- **`LabelResolution`:** `resolveLabelToFeed` adds `inactive_destination` when a mapping exists but the Feed / Lead Source is missing, inactive, or mismatched. That is not a miss (`not_found` would incorrectly fall back to the static map). Spec sketch named three statuses; this fourth status is the fail-closed case.

## Files added / changed

See [`../reports/ORS-1-completion.md`](../reports/ORS-1-completion.md).

## Commands

Focused tests (correct `node --test` invocation; `pnpm test -- files` still runs the whole glob): 46/46 pass.

`pnpm typecheck`: pass.

Related tests after checksum extraction: `operations-registry-inventory.test.ts` and `runtimeTelemetry.test.ts` — 12/12 pass.

`TEST_MODE=true pnpm migrations:operations-registry-label-mappings` against `testvantagemovers`:

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

Exit 1 because blocking `zero_match` and `cross_company` proposals must not emit a manifest. The three `cross_company` labels are named: `U19 Call`, `U19 Form Local`, `U19 Form Long` (test-fixture Feeds sharing a `crm_label`). Full `pnpm test` was not run as a single command; all new/changed test files above were run.

## What this pass will not do

- Delete anything from `config/domain/sources.ts`.
- Remove embedded `granularities[]` or drop its three indexes.
- Touch Granot create / SMS / `daily_cap` (ORS-2).
- Touch lead-source-setups, aggregate projection, RingCentral DTOs (ORS-3).
- Touch `vantage-admin` (ORS-4).
- Rewire analytics / CPL / recon / Granot HTTP matching off the static map.
- Add a feature flag.
- Commit, push, deploy, apply production indexes, enable SMS, or read live production payloads.
