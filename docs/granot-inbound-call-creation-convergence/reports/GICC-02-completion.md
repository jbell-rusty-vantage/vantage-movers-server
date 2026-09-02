# GICC-02 completion

Coordinator review after implementer [GICC-02](cf2ea8b5-ec38-4f8d-810a-d99abf5c0e88). Issue §14.

## Files changed

- `src/services/granotLifecycle/createLeadFromGranot.ts` — both Granot lock sites now run on CallLead + Observation phone; adoption flag removed
- `src/services/granotLifecycle/createLeadFromGranot.test.ts`
- `src/services/granotLifecycle/createLeadFromGranot.replica.test.ts`
- `src/services/granotLifecycle/processor.test.ts`
- `src/services/granotLifecycle/identity.test.ts` — asserts `job_number_conflict` reason
- `src/services/ringcentral/ringcentral-call-lead-ingest.service.test.ts`
- `src/services/ringcentral/callLeadConvergence.test.ts`
- `src/services/ringcentral/callLeadConvergence.replica.test.ts`
- `src/services/ringcentral/processed-calls-store.ts` — `isVantageTestRunner()` leftover index-name drop so unit 20 `before()` can create named indexes. Not a production mutation.
- `docs/granot-inbound-call-creation-convergence/PROGRESS.md`

`ringcentral-call-lead-ingest.service.ts` source: no diff.

## Test / replica output (coordinator re-run)

```text
cd vantage-main-server
pnpm exec tsx --test \
  src/services/granotLifecycle/createLeadFromGranot.test.ts \
  src/services/granotLifecycle/identity.test.ts \
  src/services/granotLifecycle/processor.test.ts \
  src/services/ringcentral/ringcentral-call-lead-ingest.service.test.ts \
  src/services/ringcentral/callLeadConvergence.test.ts \
  src/services/ringcentral/processed-calls-store.test.ts
# tests 98, pass 97, fail 0, skipped 1
# skip is existing processor replica-set persist test when unit runner has no replica session

TEST_MODE=true pnpm test:granot-lifecycle:replica -- --unit=19
# tests 10, pass 10, fail 0
# includes: Race A existing RingCentral Call Lead synchronizes even with adoption off

TEST_MODE=true pnpm test:granot-lifecycle:replica -- --unit=20
# tests 13, pass 13, fail 0
# includes: concurrent Granot + ingest one fence (adoption on + create);
# Job-only not adopted; different granularity not adopted;
# adoption off mints documented Race B twin
```

## Match key

Still exact `source_granularity_id` + normalized phone. Never Source Company alone. Source scan in `callLeadConvergence.test.ts` and replica cases for other granularity / Job-only.

## Both Granot lock sites ungated; ingest lock not

- `ensureRingCentralConvergenceScopeLock` (pre-transaction): CallLead + Observation phone. No adoption flag.
- `acquireRingCentralConvergenceScopeLock` + `findPreCreationRingCentralConvergenceCandidates` (in-transaction): CallLead + Observation phone. No adoption flag.
- `createLeadFromGranot.ts` no longer mentions `isRingCentralGranotAdoptionEnabled`.
- Ingest lock remains `if (adoptionEnabled) { await acquireRingCentralConvergenceScopeLock(...) }` at ~321.

## Residual Job-only hole still named

No Observation phone → both Granot lock sites skip. Comment in `createLeadFromGranot.ts`: Job-only create remains legal (pack spec §7). Do not invent a phone. Unit 20 proves Job-only is not adopted; a later qualified call may create.

## Confirmation of what was not done

- Ingest lock not ungated
- No new `lead_created_policy` value
- `sourcePolicy.ts` / `leadMessaging/` — no diff
- Registry rows and production flags not flipped
- No commit, push, deploy, or live customer payload
