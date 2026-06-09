import type { Twilio } from "twilio";
import {
  createTwilioClient,
  formatTwilioError,
  resolveCredentials,
  type TwilioCredentials,
} from "./twilio-client";

type ProbeResult = {
  ok: boolean;
  detail: string;
};

const EXPECTED_BRAND_SID =
  process.env.TWILIO_A2P_BRAND_SID?.trim() ??
  "BNe5f43b09b27008ecdfb0311a673c830f";

const EXPECTED_BRAND_NAME =
  process.env.TWILIO_A2P_BRAND_NAME?.trim() ?? "Vantage Movers LLC";

async function main(): Promise<void> {
  const summary = {
    credentialsPresent: false,
    authMode: "none" as "api-key" | "auth-token" | "none",
    authSucceeded: false,
    accountSid: "",
    accountFriendlyName: "",
    accountStatus: "",
    phoneNumberCount: 0,
    messagingServiceCount: 0,
    brandRegistrationFound: false,
    brandStatus: "",
    brandType: "",
    expectedBrandMatches: false,
    campaignCount: 0,
    approvedCampaignCount: 0,
    readyForMessaging: false,
  };

  let credentials: TwilioCredentials;
  try {
    credentials = resolveCredentials();
    summary.credentialsPresent = true;
    summary.accountSid = credentials.accountSid;
    summary.authMode = credentials.mode;
  } catch (error) {
    printSummary(summary);
    console.error(formatError(error));
    process.exitCode = 1;
    return;
  }

  const client = createTwilioClient(credentials);
  const accountResult = await probeAccount(client, credentials.accountSid);
  summary.authSucceeded = accountResult.ok;
  if (accountResult.ok && accountResult.data) {
    summary.accountFriendlyName = valueToString(accountResult.data.friendlyName) ?? "";
    summary.accountStatus = valueToString(accountResult.data.status) ?? "";
  } else if (!accountResult.ok) {
    printSummary(summary);
    console.error(`Twilio auth/account probe failed: ${accountResult.detail}`);
    if (accountResult.detail.includes("20003")) {
      console.error(
        "Hint: error 20003 usually means the API key secret is wrong, the key was revoked, or the key does not belong to TWILIO_ACCOUNT_SID. You can also set TWILIO_AUTH_TOKEN for a local auth-token fallback.",
      );
    }
    process.exitCode = 1;
    return;
  }

  const phoneNumbersResult = await probePhoneNumbers(client);
  if (phoneNumbersResult.ok) {
    summary.phoneNumberCount = phoneNumbersResult.data?.length ?? 0;
  }

  const messagingServicesResult = await probeMessagingServices(client);
  if (messagingServicesResult.ok) {
    summary.messagingServiceCount = messagingServicesResult.data?.length ?? 0;
  }

  const brandResult = await probeBrandRegistration(client);
  summary.brandRegistrationFound = brandResult.ok;
  if (brandResult.ok && brandResult.data) {
    summary.brandStatus = valueToString(brandResult.data.status) ?? "";
    summary.brandType = valueToString(brandResult.data.brandType) ?? "";
    summary.expectedBrandMatches = brandResult.data.sid === EXPECTED_BRAND_SID;
  }

  const campaignsResult = await probeA2pCampaigns(client);
  if (campaignsResult.ok && campaignsResult.data) {
    summary.campaignCount = campaignsResult.data.total;
    summary.approvedCampaignCount = campaignsResult.data.approved;
  }

  summary.readyForMessaging =
    summary.authSucceeded &&
    summary.brandRegistrationFound &&
    summary.brandStatus.toLowerCase() === "approved" &&
    summary.approvedCampaignCount > 0 &&
    summary.phoneNumberCount > 0;

  printSummary(summary);

  if (!summary.authSucceeded) {
    process.exitCode = 1;
  }
}

async function probeAccount(
  client: Twilio,
  accountSid: string,
): Promise<ProbeResult & { data?: { friendlyName?: string; status?: string } }> {
  try {
    const account = await client.api.accounts(accountSid).fetch();
    console.log("account fetch: success");
    return {
      ok: true,
      detail: "Account fetched successfully.",
      data: {
        friendlyName: account.friendlyName,
        status: account.status,
      },
    };
  } catch (error) {
    console.log(`account fetch: failed (${formatTwilioError(error)})`);
    return { ok: false, detail: formatTwilioError(error) };
  }
}

async function probePhoneNumbers(
  client: Twilio,
): Promise<ProbeResult & { data?: Array<{ sid: string; phoneNumber: string }> }> {
  try {
    const numbers = await client.incomingPhoneNumbers.list({ limit: 20 });
    console.log(`phone numbers: success (${numbers.length} found)`);
    for (const number of numbers.slice(0, 5)) {
      console.log(`  - ${number.phoneNumber} (${number.friendlyName ?? "no label"})`);
    }
    if (numbers.length > 5) {
      console.log(`  ... and ${numbers.length - 5} more`);
    }
    return {
      ok: true,
      detail: `Listed ${numbers.length} phone number(s).`,
      data: numbers.map((number) => ({
        sid: number.sid,
        phoneNumber: number.phoneNumber,
      })),
    };
  } catch (error) {
    console.log(`phone numbers: failed (${formatTwilioError(error)})`);
    return { ok: false, detail: formatTwilioError(error) };
  }
}

async function probeMessagingServices(
  client: Twilio,
): Promise<ProbeResult & { data?: Array<{ sid: string; friendlyName: string }> }> {
  try {
    const services = await client.messaging.v1.services.list({ limit: 20 });
    console.log(`messaging services: success (${services.length} found)`);
    for (const service of services) {
      console.log(`  - ${service.friendlyName} (${service.sid})`);
    }
    return {
      ok: true,
      detail: `Listed ${services.length} messaging service(s).`,
      data: services.map((service) => ({
        sid: service.sid,
        friendlyName: service.friendlyName,
      })),
    };
  } catch (error) {
    console.log(`messaging services: failed (${formatTwilioError(error)})`);
    return { ok: false, detail: formatTwilioError(error) };
  }
}

async function probeBrandRegistration(
  client: Twilio,
): Promise<
  ProbeResult & {
    data?: {
      sid: string;
      status: string;
      brandType: string;
      tcrId: string;
    };
  }
> {
  try {
    const brand = await client.messaging.v1
      .brandRegistrations(EXPECTED_BRAND_SID)
      .fetch();

    console.log("A2P brand registration: success");
    console.log(`  - sid: ${brand.sid}`);
    console.log(`  - status: ${brand.status}`);
    console.log(`  - brand type: ${brand.brandType}`);
    console.log(`  - TCR brand id: ${brand.tcrId || "n/a"}`);

    return {
      ok: true,
      detail: "Brand registration fetched successfully.",
      data: {
        sid: brand.sid,
        status: brand.status,
        brandType: brand.brandType,
        tcrId: brand.tcrId,
      },
    };
  } catch (error) {
    console.log(`A2P brand registration: failed (${formatTwilioError(error)})`);
    return { ok: false, detail: formatTwilioError(error) };
  }
}

async function probeA2pCampaigns(
  client: Twilio,
): Promise<ProbeResult & { data?: { total: number; approved: number } }> {
  try {
    const services = await client.messaging.v1.services.list({ limit: 20 });
    let total = 0;
    let approved = 0;

    for (const service of services) {
      const campaigns = await client.messaging.v1
        .services(service.sid)
        .usAppToPerson.list({ limit: 20 });

      for (const campaign of campaigns) {
        total += 1;
        const status = (campaign.campaignStatus ?? "").toLowerCase();
        if (status === "verified" || status === "approved") {
          approved += 1;
        }
        console.log(
          `A2P campaign: ${campaign.campaignId ?? campaign.sid} [${campaign.campaignStatus}] via ${service.friendlyName}`,
        );
      }
    }

    if (total === 0) {
      console.log("A2P campaigns: none found on messaging services");
    } else {
      console.log(`A2P campaigns: ${approved}/${total} approved or verified`);
    }

    return {
      ok: true,
      detail: `Found ${total} campaign(s), ${approved} approved/verified.`,
      data: { total, approved },
    };
  } catch (error) {
    console.log(`A2P campaigns: failed (${formatTwilioError(error)})`);
    return { ok: false, detail: formatTwilioError(error) };
  }
}

function printSummary(summary: {
  credentialsPresent: boolean;
  authMode: "api-key" | "auth-token" | "none";
  authSucceeded: boolean;
  accountSid: string;
  accountFriendlyName: string;
  accountStatus: string;
  phoneNumberCount: number;
  messagingServiceCount: number;
  brandRegistrationFound: boolean;
  brandStatus: string;
  brandType: string;
  expectedBrandMatches: boolean;
  campaignCount: number;
  approvedCampaignCount: number;
  readyForMessaging: boolean;
}): void {
  console.log("");
  console.log("Twilio diagnostic summary");
  console.log(`Credentials present: ${yesNo(summary.credentialsPresent)}`);
  console.log(`Auth mode: ${summary.authMode}`);
  console.log(`Auth succeeded: ${yesNo(summary.authSucceeded)}`);
  console.log(`Account SID: ${summary.accountSid}`);
  console.log(`Account name: ${summary.accountFriendlyName}`);
  console.log(`Account status: ${summary.accountStatus}`);
  console.log(`Phone numbers found: ${summary.phoneNumberCount}`);
  console.log(`Messaging services found: ${summary.messagingServiceCount}`);
  console.log(`A2P brand found: ${yesNo(summary.brandRegistrationFound)}`);
  console.log(`A2P brand status: ${summary.brandStatus || "n/a"}`);
  console.log(`A2P brand type: ${summary.brandType || "n/a"}`);
  console.log(
    `Expected brand (${EXPECTED_BRAND_NAME} / ${EXPECTED_BRAND_SID}): ${yesNo(
      summary.expectedBrandMatches,
    )}`,
  );
  console.log(`A2P campaigns found: ${summary.campaignCount}`);
  console.log(`A2P campaigns approved/verified: ${summary.approvedCampaignCount}`);
  console.log(`Ready for US A2P messaging: ${yesNo(summary.readyForMessaging)}`);
}

function yesNo(value: boolean): "yes" | "no" {
  return value ? "yes" : "no";
}

function valueToString(value: unknown): string | undefined {
  if (typeof value === "string") {
    return value;
  }
  if (typeof value === "number") {
    return String(value);
  }
  return undefined;
}

function formatError(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

main().catch((error) => {
  console.error(formatError(error));
  process.exitCode = 1;
});
