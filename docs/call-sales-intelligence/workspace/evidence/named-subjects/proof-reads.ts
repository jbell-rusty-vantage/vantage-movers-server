import { randomUUID } from "node:crypto";
import { computeAdminActorSignature } from "../../../../../src/services/operationsRegistry/trustedActor";

const PREFIX = "/api/v1/admin/sales-intelligence";
const SUBJECTS = [
  { job: "P5562014", leadId: "6a761d3d7ceae445794c57bd" },
  { job: "5564480", leadId: "6aaaf552ca2df3ab6f396b5d" },
] as const;

function headers(method: string, path: string) {
  const secret = process.env.VANTAGE_ADMIN_PROXY_SIGNING_SECRET;
  const api = process.env.VANTAGE_API_SECRET;
  const email = process.env.CSI_SEED_ACTOR_EMAIL ?? process.env.ADMIN_SEED_EMAIL;
  const adminId = process.env.CSI_SEED_ACTOR_ID ?? "6a73a0ede22314508f1b7cd5";
  if (!secret || !api || !email || !adminId) throw new Error("missing signed-owner env");
  const timestamp = String(Date.now());
  const requestId = randomUUID();
  return {
    "x-api-secret": api,
    "x-vantage-admin-user-id": adminId,
    "x-vantage-admin-email": email,
    "x-vantage-admin-role": "owner",
    "x-vantage-admin-timestamp": timestamp,
    "x-vantage-admin-request-id": requestId,
    "x-vantage-admin-signature": computeAdminActorSignature(
      { adminId, email, role: "owner", timestamp, requestId, method, path },
      secret,
    ),
  };
}

function redact(body: unknown) {
  const text = JSON.stringify(body);
  return JSON.parse(
    text.replace(/\+1\d{10}/g, "+1XXXXXXXXXX").replace(/\b\d{10,15}\b/g, (value) =>
      value.length === 24 ? value : "REDACTED_DIGITS",
    ),
  );
}

async function read(base: string, label: string) {
  const rows = [];
  for (const subject of SUBJECTS) {
    const path = `${PREFIX}/outreach/by-lead/CallLead/${subject.leadId}`;
    const res = await fetch(`${base}${path}`, { headers: headers("GET", path) });
    const json = (await res.json()) as {
      ok?: boolean;
      code?: string;
      data?: {
        outreach?: {
          id?: string;
          state?: string;
          reason?: string | null;
          primary_number?: { id?: string } | null;
          followups?: Array<{ status?: string }>;
          derived?: { reasons?: string[]; overdue?: boolean };
        };
      };
    };
    const outreach = json.data?.outreach;
    rows.push({
      origin: label,
      job: subject.job,
      lead_id: subject.leadId,
      http: res.status,
      ok: json.ok === true,
      code: json.code ?? null,
      outreach_id: outreach?.id ?? null,
      state: outreach?.state ?? null,
      reason: outreach?.reason ?? null,
      primary_number: Boolean(outreach?.primary_number?.id),
      open_followups: outreach?.followups?.filter((row) => row.status === "open").length ?? 0,
      overdue: outreach?.derived?.overdue ?? null,
      reasons: outreach?.derived?.reasons ?? [],
    });
  }
  const missingPath = `${PREFIX}/outreach/by-lead/CallLead/000000000000000000000000`;
  const missing = await fetch(`${base}${missingPath}`, { headers: headers("GET", missingPath) });
  return { origin: label, subjects: rows, missing: { http: missing.status }, sample: redact(rows) };
}

async function main() {
  const bases = [
    ["local-3010", "http://127.0.0.1:3010"],
    ["production-api", process.env.VANTAGE_API_BASE_URL ?? "https://vantage-movers-main-server.vercel.app"],
  ] as const;
  const results = [];
  for (const [label, base] of bases) {
    try {
      results.push(await read(base, label));
    } catch (error) {
      results.push({ origin: label, error: error instanceof Error ? error.message : "read failed" });
    }
  }
  console.log(JSON.stringify({ ok: true, results }, null, 2));
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : "named-subject proof reads failed");
  process.exitCode = 1;
});
