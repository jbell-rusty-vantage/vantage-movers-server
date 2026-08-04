import { BookedLead } from "../../models/BookedLead";
import { CallLead } from "../../models/CallLead";
import { CancelledLead } from "../../models/CancelledLead";
import { FormLead } from "../../models/FormLead";
import { toFloridaTimestamp } from "../../utils/easternTime";
import type {
  BestRelocationApplicationPlan,
  BestRelocationPlanAction,
} from "./applicationPlan";
import {
  evaluateSourceOwnedLeadUpdate,
  sourceOwnedPaths,
} from "./updatePolicy";

export async function planBootstrapAdoption(
  sourcePlan: BestRelocationApplicationPlan,
): Promise<BestRelocationApplicationPlan> {
  if (sourcePlan.trigger !== "bootstrap") {
    throw new Error("Bootstrap adoption requires a bootstrap plan");
  }
  const actions: BestRelocationPlanAction[] = [];
  const adoptedByAction = new Map<
    string,
    BootstrapCandidate[]
  >();
  const canonicalFinancial = {
    binder_amount: 0,
    deposit_amount: 0,
    refund_amount: 0,
  };
  for (const action of sourcePlan.actions) {
    if (action.command === "record_conflict") {
      actions.push(action);
      continue;
    }
    if (
      action.command === "unchanged" ||
      action.command === "adopt_existing"
    ) {
      actions.push(action);
      continue;
    }
    const candidates = await findCandidates(action, adoptedByAction);
    if (candidates.length === 1) {
      adoptedByAction.set(action.action_key, candidates);
      canonicalFinancial.binder_amount += candidates[0].binder_amount ?? 0;
      canonicalFinancial.deposit_amount += candidates[0].deposit_amount ?? 0;
      canonicalFinancial.refund_amount += candidates[0].refund_amount ?? 0;
      actions.push({
        ...action,
        command: "adopt_existing",
        classification: "adoption",
        adopted_entity_refs: entityRefs(candidates),
      });
    } else {
      actions.push({
        ...action,
        command: "record_conflict",
        classification: "conflict",
        conflict: {
          type:
            candidates.length > 1
              ? "ambiguous_lead_match"
              : "canonical_divergence",
          severity: "blocking",
        },
        adopted_entity_refs: entityRefs(candidates),
      });
    }
  }
  const sourceFinancial = financialSummary(sourcePlan.actions);
  return {
    ...sourcePlan,
    actions,
    counters: actions.reduce<Record<string, number>>((counts, action) => {
      counts[action.classification] =
        (counts[action.classification] ?? 0) + 1;
      return counts;
    }, {}),
    bootstrap_reconciliation: {
      source_actions: sourcePlan.actions.filter(
        (action) => action.command !== "record_conflict",
      ).length,
      adopted: actions.filter(
        (action) => action.classification === "adoption",
      ).length,
      blocking_discrepancies: actions.filter(
        (action) =>
          action.classification === "conflict" &&
          action.conflict?.severity === "blocking",
      ).length,
      financial: sourceFinancial,
      canonical_financial: canonicalFinancial,
      financial_difference: {
        binder_amount:
          sourceFinancial.binder_amount - canonicalFinancial.binder_amount,
        deposit_amount:
          sourceFinancial.deposit_amount - canonicalFinancial.deposit_amount,
        refund_amount:
          sourceFinancial.refund_amount - canonicalFinancial.refund_amount,
      },
    },
  };
}

async function findCandidates(
  action: BestRelocationPlanAction,
  adoptedByAction: ReadonlyMap<
    string,
    BootstrapCandidate[]
  >,
): Promise<BootstrapCandidate[]> {
  const payload = action.command_payload ?? {};
  if (action.command === "create_form_lead") {
    const identities = [
      typeof payload.ref_no === "string" ? payload.ref_no : undefined,
      typeof payload.lid === "string" ? payload.lid : undefined,
    ].filter((value): value is string => Boolean(value));
    if (!identities.length) return [];
    const docs = await FormLead.find({
      source_company: "best_relocation_leads",
      $or: [
        { ref_no: { $in: identities } },
        { lid: { $in: identities } },
        { normalized_lid: { $in: identities.map((value) => value.toLowerCase()) } },
      ],
    })
      .select(`_id ${sourceOwnedPaths("FormLead").join(" ")}`)
      .limit(2)
      .lean()
      .exec();
    return docs
      .filter((doc) =>
        leadSourceValuesMatch(
          "FormLead",
          action.source_owned_values ?? payload,
          doc as unknown as Record<string, unknown>,
        ),
      )
      .map((doc) => ({ model: "FormLead", id: String(doc._id) }));
  }
  if (action.command === "create_call_lead") {
    const phone = String(payload.phone_number ?? "").replace(/\D/g, "").slice(-10);
    const timestamp = payload.timestamp ? new Date(String(payload.timestamp)) : null;
    if (!phone || !timestamp || !Number.isFinite(timestamp.getTime())) return [];
    const persistedTimestamp = toFloridaTimestamp(timestamp);
    const docs = await CallLead.find({
      source_company: "best_relocation_leads",
      normalized_phone_number: phone,
      duplicate: { $ne: true },
      timestamp: {
        $gte: new Date(persistedTimestamp.getTime() - 1_000),
        $lte: new Date(persistedTimestamp.getTime() + 1_000),
      },
    })
      .select(`_id ${sourceOwnedPaths("CallLead").join(" ")}`)
      .limit(2)
      .lean()
      .exec();
    return docs
      .filter((doc) =>
        leadSourceValuesMatch(
          "CallLead",
          action.source_owned_values ?? payload,
          doc as unknown as Record<string, unknown>,
        ),
      )
      .map((doc) => ({ model: "CallLead", id: String(doc._id) }));
  }
  if (
    action.command === "create_booked_from_source" ||
    action.command === "create_leadless_booking"
  ) {
    const normalized = String(
      payload.job_no ?? payload.call_job_no ?? "",
    )
      .toUpperCase()
      .replace(/[^A-Z0-9]/g, "");
    if (!normalized) return [];
    const adoptedLead = action.depends_on.flatMap(
      (dependency) => adoptedByAction.get(dependency) ?? [],
    );
    const docs = await BookedLead.find({ normalized_job_no: normalized })
      .select(
        "_id total_binder_amount deposit_amount merchant book_date source customer_name agent_allocations lead_ref lead_model is_leadless_booking",
      )
      .limit(2)
      .lean()
      .exec();
    return docs
      .filter(
        (doc) =>
          moneyEqual(doc.total_binder_amount, payload.total_binder_amount) &&
          moneyEqual(doc.deposit_amount, payload.deposit_amount) &&
          normalizedText(doc.merchant) === normalizedText(payload.merchant) &&
          sameDate(doc.book_date, payload.book_date) &&
          normalizedText(doc.source) === normalizedText(payload.source) &&
          bookingOwnershipMatches(
            action,
            payload,
            doc as unknown as Record<string, unknown>,
            adoptedLead,
          ),
      )
      .map((doc) => ({
        model: "BookedLead",
        id: String(doc._id),
        binder_amount: numeric(doc.total_binder_amount),
        deposit_amount: numeric(doc.deposit_amount),
      }));
  }
  if (action.command === "create_cancelled_lead") {
    const bookingIds = action.depends_on.flatMap(
      (dependency) => adoptedByAction.get(dependency) ?? [],
    );
    if (bookingIds.length !== 1 || bookingIds[0].model !== "BookedLead") {
      return [];
    }
    const docs = await CancelledLead.find({
      booked_lead: bookingIds[0].id,
    })
      .select("_id refund_amount cancel_date reason")
      .limit(2)
      .lean()
      .exec();
    return docs
      .filter(
        (doc) =>
          moneyEqual(doc.refund_amount, payload.refund_amount) &&
          sameDate(doc.cancel_date, payload.cancel_date) &&
          normalizedText(doc.reason) === normalizedText(payload.reason),
      )
      .map((doc) => ({
        model: "CancelledLead",
        id: String(doc._id),
        refund_amount: numeric(doc.refund_amount),
      }));
  }
  return [];
}

type BootstrapCandidate = {
  model: string;
  id: string;
  binder_amount?: number;
  deposit_amount?: number;
  refund_amount?: number;
};

function entityRefs(
  candidates: readonly BootstrapCandidate[],
): Array<{ model: string; id: string }> {
  return candidates.map(({ model, id }) => ({ model, id }));
}

function bookingOwnershipMatches(
  action: BestRelocationPlanAction,
  payload: Record<string, unknown>,
  doc: Record<string, unknown>,
  adoptedLead: readonly BootstrapCandidate[],
): boolean {
  if (action.command === "create_leadless_booking") {
    return (
      doc.is_leadless_booking === true &&
      !doc.lead_ref &&
      normalizedText(doc.customer_name) ===
        normalizedText(payload.customer_name) &&
      agentNamesMatch(doc.agent_allocations, [
        payload.agent,
        payload.split_agent,
      ])
    );
  }
  if (adoptedLead.length !== 1) return false;
  return (
    doc.is_leadless_booking !== true &&
    String(doc.lead_ref ?? "") === adoptedLead[0].id &&
    String(doc.lead_model ?? "") === String(payload.lead_model ?? "") &&
    agentAllocationsMatch(doc.agent_allocations, payload.agent_allocations)
  );
}

function agentNamesMatch(
  actual: unknown,
  expected: unknown[],
): boolean {
  const actualNames = Array.isArray(actual)
    ? actual.map((entry) =>
        normalizedText(
          isRecord(entry)
            ? entry.agent_name_snapshot ?? entry.agent_name ?? entry.agent
            : undefined,
        ),
      )
    : [];
  const expectedNames = expected
    .map(normalizedText)
    .filter(Boolean);
  return (
    actualNames.length === expectedNames.length &&
    actualNames.every((name, index) => name === expectedNames[index])
  );
}

function agentAllocationsMatch(actual: unknown, expected: unknown): boolean {
  if (!Array.isArray(actual) || !Array.isArray(expected)) return false;
  return (
    actual.length === expected.length &&
    actual.every((entry, index) => {
      const expectedEntry = expected[index];
      if (!isRecord(entry) || !isRecord(expectedEntry)) return false;
      return (
        normalizedText(
          entry.agent_name_snapshot ?? entry.agent_name ?? entry.agent,
        ) ===
          normalizedText(expectedEntry.agent_name ?? expectedEntry.agent) &&
        moneyEqual(entry.binder_amount, expectedEntry.binder_amount)
      );
    })
  );
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null;
}

function financialSummary(actions: BestRelocationPlanAction[]) {
  const seen = new Set<string>();
  return actions.reduce(
    (summary, action) => {
      const evidenceKey = `${action.dataset_key}:${action.stable_source_row_id}:${action.content_hash}`;
      if (seen.has(evidenceKey)) return summary;
      seen.add(evidenceKey);
      const payload = action.command_payload ?? {};
      summary.binder_amount += numeric(
        payload.total_binder_amount ?? payload.binder_amount,
      );
      summary.deposit_amount += numeric(payload.deposit_amount);
      summary.refund_amount += numeric(payload.refund_amount);
      return summary;
    },
    { binder_amount: 0, deposit_amount: 0, refund_amount: 0 },
  );
}

function numeric(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function moneyEqual(left: unknown, right: unknown): boolean {
  return (
    typeof left === "number" &&
    typeof right === "number" &&
    Math.abs(left - right) < 0.001
  );
}

function normalizedText(value: unknown): string {
  return String(value ?? "").trim().toLowerCase().replace(/\s+/g, " ");
}

function sameDate(left: unknown, right: unknown): boolean {
  const leftDate = new Date(String(left ?? ""));
  const rightDate = new Date(String(right ?? ""));
  return (
    Number.isFinite(leftDate.getTime()) &&
    Number.isFinite(rightDate.getTime()) &&
    leftDate.toISOString().slice(0, 10) ===
      rightDate.toISOString().slice(0, 10)
  );
}

function leadSourceValuesMatch(
  leadModel: "FormLead" | "CallLead",
  source: Record<string, unknown>,
  canonical: Record<string, unknown>,
): boolean {
  const sourceOwned = Object.fromEntries(
    sourceOwnedPaths(leadModel)
      .filter((path) => Object.hasOwn(source, path))
      .map((path) => [path, source[path]]),
  );
  return (
    evaluateSourceOwnedLeadUpdate({
      lead_model: leadModel,
      originated_from_best_relocation: true,
      last_applied: canonical,
      current_source: sourceOwned,
      current_canonical: canonical,
    }).classification === "unchanged"
  );
}
