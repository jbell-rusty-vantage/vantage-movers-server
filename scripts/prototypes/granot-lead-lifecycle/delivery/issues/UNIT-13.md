# Unit 13 — Lead provenance and index migration suite

> **Contract maturity: implementation-ready; implementation remains blocked by Unit 12 and the shared-branch sequence.** This is the migration half of S08. It extends Unit 09's Lead revision migration without resetting history, backfills only provable additive provenance metadata, labels uncertain history honestly, and deploys the exact non-unique Lead indexes without rewriting business facts.

## 1. Authority and required reading

- **Final specification:** Sections 1–2, 4–7, 10.1, 14.1–14.4, 15, 27, 34.3, 34.5, 34.7, 35–37, 38/S08, and 39–41.
- **Acceptance ownership:** migration foundation/partial proof for AC-10, AC-11, and AC-12. Runtime/current-state/display proof remains Units 12/15/18.
- **Approved split:** Unit 13 in `lead_lifecycle_issue_breakdown_reccomendation.md`. Unit 12 owns schemas, index declarations, validators, and new-row capture; Unit 09 already owns Lead revision zero/common history boundary in the same fixed Lead migration command.
- **Execution:** delivery runbook, repository instructions, migration/schema rules, verified Unit 09 and Unit 12 completion reports, actual deployed index inventory, and current Lead model/service evidence.

The final specification wins. This migration is metadata-only: no origin guess, snapshot relabeling, contact/move/source/CPL rewrite, collision repair, or fabricated historical Change is allowed.

## 2. Objective

Extend `granot-lifecycle-lead-provenance.ts` and the lifecycle index suite to report and conditionally backfill deterministic Form/Call Ingestion Origin, normalized Job values, and honest `legacy_baseline` snapshots; inventory missing/invalid Jobs, unknown origins, duplicate/Bad rows, and normalization collisions; deploy and verify exact Lead indexes; and prove dry-run/no-op/idempotency/privacy without changing Lead business values or Unit 09 revision/history metadata.

## 3. Repository, branch, and prerequisites

- **Repository:** `vantage-main-server`; branch `granot-lead-lifecycle`.
- **Blocked by:** verified Unit 12 implementation and shared-branch sequencing. Reverify Unit 09's reviewed common boundary and revision migration behavior before extending its Lead command.
- Before editing, inspect both Lead models, trusted creation provenance actually persisted, historical/read-only collections, `normalizeJobNo`, migration safety/manifest helpers, current lifecycle index catalog, package scripts, and actual database index names/definitions in a disposable environment.
- Local apply requires `TEST_MODE=true`, an explicit disposable database, and external effects disabled. A production report/apply or live database inspection requires separate authorization.
- Do not commit, push, deploy, inspect current payloads, mutate production, enable flags, repair customer rows, or send external work.

## 4. Current-state evidence to verify

Observed on 2026-08-17; reverify after Units 09 and 12:

- The current Form schema declares no Job/origin/snapshot fields; the migration report must inventory actual schemaless rows rather than assuming they are absent. `ingestion_source` is not persisted, so a Best Relocation origin cannot be reconstructed from that DTO alone.
- The current Call schema declares Job normalization and nested RingCentral transport metadata, but no top-level origin/snapshot; inventory actual schemaless rows. Nested `ringcentral.ingestion_source` may be durable evidence only when its surrounding data is valid and unambiguous.
- Required S08 Lead indexes are absent or differ. Current Form has `{ ref_no:1 }`; current Call has compatibility Job/source indexes but not the exact S08 set.
- `granot-lifecycle-indexes.ts` already protects earlier lifecycle model/index contracts. Extend it without weakening or renaming those checks.
- The Lead provenance script/package command is absent today, but Unit 09's completed implementation must have created its revision-only foundation before Unit 13 starts.
- Historical Lead models/collections are read-only compatibility sources and are never migration targets.

## 5. Locked decisions and invariants at risk

- **Invariant 1 — MongoDB is the System of Record:** migration facts and manifests reflect Mongo state, never Sheets or labels as authority.
- **Invariant 5 — only canonical commands mutate aggregates:** this one-time additive metadata migration is not permission for business writes.
- **Invariant 6 — post-activation causal mutations remain complete:** migration creates no Decision, Command, Change, revision increment, or Sheet work.
- **Invariant 8 — provenance axes remain independent:** origin is not inferred from Observation Channel, generic source labels, actor, initiator, or transport alone.
- **Invariant 9 — immutable evidence is never overwritten:** existing `captured_at_ingestion` snapshots survive byte-for-byte; legacy current state is labeled only `legacy_baseline`.
- **Invariant 10 — source ownership/origin/CPL is never reassigned by conflict or guess.**
- **Invariant 11 — Duplicate/Bad Form values and restrictions remain untouched.**

## 6. Deliverables and exact contract

### 6.1 Extend the fixed Lead migration

Extend Unit 09's `scripts/migrations/granot-lifecycle-lead-provenance.ts` and focused library/tests. Preserve its revision-only behavior and reviewed common `change_history_started_at`.

For each Form/Call row, report and plan only:

1. a deterministic allowed `ingestion_origin`, otherwise exact `legacy_unknown`;
2. `normalized_job_no = normalizeJobNo(job_no)` when a Job value exists;
3. Form Job parity only from a verified existing Lead Job field/value—never from `ref_no`, `lid`, Booking, Sheet, or Granot guess;
4. missing `ingested_contact_snapshot` from the current Lead contact only as `evidence_status:"legacy_baseline"`, and only when at least one allowed contact value exists;
5. missing Form `ingested_move_snapshot` from the current Form move fields only as `legacy_baseline`, and only when at least one allowed move value exists.

- Backfill origins only from durable, unambiguous evidence mapped to the exact Unit 12 union. If evidence is absent, contradictory, or merely a label/source guess, use `legacy_unknown` and report it.
- Top-level origin remains distinct from nested RingCentral transport provenance. Later RingCentral adoption can never change `granot_lead_created`.
- A baseline means “current document was the sole available deployment baseline,” never “original submission.” Do not populate a field absent from the current document or synthesize contact/move values.
- Record a separately reviewed, manifest-persisted `baseline_captured_at` for this migration and reuse it across report/apply/verify/rerun. Do not reuse Unit 09's `change_history_started_at` unless inspected evidence proves the two boundaries coincide. This is **issue-author guidance** because the specification requires an honest baseline but does not define timestamp transport.
- Never overwrite an existing origin, normalized Job, `captured_at_ingestion` or other snapshot, positive revision, history boundary, current provenance, temporal winner, Granot evidence, or last-change metadata. Contradictions are blockers, not silent repairs.

### 6.2 Report and PII-safe manifest

Report by collection:

- total/planned/unchanged/blocked counts;
- origin counts by exact enum, deterministic versus `legacy_unknown`, and contradiction counts;
- missing/invalid/raw-present/normalized-absent Job counts;
- snapshot absent/`captured_at_ingestion`/`legacy_baseline`/malformed counts;
- Form duplicate and Bad Lead counts, Call duplicate counts, and rows where restrictions matter;
- normalization collision groups and missing/invalid source-scope prerequisites;
- Unit 09 revision/history-boundary validity and “would preserve” counts.

Write two deterministic gitignored artifacts: (1) an access-limited apply/rollback manifest containing the exact document IDs required by Section 34.7, approved field plan, database/mode, tool/schema version, `baseline_captured_at`, and checksum; and (2) a PII-safe review projection containing counts, masked IDs, key fingerprints, blockers, and the protected manifest checksum. Neither may contain raw Job, name, phone, email, address, source/customer value, payload/header, credential, or full document. Only the masked projection may enter issue text, logs, handoff evidence, or model/subagent output.

Normalization collisions are inventory only. Never merge, delete, choose a winner, reassign source, or create a globally unique Lead Job index.

### 6.3 Apply and verify semantics

- Report is default and writes zero documents/indexes.
- Apply uses the reviewed manifest/checksum, bounded deterministic batches, and per-row predicates requiring every planned target field still be missing/unchanged. Any concurrent mismatch aborts/reports instead of overwriting.
- Apply changes only approved additive metadata. It never modifies current contact/move fields, `ref_no`, source scope, CPL, duplicate/Bad status, quoted, Booking/Cancellation refs, `domain_revision`, history boundary, last-change metadata, or `sheet_sync`.
- Rerun is idempotent. Existing valid values survive unchanged.
- Verify is read-only and exits nonzero for a missing/invalid required metadata contract, unexpected overwrite, manifest mismatch, remaining planned row, invalid snapshot label/time, normalization mismatch, revision/history regression, or index definition mismatch.
- Reject unknown/historical database targets. Production mutation requires separate authorization and exact confirmation.

### 6.4 Exact Lead index deployment

Extend `granot-lifecycle-indexes.ts` for Unit 12's exact declarations:

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

- Use deterministic explicit names consistent with the model/index catalog. Inventory actual compatibility indexes before deciding whether any is redundant; removal is not implicit in this unit.
- These seven indexes are non-unique. Create non-unique indexes first as Section 34.5 requires, and preserve zero-collision gating for every unrelated unique/partial lifecycle index.
- Never create a globally unique Lead Job index. Record Link and Booking uniqueness remain authoritative.

### 6.5 Documentation

Update migration/index runbooks and schema/business-logic docs with exact report/apply/verify behavior, honest baseline semantics, unknown-origin policy, privacy, and the prohibition on business-value rewrites. Do not describe migration/index apply as completed without command evidence.

## 7. Explicitly out of scope

- Unit 12 schema/validator/create-path work or mutation of new correctly captured rows.
- Source-policy/identity ladders (Unit 14), temporal/desired-state processing (Unit 15), matched writes (Unit 18), creation (Unit 19), or RingCentral adoption (Unit 20).
- Origin guessing from labels, collision remediation, Lead merge/delete, global Job uniqueness, current-contact/move enrichment, receiver assignment, or source/CPL changes.
- Decisions, Commands, Changes, outbox/Sheet Sync, Record Links, Booking/Release cases/effects, Admin/extension work, shadow certification, rollout, production apply, or raw/current payload access.

## 8. Flags and runtime posture

Starting and ending posture remain:

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

Migration/index work creates no activation or business effect. Never enable an effect to validate metadata.

## 9. Migration and indexes

Use the fixed commands:

```text
pnpm migration:granot-lifecycle:leads -- --report
pnpm migration:granot-lifecycle:leads -- --apply --confirm-production=<database-name>
pnpm migration:granot-lifecycle:leads -- --verify
pnpm migration:granot-lifecycle:indexes -- --report
pnpm migration:granot-lifecycle:indexes -- --apply --confirm-production=<database-name>
pnpm migration:granot-lifecycle:indexes -- --verify
```

- Omitted mode means report; report/apply/verify are mutually exclusive.
- Ordinary issue work may apply only to an explicit disposable test database. Production report/apply and actual index changes require separate approval; issue assignment authorizes neither.
- Preserve Unit 09 Lead revisions/common boundary and all predecessor index checks. Apply order is Lead metadata first, verify, then index report/review/apply/verify.

## 10. Acceptance criteria

- [ ] **AC-10 exact release assertion (foundation/partial here):** “WordPress Form primary contact and immutable submitted snapshot stay unchanged while qualified Granot contact is stored separately and displayed.” Unit 13 proves migration leaves primary/current business values unchanged, preserves captured snapshots, and labels only missing current-state evidence as `legacy_baseline`.
- [ ] **AC-11 exact release assertion (foundation/partial here):** “WordPress immutable move snapshot stays unchanged while qualified Granot current location/move date/cubic feet and Move Type update.” Unit 13 proves honest baseline capture/preservation and zero current move-field rewrite; live update remains Unit 18.
- [ ] **AC-12 exact release assertion (foundation/partial here):** “Call/Granot-created Form qualified contact becomes current; bounded Lead summary changes while full history appears in Entity Change.” Unit 13 proves migration never fabricates current/Change history and preserves existing summary/evidence; Unit 11 supplies inherited Change infrastructure, while assigned runtime AC proof remains Units 12/15/18.
- [ ] Report changes zero documents/indexes; reviewed disposable apply changes only approved metadata; rerun is a no-op; verify fails on every injected mismatch.
- [ ] Unknown/ambiguous origin is `legacy_unknown`; no row is mislabeled as original or deterministic without durable proof.
- [ ] Existing `captured_at_ingestion`, revisions, history boundaries, last-change/temporal/provenance data, and all business fields remain unchanged.
- [ ] Manifest/collision output is deterministic and PII-safe; no raw value appears.
- [ ] All seven exact non-unique Lead indexes verify; no global unique Lead Job index exists and predecessor index guarantees remain green.

## 11. Required tests and commands

- Pure tests for origin classification/fail-closed fallback, Job normalization, baseline construction, blockers, deterministic manifests, privacy scans, and preservation rules.
- Disposable-database report/apply/verify tests for zero-write report, conditional batches, concurrent mismatch, idempotent rerun, nonzero verify exits, and before/after business-field equivalence.
- Index tests for exact definitions/names, non-unique deployment, preserved earlier checks, and absence of global Lead Job uniqueness.
- AC-named tests must label migration ownership as foundation/partial.

Run exactly:

```text
node --import tsx --import ./scripts/test-setup.ts --test "scripts/migrations/granot-lifecycle-lead-provenance.test.ts" "scripts/migrations/granot-lifecycle-indexes.test.ts" "src/models/FormLead.test.ts" "src/models/CallLead.test.ts"
pnpm test:granot-lifecycle:replica -- --unit=13
pnpm test
pnpm typecheck
```

On a disposable database run both Lead and index report/verify and the reviewed local apply needed to prove idempotency. Never run production apply.

## 12. Live/staging verification

- In an explicit disposable replica-set database, seed redacted synthetic deterministic, unknown, contradictory, missing/invalid Job, collision, captured-snapshot, missing-snapshot, duplicate, Bad, and positive-revision rows.
- Run Lead report -> reviewed local apply -> verify -> rerun, then index report -> reviewed local apply -> verify.
- Record only counts, checksums, index definitions, exit codes, origin/snapshot-status distributions, and masked IDs. Prove no Lead business field, revision/history boundary, Change/Command/outbox, Booking/Cancellation, or Sheet work changed.
- Production remains read-only and separately approved; no current customer/payload values may be inspected or recorded.

## 13. Rollback

- Stop migration/index execution first and deploy prior compatible code. Old code ignores additive provenance fields.
- Never erase snapshots, rewrite origin, reset revision/history boundary, remove Commands/Changes/evidence, or alter committed official facts.
- Any additive-field unset or index removal requires a separately authorized rollback script/action keyed from the reviewed manifest. Preserve receipts, Observations, Decisions, activation, links, Commands, Changes, outbox work, and all aggregate facts.

## 14. Required completion handoff

Create `delivery/completion-reports/UNIT-13-COMPLETION.md` per Runbook Section 13, including:

- migration/library/test/index/docs files grouped by behavior;
- Sections 14/34.3/34.5/34.7, invariants 1/5–6/8–11, S08 migration allocation, and partial AC-10/11/12 mapping;
- exact origin decision table and unknown counts, snapshot statuses, Job/collision/duplicate/Bad inventories, manifest checksum/privacy scan, and index definitions;
- report/apply/verify database mode and exact outcomes, including idempotent rerun and no-production-apply statement;
- flags before/after and proof no business fields, revisions/history boundaries, lifecycle effects, or historical rows changed;
- final `git status --short` and explicit external-action statement.

Successful verified implementation completes S08 and unblocks **Unit 14**. Unit 14 must consume these fields read-only and must not reinterpret `legacy_unknown` or `legacy_baseline`.
