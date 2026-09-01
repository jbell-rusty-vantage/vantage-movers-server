# ORS-2 completion

Closed 2026-09-01. Branch `operations-registry-source-connections`. No commit, push, or deploy.

A Granot CRM Source is the exact Granot spelling plus arrival policy. Creating one is how the extension and automation know which source companies exist. `create_if_missing` is the ingest path for partners whose leads are born in Granot, not on a form or RingCentral queue — and it is the only policy that may text the customer. The persisted Feed route (`lifecycle_routes[].source_granularity_id`) is how create-if-missing writes `lead_source_company` and `source_granularity_id` on the new Lead. The Owner command derives company from Feed; it never accepts a contradictory pair.

## Files added

- `src/services/operationsRegistry/ownerGranotNames.ts`
- `src/services/operationsRegistry/ownerGranotNames.test.ts`
- `scripts/migrations/granot-source-semantic-drift.ts`
- `docs/operations-registry-source-connections/sessions/ORS-2-process.md`
- `docs/operations-registry-source-connections/reports/ORS-2-completion.md`

## Files changed

- `src/services/operationsRegistry/granotCrmSources.ts` — same-mutation SMS-off when policy leaves `create_if_missing`
- `src/services/operationsRegistry/granotCrmSources.test.ts` — stored-document assertion
- `src/services/operationsRegistry/crmSourceOutboundSms.ts` — `daily_cap` dropped from Owner view/command; stored cap preserved
- `src/services/operationsRegistry/crmSourceOutboundSms.test.ts` — enable-guard + template-version regression
- `src/validation/v1/admin.validation.ts` — `ownerGranotNameCreateSchema`; `daily_cap` removed from SMS schema
- `src/validation/v1.validation.ts` — re-export Owner schema
- `src/routes/v1.routes.ts` — `POST /api/v1/admin/granot-crm-sources` adjacent to the Granot block; PATCH returns SMS-off fact; SMS handler no longer writes `daily_cap`
- `src/routes/v1.routes.test.ts` — POST listed
- `src/routes/granot-crm-sources.routes.test.ts` — Owner schema, unknown keys, SMS `daily_cap` reject
- `src/services/operationsRegistry/index.ts` — Owner exports
- `src/services/operationsRegistry/queries/health.ts` — Granot findings appended after label-mapping findings
- `src/services/operationsRegistry/queries/health.test.ts` — five findings
- `src/services/granotLifecycle/createLeadFromGranot.ts` — comment only: resolved snapshot ID, no second lookup
- `src/services/granotLifecycle/createLeadFromGranot.test.ts` — source-scope company ID on the create checksum
- `src/services/granotLifecycle/sourcePolicy.test.ts` — twelve outcomes + snapshot immutability + Twilio-import proof
- `src/services/leadMessaging/granotCreatedLead.test.ts` — resolved company, no second lookup, link_only send-nothing, replay, Twilio un-called
- `package.json` — `migration:granot-source-semantic-drift`
- `docs/operations-registry-source-connections/issues/ORS-2.md` — §4 reverify drift
- `docs/operations-registry-source-connections/PROGRESS.md`

Did not touch `labelMappings.ts`, `sourceResolution.ts`, `config/domain/sources.ts`, lead-source-setups, aggregate projection, RingCentral DTOs, or `vantage-admin`.

## Translation table as implemented

| Owner field | Stored field |
| --- | --- |
| `handling: "our_lead_source"` | `lifecycle_disposition: "source_scoped_lead"` |
| `handling: "referral_booking"` | `lifecycle_disposition: "referral_booking"` |
| `handling: "watch_only"` | `lifecycle_disposition: "deferred"` |
| `when_lead_arrives: "watch_only"` | `lead_created_policy: "observation_only"` |
| `when_lead_arrives: "existing_only"` | `lead_created_policy: "link_only"` |
| `when_lead_arrives: "create_if_missing"` | `lead_created_policy: "create_if_missing"` |
| `destination.kind: "one_feed"` | one route, `route_key` `any`, `lead_model` from Feed channel (`form`→`FormLead`, `call`→`CallLead`) |
| `destination.kind: "form_by_move_type"` | two `FormLead` routes `form_local` / `form_long` |

Derived, never accepted from the client:

| Field | Rule |
| --- | --- |
| `crm_origin` | `GRANOT_CRM_DEFAULT_ORIGIN` |
| `workspace_slug` | normalized label, non `[a-z0-9]` → `-`; collision rejected by name, never suffixed |
| `source_company` (legacy CSV) | left `"not_provided"`; omitted from Owner create result |
| `lead_model` / `route_key` | derived; unknown-key reject on the Owner route |

Write path is `createOrUpdateGranotCrmSource`. `validateGranotCrmSourceSemantics` runs on the assembled document before that call. New sources are inactive (`enabled` / `lifecycle_enabled` false). `outbound_sms` is not written. Activation stays the existing command.

## `daily_cap` verdict

Owner unanswered → **remove from the Owner contract**.

- Dropped from `OwnerOutboundSmsView`, `granotCrmSourceOutboundSmsSchema`, SMS command input, and `handleGranotCrmSourceOutboundSms`.
- Persisted field left on `GranotCrmSource.outbound_sms.daily_cap`. SMS writes preserve the stored value.
- Health finding `registry.granot_sms_daily_cap_configured` for any stored non-zero cap.
- Repo-wide: no send path reads `daily_cap`. Handler line drifted from `:1171` (2026-08-24) to `:1202` before this pass; the write is now gone from the Owner handler.

## Snapshot and SMS call chain

**Already true. Not rebuilt. Not duplicated.**

`SourcePolicySnapshot` already has `granot_crm_source_id`, `lead_source_company_id`, `source_granularity_id`, `selected_route_key`, `lead_created_policy`, `lifecycle_policy_version`. A later store edit does not mutate a returned snapshot (`sourcePolicy.test.ts`).

Call chain:

1. `resolveSourcePolicy` writes those IDs onto the snapshot.
2. `createLeadFromGranot` loads the company by `snapshot.lead_source_company_id`.
3. `sendGranotCreatedLeadConfirmation` receives `lead_source_company_id: String(company._id)` — the resolved ID.
4. Persist writes `lead_source_company: input.lead_source_company_id`.
5. `resolveSourceCompanyFromLabel` is not imported by `granotCreatedLead.ts` and is not called on this path.

Customer body still identifies **Vantage Movers**. `LeadSourceCompany.name` is leftover `{company}` interpolation only.

`link_only` enrich sends nothing (persist and dispatch stay at 0). Replaying one observation twice returns `already_sent` on the second persist (duplicate key / persisted identity).

## Twelve policy × effect outcomes

| Policy | link | enrich | create | text |
| --- | --- | --- | --- | --- |
| `observation_only` | no | no | no | no |
| `link_only` | yes | yes | no | no |
| `create_if_missing` | yes | yes | yes | yes |

Link / enrich / create from `evaluateEffectGates`. Text from `evaluateGranotLeadSmsGates` (other SMS gates held true so the policy is the only variable).

## Twilio zero-send proof

- `granotCreatedLead.ts` does not import `createTwilioSender` or `twilioAdapter`.
- `sourcePolicy.ts` contains no `twilio` string.
- Policy / send tests inject `persist` and `dispatch`. The default dispatch (`dispatchOrQueuePersistedLeadMessage` → `createTwilioSender`) is never selected.
- On `link_only`, persist and dispatch call counts stay 0.
- ESM namespace exports are getter-only; the stub is the injected dispatch plus a source-level import assertion, not a monkeypatch of `createTwilioSender`.

## Drift-report output (verbatim)

`TEST_MODE=true pnpm migration:granot-source-semantic-drift` against `testvantagemovers`. Report only. No `--apply`. No production confirmation flag.

```json
{
  "script": "granot-source-semantic-drift",
  "mode": "report",
  "database": "testvantagemovers",
  "source_count": 9,
  "finding_count": 0,
  "findings": []
}
```

Nine existing Granot names on the test database currently raise none of the §6.5 findings.

## Tests and typecheck

Focused (74 pass / 0 fail / 1 skipped — the skip is the pre-existing replica-set proof in `granotCrmSources.test.ts`, which requires `TEST_MODE=true` before process start; not an ORS-2 criterion):

```text
node --import tsx --import ./scripts/test-setup.ts --test \
  src/services/operationsRegistry/ownerGranotNames.test.ts \
  src/services/operationsRegistry/granotCrmSources.test.ts \
  src/services/operationsRegistry/crmSourceOutboundSms.test.ts \
  src/services/operationsRegistry/queries/health.test.ts \
  src/routes/granot-crm-sources.routes.test.ts \
  src/routes/v1.routes.test.ts \
  src/services/granotLifecycle/sourcePolicy.test.ts \
  src/services/leadMessaging/granotCreatedLead.test.ts \
  src/services/granotLifecycle/createLeadFromGranot.test.ts

ℹ tests 75
ℹ pass 74
ℹ fail 0
ℹ skipped 1
```

`pnpm typecheck` — pass.

Full `pnpm test` was not run as one command (`pnpm test -- files` expands the package.json glob). All new and changed test files above were run.

## Preview deployment ids

None. This pass is not authorized to deploy.

## Acceptance criteria (§10)

| Criterion | Evidence |
| --- | --- |
| POST create inactive, SMS-off, one `any` route, `lead_model` derived | `ownerGranotNames.test.ts` one_feed Form and Call |
| Submitted `lead_source_id` mismatch names both IDs | named test |
| Client `lead_model` / `route_key` / derived keys rejected | `granot-crm-sources.routes.test.ts` `.strict()` |
| Four `form_by_move_type` rejections | four named tests |
| `watch_only` + non-null destination rejected | named test |
| Duplicate normalized name rejected | named test |
| Policy change turns SMS off on the **stored** document | `granotCrmSources.test.ts` reads `$set` |
| No write path leaves SMS on under a non-`create_if_missing` policy | update path + SMS enable-guard |
| Template edit increments `template_version` and leaves enabled false | `crmSourceOutboundSms.test.ts` |
| `daily_cap` gone from Owner contract; stored field + health finding remain | schema + view + health tests |
| Twelve independent policy × effect outcomes | `sourcePolicy.test.ts` |
| Resolved Lead Source ID reaches texting; no second label lookup | `granotCreatedLead.test.ts` |
| `link_only` enrich sends nothing | persist/dispatch stay 0 |
| Replay → at most one message by persisted identity | `already_sent` on second persist |
| Snapshot fields present; later edit does not mutate returned snapshot | `sourcePolicy.test.ts` |
| Five health findings raise / quiet | `health.test.ts` |
| Mutations audited with actor and reason | Owner create audit assertion + existing `withRegistryMutation` |

## Legacy CSV `source_company` consumers (reported, not retired)

| Consumer | Role |
| --- | --- |
| `src/models/GranotCrmSource.ts` | required string field, default `not_provided` |
| `src/services/granotCrmCsv/registry.ts` | seed rows + `normalizeSourceCompany` |
| `src/services/operationsRegistry/granotCrmSources.ts` | still persists the string on create/update |

Owner create leaves `"not_provided"` and omits the field from the Owner result.

## What was not done

- ORS-3 (aggregate projection, lead-source-setups, RingCentral DTOs)
- ORS-4 (admin UI, review-sentence render, exact-spelling warning)
- Touch `labelMappings.ts`, `sourceResolution.ts`, `config/domain/sources.ts`
- Retire legacy CSV `source_company`
- Enable SMS, send a message, change lifecycle flags, apply production indexes
- Delete stored `daily_cap` values
- Read live production payloads
- Commit, push, deploy
- Preview deploy (not authorized; no deployment ids)
- Full `pnpm test` glob

## Confirmation

No SMS was enabled. No lifecycle activation flag was changed. No message was sent. Twilio was not constructed. `vantage-admin` was not touched.
