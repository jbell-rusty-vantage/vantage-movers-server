# ODR-38 — Lead sources in the Owner's words: create, feed, readiness, and the number that rings

> **Contract maturity: implementation-ready.** The Owner creates a lead source and its feeds without typing a single identifier, and sees at a glance which phone number rings into a call feed — or that one is expected and not there yet. Every registry invariant that exists today survives unchanged; what changes is that their failures are explained instead of thrown. No new collection, no new field, one report-only migration script.

## 1. Authority and required reading

- **Pack specification:** [`operations-registry-owner-specification.md`](../operations-registry-owner-specification.md) — §2 (vocabulary), §3.1, §3.2, §4, §8, §10.
- **Voice rules:** [`owner-daily-owner-copy.md`](../owner-daily-owner-copy.md) §1.1 and §2. Binding on every string in this issue.
- **Code you are wrapping, not replacing:**
  - `src/services/operationsRegistry/sourceRegistry.ts` — the six commands and every activation rule. **Read `:416–626` before writing anything.**
  - `src/services/operationsRegistry/ringCentralRegistry.ts:504` — `loadAssignmentTarget`, which is the whole relationship between a call feed and a phone number.
  - `src/services/operationsRegistry/registryAudit.ts:47` — `withRegistryMutation`.
  - `vantage-admin/components/operations-registry/source-companies-manager.tsx` — the surface being replaced.

## 2. Objective

Rebuild the **Lead sources** tab so the Owner can, unaided:

1. create a lead source by typing its name;
2. add feeds to it — web form, phone calls, local, long-distance — by typing their names;
3. see exactly what is left before each one goes live, in his words, with the button that does it;
4. see which phone number rings into a call feed, that it has been checked against RingCentral, and — when there isn't one — that this is expected and where to add it.

At the end of this issue, "Best Relocation" exists with three feeds, and the Owner knows which of them are live and why the others are not.

## 3. Repository, branch, and prerequisites

- **Repositories/branches:** `vantage-main-server` and `vantage-admin`, both on `operations-registry-owner`.
- **No prerequisite issue.** This is the first issue in the pack and does not depend on ODR-35/36/37.
- Ordinary checks use redacted synthetic data. Runtime reads require `TEST_MODE=true` and an explicit test database.
- No commit, push, deploy, production flag change, production index apply, live payload read, or external send.

## 4. Current-state evidence to verify

Observed 2026-08-21; **reverify at implementation**.

**Read this before assuming anything about the current surface.**

- **The Owner types identifiers today.** `source-companies-manager.tsx:276` is `<Input name="company_slug" placeholder="new_source_leads" required />`, and `:601` is `<Input value={createKey} placeholder="forms" />`. Both are normalized server-side by `normalizeKey()` (`sourceRegistry.ts:972`) and both are immutable after create (`:191`, `:333`). A collision returns `DUPLICATE_IDENTIFIER` **after** submit.
- **Everything is created inactive.** `sourceRegistry.ts:287` creates a company with `active: false`; `:401` creates a granularity with `active: false, schedule_revision: 0`. Nothing in the current UI says so, and nothing tells him what activation needs.
- **Activation has four real preconditions**, all in `setSourceGranularityActivation`:
  - company must be active — `:500`;
  - the CPL schedule must validate — `:505–533`, via `validateCplSchedule(periods, { active: true })`;
  - no other *active* feed on the same channel may share an exact `crm_label` or `source_site`, case-insensitively — `assertExactIdentifiersAvailable`, `:787`;
  - the feed must become its company's default for that channel in the same command, via `replacement_default_id` — `:539–554`.
  The last one currently surfaces to the Owner as a raw sentence about "granularity" and "channel".
- **Company deactivation is blocked while any feed is active** — `:437–445`. Company activation is blocked unless every channel with an active feed has a valid active default — `assertActiveDefaultsValid`, `:751`.
- **The phone number is not on the company at all.** It lives on `RingCentralInboundRoute` + `RingCentralInboundRouteAssignment`, joined to a feed by `source_granularity` (`ringCentralRegistry.ts:437–446`). A route must be `validation_status: "valid"` and validated within `RINGCENTRAL_ROUTE_VALIDATION_MAX_AGE_MS` (default 24h) before it can be activated — `assertValidFreshValidation`, `:564`. `createLeadFromGranot.ts:813` refuses to create a `CallLead` unless **exactly one** active assignment resolves to an active, valid route.
- **`LeadSourceCompany.granularities` appears to be dead.** Declared at `LeadSourceCompany.ts:66` with three indexes at `:77–79`. `sourceRegistry.ts:287` writes `granularities: []` on create and no code path writes it afterwards; `toCompanyItem` (`:848`) passes it through to the API response and the Admin never reads it. **Confirm this with a `grep` for `granularities.` queries and a count on the test database before acting on it.**
- **`LeadSourceGranularity.granularity_key` is globally unique** (`LeadSourceGranularity.ts:19`), not unique per company. Two companies cannot both have a feed keyed `forms`. This is the collision the Owner will hit first and the create form must predict it.

## 5. Locked decisions and invariants at risk

- **No new activation command, and no bypass.** §3.2 of the pack spec. Every precondition in §4 stays exactly where it is and keeps throwing exactly what it throws. This issue adds a **read-only projection** that predicts those throws and a UI that renders the prediction. If a reviewer can find a code path in this diff that activates a feed without going through `setSourceGranularityActivation`, the issue is wrong.
- **The readiness projection is advisory and is never trusted as authorization.** It is computed outside the mutation transaction and can be stale by the time he clicks. The command re-checks everything and is still the authority. The UI must handle a readiness check that said "ready" and a command that then failed — and say so honestly rather than showing a stale green tick.
- **The Owner never types `company_slug` or `granularity_key`.** He types a name; the derived key is shown read-only with an explicit "this is fixed once you create it" note; the collision check runs before submit. `normalizeKey` is **imported and reused**, not reimplemented in the Admin — a second normalizer that drifts by one character is a `409` he cannot diagnose.
- **The phone number is read, never written, from this surface.** Creating, validating, activating, and reassigning a RingCentral route stays in the RingCentral tab, which already implements the validation-freshness rule. This page links to it. Duplicating `assertValidFreshValidation` is exactly the fork §3.2 exists to prevent.
- **`LeadSourceCompany.granularities` is frozen, not deleted.** A guard test asserts no code writes it. The report script counts what is there. Dropping the field and its three indexes is a separate, explicitly authorized change after the report is read.
- **The embedded array's `inbound_phone_numbers` is never rendered.** It is a stale second copy of the routing fact this issue is putting in front of the Owner. Showing both is worse than showing neither.
- **`sheet_config`, `projection_mode`, and `spreadsheet_id` stay on the page but move behind a `<details>` labelled "Advanced".** They are real configuration and the Owner does occasionally need them; they are not what he opens this page for, and `direct_write` has a server-side precondition (`sourceRegistry.ts:218`) that must keep its explicit error.
- This issue is read-only on the server except for reusing the six existing commands. It adds no command, no flag, no collection, and no field.

## 6. Deliverables and exact contract

### 6.1 `src/services/operationsRegistry/ownerVocabulary.ts`

The one server-side map from enum value to Owner phrase, for the reasons a
projection has to echo. Pure, no imports from the Admin.

```ts
export function channelPhrase(channel: "form" | "call"): string;      // "Web form" | "Phone calls"
export function movePhrase(local?: "local" | "long_distance"): string; // "Local moves" | "Long-distance moves" | "All moves"
export function feedName(input: {
  owner_label: string;
  channel: "form" | "call";
  local?: "local" | "long_distance";
}): string;                                                            // "Web form — local moves"
export function livenessPhrase(input: {
  active: boolean;
  activated_at?: Date;
}): "Live" | "Not live yet" | "Turned off";
```

`livenessPhrase` distinguishes never-activated from deactivated using
`activated_at`, which `setSourceGranularityActivation` stamps once at `:602`.
Rendering both as "Inactive" — which the current UI does — loses the only signal
that tells him whether he is finishing setup or recovering from a change.

### 6.2 `src/services/operationsRegistry/leadSourceReadiness.ts`

Pure and unit-tested. **Takes already-loaded rows; performs no queries.** That is
what makes it exhaustively testable without a database.

```ts
export type ReadinessBlocker = {
  code:
    | "company_not_live"
    | "no_cost_set"
    | "cost_schedule_invalid"
    | "name_clash_with_live_feed"
    | "not_chosen_as_default"
    | "no_phone_number"
    | "phone_number_unchecked"
    | "phone_number_check_stale"
    | "phone_number_shared";
  headline: string;        // Owner voice, one sentence, states the fact
  action: string;          // Owner voice, one sentence, states what to do
  action_href?: string;    // e.g. "/operations-registry?tab=ringcentral&entity=<id>"
  self_serve: boolean;     // true when a button on this page clears it
};

export type FeedReadiness = {
  feed_id: string;
  can_go_live: boolean;
  blockers: ReadinessBlocker[];
  requires_default_selection: boolean;   // drives replacement_default_id
};

export function evaluateFeedReadiness(input: {
  company: { id: string; active: boolean; default_form_granularity?: string; default_call_granularity?: string };
  feed: { id: string; channel: "form" | "call"; active: boolean; crm_label: string; source_sites: string[] };
  sibling_feeds: Array<{ id: string; channel: "form" | "call"; active: boolean; crm_label: string; source_sites: string[] }>;
  cpl_periods: Array<{ amount_cents: number; effective_from: Date; effective_until?: Date }>;
  phone: { assignment_count: number; route_valid: boolean; validated_at?: Date; shared_with_feed_ids: string[] } | null;
  now: Date;
}): FeedReadiness;
```

Implementation constraints:

- **Mirror the command, do not approximate it.** `name_clash_with_live_feed` uses the same case-insensitive comparison over `crm_label` **and** every `source_sites` entry that `assertExactIdentifiersAvailable` uses. `cost_schedule_invalid` calls the real `validateCplSchedule(periods, { active: true })` and surfaces its message, translated. A blocker the command does not enforce, or a condition the command enforces and this misses, is a bug in this file.
- `no_phone_number` and its three siblings apply **only to `channel: "call"`**. A web-form feed with no phone number is complete, and saying otherwise trains him to ignore the checklist.
- `phone_number_check_stale` uses `RINGCENTRAL_ROUTE_VALIDATION_MAX_AGE_MS` read from the same place `assertValidFreshValidation` reads it.
- `phone_number_shared` fires when `assignment_count !== 1` — `createLeadFromGranot.ts:837` refuses to create a `CallLead` in that state, so it is a real blocker even though `setSourceGranularityActivation` allows it. Its headline says so: *"Two numbers ring into this feed. Calls from Granot won't create leads until only one does."*

### 6.3 `src/services/operationsRegistry/leadSourceProjection.ts`

```ts
export type OwnerFeed = {
  id: string;
  name: string;                 // ownerVocabulary.feedName()
  owner_label: string;
  channel_phrase: string;
  move_phrase: string;
  granot_label: string | null;  // crm_label, rendered as "What Granot calls it"
  other_spellings: string[];    // aliases + source_sites, merged and deduped
  liveness: "Live" | "Not live yet" | "Turned off";
  turned_off_reason: string | null;
  is_default_for_channel: boolean;
  lead_cost: { amount: string; effective_from: string } | null;  // "$41.00"
  phone: {
    number_display: string;     // "(954) 555-0142"
    checked: boolean;
    checked_at: string | null;
    label: string;
  } | null;
  readiness: FeedReadiness;
};

export type OwnerLeadSource = {
  id: string;
  name: string;
  liveness: "Live" | "Not live yet" | "Turned off";
  feeds: OwnerFeed[];
  live_feed_count: number;
  phone_number_count: number;
  readiness: { can_go_live: boolean; blockers: ReadinessBlocker[] };
  advanced: { spreadsheet_id: string | null; projection_mode: "derived_import" | "direct_write"; has_bad_tabs: boolean };
  derived_key: string;          // company_slug, shown read-only under "Advanced"
};

export async function listOwnerLeadSources(options: { includeInactive?: boolean }): Promise<OwnerLeadSource[]>;
export async function getOwnerLeadSource(id: string): Promise<OwnerLeadSource>;
```

Implementation constraints:

- **Bounded queries, no N+1.** One `find` per collection for the whole page: companies, granularities, CPL periods, route assignments, routes. Join in memory. The registry is small and this is not a hot path, but a per-feed query loop over five collections is how this page becomes unusable at forty feeds.
- **Delegate the existing reads.** `listSourceCompanies` and `listSourceGranularities` already exist and already shape their rows. Call them. A `grep` must confirm no second `getLeadSourceCompanyModel().find` was added under this file for data those functions already return.
- `lead_cost` renders the *currently effective* period only, formatted with its unit per copy-deck rule 4. No period is `null`, which is what `no_cost_set` reports.
- `derived_key` exists so the Owner can be told what the fixed identifier ended up as. It is the only place a `snake_case` value is allowed to reach the DOM in this pack, it lives under "Advanced", and it is labelled "Fixed name (can't be changed)".

### 6.4 `POST` name-availability check

Extends the existing validation module; no new service file.

```text
GET /api/v1/admin/operations-registry/lead-sources/name-check
      ?kind=lead_source|feed & name=<typed name>
→ { derived_key: string, available: boolean, conflict: { id, name, liveness } | null }
```

Owner-only, read-only, rate-limited by the existing admin middleware. `derived_key`
comes from the **exported** `normalizeKey` — export it from `sourceRegistry.ts`
rather than copying it. For `kind=feed` the check is global, because
`granularity_key` is globally unique (§4).

### 6.5 Routes

Added to `v1.routes.ts` beside the existing registry routes, same Owner gate,
same envelope, same `sendError`.

```text
GET /api/v1/admin/operations-registry/lead-sources             ?includeInactive
GET /api/v1/admin/operations-registry/lead-sources/:id
GET /api/v1/admin/operations-registry/lead-sources/:id/readiness
GET /api/v1/admin/operations-registry/lead-sources/name-check  ?kind&name
```

Unknown query keys reject. `includeInactive` defaults `false`.

### 6.6 `scripts/migrations/registry-embedded-granularities-report.ts`

Report-only. Prints: the count of `lead_source_companies` documents with a
nonempty `granularities` array; for each, the `company_slug` and the embedded
keys; the three index names over `granularities.*` and their sizes; and a
diff-style comparison of each embedded entry against the matching
`lead_source_granularities` document — because if any of them disagree, the
Owner has been looking at one and the lifecycle has been using the other.

**It drops nothing and writes nothing.** A `--apply` flag does not exist in this
issue.

### 6.7 Admin — the Lead sources tab

`components/operations-registry/registry-copy.ts` first. Every string below comes
from it.

**Create flow** — `create-lead-source.tsx`:

```text
Add a lead source

  What do you call them?     [ Best Relocation                    ]
                             Fixed name: best_relocation ✓ available

  [ Add lead source ]

  You can rename them later. The fixed name can't be changed.
```

- The availability check debounces at 400ms and shows one of three states: checking, available, taken (with the name of what took it and a link to it).
- Submit is disabled while `available !== true`.
- On success the new source is selected and its detail shows the first readiness step: **"Next: add the first feed."**

**Detail** — `lead-source-detail.tsx`:

```text
Best Relocation                                                    Not live yet

  ▸ 3 things left before this goes live                            [ checklist ]

  Feeds

  ┌────────────────────────────────────────────────────────────────────────┐
  │ Web form — local moves                                            Live  │
  │ Granot calls it "Best Relocation"          Also accepted: bestreloc.com │
  │ Lead cost $41.00                    New web-form leads land here ✓      │
  └────────────────────────────────────────────────────────────────────────┘
  ┌────────────────────────────────────────────────────────────────────────┐
  │ Phone calls                                                Not live yet │
  │ Granot calls it "Best Reloc Calls"                                      │
  │ (954) 555-0142 rings here · checked 2 hours ago                         │
  │                                                                         │
  │ One thing left:                                                         │
  │   Pick this as the feed new phone leads land in.       [ Do it ]        │
  └────────────────────────────────────────────────────────────────────────┘

  [ + Add a feed ]

  ▸ Advanced
```

- `[ Do it ]` sends `setSourceGranularityActivation({ active: true, replacement_default_id: <this feed id>, reason })`, which is exactly what the command wants at `sourceRegistry.ts:540`. A reason field is offered and optional, matching the existing command.
- A blocker with `self_serve: false` renders its sentence and its link, with no button. `no_phone_number` links to `?tab=ringcentral`.
- A feed whose readiness says ready but whose command then fails renders the server's translated error **and** re-fetches readiness, so the checklist and the outcome cannot disagree on screen.
- **Turning a feed off** keeps the existing dependency preview — it is genuinely useful — but renders `previewSourceDependency`'s `{ form_leads, call_leads }` counts as *"1,204 leads already came in through this feed. They keep their history."* Never a bare JSON object, which is what `DependencyPreviewPanel` renders today.

**Add a feed** — inside `feed-card.tsx`'s sibling form:

```text
Add a feed to Best Relocation

  What is it?          ( ) Leads from a web form
                       (•) Leads from phone calls

  Which moves?         ( ) Local    ( ) Long distance    (•) All moves

  What do you call it? [ Best Relocation Calls              ]
                       Fixed name: best_relocation_calls ✓ available

  What does Granot call it?  [ Best Reloc Calls             ]
                             Usually the same or very close.

  [ Add feed ]
```

- Maps to `createSourceGranularity({ source_company, granularity_key, channel, owner_label, crm_label, local })`. `owner_label` is the typed name; `granularity_key` is the derived key; `local` is omitted for "All moves".
- The "What does Granot call it?" field is `crm_label` and its helper line is the Owner's own sentence. It is the field ODR-39 will match against, and putting it here — at feed creation, next to the name — is what makes ODR-39's suggestions land.

**Phone panel** — `phone-number-panel.tsx`, rendered only for `channel: "call"` feeds:

| State | Rendered |
| --- | --- |
| one valid, fresh, exclusive route | `(954) 555-0142 rings here · checked 2 hours ago` |
| valid but stale check | `(954) 555-0142 rings here · last checked 3 days ago.` + `[ Check it again ]` → RingCentral tab |
| route exists, never checked | `(954) 555-0142 is set up but hasn't been checked against RingCentral yet.` |
| no assignment | `No number rings into this feed yet. That's fine for now — add one when you have it.` + link |
| more than one assignment | `Two numbers ring into this feed. Calls from Granot won't create leads until only one does.` + link |

The fourth row is the Owner's *"might have a RingCentral inbound queue later on"*
made explicit: the absence is stated as expected, not as an error.

## 7. Explicitly out of scope

- Creating, validating, activating, or reassigning a RingCentral route — the RingCentral tab, unchanged.
- Editing CPL amounts or schedules — the CPL tab, unchanged; readiness links to it.
- Anything about Granot names, mapping, or `create_if_missing` — **ODR-39**.
- Anything about texting a customer — **ODR-40**.
- Dropping `LeadSourceCompany.granularities` or its indexes — separate authorized change after §6.6's report.
- The Agents, Merchants, CPL, Overview, and Changes tabs — untouched.
- Bulk import.

## 8. Flags and runtime posture

**No new flag.** This issue ships behind no toggle: it replaces a working surface
with a clearer one and adds three read endpoints.

Granot lifecycle flags are read only and unchanged. `RINGCENTRAL_ROUTE_VALIDATION_MAX_AGE_MS`
is read, never written.

## 9. Migration and indexes

**No index is added, and none is dropped.**

The four collections this page reads are queried by `_id`, by
`source_company`, and by `active` — all covered by
`LeadSourceGranularity.ts:48–51` and the assignment model's existing indexes.
**Verify each of the five projection queries with an `explain()` on the test
database and record the winning plan in the completion handoff.**

`scripts/migrations/registry-embedded-granularities-report.ts` (§6.6) is the only
new script and it is report-only.

## 10. Acceptance criteria

- [ ] The Owner creates a lead source by typing a name. No field in the create form is labelled with, or accepts, a `snake_case` identifier.
- [ ] Typing a name that derives to an existing key shows "taken", names the conflicting record, links to it, and disables submit **before** any request that could `409`.
- [ ] The derived key shown in the Admin equals the key the server stores, byte for byte, for at least these inputs: `"Best Relocation"`, `"Best  Relocation!"`, `"  best-relocation  "`, `"Best Relocation 2"`, `"Ünïté"`. Asserted against the exported `normalizeKey`, not a copy.
- [ ] A newly created lead source renders "Not live yet", never "Inactive", and its checklist's first item is "add the first feed".
- [ ] A feed deactivated after having been live renders "Turned off" with its reason; a never-activated feed renders "Not live yet". Both states are covered by a fixture.
- [ ] For a call feed that is ready except for the default selection, `[ Do it ]` sends `replacement_default_id` equal to that feed's own id and the feed goes live in one click.
- [ ] `evaluateFeedReadiness` produces `name_clash_with_live_feed` for **exactly** the inputs `assertExactIdentifiersAvailable` rejects, including a case-differing `crm_label` and a case-differing `source_sites` entry. Proven by a table test that runs both.
- [ ] `evaluateFeedReadiness` produces `cost_schedule_invalid` by calling the real `validateCplSchedule`, and its headline contains no schema word.
- [ ] A web-form feed with no phone number reports `can_go_live: true` and shows no phone blocker.
- [ ] A call feed with no assignment renders the "That's fine for now" copy — an absent number is never rendered as an error.
- [ ] A call feed with two active assignments renders the shared-number blocker, and a test asserts `createLeadFromGranot`'s `assertSingleActiveRingCentralAssignment` rejects that same fixture — the checklist and the processor agree.
- [ ] A readiness check that says ready, followed by a command that fails because the state changed underneath, renders the server error and refetches. The stale tick does not survive on screen.
- [ ] Deep links `?tab=sources&entity=<id>` and `?tab=sources&granularity=<id>` still select and scroll to the right record.
- [ ] **No banned word reaches the DOM.** The §10 render test in the pack spec passes for every new component across every fixture state.
- [ ] **No bare user-visible string exists** under `components/operations-registry/lead-sources/`. Verified by `grep`.
- [ ] No mutation was added. `grep` confirms every write in the diff goes through an existing `sourceRegistry.ts` command, and that no `findByIdAndUpdate` on a registry collection was added outside a `withRegistryMutation` `mutate` callback.
- [ ] `LeadSourceCompany.granularities` is written by nothing. A guard test fails if a future change writes it, and the report script runs clean against the test database.
- [ ] `explain()` on all five projection queries shows an index scan.
- [ ] A non-Owner admin session gets read-only rendering **and** is refused by the server on every new endpoint, proven independently at both gates.

## 11. Required tests and commands

```bash
pnpm test
pnpm typecheck
cd ../vantage-admin && pnpm test && pnpm typecheck && pnpm build
```

Focused tests:

- `src/services/operationsRegistry/leadSourceReadiness.test.ts` — the table test against `assertExactIdentifiersAvailable`; the CPL delegation; every blocker code produced at least once; call-only blockers absent for form feeds; the stale-validation boundary at exactly `RINGCENTRAL_ROUTE_VALIDATION_MAX_AGE_MS ± 1ms`.
- `src/services/operationsRegistry/leadSourceProjection.test.ts` — query count is constant as the fixture grows from 1 to 40 feeds (**a named test**); liveness three-way split; `lead_cost` picks the effective period; `derived_key` round-trips.
- `src/services/operationsRegistry/ownerVocabulary.test.ts` — every enum value maps, and no output contains a banned word.
- `src/routes/v1.routes.test.ts` — extended: Owner-only on all four new routes, `name-check` validation, unknown-key rejection.
- Admin: the banned-word render test; the derived-key parity test against a fixture list shared with the server test; the `[ Do it ]` payload shape; the readiness-disagrees-with-command path; both deep links.

Zero-mutation proof for the four new GET endpoints, as in ODR-35: seed, call each,
assert `operations_registry_changes`, `lead_source_companies`, and
`lead_source_granularities` counts and `updatedAt` values are unchanged.

## 12. Live/staging verification

Preview deploy of both repositories against `TEST_MODE` with the test database.
Create a synthetic lead source end to end: name it, add a web-form feed and a
call feed, work the checklist to live on the web-form feed, and confirm the call
feed reports its missing number in the "That's fine for now" copy. Then create
a synthetic RingCentral route in the RingCentral tab, assign it, and confirm the
call feed's panel flips to "rings here". Capture deployment ids and the five
`explain()` plans.

**No production deploy, no production index apply, no live payload read.**

## 13. Rollback

Restore `source-companies-manager.tsx` in the shell — the old component is
deleted in this issue, so rollback is a revert of the Admin commit, and the four
new server endpoints become unreferenced reads that harm nothing. No migration
ran, no index changed, no schema field moved, so there is nothing to reverse on
the data.

## 14. Required completion handoff

Report: files added and deleted; test and typecheck output for both repositories;
preview deployment ids; the five `explain()` plans; the output of
`registry-embedded-granularities-report.ts` against the test database **verbatim,
including any embedded-versus-collection disagreement it found**; the named
constant-query-count test output; `grep` evidence that no new registry mutation
exists, that no component under `lead-sources/` holds a bare string, that
`normalizeKey` has one implementation, and that nothing writes
`LeadSourceCompany.granularities`; and the banned-word render test result.

**Unblocks:** ODR-39 renders inside this shell and imports `registry-copy.ts`,
`ownerVocabulary.ts`, and `OwnerFeed`. ODR-40's card mounts on
`lead-source-detail.tsx`. The embedded-array drop becomes a one-line decision the
Owner can authorize from the report.
</content>
