import { QueueClient } from "@vercel/queue";
import { runBestRelocationIngestionWorker } from "../../src/services/ingestion/worker";

/** Delayed deliveries are acknowledged; the retired worker performs no reads or writes. */
const queue = new QueueClient();
export default queue.handleNodeCallback(async () => { await runBestRelocationIngestionWorker(); });
