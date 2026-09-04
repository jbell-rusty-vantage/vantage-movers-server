# Say Which Live Feed This Hint Would Stamp — Company First, Then Exact Key Or CRM Label Or Source Site, Then Local Or Long Distance, Then Leftover Alias By Unique Highest Priority, Then The Company Channel Default — One Match Or Missing Or Ambiguous — Never Invent A Company — Never Pick The First Of Two Equal-Priority Aliases — Inactive Cards Are Invisible — Never Load Mongo — Never Throw — Never Write An Operational Event — operational story

- Status: recommended
- Service: `operationsRegistry` (Wave A, in-progress)
- Pass: 3 of this service — `sourceResolution.ts`
- Remaining in this service: `cplSchedule.ts`, `cplCorrections.ts`, `ringCentralRegistry.ts`, `ringCentralSnapshot.ts`, `ringCentralValidation.ts`, `granotCrmSources.ts`, `crmSourceOutboundSms.ts`, `granotCrmSourceProjections.ts`, `granotAutomationSources.ts`, `trustedActor.ts`, `registryAudit.ts`, `runtimeTelemetry.ts`, `queries/overview.ts`, `queries/health.ts`, `queries/changes.ts`
- Target: `src/services/operationsRegistry/sourceResolution.ts`
- Knowledge: [`docs/knowledge/services/operations-registry.md`](../../../docs/knowledge/services/operations-registry.md) (Source attribution: exact granularity key / CRM label / source-site must resolve uniquely among active same-channel records; leftover aliases use highest priority; equal-priority ambiguity fails and records an Operational Event; active channel defaults belong to the same active Source Company and point to an active same-channel Feed; default lists and automatic matching use active records only). Already-recommended load / throw / event **adapters**: [recommendations/operations-registry-source-registry.md](operations-registry-source-registry.md) (`previewSourceResolution` / `resolveSourceAttribution` **ask** this file). Already-recommended Lead hint **adapter**: [recommendations/leads-source-company.md](leads-source-company.md) (`resolveLeadSourceAssignment` **asks** leftover `resolveSourceAttribution`, not this file). Leftover nested-book first-hit match: already-recommended [recommendations/lead-source-companies-lead-source-company.md](lead-source-companies-lead-source-company.md) — do not add this file’s fail-closed uniqueness there. Distinct from leftover Granot source-label policy: leftover `granotLifecycle/sourcePolicy.ts` (already-recommended [recommendations/granot-lifecycle-source-policy.md](granot-lifecycle-source-policy.md)). Distinct from leftover static `SOURCE_LABEL_TO_COMPANY` in Wave B `config/domain/sources.ts` — this file’s tests reuse those fixtures; this file does not own that map. Planned leftover label-mapping collection (ORS-1) is **not** this story and is not on disk. This checkout’s `CONTEXT.md` does not define Source Company / Source Granularity — do not invent a glossary copy. `docs/adr/` is absent here — do not invent an ADR copy. Do not add this path to knowledge in this rename.
- Callers: leftover `sourceRegistry.ts` (`previewSourceResolution` / `resolveSourceAttribution` load **active** cards then **ask** `previewSourceAttribution`). Barrel: `operationsRegistry/index.ts` (re-export). Wave B `POST /api/v1/admin/source-resolution/preview` **asks** leftover `previewSourceResolution` (Zod body is channel + optional slug / key / crm_label / source_site / fallback_alias — **no** `local`, **no** `allow_company_identifier_fallback`). Leftover `leads/leadSourceCompany.ts` **asks** leftover `resolveSourceAttribution` and sets `allow_company_identifier_fallback` when the raw value is not an explicit company slug. Tests: `sourceResolution.test.ts` (in-memory cards + leftover static-label fixtures). Leftover `queries/health.ts` counts Operational Events leftover sourceRegistry writes — it does **not** import this file.
- Seams callers need: in-memory cards (this file) vs leftover Mongo load (leftover `listSourceCompanies` / `listSourceGranularities`); status stays on the preview vs leftover fail-closed throw + Operational Event; Owner HTTP hint (no `local`, no company-fallback flag) vs leftover Lead hint (may send both)
- Split later (only if the file outgrows one sitting): this ~287-line file is one sitting if you read it as say which live Feed this hint would stamp — company first, then exact key or CRM label or source site, then local or long distance, then leftover alias by unique highest priority, then the company channel default — one match or missing or ambiguous — never invent a company — never pick the first of two equal-priority aliases — inactive cards are invisible — never load Mongo — never throw — never write an Operational Event. If it later splits: still one matching screenplay, never `create.ts` / `update.ts` / `delete.ts`, and never merge leftover Mongo load, leftover throw + Operational Event, leftover Lead hint interpretation, leftover nested-book first-hit, leftover Granot source-label policy, or leftover static `SOURCE_LABEL_TO_COMPANY` into this file

`previewSourceAttribution` / `selectCompany` / `exactMatches` / `resolved` are executor mechanics. The owner question is: *Given a channel and a hint, which live Feed would we stamp on a Lead? Look at live cards only. Name the company first when the hint has one. Then walk the ladder: the first typed exact identifier (Feed key, then CRM label, then source site), then local versus long distance, then a leftover alias that has one highest-priority winner, then that company’s channel default. One Feed, or say the hint is missing, or say it points at more than one Feed. Do not invent a company. Do not pick the first of two equal-priority leftover aliases. Do not look at archived cards. This file is given the cards; it does not load Mongo. A miss is data — this file does not throw and does not write an Operational Event. Leftover sourceRegistry decides whether the Owner sees the status or a Lead write fails closed.*

Leftover Mongo load, leftover throw + Operational Event, leftover Lead hint interpretation, leftover nested-book first-hit, leftover Granot source-label policy, leftover static label map, leftover telemetry, and Wave B `/source-resolution/preview` HTTP already live in other **modules**. Do not pull those in.

## What this file actually does

Three operations of one “say which live Feed this hint would stamp — company first, then exact key or CRM label or source site, then local or long distance, then leftover alias by unique highest priority, then the company channel default — one match or missing or ambiguous — never invent a company — never pick the first of two equal-priority aliases — inactive cards are invisible — never load Mongo — never throw — never write an Operational Event” story, not “a source-resolution helper,” and not leftover Owner write / leftover Lead assignment:

1. **Pick the company from the hint — or leave the field open** — `selectCompany`. Fold the slug (`trim` + lowercase). Empty slug → `{ status: "resolved" }` with **no** company (the later ladder may match a Feed across every live same-channel card). One live company whose slug or alias matches → that company. Two live companies → `ambiguous` / `company`. Zero → `not_found` / `company`, unless leftover Lead assignment set `allow_company_identifier_fallback` — then a miss becomes “field open” so a leftover alias can still match globally. This beat does **not** invent a company. This beat does **not** look at archived companies.

2. **Walk the live-Feed ladder** — the body of `previewSourceAttribution` after the company beat. Keep only Feeds that are active, on this channel, and (when a company was picked) on that company. Then, in this order: (a) the first nonempty of `granularity_key` / `crm_label` / `source_site` — one match stamps `exact`; more than one is `ambiguous` / `exact`; zero and no leftover alias is `not_found` / `exact`; zero **with** a leftover alias continues; (b) `local` / `long_distance` among the remaining candidates — one match stamps **`exact`** (the name lies; see Precise logic); more than one is `ambiguous` / `exact`; zero continues; (c) leftover `fallback_alias` against Feed `aliases[]` — unique highest `priority` stamps `fallback`; two Feeds at that same priority are `ambiguous` / `fallback` (and the preview carries that priority); zero continues when a company was picked, else `not_found` / `fallback`; (d) that company’s channel default (`default_form_granularity` or `default_call_granularity`) among the remaining candidates — found stamps `default`; missing default id or an inactive / wrong-channel default is `not_found` / `default`. This beat does **not** break a tie on exact identifiers with priority. This beat does **not** consult leftover nested `granularities[]`. This beat does **not** consult leftover `SOURCE_LABEL_TO_COMPANY` at runtime.

3. **Stamp the attribution — or say missing / ambiguous** — `resolved` / `ambiguous`. Success copies company id / slug / owner label, Feed id / key / owner label / CRM label, `match_kind`, and `registry_revision` (today this is the Feed’s `schedule_revision`). `resolved` looks the company up again on the **full** company list it was given and refuses an inactive company (`not_found` / `company`). A miss or a clash is a `SourceResolutionPreview` status. This file never throws. This file never writes `operations_registry.source_resolution_ambiguous` or `…_not_found` — leftover `resolveSourceAttribution` does that.

There is no fourth Owner-write operation. There is no Lead-create operation. There is no Operational Event operation. Leftover `previewSourceResolution` is the Mongo-load **adapter**. Leftover `resolveSourceAttribution` is the fail-closed **adapter**. Leftover `resolveLeadSourceAssignment` is the hint-interpretation **adapter**. Wave B `/source-resolution/preview` is a second preview **adapter** with a narrower Zod body. Leftover nested-book first-hit is a different matcher.

`normalize` / `firstIdentifier` / `exactMatches` sit on the ladder. They are not extra owner operations. Do not export them as a public **seam**. Do not invent a dashboard for `RegistrySourceChannel` in this rename.

## Organization

Keep one file as the screenplay for “say which live Feed this hint would stamp, company first, then exact key or CRM label or source site, then local or long distance, then leftover alias by unique highest priority, then the company channel default, one match or missing or ambiguous, never invent a company, never pick the first of two equal-priority aliases, inactive cards are invisible, never load Mongo, never throw, never write an Operational Event.” Leftover Mongo load, leftover throw + Operational Event, leftover Lead hint interpretation, leftover nested-book first-hit, leftover Granot source-label policy, leftover static label map, leftover telemetry, leftover `withRegistryMutation`, and Wave B `/source-resolution/preview` HTTP already live in deeper **modules**. Do not pull those in. Do not invent a `SourceResolutionService` class. Do not invent a begin / complete **seam** — this file is synchronous and has no transaction. Do not invent a second matching **adapter** beside this function. Do not invent a throw **adapter** beside leftover `resolveSourceAttribution`.

Do not split this into `create.ts` / `update.ts` / `delete.ts` / `company.ts` as a CRUD folder. Those are persistence verbs, and this file does not persist. Do not move leftover `listSourceCompanies` into this file so “one file owns attribution.” Do not move leftover throw + Operational Event into this file so “matching owns fail-closed.” Do not silently start writing a leftover label-mapping collection so “ORS-1 lands in the rename.”

**External interface** stays small (this is the test surface). The ladder is one story’s matcher, not four CRUD verbs:

| Keep exporting | Story name | Why the seam exists |
|---|---|---|
| `previewSourceAttribution` | `sayWhichLiveFeedThisHintWouldStamp` | leftover Owner preview and leftover fail-closed Lead path both **ask** this; tests pass in-memory cards |
| `SourceAttributionInput` | `LiveFeedHint` | channel + optional company / exact identifiers / leftover alias / local / company-fallback flag |
| `SourceAttribution` | `LiveFeedStamp` | ids, label snapshots, `match_kind`, `registry_revision` leftover Lead assignment copies onto the Lead |
| `SourceResolutionPreview` | `LiveFeedMatchPreview` | `resolved` \| `not_found` \| `ambiguous` — a miss is data |
| `RegistrySourceCompanyRecord` / `RegistrySourceGranularityRecord` | `LiveSourceCompanyCard` / `LiveSourceFeedCard` | the in-memory cards leftover sourceRegistry already loads; this file does not fetch them |

Keep the old names as one-line aliases until leftover sourceRegistry, the barrel, and leftover `sourceResolution.test.ts` migrate. Do not make callers learn `selectCompany` / `exactMatches` / `resolved` as the domain language.

**Principle: old exports stay as aliases.** `previewSourceAttribution` remains the imported name until leftover `previewSourceResolution` / `resolveSourceAttribution` migrate. Persisted `match_kind` values (`exact` / `default` / `fallback`) stay those strings on existing Leads and leftover enrichment/recon tests — they are stamped history, not story names. Do not add `local` as a fourth stored `match_kind` in this rename without a paired interface test that names every leftover caller of `match_kind`.

**No class for the workflow.** The types that *do* earn names are the hint leftover Lead assignment already builds and the stamp leftover ingest already copies:

```ts
type LiveFeedHint = {
  channel: "form" | "call"
  company_slug?: string | null
  granularity_key?: string | null
  crm_label?: string | null
  source_site?: string | null
  fallback_alias?: string | null
  local?: "local" | "long_distance"
  allow_company_identifier_fallback?: boolean
}

type LiveFeedStamp = {
  company_id: string
  company_slug: string
  company_label_snapshot: string
  granularity_id: string
  granularity_key: string
  granularity_label_snapshot: string
  crm_label_snapshot: string
  match_kind: "exact" | "default" | "fallback"
  registry_revision: number
}

type LiveFeedMatchPreview =
  | { status: "resolved"; attribution: LiveFeedStamp }
  | { status: "not_found"; identifier_kind: "company" | "exact" | "default" | "fallback"; identifier: string | null }
  | { status: "ambiguous"; identifier_kind: "company" | "exact" | "fallback"; identifier: string; candidate_ids: string[]; priority?: number }
```

That is the handoff from “leftover sourceRegistry loaded the live cards” / “a test built the cards” to “leftover Owner preview returns the status” or “leftover fail-closed Lead path throws and writes an Operational Event.” Do **not** add `throwIfNotResolved` so “matching owns fail-closed.” Do **not** add `loadTheLiveCards` so “matching owns Mongo.” Do **not** add `local` to stored `match_kind` so “the ladder name wins” without a paired interface test.

Do not add `previewSourceResolution` as a public **seam** from this file — leftover `sourceRegistry.ts` already owns that. Do not add `resolveLeadSourceAssignment` as a public **seam** — leftover `leads/leadSourceCompany.ts` already owns that.

## The file, as a story

Parent functions stay deep. Child names are only extracted when they hide a real decision, not a one-liner.

```ts
// sourceResolution.ts
// Given a channel and a hint, say which live Feed we would stamp on a Lead.
// Look at live cards only.
// Name the company first when the hint has one.
// Then walk the ladder: the first typed exact identifier
// (Feed key, then CRM label, then source site),
// then local versus long distance,
// then a leftover alias that has one highest-priority winner,
// then that company’s channel default.
// One Feed, or the hint is missing, or it points at more than one Feed.
// Do not invent a company.
// Do not pick the first of two equal-priority leftover aliases.
// Do not look at archived cards.
// This file is given the cards; it does not load Mongo.
// A miss is data — do not throw, do not write an Operational Event.

// ── 1. Pick the company — or leave the field open ─────────

function pickTheCompanyFromTheHint(liveCompanies, slug)
  // empty slug → field open
  // one slug/alias → that company
  // two → ambiguous / company
  // zero → not_found / company, unless leftover Lead set allow_company_identifier_fallback

// ── 2. Walk the live-Feed ladder ──────────────────────────

export function sayWhichLiveFeedThisHintWouldStamp(companies, feeds, hint)

function keepLiveFeedsOnThisChannel(feeds, hint, company)   // active + channel + company (or all if field open)
function firstTypedExactIdentifier(hint)                    // key, then crm_label, then source_site
function matchTheExactIdentifier(candidates, identifier)    // 1 → exact; >1 → ambiguous; 0 + no alias → not_found; 0 + alias → continue
function matchLocalOrLongDistance(candidates, local)        // 1 → stamped exact (lying); >1 → ambiguous; 0 → continue
function matchTheLeftoverAliasByUniqueHighestPriority(candidates, alias)
function matchTheCompanyChannelDefault(company, candidates, channel)

// ── 3. Stamp — or say missing / ambiguous ─────────────────

function stampTheLiveFeed(companies, feed, matchKind)       // refuse if that company is inactive
function sayTheHintIsAmbiguous(kind, identifier, feeds)
```

Read the primary path out loud: *Fold the company slug. If the Owner typed one and exactly one live company wears it, keep that company; if they typed none, leave the field open; if leftover Lead assignment sent a raw label that is not a company, open the field so a leftover alias can still match. Keep only live Feeds on this channel (and on that company when we have one). If they typed a Feed key, or else a CRM label, or else a source site, stamp that unique Feed as exact — or say the identifier is missing or points at two Feeds. If that exact identifier missed and a leftover alias remains, keep walking. If they sent local or long distance and exactly one remaining Feed wears it, stamp that Feed. If a leftover alias remains, stamp the unique highest-priority alias — or say two Feeds share that priority. Otherwise stamp the company’s live channel default. Copy the ids and label snapshots. Do not invent a company. Do not look at archived cards. Do not throw. Do not write an Operational Event.*

That is the operation. `previewSourceAttribution` is not.

## Precise logic I would tighten while renaming

These are real smells the story names make obvious. Do not “just rename.”

1. **`local` / `long_distance` stamps `match_kind: "exact"`.** Knowledge’s exact identifiers are Feed key, CRM label, and source site. Local is a later ladder rung. Leftover enrichment/recon tests lock `match_kind`. Do not silently add a stored `"local"` kind so “the ladder name wins” without a paired interface test. Rename the beat (`matchLocalOrLongDistance`) so the lie is visible. Re-label stored values only as a separate, tested change.

2. **`firstTypedExactIdentifier` keeps only the first nonempty of key / CRM label / source site.** A hint that sends both a key and a disagreeing CRM label never sees the CRM label. Wave B Zod allows all three on one body. Do not silently require them to agree so “the Owner cannot send a clash” without a paired interface test. Do not silently walk all three so “more hints win.”

3. **An exact miss with a leftover alias continues to local, then alias, then default.** A typo’d Feed key plus a leftover alias can still stamp. That order is load-bearing for leftover Lead assignment (`fallback_alias: input.value`). Do not silently return `not_found` / `exact` whenever a typed key misses so “wrong keys fail closed.”

4. **`allow_company_identifier_fallback` is the leftover Lead path, not Owner HTTP.** Wave B `sourceResolutionPreviewSchema` has no such flag and no `local`. Leftover `resolveLeadSourceAssignment` sets the flag when the raw value is not an explicit company slug (and defaults a missing value to `main_site` **before** it **asks** leftover resolve — that default is leftover Lead interpretation, not this file). Do not silently treat every company miss as field-open so “Owner preview can search globally.” Do not silently add `local` / the flag to Wave B Zod in this rename.

5. **Exact identifiers never use `priority`.** Two live same-channel Feeds with the same CRM label or source site are `ambiguous` even when priorities differ. Knowledge already says exact identifiers must be unique. Leftover activate already refuses that clash. Do not silently pick the higher priority on exact so “alias rules apply everywhere.”

6. **`normalize` is `trim` + lowercase only.** Planned leftover label mappings (ORS-1) want NFKC and collapsed internal whitespace, and they say not to reuse this fold. Do not silently upgrade this `normalize` so “folds match the spec.” A second fold for a collection that is not on disk is a different story.

7. **`stampTheLiveFeed` searches the full company list, including archived rows, then refuses an inactive company.** Leftover sourceRegistry passes **active** lists only. Tests may pass mixed lists. Do not silently stamp an archived company because “the card was in the array.” Do not silently drop the second lookup so “candidates already filtered the company” without a test that a Feed pointing at an archived company is `not_found`.

8. **A company slug that is not also a Feed alias falls through to the channel default.** The test `a company identifier falls through to its default when it is not a granularity alias` is that path (`fallback_alias` equals the company slug, no Feed wears it). Do not silently treat the company slug as a Feed alias so “one string matches both rungs.”

9. **This file never writes the Operational Event knowledge mentions.** Equal-priority leftover aliases return `ambiguous` here; leftover `resolveSourceAttribution` writes `operations_registry.source_resolution_ambiguous`. Do not silently `recordOperationalEvent` from this file so “matching owns the knowledge sentence.” The event **adapter** stays leftover.

10. **Runtime does not read leftover `SOURCE_LABEL_TO_COMPANY`.** The last test rebuilds in-memory cards from that leftover map so old labels still attribute. Do not import the leftover map at runtime so “the fixture is the matcher.” Do not delete the leftover map in this rename.

11. **Leave sibling modules alone.** Leftover `previewSourceResolution`, leftover `resolveSourceAttribution`, leftover `resolveLeadSourceAssignment`, leftover nested-book first-hit, leftover `sourcePolicy.ts`, leftover `SOURCE_LABEL_TO_COMPANY`, leftover `validateCplSchedule`, and leftover `withRegistryMutation` are already the right **depth**. This file is the matching ladder they **ask**.

12. **Do not silently change persisted `match_kind` strings.** `exact` / `default` / `fallback` are already on Lead attribution bags leftover enrichment/recon assert. Story names live on the functions.

## Testing

The **interface** is the test surface: `sayWhichLiveFeedThisHintWouldStamp` (today `previewSourceAttribution`).

Today’s `sourceResolution.test.ts` already names several ladder beats with in-memory cards: exact key (folded), company default, company slug that is not a Feed alias falls through to default, local before default, leftover alias unique highest priority, `allow_company_identifier_fallback` global alias, equal-priority leftover alias ambiguous, inactive exact / inactive default do not resolve, leftover static-label fixtures still attribute a company.

That is the right **interface** style. Keep it. Fill the gaps the story names make obvious. Do **not** replace it with Mongo / Operational Event tests — those belong on leftover `sourceRegistry.ts`.

Add tests that name the operation:

**Company first**
- Empty slug + exact Feed key → stamps that live same-channel Feed (`exact`). Field open is how Owner preview with only a key works.
- Unknown company slug without `allow_company_identifier_fallback` → `not_found` / `company`. Same slug with the leftover Lead flag + a leftover alias → may still stamp `fallback`.
- Two live companies sharing a folded alias → `ambiguous` / `company` with sorted `candidate_ids`.
- Archived company is invisible to `pickTheCompanyFromTheHint` even if it is in the array leftover tests pass.

**Exact / local / leftover alias / default**
- Two live same-channel Feeds with the same folded CRM label or source site → `ambiguous` / `exact`. Differing `priority` does **not** break the tie.
- Typed Feed key that misses, and no leftover alias → `not_found` / `exact`. Typed Feed key that misses **with** a leftover alias continues and may stamp `fallback` or `default` (load-bearing leftover Lead path).
- Hint sends both a Feed key and a disagreeing CRM label → the key wins; the CRM label is not consulted (today’s `firstTypedExactIdentifier`). Do not “fix” this in the same pass.
- Two remaining Feeds with the same `local` → `ambiguous` / `exact`. One remaining Feed with `local` stamps `match_kind: "exact"` (the lying stored value stays until a separate change).
- Leftover alias with one highest-priority winner → `fallback`. Two winners at that priority → `ambiguous` / `fallback` plus `priority`.
- Company with no live channel default → `not_found` / `default`. A default id that points at an archived or other-channel Feed does not resolve.
- Form-channel hint does not stamp a Call Feed. A Feed whose company is archived → `not_found` / `company` even when the Feed row is active.

**What this file does not do**
- The function does not throw on `ambiguous` / `not_found`.
- The function does not write an Operational Event.
- The function does not call leftover `listSourceCompanies` / `listSourceGranularities`.

Do **not** add a test per helper (`firstTypedExactIdentifier`, `keepLiveFeedsOnThisChannel`, `normalize`). Those names exist so the parent reads. If a helper test has to change when the helper is inlined, it was testing past the **interface**.

`sayWhichLiveFeedThisHintWouldStamp` stays exported because leftover Owner preview and leftover fail-closed Lead path are two real **adapters**, not a test leak. Leftover `resolveSourceAttribution` owns the throw + event proof; leftover `resolveLeadSourceAssignment` owns the hint-interpretation proof; leftover `sourceRegistry` activate owns the “exact identifiers unique on activate” proof; do **not** retest those here.

## What I would not do

- A `SourceResolutionService` class with `create` / `update` / `delete`.
- Thirty two-line functions that only wrap leftover `listSourceCompanies` or leftover `recordOperationalEvent`.
- Moving this into a CRUD folder (`create.ts` / `update.ts` / `delete.ts`) for cleanliness.
- Breaking the in-memory / miss-is-data **seam**. Matching must not load Mongo, must not throw, and must not write an Operational Event.
- Treating leftover Owner source writes, leftover Lead hint interpretation, leftover nested-book first-hit, leftover Granot source-label policy, leftover static `SOURCE_LABEL_TO_COMPANY`, leftover CPL periods, leftover Agent/Merchant cards, or Wave B `/source-resolution/preview` HTTP as this story.
- Inventing a **seam** that has only one **adapter**.
- Silently “fixing” a known order gap while recommending a rename: do not fail closed on an exact miss when a leftover alias remains; do not pick exact ties by priority; do not treat every company miss as field-open; do not add `local` / `allow_company_identifier_fallback` to Wave B Zod; do not upgrade `normalize` to NFKC; do not add a stored `"local"` `match_kind`; do not stamp archived companies; do not treat a company slug as a Feed alias; do not import leftover `SOURCE_LABEL_TO_COMPANY` at runtime; do not write Operational Events from this file; do not move leftover Mongo load or leftover throw into this file; do not start a leftover label-mapping collection (ORS-1); do not merge leftover nested-book first-hit into this ladder.
- Jumping to the next service while this one has unchecked modules.
- Writing a whole-folder recommendation for `operationsRegistry`.
