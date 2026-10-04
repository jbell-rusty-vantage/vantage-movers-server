# Lane MCP: retire the Vantage MCP analysis and conversation capabilities

Wave 2, plan package SLIM-06 (SPECIFICATION §7.1, CODE-MAP §7.1). Repo `vantage-movers-mcp`, branch `slim/server-admin`, base `fbf061f`. Nothing is committed and nothing is deployed. The MCP package and service stay.

## What changed

### Removed: the scoped intelligence endpoint

`/api/intelligence-mcp` was the AI analyst's run-scoped MCP. It served 12 tools, the `csi-envelope-v1` schema resources and the `sales_intelligence_analyze_v*` prompts, and it forwarded to the server's `/api/v1/internal/sales-intelligence/runs/:id/{context,read,submit,submission}` router. Lane S-AI is removing that router. The endpoint had no other client.

Deleted:

- `app/api/intelligence-mcp/route.ts`
- `lib/intelligence/api.ts`, `auth.ts`, `context.ts`, `handler.ts`, `registration.ts`
- `lib/intelligence/generated/intelligence-contract-v1.json`: the generated envelope and tool contract (16,040 lines)
- `lib/intelligence/transport.test.ts`: tests for the removed endpoint
- `docs/intelligence-mcp.md`, and with it the now-empty `docs/` folder
- `lib/auth.ts` `isIntelligenceCredential`, and the guard in `app/api/mcp/route.ts` that used it. The guard only refused run tokens and the scoped key on the general endpoint. Once no run identity exists, broad-secret authentication (`authenticateApiSecret`) is the only check, as it was before the intelligence endpoint was added.

### Narrowed: general endpoint history tools (`lib/tools/history.ts`)

| Tool | Server route | Result |
| --- | --- | --- |
| `list_analyses` | `GET …/history/analyses` | **removed** |
| `get_analysis` | `GET …/history/analyses/:id` | **removed** |
| `get_conversation` | `GET …/history/conversations/:id` | **removed** |
| `get_move_assessment` | `GET …/history/move-assessment` | **removed** |
| `get_prior_analyses` | `GET …/history/prior` | **removed** |
| `get_subject_story` | `GET …/history/story` | **removed** (see below) |
| `find_contact_number` | `GET …/history/contact-number` | kept. The description no longer promises a running summary or Outreach records. It describes the retained Number record, provider-metadata rollups and attachment edges. |
| `find_lead_candidates` | `GET …/history/lead-candidates` | kept, deterministic. Only the wording changed ("stated on a call" became "stated"). |
| `get_lead_history` | `GET …/history/lead` | kept. The description no longer promises conversations or Outreach records. |

**Why `get_subject_story` was removed rather than narrowed.** The Subject Story was built as the analyst run's context page (context provenance spec). Its `model_events` bound and `focus` conversation exist for the model. Its events include `conversation_recorded`, `conversation_analyzed`, `assessment_published`, Outreach follow-ups and Outreach records. The wave 2 plan has S-AI deleting `salesIntelligence/story/**`. `find_contact_number` and `get_lead_history` cover the canonical history: rollups, attachments, entity changes, Granot observations, bookings, cancellations and message metadata. If S-AI keeps a narrowed deterministic story route, re-adding a thin tool is a single catalog entry. That is the integrator's call.

Every `zod` input schema of a removed tool was deleted with it: `subjectKey`, `datetime`, `leadRef`, analyses/analysis/conversation/move-assessment/prior/story schemas.

### General server instructions (`lib/company.ts`)

`VANTAGE_COMPANY_CONTEXT` was written for the call analyst ("on every call the rep speaks for…", "evidence never establishes…"). Its header claimed it mirrored the server's `salesIntelligence/companyContext.ts`, which S-AI deletes. It is replaced by `VANTAGE_SERVER_INSTRUCTIONS`, the instructions the general endpoint sends to every connecting agent. They keep the company identity and the rule that a named carrier or competitor is not Vantage. They add the tool-ownership rules: lead writes only through the lead tools, Mongo tools read-only, and history tools before Mongo.

### Docs

`README.md` and `CONTEXT.md` now list only the 3 history tools and record the retirement. The `Scoped Sales Intelligence (CSI-17)` sections were removed.

## Preserved behavior and how it was verified

- **General endpoint `/api/mcp`.** The registrar still registers `vantage_health`, the 6 lead tools, the 3 history tools and the 8 read-only Mongo tools. The new `lib/tools/register.test.ts` drives the real `POST` handler through the MCP transport and checks 3 things:
  - `tools/list` returns exactly those 18 names.
  - `initialize` advertises only the `tools` capability (no prompts or resources) and carries the general instructions. `prompts/list` and `resources/list` return `-32601`.
  - A mismatched secret gets `401`.
- **History tools.** `lib/tools/history.test.ts` checks exact paths and queries for the retained routes, including the repeated `reference=` encoding. It checks the strict and bounded schemas, and that no retained tool description advertises analyses, conversations, assessments, Outreach, a running summary or a story.
- **Auth, Mongo, vantage-api, json-result.** These suites are unchanged and still pass.

## Checks (real results)

All heavy commands ran through `heavy.sh`.

| Command (in `vantage-movers-mcp`) | Result |
| --- | --- |
| `node node_modules/typescript/bin/tsc --noEmit` (= `pnpm typecheck`) | exit 0, no errors |
| `node --import tsx --test --test-concurrency=2 "lib/**/*.test.ts"` (= `pnpm test`) | 33 tests, 33 pass, 0 fail |
| `next build` | exit 0. The routes are `/`, `/_not-found` and `ƒ /api/mcp`; `/api/intelligence-mcp` is gone. |
| lint | The package has no lint script and no ESLint dependency, so there is nothing to run. |

## Server contract the MCP now depends on (for S-AI and the server integrator)

The MCP calls only these routes, with the broad `x-api-secret`. Responses keep `{ ok: true, data }` or a `404 NOT_FOUND`.

1. `GET /api/v1/internal/sales-intelligence/history/contact-number?phone=|id=`
   - `data.contact_number`: `{ id, e164, national_ten, country, kind, classification, classification_reason, contact_eligibility, provider_names, first_observed_at, last_activity_at, rollups, revision }`. `rollups` is the S-NUM `NumberRollups` set.
   - `data.attachments[]`: unchanged.
   - Must drop `running_summary`, `content_purge_pending`, `outreach[]` and the retired rollup keys.
2. `GET …/history/lead-candidates?phone=|contact_number_id=&stated_name=&reference=…`: unchanged query. `data.subject` should no longer carry `outreach_record_ids`, `conversation_ids` or `focus`. `data.candidates[]` is unchanged. Today `resolveStorySubject` and `findLeadCandidates` live in `salesIntelligence/story/`, which S-AI deletes, so they must be extracted to the retained history module.
3. `GET …/history/lead?model=&id=`: `lead`, `attachments`, `changes`, `granot_observations`, `bookings`, `cancellations` and `messages` are unchanged. `conversations[]` and `outreach[]` must be removed.
4. The MCP no longer calls `/history/story`, `/history/analyses`, `/history/analyses/:id`, `/history/conversations/:id`, `/history/move-assessment` or `/history/prior`. They can be deleted, and so can `/internal/sales-intelligence/runs/:id/*`.

## Deploy note (do not deploy from this lane)

The MCP deploys by Vercel CLI only, per `.agents/skills/deploy-vantage-movers-mcp/SKILL.md`: `npx --yes vercel --prod --yes --scope vantage-4d3db9ef` from `vantage-movers-mcp/`, after `pnpm test` and `pnpm typecheck`. Git push does not ship it.

- **Order.** This build calls only the 3 retained routes, and they exist on both the current and the slim server. It can deploy before the server or with it. If the slim server deploys first, the old MCP's 6 retired tools return 404 errors and its `/api/intelligence-mcp` has no runs to serve. No data is written either way. The client-visible change is a shorter tool list.
- **The deploy skill must be updated before the next deploy.** That file is outside this lane. Its "Required Production names" table lists `SALES_INTELLIGENCE_SCOPED_API_KEY`, `SALES_INTELLIGENCE_RUN_TOKEN_SECRET`, `SALES_INTELLIGENCE_DEPLOYMENT_ID`, `SALES_INTELLIGENCE_DATABASE` and `SALES_INTELLIGENCE_API_BASE_URL` for `/api/intelligence-mcp`, plus an "Intelligence MCP" URL row. This build reads none of them. The skill says to stop when a required name is missing, so the rows must go.
- **Vercel env.** Those 5 names on the `vantage-movers-mcp` Vercel project become unused after this deploy. Remove them from that project only after the deploy is Ready, and never from the main server project as part of this step: the server lane owns its own copies. Values are never printed.
- **Smoke after deploy.**
  - `tools/list` on `https://vantage-movers-mcp.vercel.app/api/mcp` returns the 18 names above.
  - `POST /api/intelligence-mcp` returns 404.
  - `find_contact_number` on a known number returns no `running_summary` or `outreach` once the slim server is live.

## DATA-MANIFEST NEEDS

- **Made dead by this lane.** None. The MCP stores nothing. The retired MCP tools only read server routes, and the retired endpoint only proxied the run router. No collection, field or Blob key is owned by the MCP.
- **Must NOT be removed (read through the retained MCP routes).**
  - `contact_numbers`, using the retained fields per S-NUM
  - `number_lead_attachments`
  - `form_leads` and `call_leads`
  - `entity_changes`
  - `granot_observations`
  - `booked_leads` and `cancelled_leads`
  - `lead_messages` (metadata fields only)
- **Ad-hoc Mongo tools.** `mongo_find`, `mongo_aggregate` and the other `mongo_*` tools are generic read-only tools over any collection. A dropped collection simply returns empty, and nothing in the MCP recreates collections: there are no writes and no index builds.

## Integration (wave 2)

Run on 2026-10-04 by the MCP integrator, after the server lanes finished. Nothing was committed, installed or deployed. The review found no defects in the lane, so the MCP package needed no code change.

### Every retained tool against the wave-2 server routes

All paths were checked in `vantage-main-server/src/routes` in the working tree.

| MCP tool | Server call | Route after wave 2 |
|---|---|---|
| `vantage_health` | `GET /health`, `GET /db` | `src/app.ts`: present |
| `list_leads` | `GET /api/v1/{form,call}-leads` | `v1.routes.ts`: present |
| `search_leads` | `POST /api/v1/{form,call}-leads/search` | present |
| `create_lead` | `POST /api/v1/{form,call}-leads` | present |
| `update_lead` | `PATCH /api/v1/{form,call}-leads/:id` | present |
| `delete_lead` | `DELETE /api/v1/{form,call}-leads/:id` | present |
| `get_lead` (`kind: form`) | `GET /api/v1/form-leads/:id` | present |
| `get_lead` (`kind: call`) | `GET /api/v1/call-leads/:id` | **absent, and absent before the slimming too** (see below) |
| `find_contact_number` | `GET /api/v1/internal/sales-intelligence/history/contact-number` | `sales-intelligence-history.routes.ts`: present |
| `find_lead_candidates` | `GET …/history/lead-candidates` (repeated `reference=`) | present; the query schema accepts a string or an array of `reference` |
| `get_lead_history` | `GET …/history/lead?model=&id=` | present |
| `mongo_*` (8 tools) | direct read-only Mongo, no server route | n/a |

- The server's `CSI_HISTORY_PREFIX` is the same string as the MCP's `HISTORY_PREFIX` (`/api/v1/internal/sales-intelligence/history`).
- `v1.routes.ts` still mounts the history router after `requireApiSecret` and before the boundary router. The run router (`sales-intelligence-internal.routes.ts`) and `conversations-admin.routes.ts` are deleted and unmounted, and the MCP no longer calls them.

### The server-side narrowing the lane asked for is done

- `/history/contact-number`: `readContactNumberHistory` in `services/salesIntelligence/history/reads.ts` returns `contact_number` plus `attachments`. Rollups are whitelisted to provider metadata (`NUMBER_ROLLUPS`). There is no `running_summary`, `content_purge_pending` or `outreach`.
- `/history/lead-candidates`: `resolveHistorySubject` and `findLeadCandidates` were moved out of `story/` into `services/salesIntelligence/history/candidates.ts`. `HistorySubject` is now `{contact_number_id, e164, as_of}`, so there is no `outreach_record_ids`, `conversation_ids` or `focus`.
- `/history/lead`: `readLeadHistory` returns `lead`, `attachments`, `changes`, `granot_observations`, `bookings`, `cancellations` and `messages`. There is no `conversations` or `outreach`.
- The three MCP tool descriptions match these shapes. Lane open risks 1 and 2 are closed.

### Checks (vantage-movers-mcp)

| Command | Result |
|---|---|
| `node node_modules/typescript/bin/tsc --noEmit` (= `pnpm typecheck`) | exit 0 |
| `node --import tsx --test --test-concurrency=2 "lib/**/*.test.ts"` (= `pnpm test`) | 33/33 pass |
| lint | the package has no lint script and no ESLint dependency |

`next build` was not re-run because no MCP file changed after the lane's green build.

### Open items (outside the MCP package)

1. **`get_lead` with `kind: call` has no server route.** No `GET /api/v1/call-leads/:id` exists, and `git log -S` shows it never did. The only matching route is `GET /api/v1/admin/call-leads/:id`. This predates the slimming and is not a wave-2 regression. Either the server adds the read or the MCP switches that kind to the admin detail route. Both are behavior changes, so they are left for the coordinator.
2. **Server history tests are green.** During this run, `ops/test-setup.ts` and `src/config/domain.ts` briefly imported deleted observability modules, so every server test file failed at load. The server integrator fixed that concurrently. After the fix, `node --import tsx --import ./ops/test-setup.ts --test src/routes/sales-intelligence-history.routes.test.ts src/services/salesIntelligence/history/reads.test.ts` passes 5/5.
3. The deploy skill (`.agents/skills/deploy-vantage-movers-mcp/SKILL.md`) still lists the Intelligence MCP URL and the 5 `SALES_INTELLIGENCE_*` names as required. The coordinator owns this.
