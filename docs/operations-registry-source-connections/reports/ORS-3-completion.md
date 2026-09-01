# ORS-3 completion

Closed 2026-09-01. Branch `operations-registry-source-connections`. No commit, push, or deploy.

Lead Source + Feed + Granot name are one operational connection at Feed granularity. The setup command creates them in one audited transaction, all inactive. The projection answers the four §7.1 header questions in one request so ORS-4 does not assemble joins.

## Files added

- `src/services/operationsRegistry/queries/leadSourceProjection.ts`
- `src/services/operationsRegistry/queries/leadSourceProjection.test.ts`
- `src/services/operationsRegistry/queries/findingTranslation.ts`
- `src/services/operationsRegistry/queries/findingTranslation.test.ts`
- `src/services/operationsRegistry/leadSourceSetup.ts`
- `src/services/operationsRegistry/leadSourceSetup.test.ts`
- `src/services/operationsRegistry/ringCentralRegistry.test.ts`
- `src/validation/v1/leadSourceSetup.validation.ts`
- `src/routes/lead-source-setups.routes.test.ts`
- `docs/operations-registry-source-connections/sessions/ORS-3-process.md`
- `docs/operations-registry-source-connections/reports/ORS-3-completion.md`

## Files changed

- `src/services/operationsRegistry/sourceRegistry.ts` — exported `assertExactIdentifiersAvailable`, `deriveRegistryKey`, `persistNewSourceCompanyInSession`, `persistNewSourceGranularityInSession` (always inactive). Low-level create still uses its own `withRegistryMutation`; setup does not call it.
- `src/services/operationsRegistry/ownerGranotNames.ts` — `assembleOneFeedRoutes`, `assembleOwnerGranotCreateForKnownFeed`, `assertGranotNameAvailable`
- `src/services/operationsRegistry/granotCrmSources.ts` — `persistGranotCrmSourceInSession`; existing create calls it
- `src/services/operationsRegistry/registryAudit.ts` — `withMultiEntityRegistryMutation`
- `src/services/operationsRegistry/ringCentralRegistry.ts` — assignment DTO enrichment via one `$in` per companies and Feeds; `can_deactivate` removed; activate/reassign accept optional audit deps
- `src/services/operationsRegistry/queries/health.ts` — extracted `buildRingCentralHealthFindings` (optional `phone_number`); null-safe validation fields for the projection
- `src/services/operationsRegistry/index.ts` — projection, setup, translation, persist, audit exports
- `src/routes/v1.routes.ts` — contiguous lead-sources + setups block next to overview
- `src/routes/v1.routes.test.ts` — new routes registered
- `src/validation/v1.validation.ts` — re-exports setup/projection schemas
- `docs/operations-registry-source-connections/issues/ORS-3.md` — §4 reverify
- `docs/operations-registry-source-connections/PROGRESS.md`

Did not touch `labelMappings.ts`, Granot semantics, `vantage-admin`, or Paid Overflow's Feed.

## Derivation rules

`company_slug` and `granularity_key` use the same snake-key as existing slugs (`paid_overflow`, `tbm_leads`, `best_relocation_leads`):

1. trim
2. lowercase
3. replace runs of non `[a-z0-9]` with `_`
4. trim leading/trailing `_`
5. reject if empty — never suffix

`granularity_key` is that slug, or `${slug}_${move_type}` when a move type is supplied. Collisions are rejected by name.

Feed display name defaults to **Web forms** or **Inbound calls**. Company `owner_label` defaults to `name`.

## Inactive Feed + one transaction

`createGranotNameFromOwnerIntent` was not called. It `loadActiveFeed`s. Setup uses `assembleOwnerGranotCreateForKnownFeed` (same translations and one-feed route assembly) and `persistGranotCrmSourceInSession`.

`withMultiEntityRegistryMutation` opens one transaction. Company, Feed, and optional Granot writes plus their audits share that session. A mid-write throw rolls back all three. Nested `withRegistryMutation` commits are not used.

Created records are inactive. `outbound_sms` is not written.

## Readiness plan

Ordered rows. Each names the gate, the existing audited command, and `blocked_until` when later:

1. Set the lead cost — `open_cpl`
2. Activate the lead source — `setSourceCompanyActivation`
3. Activate the feed — `setSourceGranularityActivation` — blocked until lead source active and lead cost valid
4. Switch the Granot name live — `setGranotCrmSourceLifecycleEnabled` — blocked until feed active *(omitted when Granot was skipped)*
5. Turn on the customer text — `setGranotCrmSourceOutboundSms` — blocked until Granot live and create-if-missing and consent attested *(only when `create_if_missing`)*

When Granot is omitted, row 4 is the suggested next step **Connect a Granot name** (`createGranotNameFromOwnerIntent`). Nothing in commit 2 is batched.

## RingCentral DTO

`current_assignment` and history entries now also carry `lead_source_name`, `lead_source_company_slug`, `feed_display_name`, `granularity_key`, `channel`, plus the existing `effective_from` / `effective_until`. Labels resolved with one `$in` for companies and one `$in` for Feeds per response.

Request bodies unchanged. Company ID still rejected (`.strict()`). Inactive or non-`call` Feed still rejected.

`can_deactivate` is no longer returned. Counts remain. Deactivation already closes the open assignment; a hardcoded `true` was not a gate.

## Finding translation

Exhaustive over every code `health.ts` can emit. Unknown codes surface as themselves. Active RC validation failure: **This number has stopped filing calls.**

| Code | Severity | Deep link root |
| --- | --- | --- |
| `registry.signing_secret_missing` | blocking | health |
| `registry.inactive_agents_present` | reviewable | agents |
| `registry.inactive_merchants_present` | reviewable | merchants |
| `registry.ringcentral_validation_failed` | blocking | inbound-numbers |
| `registry.ringcentral_route_inconsistent` | blocking | inbound-numbers |
| `registry.ringcentral_assignment_inconsistent` | blocking | inbound-numbers |
| `registry.migration_evidence_present` | reviewable | health |
| `registry.migration_evidence_missing` | reviewable | health |
| `registry.source_resolution_failures` | blocking | lead-sources |
| `registry.cache_stale` | reviewable | health |
| `registry.compatibility_reads_remaining` | reviewable | label-mappings |
| `registry.label_mapping_destination_invalid` | blocking | label-mappings |
| `registry.label_mapping_collision` | blocking | label-mappings |
| `registry.granot_source_destination_invalid` | blocking | granot-names |
| `registry.granot_source_route_shape_invalid` | blocking | granot-names |
| `registry.granot_sms_gate_inconsistent` | blocking | granot-names |
| `registry.granot_sms_daily_cap_configured` | reviewable | granot-names |
| `registry.granot_source_label_collision` | blocking | granot-names |
| `registry.cpl_schedule_invalid` | blocking | lead-costs |
| `registry.cpl_missing_rate_leads` | blocking | lead-costs |
| `registry.cpl_correction_jobs_unhealthy` | reviewable | lead-costs |
| `registry.source_granularity_inactive_company` | blocking | lead-sources |
| `registry.source_default_invalid` | blocking | lead-sources |
| `registry.source_crm_label_ambiguous` | blocking | lead-sources |
| `registry.source_source_site_ambiguous` | blocking | lead-sources |
| `registry.source_fallback_priority_ambiguous` | blocking | lead-sources |

## Measured round trips

Bound: list ≤ 6, detail ≤ 10. Measured on the completeness fixture:

| Endpoint | Queries | Bound |
| --- | --- | --- |
| list | 6 (companies, Feeds, then mappings / Granot / assignments / CPL in parallel) | 6 |
| detail | 7 (company, Feeds, then the same four in parallel, then inbound routes `$in`) | 10 |

Health builders run on already-loaded rows. Joins are `$in` the Lead Source's own Feed set.

## Zero-mutation proof

Projection tests stub `EntityChange.create` and `OperationsRegistryChange.create`. After list + detail, write count stayed **0**. Preview writes nothing (store counts unchanged).

## Redacted detail projection response

ORS-4 should treat this as the §7.2 contract. Dumped from the completeness fixture (no live/prod payload). IDs are placeholders.

The fixture is intentionally incomplete so empty sections and findings appear: Granot stubs omit `route_key` / `lead_model` (production ORS-2/ORS-3 writes always include them), the local CPL period fails continuity (`lead_cost: "invalid"`), and SMS is on without consent (`granot_sms_gate_inconsistent`). Build against the envelope and per-Feed sections, not these finding values as a live Best Relocation snapshot.

```json
{
  "generated_at": "2026-09-01T20:03:45.085Z",
  "id": "<lead_source_id>",
  "company_slug": "best_relocation_leads",
  "name": "Best Relocation",
  "owner_label": "Best Relocation",
  "active": true,
  "aliases": ["Best Relo"],
  "sheet_config": {
    "has_bad_tabs": false,
    "projection_mode": "derived_import"
  },
  "feeds": {
    "empty": false,
    "items": [
      {
        "id": "<feed_local_id>",
        "granularity_key": "best_relocation_local",
        "channel": "form",
        "display_name": "Web forms — local moves",
        "crm_label": "Best Relocation Locals",
        "move_type": "local",
        "active": true,
        "readiness": {
          "lead_source_active": true,
          "feed_active": true,
          "lead_cost": "invalid",
          "live": false
        },
        "accepted_labels": {
          "empty": false,
          "items": [
            {
              "id": "<label_local_id>",
              "label": "Best Relocation Locals",
              "namespace": "sheet_lead_source",
              "active": true
            }
          ]
        },
        "granot_names": {
          "empty": false,
          "items": [
            {
              "id": "<granot_split_id>",
              "name_received_from_granot": "Best Relocation",
              "when_lead_arrives": "create_if_missing",
              "when_lead_arrives_copy": "Use an existing lead, or create it if missing",
              "text_state": "on",
              "route": {
                "shape": "form_by_move_type",
                "lands_in_this_feed": true,
                "selection_rule": "Use the local feed or the long-distance feed based on the move type.",
                "local_feed_id": "<feed_local_id>",
                "long_distance_feed_id": "<feed_long_id>"
              }
            }
          ]
        }
      },
      {
        "id": "<feed_long_id>",
        "granularity_key": "best_relocation_long",
        "channel": "form",
        "display_name": "Web forms — long-distance",
        "crm_label": "Best Relocation Forms",
        "move_type": "long_distance",
        "active": true,
        "readiness": {
          "lead_source_active": true,
          "feed_active": true,
          "lead_cost": "missing",
          "live": false
        },
        "accepted_labels": {
          "empty": false,
          "items": [
            {
              "id": "<label_long_id>",
              "label": "Best Relocation Forms",
              "namespace": "sheet_lead_source",
              "active": true
            }
          ]
        },
        "granot_names": {
          "empty": false,
          "items": [
            {
              "id": "<granot_split_id>",
              "name_received_from_granot": "Best Relocation",
              "when_lead_arrives": "create_if_missing",
              "when_lead_arrives_copy": "Use an existing lead, or create it if missing",
              "text_state": "on",
              "route": {
                "shape": "form_by_move_type",
                "lands_in_this_feed": true,
                "selection_rule": "Use the local feed or the long-distance feed based on the move type.",
                "local_feed_id": "<feed_local_id>",
                "long_distance_feed_id": "<feed_long_id>"
              }
            }
          ]
        }
      },
      {
        "id": "<feed_call_id>",
        "granularity_key": "best_relocation_calls",
        "channel": "call",
        "display_name": "Inbound calls",
        "crm_label": "Best Relocation Inbounds",
        "active": true,
        "readiness": {
          "lead_source_active": true,
          "feed_active": true,
          "lead_cost": "missing",
          "live": false
        },
        "accepted_labels": { "empty": true, "items": [] },
        "granot_names": {
          "empty": false,
          "items": [
            {
              "id": "<granot_call_id>",
              "name_received_from_granot": "Best Relocation Calls",
              "when_lead_arrives": "existing_only",
              "when_lead_arrives_copy": "Use an existing lead only",
              "text_state": "not_available",
              "route": { "shape": "one_feed", "lands_in_this_feed": true }
            }
          ]
        },
        "inbound_numbers": {
          "empty": false,
          "items": [
            {
              "id": "<inbound_route_id>",
              "phone_number": "+19545550142",
              "nickname": "Best Relocation inbound queue",
              "effective_from": "2026-08-01T00:00:00.000Z"
            }
          ]
        }
      }
    ]
  },
  "blocking_finding_count": 8,
  "findings": [
    {
      "code": "registry.source_default_invalid",
      "severity": "blocking",
      "owner_message": "This lead source has live feeds but no default feed for that channel, so new leads have nowhere to land.",
      "owner_action": "Activate a feed as the default for this channel.",
      "deep_link": "/admin/operations-registry/lead-sources/<lead_source_id>",
      "scope": { "lead_source_id": "<lead_source_id>" },
      "advanced": { "raw_code": "registry.source_default_invalid" }
    },
    {
      "code": "registry.source_default_invalid",
      "severity": "blocking",
      "owner_message": "This lead source has live feeds but no default feed for that channel, so new leads have nowhere to land.",
      "owner_action": "Activate a feed as the default for this channel.",
      "deep_link": "/admin/operations-registry/lead-sources/<lead_source_id>",
      "scope": { "lead_source_id": "<lead_source_id>" },
      "advanced": { "raw_code": "registry.source_default_invalid" }
    },
    {
      "code": "registry.granot_source_route_shape_invalid",
      "severity": "blocking",
      "owner_message": "This Granot name does not say clearly which feed should receive the lead.",
      "owner_action": "Set the Granot name to one feed, or to both local and long-distance form feeds.",
      "deep_link": "/admin/operations-registry/granot-names/<granot_split_id>",
      "scope": { "lead_source_id": "<lead_source_id>" },
      "advanced": { "raw_code": "registry.granot_source_route_shape_invalid" }
    },
    {
      "code": "registry.granot_sms_gate_inconsistent",
      "severity": "blocking",
      "owner_message": "Customer text is shown as on, but this Granot name is not allowed to text.",
      "owner_action": "Turn customer text off, or switch the arrival policy to create-if-missing and attest consent.",
      "deep_link": "/admin/operations-registry/granot-names/<granot_split_id>",
      "scope": { "lead_source_id": "<lead_source_id>" },
      "advanced": { "raw_code": "registry.granot_sms_gate_inconsistent" }
    },
    {
      "code": "registry.granot_source_route_shape_invalid",
      "severity": "blocking",
      "owner_message": "This Granot name does not say clearly which feed should receive the lead.",
      "owner_action": "Set the Granot name to one feed, or to both local and long-distance form feeds.",
      "deep_link": "/admin/operations-registry/granot-names/<granot_call_id>",
      "scope": { "lead_source_id": "<lead_source_id>" },
      "advanced": { "raw_code": "registry.granot_source_route_shape_invalid" }
    },
    {
      "code": "registry.cpl_schedule_invalid",
      "severity": "blocking",
      "owner_message": "This feed cannot go live because its lead cost schedule has a gap or overlap.",
      "owner_action": "Open lead costs for this feed and fix the schedule.",
      "deep_link": "/admin/operations-registry/lead-costs/<feed_local_id>",
      "scope": {
        "lead_source_id": "<lead_source_id>",
        "source_granularity_id": "<feed_local_id>"
      },
      "advanced": { "raw_code": "registry.cpl_schedule_invalid" }
    },
    {
      "code": "registry.cpl_schedule_invalid",
      "severity": "blocking",
      "owner_message": "This feed cannot go live because its lead cost schedule has a gap or overlap.",
      "owner_action": "Open lead costs for this feed and fix the schedule.",
      "deep_link": "/admin/operations-registry/lead-costs/<feed_long_id>",
      "scope": {
        "lead_source_id": "<lead_source_id>",
        "source_granularity_id": "<feed_long_id>"
      },
      "advanced": { "raw_code": "registry.cpl_schedule_invalid" }
    },
    {
      "code": "registry.cpl_schedule_invalid",
      "severity": "blocking",
      "owner_message": "This feed cannot go live because its lead cost schedule has a gap or overlap.",
      "owner_action": "Open lead costs for this feed and fix the schedule.",
      "deep_link": "/admin/operations-registry/lead-costs/<feed_call_id>",
      "scope": {
        "lead_source_id": "<lead_source_id>",
        "source_granularity_id": "<feed_call_id>"
      },
      "advanced": { "raw_code": "registry.cpl_schedule_invalid" }
    }
  ],
  "advanced": {
    "raw_findings": [
      {
        "code": "registry.source_default_invalid",
        "summary": "Active form Source Granularities lack an active same-company default.",
        "entity_type": "source_company",
        "entity_id": "<lead_source_id>"
      },
      {
        "code": "registry.source_default_invalid",
        "summary": "Active call Source Granularities lack an active same-company default.",
        "entity_type": "source_company",
        "entity_id": "<lead_source_id>"
      },
      {
        "code": "registry.granot_source_route_shape_invalid",
        "summary": "Granot name route shape is not one Feed, or one local plus one long-distance Form Feed.",
        "entity_type": "granot_crm_source",
        "entity_id": "<granot_split_id>"
      },
      {
        "code": "registry.granot_sms_gate_inconsistent",
        "summary": "Customer text is shown as on while a source-level gate is false.",
        "entity_type": "granot_crm_source",
        "entity_id": "<granot_split_id>"
      },
      {
        "code": "registry.granot_source_route_shape_invalid",
        "summary": "Granot name route shape is not one Feed, or one local plus one long-distance Form Feed.",
        "entity_type": "granot_crm_source",
        "entity_id": "<granot_call_id>"
      },
      {
        "code": "registry.cpl_schedule_invalid",
        "summary": "Active Source Granularity lacks continuous, non-overlapping CPL coverage.",
        "entity_type": "source_granularity",
        "entity_id": "<feed_local_id>"
      },
      {
        "code": "registry.cpl_schedule_invalid",
        "summary": "Active Source Granularity lacks continuous, non-overlapping CPL coverage.",
        "entity_type": "source_granularity",
        "entity_id": "<feed_long_id>"
      },
      {
        "code": "registry.cpl_schedule_invalid",
        "summary": "Active Source Granularity lacks continuous, non-overlapping CPL coverage.",
        "entity_type": "source_granularity",
        "entity_id": "<feed_call_id>"
      }
    ]
  },
  "_round_trips": 7
}
```

Empty-state examples (same envelope): a Lead Source with `feeds: { empty: true, items: [] }`; a Feed with `accepted_labels: { empty: true, items: [] }`; a call Feed with `inbound_numbers: { empty: true, items: [] }`.

List omits per-Feed label / Granot / number arrays and returns counts plus `generated_at`.

## Tests and typecheck

Focused (46/46 pass):

```text
node --import tsx --import ./scripts/test-setup.ts --test \
  src/services/operationsRegistry/ringCentralRegistry.test.ts \
  src/services/operationsRegistry/queries/findingTranslation.test.ts \
  src/services/operationsRegistry/queries/leadSourceProjection.test.ts \
  src/services/operationsRegistry/leadSourceSetup.test.ts \
  src/routes/lead-source-setups.routes.test.ts \
  src/routes/v1.routes.test.ts \
  src/services/operationsRegistry/queries/health.test.ts

ℹ tests 46
ℹ pass 46
ℹ fail 0
ℹ skipped 0
ℹ duration_ms 8680.7501
```

`pnpm typecheck` — pass (exit 0). Typecheck fixes in this close: `findingTranslation.test.ts` reads `health.ts` via `process.cwd()` (no `import.meta`); RingCentral health input accepts `null` validation fields; projection Granot/CPL casts.

RingCentral request-validation evidence: `reassignment request carrying a company ID is still rejected`; `activation still rejects an inactive or non-call feed`; `dependency preview no longer returns a hardcoded can_deactivate gate`.

Full `pnpm test` was not run as one command. All new and changed test files above were run.

## Preview deployment ids

None. This pass is not authorized to deploy.

## Acceptance criteria (§10)

| Criterion | Evidence |
| --- | --- |
| One request has every Feed, labels, Granot names, numbers, CPL | `leadSourceProjection.test.ts` §7.2 completeness |
| Two move-type Feeds keep separate label sets | named test |
| `form_by_move_type` under both Feeds with selection rule; `one_feed` under one | same completeness test |
| Every finding has action + deep link; table covers every emitted code | `findingTranslation.test.ts` |
| Raw `code` retained in `advanced` | OwnerFinding.advanced.raw_code |
| Setup creates one inactive Lead Source + Feed + readiness plan | `leadSourceSetup.test.ts` |
| Collision writes nothing | document-count tests |
| Mid-transaction failure leaves none of the three | rollback-runner test |
| Paid Overflow-shaped setup is a new first-class Feed; existing `paid_overflow` unchanged | named test |
| RC assignment DTO carries Lead Source name and Feed display name | `ringCentralRegistry.test.ts` |
| Company ID / inactive / non-call Feed still rejected | schema + service tests |
| Round-trip bound | list ≤ 6, detail ≤ 10; measured 6 / 7 |
| Projection writes no Command / EntityChange / audit | write counter stayed 0 |
| Empty states present | zero Feeds, zero labels, call Feed with no number |

## ORS-4 amendment (2026-09-01)

Additive Owner fields on the detail projection, so the go-live checklist can
re-read from one GET:

- `GranotLandingItem.live` from `lifecycle_enabled`
- `LeadSourceDetail.readiness_plan` — same gates as setup, with
  `status` / Owner-safe `action` tokens

No mutation, matching, or setup command changed.

## What was not done

- ORS-4 (Admin UI, language-deck test, review-sentence render, ingestion copy)
- Touch label-mapping or Granot semantics
- Change RingCentral request validation, activation ordering, effective dating, or cache policy beyond DTO enrichment and removing `can_deactivate`
- Remove Paid Overflow's Feed
- Deprecate `/admin/source-companies` or `/admin/source-granularities`
- Enable SMS, send a message, apply production indexes, deploy, commit, or push
- Preview deploy (not authorized; no deployment ids)
- Full `pnpm test` glob

## Confirmation

No SMS was enabled. No lifecycle activation flag was changed. No message was sent. `vantage-admin` was not touched. No production index was applied.
