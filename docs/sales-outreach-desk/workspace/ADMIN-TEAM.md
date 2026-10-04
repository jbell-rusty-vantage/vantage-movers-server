# ADMIN team — cloud session brief (vantage-admin)

Phase P1 of [SPRINT-RUNBOOK.md](../SPRINT-RUNBOOK.md) (local runs: follow its P1 Local rules).

Paste the **Session prompt** into a cloud agent session for the admin repository. One session runs ADM-1 → ADM-8 with sub-agents; or split into two sessions: **A1** (ADM-1, ADM-2, ADM-7: roles, route, shell, BFF) and **A2** (ADM-3, ADM-4, ADM-5, ADM-6, ADM-8: DTOs, desks, settings, visual tests). A2 starts on mock DTOs immediately and does not wait for the server.

Integration branch: `feat/outreach-desk` (from `main`); lane branches `feat/outreach-desk-a1` / `-a2`.

## Session prompt

```text
You are the ADMIN <LANE> lane for the Sales Outreach Desk in vantage-admin (Next.js 16 App Router, React 19, TanStack Query 5, Zod 4, Tailwind v4).

Read first, in order:
1. AGENTS.md (this Next.js has breaking changes: read the relevant guide in node_modules/next/dist/docs/ before writing code), .cursor/rules/project-organization.mdc, CONTEXT.md.
2. docs/sales-outreach-desk/IMPLEMENTATION-PLAN.md (build plan; wins over older packet text about routes, roles and reuse). Decisions IMPL-01..07 in §3 are settled.
3. docs/sales-outreach-desk/OWNER-REQUEST.md and both screenshots in docs/sales-outreach-desk/references/ (close visual fidelity is required: SPECIFICATION §5, V01/V02).
4. docs/sales-outreach-desk/SPECIFICATION.md §§4–7, 16–17 and CONTRACTS.md (DTOs, errors, cursor, live) with IMPLEMENTATION-PLAN §5 amendments.
5. docs/sales-outreach-desk/CODE-MAP.md (admin section) and workspace/ADMIN-TEAM.md.

Setup:
- git fetch; create/checkout feat/outreach-desk from origin/main if missing, then your lane branch.
- pnpm install; run `node docs/sales-outreach-desk/validate.mjs`, pnpm typecheck, pnpm lint, pnpm test for a baseline.
- Claim work packages in docs/sales-outreach-desk/workspace/LEDGER.md.

What to build (IMPLEMENTATION-PLAN §7 ADM-1..8):
- Route /outreach-desk with a "Lead outreach" local shell matching the screenshots: left rail (Team overview, My work, Activity, Settings; Owner also Numbers and Accounts), header with business date and freshness chips (Moving software / RingCentral calls / SMS), soft rounded cards, pale blue background, blue actions, green/amber/red states always paired with text.
- Views: ?view=team (Owner/Manager default), ?view=my (Rep default; Owner/Manager may pass agent=<id>), ?view=activity, ?view=settings, Owner-only ?view=numbers and ?view=accounts (move today's Numbers and RingCentral Accounts components unchanged), selection &lead=<subject_id>.
- Permanent redirects: /sales-intelligence and /sales-intelligence/legacy -> /outreach-desk (keep ?number=<id> as ?view=numbers&number=<id>; view=reps -> view=accounts). Update Rep home, routeGuard, nav (Today section, label "Outreach Desk").
- New `manager` role end to end (roles, Users tab, guard, nav: only /outreach-desk and /daily, signed proxy role). Generic admin gets no desk.
- BFF: exact method+path allowlists for rep and manager on /api/v1/admin/sales-outreach/** (pattern from git 0993e31:server/auth/rep-routes/*), manager on /daily APIs + /api/daily-operations-live, new app/api/outreach-desk-live/route.ts (one EventSource; topics outreach_desk/outreach_goal/outreach_configuration; reconnect = full refetch; 30 s visible-page fallback poll; pause when hidden; refresh at New York midnight).
- lib/api/salesOutreach.ts with Zod DTOs from CONTRACTS (non-strict objects so additive server fields never break reads), lib/query keys, and a mock mode backed by local synthetic fixtures under tests/outreach-desk/fixtures so the UI can be built before the server lands.
- The admin renders server decisions only: never compute cadence, overdue, rank or authorization in the browser. Countdown text may interpolate from the server's as_of.
- All owner-visible strings in components/outreach-desk/outreach-desk-copy.ts. Never print snake_case identifiers. Unknown/pending is shown as such, never as zero.
- Add Playwright (devDependency) with e2e specs that render team and my desks at 1186x742 against the mock API and save screenshots next to the references for comparison; plus keyboard/focus and 403/reassignment cache-clear tests.

Rules: build lanes do not deploy or push to main; the RELEASE agent ships under FAST-TRACK.md (FAST-01). Ship the M1 Call progress pieces first (manager role, /outreach-desk shell, goal cards, Daily call goals table, freshness chips), merge them, then continue to M2. No production data in tests. Keep Numbers/Accounts behaviour unchanged when moving them. Mutations invalidate the right query keys.

Finish: pnpm typecheck, pnpm lint, pnpm test, Playwright run green; screenshots + commands recorded in docs/sales-outreach-desk/workspace/evidence/<lane>.md; update .cursor/rules/project-organization.mdc (Sales Intelligence section -> Outreach Desk) and CONTEXT.md; merge into feat/outreach-desk; LEDGER + handoff listing any DTO assumption the server must confirm.
```

## Notes

- Today a Rep is wrapped in `RepFrame`, which has no nav, and `/sales-intelligence` renders `RepUnavailable`. The new desk replaces both for Reps once the server reports `desk_enabled`. If the capability is false, keep a "not available yet" state.
- `components/ui` is thin, with no dialog, select or tooltip. Reuse the `components/sales-intelligence/{atoms,primitives}` pieces, or add small local primitives inside `components/outreach-desk/`. Do not add a second theme.
- Integration: point `VANTAGE_API_BASE_URL` at the SERVER team's replica API (`scripts/csi07-local.mjs` pattern). Seed users must include one each of `owner`, `manager` and `rep`, and the Rep needs an `agent_id`.
