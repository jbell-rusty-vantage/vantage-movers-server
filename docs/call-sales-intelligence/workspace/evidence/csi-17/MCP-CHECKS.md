# CSI-17 MCP and operational adapter checks

Owner-authorized GPT-6 Astra agent `/root/mcp_csi17`, September 18–19, 2026. This records direct local source checks, not independent final review or deployed proof. Main-server quality checkpoint status is recorded separately by the coordinating agent.

## Baseline and scope

MCP remote `https://github.com/jbell-rusty-vantage/vantage-movers-mcp.git`; clean `main` at `7e12815189f24d422873f54f146f1fe1033dd655`; local `sales-intelligence` absent. Coordinator claimed the server ledger and created exactly `sales-intelligence`, preserving existing work, before implementation edits. No commit/push. Parent records the actual main-server baseline and shared ownership.

Owned changes: MCP dedicated route, isolated auth/context/transport, registered tools/prompt/schema resource, broad endpoint intelligence denial, transport tests and README/CONTEXT/contract documentation. Server `analysis/operational.ts` and `operational.test.ts` implement the three added tools; main-server generated artifact/schema and core read adapters are coordinated work. Dashboard untouched.

## Direct checks

Working directory `C:\Users\Pinda\Proyectos\vantage\vantage-movers-mcp`:

```powershell
pnpm test
```

Final recorded full-suite output:

```text
ℹ tests 34
ℹ suites 0
ℹ pass 34
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 2185.1827
```

This includes actual installed MCP transport `tools/list`, `tools/call`, `prompts/list`, `prompts/get`, `resources/list`, and `resources/read`; exact twelve-tool surface and run-narrowed allowlists; direct hidden Mongo/mutation/send/fetch calls; strict authority-argument rejection; concurrent asynchronous context isolation; tampered/expired/dataset/deployment/key failures; stored-run preflight; no leaked backend error content; actual broad endpoint denial and preserved broad client discovery; generated artifact digest/tool parity; no implicit production transport default; no automatic uncertain-submit retry. Legacy `2025-03-26` requests exercise the SDK's actual stateless compatibility transport, not a mocked tool registry.

```powershell
pnpm typecheck
```

Exit 0, output `$ tsc --noEmit`. The repository has no lint script; none was invented or claimed.

Working directory `C:\Users\Pinda\Proyectos\vantage\vantage-main-server`:

```powershell
node --import tsx --import ./ops/test-setup.ts --test src/services/salesIntelligence/analysis/operational.test.ts
```

```text
✔ RingCentral search derives account/phone, bounds pages and excludes unrelated/provider-private content
✔ RingCentral reads disabled by default; invalid bounds and caller-supplied authority never reach provider
✔ call detail requires prior server admission and rechecks returned subject and id
✔ provider errors are coverage failures with no raw body; unknown pagination never claims complete
✔ Job Timeline requires authorized resolved Lead and matching server-derived source
✔ operational dataset facilitator is closed, paginated, revision-bound, and treats query as literal data
✔ fixed provider HTTP adapter uses cached token GET only, no refresh, redirects, alternate host or unbounded body
ℹ tests 7
ℹ pass 7
ℹ fail 0
ℹ cancelled 0
ℹ skipped 0
ℹ todo 0
ℹ duration_ms 15847.792
```

Full server typecheck was run during parallel implementation and reported only in-progress coordinator-owned lease/run errors after operational/reads imports existed. After those fixes, `pnpm typecheck` completed with exit 0. Coordinator records stabilized lint/replica/offline checks separately.

## Safe build

Only environment filenames were listed. Existing MCP `.env.local` was never read, loaded, renamed or changed. Source directories `app`, `lib`, `public` (if present), package/lockfile and Next/TypeScript configs were copied into `C:\Users\Pinda\AppData\Local\Temp\vantage-csi17-mcp-build-1928e0a2450941cd90348245c37985e1`; installed `node_modules` was reused through a junction. No `.env*` file was copied.

Set synthetic values only: broad/dedicated keys and signing secret are fixture strings; `TEST_MODE=true`, database `test_csi17_build`, Mongo `mongodb://127.0.0.1:1/test_csi17_build`, both API origins `http://127.0.0.1:3101`, deployment `local-build`; telemetry disabled. No server/provider client was invoked by the build.

Attempted `pnpm build --webpack` in that isolated directory. The external pnpm launcher tried dependency verification/install and safely aborted with `ERR_PNPM_ABORTED_REMOVE_MODULES_DIR_NO_TTY`. Do not enable its purge or remove shared modules. The installed script executable was then invoked directly with the same Next build arguments:

```powershell
node node_modules/next/dist/bin/next build --webpack
```

Exit 0:

```text
▲ Next.js 16.2.6 (webpack)
✓ Compiled successfully in 42s
Finished TypeScript in 21.6s
✓ Generating static pages using 6 workers (5/5)
Route (app)
┌ ○ /
├ ○ /_not-found
├ ƒ /api/intelligence-mcp
└ ƒ /api/mcp
```

After the final streaming response bound and canonical serializer change, updated source files were copied and the same direct safe build repeated. Final exit 0: `Compiled successfully in 16.7s`, `Finished TypeScript in 14.8s`, `Generating static pages using 6 workers (5/5) in 8.3s`; both dynamic MCP routes appear in the route table. This is the final MCP runtime source build. The first build remains a separate copied-source checkpoint.

The installed pnpm launcher's `runDepsStatusCheck` was inspected: its default `verifyDepsBeforeRun=install` was reacting to a copied workspace-state `allowBuilds` setting, not missing application dependencies. Without installing or purging anything, `pnpm_config_verify_deps_before_run=warn` changes that check to warning-only. After copying the regenerated final schema artifact, the actual requested package build command succeeded:

```powershell
$env:pnpm_config_verify_deps_before_run='warn'
# Same synthetic environment as above; isolated copy still contains no .env files.
pnpm build --webpack
```

```text
[WARN] Your node_modules are out of sync with your lockfile. The value of the allowBuilds setting has changed
$ next build "--webpack"
▲ Next.js 16.2.6 (webpack)
✓ Compiled successfully in 2.2s
Finished TypeScript in 3.7s
✓ Generating static pages using 6 workers (5/5) in 889ms
Route (app)
┌ ○ /
├ ○ /_not-found
├ ƒ /api/intelligence-mcp
└ ƒ /api/mcp
```

Exit 0. This final build includes the regenerated Owner-additions schema. No dependency manifest or lockfile changed, and no shared node_modules directory was replaced.

## Resolved development failures and boundaries

Initial targeted MCP test run: 6 passed / 2 failed. One assertion used ordinary JSON serialization instead of server canonical schema hashing; fixed to canonical resource bytes. The concurrent test inspected counters before consuming streaming transport response bodies; fixed to consume actual Responses. Final targeted tests and full 34-test suite pass.

All provider tests use synthetic 555-01xx records and injected fake HTTP/cached-token functions. The production adapter only supports fixed RingCentral Call Log GETs, reuses an existing unexpired cached token, and never refreshes OAuth or writes its token store. `SALES_INTELLIGENCE_PROVIDER_READS` remains default off. No RingCentral, live model, production API/Mongo, deployed MCP, media, send, migration, deployment, subscription, credential or flag operation occurred.

The Owner's additions extend the authoritative closed envelope citation record-type enum, with artifact digest `18a4746f6343c4b093ef449693b685872e3f912ae36fe87e4d49196fc1ecfed7`. MCP's full suite was rerun after regeneration (34/34 above). Directory/catalog/Job Timeline metadata is now citable only from captured snapshots; it does not establish new effect, historical speaker or message authority. Main server still validates every real snapshot, subject, instruction and speaker. Durable submission/replica races belong to the coordinator's separate evidence. CSI-13 invocation and application are not implemented here. The pre-existing CSI-14 independent P2 review-context message finding remains unresolved and outside this slice; no nudge code was changed.

## Post-snapshot bounded-loader correction

The coordinator's final audit found that the official Job Timeline Mongo loader fetched unbounded arrays before its presentation cap. The optional `maxRowsPerQuery` seam now bounds every loader `find` cursor; CSI-17 chooses 200 plus one overflow sentinel and a five-second query limit. Overflow throws `JobTimelineEvidenceLimitError`, mapped to `EVIDENCE_LIMIT_REACHED`; partial results never become evidence. Owner readers omit the option, preserving behavior. Additional coordinated files: `src/services/jobNumberTimeline/mongo-evidence-loader.ts`, its new `.test.ts`, and its Service documentation. MCP preserves `EVIDENCE_LIMIT_REACHED` and `PROVIDER_READ_UNAVAILABLE` safely rather than converting them into a generic transport error.

```powershell
node --import tsx --import ./ops/test-setup.ts --test src/services/jobNumberTimeline/*.test.ts src/services/salesIntelligence/analysis/operational.test.ts
```

Actual result: tests **78**, pass **78**, fail **0**, duration **5845.9441 ms**. Real-loader tests use an instrumented synthetic Db and exercise every initial/downstream find cursor for Form/Call Lead paths; overflow tests cover observations, decisions, receipts, Cancellations, entity changes, Lead Messages, WordPress receipts, Sheet Sync and source catalogs. They assert Mongo limit 201-equivalent under a smaller test bound, timeout, no over-fetch, and explicit failure instead of truncation. Existing optional-unbounded behavior remains tested. This correction postdates the coordinator's running quality snapshot; it must be recorded as a later direct-source change, not silently attributed to that snapshot.

Latest MCP checks after safe error-code propagation: `pnpm test` **35 passed / 0 failed**, duration **4411.4644 ms**; `pnpm typecheck` exit **0**. The safe scratch-copy `pnpm build --webpack` was rerun with the latest source and the documented warning-only dependency-status setting: exit **0**, compilation **15.3 s**, TypeScript **28.1 s**, all **5/5** static pages **10.1 s**, both MCP routes emitted. No credential files or live services were used.

The first server typecheck after the loader addition reported one test-only `TS18048` at `mongo-evidence-loader.test.ts:50` because the official result declares `leads` optional. The assertion now uses optional access (absence still fails its expected-model assertion). No runtime change was needed. The coordinator's final server checks own the post-fix typecheck result.
