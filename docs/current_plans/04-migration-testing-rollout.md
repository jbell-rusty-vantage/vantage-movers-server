# Operations Registry Migration, Testing, Rollout, and Rollback

Status: Production safety and verification plan
Date: 2026-07-28

## 1. Safety boundary

All scripts are dry-run by default. Production apply requires:

- an explicit `--apply`;
- explicit production database confirmation;
- an owner-reviewed dry-run manifest;
- current backups/rollback readiness;
- no historical database/model imports;
- no Google Sheets, Granot, or RingCentral mutation unless the script is
  specifically the approved RingCentral validation step.

Scripts must print database name, mode, counts, and a redacted plan before
applying. They must never print secrets or raw provider tokens.

## 2. Migration manifest

Every inventory/backfill run writes a durable manifest containing:

```text
run_id
script_version / git SHA
database_name
dry_run or apply
started_at / completed_at
actor/operator
source counts
planned creates/updates/no-ops/conflicts
applied creates/updates/no-ops/failures
stable mapping checksum
conflict summary
validation summary
resume cursor/checkpoint
```

Manifests make reruns and deployment gates verifiable.

## 3. Migration sequence

### M0 — Inventory

Read only:

- Agents/Granot usernames and normalized collisions;
- Merchants and Booking merchant distinct values;
- embedded granularities and default keys;
- legacy `cpl_rates` and embedded CPL values;
- production Lead counts/CPL distributions;
- static and embedded RingCentral numbers;
- alias/CRM-label/site/phone conflicts.

Block schema uniqueness enforcement until collisions are resolved.

### M1 — Create collections and non-destructive indexes

Create:

- `lead_source_granularities`;
- `cpl_rate_periods`;
- `ringcentral_inbound_routes`;
- `ringcentral_inbound_route_assignments`;
- `operations_registry_changes`;
- `cpl_correction_jobs`.

Add production Lead fields through schema compatibility; Mongo documents need
no bulk field initialization.

Create unique indexes only after the dry-run collision report is clean.

### M2 — Agent and Merchant compatibility

- Copy normalized `granot_crm_username` to
  `granot_identity.username`.
- Mark migrated identity verification according to provable existing evidence;
  do not invent `verified_at`.
- Preserve the flat field.
- Initialize alias/lifecycle arrays only when needed.
- Do not alter Booking snapshots.

Verification:

- count configured usernames before/after;
- zero duplicate nested usernames;
- receiver matching parity for every configured username.

### M3 — First-class Source Granularities

For every embedded subdocument:

- preserve `_id` if valid and collision-free;
- link the containing Source Company;
- copy stable key, channel, labels, aliases, active state, Move Type, sites,
  priority, and tab name;
- record mapping from company + embedded ID/key to first-class ID;
- replace default keys with ObjectId references while retaining compatibility
  keys.

Verification:

- one mapped document per embedded granularity;
- all defaults resolve to the same logical stream;
- resolution fixture parity;
- exact conflict report is empty for active data.

Do not remove or rewrite embedded arrays.

### M4 — CPL cutover schedules

Do not fabricate historical periods.

For each reviewed active granularity:

- choose the cutover New York business date;
- read and reconcile embedded versus legacy current CPL;
- create one open-ended period starting at cutover;
- store amount in integer cents;
- record the chosen source/value in the migration manifest.

Existing production and historical Lead `cpl` values remain unchanged. Existing
Leads do not need a period reference. New Leads resolve temporally after the
consumer cutover.

Any disagreement between embedded and legacy CPL is a blocking owner-review
item, not an automatic winner.

### M5 — RingCentral pre-push backfill and validation

This is the approved replacement for a multi-day shadow rollout.

Dry run:

1. Seed candidates from the five static mappings and embedded inbound numbers.
2. Normalize each number.
3. Resolve exactly one active call granularity.
4. report duplicate/conflicting/unknown assignments;
5. show intended route and initial assignment records.

Apply before pushing/deploying registry-only consumers:

1. Create/update routes idempotently.
2. Create current assignments.
3. Validate every intended active number against RingCentral.
4. Store sanitized validation metadata.
5. Activate only valid routes.
6. Abort the cutover gate for any intended route that is missing, conflicting,
   inaccessible, or invalid.
7. Write a checksum of the final number-to-company/granularity mapping.

Required validation report:

- all five known mappings present;
- all approved embedded extras accounted for;
- zero number conflicts;
- zero active routes without valid account validation;
- zero active assignments to inactive/non-call granularities;
- expected mapping checksum;
- database name and migration run ID.

Only after this gate succeeds may the static-map removal/registry-only consumer
branch be pushed or deployed.

### M6 — Consumer cutover

Cut over in dependency order:

1. source/catalog queries;
2. Agent Granot matching;
3. first-class source attribution;
4. temporal CPL resolution for new Form Leads;
5. temporal CPL resolution for new Call Leads;
6. booking owner selectors/explicit inactive behavior;
7. RingCentral Call Log;
8. RingCentral webhook;
9. Analytics reconciliation and filters;
10. CRM/source label resolution;
11. source sheet target metadata consumers.

For RingCentral, database routes are authoritative immediately. There is no
silent static fallback.

### M7 — Compatibility retirement

After focused production verification:

- disable/remove legacy CPL mutation endpoints;
- stop reading embedded `granularity.cpl`;
- stop reading `cpl_rates`;
- stop direct reads of flat Agent username;
- stop static Source Company/CRM maps as runtime authority;
- remove static RingCentral map imports.

Retain legacy fields/embedded arrays for audit and rollback in this initiative.

## 4. Testing matrix

### Pure domain tests

- Agent/Merchant normalization and former-name aliases;
- Granot uppercase normalization and immutability;
- exact identifier collision rules;
- fallback priority and equal-priority ambiguity;
- default-granularity validation;
- phone normalization;
- CPL cents conversion;
- New York inclusive-end conversion;
- DST start/end;
- adjacent, overlapping, and gapped periods;
- schedule revision conflicts;
- activation/deactivation invariants.

### Model/transaction tests

- sparse unique Granot identity;
- unique granularity key and route number;
- mutation plus audit atomicity;
- concurrent Simple/Advanced schedule commands;
- one open route assignment;
- immediate reassignment closes/opens at one instant;
- correction job lease/resume/idempotency;
- cache invalidation only after commit.

### Lead tests

- Form Lead resolves source and CPL by business timestamp;
- Call Lead resolves source and CPL by business timestamp;
- boundary at exact `effective_from`;
- exclusive `effective_until`;
- duplicate Call Lead stores zero and base period when available;
- explicit zero-dollar period is `resolved`, not `missing_rate`;
- missing period saves with status/event;
- production edit with inactive catalog value is allowed explicitly;
- automatic ingestion excludes inactive values;
- historical model files and fixtures remain unchanged.

### RingCentral tests

- all five existing numbers preserve attribution;
- a database-only number qualifies through webhook and Call Log;
- multiple numbers resolve to one granularity;
- one number cannot resolve to multiple granularities;
- invalid/unvalidated draft cannot activate;
- failed validation returns actionable safe response/event;
- no recent calls still permits activation after account validation;
- deactivated number stops new qualification;
- delayed pre-deactivation call resolves by start time;
- reassigned route resolves old/new calls to their intervals;
- account-wide subscription remains valid;
- diagnostic filters load from registry;
- global 120-second policy is unchanged;
- no consumer imports static route map.

### Dashboard tests

- owner mutations allowed;
- non-owner mutation controls absent/disabled and proxy rejects mutation;
- non-owner reads allowed;
- signed actor context verification;
- show-inactive and explicit warning behavior;
- existing inactive value remains editable;
- Simple Mode submits changed rows only;
- Simple Mode conflict preserves all rows;
- Advanced Mode displays New York dates correctly;
- correction preview/job progress;
- RingCentral validation versus call evidence presentation;
- no delete actions;
- query invalidation refreshes catalog/facets/forms.

### Migration tests

- dry-run performs no writes;
- rerun is idempotent;
- partial apply resumes;
- manifest/checksum stable for unchanged input;
- embedded IDs preserved where possible;
- current Lead CPL values unchanged by schedule seed;
- database-name guard rejects historical/unknown target;
- RingCentral cutover blocks on any intended invalid route.

## 5. Required validation commands

Server packages:

```text
pnpm typecheck
pnpm test
```

Prefer focused test files during each package; run the full server suite at the
integration acceptance gate.

Dashboard packages:

```text
pnpm typecheck
pnpm test
pnpm lint
pnpm build
```

Run local API smoke tests under `TEST_MODE=true` with a replica-set MongoDB.
Mock RingCentral for automated tests. A live RingCentral validation is a
separate explicitly authorized rollout action.

## 6. Deployment order

1. Deploy additive server models/read endpoints and trusted actor verification
   in compatibility mode.
2. Deploy dashboard signed actor support and read/edit UI behind incomplete
   feature navigation if necessary.
3. Run approved production schema/index and data backfills.
4. Deploy first-class source and temporal CPL consumers.
5. Verify new production Leads store expected source/CPL snapshot fields.
6. Run and approve RingCentral pre-push backfill/validation.
7. Push/deploy registry-only RingCentral consumer cutover.
8. Deploy completed dashboard RingCentral/health surfaces.
9. Remove legacy write paths after verification.

Every step has a separately reviewable rollback point. Do not combine database
backfill, static-map removal, and dashboard exposure into one irreversible
deployment.

## 7. Production verification

After source/CPL cutover, inspect a bounded set of newly created production
Form and Call Leads:

- company/granularity IDs and snapshots;
- period ID/status/resolution time;
- expected CPL at timestamp;
- duplicate behavior;
- Sheet Sync intent unchanged.

After RingCentral cutover:

- verify route cache loaded the migration checksum;
- verify one known number through Call Log;
- verify one known number through webhook when naturally observed or through an
  explicitly safe diagnostic;
- confirm unknown number rejection;
- confirm no static map import/log fallback;
- monitor validation/cache/resolution Operational Events.

Do not create synthetic production Leads or trigger external side effects
without explicit owner approval.

## 8. Rollback

### Additive schema rollback

Old code ignores new collections/fields. Preserve all new documents for
inspection; do not drop collections or indexes during emergency rollback unless
an index itself is the proven cause.

### Source resolver rollback

Redeploy the last compatible server version. Embedded data remains untouched.
Do not reverse-migrate first-class IDs in an emergency.

### CPL rollback

Redeploy the last version reading existing CPL authority. Existing Lead `cpl`
snapshots were not bulk-changed by schedule migration. Disable new schedule
mutations while investigating. Do not delete periods.

### CPL correction rollback

Pause/cancel the job, preserve its manifest, and use its recorded previous
values for a reviewed compensating job. Never run an unbounded manual
`updateMany`.

### RingCentral rollback

Redeploy the prior known-good code version if necessary. Route/assignment
documents remain intact. Because the approved cutover has no runtime static
fallback, rollback is an explicit code deployment—not automatic silent use of
stale mappings.

### Dashboard rollback

Redeploy the prior dashboard. Server owner mutation authorization remains
authoritative. Do not weaken server checks to accommodate an old UI.

## 9. Final rollout evidence

The coordinating agent must hand off:

- server and dashboard integration branch SHAs;
- test/typecheck/lint/build results;
- migration dry-run and apply manifest IDs;
- source/granularity mapping counts;
- CPL cutover schedule summary;
- RingCentral mapping checksum and validation summary;
- new environment/config shape without secret values;
- remaining compatibility fields;
- rollback deployment references;
- explicit confirmation that historical database/models were untouched.
