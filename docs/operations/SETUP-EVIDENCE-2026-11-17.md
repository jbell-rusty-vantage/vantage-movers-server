# Local and Linux agent setup evidence — November 17, 2026

The supported local launcher and clean Linux bootstrap now establish a verified synthetic replica/API identity without loading inherited provider credentials or a checkout's private environment/token files. This is implemented and locally tested, not deployed or verified in a hosted Cursor Cloud Agent.

## Changes and boundary

- `pnpm dev` / `dev:local` launch `ops/local-runtime.ts`; `dev:identity` verifies the replica and API `/db`. Runtime identity is fixed: numeric loopback `127.0.0.1:27017`, PRIMARY `rs0`, database `testvantagemovers_agent`.
- Shared `ops/vantage/local-safety.ts` provides the allowlisted child environment and replica identity checks. The API child has no inherited provider secrets or Node options; dotenv targets the OS null device. Its empty temporary cwd excludes checkout token caches. Existing `.env` files are neither read nor modified.
- The dev server binds only to numeric loopback. Readiness checks the real `/db` connection identity, not only `/health`; occupied API ports are refused. Startup has a 60-second readiness deadline; failure or a handled termination stops the owned child and removes only its temporary directory.
- Cloud scripts use the same launcher, bounded replica/readiness checks, no `.env` generation and no forwarded Mongo port. Docker now uses Node 24 and explicit pnpm 10.13.1, matching all four existing CI Node-major pins. Frozen dependency installation is required.
- Standalone onboarding links and a byte-exact canonical glossary export are checked. Glossary relative links retain workspace semantics; they are not active runbook links.

Credential isolation is not a network sandbox. Explicit provider routes can still attempt HTTP without valid credentials. The rehearsal called only read-only API identity routes; service tests used faked providers. No production operation, provider call, seed, deployment or commit was performed.

## Windows proof

Host: Node **24.18.0**, pnpm **10.13.1**, Docker engine **29.8.2**. Native `mongod`/`mongosh` were absent from PATH; a dedicated Docker replica supplied the local target.

Executed from the working checkout:

```text
node --import tsx ops/local-runtime.ts mongo
pnpm dev
pnpm dev:identity
node --import tsx --test ops/local-runtime.test.ts
```

Mongo PRIMARY and API `/db` both matched the exact local identity. Six setup tests passed, zero skipped: readiness refusal for wrong host/name/readiness; an actual hostile-environment child plus private synthetic `.env`; unsupported arguments; active onboarding links; glossary checksum; valid Cloud JSONC/script registration. The combined CLI/setup suite subsequently passed 17 tests. Root qualification records the final integrated lint/typecheck/default suite.

## Linux proof from fresh dependencies

Built the actual `.cursor/Dockerfile`:

```text
docker build -f .cursor/Dockerfile -t vantage-agent-rehearsal:2026-11-17 .cursor
```

Image: `sha256:1a83d7dafd39b6b2ed0ae663d294c91ae6b18a9580c084ba79a6f02f18d69588`. Observed Node **24.22.3**, pnpm **10.13.1**, MongoDB **8.0.38**, mongosh **2.14.2**, Ubuntu 24.04.

The isolated container received only a read-only tar export of tracked source plus task files (2,889 entries). The export explicitly rejected private `.env`, node_modules and RingCentral token-cache paths. No host ports or credential directories were mounted. `pnpm install --frozen-lockfile` installed 641 packages from an empty Linux dependency tree in 19.6 seconds. pnpm reported ignored esbuild build scripts; its platform package worked in the actual subsequent execution.

Executed inside that source tree:

```text
bash .cursor/scripts/ensure-cloud-runtime.sh
pnpm dev:identity
node --import tsx --test ops/local-runtime.test.ts
pnpm vantage -- test sheet-sync --suite fast --json
pnpm vantage -- doctor --profile sheet-replica --json
pnpm vantage -- test sheet-sync --suite replica --json
node --import tsx --test ops/local-runtime.test.ts ops/vantage/cli.test.ts
```

Bootstrap was run with synthetic hostile inherited Atlas URI, `TEST_MODE=false`, queued Sheets mode and provider/future-secret sentinels. A synthetic private `.env` was placed in the checkout before launch. It retained SHA256 `f525c912d3ea1629e463adf5e011a8f517761b0f966e73e00115b11f4234d937` before/after bootstrap.

Observed actual API child environment through Linux `/proc`: zero inherited CRM, RingCentral, Google or unknown-future provider sentinel keys; `TEST_MODE=true`, `SHEET_SYNC_MODE=disabled`, the exact local Mongo target/database, `DOTENV_CONFIG_PATH=/dev/null`, and a new `/tmp/vantage-local-api-*` cwd. API identity verification passed.

| Proof | Result |
| --- | --- |
| Linux bootstrap, PRIMARY and API `/db` identity | Passed |
| Setup tests | 6 passed, 0 skipped |
| Sheet fast suite | 78 passed, 0 skipped |
| Sheet real replica suite on separate local `27129/sheetRecoveryProof` | 7 passed, 0 skipped; harness-owned PID database created/dropped |
| Combined final setup/CLI tests | 17 passed, 0 skipped |
| Launcher SIGTERM lifecycle | Owned API child exited and exact temporary cwd removed |

The export preceded final root-only test/doc/status-registration edits. The latest shared safety and CLI test files were copied into the container before the final 17-test run. The launcher/bootstrap/image-definition hashes matched the final working tree; the shared safety hash matched after that refresh:

| File | SHA256 |
| --- | --- |
| `ops/local-runtime.ts` | `bc569c846e130c36064ed4b7aaca054be555adef62cbf2b326842ac29552b258` |
| `ops/vantage/local-safety.ts` | `6fbc3f6c506dd146e50d1fadd2f46d9bf41fdcb5a85f2a34ff2b168efd503e9d` |
| `.cursor/scripts/ensure-cloud-runtime.sh` | `aaf05823c72c77f2fd8d951a2a523fe85d81efed3c96a949aca041d122228e71` |
| `.cursor/Dockerfile` | `9ad7d2fb016cf3bfe93c2a7c090313f4de60c4fee701543a19a803aa35458a23` |

## Failed attempts and corrections

- Original `.cursor/environment.json` was invalid JSONC: a missing comma separated the API description and command. Fixed; actual parser and registration tests now cover it.
- Original API launch inherited provider credentials, allowed dotenv to refill removed values, reused an inherited API secret and accepted an existing server based only on health. Replaced with the shared allowlist, null dotenv target, synthetic secret and exact identity checks.
- Initial launcher used the tsx CLI, which created a grandchild on Windows. Replaced with direct Node plus the resolved tsx import so the API is the owned child. The initial owned processes were stopped; Linux handled-termination cleanup was subsequently verified.
- A Windows cold start hit the initial 30-second readiness deadline while Docker build and concurrent checks were active. It failed closed and left no API process. Increased the bounded deadline to 60 seconds; the Windows and fresh Linux reruns passed.
- An explicit lint invocation found `ops/dev-server.ts` was outside the parser glob. Added it to the final lint registration alongside local-runtime/operator files.
- A redundant late typecheck was stopped to avoid contending with the root and independent-review checks; it was not counted as a pass. Earlier typecheck passed; final integrated proof belongs to the qualification record.
- API startup emitted an existing duplicate Mongoose schema-index warning for `ReportingDelivery {run_id:1}`. This slice did not change that schema.

Remaining qualification: a hosted Cursor environment must actually adopt/rebuild this repository configuration. An existing dashboard-managed VM does not receive these changes merely because the files changed. Node 22 was not retested; the supported major now agrees with existing Node 24 CI. Production and real-provider delivery remain outside this rehearsal.
