# SERVER team — cloud session brief (vantage-main-server)

Phase P1 of [SPRINT-RUNBOOK.md](../SPRINT-RUNBOOK.md) (local runs: follow its P1 Local rules).

Paste the **Session prompt** below into each cloud agent session for this repository, replacing `<LANE>` with `S1`, `S2` or `S3`. Each lane can run as its own cloud session in parallel. One session may instead run all three lanes in order S2 → S1 → S3 with sub-agents.

## Lanes

| Lane | Work packages ([IMPLEMENTATION-PLAN.md](../IMPLEMENTATION-PLAN.md) §7) | Branch | Starts |
| --- | --- | --- | --- |
| S1 Foundation & API | SRV-0, SRV-1, SRV-2, SRV-3, SRV-7, SRV-8, SRV-9, SRV-T | `feat/outreach-desk-s1` | immediately; land SRV-3 models early and merge them into `feat/outreach-desk` so S3 can build on them |
| S2 Engine | SRV-4 (pure evaluator, no Mongo) | `feat/outreach-desk-s2` | immediately |
| S3 Capture & goals | SRV-5, then SRV-6 | `feat/outreach-desk-s3` | immediately (SRV-5); SRV-6 after the SRV-3 models merge |

Integration branch: `feat/outreach-desk` (create from `main` if absent). Each lane rebases on it and merges into it after its tests pass. If two lanes need the same shared file (`src/app.ts`, `vercel.json`, `config/domain/salesIntelligence.ts` stage list, `models/salesIntelligence/registry.ts`), S1 owns it; others send S1 a handoff ([HANDOFF-TEMPLATE.md](HANDOFF-TEMPLATE.md)) or add their entry in a separate, clearly-labelled commit.

## Session prompt

```text
You are the SERVER <LANE> lane for the Sales Outreach Desk in vantage-main-server (Express + TypeScript + MongoDB).

Read first, in order:
1. AGENTS.md, CLOUD_AGENTS.md, docs/knowledge/environment.md (env names; never grep process.env to discover them).
2. docs/sales-outreach-desk/IMPLEMENTATION-PLAN.md (the build plan; it wins over older packet text about code reuse, routes, roles and collections).
3. docs/sales-outreach-desk/SPECIFICATION.md §§2–14 and FINAL-POLICY-REVIEW.md (business rules; do not change them).
4. docs/sales-outreach-desk/CONTRACTS.md (DTOs, config, errors) as amended by IMPLEMENTATION-PLAN §4–§6.
5. docs/sales-outreach-desk/RINGCENTRAL-CAPTURE.md (S3 must read fully; S1/S2 skim §8).
6. docs/sales-outreach-desk/CODE-MAP.md and docs/server-admin-slimming/NEW-DESK-DELTA.md.
7. Your lane's work packages in IMPLEMENTATION-PLAN §7 and workspace/SERVER-TEAM.md.

Setup:
- git fetch; create/checkout feat/outreach-desk from origin/main if missing, then your lane branch feat/outreach-desk-<lane> from it.
- Start the replica runtime exactly as CLOUD_AGENTS.md says (.cursor/scripts/ensure-cloud-runtime.sh, .cursor/scripts/start-api.sh). TEST_MODE=true, database testvantagemovers on 127.0.0.1 only.
- Run `node docs/sales-outreach-desk/validate.mjs` (must pass), `pnpm typecheck`, `pnpm test` to record the baseline (note any pre-existing failures; do not fix unrelated ones).
- Claim your work packages in docs/sales-outreach-desk/workspace/LEDGER.md.

Rules:
- Business policy lives on the server; values are persisted in sales_outreach_configuration (never env vars, never hard-coded defaults that activate behaviour). Missing/invalid config fails closed.
- Deterministic code only: no LLM, transcription, summaries or AI suggestions. Do not touch retired job stages.
- Every contract fixture in docs/sales-outreach-desk/contracts/fixtures/*.json that your lane covers becomes an automated test. Add the END-TO-END-RUN.md §3 scenarios your lane covers as named tests.
- No provider calls in tests (mock RingCentral). No production database, no deploy, no push to main, no subscription creation, no customer sends. The only production-touching artifact you may write is a read-only proof script for the operator to run.
- Use existing seams: executeCsiCommand/csiCas/command ledger, entity_changes + domain command executor, sales_intelligence_jobs + jobDispatch + cron recovery, salesIntelligence/live.ts machinery, rateLimitGate. Register new job stages and command kinds explicitly.
- Indexes: model files declare them; a script builds them; nothing builds indexes at startup or in a GET.
- Keep services small and in src/services/salesOutreach/**. Update docs/knowledge/services with a new `sales-outreach-desk.md` Service doc (OKF frontmatter, status: draft) describing what you built.

Finish:
- pnpm typecheck, pnpm lint, pnpm test (and any replica runner you added, e.g. a new `pnpm test:outreach:replica`) green; record exact commands and results in docs/sales-outreach-desk/workspace/evidence/<lane>.md.
- Run `pnpm finish-work --provider <your provider>` per AGENTS.md if available in this environment.
- Merge into feat/outreach-desk (no force-push). Update LEDGER status and write a handoff naming: endpoints/DTO changes (admin consumes them), new env/infra needs, open proofs.
```

## Lane notes

**S1.**
- SRV-1: add `manager` to the trusted actor role set (`trustedActorCanonical.ts`). Add a `requireOutreachActor` guard. Allow Manager on Daily Operations `GET /`, `/live` and `/events`.
- SRV-3: restore `leadInstant.ts` from git `6a374fab`. The `entity_changes` tail keeps a durable cursor of `(applied_at, _id)` with a short overlap. Enrollment must expose `report`, `apply` and `verify`; `report` makes zero writes.
- SRV-7 reassign: add a canonical Lead command that writes `receiver_agent` with source `manual` and emits an EntityChange.
- SRV-8: queue sorting and filtering happen in Mongo before paging. Cursors are signed and bound to scope.

**S2.**
- Pure TypeScript under `src/services/salesOutreach/engine/`.
- It takes inputs and `as_of` and returns requirements. It never reads the clock or the DB.
- It is DST-safe: build New York dates with `Intl`; never add 86,400,000 ms to get the next day.
- Start from fixtures `p01` through `p10b`. Every fixture assertion must pass.
- Publish the engine's input/output TypeScript types early so S1 and S3 can code against them.

**S3.**
- SRV-5 follows RINGCENTRAL-CAPTURE §3–§7 and §9 exactly. Its read-only E01 proof script is `ops/ringcentral/prove-rep-sms-access.ts`.
- SRV-6 derives `sales_outreach_contact_events` from `call_interactions` and SMS evidence, using IMPL-06 and IMPL-07 and P07a–g. It also builds `sales_outreach_rep_day_projections` (P08a, full-scope goal).
- Test that transfer legs, monitoring, merged/purged rows, internal calls, too-close retries and restricted contact each earn the correct credit.
