# Ringcentral Auth

- Status: recommended; refreshed 2026-10-29.
- Target: `src/services/ringcentral/auth.ts`
- Domain evidence: `docs/knowledge/services/ringcentral-call-lead-qualification.md`
- Current exported operations/constants: `exchangeJwtForToken`, `refreshAccessToken`, `getValidToken`, `clearRingCentralTokenCache`, `getRingCentralTokenStore`.
- Current exported types: `RingCentralAuthError`.
- Direct import sites found (resolved relative imports): `scripts/dev_ops/ringcentral/ringcentral-reauth-ringsense-check.ts`, `src/services/ringcentral/client.ts`, `src/services/salesIntelligence/nudges/adapters.ts`.
- Related tests: Locate existing callers and targeted tests before changing this module.

## Current operation and naming boundary

`getValidToken` returns a cache entry only when access expiry is more than 120000 ms away. Otherwise it tries a still-valid refresh token; refresh failure logs only status, deletes the cached entry, then performs JWT exchange. Successful exchanges/refreshed tokens are persisted before return. `postTokenRequest` uses Basic client credentials and a form body; non-OK responses throw `RingCentralAuthError` with HTTP status, while missing access token or positive expiry throws a plain Error. Never rename those error shapes or log token/raw response values. This module has no Call Qualification or Lead-creation responsibility. Keep token-store selection behind `createTokenStore`, retain clear/store access exports until tooling moves, and verify cache/refresh/fallback ordering at that interface.

A cleanup preserves public signatures, stored strings, errors, ordering and idempotency. Rename only when the operation becomes clearer; keep current aliases until callers migrate. Do not add effects or change policy. This review inspected code and did not run runtime tests.
