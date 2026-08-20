# Vantage Granot lifecycle — Unit 34, merge, and production-deploy handoff

**Prepared:** 2026-08-20 (America/New_York)

**Next-session objective:** Finish Unit 34 evidence, commit the two feature branches, merge/fast-forward them into `main`, trigger both production deployments with fresh Owner permission, verify production, and handle the separately authorized write-once lifecycle activation.

## Authority and safety boundaries

- The Owner wants the Granot lifecycle released tonight and explicitly overrides the repository's staged rollout recommendation. The requested production posture enables Lead, Booking, Release, Referral, and RingCentral adoption together; email remains disabled.
- The Owner explicitly authorized mutation of **only** the disposable database named `testvantagemovers_unit34cert` for Unit 34 certification. That permission was used successfully.
- No production database read or mutation has occurred in this session. No Git commit, push, merge, deployment, flag mutation, Registry mutation, activation, or external customer communication has occurred.
- Do not use browser automation. The Owner asked the agent to stay with code, Git, and deployment. The Owner is setting Vercel environment variables manually.
- Before pushing either repository's `main`, obtain fresh explicit Owner permission. A push to `main` triggers the respective GitHub Actions Vercel production workflow.
- The write-once production activation/cutoff is a separate state-changing action. Obtain explicit permission for it after deployment unless the Owner clearly includes it in a new authorization.
- Unit 34 authorizes no production payload replay. Never print or commit raw webhook payloads.

## Suggested skills

- `handoff`: only if this work needs to be compacted again.
- No browser-control skill: the Owner expressly asked not to use browser automation.
- Use normal repository tooling for code, Git, GitHub Actions monitoring, and Vercel CLI/workflow inspection. If a relevant deployment skill becomes available, read it before deployment.

## Authoritative repository documents

Read these rather than reconstructing the contract here:

- `scripts/prototypes/granot-lead-lifecycle/delivery/issues/UNIT-34.md`
- `scripts/prototypes/granot-lead-lifecycle/delivery/AGENT-EXECUTION-RUNBOOK.md`
- `scripts/prototypes/granot-lead-lifecycle/delivery/completion-reports/UNIT-33-COMPLETION.md`
- `scripts/prototypes/granot-lead-lifecycle/specs/FINAL-SPECIFICATION-GRANOT-LEAD-LIFECYCLE.md`
- Production rollout references under `vantage-main-server/docs/granot-lead-lifecycle/`.

## Current repository state

### `vantage-main-server`

- Branch: `granot-lead-lifecycle`
- Starting HEAD: `2f210f4`
- At last fetch/audit: 50 commits ahead and 0 behind `origin/main`; tracked feature ref was 15 commits behind the local feature branch. Fetch again before release.
- Uncommitted Unit 34 changes:
  - `package.json`: adds `granot:lifecycle:unit34:sanitize` and `granot:lifecycle:unit34:seed`.
  - `scripts/test-granot-lifecycle-replica.ts`: registers Unit 34, requires an absolute sanitized-input path, gates current-shape tests, runs safe deterministic flags, and performs the queued second phase.
  - New `scripts/granot-lifecycle-unit34/` sanitizer, scanner tests, current-shape tests, and disposable seed.
  - Deleted `scripts/prototypes/granot-lead-lifecycle/delivery/issues/WEBHOOK-RECEIPT-PAYLOAD-EXAMPLES.md` at the Owner's request because it contained copied receipt examples. Do not restore or inspect it.
- Still needs dated certification/completion artifacts:
  - `scripts/prototypes/granot-lead-lifecycle/delivery/certification/UNIT-34-CERTIFICATION-2026-08-20.json`
  - `scripts/prototypes/granot-lead-lifecycle/delivery/certification/UNIT-34-CERTIFICATION-2026-08-20.md`
  - `scripts/prototypes/granot-lead-lifecycle/delivery/completion-reports/UNIT-34-COMPLETION.md`

### `vantage-admin`

- Branch: `granot-lead-lifecycle`
- HEAD at audit: `9fe8c23`
- At last fetch/audit: 16 commits ahead and 0 behind `origin/main`; tracked feature ref was 11 commits behind local.
- Uncommitted release cleanup:
  - whitespace/EOF cleanup in `.gitignore`, five lifecycle route/component files, and `uxdocs/owner-daily-view-planned.txt`;
  - removed a stale pointer to a deleted proposal from `uxdocs/index.txt`.
- Admin consumes lifecycle health from the server. It does **not** read any of the ten `GRANOT_LIFECYCLE_*` variables or `RINGCENTRAL_GRANOT_ADOPTION_ENABLED`.

### `granot_sync_extensions_and_services`

- No expected changes. Final verification was green.

## Unit 34 custody and current-shape evidence

- The Owner stated that the tracked examples were copied from `granot_webhook_receipts` and approved them as the current input source. A temporary copy was made outside the repository before deleting the tracked file.
- Approved custody policy: delete raw and sanitized temporary copies after certification. Do not record their absolute paths or contents in tracked artifacts.
- Deterministic sanitizer result: 6 payloads across 4 schema families; scanner found 0 credential, PII, realistic-contact, or custody-path findings.
- Safe schema-only inventory:

| Family              | Count | Route class                         | Schema fingerprint                                                 |
| ------------------- | ----: | ----------------------------------- | ------------------------------------------------------------------ |
| `current_shape_001` |     1 | `lead_created`                      | `0ee2407f21fd4e8879681130854faef710c02a5e72ee65c5972b0a338a7df73d` |
| `current_shape_002` |     1 | `priority_updated`                  | `545dfd583b4d395b7ec81524c7cc7794ceaa61672cf38958c1d615ace7058bea` |
| `current_shape_003` |     3 | `booking_status_changed`            | `abcb0091405ca5cf1fa893bf160a8feab449b41da2b3d4c6716e411c49a541e3` |
| `current_shape_004` |     1 | no compatible route (empty payload) | `ed2ac5d0e3e4831e24d2fa2be8b1a548a6f9530128903f9b16cf5154350ecaca` |

- The gated current-shape suite passed 8/8 and exercises all three production webhook routes. The empty family fails closed; downstream minimum-data rules prevent unsafe creation.
- Do not query production receipts unless the Owner grants a new, precise permission and Unit 34 custody rules are satisfied. Existing current-shape evidence is sufficient.

## Certification environment and results already green

- Exact disposable Mongo database: `testvantagemovers_unit34cert`.
- The database name and isolated posture were validated before mutation. The database was dropped, seeded with synthetic fixtures, and used only with `TEST_MODE=true` and Sheet delivery disabled or queue publication blocked.
- Seed: 1 synthetic company, 3 granularities, 5 reviewed synthetic source definitions, and 1 redacted receipt.
- All five migration packages completed **report → apply → verify** successfully on the disposable database:
  - receipts;
  - source Registry;
  - Lead provenance;
  - aggregate revisions;
  - indexes.
- Post-migration Unit 34 replica certification passed:
  - core phase: **69/69 passed**, 0 failed;
  - publication-blocked queued-outbox phase: **19/19 passed**, 0 failed.
- Queue evidence includes durable outbox enqueueing and explicit `queue publishing disabled for this environment`; no Google delivery occurred.
- Required focused server matrix: 131 total, 129 passed, 2 intentional replica opt-in skips, 0 failed.
- Full server suite with replica tests explicitly disabled: 1,520 total, 1,434 passed, 86 expected skips, 0 failed.
- Server `pnpm typecheck`: passed, including after adding the Unit 34 seed.
- Sanitizer unit tests: 3 passed; gated current shapes: 8 passed.
- Admin: 234/234 tests, lint, typecheck, and production build (41 routes) passed.
- Extension: 146/146 tests, compile, Chrome production build, and Firefox production build passed.
- Earlier attempts against the shared base test database encountered legacy/test-state interference and inherited local live flags. Those were environment defects, not product failures; the isolated database and explicit safe runner resolved them.

## Next actions — exact order

1. Write the three dated PII-safe Unit 34 artifacts listed above using `apply_patch`.
   - Record current family counts/fingerprints, scanner 0, isolated environment, all five migration gates, test counts, queue/Sheet evidence, AC coverage, defect classification, and external-action disclosure.
   - Recommendation: `go` for isolated application logic only; explicitly state this is not rollout authorization.
   - State Unit 32 was skipped and no email behavior was added.
   - Record the Owner's release override separately from certification posture: all requested Booking/Release/Referral flags may be enabled together once deployment/activation is authorized.
   - Never include raw payload values, customer identifiers, credentials, or custody paths.
2. Scan the new artifacts for secrets/PII/path leakage. Run `git diff --check`, focused sanitizer/current-shape tests if necessary, and final server typecheck.
3. Delete the exact approved raw and sanitized temporary custody directories only after the durable artifacts are complete. Validate the resolved absolute targets remain beneath the Windows temporary directory before recursive deletion. Report that this data is unrecoverable.
4. Drop only the exact disposable database `testvantagemovers_unit34cert` after evidence is complete. Validate the exact name again first. Report that the synthetic database is unrecoverable; migration manifests remain ignored local evidence.
5. Inspect final `git status`, diffs, and branch divergence in all three repositories. Fetch origins. Do not overwrite unrelated user work.
6. Present the release-ready summary and request one explicit authorization covering:
   - commit the Unit 34 server changes and admin cleanup;
   - push both feature branches;
   - fast-forward/merge both into `main` and push `origin/main`;
   - allow the two resulting GitHub Actions production deployments;
   - optionally, whether the same authorization includes the separate write-once lifecycle activation/cutoff.
7. After authorization, commit on each feature branch, push feature branches, update each `main` without rewriting history, and push. Monitor GitHub Actions with authenticated CLI/API rather than browser automation.
8. Verify both production deployments, server health, queue/cron configuration, index/Registry posture, and admin-to-server health projection. If workflows fail, diagnose without silently changing production state.
9. With separate activation permission, create the write-once Owner activation/cutoff. Pre-activation receipts remain historical shadow and must not be promoted.
10. Verify post-activation processing and the all-enabled Owner-approved posture over a bounded operating interval. Preserve receipts, decisions, links, commands, changes, cases, and outbox evidence on rollback.

## Production Vercel settings the Owner is applying

These belong to `vantage-main-server` Production, not `vantage-admin`:

```text
GRANOT_LIFECYCLE_PROCESSING_ENABLED=true
GRANOT_LIFECYCLE_SHADOW_MODE=false
GRANOT_LIFECYCLE_LEAD_WRITES_ENABLED=true
GRANOT_LIFECYCLE_LEAD_CREATION_ENABLED=true
GRANOT_LIFECYCLE_BOOKING_CASES_ENABLED=true
GRANOT_LIFECYCLE_BOOKING_COMMANDS_ENABLED=true
GRANOT_LIFECYCLE_RELEASE_CASES_ENABLED=true
GRANOT_LIFECYCLE_RELEASE_COMMANDS_ENABLED=true
GRANOT_LIFECYCLE_REFERRAL_BOOKING_ENABLED=true
GRANOT_LIFECYCLE_EMAIL_ENABLED=false
RINGCENTRAL_GRANOT_ADOPTION_ENABLED=true
SHEET_SYNC_MODE=queued
```

Also verify `RINGCENTRAL_CREATE_CALL_LEADS=true`; RingCentral adoption mutates only in create mode. Verify `CRON_SECRET`, lifecycle queue configuration, Sheet queue/Google targets, processed-call unique indexes, the Call Log singleton index, and RingCentral lease/cursor health.

Admin needs no Granot lifecycle flags. Its existing production contract requires the database/auth secrets, production server base URL/API secret, and a proxy-signing secret matching the server. `VANTAGE_API_PROTECTION_BYPASS` must not be present in Production.

## Deployment mechanics and rollback

- Both repositories have native Vercel Git deployment disabled in `vercel.json`.
- Their GitHub Actions production workflows trigger on push to `main`; therefore pushing `main` is the production-deployment action and requires explicit permission.
- Safe lifecycle rollback if needed:
  1. disable `GRANOT_LIFECYCLE_LEAD_CREATION_ENABLED`;
  2. disable `RINGCENTRAL_GRANOT_ADOPTION_ENABLED` for RingCentral mutation;
  3. disable the narrowest affected Booking/Release/Referral command or case flag;
  4. set `GRANOT_LIFECYCLE_SHADOW_MODE=true`.
- Keep receipt capture on. Never delete the activation row or production lifecycle evidence to simulate rollback.

## Completion condition

The overall goal is complete only when Unit 34 artifacts are committed, both repositories are merged/pushed to `main`, both production deployments are verified, and the Owner-directed activation outcome is explicitly resolved. Do not mark the goal complete merely because certification passed.
# Unit 34 continuation to production

This handoff was consumed on 2026-08-20. Durable PII-safe certification evidence and the completed-unit record now live at:

- `../../certification/UNIT-34-CERTIFICATION-2026-08-20.md`
- `../../certification/UNIT-34-CERTIFICATION-2026-08-20.json`
- `../UNIT-34-COMPLETION.md`

The production release outcome, deployment verification, and the separately resolved write-once activation decision belong in the final release handoff rather than this pre-release continuation note.
