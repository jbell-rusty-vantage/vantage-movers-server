const PRODUCTION_BASE_URL =
  process.env.PRODUCTION_BASE_URL?.trim() ||
  "https://vantage-movers-main-server.vercel.app";

const SOURCE_COMPANY = "best_relocation_leads";

const PHONE_NUMBERS = [
  "2405504455",
  "4358812066",
  "520 309-5990",
  "3213311951",
];

type ApiEnvelope<T> =
  | { ok: true; data: T }
  | { ok: false; error?: string; issues?: unknown };

type CallLeadResponse = {
  _id?: string;
  id?: string;
  phone_number?: string;
  normalized_phone_number?: string;
  source_company?: string;
};

async function main() {
  const apiSecret = process.env.VANTAGE_API_SECRET?.trim();
  if (!apiSecret) {
    throw new Error("Missing VANTAGE_API_SECRET in environment.");
  }

  const baseUrl = PRODUCTION_BASE_URL.replace(/\/$/, "");
  const url = `${baseUrl}/api/v1/call-leads`;

  console.log(`Creating ${PHONE_NUMBERS.length} call lead(s) at ${baseUrl}`);

  for (const rawPhone of PHONE_NUMBERS) {
    const phoneNumber = digitsOnly(rawPhone);
    if (!phoneNumber) {
      throw new Error(`Invalid phone number: ${rawPhone}`);
    }

    const response = await fetch(url, {
      method: "POST",
      headers: {
        Accept: "application/json",
        "Content-Type": "application/json",
        "x-api-secret": apiSecret,
      },
      body: JSON.stringify({
        phone_number: phoneNumber,
        source_company: SOURCE_COMPANY,
      }),
    });

    const envelope = await parseJson<ApiEnvelope<CallLeadResponse>>(response);
    if (!response.ok || !envelope.ok) {
      throw new Error(
        `Failed to create call lead ${phoneNumber}: ${response.status} ${JSON.stringify(envelope)}`,
      );
    }

    console.log(
      [
        `Created ${phoneNumber}`,
        `id=${envelope.data._id ?? envelope.data.id ?? "unknown"}`,
        `source=${envelope.data.source_company ?? SOURCE_COMPANY}`,
      ].join(" "),
    );
  }
}

function digitsOnly(value: string): string {
  return value.replace(/\D/g, "");
}

async function parseJson<T>(response: Response): Promise<T> {
  const text = await response.text();
  try {
    return JSON.parse(text) as T;
  } catch {
    throw new Error(`Expected JSON response but received: ${text}`);
  }
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
