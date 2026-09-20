# CSI-16 intake

Team F, Owner session September 19, 2026 (execution continued September 20 UTC). Scope: certification, honest capability accounting and documentation restamp. CSI-15 is already implemented on main; this task does not reimplement it.

Inspected remotes and dirt before edits. Baselines: server `561e048960cd914f37a337addada8b459b5296f1`, Admin `fb631eb1f820ce6a5c641c677029371a73dc53ab`, MCP `9a8fd37bf78f8074011fb2d47ff3da3ec400b33d`. All are local `main` with `jbell-rusty-vantage` remotes. Preserved server `package.json` and `scripts/probe-intelligence-mcp-agent.ts`; preserved MCP formatting in `lib/intelligence/{api,registration}.ts`. Claimed LEDGER before edits. One authorized GPT-6 Astra reviewer, no additional subagents.

Read CSI-15 HANDOFF/CHECKS, CSI-16-SESSION, ACCEPTANCE, LEDGER, CONTRACTS, SPRINT-PLAN, AFTER-16, delivery §3, root glossary and Admin organization pointer. Repository/workspace instructions and Service cards supplement those contracts. The current Owner instruction to work on main supersedes the older workspace AGENTS branch instruction. Owner's opening authorization permits task-specific commit/push without asking again; production rollout remains a separate session.

Existing 3107/3108 preview uses loopback replica `csi01:27189`, `testvantagemovers_csi07preview`, and `vantage_admin_csi07_preview`. Local session credentials remain in the OS temporary directory. The old API process returned the pre-CSI-15 Coverage shape; restarted only that loopback API from the guarded existing session, without .env or provider configuration. Final Coverage is the current shape. `available:false` with `days:0` means planning is disabled, not absent workers; backfill replicas prove the workers.

No current production probe is claimed. Broad task permissions are not represented as evidence of grants or production readiness. G6 explicitly records each unprobed capability. No production config, migration apply/verify, recording fetch, subscription action, paid model/STT, send, fleet backfill or AFTER-16 operational slice was executed.
