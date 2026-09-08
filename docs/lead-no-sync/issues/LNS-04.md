# LNS-04 — Knowledge and pointer sentences

> **Contract maturity: implementation-ready.** Session 4. Make knowledge
> docs describe the code that shipped. **No runtime behavior.**

## 1. Authority and required reading

- **Pack specification:** [`../lead-no-sync-specification.md`](../lead-no-sync-specification.md)
  — §3.3, §14.
- **Pack rules:** [`../README.md`](../README.md), [`../AGENT-PROTOCOL.md`](../AGENT-PROTOCOL.md)
- **Depends on:** LNS-01, LNS-02, LNS-03 `complete`.
- **Docs-keeper:** update only the matching Service / Reference layer
  and the glob-scoped rule that already owns those files.
- **Glossary:** workspace-root `CONTEXT.md` — **No-Sync Lead** was added
  when this pack was authored. Confirm the definition still matches
  the shipped field.

## 2. Objective

An agent reading Service docs can state: what `no_sync` is, who
defaults it, that it applies only to Forms and Calls, where the skip
lives, that mark-true deletes those tabs only, that contains is Not
expected, that Booking Chain still writes Booked Deals and must not
upsert Forms/Calls, and that Bad/Duplicate orders are unchanged.

## 3. Repository, branch, and prerequisites

- **Repository:** `vantage-main-server` docs (and workspace-root
  `CONTEXT.md` only if the term drifted).
- **Prerequisites:** LNS-02 and LNS-03 `complete`.
- Invoke docs-keeper after you list the exact files. Do not invent
  domain synonyms.

## 4. Current-state evidence to verify

Observed 2026-09-06 at pack authoring; **reverify against shipped code.**

- `sheet-sync.md` unmatched skip sentence; no `no_sync`.
- `google-sheets.md` contains table and unmatched skipReason.
- `form-lead.md` / `call-lead.md` always enqueue create Sheet Sync.
- `bookings.md` Booking Chain writes booked + source lead.
- `admin-search.md` browse filters omit `no_sync`.
- `domain-commands.md` CHANGE_PATHS lists omit `no_sync`.
- `catalog.md` is Agents/Merchants — **do not edit**.

## 5. Locked decisions and invariants at risk

- Describe shipped code, not the next idea.
- Keep Unmatched Call Lead sentences. Add No-Sync Lead beside them.
  Do not merge the two.
- Restate Bad dual-write and Call stale-delete as they are.
- Do not claim CPL exclusion.

## 6. Deliverables and exact contract

Update the files in spec §14 so each has one accurate paragraph or
table row. After docs-keeper, `pnpm okf:query` still lists those
Services. Add a Delivery pack / Reference row in `docs/index.md` if
this pack is not already indexed (pack authoring added the index
row — keep it).

## 7. Out of scope

- Runtime or Admin UI changes.
- New ADR unless all three ADR tests in `/domain-modeling` hold
  (they do not: this is a field + planner skip, not a hard-to-reverse
  platform fork).
- Editing `catalog.md`.

## 8. Tests

No new runtime tests. `pnpm okf:query --type Service` still succeeds.
Manual read of each updated body against LNS-01–03 reports.

## 9. Knowledge updates after this issue ships

This issue **is** the knowledge update.

## 10. Acceptance criteria

- [x] Each file in spec §14 states the shipped `no_sync` behavior.
      Evidence: sentences in `reports/LNS-04-completion.md`;
      `sheet-sync.md` planner bullet; `google-sheets.md` contains row;
      form/call create default; `bookings.md` Booking Chain paragraph;
      `admin-search.md` browse clause; `domain-commands.md` CHANGE_PATHS.
- [x] Unmatched Call Lead remains a distinct sentence.
      Evidence: `sheet-sync.md` unmatched bullet after No-Sync;
      `google-sheets.md` unmatched table row + skipReason stays
      `created_on_unmatched`; `call-lead.md` / `bookings.md` “Distinct from”.
- [x] Bad dual-write and Call stale-delete are not rewritten. Docs
      must say `no_sync` does not delete or skip those tabs.
      Evidence: `sheet-sync.md` “does not delete or skip Duplicates,
      Duplicate Calls, or Bad Leads”; `google-sheets.md` “tables above
      are unchanged”; form/call “routing above is unchanged”.
- [x] `CONTEXT.md` No-Sync Lead still matches the stored field name.
      Evidence: “Stored as `no_sync`”. No glossary edit.
- [x] `catalog.md` untouched.
      Evidence: `git status` does not list
      `docs/knowledge/services/catalog.md`.
- [x] `docs/index.md` lists this pack.
      Evidence: Delivery + Reference rows from pack authoring kept;
      this issue did not add a catalog row.

## 11. Commands

```bash
pnpm okf:query --type Service
```

Plus a file list of what docs-keeper changed. Paste in the report.

## 12. Risks

- Copying spec hopes that did not ship (read the completion reports).
- Collapsing No-Sync into Unmatched.

## 13. Rollback

Revert the knowledge sentences. Runtime stays.

## 14. Handoff list for the completion report

- Files changed and the sentence that landed in each.
- okf:query output.
- What you did not do.
- Any drift between spec and shipped code you had to describe honestly.
