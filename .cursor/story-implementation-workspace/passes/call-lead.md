# Pass — Call Lead

- Status: implemented
- Recommendation: `.cursor/story-refactor-workspace/recommendations/leads-call-lead.md`
- Target: `src/services/leads/callLead.service.ts`
- Branch: `refactor/call-lead-story`
- Session: `impl-call-lead-2026-08-28T2152Z`

## Story names

| Old | New |
|---|---|
| `createCallLead` | `ingestCallLead` |
| `createCallLeadInTransaction` | `beginCallLeadIngestion` |
| `finalizeCallLeadCreateAfterCommit` | `completeCallLeadIngestion` |
| `createRingCentralCallLead` | `ingestRingCentralCallLead` |
| `createRingCentralCallLeadInTransaction` | `beginRingCentralCallLeadIngestion` |
| `updateCallLead` | `correctCallLead` |
| `updateCallLeadInTransaction` | alias → `correctCallLead` (pass-through deleted) |
| `persistCallLeadUpdateInTransaction` | `persistTheCorrectionAndRefreshTheBookingChain` |
| `findAllCallLeads` | `listRecentCallLeads` |
| `deleteCallLead` | `removeCallLead` |
| `deleteCallLeadInTransaction` | `beginCallLeadRemoval` |
| `buildCallLeadDeletePreviousTargets` | `rememberBothCallSheetTabsForTombstone` |

Pending-create bag named `CallLeadIngestionInProgress`. Old names remain exact aliases. Persisted `command_name` strings (`createCallLead`, `updateSourceOwnedLead`, `deleteCallLead`) unchanged. `lead.call.created` split unchanged.

## Tightenings

- Shared refuse / tombstone-both-tabs / erase for standalone vs command delete
- `updateCallLeadInTransaction` deleted as a real pass-through; alias calls `correctCallLead`
- `persistCallLeadUpdateInTransaction` → `persistTheCorrectionAndRefreshTheBookingChain`
- Missing CPL on correction still reports before command commit (visible, not moved)
- Did not drop or add `lead.call.created` on either complete path

## Parity

- Typecheck: passed
- Targeted tests: `callLead.service.test.ts`, `domainCommands.test.ts`, `ringcentral-call-lead-ingest.service.test.ts` — 35 passed
- Review subagent: returned; one parity finding fixed (source-scan now asserts `lead.call.created`, not the helper name)

## Docs touched

- `docs/knowledge/services/call-lead.md`
- `.cursor/rules/cpl-operations.mdc`
