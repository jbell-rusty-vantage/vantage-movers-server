# Sprint revision — September 19, 2026

Current execution order after CSI-13. This supersedes the original kickoff order and any historical “CSI-18 next” instruction. Product behavior in 01–05/10 remains unchanged. The Owner supplied the existing `vantage-sales-intelligence` design export and wants a locally running dashboard; production API use is an alternative, not a deployment instruction.

## Observed completion and review state

Inspected local evidence and current source on September 19. No remote issue/PR status, deployed revision, or live capability was verified. CSI identifiers are tracked in this workspace ledger.

| Work | Evidence and remaining work |
| --- | --- |
| CSI-13 | Local implementation complete; server HEAD `a9b9bfcb7a70586ae14e974442e63a033abc7fbf`, changes still uncommitted. [Checks](evidence/csi-13/CHECKS.md): checkpoint `1789795679279-a540097e` patch-ready/PASS; record-only summary finding fixed by inspected patch adoption. Subsequent real SDK/local HTTP MCP replica proof 21/21; focused coverage, typecheck and lint passed. Full offline proof recorded 2,430 passed/114 skipped before final refinements. Final source is not identical to the checkpoint snapshot. This is evidence review, not a new full code review or fresh test run. |
| CSI-17 | Implemented locally, MCP HEAD `9a8fd37bf78f8074011fb2d47ff3da3ec400b33d`, clean at inspection. Direct checks and CSI-13 transport proof exist; earlier independent checkpoint failed on snapshot dependency/file reads. Do not relabel it approved. |
| CSI-10 review follow-up | Proposed empty-recording replay repair remains unapplied. Current `repIdentity/worker.ts` still gates discovery on `call.recordings.length`. Review and implement a narrow repair with regression proof; the checkpoint proposal is evidence, not applied source. |
| CSI-14 | Server implementation exists; [independent review](evidence/csi-14/INDEPENDENT-REVIEW.md) has one unresolved P2: editable review-context bodies bypass the contact-purpose restriction. Fix structurally and prove preview/send reject prohibited edits before the provider. UI remains pending. |
| CSI-07/08/09 | Not implemented as feature workflows. Admin is clean on `sales-intelligence`; foundation auth/proxy work is not completion of live updates or panels. |
| CSI-18 | Neither server Owner intervention commands nor their dashboard integration is complete. CSI-13 has reusable preparation/history seams, not delivered Owner controls. |
| CSI-15/16 | Backfill/retention/budget recovery integration and final certification remain. The backend is not ready to be called officially finished or production-certified. |

Older ledger rows preserve their original review scope and historical limitations. This table does not retrospectively approve them. All three Git remotes belong to `jbell-rusty-vantage`; all three observed branches are `sales-intelligence`. Preserve the dirty server checkout.

## Recommended order

Use the local Admin and local API first. This creates a usable integration surface without making deployment a prerequisite for UI work. We control one internal system: no separate frontend product, tenant system, shared component package, or broad release program is needed.

1. **Next session: CSI-07 plus the initial CSI-08 design integration slice.** Deliver Owner live invalidations/BFF and a real Attention → Number/Outreach panel read path using the supplied components/tokens. Inventory the export, reconcile actual DTOs, fix CSI proxy header forwarding, and establish a repeatable isolated local preview. Keep CSI-08 explicitly partial. [Copy-ready instructions](NEXT-SESSION.md).
2. **Finish CSI-08 operational workflows.** Search/pagination, Needs review, attachment resolution, follow-ups/assignment/notes/closure, official-record links and conflicts. Reuse current server commands; do not write frontend policy. Bring Reps and CSI-14 dialogs in using their actual contracts after the P2 repair.
3. **CSI-18 server and UI, tracked separately.** Server work may start after CSI-13 without waiting for all of CSI-08; it consumes CSI-06 commands, CSI-17 captured evidence and CSI-13 application/history. UI work consumes the CSI-08 panels and the delivered intervention endpoints. Full CSI-18 closes only after both, including immediate correction while AI is offline, confirmation without reapplication, original/current reruns and instruction-specific agreement history. A server-only handoff must not close CSI-18.
4. **CSI-09 and CSI-15.** Finish Coverage/settings/Lead entry points and historical backfill, retention, budget recovery. CSI-09 can follow the dashboard foundation independently; CSI-15 is backend-ready by its declared dependencies. No production backfill follows from implementing its UI.
5. **CSI-16 certification and staged rollout.** Resolve the CSI-10/14 findings and remaining review limitations, verify final source and cross-repo contracts, then walk the integrated local product. Build a release manifest of exact revisions and remaining live checks before deployment. UI rendering does not certify provider access or model quality.

These are execution slices under existing issue IDs, not replacement issues. Team D can take the CSI-18 server slice independently when scheduled; the default next Owner agent session is the visible dashboard foundation, not Team D's old combined kickoff.

## Design adoption

Source: `vantage/vantage-sales-intelligence/` (outside the runtime repositories; no `.git` directory at inspection). It is a React/Next component export with a typecheck script, not a separately launched application. Its [integration guide](../../../../vantage-sales-intelligence/INTEGRATION.md) explicitly targets `vantage-admin`. Both manifests use Next 16.3.3 and React 19.2.8; verify individual icon/query APIs against Admin's installed versions.

Copy and adapt selected files into Admin; retain the source export as reference. Do not move/delete it or replace Admin's manifest, lockfile, shell or authentication. Start with scoped `components/sales-intelligence/styles/sales-intelligence.css`, atoms/templates and read components, then containers. Preserve its visual tokens; map to equivalent host variables only where that preserves intended appearance. Prefer real supplied components over recreating them from screenshots. Reuse host primitives where needed for accessibility and shell integration.

Do not ship `integration-stubs`, the mock client, or demo fixtures as live behavior. The export's types/client/hooks and SSE file are adaptation inputs, not frozen runtime contracts. Its validation report records a separate mock preview, not real API validation. Record source path and SHA-256 of copied files in new CSI-07/08 evidence because there is no source Git revision.

Known reconciliation work:

- Admin `app/api/proxy/[...path]/route.ts` currently forwards `Idempotency-Key` only for selected Granot routes. Add scoped CSI forwarding and tests for Owner/auth/current-scope behavior; never forward browser-supplied trusted identity headers.
- Export auth/backend-fetch imports resolve through stand-ins. Use real Admin server authorization and API client; SSE template is not a working BFF.
- Export timeline uses `before`/`kinds`; current server timeline schema accepts `cursor`/`limit`/current scope. Resolve with the canonical contract, not blind parameter forwarding.
- Nudge export still describes `message`/preview assumptions; use CSI-14's [API contract](evidence/csi-14/API-CONTRACT.md) and resolve its P2 before enabling messaging.
- Overview, settings, analysis controls and live endpoints cannot be assumed implemented because the export calls them. Build a route/DTO/action matrix against 04, current schemas and router registrations. Missing behavior belongs to its server issue. Hide or clearly mark unavailable controls; never substitute mock success or zero counts.

## Local topology and later production option

Browser → local `vantage-admin` session/BFF → local `vantage-main-server` → isolated replica-set Mongo. Admin's server-only `VANTAGE_API_BASE_URL` selects the API origin. Preserve signed Owner headers, API secret and Current records wire scope. An isolated test database is selected through server deployment/TEST_MODE configuration; it is not the browser's historical/combined scope. Read each repository's startup instructions and verify ports/database before seeding. No secrets in client variables or evidence.

For deterministic dashboard development, MCP and a paid model are unnecessary: use real API reads/commands over synthetic persisted records and recorded synthetic analysis evidence. When testing the full intelligence loop, start local MCP `/api/intelligence-mcp`; server `SALES_INTELLIGENCE_MCP_ENDPOINT` points there and MCP `SALES_INTELLIGENCE_API_BASE_URL` points back to that same local API. Match scoped keys, run-token secret, database and deployment identity. Do not connect a deployed MCP that routes back to production to a local run. CSI-13's local transport fixture is the starting proof; provider fakes remain fakes.

Enable only required local operational flags; keep external side effects disabled/faked. Document workers/recovery steps needed for Attention projection and clock events; starting HTTP alone does not prove workers run. Browser acceptance must use real local HTTP, not only demo fixtures.

Later, a local dashboard can use the production API by changing its server-side API origin and compatible trusted authentication. That is a valid internal operating mode once the backend release is reviewed/deployed and its scoped MCP routes back to the same production environment. Browser code continues to call its local BFF. Production writes are real even though the dashboard is local.

Do not wait for production deployment to start UI work. Before choosing that later mode: close server review findings, finish the required server portions of 07/09/18/15, align exact server/MCP revisions and environment configuration, verify migrations/indexes, queues/crons, provider grants, private media, pricing/budget limits and rollback. Code deployment with flags off, feature enablement, backfill and live messaging are separate steps. Record missing live evidence explicitly in CSI-16; this revision performs none of them.

## Completion accounting

Record each issue's server implementation, independent review, dashboard integration, synthetic proof and live/deployment proof separately. Full release still requires [ACCEPTANCE](ACCEPTANCE.md). The internal audience simplifies rollout logistics; it does not change Owner precedence, idempotency, budget, auth or truthful coverage rules.
