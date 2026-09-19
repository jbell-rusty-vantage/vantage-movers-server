# CSI-14 review

Required command: `pnpm finish-work --provider codex --no-apply`. This runs the repository's isolated quality pipeline without applying a patch to the source checkout. A stale/failed snapshot is not independent current-source approval.

## First checkpoint

Run `1789770937919-f180ab27`, input HEAD `3355c6dcf68ed2c092824dc1dbb87c71a3f0c343`, fingerprint `92fb84338866cae61ff7b0aeb3e5d9e0611ae26ca7b217ff3bd15004e90153ba`. Actual status **failed**, CLI exit 1: final review found old Number-detail/timeline claims in shared CONTRACTS.md contradictory to shipped CSI-06 behavior. All isolated checks passed: typecheck/lint 0, offline 2408 pass / 114 skip / 0 fail, quality-runner 12/12. Raw reports, checks and proposed patch are retained as `checkpoint-1-*`.

Initial findings identified undocumented runtime configuration names and stale CSI-10 no-messaging wording. Inspected the proposed patch before integration. Source fixes honor the existing documented channel/rate keys with tested precedence (rather than removing them from the specification), clarify CSI-10's no-send service boundary, and correct the shared read contract. The docs proposal prompted a direct check of timeline composition; CSI-14 now includes the nudge invalidation kind with a replica assertion. Broader organization-rule rewrites were not applied. No checkpoint patch was applied wholesale. Source diverged during these corrections, so the snapshot is not final current-source approval even apart from its failed final review.

The cleanup model's focused test attempt was blocked by sandbox/junction `EPERM` reading `tsx`; the pipeline's actual external checks subsequently passed. This is distinct from an implementation assertion failure. The second checkpoint and its final result are recorded below.

Manual protocol review before checkpoint: only the fresh trusted Owner command can submit; transactions contain no provider calls; optional pager fallback is limited to definitive chat-creation rejection; native message POST has no auth retry; durable receipt repair uses exact scoped identifiers; unknown delivery cannot dispatch or resend; rate admission serializes through the existing rep-extension fence; Owner work fields and official records remain unchanged. Fake tests cover the identified race/crash windows.

No live proof, production operation, credential-loading test, source commit or push was performed.

## Second checkpoint and final source

Run `1789772227555-39337d57`, input HEAD `3355c6dcf68ed2c092824dc1dbb87c71a3f0c343`, fingerprint `8bfeef281b315a55a7672621c46bd103adc68350ef921dcb0a7e673c589e3244`; finished `2026-09-18T23:13:16.036Z`. Actual status **failed**, CLI exit 1. Initial review had no findings. Cleanup identified an exact-receipt scope gap: returned Direct chat ID must match the persisted requested chat ID. Inspected the proposed adapter/test/Service patch and integrated those relevant changes, with passing direct tests.

All isolated automated checks passed: typecheck/lint exit 0, offline **2409 pass / 114 skip / 0 fail**, quality-runner **12/12**. Final review failed solely because its pipeline §8.3 snapshot still described listing chat posts since createdAt instead of exact-ID reads. Current source §8.3 now specifies exact post/Direct IDs, membership and sender verification, and rejects body/time similarity. Raw reports, final proposed patch and check outputs are retained as `checkpoint-2-*`. The cleanup model's own test attempt lacked accessible dependencies/config; actual pipeline checks subsequently passed.

Source also gained compatibility for legacy pending rows without revision metadata after the checkpoint input. It fails these rows as not submitted, without resending; replica proof passes. Final current-source checks: typecheck/lint 0, focused 31/31, nudge replica 16/16, related replicas 22/12/15/10, offline 2409 pass / 114 skip / 0 fail. `current-source-sha256.json` fingerprints the final runtime/test files. No further runtime edits followed these checks.

The failed isolated checkpoint is retained as failed, not converted into approval by subsequent source corrections. **No independent final approval of the final current source is claimed.** No patch was applied wholesale, and no source commit/push or live provider operation occurred.
