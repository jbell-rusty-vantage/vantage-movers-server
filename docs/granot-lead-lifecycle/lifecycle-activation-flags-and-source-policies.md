---
type: Operations
title: Granot lifecycle activation flags and source policies
description: Owner-ready .env postures, Best Relocation create-if-missing seed facts, and the model fields that actually gate lead_created behavior.
tags:
  - granot
  - lead-lifecycle
  - source-policy
  - feature-flags
status: draft
stale_after: 2026-10-19
generated:
  by: cursor-grok-4.6
  at: 2026-08-19T16:50:00Z
sources:
  - id: final-spec
    resource: ../../scripts/prototypes/granot-lead-lifecycle/specs/FINAL-SPECIFICATION-GRANOT-LEAD-LIFECYCLE.md
  - id: flags
    resource: ../../src/config/domain/granotLifecycle.ts
  - id: source-semantics
    resource: ../../src/models/granotCrmSourceSemantics.ts
  - id: source-migration
    resource: ../../scripts/migrations/granot-lifecycle-source-registry.ts
verified:
  - by: agent:production-policy-apply
    at: 2026-08-20T03:17:48Z
    notes: Owner-authorized scoped report/apply/verify/idempotency cycle on vantagemovers; exactly the Best Relocation Forms and Inbounds lead_created_policy fields changed to create_if_missing.
  - by: agent:production-read
    at: 2026-08-19T16:44:00Z
    notes: Read-only Mongo on vantagemovers for Best Relocation company, granularities, GranotCrmSource rows, and activation collection.
owners: [team:main-server]
applies_to:
  - src/config/domain/granotLifecycle.ts
  - src/models/GranotCrmSource.ts
  - src/models/LeadSourceCompany.ts
  - src/models/LeadSourceGranularity.ts
---

# Granot lifecycle activation, flags, and source policies

This is the Unit 34-and-onward cheat sheet. It is not a go-live authorization.

Three facts up front:

1. **Capture is already on.** Webhooks land as receipts even when every effect flag is false.
2. **Flags alone cannot create Leads.** Creation also needs a write-once activation row, `live` mode, and a reviewed Registry policy of `create_if_missing`.
3. **The create policy does not live on Source Company or Source Granularity.** Those rows only name the destination. The policy lives on `GranotCrmSource`.

## 1. Environment flags

Checked-in defaults in `src/config/domain/granotLifecycle.ts`. Values must be the literals `true` or `false`. Blank uses the default. Any other string crashes boot.

### 1.1 Safe observe posture (current checked-in default)

Process receipts. Write Observations and Decisions. Create **no** Leads, cases, commands, or email.

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

Related, not in the Granot flag file:

```text
RINGCENTRAL_GRANOT_ADOPTION_ENABLED=false
```

`GRANOT_WEBHOOK_SECRET` must already be set. Capture uses that secret, not `VANTAGE_API_SECRET`.

### 1.2 Best Relocation `lead_created` creates Leads

This is the first live-effect posture. Turn these on only after Unit 34, index verification, and Owner activation.

```text
GRANOT_LIFECYCLE_PROCESSING_ENABLED=true
GRANOT_LIFECYCLE_SHADOW_MODE=false
GRANOT_LIFECYCLE_LEAD_WRITES_ENABLED=true
GRANOT_LIFECYCLE_LEAD_CREATION_ENABLED=true
GRANOT_LIFECYCLE_BOOKING_CASES_ENABLED=false
GRANOT_LIFECYCLE_BOOKING_COMMANDS_ENABLED=false
GRANOT_LIFECYCLE_RELEASE_CASES_ENABLED=false
GRANOT_LIFECYCLE_RELEASE_COMMANDS_ENABLED=false
GRANOT_LIFECYCLE_REFERRAL_BOOKING_ENABLED=false
GRANOT_LIFECYCLE_EMAIL_ENABLED=false
RINGCENTRAL_GRANOT_ADOPTION_ENABLED=true
```

What each of those four “on” values does:

| Flag | When true |
| --- | --- |
| `PROCESSING_ENABLED` | Drainer/processor may run. Off = capture only. |
| `SHADOW_MODE=false` | Post-activation receipts become `live` instead of `live_shadow`. Historical receipts stay `historical_shadow` forever. |
| `LEAD_WRITES_ENABLED` | A matched existing Lead may receive authorized Granot fill (`synchronizeLeadFromGranot`). |
| `LEAD_CREATION_ENABLED` | An unmatched `lead_created` may mint a Lead **if** Registry policy is `create_if_missing`. |
| `RINGCENTRAL_GRANOT_ADOPTION_ENABLED` | A later RingCentral qualified call may attach to a Granot-created Call Lead instead of minting a twin. |

Leave every Booking/Release/Referral/email flag **false** until those workflows are separately accepted. Email stays retired.

### 1.3 Later flags (do not turn on for Best Relocation create)

```text
GRANOT_LIFECYCLE_BOOKING_CASES_ENABLED=true      # open dashboard booking cases
GRANOT_LIFECYCLE_BOOKING_COMMANDS_ENABLED=true   # Owner confirm/update/No Action
GRANOT_LIFECYCLE_RELEASE_CASES_ENABLED=true      # open read-only deterministic-Booking Release cases
GRANOT_LIFECYCLE_RELEASE_COMMANDS_ENABLED=true   # Unit 27+ only; remains false after Unit 26
GRANOT_LIFECYCLE_REFERRAL_BOOKING_ENABLED=true   # also needs Booking cases true
GRANOT_LIFECYCLE_EMAIL_ENABLED=true              # retired; keep false
```

Case reads work without command flags. Unit 26 Release reads show separate evidence plus the current deterministic Booking/Cancellation and never expose a selector or mutation. Enable Release cases only after its five indexes verify and Owner review/rollout authorization; Release commands remain false until the later command unit is accepted. Commands never come before cases. Booking comes before Release. Email is last and optional.

### 1.4 Activation is not an env var

Until this row exists, **every** receipt is `historical_shadow` and no live effect is eligible — even if `SHADOW_MODE=false`. Production `vantagemovers` now has the write-once row. The cutoff is `activated_at` `2026-08-20T18:52:50.047Z`. Receipts captured before that stay `historical_shadow` forever.

```ts
// collection: granot_lifecycle_activations
{
  key: "granot_lifecycle",          // unique, write-once
  activated_at: Date,
  activated_by: DurableActor,
  reason: string,                   // Owner reason
  processor_version: string,
}
```

Owner-only:

```text
POST /api/v1/admin/granot-lifecycle/activation
```

Production `vantagemovers` has exactly one activation row (`key: "granot_lifecycle"`, `processor_version: "granot-lifecycle-processor-v1"`). A second activate is `409`. Rollback never deletes this row; it only turns flags off.

`captured_at < activated_at` stays historical forever. Shadow Decisions are never replay-promoted into live effects.

## 2. Layered gates (all must be true)

An effect happens only when every applicable gate is true. A disabled gate yields `policy_blocked`. Deferred disposition yields `deferred`.

1. Global flag for that effect (`LEAD_CREATION_ENABLED`, and so on).
2. Receipt is post-activation **and** processor mode is `live`.
3. `GranotCrmSource.enabled === true` **and** `lifecycle_enabled === true`.
4. Disposition permits the effect (`source_scoped_lead` for Lead create).
5. Source Company is active.
6. Selected Source Granularity is active.
7. `lead_created_policy` (or the later reconciliation policy) permits the effect.

The Decision stores a snapshot of every evaluated gate. That is why a Best Relocation webhook can be captured and still create nothing: a single false gate is enough.

## 3. Best Relocation Registry migration and required create policy

### 3.1 What already exists in `vantagemovers`

Use the guarded `migration:granot-lifecycle:sources` report/apply/verify flow for Registry compatibility. The retired prototype seed is not an operational command. **Do not invent a second company.** Do not put `create_if_missing` on company or granularity documents; it belongs only on the reviewed Granot CRM source rows.

| Kind | Key / label | Production `_id` | Active |
| --- | --- | --- | --- |
| Source Company | `best_relocation_leads` (“Best Relocation Leads”) | `6a4d240f3117eacd97823868` | yes |
| Granularity | `best_relocation_leads_call` | `6a4d240f04c6e063cb6621f3` | yes, channel `call` |
| Granularity | `best_relocation_leads_form_local` | `6a4d240f04c6e063cb6621f2` | yes, `local` |
| Granularity | `best_relocation_leads_form_long_distance` | `6a4d240f04c6e063cb6621f1` | yes, `long_distance` |

Mapped Granot labels (collection `granot_crm_sources`):

| Granot label | Normalized | Source `_id` | Policy **now** | Routes |
| --- | --- | --- | --- | --- |
| `Best Relocation Forms` | `best relocation forms` | `6a8546291ff601e1d4ab962d` | **`create_if_missing`** | Form local + Form long-distance |
| `BestRelocation Inbounds` | `bestrelocation inbounds` | `6a8546291ff601e1d4ab9630` | **`create_if_missing`** | Call + any |

Both rows are already `enabled: true`, `lifecycle_enabled: true`, `lifecycle_disposition: "source_scoped_lead"`, `lead_source_company` = Best Relocation, policy version `granot-lifecycle-source-policy-v1`.

The guarded production migration changed only `lead_created_policy`; both rows retained the reviewed company, routes, disposition, activation posture, and nonblank policy version. Creation still requires every runtime flag, activation, identity, route, and minimum-data gate.

### 3.2 Applied policy change (not a company/granularity edit)

Change **only** the two `GranotCrmSource` rows above:

```ts
lead_created_policy: "create_if_missing"
```

Leave routes, company, granularities, disposition, and `lifecycle_enabled` as they are.

Expected behavior after flags + activation + this policy:

| Incoming Granot label | Selected granularity | Lead minted when unmatched |
| --- | --- | --- |
| `BestRelocation Inbounds` (and reviewed spacing alias) | `best_relocation_leads_call` | Call Lead, `ingestion_origin: "granot_lead_created"`, `post_to_granot: false` |
| `Best Relocation Forms`, same origin/destination state | `best_relocation_leads_form_local` | Form Lead, same origin |
| `Best Relocation Forms`, different valid states | `best_relocation_leads_form_long_distance` | Form Lead, same origin |
| `Best Relocation Forms`, invalid/missing states | none | `insufficient_creation_data` — no Lead |

A later identical authorized create for the same Observation **replays**. It does not mint a twin. If a WordPress or sheet Form Lead already owns that `ref_no` in this company, the webhook **synchronizes** and does not create.

Call minimum data can be Job-only. Form minimum is Job + deterministic Local/long-distance route + name + phone + valid origin/destination state and ZIP.

### 3.3 How to apply the policy (audited command only)

Do **not** `updateOne` these fields in Compass. Writes go through `createOrUpdateGranotCrmSource` so Registry audit and cache stay consistent.

Owner HTTP (after the Admin lock below is removed):

```text
PATCH /api/v1/admin/granot-crm-sources/6a8546291ff601e1d4ab962d
PATCH /api/v1/admin/granot-crm-sources/6a8546291ff601e1d4ab9630
```

Body shape (Forms example; keep the existing two routes):

```json
{
  "granot_label": "Best Relocation Forms",
  "lifecycle_enabled": true,
  "lifecycle_disposition": "source_scoped_lead",
  "lead_created_policy": "create_if_missing",
  "lead_source_company": "6a4d240f3117eacd97823868",
  "lifecycle_routes": [
    {
      "route_key": "form_local",
      "lead_model": "FormLead",
      "move_type": "local",
      "source_granularity_id": "6a4d240f04c6e063cb6621f2"
    },
    {
      "route_key": "form_long_distance",
      "lead_model": "FormLead",
      "move_type": "long_distance",
      "source_granularity_id": "6a4d240f04c6e063cb6621f1"
    }
  ],
  "lifecycle_policy_version": "granot-lifecycle-source-policy-v1",
  "reason": "Authorize Best Relocation lead_created to create unmatched Form Leads."
}
```

Inbound body: same company, one `CallLead` + `any` route to `6a4d240f04c6e063cb6621f3`, reason for Call Leads.

Admin validation and the Registry UI still reject `create_if_missing`; the dropdown remains a later-rollout surface. The Owner-authorized guarded migration called the audited Registry service directly. Until the UI contract is separately expanded, the guarded migration remains the legal write path for this policy.

### 3.4 What not to seed

| Label / thing | Policy | Why |
| --- | --- | --- |
| `Referral` | `observation_only` + `referral_booking` | No Lead. Later Booking-only. |
| `Paid Overflow` / future `Auto` | `deferred` | Evidence only. |
| Payload `type=AUTO` | not a source | Provider context. Never a company guess. |
| Main Site / TBM / TBM Prime / Top10 / 10best | reviewed `link_only` + `source_scoped_lead` | WordPress and RingCentral remain the creators. Automation apply is allowed; Granot does not mint these Leads. |

## 4. Important new model fields and policies

### 4.1 `GranotCrmSource` — the only semantic registry

Collection `granot_crm_sources`. This is the row that decides “what does this Granot label mean?”

```ts
normalized_granot_label: string; // NFKC, trim, collapse whitespace, lowercase
enabled: boolean;                // operational catalog row
lifecycle_enabled: boolean;      // default false; requires enabled + policy version
lifecycle_disposition:
  | "source_scoped_lead"         // Best Relocation, Main Site, TBM, Top10
  | "referral_booking"           // Referral — no Lead
  | "deferred";                  // Paid Overflow / Auto — evidence only
lead_created_policy:
  | "link_only"                  // match/link only (migration-safe default)
  | "create_if_missing"          // mint Lead when unmatched + complete
  | "observation_only";          // required for referral_booking and deferred
lead_source_company?: ObjectId;  // Vantage Source Company, not the CSV label
lifecycle_routes: Array<{
  route_key: string;             // unique inside this source
  lead_model: "FormLead" | "CallLead";
  move_type: "local" | "long_distance" | "any";
  source_granularity_id: ObjectId;
}>;
lifecycle_policy_version: string; // required when lifecycle_enabled
```

Hard rules:

- `create_if_missing` is legal **only** with `source_scoped_lead`.
- `referral_booking` and `deferred` have **no** Lead routes and must be `observation_only`.
- Call routing is exactly one `CallLead + any`.
- Form routing is either one `FormLead + any`, or exactly one local plus one long-distance.
- Call and Form routes cannot mix on one source.
- Zero / many label matches, inactive company, inactive granularity, or ambiguous Form routes **fail closed**.

`source_company` on the same document is the older CSV-catalog slug (`best_relocation_leads`). Runtime identity uses `lead_source_company` + `lifecycle_routes`.

### 4.2 Source Company and Source Granularity — destination only

These already existed. Lifecycle adds **no** create-policy field here. They must stay **active**.

Best Relocation destination:

```text
company_slug: best_relocation_leads
  └── best_relocation_leads_call
  └── best_relocation_leads_form_local
  └── best_relocation_leads_form_long_distance
```

If either company or the selected granularity is inactive, creation is `policy_blocked` even with `create_if_missing`.

### 4.3 Lead provenance fields (FormLead / CallLead)

Set at creation. Several are immutable after insert.

| Field | Why it matters |
| --- | --- |
| `ingestion_origin` | Granot-minted Leads are `granot_lead_created`. Never `wordpress_form` or `ringcentral`. Immutable. |
| `post_to_granot` | Forced `false` on Granot-created Leads so Vantage does not post the Lead back to Granot. |
| `job_no` / `normalized_job_no` | Granot Job Number copied onto the Lead. |
| `granot_priority` | All valid Priority values stored. Only `1` and `5` authorize broad enrichment and set Call `quoted = true`. |
| `ingested_contact_snapshot` / `ingested_move_snapshot` | Creation-time evidence. Immutable. |
| `granot_contact_snapshot` + `current_contact_provenance` | Later Granot fill vs Vantage-owned current contact. |
| `last_accepted_granot_observation` | Last Observation that was allowed to change the Lead. |
| `lead_source_company` / `source_granularity_id` | Source Scope. Identity never reassigns this from a later conflicting label. |
| `ringcentral_convergence` (Call only) | `pending` → `adopted` / `conflict` / `not_applicable`. |

Form origins: `wordpress_form | granot_lead_created | best_relocation_sheet | vantage_admin`.  
Call origins: `ringcentral | granot_lead_created | best_relocation_sheet | vantage_admin | legacy_import`.

### 4.4 Record Link — the Job Number reservation

Collection `granot_record_links`. One **active** link per normalized Job Number.

```ts
provider: "granot"
normalized_job_no: string
state: "active" | ...
lead_ref?: { model: "FormLead" | "CallLead"; id }
booking_ref?: ObjectId
source_scope?: { lead_source_company; source_granularity_id }
```

Creation reserves a **new** active link. A pre-existing lead-less reservation is `record_link_conflict`, not a steal. This is how two `lead_created` deliveries stay one Lead.

### 4.5 Receipt → Observation → Decision (evidence, not the Lead)

| Document | Role |
| --- | --- |
| `GranotObservationReceipt` (`granot_webhook_receipts`) | Durable capture. `202` only after commit. Queue wake-up is `{ receipt_id }` only. |
| `GranotObservation` | Normalized evidence. Granot is **not** Booking/Cancellation authority. |
| `SynchronizationDecision` | Business outcome + gate snapshot. `created` / `applied` / `already_current` / `pending_match` / `unmatched` / `ambiguous` / `conflict` / `deferred` / `policy_blocked` / `insufficient_creation_data` / … |

`route_event_class` on the receipt is `lead_created | priority_updated | booking_status_changed`. Only `lead_created` may invoke `createLeadFromGranot`.

### 4.6 Execution modes

```ts
type ExecutionMode = "historical_shadow" | "live_shadow" | "live";
```

| Mode | When | May create a Lead? |
| --- | --- | --- |
| `historical_shadow` | No activation, or `captured_at < activated_at` | No |
| `live_shadow` | Post-activation and `SHADOW_MODE=true` | No. Decision records what would have happened. |
| `live` | Post-activation and `SHADOW_MODE=false` | Yes, if every other gate is true. |

## 5. Recommended Unit 34+ sequence

Do these in order. Do not skip to flags.

1. Finish Units 30–31 and 33. Unit 32 email stays omitted.
2. Unit 34 current-payload certification on redacted live shapes. Any mismatch is a defect against the owning earlier unit — do not weaken policy to make a payload pass.
3. Best Relocation policy update is complete through the audited scoped migration; do not repeat it through the UI.
4. Optionally unlock `create_if_missing` on the Registry HTTP/Admin enum as a separately reviewed management-surface change.
5. Write-once activation with an Owner reason and a chosen cutoff time.
6. Set the §1.2 env values on the server. Keep Booking/Release/email false.
7. Watch `GET /api/v1/admin/granot-lifecycle/operations/health` and Operational Events. First live proof: one unmatched Best Relocation inbound `lead_created` creates one Call Lead; a duplicate delivery replays; a Main Site `lead_created` still does **not** create.

Rollback: set `GRANOT_LIFECYCLE_LEAD_CREATION_ENABLED=false` first, then `SHADOW_MODE=true` if needed. Capture stays on. Do not delete activation, receipts, Decisions, Record Links, or committed Leads. If a single source is wrong, set that row `lifecycle_enabled=false` through the audited activation command — do not edit it in Compass.

## 6. Discrepancy posture (Unit 29)

Unit 29 adds no flag. Automatic Booking-conflict persistence is controlled by `GRANOT_LIFECYCLE_BOOKING_CASES_ENABLED`; Release conflicts use `GRANOT_LIFECYCLE_RELEASE_CASES_ENABLED`. Live mode, activation, reviewed source policy, and the corresponding case gate must all pass. Shadow and historical Decisions are never promoted.

Existing discrepancy rows remain readable when a case flag is disabled. Trusted Owner commands additionally require current server facts, strict revisions/idempotency, and their existing command trust boundary; they do not authorize official Booking/Cancellation or Lead-attribution mutation. See [discrepancy-review-and-record-link-correction.md](discrepancy-review-and-record-link-correction.md).
