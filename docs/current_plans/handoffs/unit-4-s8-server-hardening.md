## Operations Registry work-package handoff

- Repository: `vantage-main-server`
- Branch: `feature/operations-registry`
- Base / rollback SHA: `5a9dc86`
- Work package: S8 server hardening, compatibility retirement, and rollout evidence
- Production mutation performed: **no**
- Provider call performed: **no**
- Historical database or historical model touched: **no**

## Outcome

The server interface required by dashboard D5/D6 is implemented. Registry Health
now returns stable codes, severity, entity identity, first/last observation,
actionability, bounded evidence, and remediation. Registry Overview now returns
bounded runtime resolver and compatibility-read telemetry.

Automatic Lead source assignment now crosses the first-class Operations Registry
interface. Owner-created Source Companies and Granularities are no longer rejected
by the legacy closed source union. Form, Call, booking, leadless-booking,
enrichment, and reconciliation CPL writes use temporal registry resolution.
Automatic Granot receiver matching reads only `granot_identity.username`.

Dashboard implementation may proceed against these server contracts. Final
cross-repository rollout remains gated by the M3/M4/M5 ordered test-apply evidence
described below; no production deployment or merge is authorized by this handoff.

## Acceptance matrix

| Specification §13 criterion | Server evidence | Verification | Status |
| --- | --- | --- | --- |
| Owner-only signed mutations; authenticated reads | trusted actor and mutation modules | existing trusted-actor and route suites | Pass |
| Transactional Registry Changes with sanitized snapshots | `registryAudit.ts`, `snapshotSanitizer.ts` | registry audit tests | Pass |
| Active/inactive lifecycle and explicit correction | catalog, source, CPL, and RingCentral registry modules | focused module tests | Pass |
| Granot uniqueness, immutability, active-only matching | `catalogRegistry.ts`, `receiverAgentCrmUsername.ts` | receiver matching and migration tests | Pass |
| Dynamic first-class source resolution | `resolveLeadSourceAssignment` → `resolveSourceAttribution` | owner-created source and source-resolution tests | Pass |
| Temporal CPL boundaries and explicit outcomes | `cplSchedule.ts`, `leadCplResolution.ts` | CPL schedule and Lead snapshot tests | Pass |
| Ordinary CPL edits do not rewrite Leads | schedule mutation interface | CPL and migration static assertions | Pass |
| Resumable/idempotent CPL correction | `cplCorrections.ts` | correction job tests | Pass |
| RingCentral validation and interval resolution | RingCentral registry and snapshot modules | registry, snapshot, webhook, and Call Log tests | Pass |
| Runtime static RingCentral map removal | production consumers use route snapshots | static import search | Pass |
| Master Leads and derived-import behavior | Lead and booking source assignment interface | affected booking/enrichment/reconciliation tests | Pass |
| Production/historical isolation | registry module has no historical imports; migration guards reject historical DB | static search and migration tests | Pass |
| Registry Health covers current registry failures | `queries/health.ts` | health tests | Pass |
| Cache and compatibility telemetry is bounded | `runtimeTelemetry.ts`, Overview and Health queries | runtime telemetry tests | Pass |
| Ordered migration evidence M0-M5 | local dry-run manifests below | M0-M5 dry runs | Blocked at M5 until M3 is applied on the test DB |

## Registry Health and telemetry coverage

- Source identifier/default conflicts and bounded missing/ambiguous runtime events.
- CPL schedule gaps/overlaps, unresolved production Leads, and failed/stalled jobs.
- RingCentral validation failures and active route/assignment inconsistencies.
- Stale snapshot service, refresh failures, safe error codes, and stale serving.
- Remaining compatibility reads grouped only by bounded path and consumer category.
- Presence or absence of an applied migration audit record.
- No raw phone number, Lead ID, actor ID, or provider token is used as a telemetry label.

Resolver telemetry distinguishes direct database resolution (`source`, `cpl`) from
snapshot resolution (`ringcentral`). It exposes last success, age, configured max
age, attempts, failures, last safe error code, and stale-serving state.
Compatibility reads are persisted as bounded Operational Events and aggregated
over a 24-hour observation window, with process-local fallback when event
persistence is unavailable.

## Compatibility retirement

| Retained compatibility item | Current reader/writer | Reason retained | Telemetry / rollback value | Objective removal criterion |
| --- | --- | --- | --- | --- |
| `GET /api/v1/admin/cpl-rates` and `cpl_rates` | read-only admin compatibility list | old dashboard compatibility | `legacy_cpl_rates/admin_list`; prior-code rollback | dashboard uses temporal schedules and counter remains zero |
| Embedded Source Company granularities/default keys | migration and compatibility display code only | audit, M3 source evidence, rollback | no automatic Lead assignment reads them | post-cutover verification and rollback window close |
| `granot_crm_username` | retained field only; automatic matcher no longer reads it | audit and rollback | M2 manifest; nested identity is runtime authority | M2 applied/verified and rollback window close |
| `call-lead-sources.ts` static map | M5 seed/fixture only | deterministic migration evidence | M5 mapping checksum | route registry applied/validated and rollback window close |
| `CPL_RATE_DEFINITIONS` | seed/fixture and retained compatibility helpers | deterministic migration baseline | M4 mapping checksum | temporal schedules applied and compatibility counter remains zero |

No retained compatibility path performs ordinary schedule mutation or rewrites
production Lead CPL values.

## Verification

- Focused S8 source, health, telemetry, Agent, booking, enrichment, and
  reconciliation tests: pass.
- Migration tests: 41 passed, 0 failed.
- Full server suite: 586 passed, 0 failed.
- `pnpm typecheck`: no Operations Registry or changed-file diagnostics; command
  remains non-zero only for the pre-existing `scripts/dev_ops/*` baseline.
- Server has no lint script.

Static assertions:

- No `models/historical` import under `src/services/operationsRegistry`.
- No production consumer imports the static RingCentral route map.
- No production caller invokes embedded `resolveLeadSource`.
- No production caller invokes legacy CPL helper functions.
- No automatic Agent matcher reads `granot_crm_username`.
- No legacy CPL mutation or Lead `updateMany` path exists.

## Test-database dry-run evidence

All commands used `TEST_MODE=true`, omitted `--apply`, performed no provider calls,
and targeted `testvantagemovers`.

- M0 inventory:
  - runs `operations-registry-inventory-1785359439212` and
    `operations-registry-inventory-1785359559473`
  - checksum `bb8f4cb748be13175a54a8f00b9017aec0393060d72ef0cf99a6a16e3c37d896`
  - zero blocking and three reviewable unmatched booking merchant snapshots
- M2 Agent/Merchant:
  - runs `operations-registry-agent-merchant-1785359439881` and
    `operations-registry-agent-merchant-1785359560656`
  - checksum `127f6f9a706ef095bcc486fcaf5165796e47f9c3cb4fea3d1919e9f725e597b4`
  - zero conflicts; seven planned compatibility updates; zero writes
- M3 Source Granularities:
  - runs `operations-registry-source-granularities-1785359439877` and
    `operations-registry-source-granularities-1785359560680`
  - checksum `2375468e9126c4054cb43cc28477b699f77376dc7a8c4df55b562c2679c82511`
  - zero conflicts; thirteen planned creates and six planned updates; zero writes
- M4 CPL schedules, cutover date `2026-07-29`:
  - run `operations-registry-cpl-schedules-1785359561317`
  - checksum `22def9ea494730ce0e4a93c86b19a07cd9c723785f07d36649d72af240cff74d`
  - zero conflicts and zero writes; no schedules are proposed because M3 has not
    been applied to the test database
- M5 RingCentral:
  - run `operations-registry-ringcentral-1785359563465`
  - checksum `4f53cda18c2baa0c0354bb5f9a3ecbe5ed12ab4d8e11ba873c2f11161202b945`
  - zero writes and no provider validation
  - expected gate failure: ten blocking unresolved-granularity conflicts because
    M3 has not been applied to the test database

The M5 manifest now includes operator, conflict summary, dry-run/no-write evidence,
safe validation summary, and an explicit resume cursor field.

## Remaining rollout gate

To produce a passing M5 test manifest, obtain explicit authorization for test-only
apply, then apply M2 and M3 to `testvantagemovers`, apply M4 with the reviewed
cutover date, and repeat M5 dry-run before any live provider validation. This is an
ordered rollout prerequisite, not a server-code defect. Production apply, live
RingCentral validation, deployment, push, and merge to `main` remain out of scope.

## 2026-07-30 production-readiness addendum

The current worktree was re-audited before production backfill authorization.
Production read-only dry runs were authorized and performed on 2026-07-30.
No production mutation, provider call, push, merge, or deployment was
performed.

Additional runtime cutovers:

- Agent, Merchant, Source Company, Source Granularity, CPL schedule, and
  RingCentral Inbound Route lifecycle surfaces now have explicit list/detail
  reads plus their supported create/update/activation commands.
- Agent and Merchant name/Granot resolution now stays behind the public
  Operations Registry interface; the unused Agent auto-upsert helper was
  removed.
- Form/Call manual receiver assignment resolves the Agent through the registry.
- Employee Booking source validation and production admin facets use
  first-class Source Granularities rather than embedded compatibility arrays.
- Receiver-Agent Analytics uses persisted dynamic source label snapshots and
  does not remap owner-created Source Companies through the legacy closed
  union.

Additional migration safeguards:

- the seed-surface dump redacts workbook identity and writes only to the
  gitignored output directory;
- the reviewed checked-in seed report contains no workbook IDs;
- production M2–M5 apply requires
  `--reviewed-manifest=<exact-dry-run-manifest-path>`;
- apply aborts if database, script version, mapping checksum, or M4 cutover
  date differs from the reviewed dry run.

Current verification:

- focused registry/runtime consumer tests: 16 passed;
- migration/readiness tests: 46 passed;
- full server suite: 593 passed, 0 failed;
- `pnpm typecheck`: no diagnostics in changed Operations Registry/runtime
  files; the command remains non-zero only for the pre-existing
  `scripts/dev_ops/*` baseline.

Production read-only evidence:

- seed surface: 20 Agents, 7 Merchants, 6 Source Companies, 13 embedded
  granularities, and exact parity between the 5 embedded inbound numbers and
  the 5 static RingCentral mappings;
- M0 inventory: zero blocking conflicts and four reviewable CPL disagreements;
- M2 Agent/Merchant: 27 planned updates and zero conflicts;
- M3 Source Granularities: 13 planned creates, 6 planned updates, and zero
  conflicts;
- M5 RingCentral: no writes or provider calls and 10 expected blocking
  unresolved-granularity conflicts because M3 has not yet been applied.

Timestamped manifests live only under the gitignored `scripts/output/`
deployment-evidence directories. Before apply, use the final dry-run manifest,
record its path and checksum in the deployment record, and verify its
`git_sha` equals the exact commit being deployed. Do not rely on a manifest
filename copied into this tracked handoff.

The four M0 review items are the existing `190` embedded versus `205` legacy
CPL disagreements for TBM call/form and TBM Prime call/form. The owner approved
the currently authoritative production `cpl_rates` values, so M4 v2 seeds
`205` for those four entries and retains each embedded mismatch as a
reviewable manifest collision. The owner also approved `2024-01-01` as the
open-ended schedule start; M4 does not set an end date or rewrite historical
Lead CPL snapshots.

A meaningful M4 production dry run must follow the reviewed M3 apply because
schedules reference the first-class granularities created by M3; an empty
pre-M3 M4 manifest is not approval evidence.

## 2026-07-30 production apply evidence

M2 Agent/Merchant was owner-authorized and applied:

- first reviewed pass: 27 updates, zero conflicts, zero failures;
- immediate verification exposed a planner defect: the 13 Agents that needed
  both nested Granot identity and alias initialization received the identity
  first, leaving 13 reviewed alias-only updates;
- second reviewed pass: 13 alias initializations, 14 no-ops, zero conflicts,
  zero failures;
- final verification: zero updates, 27 no-ops, receiver matching parity true,
  and Booking snapshots untouched.

M2 v2 fixes the planner so identity and missing aliases are written together in
one pass. M3 was intentionally held until the M2 post-state became fully
idempotent.

M3 Source Granularities was then owner-authorized and applied:

- 13 first-class granularity creates and 6 Source Company default-link updates;
- zero conflicts and zero failures;
- final verification: zero writes and 19 no-ops, with all 13 embedded rows
  mapped one-to-one and defaults resolving to the mapped IDs.

M4 CPL schedules was owner-authorized and applied:

- 13 open-ended periods effective `2024-01-01`;
- current production `cpl_rates` amounts used, including the four approved
  `205` values;
- zero blocking conflicts and zero failures;
- final verification: zero writes and 13 no-ops.

The first owner-authorized M5 provider preflight made no database writes. Four
numbers validated, while one of five parallel copies of the same RingCentral
account-inventory request received HTTP 429. M5 v2 replaces those redundant
parallel provider requests with one shared account inventory load used to
validate all five numbers. A regression test proves concurrent validations
share exactly one load.

The M5 v2 retry used one provider request and all five numbers validated. It
also made no route writes because production MongoDB rejected the assignment
model's partial unique index containing the unsupported
`effective_until: { $exists: false }` predicate. M5 v3 uses the equivalent
supported partial filter `{ active: true }`: assignment close/deactivate
already changes `active` to false, so this still enforces exactly one current
assignment per route. An index contract test protects the production-compatible
definition. M5 requires a fresh v3 dry-run manifest before retry.
