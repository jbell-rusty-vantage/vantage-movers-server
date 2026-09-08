# LNS-03 — Desk filter, column, Manual checkbox, contains copy

> **Contract maturity: implementation-ready.** Session 3. Owner can find
> No-Sync Leads on the desks, opt into Master Leads on Manual create,
> and read the contains sentence. **No planner work (LNS-01). Knowledge
> bodies stay LNS-04.**

## 1. Authority and required reading

- **Pack specification:** [`../lead-no-sync-specification.md`](../lead-no-sync-specification.md)
  — §8.3, §9, §10.4, §10.5, §11, §12.5–12.6.
- **Pack rules:** [`../README.md`](../README.md), [`../AGENT-PROTOCOL.md`](../AGENT-PROTOCOL.md)
- **Depends on:** [LNS-01](LNS-01.md) field + contains skipReason.
- **Glossary:** workspace-root `CONTEXT.md`
- **Patterns:** `yesNoOptions` + `STATUS_FILTER_KEYS`; Manual
  `post_to_granot` checkbox; `sheet-contains-panel.tsx` reason copy

## 2. Objective

`/form-leads` and `/call-leads` filter and show **Hidden from Master
Leads** in the Status group (next to Booked / Cancelled). `/manual`
defaults **Hide from Master Leads** and can send `no_sync: false`.
Contains panel explains `reason: "no_sync"` as Not expected.

## 3. Repository, branch, and prerequisites

- **Repositories:** `vantage-main-server` then `vantage-admin`.
- **Branch:** same desk branch as LNS-01.
- **Prerequisites:** LNS-01 `complete`. May run after or before LNS-02
  in the same session; do not start before LNS-01.
- Browser walk uses [`../LOCAL-ADMIN.md`](../LOCAL-ADMIN.md).

## 4. Current-state evidence to verify

Observed 2026-09-06; **reverify at implementation**.

- `adminQueryBase` has `booked` / `cancelled` as optional
  `booleanInput`. No `no_sync`.
- `booleanFilters` on form-leads / call-leads use `presenceClause` for
  booked/cancelled. `no_sync` must use exact / `$ne: true` per spec §9.1.
- `STATUS_FILTER_KEYS` throws if a new select key is omitted.
- Find `q` already matches a 24-hex Mongo ID. That plus the new
  filter / column is the search surface. No global-search change.
- Manual payload builder does not send `no_sync`.
- `sheet-contains-panel.tsx` special-cases `created_on_unmatched` and
  `missing_from_mongo` only.

## 5. Locked decisions and invariants at risk

- Label **Hidden from Master Leads** on filter and column. Place the
  filter in Status after `cancelled`. Add `no_sync` to
  `STATUS_FILTER_KEYS`. Manual checkbox **Hide from Master Leads**,
  default checked.
- Filter No = `{ no_sync: { $ne: true } }` so legacy missing-field rows
  count as syncable.
- Do not hang this on the `duplicate` page split.
- Contains copy for `no_sync` from spec §8.3. Keep unmatched copy.
- Never print `no_sync` in JSX.

## 6. Deliverables and exact contract

### 6.1 Server

1. `no_sync: booleanInput.optional()` on `adminQueryBase`.
2. Browse boolean map for form-leads and call-leads per spec §9.1.
3. Tests in spec §10.4.

### 6.2 Admin

1. **Hidden from Master Leads** filter + column on both lead desks.
   Add `no_sync` to `STATUS_FILTER_KEYS` so it lands in Status next
   to Booked / Cancelled.
2. Manual **Hide from Master Leads** default checked; unchecked
   sends `{ no_sync: false }`.
3. Contains panel sentence for `reason === "no_sync"`.
4. Tests in spec §10.5.
5. Browser steps 1–3 and 6 in spec §11 (4–5 need LNS-02 mark control;
   if LNS-02 is not yet shipped, record steps 4–5 as blocked and do
   1–3 + a create-default contains check). Step 6 is required: Booked
   Deals Found, Lead Contains Not expected.

## 7. Out of scope

- Planner / contains skipReason enum (LNS-01).
- Mark control (LNS-02) unless already present.
- Knowledge bodies (LNS-04).
- Global search badge or filter.
- Leftover-row contains verdict (live tab read after `no_sync` skip).
- Duplicate-desk filter (column optional).

## 8. Tests

Spec §10.4 and §10.5. `filterGroupForKey` must not throw.

## 9. Knowledge updates after this issue ships

Pointer-only: browse query `no_sync`; Manual checkbox.

## 10. Acceptance criteria

- [x] `GET /api/v1/admin/call-leads?no_sync=true` returns only
      `no_sync === true`.
- [x] `no_sync=false` includes missing-field and `false`, not `true`.
- [x] Omit returns both.
- [x] Both desks render **Hidden from Master Leads** Status filter
      (Any / Yes / No) and column without a filter-group throw.
- [x] Manual **Hide from Master Leads** default checked; unchecked
      payload has `no_sync: false`.
- [x] Contains panel shows the No-Sync sentence; unmatched sentence
      unchanged.
- [x] Browser steps 1–3 (and 4–6 if LNS-02 is complete) recorded.

## 11. Commands

```bash
pnpm test
pnpm typecheck
cd ../vantage-admin && pnpm test && pnpm typecheck
```

Plus the browser walk in spec §11 / this §10. Paste output in the
completion report.

## 12. Risks

- Using `presenceClause` so `no_sync=false` misses defaulted `false`
  vs missing-field inconsistently — follow `$ne: true` for No.
- Forgetting `STATUS_FILTER_KEYS`.
- Sending `no_sync: true` from the client when checked (omit is also
  legal; server defaults). Unchecked **must** send `false`.

## 13. Rollback

Revert browse query, desk config, Manual payload, and contains copy.
Server planner stays.

## Cross-issue from LNS-02 (2026-09-06)

LNS-02 shipped Actions-tab `HideFromMasterLeadsControl` and
`OPERATIONAL_COPY.hideFromMasterLeads`. The Status filter / column
label is **Hidden from Master Leads**. Do not reuse `hideAction`
("Hide from Master Leads") for that filter. Browser steps 4–5 are
unblocked. Do not add a row-cluster hide control.

## 14. Handoff list for the completion report

- Browse query evidence (redacted counts).
- Manual payload cases.
- Browser notes for spec §11.
- Whether steps 4–5 waited on LNS-02.
- What you did not do.
- Any §4 drift you corrected.
