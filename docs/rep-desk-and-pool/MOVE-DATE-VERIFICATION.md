# Phase 1 move-date sorting verification

Verified October 14, 2026 against server base `eb532d96ce657f8bdca8a643774a5d98a8510f23`, on the shared Phase 1 branch. Root owns the final integrated checks, commits, PR and release evidence in [PHASE1-VERIFICATION.md](PHASE1-VERIFICATION.md).

## Behavior and compatibility

`GET /queue?sort=move_date` sorts the complete matching assignment scope by the authoritative projection `display.move_date` calendar date, soonest first, with null/unknown dates last and `subject_id` ascending for ties. Direction is fixed ascending even if a caller supplies `direction=desc`; the server returns the canonical direction. Admin mirrors this sort and direction.

Mongo reads a bounded dated phase followed by a bounded unknown phase, applying the complete search/priority/workflow/state/assignment/move-date filter to each before limiting. Each phase fetches only the page's remaining capacity. A signed cursor contains the stored date-only string (empty string means unknown) and stable subject id; an unknown cursor never returns to the dated phase. Existing actor, assignment generation, configuration, policy, expiry and New York day bindings remain in force. Unknown-only and date-excluding filters skip impossible phases.

There are no new persisted keys, projection rewrites, automatic backfills, cadence/enrollment changes or environment/configuration controls. Form Lead dates remain date-only; Call Lead dates remain null even when a raw Call Lead document has `move_date`. Existing projections work immediately. Old-sort cursors retain their original shape; the new sort gets its own filter/sort hash under the existing signed cursor version.

## Prepared additive indexes

These non-unique indexes are declared in `SALES_OUTREACH_PROJECTION_INDEXES`, which feeds the existing report-first `outreach:indexes` process. Models have `autoIndex: false` and `autoCreate: false`; declaring the indexes does not install them on production.

| Collection | Name | Key |
| --- | --- | --- |
| `sales_outreach_projections` | `sod_projection_q_move_date` | `{ assigned_agent_id: 1, "display.move_date": 1, subject_id: 1 }` |
| `sales_outreach_projections` | `sod_projection_q_team_move_date` | `{ "display.move_date": 1, subject_id: 1 }` |

In the isolated local replica, both dated and unknown phases use the declared assigned/team indexes with no blocking `SORT`, including continuation cursors and composed filters. The harness also drops both new indexes from its synthetic database and proves identical full-scope pagination for Team, assigned Rep and Unassigned. The indexes improve the query plan; they are not a functional correctness prerequisite. Without them Mongo may use a blocking sort. This test does not establish production latency or production index presence.

Operator preparation, using the existing managed production writer process and reviewed report:

```sh
pnpm outreach:indexes --target=<resolved-database>
# After the repository's production apply authorization/guard is satisfied:
pnpm outreach:indexes --target=<resolved-database> --apply
```

No production Mongo connection, index apply, experiment or backfill was performed for this slice. The CLI reports all missing registry indexes, so an operator must inspect its full report before apply. Rollback of runtime code needs no data rollback; the additive indexes can remain. Any later production index removal is a separate operator action.

## Local checks

Commands run from the clean server worktree with installed dependency executables. Tests use the existing test setup; the replica harness strips inherited provider/Mongo credentials, forces `TEST_MODE=true`, disables Sheets writes, connects only to `mongodb://127.0.0.1:27189/?replicaSet=csi01`, uses a unique `testvantagemovers_sodreads…` database and drops that database in `finally`. Loopback runs require the environment's network-enabled sandbox override.

```sh
node --import tsx --import ./ops/test-setup.ts --test \
  src/services/salesOutreach/reads/queue.test.ts \
  src/services/salesOutreach/subjects/subjectSync.test.ts
```

Passed both test files. Added cases verify unsorted insertion order, dated and null ties over page sizes 1–4 with no repeated/missing ids, fixed ascending direction, manager/Rep scope, combined literal search/priority/workflow/assignment filters, Future/today/Past/Unknown-compatible bounds, and read-only existing-projection behavior. Existing subject tests prove the Form/Call Lead move-date boundary and passed-date non-closure policy.

```sh
node node_modules/eslint/bin/eslint.js \
  src/config/domain/salesOutreach.ts \
  src/services/salesOutreach/reads/queueQuery.ts \
  src/services/salesOutreach/reads/deskStore.ts \
  src/services/salesOutreach/reads/queue.test.ts \
  src/models/salesOutreach/projections.ts --max-warnings 0
git diff --check
```

Focused lint and diff check passed. `pnpm typecheck` and `pnpm exec eslint …` could not start because the package-manager shim attempted an install into unwritable `/home/agent/.local/share/pnpm`; the equivalent installed executables are used for verification.

```sh
node node_modules/typescript/bin/tsc --noEmit
node --import tsx ops/sales-outreach/reads.replica.ts
```

Typecheck result pending the integrated check. The final complete replica run passed all 360 queue-plan combinations plus assigned/team move-date index explains, page sizes 1–4 across date/null ties, composed filters, known-only/unknown-only modes and correct pagination with both new indexes absent. Existing coverage/goal/freshness assertions and scoped live streams passed. Its final output was:

```text
PASS: 360 queue plans equal the in-memory semantics page by page; index used; move date: ties/nulls across pages, combined/known/unknown filters, both phases indexed with no blocking SORT, correct without new indexes; team/generation; A2 coverage-aware overdue counts (4 coverages, pre-A2 branch); S4 agent cadence, schedule_day, agent names; A3-fresh calls freshness inputs + webhook index read; SMS coverage over current mailboxes (evaluation = reads); scoped live streams
```
