# Session story-lead-messaging-lead-messaging-2026-08-28T0830Z

- Date (UTC): 2026-08-28T08:30Z
- Service / module: `leadMessaging` / `leadMessaging.service.ts`
- Lock: taken
- Branch / PR: `docs/story-refactor` / (open after #87 merged)

## Stock at start

- Wave: A
- Visited / in-progress / unvisited: 15 / 0 / 23
- Recommendations on disk: 84
- Current service / next module (TRAVERSAL): `leadMessaging` (unvisited) / enumerate `src/services/leadMessaging/` first

## This pass

- opened new service?: yes — enumerated `leadMessaging.service.ts`, `granotCreatedLead.ts`, `leadMessagingQueue.service.ts`, `twilioAdapter.ts`, `quietHours.ts`, `messageBuilder.ts`, `twilioVoice.ts`, `index.ts`
- path or skip: recommended → `recommendations/lead-messaging-lead-messaging.md`
- operations named: remember the outbound confirmation SMS; send it or wake the drain; claim and send through Twilio; drain due messages; accept Twilio’s later word; owner browse and retry
- remaining in this service: `granotCreatedLead.ts`, `leadMessagingQueue.service.ts`, `twilioAdapter.ts`

## Stock at end

- Visited / in-progress / unvisited: 15 / 1 / 22
- Current service / next module: `leadMessaging` (in-progress) / `granotCreatedLead.ts`

## Messages posted

- 2026-08-28T0830Z next-run

## Ideas parked

- none

## Contradictions

- Exported `shouldApplyTwilioStatus` is not the live callback rank
- After-commit containment can return `failed` while the row is still in-flight
- Disabled at send time leaves a `pending` row
- Hourly capacity increments before the skip
- Owner events always `entity.type: "form_lead"`
- Owner list filters `form_lead` as a raw string
- Quiet hours is Message Scheduling, not a drain delay
- `CONTEXT.md` does not define Lead Message
