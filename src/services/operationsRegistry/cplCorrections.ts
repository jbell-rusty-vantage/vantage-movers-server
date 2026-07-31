import { createHash, randomUUID } from "node:crypto";
import mongoose, { type ClientSession } from "mongoose";
import { withTransaction } from "../../db";
import {
  type CplCorrectionJobDocument,
  type CplCorrectionJobStatus,
  type CplCorrectionLeadModel,
} from "../../models/CplCorrectionJob";
import { getCplCorrectionJobModel } from "../../models/CplCorrectionJob";
import { CallLead } from "../../models/CallLead";
import { FormLead } from "../../models/FormLead";
import { getLeadSourceGranularityModel } from "../../models/LeadSourceGranularity";
import { CPL_BUSINESS_TIME_ZONE } from "../../models/CplRatePeriod";
import { getCplLeadCorrectionModel } from "../../models/CplLeadCorrection";
import { REGISTRY_ERROR_CODES } from "../errors/registryErrorCodes";
import {
  businessDateToUtc,
  ownerInclusiveEndDateToExclusive,
  resolveCplFromPeriods,
  mongoCplScheduleStore,
  storedLeadTimestampToCplInstant,
  type CplResolution,
} from "./cplSchedule";
import { RegistryError } from "./errors";
import { withRegistryMutation, type RegistryAuditDeps } from "./registryAudit";
import { sanitizeEventDetails } from "../observability/operationalEventSanitizer";
import { recordOperationalEvent } from "../observability";
import type { RegistryActorContext, TransactionRunner } from "./types";
import { isObjectIdString, toObjectId } from "../../utils/objectId";

export const CPL_CORRECTION_RESOLUTION_VERSION =
  "operations-registry-cpl-correction-v1" as const;

export const DEFAULT_CPL_CORRECTION_BATCH_SIZE = 50;
export const DEFAULT_CPL_CORRECTION_LEASE_MS = 60_000;
export const DEFAULT_CPL_CORRECTION_PREVIEW_SAMPLE_LIMIT = 25;
export const MAX_CPL_CORRECTION_PREVIEW_LEADS = 250;

export type CplCorrectionWindowInstantInput = {
  kind: "instant";
  window_from: Date;
  /** Exclusive upper bound for timestamp matching. */
  window_until: Date;
};

export type CplCorrectionWindowBusinessDateInput = {
  kind: "business_date";
  /** Inclusive owner-facing start date (YYYY-MM-DD). */
  window_from_date: string;
  /** Inclusive owner-facing end date (YYYY-MM-DD). */
  window_until_date: string;
};

export type CplCorrectionWindowInput =
  | CplCorrectionWindowInstantInput
  | CplCorrectionWindowBusinessDateInput;

export type CplCorrectionSelectionInput = {
  source_granularity_id: string;
  window: CplCorrectionWindowInput;
  target_schedule_revision: number;
};

export type PreviewCplCorrectionCommand = CplCorrectionSelectionInput;

export type CreateCplCorrectionCommand = CplCorrectionSelectionInput & {
  preview_hash: string;
  confirm: true;
  reason?: string;
};

export type NormalizedCplCorrectionSelection = {
  source_granularity_id: string;
  window_from: Date;
  window_until: Date;
  target_schedule_revision: number;
  max_form_lead_id?: string | null;
  max_call_lead_id?: string | null;
  reviewed_targets?: CplCorrectionLeadRef[];
};

export type CplCorrectionLeadRef = {
  lead_model: CplCorrectionLeadModel;
  lead_id: string;
  source_granularity_id: string;
  timestamp: Date;
  cpl: number;
  cpl_rate_period?: string;
  cpl_resolution_status?: string;
  cpl_resolved_at?: Date;
  cpl_resolution_version?: string;
  duplicate?: boolean;
  cpl_correction?: {
    job_id?: string;
    corrected_at?: Date;
    previous_cpl?: number;
  };
};

export type CplCorrectionPreviewSampleItem = {
  lead_model: CplCorrectionLeadModel;
  lead_id: string;
  timestamp: string;
  current_cpl: number;
  current_resolution_status?: string;
  target_cpl: number;
  target_resolution_status: CplResolution["status"];
  would_change: boolean;
};

export type CplCorrectionPreviewImpact = {
  matched_count: number;
  form_lead_count: number;
  call_lead_count: number;
  would_change_count: number;
  would_no_op_count: number;
  selection_digest: string;
  selection_bounds: {
    max_form_lead_id: string | null;
    max_call_lead_id: string | null;
  };
  sample: CplCorrectionPreviewSampleItem[];
};

export type CplCorrectionPreviewResult = {
  preview_hash: string;
  selection: NormalizedCplCorrectionSelection;
  target_schedule_revision: number;
  impact: CplCorrectionPreviewImpact;
  reviewed_targets: CplCorrectionLeadRef[];
};

export type CplCorrectionJobView = {
  id: string;
  request_id: string;
  source_granularity_id: string;
  window_from: string;
  window_until: string;
  target_schedule_revision: number;
  preview_hash: string;
  status: CplCorrectionJobStatus;
  reason: string | null;
  matched_count: number;
  changed_count: number;
  no_op_count: number;
  failed_count: number;
  cursor: {
    lead_model: CplCorrectionLeadModel;
    lead_id: string;
  } | null;
  leased_until: string | null;
  last_error: string | null;
  started_at: string | null;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
};

export type CplCorrectionBatchResult = {
  job_id: string;
  claimed: boolean;
  processed: number;
  changed: number;
  no_op: number;
  failed: number;
  completed: boolean;
  cancelled: boolean;
};

export type CplCorrectionAnalyticsInvalidationRequest = {
  job_id: string;
  source_granularity_id: string;
  window_from: Date;
  window_until: Date;
  changed_count: number;
};

export type CplCorrectionAnalyticsInvalidator = (
  request: CplCorrectionAnalyticsInvalidationRequest,
) => Promise<void>;

export type CplCorrectionResolver = (input: {
  source_granularity_id: string;
  business_timestamp: Date;
  duplicate?: boolean;
  target_schedule_revision: number;
}) => Promise<CplResolution>;

export type CplCorrectionGranularityStore = {
  getScheduleRevision(sourceGranularityId: string): Promise<number | null>;
};

export type CplCorrectionJobRecord = {
  id: string;
  request_id: string;
  source_granularity_id: string;
  window_from: Date;
  window_until: Date;
  target_schedule_revision: number;
  max_form_lead_id: string | null;
  max_call_lead_id: string | null;
  reviewed_targets: CplCorrectionLeadRef[];
  preview_hash: string;
  status: CplCorrectionJobStatus;
  reason?: string;
  matched_count: number;
  changed_count: number;
  no_op_count: number;
  failed_count: number;
  cursor?: {
    lead_model: CplCorrectionLeadModel;
    lead_id: string;
  };
  leased_until?: Date;
  lease_owner?: string;
  last_error?: string;
  started_at?: Date;
  completed_at?: Date;
  created_at: Date;
  updated_at: Date;
};

export type CplCorrectionJobStore = {
  create(
    input: {
      selection: NormalizedCplCorrectionSelection;
      preview_hash: string;
      matched_count: number;
      actor: RegistryActorContext;
      reason?: string;
      reviewed_targets: CplCorrectionLeadRef[];
    },
    session?: ClientSession,
  ): Promise<CplCorrectionJobRecord>;
  findById(id: string): Promise<CplCorrectionJobRecord | null>;
  claimForProcessing(
    id: string,
    owner: string,
    leaseUntil: Date,
    now: Date,
  ): Promise<CplCorrectionJobRecord | null>;
  renewLease(
    id: string,
    owner: string,
    leaseUntil: Date,
    now: Date,
  ): Promise<boolean>;
  releaseLease(id: string, owner: string): Promise<void>;
  updateProgress(
    id: string,
    owner: string,
    update: {
      cursor?: CplCorrectionJobRecord["cursor"] | null;
      changed_count: number;
      no_op_count: number;
      failed_count: number;
      last_error?: string | null;
      status?: CplCorrectionJobStatus;
      completed_at?: Date;
    },
    session?: ClientSession,
  ): Promise<CplCorrectionJobRecord | null>;
  cancel(
    id: string,
    now: Date,
    session?: ClientSession,
  ): Promise<CplCorrectionJobRecord | null>;
  findClaimable(
    now: Date,
    limit: number,
  ): Promise<CplCorrectionJobRecord[]>;
};

export type CplCorrectionLeadStore = {
  countMatching(selection: NormalizedCplCorrectionSelection): Promise<{
    total: number;
    form_lead_count: number;
    call_lead_count: number;
  }>;
  listSample(
    selection: NormalizedCplCorrectionSelection,
    limit: number,
  ): Promise<CplCorrectionLeadRef[]>;
  listBatch(
    selection: NormalizedCplCorrectionSelection,
    cursor: CplCorrectionJobRecord["cursor"] | undefined,
    limit: number,
  ): Promise<CplCorrectionLeadRef[]>;
  updateLeadCorrection(
    ref: CplCorrectionLeadRef,
    update: {
      job_id: string;
      corrected_at: Date;
      previous_cpl: number;
      cpl: number;
      cpl_rate_period?: string;
      cpl_resolution_status: string;
      cpl_resolved_at: Date;
      cpl_resolution_version: string;
    },
    session?: ClientSession,
  ): Promise<boolean>;
};

export type CplCorrectionDependencies = {
  jobStore: CplCorrectionJobStore;
  leadStore: CplCorrectionLeadStore;
  granularityStore: CplCorrectionGranularityStore;
  resolveTargetCpl: CplCorrectionResolver;
  invalidateAnalytics: CplCorrectionAnalyticsInvalidator;
  runMutation?: TransactionRunner;
  registryAudit?: RegistryAuditDeps;
  now?: () => Date;
  leaseMs?: number;
  batchSize?: number;
  previewSampleLimit?: number;
  workerOwner?: () => string;
  recordEvent?: typeof recordOperationalEvent;
};

type HashImpactInput = {
  matched_count: number;
  form_lead_count: number;
  call_lead_count: number;
  would_change_count: number;
  would_no_op_count: number;
  selection_digest: string;
  selection_bounds: {
    max_form_lead_id: string | null;
    max_call_lead_id: string | null;
  };
  sample: Array<{
    lead_model: CplCorrectionLeadModel;
    lead_id: string;
    timestamp: string;
    current_cpl: number;
    current_resolution_status: string | null;
    target_cpl: number;
    target_resolution_status: CplResolution["status"];
    would_change: boolean;
  }>;
};

export function normalizeCplCorrectionSelection(
  input: CplCorrectionSelectionInput,
): NormalizedCplCorrectionSelection {
  const sourceGranularityId = input.source_granularity_id.trim();
  if (!isObjectIdString(sourceGranularityId)) {
    throw new RegistryError("Invalid source granularity id.", {
      registryCode: REGISTRY_ERROR_CODES.IMMUTABLE_FIELD,
    });
  }
  if (
    !Number.isSafeInteger(input.target_schedule_revision) ||
    input.target_schedule_revision < 1
  ) {
    throw new RegistryError("Invalid target schedule revision.", {
      registryCode: REGISTRY_ERROR_CODES.STALE_REVISION,
    });
  }

  let windowFrom: Date;
  let windowUntil: Date;
  if (input.window.kind === "instant") {
    windowFrom = input.window.window_from;
    windowUntil = input.window.window_until;
  } else {
    windowFrom = businessDateToUtc(input.window.window_from_date);
    windowUntil = ownerInclusiveEndDateToExclusive(
      input.window.window_until_date,
    ).instant;
  }

  if (
    Number.isNaN(windowFrom.getTime()) ||
    Number.isNaN(windowUntil.getTime()) ||
    windowUntil.getTime() <= windowFrom.getTime()
  ) {
    throw new RegistryError("Correction window is invalid.", {
      registryCode: REGISTRY_ERROR_CODES.IMMUTABLE_FIELD,
    });
  }

  return {
    source_granularity_id: sourceGranularityId,
    window_from: windowFrom,
    window_until: windowUntil,
    target_schedule_revision: input.target_schedule_revision,
  };
}

const correctionBusinessDateFormatter = new Intl.DateTimeFormat("en-US", {
  timeZone: CPL_BUSINESS_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
});

/**
 * Lead timestamps store Eastern wall-clock components in a Date field.
 * Convert true New York boundary instants to matching pseudo-UTC calendar
 * boundaries before querying production Lead collections.
 */
export function cplCorrectionWindowToStoredLeadRange(selection: {
  window_from: Date;
  window_until: Date;
}): { from: Date; until: Date } {
  const toStoredMidnight = (instant: Date): Date => {
    const parts = Object.fromEntries(
      correctionBusinessDateFormatter
        .formatToParts(instant)
        .filter((part) => part.type !== "literal")
        .map((part) => [part.type, part.value]),
    ) as Record<"year" | "month" | "day", string>;
    return new Date(
      Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day)),
    );
  };
  return {
    from: toStoredMidnight(selection.window_from),
    until: toStoredMidnight(selection.window_until),
  };
}

function canonicalizeForHash(value: unknown): unknown {
  if (value === null || value === undefined) {
    return value ?? null;
  }
  if (typeof value === "string" || typeof value === "number" || typeof value === "boolean") {
    return value;
  }
  if (Array.isArray(value)) {
    return value.map((item) => canonicalizeForHash(item));
  }
  if (typeof value === "object") {
    const record = value as Record<string, unknown>;
    return Object.keys(record)
      .sort()
      .reduce<Record<string, unknown>>((acc, key) => {
        acc[key] = canonicalizeForHash(record[key]);
        return acc;
      }, {});
  }
  return String(value);
}

export function computeCplCorrectionPreviewHash(
  selection: NormalizedCplCorrectionSelection,
  impact: HashImpactInput,
): string {
  const payload = canonicalizeForHash({
    selection: {
      source_granularity_id: selection.source_granularity_id,
      window_from: selection.window_from.toISOString(),
      window_until: selection.window_until.toISOString(),
      target_schedule_revision: selection.target_schedule_revision,
    },
    impact: {
      matched_count: impact.matched_count,
      form_lead_count: impact.form_lead_count,
      call_lead_count: impact.call_lead_count,
      would_change_count: impact.would_change_count,
      would_no_op_count: impact.would_no_op_count,
      selection_digest: impact.selection_digest,
      selection_bounds: impact.selection_bounds,
    },
  });
  return createHash("sha256")
    .update(JSON.stringify(payload))
    .digest("hex");
}

function resolutionToLeadFields(resolution: CplResolution): {
  cpl: number;
  cpl_rate_period?: string;
  cpl_resolution_status: string;
} {
  switch (resolution.status) {
    case "resolved":
      return {
        cpl: resolution.amount,
        cpl_rate_period: resolution.period_id,
        cpl_resolution_status: resolution.status,
      };
    case "missing_rate":
      return {
        cpl: resolution.fallback_amount,
        cpl_resolution_status: resolution.status,
      };
    case "duplicate_zero":
      return {
        cpl: resolution.amount,
        ...(resolution.base_period_id
          ? { cpl_rate_period: resolution.base_period_id }
          : {}),
        cpl_resolution_status: resolution.status,
      };
    case "not_applicable":
      return {
        cpl: resolution.amount,
        cpl_resolution_status: resolution.status,
      };
    default:
      return {
        cpl: 0,
        cpl_resolution_status: "missing_rate",
      };
  }
}

function targetAmount(resolution: CplResolution): number {
  switch (resolution.status) {
    case "resolved":
      return resolution.amount;
    case "missing_rate":
      return resolution.fallback_amount;
    case "duplicate_zero":
    case "not_applicable":
      return resolution.amount;
    default:
      return 0;
  }
}

function leadMatchesTarget(
  lead: CplCorrectionLeadRef,
  target: ReturnType<typeof resolutionToLeadFields>,
): boolean {
  return (
    lead.cpl === target.cpl &&
    (lead.cpl_resolution_status ?? null) === target.cpl_resolution_status &&
    (lead.cpl_rate_period ?? null) === (target.cpl_rate_period ?? null)
  );
}

function leadMatchesReviewedState(
  lead: CplCorrectionLeadRef,
  reviewed: CplCorrectionLeadRef,
): boolean {
  return (
    lead.lead_model === reviewed.lead_model &&
    lead.lead_id === reviewed.lead_id &&
    lead.source_granularity_id === reviewed.source_granularity_id &&
    lead.timestamp.getTime() === reviewed.timestamp.getTime() &&
    lead.cpl === reviewed.cpl &&
    (lead.cpl_rate_period ?? null) ===
      (reviewed.cpl_rate_period ?? null) &&
    (lead.cpl_resolution_status ?? null) ===
      (reviewed.cpl_resolution_status ?? null) &&
    (lead.cpl_resolved_at?.getTime() ?? null) ===
      (reviewed.cpl_resolved_at?.getTime() ?? null) &&
    (lead.cpl_resolution_version ?? null) ===
      (reviewed.cpl_resolution_version ?? null) &&
    (lead.duplicate === true) === (reviewed.duplicate === true)
  );
}

async function buildPreviewImpact(
  selection: NormalizedCplCorrectionSelection,
  deps: Pick<CplCorrectionDependencies, "leadStore" | "resolveTargetCpl" | "previewSampleLimit">,
): Promise<
  CplCorrectionPreviewImpact & {
    reviewed_targets: CplCorrectionLeadRef[];
  }
> {
  const preliminaryCounts = await deps.leadStore.countMatching(selection);
  if (preliminaryCounts.total > MAX_CPL_CORRECTION_PREVIEW_LEADS) {
    throw new RegistryError(
      `Correction preview exceeds ${MAX_CPL_CORRECTION_PREVIEW_LEADS} Leads.`,
      {
        registryCode: REGISTRY_ERROR_CODES.DEPENDENCY_CONFLICT,
        remediation: {
          summary: "Choose a smaller business-date window and preview again.",
          entity_type: "cpl_correction",
        },
      },
    );
  }
  const sampleLimit = deps.previewSampleLimit ?? DEFAULT_CPL_CORRECTION_PREVIEW_SAMPLE_LIMIT;
  const digest = createHash("sha256");
  const sample: CplCorrectionPreviewSampleItem[] = [];
  const reviewedTargets: CplCorrectionLeadRef[] = [];
  let matchedCount = 0;
  let formLeadCount = 0;
  let callLeadCount = 0;
  let maxFormLeadId: string | null = null;
  let maxCallLeadId: string | null = null;
  let wouldChangeCount = 0;
  let wouldNoOpCount = 0;
  let cursor: CplCorrectionJobRecord["cursor"] | undefined;
  const scanBatchSize = 500;
  while (true) {
    const leads = await deps.leadStore.listBatch(
      selection,
      cursor,
      scanBatchSize,
    );
    if (leads.length === 0) break;
    for (const lead of leads) {
      reviewedTargets.push(lead);
      const resolution = await deps.resolveTargetCpl({
        source_granularity_id: selection.source_granularity_id,
        business_timestamp: lead.timestamp,
        duplicate:
          lead.lead_model === "CallLead" && lead.duplicate === true,
        target_schedule_revision: selection.target_schedule_revision,
      });
      const target = resolutionToLeadFields(resolution);
      const wouldChange = !leadMatchesTarget(lead, target);
      matchedCount += 1;
      if (matchedCount > MAX_CPL_CORRECTION_PREVIEW_LEADS) {
        throw new RegistryError(
          "Correction selection grew beyond the preview safety limit.",
          {
            registryCode: REGISTRY_ERROR_CODES.CPL_PREVIEW_STALE,
          },
        );
      }
      if (lead.lead_model === "FormLead") formLeadCount += 1;
      else callLeadCount += 1;
      if (lead.lead_model === "FormLead") maxFormLeadId = lead.lead_id;
      else maxCallLeadId = lead.lead_id;
      if (wouldChange) wouldChangeCount += 1;
      else wouldNoOpCount += 1;
      digest.update(
        `${JSON.stringify(
          canonicalizeForHash({
            lead_model: lead.lead_model,
            lead_id: lead.lead_id,
            timestamp: lead.timestamp.toISOString(),
            current_cpl: lead.cpl,
            current_resolution_status: lead.cpl_resolution_status ?? null,
            current_rate_period: lead.cpl_rate_period ?? null,
            duplicate: lead.duplicate === true,
            target_cpl: target.cpl,
            target_resolution_status: target.cpl_resolution_status,
            target_rate_period: target.cpl_rate_period ?? null,
          }),
        )}\n`,
      );
      if (sample.length < sampleLimit) {
        sample.push({
          lead_model: lead.lead_model,
          lead_id: lead.lead_id,
          timestamp: lead.timestamp.toISOString(),
          current_cpl: lead.cpl,
          current_resolution_status: lead.cpl_resolution_status,
          target_cpl: target.cpl,
          target_resolution_status: resolution.status,
          would_change: wouldChange,
        });
      }
      cursor = {
        lead_model: lead.lead_model,
        lead_id: lead.lead_id,
      };
    }
    if (leads.length < scanBatchSize) break;
  }

  return {
    matched_count: matchedCount,
    form_lead_count: formLeadCount,
    call_lead_count: callLeadCount,
    would_change_count: wouldChangeCount,
    would_no_op_count: wouldNoOpCount,
    selection_digest: digest.digest("hex"),
    selection_bounds: {
      max_form_lead_id: maxFormLeadId,
      max_call_lead_id: maxCallLeadId,
    },
    sample,
    reviewed_targets: reviewedTargets,
  };
}

export async function previewCplCorrection(
  command: PreviewCplCorrectionCommand,
  deps: CplCorrectionDependencies,
): Promise<CplCorrectionPreviewResult> {
  const selection = normalizeCplCorrectionSelection(command);
  const currentRevision = await deps.granularityStore.getScheduleRevision(
    selection.source_granularity_id,
  );
  if (currentRevision === null) {
    throw new RegistryError("Source granularity was not found.", {
      registryCode: REGISTRY_ERROR_CODES.NOT_FOUND,
    });
  }
  if (currentRevision !== selection.target_schedule_revision) {
    throw new RegistryError("Target schedule revision is stale.", {
      registryCode: REGISTRY_ERROR_CODES.CPL_PREVIEW_STALE,
      remediation: {
        summary: "Re-run preview against the current schedule revision.",
        entity_type: "source_granularity",
        entity_id: selection.source_granularity_id,
        current_revision: currentRevision,
      },
    });
  }

  const impact = await buildPreviewImpact(selection, deps);
  const previewHash = computeCplCorrectionPreviewHash(selection, {
    matched_count: impact.matched_count,
    form_lead_count: impact.form_lead_count,
    call_lead_count: impact.call_lead_count,
    would_change_count: impact.would_change_count,
    would_no_op_count: impact.would_no_op_count,
    selection_digest: impact.selection_digest,
    selection_bounds: impact.selection_bounds,
    sample: impact.sample.map((item) => ({
      lead_model: item.lead_model,
      lead_id: item.lead_id,
      timestamp: item.timestamp,
      current_cpl: item.current_cpl,
      current_resolution_status: item.current_resolution_status ?? null,
      target_cpl: item.target_cpl,
      target_resolution_status: item.target_resolution_status,
      would_change: item.would_change,
    })),
  });

  const { reviewed_targets, ...publicImpact } = impact;
  return {
    preview_hash: previewHash,
    selection,
    target_schedule_revision: selection.target_schedule_revision,
    impact: publicImpact,
    reviewed_targets,
  };
}

export async function createCplCorrection(
  command: CreateCplCorrectionCommand,
  actor: RegistryActorContext,
  deps: CplCorrectionDependencies,
): Promise<CplCorrectionJobView> {
  assertCorrectionOwner(actor);
  if (command.confirm !== true) {
    throw new RegistryError("Correction apply requires explicit confirmation.", {
      registryCode: REGISTRY_ERROR_CODES.IMMUTABLE_FIELD,
    });
  }

  const preview = await previewCplCorrection(command, deps);
  if (preview.preview_hash !== command.preview_hash.trim()) {
    throw new RegistryError("Correction preview is stale.", {
      registryCode: REGISTRY_ERROR_CODES.CPL_PREVIEW_STALE,
      remediation: {
        summary: "Re-run preview and apply with the returned preview hash.",
        current_preview_hash: preview.preview_hash,
      },
    });
  }

  const job = await withRegistryMutation(
    {
      actor,
      audit: {
        entityType: "source_granularity",
        entityId: preview.selection.source_granularity_id,
        action: "correction",
        reason: command.reason,
        before: null,
        after: {
          status: "pending",
          preview_hash: preview.preview_hash,
          target_schedule_revision: preview.target_schedule_revision,
          window_from: preview.selection.window_from.toISOString(),
          window_until: preview.selection.window_until.toISOString(),
          matched_count: preview.impact.matched_count,
        },
        metadata: {
          request_id: actor.requestId,
          preview_hash: preview.preview_hash,
          target_schedule_revision: preview.target_schedule_revision,
          source_granularity_id: preview.selection.source_granularity_id,
          window_from: preview.selection.window_from.toISOString(),
          window_until: preview.selection.window_until.toISOString(),
          matched_count: preview.impact.matched_count,
          form_lead_count: preview.impact.form_lead_count,
          call_lead_count: preview.impact.call_lead_count,
          would_change_count: preview.impact.would_change_count,
        },
      },
      mutate: async (session) =>
        deps.jobStore.create(
          {
            selection: {
              ...preview.selection,
              ...preview.impact.selection_bounds,
            },
            preview_hash: preview.preview_hash,
            matched_count: preview.impact.matched_count,
            reviewed_targets: preview.reviewed_targets,
            actor,
            reason: command.reason,
          },
          session,
        ),
    },
    deps.runMutation || deps.registryAudit
      ? {
          ...(deps.runMutation ? { withTransaction: deps.runMutation } : {}),
          ...(deps.registryAudit ?? {}),
        }
      : {},
  );

  return toJobView(job);
}

export async function getCplCorrectionJob(
  jobId: string,
  deps: Pick<CplCorrectionDependencies, "jobStore">,
): Promise<CplCorrectionJobView> {
  const job = await deps.jobStore.findById(jobId);
  if (!job) {
    throw new RegistryError("CPL correction job was not found.", {
      registryCode: REGISTRY_ERROR_CODES.NOT_FOUND,
    });
  }
  return toJobView(job);
}

export async function cancelCplCorrectionJob(
  jobId: string,
  actor: RegistryActorContext,
  deps: Pick<
    CplCorrectionDependencies,
    "jobStore" | "now" | "recordEvent" | "runMutation" | "registryAudit"
  >,
  reason?: string,
): Promise<CplCorrectionJobView> {
  assertCorrectionOwner(actor);
  const now = deps.now?.() ?? new Date();
  const existing = await deps.jobStore.findById(jobId);
  if (!existing) {
    throw new RegistryError("CPL correction job was not found.", {
      registryCode: REGISTRY_ERROR_CODES.NOT_FOUND,
    });
  }
  if (existing.status === "cancelled") {
    return toJobView(existing);
  }
  if (existing.status === "completed" || existing.status === "failed") {
    throw new RegistryError("Only pending or processing jobs can be cancelled.", {
      registryCode: REGISTRY_ERROR_CODES.DEPENDENCY_CONFLICT,
      remediation: {
        summary: "The job has already finished.",
        entity_id: existing.id,
        status: existing.status,
      },
    });
  }

  const job = await withRegistryMutation(
    {
      actor,
      audit: {
        entityType: "source_granularity",
        entityId: existing.source_granularity_id,
        action: "correction",
        reason,
        before: {
          job_id: existing.id,
          status: existing.status,
          changed_count: existing.changed_count,
          no_op_count: existing.no_op_count,
          failed_count: existing.failed_count,
        },
        after: {
          job_id: existing.id,
          status: "cancelled",
        },
        metadata: {
          correction_job_id: existing.id,
          operation: "cancel",
          request_id: actor.requestId,
        },
      },
      mutate: async (session) => {
        const cancelled = await deps.jobStore.cancel(jobId, now, session);
        if (!cancelled) {
          throw new RegistryError("CPL correction job can no longer be cancelled.", {
            registryCode: REGISTRY_ERROR_CODES.DEPENDENCY_CONFLICT,
            remediation: {
              summary:
                "Refresh the job; it may have completed or been cancelled.",
              entity_id: existing.id,
            },
          });
        }
        return cancelled;
      },
    },
    {
      ...(deps.runMutation ? { withTransaction: deps.runMutation } : {}),
      ...(deps.registryAudit ?? {}),
    },
  );

  const recordEvent = deps.recordEvent ?? recordOperationalEvent;
  await recordEvent({
    level: "info",
    eventKey: "cpl_correction.cancelled",
    category: "admin",
    workflow: "cpl_correction",
    summary: "CPL correction job cancelled.",
    requestId: actor.requestId,
    entity: { type: "cpl_correction_job", id: job.id },
    details: sanitizeEventDetails({
      request_id: job.request_id,
      source_granularity_id: job.source_granularity_id,
      matched_count: job.matched_count,
      changed_count: job.changed_count,
      failed_count: job.failed_count,
    }) as Record<string, unknown>,
  });

  return toJobView(job);
}

export async function processCplCorrectionBatch(
  jobId: string,
  deps: CplCorrectionDependencies,
): Promise<CplCorrectionBatchResult> {
  const now = deps.now?.() ?? new Date();
  const owner = deps.workerOwner?.() ?? randomUUID();
  const leaseMs = deps.leaseMs ?? DEFAULT_CPL_CORRECTION_LEASE_MS;
  const batchSize = deps.batchSize ?? DEFAULT_CPL_CORRECTION_BATCH_SIZE;
  const recordEvent = deps.recordEvent ?? recordOperationalEvent;

  let job = await deps.jobStore.claimForProcessing(
    jobId,
    owner,
    new Date(now.getTime() + leaseMs),
    now,
  );
  if (!job) {
    const existing = await deps.jobStore.findById(jobId);
    if (!existing) {
      throw new RegistryError("CPL correction job was not found.", {
        registryCode: REGISTRY_ERROR_CODES.NOT_FOUND,
      });
    }
    if (existing.status === "completed") {
      return {
        job_id: existing.id,
        claimed: false,
        processed: 0,
        changed: 0,
        no_op: 0,
        failed: 0,
        completed: true,
        cancelled: false,
      };
    }
    if (existing.status === "cancelled") {
      return {
        job_id: existing.id,
        claimed: false,
        processed: 0,
        changed: 0,
        no_op: 0,
        failed: 0,
        completed: false,
        cancelled: true,
      };
    }
    return {
      job_id: existing.id,
      claimed: false,
      processed: 0,
      changed: 0,
      no_op: 0,
      failed: 0,
      completed: false,
      cancelled: false,
    };
  }

  if (job.status === "completed") {
    return {
      job_id: job.id,
      claimed: true,
      processed: 0,
      changed: 0,
      no_op: 0,
      failed: 0,
      completed: true,
      cancelled: false,
    };
  }
  let activeJob: CplCorrectionJobRecord = job;

  const selection: NormalizedCplCorrectionSelection = {
    source_granularity_id: activeJob.source_granularity_id,
    window_from: activeJob.window_from,
    window_until: activeJob.window_until,
    target_schedule_revision: activeJob.target_schedule_revision,
    max_form_lead_id: activeJob.max_form_lead_id,
    max_call_lead_id: activeJob.max_call_lead_id,
    reviewed_targets: activeJob.reviewed_targets,
  };

  let processed = 0;
  let changed = 0;
  let noOp = 0;
  let failed = 0;
  let cursor = activeJob.cursor;
  let lastError: string | null = null;
  const runCheckpoint: TransactionRunner =
    deps.runMutation ??
    (async (callback) =>
      callback(undefined as unknown as ClientSession));

  try {
    const currentRevision = await deps.granularityStore.getScheduleRevision(
      selection.source_granularity_id,
    );
    if (currentRevision !== selection.target_schedule_revision) {
      throw new RegistryError("Target schedule revision changed during processing.", {
        registryCode: REGISTRY_ERROR_CODES.CPL_PREVIEW_STALE,
      });
    }

    const leads = await deps.leadStore.listBatch(selection, cursor, batchSize);
    for (const lead of leads) {
      const fresh = await deps.jobStore.findById(activeJob.id);
      if (!fresh || fresh.status === "cancelled") {
        await deps.jobStore.releaseLease(activeJob.id, owner);
        return {
          job_id: activeJob.id,
          claimed: true,
          processed,
          changed,
          no_op: noOp,
          failed,
          completed: false,
          cancelled: true,
        };
      }

      const leaseNow = deps.now?.() ?? new Date();
      const renewed = await deps.jobStore.renewLease(
        activeJob.id,
        owner,
        new Date(leaseNow.getTime() + leaseMs),
        leaseNow,
      );
      if (!renewed) {
        await recordEvent({
          level: "warn",
          eventKey: "cpl_correction.lease_lost",
          category: "admin",
          workflow: "cpl_correction",
          summary: "CPL correction worker stopped after losing its lease.",
          entity: { type: "cpl_correction_job", id: activeJob.id },
          details: { request_id: activeJob.request_id, processed },
          notificationCandidate: false,
        });
        return {
          job_id: activeJob.id,
          claimed: true,
          processed,
          changed,
          no_op: noOp,
          failed,
          completed: false,
          cancelled: false,
        };
      }

      try {
        const nextCursor = {
          lead_model: lead.lead_model,
          lead_id: lead.lead_id,
        };
        const checkpoint = await runCheckpoint(async (session) => {
          const outcome = await applyCorrectionToLead(
            activeJob.id,
            lead,
            selection,
            deps,
            now,
            session,
          );
          const updatedJob = await deps.jobStore.updateProgress(
            activeJob.id,
            owner,
            {
              cursor: nextCursor,
              changed_count:
                activeJob.changed_count + (outcome === "changed" ? 1 : 0),
              no_op_count:
                activeJob.no_op_count + (outcome === "no_op" ? 1 : 0),
              failed_count: activeJob.failed_count,
              last_error: null,
              status: "processing",
            },
            session,
          );
          if (!updatedJob) {
            throw new RegistryError("CPL correction worker lost its lease.", {
              registryCode: REGISTRY_ERROR_CODES.DEPENDENCY_CONFLICT,
            });
          }
          return { outcome, updatedJob };
        });
        activeJob = checkpoint.updatedJob;
        processed += 1;
        if (checkpoint.outcome === "changed") changed += 1;
        else if (checkpoint.outcome === "no_op") noOp += 1;
        cursor = nextCursor;
      } catch (error) {
        const terminalPreviewConflict =
          error instanceof RegistryError &&
          error.registryCode === REGISTRY_ERROR_CODES.CPL_PREVIEW_STALE;
        failed += 1;
        lastError = sanitizeCorrectionError(error);
        processed += 1;
        const failedJob = await runCheckpoint((session) =>
          deps.jobStore.updateProgress(
            activeJob.id,
            owner,
            {
              cursor,
              changed_count: activeJob.changed_count,
              no_op_count: activeJob.no_op_count,
              failed_count: activeJob.failed_count + 1,
              last_error: lastError,
              status: terminalPreviewConflict ? "failed" : "processing",
            },
            session,
          ),
        );
        if (!failedJob) {
          return {
            job_id: activeJob.id,
            claimed: true,
            processed,
            changed,
            no_op: noOp,
            failed,
            completed: false,
            cancelled: false,
          };
        }
        activeJob = failedJob;
        await recordEvent({
          level: "warn",
          eventKey: "cpl_correction.lead_failed",
          category: "admin",
          workflow: "cpl_correction",
          summary: "CPL correction failed for one lead.",
          entity: { type: "cpl_correction_job", id: activeJob.id },
          details: sanitizeEventDetails({
            request_id: activeJob.request_id,
            lead_model: lead.lead_model,
            lead_id: lead.lead_id,
            error: lastError,
          }) as Record<string, unknown>,
        });
        if (terminalPreviewConflict) {
          await deps.jobStore.releaseLease(activeJob.id, owner);
          return {
            job_id: activeJob.id,
            claimed: true,
            processed,
            changed,
            no_op: noOp,
            failed,
            completed: false,
            cancelled: false,
          };
        }
        // Preserve the cursor before the failed Lead. A later batch retries it
        // after the underlying issue is corrected, while earlier successful
        // Leads remain idempotent and are not revisited.
        break;
      }
    }

    const nextBatch = await deps.leadStore.listBatch(selection, cursor, 1);
    const completed = leads.length === 0 || nextBatch.length === 0;
    const accountedCount =
      activeJob.changed_count +
      activeJob.no_op_count +
      activeJob.failed_count;
    const missingReviewedCount = completed
      ? Math.max(0, activeJob.matched_count - accountedCount)
      : 0;
    if (missingReviewedCount > 0) {
      failed += missingReviewedCount;
      lastError = `Registry correction error: ${REGISTRY_ERROR_CODES.CPL_PREVIEW_STALE}`;
      const failedJob = await runCheckpoint((session) =>
        deps.jobStore.updateProgress(
          activeJob.id,
          owner,
          {
            cursor,
            changed_count: activeJob.changed_count,
            no_op_count: activeJob.no_op_count,
            failed_count:
              activeJob.failed_count + missingReviewedCount,
            last_error: lastError,
            status: "failed",
          },
          session,
        ),
      );
      if (failedJob) activeJob = failedJob;
      await deps.jobStore.releaseLease(activeJob.id, owner);
      await recordEvent({
        level: "error",
        eventKey: "cpl_correction.reviewed_target_missing",
        category: "admin",
        workflow: "cpl_correction",
        summary:
          "CPL correction stopped because a reviewed Lead disappeared.",
        entity: { type: "cpl_correction_job", id: activeJob.id },
        details: {
          request_id: activeJob.request_id,
          missing_reviewed_count: missingReviewedCount,
        },
      });
      return {
        job_id: activeJob.id,
        claimed: true,
        processed,
        changed,
        no_op: noOp,
        failed,
        completed: false,
        cancelled: false,
      };
    }
    const updated = completed
      ? await runCheckpoint((session) =>
          deps.jobStore.updateProgress(
            activeJob.id,
            owner,
            {
              cursor: null,
              changed_count: activeJob.changed_count,
              no_op_count: activeJob.no_op_count,
              failed_count: activeJob.failed_count,
              last_error: lastError,
              status: "completed",
              completed_at: now,
            },
            session,
          ),
        )
      : activeJob;

    await deps.jobStore.releaseLease(activeJob.id, owner);

    if (completed && updated) {
      try {
        await recordEvent({
          level: "info",
          eventKey: "cpl_correction.completed",
          category: "admin",
          workflow: "cpl_correction",
          summary: "CPL correction job completed.",
          entity: { type: "cpl_correction_job", id: activeJob.id },
          details: sanitizeEventDetails({
            request_id: updated.request_id,
            changed_count: updated.changed_count,
            no_op_count: updated.no_op_count,
            failed_count: updated.failed_count,
          }) as Record<string, unknown>,
        });

        if (updated.changed_count > 0) {
          await deps.invalidateAnalytics({
            job_id: updated.id,
            source_granularity_id: updated.source_granularity_id,
            window_from: updated.window_from,
            window_until: updated.window_until,
            changed_count: updated.changed_count,
          });
        }
      } catch (handoffError) {
        try {
          await recordEvent({
            level: "error",
            eventKey: "cpl_correction.analytics_handoff_failed",
            category: "admin",
            workflow: "cpl_correction",
            summary:
              "CPL correction completed but its Analytics handoff failed.",
            entity: { type: "cpl_correction_job", id: activeJob.id },
            details: {
              request_id: updated.request_id,
              error: sanitizeCorrectionError(handoffError),
            },
          });
        } catch {
          // The durable job remains completed even if observability is down.
        }
      }
    } else if (processed > 0) {
      await recordEvent({
        level: "info",
        eventKey: "cpl_correction.progress",
        category: "admin",
        workflow: "cpl_correction",
        summary: "CPL correction batch processed.",
        entity: { type: "cpl_correction_job", id: activeJob.id },
        details: sanitizeEventDetails({
          request_id: activeJob.request_id,
          processed,
          changed,
          no_op: noOp,
          failed,
          cursor,
        }) as Record<string, unknown>,
      });
    }

    return {
      job_id: activeJob.id,
      claimed: true,
      processed,
      changed,
      no_op: noOp,
      failed,
      completed,
      cancelled: false,
    };
  } catch (error) {
    lastError = sanitizeCorrectionError(error);
    await runCheckpoint((session) =>
      deps.jobStore.updateProgress(
        activeJob.id,
        owner,
        {
          cursor,
          changed_count: activeJob.changed_count,
          no_op_count: activeJob.no_op_count,
          failed_count: activeJob.failed_count,
          last_error: lastError,
          status: "failed",
        },
        session,
      ),
    );
    await deps.jobStore.releaseLease(activeJob.id, owner);
    await recordEvent({
      level: "error",
      eventKey: "cpl_correction.batch_failed",
      category: "admin",
      workflow: "cpl_correction",
      summary: "CPL correction batch failed.",
      entity: { type: "cpl_correction_job", id: activeJob.id },
      details: sanitizeEventDetails({
        request_id: activeJob.request_id,
        error: lastError,
      }) as Record<string, unknown>,
    });
    throw error;
  }
}

export async function runDueCplCorrectionJobs(
  deps: CplCorrectionDependencies,
  options: { limit?: number } = {},
): Promise<CplCorrectionBatchResult[]> {
  const now = deps.now?.() ?? new Date();
  const jobs = await deps.jobStore.findClaimable(now, options.limit ?? 1);
  const results: CplCorrectionBatchResult[] = [];
  for (const job of jobs) {
    results.push(await processCplCorrectionBatch(job.id, deps));
  }
  return results;
}

async function applyCorrectionToLead(
  jobId: string,
  lead: CplCorrectionLeadRef,
  selection: NormalizedCplCorrectionSelection,
  deps: Pick<CplCorrectionDependencies, "resolveTargetCpl" | "leadStore">,
  now: Date,
  session?: ClientSession,
): Promise<"changed" | "no_op"> {
  if (selection.reviewed_targets) {
    const reviewed = selection.reviewed_targets.find(
      (target) =>
        target.lead_model === lead.lead_model &&
        target.lead_id === lead.lead_id,
    );
    if (!reviewed || !leadMatchesReviewedState(lead, reviewed)) {
      throw new RegistryError(
        "Lead state changed after the correction preview.",
        {
          registryCode: REGISTRY_ERROR_CODES.CPL_PREVIEW_STALE,
        },
      );
    }
  }
  const resolution = await deps.resolveTargetCpl({
    source_granularity_id: selection.source_granularity_id,
    business_timestamp: lead.timestamp,
    duplicate: lead.lead_model === "CallLead" && lead.duplicate === true,
    target_schedule_revision: selection.target_schedule_revision,
  });
  const target = resolutionToLeadFields(resolution);

  if (
    lead.cpl_correction?.job_id === jobId &&
    leadMatchesTarget(lead, target)
  ) {
    return "no_op";
  }
  if (leadMatchesTarget(lead, target)) {
    return "no_op";
  }

  const updated = await deps.leadStore.updateLeadCorrection(lead, {
    job_id: jobId,
    corrected_at: now,
    previous_cpl: lead.cpl,
    cpl: target.cpl,
    cpl_rate_period: target.cpl_rate_period,
    cpl_resolution_status: target.cpl_resolution_status,
    cpl_resolved_at: now,
    cpl_resolution_version: CPL_CORRECTION_RESOLUTION_VERSION,
  }, session);
  if (!updated) {
    throw new RegistryError(
      "Lead state changed during correction processing.",
      {
        registryCode: REGISTRY_ERROR_CODES.CPL_PREVIEW_STALE,
      },
    );
  }
  return "changed";
}

function sanitizeCorrectionError(error: unknown): string {
  if (error instanceof RegistryError) {
    return `Registry correction error: ${error.registryCode}`;
  }
  if (
    error instanceof mongoose.Error ||
    (error instanceof Error &&
      /mongo|database|connection|server selection/i.test(error.name))
  ) {
    return "Correction database operation failed.";
  }
  return "Correction Lead processing failed.";
}

function assertCorrectionOwner(actor: RegistryActorContext): void {
  if (actor.actorRole !== "owner") {
    throw new RegistryError("CPL corrections require an Owner actor.", {
      registryCode: REGISTRY_ERROR_CODES.FORBIDDEN,
    });
  }
}

function toJobView(job: CplCorrectionJobRecord): CplCorrectionJobView {
  return {
    id: job.id,
    request_id: job.request_id,
    source_granularity_id: job.source_granularity_id,
    window_from: job.window_from.toISOString(),
    window_until: job.window_until.toISOString(),
    target_schedule_revision: job.target_schedule_revision,
    preview_hash: job.preview_hash,
    status: job.status,
    reason: job.reason ?? null,
    matched_count: job.matched_count,
    changed_count: job.changed_count,
    no_op_count: job.no_op_count,
    failed_count: job.failed_count,
    cursor: job.cursor
      ? {
          lead_model: job.cursor.lead_model,
          lead_id: job.cursor.lead_id,
        }
      : null,
    leased_until: job.leased_until?.toISOString() ?? null,
    last_error: job.last_error ?? null,
    started_at: job.started_at?.toISOString() ?? null,
    completed_at: job.completed_at?.toISOString() ?? null,
    created_at: job.created_at.toISOString(),
    updated_at: job.updated_at.toISOString(),
  };
}

function leadTimestampFilter(
  selection: NormalizedCplCorrectionSelection,
  leadModel?: CplCorrectionLeadModel,
  afterId?: mongoose.Types.ObjectId,
) {
  if (leadModel && selection.reviewed_targets) {
    const reviewedIds = selection.reviewed_targets
      .filter((target) => target.lead_model === leadModel)
      .map((target) => toObjectId(target.lead_id));
    return {
      _id: {
        $in: reviewedIds,
        ...(afterId ? { $gt: afterId } : {}),
      },
    };
  }
  const storedRange = cplCorrectionWindowToStoredLeadRange(selection);
  const maxLeadId =
    leadModel === "FormLead"
      ? selection.max_form_lead_id
      : leadModel === "CallLead"
        ? selection.max_call_lead_id
        : undefined;
  return {
    source_granularity_id: toObjectId(selection.source_granularity_id),
    timestamp: {
      $gte: storedRange.from,
      $lt: storedRange.until,
    },
    ...(maxLeadId === null
      ? { _id: { $exists: false } }
      : maxLeadId
        ? {
            _id: {
              ...(afterId ? { $gt: afterId } : {}),
              $lte: toObjectId(maxLeadId),
            },
          }
        : afterId
          ? { _id: { $gt: afterId } }
          : {}),
  };
}

function mapLeadDoc(
  leadModel: CplCorrectionLeadModel,
  doc: {
    _id: mongoose.Types.ObjectId;
    source_granularity_id: mongoose.Types.ObjectId;
    timestamp: Date;
    cpl: number;
    cpl_rate_period?: mongoose.Types.ObjectId | null;
    cpl_resolution_status?: string | null;
    cpl_resolved_at?: Date | null;
    cpl_resolution_version?: string | null;
    duplicate?: boolean;
    cpl_correction?: {
      job_id?: mongoose.Types.ObjectId | null;
      corrected_at?: Date;
      previous_cpl?: number;
    } | null;
  },
): CplCorrectionLeadRef {
  return {
    lead_model: leadModel,
    lead_id: doc._id.toString(),
    source_granularity_id: doc.source_granularity_id.toString(),
    timestamp: doc.timestamp,
    cpl: doc.cpl,
    ...(doc.cpl_rate_period
      ? { cpl_rate_period: doc.cpl_rate_period.toString() }
      : {}),
    ...(doc.cpl_resolution_status
      ? { cpl_resolution_status: doc.cpl_resolution_status }
      : {}),
    ...(doc.cpl_resolved_at
      ? { cpl_resolved_at: doc.cpl_resolved_at }
      : {}),
    ...(doc.cpl_resolution_version
      ? { cpl_resolution_version: doc.cpl_resolution_version }
      : {}),
    ...(doc.duplicate ? { duplicate: doc.duplicate } : {}),
    ...(doc.cpl_correction
      ? {
          cpl_correction: {
            ...(doc.cpl_correction.job_id
              ? { job_id: doc.cpl_correction.job_id.toString() }
              : {}),
            ...(doc.cpl_correction.corrected_at
              ? { corrected_at: doc.cpl_correction.corrected_at }
              : {}),
            ...(doc.cpl_correction.previous_cpl !== undefined
              ? { previous_cpl: doc.cpl_correction.previous_cpl }
              : {}),
          },
        }
      : {}),
  };
}

function compareLeadRefs(left: CplCorrectionLeadRef, right: CplCorrectionLeadRef): number {
  const modelOrder = left.lead_model.localeCompare(right.lead_model);
  if (modelOrder !== 0) return modelOrder;
  return left.lead_id.localeCompare(right.lead_id);
}

async function queryLeadBatch(
  selection: NormalizedCplCorrectionSelection,
  cursor: CplCorrectionJobRecord["cursor"] | undefined,
  limit: number,
): Promise<CplCorrectionLeadRef[]> {
  const results: CplCorrectionLeadRef[] = [];
  const startModel: CplCorrectionLeadModel =
    cursor?.lead_model ?? "FormLead";
  const startId = cursor?.lead_id
    ? toObjectId(cursor.lead_id)
    : undefined;

  if (startModel === "FormLead") {
    const formFilter = leadTimestampFilter(
      selection,
      "FormLead",
      startId,
    );
    const formDocs = await FormLead.find(formFilter)
      .sort({ _id: 1 })
      .limit(limit)
      .select(
        "_id source_granularity_id timestamp cpl cpl_rate_period cpl_resolution_status cpl_resolved_at cpl_resolution_version duplicate cpl_correction",
      )
      .lean()
      .exec();
    for (const doc of formDocs) {
      results.push(mapLeadDoc("FormLead", doc as Parameters<typeof mapLeadDoc>[1]));
    }
    if (results.length >= limit) {
      return results;
    }
  }

  const remaining = limit - results.length;
  const callFilter = leadTimestampFilter(
    selection,
    "CallLead",
    startModel === "CallLead" ? startId : undefined,
  );
  const callDocs = await CallLead.find(callFilter)
    .sort({ _id: 1 })
    .limit(remaining)
    .select(
      "_id source_granularity_id timestamp cpl cpl_rate_period cpl_resolution_status cpl_resolved_at cpl_resolution_version duplicate cpl_correction",
    )
    .lean()
    .exec();
  for (const doc of callDocs) {
    results.push(mapLeadDoc("CallLead", doc as Parameters<typeof mapLeadDoc>[1]));
  }
  return results;
}

export function createMongoCplCorrectionLeadStore(): CplCorrectionLeadStore {
  return {
    async countMatching(selection) {
      const [formLeadCount, callLeadCount] = await Promise.all([
        FormLead.countDocuments(
          leadTimestampFilter(selection, "FormLead"),
        ).exec(),
        CallLead.countDocuments(
          leadTimestampFilter(selection, "CallLead"),
        ).exec(),
      ]);
      return {
        total: formLeadCount + callLeadCount,
        form_lead_count: formLeadCount,
        call_lead_count: callLeadCount,
      };
    },
    async listSample(selection, limit) {
      const batch = await queryLeadBatch(selection, undefined, limit);
      return batch.sort(compareLeadRefs);
    },
    listBatch(selection, cursor, limit) {
      return queryLeadBatch(selection, cursor, limit);
    },
    async updateLeadCorrection(ref, update, session) {
      const expectedFilter: Record<string, unknown> = {
        _id: ref.lead_id,
        source_granularity_id: toObjectId(ref.source_granularity_id),
        timestamp: ref.timestamp,
        cpl: ref.cpl,
        cpl_rate_period: ref.cpl_rate_period
          ? toObjectId(ref.cpl_rate_period)
          : null,
        cpl_resolution_status: ref.cpl_resolution_status ?? null,
        cpl_resolved_at: ref.cpl_resolved_at ?? null,
        cpl_resolution_version: ref.cpl_resolution_version ?? null,
        duplicate:
          ref.duplicate === true ? true : { $ne: true },
      };
      const setFields = {
        cpl: update.cpl,
        ...(update.cpl_rate_period
          ? {
              cpl_rate_period: toObjectId(update.cpl_rate_period),
            }
          : {}),
        cpl_resolution_status: update.cpl_resolution_status,
        cpl_resolved_at: update.cpl_resolved_at,
        cpl_resolution_version: update.cpl_resolution_version,
        cpl_correction: {
          job_id: update.job_id,
          corrected_at: update.corrected_at,
          previous_cpl: update.previous_cpl,
        },
      };
      const updateDocument = {
        $set: setFields,
        ...(!update.cpl_rate_period
          ? { $unset: { cpl_rate_period: "" } }
          : {}),
      };
      const result =
        ref.lead_model === "FormLead"
          ? await FormLead.updateOne(expectedFilter, updateDocument, {
              session,
            }).exec()
          : await CallLead.updateOne(expectedFilter, updateDocument, {
              session,
            }).exec();
      if (result.modifiedCount !== 1) {
        return false;
      }
      await getCplLeadCorrectionModel().create(
        [
          {
            job_id: toObjectId(update.job_id),
            lead_model: ref.lead_model,
            lead_id: toObjectId(ref.lead_id),
            corrected_at: update.corrected_at,
            before: {
              cpl: ref.cpl,
              cpl_rate_period: ref.cpl_rate_period
                ? toObjectId(ref.cpl_rate_period)
                : null,
              cpl_resolution_status: ref.cpl_resolution_status ?? null,
              cpl_resolved_at: ref.cpl_resolved_at ?? null,
              cpl_resolution_version: ref.cpl_resolution_version ?? null,
            },
            after: {
              cpl: update.cpl,
              cpl_rate_period: update.cpl_rate_period
                ? toObjectId(update.cpl_rate_period)
                : null,
              cpl_resolution_status: update.cpl_resolution_status,
              cpl_resolved_at: update.cpl_resolved_at,
              cpl_resolution_version: update.cpl_resolution_version,
            },
          },
        ],
        { session },
      );
      return true;
    },
  };
}

function mapJobDoc(doc: CplCorrectionJobDocument): CplCorrectionJobRecord {
  return {
    id: doc._id.toString(),
    request_id: doc.requested_by.request_id,
    source_granularity_id: doc.source_granularity.toString(),
    window_from: doc.window_from,
    window_until: doc.window_until,
    target_schedule_revision: doc.target_schedule_revision,
    max_form_lead_id: doc.max_form_lead_id?.toString() ?? null,
    max_call_lead_id: doc.max_call_lead_id?.toString() ?? null,
    reviewed_targets: doc.reviewed_targets.map((target) => ({
      lead_model: target.lead_model,
      lead_id: target.lead_id.toString(),
      source_granularity_id: target.source_granularity_id.toString(),
      timestamp: target.timestamp,
      cpl: target.cpl,
      ...(target.cpl_rate_period
        ? { cpl_rate_period: target.cpl_rate_period.toString() }
        : {}),
      ...(target.cpl_resolution_status
        ? { cpl_resolution_status: target.cpl_resolution_status }
        : {}),
      ...(target.cpl_resolved_at
        ? { cpl_resolved_at: target.cpl_resolved_at }
        : {}),
      ...(target.cpl_resolution_version
        ? { cpl_resolution_version: target.cpl_resolution_version }
        : {}),
      ...(target.duplicate ? { duplicate: true } : {}),
    })),
    preview_hash: doc.preview_hash,
    status: doc.status,
    ...(doc.reason ? { reason: doc.reason } : {}),
    matched_count: doc.matched_count,
    changed_count: doc.changed_count,
    no_op_count: doc.no_op_count,
    failed_count: doc.failed_count,
    ...(doc.cursor
      ? {
          cursor: {
            lead_model: doc.cursor.lead_model,
            lead_id: doc.cursor.lead_id.toString(),
          },
        }
      : {}),
    ...(doc.leased_until ? { leased_until: doc.leased_until } : {}),
    ...(doc.lease_owner ? { lease_owner: doc.lease_owner } : {}),
    ...(doc.last_error ? { last_error: doc.last_error } : {}),
    ...(doc.started_at ? { started_at: doc.started_at } : {}),
    ...(doc.completed_at ? { completed_at: doc.completed_at } : {}),
    created_at: doc.createdAt,
    updated_at: doc.updatedAt,
  };
}

export function createMongoCplCorrectionJobStore(): CplCorrectionJobStore {
  const model = () => getCplCorrectionJobModel();

  return {
    async create(input, session) {
      const [created] = await model().create(
        [
          {
            source_granularity: input.selection.source_granularity_id,
            window_from: input.selection.window_from,
            window_until: input.selection.window_until,
            target_schedule_revision: input.selection.target_schedule_revision,
            max_form_lead_id: input.selection.max_form_lead_id
              ? toObjectId(input.selection.max_form_lead_id)
              : null,
            max_call_lead_id: input.selection.max_call_lead_id
              ? toObjectId(input.selection.max_call_lead_id)
              : null,
            reviewed_targets: input.reviewed_targets.map((target) => ({
              lead_model: target.lead_model,
              lead_id: toObjectId(target.lead_id),
              source_granularity_id: toObjectId(target.source_granularity_id),
              timestamp: target.timestamp,
              cpl: target.cpl,
              cpl_rate_period: target.cpl_rate_period
                ? toObjectId(target.cpl_rate_period)
                : null,
              cpl_resolution_status:
                target.cpl_resolution_status ?? null,
              cpl_resolved_at: target.cpl_resolved_at ?? null,
              cpl_resolution_version:
                target.cpl_resolution_version ?? null,
              duplicate: target.duplicate === true,
            })),
            preview_hash: input.preview_hash,
            status: "pending",
            requested_by: {
              actor_type: input.actor.actorType,
              actor_id: input.actor.actorId,
              actor_label: input.actor.actorLabel,
              actor_role: input.actor.actorRole,
              request_id: input.actor.requestId,
            },
            reason: input.reason?.trim() || undefined,
            matched_count: input.matched_count,
          },
        ],
        { session },
      );
      return mapJobDoc(created!);
    },
    async findById(id) {
      if (!isObjectIdString(id)) return null;
      const doc = await model().findById(id).exec();
      return doc ? mapJobDoc(doc) : null;
    },
    async claimForProcessing(id, owner, leaseUntil, now) {
      if (!isObjectIdString(id)) return null;
      const doc = await model()
        .findOneAndUpdate(
          {
            _id: id,
            status: { $in: ["pending", "processing"] },
            $or: [
              { leased_until: { $exists: false } },
              { leased_until: null },
              { leased_until: { $lte: now } },
            ],
          },
          {
            $set: {
              status: "processing",
              lease_owner: owner,
              leased_until: leaseUntil,
              started_at: now,
            },
          },
          { returnDocument: "after" },
        )
        .exec();
      return doc ? mapJobDoc(doc) : null;
    },
    async renewLease(id, owner, leaseUntil, now) {
      const result = await model()
        .updateOne(
          {
            _id: id,
            lease_owner: owner,
            status: "processing",
            leased_until: { $gt: now },
          },
          { $set: { leased_until: leaseUntil } },
        )
        .exec();
      return result.modifiedCount === 1;
    },
    async releaseLease(id, owner) {
      await model()
        .updateOne(
          { _id: id, lease_owner: owner },
          { $unset: { leased_until: "", lease_owner: "" } },
        )
        .exec();
    },
    async updateProgress(id, owner, update, session) {
      const doc = await model()
        .findOneAndUpdate(
          {
            _id: id,
            status: "processing",
            lease_owner: owner,
          },
          {
            $set: {
              changed_count: update.changed_count,
              no_op_count: update.no_op_count,
              failed_count: update.failed_count,
              ...(update.cursor === null
                ? {}
                : update.cursor
                  ? {
                      cursor: {
                        lead_model: update.cursor.lead_model,
                        lead_id: update.cursor.lead_id,
                      },
                    }
                  : {}),
              ...(update.last_error !== undefined
                ? { last_error: update.last_error ?? undefined }
                : {}),
              ...(update.status ? { status: update.status } : {}),
              ...(update.completed_at ? { completed_at: update.completed_at } : {}),
              ...(update.cursor === null ? { cursor: null } : {}),
            },
          },
          { returnDocument: "after", session },
        )
        .exec();
      return doc ? mapJobDoc(doc) : null;
    },
    async cancel(id, now, session) {
      const doc = await model()
        .findOneAndUpdate(
          {
            _id: id,
            status: { $in: ["pending", "processing"] },
          },
          {
            $set: { status: "cancelled", completed_at: now },
            $unset: { leased_until: "", lease_owner: "" },
          },
          { returnDocument: "after", session },
        )
        .exec();
      return doc ? mapJobDoc(doc) : null;
    },
    async findClaimable(now, limit) {
      const docs = await model()
        .find({
          status: { $in: ["pending", "processing"] },
          $or: [
            { leased_until: { $exists: false } },
            { leased_until: null },
            { leased_until: { $lte: now } },
          ],
        })
        .sort({ createdAt: 1 })
        .limit(limit)
        .exec();
      return docs.map(mapJobDoc);
    },
  };
}

export function createMongoCplCorrectionGranularityStore(): CplCorrectionGranularityStore {
  const model = () => getLeadSourceGranularityModel();
  return {
    async getScheduleRevision(sourceGranularityId) {
      if (!isObjectIdString(sourceGranularityId)) return null;
      const doc = await model()
        .findById(sourceGranularityId)
        .select("schedule_revision")
        .lean()
        .exec();
      if (!doc) return null;
      return typeof doc.schedule_revision === "number" ? doc.schedule_revision : 0;
    },
  };
}

export function createDefaultCplCorrectionResolver(): CplCorrectionResolver {
  const granularityStore = createMongoCplCorrectionGranularityStore();
  const periodCache = new Map<
    string,
    ReturnType<typeof mongoCplScheduleStore.loadSchedule>
  >();
  return async (input) => {
    const currentRevision = await granularityStore.getScheduleRevision(
      input.source_granularity_id,
    );
    if (currentRevision !== input.target_schedule_revision) {
      throw new RegistryError(
        "Target CPL schedule changed during correction processing.",
        { registryCode: REGISTRY_ERROR_CODES.CPL_PREVIEW_STALE },
      );
    }
    const cacheKey = `${input.source_granularity_id}:${input.target_schedule_revision}`;
    let periodsPromise = periodCache.get(cacheKey);
    if (!periodsPromise) {
      periodsPromise = mongoCplScheduleStore.loadSchedule(
        input.source_granularity_id,
      );
      periodCache.set(cacheKey, periodsPromise);
    }
    const periods = await periodsPromise;
    return resolveCplFromPeriods(periods, {
      source_granularity_id: input.source_granularity_id,
      business_timestamp: storedLeadTimestampToCplInstant(
        input.business_timestamp,
      ),
      duplicate: input.duplicate,
    });
  };
}

export type CplCorrectionAnalyticsInvalidationSeam = {
  invalidate: CplCorrectionAnalyticsInvalidator;
  /** Parent wiring can replace this no-op default. */
  isConfigured: boolean;
};

let analyticsInvalidationSeam: CplCorrectionAnalyticsInvalidationSeam = {
  // Analytics are computed from production Lead collections at request time;
  // there is no materialized CPL cache to rebuild. This bounded completion
  // event is the invalidation/recalculation handoff and can be replaced if a
  // materialized adapter is introduced later.
  invalidate: async (request) => {
    await recordOperationalEvent({
      level: "info",
      eventKey: "analytics.cpl_correction.invalidated",
      category: "admin",
      workflow: "cpl_correction",
      summary: "Live Analytics will reflect corrected CPL Lead snapshots.",
      entity: { type: "cpl_correction_job", id: request.job_id },
      details: {
        source_granularity_id: request.source_granularity_id,
        window_from: request.window_from.toISOString(),
        window_until: request.window_until.toISOString(),
        changed_count: request.changed_count,
        analytics_mode: "live_query",
      },
      notificationCandidate: false,
    });
  },
  isConfigured: true,
};

/** Registers the bounded Analytics invalidation callback used after job completion. */
export function configureCplCorrectionAnalyticsInvalidation(
  invalidator: CplCorrectionAnalyticsInvalidator,
): void {
  analyticsInvalidationSeam = {
    invalidate: invalidator,
    isConfigured: true,
  };
}

export function getCplCorrectionAnalyticsInvalidationSeam(): CplCorrectionAnalyticsInvalidationSeam {
  return analyticsInvalidationSeam;
}

export function createDefaultCplCorrectionDependencies(
  overrides: Partial<CplCorrectionDependencies> = {},
): CplCorrectionDependencies {
  const seam = getCplCorrectionAnalyticsInvalidationSeam();
  return {
    jobStore: createMongoCplCorrectionJobStore(),
    leadStore: createMongoCplCorrectionLeadStore(),
    granularityStore: createMongoCplCorrectionGranularityStore(),
    resolveTargetCpl: createDefaultCplCorrectionResolver(),
    invalidateAnalytics: seam.invalidate,
    runMutation: withTransaction,
    ...overrides,
  };
}

export { targetAmount, resolutionToLeadFields, leadMatchesTarget };
