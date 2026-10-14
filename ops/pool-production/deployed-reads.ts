/** GET-only deployed acceptance. Existing users only; evidence never contains operational identities or customers. */
import { createHash, createHmac, randomUUID } from "node:crypto";
import { execFileSync } from "node:child_process";
import { mkdir, writeFile } from "node:fs/promises";
import { dirname, isAbsolute, relative, resolve, sep } from "node:path";
import dns from "node:dns";
import mongoose from "mongoose";
import { z } from "zod";
import { salesOutreachCapabilitiesSchema, salesOutreachQueueSchema, salesOutreachDetailSchema, salesOutreachLiveFrameSchema } from "../../src/validation/v1/salesOutreachReads";
import { ADMIN_PROXY_AGENT_HEADER, ADMIN_PROXY_HEADER_NAMES as H, buildCanonicalAdminActorPayload, buildCanonicalRepActorPayload } from "../../src/services/operationsRegistry/trustedActorCanonical";

const HOST = "https://vantage-movers-main-server.vercel.app";
const DESK = "/api/v1/admin/sales-outreach";
const FRESHNESS = "/api/v1/admin/granot-automation/runs/freshness";
const ID = /^[a-f\d]{24}$/;
type Identity = { id: string; email: string; role: "owner" | "manager" | "admin" | "rep"; agentId?: string };
type Check = { name: string; passed: boolean; status?: number; reason?: string };
const checks: Check[] = [];
let adminConnection: mongoose.Connection | null = null;
const counters = { http_gets: 0, owner_pool_rows: 0, manager_pool_rows: 0, rep_pool_rows: 0, ordinary_rep_rows: 0, canonical_leads_checked: 0 };
const check = (name: string, passed: boolean, status?: number, reason?: string) => checks.push({ name, passed, ...(status === undefined ? {} : { status }), ...(reason ? { reason } : {}) });
const required = (name: string) => { const value = process.env[name]?.trim(); if (!value) throw new Error("runtime_binding_missing"); return value; };
const digest = (value: unknown) => createHash("sha256").update(JSON.stringify(value)).digest("hex");

const windowSchema = z.object({ from: z.string(), to: z.string() });
const laneSchema = z.object({
  observed_at: z.string().datetime(), last_complete_coverage_at: z.string().datetime().nullable(),
  latest_slot: z.object({ _id: z.string(), expected_windows: z.number().int().nonnegative(), discovered_windows: z.number().int().nonnegative(),
    collected_windows: z.number().int().nonnegative(), completed_windows: z.number().int().nonnegative(), failed_windows: z.number().int().nonnegative(),
    latest_collection_at: z.string().datetime().nullable(), created_at: z.string().datetime() }).nullable(),
  warnings: z.array(z.string()), older_scope: z.string(), coverage_limit: z.string(),
  oldest_uncovered_range: windowSchema.nullable().optional(), held_rows: z.number().int().nonnegative().optional(), lag_ms: z.number().nonnegative().nullable().optional(),
});
const freshnessSchema = laneSchema.extend({ pool_lanes: z.object({ refresh: laneSchema, discovery: laneSchema }) });

function assertGetPath(method: string, path: string) {
  if (method !== "GET") throw new Error("non_get_refused");
  const url = new URL(path, HOST);
  const allowed = url.pathname === FRESHNESS || ["capabilities", "queue", "live"].some(p => url.pathname === `${DESK}/${p}`)
    || new RegExp(`^${DESK}/outreach/[a-f\\d]{24}$`).test(url.pathname);
  if (url.origin !== HOST || !path.startsWith("/") || path.startsWith("//") || !allowed || url.hash || path.includes("\\")) throw new Error("path_refused");
  const keys = url.pathname.endsWith("/queue") ? ["queue_scope", "state", "limit", "cursor", "agent_id", "workflow"] : url.pathname.endsWith("/live") ? ["version"] : [];
  for (const key of url.searchParams.keys()) if (!keys.includes(key) || url.searchParams.getAll(key).length !== 1) throw new Error("query_refused");
  return url;
}

async function get(path: string, identity: Identity | null, live = false) {
  const url = assertGetPath("GET", path);
  const headers: Record<string, string> = { "x-api-secret": required("VANTAGE_API_SECRET"), accept: live ? "text/event-stream" : "application/json" };
  if (identity) {
    const timestamp = String(Date.now()), requestId = randomUUID();
    const fields = { adminId: identity.id, email: identity.email, role: identity.role, timestamp, requestId, method: "GET", path: url.pathname };
    const payload = identity.role === "rep" ? buildCanonicalRepActorPayload({ ...fields, agentId: identity.agentId! }) : buildCanonicalAdminActorPayload(fields);
    Object.assign(headers, { [H.userId]: identity.id, [H.email]: identity.email, [H.role]: identity.role, [H.timestamp]: timestamp,
      [H.requestId]: requestId, [H.signature]: createHmac("sha256", required("VANTAGE_ADMIN_PROXY_SIGNING_SECRET")).update(payload).digest("hex") });
    if (identity.role === "rep") headers[ADMIN_PROXY_AGENT_HEADER] = identity.agentId!;
  }
  counters.http_gets++;
  return fetch(url, { method: "GET", redirect: "error", headers, signal: AbortSignal.timeout(live ? 15_000 : 90_000) });
}

async function read<T extends z.ZodType>(name: string, path: string, identity: Identity, schema: T): Promise<z.infer<T> | null> {
  try {
    const response = await get(path, identity);
    const envelope = z.object({ ok: z.literal(true), data: z.unknown() }).safeParse(await response.json());
    const parsed = schema.safeParse(envelope.success ? envelope.data.data : undefined);
    check(name, response.ok && envelope.success && parsed.success, response.status, !response.ok ? "http_refused" : !envelope.success || !parsed.success ? "schema_mismatch" : undefined);
    return response.ok && envelope.success && parsed.success ? parsed.data : null;
  } catch { check(name, false, undefined, "request_failed"); return null; }
}

async function denied(name: string, path: string, identity: Identity | null, statuses = [403]) {
  try { const response = await get(path, identity); await response.body?.cancel(); check(name, statuses.includes(response.status), response.status); }
  catch { check(name, false, undefined, "request_failed"); }
}

async function queue(name: string, identity: Identity, pool: boolean) {
  const rows: z.infer<typeof salesOutreachQueueSchema>["rows"] = [];
  let cursor: string | null = null;
  for (let page = 0; page < 20; page++) {
    const query = new URLSearchParams({ state: "all_active", limit: "100", ...(pool ? { queue_scope: "pool" } : {}) });
    if (cursor) query.set("cursor", cursor);
    const data = await read(`${name}_page_${page + 1}`, `${DESK}/queue?${query}`, identity, salesOutreachQueueSchema);
    if (!data) return null;
    if (pool && (data.filters.queue_scope !== "pool" || data.rows.some(row => !row.pool))) { check(`${name}_shared_contract`, false); return null; }
    rows.push(...data.rows);
    if (!data.has_more) { check(`${name}_unique_rows`, new Set(rows.map(r => r.subject_id)).size === rows.length); return rows; }
    if (!data.next_cursor || data.next_cursor === cursor) break;
    cursor = data.next_cursor;
  }
  check(`${name}_pagination_complete`, false, undefined, "pagination_bound_reached"); return null;
}

async function live(name: string, identity: Identity) {
  let reader: ReadableStreamDefaultReader<Uint8Array> | undefined;
  try {
    const response = await get(`${DESK}/live?version=1`, identity, true);
    if (!response.ok || !response.headers.get("content-type")?.includes("text/event-stream") || !response.body) {
      check(name, false, response.status); await response.body?.cancel(); return;
    }
    reader = response.body.getReader(); const decoder = new TextDecoder(); let buffer = "";
    while (buffer.length < 65_536) {
      const part = await reader.read(); if (part.done) break;
      buffer += decoder.decode(part.value, { stream: true });
      const frame = buffer.split(/\r?\n\r?\n/).find(block => /^event:\s*invalidation$/m.test(block));
      if (!frame) continue;
      const data = frame.split(/\r?\n/).filter(line => line.startsWith("data:")).map(line => line.slice(5).trimStart()).join("\n");
      check(name, salesOutreachLiveFrameSchema.safeParse(JSON.parse(data)).success, response.status); return;
    }
    check(name, false, response.status, "live_frame_missing");
  } catch { check(name, false, undefined, "live_read_failed"); }
  finally { await reader?.cancel().catch(() => undefined); }
}

async function main() {
  const args = process.argv.slice(2);
  if (args.length === 1 && args[0] === "--self-test") {
    for (const path of [`${DESK}/capabilities`, `${DESK}/queue?queue_scope=pool&state=all_active`, `${DESK}/outreach/000000000000000000000000`, `${DESK}/live?version=1`, FRESHNESS]) assertGetPath("GET", path);
    let refusals = 0;
    for (const [method, path] of [["POST", `${DESK}/queue`], ["PATCH", `${DESK}/outreach/000000000000000000000000`], ["GET", "https://example.com/"], ["GET", `${DESK}/configuration`], ["GET", `${DESK}/queue?url=https://example.com`], ["GET", `${DESK}/queue?state=all_active&state=needs_contact`]]) {
      try { assertGetPath(method!, path!); } catch { refusals++; }
    }
    if (refusals !== 6) throw new Error("request_fence_failed");
    console.log("GET-only fixed-host path/query fences passed; no network or database access."); return;
  }
  if (args.length === 1 && args[0] === "--help") {
    console.log("GET-only: node --env-file=../vantage-admin/.env --env-file=.env --import tsx ops/pool-production/deployed-reads.ts --target=<main-db> --admin-db=<actual-admin-auth-db> --out=ops/output/pool-deployed-reads.json"); return;
  }
  if (args.some(arg => !/^--(target|admin-db|out)=/.test(arg))) throw new Error("unknown_option");
  const option = (name: string) => args.find(arg => arg.startsWith(`--${name}=`))?.slice(name.length + 3);
  const target = option("target"), adminDatabase = option("admin-db"), out = option("out");
  if (!target || !adminDatabase || !out || !/^[a-zA-Z\d_-]+$/.test(target) || !/^[a-zA-Z\d_-]+$/.test(adminDatabase)) throw new Error("required_options_missing");
  const output = resolve(out), within = (root: string) => { const value = relative(resolve(root), output); return value !== "" && !isAbsolute(value) && !value.startsWith(`..${sep}`) && value !== ".."; };
  const ignoredOutput = within("ops/output"), redactedOutput = within("docs/rep-desk-and-pool/evidence/release");
  if (!output.endsWith(".json") || (!ignoredOutput && !redactedOutput)) throw new Error("output_destination_refused");
  if (ignoredOutput) execFileSync("git", ["check-ignore", "--quiet", "--", output], { stdio: "ignore" });
  for (const key of ["VANTAGE_API_SECRET", "VANTAGE_ADMIN_PROXY_SIGNING_SECRET", "VANTAGE_ADMIN_USER_ID", "VANTAGE_ADMIN_EMAIL", "MONGO_URI", "MONGODB_URI", "ADMIN_AUTH_DB_NAME"]) required(key);
  if (adminDatabase !== required("ADMIN_AUTH_DB_NAME")) throw new Error("admin_target_mismatch");
  const { getMongoDatabaseName, isTestMode } = await import("../../src/config/domain/runtime.js");
  if (isTestMode() || getMongoDatabaseName() !== target) throw new Error("production_target_mismatch");
  mongoose.set("autoIndex", false); mongoose.set("autoCreate", false);
  if (process.env.VERCEL !== "1" && process.env.NODE_ENV !== "production") {
    const servers = process.env.MONGO_DNS_SERVERS?.split(",").map(value => value.trim()).filter(Boolean);
    if (servers?.length) dns.setServers(servers);
  }
  await mongoose.connect(required("MONGO_URI"), { dbName: target, autoIndex: false, autoCreate: false, maxPoolSize: 2, serverSelectionTimeoutMS: 8_000 });
  adminConnection = await mongoose.createConnection(required("MONGODB_URI"), { dbName: adminDatabase, autoIndex: false, autoCreate: false,
    maxPoolSize: 1, serverSelectionTimeoutMS: 8_000 }).asPromise();
  const db = mongoose.connection.db!, authDb = adminConnection.db!;
  const projection = { _id: 1, email: 1, role: 1, agent_id: 1 };
  const users = await authDb.collection("admin_users").find({ active: true, role: { $in: ["owner", "manager", "rep", "admin"] } }, { projection }).limit(500).toArray();
  const ownerId = required("VANTAGE_ADMIN_USER_ID"), ownerEmail = required("VANTAGE_ADMIN_EMAIL").toLowerCase();
  const actualOwner = users.find(u => String(u._id) === ownerId && u.email === ownerEmail && u.role === "owner");
  if (!actualOwner || !ID.test(ownerId)) throw new Error("owner_identity_not_verified");
  const identity = (user: typeof users[number]): Identity => ({ id: String(user._id), email: String(user.email), role: user.role, ...(user.role === "rep" ? { agentId: String(user.agent_id) } : {}) });
  const owner = identity(actualOwner), managerUser = users.find(u => u.role === "manager");
  const manager = managerUser ? identity(managerUser) : null;
  const now = new Date();
  const reviewed = await db.collection("rep_identity_links").find({ status: { $in: ["reviewed", "retired"] }, role_kind: "sales_rep", effective_from: { $lte: now },
    $or: [{ effective_to: null }, { effective_to: { $gt: now } }] }, { projection: { agent_id: 1, status: 1, reviewed_at: 1, reviewed_by: 1, effective_to: 1 } }).toArray();
  const reviewedIds = new Set(reviewed.filter(r => r.status === "reviewed" || r.reviewed_at && r.reviewed_by && r.effective_to).map(r => String(r.agent_id)));
  const agents = await db.collection("agents").find({ active: true, outreach_desk: { $ne: "off" } }, { projection: { _id: 1 } }).toArray();
  const eligible = new Set(agents.map(a => String(a._id)).filter(id => reviewedIds.has(id)));
  const reps = users.filter(u => u.role === "rep" && ID.test(String(u.agent_id)) && eligible.has(String(u.agent_id))).map(identity);
  const subjects = await db.collection("sales_outreach_subjects").find({ status: { $in: ["active", "review"] } }, { projection: { _id: 1, lead_id: 1, lead_model: 1 } }).toArray();
  const snapshot = async (subjectIds: readonly string[]) => {
    const rows = [];
    for (const id of subjectIds) {
      const subject = subjects.find(s => String(s._id) === id);
      if (!subject || !["FormLead", "CallLead"].includes(subject.lead_model)) throw new Error("canonical_subject_missing");
      const lead = await db.collection(subject.lead_model === "FormLead" ? "form_leads" : "call_leads").findOne({ _id: subject.lead_id }, { projection: { granot_priority: 1, receiver_agent: 1, domain_revision: 1, no_sync: 1, sheet_sync: 1 } });
      if (!lead) throw new Error("canonical_lead_missing");
      rows.push({ priority: String(lead.granot_priority), receiver: String(lead.receiver_agent ?? ""), revision: lead.domain_revision ?? 0, no_sync: lead.no_sync ?? null, sheets: digest(lead.sheet_sync ?? []) });
    }
    return rows;
  };
  const activeWorks = await db.collection("sales_outreach_pool_work").find({ active: true }, { projection: { subject_id: 1, episodes: 1 } }).limit(1000).toArray();
  const ids = activeWorks.map(w => String(w.subject_id));
  const before = await snapshot(ids);
  check("canonical_pool_priority_before", before.length > 0 && before.every(row => row.priority === "9"));
  await read("owner_capabilities", `${DESK}/capabilities`, owner, salesOutreachCapabilitiesSchema);
  const ownerRows = await queue("owner_pool", owner, true);
  counters.owner_pool_rows = ownerRows?.length ?? 0;
  check("activated_pool_visible", Boolean(ownerRows?.length));
  const witness = ownerRows?.flatMap(row => reps.filter(rep => rep.agentId !== row.assigned_agent_id).map(rep => ({ row, rep })))[0];
  check("foreign_rep_identity_available", Boolean(witness));
  check("manager_identity_available", Boolean(manager));
  if (manager) {
    await read("manager_capabilities", `${DESK}/capabilities`, manager, salesOutreachCapabilitiesSchema);
    const rows = await queue("manager_pool", manager, true); counters.manager_pool_rows = rows?.length ?? 0;
    check("manager_shared_scope_matches_owner", Boolean(rows && ownerRows && digest(rows.map(r => r.subject_id).sort()) === digest(ownerRows.map(r => r.subject_id).sort())));
    if (witness) await read("manager_pool_detail", `${DESK}/outreach/${witness.row.subject_id}`, manager, salesOutreachDetailSchema);
    await live("manager_live_schema", manager);
  }
  if (witness) {
    const { row, rep } = witness;
    await read("owner_pool_detail", `${DESK}/outreach/${row.subject_id}`, owner, salesOutreachDetailSchema);
    await read("rep_capabilities", `${DESK}/capabilities`, rep, salesOutreachCapabilitiesSchema);
    const sharedRows = await queue("rep_pool", rep, true); counters.rep_pool_rows = sharedRows?.length ?? 0;
    check("rep_shared_scope_matches_owner", Boolean(sharedRows && ownerRows && digest(sharedRows.map(r => r.subject_id).sort()) === digest(ownerRows.map(r => r.subject_id).sort())));
    const detail = await read("foreign_rep_pool_detail", `${DESK}/outreach/${row.subject_id}`, rep, salesOutreachDetailSchema);
    check("foreign_rep_assignment_preserved", Boolean(detail?.pool && detail.assignment.assigned_agent_id === row.assigned_agent_id));
    const episodeStart = activeWorks.find(work => String(work.subject_id) === row.subject_id)?.episodes?.at(-1)?.started_at;
    check("foreign_rep_history_narrowed", Boolean(detail && episodeStart && detail.history.window_history.length === 0 && detail.history.window_summary === null
      && detail.history.assignment_changes.length === 0 && detail.plan.history.length === 0 && detail.policy.period === null
      && detail.policy.quoted === null && detail.policy.initial_response === null && detail.policy.catch_up === null
      && detail.history.contact_events.every(event => Date.parse(event.event_at) >= +new Date(episodeStart))));
    const ordinary = await queue("rep_ordinary", rep, false); counters.ordinary_rep_rows = ordinary?.length ?? 0;
    check("ordinary_queue_remains_private", Boolean(ordinary && ordinary.every(r => r.assigned_agent_id === rep.agentId)));
    const ownerOrdinary = await read("owner_ordinary_witness_page", `${DESK}/queue?state=all_active&workflow=other&limit=100`, owner, salesOutreachQueueSchema);
    const foreign = ownerOrdinary?.rows.find(r => !r.pool && r.assigned_agent_id !== rep.agentId);
    check("ordinary_foreign_witness_available", Boolean(foreign));
    if (foreign) await denied("ordinary_foreign_detail_denied", `${DESK}/outreach/${foreign.subject_id}`, rep, [404]);
    await live("rep_live_schema", rep);
  }
  await live("owner_live_schema", owner);
  await denied("generic_admin_capabilities_denied", `${DESK}/capabilities`, { ...owner, role: "admin" });
  await denied("generic_admin_queue_denied", `${DESK}/queue?queue_scope=pool`, { ...owner, role: "admin" });
  await denied("unsigned_queue_denied", `${DESK}/queue?queue_scope=pool`, null);
  await denied("unsigned_live_denied", `${DESK}/live?version=1`, null);
  const denialSubject = witness?.row.subject_id ?? ids[0];
  if (denialSubject) {
    await denied("generic_admin_detail_denied", `${DESK}/outreach/${denialSubject}`, { ...owner, role: "admin" });
    await denied("unsigned_detail_denied", `${DESK}/outreach/${denialSubject}`, null);
  }
  await read("granot_pool_lane_freshness_schema", FRESHNESS, owner, freshnessSchema);
  const after = await snapshot(ids); counters.canonical_leads_checked = after.length;
  check("canonical_priority_assignment_revision_and_sheets_unchanged", digest(before) === digest(after));
  const evidence = { schema_version: 1, observed_at: new Date().toISOString(), fixed_host: HOST, method: "GET", production_mutations: 0,
    existing_identities_only: true, synthetic_customers: false, passed: checks.every(c => c.passed), counters, checks };
  await mkdir(dirname(output), { recursive: true }); await writeFile(output, JSON.stringify(evidence, null, 2) + "\n", { mode: 0o600 });
  console.log(JSON.stringify(evidence, null, 2));
  if (!evidence.passed) process.exitCode = 2;
}

main().catch(error => {
  const allowed = new Set(["runtime_binding_missing", "required_options_missing", "unknown_option", "output_destination_refused", "production_target_mismatch", "admin_target_mismatch", "owner_identity_not_verified", "canonical_subject_missing", "canonical_lead_missing", "path_refused", "query_refused", "non_get_refused"]);
  const reason = error instanceof Error && allowed.has(error.message) ? error.message : "operation_failed";
  console.error(JSON.stringify({ passed: false, production_mutations: 0, reason, details_suppressed: true })); process.exitCode = 1;
})
  .finally(async () => { await Promise.allSettled([mongoose.disconnect(), ...(adminConnection ? [adminConnection.close()] : [])]); });
