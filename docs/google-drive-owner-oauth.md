# Google Drive owner OAuth

Vantage can create owner-requested spreadsheets in the connected owner's
Google Drive. The first connection is interactive; later exports use an
encrypted refresh token and require no Google prompt.

## Google Cloud setup

Use the existing `vantage-sheets` Google Cloud project:

1. Keep the Google Drive API enabled.
2. Configure the OAuth consent screen. While the app is in testing, add
   `jbell@vantagehomemovers.com` as a test user.
3. Create an OAuth client of type **Web application**.
4. Add this production authorized redirect URI exactly:

   `https://vantage-movers-main-server.vercel.app/api/v1/admin/google-drive/oauth/callback`

5. Add a localhost redirect URI only when exercising a local server, for
   example:

   `http://localhost:3000/api/v1/admin/google-drive/oauth/callback`

## Required runtime configuration

```env
GOOGLE_OAUTH_CLIENT_ID=<web application OAuth client ID>
GOOGLE_OAUTH_CLIENT_SECRET=<web application OAuth client secret>
GOOGLE_OAUTH_TOKEN_ENCRYPTION_KEY=<32 random bytes encoded as base64>
GOOGLE_OAUTH_OWNER_EMAIL=jbell@vantagehomemovers.com
GOOGLE_OAUTH_REDIRECT_URI=https://vantage-movers-main-server.vercel.app/api/v1/admin/google-drive/oauth/callback
GOOGLE_DRIVE_EXPORT_FOLDER_ID=1Dyy9PrV-W-JpCwAOp3SPMyOG4CU0GzSg
```

Optional:

```env
GOOGLE_OAUTH_COMPLETION_REDIRECT_URL=https://vantagequotes.com/<owner-settings-route>
```

Generate the encryption key once and store it as a protected Vercel
environment variable:

```powershell
node -e "console.log(require('node:crypto').randomBytes(32).toString('base64'))"
```

Do not rotate that key without first re-encrypting the stored refresh token.
Deleting or losing it requires the owner to reconnect Google Drive.

## API flow

All endpoints except the Google callback require the normal Vantage owner
Bearer token or primary `x-api-secret`.

### Start authorization

`POST /api/v1/admin/google-drive/oauth/authorize`

The response contains `data.authorization_url`. Open that URL in the owner's
browser. Google must authenticate and authorize
`jbell@vantagehomemovers.com`; callbacks for other accounts are rejected.

### Read connection status

`GET /api/v1/admin/google-drive/status`

### Create a proof spreadsheet

`POST /api/v1/admin/google-drive/test-spreadsheet`

```json
{
  "title": "Vantage OAuth Test",
  "folder_id": "1Dyy9PrV-W-JpCwAOp3SPMyOG4CU0GzSg"
}
```

The `folder_id` is optional when `GOOGLE_DRIVE_EXPORT_FOLDER_ID` is set.
The test creates `Summary`, `Customers`, and `Moves` tabs and returns the
spreadsheet URL.

### Disconnect

`DELETE /api/v1/admin/google-drive/connection`

Vantage attempts to revoke the Google refresh token and always deletes its
local encrypted credential.

## Persistence and rollback

- `google_drive_connections` stores one encrypted owner refresh token.
- `google_oauth_states` stores hashed, one-time authorization state with a
  ten-minute TTL.
- No migration is required; Mongoose creates the collections and indexes on
  first use.
- Rollback consists of removing the routes/services and deleting those two
  collections. Removing only the code leaves an inert encrypted credential;
  disconnect first when possible so Google also revokes the grant.
