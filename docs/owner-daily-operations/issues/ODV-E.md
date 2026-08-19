# Unit E — Conversations tab, drawer conversation panel, and audited audio playback

> **Contract maturity: implementation-ready.** Implementation-blocked until ODV-D lands. Admin-only unit. It makes the seeded conversation visible in the product, and it ships the tab layout unchanged for the day ODV-H arrives.

## 1. Authority and required reading

- **Specification:** §5.0 (why the pipeline is deferred), §5.6 (the six summary sections), §5.9 (which routes exist), **§7.1 (access control) and §7.3 (why transcripts are the sensitive surface)**, §6.8 (drawer), §6.9 (Conversations tab).
- **Wireframes (illustrative only):** `owner-daily-view-planned.txt` §4b (drawer conversation panel), §9 (both the deferred and post-ODV-H tab states).
- **Prerequisite contract:** ODV-D's four read routes and the `LeadConversation` shape.
- **Drawer shell to extend:** ODV-B's `components/daily/detail-drawer.tsx`.

## 2. Objective

Add the Conversation tab to the detail drawer and the Conversations tab to the Daily View. Render the redacted transcript, the six-section summary with the Mismatch block promoted, and gated audio playback. Ship the deferred-state affordances honestly so the tab's purpose is legible with one record in it.

## 3. Repository, branch, and prerequisites

- **Repository/branch:** `vantage-admin` on the sprint branch. No `vantage-main-server` change is expected; if one proves necessary, it belongs in ODV-D, not here.
- **Prerequisites:** ODV-D complete (routes, model, one seeded record). ODV-B complete (drawer shell).
- Redacted synthetic data for tests. The seeded record is the only real data, and it is read, never rewritten.
- No commit, push, deploy, production apply, or external send.

## 4. Current-state evidence to verify

Observed 2026-08-19; reverify at implementation:

- `components/ui/side-panel.tsx` is a fixed overlay; ODV-B extends it to `max-w-4xl` with a tab strip.
- Browser traffic reaches the server only through `app/api/proxy/[...path]/route.ts`. `canProxyVantagePath` must already list `/api/v1/admin/conversations` as Owner-only from ODV-D — **verify, do not assume.**
- `lib/api/` has no `conversations.ts`. `lib/query/keys.ts` has no conversations namespace.
- After ODV-D there will be **exactly one** (or two) records in `lead_conversations`. Every empty state in this unit is a normal state, not an error state.

## 5. Locked decisions and invariants at risk

- **The Mismatch block sorts to the top of the summary and is visually distinct.** It is the only place the product tells the Owner his own record is wrong. Rendering it as the sixth item in reading order defeats the feature.
- **The transcript is collapsed by default.** It is long and it is the most sensitive text on the page.
- **Audio requests its signed URL only on press-play.** Opening a drawer must not count as listening to a customer call, because issuing that URL is audited.
- **Deferred actions render disabled with a tooltip, not hidden.** `[Attach →]` and `[Retry]` stay visible so the tab's purpose is legible on day one.
- **The tab layout does not change when ODV-H lands.** Filter chips, state column, and cost total must render correctly against one record and against forty-six.
- No transcript or summary text appears in any list payload or timeline entry. That is enforced server-side; this unit must not work around it.
- Read-only. No mutation.

## 6. Deliverables and exact contract

### 6.1 `lib/api/conversations.ts`

Typed fetchers for ODV-D's four read routes:

```ts
fetchConversations(params: { window: DailyWindowMode; state?: string; has_summary?: boolean; cursor?: string; limit?: number })
fetchConversation(id: string)                       // includes redacted transcript + summary
fetchConversationsByLead(model: "FormLead" | "CallLead", id: string)   // no transcript text
fetchConversationAudioUrl(id: string)               // called ONLY from the play handler
```

`fetchConversationAudioUrl` must not be called from a component body, an effect on mount, a prefetch, or a hover handler. Put that constraint in a comment at the call site — it is an audit-correctness requirement, not a performance preference.

`lib/query/keys.ts` gains `queryKeys.conversations.*`.

### 6.2 `components/daily/detail-conversation-tab.tsx`

Rendered inside ODV-B's drawer as the third tab.

Layout order, top to bottom:

1. **Player row** — play control, duration, direction, date, agent, and the match provenance line: `Matched by telephony session · HIGH confidence` or `Matched by phone and time window · MEDIUM confidence`. A medium-confidence record renders that note visibly; the Owner must never mistake a windowed phone match for a certain one.
2. **Mismatch block** — only when the summary contains one. Distinct treatment, first position.
3. The remaining five summary sections in specification §5.6 order.
4. **`[ Show transcript ▾ ]`** — collapsed. Expanded, it renders the redacted text with `[REDACTED:CARD]` tokens shown as-is, not hidden.
5. **Footer** — model, `prompt_version`, `cost_cents`.

When a Lead has no conversation: a single line, `No conversation on file.` Do not render an error, a spinner, or an empty player.

When a Lead has more than one: a compact selector at the top. One conversation is the common case; several must not break the layout.

### 6.3 `components/daily/conversations-tab.tsx`

Filter chips: `All`, `⚠ Needs attention`, `Unmatched`, `Complete`. Window cost total in the header.

Columns: `Started`, `Dir`, `Duration`, `Matched to` (masked label + lead kind, or `— unmatched`), `State`, `Cost`, `Actions`.

Actions:

| Action | This unit |
| --- | --- |
| `[ Open ]` | Opens the drawer on the Conversation tab |
| `[ Attach → ]` | **Disabled**, tooltip `Requires the conversation pipeline` |
| `[ Retry ]` | **Disabled**, same tooltip |

A persistent informational panel below the table, matching wireframe §9:

> Automated conversation discovery is deferred. This record was seeded by hand from a known booked lead so the workflow can be reviewed before recurring transcription cost is authorized.

Link it to the specification sections rather than restating the gates.

### 6.4 Leads tab `Conv.` column

ODV-B declared the column and ODV-D populates the data. This unit wires the interaction: clicking `🎧` opens the drawer **on the Conversation tab**, not the Details tab.

### 6.5 Audio playback

- `<audio>` element with a `src` set only after `fetchConversationAudioUrl` resolves, triggered by an explicit play.
- Handle expiry: if playback fails because the URL aged out, re-request once on the next play, and surface a plain message rather than a silent dead control.
- No download affordance. No `<a download>`. The blob is private and the URL is short-lived by design.

## 7. Explicitly out of scope

- Every ODV-H mutation: discover, retry, detach, attach. Their controls render disabled here.
- Any transcription, summarization, or RC call from the browser or the BFF.
- Waveform rendering, playback speed, transcript-to-audio timestamp sync. Not needed to judge the product.
- Editing or correcting a summary.
- Bulk actions of any kind.

## 8. Flags and runtime posture

No new flag. The tab's content is bounded by what ODV-D seeded. `capabilities.conversations` from ODV-A/D governs whether the tab renders at all — if it is `not_built`, render the capability panel, not an empty table.

## 9. Migration and indexes

**None.** This unit adds no collection, no index, and no server route.

## 10. Acceptance criteria

- [ ] The Mismatch block renders first among summary sections and is visually distinct from them.
- [ ] A summary with no mismatch renders no Mismatch block and no empty placeholder.
- [ ] The transcript is collapsed on open and expands on explicit action.
- [ ] `fetchConversationAudioUrl` is called **only** from the play handler. Proven by a test asserting no audio-url request occurs when the drawer opens.
- [ ] A medium-confidence record visibly states it was matched by phone and time window.
- [ ] A Lead with no conversation renders `No conversation on file.` — not an error, spinner, or empty player.
- [ ] `[ Attach → ]` and `[ Retry ]` render **disabled with a tooltip**, not hidden.
- [ ] The Conversations tab renders correctly with exactly one record: chips show accurate counts, the cost total shows the seeded cost, and empty chips read as empty rather than broken.
- [ ] Clicking `🎧` in the Leads tab opens the drawer on the Conversation tab.
- [ ] No list payload rendered by this unit contains transcript or summary text — verified against the by-lead and list endpoints.
- [ ] A non-Owner cannot reach any conversation surface; the Admin route guard and the proxy guard are both proven.
- [ ] `pnpm build` succeeds and no new client-side dependency was added.

## 11. Required tests and commands

```bash
cd vantage-admin && pnpm test && pnpm typecheck && pnpm build
```

Focused tests:

- `detail-conversation-tab.test.tsx` — section ordering with and without a mismatch; transcript collapsed by default; no audio-url fetch on mount.
- `conversations-tab.test.tsx` — one-record rendering, chip counts, disabled action tooltips, cost total.
- Leads tab: `🎧` opens the drawer on the correct tab.
- Authorization: non-Owner blocked at both gates.

## 12. Live/staging verification

Preview deploy `vantage-admin` against the `TEST_MODE` server holding the seeded record. Verify: the drawer Conversation tab renders the real summary and redacted transcript; play issues exactly one audio-url request and writes exactly one audit row; the Conversations tab reads sensibly with one row.

**This is the Owner review step for the whole conversation feature.** Capture the Preview URL and deployment ids; the Owner's reaction here is the primary input to the ODV-H cost decision.

**No production deploy.**

## 13. Rollback

Remove the Conversations tab from the shell tab list and the Conversation tab from the drawer. The seeded record and its routes survive untouched. No data was written.

## 14. Required completion handoff

Report: files added; test, typecheck, and build output; the audit row count from the Preview session proving one row per play; the Preview URL used for Owner review; screenshots or a description of the rendered Mismatch block on real data.

**Also report, for the Owner's ODV-H decision:** whether the summary was useful on a real call, whether the Mismatch section found anything true, and whether audio playback earned its exposure or whether the transcript alone sufficed. Specification §5.7 records the no-audio counter-position — this is where it gets tested against a real reaction.

**Unblocks:** nothing automatically. ODV-H remains gated on specification §7.
