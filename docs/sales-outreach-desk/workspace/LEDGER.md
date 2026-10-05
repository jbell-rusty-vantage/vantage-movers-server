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
| 2026-10-05 ~02:30 | **S1 SRV-3 models merged early** (`3603fde1` → merge `f5934d25`): typecheck green, `ops/lib/sales-outreach-indexes.test.ts` + `src/models/salesOutreach/models.test.ts` 8/8, eslint on merged files clean. Pushed for S3. |
| 2026-10-05 ~02:50 | **S1 phase 1 merged** (SRV-1 `32d6ee9d`, SRV-2 `c6e8e7d3`, docs `0b0de567` → merge `3c4c8030`). Gate on the merged branch: full unit suite (`--test-concurrency=2`) 2632 tests, 2493 pass, 1 fail (pre-existing `attachment/wiring.test.ts` Mongo timeout), 138 skipped. Pushed. SRV-1 and SRV-2: review (unit-green; replica proofs owed). |
| 2026-10-05 ~02:50 | **Packet defect (not fixed, packet is read-only tonight):** `validate.mjs` passes in the main Windows checkout but fails with 15 "Hash differs: sources/…" in every fresh worktree. `PACKET-MANIFEST.json` hashed this checkout's CRLF working files (autocrlf), while the committed blobs are LF, so any clean LF checkout (cloud, CI, worktree) fails. Fix: regenerate the manifest from the committed LF bytes (or pin `eol` for the packet in `.gitattributes`). Owner: packet maintainer. |
| 2026-10-05 ~02:55 | **Quality checkpoints paused for the server repo** (`node ops/quality/cli.mjs pause`). A turn-end run (1791168583062-664e38f4) failed at checks with `git stash pop -q failed: No stash entries found`; nothing was applied. The worker uses the stash stack shared by all worktrees and runs a typecheck, which is unsafe with two lane agents running on this memory-limited machine. Resume with `pnpm quality:resume` in the morning. |
