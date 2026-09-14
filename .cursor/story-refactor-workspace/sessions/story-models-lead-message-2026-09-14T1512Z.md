# Session story-models-lead-message-2026-09-14T1512Z

- Date (UTC): 2026-09-14T1512Z
- Service / module: `models` / `LeadMessage.ts`
- Lock: taken
- Branch / PR: `docs/story-refactor` / https://github.com/jbell-rusty-vantage/vantage-movers-server/pull/206

## Stock at start

- Wave: B
- Visited / in-progress / unvisited: 43 / 1 / 4
- Recommendations on disk: 386
- Current service / next module (TRAVERSAL): `models` (in-progress) / `LeadMessage.ts`

## This pass

- opened new service?: no
- path or skip: recommended → [recommendations/models-lead-message.md](../recommendations/models-lead-message.md)
- operations named: hold the durable outbound confirmation SMS; remember which Lead (`form_lead` plus additive `lead_ref`), which unique string Twilio SID, which Observation-plus-purpose, and how drain / lease / callback find it; stamp the clocks, hand back the selected-database model, and save a new row through that getter
- remaining in this service: `LeadMessageRateLimit.ts` first, then the rest of the models checklist

## Stock at end

- Visited / in-progress / unvisited: 43 / 1 / 4
- Current service / next module: `models` (in-progress) / `LeadMessageRateLimit.ts`

## Messages posted

- 2026-09-14T1512Z next

## Ideas parked

- none

## Contradictions

- Admin Form browse / Owner list filter `form_lead`; Analytics joins `$ifNull` `lead_ref.id` / `form_lead`; Job Timeline hops Form `{ lead_ref.id OR form_lead }` and Call `{ lead_ref.id }` only
- `provider_status` and `status_history.status` are free strings; domain exports `LEAD_MESSAGE_PROVIDER_STATUSES`
- Successful-text statuses live in `config/domain/leadMessaging.ts`, not this schema
- `lead_ref` nested lacks `_id: false`; already-recommended WordPress receipt uses `{ _id: false }`
- `{ form_lead: 1, createdAt: -1 }` duplicates field `index: true`
- Phase-1 backfill copies `form_lead` onto `lead_ref` and does **not** unset `form_lead`
- Boot creates these clocks (`autoIndex` default); Form Lead uses `autoIndex: false` plus a named migration catalog; there is no M5 `createIndexes()` for `lead_messages`
- Default export has no runtime import; the model test constructs the default and reads `.schema.indexes()`
- Job Timeline hops `db.collection("lead_messages")` and does **not** import this file
- Historical consolidation lists `lead_messages` as a side-effect that must not grow
- Already-recommended inbound-number interval / leftover next rate-limit / leftover later conversation are different collections — do not merge
