# DOP-07 — Category panels, cards, links, Quiet priorities

> **Contract maturity: implementation-ready.** Session 5. This is the
> Owner board. Separate Daily Operations Panels on one page, one
> socket. Useful facts and links on every card.

## 1. Authority and required reading

- **Pack specification:** [`../daily-operations-specification.md`](../daily-operations-specification.md)
  — §2 (why panels), §4, §7–8, §17, §21.2–3, §21.14–16.
- **Pack rules:** [`../README.md`](../README.md), [`../AGENT-PROTOCOL.md`](../AGENT-PROTOCOL.md),
  [`../LOCAL-ADMIN.md`](../LOCAL-ADMIN.md)
- **Reuse:** existing `SidePanel`, operational `?record=` / `?panel=`,
  `/intakes?case=`, `/job-timeline?job=`, Live Events href
- **Glossary:** workspace-root `CONTEXT.md`

## 2. Objective

The Owner sees the New York day as category stacks — Leads, Texts,
Granot, Intakes, Bookings, Cancellations, Exceptions — each with
today, pace, session change, and the last cards. A held overnight
text says when it will send. A zip that did not produce a state is
on the Lead card and in Exceptions. Links open desks that already
exist. Confirm stays on `/intakes`.

## 3. Repository, branch, and prerequisites

- **Repository:** `vantage-admin` only.
- **Prerequisites:** DOP-06 `complete`.
- 21st.dev allowed only for the **category panel grid** and **event
  card** shells. Do not invent a second drawer or API.
- Verify at http://localhost:3000.
- No commit, push, deploy, or live payload read unless asked.

## 4. Current-state evidence to verify

Observed 2026-09-06; **reverify before coding.**

- DOP-06 shipped chrome + tiles + mix + EventSource. Honor `?lane=`
  and `?company=` already on the URL.
- `SidePanel` is `max-w-3xl`. Extend width if needed; do not fork.
- Operational Form Lead detail already has a Lead Message tab
  (`?panel=message`).
- Live Events stays `/live-events`. Intakes stay `/intakes?case=`.
- Job Timeline href helper already exists (`buildJobTimelineHref` or
  equivalent).

## 5. Locked decisions and invariants at risk

- Panels on one board. Not tabs. Not a page per category. Not one
  mixed feed as the default.
- One EventSource. Fan-out by `lane` in memory.
- Quiet priorities hides `granot.priority_updated` cards only;
  counts still include them.
- Card copy for held texts uses resolved `card.text.send_at`.
- Zip miss chip does not remove the Lead from the Leads panel.
- No mutations. No raw Granot accordion.
- Names on cards; phone last-four only.

## 6. Deliverables and exact contract

1. `category-panels.tsx` grid (spec §3.2 / §7). Default `lane=all`.
   Focus expands one panel; others become a count rail.
2. `event-card.tsx` shared shell (spec §8). Kind titles in §8.6.
3. Links table in spec §8.3. `?open=<kind>:<id>` uses existing
   SidePanel / record desks.
4. Quiet priorities control + `localStorage` + URL
   `quiet_priorities=1`.
5. Texts panel header: sent · held now · failed. Held card:
   `Text held until {h:mm a}`.
6. Exceptions panel always visible. Zip-miss card + Lead chip.
7. Granot pairing by `parent_receipt_id` (receipt then outcome).
8. Sheet Sync panel may stay hidden (opt-in) with a working renderer.
9. Empty / reconnect copy in spec §3.3 / §7.3.
10. Tests: fan-out by lane; quiet priorities; company filter;
    held-text copy from `send_at`; zip chip; Admin still blocked.

## 7. Out of scope

- New main-server kinds (ask DOP-02 / DOP-03 via Cross-issue findings).
- Confirm Granot Booking UI.
- Conversations, money, 24h/48h tabs.
- Replacing Live Events.

## 8. Tests

Client tests for fan-out, copy, and URL state. Browser walk of the
happy path (DOP-08 will repeat end-to-end).

## 9. Knowledge updates after this issue ships

Prefer DOP-08. If you touch the admin map, keep the sentence: Daily
Operations is `/daily` category panels, not Daily View.

## 10. Acceptance criteria

- [ ] `lane=all` shows all on-by-default panels at once.
- [ ] A Cancellation card cannot be hidden by a burst of priority
      updates in the default view (separate panels).
- [ ] Quiet priorities hides priority cards; Granot tile count
      unchanged.
- [ ] Held text card shows the resolved 8:00 AM (or whatever
      `send_at` is) and links to the Lead.
- [ ] Zip-miss Lead shows the chip and appears in Exceptions; Lead
      tile still includes it.
- [ ] Booked card with `intake_link` goes to `/intakes?case=`.
- [ ] Job Number link goes to `/job-timeline?job=`.
- [ ] Granot receipt has "Open in Live Events".
- [ ] No Confirm control on `/daily`.
- [ ] `pnpm test && pnpm typecheck` in vantage-admin. Browser proof
      of focus + one real or seeded card per major panel if the
      local day is empty, say so honestly.

## 11. Commands

```bash
cd vantage-admin && pnpm test && pnpm typecheck
```

Browser per LOCAL-ADMIN: `/daily`, `/daily?lane=text`,
`/daily?lane=exception`, company click, Quiet priorities. Paste what
you saw (no credentials, no live customer payloads).

## 12. Risks

- Reintroducing a single mixed feed as the only view.
- Tabs that hide the rest of the day.
- Hardcoding "8:00 AM" instead of formatting `send_at`.
- Embedding Live Events JSON on the card.
- Opening Confirm on this page.

## 13. Rollback

Remove `category-panels` / `event-card`. DOP-06 tiles remain.

## 14. Handoff list for the completion report

- Panel list and focus behavior as implemented.
- Link hrefs table.
- Quiet-priorities storage key.
- Gaps (empty local day, Sheet Sync opt-in).

**Unblocks:** DOP-08.
