# DOP-02 completion — domain hooks

Closed 2026-09-06. Repository `vantage-main-server`, branch `daily-operations`.
No commit. No push.

§4 of the issue was re-verified before coding. Hook sites, quiet-hours
constants, zip-miss storage, and “do not hook” sites matched the
coordinator note. The issue was not rewritten; spec won on every shape.

## Hook sites and cards

After-commit only. Every path calls `recordDailyOperationsFact` through
`src/services/dailyOperations/recordDomainFacts.ts`. The writer never
throws. Replays of `executeCanonicalCommandWithPostCommit` already skip
`finalize`.

| Site | Kind | Dedupe | Card |
| --- | --- | --- | --- |
| `completeFormLeadIngestion` after reused-lead return, next to `recordWhatTheOwnerNeedsToKnow` | `form_lead.created` / `.duplicate` | `form_lead:<leadId>:created` or `:duplicate` | name, last4, origin, company, zips/states, `zip_miss` when applicable |
| same, second fact when zip present + state `not_found` / empty | `exception.zip_missing` | `exception:zip_missing:FormLead:<leadId>` | `zip_miss` + exception detail; Lead still counted |
| `completeCallLeadIngestion` (Admin / Best Relocation / RingCentral inner complete) | `call_lead.created` / `.duplicate` / `.unmatched` | `call_lead:<leadId>:created` / `:duplicate` / `:unmatched` | same lead card; Call blank state + zip is a miss |
| `ingestRingCentralQualifiedCall` when adoption `conflict` | `exception.adoption_conflict` | `exception:adoption_conflict:ringcentral:<telephonySessionId>` | exception detail only; no Call Lead volume |
| `submitFormLeadToCrm` HTTP error and network fail | `exception.crm_failed` | `exception:crm_failed:FormLead:<leadId>` | name, last4, `crm_http_<status>` or error message |
| `dispatchPersistedLeadMessage` after Twilio accept | `text.deferred` if `sendAt` applied; else `text.sent` | `message:<id>:deferred` or `:successful` | `card.text` status / deferred / `send_at` ISO; last4 from `to` |
| `recordStatusCallbackEvent` when `applied === true` | `text.sent` on `sent`/`delivered`; `text.failed` on terminal fail | `message:<id>:successful` or `:failed` | no message body |
| `dispatchOrQueuePersistedLeadMessage` skipped path | `text.skipped` | `message:<id>:skipped` | `skip_reason` |
| `finalizeBookedLeadCreateAfterCommit` after populate; skip `kind === "duplicate"` | `booking.created` + `admin` | `booking:<id>:created` | name, last4, job_no, `booking_kind` |
| `submitEmployeeBooking` after `finalizeSheetSync` | linked → `booking.created` + `employee_linked`; pending → `booking.employee_pending` | `booking:<id>:created` | name, last4, job_no |
| `confirmBooking` after `finalizeSheetSync` when `booking_created`; skip replay | `booking.created` + `granot_confirm` | `booking:<id>:created` | job_no from the case |
| `runExistingCreateReferralBooking` finalize | `booking.created` + `referral` | `booking:<id>:created` | name, job_no |
| `runExistingCreateLeadlessBooking` finalize | `booking.created` + `leadless` | `booking:<id>:created` | name, job_no |
| `runExistingCreateCancellation` finalize | `cancellation.created` | `cancellation:<id>:created` | job_no, booking / lead links |
| `confirmCancellation` after `finalizeSheetSync` when `cancellation_created`; skip replay | `cancellation.created` | `cancellation:<id>:created` | cancellation + booking ids |

## Quiet-hours ISO examples

Hold window is midnight–6:59:59 America/New_York. Send-at is 8:00 AM
that same Eastern day (`LEAD_SMS_DEFERRED_SEND_HOUR = 8`).

| Wall clock | Instant used | Fact | `card.text.send_at` |
| --- | --- | --- | --- |
| 02:14 ET on 2026-01-15 | `2026-01-15T07:14:00.000Z` | `text.deferred`; title `Text held until 8:00 AM` | `2026-01-15T13:00:00.000Z` |
| 07:00 ET on 2026-01-15 | `2026-01-15T12:00:00.000Z` | `text.sent` only | none |

`text.deferred` increments `messages.deferred` only. First later
`sent` / `delivered` callback uses `message:<id>:successful` (writer
insert-win is the once-gate).

## Zip-miss fingerprint

```
exception:zip_missing:<leadModel>:<leadId>
```

Example: pickup zip `33101` + state `not_found` on Form Lead
`507f1f77bcf86cd799439011` →
`exception:zip_missing:FormLead:507f1f77bcf86cd799439011`.

The Lead fact still includes `leads.form` / `leads.total` (or Call
headline / unmatched as appropriate). Exception increments
`exceptions.zip_missing` only.

## CRM fail

Reachable in this sitting. Hooked on both fail paths of
`submitFormLeadToCrm` (HTTP error and network error). That is the
`postTheLeadToGranotWhenDue` seam. Test:
`CRM HTTP fail records exception.crm_failed` in
`recordDomainFacts.test.ts`.

## What this issue did not hook

- Granot capture / processor / intake / mint (DOP-03)
- Sheet Sync drain (`runSheetSyncDrain`) — TODO left on sheet-sync
  kinds; `finalizeSheetSync` is not a completion hook
- `applyBestRelocationPlan` (source-search proof)
- `persistLeadMessageIntent` (mid-transaction; source-search proof)
- `ingestRingCentralQualifiedCall` Call Lead volume (complete is the
  single increment)
- HTTP / SSE / cron
- Admin UI
- Knowledge Service body
- Commit or push

## Test sink (in-scope so hooks do not break the suite)

`src/services/dailyOperations/testDailyOperationsSink.ts` is installed
from `scripts/test-setup.ts`. When the sink is active and the caller
did not inject `deps.stores`, `recordDailyOperationsFact` captures the
input and returns `{ outcome: "recorded", event_id: "test", day }`
without Mongo or Redis. DOP-01 unit tests keep injecting stores.

Existing form / call / booking / messaging tests stay green.

## §10 acceptance criteria

| Criterion | Evidence |
| --- | --- |
| Form create increments `leads.form` + origin + company once | `recordDomainFacts.test.ts` — `form_lead.created` touches `leads.form`, `leads.total`, `hourly.leads`, `origins.wordpress_form`, `companies.tbm_leads.form`, `companies.tbm_leads.total` |
| Duplicate Form increments `leads.duplicate_form` only | Same file — touches `["leads.duplicate_form"]` |
| Call unmatched increments `leads.unmatched_call` only | Same file — touches `["leads.unmatched_call"]` |
| 02:14 ET → `text.deferred` + 8:00 AM `send_at`; no `messages.successful` | Same file — `card.text.send_at` `2026-01-15T13:00:00.000Z`; touches `["messages.deferred"]` |
| 07:00 ET send → `text.sent` only | Same file — kinds `["text.sent"]` |
| First `sent`/`delivered` after deferred → `text.sent` once | Same file — both callbacks use `message:<id>:successful` (writer insert-win) |
| Zip `33101` + `not_found` → Lead counts **and** zip miss | Same file — `form_lead.created` includes `leads.total` plus `exception.zip_missing` |
| Replay / reused WordPress / duplicate booking do not count | Reused helper returns with empty sink; `finalizeBookedLeadCreateAfterCommit` returns on `kind === "duplicate"` before the writer; canonical `finalize` already skipped when `replayed` |
| `applyBestRelocationPlan` is not a hook site | Source-search in `recordDomainFacts.test.ts` |
| Focused tests + typecheck | 121 passed (focused set below). `pnpm typecheck` exit 0 |

## Command output

On this Windows runner, `tsx --test src/services/dailyOperations/`
resolves the directory as a module and fails. The equivalent file glob
was used.

```
$ pnpm exec tsx --test src/services/dailyOperations/*.test.ts src/services/leads/formLead.service.test.ts src/services/leads/callLead.service.test.ts src/services/leadMessaging/leadMessaging.service.test.ts src/services/leadMessaging/quietHours.test.ts src/services/crm/crm.service.test.ts src/services/ringcentral/ringcentral-call-lead-ingest.service.test.ts src/services/domainCommands/domainCommands.test.ts
ℹ tests 121
ℹ suites 0
ℹ pass 121
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 6124.6849
```

Expected pino `warn` / `error` lines: Redis XADD swallow (DOP-01), CRM
fail, lead-messaging contained dispatch failures. No Mongo opened for
Daily Operations.

```
$ pnpm typecheck

> vantage_movers_server@1.0.0 typecheck C:\Users\Pinda\Proyectos\vantage\vantage-main-server
> tsc --noEmit
```

Exit 0.
