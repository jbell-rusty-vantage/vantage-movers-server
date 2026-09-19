# CSI-17 owned and coordinated files

Both branches remain `sales-intelligence`, at the handoff baseline HEADs. Existing server CSI-10/14 modifications/untracked files are preserved and are not all authored by this task.

## Server additions

- `src/services/salesIntelligence/analysis/contracts.ts`, `contracts.test.ts`
- `src/services/salesIntelligence/analysis/lease.ts`, `run.ts`, `capture.ts`, `submit.ts`
- `src/services/salesIntelligence/analysis/reads.ts`, `reads.test.ts`
- `src/services/salesIntelligence/analysis/operational.ts`, `operational.test.ts`
- `src/routes/sales-intelligence-internal.routes.ts`
- `scripts/generate-csi-intelligence-contract.ts`
- `scripts/test-csi-intelligence.ts`, `test-csi-intelligence.replica.test.ts`
- `scripts/test-csi-intelligence-reads.ts`, `test-csi-intelligence-reads.replica.test.ts`
- `docs/knowledge/services/sales-intelligence-analysis.md`
- This `docs/call-sales-intelligence/workspace/evidence/csi-17/` directory.

## Server coordinated edits

- `src/services/jobNumberTimeline/mongo-evidence-loader.ts`, `mongo-evidence-loader.test.ts`: optional bounded read seam, per-query overflow rejection and real-loader regression coverage; `docs/knowledge/services/job-number-timeline.md` records the unchanged default behavior.
- `src/config/domain/salesIntelligence.ts`: three added closed tools, two error codes, default-off provider-read flag.
- `src/models/salesIntelligence/intelligence.ts`: run schema digest/manifest/counters and protected final fields; submission manifest binding.
- `src/models/salesIntelligence/infrastructure.ts`: job evidence lease fence.
- `src/services/salesIntelligence/evidence.ts`: validate each cited record within a multi-record snapshot.
- `src/validation/intelligence/intelligenceEnvelope.validation.ts`: six Owner-added citation kinds, strict existing shape and refinements retained.
- `src/routes/v1.routes.ts`: internal router after existing boundary.
- `package.json`: schema generation and two disposable proof scripts.
- `docs/index.md`, workspace `CONTRACTS.md`, `LEDGER.md`, `teams/d-intelligence.md`.

## MCP additions and edits

- `app/api/intelligence-mcp/route.ts`
- `lib/intelligence/auth.ts`, `context.ts`, `api.ts`, `handler.ts`, `registration.ts`, `transport.test.ts`
- `lib/intelligence/generated/intelligence-contract-v1.json` (server-generated)
- `lib/auth.ts`, `app/api/mcp/route.ts`: deny intelligence credentials on broad endpoint; preserve intended broad auth behavior.
- `README.md`, `CONTEXT.md`, `docs/intelligence-mcp.md`.

No dashboard, dependency lockfile, production environment or credential file was edited. No stage/commit/push occurred. Quality checkpoint changes live in its isolated snapshot only unless explicitly recorded as manually ported CSI-17 fixes.
