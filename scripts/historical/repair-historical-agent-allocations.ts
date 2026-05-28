import mongoose from "mongoose";
import { connectMongo } from "../../api/db";
import {
  normalizeHistoricalAgentName,
  splitBinderAmountEvenly,
  splitHistoricalAgentNames,
} from "./historical-agent-allocation";
import { registerHistoricalModels } from "./models";

type HistoricalModels = ReturnType<typeof registerHistoricalModels>;

type BookedLeadRepairDoc = {
  _id: mongoose.Types.ObjectId;
  raw_row?: Record<string, unknown>;
  total_binder_amount?: number;
  agent_allocations?: Array<{
    agent?: mongoose.Types.ObjectId;
    agent_name_snapshot?: string;
    binder_amount?: number;
  }>;
};

function parseMoney(value: unknown): number | undefined {
  if (typeof value !== "string") return undefined;

  const numeric = Number(value.replace(/[^0-9.-]/g, ""));
  return Number.isFinite(numeric) ? numeric : undefined;
}

function getSourceAgentName(booked: BookedLeadRepairDoc): string {
  const rawAgent = booked.raw_row?.Agent;
  if (typeof rawAgent === "string" && rawAgent.trim()) return rawAgent;

  const allocationSnapshot = booked.agent_allocations?.find((allocation) =>
    allocation.agent_name_snapshot?.includes("/"),
  )?.agent_name_snapshot;

  return allocationSnapshot ?? "";
}

function getTotalBinderAmount(booked: BookedLeadRepairDoc): number | undefined {
  if (
    typeof booked.total_binder_amount === "number" &&
    Number.isFinite(booked.total_binder_amount)
  ) {
    return booked.total_binder_amount;
  }

  const rawBinderAmount = parseMoney(booked.raw_row?.["Binder Amount"]);
  if (rawBinderAmount !== undefined) return rawBinderAmount;

  const allocationBinderAmount = booked.agent_allocations?.find(
    (allocation) =>
      typeof allocation.binder_amount === "number" &&
      Number.isFinite(allocation.binder_amount),
  )?.binder_amount;

  return allocationBinderAmount;
}

function sameOptionalMoney(
  actual: number | undefined,
  expected: number | undefined,
): boolean {
  if (actual === undefined || expected === undefined) {
    return actual === expected;
  }

  return Math.abs(actual - expected) < 0.001;
}

function allocationsAlreadyMatch(
  booked: BookedLeadRepairDoc,
  agentNames: string[],
  totalBinderAmount: number | undefined,
): boolean {
  const allocations = booked.agent_allocations ?? [];
  if (allocations.length !== agentNames.length) return false;

  const binderAmounts = splitBinderAmountEvenly(
    totalBinderAmount,
    agentNames.length,
  );

  return allocations.every((allocation, index) => {
    return (
      allocation.agent_name_snapshot === agentNames[index] &&
      sameOptionalMoney(allocation.binder_amount, binderAmounts[index])
    );
  });
}

async function ensureAgent(
  models: HistoricalModels,
  rawName: string,
  repairBatchId: string,
) {
  const normalizedName = normalizeHistoricalAgentName(rawName);
  if (!normalizedName) return undefined;

  const existing = await models.Agent.findOne({
    normalized_name: normalizedName,
  });
  if (existing) return existing;

  return models.Agent.create({
    name: rawName.trim(),
    normalized_name: normalizedName,
    created_from: `historical_agent_allocation_repair:${repairBatchId}`,
  });
}

async function buildAgentAllocations(
  models: HistoricalModels,
  rawName: string,
  totalBinderAmount: number | undefined,
  repairBatchId: string,
) {
  const agentNames = splitHistoricalAgentNames(rawName);
  const binderAmounts = splitBinderAmountEvenly(
    totalBinderAmount,
    agentNames.length,
  );

  const allocations: Array<{
    agent: mongoose.Types.ObjectId;
    agent_name_snapshot: string;
    binder_amount: number | undefined;
  }> = [];
  for (let index = 0; index < agentNames.length; index++) {
    const agentName = agentNames[index];
    const agent = await ensureAgent(models, agentName, repairBatchId);
    if (!agent) continue;

    allocations.push({
      agent: agent._id,
      agent_name_snapshot: agentName,
      binder_amount: binderAmounts[index],
    });
  }

  return allocations;
}

async function removeUnreferencedCompositeAgents(
  models: HistoricalModels,
  dryRun: boolean,
): Promise<number> {
  const compositeAgents = await models.Agent.find({
    $or: [{ name: /\// }, { normalized_name: /\// }],
  }).select("_id name normalized_name");

  let removed = 0;

  for (const agent of compositeAgents) {
    const references = await models.BookedLead.countDocuments({
      "agent_allocations.agent": agent._id,
    });

    if (references > 0) continue;

    removed++;
    if (!dryRun) {
      await models.Agent.deleteOne({ _id: agent._id });
    }
  }

  return removed;
}

async function main(): Promise<void> {
  const repairBatchId = new Date().toISOString();
  const dryRun =
    process.env.HISTORICAL_AGENT_REPAIR_DRY_RUN?.trim().toLowerCase() === "true";

  await connectMongo();
  const models = registerHistoricalModels();

  const bookedLeads = await models.BookedLead.find({
    $or: [
      { "raw_row.Agent": /\// },
      { "agent_allocations.agent_name_snapshot": /\// },
    ],
  })
    .select("_id raw_row total_binder_amount agent_allocations")
    .lean<BookedLeadRepairDoc[]>();

  let scanned = 0;
  let repaired = 0;
  let skipped = 0;

  for (const booked of bookedLeads) {
    scanned++;

    const sourceAgentName = getSourceAgentName(booked);
    const agentNames = splitHistoricalAgentNames(sourceAgentName);
    if (agentNames.length <= 1) {
      skipped++;
      continue;
    }

    const totalBinderAmount = getTotalBinderAmount(booked);
    if (allocationsAlreadyMatch(booked, agentNames, totalBinderAmount)) {
      skipped++;
      continue;
    }

    repaired++;
    if (dryRun) continue;

    const agentAllocations = await buildAgentAllocations(
      models,
      sourceAgentName,
      totalBinderAmount,
      repairBatchId,
    );

    await models.BookedLead.updateOne(
      { _id: booked._id },
      {
        $set: {
          agent_allocations: agentAllocations,
          total_binder_amount: totalBinderAmount,
        },
      },
      { runValidators: true },
    );
  }

  const removedCompositeAgents = await removeUnreferencedCompositeAgents(
    models,
    dryRun,
  );

  console.log(
    JSON.stringify(
      {
        dry_run: dryRun,
        repair_batch_id: repairBatchId,
        booked_leads: {
          scanned,
          repaired,
          skipped,
        },
        composite_agents_removed: removedCompositeAgents,
      },
      null,
      2,
    ),
  );
}

main()
  .catch((err) => {
    console.error(err);
    process.exitCode = 1;
  })
  .finally(async () => {
    await mongoose.disconnect();
  });
