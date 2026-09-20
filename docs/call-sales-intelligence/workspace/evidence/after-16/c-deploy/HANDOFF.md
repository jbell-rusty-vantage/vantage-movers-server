# AFTER-16 C — deploy remaining mains

`git.deploymentEnabled` is false on Admin and server `vercel.json`. Pushing `main` does not deploy. Deploy through Vercel team `vantage-4d3db9ef`:

| App | Vercel project | GitHub repo | Production alias |
| --- | --- | --- | --- |
| API | `vantage-movers-main-server` | `vantage-movers-server` | https://vantage-movers-main-server.vercel.app |
| Admin | `vantage-admin` | `vantage-admin` | https://vantage-admin-rho.vercel.app |
| MCP | `vantage-movers-mcp` | `vantage-movers-mcp` | https://vantage-movers-mcp.vercel.app |

CLI inspect of the 20 Sep 2026 13:54–13:58 EDT production deployments did not expose a Git SHA. Those deploys were CLI/manual, not Git auto-deploy. After A/B land on `origin/main`, this sitting redeploys from the committed trees so Coverage can name the SHAs.

Flags were not changed in this slice. Indexes were not applied. `BACKFILL_DAYS` was not set.
