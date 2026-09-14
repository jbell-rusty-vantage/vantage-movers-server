# Session story-models-lead-message-rate-limit-2026-09-14T1612Z

- Date (UTC): 2026-09-14T1612Z
- Service / module: `models` / `LeadMessageRateLimit.ts`
- Lock: taken
- Branch / PR: `docs/story-refactor` / https://github.com/jbell-rusty-vantage/vantage-movers-server/pull/206

## Stock at start

- Wave: B
- Visited / in-progress / unvisited: 43 / 1 / 4
- Recommendations on disk: 387
- Current service / next module (TRAVERSAL): `models` (in-progress) / `LeadMessageRateLimit.ts`

## This pass

- opened new service?: no
- path or skip: recommended → [recommendations/models-lead-message-rate-limit.md](../recommendations/models-lead-message-rate-limit.md)
- operations named: hold the confirmation-SMS capacity bucket; remember which bag this is (hourly UTC-hour string vs destination SHA-256, never the phone) and when Mongo may forget it; stamp the TTL clock and hand back the selected-database model
- remaining in this service: `LeadConversation.ts` first, then the rest of the models checklist

## Stock at end

- Visited / in-progress / unvisited: 43 / 1 / 4
- Current service / next module: `models` (in-progress) / `LeadConversation.ts`

## Messages posted

- 2026-09-14T1612Z next

## Ideas parked

- none

## Contradictions

- Hourly `$inc` happens before the 200 ceiling; `hourly_capacity_reached` still burned a count
- Destination `count` increments even when cooldown denies; reserve decides by `last_decision_token !== this UUID`
- `kind` does not gate `last_reserved_at` / `last_decision_token`
- `_id` is the only uniqueness — no `{ kind, window }` like Sheets, no `{ key_hash, window_start }` like leftover later public throttle
- TTL is `expireAfterSeconds: 0` on `expires_at`; Sheets minute budget TTLs `window_start` at 3600
- Duplicate / disabled skip before reserve
- Default export has no runtime import; the model test constructs the default and does not read `.schema.indexes()`
- Persist tests inject `evaluateGuard` and never ask this getter
- Core Collections and historical `SIDE_EFFECT_COLLECTIONS` name `lead_messages` and omit `lead_message_rate_limits`
- Already-recommended outbound SMS row / leftover later conversation / leftover later public throttle / already-recommended Sheets minute budget are different collections — do not merge
