# Session story-google-drive-oauth-oauth-scopes-2026-08-29T1220Z

- Date (UTC): 2026-08-29T12:20Z
- Service / module: `googleDriveOAuth` / `oauthScopes.ts`
- Lock: taken
- Branch / PR: `docs/story-refactor` / (open after #115 merged)

## Stock at start

- Wave: A
- Visited / in-progress / unvisited: 19 / 1 / 18
- Recommendations on disk: 112
- Current service / next module (TRAVERSAL): `googleDriveOAuth` (in-progress) / `oauthScopes.ts`

## This pass

- opened new service?: no
- path or skip: recommended `oauthScopes.ts` → [recommendations/google-drive-oauth-oauth-scopes.md](../recommendations/google-drive-oauth-oauth-scopes.md)
- operations named: fold the grant Google returned (space-separated string or array; treat userinfo.email URI as email; unique and sort); refuse unless the grant is exactly openid + email + drive.file (exact set, not subset; extra full drive and missing openid both fail); never persist; never invent the company Sheets scope; later oauthSecurity maps the typed error to public 403
- remaining in this service: `oauthSecurity.ts`, `ownerAuth.ts`, `spreadsheet.service.ts`, `picker.service.ts`, `pickerNonceStore.ts`, `pickerSelectionStore.ts`, `driveMetadata.service.ts`, `managedTab.service.ts`

## Stock at end

- Visited / in-progress / unvisited: 19 / 1 / 18
- Current service / next module: `googleDriveOAuth` (in-progress) / `oauthSecurity.ts`

## Messages posted

- 2026-08-29T1220Z next-run

## Ideas parked

- none

## Contradictions

- none
