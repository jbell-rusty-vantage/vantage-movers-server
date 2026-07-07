import type { HydratedDocument } from "mongoose";
import {
  getCplForSource,
  normalizeSourceCompany,
  type LocalType,
} from "../../config/domain";
import { CallLead, type CallLeadDocument } from "../../models/CallLead";
import { normalizePhoneNumberForMatch } from "../../utils/phone";
import type {
  CallLeadEnrichmentBatchInput,
  CallLeadEnrichmentRowInput,
} from "../../validation/v1.validation";
import {
  finalizeSheetSync,
  persistSheetSyncIntent,
  runSheetSyncWrite,
  type FullSheetSyncJob,
} from "../sheetSync";
import {
  cleanValue,
  parseEnrichmentRow,
  validateParsedRow,
  type ParsedCallLeadEnrichmentRow,
  type ParsedCallLeadEnrichmentRowWithWarnings,
} from "./callLeadEnrichmentRows";
import {
  applyGranotCrmUsernameReceiverMatch,
  type ReceiverAgentCrmUsernameMatchResult,
} from "../agents/receiverAgentCrmUsername";

export type CallLeadEnrichmentStatus =
  | "updateable"
  | "updated"
  | "unchanged"
  | "conflict"
  | "no_match"
  | "invalid"
  | "failed";

export type CallLeadMatchMethod =
  | "phone_and_job_no"
  | "phone_only"
  | "job_no_only"
  | "none";

export type CallLeadEnrichmentResult = {
  row_id: string;
  status: CallLeadEnrichmentStatus;
  message: string;
  call_lead_id?: string;
  matched_phone_number?: string;
  job_no?: string;
  /** How we found the matched call lead in the database. */
  match_method?: CallLeadMatchMethod;
  /** Whether the matched call lead has a booking attached (BookedLead present). */
  has_booking?: boolean;
  /** Name snapshot of the agent already linked as `receiver_agent`, if any. */
  receiver_agent_name_snapshot?: string;
  /** CRM username of the linked receiver Agent, when known. */
  receiver_agent_granot_crm_username?: string;
  changes: string[];
  warnings: string[];
  parsed?: ParsedCallLeadEnrichmentRow;
};

type ResolvedEnrichment = {
  result: CallLeadEnrichmentResult;
  lead?: HydratedDocument<CallLeadDocument>;
  update?: Partial<CallLeadDocument>;
};

export async function previewCallLeadEnrichment(
  input: CallLeadEnrichmentBatchInput,
): Promise<CallLeadEnrichmentResult[]> {
  const results: CallLeadEnrichmentResult[] = [];
  for (const row of input.rows) {
    results.push((await resolveEnrichmentRow(row)).result);
  }
  return results;
}

export async function syncCallLeadEnrichment(
  input: CallLeadEnrichmentBatchInput,
): Promise<CallLeadEnrichmentResult[]> {
  const results: CallLeadEnrichmentResult[] = [];
  for (const row of input.rows) {
    try {
      const resolved = await resolveEnrichmentRow(row);
      const receiverMatch = resolved.lead
        ? await applyGranotCrmUsernameReceiverMatch(
            resolved.lead,
            row.granot_crm_username,
          )
        : undefined;
      const canWrite =
        resolved.result.status === "updateable" ||
        resolved.result.status === "unchanged";
      if (
        !canWrite ||
        !resolved.lead ||
        (!resolved.update && !receiverMatch?.changed)
      ) {
        results.push(applyReceiverMatchResult(resolved.result, receiverMatch));
        continue;
      }

      if (resolved.update) {
        Object.assign(resolved.lead, resolved.update);
      }
      if (resolved.update?.local || resolved.update?.source_company) {
        resolved.lead.cpl =
          resolved.result.parsed?.source_cpl ??
          (await getCplForSource(
            normalizeSourceCompany(resolved.lead.source_company),
            "call",
            resolved.lead.local as LocalType | undefined,
          ));
      }
      const lead = resolved.lead;
      const job: FullSheetSyncJob = {
        resource: "source_lead",
        operation: "call_lead.enrichment.sync",
        leadModel: "CallLead",
        leadId: lead._id.toString(),
      };
      await runSheetSyncWrite(async (session) => {
        await lead.save({ session });
        await persistSheetSyncIntent(job, session);
      });
      await finalizeSheetSync(job);
      const result = applyReceiverMatchResult(resolved.result, receiverMatch);
      results.push({
        ...result,
        status: "updated",
        message: buildSyncMessage(resolved.lead._id.toString(), receiverMatch),
        changes: mergeReceiverChanges(result.changes, receiverMatch),
      });
    } catch (error) {
      results.push({
        row_id: row.row_id,
        status: "failed",
        message: error instanceof Error ? error.message : String(error),
        changes: [],
        warnings: [],
      });
    }
  }
  return results;
}

function applyReceiverMatchResult(
  result: CallLeadEnrichmentResult,
  match: ReceiverAgentCrmUsernameMatchResult | undefined,
): CallLeadEnrichmentResult {
  if (!match || match.status === "empty") {
    return result;
  }

  const warnings = [...result.warnings];
  if (match.status === "not_found") {
    warnings.push(match.message);
  } else if (match.status === "already_linked") {
    warnings.push(
      `Receiver Agent already set; CRM username ${match.username} did not overwrite it.`,
    );
  }

  return {
    ...result,
    ...(match.status === "matched"
      ? {
          receiver_agent_name_snapshot: match.agentName,
          receiver_agent_granot_crm_username: match.username,
        }
      : {}),
    warnings,
  };
}

function mergeReceiverChanges(
  changes: string[],
  match: ReceiverAgentCrmUsernameMatchResult | undefined,
): string[] {
  if (match?.status !== "matched") {
    return changes;
  }
  return Array.from(new Set([...changes, "receiver_agent"]));
}

function buildSyncMessage(
  leadId: string,
  match: ReceiverAgentCrmUsernameMatchResult | undefined,
): string {
  const base = `Updated call lead ${leadId}.`;
  return match?.status === "matched" ? `${base} ${match.message}` : base;
}

async function resolveEnrichmentRow(
  row: CallLeadEnrichmentRowInput,
): Promise<ResolvedEnrichment> {
  const parsed = await parseEnrichmentRow(row);
  const base = resultBase(row.row_id, parsed);
  const invalidReasons = validateParsedRow(parsed);
  if (invalidReasons.length > 0) {
    return {
      result: {
        ...base,
        status: "invalid",
        message: invalidReasons.join(" "),
      },
    };
  }

  const { lead, warnings, matchMethod } = await findBestCallLeadMatch(
    parsed.normalized_phone_number,
    parsed.job_no,
  );
  if (!lead) {
    const identityParts: string[] = [];
    if (parsed.normalized_phone_number) {
      identityParts.push(`phone ${parsed.normalized_phone_number}`);
    }
    if (parsed.job_no) {
      identityParts.push(`job_no ${parsed.job_no}`);
    }
    const identity = identityParts.length ? identityParts.join(" or ") : "the provided identifiers";
    return {
      result: {
        ...base,
        status: "no_match",
        match_method: "none",
        message: `Not found in Vantage by ${identity}. This can happen if the customer's phone has been switched in Granot or the lead is older than the system's retention window.`,
      },
    };
  }

  const leadId = lead._id.toString();
  base.call_lead_id = leadId;
  base.matched_phone_number = lead.phone_number ?? undefined;
  base.match_method = matchMethod;
  base.has_booking = Boolean(lead.booked);
  base.receiver_agent_name_snapshot = lead.receiver_agent_name_snapshot ?? undefined;
  base.warnings.push(...warnings);

  const existingJobNo = cleanValue(lead.job_no);
  const hasJobConflict =
    Boolean(existingJobNo) && existingJobNo !== parsed.job_no;
  if (hasJobConflict) {
    base.warnings.push(
      `Existing call lead already has job_no ${existingJobNo}; CRM row has ${parsed.job_no}. The job_no will be left as-is during sync.`,
    );
  }

  const update = buildUpdate(lead, parsed, base.warnings, {
    skipJobNo: hasJobConflict,
  });
  const changes = Object.keys(update);

  if (lead.booked) {
    if (changes.length === 0) {
      return {
        lead,
        result: {
          ...base,
          status: "unchanged",
          message: buildBookingAttachedMessage(matchMethod, true),
        },
      };
    }
    return {
      lead,
      update,
      result: {
        ...base,
        status: "updateable",
        message: buildBookingAttachedMessage(matchMethod, false, changes.length),
        changes,
      },
    };
  }

  if (changes.length === 0) {
    return {
      lead,
      result: {
        ...base,
        status: "unchanged",
        message: buildNoBookingMessage(matchMethod, true),
      },
    };
  }

  return {
    lead,
    update,
    result: {
      ...base,
      status: "updateable",
      message: buildNoBookingMessage(matchMethod, false, changes.length),
      changes,
    },
  };
}

function buildBookingAttachedMessage(
  method: CallLeadMatchMethod | undefined,
  upToDate: boolean,
  changeCount = 0,
): string {
  const how = formatMatchMethod(method);
  if (upToDate) {
    return `Found call lead ${how}. This call lead already has a booking attached; running sync is idempotent (no fields will change).`;
  }
  return `Found call lead ${how}. This call lead has a booking attached, but ${changeCount} field(s) on the call lead will be refreshed from the CRM row.`;
}

function buildNoBookingMessage(
  method: CallLeadMatchMethod | undefined,
  upToDate: boolean,
  changeCount = 0,
): string {
  const how = formatMatchMethod(method);
  if (upToDate) {
    return `Found call lead ${how}. No booking attached and all fields already match; running sync is idempotent.`;
  }
  return `Found call lead ${how}. No booking attached. Sync will update ${changeCount} field(s) on the call lead.`;
}

function formatMatchMethod(method: CallLeadMatchMethod | undefined): string {
  switch (method) {
    case "phone_and_job_no":
      return "by phone_number AND job_no";
    case "phone_only":
      return "by phone_number only";
    case "job_no_only":
      return "by job_no only";
    default:
      return "in Vantage";
  }
}

async function findBestCallLeadMatch(
  normalizedPhone: string | undefined,
  jobNo: string | undefined,
): Promise<{
  lead?: HydratedDocument<CallLeadDocument>;
  warnings: string[];
  matchMethod: CallLeadMatchMethod;
}> {
  const candidates = normalizedPhone
    ? (
        await CallLead.find({
          $or: [
            { normalized_phone_number: normalizedPhone },
            { phone_number: buildPhoneRegex(normalizedPhone) },
          ],
        })
          .sort({ createdAt: -1 })
          .limit(25)
          .exec()
      ).filter(
        (lead) =>
          normalizePhoneNumberForMatch(lead.phone_number) === normalizedPhone,
      )
    : [];

  if (candidates.length > 0) {
    const activeCandidates = candidates.filter(
      (lead) => !lead.booked && !lead.cancelled,
    );
    const ranked = activeCandidates.length > 0 ? activeCandidates : candidates;
    ranked.sort(compareCallLeadRecency);
    const warnings: string[] = [];
    if (candidates.length > 1) {
      warnings.push(
        `Multiple call leads matched phone ${normalizedPhone}; selected newest eligible lead.`,
      );
    }
    const selected = ranked[0];
    const selectedJobNo = cleanValue(selected.job_no);
    const matchMethod: CallLeadMatchMethod =
      jobNo && selectedJobNo === jobNo ? "phone_and_job_no" : "phone_only";
    return { lead: selected, warnings, matchMethod };
  }

  if (jobNo) {
    const byJobNo = await CallLead.find({ job_no: jobNo })
      .sort({ createdAt: -1 })
      .limit(5)
      .exec();
    if (byJobNo.length > 0) {
      byJobNo.sort(compareCallLeadRecency);
      const warnings: string[] = [];
      if (byJobNo.length > 1) {
        warnings.push(
          `Multiple call leads matched job_no ${jobNo}; selected newest eligible lead.`,
        );
      }
      return {
        lead: byJobNo[0],
        warnings,
        matchMethod: "job_no_only",
      };
    }
  }

  return { warnings: [], matchMethod: "none" };
}

function buildUpdate(
  lead: HydratedDocument<CallLeadDocument>,
  parsed: ParsedCallLeadEnrichmentRow,
  warnings: string[],
  options?: { skipJobNo?: boolean },
): Partial<CallLeadDocument> {
  const update: Partial<CallLeadDocument> = {};
  if (!options?.skipJobNo) {
    assignIfChanged(update, lead, "job_no", parsed.job_no);
  }
  if (parsed.source_assignment) {
    assignSourceAssignmentIfChanged(update, lead, parsed.source_assignment);
  } else {
    assignIfChanged(update, lead, "source_company", parsed.source_company);
  }
  assignIfChanged(update, lead, "name", parsed.name);
  assignIfChanged(update, lead, "email", parsed.email);
  assignIfChanged(update, lead, "pickup_zip", parsed.pickup_zip);
  assignIfChanged(update, lead, "delivery_zip", parsed.delivery_zip);
  assignIfChanged(update, lead, "pickup_state", parsed.pickup_state);
  assignIfChanged(update, lead, "delivery_state", parsed.delivery_state);
  assignNumberIfChanged(update, lead, "cubic_feet", parsed.cubic_feet);

  if (parsed.local) {
    assignIfChanged(update, lead, "local", parsed.local);
  } else if (lead.local) {
    warnings.push("Preserved existing local value because one or both states were unresolved.");
  }

  return update;
}

function assignSourceAssignmentIfChanged(
  update: Partial<CallLeadDocument>,
  lead: HydratedDocument<CallLeadDocument>,
  assignment: NonNullable<ParsedCallLeadEnrichmentRow["source_assignment"]>,
) {
  assignIfChanged(
    update,
    lead,
    "source_company",
    assignment.source_company as CallLeadDocument["source_company"],
  );
  assignIfChanged(update, lead, "lead_source_company", assignment.lead_source_company);
  assignIfChanged(update, lead, "source_granularity_id", assignment.source_granularity_id);
  assignIfChanged(update, lead, "source_granularity_key", assignment.source_granularity_key);
  assignIfChanged(
    update,
    lead,
    "source_company_label_snapshot",
    assignment.source_company_label_snapshot,
  );
  assignIfChanged(
    update,
    lead,
    "source_granularity_label_snapshot",
    assignment.source_granularity_label_snapshot,
  );
  assignIfChanged(update, lead, "crm_source_label_snapshot", assignment.crm_source_label_snapshot);
}

function assignIfChanged<K extends keyof CallLeadDocument>(
  update: Partial<CallLeadDocument>,
  lead: HydratedDocument<CallLeadDocument>,
  key: K,
  value: CallLeadDocument[K] | undefined,
) {
  if (value === undefined || value === null) {
    return;
  }
  if (String(lead[key] ?? "") === String(value)) {
    return;
  }
  update[key] = value;
}

function assignNumberIfChanged<K extends keyof CallLeadDocument>(
  update: Partial<CallLeadDocument>,
  lead: HydratedDocument<CallLeadDocument>,
  key: K,
  value: number | undefined,
) {
  if (value === undefined) {
    return;
  }
  if (Number(lead[key]) === value) {
    return;
  }
  update[key] = value as CallLeadDocument[K];
}

function resultBase(
  rowId: string,
  parsed: ParsedCallLeadEnrichmentRowWithWarnings,
): CallLeadEnrichmentResult {
  return {
    row_id: rowId,
    status: "invalid",
    message: "",
    job_no: parsed.job_no,
    parsed,
    changes: [],
    warnings: parsed.warnings ?? [],
  };
}

function compareCallLeadRecency(
  a: HydratedDocument<CallLeadDocument>,
  b: HydratedDocument<CallLeadDocument>,
): number {
  return getLeadTime(b) - getLeadTime(a);
}

function getLeadTime(lead: HydratedDocument<CallLeadDocument>): number {
  const doc = lead as HydratedDocument<CallLeadDocument> & { createdAt?: Date };
  return (lead.timestamp ?? doc.createdAt ?? new Date(0)).getTime();
}

/**
 * Mongo-side regex sieve used to widen the phone-number candidate set.
 *
 * Includes a leading word-boundary `(?:^|\\D)` (vs. the leads helper which
 * deliberately omits it) so the sieve never matches the suffix of a longer
 * stored value. Callers always re-verify exact matches in memory via
 * `normalizePhoneNumberForMatch`.
 */
function buildPhoneRegex(normalizedPhone: string): RegExp {
  const digits = normalizedPhone.replace(/\D/g, "");
  return new RegExp(`(?:^|\\D)${digits.split("").join("\\D*")}(?:\\D|$)`);
}
