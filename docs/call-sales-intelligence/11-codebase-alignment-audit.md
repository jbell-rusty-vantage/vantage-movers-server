# 11 — Codebase alignment audit

September 17, 2026. Read-only server/MCP inspection plus one delegated read-only Admin audit. Changes from this audit are specification/workspace changes only; no runtime feature, provider validation or UI design artifact is claimed complete.

## Verified gaps and prescribed work

| Existing code | Finding and required adaptation | Contract/team |
| --- | --- | --- |
| `src/routes/v1.routes.ts`; `requireVantageAuth` | Internal run token alone cannot pass the API guard. Dedicated scoped static key plus signed run token; reject broad principals internally. Owner router remains after guard. | 04 §6, 10 §9; A/D |
| MCP `app/api/mcp/route.ts`, `lib/request-context.ts`, `vantage-api.ts` | Broad shared-secret tools and apiSecret-only context are insufficient. Dedicated intelligence endpoint, scoped context, bounded server reads/submit. | 10; D |
| `src/models/LeadConversation.ts`; `services/conversations/reads.ts` | Existing nullable Lead reference already supports number-only linkage, but required metadata, account-less recording uniqueness, summary representation and old claim fields need migration/adapters. Preserve existing seed/client compatibility. | 02 §6.1; A/B/D |
| `services/conversations/media.ts` | Existing local-file upload helper is not a remote streaming adapter and permits overwrite. New immutable account/recording/content-digest media keys and content-type checks. | 02/03; B |
| Webhook party normalization; provider Call Log projection | Per-party sequence fences, account-scoped identity aliases and plural recordings prevent lost transfer legs/recordings. Verify account from trusted provider configuration/raw evidence. | 02 §§2–3, 03; A/B |
| `durableWork/leases.ts` | Lease store uses scope, owner and epoch; every worker uses the same durable job claim/fence. Cron cadence alone does not ensure no overlap. | 02/03; A/B/D |
| `src/models/EntityChange.ts` | Source uses applied_at, not updatedAt; closed entity enums cannot accept CSI writes. Separate CSI ledger and audit; indexed source scan plus overlap/dedupe/repair. | 02 §17, 03 §15; A/C |
| `api/queues/granot-lifecycle-consumer.ts`; `vercel.json` | Standalone consumers require bootstrap, actual queue trigger registration and environment isolation; writing a handler file alone does not register it. | 03 §15; A/F |
| Admin `lib/state/database-scope.tsx`; server `adminScope.service.ts`, `src/db.ts` | Browser production/historical/combined differs from TEST_MODE database isolation. CSI current-records only, explicit rejection of unsupported scopes, fixed header and current-record links/search. | 01/04/05; A/E/F |
| Admin `server/auth/authorization.ts`; `app/api/proxy/[...path]/route.ts` | Admin GET default, selective Idempotency-Key forwarding, buffered streaming and transformed errors require explicit CSI adapters. | 04 §8; E |
| Admin `lib/api/conversations.ts`; `components/conversations/conversation-panel.tsx` | Latest-only detail and demo footer cannot represent live/versioned evidence. Run evidence routes, tombstones, signed audio on Play. | 04/05; B/D/E |
| Admin entity-link/related-record-nav/operational-actions helpers | Reuse actual detail and booking/cancellation/attachment workflows with production scope; do not invent navigation params. | 04 §8; E |

Paths without a repository prefix above are relative to vantage-main-server, except rows explicitly labeled Admin or MCP. The dated directory proposal in `backfill_assistance/agent_ring_central_account_connections_possible.md` remains evidence only; it does not authorize reviewed identities or destinations.

## Consistency resolutions

Snooze now preserves contractual due_at while deferring action attention; missed-call episodes do not extend deadlines on repeated misses; expired customer waits cannot re-enter waiting indefinitely. Going cold is 1,440 staffed minutes by default, equivalent to two default 12-hour days. Attachment effects are evaluated for the relevant interaction/time window, not every historical connection. Run completion means publication/effect evaluation finished, with blocked/applied counts separate. Stable Attention pagination uses short-lived materialized snapshots. Server-supplied action availability and explicit Owner contact-type correction close UI contract gaps.

The obsolete Claude brief is archived; current 07 specifies intake of the future artifact. Features remain authoritative in 01–06/10. Historical 08 and archived design evidence are not executable build instructions.

## Delivery evidence required

Team F must collect tests for per-party duplicate/transfer capture, account-scoped recording migration, expired leases, source scan repair, Owner versus Admin versus scoped service auth, two-layer run authentication, BFF idempotency replay/conflict, scope rejection and physical preview isolation, SSE disconnect/replay/gap refetch, versioned evidence/purge, snooze/wait expiry/missed-episode clocks, and production-scoped official navigation. These tests are required implementation work, not tests run during this documentation audit.
