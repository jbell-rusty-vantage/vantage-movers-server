# Show The Owner Every Granot Name With Whether Its Company And Feeds Still Match, Which HTTP Automation Sources Point At It And Whether Those Sources May Be Applied, And Who Last Changed The Card — Count Shared Folded Labels Across Every Card On The List And Only Across This Card On Detail — Never Resolve A Live Observation — Never Send A Text — Never Write A Registry Change — operational story

- Status: recommended
- Service: `operationsRegistry` (Wave A, in-progress)
- Pass: 11 of this service — `granotCrmSourceProjections.ts`
- Remaining in this service: `granotAutomationSources.ts`, `trustedActor.ts`, `registryAudit.ts`, `runtimeTelemetry.ts`, `queries/overview.ts`, `queries/health.ts`, `queries/changes.ts`
- Target: `src/services/operationsRegistry/granotCrmSourceProjections.ts`
- Knowledge: [`docs/knowledge/services/operations-registry.md`](../../../docs/knowledge/services/operations-registry.md) (list/detail enrichments for Admin: dependency labels/status, automation references plus compatibility, and latest safe audit metadata; no receipt/payload/contact fields; “Lifecycle-enabled non-deferred rows with matching routes project `available_for_apply: true`” — **code never sets `available_for_apply` on the Granot CRM source card**; that flag lives on each linked automation row’s `compatibility`, from already-recommended `evaluateGranotAutomationCompatibility`). Software rule: [`.cursor/rules/operations-registry.mdc`](../../../.cursor/rules/operations-registry.mdc) (runtime Granot policy reads go through `sourcePolicy.ts`, not here; HTTP `GET/PATCH /api/v1/admin/granot-crm-sources` — reads Owner/Admin). Already-recommended Granot name cards: [recommendations/operations-registry-granot-crm-sources.md](operations-registry-granot-crm-sources.md) (**asks** `listRegistryGranotCrmSources({ includeDisabled: true })` / `getRegistryGranotCrmSource`; this file does **not** record a policy). Already-recommended confirmation-text policy: [recommendations/operations-registry-crm-source-outbound-sms.md](operations-registry-crm-source-outbound-sms.md) (sibling PATCH **returns that view**, not this projection; this file does **not** attach or rewrite `outbound_sms`). Already-recommended apply readiness: [recommendations/granot-lifecycle-automation-compatibility.md](granot-lifecycle-automation-compatibility.md) (`evaluateGranotAutomationCompatibility` — this file **asks** it per linked automation row and does **not** load a second Registry row). HTTP automation catalog: [recommendations/granot-http-collector-source-catalog.md](granot-http-collector-source-catalog.md) (**asks** sibling list, not this file). Owner UI ODR-39: [`docs/owner-daily-operations-and-intakes-reduced/issues/ODR-39.md`](../../../docs/owner-daily-operations-and-intakes-reduced/issues/ODR-39.md) (detail keeps the latest audit line and the `automation_sources` panel). Next module `granotAutomationSources.ts` owns the Owner link write. This checkout’s `CONTEXT.md` does not define Granot CRM Source / Granot Automation Source / Feed — do not invent a glossary copy. `docs/adr/` is absent here — do not invent an ADR copy. Do not add this path to knowledge in this rename.
- Callers: Wave B `GET /api/v1/admin/granot-crm-sources` **asks** `listProjectedGranotCrmSources` (`requireRegistryReadActor`; Admin may read). Wave B `GET .../:id` **asks** `getProjectedGranotCrmSource`. Wave B `PATCH .../:id` and `PATCH .../:id/activation` write through already-recommended sibling cards, then **re-read this file**. Barrel: `operationsRegistry/index.ts` (list + get + `GranotCrmSourceProjection`). There is **no** `granotCrmSourceProjections.test.ts`. `v1.routes.test.ts` only proves the four Granot CRM source routes exist. Sibling `granotCrmSources.test.ts` “read-after-write” proves the card cache, not this enrich. `sourcePolicy.ts` / HTTP automation catalog / SMS command / `setGranotAutomationSourceReference` **do not import this file**.
- Seams callers need: list (every card; shared-label count is across the loaded set) vs detail (one card; shared-label count is 1 whenever this card has a folded label); HTTP GET is a read **adapter** (Admin ok); HTTP PATCH / activation re-read after sibling write (not a second write **seam**)
- Split later (only if the file outgrows one sitting): this ~266-line file is one sitting if you read it as show the Owner every Granot name with whether its company and Feeds still match, which HTTP automation sources point at it and whether those sources may be applied, and who last changed the card — count shared folded labels across every card on the list and only across this card on detail — never resolve a live observation — never send a text — never write a Registry Change. If it later splits: `showTheOwnerEveryGranotNameWithLiveCompanyFeedAndAutomationHealth.ts` / `showOneGranotNameWithLiveCompanyFeedAndAutomationHealth.ts` — story files, never `list.ts` / `get.ts` / `create.ts` / `update.ts` / `project.ts`, and never merge sibling Granot name write, SMS command, automation-source link write, `evaluateGranotAutomationCompatibility`, `sourcePolicy` resolve, HTTP automation catalog, `withRegistryMutation`, or Wave B HTTP into this file

`listProjectedGranotCrmSources` / `getProjectedGranotCrmSource` are executor mechanics. The owner question is: *The Owner (or Admin) may see every Granot name card with three live checks attached: does the pointed Source Company still exist and stay on; does each Feed still exist, match this route’s Form/Call channel and move type, and stay on; and which HTTP automation sources point at this name, plus whether already-recommended apply-readiness says those sources may be applied. The latest `granot_crm_source` Registry Change is the “who last changed the card” line. A confirmation-text save and an automation-source link write do not become that line. The list counts how many loaded cards share a folded label before it asks readiness. The detail path loads one card, so that count is 1 whenever the card has a folded label. This file does not resolve a live observation. It does not send a text. It does not write a Registry Change. It does not attach or hide a pointer.*

Sibling Granot name write, SMS command, automation-source link write, apply-readiness, `sourcePolicy` resolve, HTTP automation catalog, `withRegistryMutation`, Source Company / Feed write, and Wave B HTTP already live in other **modules**. Do not pull those in.

## What this file actually does

Two operations of one “show the Owner every Granot name with whether its company and Feeds still match, which HTTP automation sources point at it and whether those sources may be applied, and who last changed the card — count shared folded labels across every card on the list and only across this card on detail — never resolve a live observation — never send a text — never write a Registry Change” story, not “a Granot CRM source projection CRUD service,” and not sibling policy write / apply / resolve:

1. **Show the Owner every Granot name with live company, Feed, and automation health** — `listProjectedGranotCrmSources`. **Asks** already-recommended `listRegistryGranotCrmSources({ includeDisabled: true })` (sibling `includeDisabled` does **not** filter; every card loads). **Asks** `projectRecords` once for the set. Batch-loads Source Companies (`owner_label` / `name` / `active`), Source Granularities (`granularity_key` / `owner_label` / `channel` / `local` / `active`), `GranotAutomationSource` rows pointed at these ids (label, active, `supported_operations`), and `OperationsRegistryChange` rows where `entity_type` is `granot_crm_source` (newest `created_at` first; first row per card wins). Company status is `active` / `inactive` / `missing` only when `lead_source_company` is set. Each route gets granularity key/label when present and `source_granularity_status` from `routeStatus` (`missing` / `wrong_channel` / `wrong_move_type` / `active` / `inactive`). Each linked automation row **asks** `evaluateGranotAutomationCompatibility` with this card as `referenced`, `requested_operations` filtered from that row’s `supported_operations`, and `normalized_label_match_count` from how many **loaded** cards share `normalized_granot_label`. Wave B GET list **asks** this. This beat does **not** open a transaction. This beat does **not** write. This beat does **not** resolve `sourcePolicy`.

2. **Show one Granot name with the same live checks** — `getProjectedGranotCrmSource`. **Asks** already-recommended `getRegistryGranotCrmSource` (sibling `NOT_FOUND` if missing). **Asks** `projectRecords([record])`. If the mapped row is missing, throws a generic `Error("Failed to project Granot CRM source.")` — that path is dead while `projectRecords` maps every input. Shared-label count sees only this one card, so a folded label on detail is always count `1`. Wave B GET detail **asks** this. Wave B policy PATCH and `/activation` **re-read** this after sibling write. This beat does **not** return the sibling card. This beat does **not** return the SMS view as the HTTP body. This beat does **not** write.

There is no third write operation. There is no resolve. There is no send. `evaluateGranotAutomationCompatibility` is the apply-readiness **adapter**. Sibling list/get are the card-load **adapters**. Wave B GET / re-read are second read **adapters**, not second owner stories. `routeStatus` and the latest-audit fold sit on both show paths. They are not extra owner operations. Do not export `routeStatus` / `projectRecords` / `unique` as public **seams**.

## Organization

Keep one file as the screenplay for “show the Owner every Granot name with whether its company and Feeds still match, which HTTP automation sources point at it and whether those sources may be applied, and who last changed the card, count shared folded labels across every card on the list and only across this card on detail, never resolve a live observation, never send a text, never write a Registry Change.” Sibling Granot name write, SMS command, automation-source link write, apply-readiness, `sourcePolicy` resolve, HTTP automation catalog, `withRegistryMutation`, Source Company / Feed write, and Wave B HTTP already live in deeper **modules**. Do not pull those in. Do not invent a `GranotCrmSourceProjectionService` class. Do not invent a begin / complete **seam** — this file is a read. Do not invent a second apply-readiness **adapter** beside `evaluateGranotAutomationCompatibility`. Do not invent a second card-load **adapter** beside sibling list/get.

Do not split this into `list.ts` / `get.ts` / `create.ts` / `update.ts` / `project.ts` as a CRUD folder. Those are persistence verbs, and list vs detail are one story with two **adapters**. Do not move `evaluateGranotAutomationCompatibility` into this file so “the Admin card owns apply.” Do not move `createOrUpdateGranotCrmSource` into this file so “read and write live together.” Do not silently start resolving observations here so “the Owner screen stays hot.”

**External interface** stays small (this is the test surface). Show-every and show-one are one story’s Admin enrich, not two CRUD verbs:

| Keep exporting | Story name | Why the seam exists |
|---|---|---|
| `listProjectedGranotCrmSources` | `showTheOwnerEveryGranotNameWithLiveCompanyFeedAndAutomationHealth` | Wave B GET list |
| `getProjectedGranotCrmSource` | `showOneGranotNameWithLiveCompanyFeedAndAutomationHealth` | Wave B GET detail; PATCH / activation re-read |
| `GranotCrmSourceProjection` | `OwnerGranotNameWithLiveHealth` | HTTP body after enrich |
| `GranotCrmSourceRouteProjection` | `ThisFeedAndWhetherItStillMatches` | route plus key/label/status |
| `GranotCrmSourceDependencyStatus` | `CompanyOrFeedMatchStatus` | `active` / `inactive` / `missing` / `wrong_channel` / `wrong_move_type` |
| `GranotCrmSourceAuditProjection` | `WhoLastChangedThisGranotNameCard` | latest `granot_crm_source` Change only |

Keep the old names as one-line aliases until Wave B GET / PATCH / activation, the barrel, and any later interface test migrate. Do not make callers learn `listProjected` / `getProjected` / `projectRecords` as the domain language.

**Principle: old exports stay as aliases.** `listProjectedGranotCrmSources` remains the imported name until Wave B GET list migrates. `getProjectedGranotCrmSource` remains the imported name until Wave B GET detail and the two re-reads migrate. Persisted Change `entity_type` values (`granot_crm_source` vs `granot_crm_source_sms_policy` vs `granot_automation_source`) stay those strings — they are audit history, not story names.

**No class for the workflow.** The type that *does* earn a name is the Owner card HTTP already returns after this enrich:

```ts
type OwnerGranotNameWithLiveHealth = OwnerGranotCrmSourceCard & {
  lead_source_company_label?: string
  lead_source_company_status?: CompanyOrFeedMatchStatus
  lifecycle_routes: Array<WhichFeedThisObservationMayAttachTo & {
    source_granularity_key?: string
    source_granularity_label?: string
    source_granularity_status: CompanyOrFeedMatchStatus
  }>
  automation_sources: Array<{
    id: string
    label: string
    active: boolean
    compatibility: AutomationSourceApplyReadiness
  }>
  latest_audit?: {
    id: string
    action: string
    actor_label: string
    actor_role: string
    reason?: string
    created_at: string
  }
}
```

That is the handoff from “we loaded the Owner cards” to “Admin can see why a company, Feed, or HTTP automation source is not ready.” Do **not** add `available_for_apply` on the card so “knowledge wins.” Do **not** add receipt / payload / contact fields so “the Owner can debug Granot.” Do **not** add `outbound_sms` rewriting so “the projection owns texting.” Do **not** add `sourcePolicy` gates so “Admin matches runtime.”

Do not add `evaluateGranotAutomationCompatibility` as a public **seam** from this file — already-recommended apply-readiness already owns that. Do not add `listRegistryGranotCrmSources` / `getRegistryGranotCrmSource` as public **seams** from this file — sibling cards already own those. Do not add `setGranotAutomationSourceReference` as a public **seam** — next module owns that. Do not add `withRegistryMutation` as a public **seam** — `registryAudit.ts` already owns that.

## The file, as a story

Parent functions stay deep. Child names are only extracted when they hide a real decision, not a one-liner.

```ts
// granotCrmSourceProjections.ts
// The Owner (or Admin) may see every Granot name.
// Attach three live checks: does the company still exist and stay on,
// does each Feed still match this route and stay on,
// and which HTTP automation sources point here — plus whether those
// sources may be applied.
// The latest granot_crm_source Registry Change is who last changed the card.
// The list counts shared folded labels across every loaded card.
// The detail path loads one card, so that count is 1.
// This file does not resolve a live observation.
// This file does not send a text.
// This file does not write a Registry Change.

// ── 1. Show every Granot name with live health ────────────

export async function showTheOwnerEveryGranotNameWithLiveCompanyFeedAndAutomationHealth()

// ── 2. Show one Granot name with the same checks ──────────

export async function showOneGranotNameWithLiveCompanyFeedAndAutomationHealth(id)

async function attachLiveCompanyFeedAndAutomationHealth(cards)

function countHowManyLoadedCardsShareThisFoldedLabel(cards)
function sayWhetherThisCompanyStillExistsAndStaysOn(companyId, companies)
function sayWhetherThisFeedStillMatchesTheRoute(route, granularity)
function askWhetherEachLinkedAutomationSourceMayBeApplied(card, rows, labelCounts)
function keepOnlyTheNewestGranotCrmSourceChangePerCard(audits)
```

Read the primary path out loud: *Load every Owner Granot name card. For the set, load the pointed companies, the pointed Feeds, the HTTP automation sources that point at these ids, and the newest `granot_crm_source` Registry Change per card. Count how many loaded cards share a folded label. For each card, say whether the company still exists and stays on. For each route, say whether the Feed is missing, on the wrong channel, the wrong move type, inactive, or active. For each linked automation source, ask already-recommended apply-readiness with this card and that shared-label count. Attach the newest `granot_crm_source` change as who last changed the card. Do not resolve a live observation. Do not send a text. Do not write a Registry Change.*

That is the operation. `listProjectedGranotCrmSources` is not.

## Precise logic I would tighten while renaming

These are real smells the story names make obvious. Do not “just rename.”

1. **Detail under-counts shared folded labels.** List **asks** readiness with a count across every loaded card. Detail **asks** `projectRecords([record])`, so a folded label is always count `1` and `source_ambiguous` cannot appear. Two cards that share a label look ready on GET detail and ambiguous on GET list. Do not silently load every card on detail so “the count matches” without a paired list + detail interface test. Do not silently drop the count on list so “detail wins.”

2. **Knowledge puts `available_for_apply` on the Granot name.** Knowledge says lifecycle-enabled non-deferred rows with matching routes project `available_for_apply: true`. This file never sets that flag on `GranotCrmSourceProjection`. It lives on `automation_sources[].compatibility`. A card with no linked automation source has no `available_for_apply`. Do not silently add the flag on the card so “knowledge wins.” Do not silently hide the nested flag so “the card is the unit.”

3. **An automation source with no `supported_operations` can look ready.** This file filters that row’s operations, then **asks** apply-readiness. Empty `requested_operations` plus an enabled, lifecycle-enabled, non-deferred, unique-label card returns `available_for_apply: true`. Catalog create-without-pointer is a different story. Do not silently treat empty operations as `operation_not_permitted` so “no work means no apply” without a paired interface test.

4. **`latest_audit` ignores SMS and automation-source writes.** The query is `entity_type: "granot_crm_source"` only. Already-recommended confirmation-text saves write `granot_crm_source_sms_policy`. Next-module link writes write `granot_automation_source`. Activation still goes through sibling record-or-correct, so it can refresh this line; an SMS save cannot. Do not silently union the three entity types so “who last touched this name” without a paired Owner UI + audit test. Do not silently drop `latest_audit` so “ODR-39 loses the line.”

5. **The audit query loads full Change documents.** It does not `.select` the safe fields. Knowledge says “latest safe audit metadata” and “no receipt/payload/contact fields.” The mapped view is safe (`id` / `action` / actor / `reason` / `created_at`); the lean load can still pull snapshots into memory. Do not silently start returning `before` / `after` so “Admin can diff.” Do not silently claim the query is field-safe because the DTO is.

6. **`Failed to project Granot CRM source.` is a dead throw.** `getRegistryGranotCrmSource` already 404s. `projectRecords` maps every input. Do not silently turn that generic `Error` into `NOT_FOUND` so “one miss code” without a paired test. Do not start using it as the missing-card path.

7. **`wrong_move_type` is skipped when the Feed has no `local`.** `routeStatus` only compares when `route.move_type !== "any"` **and** `granularity.local` is set. A local-only route against a Feed with unset `local` can still be `active`. Do not silently treat unset `local` as a mismatch so “every route is strict” without a paired interface test.

8. **No interface test owns this file.** Folder tests lock sibling writes and route registration. Do not treat `granotCrmSources.test.ts` read-after-write or `v1.routes.test.ts` path lists as enrich proof.

9. **Leave sibling modules alone.** `listRegistryGranotCrmSources`, `getRegistryGranotCrmSource`, `evaluateGranotAutomationCompatibility`, `setGranotAutomationSourceReference`, `setGranotCrmSourceOutboundSms`, and `resolveSourcePolicy` are already the right depth. This file orchestrates the Admin enrich.

10. **Do not silently change persisted Change `entity_type` strings.** `granot_crm_source` / `granot_crm_source_sms_policy` / `granot_automation_source` are audit history. Story names live on the functions.

## Testing

The **interface** is the test surface: `showTheOwnerEveryGranotNameWithLiveCompanyFeedAndAutomationHealth`, `showOneGranotNameWithLiveCompanyFeedAndAutomationHealth`.

Today there is no `granotCrmSourceProjections.test.ts`. `v1.routes.test.ts` only lists the routes. Sibling write tests do not prove this enrich. Add tests that name the operation:

**Show every**
- Every Owner card is returned, including operationally off and lifecycle-off cards (`includeDisabled: true` / sibling no-op filter).
- A pointed active company → `lead_source_company_status: "active"` and a label. A pointed missing id → `"missing"`. No `lead_source_company` → those fields are omitted.
- A missing Feed → `source_granularity_status: "missing"`. Call route vs form Feed → `"wrong_channel"`. Local route vs long-distance Feed → `"wrong_move_type"`. Inactive matching Feed → `"inactive"`.
- Two cards that share a folded label: each linked automation row’s `compatibility.status` is `source_ambiguous` on the list.
- A linked automation row **asks** apply-readiness with this card as `referenced`. `available_for_apply` lives on that row, not on the card.
- `latest_audit` is the newest `granot_crm_source` Change. An SMS-policy Change does not win.
- The mapped audit has no snapshot, receipt, payload, or contact fields.

**Show one**
- Missing id → sibling `NOT_FOUND`, not `Failed to project Granot CRM source.`
- Today a shared folded label on detail is count `1`, so `source_ambiguous` does **not** appear. Keep that until a paired list + detail change.
- Wave B PATCH / activation re-read this after sibling write. Do not retest sibling semantics here.

Do **not** add a test per helper (`sayWhetherThisFeedStillMatchesTheRoute`, `countHowManyLoadedCardsShareThisFoldedLabel`, `keepOnlyTheNewestGranotCrmSourceChangePerCard`). Those names exist so the parent reads. If a helper test has to change when the helper is inlined, it was testing past the **interface**.

Do **not** retest `evaluateGranotAutomationCompatibility` tables, sibling create/update, SMS enable, or `setGranotAutomationSourceReference` here. Those already have (or will have) their own interface tests.

## What I would not do

- A `GranotCrmSourceProjectionService` class with `create` / `update` / `delete`.
- Thirty two-line functions that only wrap sibling list/get or `evaluateGranotAutomationCompatibility`.
- Moving this into a CRUD folder (`list.ts` / `get.ts` / `create.ts` / `update.ts` / `project.ts`) for cleanliness.
- Inventing a begin / complete **seam** on a read that has no transaction.
- Treating sibling Granot name write, SMS command, automation-source link write, `sourcePolicy` resolve, HTTP automation catalog, `withRegistryMutation`, Source Company / Feed write, or Wave B HTTP as this story.
- Inventing a **seam** that has only one **adapter**.
- Silently "fixing" a known gap while recommending a rename: do not load every card on detail so the label count matches list; do not drop the list count so detail wins; do not add `available_for_apply` on the card so knowledge wins; do not treat empty `supported_operations` as not-permitted without a paired test; do not union SMS and automation-source Changes into `latest_audit` without a paired Owner UI test; do not return Change snapshots; do not retarget the dead generic `Error` as `NOT_FOUND`; do not treat unset Feed `local` as `wrong_move_type`; do not move apply-readiness or sibling write into this file; do not rename persisted Change `entity_type` strings.
- Jumping to the next service while this one has unchecked modules.
- Writing a whole-folder recommendation for `operationsRegistry`.
