# Unit 12 — Lead provenance schema parity, immutable snapshots, and trusted validators

> **Contract maturity: implementation-ready; implementation remains blocked by Units 09–11 and the shared-branch sequence.** This is the schema/runtime half of S08. It establishes trusted Lead provenance and immutable creation evidence without backfilling legacy rows, applying indexes, running identity/desired-state policy, or enabling Lead lifecycle writes/creation.

## 1. Authority and required reading

- **Final specification:** Sections 1–2, 4–7, 10.1, 11 ordering metadata, 14.1–14.4, 15, 16.2–16.3 only for contextual creation validation, 23, 27, 34.3/34.5/34.7, 35–37, 38/S08, and 39–41.
- **Acceptance ownership:** schema/runtime prerequisites for AC-03 and AC-07; model/create-path foundation for AC-10, AC-11, and AC-12. Units 14–15/18–19 own identity, planning, current-state mutation, display, and creation effects.
- **Approved split:** Unit 12 in `lead_lifecycle_issue_breakdown_reccomendation.md`. Unit 13 alone owns legacy provenance/backfill manifests and Lead index deployment.
- **Execution:** delivery runbook, repository instructions, lifecycle/schema/business-logic rules, verified Unit 05 and Unit 09–11 completion reports, and current production Lead/RingCentral create seams.

The final specification wins. This unit may make model validation capable of accepting a trusted future `granot_lead_created` context, but must not implement Unit 19's create-if-missing policy or a live caller.

## 2. Objective

Add exact Form/Call Ingestion Origin unions, Form Job Number parity, canonical normalized Job storage, Granot/Priority fields, immutable creation contact/move snapshots, current provenance and bounded contact-change summaries, temporal-winner storage, Call quoted/convergence parity, receiver-agent provenance parity, and exact Lead index declarations; capture trusted origin/snapshots atomically on existing creation paths; and exclude all internal lifecycle metadata from public/admin mutation schemas.

## 3. Repository, branch, and prerequisites

- **Repository:** `vantage-main-server`; branch `granot-lead-lifecycle`.
- **Blocked by:** Unit 05 plus verified Units 09–11. Reverify Registry trusted provenance, revision/Change fields, canonical transaction internals, outbox posture, and completion reports against code.
- Before editing, inspect Form/Call models, public/admin/trusted Zod schemas, Form/manual Call/RingCentral create services, normalization helpers, source/CPL/duplicate/Form Fill behavior, projections, and index manifest.
- Use only redacted synthetic values. Replica-set evidence is required for claims that snapshot/origin and Lead creation roll back atomically.
- No commit, push, deploy, production migration/index apply, activation, live payload inspection, or external send is authorized.

## 4. Current-state evidence to verify

Observed on 2026-08-17; reverify after predecessor implementation:

- `FormLead` lacks `job_no`, normalized Job, top-level origin, snapshots, Granot/provenance/temporal fields, and required S08 indexes. Persisted `move_size` is still required.
- `CallLead` has Job normalization and nested `ringcentral.ingestion_source`, but lacks top-level origin, `quoted`, snapshots, Granot/provenance/temporal fields, and convergence state.
- Both receiver-agent enums lack `granot_username_match`; legacy Granot extension patching writes `extension_crm_username_match`.
- Strict public schemas currently exclude nonexistent internal metadata, but there is no separate trusted contextual validator for Granot-created Leads.
- Existing Form/manual Call/RingCentral creation services store no top-level origin or immutable snapshot. Form's compatibility `ingestion_source` affects behavior but is not persisted.
- The lifecycle index script covers earlier lifecycle collections but not the exact Lead indexes. Their declaration belongs here; report/apply/verify belongs to Unit 13.
- Current lifecycle flag defaults already match the required S08 posture.

## 5. Locked decisions and invariants at risk

- **Invariant 1 — MongoDB is the System of Record:** provenance and snapshots are durable Lead facts.
- **Invariant 5 — only canonical commands mutate Leads:** trusted internals, not client fields, assign or later alter lifecycle metadata.
- **Invariant 6 — post-activation mutations are causal/atomic:** existing creation paths must persist origin/snapshot in their creation transaction; Units 10–11 own Command/Change/outbox mechanics.
- **Invariant 8 — provenance axes are independent:** `ingestion_origin` is not Source System, Observation Channel, nested RingCentral transport provenance, actor, or initiator.
- **Invariant 9 — immutable creation evidence is never overwritten:** later Granot/RingCentral evidence remains separate.
- **Invariant 10 — identity conflict never reassigns Source Company, Source Granularity, Ingestion Origin, or CPL.**
- **Invariant 11 — Duplicate/Bad Form restrictions remain unchanged:** schema parity does not make those Leads eligible.

## 6. Deliverables and exact contract

### 6.1 Ingestion Origin

Add immutable, server-assigned fields:

```ts
type FormLeadIngestionOrigin =
  | "wordpress_form"
  | "granot_lead_created"
  | "best_relocation_sheet"
  | "vantage_admin"
  | "legacy_unknown";

type CallLeadIngestionOrigin =
  | "ringcentral"
  | "granot_lead_created"
  | "best_relocation_sheet"
  | "vantage_admin"
  | "legacy_import"
  | "legacy_unknown";
```

- Public create/patch and ordinary admin patch clients cannot submit `ingestion_origin`. The server derives it from a trusted entry point/context.
- Existing trusted DTO `ingestion_source` remains one-way compatibility input and is translated; it never becomes a client-selected origin. Nested `ringcentral.ingestion_source = webhook | call_log_sync | manual` remains transport provenance.
- Use this exact path mapping (narrow **issue-author guidance** where the final specification names the workflow but not the current adapter): ordinary `createFormLead`/WordPress route -> `wordpress_form`; trusted Best Relocation/external-sheet Form or Call command -> `best_relocation_sheet`; authenticated Vantage Admin/manual Form or Call command -> `vantage_admin`; `createRingCentralCallLead` -> `ringcentral`; an explicitly identified legacy Call import adapter -> `legacy_import`; trusted future Granot canonical creation -> `granot_lead_created`. `legacy_unknown` is migration-only and is never assigned to a new row. A generic caller that cannot be proven to be one of these paths fails closed instead of accepting or guessing an origin.
- New lifecycle code may write `granot_lead_created` only through the trusted canonical provenance contract; no caller is enabled here.

### 6.2 Shared Lead fields and subdocuments

Add to both Lead models unless stated otherwise:

```ts
job_no?: string; // new on Form; existing on Call
normalized_job_no?: string;
granot_priority?: string;
granot_move_size?: string;
granot_service_type?: string;
ingested_contact_snapshot?: {
  first_name?: string;
  last_name?: string;
  name?: string;
  phone_number?: string;
  normalized_phone_number?: string;
  email?: string;
  captured_at: Date;
  evidence_status: "captured_at_ingestion" | "legacy_baseline";
};
granot_contact_snapshot?: {
  first_name?: string;
  last_name?: string;
  name?: string;
  phone_number?: string;
  normalized_phone_number?: string;
  email?: string;
  differs_from_ingested: boolean;
  observation_id: ObjectId;
  captured_at: Date;
};
current_contact_provenance?: {
  source_system: "vantage" | "granot" | "ringcentral";
  observation_id?: ObjectId;
  changed_at: Date;
};
current_move_provenance?: {
  source_system: "wordpress" | "granot" | "ringcentral" | "admin" | "legacy";
  observation_id?: ObjectId;
  changed_at: Date;
};
last_accepted_granot_observation?: {
  observation_id: ObjectId;
  captured_at: Date;
};
granot_contact_revision: number; // default 0
last_granot_contact_change?: {
  observation_id: ObjectId;
  changed_at: Date;
  changed_paths: string[];
  before_hash: string;
  after_hash: string;
};
```

- Use shared sub-schemas in `src/models/granotLifecycleSchemas.ts` where that preserves identical validation.
- `normalized_job_no` is derived only by the existing `normalizeJobNo`: NFKC, trim, each non-letter/digit run to one space, collapse whitespace, uppercase, empty as absent.
- Snapshot/provenance/temporal/revision-summary fields reject malformed dates/ObjectIds/enums. As narrow **issue-author guidance**, `granot_contact_revision` uses a nonnegative integer model validator to keep its counter semantics aligned with `domain_revision`. `last_granot_contact_change.changed_paths` validation is deferred to the later mutation unit, which must define the exact contact allowlist and bound before it can write this optional summary; Unit 12 must not invent or accept arbitrary paths.
- Ingested snapshots are immutable after insert. Granot snapshots are separate evidence and can never replace them. `last_accepted_granot_observation` is storage only here; Unit 15 owns temporal comparison/CAS and no-op advancement.
- `last_granot_contact_change` is a bounded summary; complete change history remains `EntityChange`. Hash input/canonicalization must be defined by the later mutation unit, not guessed here.

Add Form-only:

```ts
ingested_move_snapshot?: {
  pickup_city?: string;
  pickup_zip?: string;
  pickup_state?: string;
  delivery_city?: string;
  destination_zip?: string;
  delivery_state?: string;
  move_date?: Date;
  move_size?: string;
  captured_at: Date;
  evidence_status: "captured_at_ingestion" | "legacy_baseline";
};
```

Add Call-only:

```ts
quoted: boolean; // required, default false
ringcentral_convergence?: {
  state: "pending" | "adopted" | "conflict" | "not_applicable";
  candidate_window_started_at?: Date;
  adopted_at?: Date;
  conflict_reason?: string;
  observation_id?: ObjectId;
};
```

Add exact `granot_username_match` to both receiver-agent source enums. Keep `extension_crm_username_match` readable for compatibility, but new lifecycle code never writes it.

### 6.3 Trusted creation and contextual validation

- Every new Lead captures `ingested_contact_snapshot` from the trusted normalized creation input in the same transaction as insert, using the same trusted `now` and `captured_at_ingestion`.
- Every new Form Lead also captures `ingested_move_snapshot` in that transaction. Primary WordPress name/phone/email and immutable submitted contact/move snapshots remain unchanged by later Granot evidence.
- RingCentral-created Call contact and caller metadata remain immutable evidence; Granot-created Lead snapshots are immutable even though no WordPress authority exists.
- Make only the persisted Form `move_size` path optional. Ordinary WordPress/Admin/import Zod schemas continue to require it. A trusted canonical `granot_lead_created` Form may omit it only after Unit 19's minimum-data policy passes.
- Ordinary RingCentral Call creation retains current phone/qualification requirements. A trusted canonical Granot Call may use Job Number without phone only with verified Registry policy and canonical command provenance; no public schema gains that permission.
- Every Granot-created Lead forces `post_to_granot=false`; a caller cannot override it.
- Public/admin patch schemas reject snapshots, origin, Granot Priority provenance, temporal winner, aggregate revision/last-change metadata, contact summary, and convergence state. Existing trusted internal services receive a distinct typed input rather than widening public schemas.
- Preserve field authority: Job fills only when missing; accepted Priority stores separately; Granot never sets quoted false or overwrites Form `move_size`; source scope/origin/CPL never reassign; official Booking/Cancellation values remain owner-command-only.

### 6.4 Exact model index declarations

Declare, but do not apply here:

```ts
// FormLead
{ normalized_job_no: 1 }
{ source_granularity_id: 1, normalized_job_no: 1 }
{ source_granularity_id: 1, normalized_phone_number: 1, duplicate: 1 }
{ ref_no: 1, duplicate: 1 }

// CallLead
{ source_granularity_id: 1, normalized_job_no: 1 }
{ source_granularity_id: 1, normalized_phone_number: 1, createdAt: -1 }
{ ingestion_origin: 1, source_granularity_id: 1,
  "ingested_contact_snapshot.normalized_phone_number": 1, createdAt: -1 }
```

Do not make Lead Job Number globally unique. Preserve any still-needed compatibility index until Unit 13 inventories actual deployed definitions.

### 6.5 Documentation

Update Form/Call/RingCentral, schema/project, and lifecycle docs for origin derivation, immutable creation evidence, Form Job parity, Call quoted parity, trusted/public validator separation, and the fact that migration and live lifecycle mutation remain disabled.

## 7. Explicitly out of scope

- Unit 13 legacy origin/snapshot/Job backfill, reports, manifests, collision inventory, index apply/verify, or any production data operation.
- Unit 14 identity/source ladders; Unit 15 temporal comparison, desired state, and processor orchestration; Unit 18 live matched writes; Unit 19 actual Granot creation; Unit 20 RingCentral adoption.
- Entity Change/outbox canonicalization (Unit 11), Admin display, extension/automation convergence, Booking/Release work, source policy changes, activation/rollout, or compatibility cleanup.
- Any automatic Booking/Cancellation fact, public mutation of internal metadata, snapshot overwrite, globally unique Lead Job index, raw/current payload access, or external send.

## 8. Flags and runtime posture

Starting and ending values are unchanged:

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

No activation or effect change. Model capability and existing-path snapshot capture do not authorize lifecycle writes/creation.

## 9. Migration and indexes

- **Data migration: none in Unit 12.** Existing rows remain readable with absent additive fields until Unit 13.
- **Index application: none in Unit 12.** Declare/test exact model indexes; Unit 13 extends `migration:granot-lifecycle:leads` and `migration:granot-lifecycle:indexes` for report -> reviewed apply -> verify.
- Never create indexes through `syncIndexes()` or apply against production during this unit.

## 10. Acceptance criteria

- [ ] **AC-03 exact release assertion (foundation/partial here):** “Form CRM Posting sends `FormLead.ref_no` as `leadno`; Granot `ref_no` round-trips to exact Form Lead; valid Mongo ID fallback remains compatible.” Unit 12 proves Form Job parity does not reinterpret `ref_no` or break CRM payload compatibility; Units 01/14 own full identity proof.
- [ ] **AC-07 exact release assertion (foundation/partial here):** “Matched-existing Lead Created links/enriches without creating a second Lead.” Unit 12 proves only the target schema/trusted-validator capability; identity/planning/write proof remains Units 14–15/18–19.
- [ ] **AC-10 exact release assertion (foundation/partial here):** “WordPress Form primary contact and immutable submitted snapshot stay unchanged while qualified Granot contact is stored separately and displayed.” Unit 12 proves atomic capture, immutability, and separate snapshot schema; later effects/UI complete it.
- [ ] **AC-11 exact release assertion (foundation/partial here):** “WordPress immutable move snapshot stays unchanged while qualified Granot current location/move date/cubic feet and Move Type update.” Unit 12 proves atomic immutable move capture and separate current provenance capability; later effects complete it.
- [ ] **AC-12 exact release assertion (foundation/partial here):** “Call/Granot-created Form qualified contact becomes current; bounded Lead summary changes while full history appears in Entity Change.” Unit 12 proves Call/Form parity and bounded-summary schema; Units 11/15/18 own Change/current mutation proof.
- [ ] Existing WordPress and RingCentral creation paths derive exact origin and snapshots atomically; rollback leaves no partial Lead.
- [ ] Public/admin input cannot set internal metadata; trusted Granot shape forces `post_to_granot=false`; ordinary Form/Call requirements remain intact.
- [ ] Exact field defaults/enums/immutability and all seven index definitions match the specification; no globally unique Lead Job index exists.

## 11. Required tests and commands

- Model tests for exact paths/defaults/enums, immutable snapshots/origin, contextual validators, receiver-source compatibility, normalization, and index definitions.
- Service tests for WordPress Form, manual/Admin/Best Relocation paths, manual/RingCentral Call, trusted Granot capability, atomic snapshot rollback, `post_to_granot=false`, and Call `quoted=false`.
- Validation tests rejecting every internal field on public/admin create/patch while keeping ordinary `move_size` and RingCentral requirements.
- Forbidden-effect assertions: no lifecycle Lead mutation/create, Booking/Cancellation/case/discrepancy/notification, snapshot overwrite, source/CPL reassignment, or new Sheet work merely from schema inspection.

Run exactly:

```text
node --import tsx --import ./scripts/test-setup.ts --test "src/models/FormLead.test.ts" "src/models/CallLead.test.ts" "src/validation/v1.validation.test.ts" "src/services/leads/formLead.service.test.ts" "src/services/leads/callLead.service.test.ts"
pnpm test:granot-lifecycle:replica -- --unit=12
pnpm test
pnpm typecheck
```

Register Unit 12's replica test files in `scripts/test-granot-lifecycle-replica.ts` and extend its validated usage to accept `--unit=12`; the runner must retain its test-database and replica-set refusal gates. If existing model test filenames differ, add focused files under the owning model/service modules and record the exact command in the handoff. Fakes alone cannot prove rollback atomicity.

## 12. Live/staging verification

- In a disposable replica-set database with external effects disabled, create redacted synthetic WordPress Form and RingCentral Call Leads through production service interfaces.
- Inspect masked IDs/counts only: exact origin, `captured_at_ingestion` snapshot status, normalized Form Job, Call quoted false, immutable re-save behavior, and absence of lifecycle effects.
- No migration dry run belongs here. Production verification remains read-only and separately approved; no current payload/contact values may be inspected or recorded.

## 13. Rollback

- Disable/revert only the changed existing create adapter if necessary and deploy compatible prior code; all lifecycle effect flags remain false.
- Old code may ignore additive fields. Preserve every committed origin, snapshot, revision, Change, Command, receipt/Observation/Decision, activation/link, outbox row, and official fact.
- Never erase snapshots, rewrite origin, or convert `captured_at_ingestion` into `legacy_baseline`. Index/data rollback belongs to Unit 13 and requires a separately authorized manifest-backed action.

## 14. Required completion handoff

Create `delivery/completion-reports/UNIT-12-COMPLETION.md` per Runbook Section 13, including:

- model/sub-schema/validator/create-service/docs files grouped by behavior;
- Sections 11/14.2–14.4/15, invariants 1/5–6/8–11, S08 runtime allocation, and partial AC-03/07/10/11/12 mapping;
- exact origin derivation matrix, snapshot immutability, Form/Call contextual permissions, index declarations, and no-migration/no-index-apply statement;
- flags before/after; focused/full/replica results and masked creation/rollback proof;
- proof public inputs cannot set metadata and no later lifecycle/Booking/Cancellation effect occurred;
- final `git status --short` and explicit external-action statement.

Successful verified implementation unblocks **Unit 13**. Unit 14 remains blocked until Unit 13 migration/index verification is complete.
