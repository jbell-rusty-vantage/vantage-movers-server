Fixed both substantiated findings.

- Aligned pipeline documentation with the actual per-channel gate and hourly-limit environment keys.
- Clarified CSI-10 does not send messages itself; CSI-14 consumes reviewed channel metadata as one authorization input.
- Added a focused nudge configuration regression test covering channel gates and a rate limit of `1`.

Rejected findings: none.  
Unresolved product decisions: none.

Verification: static consistency check confirmed obsolete documented keys are gone. Focused test execution was blocked because the isolated checkout’s shared `node_modules` junction cannot read `tsx` (`EPERM`); no dependencies were changed.