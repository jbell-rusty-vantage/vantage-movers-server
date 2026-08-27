# Agent protocol for this pack

Read this once before touching an issue. It is short on purpose.

## 1. Pick up an issue

1. Open [`PROGRESS.md`](PROGRESS.md). Take an issue whose status is `ready`.
   Never start a `blocked` or `deferred` issue.
2. Set its status to `active`, add your start entry to the issue log, and say
   which repositories and branch you are on. Do this **before** the first
   edit, so a second agent does not pick up the same issue.
3. Open the issue and read §1 (authorities) and §4 (current-state evidence)
   in full.
4. **Reverify §4 against the repository before writing code.** It was
   observed on 2026-08-27. Anything that has drifted, you correct in the
   issue in the same change as your work.

Suggested kickoff branch in both app repos: `job-timeline-enhancement`.
Create it only if it does not exist and the working tree is clean of
unrelated work. Do not open extra feature branches for later slices.

## 2. Work the issue

- The enhancement specification wins on additive behavior. The prototype
  specification wins on event truth, correlation, and masking. If the issue
  disagrees with either, follow the specification and fix the issue.
- Scope is §6 (deliverables) bounded by §7 (out of scope). Do not widen. If
  you find real work that belongs to another issue, write it into that
  issue and into the **Cross-issue findings** table in `PROGRESS.md` — do
  not do it.
- Keep each change in the repo that owns it. Server code stays in
  `vantage-main-server`. Admin UI stays in `vantage-admin`.
- If you are blocked, set the status to `blocked`, record the exact
  question in the issue log, and stop. A blocked issue with a precise
  question is a good outcome; an issue that guessed is not.

## 3. Close an issue

An issue is `complete` only when every box in its §10 acceptance criteria
is checked with evidence and every command in its §11 has been run and its
output recorded.

1. Write `reports/JTE-0<n>-completion.md` covering the issue's §14 handoff
   list.
2. Update `PROGRESS.md`:
   - status → `complete`;
   - tick the issue's rows in the **Specification coverage** table;
   - move any issue it unblocks from `blocked` to `ready`;
   - append the closing entry to the issue log.
3. State plainly in the report what you did **not** do, and why.
4. After runtime or Admin UI changes, invoke the **docs-keeper** agent so
   `docs/knowledge/services/job-number-timeline.md` and the glob-scoped
   rules describe the code that actually shipped — not the next issue.

## 4. Rules that override convenience

- **Never mark a criterion checked because it looks right.** Check it
  because you ran something and saw the result. Paste the result.
- **Never report an issue complete with a failing or skipped test.**
  Report it incomplete and say which criterion failed.
- **Never invent a lifecycle event to complete a visual stage.** Name the
  limitation instead.
- **Never import `scripts/prototypes/job-number-timeline` from a runtime
  `src/` file after JTE-01.** The CLI may adapt over the production module;
  the route may not.
- **Never enable a write, apply a production index, deploy to production,
  or read a live customer payload** unless the user explicitly asks. JTE-05
  live proof is masked and count-stable; JTE-06/JTE-07 writes need separate
  approval.
- **`PROGRESS.md` is a ledger, not an authority.** If it disagrees with the
  repository, the repository is right and you fix the ledger.

## 5. Language rule

Use glossary terms from workspace-root `CONTEXT.md`. Do not say a case is
a Booking or a Cancellation. Do not say Sheet `synced` means Google equals
Mongo. Do not say a WordPress Lead creation is a source receipt. Owner-facing
copy uses the enhancement specification's labels, not internal coverage
flags.
