# Website preview API

Owner goal (2026-10-30): test website variations against an isolated API and data before choosing a design for production. This is infrastructure for cloud-agent work, not the variation implementation.

## Deployment boundary

- Vercel team: `vantage-4d3db9ef`; separate project `vantage-sites-preview-api` (`prj_A0tA6L0x8InXYiqKYqIXajPfzsYs`).
- Intended stable alias: `https://vantage-sites-preview-api.vercel.app`.
- Mongo: `TEST_MODE=true`, `TEST_MONGO_DATABASE_NAME=testvantagemovers_sitepreview`.
- Owner authorized reuse of the existing script `MONGO_URI` after Atlas organization permissions prevented creating a restricted user. This is application/database-name isolation, not credential-level isolation. Replace with a database-restricted user when an Atlas administrator is available.
- Separate API secret and Vercel automation bypass. Never give cloud agents production credentials.
- `src/sitePreviewApp.ts` refuses incorrect database/side-effect settings on startup and permits only health probes, testimonial/carrier GETs, Form Lead POST, and single Form Lead GET. Normal authentication still applies. Admin, reporting, cron, webhooks and list-all-leads routes are unavailable.
- `CRM_FORM_LEAD_POSTING_ENABLED=false` blocks Granot calls, including when a site requests `post_to_granot=true`. No CRM, RingCentral, Twilio, SendGrid or Sheets credentials belong in this project.

## Environment (Vercel Preview scope on the separate API project)

| Name | Value / handling |
|---|---|
| `MONGO_URI` | Secret; existing script connection by owner instruction; never print |
| `MONGO_DNS_SERVERS` | `1.1.1.1,8.8.8.8` |
| `TEST_MODE` | `true` |
| `TEST_MONGO_DATABASE_NAME` | `testvantagemovers_sitepreview` |
| `VANTAGE_API_SECRET` | Unique preview secret matching both sites' Preview scope |
| `CRM_FORM_LEAD_POSTING_ENABLED` | `false` |
| `SHEET_SYNC_MODE` | `disabled` |
| `WRITE_SOURCE_LEAD_SHEETS` | `false` |
| `LEAD_MESSAGING_MODE` | `disabled` |
| `LEAD_MESSAGING_ALLOW_TEST_MODE`, `GRANOT_LEAD_CREATED_SMS_ENABLED` | `false` |
| `RINGCENTRAL_WEBHOOK_ENABLED`, `RINGCENTRAL_CREATE_CALL_LEADS`, `RINGCENTRAL_CALL_LOG_SYNC_ENABLED` | `false` |
| `SALES_INTELLIGENCE_ENABLED`, `GRANOT_LIFECYCLE_PROCESSING_ENABLED`, `GRANOT_AUTOMATION_APPLY_ENABLED` | `false` |
| `BEST_RELOCATION_INGEST_ENABLED`, `REPORTING_GOOGLE_DELIVERY_ENABLED` | `false` |
| `CRON_SECRET` | Unique random secret; no scheduled jobs are deployed |

## Reproducible deploy

Use the committed preview branch. Run `node ops/site-preview/prepare.mjs` from this repository. It prints a new temporary directory containing only HEAD's tracked files, replaces the entrypoint with the preview app, installs `vercel.preview.json` as `vercel.json`, and excludes queue consumers. It does not copy local secrets or unrelated edits.

From that directory, link explicitly to the preview project/team, then run `vercel deploy --yes --no-wait --target=preview --scope vantage-4d3db9ef`. Always pass the target: Vercel otherwise treats a new project's first deployment as Production. Project framework must be Other (`null`), Node 24, using the existing serverless function routing rather than auto-detected Express framework output. Never `--prod`, never link this artifact to `vantage-movers-main-server`. Wait for Ready, then assign the stable alias with `vercel alias set <deployment-url> vantage-sites-preview-api.vercel.app --scope vantage-4d3db9ef`. There is no automatic deploy from pushing this server branch.

Seed synthetic data with `TEST_MODE=true TEST_MONGO_DATABASE_NAME=testvantagemovers_sitepreview node --env-file=.env ops/site-preview/seed.mjs` (use shell-appropriate environment assignment). The script checks the database name and does not copy production records. Four Source Company/Form granularities and explicitly synthetic testimonial/carrier fixtures support website checks. Synthetic leads remain in this test database; never promote its data to production.

## Required proof

Check `/db` names the isolated database; protected content reads return fixtures; a synthetic Form Lead with `post_to_granot=true` and consent is saved/read back with CRM skipped and messaging disabled; invalid auth fails; forbidden routes return 404. Record deployment URL, server SHA, test lead ID and outcomes. A Ready deployment alone is not integration qualification.

The clients repository owns the cloud-agent handoff at `docs/cloud-site-variations.md` and its release evidence at `docs/site-preview-status.md`.
