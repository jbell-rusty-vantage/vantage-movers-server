# Team handoff

- Team / issue / date: A / CSI-01 preparation slice (envelope validation) / September 17, 2026
- Agent and repo / branch / commit or PR (server and dashboard must use `sales-intelligence`):
  - `vantage-main-server` `sales-intelligence` (created from `main` `769a591`; includes preserved specification updates plus this slice)
  - `vantage-admin` `sales-intelligence` (created from `main` `2021ae5`; no dashboard files changed)
- Concrete behavior delivered:
  - Isolated strict Zod envelope validator for document 10 §3 (`schema_version: "csi-envelope-v1"`).
  - Rejects unknown operational fields (`attention_band`, `outreach_state`, nested database-looking keys) and malformed evidence references.
  - Accepts synthetic fixtures for rep promise vs customer callback request, multiple commitments plus an undated action, voicemail/unknown speaker, contact restriction, and Owner-instruction disagreement.
  - Schema validation is explicitly not runtime evidence authorization and not business-effect validation. Fabricated snapshot/follow-up ids still parse.
  - Infrastructure map of existing validation, test, model, transaction, job, auth, and migration patterns.
  - CSI-01 is **not** complete. G1 contract freeze remains pending.
- Files owned and changed:
  - Added: `src/validation/intelligence/intelligenceEnvelope.validation.ts`
  - Added: `src/validation/intelligence/intelligenceEnvelope.validation.test.ts`
  - Added: `src/validation/intelligence/fixtures.ts`
  - Added: `src/validation/intelligence/index.ts`
  - Added: `docs/call-sales-intelligence/workspace/evidence/csi-01/infrastructure-map.md`
  - Added: `docs/call-sales-intelligence/workspace/evidence/csi-01/HANDOFF.md`
  - Added: `docs/call-sales-intelligence/workspace/evidence/csi-01/fixtures/*.json`
  - Updated: `docs/call-sales-intelligence/workspace/CONTRACTS.md`
  - Updated: `docs/call-sales-intelligence/workspace/LEDGER.md`
  - Updated: `docs/call-sales-intelligence/workspace/evidence/README.md`
  - Pre-existing uncommitted specification files were preserved and not reset.
- Contract/version changes and consumers notified:
  - Envelope contract path recorded as `src/validation/intelligence/intelligenceEnvelope.validation.ts`, version `csi-envelope-v1`.
  - Not wired into `src/validation/v1.validation.ts`, routes, workers, models, MCP, or Admin.
  - G1 remains pending. Teams B–E should treat the schema as reviewable, not frozen.
- Tests/checks actually run, results, and artifact paths:
  - `node --import tsx --import ./scripts/test-setup.ts --test "src/validation/intelligence/**/*.test.ts"` — 10 pass, 0 fail (re-run after type narrowing fix).
  - `pnpm typecheck` — pass (`tsc --noEmit` exit 0) after the same fix.
  - No Mongo, queue, provider, or Admin checks were run. None are in this slice.
- Race/idempotency/failure cases verified:
  - Schema-only: extra fields, malformed evidence, unknown kinds, duplicate finding keys, dangling `finding_keys`, bound overflows.
  - Duplicate delivery, stale evidence, concurrent Owner edits, and submission idempotency are **not** implemented and were not tested.
- Known gaps or capability blockers:
  - Remaining CSI-01 foundation (models, indexes, migrations, durable jobs, settings/budget, command actor policy) is untouched.
  - Validator does not resolve dates, authorize snapshots, or apply effects.
  - Dashboard branch exists with zero CSI runtime work, as required by this slice.
  - No production capability probe was performed. Historical RingCentral notes remain historical.
- Deployment actions performed (normally none): none
- Next dependency and exact entry point for the receiving team:
  - Reviewer / Team A continuation: `src/validation/intelligence/intelligenceEnvelope.validation.ts` and `docs/call-sales-intelligence/workspace/evidence/csi-01/infrastructure-map.md`.
  - After freeze: Team D imports `parseIntelligenceEnvelope` at submission time; Team C later applies effects from findings, not from summary or `next_step_suggestion`.
  - Do not start CSI-02/05/17 as if G1 were frozen.
- Ledger rows updated: CSI-01 → `review`. Complete is reserved for the full foundation.

## Layer distinction

| Layer | This slice |
| --- | --- |
| Schema validation | Implemented |
| Runtime evidence authorization | Not implemented. Valid `snapshot_id` / `target_followup_id` strings are not proof the snapshot or follow-up is in the run manifest. |
| Business-effect validation | Not implemented. A clear `promised_callback` or `contact_restriction` does not create work, pause a channel, or change Outreach. |

## Unresolved questions

1. Should empty `findings`, empty restriction `channels`, or empty `field_paths` stay schema-valid, or become later policy refinements?
2. Document 10 does not bound `confidence`. Any finite number or `null` is accepted.
3. When G1 freezes, should this module be re-exported from `src/validation/v1.validation.ts`, or stay a dedicated intelligence import so Owner API schemas stay separate? Current decision: stay at `src/validation/intelligence/` (reporting precedent). `04` `salesIntelligence.ts` is for later Owner HTTP DTOs, not this envelope.
4. `target_followup_id` is any non-empty string. Confirm whether later evidence auth will require a server-issued id format.
