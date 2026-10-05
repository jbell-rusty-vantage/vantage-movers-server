# Local task ledger

Preparation state as of 2026-10-04: ready for cloud implementation, with no task claimed or accepted. Record repository, branch, HEAD and initial dirty files when you claim. Work packages are defined in [IMPLEMENTATION-PLAN.md](../IMPLEMENTATION-PLAN.md) §7.

| ID | Lane | Depends on | Status | Claimed files / checkout | Evidence / next handoff |
| --- | --- | --- | --- | --- | --- |
| SRV-0/1/2/3/7/8/9/T | Server S1 foundation & API | none | claimed | overnight coordinator; worktree `../vantage-main-server-s1`, branch `feat/outreach-desk-s1` from `c4209ad2`, clean | models early → S3; DTOs → ADMIN |
| SRV-4 | Server S2 engine | none | claimed | overnight coordinator; worktree `../vantage-main-server-s2`, branch `feat/outreach-desk-s2` from `c4209ad2`, clean | engine types → S1/S3 |
| SRV-5 | Server S3 capture | none | ready | queued after S2 (max 2 lanes) | E01 proof script → operator |
| SRV-6 | Server S3 goals/evidence | SRV-3 models | ready | queued after S2 (max 2 lanes) | → S1 reads |
| ADM-1/2/7 | Admin A1 roles/route/BFF | none | ready | unclaimed | → A2 |
| ADM-3/4/5/6/8 | Admin A2 desks | mock DTOs; server DTOs later | ready | unclaimed | → VERIFY |
| RELEASE M1 | Deploy + operate call progress (FAST-01) | M1 pieces merged + verified on replica | blocked | — | evidence/RELEASE.md |
| RELEASE M2 | Deploy full desk + backfill + controls on | M2 verified on replica | blocked | — | evidence/RELEASE.md |
| VERIFY | Integrated replica + browser | server + admin merged into feat/outreach-desk | blocked | — | END-TO-END-RUN §3–§5 evidence |

Allowed states: ready, claimed, in_progress, review, blocked, accepted. Only VERIFY or the coordinator marks a cross-service item accepted, and only with evidence. A blocking issue names the decision or proof ID, the concrete failing scenario, the owning lane and what it depends on. A skipped test is not accepted.

## Overnight local run log (server, 2026-10-04 → 05)

Coordinator: local Claude Code session on this Windows machine, running the server lanes as sub-agents in git worktrees (`../vantage-main-server-s1`, `-s2`, `-s3`), each with its own real `pnpm install`. At most 2 lanes at once; order S2 + S1, then S3. Heavy commands (install, typecheck, full lint, full test suite) are serialized machine-wide through a mkdir lock; full suites use `--test-concurrency=2`. Lanes commit on their lane branch; the coordinator re-runs the gates and merges into `feat/outreach-desk` (no force-push), then pushes `feat/outreach-desk` to origin as a backup. Nothing is pushed to `main`, deployed or run against production.

| When (UTC) | Entry |
| --- | --- |
| 2026-10-05 ~01:30 | Start. `feat/outreach-desk` = `main` = `c4209ad2`. Baseline `pnpm typecheck` green (35 s). |
| 2026-10-05 ~01:30 | **Replica owed.** Docker container `csi01` (127.0.0.1:27189) is `Exited (255)`; port closed. Per the run instructions Docker is not restarted and the container is not started unattended. Every replica runner (existing `test:*:replica` and any new `test:outreach:replica`) is skipped tonight and owed to the next session with the replica up. Lanes still write the replica tests; they are recorded as "written, not run". |
