import { randomUUID } from "node:crypto";
import { computeAdminActorSignature } from "../../../../../src/services/operationsRegistry/trustedActor";

const BASE = "http://127.0.0.1:3010";
const PREFIX = "/api/v1/admin/sales-intelligence";
const ACCOUNT = "62948571023";
const SNAPSHOT = "6aaea089984b82cb35a76522";
const UNIQUE = new Set(["austin", "brian", "dylan", "jacob", "jenna", "josh", "joshua", "mike", "nick", "patrick", "roy", "roys", "sean"]);
const NEVER = new Set(["jason", "benjamin", "tyler", "russell", "daniel"]);

function token(name: string | null | undefined) {
  return (name ?? "").normalize("NFKC").trim().toLowerCase().split(/\s+/)[0] ?? "";
}
function channels(dids: readonly string[] | undefined) {
  return (dids?.length ?? 0) === 1 ? ["pager", "sms_to_rep"] : ["pager"];
}
function headers(method: string, path: string, key?: string) {
  const secret = process.env.VANTAGE_ADMIN_PROXY_SIGNING_SECRET;
  const api = process.env.VANTAGE_API_SECRET;
  const email = process.env.CSI_SEED_ACTOR_EMAIL ?? process.env.ADMIN_SEED_EMAIL;
  const adminId = process.env.CSI_SEED_ACTOR_ID ?? "6a73a0ede22314508f1b7cd5";
  if (!secret || !api || !email || !adminId) throw new Error("missing signed-owner env");
  const timestamp = String(Date.now());
  const requestId = randomUUID();
  const fields = { adminId, email, role: "owner", timestamp, requestId, method, path };
  return {
    "x-api-secret": api,
    "x-vantage-admin-user-id": adminId,
    "x-vantage-admin-email": email,
    "x-vantage-admin-role": "owner",
    "x-vantage-admin-timestamp": timestamp,
    "x-vantage-admin-request-id": requestId,
    "x-vantage-admin-signature": computeAdminActorSignature(fields, secret),
    "content-type": "application/json",
    ...(key ? { "Idempotency-Key": key } : {}),
  };
}
async function call(method: string, path: string, body?: unknown, key?: string) {
  const res = await fetch(`${BASE}${path}`, { method, headers: headers(method, path, key), body: body ? JSON.stringify(body) : undefined });
  const json = await res.json() as Record<string, unknown>;
  if (!res.ok || json.ok === false) throw new Error(`${method} ${path} ${res.status} ${JSON.stringify({ code: json.code, error: json.error })}`);
  return json;
}

async function proposeAll() {
  const pages = [];
  let after: string | undefined;
  for (let page = 0; page < 8; page += 1) {
    const result = await call("POST", `${PREFIX}/reps/propose`, {
      expected_revision: 1,
      rc_account_id: ACCOUNT,
      directory_snapshot_id: SNAPSHOT,
      reason: "CSI-10 production seed: unique directory proposals only",
      limit: 50,
      ...(after ? { after_extension_id: after } : {}),
    }, `csi-10-seed-propose-${page}-${randomUUID()}`);
    const data = result.data as { response?: { results?: Array<Record<string, unknown>>; next_cursor?: string | null } };
    const payload = data.response ?? data;
    const results = (payload as { results?: Array<Record<string, unknown>> }).results ?? [];
    pages.push(results.map((row) => ({
      extension_id: row.extension_id,
      extension_name: row.extension_name,
      status: row.status,
      link_id: row.link_id ?? null,
      preserved: row.preserved ?? false,
      candidates: Array.isArray(row.candidates) ? (row.candidates as Array<{ agent_name: string; basis: string }>).map((c) => ({ agent_name: c.agent_name, basis: c.basis })) : [],
    })));
    const next = (payload as { next_cursor?: string | null }).next_cursor;
    if (!next) break;
    after = next;
  }
  return pages.flat();
}

async function listLinks() {
  const items: Array<Record<string, unknown>> = [];
  let cursor: string | undefined;
  const users: Array<Record<string, unknown>> = [];
  let directoryCursor: string | undefined;
  for (let page = 0; page < 8; page += 1) {
    const query = new URLSearchParams({ rc_account_id: ACCOUNT, limit: "50", ...(cursor ? { cursor } : {}), ...(directoryCursor ? { directory_cursor: directoryCursor } : {}) });
    const result = await call("GET", `${PREFIX}/reps?${query}`);
    const data = result.data as { items?: Array<Record<string, unknown>>; next_cursor?: string | null; directory?: { users?: Array<Record<string, unknown>>; next_cursor?: string | null } };
    items.push(...(data.items ?? []));
    users.push(...(data.directory?.users ?? []));
    if (!data.next_cursor && !data.directory?.next_cursor) break;
    cursor = data.next_cursor ?? cursor;
    directoryCursor = data.directory?.next_cursor ?? directoryCursor;
    if (!data.next_cursor && data.directory?.next_cursor) cursor = undefined;
  }
  return { items, users };
}

async function main() {
  const mode = process.argv[2] ?? "propose";
  if (mode === "propose") {
    const results = await proposeAll();
    console.log(JSON.stringify({
      proposed: results.filter((r) => r.status === "proposed").map((r) => ({ name: r.extension_name, status: r.status, agents: r.candidates })),
      other: results.filter((r) => r.status !== "proposed").map((r) => ({ name: r.extension_name, status: r.status, agents: r.candidates })),
      counts: {
        proposed: results.filter((r) => r.status === "proposed").length,
        unmatched: results.filter((r) => r.status === "unmatched").length,
        ambiguous: results.filter((r) => r.status === "ambiguous").length,
        preserved: results.filter((r) => r.preserved).length,
        total: results.length,
      },
    }, null, 2));
    return;
  }
  if (mode === "review") {
    const { items } = await listLinks();
    const reviewed = [];
    for (const item of items) {
      const first = token(String(item.agent_name ?? ""));
      const extFirst = token(String(item.rc_extension_name ?? ""));
      const status = String(item.status);
      if (status !== "proposed") continue;
      if (NEVER.has(first) || NEVER.has(extFirst) || !UNIQUE.has(first)) {
        reviewed.push({ skipped: true, agent: item.agent_name, extension: item.rc_extension_name, reason: "not in unique allowlist" });
        continue;
      }
      const dids = Array.isArray(item.rc_direct_numbers) ? item.rc_direct_numbers as string[] : [];
      const allowed = channels(dids);
      const path = `${PREFIX}/reps/${item.id}/review`;
      const result = await call("POST", path, {
        expected_revision: item.revision,
        reason: "CSI-10 production seed: Owner review of unique first-token proposal",
        status: "reviewed",
        link: {
          agent_id: item.agent_id,
          rc_account_id: item.rc_account_id,
          rc_extension_id: item.rc_extension_id,
          role_kind: "sales_rep",
          effective_from: item.effective_from,
          effective_to: item.effective_to,
          nudge_channels_allowed: allowed,
        },
      }, `csi-10-seed-review-${item.id}-${randomUUID()}`);
      const link = (result.data as { response?: { link?: Record<string, unknown> } }).response?.link
        ?? (result.data as { link?: Record<string, unknown> }).link;
      reviewed.push({
        agent: item.agent_name,
        extension: item.rc_extension_name,
        status: link?.status ?? null,
        role_kind: link?.role_kind ?? null,
        channels: link?.nudge_channels_allowed ?? allowed,
        did_count: dids.length,
        person_id_present: Boolean(link?.rc_team_messaging_person_id),
      });
    }
    console.log(JSON.stringify({ reviewed }, null, 2));
    return;
  }
  if (mode === "prove") {
    const { items, users } = await listLinks();
    const nudges = await call("GET", `${PREFIX}/nudges?rc_account_id=${ACCOUNT}&limit=50`).catch((error: Error) => ({ error: error.message }));
    console.log(JSON.stringify({
      links: items.map((item) => ({
        agent: item.agent_name,
        extension: item.rc_extension_name,
        status: item.status,
        role: item.role_kind,
        channels: item.nudge_channels_allowed,
        did_count: Array.isArray(item.rc_direct_numbers) ? item.rc_direct_numbers.length : 0,
        person_id: item.rc_team_messaging_person_id ?? null,
      })),
      directory: users.map((user) => ({
        name: user.extension_name,
        status: user.status,
        candidates: user.candidates,
      })),
      reviewed_sales_reps: items.filter((i) => i.status === "reviewed" && i.role_kind === "sales_rep").length,
      proposed_remaining: items.filter((i) => i.status === "proposed").length,
      nudges: "error" in nudges ? nudges : { ok: true, note: "nudge list available; NUDGE_ENABLED is off for send" },
    }, null, 2));
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "seed command failed");
  process.exitCode = 1;
});
