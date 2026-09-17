# RingCentral capability — agent summary

**Status:** historical live probe. Portable for agents. Not a fresh production grant.  
**As of:** 2026-09-14T21:16:36.160Z (capability + messaging). Rep-nudge follow-up 2026-09-14T21:47:21.744Z. User directory 2026-09-15T18:37:24.005Z.  
**Mode:** read-only. Those scripts did not send SMS or Team Messaging, create or delete subscriptions, download recording audio, write Leads, or move the Call Log cursor.  
**Account:** RingCentral RingEX Advanced™. JWT authenticates as one Enabled `User` extension (`62948571023`). It cannot act as each Sales Rep.

`scripts/dev_ops/**` is gitignored. This file is the in-repo copy. Raw dumps stay under `scripts/dev_ops/ringcentral/output/` on a machine that has them. Do not paste credentials, phone values, chat names, or recording bytes here.

Roster and proposed Agent/Granot matches: [User directory snapshot](../backfill_assistance/agent_ring_central_account_connections_possible.md). Webhook filter proof: [08 §2.1](../08-intelligence-envelope-handoff.md). Product rules stay in [01](../01-specification.md) and [03](../03-server-pipeline-and-jobs.md).

---

## 1. How to use this

1. **Treat denied or missing as unknown coverage, never as zero sales work.** No recording grant ≠ no calls. Empty subscription list ≠ no other-app subscriptions. Analytics with 0 rows in a 24-hour window ≠ no traffic.
2. **Do not claim current production permission from these dates.** Team F re-probes at G6. Recording content was denied on Sept 14; implement honest `permission_denied` / Coverage states now.
3. **Do not re-run live probes, create subscriptions, backfill, or send messages** to finish a task unless that task explicitly authorizes it.
4. **Call Qualification stays closed.** Inbound, mapped RingCentral Inbound Number, answered, ≥ 120 s, caller phone present. `ingestRingCentralQualifiedCall` is never widened and never imported by new modules. All-direction capture is a second worker with its own cursor and lease.
5. **RingSense / ACE are out of scope.** Token has the `RingSense` app scope; the PBX records call 404s (`AGW-404`) and `ReadRingSenseInsights` is denied. Path is our media fetch + STT + extract.

Refresh (local, read-only):

```bash
node --env-file=.env ./node_modules/tsx/dist/cli.mjs \
  scripts/dev_ops/ringcentral/ringcentral-capability-proof.ts
```

Same-day companions: `ringcentral-messaging-readiness.ts`, `ringcentral-rep-nudge-readiness.ts`, `ringcentral-list-user-directory.ts`.

---

## 2. What CSI will use vs leave alone

Usage labels are from the Sept 14 proof (`will_use` / `have_unused` / `want_missing` / `must_not_mutate`). Owner Rep Nudge later uses Team Messaging; that is an explicit Owner command, not Number Activity.

| Family | Verdict | What it means for implementation |
| --- | --- | --- |
| directory | **will use** | Account, 53 extensions (24 User / 23 Department / 3 Voicemail / 1 IvrMenu / 1 Announcement / 1 CompanyExtension), 61 company numbers, 23 call queues. Store every User. Non-User rows are hygiene / Contact Number `kind`, not Rep Identity Link targets. |
| call_log | **will use** | Account Detailed Call Log `view=Detailed` works. Authoritative all-direction history. Qualification cron stays inbound-only. Heavy endpoint; share the JWT and honor 429. |
| analytics | **will use** | Aggregation fetch works. Provider counters only. Must not mint Call Leads. |
| webhooks | **will use** | `GET /subscription` works; **0 subscriptions visible to this app**. Token has `SubscriptionWebhook`. Later CSI-03 adds account-wide telephony sessions (`/restapi/v1.0/account/~/telephony/sessions`), not inbound-only. There is no Call Log change webhook. Empty list does not prove other apps have none. Do not create a production subscription from a team task. |
| recordings | **will use, content denied** | Settings and extension coverage GETs work (46 recording extensions). App scopes `ReadCallRecording` / `ReadCallLog` are present. User permissions `ReadCallRecording` and `ReadCompanyCallRecording` are **denied**. Proof did not download audio. Implement discovery + delayed 404 + `unavailable:permission_denied`; do not pretend media exists. |
| presence | **will use later** | Account and own-extension presence GETs work. Not CSI v1 Attention. Presence/Live never proves complete history. |
| ringsense | **want / missing** | 404 `AGW-404`. No ACE/RingSense features on the plan. Do not enable. |
| team_messaging | **have; send unused in proof** | Lists chats this JWT belongs to: 11 (8 Direct, 1 Team, 1 Everyone, 1 Personal). Persons list 404s. Preferred Owner Rep Nudge path after a reviewed Rep Identity Link. Sends as this JWT user, not as the rep. Proof did not post. |
| sms | **have; send unused** | `SMS` + `ReadMessages` on token. JWT extension has 1 SmsSender DID (34 numbers on that extension). Company-level phone list reported 0 SmsSender features — that list is not the send proof. Per-extension Sept 14 probe: SmsSender on all 24 User DIDs. SMS is phone-to-phone from the JWT DID, not an extension inbox, never the customer, never a Number Activity side effect. |
| messages / pager | **have unused** | Own-extension voicemail and SMS stores readable. `InternalMessages` on token; company pager targets extension numbers. Optional nudge fallback only when configured. |
| a2p_sms / fax / contacts | **have unused** | Readable. Not a CSI v1 channel. |
| call_control | **must not mutate** | `CallControl` is on the token. Active telephony session list 404ed (`AGW-404`). Hangup, barge, transfer, record-start are out of scope. |

---

## 3. Token vs user permission

All wanted **app scopes** are on the token: `ReadCallLog`, `ReadCallRecording`, `ReadAccounts`, `Analytics`, `SubscriptionWebhook`, `RingSense`, `SMS`, `ReadMessages`. Extra scopes also present (do not treat as product permission): `A2PSMS`, `CallControl`, `Contacts`, `EditExtensions`, `EditMessages`, `EditPresence`, `Faxes`, `InternalMessages`, `ReadAuditTrail`, `ReadContacts`, `ReadPresence`, `RingOut`, `RoleManagement`, `TeamMessaging`, `Video`, `VoipCalling`, `SubscriptionWebSocket`, `WebSocket`.

User-permission checks (`GET .../authz-profile/check`) are the grant that matters for media:

| Permission | Successful |
| --- | --- |
| ReadCompanyCallLog | yes |
| ReadCallLog | yes |
| ReadCompanyCallRecording | **no** |
| ReadCallRecording | **no** |
| ReadRingSenseInsights | **no** |

HTTP 200 on those check calls means the authz endpoint answered, not that the permission is granted.

---

## 4. Endpoint probes (Sept 14)

| Family | Probe | Result | Notes |
| --- | --- | --- | --- |
| directory | `GET /account/~` | 200 | Account id present (omitted) |
| directory | `GET /account/~/extension?perPage=100` | 200 | 53 records; 24 User |
| directory | `GET /account/~/phone-number?perPage=100` | 200 | 61 numbers; SmsSender feature count 0 on this list |
| directory | `GET /account/~/call-queues` | 200 | 23 |
| sms | `GET /extension/~/phone-number` | 200 | 34 numbers; 1 SmsSender on the JWT extension |
| call_log | `GET /account/~/call-log?view=Detailed&perPage=1` | 200 | 1 row in the 24h window |
| analytics | `POST /analytics/calls/v1/accounts/~/aggregation/fetch` | 200 | 0 rows that window; still usable |
| webhooks | `GET /subscription` | 200 | 0 visible to this app |
| recordings | `GET /account/~/call-recording` | 200 | Settings readable |
| recordings | `GET /account/~/call-recording/extensions` | 200 | 46 extensions |
| presence | `GET /account/~/presence` and own extension | 200 | |
| ringsense | `GET /ai/ringsense/v1/public/accounts/~/domains/pbx/records` | **404 AGW-404** | |
| messages | own VoiceMail / SMS / Fax stores | 200 | JWT mailbox only |
| team_messaging | `GET /team-messaging/v1/chats` | 200 | 11 chats; names omitted |
| team_messaging | `GET /glip/chats` | 200 | Legacy list also works |
| a2p_sms | `GET /account/~/a2p-sms/opt-outs` | 200 | |
| call_control | `GET /account/~/telephony/sessions` | **404 AGW-404** | Read list only; do not mutate |
| contacts | address-book contact page | 200 | |

---

## 5. Messaging and Owner Rep Nudge

Capability-proof headline: this JWT can list Team Messaging chats and has SMS plus one SmsSender DID. It still authenticates as one User extension, so it cannot send as each Sales Rep. A later explicit nudge can post into chats this JWT user belongs to. The proof did not send.

Messaging-readiness (same day, still no send):

- `can_send_from_this_jwt`: true as the JWT User, to a phone number, not into another extension inbox.
- 11 chats visible; 8 Direct.
- `can_impersonate_each_rep`: false.
- Recommended path: Team Messaging post from this JWT user into a Direct or Team chat after a **reviewed** Rep Identity Link.

Rep-nudge-readiness (same day):

- 24 User extensions; all 24 number reads ok; all 24 have at least one DID; all 24 have SmsSender on the per-extension read.
- Pager store readable. `InternalMessages` on the token. Pager POST was not sent.
- 8 Direct chats, each with another member.

Product rules already settled: Team Messaging is primary; SMS-to-rep-DID and company pager are optional and default off; never the customer; never automatic; never from a model tool. `proposed` identity is not enough. Re-resolve the chat on send; do not persist Team Messaging person ids from a 404 persons list.

---

## 6. What Number Activity must not do

- Widen Call Qualification or mint Call Leads from analytics, presence, or unfiltered telephony.
- Send SMS, Team Messaging, fax, A2P, or pager as a capture/reconcile side effect.
- Hang up, barge, or transfer live calls.
- Use `withRecordings=true` as the account telephony filter (drops missed/unrecorded traffic Attention needs).
- Treat a missing permission, empty page, or RingSense 404 as zero performance.
- Mark a Rep Identity Link `reviewed` from a name match.

---

## 7. Still open at deployment (G6)

These were true on Sept 14–15 and are **not** re-verified by this document:

- Recording-read user grant (historically denied).
- Actual subscriptions and who renews them.
- Reviewed Agent ↔ extension links (directory snapshot exists; links do not).
- Live send proof for Team Messaging / optional SMS / pager.
- Production backfill window and cursor ownership.

A code-complete Preview can ship behind flags without claiming any of the above passed.
