# ORS-3 — Aggregate Lead Source projection, single-feed setup, RingCentral DTO enrichment

> **Contract maturity: implementation-ready once ORS-1 and ORS-2 are both
> `complete`.** This pass builds the one read surface that explains a Lead
> Source completely, the atomic command that creates a Lead Source and its
> default Feed together, and the RingCentral DTO enrichment that stops the
> browser reconstructing joins. It is read-heavy and adds exactly one new
> mutation.

## 1. Authority and required reading

- **Specification:** [`operations-registry-source-connections-owner-ui-specification.md`](../../operations-registry-source-connections-owner-ui-specification.md)
  — §3.5, §3.6, §5.3, §6.1, §6.3 (`lead-source-setups` only), §6.4, §8. The
  specification wins on every conflict.
- **Pack rules:** [`../README.md`](../README.md) standing constraints,
  [`../AGENT-PROTOCOL.md`](../AGENT-PROTOCOL.md).
- **Prerequisite outputs — read both before designing the projection:**
  `reports/ORS-1-completion.md` and `reports/ORS-2-completion.md`. They tell you
  what the label-mapping and Granot contracts actually became, which may differ
  from what those issues proposed.
- **Patterns to reuse, not reinvent:**
  - `src/services/operationsRegistry/queries/overview.ts` —
    `getRegistryOverview` is the existing aggregate read shape.
  - `src/services/operationsRegistry/queries/health.ts` — the finding list this
    pass translates into Owner actions.
  - `src/services/operationsRegistry/ringCentralRegistry.ts` and
    `src/routes/ringcentral-registry.routes.ts`.
  - `src/services/operationsRegistry/registryAudit.ts` for the one new mutation.
  - `src/services/operationsRegistry/labelMappings.ts` (ORS-1) and
    `ownerGranotNames.ts` (ORS-2).

## 2. Objective

Give one endpoint the job of answering the four questions specification §7.1
puts in the Lead Source header — what is this called, which Feeds exist, what
external names and numbers enter each Feed, and is each connection ready and
live — so ORS-4 renders an explanation instead of assembling one. Then remove
the two remaining reasons an Owner surface would have to guess: a Lead Source
that needs three manual records to exist, and a RingCentral DTO that returns IDs
where it should return the connection.

## 3. Repository, branch, and prerequisites

- **Repository:** `vantage-main-server` only. No Admin work in this pass.
- **Branch:** the pack branch.
- **Prerequisites: ORS-1 and ORS-2 both `complete`.** Do not start early. The
  projection's per-Feed label list and Granot policy/text state are exactly what
  those passes define; building against today's shapes means rewriting this.
- Ordinary checks use redacted synthetic data. Runtime reads require
  `TEST_MODE=true` and `testvantagemovers`.
- No commit, push, deploy, production flag change, production index apply, live
  payload read, or external send.

## 4. Current-state evidence to verify

Observed 2026-08-24; **reverify at implementation**, and reconcile against both
prerequisite completion reports.

- `queries/overview.ts` exports one function, `getRegistryOverview()`. There is
  **no** per-Lead-Source aggregate projection.
- `v1.routes.ts` mounts the low-level collections separately:
  `/admin/source-companies` (:329-342, including `/:id/dependencies`),
  `/admin/source-granularities` (:344-360, plus CPL routes at :384-389),
  `/admin/granot-crm-sources` (:362-375),
  `/admin/operations-registry/overview` (:478), `/health` (:482), `/changes` (:486).
  There is no `/admin/operations-registry/lead-sources`.
- `src/routes/ringcentral-registry.routes.ts` mounts inbound-route list (:29),
  detail (:44), create (:58), update (:70), and several `POST` actions
  (:83-127). Confirm which of those are validate / activate / reassign before
  editing their DTOs.
- Existing health codes to translate include
  `registry.ringcentral_validation_failed`,
  `registry.ringcentral_route_inconsistent`,
  `registry.ringcentral_assignment_inconsistent`,
  `registry.source_granularity_inactive_company`,
  `registry.source_default_invalid`, `registry.cpl_schedule_invalid`,
  `registry.cpl_missing_rate_leads`, `registry.compatibility_reads_remaining`,
  `registry.source_resolution_failures`, plus everything ORS-1 and ORS-2 added.
- Paid Overflow already has a first-class `paid_overflow` Form Feed and one
  `FormLead + any` route (`pnpm migration:paid-overflow-source` exists). **Its
  Feed identity is correct and must not be removed** — §3.5 is about the Owner
  workflow, not the storage.

## 5. Locked decisions and invariants at risk

- **The projection is read-only.** It creates no Command, `EntityChange`,
  revision, outbox row, or notification. Existing audited commands remain
  mutation authority. The one new mutation in this pass is §6.3, and it is a
  separate route.
- **A single-channel Lead Source still gets a first-class Feed.** Lead identity,
  duplicate detection, CPL, Granot connections, and historical snapshots all key
  on the Feed ID. The setup command creates *both* records; it never creates a
  Lead Source that leans on a company-level default.
- **The setup command is atomic.** One audited transaction creates an inactive
  Lead Source and one inactive default Feed, or neither. A partial success
  leaves the Owner with a Lead Source that cannot receive anything.
- **Created inactive.** The setup command never activates. Activation stays the
  existing separate, fail-closed, audited command.
- **RingCentral activation and reassignment still accept only
  `source_granularity_id`.** The server loads the Feed, requires it active and
  `channel: call`, derives the Lead Source, and stores both. **This already
  works — do not loosen it while enriching the response.** Enrichment is
  response-side only.
- **Every finding must map to one Owner action and one deep link.** A finding
  the Owner cannot act on is noise; if you cannot name the action, the finding
  belongs in advanced details, not the projection.
- Raw health codes stay available in advanced details. Translating is additive.
- The projection must not `$lookup` its way into an unbounded fan-out. Bound
  every join by the Lead Source's own Feed set.

## 6. Deliverables and exact contract

### 6.1 Aggregate read model

```text
GET /api/v1/admin/operations-registry/lead-sources
GET /api/v1/admin/operations-registry/lead-sources/:id
```

New `src/services/operationsRegistry/queries/leadSourceProjection.ts`. Each
projection returns:

- Lead Source identity and state — `company_slug`, `name`, `owner_label`,
  active/inactive, aliases, sheet container configuration;
- its Feeds, each with `granularity_key`, `channel`, Owner display name,
  `crm_label` (labelled **What Vantage sends to Granot**), optional move type,
  active state, and readiness;
- accepted sheet/legacy labels **per Feed**, from ORS-1's mappings, with
  namespace;
- Granot names that can land in each Feed — the name received from Granot, the
  policy in Owner language, the text state, and the route shape (`one_feed` or
  `form_by_move_type`, with both Feeds and the selection rule when it is the
  exception);
- RingCentral numbers currently assigned to each call Feed, with the effective
  assignment start;
- CPL readiness per Feed;
- connection health findings, each translated to one Owner action and a deep
  link, with the raw code retained in an advanced block.

The list endpoint returns a bounded summary — enough for §7.1's header
questions, not the full per-Feed label sets. The detail endpoint is the complete
explanation surface. Both echo `generated_at`.

**Contract note:** the detail response is ORS-4's only data source for the Lead
Source detail page. If ORS-4 would need a second request to render §7.2, this
projection is incomplete — fix it here, not there.

### 6.2 Health translation

`src/services/operationsRegistry/queries/findingTranslation.ts`:

```ts
export type OwnerFinding = {
  code: string;              // raw registry code, retained
  severity: "blocking" | "reviewable";
  owner_message: string;     // plain language, no implementation enums
  owner_action: string;      // exactly one action
  deep_link: string;         // the Admin surface that fixes it
  scope: { lead_source_id: string; source_granularity_id?: string };
};
```

One table, exhaustive over the codes listed in §4 plus everything ORS-1 and
ORS-2 added. An untranslated code must surface as itself with a generic action —
**never be silently dropped**. A test asserts the table covers every code the
health module can emit; that test fails when someone adds a code without a
translation, which is the point.

### 6.3 Combined setup command

Read specification §6.3 and §7.4 in full before starting this. The command's
shape is decided there and this section only sequences it.

```text
POST /api/v1/admin/operations-registry/lead-source-setups
POST /api/v1/admin/operations-registry/lead-source-setups/preview
```

New `src/services/operationsRegistry/leadSourceSetup.ts`. **One audited
transaction** creating, all inactive:

1. a `LeadSourceCompany` with a server-derived immutable `company_slug`;
2. one `LeadSourceGranularity` with an immutable `granularity_key`, the
   requested `channel`, an Owner display name, and a `crm_label`;
3. **when the Owner supplied one**, a `GranotCrmSource` connected to that Feed,
   with `outbound_sms` not written at all.

Step 3 is what makes the Owner flow one flow rather than three forms. Either all
the requested records exist and are mutually consistent, or none do. Reuse
ORS-2's `createGranotNameFromOwnerIntent` translation — do **not** write a
second Granot assembly path — and run it inside this transaction's session.

Command shape is specification §6.3's `LeadSourceSetupCommand` verbatim. All of
`company_slug`, `granularity_key`, `normalized_granot_label`, `crm_origin`,
`workspace_slug`, `lifecycle_disposition`, `lead_model`, and the single `any`
route are server-derived; the route rejects them if sent.

Validation runs completely before any write, and the command is rejected whole:

1. `reason` is 10–1000 characters.
2. Derived `company_slug` and `granularity_key` are unused.
3. `crm_label` does not collide, case-insensitively, with any **active** Feed of
   the same channel — the same predicate `assertExactIdentifiersAvailable` uses
   at activation. Factor that predicate out rather than duplicating the regex.
4. No alias on either record resolves to an existing active company or Feed;
   report collisions naming both sides.
5. The Granot label normalizes to a value no existing source holds, and the
   derived `workspace_slug` is free.

**`/preview` runs exactly the same validation and writes nothing**, returning
the derived keys, the normalized Granot label, every collision, and the
outstanding readiness gates. ORS-4's review step renders that response; a
second, client-side validation path is a defect, not a convenience.

The success response returns all created records plus an ordered **readiness
plan** — the gates from specification §3.4.2 and §7.4.2 step 5, each naming the
existing audited command that satisfies it and the gate it is waiting on. The
go-live checklist is rendered from this, so ORS-4 never reconstructs the
ordering in the browser.

The advanced path is unchanged: create a Lead Source and add multiple Feeds
through the existing routes before connecting Granot.

### 6.4 RingCentral DTO enrichment

In `ringCentralRegistry.ts` and the route responses: `current_assignment` and
assignment history entries carry, in addition to their existing IDs:

- `lead_source_name` and `lead_source_company_slug`;
- `feed_display_name`, `granularity_key`, and `channel`;
- `effective_from` and `effective_until`.

Resolve labels with one bounded `$in` per response, not per assignment.

**Response-side only.** Accepted request bodies are unchanged: activation and
reassignment still take `source_granularity_id` and nothing else. A test asserts
that a request carrying a company ID is still rejected.

## 7. Explicitly out of scope

- All Admin/UI work and all Owner copy — ORS-4. This pass ships DTOs and the
  strings inside them; it renders nothing.
- Any change to label-mapping or Granot semantics — ORS-1 and ORS-2 own those.
  Discrepancies go to the **Cross-pass findings** table in `PROGRESS.md`.
- Any new mutation beyond §6.3.
- Any change to RingCentral request validation, activation ordering, effective
  dating, or the resolver's cache policy.
- Removing Paid Overflow's Feed, or any other single-channel source's Feed.
- Removing or deprecating the low-level `/admin/source-companies` and
  `/admin/source-granularities` routes. They remain mutation authority.
- Static-map removal, embedded `granularities[]` removal, index drops.

## 8. Flags and runtime posture

- **No new flag.** The projection is gated by Owner authorization.
- The projection must render correctly when the registry is nearly empty, when a
  Lead Source has zero Feeds, when a Feed has zero labels, and when a call Feed
  has no assigned number. Each of those is a test, not a caveat — an empty
  section must say it is empty, never be absent.

## 9. Migration and indexes

No new collection. The projection's per-Feed lookups may need supporting
indexes; ORS-1 already added `{ source_granularity: 1, active: 1 }` on the
mappings, and `GranotCrmSource` already indexes
`lifecycle_routes.source_granularity_id`. Add nothing speculatively. If a
measured query needs an index, add it report-first with the measurement in your
report. **No production index apply is authorized.**

## 10. Acceptance criteria

- [ ] `GET /admin/operations-registry/lead-sources/:id` returns, in one request,
      every Feed with its accepted sheet labels, Granot names, assigned inbound
      numbers, and CPL readiness. A test asserts ORS-4's §7.2 render needs no
      second request.
- [ ] A Lead Source with two Form Feeds distinguished only by move type renders
      both, each with its own label set — no field collapses them.
- [ ] A Granot name with `form_by_move_type` appears under **both** target Feeds
      and carries the selection rule; a `one_feed` name appears under exactly
      one.
- [ ] Every finding in the projection has a non-empty `owner_action` and
      `deep_link`; a test asserts the translation table covers every code the
      health module can emit and fails on an unknown code.
- [ ] Findings retain their raw `code` in advanced details.
- [ ] `POST /lead-source-setups` creates exactly one Lead Source and one Feed,
      both inactive, in one transaction; the response names the outstanding
      readiness gates.
- [ ] A setup whose derived `company_slug`, `granularity_key`, or `crm_label`
      collides writes **nothing** — asserted by document counts before and after.
- [ ] A setup command failing mid-transaction leaves neither record.
- [ ] A Paid Overflow-shaped source created through the setup command has one
      first-class Feed, and the existing `paid_overflow` Feed is unchanged.
- [ ] `current_assignment` and every history entry carry Lead Source name and
      Feed display name alongside their IDs.
- [ ] A RingCentral reassignment request carrying a company ID is still
      rejected, and one carrying an inactive or non-`call` Feed is still
      rejected.
- [ ] The projection issues a bounded number of round trips — assert an upper
      bound per request and record the measured count.
- [ ] No projection request produces a Command, `EntityChange`, revision,
      outbox row, or notification. Proven by counting those collections before
      and after.
- [ ] The projection renders correctly for a Lead Source with zero Feeds, a Feed
      with zero labels, and a call Feed with no number — each an explicit empty
      state.

## 11. Required tests and commands

```bash
pnpm test
pnpm typecheck
```

Focused tests:

- `src/services/operationsRegistry/queries/leadSourceProjection.test.ts` — the
  §7.2 completeness case, the two-move-type-Feeds case, the three empty states,
  and the round-trip bound.
- `src/services/operationsRegistry/queries/findingTranslation.test.ts` — the
  exhaustiveness test over emitted codes.
- `src/services/operationsRegistry/leadSourceSetup.test.ts` — atomicity,
  each collision, inactive-on-create.
- `src/services/operationsRegistry/ringCentralRegistry.test.ts` — enriched DTO
  shape plus the unchanged-request-validation regressions.
- Route tests — Owner-only gating, unknown-key rejection, error-envelope parity.

Zero-mutation proof for the projection: seed a database, call both endpoints,
assert `domain_command_executions` and `entity_changes` counts are unchanged.

## 12. Live/staging verification

Preview deploy against `TEST_MODE` and `testvantagemovers`. Verify: a seeded
multi-Feed Lead Source renders every connection in one response; the setup
command creates two inactive records; a RingCentral detail response explains its
assignment without a second call. Capture deployment ids and paste one full
detail response (redacted) into the report — ORS-4 builds against it.

**No production deploy, no production index apply, no live payload read.**

## 13. Rollback

Ordered: unmount the two projection routes and the setup route — that removes
all new reachability. The RingCentral DTO enrichment is additive; leave it or
revert it independently, since no client requires it until ORS-4. Records created
by the setup command exist only on the test database and are inactive.

## 14. Required completion handoff

Report: files added and changed; the finding-translation table as implemented;
one full redacted detail response; the measured round-trip count per endpoint;
the setup command's derivation rules for `company_slug` and `granularity_key`;
confirmation that RingCentral request validation is unchanged, with the
rejection test output; zero-mutation proof output; test and typecheck output;
preview deployment ids.

Then update [`../PROGRESS.md`](../PROGRESS.md): tick §3.5, §3.6, §5.3, §6.1,
§6.3 (setups), §6.4, §8 (translation), §9.6 (server half), and criterion 3; set
ORS-3 `complete`; move ORS-4 to `ready`.

**Unblocks:** ORS-4.
