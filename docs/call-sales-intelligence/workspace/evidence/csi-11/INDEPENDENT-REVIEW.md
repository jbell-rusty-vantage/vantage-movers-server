# CSI-11 independent review and resolution

Date: September 17, 2026 America/New_York (execution artifacts also carry September 18 UTC). Reviewer: separate Codex agent `/root/csi11_review`, read-only over the uncommitted `sales-intelligence` patch based on `b92e7458`. The reviewer neither implemented changes nor edited evidence. No production/provider actions or environment-file loading.

Initial verdict: changes required. Final verdict: **no remaining actionable findings; ready for patch review**. Final signoff confirmed the four corrections and all three verification recommendations below. Reviewer independently ran the then-current 17/17 guarded replica suite and reviewed the final 19/19 artifact. It also independently ran the initial four pure tests. These results do not establish live RingCentral or Blob capability.

| Finding | Resolution | Evidence |
| --- | --- | --- |
| P1: lifetime NumberLeadAttachment counting could attach an unrelated historical move or falsely introduce ambiguity. | Eligibility now requires evidence applicable at the call time, or exact current Call Lead provider identity. Applicable Attached edges outrank candidates. Unscoped attachment evidence is named missing input. | Replica eligibility test: current/historical windows, Attached precedence, competing Attached ambiguity, exact-session match and unrelated later session rejection. |
| P2: a process killed on its eighth claim could leave a dead-letter job without conversation failure. | `recoverExhaustedMediaJob` handles expired eighth claims and the shared claimer's exhausted tombstones with a transactional job/epoch/status fence, projects failure once, never performs a ninth provider call. | Replica expired-eighth-claim test; caught-error eight-attempt test retained. |
| P2: long download could overwrite eligibility with a pre-download decision after Owner classification changed. | Success completion reloads current canonical interaction and eligibility in the fenced transaction. Immutable media can be retained, but an excluded decision suppresses the transcription hook. | Replica provider fake changes Contact Number to non_customer during content read; final decision excluded and pending_stage null. |
| P2: legacy seeded Blob media falsely established recording_content=ok. | Availability counts include legacy media, but capability success requires account/interaction/digest-bearing CSI media. Denied/unavailable outcomes retain conservative precedence. | Replica seed-only media reports unknown capability while media_stored count is one. |

Follow-up recommendations closed: exact Call Lead session test added; route test exercises production default extraRecovery (worker dependencies injected, not the recovery array) and asserts discovery plus media results; sanitized `recordOperationalEvent` calls now follow committed media_stored/unavailable/failed outcomes, including exhausted recovery, with `workflow:sales_intelligence`, `piiPolicy:none`, and no provider bodies. Durable audit remains authoritative when telemetry fails.

Reviewer additionally checked installed `@vercel/blob` 2.8.0 types: private access, storeId, no-overwrite and streaming put are supported. This is SDK compatibility inspection, not a successful live Blob upload. The final provider adapter regression also rejects unexpected partial-content responses, avoiding silently stored partial recordings.

## Fresh review requested September 18

Separate read-only reviewer `/root/csi11_final_review` independently reviewed the full patch against the specification, without relying on the prior approval. It independently ran the guarded replica suite: 19/19 passed. Two additional findings were resolved by the main implementer:

| Finding | Resolution | Regression |
| --- | --- | --- |
| P1: completing an excluded media job stranded the conversation after eligibility was restored because rediscovery reused its completed intent. | Persist the exact skip reason. Discovery advances the media revision only after a completed exclusion; active waits, immutable success and terminal provider failures keep their existing policy. Dataset/conversation-scoped lookup and transactional updates dedupe concurrent successors. | Expanded replica: eligible → excluded → completed skip → restored → concurrent revision-specific discoveries → exactly one new media intent → stored success; old completed job remains unclaimable. |
| P2: stalled shared token acquisition/refresh could outlive the recording worker deadline. | Abort-aware waits in the additive recording transport cover token and refresh operations, clean up listeners and consume late rejections. Existing qualification JSON transport is unchanged. An already-started shared refresh can settle in the background, but the recording invocation returns at its deadline. | Synthetic unresolved-token and unresolved-refresh checks assert abort rejection and no subsequent recording request. |

Reviewer examined both fixes and tests and returned **no remaining actionable findings**. Main implementer reran expanded replica 20/20 and qualification/provider/media unit checks 111 passed with 3 pre-existing skips. Final typecheck and patch hygiene are recorded in CHECKS.md. No live capability, production action or commit is claimed.
