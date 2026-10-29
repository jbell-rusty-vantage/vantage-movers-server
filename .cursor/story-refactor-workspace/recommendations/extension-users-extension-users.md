# Maintain Extension Logins and Their Agent Links

- Target: `src/services/extensionUsers/extensionUsers.service.ts`
- Evidence: `src/services/extensionUsers/extensionUsers.service.ts`, `docs/knowledge/services/extension-users.md`

Keep list, create, update and hard delete as four public operations over the injectable store; password/email/role normalization stay in auth/extension and Owner authorization stays in extension-users-admin.routes.ts. No login/token mint, Agent creation, deactivate operation or Sheet Sync belongs here. Dashboard roles and Extension roles remain separate.

Create folds email, validates canonical roles, checks duplicate email, optionally validates agent_id, hashes password and writes active=true/token_version=0. List keeps newest-first inactive rows and dual-reads singular Employee as Sales plus Customer Service. DTO includes `agent_id` as string or null alongside id/email/roles/active/created_at/last_login_at, never password/hash. Delete hard-removes and allows email reuse, with missing id 404.

Update must distinguish four change axes: email, password, roles membership and Agent link. A complete no-op returns the current card without writing. Actual credential/roles changes increment token_version; Agent-only link/unlink **writes without incrementing token_version**. Password change alone sets password_changed_at. Every real store update persists canonical roles and unsets legacy singular role, so an Agent-only edit may also persist that conversion without signing out. Roles-set equality ignores order. Omitted agent_id keeps the link, null disconnects, nonempty id connects.

The chosen Agent must exist (any activation state is allowed) and must not belong to another login; allow a login to keep its own Agent. This exclusivity is an application preflight, not a unique agent_id database index or proven concurrent claim fence. Preserve 400 missing-Agent and 409 occupied-Agent preflight errors. Current duplicate-key catch maps any 11000 to the duplicate-email message; do not silently correct race-specific error copy as part of naming. There is no last-Owner delete guard.

Prove operation-level create/link, Agent-only update/unlink with unchanged token_version, credential/roles update with version bump, same-set no-op, missing/occupied Agent, duplicate-email races and delete/email reuse. Check the Mongo adapter actually persists null as `$unset` and password timestamps; an injected memory store alone does not prove those fields. Keep store/hasher/agentExists injection and existing public aliases through caller migration. Private extraction should expose the decision about session invalidation and Agent assignment, not wrap each trivial store call.


## Source-verified implementation constraints (2026-10-29)

The previous brief omitted Agent linkage, its DTO field and no-sign-out exception, and included retired customer/agent browse resources. Current source and Service support agent_id linking/disconnecting.
