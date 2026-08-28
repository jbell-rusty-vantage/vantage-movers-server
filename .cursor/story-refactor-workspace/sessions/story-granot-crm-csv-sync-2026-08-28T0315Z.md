# Session story-granot-crm-csv-sync-2026-08-28T0315Z

- Date (UTC): 2026-08-28T0315Z
- Service / module: `granotCrmCsv` / `sync.service.ts`
- Lock: taken
- Branch / PR: `docs/story-refactor` / opened after #82 merged

## Stock at start

- Wave: A
- Visited / in-progress / unvisited: 13 / 1 / 23
- Recommendations on disk: 79
- Current service / next module (TRAVERSAL): `granotCrmCsv` (in-progress) / `sync.service.ts`

## This pass

- opened new service?: no
- path or skip: recommended `src/services/granotCrmCsv/sync.service.ts` → [recommendations/granot-crm-csv-sync.md](../recommendations/granot-crm-csv-sync.md)
- operations named: open a dry-run or apply pass over the latest uploaded Granot CSVs; correct a matched Form Lead’s quoted / cubic feet when the CSV disagrees; refresh a Follow Up Call Lead from the CSV row; reconcile a Booked Call Lead from the CSV row
- remaining in this service: `registry.ts`, `parser.ts`

## Stock at end

- Visited / in-progress / unvisited: 13 / 1 / 23
- Current service / next module: `granotCrmCsv` (in-progress) / `registry.ts`

## Messages posted

- 2026-08-28T0315Z next

## Ideas parked

- none

## Contradictions

- Software rule names missing `scripts/granot_crm_csv/sync-from-s3.ts`; no `/csv/sync` route; zero runtime callers besides the barrel
- Dry-run Form / Call `updateable` counted as `unchanged`
- `resolveFormLead` success status is `no_match`
- ObjectId `ref_no` skip vs HTTP exact `FormLead.ref_no`
- ObjectId `ref_no` steals Booked / Follow Up rows
- No `sync.service.test.ts`
- This checkout’s `CONTEXT.md` does not define Granot CRM CSV ingestion
