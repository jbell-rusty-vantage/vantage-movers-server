# Inspected code and source map

Inspection date 2026-10-02. Root C:/Users/Pinda/Proyectos/vantage. Admin HEAD 0993e3151dd08fe4edea7baf348ad9339dacdbd5; server HEAD becf8de02ed46aa6a4625e8188c299af6caa98ba. Remotes verified jbell-rusty-vantage/vantage-admin and jbell-rusty-vantage/vantage-movers-server. Admin initially clean; server initially had a modified .gitignore. No reset/switch/commit occurred. Reinspect working tree and pin cloud revisions before work; these local SHAs do not prove deployed behavior.

Paths below are relative to the named repository and intentionally displayed as code, not links to an inaccessible sibling. Actual local repository instructions win for unchanged code. Imported source authority in sources/ is separately hashed.

| Existing server path | Use / necessary change |
| --- | --- |
| src/models/salesIntelligence/{infrastructure,outreach}.ts; src/models/CallInteraction.ts | Existing policy/job/audit/Outreach/call schema and index conventions; add isolated models, do not expand old strict policy |
| src/services/salesIntelligence/{policy,settings,transactions,auth,repScope}.ts | Reuse immutable pointer/CAS/idempotency/signed actor; replace legacy historical-followup/shared-number access for new desk |
| src/config/domain/salesIntelligence.ts | Existing synchronous csiFlag reads env; inventory/migrate new-desk dependencies, do not retain hidden gate |
| src/services/salesIntelligence/outreach/{leadInstant,leadProgress,attention,ensure,derive,worker}.ts | Timestamp adapter/accepted priority/search patterns; Attention AI/ranking and old planners not new cadence authority |
| src/services/salesIntelligence/overview/repDays.ts | Eastern-day/identity helpers; broad per-involved-rep counts are incompatible with new goal |
| src/services/salesIntelligence/{analysis/apply,assessment/engagement,assessment/runtime}.ts | AI followup/planning producers to fence for migrated subjects |
| src/routes/sales-intelligence-admin.routes.ts; src/routes/v1.routes.ts; src/routes/sales-intelligence-cron.routes.ts; api/queues/sales-intelligence-consumer.ts | Transport/cron/job admission must load persisted snapshot; exact new router registration owned by A |
| src/services/salesIntelligence/backfill/{worker,activate,windowWork,step,livePriority}.ts | Reuse bounded/checkpoint patterns only; activation invokes media discovery and is unsafe for deterministic migration |
| src/services/ringcentral/{rateLimitGate,webhook-subscriptions}.ts | Preserve settlement/recovery; add measured SMS admission and application-owned subscriptions |
| src/services/dailyOperations/{recordDomainFacts,rebuild}.ts | Existing shipped board; repair mixed-time Lead facts, sent-day reconstruction and rebuild live-race fence before parity certification |
| scripts/migrations/granot-lifecycle-migration.lib.ts | Report/apply/verify target and manifest conventions, not authorization to run production |
| ops/{backfill-outreach-trigger-instant,reensure-outreach}.ts | Existing operations have effects; inspect/adapt only in isolated rehearsal; no blind legacy replay |
| CLOUD_AGENTS.md; .cursor/scripts/start-api.sh; vercel.json | Safe isolated runtime startup and checked-in schedules, not proof of deployment |

| Existing admin path | Use / necessary change |
| --- | --- |
| app/(dashboard)/sales-intelligence/page.tsx; route-viewer.ts; desk-root.tsx | Owner/Rep canonical desk; normalize view URLs rather than parallel app |
| components/sales-intelligence/desk/desk.tsx; data/{url-state,use-attention,use-sales-features}.ts | Existing tabs/pagination/capabilities; new cadence DTOs and config revision invalidation |
| app/(dashboard)/sales-intelligence/outreach/[id]/ | Keep identity/deep links; reduce rendered panels |
| components/sales-intelligence/settings-form.tsx | Existing legacy CSI settings; new isolated Owner config editor without two cadence authorities |
| lib/api/salesIntelligence.ts; lib/query/salesIntelligence.ts | Zod/no-store/signed command bridge and live query invalidation |
| app/api/proxy/[...path]/route.ts; server/auth/{authorization,proxyForwardHeaders}.ts | Exact Rep endpoint allowlists; include new namespace scope/signature guards |
| server/sales-intelligence-live.ts; proxy.ts | Scoped streaming and request-boundary session checks |
| app/(dashboard)/daily/page.tsx; components/daily/daily-shell.tsx | Reuse Owner board/summary; retain five-minute contract and one mounted stream |
| tests/sales-intelligence/contracts-dir.ts | Legacy tests skip if sibling fixtures absent; new acceptance uses this packet's local fixtures and treats skipped required tests as blocked |

Existing collections: outreach_records/outreach_followups/outreach_rep_days, call_interactions/call_interaction_aliases, rep_identity_links, ringcentral_directory_snapshots, sales_intelligence_sync_state, sales_intelligence_sync_windows, sales_intelligence_jobs, sales_intelligence_audit_events, sales_intelligence_command_executions, sales_intelligence_policy_versions, sales_intelligence_policy_pointers. lead_messages are app-dispatched automated messages, not rep SMS Message Store. New model names and exact HTTP target interface are in CONTRACTS.md.

Producer fence matrix: ensure first-action/quoted/progress nominations; derive going-cold/promise/cooldown generation; analysis apply and engagement extracted promises; assessment runtime effects/replans; worker sweeps/clock nominations. Fence routine writes for migrated cohort. Keep restriction checks, Owner explicit instructions, official closure, canonical evidence and durable recovery. Each path gets a negative test proving no new competing task with new policy on. Disabling UI mounts alone is insufficient.


## D01 deterministic-only scope clarification — October 3, 2026

Confirmed D01 (October 3, 2026): the Sales Outreach Desk is entirely deterministic code. Remove LLM agent analysis, transcription, summaries, assessments, extracted promises and AI suggestions from this outreach feature, including background producers and UI dependencies. Canonical provider call/SMS metadata, accepted priority facts, human commands, restrictions, assignment and audited policy drive the feature. Retain the Vantage MCP server. A future agent capability to find RingCentral call files, transcribe or summarize is separate, outside this outreach specification, and is neither implemented nor authorized here. Preserve historical evidence without creating an AI pipeline or displaying new AI suggestions. Human/provider-derived restrictions remain authoritative; runtime planner/analysis fencing must prevent legacy AI activity from creating new outreach effects for the migrated cohort.

Existing analysis/assessment paths above are inspected legacy code to remove from the feature dependency graph and fence for the migrated cohort. They are not reusable outreach functionality. Restriction evidence already recorded stays authoritative until resolved; no new AI extraction producer is required or permitted by this feature. MCP remains a separate package and is not removed.


## P05h eligibility seam — October 3, 2026

Legacy src/services/salesIntelligence/outreach/transitions.ts officialClosure closes no_sync alongside booked/cancelled/duplicate/bad_lead. P05h requires viable No-Sync Leads to remain eligible in the new desk without changing reporting semantics or silently reopening already-closed records. Add/test the explicit new-desk seam and preserve unrelated legacy consumers/history. Form Fill is not automatic exclusion/merge.


D01 removal scope: retire outreach LLM/transcription/summary/assessment/extracted-promise/suggestion admission and producers feature-wide, including unseeded existing Leads. A small cadence pilot does not authorize continued legacy AI processing outside the pilot. Retain existing historical evidence and deterministic provider capture/authoritative restrictions. MCP remains separate.
