# Session opt-g-catalog-2026-08-22T0553Z

- Date (UTC): 2026-08-22T05:53Z
- Phase: optimization
- Unit started / ended: `g-catalog` / `g-catalog`
- Lock: taken
- Branch / PR: `docs/okf-optimization` / https://github.com/jbell-rusty-vantage/vantage-movers-server/pull/6

## Disk at start

- `OPTIMIZATION.md` next unchecked: this Cloud checkout was stale on `cursor/okf-documentation-optimization-b317` / main (`opt-a`); disk on `origin/docs/okf-optimization` had `g-catalog` unchecked
- `.cursor/businesslogic/` exists?: no
- `pnpm okf:query --type Service` count: 40
- `pnpm okf:query --type Service --status deprecated` count: 0

## Units completed

- `g-catalog` → done
  - `catalog.md` → changed
  - `testimonial.md` → changed
  - `granot-http-collector.md` → changed

## Code-truth

- `catalog.md` → facade delegates create/update to Registry `createOrUpdate*`; uniqueness is name **or** alias (`A catalog name or alias already uses this identifier.`); `name_aliases` kept on rename; `resolveAgentByName({ includeInactive })` exists; merchant resolve has no include-inactive; no `/admin/catalog/merchants` alias; activation + dependency preview are separate Owner/read routes; `CATALOGS` map cited by Zod is gone; `CatalogItem` flattens username and drops aliases
- `testimonial.md` → public default `limit` 20 (max 100); admin list/detail/reviewer-names exist (default limit 50, max 250); admin `q` hits reviewer + normalized name; no write routes; fingerprint trims `review_text`; `hasBbbRedaction`; marketing-client `limit`/revalidate not in this checkout
- `granot-http-collector.md` → `source_ids` / run-groups fail closed via `evaluateGranotAutomationCompatibility`; **label-only create skips that resolve** (known gap); preview completes with no receipt; apply needs `GRANOT_AUTOMATION_APPLY_ENABLED` + approvable ids (form `update`, call `syncable`); seal bumps plan to schema v2; wakeup publishes only on Vercel when NODE_ENV is the live deployment value; cron 503 when recoverable and unpublished; worker retries `provider_error`/`invalid_session` while `attempt_count < 3`
- tests read: `catalog.service.test.ts`, `catalogRegistry.test.ts`, `testimonial.service.test.ts`, `testimonial.helpers.test.ts`, `sourceCatalog.test.ts`, `runWorkflow.test.ts`, `lifecycleStatement.test.ts`, `granot-automation.routes.test.ts`
- routes: `v1.routes.ts` catalog + testimonials; `granot-automation.routes.ts`; `granot-automation-cron.routes.ts`; `api/queues/granot-automation-consumer.ts`

## Messages posted

- next-run: start `g-granot`. Update PR #6. Do not removen.
- resolved prior next-run from `opt-g-search-2026-08-22T0451Z`

## Ideas parked

- none

## Contradictions

- `adr-skipped-absent` still open
- `ops-registry-authoritative-plan-absent` still open
- `public-v1-referral-cancel-vs-gated-release` still open (not this cluster)

## Next atomic unit (must match NOW.md)

- `g-granot` — all 14 files under `docs/knowledge/granot-lifecycle/` except `spec-hub.md`
