# Sprint runbook — end to end, server + admin, local or cloud

October 4, 2026. This is how the whole Sales Outreach Desk sprint runs, from empty branch to the production pilot. Scope and decisions live in [IMPLEMENTATION-PLAN.md](IMPLEMENTATION-PLAN.md). The lane prompts are [SERVER-TEAM.md](workspace/SERVER-TEAM.md) and [ADMIN-TEAM.md](workspace/ADMIN-TEAM.md).

Starting point: both repositories have `feat/outreach-desk` pushed from `main`, and the `main` copy of this packet passes `node docs/sales-outreach-desk/validate.mjs`.

## The shape

| Phase | Who | Runs where | Exit |
| --- | --- | --- | --- |
| P1 Build | 5 lanes in parallel: server S1, S2, S3 and admin A1, A2 | Cloud (recommended) or local | Each lane is merged into `feat/outreach-desk` with green typecheck, lint and tests, plus evidence |
| P2 Integrate | Integrator (one agent) | Wherever both repos are checked out side by side | Admin talks to the real server API on a replica. Contract drift is fixed |
| P3 Verify | VERIFY (one agent, not a lane author) | Same as P2 | END-TO-END-RUN §3–§5 scenarios pass on replica + browser; evidence recorded |
| P4 Release prep | Integrator | Same | PRs `feat/outreach-desk → main` open in both repos; release checklist filled; no deploy |
| P5 Release and pilot | **The user (operator)**, agent assists on request | Production | Deployed dark → indexes → RingCentral proof → policy → pilot shadow → activation → intake |

Agents never cross the P4/P5 line on their own. Every P5 step needs the user's explicit go in that session.

## P1 — Build

### Cloud (recommended for P1)

Open five cloud sessions: three on `jbell-rusty-vantage/vantage-movers-server` and two on `jbell-rusty-vantage/vantage-admin`, all on branch `feat/outreach-desk`. In each, paste the **Session prompt** from the team brief and replace `<LANE>`:

| Session | Repo | `<LANE>` | Brief |
| --- | --- | --- | --- |
| 1 | server | `S1` | [SERVER-TEAM.md](workspace/SERVER-TEAM.md) |
| 2 | server | `S2` | SERVER-TEAM.md |
| 3 | server | `S3` | SERVER-TEAM.md |
| 4 | admin | `A1` | [ADMIN-TEAM.md](workspace/ADMIN-TEAM.md) |
| 5 | admin | `A2` | ADMIN-TEAM.md |

Environment:
- **Server:** `CLOUD_AGENTS.md` sets up the runtime (MongoDB 8 replica set `rs0` on 127.0.0.1:27017, `TEST_MODE=true`, database `testvantagemovers`). Provide only non-production secrets. Tests mock RingCentral, so the session needs no RingCentral or Atlas production credentials.
- **Admin:** `pnpm install` is enough for P1, because A2 builds on mock DTOs. Give it no production `MONGODB_URI`.

Sequencing:
- S1 merges the SRV-3 **models** into `feat/outreach-desk` as early as possible. S3 needs them for SRV-6.
- S2 publishes the engine types early.
- S1 posts the DTO handoff (zod schemas and example payloads) for A2 as soon as SRV-8 compiles.

If you can only run fewer sessions, combine them:
- server S2 then S1 then S3 in one session;
- admin A1 then A2 in one session.

The order matters less than merging often.

### Local alternative for P1 (this Windows machine)

The machine has 15 GB of RAM, and it crashed twice during the slimming sprint when free memory got low. Locally:
- **Run at most 2 lanes at once.**
- Run full test suites with `--test-concurrency=2`.
- Run one heavy command (install, build, full suite) at a time.

Lane checkouts:
- Use separate clones per lane, for example `vantage-main-server-s2` next to the main checkout.
- Or use `git worktree add` with a real `pnpm install` inside the worktree.
- **Never run pnpm inside a worktree whose `node_modules` is a junction to the main checkout.** Before `git worktree remove`, `rmdir` any `node_modules` junction first, or the removal deletes through it.

Replica: the server replica tests use a replica set on `127.0.0.1:27189` (`csi01`), either the Docker container `csi01` or a native `mongod`. Restarting Docker also restarts other containers on this machine, so ask the user first.

Never `taskkill` node.exe broadly; the agents run inside node.

Local lanes use the same prompts. Add this line to each: `Local Windows run: honour the memory/concurrency rules in docs/sales-outreach-desk/SPRINT-RUNBOOK.md (P1 Local).`

A local Claude Code coordinator may run lanes as sub-agents. Use worktree isolation, at most two lanes at once, and merge each lane before starting the next pair. Suggested order: (S2 + A1), then (S1 + A2), then S3.

### P1 exit (per lane)

- `pnpm typecheck`, `pnpm lint` and `pnpm test` pass. The server lane also runs its replica runner; the admin lane runs Playwright for A2.
- `workspace/evidence/<lane>.md` lists the exact commands and results.
- LEDGER is updated.
- The lane is merged into `feat/outreach-desk` without force-pushing.
- The handoff names any DTO, endpoint or infrastructure change.

## P2 — Integrate (one Integrator agent, both repos side by side)

Prefer the local machine for this phase: both repos are already siblings in `C:\Users\Pinda\Proyectos\vantage`. A cloud environment works too if it clones both repos as siblings.

Integrator prompt:

```text
You are the INTEGRATOR for the Sales Outreach Desk. Both repos are checked out as siblings: vantage-main-server and vantage-admin, each on feat/outreach-desk (pull latest).
Read docs/sales-outreach-desk/SPRINT-RUNBOOK.md, IMPLEMENTATION-PLAN.md, CONTRACTS.md, the evidence/ and LEDGER of both repos.
1. Server: start the replica API (CLOUD_AGENTS.md in cloud; locally the scripts/csi07-local.mjs pattern on 127.0.0.1:3107 with the 27189 replica). Build the new indexes with the server's index script against the replica. Install the approved policy with ops/sales-outreach/install-approved-policy.ts against the replica only.
2. Seed a synthetic pilot on the replica: 3 reps (reviewed rep_identity_links, Agents), ~20 Leads covering New Day 1/3/4/6, Quoted with and without a selected date, Unassigned, Priority 3, an unmapped priority, a restricted number, a shared phone, a missing Job Number; a Manager and an Owner admin user, plus one Rep admin user per rep with agent_id. Put the seed in ops/sales-outreach/seed-synthetic-pilot.ts (refuses any non-test database).
3. Admin: point VANTAGE_API_BASE_URL at the replica API with matching VANTAGE_API_SECRET and VANTAGE_ADMIN_PROXY_SIGNING_SECRET; turn off mock mode; run pnpm dev.
4. Walk owner, manager, rep and generic admin through /outreach-desk. Fix contract drift at the source: server DTO is authority; admin zod follows. Any business-rule question goes to the plan/spec, never invented.
5. Merge fixes into feat/outreach-desk in both repos; re-run all suites. Record docs/sales-outreach-desk/workspace/evidence/INTEGRATION.md (commands, results, drift fixed).
Never touch production data, deploy, or push to main.
```

## P3 — Verify (a fresh agent that did not write the lanes)

```text
You are VERIFY for the Sales Outreach Desk. Use the integrated replica setup from evidence/INTEGRATION.md (re-create it if needed).
Execute docs/sales-outreach-desk/END-TO-END-RUN.md §3 (every row), §4 (manual seeding + prospective intake on the replica: report = zero writes, apply, re-apply = zero semantic change, crash/lease/race cases) and §5 (Daily Operations Manager access + live/rebuild parity, Playwright visual comparison of team and my desks at 1186x742 against references/*.webp, keyboard/focus, SSE reconnect, reassignment revocation), plus SPECIFICATION §21 acceptance rows. Use an advancing synthetic clock for multi-day cases; state clearly that this is not production observation.
Also prove: generic admin and foreign rep denied at API, BFF and stream; no retired job stage or model call reachable (SRV-T); RingCentral mocks show provisional -> confirmed call credit, SMS Sent credit, SendingFailed revocation; rate gate light lane admits within budget.
For each failure: file it in LEDGER as blocked with the scenario, owning lane and fix; fix it (or hand back) and re-run. Record docs/sales-outreach-desk/workspace/evidence/VERIFY.md with pass/fail per scenario, screenshots and exact commands. Mark items accepted only with evidence.
```

## P4 — Release prep (Integrator)

- Run `pnpm finish-work --provider <provider>` in the server repo, per its AGENTS.md. Run the equivalent quality pass in admin.
- Open PRs `feat/outreach-desk → main` in both repos. Each PR body includes: the summary, the migrations/indexes list, the new env names (add them to `docs/knowledge/environment.md` first), new crons, the release checklist below, and a rollback note. Rollback: every control is false by default, so reverting the deploy plus flipping `desk_enabled` off is enough; the new collections are additive.
- Do not merge or deploy.

## P5 — Release and pilot (the user runs or explicitly authorizes each step)

| # | Step | Command / where | Check |
| --- | --- | --- | --- |
| 1 | Merge the server PR, then the admin PR | GitHub | CI green |
| 2 | Deploy server, then admin, with all controls false | Vercel (existing workflow) | Desk shows "not available yet"; Numbers and Accounts still work at `/outreach-desk?view=numbers` |
| 3 | Build the new indexes on production | Server index script, named target, report first | Each index present; query plans use them |
| 4 | RingCentral SMS access proof (E01, read-only) | `ops/ringcentral/prove-rep-sms-access.ts` | 200s for every rep mailbox; a rep's app-sent SMS is visible as Outbound/Sent |
| 5 | Create or update the `rep_sms` subscription and add `verificationToken` to `calls` | Subscription ops command (dry run, then apply) | Both subscriptions `Active`; health check green |
| 6 | Install the approved policy (FINAL-01). Set roster, work schedules and goals. Create the Manager users. Review the 15 inert restrictions | Install script, then `/outreach-desk?view=settings` and the Users tab | Configuration revision 1+; no validation blockers |
| 7 | Turn on `rep_sms_capture_enabled`, `goal_metrics_enabled` and `cadence_shadow_enabled` | Settings | Freshness chips healthy; goal counts reconcile against the RingCentral call log for one rep |
| 8 | Enrollment **report** for about 20 Leads across 2–3 reps | Settings → Enrollment (or CLI) | Preview reviewed; zero writes |
| 9 | **Apply** in shadow, then observe one full working date | Same | Projections match expectation; mismatches fixed |
| 10 | Activate the cohort at an 08:00 New York boundary (`cadence_enforcement_enabled`, `desk_enabled`); reps sign in | Settings | One full working date verified (MANUAL-START step 6) |
| 11 | Turn on intake admission; expand existing Leads in reviewed cohorts | Settings | Before cohorts larger than a few hundred, measure oplog/headroom (SPECIFICATION §18.5) |

An agent can prepare any of these steps for the user, as a dry run or as exact commands. It runs one only after the user says go for that specific step.

## Coordination rules (all phases)

- **Shared-file ownership:**
  - Server S1 owns `src/app.ts`, `vercel.json`, the job-stage list and the model registry.
  - Admin A1 owns `server/auth/*`, `next.config.ts` and the nav.
  - Other lanes send a handoff, or put their change in a separate, labelled commit.
- **Packet changes:**
  - The server copy is canonical. After any edit, regenerate `PACKET-MANIFEST.json` and copy the packet to admin, then run `validate.mjs` in both repos.
  - Lanes do not edit the packet except for LEDGER and evidence.
- **When to stop and ask the user:** a business rule that isn't in SPECIFICATION or FINAL-POLICY-REVIEW. A need for production data or credentials. A change to Numbers/Accounts behaviour. Anything in P5.
- **Branch hygiene:** no force-push, reset or clean on shared branches, and no pushes to `main` except through the P4 PRs.
