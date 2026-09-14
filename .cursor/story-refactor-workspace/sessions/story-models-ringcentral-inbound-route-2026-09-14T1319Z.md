# Session story-models-ringcentral-inbound-route-2026-09-14T1319Z

- Date (UTC): 2026-09-14T1319Z
- Service / module: `models` / `RingCentralInboundRoute.ts`
- Lock: taken
- Branch / PR: `docs/story-refactor` / https://github.com/jbell-rusty-vantage/vantage-movers-server/pull/206

## Stock at start

- Wave: B
- Visited / in-progress / unvisited: 43 / 1 / 4
- Recommendations on disk: 384
- Current service / next module (TRAVERSAL): `models` (in-progress) / `RingCentralInboundRoute.ts`

## This pass

- opened new service?: no
- path or skip: recommended → [recommendations/models-ringcentral-inbound-route.md](../recommendations/models-ringcentral-inbound-route.md)
- operations named: hold the inbound-number card; remember which unique phone belongs to which card, whether it is locked, whether it is live, whether it was ever turned on, whether this account can see it, and the last-seen clocks; stamp the unnamed clocks and hand back the selected-database model
- remaining in this service: `RingCentralInboundRouteAssignment.ts` first, then the rest of the models checklist

## Stock at end

- Visited / in-progress / unvisited: 43 / 1 / 4
- Current service / next module: `models` (in-progress) / `RingCentralInboundRouteAssignment.ts`

## Messages posted

- 2026-09-14T1319Z next

## Ideas parked

- none

## Contradictions

- Operations Registry knowledge lumps `ringCentralRegistry.ts` / `ringCentralValidation.ts` as the inbound-route snapshot; that sentence names already-recommended `ringCentralSnapshot.ts`
- `schema-and-crud-inputs.mdc` Core Collections omits `ringcentral_inbound_routes`
- Schema `immutable` on `phone_number` fires on document `save`; Owner write is `findOneAndUpdate` and fences in Registry
- Snapshot loads `{ ever_activated: true, validation_status: "valid" }` and does **not** filter `active`; Granot create / adoption require `{ active: true, validation_status: "valid" }`
- Validator `unavailable` stores as `unvalidated`; health `registry.ringcentral_validation_failed` reads `invalid`
- Archive `$set`s `active: false` / `archived_at` and does **not** unlock `phone_locked`
- Last-seen is `$max` without a Registry Change and without cache forget
- Default export has no runtime import; overview asks the getter (Source Company overview asks the default)
- CamelCase `createdAt` / `updatedAt` plus default `__v`; Picker selection uses named `created_at` only and `versionKey: false`
- File omits `autoIndex: false`; M5 also asks `createIndexes()`
- Actor snapshot is copied onto next Assignment
- Job Timeline / historical consolidation / admin HTTP desk never read this collection
- Already-recommended Call Lead `route_id` / Source Company / first-class Feed / Picker selection are different collections — do not merge
