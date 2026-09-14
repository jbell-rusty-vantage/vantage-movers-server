# Session story-models-ringcentral-inbound-route-assignment-2026-09-14T1410Z

- Date (UTC): 2026-09-14T1410Z
- Service / module: `models` / `RingCentralInboundRouteAssignment.ts`
- Lock: taken
- Branch / PR: `docs/story-refactor` / https://github.com/jbell-rusty-vantage/vantage-movers-server/pull/206

## Stock at start

- Wave: B
- Visited / in-progress / unvisited: 43 / 1 / 4
- Recommendations on disk: 385
- Current service / next module (TRAVERSAL): `models` (in-progress) / `RingCentralInboundRouteAssignment.ts`

## This pass

- opened new service?: no
- path or skip: recommended → [recommendations/models-ringcentral-inbound-route-assignment.md](../recommendations/models-ringcentral-inbound-route-assignment.md)
- operations named: hold the assignment interval; remember which unique open interval belongs to which card, which company and Feed it points at, when it started, and when it closed; stamp the unnamed clocks and hand back the selected-database model
- remaining in this service: `LeadMessage.ts` first, then the rest of the models checklist

## Stock at end

- Visited / in-progress / unvisited: 43 / 1 / 4
- Current service / next module: `models` (in-progress) / `LeadMessage.ts`

## Messages posted

- 2026-09-14T1410Z next

## Ideas parked

- none

## Contradictions

- Operations Registry knowledge lumps `ringCentralRegistry.ts` / `ringCentralValidation.ts` as the inbound-route snapshot; that sentence names already-recommended `ringCentralSnapshot.ts`
- `schema-and-crud-inputs.mdc` Core Collections omits `ringcentral_inbound_route_assignments`
- Open is `effective_until` missing; unique-open is `active: true`; close writes both
- Snapshot loads `find({})` and resolves by the start / until window — it does **not** read `assignment.active`
- Granot create / adoption require `assignment.active` plus the window
- Lead Source list asks `{ effective_until missing, active: true }`; detail asks `{ effective_until missing }`
- Schema `immutable` on `route` / company / Feed / `effective_from` fires on document `save`; Owner write is `create` plus `updateOne` close
- Two open rows miss as a Registry dependency; the unique partial only fences `active: true`
- Close `$set`s `effective_until` / `active: false` and does **not** `deleteOne`
- `active` default `true`; already-recommended card defaults `false`
- No phone on this file; the card owns the folded number
- Actor snapshot is copied from the already-recommended card
- Default export has no runtime import; the model test asks `.schema.indexes()` on the default
- CamelCase `createdAt` / `updatedAt` plus default `__v`; Picker selection uses named `created_at` only and `versionKey: false`
- File omits `autoIndex: false`; M5 also asks `createIndexes()`
- Job Timeline / historical consolidation / admin HTTP desk / overview never read this collection
- Already-recommended inbound-number card / Call Lead `route_assignment_id` / Source Company / first-class Feed / leftover next SMS are different collections — do not merge
