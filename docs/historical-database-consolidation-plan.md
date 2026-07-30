# Historical database consolidation and sheet-ingestion plan

Status: analysis and implementation design  
Generated from live read-only audits on 2026-07-30

Parsing, Customer-cardinality, classification, conflict-artifact, and planner
module details are resolved in the
[historical consolidation rules and staged-ingestion specification](./historical-consolidation-rules-and-staging-spec.md).

## Decision

Do not copy `vantagemovershistorical` wholesale into `vantagemovers`.

The safe path is:

1. Snapshot every named sheet into a deterministic staging representation.
2. Reconcile that staging representation into a production-parity historical
   model.
3. Build a complete, immutable merge manifest against the current production
   database.
4. Apply the manifest twice to `testvantagemovers`; the second application must
   produce zero inserts and zero material updates.
5. Apply the approved manifest to production without outbound Google Sheet
   sync, retaining a rollback journal and leaving the historical source intact.

The migration command imports underlying application service functions from
this branch and connects directly to the explicitly selected database. It does
not call the deployed production URL.

This is required because the current historical database is internally
consistent but not production-compatible: it has relaxed schemas, duplicate
booking identities, missing source/catalog references, no receiver-agent
attribution, and a known production overlap.

## Observed state

### Databases

| Entity | `vantagemovers` | `vantagemovershistorical` |
|---|---:|---:|
| Form leads | 3,822 | 10,223 |
| Call leads | 1,041 | 3,354 |
| Bookings | 468 | 4,769 |
| Cancellations | 11 | 365 |
| Customers | 652 | 4,535 |
| Agents | 20 | 48 |

Historical relationship integrity is good for relationships that already
exist:

- 1,185 bookings have lead links; none point to a missing or wrong-model lead.
- 4,728 bookings have customers; none point to a missing customer.
- 362 cancellations have booking links; none point to a missing booking.
- All 4,837 historical agent allocations point to an existing historical
  Agent.

Coverage is incomplete:

- 3,584 bookings are currently leadless.
- 3 cancellations are not connected to a booking.
- No historical lead has `receiver_agent`.
- Historical leads have no Operations Registry source-company/granularity
  references or snapshots.
- Historical BookedLead uses `customer_name_snapshot`; production uses
  `customer_name`.
- Historical bookings do not set `is_leadless_booking` or
  `is_referral_booking`.
- One historical booking (`Booked Deals` row 2782) has raw Book Date
  `7/20/0205` but submission timestamp `7/20/2025 16:23:32`. Normalize its
  Book Date to 2025-07-20 and record the correction in the manifest.

### Sheet inventory

| Workbook / tab | Rows | Earliest | Latest |
|---|---:|---|---|
| Top 10 / Forms | 1,150 | 2026-01-28 | 2026-05-21 |
| Top 10 / Calls | 270 | 2026-01-29 | 2026-05-20 |
| TBM / LeadsNew | 8,225 | 2024-07-28 | 2026-05-21 |
| TBM / Calls | 2,793 | 2024-07-28 | 2026-05-20 |
| TBM / Bad_Leads | 343 | 2024-07-28 | 2026-03-13 |
| TBM Primes / Leads | 2,074 | 2024-09-04 | 2026-07-30 |
| TBM Primes / Calls | 587 | 2024-09-05 | 2026-06-10 |
| TBM Primes / Bad_Leads | 42 | 2025-04-02 | 2025-07-23 |
| Best Relocation / Forms | 607 | 2025-08-21 | 2026-05-21 |
| Best Relocation / Calls | 227 | 2025-08-20 | 2026-05-21 |
| Best Relocation / Local Forms | 245 | 2026-04-07 | 2026-05-21 |
| Booked responses / Booked Deals | 4,769 | 2024-06-07 | 2026-05-13 |
| Booked responses / Refunds | 365 | 2024-06-20 | 2026-05-12 |

The current historical ingest exactly accounts for Top 10, TBM main tabs,
Best Relocation, Booked Deals, and Refunds. It omits:

- TBM `Bad_Leads`.
- TBM Primes `Leads`.
- Most TBM Primes `Calls`.
- TBM Primes `Bad_Leads`.

There are also 64 historical call rows from a prior
`tbm_prime_updated / Calls` import (38 attributed to `tbm_leads`, 26 to
`tbm_prime_leads`). The new planner must reconcile them by natural identity;
it must not insert them again merely because their source-row key differs.

### Known overlap

Current deterministic/tolerant matching finds:

| Entity | Historical | Unique production matches | Ambiguous | Unmatched |
|---|---:|---:|---:|---:|
| Form leads | 10,223 | 461 | 8 | 9,754 |
| Call leads | 3,354 | 102 | 4 | 3,248 |
| Bookings | 4,769 | 97 | 0 | 4,672 |
| Cancellations | 365 | 9 | 0 | 356 |

For historical form leads before 2026-04-30 there are no current production
matches. In the 2026-04-30 through 2026-05-25 window, 461 match uniquely and
8 are ambiguous.

Call overlap must be evaluated with raw sheet date/time and a timezone-tolerant
comparison. Exact UTC-minute comparison is insufficient because historical and
API import paths parsed the same displayed sheet times differently. Accepted
automatic matches require the same source company and normalized phone, plus
either the same source date or a unique candidate within the configured time
tolerance.

### Prior Best Relocation work

Best Relocation must not be blindly re-applied:

- A 1,193-item plan was applied to production on 2026-07-24:
  850 forms, 227 calls, 104 collapsed bookings, and 12 cancellations.
- A subsequent production correction moved the pre-2026-04-30 Best Relocation
  scope back into historical:
  651 forms, 205 calls, 72 bookings, and 6 cancellations.
- That move reused the already-ingested historical entities and removed the
  corresponding Master Sheet rows.

The consolidation planner must treat these journals as completed history and
match their surviving post-cutoff production records, not replay their API
plan.

## Canonical identities

Every staged row has immutable provenance:

```text
spreadsheet_id + tab_name + physical_row + row_checksum
```

That provenance is not, by itself, entity identity because rows can move
between tabs or be re-sorted.

### Form lead

Resolve in this order:

1. `source_company + normalized_lid`, only when the key has one candidate.
2. `source_company + normalized_ref_no`, only when the key has one candidate.
3. `source_company + normalized_phone + raw sheet timestamp`, only when unique.
4. Otherwise use the source-row identity and mark the record as
   `identity_fallback`.

If a natural key has multiple candidates, do not pick the newest record. Emit
an ambiguity case for review.

### Call lead

Resolve in this order:

1. `source_company + normalized_job_no`, if a job number exists.
2. `source_company + normalized_phone + raw sheet date/time`.
3. For existing production overlap only:
   `source_company + normalized_phone + raw sheet date`, if unique.
4. A bounded time-tolerance match, only if the candidate is unique.

A row with neither phone nor job number cannot satisfy the production
CallLead invariant and goes to quarantine.

### Booking

`normalized_job_no` is the canonical identity. Production has a unique partial
index on this field.

The Booked Deals source has 4,769 rows but only 4,599 distinct normalized job
numbers. The 165 duplicate job groups contain 170 rows beyond the first.
Before creating a booking:

1. Group every source row by normalized job number.
2. Require book date, customer, merchant, source, and deposit to be compatible.
3. Collapse exact resubmissions.
4. Merge distinct sales agents into `agent_allocations`.
5. Sum per-row binder amounts and keep the maximum repeated deposit, matching
   the already-tested Best Relocation behavior.
6. Quarantine any group with conflicting non-agent facts.

If production already has the job number, enrich only allowed missing fields
and connect relationships; never create another booking.

### Cancellation

Resolve the target booking by normalized job number, then use:

```text
booking_id + refund_request_date + normalized_agent
```

as the cancellation import identity. A cancellation cannot be applied until
its booking has been resolved. The 3 currently unlinked historical
cancellations remain quarantined unless a unique booking match is found.

### Customer

Do not globally merge customers by name alone.

Resolution order:

1. Reuse the production booking's customer for an existing booking.
2. Reuse the matched lead's customer/contact identity when phone or email is
   available.
3. For name-only historical bookings, key the customer to the canonical job
   number so two unrelated customers with the same name cannot collapse.

### Catalog identities

- Agent: normalized production name or configured alias.
- Merchant: normalized production name or configured alias.
- Source company: existing Operations Registry company/alias, otherwise a
  deterministic inactive historical company and exact-label granularity.

Explicit merchant alias:

```text
Elavon CC -> Elavon
```

No other semantic merchant alias is assumed. Unmatched merchant labels are
created inactive, as requested. Candidate aliases such as `Cardpointe CC`,
`Maverick CC`, `Paper Check WF`, `EMS CC`, and `Wire Transfer` remain visible
in the manifest for Owner review.

Historical agent suffixes that encode allocation metadata (`Split`, `40%`,
and similar terminal percentages) must be removed before Agent lookup. Missing
canonical agents are created inactive. Existing production agents retain their
current active status and identifiers.

## Bad_Leads policy

`Bad_Leads` is a form-lead disposition surface, not a CallLead source.

### TBM

- 343 Bad_Leads rows.
- 115 match `LeadsNew` uniquely by Lead ID.
- 8 more match uniquely by normalized phone.
- 220 are orphan form leads and need to be ingested.
- 146 rows have no manual background color.
- 22 rows have mixed color signatures.

### TBM Primes

- 42 Bad_Leads rows.
- 40 are orphan form leads.
- 2 have ambiguous phone matches and require review.
- Red/white formatting is present, but there is no documented color-to-reason
  legend.

Rules:

1. Match a bad row to the main form tab by unique Lead ID, then unique phone.
2. A match annotates the existing form lead; it does not create another lead.
3. An orphan creates one FormLead with its own deterministic identity.
4. Ignore stale copied values in unheaded column J; they are not booking truth.
5. Never create a CallLead from Bad_Leads.
6. Never infer a specific reason from cell color.
7. If the lead is already duplicate, booked, or cancelled, preserve that
   higher-priority state and record the historical bad-tab provenance only.

The production enum needs a lossless value such as `legacy_bad_tab` before
these rows can be represented with model parity. Mapping all rows to one of the
four current specific reasons would invent data.

## Production-parity normalization

Before the merge manifest is built, historical documents must have the fields
and invariants required by the production models.

### Duplicate and Form Fill classification boundary

Form Lead duplicate classification has two non-overlapping cohorts, using the
authoritative business timestamp:

```text
historical: timestamp < 2026-04-30 00:00 America/New_York
modern:     timestamp >= 2026-04-30 00:00 America/New_York
```

Historical Form Leads compare only with earlier historical Form Leads. Modern
Form Leads compare only with modern Form Leads. Both comparisons require the
same exact Source Granularity and normalized phone or normalized email; a
Source Company-only match is not sufficient.

Matched modern production Form Leads preserve their stored `duplicate` value.
Only unmatched modern records are classified, using the same underlying
application rule as ordinary ingestion with the modern-cohort floor enforced.
Pre-cutoff records imported by consolidation must remain ineligible as
duplicate anchors for existing and future modern Form Leads.

Form Fill remains time-unbounded: a Call Lead may match a non-duplicate Form
Lead across the cutoff. Form Fill is derived after Form Duplicate Lead
classification and production-overlap collapse.

The current branch helpers still match duplicates at Source Company/
`lead_source_company` scope. Before implementation, the shared application
classifier must require `source_granularity_id` or one uniquely resolved exact
legacy granularity and fail closed when granularity is unresolved. Historical
scripts import this classifier locally rather than duplicating it or calling an
HTTP endpoint.

### Leads

- Canonical production `source_company` slug.
- `lead_source_company`, `source_granularity_id`, key, and label snapshots.
- Required form fields normalized to production enums/defaults.
- `normalized_lid`, `normalized_phone_number`, and
  `normalized_contact_name`.
- Source timestamps from the sheet.
- `createdAt` set to the source event timestamp for imported domain entities;
  `updatedAt` records the normalization/import time.
- A malformed event year may borrow the year from the same row's valid
  submission timestamp only when month/day agree; otherwise quarantine it.
- No CRM posting for historical form imports.
- Empty `sheet_sync` metadata; imports do not claim current Master Sheet rows.

### Bookings

- `customer_name` populated from the historical snapshot.
- `is_referral_booking=true` only for explicit Referral bookings.
- `is_leadless_booking=true` when no accepted lead connection exists.
- Production-valid agent allocations and money fields.
- Canonical merchant/source strings.
- Unique normalized job number after duplicate collapse.

### Cancellations

- Required booking link and cancel date.
- Customer and lead chain mirrored from the resolved booking.
- Refund amount taken from the refund/deposit fields, never parsed from free
  text status.

### Receiver agents

For a lead connected to a booking:

1. If `receiver_agent` already exists, do not overwrite it.
2. Otherwise use the first canonical sales Agent allocation from the booking.
3. Store the Agent reference, name snapshot, source `manual`, source value
   `historical_booking_sales_agent`, and the import timestamp.

This applies only after the booking-to-lead match is accepted.

### Operations Registry

Historical leads should reference the same catalog ObjectIds that will exist
in production. Existing production entities are reused. Newly required
Agents, Merchants, LeadSourceCompanies, and granularities are created inactive
in the test/production target and copied with those same identifiers into the
historical parity surface when needed.

No existing active entity is deactivated by this migration.

## Merge precedence

| Field class | Rule |
|---|---|
| Lead event timestamp | Sheet/source timestamp is authoritative for the matched lead |
| Matched production Form Lead on/after 2026-04-30 | Preserve stored `duplicate`; never reclassify from imported history |
| Form Lead duplicate candidate | Same cutoff cohort and exact Source Granularity only |
| Existing production receiver agent | Preserve; never overwrite |
| Existing active catalog record | Preserve status and identity |
| Empty production scalar | Historical may fill when match is unique |
| Conflicting non-empty scalar | Preserve production and emit reconciliation case |
| Missing relationship | Fill only from an accepted unique chain |
| Existing valid relationship | Preserve |
| Broken relationship | Repair only when the manifest names one unique target |
| Bad-lead state on booked/cancelled/duplicate lead | Preserve higher-priority state; provenance only |
| Sheet sync metadata | Do not copy historical row numbers into production |

## Idempotency registry and manifest

Use a dedicated `historical_import_registry` rather than relying on mutable
sheet row numbers or extra unmodeled fields on domain documents.

Each registry record has:

- `migration_key` (unique).
- Entity model.
- Source workbook/tab/row provenance array.
- Natural identity and confidence/method.
- Source row checksum.
- Historical entity id.
- Production entity id after apply.
- Status: staged, quarantined, planned_insert, planned_update, applied,
  verified, or rolled_back.
- Manifest id and timestamps.

The generated manifest is immutable and SHA-256 addressed. It contains:

- Exact inserts and field-level updates.
- Expected preconditions for every update.
- Old values for rollback.
- Old-to-new ObjectId mappings.
- Catalog creations.
- Relationship operations.
- Quarantine cases and reasons.
- Expected before/after counts.

Changing source data produces a new manifest; it does not silently mutate an
approved manifest.

## Execution stages

### 0. Freeze and backup

- Record sheet revision metadata and input checksums.
- Snapshot the relevant production and historical collections.
- Record all indexes.
- Require zero live migration processes.

### 1. Stage sheets

- Read all named tabs, including TBM Primes and both Bad_Leads tabs.
- Store raw values plus provenance/checksum in staging.
- No domain writes.

### 2. Normalize historical parity

- Reconcile staged rows with existing historical records using the canonical
  identities.
- Add missing TBM/TBM Primes bad rows and TBM Primes leads/calls.
- Quarantine invalid/ambiguous rows.
- Collapse booking duplicates.
- Classify historical Form Lead duplicates only within the pre-cutoff cohort
  and exact Source Granularity.
- Preserve matched post-cutoff production duplicate outcomes; classify only
  unmatched post-cutoff records against the post-cutoff cohort.
- Derive Form Fill without a time boundary after duplicate classification.
- Add catalog/source references and receiver-agent fallbacks.
- Validate with production Mongoose schemas without sheet or CRM side effects.

### 3. Build merge manifest

- Compare normalized historical entities to live production.
- Classify every entity as insert, safe fill, already present, conflict, or
  quarantine.
- Produce aggregate and record-level review artifacts.
- Do not write either database.

### 4. Rehearse on `testvantagemovers`

- Restore a fresh production snapshot into the test database.
- Apply the manifest transactionally with outbound integrations disabled.
- Verify counts, unique indexes, relationships, timestamps, and catalogs.
- Apply the same manifest a second time.
- Acceptance: second apply has zero inserts, zero relationship changes, and
  zero material scalar updates.

### 5. Production apply

- Require the manifest hash, explicit production confirmation, and a fresh
  preflight proving expected counts/checksums still match.
- Run the reviewed branch's underlying application service functions locally;
  do not call the deployed production URL.
- Create inactive missing catalogs first.
- Insert customers/leads, then collapsed bookings, then cancellations.
- Apply relationship mirrors last.
- Use bounded transactions and a durable migration journal.
- Do not delete historical source records.
- Do not enqueue Master Sheet sync for pre-2026-04-30 records.
- Post-cutoff records absent from production are reported separately; any
  Master Sheet backfill requires an explicit second approval.

### 6. Verify and close

- All relationship targets exist and have the correct model.
- Production normalized job numbers remain unique.
- No source natural identity was inserted twice.
- Existing receiver agents and active catalog states are unchanged.
- Sheet timestamps equal database event timestamps.
- Manifest applied count equals verified registry count.
- A fresh dry run is a no-op.

## Rollback

- Inserts: delete only ids created by the manifest, in reverse dependency
  order.
- Updates: restore field-level before-images only when the current value still
  equals the manifest-applied value.
- Catalog records: deactivate migration-created entries rather than hard
  delete if any non-migration reference exists.
- Historical/staging data is never deleted.
- Rollback itself is journaled and idempotent.

## Blocking review cases

The apply script must refuse production while any of these remain unresolved:

- The year-0205 booking correction is absent from the manifest or does not
  resolve to 2025-07-20.
- Two ambiguous TBM Primes Bad_Leads phone matches.
- Any call row with neither a phone nor job number.
- Any duplicate booking group with conflicting non-agent facts.
- Any ambiguous production identity match.
- Any Form Lead duplicate match that crosses the 2026-04-30 cutoff.
- Any Duplicate Lead match that does not have one exact Source Granularity.
- Any manifest operation that changes `duplicate` on a matched production Form
  Lead at or after 2026-04-30.
- A specific bad-lead reason mapping without the new lossless
  `legacy_bad_tab` value.
- Manifest preconditions that no longer match current production.

## Reports and rerunnable audits

- `scripts/historical/audit-consolidation-sheets.ts`
- `scripts/historical/audit-consolidation-databases.ts`
- `scripts/historical/audit-bad-leads-tabs.ts`
- `scripts/historical/audit-historical-name-patterns.ts`
- `scripts/historical/audit-historical-classification-signals.ts`
- `scripts/historical/reports/sheet-audit.md`
- `scripts/historical/reports/database-audit.md`
- `scripts/historical/reports/bad-leads-audit.md`
- `scripts/historical/reports/name-pattern-audit.md`
- `scripts/historical/reports/classification-signal-audit.md`

All current audit scripts are read-only and emit aggregate reports without
customer row values.
