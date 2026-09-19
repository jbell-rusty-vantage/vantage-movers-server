# Next agent session — one task: merge to main and deploy

This is a single ship task. Do not start CSI-14 dialogs, CSI-09, CSI-15/16, live send, or flag enablement.

Copy the prompt below into the next session. Subagents are allowed. Prefer Cursor Grok 4.6. Cursor quality / `finish-work` may use Grok 4.6, Auto, or Composer 2.5 only — never a GPT model.

> One task: merge `sales-intelligence` into **local `main`**, push **remote `main`**, and deploy the internal Owner dashboard. The Owner authorized this. We own this dashboard; it is internal. Code on `main` with production flags left as they are is enough. Do not enable `NUDGE_ENABLED`, `STT_ENABLED`, `EXTRACTION_ENABLED`, or `BACKFILL_DAYS`. Do not apply `migration:csi:indexes`. Do not start CSI-14 dialogs, CSI-09, or CSI-15.
>
> Inspect remotes and dirty files first. All three remotes must stay `jbell-rusty-vantage`: server `vantage-movers-server`, Admin `vantage-admin`, MCP `vantage-movers-mcp`. Expected HEADs: server `sales-intelligence` `ce1e638871571b0707a90986a5b62b91f682e2d6`; Admin `sales-intelligence` `041081adf0a113cd75a69f40f4a49f6662a3dcfa`; MCP `sales-intelligence` `9a8fd37bf78f8074011fb2d47ff3da3ec400b33d`. Server `origin/main` is `89ac695`; local server `main` is stale at `769a591`. Admin `origin/main` is `2021ae5`. Destination/P2 and the Admin picker are already committed. Commit only new dirty files needed for this merge (for example this NEXT-SESSION refresh). Never force-push `main`. Never skip hooks. Do not write `.env` or paste `ADMIN_SEED_*`.
>
> In each repo: fast-forward or merge `sales-intelligence` into local `main`, then push `origin main`. Do not reset `origin/main` backwards. Admin `vercel.json` has `git.deploymentEnabled: false`, so a main push will not auto-deploy Admin. Deploy Admin, server, and MCP through the existing Vercel projects for those remotes. Do not point CSI-07 preview ports 3107/3108 at Atlas.
>
> Finish with the three `main` SHAs, the three remote compare URLs, and the deployment URLs. Stop there.
