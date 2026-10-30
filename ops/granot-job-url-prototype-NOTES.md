# Granot job URL retrieval prototype — 2026-10-30

Question: can the Josh-only Outreach Desk pilot obtain exact Granot job-form URLs from stored Job Numbers, without the rep manually finding each job?

**Answer: automated retrieval works on the live samples. A permanent URL derived from Job Number is not established.**

The throwaway discovery script was absorbed into `src/services/granotHttpCollector/jobFormLink.ts` and `src/services/salesOutreach/granotLink.ts` on 2026-10-30. These are discovery findings; the running pilot contract is in `docs/knowledge/services/sales-outreach-desk.md`. The original `pnpm prototype:granot-job-url` runner was removed.

This is throwaway discovery tooling. It uses existing credential bindings and the canonical authenticated HTTP client. Raw-driver Lead and Agent access is read-only, with model auto-index/create disabled. The only Mongo writes acquire, renew and release `granot:automation:account`. Granot requests log in, retrieve reports, select jobs, search and read forms; no job updates, lifecycle receipts, Sheets or customer communications occur. Captures and proposed Lead URL values are saved to a clearly marked PROTOTYPE directory in the Windows temp folder. Credentials and raw HTML do not enter this repository.

## Observations

- Estimates report rows expose session-bearing `mprep~printselect` links. Requesting one returns the full job form, including its `mpcharge~chargeswc~<UUID>` URL.
- Advanced Search accepts a POST to the form's `mv~searchret~<session>` action with `ORDNO=<Job Number>`. In the tested unique matches it returns the job form directly. This bypasses report date coverage for per-Lead retrieval.
- The same job opened twice produces different UUIDs, even within the same login. The UUID cannot be treated as an immutable job identifier.
- The first URL reopened the correct job after selecting a different job, and after another authenticated login. Long-term expiration, logout, another user's browser, and Josh's permissions have **not** been qualified.
- The form's visible `Job No:` was checked against the requested number. Existing `jobNumbersEquivalent` handles stored digit-only values and Granot's `P` prefix. This does not authorize choosing among ambiguous results.
- Live sample: two report jobs, one repeated selection, direct reload and fresh-login reuse; plus oldest/newest assigned Leads by `_id` for each of Form and Call. All four Josh Lead searches returned equivalent Job Numbers and an exact charges URL. `_id` ordering is a sample selection device, not proof of provider age.
- Corpus at the read: 5,702 Form Leads and 1,257 Call Leads with nonblank string `job_no`. Josh has 493 Form + 123 Call = 616. These are Lead counts, not distinct jobs, open Desk subjects, or full retrieval coverage. Form/Call siblings may share a job. No bulk retrieval was performed.
- Final rehearsal: 35 HTTP requests; zero domain mutations. `pnpm prototype:granot-job-url`, JavaScript syntax check and `git diff --check` succeeded.

## Pilot implementation still needed

1. Verify link lifetime and opening behavior in Josh's own browser/account. The automation account's generated navigation URL is not proof of Josh's authorization. Do not assume a new tab will open as Josh.
2. Persist an additive cache on the Lead only after unique account/job identity verification: observed job number, URL, capture time and verification status. Treat it as refreshable navigation evidence, not a Granot Record Link identity. Never save cookies or the main login session. Pair ownership/derived partner behavior must follow the existing Form-sibling contract.
3. Resolve missing/expired URLs through the existing leased reader. Search History may be necessary for archived jobs; missing, ambiguous, inaccessible and mismatched results must remain explicit outcomes. No synthetic URL or guessed job match.
4. Expose the button only on Josh's Outreach Desk, with the same server-side actor and assigned-subject authorization as other Desk reads. UI hiding alone is insufficient.
5. Run a resumable per-job backfill to measure actual coverage before claiming all Leads have working links. The prototype proves retrieval, not universal availability or production readiness.

There are no schema migrations, deployed changes or new environment settings. Rollback is removal of the prototype script, task-runner entry and this note; private temporary captures can be removed separately. Delete or absorb the script once the qualified implementation replaces it.
