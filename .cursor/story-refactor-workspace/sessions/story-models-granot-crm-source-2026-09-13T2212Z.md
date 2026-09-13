# Session story-models-granot-crm-source-2026-09-13T2212Z

- Date (UTC): 2026-09-13T2212Z
- Service / module: `models` / `GranotCrmSource.ts`
- Lock: taken
- Branch / PR: `docs/story-refactor` / https://github.com/jbell-rusty-vantage/vantage-movers-server/pull/206

## Stock at start

- Wave: B
- Visited / in-progress / unvisited: 43 / 1 / 4
- Recommendations on disk: 369
- Current service / next module (TRAVERSAL): `models` (in-progress) / `GranotCrmSource.ts`

## This pass

- opened new service?: no
- path or skip: recommended → [recommendations/models-granot-crm-source.md](../recommendations/models-granot-crm-source.md)
- operations named: hold the Granot CRM source as both the CSV catalog row and the only semantic Granot name (unreviewed: operationally on, lifecycle off, deferred, observation-only, empty routes, optional SMS off); refuse a structurally illegal card on validate without loading company or Feed refs (`pre("validate")` asks leftover next helper with no refs; invalidates `lifecycle_disposition`); stamp named lifecycle indexes without applying the folded-label unique until Unit 06 (`autoIndex: false`; live unique is `{ crm_origin, workspace_slug }`) and bind the selected Mongo database.
- remaining in this service: `granotCrmSourceSemantics.ts` first, then the rest of the models checklist

## Stock at end

- Visited / in-progress / unvisited: 43 / 1 / 4
- Current service / next module: `models` (in-progress) / `granotCrmSourceSemantics.ts`

## Messages posted

- 2026-09-13T2212Z next

## Ideas parked

- none

## Contradictions

- Two identities: live CSV unique `{ crm_origin, workspace_slug }` vs declared-but-unapplied unique `{ normalized_granot_label }`
- Leftover string `source_company` (default `not_provided`) vs ObjectId `lead_source_company`
- `pre("validate")` asks leftover next helper without refs; leftover Registry persist asks it with loaded company / Feed refs
- CSV leftover-seed `findOneAndUpdate` upsert does not set `runValidators`; leftover Registry `$set` does
- `enabled` default `true` vs leftover “unreviewed rows stay disabled” wording (lifecycle-off, not operational-off)
- `normalized_granot_label` schema `lowercase` is not the leftover NFKC fold
- `GranotCrmSource.test.ts` hosts leftover-next-helper leftover-ref proofs and leftover `sourceLabel` fold proofs
- Replica leftover-seeds leftover-use `.collection.insertOne` (hooks do not run)
- Leftover next `granotCrmSourceSemantics.ts` is the judge — do not merge it into this row
