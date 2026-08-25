# Read The Leftover Source Company Book — operational story

- Status: recommended
- Service: `leadSourceCompanies` (Wave A, visited)
- Pass: 1 of this service — `leadSourceCompany.service.ts`
- Remaining in this service: none — `index.ts` already skipped as a barrel
- Target: `src/services/leadSourceCompanies/leadSourceCompany.service.ts`
- Knowledge: `docs/knowledge/services/operations-registry.md` (Owner Source Company / Source Granularity writes, first-class granularities, embedded arrays as migration/rollback evidence). Lead assignment is `docs/knowledge/services/form-lead.md` / `call-lead.md` / `bookings.md` via `leads/leadSourceCompany.ts`, not this file. Lead CPL writes are `docs/knowledge/services/form-lead.md` via `leads/leadCplResolution.ts` (Registry periods). Legacy CPL: `docs/knowledge/services/operations-registry.md` + `.cursor/rules/cpl-operations.mdc` (`cpl_rates` and embedded granularity CPL are read-only compatibility). No dedicated Service file for this leftover catalog. This checkout’s `CONTEXT.md` does not define Source Company / Source Granularity — do not invent a glossary copy. `docs/adr/` is absent here — do not invent ADR copies.
- Callers: `cpl/cplRate.service.ts` (`listLeadSourceCompanies` for `GET /api/v1/admin/cpl-rates`). `config/domain/cpl.ts` (`getCplForLeadSource` as the first try inside `getCplForSource`; no Lead or Booking write path still calls `getCplForSource`). Types only: `leads/leadSourceCompany.ts` (`LeadSourceChannel`), `employeeBookings/migrationPreflight.ts` (`LeadSourceCompanyItem`). Barrel: `leadSourceCompanies/index.ts`. Tests: `leadSourceCompany.service.test.ts`. Inventory lists `ensureLeadSourceCompaniesSeeded` / `LEGACY_RINGCENTRAL_INBOUND_NUMBERS_BY_LABEL` as embedded seed + leftover phone metadata. Admin `/api/v1/admin/source-companies*` already goes through Registry `listSourceCompanies` / Owner commands — not these exports.
- Seams callers need: seed-then-list for leftover readers vs Registry list; leftover hint match vs `assignLeadSource`; leftover granularity CPL vs Registry `resolveCpl`; create/update stay exported though no route calls them, and they refuse nested granularity writes
- Split later (only if the file outgrows one sitting): keep one file — leftover seed, leftover list, leftover match are one sitting. Never `create.ts` / `update.ts` / `delete.ts`

`createLeadSourceCompany` / `updateLeadSourceCompany` / `resolveLeadSource` / `getCplForLeadSource` are executor mechanics. The owner question is: *the old Source Company book still sits in Mongo as one document per company with granularities nested inside. If this database has never seen that book, write the known companies from config — do not overwrite a company that is already there. Then leftover readers can still list those companies, match a company and a granularity the old way (slug, leftover label, inbound phone, site, Move Type), and read the CPL that was stored on that granularity. This is not assigning a Lead. This is not the Owner catalog. Registry already owns those.*

Lead assignment is `leads/leadSourceCompany.ts`. Owner catalog write is `operationsRegistry/sourceRegistry.ts`. Lead pricing is `leads/leadCplResolution.ts`. RingCentral inbound phones are Registry routes. Do not pull those in.

## What this file actually does

Six operations, not “a Source Company CRUD service,” and not Lead Source Assignment:

1. **Seed the leftover book for this database** — if a `company_slug` from config is missing, `$setOnInsert` that company and its nested granularities (`created_from: "legacy_seed"`). Never overwrite a row that already exists. One in-flight promise per Mongo database name so TEST_MODE and the non-test database do not share a seed.
2. **List the leftover companies** — seed first. Active only unless `includeInactive`. Sort by `owner_label`. This is what leftover CPL list still reads.
3. **Find one leftover company by id** — no seed. Missing → 404. No HTTP caller.
4. **Write a leftover company row without touching nested granularities** — create or patch company fields. Sending `granularities` → 400 (`Embedded granularities are read-only. Use /api/v1/admin/source-granularities.`). Duplicate slug → 409. No route calls these. Registry Owner commands already write the live catalog.
5. **Match leftover company + granularity from a hint** — seed, then walk the embedded book: slug / name / owner_label / aliases, else a granularity label / inbound phone / site. `not_provided` (slug or value) becomes `main_site`. Granularity pick: key, then phone, then site, then label, then Move Type, then company default, then first same-channel row. Miss → `ValidationError` on `source_company` or `source_granularity`.
6. **Read leftover CPL from that match** — `granularity.cpl` after leftover match. `getCplForSource` tries this first (`requireActive: false`), then falls back to `cpl_rates`. Lead writes do not call this.

## Organization

Keep one file. This is the screenplay for “the old book is still here for leftover readers.” Registry attribution, first-class granularities, Owner activation, Lead assignment, and Lead CPL already live in deeper **modules**. Do not pull those in. Do not invent a `LeadSourceCompanyService` class. Do not invent a `begin` / `complete` **seam** — this file is leftover read + leftover seed, not a command.

Do not split this 660-line file by create / update / delete. Seed, list, leftover match, and leftover CPL are one leftover book. Dead create/update stay in the same file as aliases until a separate deletion.

**External interface** stays small (this is the test surface):

| Keep exporting | Story name | Why the seam exists |
|---|---|---|
| `ensureLeadSourceCompaniesSeeded` | `seedTheLeftoverSourceCompanyBook` | list / leftover match must not share a seed across TEST_MODE vs the non-test database |
| `listLeadSourceCompanies` | `listTheLeftoverSourceCompanies` | leftover CPL list; not `GET /admin/source-companies` |
| `getLeadSourceCompany` | `findOneLeftoverSourceCompany` | leftover detail; no HTTP caller |
| `createLeadSourceCompany` | `insertALeftoverSourceCompanyWithoutNestedGranularities` | dead HTTP; refuse nested writes |
| `updateLeadSourceCompany` | `patchALeftoverSourceCompanyWithoutNestedGranularities` | dead HTTP; refuse nested writes |
| `resolveLeadSource` | `matchLeftoverCompanyAndGranularityFromThisHint` | leftover CPL / tests; Lead writes use `assignLeadSource` |
| `leadSourceAssignmentFields` | `stampWhatTheLeftoverMatchWouldWrite` | unused; `leads/leadSourceCompany.ts` stamps from Registry |
| `getCplForLeadSource` | `readLeftoverCplFromThatMatch` | first try inside `getCplForSource` only |

Keep the old names as one-line aliases until leftover CPL list and `getCplForSource` migrate or die. Do not make callers learn `resolve` / `ensure` as the domain language.

**No class for the workflow.** The types that *do* earn names are the leftover hint and the leftover page:

```ts
type LeftoverSourceHint = {
  channel: "form" | "call"
  value?: string | null
  company_slug?: string | null
  granularity_key?: string | null
  local?: LocalType
  source_site?: string | null
  inbound_phone_number?: string | null
  requireActive?: boolean
}

type LeftoverSourceCompanyPage = {
  company: LeadSourceCompanyItem
  granularity: LeadSourceGranularityItem
}
```

That is the handoff from “here is an old label or phone” to “leftover CPL can read a number.” There is no after-commit bag and no Lead stamp from this file.

`LeadSourceChannel` stays exported: `leads/leadSourceCompany.ts` still types its Registry hint with it.

## The file, as a story

Parent functions stay deep. Child names are only extracted when they hide a real decision, not a one-liner.

```ts
// leadSourceCompany.service.ts
// The old Source Company book still sits in Mongo.
// One document per company. Granularities nested inside.
// If this database has never seen that book, write the known
// companies from config — do not overwrite a company that is
// already there.
// Leftover readers can still list those companies,
// match a company and a granularity the old way,
// and read the CPL stored on that granularity.
// This is not assigning a Lead.
// This is not the Owner catalog.
// Registry already owns those.

// ── 1. Seed the leftover book for this database ───────────

export async function seedTheLeftoverSourceCompanyBook()
  // one promise per getMongoDatabaseName()

async function writeMissingCompaniesFromConfig()
  // $setOnInsert only; skip slugs that already exist
function companiesTheConfigStillKnows()
  // SOURCE_COMPANY_CONFIGS minus not_provided
function nestedGranularitiesFromTheOldCplTable(config)
function leftoverInboundPhonesForThisCallLabel(label)
  // LEGACY_RINGCENTRAL_INBOUND_NUMBERS_BY_LABEL
function leftoverAliasesFromTheOldLabelMap(slug)

// ── 2. List the leftover companies ────────────────────────

export async function listTheLeftoverSourceCompanies(options?)
  // seed first; active unless includeInactive

// ── 3. Find one leftover company by id ────────────────────

export async function findOneLeftoverSourceCompany(id)
  // no seed; 404 if missing

// ── 4. Write a leftover company row (dead HTTP) ───────────

export async function insertALeftoverSourceCompanyWithoutNestedGranularities(input)
export async function patchALeftoverSourceCompanyWithoutNestedGranularities(id, patch)

function refuseAWriteThatSendsNestedGranularities(input)
  // 400: use /admin/source-granularities
function aDuplicateSlugIsAConflict(error)
  // 409

// ── 5. Match leftover company + granularity from a hint ───

export async function matchLeftoverCompanyAndGranularityFromThisHint(hint)

function aNotProvidedHintIsMainSite(slug, value)
function findTheCompanyInTheLeftoverBook(companies, hint)
  // slug / name / owner_label / aliases, else granularity label / phone / site
function pickTheGranularityOnThatCompany(company, hint)
  // key → phone → site → label → Move Type → company default → first same-channel
function unknownCompanyIsASourceCompanyValidation(hint)
function unknownGranularityIsASourceGranularityValidation(company, hint)

export function stampWhatTheLeftoverMatchWouldWrite(page)
  // unused; do not route Lead writes through this

// ── 6. Read leftover CPL from that match ──────────────────

export async function readLeftoverCplFromThatMatch(hint)
  // page.granularity.cpl
```

Read the leftover CPL-list path out loud: *Seed the leftover book for this database if any known slug is missing. List every leftover company, including inactive. The admin CPL list flattens each nested granularity into a rate row. If that list is empty, leftover `cpl_rates` is the fallback — but a real seed fills the book, so the fallback almost never runs.*

Read the leftover match path out loud: *A hint said `not_provided`, or it said “Best Relocation” plus local, or it said an old inbound phone. Treat blank/`not_provided` as Main Site. Walk the leftover book — do not ask the Registry. Pick the company by slug, name, or alias, or by a nested granularity label / phone / site. Then pick the granularity: key, phone, site, label, Move Type, company default, or the first same-channel row. The leftover CPL is the number stored on that nested row.*

That is the operation. `createLeadSourceCompany` is not.

## Precise logic I would tighten while renaming

These are real smells the story names make obvious. Do not “just rename.”

1. **This folder is not Lead Source Assignment.** `leads/leadSourceCompany.ts` asks the Registry and stamps the Lead. This file still exports `resolveLeadSource` / `leadSourceAssignmentFields`. No write path calls them. Do **not** silently route `assignLeadSource` through leftover match “so both files share a matcher,” and do not merge the folders because the names collide.

2. **This folder is not the Owner catalog.** `GET/POST/PATCH /api/v1/admin/source-companies*` already call Registry `listSourceCompanies` / Owner commands. These create/update/get exports have no route. Do **not** rewire admin HTTP back onto this file “because the functions still exist.”

3. **Knowledge says embedded arrays are evidence only.** `operations-registry.md` Role: first-class Source Granularities are what employee booking and admin facets read; embedded arrays are migration/rollback evidence. This file still seeds, lists, and matches those nested arrays, and leftover CPL list prefers them. Rename so the leftover read is visible. Do **not** delete the seed so the Role line “wins,” and do not teach leftover match to read first-class `LeadSourceGranularity` documents.

4. **`getCplForSource` comments lie about the first try.** The config comment says CPL is `cpl_rates`. The body tries this file’s nested `granularity.cpl` first, then `getCplRate`. Lead writes use Registry periods. Do not silently drop the leftover first try so the comment “wins,” and do not call leftover CPL from Form/Call ingest.

5. **Admin CPL list prefers the leftover book whenever seed produced any company.** `listCplRates` maps nested `granularity.cpl` and only falls back to `cpl_rates` when that list is empty. A successful seed makes the fallback dead. The CPL unit test stubs an empty full-find so it can still exercise `cpl_rates` seed. Do not delete the `cpl_rates` fallback “because a seeded catalog always has companies,” and do not change leftover list so tests “see both books.”

6. **Seed never updates.** `$setOnInsert` plus “skip slugs we already saw.” A later config alias / inbound-phone edit does not rewrite existing catalog rows. Do not turn seed into an upsert-merge so “the leftover book stays current.”

7. **Seed is per database name.** `seedPromisesByDatabase` is keyed by `getMongoDatabaseName()`. The replica-style test locks TEST_MODE after a non-test-named seed. Do not use a process-global promise.

8. **`not_provided` → Main Site lives twice.** Leftover match rewrites the slug here. `assignLeadSource` does the same before asking the Registry. Same default, two **adapters**. Do not extract a shared helper into this leftover file, and do not change leftover match to skip Main Site because Registry “already does that.”

9. **Leftover inbound phones are a hardcoded label map.** `LEGACY_RINGCENTRAL_INBOUND_NUMBERS_BY_LABEL` is stamped onto nested call granularities at seed. Runtime RingCentral qualification uses Registry inbound routes. Inventory already names this leftover. Do **not** import `call-lead-sources.ts` (migration/test seed only) and do not teach leftover match to call Registry phone routing.

10. **Leftover match is first-hit, not Registry uniqueness.** Company walk is `find` on folded slug/name/label/aliases, then a second `find` across nested labels/phones/sites. Granularity walk is priority-sorted then first match. Registry `previewSourceAttribution` fails closed on equal-priority ambiguity and records an Operational Event. Do not add that fail-closed rule here “so leftover match is honest.”

11. **`get` does not seed.** List and leftover match do. Create/update do not. A cold database 404s leftover detail even when config still knows the slug. Do not add seed to get so “every read warms the book.”

12. **`leadSourceAssignmentFields` is unused.** The Lead stamp lives in `leads/leadSourceCompany.ts` from a Registry attribution (includes `match_kind`). This leftover stamp has no `match_kind`. Do not export it as the shared bag, and do not delete it in this rename — keep the alias until a separate deletion.

13. **Leave sibling modules alone.** `resolveSourceAttribution`, `listSourceCompanies`, `assignLeadSource`, `priceTheLead`, `listCplRates`, and RingCentral inbound-route snapshot stay where they are. This file orchestrates leftover seed and leftover match.

14. **Do not treat Registry Owner write as this story.** `createOrUpdateSourceCompany` / granularity commands / activation are owner-gated, transactional, and audited. Historical repair scripts may still write the model directly.

## Testing

The **interface** is the test surface: `seedTheLeftoverSourceCompanyBook`, `listTheLeftoverSourceCompanies`, `matchLeftoverCompanyAndGranularityFromThisHint`, `readLeftoverCplFromThatMatch`. Keep get / insert / patch exported because they are leftover **adapters**, not a test leak — add refuse tests only if an implementer keeps those exports.

Today’s `leadSourceCompany.service.test.ts` locks leftover seed + label/phone/`not_provided` match + TEST_MODE independence. That is the right surface. Fill the gaps the story names make obvious. Do not add a test per helper.

**Seed the leftover book for this database**
- Missing slugs from `SOURCE_COMPANY_CONFIGS` (except `not_provided`) are inserted once. Already locked via list. Keep it.
- A second list on the same database does not insert again (`$setOnInsert` / existing-slug skip).
- TEST_MODE after a non-test-named seed still seeds the test database. Already locked — keep it.

**List the leftover companies**
- Default omits `active: false`. `includeInactive: true` returns them.
- Leftover CPL list is a caller (`listCplRates`). Do not re-test admin Registry source-company HTTP here.

**Match leftover company + granularity from a hint**
- `value: "not_provided"` / missing → `main_site` + Main Site Forms. Already locked — keep it.
- `"Best Relocation"` + `local` → `best_relocation_leads` / Best Relocation Locals / leftover CPL 40. Already locked — keep it.
- Inbound `+18883164387` on `call` → `tbm_leads` / 10best Inbounds. Already locked — keep it.
- Every `SOURCE_LABEL_TO_COMPANY` label maps to the expected leftover company and CRM label. Already locked — keep it.
- `"TBM Forms Prime"` → `tbm_prime_leads` / TBM Prime Forms. Already locked — keep it.
- Unknown leftover company → `ValidationError` `field: "source_company"`.
- Known company, unknown same-channel granularity → `ValidationError` `field: "source_granularity"`.

**Read leftover CPL from that match**
- After a leftover match, return `granularity.cpl` (Best Relocation local 40 is already locked on the match itself).
- `getCplForSource` trying this first is `config/domain/cpl.ts` — do not re-test the config fallback here.

**Write a leftover company row (only if exports stay)**
- Sending `granularities` on create or patch → 400 pointing at `/api/v1/admin/source-granularities`.
- Duplicate `company_slug` → 409.
- Do **not** add a happy-path insert test that becomes the new Owner write.

Do **not** add a test per helper (`aNotProvidedHintIsMainSite`, `leftoverInboundPhonesForThisCallLabel`). Those names exist so the parent reads. If a helper test has to change when the helper is inlined, it was testing past the **interface**.

Do not re-test Registry uniqueness, Owner activation, `assignLeadSource`, or `priceTheLead` here.

## What I would not do

- A `LeadSourceCompanyService` class with `create` / `update` / `list` / `resolve`.
- Thirty two-line functions that only trim a slug or spread seven leftover fields.
- Moving this into a CRUD folder, or into `leads/` / `operationsRegistry/` “because it talks to Source Companies.”
- Rewiring admin `/source-companies` or Lead ingest onto leftover match.
- Teaching leftover match to call Registry, or teaching `assignLeadSource` to call leftover match.
- Turning seed into an upsert-merge, or sharing one seed promise across TEST_MODE and the non-test database.
- Importing `ringcentral/call-lead-sources.ts` for leftover phones.
- Silently deleting create/update/get because no route calls them, or silently dropping the `cpl_rates` fallback because a real seed fills the book.
- Writing a whole-folder recommendation that also covers `cpl/` or Registry source writes.
- Inventing a glossary copy of Source Company / Source Granularity, or an ADR copy.
