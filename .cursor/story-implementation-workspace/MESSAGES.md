# Messages

Open items first. Newest on top. Not knowledge.

## Open

## 2026-10-29T2234Z | to: next-run | from: impl-duplicate-lead-2026-10-29T2234Z | kind: next

Duplicate Lead is implemented on `refactor/form-lead-tests`. Not committed. No rename.

1. Take stock first. Read `NOW.md` and `BOARD.md` in this folder.
2. Do not write to `.cursor/story-refactor-workspace/`.
3. Do not stage the parked `formLead.service.test.ts`, the doc-packet deletions, `.quality.config.json`, or `docs/index.md` with this pass.
4. Do not start the next leads brief until the owner asks.
5. Full `tsc --noEmit` still fails in `formLead.service.test.ts` and `ops/output/pool-active-canonical-audit.ts`. Those files are outside this pass.

## 2026-10-29T2115Z | to: next-run | from: clean-code-directive | kind: next

Read `../story-refactor-workspace/DIRECTIVE.md` before the next story.

1. Next story is Duplicate Lead, on a new branch from current `origin/main`.
2. Form Lead and Call Lead renames are already on `origin/main`.
3. Do not implement drop rows or Best Relocation external sheet ingest. That ingest is not live.
4. The Operations Registry stays. Operational Events do not.
5. Parked Form Lead tests on `refactor/form-lead-tests` are unreviewed. Leave them.

## 2026-09-01T1449Z | to: next-run | from: review-call-lead | kind: next

Superseded for sequencing by the 2026-10-29 directive. The Call Lead note below is historical.

`call-lead` parity review passed. Committed on `refactor/call-lead-story`
and merged to local `main` only. Do not push.

1. Take stock first. Read `NOW.md` and `BOARD.md` in **this** folder.
2. Do not write to `.cursor/story-refactor-workspace/`.
3. Local `main` should include this commit plus `origin/main` story-refactor recs.
4. Next story: next `leads` rec in TRAVERSAL (`leads-duplicate-lead.md` unless origin reordered).

## 2026-08-28T2152Z | to: next-run | from: impl-call-lead-2026-08-28T2152Z | kind: next

`call-lead` is **implemented** on `refactor/call-lead-story`. Parity +
required review are done. Not committed.

1. Take stock first. Read `NOW.md` and `BOARD.md` in **this** folder.
2. Do not write to `.cursor/story-refactor-workspace/`.
3. Commit this branch if the user asks. Do not start the next `leads`
   rec until Call Lead is committed or the user says to switch.

## 2026-08-28T2130Z | to: next-run | from: impl-form-lead-2026-08-28T2130Z | kind: next

`form-lead` is **in-progress** on `refactor/form-lead-story`. Code and
docs are on the working tree. Required review subagent has not run yet
(skill landed after the first pass).

1. Take stock first. Read `NOW.md` and `BOARD.md` in **this** folder.
2. Do not write to `.cursor/story-refactor-workspace/`.
3. Do not start `leads-call-lead` until Form Lead is committed or the
   user says to switch.
4. Finish Form Lead: required review subagent, then commit if asked.
5. Next story after merge: `recommendations/leads-call-lead.md`.
