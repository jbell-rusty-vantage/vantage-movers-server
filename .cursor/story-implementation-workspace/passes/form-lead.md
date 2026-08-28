# Pass — Form Lead

- Status: in-progress
- Recommendation: `.cursor/story-refactor-workspace/recommendations/form-lead.md`
- Target: `src/services/leads/formLead.service.ts`
- Branch: `refactor/form-lead-story`
- Session: `impl-form-lead-2026-08-28T2130Z`

## Story names

| Old | New |
|---|---|
| `createFormLead` | `ingestFormLead` |
| `createFormLeadInTransaction` | `beginFormLeadIngestion` |
| `finalizeFormLeadCreateAfterCommit` | `completeFormLeadIngestion` |
| `updateFormLead` | `correctFormLead` |
| `findFormLead` | `findFormLeadForEnrichment` |
| `findAllFormLeads` | `listRecentFormLeads` |
| `deleteFormLead` | `removeFormLead` |
| `deleteFormLeadInTransaction` | `beginFormLeadRemoval` |
| `FormLeadCreateTransactionResult` | `FormLeadIngestionInProgress` |

Old names remain exact aliases. Persisted `command_name: "createFormLead"`
unchanged. ADR-0002 sheet-then-CRM order unchanged.

## Tightenings

- Shared refuse / tombstone / erase for standalone vs command delete
- `updateFormLeadInTransaction` deleted as a pass-through
- `persistFormLeadUpdateInTransaction` → `persistTheCorrectionAndRefreshTheBookingChain`

## Parity

- Typecheck: passed
- Targeted tests: `formLead.service.test.ts`, `domainCommands.test.ts`,
  `runWorkflow.test.ts` — 29 passed
- Review subagent: pending

## Docs touched

- `docs/knowledge/services/form-lead.md`
- `docs/knowledge/services/call-lead.md` (cross-link)
- `.cursor/rules/form-lead-granot-crm.mdc`
