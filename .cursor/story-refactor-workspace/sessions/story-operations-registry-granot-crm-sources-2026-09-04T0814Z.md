# Session story-operations-registry-granot-crm-sources-2026-09-04T0814Z

- Date (UTC): 2026-09-04T08:14Z
- Service / module: `operationsRegistry` / `granotCrmSources.ts`
- Lock: taken
- Branch / PR: `docs/story-refactor` / https://github.com/jbell-rusty-vantage/vantage-movers-server/pull/150

## Stock at start

- Wave: A
- Visited / in-progress / unvisited: 23 / 1 / 14
- Recommendations on disk: 147
- Current service / next module (TRAVERSAL): `operationsRegistry` (in-progress) / `granotCrmSources.ts`

This checkout was already on `docs/story-refactor`. NOW.md held the lock for this session id (this cron turn). Disk had 147 recommendations; last completed session was story-operations-registry-ring-central-validation-2026-09-04T0710Z.

## This pass

- opened new service?: no
- path or skip: recommended `granotCrmSources.ts` → [recommendations/operations-registry-granot-crm-sources.md](../recommendations/operations-registry-granot-crm-sources.md)
- operations named: show the Owner the Granot CRM source cards (list/get; `includeDisabled` does not filter); record or correct a Granot CRM source policy (Owner, reason, semantics in-transaction, unique folded label, write + one `granot_crm_source` Registry Change, caches after commit); turn lifecycle effects on or off (re-asks record-or-correct with a snapshot loaded outside the transaction). This file does not resolve a live observation, send a text, or link an automation source.
- remaining in this service: `crmSourceOutboundSms.ts` (next), `granotCrmSourceProjections.ts`, `granotAutomationSources.ts`, `trustedActor.ts`, `registryAudit.ts`, `runtimeTelemetry.ts`, `queries/overview.ts`, `queries/health.ts`, `queries/changes.ts`

## Stock at end

- Visited / in-progress / unvisited: 23 / 1 / 14
- Current service / next module: `operationsRegistry` (in-progress) / `crmSourceOutboundSms.ts`

## Messages posted

- 2026-09-04T0814Z next-run

## Ideas parked

- none

## Contradictions

- none (`includeDisabled` is a no-op filter; knowledge “disabled” vs code `enabled: true`; knowledge “clients cannot submit create_if_missing” vs Zod + route test accepting it; `/activation` audit action is `update`; named in the recommendation; this pass does not “fix” them)
