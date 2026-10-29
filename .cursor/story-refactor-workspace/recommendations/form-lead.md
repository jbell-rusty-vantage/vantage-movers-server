# Form Lead

- Status: reviewed starter, 2026-10-29
- Target: `src/services/leads/formLead.service.ts`
- Current declared exports (local declarations; re-exports are additional): `FormLeadIngestionInProgress`, `FormLeadCreateTransactionResult`, `ingestFormLead`, `beginFormLeadIngestion`, `completeFormLeadIngestion`, `correctFormLead`, `persistTheCorrectionAndRefreshTheBookingChain`, `listRecentFormLeads`, `findFormLeadForEnrichment`, `removeFormLead`, `beginFormLeadRemoval`, `createFormLead`, `createFormLeadInTransaction`, `finalizeFormLeadCreateAfterCommit`, `updateFormLead`, `updateFormLeadInTransaction`, `persistFormLeadUpdateInTransaction`, `findAllFormLeads`, `findFormLead`, `deleteFormLead`, `deleteFormLeadInTransaction`.
- Evidence: `src/services/leads/formLead.service.ts`, `docs/knowledge/services/form-lead.md`, `.cursor/story-refactor-workspace/DIRECTIVE.md`

## Recommendation

Use the existing operation names as the public seam; improve private names only where they clarify a decision in this story, preserving exports and callers. Keep the operation in its current module and avoid a new service class or a split by CRUD verb.

The Form Lead story rename is already landed: `ingestFormLead`, `beginFormLeadIngestion`, `completeFormLeadIngestion`, `correctFormLead`, and `removeFormLead` exist, alongside compatibility exports. Do not implement that rename again. Focus on meaningful behavior tests around the existing seams, including duplicate handling, CPL snapshots, transaction and post-commit Sheet Sync and CRM ordering.

## Parity checks

Read the target and its current callers before applying any change. Exercise the exported operation through existing tests, including success, empty or rejected input, and the relevant error and side-effect paths. Preserve response shapes and ordering; a test must fail on a changed result rather than swallow errors. Follow the matching Service document for the operation-specific invariant.

**Target-specific checks:** Preserve these existing behaviors: findFormLeadForEnrichment does not return a Duplicate Lead; findFormLeadForEnrichment is not found when the Form Lead is missing; correctFormLead refuses quoted and cubic feet on a Duplicate Lead. See `src/services/leads/formLead.service.test.ts`.

**Specific parity:** Preserve duplicate classification and marking matching Call Leads with Form Fill; snapshot CPL through the temporal schedule, save intent transactionally, and retain the existing CRM, messaging and Sheet Sync post-commit ordering.

## Source-verified implementation constraints (2026-10-29)

Current story names are already implemented; this brief should guide remaining proof, not repeat a rename. CRM label comes from assignment snapshot and leadno from persisted ref_no. Preserve server submission reuse versus a newly stored Duplicate Lead, nonduplicate Form Fill marking, temporal CPL, and the real finalizer order even if Sheets failure currently prevents later CRM work. Newly drafted dirty-branch tests have not been executed/reviewed by this catalog task; assertions cited here describe proposed coverage, not passed qualification.
