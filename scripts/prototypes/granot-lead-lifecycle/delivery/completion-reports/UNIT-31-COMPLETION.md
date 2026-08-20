# Unit 31 — Migration/index, historical shadow, security certification, and runbooks

**Status:** Complete  
**Repositories / branches:** `vantage-main-server` / `granot-lead-lifecycle` and `vantage-admin` / `granot-lead-lifecycle`

## Delivered contract

- The five lifecycle migration commands guard the configured database before connection and again before mutation, write deterministic atomic manifests, and support explicitly named disposable `testvantagemovers_<suffix>` databases only under `TEST_MODE=true`.
- Receipt compatibility, CRM source Registry, Lead provenance, aggregate revision, and the complete central index catalog passed report -> reviewed apply -> verify and a second idempotent no-op cycle. The catalog includes Domain Command identity/idempotency and RingCentral processed-call identity definitions; production runtime verifies predeployed processed-call indexes instead of creating them.
- `granot:lifecycle:shadow` performs bounded ascending-ObjectId historical selection with exclusive resume/checkpoint compatibility, calls the production processor by receipt ID, distinguishes technical failure from business Decision, and fails closed on activation or forbidden aggregate drift.
- `granot:lifecycle:certify` binds repository refs, safe environment modes, all flags, masked activation, 15 command/mode manifests, shadow hash/assertions, bounded health counts, and privacy results into deterministic JSON/Markdown. It exits nonzero on any missing or failed assertion while retaining its evidence.
- Lifecycle list/detail contacts, Booking customer names, Admin DTOs, lifecycle failure logs, malformed-body logs, queue/cron logs, Operational Events, and generated artifacts retain only masked or bounded values. Synthetic credential/contact canaries are absent from certification surfaces.
- The production operator runbook freezes preflight, command ordering, index dependencies, staged flags, the seven alert thresholds, Section 39 stop conditions, causal-ID-only verification, authority gates, and evidence-preserving rollback with deterministic target re-scan/hash binding.

## Disposable certification evidence

All database mutations were synthetic and confined to the isolated replica database `testvantagemovers_unit31`, with Sheet Sync disabled and every effect flag false.

| Gate | Result |
| --- | --- |
| Five migration commands, first cycle | 15/15 report/apply/verify manifests present; zero refusals/collisions/blockers after reviewed synthetic seed |
| Five migration commands, second cycle | apply mutations/index creations all zero; verify green |
| Historical runner | one historical receipt selected; zero technical failures; policy-blocked Decision; twelve forbidden collection count/hash fingerprints unchanged; activation unchanged |
| Unit 31 certification | PASS; 15 manifests; zero privacy findings; all nine assertions true; report hash `177ddd80f35e8bac45c0c0c0978c59fa90311a02f3207b61aeaf06feafbf42a4` |
| Unit 31 replica | 8 passed, 0 failed, 0 skipped |

Public artifacts contain counts, hashes, closed codes, modes, and masked IDs only. Private checkpoints are gitignored. Masked manifest identifiers are not rollback handles; rollback target resolution requires a new deterministic authorized re-scan.

## Acceptance proof

- **AC-31:** historical replay is bounded, resumable, pre-activation only, causally idempotent, and incapable of live-shadow promotion; forbidden state and activation are fingerprinted before/after.
- **AC-35:** closed projection/log/audit/artifact boundaries mask contact and identifiers, reject transport/credential fields, and pass synthetic canary scanning with zero findings.
- **AC-37:** dead-letter replay remains Owner-only, strict-reason and state guarded, preserves receipt payload identity, and creates no Decision for technical dead-letter failure; successful historical reprocessing remains idempotent. Operational audit remains the Section 33 after-commit best-effort seam.
- **AC-38:** migration/runtime source ambiguity remains fail-closed and cache publication remains post-commit. The reviewed Unit 31 migration contract remains `link_only`; any later `create_if_missing` policy change belongs to Unit 33's separately reviewed compatibility-removal contract.

## Verification

Main server gates:

```text
Unit 31 migration/certification suite: 66/66 passed
focused security/projection/index suite: 39/39 passed
TEST_MODE=true TEST_MONGO_DATABASE_NAME=testvantagemovers_unit31 SHEET_SYNC_MODE=disabled pnpm test:granot-lifecycle:replica -- --unit=31: 8/8 passed
pnpm typecheck: passed
GRANOT_LIFECYCLE_REPLICA_TESTS=false pnpm test: passed
```

Admin gates:

```text
pnpm test: 234/234 passed
pnpm typecheck: passed
pnpm lint: passed
pnpm build: passed
```

`git diff --check` passed in both repositories. Checked-in lifecycle defaults remain processing/shadow true and every effect/email flag false.

## Authority boundary

No commit, push, merge, deployment, production/staging access or mutation, production migration/index apply, activation, flag enablement, Registry policy mutation, current payload/customer inspection, Owner business command, external provider/Sheet/CRM request, notification, or email occurred. Unit 31 certification is readiness evidence, not rollout authorization.
