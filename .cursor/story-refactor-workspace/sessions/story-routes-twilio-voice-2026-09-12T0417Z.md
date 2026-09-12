# Session story-routes-twilio-voice-2026-09-12T0417Z

- Date (UTC): 2026-09-12
- Service / module: `routes` / `twilio-voice.routes.ts`
- Lock: taken
- Branch / PR: `docs/story-refactor` / https://github.com/jbell-rusty-vantage/vantage-movers-server/pull/206

## Stock at start

- Wave: B (`src/routes/` in-progress)
- Visited / in-progress / unvisited: 42 / 1 / 5
- Recommendations on disk: 328 (through `routes-twilio-message-status.md`)
- Current service / next module (TRAVERSAL): `routes` (in-progress) / `twilio-voice.routes.ts`

## This pass

- opened new service?: no
- path or skip: recommended → `recommendations/routes-twilio-voice.md`
- operations named: after Twilio's signature proves this voice post is theirs, Dial the RingCentral number we already chose, remember progress, then hang up when the forward completes — never forward a number that is not ours, never stamp a Lead Message, never ingest a Call Lead, never use the API secret or the cron secret
- remaining in this service: `ringcentral-cron.routes.ts` then the rest of the Wave B routes checklist

## Stock at end

- Visited / in-progress / unvisited: 42 / 1 / 5
- Current service / next module: `routes` (in-progress) / `ringcentral-cron.routes.ts`

## Messages posted

- 2026-09-12T0417Z next

## Ideas parked

- Destination fence is inbound-only. Progress/completed `To` is leftover RingCentral `forwardTo`.
- Inbound 200 Dial / progress 204 / completed 200 Hangup are not leftover SMS 404 / 204.
- `stringParams` is a copy of already-recommended leftover SMS status.
- Letters live on this router (`twilio.voice.*`); leftover SMS letters live on leftover apply.
- Inbound letter details keep raw phones; unexpected-destination warn masks `To`.
- Leftover `recordOperationalEvent` never throws; this router has no try/catch around letters.
- No factory inject and no `twilio-voice.routes.test.ts`.
- Host unguarded table and operator skill omit `/api/webhooks/twilio/voice*`.
- Cloud seed booted on `cursor/*`; disk on `docs/story-refactor` won.

## Contradictions

- Host unguarded table / hit-vantage-api omit `/api/webhooks/twilio/voice*`
- Inbound letter details unmask phones vs unexpected-destination warn masks `To`
- Destination fence inbound-only vs progress/completed `To` = leftover RingCentral
- 200 Dial / 204 progress / 200 Hangup vs leftover SMS 404 / 204
- Duplicated `stringParams` vs already-recommended leftover SMS status
