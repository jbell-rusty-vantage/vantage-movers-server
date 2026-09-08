# DOP-03 completion — Granot hooks

Closed 2026-09-06. Repository `vantage-main-server`, branch `daily-operations`.
No commit. No push.

§4 of the issue was re-verified before coding. Capture persists then
returns `{ receipt_id }`. Channel capture is a separate function.
`createLeadFromGranot` / `synchronizeLeadFromGranot` finalize after
`executeCanonicalCommandWithPostCommit`. `logProcessingCompletion` is
the observe / pending / unmatched seam. `reconcilePreparedObservation`
emits `granot_lifecycle.booking_case.opened` / `.refreshed` after the
transaction. Dead letter enters in `drainer.ts` next to
`granot_lifecycle.dead_letter.entered`.

## Booked vs Release classification (capture vs process)

Reuse `normalizeBookingAction` from `normalization.ts` via
`classifyGranotBookingActionFromPayload`. Tokens: `Booked` / `booked`,
`Release` / `release` / `Releas`. Reads top-level `event_type`, then
`granot_statement.event_type`.

| Capture payload | Receipt kind | Receipt touches | Process intake |
| --- | --- | --- | --- |
| `booking_status_changed` + Booked | `granot.booked` | class + `webhooks.booked` + hourly | `intakes.opened` / `.refreshed` only |
| `booking_status_changed` + Release | `granot.release` | class + `webhooks.release` + hourly | intake only |
| `booking_status_changed`, no action | class increment only (`webhooks.booking_status_changed` + hourly). Closed catalog has no unclassified receipt kind; the card stores `booking_action: null` and title `Granot booking status changed`. | Process adds `webhooks.booked` or `.release` on the intake fact when Observation `payload_event_type_raw` would not have classified at capture. Never adds `booking_status_changed` at process. |

Process decides “capture already classified” with the same classifier on
`payload_event_type_raw` (the Observation copy of payload `event_type`).
Same-observation booking-case replay (`replayed: true`) does not write
intake again.

## `pending` fields added

**`createLeadFromGranot` `executeCreation` return / finalize `pending`**

| Field | Source |
| --- | --- |
| `source_receipt_id` | persisted receipt id |
| `decision_id` | provenance Decision id |
| `job_no` | Observation `identity.job_no_raw` / `normalized_job_no` |
| `source_company` | Lead Source Company `company_slug` |
| `lead_id` | created Lead id |
| `lead_model` | `FormLead` / `CallLead` |

Existing `sheetJob` / `cpl_missing` / `sms` unchanged. Mint records
after sheet + CPL + SMS so those side-effects keep their order.

**`synchronizeLeadFromGranot` `pending` (always an object, not only the
sheet job)**

| Field | Source |
| --- | --- |
| `sheetJob` | present only when the Lead changed |
| `outcome` | `applied` / `linked` / `conflict` |
| `source_receipt_id` | `context.provenance.source_receipt_id` |
| `decision_id` | `context.provenance.decision_id` |
| `job_no` | Lead `job_no` or job proposal snapshot |
| `source_company` | Lead `source_company` when already on the document |
| `lead_id` / `lead_model` | `lead_ref` |

Finalize records `granot.linked` only for `applied` and `linked`.
Conflict is left to `logProcessingCompletion` → `granot.observed`.
Link-only (no sheet job) still finalizes the Daily Operations card.

## Pairing field names

| Card | `parent_receipt_id` | `links` |
| --- | --- | --- |
| Receipt (`granot.lead_created` / `.priority_updated` / `.booked` / `.release`) | `null` | `receipt_id` |
| `granot.minted` / `.linked` / `.observed` / `.pending_match` / `.unmatched` | source receipt id | `receipt_id`; mint/link also `lead_id` + `lead_model` |
| `intake.opened` / `.refreshed` | source receipt id | `receipt_id`, `intake_case_id` |
| `exception.dead_letter` | receipt id | `receipt_id` |

Dedupe: `receipt:<id>:<route_event_class>[:booked|release]`,
`decision:<id>:<kind>`, `intake:<caseId>:opened` /
`:refreshed:<revision>`, `exception:dead_letter:<receiptId>`.

`granot.minted` touches `["decisions.minted"]` only. Never `leads.*`.

## What this issue did not hook

- `captureChannelOperationReceipt` (extension / HTTP-automation)
- Form / Call / Booking / text / Confirm Granot Booking (DOP-02)
- HTTP / SSE / cron / Admin UI / Live Events accordion
- `granot.minted` Lead volume — `createLeadFromGranot` writes the Lead
  directly and does not call `completeFormLeadIngestion` /
  `completeCallLeadIngestion`. This issue must not increment `leads.*`.
  Recorded as a cross-issue finding.
- Knowledge Service body (DOP-08)
- Commit or push

## §10 acceptance criteria

| Criterion | Evidence |
| --- | --- |
| `lead_created` capture increments `webhooks.lead_created` only | `recordGranotFacts.test.ts` + `capture.test.ts` — no `leads.*` / `decisions.*` |
| `createLeadFromGranot` finalize increments `decisions.minted` and not `leads.*` | Helper + source-search that finalize calls `recordGranotMintedDailyOperationsFact` after sheet/CPL/SMS |
| Outcome card has `parent_receipt_id` of the receipt card | Pairing test: receipt `null`, minted `pair-receipt` |
| Booked / Release increment those buckets once | Capture-classified: receipt has class+booked; intake has `intakes.opened` only. Unclassified: receipt class only; intake adds `webhooks.booked` |
| Intake opened increments `intakes.opened`; refresh does not | Helper + `bookingReconciliation.test.ts` AC-20 |
| Extension / automation capture is not hooked | Source-search on `captureChannelOperationReceipt`; channel capture sink empty |
| Replay does not increment | Command finalize already skipped when `replayed`. Same-observation booking-case replay writes no intake fact |
| Focused tests + typecheck | 143 passed, 1 skipped (existing replica-set gate). `pnpm typecheck` exit 0 |

## Command output

On this Windows runner, `tsx --test src/services/dailyOperations/` as a
directory fails. The `*.test.ts` glob was used.

```
$ pnpm exec tsx --test src/services/granotLifecycle/capture.test.ts src/services/granotLifecycle/processor.test.ts src/services/granotLifecycle/bookingReconciliation.test.ts src/services/dailyOperations/*.test.ts
ℹ tests 144
ℹ suites 2
ℹ pass 143
ℹ fail 0
ℹ cancelled 0
ℹ skipped 1
ℹ todo 0
ℹ duration_ms 7788.2644
```

Skipped: existing processor replica-set proof (`TEST_MODE=true`).
Expected pino `info` lines from processor completion and booking-case
audit. No Mongo opened for Daily Operations (test sink).

```
$ pnpm typecheck

> vantage_movers_server@1.0.0 typecheck C:\Users\Pinda\Proyectos\vantage\vantage-main-server
> tsc --noEmit
```

Exit 0.
