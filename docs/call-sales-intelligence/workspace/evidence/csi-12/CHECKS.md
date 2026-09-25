# CSI-12 checks — September 18, 2026

Repository `vantage-main-server`; branch `sales-intelligence`; baseline `63b3dfb`. No production/live-provider operations, flag enablement, commit or push.

| Check | Exact command | Result / artifact |
| --- | --- | --- |
| TypeScript | `pnpm typecheck` | Final source exit 0; [typecheck.txt](typecheck.txt). |
| CSI-12 replica | `pnpm test:csi:transcription:replica` | Final expanded 19/19 passed; [replica-tests.txt](replica-tests.txt). |
| Focused | Command below | 13/13; [focused-tests.txt](focused-tests.txt). |
| CSI-01 | `pnpm test:csi:replica` | 15/15; [foundation-replica.txt](foundation-replica.txt). |
| CSI-02 | `pnpm test:csi:capture:replica` | 12/12; [capture-replica.txt](capture-replica.txt). |
| CSI-03 | `pnpm test:csi:fanout:replica` | 11/11; [fanout-replica.txt](fanout-replica.txt). |
| CSI-04 numbers | `pnpm test:csi:numbers:replica` | 7/7; [numbers-replica.txt](numbers-replica.txt). |
| CSI-04 reads | `pnpm test:csi:reads:replica` | 10/10; [reads-replica.txt](reads-replica.txt). |
| CSI-11 | `pnpm test:csi:media:replica` | 20/20; [media-replica.txt](media-replica.txt). |
| Qualification | Command below | 105 pass, 3 existing opt-in skips; [qualification-tests.txt](qualification-tests.txt). |
| Full offline suite | `pnpm test` | 2380 pass, 114 skips, 0 failures; [offline-tests.txt](offline-tests.txt). Rerun after final empty-result and eligibility-version fixes. |
| Lint | `pnpm lint` | Exit 0; [lint.txt](lint.txt). |
| Independent review | Separate read-only agent; focused command in report | All actionable findings resolved; [INDEPENDENT-REVIEW.md](INDEPENDENT-REVIEW.md). |

```powershell
node --import tsx --import ./ops/test-setup.ts --test src/services/conversations/redaction.test.ts src/services/conversations/transcriptionProvider.test.ts src/services/salesIntelligence/conversations/transcript.test.ts src/services/salesIntelligence/conversations/transcriptionWiring.test.ts src/services/salesIntelligence/conversations/wiring.test.ts
node --import tsx --import ./ops/test-setup.ts --test "src/services/ringcentral/*.test.ts" "src/routes/ringcentral-cron.routes.test.ts" "src/routes/ringcentral-webhook.routes.test.ts"
```

The CSI-12 runner does not load `.env`; it overrides URI and TEST_MODE, blanks Gateway/Blob credentials, uses a fresh random `testvantagemovers_csi12*` database on `mongodb://127.0.0.1:27189/?replicaSet=csi01`, checks replica identity, applies existing indexes only there, and drops its database after tests. Existing `csi01` Docker replica was reused; no new container/service. Synthetic audio and STT are in-memory; spies check Mongo and captured application/console logs for raw secret fixtures. Qualification cursor remains empty/unchanged, and qualification runtime files have no diff.

Implementation iterations exposed a TypeScript ObjectId-reference mismatch, JSON snapshot date serialization and unsigned synthetic policy actor setup. Corrected before passing proof; no live capability was inferred from these tests. The initial interrupted setup run left `testvantagemovers_csi128d909ebd5d70`; the following guarded cleanup completed with `{ok:1,dropped:...}`:

```powershell
docker exec csi01 mongosh --port 27189 --quiet --eval 'const name="testvantagemovers_csi128d909ebd5d70"; if(db.hello().setName!=="csi01" || !name.startsWith("testvantagemovers_csi12")) throw Error("guard"); print(JSON.stringify(db.getSiblingDB(name).dropDatabase()));'
```

Adapter evidence: installed Gateway `doGenerate` supports configurable transcription model, optional segments, providerMetadata and an abort signal. Synthetic fetch verifies exactly one request and sanitized error handling. [Gateway model documentation](https://vercel.com/ai-gateway/models/gpt-4o-mini-transcribe) describes transcription support; [Gateway cost metadata](https://examples.vercel.com/academy/ai-gateway/ai-gateway-pricing) documents USD `providerMetadata.gateway.cost`. Neither is production credential/format/billing proof; missing metadata remains explicitly unknown.

## Final validation

Final source: expanded replica 19/19, focused 13/13, typecheck exit 0, lint exit 0, `git -c core.safecrlf=false diff --check` exit 0. No qualification runtime/cursor files changed. Reviewer approved all actionable findings' resolutions, including preserved seventh transient attempt, restoration of excluded skips and scheduler starvation prevention.

`pnpm finish-work --provider codex` was invoked as originally required. Its isolated review found two additional eligibility gaps, now resolved more fully in the main source and verified by the final 19/19 replica. Its generated proposal has a scheduler TypeScript inference error plus an older test-fixture typing error; it is not the final source and must not be applied. The source fingerprint advanced, protecting the working tree. The final source typecheck passed after these corrections. Reports remain under `.git/vantage-quality/runs/1789746095447-5bbf7eab/`; finished failed (exit 1) because its isolated proposal typecheck failed; no proposal was applied. New concurrent `.cursor/rules/quality-checkpoints.mdc` / `quality-inspect-and-run.mdc` edits were preserved and are not owned by CSI-12. Updated rules request a Cursor final checkpoint.

`pnpm finish-work --provider cursor` completed at 16:33 UTC. Run `1789747305796-a9c475ed`: typecheck, lint, full tests and quality-runner tests all exit 0; final review `QUALITY_RESULT: PASS`. Overall status `stale` (CLI exit 1), because the main source advanced while the isolated proposal ran. No proposal applied. Its empty-output and excluded-analysis findings were implemented more fully in the main source, independently reviewed and proven by the final 19/19 replica, 13/13 focused, typecheck/lint and full 2380-pass/114-skip suite. The optional recovery fallthrough was declined to preserve one bounded recording per invocation. The proposal's stale evidence/ledger observations are resolved in this final packet. No further hook rerun is needed solely for evidence bookkeeping; this is not a claim that its isolated patch is the final source.

Final branch/patch commands: `git branch --show-current`, `git rev-parse --short HEAD`, `git -c core.safecrlf=false diff --check`, `git -c core.safecrlf=false status --short`. Branch sales-intelligence, HEAD 63b3dfb; patch check exit 0. All changes remain uncommitted. Concurrent quality-rule changes are preserved and excluded from CSI-12 ownership.