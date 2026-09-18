# CSI-06 quality review

Required repository checkpoint invoked with `pnpm finish-work --provider codex --no-apply`.
Run: `1789755717319-34457adf`, input HEAD `999c63d`, isolated snapshot fingerprint `b27e5e66281d7d313d5b859f7c4d246ed8b2a1130d1d5264774d23141dc9b797`.

The initial independent review reported one P2: expected Outreach command rejections used the HTTP 500 fallback. The source now maps identity/restriction/official-state conflicts to 409 and invalid evidence scope to 400, with injected-error route coverage. Submission conflict and expired Attention snapshot also map to 409. No source patch from the checkpoint was applied.

The checkpoint compared against its older persisted quality baseline, so its changed-file inventory includes already-landed CSI-05/12. This task did not modify those earlier implementations except the explicitly documented CSI-05 integration hook and source type addition. Its isolated snapshot also predates this task's final timeline, source-date and callback-target refinements. Current source verification is authoritative in [CHECKS.md](CHECKS.md).

Isolated checkpoint result: failed. Its stale snapshot typecheck failed on the Owner Instruction field array type in `effects.ts`; that array is explicitly typed in the current source and current typecheck passes. Lint passed; offline suite 2393 passed / 114 skipped / 0 failed; quality-runner suite 12/12 passed. Final review also found the canonical cron table still described five-minute `outreach_derive`; the table is now corrected to minute `outreach_ensure`, matching registration. No checkpoint patch was applied. These snapshot checks are not deployment or current-source independent approval; the checkpoint was not rerun after the final fixes.

Additional local checks found and fixed exact effect receipt target IDs, independent source dates after Owner rescheduling, ambiguous multi-callback completion, closed-work Number Review evasion, and append-only note chronology. Replica proofs exercise these server paths without providers or official-record writes.
