# Let the dashboard Owner manage extension logins

- Status: recommended; source-verified 2026-10-29.
- Target: `src/routes/extension-users-admin.routes.ts`
- Domain: `docs/knowledge/services/extension-users.md`.
- Evidence: `src/routes/v1.routes.ts`, `src/services/extensionUsers/extensionUsers.service.ts`, `src/validation/v1/extensionUsers.validation.ts`.

## Current operation and seams

The parent v1 guard admits credentials before this router. Each of list/create/update/delete then connects Mongo and requires a Registry Owner actor. Dashboard Admin is forbidden even on list; this is separate from unguarded extension login and from Agent catalog writes. The extension Owner Bearer catalog exception does not authorize these writes.

Create parses email/password/roles plus optional agent_id and returns 201. PATCH parses id/body and returns 200; DELETE returns 200 with `{ id }`, not 204. List returns 200. Zod owns nonempty current roles arrays, retired Employee rejection, empty-password omission and the requirement that at least email/password/roles/agent_id remains on PATCH. Agent association or null disassociation is valid bookkeeping; it neither creates an Agent nor invalidates a login session by itself. Credential/roles token-version effects and hard delete remain service-owned.

Registry errors retain status/code/request_id; Zod is 400 “Invalid request payload” with issues. AppError retains its status/message (including conflict/not-found). Unexpected errors currently echo message at 500. Preserve these exact envelopes; do not import another router's serializer during a naming pass. Request id prefers x-vantage-admin-request-id, then x-request-id.

Keep injected list/create/update/delete/connect dependencies as the HTTP test seam. Useful names are showLogins/issueLogin/correctLogin/revokeLogin; keep existing aliases while callers move. Do not merge authentication, password hashing, session validation, role-set comparison or Agent creation into this router. Inspect `extension-users-admin.routes.test.ts`; parity should distinguish 400 malformed id, 404 unknown id, duplicate email/Agent 409, Admin 403 and success status/body. This review inspected source and ran no runtime tests.
