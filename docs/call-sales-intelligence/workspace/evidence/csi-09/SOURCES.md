# CSI-09 sources

- `docs/call-sales-intelligence/06-delivery-plan-and-acceptance.md` — CSI-09: editable accepted defaults, stage health, denied/unknown distinct, no false zeros.
- `docs/call-sales-intelligence/04-server-routes.md` — GET `/coverage`; GET/PATCH `/settings`; CSI-11 capture subset comment.
- `docs/call-sales-intelligence/05-owner-dashboard-ux.md` §1 and §8.
- `docs/call-sales-intelligence/01-specification.md` — accepted defaults, watermark honesty.
- `src/services/salesIntelligence/policy.ts` — `resolvePolicy`, `updateCsiPolicy`, `initializeCsiPolicy`, `csiBootstrapNumbers`.
- `src/routes/sales-intelligence-admin.routes.ts` — GET `/coverage`.
- `src/services/numberActivity/coverage.ts` — `readCaptureCoverage`.
- `vantage-admin/components/sales-intelligence/{workspace.tsx,sales-intelligence-copy.ts}`.
- `vantage-admin/components/sales-intelligence/lib/official-record.ts`.
- `workspace/teams/e-dashboard.md` deliver item 6.
- `workspace/CONTRACTS.md` + `docs/knowledge/services/sales-intelligence-foundation.md`.
- Design export `vantage-sales-intelligence/` — tokens/components only. No integration-stubs, mock client, or demo zeros.
