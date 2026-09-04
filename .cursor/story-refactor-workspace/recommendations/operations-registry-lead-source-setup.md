# Open A Draft Lead Source As One Sitting — Derive The Company Slug And Feed Key — Collect Every Collision Without Writing — Persist The Inactive Company, Inactive Feed, And Optional Inactive Granot Name In One Multi-Entity Stamp — Leave Cost, Activation, Live Processing, And Texts For Later Gates — Never Activate — Never Price The Lead — Never Send A Text — Never Hang Referral Or Watch-Only — Never Correct An Existing Card — operational story

- Status: recommended
- Service: `operationsRegistry` (Wave A, in-progress)
- Pass: 21 of this service — `leadSourceSetup.ts`
- Remaining in this service: `queries/leadSourceProjection.ts`
- Target: `src/services/operationsRegistry/leadSourceSetup.ts`
- Knowledge: [`docs/knowledge/services/operations-registry.md`](../../../docs/knowledge/services/operations-registry.md) (atomic Owner setup for `POST /api/v1/admin/operations-registry/lead-source-setups` and `/preview`; one transaction: inactive Source Company + Source Granularity + optional Granot name; returns a readiness plan; optional Granot name is created inactive with texting unset). Software rule: [`.cursor/rules/operations-registry.mdc`](../../../.cursor/rules/operations-registry.mdc) (already-recommended leftover hang is leftover `ownerGranotNames.ts`; this file is atomic setup; aggregate Owner reads are next `queries/leadSourceProjection.ts`; runtime policy reads stay in `granotLifecycle/sourcePolicy.ts`). Already-recommended leftover company / Feed persist: [recommendations/operations-registry-source-registry.md](operations-registry-source-registry.md) (`persistNewSourceCompanyInSession` / `persistNewSourceGranularityInSession` / `deriveRegistryKey` / `assertExactIdentifiersAvailable` — this file **asks**; leftover `createOrUpdateSourceCompany` / leftover `setSourceCompanyActivation` are **not** this sitting). Already-recommended leftover hang: [recommendations/operations-registry-owner-granot-names.md](operations-registry-owner-granot-names.md) (preview **asks** `assertGranotNameAvailable`; save **asks** `assembleOwnerGranotCreateForKnownFeed`, then leftover `persistGranotCrmSourceInSession`; assemble always translates `our_lead_source` on one Feed). Already-recommended leftover Granot write: [recommendations/operations-registry-granot-crm-sources.md](operations-registry-granot-crm-sources.md) (`persistGranotCrmSourceInSession` is the in-session persist; leftover `createOrUpdateGranotCrmSource` owns leftover PATCH). Already-recommended leftover SMS: [recommendations/operations-registry-crm-source-outbound-sms.md](operations-registry-crm-source-outbound-sms.md) (a later Owner command; `create_if_missing` does **not** send texts). Already-recommended leftover stamp: [recommendations/operations-registry-registry-audit.md](operations-registry-registry-audit.md) (leftover `withRegistryMutation` stamps one card; this sitting **asks** leftover `withMultiEntityRegistryMutation` so company + Feed + optional name share one commit). Already-recommended leftover who-may-speak: [recommendations/operations-registry-trusted-actor.md](operations-registry-trusted-actor.md) (Wave B preview **asks** leftover `requireRegistryReadActor`; Wave B save **asks** leftover `requireRegistryOwnerActor`; this file still checks `actorRole !== "owner"` on save only). Already-recommended leftover CPL: [recommendations/operations-registry-cpl-schedule.md](operations-registry-cpl-schedule.md) (readiness names leftover `open_cpl`; this file does **not** write a period). Skipped Owner-language leak check: `ownerLanguageDeck.ts` (Owner-facing strings say Lead source and Feed). Wave B Zod: `src/validation/v1/leadSourceSetup.validation.ts` (`leadSourceSetupCommandSchema` — clients cannot submit `company_slug` / `granularity_key` / `normalized_granot_label`). Next leftover projection: `queries/leadSourceProjection.ts` (**asks** leftover `buildReadinessPlan`, then maps English gates to Owner actions). This checkout’s `CONTEXT.md` does not define Source Company / Source Granularity / Lead Source Setup — do not invent a glossary copy. `docs/adr/` is absent here — do not invent an ADR copy. Do not add this path to knowledge in this rename.
- Callers: Wave B `src/routes/v1.routes.ts` (`handleLeadSourceSetupPreview` — `POST /api/v1/admin/operations-registry/lead-source-setups/preview`, signed read actor, `leadSourceSetupCommandSchema.parse` then `previewLeadSourceSetup`; `handleLeadSourceSetupCreate` — `POST /api/v1/admin/operations-registry/lead-source-setups`, signed Owner, same schema then `createLeadSourceSetup`, `201`). Leftover next `queries/leadSourceProjection.ts` (**asks** `buildReadinessPlan` only). Barrel: `operationsRegistry/index.ts` (preview / create / validate / derive / build plan). Tests: `leadSourceSetup.test.ts` (Paid Overflow-shaped keys, inactive company + Feed + Granot + readiness rows, skippable Granot, every collision writes nothing, mid-transaction Feed failure leaves none of the three, Paid Overflow leftover feed is left alone, preview writes nothing). Wave B Zod tests: `src/routes/lead-source-setups.routes.test.ts` (unknown derived keys refused). Leftover hang tests **ask** assemble + assert, not this file. Leftover `createOrUpdateSourceCompany` / leftover `createGranotNameFromOwnerIntent` / leftover `setGranotCrmSourceOutboundSms` **do not import this file**.
- Seams callers need: show-whether-this-draft-is-still-free (`previewLeadSourceSetup`: Wave B preview; write nothing) vs open-this-draft-as-one-sitting (`createLeadSourceSetup`: Wave B save; Owner + leftover multi-entity stamp) vs list-the-gates-that-still-keep-this-draft-off (`buildReadinessPlan`: this card and next leftover projection). Optional Granot is one story’s fork (omit → suggested leftover hang later; include → assemble then leftover persist), not a second public **seam**. There is no activate **seam**. There is no price-the-lead **seam**. There is no SMS **seam**. There is no correct-an-existing-card **seam**.
- Split later (only if the file outgrows one sitting): this ~528-line file is one sitting if you read it as open a draft Lead Source as one sitting — derive the company slug and Feed key — collect every collision without writing — persist the inactive company, inactive Feed, and optional inactive Granot name in one multi-entity stamp — leave cost, activation, live processing, and texts for later gates — never activate — never price the lead — never send a text — never hang referral or watch-only — never correct an existing card. Do **not** split preview vs save into two public modules Wave B could import independently so “preview owns a second collision book.” Do **not** split the optional Granot fork into a second sitting so “setup never hangs a name.” If it later splits: `showWhetherThisDraftLeadSourceIsStillFree.ts` / `openThisDraftLeadSourceAsOneSitting.ts` only as later story files, never `create.ts` / `update.ts` / `delete.ts` / `preview.ts`, and never merge already-recommended leftover company persist, leftover hang, leftover Granot write, leftover SMS, leftover stamp, leftover who-may-speak, leftover CPL, next leftover projection, Wave B Zod, or Wave B HTTP into this file

`previewLeadSourceSetup` / `createLeadSourceSetup` / `validateLeadSourceSetup` are executor mechanics. The owner question is: *A new Lead Source is three leftover cards if the Owner walks the leftover POST pages. This sitting is one Owner command. They name the Lead Source, choose form or call, name what Vantage sends to Granot, optionally hang one exact Granot spelling and say what happens when a lead arrives, and write a reason. The server derives the company slug and the Feed key. The Owner cannot submit those keys. The page first shows every collision without writing. Save refuses any collision, then writes an inactive Lead Source, an inactive Feed, and optionally an inactive Granot name with texts unset, in one multi-entity stamp. Choosing create-if-missing does not turn texting on. The card then lists the leftover gates that still keep this draft off: set the lead cost, activate the Lead Source, activate the Feed, connect or switch the Granot name, then turn on the customer text. This page does not activate. This page does not price the lead. This page does not send a text. This page does not hang referral or watch-only. This page does not correct an existing card. This page does not invent a second company write or a second Granot write — it asks the already-recommended leftover persists.*

Already-recommended leftover company persist, leftover hang, leftover Granot write, leftover SMS, leftover stamp, leftover who-may-speak, leftover CPL, next leftover projection, Wave B Zod, and Wave B HTTP already live in other **modules**. Do not pull those in.

## What this file actually does

Three operations of one “open a draft Lead Source as one sitting — derive the company slug and Feed key — collect every collision without writing — persist the inactive company, inactive Feed, and optional inactive Granot name in one multi-entity stamp — leave cost, activation, live processing, and texts for later gates — never activate — never price the lead — never send a text — never hang referral or watch-only — never correct an existing card” story, not “a Lead Source CRUD helper,” and not leftover company PATCH / leftover hang POST:

1. **Show whether this draft Lead Source is still free** — `previewLeadSourceSetup`. Wave B preview. Signed read actor on the route; this beat does **not** check `actorRole`. **Asks** `validateLeadSourceSetup`. `valid` is `collisions.length === 0`. Returns derived slug / Feed key / owner label / Feed display name (plus folded Granot spelling and workspace slug when Granot was sent) and the leftover readiness plan. Writes nothing. A short reason is a collision, not a Zod miss (Wave B Zod already refuses under 10; this beat still collects 10–1000 so in-process callers see the same book). This beat does **not** take a session. This beat does **not** stamp.

2. **Open this draft Lead Source as one sitting** — `createLeadSourceSetup`. `actorRole !== "owner"` → `FORBIDDEN`. **Asks** the same validation. Any collision → `DUPLICATE_IDENTIFIER` / 400 (`Resolve every named collision before saving.`), including a short reason. Then **asks** leftover `withMultiEntityRegistryMutation` with forget keys `source_companies`, `source_granularities`, `source_attribution`, `facets`, plus leftover `GRANOT_LIFECYCLE_SOURCE_CACHE_KEYS` even when Granot was omitted. Inside the session: **ask** leftover `persistNewSourceCompanyInSession` (`created_from: "lead_source_setup"`, leftover persist hard-codes `active: false`); stamp `entityType: "source_company"` / `action: "create"`; **ask** leftover `persistNewSourceGranularityInSession` (channel, crm_label, optional leftover `local` from `move_type`, `created_from: "lead_source_setup"`); if the Feed came back `active` → `DEPENDENCY_CONFLICT` (`Setup must create an inactive feed.`); stamp `entityType: "source_granularity"` / `action: "create"`. Optional Granot: **ask** leftover `assembleOwnerGranotCreateForKnownFeed` (always leftover `our_lead_source`, one Feed), then leftover `persistGranotCrmSourceInSession`; if `enabled` / `lifecycle_enabled` / `outbound_sms.enabled` came back on → `DEPENDENCY_CONFLICT` (`Setup must create an inactive Granot name with texting unset.`); stamp the leftover persist’s audit. After both leftover persists: if company or Feed is active → `DEPENDENCY_CONFLICT` (`Setup must create inactive records.`). Return the draft card (`lead_source` / `feed` / `granot_name` or `null` / `readiness_plan`). `granot_name.text_state` is always `"off"`. Arrival copy is Owner English (`Watch only` / `Use an existing lead only` / `Use an existing lead, or create it if missing`). This beat does **not** take an id. This beat does **not** write CPL. This beat does **not** call leftover `setSourceCompanyActivation` / leftover `setSourceGranularityActivation` / leftover `setGranotCrmSourceLifecycleEnabled` / leftover `setGranotCrmSourceOutboundSms`. This beat does **not** hang leftover referral or leftover watch-only.

3. **List the gates that still keep this draft off** — `buildReadinessPlan`. Always: set the lead cost (`open_cpl`), activate the Lead Source (`setSourceCompanyActivation`), activate the Feed (`setSourceGranularityActivation`, blocked until `lead source active and lead cost valid`). Granot omitted → suggested `Connect a Granot name` (`createGranotNameFromOwnerIntent`). Granot included → `Switch the Granot name live` (`setGranotCrmSourceLifecycleEnabled`, blocked until `feed active`); if `when_lead_arrives === "create_if_missing"` also `Turn on the customer text` (`setGranotCrmSourceOutboundSms`, blocked until `Granot name live and create-if-missing and consent attested`). Next leftover projection **asks** this, then maps the English `gate` onto leftover Owner actions and leftover `done` / `blocked` / `suggested` / `ready`. This beat does **not** look at stored cards. This beat does **not** write.

There is no fourth activate operation. There is no price-the-lead operation. There is no SMS operation. There is no correct-an-existing-card operation. `deriveSetupKeys` / `defaultFeedDisplayName` / `validateLeadSourceSetup` sit on the preview and save paths. They are not extra owner operations. Do not export `collectAliasCollisions` / `companyAudit` / `feedAudit` / `invalid` as a public **seam**.

Do not export `validateLeadSourceSetup` as domain language for “the save already checked.” Do not export `buildReadinessPlan` as domain language for “the draft is live.” Do not export `persistNewSourceCompanyInSession` from this file so “setup owns the company write.”

## Organization

Keep one file as the screenplay for “open a draft Lead Source as one sitting, derive the company slug and Feed key, collect every collision without writing, persist the inactive company, inactive Feed, and optional inactive Granot name in one multi-entity stamp, leave cost, activation, live processing, and texts for later gates, never activate, never price the lead, never send a text, never hang referral or watch-only, never correct an existing card.” Already-recommended leftover company persist, leftover hang, leftover Granot write, leftover SMS, leftover stamp, leftover who-may-speak, leftover CPL, next leftover projection, Wave B Zod, `connectMongo`, and Wave B HTTP already live in deeper **modules**. Do not pull those in. Do not invent a `LeadSourceSetupService` class. Do not invent a begin / complete **seam** — leftover `withMultiEntityRegistryMutation` is already the before-commit / after-commit **adapter** on the save path. Do not invent a second company persist beside leftover `persistNewSourceCompanyInSession`. Do not invent a second Granot assemble beside leftover `assembleOwnerGranotCreateForKnownFeed`.

Do not split this into `create.ts` / `update.ts` / `delete.ts` / `preview.ts`. Those are persistence verbs, not the owner story. Do not move leftover `createOrUpdateSourceCompany` into this file so “one file owns companies.” Do not move leftover `createGranotNameFromOwnerIntent` into this file so “setup owns every hang.” Do not silently start activating here so “the sitting stays hot.”

**External interface** stays small (this is the test surface). Preview, save, and list-the-gates are one story’s book, not three CRUD verbs:

| Keep exporting | Story name | Why the seam exists |
|---|---|---|
| `previewLeadSourceSetup` | `showWhetherThisDraftLeadSourceIsStillFree` | Wave B preview |
| `createLeadSourceSetup` | `openThisDraftLeadSourceAsOneSitting` | Wave B save |
| `buildReadinessPlan` | `listTheGatesThatStillKeepThisDraftOff` | this card + next leftover projection |
| `validateLeadSourceSetup` | `collectEveryCollisionOnThisDraft` | preview and save **ask** this; barrelled |
| `deriveSetupKeys` | `deriveTheLeadSourceAndFeedKeys` | Paid Overflow-shaped slug / key; tests lock the table |
| `defaultFeedDisplayName` | `defaultTheFeedDisplayName` | `Web forms` / `Inbound calls` |
| `LeadSourceSetupCommand` / `LeadSourceSetupPreview` / `LeadSourceSetupResult` | `OpenThisDraftLeadSource` / `ThisDraftIsStillFree` / `ThisDraftLeadSourceWithGates` | Wave B Zod body, preview card, save card |

Keep the old names as one-line aliases until Wave B `v1.routes.ts`, the barrel, next `queries/leadSourceProjection.ts`, `leadSourceSetup.test.ts`, and Wave B Zod tests migrate. Do not make callers learn `InTransaction` / `validateLeadSourceSetup` / `open_cpl` as the domain language.

**Principle: old exports stay as aliases.** `previewLeadSourceSetup` remains the imported name until Wave B preview migrates. `createLeadSourceSetup` remains the imported name until Wave B save migrates. Persisted Change `action` `"create"`, `entity_type` `source_company` / `source_granularity` / leftover Granot audit type, `created_from: "lead_source_setup"`, leftover `company_slug` / `granularity_key`, leftover `when_lead_arrives` Zod enums, leftover readiness `command` strings (`open_cpl`, `setSourceCompanyActivation`, `setSourceGranularityActivation`, `createGranotNameFromOwnerIntent`, `setGranotCrmSourceLifecycleEnabled`, `setGranotCrmSourceOutboundSms`), and English `gate` strings next leftover projection keys stay those strings — they are stamp history, leftover sibling persist, Wave B body, and leftover projection `GATE_ACTION`, not story names.

**No class for the workflow.** The types that *do* earn names are the leftover bag Wave B Zod already parses and the leftover gate list this card and next leftover projection already share:

```ts
type OpenThisDraftLeadSource = {
  name: string
  owner_label?: string
  aliases?: string[]
  channel: "form" | "call"
  feed_display_name?: string
  crm_label: string
  move_type?: "local" | "long_distance"
  feed_aliases?: string[]
  source_sites?: string[]
  granot?: {
    name_received_from_granot: string
    when_lead_arrives: "watch_only" | "existing_only" | "create_if_missing"
  } | null
  reason: string
  // company_slug / granularity_key / normalized_granot_label must not be submitted
}

type TheseDraftGatesAreStillOff = {
  gate: string
  command: string // leftover executor name — projection maps English gate, not this field
  blocked_until?: string
  suggested?: boolean
}

type ThisDraftLeadSourceWithGates = {
  lead_source: { id: string; company_slug: string; name: string; owner_label: string; active: boolean; aliases: string[] }
  feed: { id: string; granularity_key: string; channel: "form" | "call"; display_name: string; crm_label: string; move_type?: "local" | "long_distance"; active: boolean }
  granot_name: {
    id: string
    name_received_from_granot: string
    when_lead_arrives: "watch_only" | "existing_only" | "create_if_missing"
    when_lead_arrives_copy: string
    text_state: "off"
  } | null
  readiness_plan: TheseDraftGatesAreStillOff[]
}
```

That is the handoff from “the Owner named a new Lead Source” to “three leftover cards exist as a draft, and the leftover gates still keep it off.” Do **not** add `id?` onto the command so “one sitting corrects.” Do **not** add `active: true` so “the sitting goes live.” Do **not** add `outbound_sms` so “create-if-missing texts on save.”

Do not add leftover `createOrUpdateSourceCompany` as a public **seam** on this file — leftover source persist already owns leftover PATCH. Do not add leftover `createGranotNameFromOwnerIntent` as a public **seam** on this file — leftover hang already owns leftover POST. Do not add leftover `setGranotCrmSourceOutboundSms` as a public **seam** — leftover SMS already owns the later command. Do not add leftover `getLeadSourceProjection` as a public **seam** — next leftover projection already owns the aggregate read.

## The file, as a story

Parent functions stay deep. Child names are only extracted when they hide a real decision, not a one-liner.

```ts
// leadSourceSetup.ts
// A new Lead Source is three leftover cards if the Owner walks the leftover POST pages.
// This sitting is one Owner command.
// Everything stays a draft. The leftover gates still keep it off.

// ── 1. Show whether this draft Lead Source is still free ─

export async function showWhetherThisDraftLeadSourceIsStillFree(command)
  const collected = await collectEveryCollisionOnThisDraft(command)
  return {
    valid: collected.collisions.length === 0,
    derived: collected.derived,
    collisions: collected.collisions,
    readiness_plan: collected.readiness_plan,
  }

// ── 2. Open this draft Lead Source as one sitting ────────

export async function openThisDraftLeadSourceAsOneSitting(command, actor, deps)
  if (actor.actorRole !== "owner") throw forbidden
  const collected = await collectEveryCollisionOnThisDraft(command)
  if (collected.collisions.length) throw duplicateIdentifier(joined messages)

  return stampTheseDraftCardsTogether({           // leftover withMultiEntityRegistryMutation
    actor,
    invalidateKeys: [source caches, leftover Granot lifecycle keys],
    mutate: async (session, writeAudit) => {
      const company = await persistTheInactiveLeadSource(command, collected, session)
      await writeAudit(companyCreateStamp(company, command.reason, actor.requestId))

      const feed = await persistTheInactiveFeed(command, collected, company, session)
      if (feed.active) throw mustStayADraft("Setup must create an inactive feed.")
      await writeAudit(feedCreateStamp(feed, command.reason, actor.requestId))

      let hungName = null
      if (command.granot) {
        const assembled = assembleThisGranotSpellingForAKnownFeed({ ... })
        const persisted = await persistTheInactiveGranotName(assembled.command, actor, session)
        if (nameOrTextCameBackOn(persisted)) {
          throw mustStayADraft("Setup must create an inactive Granot name with texting unset.")
        }
        await writeAudit(persisted.audit)
        hungName = showTheHungNameAsOff(command.granot, persisted.item.id)
      }

      if (company.active || feed.active) throw mustStayADraft("Setup must create inactive records.")
      return showTheDraftCard(company, feed, hungName, collected.readiness_plan)
    },
  }, deps)

async function collectEveryCollisionOnThisDraft(command, session?)
  refuseAShortOrLongReason(command.reason)        // 10–1000; collision, not Zod
  deriveTheLeadSourceAndFeedKeys(command.name, command.move_type)
  defaultTheOwnerLabelAndFeedDisplayName(command)
  refuseAHeldCompanySlug(company_slug, session)   // includes inactive holders
  refuseAHeldFeedKey(granularity_key, session)    // includes inactive holders
  refuseAHeldCrmLabelOrSourceSite(command, session) // leftover assertExactIdentifiersAvailable; active same-channel only
  refuseHeldAliasesOnEitherSide(command.aliases, "lead source", session)
  refuseHeldAliasesOnEitherSide(command.feed_aliases, "feed", session)
  if (command.granot) {
    sayWhetherThisGranotSpellingIsStillFree(command.granot.name_received_from_granot, session)
  }
  return { derived, collisions, readiness_plan: listTheGatesThatStillKeepThisDraftOff(...) }

function deriveTheLeadSourceAndFeedKeys(name, moveType?)
  const company_slug = deriveRegistryKey(name)    // leftover source fold
  const granularity_key = moveType ? `${company_slug}_${moveType}` : company_slug

function defaultTheFeedDisplayName(channel)
  return channel === "call" ? "Inbound calls" : "Web forms"

// ── 3. List the gates that still keep this draft off ─────

export function listTheGatesThatStillKeepThisDraftOff({ granotOmitted, createIfMissing })
  always: set the lead cost, activate the Lead Source, activate the Feed
  granotOmitted ? suggest leftover hang later
                : switch the Granot name live
                  + turn on the customer text when create-if-missing
```

Read the save path out loud: *Refuse anyone who is not the Owner. Collect every collision without writing. If anything is held, write nothing. Stamp the inactive Lead Source, stamp the inactive Feed, and when the Owner sent a Granot spelling assemble it for this known Feed and stamp the inactive name with texts unset. If any leftover persist came back on, the sitting did not happen. Forget the leftover source caches only after commit. Show the draft card and the leftover gates that still keep it off.*

That is the operation. `createLeadSourceSetup` is not.

## Precise logic I would tighten while renaming

These are real smells the story names make obvious. Do not “just rename.”

1. **A short reason on save is `DUPLICATE_IDENTIFIER`.** Preview collects reason length as a collision. Save throws that same bag under leftover `REGISTRY_DUPLICATE_IDENTIFIER` / “Resolve every named collision before saving.” A ten-character miss is not a held slug. Do not silently throw `DEPENDENCY_CONFLICT` for reason-only collisions so “the code matches the smell” without a paired preview + save test. Do not silently drop the in-process 10–1000 check so “Wave B Zod is enough.”

2. **Collision collection runs outside the leftover multi-entity stamp.** Race: two Owners can both see a free slug, then leftover persist / leftover unique wins for one. Save **asks** `validateLeadSourceSetup` with **no** session, then opens the transaction. Leftover `assertGranotNameAvailable` already accepts a session; this sitting does not pass one on save. Do not silently move collect-every-collision inside `withMultiEntityRegistryMutation` in this rename — that **seam** belongs to leftover stamp + leftover persist. Do not silently drop the pre-check so “only Mongo 409s.”

3. **`crm_label` collision discards the leftover error.** Both `catch` branches write the same English (`What Vantage sends to Granot collides with an active feed of the same kind.`) and never copy leftover `entity_id`. Do not silently start echoing leftover `RegistryError.message` so “the Owner sees the held Feed name” without a paired preview-fields test — today’s tests only lock the field name.

4. **Slug / Feed-key collisions include inactive holders; alias collisions only check active.** An inactive Paid Overflow-shaped leftover card still blocks the derived key. An alias may reuse a spelling that only an archived card holds. Do not silently add `active: true` onto the slug `findOne` so “drafts can recycle keys” without a paired inactive-holder test. Do not silently check inactive aliases so “every spelling is globally unique.”

5. **Paid Overflow-shaped leftover setup creates a new first-class Feed and leaves `paid_overflow` alone.** Tests lock `harbor_overflow_partner` ≠ `paid_overflow` and do not rewrite the leftover Feed’s `crm_label`. Do not silently reuse leftover `paid_overflow` when the Owner types a similar name so “overflow stays one Feed.” Do not silently **ask** leftover `createOrUpdateSourceGranularity` with that leftover id so “setup corrects Paid Overflow.”

6. **Leftover Granot lifecycle caches forget even when Granot was omitted.** `invalidateKeys` always spreads leftover `GRANOT_LIFECYCLE_SOURCE_CACHE_KEYS`. A skippable-Granot sitting still notifies leftover policy / list / health caches. Do not silently drop those keys when `command.granot` is missing so “omit means no Granot notify” without a paired skippable-Granot + leftover cache-log test. Do not silently **ask** leftover `createOrUpdateGranotCrmSource` on the omit path so “the suggested gate is already done.”

7. **Assemble cannot hang referral or watch-only.** Leftover hang already named this. Optional Granot on this sitting is always leftover `our_lead_source` on one Feed. Owner `when_lead_arrives: "watch_only"` still hangs as leftover source-scoped policy through leftover assemble. Do not silently add leftover `handling` onto this command so “setup owns every Owner word” without a paired setup + leftover hang test. Do not silently **ask** leftover `createGranotNameFromOwnerIntent` from save so “POST and setup share one hang.”

8. **Readiness `command` strings are leftover executor names; next leftover projection keys English `gate`.** `open_cpl` / `setSourceCompanyActivation` / `createGranotNameFromOwnerIntent` never run from this file. Next leftover `GATE_ACTION` maps `"Set the lead cost"` → `open_lead_costs`. The two lists can drift. Do not silently rename the English gates in this pass so “the projection map breaks.” Do not silently start calling leftover `applySimpleCplSchedule` from save so “the first gate is done.”

9. **`create_if_missing` does not turn texting on.** The leftover text gate is listed only. `text_state` is the constant `"off"`. Do not silently **ask** leftover `setGranotCrmSourceOutboundSms` when arrival is `create_if_missing` so “Best Relocation texts on setup.” Do not silently persist `outbound_sms.enabled: true`.

10. **There is no correct-an-existing-card export.** Save never sends leftover company / Feed / Granot ids. Leftover PATCH / leftover hang POST / leftover `/activation` are already-recommended. Do not silently add `id?` onto `LeadSourceSetupCommand` so “one command opens or corrects.” Do not silently **ask** leftover `createOrUpdateSourceCompany` when the derived slug is held so “setup upserts.”

11. **Owner-language deck vs leftover stored fields.** Skipped leftover `ownerLanguageDeck.ts` bans `granularity` / `lifecycle` / `disposition` / `route_key` / `lead_model` on Owner-facing copy. This card already says Lead source, Feed, and Granot name. Wave B Zod refuses those leftover internals as unknown keys. Do not silently return leftover `granularity_key` under a new Owner name so “the DTO hides the stored field” without a paired Wave B unknown-key test. Do not silently persist leftover `handling`.

12. **Leave sibling modules alone.** Already-recommended leftover `persistNewSourceCompanyInSession`, leftover `persistNewSourceGranularityInSession`, leftover `assertExactIdentifiersAvailable`, leftover `assembleOwnerGranotCreateForKnownFeed`, leftover `assertGranotNameAvailable`, leftover `persistGranotCrmSourceInSession`, leftover `withMultiEntityRegistryMutation`, leftover `requireRegistryOwnerActor`, leftover `setGranotCrmSourceOutboundSms`, leftover `validateCplSchedule`, Wave B `leadSourceSetupCommandSchema`, and next leftover `getLeadSourceProjection` are already the right **depth**. This file previews, opens the draft, and lists leftover gates; it does not activate, price, text, hang leftover referral, or project the aggregate card.

13. **Do not silently change persisted `created_from` / Change `action` / leftover readiness `command` / English `gate` strings.** Those are stamp history, leftover sibling persist, leftover projection `GATE_ACTION`, and Wave B body. Story names live on the functions.

## Testing

The **interface** is the test surface: `showWhetherThisDraftLeadSourceIsStillFree`, `openThisDraftLeadSourceAsOneSitting`, `listTheGatesThatStillKeepThisDraftOff` (today `previewLeadSourceSetup` / `createLeadSourceSetup` / `buildReadinessPlan`). `deriveSetupKeys` stays exported because the Paid Overflow-shaped table is a second real **adapter**, not a test leak. Do not make `collectAliasCollisions` / `companyAudit` / `invalid` the named surface.

Today `leadSourceSetup.test.ts` covers the key table, inactive company + Feed + Granot + readiness rows, skippable Granot, slug / crm_label / alias / Granot collisions writing nothing, mid-transaction Feed failure leaving none of the three, Paid Overflow leftover feed left alone, and preview writing nothing. Wave B Zod tests refuse derived internals. Keep both files’ **asks** of this interface. Name the operation:

**Show whether this draft Lead Source is still free**
- Happy Form + `create_if_missing` → `valid: true`, `company_slug: "synthetic_harbor_leads"`, folded Granot spelling, leftover text gate listed, store lengths stay 0.
- Held slug + held Feed key + held crm_label + held alias + held Granot spelling → `valid: false`, every field named, store lengths stay 0.
- Does **not** call leftover `Company.create`.
- Do not add a `requireRegistryReadActor` 403 test here. Wave B + leftover who-may-speak already own that **adapter**.

**Open this draft Lead Source as one sitting**
- Admin actor → `REGISTRY_FORBIDDEN`.
- Form + Granot `create_if_missing` → company `active: false`, Feed `active: false`, `text_state: "off"`, five leftover gates, `blocked_until` strings locked, one company / one Feed / one Granot in the store.
- Granot omitted → `granot_name: null`, store Granot length 0, last gate `Connect a Granot name` / `suggested: true`.
- Held company slug → leftover `RegistryError`, store lengths unchanged.
- Held active same-channel crm_label → leftover `RegistryError`, store lengths unchanged.
- Held alias names the leftover holder (`TBM Leads`) and writes nothing.
- Held Granot spelling writes nothing (no company, no Granot).
- Mid-transaction Feed failure → none of the three remain.
- Paid Overflow-shaped leftover name `Harbor Overflow Partner` → new Feed key `harbor_overflow_partner`; leftover `paid_overflow` `crm_label` stays `Paid Overflow`.
- Do not add a `requireRegistryOwnerActor` 403 test here. Wave B + leftover who-may-speak already own that **adapter**.
- Do not retest leftover `withMultiEntityRegistryMutation` replay here. Already-recommended leftover stamp already owns that **adapter**.

**List the gates that still keep this draft off**
- Always three leftover cost / activate rows.
- Omit Granot → suggested leftover hang.
- Include Granot + `create_if_missing` → leftover live-name + leftover text gates.
- Next leftover projection already maps English gates onto leftover Owner actions — do not retest leftover `done` / `blocked` status here.

Do **not** add a test per helper (`normalizeAlias`, `escapeRegex`, `companyAudit`). Those names exist so the parent reads. If a helper test has to change when the helper is inlined, it was testing past the **interface**.

Do **not** retest leftover company PATCH, leftover hang POST, leftover SMS enable gates, leftover `/activation` active-company rules, leftover CPL `set_range`, mint `createLeadFromGranot`, Wave B route mounts, or next leftover projection accepted-label lists here. Those already have (or will have) their own interface tests. Wave B **asks** preview / save. Next leftover projection **asks** the leftover gate list. Prove the book, not the finding.

## What I would not do

- A `LeadSourceSetupService` class with `create` / `update` / `delete`.
- Thirty two-line functions that only wrap leftover `persistNewSourceCompanyInSession` / leftover `assembleOwnerGranotCreateForKnownFeed`.
- Moving this into a CRUD folder (`create.ts` / `update.ts` / `delete.ts` / `preview.ts`) for cleanliness.
- Breaking the preview-then-multi-entity-stamp **seam**. A public leftover `persistNewSourceCompanyInSession` this file would call without leftover `withMultiEntityRegistryMutation` is the forbidden split. Returning leftover `outbound_sms` from save is the same break. Sending leftover company / Feed / Granot `id` so save corrects is the same break. Calling leftover `setSourceCompanyActivation` so the sitting goes live is the same break.
- Treating leftover company PATCH, leftover hang POST, leftover SMS, leftover stamp, leftover who-may-speak, leftover CPL, next leftover projection, Wave B Zod, Wave B HTTP, or `EntityChange` as this story.
- Inventing a **seam** that has only one **adapter**.
- Silently "fixing" a known gap while recommending a rename: do not recode short-reason as `DEPENDENCY_CONFLICT` without a paired preview + save test; do not move collect-every-collision inside leftover `withMultiEntityRegistryMutation`; do not drop the pre-check so “only Mongo 409s”; do not echo leftover crm_label `entity_id` without a paired field test; do not add `active: true` onto slug lookup; do not reuse leftover `paid_overflow`; do not drop leftover Granot cache keys on omit; do not add leftover `handling` onto this command; do not **ask** leftover `createGranotNameFromOwnerIntent` from save; do not rename English leftover gates; do not **ask** leftover CPL or leftover SMS from save; do not add `id?` onto the command; do not persist leftover `handling`; do not move leftover `persistNewSourceCompanyInSession` / leftover `persistGranotCrmSourceInSession` / leftover `requireRegistryOwnerActor` into this file; do not rename persisted `created_from` / Change `action` / leftover readiness `command` / English `gate` strings.
- Jumping to the next service while this one has unchecked modules.
- Writing a whole-folder recommendation for `operationsRegistry`.
