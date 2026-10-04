# Lane A-SI evidence: interim Sales Intelligence (Numbers + RingCentral Accounts)

October 4, 2026. Admin repo `vantage-admin`, branch `slim/server-admin`, uncommitted (the coordinator commits). Built only against [S-NUM-CONTRACT.md](S-NUM-CONTRACT.md). Plan packages: SLIM-02 interim SI note, SLIM-05 (Admin side); specification §2 row "Sales Intelligence", §7.4, §8 (`/outreach/:id` continuity).

This lane ran after the host crash; the earlier attempt had left no Admin source change, so the work below was done from a clean tree.

## What the page is now

- `/sales-intelligence` (Owner only) has exactly two views: **Numbers** (default, written as no `view`) and **RingCentral Accounts** (`view=reps`). Header: title, Numbers search (1–3 digits shows the phone hint and does not submit), live indicator with Refresh.
- **Numbers list** (`GET /numbers`, one keyset page of 50, server order, never re-sorted): E.164, provider names, classification and contact status badges, the attached Lead from `attached_lead` (resolved: name, Job Number, Source Company, official status badge and a link to the official Lead; `multiple`: "More than one Lead is attached"; `none`: "No Lead attached"; a resolved edge whose Lead row is gone says so), attached/candidate counts, calls (total, in/out), human conversations, last activity, and "From a Form Lead · no call yet". Filters (rail, chips, phone sheet): classification, Lead match (`linked`/`unlinked`), activity window (Eastern, DST-safe), `has_recording`, `include_form_only`, `hygiene`. Sort: last call activity, last human conversation, first observed, calls; direction toggle. Previous/Next keep a cursor stack in the URL. A coverage line shows `as_of`, `known_through` and the count of known gaps.
- **Capture health** block on Numbers (`GET /coverage`): the server's status, reasons, known-complete-through, Call Log sync/quarantine/last sweep, webhook state/receipts/renewal error, calls in progress/pending finalization, plus known gaps and mapping hygiene (unmapped inbound company numbers, directory Users without a reviewed Agent, last directory sync). The header indicator reads the same cached read.
- **Number detail** (`number=<id>`, a modal dialog, `GET /numbers/:id`), three tabs:
  - *Calls and messages* (`GET /numbers/:id/timeline`, newest first, Eastern day groups, Load older): per call direction, provider result, duration, contact type, provider recording count (metadata only), rep attribution (`reviewed` names the Agent; otherwise "Extension not yet reviewed" / "Not a sales extension" / "No extension on this call", plus the extension number), call legs with overflow count, "Still settling with RingCentral" for provisional rows, late observation time. Lead messages show status/sent/delivered, never a body.
  - *Lead matches*: the attached Lead panel (official Lead, Booking and Cancellation links), the attachment evidence/decision history with the server's attach/reject/detach commands (`/attachments*`, unchanged contract), and the manual "Find another Lead to attach" search.
  - *Details*: provider names, classification, first seen from (call / Form Lead), first observed, last activity, call rollups (total, in/out, human conversations, last inbound/outbound/conversation, provider recordings), Lead-match connection counts with a stored-vs-recount mismatch warning, read-only restrictions (an `origin: intelligence` row is labelled "Recorded by the retired analysis (kept as history)"), and the **Recount this Number** command (`POST /numbers/:id/rebuild`, from `allowed_actions.rebuild_number`).
- **RingCentral Accounts**: unchanged directory table, reviewed-Agent attach review (`POST /reps/:id/review`) and directory `review_context` messaging (`POST /nudges`, body required, no `outreach_record_id`/`expected_revision`, single attempt; a 5xx leaves the same idempotency key for a retry and shows "Unknown"). Directory paging is `directory_cursor` in the URL.
- **Rep accounts**: `/sales-intelligence` renders "Sales Intelligence is being rebuilt — it is not available for Rep accounts yet" from the server page, with no read at all. The rep frame shows brand, "Signed in as {email}" and Sign out (its old Overview read for the header name is gone). A rep can open no other page and reach no API.
- **SSE**: `useSalesIntelligenceLive` keeps versioned reconnect/refetch (every connect/reconnect and every unknown/retired topic resyncs the whole tree; 60 s fallback poll only while the stream is down). Narrowed topics are only the retained ones: `attachment`, `number`, `restriction`, `rep`, `nudge`.

## Old links

`siRouteDecision`/`canonicalSiQuery` keep only the current view's own keys with valid values; any other query redirects (307) to the canonical URL, so:

- `?view=attention|all_outreach|closed|overview|coverage|guide|rep`, Outreach desk filters (`priority`, `band`, `outcome`, …), `outreach=`, `lead=&lead_model=`, `panel=`, `analysis_run=`, `si_return`, `database_scope` → Numbers (a `q` is kept).
- `/sales-intelligence/legacy?view=numbers&number=<id>` → `/sales-intelligence?number=<id>` (the legacy page is now only that redirect).
- `/sales-intelligence/outreach/:id` → the normal not-found page (route deleted). Old OutreachRecord ids are never mapped.
- An invalid `number` value is dropped, not guessed.

## Deletions (264 files)

- Routes: `app/(dashboard)/sales-intelligence/dev/**` (the dev gallery, 45 files), `outreach/[id]/**`, `lead-deep-link-{client,root}.tsx`, `legacy/loading.tsx`.
- Components: `_legacy/**`, `card/**`, `chat/**`, `composer/**`, `outreach/**` (analysis kit, conversations, transcript, audio player, findings, case file, work tab, record header, lead deep link), `overview/**`, `rail/**`, `rep-view/**`, `timeline/**` (v2 story timeline), `rep/*` except `rep-frame.tsx`, `desk/{active-chips,closed-list,degrade,legacy-deep-links,list-controls,metrics-strip,outreach-list,preset-bar,return-memory,stale-banner}`, `data/{preset-storage,requests,use-assessment,use-attention,use-closed-history,use-conversations,use-findings,use-nudges,use-outreach,use-overview,use-reps,use-run,use-search-contract,use-team-overview,use-timeline}`, `data/live/{use-list-refresh,updated-list-pill}`, `lib/{commands,lead-progress,owner-now,legacy-links,rep-color}`, `primitives/{card-shell,band-badge,state-pill,chip,disclosure,sheet,sub-nav}`, `analysis-command`, `call-state`, `command-dialog`, `coverage-view`, `evidence-chain-copy`, `followup-card`, `full-output`, `full-output-readable`, `guide-view`, `lead-progress`, `lead-provenance`, `outreach-detail`, `ownership`, `related-record-chips`, `review-items`, `sales-intelligence-tabs`, `settings-form`.
- API/query: `lib/api/salesIntelligence{Analysis,Assessment,Assessment.fixtures,Overview}.ts`.
- Tests of deleted code: `tests/legacy/sales-intelligence-*.test.ts` (5), 30 files under `tests/sales-intelligence/` (analysis, card, chat, closed, contract, coverage, full-output, gallery, guide, oi-final-review, outreach-shell, overview, preset-bar, rail, rep-*, return-memory, timeline, timeline-registry, a4-search, a6-rep-view, `fixtures/`), `lib/api/salesIntelligence{Assessment,EvidenceChain,OwnerNow,Scores,Copy,Coverage}.test.ts`.
- `components/conversations/**` and `lib/api/conversations*` were already gone after wave 1 (A-DEST).
- Stylesheet: `components/sales-intelligence/styles/sales-intelligence.css` went from 2,090 to ~470 lines. Segments and single-line rules were removed only when a repo-wide scan of `.ts/.tsx/.mjs` sources showed none of their `si-*` classes used (a rule is removed when no selector group can match); `tests/sales-intelligence/css.test.ts` (balanced braces) passes.
- Copy: `sales-intelligence-copy.ts` went from 2,301 to ~470 lines. It keeps `ui2.users` / `ui2.acceptInvite` (Operations Registry Users tab, accept-invite page), `ui1.prim` (minus band/state/card words), `ui1.coverage`, `panel.returnHere` (operational detail panel), and the Numbers/Accounts words.
- `.env.example`: `SI_GALLERY` removed with the gallery. `eslint.config.mjs`: the `_legacy` import-quarantine block removed (no `_legacy` or `tests/legacy` left).

## Rewritten / new

- `lib/api/salesIntelligence.ts`: only the interim contract (attachments, Rep identity + directory, nudge send, coverage + capture health + mapping hygiene, Numbers list/detail/timeline with `attached_lead` none/multiple/resolved, restrictions, connections, `interactionDetailSchema` with `rep` and `legs`, `leadMessageDetailSchema`). Objects are non-strict so additive server fields never break a read; `commandResultSchema` accepts both `{ response, replayed }` and the rebuild's `{ job_id, dedupe_key, number_id, replayed }`.
- `lib/query/salesIntelligence.ts`: retained topic map; simplified `useSalesIntelligenceLive()` (the old `_legacy` 30 s always-on resync option is gone).
- New: `components/sales-intelligence/numbers/{numbers-view,number-detail,number-timeline,attached-lead,numbers-filters,index}.tsx`, `data/use-numbers.ts`, `desk/route-decision.ts`, `lib/eastern.ts`, `rep-unavailable.tsx`.
- Rewritten: `desk/{desk,page-header,view-tabs,index}`, `data/{url-state,use-url-state,query-keys,use-coverage}`, `data/live/{use-live,use-live-health,header-live,index}`, `restrictions.tsx` (read-only), `lib/{format,sort,paging,filter-state}`, route files `page.tsx`, `desk-root.tsx`, `desk-client.tsx`, `loading.tsx`, `route-viewer.ts`, `legacy/page.tsx`.
- Narrowed: `attachments.tsx` (Number mode only), `manual-attachment.tsx` (new Number type), `reps.tsx` (typed directory cursor), `evidence-command.tsx` (optional `response`), `atoms/tooltip-card.tsx` (no Guide link), `primitives/live-indicator.tsx` (no Coverage link), `capture-health.tsx` (+ completeness line), `chrome.tsx` (no pulse notices, review badge), `lib/official-record.ts` (`salesIntelligenceLeadHref` removed), `rep/rep-frame.tsx`.

## Wave-1 hand-offs closed

- `server/auth/authorization.ts`: `REP_PROXY_ROUTES` and `canRepProxyVantagePath` removed; a rep reaches **no** API (deny by default) and only the page `/sales-intelligence`. The Admin-role denial on `/api/v1/admin/conversations/**` is removed with its server routes (S-AI deleted `conversations-admin.routes.ts`); the Admin role still has no `/api/v1/admin/sales-intelligence/**`.
- `server/auth/proxyForwardHeaders.ts` `currentCsiScope`: checks only `scope` (query or body); `database_scope` is no longer read (the server's strict query refuses it).
- `server/sales-intelligence-live.ts`: Owner only (a rep is refused before any upstream call).
- `salesIntelligenceLeadHref` and every SI fixture/gallery `&database_scope=production` href are gone with their files.
- Health page counters: not touched (as instructed).

## Small edits outside the SI folders

- `app/(dashboard)/layout.tsx`: `RepFrame` no longer takes `agentId` (one-line change).
- `server/auth/{authorization,proxyForwardHeaders,repAccess,repDenyByDefault,routeGuard}.test.ts`, `server/sales-intelligence-live.test.ts`: updated for the rep/conversations/scope changes.
- `tests/sales-intelligence/contracts-dir.ts` is kept (the Users tab and accept-invite tests use it); content unchanged.
- Daily Operations: no file touched.

## Preserved behavior and how it was verified

- Attachment commands, evidence and Owner decision history: same component and endpoints; `numbers.test.ts` renders the attached-Lead panel links.
- None/multiple/resolved identity: `lib/api/salesIntelligence.test.ts` (schema drops any Lead field on `multiple`/`none`), `numbers.test.ts` (row/line rendering).
- Rep attribution and legs, Lead message without body, read-only restrictions incl. `origin: intelligence`, facts/recount mismatch: `numbers.test.ts`.
- Old links → Numbers, no redirect loop (idempotent canonical query), strict Numbers query keys (no `has_outreach`), paging reset rules: `desk.test.ts`.
- Rep: page allowlist `/sales-intelligence` only, zero API, live refused: `server/auth/*.test.ts`, `server/sales-intelligence-live.test.ts`; `RepUnavailable` renders no input/table/link: `numbers.test.ts`.
- Retained live topics and query-key reachability: `lib/query/salesIntelligence.test.ts`, `numbers.test.ts`.
- Source scan (`numbers.test.ts`): no `attention/`, `outreach/`, `closed-history`, `overview`, `analysis-runs`, `assessments/`, `findings`, `followups`, `conversations/`, `review-items`, `roster`, `database_scope=`, `_legacy` or retired `view=` string in `components/sales-intelligence/**`, `app/(dashboard)/sales-intelligence/**`, `lib/api/salesIntelligence.ts`, `lib/query/salesIntelligence.ts`.
- Operations Registry Users tab and accept-invite (share the copy file and primitives): their tests pass.

## Checks (real results)

All heavy commands ran through the shared `heavy.sh` lock (Admin repo).

| Check | Result |
| --- | --- |
| `tsc --noEmit` (before `next build`) | 2 errors, both in the generated, gitignored `.next/types/validator.ts` from an older build (it still names the deleted `dev/gallery` and `outreach/[id]` pages). No source error. |
| `next build` (`NODE_OPTIONS=--max-old-space-size=6144`) | **Passed**: compiled in 96 s, TypeScript 103 s. Routes include `/sales-intelligence` and `/sales-intelligence/legacy` (redirect); `/sales-intelligence/outreach/[id]` and `/sales-intelligence/dev/gallery` are gone. |
| `tsc --noEmit` (after the build regenerated `.next/types`) | **0 errors** |
| Full suite `node --import tsx --test --test-concurrency=2 "{lib,server,tests}/**/*.test.ts"` | **700 tests: 685 pass, 0 fail, 15 skipped** (the skips are fixture tests whose contracts folder is absent, as in the baseline). Wave 1 had 1,080 tests; the difference is the deleted tests of deleted code. |
| `eslint` on every touched path (`components/sales-intelligence`, `app/(dashboard)/sales-intelligence`, `app/(dashboard)/layout.tsx`, `app/api/sales-intelligence-live`, `lib/api/salesIntelligence*`, `lib/query`, `server/auth`, `server/sales-intelligence-live*`, `tests/sales-intelligence`, `eslint.config.mjs`) | **clean** (one `set-state-in-effect` error in the new Numbers view was fixed by reading the remembered rail state in the `useState` initializer). |
| Focused files, one at a time | `tests/sales-intelligence/{css,desk,live,numbers,primitives,time}`, `lib/api/salesIntelligence{,Filters,Official,Paging}`, `lib/query/salesIntelligence`, `server/auth/*`, `server/sales-intelligence-live`, `tests/{accept-invite,operations-registry/users,dashboard-nav,dashboard-chrome,retired-destinations,retired-database-scope}`: all pass. |

Not run: a browser walk of the page against a live server (no dev servers per the lane rules; the local `csi01` replica was unresponsive in wave 1). Owner walk owed at integration: Numbers list/filters/sort/paging, a Number with resolved/multiple/none, attach/reject/detach, Recount, Accounts message, an old `?view=attention&lead=…` link, `/sales-intelligence/outreach/<id>` → not found, a Rep login.

Process note: a first full-suite attempt waited on the shared lock behind another lane's server suite; I stopped it before the lock's 15-minute stale rule would have let it run alongside that suite, and re-queued it.

## Cross-lane items

1. **S-OUT / S-AI (server)**: `live.ts` `CSI_LIVE_TOPICS` still maps `outreach_records`, `intelligence_*`, `sales_intelligence_attention_snapshots`, `sales_intelligence_review_items`. The Admin treats those topics as unknown (full resync), which is safe; dropping them server-side removes needless resyncs. `REP_LIVE_TOPICS` is now unused by the Admin (the BFF refuses a rep).
2. **Server**: the Admin no longer calls `GET/PATCH /settings`, `POST /backfill`, `GET /nudges` (history), `POST /nudges/preview`, `POST /reps`, `POST /reps/propose` or `GET /reps/:id`. Classification only, not a deletion request: `/settings` and `/backfill` belong to the LLM/Outreach wave; the nudge history/preview and the propose routes have no Admin caller now.
3. **Deploy order**: this Admin needs the S-NUM server (Numbers `attached_lead`, `coverage.capabilities`, timeline `rep`/`legs`, the rebuild response, the body-required nudge). Against a pre-S-NUM server the Numbers reads fail to parse (no `attached_lead`) and show the region error instead of wrong data. Deploy the server first, as for wave 1.
4. **Wave 3 docs**: Admin `CONTEXT.md`, `.cursor/rules/project-organization.mdc` and `uxdocs/` still describe the Outreach desk, Overview, Closed, Guide, Coverage view, the rep desk and the dev gallery. `scripts/csi07-local.mjs` (local preview launcher) still sets `SALES_INTELLIGENCE_OUTREACH_ENSURE`; not in this lane's ownership.
5. `.next/types/validator.ts` (generated, gitignored) still references the deleted `dev/gallery` and `outreach/[id]` pages from an earlier build; `next build` regenerates it (see Checks).

## DATA-MANIFEST NEEDS

- No Admin collection is created, changed or made dead by this lane. The Admin stores nothing for Sales Intelligence; per-viewer `localStorage` keys that are now dead (harmless, browser-only, no manifest action): `vantage-admin-si-guide-hint`, `vantage-admin-si-purpose`, the Priority preset keys written by the deleted `data/preset-storage.ts`, the filter-sidebar open key of the deleted rail. `vantage-admin-si-filters-open` is still used.
- Server data the interim Admin **still reads** (must NOT be removed): `contact_numbers` (rollups listed in S-NUM), `call_interactions` (incl. `recording_ids`/recording counts as metadata, legs), `number_lead_attachments`, `form_leads`/`call_leads`/`booked_leads`/`cancelled_leads` (official status), `rep_identity_links`, `ringcentral_directory_snapshots`, `sales_intelligence_contact_restrictions` (all rows, including `origin: intelligence`), `owner_rep_nudges` (send path), `lead_messages` (timeline metadata), the `sales_intelligence_sync_state` rows behind coverage/capture health (`call_log_*`, `webhook_*`, `webhook_subscription_maintenance`, directory) and `sales_intelligence_coverage_projections`.
- Server data the Admin **no longer reads at all** (dead from the Admin side; deletion stays with the server manifest): every Outreach/Attention/Closed/Overview/analysis/assessment/conversation read — `outreach_records`, `outreach_followups`, `outreach_band_transitions`, `outreach_rep_days`, `sales_intelligence_attention_snapshots`, `sales_intelligence_attention_artifacts`, `intelligence_*`, `move_assessment_artifacts`, `lead_conversations`, `sales_intelligence_review_items`, `sales_intelligence_owner_instructions` (Owner corrections list), the settings/policy/backfill reads.
