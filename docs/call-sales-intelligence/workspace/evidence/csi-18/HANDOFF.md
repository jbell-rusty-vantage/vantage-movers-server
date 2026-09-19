# CSI-18 handoff — September 19, 2026

**Server local acceptance complete. UI local acceptance complete.** Both are implemented on the existing `sales-intelligence` branches; all work remains uncommitted. Existing CSI-07/08 changes, dependency manifests/lockfiles, MCP and the untouched design export were preserved. See INTAKE, SOURCES, CHECKS and REVIEW in this directory.

## Delivered

Server owns exact-version finding/run confirmation without effect reapplication; atomic targeted action correction and safe retraction through CSI-06; explicit suggestion application as Owner-origin work; server-authorized correction context; original-evidence and current-context durable reruns; exact instruction-version assessments; safe run/finding/effect/evidence/history reads. Retraction records blocked outcomes for later Owner work, resolved work, closure or non-reversible effects. Independent actions and nullable dates survive. Earlier assertions/effects/output remain immutable. Purged original evidence is unavailable, never substituted. Retries recover durable jobs/receipts without duplicate expensive work or STT.

Existing Owner `/sales-intelligence` panels now expose all those controls and real reads. Original model assertions/provenance, recorded effects, Owner changes and AI assessment are distinct. No assessment means Cannot determine. The BFF remains Owner/Current-only, selection stays in URL, SSE refetch remains authoritative, and conflicts require acknowledgement without discarding the draft. Unknown response retries freeze and replay the exact submitted intent/key. Pending reruns remain visible while AI is disabled.

Current transcript freshness is rechecked before effects/publication. Original historical replay still retains its findings and assessments; stale evidence cannot change work or replace the current summary. Number reruns remain synthesis-only. No MCP mutation tools or duplicate Admin policy were added.

## Code and verification

Exact ownership is recorded at the top of LEDGER. Primary server modules are `analysis/ownerCommands.ts`, `ownerReads.ts`, `ownerReanalysis.ts` and the existing preparation/runtime/application/worker seams. Admin adds `lib/api/salesIntelligenceAnalysis.ts`, `analysis-panel.tsx`, `analysis-command.tsx` and integrates through `workspace.tsx`.

Direct server: Owner replica6, real local MCP/SDK runtime23, intelligence9, Outreach24, focused analysis21; typecheck/lint pass. Direct Admin:626 tests, typecheck/focused lint pass; unrelated full-lint baseline remains 11 errors/7 warnings. Browser proof covers desktop/narrow controls, confirmation, correction, explicit suggestion application, both rerun intents, evidence/history, live draft/focus preservation, keyboard acknowledgement, same-key lost-response retry and Owner-versus-Admin access. HTTP proof confirms reads do not apply effects and rejects stale/changed requests.

Required checkpoint `1789822049070-ce55fc86`: snapshot typecheck/lint/full tests (2433 pass,115 skipped)/quality12 and final review PASS; overall **stale / CLI1** after direct-source changes. Inspected freshness helpers/read guard adopted; application proposal adapted to preserve historical replay and directly tested. No independent approval of the final source/Admin is claimed. REVIEW records this distinction and preserves unrelated prior findings.

## Resume the local preview

Reuse CSI-08 startup: from `vantage-admin`, `node scripts/csi07-local.mjs`, with the existing loopback `csi01` replica on27189. Do not replace or drop the container. Use only `testvantagemovers_csi07preview` and `vantage_admin_csi07_preview`. The launcher starts Admin3108/API3107 and stores disposable credentials privately in OS-temp `vantage-csi07-local/session.json`; never copy that file into evidence. Accounts are `owner@csi07.example.test` and `admin@csi07.example.test`. A full launcher restart rotates those local credentials. During this session API and Next were restarted separately using the existing private environment to preserve the session.

From server, `node --import tsx scripts/test-csi18-local.ts` adds a guarded synthetic fixture and runs real authenticated BFF/API proof. `http.json` identifies the latest retained-evidence fixture and exact URL. `http-correction-fixture.json` identifies the earlier correction/retraction/suggestion fixture. Do not confuse synthetic pending reruns with completed model processing: AI remains disabled in preview. Actual processing is proved by `node --import tsx scripts/test-csi-runtime.ts` on randomized disposable guarded databases and a fake model. Owner tests run with `node --import tsx scripts/test-csi-owner.ts` under the same replica guard.

## Remaining boundaries

No CSI-18 implementation work remains known within local scope. Independent final-source review can be repeated against a frozen checkout before merge. Production deployment/grants/model quality, CSI-09 settings, CSI-14 P2 and dialog integration, CSI-15 recovery/retention, CSI-16 rollout/certification, CSI-10 empty-recording replay and previous CSI-12 proposals remain separate. No production data/flags, subscriptions, paid model/STT, provider calls, messages, migrations/backfill, commit, push or deployment occurred.
