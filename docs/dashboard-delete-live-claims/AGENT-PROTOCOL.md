# Agent protocol for this pack

Read this once before touching the issue.

## 1. Pick up the issue

1. Open [`PROGRESS.md`](PROGRESS.md). Take DLC-01 only while its status
   is `ready`.
2. Set it to `active`, add a start line to the issue log, and name the
   repository and branch. Do this before the first code edit.
3. Read the specification and the issue §4 in full.
4. Reverify §4 against the repository before writing code. Correct drift
   in the issue in the same change.

Stay on the branch this desk is already using when the tree is this
work. Do not open an extra feature branch unless the working tree is
clean of unrelated work and no desk branch exists. Server only.

## 2. Work the issue

- The specification wins. If the issue disagrees, follow the
  specification and fix the issue.
- Scope is the issue deliverables bounded by the specification’s out of
  scope. Do not add Mongoose delete middleware. Do not loosen Confirm.
- Write the failing AC tests first. Watch them fail for the dangling
  `booking_ref`. Then implement the shared helper.
- No commit, push, or production write unless the user asks.

## 3. Finish

1. Set DLC-01 to `complete` in `PROGRESS.md` only after the AC tests
   pass and `bookings.md` Delete mentions the release.
2. Add a finish line to the issue log: what changed, which AC ids
   passed, and any leftover risk.
