# Contradictions

Standing list. Do not silently merge sources. Not knowledge.

## Open

- Standalone GitHub checkout (`vantage-movers-server`) often has no workspace-root `CONTEXT.md` and no `docs/adr/`. This checkout has `CONTEXT.md` and no `docs/adr/`. Do not invent ADR copies. Use `docs/knowledge/services/` and names already in the module.
- `docs/knowledge/services/call-lead.md` says RingCentral create (`createRingCentralCallLead`) does not emit `lead.call.created` (ingest emits `ringcentral.call_lead.created` / `duplicate_created`). Default-path `ingestRingCentralQualifiedCall` (no `createLead` override) writes via `createRingCentralCallLeadInTransaction` then `finalizeCallLeadCreateAfterCommit`, which **does** emit `lead.call.created`. The public `createRingCentralCallLead` matches the knowledge doc and is only the injectable test adapter. Do not silently merge. See `recommendations/leads-call-lead.md`.
- `duplicateLead.service.ts` JSDoc for `findDuplicateFormLeadMatch` / `isDuplicateFormLead` still says “same source company.” The function requires exact `source_granularity_id` and throws without it; the unit test locks “no company fallback.” Do not silently merge the comment backward. See `recommendations/leads-duplicate-lead.md`.
- `docs/knowledge/services/form-lead.md` says Granot `createLeadFromGranot` “derives `local` only from accepted origin/destination state facts.” The command writes Observation origin/destination states and stamps `local: source.local` (source-policy Move Type). It does not call `leadLocation.service.ts`. Do not silently merge. See `recommendations/leads-lead-location.md`.
