import { resolveSourceCompanyFromLabel } from "../../config/domain";
import { getFormLeadModel, type FormLeadDocument } from "../../models/FormLead";
import { parseGranotCityState, parseGranotZip } from "../../utils/location/granotLocation";
import { findAgentByGranotCrmUsername, normalizeGranotCrmUsername } from "../agents/receiverAgentCrmUsername";
import { searchFormLeads, type FormLeadSearchMatch } from "../search/formLeadSearch.service";
import type { GranotReportRow, GranotSourceCollection } from "./index";

export type GranotFormPatch = {
  quoted?: boolean;
  cubic_feet?: number;
  pickup_city?: string;
  pickup_zip?: string;
  pickup_state?: string;
  delivery_city?: string;
  destination_zip?: string;
  delivery_state?: string;
  receiver_agent?: string;
  receiver_agent_name_snapshot?: string;
  receiver_agent_source?: "extension_crm_username_match";
  receiver_agent_source_value?: string;
  receiver_agent_set_at?: string;
};

export type GranotFormPlanAction = {
  action_id: string;
  row_id: string;
  source_label: string;
  classification: "update" | "unchanged" | "conflict" | "no_match" | "invalid";
  match_method?: "ref_no_exact" | "fallback";
  lead_id?: string;
  patch?: GranotFormPatch;
  expected?: Record<string, unknown>;
  reason?: string;
};

export type GranotFormPlan = {
  kind: "form_leads";
  schema_version: 1;
  actions: GranotFormPlanAction[];
  counters: Record<GranotFormPlanAction["classification"], number>;
};

type LeadLike = FormLeadDocument & {
  createdAt: Date;
  get(path: string): unknown;
};

export type GranotFormWorkflowDependencies = {
  findExactRefMatches?: (refNo: string) => Promise<LeadLike[]>;
  search?: typeof searchFormLeads;
  resolveAgent?: typeof findAgentByGranotCrmUsername;
  beforeRow?: () => void | Promise<void>;
};

export async function planGranotFormWorkflow(
  sources: GranotSourceCollection[],
  dependencies: GranotFormWorkflowDependencies = {},
): Promise<GranotFormPlan> {
  const actions: GranotFormPlanAction[] = [];
  for (const source of sources) {
    for (const row of [...source.sections.bookedJobs, ...source.sections.followUpEstimates]) {
      await dependencies.beforeRow?.();
      actions.push(await planRow(source.sourceLabel, row, dependencies));
    }
  }
  return {
    kind: "form_leads",
    schema_version: 1,
    actions,
    counters: countActions(actions),
  };
}

async function planRow(
  sourceLabel: string,
  row: GranotReportRow,
  dependencies: GranotFormWorkflowDependencies,
): Promise<GranotFormPlanAction> {
  const actionId = `${sourceLabel}:${row.id}`;
  const refNo = clean(row.values.ref_no);
  let lead: LeadLike | undefined;
  let matchMethod: GranotFormPlanAction["match_method"];
  if (refNo) {
    const exact = await (
      dependencies.findExactRefMatches ?? findExactRefMatches
    )(refNo);
    if (exact.length > 1) {
      return conflict(actionId, row.id, sourceLabel, "duplicate_exact_ref");
    }
    if (exact.length === 1) {
      lead = exact[0];
      matchMethod = "ref_no_exact";
    }
  }

  if (!lead) {
    const search = await (dependencies.search ?? searchFormLeads)({
      phone_number: clean(row.values.phone),
      email: clean(row.values.email),
      name: clean(row.values.customer),
      limit: 25,
      include_duplicates: false,
    });
    const selected = selectGranotFormFallback(
      search.matches,
      sourceLabel,
      row.values.prior,
    );
    if (selected.status === "conflict") {
      return conflict(actionId, row.id, sourceLabel, "ambiguous_fallback");
    }
    if (!selected.lead) {
      return {
        action_id: actionId,
        row_id: row.id,
        source_label: sourceLabel,
        classification: "no_match",
        reason: "No non-quarantined FormLead matched phone, email, or name.",
      };
    }
    lead = selected.lead;
    matchMethod = "fallback";
  }

  const patch = await buildGranotFormPatch(
    lead,
    row,
    dependencies.resolveAgent,
  );
  const changed = Object.entries(patch).filter(
    ([path, value]) => !sameValue(lead!.get(path), value),
  );
  if (!changed.length) {
    return {
      action_id: actionId,
      row_id: row.id,
      source_label: sourceLabel,
      classification: "unchanged",
      match_method: matchMethod,
      lead_id: String(lead._id),
    };
  }
  const changedPatch = Object.fromEntries(changed) as GranotFormPatch;
  return {
    action_id: actionId,
    row_id: row.id,
    source_label: sourceLabel,
    classification: "update",
    match_method: matchMethod,
    lead_id: String(lead._id),
    patch: changedPatch,
    expected: Object.fromEntries(
      changed.map(([path]) => [path, serializeExpected(lead!.get(path))]),
    ),
  };
}

async function findExactRefMatches(refNo: string): Promise<LeadLike[]> {
  const FormLead = getFormLeadModel();
  return (await FormLead.find({
    ref_no: refNo,
    duplicate: { $ne: true },
  })
    .limit(3)
    .exec()) as unknown as LeadLike[];
}

export function selectGranotFormFallback(
  matches: FormLeadSearchMatch[],
  sourceLabel: string,
  prior: string | undefined,
): { lead?: LeadLike; status: "found" | "not_found" | "conflict" } {
  if (!matches.length) return { status: "not_found" };
  const bestScore = matches[0].score;
  let candidates = matches.filter((match) => match.score === bestScore);
  const sourceCompany = resolveSourceCompanyFromLabel(sourceLabel);
  if (sourceCompany) {
    const sourceMatches = candidates.filter(
      ({ lead }) => String(lead.source_company ?? "") === sourceCompany,
    );
    if (sourceMatches.length) candidates = sourceMatches;
  }
  if (candidates.length > 1 && ["0", "1", "5"].includes(prior ?? "")) {
    const expectedQuoted = prior === "1" || prior === "5";
    const quotedMatches = candidates.filter(
      ({ lead }) => lead.quoted === expectedQuoted,
    );
    if (quotedMatches.length) candidates = quotedMatches;
  }
  return candidates.length === 1
    ? { status: "found", lead: candidates[0].lead as unknown as LeadLike }
    : { status: "conflict" };
}

export async function buildGranotFormPatch(
  lead: LeadLike,
  row: GranotReportRow,
  resolveAgent: typeof findAgentByGranotCrmUsername = findAgentByGranotCrmUsername,
): Promise<GranotFormPatch> {
  const patch: GranotFormPatch = {};
  if (row.values.prior === "1" || row.values.prior === "5") {
    patch.quoted = true;
    const cubicFeet = parseNumber(row.values.est_cf);
    if (cubicFeet !== undefined) patch.cubic_feet = cubicFeet;
  }
  const pickup = parseGranotCityState(row.values.from);
  const delivery = parseGranotCityState(row.values.to);
  const pickupZip = parseGranotZip(row.values.from_zip);
  const deliveryZip = parseGranotZip(row.values.to_zip);
  fillMissing(patch, "pickup_city", lead.pickup_city, pickup?.city);
  if (
    isMissingZip(lead.pickup_zip) &&
    (isMissingState(lead.pickup_state) ||
      statesMatch(lead.pickup_state, pickup?.state))
  ) {
    fillMissing(patch, "pickup_zip", lead.pickup_zip, pickupZip);
  }
  if (
    pickup?.state &&
    isMissingState(lead.pickup_state) &&
    (isMissingZip(lead.pickup_zip) || lead.pickup_zip?.trim() === pickupZip)
  ) {
    patch.pickup_state = pickup.state;
  }
  fillMissing(patch, "delivery_city", lead.delivery_city, delivery?.city);
  if (
    isMissingZip(lead.destination_zip) &&
    (isMissingState(lead.delivery_state) ||
      statesMatch(lead.delivery_state, delivery?.state))
  ) {
    fillMissing(patch, "destination_zip", lead.destination_zip, deliveryZip);
  }
  if (
    delivery?.state &&
    isMissingState(lead.delivery_state) &&
    (isMissingZip(lead.destination_zip) ||
      lead.destination_zip?.trim() === deliveryZip)
  ) {
    patch.delivery_state = delivery.state;
  }
  if (!lead.receiver_agent) {
    const username = normalizeGranotCrmUsername(row.values.user || row.values.rep);
    const agent = username ? await resolveAgent(username) : undefined;
    if (agent) {
      patch.receiver_agent = agent.id;
      patch.receiver_agent_name_snapshot = agent.name;
      patch.receiver_agent_source = "extension_crm_username_match";
      patch.receiver_agent_source_value = username;
      patch.receiver_agent_set_at = new Date().toISOString();
    }
  }
  return patch;
}

function fillMissing<K extends keyof GranotFormPatch>(
  patch: GranotFormPatch,
  key: K,
  current: unknown,
  value: GranotFormPatch[K] | undefined,
): void {
  if ((current === undefined || current === null || current === "") && value !== undefined) {
    patch[key] = value;
  }
}

function isMissingZip(value: string | null | undefined): boolean {
  const normalized = value?.trim();
  return !normalized || /^0+$/.test(normalized);
}

function isMissingState(value: string | null | undefined): boolean {
  const normalized = value?.trim().toLowerCase();
  return !normalized || normalized === "," || normalized === "not_found";
}

function statesMatch(
  current: string | null | undefined,
  candidate: string | undefined,
): boolean {
  return Boolean(
    candidate && current?.trim().toUpperCase() === candidate.toUpperCase(),
  );
}

function conflict(
  actionId: string,
  rowId: string,
  sourceLabel: string,
  reason: string,
): GranotFormPlanAction {
  return {
    action_id: actionId,
    row_id: rowId,
    source_label: sourceLabel,
    classification: "conflict",
    reason,
  };
}

function clean(value: string | undefined): string | undefined {
  return value?.replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim() || undefined;
}

function parseNumber(value: string | undefined): number | undefined {
  const parsed = Number(clean(value)?.replace(/,/g, ""));
  return Number.isFinite(parsed) ? parsed : undefined;
}

function sameValue(left: unknown, right: unknown): boolean {
  return JSON.stringify(serializeExpected(left)) === JSON.stringify(serializeExpected(right));
}

function serializeExpected(value: unknown): unknown {
  if (value === undefined) return null;
  if (value instanceof Date) return value.toISOString();
  if (typeof value === "object" && value !== null && "toString" in value) {
    return String(value);
  }
  return value;
}

function countActions(
  actions: GranotFormPlanAction[],
): GranotFormPlan["counters"] {
  const counters = { update: 0, unchanged: 0, conflict: 0, no_match: 0, invalid: 0 };
  for (const action of actions) counters[action.classification] += 1;
  return counters;
}

// Kept exported for focused tests of the strict fallback identity vocabulary.
export const granotFormIdentityFields = Object.freeze([
  "ref_no",
  "phone_number",
  "email",
  "name",
]);
