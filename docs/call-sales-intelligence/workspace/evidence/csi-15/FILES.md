# CSI-15 file manifest

Paths are repository-relative. This list separates task changes from protected existing work.

## Server

- `.cursor/rules/production-url.mdc`
- `.cursor/skills/hit-vantage-api/SKILL.md`
- `docs/call-sales-intelligence/workspace/CONTRACTS.md`
- `docs/call-sales-intelligence/workspace/evidence/csi-15/CHECKS.md`
- `docs/call-sales-intelligence/workspace/evidence/csi-15/FILES.md`
- `docs/call-sales-intelligence/workspace/evidence/csi-15/HANDOFF.md`
- `docs/call-sales-intelligence/workspace/evidence/csi-15/INTAKE.md`
- `docs/call-sales-intelligence/workspace/evidence/csi-15/REVIEW.md`
- `docs/call-sales-intelligence/workspace/evidence/csi-15/SOURCES.md`
- `docs/call-sales-intelligence/workspace/LEDGER.md`
- `docs/knowledge/services/number-activity-reads.md`
- `docs/knowledge/services/sales-intelligence-analysis.md`
- `docs/knowledge/services/sales-intelligence-foundation.md`
- `docs/knowledge/services/sales-intelligence-live.md`
- `docs/knowledge/services/sales-intelligence-outreach.md`
- `scripts/test-csi-backfill.replica.test.ts`
- `scripts/test-csi-backfill.ts`
- `scripts/test-csi15-budget.replica.test.ts`
- `scripts/test-csi15-budget.ts`
- `scripts/test-csi15-period.replica.test.ts`
- `scripts/test-csi15-period.ts`
- `scripts/test-csi15-retention.replica.test.ts`
- `scripts/test-csi15-retention.ts`
- `src/config/domain/salesIntelligence.ts`
- `src/models/CallInteraction.ts`
- `src/models/ContactNumber.ts`
- `src/models/LeadConversation.ts`
- `src/models/salesIntelligence/capture.ts`
- `src/models/salesIntelligence/intelligence.ts`
- `src/routes/sales-intelligence-admin.routes.test.ts`
- `src/routes/sales-intelligence-admin.routes.ts`
- `src/routes/sales-intelligence-cron.routes.test.ts`
- `src/routes/sales-intelligence-cron.routes.ts`
- `src/services/numberActivity/contactNumbers.ts`
- `src/services/numberActivity/jobDispatch.ts`
- `src/services/numberActivity/persistInteraction.ts`
- `src/services/numberActivity/reads.test.ts`
- `src/services/numberActivity/reconcileCallLog.ts`
- `src/services/numberActivity/search.ts`
- `src/services/numberActivity/timeline.ts`
- `src/services/salesIntelligence/aiBudget.ts`
- `src/services/salesIntelligence/analysis/apply.ts`
- `src/services/salesIntelligence/analysis/capture.ts`
- `src/services/salesIntelligence/analysis/lease.ts`
- `src/services/salesIntelligence/analysis/ownerReads.ts`
- `src/services/salesIntelligence/analysis/ownerReanalysis.ts`
- `src/services/salesIntelligence/analysis/reads.ts`
- `src/services/salesIntelligence/analysis/run.ts`
- `src/services/salesIntelligence/analysis/sources.ts`
- `src/services/salesIntelligence/analysis/submit.ts`
- `src/services/salesIntelligence/analysis/worker.ts`
- `src/services/salesIntelligence/auth.ts`
- `src/services/salesIntelligence/backfill/activate.ts`
- `src/services/salesIntelligence/backfill/coverage.ts`
- `src/services/salesIntelligence/backfill/livePriority.ts`
- `src/services/salesIntelligence/backfill/plan.ts`
- `src/services/salesIntelligence/backfill/readiness.ts`
- `src/services/salesIntelligence/backfill/step.ts`
- `src/services/salesIntelligence/backfill/windows.test.ts`
- `src/services/salesIntelligence/backfill/windows.ts`
- `src/services/salesIntelligence/backfill/windowWork.ts`
- `src/services/salesIntelligence/backfill/worker.ts`
- `src/services/salesIntelligence/budgetPeriod.test.ts`
- `src/services/salesIntelligence/budgetPeriod.ts`
- `src/services/salesIntelligence/conversations/discover.ts`
- `src/services/salesIntelligence/conversations/media.ts`
- `src/services/salesIntelligence/conversations/transcribe.ts`
- `src/services/salesIntelligence/conversations/transcriptionScheduling.ts`
- `src/services/salesIntelligence/dto.ts`
- `src/services/salesIntelligence/jobs.ts`
- `src/services/salesIntelligence/outreach/attention.ts`
- `src/services/salesIntelligence/outreach/ensure.ts`
- `src/services/salesIntelligence/outreach/reads.ts`
- `src/services/salesIntelligence/outreach/store.ts`
- `src/services/salesIntelligence/ownerCoverage.ts`
- `src/services/salesIntelligence/retention.ts`
- `src/services/salesIntelligence/retentionPolicy.ts`
- `vercel.json`

## Admin

- `components/sales-intelligence/coverage-view.tsx`
- `lib/api/salesIntelligence.ts`
- `lib/api/salesIntelligenceCoverage.test.ts`

## Protected existing work

- `docs/call-sales-intelligence/06-delivery-plan-and-acceptance.md`
- `docs/call-sales-intelligence/workspace/NEXT-SESSION.md`
- `docs/call-sales-intelligence/workspace/SPRINT-PLAN.md`
- `docs/call-sales-intelligence/workspace/teams/f-integration.md`
- `docs/call-sales-intelligence/workspace/CSI-16-SESSION.md`
- `docs/call-sales-intelligence/workspace/AFTER-16.md`

Additional concurrent external server changes: `package.json` (probe script entry) and `scripts/probe-intelligence-mcp-agent.ts`. They are preserved, excluded from this task manifest and were not invoked.

MCP was not edited by CSI-15. Concurrent external changes were observed in `lib/intelligence/api.ts` and `lib/intelligence/registration.ts` and preserved. Source HEADs/indexes unchanged; no commit or push. Scratch runners/logs and independent isolated quality workspaces remain under server `.git/`.
