# Granot Dashboard server handoff

The Granot HTTP collector and dashboard workflow are integrated server
features. They are mounted in `src/app.ts`, protected by API-secret plus signed
Owner actor authentication, backed by `granot_automation_runs`, and woken in
production through the Vercel Queue consumer with a cron recovery heartbeat.

This document describes both the implemented state and the next implementation:
one owner action must be able to create distinct Form Lead and Call Lead durable
runs from all or a specific subset of persisted Granot Automation Sources.

## Domain language

- **Granot Automation Source**: an exact, case-sensitive label from the Granot
  Leads & Advertising selector. It controls which reports are collected. It is
  not a Source Company identity from the Operations Registry.
- **Lead workflow**: either `form_leads` or `call_leads`. Avoid calling this
  merely "type" in the UI.
- **Run mode**: either `preview` or `apply`. `apply` still creates a read-only
  immutable plan first and requires explicit approval before any write.
- **Durable run**: one persisted execution for exactly one Lead workflow.
- **Run group**: the correlation identity for the one or two durable runs
  created by a single owner submission. This is a proposed implementation term,
  not a new worker state machine.

Form Leads and Call Leads are separate planners with separate action shapes and
write seams. They must remain separate durable runs. "Run both" means creating
two correlated runs, not adding a third `both` operation to one run.

## Implemented state

- `GranotAutomationSource` persists exact labels in
  `granot_automation_sources`.
- Owner-only `GET` and `POST`
  `/api/v1/admin/granot-automation/runs/sources` list and create labels.
- `scripts/granot-automation/seed-sources.ts` idempotently seeds the current
  nine labels.
- The admin dashboard can select all labels, select a subset, and add a label.
- A durable run still accepts one `operation` and a raw `source_labels` array.
- The current source catalog does not record which Lead workflows a source
  supports, so the UI presents a mixed list of Forms and Inbounds labels.
- The current UI creates one `apply` run at a time. In this mode the server
  previews first, locks the plan, and waits for owner approval before writing.

## Current module map

- `index.ts`: bounded same-origin Granot HTTP session and HTML report parser.
- `automation.ts`: legacy direct collect/call-preview orchestration retained
  for compatibility and focused collector tests.
- `formWorkflow.ts`: form parser, strict identity resolution, immutable
  actions, and safe patch planning.
- `runWorkflow.ts`: durable create/plan/approve/apply/recovery interface,
  checksum verification, fenced lease, checkpoints, receipts, expiry and
  deployment gate.
- `sourceCatalog.ts`: source list, create, quota, and idempotent seed interface.
- `src/models/GranotAutomationRun.ts`: durable run schema.
- `src/models/GranotAutomationSource.ts`: exact source-label catalog schema.
- `src/routes/granot-automation.routes.ts`: admin HTTP contract.
- `api/queues/granot-automation-consumer.ts`: production wake-up consumer.
- `components/ingestion/granot-automation-dashboard.tsx` in `vantage-admin`:
  owner interface and run review.
- `docs/granot-http-automation.md`: operator contract and environment setup.

## Required behavior

The owner must be able to:

1. Select Form Leads, Call Leads, or both Lead workflows.
2. Select all compatible Granot Automation Sources with one action.
3. Select any compatible subset.
4. Add a new exact Granot source and declare whether it supports Form Leads,
   Call Leads, or both.
5. Submit once.
6. Receive one distinct durable run per selected Lead workflow:
   - Form Lead run receives only selected sources supporting `form_leads`.
   - Call Lead run receives only selected sources supporting `call_leads`.
7. Review and approve each immutable plan independently.

If the owner selects both workflows and all sources, the initial catalog must
partition as follows:

### Form Lead sources

- `Best Relocation Forms`
- `Main Site Forms`
- `TBM Forms`
- `TBM Forms Prime`
- `Top10 Forms`

### Call Lead sources

- `10best Inbounds`
- `BestRelocation Inbounds`
- `TBM Prime Inbounds`
- `Top10 Inbounds`

The schema must allow one source to support both workflows in the future. Do
not infer compatibility from words such as `Forms` or `Inbounds` at runtime.

## Model changes

### `GranotAutomationSource`

Add a required `supported_operations` array:

```ts
supported_operations: {
  type: [String],
  enum: ["form_leads", "call_leads"],
  required: true,
  validate: {
    validator: (values: string[]) =>
      values.length >= 1 && values.length <= 2 &&
      new Set(values).size === values.length,
  },
}
```

Also add an index suitable for active compatibility queries:

```ts
{ active: 1, supported_operations: 1, label: 1 }
```

Keep `label` exact and case-sensitive. Keep the unsafe Unicode validation,
catalog quota, `created_from`, and non-public `created_by`.

Update `GranotAutomationSourceItem` and the admin API type to return
`supported_operations`.

### Source backfill

Update `scripts/granot-automation/seed-sources.ts` or add a dedicated migration
that sets `supported_operations` for all nine existing documents using the
explicit partition above.

The migration must:

- use exact labels as the lookup key;
- use `$set` for `supported_operations`, not only `$setOnInsert`, because the
  existing nine records are already present;
- remain idempotent;
- fail if a required seeded label is missing after the operation;
- print inserted, updated, unchanged, and missing counts;
- be run against `vantagemovers`, then verified with a direct read;
- never classify an unknown owner-created label by name.

Existing owner-created records without compatibility metadata must not become
selectable until the owner classifies them. During deployment, either make the
new field temporarily optional and backfill first, or deploy in this order:

1. tolerant read code;
2. backfill;
3. required schema validation.

### `GranotAutomationRun`

Do not add `"both"` to `operation`. Preserve:

```ts
operation: "form_leads" | "call_leads"
```

Add an optional indexed `run_group_id` string. Two runs created by one owner
submission share this value:

```ts
run_group_id: { type: String, trim: true, index: true, default: null }
```

Strengthen `request_snapshot` content without changing old records:

```ts
{
  dateWindow,
  sourceIds: string[],
  sourceLabels: string[], // immutable resolved exact labels
  filters,
}
```

`sourceLabels` remains necessary because an in-flight plan must not change if a
catalog source is later renamed, deactivated, or reclassified.

A separate parent collection is not required for the first implementation.
The two child runs are already independently durable; `run_group_id` provides
correlation without introducing a second status machine. Add a parent model
only if product requirements later require group-level cancellation, retries,
or a permanent aggregate history.

## Server interface changes

### Source catalog

Change source creation to require:

```json
{
  "label": "Example Exact Label",
  "supported_operations": ["form_leads"]
}
```

Allow `["form_leads", "call_leads"]`. Reject empty arrays, duplicates, unknown
values, inactive sources, and unsafe labels.

Support optional list filtering:

```http
GET /api/v1/admin/granot-automation/runs/sources?operation=form_leads
```

### Create one or both Lead workflows

Add an owner-only orchestration endpoint:

```http
POST /api/v1/admin/granot-automation/run-groups
```

Suggested request:

```json
{
  "operations": ["form_leads", "call_leads"],
  "workflow": "apply",
  "from": "08/01/2026",
  "to": "08/05/2026",
  "source_ids": ["..."],
  "filters": {
    "date_factor": "OPEN",
    "type": "ALL",
    "department": "",
    "state": "",
    "status": "10"
  }
}
```

Suggested response:

```json
{
  "run_group_id": "uuid",
  "runs": [
    {
      "run_id": "...",
      "operation": "form_leads",
      "source_labels": ["Best Relocation Forms", "Main Site Forms"]
    },
    {
      "run_id": "...",
      "operation": "call_leads",
      "source_labels": ["10best Inbounds", "Top10 Inbounds"]
    }
  ]
}
```

The orchestration module must:

1. Load all selected source IDs in one query.
2. Reject missing, inactive, duplicate, or unclassified IDs.
3. Partition selected sources by `supported_operations`.
4. For each requested operation, reject an empty partition with a precise
   validation issue.
5. Generate one `run_group_id`.
6. Create one durable run per requested operation with only compatible exact
   labels.
7. Publish a wake-up for each created run.
8. Return both run acknowledgements even though workers may execute
   sequentially due to the existing account lease.

Put this behind a small interface in `runWorkflow.ts`, for example:

```ts
createGranotRunGroup({
  operations,
  sourceIds,
  workflow,
  dateWindow,
  filters,
  initiator,
})
```

Callers must not partition labels themselves. Server-side partitioning keeps
catalog rules authoritative and prevents a stale or manipulated browser from
submitting a Call Lead source to the Form Lead planner.

Keep the existing single-run endpoint for backward compatibility and scripts.
Prefer extending it to accept `source_ids` and resolve them server-side; raw
`source_labels` should remain only as a compatibility path until all callers
are migrated.

### Atomicity and partial failure

Avoid implementing "Run both" as two unrelated browser requests. A lost
response can create an ambiguous partial result or duplicate one operation on
retry.

The server should validate both partitions before inserting either run. Create
both run documents together, then publish wake-ups. If queue publication fails,
the durable queued documents remain recoverable by the existing cron/worker.
The database insert is the durable boundary; queue publication is only a
wake-up.

Refactor the current `createGranotRun()` implementation so document creation
and wake-up publication can be reused safely by the group interface.

## Worker behavior

No combined worker is required.

Each child run follows the current worker path:

1. claim the account lease;
2. collect only its resolved `sourceLabels`;
3. branch on its single `operation`;
4. produce and checksum its immutable plan;
5. complete immediately for `preview`, or wait for approval for `apply`;
6. apply only selected approved actions;
7. persist independent receipts.

Because the lease scope is account-wide, two runs in one group may execute one
after another. This is acceptable and safer for the Granot session.

## Owner interface

Use progressive, explicit language. The page should not place one Form/Call
radio beside an undifferentiated mixed source list.

### Section 1: Lead workflows

Use two checkboxes, both selected by default:

- **Form Lead enrichment**
- **Call Lead enrichment and booked-call reconciliation**

Helper text:

> Selecting both creates two separate reviewable plans. Nothing is updated
> until you approve actions from each plan.

### Section 2: Granot sources

Group compatible sources under:

- **Form Lead sources**
- **Call Lead sources**

Provide:

- **Select all compatible sources**;
- **Clear all**;
- individual source checkboxes;
- selected counts per group;
- no hidden name-based filtering.

When both workflows are selected, "Select all" selects every active source in
both groups. When only one workflow is selected, show only that compatible
group or clearly disable the other group.

If one source supports both workflows, render it in both groups but keep one
catalog identity. The submitted `source_ids` array must be deduplicated.

### Section 3: Date window and run mode

Label `workflow` as **Run mode**:

- **Preview only**: creates plans and performs no writes.
- **Preview, then allow approved updates**: current `apply` mode; still requires
  checksum-bound owner approval.

The default may remain the current review-before-write `apply` behavior, but
the copy must not imply immediate updates.

### Add source

The inline create form must ask for:

- exact Granot label;
- **Used for Form Leads** checkbox;
- **Used for Call Leads** checkbox.

At least one compatibility checkbox is required. On success, invalidate the
catalog query and select the new source in each currently selected compatible
workflow.

### Submit and result

Use a dynamic submit label:

- `Create Form Lead plan`
- `Create Call Lead plan`
- `Create 2 durable plans`

After a two-run response, select the run group and show two distinct cards with
independent status, checksum, action selection, approval, errors, and receipts.
Never combine the two plans into one approval checkbox or checksum.

Run history should show `run_group_id` when present and offer
`View related run` for its sibling.

## Admin client changes

In `vantage-admin`:

- extend `GranotAutomationSource` with `supported_operations`;
- add `createGranotRunGroup`;
- add a run-group mutation and query-key scope;
- replace the single `operation` radio state with selected operation checkboxes;
- derive grouped source views from server metadata;
- submit source IDs, not labels;
- preserve server-provided action `syncable`;
- keep the Overview link owner-only;
- keep each child run's action and checksum state isolated by `run_id`.

Extracting a `GranotSourceSelector` module from
`granot-automation-dashboard.tsx` is recommended. Its interface should accept
catalog sources and selected operations and return selected source IDs. It
should not know how durable runs are created.

## Required tests

### Server

- source schema requires one or two unique supported operations;
- seed/backfill assigns the exact nine-source partition and is idempotent;
- source list filters by operation;
- source create rejects no compatibility selection;
- run-group creation with both operations creates two child runs;
- child runs share `run_group_id`;
- each child snapshot contains only compatible source IDs and labels;
- all validation completes before either child run is inserted;
- inactive, missing, duplicate, and unclassified IDs are rejected;
- one source supporting both operations appears in both child snapshots;
- queue publication failure leaves recoverable queued runs;
- existing single-run callers remain compatible;
- approval and receipts remain independent per child run.

### Admin

- both Lead workflows are selected by default;
- select-all chooses every compatible source;
- selecting one workflow excludes the other workflow's sources;
- a source supporting both appears in both visual groups but submits one ID;
- creating a source requires at least one supported operation;
- submitting both sends one run-group request;
- the two response runs maintain independent action selections and checksums;
- dynamic submit labels and explanatory copy match the selected operations;
- owner-only navigation remains hidden from admins.

## Safety invariants

- Operation is always explicit on each durable run: `form_leads` or
  `call_leads`.
- Call-lead modules receive only their existing row payloads; `ref_no` is not
  mapped or used by that path.
- Form exact identity is only `Granot ref_no === FormLead.ref_no`. Never add
  `_id`, `lid`, or `normalized_lid` interpretations.
- `duplicate: true` records remain quarantined.
- Plans are immutable after `plan_locked_at`; approval binds selected actions
  to the exact checksum.
- Apply requires `GRANOT_AUTOMATION_APPLY_ENABLED=true`, an unexpired plan,
  the fenced account lease, matching expected canonical values, and a receipt
  checkpoint per selected action.
- Form writes cross the canonical `updateFormLead` seam so booking refresh and
  sheet-sync effects remain intact. Call writes re-preview their target and
  approved change set immediately before sync and emit drift receipts when the
  binding changed.
- Persist only source IDs, resolved labels, parsed plan data, and summaries.
  Never persist provider HTML, cookies, session UUIDs, or credentials.
- Mongo TTL removes durable plans after seven days.
- Default run reads are redacted. Owner detail is opt-in with
  `?details=owner`.
- A group never shares approval or receipts across child runs.

## Implementation order

1. Add tolerant `supported_operations` reads and update source DTOs.
2. Backfill and directly verify the nine production source records.
3. Make `supported_operations` required for new/updated sources.
4. Add `run_group_id` and source IDs to durable run snapshots.
5. Implement server-side source resolution and `createGranotRunGroup`.
6. Add the owner-only run-group route and tests.
7. Update the admin API client and source creation contract.
8. Replace the mixed radio/list UI with workflow checkboxes and grouped sources.
9. Render and approve the two returned plans independently.
10. Run server tests, admin tests, typechecks, lint, and production build.

## Verification

```bash
pnpm test:granot
pnpm typecheck
```

In `vantage-admin`:

```bash
pnpm test
pnpm typecheck
pnpm lint
pnpm build
```

For endpoint examples and stable errors, see
`docs/granot-http-automation.md`.
