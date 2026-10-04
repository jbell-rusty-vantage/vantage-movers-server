# Sprint runbook — end to end, server + admin, local or cloud

October 4, 2026. This is how the whole Sales Outreach Desk sprint runs, from empty branch to the production pilot. Scope and decisions live in [IMPLEMENTATION-PLAN.md](IMPLEMENTATION-PLAN.md). The lane prompts are [SERVER-TEAM.md](workspace/SERVER-TEAM.md) and [ADMIN-TEAM.md](workspace/ADMIN-TEAM.md).

Starting point: both repositories have `feat/outreach-desk` pushed from `main`, and the `main` copy of this packet passes `node docs/sales-outreach-desk/validate.mjs`.

## The shape

| Phase | Who | Runs where | Exit |
| --- | --- | --- | --- |
| P1 Build | 5 lanes in parallel: server S1, S2, S3 and admin A1, A2 | Cloud (recommended) or local | Each lane is merged into `feat/outreach-desk` with green typecheck, lint and tests, plus evidence |
| P2 Integrate | Integrator (one agent) | Wherever both repos are checked out side by side | Admin talks to the real server API on a replica. Contract drift is fixed |
| P3 Verify | VERIFY (one agent, not a lane author) | Same as P2 | END-TO-END-RUN §3–§5 scenarios pass on replica + browser; evidence recorded |
| P4 Release | RELEASE agent | Machine with production credentials (local recommended) | Merged to `main` (auto-deploys), indexes built, RingCentral proof, policy installed, controls on |
| P5 Backfill and operate | RELEASE agent | Same | Enrollment backfill applied (90 days + upcoming moves), SMS history, enforcement and intake on, fixes deployed |

**FAST-01 ([FAST-TRACK.md](FAST-TRACK.md)):** agents are authorized to deploy, turn controls on, run the backfill and fix forward. Ship **M1 Call progress** (goal cards + Daily call goals) as the first deploy, as soon as its pieces pass. Do not wait for the cadence engine. Then ship M2 (full desk + backfill). P2/P3 apply to each milestone, sized to what it contains.

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

## P4/P5 — Release, backfill and operate (RELEASE agent, FAST-01)

Run this where production credentials already exist: this machine, which has the Vercel CLI, the server `.env`/ops credentials and the RingCentral JWT. A cloud session can do it instead if those secrets are provided to it. Run it once for **M1**, then again for **M2**.

```text
You are RELEASE for the Sales Outreach Desk. You are authorized by FAST-01 (docs/sales-outreach-desk/FAST-TRACK.md) to merge to main (which auto-deploys through the Vercel Production workflows), build production indexes, run the RingCentral proof, create/update the app-owned rep_sms subscription, install configuration, turn on controls, run the enrollment backfill and fix forward. Read FAST-TRACK.md fully, then IMPLEMENTATION-PLAN.md, RINGCENTRAL-CAPTURE.md and the evidence/LEDGER of both repos.
Milestone: <M1|M2>.
Run the FAST-TRACK "Operating sequence" steps that belong to this milestone:
- M1: steps 1–5.
- M2: steps 1–7, skipping anything already done.
Deploy the server before admin. Wait for each GitHub Actions production run to go green (gh run watch) and smoke-test the existing features before turning anything on.
Never contact customers, never delete or rewrite existing production data, never clear a contact restriction, never print secrets.
If an existing feature breaks, revert the merge commit on main at once, then fix on feat/outreach-desk and redeploy. If only the desk breaks, fix and redeploy (or switch the control off as a quick mute).
Record every command, deploy URL/run id, count, reconciliation and fix in docs/sales-outreach-desk/workspace/evidence/RELEASE.md and commit it on feat/outreach-desk. Finish with: what is live, the counts per enrollment partition, the one-rep reconciliation result, open issues.
```

After each release:
- The Owner reviews the 15 inert restrictions and creates Manager users in Settings and the Users tab.
- Agents keep fixing defects found in use, on `feat/outreach-desk`, then merge and deploy.

## Coordination rules (all phases)

- **Shared-file ownership:**
  - Server S1 owns `src/app.ts`, `vercel.json`, the job-stage list and the model registry.
  - Admin A1 owns `server/auth/*`, `next.config.ts` and the nav.
  - Other lanes send a handoff, or put their change in a separate, labelled commit.
- **Packet changes:**
  - The server copy is canonical. After any edit, regenerate `PACKET-MANIFEST.json` and copy the packet to admin, then run `validate.mjs` in both repos.
  - Lanes do not edit the packet except for LEDGER and evidence.
- **When to stop and ask the user:** a business rule that isn't in SPECIFICATION or FINAL-POLICY-REVIEW. A change to Numbers/Accounts behaviour. Anything FAST-TRACK.md lists as "Still not allowed".
- **Branch hygiene:** no force-push, reset or clean on shared branches, and no pushes to `main` except by the RELEASE agent.
