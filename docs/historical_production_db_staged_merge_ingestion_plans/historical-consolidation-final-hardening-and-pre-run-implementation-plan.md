# Historical consolidation final hardening and pre-run implementation plan

Status: canonical pre-implementation handoff; production apply is blocked  
Prepared: 2026-07-31  
Scope: local staged ingestion from historical Sheets and Mongo evidence into
`vantagemovers`, rehearsed first against `testvantagemovers`

## Purpose

This is the final hardening delta and implementation handoff for the historical
production database consolidation. It does not replace the detailed identity,
parsing, classification, or conflict decisions already recorded. It explains
what must be built and proven before any production ingestion can run.

A fresh agent should read this document first, then the companion documents in
this order:

1. [Historical database consolidation plan](./historical-database-consolidation-plan.md)
2. [Rules and staged-ingestion specification](./historical-consolidation-rules-and-staging-spec.md)
3. [Lead and Customer naming strategy](./historical-consolidation-lead-customer-naming.md)
4. [Previous analysis handoff](./historical-consolidation-next-analysis-handoff.md)

The earlier documents contain the accepted business rules. This document adds
the missing operational, module, safety, side-effect, idempotency, and
verification requirements discovered by reviewing the current implementation.

## Executive decision

The historical-first strategy is approved with one important refinement:

> Use `vantagemovershistorical` as the staging host, but do not rewrite its
> existing relaxed domain collections into pretend-production records.

The current `form_leads`, `call_leads`, `booked_leads`, `cancelled_leads`,
`customers`, and `agents` collections in `vantagemovershistorical` remain
source evidence. New immutable sidecar collections hold raw snapshots, parsed
candidates, canonical production-parity entities, conflict evidence, and plan
metadata. The production/test target holds its own atomic import registry,
apply journal, and migration lock.

No existing write-capable historical script is approved for production use.
The new implementation starts in:

- `scripts/historical_production_db_staged_merge_ingestion/`

Application-owned rules and exact-operation writes belong in a deep module
under `src/services/historicalConsolidation/`; command adapters belong in the
new scripts directory.

## Authoritative source inventory

### Google Sheets

These are the exact spreadsheets represented by the most recent
`sheet-audit.json` report. Spreadsheet IDs are identifiers, not credentials.

| Workbook | Spreadsheet ID | Required tabs in scope |
|---|---|---|
| TBM Leads | `1yR9xsnSfdniod2bdmb03HdvXAfI1U3i0nh1t5fHGnLU` | `LeadsNew`, `Calls`, `Bad_Leads` |
| TBM Prime | `1sDXK2-R8WhIloeNOoXCW4-BmdskWqHLQVWziPesbW00` | `Leads`, `Calls`, `Bad_Leads` |
| Best Relocation | `13mp2vRyVKerAWBFfRvmEMjftDJE_QIbf14pzdKxsODg` | `Forms`, `Calls`, `Local Forms`, and any populated configured local-call surface |
| Top 10 | `1aZavJvIt9RGHOsE1mlcTGlIHdW0yCk7MsAy5MGLaYhQ` | `Forms`, `Calls` |
| Booked Deal Form Responses | `1M5fzPdvtbj9LvcaXxE_qdHBJcOdhmtNfhZlv13hgaXk` | `Booked Deals`, `Refunds` |

The snapshot implementation must use this explicit inventory as a versioned
input. It must not infer the set of workbooks from whichever environment
variables happen to be present.

### Mongo databases

| Database | Role | Write policy before approved apply |
|---|---|---|
| `vantagemovershistorical` | Existing historical evidence plus new staging sidecars | Existing domain collections are read-only; only new versioned staging collections may be written |
| `vantagemovers` | Live production target and production-overlap evidence | Read-only during snapshot/planning; write only through an approved manifest apply |
| `testvantagemovers` | Rehearsal target restored from a fresh production snapshot | May be written only by an explicitly selected rehearsal apply |

Do not expose or record the Mongo URI. Every command must verify the connected
database name from the live Mongo connection rather than trusting an
environment label.

## Audit and report provenance

The current reports were generated on 2026-07-30 and are evidence, not a frozen
input for a later apply. They must be rerun from a newly frozen source snapshot
before planning.

| Report | Generator | Coverage notes |
|---|---|---|
| [`sheet-audit.json`](../../scripts/historical/reports/sheet-audit.json) and [`sheet-audit.md`](../../scripts/historical/reports/sheet-audit.md) | [`audit-consolidation-sheets.ts`](../../scripts/historical/audit-consolidation-sheets.ts) | Contains all five spreadsheet IDs and the audited tab inventory |
| [`database-audit.json`](../../scripts/historical/reports/database-audit.json) and [`database-audit.md`](../../scripts/historical/reports/database-audit.md) | [`audit-consolidation-databases.ts`](../../scripts/historical/audit-consolidation-databases.ts) | Reads `vantagemovers` and `vantagemovershistorical`; records overlap, coverage, relationships, catalogs, and anomalies |
| [`bad-leads-audit.json`](../../scripts/historical/reports/bad-leads-audit.json) and [`bad-leads-audit.md`](../../scripts/historical/reports/bad-leads-audit.md) | [`audit-bad-leads-tabs.ts`](../../scripts/historical/audit-bad-leads-tabs.ts) | Covers TBM and TBM Prime `Bad_Leads`, including ambiguous and orphan rows |
| [`name-pattern-audit.json`](../../scripts/historical/reports/name-pattern-audit.json) and [`name-pattern-audit.md`](../../scripts/historical/reports/name-pattern-audit.md) | [`audit-historical-name-patterns.ts`](../../scripts/historical/audit-historical-name-patterns.ts) | Covers Agent and Customer separator/metadata signals in Booked Deals and Refunds |
| [`classification-signal-audit.json`](../../scripts/historical/reports/classification-signal-audit.json) and [`classification-signal-audit.md`](../../scripts/historical/reports/classification-signal-audit.md) | [`audit-historical-classification-signals.ts`](../../scripts/historical/audit-historical-classification-signals.ts) | Compares Sheet Form Fill signals with normalized-phone intersections; Sheet values are non-authoritative |

The package currently exposes only the first three audits as `historical:*`
commands. The name-pattern and classification audits are run directly with
`tsx` as documented in the rules specification.

### How the audit scripts select Sheets

- `audit-consolidation-sheets.ts` embeds the Top 10, TBM, TBM Prime, and Best
  Relocation IDs and reads the Booked workbook from
  `BACKFILL_BOOKED_SHEET_ID`.
- `audit-bad-leads-tabs.ts` embeds the TBM and TBM Prime IDs.
- `audit-historical-classification-signals.ts` embeds the four lead workbook
  IDs.
- `audit-historical-name-patterns.ts` reads the Booked workbook through
  `BACKFILL_BOOKED_SHEET_ID`.
- `sheet-audit.json` confirms that the Booked report was produced from
  `1M5fzPdvtbj9LvcaXxE_qdHBJcOdhmtNfhZlv13hgaXk`.

This mixed hardcoded/env behavior is acceptable for provenance but not for the
new planner. The new snapshot command must read one checked-in, versioned
inventory structure and record its checksum.

## Legacy scripts: evidence only

The following scripts may be read to understand prior behavior, but must not
become the new pipeline:

- [`ingest-historical-sheets.ts`](../../scripts/historical/ingest-historical-sheets.ts)
- [`reconcile-historical-leads.ts`](../../scripts/historical/reconcile-historical-leads.ts)
- [`repair-historical-agent-allocations.ts`](../../scripts/historical/repair-historical-agent-allocations.ts)
- [`migrate-best-relocation-pre-cutoff.ts`](../../scripts/historical/migrate-best-relocation-pre-cutoff.ts)

The old importer is particularly unsafe for this job because it performs
row-by-row upserts, uses mutable row position as identity, creates Agents and
Customers while reading, globally matches name-only Customers, uses permissive
date/money parsing, omits TBM Prime and both Bad_Leads sources, and can trigger
deferred reconciliation automatically.

Best Relocation's completed 2026-07-24 apply/correction is historical evidence
and must be matched, never replayed.

## Required architecture

### Staging sidecars

Create versioned collections in `vantagemovershistorical` with names that
cannot be confused with relaxed historical domain collections. Recommended
shape:

```text
historical_stage_runs
historical_stage_raw_rows
historical_stage_parsed_candidates
historical_stage_canonical_entities
historical_stage_conflict_cases
historical_stage_decision_bundles
historical_stage_manifests
```

Each document includes `stage_run_id`, schema version, rule version, source
snapshot hash, and immutable creation metadata. Approved stage runs are never
updated in place. Changed Sheets, databases, aliases, decisions, rules, or code
produce a new run.

Do not copy production catalog documents into the existing historical catalog
collections merely to make Mongoose `ref` population work. Capture an
immutable catalog snapshot as planning input and store canonical production
ObjectIds in parity candidates. References are verified explicitly.

### Target-local operational collections

Create these in each apply target so journal state can commit in the same
transaction as domain mutations:

```text
historical_import_registry
historical_import_apply_journal
historical_import_locks
```

The registry owns stable source-to-target identity mappings. The journal owns
operation and batch state. The lock prevents concurrent applies. These are not
Sheet-row metadata fields on domain documents.

### Deep module seam

The application-owned module should expose a small interface such as:

```ts
buildHistoricalManifest(snapshot, rules, decisions): HistoricalManifest
applyHistoricalManifest(manifest, target, migrationContext): ApplyResult
verifyHistoricalManifest(manifest, target): VerificationResult
rollbackHistoricalManifest(manifest, target, migrationContext): RollbackResult
```

The implementation owns parsing, exact normalization, canonical identity,
classification, precedence, conflict generation, deterministic ObjectIds,
preconditions, schema validation, batching, journaling, verification, and
rollback safety.

CLI adapters under
`scripts/historical_production_db_staged_merge_ingestion/` may select inputs,
connect adapters, and write artifacts. They may not reimplement business
rules, reinterpret an approved manifest, or call deployed HTTP endpoints.

## Mandatory hardening before planning

### 1. True immutable Sheet snapshots

The current shared Sheet reader returns only `FORMATTED_VALUE`, silently caps
reads at 10,000 rows, and does not prove that a workbook remained unchanged
while multiple tabs were read. The new snapshot adapter must:

1. Record the explicit workbook inventory and checksum.
2. Capture Drive/Sheet revision or version metadata before and after reading.
3. Reject and retry when the workbook changes during capture.
4. Read every populated row without a silent maximum; paginate where needed.
5. Capture formatted values, unformatted values, formulas, and the formatting
   evidence required for Bad_Leads analysis.
6. Capture spreadsheet ID, title, tab ID, tab name, header row, A1 range, grid
   dimensions, physical row number, and row checksum.
7. Reject unexpected, missing, or duplicate headers rather than overwriting
   fields in a map.
8. Write the snapshot once and hash a canonical byte representation.
9. Store raw PII only in access-controlled staging; aggregate reports and logs
   remain redacted.

Planning and apply must read the frozen snapshot, never live Sheets.

### 2. Strict parsing and normalization

Implement the parser-result design in the rules specification. Current helpers
are insufficient. Required behavior includes:

- NFKC normalization, trimming, internal-whitespace collapse, and case folding
  from one shared implementation.
- Agent split on `/` only after recognized terminal `Split` or percentage
  metadata is removed.
- Repeated, leading, or trailing separators produce ambiguity rather than
  silently dropping empty tokens.
- Customer display text is preserved and never split into multiple Customers.
- The accepted Lead-name primary-selection rule is applied independently of
  Customer identity and retains the full raw value as provenance.
- Money is parsed into integer cents. Blank, negative, non-finite, malformed,
  or over-precision values are rejected or quarantined; blank is never zero.
- Calendar dates and business timestamps use explicit America/New_York rules,
  strict accepted formats, DST fixtures, and deterministic malformed-year
  correction evidence.
- The known `7/20/0205` Book Date correction must resolve to 2025-07-20 and be
  present in every applicable manifest.

### 3. Production-parity field mapping

Write a checked-in field matrix for every source entity and every production
field. It must define source, normalization, default authority, requiredness,
conflict policy, and quarantine policy for at least:

- Source Company ObjectId, Source Granularity ObjectId/key, and label snapshots.
- `duplicate`, `form_fill`, CPL values/status/rate-period references.
- `receiver_agent` and all receiver provenance fields.
- Lead normalized identifiers and required production enums/defaults.
- `customer_name_snapshot` to production `customer_name`.
- `is_leadless_booking`, `is_referral_booking`, allocation money, merchant,
  source, and normalized Job Number.
- Cancellation booking/customer/lead chain and required refund/cancel fields.
- `createdAt`, `updatedAt`, event timestamps, and Sheet Sync metadata.

Validate resulting documents through production Mongoose schemas using a fixed
planning timestamp. After validation/default hooks run, compare the serialized
document with the planned document and fail if unplanned values appeared.

### 4. Source Company and Source Granularity mapping

Create one explicit, versioned mapping table for every workbook/tab/channel and
every accepted legacy label. Exact Source Granularity is required for duplicate
classification. Source Company-only resolution is insufficient.

Unresolved mappings fail closed. Do not create semantic aliases or infer
channel/local meaning from a label unless that mapping is an explicit reviewed
input. Missing catalog records are planned as inactive operations.

### 5. Runtime duplicate and Form Fill correction

The current runtime implementation is not compliant with the accepted rules.
Before historical records enter production:

- Form duplicate classification must use exact Source Granularity, the
  authoritative event timestamp, and the hard 2026-04-30 America/New_York
  cohort boundary.
- Existing matched modern production Form Leads retain their stored result.
- Future modern Form Leads must never use imported pre-cutoff records as
  duplicate anchors.
- Call duplicates use exact Source Granularity and only earlier non-duplicate
  calls within the inclusive 90-day window. The current symmetric past/future
  lookup must be replaced.
- Form Fill remains time-unbounded, Source Company-scoped, and derived only
  after Form duplicate classification and overlap collapse.
- Candidate limits must not make classification or evidence incomplete.
- Pure rule functions accept injected repositories/snapshots and return
  evidence; they do not write, log PII, or enqueue work.

The same application-owned rule module serves runtime ingestion and historical
planning with explicit policy inputs. Historical scripts must not fork a second
implementation.

### 6. Customer identity and idempotency

Do not call the current global name-only Customer upsert for historical
bookings.

Resolution order remains:

1. Existing production booking Customer.
2. Accepted matched-lead Customer/contact identity when phone or email is
   present and unique.
3. New name-only migration Customer scoped through canonical Job Number.

For case 3, the manifest preallocates a deterministic ObjectId and records the
Job Number/source mapping in the target import registry. The second apply finds
that exact ID/mapping and is a no-op. A coincidentally identical Customer name
does not cause a merge.

### 7. Catalog creation and audit

Agent, Merchant, Source Company, and Source Granularity planning must use exact
normalized names/keys plus versioned explicit aliases. The confirmed Merchant
alias remains only `Elavon CC -> Elavon` unless a reviewed decision adds more.

Missing catalog records are created inactive. Registry mutations require an
approved Owner migration actor and their required audit record in the same
transaction. Existing active state is never changed.

Ordinary booking services currently require an active Merchant, so the
historical apply cannot use them unchanged. The migration apply module must
accept manifest-pinned catalog IDs/names, including migration-created inactive
records, without re-resolving or activating them.

### 8. Receiver Agent attribution

After an accepted booking-to-lead link:

- Preserve every existing receiver Agent.
- When absent, use the first canonical sales allocation.
- Store `receiver_agent_source="manual"`.
- Store `receiver_agent_source_value="historical_booking_sales_agent"`.
- Store the canonical Agent reference/name snapshot and manifest apply time.

The existing helper that hardcodes `best_relocation_sheet` is not suitable for
this migration and must not be reused unchanged.

### 9. Lossless Bad_Leads representation

Add `legacy_bad_tab` to the production domain before planning Bad_Leads writes.
Update the production model enum, Zod validation, Sheet/admin display mapping,
filters/exports, and tests. It must mean only that the source row appeared on a
legacy bad-lead surface without a trustworthy specific reason.

Never derive a specific reason from color. Booked, cancelled, or duplicate
state retains precedence while Bad_Leads provenance remains recorded.

### 10. Migration context and side-effect suppression

`SHEET_SYNC_MODE=disabled` alone is not an adequate migration context. In the
current coordinator, disabled mode also means ordinary writes do not
automatically receive a transaction. Queued mode provides a transaction but
persists outbox jobs.

Implement an explicit migration context that:

- Forces bounded Mongo transactions.
- Suppresses Sheet Sync intents and queue publication.
- Suppresses Granot CRM posting.
- Suppresses lead-message intent and Twilio dispatch.
- Suppresses email/notification dispatch.
- Suppresses ordinary observability collection writes for each imported row;
  migration-level redacted journal events are sufficient.
- Prevents geocoding or other enrichment network calls.
- Uses a fixed apply timestamp where the manifest requires deterministic
  provenance.
- Cannot be enabled by a normal HTTP request.

The exact-operation applier must not call CRUD functions that recalculate
duplicate status, CPL, Customer identity, catalog resolution, timestamps, or
relationships after manifest approval.

## Immutable manifest requirements

Use canonical stable JSON and SHA-256. The manifest envelope includes:

- Manifest/schema/rule versions and Git commit SHA.
- Source inventory checksum and every Sheet snapshot hash.
- Historical and production snapshot identifiers/checksums.
- Target database name and target cluster identity/fingerprint.
- Catalog/alias/CPL policy snapshot hashes.
- Decision-bundle hash.
- Fixed planning timestamp.
- Expected indexes and before/after aggregate counts.
- Exact ordered operations with deterministic operation IDs.
- Deterministic ObjectId mappings.
- Field-level before-images and compare-and-swap preconditions.
- Relationship operations and dependency order.
- Complete quarantine and conflict summaries.
- Rollback instructions for every operation.

Manifest approval must name the exact SHA-256. Apply must refuse a manifest if
its bytes, evidence hashes, rule version, decisions, code SHA, target
preconditions, database identity, or required indexes have changed.

The applier may not read Sheets, fuzzy-match, select among candidates,
reinterpret names, recalculate classifications, or add operations.

## Conflict evidence and decisions

Keep generated evidence separate from human decisions as already specified.
Strengthen the workflow with strict schemas and reconciliation checks:

- Every source row ends in exactly one terminal planning state.
- Aggregate conflict counts equal record-level case counts.
- Decisions reference expected evidence hash and allowed candidate IDs.
- Stale or unknown cases fail closed.
- Raw-value evidence remains access-controlled; aggregate reports are redacted.
- `decided_by` identifies the authorized reviewer; rationale is required.
- The decision bundle is immutable and hash-addressed once approved.

Production remains blocked by ambiguous production identity matches,
conflicting booking facts, unresolved source granularities, the two ambiguous
TBM Prime Bad_Leads cases, invalid required Call Lead identity, cross-cutoff or
cross-granularity duplicate results, and any other blocking case named in the
companion plan.

Quarantine is a valid terminal staging result but is not equivalent to
"everything successfully ingested." Any record intentionally left quarantined
must be explicitly reported and approved.

## Apply registry, journal, lock, and batching

### Registry

Each target registry record includes:

- Unique migration key and operation ID.
- Manifest hash and entity model.
- All source provenance/checksums.
- Canonical natural identity and resolution method.
- Historical/staging entity IDs.
- Exact target entity ID.
- State and state revision.
- Applied and verified timestamps.

State transitions are validated. A domain write and its registry transition
commit in the same transaction.

### Journal

Journal every batch attempt, transaction retry, operation result, verification
result, and rollback transition. The journal must distinguish planned,
committed, already-applied, conflicted, failed, verified, and rolled-back
operations.

### Lock

Acquire one target-local migration lease with owner, manifest hash, expiry,
heartbeat, and fencing token. Refuse to start if another live lease exists.
Every batch verifies the fencing token before commit.

### Bounded transactions

Use deterministic dependency order and bounded batches:

1. Inactive catalog records.
2. Customers.
3. Form and Call Leads.
4. Bookings.
5. Cancellations.
6. Relationship mirrors and receiver attribution.

Each operation uses deterministic IDs and compare-and-swap filters. Mongo
transaction retries are safe because the callback has no external effects and
every insert/update is idempotent.

## Target and production safety gates

Every apply command is dry-run by default and must reuse or strengthen the
existing Operations Registry migration guards.

### Rehearsal authorization

Require all of:

- Explicit `--apply`.
- Connected database is exactly `testvantagemovers`.
- Fresh production snapshot/restore metadata matches the manifest baseline.
- Outbound integrations are disabled by migration context.
- No API, queue drainer, cron, or other migration process is active against the
  rehearsal database.

### Production authorization

Require all of:

- `--apply` and a separate production-apply flag.
- Exact connected database `vantagemovers`.
- Explicit database-name confirmation.
- Reviewed manifest path and exact manifest SHA confirmation.
- Git SHA equals the reviewed build.
- Fresh source and target preflight checksums match.
- Verified backup identifier and restore test evidence.
- Zero unresolved blocking cases.
- Successful two-apply rehearsal from a fresh production snapshot.
- Explicit human production confirmation immediately before mutation.

The local `.env` previously selected live `vantagemovers` with queued Sheet
Sync. Never treat that environment as safe merely because the command runs
locally. Target selection is an explicit command input verified against the
live connection.

## Rehearsal, verification, and rollback

### Rehearsal

1. Stop processes that could write or drain copied jobs.
2. Restore a fresh production snapshot into `testvantagemovers`, including
   indexes.
3. Record database/collection/index fingerprints.
4. Run preflight and compare it with manifest preconditions.
5. Apply the manifest.
6. Run full structural and semantic verification.
7. Apply the same manifest again.
8. Require zero inserts, zero material updates, zero relationship changes, and
   zero outbound jobs on the second apply.
9. Rehearse rollback and then reapply/verify from a fresh restore.

### Verification

Verification must prove:

- Every applied operation has one verified registry record.
- All production schema validations pass.
- Required unique indexes exist and normalized Job Numbers remain unique.
- Every ObjectId relationship exists in the correct collection/model.
- Source/company/granularity snapshots and references agree.
- Allocation cents sum exactly to booking binder cents.
- No existing receiver Agent or active catalog status changed.
- Modern matched Form Lead duplicate values are unchanged.
- No duplicate comparison crossed cutoff or granularity.
- No prohibited Sheet Sync, CRM, messaging, notification, or queue artifacts
  were created.
- Manifest expected counts equal actual counts.
- A fresh plan against the resulting target is a no-op.

### Rollback

- Delete only deterministic IDs inserted by this manifest and only when no
  non-migration references appeared after apply.
- Restore updates only when the current field value still equals the
  manifest-applied value.
- Roll back relationships in reverse dependency order.
- Deactivate, rather than hard-delete, migration-created catalog records when
  any reference exists.
- Journal rollback in the same idempotent manner as apply.
- Stop and emit a conflict when live post-apply changes make automatic rollback
  unsafe.

## Implementation sequence

### Phase 1: safety foundation

- Create strict artifact schemas, stable serialization/hashing, deterministic
  IDs, target guards, migration lock, registry, and journal models.
- Create a side-effect-free migration context.
- Add command shells under the new scripts directory; all remain dry-run.
- Add package commands only after target-guard tests pass.

### Phase 2: snapshot and parsing

- Implement complete Sheet and Mongo snapshot adapters.
- Implement strict parsers and parity field matrix.
- Implement source/catalog mapping inputs.
- Add fixtures for every audited workbook/tab and known anomaly.

### Phase 3: shared business rules

- Refactor Form/Call duplicate and Form Fill rules into injected pure modules.
- Correct production runtime granularity/cutoff/direction behavior.
- Add `legacy_bad_tab` parity.
- Add migration-specific receiver attribution.

### Phase 4: canonical planner

- Resolve source identity and production overlap.
- Collapse compatible booking groups.
- Generate conflicts and replay decisions.
- Validate production-parity candidates.
- Generate byte-stable immutable manifests.

### Phase 5: exact-operation applier

- Implement catalog, Customer, lead, booking, cancellation, and relationship
  operations.
- Add bounded transactional batches, compare-and-swap filters, journaling,
  resume, verification, and rollback.

### Phase 6: rehearsal and production readiness

- Freeze and rerun audits.
- Resolve or explicitly approve all quarantine/conflict cases.
- Perform two-apply rehearsal and rollback rehearsal.
- Produce a concise production runbook containing exact reviewed hashes and
  commands.

## Required test suites

At minimum:

- Parser and Unicode normalization fixtures.
- One/two/three Agent allocation property tests using integer cents.
- Missing/negative/malformed money quarantine.
- Strict date, timezone, DST, cutoff, and malformed-year fixtures.
- Customer non-splitting and Job-Number-scoped identity.
- Exact aliases and ambiguous alias rejection.
- Form duplicate cutoff and exact-granularity tests.
- Earlier-only 90-day Call duplicate tests.
- Time-unbounded Form Fill after duplicate classification.
- Production-overlap collapse and stable ordering.
- Booking duplicate compatibility/conflict tests.
- Conflict/evidence/decision hash stability and stale decision rejection.
- Manifest byte stability.
- Target database guard and production confirmation tests.
- Side-effect suppression tests for every integration.
- Transaction retry and crash/resume tests.
- First apply, second no-op apply, rollback, and reapply integration tests on a
  replica-set Mongo fixture.

Tests should exercise the deep module interface. Do not make internal parser or
repository seams part of the public interface solely for tests.

## Proposed commands

These commands do not exist yet. Their names communicate the intended workflow:

```text
pnpm historical:stage -- --inventory=<path>
pnpm historical:plan -- --stage-run=<id> --decisions=<path>
pnpm historical:apply -- --manifest=<path> --target=testvantagemovers --apply
pnpm historical:verify -- --manifest=<path> --target=testvantagemovers
pnpm historical:rollback -- --manifest=<path> --target=testvantagemovers --apply
```

Production adds separate production authorization and exact hash confirmation.
No `apply` command may default to mutation.

## Definition of ready to run

Implementation is ready for rehearsal only when:

- All five Sheets and every required tab are in one immutable snapshot.
- Current historical and production snapshots are frozen and hashed.
- Every source row reconciles to canonical, conflict, or quarantine.
- Every production-parity document validates.
- All runtime duplicate/cutoff/granularity changes are deployed or included in
  the reviewed production release.
- `legacy_bad_tab` is supported losslessly.
- No unresolved blocking case exists.
- Manifest generation is byte-stable.
- Target guards and side-effect suppression tests pass.

Production is ready only after the complete fresh rehearsal, second no-op
apply, rollback rehearsal, backup/restore proof, and final preflight succeed.

Until then, the correct operational status is **no production apply**.

## Suggested skills for the next agent

- `codebase-design` to preserve the deep planner/applier module seam.
- `tdd` for parsing, identity, duplicate/cutoff, manifest, apply, and rollback
  behavior.
- `domain-modeling` if new ambiguity appears around Lead, Customer, booking
  party, sales Agent, receiver Agent, or Source Granularity terminology.
- `diagnosing-bugs` if audit reruns or rehearsal results disagree with the
  accepted invariants.

The next agent should not use `grill-with-docs` unless a genuinely unresolved
business decision is discovered. Existing accepted decisions should be
implemented rather than reopened by default.
