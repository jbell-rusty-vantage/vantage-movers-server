# Connect and Use an Authorized Owner Google Account

- Target: `src/services/googleDriveOAuth/googleDriveOAuth.service.ts`
- Evidence: `src/services/googleDriveOAuth/googleDriveOAuth.service.ts`, `docs/knowledge/services/reporting.md`, `docs/knowledge/environment.md`

Keep begin, complete, status, disconnect, live-client and token-health operations explicit. Route authorization and Google verified identity are separate checks. Use the owner-email allowlist in config; an additional authorized Google email is valid, while the stable configured ownerEmail remains the Mongo connection key, OAuth state owner and token-encryption AAD. Optional loginHint is used only when authorized, otherwise default to configured owner; a hint never proves identity.

Begin stores only SHA-256 of fresh 32-byte state with ten-minute expiry and sends offline + consent + exact allowed scopes. Complete atomically consumes unused/unexpired state before token exchange, then compares its owner to configured owner. Failed exchange/identity/scope/offline-token validation consumes the state and requires restart; do not move consumption after exchange or revive used states. Verify id_token audience and email_verified, normalize returned email and check the allowlist, require exact normalized scopes and refresh token, encrypt under configured owner, upsert connection, clear last_used_at and return status.

Status reads stored scopes without decrypting or refreshing. Sanitized status removes owner_email and every token/ciphertext field. Live-client creation requires a stored connection, validates scopes, decrypts refresh token, sets credentials and stamps last_used_at; it does not refresh until the caller uses the client. Health instead returns explicit not_connected/scope_violation/refresh_failed or short-lived access token and expiry, stamping last_used_at on success. Decryption occurs outside its refresh try and may throw; do not make an unqualified never-throws promise. Missing provider expiry defaults to now + one hour.

Disconnect decrypts, attempts remote revoke, deletes local connection even if revoke fails, and reports google_revoked separately. No row returns disconnected=false. Config/decryption failures before revoke do propagate; 'always delete' is limited to revocation failure, not every possible exception. Keep token version/key-length enforcement in tokenEncryption and config, and recursive forbidden-key leak guard independent from encryption.

Prove allowlisted secondary-email connect and hint, unauthorized verified identity, exact scopes, one-time expired/replayed state, missing offline access, sanitized status, client versus health errors, and revoke failure with local deletion. Existing hash/redaction helper tests alone do not establish consent/client/disconnect behavior. Preserve exports/aliases through any caller migration; do not merge company service-account credentials or Picker tickets into this module.


## Source-verified implementation constraints (2026-10-29)

The retained brief enforced one exact Google email and always the configured login hint; source now accepts the authorized-email allowlist and optional authorized loginHint. Connection/AAD identity stays config.ownerEmail.
