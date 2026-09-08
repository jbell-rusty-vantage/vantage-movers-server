# CLCP-03 completion

Closed 2026-09-04. Server repo `vantage-main-server`, branch `call-lead-contact-provenance`. Extension repo `granot_sync_extensions_and_services` stayed on `main` (package `0.2.8`).

## Behavior

`findBestCallLeadMatch` matches Job Number first when the CRM row has one (same exact `job_no` query as before). Phone runs only when Job is missing or Job misses. Phone `$or` is live `normalized_phone_number`, live `phone_number` regex, and `ingested_contact_snapshot.normalized_phone_number`. It does not query `granot_contact_snapshot`. After Job bind, a Granot mobile that equals another Call Lead’s ANI still selects the Job Lead (`job_no_only`).

`buildUpdate` no longer assigns live `name` / `email` / `phone_number` / `normalized_phone_number`. It still never writes `move_date` and still does not overwrite a conflicting stored `job_no`.

**CSV choice: skip + warn.** A valid `granot_contact_snapshot` requires `observation_id` and `captured_at`. Leftover CSV has no Observation, so this issue does not persist a snapshot. When incoming Granot contact is not semantically equal to the stored card (`contactSemanticallyEqual`), preview `changes` includes `granot_contact_snapshot`, status is `updateable` (HTTP `syncable`), and a warning says contact stayed observation-only until lifecycle apply. Persistable `update` does not include the snapshot, so leftover `syncCallLeadEnrichment` does not write contact.

HTTP `applyAutomationPlanAction` and extension `applyExtensionGranotItem` still capture → `claimAndProcessOrPoll`. They do not import `syncCallLeadEnrichment`. Extension apply still POSTs `{ items }` with `lead_snapshot_apply` / `booking_action_apply`.

## Files changed

Server:

- `src/services/enrichment/callLeadEnrichment.service.ts` — Job-first matcher; ingested phone `$or`; no live name/email assigns; snapshot coalesce marks `updateable`
- `src/services/enrichment/callLeadEnrichment.service.test.ts` — inverted Job-first assertion; live-contact / steal-Job / contact-only / phone-query scan
- `src/services/reconciliation/bookedCallLeadReconciliation.service.test.ts` — Path B phone fallback source-scan (no Path B order change)
- `docs/call-lead-contact-provenance/issues/CLCP-03.md` — §10 boxes checked
- `docs/call-lead-contact-provenance/PROGRESS.md` — close ledger
- this report

Extension (`main`):

- `src/workflows/call-leads/payloads.ts` — comment no longer says live name/email update on sync
- `src/entrypoints/popup/ui/leadMessaging.ts` — Owner label **Changed in Granot** for `granot_contact_snapshot` in change lists
- `src/test/lead-messaging.test.ts` — that label

## CSV choice

Skip + warn. Snapshot write was preferred only if a valid card could be stamped without a planner. `observation_id` is required on the existing schema. Preview still offers contact-only diffs.

## Test command output

```text
VANTAGE_TEST_RUNNER=true pnpm exec tsx --test src/services/enrichment/callLeadEnrichment.service.test.ts
ℹ tests 9
ℹ pass 9
ℹ fail 0
ℹ skipped 0

node --import tsx --import ./scripts/test-setup.ts --test src/services/reconciliation/bookedCallLeadReconciliation.service.test.ts
ℹ tests 5
ℹ pass 5
ℹ fail 0
ℹ skipped 0

pnpm typecheck
tsc --noEmit
exit_code: 0
```

The issue’s bare `pnpm exec tsx --test …` command without `VANTAGE_TEST_RUNNER=true` / `scripts/test-setup.ts` hits `lead_source_companies.find()` (pre-existing catalog fence). The project test runner always sets that env. No required test failed or was skipped.

Extension (copy change):

```text
pnpm exec vitest run src/test/lifecycle-apply.test.ts src/test/call-leads-payloads.test.ts src/test/lead-messaging.test.ts
Test Files  3 passed (3)
Tests  22 passed (22)
```

## Proof apply still does not import `syncCallLeadEnrichment`

Grep of `src/services/granotLifecycle/automationApply.ts` and `extensionApply.ts` for `syncCallLeadEnrichment` and `syncBookedCallLeadReconciliation`: no matches. Imports remain capture → `claimAndProcessOrPoll`.

## Note for CLCP-04

`docs/knowledge/services/enrichment.md` still describes CSV / preview as writing live name/email and (implicitly) phone-first match. After this issue it must say: leftover CSV does not write live contact; preview is Job-first; HTTP/extension apply stay on the processor. `extension-apply.md` and `automation-apply.md` need one sentence: same snapshot contact rule as webhook synchronize (no live name/phone/email).

## Untouched (confirmed)

- `src/services/granotLifecycle/identity.ts` (CLCP-02)
- `src/services/granotLifecycle/leadDesiredState.ts` (import of exported `contactSemanticallyEqual` only)
- `src/services/granotLifecycle/sourcePolicy.ts`
- `src/services/granotLifecycle/projections.ts` (CLCP-05)
- `automationApply.ts` / `extensionApply.ts`
- flags / `.env`
- Knowledge Service bodies (CLCP-04)
- Path B Job-first order in booked reconciliation

## Acceptance criteria evidence (issue §10)

| Box | Evidence |
| --- | --- |
| `buildUpdate` does not set `phone_number` | `preview does not write live phone, name, or email`; contact-only case |
| `buildUpdate` does not set live `name` / `email` (or only snapshot) | Same tests; persistable update omits those keys; skip+warn |
| Conflicting `job_no` still not overwritten | `conflicting stored Job Number is not overwritten` |
| Preview matches Job first when the row has a Job Number | Inverted first test `match_method === "job_no_only"`; steal fixture |
| Granot phone = other Lead’s ANI does not steal a Job-bearing Lead | `row Job on Lead A plus Granot phone equal to Lead B ANI selects A` — query-inspecting stub; A / `job_no_only` |
| Contact-only snapshot diff is `updateable` (HTTP `syncable`) | `contact-only Granot card diff is updateable`; `changes` includes `granot_contact_snapshot` |
| Preview phone rung does not query `granot_contact_snapshot` | Source-scan of `findBestCallLeadMatch` `$or` |
| Apply files still do not import `syncCallLeadEnrichment` | Grep above |
| Extension apply still POSTs `{ items }` | Existing `lifecycle-apply.test.ts` / `call-leads-payloads.test.ts` still pass |
| Extension copy does not promise live name/phone writes | `payloads.ts` comment fixed; `leadMessaging` maps snapshot field to **Changed in Granot** |
| Focused tests in §8 pass | Commands above: 9 + 5, typecheck clean, extension 22 |

## What this issue did not do

CLCP-04 knowledge rewrites. CLCP-05 desk `q`. Identity / planner edits. Enabling apply flags or CSV as a lifecycle channel. Path B phone order. Writing a CSV snapshot with a minted `observation_id`.
