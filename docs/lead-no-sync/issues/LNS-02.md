# LNS-02 — Owner mark / unmark via `updateSourceOwnedLead`

> **Contract maturity: implementation-ready.** Session 2. Let the Owner
> flip `no_sync` on an existing Lead. **No desk filter. No Manual
> checkbox (LNS-03).**

## 1. Authority and required reading

- **Pack specification:** [`../lead-no-sync-specification.md`](../lead-no-sync-specification.md)
  — §5.3, §6.6, §7, §10.2 (PATCH cases), §12.4.
- **Pack rules:** [`../README.md`](../README.md), [`../AGENT-PROTOCOL.md`](../AGENT-PROTOCOL.md)
- **Depends on:** [LNS-01](LNS-01.md) planner deletes and contains skip.
- **Glossary:** workspace-root `CONTEXT.md`
- **Pattern:** `MarkBadLeadControl` → `updateSourceOwnedLead`

## 2. Objective

The Owner marks a stored Lead Off Master Leads. The PATCH writes
`no_sync`, an EntityChange, and a `source_lead` job that deletes every
Master Leads row. Clearing the mark enqueues the job that upserts the
current tab.

## 3. Repository, branch, and prerequisites

- **Repositories:** `vantage-main-server` then `vantage-admin`.
- **Branch:** same desk branch as LNS-01.
- **Prerequisites:** LNS-01 `complete`.
- No commit, push, deploy, or live payload read unless asked.

## 4. Current-state evidence to verify

Observed 2026-09-06; **reverify at implementation**. LNS-01 will have
added the field and planner.

- `runExistingUpdateSourceOwnedLead` is the PATCH adapter.
  `command_name` is `updateSourceOwnedLead`.
- `updateFormLeadSchema` / `updateCallLeadSchema` are `.strict()`.
- `FORM_LEAD_CHANGE_PATHS` / `CALL_LEAD_CHANGE_PATHS` omit `no_sync`
  until this issue.
- Empty field diff → no EntityChange, no outbox.
- `MarkBadLeadControl` PATCHes `{ bad_lead }` on Form only.
- Edit form uses `updateProductionRecord` → the same PATCH.

## 5. Locked decisions and invariants at risk

- Same command. No new command name.
- Booked, cancelled, Duplicate, and Bad Leads may be marked or cleared.
- `false`/`absent` → `true` enqueues `source_lead` update (deletes).
- `true` → `false` enqueues `source_lead` update (upsert current tabs).
- No change → existing no-op.
- Owner copy: **Off Master Leads**. Never print `no_sync`.
- Copy in `operational-copy.ts`.

## 6. Deliverables and exact contract

### 6.1 Server

1. Optional `no_sync` on both update Zod schemas.
2. Add `no_sync` to both CHANGE_PATHS.
3. Apply through existing `applyTheAllowedPatch` /
   `correctFormLead` / `correctCallLead` so the correction refresh
   already enqueues `form_lead.update` / `call_lead.update`.
4. Tests in spec §10.2 PATCH cases.

### 6.2 Admin

1. Detail control on Form Lead and Call Lead, same family as
   `MarkBadLeadControl`.
2. Checked = PATCH `{ no_sync: true }`. Unchecked = `{ no_sync: false }`.
3. Helper sentence from spec §7.2 in `operational-copy.ts`.

## 7. Out of scope

- Desk filter, column, Manual checkbox (LNS-03).
- Knowledge bodies (LNS-04).
- New domain command.
- Extra confirm modal unless the existing edit-save pattern already
  has one.

## 8. Tests

Server PATCH cases in spec §10.2. Admin control: checked/unchecked
payload; copy has no `no_sync` string in markup.

## 9. Knowledge updates after this issue ships

Pointer-only: PATCH path is `updateSourceOwnedLead` + `no_sync`.

## 10. Acceptance criteria

- [ ] PATCH `{ no_sync: true }` on Form and Call writes EntityChange
      path `no_sync` and enqueues `source_lead` update.
- [ ] PATCH `{ no_sync: false }` from true enqueues source-lead update.
- [ ] Empty PATCH still no-ops.
- [ ] Booked / Duplicate / Bad Lead can be marked (no extra 409).
- [ ] Detail control PATCHes the boolean; copy comes from
      `operational-copy.ts`; markup has no `no_sync`.
- [ ] After mark true and drain (unit-level plan is enough here),
      planner emits deletes not upserts (reuse LNS-01 tests).

## 11. Commands

```bash
pnpm test
pnpm typecheck
cd ../vantage-admin && pnpm test && pnpm typecheck
```

Paste output in the completion report.

## 12. Risks

- Adding a new command instead of `updateSourceOwnedLead`.
- Forgetting CHANGE_PATHS so the flip is a silent no-op.
- Inlining Owner sentences in JSX.

## 13. Rollback

Revert Zod, CHANGE_PATHS, and the Admin control. Planner from LNS-01
stays.

## 14. Handoff list for the completion report

- EntityChange + outbox evidence for both transitions.
- Which Admin component owns the control.
- What you did not do (filter, Manual checkbox, knowledge).
- Any §4 drift you corrected.
