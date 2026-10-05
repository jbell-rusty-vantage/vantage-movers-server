/**
 * Local integration: the server app on loopback only, against a local test database on the csi01
 * replica, for the Admin's `next dev` to call. Provider credentials are stripped (see local-target.ts);
 * pass the local secrets the Admin uses (VANTAGE_API_SECRET, VANTAGE_ADMIN_PROXY_SIGNING_SECRET,
 * CRON_SECRET) in the environment. `PORT` defaults to 3107.
 *
 *   node --import tsx ops/local-integration/serve.ts --database=testvantagemovers_sodpilot
 */
import { database } from "./env"; // first: points the process at the local replica before src/ loads
import app from "../../src/app";

const port = Number(process.env.PORT) || 3107;
app.listen(port, "127.0.0.1", () => console.log(`Local integration API on http://127.0.0.1:${port} (database ${database})`));
