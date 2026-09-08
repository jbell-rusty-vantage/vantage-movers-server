# Agent protocol for this pack

Read this once before touching an issue. It is short on purpose.

## 1. Pick up an issue

1. Open [`PROGRESS.md`](PROGRESS.md). Take an issue whose status is `ready`.
   Never start a `blocked` or `deferred` issue.
2. Set its status to `active`, add your start entry to the issue log, and say
   which repositories and branch you are on. Do this **before** the first
   edit, so a second agent does not pick up the same issue.
3. Open the issue and read §1 (authorities) and the specification sections
   it names.
4. **Reverify current-state bullets against the repository before writing
   code.** Anything that has drifted, you correct in the issue in the same
   change as your work.

Work on the branch this desk already uses if the tree is otherwise this
work. Create `exact-job-booking-attach` only when that branch does not
exist and the working tree is clean of unrelated work. Do not open extra
feature branches per issue.

## 2. Work the issue

- [`exact-job-booking-attach-specification.md`](exact-job-booking-attach-specification.md)
  wins. If the issue disagrees, follow the specification and fix the issue.
- Scope is the issue deliverables bounded by the specification §11.
  If you find real work that belongs to another issue, write it into that
  issue and into the **Cross-issue findings** table in `PROGRESS.md` —
  do not do it.
- Keep each change in the repo that owns it. Server code stays in
  `vantage-main-server`. Admin UI stays in `vantage-admin`.
- Owner-visible Precise Booking Form strings go in one copy module next
  to the form. Reconciliation desk strings stay in that desk’s copy.
  Do not inline Owner sentences in JSX.
- If you are blocked, set the status to `blocked`, record the exact
  question in the issue log, and stop.

## 3. Close an issue

An issue is `complete` only when every acceptance box is checked with
evidence and the named test / typecheck commands have been run.

1. Write `reports/EJBA-0<n>-completion.md`.
2. Update `PROGRESS.md`: status → `complete`; tick specification coverage;
   unblock the next issue; append the closing log entry.
3. State plainly what you did **not** do, and why.
4. After runtime or Admin UI changes, invoke **docs-keeper** so knowledge
   docs describe the code that shipped. EJBA-04 is the dedicated knowledge
   pass after EJBA-02 and EJBA-03.

## 4. Rules that override convenience

- **Never auto-attach on phone, email, name, or LID** on Employee submit,
  rematch, or Precise Booking Form Call Lead create.
- **Never mint an Unmatched Call Lead** from `/bookings/new`.
- **Never fail the Booking** because no Lead matched. Open a case.
- **Never open a Booking Lead Reconciliation Case from Confirm Granot Booking.**
- **Never implement Connect on `/bookings/reconciliation`.**
- **Never change `identity.ts` or Confirm `HIGH_CONFIDENCE_BOOKING_MATCH_METHODS`.**
- **Never change Best Relocation import matching** unless an issue
  explicitly says to.
- No commit, push, deploy, or live customer read unless the user asks.
- After TypeScript changes: `pnpm test` and `pnpm typecheck` in the repos
  you touched. After Admin UI changes, verify in the browser at
  **http://localhost:3000**. The local API is on **3001**.

## 5. Language rule

Use glossary terms from workspace-root `CONTEXT.md`. A case is not a
Booking. Connect Booking to Lead is not Booking Lead Reconciliation.
Sheet `synced` is not Google-equals-Mongo.
