# Session story-models-call-lead-2026-09-12T1620Z

- Date (UTC): 2026-09-12T1620Z
- Service / module: `models` / `CallLead.ts`
- Lock: taken
- Branch / PR: `docs/story-refactor` / https://github.com/jbell-rusty-vantage/vantage-movers-server/pull/206

## Stock at start

- Wave: B
- Visited / in-progress / unvisited: 43 / 1 / 4
- Recommendations on disk: 340
- Current service / next module (TRAVERSAL): `models` (in-progress) / `CallLead.ts`

## This pass

- opened new service?: no
- path or skip: recommended → `recommendations/models-call-lead.md` (`src/models/CallLead.ts`)
- operations named: Hold the Call Lead as the System of Record row; Fold identity before validate and require phone or Job Number; Keep one physical RingCentral call as one Call Lead and keep original-caller evidence immutable; Bind the selected Mongo database and declare the named lookup indexes the migration applies
- remaining in this service: `BookedLead.ts` first, then the rest of the models checklist

## Stock at end

- Visited / in-progress / unvisited: 43 / 1 / 4
- Current service / next module: `models` (in-progress) / `BookedLead.ts`

## Messages posted

- 2026-09-12T1620Z next

## Ideas parked

- none (do not extract a shared `getSelectedDatabaseModel` helper in this pass; already-recommended ingest still imports default `CallLead`)

## Contradictions

- already-recommended ingest / search / enrichment / leftover duplicate-guard ask default `CallLead`; Granot identity / leftover adoption / cancellations / reporting / EntityChange ask `getCallLeadModel`
- named `CALL_LEAD_S08_INDEXES` (three non-unique) vs unnamed browse / duplicate-window vs unique sparse `ringcentral.telephony_session_id`; `autoIndex: false`; S08 unique array stays empty
- hook name `normalizePhoneNumber` also folds `job_no`
- unique session is webhook-vs-cron idempotency, not a business Duplicate Lead, not a unique Lead Job
- leftover adoption `findOneAndUpdate` must keep `"ringcentral.original_caller": { $exists: false }`
- knowledge Service is `call-lead.md` (ingest); this file is the Mongo row
