# Prompt/schema review checks — 2026-09-20

## Accepted implementation checks

- `pnpm generate:csi:intelligence-contract` — passed; generated MCP prompt updated, envelope digest unchanged.
- Server combined focused tests (runtimeFlow, prompt, contracts, runtime, promptSchemaReview and intelligenceEnvelope.validation): **29 passed, no skips**. Includes actual MCP HTTP + ToolLoopAgent with a synthetic provider. No database or paid-model call.
- The added repair-read regression first failed with `Missing expected rejection`: SDK activeTools hid a read from discovery but still allowed its execution. After the runtime execution guard, it passes and proves no read reaches MCP during repair.
- The wrong-receipt regression first failed with two provider calls instead of one. It now passes after aborting on unrecognized submit receipts/results; a transport-503 regression also verifies one provider call and no automatic submit retry.
- MCP `pnpm typecheck` and `node --import tsx --test lib/intelligence/transport.test.ts` — passed, **11 transport tests**.
- Focused ESLint over all changed analysis TypeScript files — passed. Runtime/test lint repeated after adding the execution guard — passed.
- Main-server typecheck initially reproduced the three existing TS18046 errors in scripts/probe-intelligence-mcp-agent.ts. Added an explicit one-text-result shape guard there; typecheck passed. Final `pnpm typecheck` after the uncertain-submit guard also passed. Final focused ESLint passed.
- Final checkpoint uses a temporary detached validation worktree seeded from HEAD plus only this task's files; main remains the implementation checkout. First scoped checkpoint failed creating its snapshot because of Windows path length. Retrying with process-local `core.longpaths=true` and `--no-apply`; no global Git setting or source auto-application.
- Scoped review assessment: the probe finding cites the earlier failure but the explicit guard now passes typecheck. The financial-cap finding is a real deployment constraint already recorded in the accepted recommendation, not authorization to lower the requested limits or raise Owner financial policy. The cross-repository test skip applies inside the isolated checkpoint; the actual multi-repo invocation above passed with no skips. No snapshot cleanup changes are applied automatically.
- Only whitelisted, non-secret pricing/limits lines in local .env and sales-intelligence.env were inspected for admission context. No limits override was found in those files. The two pricing examples imply 54–69 cents of worst-case reservation with the new limits; they do not establish deployed pricing or Owner policy. No credentials were printed or environment values changed.
- The scoped checkpoint retry reached cleanup, where it proposed reducing the accepted runtime limits and extracting a policy helper. It was intentionally stopped; no checkpoint edits were applied. Full finish-work certification remains incomplete. Reports remain under `.git/worktrees/csi-prompt/vantage-quality/runs/1789934358663-9df5f52c`; the isolated source/workspace is retained for inspection. Final source was checked directly with 29 server tests, 11 MCP tests, both typechecks, focused lint and diff whitespace checks. The newer uncertain-submit regressions were added and verified directly after that checkpoint's input snapshot.

## Earlier review checks

All commands run from vantage-main-server, without loading .env, calling a live model or contacting production Mongo/MCP.

1. `node --import tsx --import ./scripts/test-setup.ts --test src/services/salesIntelligence/analysis/promptSchemaReview.test.ts` — 2 passed. Demonstrates structural/server disagreement on three invalid payloads and existing structural enforcement of nullables/closed kinds. This is synthetic validator evidence, not a captured production replay.
2. `node --import tsx --import ./scripts/test-setup.ts --test src/services/salesIntelligence/analysis/runtime.test.ts` before limits change — 3 passed, 1 failed as expected at the requested higher step ceiling.
3. `node --import tsx --import ./scripts/test-setup.ts --test src/services/salesIntelligence/analysis/runtime.test.ts src/services/salesIntelligence/analysis/contracts.test.ts src/services/salesIntelligence/analysis/promptSchemaReview.test.ts src/validation/intelligence/intelligenceEnvelope.validation.test.ts` after limits change — 19 passed, no skips, including server/MCP artifact parity and cumulative budgets sufficient for every configured step.

The review does not prove better gpt-5-mini first-submit quality. That requires a fixed synthetic model evaluation and sanitized production issue-path metrics. Prompt/flow/resource changes remain proposed, so artifact regeneration is not necessary for this patch.

4. `pnpm typecheck` — failed with three TS18046 diagnostics at scripts/probe-intelligence-mcp-agent.ts:231 (`context.content` is unknown). That existing script is unchanged by this task; no diagnostics were reported in the changed files.
5. `pnpm finish-work --provider codex` — invoked as required, then intentionally stopped during read-only review. Its stored baseline expanded the review to more than 500 accumulated paths outside this task. No checkpoint patch was applied. Run directory: `.git/vantage-quality/runs/1789933236201-32b93386`. This is not a successful finish-work certification.
6. `pnpm exec eslint src/services/salesIntelligence/analysis/runtime.ts src/services/salesIntelligence/analysis/runtime.test.ts src/services/salesIntelligence/analysis/promptSchemaReview.test.ts --max-warnings 0` — passed.
7. `git diff --check` — passed. A concurrent change to src/services/salesIntelligence/repIdentity/identity.test.ts appeared at final status; it is outside this task and was left untouched.
