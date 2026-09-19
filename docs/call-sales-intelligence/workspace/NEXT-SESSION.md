# Next agent session — merge CSI to main and deploy the internal dashboard

Copy the prompt below into the next session. Subagents are allowed. Prefer Cursor Grok 4.6. Cursor quality / `finish-work` may use Grok 4.6, Auto, or Composer 2.5 only — never a GPT model.

> Merge Call & Sales Intelligence into `main` and deploy the internal Owner dashboard. The Owner authorized this session to commit the remaining dirty CSI work, merge into **local `main`**, push **remote `main`**, and deploy. We own this dashboard; it is internal. Resolving production errors, applying additive indexes, running or repairing backfill, and fixing data by hand are acceptable because of how this software is used. CSI-15/16 certification and the full ACCEPTANCE matrix are **not** merge blockers.
>
> Inspect remotes and dirty files first. All three remotes must stay `jbell-rusty-vantage`: server `vantage-movers-server`, Admin `vantage-admin`, MCP `vantage-movers-mcp`. Observed September 19 HEADs: server `sales-intelligence` `bbdfe4c2ea080f4a962d74913baed0846c1ac763` plus uncommitted CSI-10 seed + CSI-14 destination/P2; Admin `sales-intelligence` `905fe8777e5707f20b32b2a76c59a3566dafaf09` plus uncommitted seed UI + Message-rep picker; MCP `sales-intelligence` `9a8fd37bf78f8074011fb2d47ff3da3ec400b33d` clean, one commit ahead of `origin/main`. Server `origin/main` is `89ac695` (14 commits behind `sales-intelligence`). Local server `main` is stale at `769a591`. Admin `origin/main` is `2021ae5` (3 commits behind). Do not switch remotes or GitHub accounts.
>
> Claim exact ledger paths before edits. Do not write `.env`. Do not paste `ADMIN_SEED_*` or any secret. Do not invent Team Messaging person ids. Do not write Rep Identity Links for Josh, Roy, Jason, either Tyler, Russell, QA, or unmatched Users. Never force-push `main`. Never skip hooks. Never `push --force` to `main`/`master`.
>
> ## 1. Land the dirty work, then merge
>
> 1. Re-read remotes, `git status`, and `git log origin/main..HEAD` in all three repos. Preserve unrelated dirty files.
> 2. Commit the remaining CSI work on each `sales-intelligence` branch when the Owner has authorized commit (this session). Keep `.env` out. Server commit includes destination/P2 runtime, CSI-10 seed evidence, and coordination docs. Admin commit includes Message-rep picker and seed UI.
> 3. Fast-forward or merge `sales-intelligence` into **local `main`** in server, Admin, and MCP. Update stale local server `main` from the branch; do not reset `origin/main` backwards.
> 4. Push `origin main` with `-u` only if needed. Return the three compare/commit URLs.
>
> ## 2. Deploy
>
> Admin `vercel.json` has `git.deploymentEnabled: false` — a main push will **not** auto-deploy Admin. Deploy Admin, server, and MCP through the existing Vercel projects / CLI for those `jbell-rusty-vantage` repos. Record deployment URLs. Code on `main` with flags off is a valid first production step.
>
> Do not point CSI-07 preview ports 3107/3108 at Atlas.
>
> ## 3. Production enablement and ops (manual fix is OK)
>
> Treat these as separate switches, in this order, and record what you actually enabled:
>
> 1. **Dashboard reads:** `SALES_INTELLIGENCE_ENABLED` (and Admin `VANTAGE_API_BASE_URL` / signing already used by production Admin).
> 2. **Roster:** `SALES_INTELLIGENCE_DIRECTORY_SYNC` if the production snapshot must refresh.
> 3. **Indexes:** `pnpm migration:csi:indexes -- --report` first. Apply only additive fences this product needs (directory/propose/review/command/nudge_extension_created). Do **not** apply the conversation-account rewrite that drops the legacy `lead_conversations` recording fence unless a reviewed `--account-mappings` file exists. Partial apply is rerunnable. Owner accepts later manual repair.
> 4. **Analysis / history:** `STT_ENABLED`, `EXTRACTION_ENABLED`, `BACKFILL_DAYS`, media, and MCP endpoint only when that environment is wired (scoped MCP, run-token, pricing). Fleet CSI-15 certification is not required before a first backfill; fix gaps by hand.
> 5. **Live Owner Rep Nudge:** `SALES_INTELLIGENCE_NUDGE_ENABLED` is a live RingCentral send. Enable it only as its own step after preview works against production. Destination remains a current directory User. Never the customer. Never automatic.
>
> Walk the internal dashboard after deploy. Hide or tell the truth about unavailable controls. Repair errors in place. Do not invent matcher links to make Message-rep look complete.
>
> Authority: [SPRINT-PLAN](SPRINT-PLAN.md), [destination handoff](evidence/csi-14-destination/HANDOFF.md), [CSI-14 API-CONTRACT](evidence/csi-14/API-CONTRACT.md), [03 flags/jobs](../03-server-pipeline-and-jobs.md), [migration README CSI-01](../../../scripts/migrations/README.md).
>
> Finish with deployed SHAs/URLs, which flags are on, which indexes were applied, remaining manual ops, and the next limitation (usually live send, CSI-09, or conversation-account mappings).
