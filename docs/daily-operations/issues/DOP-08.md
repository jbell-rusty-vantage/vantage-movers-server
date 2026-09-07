# DOP-08 — Browser proof and docs

> **Contract maturity: implementation-ready.** Session 6. Walk the
> Owner board. Point docs at what actually shipped. **No new
> features.**

## 1. Authority and required reading

- **Pack specification:** [`../daily-operations-specification.md`](../daily-operations-specification.md)
  — §23 (done at 2:14pm), §21, §24.
- **Pack rules:** [`../README.md`](../README.md), [`../AGENT-PROTOCOL.md`](../AGENT-PROTOCOL.md),
  [`../LOCAL-ADMIN.md`](../LOCAL-ADMIN.md)
- **Docs-keeper:** invoke after the walk so knowledge / admin map
  match the code.
- **Glossary:** workspace-root `CONTEXT.md`

## 2. Objective

Prove the Owner can read the day from `/daily`: counts, pace, mix,
category panels, held texts, zip miss, and links into existing desks.
Then update pointers so the next agent does not implement the
pre-spec one-feed layout or the 2026-08-19 tabbed Daily View.

## 3. Repository, branch, and prerequisites

- **Repositories:** `vantage-admin` (walk) and pack / knowledge
  pointers in `vantage-main-server` (and admin map if still stale).
- **Prerequisites:** DOP-02, DOP-03, and DOP-07 `complete`.
- No 21st.dev.
- No commit, push, deploy, or live payload read unless asked.
- Do not paste `ADMIN_SEED_*` or KV tokens.

## 4. Current-state evidence to verify

Reverify against the repository at pickup — DOP-01–07 will have
moved files.

- `/daily` exists and is Owner-only.
- Snapshot + live routes exist.
- Pre-spec README / `docs/index.md` / admin CONTEXT may still point
  at the pre-spec; this issue finishes that cutover if earlier
  issues did not.

## 5. Locked decisions and invariants at risk

- Do not add features to "make the walk prettier."
- Do not implement the 24h/48h tabbed view.
- Do not read live customer payloads into the report; use local /
  synthetic / redacted facts.
- Repository is authoritative; fix the ledger if it disagrees.

## 6. Deliverables and exact contract

1. Browser walk (LOCAL-ADMIN):
   - Sign in as Owner. `/daily` shows tiles + panels.
   - Pace line is yesterday-at-this-hour.
   - Origins / companies (zeros visible).
   - Focus `?lane=lead` and `?lane=text`.
   - Quiet priorities.
   - Open a Lead, an intake (or show the empty honest state), Job
     Timeline if a Job Number exists, Live Events from a Granot card
     if one exists.
   - Admin role cannot open `/daily`.
   - Confirm is not on `/daily`.
2. Completion report with screenshots **or** a written walk (no
   secrets, no live PII).
3. Knowledge Service stub + `docs/index.md` + admin map + this pack
   README status. Invoke docs-keeper.
4. Tick PROGRESS specification coverage.

## 7. Out of scope

- New kinds, new hooks, Redis redesign.
- Production deploy / flag changes.

## 8. Tests

Re-run the package checks the earlier issues named if you touch
code. Prefer no code changes.

## 9. Knowledge updates after this issue ships

This issue **owns** them:

- `vantage-main-server/docs/knowledge/services/daily-operations.md`
  (or the path docs-keeper chooses) — pointer, not a second spec.
- `docs/index.md` catalog + delivery pack row.
- `vantage-admin/CONTEXT.md` and
  `.cursor/rules/project-organization.mdc` Daily Operations sentence.
- Pack README status → ready/complete as appropriate.

## 10. Acceptance criteria

- [ ] Owner walk covers tiles, pace, at least three panels, one
      deep link, live indicator.
- [ ] Held-text and zip-miss are demonstrated **or** explicitly
      recorded as "no local fact today" with the code path named.
- [ ] Admin role blocked.
- [ ] Docs point at the formal spec, not the pre-spec, as the
      working contract.
- [ ] docs-keeper invoked; report names the files it changed.
- [ ] PROGRESS coverage table ticked.

## 11. Commands

```bash
cd vantage-admin && pnpm test && pnpm typecheck
cd vantage-main-server && pnpm okf:query --type Service --tag daily-operations
```

Browser walk per LOCAL-ADMIN.

## 12. Risks

- Walking an empty local day and calling it broken — empty panels
  have copy; say that.
- Leaving the pre-spec as the index "working contract."
- Pasting credentials or live contact.

## 13. Rollback

Docs-only. Revert pointer commits if asked.

## 14. Handoff list for the completion report

- Walk steps and outcomes.
- Gaps vs spec §23.
- Doc files updated.
- What remains out of v1.

**Unblocks:** nothing in this pack. Daily Operations is Owner-ready
when this issue is `complete`.
