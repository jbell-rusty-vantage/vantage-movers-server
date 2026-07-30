# Implementation Unit 6 — Dashboard RingCentral Queue Numbers (D4)

Status: Execution brief derived from the approved Operations Registry plan
Date: 2026-07-29
Repository: `vantage-admin`
Work package: D4

## 1. Purpose and prerequisites

This unit gives the Owner a safe interface for RingCentral inbound number
drafting, account validation, activation/deactivation, immediate reassignment,
dependency inspection, and assignment history.

Required reading:

1. all authority documents in `vantage-main-server/docs/current_plans/`;
2. [Unit 3 server brief](./07-unit-3-server-s6-s7.md);
3. merged S6 handoff and final RingCentral API/error payloads;
4. D0 shell/signing handoff and D2 first-class Source Granularity UI/types;
5. `vantage-admin/NEXTJS_AGENTS.md` and relevant checked-in Next.js 16 docs;
6. dashboard project-organization rules.

Start D4 only after S6 contracts are merged. D4 may be implemented/tested with
mocked validation before M5 production apply, but production exposure must
respect the rollout gates.

## 2. Behavior to communicate accurately

- A route is an inbound phone identity; assignment history maps it to a Source
  Company and first-class call Source Granularity over time.
- A draft starts inactive and unvalidated.
- Validation proves that the number exists and is accessible in the configured
  RingCentral account.
- Recent Call Log/webhook observations are separate evidence and are not
  validation.
- Failed validation leaves the draft editable.
- Activation is impossible until validation is current and valid.
- Phone identity locks after first activation.
- Reassignment is immediate, not scheduled.
- Multiple active numbers may target one call granularity.
- Deactivation/reassignment affects new qualification by call start time and
  does not rewrite prior Call Leads.
- No per-route duration/rule editor is allowed; the global 120-second policy is
  not dashboard configuration.

## 3. Existing files and new ownership

There is no current route-management UI. Useful patterns:

- `components/settings/carrier-manager.tsx` for multi-step form/status behavior;
- `components/data-table/status-badge.tsx`;
- `components/data-table/table-states.tsx`;
- `components/ui/feedback.tsx`;
- `components/observational/observational-event-detail.tsx` for safe provider
  error/request correlation display.

Remove inbound-number editing from:

- `components/settings/source-company-manager.tsx`;
- the old embedded Source Granularity request/type in
  `lib/api/sourceCompanies.ts`.

Likely additions:

```text
lib/api/registryRingCentral.ts
components/operations-registry/ringcentral/
  routes-list.tsx
  route-editor.tsx
  route-detail.tsx
  validation-status.tsx
  assignment-history.tsx
  reassign-dialog.tsx
```

Use project conventions and avoid shallow files that only rename a fetch.
Centralize structured error handling, status derivation, and invalidation.

## 4. API contract

Use the S6 contract through the local signed proxy:

```text
GET   /api/v1/admin/ringcentral/inbound-routes
POST  /api/v1/admin/ringcentral/inbound-routes
PATCH /api/v1/admin/ringcentral/inbound-routes/:id
POST  /api/v1/admin/ringcentral/inbound-routes/:id/validate
POST  /api/v1/admin/ringcentral/inbound-routes/:id/activate
POST  /api/v1/admin/ringcentral/inbound-routes/:id/deactivate
POST  /api/v1/admin/ringcentral/inbound-routes/:id/reassign
GET   /api/v1/admin/ringcentral/inbound-routes/:id/dependencies
```

Preserve stable RingCentral error codes, `issues`, sanitized validation
messages, conflict remediation data, and `request_id`. Do not display/log raw
provider responses.

Add RingCentral query keys below `queryKeys.operationsRegistry`, or a coherent
registry sub-tree, for lists, detail, dependencies, and assignment history.

## 5. List and state model

The list/detail UI must distinguish:

- draft/unvalidated;
- invalid with actionable sanitized message;
- valid/inactive;
- valid/active.

Also show phone lock state, current assignment, display label, validation time,
and recent Call Log/webhook observations where present. Recent evidence must
have separate labels from account validation.

Default list behavior follows registry active-only conventions only if doing so
does not hide necessary drafts. If drafts/inactive routes are operational work
items, expose an explicit status filter with a clear default agreed in the S6
contract rather than guessing.

## 6. Draft, validation, and activation workflow

### Draft

Owner can create an inactive route with normalized phone input, display label,
and a call granularity assignment as supported by S6. Before first activation,
the phone remains editable after failed/unavailable validation.

Do not perform browser-only normalization as authority. Client formatting may
help input, but submit to the server and display its canonical normalized value
and field errors.

### Validation

The Validate action:

- clearly indicates it contacts the configured RingCentral account;
- prevents accidental duplicate submissions;
- renders unavailable versus invalid distinctly;
- displays only sanitized code/message/provider metadata;
- refreshes Registry Health/Changes and route state;
- does not imply recent calls are required.

### Activation

Disable or hide activation when the route is not valid, while still treating
the server as authority against stale clients. On activation conflict, show
which prerequisite changed and a remediation action.

After first activation, render the phone as immutable even when later inactive.
Do not offer an “unlock” or delete action.

## 7. Assignment and lifecycle workflow

Source selectors use active first-class `call` granularities. Do not show form
granularities as valid targets. If a current assignment references a now
inactive value, retain it visibly for historical context and require the
server-approved explicit corrective workflow.

Before deactivation show dependency preview and optional reason. Reassignment
shows current and target company/granularity, explains that it is immediate,
accepts optional reason, and requires confirmation. Never offer a future
effective date.

Assignment history displays inclusive start/exclusive end instants in a
readable consistent timezone and clearly marks the open/current interval.
Multiple route rows may legitimately show the same target granularity.

## 8. Authorization and query invalidation

Owner can mutate. Other approved dashboard roles can read route state,
validation evidence, and assignment history but cannot see enabled mutation
controls. Proxy/server still enforce this.

After each successful mutation invalidate:

- route list/detail/dependencies/history;
- Registry Overview, Health, and Changes;
- Source Company/Granularity detail and dependency queries;
- source facets/filters/catalog data affected by assignments;
- local Admin Audit Log correlation query where applicable.

Validation failure that is successfully persisted is still a state-changing
result and should refresh route, health, changes, and audit queries.

## 9. Acceptance scenarios

Test at minimum:

1. Owner creates an inactive unvalidated draft.
2. Draft phone remains editable after safe invalid/unavailable validation.
3. Unvalidated/invalid route cannot activate.
4. Valid route activates and phone becomes permanently read-only.
5. A valid route with no recent call evidence can activate.
6. Two routes can target the same call granularity.
7. Form granularity cannot be selected/submitted.
8. Reassignment is immediate and new history is displayed.
9. Deactivation preserves prior assignment/Call Lead history.
10. Sanitized provider failure does not crash/white-screen the workspace.
11. Read-only admin can inspect but not mutate.
12. No delete, unlock-phone, future schedule, or route qualification-rule
    control exists.

## 10. Verification and handoff

Run focused API/error/query/state tests, then:

```text
pnpm lint
pnpm typecheck
pnpm test
pnpm build
```

Use mocked S6 validation for automated tests. Do not call live RingCentral or
perform M5 production apply from dashboard implementation.

The D4 handoff must include:

- S6 contract/integration SHA;
- added/modified/retired inbound-number UI files;
- route state and error mappings;
- authorization and invalidation tests;
- all acceptance scenario results;
- lint/typecheck/test/build results;
- screenshots or local smoke-test notes;
- rollout dependency on M5/S7 and rollback point;
- dashboard integration merge SHA.

D4 completion makes the dashboard UI ready; it does not authorize production
RingCentral cutover.
