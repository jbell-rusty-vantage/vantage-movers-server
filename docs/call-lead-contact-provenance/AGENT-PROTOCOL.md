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

Work on the current desk branch if it already is this pack. Create
`call-lead-contact-provenance` only when that branch does not exist and
the working tree is clean of unrelated work. Cloud Agents already on
`cursor/call-lead-contact-provenance-*` stay on that branch. Do not open
extra feature branches per issue.

## 2. Work the issue

- The pack specification wins. If the issue disagrees, follow the
  specification and fix the issue.
- Scope is §6 bounded by §7. Do not widen. Cross-issue findings go in
  `PROGRESS.md`.
- Server writes, identity, preview, and search stay in
  `vantage-main-server`. Admin chips and Contact cards live in
  `vantage-admin` (CLCP-05). Extension apply/preview copy lives in
  `granot_sync_extensions_and_services` (CLCP-03) on that repo’s
  `main` (package `0.2.8`). Do not invent a second Call contact write
  path in the extension.
- If you are blocked, set the status to `blocked`, record the exact
  question, and stop.

## 3. Close an issue

An issue is `complete` only when every box in its §10 is checked with
evidence and every command in its §11 has been run.

1. Write `reports/CLCP-0<n>-completion.md` covering the issue's §14 list.
2. Update `PROGRESS.md`: status, specification-coverage ticks, issue log.
3. State what you did **not** do, and why.
4. After runtime TypeScript changes, run the issue's focused tests and
   `pnpm typecheck` when practical. CLCP-04 owns the docs-keeper pass.

## 4. Rules that override convenience

- **Never mark a criterion checked because it looks right.**
- **Never report complete with a failing or skipped required test.**
- **Never plan or write live `phone_number` / `normalized_phone_number`
  from Granot synchronize, HTTP apply, extension apply, or CSV.**
- **Never add Call `granot_contact_snapshot` to `findCallLeadsByScopedPhone`.**
- **Never mint on `booking_status_changed` or `priority_updated`.**
- **Never restore `syncCallLeadEnrichment` on HTTP or extension apply.**
- **Never enable a write flag, apply a [REDACTED] Registry row, deploy,
  or read a live customer payload** unless the user explicitly asks.
- **`PROGRESS.md` is a ledger, not an authority.**

## 5. Language

Use workspace-root `CONTEXT.md`. Operational phone is the ingested
caller. Later match synchronizes. Job Number coalesces the Granot card.
Automatic booking-intake discovery is Job, else granularity +
operational phone. Desk search is any known contact. Owner labels:
Called / Granot / Changed in Granot.
