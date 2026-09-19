# CSI-07 / initial CSI-08 intake — September 19, 2026

Observed baseline: server `cc67bdfdc2a5738f8c876af187b0317eb34b1a1d`, Admin `e0c0a77e0577b73c4996d99f4af52d3a8b232b55`, MCP `9a8fd37bf78f8074011fb2d47ff3da3ec400b33d`. All are clean on `sales-intelligence`; all remotes belong to `jbell-rusty-vantage`. Earlier CSI-13 dirty-state evidence is historical; no reset or replacement of that work.

## Authority and mapping

Paths below are relative to `/api/v1/admin/sales-intelligence`. Browser JSON paths prepend `/api/proxy`; live uses `/api/sales-intelligence-live`. Export HTTP types/stubs are not authoritative. Source hashes and destination inventory are in `SOURCES.md`.

| UI / source | Real method/path/query/body | Current response and availability | Gap owner / decision |
| --- | --- | --- | --- |
| Attention / organisms/attention.tsx | GET `/attention?scope=production&band=&needs_review=&state=&agent_id=&cursor=&limit=`; no body | Implemented: `{ok,as_of,coverage,data:{items,snapshot_id,cursor,total_items,reason_counts,status}}`; items `{subject_key,subject,outreach,derived,allowed_actions}` | CSI-08: adapt supplied row to actual DTO; no `q`/`source_label` support, no invented number/Lead chips |
| Number detail | GET `/numbers/:id?scope=production` | Implemented: `{ok,as_of,coverage,data:{id,e164,attachments,outreach_records,restrictions,review_items,running_analysis,...}}` | CSI-08: plural Outreach, nullable analysis; no mock fallback |
| Outreach detail / organisms/followup-card.tsx | GET `/outreach/:id?scope=production` | Implemented: `{ok,as_of,coverage,data:{outreach,owner_instructions,nudges}}` | CSI-07/08: additive number identity in Outreach DTO needed to navigate a Lead subject to Number; preserve all nullable dates and action/overall owners |
| Timeline | GET `/numbers/:id/timeline?scope=production&cursor=&limit=` | Implemented; `before`/`kinds` rejected | Remaining CSI-08; do not send export query names |
| Owner command proof | POST `/outreach/:id/commands?scope=production`; `Idempotency-Key`; strict `{command:"add_note",expected_revision,text}` or `mark_worked` | Implemented behind ENABLED + OUTREACH_ENSURE; actual csiCommandSchema controls body | CSI-07 proxy forwarding; remaining CSI-08 command dialogs |
| Follow-up proof | PATCH `/followups/:id?scope=production`; `Idempotency-Key`; `{command:"patch_followup",expected_revision,changes:{description?,due_at?},reason}` | Existing command response `{ok,data:{response,replayed}}`; actual validator owns allowed changes | CSI-07 real mutation/clock proof only; UI editing remains CSI-08 |
| Live | GET `/live?scope=production`; Last-Event-ID | Missing at intake | CSI-07: durable source invalidations, reconnect resync, clock refetch, cleanup/nonbuffered BFF |
| Overview | GET `/overview` | Not registered | CSI-08 server follow-up; omit request and overview counters. Attention total only when server says ready |
| Auth / proxy | Session → signed trusted Owner headers → existing API guard | CSI server gate implemented; Admin CSI page/API gate absent in current source; JSON parser drops envelope-level as_of/coverage | CSI-07: explicit Owner ACL, preserve CSI read metadata, trusted-header isolation, current-scope checks |
| Messaging | `/nudges/preview`, `/nudges` | Server exists; export `message` contract stale | CSI-14 unresolved P2 + dedicated dialog; disabled, no sends |
| Analysis controls | CSI-18 paths | Not delivered | CSI-18 server Team D may proceed independently; UI waits for server and panels |
| Coverage/settings/backfill | Capture-only `/coverage`; full surface missing | Partial server capability, no settings/overview fiction | CSI-09/15; excluded |

## Local environment plan

Observed loopback replica listener: `127.0.0.1:27189`; verify `csi01` PRIMARY before seeding. Reserve API `127.0.0.1:3107`, Admin `127.0.0.1:3108` (both free at intake). Use isolated `testvantagemovers_csi07preview` and separate `vantage_admin_csi07_preview` auth database on that replica. Scripts must refuse other hosts/database names. Existing production `.env` files must not be read or loaded.

Server: TEST_MODE=true, TEST_MONGO_DATABASE_NAME points to isolated CSI database, MONGO_URI loopback replica, SALES_INTELLIGENCE_ENABLED and OUTREACH_ENSURE only; sheet sync disabled. Provider/media/STT/extraction/nudge/capture flags off. Generate disposable local API/signing/auth credentials without recording values. Admin: MONGODB_URI loopback, ADMIN_AUTH_DB_NAME isolated auth DB, server-only VANTAGE_API_BASE_URL=http://127.0.0.1:3107, matching API/signing credentials. Browser sees only authenticated BFF.

Prepare CSI indexes only in isolated fixture database. Seed synthetic persisted Number Reviews, multiple/undated follow-ups and distinct synthetic Agents. HTTP alone does not publish Attention: local runner invokes existing `runOutreachEnsureOnce` serially on an interval (production minute cron/recovery remains unchanged). Live readers never build snapshots. Clock proof must observe server-derived change plus subsequent snapshot publication. No MCP/paid provider is required. Exact startup commands and observed results follow in HANDOFF/CHECKS after implementation.


