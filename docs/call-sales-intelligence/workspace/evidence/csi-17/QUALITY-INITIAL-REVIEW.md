## Findings

- **High — rep-identity replay skips recording discovery for calls with no recording currently attached.**  
  `src/services/salesIntelligence/repIdentity/worker.ts:41` only enqueues `recording_discovery` when `call.recordings.length` is nonzero. A newly reviewed rep identity can make a historical outbound call eligible while its recording is still delayed/unobserved; no discovery job is created, so the existing bounded discovery retry window never starts and later media cannot be reconsidered through this replay. This also contradicts the CSI-10 service contract’s unconditional reevaluation fan-out.  
  Smallest fix: enqueue the discovery job for every re-evaluated interaction and let `runRecordingDiscoveryJob` handle empty recordings through its established pending/window-exhaustion behavior. Add a replica test covering an eligible re-evaluated call with `recordings: []`.

No other concrete correctness, authorization, or side-effect regressions found in the reviewed paths.