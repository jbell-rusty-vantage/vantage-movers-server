# Agent protocol for this pack

Read this once before touching an issue. It is short on purpose.

## 1. Pick up an issue

1. Open [`PROGRESS.md`](PROGRESS.md). Take an issue whose status is
   `ready`. Never start a `blocked` or `deferred` issue.
2. Set its status to `active`, add your start entry to the issue log,
   and say which repository and branch you are on. Do this **before**
   the first edit, so a second agent does not pick up the same issue.
3. Open the issue and read §1 (authorities) and §4 (current-state
   evidence) in full.
4. **Reverify §4 against the repository before writing code.** It was
   observed on 2026-09-14. Anything that has drifted, you correct in
   the issue in the same change as your work.

Work on the branch this desk already uses for Granot lifecycle /
booking intake if that branch exists and the tree is otherwise this
work. Create `referral-review-release-first` only when that branch
does not exist and the working tree is clean of unrelated work. Do
not open extra feature branches per issue. Server and Admin are
separate git roots — stay in the issue’s repository.

## 2. Work the issue

- The pack specification wins. If the issue disagrees, follow the
  specification and fix the issue.
- Scope is §6 (deliverables) bounded by §7 (out of scope). Do not
  widen. If you find real work that belongs to another issue, write
  it into that issue and into the **Cross-issue findings** table in
  `PROGRESS.md` — do not do it.
- RRF-01 stays in `vantage-main-server`. RRF-02 stays in
  `vantage-admin`. RRF-03 is docs-keeper on main-server knowledge.
- Write failing tests first (RRF-01). Do not loosen
  `referralBooking.ts` minting to make a review test pass.
- If you are blocked, set the status to `blocked`, record the exact
  question in the issue log, and stop.

## 3. Close an issue

An issue is `complete` only when every box in its §10 acceptance
criteria is checked with evidence and every command in its §11 has
been run and its output recorded.

1. Write `reports/RRF-0<n>-completion.md` covering the issue’s §14
   handoff list.
2. Update `PROGRESS.md`:
   - status → `complete`;
   - tick the issue’s rows in the **Specification coverage** table;
   - move any issue it unblocks from `blocked` to `ready`;
   - append the closing entry to the issue log.
3. State plainly in the report what you did **not** do, and why.

## 4. Rules that override convenience

- **Never mark a criterion checked because it looks right.** Check it
  because you ran something and saw the result. Paste the result.
- **Never report an issue complete with a failing or skipped test.**
- **Never change persist `$push` or `assertActiveSourceScope`.**
- **Never mint a second Booking** or splice Booked into `evidence[0]`.
- **Never enable a write, deploy to production, or mutate live
  customer data** unless the user explicitly asks.
- **`PROGRESS.md` is a ledger, not an authority.** If it disagrees
  with the repository, the repository is right and you fix the ledger.

## 5. Language rule

Use glossary terms from workspace-root `CONTEXT.md`. Say **Referral
Booking**, **No Action**, **Granot Observation**, **booking intake**.
Do not say “dismiss,” “ignore,” or “policy inactive” for this 409.
