# ORS-2 process notes

Started 2026-09-01 on branch `operations-registry-source-connections` in `vantage-main-server`. No commit authorized. `vantage-admin` is untouched. No SMS enabled, no lifecycle flag changed, no message sent.

## §4 reverify

Observed 2026-08-24; rechecked 2026-09-01 against the repository after ORS-1.

| Claim | Status |
| --- | --- |
| No `POST /admin/granot-crm-sources` | Confirmed. Granot block is now `v1.routes.ts:376-390` (ORS-1 inserted label-mapping after `/source-resolution/preview`). Still GET list/detail + PATCH update/activation/sms/recent only. |
| `granot-crm-sources.routes.test.ts` is schema-level, no sibling routes file | Confirmed. Followed that. POST mounted inline next to the Granot GET/PATCH block. Did not reorder ORS-1's label-mapping block. |
| `createOrUpdateGranotCrmSource` supports create but never writes `outbound_sms` | Confirmed. That is the SMS invariant hole. |
| `crmSourceOutboundSms.ts:111` rejects enable unless `create_if_missing`; `:134` forces off on template/basis change | Confirmed. Verified and regression-tested. Not rebuilt. |
| `daily_cap` written at `v1.routes.ts:1171` / `crmSourceOutboundSms.ts:160,276` / `admin.validation.ts:334` | **Drift.** Handler write is now `v1.routes.ts:1202`. Validation still `:334`. `toSmsView` still returned `daily_cap`. No send path reads it (repo-wide search). |
| `sendGranotCreatedLeadConfirmation` takes `lead_source_company_id` | Confirmed. Caller `createLeadFromGranot.ts:548-557` passes `String(company._id)` after loading the company by `snapshot.lead_source_company_id`. No second label-to-company lookup. |
| `SourcePolicySnapshot` already has §5.2 fields | Confirmed. `granot_crm_source_id`, `lead_source_company_id`, `source_granularity_id`, `selected_route_key`, `lead_created_policy`, `lifecycle_policy_version`. Not duplicated. |
| `queries/health.ts` emits no Granot semantic finding | Confirmed. ORS-1 appended label-mapping findings at the end of assembly. Granot findings must append **after** those. |
| `handling: "watch_only"` maps to `deferred` | Confirmed. `GRANOT_LIFECYCLE_DISPOSITIONS` is `source_scoped_lead` \| `referral_booking` \| `deferred`. |
| `createOrUpdateGranotCrmSource` requires `workspace_slug` from the command | Confirmed (`granotCrmSources.ts` ~273). Owner DTO omits it; translation derives it. |
| New sources default `enabled` true if omitted | Confirmed (`booleanValue(before?.enabled, true)`). Owner create must pass `enabled: false`. |

Corrected in `issues/ORS-2.md` §4 in this pass.

## Decisions

- **Translation, not a second write path.** `createGranotNameFromOwnerIntent` validates in the stated order, derives `crm_origin` / `workspace_slug` / routes / `lead_model`, then calls `createOrUpdateGranotCrmSource`. `validateGranotCrmSourceSemantics` runs on the assembled document before that call and again inside create.
- **`watch_only` → `deferred`.** Existing enum. Not a new disposition.
- **`workspace_slug`** is the normalized Granot label with remaining non `[a-z0-9]` runs turned into `-`. Collision on `{crm_origin, workspace_slug}` is rejected by name, never suffixed.
- **`source_company` CSV string** stays `"not_provided"`. Omitted from the Owner create result. Consumers reported; nothing retired.
- **Owner create result** is the created record plus a gate checklist so `create_if_missing` is not implied live. `source_company` is not on that surface.
- **`daily_cap`:** Owner has not answered. Removed from Owner contract. Persisted field left on the model. Health finding `registry.granot_sms_daily_cap_configured` for any stored non-zero cap. SMS writes preserve the stored cap; they no longer accept a new one.
- **SMS invariant:** when `createOrUpdateGranotCrmSource` moves `lead_created_policy` away from `create_if_missing` and stored `outbound_sms.enabled` is true, the same `$set` turns SMS off and stamps `deactivation_reason`. Command result exposes `customer_text_turned_off_due_to_policy_change` for ORS-4.
- **Health:** `buildGranotSourceHealthFindings` appended after label-mapping findings. Granot sources loaded as the last `Promise.all` entry.
- **Snapshot / texting call chain:** already correct. Tests prove it. No parallel snapshot.
- **Twilio:** policy tests never import `createTwilioSender`. `granotCreatedLead` tests stub persist/dispatch. A spy on `createTwilioSender` is asserted un-called.

## Files

See [`../reports/ORS-2-completion.md`](../reports/ORS-2-completion.md).

## What this pass did not do

- ORS-3 (aggregate projection, lead-source-setups, RingCentral DTOs)
- ORS-4 (admin UI)
- Touch `labelMappings.ts`, `sourceResolution.ts`, `config/domain/sources.ts`
- Retire legacy CSV `source_company`
- Enable SMS, send a message, change lifecycle flags, apply production indexes
- Delete stored `daily_cap` values
- Commit, push, deploy
- Preview deploy (not authorized; no deployment ids)

## Commands

Focused tests (final):

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

Skip is the pre-existing replica-set proof (`TEST_MODE=true` before process start), not an ORS-2 failure.

`pnpm typecheck` — pass (exit 0).

`TEST_MODE=true pnpm migration:granot-source-semantic-drift` — report only, `testvantagemovers`, 9 sources, 0 findings. JSON pasted in the completion report.

Twilio: `createTwilioSender` is getter-only on the ESM namespace. Proof is source-level (send/policy modules do not import it) plus injected persist/dispatch staying at 0 on blocked paths.
