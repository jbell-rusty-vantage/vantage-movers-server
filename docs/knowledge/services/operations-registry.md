---
type: Service
title: Operations Registry
description: Owner-managed operational configuration for catalog, sources, CPL, inbound routes, and Granot CRM sources.
tags: [operations-registry, cpl, catalog]
status: draft
stale_after: 2026-11-19
resource: src/services/operationsRegistry/
applies_to:
  - src/services/operationsRegistry/
owners: [team:main-server]
sources:
  - id: primary
    resource: src/services/operationsRegistry/
  - id: glossary
    resource: ../CONTEXT.md
    title: Platform glossary
  - id: adr-0001
    resource: ../docs/adr/0001-mongodb-system-of-record.md
generated:
  by: process:okf-docs-conversion
  at: 2026-09-02T18:00:00Z
---
**Platform glossary:** [`../../../../CONTEXT.md`](../../../../CONTEXT.md)  
**Primary code:** `src/services/operationsRegistry/`  
**Source connection and Owner UI specification:** [`../../operations-registry-source-connections-owner-ui-specification.md`](../../operations-registry-source-connections-owner-ui-specification.md)

# Operations Registry

**System of Record:** production MongoDB `vantagemovers` catalog collections. // pragma: allowlist secret

**Role:** Owner-managed operational configuration with lifecycle rules, deterministic resolution, dependency previews, signed actor authorization, and transactional mutation history.

## Catalog lifecycle

- Agent, Merchant, Source Company, and Source Granularity records are deactivated, never deleted.
- Default lists and automatic matching use active records only. Owner correction workflows may explicitly include inactive records.
- Agent and Merchant renames preserve the prior normalized name as an alias. Existing Booking and Lead snapshots are not rewritten.
- An Owner may set or correct a Granot username on an Agent; usernames remain globally unique. Nested `granot_identity` is authoritative; the legacy flat username remains a temporary fallback. Changing a username resets verification.

## Source attribution

- `company_slug` and `granularity_key` are immutable.
- Exact granularity key, CRM label, and source-site identifiers must resolve uniquely among active records for the requested Lead Channel.
- Fallback aliases use highest priority. Equal-priority ambiguity fails and records an actionable Operational Event.
- Active channel defaults belong to the same active Source Company and point to an active same-channel Source Granularity.
- A current default cannot be deactivated without a same-command replacement or explicit removal of automatic channel use.
- Source Company projection mode defaults to `derived_import`; `direct_write` requires complete workbook metadata and does not itself enable Sheet Sync writes.
- Employee Booking validation and production admin facets read first-class // pragma: allowlist secret
  Source Granularities. Embedded arrays are migration/rollback evidence only.

## CPL, catalog, and RingCentral (same folder)

- `cplSchedule.ts` — authoritative CPL periods + `resolveCpl` / `resolveCplFromPeriods`. Lead writes go through `leads/leadCplResolution.ts`. Owner date-range edits (Feed + From + Through) are planned as `set_range` — pack [`../../lead-costs-owner-editing/README.md`](../../lead-costs-owner-editing/README.md). Do not treat that command as shipped.
- `cplCorrections.ts` — owner correction jobs against stored lead snapshots.
- `catalogRegistry.ts` — Agent/Merchant mutations used by the catalog facade.
- `ringCentralRegistry.ts` / `ringCentralValidation.ts` — inbound-route snapshot used at Call Qualification time. Assignment DTOs include Lead Source / Feed labels (`lead_source_name`, `lead_source_company_slug`, `feed_display_name`). Dependency preview no longer returns `can_deactivate`.
- HTTP: registry overview/health/changes plus catalog, CPL admin, and RC inbound-route routes in `v1.routes.ts`. Mutations require a signed Owner actor.
- `labelMappings.ts` — Owner-only create/activate/deactivate for `lead_source_label_mappings`. Sheet and legacy labels resolve collection-first (`resolveSheetOrLegacyLabel`); `SOURCE_LABEL_TO_COMPANY` is an instrumented fallback that emits `operations_registry.compatibility_read`. Correction is deactivate + create. Audit entity type is `source_label_mapping`. Report-first inventory is `pnpm migrations:operations-registry-label-mappings`. Stored destination fields remain `source_company` / `source_granularity`.
- `ownerLanguageDeck.ts` — Owner-facing DTO leak check. Banned implementation terms (`granularity`, `lifecycle`, `disposition`, `route_key`, `lead_model`, `policy_version`). Database fields stay `source_company` / `source_granularity`. Must match `vantage-admin/lib/operations-registry/ownerLanguageDeck.ts`.
- `ownerGranotNames.ts` — Owner create translation (`OwnerGranotNameCommand`) for `POST /api/v1/admin/granot-crm-sources`. Accepts `when_lead_arrives: create_if_missing`. Inbound `create_if_missing` is the safety net when Call Qualification does not see the call; mapped qualifying calls stay RingCentral-created or adopted. Derives `crm_origin`, `workspace_slug`, and the Lead Source from the Feed; clients cannot submit `normalized_granot_label`. New rows are inactive (`enabled` / `lifecycle_enabled` false). SMS is not written on create. `validateGranotCrmSourceSemantics` wins if translation disagrees.
- `leadSourceSetup.ts` — atomic Owner setup (`POST /api/v1/admin/operations-registry/lead-source-setups` and `/preview`). One transaction: inactive Source Company + Source Granularity + optional Granot name. Returns a readiness plan. Optional Granot name is created inactive with texting unset.
- `queries/leadSourceProjection.ts` — aggregate Owner reads (`GET /api/v1/admin/operations-registry/lead-sources` and `/:id`). Feeds, accepted labels, Granot landings, inbound numbers, CPL readiness, and translated findings. Does not invent stored identifiers.
- `queries/findingTranslation.ts` — every health code `queries/health.ts` can emit has an Owner row. Unknown codes surface as themselves; never dropped.
- `granotCrmSources.ts` — Owner-only create/update/enable-disable for `GranotCrmSource` lifecycle semantics. Mutation and one `granot_crm_source` `OperationsRegistryChange` share a transaction; policy/list/health cache keys invalidate only after commit. Leaving `create_if_missing` turns `outbound_sms.enabled` off in the same `createOrUpdateGranotCrmSource` mutation (`deactivation_reason=lead_created_policy_changed_from_create_if_missing`). Stored `daily_cap` is preserved, not rewritten. Unreviewed rows stay disabled/deferred/observation-only. Runtime resolution lives in `granotLifecycle/sourcePolicy.ts`, not here.
- `crmSourceOutboundSms.ts` — Owner-only `GranotCrmSource.outbound_sms` command. Enabling requires `lead_created_policy=create_if_missing` and a recorded consent basis. Template or consent-basis changes force the text off. Owner command and `OwnerOutboundSmsView` do not include `daily_cap`; the stored field remains and is copied through on write. Audit entity type is `granot_crm_source_sms_policy`. Sending is a post-commit Lead Message side effect, not a Registry write. `create_if_missing` does not send texts. Default backfill is `pnpm migration:granot-crm-source-outbound-sms`. Best Relocation enable is `pnpm migration:granot-crm-source-sms-best-relocation`. Paid Overflow create + SMS enable is `pnpm migration:paid-overflow-source`. Applied production posture lives in [`lifecycle-activation-flags-and-source-policies.md`](../../granot-lead-lifecycle/lifecycle-activation-flags-and-source-policies.md).
- Reviewed classification (checked-in manifest): Best Relocation Call/Form and Paid Overflow are `source_scoped_lead` + `create_if_missing`. Main Site Forms, TBM Forms, TBM Forms Prime, and Top10 Forms stay `source_scoped_lead` + `link_only`. Main Site Inbounds, 10best Inbounds (TBM Call), TBM Prime Inbounds, and Top10 Inbounds are `source_scoped_lead` + `create_if_missing` after the 2026-09-02 Owner command (`pnpm migration:granot-inbound-call-creation-policy`). Referral is `referral_booking` / `observation_only`. Source label Auto stays deferred. `lead_created_policy` stays exactly three values (`link_only` | `create_if_missing` | `observation_only`). There is no fourth value, inbound mint boolean, or ninth gate. `requested_effect` stays `"lead_created"` when creation is eligible. Inbound `create_if_missing` is the safety net when Call Qualification does not see the call; mapped qualifying calls stay RingCentral-created or adopted. Best Relocation Inbounds already had the policy and inherits `priority_updated` create from shipped code. Customer text stays a separate `outbound_sms` command. Paid Overflow is created by `pnpm migration:paid-overflow-source` and has no dedicated source sheet.
- `granotCrmSourceProjections.ts` — list/detail enrichments for Admin: dependency labels/status, automation references plus compatibility, and latest safe audit metadata. No receipt/payload/contact fields. Lifecycle-enabled non-deferred rows with matching routes project `available_for_apply: true`.
- `granotAutomationSources.ts` — Owner-only exact `GranotAutomationSource.granot_crm_source` link. Same transaction/audit/cache-after-commit rules; entity type `granot_automation_source`.
- HTTP: `GET/POST/PATCH /api/v1/admin/granot-crm-sources` and `PATCH .../:id/activation` plus `PATCH .../:id/outbound-sms`. Owner create is `ownerGranotNames` (`when_lead_arrives` may be `create_if_missing`). Reads Owner/Admin; mutations signed Owner. Clients cannot submit `normalized_granot_label`. Aggregate reads: `GET /api/v1/admin/operations-registry/lead-sources` and `/:id`. Atomic setup: `POST /api/v1/admin/operations-registry/lead-source-setups` and `/preview`. Label mappings: `GET/POST /api/v1/admin/source-label-mappings` and `PATCH .../:id/activation`.
- Health (`queries/health.ts`): label-mapping destination/collision findings; Granot destination, route-shape, and normalized-label collision; SMS gate inconsistency (`registry.granot_sms_gate_inconsistent`); stored `daily_cap` > 0 is `registry.granot_sms_daily_cap_configured` (not a working safety control); compatibility reads count against an observation window that started 2026-09-01 (`registry.compatibility_reads_remaining`). Static maps, embedded granularities, indexes, and stored `daily_cap` remain — do not treat §9.8 removals as done.
- Classification apply is `scripts/migrations/granot-lifecycle-source-registry.ts` (`pnpm migration:granot-lifecycle:sources -- --report|--apply|--verify`). Report is default. Apply requires `--confirm-production=<db>` and separate authorization. `--scope=best_relocation_creation_policy` and `--scope=link_only_automation_sources` are the only scoped modes. Required Source Company / Source Granularity dependencies resolve per reviewed family company slug, not only Best Relocation. Unique normalized-label index apply is refused while collisions exist. Production `vantagemovers` already applied the `link_only_automation_sources` classification through this audited command. The later inbound Call `create_if_missing` flip is `pnpm migration:granot-inbound-call-creation-policy`; that scoped source-registry apply refuses to revert those four inbound families. // pragma: allowlist secret

## Authorization and audit

- Approved signed dashboard roles may read. Only a verified Owner may mutate.
- Domain mutation and Registry Change insert commit in one transaction. Cache invalidation runs after commit.
- Registry Changes are authoritative successful mutation history. Operational Events are reserved for failures, ambiguity, drift, and migration outcomes.

## Compatibility and migration

- M2 preserves Agent IDs, flat Granot usernames, and Booking snapshots.
- M3 preserves valid embedded Source Granularity IDs, retains embedded arrays and compatibility default keys, and creates first-class records.
- Inventory and migration scripts are deterministic, redacted, dry-run first, production guarded, and never access historical models or `vantagemovershistorical`. // pragma: allowlist secret
- Every production M2–M5 apply must name the exact reviewed dry-run manifest. // pragma: allowlist secret
  The script version, target database, mapping checksum, and M4 cutover date
  must still match before any write or RingCentral validation begins.

## Related

- [`catalog.md`](./catalog.md) — public catalog facade
- [`form-lead.md`](./form-lead.md) / [`call-lead.md`](./call-lead.md) — lead CPL snapshots
- [`source-policy.md`](../granot-lifecycle/source-policy.md) — runtime semantic read of reviewed Registry policy
- [`operations-registry.mdc`](../../../.cursor/rules/operations-registry.mdc), [`cpl-operations.mdc`](../../../.cursor/rules/cpl-operations.mdc)
