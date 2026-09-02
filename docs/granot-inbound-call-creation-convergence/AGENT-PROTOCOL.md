# Agent protocol for this pack

Read this once before touching an issue. It is short on purpose.

## 1. Pick up an issue

1. Open [`PROGRESS.md`](PROGRESS.md). Take an issue whose status is `ready`.
   Never start a `blocked` or `deferred` issue.
2. Set its status to `active`, add your start entry to the issue log, and
   say which repository and branch you are on. Do this **before** the
   first edit.
3. Open the issue and read §1 (authorities) and §4 (current-state
   evidence) in full.
4. **Reverify §4 against the repository before writing code.**

Work on the current Granot / RingCentral desk branch if that is already
this work. Create `granot-inbound-call-creation-convergence` only when
that branch does not exist and the working tree is clean of unrelated
work. Do not open extra feature branches per issue.

## 2. Work the issue

- The pack specification wins. If the issue disagrees, follow the
  specification and fix the issue.
- Scope is §6 bounded by §7. Do not widen. Cross-issue findings go in
  `PROGRESS.md`.
- Server code stays in `vantage-main-server`.
- If you are blocked, set the status to `blocked`, record the exact
  question, and stop.

## 3. Close an issue

An issue is `complete` only when every box in its §10 is checked with
evidence and every command in its §11 has been run.

1. Write `reports/GICC-0<n>-completion.md` covering the issue's §14 list.
2. Update `PROGRESS.md`: status, specification-coverage ticks, issue log.
3. State what you did **not** do, and why.
4. After runtime changes, invoke the **docs-keeper** agent for the
   matching knowledge layer. GICC-03 owns the doc pass if GICC-01/02
   left a note.

## 4. Rules that override convenience

- **Never mark a criterion checked because it looks right.**
- **Never report complete with a failing or skipped required test.**
- **Never create on `booking_status_changed` or Form `priority_updated`.**
- **Never close Form `lead_created` + `create_if_missing`.**
- **Never invent a fourth `lead_created_policy` value, inbound mint
  boolean, or ninth gate. Do not change `sourcePolicy.ts`.**
- **Never widen match to Source Company alone.**
- **Never ungate the RingCentral ingest lock to make the Granot fence
  always on.**
- **Never enable a write, apply a production Registry row, deploy, or
  read a live customer payload** unless the user explicitly asks.
- **`PROGRESS.md` is a ledger, not an authority.**

## 5. Language

Use workspace-root `CONTEXT.md`. Do not invent a second matching system.
RingCentral-first is synchronize. Granot-first is RingCentral Call
Adoption.
