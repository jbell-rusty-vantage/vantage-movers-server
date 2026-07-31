## Operations Registry work-package handoff

- Repository: `vantage-admin`
- Branch: `feature/operations-registry`
- Base SHA: `2bc359e31f94492bce83a01e2e44a26710f6503a` (`main` at branch creation)
- Head SHA: uncommitted working tree; no commit requested
- Work package: Unit 6 — Dashboard D4 (RingCentral Queue Numbers)
- Integration branch expected: `feature/operations-registry`
- Server packages consumed: S6 RingCentral registry API (merged on
  `vantage-main-server` `main`)
- S6 contract / integration SHA: `5a9dc86` (RingCentral operations registry and
  migration); server HEAD observed during implementation:
  `d15da87c73ae674ad72d109edc8b09ccf77d0b7d`

### Delivered

- **D4 — RingCentral inbound route UI**
  - New Operations Registry tab `ringcentral` at
    `/operations-registry?tab=ringcentral`.
  - Owner draft create (inactive/unvalidated), edit phone/label while unlocked,
    validate against configured RingCentral account, activate with active call
    Source Granularity, immediate reassign, deactivate with dependency preview.
  - List default shows **all** routes (`include_inactive=true`) so drafts remain
    operational work items; explicit filter: All | Active | Inactive/drafts.
  - UI states: draft/unvalidated, validation unavailable, invalid, valid/inactive,
    valid/active; phone lock after first activation; observations labeled
    separately from account validation.
  - Call-only granularity selector; form granularities are not offered.
  - Assignment history with inclusive start / exclusive end display
    (`America/New_York` via shared `formatDateTime`), current interval marked.
  - No delete, unlock-phone, future schedule, or per-route qualification-rule
    controls.
  - Admin read-only: inspect list/detail/validation/history; mutation controls
    hidden. Proxy already Owner-gates `/api/v1/admin/ringcentral` mutations.
  - Successful mutations (including persisted validation failures) invalidate
    via `invalidateRegistryQueries` (registry, catalogs, sources, CPL, facets,
    lists, search, analytics, audit).
  - Legacy Settings source-company manager no longer edits/submits
    `inbound_phone_numbers`; types mark the field retired.

### Files

- Added:
  - `lib/api/registryRingCentral.ts` (+ `registryRingCentral.test.ts`)
  - `components/operations-registry/ringcentral/`
    - `routes-list.tsx`
    - `route-detail.tsx`
    - `route-editor.tsx`
    - `validation-status.tsx`
    - `assignment-history.tsx`
    - `reassign-dialog.tsx`
- Modified:
  - `lib/query/keys.ts` (+ tests) — `ringCentralRoutes`,
    `ringCentralRouteDetail`, `ringCentralRouteDependencies`
  - `components/operations-registry/registry-shell.tsx` — RingCentral tab
  - `components/operations-registry/registry-overview.tsx` — metric link
  - `components/settings/settings-tabs.tsx` — registry copy
  - `components/settings/source-company-manager.tsx` — retire inbound editing;
    lint fix (key remount instead of sync effect)
  - `components/settings/catalog-manager.tsx` — lint fix (key remount)
  - `lib/api/sourceCompanies.ts` — inbound numbers retired from submit contract
  - `server/auth/authorization.test.ts` — RingCentral Owner/admin matrix

### Route state and error mappings

| UI state | Derivation |
|----------|------------|
| Draft / unvalidated | `validation_status === unvalidated` (and not unavailable code) |
| Validation unavailable | `validation_code === RINGCENTRAL_VALIDATION_UNAVAILABLE` |
| Invalid | `validation_status === invalid` |
| Valid / inactive | `validation_status === valid` && `!active` |
| Valid / active | `validation_status === valid` && `active` |

- Phone editable only when `!phone_locked && !ever_activated`.
- Activate enabled in UI only when `validation_status === valid && !active`
  (server remains authority for staleness / conflicts).
- Structured errors via `RegistryApiError` / `RegistryApiErrorMessage`
  (`registry_code`, `remediation`, `request_id`, sanitized validation message).
- Raw provider responses are never displayed.

### Authorization

| Role | GET routes/detail/deps | Validate / activate / deactivate / reassign / create / patch |
|------|------------------------|----------------------------------------------------------------|
| owner | yes | yes |
| admin | yes | no (proxy + UI) |

### Acceptance scenarios (automated / UI mapping)

1. Owner creates inactive unvalidated draft — create form → POST inbound-routes.
2. Draft phone editable after invalid/unavailable validation — `isPhoneEditable`.
3. Unvalidated/invalid cannot activate — Activate disabled + server codes.
4. Valid activates → phone locked — activate success copy + `phone_locked`.
5. Valid with no recent observations can activate — ActivatePanel info note.
6. Two routes may share one call granularity — selector does not exclusivity-block.
7. Form granularities not selectable — fetch `channel=call` + selector filter.
8. Reassignment immediate + history refresh — ReassignDialog + detail refetch.
9. Deactivation preserves history — copy + dependency preview; no Call Lead rewrite.
10. Sanitized provider failure does not white-screen — RegistryApiErrorMessage.
11. Read-only admin inspects only — `readOnly` hides mutation controls.
12. No delete / unlock / future schedule / route duration editor — absent from UI.

Unit tests cover state derivation, activation/phone gates, query keys, and
proxy auth matrix for RingCentral paths.

### Verification

- `pnpm lint`: passed
- `pnpm typecheck`: passed
- `pnpm test`: **91** passed, 0 failed
- `pnpm build`: passed; `/operations-registry` present

### Operational notes / rollout

- Dashboard D4 UI is ready; it does **not** authorize production RingCentral
  cutover. Production exposure still depends on M5 apply + S7 runtime gates.
- Local smoke needs matching `VANTAGE_ADMIN_PROXY_SIGNING_SECRET` and a server
  with S6 routes. Automated tests use mocked/state helpers only — no live
  RingCentral calls.
- Rollback: redeploy prior dashboard without the RingCentral tab; route
  collections remain server-side and must not be dropped for UI rollback.

### Risks and known gaps

- Uncommitted branch (continues Unit 5 uncommitted tree); commit when requested.
- End-to-end Owner smoke against a live S6 server not automated here.
- Inactive historical assignment targets show corrective messaging; Owner must
  pick an active call granularity to reassign/activate.
- Health/Changes hardening remains Unit 7 (D5–D6).

### Next step

- Commit `feature/operations-registry` when requested (includes D0–D4).
- Unit 7 — D5–D6 Health/Changes hardening and cross-repo acceptance
  (`11-unit-7-dashboard-d5-d6.md`).
