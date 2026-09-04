# Session story-operations-registry-granot-crm-source-projections-2026-09-04T1013Z

- Date (UTC): 2026-09-04T10:13Z
- Service / module: `operationsRegistry` / `granotCrmSourceProjections.ts`
- Lock: taken
- Branch / PR: `docs/story-refactor` / (new PR after #152 merged; stamp URL after open)

## Stock at start

- Wave: A
- Visited / in-progress / unvisited: 23 / 1 / 14
- Recommendations on disk: 149
- Current service / next module (TRAVERSAL): `operationsRegistry` (in-progress) / `granotCrmSourceProjections.ts`

This checkout booted on `cursor/vantage-server-story-refactor-d663` with a stale seed (NOW pointed at `crmSourceOutboundSms.ts`, 148 recs, PR #151). Disk on `docs/story-refactor` already had `operations-registry-crm-source-outbound-sms.md` (149 recs, next `granotCrmSourceProjections.ts`, PR #152 merged). Checked out `docs/story-refactor` before choosing the module. NOW.md held the lock for this session id.

## This pass

- opened new service?: no
- path or skip: recommended `granotCrmSourceProjections.ts` → [recommendations/operations-registry-granot-crm-source-projections.md](../recommendations/operations-registry-granot-crm-source-projections.md)
- operations named: show the Owner every Granot name with live company, Feed, and automation health (list; shared-label count is across the loaded set; `available_for_apply` lives on each linked automation row’s compatibility, not on the card); show one Granot name the same way (GET detail + PATCH / activation re-read; shared-label count is 1). This file does not resolve a live observation, send a text, write a Registry Change, or attach an automation-source pointer.
- remaining in this service: `granotAutomationSources.ts` (next), `trustedActor.ts`, `registryAudit.ts`, `runtimeTelemetry.ts`, `queries/overview.ts`, `queries/health.ts`, `queries/changes.ts`

## Stock at end

- Visited / in-progress / unvisited: 23 / 1 / 14
- Current service / next module: `operationsRegistry` (in-progress) / `granotAutomationSources.ts`

## Messages posted

- 2026-09-04T1013Z next-run

## Ideas parked

- none

## Contradictions

- none (knowledge `available_for_apply` on the Granot name vs nested compatibility; detail label-count always 1; `latest_audit` ignores SMS / automation-source Changes; empty `supported_operations` can look ready; named in the recommendation; this pass does not “fix” them)
