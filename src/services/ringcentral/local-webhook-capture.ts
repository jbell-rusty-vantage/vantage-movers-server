import { promises as fs } from "node:fs";
import path from "node:path";

/**
 * Local-only RingCentral webhook capture.
 *
 * This is a developer convenience for inspecting raw RingCentral telephony
 * notifications over an ngrok tunnel WITHOUT touching the production webhook
 * pipeline (no candidate/session/lead processing, no Mongo writes). The
 * matching route appends every received notification to a gitignored JSONL
 * file so you can tail/inspect it locally.
 *
 * The route path constant is shared with `ringcentral-webhook-create-local.ts`
 * so the subscription address and the Express route never drift apart.
 */
export const RINGCENTRAL_LOCAL_WEBHOOK_ROUTE = "/api/webhooks/ringcentral-local";

/** Gitignored capture file, written to the process working directory. */
export const LOCAL_WEBHOOK_EVENTS_FILE = "ringcentral-local-webhook-events.jsonl";

export type LocalRingCentralWebhookEvent = {
  receivedAt: string;
  validationTokenPresent: boolean;
  headers: Record<string, string | string[] | undefined>;
  payload: unknown;
};

/**
 * Appends one captured event as a JSON line to the gitignored capture file.
 * Returns the absolute path written to. Never used in production (the local
 * subscription points an ngrok tunnel at this route only when a developer runs
 * `pnpm ringcentral:webhook:create:local`).
 */
export async function appendLocalRingCentralWebhookEvent(
  event: LocalRingCentralWebhookEvent,
): Promise<string> {
  const filePath = path.resolve(process.cwd(), LOCAL_WEBHOOK_EVENTS_FILE);
  await fs.appendFile(filePath, `${JSON.stringify(event)}\n`, { encoding: "utf8" });
  return filePath;
}
