# ODR-39 — Granot names: mapping a webhook label to a feed, and unlocking `create_if_missing`

> **Contract maturity: implementation-ready.** The Owner sees every name Granot has actually sent, maps each one to a feed he already created, and chooses what should happen when a lead arrives under it — including *create the lead if we don't have it*. The lifecycle semantics that make that choice safe are already written and are not touched. Three real defects block the Owner today and are fixed here: the API enum forbids `create_if_missing`, the editor silently downgrades it, and no source can have its lifecycle switched on at all.

## 1. Authority and required reading

- **Pack specification:** [`operations-registry-owner-specification.md`](../operations-registry-owner-specification.md) — §2, §3.3, §4, §6, §8, §10.
- **Predecessor:** [`ODR-38.md`](./ODR-38.md) — `registry-copy.ts`, `ownerVocabulary.ts`, `OwnerFeed`, and the tab shell. This issue **imports** them and declares none of them.
- **Voice rules:** [`owner-daily-owner-copy.md`](../owner-daily-owner-copy.md) §1.1.
- **Code you must read before writing, and must not change:**
  - `src/models/granotCrmSourceSemantics.ts` — the whole file. Every rule the Owner is about to hit lives here.
  - `src/services/granotLifecycle/sourcePolicy.ts:174–294` — `resolveSourcePolicy`, the exact-match rule.
  - `src/services/operationsRegistry/granotCrmSources.ts` — `createOrUpdateGranotCrmSource` already handles create; only the route is missing.

## 2. Objective

Deliver the **Granot names** tab so the Owner can:

1. see every source label Granot has sent that Vantage does not yet recognize;
2. map one to a feed, with the near-spelling suggestion doing the work his eye would do;
3. say what happens when a lead arrives under that name — watch it, match it, or match-and-create;
4. switch it on, which is currently impossible from the Admin at all.

At the end of this issue, `"Best Relocation"` arriving on a `lead_created`
webhook resolves to the Best Relocation web-form feed with
`create_if_missing`, and the Owner set that up himself.

## 3. Repository, branch, and prerequisites

- **Repositories/branches:** `vantage-main-server` and `vantage-admin`, both on `operations-registry-owner`.
- **Prerequisite:** ODR-38 merged **for the Admin half**. The server half — §6.1 through §6.5 — has no file overlap with ODR-38 and may start immediately in parallel.
- **Prerequisite:** verify `GRANOT_CRM_SOURCE_LIFECYCLE_INDEXES` are present in the target database before the create route ships. `GranotCrmSourceSchema` sets `autoIndex: false` (`GranotCrmSource.ts:129`), so the unique `normalized_granot_label` index that stops two names colliding **may not exist**. This is a precondition, not a nicety.
- No commit, push, deploy, production flag change, production index apply, live payload read, or external send.

## 4. Current-state evidence to verify

Observed 2026-08-21; **reverify at implementation**.

**Three defects block the Owner. Confirm each before fixing it.**

1. **The API forbids `create_if_missing`.** `src/validation/v1/admin.validation.ts:301` is
   `lead_created_policy: z.enum(["link_only", "observation_only"])`. The model
   (`GRANOT_LEAD_CREATED_POLICIES`), the semantics validator
   (`granotCrmSourceSemantics.ts:110`), the resolver, and the effect gates
   (`sourcePolicy.ts:442–456`) all support the third value. Only the route schema
   and the Admin do not.
2. **The editor silently downgrades a stored `create_if_missing`.**
   `granot-crm-sources-manager.tsx:226`:
   `useState(source.lead_created_policy === "create_if_missing" ? "link_only" : ...)`.
   The `<option>` at `:376` is also `disabled`. So the moment the enum opens,
   the Owner editing *any other field* on a `create_if_missing` source silently
   saves it back as `link_only` — the lead creation stops and nothing says why.
   **This is a data-loss defect, and it is the first thing to fix.**
3. **No Granot source can be switched on.** `validateGranotCrmSourceSemantics`
   requires a nonempty `lifecycle_policy_version` whenever `lifecycle_enabled`
   (`granotCrmSourceSemantics.ts:139`). The Admin editor never sends that field,
   `setGranotCrmSourceLifecycleEnabled` passes through whatever is stored
   (`granotCrmSources.ts:209`), and `buildUpdate` defaults it to `""`
   (`:322`). A source created without it can never be activated from the UI.

Other state to confirm:

- **There is no create route.** `v1.routes.ts:358–364` exposes list, detail, `PATCH`, and `PATCH .../activation`. No `POST`. The service function behind them already branches on `command.id` and creates when it is absent (`granotCrmSources.ts:164`).
- **`workspace_slug` is required and has no default** (`buildUpdate`, `:272`), and `{ crm_origin, workspace_slug }` is a unique compound index (`GranotCrmSource.ts:133`). It is a second uniqueness axis alongside the unique `normalized_granot_label`.
- **`crm_origin` defaults** to `GRANOT_CRM_DEFAULT_ORIGIN` (`:269`).
- **`source_company`** on this model is the legacy CSV string (`schemaHelpers.sourceCompanyField`, default `"not_provided"`), distinct from the `lead_source_company` ObjectId ref. Never render the first.
- **Matching is exact.** `resolveSourcePolicy` normalizes the inbound label and looks up `findByNormalizedLabel` (`sourcePolicy.ts:122–127`), then fails `ambiguous / multiple_eligible_matches` on more than one row and `policy_blocked / source_unclassified` on none.
- **Route shapes are heavily constrained.** `validateRouteStructure` (`granotCrmSourceSemantics.ts:160`) permits exactly: one `CallLead + any` route with no form route; **or** one `FormLead + any`; **or** exactly one `FormLead + local` plus one `FormLead + long_distance`. Mixing call and form on one source is rejected. Each route's feed must belong to the chosen lead source, match the channel, and match the move type (`validateContextualRefs`, `:253`).
- **`create_if_missing` is legal only with `source_scoped_lead`** (`:110`), which itself requires a lead source and at least one route (`:124`).
- The raw and normalized labels the webhook delivered are on the observation as `source_label_raw` and `normalized_source_label` (`createLeadFromGranot.ts:855`).

## 5. Locked decisions and invariants at risk

- **Fuzzy matching lives in the create form and nowhere else.** Pack spec §3.3. `resolveSourcePolicy` stays an exact normalized-equality lookup. A suggestion is something the Owner confirms; it is never something the processor applies. If this diff contains a similarity comparison reachable from `src/services/granotLifecycle/`, the issue is wrong.
- **`validateGranotCrmSourceSemantics` is not modified, weakened, or bypassed.** It is the reason `create_if_missing` is safe to expose: it is what guarantees a create-if-missing source has a real lead source, a real feed, an unambiguous route shape, and an active target. Opening the enum without it would let the Owner author a configuration that creates leads against an inactive feed.
- **The route enum opens to exactly three values.** `lead_created_policy: z.enum(["link_only", "observation_only", "create_if_missing"])`. Nothing else in that schema changes.
- **`lifecycle_policy_version` is server-stamped and never Owner-typed.** It is an audit fact, not a setting. The server bumps it when — and only when — the policy projection changes. Accepting it from the client would let a stale tab replay an old version string over a newer policy.
- **`workspace_slug` is derived from the normalized label**, not typed. That makes the two uniqueness axes — `{crm_origin, workspace_slug}` and `normalized_granot_label` — agree by construction instead of by luck. Two independent uniqueness rules that can disagree is a duplicate-key error the Owner cannot act on.
- **The Owner never sees `source_scoped_lead`, `referral_booking`, or `deferred`.** He sees three sentences about whose leads these are. The stored value is unchanged.
- **The unmapped-labels list is evidence, not a queue.** It reads observations and decisions. It creates nothing, resolves nothing, and has no state of its own.
- **Switching lifecycle on writes no lead and changes no booking.** The existing activation copy already says this and it stays true: activation revalidates the policy and stamps the version. Lead creation additionally requires `GRANOT_LIFECYCLE_LEAD_CREATION_ENABLED`, which this issue does not touch.

## 6. Deliverables and exact contract

### 6.1 The three defect fixes

In order, smallest first, each with its own test:

1. `admin.validation.ts` — open the enum to `["link_only", "observation_only", "create_if_missing"]` in `granotCrmSourceRegistryUpdateSchema`, and remove `lifecycle_policy_version` from the accepted input entirely (§5).
2. `granot-crm-sources-manager.tsx:226` and `:376` — delete the downgrade and the `disabled` attribute. Superseded by §6.6's rewrite, but land the fix first so the defect is closed even if the rewrite slips.
3. `granotCrmSources.ts` — stamp the version (§6.2).

### 6.2 Server-stamped `lifecycle_policy_version`

In `createOrUpdateGranotCrmSource`, after `validateGranotCrmSourceSemantics`
succeeds and before the write:

```ts
// Bumped only when the policy projection changes. Activation always stamps.
function nextPolicyVersion(input: {
  before: Record<string, unknown> | null;
  after_projection: Record<string, unknown>;
  activating: boolean;
}): string;
```

- The projection compared is exactly `policyProjection()`'s output (`granotCrmSources.ts:411`) minus `lifecycle_policy_version` itself.
- Unchanged projection **and** not activating → carry the stored version forward.
- Changed projection, or activating → `String(previousInteger + 1)`, starting at `"1"`.
- A source that has never had a version and is being activated gets `"1"`, which is what unblocks defect 3.

`setGranotCrmSourceLifecycleEnabled` keeps delegating to
`createOrUpdateGranotCrmSource` and stops passing `lifecycle_policy_version`
through.

### 6.3 `src/services/operationsRegistry/granotSourceSuggestions.ts`

Pure, deterministic, no queries. **Create-form only.**

```ts
export type FeedSuggestion = {
  feed_id: string;
  lead_source_id: string;
  confidence: "exact" | "close" | "possible";
  matched_on: "granot_label" | "feed_name" | "other_spelling";
  matched_value: string;
};

export function suggestFeedsForGranotLabel(input: {
  granot_label: string;
  feeds: Array<{
    id: string;
    lead_source_id: string;
    owner_label: string;
    crm_label: string;
    aliases: string[];
    source_sites: string[];
    active: boolean;
  }>;
}): FeedSuggestion[];   // at most 5, ordered by confidence then by matched_value
```

Rules, in this order, and no others:

1. **`exact`** — `normalizeGranotSourceLabel(granot_label)` equals the normalized candidate value. This is the same normalizer the processor uses; import it from `src/services/granotLifecycle/sourceLabel.ts`.
2. **`close`** — equal after dropping a fixed, checked-in stop-token list (`llc`, `inc`, `movers`, `moving`, `relocation`, `leads`, `forms`, `calls`, `ld`, `local`) and collapsing whitespace; **or** Levenshtein distance ≤ 2 on strings of length ≥ 8.
3. **`possible`** — token-set containment in either direction with at least two shared tokens.

Everything else returns nothing. **A suggestion list is allowed to be empty and
the UI must handle that**; inventing a weak match is worse than none, because the
Owner will accept it.

Inactive feeds are included and flagged, because "the feed you want exists but
isn't live" is the single most likely state during setup.

### 6.4 `src/services/operationsRegistry/granotSourceIntake.ts`

```ts
export type UnmappedGranotLabel = {
  raw_label: string;
  normalized_label: string;
  first_seen_at: string;
  last_seen_at: string;
  times_seen: number;
  event_kinds: string[];          // route_event_class values observed
  suggestions: FeedSuggestion[];
};

export async function listUnmappedGranotLabels(input: {
  since: Date;
  limit: number;
}): Promise<{ items: UnmappedGranotLabel[]; window_from: string }>;
```

Implementation constraints:

- Aggregate `granot_observations` on `normalized_source_label` bounded by `captured_at >= since`, then **exclude** every label that already has a `GranotCrmSource` row, by a single `$in` against the normalized labels — not per-label lookups.
- `raw_label` is the most recently seen raw spelling, so the Owner recognizes it.
- Never include contact, phone, email, job number, or any move fact. This list is labels and counts. Assert that with a projection-safety test.
- `since` defaults to 30 days and is capped at 90 so the aggregation stays bounded.
- Suggestions are computed by §6.3 over the current feed list, in memory, once.

### 6.5 Routes

```text
POST /api/v1/admin/granot-crm-sources                        (new)
GET  /api/v1/admin/granot-crm-sources/unmapped-labels        ?since&limit
POST /api/v1/admin/granot-crm-sources/suggest-feeds          { granot_label }
```

`granotCrmSourceRegistryCreateSchema` — strict, unknown keys reject:

```ts
{
  granot_label: string(1..200),
  lead_source_company: objectId | null,
  default_channel: "form" | "call" | "unknown",       // optional, default "unknown"
  lifecycle_disposition: "source_scoped_lead" | "referral_booking" | "deferred",
  lead_created_policy: "link_only" | "observation_only" | "create_if_missing",
  lifecycle_routes: Array<{ route_key, lead_model, move_type, source_granularity_id }>,
  enabled: boolean,                                   // optional, default true
  notes: string(<=2000) | null,                       // optional
  reason: registryReasonSchema,                       // required 10..1000
}
```

Not accepted, at all: `crm_origin`, `workspace_slug`, `normalized_granot_label`,
`lifecycle_policy_version`, `lifecycle_enabled`, `source_company`. The first two
are derived; the next two are server-owned; activation is its own endpoint; the
last is legacy.

`workspace_slug` derivation, in `createOrUpdateGranotCrmSource` on the create
branch only: `normalized_granot_label` with every run of non-alphanumeric
characters replaced by `_`. On a `{crm_origin, workspace_slug}` duplicate-key
error, return `DUPLICATE_IDENTIFIER` with remediation pointing at the existing
row — the same shape `duplicateNormalizedLabel()` already returns, because to the
Owner these are one condition: *this name already exists*.

`suggest-feeds` is a `POST` because the label is free text that may contain
characters that do not survive a query string cleanly. It is read-only and
writes nothing; a test asserts that.

### 6.6 Admin — the Granot names tab

**List** — `granot-name-list.tsx`, two sections:

```text
Granot names

  Not set up yet                                          seen in the last 30 days
  ┌────────────────────────────────────────────────────────────────────────┐
  │ "Best Reloc LD"                                     seen 14 times       │
  │ Looks like: Best Relocation — Web form, long distance    [ Set this up ]│
  └────────────────────────────────────────────────────────────────────────┘
  ┌────────────────────────────────────────────────────────────────────────┐
  │ "Elite Van Lines"                                    seen 2 times       │
  │ No close match in your lead sources.               [ Set this up ]      │
  └────────────────────────────────────────────────────────────────────────┘

  Set up
  ┌────────────────────────────────────────────────────────────────────────┐
  │ "Best Relocation" → Best Relocation, Web form — local        Switched on│
  │ When a lead comes in: match it, and create it if we don't have it       │
  └────────────────────────────────────────────────────────────────────────┘
```

- The "Not set up yet" section is the entry point. It is what makes this tab
  answer *"Granot is sending us something — what is it?"* instead of requiring the
  Owner to already know.
- The subtitle line under each set-up row is a generated sentence, not a field
  dump. `granot-crm-sources-manager.tsx:170` currently renders
  `normalized_granot_label · lifecycle_disposition · lead_created_policy`; that
  line is deleted.

**Map flow** — `map-granot-name.tsx`, four steps on one page, each revealed as
the previous resolves:

```text
Setting up "Best Reloc LD"

  1. Whose lead is this?
     (•) Ours — we paid for it
     ( ) Someone else's — they book the move through us
     ( ) Not sure yet — just watch it for now

  2. Which feed does it belong to?
     (•) Best Relocation — Web form, long distance      ← looks like a match
     ( ) Best Relocation — Web form, local moves
     ( ) Show all feeds

  3. What should happen when a lead comes in under this name?
     ( ) Just watch it
     ( ) Match it to a lead we already have
     (•) Match it, and create the lead if we don't have it

  4. Why are you setting this up?
     [ Granot started sending long-distance under a separate name         ]

     What will happen: when Granot sends a lead called "Best Reloc LD",
     Vantage will look for it among Best Relocation's long-distance web-form
     leads. If it isn't there, Vantage will create it.

  [ Set it up ]   Setting it up doesn't change anything that already happened.
```

- Step 1 maps to `lifecycle_disposition`. Choosing "Someone else's" or "Not sure
  yet" **hides steps 2 and 3 entirely** and forces `observation_only` with no
  routes, because `granotCrmSourceSemantics.ts:117` and `:131` require exactly
  that. The Owner is not shown a choice the server will reject.
- Step 2 lists suggestions first, flagged, then all feeds behind "Show all". A
  suggested feed that is not live renders *"This feed isn't live yet — set it up
  anyway and turn the feed on when you're ready."*
- Step 3's third option is available and enabled. When the chosen feed is a call
  feed, the option list adapts to the one legal call route shape.
- **Step 4's preview sentence is generated from the exact values that will be
  submitted**, in `registry-copy.ts`. It is the Owner's read-back and it is a
  test: a fixture per disposition × policy × channel combination asserts the
  sentence matches the stored configuration.
- Routes are built by the client from the chosen feed's channel and `local`
  value, using the existing `GRANOT_ROUTE_TEMPLATES` shape, and are re-validated
  server-side. The Owner never sees the words "route" or "route_key".

**Detail** — `granot-name-detail.tsx`: the same four blocks in edit form, plus:

- **Switched on / off**, with the existing activation endpoint and its required
  reason. Copy: *"Switching this on lets Vantage act on leads with this name.
  It doesn't change anything that already happened."*
- A **blocked-state panel** when the server rejects the policy. Each
  `validateGranotCrmSourceSemantics` message maps to one Owner sentence in
  `registry-copy.ts`. Unmapped messages fall back to a generic sentence **plus**
  the raw message behind `<details>` — never a bare `DEPENDENCY_CONFLICT`.
- The latest audit line, kept from the current editor, reworded.
- The `automation_sources` panel, kept as-is in behaviour, reworded.

## 7. Explicitly out of scope

- Any change to `resolveSourcePolicy`, `evaluateEffectGates`, `selectRoute`, or `validateGranotCrmSourceSemantics`.
- Any change to what `createLeadFromGranot` does once a policy resolves.
- Flipping `GRANOT_LIFECYCLE_LEAD_CREATION_ENABLED` or any lifecycle flag.
- Deleting or renaming `GranotCrmSource.source_company`.
- Texting anybody — **ODR-40**.
- CSV ingestion paths, `csv_paths`, and `last_ingestions` — untouched and unrendered.
- Merging two Granot names, or splitting one.
- A backfill that auto-maps existing unmapped labels. Every mapping is a deliberate Owner action with a reason.

## 8. Flags and runtime posture

**No new flag.**

`GRANOT_LIFECYCLE_LEAD_CREATION_ENABLED` stays `false` by default
(`granotLifecycle.ts` defaults). With it off, a `create_if_missing` source is a
complete, valid, switched-on configuration that produces
`policy_blocked / global_effect_disabled` at the gate — and the detail page says
so in one sentence: *"This is set up and ready. Creating leads from Granot is
switched off across the whole system, so nothing is being created yet."* That is
the expected day-one posture and it is a test.

## 9. Migration and indexes

**No new index.**

`GRANOT_CRM_SOURCE_LIFECYCLE_INDEXES` (`GranotCrmSource.ts:26–44`) already
declares the unique `normalized_granot_label` index and two lifecycle indexes,
and the schema declares the unique `{crm_origin, workspace_slug}` compound.
**Because the schema sets `autoIndex: false`, verify all four exist on the target
database and record the output in the completion handoff.** Shipping a create
route against a database missing the unique label index is how two Granot names
collide and `resolveSourcePolicy` starts returning
`ambiguous / multiple_eligible_matches` on a real lead.

The unmapped-labels aggregation groups `granot_observations` by
`normalized_source_label` bounded on `captured_at`. A **near-miss** index already
exists — `GranotObservation.ts:128` declares
`{ normalized_source_label: 1, route_event_class: 1, captured_at: -1 }`. That
prefix serves the grouping, but `captured_at` sits behind `route_event_class`, so
the window bound is not a covered range unless the aggregation also constrains
`route_event_class`.

**Two acceptable outcomes, and `explain()` decides which:**

1. Constrain the aggregation to the `route_event_class` values that carry a
   source label — which is the honest query anyway, since an unmapped label only
   matters on the event classes that would have produced something — and use the
   existing index unchanged. **Prefer this.**
2. If (1) still shows a collection scan, add
   `{ normalized_source_label: 1, captured_at: -1 }` report-first through a new
   `scripts/migrations/granot-source-intake-indexes.ts` with a collision report.

Note that `GranotObservation` also declares its indexes explicitly, so verify the
existing one is actually present on the target database before relying on it.

## 10. Acceptance criteria

- [ ] `create_if_missing` round-trips: `POST` it, `GET` it back, `PATCH` an unrelated field, `GET` again — the policy is still `create_if_missing`. **This is the defect-2 regression test and it must fail against the current code.**
- [ ] The route enum accepts exactly three policy values, and `lifecycle_policy_version` is rejected as an unknown key on both `POST` and `PATCH`.
- [ ] A source created through `POST` can be switched on through the activation endpoint with no further input, and comes back with `lifecycle_policy_version: "1"`. **This is the defect-3 regression test and it must fail against the current code.**
- [ ] The version does not change when a `PATCH` alters only `notes`; it increments when the disposition, the policy, the lead source, or the routes change.
- [ ] `create_if_missing` with `referral_booking` or `deferred` is rejected by the server with the semantics message, and the Admin never offers that combination.
- [ ] `create_if_missing` with no lead source, or with zero routes, is rejected server-side.
- [ ] Deriving `workspace_slug` produces the same uniqueness verdict as the normalized label for at least: `"Best Relocation"`, `"best  relocation"`, `"Best Relocation!"`. A duplicate returns one `DUPLICATE_IDENTIFIER` with remediation, not a raw Mongo `E11000`.
- [ ] `suggestFeedsForGranotLabel` returns `exact` for a `crm_label` differing only in case and spacing; `close` for `"Best Reloc"` against `"Best Relocation"`; **empty** for `"Elite Van Lines"` against a fixture with no related feed.
- [ ] Suggestions are deterministic: the same input returns the same ordering across 100 runs.
- [ ] **No similarity function is reachable from `src/services/granotLifecycle/`.** Verified by `grep` on the diff. `resolveSourcePolicy` still matches on exact normalized equality, proven by a test that a one-character-off label resolves `source_unclassified`.
- [ ] `listUnmappedGranotLabels` excludes every label with an existing source row, and its payload contains no contact, phone, email, job number, or move fact. Asserted by a projection-safety test over a fixture that has all of them.
- [ ] The unmapped list uses one aggregation plus one `$in`, not a per-label lookup. Asserted by a query-count test.
- [ ] The step-4 preview sentence matches the submitted configuration for every disposition × policy × channel fixture.
- [ ] Choosing "Someone else's" or "Not sure yet" hides the feed and policy steps and submits `observation_only` with no routes.
- [ ] With `GRANOT_LIFECYCLE_LEAD_CREATION_ENABLED` false, a switched-on `create_if_missing` source renders the §8 sentence and the effect gate returns `global_effect_disabled`.
- [ ] Every `validateGranotCrmSourceSemantics` failure message reachable from the Admin has an Owner sentence; unmapped ones render the fallback plus `<details>`, never a bare code.
- [ ] Deep link `?tab=granot-sources&entity=<id>` still selects the right source.
- [ ] **No banned word reaches the DOM**, per the pack spec §10 render test, including `disposition`, `policy`, `route`, and `normalized`.
- [ ] All four `GranotCrmSource` indexes verified present on the test database, output recorded.
- [ ] A non-Owner admin session is refused by the server on all three new endpoints and gets read-only rendering, proven independently at both gates.
- [ ] No Lead, Booking, Cancellation, record link, case, or decision is produced by any request in this issue.

## 11. Required tests and commands

```bash
pnpm test
pnpm typecheck
cd ../vantage-admin && pnpm test && pnpm typecheck && pnpm build
```

Focused tests:

- `src/services/operationsRegistry/granotSourceSuggestions.test.ts` — the three confidence tiers; the stop-token list; the Levenshtein length floor; determinism; empty-on-no-match; inactive feeds included and flagged.
- `src/services/operationsRegistry/granotSourceIntake.test.ts` — exclusion of mapped labels; the projection-safety assertion; the query-count assertion; the `since` cap.
- `src/services/operationsRegistry/granotCrmSources.test.ts` — extended: the version-stamping table (unchanged / changed / activating / first activation); `workspace_slug` derivation and its duplicate error shape; **the `create_if_missing` round-trip**.
- `src/routes/granot-crm-sources.routes.test.ts` — extended: `POST` happy path and every semantics rejection; unknown-key rejection for the four forbidden fields; Owner-only on all three new routes.
- `src/services/granotLifecycle/sourcePolicy.test.ts` — extended with the named one-character-off test proving exactness survived this issue.
- Admin: the preview-sentence fixture table; the disposition-hides-steps behaviour; the `create_if_missing` no-downgrade test rendered against a stored `create_if_missing` fixture; the semantics-message mapping; the banned-word render test; the deep link.

Zero-mutation proof for `GET /unmapped-labels` and `POST /suggest-feeds`: seed,
call both, assert `granot_crm_sources`, `granot_observations`,
`synchronization_decisions`, and `operations_registry_changes` counts are
unchanged. `POST /suggest-feeds` writing anything would only show up here.

## 12. Live/staging verification

Preview deploy of both repositories against `TEST_MODE` with the test database.
Insert synthetic observations carrying two source labels — one that closely
matches an existing feed's `crm_label` and one that matches nothing. Confirm both
appear in "Not set up yet" with the right suggestions. Map the first to a feed
with `create_if_missing`, switch it on, and confirm: the stored policy is
`create_if_missing`; the version is `"1"`; `resolveSourcePolicy` against the
exact label resolves to that feed; against a one-character-off label it does not.
Then `PATCH` the notes and confirm the policy and version are untouched. Capture
deployment ids, the index verification output, and the aggregation `explain()`.

**No production deploy, no production index apply, no live payload read.**

## 13. Rollback

Revert the Admin commit to restore `granot-crm-sources-manager.tsx`, and revert
the enum in `admin.validation.ts` to two values. Any source already stored as
`create_if_missing` **stays** `create_if_missing` in the database and keeps
working in the processor — the old UI's downgrade only triggers on save, and the
reverted schema rejects the value rather than writing it. Note that explicitly in
the rollback runbook: the reverted state is *cannot edit those sources*, not
*those sources stop creating leads*. The version stamping is additive and needs
no reversal. Nothing was written to a lead, a booking, or a case.

## 14. Required completion handoff

Report: files added and changed; test and typecheck output for both repositories;
preview deployment ids; the four-index verification output verbatim; the
unmapped-labels `explain()` plan; the three defect regression tests shown failing
against the pre-fix code and passing after; `grep` evidence that no similarity
function is reachable from `granotLifecycle/`, that `validateGranotCrmSourceSemantics`
is unchanged, and that no component under `granot-names/` holds a bare string;
the banned-word render test result; and explicit confirmation that no lifecycle
flag changed and no lead, decision, or case was produced.

**Unblocks:** ODR-40 gates its text on `lead_created_policy === "create_if_missing"`,
which only exists as an authorable state after this issue.
</content>
