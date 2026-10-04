# Sales Intelligence endpoints with no Admin caller: keep or remove

Lane HARDEN, 2026-10-04. This closes COMPLETENESS.md criterion 1 / open item 1 and INTEGRATION-ADMIN wave-2 issue 5.

The classification comes from the code on branch `slim/server-admin`:

- server `709480d3` + working tree: `src/routes/sales-intelligence-admin.routes.ts` and the services each route calls;
- Admin: `lib/api/salesIntelligence.ts`, `components/sales-intelligence/**`.

No code was deleted in this lane.

All six routes sit on `/api/v1/admin/sales-intelligence`, behind the same guard as the rest of the interim SI. The guard applies, in order:

1. `requireApiSecret`;
2. the CSI boundary router;
3. `CSI_ENABLED`;
4. the signed **Owner** identity (`requireCsiOwner`; a Rep, the Admin role or a scoped key gets 403);
5. `scope=production`.

Commands also need an `Idempotency-Key` and go through the command ledger.

Callers checked:

- **Admin.** It calls `coverage`, `live`, `numbers`, `numbers/:id`, `numbers/:id/timeline`, `numbers/:id/rebuild`, `attachments` (+ `attach`), `GET /reps`, `POST /reps/:id/review` and `POST /nudges` (send, from `message-account-panel.tsx`). Its `server/auth/*.test.ts` files mention `settings`/`nudges`/`reps` only as authorization fixtures.
- **MCP.** `vantage-movers-mcp/src` calls none of the six.
- **Server.** No cron, job or other service calls the six route services (`readCsiSettings`, `commandCsiSettings`, `listNudges`, `previewNudge`, `createRepLink`, `proposeRepLinks`, `readRepLink`) outside the router.

## Decisions

| Endpoint | Service | What it serves | Decision | Reason |
| --- | --- | --- | --- | --- |
| `GET /settings` | `settings.ts` `readCsiSettings` | Reads the active CSI policy (`sales_intelligence_policy_pointers` → `_versions`). After wave 2 the policy holds only the staffed clock (`timezone`, `staffed_hours`), `enabled_capabilities` ∈ {`capture`, `nudges`, `live`} and `retention.audit_days`. It also shows the CSI flags. | **KEEP** (retained Owner/ops API) | Retained code reads this policy through `resolvePolicy`: `ownerCoverage.ts` (staffed clock for capture health), `nudges/eligibility.ts` (the `nudges` capability and the clock) and `retentionPolicy.ts` (Call activity retention, default 730 days). Nothing in it belongs to a retired capability. Retired settings in older stored versions are already hidden (`csiStoredPolicySchema` filters capabilities). |
| `PATCH /settings` | `settings.ts` `commandCsiSettings` → `policy.ts` `updateCsiPolicy` | Writes a new policy version and moves the pointer (ledgered, revision-checked). | **KEEP** (retained Owner/ops API) | It is the only way to change the Call activity retention period, the staffed clock or the nudge capability. The Admin settings form went with the AI settings, so the operator uses the API (`hit-vantage-api`) until the new desk or an Accounts settings panel owns it. |
| `GET /nudges` | `nudges/reads.ts` `listNudges` | Paged history of `owner_rep_nudges`: purpose, channel, status, and delivery outcome including `unknown_delivery`. | **KEEP** (retained Owner/ops API) | It is the only reader of the kept nudge facts (HUMAN-FACTS; SPEC §7.3 "message uncertainty"). It is how an operator sees a `pending`/`unknown_delivery` send and the `nudge_repair` outcome. The retained Accounts `review_context` send (`POST /nudges`) writes those rows. |
| `POST /nudges/preview` | `nudges/commands.ts` `previewNudge` | Read-only dry run of the retained send: validation, `checkNudge` eligibility (policy capability, reviewed identity, channel, destination evidence), template rendering and the hourly rate limit. It returns the rendered body and recipient and never sends (`authorizes_send: false`). | **KEEP** (retained Owner/ops API) | It shares every check with the retained `sendNudge`, has no side effect and no retired dependency. It is the safe way to check a `review_context` message before sending it from an API client. |
| `POST /reps` | `repIdentity/commands.ts` `createRepLink` | Records an Owner-authored *proposed* Rep identity link (Agent ↔ RingCentral User extension), checked against the stored directory and for interval overlap. Only `POST /reps/:id/review` makes it authoritative. | **KEEP** (retained Owner/ops API, Accounts) | Rep identity is a retained authority (SPEC §7.3; `rep_identity_links`, NEVER_DROP). This is the only way to propose a link that the directory proposer cannot (no or ambiguous candidate). The Admin Accounts page can review a proposed link but has no create form, so until it does, the API is the path. |
| `POST /reps/propose` | `repIdentity/commands.ts` `proposeRepLinks` | Walks the stored RingCentral directory snapshot (paged by extension id) and writes deterministic *proposed* links. Prior Owner decisions and retirements are never replaced. | **KEEP** (retained Owner/ops API, Accounts) | No cron or worker calls it. This is how new RingCentral Users get proposed identities that the Accounts page then shows as "Review proposed identity". It has no AI/Outreach dependency. |
| `GET /reps/:id` | `repIdentity/reads.ts` `readRepLink` | One link with capture coverage. | **KEEP** (retained Owner/ops API) | A read-only detail of a retained authority. The Admin reads the list (`GET /reps`), which carries the same DTO, so this route costs nothing and serves API clients. |

**Result: all six are kept.** None is exclusive to a retired capability (AI analysis, media/transcripts, Outreach planner, Attention, Move Assessment or the retired backfill). There is nothing to hand to the integrator for removal. `POST /backfill` was the one route of this group that was exclusive to a retired capability; wave 2 already unregistered it (the router header says so).

## Follow-ups (not removals)

- The Admin has no UI for `/settings`, the nudge history, the nudge preview, rep create or rep propose. The new Sales Outreach Desk (or an Accounts settings panel) should own them. Until then they are operator API calls (`hit-vantage-api`).
- `sales-intelligence-admin.routes.test.ts` and the service tests (`nudges/routes.test.ts`, `repIdentity/routes.test.ts`) keep covering these routes. Keep them when the router is touched.
