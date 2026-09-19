Fixed the substantiated CSI-10 replay regression.

- Rep-identity reevaluation now always enqueues `recording_discovery`, including interactions whose recording list is currently empty. The discovery worker retains responsibility for bounded pending/no-recording handling.
- Extended the replica regression test to require discovery jobs for all 27 replayed calls, including empty-recording calls.

Validation could not run in this sandbox:
- `pnpm` is blocked from opening its user config (`EPERM`).
- Direct Node test execution cannot resolve the unavailable local `tsx` package.

Rejected findings: none.  
Unresolved findings: none.