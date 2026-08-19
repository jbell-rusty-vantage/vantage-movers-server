import { isObjectIdString } from "../../utils/objectId";
import { resolveSourceCompanyFromLabel } from "../../config/domain";
import { getFormLeadModel, type FormLeadDocument } from "../../models/FormLead";
import {
  searchFormLeads,
  type FormLeadSearchMatch,
} from "../search/formLeadSearch.service";

export type GranotFormLeadMatchMethod =
  | "ref_no_exact"
  | "mongo_id"
  | "fallback"
  | "none";

export type GranotFormLeadLike = FormLeadDocument & {
  createdAt: Date;
  get(path: string): unknown;
};

export type GranotFormLeadMatchInput = {
  ref_no?: string;
  phone_number?: string;
  email?: string;
  name?: string;
  source_label: string;
  prior?: string;
};

export type GranotFormLeadMatchResult =
  | {
      status: "found";
      match_method: Exclude<GranotFormLeadMatchMethod, "none">;
      lead: GranotFormLeadLike;
      candidate_count: number;
      warnings: string[];
    }
  | {
      status: "conflict" | "no_match";
      match_method: "none";
      candidate_count: number;
      reason: string;
      warnings: string[];
    };

export type GranotFormLeadMatcherDependencies = {
  findExactRefMatches?: (refNo: string) => Promise<GranotFormLeadLike[]>;
  findByMongoId?: (id: string) => Promise<GranotFormLeadLike | undefined>;
  search?: typeof searchFormLeads;
};

export async function resolveGranotFormLead(
  input: GranotFormLeadMatchInput,
  dependencies: GranotFormLeadMatcherDependencies = {},
): Promise<GranotFormLeadMatchResult> {
  const refNo = clean(input.ref_no);
  if (refNo) {
    const exact = await (
      dependencies.findExactRefMatches ?? findExactRefMatches
    )(refNo);
    if (exact.length > 1) {
      return {
        status: "conflict",
        match_method: "none",
        candidate_count: exact.length,
        reason: "duplicate_exact_ref",
        warnings: [],
      };
    }
    if (exact.length === 1) {
      return found("ref_no_exact", exact[0], input.source_label);
    }
  }

  if (refNo && isObjectIdString(refNo)) {
    const lead = await (dependencies.findByMongoId ?? findByMongoId)(refNo);
    if (lead) {
      return found("mongo_id", lead, input.source_label);
    }
  }

  const phoneNumber = clean(input.phone_number);
  const email = clean(input.email);
  if (!phoneNumber && !email) {
    return {
      status: "no_match",
      match_method: "none",
      candidate_count: 0,
      reason: "Fallback matching requires phone or email.",
      warnings: [],
    };
  }

  const result = await (dependencies.search ?? searchFormLeads)({
    phone_number: phoneNumber,
    email,
    name: clean(input.name),
    limit: 25,
    include_duplicates: false,
  });
  const selected = selectGranotFormFallback(
    result.matches,
    input.source_label,
    input.prior,
  );
  if (selected.status === "conflict") {
    return {
      status: "conflict",
      match_method: "none",
      candidate_count: selected.candidateCount,
      reason: "ambiguous_fallback",
      warnings: [],
    };
  }
  if (!selected.lead) {
    return {
      status: "no_match",
      match_method: "none",
      candidate_count: selected.candidateCount,
      reason: selected.sourceGated
        ? "No same-source FormLead matched phone, email, or name."
        : "No non-quarantined FormLead matched phone, email, or name.",
      warnings: [],
    };
  }
  return {
    status: "found",
    match_method: "fallback",
    lead: selected.lead,
    candidate_count: selected.candidateCount,
    warnings: [],
  };
}

export function selectGranotFormFallback(
  matches: FormLeadSearchMatch[],
  sourceLabel: string,
  prior: string | undefined,
): {
  lead?: GranotFormLeadLike;
  status: "found" | "not_found" | "conflict";
  sourceGated?: boolean;
  candidateCount: number;
} {
  if (!matches.length) return { status: "not_found", candidateCount: 0 };
  const sourceCompany = resolveSourceCompanyFromLabel(sourceLabel);
  if (!sourceCompany) {
    return {
      status: "not_found",
      sourceGated: true,
      candidateCount: matches.length,
    };
  }
  let candidates = matches.filter(
    ({ lead }) => String(lead.source_company ?? "") === sourceCompany,
  );
  if (!candidates.length) {
    return {
      status: "not_found",
      sourceGated: true,
      candidateCount: matches.length,
    };
  }
  const bestScore = Math.max(...candidates.map((match) => match.score));
  candidates = candidates.filter((match) => match.score === bestScore);
  if (candidates.length > 1 && ["0", "1", "5"].includes(prior ?? "")) {
    const expectedQuoted = prior === "1" || prior === "5";
    const quotedMatches = candidates.filter(
      ({ lead }) => lead.quoted === expectedQuoted,
    );
    if (quotedMatches.length) candidates = quotedMatches;
  }
  return candidates.length === 1
    ? {
        status: "found",
        lead: candidates[0].lead as unknown as GranotFormLeadLike,
        candidateCount: candidates.length,
      }
    : { status: "conflict", candidateCount: candidates.length };
}

async function findExactRefMatches(
  refNo: string,
): Promise<GranotFormLeadLike[]> {
  const FormLead = getFormLeadModel();
  return (await FormLead.find({
    ref_no: refNo,
    duplicate: { $ne: true },
  })
    .limit(3)
    .exec()) as unknown as GranotFormLeadLike[];
}

async function findByMongoId(
  id: string,
): Promise<GranotFormLeadLike | undefined> {
  const FormLead = getFormLeadModel();
  const lead = await FormLead.findOne({
    _id: id,
    duplicate: { $ne: true },
  }).exec();
  return (lead as unknown as GranotFormLeadLike | null) ?? undefined;
}

function found(
  matchMethod: Exclude<GranotFormLeadMatchMethod, "fallback" | "none">,
  lead: GranotFormLeadLike,
  sourceLabel: string,
): GranotFormLeadMatchResult {
  const expectedSource = resolveSourceCompanyFromLabel(sourceLabel);
  const actualSource = String(lead.source_company ?? "");
  const warnings =
    expectedSource && actualSource !== expectedSource
      ? [
          `Exact identity matched source_company "${actualSource || "missing"}" while Granot source "${sourceLabel}" maps to "${expectedSource}".`,
        ]
      : [];
  return {
    status: "found",
    match_method: matchMethod,
    lead,
    candidate_count: 1,
    warnings,
  };
}

function clean(value: string | undefined): string | undefined {
  return value?.replace(/\u00a0/g, " ").replace(/\s+/g, " ").trim() || undefined;
}
