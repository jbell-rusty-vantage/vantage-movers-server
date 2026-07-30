# Implementation Unit 7 — Dashboard Health, Audit, and Hardening (D5–D6)

Status: Execution brief derived from the approved Operations Registry plan
Date: 2026-07-29
Repository: `vantage-admin`
Work packages: D5, D6

## 1. Purpose and entry gate

This unit completes typed Registry Health and Registry Change history, then
hardens all dashboard registry surfaces for authorization, invalidation,
accessibility, failure states, and cross-repository acceptance.

Required reading:

1. all authority documents in `vantage-main-server/docs/current_plans/`;
2. [Unit 4 server hardening brief](./08-unit-4-server-s8.md);
3. merged S1, S5, S7, and S8 handoffs and final health/change schemas;
4. D0–D4 handoffs and dashboard integration branch;
5. `vantage-admin/NEXTJS_AGENTS.md` and relevant checked-in Next.js 16 docs;
6. dashboard project-organization/testing rules.

D5 can begin against S1 overview/health/change endpoints, but it is not complete
until S5/S7/S8 contribute all findings and remediation targets. D6 begins only
when D0–D5 are integrated so it can verify cross-surface behavior rather than
hardening one branch in isolation.

## 2. Audit layers must remain distinct

The UI must explain and preserve:

- `operations_registry_changes`: main-server authoritative domain mutation
  history, transactionally committed with registry state;
- `AdminAuditLog`: dashboard proxy request-level record.

They correlate through `request_id`; neither replaces the other. Registry
Changes show safe before/after domain snapshots. Admin Audit shows who made the
proxied request and its request outcome.

Routine successful mutations belong in Registry Changes, not Operational
Events. Operational Events represent actionable failures, drift, missing
resolution, cache failure, or migration outcomes.

## 3. D5 — Registry Health UI

### Existing patterns

- `components/observational/observational-dashboard.tsx`
- `components/observational/observational-overview.tsx`
- `components/observational/observational-events-table.tsx`
- `components/observational/entity-link.ts`
- `tests/observational-entity-link.test.ts`
- `components/data-table/table-states.tsx`

Reuse presentation conventions without conflating Registry Health with Workflow
Observational. Registry Health lives inside the Operations Registry workspace
and focuses on registry configuration/resolution integrity.

### Finding presentation

Render typed findings with:

- severity and stable finding type/code;
- concise safe summary and evidence;
- affected entity label/type/ID;
- first/last observed or current state where provided;
- direct entity link;
- explicit remediation action/link;
- read-only versus Owner action state.

Expected classes include source ambiguity, identifier conflicts, CPL coverage,
missing-rate Leads, correction failures, RingCentral validation/assignment
inconsistency, cache staleness/failure, migration outcomes, and compatibility
use.

Do not infer remediation from message text. Use typed server metadata. If a
finding has no safe automated remediation, say what evidence/owner review is
needed rather than offering a generic mutation.

Extend `components/observational/entity-link.ts` only if registry entity types
belong in that shared helper; otherwise create a registry-specific deep-link
module. Add pure tests for company, granularity, CPL period/schedule, correction
job, route, Agent, and Merchant links.

## 4. D5 — Registry Change history

Useful current request-audit implementation:

- `app/(dashboard)/audit-log/page.tsx`
- `lib/api/audit.ts`
- `app/api/audit-log/route.ts`

Add a server-registry changes client/table supporting the approved filters:

- entity type and entity ID;
- action;
- actor;
- date range;
- pagination.

Render sanitized before/after snapshots as a readable diff. Handle additions,
removals, nested fields, redacted values, and large snapshots without freezing
the page. Never attempt to reveal values marked redacted.

When `request_id` exists, link to the local Admin Audit view filtered to that
request. If the current Admin Audit UI/API cannot filter by request ID, add that
capability in a narrow tested change rather than linking to an unfiltered page.

New York business-date rules apply to CPL periods, but registry audit timestamps
are instants. Label/display filters consistently and apply exclusive end-date
query behavior where the server contract expects it.

## 5. D5 authorization and acceptance

Owner and other approved authenticated dashboard roles may read Health and
Changes. Only Owner sees enabled remediation mutations, and every action still
passes through signed proxy/server authorization.

Acceptance:

- every typed server finding renders without a generic fallback being the
  normal path;
- entity/remediation links land on the correct registry context;
- Changes filters/pagination are URL-stable where project conventions require;
- before/after diff is sanitized and usable;
- request correlation opens the matching Admin Audit record;
- read-only users see evidence/history but cannot mutate;
- loading, retry/error, empty, and partial-data states are present.

## 6. D6 — Query invalidation hardening

Review every D0–D5 mutation and centralize a registry invalidation helper or a
small set of entity-specific helpers. Invalidate only after successful mutation
responses, including persisted validation failures where the server changed
route state.

Potential targets:

- `queryKeys.operationsRegistry.*`;
- Agent/Merchant catalog and option queries;
- Source Company/Granularity and dependency queries;
- CPL snapshot/period/correction queries;
- RingCentral route/history queries;
- facets, lists, detail, search, and booking options;
- Analytics filters/performance/cost queries;
- Registry Changes and local Admin Audit queries.

Relevant current patterns:

- `lib/query/keys.ts`
- `lib/query/keys.test.ts`
- `components/settings/catalog-manager.tsx`
- `components/settings/source-company-manager.tsx`

Add tests proving each mutation invalidates the required domains. Do not rely
on page reload as cache coherence.

## 7. D6 — Authorization and failure-state hardening

Build one role/operation matrix covering Owner and each read-only dashboard
role across D0–D5. UI visibility, local proxy authorization, and main-server
authorization must agree. Hidden controls are usability, not security.

Review:

- `components/layout/dashboard-role-context.tsx`
- `components/layout/dashboard-shell.tsx`
- `server/auth/authorization.ts`
- `server/auth/authorization.test.ts`
- `server/auth/trustedProxyHeaders.ts`
- `server/auth/trustedProxyHeaders.test.ts`
- `app/api/proxy/[...path]/route.ts`
- `server/vantage-api/client.test.ts`

Every page, panel, table, dialog, and mutation has intentional:

- initial loading state;
- empty state;
- structured validation/conflict state;
- authorization state;
- retryable transport/server error;
- stale revision/preview recovery where relevant;
- non-retryable immutable/dependency error;
- preserved user input after a recoverable conflict.

Ensure structured server `code`, `issues`, remediation data, and `request_id`
are not lost by generic fetch helpers.

## 8. D6 — Accessibility and UX pass

Verify:

- keyboard navigation and visible focus;
- proper tablist/tab relationships in registry navigation;
- labels/descriptions for all inputs;
- dialog focus trap, initial focus, Escape, and return focus;
- status is not communicated by color alone;
- validation summaries and field-level association;
- accessible loading/progress announcements for validation/correction jobs;
- tables have headers, captions/accessible names, and usable narrow layouts;
- disabled/read-only controls explain why when necessary;
- destructive-looking lifecycle actions require clear confirmation but are
  accurately named deactivate/archive, never delete.

Test representative desktop and narrow viewport layouts. Do not redesign
unrelated dashboard areas.

## 9. D6 — Cross-repository contract checks

Against the integration server, verify:

- canonical signed actor fixture and replay window;
- Owner mutation/read-only role matrix;
- success/error envelopes and every stable registry code;
- HTTP 409 revision and stale-preview remediation payloads;
- New York date round-trip without timezone drift;
- inactive record annotations and dependency payloads;
- RingCentral sanitized validation states;
- Health finding entity/remediation targets;
- Registry Change/request-audit correlation.

Confirm legacy dashboard controls cannot call retired server mutation routes.
Confirm no client module references signing secrets or imports `server/` code.

## 10. Required validation

Run focused tests during D5/D6, then on the dashboard integration branch:

```text
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

Perform safe local browser smoke tests for Owner and read-only roles across all
registry sections. Use mocked RingCentral and non-production/test data. Do not
perform production mutations or provider calls.

The cross-repository gate additionally requires:

```text
# vantage-main-server
pnpm typecheck
pnpm test
```

Record exact SHAs and results; a dashboard-only green build does not satisfy
the initiative gate.

## 11. Unit handoff and completion

Provide separate D5 and D6 handoffs plus a cross-repository acceptance record:

- Health finding/type/link coverage;
- Registry Change filters/diff/correlation behavior;
- role/operation matrix;
- mutation-to-invalidation matrix;
- loading/error/empty/conflict state audit;
- accessibility checks and remaining issues;
- server/dashboard contract fixture results;
- dashboard lint/typecheck/test/build results;
- server typecheck/test results at recorded SHA;
- migration/runbook evidence IDs supplied by S8;
- screenshots or browser smoke notes;
- remaining compatibility UI and removal criteria;
- rollback deployment references;
- both integration branch SHAs;
- confirmation no production mutation/provider call/deployment occurred without
  explicit authorization.

Unit 7 is complete only when D5/D6 and the cross-repository acceptance gate
pass. Completion does not itself authorize merging either integration branch
to `main` or deploying.
