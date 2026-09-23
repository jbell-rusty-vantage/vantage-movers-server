/**
 * Review RingCentral user Joshua L (extension 220, account 62948571023) as the Josh Agent.
 * Sending a directory-only pager does not require this link. The Owner identified this User as Josh.
 *
 * Report only:
 *   node --env-file=.env --import tsx scripts/dev_ops/backfill-joshua-l-josh-agent.ts --allow-production
 *
 * Write, through the reviewed Rep Identity command:
 *   node --env-file=.env --import tsx scripts/dev_ops/backfill-joshua-l-josh-agent.ts --allow-production --confirm-write
 *
 * Does not print direct numbers. Enables Sales Intelligence in this process only so the command can run.
 */
import mongoose from "mongoose";
import { connectMongo } from "../../src/db";
import { getMongoDatabaseName } from "../../src/config/domain/runtime";
import { Agent } from "../../src/models/Agent";
import { getRepIdentityLinkModel } from "../../src/models/RepIdentityLink";
import { getRingCentralDirectorySnapshotModel } from "../../src/models/RingCentralDirectorySnapshot";
import { CsiError, csiOperatorActor } from "../../src/services/salesIntelligence/auth";
import { createRepLink, reviewRepLink } from "../../src/services/salesIntelligence/repIdentity/commands";

const ACCOUNT = "62948571023";
const EXTENSION_NUMBER = "220";
const DIRECTORY_NAME = "joshua l";
const AGENT_NAME = "josh";

const nameKey = (value: string) => value.normalize("NFKC").trim().toLowerCase().replace(/\s+/g, " ");

function localDatabase(database: string, uri: string | undefined) {
  return /^testvantagemovers_[a-z0-9]+$/i.test(database) && /^mongodb:\/\/(127\.0\.0\.1|localhost)(:\d+)?\//.test(uri ?? "");
}

async function main() {
  const allowProduction = process.argv.includes("--allow-production");
  const confirm = process.argv.includes("--confirm-write");
  await connectMongo();
  const database = getMongoDatabaseName();
  if (!localDatabase(database, process.env.MONGO_URI) && !allowProduction) {
    throw new Error("the database is not a local testvantagemovers_* one; pass --allow-production to proceed");
  }

  const snapshot = await getRingCentralDirectorySnapshotModel().findOne({ provider_account_id: ACCOUNT }).sort({ taken_at: -1, _id: -1 }).lean();
  const matches = (snapshot?.extensions ?? []).filter(extension =>
    extension.type === "User" && extension.extension_number === EXTENSION_NUMBER && nameKey(extension.name ?? "") === DIRECTORY_NAME);
  const agents = await Agent.find({ active: true, normalized_name: AGENT_NAME }).select({ name: 1, normalized_name: 1 }).lean();
  const openLinks = matches.length === 1
    ? await getRepIdentityLinkModel().find({ rc_account_id: ACCOUNT, rc_extension_id: matches[0]!.id, effective_to: null }).lean()
    : [];

  const report = {
    mode: confirm ? "apply" : "dry_run",
    database,
    directory_status: !snapshot ? "missing" : "stored",
    snapshot_id: snapshot ? String(snapshot._id) : null,
    taken_at: snapshot?.taken_at.toISOString() ?? null,
    joshua: matches.map(extension => ({
      extension_id: extension.id,
      extension_number: extension.extension_number,
      name: extension.name,
      status: extension.status,
      direct_number_count: extension.direct_numbers.length,
    })),
    josh_agents: agents.map(agent => ({ id: String(agent._id), name: agent.name })),
    open_links: openLinks.map(link => ({
      id: String(link._id),
      revision: link.revision,
      status: link.status,
      agent_id: String(link.agent_id),
      agent_name: link.agent_name_snapshot,
      effective_from: link.effective_from.toISOString(),
    })),
  };
  console.log(JSON.stringify(report));

  if (matches.length !== 1 || matches[0]!.status !== "Enabled") throw new Error("expected one Enabled Joshua L on extension 220");
  if (agents.length !== 1) throw new Error("expected one active Agent named Josh");
  if (!snapshot || snapshot.counts.extensions !== snapshot.extensions.length) throw new Error("directory snapshot is incomplete");
  const user = matches[0]!;
  const josh = agents[0]!;
  const open = openLinks.filter(link => link.status !== "retired");
  if (open.length > 1) throw new Error("more than one open Rep Identity link");
  const current = open[0] ?? null;
  if (current?.status === "reviewed" && String(current.agent_id) === String(josh._id)) {
    console.log(JSON.stringify({ result: "already_reviewed", link_id: String(current._id) }));
    return;
  }
  if (current?.status === "reviewed") throw new Error("extension 220 is already reviewed to a different Agent");
  if (!confirm) return;

  process.env.SALES_INTELLIGENCE_ENABLED = "true";
  const actor = csiOperatorActor("backfill-joshua-l-josh-2026-09-23");
  const channels = user.direct_numbers.length === 1 ? ["pager", "sms_to_rep"] as const : ["pager"] as const;
  const effectiveFrom = (current?.effective_from ?? snapshot.taken_at).toISOString();
  const linkBody = {
    agent_id: String(josh._id),
    rc_account_id: ACCOUNT,
    rc_extension_id: user.id,
    role_kind: "sales_rep" as const,
    effective_from: effectiveFrom,
    effective_to: null,
    nudge_channels_allowed: [...channels],
  };

  let linkId = current ? String(current._id) : "";
  let revision = current?.revision ?? 1;
  if (!current) {
    const created = await createRepLink({
      actor,
      idempotency_key: "backfill-joshua-l-josh-create-220",
      body: { expected_revision: 1, link: linkBody, reason: "Owner identified Joshua L extension 220 as the Josh Agent." },
    });
    linkId = created.response.link.id;
    revision = created.response.link.revision;
  }
  const reviewed = await reviewRepLink({
    actor,
    id: linkId,
    idempotency_key: "backfill-joshua-l-josh-review-220",
    body: {
      expected_revision: revision,
      status: "reviewed",
      link: linkBody,
      reason: "Owner identified Joshua L extension 220 as the Josh Agent.",
    },
  });
  console.log(JSON.stringify({
    result: reviewed.replayed ? "replayed" : "reviewed",
    link_id: reviewed.response.link.id,
    status: reviewed.response.link.status,
    agent_name: reviewed.response.link.agent_name,
    extension_id: reviewed.response.link.rc_extension_id,
    channels: reviewed.response.link.nudge_channels_allowed,
    reevaluation_job_id: reviewed.response.reevaluation_job_id,
  }));
}

main().catch(error => {
  console.error(JSON.stringify({ stopped: true, error: error instanceof CsiError ? error.code : error instanceof Error ? error.message.slice(0, 200) : "setup_failed" }));
  process.exitCode = 1;
}).finally(() => mongoose.disconnect());
