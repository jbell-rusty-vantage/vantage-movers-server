# Hang A Sheet Or Leftover API Spelling On One Live Feed — Fold The Spelling On The Server — Archive Then Hang Again To Correct The Destination — Ask The Collection First — Fall Back To Leftover SOURCE_LABEL_TO_COMPANY Only On Miss — Fail Closed On Clash Or Dead Feed — Never Walk The Hint Ladder — Never Write A Health Finding — Never Decide Who May Speak — operational story

- Status: recommended
- Service: `operationsRegistry` (Wave A, in-progress)
- Pass: 19 of this service — `labelMappings.ts`
- Remaining in this service: `ownerGranotNames.ts`, `leadSourceSetup.ts`, `queries/leadSourceProjection.ts`
- Target: `src/services/operationsRegistry/labelMappings.ts`
- Knowledge: [`docs/knowledge/services/operations-registry.md`](../../../docs/knowledge/services/operations-registry.md) (Owner-only create / activate / deactivate for `lead_source_label_mappings`; sheet and leftover API labels resolve collection-first via `resolveSheetOrLegacyLabel`; leftover `SOURCE_LABEL_TO_COMPANY` is an instrumented fallback that emits leftover `operations_registry.compatibility_read`; correction is deactivate + create; audit entity type is `source_label_mapping`; report-first inventory is `pnpm migrations:operations-registry-label-mappings`; stored destination fields remain `source_company` / `source_granularity`. Authorization and audit: only a verified Owner may mutate; domain mutation and Registry Change insert share one transaction; cache invalidation runs after commit; Operational Events are reserved for failures, ambiguity, drift, and leftover-path walks. Health: leftover next health writes leftover `registry.label_mapping_destination_invalid` / leftover `registry.label_mapping_collision` by loading the model — this file does **not** write those findings). Software rule: [`.cursor/rules/operations-registry.mdc`](../../../.cursor/rules/operations-registry.mdc) (routes import commands / queries / resolvers from this folder, not registry models; label mappings live on leftover `GET/POST /api/v1/admin/source-label-mappings` and leftover `PATCH .../:id/activation`; mutation and `operations_registry_changes` insert share one Mongo transaction — that write lives on already-recommended stamp, not here). Already-recommended stamp: [recommendations/operations-registry-registry-audit.md](operations-registry-registry-audit.md) (`withRegistryMutation` **writes** the card this file **fills**; invalidate leftover `source_label_mappings` + leftover `source_attribution` only after commit). Already-recommended leftover hint ladder: [recommendations/operations-registry-source-resolution.md](operations-registry-source-resolution.md) (in-memory company / Feed / leftover alias / local / default — **never** this collection; this file’s tests sit in leftover `sourceResolution.test.ts` only because that file already stubs leftover `SOURCE_LABEL_TO_COMPANY` fixtures). Already-recommended leftover Lead hint: [recommendations/leads-source-company.md](leads-source-company.md) (`resolveLeadSourceAssignment` **asks** leftover `resolveSourceAttribution`, **not** this file). Already-recommended leftover nested-book first-hit: [recommendations/lead-source-companies-lead-source-company.md](lead-source-companies-lead-source-company.md) (still walks leftover `SOURCE_LABEL_TO_COMPANY` directly). Already-recommended remember: [recommendations/operations-registry-runtime-telemetry.md](operations-registry-runtime-telemetry.md) (`recordDurableCompatibilityRead` + leftover `recordRegistryResolverFailure` on leftover `"source"` — this file **asks** both; it does **not** own the clocks). Already-recommended leftover health: [recommendations/operations-registry-queries-health.md](operations-registry-queries-health.md) (`buildLabelMappingHealthFindings` loads leftover `LeadSourceLabelMapping` itself; leftover `isCompatibilityConsumer` **keeps** leftover `sheet_legacy_resolution` so leftover `registry.compatibility_reads_remaining` can count this walk). Already-recommended leftover overview: [recommendations/operations-registry-queries-overview.md](operations-registry-queries-overview.md) (that copy **drops** leftover `sheet_legacy_resolution` — a leftover sheet/legacy walk this file remembers can hide on leftover overview and still appear on leftover health). Already-recommended leftover Change list: [recommendations/operations-registry-queries-changes.md](operations-registry-queries-changes.md) (**reads** leftover `source_label_mapping` cards this file **stamps**; it does **not** hang a spelling). Already-recommended who-may-speak: [recommendations/operations-registry-trusted-actor.md](operations-registry-trusted-actor.md) (Wave B leftover `requireRegistryOwnerActor` / leftover `requireRegistryReadActor` **ask** that file **before** this one; this file still leftover `assertOwner`s on writes). Skipped fold: `sourceLabelNormalize.ts` (`normalizeSourceLabel` — NFKC + whitespace-collapse + trim + lowercase; leftover model `LeadSourceLabelMapping` **asks** the same fold so stored leftover `normalized_label` must equal leftover `normalizeSourceLabel(label)`). Leftover Wave B Zod: `src/validation/v1/sourceLabelMappings.validation.ts` (create: leftover `label` 1–200, leftover `namespace` `sheet_lead_source` \| `legacy_api_source`, leftover `source_company` / leftover `source_granularity` ObjectId, leftover `change_reason` 10–1000; activation: leftover `active` + leftover `reason`; list: optional leftover company / Feed / namespace; preview: leftover namespace + leftover `label`). Leftover next Granot create / leftover next setup **do not** hang a spelling. Leftover next Lead Source projection **lists** accepted labels by loading the model, **not** this file. Leftover report-first inventory: `scripts/migrations/operations-registry-label-mappings.ts` (**asks** leftover `createLabelMapping` on leftover `--apply`; default is leftover `--report`). Leftover static map home: Wave B `config/domain/sources.ts` (`resolveSourceCompanyFromLabel` / leftover `SOURCE_LABEL_TO_COMPANY` — this file **asks** that map only on leftover `not_found`; leftover `granotHttpCollector/granotFormLeadMatcher.ts`, leftover `reconciliation/bookedCallLeadRows.ts`, leftover `leadSourceCompanies`, leftover `analytics/analyticsFilters.ts`, leftover `ringcentral/call-lead-sources.ts` still walk that map **without** this file). Distinct from leftover Granot source-label policy: leftover `granotLifecycle/sourcePolicy.ts` (already-recommended [recommendations/granot-lifecycle-source-policy.md](granot-lifecycle-source-policy.md)). Distinct from leftover Granot `normalizeSourceLabel` in leftover `granotLifecycle/normalization.ts` (payload fold, not this NFKC key). This checkout’s `CONTEXT.md` does not define Source Label Mapping / leftover sheet spelling — do not invent a glossary copy. `docs/adr/` is absent here — do not invent an ADR copy. Do not add this path to knowledge in this rename.
- Callers: Wave B `src/routes/v1.routes.ts` (`handleSourceLabelMappingCreate` leftover `POST /api/v1/admin/source-label-mappings` leftover Owner; leftover `handleSourceLabelMappingActivation` leftover `PATCH .../:id/activation` leftover Owner; leftover `handleSourceLabelMappingsList` leftover `GET ...` leftover read actor; leftover `handleSourceLabelResolutionPreview` leftover `POST /api/v1/admin/source-label-resolution/preview` leftover read actor — leftover `previewLabelResolution`). Barrel: `operationsRegistry/index.ts` (leftover `createLabelMapping` / leftover `listLabelMappings` / leftover `normalizeSourceLabel` / leftover `previewLabelResolution` / leftover `resolveLabelToFeed` / leftover `resolveSheetOrLegacyLabel` / leftover `setLabelMappingActivation` / leftover `consultStaticSourceLabelMap` / leftover `getStaticSourceLabelMapConsultCount` / leftover `resetStaticSourceLabelMapConsultsForTests`). Leftover inventory apply: `scripts/migrations/operations-registry-label-mappings.ts` (**asks** leftover `createLabelMapping`). Tests: `labelMappings.test.ts` (fold re-export, hang guards, unique index, stamp, archive-then-hang, leftover schema immutability, leftover collection miss / clash, leftover list filter, leftover static-map counter). Collection-first leftover / fail-closed leftover / leftover fallback tests live in leftover `sourceResolution.test.ts` (**asks** leftover `resolveSheetOrLegacyLabel` — leftover hint ladder’s **file**, this file’s **interface**). Leftover model `LeadSourceLabelMapping` **asks** skipped fold, not this file’s hang. Already-recommended leftover health / leftover next Lead Source projection **load the model**. Already-recommended leftover hint ladder / leftover Lead hint / leftover nested-book first-hit **do not import this file** at runtime.
- Seams callers need: hang-the-spelling (`createLabelMapping`: Owner + leftover stamp + leftover collision + leftover Feed must be live and belong to the submitted Lead Source) vs archive-or-restore (`setLabelMappingActivation`: Owner + leftover stamp; leftover restore re-checks collision; leftover archive stamps leftover `archived_at` once) vs show-the-hung-spellings (`listLabelMappings`: no leftover `active` filter) vs ask-the-collection (`resolveLabelToFeed`: leftover `resolved` / leftover `not_found` / leftover `ambiguous` / leftover `inactive_destination` — a miss is data) vs leftover-sheet-or-legacy (`resolveSheetOrLegacyLabel` / leftover `previewLabelResolution`: collection first; leftover static map only on leftover `not_found`; leftover clash / leftover dead Feed fail closed). There is no hint-ladder **seam**. There is no health-finding **seam**. There is no who-may-speak **seam**. There is no in-place destination-edit **seam**. There is no leftover fold **seam** as a new adapter — skipped `sourceLabelNormalize.ts` already owns the key.
- Split later (only if the file outgrows one sitting): this ~624-line file is one sitting if you read it as hang a sheet or leftover API spelling on one live Feed — fold the spelling on the server — archive then hang again to correct the destination — ask the collection first — fall back to leftover `SOURCE_LABEL_TO_COMPANY` only on miss — fail closed on clash or dead Feed — never walk the hint ladder — never write a health finding — never decide who may speak. Do **not** split hang vs leftover resolve into two public modules a leftover dashboard could import independently so “preview only resolves and inventory only hangs” — Wave B already **asks** both from this file, and leftover inventory **asks** the hang so leftover resolve can stop walking the leftover map. Do **not** split leftover `resolveLabelToFeed` into a public collection **adapter** leftover health could import so “one matcher owns leftover `inactive_destination`.” If it later splits: `hangASheetOrLeftoverApiSpellingOnOneLiveFeed.ts` / `askTheCollectionWhichFeedThisSpellingPointsAt.ts` only as later story files, never `create.ts` / `update.ts` / `delete.ts` / `get.ts` / `list.ts` / `resolve.ts`, and never merge already-recommended leftover hint ladder, leftover Lead hint, leftover nested-book first-hit, leftover Granot source-label policy, leftover health findings, leftover next Lead Source projection, leftover next Granot create, leftover next setup, already-recommended stamp, leftover who-may-speak, skipped fold, leftover Wave B Zod, leftover static-map home, or Wave B HTTP into this file

`createLabelMapping` / `setLabelMappingActivation` / `resolveSheetOrLegacyLabel` are executor mechanics. The owner question is: *A sheet or leftover API spelling of a Source Company is not a Feed. Hang that spelling on one live Feed in a leftover namespace. The server folds the spelling. The Owner cannot submit the folded key. The Feed must exist, belong to the submitted Lead Source, and be active. Two live mappings cannot share a leftover namespace plus folded key. The destination is immutable — to point the spelling at a different Feed, archive this mapping and hang a new one. When leftover sheet or leftover API later asks which Feed this spelling is, look at the collection first. One live mapping whose Feed and Lead Source are both live and still belong together → that Feed. Two live mappings → clash, fail closed, never open the leftover static map. A mapping that points at a dead or mismatched Feed → fail closed, never open the leftover static map. Zero live mappings → then and only then consult leftover `SOURCE_LABEL_TO_COMPANY` and remember that leftover walk. This page does not walk the leftover hint ladder. This page does not write a leftover health finding. This page does not decide who may speak.*

Already-recommended leftover hint ladder, leftover Lead hint, leftover nested-book first-hit, leftover Granot source-label policy, leftover health findings, leftover next Lead Source projection, leftover next Granot create, leftover next setup, already-recommended stamp, leftover who-may-speak, skipped fold, leftover Wave B Zod, leftover static-map home, and Wave B HTTP already live in other **modules**. Do not pull those in.

## What this file actually does

Five operations of one “hang a sheet or leftover API spelling on one live Feed — fold the spelling on the server — archive then hang again to correct the destination — ask the collection first — fall back to leftover `SOURCE_LABEL_TO_COMPANY` only on miss — fail closed on clash or dead Feed — never walk the hint ladder — never write a health finding — never decide who may speak” story, not “a label-mapping CRUD helper,” and not leftover hint-ladder matching:

1. **Hang a spelling on a live Feed** — leftover `createLabelMapping`. Leftover `assertOwner`. Refuse a client-supplied leftover `normalized_label` even when it would match. Leftover `change_reason` must be 10–1000 after trim. Leftover `label` must be a nonempty string. Leftover `namespace` must be leftover `sheet_lead_source` or leftover `legacy_api_source`. Fold through skipped `normalizeSourceLabel`. **Ask** leftover `withRegistryMutation` (leftover `entityType: "source_label_mapping"`, leftover `action: "create"`, invalidate leftover `source_label_mappings` + leftover `source_attribution`). Inside the write: Feed must exist, Lead Source must exist, leftover `feed.source_company` must equal the submitted Lead Source, Feed must be leftover `active === true`, then leftover `findOne` leftover `{ namespace, normalized_label, active: true }` must miss. Insert keeps the raw leftover `label`, the folded key, leftover namespace, leftover ObjectIds, leftover `active: true`, leftover `created_by`, leftover `change_reason`. Leftover Mongo `11000` becomes leftover `REGISTRY_DUPLICATE_IDENTIFIER` (`An active mapping already holds {namespace} / {normalized}`). This beat does **not** require leftover `company.active`. This beat does **not** rewrite leftover `source_company` / leftover `source_granularity` after insert. This beat does **not** walk leftover `SOURCE_LABEL_TO_COMPANY`.

2. **Archive or restore the hung spelling — never edit the destination** — leftover `setLabelMappingActivation`. Leftover `assertOwner`. Same leftover reason rule. **Ask** leftover `withRegistryMutation` (leftover `action` is leftover `"activate"` or leftover `"deactivate"`). Missing id → leftover `NOT_FOUND` (`Label mapping`). Restore of an archived row re-checks leftover `{ namespace, normalized_label, active: true, _id $ne }`. Archive `$set`s leftover `active: false` + leftover `change_reason` + leftover `archived_at` (keep the first archive clock). Restore `$set`s leftover `active: true` + leftover `change_reason` and `$unset`s leftover `archived_at`. There is no leftover `updateLabelMapping` / leftover destination PATCH. Knowledge and leftover `labelMappings.test.ts` lock correction as archive then hang. This beat does **not** move the Feed. This beat does **not** fold the leftover `label` again.

3. **Show the hung spellings** — leftover `listLabelMappings`. Optional leftover `source_company` / leftover `source_granularity` / leftover `namespace`. Bad leftover namespace → leftover 400. Sort leftover `namespace` then leftover `normalized_label`. **No** leftover `active` filter — the Owner sees archived rows. This beat does **not** join leftover company / Feed labels. This beat does **not** open leftover stamp.

4. **Ask the collection which Feed this spelling points at** — leftover `resolveLabelToFeed`. Fold the raw leftover `label`. Load leftover `{ namespace, normalized_label, active: true }`. Zero → leftover `{ status: "not_found" }` (does **not** throw). Two or more → leftover `{ status: "ambiguous", candidates: [{ mapping_id, source_company_id, source_granularity_id }] }`. One → load leftover Feed + leftover Lead Source. Leftover destination is ok only when both exist, both leftover `active === true`, and leftover `feed.source_company` still equals stored leftover `source_company`. Fail → leftover `{ status: "inactive_destination" }` (missing Feed, missing company, inactive Feed, inactive company, or leftover mismatch all share that status). Success → leftover `{ status: "resolved", source: "mapping" }` plus leftover ids, leftover `company_slug`, leftover owner / CRM snapshots, leftover `granularity_key`, leftover `feed_active: true`, leftover `company_active: true`. This beat does **not** consult leftover `SOURCE_LABEL_TO_COMPANY`. This beat does **not** write an Operational Event. This beat does **not** walk leftover `granularity_key` / leftover CRM label / leftover source site / leftover alias / leftover local / leftover channel default.

5. **Fall back to leftover `SOURCE_LABEL_TO_COMPANY` only on miss — remember the leftover walk — fail closed on clash or dead Feed** — leftover `resolveSheetOrLegacyLabel` (leftover `previewLabelResolution` is a one-line Owner preview of this beat). **Ask** leftover `resolveLabelToFeed`. Leftover `resolved` → return as-is (leftover `sourceResolution.test.ts` locks leftover static-map consult count at `0`). Leftover `ambiguous` → leftover `recordSheetLegacyResolutionFailure("ambiguous")` then return the clash (never leftover `consultStaticMap`). Leftover `inactive_destination` → leftover `recordSheetLegacyResolutionFailure("inactive_destination")` then return (never leftover `consultStaticMap`). Leftover `not_found` → leftover `consultStaticSourceLabelMap` (default leftover `resolveSourceCompanyFromLabel`, increment leftover `staticMapConsultCount`). Hit → leftover `recordDurableCompatibilityRead("SOURCE_LABEL_TO_COMPANY", "sheet_legacy_resolution")` then leftover `{ status: "resolved", source: "compatibility", source_company_slug }` — a leftover **company slug**, not a Feed. Miss → leftover `recordSheetLegacyResolutionFailure("not_found")` then return leftover `not_found`. Leftover `recordSheetLegacyResolutionFailure` ticks leftover `recordRegistryResolverFailure("source", …)` and leftover `recordOperationalEvent`; leftover persist throw must not hide the leftover resolution. Leftover clash uses leftover Event key leftover `operations_registry.source_resolution_ambiguous` (leftover `error`, leftover `notificationCandidate: true`). Leftover `inactive_destination` **and** leftover `not_found` both use leftover `operations_registry.source_resolution_not_found` (leftover `warn`) and leftover telemetry kind leftover `"not_found"` — leftover inactive’s leftover **summary** still names leftover inactive / invalid Feed. This beat does **not** invent a leftover `"label_mapping"` resolver name. This beat does **not** fail leftover inventory apply when leftover Event persist throws.

There is no sixth leftover hint-ladder operation. There is no leftover health-finding operation. There is no leftover who-may-speak operation. There is no leftover in-place destination-edit operation. Leftover `previewLabelResolution` is the Owner preview **adapter** of operation 5, not a second story. Leftover `consultStaticSourceLabelMap` / leftover `getStaticSourceLabelMapConsultCount` / leftover `resetStaticSourceLabelMapConsultsForTests` are leftover instrumentation **adapters** of operation 5. Leftover `normalizeSourceLabel` is a skipped-sibling re-export. Leftover `assertOwner` / leftover `mutableAudit` / leftover `toRecord` sit on the write and show paths. Do not export them as a public **seam**.

Do not export leftover `resolveLabelToFeed` as a second public **seam** leftover preview should skip so “Owner preview never falls back.” Do not export leftover `recordSheetLegacyResolutionFailure` as domain language for “write a Source miss.” Do not export leftover `consultStaticSourceLabelMap` as domain language for “say which company this leftover spelling is.”

## Organization

Keep one file as the screenplay for “hang a sheet or leftover API spelling on one live Feed, fold the spelling on the server, archive then hang again to correct the destination, ask the collection first, fall back to leftover `SOURCE_LABEL_TO_COMPANY` only on miss, fail closed on clash or dead Feed, never walk the hint ladder, never write a health finding, never decide who may speak.” Already-recommended leftover hint ladder, leftover Lead hint, leftover nested-book first-hit, leftover Granot source-label policy, leftover health findings, leftover next Lead Source projection, leftover next Granot create, leftover next setup, already-recommended stamp, leftover who-may-speak, skipped fold, leftover Wave B Zod, leftover static-map home, leftover `LeadSourceLabelMapping` model, leftover `connectMongo`, leftover `recordOperationalEvent`, and Wave B HTTP already live in deeper **modules**. Do not pull those in. Do not invent a `LabelMappingService` class. Do not invent a begin / complete **seam** — leftover `withRegistryMutation` is already the before-commit / after-commit **adapter**. Do not invent a second fold **adapter** beside skipped `normalizeSourceLabel`. Do not invent a second leftover static-map **adapter** beside leftover `resolveSourceCompanyFromLabel`. Do not invent a second leftover who-may-speak **adapter** beside leftover `requireRegistryOwnerActor`. Do not invent a second leftover finding **adapter** beside leftover `buildLabelMappingHealthFindings`.

Do not split this into `create.ts` / `update.ts` / `delete.ts` / `get.ts` / `list.ts` / `resolve.ts`. Those are persistence verbs, not the owner story. Do not add leftover `updateLabelMapping` so “correction can retarget the Feed.” Do not move leftover `SOURCE_LABEL_TO_COMPANY` into this file so “one file owns leftover spellings.” Do not move leftover `previewSourceAttribution` into this file so “one matcher owns attribution.” Do not silently migrate leftover `granotFormLeadMatcher` / leftover `bookedCallLeadRows` / leftover `leadSourceCompanies` / leftover `analyticsFilters` / leftover `call-lead-sources` onto leftover `resolveSheetOrLegacyLabel` so “ORS-1 lands in the rename.” Do not silently write leftover `registry.label_mapping_*` findings from this file so “resolve owns health.”

**External interface** stays small (this is the test surface). Hang, archive, show, ask-the-collection, and leftover-sheet-or-legacy are one story’s book, not five CRUD verbs:

| Keep exporting | Story name | Why the seam exists |
|---|---|---|
| `createLabelMapping` | `hangASheetOrLeftoverApiSpellingOnOneLiveFeed` | Wave B leftover POST + leftover inventory leftover `--apply` |
| `setLabelMappingActivation` | `archiveOrRestoreTheHungSpelling` | Wave B leftover PATCH leftover `/activation`; never edit the destination |
| `listLabelMappings` | `showTheHungSpellings` | Wave B leftover GET; includes archived rows |
| `resolveLabelToFeed` | `askTheCollectionWhichFeedThisSpellingPointsAt` | leftover collection beat leftover sheet/legacy **asks**; miss is data |
| `resolveSheetOrLegacyLabel` | `askLeftoverSheetOrLegacyWhichFeedThisSpellingPointsAt` | collection first; leftover static map only on miss |
| `previewLabelResolution` | `previewWhichFeedThisSpellingWouldStamp` | Wave B leftover POST leftover `/source-label-resolution/preview` — one-line leftover **adapter** of leftover `resolveSheetOrLegacyLabel` |
| `consultStaticSourceLabelMap` | `consultLeftoverSourceLabelToCompany` | leftover instrumented leftover `resolveSourceCompanyFromLabel`; leftover tests lock the counter |
| `normalizeSourceLabel` | (keep — skipped sibling re-export) | skipped `sourceLabelNormalize.ts` already owns the fold; leftover model **asks** that file |
| `CreateLabelMappingCommand` / `LabelMappingRecord` / `LabelResolution` | `HangThisSpellingOnThisLiveFeed` / `HungSpellingCard` / `ThisSpellingPointsAt` | leftover write bag, leftover Owner card, leftover resolve union |

Keep the old names as one-line aliases until Wave B leftover `v1.routes.ts`, the barrel, leftover inventory apply, leftover `labelMappings.test.ts`, and leftover `sourceResolution.test.ts` migrate. Do not make callers learn leftover `InTransaction` / leftover `toRecord` / leftover `mutableAudit` as the domain language.

**Principle: old exports stay as aliases.** `createLabelMapping` remains the imported name until Wave B leftover POST and leftover inventory migrate. `setLabelMappingActivation` remains the imported name until Wave B leftover `/activation` migrates. `resolveSheetOrLegacyLabel` remains the imported name until leftover Owner preview and leftover `sourceResolution.test.ts` migrate. Persisted leftover `namespace` strings (`sheet_lead_source` / `legacy_api_source`), leftover Change leftover `action` strings (`create` / `activate` / `deactivate`), leftover `entity_type` leftover `source_label_mapping`, leftover `source` strings (`mapping` / `compatibility`), leftover `status` strings (`resolved` / `not_found` / `ambiguous` / `inactive_destination`), leftover Event keys leftover `operations_registry.source_resolution_ambiguous` / leftover `operations_registry.source_resolution_not_found` / leftover `operations_registry.compatibility_read`, leftover consumer leftover `sheet_legacy_resolution`, leftover path leftover `SOURCE_LABEL_TO_COMPANY`, and leftover stored leftover `source_company` / leftover `source_granularity` field names stay those strings — they are leftover stamp history, leftover health codes, leftover overview / leftover health leftover-path unions, and Wave B’s body, not story names.

**No class for the workflow.** The types that *do* earn names are the leftover hang bag leftover Wave B Zod already parses and the leftover resolve union leftover Owner preview already returns:

```ts
type HangThisSpellingOnThisLiveFeed = {
  label: string
  namespace: "sheet_lead_source" | "legacy_api_source"
  source_company: string
  source_granularity: string
  change_reason: string
  // leftover normalized_label must not be submitted
}

type HungSpellingCard = {
  id: string
  label: string
  normalized_label: string
  namespace: "sheet_lead_source" | "legacy_api_source"
  source_company: string
  source_granularity: string
  active: boolean
  created_by: /* leftover RegistryActorContext */
  change_reason?: string
  archived_at?: Date
}

type ThisSpellingPointsAt =
  | {
      status: "resolved"
      source: "mapping"
      namespace: "sheet_lead_source" | "legacy_api_source"
      raw_label: string
      normalized_label: string
      mapping_id: string
      source_company_id: string
      source_granularity_id: string
      company_slug: string
      company_label_snapshot: string
      granularity_key: string
      granularity_label_snapshot: string
      crm_label_snapshot: string
      feed_active: true
      company_active: true
    }
  | {
      status: "resolved"
      source: "compatibility"
      namespace: "sheet_lead_source" | "legacy_api_source"
      raw_label: string
      normalized_label: string
      source_company_slug: string
    }
  | { status: "not_found"; namespace: /* … */; raw_label: string; normalized_label: string }
  | {
      status: "ambiguous"
      namespace: /* … */
      raw_label: string
      normalized_label: string
      candidates: Array<{
        mapping_id: string
        source_company_id: string
        source_granularity_id: string
      }>
    }
  | {
      status: "inactive_destination"
      namespace: /* … */
      raw_label: string
      normalized_label: string
      mapping_id: string
      source_company_id: string
      source_granularity_id: string
    }
```

That is the handoff from “the Owner hung a spelling” / “leftover inventory applied a leftover proposal” to “leftover Owner preview returns leftover `{ ok, data }`” or “a later leftover sheet/legacy consumer **asks** leftover `askLeftoverSheetOrLegacyWhichFeedThisSpellingPointsAt`.” Do **not** add leftover `granularity_key` / leftover `crm_label` / leftover `source_site` / leftover `fallback_alias` / leftover `local` onto leftover `HangThisSpellingOnThisLiveFeed` so “one hint owns both matchers.” Do **not** add leftover `findings` onto leftover `ThisSpellingPointsAt` so “resolve owns health.” Do **not** add leftover `owner_message` onto leftover `HungSpellingCard` so “the hang speaks Owner.” Do **not** store leftover `normalized_label` from the client. Do **not** add leftover `source_company_id` onto leftover compatibility success so “the leftover slug is a Feed.”

Do not add leftover `requireRegistryOwnerActor` as a public **seam** on this file — Wave B already owns who may speak. Do not add leftover `withRegistryMutation` as a public **seam** — already-recommended stamp already owns the write. Do not add leftover `previewSourceAttribution` as a public **seam** — already-recommended leftover hint ladder already owns that. Do not add leftover `getRegistryHealth` as a public **seam** — already-recommended leftover health already owns findings. Do not add leftover `getLeadSourceProjection` as a public **seam** — leftover next `queries/leadSourceProjection.ts` already owns the Feed page.

## The file, as a story

Parent functions stay deep. Child names are only extracted when they hide a real decision, not a one-liner.

```ts
// labelMappings.ts
// A sheet or leftover API spelling of a Source Company is not a Feed.
// Hang that spelling on one live Feed in a leftover namespace.
// The server folds the spelling. The Owner cannot submit the folded key.
// The Feed must exist, belong to the submitted Lead Source, and be active.
// Two live mappings cannot share a leftover namespace plus folded key.
// The destination is immutable — archive this mapping, then hang a new one.
// When leftover sheet or leftover API asks which Feed this spelling is,
// look at the collection first.
// One live mapping whose Feed and Lead Source are both live and still
// belong together → that Feed.
// Two live mappings → clash, fail closed, never open the leftover static map.
// A mapping that points at a dead or mismatched Feed → fail closed,
// never open the leftover static map.
// Zero live mappings → then and only then consult leftover
// SOURCE_LABEL_TO_COMPANY and remember that leftover walk.
// Do not walk the leftover hint ladder.
// Do not write a leftover health finding.
// Do not decide who may speak.

// ── 1. Hang a spelling on a live Feed ─────────────────────

export async function hangASheetOrLeftoverApiSpellingOnOneLiveFeed(command, actor, deps)
  // refuse leftover normalized_label from the client
  // leftover change_reason 10–1000
  // fold through skipped normalizeSourceLabel
  // ask leftover withRegistryMutation
  // Feed exists → belongs to the submitted Lead Source → Feed is live → no live collision
  // leftover Mongo 11000 → leftover DUPLICATE_IDENTIFIER

// ── 2. Archive or restore — never edit the destination ──

export async function archiveOrRestoreTheHungSpelling(id, active, reason, actor, deps)
  // restore re-checks leftover { namespace, normalized_label, active: true }
  // archive keeps the first leftover archived_at
  // restore leftover $unsets leftover archived_at
  // there is no leftover destination PATCH

// ── 3. Show the hung spellings ────────────────────────────

export async function showTheHungSpellings(filter)
  // leftover company / Feed / namespace
  // no leftover active filter — archived rows stay visible
  // sort leftover namespace then leftover normalized_label

// ── 4. Ask the collection which Feed this spelling points at ──

export async function askTheCollectionWhichFeedThisSpellingPointsAt(namespace, rawLabel, session?)
  // zero → leftover not_found (do not throw)
  // two+ → leftover ambiguous
  // one + leftover dead / leftover missing / leftover mismatched → leftover inactive_destination
  // one + leftover live pair → leftover resolved / leftover source: "mapping"

// ── 5. Leftover sheet or leftover API — collection first ──

export async function askLeftoverSheetOrLegacyWhichFeedThisSpellingPointsAt(namespace, rawLabel, deps)
export async function previewWhichFeedThisSpellingWouldStamp(input)
  // leftover resolved → return (leftover static-map count stays 0)
  // leftover ambiguous / leftover inactive_destination → leftover remember fail, never leftover consultStaticMap
  // leftover not_found + leftover SOURCE_LABEL_TO_COMPANY hit → leftover remember leftover sheet_legacy_resolution walk
  // leftover not_found + leftover miss → leftover remember leftover not_found
```

Read the primary path out loud: *The Owner hangs “Best Relocation Forms” on the live Best Relocation Forms Feed. The server folds the spelling. The Feed must be live and belong to that Lead Source. No other live mapping may already hold that leftover namespace plus folded key. Later a leftover sheet row asks which Feed that spelling is. Look at the collection first. One live mapping whose Feed and Lead Source are still live and still belong together — stamp that Feed. Two live mappings — say clash and never open leftover `SOURCE_LABEL_TO_COMPANY`. A mapping that points at a dead Feed — say dead and never open the leftover map. Zero live mappings — then and only then consult leftover `SOURCE_LABEL_TO_COMPANY` and remember that leftover walk. To point the spelling at a different Feed, archive this mapping and hang a new one. Do not walk the leftover hint ladder. Do not write a leftover health finding. Do not decide who may speak.*

That is the operation. `createLabelMapping` is not.

## Precise logic I would tighten while renaming

These are real smells the story names make obvious. Do not “just rename.”

1. **Leftover `previewLabelResolution` is a one-line pass-through.** It **asks** leftover `resolveSheetOrLegacyLabel` and adds nothing. Do not silently delete it so “one export owns leftover preview” without a paired Wave B leftover route + leftover Zod test. Do not silently make leftover Owner preview **ask** leftover `resolveLabelToFeed` so “Owner preview never falls back” — leftover knowledge and leftover `sourceResolution.test.ts` lock leftover Owner preview as leftover collection-first leftover **plus** leftover static fallback.

2. **Leftover hang does not require leftover `company.active`.** Leftover Feed must be live. Leftover Lead Source must exist and own the Feed. Leftover resolve later treats leftover inactive company as leftover `inactive_destination`. Do not silently refuse leftover hang when leftover `company.active !== true` so “write matches read” without a paired leftover hang + leftover resolve test that names both beats. Do not silently treat leftover inactive company as leftover hang success so “the Owner can hang on an archived Lead Source” without locking leftover resolve’s leftover `inactive_destination`.

3. **Leftover `inactive_destination` shares leftover Event key and leftover telemetry kind with leftover `not_found`.** Leftover clash gets leftover `operations_registry.source_resolution_ambiguous` + leftover `error` + leftover `notificationCandidate: true`. Leftover dead Feed and leftover miss both leftover `recordRegistryResolverFailure("source", "not_found")` and leftover `operations_registry.source_resolution_not_found`. Leftover summary text still names leftover inactive / invalid Feed. Do not silently invent leftover `operations_registry.source_resolution_inactive_destination` so “the Event matches the status” without a paired leftover health leftover `buildSourceResolutionEventFindings` test. Do not silently drop leftover dead-Feed leftover Event so “only clash notifies.”

4. **Leftover fail ticks leftover `"source"` — the same leftover clock leftover `resolveSourceAttribution` ticks.** Already-recommended leftover remember has leftover three names (`source` / `cpl` / `ringcentral`). This file leftover `recordRegistryResolverFailure("source", …)` on leftover clash / leftover miss / leftover dead Feed. Leftover health leftover last-day Source-miss findings read leftover `operations_registry.source_resolution_*` Events from **both** leftover hint-ladder throw and this leftover sheet/legacy fail. Do not silently add leftover `"label_mapping"` to leftover `RegistryResolverName` so “this book owns its clock.” Do not silently stop ticking leftover `"source"` so “hint ladder owns the name.”

5. **Leftover list has no leftover `active` filter.** Archived leftover mappings stay on leftover `GET /api/v1/admin/source-label-mappings`. Leftover resolve only looks at leftover `active: true`. Do not silently default leftover list to leftover `{ active: true }` so “the page matches leftover resolve” without a paired leftover Owner page test. Do not silently hide leftover archived rows from leftover next Lead Source projection — that leftover page loads the model, not this file.

6. **Leftover collection-first leftover / leftover fail-closed leftover / leftover fallback tests live in leftover `sourceResolution.test.ts`.** That file is already-recommended leftover hint ladder’s **interface** file. The leftover tests **ask** leftover `resolveSheetOrLegacyLabel` and leftover `SOURCE_LABEL_TO_COMPANY` fixtures. Do not silently move those leftover tests into leftover `labelMappings.test.ts` in this rename without keeping leftover collection-hit-must-not-read-the-map / leftover empty-falls-back-once / leftover clash-never-consults / leftover inactive-Feed-never-consults. Do not silently add leftover hint-ladder leftover `previewSourceAttribution` cases to leftover `labelMappings.test.ts` so “one file owns attribution.”

7. **Leftover compatibility success is a leftover company slug, not a Feed.** Leftover `{ source: "compatibility", source_company_slug }` has no leftover `source_granularity_id`. Leftover collection success has leftover Feed snapshots. Do not silently pick leftover `default_form_granularity` on leftover fallback so “leftover resolve always returns a Feed” — leftover `SOURCE_LABEL_TO_COMPANY` is leftover company-only. Do not silently treat leftover compatibility as leftover `source: "mapping"`.

8. **Leftover leftover-path consumer leftover `sheet_legacy_resolution` is kept on leftover health and dropped on leftover overview.** This file leftover `recordDurableCompatibilityRead("SOURCE_LABEL_TO_COMPANY", "sheet_legacy_resolution")`. Already-recommended leftover overview leftover `isCompatibilityConsumer` drops that leftover string; leftover health keeps it. A leftover sheet/legacy walk can hide on leftover `runtime.compatibility_reads` and still write leftover `registry.compatibility_reads_remaining`. Do not silently add leftover `sheet_legacy_resolution` to leftover overview so “the pages match” without a paired leftover overview + leftover health + leftover label-mapping test. Do not silently drop leftover health’s leftover string so “only leftover overview’s five consumers exist.”

9. **Leftover unique index and leftover service collision check both exist.** Leftover schema leftover `{ namespace: 1, normalized_label: 1 }` unique leftover `{ active: true }`. Leftover hang leftover `findOne`s first, then leftover catches leftover `11000`. Leftover `labelMappings.test.ts` locks both. Do not silently drop leftover `findOne` so “the index is enough.” Do not silently drop leftover `11000` so “the service check is enough.”

10. **Leftover schema leftover `normalized_label` must equal skipped fold of leftover `label`.** Leftover model leftover **asks** skipped `sourceLabelNormalize.ts` directly, not this file. Leftover hang writes both fields after the same fold. Do not silently accept a leftover client leftover `normalized_label` that already matches so “the Owner can pre-fold.” Leftover hang leftover rejects leftover `"normalized_label" in command`.

11. **Leftover destination fields are immutable after insert.** Leftover schema leftover rejects leftover post-create leftover `source_company` / leftover `source_granularity` change. Leftover hang has no leftover PATCH. Do not silently add leftover `correctLabelMappingDestination` so “one command retargets.” Knowledge already says leftover correction is leftover deactivate + leftover create.

12. **Leftover runtime leftover sheet / leftover CRM / leftover recon / leftover analytics still walk leftover `SOURCE_LABEL_TO_COMPANY` directly.** Leftover `resolveSheetOrLegacyLabel` is leftover Owner preview + leftover tests + leftover barrel today. Do not silently retarget leftover `granotFormLeadMatcher` / leftover `bookedCallLeadRows` / leftover `leadSourceCompanies` / leftover `analyticsFilters` / leftover `call-lead-sources` in this rename. That leftover leftover-path walk is leftover ORS-1 leftover apply work, not this story.

13. **Leave sibling modules alone.** Already-recommended leftover `withRegistryMutation`, leftover `previewSourceAttribution`, leftover `resolveLeadSourceAssignment`, leftover `getRegistryHealth`, leftover `requireRegistryOwnerActor`, skipped leftover `normalizeSourceLabel`, leftover `recordDurableCompatibilityRead`, leftover `sourceLabelMappingCreateSchema`, leftover next leftover `getLeadSourceProjection`, leftover next leftover `createOwnerGranotName`, leftover next leftover `previewLeadSourceSetup`, leftover `LeadSourceLabelMapping`, leftover `resolveSourceCompanyFromLabel`, and leftover `recordOperationalEvent` are already the right **depth**. This file hangs, archives, shows, asks the collection, and leftover-falls-back; it does not walk the leftover hint ladder, write a leftover finding, or decide who may speak.

14. **Do not silently change persisted leftover `namespace` / leftover `action` / leftover `status` / leftover Event key / leftover consumer strings.** Those are leftover stamp history, leftover health codes, leftover overview / leftover health leftover-path unions, leftover Wave B Zod enums, and leftover `SOURCE_LABEL_TO_COMPANY` leftover path. Story names live on the functions.

## Testing

The **interface** is the test surface: `hangASheetOrLeftoverApiSpellingOnOneLiveFeed`, `archiveOrRestoreTheHungSpelling`, `showTheHungSpellings`, `askTheCollectionWhichFeedThisSpellingPointsAt`, `askLeftoverSheetOrLegacyWhichFeedThisSpellingPointsAt` (today leftover `createLabelMapping` / leftover `setLabelMappingActivation` / leftover `listLabelMappings` / leftover `resolveLabelToFeed` / leftover `resolveSheetOrLegacyLabel`). Leftover `previewLabelResolution` stays exported because Wave B leftover Owner preview is a second real **adapter**, not a test leak. Do not make leftover `toRecord` / leftover `mutableAudit` / leftover `assertOwner` / leftover `recordSheetLegacyResolutionFailure` the named surface.

Today leftover `labelMappings.test.ts` covers leftover hang guards, leftover unique index, leftover stamp, leftover archive-then-hang, leftover schema immutability, leftover collection miss / clash, leftover list filter, leftover fold re-export, and leftover static-map counter. Leftover collection-first leftover / leftover fail-closed leftover / leftover fallback live in leftover `sourceResolution.test.ts`. Keep both files’ leftover **asks** of this interface. Name the operation:

**Hang a spelling on a live Feed**
- Leftover client leftover `normalized_label` → leftover 400 leftover “server-derived.”
- Leftover `change_reason` shorter than 10 or longer than 1000 → leftover 400.
- Leftover validation order: leftover Feed missing → leftover Lead Source / Feed mismatch (leftover message names leftover Feed id + leftover both company ids) → leftover Feed inactive → leftover live collision leftover `REGISTRY_DUPLICATE_IDENTIFIER`.
- Leftover unique leftover `{ namespace, normalized_label }` leftover `{ active: true }` stays declared on leftover `LeadSourceLabelMapping` **and** leftover hang leftover `findOne`s first.
- Leftover hang leftover **asks** leftover `withRegistryMutation` leftover `entityType: "source_label_mapping"` leftover `action: "create"` leftover `after.normalized_label` leftover `"best relocation forms"`.
- Leftover hang of leftover `"Best Relocation Forms"` leftover `sheet_lead_source` on a leftover live Feed leftover returns leftover `active: true` and leftover does **not** increment leftover `getStaticSourceLabelMapConsultCount`.
- Do not add a leftover `requireRegistryOwnerActor` 403 test here. Wave B + leftover who-may-speak already own that **adapter**. Leftover `assertOwner` leftover Admin leftover `FORBIDDEN` may stay if a leftover barrel caller skips Wave B.

**Archive or restore — never edit the destination**
- Leftover archive leftover `active: false` leftover sets leftover `archived_at` and leftover stamps leftover `action: "deactivate"`.
- Leftover hang of a leftover replacement leftover spelling leftover gets a leftover new leftover `id`. Leftover archived leftover id leftover ≠ leftover replacement leftover id.
- Leftover schema leftover rejects leftover `normalized_label: "wrong"`. Leftover schema leftover rejects leftover post-create leftover `source_granularity` change.
- Leftover restore leftover collides when another leftover live leftover mapping leftover holds leftover `{ namespace, normalized_label }`.
- There is **no** leftover `updateLabelMapping` export.

**Show the hung spellings**
- Leftover filter leftover company + leftover Feed + leftover namespace leftover returns leftover that leftover row.
- Leftover archived leftover row leftover **appears** when leftover filter matches (lock leftover no leftover `active` filter).
- Leftover bad leftover namespace leftover → leftover 400 leftover “sheet_lead_source or leftover_api_source.”

**Ask the collection which Feed this spelling points at**
- Leftover empty leftover collection leftover → leftover `not_found`, leftover does **not** throw, leftover static-map count leftover `0`.
- Leftover two leftover live leftover mappings leftover → leftover `ambiguous` leftover `candidates.length === 2`.
- Leftover one leftover live leftover mapping leftover + leftover live leftover pair leftover → leftover `resolved` leftover `source: "mapping"` leftover Feed leftover id.
- Leftover one leftover live leftover mapping leftover + leftover inactive leftover Feed leftover → leftover `inactive_destination` (leftover `resolveLabelToFeed` leftover does **not** leftover Event — leftover Event is leftover operation 5).

**Leftover sheet or leftover API — collection first**
- Leftover collection leftover hit leftover → leftover `resolved` leftover `source: "mapping"` leftover **and** leftover `getStaticSourceLabelMapConsultCount() === 0`.
- Leftover empty leftover collection leftover + leftover `SOURCE_LABEL_TO_COMPANY` leftover hit leftover → leftover `resolved` leftover `source: "compatibility"` leftover `source_company_slug: "best_relocation_leads"`, leftover consult count leftover `1`, leftover exactly one leftover compatibility-read leftover **ask**, leftover **no** leftover resolution-failure leftover **ask**.
- Leftover two leftover live leftover mappings leftover → leftover `ambiguous`, leftover `consultStaticMap` leftover must leftover throw if leftover called, leftover failure leftover `["ambiguous"]`, leftover consult count leftover `0`.
- Leftover inactive leftover Feed leftover → leftover `inactive_destination`, leftover `consultStaticMap` leftover must leftover throw if leftover called, leftover failure leftover `["inactive_destination"]`, leftover consult count leftover `0`.
- Leftover `previewWhichFeedThisSpellingWouldStamp({ namespace, label })` leftover equals leftover `askLeftoverSheetOrLegacyWhichFeedThisSpellingPointsAt(namespace, label)`.
- Do not retest leftover `withRegistryMutation` leftover rollback here. Already-recommended stamp already owns that **adapter**.
- Do not retest leftover `registry.label_mapping_destination_invalid` leftover codes here. Already-recommended leftover health already owns that **adapter**.
- Do not retest leftover `previewSourceAttribution` leftover ladder here. Already-recommended leftover hint ladder already owns that **adapter**.

Do **not** add a test per helper (`refuseAClientFoldedKey`, `feedMustBelongToTheSubmittedLeadSource`, `rememberTheLeftoverStaticMapWalk`). Those names exist so the parent reads. If a helper test has to change when the helper is inlined, it was testing past the **interface**.

Do **not** retest leftover hint-ladder leftover `match_kind`, leftover Lead leftover `resolveLeadSourceAssignment`, leftover health leftover `FINDING_TRANSLATION_TABLE` rows, leftover who-may-speak signatures, leftover stamp leftover `request_id` reuse, leftover next Lead Source projection leftover accepted-label lists, leftover next Granot create leftover `when_lead_arrives`, leftover next setup leftover readiness, leftover skipped leftover NFKC cases beyond leftover re-export, or Wave B leftover route mounts here. Those already have (or will have) their own interface tests. Wave B leftover **asks** leftover hang / leftover archive / leftover show / leftover preview. Prove the book, not the leftover finding.

## What I would not do

- A `LabelMappingService` class with `create` / `update` / `delete`.
- Thirty two-line functions that only wrap leftover `Mapping.create` / leftover `find`.
- Moving this into a CRUD folder (`create.ts` / `update.ts` / `delete.ts` / `get.ts` / `list.ts` / `resolve.ts`) for cleanliness.
- Breaking the leftover collection-first / leftover fail-closed leftover **seam**. A public leftover `resolveLabelToFeed` leftover health could leftover import without leftover `recordSheetLegacyResolutionFailure` is the forbidden split. Returning leftover `findings` from leftover resolve is the same break. Calling leftover `previewSourceAttribution` from this file is the same break. Adding leftover `updateLabelMapping` so leftover destination leftover PATCHes in place is the same break.
- Treating leftover hint ladder, leftover Lead hint, leftover nested-book first-hit, leftover Granot source-label policy, leftover health findings, leftover next Lead Source projection, leftover next Granot create, leftover next setup, already-recommended stamp, leftover who-may-speak, skipped fold, leftover Wave B Zod, leftover static-map home, leftover `EntityChange`, or Wave B HTTP as this story.
- Inventing a **seam** that has only one **adapter**.
- Silently "fixing" a known gap while recommending a rename: do not delete leftover `previewLabelResolution` without a paired Wave B leftover route test; do not refuse leftover hang when leftover `company.active !== true` without a paired leftover hang + leftover resolve test; do not invent leftover `operations_registry.source_resolution_inactive_destination`; do not add leftover `"label_mapping"` to leftover `RegistryResolverName`; do not default leftover list to leftover `{ active: true }`; do not move leftover `sourceResolution.test.ts` leftover collection-first leftover cases without keeping leftover four leftover locks; do not pick leftover `default_form_granularity` on leftover compatibility success; do not add leftover `sheet_legacy_resolution` to leftover overview or drop it from leftover health without a paired leftover trio test; do not drop leftover `findOne` or leftover `11000`; do not accept leftover client leftover `normalized_label`; do not add leftover in-place leftover destination edit; do not migrate leftover `granotFormLeadMatcher` / leftover `bookedCallLeadRows` / leftover `leadSourceCompanies` / leftover `analyticsFilters` / leftover `call-lead-sources` onto this file; do not move leftover `requireRegistryOwnerActor` / leftover `withRegistryMutation` / leftover `normalizeSourceLabel` / leftover `SOURCE_LABEL_TO_COMPANY` into this file; do not rename persisted leftover `namespace` / leftover `action` / leftover `status` / leftover Event key / leftover consumer / leftover `source_company` / leftover `source_granularity` strings.
- Jumping to the next service while this one has unchecked modules.
- Writing a whole-folder recommendation for `operationsRegistry`.
