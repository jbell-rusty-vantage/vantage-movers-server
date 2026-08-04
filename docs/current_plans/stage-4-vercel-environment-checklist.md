# Stage 4 Vercel environment checklist

This is the deployment configuration for Best Relocation ingestion and custom
reporting. Secret values must be generated independently for each environment.
Do not copy production Google OAuth credentials, tokens, Mongo data, or Drive
folders into Preview.

## Main server — Production

### Shared runtime and trusted admin proxy

```dotenv
MONGO_URI=<production Mongo connection string>
VANTAGE_API_SECRET=<random 32+ byte secret; identical in vantage-admin>
VANTAGE_ADMIN_PROXY_SIGNING_SECRET=<random 32+ byte secret; identical in vantage-admin>
VANTAGE_ADMIN_PROXY_SIGNATURE_MAX_AGE_MS=60000
CRON_SECRET=<random 32+ byte secret>
```

Generate each random secret independently, for example with
`openssl rand -base64 48`.

### Best Relocation ingestion and operational workbook denylist

```dotenv
BEST_RELOCATION_SYNC_SHEET_ID=<official leads workbook ID>
BOOKED_DEALS_FORM_RESPONSES_SYNC_SHEET_ID=<official booked-deals workbook ID>
BEST_RELOCATION_INGEST_ENABLED=false

MASTER_LEADS_SHEET_ID=<Master Leads workbook ID>
MASTER_BOOKED_SHEET_ID=<Master Booked workbook ID>
TBM_LEADS_SHEET_ID=<workbook ID, if used>
TBM_PRIME_LEADS_SHEET_ID=<workbook ID, if used>
TOP10_LEADS_SHEET_ID=<workbook ID, if used>
BEST_RELOCATION_LEADS_SHEET_ID=<workbook ID, if used>
GETMOVERS_LEADS_SHEET_ID=<workbook ID, if used>
MAINSITE_LEADS_SHEET_ID=<workbook ID, if used>

GOOGLE_SERVICE_ACCOUNT_JSON_BASE64=<existing Sheet Sync/ingestion service account>
```

Use either `GOOGLE_SERVICE_ACCOUNT_JSON_BASE64` or
`GOOGLE_SERVICE_ACCOUNT_JSON`, never both. Configure every operational
workbook that exists even when the code marks a source workbook optional; the
reporting destination denylist can only reject IDs present in this registry.
Keep ingestion disabled until its adoption and three-day dry-run gates pass.

### Owner OAuth, Picker, and reporting delivery

```dotenv
GOOGLE_OAUTH_CLIENT_ID=<production OAuth web client ID>
GOOGLE_OAUTH_CLIENT_SECRET=<production OAuth client secret>
GOOGLE_OAUTH_TOKEN_ENCRYPTION_KEY=<exactly 32 random bytes, canonical base64>
GOOGLE_OAUTH_OWNER_EMAIL=<dedicated owner Google account email>
GOOGLE_OAUTH_TRUSTED_ADMIN_ORIGIN=https://<admin-production-domain>
GOOGLE_OAUTH_REDIRECT_URI=https://<server-production-domain>/api/v1/admin/google-drive/oauth/callback
GOOGLE_OAUTH_COMPLETION_REDIRECT_URL=https://<admin-production-domain>/reporting/destinations
GOOGLE_DRIVE_EXPORT_FOLDER_ID=<dedicated production export folder ID>
GOOGLE_PICKER_API_KEY=<restricted Google Picker API key>
GOOGLE_PICKER_APP_ID=<Google Cloud project number>

REPORTING_ENABLED_DATASETS=lead_outcome_detail,lead_quality_exceptions,source_performance
REPORTING_CONFIRMATION_SECRET=<independent random 32+ byte secret>
REPORTING_EVIDENCE_SECRET=<different independent random 32+ byte secret>
REPORTING_GOOGLE_DELIVERY_ENABLED=false
```

Generate the encryption key with
`openssl rand -base64 32`. Restrict the Picker key to the Admin Dashboard's
HTTPS origin and the required Google APIs. Register `GOOGLE_OAUTH_REDIRECT_URI`
verbatim in the OAuth client.

The reporting delivery gate is fail-closed. Keep it `false` for dry deployment,
OAuth connection, destination review, and preview verification. Change it to
`true` only for the approved canary/owner rollout. Setting it back to `false`
blocks destination mutations, new runs, and queued worker writes while
preserving reads and allowing queued cancellations to settle.

Do not set `REPORTING_LIVE_TEST_*`,
`REPORTING_PRODUCTION_GOOGLE_OAUTH_*`, `GOOGLE_APPLICATION_CREDENTIALS`, or
`SERVICE_ACCOUNT_LOCAL_FILE*` in the production Vercel project.

## Admin Dashboard — Production

```dotenv
MONGODB_URI=<production admin-auth Mongo connection string>
ADMIN_AUTH_DB_NAME=vantageadmin
ADMIN_ACCESS_TOKEN_SECRET=<random 48+ byte secret>
ADMIN_REFRESH_TOKEN_SECRET=<different random 48+ byte secret>
ADMIN_ACCESS_TOKEN_TTL_SECONDS=900
ADMIN_REFRESH_TOKEN_TTL_DAYS=7

VANTAGE_API_BASE_URL=https://<server-production-domain>
VANTAGE_API_SECRET=<exactly the main-server VANTAGE_API_SECRET>
VANTAGE_ADMIN_PROXY_SIGNING_SECRET=<exactly the main-server signing secret>
NEXT_PUBLIC_APP_NAME=Vantage Admin
```

`ADMIN_SEED_EMAIL`, `ADMIN_SEED_PASSWORD`, and `NEW_SEED_ROLE` are one-time
local seed-script inputs; do not retain them as Vercel runtime variables.
Google OAuth and Picker secrets belong only on the main server. The Admin
Dashboard receives short-lived Picker bootstrap data through its authenticated
server proxy and needs no `NEXT_PUBLIC_GOOGLE_*` variables.

## Preview policy

- Keep `BEST_RELOCATION_INGEST_ENABLED=false` and
  `REPORTING_GOOGLE_DELIVERY_ENABLED=false`.
- Use separate Preview Mongo databases and admin token secrets.
- Use a separate Google OAuth client, owner test account, and disposable Drive
  folder only when Preview must exercise Google integration.
- Point `VANTAGE_API_BASE_URL` to the corresponding server Preview deployment;
  never let an Admin Preview proxy mutations to Production.

The protected `reporting-live-google` GitHub environment is separate from
Vercel. Its `REPORTING_LIVE_TEST_*` secrets are listed in the Stage 4 handoff
and must use an isolated Mongo database, OAuth client, user, and export root.
