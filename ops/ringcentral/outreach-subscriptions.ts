/**
 * Sales Outreach Desk RingCentral subscriptions (RINGCENTRAL-CAPTURE §3, FAST-TRACK step 4).
 *
 *   node --env-file=.env --import tsx ops/ringcentral/outreach-subscriptions.ts \
 *     --target=<RingCentral account id> --database=<database> [--purpose=calls|rep_sms|all] [--apply]
 *
 * Dry run by default: lists the plan for each purpose and changes nothing. `--apply`:
 * - `calls`: ensures the app-owned account telephony subscription; replaces it (create with a
 *   verification token, then delete the old one) when it has no stored token or the webhook route has
 *   been refusing its deliveries — RingCentral ignores a token sent on `PUT` (olr CW2, incident
 *   2026-10-06); `PUT`s an owned one whose filters or address drifted (`filter_drift`); creates the
 *   subscription only when no owned `calls` one exists;
 * - `rep_sms`: creates the app-owned message-store subscription with one filter per reviewed
 *   `sales_rep` mailbox, `PUT`s the owned one when filters drifted, replaces it when it has no token
 *   or its deliveries are refused; repairs a blacklisted one (delete + recreate).
 * Idempotent: a second `--apply` plans `noop`. Foreign subscriptions are listed and never touched.
 * The target is named and must match this process (account + database); production applies pass
 * the production-writer guard. Verification tokens and provider bodies are never printed.
 */
import mongoose from "mongoose";
import { connectMongo } from "../../src/db";
import { getMongoDatabaseName } from "../../src/config/domain/runtime";
import { configuredRingCentralAccountId } from "../../src/services/numberActivity/accountIdentity";
import {
  applyAllDirectionSubscriptionPlan,
  applyRepSmsSubscriptionPlan,
  mongoOwnershipStore,
  planAllDirectionSubscription,
  planRepSmsSubscription,
  resolveAllDirectionWebhookAddress,
  ringCentralSubscriptionProvider,
} from "../../src/services/ringcentral/webhook-subscription-lifecycle";
import { listReviewedRepMailboxes } from "../../src/services/ringcentral/repSms/mailboxes";
import { assertProductionWriterMatchesDeployment } from "../lib/production-writer-guard";
import { assertNamedTarget, parseOutreachSubscriptionArgs } from "../lib/ringcentral-outreach-target";

async function main() {
  const args = parseOutreachSubscriptionArgs(process.argv.slice(2));
  assertNamedTarget({
    target: args.target,
    configuredAccountId: configuredRingCentralAccountId(),
    database: args.database,
    resolvedDatabase: getMongoDatabaseName(),
  });
  await connectMongo();
  if (args.apply) await assertProductionWriterMatchesDeployment();
  const provider = ringCentralSubscriptionProvider();
  const store = mongoOwnershipStore();
  const address = resolveAllDirectionWebhookAddress();
  const report: Record<string, unknown> = { mode: args.apply ? "apply" : "dry-run", account: args.target, database: args.database, address };

  if (args.purposes.includes("calls")) {
    const deps = { provider, store, address, requireVerificationToken: true };
    const plan = await planAllDirectionSubscription(deps);
    report.calls = { plan, result: args.apply ? await applyAllDirectionSubscriptionPlan(plan, deps) : null };
  }
  if (args.purposes.includes("rep_sms")) {
    const mailboxes = await listReviewedRepMailboxes(new Date(), args.target);
    const deps = { provider, store, address, mailboxes: async () => mailboxes.map((m) => m.extension_id) };
    const plan = await planRepSmsSubscription(deps);
    report.rep_sms = {
      mailboxes: mailboxes.length,
      plan,
      result: args.apply ? await applyRepSmsSubscriptionPlan(plan, deps, { allowCreate: true }) : null,
    };
  }
  // Plans and results carry ids, actions, reasons and filters only; tokens are never part of them.
  console.log(JSON.stringify(report, null, 2));
}

main()
  .catch((error: unknown) => {
    console.error(`Outreach subscription command failed: ${error instanceof Error ? `${error.name}: ${error.message}` : "Error"}`);
    process.exitCode = 1;
  })
  .finally(() => mongoose.disconnect());
