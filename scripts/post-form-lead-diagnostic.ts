/**
 * POST a form lead and print sheet_sync after background sync.
 * Requires MONGO_DNS_SERVERS in .env (see api/db.ts) and a running local API.
 *
 * Usage:
 *   node --env-file=.env ./node_modules/tsx/dist/cli.mjs scripts/post-form-lead-diagnostic.ts
 *   LOCAL_BASE_URL=http://127.0.0.1:3001 node --env-file=.env ...
 */
import { connectMongo } from "../api/db";
import { FormLead } from "../api/models/FormLead";

const secret = process.env.VANTAGE_API_SECRET?.trim();
if (!secret) {
  console.error("Missing VANTAGE_API_SECRET");
  process.exit(1);
}

const base =
  process.env.API_BASE_URL?.trim() ||
  process.env.LOCAL_BASE_URL?.trim() ||
  "http://127.0.0.1:3000";

const body = {
  source_company: "tbm_leads",
  name: "Sheet Sync Diagnostic",
  source_company_site: "https://10bestmovingcompanies.com",
  pickup_zip: "10001",
  destination_zip: "90210",
  move_size: "2 Bedrooms",
  ref_no: `diag-${Date.now()}`,
  phone_number: "2145550199",
  post_to_granot: false,
};

async function readJson(res: Response): Promise<unknown> {
  const text = await res.text();
  if (!text.trim()) {
    throw new Error(`Empty response body (HTTP ${res.status})`);
  }
  return JSON.parse(text) as unknown;
}

async function main() {
  const createRes = await fetch(`${base.replace(/\/$/, "")}/api/v1/form-leads`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-api-secret": secret,
    },
    body: JSON.stringify(body),
  });
  const createJson = (await readJson(createRes)) as {
    ok?: boolean;
    data?: { lead?: { _id?: string }; sheet_sync_status?: string };
  };

  console.log("CREATE", createRes.status, JSON.stringify(createJson, null, 2));

  const leadId = createJson.data?.lead?._id;
  if (!leadId) {
    process.exit(1);
  }

  await new Promise((resolve) => setTimeout(resolve, 5000));

  await connectMongo();
  const lead = await FormLead.findById(leadId).select("sheet_sync lid ref_no source_company");
  console.log(
    "SHEET_SYNC",
    JSON.stringify(
      {
        leadId,
        lid: lead?.lid,
        ref_no: lead?.ref_no,
        source_company: lead?.source_company,
        sheet_sync: lead?.sheet_sync ?? [],
      },
      null,
      2,
    ),
  );
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
