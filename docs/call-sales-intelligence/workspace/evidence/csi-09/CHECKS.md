# CSI-09 checks

Working directories: `vantage-main-server` and `vantage-admin` on `main`. No `.env` writes, flag enablement, official index migration, live send, commit, or push.

| Exact command | Result |
| --- | --- |
| Server `pnpm exec tsc --noEmit` | exit 0 |
| Server focused eslint on CSI-09 route/coverage/settings files | exit 0 |
| `node --import tsx --test src/services/salesIntelligence/ownerCoverage.test.ts src/services/salesIntelligence/settings.test.ts src/routes/sales-intelligence-admin.routes.test.ts` | **8 pass / 0 fail** |
| `pnpm test:csi:settings:replica` | **4 pass / 0 fail** on disposable `testvantagemovers_csi099162a7428d26`, loopback `csi01:27189`, no `.env`. First persist writes env bootstraps then Owner edit wins; replay of the same Idempotency-Key does not restamp the payload hash. |
| Admin `pnpm exec tsc --noEmit` | exit 0 |
| Admin `node --import tsx --test lib/api/salesIntelligence.test.ts lib/api/salesIntelligenceCopy.test.ts` | **14 pass / 0 fail** |

## Isolated HTTP on 3107

Signed Owner calls against `http://127.0.0.1:3107` using the private csi07-local session (secrets not copied here).

| Request | Result |
| --- | --- |
| `GET /coverage?scope=historical` | **403** `UNSUPPORTED_SCOPE` |
| `GET /coverage?scope=production` | **200**. `known_through` null. Capabilities `unknown`/`unknown`/`unknown` (not zeros). Budget `status: unknown` with null actual/reserved/remaining. Stages keep `oldest_queued_at` null. Mapping: 63 unmapped inbound numbers; directory `stored`. `STT_ENABLED`/`NUDGE_ENABLED` false. Backfill `available: false`. |
| `GET /settings?scope=production` | **200**. No capture `coverage` watermark on this envelope. |
| `PATCH /settings` with extra `flags` | **400** `INVALID_INPUT`. Writer not accepted. |
| `PATCH /settings` `update_settings` with Idempotency-Key | **200**. Persisted. First-action stayed the Owner value **25**. |
| `GET outreach/by-lead/FormLead/<absent>` | **404** |

## Isolated browser on 3108

Owner signed into `http://127.0.0.1:3108` with the disposable csi07-local account (not `ADMIN_SEED_*`). Credentials stayed in OS temp `vantage-csi07-local/session.json`.

- Coverage tab: history completeness unknown; call log / recording / webhook labeled Unknown; budget spend unknown; backfill “not yet available”; accepted NY Mon–Sat 08:00–20:00 defaults; kill switches displayed off and not editable.
- Settings save: first action 30 → 25. After refetch the notice “not stored yet” was gone and the form showed **Revision 2**.
- Form Lead Actions for synthetic CSI08-TAYLOR (`000000000000000000001006`) shows **Open in Sales Intelligence**.
- That official Lead identity opens `/sales-intelligence?view=attention&lead=…&lead_model=FormLead` and resolves the matching Number/Outreach, including **Open official Form Lead**. Phones on that page are synthetic 555-01xx and are not copied here.
- Absent Form Lead id returns HTTP 404; the workspace copy for a missing Outreach is “No Outreach is recorded for this Lead yet.”

Replica `csi01` stayed on `127.0.0.1:27189`. Preview DBs remained `testvantagemovers_csi07preview` and `vantage_admin_csi07_preview`. No Atlas. No `migration:csi:indexes`. Capture/media/STT/extraction/nudge/backfill flags stayed off.
