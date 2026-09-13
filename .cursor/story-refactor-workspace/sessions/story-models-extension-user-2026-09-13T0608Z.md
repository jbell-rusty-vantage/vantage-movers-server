# Session story-models-extension-user-2026-09-13T0608Z

- Date (UTC): 2026-09-13T0608Z
- Service / module: `models` / `ExtensionUser.ts`
- Lock: taken
- Branch / PR: `docs/story-refactor` / https://github.com/jbell-rusty-vantage/vantage-movers-server/pull/206

## Stock at start

- Wave: B
- Visited / in-progress / unvisited: 43 / 1 / 4
- Recommendations on disk: 354
- Current service / next module (TRAVERSAL): `models` (in-progress) / `ExtensionUser.ts`

## This pass

- opened new service?: no
- path or skip: recommended → `recommendations/models-extension-user.md` (`src/models/ExtensionUser.ts`)
- operations named: Hold the Extension User as the Granot-extension login row; Keep one login per folded email and index active without uniqueness; Bind the default Mongo connection and re-export the current-role tuple Zod already imports
- remaining in this service: `Testimonial.ts` first, then the rest of the models checklist

## Stock at end

- Visited / in-progress / unvisited: 43 / 1 / 4
- Current service / next module: `models` (in-progress) / `Testimonial.ts`

## Messages posted

- 2026-09-13T0608Z next

## Ideas parked

- none (do not add leftover `employee` onto `roles[]` so the array can store what the singular field stores; do not drop leftover singular `role` so schema matches knowledge `roles[]`; do not invent `getExtensionUserModel` so login matches Form; do not delete the default `ExtensionUser` export so login matches evidence; do not copy Booking autoIndex-false without a migration; do not invent absent `scripts/dev_ops/upsert-extension-user.ts`; do not copy this unique email onto leftover next `Testimonial.ts` without reading it)

## Contradictions

- Schema-and-CRUD still names leftover singular `role` as the persisted field; this file holds `roles[]` (current only) plus leftover `role` (includes employee)
- Login / refresh / token leftover-find `{ active: true }`; Owner list does not filter `active`
- `pre("save")` stamps `updated_at`; Owner `findByIdAndUpdate` `$set`s it; migration `updateOne` does not touch it
- `EXTENSION_ROLES` is a pass-through of leftover `CURRENT_EXTENSION_ROLES`; Zod leftover-imports the alias from this file
- Overview does not count this collection; historical-consolidation does not validate it
- There is no `historical/ExtensionUser.ts`
- There is no `getExtensionUserModel`
- Knowledge names leftover `scripts/dev_ops/upsert-extension-user.ts`; that script is absent in this checkout
- Leftover next `Testimonial.ts` unique is `{ source, content_fingerprint }` — do not copy this desk onto it without reading it
