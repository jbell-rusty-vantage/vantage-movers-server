# Board — Release into Booking Intake

Updated by each sequential subagent. Status: `pending` | `in_progress` | `done` | `blocked`.

| Phase | Status | Agent | Notes |
| --- | --- | --- | --- |
| 1 Classifier + latest_action + AC-P5 / AC-R1–R6 unit | done | phase-1 | `lead-lifecycle`. Helper + classifier + persist. 28 unit tests pass. Processor still Booked-only. |
| 2 Processor Release → booking case; retire Release owner open | done | phase-2 | `lead-lifecycle`. Call removed (not shimmed). 71 tests pass. Replica persist is Phase 3. |
| 3 Replica persist AC-R1, AC-R2, AC-R7, AC-R8 | done | phase-3 | `lead-lifecycle`. Tests written + skip-safe. 10 replica skipped (TEST_MODE off). 28 unit pass. |
| 4 Booking-case confirmCancellation AC-R9 | done | phase-4 | `lead-lifecycle`. Shared official-write helper. Booking POST confirm-cancellation. Unit+route pass; 4 replica skipped (TEST_MODE). |
| 5 Projections + creatingObservation + Admin intakes AC-R10 | done | phase-5 | Both repos on `lead-lifecycle`. `/intakes` booking-only; copy never says Granot cancelled. Server 58 + admin 124 tests pass. |
| 6 Historical Release-case migrate helper | done | phase-6 | `lead-lifecycle`. Planner+CLI. Discrepancies left historical. 11 unit tests pass. Not applied to production. |
| 7 Live Events intake_link + receipt_updated AC-L1–L5 | done | phase-7 | Both repos `lead-lifecycle`. Join by `evidence.observation_id` (batched). SSE `receipt_updated` does not advance cursor. Admin **Open booking intake** iff `intake_link`. Index defined, not applied to prod. 17+44 tests pass. |
| 8 Knowledge docs §16 | done | phase-8 | Spec copied to `docs/granot-lead-lifecycle/`. Service docs + capture rule match current code. CONTEXT and Admin live-events uxdocs already accurate. FINAL SPEC untouched. |

## Definition of done

- [x] AC-P5 rewritten (Release writes booking-case evidence)
- [x] AC-R1 through AC-R11 have automated tests (AC-R9 command/route/unit written; replica skip-safe)
- [x] AC-L1 through AC-L5 have automated tests
- [x] `/intakes` has one queue (booking only)
- [x] Live Events **Open booking intake** only when Observation is on that case
- [x] No production flags flipped
- [x] FINAL SPEC untouched
