# JTE-01 — Extract the deep runtime module

> **Contract maturity: implementation-ready.** Session 1. Move the production
> Job Number timeline behind one module interface. **No new owner-facing
> behavior.** Byte-for-byte v1 responses are the exit.

## 1. Authority and required reading

- **Enhancement specification:** [`../job-timeline-enhancement-specification.md`](../job-timeline-enhancement-specification.md)
  — §1.3, §10.1–10.2, §15 Phase 0, §16 `JTE-01`. The enhancement spec wins on
  the seam. The prototype spec wins on event truth.
- **Prototype specification:**
  [`../../../scripts/prototypes/job-number-timeline/specs/job-number-timeline-prototype-specification.md`](../../../scripts/prototypes/job-number-timeline/specs/job-number-timeline-prototype-specification.md)
- **Pack rules:** [`../README.md`](../README.md), [`../AGENT-PROTOCOL.md`](../AGENT-PROTOCOL.md)
- **Current Service:** [`../../knowledge/services/job-number-timeline.md`](../../knowledge/services/job-number-timeline.md)
- **Repository conventions:** `.cursor/rules/project-organization.mdc`,
  `.cursor/rules/job-number-timeline.mdc`
- **Patterns to reuse, not reinvent:** the existing assembler, loader,
  masking, and normalize functions. This issue relocates them; it does not
  redesign them.

## 2. Objective

Create `src/services/jobNumberTimeline/` as the only runtime implementation
of typed Job Number retrieval. The HTTP route and the CLI call one module
interface. Tests call that same interface. After this issue, **no file under
`src/` imports `scripts/prototypes/job-number-timeline`.**

## 3. Repository, branch, and prerequisites

- **Repository:** `vantage-main-server` only. No Admin work.
- **Branch:** `job-timeline-enhancement` (create if missing and the tree is
  otherwise clean).
- **Prerequisites:** none. This is the only startable issue.
- Ordinary checks use redacted synthetic data. Runtime reads require
  `TEST_MODE=true` and `testvantagemovers`.
- No commit, push, deploy, production flag change, live payload read, or
  external send.

## 4. Current-state evidence to verify

Observed 2026-08-27; **reverify at implementation**.

- `src/services/jobNumberTimeline/` does not exist.
- `src/routes/job-number-timeline-admin.routes.ts` imports
  `assembleJobNumberTimeline`, `loadCompanyGranularityIds`,
  `loadJobNumberTimelineRows`, `redactTimelineValue`, `normalizeTypedJobNo`,
  and `JobTimelineAssembleResult` from
  `../../scripts/prototypes/job-number-timeline/src/`.
- Route `defaultRead` loads rows, assembles, then redacts `page` on `ok`.
  `createJobNumberTimelineAdminRouter` already accepts `deps.read`.
- Prototype files:
  `assemble.ts`, `assemble.test.ts`, `load.ts`, `types.ts`, `rows.ts`,
  `normalize.ts`, `masking.ts`, `masking.test.ts`, `cli.ts`, `cli.test.ts`,
  `discover.ts`, `discover.test.ts`.
- Scripts: `pnpm prototype:job-number-timeline`,
  `pnpm test:prototype:job-number-timeline`.
- Named prototype regressions that must keep passing:
  WordPress walk-back, Granot-born, latest Decision attempt only, case is
  not a Booking, equivalent Job Number, Sheet Sync by entity ID, no
  invented Sheet events, typed search `not_found`, assemble is pure over
  injected rows.

## 5. Locked decisions and invariants at risk

- **One external interface.** Callers do not know collection names,
  walk-back order, sort priorities, or redaction rules.
- **Two loader adapters make the seam real.** Mongo for production, memory
  for tests. One adapter would be a hypothetical seam.
- **v1 response bytes stay the same.** Do not add `schema_version`, stages,
  `source_received`, attention, or dual clocks here.
- **Redaction moves inside the module**, so the route stays
  authorize → validate → `module.read` → respond. The HTTP body must still
  match today's redacted envelope.
- **Discover stays a CLI-only adapter** in the prototype folder. It is not
  part of the HTTP module and must not become a catalog endpoint.
- **Do not call `projections.ts` or invent `GranotTimelineEntry` events.**

## 6. Deliverables and exact contract

### 6.1 External interface

```ts
type JobNumberTimelineModule = {
  read(input: {
    job_no: string;
    source_granularity_id?: string;
    source_company_id?: string;
    now?: Date;
  }): Promise<JobTimelineAssembleResult>;
};
```

`src/services/jobNumberTimeline/index.ts` exports only the factory and
public types. `now` may be unused in this issue; keep it on the interface.

### 6.2 Internal files for this issue

Create the folder. **Do not force the full §10.2 tree yet.** JTE-02/03
split projector, clocks, outcome, and attention.

Required now:

```text
src/services/jobNumberTimeline/
  index.ts
  types.ts                 // current v1 contract
  module.ts                // orchestration
  evidence-loader.port.ts
  mongo-evidence-loader.ts // from load.ts row loading
  memory-evidence-loader.ts
  assemble.ts              // current projector; rename in JTE-02 if useful
  normalize.ts
  masking.ts
  rows.ts
```

Keep `normalize` Job-equivalence tests next to `normalize.ts`. Keep the
assembler tests next to `assemble.ts`. They must call the module or the
same pure assemble function the module uses — not a second copy.

### 6.3 Route and CLI

- Route `defaultRead` becomes `createJobNumberTimelineModule({ loader }).read`.
  Keep `deps.read` for route tests.
- CLI `render` calls the production module. CLI `discover` may keep using
  prototype `discover.ts` as a script-only helper, but it must not reimplement
  assemble.
- `pnpm prototype:job-number-timeline` and
  `pnpm test:prototype:job-number-timeline` keep working. Add focused
  `src/services/jobNumberTimeline/**/*.test.ts` coverage that `pnpm test`
  already picks up.

### 6.4 Docs after the move

Update `docs/knowledge/services/job-number-timeline.md` so `src/` is
primary code and the prototype is a retained CLI/proof adapter. Invoke
docs-keeper. Do not describe v2 fields as shipped.

## 7. Explicitly out of scope

- Any v2 field, `source_received`, outcome, attention, freshness, or
  activity grouping.
- New Mongo reads (receipts, RingCentral ledger, cursor).
- Admin UI changes.
- Cancellation snapshots or WordPress receipts (JTE-06, JTE-07).
- Rewriting headlines, sort priority, or walk-back rules.

## 8. Flags and runtime posture

No new flag. Owner authorization is unchanged. `TEST_MODE` and the CLI
production-confirm flag stay as they are.

## 9. Migration and indexes

None. This issue writes no collection and applies no index.

## 10. Acceptance criteria

- [ ] `src/services/jobNumberTimeline/` exists and exports
      `createJobNumberTimelineModule`.
- [ ] `rg "scripts/prototypes/job-number-timeline" src` is empty.
- [ ] HTTP envelope, status values, event kinds, headlines, and safe `data`
      match current route tests and assembler fixtures.
- [ ] Route tests still inject `deps.read` and still prove Owner-only vs
      Admin 403.
- [ ] Memory loader + module interface reproduce the existing assembler
      cases (WordPress walk-back, Granot-born, latest Decision only, intake
      is not official, equivalent Job Number, Sheet Sync by entity ID).
- [ ] CLI `render` uses the production module. Discover remains CLI-only.
- [ ] Masking still strips contact, SMS body, and raw payloads.
- [ ] Service doc names `src/services/jobNumberTimeline/` as primary code.
- [ ] No Command, `EntityChange`, case, outbox row, or notification is
      produced.

## 11. Required tests and commands

```bash
pnpm test -- src/services/jobNumberTimeline src/routes/job-number-timeline-admin.routes.test.ts
pnpm test:prototype:job-number-timeline
pnpm typecheck
```

Prove the runtime import rule:

```bash
rg "scripts/prototypes/job-number-timeline" src
```

## 12. Live/staging verification

Not required. Synthetic fixtures plus existing route tests are enough.
Do not read production.

## 13. Rollback

Delete `src/services/jobNumberTimeline/` and restore the route/CLI imports
to the prototype folder. No data was written.

## 14. Required completion handoff

Report: files moved vs copied; the `rg` output proving `src/` is clean;
focused test output; confirmation that v1 fixtures were not rewritten to
pass; Service doc update; what you left for JTE-02.

**Unblocks:** JTE-02.
