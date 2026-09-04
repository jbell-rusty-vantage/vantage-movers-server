# Hang The Exact Granot Spelling — Translate Owner Words Into The Sibling Policy Write — Leave The New Name Off And Texts Unset — Choosing Create-If-Missing Does Not Turn Texting On — Derive The Lead Source From The Feed — Refuse A Folded-Name Or Workspace-Slug Collision — Never Correct An Existing Name — Never Resolve A Live Observation — Never Send A Text — operational story

- Status: recommended
- Service: `operationsRegistry` (Wave A, in-progress)
- Pass: 20 of this service — `ownerGranotNames.ts`
- Remaining in this service: `leadSourceSetup.ts`, `queries/leadSourceProjection.ts`
- Target: `src/services/operationsRegistry/ownerGranotNames.ts`
- Knowledge: [`docs/knowledge/services/operations-registry.md`](../../../docs/knowledge/services/operations-registry.md) (Owner create translation for `POST /api/v1/admin/granot-crm-sources`; `OwnerGranotNameCommand`; `when_lead_arrives` may be `create_if_missing`; Best Relocation may use that policy on Forms and Inbounds; mapped inbound families stay `link_only` unless a later Owner command says otherwise; derives `crm_origin`, `workspace_slug`, and the Lead Source from the Feed; clients cannot submit `normalized_granot_label`; new rows are inactive (`enabled` / `lifecycle_enabled` false); SMS is not written on create; `validateGranotCrmSourceSemantics` wins if translation disagrees). Software rule: [`.cursor/rules/operations-registry.mdc`](../../../.cursor/rules/operations-registry.mdc) (Owner Granot create is this file; atomic setup is next `leadSourceSetup.ts`; aggregate Owner reads are next `queries/leadSourceProjection.ts`; runtime policy reads stay in `granotLifecycle/sourcePolicy.ts`). Already-recommended sibling write: [recommendations/operations-registry-granot-crm-sources.md](operations-registry-granot-crm-sources.md) (`createOrUpdateGranotCrmSource` / `persistGranotCrmSourceInSession` — this file translates then **asks**; it does **not** stamp the Registry Change itself; sibling defaults `enabled: true` when omitted, so this hang **must** send `enabled: false`). Already-recommended SMS: [recommendations/operations-registry-crm-source-outbound-sms.md](operations-registry-crm-source-outbound-sms.md) (a later Owner command; `create_if_missing` does **not** send texts). Already-recommended stamp: [recommendations/operations-registry-registry-audit.md](operations-registry-registry-audit.md) (sibling **asks** `withRegistryMutation`; setup **asks** `withMultiEntityRegistryMutation` after this file **assembles**). Already-recommended who-may-speak: [recommendations/operations-registry-trusted-actor.md](operations-registry-trusted-actor.md) (Wave B `requireRegistryOwnerActor` **asks** that file **before** this one; this file still checks `actorRole !== "owner"`). Label fold: `granotLifecycle/sourceLabel.ts` (`normalizeGranotSourceLabel`). Already-recommended runtime resolve: [recommendations/granot-lifecycle-source-policy.md](granot-lifecycle-source-policy.md) (does **not** import this file). Already-recommended mint: [recommendations/granot-lifecycle-create-lead-from-granot.md](granot-lifecycle-create-lead-from-granot.md) (a later authorized create; this hang does **not** mint). Skipped Owner-language leak check: `ownerLanguageDeck.ts`. Wave B Zod: `src/validation/v1/admin.validation.ts` (`ownerGranotNameCreateSchema`). Next setup Zod: `src/validation/v1/leadSourceSetup.validation.ts`. Semantics **adapter**: `models/granotCrmSourceSemantics.ts`. This checkout’s `CONTEXT.md` defines [Granot CRM Source](../../../CONTEXT.md) — link it; do not invent a “Granot name” glossary copy. `docs/adr/` is absent here — do not invent an ADR copy. Do not add this path to knowledge in this rename.
- Callers: Wave B `src/routes/v1.routes.ts` (`handleGranotCrmSourceCreate` — `POST /api/v1/admin/granot-crm-sources`, Owner; `ownerGranotNameCreateSchema.parse` then `createGranotNameFromOwnerIntent`; GET / PATCH / `/activation` / `/outbound-sms` **do not** import this file). Next `leadSourceSetup.ts` (**asks** `assembleOwnerGranotCreateForKnownFeed` then sibling `persistGranotCrmSourceInSession`; preview **asks** `assertGranotNameAvailable`). Barrel: `operationsRegistry/index.ts` (create / translate / slug / assemble / assert; `toOwnerCreateResult` is **not** barrelled). Tests: `ownerGranotNames.test.ts` (translation table, one-Feed Form/Call hang, inactive Feed draft, Lead Source mismatch, watch-only destination refuse, duplicate-before-write, short reason, `form_by_move_type` shape, referral / watch-only translation, Admin `FORBIDDEN`). Next setup tests **ask** assemble + assert. Already-recommended sibling PATCH / classification apply / Paid Overflow **ask** `createOrUpdateGranotCrmSource` **directly** — they are **not** this hang. `sourcePolicy.ts` / mint / SMS **do not import this file**.
- Seams callers need: hang-from-Owner-intent (`createGranotNameFromOwnerIntent`: Wave B POST; Owner + sibling write) vs assemble-for-a-known-Feed (`assembleOwnerGranotCreateForKnownFeed`: next setup persist **asks** this, then sibling `persistGranotCrmSourceInSession` so the company + Feed + name share one multi-entity stamp) vs say-whether-the-spelling-is-still-free (`assertGranotNameAvailable`: next setup preview). There is no correct-an-existing-name **seam**. There is no SMS **seam**. There is no activation **seam**. There is no observation-resolve **seam**. There is no mint **seam**.
- Split later (only if the file outgrows one sitting): this ~496-line file is one sitting if you read it as hang the exact Granot spelling — translate Owner words into the sibling policy write — leave the new name off and texts unset — choosing create-if-missing does not turn texting on — derive the Lead Source from the Feed — refuse a folded-name or workspace-slug collision — never correct an existing name — never resolve a live observation — never send a text. Do **not** split hang vs assemble into two public modules POST and setup could import independently so “setup owns a second Granot write.” If it later splits: `hangThisGranotSpellingFromOwnerIntent.ts` / `assembleThisGranotSpellingForAKnownFeed.ts` only as later story files, never `create.ts` / `update.ts` / `delete.ts` / `assert.ts`, and never merge already-recommended sibling write, SMS, stamp, next setup orchestration, next Lead Source projection, who-may-speak, Wave B Zod, semantics **adapter**, label fold, runtime `sourcePolicy`, mint, or Wave B HTTP into this file

`createGranotNameFromOwnerIntent` / `assembleOwnerGranotCreateForKnownFeed` / `assertGranotNameAvailable` are executor mechanics. The owner question is: *A Granot CRM Source is the exact spelling Granot uses plus arrival policy. The Owner hangs that spelling. They say whether it is our Lead Source, a Referral Booking, or watch-only. They say whether a matching observation is only watched, only linked to an existing Lead, or may create the Lead if we do not have it. They point the name at one Feed, or at local and long-distance Form Feeds, or at no Feed. The server folds the spelling. The Owner cannot submit the folded key. The Lead Source comes from the Feed; a submitted Lead Source that disagrees is refused. The new name stays switched off and unused in live processing. Texts stay unset. Choosing create-if-missing does not turn texting on. Two names may not share a folded spelling or a derived workspace slug. This page does not correct an existing name. This page does not resolve a live observation. This page does not send a text. This page does not invent a second Granot write — it translates, then asks the already-recommended sibling.*

Already-recommended sibling write, SMS, stamp, who-may-speak, label fold, semantics **adapter**, runtime `sourcePolicy`, mint, next setup, next Lead Source projection, Wave B Zod, and Wave B HTTP already live in other **modules**. Do not pull those in.

## What this file actually does

Three operations of one “hang the exact Granot spelling — translate Owner words into the sibling policy write — leave the new name off and texts unset — choosing create-if-missing does not turn texting on — derive the Lead Source from the Feed — refuse a folded-name or workspace-slug collision — never correct an existing name — never resolve a live observation — never send a text” story, not “a Granot-name CRUD helper,” and not sibling PATCH:

1. **Hang this Granot spelling from Owner intent** — `createGranotNameFromOwnerIntent`. `actorRole !== "owner"` → `FORBIDDEN`. Fold through `normalizeGranotSourceLabel`; empty / control / bidi → 400 (`name_received_from_granot must normalize to a nonempty control/bidi-safe label.`). Clients cannot submit `normalized_granot_label`. Duplicate `{ normalized_granot_label }` → `DUPLICATE_IDENTIFIER` (`open_granot_names`). Reason trimmed 10–1000. Watch-only cannot have a destination and requires `when_lead_arrives: "watch_only"`. Translate `handling` → disposition (`our_lead_source` → `source_scoped_lead`, `referral_booking` stays, `watch_only` → `deferred`). Translate `when_lead_arrives` → policy (`watch_only` → `observation_only`, `existing_only` → `link_only`, `create_if_missing` stays). One Feed: load the Feed, derive `lead_model` from channel, one `route_key: "any"` / `move_type: "any"`. `form_by_move_type`: two different Form Feeds, local then long-distance, `lead_model: "FormLead"`. Feeds on different Lead Sources → 400 naming both ids. Submitted `lead_source_id` that disagrees with the Feed → 400 naming both sides. **Ask** `validateGranotCrmSourceSemantics` **before** the sibling write; fail → 400 with `assembled.message` (`create_if_missing` is legal only on `source_scoped_lead`; `referral_booking` / `deferred` require `observation_only` and forbid Lead routes; `source_scoped_lead` requires a company and routes). Derive `workspace_slug` from the folded name (`[a-z0-9]+` hyphenated; empty slug → 400). `{ crm_origin: GRANOT_CRM_DEFAULT_ORIGIN, workspace_slug }` collision → `DUPLICATE_IDENTIFIER` (do not suffix; choose a different exact spelling). **Ask** sibling `createOrUpdateGranotCrmSource` with `enabled: false`, `lifecycle_enabled: false`, `source_company: "not_provided"`, `lifecycle_policy_version: ""`, `lead_source_company` from the Feed (or `null`), and **no** `outbound_sms`. Return `toOwnerCreateResult` (strip the CSV `source_company` field; gates name switched-off / unused-in-live-processing / texts-off / `when_a_lead_arrives` / `choosing_create_if_missing_does_not_make_texting_live: true`). This beat does **not** take an `id`. This beat does **not** write SMS. This beat does **not** switch `lifecycle_enabled`. An inactive Feed on an inactive Lead Source is a legal draft.

2. **Assemble this Granot spelling for a known Feed** — `assembleOwnerGranotCreateForKnownFeed`. Next setup **asks** this after the company and Feed exist in the same transaction. Always translates `handling: "our_lead_source"`. Always pins `assembleOneFeedRoutes`. **Asks** semantics the same way. Returns `{ command, normalized, workspace_slug }`. Does **not** write. Next setup then **asks** sibling `persistGranotCrmSourceInSession` and refuses if `enabled` / `lifecycle_enabled` / `outbound_sms.enabled` came back on. This beat does **not** hang referral or watch-only. This beat does **not** open `form_by_move_type`.

3. **Say whether this Granot spelling is still free** — `assertGranotNameAvailable`. Same fold, duplicate `normalized_granot_label`, derived slug collision. Optional `ClientSession` so next setup preview sees in-transaction names. Returns `{ normalized, workspace_slug }`. Does **not** write. Does **not** translate handling.

There is no fourth correct-an-existing-name operation. There is no SMS operation. There is no activation operation. `translateOwnerHandling` / `translateOwnerArrivalPolicy` / `workspaceSlugFromNormalizedLabel` / `assembleOneFeedRoutes` / `toOwnerCreateResult` sit on the hang and assemble paths. They are not extra owner operations. Do not export `loadDestinationFeed` / `resolveLeadSourceId` / `invalid` as a public **seam**.

Do not export `assembleOwnerGranotCreateForKnownFeed` as a second public **seam** Wave B POST should skip so “Owner create never pins one Feed.” Do not export `assertGranotNameAvailable` as domain language for “the hang already checked.” Do not export `toOwnerCreateResult` as domain language for “the name is live.”

## Organization

Keep one file as the screenplay for “hang the exact Granot spelling, translate Owner words into the sibling policy write, leave the new name off and texts unset, choosing create-if-missing does not turn texting on, derive the Lead Source from the Feed, refuse a folded-name or workspace-slug collision, never correct an existing name, never resolve a live observation, never send a text.” Already-recommended sibling write, SMS, stamp, who-may-speak, label fold, semantics **adapter**, runtime `sourcePolicy`, mint, next setup, next Lead Source projection, Wave B Zod, `connectMongo`, and Wave B HTTP already live in deeper **modules**. Do not pull those in. Do not invent an `OwnerGranotNameService` class. Do not invent a begin / complete **seam** — sibling `withRegistryMutation` is already the before-commit / after-commit **adapter** on the POST path, and next setup `withMultiEntityRegistryMutation` is already that **adapter** on the assemble path.

Do not split this into `create.ts` / `update.ts` / `delete.ts` / `assert.ts`. Those are persistence verbs, not the owner story. Do not move `createOrUpdateGranotCrmSource` into this file so “one file owns Granot names.” Do not move `setGranotCrmSourceOutboundSms` into this file so “create-if-missing owns texting.” Do not silently start resolving observations here so “the hang stays hot.”

**External interface** stays small (this is the test surface). Hang, assemble-for-setup, and say-whether-free are one story’s book, not three CRUD verbs:

| Keep exporting | Story name | Why the seam exists |
|---|---|---|
| `createGranotNameFromOwnerIntent` | `hangThisGranotSpellingFromOwnerIntent` | Wave B POST |
| `assembleOwnerGranotCreateForKnownFeed` | `assembleThisGranotSpellingForAKnownFeed` | next setup persist **asks** this, then sibling `persistGranotCrmSourceInSession` |
| `assertGranotNameAvailable` | `sayWhetherThisGranotSpellingIsStillFree` | next setup preview collisions |
| `toOwnerCreateResult` | `showTheOwnerTheGatesAfterHang` | POST `{ ok, data }` gates |
| `translateOwnerHandling` | `translateOwnerHandlingIntoDisposition` | barrel + tests; hang **asks** this |
| `translateOwnerArrivalPolicy` | `translateOwnerArrivalIntoPolicy` | barrel + tests; hang **asks** this |
| `workspaceSlugFromNormalizedLabel` | `deriveTheWorkspaceSlugFromTheFoldedName` | hang + assert + assemble |
| `assembleOneFeedRoutes` | `pinThisNameToOneFeed` | assemble **asks** this; hang inlines the same `any` route today |
| `OwnerGranotNameCommand` / `OwnerGranotNameCreateResult` / `OwnerGranotNameGateState` | `HangThisGranotSpelling` / `HungGranotNameWithGates` / `TheseGatesAreStillOff` | Wave B Zod body, Owner card, gate bag |

Keep the old names as one-line aliases until Wave B `v1.routes.ts`, the barrel, next `leadSourceSetup.ts`, `ownerGranotNames.test.ts`, and next `leadSourceSetup.test.ts` migrate. Do not make callers learn `InTransaction` / `toOwnerCreateResult` / `assembleOneFeedRoutes` as the domain language.

**Principle: old exports stay as aliases.** `createGranotNameFromOwnerIntent` remains the imported name until Wave B POST migrates. `assembleOwnerGranotCreateForKnownFeed` remains the imported name until next setup migrates. Persisted disposition / policy strings (`source_scoped_lead` / `referral_booking` / `deferred`, `observation_only` / `link_only` / `create_if_missing`), Change `action` `"create"`, `entity_type` `granot_crm_source`, CSV `source_company: "not_provided"`, stored `lead_source_company`, `route_key` `"any"` / `"form_local"` / `"form_long"`, and Owner `handling` / `when_lead_arrives` Zod enums stay those strings — they are stamp history, sibling semantics, Wave B body, and runtime `sourcePolicy` unions, not story names.

**No class for the workflow.** The types that *do* earn names are the hang bag Wave B Zod already parses and the gate bag POST already returns:

```ts
type HangThisGranotSpelling = {
  name_received_from_granot: string
  handling: "our_lead_source" | "referral_booking" | "watch_only"
  lead_source_id?: string
  destination:
    | { kind: "one_feed"; feed_id: string }
    | { kind: "form_by_move_type"; local_feed_id: string; long_distance_feed_id: string }
    | null
  when_lead_arrives: "watch_only" | "existing_only" | "create_if_missing"
  reason: string
  // normalized_granot_label must not be submitted
}

type TheseGatesAreStillOff = {
  this_name_is_switched_on: boolean
  this_name_is_used_in_live_processing: boolean
  customer_text_is_on: boolean
  when_a_lead_arrives: "observation_only" | "link_only" | "create_if_missing"
  choosing_create_if_missing_does_not_make_texting_live: true
}

type HungGranotNameWithGates = Omit<GranotCrmSourceRecord, "source_company"> & {
  gates: TheseGatesAreStillOff
}
```

That is the handoff from “the Owner hung a spelling” / “next setup assembled a known-Feed command” to “Owner POST returns `{ ok, data }` gates” or “next setup persists sibling `persistGranotCrmSourceInSession`.” Do **not** add `id` onto `HangThisGranotSpelling` so “one command corrects.” Do **not** add `outbound_sms` onto `HangThisGranotSpelling` so “create-if-missing owns texting.” Do **not** add `lifecycle_enabled: true` onto assemble so “setup turns the name on.” Do **not** store `normalized_granot_label` from the client.

Do not add `requireRegistryOwnerActor` as a public **seam** on this file — Wave B already owns who may speak. Do not add `withRegistryMutation` as a public **seam** — already-recommended stamp already owns the POST write. Do not add `persistGranotCrmSourceInSession` as a public **seam** — already-recommended sibling already owns that setup **adapter**. Do not add `setGranotCrmSourceOutboundSms` as a public **seam** — already-recommended SMS already owns that. Do not add `resolveSourcePolicy` as a public **seam** — runtime `sourcePolicy` already owns that.

## The file, as a story

Parent functions stay deep. Child names are only extracted when they hide a real decision, not a one-liner.

```ts
// ownerGranotNames.ts
// A Granot CRM Source is the exact spelling Granot uses plus arrival policy.
// The Owner hangs that spelling.
// They say whether it is our Lead Source, a Referral Booking, or watch-only.
// They say whether a matching observation is only watched, only linked,
// or may create the Lead if we do not have it.
// They point the name at one Feed, or at local and long-distance Form Feeds,
// or at no Feed.
// The server folds the spelling. The Owner cannot submit the folded key.
// The Lead Source comes from the Feed.
// The new name stays switched off. Texts stay unset.
// Choosing create-if-missing does not turn texting on.
// Two names may not share a folded spelling or a derived workspace slug.
// Do not correct an existing name.
// Do not resolve a live observation.
// Do not send a text.
// Do not invent a second Granot write — translate, then ask the sibling.

// ── 1. Hang this Granot spelling from Owner intent ───────

export async function hangThisGranotSpellingFromOwnerIntent(command, actor, deps)
  // Owner only
  // fold through normalizeGranotSourceLabel
  // refuse duplicate normalized_granot_label
  // reason 10–1000
  // watch_only → no destination, when_lead_arrives watch_only
  // translate handling / arrival
  // one_feed → load Feed → derive lead_model + Lead Source
  // form_by_move_type → two Form Feeds, local / long-distance
  // ask validateGranotCrmSourceSemantics — semantics wins
  // refuse workspace_slug collision (do not suffix)
  // ask createOrUpdateGranotCrmSource enabled: false lifecycle_enabled: false no SMS
  // return showTheOwnerTheGatesAfterHang

// ── 2. Assemble this Granot spelling for a known Feed ──

export function assembleThisGranotSpellingForAKnownFeed(input)
  // always our_lead_source
  // always pinThisNameToOneFeed
  // ask semantics
  // do not write

// ── 3. Say whether this Granot spelling is still free ──

export async function sayWhetherThisGranotSpellingIsStillFree(name, session?)
  // fold
  // duplicate normalized_granot_label
  // derived workspace_slug collision
  // do not write
```

Read the primary path out loud: *The Owner hangs “Synthetic TBM Forms Prime” as our Lead Source on the live Forms Feed and says a matching observation may create the Lead if we do not have it. The server folds the spelling. The Lead Source comes from that Feed. Semantics must agree. The derived workspace slug must be free. The sibling write stamps the name switched off, unused in live processing, CSV `source_company: "not_provided"`, and texts unset. The Owner card names `choosing_create_if_missing_does_not_make_texting_live`. A later Owner SMS command may turn texts on. A later `/activation` may turn live processing on. This page does neither. Next setup asks assemble, then sibling persist, in the same company + Feed transaction. Do not correct an existing name. Do not resolve a live observation. Do not send a text.*

That is the operation. `createGranotNameFromOwnerIntent` is not.

## Precise logic I would tighten while renaming

These are real smells the story names make obvious. Do not “just rename.”

1. **Hang duplicates `assertGranotNameAvailable` instead of asking it.** Duplicate `normalized_granot_label` and slug collision are copied almost verbatim (hang has no `session`). Next setup preview **asks** assert; hang reimplements it, then **asks** sibling, which checks `normalized_granot_label` again inside the transaction. Do not silently delete hang’s `findOne` so “sibling is enough” without a paired hang + sibling test naming both beats. Do not silently make hang **ask** assert and drop the slug check so “one function owns free” without locking the `open_granot_names` remediation ids.

2. **Hang inlines the one-Feed route that `assembleOneFeedRoutes` already builds.** `assembleOwnerGranotCreateForKnownFeed` **asks** `assembleOneFeedRoutes`. Hang’s `one_feed` branch copies `{ route_key: "any", lead_model, move_type: "any", source_granularity_id }`. Do not silently make hang **ask** assemble so “one assembler owns POST” without a paired test that Owner POST still accepts `form_by_move_type` and watch-only. Assemble always forces `our_lead_source`; POST does not.

3. **Sibling defaults `enabled: true` when omitted.** Already-recommended `intendedSemantics` / `buildUpdate` use `command.enabled ?? booleanValue(before?.enabled, true)`. This hang **must** send `enabled: false`. Do not silently drop that field so “sibling defaults match unreviewed cards” — knowledge says new Owner creates stay inactive. Do not silently change sibling’s default in this rename.

4. **`choosing_create_if_missing_does_not_make_texting_live` is a constant `true`.** The gate is documentation on the card, not a computed check of `outbound_sms`. Hang never writes `outbound_sms`, so `customer_text_is_on` is always false on a fresh create. Do not silently **ask** `setGranotCrmSourceOutboundSms` when `when_lead_arrives === "create_if_missing"` so “Best Relocation texts on hang.” Do not silently drop the constant so “gates only report stored flags.”

5. **An inactive Feed on an inactive Lead Source is a legal draft.** Hang loads the Feed and company; it checks they exist and belong together; it does **not** require `active === true`. Sibling semantics later refuse lifecycle-on until the company and Feeds are active. Do not silently refuse hang when `feed.active !== true` so “write matches later activation” without a paired hang + `/activation` test. Do not silently skip the company-exists check so “Feed id is enough.”

6. **Hang’s duplicate checks run outside the sibling transaction.** Race: two POSTs can both miss `findOne`, then sibling’s in-transaction unique check wins for one. Do not silently move hang’s `findOne`s inside `withRegistryMutation` in this rename — that **seam** belongs to sibling. Do not silently drop hang’s pre-check so “only sibling 409s.”

7. **Assemble cannot hang referral or watch-only.** Next setup’s optional Granot name is always `our_lead_source` on one Feed. Do not silently add `handling` onto assemble so “setup owns every Owner word” without a paired setup test. Do not silently make POST **ask** assemble for `one_feed` and leave `form_by_move_type` as a second write path.

8. **Owner POST returns this file’s card; sibling PATCH re-reads projection.** Wave B create returns `toOwnerCreateResult`. Wave B PATCH **asks** `createOrUpdateGranotCrmSource` then `getProjectedGranotCrmSource`. Do not silently make POST re-read projection so “create matches PATCH” without a paired gate-field test — projection does not attach `gates`. Do not silently attach `gates` onto sibling list/get.

9. **CSV `source_company: "not_provided"` is not the Lead Source.** Hang always sends that string. The real company id is `lead_source_company` from the Feed. `toOwnerCreateResult` strips `source_company` from the Owner card. Do not silently write the Feed’s company slug into `source_company` so “the CSV field is the Lead Source.” Do not silently keep `source_company` on the Owner card so “the DTO matches the sibling record.”

10. **There is no correct-an-existing-name export.** Hang never sends `id`. Sibling PATCH is already-recommended. Do not silently add `id?` onto `OwnerGranotNameCommand` so “one command creates or corrects.” Knowledge already says this module is create translation.

11. **Translation tables are the Owner-language deck, not runtime policy.** `handling` / `when_lead_arrives` are Owner words. Disposition / policy are sibling + `sourcePolicy` strings. Skipped `ownerLanguageDeck.ts` bans `lifecycle`, `disposition`, `route_key`, `lead_model` on Owner-facing copy. Do not silently return disposition names on `gates` so “the card speaks Registry.” Do not silently persist `handling` as a new field.

12. **Leave sibling modules alone.** Already-recommended `createOrUpdateGranotCrmSource`, `persistGranotCrmSourceInSession`, `setGranotCrmSourceOutboundSms`, `withRegistryMutation`, `requireRegistryOwnerActor`, `normalizeGranotSourceLabel`, `validateGranotCrmSourceSemantics`, `resolveSourcePolicy`, `createLeadFromGranot`, Wave B `ownerGranotNameCreateSchema`, and next `previewLeadSourceSetup` / `getLeadSourceProjection` are already the right **depth**. This file hangs, assembles, and says whether the spelling is free; it does not stamp, text, activate, resolve, or mint.

13. **Do not silently change persisted disposition / policy / `route_key` / Change `action` strings.** Those are stamp history, sibling semantics, Wave B Zod enums, and runtime `sourcePolicy` unions. Story names live on the functions.

## Testing

The **interface** is the test surface: `hangThisGranotSpellingFromOwnerIntent`, `assembleThisGranotSpellingForAKnownFeed`, `sayWhetherThisGranotSpellingIsStillFree` (today `createGranotNameFromOwnerIntent` / `assembleOwnerGranotCreateForKnownFeed` / `assertGranotNameAvailable`). `toOwnerCreateResult` stays exported because Wave B POST is a second real **adapter**, not a test leak. Do not make `loadDestinationFeed` / `resolveLeadSourceId` / `invalid` the named surface.

Today `ownerGranotNames.test.ts` covers the translation table, one-Feed Form/Call hang, inactive Feed draft, Lead Source mismatch, watch-only destination refuse, duplicate-before-write, short reason, `form_by_move_type` shape, referral / watch-only translation, and Admin `FORBIDDEN`. Next setup tests **ask** assemble + assert. Keep both files’ **asks** of this interface. Name the operation:

**Hang this Granot spelling from Owner intent**
- Admin actor → `REGISTRY_FORBIDDEN`.
- Empty / control / bidi name → 400 nonempty control/bidi-safe label.
- Reason shorter than 10 or longer than 1000 → 400.
- Duplicate folded name → `DUPLICATE_IDENTIFIER`, `create` is never called, remediation `open_granot_names`.
- Workspace-slug collision → `DUPLICATE_IDENTIFIER`, do not suffix.
- Watch-only + non-null destination → 400. Watch-only + `when_lead_arrives !== "watch_only"` → 400.
- One Form Feed + `create_if_missing` → `enabled: false`, `lifecycle_enabled: false`, `lead_created_policy: "create_if_missing"`, `lifecycle_disposition: "source_scoped_lead"`, one `any` / `FormLead` route, `source_company: "not_provided"` on the sibling write, `"source_company" in result === false`, `gates.customer_text_is_on === false`, `gates.choosing_create_if_missing_does_not_make_texting_live === true`.
- One Call Feed → `lead_model: "CallLead"`.
- Inactive Feed on inactive Lead Source → hang succeeds as a draft.
- Submitted `lead_source_id` that disagrees with the Feed → 400 naming both ids.
- `form_by_move_type` same Feed twice / two Call Feeds / two local Feeds / different Lead Sources → 400.
- `form_by_move_type` local + long-distance Form Feeds → two `FormLead` routes keyed by move type.
- `referral_booking` + null destination + `watch_only` arrival → `referral_booking` + `observation_only`.
- Sibling **ask** stamps `entityType: "granot_crm_source"` / `action: "create"` / the Owner reason.
- Do not add a `requireRegistryOwnerActor` 403 test here. Wave B + who-may-speak already own that **adapter**.

**Assemble this Granot spelling for a known Feed**
- Always `lifecycle_disposition: "source_scoped_lead"`.
- Always one `any` route from the Feed channel.
- Semantics fail (`create_if_missing` on a non-source-scoped translation) → 400 before a write.
- Does **not** call `Source.create`.
- Next setup tests already lock inactive + texts unset after persist — do not retest `withMultiEntityRegistryMutation` here.

**Say whether this Granot spelling is still free**
- Free name → `{ normalized, workspace_slug }`.
- Duplicate folded name → `DUPLICATE_IDENTIFIER` with the held id.
- Slug collision → `DUPLICATE_IDENTIFIER`, message says do not suffix.
- Optional session is forwarded onto both `findOne`s.
- Do not retest sibling rollback here. Already-recommended stamp already owns that **adapter**.
- Do not retest `registry.granot_*` health codes here. Already-recommended health already owns that **adapter**.
- Do not retest `resolveSourcePolicy` here. Already-recommended runtime resolve already owns that **adapter**.

Do **not** add a test per helper (`leadModelFromFeedChannel`, `resolveLeadSourceId`, `workspaceSlugFromNormalizedLabel` beyond the table already locked). Those names exist so the parent reads. If a helper test has to change when the helper is inlined, it was testing past the **interface**.

Do **not** retest sibling PATCH, SMS enable gates, `/activation` active-company rules, mint `createLeadFromGranot`, Wave B route mounts, next setup readiness rows, or next Lead Source projection accepted-label lists here. Those already have (or will have) their own interface tests. Wave B **asks** hang. Next setup **asks** assemble + assert. Prove the book, not the finding.

## What I would not do

- An `OwnerGranotNameService` class with `create` / `update` / `delete`.
- Thirty two-line functions that only wrap `Source.findOne` / `createOrUpdateGranotCrmSource`.
- Moving this into a CRUD folder (`create.ts` / `update.ts` / `delete.ts` / `assert.ts`) for cleanliness.
- Breaking the translate-then-sibling-write **seam**. A public `persistGranotCrmSourceInSession` this file would call without going through sibling / next setup is the forbidden split. Returning `outbound_sms` from hang is the same break. Sending `id` so hang corrects is the same break. Omitting `enabled: false` so sibling defaults the name on is the same break.
- Treating sibling PATCH, SMS, stamp, who-may-speak, label fold, semantics **adapter**, runtime `sourcePolicy`, mint, next setup, next Lead Source projection, Wave B Zod, Wave B HTTP, or `EntityChange` as this story.
- Inventing a **seam** that has only one **adapter**.
- Silently "fixing" a known gap while recommending a rename: do not delete hang’s pre-check `findOne`s without a paired hang + sibling test; do not make hang **ask** assemble for every destination without a paired `form_by_move_type` / watch-only test; do not change sibling’s `enabled` default; do not **ask** SMS from hang when `create_if_missing`; do not drop `choosing_create_if_missing_does_not_make_texting_live`; do not refuse inactive Feeds without a paired hang + `/activation` test; do not move hang’s `findOne`s inside `withRegistryMutation`; do not add `handling` onto assemble; do not make POST re-read projection; do not write the Feed company into CSV `source_company`; do not add `id?` onto the hang bag; do not persist `handling`; do not move `createOrUpdateGranotCrmSource` / `setGranotCrmSourceOutboundSms` / `requireRegistryOwnerActor` / `normalizeGranotSourceLabel` into this file; do not rename persisted disposition / policy / `route_key` / Change `action` / `source_company` / `lead_source_company` strings.
- Jumping to the next service while this one has unchecked modules.
- Writing a whole-folder recommendation for `operationsRegistry`.
