# LCE-03 — Copy, language, URL, handoff

> **Contract maturity: implementation-ready.** Session 3. Rename the
> three desks, fix the banner, persist `cpl_mode`, offer Existing
> leads after a past-dated save. **No rebuild editor.**

## 1. Authority and required reading

- **Pack specification:** [`../lead-costs-owner-editing-specification.md`](../lead-costs-owner-editing-specification.md)
  — §4.1, §7, §8, §9, §10.2 (language + URL).
- **Pack rules:** [`../README.md`](../README.md), [`../AGENT-PROTOCOL.md`](../AGENT-PROTOCOL.md)
- **Prerequisite UI:** LCE-02 By date form.
- **Language deck:** `vantage-admin/lib/operations-registry/ownerLanguageDeck.ts`
- **Glossary:** workspace-root `CONTEXT.md`

## 2. Objective

The Owner can tell the three desks apart. Schedule vs stored-lead
update is one banner and one post-save offer. Deep links and tab
clicks keep `cpl_mode`. Visible Lead Costs markup passes the Owner
language deck.

## 3. Repository, branch, and prerequisites

- **Repository:** `vantage-admin` only.
- **Prerequisite:** LCE-02 `complete`.
- No 21st.dev in this issue.
- No commit, push, deploy, or live payload read unless asked.

## 4. Current-state evidence to verify

Observed 2026-09-02; reverify after LCE-02.

- `MODE_TABS` labels: Simple / Advanced / Corrections. `setMode`
  does not write the URL.
- `registry-shell` `selectTab` clears every query key except `tab`.
- Banner: “Ordinary schedule edits update future attribution only…”
- Corrections card names `correct_period` in the typical-flow
  sentence.
- Simple card title: **Simple CPL editor**.
- Readiness `open_lead_costs` → `/operations-registry?tab=lead-costs`
  with no `feed`.
- `language-deck.test.ts` does not include `CplManager` markup.

## 5. Locked decisions and invariants at risk

- URL ids stay `simple | advanced | corrections`.
- Owner labels: Current rates / By date / Existing leads.
- Keep `entity`; accept `feed=` as an alias on By date.
- When entering `lead-costs`, keep `cpl_mode`, `entity`, `feed`.
  When leaving, they may drop.
- Do not auto-preview or auto-start a CPL Correction job.
- Do not change Simple’s POST body or correction preview/confirm
  contracts.

## 6. Deliverables and exact contract

1. Mode tab labels per spec §4.1. Click writes `cpl_mode`.
2. Banner per §8.1.
3. Current rates card copy per §7.1, including the later-rates
   warning.
4. Existing leads card copy per §7.2. Remove `correct_period`.
   Window labels **From** / **Through**.
5. Post-save offer per §8.2.
6. Registry tab switch preserves Lead Costs query keys (§9).
7. Readiness `open_lead_costs` adds `cpl_mode=simple` and `feed=`
   when the Feed id is known.
8. `registryEntityLinks` label may become **Set lead cost by date**.
   Update `registryEntityLinks.test.ts`.
9. Extend `language-deck.test.ts` to Lead Costs markup.

## 7. Out of scope

- Structured rebuild (LCE-04).
- Server changes.
- Browser walk of all paths (LCE-05) — smoke the offer if local
  servers are up.
- Changing correction caps or preview hash behavior.

## 8. Tests

Language-deck inclusion; `cpl_mode` write helper; readiness href;
entity-link label; offer-window helper
(`Through = min(T, today)` / today when Ongoing).

## 9. Knowledge updates after this issue ships

LCE-05 / docs-keeper points Admin CONTEXT at the new desk names.

## 10. Acceptance criteria

- [ ] Visible mode labels are Current rates / By date / Existing leads.
- [ ] Mode click persists `cpl_mode` in the URL.
- [ ] Banner does not say “CPL” as the Owner noun; it says lead cost
      and Existing leads.
- [ ] No visible `correct_period` / `granularity` on these three
      desks (`findOwnerMarkupLeaks`).
- [ ] Past-dated save shows the Existing leads offer with pre-filled
      Feed + dates; future-only save does not.
- [ ] Switching away from Lead costs may drop the extra keys;
      switching onto Lead costs from a deep link keeps them.
- [ ] Readiness with a known Feed includes `feed=`.
- [ ] `pnpm test && pnpm typecheck && pnpm lint` in `vantage-admin`.

## 11. Commands

```bash
cd vantage-admin && pnpm test && pnpm typecheck && pnpm lint
```

## 12. Risks

- Renaming tabs without updating aria-labels (`CPL modes`).
- Auto-running preview because the offer is “so close.”
- Stripping `feed` while the By date panel is still mounted.

## 13. Rollback

Restore Simple / Advanced / Corrections labels and the old banner.
URL persistence can stay; it is harmless.

## 14. Handoff list for the completion report

- Before/after Owner strings.
- Deep-link matrix (`cpl_mode`, `entity`, `feed`).
- Language-deck leaks found and fixed.
- What you did not do (LCE-04–05).

**Unblocks:** LCE-05 (also needs LCE-04).
