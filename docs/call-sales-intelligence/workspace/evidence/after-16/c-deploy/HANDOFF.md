# AFTER-16 C — deploy remaining mains

`git.deploymentEnabled` is false on Admin and server `vercel.json`. Pushing `main` does not deploy. Deploy through Vercel team `vantage-4d3db9ef`:

| App | Vercel project | GitHub repo | Production alias |
| --- | --- | --- | --- |
| API | `vantage-movers-main-server` | `vantage-movers-server` | https://vantage-movers-main-server.vercel.app |
| Admin | `vantage-admin` | `vantage-admin` | https://vantage-admin-rho.vercel.app |
| MCP | `vantage-movers-mcp` | `vantage-movers-mcp` | https://vantage-movers-mcp.vercel.app |

Redeployed 20 Sep 2026 from committed `main` (CLI, because `git.deploymentEnabled` is false):

| App | Git SHA | Deployment | Production alias |
| --- | --- | --- | --- |
| API | `a47030b97d39928907373d385b80fcc271b7b407` | https://vantage-movers-main-server-ovdz9nd0d-vantage-4d3db9ef.vercel.app | https://vantage-movers-main-server.vercel.app |
| Admin | `cd1ba9d832727b815c0f4f20774fcb632ddff9f6` | https://vantage-admin-bm2bm7dh5-vantage-4d3db9ef.vercel.app | https://vantage-admin-rho.vercel.app |
| MCP | `30b86aa08bbbe6bfdfe07a62a81ecf895d3b2b23` | https://vantage-movers-qexijzm4m-vantage-4d3db9ef.vercel.app | https://vantage-movers-mcp.vercel.app |

Flags were not changed in this slice. Indexes were not applied. `BACKFILL_DAYS` was not set. `SALES_INTELLIGENCE_LIVE_SEE` was not written.
