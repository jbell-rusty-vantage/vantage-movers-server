import type { HydratedDocument } from "mongoose";
import { FormLead, type FormLeadDocument } from "../../models/FormLead";

export type FormLeadSearchField = "ref_no" | "name" | "email" | "phone_number";
export type FormLeadSearchConfidence = "high" | "medium" | "low";
export type FormLeadSearchStatus = "found" | "not_found" | "ambiguous";

export type FormLeadSearchInput = Partial<Record<FormLeadSearchField, string>> & {
  limit?: number;
};

export type FormLeadSearchCriteria = Partial<Record<FormLeadSearchField, string>> & {
  phone_digits?: string;
};

export type FormLeadSearchMatch = {
  lead: HydratedDocument<FormLeadDocument>;
  matched_fields: FormLeadSearchField[];
  confidence: FormLeadSearchConfidence;
  score: number;
};

type FormLeadCandidateClause = Partial<Record<FormLeadSearchField, string | RegExp>>;
type FormLeadCandidateFilter = { $or: FormLeadCandidateClause[] };

type FormLeadSearchBaseResult = {
  status: FormLeadSearchStatus;
  found: boolean;
  message: string;
  searched_fields: FormLeadSearchField[];
  criteria: FormLeadSearchCriteria;
  matches: FormLeadSearchMatch[];
};

export type FormLeadSearchFoundResult = FormLeadSearchBaseResult & {
  status: "found";
  found: true;
  lead: HydratedDocument<FormLeadDocument>;
  best_match: FormLeadSearchMatch;
};

export type FormLeadSearchNotFoundResult = FormLeadSearchBaseResult & {
  status: "not_found";
  found: false;
};

export type FormLeadSearchAmbiguousResult = FormLeadSearchBaseResult & {
  status: "ambiguous";
  found: false;
};

export type FormLeadSearchResult =
  | FormLeadSearchFoundResult
  | FormLeadSearchNotFoundResult
  | FormLeadSearchAmbiguousResult;

const DEFAULT_SEARCH_LIMIT = 10;
const MAX_SEARCH_LIMIT = 25;
const DEFAULT_REF_NO = "not provided";

const FIELD_WEIGHTS: Record<FormLeadSearchField, number> = {
  ref_no: 100,
  email: 40,
  phone_number: 35,
  name: 15,
};

export async function searchFormLeads(input: FormLeadSearchInput): Promise<FormLeadSearchResult> {
  const criteria = normalizeSearchInput(input);
  const searchedFields = getSearchedFields(criteria);
  const limit = clampSearchLimit(input.limit);

  if (searchedFields.length === 0) {
    return {
      status: "not_found",
      found: false,
      message: "No usable form lead search fields were provided.",
      searched_fields: searchedFields,
      criteria,
      matches: [],
    };
  }

  const filter = buildCandidateFilter(criteria);
  if (!filter) {
    return {
      status: "not_found",
      found: false,
      message: "No usable form lead search fields were provided.",
      searched_fields: searchedFields,
      criteria,
      matches: [],
    };
  }

  const candidates = await FormLead.find(filter).sort({ createdAt: -1 }).limit(limit).exec();
  const matches = candidates
    .map((lead) => scoreLead(lead, criteria))
    .filter((match) => match.score > 0)
    .sort(compareMatches);

  if (matches.length === 0) {
    return {
      status: "not_found",
      found: false,
      message: `No form lead matched the supplied ${fieldList(searchedFields)}.`,
      searched_fields: searchedFields,
      criteria,
      matches: [],
    };
  }

  const [bestMatch, secondMatch] = matches;
  if (secondMatch && bestMatch.score === secondMatch.score) {
    return {
      status: "ambiguous",
      found: false,
      message: `Multiple form leads matched with the same confidence. Add another identifier before updating quoted.`,
      searched_fields: searchedFields,
      criteria,
      matches,
    };
  }

  return {
    status: "found",
    found: true,
    message: `Found a form lead using ${fieldList(bestMatch.matched_fields)}.`,
    searched_fields: searchedFields,
    criteria,
    lead: bestMatch.lead,
    best_match: bestMatch,
    matches,
  };
}

function normalizeSearchInput(input: FormLeadSearchInput): FormLeadSearchCriteria {
  const refNo = normalizeRefNo(input.ref_no);
  const name = normalizeName(input.name);
  const email = normalizeEmail(input.email);
  const phoneNumber = normalizeValue(input.phone_number);
  const phoneDigits = normalizePhoneDigits(phoneNumber);

  return {
    ...(refNo ? { ref_no: refNo } : {}),
    ...(name ? { name } : {}),
    ...(email ? { email } : {}),
    ...(phoneNumber ? { phone_number: phoneNumber } : {}),
    ...(phoneDigits ? { phone_digits: phoneDigits } : {}),
  };
}

function buildCandidateFilter(criteria: FormLeadSearchCriteria): FormLeadCandidateFilter | null {
  const clauses: FormLeadCandidateClause[] = [];

  if (criteria.ref_no) {
    clauses.push({ ref_no: criteria.ref_no });
  }

  if (criteria.email) {
    clauses.push({ email: criteria.email });
  }

  if (criteria.phone_number) {
    clauses.push({ phone_number: criteria.phone_number });
  }

  if (criteria.phone_digits && criteria.phone_digits.length >= 7) {
    clauses.push({ phone_number: buildPhoneRegex(criteria.phone_digits) });
  }

  if (criteria.name) {
    clauses.push({ name: buildNameRegex(criteria.name) });
  }

  return clauses.length > 0 ? { $or: clauses } : null;
}

function scoreLead(
  lead: HydratedDocument<FormLeadDocument>,
  criteria: FormLeadSearchCriteria,
): FormLeadSearchMatch {
  const matchedFields: FormLeadSearchField[] = [];

  if (criteria.ref_no && lead.ref_no?.trim() === criteria.ref_no) {
    matchedFields.push("ref_no");
  }

  if (criteria.email && normalizeEmail(lead.email) === criteria.email) {
    matchedFields.push("email");
  }

  if (criteria.phone_digits && normalizePhoneDigits(lead.phone_number) === criteria.phone_digits) {
    matchedFields.push("phone_number");
  }

  if (criteria.name && normalizeName(lead.name) === criteria.name) {
    matchedFields.push("name");
  }

  const score = matchedFields.reduce((total, field) => total + FIELD_WEIGHTS[field], 0);

  return {
    lead,
    matched_fields: matchedFields,
    confidence: confidenceFor(score, matchedFields),
    score,
  };
}

function compareMatches(a: FormLeadSearchMatch, b: FormLeadSearchMatch): number {
  if (a.score !== b.score) {
    return b.score - a.score;
  }

  return b.lead.createdAt.getTime() - a.lead.createdAt.getTime();
}

function confidenceFor(
  score: number,
  matchedFields: FormLeadSearchField[],
): FormLeadSearchConfidence {
  if (matchedFields.includes("ref_no") || score >= FIELD_WEIGHTS.email + FIELD_WEIGHTS.phone_number) {
    return "high";
  }

  if (score >= FIELD_WEIGHTS.phone_number || score >= FIELD_WEIGHTS.email) {
    return "medium";
  }

  return "low";
}

function getSearchedFields(criteria: FormLeadSearchCriteria): FormLeadSearchField[] {
  return (["ref_no", "name", "email", "phone_number"] as const).filter((field) =>
    Boolean(criteria[field]),
  );
}

function clampSearchLimit(value: number | undefined): number {
  if (value === undefined || !Number.isFinite(value)) {
    return DEFAULT_SEARCH_LIMIT;
  }

  return Math.min(Math.max(Math.trunc(value), 1), MAX_SEARCH_LIMIT);
}

function normalizeRefNo(value: string | null | undefined): string | undefined {
  const normalized = normalizeValue(value);
  if (!normalized || normalized.toLowerCase() === DEFAULT_REF_NO) {
    return undefined;
  }

  return normalized;
}

function normalizeValue(value: string | null | undefined): string | undefined {
  return value?.trim() || undefined;
}

function normalizeName(value: string | null | undefined): string | undefined {
  return normalizeValue(value)?.replace(/\s+/g, " ").toLowerCase();
}

function normalizeEmail(value: string | null | undefined): string | undefined {
  return normalizeValue(value)?.toLowerCase();
}

function normalizePhoneDigits(value: string | null | undefined): string | undefined {
  return normalizeValue(value)?.replace(/\D/g, "") || undefined;
}

function buildNameRegex(normalizedName: string): RegExp {
  const pattern = normalizedName.split(" ").map(escapeRegex).join("\\s+");
  return new RegExp(`^${pattern}$`, "i");
}

function buildPhoneRegex(phoneDigits: string): RegExp {
  const digits = phoneDigits.replace(/\D/g, "");
  return new RegExp(`(?:^|\\D)${digits.split("").join("\\D*")}(?:\\D|$)`);
}

function escapeRegex(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

function fieldList(fields: FormLeadSearchField[]): string {
  return fields.map((field) => `\`${field}\``).join(", ");
}
