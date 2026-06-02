import { getRequiredEnv } from "../../api/config/domain";
import {
  ringCentralRequest,
  RingCentralApiError,
} from "../../api/services/ringcentral/client";

async function main(): Promise<void> {
  const subscriptionId = getRequiredEnv("RINGCENTRAL_SUBSCRIPTION_ID");
  await ringCentralRequest(
    "DELETE",
    `/restapi/v1.0/subscription/${encodeURIComponent(subscriptionId)}`,
  );

  console.log("RingCentral webhook subscription deleted");
  console.log(`subscriptionId: ${subscriptionId}`);
}

main().catch((error) => {
  if (error instanceof RingCentralApiError) {
    console.error(
      `RingCentral webhook subscription delete failed: ${error.status} ${error.statusText}`,
    );
  } else {
    console.error(
      `RingCentral webhook subscription delete failed: ${
        error instanceof Error ? error.message : String(error)
      }`,
    );
  }
  process.exitCode = 1;
});
