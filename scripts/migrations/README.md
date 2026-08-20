# Operations Registry migration runbook

> Granot Lead Lifecycle operators: use the fixed Unit 31 package below together
> with [`docs/granot-lead-lifecycle/production-operator-runbook.md`](../../docs/granot-lead-lifecycle/production-operator-runbook.md).

## Granot Lead Lifecycle fixed package (Unit 31)

All five commands are report-by-default, reject historical/unknown databases,
perform a database-name preflight before connecting, and recheck the connected
database before mutation. Apply always requires the exact target name. Output is
PII-safe JSON under the gitignored `scripts/output/` tree.

```text
pnpm migration:granot-lifecycle:receipts -- --report|--verify
pnpm migration:granot-lifecycle:receipts -- --apply --confirm-production=<db>
pnpm migration:granot-lifecycle:sources -- --report|--verify
pnpm migration:granot-lifecycle:sources -- --apply --confirm-production=<db>
pnpm migration:granot-lifecycle:leads -- --report|--verify
pnpm migration:granot-lifecycle:leads -- --apply --confirm-production=<db>
pnpm migration:granot-lifecycle:revisions -- --report|--verify
pnpm migration:granot-lifecycle:revisions -- --apply --confirm-production=<db>
pnpm migration:granot-lifecycle:indexes -- --report|--verify
pnpm migration:granot-lifecycle:indexes -- --apply --confirm-production=<db>
```

For each command use `report -> human review -> separately authorized apply ->
verify`, then repeat the cycle. The second apply must be a no-op. Non-unique
indexes are created first; every unique index is collision-gated. The central
catalog includes receipts, Observations, Registry/automation, activation,
Decisions, Record Links, Lead/Booking/case/discrepancy definitions, Entity
Changes, Domain Command idempotency, RingCentral processed-call identity, and
the Call Log singleton.

Historical shadow and certification require a confirmed replica-set test
database, `TEST_MODE=true`, and `SHEET_SYNC_MODE=disabled`:

```text
pnpm granot:lifecycle:shadow -- --limit=<positive-bounded-n> [--after-id=<exclusive-object-id>]
pnpm granot:lifecycle:certify
```

The runner passes receipt IDs only to the production processor, keeps its full
resume ObjectId only in a private checkpoint, and prints masked IDs. It fails on
post-cutoff promotion, a forbidden effect, activation drift, aggregate/revision
drift, or a technical failure. Certification fails closed unless all 15 latest
migration-mode artifacts, the shadow zero-effect report, flags, replica/external
isolation, and privacy scan are green. Neither command is production authority.

### Unit 33 receipt compatibility retirement

The receipt command can reshape remaining v1 rows, then retire compatibility
fields. `--apply --backfill` writes the missing v2 envelope from
`fillLegacyWebhookReceiptV2Fields` and unsets the seven retired fields on those
same rows. Plain `--apply` remains a cleanup gate: it refuses unless every row
is already v2-complete. Report must show zero refused rows and zero supported
legacy consumers before either apply. Cleanup then unsets only `event_type`,
`received_at`, `schema_version`, `processing_status`, `processing_attempts`,
`processed_at`, and `processing_error`, and drops only the two indexes over
those fields. Verify fails while any retired field/index or incomplete v2 row
remains. Run the full lifecycle index verifier immediately afterward.

Production apply still requires separate authorization and exact
`--apply --confirm-production=<db>` confirmation. Ordinary Unit 33 proof uses a
disposable replica database; no cleanup command accesses current payloads.

This directory contains the ordered backfills that turn existing operational
data into the collections used by the Operations Registry. Run every command
from the `vantage-main-server` repository root.

The migrations preserve the existing records that are their source of truth:

- Agents and Merchants are updated in place with compatibility identity and
  alias fields.
- embedded Source Company granularities are copied into
  `lead_source_granularities`; embedded arrays remain available for rollback.
- embedded and legacy current CPL values seed cutover periods in
  `cpl_rate_periods`; historical Lead CPL values are not rewritten.
- server-side RingCentral queue mappings and embedded inbound numbers seed
  `ringcentral_inbound_routes` and
  `ringcentral_inbound_route_assignments`.

## Safety rules

1. Back up the target database and confirm rollback readiness.
2. Run the test-database dry run and apply first.
3. Run a production dry run and review its manifest with the owner.
4. Resolve every reported collision or ambiguity before applying.
5. Apply one migration at a time in the order below.
6. Review the apply manifest before starting the next migration.
7. Never target `vantagemovershistorical`; every script refuses it.
8. Do not deploy registry-only RingCentral consumers until M5 reports a
   successful validation gate.

All mutating scripts are dry-run by default. Production mutation requires all
three flags:

```text
--apply --production-apply --confirm-production-db=vantagemovers
```

`TEST_MODE=true` selects the `testvantagemovers` database through the existing
test setup. Never set `TEST_MODE=true` for a production run. Do not print or
copy `.env` credentials into manifests or tickets.

## Prerequisites

- Install dependencies with `pnpm install`.
- Configure `.env` with the intended Mongo connection.
- For M5 apply only, configure valid RingCentral account credentials:
  `RC_SERVER_URL`, `RC_CLIENT_ID`, `RC_CLIENT_SECRET`, and `RC_JWT`.
- Choose and owner-approve the M4 cutover date in `YYYY-MM-DD` format. It is an
  America/New_York business date, not a UTC timestamp.
- Keep the exact reviewed manifest path when using `--resume-from`.

## Seed surface snapshot (pre-backfill reference)

A checked-in value inventory of current Agents, Merchants, LeadSourceCompanies,
embedded inbound numbers, and static RingCentral queue mappings lives at:

- `operations-registry-backfill-seed-report.json`
- `operations-registry-backfill-seed-report.md`

Generate a fresh redacted candidate from the live DB (database read-only):

```text
pnpm migrations:dump-operations-registry-seed-surface -- --confirm-production-db=vantagemovers
```

The command writes only to the gitignored `scripts/output/` directory and never
overwrites the checked-in reviewed snapshot. Diff and copy a candidate into the
tracked report only after reviewing it for safe fields and expected production
counts.

### M0 — Inventory and collision gate

`operations-registry-inventory.ts` is read-only. It inventories Agents,
Merchants, Source Companies, embedded granularities, legacy CPL data, Lead
counts, and static/embedded RingCentral numbers.

```text
# Test database
TEST_MODE=true pnpm migrations:operations-registry-inventory

# Production inventory
pnpm migrations:operations-registry-inventory -- --confirm-production-db=vantagemovers
```

Review the manifest under:

```text
scripts/output/operations-registry-inventory/
```

Do not continue while normalized Agent usernames, Merchant names, source
identifiers, CRM labels, or inbound numbers have unresolved collisions.

### M1 — Collection and index readiness

There is no standalone M1 backfill. The application models and the migrations
below create the new collections as they first write them. M5 explicitly
creates RingCentral route/assignment indexes and Call Lead provenance indexes
before route mutation.

Before production apply, verify that the deployment uses the current model
definitions and that MongoDB can create their declared unique indexes. Do not
remove legacy collections or fields.

### M2 — Agent and Merchant compatibility

This reads the existing `agents` and `merchants` collections. It normalizes the
existing Granot username into `granot_identity`, adds aliases where needed, and
does not rewrite Booking snapshots. M2 v2 initializes a missing Agent alias
array in the same update that copies its nested Granot identity, making a
single apply fully idempotent.

```text
# Test database dry run, then apply
TEST_MODE=true pnpm migrations:operations-registry-agent-merchant
TEST_MODE=true pnpm migrations:operations-registry-agent-merchant -- --apply

# Production dry run, then authorized apply
pnpm migrations:operations-registry-agent-merchant -- --confirm-production-db=vantagemovers
pnpm migrations:operations-registry-agent-merchant -- --apply --production-apply --confirm-production-db=vantagemovers --reviewed-manifest=<m2-dry-run-manifest-path>
```

Manifests:

```text
scripts/output/operations-registry-agent-merchant/
```

If an interrupted run produced a reviewed manifest, resume with:

```text
--resume-from=<manifest-path>
```

Gate: all intended usernames and aliases are represented, duplicate normalized
identities are zero, and the apply manifest has zero failures.

### M3 — First-class Source Granularities

This copies embedded `LeadSourceCompany.granularities` into
`lead_source_granularities`, preserving valid IDs and linking defaults to the
new documents. It deliberately leaves embedded arrays intact.

```text
# Test database dry run, then apply
TEST_MODE=true pnpm migrations:operations-registry-source-granularities
TEST_MODE=true pnpm migrations:operations-registry-source-granularities -- --apply

# Production dry run, then authorized apply
pnpm migrations:operations-registry-source-granularities -- --confirm-production-db=vantagemovers
pnpm migrations:operations-registry-source-granularities -- --apply --production-apply --confirm-production-db=vantagemovers --reviewed-manifest=<m3-dry-run-manifest-path>
```

Manifests:

```text
scripts/output/operations-registry-source-granularities/
```

The script also supports `--resume-from=<manifest-path>`.

Gate: every embedded granularity has exactly one first-class counterpart,
company defaults point to the intended records, and active-data conflicts are
zero. M3 must pass before M4 or M5.

### M4 — Temporal CPL cutover schedules

This creates one open-ended current period per reviewed active first-class
granularity. It does not infer historical schedules and does not modify
existing Lead CPL snapshots.

M4 preserves the current production `cpl_rates` value when embedded Source
Company CPL disagrees, because stored `cpl_rates` documents are the existing
runtime authority. The mismatch remains a reviewable manifest collision so it
is visible in the deployment evidence. As of the 2026-07-30 production
inventory, those differences are:

- `tbm_leads` call and form: embedded `$190`, legacy `$205`;
- `tbm_prime_leads` call and form: embedded `$190`, legacy `$205`.

The owner approved the current `cpl_rates` values as the seed authority and
`2024-01-01` as the open-ended schedule start. Because M4 schedules reference
first-class Source Granularities, its meaningful
production dry run must happen after the reviewed M3 apply. Do not approve an
empty pre-M3 M4 manifest for apply.

Replace the example date with the owner-approved cutover date:

```text
# Test database dry run, then apply
TEST_MODE=true pnpm migrations:operations-registry-cpl-schedules -- --cutover-date=2026-07-29
TEST_MODE=true pnpm migrations:operations-registry-cpl-schedules -- --apply --cutover-date=2026-07-29

# Production dry run, then authorized apply
pnpm migrations:operations-registry-cpl-schedules -- --confirm-production-db=vantagemovers --cutover-date=2026-07-29
pnpm migrations:operations-registry-cpl-schedules -- --apply --production-apply --confirm-production-db=vantagemovers --cutover-date=2026-07-29 --reviewed-manifest=<m4-dry-run-manifest-path>
```

Manifests:

```text
scripts/output/operations-registry-cpl-schedules/
```

The script supports `--resume-from=<manifest-path>`, but only with the same
database, script version, cutover date, mapping checksum, and reviewed plan.

Gate: every intended active granularity has the reviewed amount and cutover
date, source-value disagreements are resolved explicitly, and failures are
zero.

### M5 — RingCentral route backfill and live validation

The dry run combines the five server-side RingCentral mappings with embedded
Source Company inbound numbers. It resolves each normalized number to one
active first-class call granularity.

Dry run performs no provider calls. Apply loads the accessible RingCentral
account phone-number inventory once, validates every intended number against
that shared snapshot, persists sanitized provider metadata, activates valid
routes, and rolls back routes activated earlier in the run if a later route
fails. The assignment collection enforces one active assignment per route with
a unique partial index on `active: true`, which is supported by the production
MongoDB index engine.

```text
# Test database dry run, then apply
TEST_MODE=true pnpm migrations:operations-registry-ringcentral
TEST_MODE=true pnpm migrations:operations-registry-ringcentral -- --apply

# Production dry run, then authorized apply
pnpm migrations:operations-registry-ringcentral -- --confirm-production-db=vantagemovers
pnpm migrations:operations-registry-ringcentral -- --apply --production-apply --confirm-production-db=vantagemovers --reviewed-manifest=<m5-dry-run-manifest-path>
```

Manifests:

```text
scripts/output/operations-registry-ringcentral/
```

Gate:

- all five known mappings and every approved embedded number are accounted for;
- every number maps to exactly one active call granularity;
- all intended routes validate against the configured RingCentral account;
- active routes and assignments have zero conflicts or failures;
- the database name, run ID, and mapping checksum match the reviewed output;
- production apply is bound to the exact reviewed dry-run manifest;
- `validation_summary.gate_passed` is `true`.

Only after this gate passes should registry-only webhook, Call Log, and
Analytics consumers be deployed.

## Verification tests

Run migration tests before any production apply:

```text
node --import tsx --import ./scripts/test-setup.ts --test "scripts/migrations/*.test.ts"
```

Run the complete server suite after all applies:

```text
pnpm test
```

The repository-wide typecheck currently includes unrelated legacy
`scripts/dev_ops` diagnostics. Any new diagnostic in an Operations Registry
migration or runtime file is still a blocker.

## Desired final state

After M2–M5 have passed:

- Agents and Merchants retain their original records with registry-compatible
  identities and aliases.
- Source Companies retain embedded compatibility data and reference
  first-class `lead_source_granularities`.
- reviewed current CPL values are represented by temporal
  `cpl_rate_periods`.
- current RingCentral queue numbers exist as validated routes with one current
  assignment and preserved assignment history.
- registry mutations are auditable through `operations_registry_changes`.
- existing production and historical Lead snapshots remain unchanged.

Keep every dry-run and apply manifest with the deployment record. Migrations
are idempotent, but reruns must use the same reviewed inputs and must still pass
their collision and validation gates.

## Granot lifecycle source Registry (Unit 06)

`granot-lifecycle-source-registry.ts` classifies existing `GranotCrmSource`
rows and links exact-normalized `GranotAutomationSource` references. It does
not create Leads, Bookings, or Cancellations and does not enable a processor.

```text
pnpm migration:granot-lifecycle:sources -- --report
pnpm migration:granot-lifecycle:sources -- --apply --confirm-production=<db>
pnpm migration:granot-lifecycle:sources -- --verify
```

An Owner-authorized Best Relocation creation-policy-only rollout uses
`--scope=best_relocation_creation_policy` on report, apply, and verify. This
scope refuses unless both reviewed families are present and every proposed
Best Relocation change is limited to `lead_created_policy`; it never applies
unreviewed CRM-source deferrals or automation-reference changes.

Omitted mode is report. Historical/unknown databases are rejected. Apply is
separately authorized and refuses the whole reviewed family when a normalized
label, company, granularity, or route dependency is invalid. Unique
normalized-label index apply remains refused while collisions exist.

Reviewed normalized labels only: Best Relocation Call/Form families, Referral,
Paid Overflow, and source label Auto. Provider payload `type=AUTO` is not a
classification input. Best Relocation Call/Form creation policy is
`create_if_missing`; other reviewed policies remain unchanged.
