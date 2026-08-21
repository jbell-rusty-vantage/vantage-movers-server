/**
 * Backfill receiver_agent_name_snapshot through the public lead PATCH API
 * so Sheet Sync rewrites SalesRep. Report is default. Production writes
 * need --i-mean-it. Never logs secrets or customer phones/emails.
 */
import { vantageApi } from "./vantageApi";

type LeadKind = "CallLead" | "FormLead";

type Candidate = {
  kind: LeadKind;
  leadId: string;
  jobNo: string;
  agentId: string;
  username: string;
};

type Envelope = {
  ok?: boolean;
  data?: unknown;
  error?: unknown;
};

const CANDIDATES: Candidate[] = [
  {
    kind: "CallLead",
    leadId: "6a8755f32995d2d1b509fede",
    jobNo: "5562872",
    agentId: "6a22eb273fcb5d44d0324382",
    username: "PATRICKO",
  },
  {
    kind: "CallLead",
    leadId: "6a87792d2a52944a4bebe3ea",
    jobNo: "5562883",
    agentId: "6a32b6efdf22fad9eb0f7080",
    username: "NICK",
  },
  {
    kind: "CallLead",
    leadId: "6a87b8540c758d626675a137",
    jobNo: "5562889",
    agentId: "6a1dc03e419f58fdad44944f",
    username: "JOSH",
  },
  {
    kind: "CallLead",
    leadId: "6a88765bc28d0beb9f231f3a",
    jobNo: "5562924",
    agentId: "6a21fe8b3fcb5d44d032227e",
    username: "AUSTIN",
  },
  {
    kind: "CallLead",
    leadId: "6a88680f2f56bd35867a0a90",
    jobNo: "5562925",
    agentId: "6a32b6efdf22fad9eb0f7080",
    username: "NICK",
  },
  {
    kind: "FormLead",
    leadId: "6a741ea47db2ee47723b7511",
    jobNo: "5561906",
    agentId: "6a1df18b419f58fdad449975",
    username: "ROY",
  },
  {
    kind: "FormLead",
    leadId: "6a863ca6843da561bd381f2a",
    jobNo: "5562829",
    agentId: "6a22eb273fcb5d44d0324380",
    username: "JACOB",
  },
  {
    kind: "FormLead",
    leadId: "6a8731802f03b4f371996a32",
    jobNo: "5562868",
    agentId: "6a1f15ea419f58fdad44f423",
    username: "SIL",
  },
  {
    kind: "FormLead",
    leadId: "6a875249bd5412173dc4e71c",
    jobNo: "5562873",
    agentId: "6a21f48c3fcb5d44d03221ab",
    username: "DYLAN",
  },
  {
    kind: "FormLead",
    leadId: "6a8752bd6d9ae97cd129063f",
    jobNo: "5562874",
    agentId: "6a21fe8b3fcb5d44d032227e",
    username: "AUSTIN",
  },
  {
    kind: "FormLead",
    leadId: "6a876ada465a6d3439f5f395",
    jobNo: "5562879",
    agentId: "6a1df18b419f58fdad449975",
    username: "ROY",
  },
  {
    kind: "FormLead",
    leadId: "6a876b35c73b2c5098ecdb84",
    jobNo: "5562880",
    agentId: "6a22eb273fcb5d44d0324380",
    username: "JACOB",
  },
  {
    kind: "FormLead",
    leadId: "6a87c337ed8d2158341c0722",
    jobNo: "5562892",
    agentId: "6a21fe8b3fcb5d44d032227e",
    username: "AUSTIN",
  },
  {
    kind: "FormLead",
    leadId: "6a87c49ced8d2158341c0730",
    jobNo: "5562893",
    agentId: "6a22eb273fcb5d44d0324382",
    username: "PATRICKO",
  },
  {
    kind: "FormLead",
    leadId: "6a8840efc4fafbfedc41151a",
    jobNo: "5562914",
    agentId: "6a22eb273fcb5d44d0324382",
    username: "PATRICKO",
  },
  {
    kind: "FormLead",
    leadId: "6a8848174b9bb65587947358",
    jobNo: "5562921",
    agentId: "6a21fe8b3fcb5d44d032227e",
    username: "AUSTIN",
  },
];

function asRecord(value: unknown): Record<string, unknown> | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function unwrap(data: unknown): Record<string, unknown> | null {
  const envelope = asRecord(data);
  if (!envelope) return null;
  const inner = asRecord(envelope.data) ?? envelope;
  return asRecord(inner.lead) ?? inner;
}

function asId(value: unknown): string {
  if (typeof value === "string") return value;
  const record = asRecord(value);
  if (typeof record?.$oid === "string") return record.$oid;
  if (value == null) return "";
  return String(value);
}

function asText(value: unknown): string {
  return typeof value === "string" ? value.trim() : "";
}

function patchPath(kind: LeadKind, leadId: string): string {
  return kind === "CallLead"
    ? `/api/v1/call-leads/${leadId}`
    : `/api/v1/form-leads/${leadId}`;
}

function browseResults(data: unknown): Record<string, unknown>[] {
  const envelope = asRecord(data);
  const inner = asRecord(envelope?.data) ?? envelope;
  const results = inner?.results;
  if (!Array.isArray(results)) return [];
  return results.flatMap((row) => {
    const record = asRecord(row);
    return record ? [record] : [];
  });
}

async function getLead(
  candidate: Candidate,
  signAdmin: boolean,
): Promise<{ status: number; lead: Record<string, unknown> | null }> {
  if (candidate.kind === "FormLead") {
    const result = await vantageApi<Envelope>({
      method: "GET",
      path: `/api/v1/form-leads/${candidate.leadId}`,
    });
    return { status: result.status, lead: unwrap(result.data) };
  }

  if (signAdmin) {
    const result = await vantageApi<Envelope>({
      method: "GET",
      path: `/api/v1/admin/call-leads/${candidate.leadId}`,
      signAdmin: true,
    });
    return { status: result.status, lead: unwrap(result.data) };
  }

  const result = await vantageApi<Envelope>({
    method: "GET",
    path: "/api/v1/call-leads",
    query: { job_no: candidate.jobNo, limit: 10 },
  });
  const match =
    browseResults(result.data).find((row) => asId(row._id) === candidate.leadId) ??
    null;
  return { status: result.status, lead: match };
}

async function getAgentName(
  agentId: string,
  signAdmin: boolean,
): Promise<string> {
  if (!signAdmin) return "";
  const result = await vantageApi<Envelope>({
    method: "GET",
    path: `/api/v1/admin/agents/${agentId}`,
    signAdmin: true,
  });
  const agent = unwrap(result.data);
  return asText(agent?.name);
}

function summarizeLead(lead: Record<string, unknown> | null) {
  if (!lead) {
    return {
      receiver_agent: "",
      receiver_agent_source: "",
      receiver_agent_source_value: "",
      receiver_agent_name_snapshot: "",
    };
  }
  return {
    receiver_agent: asId(lead.receiver_agent),
    receiver_agent_source: asText(lead.receiver_agent_source),
    receiver_agent_source_value: asText(lead.receiver_agent_source_value),
    receiver_agent_name_snapshot: asText(lead.receiver_agent_name_snapshot),
  };
}

async function main() {
  const argv = process.argv.slice(2);
  const apply = argv.includes("--i-mean-it");
  const signAdmin =
    argv.includes("--sign-admin") ||
    Boolean(
      process.env.VANTAGE_ADMIN_USER_ID &&
        process.env.VANTAGE_ADMIN_EMAIL &&
        process.env.VANTAGE_ADMIN_PROXY_SIGNING_SECRET,
    );

  console.log(
    JSON.stringify({
      mode: apply ? "apply" : "report",
      sign_admin: signAdmin,
      count: CANDIDATES.length,
    }),
  );

  for (const candidate of CANDIDATES) {
    const fetched = await getLead(candidate, signAdmin);
    const before = summarizeLead(fetched.lead);
    const catalogName = await getAgentName(candidate.agentId, signAdmin);
    const alreadyFilled = before.receiver_agent_name_snapshot.length > 0;
    const agentMismatch =
      before.receiver_agent.length > 0 &&
      before.receiver_agent !== candidate.agentId;

    const row: Record<string, unknown> = {
      kind: candidate.kind,
      lead_id: candidate.leadId,
      job_no: candidate.jobNo,
      get_status: fetched.status,
      current_agent: before.receiver_agent || candidate.agentId,
      current_source: before.receiver_agent_source || "granot_username_match",
      current_username:
        before.receiver_agent_source_value || candidate.username,
      current_snapshot: before.receiver_agent_name_snapshot || null,
      catalog_agent_name: catalogName || null,
      skip: alreadyFilled || agentMismatch,
      skip_reason: alreadyFilled
        ? "snapshot_already_set"
        : agentMismatch
          ? "receiver_agent_mismatch"
          : null,
    };

    if (!apply || row.skip) {
      console.log(JSON.stringify(row));
      continue;
    }

    const result = await vantageApi<Envelope>({
      method: "PATCH",
      path: patchPath(candidate.kind, candidate.leadId),
      confirmProductionWrite: true,
      body: {
        receiver_agent: candidate.agentId,
        receiver_agent_source: "granot_username_match",
        receiver_agent_source_value: candidate.username,
      },
    });
    const after = summarizeLead(unwrap(result.data));
    console.log(
      JSON.stringify({
        ...row,
        patch_status: result.status,
        patch_ok: result.ok,
        after_snapshot: after.receiver_agent_name_snapshot || null,
      }),
    );
  }
}

main().catch((error: unknown) => {
  const message = error instanceof Error ? error.message : String(error);
  console.error(JSON.stringify({ ok: false, error: message }));
  process.exit(1);
});
