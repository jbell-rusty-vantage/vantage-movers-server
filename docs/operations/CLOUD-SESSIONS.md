# Run sessions in the cloud (Claude Code on the web)

**Goal (Owner, November 20):** move every session off the Owner's laptop. A cloud session must be able to code, test against a real local replica, read production safely when allowed, and release through GitHub, all without files or scheduled tasks on this machine.

**Status:** the repository side is written and has not yet been exercised in a cloud session. Run the first-session checklist (section 7) before relying on it.

**Source:** Claude Code on the web documentation, read November 20, 2026: [cloud environments](https://code.claude.com/docs/en/cloud-environments.md), [on the web](https://code.claude.com/docs/en/claude-code-on-the-web.md), [scheduled tasks](https://code.claude.com/docs/en/routines.md), [projects](https://code.claude.com/docs/en/claude-projects.md). The product is in preview, so re-check anything marked *untested*.

## 1. What a cloud session is, and what it changes for us

- **The machine.** A fresh Ubuntu 24.04 VM with a clone of **one GitHub repository**, about 4 vCPU, 16 GB RAM and 30 GB disk.
  - Background work is lost when an idle VM is reclaimed.
  - Commands time out after 2 minutes by default and 10 minutes at most. Longer runs go to the background for about 30 more minutes.
- **The workspace root is not a repository.** `C:/Users/Pinda/Proyectos/vantage/` holds `AGENTS.md` (the locked Owner directives), `CONTEXT.md` (the glossary), the specs and `internal/`. None of it is cloned.
  - The server repo now carries snapshots of both: [owner-directives.md](owner-directives.md) and [shared-glossary.md](shared-glossary.md).
  - Refresh a snapshot whenever its workspace file changes. See section 6 for the longer-term option.
- **Local-only assets are not there:** `.env`, `MONGO.env`, `internal/` credentials, `~/.claude` memory, the Owner's global `~/.claude/CLAUDE.md`, user-level quality hooks, local MCP servers and Windows Task Scheduler jobs.
  - Anything a session needs must be in the repo, in the cloud environment, or in a claude.ai connector.
  - The handoff docs ([NEXT-SESSION](NEXT-SESSION.md), the roadmap and the program) replace local memory.
- **Every push to `main` still deploys production** (`vercel-main-server-production.yml`), and cloud sessions push to `claude/`-prefixed branches by default.
  - The release rule does not change: open a PR, get an independent review, then merge with Owner approval just after a top-of-hour slot.
  - **`gh pr …` is blocked** in cloud sessions, because the GitHub proxy rejects GraphQL. Use `gh api` REST instead (section 5).

## 2. Repository pieces (already in this repo)

| File | Role |
| --- | --- |
| `ops/cloud-session/setup.sh` | **Paste into the environment's Setup script field.** Runs as root before Claude starts. Installs Node 24 (latest 24.x, checksum-verified) and pnpm 10.13.1, and pre-pulls `mongo:8.0`. It is cached when it finishes within about 5 minutes, and rebuilt about weekly. |
| `.claude/settings.json` → `ops/cloud-session/session-start.sh` | SessionStart hook. **Runs only when `CLAUDE_CODE_REMOTE=true`**, so local sessions are untouched. It runs `pnpm install --frozen-lockfile` and starts two loopback-only Docker replicas: `csi01` on `127.0.0.1:27189`, used by the replica suites, and `rs0` on `127.0.0.1:27017`, used by `pnpm dev` and `pnpm vantage`. Repo hooks run only in **single-repo** sessions; in a multi-repo project thread, run the script by hand. |
| [owner-directives.md](owner-directives.md) | The locked Owner rules and the reporting directive, for clones without the workspace root. |
| [shared-glossary.md](shared-glossary.md) | The glossary snapshot, already maintained with a provenance checksum. |
| `.cursor/environment.json`, `.cursor/Dockerfile` | The Cursor Cloud equivalent: Node 24, pnpm 10.13.1, MongoDB 8.0 and the isolated API launcher. Unchanged. |

## 3. Environments to create (claude.ai/code → environment settings)

Create **separate environments**, so a coding session can never hold production credentials. Variables in an environment are readable by every command, and so by the model and the transcript. Anyone who uses the environment can read them. **Never put a secret in a shared (organization) environment.** For API keys, prefer **network secrets**: the proxy injects the header, and the key never enters the VM.

### A. `vantage-dev`: the default for all coding and testing

- **Network:** Limited, with "Allow package managers" on, plus `nodejs.org`. GitHub, npm, Docker Hub and `*.googleapis.com` are on the default allowlist.
- **Setup script:** contents of `ops/cloud-session/setup.sh`.
- **Variables (no secrets):**

  | Name | Value | Why |
  | --- | --- | --- |
  | `TEST_MODE` | `true` | Selects the test database and the `TEST_`-prefixed Sheet ids. |
  | `MONGO_URI` | `mongodb://127.0.0.1:27189/?replicaSet=csi01` | The loopback replica. Replica suites assert a loopback target. |
  | `TEST_MONGO_DATABASE_NAME` | `testvantagemovers_cloud` | Default suffixed database. Override it per suite as the runbooks say. |
  | `SHEET_SYNC_MODE` | `disabled` | No Sheet calls from local runs. |
  | `LEAD_MESSAGING_MODE` | `disabled` | No SMS. |
  | `GRANOT_LIFECYCLE_REPLICA_TESTS` | `true` | Opts in the lifecycle replica proofs. |

  Leave every provider credential **unset**: `GOOGLE_*`, `RC_*`, `CRM_*`, `GRANOT_*`, `TWILIO_*`, `SENDGRID_*`, `VANTAGE_API_SECRET`, `CRON_SECRET`.
- **What it can do:** `pnpm typecheck`, `pnpm lint`, `pnpm test`, every replica suite, `pnpm dev` and `pnpm vantage`. Branches, commits and PRs.

### B. `vantage-prod-read`: read-only production investigation

Use it only when a task needs production evidence, such as reconciliations, explains, counts or Sheet placement checks. It carries **only read-only credentials**, so even a mistaken script cannot write.

- **Network:** Limited, plus `nodejs.org` and `*.mongodb.net` (*untested*: Atlas uses TCP 27017 and SRV DNS, so see section 7). Google APIs are on the default list. Add `api.vercel.com` only if deployment reads are needed.
- **Setup script:** the same as A.
- **Variables:**

  | Name | Value | Notes |
  | --- | --- | --- |
  | `TEST_MODE` | `false` | Production database `vantagemovers`. |
  | `MONGO_URI` | Atlas SRV string for a **new read-only database user**, with role `read` on `vantagemovers` only | Create this user in Atlas. Never use `jbell_db_user` or the `MONGO.env` service account here. |
  | `MONGO_DNS_SERVERS` | `8.8.8.8,1.1.1.1` | Only if SRV lookups fail; the app already supports it. |
  | `GOOGLE_SERVICE_ACCOUNT_JSON_BASE64` | base64 of a **new service account's** JSON key, shared as **Viewer** on the Master Leads and Master Booked workbooks | One line, as the code already accepts. A Viewer account cannot write a cell. |
  | `SHEET_SYNC_MODE` | `disabled` | Prevents any inline Sheet delivery from a script. |

- **Vercel (optional):** a read-scoped token as a **network secret** on `api.vercel.com`, header `Authorization: Bearer …`.

### C. Production writes: not a cloud environment by default

Owner-approved production writes include Sheet re-delivery, canonical deletes, index builds and Atlas operator actions. They need writer credentials: the app's Atlas user, the writer Google service account and the `MONGO.env` Atlas admin service account. **Do not keep them in a standing environment.**

When the Owner approves a specific operation, either:
- run it as a **GitHub Actions `workflow_dispatch`** job with repository secrets and a protected environment that requires approval (this is the preferred long-term path, and fits workstream 4), or
- create a short-lived `vantage-prod-operator` environment for that session, then delete it, or rotate the credential, afterwards.

The production app itself keeps all of its variables in Vercel; none of the above changes Vercel.

## 4. One-time Owner setup

1. **GitHub:** connect the **`jbell-rusty-vantage`** account. Either install the Claude GitHub App on the Vantage repos, or run `/web-setup` locally while `gh auth status` shows `jbell-rusty-vantage` active. Commits and PRs carry that identity.
   - The Granot extension repo is under `Overton77` (`vantage-movers-browser-extensions`) and needs that account's access instead.
2. **Atlas:**
   - Create the read-only user for environment B.
   - Decide network access. Anthropic does not publish the cloud egress IPs, so Atlas's IP access list cannot name them. The options, in order of preference:
     1. Run read-only investigations through the **claude.ai MongoDB Atlas connector**. Connectors route through Anthropic and bypass the VM allowlist. Confirm whether the connector's Atlas API key has its own IP access list.
     2. A **self-hosted environment** with a fixed egress IP (Team/Enterprise beta).
     3. Allow `0.0.0.0/0` **only** while the read-only user is the sole credential exposed, with a strong password and rotation. This widens the project-wide access list, so it is the least preferred.

   The November 20 index phase already found the Atlas Admin API blocked from this laptop by the service account's API access list. The same rule will apply to cloud IPs.
3. **Google:** create the Viewer service account, share both workbooks with it as Viewer, and base64 its JSON key for environment B.
4. **Environments:** create A and B as in section 3, and paste `ops/cloud-session/setup.sh` into both.
5. **Plan check:** multi-repo **Projects** are on Pro, Max and Ultra, not yet on Team or Enterprise. Repo hooks, `.mcp.json` and permission rules do not load in project threads. Single-repo sessions on `vantage-movers-server` get the hook and the repo `.mcp.json`.

## 5. Working rules in a cloud session

- **Release commands:** `gh pr` is unavailable (GraphQL is blocked). Use REST:
  - create a PR: `gh api repos/jbell-rusty-vantage/vantage-movers-server/pulls -f title=… -f head=… -f base=main -f body=…`
  - read checks: `gh api repos/{owner}/{repo}/commits/{sha}/check-runs`
  - merge only with approval, pinned to the reviewed SHA: `gh api -X PUT repos/{owner}/{repo}/pulls/{n}/merge -f merge_method=merge -f sha={reviewed_head}`
  - read deploys: `gh api repos/{owner}/{repo}/actions/workflows/vercel-main-server-production.yml/runs`
- **Agents and worktrees:** subagents work as they do locally. Give each agent its own worktree with a real `pnpm install`. The November 20 collision rule still applies.
- **Time:** the VM runs on UTC. Convert to New York with `TZ=America/New_York date`, which works on Linux, unlike Git Bash on Windows. Scheduled-task cron is in UTC.
- **Line endings:** Linux checkouts keep LF. Don't commit files edited on Windows without `git ls-files --eol`.
- **Production reads:** environment B only. Use Mongo `find`/`aggregate`, and Sheets `values.get`/`spreadsheets.get`. Record the time and the counts.

## 6. Off-laptop replacements

| Was on the laptop | Cloud replacement |
| --- | --- |
| Windows Task Scheduler one-off jobs, such as the November 20 index drop | A deterministic script goes in a GitHub Actions `schedule` or `workflow_dispatch` job with repository secrets. A Claude **scheduled task** (UTC cron, at most hourly, starts a full session) is for checks that need judgment, such as the open clocks in NEXT-SESSION. |
| `~/.claude` auto-memory | The handoff docs in this repo (NEXT-SESSION "Start here", roadmap, program). |
| Workspace `AGENTS.md`/`CONTEXT.md` | Snapshots in this repo today. Longer term, a private `vantage-workspace` repo under `jbell-rusty-vantage` holding the root docs (never `internal/`), cloned alongside the server repo in a project. |
| `vantage-atlas` MCP launcher (reads `MONGO.env`) | The claude.ai MongoDB Atlas connector, or environment B's read-only `MONGO_URI`. |
| User-level quality hooks | Workstream 4: git- or CI-triggered checks. Lifecycle hooks are not portable to the cloud. |
| Local Docker replicas (`csi01`, `vantage-local-mongo`) | Started by the SessionStart hook in the VM. |

## 7. First cloud session checklist (*untested items*)

Run these in environment A, then B, and record the results here.

1. `node --version` shows v24, `pnpm --version` shows 10.13.1, and the setup script finished within 5 minutes, so the environment is cached.
2. The hook log shows `csi01 PRIMARY on 127.0.0.1:27189` and `vantage-local-mongo PRIMARY on 127.0.0.1:27017`. If dockerd cannot start in the VM, note it; replica suites then need a different fixture.
3. `pnpm typecheck && pnpm lint && pnpm test` pass.
4. `TEST_MODE=true TEST_MONGO_DATABASE_NAME=testvantagemovers_cloud1 pnpm test:granot-lifecycle:replica` passes.
5. `pnpm vantage -- doctor --json` is healthy.
6. `gh api user` shows `jbell-rusty-vantage`. A test branch push and a REST PR create both work.
7. Environment B only:
   - `mongosh "$MONGO_URI" --eval 'db.runCommand({ping:1})'` connects. This tests TCP 27017 and SRV through the allowlist.
   - A write attempt fails with an authorization error.
   - A Sheets `values.get` on Master Leads works, and a `values.update` is refused.
8. Teleport: `claude --teleport` from the laptop picks the cloud session up, which confirms the handoff path.
