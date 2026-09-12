# Session story-models-form-lead-2026-09-12T1525Z

- Date (UTC): 2026-09-12T1525Z
- Service / module: `models` / `FormLead.ts`
- Lock: taken
- Branch / PR: `docs/story-refactor` / https://github.com/jbell-rusty-vantage/vantage-movers-server/pull/206

## Stock at start

- Wave: B
- Visited / in-progress / unvisited: 43 / 0 / 5
- Recommendations on disk: 339
- Current service / next module (TRAVERSAL): `models` (unvisited) / enumerate `src/models/`

## This pass

- opened new service?: yes — enumerated every runtime `.ts` in `src/models/` (no `*.test.ts`; no empty root barrel). Skipped `historical/index.ts` (barrel). Recommended first story-worthy module `FormLead.ts`.
- path or skip: recommended → `recommendations/models-form-lead.md` (`src/models/FormLead.ts`)
- operations named: Hold the Form Lead as the System of Record row; Fold identity before validate; Bind the selected Mongo database and declare the named lookup indexes the migration applies
- remaining in this service: `CallLead.ts` first, then the rest of the models checklist

## Stock at end

- Visited / in-progress / unvisited: 43 / 1 / 4
- Current service / next module: `models` (in-progress) / `CallLead.ts`

## Messages posted

- 2026-09-12T1525Z next

## Ideas parked

- none (do not extract a shared `getSelectedDatabaseModel` helper in this pass; search / employee-booking still import default `FormLead`)

## Contradictions

- ingest / lifecycle / duplicate ask `getFormLeadModel`; search / employee-booking candidates ask default `FormLead`
- named `FORM_LEAD_S08_INDEXES` vs unnamed browse indexes; `autoIndex: false`; migration applies S08 only
- hook name `normalizeEmployeeBookingFields` folds lid / phone / name / job_no for every Form Lead
- knowledge Service is `form-lead.md` (ingest); this file is the Mongo row
