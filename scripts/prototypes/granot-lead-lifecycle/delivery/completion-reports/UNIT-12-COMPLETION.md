# Unit 12 completion — Lead provenance schema parity, immutable snapshots, and trusted validators

## Status and scope

- **Status:** complete
- **Repository / branch:** `vantage-main-server` / `granot-lead-lifecycle`
- **Authoritative contract:** final specification Sections 1–2, 4–7, 10.1, 11 ordering metadata, 14.1–14.4, 15, 16.2–16.3 (contextual validation only), 23, 27, 34.3/34.5/34.7, 35–37, 38/S08, and 39–41
- **Acceptance ownership:** schema/runtime prerequisites for AC-03 and AC-07; model/create-path foundation for AC-10, AC-11, and AC-12. Units 14–15/18–19 own identity, planning, current-state mutation, display, and creation effects.
- **Applicable invariants preserved:** 1 (Mongo is SoR for origin/snapshots), 5 (trusted internals assign lifecycle metadata), 6 (origin/snapshot persist in the existing create transaction), 8 (Ingestion Origin is independent of Source System / Observation Channel / nested RingCentral transport), 9 (ingested snapshots are immutable), 10 (origin is not reassigned), 11 (schema parity does not make Duplicate/Bad Form Leads eligible)
- **Runtime posture:** no flag, caller, or later Section 23.4 command enabled. Unit 07 defaults remain: processing true, shadow true, all eight effect flags false.

## Files added or changed

### Model / shared schemas

- `src/models/granotLifecycleSchemas.ts` — origin unions, shared snapshot/provenance/temporal/convergence sub-schemas, receiver-agent enum with `granot_username_match`, immutability guards
- `src/models/FormLead.ts` — Form Job Number, optional persisted `move_size`, origin/snapshots/provenance fields, four S08 index declarations
- `src/models/CallLead.ts` — required `quoted` default false, origin/snapshots/convergence fields, three S08 index declarations
- `src/services/granotLifecycle/types.ts` — `FormLeadIngestionOrigin` / `CallLeadIngestionOrigin` and related unions

### Origin derivation / trusted validators / create services

- `src/services/leads/leadIngestionProvenance.ts` — fail-closed origin derivation, snapshot builders, forbidden-field strip
- `src/services/granotLifecycle/trustedLeadCreateValidation.ts` — distinct trusted Granot Form/Call create schemas; force `post_to_granot=false`; no live caller
- `src/services/leads/formLead.service.ts` — WordPress/Admin/sheet create captures origin + ingested contact/move snapshots in the create transaction
- `src/services/leads/callLead.service.ts` — manual/Admin/sheet and RingCentral create capture origin + ingested contact snapshot; `quoted=false`; extracted `createRingCentralCallLeadInTransaction`
- `src/services/domainCommands/existingWrites.ts` — adapters derive origin from trusted command context
- `src/validation/v1/leads.validation.ts` — `granot_username_match` on the public receiver-agent enum; public schemas remain `.strict()`
- `src/services/crm/formLeadPayload.ts` — optional persisted `move_size` compatibility; `leadno` still `ref_no`
- `src/services/historicalConsolidation/schemaValidation.ts` — treat additive `granot_contact_revision` / `quoted` defaults as server-owned, not sheet-planned facts

### Tests

- `src/models/FormLead.test.ts`, `src/models/CallLead.test.ts`
- `src/services/leads/leadIngestionProvenance.test.ts`
- `src/services/granotLifecycle/trustedLeadCreateValidation.test.ts`
- `src/services/leads/leadProvenance.replica.test.ts`
- `src/validation/v1.validation.test.ts`, `src/services/leads/formLead.service.test.ts`, `src/services/leads/callLead.service.test.ts`, `src/services/crm/formLeadPayload.test.ts`, `src/services/domainCommands/domainCommands.test.ts`
- `scripts/test-granot-lifecycle-replica.ts` — unit `12` registration

### Docs

- `.cursor/businesslogic/form-lead.service.md`, `call-lead.service.md`, `granotLifecycle.revisions.md`, `domainCommands.service.md`
- `.cursor/index.md`
- `.cursor/rules/schema-and-crud-inputs.mdc`, `business-logic.mdc`, `form-lead-granot-crm.mdc`, `ringcentral-integration.mdc`, `project-organization.mdc`, `granot-lifecycle-capture.mdc`

## Exact contracts landed

### Ingestion Origin (14.2)

| Trusted entry point | `ingestion_origin` |
| --- | --- |
| ordinary `createFormLead` / WordPress route (API-secret / system actor) | `wordpress_form` |
| authenticated Vantage Admin / manual Form or Call (owner/admin actor) | `vantage_admin` |
| trusted Best Relocation / `external_sheet_ingestion` | `best_relocation_sheet` |
| `createRingCentralCallLead` | `ringcentral` |
| trusted future Granot canonical create (`granot_lifecycle`) | `granot_lead_created` (capability only; no caller) |
| new-row assignment of `legacy_unknown` | rejected |

Unproven callers fail closed. DTO `ingestion_source` remains one-way compatibility input. Nested `ringcentral.ingestion_source` remains transport provenance.

### Snapshots and shared fields (14.3 / 15.1–15.3)

New Leads persist `ingested_contact_snapshot` with `captured_at_ingestion` and the same trusted `now` as insert. New Form Leads also persist `ingested_move_snapshot`. Ingested snapshots and `ingestion_origin` are immutable after insert. Granot snapshot/provenance/temporal/convergence/bounded-summary fields are storage-capable only; this unit does not write them or invent a `changed_paths` allowlist.

Form gains `job_no` / `normalized_job_no` via existing `normalizeJobNo`. `FormLead.ref_no` remains Tracking Reference. Call `quoted` is required and defaults to `false`. Receiver-agent enums include `granot_username_match`; `extension_crm_username_match` remains readable.

### Contextual validation (14.4 / 16.3 capability)

Public/admin create/patch reject origin, snapshots, Priority provenance, temporal winner, revision/last-change metadata, contact summary, and convergence. Ordinary Form Zod still requires `move_size`; persisted Form `move_size` is optional. Ordinary RingCentral create keeps phone/qualification. Trusted Granot Form may omit `move_size`; trusted Granot Call may use Job Number without phone; both force `post_to_granot=false`. No live Granot create caller.

### Index declarations (14.3)

Declared, not applied:

```text
FormLead: { normalized_job_no: 1 }
FormLead: { source_granularity_id: 1, normalized_job_no: 1 }
FormLead: { source_granularity_id: 1, normalized_phone_number: 1, duplicate: 1 }
FormLead: { ref_no: 1, duplicate: 1 }
CallLead: { source_granularity_id: 1, normalized_job_no: 1 }
CallLead: { source_granularity_id: 1, normalized_phone_number: 1, createdAt: -1 }
CallLead: { ingestion_origin: 1, source_granularity_id: 1,
  "ingested_contact_snapshot.normalized_phone_number": 1, createdAt: -1 }
```

No globally unique Lead Job index. Compatibility indexes are preserved.

## Migrations / indexes / database mode

- **Data migration: none.** Existing rows remain readable with absent additive fields until Unit 13.
- **Index application: none.** Model declarations only. No `syncIndexes()`, no `migration:granot-lifecycle:leads` / `:indexes` apply.
- Replica proof used `TEST_MODE=true` and `SHEET_SYNC_MODE=disabled` in the process environment only. `.env` was not edited.

## Flags before / after

`.env` does not set the ten Unit 07 lifecycle flags. Effective defaults, unchanged:

```text
GRANOT_LIFECYCLE_PROCESSING_ENABLED=true
GRANOT_LIFECYCLE_SHADOW_MODE=true
GRANOT_LIFECYCLE_LEAD_WRITES_ENABLED=false
GRANOT_LIFECYCLE_LEAD_CREATION_ENABLED=false
GRANOT_LIFECYCLE_BOOKING_CASES_ENABLED=false
GRANOT_LIFECYCLE_BOOKING_COMMANDS_ENABLED=false
GRANOT_LIFECYCLE_RELEASE_CASES_ENABLED=false
GRANOT_LIFECYCLE_RELEASE_COMMANDS_ENABLED=false
GRANOT_LIFECYCLE_REFERRAL_BOOKING_ENABLED=false
GRANOT_LIFECYCLE_EMAIL_ENABLED=false
```

No Granot/RingCentral lifecycle caller or later effect was enabled.

## Verification commands

### Focused (issue §11)

```text
node --import tsx --import ./scripts/test-setup.ts --test "src/models/FormLead.test.ts" "src/models/CallLead.test.ts" "src/validation/v1.validation.test.ts" "src/services/leads/formLead.service.test.ts" "src/services/leads/callLead.service.test.ts"
```

**86 pass / 0 fail / 0 skipped.**

Additional helper files also passed: `leadIngestionProvenance.test.ts`, `trustedLeadCreateValidation.test.ts`, `formLeadPayload.test.ts` (AC-03 Job vs `ref_no`).

### Replica-set

```text
TEST_MODE=true SHEET_SYNC_MODE=disabled pnpm test:granot-lifecycle:replica -- --unit=12
```

**3 pass / 0 fail** on disposable replica-set `testvantagemovers`:

- WordPress Form create through `createFormLeadInTransaction`: `ingestion_origin=wordpress_form`, both ingested snapshots `captured_at_ingestion` at trusted `now`, `ref_no` unchanged, re-save cannot rewrite origin
- Form origin/snapshot insert aborted in a Mongo transaction leaves zero Lead
- RingCentral create through `createRingCentralCallLeadInTransaction`: `ingestion_origin=ringcentral`, `quoted=false`, ingested contact snapshot; injected failure rolls back the Call Lead

Masked synthetic phones `5550100110` / `5550100120`. Prefixes `u12f-…` / `u12c-…`. ZIP geocode 403s fell back to `not_found` and did not block create. No Booking/Cancellation rows. Lifecycle effect flags remained false.

### Full repository

```text
pnpm test
```

**1183 tests; 1162 pass / 0 fail / 21 skipped.**

```text
pnpm typecheck
```

**pass** (`tsc --noEmit` exit 0).

```text
git diff --check
```

**pass** (no whitespace errors).

## AC-to-proof coverage

| AC / checklist | Proof |
| --- | --- |
| AC-03 foundation (Form Job parity does not reinterpret `ref_no`) | `FormLead.test.ts`; `formLeadPayload.test.ts` (`leadno` stays `ref_no` when `job_no` is present); replica Form create keeps `DT_u12ref` |
| AC-07 foundation (schema/trusted-validator capability only) | model indexes/enums; `trustedLeadCreateValidation.test.ts`; public Zod rejection of internal fields |
| AC-10 foundation (atomic contact snapshot + immutability) | Form model immutability; provenance helper; replica Form create + rollback |
| AC-11 foundation (atomic move snapshot + current-move-provenance schema) | Form model + replica `ingested_move_snapshot`; `current_move_provenance` schema only |
| AC-12 foundation (Call/Form parity + bounded-summary schema) | Call `quoted` default false; Call snapshot/origin; `last_granot_contact_change` schema without invented path allowlist |
| Existing WordPress/RingCentral create paths + rollback | replica Form and RingCentral service interfaces |
| Public/admin cannot set internal metadata; trusted Granot forces `post_to_granot=false` | `v1.validation.test.ts`; trusted validator tests |
| Seven indexes; no unique Lead Job index | Form/Call model tests |
| No later lifecycle/Booking/Cancellation effect | replica flag/count assertions; flags unchanged |

## Concurrency, idempotency, privacy

- Replica abort after Form/Call insert leaves no partial Lead.
- Ingested snapshots and origin cannot be overwritten on re-save.
- Fixtures use synthetic `5550100xxx` phones and `U12` / `Synthetic User` names. No credential, cookie, or unmasked live contact value was inspected or recorded.
- Historical consolidation planner still rejects unplanned sheet facts; additive schema defaults are ignored as server-owned.

## Masked verification

Disposable `testvantagemovers` only. External effects disabled (`SHEET_SYNC_MODE=disabled`). Synthetic WordPress Form and RingCentral Call creates through production service interfaces. Masked ids `6a83…`; prefixes `u12f-…` / `u12c-…`. No HTTP/Admin/extension smoke. No current live payload inspection. No migration dry run.

## Known risks and deferred work

- Full AC-03 identity ladder (Granot `ref_no` round-trip / Mongo ID fallback) remains Units 01/14.
- Full AC-07 matched-existing create-if-missing / no-second-Lead write remains Units 14–15/18–19.
- AC-10/11 display and later Granot current-state mutation remain Units 15/18 and Admin.
- AC-12 Entity Change / current-contact mutation remains Units 11/15/18. Hash input and `changed_paths` allowlist are not invented here.
- Unit 13 owns origin/snapshot/Job backfill, collision inventory, and index report → apply → verify.
- `legacy_import` exists on the Call union; no current adapter is identified, so it is never assigned.
- WordPress vs Admin origin uses command actor type (system → `wordpress_form`, owner/admin → `vantage_admin`) because both share `POST /form-leads` and Unit 11 compatibility origin `vantage_admin`.
- ZIP geocode is not required for snapshot capture; replica Form create succeeded after provider 403 fallback to `not_found`.
- Later `synchronizeLeadFromGranot` / `createLeadFromGranot` remain disabled.

## Newly unblocked

Successful verified implementation unblocks **Unit 13**. Unit 14 remains blocked until Unit 13 migration/index verification is complete. Unit 20 remains blocked until Unit 19.

## Final `git status --short`

### vantage-main-server (`granot-lead-lifecycle`)

```text
 M .cursor/businesslogic/call-lead.service.md
 M .cursor/businesslogic/domainCommands.service.md
 M .cursor/businesslogic/form-lead.service.md
 M .cursor/businesslogic/granotLifecycle.revisions.md
 M .cursor/index.md
 M .cursor/rules/business-logic.mdc
 M .cursor/rules/form-lead-granot-crm.mdc
 M .cursor/rules/granot-lifecycle-capture.mdc
 M .cursor/rules/project-organization.mdc
 M .cursor/rules/ringcentral-integration.mdc
 M .cursor/rules/schema-and-crud-inputs.mdc
 M scripts/prototypes/granot-lead-lifecycle/delivery/UNIT-STATUS.md
 M scripts/test-granot-lifecycle-replica.ts
 M src/models/CallLead.ts
 M src/models/FormLead.ts
 M src/models/granotLifecycleSchemas.ts
 M src/services/crm/formLeadPayload.test.ts
 M src/services/crm/formLeadPayload.ts
 M src/services/domainCommands/domainCommands.test.ts
 M src/services/domainCommands/existingWrites.ts
 M src/services/granotLifecycle/types.ts
 M src/services/historicalConsolidation/schemaValidation.ts
 M src/services/leads/callLead.service.test.ts
 M src/services/leads/callLead.service.ts
 M src/services/leads/formLead.service.test.ts
 M src/services/leads/formLead.service.ts
 M src/validation/v1.validation.test.ts
 M src/validation/v1/leads.validation.ts
?? scripts/prototypes/granot-lead-lifecycle/delivery/completion-reports/UNIT-12-COMPLETION.md
?? src/models/CallLead.test.ts
?? src/models/FormLead.test.ts
?? src/services/granotLifecycle/trustedLeadCreateValidation.test.ts
?? src/services/granotLifecycle/trustedLeadCreateValidation.ts
?? src/services/leads/leadIngestionProvenance.test.ts
?? src/services/leads/leadIngestionProvenance.ts
?? src/services/leads/leadProvenance.replica.test.ts
```

No other repository was in scope.

No commit, push, deploy, production mutation, production index apply, live-payload access, Granot call, or external send occurred.
