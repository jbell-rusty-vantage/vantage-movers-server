# Session story-granot-crm-csv-upload-2026-08-28T0245Z

- Date (UTC): 2026-08-28T0245Z
- Service / module: `granotCrmCsv` / `upload.service.ts`
- Lock: taken
- Branch / PR: `docs/story-refactor` / https://github.com/jbell-rusty-vantage/vantage-movers-server/pull/82

## Stock at start

- Wave: A
- Visited / in-progress / unvisited: 13 / 0 / 24
- Recommendations on disk: 78
- Current service / next module (TRAVERSAL): `granotHttpCollector` (visited) / open `granotCrmCsv` (enumerate first)

## This pass

- opened new service?: yes — modules enumerated: `upload.service.ts`, `sync.service.ts`, `registry.ts`, `parser.ts`, `keys.ts` (skip — key fold), `storage.ts` (skip — S3 adapter), `types.ts` (skip — type-only), `index.ts` (skip — barrel)
- path or skip: recommended `src/services/granotCrmCsv/upload.service.ts` → [recommendations/granot-crm-csv-upload.md](../recommendations/granot-crm-csv-upload.md)
- operations named: bind this Granot CSV download to a workspace source; record that this Granot CSV has not changed; store the changed file as latest plus history, then remember the ingestion
- remaining in this service: `sync.service.ts`, `registry.ts`, `parser.ts`

## Stock at end

- Visited / in-progress / unvisited: 13 / 1 / 23
- Current service / next module: `granotCrmCsv` (in-progress) / `sync.service.ts`

## Messages posted

- 2026-08-28T0245Z next

## Ideas parked

- none

## Contradictions

- Software rule names missing `scripts/granot_crm_csv/sync-from-s3.ts`
- Zod `frame_url` / `byte_length` ignored; `byte_size` is Buffer.byteLength
- Model `failed` status unreachable from upload
- S3-then-Mongo can leave latest ahead of last_ingestions
- No `upload.service.test.ts`
- This checkout’s `CONTEXT.md` does not define Granot CRM CSV ingestion
