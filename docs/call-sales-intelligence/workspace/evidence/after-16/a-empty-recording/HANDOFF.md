# AFTER-16 A — empty-recording repair

Narrow CSI-10 follow-up. `runRepIdentityReevaluationJob` now enqueues `recording_discovery` for every re-evaluated interaction. Empty `recordings: []` is no longer a local gate. `runRecordingDiscoveryJob` still owns pending / no_recording / window exhaustion.

Inspected `evidence/csi-17/QUALITY-PROPOSED-CLEANUP.md`. Did not apply that patch wholesale. Flags unchanged.

F-01 / F-03 / F-07 remain open. This slice closes F-05 only.
