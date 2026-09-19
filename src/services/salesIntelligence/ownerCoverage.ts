import { CSI_JOB_STAGES, csiDataset } from "../../config/domain/salesIntelligence";
import { getContactNumberModel } from "../../models/ContactNumber";
import { getRepIdentityLinkModel } from "../../models/RepIdentityLink";
import { getRingCentralDirectorySnapshotModel } from "../../models/RingCentralDirectorySnapshot";
import { getSalesIntelligenceAiBudgetModel } from "../../models/SalesIntelligenceAiBudget";
import { getSalesIntelligenceJobModel } from "../../models/SalesIntelligenceJob";
import { readCaptureCoverage } from "../numberActivity/coverage";
import {
  ownerCoverageDtoSchema,
  ownerCoverageStageSchema,
  type OwnerCoverageDto,
} from "./dto";
import { readCsiSettings } from "./settings";

type JobStage = (typeof CSI_JOB_STAGES)[number];
const RECORDING_STAGES: readonly JobStage[] = ["recording_discovery", "media", "media_fetch"];
const QUEUED = ["pending", "retry", "leased"] as const;
const BACKFILL_NOTE =
  "Historical backfill is Owner-triggered, range-limited, and not yet available. It is lower priority than current work.";

export function composeBudget(
  row: {
    month: string;
    ceiling_cents: number;
    actual_cents: number;
    reserved_cents: number;
  } | null,
  ceilingFromPolicy: number,
) {
  if (!row) {
    return {
      status: "unknown" as const,
      month: null,
      ceiling_cents: ceilingFromPolicy,
      actual_cents: null,
      reserved_cents: null,
      remaining_cents: null,
    };
  }
  return {
    status: "known" as const,
    month: row.month,
    ceiling_cents: row.ceiling_cents,
    actual_cents: row.actual_cents,
    reserved_cents: row.reserved_cents,
    remaining_cents: Math.max(0, row.ceiling_cents - row.actual_cents - row.reserved_cents),
  };
}

export function composeStage(
  counts: { pending: number; leased: number; retry: number; paused: number; dead_letter: number },
  oldest: Date | null,
) {
  return ownerCoverageStageSchema.parse({
    ...counts,
    oldest_queued_at: oldest ? oldest.toISOString() : null,
  });
}

async function readStage(stages: readonly JobStage[]) {
  const Job = getSalesIntelligenceJobModel();
  const filter = { ...csiDataset(), stage: { $in: stages } };
  const [pending, leased, retry, paused, dead_letter, oldest] = await Promise.all([
    Job.countDocuments({ ...filter, status: "pending" }),
    Job.countDocuments({ ...filter, status: "leased" }),
    Job.countDocuments({ ...filter, status: "retry" }),
    Job.countDocuments({ ...filter, status: "paused" }),
    Job.countDocuments({ ...filter, status: "dead_letter" }),
    Job.findOne({ ...filter, status: { $in: QUEUED } }, { next_attempt_at: 1 })
      .sort({ next_attempt_at: 1 })
      .lean(),
  ]);
  return composeStage(
    { pending, leased, retry, paused, dead_letter },
    oldest?.next_attempt_at ?? null,
  );
}

async function readMappingHygiene() {
  const snapshot = await getRingCentralDirectorySnapshotModel()
    .findOne({}, { taken_at: 1, provider_account_id: 1, extensions: 1 })
    .sort({ taken_at: -1 })
    .lean();
  const unmapped_inbound_numbers = await getContactNumberModel().countDocuments({
    kind: "external",
    classification: { $in: ["customer", "unknown"] },
    "rollups.attached_lead_count": 0,
  });
  if (!snapshot) {
    return {
      unmapped_inbound_numbers,
      unmapped_directory_users: null,
      last_directory_sync_at: null,
      directory_status: "missing" as const,
    };
  }
  const users = (snapshot.extensions ?? []).filter((row) => row.type === "User");
  const reviewed = await getRepIdentityLinkModel().find(
    { rc_account_id: snapshot.provider_account_id, status: "reviewed", effective_to: null },
    { rc_extension_id: 1 },
  ).lean();
  const linked = new Set(reviewed.map((row) => row.rc_extension_id));
  return {
    unmapped_inbound_numbers,
    unmapped_directory_users: users.filter((row) => !linked.has(row.id)).length,
    last_directory_sync_at: snapshot.taken_at.toISOString(),
    directory_status: "stored" as const,
  };
}

export async function readOwnerCoverage(): Promise<OwnerCoverageDto> {
  const capture = await readCaptureCoverage();
  const settings = await readCsiSettings();
  const now = new Date();
  const budgetRow = await getSalesIntelligenceAiBudgetModel()
    .findOne({ period_start: { $lte: now }, period_end: { $gt: now } })
    .sort({ period_start: -1 })
    .lean();
  const [recording, transcription, analysis, application, mapping] = await Promise.all([
    readStage(RECORDING_STAGES),
    readStage(["transcription"]),
    readStage(["analysis"]),
    readStage(["application"]),
    readMappingHygiene(),
  ]);
  return ownerCoverageDtoSchema.parse({
    ...capture,
    stages: { recording, transcription, analysis, application },
    budget: composeBudget(budgetRow, settings.policy.monthly_ceiling_cents),
    mapping_hygiene: mapping,
    flags: settings.flags,
    models: settings.models,
    settings: {
      persisted: settings.persisted,
      revision: settings.revision,
      version: settings.policy.version,
      source: settings.source,
      timezone: settings.policy.timezone,
      first_action_due_staffed_minutes: settings.policy.first_action_due_staffed_minutes,
      missed_callback_due_staffed_minutes: settings.policy.missed_callback_due_staffed_minutes,
      going_cold_staffed_minutes: settings.policy.going_cold_staffed_minutes,
      monthly_ceiling_cents: settings.policy.monthly_ceiling_cents,
    },
    backfill: { available: false, owner_triggered: true, note: BACKFILL_NOTE },
  });
}
