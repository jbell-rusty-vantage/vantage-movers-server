/*TODO From the owner. We need to break out types into their own folders and files. 
 TODO we need to replace unknowns where there are actual current knowns. 
 TODO we have moved most operational identity to the operations registry collections so we should use those   
 TODO types where possible  
*/

export type SourceCompatibility =
  | "exact_granularity"
  | "same_company"
  | "unassigned"
  | "conflict";

type SourceComparable = {
  source_company?: unknown;
  lead_source_company?: unknown;
  source_granularity_key?: unknown;
};

type SourceExpectation = {
  source_company?: string | null;
  lead_source_company?: string | null;
  source_granularity_key?: string | null;
};

export function classifyLeadSourceCompatibility(
  lead: SourceComparable,
  expected: SourceExpectation,
): SourceCompatibility {
  const expectedLeadSourceCompany = normalizeObjectId(
    expected.lead_source_company,
  );
  const expectedSourceCompany = normalizeString(expected.source_company);
  const expectedGranularity = normalizeString(expected.source_granularity_key);

  const leadSourceCompany = normalizeObjectId(lead.lead_source_company);
  const leadCompany = normalizeString(lead.source_company);
  const leadGranularity = normalizeString(lead.source_granularity_key);

  if (
    expectedLeadSourceCompany &&
    leadSourceCompany === expectedLeadSourceCompany &&
    expectedGranularity &&
    leadGranularity === expectedGranularity
  ) {
    return "exact_granularity";
  }

  if (
    expectedLeadSourceCompany &&
    leadSourceCompany &&
    leadSourceCompany === expectedLeadSourceCompany
  ) {
    return "same_company";
  }

  if (
    expectedSourceCompany &&
    leadCompany &&
    expectedSourceCompany === leadCompany
  ) {
    return expectedGranularity && leadGranularity === expectedGranularity
      ? "exact_granularity"
      : "same_company";
  }

  if ((!leadCompany || leadCompany === "not_provided") && !leadSourceCompany) {
    return "unassigned";
  }

  return "conflict";
}

// TODO we need a dedicated utils module that is aptly named. These are normalizers

function normalizeString(value: unknown): string | undefined {
  return typeof value === "string"
    ? value.trim().toLowerCase() || undefined
    : undefined;
}

function normalizeObjectId(value: unknown): string | undefined {
  if (!value) {
    return undefined;
  }
  if (typeof value === "string") {
    return value.trim().toLowerCase() || undefined;
  }
  if (typeof value === "object" && value !== null && "toString" in value) {
    const text = String(value).trim().toLowerCase();
    return text || undefined;
  }
  return undefined;
}
