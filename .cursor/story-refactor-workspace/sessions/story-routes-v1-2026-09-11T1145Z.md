# Session story-routes-v1-2026-09-11T1145Z

- Date (UTC): 2026-09-11
- Service / module: `routes` / `v1.routes.ts`
- Lock: taken
- Branch / PR: `docs/story-refactor` / https://github.com/jbell-rusty-vantage/vantage-movers-server/pull/206

## Stock at start

- Wave: B (listed Wave A visited)
- Visited / in-progress / unvisited: 42 / 0 / 0 (Wave A). Wave B unopened.
- Recommendations on disk: 311 (through `tariff-resolve-carrier.md`)
- Current service / next module (TRAVERSAL): none (listed Wave A complete) / Wave B `src/routes/` (enumerate first)

## This pass

- opened new service?: yes — enumerated 28 runtime `src/routes/*.ts` files (not tests, no empty barrel). This checkout has no `daily-operations-admin.routes.ts`.
- path or skip: recommended → `recommendations/routes-v1.md`
- operations named: admit the public v1 desk (unguarded extension + Drive, then `/api/v1` secret, then sibling routers); ask a canonical command; ingest a Form Lead over HTTP (not `handleCanonicalCreate`); answer leftover desk reads / leftover Customer `handleCreate`; refuse and classify a failure — never put a data route before the secret, never let catalog list steal Agents browse, never treat leftover `ingestFormLead` as the HTTP path
- remaining in this service: `extension-auth.routes.ts` then the rest of the Wave B routes checklist

## Stock at end

- Visited / in-progress / unvisited: 42 / 1 / 5
- Current service / next module: `routes` (in-progress) / `extension-auth.routes.ts`

## Messages posted

- 2026-09-11T1145Z next

## Ideas parked

- Form Lead HTTP is a second create adapter (logging + test-mode wrap) — extract shared ask, keep the parent deep
- Form Lead PATCH is a second correct adapter (contact log only)
- Customer POST/PATCH/DELETE still leftover `handleCreate` — do not wrap in `runExisting*` this pass
- `buildGranotSyncExpectedFilter` is a leftover extract leak — sibling apply does not import it
- `sendError` copies on tariff / extension-apply are thinner — do not invent a shared adapter this pass
- 5xx classification is path-includes; `/create-form-test` falls through to `http.request.5xx`
- Cancellation delete reads `cascade` then drops it
- ADR-0002 sheet-before-CRM lives on command complete, not this desk
- Project-organization names Daily Operations admin router; this checkout has no such file

## Contradictions

- Leftover `buildGranotSyncExpectedFilter` is tested on this file and unused by the sibling Granot-sync router
- Customer writes are not Domain Commands
- Knowledge / host rule list `POST /call-leads/enrichment/sync` as public v1; the path lives on the sibling router this file mounts
- This checkout has no `docs/adr/` and no `daily-operations-admin.routes.ts`
