# CSI-18 intake — September 19, 2026

Final local acceptance: **server complete; UI complete**. Existing CSI-07/08 changes and export preserved. The matrix below records the starting gaps; all listed work is implemented. See CHECKS and REVIEW for direct proof and the stale checkpoint limitation.

| Contract | Executable starting state | Required work |
| --- | --- | --- |
| Confirm run/finding | Strict command discriminators exist; no Owner route/service | Exact output/revision/current-version fence, audit and durable command replay without application |
| Correct/retract | Command shapes and immutable instructions/effects exist; CSI-06 exports `applyOwnerCommandInTransaction` | Authorize selected effect, immediate transaction, preserve later Owner changes and blocked reversals |
| Apply suggestion | Strict shape only | Exact selected output to independent Owner action through CSI-06 |
| Original/current rerun | Trusted preparation and captured replay exist; Owner routes absent; preparation explicitly rejects correction IDs | Authorized correction context, durable Owner scheduling and worker integration |
| Run/finding/evidence/history | Model/internal reads exist; Owner catalog routes absent | Read-only version/effect/history APIs, authorized evidence and purge tombstones |
| Assessments | Schema/storage/application seams exist | Exact instruction versions and explicit unknown for silence in Owner reads/UI |
| Admin controls | CSI-08 real operational panels/BFF/SSE exist | Integrate server contracts; retain drafts, idempotency intent, URL selection and explicit conflict acknowledgement |

Verified server HEAD `cc67bdfdc2a5738f8c876af187b0317eb34b1a1d`, Admin `e0c0a77e0577b73c4996d99f4af52d3a8b232b55`, MCP `9a8fd37bf78f8074011fb2d47ff3da3ec400b33d`; all on `sales-intelligence`, work-owned remotes. Server/Admin dirty CSI-07/08 baseline; MCP clean. Ports 3107/3108/27189 listening. This is availability evidence only, not renewed browser acceptance.
