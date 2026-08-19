# Granot lifecycle dry-runs (Units 01–23)

Read-only planner against production `vantagemovers`. It does **not** persist observations, decisions, leads, links, or booking cases.

```bash
pnpm granot:lifecycle:seed-official-sources -- --confirm-production-db=vantagemovers
pnpm granot:lifecycle:dry-run -- --confirm-production-db=vantagemovers
```

Optional: `--per-cohort=6` `--booking-limit=40`

Reports land in gitignored `scripts/output/granot-lifecycle-dry-runs/<timestamp>/`.

The local `.env` is `TEST_MODE=true`. The runner still opens the cluster that way, then pins every lifecycle model on `vantagemovers` via `withRuntimeDomainOverrides({ testMode: false })`.

Three policy modes per receipt:

- `as_configured` — live `granot_crm_sources`
- `hypothetical_observation_only` — in-memory registry from live companies/granularities (the real default)
- `hypothetical_create_if_missing` — same overlay with creation opted in (counterfactual)

Service functions used: `normalizeGranotReceipt`, `resolveSourcePolicy`, `resolveLeadIdentity`, `planLeadDesiredState`, `evaluateEffectGates`, `classifyBookingReconciliation`, `findPreCreationRingCentralConvergenceCandidates`, `classifyRingCentralCallLeadDuplicate`.
