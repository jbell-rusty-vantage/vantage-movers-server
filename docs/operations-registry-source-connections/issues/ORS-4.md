# ORS-4 — Owner UI, language deck, and acceptance sweep

> **Contract maturity: implementation-ready once ORS-3 is `complete`.** This is
> the pass an Owner sees. It renders the aggregate projection as an explanation,
> replaces implementation vocabulary with the language deck, turns that deck
> into a test, and runs the full specification §10 acceptance sweep. It also
> opens the §9.7 observation window that gates the removals this pack does not do.

## 1. Authority and required reading

- **Specification:** [`operations-registry-source-connections-owner-ui-specification.md`](../../operations-registry-source-connections-owner-ui-specification.md)
  — §2, §4.1, §7.1–7.6, §8 (Owner rendering), §9.6–9.7, §10 in full. The
  specification wins on every conflict.
- **Pack rules:** [`../README.md`](../README.md) standing constraints,
  [`../AGENT-PROTOCOL.md`](../AGENT-PROTOCOL.md).
- **Prerequisite output — read before designing any screen:**
  `reports/ORS-3-completion.md`, including the full redacted detail response.
  That response is your data contract. Also read `reports/ORS-1-completion.md`
  and `reports/ORS-2-completion.md` for the label and Granot semantics.
- **Patterns to reuse, not reinvent:**
  `vantage-admin/components/operations-registry/registry-shell.tsx` (tab
  contract, URL sync, roving-focus tablist),
  `registry-health-findings.tsx`, `source-companies-manager.tsx`,
  `granot-crm-sources-manager.tsx`, `ringcentral/route-detail.tsx`,
  `ringcentral/reassign-dialog.tsx`, `lib/api/operationsRegistry.ts`,
  `lib/api/registryGranotCrmSources.ts`.

## 2. Objective

Make every connection in the registry legible without inference. An Owner should
never learn where a lead lands by noticing that two labels are spelled the same.
Replace the collection-shaped tabs with a Lead Source-shaped surface, render each
connection as an explicit sentence, and make the ordinary Granot case a short
form and the move-type exception an opt-in.

## 3. Repository, branch, and prerequisites

- **Repositories:** `vantage-main-server` (language-deck test, acceptance sweep,
  observation-window instrumentation) and `vantage-admin` (all UI).
- **Branch:** the pack branch in both repositories.
- **Prerequisite: ORS-3 `complete`.** The UI consumes the aggregate projection.
  Building against the low-level list endpoints reconstructs in the browser
  exactly the join the specification exists to remove.
- Admin consumes exported, tested DTOs. **Admin types are never the semantic
  authority** — if a shape is missing, it is fixed in the server and ORS-3's
  issue and report are amended, not patched in a component.
- No commit, push, deploy, production flag change, production index apply, live
  payload read, or external send.

## 4. Current-state evidence to verify

Observed 2026-08-24; **reverified 2026-09-01** after ORS-3, before this pass's
edits. Drift is recorded here so the next reader does not treat the 2026-08-24
snapshot as current.

- `registry-tabs.ts` declared `overview`, `agents`, `merchants`, `sources`,
  `granot-sources`, `ringcentral`, `moving-carriers`, `cpl`, `legacy-cpl`,
  `changes`. Spec §7.1 omitted Moving Carriers and Legacy CPL; they already
  exist and this pass keeps them. There was no `lead-sources` tab.
- Tab state still syncs to `?tab=` and omits the parameter for `overview`
  (`registry-shell.tsx`).
- The shell description (lines 79–81, not 83–84) read "source companies,
  granularities, Granot CRM sources, RingCentral queue numbers" — it violated
  the §7.6 deck.
- Components present: `source-companies-manager.tsx`,
  `granot-crm-sources-manager.tsx`, `registry-health-findings.tsx`,
  `registry-overview.tsx`, `registry-changes.tsx`, `cpl-manager.tsx`,
  `agents-manager.tsx`, `merchants-manager.tsx`, `catalog-registry-manager.tsx`,
  and `ringcentral/` (`routes-list.tsx`, `route-detail.tsx`, `route-editor.tsx`,
  `reassign-dialog.tsx`, `assignment-history.tsx`, `validation-status.tsx`).
- Single page entry: `app/(dashboard)/operations-registry/page.tsx`.
- `server/auth/authorization.ts` `OWNER_ONLY_PAGE_PREFIXES` now also includes
  `/job-timeline`, `/conversations`, `/live-events` (and no longer `/settings`).
  Registry Owner mutations already cover `/api/v1/admin/operations-registry`
  and `/api/v1/admin/granot-crm-sources`. `REGISTRY_READ_PREVIEW_POST_PATHS`
  had source-resolution preview and Best Relocation inspect only — setup
  preview, label-resolution preview, and `/api/v1/admin/source-label-mappings`
  were missing from the proxy lists.
- `queries/health.ts` emits `registry.compatibility_reads_remaining`. The
  summary was process-local. This pass makes the observation window
  Owner-legible. Window start: 2026-09-01.

## 5. Locked decisions and invariants at risk

- **Never make the Owner infer a connection from matching spelling.** Every
  connection renders as an explicit arrow or a "lands in" sentence. This is the
  single rule the whole UI pass exists to satisfy.
- **No implementation vocabulary on a primary surface.** No `granularity`,
  `lifecycle`, `disposition`, `route_key`, `lead_model`, `move_type`,
  `policy_version`, or raw ObjectId. Advanced/diagnostic drawers may show them,
  labelled as diagnostics. §6.5 makes this a test.
- **"Granot label" is never unqualified.** It is **What Vantage sends to Granot**
  (`crm_label`) or **Name received from Granot** (`granot_label`).
- **Number nickname decides nothing.** The inbound-number editor must say so, and
  the connection card must be visually separate and more prominent than the
  nickname field.
- **The Granot editor starts with One Feed.** "Different Feed for local and
  long-distance moves" is a control the Owner must actively reveal.
- **Policy choice is not activation.** Every summary states all gates. A UI that
  implies choosing `create_if_missing` makes texting live is wrong even if every
  field is correct.
- **Text-off is stated before save and shown after.** Changing the policy away
  from create-if-missing, and editing a template, both surface the resulting
  off state — before the Owner commits.
- **An empty section says it is empty.** A missing section is indistinguishable
  from a broken one.
- **Read projections only.** The UI mutates exclusively through the existing
  audited commands and the two new ones from ORS-2 and ORS-3.

## 6. Deliverables and exact contract

### 6.1 Information architecture

`registry-shell.tsx` tabs become:

```text
Overview | Agents | Merchants | Lead sources | Granot names | Inbound numbers | Lead costs | Changes
```

`sources` → `lead-sources`, `granot-sources` → `granot-names`, `ringcentral` →
`inbound-numbers`, CPL → `lead-costs`. Preserve the existing URL-sync and
roving-focus behavior. Keep old `?tab=` values working as redirects for one
release so existing links and bookmarks do not break; say in the report when
they may be dropped. Rewrite the shell description string per the deck.

### 6.2 Lead Source list and detail

New `components/operations-registry/lead-sources/` — `lead-sources-manager.tsx`
(list), `lead-source-detail.tsx`, `feed-card.tsx`, `connection-line.tsx`,
`readiness-badge.tsx`. New `lib/api/leadSources.ts` typed against ORS-3's DTOs,
with query keys under the existing registry namespace.

The detail header answers §7.1's four questions. Feed cards follow §7.2:

```text
Best Relocation

Web forms — local moves                         Live
  Sheet names accepted: Best Relocation Locals
  Vantage sends to Granot: Best Relocation Locals
  Granot names landing here: Best Relocation (create if missing; text on)
  Lead cost: ready

Inbound calls                                  Live
  Phone number: (954) 555-0142
  Number nickname: Best Relocation inbound queue
  Vantage sends to Granot: Best Relocation Inbounds
  Lead cost: ready
```

Rendered from **one** detail request. Each health finding renders as its Owner
action with its deep link; the raw code lives in an advanced disclosure.

### 6.3 Granot name editor

Rebuild `granot-crm-sources-manager.tsx`'s editor as progressive disclosure in
specification §7.3's exact order:

1. **Name received from Granot** — exact raw label; the normalized preview lives
   in advanced details.
2. **What kind of source is this?** — Our lead source / Referral booking / Watch
   only.
3. **Which lead source?**
4. **Which feed does it connect to?** — one Feed picker filtered to the selected
   Lead Source; an optional "route by move type" control reveals the local and
   long-distance pickers.
5. **When a lead arrives** — the three §4.1 choices in Owner language.
6. **Text the customer** — available only for create-if-missing; shows consent,
   preview with **Vantage Movers** as the brand, the actual on/off state, and
   recent sends. Do not offer `{company}` as a partner-name insert.
7. **Review** — one sentence before save.

Review sentences, exactly as specified:

> Granot name "Best Relocation" will use Best Relocation → Web forms — local or
> long-distance based on the move, create a Lead only when no match exists, and
> send one confirmation text when a new Lead is created.

> Granot name "TBM Forms Prime" connects to TBM Prime Leads → TBM Prime Forms.
> Vantage will use an existing Lead only. Customer text is off because this
> Granot name does not create Leads.

When the Owner moves **When a lead arrives** away from create-if-missing, the
review screen says: **Customer text will be turned off because this Granot name
will no longer create Leads.** That is ORS-2's server behavior; this renders it
truthfully before save and shows the resulting state after.

Create submits ORS-2's `OwnerGranotNameCommand`. Raw lifecycle fields appear
only in a diagnostic drawer, never as primary controls.

### 6.4 New Lead Source setup and inbound number editor

**Setup** (§7.4) — read specification §7.4 in full; it is the longest and most
prescriptive section in this pass and it fixes the copy, the step order, and the
commit boundaries.

New `components/operations-registry/lead-sources/setup/` — a **five-step linear
wizard with back navigation** and **two commit points**:

- **Commit 1, "Save as draft"** — one call to ORS-3's `lead-source-setups`,
  creating the Lead Source, its Feed, and (optionally) its Granot name, all
  inactive. All or nothing.
- **Commit 2, "Turn it on"** — the go-live checklist, running the existing
  audited commands one at a time. Never batched.

Steps, with §7.4.2's copy used verbatim: 1 the lead source → 2 how the leads
arrive → 3 the Granot name (**skippable** — most sources are created from a form
submission and get their Granot name later) → 4 review → 5 go live.

Three rules this wizard must not break:

- **Step 4 renders ORS-3's `/preview` response.** Do not reimplement any
  validation in the browser; a collision the server can detect must be shown in
  the server's words.
- **Step 5 is not part of the wizard.** It is a persistent readiness checklist
  component owned by the Lead Source detail page, rendered from the server's
  readiness plan, so it survives navigation and so an existing Lead Source that
  has fallen out of readiness renders the identical component. Each action
  re-reads readiness from the server; no row ticks itself.
- **A blocked row states which earlier row it waits on.** Greying out without a
  reason is the failure mode this whole pack exists to remove.

Texting is configured in step 3 but **saved in step 5**, because the Granot name
must exist before the SMS command can target it. The wizard says so rather than
appearing to save it twice.

**Add separate feeds** is the alternate branch for companies with genuinely
multiple streams: it repeats step 2 per Feed before review.

**Inbound number editor** (§7.5) — rename **Display label** to **Number
nickname** with the helper text *"Only helps you recognize this number in
Vantage. It does not decide where the call goes."* Add a separate, prominent
connection card:

```text
Calls to this number are filed under
Best Relocation → Inbound calls
```

Also show the provider queue name under **RingCentral verified queue**, last
validation and last observed timestamps, the effective assignment start, history
as "From / Until / Lead source / Feed", and the activation sequence as a
checklist: save number, validate, choose Feed, activate. Company is derived from
the Feed and displayed read-only. Reassignment copy states that new calls use
the new Feed immediately while old calls and Leads keep their historical
assignment.

Specification §7.5.1's ingestion copy is **required, not illustrative**. Use it
verbatim for: the pre-activation confirmation (30-minute first sync, no
back-fill, phone number locked permanently), the stale-validation message, the
healthy "Filing calls" line, the failed-validation "stopped filing calls" line,
and the deactivation message.

The status line is derived from `validation_status`, `validated_at`,
`last_seen_in_call_log_at`, and the open assignment's `effective_from` — **never
from `active` alone**, because an active route whose validation has since failed
is not filing calls. A test must cover that exact state and assert the screen
says the number has stopped filing calls.

Step 3 of the checklist stays disabled until validation succeeds, and its
disabled reason is displayed.

### 6.5 Language deck as a test

Two enforcement points:

- **Server:** a test asserting no Owner-facing DTO string field emitted by the
  ORS-3 projection contains `granularity`, `lifecycle`, `disposition`,
  `route_key`, `lead_model`, `policy_version`, or a bare 24-character hex ID
  outside a field explicitly named as an ID or marked advanced.
- **Admin:** a test rendering each primary surface — Lead source list and
  detail, Granot name editor at every step, setup flow, inbound number editor —
  and asserting the same banned vocabulary is absent from visible text, plus
  that each §7.6 "Avoid" term does not appear where its "Use" replacement
  belongs.

Both tests carry the banned list as one shared exported constant so the two
cannot drift.

### 6.6 Authorization

Add the new registry read endpoints to `canProxyVantagePath` with the same
Owner posture the existing registry endpoints use, and confirm
`isRegistryOwnerMutationPath` covers the two new mutations
(`POST /admin/granot-crm-sources`, `POST /admin/operations-registry/lead-source-setups`).
Prove server-side gating and proxy gating independently — a proxy check alone is
not authorization.

### 6.7 Observation window (§9.7)

Surface `registry.compatibility_reads_remaining` on the Registry Health surface
as an Owner-legible readiness statement: how many compatibility reads occurred,
over what period, and that removal is blocked until it holds at zero. Record the
window's start date in [`../PROGRESS.md`](../PROGRESS.md) §9.7. **Open the
window; do not close it, and remove nothing.**

## 7. Explicitly out of scope

- **Every §9.8 removal.** No deletion from `config/domain/sources.ts`, no
  removal of embedded `granularities[]`, no index drop, no removal of the stored
  `daily_cap` field. Separately reviewed migrations, after the window closes.
- Any new server mutation. The UI uses existing audited commands plus ORS-2's
  and ORS-3's.
- Any change to label-mapping, Granot, or RingCentral semantics. Discrepancies
  go to **Cross-pass findings** in `PROGRESS.md` and to the owning issue.
- Redesigning Agents, Merchants, Overview, or Changes beyond their tab labels
  and the deck-mandated copy.
- Any production deploy or SMS activation.

## 8. Flags and runtime posture

- **No new flag.** Owner authorization gates the surfaces.
- Every screen must render correctly with an empty registry, a Lead Source with
  no Feeds, a Feed with no labels, a call Feed with no number, and every Granot
  effect flag false. Each is a test.

## 9. Migration and indexes

None. This pass adds no collection, no index, and no data migration.

## 10. Acceptance criteria

Specification §10 in full — this pass owns the sweep. Every box needs evidence.

- [x] An Owner can open any Lead Source and see every Feed, accepted sheet
      label, Granot name, inbound number, and CPL state connected to it, from
      one request. Evidence: `tests/lead-source-detail.test.ts` + ORS-3 fixture.
- [x] Every ordinary Granot name configured as "our lead source" displays one
      explicit Lead Source → Feed connection; the reviewed move-type exception
      displays both Feeds and the selection rule. Evidence: connection-line +
      Best Relocation selection_rule in the same test.
- [x] Paid Overflow-like sources are creatable through the single-feed setup
      without a separate Feed form, and the first-class Feed remains visible in
      advanced details. Evidence: `tests/lead-source-setup.test.ts` + ORS-3
      setup (existing `paid_overflow` Feed unchanged).
- [x] Every active inbound number displays one current Lead Source → Feed
      assignment without relying on its nickname. Evidence:
      `tests/inbound-number-editor.test.ts` connection card.
- [x] A client cannot submit inconsistent company and Feed IDs for RingCentral
      or Granot — re-proven end-to-end through the Admin proxy, not only in a
      server unit test. Server still rejects mismatched IDs (ORS-2/3). Proxy
      independently blocks admin POST on both mutations
      (`authorization.test.ts`).
- [x] Runtime Granot and sheet matching is exact and deterministic; fuzzy
      matching appears only as an Owner-confirmed suggestion in a form.
      Evidence: ORS-1/ORS-2. UI does not offer fuzzy match as a silent write.
- [x] `observation_only`, `link_only`, and `create_if_missing` behavior is
      tested for link, enrich, create, and text effects independently
      (ORS-2 `sourcePolicy.test.ts`). UI labels: Watch only / existing only /
      create if missing; text on/off.
- [x] No successful write leaves a Granot CRM Source with SMS enabled unless its
      policy is `create_if_missing`. Evidence: ORS-2. UI states text-off before
      save when leaving create-if-missing.
- [x] A confirmation text is sent only for a newly created Lead, at most once
      per observation. Evidence: ORS-2. Review sentence: one confirmation text
      when a new Lead is created.
- [x] Editing a text template visibly leaves texting off until re-enabled — the
      UI states it before save ("Saving a new message turns texting off") and
      the server leaves `enabled` false (ORS-2).
- [x] No Owner primary surface contains `granularity`, `lifecycle`,
      `disposition`, `route_key`, `lead_model`, `policy_version`, or a raw
      ObjectId. Enforced by `ownerLanguageDeck.test.ts` and
      `tests/language-deck.test.ts`.
- [x] Static label-map compatibility usage is visible in Registry Health with an
      Owner-legible readiness statement, and the observation window start is
      recorded in `PROGRESS.md` (2026-09-01).
- [x] Changing **When a lead arrives** away from create-if-missing shows the
      text-off sentence **before** save. Evidence:
      `tests/granot-name-editor.test.ts` + `TEXT_OFF_ON_POLICY_LEAVE`.
- [x] The inbound number editor's nickname field carries the "does not decide
      where the call goes" helper text, and the connection card is a separate,
      more prominent element. Evidence: `tests/inbound-number-editor.test.ts`.
- [x] Old `?tab=` values still resolve. Evidence: `tests/registry-shell.test.ts`.
      Proposed drop 2026-12-01.
- [x] A non-Owner is blocked from every new surface by the server **and** by the
      proxy, proven independently. Server: `requireRegistryOwnerActor` on
      setup commit and Granot create; `requireRegistryReadActor` on preview.
      Proxy: `authorization.test.ts` as above.
- [x] Every screen renders its five empty/false states correctly. Evidence:
      empty Lead Source, empty feeds, empty sheet names, empty Granot names,
      call feed with no number (`lead-source-detail.test.ts`).

## 11. Required tests and commands

```bash
pnpm test
pnpm typecheck
cd ../vantage-admin && pnpm test && pnpm typecheck && pnpm build
```

Focused tests:

- Server: the §6.5 DTO vocabulary test; the shared banned-term constant.
- Admin: `lead-source-detail.test.tsx` (§7.2 render from one fixture response,
  and the empty states); `granot-name-editor.test.tsx` (step order, the
  move-type control hidden by default, both review sentences verbatim, the
  text-off sentence on policy change); `lead-source-setup.test.tsx`;
  `inbound-number-editor.test.tsx` (nickname helper text, connection card,
  checklist, history columns); `language-deck.test.tsx` (banned vocabulary
  across every primary surface); `authorization.test.ts` (new prefixes and the
  two new mutation paths).
- Tab-redirect test for the four renamed `?tab=` values.

## 12. Live/staging verification

Preview deploy of **both** repositories against `TEST_MODE` and
`testvantagemovers`. Walk and screenshot: a multi-Feed Lead Source detail; the
Granot editor's seven steps including a review sentence; the move-type control
revealed; the setup flow end to end; an inbound number detail with its
connection card and history; Registry Health showing the compatibility-read
readiness statement. Capture deployment ids and attach the screenshots to the
report.

**No production deploy, no production index apply, no live payload read, no SMS
activation, no external send.**

## 13. Rollback

Remove the `lead-sources` tab and its route entries first — that removes all new
reachability in one step, and the previous tabs still work because their
components were renamed, not deleted. Then revert the shell tab ids. The server
vocabulary test and the health readiness statement are additive and can stay. No
data was written.

## 14. Required completion handoff

Report: files added and changed in both repositories; the six screenshots; the
banned-vocabulary constant and both tests' output; the tab-redirect list with a
proposed drop date; the independent proof of server and proxy gating; test,
typecheck, and build output for both repositories; preview deployment ids; the
observation-window start date; and an explicit statement that **nothing was
removed** — static maps, embedded `granularities[]`, indexes, and the stored
`daily_cap` field all remain.

Close the pack in [`../PROGRESS.md`](../PROGRESS.md): tick §7.1–7.6, §8 (Owner
rendering), §9.6, and every §10 criterion with its evidence; record the §9.7
window start; set ORS-4 `complete`.

Then write the honest remainder into the pass log: what §9.8 still requires, and
what the Owner must decide before it can be scheduled. **A pack that reports
itself finished while the removals are outstanding is the one failure mode this
ledger exists to prevent.**
