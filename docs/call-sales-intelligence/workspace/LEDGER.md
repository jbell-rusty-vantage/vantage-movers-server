# Implementation ledger

## CSI-14 efficiency indexes applied — Grok, September 20, 2026

Owner asked to apply the CSI-14 operator steps, commit the efficiency work, push `main`, and deploy the server. Official `migration:csi:indexes --apply --confirm-production=vantagemovers` then `--verify`: ready, unresolved 0, no missing/incompatible indexes. Superseded names `contact_number_digits_reversed`, `contact_number_search_terms`, `contact_number_classification_activity`, and `call_interaction_number_started` dropped after replacements existed. `migration:csi:conversation-number --apply` scanned 1 unset conversation and left it unresolved (no invented link). Flags unchanged. No phones in evidence.

## Attention projection explainer — Grok, September 20, 2026

Owner asked for a full write-up of why Needs Attention stays on “Attention is being prepared.” Docs only. No runtime change.

Exact claims:
- `docs/call-sales-intelligence/workspace/ATTENTION-PROJECTION.md`
- `docs/call-sales-intelligence/workspace/README.md` pointer
- inspect helpers `scripts/inspect-csi-attention-projection.ts` and `scripts/inspect-csi-attention-candidates.ts` (already used for the 20:09 UTC production counts in that doc)

No phones. No deploy. No snapshot publish from GET.

## AFTER-16 D+E live submit 400 — Grok, September 20, 2026

Stay-and-fix during Saturday cutover. Production run `6ab02c3d036aa9e7b7ca9655` accepted the scoped key then returned HTTP 400 on POST `/submit`. Run is paused `schema_exhausted` after two `INVALID_INPUT` submits; six snapshots captured, no receipt. Nearby first-hour analysis runs are mostly `bounds_exhausted` (4-step ceiling) or `schema_exhausted`. JSON Schema cannot express envelope refinements, and the 400 body named no issue paths, so the one allowed repair was blind.

Exact claims:
- `src/routes/sales-intelligence-internal.routes.ts` — sanitized `{path,code}` on Zod `INVALID_INPUT`; log issue paths only
- `src/routes/sales-intelligence-internal.routes.test.ts`
- `src/services/salesIntelligence/analysis/runtime.ts` — default steps 4 → 8
- MCP `lib/intelligence/{auth,api,registration,transport.test}.ts` — forward sanitized issues
- Service card + CSI-17 API-CONTRACT note

Deployed 20 Sep 2026 through Vercel CLI (`git.deploymentEnabled` is false): API `cd22b1e4b2a97fce5e8edcfd4ff117730d14dc18` → https://vantage-movers-main-server.vercel.app (`dpl_13YfCCof9kYNZyibLVdabrUmbnoQ`); MCP `a9e002d679387e4641d8d0fae1e7370844e559b6` → https://vantage-movers-mcp.vercel.app (`dpl_EbFSND5yGf4bkgiyrmk13L4QA7vp`). Prompt/schema review brief: `evidence/after-16/prompt-schema-review/PROMPT.md`. Do not reset production `schema_failures` unless the Owner asks. No phones in evidence. No `.env` in git.

## AFTER-16 A/B/C — Grok, September 20, 2026

Team F operations claimed before writes. Remotes remain `jbell-rusty-vantage`. Local `main` baselines: server `ea09569c6bee1b8727131c27dd2db4e8560422b4` (dirty `package.json` + untracked `scripts/probe-intelligence-mcp-agent.ts` preserved), Admin `d80528a2ab78a8430b48e9e8ce2eb0b463eaf486`, MCP `30b86aa08bbbe6bfdfe07a62a81ecf895d3b2b23`. CSI-16 stays an honest local packet: G4 not wholly green (F-01), G5 partial (F-02), G6 not probed. Do not relabel those green.

Exact claims this sitting:
- **C** — deploy current `origin/main` SHAs through Vercel projects `vantage-movers-main-server`, `vantage-admin`, `vantage-movers-mcp`. Flags unchanged. No indexes. No `BACKFILL_DAYS`. Packet `evidence/after-16/c-deploy/`.
- **A** — `src/services/salesIntelligence/repIdentity/worker.ts` enqueue `recording_discovery` for every re-evaluated interaction; replica proof in `scripts/test-csi-rep-identity.replica.test.ts`. Inspected `evidence/csi-17/QUALITY-PROPOSED-CLEANUP.md`; do not apply that patch wholesale. Packet `evidence/after-16/a-empty-recording/`.
- **B** — Admin Message-rep dialog history + distinct delivery; F-02 provenance; replace Lead Conversations demo chrome; Owner-gate `/conversations` the same way as `/sales-intelligence`. No live send. Packet `evidence/after-16/b-dialogs/`.

D+E flag writes wait for Owner confirmation of the collected production env table. `EXACT_EVIDENCE_VERIFICATION` stays false. `BACKFILL_DAYS` stays 0 unless the Owner names days. Preserve probe dirt. No `.env` in git.

## CSI-16 ownership — Codex, September 19, 2026

Team F certification claimed before edits. Verified local main baselines: server `561e048960cd914f37a337addada8b459b5296f1`, Admin `fb631eb1f820ce6a5c641c677029371a73dc53ab`, MCP `9a8fd37bf78f8074011fb2d47ff3da3ec400b33d`; all remotes remain `jbell-rusty-vantage`. Preserve server package.json/external probe and MCP formatting dirt. Scope: CSI-16 evidence packet, ACCEPTANCE execution record, CONTRACTS/README/SPRINT-PLAN/Team F, docs catalog/matching Service cards, Admin CONTEXT/project-organization pointers; certification harness only if required. One authorized GPT-6 Astra subagent reviews evidence independently. No production enablement or AFTER-16 work. Specific CSI-16 prohibitions remain in force; no paid calls merely to green a row. Owner's opening instruction authorizes commit/push for this task without another permission request; only CSI-16 files may land.

September 20 close: this commit lands the CSI-16 packet and `scripts/test-csi16-local.ts`. Still excluded: server `package.json` (`probe:intelligence-mcp`) and untracked `scripts/probe-intelligence-mcp-agent.ts`. Admin pointers already on Admin `main` as `d80528a`. MCP formatting dirt is a separate format-only commit, not CSI-16 implementation. No production flags, indexes, or AFTER-16 D+E.


## CSI-15 ownership — Grok, September 19, 2026

Verified remotes `jbell-rusty-vantage` (`vantage-movers-server`, `vantage-admin`, `vantage-movers-mcp`). Server local `main` HEAD `d55f6c2b1eb2bed276d0b5bc8c6d2a5bc065fd7c` (in sync with origin). Admin `main` HEAD `d82d3de45f56800378d223e7535688f4f0660366` (1 ahead of origin — CSI-09, not reset). MCP clean `9a8fd37bf78f8074011fb2d47ff3da3ec400b33d`, untouched. Work stays on local `main`; no branch switch. One implementation writer. Pre-existing dirty Owner docs preserved.

Exact server claims:
- `src/config/domain/salesIntelligence.ts`
- `src/services/salesIntelligence/backfill/**`
- `src/services/salesIntelligence/retention.ts`
- `src/services/salesIntelligence/ownerCoverage.ts`
- `src/services/salesIntelligence/dto.ts`
- `src/services/salesIntelligence/jobs.ts` (additive live/backfill priority constants only if required)
- `src/services/salesIntelligence/conversations/transcribe.ts` (additive analysis job priority/mode)
- `src/services/salesIntelligence/analysis/worker.ts` (additive backfill-mode preparation)
- `src/services/numberActivity/reconcileCallLog.ts` (additive live-lease peek + backfill page source)
- `src/routes/sales-intelligence-admin.routes.ts`
- `src/routes/sales-intelligence-cron.routes.ts`
- `vercel.json`
- `package.json`
- focused unit/replica tests under `src/services/salesIntelligence/` and `scripts/test-csi-backfill*`
- Service cards `docs/knowledge/services/{sales-intelligence-foundation,number-activity-reads,sales-intelligence-outreach,sales-intelligence-analysis,sales-intelligence-live}.md`

Exact Admin claims (Coverage DTO only):
- `vantage-admin/lib/api/salesIntelligence.ts`
- `vantage-admin/lib/api/salesIntelligence.test.ts` (if Coverage parse tests exist)
- `vantage-admin/components/sales-intelligence/coverage-view.tsx`
- `vantage-admin/components/sales-intelligence/sales-intelligence-copy.ts`

Exact coordination/evidence claims:
- this ledger
- `docs/call-sales-intelligence/workspace/CONTRACTS.md`
- `docs/call-sales-intelligence/workspace/teams/f-integration.md` (do not overwrite Owner dirty copy beyond this claim if already dirty — Owner file preserved; contract note only if needed)
- `docs/call-sales-intelligence/workspace/evidence/csi-15/**`

Do not enable `NUDGE_ENABLED`, `STT_ENABLED`, `EXTRACTION_ENABLED`, `BACKFILL_DAYS`, capture/media/outreach flags in Vercel or `.env`. Do not apply `migration:csi:indexes`. Do not `POST /backfill` against production. Do not create a production subscription, send a nudge, or call paid Gateway/STT. Do not start CSI-14 fuller dialogs, CSI-16, live send, or the CSI-10 empty-recording repair. MCP untouched. No commit or push unless the Owner asks.

## Named 1–2 subject seed writes — Grok, September 19, 2026

Owner-authorized example seed only. Not CSI-15. Verified remotes `jbell-rusty-vantage` (`vantage-movers-server`, `vantage-admin`, `vantage-movers-mcp`). Server `main` HEAD `93bfd1a85eba6ff157fdfa91701db63940e8498a` (clean, 1 ahead of origin). Admin `main` HEAD `d82d3de45f56800378d223e7535688f4f0660366` (clean, 1 ahead of origin). MCP clean `9a8fd37bf78f8074011fb2d47ff3da3ec400b33d`, untouched. Official `migration:csi:indexes --verify` ready, unresolved 0; no `--apply`.

Predicted official `outreach_ensure` (`ensureLead` only, subject `outreach-lead:CallLead:<id>`):

- Job `P5562014` Call Lead `6a761d3d7ceae445794c57bd` is official Booked. Create Outreach with `first_action_due_at` null, then `closeRecord` reason `booked` origin `official`.
- Job `5564480` Call Lead `6aaaf552ca2df3ab6f396b5d` is official Booked. Same create-then-official-close.

No `ensureInteraction`. No CSI-05 attach (production `contact_numbers`, `call_interactions`, and `number_lead_attachments` are empty; capture/reconcile/media fetch remain forbidden). No reopen. Closed booked is not actionable, so no current overdue first-action / missed-callback / going-cold. Official close may enqueue pending `number_refresh` jobs; do not drain them (`EXTRACTION_ENABLED` stays off).

Exact production writes claimed: `outreach_records` and CSI audit for those two Lead subjects; `sales_intelligence_jobs` for the two `outreach_ensure` lead jobs plus any official-close `number_refresh` rows. Evidence under `docs/call-sales-intelligence/workspace/evidence/named-subjects/**` and this ledger note. No runtime source edits. No `.env` / Vercel flag writes. No commit or push unless the Owner asks.

## Official CSI indexes applied — Owner, September 19, 2026

Owner-authorized `migration:csi:indexes --apply --confirm-production=vantagemovers`. Reviewed mapping stamped company `provider_account_id` `62948571023` on Lead Conversation `6a905b5cf7dda52cfacb721e` (P5562014). `--verify` ready, unresolved 0, no missing/incompatible indexes. Receiver Agent Patrick is identity only; not the account field. Flags remain off. No STT, extraction, capture, live recording fetch, or CSI-15. Mapping artifact is local/gitignored.

## Named 1–2 number subjects — Owner, September 19, 2026

Documentation-only at naming time. The Owner named Job `P5562014` (Call Lead `6a761d3d7ceae445794c57bd`, stored conversation audio) and Job `5564480` (Call Lead `6aaaf552ca2df3ab6f396b5d`, recent 20-minute inbound, no Vantage conversation). Exact ids and limits: [authorization](evidence/named-subjects/AUTHORIZATION.md). No seed, capture, STT, flag, live recording fetch, or CSI-15 backfill was performed at naming time. CSI-09 is locally complete; the named-subject seed is the next session.

## CSI-09 Coverage/settings + Lead entry — Grok, September 19, 2026

Verified remotes `jbell-rusty-vantage`. Server/Admin/MCP are on `main` after the authorized merge (pre-commit server `cea98a92482f21da91cae1a70c237155a4d74bdc`, Admin `041081adf0a113cd75a69f40f4a49f6662a3dcfa`, MCP `9a8fd37bf78f8074011fb2d47ff3da3ec400b33d`). Local Coverage/settings + Lead entry proof is complete. Work stayed on `main` because it already contains the merge. One implementation writer. No branch switch. Owner asked to commit this slice on `main`; no push in the implementation session.

Exact server claims:
- `src/services/salesIntelligence/dto.ts`
- `src/services/salesIntelligence/ownerCoverage.ts`
- `src/services/salesIntelligence/ownerCoverage.test.ts`
- `src/services/salesIntelligence/settings.ts`
- `src/services/salesIntelligence/settings.test.ts`
- `src/services/salesIntelligence/policy.ts` (read-only reuse; no first-persist write on GET)
- `src/validation/v1/salesIntelligence.ts`
- `src/routes/sales-intelligence-admin.routes.ts`
- `src/routes/sales-intelligence-admin.routes.test.ts`
- `scripts/test-csi-settings.replica.test.ts`
- `docs/knowledge/services/{number-activity-reads,sales-intelligence-foundation,sales-intelligence-live}.md`

Exact Admin claims:
- `vantage-admin/lib/api/salesIntelligence.ts`
- `vantage-admin/lib/api/salesIntelligence.test.ts`
- `vantage-admin/components/sales-intelligence/sales-intelligence-copy.ts`
- `vantage-admin/components/sales-intelligence/workspace.tsx`
- `vantage-admin/components/sales-intelligence/coverage-view.tsx`
- `vantage-admin/components/sales-intelligence/settings-form.tsx`
- `vantage-admin/components/sales-intelligence/lib/official-record.ts`
- `vantage-admin/components/operational/operational-actions.tsx`

Exact coordination/evidence claims:
- this ledger
- `docs/call-sales-intelligence/workspace/CONTRACTS.md`
- `docs/call-sales-intelligence/workspace/teams/e-dashboard.md`
- `docs/call-sales-intelligence/04-server-routes.md` (CSI-11 comment only: full Coverage is this issue)
- `docs/call-sales-intelligence/workspace/evidence/csi-09/**`

Do not enable `NUDGE_ENABLED`, `STT_ENABLED`, `EXTRACTION_ENABLED`, `BACKFILL_DAYS`, capture/media/outreach flags in Vercel or `.env`. Do not apply `migration:csi:indexes`. Do not write `.env` or paste `ADMIN_SEED_*`. Do not point 3107/3108 at Atlas. Do not send a nudge, create a production subscription, or call paid Gateway/STT. Do not implement CSI-15 workers, CSI-14 dialogs, or the CSI-10 empty-recording repair. Kill switches stay env-only.

## CSI-14 directory-User destinations + P2 — Grok, September 19, 2026

Verified remotes `jbell-rusty-vantage`. Server `sales-intelligence` HEAD `bbdfe4c2ea080f4a962d74913baed0846c1ac763` (dirty CSI-14 dest docs + CSI-10 seed preserved). Admin `sales-intelligence` HEAD `905fe8777e5707f20b32b2a76c59a3566dafaf09` (dirty CSI-10 seed UI preserved). MCP clean, untouched. No branch switch. One implementation writer.

Exact server claims:
- `src/validation/v1/salesIntelligence.ts`
- `src/models/OwnerRepNudge.ts`
- `src/services/salesIntelligence/nudges/{commands,eligibility,templates,reads,nudges.test,routes.test}.ts`
- `src/services/salesIntelligence/repIdentity/reads.ts`
- `src/services/salesIntelligence/repIdentity/identity.test.ts`
- `scripts/test-csi-nudges.replica.test.ts`
- `docs/knowledge/services/sales-intelligence-nudges.md`

Exact Admin claims:
- `vantage-admin/lib/api/salesIntelligence.ts`
- `vantage-admin/lib/api/salesIntelligence.test.ts`
- `vantage-admin/components/sales-intelligence/outreach-detail.tsx`
- `vantage-admin/components/sales-intelligence/message-rep-dialog.tsx`
- `vantage-admin/components/sales-intelligence/workspace.tsx`
- `vantage-admin/components/sales-intelligence/sales-intelligence-copy.ts`

Exact coordination/evidence claims:
- this ledger
- `docs/call-sales-intelligence/workspace/CONTRACTS.md`
- `docs/call-sales-intelligence/workspace/teams/c-outreach.md`
- `docs/call-sales-intelligence/workspace/evidence/csi-14/API-CONTRACT.md`
- `docs/call-sales-intelligence/workspace/evidence/csi-14-destination/**`

Do not enable `NUDGE_ENABLED`, `STT_ENABLED`, `EXTRACTION_ENABLED`, subscriptions, or live send. Do not apply official `migration:csi:indexes`. Do not write Rep Identity Links for Josh, Roy, Jason, either Tyler, Russell, QA, or unmatched Users. Do not start CSI-15, dashboard CSI-07/08, or live send. No commit or push unless the Owner asks.

## Owner send destination spec — Grok, September 19, 2026

Documentation-only. Owner Rep Nudge destinations are current User extensions on the stored directory snapshot for that RingCentral account. A reviewed Agent match is not required to send. Attribution, metrics, automatic assignment, and reviewed-rep outbound analysis still require reviewed identity. Never automatic. Never the customer. Runtime CSI-14 source is unchanged by this claim.

Exact claims: `docs/call-sales-intelligence/{01-specification,02-domain-models,03-server-pipeline-and-jobs,04-server-routes,05-owner-dashboard-ux,09-owner-workflow-interview}.md`, `docs/knowledge/services/{sales-intelligence-rep-identity,sales-intelligence-nudges}.md`, workspace `CONTRACTS.md`, `LEDGER.md`, `SPRINT-PLAN.md`, `NEXT-SESSION.md`, `README.md`, `teams/c-outreach.md`, `evidence/csi-14/API-CONTRACT.md`, `evidence/csi-10-seed/HANDOFF.md`. No runtime, flags, send, backfill, commit, or push.

## CSI-10 production seed ownership — Grok, September 19, 2026

Owner-authorized production seed only. Verified remotes `jbell-rusty-vantage` (`vantage-movers-server`, `vantage-admin`). Server `sales-intelligence` HEAD `bbdfe4c2ea080f4a962d74913baed0846c1ac763` (clean). Admin `sales-intelligence` HEAD `905fe8777e5707f20b32b2a76c59a3566dafaf09` (clean). No branch switch. Existing CSI-10 implementation remains complete; this claim is the live directory snapshot + unique proposed links + Owner review of those unique rows. One implementation writer.

Exact Admin claims:
- `vantage-admin/components/sales-intelligence/reps.tsx`
- `vantage-admin/components/sales-intelligence/sales-intelligence-copy.ts`
- `vantage-admin/lib/api/salesIntelligence.ts`
- `vantage-admin/lib/api/salesIntelligence.test.ts`

Exact server claims (additive DTO exposure of already-stored snapshot DIDs so review can set channels; no matcher/send/flag-default changes):
- `src/services/salesIntelligence/repIdentity/reads.ts`
- `src/services/salesIntelligence/repIdentity/identity.test.ts`
- `src/services/salesIntelligence/repIdentity/routes.test.ts`
- `scripts/test-csi-rep-identity.replica.test.ts`
- `docs/knowledge/services/sales-intelligence-rep-identity.md`

Exact coordination/evidence claims:
- this ledger
- `docs/call-sales-intelligence/workspace/CONTRACTS.md`
- `docs/call-sales-intelligence/workspace/teams/c-outreach.md`
- `docs/call-sales-intelligence/workspace/evidence/csi-10-seed/**`

Prerequisite unique fences only (official `migration:csi:indexes` is blocked by unresolved conversation account attribution and would rewrite `lead_conversations` / drop a legacy recording fence). This seed creates the unique indexes required for directory snapshot, propose, review, command replay, identity jobs, and audit. It does not apply the full CSI catalog or CSI-15 backfill.

Enable only `SALES_INTELLIGENCE_ENABLED` and `SALES_INTELLIGENCE_DIRECTORY_SYNC` for Owner directory sync / propose / review. Do not enable `NUDGE_ENABLED`, `STT_ENABLED`, `EXTRACTION_ENABLED`, subscriptions, or live send. Do not write `RepIdentityLink` rows from the September roster markdown. Do not mark reviewed from a name match. `proposed` never satisfies a nudge. Never invent `rc_team_messaging_person_id`. Never auto-link Jason/ext 121, either Tyler, Russell, QA, or Users with no Agent. Any additional path will be claimed before editing.

Seed result: complete for the unique first-token set the matcher could propose (9 reviewed). Josh/Roy unmatched. [Handoff](evidence/csi-10-seed/HANDOFF.md), [checks](evidence/csi-10-seed/CHECKS.md).

## CSI-18 ownership — Codex, September 19, 2026

Local synthetic proof claim: `scripts/test-csi18-local.ts`. It reuses the private OS-temp session and guarded preview database only.

Transport regression extension claim: `scripts/test-csi-runtime.replica.test.ts` for original/current reruns through the existing actual local MCP/fake-model fixture.

Checkpoint-supported freshness fix claims: `src/services/salesIntelligence/analysis/{reads,reads.test,sources}.ts` and the already-owned application/runtime replica paths. Reject current-context requests for obsolete transcript versions and prevent stale captured sources from applying effects or replacing current summaries, while retaining explicit original-evidence analysis as immutable historical findings.

Exact Admin integration claims: `lib/api/salesIntelligenceAnalysis.ts`, `components/sales-intelligence/analysis-panel.tsx`, `components/sales-intelligence/analysis-command.tsx`, and `components/sales-intelligence/workspace.tsx`. Existing query invalidation, signed BFF and native dialog conventions are retained.

Additional exact shared claims: `src/services/salesIntelligence/jobs.ts`, `src/services/salesIntelligence/analysis/runtime.ts` for typed durable rerun intent and original captured-call preflight; no new job stage or provider policy.

Server local acceptance: **complete**. UI local acceptance: **complete**. [CSI-18 handoff](evidence/csi-18/HANDOFF.md), [checks](evidence/csi-18/CHECKS.md), [review](evidence/csi-18/REVIEW.md). Required checkpoint checks/final snapshot review pass, overall stale/CLI 1 after direct-source changes; no independent final-source approval claimed. Verified server `sales-intelligence` at `cc67bdfdc2a5738f8c876af187b0317eb34b1a1d`, Admin at `e0c0a77e0577b73c4996d99f4af52d3a8b232b55`, MCP clean at `9a8fd37bf78f8074011fb2d47ff3da3ec400b33d`; all remotes belong to `jbell-rusty-vantage`. Existing CSI-07/08 changes preserved. Local ports 3107/3108/27189 are listening. No production/provider actions.

Exact initial server claims: `src/services/salesIntelligence/analysis/ownerCommands.ts`, `src/services/salesIntelligence/analysis/ownerReads.ts`, `src/services/salesIntelligence/analysis/ownerReanalysis.ts`, `src/services/salesIntelligence/analysis/{run,worker,capture,submit,apply}.ts`, `src/models/salesIntelligence/{intelligence,infrastructure}.ts`, `src/validation/v1/salesIntelligence.ts`, `src/routes/sales-intelligence-admin.routes.ts`, `scripts/test-csi-owner.ts`, `scripts/test-csi-owner.replica.test.ts`. Coordination: `docs/knowledge/services/{sales-intelligence-analysis,sales-intelligence-outreach}.md`, `docs/call-sales-intelligence/{02-domain-models,04-server-routes}.md`, workspace `CONTRACTS.md`, this ledger, `teams/{d-intelligence,e-dashboard}.md`, and new `evidence/csi-18/{INTAKE,SOURCES,CHECKS,REVIEW,HANDOFF}.md` and synthetic proof artifacts. Claim Admin paths before integration edits. CSI-14/12/10 review follow-ups remain separate.

## CSI-08 continuation ownership — Codex, September 19, 2026

Absent-pair acceptance additionally claims `src/services/salesIntelligence/attachment/commands.ts` and `scripts/test-csi-attachment.replica.test.ts`; first attachment audit must use an explicit unlinked prior state. Read-contract assertions additionally claim `scripts/test-csi-reads.replica.test.ts` for additive Number attachment availability.

Browser acceptance reproduced idle aggregate revision churn. Additional exact claim: `src/services/salesIntelligence/outreach/store.ts`; regression through guarded `scripts/test-csi08-local.ts idle-revision`. Clock refresh must preserve revision when neither aggregate state nor an action changes; real transitions retain their aggregate fence.

Additional Admin reusable command path: `components/sales-intelligence/evidence-command.tsx`.
Additional Admin Number restriction decision path: `components/sales-intelligence/restrictions.tsx`.
Completion-note acceptance additionally claims `src/services/salesIntelligence/followups/commands.ts`; preserve already-accepted Owner note/reason fields in audit history.
Official-record browser scope proof additionally claims Admin `components/sales-intelligence/lib/official-record.ts`; use host `database_scope` URL contract, distinct from the API's `scope` parameter.
Manual absent-pair attachment uses existing host search and additionally claims Admin `components/sales-intelligence/manual-attachment.tsx`; Number read availability is in the already-claimed `src/services/numberActivity/contactNumbers.ts`.

Local preview continuation additionally claims `vantage-admin/scripts/csi07-local.mjs` (enable only the already-implemented attachment command gate in the isolated fixture runtime). Synthetic fixture/proof runner uses only the two named preview databases.

Additional server paths claimed for additive read availability/contracts and local proof: `src/services/salesIntelligence/outreach/reads.ts`, `src/services/salesIntelligence/attachment/reads.ts`, `src/services/numberActivity/contactNumbers.ts`, `src/routes/sales-intelligence-admin.routes.ts`, `src/services/salesIntelligence/dto.ts`, `docs/knowledge/services/{sales-intelligence-outreach,sales-intelligence-attachment,number-activity-reads}.md`, `scripts/csi07-local.ts`, `scripts/test-csi08-local.ts`, `scripts/test-csi08-ui.ts`. Existing command policy remains in its owning services. No production flag changes.

Active continuation from the goal-objective and `vantage-next-session-csi-08.md`, superseding the old CSI-07 kickoff. Verified Admin/server/MCP on `sales-intelligence`, all remotes owned by `jbell-rusty-vantage`; existing Admin/server CSI-07 edits preserved and MCP clean. One implementation writer.

Claimed Admin paths: `lib/api/salesIntelligence.ts`, `lib/query/salesIntelligence.ts`, `lib/api/salesIntelligence.test.ts`, `components/sales-intelligence/{workspace,attention,followup-card,number-browser,number-timeline,command-dialog,outreach-detail,attachments,reps,review-items}.tsx`, `components/sales-intelligence/lib/{format,commands}.ts`, `components/sales-intelligence/styles/sales-intelligence.css`, `.cursor/rules/project-organization.mdc`. Command tests reside in `lib/api/salesIntelligence.test.ts`; the earlier planned separate commands test/UI runner paths were not created. Claimed coordination/evidence: this ledger, `CONTRACTS.md`, `teams/e-dashboard.md`, new `evidence/csi-08/{INTAKE,CHECKS,HANDOFF,SOURCES,REVIEW}.md` and synthetic/redacted proof artifacts. Scoped implementation/local acceptance is now complete; exact checkpoint limitations are recorded below. CSI-14 messaging and CSI-18 remain separate.

September 19 planning update: reviewed CSI-13 artifacts, prior unresolved findings, current branches/dirty state and the design export. Updated execution order and next-session scope only; no issue newly claimed/completed, no runtime test rerun or deployment. CSI-13 source remains uncommitted. [Review findings and plan](SPRINT-PLAN.md).

Created September 17, 2026; current execution order revised September 19 in [SPRINT-PLAN](SPRINT-PLAN.md). Runtime statuses below reflect issue evidence; historical ownership notes are point-in-time records. Replace placeholders only with actual evidence. Valid status: not started / claimed / implementing / review / blocked / complete. Complete means implemented and relevant checks passed, not simply specified.

| Issue | Team | Status | Agent / branch / PR | Checks and evidence | Blocker / next step |
| --- | --- | --- | --- | --- | --- |
| CSI-01 | A | complete | Codex Step 2; sales-intelligence (server and admin); uncommitted review patch based on Grok 8219d2a | Server 43/43; dashboard 9/9; replica 15/15; both typechecks; isolated CLI report/verify. [Packet](evidence/csi-01/STEP2-HANDOFF.md), [checks](evidence/csi-01/STEP2-CHECKS.md), [exact owned files](evidence/csi-01/STEP2-FILES.md). | GPT-6 independently approved all five review fixes. G1 foundation contracts frozen; B–E feature services and integration acceptance remain downstream. |
| CSI-02 | B | review (findings resolved) | Fable (main implementer) + independent Opus 5 code review (Request Changes → all 10 should-fix and nits resolved, one accepted limitation); `vantage-main-server` `sales-intelligence`, committed `935fbfd` + review-fix commit; no dashboard files | Typecheck 0; focused 69/69 (26 CSI-02 pure tests); CSI-02 replica 12/12; CSI-01 replica 15/15; qualification suites 93 pass/3 pre-existing skips. [Handoff](evidence/csi-02/HANDOFF.md), [checks](evidence/csi-02/CHECKS.md), [review](evidence/csi-02/INDEPENDENT-REVIEW.md). | Owner acceptance of the resolved review; CSI-03 wires `observeRingCentralWebhookEvents`/`runCallLogReconcileOnce` and passes its job id as `request_id`; C/CSI-11 consume `outreach_ensure`/`attachment_refresh`/`recording_discovery` jobs. Live provider shapes and grants remain G6. |
| CSI-03 | B | review (findings resolved) | Fable (main implementer) + independent Opus 5 code review (Request Changes → all 8 findings and 4 nits resolved → Approve; 3 residuals closed); `vantage-main-server` `sales-intelligence`, baseline `1925c32`, uncommitted patch shared with CSI-04; no dashboard files | Typecheck 0; focused 95/95 (27 CSI-03 unit); CSI-03 replica 11/11; CSI-02 replica 12/12; CSI-01 replica 15/15; qualification suites 102 pass/3 pre-existing skips. [Handoff](evidence/csi-03/HANDOFF.md), [checks](evidence/csi-03/CHECKS.md), [review](evidence/csi-03/INDEPENDENT-REVIEW.md). | Owner acceptance; CSI-04 registers `rebuild` handler/recovery and the directory-sync cron handler (same patch); C/CSI-11 register their stage handlers; G6 (Team F) creates the production all-direction subscription through the ops command. Live provider/queue delivery remains unverified. |
| CSI-04 | B | review (findings resolved) | Fable (main implementer) + independent Opus 5 code review (Request Changes → 3 must-fix resolved → Approve); `vantage-main-server` `sales-intelligence`, baseline `1925c32`, uncommitted patch shared with CSI-03; no dashboard files | Typecheck 0; focused 109/109 (14 CSI-04 unit); CSI-04 reads replica 10/10; CSI-04 numbers replica 7/7; CSI-03/02/01 replica 11/12/15; qualification 102 pass/3 pre-existing skips. [Handoff](evidence/csi-04/HANDOFF.md), [checks](evidence/csi-04/CHECKS.md), [review](evidence/csi-04/INDEPENDENT-REVIEW.md). | Owner acceptance; Team C/E consume read DTOs and the TimelineSource hook; G6 enables `DIRECTORY_SYNC`. Live directory/queue/cron remain unverified. |
| CSI-05 | C | complete | Codex; `vantage-main-server` / `sales-intelligence`; clean baseline `c73df86`; uncommitted | Current typecheck/lint pass; focused 13/13; attachment replica 11/11; media regression 20/20; full offline 2386 pass/114 skip/0 fail. [Handoff](evidence/csi-05/HANDOFF.md), [checks](evidence/csi-05/CHECKS.md), [review](evidence/csi-05/REVIEW.md). Dashboard untouched. | Checkpoint's older snapshot failed its now-fixed test-fixture typecheck; no patch applied. Its unrelated CSI-12 finding is documented outside scope. CSI-06/10/14 remain not started; flags off. |
| CSI-06 | C | complete | Codex; `vantage-main-server` / `sales-intelligence`; baseline `999c63d`; uncommitted | Current typecheck/lint pass; focused 31/31; Outreach replica 22/22; read/attachment/fan-out regressions 10/11/11; offline 2392 pass/114 skip. [Handoff](evidence/csi-06/HANDOFF.md), [checks](evidence/csi-06/CHECKS.md), [review](evidence/csi-06/REVIEW.md). | Dashboard untouched; CSI-10/14 not started; flags off. Required checkpoint failed on its older snapshot; reported issues corrected in current source/docs, no patch applied or independent final approval claimed. |
| CSI-07 | E (B/C services) | complete (local) | Codex; server/Admin `sales-intelligence`; uncommitted | Owner/auth/current-scope, real durable HTTP invalidations, browser command/clock/reconnect proof; Admin 620/620, server focused 9/9, typechecks and focused lint pass. [Handoff](evidence/csi-07/HANDOFF.md), [checks and checkpoint](evidence/csi-07/CHECKS.md). | Production hosting/capacity remains CSI-16; no deployment/provider proof claimed. CSI-13 preserved. |
| CSI-08 | E | complete (local) | Codex; Admin/server `sales-intelligence`; uncommitted | Real search/pagination/expiry, attachments/reviews, commands/retry/conflicts/drafts, timeline/official links, Reps, desktop/narrow/keyboard/reconnect/clock proof. Admin626; Number reads10, attachment12, Outreach24; typechecks/focused lint. [Handoff](evidence/csi-08/HANDOFF.md), [checks](evidence/csi-08/CHECKS.md). | Required checkpoint ran: automated checks pass (snapshot2432/115skip; runner12), final review/CLI1 failed on isolated CSI-14 documentation proposal, wholly unapplied; no independent final approval. [Review](evidence/csi-08/REVIEW.md). Full Admin lint retains unrelated baseline errors. CSI-14 disabled; CSI-18/09/15/16 separate. |
| CSI-09 | E (A/C policy service) | complete (local) | Grok; server/Admin `main` after merge | Isolated replica 4/4; server focused 8/8; Admin focused 14/14; typechecks; 3107/3108 browser Coverage + settings save + Lead entry. [Handoff](evidence/csi-09/HANDOFF.md), [checks](evidence/csi-09/CHECKS.md). | Local only. No finish-work checkpoint. Next: named 1–2 subject seed. CSI-14 dialogs, CSI-15, flags, and CSI-10 empty-recording remain separate. |
| CSI-10 | C | complete | Codex implementation + Grok production seed; `sales-intelligence` server `bbdfe4c` / Admin `905fe87` | Implementation packet [csi-10](evidence/csi-10/HANDOFF.md). Seed: 9 reviewed unique links, Josh/Roy unmatched, no send. [Seed handoff](evidence/csi-10-seed/HANDOFF.md), [checks](evidence/csi-10-seed/CHECKS.md). | CSI-14 dialogs/P2 remain later. Optional Owner alias or explicit create for Josh/Roy. Local process flags only; Vercel flags unchanged. |
| CSI-11 | B | review (findings resolved) | Codex + independent code review; `vantage-main-server` / `sales-intelligence`, baseline `b92e7458`; uncommitted | Typecheck; focused 108/108; media replica 20/20; CSI-01–04 replicas 15/12/11/7/10; qualification 104 pass/3 pre-existing skips. [Handoff](evidence/csi-11/HANDOFF.md), [checks](evidence/csi-11/CHECKS.md), [review](evidence/csi-11/INDEPENDENT-REVIEW.md). | Both independent reviews approved; all six findings and three recommendations resolved. Final qualification/provider/media 111 pass/3 skips. CSI-05/10 absent inputs remain undetermined; CSI-12 consumes media hook; Team F verifies live permission/Blob at G6. Flags off. |
| CSI-12 | B | review (findings resolved) | Codex + independent review; vantage-main-server / sales-intelligence; baseline CSI-11 63b3dfb; uncommitted | Typecheck/lint; focused 13/13; transcription replica 19/19; CSI-01–04/11 replicas; full suite 2380 pass/114 skips. [Handoff](evidence/csi-12/HANDOFF.md), [checks](evidence/csi-12/CHECKS.md), [review](evidence/csi-12/INDEPENDENT-REVIEW.md). | STT, immutable redacted evidence, budget/retry and analysis intent complete. Independent findings resolved. Flags off; no commit/live proof. Team D owns analysis. |
| CSI-17 | D | implemented | Codex + authorized MCP/read agents; both repositories `sales-intelligence`; server `3355c6dcf68ed2c092824dc1dbb87c71a3f0c343`, MCP `7e12815189f24d422873f54f146f1fe1033dd655`; uncommitted | Twelve scoped tools, immutable evidence, pinned prompt/schema and durable one-submission intake; Owner-added operational/provider reads. Direct server full suite 2426 pass/114 skipped, focused/replica/typecheck/lint pass; MCP35/build/typecheck pass. [Checks](evidence/csi-17/CHECKS.md) distinguish failed earlier checkpoint test-file reads and later direct hardening. | [Handoff](evidence/csi-17/HANDOFF.md). CSI-13 now supplies the application consumer; paused behavior remains flag/readiness-dependent. CSI-10 replay and existing CSI-14 P2 remain separate. No live proof, deployment, commit or push. |
| CSI-13 | D | complete | Codex; server `sales-intelligence` / `a9b9bfcb7a70586ae14e974442e63a033abc7fbf` | Baseline and required CSI-17/14 review limitations inspected September 19. | Implementation and synthetic proof complete. Checkpoint 1789795679279-a540097e patch-ready/PASS; inspected coverage fix adopted and replica proof expanded to 21 passing tests. [Handoff](evidence/csi-13/HANDOFF.md), [checks](evidence/csi-13/CHECKS.md). CSI-18 excluded. |
| CSI-18 | D + E | complete (local) | Codex; server/Admin `sales-intelligence`; uncommitted | Server: Owner6, runtime23, intelligence9, Outreach24, focused21; typecheck/lint pass. UI:626 tests, typecheck/focused lint, real BFF/browser desktop/narrow/keyboard/conflict/retry/access proof. [Handoff](evidence/csi-18/HANDOFF.md), [checks](evidence/csi-18/CHECKS.md). | Server and UI acceptance separately complete. Required checkpoint snapshot gates/review PASS; overall stale/CLI1, adapted source validated directly. Full Admin lint retains unrelated baseline. [Review](evidence/csi-18/REVIEW.md). CSI-09/14/15/16 remain separate. |
| CSI-14 | C (server); E (dialogs) | implemented (destination + P2; live send still gated) | Grok destination/P2 on Codex server baseline; `sales-intelligence` HEAD `bbdfe4c`; dirty CSI-10 seed preserved | Destination/P2: server typecheck/lint 0; focused nudge+identity 17/17; nudge replica 18/18; identity replica 12/12; Admin API 9/9 + typecheck 0. [Destination handoff](evidence/csi-14-destination/HANDOFF.md). Prior CSI-14 packet remains historical. | Smallest Message-rep picker landed. Fuller dialogs/history and live-send proof remain separately gated. Official index migration not applied. |
| CSI-15 | F (B/D adapters) | complete (local; validation limits recorded) | Codex integration; Cursor Grok/Composer assistance; server/Admin `main` | [Handoff](evidence/csi-15/HANDOFF.md), [checks](evidence/csi-15/CHECKS.md), [review](evidence/csi-15/REVIEW.md). Replica backfill 14/14, retention 10/10, budget 13/13, period 4/4; units 64/64; routes 7/7; Admin 13/13. | Final scoped server/Admin typechecks and lint pass; focused Composer reviews approve. Full server typecheck blocked only by concurrent external MCP probe errors. Broader historical snapshot checkpoint failed; no isolated patch applied. No production, commit or CSI-16. |
| CSI-16 | F | not started | — | — | Integrated delivery |

## Specification validation

## CSI-07 / initial CSI-08 ownership — Codex, September 19, 2026

Additional exact Admin integration paths claimed: `tests/dashboard-nav.test.ts` (intentional Today ordering), `server/auth/routeGuard.ts` (early unauthenticated CSI redirect). No unrelated lint repairs claimed.

Claimed CSI-07 and partial CSI-08 on server/Admin `sales-intelligence`. Clean baselines and remotes recorded in [intake](evidence/csi-07/INTAKE.md); CSI-13 preserved. MCP and source export remain untouched.

Exact server paths claimed: `src/services/salesIntelligence/live.ts`, `src/services/salesIntelligence/live.test.ts`, `src/routes/sales-intelligence-admin.routes.ts`, `src/services/salesIntelligence/dto.ts`, `src/services/salesIntelligence/outreach/reads.ts`, `scripts/csi07-local.ts`, `scripts/test-csi-live.ts`, `docs/knowledge/services/sales-intelligence-live.md`, `docs/index.md`, `docs/call-sales-intelligence/workspace/{LEDGER,CONTRACTS}.md`, `docs/call-sales-intelligence/workspace/teams/e-dashboard.md`, and evidence files under `docs/call-sales-intelligence/workspace/evidence/csi-07/`.

Exact Admin paths claimed: `app/(dashboard)/sales-intelligence/page.tsx`, `app/api/sales-intelligence-live/route.ts`, `app/api/proxy/[...path]/route.ts`, `server/auth/{authorization,proxyForwardHeaders}.ts`, `server/auth/proxyForwardHeaders.test.ts`, `server/vantage-api/{response,response.test}.ts`, `server/sales-intelligence-live.ts`, `server/sales-intelligence-live.test.ts`, `lib/api/salesIntelligence.ts`, `lib/query/salesIntelligence.ts`, `components/layout/{dashboard-nav,scope-aware-header-controls}.tsx`, `components/sales-intelligence/{workspace,attention,followup-card,ownership,detail-panel}.tsx`, `components/sales-intelligence/styles/sales-intelligence.css`, `components/sales-intelligence/lib/format.ts`, `components/sales-intelligence/atoms/{badge,button}.tsx`, `scripts/csi07-local.mjs`, and `.cursor/rules/project-organization.mdc`. Any additional path will be claimed before editing. One implementation writer; no concurrent agent delegation. No CSI-18, messaging repair, providers or production changes.

## CSI-13 ownership — Codex, September 19, 2026

Verified server `sales-intelligence` at `a9b9bfcb7a70586ae14e974442e63a033abc7fbf`, MCP `sales-intelligence` at `9a8fd37bf78f8074011fb2d47ff3da3ec400b33d`; both remotes belong to `jbell-rusty-vantage`. Server baseline has only untracked `evidence/csi-17/NEXT-CSI-13-PROMPT.md`, preserved; MCP is clean. No reset, checkout, commit or push.

Own CSI-13 additions under `src/services/salesIntelligence/analysis/**`, synthetic runtime/integration tests and `evidence/csi-13/**`. Coordinate minimal additive edits to existing jobs/budget/policy, run/finding publication models, Outreach effect authority adapter, queue/cron/bootstrap/config registration, package dependencies/scripts, number analysis reads and owning Service/catalog/CONTRACTS/Team D documentation. One implementation writer; no concurrent shared-file owner in this task. MCP remains the only model tool provider; any necessary transport changes require its repository instructions first. CSI-12 scheduling/STT and CSI-06 effect semantics are consumed, not rebuilt.

Preserve CSI-17 failed/verify checkpoint, snapshot file-read failures and unapplied CSI-10 empty-recording replay proposal; later direct tests are not independent approval. CSI-14 editable review-context restriction-bypass P2 remains unresolved and outside this task. CSI-18 controls, dashboard, production/deployed providers, migrations, backfill, sends, flags/configuration enablement and paid model/STT calls are excluded. Only synthetic/local implementation validation is authorized.

## CSI-17 ownership — Codex, September 18, 2026

Both remotes belong to `jbell-rusty-vantage`: server `vantage-movers-server`, MCP `vantage-movers-mcp`. Server branch/HEAD: `sales-intelligence` / `3355c6dcf68ed2c092824dc1dbb87c71a3f0c343`, existing dirty CSI-10/14 work preserved. MCP baseline: clean `main` / `7e12815189f24d422873f54f146f1fe1033dd655`; authorized exact local `sales-intelligence` branch created before implementation.

Own server `src/services/salesIntelligence/analysis/**`, dedicated internal router/tests, generated schema contract, synthetic replica runner/tests, CSI-17 evidence and Service documentation. MCP subagent owns dedicated `/api/intelligence-mcp`, scoped auth/context/adapters/tools/prompt/resource, tests and README. Coordinate additive shared auth, run/snapshot/submission models, config/tool enums, v1 registration, durable-job handoff and package scripts through CONTRACTS.md. Dashboard untouched; no CSI-13 execution/application or CSI-14 messaging fix. The fresh CSI-14 independent review's unresolved P2 remains separate. Earlier CSI-06 failed, CSI-10 stale and CSI-14 failed checkpoint snapshots remain distinct from direct source checks.

Owner additions authorize bounded operational querying and a fixed-endpoint RingCentral read adapter; all proof uses local/synthetic data and fake transport. No production credentials/calls, model invocation, sends, flag enablement, migration/backfill, deployment, commit or push.

## CSI-14 ownership — Codex, September 18, 2026

Repository `vantage-main-server`, branch `sales-intelligence`, observed baseline `3355c6dcf68ed2c092824dc1dbb87c71a3f0c343`, remote `https://github.com/jbell-rusty-vantage/vantage-movers-server.git`. Existing modified/untracked CSI-10 work is preserved; the checkout was not clean. Own `src/services/salesIntelligence/nudges/**`, focused fake-provider and disposable replica tests, CSI-14 evidence and owning Service documentation. Coordinate additive OwnerRepNudge model, validation/DTO, configuration, Owner/cron routes, durable job/recovery registration, package scripts, Vercel schedule and narrow Outreach history integration in CONTRACTS.md. Dashboard untouched; Team E retains dialogs. No live messages/provider probes, production operations, flag enablement, commit or push. CSI-10 snapshot checks/final review passed but overall checkpoint became stale; later direct source checks are separate. CSI-06's older failed checkpoint likewise remains distinct from later passing direct checks.

## CSI-10 ownership — Codex, September 18, 2026

Own `src/services/salesIntelligence/repIdentity/**`, focused identity tests and disposable replica runner, `docs/call-sales-intelligence/workspace/evidence/csi-10/**`, and identity Service documentation. Coordinate additive shared changes in RepIdentityLink model/index inventory, CSI validation/DTOs, Owner routes, job stage/dispatch/recovery registration, and narrow Outreach/eligibility consumer integrations through CONTRACTS. Repository `vantage-main-server`, branch `sales-intelligence`, baseline `3355c6dcf68ed2c092824dc1dbb87c71a3f0c343`, remote `jbell-rusty-vantage/vantage-movers-server`. Dashboard untouched. No official records, providers, messaging, production migration/backfill, flag enablement, commit or push.

## CSI-05 ownership — Codex, September 18, 2026

Own `src/services/salesIntelligence/attachment/**`, attachment replica runner/tests, CSI-05 evidence and Service documentation. Coordinate additive registration in `src/services/numberActivity/jobDispatch.ts`, `src/routes/sales-intelligence-{admin,cron}.routes.ts`, `vercel.json`, `package.json`; reuse Team A boundary/schema/model/config contracts. Any necessary additive shared adaptation is recorded in CONTRACTS and the handoff. Dashboard untouched; no other repository edits. CSI-06/10/14, Outreach runtime, official record writes, analysis/STT, live providers and production enablement remain outside this claim.

CSI-11 ownership addendum (September 17): `scripts/test-csi-reads.replica.test.ts` is claimed solely to extend the existing Coverage assertion with the additive recording counters; existing read-only and pagination proofs remain intact.

## CSI-11 ownership — Codex, September 17, 2026

Clean baseline verified before edits. Exact owned new files: `src/services/salesIntelligence/conversations/{discover,eligibility,media,mediaPolicy,workerSupport}.ts`, `src/services/salesIntelligence/conversations/{eligibility,media,wiring}.test.ts`, `src/services/ringcentral/recordings.ts`, `src/services/ringcentral/recordings.test.ts`, `src/services/conversations/streamingMedia.ts`, `scripts/test-csi-media.ts`, `scripts/test-csi-media.replica.test.ts`, `docs/knowledge/services/sales-intelligence-recording-media.md`, and `docs/call-sales-intelligence/workspace/evidence/csi-11/**`.

Coordinated additive shared edits: `src/services/salesIntelligence/jobs.ts` (fenced retry projection), `src/config/domain/salesIntelligence.ts` (media_fetch stage/config), `src/config/domain/conversations.ts`, `src/models/LeadConversation.ts`, `src/models/CallInteraction.ts`, `src/services/salesIntelligence/dto.ts`, `src/services/numberActivity/{jobDispatch,coverage,fixtures}.ts`, `src/services/ringcentral/client.ts` (bounded streaming read with response headers), `src/routes/sales-intelligence-cron.routes.ts`, `src/routes/sales-intelligence-admin.routes.ts`, `vercel.json`, `package.json`, `docs/index.md`, `docs/knowledge/services/{lead-conversation,number-activity-reads}.md`, specification documents `02-domain-models.md`, `03-server-pipeline-and-jobs.md`, `04-server-routes.md`, and workspace `CONTRACTS.md`/`LEDGER.md`. No qualification, transcript, Lead-write, Admin, production, or budget work. All provider paths use fakes. No commit.

September 17: interview revision and subsequent server/Admin/MCP codebase audit completed. Current 07 is the future Claude design intake contract; its former contents are archived under history/. 08 remains historical evidence, and 09 records decisions. See [11](../11-codebase-alignment-audit.md) for inspected integration gaps and team adaptations.

Documentation validation: 24 active pack/workspace documents, 110 local links including referenced heading anchors, code fences/conflict markers, all 18 issue ids, six team briefs, $80 configuration and scoped submission contract passed. `git diff --check` passed after whitespace cleanup. These are documentation checks only; no runtime implementation tests, live provider actions or future design-artifact review were performed.

September 17 (later): portable [RingCentral capability summary](RINGCENTRAL-CAPABILITY.md) added for agents from the Sept 14–15 proofs. `scripts/dev_ops/**` remains gitignored. Not a renewed production probe.

## Integration notes

September 18 CSI-11 fresh independent review, requested by Owner: `/root/csi11_final_review` identified completed-exclusion rescheduling and unbounded shared-token waits. Both resolved with regressions and independently approved; no remaining actionable findings. Expanded replica 20/20; qualification/provider/media checks 111 pass and 3 pre-existing skips. Updated csi-media-v1 specifies revisioned successor intent only after an excluded completion. [Review](evidence/csi-11/INDEPENDENT-REVIEW.md), [checks](evidence/csi-11/CHECKS.md). Still uncommitted, flags off, no live provider or production action.

September 17 CSI-11 recording discovery and media: [handoff](evidence/csi-11/HANDOFF.md), [exact files](evidence/csi-11/FILES.md). `csi-media-v1` imports and downstream obligations recorded in CONTRACTS.md. Registered discovery/media consumers and bounded recovery reuse the existing foundation; additive transactional retry projection closes lease-fenced failure handling. Synthetic provider and disposable replica proofs cover pending/denied/throttled outcomes, immutable media, account uniqueness and concurrent workers. Independent review findings resolved and final signoff received. Patch remains uncommitted; no production actions, STT, analysis or flag enablement. September 14 recording denial remains historical evidence, not a current grant.

September 17 CSI-01 preparation: [handoff](evidence/csi-01/HANDOFF.md). Envelope module `csi-envelope-v1` recorded in [CONTRACTS.md](CONTRACTS.md). G1 freeze remains pending.

September 17 CSI-02 capture: [handoff](evidence/csi-02/HANDOFF.md), [checks](evidence/csi-02/CHECKS.md). `csi-capture-v1` imports recorded in [CONTRACTS.md](CONTRACTS.md#csi-02-concrete-imports-server-relative-september-17). Entry points for CSI-03: `observeRingCentralWebhookEvents`, `runCallLogReconcileOnce`. Provider fixtures are synthetic; G6 capability remains open.

September 17 (later) CSI-02 independent review: Opus 5 reviewer returned Request Changes; three findings altered stored facts (fabricated short-dial extensions made customer calls Internal; missing party `direction` produced sticky Internal; stale Call Log regressed leg facts) and one kept calling a throttled provider. All resolved with regression tests and re-proven on the replica; [INDEPENDENT-REVIEW.md](evidence/csi-02/INDEPENDENT-REVIEW.md). Additive contract fields: `request_id` on persist/observe dependencies, `ReconcileSummary.request_id`/`throttle_retry_after_observed`, audit `current.proof_ref`/`input_kind`/`request_id_generated`/`aliases_added`/`merged_interaction_ids`.

September 17 (later) CSI-03 fan-out: [handoff](evidence/csi-03/HANDOFF.md), [checks](evidence/csi-03/CHECKS.md), [review](evidence/csi-03/INDEPENDENT-REVIEW.md). `csi-fanout-v1` recorded in [CONTRACTS.md](CONTRACTS.md#csi-03-concrete-imports-server-relative-september-17). Route fan-out awaits a deduplicated `capture_projection` job per stored receipt; receipt watermark recovery (monotone, keyset-paged) closes gaps; worker passes its job id as `request_id`; queue consumer, job-recovery and Call Log reconcile crons registered in `vercel.json`; subscription mode `all` with ownership-guarded plan/ensure/renew/repair (no production subscription touched). Independent review: watermark regression must-fix reproduced and fixed; ack timeout, quarantine, health/ownership fail-closed, docs, handshake filter, keyset cursor, scan deadline and index residuals all closed. Additive CSI-01 edits: `claimCsiJob` stage filter, job `result`, audit kind `job`.

September 17 (later) CSI-04 Number Activity reads: [handoff](evidence/csi-04/HANDOFF.md), [checks](evidence/csi-04/CHECKS.md), [review](evidence/csi-04/INDEPENDENT-REVIEW.md). `csi-numbers-v1` recorded in [CONTRACTS.md](CONTRACTS.md#csi-04-concrete-imports-server-relative-september-17). Daily directory snapshot sync (scope `directory`, bound 30, A→B→A advances `taken_at`, latest snapshot read by CSI-02 `loadDirectoryLookup`); Owner search/detail/timeline with honest Coverage (`unavailable` on a failing stream); durable rebuild of derived fields (no business facts; fan-out `input_revision: 1`); admin routes behind the existing Owner/flag guard. Independent Opus 5 review: Request Changes (hygiene coerce, directory revert, rebuild-all revision hash) → resolved and Approved. Additive CSI-01 edit: `completeCsiJob` `resultFrom`. Flags remain off. Live directory/queue/cron unverified.

Append dated handoffs, contract changes and remaining capability checks here or link an issue-specific artifact in `evidence/`. Keep sensitive/provider data out of this workspace. Do not turn a denied recording permission into a zero-data pass.

## CSI-01 Step 2 ownership — Codex, September 17, 2026

Status: complete — independent GPT-6 review approved and G1 foundation contracts frozen. Clean server baseline `8219d2a`; clean dashboard baseline on `sales-intelligence`. Grok's committed patch and original handoff are preserved. This task is the sole writer assigned here; no other checkout is switched or reset.

Owned server files: `src/config/domain/salesIntelligence.ts`, `src/config/domain.ts`, `src/config/domain/conversations.ts`; `src/models/salesIntelligence/*` and new CSI model accessors; `src/models/LeadConversation.ts`; `src/validation/intelligence/*`, `src/validation/v1/salesIntelligence.ts`, `src/validation/v1.validation.ts`; `src/services/salesIntelligence/{dto,auth,transactions,jobs,aiBudget,policy,evidence}.ts` and their tests; `src/services/conversations/reads.ts`; `scripts/migrations/sales-intelligence*`; isolated replica test runner; this workspace's CONTRACTS/LEDGER and `evidence/csi-01/STEP2-*` review artifacts. Any additional compatibility files will be listed in the final packet before handoff. Dashboard edits limited to existing conversation nullable-metadata compatibility if required; no screens.

Reuse: `db.withTransaction`, `durableWork/checksum.canonicalJson`, existing Registry Owner verifier, `runtime.getMongoDatabaseName`, report/apply/verify migration conventions. New CSI ledger/audit avoids widening official command origins or EntityChange entities. No production database, provider, queue, subscription or messaging actions authorized or performed. Independent GPT-6 review replaced Fable at the Owner’s request; all substantive findings are resolved.

## CSI-02 ownership — Fable, September 17, 2026

Status: review (ready). Baseline is committed `dc70b43` on `sales-intelligence` (clean tree at claim time); the CSI-02 patch is uncommitted. Single writer for the files below; CSI-01 owned files were read-only except two additive corrections recorded in CONTRACTS.md and the handoff (`CallInteraction.external_endpoint_kind`; audit invalidation kind `interaction`). Replica proofs ran on a disposable Docker MongoDB 8.0 single-node replica `csi01` (loopback 27189) started for this work because the CSI-01 replica was not running; see [CHECKS.md](evidence/csi-02/CHECKS.md).

Owned new server files: `src/services/numberActivity/{types,phone,directory,accountIdentity,interactionProjection,persistInteraction,observeWebhookEvents,callLogClient,reconcileCallLog,fixtures}.ts`, `src/services/numberActivity/{interactionProjection,capture}.test.ts`, `scripts/test-csi-capture.ts`, `scripts/test-csi-capture.replica.test.ts`, `docs/knowledge/services/number-activity-capture.md`, `docs/call-sales-intelligence/workspace/evidence/csi-02/**`. Shared files touched only for recorded additive corrections: `src/models/CallInteraction.ts`, `src/models/salesIntelligence/infrastructure.ts`, `src/services/salesIntelligence/transactions.ts`, `package.json` (one test script), `docs/index.md`, `docs/call-sales-intelligence/02-domain-models.md` (two rule lines), CONTRACTS/LEDGER. Not touched: Call Qualification services, `ringcentral-webhook.routes.ts`, `call-log-sync*.ts`, `ingestRingCentralQualifiedCall`, `vercel.json`, subscriptions, Admin.

## CSI-03 ownership — Fable, September 17, 2026

Status: review (ready; independent review approved after resolution). Baseline is committed `1925c32` on `sales-intelligence` (clean tree at claim time); the CSI-03 patch is uncommitted and left for review together with CSI-04. Single writer for the files below. Builds on CSI-01 (`jobs.ts`, `transactions.ts`, `auth.ts`) and CSI-02 (`observeWebhookEvents.ts`, `reconcileCallLog.ts`) without re-implementing either.

Owned new server files (actual): `src/services/numberActivity/{webhookReceipts,webhookFanout,webhookRecovery,captureProjectionWorker,jobDispatch}.ts`, `src/services/numberActivity/fanout.test.ts`, `src/services/ringcentral/webhook-subscription-lifecycle.ts` and `.test.ts`, `src/routes/sales-intelligence-cron.routes.ts` and `.test.ts`, `api/queues/sales-intelligence-consumer.ts` and `.test.ts`, `ops/ringcentral/sales-intelligence-subscription.ts`, `scripts/test-csi-fanout.ts`, `scripts/test-csi-fanout.replica.test.ts`, `docs/knowledge/services/sales-intelligence-webhook-fanout.md`, `docs/call-sales-intelligence/workspace/evidence/csi-03/**`. Shared files touched only for recorded additive edits: `src/routes/ringcentral-webhook.routes.ts` (fan-out after capture; qualification path unchanged), `src/services/ringcentral/webhook-capture.ts` (`receiptId` in the capture result; exported index ensure; one partial scan index), `src/services/ringcentral/webhook-subscriptions.ts` (mode `"all"`; two read/mark helpers; inbound builders byte-for-byte), `src/services/salesIntelligence/jobs.ts` (optional stage filter on `claimCsiJob`; `result` option on complete/fail), `src/models/salesIntelligence/infrastructure.ts` and `src/services/salesIntelligence/transactions.ts` (job `result` field; audit kind `job`), `src/app.ts` (cron router mount), `vercel.json` (cron and queue registration), `package.json` (`test:csi:fanout:replica`), `docs/index.md`, `docs/knowledge/services/number-activity-capture.md` (wiring line), CONTRACTS/LEDGER. Not touched: Call Qualification services, `call-log-sync*.ts`, `ingestRingCentralQualifiedCall`, evaluator, filters, `ringcentral_call_log_sync_state`, `scripts/dev_ops/**`, Admin, production subscriptions.

## CSI-04 ownership — Fable, September 17, 2026

Status: review (ready; independent review approved after resolution). Same baseline and uncommitted patch as CSI-03. Single writer for the files below. Builds on CSI-01 (`jobs.ts` `resultFrom`), CSI-02 (projection/persist/directory lookup) and CSI-03 (cron router, jobDispatch, coverage webhook scope) without re-implementing them.

Owned new server files (actual): `src/services/numberActivity/{directorySync,rebuild,dto,coverage,contactNumbers,search,timeline}.ts`, `src/services/numberActivity/{directorySync,rebuild,reads}.test.ts`, `src/routes/sales-intelligence-admin.routes.ts` and `.test.ts`, `scripts/test-csi-numbers.ts` + `.replica.test.ts`, `scripts/test-csi-reads.ts` + `.replica.test.ts`, `docs/knowledge/services/number-activity-reads.md`, `docs/call-sales-intelligence/workspace/evidence/csi-04/**`. Shared files touched only for recorded additive edits: `src/routes/sales-intelligence-cron.routes.ts` (directory-sync handler, rebuild drain), `src/services/numberActivity/jobDispatch.ts` (`rebuild` stage), `src/routes/v1.routes.ts` (admin router after the CSI boundary), `src/services/salesIntelligence/jobs.ts` (`resultFrom`), `src/services/numberActivity/directory.ts` (comment), `package.json` (two replica scripts), `docs/index.md`, CONTRACTS/LEDGER. Not touched: Call Qualification, `call-log-sync*`, Admin UI, production data, `outreach_ensure`/`attachment_refresh`/`recording_discovery` consumers.

## CSI-01 compatibility ownership addendum

September 17 review closeout: at the Owner's request, a separate GPT-6 (`gpt-6-astra`) subagent replaced Fable. It found five substantive issues, then independently approved their fixes and G1 foundation freeze. [Review history and approval](evidence/csi-01/STEP2-INDEPENDENT-REVIEW.md). Added review ownership: this report, document 02's budget activation clarification, and the existing owned auth/validation/model/job/budget tests and modules. Runtime fixes: closed dynamic run-route templates; exact Owner command targets; immutable finding/run provenance; cross-deployment dedupe conflicts; once-only budget-period activation. Verifier also checks stored job subject/dataset. Main server 43/43 focused tests and 15/15 replica tests; reviewer 9/9 focused and 15/15 replica plus adversarial exploit replays. No remaining substantive CSI-01 findings. G2–G6 are unchanged.

Additional exact files: `src/models/EntityChange.ts` is read-only (scan index is applied by CSI migration); `src/routes/sales-intelligence-boundary.routes.ts` and test, `src/routes/v1.routes.ts`; `scripts/migrations/lead-conversation-indexes.ts` (prevent old index CLI bypassing account-attribution readiness); `src/models/LeadConversation.test.ts`; server `src/services/salesIntelligence/{fixtures,foundation.test}.ts`; dashboard `lib/api/conversations.ts` and `components/conversations/conversation-presentation.ts` for nullable metadata only. New model filenames are enumerated in `src/models/salesIntelligence/registry.ts` and the final changed-file manifest.

Final ownership additionally includes `src/middleware/requireApiSecret.ts` (dedicated CSI key hard route scope), `package.json`, `scripts/migrations/README.md`, `scripts/test-csi-foundation.ts`, `scripts/test-csi-foundation.replica.test.ts`, `docs/index.md`, `docs/knowledge/services/sales-intelligence-foundation.md`, `docs/call-sales-intelligence/04-server-routes.md`, and dashboard `tests/conversations-page.test.ts`. [STEP2-FILES.md](evidence/csi-01/STEP2-FILES.md) enumerates all actual files, including test evidence. No feature flags enabled in deployment; no production action performed. Independent review and substantive finding resolution are complete; see STEP2-INDEPENDENT-REVIEW.md.

## CSI-12 ownership — Codex, September 18, 2026

Owner-authorized Team B scope only; `vantage-main-server` / `sales-intelligence`, clean baseline `63b3dfb` (CSI-11 is committed; earlier uncommitted labels above are historical/stale). Own new `src/services/salesIntelligence/conversations/{transcribe,transcript,transcriptionScheduling}.ts`, `transcript.test.ts`, `transcriptionWiring.test.ts`, `src/services/conversations/transcriptionProvider{,.test}.ts`, `scripts/test-csi-transcription{,.replica.test}.ts`, Service card and `workspace/evidence/csi-12/**`.

Additive shared edits authorized by this CSI-12 request: `src/config/domain/salesIntelligence.ts`, `src/models/LeadConversation.ts`, `src/services/conversations/{reads,redaction,redaction.test}.ts`, `src/services/salesIntelligence/{aiBudget,policy}.ts`, CSI-11 import-boundary test (restricted to its actual owned files), `numberActivity/jobDispatch.ts`, cron router, `vercel.json`, `package.json`, Service/catalog/project-organization documentation and `CONTRACTS.md`. Exact manifest: [FILES](evidence/csi-12/FILES.md). No other team runtime, Admin/MCP, qualification, official records, live providers, production, flag enablement or commit. Independent review findings resolved; final source checks pass. Isolated quality-hook outcomes are recorded separately in CHECKS.

## CSI-06 ownership — Codex, September 18, 2026

Verified clean server sales-intelligence at 999c63d before edits. Own src/services/salesIntelligence/outreach/**, followups/**, review/**, staffing/clock helpers, scripts/test-csi-outreach*, and evidence/csi-06/**. Coordinate smallest additive registration in jobDispatch.ts, sales-intelligence admin/boundary/cron routes, vercel.json, package.json, shared DTOs and Team A schemas only when required and documented in CONTRACTS. Dashboard untouched; all work stays in vantage-main-server. No CSI-10/14, official writes, provider sends, analysis/STT or production flag enablement.

## CSI-15 corrective integration ownership — September 19
Parent Codex owns backfill, retention, jobs/config, deferred Outreach safety, purge-aware analysis reads, routes/cron/queue, Admin Coverage DTO, replica proofs and evidence. Cursor Composer 2.5 is restricted to budget/provider recovery in analysis/worker.ts, conversations/{transcribe,transcriptionScheduling,discover,media}.ts, aiBudget.ts and new scripts/test-csi15-budget*.ts. Cursor quality checkpoint will use Composer 2.5 only. Original Owner dirty documents remain preserved. No production operations or commits.

Coordinated bounded subagents own retention implementation/proof, adversarial backfill proof, and the six-file evidence packet plus CONTRACTS/LEDGER and five owning Service updates. Exact task files and preserved external dirty documents: [CSI-15 FILES](evidence/csi-15/FILES.md). The Owner mission explicitly allows subagents and overrides the older handoff-template branch instruction; all work remains on `main`.
