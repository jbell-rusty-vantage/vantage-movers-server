# Unit 33 extension client operational-control attestation

Date: 2026-08-19 (America/New_York)  
Status: **accepted Unit 33 old-client absence evidence**  
Authority: Owner-directed statements in the Unit 33 Codex task

## Owner-controlled rollout facts

- Granot Sync extension `0.2.8` has been uploaded and is rolling out.
- The Owner will not use the extension until `0.2.8` is ready and installed.
- The Owner explicitly unblocked continuation on that operational control.
- Therefore no pre-`0.2.8` client is authorized or active on the supported apply surface during the rollout. Supported use resumes only with `0.2.8`.

This is an operational-control attestation, not an inference from repository version or browser user-agent data. Existing receipts do not carry extension version and were not used to manufacture installed-client telemetry.

## Compatibility decision

The supported `0.2.8` source directly calls all three receipt-based endpoints:

- `PATCH /api/v1/form-leads/:id/granot-sync`
- `POST /api/v1/call-leads/enrichment/sync`
- `POST /api/v1/call-leads/booked-reconciliation/sync`

It also directly consumes the current `ExtensionGranotApplyResult` fields (`operation_id`, receipt/processing state, outcome, changed paths, and fixed safe message). Those routes and the one-way processor-result response therefore remain the current `0.2.8` contract; they are not legacy endpoints.

The retired direct Granot patch/capture adapter remains deleted. The unused server-only `classifyCompatibilityFamily` helper was removed after repository-wide caller inspection proved that only its test referenced it; `0.2.8` owns its current UI-status mapping locally.

## Safety posture

- No feature flag or activation changed.
- No current payload was accessed.
- No Lead, Booking, Cancellation, receipt, Observation, Decision, or other customer fact was mutated for this attestation.
- Compatibility endpoints remain Owner-authenticated, strict-statement, receipt-first processor entry points.

This evidence closes Unit 33's pre-`0.2.8` supported-client gate without claiming that the extension store rollout itself has finished.
