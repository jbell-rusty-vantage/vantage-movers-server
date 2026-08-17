# Unit 09 — Aggregate revision fields and additive revision migrations

> **Contract maturity: implementation-ready; implementation remains blocked by the shared-branch sequence.** This is the revision-field foundation split from S07 plus only the revision/history-boundary portion of S08. It gives Form Leads, Call Leads, Bookings, and Cancellations an explicit lifecycle concurrency token and an honest start-of-history boundary. It does not create historical changes, introduce `EntityChange`, refactor the command executor, or route legacy writes through lifecycle commands.

## 1. Authority and required reading

- **Final specification:** Sections 1–2, 4–7, 14.1, the compare-and-swap rules in 23.2, 34.3–34.5, 35–36, 37.1–37.2, 38/S07 and the revision-only portion of S08, and 39–41.
- **Acceptance ownership:** revision/race prerequisite of AC-21 and revision/causal-chain prerequisite of AC-32. Unit 09 proves the tokens and migration boundary only; Units 10–11 and later effect units own command replay, complete causal chains, no-op behavior, and live mutation races.
- **Approved split:** Unit 09 in `lead_lifecycle_issue_breakdown_reccomendation.md`. Section 34.3's non-revision Lead provenance work belongs to Units 12–13; Section 23 command execution and Section 23.3 `EntityChange` belong to Units 10–11.
- **Execution:** delivery `AGENT-EXECUTION-RUNBOOK.md`, repository `AGENTS.md`/`CLOUD_AGENTS.md`, `.cursor/rules/lead-lifecycle-delivery.mdc`, schema/migration/testing rules, and applicable business-logic documents.
- **Predecessor:** Unit 01 contracts and redacted synthetic fixture guardrails, verified against repository state and `UNIT-01-COMPLETION.md`.

The final specification wins. This unit allocates all four aggregates' revision-only backfill to the aggregate-revision migration while introducing the revision-only foundation of the named Lead migration. Unit 13 later extends the Lead migration without resetting or relabeling revision history.

## 2. Objective

Add required `domain_revision` plus optional `last_change_id`, `last_changed_at`, and `change_history_started_at` fields to `FormLead`, `CallLead`, `BookedLead`, and `CancelledLead`; provide deterministic report/apply/verify support that establishes revision `0` and one honest start-of-history boundary for existing documents; and make one-Booking-per-normalized-Job collision readiness a hard precondition without inventing predeployment `EntityChange` history.

## 3. Repository, branch, and prerequisites

- **Repository:** `vantage-main-server`; branch `granot-lead-lifecycle`.
- **Specification prerequisite:** Unit 01 only. The contract is complete, but implementation stays blocked while the shared lifecycle branch is executing earlier units unless the integration owner explicitly permits non-overlapping work.
- Before editing, verify the four production models, their historical/read-only counterparts, public/admin validation schemas, current Booking normalized-Job index, shared migration safety helpers, package scripts, and the Unit 02 lifecycle index report/apply/verify framework.
- Confirm `TEST_MODE=true`, a disposable non-production database, and exact database name before any local apply. A production report or apply requires separate authorization; this issue authorizes neither.
- Do not commit, push, deploy, inspect live payloads, enable effects, or send external work without separate authorization.

## 4. Current-state evidence to verify

Observed on 2026-08-17; reverify immediately before implementation:

- `src/models/FormLead.ts`, `CallLead.ts`, `BookedLead.ts`, and `CancelledLead.ts` contain none of the four Section 14.1 fields. Form, Call, and Booking currently use Mongoose `optimisticConcurrency`; Cancellation does not. `__v` is therefore present in some compatibility paths but is not the lifecycle revision contract.
- `BookedLead` already declares a unique partial `{ normalized_job_no:1 }` index for string values. It has no explicit name, so current deployments may expose the default `normalized_job_no_1`; inventory actual names and definitions instead of assuming deployment state.
- Lead Job Number must not become globally unique. Units 12–13 own the additional non-unique Lead lookup indexes.
- `scripts/migrations/granot-lifecycle-migration.lib.ts` and the receipt/index migration suite already provide database classification, mutually exclusive modes, production confirmation, deterministic PII-safe manifests, and verify conventions to extend rather than duplicate.
- Package scripts include lifecycle receipts and indexes, but not the fixed `migration:granot-lifecycle:leads` or `migration:granot-lifecycle:revisions` commands.
- `src/models/EntityChange.ts` does not exist. `DomainCommandExecution` and current domain services do not yet enforce `domain_revision`; those are Units 10–11.
- Historical models are read-only compatibility projections. They must remain readable and must not become migration write targets.

## 5. Locked decisions and invariants at risk

- **Invariant 1 — MongoDB is the System of Record:** revision and boundary values are durable aggregate metadata, not Sheet or application-memory counters.
- **Invariant 4 — one Booking per normalized Job Number:** collision reporting must block unique-index apply/verification; never repair collisions by guessing, deleting, or merging Bookings.
- **Invariant 5 — only canonical commands mutate aggregates:** this one-time additive metadata migration is not a general mutation bypass. Unit 09 creates the concurrency primitive but authorizes no new business write.
- **Invariant 6 — atomic post-activation mutation chain:** later commands depend on an explicit revision transition. This unit must not claim the Decision/Command/Change/outbox chain is complete.
- **Invariant 9 — immutable evidence is never overwritten:** `change_history_started_at` marks the point after which complete history is available; it must not imply or fabricate older history.

`domain_revision` is independent from `__v`. Missing legacy fields remain readable until reviewed apply completes; new runtime documents receive safe defaults.

## 6. Deliverables and exact contract

### 6.1 Shared aggregate metadata

Add exactly these fields to all four production schemas and exported document types:

```ts
domain_revision: number;          // required, default 0, integer, min 0
last_change_id?: ObjectId;        // ref: "EntityChange"
last_changed_at?: Date;
change_history_started_at?: Date; // truthful deployment boundary
```

- Reject negative, fractional, non-finite, and non-numeric revisions at the model boundary. New documents default to `0`.
- `last_change_id` and `last_changed_at` are both absent until Unit 11 records the first real `EntityChange`. Rejecting a one-sided pair is narrow **issue-author guidance** that prevents a false change projection.
- `change_history_started_at` is optional for pre-migration compatibility. Existing rows receive the reviewed common boundary; genuinely new rows receive their trusted server creation time as the boundary. This new-row default is narrow **issue-author guidance** needed to keep post-migration verification truthful. Clients cannot supply it, and it is write-once outside the separately authorized migration seam.
- Existing public/admin/trusted DTOs must not accept these fields. `__v` may remain but no lifecycle interface exposes it as `domain_revision`.
- Reuse `src/models/granotLifecycleSchemas.ts` for an identical shared field definition if that keeps all four contracts aligned; do not create a generic aggregate or lifecycle engine.
- Do not modify historical schemas/documents. If an existing combined projection needs compatibility, it must tolerate absent lifecycle metadata.

### 6.2 Revision semantics

- Revision `0` means “no authoritative post-boundary lifecycle change has been recorded,” not “the aggregate never changed.”
- Every later authoritative mutation must compare `{ _id, domain_revision: expected_domain_revision }` and increment exactly once in the same transaction as its causal evidence. Unit 09 supplies/tests the primitive; Units 10–11 wire it into execution.
- A zero-row compare-and-swap is `DOMAIN_REVISION_CONFLICT`; no fallback write without the revision filter is permitted.
- Inserts begin at `0`; migrations only fill missing metadata. Rerun never resets a positive revision or advances an existing boundary.
- No migration sets `last_change_id` or `last_changed_at`, increments a revision, creates a Decision/Command/`EntityChange`, or requests Sheet Sync.

### 6.3 Revision migrations

Add the revision-only foundation of `scripts/migrations/granot-lifecycle-lead-provenance.ts`, add `scripts/migrations/granot-lifecycle-aggregate-revisions.ts`, factor focused libraries/tests as needed, and register the fixed commands:

```text
pnpm migration:granot-lifecycle:leads -- --report|--verify
pnpm migration:granot-lifecycle:leads -- --apply --confirm-production=<database-name>
pnpm migration:granot-lifecycle:revisions -- --report|--verify
pnpm migration:granot-lifecycle:revisions -- --apply --confirm-production=<database-name>
```

Allocation is exact:

- `...:leads` handles only missing Form/Call `domain_revision -> 0` and their common history boundary in Unit 09. Unit 13 later adds origins, normalized Job values, legacy-baseline snapshots, duplicate/bad inventory, and Lead indexes to this same command.
- `...:revisions` handles Booking/Cancellation `domain_revision -> 0`, their common history boundary, and normalized-Job uniqueness readiness.

For both tools:

1. Inventory totals and missing/valid/invalid revision and boundary counts by collection.
2. Require one explicitly reviewed ISO boundary shared by all four collections, recorded in the report manifest, and reused by both apply commands and both verify commands. This persistence mechanism is **issue-author guidance** because the final specification requires a common honest boundary but does not define rerun timestamp transport.
3. Plan only missing revisions/boundaries. Treat negative/fractional/non-numeric revisions, malformed dates, orphan/one-sided last-change metadata, or contradictory existing boundaries as blockers; do not repair ambiguous rows silently.
4. Apply in bounded deterministic batches with filters requiring the planned fields still be missing. Concurrent mismatch aborts/reports rather than overwrites.
5. Rerun is idempotent. Existing nonnegative revisions, boundaries, and later `last_change_*` values survive unchanged.
6. Verify is read-only and exits nonzero on any model/data/boundary invariant mismatch.

The Booking report also inventories missing/invalid normalized Job values and collision groups using counts plus masked IDs/key fingerprints. Apply and unique-index readiness fail while any collision remains.

### 6.4 Compatibility and documentation

- Keep current reads and legacy writes operational while Units 10–11 land. Do not force existing mutation paths through the unfinished executor here.
- Extend the shared lifecycle index catalog/report tooling with Booking collision/readiness evidence; do not replace or weaken Unit 02 receipt-index checks.
- Update matching schema/project/business-logic documentation to say explicit revisions exist but canonical revision/Change enforcement is incomplete until Unit 11. Never describe future enforcement as live.

## 7. Explicitly out of scope

- `EntityChange`, Sheet Sync outbox atomicity, transaction-owning command execution, and canonicalization of existing Lead/Booking/Cancellation/referral adapters (Units 10–11).
- Ingestion Origin, Form Job parity, snapshots, Priority, temporal winner, RingCentral convergence, and every Lead provenance/index migration behavior except revision metadata (Units 12–13).
- Observation processing, matching, Record Link mutation, Lead effects, reconciliation, owner commands, UI, extension/automation convergence, or any automatic Booking/Cancellation behavior.
- Collision remediation, Booking merge/delete, historical-database mutation, fabricated history, or backdated `EntityChange` rows.
- Production report/apply/index creation or flag changes.

## 8. Flags and runtime posture

Unit 09 creates no flag module, caller, or activation. If Unit 07's configuration exists by implementation time, starting and ending values are exactly:

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

If the predecessor flag module has not landed, do not create it in Unit 09 merely to express this posture.
- Starting and ending posture are identical. Schema defaults and migration metadata create no business effect.
- Never enable an effect to exercise revisions.

## 9. Migration and indexes

- Use the two fixed report -> reviewed apply -> verify flows above. Omitted mode means report; report/apply/verify are mutually exclusive.
- Reuse the existing gitignored deterministic manifest directory. Output includes database mode/category, counts, reviewed boundary, masked IDs/key fingerprints, collision totals, and checksum—never contact/customer/address/Job values, raw payloads, or credentials.
- Reject unknown and historical databases. Production mutation requires separate authorization plus exact `--apply --confirm-production=<database-name>`.
- Reconcile the existing Booking `{ normalized_job_no:1 }` unique partial string index only through `migration:granot-lifecycle:indexes`. Unique creation/replacement requires zero collisions; verify checks its actual name/definition against the model contract.
- Add no globally unique Lead Job index and no `EntityChange` index.

## 10. Acceptance criteria

- [ ] **AC-21 exact release assertion (foundation/partial here):** “Two concurrent owner commands with one case revision have one winner; replay of winner returns stored result; loser conflicts or resolves already-satisfied without second mutation.” Unit 09 proves only required nonnegative integer aggregate revisions and a disposable replica-set CAS primitive; owner-case replay/race remains later work.
- [ ] **AC-32 exact release assertion (foundation/partial here):** “No-op accepted Observation creates neither Entity Change nor Sheet Sync; every mutation has Receipt -> Observation -> Decision -> Command -> Change refs.” Unit 09 proves only the honest aggregate history boundary and that its migration fabricates no Decision, Command, `EntityChange`, Sheet work, last-change link, or business mutation.
- [ ] New instances default to revision `0`; invalid revisions and one-sided last-change metadata fail validation; `__v` is not the lifecycle contract.
- [ ] A genuinely new aggregate receives a trusted server creation-time history boundary; clients cannot supply it, and post-migration verify accepts no unexplained missing boundary.
- [ ] Report changes zero documents/indexes; apply is conditional, deterministic, PII-safe, and idempotent; verify fails on every missing/invalid invariant.
- [ ] Existing positive revisions and valid boundaries are never reset or overwritten.
- [ ] Booking collision fixtures block apply/index readiness, with no raw Job/customer/contact value in output.
- [ ] Legacy rows remain readable and existing DTOs cannot set lifecycle metadata.

## 11. Required tests and commands

Use AC-named tests at the sufficient level:

- model tests for all four definitions/defaults/validators/write exclusions and Booking index contract;
- pure migration tests for deterministic reviewed boundary, blockers, masked collision manifest, and zero fabricated history;
- disposable-database report/apply/verify tests for no-write report, conditional apply, rerun, positive-revision preservation, and nonzero verify exits;
- replica-set integration for actual Booking uniqueness/collision and the revision CAS primitive;
- regression proof that historical collections are never targeted and existing Unit 02 index guarantees remain green.

Add or reuse the fixed safe package runner `test:granot-lifecycle:replica`. It must refuse non-test/historical/production databases, require a replica-set topology, and allocate a disposable database. This runner name is **issue-author guidance** for reproducible index/CAS evidence.

Run exactly:

```text
node --import tsx --import ./scripts/test-setup.ts --test "src/models/granotAggregateRevisions.test.ts" "scripts/migrations/granot-lifecycle-lead-provenance.test.ts" "scripts/migrations/granot-lifecycle-aggregate-revisions.test.ts" "scripts/migrations/granot-lifecycle-indexes.test.ts"
pnpm test:granot-lifecycle:replica -- --unit=09
pnpm test
pnpm typecheck
```

On a disposable test database only, run both report and verify commands and, where needed, lifecycle index report/verify. Never run production apply.

## 12. Live/staging verification

- In a verified disposable replica-set database, seed synthetic missing, valid, malformed, positive-revision, and duplicate normalized-Job rows.
- Run report -> reviewed apply -> verify for Lead revisions, Booking/Cancellation revisions, and index readiness. Prove one reviewed boundary shared across all four collections, revision zero only where missing, no fabricated last-change/Change data, no business-field changes, and idempotent rerun.
- Prove a collision fixture prevents apply/index readiness, then correct only the synthetic fixture and verify green. Record counts, checksums, definitions, exit codes, and masked IDs only.
- No HTTP/Admin/extension smoke is required. Production report/verify/apply requires separate authorization and exact database verification.

## 13. Rollback

- Unit 09 introduces no runtime caller; stop migration/index execution first and deploy prior compatible code if needed.
- Retain additive revision/history fields. Never decrement revisions, erase honest boundaries/evidence, fabricate compensating history, or relax normalized-Job uniqueness to bypass collisions.
- Any unset requires a separately authorized rollback script keyed from the deterministic manifest; never touch business fields or historical databases.
- Preserve receipts, activation, Decisions, Commands, Changes, outbox work, and committed official facts that exist at rollback time.

## 14. Required completion handoff

Create `delivery/completion-reports/UNIT-09-COMPLETION.md` per Runbook Section 13, including:

- schema, migration/index, tests, and docs files;
- Sections 14.1/23.2/34.3–34.5, invariants 1/4/5/6/9, S07/S08 allocation, and partial AC-21/AC-32 mapping;
- exact report/apply/verify behavior, database mode, reviewed boundary, collision result, index name/definition, and no-production-apply statement;
- focused/full results and replica-set CAS/index evidence;
- proof no business facts, last-change data, Decision/Command/Change/Sheet work, or historical row was fabricated;
- flags before/after, final `git status --short`, compatibility risks, and explicit external-action statement.

Successful verified implementation unblocks **Unit 10**. Unit 11 still waits for Unit 10, and Units 12–13 must preserve this unit's revisions and history boundary.
