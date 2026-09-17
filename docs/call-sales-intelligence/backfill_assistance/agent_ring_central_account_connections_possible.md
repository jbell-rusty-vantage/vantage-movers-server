# RingCentral User directory and Agent / Granot chain

**Status:** live snapshot. Store every User extension. Do not write reviewed Rep Identity Links yet.  
**Taken at:** 2026-09-15T18:37:24.005Z  
**Account JWT User:** Russell Ingram · ext `101` · extension id `62948571023`

This is the portable record of the RingEX User roster and a first-pass name map onto canonical Agents and Granot usernames. Explicit linking waits until `RepIdentityLink` and `RingCentralDirectorySnapshot` are implemented. Ambiguous rows stay unmatched until the Owner reviews them.

`scripts/dev_ops/**` is gitignored. Copy this file out if the transfer is via git.

Related:

- Spec term **Rep Identity Link** — `docs/call-sales-intelligence/01-specification.md`
- Model — `docs/call-sales-intelligence/02-domain-models.md` §8–9
- Agent model — `src/models/Agent.ts`
- Refresh script — `scripts/dev_ops/ringcentral/ringcentral-list-user-directory.ts`
- Raw dump — `scripts/dev_ops/ringcentral/output/user-directory.json`
- Canvas (same facts, less portable) — workspace `canvases/rc-agent-identity-chain.canvas.tsx`

---

## 1. Decision

1. **Store all 24 RingEX User extensions** in the directory snapshot when that collection exists: name, extension id, extension number, status, email, department, every DirectNumber DID.
2. **Do not invent a reviewed link.** A name match is a proposal only. `proposed` never satisfies a nudge or a rep metric.
3. **Ambiguous matching is later.** Jason / Benjamin on ext 121, the two Tylers, and every User with no Agent stay unmatched until an Owner command.

A RingEX User is a phone-directory person (DID + extension + mailbox). An Agent is the sales roster person who can take binder credit. A Granot username is the CRM `user` / `rep` login. Those three are different objects. The link is the reviewed map, not any one of the names.

---

## 2. How this was pulled

Sept 11, 2026 the Owner pasted the RingEX Users admin page (24 rows: name, number, ext, license, role, department, mailbox). Later capability proofs (`ringcentral-capability-proof.ts`, `ringcentral-rep-nudge-readiness.ts`) counted those 24 Users and omitted names.

This snapshot is live API, not that paste:

| Call                   | Path                                                   | Result                              |
| ---------------------- | ------------------------------------------------------ | ----------------------------------- |
| JWT extension          | `GET /restapi/v1.0/account/~/extension/~`              | Russell Ingram, ext 101             |
| Directory              | `GET /restapi/v1.0/account/~/extension?perPage=100`    | 53 extensions, 24 `type=User`       |
| Numbers                | `GET /restapi/v1.0/account/~/phone-number?perPage=100` | joined to Users by `extension.id`   |
| Team Messaging persons | `GET /team-messaging/v1/persons`                       | **404** — no list endpoint          |
| Team Messaging chats   | `GET /team-messaging/v1/chats`                         | 8 Direct chats; not joined to Users |

Agents and Granot usernames came from production `agents` in `vantagemovers` the same day.

Refresh:

```bash
node --env-file=.env ./node_modules/tsx/dist/cli.mjs \
  scripts/dev_ops/ringcentral/ringcentral-list-user-directory.ts
```

---

## 3. Channel on each User

For this roster, **channel** means the RingEX identity we can later target, not a Team Messaging room name.

| Channel                             | What to store         | Notes                                                                        |
| ----------------------------------- | --------------------- | ---------------------------------------------------------------------------- |
| Extension number                    | `rc_extension_number` | Company pager target. Unique on this account.                                |
| Extension id                        | `rc_extension_id`     | Stable RingCentral id. This is the link key.                                 |
| DirectNumber DID                    | `rc_direct_numbers[]` | Voice / SMS-to-rep destination. E.164.                                       |
| Email                               | contact email         | Join hint only. Not an identity.                                             |
| Team Messaging person / Direct chat | not stored yet        | Persons list 404. Eight Direct chats exist for this JWT. Re-resolve on send. |

The Sept 14 per-extension probe found `SmsSender` on all 24 User DIDs. This company-level phone-number list did not return that feature flag. Treat SmsSender as previously proven, re-read per extension when the directory job lands.

The JWT cannot send _as_ each Sales Rep. A later Owner Rep Nudge sends as Russell Ingram (this integration User) into a mapped Agent’s chat, pager, or DID.

---

## 4. Live User directory (store all)

All 24 are `Enabled`. `usageType` on every listed DID is `DirectNumber`. Sean K and Tyler S have two DIDs; store both.

| RingEX User    | Ext | Extension id  | DID                            | Email                               | Department       |
| -------------- | --- | ------------- | ------------------------------ | ----------------------------------- | ---------------- |
| Alix S         | 229 | `63423009023` | `+15613371286`                 | alix@vantagehomemovers.com          |                  |
| Angel Lee      | 117 | `63207088023` | `+15614676183`                 | angel@vantagehomemovers.com         |                  |
| Austin G       | 224 | `63407260023` | `+15612023987`                 | austin@vantagehomemovers.com        | Sales            |
| Benjamin Z     | 121 | `63212075023` | `+15612107519`                 | ben@vantagehomemovers.com           | Customer Service |
| Brian Horowitz | 231 | `63458709023` | `+15612375332`                 | brianh@vantagehomemovers.com        |                  |
| Daniel J       | 219 | `63365606023` | `+15613961536`                 | daniel@vantage.com                  | QA               |
| Dyanna K       | 202 | `585247022`   | `+15612105674`                 | dyannak@vantagehomemovers.com       |                  |
| Dylan B        | 221 | `624461022`   | `+15618809569`                 | dylan@vantagehomemovers.com         |                  |
| Emel C         | 214 | `63308178023` | `+15613961460`                 | emelc@vantagehomemovers.com         |                  |
| Gary E         | 114 | `63202491023` | `+15616802745`                 | garye@vantagehomemovers.com         |                  |
| Hung L         | 225 | `63413358023` | `+15617058085`                 | autotransport@vantagehomemovers.com |                  |
| Jacob B        | 230 | `63457573023` | `+15617177994`                 | jacobq@vantagehomemovers.com        |                  |
| Jenna R        | 232 | `63520931023` | `+15618075152`                 | jenna@vantagehomemovers.com         |                  |
| Joshua L       | 220 | `63398154023` | `+15612063510`                 | joshua@vantagehomemovers.com        |                  |
| Kyle M         | 141 | `584528022`   | `+15612107601`                 | kylem@vantagehomemovers.com         |                  |
| Mike M         | 216 | `63337692023` | `+15612378584`                 | mikem@vantagehomemovers.com         |                  |
| Nick J         | 234 | `676980022`   | `+15618079307`                 | nick@vantagehomemovers.com          |                  |
| Patrick O      | 228 | `639486022`   | `+15614196052`                 | patricko@vantagehomemovers.com      |                  |
| Roy W          | 111 | `63202163023` | `+15618493787`                 | roy@vantagehomemovers.com           |                  |
| Russell Ingram | 101 | `62948571023` | `+15613371448`                 | ringram@vantagehomemovers.com       | JWT / owner      |
| Sean K         | 206 | `63275297023` | `+15612085320`, `+15612096994` | seank@vantagehomemovers.com         |                  |
| Sonia C        | 233 | `63523288023` | `+15616178992`                 | sonia@vantagehomemovers.com         |                  |
| Tyler D        | 209 | `63296320023` | `+15615607631`                 | tylerd@vantagehomemovers.com        |                  |
| Tyler S        | 129 | `63235990023` | `+15613374371`, `+15612105794` | tylers@vantagehomemovers.com        |                  |

Job title when present: Austin G = Moving Coordinator. Daniel J = Quality Assurance Specialist.

---

## 5. Proposed unique chain (not reviewed)

First-token or known alias, one Agent per User. Safe to _propose_ after models exist. Not safe to mark `reviewed`.

| Agent   | Granot username | RingEX User    | Ext | DID                            | Why unique                                  |
| ------- | --------------- | -------------- | --- | ------------------------------ | ------------------------------------------- |
| Austin  | AUSTIN          | Austin G       | 224 | `+15612023987`                 | Exact first token. RC department Sales.     |
| Brian   | BRIAN           | Brian Horowitz | 231 | `+15612375332`                 | Exact first token. Email `brianh@`.         |
| Dylan   | DYLAN           | Dylan B        | 221 | `+15618809569`                 | Exact first token.                          |
| Jacob   | JACOB           | Jacob B        | 230 | `+15617177994`                 | Exact first token.                          |
| Jenna   | JENNA           | Jenna R        | 232 | `+15618075152`                 | Exact first token.                          |
| Josh    | JOSH            | Joshua L       | 220 | `+15612063510`                 | Josh ↔ Joshua. Only Joshua on the account.  |
| Mike    | MIKEM           | Mike M         | 216 | `+15612378584`                 | Exact first token. Granot login `MIKEM`.    |
| Nick    | NICK            | Nick J         | 234 | `+15618079307`                 | Exact first token.                          |
| Patrick | PATRICKO        | Patrick O      | 228 | `+15614196052`                 | Exact first token. Granot login `PATRICKO`. |
| Roys    | ROY             | Roy W          | 111 | `+15618493787`                 | Roys ↔ Roy. Only Roy. Granot login `ROY`.   |
| Sean    | SEAN            | Sean K         | 206 | `+15612085320`, `+15612096994` | Exact first token. Store both DIDs.         |

Granot username on these Agents is verified (`granot_identity.verified = true`) except where noted in §7.

---

## 6. Ambiguous — do not auto-link

### Jason / Benjamin (ext 121)

| When                | RingEX name | Ext | DID            | Department       |
| ------------------- | ----------- | --- | -------------- | ---------------- |
| Sept 11 Owner paste | Jason L     | 121 | `+15612107519` | Sales            |
| Sept 15 live API    | Benjamin Z  | 121 | `+15612107519` | Customer Service |

Agent **Jason** / Granot `JASON` is still active. The extension was reassigned; the DID did not change. A directory snapshot must keep Benjamin Z as the current User. A Rep Identity Link for Jason must not be minted from first-token history.

### Two Tylers, no Tyler Agent

| RingEX User | Ext | DID                            |
| ----------- | --- | ------------------------------ |
| Tyler D     | 209 | `+15615607631`                 |
| Tyler S     | 129 | `+15613374371`, `+15612105794` |

No Agent named Tyler. First-token match is impossible.

---

## 7. Unlinked on each side

### RingEX Users with no Agent

Alix S, Angel Lee, Benjamin Z, Daniel J (QA), Dyanna K, Emel C, Gary E, Hung L (`autotransport@…`), Kyle M, Russell Ingram (JWT / owner), Sonia C, Tyler D, Tyler S.

When `role_kind` exists, these are the candidates for `service`, `manager`, `dialer`, `shared`, or `excluded` — Owner-set, not inferred from a blank RC department.

### Agents with no current RingEX User

| Agent  | Active | Granot username  | Gap                                             |
| ------ | ------ | ---------------- | ----------------------------------------------- |
| Sil    | yes    | SIL (verified)   | No User                                         |
| House  | yes    | none             | No User, no Granot username                     |
| Jason  | yes    | JASON (verified) | No current User name. Ext 121 is now Benjamin Z |
| Chris  | no     | none             | No User                                         |
| JV     | no     | none             | No User                                         |
| John V | no     | none             | No User                                         |
| Manny  | no     | none             | No User                                         |
| Pierre | no     | none             | No User                                         |
| Ted    | no     | none             | No User                                         |

---

## 8. What is not a User

The same directory call returned 29 non-User extensions (queues, IVR, voicemail, announcement, company). Store them on the directory snapshot for Contact Number `kind` and hygiene. They are not Rep Identity Link targets.

| Type                | Count | Examples                                                                                                                  |
| ------------------- | ----- | ------------------------------------------------------------------------------------------------------------------------- |
| Department (queues) | 23    | Paid Inbound Overflow 509, CSR Queue 500, EQ Inbounds 503, QR Inbounds 504, Dialer Calls 506, BestRelocation Inbounds 525 |
| Voicemail           | 3     | Inbound Leads VM, CSR VM, Main VM (NotActivated)                                                                          |
| IvrMenu             | 1     | 877 IVR 1001                                                                                                              |
| Announcement        | 1     | Main number announcement                                                                                                  |
| CompanyExtension    | 1     | Company                                                                                                                   |

Full list is in `output/user-directory.json` under `non_user_extensions`.

---

## 9. After the domain models exist

1. Directory cron writes one `ringcentral_directory_snapshots` doc from the same two GETs (extensions + phone numbers). Digest-skip if unchanged.
2. Every User row above is in that snapshot. No filter to “likely sales.”
3. A separate Owner command creates `rep_identity_links`. Start from §5 as `proposed` if you want a helper; `reviewed` is never automatic.
4. Resolve §6 in that command, not in the snapshot job.
5. Nudge and rep metrics require `status = reviewed`, `effective_to = null`, `role_kind = sales_rep`.
