**Platform glossary:** [`../../../CONTEXT.md`](../../../CONTEXT.md)
**Primary code:** `src/services/granotHttpCollector/`
**Domain terms used:** Form Lead, Call Lead Enrichment, System of Record, Tracking Reference

# Granot HTTP collector / automation

**Role:** Owner-gated HTTP session collector that plans form/call patches from Granot HTML tables, then optionally applies selected actions. Mongo is the **System of Record**. This path is **not** Granot webhook capture and does **not** write `GranotObservationReceipt`.

**Gap (do not describe as shipped):** final spec §31 / Unit 17 would capture `granot_http_automation` receipts and call `GranotObservationProcessor`. Apply today mutates domain services directly.

## HTTP / queue

| Surface | Path |
|---------|------|
| Admin API | `/api/v1/admin/granot-automation/runs/*`, `.../runs/sources`, `.../run-groups`, `.../runs/worker` |
| Auth | `requireApiSecret` + `requireRegistryOwnerActor` |
| Queue | topic `granot-automation-events` → `api/queues/granot-automation-consumer.ts` → `runGranotWorker()` |
| Cron | `/api/cron/granot-automation-heartbeat` → `recoverGranotRuns()` |

`src/app.ts` mounts the admin router **before** v1. Local/non-Vercel workers may run without a queue publish.

## Workflows

| Workflow | Behavior |
|----------|----------|
| `preview` | Collect + plan. No Mongo lead writes. |
| `apply` | Same plan, then owner approval of selected action ids. Requires `GRANOT_AUTOMATION_APPLY_ENABLED`. |

Operations: `form_leads` or `call_leads`. Form planning never **creates** Form Leads.

## Form plan / apply

`planGranotFormWorkflow()` matches rows (booked + follow-up) via `granotFormLeadMatcher.ts`: exact `ref_no` first, Mongo `_id` compatibility second, scored search fallback. Classifications: `update` / `unchanged` / `conflict` / `no_match` / `invalid`.

Approved form apply → `applyFormAction()` → `updateFormLead()` (quoted, cubic_feet, location, optional `receiver_agent` from Granot CRM username match).

## Call apply

Approved call actions call `syncCallLeadEnrichment()` or `syncBookedCallLeadReconciliation()` — the same services the extension/CSV paths use.

## Run records

`GranotAutomationRun` / `GranotAutomationSource` own plan snapshots, leases, and run-level `{ action_id, outcome }` receipts. Those are **not** lifecycle observation receipts.

Worker claims `applying` runs under a durable lease (`granot:automation:account`). Approved work precedes new planning.

## Related

- [`enrichment.service.md`](enrichment.service.md), [`bookedCallLeadReconciliation.service.md`](bookedCallLeadReconciliation.service.md), [`form-lead.service.md`](form-lead.service.md)
- [`granotLifecycle.capture.md`](granotLifecycle.capture.md) — webhook channel (no mutation)
- [`granot-http-automation.mdc`](../rules/granot-http-automation.mdc)
