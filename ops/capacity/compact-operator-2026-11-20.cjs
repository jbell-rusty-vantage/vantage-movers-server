// Temporary Atlas database operator for per-member `compact`, including local.oplog.rs.
//
//   node ops/capacity/compact-operator-2026-11-20.cjs status    # read-only: role, user, cluster state
//   node ops/capacity/compact-operator-2026-11-20.cjs create    # custom role + temporary user (expires in 24 h)
//   node ops/capacity/compact-operator-2026-11-20.cjs failover  # Atlas "Test Failover" (restartPrimaries)
//   node ops/capacity/compact-operator-2026-11-20.cjs delete    # remove the temporary user and role
//
// Uses the project service account in MONGO.env (Project Database Access Admin + Cluster Manager).
// The production application user is never modified. `create` writes the generated credentials to a
// private file outside the repository (argv[3]) and prints neither password nor connection string.
// Requires explicit Owner approval for create/failover/delete.
const fs = require("fs");
const crypto = require("crypto");

const GROUP = "6a0206364e1d94dbdf522948";
const CLUSTER = "vantagecluster";
const ROLE = "vantage_oplog_compact";
const USER = "vantage_compact_operator";
const API = "https://cloud.mongodb.com/api/atlas/v2";
const ACCEPT = "application/vnd.atlas.2024-08-05+json";

const readEnv = file => Object.fromEntries(fs.readFileSync(file, "utf8").split(/\r?\n/)
  .filter(l => /^[A-Z_]+=/.test(l))
  .map(l => [l.slice(0, l.indexOf("=")), l.slice(l.indexOf("=") + 1).trim().replace(/^"|"$/g, "")]));

async function token(env) {
  const r = await fetch("https://cloud.mongodb.com/api/oauth/token", {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded",
      Authorization: "Basic " + Buffer.from(`${env.MONGO_CLIENT_ID}:${env.MONGO_CLIENT_SECRET}`).toString("base64") },
    body: "grant_type=client_credentials",
  });
  if (!r.ok) throw new Error(`token ${r.status}`);
  return (await r.json()).access_token;
}

(async () => {
  const mode = process.argv[2] || "status";
  const env = readEnv("MONGO.env");
  const bearer = await token(env);
  const call = async (method, path, body) => {
    const r = await fetch(API + path, { method, headers: { Authorization: "Bearer " + bearer, Accept: ACCEPT, "Content-Type": ACCEPT }, body: body ? JSON.stringify(body) : undefined });
    const text = await r.text();
    return { status: r.status, body: text ? (() => { try { return JSON.parse(text); } catch { return text.slice(0, 300); } })() : null };
  };

  if (mode === "status") {
    const role = await call("GET", `/groups/${GROUP}/customDBRoles/roles/${ROLE}`);
    const user = await call("GET", `/groups/${GROUP}/databaseUsers/admin/${USER}`);
    const cluster = await call("GET", `/groups/${GROUP}/clusters/${CLUSTER}`);
    console.log(JSON.stringify({ role: role.status, user: user.status, userRoles: user.body?.roles, deleteAfter: user.body?.deleteAfterDate, cluster: cluster.body?.stateName }, null, 2));
  } else if (mode === "create") {
    const out = process.argv[3];
    if (!out) throw new Error("pass a private output path for the generated credentials");
    // Create the credentials file exclusively, owner-only, before any Atlas change. An existing path is
    // refused, because writeFileSync keeps an existing file's (possibly world-readable) permissions.
    let fd;
    try { fd = fs.openSync(out, "wx", 0o600); }
    catch (e) { throw new Error(e.code === "EEXIST" ? "credentials path already exists; pass a new private path" : e.message); }
    let written = false;
    try {
    const role = await call("POST", `/groups/${GROUP}/customDBRoles/roles`, {
      roleName: ROLE, actions: [], inheritedRoles: [{ db: "local", role: "dbAdmin" }],
    });
    if (!(role.status >= 200 && role.status < 300) && role.status !== 409) throw new Error(`role ${role.status} ${JSON.stringify(role.body)}`);
    const password = crypto.randomBytes(24).toString("base64url");
    const user = await call("POST", `/groups/${GROUP}/databaseUsers`, {
      databaseName: "admin", username: USER, password,
      deleteAfterDate: new Date(Date.now() + 24 * 3600 * 1000).toISOString(),
      roles: [
        { databaseName: "admin", roleName: ROLE },
        { databaseName: "admin", roleName: "dbAdminAnyDatabase" },
        { databaseName: "admin", roleName: "clusterMonitor" },
      ],
      scopes: [{ name: CLUSTER, type: "CLUSTER" }],
    });
    if (!(user.status >= 200 && user.status < 300)) throw new Error(`user ${user.status} ${JSON.stringify(user.body)}`);
    fs.writeSync(fd, JSON.stringify({ username: USER, password }));
    written = true;
    console.log(JSON.stringify({ role: role.status, user: user.status, deleteAfter: user.body?.deleteAfterDate, credentials: "written to the private path" }));
    } finally {
      fs.closeSync(fd);
      if (!written) fs.rmSync(out, { force: true });
    }
  } else if (mode === "failover") {
    const r = await call("POST", `/groups/${GROUP}/clusters/${CLUSTER}/restartPrimaries`);
    console.log(JSON.stringify({ failover: r.status, body: r.status >= 300 ? r.body : "accepted" }));
  } else if (mode === "delete") {
    const user = await call("DELETE", `/groups/${GROUP}/databaseUsers/admin/${USER}`);
    const role = await call("DELETE", `/groups/${GROUP}/customDBRoles/roles/${ROLE}`);
    console.log(JSON.stringify({ user: user.status, role: role.status }));
  } else throw new Error(`unknown mode ${mode}`);
})().catch(e => { console.error("error", e.message); process.exitCode = 1; });
