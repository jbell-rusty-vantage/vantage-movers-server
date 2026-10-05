/**
 * E01 — read-only proof that this app's JWT user may read and sync the reviewed reps' SMS mailboxes
 * (RINGCENTRAL-CAPTURE §6). Run by the operator against production before
 * `controls.rep_sms_capture_enabled` is turned on:
 *
 *   node --env-file=.env --import tsx ops/ringcentral/prove-rep-sms-access.ts \
 *     --target=<RingCentral account id> --database=<database> [--sent-within-minutes=<1–1440>]
 *
 * For every reviewed `sales_rep` mailbox (rep_identity_links, read only):
 *   1. GET …/extension/{id}/message-store?messageType=SMS&perPage=1   → expect 200 (not 403);
 *   2. GET …/extension/{id}/message-sync?syncType=FSync&recordCount=1 → expect 200 and a syncToken;
 *   3. GET outbound SMS since the start of today in New York (or the given window) → at least one
 *      rep-sent message shows `direction: Outbound` with `messageStatus: Sent` (or Delivered);
 *   4. dry-validates the `rep_sms` subscription body locally. It never creates a subscription.
 *
 * Only GET requests, through the shared rate gate (Light lane). It prints counts and verdicts only —
 * never a token, a phone number, a name or a message body. Exit code 0 = pass, 2 = fail.
 */
import mongoose from "mongoose";
import { connectMongo } from "../../src/db";
import { getMongoDatabaseName } from "../../src/config/domain/runtime";
import { configuredRingCentralAccountId } from "../../src/services/numberActivity/accountIdentity";
import { ringCentralRequest, RingCentralApiError } from "../../src/services/ringcentral/client";
import { resolveAllDirectionWebhookAddress } from "../../src/services/ringcentral/webhook-subscription-lifecycle";
import { listReviewedRepMailboxes } from "../../src/services/ringcentral/repSms/mailboxes";
import { localInstant, businessDateOf } from "../../src/services/salesOutreach/engine/calendar";
import { assertNamedTarget, parseProofArgs } from "../lib/ringcentral-outreach-target";
import {
  dryValidateSubscriptionBody,
  judgeMailbox,
  judgeProof,
  probeEndpoints,
  type ProbeAnswer,
} from "../lib/rep-sms-access-proof";

const TIMEZONE = "America/New_York";

async function probe(endpoint: string): Promise<ProbeAnswer> {
  try {
    return { status: 200, body: await ringCentralRequest("GET", endpoint, undefined, { priority: "high", maxWaitMs: 30_000 }) };
  } catch (error) {
    if (error instanceof RingCentralApiError) return { status: error.status, body: null };
    return { status: "error", error_name: error instanceof Error ? error.name : "Error" };
  }
}

async function main() {
  const now = new Date();
  const args = parseProofArgs(process.argv.slice(2), now);
  assertNamedTarget({
    target: args.target,
    configuredAccountId: configuredRingCentralAccountId(),
    database: args.database,
    resolvedDatabase: getMongoDatabaseName(),
  });
  await connectMongo();
  const sampleSince = args.sampleSince ?? new Date(localInstant(businessDateOf(now.getTime(), TIMEZONE), 0, TIMEZONE));
  const mailboxes = await listReviewedRepMailboxes(now, args.target);
  const verdicts = [];
  for (const mailbox of mailboxes) {
    const endpoints = probeEndpoints(mailbox.extension_id, sampleSince);
    verdicts.push(
      judgeMailbox({
        extension_id: mailbox.extension_id,
        message_store: await probe(endpoints.message_store),
        message_sync: await probe(endpoints.message_sync),
        outbound_sample: await probe(endpoints.outbound_sample),
      }),
    );
  }
  let address = "";
  try {
    address = resolveAllDirectionWebhookAddress();
  } catch {
    address = "(RINGCENTRAL_WEBHOOK_URL not set)";
  }
  const subscription = dryValidateSubscriptionBody(mailboxes.map((m) => m.extension_id), address);
  const verdict = judgeProof(verdicts, subscription);
  console.log(
    JSON.stringify(
      {
        proof: "E01 rep SMS mailbox access (read-only)",
        account: args.target,
        database: args.database,
        sample_since: sampleSince.toISOString(),
        reviewed_mailboxes: mailboxes.length,
        ...verdict,
        subscription_body_preview: { filters: subscription.body.eventFilters.length, expires_in: subscription.body.expiresIn },
      },
      null,
      2,
    ),
  );
  process.exitCode = verdict.verdict === "pass" ? 0 : 2;
}

main()
  .catch((error: unknown) => {
    console.error(`E01 proof failed to run: ${error instanceof Error ? `${error.name}: ${error.message}` : "Error"}`);
    process.exitCode = 1;
  })
  .finally(() => mongoose.disconnect());
