# Automation request, sealed plan and progress

- Status: recommendation refreshed; implementation not performed.
- Reviewed: 2026-10-29 against this checkout.
- Target: `src/models/GranotAutomationRun.ts`
- Knowledge: `docs/knowledge/services/granot-http-collector.md`

## Current storage contract

Runs include estimates_in_process/form_leads/call_leads, preview/apply, locked plans/action receipts and waiting-match progress. Estimates cron deterministic _id relies on built-in identity uniqueness. The run expiry and retention clocks are distinct.

TTL index is on purge_at with expireAfterSeconds=0; expires_at is a separate indexed run expiry clock.

## Remaining naming and organization work

Group request, plan, approval, lease/checkpoint and receipts. Keep current statuses/Estimates kind; no scheduling policy in schema or pending-to-complete conversion.

No schema, collection, index, default, enum or model-registration change is authorized. Public model names already expressing the domain should remain. Preserve importing callers and guarded writes; keep exact aliases if an exported helper changes.

## Current exports

`GRANOT_RUN_STATUSES`; `GranotAutomationRunDocument`; `GranotAutomationRun`

## Parity checks for future implementation

Kinds/statuses; expiry/TTL; lease indexes; approval/hash; waiting/replay; deterministic id; no collect/apply here.

Use schema validation and declared-index assertions for chosen cleanup; isolated test DB only where binding/guarded writes require it. Declared indexes do not prove production installation. Inspect existing tests before relying on them; this documentation refresh executed no runtime/production checks.
