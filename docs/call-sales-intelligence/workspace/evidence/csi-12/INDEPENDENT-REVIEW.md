# CSI-12 independent review

Reviewer: separate read-only Codex agent `/root/csi12_review`, September 18, 2026. Reviewed implementation against the Owner's CSI-12 scope and contracts; no edits, production calls, branch changes or commits.

| Finding | Resolution / proof |
| --- | --- |
| Sensitive values split across provider segments could survive per-segment redaction. | Detect over joined text, mask each intersecting segment, then redact every sentence. Provider timing survives; card/spoken-digit/CVV unit fixture passes. |
| Ambiguous dispatched STT failures released reservations as if unused. | Track dispatch separately from response. Retain ambiguous spend; release only pre-dispatch or known permission/throttle rejection. Replica verifies all eight unresolved transient reservations and released permission reservation. |
| Undetermined eligibility during STT lost downstream intent. | Preserve paused analysis/eligibility_pending job in the completion transaction; bounded recovery rechecks it without STT. Replica proves later eligibility resolution resumes analysis only. |

Reviewer re-read fixes, queue/cron/recovery wiring, lease fencing, immutable snapshots, Blob validation, nullable billing DTO and ObjectId-only job references: **no remaining concrete implementation blockers**. Independent command `node --import tsx --import ./ops/test-setup.ts --test src/services/salesIntelligence/conversations/transcript.test.ts src/services/conversations/redaction.test.ts` passed 7/7. Reviewer's suggested policy-cap resume, captured-log privacy and during-STT undetermined proofs were subsequently added and passed in the replica suite. Final follow-up review recorded after final validation.

The repository quality checkpoint independently found two further eligibility recovery cases: cached undetermined stored media needed authoritative re-evaluation; pre-STT exclusions needed terminal skip semantics. Main implementation also closes restoration and starvation risks: due scans rotate waits, and only excluded skips reopen without losing prior transient attempts. The separate reviewer assessed both findings and requested the 0/7 prior-attempt restoration and >5 waiting-row regressions now included in the replica. Checkpoint edits remain isolated and cannot overwrite the advanced source fingerprint.

Final separate-agent review: **approved; no actionable findings**. All five findings resolved. Expanded replica completed **16/16**, focused rerun **13/13**, final typecheck and lint exit 0. Reviewer independently ran the focused suite and patch-hygiene check; replica output was reviewed. Hook-generated proposal checks are reported separately from final source validation.

## Final Cursor findings and independent resolution

Cursor review found deterministic empty STT retried as transient and analysis eligibility waits left open after exclusion. Both corrected in the main source: terminal cost-accounted empty result, version/digest-pinned recovery, excluded-intent restoration and stale-intent isolation. The separate reviewer caught and verified fixes for null cost parents and concurrent successful-cache protection. Final independent source review: approved, no actionable findings. Expanded replica passed 19/19; focused passed 13/13. Low-priority suggestion to recover and process another recording in one invocation was not adopted: one bounded recording unit per invocation remains the explicit CSI-12 contract. Hook proposals stay isolated; no stale partial proposal applied.
