# RingCentral API families

Official hubs:

- Guide: https://developers.ringcentral.com/guide
- API Reference (OpenAPI 3.0, Try it out): https://developers.ringcentral.com/api-reference
- URI conventions (`~`, query params, HTTP methods): https://developers.ringcentral.com/guide/basics/uris

`ringCentralRequest` takes the path only (`/restapi/v1.0/...` or `/analytics/...` or `/ai/...`). The client prefixes `RC_SERVER_URL`.

## Used in vantage-main-server

### OAuth / JWT

- Guide: https://developers.ringcentral.com/guide/authentication/jwt-flow
- Authorize (3-legged, unused here): https://developers.ringcentral.com/api-reference/authentication
- Token: `POST /restapi/oauth/token`
  - JWT: `grant_type=urn:ietf:params:oauth:grant-type:jwt-bearer`, form field `assertion`
  - Refresh: `grant_type=refresh_token`
- JWT is a credential to obtain an access token. Do not send the JWT as `Authorization: Bearer`.
- Common scopes this repo cares about: `CallLog` / `ReadCallLog`, `ReadCallRecording` / `ReadCompanyCallRecording`, `Analytics`, `RingSense`, account/extension read.

### Account directory

Guide entry: https://developers.ringcentral.com/guide (Account / Voice sections). API Reference search: Account, Extension, Phone Number, Call Queue.

| Method | Path | Why we hit it |
|--------|------|----------------|
| GET | `/restapi/v1.0/account/~` | Account id / name |
| GET | `/restapi/v1.0/account/~/extension/~` | JWT user / extension |
| GET | `/restapi/v1.0/account/~/extension` | List extensions / queues |
| GET | `/restapi/v1.0/account/~/phone-number` | Company numbers |
| GET | `/restapi/v1.0/account/~/call-queues` | Queue names / extension numbers |
| GET | `/restapi/v1.0/account/~/extension/~/address-book/contact` | Diagnose-only |

### Call Log (Voice history)

- Guide: https://developers.ringcentral.com/guide/voice/call-log
- API Reference: https://developers.ringcentral.com/api-reference/Call-Log
- Single record example: https://developers.ringcentral.com/api-reference/Call-Log/readUserCallRecord

| Method | Path |
|--------|------|
| GET | `/restapi/v1.0/account/~/call-log` |
| GET | `/restapi/v1.0/account/~/call-log/{callLogId}?view=Detailed` |
| GET | `/restapi/v1.0/account/~/extension/~/call-log` |

Useful query params: `dateFrom`, `dateTo`, `direction` (`Inbound` \| `Outbound`), `type` (`Voice`), `view` (`Simple` \| `Detailed`), `phoneNumber`, `page`, `perPage`, `recordingType`.

Permission: `ReadCallLog`. Account-level log needs company Call Log access (diagnose script checks this). Records include `id`, `sessionId`, `telephonySessionId`, `startTime`, `duration`, `result`, `from` / `to`, optional `recording`, and `legs` when `view=Detailed`.

Lag: 15–30s after hangup before the record is queryable.

### Recordings

- Guide: https://developers.ringcentral.com/guide/voice/call-log/recordings
- Settings list: https://developers.ringcentral.com/api-reference/Call-Recording-Settings/listCallRecordingExtensions

| Method | Path |
|--------|------|
| GET | `/restapi/v1.0/account/~/call-recording` |
| GET | `/restapi/v1.0/account/~/call-recording/extensions` |
| GET | `/restapi/v1.0/account/~/recording/{recordingId}` |
| GET | `/restapi/v1.0/account/~/recording/{recordingId}/content` |

Metadata JSON is fine through `ringCentralRequest`. Audio: `GET` the `contentUri` (often `media.ringcentral.com`) with a Bearer token. Permission: `ReadCallRecording` / `ReadCompanyCallRecording`.

### Subscriptions / webhooks

- Create webhooks: https://developers.ringcentral.com/guide/notifications/webhooks/creating-webhooks
- Create subscription: https://developers.ringcentral.com/api-reference/Subscriptions/createSubscription

| Method | Path |
|--------|------|
| GET | `/restapi/v1.0/subscription` |
| POST | `/restapi/v1.0/subscription` |
| DELETE | `/restapi/v1.0/subscription/{id}` |

`POST` body:

```json
{
  "eventFilters": ["/restapi/v1.0/account/~/telephony/sessions?direction=Inbound"],
  "deliveryMode": { "transportType": "WebHook", "address": "https://host/api/webhooks/ringcentral" }
}
```

RingCentral validates the URL with a `Validation-Token` header that the handler must echo. HTTPS only. Subscriptions expire and need renewal (`PUT` also renews). Runtime capture: `POST /api/webhooks/ringcentral`.

### Telephony session events

- Guide: https://developers.ringcentral.com/guide/voice/telephony-session-notifications
- Event filter (account): `/restapi/v1.0/account/~/telephony/sessions`
- Optional: `?direction=Inbound`, `?phoneNumber=`
- Extension-scoped filter also exists: `/restapi/v1.0/account/~/extension/~/telephony/sessions`

These events are live party/session state. They are **not** Call Log records. Vantage aggregates them, then qualifies; cron Call Log is the timing safety net.

Call Control (supervise, hangup, start recording on a live party) is a different family — see unused APIs below.

### Call Analytics

- Quick start: https://developers.ringcentral.com/guide/analytics/quick-start
- API Reference: https://developers.ringcentral.com/api-reference/analytics

`POST /analytics/calls/v1/accounts/~/aggregation/fetch?page=1&perPage=200`

Body shape this repo uses: `grouping.groupBy` (`CompanyNumbers`), `timeSettings.timeRange`, `callFilters` (`directions`, `callResponses`, `callDuration`, `calledNumbers`), `responseOptions.counters` / `timers`.

`timeTo` must not be in the future (ANL-302) — trim with the analytics end buffer. Window max is documented as 184 days. Permission: `Analytics`. Output is grouped counters, not per-caller leads.

### RingSense / AI Conversation Expert

- Product API page: https://developers.ringcentral.com/ringsense-api
- Get insights: https://developers.ringcentral.com/api-reference/AI-Conversation-Expert/getRecordingInsights
- Event filters: https://developers.ringcentral.com/guide/notifications/event-filters/ace-event-filter

| Method | Path |
|--------|------|
| GET | `/ai/ringsense/v1/public/accounts/~/domains/pbx/records` |
| GET | `/ai/ringsense/v1/public/accounts/~/domains/pbx/records/{sourceRecordId}/insights` |

`domain` for RingEX voice is `pbx`. `sourceRecordId` is the Call Log recording id. Optional `insightTypes`: `Transcript`, `Summary`, `Highlights`, `NextSteps`, … Permission: `RingSense` plus company recording read.

Production ingest does not call this. Probes must not print transcript text unless the user asked.

## Other RingEX families (not used in this repo)

Still official; do not add them to runtime unless requested. Explore with a script if the user asks.

| Family | Guide / reference | Typical prefix |
|--------|-------------------|----------------|
| SMS & Fax | https://developers.ringcentral.com/guide (Messaging / Fax) | `/restapi/v1.0/account/~/extension/~/sms`, `.../fax`, `.../message-store` |
| Team Messaging (Glip) | Guide → Team messaging | `/team-messaging/v1/...` |
| Video / Meetings | Guide → Meetings | `/rcvideo/...` |
| Webinar | Guide → Webinar | `/webinar/...` |
| Presence | API Reference → Presence | `/restapi/v1.0/account/~/extension/~/presence` |
| Call Control (live call) | https://developers.ringcentral.com/guide/voice (active calls) | `/restapi/v1.0/account/~/telephony/sessions/{id}/...` |
| Address book | API Reference → Contacts | `/restapi/v1.0/account/~/extension/~/address-book` |
| High Volume SMS | Guide → SMS | separate HV SMS APIs |

Voicemail listings this repo has probed: `GET /restapi/v1.0/account/~/extension/~/message-store?messageType=VoiceMail`.

## Permissions cheat sheet

| Need | App scope (typical) |
|------|---------------------|
| Account Call Log | `ReadCallLog` + company-level access |
| Recording metadata / audio | `ReadCallRecording` or `ReadCompanyCallRecording` |
| Analytics aggregates | `Analytics` |
| RingSense insights | `RingSense` |
| Create webhooks | Subscription write + the scopes for each event filter |

If diagnose says auth works but Call Log or recordings 403, the JWT user's permissions are narrower than the app scopes. Fix in the RingCentral Admin / Developer Console, not in code.
