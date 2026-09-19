# CSI-07 checks — September 19, 2026

Source baseline and hashes: INTAKE.md / SOURCES.md. No old CSI-13 checkpoint is claimed as review of this change.

- Admin initial and post-implementation `pnpm typecheck`: pass.
- Server initial and post-implementation `pnpm typecheck`: pass.
- Server `pnpm lint`: pass.
- Admin focused Node tests: 5/5 pass (forwarding/trust, Owner/scope, envelope metadata, SSE denial and cancellation).
- Server `node --import tsx --import ./scripts/test-setup.ts --test src/services/salesIntelligence/live.test.ts`: 1/1 pass, real HTTP guard/clock/disconnect.
- Real local `node --import tsx scripts/test-csi-live.ts`: pass; Owner reads/metadata, anonymous/Admin denial, current/conflicting scopes, replay/conflict, reconnect and clock frames. Initial proof incorrectly compared replayed flags; corrected to compare durable response plus replayed=true.
- Admin full suite first run: 618 pass / 2 fail from intentional navigation insertion; ordering expectations updated; final rerun 620/620 pass (admin-tests.txt).
- Admin full lint: 11 errors / 7 warnings in pre-existing unrelated components/tests. Focused changed-path lint passes. Do not label full Admin lint passing.
- Startup corrections: isolated DB name had a disallowed underscore; synthetic Agents needed normalized_name for existing unique index. Both corrected before acceptance. Early root-directory command attempts failed without modifying data; commands above use repository cwd.

Browser via Codex browser, actual local HTTP and synthetic persisted data:

- Owner login and Attention list, all returned reasons; unknown history/analysis not shown as zero.
- Desktop 1440×900: Number/Outreach drawer, multiple actions, Jordan action owner/Alex overall owner, undated estimate. `desktop-detail.png`.
- Real PATCH changed callback text to `Synthetic callback updated 2026-09-19T06:54:12.434Z`; selected URL and Close focus retained across live refetch.
- Clock PATCH moved callback into future; `clock-before.png` shows no Overdue. With no subsequent command, server clock/recovery restored Promised callback overdue + Follow-ups due; `clock-after-narrow.png`.
- Browser offline, actual PATCH text `2026-09-19T06:56:08.186Z` missed while disconnected; online refetch displayed it with same selection/focus. `reconnect-narrow.png`. Emulated offline reset.
- Narrow 390×844 scrollable detail, native modal focus containment; Escape restores original row button even after server reordered the list. URL filter `band=2` gives real zero/empty state; `narrow-empty.png`.
- Screenshots contain synthetic local identities only; no credentials/customer records. No production/paid-model proof implied.

Final source Admin typecheck passes. Server focused live/router/Outreach regression: 9/9 pass (server-tests.txt). Real local HTTP rerun including durable change frames passes (http-proof.txt). Browser Admin login redirects the CSI URL to Overview and omits its navigation entry (admin-denied.png); Owner restored and browser network/viewport overrides reset.

Final inventory: all eight adapted export source hashes still match intake; MCP remains clean; no manifests or lockfiles changed. Server/Admin tracked diff whitespace checks pass. Local preview remains running; Owner restored on the delivered browser tab.

## Required server checkpoint

`pnpm finish-work --provider codex --no-apply`, run `1789801331287-c010ee78`: completed. Final reviewer **QUALITY_RESULT: PASS**. Snapshot typecheck, lint, full suite (2,431 pass / 115 skipped / 0 fail), and quality-tool suite (12/12) all passed. Exact reports: checkpoint-review.md, checkpoint-cleanup.md, checkpoint-docs.md, checkpoint-verify.md, checkpoint-checks.json and checkpoint-result.json.

Overall orchestration status is **stale**, because source evidence/ledger changes continued after capture. No patch applied. Its only proposed runtime change is an unrelated transcription lease-contention response/test correction; left for CSI-12/Team B. The model cleanup's own attempted checks had dependency permission failures, but the subsequent pipeline checks above succeeded. Do not confuse the model's failed attempts, the successful isolated snapshot checks, the final PASS, and current-source evidence. This is not independent final-source/Admin approval. See REVIEW.md.
The finish-work CLI exits 1 for stale status; it is not a green CLI exit. checkpoint-unapplied.patch preserves the two-file proposal for its owner; it was not merged.
