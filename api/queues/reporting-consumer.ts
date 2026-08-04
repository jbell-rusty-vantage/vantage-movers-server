import { QueueClient } from "@vercel/queue";
import { isReportingGoogleDeliveryEnabled } from "../../src/config/domain/reporting";
import { logger } from "../../src/logger";
import { registerReportingStage4Foundation } from "../../src/services/reporting/registerStage4Foundation";
import { createReportingDriveAdapter } from "../../src/services/reporting/google/reportingDriveAdapter";
import { createReportingSheetsAdapter } from "../../src/services/reporting/google/reportingSheetsAdapter";
import { runReportingDeliveryWorker } from "../../src/services/reporting/reportingWorker";
import { runReportingCleanupJanitor } from "../../src/services/reporting/cleanup";

const queue = new QueueClient();

export default queue.handleNodeCallback(async (message) => {
  // Queue consumers are separate processes from the Express app bootstrap.
  registerReportingStage4Foundation();
  const runHint =
    typeof message === "object" &&
    message !== null &&
    "run_hint" in message &&
    typeof message.run_hint === "string"
      ? message.run_hint
      : null;
  const deliveryEnabled = isReportingGoogleDeliveryEnabled();
  let result: Awaited<ReturnType<typeof runReportingDeliveryWorker>>;
  let janitor: unknown = { skipped: "delivery_disabled" };
  if (deliveryEnabled) {
    const sheets = await createReportingSheetsAdapter();
    const drive = await createReportingDriveAdapter();
    result = await runReportingDeliveryWorker({ runHint }, { sheets, drive });
    janitor = await runReportingCleanupJanitor({ drive, sheets, limit: 10 });
  } else {
    result = await runReportingDeliveryWorker({ runHint });
  }
  logger.info({
    msg: "reporting.consumer.completed",
    ...result,
    janitor,
  });
});
