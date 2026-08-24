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
  at: 2026-08-21T02:20:00Z
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

- `cplSchedule.ts` — authoritative CPL periods + `resolveCpl` / `resolveCplFromPeriods`. Lead writes go through `leads/leadCplResolution.ts`.
- `cplCorrections.ts` — owner correction jobs against stored lead snapshots.
- `catalogRegistry.ts` — Agent/Merchant mutations used by the catalog facade.
- `ringCentralRegistry.ts` / `ringCentralValidation.ts` — inbound-route snapshot used at Call Qualification time.
- HTTP: registry overview/health/changes plus catalog, CPL admin, and RC inbound-route routes in `v1.routes.ts`. Mutations require a signed Owner actor.
- `granotCrmSources.ts` — Owner-only create/update/enable-disable for `GranotCrmSource` lifecycle semantics. Mutation and one `granot_crm_source` `OperationsRegistryChange` share a transaction; policy/list/health cache keys invalidate only after commit. Unreviewed rows stay disabled/deferred/observation-only. Runtime resolution lives in `granotLifecycle/sourcePolicy.ts`, not here.
- `crmSourceOutboundSms.ts` — Owner-only `GranotCrmSource.outbound_sms` command. Enabling requires `lead_created_policy=create_if_missing` and a recorded consent basis. Template or consent-basis changes force the text off. Audit entity type is `granot_crm_source_sms_policy`. Sending is a post-commit Lead Message side effect, not a Registry write. `create_if_missing` does not send texts. Default backfill is `pnpm migration:granot-crm-source-outbound-sms`. Best Relocation enable is `pnpm migration:granot-crm-source-sms-best-relocation`. Paid Overflow create + SMS enable is `pnpm migration:paid-overflow-source`. Applied production posture lives in [`lifecycle-activation-flags-and-source-policies.md`](../../granot-lead-lifecycle/lifecycle-activation-flags-and-source-policies.md).
- Reviewed classification (checked-in manifest): Best Relocation Call/Form and Paid Overflow are `source_scoped_lead` + `create_if_missing`. Main Site Forms/Inbounds, TBM Forms, 10best Inbounds, TBM Forms Prime, TBM Prime Inbounds, and Top10 Forms/Inbounds are `source_scoped_lead` + `link_only` against their existing Source Companies / granularities. Referral is `referral_booking` / `observation_only`. Source label Auto stays deferred. WordPress and RingCentral remain the creators for the `link_only` families; Granot does not mint those Leads. Paid Overflow is created by `pnpm migration:paid-overflow-source` and has no dedicated source sheet.
- `granotCrmSourceProjections.ts` — list/detail enrichments for Admin: dependency labels/status, automation references plus compatibility, and latest safe audit metadata. No receipt/payload/contact fields. Lifecycle-enabled non-deferred rows with matching routes project `available_for_apply: true`.
- `granotAutomationSources.ts` — Owner-only exact `GranotAutomationSource.granot_crm_source` link. Same transaction/audit/cache-after-commit rules; entity type `granot_automation_source`.
- HTTP: `GET/PATCH /api/v1/admin/granot-crm-sources` and `PATCH .../:id/activation`. Reads Owner/Admin; mutations signed Owner. Clients cannot submit `normalized_granot_label` or `create_if_missing`.
- Classification apply is `scripts/migrations/granot-lifecycle-source-registry.ts` (`pnpm migration:granot-lifecycle:sources -- --report|--apply|--verify`). Report is default. Apply requires `--confirm-production=<db>` and separate authorization. `--scope=best_relocation_creation_policy` and `--scope=link_only_automation_sources` are the only scoped modes. Required Source Company / Source Granularity dependencies resolve per reviewed family company slug, not only Best Relocation. Unique normalized-label index apply is refused while collisions exist. Production `vantagemovers` already applied the `link_only_automation_sources` classification through this audited command. // pragma: allowlist secret

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
