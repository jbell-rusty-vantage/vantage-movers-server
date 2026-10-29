# Require an Authorized Signed Owner for Google Drive

- Target: `src/services/googleDriveOAuth/ownerAuth.ts`
- Evidence: `src/services/googleDriveOAuth/ownerAuth.ts`, `docs/knowledge/services/reporting.md`, `docs/knowledge/environment.md`

Keep requireGoogleDriveOwnerActor and its HTTP middleware as separate seams. Missing auth or scoped_key rejects with GoogleDriveOwnerAccessRequiredError before Registry verification. Secret/user contexts continue through requireRegistryOwnerActor, then actorLabel must satisfy isAuthorizedGoogleDriveOwnerEmail (configured owner or configured additional Owner email). Do not replace this with exact single-email equality or accept Admin role/unsigned headers as Owner.

Middleware calls next on success. Typed Drive Owner error returns canned 403 owner_access_required. Registry errors preserve their own status/body/remediation; other errors use the OAuth sanitizer. It does not attach the actor or create a connection. Callback consent completion is a separate state-and-Google-identity path.

Prove allowed secondary Owner email, unauthorized signed Owner, scoped key with signed headers, missing/invalid Registry signature, and middleware response shapes. Keep Registry authority and config allowlist in their owning modules rather than copying their logic. Preserve aliases if renaming is chosen and use the actual routes/google-drive-oauth.routes.ts import as the concrete caller, not unrelated same-basename auth modules.


## Source-verified implementation constraints (2026-10-29)

The retained brief compared actor.actorLabel to a single config.ownerEmail; current requireGoogleDriveOwnerActor calls isAuthorizedGoogleDriveOwnerEmail and allows additional configured Owner emails.
